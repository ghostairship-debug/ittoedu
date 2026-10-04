import { nanoid } from 'nanoid'
import type { CompositionNode, WebComposition } from '../../shared/composition/content'
import { componentReferenceName, courseComponentNameKey } from '../../shared/composition/projectReferences'
import type { CourseAssetMeta, CourseRuntimeDefinition } from '../../shared/courseProjectTypes'
import { createHtmlDocumentRuntimeSource, unpackHtmlDocumentRuntimeSource } from '../../shared/runtime/htmlDocumentSource'
import { validateRuntimeSource } from '../../shared/runtimeSourceValidation'
import { documentDigest } from '../documents/documentDigest'

export type PageComposition = WebComposition<CourseRuntimeDefinition>
export type PageNode = CompositionNode<CourseRuntimeDefinition>
type ElementNode = Extract<PageNode, { kind: 'element' }>
type LeafNode = Extract<PageNode, { kind: 'document' | 'native' }>
type Bindings = Record<string, { assetId: string }>
type Assets = Readonly<Record<string, CourseAssetMeta>>

export interface PageDiagnostic { level: 'info' | 'warning' | 'error'; code: string; message: string }
export type PageParseResult =
  | { kind: 'composition'; composition: PageComposition; diagnostics: readonly PageDiagnostic[] }
  | { kind: 'program'; html: string; reason: string; diagnostics: readonly PageDiagnostic[] }
/** Main supplies the existing HTML importer parser (`parseWebComposition`); core never reimplements it. */
export type PageParsePort = (input: {
  html: string
  assets?: Readonly<Bindings>
  createEmbeddedRuntime?(html: string): CourseRuntimeDefinition
}) => PageParseResult

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml'
const VOID_ELEMENTS = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
/** The parser never decodes entities in these, so their text is written verbatim (parse5 serializer rules). */
const RAW_TEXT_ELEMENTS = new Set(['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext', 'noscript'])
/** The parser drops one newline right after these start tags. */
const LEADING_NEWLINE_ELEMENTS = new Set(['pre', 'textarea', 'listing'])
/** Professional content is written as JSON inside these wrappers, which parseWebComposition reads back. */
const LEAF_WRAPPERS = new Set(['guoling-native', 'guoling-chart', 'guoling-document'])
const PLACEHOLDER = /cw-resource:([a-zA-Z0-9_.-]+)/g
const HEX_KEY = /^[a-f0-9]{64}$/

const isHtml = (node: ElementNode) => (node.namespace ?? HTML_NAMESPACE) === HTML_NAMESPACE
const isStyle = (node: ElementNode | undefined) => !!node && isHtml(node) && node.tagName === 'style'
const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;')
/** JSON in a script data block: keep the end tag and comment openers inert. */
const scriptJson = (value: unknown) => JSON.stringify(value, null, 2).replace(/<(\/script|!--)/gi, '\\u003c$1')

/** The project file path of a managed asset (`assets/<name>`). */
export function assetFilePath(meta: Pick<CourseAssetMeta, 'path' | 'filename'>): string {
  const path = meta.path.replace(/\\/g, '/').replace(/^\.?\//, '')
  return path.startsWith('assets/') ? path : `assets/${meta.filename}`
}

function embeddedRuntime(node: ElementNode): CourseRuntimeDefinition | undefined {
  const child = node.children.length === 1 ? node.children[0] : undefined
  return isHtml(node) && node.tagName === 'iframe' && child?.kind === 'runtime' ? child.runtime : undefined
}

const componentName = (node: ElementNode) => node.attributes.src === undefined ? null : componentReferenceName(node.attributes.src)

/** A runtime shown as `srcdoc`; component references and other programs stay opaque in the page. */
function srcdocOf(node: ElementNode): string | undefined {
  const runtime = embeddedRuntime(node)
  if (!runtime || componentName(node) !== null) return undefined
  return unpackHtmlDocumentRuntimeSource(runtime.source)?.html
}

/** Remove the ids parseWebComposition registers again (blocks, list items, formulas); table and chart ids stay. */
function documentPayload(content: Extract<PageNode, { kind: 'document' }>['content']): unknown {
  const withoutMathIds = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(withoutMathIds)
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(record).filter(([key]) => !(key === 'formulaId' && record.type === 'math'))
      .map(([key, child]) => [key, withoutMathIds(child)]))
  }
  type Block = (typeof content.blocks)[number]
  const block = (value: Block): unknown => {
    const { id: _id, ...rest } = value as Block & Record<string, unknown>
    if (rest.type === 'formula') delete (rest as Record<string, unknown>).formulaId
    if (rest.type === 'list') return withoutMathIds({ ...rest, items: rest.items.map(({ id: _item, ...item }) => item) })
    if (rest.type === 'section') return withoutMathIds({ ...rest, blocks: rest.blocks.map(block) })
    return withoutMathIds(rest)
  }
  return { ...content, blocks: content.blocks.map(block) }
}

