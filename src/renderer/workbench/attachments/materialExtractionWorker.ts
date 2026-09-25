import { extractOfficeMaterial, extractPdfMaterial, type MaterialExtractionOptions } from '../../project/materialExtraction'
import { MATERIAL_EXTRACTION_LIMITS } from '../../../shared/materialExtraction'
import type { AttachmentExtractionInput, AttachmentExtractionResult } from '../../../shared/workbench/attachments'

/** Parses bytes only. Office XML is never mounted as HTML; macros and PDF actions are never executed. */
export async function extractAttachmentMaterial(input: AttachmentExtractionInput): Promise<AttachmentExtractionResult> {
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.length || input.bytes.length > MATERIAL_EXTRACTION_LIMITS.sourceBytes) throw new Error('材料须为非空且不超过 32 MiB')
  const format = input.filename.split('.').pop()?.toLowerCase()
  if (format !== 'pdf' && format !== 'docx' && format !== 'pptx') throw new Error('仅支持 PDF、DOCX 与 PPTX 提取')
  const pageImages: AttachmentExtractionResult['pageImages'] = []
  let totalPages: number | undefined
  const options: MaterialExtractionOptions = { pages: input.pages, onPageCount: total => { totalPages = total }, onPageImage: image => pageImages.push(image) }
  const material = format === 'pdf' ? await extractPdfMaterial(input.bytes, options) : extractOfficeMaterial(input.bytes, format, options)
  return { material, ...(totalPages === undefined ? {} : { totalPages, selectedPages: input.pages ?? { from: 1, to: totalPages } }), pageImages }
}
