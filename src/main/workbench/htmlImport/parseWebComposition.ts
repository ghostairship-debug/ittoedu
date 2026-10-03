import { randomUUID } from 'node:crypto'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { parse as parseJavaScript } from 'acorn'
import { z } from 'zod'
import { createChartNode } from '../../../core/tools/nativeNodeFactories'
import { nativeElementContentSchema } from '../../../shared/contracts/course-project-v9/schema'
import { documentContentSchema } from '../../../shared/document/content'
import { walkComposition, type CompositionNode, type WebComposition } from '../../../shared/composition/content'
import type { ImportDiagnostic } from './types'

type HtmlNode = DefaultTreeAdapterTypes.ChildNode
type HtmlElement = DefaultTreeAdapterTypes.Element
export type ParseWebCompositionDiagnostic = ImportDiagnostic
export type WebCompositionProgramReason = 'script' | 'event-handler' | 'embedded-document'
export interface ParseWebCompositionInput<TRuntime = never> {
  /** HTML after the existing source-closure/resource extraction step. */
  html: string
  assets?: Readonly<Record<string, { assetId: string }>>
  previous?: WebComposition<TRuntime>
  /** Software-owned packing of an explicit independent iframe document. */
  createEmbeddedRuntime?(html: string): TRuntime
}
export type ParseWebCompositionResult<TRuntime = never> =
  | { kind: 'composition'; composition: WebComposition<TRuntime>; diagnostics: ParseWebCompositionDiagnostic[] }
  | { kind: 'program'; html: string; reason: WebCompositionProgramReason; diagnostics: ParseWebCompositionDiagnostic[] }

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const newId = () => `web_${randomUUID()}`
const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node
function childrenOf(node: HtmlElement): HtmlNode[] {
  return node.tagName === 'template' && 'content' in node
    ? (node as DefaultTreeAdapterTypes.Template).content.childNodes
    : node.childNodes
}
function attr(node: HtmlElement, name: string): string | undefined {
  return node.attrs.find(value => value.name === name)?.value
}

/** A declared iframe boundary is usable without guessing or rewriting its program.
 * Explicit access to an outer document and inaccessible sandbox documents stay whole. */
