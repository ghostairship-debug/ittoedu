import { parse, serialize, serializeOuter, type DefaultTreeAdapterTypes } from 'parse5'
import { htmlDocumentKind } from '../../../../shared/html/documentKind'
import { measuredFragmentDocumentCss } from '../../../../components/web/measuredFragmentBox'

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

/** A local semantic scope keeps author CSS/ancestor selectors; only outer placement moves to its frame. */
export function retainedMeasurementScopeHtml(input: { html: string; themeCss?: string }, sourcePath: readonly number[],
  options: { programOrigin?: { x: number; y: number; viewport: { width: number; height: number } } } = {}): string {
  if (!sourcePath.length) return input.html
  const document = parse(input.html, { sourceCodeLocationInfo: true })
  const documentKind = htmlDocumentKind(document)
  const html = document.childNodes.find(isElement)!
  const body = html.childNodes.find((node): node is HtmlElement => isElement(node) && node.tagName === 'body')!
  const head = html.childNodes.find((node): node is HtmlElement => isElement(node) && node.tagName === 'head')!
  const at = (path: readonly number[]) => path.reduce<HtmlNode | undefined>((node, index) => isElement(node!) ? node!.childNodes[index] : undefined, body)
  const scope = at(sourcePath)
  if (!scope || !isElement(scope)) throw new Error('Measured semantic scope no longer maps to source HTML')
  const appendStyle = (css: string, prepend = false) => {
    const parsed = parse(`<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
    const style = parsed.childNodes.find(isElement)!.childNodes.find(node => isElement(node) && node.tagName === 'head') as HtmlElement
    for (const node of style.childNodes) node.parentNode = head
    if (prepend) head.childNodes.unshift(...style.childNodes)
    else head.childNodes.push(...style.childNodes)
  }
  if (options.programOrigin) {
    // Keep the complete program DOM, including scripts/templates outside its
    // visible root. Move only the fragment's software document shell, so the
    // author's original coordinates and later root movement remain executable.
    const { x, y, viewport } = options.programOrigin
    body.attrs.push({ name: 'data-guoling-program-viewport', value: '' })
    if (input.themeCss) appendStyle(input.themeCss, true)
    // The original canvas can exceed this local carrier. Clip its software
    // viewport, keeping body/root clipping and program movement inside it intact.
    appendStyle(`${measuredFragmentDocumentCss()}
html{overflow:hidden!important}
body[data-guoling-program-viewport]{position:relative!important;left:${-x}px!important;top:${-y}px!important;width:${viewport.width}px!important;height:${viewport.height}px!important}`)
    // A fragment was measured in standards mode; making its document shell
    // explicit must not accidentally turn the program into a quirks document.
    return (documentKind === 'fragment' ? '<!doctype html>' : '') + serialize(document)
  }
  // Body-level styles outside the selected region remain its original CSS context.
  const outsideStyles: HtmlElement[] = []
  const scanStyles = (node: HtmlNode): void => {
    if (!isElement(node) || node === scope) return
    if (node.tagName === 'style' || node.tagName === 'link' && /(?:^|\s)stylesheet(?:\s|$)/i.test(attribute(node, 'rel') ?? '')) outsideStyles.push(node)
    else node.childNodes.forEach(scanStyles)
  }
  body.childNodes.forEach(scanStyles)
  for (const node of outsideStyles) { node.parentNode = head; head.childNodes.push(node) }
  scope.attrs.push({ name: 'data-guoling-source-scope', value: '' })
  let current = scope
  while (current !== body) {
    const parent = current.parentNode as HtmlElement
    parent.childNodes = [current]
    if (parent !== body) parent.attrs.push({ name: 'data-guoling-source-ancestor', value: '' })
    current = parent
  }
  if (input.themeCss) appendStyle(input.themeCss, true)
  // The author's subtree and stylesheet rules remain live. These software-owned
  // declarations normalize only the source scope's external coordinate owner.
  appendStyle(`${measuredFragmentDocumentCss()}
[data-guoling-source-ancestor]{display:contents!important;transform:none!important;translate:none!important;rotate:none!important;scale:none!important;zoom:1!important;opacity:1!important;filter:none!important}
[data-guoling-source-scope]{position:relative!important;inset:auto!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;margin:0!important;transform:none!important;translate:none!important;rotate:none!important;scale:none!important;zoom:1!important;width:100%!important;height:100%!important;min-width:0!important;max-width:none!important;min-height:0!important;max-height:none!important;box-sizing:border-box!important;float:none!important}`)
  // The html/head/body nodes introduced by parsing a fragment are software
  // wrappers, not an authored quirks document. Keep its CSS and ancestor scope
  // without changing the source kind used by the existing carrier selection.
  return documentKind === 'fragment' ? serialize(head) + serialize(body) : serialize(document)
}

/** Resource preparation remains the existing resource owner's job; only supplied URL bindings are used. */
export function prepareMeasurementDocument(input: { html: string; themeCss?: string; courseThemeCss?: string; resourceUrls?: Readonly<Record<string, string>> }): PreparedMeasurementDocument {
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
  const courseTheme = input.courseThemeCss ? `<style data-guoling-measurement-course-theme>${resource(input.courseThemeCss).replace(/<\/style/gi, '<\\/style')}</style>` : ''
  const additions = parse(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' data: https:; img-src data: blob: https:; font-src data: https:; media-src data: https:; script-src 'none'; frame-src 'none'">${fragmentDefaults}${courseTheme}${input.themeCss ? `<style>${resource(input.themeCss).replace(/<\/style/gi, '<\\/style')}</style>` : ''}`)
  const addedHead = additions.childNodes.find(isElement)?.childNodes.find(node => isElement(node) && node.tagName === 'head') as HtmlElement
  head.childNodes.unshift(...addedHead.childNodes)
  addedHead.childNodes.forEach(node => { node.parentNode = head! })
  // A fragment is inserted into the standard editor/player document. Its
  // synthetic measurement wrapper must use that same inline formatting mode.
  // Explicit author documents retain their own doctype (including quirks mode).
  return { html: (documentKind === 'fragment' ? '<!doctype html>' : '') + serialize(document), documentKind, documentProgramReason, originalElements }
}
