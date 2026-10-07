import { z } from 'zod'
import type { ToolDefinition, ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

const noInput = z.object({}).strict()
/** Transient handle from the most recent html.observe or action receipt. */
const handle = z.string().min(1).max(256)

/** Only intent crosses the model boundary. Run, source revision, loadId and
 * action operationId are supplied and checked by Main. */
export const htmlActionToolSchemas = {
  'html.observe': z.object({ purpose: z.enum(['required', 'diagnostic']).optional() }).strict(),
  'html.navigate': z.object({ index: z.number().int().min(0).max(10_000) }).strict(),
  'html.click': z.object({ handle }).strict(),
  'html.input': z.object({ handle, value: z.string().max(8192) }).strict(),
  'html.errors': noInput,
} as const

export type HtmlActionToolName = keyof typeof htmlActionToolSchemas
export const isHtmlActionTool = (name: string): name is HtmlActionToolName =>
  Object.hasOwn(htmlActionToolSchemas, name)

const descriptions: Record<HtmlActionToolName, string> = {
  'html.observe': '观察本任务冻结的当前 HTML 文档在受管预览中的真实状态和截图；返回本次观察的短元素句柄。优先复用当前版本预览；没有可用预览时由宿主准备任务独立预览，不切换用户标签。源码修改后重新观察；未观察到真实画面时明确失败。purpose 默认 required；用户明确要求的检查必须保持 required，仅你自行添加的可选诊断可用 diagnostic。诊断不可用保留未验证说明，不表示检查通过，也不改变权限。',
  'html.navigate': '将当前 HTML 预览翻到指定页码（从 0 开始），随后返回该页真实状态和截图；只在本任务绑定的页面内操作。',
  'html.click': '点击最近一次 HTML 观察返回的元素句柄，随后重新读取真实状态和截图。旧句柄或页面变化会冲突；不得重复猜测同一点击是否发生。',
  'html.input': '向最近一次 HTML 观察返回的可编辑元素句柄输入 value，并触发页面输入事件，随后重新读取真实状态和截图。不可输入密码或文件控件。',
  'html.errors': '读取当前 HTML 预览会话已捕获的页面错误与警告；仅涵盖会话建立后的诊断，不把缺失日志说成页面无错误。',
}

export const htmlActionToolCatalog = (Object.keys(htmlActionToolSchemas) as HtmlActionToolName[])
  .map(name => ({ name, description: descriptions[name], inputSchema: htmlActionToolSchemas[name],
    manual: { label: name, group: (name === 'html.click' || name === 'html.input' ? 'edit' : 'read') as 'read' | 'edit',
      targetKinds: ['document'] as ToolDefinition['manual']['targetKinds'] } }))
const registerHtmlAction = toolRegistrationFor<{ execute(name: HtmlActionToolName, input: unknown): Promise<ToolResult> }>()
export const htmlActionToolRegistrations = htmlActionToolCatalog.map(tool => registerHtmlAction(tool, {
  capability: 'read', effect: tool.name === 'html.click' || tool.name === 'html.input' ? 'html-preview-action' : null,
  supports: context => context.htmlActions !== false, targets: () => [],
  handler: (context, input) => context.execute(tool.name, input),
}))
export function htmlActionToolRegistration(name: string) { return htmlActionToolRegistrations.find(tool => tool.name === name) }