function canIsolateEmbeddedDocument(node: HtmlElement): boolean {
  const sandbox = attr(node, 'sandbox')
  if (sandbox !== undefined && !['allow-same-origin', 'allow-scripts'].every(value => sandbox.toLowerCase().split(/\s+/).includes(value))) return false
  const refersOutside = (code: string, module = false): boolean => {
    let syntax: unknown
    try { syntax = parseJavaScript(code, { ecmaVersion: 'latest', sourceType: module ? 'module' : 'script', allowReturnOutsideFunction: true }) }
    catch { return true }
    const isScope = (value: Record<string, unknown>) => ['Program', 'BlockStatement', 'CatchClause', 'ForStatement', 'ForInStatement', 'ForOfStatement'].includes(String(value.type)) || /Function/.test(String(value.type))
    const declaredHere = (scope: Record<string, unknown>) => {
      const names = new Set<string>()
      const pattern = (value: unknown): void => {
        if (!isRecord(value)) return
        if (value.type === 'Identifier') names.add(String(value.name))
        else if (value.type === 'ObjectPattern' && Array.isArray(value.properties)) value.properties.forEach(property => {
          if (isRecord(property)) pattern(property.type === 'RestElement' ? property.argument : property.value)
        })
        else if (value.type === 'ArrayPattern' && Array.isArray(value.elements)) value.elements.forEach(pattern)
        else if (value.type === 'RestElement') pattern(value.argument)
        else if (value.type === 'AssignmentPattern') pattern(value.left)
      }
      const scan = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(scan); return }
        if (!isRecord(value)) return
        if (value.type === 'FunctionDeclaration' || value.type === 'ClassDeclaration') { pattern(value.id); return }
        if (isScope(value)) return
        if (value.type === 'VariableDeclarator') pattern(value.id)
        if (value.type === 'ImportDeclaration' && Array.isArray(value.specifiers)) value.specifiers.forEach(specifier => { if (isRecord(specifier)) pattern(specifier.local) })
        Object.values(value).forEach(scan)
      }
      if (Array.isArray(scope.params)) scope.params.forEach(pattern)
      pattern(scope.param)
      if (/Function/.test(String(scope.type))) pattern(scope.id)
      if (Array.isArray(scope.body)) scope.body.forEach(scan)
      if (isRecord(scope.body) && scope.body.type === 'BlockStatement' && Array.isArray(scope.body.body)) scope.body.body.forEach(scan)
      scan(scope.init); scan(scope.left)
      return names
    }
    const visit = (value: unknown, parent?: Record<string, unknown>, key?: string, scopes: readonly Set<string>[] = []): boolean => {
      if (Array.isArray(value)) return value.some(child => visit(child, parent, key, scopes))
      if (!isRecord(value)) return false
      if (isScope(value)) scopes = [...scopes, declaredHere(value)]
      const bound = (name: unknown) => scopes.some(scope => scope.has(String(name)))
      if (value.type === 'MemberExpression' && isRecord(value.object) && isRecord(value.property)
        && value.object.type === 'Identifier' && ['window', 'self', 'globalThis'].includes(String(value.object.name))
        && !bound(value.object.name)
        && ['parent', 'top', 'frameElement'].includes(String(value.computed ? value.property.value : value.property.name))) return true
      if (value.type === 'Identifier' && ['parent', 'top', 'frameElement'].includes(String(value.name))
        && !bound(value.name)
        && !(parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)
        && !(key === 'key' && !parent?.computed)
        && !(key === 'id' || key === 'params')) return true
      return Object.entries(value).some(([childKey, child]) => visit(child, value, childKey, scopes))
    }
    return visit(syntax)
  }
  const visitHtml = (nodes: readonly HtmlNode[]): boolean => nodes.some(child => {
    if (!isElement(child) || child.tagName === 'template') return false
    if (child.attrs.some(value => /^on[a-z]/i.test(value.name) && refersOutside(value.value))) return true
    if (child.tagName === 'script') {
      const type = (attr(child, 'type') ?? '').toLowerCase()
      if (!type || type === 'module' || /(?:java|ecma)script/.test(type)) {
        const code = childrenOf(child).map(node => node.nodeName === '#text' ? (node as DefaultTreeAdapterTypes.TextNode).value : '').join('')
        if (refersOutside(code, type === 'module')) return true
      }
    }
    return visitHtml(childrenOf(child))
  })
  return !visitHtml(parse(attr(node, 'srcdoc') ?? '').childNodes)
}

function programReason(nodes: readonly HtmlNode[], isolateEmbeddedDocuments = false): WebCompositionProgramReason | undefined {
  for (const node of nodes) {
    if (!isElement(node)) continue
    // A template's contents are inert until a program instantiates them.
    if (node.namespaceURI === HTML_NAMESPACE && node.tagName === 'template') continue
    if (node.tagName === 'script') {
      const type = (attr(node, 'type') ?? '').trim().toLowerCase().split(';')[0]!.trim()
      if (!type || type === 'module' || type === 'importmap' || type === 'speculationrules'
        || /^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:1\.[0-5])?$/.test(type)
        || type === 'text/jscript' || type === 'text/livescript') return 'script'
    }
    if (node.attrs.some(value => /^on[a-z]/i.test(value.name)
      || /^(?:href|src|action|formaction)$/i.test(value.name) && /^javascript:/i.test(value.value.trim().replace(/[\t\r\n]/g, '')))) return 'event-handler'
    const srcdoc = attr(node, 'srcdoc')
    if (node.tagName === 'iframe' && srcdoc !== undefined) {
      if (isolateEmbeddedDocuments ? !canIsolateEmbeddedDocument(node) : programReason(parse(srcdoc).childNodes)) return 'embedded-document'
    }
    const childReason = programReason(childrenOf(node), isolateEmbeddedDocuments)
    if (childReason) return childReason
  }
  return undefined
}

const chartExpressionSchema = z.object({
  chartType: z.enum(['bar', 'line', 'area', 'pie', 'donut']).optional(),
  title: z.string().optional(),
  categories: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string(), color: z.string().optional(), values: z.array(z.number().finite()) }).strict()).min(1),
  style: z.record(z.string(), z.unknown()).optional(),
}).strict()

