import { parse, type DefaultTreeAdapterTypes } from 'parse5'

export type HtmlDocumentKind = 'document' | 'fragment'

/** Read author syntax before resource projection adds implicit html/head/body elements. */
export function htmlDocumentKind(source: string | DefaultTreeAdapterTypes.Document): HtmlDocumentKind {
  const document = typeof source === 'string' ? parse(source, { sourceCodeLocationInfo: true }) : source
  const html = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node)
  const authored = document.childNodes.some(node => node.nodeName === '#documentType')
    || html?.sourceCodeLocation?.startTag
    || html?.childNodes.some(node => 'tagName' in node && ['head', 'body'].includes(node.tagName) && node.sourceCodeLocation?.startTag)
  return authored ? 'document' : 'fragment'
}
