import { parse } from 'acorn'
import type { TransformOptions } from 'esbuild'
import { localModulePath } from '../../../../components/web/moduleGraph'
import type { ComponentCompilationInput, ComponentCompilerResult, ComponentCompilationDiagnostic, CompiledJavaScriptModule } from '../../../../core/components/compilation/types'

type AstNode = { type: string; start: number; end: number; [name: string]: unknown }
const pathname = (value: string) => value.split(/[?#]/, 1)[0]!

export interface ModuleImportReference { reference?: string; start: number; end: number }

/** One syntax reader for native HTML modules and formal source-file admission. */
export function moduleImportReferences(code: string, options: { commonJs?: boolean } = {}): ModuleImportReference[] {
  const references: ModuleImportReference[] = []
  const root = parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }) as unknown as AstNode
  const visit = (node: AstNode): void => {
    const requireCall = options.commonJs && node.type === 'CallExpression' && (node.callee as AstNode | undefined)?.type === 'Identifier'
      && (node.callee as AstNode).name === 'require'
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) || node.type === 'ExportNamedDeclaration' && node.source || requireCall) {
      const value = (requireCall ? (node.arguments as AstNode[])[0] : node.source) as AstNode | undefined
      const reference = value?.type === 'Literal' && typeof value.value === 'string' ? value.value
        : value?.type === 'TemplateLiteral' && (value.expressions as unknown[]).length === 0
          ? (value.quasis as Array<{ value: { cooked: string } }>)[0]?.value.cooked : undefined
      references.push({ reference, start: value?.start ?? node.start, end: value?.end ?? node.end })
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => { if (value && typeof value === 'object' && 'type' in value) visit(value as AstNode) })
      else if (child && typeof child === 'object' && 'type' in child) visit(child as AstNode)
    }
  }
  visit(root)
  return references
}

/** Transpile supplied local HTML modules without bundling or running them. Native ESM owns evaluation. */
export async function compileHtmlModules(input: ComponentCompilationInput,
  transform: (source: string, options: TransformOptions) => Promise<{ code: string; warnings: Array<{ text: string }> }>): Promise<ComponentCompilerResult> {
  const modules: Record<string, CompiledJavaScriptModule> = {}, diagnostics: ComponentCompilationDiagnostic[] = []
  // Supplied files may include unused drafts. Only executable entries and their
  // actual imports belong to the runtime graph; the complete source stays in input.
  const pending = [...new Set(input.moduleEntries ?? [input.entry])]
  const seen = new Set<string>()
  while (pending.length) {
    const name = pending.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const source = input.files[pathname(name)]
    if (source === undefined) {
      diagnostics.push({ stage: 'compile', severity: 'error', file: name, message: `本地模块缺失：${name}；原引用和其他内容已保留` })
      continue
    }
    try {
      // A local side-effect CSS import uses the same editable graph. The browser
      // receives an ordinary module that installs the closed stylesheet once.
      if (/\.css$/i.test(pathname(name))) {
        const output = await transform(source, { loader: 'css', target: input.options?.target ?? 'es2022', minify: input.options?.minify ?? false })
        const css = JSON.stringify(output.code).replace(/</g, '\\u003c')
        modules[name] = { code: `const css=${css};const style=document.createElement('style');style.textContent=css;document.head.append(style);export default css;`, imports: [] }
        diagnostics.push(...output.warnings.map(warning => ({ stage: 'compile' as const, severity: 'warning' as const, file: name, message: warning.text })))
        continue
      }
      const output = await transform(source, { loader: 'js', format: 'esm', target: input.options?.target ?? 'es2022',
        sourcefile: pathname(name), sourcemap: input.options?.sourceMap ? 'inline' : false,
        minify: input.options?.minify ?? false })
      const code = output.code, imports: CompiledJavaScriptModule['imports'] = []
      for (const value of moduleImportReferences(code)) {
        const target = value.reference === undefined ? undefined : localModulePath(value.reference, name)
        if (target) { imports.push({ start: value.start, end: value.end, path: target }); pending.push(target) }
        else diagnostics.push({ stage: 'compile', severity: value.reference === undefined ? 'warning' : 'error', file: name,
          message: `模块引用 ${value.reference ?? '（运行时动态表达式）'} 保留原样；当前仅收集可静态读取的本地模块` })
      }
      modules[name] = { code, imports }
      diagnostics.push(...output.warnings.map(warning => ({ stage: 'compile' as const, severity: 'warning' as const, file: name, message: warning.text })))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.push({ stage: 'compile', severity: 'error', file: name, message })
      // Keep this failure local. Valid sibling entries still have their own browser modules.
      modules[name] = { code: `throw new Error(${JSON.stringify(`${name}: ${message}`)})`, imports: [] }
    }
  }
  return { status: 'ready', artifact: { format: 'esm', code: '', css: '', modules, diagnostics } }
}
