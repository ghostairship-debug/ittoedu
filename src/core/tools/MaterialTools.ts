import { z } from 'zod'
import type { ModelToolDefinition } from '../../shared/workbench/modelProvider'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

const identity = { attachmentId: z.uuid() }
export const materialListSchema = z.object({ attachmentId: z.uuid().optional(), path: z.string().min(1).optional(),
  offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(30) }).strict()
  .refine(input => !input.path || !input.attachmentId, '材料路径与 attachmentId 不能同时指定')
export const materialReadSchema = z.object({ ...identity, representationId: z.string().min(1),
  offset: z.number().int().nonnegative().default(0), maxChars: z.number().int().min(1).default(6000) }).strict()
export const materialFindSchema = z.object({ ...identity, query: z.string().min(1),
  cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(100).default(20) }).strict()
export const materialExtractSchema = z.object({ ...identity, pages: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).strict().optional(), images: z.enum(['auto', 'all']).default('auto') }).strict()
export const materialSchemas = { 'material.list': materialListSchema, 'material.read': materialReadSchema,
  'material.find': materialFindSchema, 'material.extract': materialExtractSchema } as const
export type MaterialToolName = keyof typeof materialSchemas
export const isMaterialTool = (name: string): name is MaterialToolName => Object.hasOwn(materialSchemas, name)

const descriptions: Record<MaterialToolName, string> = {
  'material.list': '列出本次显式材料或宿主冻结来源的不可变原件、表示、实际页段与缺口。省略 attachmentId 时列授权目录；path 可读取已授权工作空间内的具体材料，软件负责登记来源；指定 attachmentId 时分页列表示。目录不是正文，随后用 material.extract/find/read。读取参考不扩大作品修改权限。',
  'material.read': '按 material.list 返回的 attachmentId/representationId 回读已提取文本或原图，返回原件版本、表示版本与真实页/段落出处。文本分页不冒充全文；图片进入下一轮输入，准备好图片不表示模型已理解。原件尚未提取时明确提示 material.extract，不执行文件内容。',
  'material.find': '在一份授权 PDF/DOCX/PPTX 或文本材料的已提取表示中按原文字面量检索，返回真实页/段落、短上下文、缺口与续扫游标；图片或提取失败不冒充没有命中。用 material.read 回读命中表示。',
  'material.extract': '从授权 PDF/DOCX/PPTX 原件或已有派生来源建立不可变提取快照。PDF/PPTX pages 使用真实页/slide，DOCX 只能全文/段落。auto 优先文字并保留扫描/图形页图，all 为所有选定 PDF 页准备页图；Office 保留文字与嵌入图像。软件分批、复用并保留原件及局部缺口，返回派生 attachmentId 后用 material.list/find/read，不执行文件内容。',
}

export interface MaterialToolContext {
  runId: string
  operationId: string
  host: { readMaterial(runId: string, name: MaterialToolName, input: unknown): Promise<ToolResult> }
}
const registerMaterial = toolRegistrationFor<MaterialToolContext>()
export const materialToolRegistrations = (Object.keys(materialSchemas) as MaterialToolName[]).map(name => registerMaterial({
  name, description: descriptions[name], inputSchema: materialSchemas[name],
  manual: { label: ({ 'material.list': '材料目录', 'material.read': '读取材料', 'material.find': '检索材料', 'material.extract': '提取材料' })[name], group: 'read', targetKinds: [] },
}, {
  capability: 'read', effect: null,
  supports: context => context.materials !== false && context.workbenchServices !== false,
  targets: () => [],
  handler: (context, input) => context.host.readMaterial(context.runId, name, input),
}))
export function materialToolRegistration(name: string) { return materialToolRegistrations.find(tool => tool.name === name) }
export const materialTools: ModelToolDefinition[] = materialToolRegistrations.map(tool => ({ name: tool.name,
  description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) as ModelToolDefinition['inputSchema'] }))
