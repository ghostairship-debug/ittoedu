import { z } from 'zod'
import type { ModelJsonObject, ModelToolDefinition } from '../../shared/workbench/modelProvider'
import type { ToolResult } from '../../shared/workbench/tools'
import { toolRegistrationFor } from './ToolRegistration'
import { parseGeneratedImageReference } from '../../shared/workbench/images'

const id = z.string().min(1)
const destination = z.string().min(1).max(32767)
/** Source identities are owner receipts; the user supplies only the destination. */
export const hostArtifactSaveSchema = z.object({ source: id, destination: destination.optional() }).strict()
export type HostArtifactSaveInput = z.infer<typeof hostArtifactSaveSchema>
export type HostArtifactResolvedSource = ({ kind: 'image'; job: string; resourceId: string }
  | { kind: 'image-resource'; resource: string }
  | { kind: 'media-resource'; resource: string }
  | { kind: 'compute' | 'delegation'; job: string; name: string }) & { destination: string }
/** Delivery retains the owner's source identity; temporary image handles are not job references. */
export function artifactDeliverySource(source: HostArtifactResolvedSource): { sourceKind: 'image' | 'media' | 'compute' | 'delegation'; sourceId: string } {
  if (source.kind === 'image-resource') return { sourceKind: 'image', sourceId: source.resource }
  if (source.kind === 'media-resource') return { sourceKind: 'media', sourceId: source.resource }
  return { sourceKind: source.kind, sourceId: source.kind === 'image'
    ? `${source.job}@${source.resourceId}` : `${source.job}@${source.name}` }
}
/** Encoding belongs to the result owner; callers copy a returned source unchanged. */
export const computeArtifactSource = (job: string, name: string): string => `${job}@${encodeURIComponent(name)}`
export const delegationArtifactSource = (job: string, name: string): string => `${job}@${encodeURIComponent(name)}`
export function resolveJobArtifactSource(source: string): { kind: 'compute' | 'delegation'; job: string; name: string } | null {
  const match = /^((compute|delegate)-[^@\s]+)@(.+)$/.exec(source)
  return match ? { kind: match[2] === 'compute' ? 'compute' : 'delegation', job: match[1]!, name: decodeURIComponent(match[3]!) } : null
}
export function resolveArtifactSource(input: Required<HostArtifactSaveInput>): HostArtifactResolvedSource {
  if (input.source.startsWith('media:')) return { kind: 'media-resource', resource: input.source, destination: input.destination }
  const image = parseGeneratedImageReference(input.source)
  if (image) return { kind: 'image', job: image.jobId, resourceId: image.resourceId, destination: input.destination }
  const job = resolveJobArtifactSource(input.source)
  if (job) return { ...job, destination: input.destination }
  if (/^workspace-image:[a-f0-9]{64}:image_[a-f0-9]{64}$/.test(input.source))
    return { kind: 'image-resource', resource: input.source, destination: input.destination }
  // Gateway-issued image resources are checked against the current run/document/epoch by their reader.
  if (/^r[^@\s]+$/.test(input.source)) return { kind: 'image-resource', resource: input.source, destination: input.destination }
  throw new Error('成果来源无效；请使用创建、状态或等待返回的 source')
}
export const hostArtifactSaveTool: ModelToolDefinition = {
  name: 'artifact.save',
  description: '把创建、状态或等待返回的 source，或 image.fetch 返回的 resource 原样传入，保存当前任务已获授权且 ready 的图片、生成媒体或计算/委派成果为新文件。计算/委派文件省略 destination 时，软件放入本运行内部装配目录并保留同作业相对目录关系，返回实际 path 可供 file.read/write 或 from 采用；同组成果可直接 from 时无需先落盘。用户要交付的文件显式填 destination，相对路径仍从工作空间根解析；图片/媒体需明确目的地。语音使用 media.start 返回的 job.resources[].source。不拼接身份或选择 kind；目标已存在时拒绝覆盖。ready、内部装配、已交付分别判断。',
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
