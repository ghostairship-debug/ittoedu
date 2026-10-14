import { parse, tokenizer } from 'acorn'
import type { TransformOptions } from 'esbuild'
import { createWebModuleResolver, localModulePath } from '../../../../components/web/moduleGraph'
import type { ComponentCompilationInput, ComponentCompilerResult, ComponentCompilationDiagnostic, CompiledJavaScriptModule } from '../../../../core/components/compilation/types'
import { cssImportReferences } from '../../../../shared/composition/projectReferences'
import { wrapCssImport } from '../../htmlImport/extractHtmlResources'

type AstNode = { type: string; start: number; end: number; [name: string]: unknown }
const pathname = (value: string) => value.split(/[?#]/, 1)[0]!
const resolveModuleReference = createWebModuleResolver({ URL, decodeURI })

// Keep native import options intact for the graph and the published Web compiler.
export const retainedNativeModuleSyntaxSupport: NonNullable<TransformOptions['supported']> = { 'import-attributes': true }

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
  if (input.htmlModuleDocuments?.length) {
    for (const document of input.htmlModuleDocuments) {
      const result = await compileHtmlModules({ ...input, htmlModuleDocuments: undefined, htmlModuleBindings: document.bindings,
        entry: document.entries[0] ?? input.entry, moduleEntries: document.entries }, transform)
      diagnostics.push(...(result.status === 'ready' ? result.artifact.diagnostics : result.diagnostics))
      if (result.status !== 'ready') continue
      for (const [path, module] of Object.entries(result.artifact.modules ?? {})) {
        let code = module.code
        if (document.namespace && code.includes('guoling-module-url:')) {
          const edits: Array<{ start: number; end: number; value: string }> = []
          for (const token of tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module' })) {
            const value = 'value' in token ? token.value : undefined
            if (token.type.label === 'string' && typeof value === 'string' && value.startsWith('guoling-module-url:')) edits.push({
              start: token.start, end: token.end, value: JSON.stringify(`guoling-module-url:${document.namespace}${value.slice('guoling-module-url:'.length)}`) })
          }
          for (const edit of edits.reverse()) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end)
        }
        const oldReferences = moduleImportReferences(module.code), references = moduleImportReferences(code)
        const imports = module.imports.map(reference => {
          const index = oldReferences.findIndex(value => value.start === reference.start && value.end === reference.end)
          const projected = references[index]!
          return { start: projected.start, end: projected.end, path: document.namespace + reference.path }
        })
        const moduleUrls = module.moduleUrls?.map(path => document.namespace + path)
        Object.defineProperty(modules, document.namespace + path, { enumerable: true, configurable: true, writable: true,
          value: { code, imports, ...(moduleUrls?.length ? { moduleUrls } : {}) } })
      }
    }
    return { status: 'ready', artifact: { format: 'esm', code: '', css: '', modules, diagnostics } }
  }
  // Supplied files may include unused drafts. Only executable entries and their
  // actual imports belong to the runtime graph; the complete source stays in input.
  const pending = [...new Set(input.moduleEntries ?? [input.entry])]
  const seen = new Set<string>()
  const closeCss = (name: string, stack = new Set<string>()): string => {
    const source = input.files[pathname(name)]
    if (source === undefined) { diagnostics.push({ stage: 'compile', severity: 'warning', file: name, message: `本地样式缺失：${name}；其他样式已保留` }); return '' }
    if (stack.has(name)) return ''
    const next = new Set(stack); next.add(name)
    let result = source
    for (const reference of cssImportReferences(source).reverse()) {
      const target = localModulePath(reference.reference, name, true)
      if (!target) continue
      const imported = closeCss(target, next)
      const wrapped = wrapCssImport(imported, reference.conditions)
      if (wrapped === undefined) { diagnostics.push({ stage: 'compile', severity: 'warning', file: name, message: '本地样式导入条件暂不能等价承载；原引用已保留' }); continue }
      result = result.slice(0, reference.start) + wrapped + result.slice(reference.end)
    }
    return result
  }
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
        const output = await transform(closeCss(name), { loader: 'css', target: input.options?.target ?? 'es2022', minify: input.options?.minify ?? false })
        const css = JSON.stringify(output.code).replace(/</g, '\\u003c')
        modules[name] = { code: `const css=${css};const style=document.createElement('style');style.textContent=css;document.head.append(style);export default css;`, imports: [] }
        diagnostics.push(...output.warnings.map(warning => ({ stage: 'compile' as const, severity: 'warning' as const, file: name, message: warning.text })))
        continue
      }
      const output = await transform(source, { loader: 'js', format: 'esm', target: input.options?.target ?? 'es2022', supported: retainedNativeModuleSyntaxSupport,
        sourcefile: pathname(name), sourcemap: input.options?.sourceMap ? 'inline' : false,
        minify: input.options?.minify ?? false })
      let code = output.code
      const metadata: { start: number; end: number; value: string }[] = []
      const moduleUrls = new Set<string>()
      const tree = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as AstNode
      const isMetaUrl = (value: AstNode | undefined): boolean => {
        if (value?.type !== 'MemberExpression') return false
        const object = value.object as AstNode | undefined, property = value.property as AstNode | undefined
        const meta = object?.meta as AstNode | undefined, keyword = object?.property as AstNode | undefined
        return object?.type === 'MetaProperty' && meta?.name === 'import' && keyword?.name === 'meta'
          && (value.computed ? property?.type === 'Literal' && property.value === 'url'
            : property?.type === 'Identifier' && property.name === 'url')
      }
      const writesMetaUrl = (target: AstNode | undefined): boolean => {
        if (!target) return false
        if (isMetaUrl(target)) return true
        if (target.type === 'ArrayPattern') return (target.elements as Array<AstNode | null>).some(value => value && writesMetaUrl(value))
        if (target.type === 'ObjectPattern') return (target.properties as AstNode[]).some(value => writesMetaUrl((value.type === 'RestElement' ? value.argument : value.value) as AstNode))
        if (target.type === 'RestElement') return writesMetaUrl(target.argument as AstNode)
        if (target.type === 'AssignmentPattern') return writesMetaUrl(target.left as AstNode)
        return false
      }
      const identifiers = new Set<string>()
      let mutable = false
      const inspect = (node: AstNode): void => {
        if (node.type === 'Identifier') identifiers.add(node.name as string)
        if (node.type === 'AssignmentExpression' || node.type === 'ForInStatement' || node.type === 'ForOfStatement')
          mutable ||= writesMetaUrl(node.left as AstNode)
        if (node.type === 'UpdateExpression' || node.type === 'UnaryExpression' && node.operator === 'delete')
          mutable ||= writesMetaUrl(node.argument as AstNode)
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(value => { if (value && typeof value === 'object' && 'type' in value) inspect(value as AstNode) })
          else if (child && typeof child === 'object' && 'type' in child) inspect(child as AstNode)
        }
      }
      inspect(tree)
      let index = 0
      while (identifiers.has(`__guoling_meta_url_cell${index}`) || identifiers.has(`__guoling_meta_url_get${index}`)) index++
      const cell = `__guoling_meta_url_cell${index}`, getter = `__guoling_meta_url_get${index}`
      const visitMetadata = (node: AstNode): void => {
        if (!mutable && node.type === 'NewExpression' && (node.callee as AstNode)?.type === 'Identifier' && (node.callee as AstNode).name === 'URL' && isMetaUrl((node.arguments as AstNode[])[1])) {
          const first = (node.arguments as AstNode[])[0], reference = first?.type === 'Literal' && typeof first.value === 'string' ? first.value : undefined
          const target = reference && localModulePath(reference, name)
          if (target && Object.hasOwn(input.files, pathname(target)) && /\.[cm]?js(?:[?#]|$)/i.test(target)) {
            metadata.push({ start: node.start, end: node.end, value: `new URL(${JSON.stringify(`guoling-module-url:${target}`)})` })
            moduleUrls.add(target); pending.push(target); return
          }
          if (!reference) diagnostics.push({ stage: 'compile', severity: 'warning', file: name, message: '动态模块相对 URL 保留源基址；其运行时目标无法静态投影，原源码已保留' })
        }
        if (isMetaUrl(node)) metadata.push({ start: node.start, end: node.end,
          value: mutable ? `${getter}().url` : JSON.stringify(new URL(name, 'https://guoling.local/').href) })
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(value => { if (value && typeof value === 'object' && 'type' in value) visitMetadata(value as AstNode) })
          else if (child && typeof child === 'object' && 'type' in child) visitMetadata(child as AstNode)
        }
      }
      visitMetadata(tree)
      for (const span of metadata.sort((a, b) => b.start - a.start)) code = code.slice(0, span.start) + span.value + code.slice(span.end)
      // ESM cycles can call a hoisted export before this module evaluates. The
      // var has no initializer, so it neither adds TDZ nor resets an early write.
      if (mutable) {
        const insertion = (tree.body as AstNode[])[0]!.start
        const declarations = `var ${cell};function ${getter}(){return ${cell} ||= {__proto__:null,url:${JSON.stringify(new URL(name, 'https://guoling.local/').href)}}}\n`
        code = code.slice(0, insertion) + declarations + code.slice(insertion)
      }
      const imports: CompiledJavaScriptModule['imports'] = []
      for (const value of moduleImportReferences(code)) {
        const target = value.reference === undefined ? undefined : resolveModuleReference(value.reference, name, false,
          { namespace: '', bindings: input.htmlModuleBindings ?? {} })
        if (target) { imports.push({ start: value.start, end: value.end, path: target }); pending.push(target) }
        else diagnostics.push({ stage: 'compile', severity: value.reference === undefined ? 'warning' : 'error', file: name,
          message: `模块引用 ${value.reference ?? '（运行时动态表达式）'} 保留原样；当前仅收集可静态读取的本地模块` })
      }
      modules[name] = { code, imports, ...(moduleUrls.size ? { moduleUrls: [...moduleUrls] } : {}) }
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