function leafPayload(wrapper: string, node: LeafNode): unknown {
  if (node.kind === 'document') return documentPayload(node.content)
  if (wrapper === 'guoling-chart' && node.content.nativeType === 'chart') {
    const { categories, series, chartType, title, style } = node.content.data
    return { chartType, title, categories: categories.map(category => category.label),
      series: series.map(item => ({ name: item.name, color: item.color,
        values: categories.map(category => item.points.find(point => point.categoryId === category.id)?.value ?? 0) })),
      style }
  }
  return node.content
}

/** Imported content keeps software placeholders; the model reads them as relative paths. */
export function pathMapper(assets: Assets, bindings: Readonly<Bindings>) {
  return (text: string) => text.replace(PLACEHOLDER, (reference, key: string) => {
    const meta = Object.hasOwn(bindings, key) ? assets[bindings[key]!.assetId] : undefined
    return meta ? `../${assetFilePath(meta)}` : reference
  })
}

/** One page's HTML writer. Rendering a subtree is also its identity-free signature. */
function pageRenderer(assets: Assets, bindings: Readonly<Bindings>) {
  const toPaths = pathMapper(assets, bindings)
  const memo = new WeakMap<object, string>()
  const attributes = (node: ElementNode) => Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(toPaths(value))}"`).join('')
  const children = (node: ElementNode) => {
    const raw = isHtml(node) && RAW_TEXT_ELEMENTS.has(node.tagName)
    return node.children.map(child => child.kind === 'text' && raw ? (isStyle(node) ? toPaths(child.text) : child.text) : render(child, node)).join('')
  }
  function render(node: PageNode, parent?: ElementNode): string {
    const cached = memo.get(node)
    if (cached !== undefined) return cached
    let result: string
    if (node.kind === 'text') result = escapeText(node.text)
    else if (node.kind === 'comment') result = `<!--${node.text}-->`
    else if (node.kind === 'runtime') result = ''
    else if (node.kind === 'document' || node.kind === 'native') {
      const wrapper = parent && LEAF_WRAPPERS.has(parent.tagName) ? undefined : node.kind === 'document' ? 'guoling-document' : 'guoling-native'
      const json = `<script type="application/json">${scriptJson(leafPayload(wrapper ?? parent!.tagName, node))}</script>`
      result = wrapper ? `<${wrapper}>${json}</${wrapper}>` : json
    } else if (node.tagName === '#document') result = children(node)
    else {
      const html = isHtml(node), runtime = embeddedRuntime(node), srcdoc = srcdocOf(node)
      const open = `<${node.tagName}${attributes(node)}${srcdoc !== undefined
        ? ` srcdoc="${escapeAttribute(pathMapper(assets, runtime!.assets)(srcdoc))}"` : ''}>`
      const first = node.children[0]
      const newline = html && LEADING_NEWLINE_ELEMENTS.has(node.tagName) && first?.kind === 'text' && first.text.startsWith('\n') ? '\n' : ''
      result = html && VOID_ELEMENTS.has(node.tagName) ? open : `${open}${newline}${runtime ? '' : children(node)}</${node.tagName}>`
    }
    memo.set(node, result)
    return result
  }
  /** Equal signatures mean the same visible page text; a program is compared by its document. */
  function signature(node: PageNode, parent?: ElementNode): string {
    if (node.kind === 'runtime') {
      const payload = unpackHtmlDocumentRuntimeSource(node.runtime.source)
      return payload ? `runtime:${pathMapper(assets, node.runtime.assets)(payload.html)}` : 'runtime'
    }
    if (node.kind === 'text') return `text:${isStyle(parent) ? toPaths(node.text) : node.text}`
    return `${node.kind}:${render(node, parent)}`
  }
  return { render, signature, toPaths }
}

