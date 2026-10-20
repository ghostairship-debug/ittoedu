import { z } from 'zod'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

const handle = z.string().min(1).max(256)
export const viewActionToolSchemas = {
  'view.click': z.object({ handle }).strict(),
  'view.input': z.object({ handle, value: z.string().max(8192) }).strict(),
} as const
export type ViewActionToolName = keyof typeof viewActionToolSchemas
const register = toolRegistrationFor<{ execute(name: ViewActionToolName, input: unknown): Promise<ToolResult> }>()
export const viewActionToolRegistrations = (Object.keys(viewActionToolSchemas) as ViewActionToolName[]).map(name => register({
  name,
  description: name === 'view.click'
    ? '点击最近一次 view/html 观察返回的元素 handle；软件沿同一载体会话分发并返回实际结果、新句柄和截图。actionReceipt分别报告派发、应用确认、目标及观察事实；应用已确认而观察失败时仅重新观察，未知结果也不得重复点击。不改作者工程或用户现场。旧句柄冲突后重新观察。'
    : '向最近一次 view/html 观察返回的控件 handle 输入 value；沿同一载体会话返回实际值、新句柄和截图，可操作文本和滑块。actionReceipt保留已发生的输入和实际值不匹配事实；观察失败不撤销应用确认，先重新观察再决定纠正动作。不可输入密码或文件控件，不改作者工程；源码变化后重新观察。',
  inputSchema: viewActionToolSchemas[name],
  manual: { label: name === 'view.click' ? '操作页面按钮' : '操作页面输入', group: 'edit', targetKinds: ['document'] },
}, {
  capability: 'read', effect: 'html-preview-action', exposure: 'direct',
  supports: context => context.observations !== false && context.viewActions !== false || context.htmlActions !== false, targets: () => [],
  handler: (context, input) => context.execute(name, input),
}))
export const viewActionToolRegistration = (name: string) => viewActionToolRegistrations.find(tool => tool.name === name)
