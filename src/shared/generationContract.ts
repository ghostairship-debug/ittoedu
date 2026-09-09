import { z } from 'zod'
import { authoringToolDestinationV1Schema, authoringToolCreateScopeV1Schema, authoringToolReceiptV1Schema } from './authoringToolContract'
import { workspaceIdentityV1Schema } from './workspaceIdentity'
import { authoringObservationInputSchema } from './authoringObservation'

const identity = z.string().trim().min(1).max(200)
export const MAX_GENERATION_PROMPT_BYTES = 160_000
export const MAX_GENERATION_RESOURCE_BYTES = 12 * 1024 * 1024
export const generationResourceFileSchema = z.object({
  path: z.string().min(1).max(1000).refine(value => !value.includes('\\') && !value.includes(':') && !value.includes('\0')
    && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..'), '需要资源根内相对路径'),
  encoding: z.enum(['utf8', 'base64']), content: z.string().max(MAX_GENERATION_RESOURCE_BYTES),
  mediaType: z.string().min(1).max(100).optional(), role: z.enum(['source', 'image', 'material', 'capability', 'structure', 'runtime-evidence']).optional(),
}).strict()
export const generationInputReferenceSchema = z.object({ $result: z.object({
  stepId: identity, kind: z.enum(['asset-id', 'package-id', 'item-id', 'location-id']), index: z.number().int().nonnegative().default(0),
}).strict() }).strict()
export function visitGenerationInputReferences(value: unknown, visit: (reference: z.infer<typeof generationInputReferenceSchema>['$result']) => void) {
  if (!value || typeof value !== 'object') return
  if ('$result' in value) { visit(generationInputReferenceSchema.parse(value).$result); return }
  for (const nested of Object.values(value)) visitGenerationInputReferences(nested, visit)
}
export const generationCarrierSchema = z.enum(['native', 'recipe', 'existing-component', 'generated-component', 'runtime'])
export const generationRequestSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), workspace: workspaceIdentityV1Schema,
  documentRevision: z.number().int().nonnegative(), sessionGeneration: z.number().int().nonnegative(),
  purpose: z.enum(['single-page', 'whole-course', 'local-edit']),
  expectedResult: z.enum(['auto', 'candidate']).optional(),
  intent: z.enum(['discuss', 'plan', 'edit']).optional(),
  applyPolicy: z.enum(['auto', 'preview']).optional(),
  repair: z.object({ logicalRequestId: z.uuid(), attempt: z.literal(1) }).strict().optional(),
  instruction: z.string().trim().min(1).max(20000),
  destinations: z.array(authoringToolDestinationV1Schema).min(1).max(1000),
  context: z.json(),
  resourceFiles: z.array(generationResourceFileSchema).max(1000).optional(),
  observation: authoringObservationInputSchema.optional(),
  confirmedDocuments: z.object({ teachingPlan: z.string().min(1), presentationScript: z.string().min(1) }).strict().optional(),
  allowedCarriers: z.array(generationCarrierSchema).min(1),
}).strict().superRefine((request, ctx) => {
  const resources = request.resourceFiles ?? []
  if (request.observation && (request.observation.documentRevision !== request.documentRevision || request.observation.sessionGeneration !== request.sessionGeneration)) ctx.addIssue({ code: 'custom', message: '当前画面观察与工程结构版本不一致', path: ['observation'] })
  if (request.applyPolicy === 'auto' && !request.observation) ctx.addIssue({ code: 'custom', message: '自动编辑需要当前真实画面观察', path: ['applyPolicy'] })
  if (new Set(resources.map(file => file.path.toLowerCase())).size !== resources.length) ctx.addIssue({ code: 'custom', message: '重复资源文件路径', path: ['resourceFiles'] })
  if (resources.reduce((bytes, file) => bytes + new TextEncoder().encode(file.content).byteLength, 0) > MAX_GENERATION_RESOURCE_BYTES) ctx.addIssue({ code: 'custom', message: '本轮附件超过容量，请缩小引用范围', path: ['resourceFiles'] })
  if (request.purpose === 'whole-course' && !request.confirmedDocuments) ctx.addIssue({ code: 'custom', message: '整课生成需要已确认的两份 Markdown', path: ['confirmedDocuments'] })
  request.destinations.forEach((destination, i) => {
    const target = destination.kind === 'update' ? destination.target : destination.scope
    if (target.projectId !== request.workspace.projectId || target.documentRevision !== request.documentRevision || target.sessionGeneration !== request.sessionGeneration) {
      ctx.addIssue({ code: 'custom', message: '请求目标身份、revision 或 generation 不一致', path: ['destinations', i] })
    }
  })
})

