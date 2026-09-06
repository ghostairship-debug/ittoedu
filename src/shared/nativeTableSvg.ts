import { buildNativeTableLayout, type NativeTableLayoutContent } from './nativeTableLayout'

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Static camera rendering shares cell geometry and effective styles with the live table. */
export function buildNativeTableSvg(table: NativeTableLayoutContent, width: number, height: number, id: string): string {
  const layout = buildNativeTableLayout(table, { width, height })
  let context: CanvasRenderingContext2D | null = null
  try { context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d') } catch { /* Headless callers use deterministic font estimates. */ }
  const cells = layout.cells.map((cell, index) => {
    const s = cell.style
    const padding = s.cellPadding
    const availableWidth = Math.max(1, cell.width - padding * 2)
    if (context) context.font = `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${s.fontSize}px ${s.fontFamily}`
    const measure = (text: string) => context?.measureText(text).width ?? Array.from(text).reduce((sum, character) => sum + s.fontSize * (/[^\u0000-\u00ff]/u.test(character) ? 1 : 0.6), 0)
    const lines: string[] = []
    for (const paragraph of cell.text.split(/\r?\n/u)) {
      let line = ''
      for (const character of paragraph) {
        if (line && measure(line + character) > availableWidth) { lines.push(line); line = '' }
        line += character
      }
      lines.push(line)
    }
    const lineHeight = s.fontSize * 1.2
    const textHeight = lines.length * lineHeight
    const y = cell.y + (s.verticalAlign === 'middle' ? Math.max(padding, (cell.height - textHeight) / 2) : s.verticalAlign === 'bottom' ? Math.max(padding, cell.height - textHeight - padding) : padding) + s.fontSize
    const x = cell.x + (s.horizontalAlign === 'center' ? cell.width / 2 : s.horizontalAlign === 'right' ? cell.width - padding : padding)
    const anchor = s.horizontalAlign === 'center' ? 'middle' : s.horizontalAlign === 'right' ? 'end' : 'start'
    const clip = `table-${id}-${index}`
    const dash = s.lineStyle === 'dashed' ? ' stroke-dasharray="8 5"' : s.lineStyle === 'dotted' ? ' stroke-dasharray="2 4"' : ''
    return `<g data-table-cell-id="${xml(cell.id)}"><defs><clipPath id="${xml(clip)}"><rect x="${cell.x + padding}" y="${cell.y + padding}" width="${availableWidth}" height="${Math.max(0, cell.height - padding * 2)}"/></clipPath></defs><rect x="${cell.x}" y="${cell.y}" width="${cell.width}" height="${cell.height}" fill="${xml(s.fillColor)}" fill-opacity="${s.fillOpacity}" stroke="${xml(s.borderColor)}" stroke-opacity="${s.borderOpacity}" stroke-width="${s.borderWidth}"${dash}/><text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${xml(s.fontFamily)}" font-size="${s.fontSize}" font-weight="${s.bold ? 700 : 400}" font-style="${s.italic ? 'italic' : 'normal'}" fill="${xml(s.textColor)}" clip-path="url(#${xml(clip)})">${lines.map((line, lineIndex) => `<tspan x="${x}" dy="${lineIndex ? lineHeight : 0}">${xml(line)}</tspan>`).join('')}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-native-table-id="${xml(id)}">${cells}</svg>`
}
