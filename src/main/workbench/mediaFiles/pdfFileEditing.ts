import { PDFDocument, PDFHexString, degrees, type PDFPage } from 'pdf-lib'
import type { MediaFileContent, MediaFileOperation, MediaPoint } from '../../../shared/workbench/mediaFiles'

function rotation(page: PDFPage): number { return (page.getRotation().angle % 360 + 360) % 360 }
function describe(document: PDFDocument, bytes: Uint8Array): Extract<MediaFileContent, { kind: 'pdf' }> {
  return { kind: 'pdf', mimeType: 'application/pdf', bytes, editable: true, pages: document.getPages().map(page => {
    const box = page.getCropBox(), angle = rotation(page)
    return { width: angle % 180 ? box.height : box.width, height: angle % 180 ? box.width : box.height, rotation: angle }
  }) }
}
export async function inspectPdfFile(bytes: Uint8Array): Promise<MediaFileContent> {
  return describe(await PDFDocument.load(bytes, { updateMetadata: false }), bytes)
}
/** Convert a visible, top-left point to PDF coordinates, including crop and page rotation. */
export function pdfPagePoint(page: PDFPage, point: MediaPoint): [number, number] {
  const box = page.getCropBox(), angle = rotation(page), { x, y } = point
  if (angle === 90) return [box.x + y * box.width, box.y + x * box.height]
  if (angle === 180) return [box.x + (1 - x) * box.width, box.y + y * box.height]
  if (angle === 270) return [box.x + (1 - y) * box.width, box.y + (1 - x) * box.height]
  return [box.x + x * box.width, box.y + (1 - y) * box.height]
}
function pageAt(document: PDFDocument, index: number): PDFPage {
  if (index >= document.getPageCount()) throw new Error('PDF 页码已改变，请重新查看')
  return document.getPage(index)
}
function annotate(document: PDFDocument, page: PDFPage, operation: Extract<MediaFileOperation, { type: 'pdf.highlight' | 'pdf.ink' }>) {
  const color = [1, 3, 5].map(index => parseInt(operation.color.slice(index, index + 2), 16) / 255)
  const box = page.getCropBox()
  const strokeWidth = operation.type === 'pdf.ink' ? operation.strokeWidth * Math.min(box.width, box.height) : 0
  const rectangle = operation.type === 'pdf.highlight' ? operation.rectangle : null
  const points = rectangle ? [
    { x: rectangle.x, y: rectangle.y }, { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x, y: rectangle.y + rectangle.height }, { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
  ] : operation.type === 'pdf.ink' ? operation.points : []
  const coordinates = points.map(point => pdfPagePoint(page, point))
  const xs = coordinates.map(point => point[0]), ys = coordinates.map(point => point[1])
  const annotation = document.context.obj({ Type: 'Annot', Subtype: rectangle ? 'Highlight' : 'Ink',
    Rect: [Math.min(...xs) - strokeWidth, Math.min(...ys) - strokeWidth, Math.max(...xs) + strokeWidth, Math.max(...ys) + strokeWidth],
    C: color, F: 4, Contents: PDFHexString.fromText(''),
    ...(rectangle ? { QuadPoints: coordinates.flat(), CA: 0.35 } : { InkList: [coordinates.flat()], BS: { W: strokeWidth } }),
  })
  page.node.addAnnot(document.context.register(annotation))
}

/** Edits the original document and page objects; never rebuilds pages as screenshots. */
export async function editPdfFile(bytes: Uint8Array, operations: readonly MediaFileOperation[], signal?: AbortSignal): Promise<MediaFileContent> {
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  if (!operations.length) return describe(document, bytes)
  for (const operation of operations) {
    signal?.throwIfAborted()
    if (operation.type === 'pdf.move-page') {
      const page = pageAt(document, operation.from)
      pageAt(document, operation.to)
      if (operation.from !== operation.to) { document.removePage(operation.from); document.insertPage(operation.to, page) }
    } else if (operation.type === 'pdf.delete-page') {
      pageAt(document, operation.page)
      if (document.getPageCount() <= 1) throw new Error('PDF 至少需要保留一页')
      document.removePage(operation.page)
    } else if (operation.type === 'pdf.rotate-page') {
      const page = pageAt(document, operation.page)
      page.setRotation(degrees((rotation(page) + operation.degrees) % 360))
    } else if (operation.type === 'pdf.highlight' || operation.type === 'pdf.ink') annotate(document, pageAt(document, operation.page), operation)
    else throw new Error('PDF 不能应用图片编辑操作')
  }
  signal?.throwIfAborted()
  const result = await document.save({ addDefaultPage: false, updateFieldAppearances: false })
  return describe(document, result)
}
