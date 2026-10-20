import { viewObserveInputSchema } from '../../shared/workbench/viewObservation'
import type { ObservationServicePort } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const viewObserveTool = { name: 'view.observe' as const,
  description: '观察已授权课件或 HTML 的真实画面、结构和元素 handle；软件按 target/path 的载体分发，view.click/input 操作最近观察。课件用 project.list 的页面/对象 path 与可选 project，或 target；HTML 用已打开文件 target/path，已通过 file.open 固定唯一 HTML 后可省略目标。HTML 支持 query/offset/limit/cursor，cursor 续同次观察；课件局部画面用 clip:{x,y,width,height}（viewport CSS 像素），结构仍为全 viewport，元素保留原坐标。回执 source/identity/coverage 说明版本与范围；同一版本隔离会话保留运行状态，源码变化后重建。观察和输入不改作者工程或用户现场。purpose 默认 required；可选诊断用 diagnostic，不可用时明确未验证。',
  inputSchema: viewObserveInputSchema,
  manual: { label: '查看页面', group: 'read' as const, targetKinds: ['course-surface', 'course-instance', 'course-location', 'course-owner', 'course-state', 'course-object', 'document'] as const },
}

type ObserveTarget = { documentId: string; epoch: string; revision: number;
  projectId: string; locationId: string; stateId?: string | null; viewGeneration?: string }
export interface ViewObserveToolContext {
  runId: string
  operationId: string
  resolveTarget(handle: string): Promise<ObserveTarget | null>
  resolveFileTarget?(project: string | undefined, path: string): Promise<ObserveTarget | null>
}

export async function executeViewObserveTool(service: ObservationServicePort,
  context: ViewObserveToolContext, raw: unknown): Promise<ToolResult> {
  const parsed = viewObserveInputSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input', message: '查看页面参数无效：' + parsed.error.issues.map(issue => issue.message).join('；') }
  const target = 'target' in parsed.data ? await context.resolveTarget(parsed.data.target)
    : 'path' in parsed.data ? await context.resolveFileTarget?.(parsed.data.project, parsed.data.path) : null
  if (!target) return { kind: 'error', code: 'target-not-found', message: '页面目标不存在、已过期或没有读取授权' }
  try {
    const observation = await service.observe({ runId: context.runId, requestId: context.operationId, ...target,
      ...(parsed.data.clip ? { clip: parsed.data.clip } : {}) })
    return { kind: 'read', data: { ...observation, detail: parsed.data.detail ?? 'auto' } }
  } catch (error) {
    return { kind: 'error', code: 'observation-failed', message: error instanceof Error ? error.message : String(error) }
  }
}
