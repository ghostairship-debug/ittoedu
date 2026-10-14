import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseJavaScript, tokenizer } from 'acorn'
import type { ComponentCompilationDiagnostic, ComponentCompilationInput, ComponentCompilationResult, CompiledJavaScriptModule } from '../../core/components/compilation/types'
import type { ComponentInstance, JsonObject } from '../../shared/contracts/component-platform'
import { preparedJavaScriptImportOptionsOperation } from '../../shared/browser/validatePreparedJavaScriptImportOptions'
import type { WebData } from './data'

export interface WebModuleGraph {
  modules: Record<string, CompiledJavaScriptModule>
  /** Index in the document's script elements, including non-executable data blocks. */
  entries: Record<string, string>
  /** Published-only preparation roots; these are never HTML startup entries. */
  runtimeRoots?: Readonly<Record<string, readonly string[]>>
}
export type WebRuntimeData = WebData & {
  moduleGraph?: WebModuleGraph
  /** Published preparation only; the author HTML, files and native graph stay intact. */
  publishedModuleBundle?: string
  /** Direct native srcdoc parser documents; the root uses publishedModuleBundle only. */
  publishedDocumentBundles?: Record<string, string>
}

/** Original root iframe slots are the graph's document coordinates. Templates
 * and deeper native documents remain outside the current published consumer. */
export function publishedWebModuleDocumentPaths(data: WebData): string[] {
  const paths: string[] = []
  let iframeIndex = 0
  const nested = (node: DefaultTreeAdapterTypes.Node): boolean =>
    'tagName' in node && ['iframe', 'object', 'embed'].includes(node.tagName)
    || 'childNodes' in node && node.childNodes.some(nested)
    || 'content' in node && nested(node.content)
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') {
      const path = String(iframeIndex++), srcdoc = node.attrs.find(attribute => attribute.name === 'srcdoc')
      if (srcdoc && !node.attrs.some(attribute => attribute.name === 'sandbox') && !nested(parse(srcdoc.value))) paths.push(path)
    }
    // Match webModuleCompilationInput: template.content is not a parser document yet.
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parse(data.html))
  return paths
}

/** Each parser document loads only its entry closure, including module-URL workers. */
export function webModuleGraphForDocument(graph: WebModuleGraph | undefined, documentPath = '', runtimeRoots?: readonly string[]): WebModuleGraph | undefined {
  if (!graph) return undefined
  const entries = Object.fromEntries(Object.entries(graph.entries).filter(([key]) => {
    const colon = key.lastIndexOf(':')
    return (colon < 0 ? '' : key.slice(0, colon)) === documentPath
  }))
  const modules: WebModuleGraph['modules'] = {}, pending = [...Object.values(entries), ...(runtimeRoots ?? graph.runtimeRoots?.[documentPath] ?? [])]
  while (pending.length) {
    const path = pending.pop()!
    if (Object.hasOwn(modules, path)) continue
    const module = graph.modules[path]
    if (!module) continue
    Object.defineProperty(modules, path, { enumerable: true, configurable: true, writable: true, value: module })
    pending.push(...module.imports.map(reference => reference.path))
    pending.push(...(module.moduleUrls ?? []))
    if (module.code.includes('guoling-module-url:')) {
      try { for (const token of tokenizer(module.code, { ecmaVersion: 'latest', sourceType: 'module' })) {
        const value = 'value' in token ? token.value : undefined
        if (token.type.label === 'string' && typeof value === 'string' && value.startsWith('guoling-module-url:'))
          pending.push(value.slice('guoling-module-url:'.length))
      } } catch { /* the compiler's existing diagnostics own invalid module source */ }
    }
  }
  return { modules, entries }
}

const importOptionsOperation = (graph: WebModuleGraph | undefined): string => preparedJavaScriptImportOptionsOperation(
  Object.keys(graph?.modules ?? {}).sort().map(path => graph!.modules[path]!.code),
)

/** Recovery and consumers use the complete original parser-document graph. */
export function publishedWebImportOptionsOperation(data: WebRuntimeData, documentPath = ''): string {
  return importOptionsOperation(webModuleGraphForDocument(data.moduleGraph, documentPath))
}

type ModuleSyntaxNode = { type: string; start: number; end: number; [name: string]: unknown }
type ModuleSourceEdit = { start: number; end: number; value: string }

export const publishedWebInitializationExport = '__guolingPublishedWebInitialization'
export const publishedWebRuntimeImportExport = '__guolingPublishedRuntimeImports'

