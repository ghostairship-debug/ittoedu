import { nanoid } from 'nanoid'
import { createTableLayerItem, createTableNode } from './nativeNodeFactories'
import { pptxReject, xmlAll, xmlChildren, xmlFirst, type PptxImportIssue } from './pptxPackage'
import type { NativeTableCellStyle, NativeTableStyle } from '../../shared/contracts/native-v1/types'

const child = (node: Element | undefined, name: string) => node && xmlChildren(node).find(n => n.localName === name)
export function parsePptxTable(object: Element, scale: number, origin: { x: number; y: number }, color: (node: Element | undefined, fallback: string) => string, page: number, issues: PptxImportIssue[]) {
  const table = xmlFirst(object, 'tbl')
  if (!table) return pptxReject('graphicFrame', '此图表或图示尚未支持，请按转换清单确认')
  const cells = xmlAll(table, 'tc')
  if (cells.some(c => ['gridSpan', 'rowSpan'].some(a => Number(c.getAttribute(a) ?? 1) !== 1) || ['hMerge', 'vMerge'].some(a => ['true', '1'].includes(c.getAttribute(a) ?? '')))) pptxReject('合并表格', '当前 Native Table 不支持合并单元格，未导入此表格；可在源文件拆分单元格或另存图片补入')
  const xfrm = child(object, 'xfrm'), off = child(xfrm, 'off'), ext = child(xfrm, 'ext')
  const number = (node: Element | undefined, key: string, fallback = 0) => {
    const value = Number(node?.getAttribute(key) ?? fallback)
    if (!Number.isFinite(value)) pptxReject('表格几何', '数值无效')
    return value
  }
  const width = number(ext, 'cx') * scale, height = number(ext, 'cy') * scale
  const grid = child(table, 'tblGrid')
  const columns = (grid ? xmlChildren(grid) : []).map(c => ({ id: nanoid(), width: number(c, 'w') * scale }))
  if (!columns.length || columns.length > 100 || columns.some(c => c.width < 24 || c.width > 2000) || width <= 0 || height <= 0) pptxReject('表格几何', '列数或适配后的列宽超出 Native Table 范围（24–2000 px）')
  let simplified = !!xmlFirst(table, 'tableStyleId')
  const borders = cells.flatMap(cell => { const props = child(cell, 'tcPr'); return props ? xmlChildren(props).filter(n => ['lnL', 'lnR', 'lnT', 'lnB'].includes(n.localName)) : [] }).map(line => {
    const dash = child(line, 'prstDash')?.getAttribute('val') ?? 'solid'
    if (!['solid', 'dash', 'dot'].includes(dash)) simplified = true
    return { borderColor: color(child(line, 'solidFill'), '#000000'), borderOpacity: child(line, 'noFill') ? 0 : 1, borderWidth: number(line, 'w', 12700) * scale, lineStyle: dash === 'dash' ? 'dashed' : dash === 'dot' ? 'dotted' : 'solid' } satisfies Partial<NativeTableStyle>
  })
  const uniformBorder = borders[0]
  if (borders.some(border => JSON.stringify(border) !== JSON.stringify(uniformBorder))) simplified = true
  if (uniformBorder && uniformBorder.borderWidth > 32) pptxReject('表格边框', '适配后的边框超过 32 px')
  const rows = xmlChildren(table).filter(n => n.localName === 'tr').map(row => {
    const sourceCells = xmlChildren(row).filter(n => n.localName === 'tc')
    if (sourceCells.length !== columns.length) pptxReject('表格结构', '单元格数量与列定义不一致')
    return { id: nanoid(), height: number(row, 'h') * scale, cells: sourceCells.map((cell, index) => {
      const tcPr = child(cell, 'tcPr'), body = child(cell, 'txBody')
      const paragraphs = body ? xmlChildren(body).filter(n => n.localName === 'p') : []
      const text = paragraphs.map(p => xmlChildren(p).map(n => n.localName === 'br' ? '\n' : n.localName === 'r' || n.localName === 'fld' ? xmlFirst(n, 't')?.textContent ?? '' : '').join('')).join('\n')
      const rPr = body && (xmlFirst(body, 'rPr') ?? xmlFirst(body, 'defRPr')), pPr = body && xmlFirst(body, 'pPr')
      if (body && new Set(xmlAll(body, 'rPr').map(n => new XMLSerializer().serializeToString(n))).size > 1) simplified = true
      const fill = child(tcPr, 'solidFill'), fontSize = number(rPr, 'sz', 1800) / 100 * 12700 * scale
      if (fontSize < 6 || fontSize > 144) simplified = true
      if (text.length > 20_000) pptxReject('表格文字', '单元格文字超过 20000 字符')
      const style: NativeTableCellStyle = {
        ...(fill ? { fillColor: color(fill, '#ffffff') } : {}),
        ...(child(tcPr, 'noFill') ? { fillOpacity: 0 } : {}),
        fontSize: Math.max(6, Math.min(144, fontSize)),
        textColor: color(child(rPr, 'solidFill'), '#000000'),
        bold: ['true', '1'].includes(rPr?.getAttribute('b') ?? ''), italic: ['true', '1'].includes(rPr?.getAttribute('i') ?? ''),
        horizontalAlign: pPr?.getAttribute('algn') === 'ctr' ? 'center' : pPr?.getAttribute('algn') === 'r' ? 'right' : 'left',
        verticalAlign: tcPr?.getAttribute('anchor') === 'ctr' ? 'middle' : tcPr?.getAttribute('anchor') === 'b' ? 'bottom' : 'top',
      }
      const family = child(rPr, 'ea')?.getAttribute('typeface') || child(rPr, 'latin')?.getAttribute('typeface')
      if (family && !family.startsWith('+')) style.fontFamily = family
      return { id: nanoid(), columnId: columns[index]!.id, text, style }
    }) }
  })
  if (!rows.length || rows.length > 1000 || rows.some(r => r.height < 20 || r.height > 2000)) pptxReject('表格结构', '行数或适配后的行高超出 Native Table 范围（20–2000 px）')
  if (simplified) issues.push({ page, type: '表格样式', message: '表格内容与尺寸可编辑；主题表格样式、逐边框和单元格内混合文字格式已简化' })
  return createTableLayerItem(createTableNode({ name: xmlFirst(object, 'cNvPr')?.getAttribute('name') || '导入表格', x: number(off, 'x') * scale + origin.x, y: number(off, 'y') * scale + origin.y, width, height, rotation: number(xfrm, 'rot') / 60000, columns, rows, headerRowCount: 0, style: { fontSize: Math.max(6, Math.min(144, 18 * 12700 * scale)), cellPadding: 0, ...uniformBorder } }))
}
