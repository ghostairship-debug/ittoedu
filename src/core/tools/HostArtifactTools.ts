import { z } from 'zod'
import type { ModelJsonObject, ModelToolDefinition } from '../../shared/workbench/modelProvider'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'
import { parseGeneratedImageReference } from '../../shared/workbench/images'

const id = z.string().min(1)
const destination = z.string().min(1).max(32767)
/** Source identities are owner receipts; the user supplies only the destination. */
export const hostArtifactSaveSchema = z.object({ source: id, destination }).strict()
export type HostArtifactSaveInput = z.infer<typeof hostArtifactSaveSchema>
export type HostArtifactResolvedSource = ({ kind: 'image'; job: string; resourceId: string }
  | { kind: 'image-resource'; resource: string }
  | { kind: 'compute' | 'delegation'; job: string; name: string }) & { destination: string }
/** Delivery retains the owner's source identity; temporary image handles are not job references. */
export function artifactDeliverySource(source: HostArtifactResolvedSource): { sourceKind: 'image' | 'compute' | 'delegation'; sourceId: string } {
  if (source.kind === 'image-resource') return { sourceKind: 'image', sourceId: source.resource }
  return { sourceKind: source.kind, sourceId: source.kind === 'image'
    ? `${source.job}@${source.resourceId}` : `${source.job}@${source.name}` }
}
/** Encoding belongs to the result owner; callers copy a returned source unchanged. */
export const computeArtifactSource = (job: string, name: string): string => `${job}@${encodeURIComponent(name)}`
export const delegationArtifactSource = (job: string, name: string): string => `${job}@${encodeURIComponent(name)}`
export function resolveArtifactSource(input: HostArtifactSaveInput): HostArtifactResolvedSource {
  const image = parseGeneratedImageReference(input.source)
  if (image) return { kind: 'image', job: image.jobId, resourceId: image.resourceId, destination: input.destination }
  const compute = /^(compute-[^@\s]+)@(.+)$/.exec(input.source)
  if (compute) return { kind: 'compute', job: compute[1]!, name: decodeURIComponent(compute[2]!), destination: input.destination }
  const delegated = /^(delegate-[^@\s]+)@(.+)$/.exec(input.source)
  if (delegated) return { kind: 'delegation', job: delegated[1]!, name: decodeURIComponent(delegated[2]!), destination: input.destination }
  if (/^workspace-image:[a-f0-9]{64}:image_[a-f0-9]{64}$/.test(input.source))
    return { kind: 'image-resource', resource: input.source, destination: input.destination }
  // Gateway-issued image resources are checked against the current run/document/epoch by their reader.
  if (/^r[^@\s]+$/.test(input.source)) return { kind: 'image-resource', resource: input.source, destination: input.destination }
  throw new Error('成果来源无效；请使用创建、状态或等待返回的 source')
}
export const hostArtifactSaveTool: ModelToolDefinition = {
  name: 'artifact.save',
  description: '把创建、状态或等待返回的 source，或 image.fetch 返回的 resource 原样传入，保存当前任务已获授权且 ready 的图片或计算成果为工作空间新文件。仅指定来源和目的地，不拼接身份或选择 kind；目标已存在时拒绝覆盖。ready 与已保存分别有回执。',
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
