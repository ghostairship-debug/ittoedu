import { normalizeDocumentText, type FlowInline, type FlowTextContent, type InlineLink, type MathStyle } from './content'
import { normalizeDocumentColor } from './color'
import { describeDocumentMath, parseDocumentMath } from './math'
import type { TextRunStyle } from '../contracts/native-v1/types'

/** Parsed text projection only: no formal identity, block, asset or document writer. */
export type DocumentHtmlNode =
  | { kind: 'text' | 'comment'; text: string }
  | DocumentHtmlElement
export interface DocumentHtmlElement {
  kind: 'element'
  tagName: string
  attributes: Record<string, string>
  children: DocumentHtmlNode[]
}
export interface DocumentHtmlTextOptions {
  createFormulaId(): string
  warn?(code: string, message: string): void
  onMedia?(element: DocumentHtmlElement): void
  /** Opt-in browser normal projection; the existing Flow source rules remain the default. */
  normalWhitespace?: boolean
}
interface InlineContext { style: TextRunStyle; code?: boolean; link?: InlineLink; math?: { accessibleText?: string; style?: MathStyle } }
interface RawInline { text: string; br?: boolean; context: InlineContext }
const tagOf = (node: DocumentHtmlNode) => node.kind === 'element' ? node.tagName.toLowerCase() : ''
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/
const HIGHLIGHT = '#fef08a'
export function documentHtmlMathAccessibleText(latex: string): string | undefined {
  try { return describeDocumentMath(parseDocumentMath(latex)).trim() || undefined } catch { return undefined }
}

export function htmlDeclarations(css: string | undefined): [string, string][] {
  const result: [string, string][] = []
  let current = '', quote = '', depth = 0
  for (const character of css ?? '') {
    if (quote) { current += character; if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") quote = character
    else if (character === '(') depth++
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ';' && !depth) { push(); continue }
    current += character
  }
  push()
  function push() {
    const index = current.indexOf(':')
    if (index > 0) result.push([current.slice(0, index).trim().toLowerCase(), current.slice(index + 1).replace(/!important\s*$/i, '').trim()])
    current = ''
  }
  return result
}

export function htmlCssLength(value: string): number | undefined {
  const match = /^(-?[\d.]+)(px|pt|em|rem)?$/.exec(value.trim())
  if (!match) return undefined
  const number = Number(match[1])
  return !Number.isFinite(number) ? undefined : match[2] === 'pt' ? number * 4 / 3 : match[2] === 'em' || match[2] === 'rem' ? number * 16 : number
}

export function htmlTextStyle(style: TextRunStyle, element: Pick<DocumentHtmlElement, 'attributes'>): TextRunStyle {
  const next: TextRunStyle = { ...style }
  for (const [name, value] of htmlDeclarations(element.attributes.style)) {
    const lower = value.toLowerCase()
    if (name === 'color') { const color = normalizeDocumentColor(value); if (color) next.color = color }
    else if (name === 'font-family' && value) next.fontFamily = value
    else if (name === 'font-size') { const size = htmlCssLength(value); if (size !== undefined) next.fontSize = Math.min(400, Math.max(8, Math.round(size * 100) / 100)) }
    else if (name === 'vertical-align') {
      const em = /^(-?[\d.]+)em$/.exec(lower)
      if (em) next.baseline = Math.min(1, Math.max(-1, Number(em[1])))
      else if (lower === 'super') next.baseline = 0.3
      else if (lower === 'sub') next.baseline = -0.2
    } else if (name === 'font-weight') next.bold = lower === 'bold' || lower === 'bolder' || Number(lower) >= 600
    else if (name === 'font-style') next.italic = lower === 'italic' || lower === 'oblique'
    else if (name === 'text-decoration' || name === 'text-decoration-line') {
      if (lower.includes('underline')) next.underline = true
      if (lower.includes('line-through')) next.strike = true
    } else if (name === 'background-color' || name === 'background') {
      if (lower === 'transparent') next.highlightColor = null
      else { const color = normalizeDocumentColor(value); if (color) next.highlightColor = color }
    } else if (name === 'text-emphasis' || name === 'text-emphasis-style' || name === '-webkit-text-emphasis-style') next.emphasis = lower !== 'none'
  }
  if (element.attributes['data-style']) {
    try { Object.assign(next, JSON.parse(element.attributes['data-style'])) } catch { /* Ignore an unreadable extra style. */ }
  }
  return next
}