/** The HTML a model reads for one page. Identities, revisions and resource keys never appear in it. */
export function serializePageHtml(content: PageComposition, assets: Assets): string {
  const doctype = content.doctype === undefined ? '' : `${content.doctype.startsWith('<!') ? content.doctype : `<!DOCTYPE ${content.doctype}>`}\n`
  return doctype + pageRenderer(assets, content.assets).render(content.root)
}

/**
 * Relative asset paths inside a software-wrapped HTML program -> its resource placeholders.
 * Page and theme references are not rewritten: normalization binds those slots by path.
 */
export function programPlaceholders(assets: Assets, knownKeys: ReadonlyMap<string, readonly string[]> = new Map()) {
  const byName = new Map<string, string>()
  for (const meta of Object.values(assets)) {
    const name = assetFilePath(meta).slice('assets/'.length)
    byName.set(name, meta.id)
    const encoded = encodeURI(name)
    if (encoded !== name) byName.set(encoded, meta.id)
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = names.length ? new RegExp(`(?<=^|[\\s"'(,=;])(?:\\.{1,2}\\/)*assets\\/(${names.join('|')})(?=$|[\\s"'),;?#&])`, 'g') : null
  /** One stable key per asset: the key the program already used, else a digest the wrapper accepts. */
  const keyOf = (assetId: string) => knownKeys.get(assetId)?.find(key => HEX_KEY.test(key)) ?? documentDigest(assetId)
  return (text: string, bindings: Bindings): string => pattern ? text.replace(pattern, (_reference, name: string) => {
    const assetId = byName.get(name)!, key = keyOf(assetId)
    bindings[key] = { assetId }
    return `cw-resource:${key}`
  }) : text
}

/** A software-wrapped page document; only bound placeholders become runtime assets. */
export function htmlDocumentRuntime(html: string, bindings: Readonly<Bindings>): CourseRuntimeDefinition {
  const resourceKeys = [...new Set([...html.matchAll(PLACEHOLDER)].map(match => match[1]!))].filter(key => Object.hasOwn(bindings, key))
  const source = createHtmlDocumentRuntimeSource({ html, resourceKeys })
  validateRuntimeSource(source)
  return { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom', source,
    content: { values: {} }, assets: Object.fromEntries(resourceKeys.map(key => [key, { assetId: bindings[key]!.assetId }])) }
}

/** The document a model reads for a software-wrapped program, with relative asset paths. */
export function programHtml(runtime: CourseRuntimeDefinition, assets: Assets): string | undefined {
  const payload = unpackHtmlDocumentRuntimeSource(runtime.source)
  return payload ? pathMapper(assets, runtime.assets)(payload.html) : undefined
}

/** Program text written by a model -> a wrapped program; an unchanged text keeps the existing definition. */
export function parseProgramHtml<T extends CourseRuntimeDefinition | Omit<CourseRuntimeDefinition, 'staticFallback' | 'nodeBindings'>>(
  html: string, assets: Assets, previous?: T): T | CourseRuntimeDefinition {
  if (previous && programHtml(previous as CourseRuntimeDefinition, assets) === html) return previous
  const knownKeys = new Map<string, string[]>()
  for (const [key, { assetId }] of Object.entries(previous?.assets ?? {})) knownKeys.set(assetId, [...knownKeys.get(assetId) ?? [], key])
  const own: Bindings = {}
  return htmlDocumentRuntime(programPlaceholders(assets, knownKeys)(html, own), own)
}

/** Index pairs of a longest common subsequence; common ends are taken first so local edits stay cheap. */
function commonPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const pairs: [number, number][] = []
  for (let index = 0; index < start; index++) pairs.push([index, index])
  const n = endA - start, m = endB - start
  if (n && m && n * m <= 1_000_000) {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      table[i]![j] = a[start + i] === b[start + j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[start + i] === b[start + j]) { pairs.push([start + i, start + j]); i++; j++ }
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
      else j++
    }
  } else if (n && m) {
    for (let i = start, j = start; i < endA; i++) {
      const found = b.indexOf(a[i]!, j)
      if (found >= 0 && found < endB) { pairs.push([i, found]); j = found + 1 }
    }
  }
  for (let index = 0; index < a.length - endA; index++) pairs.push([endA + index, endB + index])
  return pairs
}

