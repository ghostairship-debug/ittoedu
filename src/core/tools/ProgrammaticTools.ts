import { z } from 'zod'
import { programmaticExecuteInputSchema, programmaticReadInputSchema } from '../../shared/workbench/programmatic'
import type { ModelJsonObject } from '../../shared/workbench/modelProvider'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

export interface ProgrammaticToolHandlers { executeProgrammatic(name: 'programmatic.execute' | 'programmatic.read', input: unknown): Promise<ToolResult> }
const register = toolRegistrationFor<ProgrammaticToolHandlers>()
const schemas = { 'programmatic.execute': programmaticExecuteInputSchema, 'programmatic.read': programmaticReadInputSchema } as const
export const programmaticToolRegistrations = (Object.keys(schemas) as Array<keyof typeof schemas>).map(name => register({
  name, inputSchema: schemas[name],
  description: name === 'programmatic.execute'
    ? '内置任务执行引擎的代码编排入口，用异步JavaScript整理多步数据或工具流程。await tools.describe(names?)按需读取实际工具定义；await tools.call(name,input)沿已有授权执行，写调用返回公开提交事实，读调用供程序内部消费。错误可catch，真实失败仍记录。仅显式return进入模型且大值按来源有界；programmatic.read可按原引用接续，脚本内可完整计算。脚本结束时未启动子项取消，已开始未知写保原身份不能重放；要采用结果应await。无Node/shell/网络或原始宿主。多调用非原子，一次事务仍用batch。'
    : '读取本任务或同任务续接原结果，runId省略取当前运行，callId沿用软件回执引用。path从完整ToolResult根选择字段；字符串按UTF-16、数组按项、对象按键用offset/limit续读。默认有界，大单项仍递归分段，complete/omitted/read说明未交付内容与原来源；程序内部可完整运算，不能用模型raw参数绕过交付预算。',
  manual: { label: name, group: name === 'programmatic.execute' ? 'edit' : 'read', targetKinds: [] },
}, {
  capability: name === 'programmatic.execute' ? 'resource' : 'read', effect: name === 'programmatic.execute' ? 'programmatic-execute' : null,
  family: 'jobs', supports: context => context.workbenchServices !== false, targets: () => [],
  handler: (context, input) => context.executeProgrammatic(name, input),
}))
export const programmaticRegistration = (name: string) => programmaticToolRegistrations.find(tool => tool.name === name)
/** Engine-managed tools retain the canonical metadata without becoming an external Gateway writer. */
export const programmaticTools = programmaticToolRegistrations.map(tool => ({ name: tool.name, description: tool.description,
  inputSchema: z.toJSONSchema(tool.inputSchema) as ModelJsonObject }))
