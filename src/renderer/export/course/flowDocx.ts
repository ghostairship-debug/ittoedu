import { strToU8, zipSync } from 'fflate'
import { createTimezoneStableZipMtime } from '../../../shared/archiveTimestamp'
import type { TextRun, TextRunStyle } from '../../../shared/contracts/native-v1'
import type {
  PublishedCourseV2Payload,
  PublishedFlowSurface,
} from '../../../shared/publishedCourseTypes'
import { serializeFormulaAst } from '../../../shared/formulaLinear'
import { flowRichTextSegments } from '../../../player/surfaces/flow/flowModel'
import {
  buildFlowPrintPlan,
  type BuildFlowPrintPlanOptions,
  type FlowPrintNode,
  type FlowPrintPlan,
} from './flowPrintPlan'
import {
  buildFlowDocxProjection,
  rotationToDrawingMlDegree,
  type BuildFlowDocxProjectionOptions,
  type FlowDocxLayerReportItem,
  type FlowDocxProjectedItem,
  type FlowDocxProjection,
} from './flowDocxProjection'

export interface FlowDocxAsset {
  bytes: Uint8Array
  mimeType: string
  filename?: string
}

export interface FlowDocxOptions extends BuildFlowPrintPlanOptions, BuildFlowDocxProjectionOptions {
  resolveAsset?: (assetId: string) => FlowDocxAsset | undefined
  author?: string
  createdAt?: Date
}

export interface FlowDocxBlockReportItem {
  blockId?: string
  disposition: 'preserved' | 'fallback' | 'omitted'
  detail: string
}

export type FlowDocxReportItem = FlowDocxBlockReportItem | FlowDocxLayerReportItem

export interface FlowDocxResult {
  bytes: Uint8Array
  warnings: string[]
  report: FlowDocxReportItem[]
  layerReport: FlowDocxLayerReportItem[]
}

interface ImagePart {
  relationshipId: string
  path: string
  mimeType: string
  bytes: Uint8Array
}

