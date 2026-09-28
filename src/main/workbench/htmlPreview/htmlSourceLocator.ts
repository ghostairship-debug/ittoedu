import {
  decodeHtmlEntities, HTML_VOID_ELEMENTS, indexHtmlElements, scanHtmlSource,
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

/** The scanner is lexical. Reject source trees whose nesting the HTML parser may repair. */
function hasBalancedNesting(tokens: readonly HtmlSourceToken[]): boolean {
  const open: string[] = []
  for (const token of tokens) {
    if (token.kind === 'start-tag' && token.name && !token.selfClosing && !HTML_VOID_ELEMENTS.has(token.name)) {
      open.push(token.name)
    }
    if (token.kind === 'end-tag' && token.name) {
      if (open.pop() !== token.name) return false
    }
  }
  // Browsers permit omitted document wrapper end tags; content tags need an exact boundary.
  return open.every(name => name === 'html' || name === 'body')
}

function renderedSourceTree(
  source: string, tokens: readonly HtmlSourceToken[], elements: readonly HtmlElementIndexEntry[],
): RenderedElement | null {
  if (!hasBalancedNesting(tokens)) return null
  const childMap = new Map<number | null, number[]>()
  elements.forEach((element, at) => {
    const siblings = childMap.get(element.parent) ?? []
    siblings.push(at)
    childMap.set(element.parent, siblings)
  })
  const childrenOf = (parent: number | null): readonly number[] => childMap.get(parent) ?? []
  const roots = childrenOf(null)
  const htmlRoots = roots.filter(at => elements[at]!.name === 'html')
  if (htmlRoots.length > 1 || (htmlRoots.length === 1 && roots.length !== 1)) return null
  const htmlIndex = htmlRoots[0] ?? null
  const docChildren = childrenOf(htmlIndex)
  const heads = docChildren.filter(at => elements[at]!.name === 'head')
  const bodies = docChildren.filter(at => elements[at]!.name === 'body')
  if (heads.length > 1 || bodies.length > 1) return null
  const headIndex = heads[0] ?? null
  const bodyIndex = bodies[0] ?? null
  if (headIndex !== null && docChildren[0] !== headIndex) return null
  if (bodyIndex !== null && docChildren[docChildren.length - 1] !== bodyIndex) return null
  if (bodyIndex !== null && docChildren.some(at => at !== headIndex && at !== bodyIndex)) return null
  if (bodyIndex === null && docChildren.some(at => at !== headIndex
    && ['title', 'meta', 'link', 'base', 'style', 'script', 'noscript'].includes(elements[at]!.name))) return null

  const html = rendered('html', htmlIndex, null)
  const head = rendered('head', headIndex, html)
  const body = rendered('body', bodyIndex, html)
  html.children.push(head, body)

  const append = (parent: RenderedElement, sourceChildren: readonly number[]): boolean => {
    for (let position = 0; position < sourceChildren.length; position += 1) {
      const at = sourceChildren[position]!
      const element = elements[at]!
      const name = element.name
      if (['html', 'head', 'body', 'template', 'svg', 'math'].includes(name)) return false
      if (parent.name === 'head' && !['title', 'meta', 'link', 'base', 'style', 'script'].includes(name)) return false
      if (parent.name === 'select' || parent.name === 'option' || parent.name === 'optgroup') return false
      if (['tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup'].includes(name)
        && !((name === 'tr' && ['table', 'tbody', 'thead', 'tfoot'].includes(parent.name))
          || (name !== 'tr' && parent.name === 'table'))) return false
      if ((name === 'td' || name === 'th') && parent.name !== 'tr') return false
      if (name === 'col' && parent.name !== 'colgroup') return false
      if (parent.name === 'table' && !['tr', 'tbody', 'thead', 'tfoot', 'caption', 'colgroup'].includes(name)) return false
      if (['tbody', 'thead', 'tfoot'].includes(parent.name) && name !== 'tr') return false
      if (parent.name === 'tr' && name !== 'td' && name !== 'th') return false
      if (parent.name === 'colgroup' && name !== 'col') return false
      if (parent.name === 'p' && ['div', 'section', 'article', 'main', 'p', 'table', 'ul', 'ol',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(name)) return false
      if ((parent.name === 'a' && name === 'a') || (parent.name === 'button' && name === 'button')
        || (parent.name === 'form' && name === 'form')) return false
      for (let ancestor: RenderedElement | null = parent.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.name === 'p' && ['div', 'section', 'article', 'main', 'p', 'table', 'ul', 'ol',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(name)) return false
        if ((ancestor.name === 'a' && name === 'a') || (ancestor.name === 'button' && name === 'button')
          || (ancestor.name === 'form' && name === 'form')) return false
      }
      if (parent.name === 'table' && name === 'tr') {
        const tbody = rendered('tbody', null, parent)
        parent.children.push(tbody)
        do {
          const rowAt = sourceChildren[position]!
          const row = rendered('tr', rowAt, tbody)
          tbody.children.push(row)
          if (!append(row, childrenOf(rowAt))) return false
          position += 1
        } while (position < sourceChildren.length && elements[sourceChildren[position]!]!.name === 'tr')
        position -= 1
        continue
      }
      const child = rendered(name, at, parent)
      parent.children.push(child)
      if (!append(child, childrenOf(at))) return false
    }
    return true
  }
  if (headIndex !== null && !append(head, childrenOf(headIndex))) return null
  if (!append(body, bodyIndex === null ? docChildren.filter(at => at !== headIndex) : childrenOf(bodyIndex))) return null

  // Text in table insertion mode is foster-parented; do not claim a source path for it.
  for (const [at, element] of elements.entries()) {
    if (!['table', 'tbody', 'thead', 'tfoot', 'tr'].includes(element.name)) continue
    const directChildren = childrenOf(at).map(child => elements[child]!)
    if (tokens.some(token => token.kind === 'text' && token.span.start >= element.content.start
      && token.span.end <= element.content.end && source.slice(token.span.start, token.span.end).trim()
      && !directChildren.some(child => token.span.start >= child.full.start && token.span.end <= child.full.end))) return null
  }
  return html
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
    if (report.attributeName !== null || ['script', 'style', 'textarea', 'title', 'noscript'].includes(element.name)) {
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