export interface WebModuleResolutionContext {
  importer: string
  namespace: string
  bindings: Readonly<Record<string, string>>
}

export interface PublishedWebRuntimeImportPreparation {
  operation: string
  contexts: Readonly<Record<string, WebModuleResolutionContext>>
}

function hasUnresolvedRuntimeImport(graph: WebModuleGraph): boolean {
  return Object.values(graph.modules).some(module => {
    const references = new Set(module.imports.map(reference => `${reference.start}:${reference.end}`))
    const visit = (node: ModuleSyntaxNode): boolean => node.type === 'ImportExpression'
      && !references.has(`${(node.source as ModuleSyntaxNode).start}:${(node.source as ModuleSyntaxNode).end}`)
      || moduleSyntaxChildren(node).some(visit)
    return visit(parseJavaScript(module.code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as ModuleSyntaxNode)
  })
}

/** The selector is chosen from the full document closure before entry recovery. */
export function publishedWebRuntimeImportPreparation(data: WebRuntimeData, documentPath = ''): PublishedWebRuntimeImportPreparation | undefined {
  const graph = webModuleGraphForDocument(data.moduleGraph, documentPath)
  if (!graph) return undefined
  const sources = Object.values(graph.modules).map(module => module.code)
  if (!hasUnresolvedRuntimeImport(graph)) return undefined
  let index = 0
  while (sources.some(source => source.includes(`guoling:request-prepared-js:${index}`))) index++
  const facts = webModuleCompilationInput(data)?.documentContexts[documentPath] ?? { namespace: '', bindings: {} }
  const contexts: Record<string, WebModuleResolutionContext> = Object.create(null)
  for (const path of Object.keys(graph.modules)) contexts[path] = { importer: facts.namespace && path.startsWith(facts.namespace)
    ? path.slice(facts.namespace.length) : path, namespace: facts.namespace, bindings: facts.bindings }
  return { operation: `guoling:request-prepared-js:${index}`, contexts }
}

/** One software driver for prepared imports and the existing synchronous loader.
 * ready only joins completions; starting entries belongs to the document owner. */
export function publishedWebInitializationSource(records: readonly { index: number; loadSource: string }[]): string {
  return `function __guolingPublishedCreateEntry(index,load){
let invoked=false,resolveStarted,resolveCompletion,rejectCompletion;
const started=new Promise(resolve=>{resolveStarted=resolve});
const completion=new Promise((resolve,reject)=>{resolveCompletion=resolve;rejectCompletion=reject});
const fail=error=>{resolveStarted();rejectCompletion(error)};
return {index,completion,start(isActive){
if(!invoked){invoked=true;const begin=evaluate=>{try{if(!isActive())throw new Error('组件模块初始化已退役');return evaluate()}finally{resolveStarted()}};
try{Promise.resolve(load(begin)).then(resolveCompletion,fail)}catch(error){fail(error)}}
return {started,completion}}};}
const __guolingPublishedEntries=[${records.map(record => `__guolingPublishedCreateEntry(${record.index},${record.loadSource})`).join(',')}];
const ready=Promise.all(__guolingPublishedEntries.map(entry=>entry.completion));
const ${publishedWebInitializationExport}={entries:__guolingPublishedEntries,ready,startAll(isActive){for(const entry of __guolingPublishedEntries)entry.start(isActive);return ready}};`
}

function moduleSyntaxChildren(node: ModuleSyntaxNode): ModuleSyntaxNode[] {
  return Object.values(node).flatMap(value => Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && 'type' in item)
    : value && typeof value === 'object' && 'type' in value ? [value] : []) as ModuleSyntaxNode[]
}

function softwareExportBinding(tree: ModuleSyntaxNode, name: string): string | undefined {
  for (const statement of tree.body as ModuleSyntaxNode[]) {
    if (statement.type !== 'ExportNamedDeclaration') continue
    for (const specifier of (statement.specifiers ?? []) as ModuleSyntaxNode[]) {
      const exported = specifier.exported as ModuleSyntaxNode, local = specifier.local as ModuleSyntaxNode
      if (exported.name === name && local.type === 'Identifier') return local.name as string
    }
    const declaration = statement.declaration as ModuleSyntaxNode | undefined
    if (declaration?.type === 'VariableDeclaration' && (declaration.declarations as ModuleSyntaxNode[])
      .some(item => (item.id as ModuleSyntaxNode).name === name)) return name
  }
  return undefined
}