// New identities are resolved from earlier host results, never guessed by a CLI.
const resultDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created-item'), stepId: identity, index: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal('created-scope'), stepId: identity,
    parent: authoringToolCreateScopeV1Schema.shape.parent, insertion: authoringToolCreateScopeV1Schema.shape.insertion }).strict(),
])
export const generationCandidateSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), candidateId: z.uuid(),
  summary: z.string().trim().min(1).max(2000),
  steps: z.array(z.object({
    id: identity, tool: identity,
    carrier: generationCarrierSchema,
    lowerCarrierReason: z.string().trim().min(1).max(2000).optional(),
    destination: z.union([authoringToolDestinationV1Schema, resultDestinationSchema]),
    input: z.json(),
  }).strict()).min(1).max(1000),
}).strict().superRefine((candidate, ctx) => {
  const seen = new Set<string>()
  candidate.steps.forEach((step, i) => {
    if (seen.has(step.id)) ctx.addIssue({ code: 'custom', message: '重复 step ID', path: ['steps', i, 'id'] })
    if ('stepId' in step.destination && !seen.has(step.destination.stepId)) ctx.addIssue({ code: 'custom', message: '只能引用已完成的前序 step', path: ['steps', i, 'destination'] })
    try { visitGenerationInputReferences(step.input, reference => {
      if (!seen.has(reference.stepId)) ctx.addIssue({ code: 'custom', message: '输入只能引用前序宿主结果', path: ['steps', i, 'input'] })
    }) } catch { ctx.addIssue({ code: 'custom', message: '输入结果引用格式无效', path: ['steps', i, 'input'] }) }
    if (step.carrier !== 'native' && !step.lowerCarrierReason) ctx.addIssue({ code: 'custom', message: '高阶载体必须说明低阶载体不能满足的需求', path: ['steps', i, 'lowerCarrierReason'] })
    seen.add(step.id)
  })
})
export type GenerationRequest = z.infer<typeof generationRequestSchema>
export type GenerationCandidate = z.infer<typeof generationCandidateSchema>

/** One real candidate transaction, distinct from individual tools executed on a preparation copy. */
export const generationCommitReceiptSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), candidateId: z.uuid(), workspace: workspaceIdentityV1Schema,
  status: z.enum(['committed', 'unchanged']), beforeRevision: z.number().int().nonnegative(), afterRevision: z.number().int().nonnegative(),
  affected: authoringToolReceiptV1Schema.shape.affected,
  resources: authoringToolReceiptV1Schema.shape.resources,
}).strict().superRefine((receipt, ctx) => {
  if (receipt.afterRevision !== receipt.beforeRevision + (receipt.status === 'committed' ? 1 : 0)) ctx.addIssue({ code: 'custom', message: '批次回执revision与实际事务状态不一致' })
  if (receipt.status === 'unchanged' && (receipt.affected.length || receipt.resources.assetIds.length || receipt.resources.packageIds.length)) ctx.addIssue({ code: 'custom', message: '未改变批次不能声明实际变更' })
})
export type GenerationCommitReceipt = z.infer<typeof generationCommitReceiptSchema>
