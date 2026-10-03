import { extractOfficeMaterial, extractPdfMaterial, type MaterialExtractionOptions } from '../../project/materialExtraction'
import type { AttachmentExtractionInput, AttachmentExtractionResult } from '../../../shared/workbench/attachments'

/** Parses bytes only. Office XML is never mounted as HTML; macros and PDF actions are never executed. */
export async function extractAttachmentMaterial(input: AttachmentExtractionInput, callOptions: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {}): Promise<AttachmentExtractionResult> {
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.length) throw new Error('材料须为非空文件')
  const format = input.filename.split('.').pop()?.toLowerCase()
  if (format !== 'pdf' && format !== 'docx' && format !== 'pptx') throw new Error('仅支持 PDF、DOCX 与 PPTX 提取')
  const onProgress = (page: number, total: number) => { callOptions.signal?.throwIfAborted(); callOptions.onProgress?.(page, total) }
  callOptions.signal?.throwIfAborted()
  const pageImages: AttachmentExtractionResult['pageImages'] = []
  let totalPages: number | undefined, selectedPages: { from: number; to: number } | undefined
  const options: MaterialExtractionOptions = { pages: input.pages, maxPages: input.maxPages, fromPage: input.fromPage, images: input.images, onProgress, onSelectedPages: range => { selectedPages = range }, onPageCount: total => { totalPages = total }, onPageImage: image => pageImages.push(image) }
  const material = format === 'pdf' ? await extractPdfMaterial(input.bytes, options) : extractOfficeMaterial(input.bytes, format, options)
  return { material, ...(totalPages === undefined ? {} : { totalPages, selectedPages: selectedPages ?? input.pages ?? { from: 1, to: totalPages } }), pageImages }
}