const shapeOf = (node: PageNode) => node.kind === 'element' ? `element:${node.namespace ?? ''}:${node.tagName}`
  : node.kind === 'native' ? `native:${node.content.nativeType}` : node.kind

export type ParsedPage =
  | { kind: 'composition'; content: PageComposition; diagnostics: readonly PageDiagnostic[] }
  | { kind: 'program'; runtime: CourseRuntimeDefinition; diagnostics: readonly PageDiagnostic[] }

/**
 * Model HTML -> formal page content aligned with what the page held before. Every unchanged subtree is the
 * previous subtree itself (identities, resource keys, programs with their static fallback); a changed node
 * keeps the identity of the node it replaces in place; only new nodes get new identities. New references
 * stay as written; normalization binds asset slots and component copies by name.
 */
export function parsePageHtml(html: string, options: {
  parse: PageParsePort
  assets: Assets
  previous?: PageComposition | CourseRuntimeDefinition
}): ParsedPage {
  const { assets } = options
  const previous = options.previous && 'root' in options.previous ? options.previous : undefined
  const previousProgram = options.previous && !('root' in options.previous) ? options.previous : undefined
  const knownKeys = new Map<string, string[]>()
  const know = (bindings: Readonly<Bindings>) => {
    for (const [key, { assetId }] of Object.entries(bindings)) knownKeys.set(assetId, [...knownKeys.get(assetId) ?? [], key])
  }
  if (previous) {
    know(previous.assets)
    const visit = (node: PageNode) => { if (node.kind === 'runtime') know(node.runtime.assets); if (node.kind === 'element') node.children.forEach(visit) }
    visit(previous.root)
  }
  const toPlaceholders = programPlaceholders(assets, knownKeys)
  const parsed = options.parse({ html, createEmbeddedRuntime: srcdoc => {
    const own: Bindings = {}
    return htmlDocumentRuntime(toPlaceholders(srcdoc, own), own)
  } })
  if (parsed.kind === 'program')
    return { kind: 'program', runtime: parseProgramHtml(parsed.html, assets, previousProgram), diagnostics: parsed.diagnostics }

  const next = pageRenderer(assets, {}), before = pageRenderer(assets, previous?.assets ?? {})
  const adopt = (node: PageNode, prior: PageNode): PageNode => {
    if (node.kind !== 'element' || prior.kind !== 'element') return { ...node, id: prior.id }
    // An unchanged attribute keeps its exact stored value, including which resource key it used.
    const attributes = Object.fromEntries(Object.entries(node.attributes).map(([name, value]) => {
      const old = prior.attributes[name]
      return [name, old !== undefined && before.toPaths(old) === value ? old : value]
    }))
    let children = align(node, prior)
    // A component copy or a program the page cannot show keeps its instance (fallback, bindings) while its name is unchanged.
    if (!children.length && embeddedRuntime(prior) && srcdocOf(prior) === undefined && isHtml(node) && node.tagName === 'iframe') {
      const name = componentName(node), priorName = componentName(prior)
      if (name === null ? priorName === null : priorName !== null && courseComponentNameKey(name) === courseComponentNameKey(priorName)) children = prior.children
    }
    return { ...node, id: prior.id, attributes, children }
  }
  const align = (node: ElementNode, prior: ElementNode): PageNode[] => {
    const result: PageNode[] = new Array(node.children.length)
    const claimed = new Set<number>()
    const authorId = (child: PageNode) => child.kind === 'element' ? child.attributes.id : undefined
    const counts = new Map<string, number>(), oldById = new Map<string, { value: PageNode; index: number }[]>()
    node.children.forEach(child => { const id = authorId(child); if (id) counts.set(id, (counts.get(id) ?? 0) + 1) })
    prior.children.forEach((value, index) => {
      const id = authorId(value)
      if (id) { const candidates = oldById.get(id) ?? []; candidates.push({ value, index }); oldById.set(id, candidates) }
    })
    // Ordinary HTML ids are author anchors, not software bookkeeping. A moved anchor keeps its object identity.
    node.children.forEach((child, index) => {
      const id = authorId(child)
      if (!id || counts.get(id) !== 1) return
      const candidates = (oldById.get(id) ?? []).filter(({ value }) => shapeOf(value) === shapeOf(child))
      if (candidates.length !== 1) return
      const old = candidates[0]!
      result[index] = next.signature(child, node) === before.signature(old.value, prior) ? old.value : adopt(child, old.value)
      claimed.add(old.index)
    })
    const nextSignatures = node.children.map(child => next.signature(child, node))
    const oldSignatures = prior.children.map(child => before.signature(child, prior))
    const nextCounts = new Map<string, number>(), oldMatches = new Map<string, { count: number; index: number }>()
    nextSignatures.forEach(signature => nextCounts.set(signature, (nextCounts.get(signature) ?? 0) + 1))
    oldSignatures.forEach((signature, index) => oldMatches.set(signature, { count: (oldMatches.get(signature)?.count ?? 0) + 1, index }))
    // Unique unchanged subtrees survive movement even when the author supplied no HTML id.
    nextSignatures.forEach((signature, index) => {
      const match = oldMatches.get(signature)
      if (result[index] !== undefined || nextCounts.get(signature) !== 1 || match?.count !== 1 || claimed.has(match.index)) return
      result[index] = prior.children[match.index]!; claimed.add(match.index)
    })
    const pairs = commonPairs(nextSignatures, oldSignatures)
      .filter(([i, j]) => result[i] === undefined && !claimed.has(j))
    for (const [i, j] of pairs) result[i] = prior.children[j]!
    const bounds: [number, number][] = [[-1, -1], ...pairs, [node.children.length, prior.children.length]]
    for (let gap = 0; gap + 1 < bounds.length; gap++) {
      const [fromI, fromJ] = bounds[gap]!, [toI, toJ] = bounds[gap + 1]!
      const open = prior.children.slice(fromJ + 1, toJ).filter((_value, index) => !claimed.has(fromJ + 1 + index))
      for (let i = fromI + 1; i < toI; i++) {
        if (result[i] !== undefined) continue
        const child = node.children[i]!
        const match = open.findIndex(candidate => shapeOf(candidate) === shapeOf(child))
        result[i] = match >= 0 ? adopt(child, open.splice(match, 1)[0]!) : child
      }
    }
    return result
  }
  const aligned = previous && shapeOf(previous.root) === shapeOf(parsed.composition.root) ? adopt(parsed.composition.root, previous.root) : parsed.composition.root
  const ids = new Set<string>()
  const unique = (node: PageNode): PageNode => {
    // Parser identities never collide with kept ones; stay unique regardless.
    const value = ids.has(node.id) ? { ...node, id: `web_${nanoid()}` } : node
    ids.add(value.id)
    return value.kind === 'element' ? { ...value, children: value.children.map(unique) } : value
  }
  const doctypeName = (value: string) => value.replace(/^<!doctype/i, '').replace(/>$/, '').trim().toLowerCase()
  const doctype = parsed.composition.doctype !== undefined && previous?.doctype !== undefined
    && doctypeName(parsed.composition.doctype) === doctypeName(previous.doctype) ? previous.doctype : parsed.composition.doctype
  return { kind: 'composition', content: { ...(doctype !== undefined ? { doctype } : {}), root: unique(aligned), assets: { ...previous?.assets } },
    diagnostics: parsed.diagnostics }
}
