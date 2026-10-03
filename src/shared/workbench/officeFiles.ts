import { z } from 'zod'

export const officeFormatSchema = z.enum(['docx', 'xlsx', 'pptx'])
export type OfficeFormat = z.infer<typeof officeFormatSchema>

const textRun = z.object({ text: z.string(), bold: z.boolean().optional(), italic: z.boolean().optional(), color: z.string().optional() })
const paragraph = z.object({
  type: z.literal('paragraph'), text: z.string().optional(), runs: z.array(textRun).optional(),
  heading: z.enum(['title', 'heading1', 'heading2', 'heading3']).optional(),
})
const docxCreate = z.object({
  format: z.literal('docx'), operation: z.literal('create'), title: z.string().optional(),
  blocks: z.array(z.union([paragraph, z.object({ type: z.literal('table'), rows: z.array(z.array(z.string())).min(1) })])).min(1),
})
const docxEdit = z.object({
  format: z.literal('docx'), operation: z.literal('edit'), edits: z.array(z.union([
    z.object({ type: z.literal('paragraph'), index: z.number().int().nonnegative(), text: z.string() }),
    z.object({ type: z.literal('tableCell'), table: z.number().int().nonnegative(), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), text: z.string() }),
    z.object({ type: z.literal('replaceText'), oldText: z.string().min(1), text: z.string() }),
  ])).min(1),
})
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
const cellValue = z.union([scalar, z.object({ formula: z.string().min(1) })])
const xlsxCreate = z.object({
  format: z.literal('xlsx'), operation: z.literal('create'),
  sheets: z.array(z.object({ name: z.string().min(1), rows: z.array(z.array(cellValue)), columnWidths: z.array(z.number().positive()).optional(), header: z.boolean().optional() })).min(1),
})
const xlsxEdit = z.object({
  format: z.literal('xlsx'), operation: z.literal('edit'),
  edits: z.array(z.object({ sheet: z.string(), cell: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]*$/i), value: cellValue })).min(1),
})
const pptxCreate = z.object({
  format: z.literal('pptx'), operation: z.literal('create'), title: z.string().optional(),
  slides: z.array(z.object({ title: z.string(), body: z.array(z.string()).optional(), notes: z.string().optional() })).min(1),
})
const pptxEdit = z.object({
  format: z.literal('pptx'), operation: z.literal('edit'),
  edits: z.array(z.object({ slide: z.number().int().nonnegative(), shape: z.string(), text: z.string(), paragraph: z.number().int().nonnegative().optional() })).min(1),
})

/** Semantic tool content does not repeat the mechanical create/edit operation. */
export const officeCreateContentSchema = z.discriminatedUnion('format', [docxCreate.omit({ operation: true }), xlsxCreate.omit({ operation: true }), pptxCreate.omit({ operation: true })])
export const officeEditContentSchema = z.discriminatedUnion('format', [docxEdit.omit({ operation: true }), xlsxEdit.omit({ operation: true }), pptxEdit.omit({ operation: true })])
export type OfficeCreateContent = z.infer<typeof officeCreateContentSchema>
export type OfficeEditContent = z.infer<typeof officeEditContentSchema>

/** Indices are zero based. inspectOfficeContent supplies paragraph and shape targets. */
export const officeContentRequestSchema = z.union([docxCreate, docxEdit, xlsxCreate, xlsxEdit, pptxCreate, pptxEdit])
export type OfficeContentRequest = z.infer<typeof officeContentRequestSchema>
export type OfficeRequest<F extends OfficeFormat, O extends 'create' | 'edit'> = Extract<OfficeContentRequest, { format: F; operation: O }>
export type OfficeCellValue = z.infer<typeof cellValue>
export interface OfficeDiagnostic { code: string; message: string; location?: string }
export interface OfficeCalculation {
  engine: 'xlsx-calc'; status: 'complete' | 'partial';
  values: Array<{ sheet: string; cell: string; value: string | number | boolean; error?: boolean }>
}
export interface OfficeContentResult {
  format: OfficeFormat; bytes: Uint8Array; changedParts: string[]; diagnostics: OfficeDiagnostic[]; calculation?: OfficeCalculation
}
export type OfficeContentInspection =
  | { format: 'docx'; paragraphs: Array<{ index: number; text: string }>; tables: string[][][] }
  | { format: 'xlsx'; sheets: Array<{ name: string; cells: Array<{ cell: string; value: string | number | boolean | null; formula?: string }> }> }
  | { format: 'pptx'; slides: Array<{ index: number; shapes: Array<{ name: string; text: string; paragraphs: string[] }> }> }