interface BuildContext {
  warnings: string[]
  report: FlowDocxReportItem[]
  layerReport: FlowDocxLayerReportItem[]
  images: ImagePart[]
  nextRelationshipId: number
  nextDrawingId: number
  resolveAsset: (assetId: string) => FlowDocxAsset | undefined
  anchoredMap: Map<string, FlowDocxProjectedItem[]>
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function wordFontFamily(value: string): string {
  return value.split(',')[0]!.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2')
}

function wordColor(value: string): string | null {
  const normalized = value.trim().replace(/^#/, '').toUpperCase()
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : null
}

function run(text: string, options: TextRunStyle = {}): string {
  const preserve = /^\s|\s$|\s{2}/.test(text) ? ' xml:space="preserve"' : ''
  const fontFamily = options.fontFamily ? wordFontFamily(options.fontFamily) : ''
  const fontSize = options.fontSize !== undefined ? Math.round(options.fontSize * 2) : 0
  const color = options.color ? wordColor(options.color) : null
  const highlight = typeof options.highlightColor === 'string'
    ? wordColor(options.highlightColor)
    : null
  const declarations = [
    fontFamily
      ? `<w:rFonts w:ascii="${xml(fontFamily)}" w:eastAsia="${xml(fontFamily)}" w:hAnsi="${xml(fontFamily)}"/>`
      : '',
    fontSize > 0 ? `<w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/>` : '',
    color ? `<w:color w:val="${color}"/>` : '',
    options.bold !== undefined ? `<w:b${options.bold ? '/' : ' w:val="0"/'}>` : '',
    options.italic !== undefined ? `<w:i${options.italic ? '/' : ' w:val="0"/'}>` : '',
    options.underline !== undefined ? `<w:u w:val="${options.underline ? 'single' : 'none'}"/>` : '',
    options.strike !== undefined ? `<w:strike${options.strike ? '/' : ' w:val="0"/'}>` : '',
    options.emphasis !== undefined ? `<w:em w:val="${options.emphasis ? 'dot' : 'none'}"/>` : '',
    highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${highlight}"/>` : '',
  ].filter(Boolean).join('')
  const properties = declarations ? `<w:rPr>${declarations}</w:rPr>` : ''
  return `<w:r>${properties}<w:t${preserve}>${xml(text)}</w:t></w:r>`
}

function richRuns(
  text: string,
  runs: readonly TextRun[] = [],
  baseStyle: TextRunStyle = {},
): string {
  return flowRichTextSegments(text, runs).map((segment) => (
    run(segment.text, { ...baseStyle, ...segment.style })
  )).join('')
}

function paragraph(
  text: string,
  options: {
    style?: string
    bold?: boolean
    italic?: boolean
    runs?: readonly TextRun[]
    keepNext?: boolean
    numbering?: { id: number; level?: number }
    leadingContent?: string
  } = {},
): string {
  const properties = [
    options.style ? `<w:pStyle w:val="${xml(options.style)}"/>` : '',
    options.keepNext ? '<w:keepNext/>' : '',
    options.numbering
      ? `<w:numPr><w:ilvl w:val="${options.numbering.level ?? 0}"/><w:numId w:val="${options.numbering.id}"/></w:numPr>`
      : '',
  ].join('')
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${options.leadingContent ?? ''}${richRuns(
    text,
    options.runs,
    { bold: options.bold, italic: options.italic },
  )}</w:p>`
}

function formulaParagraph(expression: string, leadingContent = ''): string {
  return leadingContent
    ? `<w:p>${leadingContent}</w:p><m:oMathPara><m:oMath><m:r><m:t>${xml(expression)}</m:t></m:r></m:oMath></m:oMathPara>`
    : `<m:oMathPara><m:oMath><m:r><m:t>${xml(expression)}</m:t></m:r></m:oMath></m:oMathPara>`
}

function tableCell(
  cell: { readonly text: string; readonly runs: readonly TextRun[] },
  header: boolean,
): string {
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr><w:p>${richRuns(cell.text, cell.runs, { bold: header })}</w:p></w:tc>`
}

function tableXml(
  rows: ReadonlyArray<ReadonlyArray<{ readonly text: string; readonly runs: readonly TextRun[] }>>,
  headerRows: number,
): string {
  const width = Math.max(1, ...rows.map((row) => row.length))
  const grid = Array.from({ length: width }, () => '<w:gridCol w:w="2400"/>').join('')
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${
    rows.map((row, rowIndex) => `<w:tr>${
      rowIndex < headerRows ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
    }${
      Array.from({ length: width }, (_, cellIndex) => tableCell(
        row[cellIndex] ?? { text: '', runs: [] },
        rowIndex < headerRows,
      )).join('')
    }</w:tr>`).join('')
  }</w:tbl>`
}

function imageExtension(mimeType: string): string | null {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpeg'
  if (mimeType === 'image/gif') return 'gif'
  return null
}

function inlineImageDrawing(label: string, image: ImagePart, drawingId: number): string {
  const width = 560
  const height = Math.round(width * 0.5625)
  const cx = Math.round(width * 9_525)
  const cy = Math.round(height * 9_525)
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="${xml(label)}" descr="${xml(label)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${xml(image.path)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function anchorXml(
  drawingId: number,
  item: FlowDocxProjectedItem,
  graphicXml: string,
): string {
  const xEMU = Math.round(item.outputFrame.x * 9_525)
  const yEMU = Math.round(item.outputFrame.y * 9_525)
  const cxEMU = Math.round(item.outputFrame.width * 9_525)
  const cyEMU = Math.round(item.outputFrame.height * 9_525)
  const behindDocVal = item.behindDoc ? '1' : '0'
  const relHeightVal = item.relativeHeight

  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${relHeightVal}" behindDoc="${behindDocVal}" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>${xEMU}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="margin"><wp:posOffset>${yEMU}</wp:posOffset></wp:positionV><wp:extent cx="${cxEMU}" cy="${cyEMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${drawingId}" name="${xml(item.layerItemId)}" descr="${xml(item.layerItemId)}"/><wp:cNvGraphicFramePr/>${graphicXml}</wp:anchor></w:drawing></w:r>`
}

function textBoxGraphicXml(
  item: FlowDocxProjectedItem,
  text: string,
  options: {
    runs?: readonly TextRun[]
    fontFamily?: string
    fontSize?: number
    color?: string
    bold?: boolean
    italic?: boolean
    align?: 'left' | 'center' | 'right'
    verticalAlign?: 'top' | 'middle' | 'bottom'
    backgroundColor?: string
    borderColor?: string
    borderWidth?: number
    borderStyle?: 'solid' | 'dashed' | 'dotted'
  } = {},
): string {
  const cxEMU = Math.round(item.outputFrame.width * 9_525)
  const cyEMU = Math.round(item.outputFrame.height * 9_525)
  const rot = rotationToDrawingMlDegree(item.rotation)
  const rotAttr = rot > 0 ? ` rot="${rot}"` : ''

  const fillHex = options.backgroundColor ? wordColor(options.backgroundColor) : null
  const fillXml = fillHex ? `<a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>` : '<a:noFill/>'

  const borderHex = options.borderColor ? wordColor(options.borderColor) : null
  const borderW = options.borderWidth !== undefined && options.borderWidth > 0
    ? Math.round(options.borderWidth * 9_525)
    : 0
  let dashXml = ''
  if (options.borderStyle === 'dashed') dashXml = '<a:prstDash val="dash"/>'
  else if (options.borderStyle === 'dotted') dashXml = '<a:prstDash val="dot"/>'

  const borderXml = borderW > 0 && borderHex
    ? `<a:ln w="${borderW}"><a:solidFill><a:srgbClr val="${borderHex}"/></a:solidFill>${dashXml}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>'

  const vAnchor = options.verticalAlign === 'middle' ? 'ctr' : options.verticalAlign === 'bottom' ? 'b' : 't'
  const alignVal = options.align === 'center' ? 'center' : options.align === 'right' ? 'right' : 'left'
  const jcXml = alignVal !== 'left' ? `<w:jc w:val="${alignVal}"/>` : ''

  const lines = text.split(/\r?\n/)
  const paragraphsXml = lines.map((line) => {
    const runsXml = options.runs && options.runs.length > 0
      ? richRuns(line, options.runs, {
          fontFamily: options.fontFamily,
          fontSize: options.fontSize,
          color: options.color,
          bold: options.bold,
          italic: options.italic,
        })
      : run(line, {
          fontFamily: options.fontFamily,
          fontSize: options.fontSize,
          color: options.color,
          bold: options.bold,
          italic: options.italic,
        })
    return `<w:p>${jcXml ? `<w:pPr>${jcXml}</w:pPr>` : ''}${runsXml}</w:p>`
  }).join('')

  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm${rotAttr}><a:off x="0" y="0"/><a:ext cx="${cxEMU}" cy="${cyEMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fillXml}${borderXml}</wps:spPr><wps:txbx><w:txbxContent>${paragraphsXml}</w:txbxContent></wps:txbx><wps:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${vAnchor}"/></wps:wsp></a:graphicData></a:graphic>`
}

function shapeGraphicXml(
  item: FlowDocxProjectedItem,
  shapeType: string,
  style: {
    fillColor?: string
    borderColor?: string
    borderWidth?: number
    lineStyle?: 'solid' | 'dashed' | 'dotted'
    cornerRadius?: number
    startArrow?: string
    endArrow?: string
  },
): string {
  const cxEMU = Math.round(item.outputFrame.width * 9_525)
  const cyEMU = Math.round(item.outputFrame.height * 9_525)
  const rot = rotationToDrawingMlDegree(item.rotation)
  const rotAttr = rot > 0 ? ` rot="${rot}"` : ''

  let prst = 'rect'
  let avLstXml = ''

  if (shapeType === 'rectangle') prst = 'rect'
  else if (shapeType === 'rounded-rectangle') {
    prst = 'roundRect'
    if (style.cornerRadius && style.cornerRadius > 0) {
      const adj = Math.min(50000, Math.round(style.cornerRadius * 500))
      avLstXml = `<a:gd name="adj" fmla="val ${adj}"/>`
    }
  } else if (shapeType === 'ellipse') prst = 'ellipse'
  else if (shapeType === 'triangle') prst = 'triangle'
  else if (shapeType === 'diamond') prst = 'diamond'
  else if (shapeType === 'line') prst = 'line'
  else if (shapeType === 'elbow-arrow') prst = 'bentConnector3'
  else if (shapeType === 'arrow-left') prst = 'leftArrow'
  else if (shapeType === 'arrow-right') prst = 'rightArrow'
  else if (shapeType === 'arrow-up') prst = 'upArrow'
  else if (shapeType === 'arrow-down') prst = 'downArrow'
  else if (shapeType === 'arrow-left-right') prst = 'leftRightArrow'

  const isStrokeOnly = shapeType === 'line' || shapeType === 'elbow-arrow'
  const fillHex = !isStrokeOnly && style.fillColor ? wordColor(style.fillColor) : null
  const fillXml = fillHex ? `<a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill>` : '<a:noFill/>'

  const borderHex = style.borderColor ? wordColor(style.borderColor) : null
  const borderW = style.borderWidth !== undefined && style.borderWidth > 0
    ? Math.round(style.borderWidth * 9_525)
    : (isStrokeOnly ? 19050 : 0)

  let dashXml = ''
  if (style.lineStyle === 'dashed') dashXml = '<a:prstDash val="dash"/>'
  else if (style.lineStyle === 'dotted') dashXml = '<a:prstDash val="dot"/>'

  let headEndXml = ''
  if (style.startArrow && style.startArrow !== 'none') {
    const arrowMap: Record<string, string> = {
      triangle: 'triangle',
      stealth: 'stealth',
      circle: 'oval',
      diamond: 'diamond',
    }
    const type = arrowMap[style.startArrow] ?? 'triangle'
    headEndXml = `<a:headEnd type="${type}"/>`
  }

  let tailEndXml = ''
  if (style.endArrow && style.endArrow !== 'none') {
    const arrowMap: Record<string, string> = {
      triangle: 'triangle',
      stealth: 'stealth',
      circle: 'oval',
      diamond: 'diamond',
    }
    const type = arrowMap[style.endArrow] ?? 'triangle'
    tailEndXml = `<a:tailEnd type="${type}"/>`
  }

  const lineXml = (borderW > 0 || isStrokeOnly) && (borderHex || isStrokeOnly)
    ? `<a:ln w="${Math.max(9525, borderW)}"><a:solidFill><a:srgbClr val="${borderHex ?? '000000'}"/></a:solidFill>${dashXml}${headEndXml}${tailEndXml}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>'

  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr/><wps:spPr><a:xfrm${rotAttr}><a:off x="0" y="0"/><a:ext cx="${cxEMU}" cy="${cyEMU}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst>${avLstXml}</a:avLst></a:prstGeom>${fillXml}${lineXml}</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>`
}

function pictureGraphicXml(
  item: FlowDocxProjectedItem,
  image: ImagePart,
  drawingId: number,
): string {
  const cxEMU = Math.round(item.outputFrame.width * 9_525)
  const cyEMU = Math.round(item.outputFrame.height * 9_525)
  const rot = rotationToDrawingMlDegree(item.rotation)
  const rotAttr = rot > 0 ? ` rot="${rot}"` : ''

  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${xml(image.path)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm${rotAttr}><a:off x="0" y="0"/><a:ext cx="${cxEMU}" cy="${cyEMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`
}

function formulaGraphicXml(
  item: FlowDocxProjectedItem,
  expression: string,
): string {
  const cxEMU = Math.round(item.outputFrame.width * 9_525)
  const cyEMU = Math.round(item.outputFrame.height * 9_525)
  const rot = rotationToDrawingMlDegree(item.rotation)
  const rotAttr = rot > 0 ? ` rot="${rot}"` : ''

  return `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm${rotAttr}><a:off x="0" y="0"/><a:ext cx="${cxEMU}" cy="${cyEMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent><w:p><m:oMathPara><m:oMath><m:r><m:t>${xml(expression)}</m:t></m:r></m:oMath></m:oMathPara></w:p></w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic>`
}

function renderAnchoredItem(item: FlowDocxProjectedItem, context: BuildContext): string {
  const drawingId = context.nextDrawingId++

  if (item.carrierKind === 'textbox') {
    if (item.item.kind === 'native' && item.item.content.nativeType === 'text') {
      const textData = item.item.content.data
      const graphic = textBoxGraphicXml(item, textData.text, {
        runs: textData.runs,
        fontFamily: textData.style.fontFamily,
        fontSize: textData.style.fontSize,
        color: textData.style.color,
        bold: textData.style.bold,
        italic: textData.style.italic,
        align: textData.style.align,
        verticalAlign: textData.style.verticalAlign,
        backgroundColor: textData.style.backgroundColor,
        borderColor: (textData.style as { borderColor?: string }).borderColor,
        borderWidth: (textData.style as { borderWidth?: number }).borderWidth,
      })
      return anchorXml(drawingId, item, graphic)
    }

    if (item.item.kind === 'native' && item.item.content.nativeType === 'teacher-controller') {
      const graphic = textBoxGraphicXml(item, '教师控制栏', {
        fontFamily: 'Microsoft YaHei',
        fontSize: 12,
        color: '#475569',
        backgroundColor: '#F8FAFC',
        borderColor: '#CBD5E1',
        borderWidth: 1,
        align: 'center',
        verticalAlign: 'middle',
      })
      return anchorXml(drawingId, item, graphic)
    }
  }

  if (item.carrierKind === 'shape') {
    if (item.item.kind === 'native' && item.item.content.nativeType === 'shape') {
      const shapeData = item.item.content.data
      const graphic = shapeGraphicXml(item, shapeData.shapeType, shapeData.style)
      return anchorXml(drawingId, item, graphic)
    }
  }

  if (item.carrierKind === 'image' && item.assetId) {
    const asset = context.resolveAsset(item.assetId)
    const extension = asset ? imageExtension(asset.mimeType) : null
    if (asset && extension) {
      const relationshipId = `rId${context.nextRelationshipId++}`
      const path = `media/image${context.images.length + 1}.${extension}`
      const imagePart: ImagePart = { relationshipId, path, mimeType: asset.mimeType, bytes: asset.bytes }
      context.images.push(imagePart)
      const graphic = pictureGraphicXml(item, imagePart, drawingId)
      return anchorXml(drawingId, item, graphic)
    }
  }

  if (item.carrierKind === 'formula') {
    if (item.item.kind === 'native' && item.item.content.nativeType === 'formula') {
      const linear = serializeFormulaAst(item.item.content.data.ast)
      const graphic = formulaGraphicXml(item, linear)
      return anchorXml(drawingId, item, graphic)
    }
  }

  // Placeholder text box fallback
  const placeholderText = item.placeholderText ?? `[浮层：${item.layerItemId}]`
  const graphic = textBoxGraphicXml(item, placeholderText, {
    fontFamily: 'Microsoft YaHei',
    fontSize: 10,
    color: '#64748B',
    italic: true,
    backgroundColor: '#F1F5F9',
    borderColor: '#94A3B8',
    borderWidth: 1,
    borderStyle: 'dashed',
    align: 'center',
    verticalAlign: 'middle',
  })
  return anchorXml(drawingId, item, graphic)
}

function renderPrintNode(
  node: FlowPrintNode,
  context: BuildContext,
  leadingContent = '',
): string {
  switch (node.type) {
    case 'document-title':
      context.report.push({ disposition: 'preserved', detail: 'Document title' })
      return paragraph(node.text, { style: 'Title', keepNext: true, leadingContent })
    case 'heading':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: `Heading ${node.level}` })
      return paragraph(node.text, { style: `Heading${node.level}`, keepNext: true, runs: node.runs, leadingContent })
    case 'paragraph':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native paragraph' })
      return paragraph(node.text, { runs: node.runs, leadingContent })
    case 'quote':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native quote paragraphs' })
      return `${paragraph(node.text, { style: 'Quote', italic: true, runs: node.runs, leadingContent })}${
        node.citation ? paragraph(`— ${node.citation}`, { style: 'Quote' }) : ''
      }`
    case 'list':
      context.report.push({
        blockId: node.blockId,
        disposition: 'preserved',
        detail: node.ordered ? 'Numbered list' : 'Bullet list',
      })
      return node.items.map((item, index) => paragraph(item.text, {
        numbering: { id: node.ordered ? 2 : 1 },
        runs: item.runs,
        leadingContent: index === 0 ? leadingContent : undefined,
      })).join('')
    case 'table':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native Word table' })
      return `${leadingContent ? `<w:p>${leadingContent}</w:p>` : ''}${node.caption ? paragraph(node.caption, { style: 'Caption', keepNext: true }) : ''}${
        tableXml([
          node.headers.map((text) => ({ text, runs: [] })),
          ...node.rows,
        ], 1)
      }`
    case 'formula':
      context.warnings.push(`${node.blockId}: semantic formula exported as an explained OMML text fallback`)
      context.report.push({
        blockId: node.blockId,
        disposition: 'fallback',
        detail: 'Semantic formula text with accessible explanation',
      })
      return `${formulaParagraph(node.linear, leadingContent)}${paragraph(`公式说明：${node.accessibleText}`, { style: 'FormulaFallback' })}`
    case 'media': {
      if (node.mediaKind === 'image') {
        const asset = context.resolveAsset(node.assetId)
        const extension = asset ? imageExtension(asset.mimeType) : null
        if (asset && extension) {
          const relationshipId = `rId${context.nextRelationshipId++}`
          const path = `media/image${context.images.length + 1}.${extension}`
          const image: ImagePart = { relationshipId, path, mimeType: asset.mimeType, bytes: asset.bytes }
          context.images.push(image)
          context.report.push({
            blockId: node.blockId,
            disposition: 'preserved',
            detail: 'Embedded OOXML image relationship',
          })
          return `${leadingContent ? `<w:p>${leadingContent}</w:p>` : ''}${inlineImageDrawing(node.fallbackLabel, image, context.nextDrawingId++)}${
            node.caption ? paragraph(node.caption, { style: 'Caption' }) : ''
          }`
        }
      }
      const reason = `${node.mediaKind} media exported as a descriptive fallback`
      context.warnings.push(`${node.blockId}: ${reason}`)
      context.report.push({ blockId: node.blockId, disposition: 'fallback', detail: reason })
      return paragraph(`[媒体后备：${node.fallbackLabel}]`, { italic: true, leadingContent })
    }
    case 'code':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native monospaced code paragraph' })
      return paragraph(node.code, { style: 'Code', leadingContent })
    case 'callout':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: `Callout style ${node.tone}` })
      return `${node.title ? paragraph(node.title, { style: 'CalloutTitle', bold: true, keepNext: true, leadingContent }) : ''}${
        paragraph(node.body, { style: 'CalloutText', leadingContent: !node.title ? leadingContent : undefined })
      }`
    case 'section':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Expanded section' })
      return paragraph(node.title, { style: 'Heading2', keepNext: true, leadingContent })
    case 'divider':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Paragraph border' })
      return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="AAB4C3"/></w:pBdr></w:pPr>${leadingContent}</w:p>`
    case 'component':
      context.report.push({ blockId: node.blockId, disposition: 'fallback', detail: 'Component static fallback' })
      return paragraph(`[组件后备：${node.fallbackLabel}]`, { italic: true, leadingContent })
  }
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>'
  + Array.from({ length: 6 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${320 - index * 20}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${34 - index * 2}"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="480" w:right="480"/></w:pPr><w:rPr><w:i/><w:color w:val="475569"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="64748B"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CalloutTitle"><w:name w:val="Callout Title"/><w:pPr><w:shd w:fill="EAF3FF"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="CalloutText"><w:name w:val="Callout Text"/><w:pPr><w:ind w:left="240"/><w:shd w:fill="F4F8FF"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="FormulaFallback"><w:name w:val="Formula Fallback"/><w:rPr><w:i/><w:color w:val="7C3AED"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:pPr><w:shd w:fill="F1F5F9"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei" w:hAnsi="Consolas"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C2D1"/><w:left w:val="single" w:sz="4" w:color="B8C2D1"/><w:bottom w:val="single" w:sz="4" w:color="B8C2D1"/><w:right w:val="single" w:sz="4" w:color="B8C2D1"/><w:insideH w:val="single" w:sz="4" w:color="B8C2D1"/><w:insideV w:val="single" w:sz="4" w:color="B8C2D1"/></w:tblBorders></w:tblPr></w:style></w:styles>'

const NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>'

const PACKAGE_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'

function contentTypes(images: readonly ImagePart[], hasFooter: boolean, hasHeader: boolean = false): string {
  const imageTypes = [...new Set(images.map((image) => image.mimeType))]
    .map((mimeType) => {
      const extension = imageExtension(mimeType)
      return extension
        ? `<Default Extension="${extension}" ContentType="${mimeType}"/>`
        : ''
    })
    .join('')
  const footerOverride = hasFooter
    ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
    : ''
  const headerOverride = hasHeader
    ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${headerOverride}${footerOverride}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
}

function wordRelationships(
  images: readonly ImagePart[],
  footerRelId: string | null,
  headerRelId: string | null = null,
): string {
  const headerRel = headerRelId
    ? `<Relationship Id="${headerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`
    : ''
  const footerRel = footerRelId
    ? `<Relationship Id="${footerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`
    : ''
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${headerRel}${footerRel}${
    images.map((image) => `<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${image.path}"/>`).join('')
  }</Relationships>`
}

function renderHeaderXml(
  page: { width: number; height: number },
  bgImageRelId: string,
  bgImagePath: string,
): string {
  const cxEMU = Math.round(page.width * 635)
  const cyEMU = Math.round(page.height * 635)
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cxEMU}" cy="${cyEMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1000" name="${xml(bgImagePath)}" descr="Background Image"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1000" name="${xml(bgImagePath)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${bgImageRelId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEMU}" cy="${cyEMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p></w:hdr>`
}

