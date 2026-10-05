import { parse, serialize, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { htmlDocumentKind } from '../../../../shared/html/documentKind'

type HtmlElement = DefaultTreeAdapterTypes.Element
type HtmlNode = DefaultTreeAdapterTypes.ChildNode
const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node
const attribute = (element: HtmlElement, name: string) => element.attrs.find(item => item.name === name)?.value

export interface PreparedMeasurementDocument {
  html: string
  documentKind: 'document' | 'fragment'
  documentProgramReason?: string
  originalElements: Map<string, { attributes: Record<string, string>; sourceHtml: string }>
}

/** Resource preparation remains the existing resource owner's job; only supplied URL bindings are used. */
export function prepareMeasurementDocument(input: { html: string; themeCss?: string; resourceUrls?: Readonly<Record<string, string>> }): PreparedMeasurementDocument {
  const document = parse(input.html, { sourceCodeLocationInfo: true })
  const documentKind = htmlDocumentKind(document)
  const originalElements = new Map<string, { attributes: Record<string, string>; sourceHtml: string }>()
  let body: HtmlElement | undefined, head: HtmlElement | undefined, documentProgramReason: string | undefined
  const resource = (text: string) => text.replace(/cw-resource:([a-zA-Z0-9_.-]+)/g, (reference, key: string) => input.resourceUrls?.[reference] ?? input.resourceUrls?.[key] ?? reference)
  const scan = (node: HtmlNode, path?: number[]): void => {
    if (!isElement(node)) return
    if (node.tagName === 'body') { body = node; path = [] }
    if (node.tagName === 'head') head = node
    if (path) {
      const location = node.sourceCodeLocation
      originalElements.set(path.join('/'), { attributes: Object.fromEntries(node.attrs.map(item => [item.prefix ? `${item.prefix}:${item.name}` : item.name, item.value])),
        sourceHtml: location ? input.html.slice(location.startOffset, location.endOffset) : serializeOuter(node) })
    }
    if (node.tagName === 'template') return
    if (node.attrs.some(item => /^on[a-z]/i.test(item.name)
      || /^(?:href|src|action|formaction)$/.test(item.name) && /^javascript:/i.test(item.value.trim().replace(/[\t\r\n]/g, '')))) documentProgramReason = 'event-handler'
    if (node.tagName === 'script') {
      const type = (attribute(node, 'type') ?? '').trim().toLowerCase().split(';')[0]!.trim()
      if (!type || ['module', 'importmap', 'speculationrules', 'text/jscript', 'text/livescript'].includes(type)
        || /^(?:text|application)\/(?:x-)?(?:java|ecma)script(?:1\.[0-5])?$/.test(type)) documentProgramReason = 'script'
    }
    // The browser copy resolves assets; original region source and authored attributes remain unchanged.
    node.attrs.forEach(item => { item.value = resource(item.value) })
    if (node.tagName === 'style') node.childNodes.forEach(child => { if (child.nodeName === '#text') (child as DefaultTreeAdapterTypes.TextNode).value = resource((child as DefaultTreeAdapterTypes.TextNode).value) })
    node.childNodes.forEach((child, index) => scan(child, path ? [...path, index] : undefined))
  }
  document.childNodes.forEach(child => scan(child))
  if (!body || !head) throw new Error('HTML parser did not produce a document body/head')
  // Reuse the content permission boundary: no program, embedded navigation or file access during measurement.
  const fragmentDefaults = documentKind === 'fragment' ? '<style>html,body{width:100%;height:100%;margin:0}</style>' : ''
  const additions = parse(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' data: https:; img-src data: blob: https:; font-src data: https:; media-src data: https:; script-src 'none'; frame-src 'none'">${fragmentDefaults}${input.themeCss ? `<style>${resource(input.themeCss).replace(/<\/style/gi, '<\\/style')}</style>` : ''}`)
  const addedHead = additions.childNodes.find(isElement)?.childNodes.find(node => isElement(node) && node.tagName === 'head') as HtmlElement
  head.childNodes.unshift(...addedHead.childNodes)
  addedHead.childNodes.forEach(node => { node.parentNode = head! })
  return { html: serialize(document), documentKind, documentProgramReason, originalElements }
}
