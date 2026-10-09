import path from 'node:path'
import { compileHtmlModules } from './compileHtmlModules'
import type { Loader, Message, Plugin } from 'esbuild'
import { loadRuntimeEsbuild, runtimeEsbuildVersion } from '../../componentCompilerRuntime'
import { componentModuleFileExtensions, componentModuleSpecifier } from '../../../../core/components/source/moduleSpecifier'
import type {
  ComponentCompilationDiagnostic, ComponentCompilationInput, ComponentCompiler,
} from '../../../../core/components/compilation/types'

const namespace = 'component-memory'
export { componentModuleFileExtensions } from '../../../../core/components/source/moduleSpecifier'
const loaders: Record<string, Loader> = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js', '.json': 'json', '.css': 'css', '.txt': 'text', '.svg': 'text' }

function relativeFile(name: string): string {
  const slash = name.replaceAll('\\', '/')
  const normalized = path.posix.normalize(slash)
  if (path.posix.isAbsolute(slash) || /^[a-z]:/i.test(slash) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`组件源码文件必须属于提供的模块：${name}`)
  }
  return normalized
}

function diagnostics(messages: readonly Message[], severity: 'error' | 'warning', names: Map<string, string>): ComponentCompilationDiagnostic[] {
  return messages.map(message => {
    const location = message.location
    const file = location?.file.replace(`${namespace}:`, '')
    return {
      stage: 'compile', severity, message: message.text,
      ...(location ? { file: names.get(file!) ?? file, line: location.line, column: location.column, lineText: location.lineText } : {}),
    }
  })
}