function renderFooterXml(footerItems: readonly FlowDocxProjectedItem[]): string {
  const text = footerItems.map((item) => {
    if (item.item.kind === 'native' && item.item.content.nativeType === 'teacher-controller') {
      return '教师控制栏：上一页 | 下一页 | 重新播放'
    }
    return `[教师控制栏：${item.layerItemId}]`
  }).join('   ')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr><w:t>${xml(text)}</w:t></w:r></w:p></w:ftr>`
}

function isoDate(date: Date): string {
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

function pageSizeTwips(pageSize: FlowPrintPlan['pageSize']): { width: number; height: number } {
  if (pageSize === 'letter') return { width: 12_240, height: 15_840 }
  return { width: 11_906, height: 16_838 }
}

export function buildFlowDocxFromPlan(
  plan: FlowPrintPlan,
  options: FlowDocxOptions = {},
): FlowDocxResult {
  const context: BuildContext = {
    warnings: [],
    report: [],
    layerReport: [],
    images: [],
    nextRelationshipId: 3,
    nextDrawingId: 1,
    resolveAsset: options.resolveAsset ?? (() => undefined),
    anchoredMap: new Map(),
  }
  if (!plan.includesFloatingLayers && plan.omittedFloatingLayerCount > 0) {
    const detail = `DOCX 采用正文重排，已省略 ${plan.omittedFloatingLayerCount} 个页面浮层。`
    context.warnings.push(detail)
    context.report.push({ disposition: 'omitted', detail })
  }
  const body = plan.nodes.map((node) => renderPrintNode(node, context)).join('')
  const page = pageSizeTwips(plan.pageSize)
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>${body}<w:sectPr><w:pgSz w:w="${page.width}" w:h="${page.height}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const createdAt = isoDate(options.createdAt ?? new Date('1980-01-01T00:00:00.000Z'))
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(plan.title)}</dc:title><dc:creator>${xml(options.author ?? 'ittoedu')}</dc:creator><cp:lastModifiedBy>${xml(options.author ?? 'ittoedu')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ittoedu Courseware Editor</Application><AppVersion>1.0</AppVersion></Properties>'
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(context.images, false)),
    '_rels/.rels': strToU8(PACKAGE_RELS),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/_rels/document.xml.rels': strToU8(wordRelationships(context.images, null)),
    'docProps/core.xml': strToU8(core),
    'docProps/app.xml': strToU8(app),
  }
  for (const image of context.images) files[`word/${image.path}`] = image.bytes
  return {
    bytes: zipSync(files, {
      level: 6,
      mtime: createTimezoneStableZipMtime('1980-01-01T00:00:00.000Z'),
    }),
    warnings: context.warnings,
    report: context.report,
    layerReport: context.layerReport,
  }
}

export function buildFlowDocxFromProjection(
  projection: FlowDocxProjection,
  options: FlowDocxOptions = {},
): FlowDocxResult {
  const context: BuildContext = {
    warnings: [...projection.warnings],
    report: [],
    layerReport: [...projection.layerReport],
    images: [],
    nextRelationshipId: 3,
    nextDrawingId: 1,
    resolveAsset: options.resolveAsset ?? (() => undefined),
    anchoredMap: new Map(projection.anchoredGroups.map((g) => [g.blockId, g.items])),
  }

  // Pre-render document-start anchored items
  const startDrawingsXml = projection.documentStartItems
    .map((item) => renderAnchoredItem(item, context))
    .join('')

  let firstBlockHandled = false
  const bodyParts: string[] = []

  if (projection.nodes.length === 0) {
    // Empty Flow creates an anchor paragraph
    bodyParts.push(`<w:p>${startDrawingsXml}</w:p>`)
  } else {
    for (const node of projection.nodes) {
      let leadingContent = ''
      if (!firstBlockHandled) {
        leadingContent = startDrawingsXml
        firstBlockHandled = true
      }

      if ('blockId' in node && typeof node.blockId === 'string') {
        const anchored = context.anchoredMap.get(node.blockId)
        if (anchored && anchored.length > 0) {
          const blockDrawings = anchored.map((item) => renderAnchoredItem(item, context)).join('')
          leadingContent += blockDrawings
        }
      }

      bodyParts.push(renderPrintNode(node, context, leadingContent))
    }
  }

  const page = {
    width: projection.pageBox.widthTwips,
    height: projection.pageBox.heightTwips,
  }

  // Header background image handling
  let headerRelId: string | null = null
  let headerRefXml = ''
  let headerXmlContent: string | null = null
  let headerRelsXmlContent: string | null = null
  let headerImagePart: ImagePart | null = null

  if (projection.backgroundAssetId) {
    const asset = context.resolveAsset(projection.backgroundAssetId)
    const extension = asset ? imageExtension(asset.mimeType) : null
    if (asset && extension) {
      headerRelId = `rId${context.nextRelationshipId++}`
      headerRefXml = `<w:headerReference w:type="default" r:id="${headerRelId}"/>`
      const bgImageRelId = 'rId1'
      const bgImagePath = `media/bgimage.${extension}`
      headerImagePart = {
        relationshipId: bgImageRelId,
        path: bgImagePath,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
      }
      headerXmlContent = renderHeaderXml(page, bgImageRelId, bgImagePath)
      headerRelsXmlContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${bgImageRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${bgImagePath}"/></Relationships>`
    } else {
      const warning = `Flow 背景图片素材 ${projection.backgroundAssetId} 缺失，已回退为纯色背景。`
      context.warnings.push(warning)
      const existingReport = context.layerReport.find(
        (r) => r.reasonCode === 'surface-background-image',
      )
      if (existingReport) {
        existingReport.disposition = 'static-fallback'
        existingReport.reasonCode = 'surface-background-asset-missing'
        existingReport.message = warning
      } else {
        context.layerReport.push({
          surfaceId: projection.surface.id,
          layerItemId: `${projection.surface.id}-background-image`,
          scope: 'surface',
          locationId: null,
          fieldPath: 'surfaces[0].backgroundAssetId',
          disposition: 'static-fallback',
          reasonCode: 'surface-background-asset-missing',
          message: warning,
          sourceFrame: {
            mode: 'absolute',
            x: 0,
            y: 0,
            width: projection.pageBox.maxContentWidthPx,
            height: projection.pageBox.maxContentHeightPx,
          },
          outputFrame: {
            mode: 'absolute',
            x: 0,
            y: 0,
            width: projection.pageBox.maxContentWidthPx,
            height: projection.pageBox.maxContentHeightPx,
          },
        })
      }
    }
  }

  // Footer handling
  let footerRelId: string | null = null
  let footerRefXml = ''
  let footerXmlContent: string | null = null

  if (projection.footerItems.length > 0) {
    footerRelId = `rId${context.nextRelationshipId++}`
    footerRefXml = `<w:footerReference w:type="default" r:id="${footerRelId}"/>`
    footerXmlContent = renderFooterXml(projection.footerItems)
  }

  // Background color handling
  const bgHex = projection.backgroundColor ? wordColor(projection.backgroundColor) : null
  const bgXml = bgHex && bgHex !== 'FFFFFF' ? `<w:background w:color="${bgHex}"/>` : ''

  const body = bodyParts.join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${bgXml}<w:body>${body}<w:sectPr>${headerRefXml}${footerRefXml}<w:pgSz w:w="${page.width}" w:h="${page.height}"/><w:pgMar w:top="${projection.pageBox.marginTwips}" w:right="${projection.pageBox.marginTwips}" w:bottom="${projection.pageBox.marginTwips}" w:left="${projection.pageBox.marginTwips}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const createdAt = isoDate(options.createdAt ?? new Date('1980-01-01T00:00:00.000Z'))
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(projection.title)}</dc:title><dc:creator>${xml(options.author ?? 'ittoedu')}</dc:creator><cp:lastModifiedBy>${xml(options.author ?? 'ittoedu')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ittoedu Courseware Editor</Application><AppVersion>1.0</AppVersion></Properties>'

  const allImages = headerImagePart ? [...context.images, headerImagePart] : context.images

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(allImages, footerXmlContent !== null, headerXmlContent !== null)),
    '_rels/.rels': strToU8(PACKAGE_RELS),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/_rels/document.xml.rels': strToU8(wordRelationships(context.images, footerRelId, headerRelId)),
    'docProps/core.xml': strToU8(core),
    'docProps/app.xml': strToU8(app),
  }

  if (headerXmlContent !== null) {
    files['word/header1.xml'] = strToU8(headerXmlContent)
  }
  if (headerRelsXmlContent !== null) {
    files['word/_rels/header1.xml.rels'] = strToU8(headerRelsXmlContent)
  }
  if (footerXmlContent !== null) {
    files['word/footer1.xml'] = strToU8(footerXmlContent)
  }

  for (const image of allImages) files[`word/${image.path}`] = image.bytes

  return {
    bytes: zipSync(files, {
      level: 6,
      mtime: createTimezoneStableZipMtime('1980-01-01T00:00:00.000Z'),
    }),
    warnings: context.warnings,
    report: [...context.report, ...context.layerReport],
    layerReport: context.layerReport,
  }
}