/** The short chart expression contains data, never category/series/point bookkeeping. */
function chartContent(value: unknown, allocateId: () => string) {
  const expression = chartExpressionSchema.parse(value)
  const categories = expression.categories.map(label => ({ id: allocateId(), label }))
  const series = expression.series.map(series => ({
    id: allocateId(), name: series.name, color: series.color ?? '#2563eb',
    points: series.values.map((value, index) => ({ id: allocateId(), categoryId: categories[index]?.id ?? '', value })),
  }))
  const node = createChartNode({ ...expression, categories, series })
  return nativeElementContentSchema.parse({ nativeType: 'chart', data: {
    chartType: node.chartType, title: node.title, categories: node.categories, series: node.series, style: node.style,
  } })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Register unnumbered ordinary document blocks; the formal schema still owns validation. */
function registerDocumentIds(value: unknown, allocateId: () => string): unknown {
  if (!isRecord(value)) return value
  const result = structuredClone(value)
  const registerInlineMath = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(registerInlineMath)
    else if (isRecord(value)) {
      if (value.type === 'math' && value.formulaId === undefined) value.formulaId = allocateId()
      Object.values(value).forEach(registerInlineMath)
    }
  }
  const registerBlocks = (blocks: unknown): void => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (!isRecord(block)) continue
      if (block.id === undefined) block.id = allocateId()
      if (block.type === 'formula' && block.formulaId === undefined) block.formulaId = allocateId()
      if (block.type === 'list' && Array.isArray(block.items)) {
        for (const item of block.items) if (isRecord(item) && item.id === undefined) item.id = allocateId()
      }
      if (block.type === 'section') registerBlocks(block.blocks)
    }
  }
  registerBlocks(result.blocks)
  registerInlineMath(result)
  return result
}

function componentValue(node: HtmlElement): unknown {
  const children = childrenOf(node).filter(child => child.nodeName !== '#comment'
    && !(child.nodeName === '#text' && !(child as DefaultTreeAdapterTypes.TextNode).value.trim()))
  if (children.length === 1 && isElement(children[0]!) && children[0]!.tagName === 'script'
    && attr(children[0]!, 'type')?.trim().toLowerCase() === 'application/json') {
    return JSON.parse(childrenOf(children[0]!).map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterTypes.TextNode).value : '').join(''))
  }
  if (children.some(child => child.nodeName !== '#text')) throw new Error('组件内容须为 JSON 文本或 application/json 数据块')
  return JSON.parse(children.map(child => (child as DefaultTreeAdapterTypes.TextNode).value).join(''))
}

function convertNode<TRuntime>(node: HtmlNode, diagnostics: ImportDiagnostic[], allocateId: () => string,
  createEmbeddedRuntime?: (html: string) => TRuntime): CompositionNode<TRuntime> | undefined {
  if (node.nodeName === '#text') return { id: newId(), kind: 'text', text: (node as DefaultTreeAdapterTypes.TextNode).value }
  if (node.nodeName === '#comment') return { id: newId(), kind: 'comment', text: (node as DefaultTreeAdapterTypes.CommentNode).data }
  if (!isElement(node)) return undefined
  const result: Extract<CompositionNode<TRuntime>, { kind: 'element' }> = {
    id: newId(), kind: 'element', tagName: node.tagName,
    ...(node.namespaceURI !== HTML_NAMESPACE ? { namespace: node.namespaceURI } : {}),
    attributes: Object.fromEntries(node.attrs.map(value => [value.prefix ? `${value.prefix}:${value.name}` : value.name, value.value])),
    children: [],
  }
  const srcdoc = attr(node, 'srcdoc')
  if (node.namespaceURI === HTML_NAMESPACE && node.tagName === 'iframe' && srcdoc !== undefined && createEmbeddedRuntime) {
    delete result.attributes.src
    delete result.attributes.srcdoc
    result.children = [{ id: newId(), kind: 'runtime', runtime: createEmbeddedRuntime(srcdoc) }]
    return result
  }
  if (node.namespaceURI === HTML_NAMESPACE && ['guoling-native', 'guoling-chart', 'guoling-document'].includes(node.tagName)) {
    try {
      const value = componentValue(node)
      result.children = [node.tagName === 'guoling-document'
        ? { id: newId(), kind: 'document', content: documentContentSchema.parse(registerDocumentIds(value, allocateId)) }
        : { id: newId(), kind: 'native', content: node.tagName === 'guoling-chart' ? chartContent(value, allocateId) : nativeElementContentSchema.parse(value) }]
      return result
    } catch (error) {
      diagnostics.push({ level: 'warning', code: 'web-component-content', message: `${node.tagName} 未能建立专业组件，已保留原始 HTML 内容：${error instanceof Error ? error.message : String(error)}` })
    }
  }
  result.children = childrenOf(node).flatMap(child => {
    const converted = convertNode<TRuntime>(child, diagnostics, allocateId, createEmbeddedRuntime)
    return converted ? [converted] : []
  })
  return result
}

