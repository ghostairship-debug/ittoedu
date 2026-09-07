import type { TextRun, TextRunStyle } from './contracts/native-v1'

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function styleAt(runs: readonly TextRun[], index: number): TextRunStyle {
  const style: TextRunStyle = {}
  for (const run of runs) {
    if (index >= run.start && index < run.end) Object.assign(style, run.style)
  }
  return style
}

export function buildFlowRichTextHtml(text: string, runs: readonly TextRun[] = []): string {
  return Array.from(text).map((character, index) => {
    if (character === '\n') return '<br>'
    const style = styleAt(runs, index)
    const decorations = [
      style.underline ? 'underline' : '',
      style.strike ? 'line-through' : '',
    ].filter(Boolean).join(' ')
    const css = [
      style.color !== undefined ? `color:${style.color}` : '',
      style.fontFamily !== undefined ? `font-family:${style.fontFamily}` : '',
      style.fontSize !== undefined ? `font-size:${style.fontSize}px` : '',
      style.baseline !== undefined ? `vertical-align:${style.baseline}em` : '',
      style.bold !== undefined ? `font-weight:${style.bold ? '700' : '400'}` : '',
      style.italic !== undefined ? `font-style:${style.italic ? 'italic' : 'normal'}` : '',
      decorations ? 'display:inline-block' : '',
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
    return css ? `<span style="${escapeHtml(css)}">${escapeHtml(character)}</span>` : escapeHtml(character)
  }).join('')
}