/** Only callers on the existing software-prepared bundle path use this export. */
export function publishedWebInitializationBinding(code: string): string | undefined {
  return softwareExportBinding(parseJavaScript(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as ModuleSyntaxNode, publishedWebInitializationExport)
}

export function publishedWebRuntimeImportBinding(code: string): string | undefined {
  return softwareExportBinding(parseJavaScript(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as ModuleSyntaxNode, publishedWebRuntimeImportExport)
}

export interface PublishedWebModuleCompilationPreparation {
  input: ComponentCompilationInput
  modulePaths: Readonly<Record<string, string>>
  /** Software filenames and original local script indices, including recovery failures. */
  initializationEntries: readonly { index: number; file?: string; error?: string }[]
  runtimeImports?: PublishedWebRuntimeImportPreparation
}

/** Acknowledge the real generated initializer invocation, including pending TLA.
 * Only software entry load thunks change; author dynamic imports remain intact. */
export function projectPublishedWebInitialization(code: string, prepared: PublishedWebModuleCompilationPreparation): string {
  const tree = parseJavaScript(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as ModuleSyntaxNode
  const binding = softwareExportBinding(tree, publishedWebInitializationExport)
  if (!binding) throw new Error('已准备 Web bundle 缺少软件初始化入口')
  const declarations = new Map<string, ModuleSyntaxNode>()
  for (const statement of tree.body as ModuleSyntaxNode[]) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration as ModuleSyntaxNode | undefined : statement
    if (declaration?.type !== 'VariableDeclaration') continue
    for (const item of declaration.declarations as ModuleSyntaxNode[])
      if ((item.id as ModuleSyntaxNode).type === 'Identifier') declarations.set((item.id as ModuleSyntaxNode).name as string, item.init as ModuleSyntaxNode)
  }
  const propertyName = (node: ModuleSyntaxNode) => {
    const key = node.key as ModuleSyntaxNode
    return node.computed ? key.value : key.type === 'Identifier' ? key.name : key.value
  }
  const program = declarations.get(binding)
  const entriesBinding = program?.type === 'ObjectExpression'
    ? (program.properties as ModuleSyntaxNode[]).find(property => propertyName(property) === 'entries')?.value as ModuleSyntaxNode | undefined
    : undefined
  const entries = entriesBinding?.type === 'Identifier' ? declarations.get(entriesBinding.name as string) : entriesBinding
  if (entries?.type !== 'ArrayExpression') throw new Error('已准备 Web bundle 的软件入口列表不可读')
  const edits: ModuleSourceEdit[] = []
  const guardInitializer = (thunk: ModuleSyntaxNode | undefined, file: string, description: string): void => {
    const parameter = (thunk?.params as ModuleSyntaxNode[] | undefined)?.[0]
    if (thunk?.type !== 'ArrowFunctionExpression' || parameter?.type !== 'Identifier') throw new Error(`${description} 的软件 thunk 不可读`)
    const initializers = new Set([...declarations].filter(([, value]) => value?.type === 'CallExpression'
      && ((value.arguments as ModuleSyntaxNode[])[0]?.type === 'ObjectExpression')
      && (((value.arguments as ModuleSyntaxNode[])[0].properties as ModuleSyntaxNode[])
        .some(property => (property.key as ModuleSyntaxNode).value === `component-memory:/source/${file}`))).map(([name]) => name))
    const calls: ModuleSyntaxNode[] = []
    const visit = (node: ModuleSyntaxNode): void => {
      const callee = node.callee as ModuleSyntaxNode | undefined
      if (node.type === 'CallExpression' && callee?.type === 'Identifier' && initializers.has(callee.name as string)) calls.push(node)
      moduleSyntaxChildren(node).forEach(visit)
    }
    visit(thunk.body as ModuleSyntaxNode)
    if (calls.length !== 1) throw new Error(`${description} 的实际模块 initializer 调用不可定位`)
    const call = calls[0]!
    edits.push({ start: call.start, end: call.end, value: `${parameter.name}(()=>${code.slice(call.start, call.end)})` })
  }
  for (const entry of prepared.initializationEntries) {
    if (!entry.file) continue // Failed recovery records already call begin and reject their completion.
    const record = (entries.elements as ModuleSyntaxNode[]).find(node => node?.type === 'CallExpression'
      && ((node.arguments as ModuleSyntaxNode[])[0]?.value === entry.index))
    const thunk = (record?.arguments as ModuleSyntaxNode[] | undefined)?.[1]
    guardInitializer(thunk, entry.file, `script[${entry.index}]`)
  }
  if (prepared.runtimeImports) {
    const runtimeBinding = softwareExportBinding(tree, publishedWebRuntimeImportExport)
    const runtime = runtimeBinding ? declarations.get(runtimeBinding) : undefined
    const targetsBinding = runtime?.type === 'ObjectExpression'
      ? (runtime.properties as ModuleSyntaxNode[]).find(property => propertyName(property) === 'targets')?.value as ModuleSyntaxNode | undefined : undefined
    const targets = targetsBinding?.type === 'Identifier' ? declarations.get(targetsBinding.name as string) : targetsBinding
    if (!runtimeBinding || targets?.type !== 'ObjectExpression') throw new Error('已准备 Web bundle 缺少软件运行时模块表')
    for (const [file, path] of Object.entries(prepared.modulePaths)) {
      const target = (targets.properties as ModuleSyntaxNode[]).find(property => propertyName(property) === path)
      guardInitializer(target?.value as ModuleSyntaxNode | undefined, file, path)
    }
    const visit = (node: ModuleSyntaxNode): void => {
      const callee = node.callee as ModuleSyntaxNode | undefined
      if (node.type === 'CallExpression' && callee?.type === 'MemberExpression' && callee.computed
        && (callee.object as ModuleSyntaxNode).type === 'MetaProperty'
        && ((callee.object as ModuleSyntaxNode).meta as ModuleSyntaxNode).name === 'import'
        && ((callee.object as ModuleSyntaxNode).property as ModuleSyntaxNode).name === 'meta'
        && (callee.property as ModuleSyntaxNode).type === 'Literal'
        && (callee.property as ModuleSyntaxNode).value === prepared.runtimeImports!.operation) {
        edits.push({ start: callee.start, end: callee.end, value: `${runtimeBinding}.request` })
      }
      moduleSyntaxChildren(node).forEach(visit)
    }
    visit(tree)
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end)
  return code
}

/** Project exact graph references, including references inside another import's options. */
function publishedModuleCode(module: CompiledJavaScriptModule, path: string, filenames: ReadonlyMap<string, string>, operation: string, runtimeOperation?: string): string {
  if (!module.imports.length && !runtimeOperation) return module.code
  const references = new Map(module.imports.map(reference => {
    const target = filenames.get(reference.path)
    if (!target) throw new Error(`已准备模块缺少依赖：${path} → ${reference.path}`)
    return [`${reference.start}:${reference.end}`, JSON.stringify(`./${target}`)]
  }))
  const apply = (node: ModuleSyntaxNode, edits: ModuleSourceEdit[]): string => {
    let code = module.code.slice(node.start, node.end)
    for (const edit of edits.sort((a, b) => b.start - a.start))
      code = code.slice(0, edit.start - node.start) + edit.value + code.slice(edit.end - node.start)
    return code
  }
  const project = (node: ModuleSyntaxNode): ModuleSourceEdit[] => {
    const source = node.source as ModuleSyntaxNode | undefined, options = node.options as ModuleSyntaxNode | undefined
    const target = source && references.get(`${source.start}:${source.end}`)
    if (node.type === 'ImportExpression' && !target && runtimeOperation && source) return [{ start: node.start, end: node.end,
      value: `import.meta[${JSON.stringify(runtimeOperation)}](${JSON.stringify(path)},${apply(source, project(source))},${options ? apply(options, project(options)) : 'void 0'})` }]
    if (node.type === 'ImportExpression' && options && target) return [{ start: node.start, end: node.end,
      value: `import.meta[${JSON.stringify(operation)}](${apply(options, project(options))}).then(()=>import(${target}))` }]
    const value = references.get(`${node.start}:${node.end}`)
    if (value) return [{ start: node.start, end: node.end, value }]
    const edits: ModuleSourceEdit[] = []
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(value => {
        if (value && typeof value === 'object' && 'type' in value) edits.push(...project(value as ModuleSyntaxNode))
      })
      else if (child && typeof child === 'object' && 'type' in child) edits.push(...project(child as ModuleSyntaxNode))
    }
    return edits
  }
  const tree = parseJavaScript(module.code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as ModuleSyntaxNode
  return apply(tree, project(tree))
}

/** Feed the prepared document graph back to the existing compiler's bundle owner.
 * Import ranges already include resolved literal dynamic imports. Complete graph
 * paths have independent software filenames, retaining query/fragment identity.
 * The driver retains indexed activations without serializing TLA completion.
 */
export function publishedWebModuleCompilationInput(data: WebRuntimeData, options: {
  documentPath?: string
  /** Recovery diagnostics compile one original entry closure; only the final artifact executes. */
  entryKeys?: readonly string[]
  /** Unusable entries remain explicit errors through the existing ready supervision. */
  rejectedEntries?: readonly { index: number; path: string; message: string }[]
  /** Recovery selects target closures separately from HTML activation entries. */
  runtimeTargetPaths?: readonly string[]
  rejectedRuntimeTargets?: readonly { path: string; message: string }[]
} = {}): PublishedWebModuleCompilationPreparation | undefined {
  const documentPath = options.documentPath ?? ''
  let graph = webModuleGraphForDocument(data.moduleGraph, documentPath)
  if (!graph) return undefined
  const operation = importOptionsOperation(graph)
  const runtimeImports = publishedWebRuntimeImportPreparation(data, documentPath)
  if (options.entryKeys || options.runtimeTargetPaths) {
    const keys = options.entryKeys && new Set(options.entryKeys)
    graph = webModuleGraphForDocument({ ...data.moduleGraph!, entries: Object.fromEntries(Object.entries(graph.entries).filter(([key]) => !keys || keys.has(key))) },
      documentPath, options.runtimeTargetPaths)!
  }
  if (!Object.keys(graph.entries).length && !Object.keys(graph.modules).length && !options.rejectedEntries?.length && !options.rejectedRuntimeTargets?.length) return undefined
  const filenames = new Map(Object.keys(graph.modules).sort().map((path, index) => [path, `__published_module_${index}.js`]))
  const files: Record<string, string> = Object.create(null)
  const modulePaths: Record<string, string> = Object.create(null)
  for (const [path, module] of Object.entries(graph.modules)) {
    const filename = filenames.get(path)!
    files[filename] = publishedModuleCode(module, path, filenames, operation, runtimeImports?.operation)
    modulePaths[filename] = path
  }
  const entry = '__published_entry.js'
  const localIndex = (key: string) => Number(key.slice(key.lastIndexOf(':') + 1))
  const initializationEntries: PublishedWebModuleCompilationPreparation['initializationEntries'][number][] = []
  const records = Object.entries(graph.entries).map(([key, path]) => {
    const filename = filenames.get(path)
    if (!filename) throw new Error(`缺少已准备模块入口：${path}`)
    const index = localIndex(key)
    initializationEntries.push({ index, file: filename })
    return { index, loadSource: `begin=>import(${JSON.stringify(`./${filename}`)})` }
  })
  for (const issue of options.rejectedEntries ?? []) {
    const error = `${issue.path}: ${issue.message}`
    initializationEntries.push({ index: issue.index, error })
    records.push({ index: issue.index, loadSource: `begin=>begin(()=>{throw new Error(${JSON.stringify(error)})})` })
  }
  records.sort((a, b) => a.index - b.index)
  initializationEntries.sort((a, b) => a.index - b.index)
  files[entry] = `${publishedWebInitializationSource(records)}\nexport {ready,${publishedWebInitializationExport}};`
  if (runtimeImports) files[entry] += `
let __guolingRuntimeImportPort;
const __guolingRuntimeImportTargets={${[
    ...Object.entries(modulePaths).map(([file, path]) => `[${JSON.stringify(path)}]:guard=>import(${JSON.stringify(`./${file}`)})`),
    ...(options.rejectedRuntimeTargets ?? []).map(issue => `[${JSON.stringify(issue.path)}]:guard=>guard(()=>{throw new Error(${JSON.stringify(issue.message)})})`),
  ].join(',')}};
const ${publishedWebRuntimeImportExport}={targets:__guolingRuntimeImportTargets,configure(port){__guolingRuntimeImportPort=port},async request(context,source,options){
const port=__guolingRuntimeImportPort;port.assertActive();const specifier=\`\${source}\`;
if(options!==undefined)await port.validate(options);port.assertActive();
const path=port.resolve(specifier,context),load=path!==undefined&&Object.hasOwn(__guolingRuntimeImportTargets,path)?__guolingRuntimeImportTargets[path]:undefined;
if(!load)return port.reject(specifier,options);
return load(evaluate=>{port.assertActive();return evaluate()});
}};
${publishedWebInitializationExport}.configureRuntimeImport=port=>${publishedWebRuntimeImportExport}.configure(port);
export {${publishedWebRuntimeImportExport}};`
  return { input: { entry, files, options: { sourceMap: false } }, modulePaths, initializationEntries, ...(runtimeImports ? { runtimeImports } : {}) }
}

/** Transport detail only; it is never part of the author's component data. */
export type RuntimeTargetProfile = 'full' | 'references'

const htmlElements = new Set(('html head title base link meta style body address article aside footer header h1 h2 h3 h4 h5 h6 hgroup main nav section search div dd dl dt figcaption figure hr li menu ol p pre ul a abbr b bdi bdo br cite code data dfn em i kbd mark q rp rt ruby s samp small span strong sub sup time u var wbr area audio img map track video picture source canvas caption col colgroup table tbody td tfoot th thead tr button datalist fieldset form input label legend meter optgroup option output progress select textarea details dialog summary slot noscript').split(' '))
const svgElements = new Set(('svg a circle clipPath defs desc ellipse filter g image line linearGradient marker mask metadata path pattern polygon polyline radialGradient rect stop style switch symbol text textPath title tspan use view feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence animate animateMotion animateTransform mpath set').toLowerCase().split(' '))
const mathElements = new Set(('math maction menclose merror mfenced mfrac mi mmultiscripts mn mo mover mpadded mphantom mprescripts mroot mrow ms mspace msqrt mstyle msub msubsup msup mtable mtd mtext mtr munder munderover none semantics annotation').split(' '))

/** Syntax facts select a cheaper snapshot, never admission or static fallback. */
export function webRuntimeExecutionFacts(data: unknown): { execution: boolean; unknown: boolean } {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('html' in data) || typeof data.html !== 'string')
    return { execution: false, unknown: true }
  const facts = { execution: false, unknown: false }
  // Stored modules also keep full semantics even if there is no current entry.
  if ('modules' in data || 'moduleGraph' in data) facts.execution = true
  const tree = parse(data.html, { onParseError: error => { if (error.code !== 'missing-doctype') facts.unknown = true } })
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node) {
      const tag = node.tagName.toLowerCase()
      if (['script', 'iframe', 'object', 'embed', 'template', 'foreignobject'].includes(tag)) facts.execution = true
      const known = node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? htmlElements
        : node.namespaceURI === 'http://www.w3.org/2000/svg' ? svgElements
          : node.namespaceURI === 'http://www.w3.org/1998/Math/MathML' ? mathElements : undefined
      if (!known?.has(tag)) facts.unknown = true
      if (node.attrs.some(attribute => /^on/i.test(attribute.name)
        || /^javascript:/i.test(attribute.value.replace(/[\u0000-\u0020]/g, '')))) facts.execution = true
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(tree)
  return facts
}

/** The key comes from effective implementation resolution, and data is projected. */
export function webRuntimeTargetProfile(builtinKey: string | undefined, data: unknown): RuntimeTargetProfile {
  if (builtinKey !== 'guoling.web') return 'full'
  const facts = webRuntimeExecutionFacts(data)
  return facts.execution || facts.unknown ? 'full' : 'references'
}

export interface WebModuleResolutionIntrinsics {
  URL: typeof URL
  decodeURI: typeof decodeURI
}

/** This existing path/binding rule is also serialized into the published owner.
 * It closes supplied paths; it performs no file or network read. */
export function createWebModuleResolver(native: WebModuleResolutionIntrinsics): (
  reference: string, importer?: string, scriptSource?: boolean,
  context?: Pick<WebModuleResolutionContext, 'namespace' | 'bindings'>,
) => string | undefined {
  const NativeURL = native.URL, nativeDecodeURI = native.decodeURI
  return (reference, importer = '', scriptSource = false, context) => {
    const binding = context?.bindings[reference]
    if (binding !== undefined) return (context?.namespace ?? '') + binding
    if (!scriptSource && !reference.startsWith('./') && !reference.startsWith('../')) return undefined
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/|\\)/i.test(reference)) return undefined
    const url = new NativeURL(reference, new NativeURL(importer || 'document.html', 'https://guoling.local/'))
    let pathname = url.pathname.slice(1)
    try { pathname = nativeDecodeURI(pathname) } catch { /* A literal percent is a valid supplied filename. */ }
    return (context?.namespace ?? '') + pathname + url.search + url.hash
  }
}

