import katex from 'katex'
import type { FlowTextContent } from './content'
import { buildFlowRichTextHtml } from '../flowRichText'

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
export function renderDocumentMath(latex: string, displayMode = false): string {
  return katex.renderToString(latex, { output: 'mathml', displayMode, throwOnError: true, trust: false, strict: 'error' })
}
interface FormulaStyle { readonly fontSize?: number; readonly color?: string }
const formulaStyleCss = (style: FormulaStyle | undefined) => `${style?.fontSize ? `font-size:${style.fontSize}px;` : ''}${style?.color ? `color:${style.color};` : ''}`

/** A display formula as Flow draws it in the editor and in playback (M19): one renderer, one frame. */
export function flowFormulaBlockElement(dom: Document, block: { readonly latex: string; readonly accessibleText: string; readonly formulaId: string; readonly style?: FormulaStyle }): HTMLElement {
  const wrap = dom.createElement('div')
  wrap.dataset.flowFormulaId = block.formulaId
  wrap.setAttribute('aria-label', block.accessibleText)
  // Wide formulas scroll sideways; the vertical axis never grows a scroll bar of its own.
  wrap.style.cssText = `overflow-x:auto;overflow-y:hidden;padding-block:4px;${formulaStyleCss(block.style)}`
  wrap.innerHTML = renderDocumentMath(block.latex, true)
  return wrap
}
/** An inline formula as Flow draws it in the editor and in playback. */
export function flowInlineFormulaHtml(inline: { readonly latex: string; readonly accessibleText: string; readonly formulaId: string; readonly style?: FormulaStyle }): string {
  return `<span data-formula-id="${escape(inline.formulaId)}" aria-label="${escape(inline.accessibleText)}" style="${escape(formulaStyleCss(inline.style))}">${renderDocumentMath(inline.latex)}</span>`
}
/** Derived read-only markup; the product inlines remain the sole body representation. */
export function renderDocumentText(content: FlowTextContent): string {
  return content.inlines.map(inline => {
    let html: string
    if (inline.type === 'math') {
      html = flowInlineFormulaHtml(inline)
    } else {
      html = buildFlowRichTextHtml(inline.text, inline.style ? [{ start: 0, end: Array.from(inline.text).length, style: inline.style }] : [])
      if (inline.code) html = `<code>${html}</code>`
    }
    if (inline.link && /^(https?:|mailto:|#)/i.test(inline.link.href)) html = `<a href="${escape(inline.link.href)}"${inline.link.title ? ` title="${escape(inline.link.title)}"` : ''} rel="noopener noreferrer">${html}</a>`
    return html
  }).join('')
}
