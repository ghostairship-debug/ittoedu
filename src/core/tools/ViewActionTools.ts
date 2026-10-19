import { z } from 'zod'
import type { ToolResult } from '../../shared/workbench/tools'
import { hasRunDocument, toolRegistrationFor } from './ToolRegistration'

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
    ? '点击最近一次 view.observe 或页面动作回执中的元素 handle，返回真实运行结果、新句柄和截图。沿本任务同一隔离播放器操作，不改作者工程或用户选区；换页继续 view.observe 对应工程路径，保留该版本的实验状态。旧句柄会冲突，不能猜测或重复未知结果的点击。'
    : '向最近一次 view.observe 或页面动作返回的控件 handle 输入 value，返回实际值、运行结果、新句柄和截图。沿同一隔离播放器真实输入，可操作文本和滑块；不可输入密码或文件控件。不修改作者工程；源码变化后重新观察。',
  inputSchema: viewActionToolSchemas[name],
  manual: { label: name === 'view.click' ? '操作页面按钮' : '操作页面输入', group: 'edit', targetKinds: ['document'] },
}, {
  capability: 'read', effect: 'html-preview-action', exposure: 'direct',
  supports: context => context.observations !== false && context.viewActions !== false && hasRunDocument(context, 'course-v10'), targets: () => [],
  handler: (context, input) => context.execute(name, input),
}))
export const viewActionToolRegistration = (name: string) => viewActionToolRegistrations.find(tool => tool.name === name)
