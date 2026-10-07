import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import {
  decodeHtmlEntities, indexHtmlElements, scanHtmlSource,
  type HtmlElementIndexEntry, type HtmlSourceToken,
} from '../../../shared/html/htmlSourceScanner'
import type {
  HtmlPreviewResolvedTarget, HtmlPreviewSourceLocator,
} from '../../../shared/workbench/htmlPreview'
import { htmlPreviewTargetReportSchema } from '../../../shared/workbench/htmlPreview'
import type { z } from 'zod'
import type { ComponentAuthorRecord } from '../../../shared/contracts/component-platform/runtime'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>

export interface HtmlSourceIdentity {
  documentId: string
  epoch: string
  revision: number
  bindingVersion: number
}

type Failure = Extract<HtmlPreviewResolvedTarget, { status: 'not-editable' }>['reason']

type RenderedElement = {
  name: string
  sourceIndex: number | null
  children: RenderedElement[]
  parent: RenderedElement | null
}

function rendered(name: string, sourceIndex: number | null, parent: RenderedElement | null): RenderedElement {
  return { name, sourceIndex, children: [], parent }
}

/** Reuse the HTML parser's tree and exact source locations. Unsupported siblings
 * do not invalidate another element, and implicit wrappers keep browser child indices. */
function renderedSourceTree(
  source: string, _tokens: readonly HtmlSourceToken[], elements: readonly HtmlElementIndexEntry[],
): RenderedElement | null {
  const document = parse(source, { sourceCodeLocationInfo: true })
  const byStart = new Map(elements.map((element, index) => [element.startTag.start, index]))
  const build = (element: DefaultTreeAdapterTypes.Element, parent: RenderedElement | null): RenderedElement => {
    const location = element.sourceCodeLocation
    const at = location?.startTag ? byStart.get(location.startTag.startOffset) : undefined
    const lexical = at === undefined ? undefined : elements[at]
    const proven = lexical && location && lexical.name.toLowerCase() === element.tagName.toLowerCase()
      && lexical.full.start === location.startOffset && lexical.full.end === location.endOffset
    const node = rendered(element.tagName.toLowerCase(), proven ? at! : null, parent)
    // template.content is a separate DocumentFragment, not Element.children.
    for (const child of element.childNodes) if ('tagName' in child) node.children.push(build(child, node))
    return node
  }
  const html = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'html')
  return html ? build(html, null) : null
}

function pathToSource(root: RenderedElement, path: readonly { name: string; index: number }[]): RenderedElement | null {
  if (path.length === 0 || path[0]!.name.toLowerCase() !== 'html' || path[0]!.index !== 0) return null
  let current = root
  for (const step of path.slice(1)) {
    const next = current.children[step.index]
    if (!next || next.name !== step.name.toLowerCase()) return null
    current = next
  }
  return current.sourceIndex === null ? null : current
}

function renderedSectionOrder(node: RenderedElement): number | null {
  let section: RenderedElement | null = node
  while (section && section.name !== 'section') section = section.parent
  if (!section?.parent) return null
  const parent = section.parent
  if (parent.name !== 'body' && !(parent.name === 'main' && parent.parent?.name === 'body')) return null
  return parent.children.filter(child => child.name === 'section').indexOf(section)
}

function rejection(handle: string, reason: Failure): HtmlPreviewResolvedTarget {
  return { handle, status: 'not-editable', reason }
}

function directTextTokens(
  tokens: readonly HtmlSourceToken[], element: HtmlElementIndexEntry,
  children: readonly HtmlElementIndexEntry[],
): HtmlSourceToken[] {
  return tokens.filter(token => token.kind === 'text'
    && token.span.start >= element.content.start && token.span.end <= element.content.end
    && !children.some(child => token.span.start >= child.full.start && token.span.end <= child.full.end))
}

/** Locate an exact source span. DOM handles and DOM paths are evidence, never persistent identities. */
export function locateHtmlSourceTarget(
  source: string, report: HtmlPreviewTargetReport, identity: HtmlSourceIdentity,
): HtmlPreviewResolvedTarget {
  if (report.scriptCreated) return rejection(report.handle, 'script-created')
  const scan = scanHtmlSource(source)
  if (scan.diagnostics.length) return rejection(report.handle, 'not-unique')
  const index = indexHtmlElements(source, scan.tokens)
  const tree = renderedSourceTree(source, scan.tokens, index.elements)
  const target = tree && pathToSource(tree, report.domPath)
  if (!target || target.sourceIndex === null) return rejection(report.handle, 'not-unique')
  const selected = target.sourceIndex
  const element = index.elements[selected]!
  if (!element.endTag && !element.voidElement && !element.selfClosing) return rejection(report.handle, 'not-unique')
  if (renderedSectionOrder(target) !== report.sectionOrder) return rejection(report.handle, 'not-unique')
  let valueSpan: { start: number; end: number } | null = null
  let attributeName: string | null = null
  if (report.kind === 'image') {
    if (element.name !== 'img' || report.attributeName !== 'src') return rejection(report.handle, 'unsupported-target')
    const tag = scan.tokens.find(token => token.kind === 'start-tag' && token.span.start === element.startTag.start)
    const attributes = tag?.attributes?.filter(attribute => attribute.name === 'src') ?? []
    if (attributes.length > 1 || (attributes.length === 1 && !attributes[0]!.valueSpan)) return rejection(report.handle, 'not-unique')
    if (attributes.length === 0) {
      if (report.rawText !== '') return rejection(report.handle, 'source-changed')
    } else {
      const attribute = attributes[0]!
      if (decodeHtmlEntities(source.slice(attribute.valueSpan!.start, attribute.valueSpan!.end).replace(/\r\n?/g, '\n')) !== report.rawText) {
        return rejection(report.handle, 'source-changed')
      }
      valueSpan = attribute.valueSpan!
    }
    attributeName = 'src'
  } else {
    if (report.attributeName !== null || ['script', 'style', 'title', 'textarea', 'noscript'].includes(element.name)) {
      return rejection(report.handle, 'unsupported-target')
    }
    const children = index.elements.filter(candidate => candidate.parent === selected)
    const candidates = directTextTokens(scan.tokens, element, children)
      .filter(token => decodeHtmlEntities(source.slice(token.span.start, token.span.end).replace(/\r\n?/g, '\n')) === report.rawText)
    if (candidates.length !== 1) return rejection(report.handle, 'not-unique')
    valueSpan = candidates[0]!.span
  }
  const locator: HtmlPreviewSourceLocator = {
    ...identity, targetKind: report.kind,
    elementSpan: element.full, valueSpan, attributeName,
    expectedRaw: valueSpan ? source.slice(valueSpan.start, valueSpan.end) : '',
  }
  return { handle: report.handle, status: 'editable', locator }
}

