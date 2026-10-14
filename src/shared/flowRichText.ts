import type { TextRun, TextRunStyle } from './contracts/native-v1'
import { flowRichTextSegments } from './flowRichTextSegments'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

export function buildFlowRichTextHtml(text: string, runs: readonly TextRun[] = []): string {
  return flowRichTextSegments(text, runs).map(segment => {
    const css = buildFlowTextStyleCss(segment.style)
    return segment.text.split('\n').map(text => css && text ? `<span style="${escapeHtml(css)}">${escapeHtml(text)}</span>` : escapeHtml(text)).join('<br>')
  }).join('')
}

/** Shared inline appearance for editable text and every Published carrier. */
export function buildFlowTextStyleCss(style: TextRunStyle): string {
  const decorations = [
    style.underline ? 'underline' : '',
    style.strike ? 'line-through' : '',
  ].filter(Boolean).join(' ')
  return [
    style.color !== undefined ? `color:${style.color}` : '',
    style.fontFamily !== undefined ? `font-family:${style.fontFamily}` : '',
    style.fontSize !== undefined ? `font-size:${style.fontSize}px` : '',
    style.baseline !== undefined ? `vertical-align:${style.baseline}em` : '',
    style.bold !== undefined ? `font-weight:${style.bold ? '700' : '400'}` : '',
    style.italic !== undefined ? `font-style:${style.italic ? 'italic' : 'normal'}` : '',
    decorations ? `text-decoration-line:${decorations}` : '',
    style.highlightColor ? `background-color:${style.highlightColor}` : '',
    style.highlightColor === null ? 'background-color:transparent' : '',
    style.emphasis !== undefined
      ? `text-emphasis-style:${style.emphasis ? 'filled circle' : 'none'}`
      : '',
    style.emphasis !== undefined
      ? `-webkit-text-emphasis-style:${style.emphasis ? 'filled circle' : 'none'}`
      : '',
    style.emphasis !== undefined ? 'text-emphasis-position:under right' : '',
    style.emphasis !== undefined ? '-webkit-text-emphasis-position:under right' : '',
  ].filter(Boolean).join(';')
}
