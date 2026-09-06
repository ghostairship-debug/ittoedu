import { nanoid } from 'nanoid'
import { createTableLayerItem, createTableNode } from './nativeNodeFactories'
import { pptxReject, xmlAll, xmlChildren, xmlFirst, type PptxImportIssue } from './pptxPackage'
import type { NativeTableCellStyle, NativeTableStyle } from '../../shared/contracts/native-v1/types'
import { tableMergeIssues, type TableMergeRegion } from '../../shared/tableMerge'

const child = (node: Element | undefined, name: string) => node && xmlChildren(node).find(n => n.localName === name)
export function parsePptxTable(object: Element, scale: number, origin: { x: number; y: number }, color: (node: Element | undefined, fallback: string) => string, page: number, issues: PptxImportIssue[], styles?: Document) {
  const table = xmlFirst(object, 'tbl')
  if (!table) return pptxReject('graphicFrame', '此图表或图示尚未支持，请按转换清单确认')
  const cells = xmlAll(table, 'tc')
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
  const tableProps = child(table, 'tblPr')
  const styleId = xmlFirst(table, 'tableStyleId')?.textContent
  const themeStyle = styles && xmlAll(styles.documentElement, 'tblStyle').find(entry => entry.getAttribute('styleId') === styleId)
  let simplified = !!styleId && !themeStyle
  const sourceRows = xmlChildren(table).filter(n => n.localName === 'tr')
  const enabled = (name: string) => ['1', 'true'].includes(tableProps?.getAttribute(name) ?? '')
  const themeCell = (row: number, column: number) => {
    const names = ['wholeTbl', ...(enabled('bandRow') ? [row % 2 ? 'band2H' : 'band1H'] : []), ...(enabled('bandCol') ? [column % 2 ? 'band2V' : 'band1V'] : []), ...(row === 0 && enabled('firstRow') ? ['firstRow'] : []), ...(row === sourceRows.length - 1 && enabled('lastRow') ? ['lastRow'] : []), ...(column === 0 && enabled('firstCol') ? ['firstCol'] : []), ...(column === columns.length - 1 && enabled('lastCol') ? ['lastCol'] : [])]
    const style: NativeTableCellStyle = {}
    for (const name of names) {
      const region = child(themeStyle, name), text = child(region, 'tcTxStyle'), paint = child(region, 'tcStyle')
      const fill = paint && xmlFirst(paint, 'solidFill')
      if (fill) style.fillColor = color(fill, style.fillColor ?? '#ffffff')
      if (text) {
        style.textColor = color(text, style.textColor ?? '#000000')
        if (text.hasAttribute('b')) style.bold = ['1', 'true', 'on'].includes(text.getAttribute('b')!)
        if (text.hasAttribute('i')) style.italic = ['1', 'true', 'on'].includes(text.getAttribute('i')!)
      }
    }
    return style
  }
  const borders = cells.flatMap(cell => { const props = child(cell, 'tcPr'); return props ? xmlChildren(props).filter(n => ['lnL', 'lnR', 'lnT', 'lnB'].includes(n.localName)) : [] }).map(line => {
    const dash = child(line, 'prstDash')?.getAttribute('val') ?? 'solid'
    if (!['solid', 'dash', 'dot'].includes(dash)) simplified = true
    return { borderColor: color(child(line, 'solidFill'), '#000000'), borderOpacity: child(line, 'noFill') ? 0 : 1, borderWidth: number(line, 'w', 12700) * scale, lineStyle: dash === 'dash' ? 'dashed' : dash === 'dot' ? 'dotted' : 'solid' } satisfies Partial<NativeTableStyle>
  })
  const uniformBorder = borders[0]
  if (borders.some(border => JSON.stringify(border) !== JSON.stringify(uniformBorder))) simplified = true
  if (uniformBorder && uniformBorder.borderWidth > 32) pptxReject('表格边框', '适配后的边框超过 32 px')
  const rows = sourceRows.map((row, rowIndex) => {
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
        ...themeCell(rowIndex, index),
        ...(fill ? { fillColor: color(fill, '#ffffff') } : {}),
        ...(child(tcPr, 'noFill') ? { fillOpacity: 0 } : {}),
        fontSize: Math.max(6, Math.min(144, fontSize)),
        ...(child(rPr, 'solidFill') ? { textColor: color(child(rPr, 'solidFill'), '#000000') } : {}),
        ...(rPr?.hasAttribute('b') ? { bold: ['true', '1'].includes(rPr.getAttribute('b') ?? '') } : {}),
        ...(rPr?.hasAttribute('i') ? { italic: ['true', '1'].includes(rPr.getAttribute('i') ?? '') } : {}),
        horizontalAlign: pPr?.getAttribute('algn') === 'ctr' ? 'center' : pPr?.getAttribute('algn') === 'r' ? 'right' : 'left',
        verticalAlign: tcPr?.getAttribute('anchor') === 'ctr' ? 'middle' : tcPr?.getAttribute('anchor') === 'b' ? 'bottom' : 'top',
      }
      const family = child(rPr, 'ea')?.getAttribute('typeface') || child(rPr, 'latin')?.getAttribute('typeface')
      if (family && !family.startsWith('+')) style.fontFamily = family
      return { id: nanoid(), columnId: columns[index]!.id, text, style }
    }) }
  })
  if (!rows.length || rows.length > 1000 || rows.some(r => r.height < 20 || r.height > 2000)) pptxReject('表格结构', '行数或适配后的行高超出 Native Table 范围（20–2000 px）')
  const sourceGrid = sourceRows.map(row => xmlChildren(row).filter(node => node.localName === 'tc'))
  const merges: TableMergeRegion[] = []
  const covered = new Set<string>()
  const flag = (cell: Element, name: string) => ['1', 'true'].includes(cell.getAttribute(name) ?? '')
  for (const [r, row] of sourceGrid.entries()) for (const [c, cell] of row.entries()) {
    if (flag(cell, 'hMerge') || flag(cell, 'vMerge')) continue
    const rs = number(cell, 'rowSpan', 1), cs = number(cell, 'gridSpan', 1)
    if (!Number.isInteger(rs) || !Number.isInteger(cs) || rs < 1 || cs < 1 || r + rs > rows.length || c + cs > columns.length) pptxReject('合并表格', '区域跨度越界或无效')
    if (rs === 1 && cs === 1) continue
    const merge = { rowIds: rows.slice(r, r + rs).map(row => row.id), columnIds: columns.slice(c, c + cs).map(column => column.id) }
    merges.push(merge)
    const text: string[] = []
    for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) {
      const source = sourceGrid[y]![x]!
      if (flag(source, 'hMerge') !== (x > c) || flag(source, 'vMerge') !== (y > r)) pptxReject('合并表格', '锚点和覆盖格标记不一致，未导入此表格')
      const key = `${y}:${x}`
      if (covered.has(key)) pptxReject('合并表格', '区域重叠')
      covered.add(key)
      const target = rows[y]!.cells[x]!
      if (target.text) text.push(target.text)
      target.text = ''
    }
    rows[r]!.cells[c]!.text = text.join('\n')
    if (rows[r]!.cells[c]!.text.length > 20000) pptxReject('合并表格', '合并正文超过单元格长度上限')
  }
  for (const [r, row] of sourceGrid.entries()) for (const [c, cell] of row.entries()) {
    if ((flag(cell, 'hMerge') || flag(cell, 'vMerge')) && !covered.has(`${r}:${c}`)) pptxReject('合并表格', '覆盖格没有锚点')
  }
  if (tableMergeIssues({ rows, columns, merges }).length) pptxReject('合并表格', '区域结构无效')
  if (simplified) issues.push({ page, type: '表格样式', message: '表格内容与尺寸可编辑；主题表格样式、逐边框和单元格内混合文字格式已简化' })
  return createTableLayerItem(createTableNode({ name: xmlFirst(object, 'cNvPr')?.getAttribute('name') || '导入表格', x: number(off, 'x') * scale + origin.x, y: number(off, 'y') * scale + origin.y, width, height, rotation: number(xfrm, 'rot') / 60000, columns, rows, ...(merges.length ? { merges } : {}), headerRowCount: 0, style: { fontSize: Math.max(6, Math.min(144, 18 * 12700 * scale)), cellPadding: 0, ...uniformBorder } }))
}
