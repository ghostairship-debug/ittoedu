/**
 * Shared, dependency-free HTML source scanner. Single source of truth for the
 * importer's tag lexing and for the M23 source locator / M24 section splitter.
 *
 * Offsets are JavaScript source string UTF-16 code-unit offsets in half-open
 * spans, never DOM indices or persistent identity.
 */

export type HtmlSpan = { start: number; end: number }

export type HtmlAttributeSpan = {
  name: string
  rawName: string
  span: HtmlSpan
  valueSpan?: HtmlSpan
  quote: '"' | "'" | ''
  decodedValue?: string
}

export type HtmlRawKind = 'script' | 'style' | 'rcdata' | 'inert'

export type HtmlTokenKind = 'start-tag' | 'end-tag' | 'text' | 'raw-text' | 'comment' | 'doctype'

export type HtmlSourceToken = {
  kind: HtmlTokenKind
  span: HtmlSpan
  name?: string
  rawName?: string
  attributes?: readonly HtmlAttributeSpan[]
  selfClosing?: boolean
  rawKind?: HtmlRawKind
}

export type HtmlDiagnostic = { code: string; span: HtmlSpan; message: string }

export type HtmlSourceScan = {
  tokens: readonly HtmlSourceToken[]
  diagnostics: readonly HtmlDiagnostic[]
}

export type HtmlStartTag = {
  rawName: string
  name: string
  attributes: readonly HtmlAttributeSpan[]
  end: number
  selfClosing: boolean
}

export const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img',
  'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const RAW_TEXT_KINDS: Readonly<Record<string, HtmlRawKind>> = {
  script: 'script', style: 'style', title: 'rcdata', textarea: 'rcdata', noscript: 'inert',
}

const ASCII_LETTER = /[A-Za-z]/
const NAME_CHAR = /[A-Za-z0-9:_-]/
const SPACE = /[\t\n\f\r ]/
const ATTRIBUTE_STOP = /[\s=/>]/
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g