export function readHtmlDocumentText(nodes: readonly DocumentHtmlNode[], options: DocumentHtmlTextOptions): FlowTextContent {
  function collectInlines(nodes: readonly DocumentHtmlNode[], context: InlineContext, out: RawInline[]): void {
    for (const node of nodes) {
      if (node.kind === 'text') { out.push({ text: node.text, context }); continue }
      if (node.kind !== 'element') continue
      const tag = tagOf(node)
      if (tag === 'br') { out.push({ text: '\n', br: true, context }); continue }
      if (tag === 'img' || tag === 'video' || tag === 'audio' || tag === 'figure' || tag === 'iframe') { options.onMedia?.(node); continue }
      if (tag === 'svg' || tag === 'canvas') {
        if (options.onMedia) options.onMedia(node)
        else throw new Error('正文文字不能无损承载图形或媒体，请保留原内容并使用组件 HTML 源码入口')
        continue
      }
      if (tag === 'script' || tag === 'style' || tag === 'template') continue
      let next: InlineContext = { ...context, style: htmlTextStyle(context.style, node) }
      if (tag === 'strong' || tag === 'b') next.style = { ...next.style, bold: true }
      else if (tag === 'em' || tag === 'i' || tag === 'cite' || tag === 'var' || tag === 'dfn') next.style = { ...next.style, italic: true }
      else if (tag === 'u' || tag === 'ins') next.style = { ...next.style, underline: true }
      else if (tag === 's' || tag === 'del' || tag === 'strike') next.style = { ...next.style, strike: true }
      else if (tag === 'mark') next.style = { ...next.style, highlightColor: next.style.highlightColor ?? HIGHLIGHT }
      else if (tag === 'sup') next.style = { ...next.style, baseline: next.style.baseline ?? 0.3 }
      else if (tag === 'sub') next.style = { ...next.style, baseline: next.style.baseline ?? -0.2 }
      else if (tag === 'code' || tag === 'kbd' || tag === 'samp' || tag === 'tt') next.code = true
      else if (tag === 'a' && node.attributes.href) next.link = { href: node.attributes.href, ...(node.attributes.title !== undefined ? { title: node.attributes.title } : {}) }
      if ((node.attributes.class ?? '').split(/\s+/).includes('math')) {
        // A math wrapper's style describes its formulas, not surrounding text.
        const mathStyle: MathStyle = {}
        if (next.style.fontSize !== undefined && next.style.fontSize !== context.style.fontSize) mathStyle.fontSize = next.style.fontSize
        if (next.style.color !== undefined && next.style.color !== context.style.color) mathStyle.color = next.style.color
        next = { ...next, style: context.style, math: { ...(node.attributes['aria-label'] ? { accessibleText: node.attributes['aria-label'] } : {}), ...(Object.keys(mathStyle).length ? { style: mathStyle } : {}) } }
      }
      collectInlines(node.children, next, out)
    }
  }

  /** HTML whitespace: a line break in the source (with its indentation) is one space, or nothing between CJK text. */
  function finishInlines(raw: RawInline[]): FlowTextContent {
    const parts = raw.map(part => ({ ...part }))
    const textual = parts.filter(part => !part.br)
    if (textual[0]) textual[0].text = textual[0].text.replace(/^[ \t\f]*[\r\n][\s]*/, '')
    if (textual.at(-1)) textual.at(-1)!.text = textual.at(-1)!.text.replace(/[\s]*[\r\n][ \t\f]*$/, '')
    const joined = parts.map(part => part.br ? '\u0000' : part.text).join('')
    const collapsed: string[] = []
    let cursor = 0
    for (const part of parts) {
      const end = cursor + (part.br ? 1 : part.text.length)
      if (part.br) { collapsed.push('\n'); cursor = end; continue }
      let text = ''
      for (let index = 0; index < part.text.length;) {
        const run = /^[ \t\f]*[\r\n][\s]*/.exec(part.text.slice(index))
        if (run) {
          const before = joined[cursor + index - 1] ?? '', after = joined[cursor + index + run[0].length] ?? ''
          if (!(CJK.test(before) && CJK.test(after))) text += ' '
          index += run[0].length
        } else { text += part.text[index]; index++ }
      }
      collapsed.push(text)
      cursor = end
    }
    const inlines: FlowInline[] = []
    parts.forEach((part, index) => {
      const text = collapsed[index]!
      if (!text) return
      const { context } = part
      const base = { ...(Object.keys(context.style).length ? { style: context.style } : {}), ...(context.link ? { link: context.link } : {}) }
      if (context.code || part.br) { inlines.push({ type: 'text', text, ...(context.code ? { code: true } : {}), ...base }); return }
      let rest = text
      // Tool responses may retain an extra escape on both math delimiters. Accept
      // that pair without unescaping the formula body or ordinary/code text.
      const math = /(?<!\\)(\\{1,2})\(([\s\S]+?)\1\)/
      for (let match = math.exec(rest); match; match = math.exec(rest)) {
        if (match.index) inlines.push({ type: 'text', text: rest.slice(0, match.index), ...base })
        const latex = match[2]!.trim()
        const accessibleText = context.math?.accessibleText ?? documentHtmlMathAccessibleText(latex)
        if (accessibleText) inlines.push({ type: 'math', formulaId: options.createFormulaId(), latex, accessibleText,
          ...(context.math?.style ? { style: context.math.style } : {}), ...(context.link ? { link: context.link } : {}) })
        else { options.warn?.('flow-math', `公式无法识别，已按文字保留：${latex.slice(0, 60)}`); inlines.push({ type: 'text', text: match[0], ...base }) }
        rest = rest.slice(match.index + match[0].length)
      }
      if (rest) inlines.push({ type: 'text', text: rest, ...base })
    })
    return normalizeDocumentText({ inlines })
  }

  const raw: RawInline[] = []
  collectInlines(nodes, { style: {} }, raw)
  if (!options.normalWhitespace) return finishInlines(raw)
  const projected: RawInline[] = []
  let pendingSpace: InlineContext | undefined
  let lineStart = true
  const append = (text: string, context: InlineContext) => {
    const previous = projected.at(-1)
    if (previous && !previous.br && previous.context === context) previous.text += text
    else projected.push({ text, context })
  }
  for (const part of raw) {
    if (part.br) {
      pendingSpace = undefined
      projected.push({ ...part })
      lineStart = true
      continue
    }
    for (const character of part.text) {
      if (/[ \t\r\n\f]/.test(character)) {
        if (!lineStart) pendingSpace ??= part.context
        continue
      }
      if (pendingSpace) { append(' ', pendingSpace); pendingSpace = undefined }
      append(character, part.context)
      lineStart = false
    }
  }
  // Only HTML collapsible characters were projected; nbsp and explicit br are untouched.
  return finishInlines(projected)
}