/** esbuild reads only supplied virtual files and returns bytes; it never runs candidate code. */
export function createEsbuildComponentCompiler(): ComponentCompiler {
  return {
    identity: `esbuild:${runtimeEsbuildVersion}:component-memory-esm-7`,
    async compile(input: ComponentCompilationInput) {
      if (input.options?.preserveModules) {
        const { transform } = await loadRuntimeEsbuild()
        return compileHtmlModules(input, transform)
      }
      const files = new Map<string, string>(), names = new Map<string, string>()
      const binaryFiles = new Map<string, Uint8Array>()
      const entries = new Map<string, string>()
      const entryLoaders = new Map<string, Loader>()
      const declareEntry = (root: string, entry: string, language: ComponentCompilationInput['entryLanguage']) => {
        if (language) entryLoaders.set(`${root}/${relativeFile(entry)}`, language === 'typescript'
          ? /\.[jt]sx$/i.test(entry) ? 'tsx' : 'ts' : /\.[jt]sx$/i.test(entry) ? 'jsx' : 'js')
      }
      const owners = new Map<string, { root: string; bindings?: Readonly<Record<string, string>> }>()
      const addFiles = (root: string, values: Readonly<Record<string, string>>, bindings?: Readonly<Record<string, string>>, dependency?: string, binaries?: Readonly<Record<string, Uint8Array>>) => {
        for (const [name, contents] of Object.entries(values)) {
          const relative = relativeFile(name), virtual = `${root}/${relative}`
          if (files.has(virtual)) throw new Error(`组件源码文件路径重复：${name}`)
          files.set(virtual, contents)
          owners.set(virtual, { root, bindings })
          names.set(virtual, dependency ? `${dependency}/${relative}` : name)
        }
        for (const [name, bytes] of Object.entries(binaries ?? {})) {
          const relative = relativeFile(name), virtual = `${root}/${relative}`
          if (files.has(virtual) || binaryFiles.has(virtual)) throw new Error(`组件源码文件路径重复：${name}`)
          binaryFiles.set(virtual, bytes); owners.set(virtual, { root, bindings }); names.set(virtual, dependency ? `${dependency}/${relative}` : name)
        }
      }
      addFiles('/source', input.files, input.moduleBindings, undefined, input.binaryFiles)
      declareEntry('/source', input.entry, input.entryLanguage)
      for (const [specifier, dependency] of Object.entries(input.dependencies ?? {})) {
        const root = `/dependencies/${encodeURIComponent(specifier)}`
        addFiles(root, dependency.files, dependency.moduleBindings, specifier, dependency.binaryFiles)
        declareEntry(root, dependency.entry, dependency.entryLanguage)
        entries.set(specifier, `${root}/${relativeFile(dependency.entry)}`)
      }
      const resolveFile = (base: string) => componentModuleFileExtensions.map(extension => `${base}${extension}`).find(candidate => files.has(candidate) || binaryFiles.has(candidate))
      const plugin: Plugin = {
        name: namespace,
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, args => {
            // Passive CSS addresses stay under the existing content CSP. They
            // are not ambient filesystem modules and grant no network origin.
            if ((args.kind === 'url-token' || args.kind === 'import-rule') && /^(?:data:|https?:|\/\/|cw-resource:|#)/i.test(args.path))
              return { path: args.path, external: true }
            // Entry is a supplied physical filename, not an authored URL reference.
            const specifier = args.kind === 'entry-point' ? { pathname: input.entry, suffix: '' }
              : componentModuleSpecifier(args.path, args.kind === 'url-token' ? 'resource' : 'module')
            if (specifier.diagnostic) return { errors: [{ text: specifier.diagnostic }] }
            let requested: string | undefined
            if (args.kind === 'entry-point') requested = `/source/${relativeFile(input.entry)}`
            else if (args.path.startsWith('.') || args.kind === 'url-token' || args.kind === 'import-rule') {
              const owner = owners.get(args.importer)
              const relative = path.posix.join(path.posix.dirname(args.importer), specifier.pathname)
              if (owner && relative.startsWith(`${owner.root}/`)) requested = relative
            } else {
              const bindings = owners.get(args.importer)?.bindings
              const identity = bindings ? (Object.hasOwn(bindings, args.path) ? bindings[args.path]
                : Object.hasOwn(bindings, specifier.pathname) ? bindings[specifier.pathname] : undefined) : specifier.pathname
              if (identity !== undefined) requested = entries.get(identity)
            }
            const resolved = requested && resolveFile(requested)
            if (!resolved) return { errors: [{ text: `无法解析组件依赖 ${JSON.stringify(args.path)}；请由资源服务提供该模块及其实际版本` }] }
            return { path: resolved, namespace, suffix: specifier.suffix, pluginData: { asset: args.kind === 'url-token' } }
          })
          builder.onLoad({ filter: /.*/, namespace }, args => {
            if (args.pluginData?.asset) return { contents: binaryFiles.get(args.path) ?? files.get(args.path)!, loader: 'dataurl' }
            if (binaryFiles.has(args.path)) return { errors: [{ text: `非文本组件依赖不能作为程序执行：${names.get(args.path) ?? args.path}` }] }
            const loader = entryLoaders.get(args.path) ?? loaders[path.posix.extname(args.path)]
            if (!loader) return { errors: [{ text: `组件源码类型不支持：${names.get(args.path) ?? args.path}` }] }
            return { contents: files.get(args.path)!, loader }
          })
        },
      }
      try {
        const { build } = await loadRuntimeEsbuild()
        const result = await build({
          entryPoints: [input.entry], plugins: [plugin], bundle: true, write: false,
          outfile: 'component.js', format: 'esm', platform: 'browser',
          target: input.options?.target ?? 'es2022', jsx: input.options?.jsx ?? 'automatic',
          jsxImportSource: input.options?.jsxImportSource ?? 'react', minify: input.options?.minify ?? false,
          sourcemap: (input.options?.sourceMap ?? true) ? 'inline' : false,
          logLevel: 'silent', metafile: false,
        })
        return {
          status: 'ready', artifact: {
            format: 'esm', code: result.outputFiles!.find(file => file.path.endsWith('.js'))!.text,
            css: result.outputFiles!.find(file => file.path.endsWith('.css'))?.text ?? '',
            diagnostics: diagnostics(result.warnings, 'warning', names),
          },
        }
      } catch (error) {
        const errors = (error as { errors?: Message[] }).errors
        return {
          status: 'failed', diagnostics: errors ? diagnostics(errors, 'error', names) : [{
            stage: 'compile', severity: 'error', message: error instanceof Error ? error.message : String(error),
          }],
        }
      }
    },
  }
}