export function decodeHtmlEntities(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(ENTITY, (entity, body: string) => {
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    const code = body.startsWith('#x') ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

/**
 * Lex a single start tag at `index`. Returns null when the position is not a
 * start tag (end tag, comment, declaration, lone `<`, or non-letter name), so
 * callers can fall back to emitting the character as text.
 */
export function parseHtmlStartTag(source: string, index: number): HtmlStartTag | null {
  if (source[index] !== '<') return null
  const next = source[index + 1] ?? ''
  if (next === '/' || next === '!' || next === '?' || !ASCII_LETTER.test(next)) return null
  let j = index + 2
  const nameStart = index + 1
  while (j < source.length && NAME_CHAR.test(source[j]!)) j += 1
  const rawName = source.slice(nameStart, j)
  const attributes: HtmlAttributeSpan[] = []
  while (j < source.length) {
    const beforeSpace = j
    while (j < source.length && SPACE.test(source[j]!)) j += 1
    if (j >= source.length) break
    if (source[j] === '>') return { rawName, name: rawName.toLowerCase(), attributes, end: j + 1, selfClosing: false }
    if (source[j] === '/' && source[j + 1] === '>') return { rawName, name: rawName.toLowerCase(), attributes, end: j + 2, selfClosing: true }
    if (j === beforeSpace) break
    if (ATTRIBUTE_STOP.test(source[j]!)) { j += 1; continue }
    const attributeStart = j
    while (j < source.length && !ATTRIBUTE_STOP.test(source[j]!)) j += 1
    const rawAttribute = source.slice(attributeStart, j)
    const nameSpan: HtmlSpan = { start: attributeStart, end: j }
    let quote: '"' | "'" | '' = ''
    let valueSpan: HtmlSpan | undefined
    let decodedValue: string | undefined
    const afterName = j
    while (j < source.length && SPACE.test(source[j]!)) j += 1
    if (source[j] === '=') {
      j += 1
      while (j < source.length && SPACE.test(source[j]!)) j += 1
      if (source[j] === '"' || source[j] === "'") {
        quote = source[j] as '"' | "'"
        j += 1
        const valueStart = j
        while (j < source.length && source[j] !== quote) j += 1
        valueSpan = { start: valueStart, end: j }
        decodedValue = decodeHtmlEntities(source.slice(valueStart, j))
        if (source[j] === quote) j += 1
      } else {
        const valueStart = j
        while (j < source.length && !SPACE.test(source[j]!) && !(source[j] === '/' && source[j + 1] === '>')) j += 1
        valueSpan = { start: valueStart, end: j }
        decodedValue = decodeHtmlEntities(source.slice(valueStart, j))
      }
    } else j = afterName
    attributes.push({
      name: rawAttribute.toLowerCase(),
      rawName: rawAttribute,
      span: nameSpan,
      ...(valueSpan ? { valueSpan } : {}),
      quote,
      ...(decodedValue !== undefined ? { decodedValue } : {}),
    })
  }
  return { rawName, name: rawName.toLowerCase(), attributes, end: Math.min(j + 1, source.length), selfClosing: false }
}

/** Read raw text up to the matching close tag. `body` excludes the close tag. */
export function readHtmlRawText(source: string, from: number, tagName: string): { body: HtmlSpan; close: HtmlSpan | null } {
  const match = new RegExp(`</${tagName}\\s*>`, 'gi')
  match.lastIndex = from
  const found = match.exec(source)
  if (!found || found.index < from) return { body: { start: from, end: source.length }, close: null }
  return { body: { start: from, end: found.index }, close: { start: found.index, end: found.index + found[0].length } }
}

export function scanHtmlSource(source: string): HtmlSourceScan {
  const tokens: HtmlSourceToken[] = []
  const diagnostics: HtmlDiagnostic[] = []
  let i = 0
  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      const stop = end === -1 ? source.length : end + 3
      tokens.push({ kind: 'comment', span: { start: i, end: stop } })
      if (end === -1) diagnostics.push({ code: 'unclosed-comment', span: { start: i, end: stop }, message: '未闭合的注释' })
      i = stop
      continue
    }
    if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i)
      const stop = end === -1 ? source.length : end + 1
      const inner = source.slice(i + 2, end === -1 ? source.length : end).trim()
      const rawName = inner.split(/[\s>]/)[0] ?? ''
      tokens.push({ kind: 'end-tag', span: { start: i, end: stop }, ...(rawName ? { name: rawName.toLowerCase(), rawName } : {}) })
      i = stop
      continue
    }
    if (source.startsWith('<!', i) || source.startsWith('<?', i)) {
      const end = source.indexOf('>', i)
      const stop = end === -1 ? source.length : end + 1
      tokens.push({ kind: 'doctype', span: { start: i, end: stop } })
      i = stop
      continue
    }
    if (source[i] === '<') {
      const tag = parseHtmlStartTag(source, i)
      if (tag) {
        tokens.push({
          kind: 'start-tag',
          span: { start: i, end: tag.end },
          name: tag.name,
          rawName: tag.rawName,
          attributes: tag.attributes,
          selfClosing: tag.selfClosing,
        })
        i = tag.end
        const rawKind = tag.selfClosing || HTML_VOID_ELEMENTS.has(tag.name) ? undefined : RAW_TEXT_KINDS[tag.name]
        if (rawKind) {
          const raw = readHtmlRawText(source, i, tag.name)
          if (raw.body.end > raw.body.start) tokens.push({ kind: 'raw-text', span: raw.body, rawKind })
          if (raw.close) {
            tokens.push({ kind: 'end-tag', span: raw.close, name: tag.name, rawName: tag.rawName })
            i = raw.close.end
          } else {
            diagnostics.push({ code: 'unclosed-raw-text', span: { start: i, end: source.length }, message: `未闭合的 <${tag.name}>` })
            i = source.length
          }
        }
        continue
      }
      tokens.push({ kind: 'text', span: { start: i, end: i + 1 } })
      i += 1
      continue
    }
    const next = source.indexOf('<', i)
    const stop = next === -1 ? source.length : next
    tokens.push({ kind: 'text', span: { start: i, end: stop } })
    i = stop
  }
  return { tokens, diagnostics }
}

export type HtmlElementIndexEntry = {
  name: string
  depth: number
  parent: number | null
  siblingIndex: number
  startTag: HtmlSpan
  content: HtmlSpan
  endTag: HtmlSpan | null
  full: HtmlSpan
  id: string | null
  selfClosing: boolean
  voidElement: boolean
}

export type HtmlSectionRef = {
  elementIndex: number
  full: HtmlSpan
  id: string | null
  order: number
}

