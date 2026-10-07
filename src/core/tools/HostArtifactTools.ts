import { z } from 'zod'
import type { ModelJsonObject, ModelToolDefinition } from '../../shared/workbench/modelProvider'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'

const id = z.string().min(1).max(512)
const destination = z.string().min(1).max(32767)
/** Source identities are owner receipts; the user supplies only the destination. */
export const hostArtifactSaveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), job: id, resourceId: id, destination }).strict(),
  z.object({ kind: z.literal('compute'), job: id, name: z.string().min(1).max(256), destination }).strict(),
])
export type HostArtifactSaveInput = z.infer<typeof hostArtifactSaveSchema>
export const hostArtifactSaveTool: ModelToolDefinition = {
  name: 'artifact.save',
  description: '把本任务已确认 ready 的独立图片或受限计算成果保存为工作空间新文件；目标已存在时拒绝覆盖。作业 ready 与文件已保存分别有回执，文件字节不进入模型上下文。',
  inputSchema: z.toJSONSchema(hostArtifactSaveSchema) as ModelJsonObject,
}
/** Both agent entry points use the same source and file owners. */
export interface HostArtifactToolContext {
  runId: string
  operationId: string
  requestDigest: string
  host: { saveArtifact(runId: string, operationId: string, requestDigest: string, input: HostArtifactSaveInput): Promise<ToolResult> }
}
const registerArtifact = toolRegistrationFor<HostArtifactToolContext>()
export const hostArtifactSaveRegistration = registerArtifact({ name: 'artifact.save',
  description: hostArtifactSaveTool.description, inputSchema: hostArtifactSaveSchema,
  manual: { label: '保存成果文件', group: 'edit', targetKinds: [] },
}, {
  capability: 'save', effect: 'artifact-delivery', family: 'jobs',
  supports: context => context.workbenchServices !== false && (!('artifacts' in context) || context.artifacts !== false),
  targets: () => [],
  handler: (context, input) => context.host.saveArtifact(context.runId, context.operationId, context.requestDigest, input),
})