export function webModuleResolverSource(): string {
  return `(${createWebModuleResolver.toString()})`
}

const resolveLocalModulePath = createWebModuleResolver({ URL, decodeURI })
/** Bare imports remain bare unless this document has an actual HTML binding. */
export function localModulePath(reference: string, importer = '', scriptSource = false): string | undefined {
  return resolveLocalModulePath(reference, importer, scriptSource)
}

/** The HTML stays author source; generated inline entry names exist only in this projection. */
export function webModuleCompilationInput(data: WebData): {
  input: ComponentCompilationInput
  entries: Record<string, string>
  documentContexts: Record<string, Pick<WebModuleResolutionContext, 'namespace' | 'bindings'>>
  providedModulePaths: readonly string[]
} | undefined {
  const files: Record<string, string> = Object.create(null), entries: Record<string, string> = Object.create(null)
  const providedModulePaths = new Set<string>()
  const documents: Array<{ path: string; keys: string[]; bindings: Record<string, string> }> = []
  for (const [key, source] of Object.entries(data.modules ?? {})) {
    const normalized = localModulePath(key, '', true) ?? key
    if (Object.hasOwn(files, normalized) && files[normalized] !== source) throw new Error(`本地模块的规范路径重复：${key}`)
    files[normalized] = source
    providedModulePaths.add(normalized)
  }
  const documentEntries = (html: string, documentPath: string) => {
  const htmlModuleBindings: Record<string, string> = Object.create(null), keys: string[] = []
  documents.push({ path: documentPath, keys, bindings: htmlModuleBindings })
  let scriptIndex = 0, iframeIndex = 0
  const parsed = parse(html)
  let documentBase = ''
  const facts = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'base' && !documentBase) {
      const href = node.attrs.find(item => item.name === 'href')?.value
      const path = href && localModulePath(href.endsWith('/') ? `${href}__document.html` : href, '', true)
      if (path) documentBase = path.slice(0, path.lastIndexOf('/'))
    }
    if ('childNodes' in node) node.childNodes.forEach(facts)
  }
  facts(parsed)
  const aliases = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'script' && node.attrs.find(item => item.name === 'type')?.value.trim().toLowerCase() === 'importmap') {
      try {
        const value = JSON.parse(node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join(''))
        for (const [alias, target] of Object.entries(value.imports ?? {})) {
          const path = typeof target === 'string' ? localModulePath(target, documentBase ? `${documentBase}/__document.html` : '', true) : undefined
          if (path) htmlModuleBindings[alias] = path
        }
      } catch { /* The source importer keeps the actual malformed-map diagnostic. */ }
    }
    if ('childNodes' in node) node.childNodes.forEach(aliases)
  }
  aliases(parsed)
  const visit = (node: DefaultTreeAdapterTypes.Node): void => {
    if ('tagName' in node && node.tagName === 'iframe') {
      const index = iframeIndex++, srcdoc = node.attrs.find(item => item.name === 'srcdoc')?.value
      if (srcdoc !== undefined) documentEntries(srcdoc, documentPath ? `${documentPath}/${index}` : String(index))
    }
    if ('tagName' in node && node.tagName === 'script') {
      const index = scriptIndex++
      const entryKey = documentPath ? `${documentPath}:${index}` : String(index)
      const type = node.attrs.find(item => item.name === 'type')?.value.trim().toLowerCase()
      if (type === 'module') {
        keys.push(entryKey)
        const base = node.attrs.find(item => item.name === 'data-guoling-module-base')?.value ?? documentBase
        const importer = base ? `${base}/__document.html` : ''
        const src = node.attrs.find(item => item.name === 'src')?.value
        if (src !== undefined) {
          const path = localModulePath(src, importer, true)
          if (path) entries[entryKey] = path
        } else {
          let name = `${base ? `${base}/` : ''}__html_module_${documentPath.replaceAll('/', '_') || 'root'}_${index}.js`
          const directory = name.slice(0, name.lastIndexOf('/') + 1)
          while (Object.hasOwn(files, name)) name = directory + '_' + name.slice(directory.length)
          files[name] = node.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join('')
          entries[entryKey] = name
        }
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(parsed)
  }
  documentEntries(data.html, '')
  if (!Object.keys(entries).length) return undefined
  const environments = new Map<string, { namespace: string; entries: string[]; bindings: Record<string, string> }>()
  const documentContexts: Record<string, Pick<WebModuleResolutionContext, 'namespace' | 'bindings'>> = Object.create(null)
  for (const document of documents) {
    const entryKeys = document.keys.filter(key => Object.hasOwn(entries, key))
    if (!entryKeys.length) continue
    const identity = JSON.stringify(Object.entries(document.bindings).sort(([a], [b]) => a.localeCompare(b)))
    let environment = environments.get(identity)
    if (!environment) {
      let namespace = environments.size ? `__guoling_parser_doc_${document.path.replaceAll('/', '_') || 'root'}/` : ''
      while (namespace && Object.keys(files).some(path => path.startsWith(namespace))) namespace = `_${namespace}`
      environment = { namespace, entries: [], bindings: document.bindings }
      environments.set(identity, environment)
    }
    for (const key of entryKeys) { environment.entries.push(entries[key]!); entries[key] = environment.namespace + entries[key] }
    documentContexts[document.path] = { namespace: environment.namespace, bindings: environment.bindings }
  }
  const scopes = [...environments.values()], first = scopes[0]!
  return { input: { entry: first.entries[0] ?? Object.keys(files)[0]!, files,
    moduleEntries: scopes.flatMap(scope => scope.entries), ...(scopes.length > 1 ? { htmlModuleDocuments: scopes }
      : Object.keys(first.bindings).length ? { htmlModuleBindings: first.bindings } : {}), options: { preserveModules: true, sourceMap: false } }, entries, documentContexts, providedModulePaths: [...providedModulePaths] }
}

/** Only Published calls this after its normal cached native graph preparation.
 * Provided targets prepare lazily in the same environment, without becoming
 * HTML entries or enlarging the ordinary author's native realm preparation. */
export async function projectPublishedWebRuntimeModules(data: WebRuntimeData,
  compile: (input: ComponentCompilationInput) => Promise<ComponentCompilationResult>,
  report?: (message: string, severity: 'error' | 'warning', issue: ComponentCompilationDiagnostic) => void): Promise<WebRuntimeData> {
  if (!data.moduleGraph) return data
  const source = webModuleCompilationInput(data)
  if (!source?.providedModulePaths.length) return data
  const runtimeRoots: Record<string, readonly string[]> = {}, namespaces = new Set<string>()
  for (const [documentPath, context] of Object.entries(source.documentContexts)) {
    const graph = webModuleGraphForDocument(data.moduleGraph, documentPath)
    if (!graph || !hasUnresolvedRuntimeImport(graph)) continue
    const paths = source.providedModulePaths.map(path => context.namespace + path)
    if (paths.every(path => Object.hasOwn(graph.modules, path))) continue
    runtimeRoots[documentPath] = paths; namespaces.add(context.namespace)
  }
  if (!namespaces.size) return data
  const input = { ...source.input }
  if (input.htmlModuleDocuments) {
    input.htmlModuleDocuments = input.htmlModuleDocuments.map(scope => ({ ...scope,
      entries: namespaces.has(scope.namespace) ? [...new Set([...scope.entries, ...source.providedModulePaths])] : scope.entries }))
    input.moduleEntries = input.htmlModuleDocuments.flatMap(scope => scope.entries)
  } else input.moduleEntries = [...new Set([...(input.moduleEntries ?? [input.entry]), ...source.providedModulePaths])]
  const result = await compile(input)
  const diagnostics = result.status === 'ready' ? result.artifact.diagnostics : result.diagnostics
  diagnostics.forEach(issue => report?.(`${issue.file ? `${issue.file}: ` : ''}${issue.message}`, issue.severity, issue))
  if (result.status !== 'ready' || !result.artifact.modules) return data
  return { ...data, moduleGraph: { ...data.moduleGraph, modules: { ...data.moduleGraph.modules, ...result.artifact.modules },
    runtimeRoots: { ...data.moduleGraph.runtimeRoots, ...runtimeRoots } } }
}

/** Both the Editor and Published producer derive the same native ESM graph through Main's compiler/cache. */
export async function projectWebModuleGraph(instance: ComponentInstance,
  compile: (input: ComponentCompilationInput) => Promise<ComponentCompilationResult>,
  report?: (message: string, severity: 'error' | 'warning', issue: ComponentCompilationDiagnostic) => void): Promise<ComponentInstance> {
  const data = instance.data as WebData
  const prepared = webModuleCompilationInput(data)
  if (!prepared) return instance
  const result = await compile(prepared.input)
  const diagnostics = result.status === 'ready' ? result.artifact.diagnostics : result.diagnostics
  diagnostics.forEach(issue => report?.(`${issue.file ? `${issue.file}: ` : ''}${issue.message}`, issue.severity, issue))
  if (result.status !== 'ready' || !result.artifact.modules) return instance
  return { ...instance, data: { ...data, moduleGraph: { modules: result.artifact.modules, entries: prepared.entries } } as unknown as JsonObject }
}
