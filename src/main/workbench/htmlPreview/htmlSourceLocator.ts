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
