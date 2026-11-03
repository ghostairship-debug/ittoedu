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
export const docxParagraphStyleSchema = z.object({
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  alignment: z.enum(['left', 'center', 'right', 'both']).optional(),
  heading: z.enum(['Normal', 'Title', 'Heading1', 'Heading2', 'Heading3']).optional(),
})
export type DocxParagraphStyle = z.infer<typeof docxParagraphStyleSchema>
export const docxTextStyleSchema = docxParagraphStyleSchema.pick({ bold: true, italic: true, underline: true })
export type DocxTextStyle = z.infer<typeof docxTextStyleSchema>
const docxTextPosition = z.object({ paragraph: z.number().int().nonnegative(), offset: z.number().int().nonnegative() })
export type DocxBodyBlock =
  | { type: 'paragraph'; index: number }
  | { type: 'table'; index: number; rows: number[][][]; paragraphs: number[]; simple: boolean }
  | { type: 'container'; paragraphs: number[]; notice: string }
const docxEdit = z.object({
  format: z.literal('docx'), operation: z.literal('edit'), edits: z.array(z.union([
    z.object({ type: z.literal('replaceRange'), start: docxTextPosition, end: docxTextPosition,
      paragraphs: z.array(z.object({ runs: z.array(z.object({ text: z.string(), style: docxTextStyleSchema.optional() })), style: docxParagraphStyleSchema.optional() })).min(1),
    }),
    z.object({ type: z.literal('textStyle'), index: z.number().int().nonnegative(), from: z.number().int().nonnegative(), to: z.number().int().nonnegative(),
      style: docxTextStyleSchema.refine(style => Object.values(style).some(value => value !== undefined), '请提供文字样式'),
    }).refine(edit => edit.to > edit.from, '请选择文字范围'),
    z.object({ type: z.literal('paragraph'), index: z.number().int().nonnegative(), text: z.string() }),
    z.object({ type: z.literal('paragraphStyle'), index: z.number().int().nonnegative(), style: docxParagraphStyleSchema.refine(style => Object.keys(style).length > 0, '请提供段落样式') }),
    z.object({ type: z.literal('insertParagraph'), after: z.number().int().min(-1), text: z.string() }),
    z.object({ type: z.literal('deleteParagraph'), index: z.number().int().nonnegative() }),
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
  edits: z.array(z.union([
    z.object({ sheet: z.string(), cell: z.string().regex(/^[A-Z]{1,3}[1-9][0-9]*$/i), value: cellValue }),
    z.object({ type: z.literal('sheetAdd'), name: z.string().min(1).max(31) }),
    z.object({ type: z.literal('sheetRename'), sheet: z.string(), name: z.string().min(1).max(31) }),
    z.object({ type: z.literal('sheetDelete'), sheet: z.string() }),
    z.object({ type: z.literal('sheetMove'), sheet: z.string(), index: z.number().int().nonnegative() }),
    z.object({ type: z.literal('columnWidth'), sheet: z.string(), column: z.number().int().min(1).max(16384), width: z.number().finite().min(0).max(255) }),
  ])).min(1),
})
const pptxCreate = z.object({
  format: z.literal('pptx'), operation: z.literal('create'), title: z.string().optional(),
  slides: z.array(z.object({ title: z.string(), body: z.array(z.string()).optional(), notes: z.string().optional() })).min(1),
})
const pptxObjectTarget = z.object({
    slide: z.number().int().nonnegative(),
    shape: z.string().optional().describe('兼容按唯一名称定位；重名时请使用 inspect 返回的 shapeId'),
    shapeId: z.string().min(1).optional().describe('inspect 返回的原件形状标识；提供时优先于名称定位'),
    /** Use the part and version returned by inspection to reject stale slide targets. */
    part: z.string().min(1).optional().describe('原样沿用 inspect 返回的幻灯片 part，防止幻灯片顺序变化后误改'),
    partVersion: z.string().regex(/^[a-f0-9]{64}$/).optional().describe('原样沿用 inspect 返回的 partVersion，不能自行生成或复用旧值'),
})
const pptxModernTarget = pptxObjectTarget.required({ shapeId: true, part: true, partVersion: true })
const pptxTextStyle = z.object({
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(),
  fontSize: z.number().finite().positive().optional().describe('字号，单位为磅'),
  fontFamily: z.string().trim().min(1).optional(), color: z.string().regex(/^[a-fA-F0-9]{6}$/).optional(),
}).refine(style => Object.values(style).some(value => value !== undefined), '请提供至少一个文字样式属性')
const pptxObjectEdit = z.union([
  // The original text request remains wire compatible. All new operations use the same owner.
  pptxObjectTarget.extend({ type: z.literal('text').optional(), text: z.string(), paragraph: z.number().int().nonnegative().optional() }),
  pptxModernTarget.extend({ type: z.literal('runText'), paragraph: z.number().int().nonnegative(), run: z.number().int().nonnegative(), text: z.string() }),
  pptxModernTarget.extend({
    type: z.literal('transform'),
    x: z.number().finite().optional().describe('对象父坐标中的横向位置，单位磅；沿用inspect的frame单位'), y: z.number().finite().optional().describe('对象父坐标中的纵向位置，单位磅'),
    width: z.number().finite().positive().optional().describe('宽度，单位磅'), height: z.number().finite().positive().optional().describe('高度，单位磅'),
    rotation: z.number().finite().optional().describe('旋转角，单位度'),
  }).refine(edit => ['x', 'y', 'width', 'height', 'rotation'].some(key => edit[key as keyof typeof edit] !== undefined), '请提供至少一个几何属性'),
  pptxModernTarget.extend({ type: z.literal('textStyle'), paragraph: z.number().int().nonnegative().optional(), run: z.number().int().nonnegative().optional(), style: pptxTextStyle }),
  pptxModernTarget.extend({
    type: z.literal('shapeStyle'), fill: z.string().regex(/^[a-fA-F0-9]{6}$/).nullable().optional(),
    stroke: z.string().regex(/^[a-fA-F0-9]{6}$/).nullable().optional(), strokeWidth: z.number().finite().nonnegative().optional(),
  }).refine(edit => edit.fill !== undefined || edit.stroke !== undefined || edit.strokeWidth !== undefined, '请提供至少一个形状样式属性'),
  pptxModernTarget.extend({ type: z.literal('layer'), position: z.enum(['front', 'back', 'forward', 'backward']) }),
  pptxModernTarget.extend({
    type: z.literal('replaceImage'),
    image: z.object({ contentType: z.enum(['image/png', 'image/jpeg', 'image/gif']), base64: z.string().min(1) }),
  }),
  pptxModernTarget.extend({
    type: z.literal('imageCrop'),
    left: z.number().finite(), top: z.number().finite(), right: z.number().finite(), bottom: z.number().finite(),
  }).refine(edit => edit.left + edit.right < 100 && edit.top + edit.bottom < 100, '裁切后须保留可见图片区域'),
  pptxModernTarget.extend({ type: z.literal('tableCell'), row: z.number().int().nonnegative(), column: z.number().int().nonnegative(), text: z.string() }),
]).refine(edit => edit.shapeId !== undefined || edit.shape !== undefined, 'PPT 对象目标需要 shapeId 或 shape')
export type PptxObjectEdit = z.infer<typeof pptxObjectEdit>
export type PptxTextStyle = z.infer<typeof pptxTextStyle>
export interface OfficeHistoryEntry { id: string; actor: 'human' | 'ai'; label: string; at: string }
export interface OfficeHistorySnapshot { undoDepth: number; redoDepth: number; entries: OfficeHistoryEntry[]; notice?: string }

const pptxAdvancedEdit = z.union([
  pptxModernTarget.extend({
    type: z.literal('chartValue'), chartPart: z.string().min(1), chartVersion: z.string().regex(/^[a-f0-9]{64}$/),
    series: z.number().int().nonnegative().describe('inspect 返回的系列 index'),
    point: z.number().int().nonnegative().describe('inspect 返回的数值点 index'), value: z.number().finite(),
  }),
  pptxObjectTarget.omit({ shape: true, shapeId: true }).required({ part: true, partVersion: true }).extend({
    type: z.literal('animationTiming'), timingId: z.string().min(1),
    durationMs: z.number().int().nonnegative().max(86400000).describe('已有动画行为的持续毫秒数；不改变触发和对象关系'),
  }),
])
export type PptxAdvancedEdit = z.infer<typeof pptxAdvancedEdit>
const pptxEdit = z.object({
  format: z.literal('pptx'), operation: z.literal('edit'), edits: z.array(z.union([pptxObjectEdit, pptxAdvancedEdit])).min(1),
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
/** Coordinates are points in the object's parent space; 72 points equal one inch. */
export interface PptxObjectFrame { x: number; y: number; width: number; height: number; rotation: number }
export interface PptxChartInspection {
  part: string; partVersion: string; embeddedWorkbook?: string
  series: Array<{ index: number; name: string; values: Array<{ index: number; value: number }> }>
}
export interface PptxAnimationInspection { id: string; duration: string; kind: string; shapeIds: string[]; editable: boolean }
export interface PptxObjectInspection {
  shapeId: string; name: string; kind: 'shape' | 'picture' | 'table' | 'group' | 'unsupported'
  text: string; paragraphs: string[]; groupPath: string[]
  frame?: PptxObjectFrame
  textStyle?: Partial<PptxTextStyle>
  runs: Array<Array<{ text: string; style: Partial<PptxTextStyle> }>>
  fill?: string | null; stroke?: string | null
  crop?: { left: number; top: number; right: number; bottom: number }
  cells?: string[][]
  chart?: PptxChartInspection
  editable: Array<'text' | 'runText' | 'transform' | 'textStyle' | 'shapeStyle' | 'layer' | 'replaceImage' | 'imageCrop' | 'tableCell'>
}
export type OfficeContentInspection =
  | { format: 'docx'; paragraphs: Array<{ index: number; text: string; style?: DocxParagraphStyle; runs?: Array<{ text: string; style: DocxTextStyle }>; editable?: boolean; structureEditable?: boolean; notice?: string }>; tables: string[][][]; body?: DocxBodyBlock[] }
  | { format: 'xlsx'; sheets: Array<{ name: string; part?: string; sheetId?: string; mergedRanges?: string[]; columnWidths?: Array<{ min: number; max: number; width: number }>; cells: Array<{ cell: string; value: string | number | boolean | null; formula?: string }> }> }
  | { format: 'pptx'; width: number; height: number; slides: Array<{ index: number; part: string; partVersion: string; shapes: PptxObjectInspection[]; animations?: PptxAnimationInspection[] }> }
