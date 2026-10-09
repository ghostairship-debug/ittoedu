import { z } from 'zod'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

export const pptxImportInputSchema = z.object({ path: z.string().min(1), destination: z.string().min(1).optional() }).strict()
export type PptxImportInput = z.output<typeof pptxImportInputSchema>
export const pptxImportRegistration = toolRegistrationFor<{ import(input: PptxImportInput): Promise<ToolResult> }>()({
  name: 'course.importPptx', description: '把已授权 PPTX 文件导入新的可编辑 V10 课件并保存、打开。复用软件实际 PowerPoint 导入器，保留能承载的文字、形状与素材并返回具体局部问题。path 为源文件；destination 可选新 .glx 路径，省略使用会话文件夹和源文件名。软件负责身份和资源，不覆盖源 PPTX 或已有目标文件。',
  inputSchema: pptxImportInputSchema, manual: { label: '导入 PowerPoint', group: 'edit', targetKinds: [] },
}, { capability: 'write', effect: 'file-write', family: 'office', targets: () => [],
  supports: context => context.pptxImport !== false && context.workbenchServices !== false && context.fileAccess !== 'read',
  handler: (context, input) => context.import(input) })