function wrapFlowSurfaceInSyntheticPayload(surface: PublishedFlowSurface): PublishedCourseV2Payload {
  return {
    format: 'h5course-published',
    formatVersion: 2,
    sourceSchemaVersion: 9,
    courseId: 'flow-course',
    title: surface.title,
    assets: {},
    components: {},
    designTokens: { colors: [], fonts: [] },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: false, musicVolume: 0.2, fadeMs: 300 },
      },
    },
    playback: {
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: {
        enabled: false,
        strategy: 'scene-navigation',
        additionalBindings: [],
      },
    },
    courseState: [],
    navigationGuards: [],
    locations: surface.blocks.map((b) => ({
      id: `loc-${b.id}`,
      label: b.id,
      kind: 'flow-block' as const,
      surfaceId: surface.id,
      blockId: b.id,
    })),
    startLocationId: surface.blocks[0] ? `loc-${surface.blocks[0].id}` : '',
    globalLayerItems: [],
    globalInteractions: [],
    surfaces: [surface],
  }
}

/**
 * Build continuous DOCX from PublishedCourseV2Payload and target Flow surface ID,
 * or from a single PublishedFlowSurface.
 */
export function buildFlowDocx(
  payload: PublishedCourseV2Payload,
  targetSurfaceId: string,
  options?: FlowDocxOptions,
): FlowDocxResult
export function buildFlowDocx(
  surface: PublishedFlowSurface,
  options?: FlowDocxOptions,
): FlowDocxResult
export function buildFlowDocx(
  payloadOrSurface: PublishedCourseV2Payload | PublishedFlowSurface,
  targetSurfaceIdOrOptions?: string | FlowDocxOptions,
  options?: FlowDocxOptions,
): FlowDocxResult {
  if (typeof targetSurfaceIdOrOptions === 'string') {
    const payload = payloadOrSurface as PublishedCourseV2Payload
    const targetSurfaceId = targetSurfaceIdOrOptions
    const opts = options ?? {}
    const projection = buildFlowDocxProjection(payload, targetSurfaceId, opts)
    return buildFlowDocxFromProjection(projection, opts)
  }

  const surface = payloadOrSurface as PublishedFlowSurface
  const opts = (targetSurfaceIdOrOptions as FlowDocxOptions) ?? {}
  const payload = wrapFlowSurfaceInSyntheticPayload(surface)
  const projection = buildFlowDocxProjection(payload, surface.id, opts)
  return buildFlowDocxFromProjection(projection, opts)
}

export function uniqueFlowDocxFilename(
  title: string,
  used: ReadonlySet<string> = new Set(),
): string {
  const base = (title.trim() || 'flow')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\.+$/g, '')
    .slice(0, 80) || 'flow'
  const taken = new Set([...used].map((name) => name.toLowerCase()))
  let name = `${base}.docx`
  let sequence = 2
  while (taken.has(name.toLowerCase())) {
    name = `${base}-${sequence}.docx`
    sequence += 1
  }
  return name
}