export type HtmlSourceIndex = {
  elements: readonly HtmlElementIndexEntry[]
  roots: readonly number[]
  body: number | null
  main: number | null
  sections: readonly HtmlSectionRef[]
  sectionsAmbiguous: boolean
}

function idOf(attributes: readonly HtmlAttributeSpan[] | undefined): string | null {
  const attribute = attributes?.find(candidate => candidate.name === 'id')
  const value = attribute?.decodedValue ?? ''
  return value ? value : null
}

/**
 * Build the element tree and the page-section view over a scanned document.
 * Sections are the direct `<section>` children of `<body>`, or of a unique
 * direct `<main>` child of `<body>`; nested sections are not pages.
 *
 * Unclosed elements keep `endTag: null` and are bounded by wherever the parser
 * ran out (the closing tag that implicitly popped them, or end of source).
 */
export function indexHtmlElements(source: string, tokens?: readonly HtmlSourceToken[]): HtmlSourceIndex {
  const scanned = tokens ?? scanHtmlSource(source).tokens
  const elements: HtmlElementIndexEntry[] = []
  const roots: number[] = []
  const open: number[] = []
  const siblingCount = new Map<number | null, number>()

  for (const token of scanned) {
    if (token.kind === 'start-tag') {
      const parent = open.length > 0 ? open[open.length - 1]! : null
      const name = token.name ?? ''
      const voidElement = HTML_VOID_ELEMENTS.has(name)
      const siblingIndex = siblingCount.get(parent) ?? 0
      siblingCount.set(parent, siblingIndex + 1)
      const entryIndex = elements.push({
        name,
        depth: open.length,
        parent,
        siblingIndex,
        startTag: token.span,
        content: { start: token.span.end, end: token.span.end },
        endTag: null,
        full: { start: token.span.start, end: token.span.end },
        id: idOf(token.attributes),
        selfClosing: Boolean(token.selfClosing),
        voidElement,
      }) - 1
      if (parent === null) roots.push(entryIndex)
      if (!voidElement && !token.selfClosing) open.push(entryIndex)
      continue
    }
    if (token.kind !== 'end-tag' || !token.name) continue
    let match = -1
    for (let depth = open.length - 1; depth >= 0; depth -= 1) {
      if (elements[open[depth]!]!.name === token.name) { match = depth; break }
    }
    if (match === -1) continue
    for (let depth = open.length - 1; depth >= match; depth -= 1) {
      const element = elements[open.pop()!]!
      const contentEnd = token.span.start
      element.content = { start: element.startTag.end, end: contentEnd }
      if (depth === match) {
        element.endTag = token.span
        element.full = { start: element.startTag.start, end: token.span.end }
      } else {
        element.full = { start: element.startTag.start, end: contentEnd }
      }
    }
  }

  for (const entryIndex of open) {
    const element = elements[entryIndex]!
    element.content = { start: element.startTag.end, end: source.length }
    element.full = { start: element.startTag.start, end: source.length }
  }

  const childrenOf = (parent: number | null): number[] => {
    const out: number[] = []
    for (let index = 0; index < elements.length; index += 1) {
      if (elements[index]!.parent === parent) out.push(index)
    }
    return out
  }
  const asSection = (elementIndex: number, order: number): HtmlSectionRef => ({
    elementIndex,
    full: elements[elementIndex]!.full,
    id: elements[elementIndex]!.id,
    order,
  })

  // `body` is commonly nested one level under `html`, so search every element
  // rather than only the roots; an earlier `roots.find` missed it entirely.
  const bodyIndex = elements.findIndex(element => element.name === 'body')
  const body = bodyIndex === -1 ? null : bodyIndex
  let main: number | null = null
  let sections: HtmlSectionRef[] = []
  let sectionsAmbiguous = false
  if (body !== null) {
    const bodyChildren = childrenOf(body)
    const directSections = bodyChildren.filter(index => elements[index]!.name === 'section')
    const mains = bodyChildren.filter(index => elements[index]!.name === 'main')
    if (directSections.length > 0) {
      sections = directSections.map(asSection)
      sectionsAmbiguous = mains.length > 0
    } else if (mains.length === 1) {
      main = mains[0]!
      sections = childrenOf(main).filter(index => elements[index]!.name === 'section').map(asSection)
    } else if (mains.length > 1) {
      sectionsAmbiguous = true
    }
  }

  return { elements, roots, body, main, sections, sectionsAmbiguous }
}
