import { nanoid } from 'nanoid'
import type { CompositionNode, WebComposition } from '../../shared/composition/content'
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
const COMPONENT_REFERENCE = /^(?:\.{1,2}\/)*components\/([^/?#]+)\.html$/

const isHtml = (node: ElementNode) => (node.namespace ?? HTML_NAMESPACE) === HTML_NAMESPACE
const isStyle = (node: ElementNode | undefined) => !!node && isHtml(node) && node.tagName === 'style'
const escapeText = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;')
/** JSON in a script data block: keep the end tag and comment openers inert. */
const scriptJson = (value: unknown) => JSON.stringify(value, null, 2).replace(/<(\/script|!--)/gi, '\\u003c$1')

/** The project file path of a managed asset (`assets/<name>`). */
export function assetFilePath(meta: Pick<CourseAssetMeta, 'path' | 'filename'>): string {
  const path = meta.path.replace(/^\.?\//, '')
  return path.startsWith('assets/') ? path : `assets/${meta.filename}`
}

/** Component name of an `<iframe src="../components/<name>.html">` reference. */
export function componentReferenceName(src: string | undefined): string | undefined {
  const match = src === undefined ? null : COMPONENT_REFERENCE.exec(src.trim())
  if (!match) return undefined
  try { return decodeURIComponent(match[1]!) } catch { return match[1]! }
}

function embeddedRuntime(node: ElementNode): CourseRuntimeDefinition | undefined {
  const child = node.children.length === 1 ? node.children[0] : undefined
  return isHtml(node) && node.tagName === 'iframe' && child?.kind === 'runtime' ? child.runtime : undefined
}

/** A runtime shown as `srcdoc`; component references and other programs stay opaque in the page. */
function srcdocOf(node: ElementNode): string | undefined {
  const runtime = embeddedRuntime(node)
  if (!runtime || componentReferenceName(node.attributes.src) !== undefined) return undefined
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

/** Placeholder form -> the relative paths a model reads; keys never leave the software. */
function pathMapper(assets: Assets, bindings: Readonly<Bindings>) {
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

/** Relative asset paths in a model's text -> software placeholders. Only known assets are bound. */
function placeholderMapper(assets: Assets, knownKeys: ReadonlyMap<string, readonly string[]>) {
  const byName = new Map<string, string>()
  for (const meta of Object.values(assets)) {
    const name = assetFilePath(meta).slice('assets/'.length)
    byName.set(name, meta.id)
    const encoded = encodeURI(name)
    if (encoded !== name) byName.set(encoded, meta.id)
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = names.length ? new RegExp(`(?<=^|[\\s"'(,=;])(?:\\.{1,2}\\/)*assets\\/(${names.join('|')})(?=$|[\\s"'),;?#&])`, 'g') : null
  /** One stable key per asset: the key the content already used, else a digest the html runtime also accepts. */
  const keyOf = (assetId: string, hexOnly: boolean) => knownKeys.get(assetId)?.find(key => !hexOnly || HEX_KEY.test(key)) ?? documentDigest(assetId)
  return (text: string, bindings: Bindings, hexOnly = false): string => pattern ? text.replace(pattern, (_reference, name: string) => {
    const assetId = byName.get(name)!, key = keyOf(assetId, hexOnly)
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
  | { kind: 'composition'; content: PageComposition; changedRuntimes: number; diagnostics: readonly PageDiagnostic[] }
  | { kind: 'program'; runtime: CourseRuntimeDefinition; changed: boolean; diagnostics: readonly PageDiagnostic[] }

/**
 * Model HTML -> formal page content aligned with what the page held before. Every unchanged subtree is the
 * previous subtree itself (identities, resource keys, admitted programs with their static fallback); a changed
 * node keeps the identity of the node it replaces in place; only new nodes get new identities.
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
  const previousRuntimes = new Set<CourseRuntimeDefinition>()
  if (previous) {
    know(previous.assets)
    const visit = (node: PageNode) => {
      if (node.kind === 'runtime') { know(node.runtime.assets); previousRuntimes.add(node.runtime) }
      if (node.kind === 'element') node.children.forEach(visit)
    }
    visit(previous.root)
  }
  if (previousProgram) know(previousProgram.assets)
  const toPlaceholders = placeholderMapper(assets, knownKeys)
  const parsed = options.parse({ html, createEmbeddedRuntime: srcdoc => {
    const own: Bindings = {}
    return htmlDocumentRuntime(toPlaceholders(srcdoc, own, true), own)
  } })

  if (parsed.kind === 'program') {
    const prior = previousProgram && unpackHtmlDocumentRuntimeSource(previousProgram.source)
    if (prior && pathMapper(assets, previousProgram!.assets)(prior.html) === parsed.html)
      return { kind: 'program', runtime: previousProgram!, changed: false, diagnostics: parsed.diagnostics }
    const own: Bindings = {}
    return { kind: 'program', runtime: htmlDocumentRuntime(toPlaceholders(parsed.html, own, true), own), changed: true, diagnostics: parsed.diagnostics }
  }

  const bindings: Bindings = { ...previous?.assets }
  const next = pageRenderer(assets, {}), before = pageRenderer(assets, previous?.assets ?? {})
  /** New content: placeholders for known assets in attributes and style text; parser identities kept. */
  const fresh = (node: PageNode, parent?: ElementNode): PageNode => {
    if (node.kind === 'text') return isStyle(parent) ? { ...node, text: toPlaceholders(node.text, bindings) } : node
    if (node.kind !== 'element') return node
    return { ...node, attributes: Object.fromEntries(Object.entries(node.attributes).map(([name, value]) => [name, toPlaceholders(value, bindings)])),
      children: node.children.map(child => fresh(child, node)) }
  }
  const adopt = (node: PageNode, prior: PageNode, parent?: ElementNode): PageNode => {
    if (node.kind !== 'element' || prior.kind !== 'element') return { ...fresh(node, parent), id: prior.id }
    // An unchanged attribute keeps its exact stored value, including which resource key it used.
    const attributes = Object.fromEntries(Object.entries(node.attributes).map(([name, value]) => {
      const old = prior.attributes[name]
      return [name, old !== undefined && before.toPaths(old) === value ? old : toPlaceholders(value, bindings)]
    }))
    return { ...node, id: prior.id, attributes, children: align(node, prior) }
  }
  const align = (node: ElementNode, prior: ElementNode): PageNode[] => {
    const pairs = commonPairs(node.children.map(child => next.signature(child, node)), prior.children.map(child => before.signature(child, prior)))
    const result: PageNode[] = new Array(node.children.length)
    for (const [i, j] of pairs) result[i] = prior.children[j]!
    const bounds: [number, number][] = [[-1, -1], ...pairs, [node.children.length, prior.children.length]]
    for (let gap = 0; gap + 1 < bounds.length; gap++) {
      const [fromI, fromJ] = bounds[gap]!, [toI, toJ] = bounds[gap + 1]!
      const open = prior.children.slice(fromJ + 1, toJ)
      for (let i = fromI + 1; i < toI; i++) {
        const child = node.children[i]!
        const match = open.findIndex(candidate => shapeOf(candidate) === shapeOf(child))
        result[i] = match >= 0 ? adopt(child, open.splice(match, 1)[0]!, node) : fresh(child, node)
      }
    }
    return result
  }
  const aligned = previous && shapeOf(previous.root) === shapeOf(parsed.composition.root)
    ? adopt(parsed.composition.root, previous.root) : fresh(parsed.composition.root)
  let changedRuntimes = 0
  const ids = new Set<string>()
  const finish = (node: PageNode): PageNode => {
    if (node.kind === 'runtime' && !previousRuntimes.has(node.runtime)) changedRuntimes++
    // Parser identities never collide with kept ones; stay unique regardless.
    const unique = ids.has(node.id) ? { ...node, id: `web_${nanoid()}` } : node
    ids.add(unique.id)
    return unique.kind === 'element' ? { ...unique, children: unique.children.map(finish) } : unique
  }
  const root = finish(aligned)
  const doctypeName = (value: string) => value.replace(/^<!doctype/i, '').replace(/>$/, '').trim().toLowerCase()
  const doctype = parsed.composition.doctype !== undefined && previous?.doctype !== undefined
    && doctypeName(parsed.composition.doctype) === doctypeName(previous.doctype) ? previous.doctype : parsed.composition.doctype
  return { kind: 'composition', content: { ...(doctype !== undefined ? { doctype } : {}), root, assets: bindings },
    changedRuntimes, diagnostics: parsed.diagnostics }
}
