import { parse, type DefaultTreeAdapterTypes } from 'parse5'

type Node = DefaultTreeAdapterTypes.Node
type Element = DefaultTreeAdapterTypes.Element

const omitted = new Set(['script', 'style', 'noscript', 'svg', 'canvas', 'nav', 'footer', 'aside', 'form'])
const lineBreak = new Set(['p', 'div', 'section', 'article', 'main', 'blockquote', 'pre', 'li', 'ul', 'ol', 'tr', 'table', 'br',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

function isElement(node: Node): node is Element { return 'tagName' in node }
function children(node: Node): readonly Node[] { return 'childNodes' in node ? node.childNodes : [] }
function first(node: Node, predicate: (element: Element) => boolean): Element | undefined {
  if (isElement(node) && predicate(node)) return node
  for (const child of children(node)) { const found = first(child, predicate); if (found) return found }
  return undefined
}
function attr(element: Element, name: string): string | undefined { return element.attrs.find(item => item.name === name)?.value }
function textOf(node: Node): string {
  if ('value' in node) return node.value
  return children(node).map(textOf).join('')
}
function normalized(lines: string): string {
  return lines.replace(/\u00a0/g, ' ').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface ExtractedHtml {
  title: string
  text: string
  publishedAt?: string
  accessRequired: boolean
}

/** Real HTML parsing preserves headings, list/table structure and visible links. */
export function extractHtml(html: string, pageUrl: string): ExtractedHtml {
  const document = parse(html)
  const titleElement = first(document, element => element.tagName === 'title')
  const title = normalized(titleElement ? textOf(titleElement) : first(document, element => element.tagName === 'h1')
    ? textOf(first(document, element => element.tagName === 'h1')!) : '')
  const published = first(document, element => element.tagName === 'meta'
    && ['article:published_time', 'datePublished', 'pubdate'].includes(attr(element, 'property') ?? attr(element, 'name') ?? ''))
  const publishedRaw = published ? attr(published, 'content') : undefined
  const publishedAt = publishedRaw && !Number.isNaN(Date.parse(publishedRaw)) ? publishedRaw : undefined
  const accessRequired = !!first(document, element => element.tagName === 'input' && attr(element, 'type')?.toLowerCase() === 'password')
  const root = first(document, element => element.tagName === 'main') ?? first(document, element => element.tagName === 'article')
    ?? first(document, element => element.tagName === 'body') ?? document
  const output: string[] = []
  const visit = (node: Node): void => {
    if ('value' in node) { output.push(node.value); return }
    if (!isElement(node)) { for (const child of children(node)) visit(child); return }
    const tag = node.tagName
    if (omitted.has(tag) || attr(node, 'aria-hidden') === 'true' || attr(node, 'hidden') !== undefined) return
    if (tag === 'br') { output.push('\n'); return }
    if (lineBreak.has(tag)) output.push('\n')
    if (/^h[1-6]$/.test(tag)) output.push(`${'#'.repeat(Number(tag[1]))} `)
    if (tag === 'li') output.push('• ')
    for (const child of children(node)) visit(child)
    if (tag === 'a') {
      const href = attr(node, 'href')
      if (href) {
        try {
          const target = new URL(href, pageUrl)
          if (['https:', 'http:'].includes(target.protocol)) output.push(` (${target.href})`)
        } catch { /* Ignore malformed outbound links. */ }
      }
    }
    if (tag === 'td' || tag === 'th') output.push(' | ')
    if (lineBreak.has(tag)) output.push('\n')
  }
  visit(root)
  return { title, text: normalized(output.join('')), ...(publishedAt ? { publishedAt } : {}), accessRequired }
}