function shape<TRuntime>(node: CompositionNode<TRuntime>): string {
  return node.kind === 'element' ? JSON.stringify([node.kind, node.namespace ?? HTML_NAMESPACE, node.tagName, node.attributes.id ?? ''])
    : node.kind === 'native' ? `${node.kind}:${node.content.nativeType}` : node.kind
}

/** Reuse known identities, not guessed offsets after insertions or repeated sibling changes. */
function reconcileIds<TRuntime>(next: CompositionNode<TRuntime>, previous: CompositionNode<TRuntime>, generatedContentIds: ReadonlySet<string>): void {
  const oldIds = new Set<string>()
  const signatures = new WeakMap<object, string>()
  const signature = (node: CompositionNode<TRuntime>): string => {
    const cached = signatures.get(node)
    if (cached !== undefined) return cached
    const value = node.kind === 'element'
      ? [shape(node), Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b)), node.children.map(signature)]
      : node.kind === 'text' || node.kind === 'comment' ? [node.kind, node.text]
        : node.kind === 'runtime' ? [node.kind, node.runtime] : [node.kind, node.content]
    const result = JSON.stringify(value)
    signatures.set(node, result)
    return result
  }
  const unique = (nodes: readonly CompositionNode<TRuntime>[], key: (node: CompositionNode<TRuntime>) => string) => {
    const result = new Map<string, CompositionNode<TRuntime> | null>()
    nodes.forEach(node => { const id = key(node); result.set(id, result.has(id) ? null : node) })
    return result
  }
  const newNodes: CompositionNode<TRuntime>[] = []
  const oldNodes: CompositionNode<TRuntime>[] = []
  walkComposition(next, node => newNodes.push(node))
  walkComposition(previous, node => oldNodes.push(node))
  const keyed = (nodes: CompositionNode<TRuntime>[]) => unique(nodes.filter(node => node.kind === 'element' && node.attributes.id), shape)
  const oldKeys = keyed(oldNodes)
  const newKeys = keyed(newNodes)
  const explicit = new Map<CompositionNode<TRuntime>, CompositionNode<TRuntime>>()
  const reserved = new Set<CompositionNode<TRuntime>>()
  for (const [key, node] of newKeys) {
    const prior = oldKeys.get(key)
    if (node && prior) { explicit.set(node, prior); reserved.add(prior) }
  }
  const reuse = (node: CompositionNode<TRuntime>, prior?: CompositionNode<TRuntime>): void => {
    prior = explicit.get(node) ?? prior
    if (prior && shape(node) === shape(prior) && !oldIds.has(prior.id)) {
      node.id = prior.id
      oldIds.add(prior.id)
      if ((node.kind === 'document' && prior.kind === 'document') || (node.kind === 'native' && prior.kind === 'native')) {
        reconcileContentIds(node.content, prior.content, generatedContentIds)
      }
    } else prior = undefined
    if (node.kind !== 'element') return
    const oldChildren = prior?.kind === 'element' ? prior.children : []
    const matches = new Map<CompositionNode<TRuntime>, CompositionNode<TRuntime>>()
    const claimed = new Set<CompositionNode<TRuntime>>()
    if (node.children.length === oldChildren.length && node.children.every((child, index) => signature(child) === signature(oldChildren[index]!))) {
      node.children.forEach((child, index) => { matches.set(child, oldChildren[index]!); claimed.add(oldChildren[index]!) })
    } else {
      for (const key of [signature, shape]) {
        const remainingNew = node.children.filter(child => !matches.has(child) && !explicit.has(child))
        const remainingOld = oldChildren.filter(child => !claimed.has(child) && !reserved.has(child) && !oldIds.has(child.id))
        const oldByKey = unique(remainingOld, key)
        for (const [value, child] of unique(remainingNew, key)) {
          const old = oldByKey.get(value)
          if (child && old) { matches.set(child, old); claimed.add(old) }
        }
      }
    }
    node.children.forEach(child => reuse(child, matches.get(child)))
  }
  reuse(next, previous)
}

