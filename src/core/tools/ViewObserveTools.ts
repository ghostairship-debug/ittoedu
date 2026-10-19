import { viewObserveInputSchema } from '../../shared/workbench/viewObservation'
import type { ObservationServicePort } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const viewObserveTool = { name: 'view.observe' as const,
  description: '观察课件页面的实际呈现，按回执source、identity、coverage判断载体和范围。需要局部画面时传clip:{x,y,width,height}，单位为原预览viewport的CSS像素；clip只裁PNG并筛选相交控件，structure仍为整viewport可见文字。回执coverage说明裁剪与PNG比例，elements仍用原坐标，原图保留为originalImage资源。隔离Published观察在同一任务、文档版本内保留正常播放器和程序运行状态，并返回可操作elements/handle；用view.click/input操作最近句柄，再看实际结果。换页继续观察对应工程路径，沿同一会话保留实验记录；源码变化后重新观察会重建该版本会话。工程文件使用project.list返回的页面或对象path；多课件用project指明，也可用已授权target。观察及输入不改作者工程、用户选区或现场播放器，不证明另一导出路径性能。purpose默认required；自行添加的可选诊断可用diagnostic，诊断不可用仍保留未验证说明，不表示通过。',
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
    : await context.resolveFileTarget?.(parsed.data.project, parsed.data.path)
  if (!target) return { kind: 'error', code: 'target-not-found', message: '页面目标不存在、已过期或没有读取授权' }
  try {
    const observation = await service.observe({ runId: context.runId, requestId: context.operationId, ...target,
      ...(parsed.data.clip ? { clip: parsed.data.clip } : {}) })
    return { kind: 'read', data: { ...observation, detail: parsed.data.detail ?? 'auto' } }
  } catch (error) {
    return { kind: 'error', code: 'observation-failed', message: error instanceof Error ? error.message : String(error) }
  }
}
