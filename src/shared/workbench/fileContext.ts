import { z } from 'zod'

/** Discovery and reference metadata. No field here is a write grant. */
export const fileFocusSchema = z.object({
  page: z.number().int().nonnegative().optional(), part: z.string().min(1).optional(),
  shapeIds: z.array(z.string().min(1)).optional(), sheet: z.string().min(1).optional(), range: z.string().min(1).optional(),
  paragraphId: z.string().min(1).optional(), paragraph: z.number().int().nonnegative().optional(),
}).strict()
export const openWorkbenchFileSchema = z.object({
  path: z.string().min(1), name: z.string().optional(), format: z.string().min(1), active: z.boolean(),
  fileVersion: z.string().min(1).optional(), bindingVersion: z.number().int().positive().optional(),
  documentId: z.string().min(1).optional(), epoch: z.string().min(1).optional(), revision: z.number().int().nonnegative().optional(),
  focus: fileFocusSchema.optional(),
}).strict()
export const executionFileReferenceSchema = z.object({
  path: z.string().min(1), scope: z.enum(['file', 'page', 'object', 'sheet', 'range', 'paragraph']),
  focus: fileFocusSchema.optional(), pinned: z.boolean(),
  fileVersion: z.string().min(1).optional(), bindingVersion: z.number().int().positive().optional(),
}).strict()
export const executionFileContextSchema = z.object({
  openFiles: z.array(openWorkbenchFileSchema), references: z.array(executionFileReferenceSchema),
}).strict()
export type ExecutionFileReference = z.infer<typeof executionFileReferenceSchema>
export type ExecutionFileContext = z.infer<typeof executionFileContextSchema>

/** Kept separate from user text and authority; inspect the selected target before writing. */
export function formatExecutionFileContext(context: ExecutionFileContext | undefined): string {
  if (!context?.openFiles.length && !context?.references.length) return ''
  return [
    '已打开文件与本次引用（定位元数据，不包含文件内容，也不授予写入权限）：',
    '用户在当前消息中明确指定的目标优先；否则优先采用 pinned=true 的固定引用，再采用自动焦点引用。打开文件清单仅用于发现，不代表都被引用。',
    '元数据的 page、paragraph 使用从 0 开始的索引；用户界面的页码和段落序号从 1 开始。part 与 shapeIds 是保存时的 OOXML 身份，修改前仍需核实。',
    '按需用 office.inspect 读取 PPTX/DOCX/XLSX 的目标页、对象、段落或单元格，其他格式使用现有文件/文档读取工具。写入仍遵守当前任务原有权限、文件版本及对象前置条件；不要把发现或读取范围当作写入授权。',
    JSON.stringify(context),
  ].join('\n')
}
