import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import type { HtmlSourceAddress } from './sourceEditCommands'

export interface HtmlSourceNode {
  key: string
  name: string
  kind: 'element' | 'text' | 'source'
  address?: HtmlSourceAddress
  attributes: Record<string, string>
  children: HtmlSourceNode[]
  value?: string
  /** The displayed result of executable source has no dependable DOM-to-source edit mapping. */
  sourceOnly?: boolean
  contentSpan?: { from: number; to: number }
}
export interface HtmlSourceStyleRule {
  address: HtmlSourceAddress
  selector: string
  context: string[]
  declarations: string
}
export interface HtmlSourceData {
  address: HtmlSourceAddress
  name: string
  value: unknown
}
export interface HtmlSourceStructure {
  roots: HtmlSourceNode[]
  rules: HtmlSourceStyleRule[]
  data: HtmlSourceData[]
}

/** Locate actual inline CSS rule bodies, including nested media/container rules, without changing selector scope. */
function styleRules(css: string, offset: number, context: string[] = []): HtmlSourceStyleRule[] {
  const result: HtmlSourceStyleRule[] = []
  let start = 0, open = -1, depth = 0, quote = '', comment = false, parens = 0
  for (let i = 0; i < css.length; i++) {
    const char = css[i]!, next = css[i + 1]
    if (comment) { if (char === '*' && next === '/') { comment = false; i++ }; continue }
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = ''; continue }
    if (char === '/' && next === '*') { comment = true; i++; continue }
    if (char === '\\') { i++; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(' || char === '[') { parens++; continue }
    if (char === ')' || char === ']') { parens--; continue }
    if (parens) continue
    if (char === ';' && depth === 0) { start = i + 1; continue }
    if (char === '{') { if (depth === 0) open = i; depth++; continue }
    if (char !== '}' || depth === 0) continue
    depth--
    if (depth !== 0 || open < 0) continue
    const selector = css.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim()
    const body = css.slice(open + 1, i)
    if (/^@(?:media|supports|layer|container|document|scope|(?:-\w+-)?keyframes)\b/i.test(selector)) {
      result.push(...styleRules(body, offset + open + 1, [...context, selector]))
    } else if (selector) {
      result.push({ address: { kind: 'stylesheet', from: offset + open + 1, to: offset + i },
        selector, context, declarations: body })
    }
    start = i + 1; open = -1
  }
  return result
}

/** Parse browser source locations; implicit parser wrappers remain visible but are never guessed write targets. */
export function inspectHtmlSource(source: string): HtmlSourceStructure {
  const document = parse(source, { sourceCodeLocationInfo: true })
  const rules: HtmlSourceStyleRule[] = [], data: HtmlSourceData[] = []
  let implicit = 0
  const visit = (node: DefaultTreeAdapterTypes.ChildNode): HtmlSourceNode | null => {
    if (node.nodeName === '#text') {
      const text = node as DefaultTreeAdapterTypes.TextNode
      const location = text.sourceCodeLocation
      if (!location || !text.value.trim()) return null
      return { key: `text:${location.startOffset}`, name: '#text', kind: 'text',
        address: { kind: 'text', from: location.startOffset, to: location.endOffset },
        attributes: {}, children: [], value: text.value }
    }
    if (!('tagName' in node)) return null
    const location = node.sourceCodeLocation
    const attributes = Object.fromEntries(node.attrs.map(attribute => [attribute.name, attribute.value]))
    const address = location?.startTag ? { kind: 'element' as const,
      from: location.startOffset, to: location.endOffset } : undefined
    const contentSpan = location?.startTag && location.endTag
      ? { from: location.startTag.endOffset, to: location.endTag.startOffset } : undefined
    const isScript = node.tagName === 'script'
    const isData = isScript && /^(?:application\/(?:ld\+)?json)$/i.test((attributes.type ?? '').trim())
    const isSource = isScript || node.tagName === 'style'
    if (contentSpan && node.tagName === 'style') {
      rules.push(...styleRules(source.slice(contentSpan.from, contentSpan.to), contentSpan.from))
    }
    if (contentSpan && isData) {
      try {
        data.push({ address: { kind: 'data', ...contentSpan }, name: attributes.id || 'JSON 数据',
          value: JSON.parse(source.slice(contentSpan.from, contentSpan.to)) })
      } catch { /* Invalid or executable expressions keep the source editor as their actual edit owner. */ }
    }
    const children = node.tagName === 'template' && 'content' in node
      ? (node as DefaultTreeAdapterTypes.Template).content.childNodes : node.childNodes
    return { key: address ? `element:${address.from}` : `implicit:${implicit++}`, name: node.tagName,
      kind: isSource ? 'source' : 'element', ...(address ? { address } : {}), attributes,
      ...(contentSpan ? { contentSpan } : {}), sourceOnly: isScript && !isData,
      children: isSource ? [] : children.map(visit).filter((child): child is HtmlSourceNode => child !== null) }
  }
  return { roots: document.childNodes.map(visit).filter((node): node is HtmlSourceNode => node !== null), rules, data }
}

export function flattenHtmlSourceNodes(roots: readonly HtmlSourceNode[]): HtmlSourceNode[] {
  return roots.flatMap(node => [node, ...flattenHtmlSourceNodes(node.children)])
}

export function sameHtmlSourceAddress(left: HtmlSourceAddress | undefined, right: HtmlSourceAddress): boolean {
  return Boolean(left && left.kind === right.kind && left.from === right.from && left.to === right.to)
}
