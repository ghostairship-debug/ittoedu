import { strToU8, zipSync } from 'fflate'
import { createTimezoneStableZipMtime } from '../../../shared/archiveTimestamp'
import type { PublishedFlowSurface } from '../../../shared/publishedCourseTypes'
import {
  buildFlowPrintPlan,
  type BuildFlowPrintPlanOptions,
  type FlowPrintNode,
  type FlowPrintPlan,
} from './flowPrintPlan'

export interface FlowDocxAsset {
  bytes: Uint8Array
  mimeType: string
  filename?: string
}

export interface FlowDocxOptions extends BuildFlowPrintPlanOptions {
  resolveAsset?: (assetId: string) => FlowDocxAsset | undefined
  author?: string
  createdAt?: Date
}

export interface FlowDocxReportItem {
  blockId?: string
  disposition: 'preserved' | 'fallback' | 'omitted'
  detail: string
}

export interface FlowDocxResult {
  bytes: Uint8Array
  warnings: string[]
  report: FlowDocxReportItem[]
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
  images: ImagePart[]
  nextRelationshipId: number
  resolveAsset: (assetId: string) => FlowDocxAsset | undefined
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function run(text: string, options: { bold?: boolean; italic?: boolean } = {}): string {
  const preserve = /^\s|\s$|\s{2}/.test(text) ? ' xml:space="preserve"' : ''
  const properties = options.bold || options.italic
    ? `<w:rPr>${options.bold ? '<w:b/>' : ''}${options.italic ? '<w:i/>' : ''}</w:rPr>`
    : ''
  return `<w:r>${properties}<w:t${preserve}>${xml(text)}</w:t></w:r>`
}

function paragraph(
  text: string,
  options: {
    style?: string
    bold?: boolean
    italic?: boolean
    keepNext?: boolean
    numbering?: { id: number; level?: number }
  } = {},
): string {
  const properties = [
    options.style ? `<w:pStyle w:val="${xml(options.style)}"/>` : '',
    options.keepNext ? '<w:keepNext/>' : '',
    options.numbering
      ? `<w:numPr><w:ilvl w:val="${options.numbering.level ?? 0}"/><w:numId w:val="${options.numbering.id}"/></w:numPr>`
      : '',
  ].join('')
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${run(text, options)}</w:p>`
}

function formulaParagraph(expression: string): string {
  return `<m:oMathPara><m:oMath><m:r><m:t>${xml(expression)}</m:t></m:r></m:oMath></m:oMathPara>`
}

function tableCell(text: string, header: boolean): string {
  return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr><w:p>${run(text, { bold: header })}</w:p></w:tc>`
}

function tableXml(rows: readonly string[][], headerRows: number): string {
  const width = Math.max(1, ...rows.map((row) => row.length))
  const grid = Array.from({ length: width }, () => '<w:gridCol w:w="2400"/>').join('')
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${
    rows.map((row, rowIndex) => `<w:tr>${
      rowIndex < headerRows ? '<w:trPr><w:tblHeader/></w:trPr>' : ''
    }${
      Array.from({ length: width }, (_, cellIndex) => tableCell(row[cellIndex] ?? '', rowIndex < headerRows)).join('')
    }</w:tr>`).join('')
  }</w:tbl>`
}

function imageExtension(mimeType: string): string | null {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/jpeg') return 'jpeg'
  if (mimeType === 'image/gif') return 'gif'
  return null
}

function imageDrawing(label: string, image: ImagePart, drawingId: number): string {
  const width = 560
  const height = Math.round(width * 0.5625)
  const cx = Math.round(width * 9_525)
  const cy = Math.round(height * 9_525)
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${drawingId}" name="${xml(label)}" descr="${xml(label)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${drawingId}" name="${xml(image.path)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
}

function renderPrintNode(node: FlowPrintNode, context: BuildContext): string {
  switch (node.type) {
    case 'document-title':
      context.report.push({ disposition: 'preserved', detail: 'Document title' })
      return paragraph(node.text, { style: 'Title', keepNext: true })
    case 'heading':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: `Heading ${node.level}` })
      return paragraph(node.text, { style: `Heading${node.level}`, keepNext: true })
    case 'paragraph':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native paragraph' })
      return paragraph(node.text)
    case 'quote':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native quote paragraphs' })
      return `${paragraph(node.text, { style: 'Quote', italic: true })}${
        node.citation ? paragraph(`— ${node.citation}`, { style: 'Quote' }) : ''
      }`
    case 'list':
      context.report.push({
        blockId: node.blockId,
        disposition: 'preserved',
        detail: node.ordered ? 'Numbered list' : 'Bullet list',
      })
      return node.items.map((item) => paragraph(item.text, {
        numbering: { id: node.ordered ? 2 : 1 },
      })).join('')
    case 'table':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native Word table' })
      return `${node.caption ? paragraph(node.caption, { style: 'Caption', keepNext: true }) : ''}${
        tableXml([node.headers, ...node.rows], 1)
      }`
    case 'formula':
      context.warnings.push(`${node.blockId}: semantic formula exported as an explained OMML text fallback`)
      context.report.push({
        blockId: node.blockId,
        disposition: 'fallback',
        detail: 'Semantic formula text with accessible explanation',
      })
      return `${formulaParagraph(node.linear)}${paragraph(`公式说明：${node.accessibleText}`, { style: 'FormulaFallback' })}`
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
          return `${imageDrawing(node.fallbackLabel, image, context.images.length)}${
            node.caption ? paragraph(node.caption, { style: 'Caption' }) : ''
          }`
        }
      }
      const reason = `${node.mediaKind} media exported as a descriptive fallback`
      context.warnings.push(`${node.blockId}: ${reason}`)
      context.report.push({ blockId: node.blockId, disposition: 'fallback', detail: reason })
      return paragraph(`[媒体后备：${node.fallbackLabel}]`, { italic: true })
    }
    case 'code':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Native monospaced code paragraph' })
      return paragraph(node.code, { style: 'Code' })
    case 'callout':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: `Callout style ${node.tone}` })
      return `${node.title ? paragraph(node.title, { style: 'CalloutTitle', bold: true, keepNext: true }) : ''}${
        paragraph(node.body, { style: 'CalloutText' })
      }`
    case 'section':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Expanded section' })
      return paragraph(node.title, { style: 'Heading2', keepNext: true })
    case 'divider':
      context.report.push({ blockId: node.blockId, disposition: 'preserved', detail: 'Paragraph border' })
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="AAB4C3"/></w:pBdr></w:pPr></w:p>'
    case 'component':
      context.report.push({ blockId: node.blockId, disposition: 'fallback', detail: 'Component static fallback' })
      return paragraph(`[组件后备：${node.fallbackLabel}]`, { italic: true })
  }
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>'
  + Array.from({ length: 6 }, (_, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${320 - index * 20}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${34 - index * 2}"/></w:rPr></w:style>`).join('')
  + '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="480" w:right="480"/></w:pPr><w:rPr><w:i/><w:color w:val="475569"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="64748B"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CalloutTitle"><w:name w:val="Callout Title"/><w:pPr><w:shd w:fill="EAF3FF"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="CalloutText"><w:name w:val="Callout Text"/><w:pPr><w:ind w:left="240"/><w:shd w:fill="F4F8FF"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="FormulaFallback"><w:name w:val="Formula Fallback"/><w:rPr><w:i/><w:color w:val="7C3AED"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:pPr><w:shd w:fill="F1F5F9"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:eastAsia="Microsoft YaHei" w:hAnsi="Consolas"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B8C2D1"/><w:left w:val="single" w:sz="4" w:color="B8C2D1"/><w:bottom w:val="single" w:sz="4" w:color="B8C2D1"/><w:right w:val="single" w:sz="4" w:color="B8C2D1"/><w:insideH w:val="single" w:sz="4" w:color="B8C2D1"/><w:insideV w:val="single" w:sz="4" w:color="B8C2D1"/></w:tblBorders></w:tblPr></w:style></w:styles>'

const NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>'

const PACKAGE_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'

function contentTypes(images: readonly ImagePart[]): string {
  const imageTypes = [...new Set(images.map((image) => image.mimeType))]
    .map((mimeType) => {
      const extension = imageExtension(mimeType)
      return extension
        ? `<Default Extension="${extension}" ContentType="${mimeType}"/>`
        : ''
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageTypes}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`
}

function wordRelationships(images: readonly ImagePart[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${
    images.map((image) => `<Relationship Id="${image.relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${image.path}"/>`).join('')
  }</Relationships>`
}

function isoDate(date: Date): string {
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString()
}

function pageSizeTwips(pageSize: FlowPrintPlan['pageSize']): { width: number; height: number } {
  if (pageSize === 'letter') return { width: 12_240, height: 15_840 }
  return { width: 11_906, height: 16_838 }
}

/** Build a deterministic DOCX package from a Flow print plan. Runtime TOC is never included. */
export function buildFlowDocxFromPlan(
  plan: FlowPrintPlan,
  options: FlowDocxOptions = {},
): FlowDocxResult {
  const context: BuildContext = {
    warnings: [],
    report: [],
    images: [],
    nextRelationshipId: 3,
    resolveAsset: options.resolveAsset ?? (() => undefined),
  }
  if (!plan.includesFloatingLayers && plan.omittedFloatingLayerCount > 0) {
    const detail = `DOCX 采用正文重排，已省略 ${plan.omittedFloatingLayerCount} 个页面浮层。`
    context.warnings.push(detail)
    context.report.push({ disposition: 'omitted', detail })
  }
  const body = plan.nodes.map((node) => renderPrintNode(node, context)).join('')
  const page = pageSizeTwips(plan.pageSize)
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>${body}<w:sectPr><w:pgSz w:w="${page.width}" w:h="${page.height}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const createdAt = isoDate(options.createdAt ?? new Date('1980-01-01T00:00:00.000Z'))
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(plan.title)}</dc:title><dc:creator>${xml(options.author ?? 'ittoedu')}</dc:creator><cp:lastModifiedBy>${xml(options.author ?? 'ittoedu')}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>ittoedu Courseware Editor</Application><AppVersion>1.0</AppVersion></Properties>'
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(context.images)),
    '_rels/.rels': strToU8(PACKAGE_RELS),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(STYLES),
    'word/numbering.xml': strToU8(NUMBERING),
    'word/_rels/document.xml.rels': strToU8(wordRelationships(context.images)),
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
  }
}

/** Build DOCX from a Published V2 Flow surface. Does not serialize authoring DOM or TOC chrome. */
export function buildFlowDocx(
  surface: PublishedFlowSurface,
  options: FlowDocxOptions = {},
): FlowDocxResult {
  return buildFlowDocxFromPlan(buildFlowPrintPlan(surface, options), options)
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
