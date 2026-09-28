import { z } from 'zod'
import type { SkillServicePort } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const skillReadInputSchema = z.object({
  skill: z.string().min(1).max(200),
  path: z.string().min(1).max(512).default('SKILL.md'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(8000).default(4000),
}).strict()

/** One schema is projected by both the built-in gateway and MCP. */
export const skillReadTool = (catalog: readonly { name: string; description: string }[]) => ({
  name: 'skills.read' as const,
  description: `按需读取随附 Skill 的 SKILL.md 或它直接引用的资料；不自动加载正文。可用 Skill：${catalog.map(item => `${item.name}：${item.description}`).join('；')}`,
  inputSchema: skillReadInputSchema,
  manual: { label: '读取 Skill', group: 'read' as const, targetKinds: [] as const },
})

export async function executeSkillRead(service: SkillServicePort, input: unknown): Promise<ToolResult> {
  const parsed = skillReadInputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input', message: 'Skill 读取参数无效' }
  const result = await service.read(parsed.data)
  if (result.status === 'unknown-skill') return { kind: 'error', code: 'unknown-skill', message: '未随产品提供该 Skill' }
  if (result.status === 'unknown-path') return { kind: 'error', code: 'unknown-path', message: '该文件未在 Skill 清单登记' }
  return { kind: 'read', data: result }
}
