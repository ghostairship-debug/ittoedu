import { strToU8, zipSync } from 'fflate'
import { layoutTable } from '../../../../components/table/render'
import { chartOutputAdapter } from '../../../../components/chart/output'
import type { ChartData } from '../../../../components/chart/data'
import { toNativeTableData, tableLayoutCellContent, type TableData } from '../../../../components/table/data'
import type { FlowTextContent } from '../../../../shared/document/content'
import type { NativeTableEffectiveCellStyle } from '../../../../shared/nativeTableLayout'
import type { ShapeData } from '../../../../components/shape/data'
import { tableCellSpan } from '../../../../shared/tableMerge'
import { resolveNativeShapePath } from '../../../../shared/nativeShapePath'
import { drawingMlPathGeometryXml, drawingMlGradientFillXml } from '../../drawingMlShapeGeometry'
import { escapeOutput as x } from './reading'

const color = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? value.slice(1) : '000000'
const text = (value: string) => `<w:r><w:t xml:space="preserve">${x(value)}</w:t></w:r>`
const pxTwips = (value: number) => Math.round(value * 15)

/** Word-native cells consume the professional layout, including merged-cell ownership. */
export function wordTable(data: TableData, width: number, paragraph: (content: FlowTextContent, style: NativeTableEffectiveCellStyle) => string): string {
  const layout = layoutTable(data, { width })
  const native = toNativeTableData(data)
  const rows = native.rows.map((row, ri) => {
    const cells = data.columns.map((column, ci) => {
      const span = tableCellSpan(native, row.id, column.id)
      if (span.columnOffset > 0) return ''
      const owner = layout.cells.find(cell => cell.rowIndex === ri - span.rowOffset && cell.columnIndex === ci)!
      const style = owner.style
      const borders = ['top', 'left', 'bottom', 'right'].map(edge => `<w:${edge} w:val="${style.lineStyle === 'solid' ? 'single' : style.lineStyle === 'dashed' ? 'dashed' : 'dotted'}" w:sz="${Math.max(0, Math.round(style.borderWidth * 6))}" w:color="${color(style.borderColor)}"/>`).join('')
      const merge = `${span.columnSpan > 1 ? `<w:gridSpan w:val="${span.columnSpan}"/>` : ''}${span.rowSpan > 1 ? `<w:vMerge w:val="${span.rowOffset ? 'continue' : 'restart'}"/>` : ''}`
      const padding = ['top', 'left', 'bottom', 'right'].map(edge => `<w:${edge} w:w="${pxTwips(style.cellPadding)}" w:type="dxa"/>`).join('')
      const body = span.covered ? '<w:p/>' : paragraph(tableLayoutCellContent(data, owner), style)
      return `<w:tc><w:tcPr><w:tcW w:w="${pxTwips(owner.width)}" w:type="dxa"/>${merge}<w:shd w:fill="${color(style.fillColor)}"/><w:tcBorders>${borders}</w:tcBorders><w:tcMar>${padding}</w:tcMar><w:vAlign w:val="${style.verticalAlign === 'middle' ? 'center' : style.verticalAlign}"/></w:tcPr>${body}</w:tc>`
    }).join('')
    return `<w:tr><w:trPr>${ri < native.headerRowCount ? '<w:tblHeader/>' : ''}<w:trHeight w:val="${pxTwips(layout.rows[ri]!.height)}" w:hRule="atLeast"/></w:trPr>${cells}</w:tr>`
  }).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="${pxTwips(width)}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${layout.columns.map(column => `<w:gridCol w:w="${pxTwips(column.width)}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`
}

function inlineDrawing(id: number, name: string, graphic: string, width: number, height: number): string {
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(width * 9525)}" cy="${Math.round(height * 9525)}"/><wp:docPr id="${id}" name="${x(name)}"/><a:graphic>${graphic}</a:graphic></wp:inline></w:drawing></w:r></w:p>`
}
export function wordChartDrawing(id: number, relationship: string, title: string, width: number, height: number): string {
  return inlineDrawing(id, title, `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${relationship}"/></a:graphicData>`, width, height)
}