/** Component data uses its own formal IDs too; only IDs allocated by this parse may be remapped. */
function reconcileContentIds(next: unknown, previous: unknown, generated: ReadonlySet<string>): void {
  const remapped = new Map<string, string>()
  const normalized = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalized)
    if (!isRecord(value)) return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id' && key !== 'formulaId').map(([key, child]) => [
      key, key === 'categoryId' && typeof child === 'string' ? remapped.get(child) ?? child : normalized(child),
    ]))
  }
  const signature = (value: unknown) => JSON.stringify(normalized(value))
  const semanticKey = (value: unknown) => {
    if (!isRecord(value)) return typeof value
    return JSON.stringify([value.type ?? value.nativeType ?? value.chartType ?? '', value.level ?? '', value.label ?? value.name
      ?? (typeof value.categoryId === 'string' ? remapped.get(value.categoryId) ?? value.categoryId : '')])
  }
  const visit = (current: unknown, old: unknown): void => {
    if (Array.isArray(current) && Array.isArray(old)) {
      if (signature(current) === signature(old)) { current.forEach((child, index) => visit(child, old[index])); return }
      const matched = new Set<number>()
      const used = new Set<number>()
      for (const key of [signature, semanticKey]) {
        const newKeys = current.map(key)
        const oldKeys = old.map(key)
        current.forEach((child, index) => {
          if (matched.has(index)) return
          const value = newKeys[index]
          if (newKeys.filter((item, i) => !matched.has(i) && item === value).length !== 1) return
          const candidates = oldKeys.flatMap((item, i) => !used.has(i) && item === value ? [i] : [])
          if (candidates.length !== 1) return
          matched.add(index); used.add(candidates[0]!); visit(child, old[candidates[0]!])
        })
      }
      return
    }
    if (!isRecord(current) || !isRecord(old)) return
    for (const key of ['id', 'formulaId']) {
      const id = current[key]
      if (typeof id === 'string' && generated.has(id) && typeof old[key] === 'string') {
        remapped.set(id, old[key]); current[key] = old[key]
      }
    }
    for (const [key, child] of Object.entries(current)) {
      if (key === 'categoryId' && typeof child === 'string') current[key] = remapped.get(child) ?? child
      else if (key !== 'id' && key !== 'formulaId') visit(child, old[key])
    }
  }
  visit(next, previous)
}

/** No file reads, resource platform, source execution, or author-supplied registration markers. */
export function parseWebComposition<TRuntime = never>(input: ParseWebCompositionInput<TRuntime>): ParseWebCompositionResult<TRuntime> {
  const parsed = parse(input.html, { sourceCodeLocationInfo: true })
  const reason = programReason(parsed.childNodes, Boolean(input.createEmbeddedRuntime))
  if (reason) return { kind: 'program', html: input.html, reason, diagnostics: [{
    level: 'info', code: 'web-composition-program', message: 'HTML 含程序行为，保留完整源码交由现有 Runtime 运行。',
  }] }
  const diagnostics: ImportDiagnostic[] = []
  const generatedContentIds = new Set<string>()
  const allocateContentId = () => { const id = newId(); generatedContentIds.add(id); return id }
  const root: CompositionNode<TRuntime> = { id: newId(), kind: 'element', tagName: '#document', attributes: {}, children: parsed.childNodes.flatMap(node => {
    const converted = convertNode<TRuntime>(node, diagnostics, allocateContentId, input.createEmbeddedRuntime)
    return converted ? [converted] : []
  }) }
  if (input.previous) reconcileIds(root, input.previous.root, generatedContentIds)
  const doctypeNode = parsed.childNodes.find(node => node.nodeName === '#documentType')
  const location = doctypeNode?.sourceCodeLocation
  const doctype = location ? input.html.slice(location.startOffset, location.endOffset) : undefined
  return { kind: 'composition', composition: {
    ...(doctype !== undefined ? { doctype } : {}), root,
    assets: Object.fromEntries(Object.entries(input.assets ?? {}).map(([key, value]) => [key, { assetId: value.assetId }])),
  }, diagnostics }
}
