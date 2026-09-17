/**
 * Task scoped guidance shared by the native prompt and generated skill
 * documents. This module intentionally has no renderer or request imports.
 */

export const titleAlignmentGuidance = '涉及标题的文字或布局操作：同时表达文字框内的对齐方式与页面几何位置；需要居中时使用正式文字样式 textStyle.align=center，并让 frame 在页面可用区域内水平居中。无关文字修改不套用这条提醒。'

export const teacherControllerGuidance = '涉及教师控制台或组件控制台时：只使用工程内嵌组件；component.controller restore 用于显式恢复默认源码，参数用 component.configure，纹理/布局/结构用 component.package patch。保持全局唯一 role，不只改颜色冒充深度定制。背景融合仍独立于课件主动观察缩放、平移、Flow 滚动和 Spatial 镜头，但适应窗口与可用区域大小；透明空白穿透，真实控件可点。教师端口见 component-api4 的 sharedTypes.teacherController。'

export const generationRepairFeedbackGuidance = '宿主反馈属于同一任务的下一阶段：失败或明确的具体差距可在当前任务预算、身份和期限仍有效时继续局部修复；收到 committed/unchanged 且目标已满足就结束并答复。Stop、期限到达、身份/版本失效、没有新的具体进展或只要求重复相对修改时停止，不复活过期候选、不重复已提交修改。'

export interface CourseAgentTaskGuidanceInput {
  instruction: string
  context?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Return only guidance that can affect the requested task. */
export function courseAgentTaskGuidance(input: CourseAgentTaskGuidanceInput): string[] {
  const instruction = input.instruction.trim()
  const title = (/标题|主标题|小标题|heading|title/i.test(instruction)
    && /添加|新建|修改|调整|布局|位置|居中|对齐|center|align|position|layout/i.test(instruction))
    || (/(文字|文本|text)/i.test(instruction) && /居中|对齐|center|align/i.test(instruction))
  const controller = /控制台|教师控制器|组件控制台|组件源码|teacher\s*controller|component\s*(?:source|controller|configure|package)/i.test(instruction)
  const capabilities = record(record(input.context).capabilities)
  const toolIds = Array.isArray(capabilities.toolIds) ? capabilities.toolIds : []
  const controllerToolRequested = /组件|component/i.test(instruction)
    && toolIds.some(value => value === 'component.controller' || value === 'component.configure' || value === 'component.package')

  return [
    ...(title ? [titleAlignmentGuidance] : []),
    ...(controller || controllerToolRequested ? [teacherControllerGuidance] : []),
  ]
}