const presets: Partial<Record<ShapeData['shapeType'], string>> = {
  rectangle: 'rect', 'rounded-rectangle': 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond',
  line: 'line', 'elbow-arrow': 'bentConnector3', 'arrow-left': 'leftArrow', 'arrow-right': 'rightArrow',
  'arrow-up': 'upArrow', 'arrow-down': 'downArrow', 'arrow-left-right': 'leftRightArrow',
  'brace-left': 'leftBrace', 'brace-right': 'rightBrace', 'brace-pair-horizontal': 'bracePair',
  'bracket-left': 'leftBracket', 'bracket-right': 'rightBracket', 'emphasis-dot': 'ellipse', 'emphasis-triangle': 'triangle',
}
export function wordShapeDrawing(data: ShapeData, id: number, width: number, height: number): string | undefined {
  let path = resolveNativeShapePath(data, width, height)
  if (data.lineGeometry) {
    const line = data.lineGeometry
    const points = line.kind === 'straight' ? [line.start, line.end] : line.axis === 'horizontal'
      ? [line.start, [line.position, line.start[1]], [line.position, line.end[1]], line.end]
      : [line.start, [line.start[0], line.position], [line.end[0], line.position], line.end]
    path = { paths: [{ fill: false, stroke: true, commands: points.map((to, index) => ({ kind: index ? 'line' : 'move', to: to as [number, number] })) }] }
  }
  const preset = presets[data.shapeType]
  if (!path && !preset) return undefined
  const style = data.style
  const geometry = path ? drawingMlPathGeometryXml(path) : `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`
  const fill = data.shapeType === 'line' || data.shapeType === 'elbow-arrow' ? '<a:noFill/>' : style.fillGradient
    ? drawingMlGradientFillXml(style.fillGradient, width, height, style.fillOpacity)
    : `<a:solidFill><a:srgbClr val="${color(style.fillColor)}"><a:alpha val="${Math.round(style.fillOpacity * 100000)}"/></a:srgbClr></a:solidFill>`
  const stroke = `<a:ln w="${Math.round(style.borderWidth * 9525)}"><a:solidFill><a:srgbClr val="${color(style.borderColor)}"><a:alpha val="${Math.round(style.borderOpacity * 100000)}"/></a:srgbClr></a:solidFill><a:prstDash val="${style.lineStyle === 'solid' ? 'solid' : style.lineStyle === 'dashed' ? 'dash' : 'dot'}"/><a:headEnd type="${style.startArrow === 'circle' ? 'oval' : style.startArrow}"/><a:tailEnd type="${style.endArrow === 'circle' ? 'oval' : style.endArrow}"/></a:ln>`
  return inlineDrawing(id, data.shapeType, `<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width * 9525)}" cy="${Math.round(height * 9525)}"/></a:xfrm>${geometry}${fill}${stroke}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData>`, width, height)
}

const columnName = (index: number): string => {
  let result = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result
  return result
}
/** Chart caches and its editable workbook share the same professional series. */
export function wordChartParts(data: ChartData): { chart: string; workbook: Uint8Array } {
  const semantic = chartOutputAdapter.semantic(data)
  const count = semantic.labels.length
  const categories = `<c:strRef><c:f>Data!$A$2:$A$${count + 1}</c:f><c:strCache><c:ptCount val="${count}"/>${semantic.labels.map((label, i) => `<c:pt idx="${i}"><c:v>${x(label)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef>`
  const series = semantic.series.map((s, i) => {
    const column = columnName(i + 1)
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Data!$${column}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${x(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx><c:spPr><a:solidFill><a:srgbClr val="${color(s.color)}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="${color(s.color)}"/></a:solidFill></a:ln></c:spPr><c:cat>${categories}</c:cat><c:val><c:numRef><c:f>Data!$${column}$2:$${column}$${count + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${count}"/>${s.values.map((value, j) => `<c:pt idx="${j}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`
  }).join('')
  const circular = data.chartType === 'pie' || data.chartType === 'donut'
  const tag = ({ bar: 'barChart', line: 'lineChart', area: 'areaChart', pie: 'pieChart', donut: 'doughnutChart' } as const)[data.chartType]
  const direction = data.chartType === 'bar' && data.style.barDirection === 'horizontal' ? 'bar' : 'col'
  const chartOptions = data.chartType === 'bar' ? `<c:barDir val="${direction}"/><c:grouping val="clustered"/>` : data.chartType === 'line' || data.chartType === 'area' ? '<c:grouping val="standard"/>' : '<c:varyColors val="1"/>'
  const axes = circular ? '' : '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="1"/><c:crosses val="autoZero"/></c:valAx>'
  const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${x(data.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  const legend = data.style.showLegend ? `<c:legend><c:legendPos val="${({ top: 't', right: 'r', bottom: 'b', left: 'l' } as const)[data.style.legendPosition]}"/><c:overlay val="0"/></c:legend>` : ''
  const chart = `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${title}<c:plotArea><c:layout/><c:${tag}>${chartOptions}${series}${data.style.showDataLabels ? '<c:dLbls><c:showVal val="1"/></c:dLbls>' : ''}${data.chartType === 'donut' ? `<c:holeSize val="${data.style.holeSize}"/>` : ''}${circular ? '' : '<c:axId val="1"/><c:axId val="2"/>'}</c:${tag}>${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/></c:chart><c:externalData r:id="rIdWorkbook"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
  const sheetRows = [['分类', ...semantic.series.map(s => s.name)], ...semantic.labels.map((label, i) => [label, ...semantic.series.map(s => s.values[i]!)])]
  const sheet = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${columnName(j)}${i + 1}"${typeof value === 'number' ? '' : ' t="inlineStr"'}>${typeof value === 'number' ? `<v>${value}</v>` : `<is><t>${x(value)}</t></is>`}</c>`).join('')}</row>`).join('')}</sheetData></worksheet>`
  const workbook = zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  }).map(([path, value]) => [path, strToU8(value)])))
  return { chart, workbook }
}
