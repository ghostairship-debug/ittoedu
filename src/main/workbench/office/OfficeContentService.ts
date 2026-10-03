import { createDocx, editDocx, inspectDocx } from './docxContent'
import { createPptx, editPptx, inspectPptx } from './pptxContent'
import { createXlsx, editXlsx, inspectXlsx, recalculateXlsx } from './xlsxContent'
import { OfficePackage } from './officePackage'
import { officeContentRequestSchema, type OfficeContentInspection, type OfficeContentRequest, type OfficeContentResult, type OfficeFormat } from '../../../shared/workbench/officeFiles'

export { officeContentRequestSchema } from '../../../shared/workbench/officeFiles'
export type { OfficeContentRequest, OfficeContentResult, OfficeContentInspection, OfficeFormat } from '../../../shared/workbench/officeFiles'

/** Pure file transformation. The existing file owner applies returned bytes with its save/CAS rules. */
export async function applyOfficeContent(bytes: Uint8Array | undefined, input: OfficeContentRequest): Promise<OfficeContentResult> {
  const request = officeContentRequestSchema.parse(input)
  if (request.operation === 'create' && bytes !== undefined) throw new Error('新建操作不能覆盖已有 Office 字节；请使用 edit')
  if (request.operation === 'edit' && bytes === undefined) throw new Error('Office 编辑需要当前文件字节')
  let created = false
  if (request.operation === 'create') {
    bytes = request.format === 'docx' ? await createDocx(request) : request.format === 'xlsx' ? await createXlsx(request) : await createPptx(request)
    created = true
  }
  const pkg = new OfficePackage(bytes!)
  if (request.operation === 'edit') {
    if (request.format === 'docx') editDocx(pkg, request)
    else if (request.format === 'xlsx') editXlsx(pkg, request)
    else editPptx(pkg, request)
  }
  const calculation = request.format === 'xlsx' ? recalculateXlsx(pkg) : undefined
  return {
    format: request.format, bytes: pkg.save(), changedParts: created ? Object.keys(pkg.parts) : [...pkg.changed],
    diagnostics: calculation?.diagnostics ?? [], ...(calculation ? { calculation: calculation.calculation } : {}),
  }
}

export function inspectOfficeContent(bytes: Uint8Array, format: OfficeFormat): OfficeContentInspection {
  const pkg = new OfficePackage(bytes)
  return format === 'docx' ? inspectDocx(pkg) : format === 'xlsx' ? inspectXlsx(pkg) : inspectPptx(pkg)
}