export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeHtmlAttribute(value: string, quote: '"' | "'" | ''): string {
  const encoded = escapeHtmlText(value)
  if (quote === '"') return encoded.replace(/"/g, '&quot;')
  if (quote === "'") return encoded.replace(/'/g, '&#39;')
  return encoded.replace(/\s/g, match => `&#${match.charCodeAt(0)};`).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Source-owned records can be relocated after an explicit local source operation. Dynamic bindings are untouched. */
export function locateHtmlAuthorRecordSource(source: string, record: ComponentAuthorRecord, authorKey: string, afterEdit = false) {
  const scan = scanHtmlSource(source), index = indexHtmlElements(source, scan.tokens)
  const root = renderedSourceTree(source, scan.tokens, index.elements)
  if (!root) return null
  const attrs = (node: RenderedElement) => node.sourceIndex === null ? {} : Object.fromEntries((scan.tokens.find(token =>
    token.kind === 'start-tag' && token.span.start === index.elements[node.sourceIndex!]!.startTag.start)?.attributes ?? [])
    .map(attribute => [attribute.name, attribute.decodedValue ?? '']))
  const all = (node: RenderedElement): RenderedElement[] => [node, ...node.children.flatMap(all)]
  let target: RenderedElement | null = null
  if (afterEdit) {
    const last = record.binding.path.at(-1), id = last?.attributes?.id
    const anchored = all(root).filter(node => attrs(node)['data-cw-author-key'] === authorKey)
    if (anchored.length === 1) target = anchored[0]!
    else if (id) {
      const identified = all(root).filter(node => node.name === last!.tag && attrs(node).id === id)
      if (identified.length === 1) target = identified[0]!
    }
    if (!target) {
      const domScope = Object.entries(record.scope ?? {}).filter(([name]) => name.startsWith('dom:'))
      if (domScope.length) {
        const scoped = all(root).filter(node => node.name === last?.tag && domScope.every(([name, value]) => {
          const [, depth, attribute] = name.split(':')
          let owner: RenderedElement | null = node
          for (let index = 0; index < Number(depth) && owner; index++) owner = owner.parent
          return owner && attrs(owner)[attribute!] === value
        }))
        if (scoped.length === 1) target = scoped[0]!
      }
    }
  }
  target ??= pathToSource(root, [{ name: 'html', index: 0 }, ...record.binding.path.map(step => ({ name: step.tag, index: step.index }))])
  if (!target || target.sourceIndex === null) return null
  const element = index.elements[target.sourceIndex]!
  let valueSpan: { start: number; end: number } | null = null
  let value = ''
  if (record.kind === 'image') {
    if (target.name !== 'img') return null
    const attribute = scan.tokens.find(token => token.kind === 'start-tag' && token.span.start === element.startTag.start)
      ?.attributes?.find(attribute => attribute.name === 'src')
    valueSpan = attribute?.valueSpan ?? null; value = attribute?.decodedValue ?? ''
  } else {
    const texts = directTextTokens(scan.tokens, element, index.elements.filter(candidate => candidate.parent === target!.sourceIndex))
    const token = texts[record.binding.textIndex ?? 0]
    if (!token) return null
    valueSpan = token.span; value = decodeHtmlEntities(source.slice(token.span.start, token.span.end).replace(/\r\n?/g, '\n'))
  }
  if (!afterEdit && value !== record.binding.baseline) return null
  const path: ComponentAuthorRecord['binding']['path'] = []
  for (let node: RenderedElement | null = target; node && node !== root; node = node.parent) {
    const attributes = Object.fromEntries(Object.entries(attrs(node)).filter(([name]) =>
      ['id', 'role', 'aria-label', 'name', 'class', 'data-cw-author-key'].includes(name)))
    if (attributes.class) {
      attributes.class = attributes.class.split(/\s+/).filter(value => !/^(?:(?:is|has)-)?(?:active|selected|playing|paused|hidden|open|closed|focused|hovered|disabled)$/.test(value)).join(' ')
      if (!attributes.class) delete attributes.class
    }
    path.unshift({ tag: node.name, index: node.parent!.children.indexOf(node), ...(Object.keys(attributes).length ? { attributes } : {}) })
  }
  const scope = Object.fromEntries(Object.entries(record.scope ?? {}).filter(([name]) => !name.startsWith('dom:')))
  let depth = 0
  for (let node: RenderedElement | null = target; node; node = node.parent) {
    for (const [name, value] of Object.entries(attrs(node))) if (/^data-(?:(?:item|record|entity|author|state|scene|view)-)?(?:id|key|state)$/.test(name))
      scope[`dom:${depth}:${name}`] = value
    depth++
  }
  return { elementSpan: element.full, valueSpan, value, path, scope }
}
