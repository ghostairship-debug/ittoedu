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
    ? '内置任务执行引擎的代码编排入口，用异步JavaScript整理多步数据或工具流程。await tools.describe(names?)按需读取实际工具定义；await tools.call(name,input)执行本任务已有授权工具并返回完整回执，错误抛出且可catch，真实失败仍记录于父失败列表。仅显式return的值进入模型；完整子调用回执可用programmatic.read读取。无Node、shell、网络或原始宿主对象。多次调用不组成原子事务，需一次事务时使用已有batch。'
    : '内置任务执行引擎中读取本任务programmatic执行所保留的完整子调用回执。runId省略时用当前运行；给定时仅可读同任务续接来源。callId沿用实际回执引用，path从完整ToolResult根选择具体字段；字符串或数组可用offset/limit局部读取，省略可完整读取。字符串offset按UTF-16单位，数组按项目数。',
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
