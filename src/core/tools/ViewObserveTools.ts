import { viewObserveInputSchema } from '../../shared/workbench/viewObservation'
import type { ObservationServicePort } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const viewObserveTool = { name: 'view.observe' as const,
  description: '观察已授权 H5 演示指定页面的真实画面。可观察非当前页；不更改文档、选区或当前播放状态。purpose 默认 required；用户明确要求的检查必须保持 required，仅你自行添加的可选诊断可用 diagnostic。诊断不可用会保留未验证说明，不表示检查通过，也不改变任何权限。',
  inputSchema: viewObserveInputSchema,
  manual: { label: '查看页面', group: 'read' as const, targetKinds: ['course-location', 'course-owner', 'course-state', 'course-object', 'document'] as const },
}

export interface ViewObserveToolContext {
  runId: string
  operationId: string
  resolveTarget(handle: string): Promise<{ documentId: string; epoch: string; revision: number;
    projectId: string; locationId: string; viewGeneration?: string } | null>
}

export async function executeViewObserveTool(service: ObservationServicePort,
  context: ViewObserveToolContext, raw: unknown): Promise<ToolResult> {
  const parsed = viewObserveInputSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input', message: '查看页面参数无效：' + parsed.error.issues.map(issue => issue.message).join('；') }
  const target = await context.resolveTarget(parsed.data.target)
  if (!target) return { kind: 'error', code: 'target-not-found', message: '页面目标不存在、已过期或没有读取授权' }
  try {
    const observation = await service.observe({ runId: context.runId, requestId: context.operationId, ...target })
    return { kind: 'read', data: { ...observation, detail: parsed.data.detail ?? 'auto' } }
  } catch (error) {
    return { kind: 'error', code: 'observation-failed', message: error instanceof Error ? error.message : String(error) }
  }
}
