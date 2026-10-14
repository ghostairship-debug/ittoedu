import type { DefaultTreeAdapterTypes } from 'parse5'
import { cleanText, httpUrl } from '../assetSources/licensePolicy'

type Node = DefaultTreeAdapterTypes.Node
type Element = DefaultTreeAdapterTypes.Element
/** Source facts only. Page publication dates never become image creation dates. */
export interface WebPageImage {
  fileUrl: string
  title: string
  caption?: string
  author?: string
  licenseUrl?: string
  dateCreated?: string
  width?: number
  height?: number
}
const isElement = (node: Node): node is Element => 'tagName' in node
const children = (node: Node): readonly Node[] => 'childNodes' in node ? node.childNodes : []
const attr = (node: Element, name: string) => node.attrs.find(value => value.name === name)?.value
const text = (node: Node): string => 'value' in node ? node.value : children(node).map(text).join(' ')
function first(node: Node, predicate: (element: Element) => boolean): Element | undefined {
  if (isElement(node) && predicate(node)) return node
  for (const child of children(node)) { const value = first(child, predicate); if (value) return value }
  return undefined
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** ImageObject and each figure carry their own rights; a generic page/footer license is not copied onto third-party images. */
export function webPageImages(document: Node, pageUrl: string, pageTitle: string): WebPageImage[] {
  const found = new Map<string, WebPageImage>()
  const url = (value: unknown) => {
    if (record(value)) value = value.url ?? value['@id']
    if (typeof value !== 'string' || !value.trim()) return undefined
    try { return httpUrl(new URL(value, pageUrl).href) } catch { return undefined }
  }
  const dimension = (value: unknown) => {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
    return Number.isSafeInteger(number) && number > 0 ? number : undefined
  }
  const insert = (image: WebPageImage) => found.set(image.fileUrl, { ...image, ...found.get(image.fileUrl) })
  const json = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(json); return }
    if (!record(value)) return
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
    if (types.some(type => typeof type === 'string' && /(?:^|[/#])ImageObject$/.test(type))) {
      const fileUrl = url(value.contentUrl ?? value.url)
      if (fileUrl) {
        const creator = value.creator ?? value.author
        const author = cleanText(record(creator) ? creator.name : creator, 160)
        const caption = cleanText(value.caption ?? value.description, 500), licenseUrl = url(value.license)
        const dateCreated = typeof value.dateCreated === 'string' && !Number.isNaN(Date.parse(value.dateCreated)) ? value.dateCreated : undefined
        const width = dimension(value.width), height = dimension(value.height)
        insert({ fileUrl, title: cleanText(value.name ?? value.caption, 200) ?? pageTitle,
          ...(author ? { author } : {}), ...(caption ? { caption } : {}), ...(licenseUrl ? { licenseUrl } : {}),
          ...(dateCreated ? { dateCreated } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}) })
      }
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') json(child)
  }
  const visit = (node: Node, figure?: Element): void => {
    if (isElement(node)) {
      if (node.tagName === 'script' && attr(node, 'type')?.toLowerCase() === 'application/ld+json') {
        try { json(JSON.parse(text(node))) } catch { /* Invalid metadata does not make the rest of the page unusable. */ }
        return
      }
      if (['style', 'script', 'nav', 'footer', 'noscript'].includes(node.tagName) || attr(node, 'hidden') !== undefined || attr(node, 'aria-hidden') === 'true') return
      if (node.tagName === 'figure') figure = node
      if (node.tagName === 'img') {
        const fileUrl = url(attr(node, 'data-src') ?? attr(node, 'src'))
        if (fileUrl) {
          const captionNode = figure && first(figure, element => element.tagName === 'figcaption')
          const licenseNode = figure && first(figure, element => (attr(element, 'rel') ?? '').split(/\s+/).includes('license'))
          const caption = cleanText(captionNode ? text(captionNode) : attr(node, 'alt'), 500)
          const licenseUrl = licenseNode ? url(attr(licenseNode, 'href')) : undefined
          const width = dimension(attr(node, 'width')), height = dimension(attr(node, 'height'))
          insert({ fileUrl, title: cleanText(attr(node, 'alt') ?? attr(node, 'title'), 200) ?? pageTitle,
            ...(caption ? { caption } : {}), ...(licenseUrl ? { licenseUrl } : {}), ...(width ? { width } : {}), ...(height ? { height } : {}) })
        }
      }
    }
    for (const child of children(node)) visit(child, figure)
  }
  visit(document)
  return [...found.values()]
}
