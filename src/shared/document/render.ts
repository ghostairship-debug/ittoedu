import katex from 'katex'
import type { FlowTextContent } from './content'
import { buildFlowRichTextHtml } from '../flowRichText'

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
export function renderDocumentMath(latex: string, displayMode = false): string {
  return katex.renderToString(latex, { output: 'mathml', displayMode, throwOnError: true, trust: false, strict: 'error' })
}
/** Derived read-only markup; the product inlines remain the sole body representation. */
export function renderDocumentText(content: FlowTextContent): string {
  return content.inlines.map(inline => {
    let html: string
    if (inline.type === 'math') {
      const style = `${inline.style?.fontSize ? `font-size:${inline.style.fontSize}px;` : ''}${inline.style?.color ? `color:${inline.style.color};` : ''}`
      html = `<span data-formula-id="${escape(inline.formulaId)}" aria-label="${escape(inline.accessibleText)}" style="${escape(style)}">${renderDocumentMath(inline.latex)}</span>`
    } else {
      html = buildFlowRichTextHtml(inline.text, inline.style ? [{ start: 0, end: Array.from(inline.text).length, style: inline.style }] : [])
      if (inline.code) html = `<code>${html}</code>`
    }
    if (inline.link && /^(https?:|mailto:|#)/i.test(inline.link.href)) html = `<a href="${escape(inline.link.href)}"${inline.link.title ? ` title="${escape(inline.link.title)}"` : ''} rel="noopener noreferrer">${html}</a>`
    return html
  }).join('')
}
