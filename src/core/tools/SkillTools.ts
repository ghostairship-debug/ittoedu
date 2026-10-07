import { z } from 'zod'
import type { SkillServicePort } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const skillReadInputSchema = z.object({
  skill: z.string().min(1).max(200),
  version: z.string().min(1).max(150).optional(),
  path: z.string().min(1).max(512).default('SKILL.md'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(64_000).default(12_000),
}).strict()

/** One schema is projected by both the built-in gateway and MCP. */
export const skillReadTool = (catalog: readonly { name: string; description: string }[]) => ({
  name: 'skills.read' as const,
  description: `按需读取随附或已授权用户/工作区 Skill 的 SKILL.md、references/assets/scripts 文本；不执行脚本，读取不扩大权限，也不撤下已有授权能力。skills.list 可刷新目录；拼接同一文件的分页时带返回的 version，该文件变化时重新读取。其他资料变更不使当前文件失效。不自动加载正文。可用 Skill：${catalog.map(item => `${item.name}：${item.description}`).join('；')}`,
  inputSchema: skillReadInputSchema,
  manual: { label: '读取 Skill', group: 'read' as const, targetKinds: [] as const },
})

export async function executeSkillRead(service: SkillServicePort, input: unknown, runId?: string): Promise<ToolResult> {
  const parsed = skillReadInputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input', message: 'Skill 读取参数无效' }
  const result = await service.read(parsed.data, runId)
  if (result.status === 'unknown-skill') return { kind: 'error', code: 'unknown-skill', message: '当前已启用的 Skill 目录没有该条目' }
  if (result.status === 'unknown-path') return { kind: 'error', code: 'unknown-path', message: '该文件未在 Skill 清单登记' }
  return { kind: 'read', data: result }
}

export const skillListInputSchema = z.object({ refresh: z.boolean().default(false) }).strict()
export const skillListTool = {
  name: 'skills.list' as const, description: '列出内置、应用用户目录和当前授权工作区的 Skill 名称/简介；只读元数据，不预加载正文、不执行脚本。不覆盖同名不同来源；refresh=true 重新扫描并显示失败或截断说明。',
  inputSchema: skillListInputSchema, manual: { label: 'Skill 目录', group: 'read' as const, targetKinds: [] as const },
}
export async function executeSkillList(service: SkillServicePort, runId: string, input: unknown): Promise<ToolResult> {
  const { refresh } = skillListInputSchema.parse(input)
  return { kind: 'read', data: service.list ? await service.list(runId, refresh) : {
    entries: await service.catalog?.(runId) ?? [], warnings: [], scripts: '仅提供随附资料读取；没有脚本执行授权。',
  } }
}
