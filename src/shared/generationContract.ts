import { z } from 'zod'
import { authoringToolDestinationV1Schema, authoringToolCreateScopeV1Schema, authoringToolReceiptV1Schema } from './authoringToolContract'
import { workspaceIdentityV1Schema } from './workspaceIdentity'
import { authoringObservationInputSchema } from './authoringObservation'
import { authoringToolCarrier } from './authoringToolCarrier'
import { courseProjectAssetMetaSchema } from './contracts/media-v1/schema'

const identity = z.string().trim().min(1).max(200)
export const MAX_GENERATION_PROMPT_BYTES = 160_000
export const MAX_GENERATION_RESOURCE_BYTES = 12 * 1024 * 1024
export const MAX_GENERATION_TASK_DURATION_MS = 20 * 60 * 1000
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
  execution: z.object({ version: z.literal(1), startedAt: z.number().int().nonnegative(), deadlineAt: z.number().int().nonnegative() }).strict().optional(),
  repair: z.object({ logicalRequestId: z.uuid(), attempt: z.literal(1) }).strict().optional(),
  instruction: z.string().trim().min(1).max(20000),
  destinations: z.array(authoringToolDestinationV1Schema).min(1).max(1000),
  context: z.json(),
  resourceFiles: z.array(generationResourceFileSchema).max(1000).optional(),
  observation: authoringObservationInputSchema.optional(),
  confirmedDocuments: z.object({ teachingPlan: z.string().min(1), presentationScript: z.string().min(1) }).strict().optional(),
  allowedCarriers: z.array(generationCarrierSchema).min(1),
}).strict().superRefine((request, ctx) => {
  if (request.execution && (request.execution.deadlineAt <= request.execution.startedAt || request.execution.deadlineAt > request.execution.startedAt + MAX_GENERATION_TASK_DURATION_MS)) ctx.addIssue({ code: 'custom', message: '任务执行期限必须在起点后的20分钟内', path: ['execution'] })
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
export const generationAfterCommitSchema = z.discriminatedUnion('action', [
  z.object({ version: z.literal(1), action: z.literal('finish') }).strict(),
  z.object({ version: z.literal(1), action: z.literal('observe'), reason: z.string().trim().min(1).max(2000) }).strict(),
])
export type GenerationAfterCommit = z.infer<typeof generationAfterCommitSchema>
export const generationCandidateSchema = z.object({
  version: z.literal(1), requestId: z.uuid(), candidateId: z.uuid(),
  summary: z.string().trim().min(1).max(2000),
  afterCommit: generationAfterCommitSchema.optional(),
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

/** A request-scoped wire projection. Only the host supplies canonical targets and candidate identity. */
export const generationShortCandidateSchema = z.object({
  version: z.literal(2), requestId: z.uuid(), summary: z.string().trim().min(1).max(2000),
  afterCommit: generationAfterCommitSchema,
  steps: z.array(z.object({
    id: identity, tool: identity,
    destination: z.union([z.string().regex(/^d[1-9][0-9]*$/), resultDestinationSchema]),
    input: z.json(), lowerCarrierReason: z.string().trim().min(1).max(2000).optional(),
  }).strict()).min(1).max(1000),
}).strict()
export type GenerationShortCandidate = z.infer<typeof generationShortCandidateSchema>
export const generationCandidateTransportSchema = z.discriminatedUnion('version', [generationCandidateSchema, generationShortCandidateSchema])

export function generationDestinationAliases(request: Pick<GenerationRequest, 'destinations'>): Record<string, GenerationRequest['destinations'][number]> {
  return Object.fromEntries(request.destinations.map((destination, index) => [`d${index + 1}`, structuredClone(destination)]))
}

export const generationAssetReferenceSchema = z.object({ $asset: z.string().regex(/^a[1-9][0-9]*$/) }).strict()

/** Existing asset identities come only from this frozen request's formal asset
 * inventory. Staged aliases, arbitrary context text and live project state are
 * never input to expansion. Invalid/incomplete inventory entries get no alias. */
export function generationAssetAliases(request: Pick<GenerationRequest, 'context'>): Record<string, string> {
  const context = request.context
  const assets = context && typeof context === 'object' && !Array.isArray(context) ? context.assets : undefined
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return {}
  const ids = Object.keys(assets).sort().filter(id => {
    const asset = courseProjectAssetMetaSchema.safeParse(assets[id])
    return asset.success && asset.data.id === id
  })
  return Object.fromEntries(ids.map((id, index) => [`a${index + 1}`, id]))
}

function expandGenerationAssetReferences(value: unknown, aliases: Record<string, string>, path: (string | number)[]): unknown {
  if (Array.isArray(value)) return value.map((child, index) => expandGenerationAssetReferences(child, aliases, [...path, index]))
  if (!value || typeof value !== 'object') return value
  if (Object.hasOwn(value, '$asset')) {
    const reference = generationAssetReferenceSchema.safeParse(value)
    if (!reference.success) throw new z.ZodError(reference.error.issues.map(issue => ({ ...issue, path: [...path, ...issue.path] })))
    const assetId = aliases[reference.data.$asset]
    if (!assetId) throw new z.ZodError([{ code: 'custom', path: [...path, '$asset'], message: `未知或已过期的当前请求资产别名 ${reference.data.$asset}` }])
    return assetId
  }
  // Earlier step results have their own existing strict dependency contract.
  if (Object.hasOwn(value, '$result')) return structuredClone(value)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, expandGenerationAssetReferences(child, aliases, [...path, key])]))
}

export function expandGenerationShortCandidate(raw: unknown, rawRequest: GenerationRequest, candidateId: string): GenerationCandidate {
  const request = generationRequestSchema.parse(rawRequest)
  const candidate = generationShortCandidateSchema.parse(raw)
  if (candidate.requestId !== request.requestId) throw new Error('生成结果属于其他请求')
  const aliases = generationDestinationAliases(request)
  const assetAliases = generationAssetAliases(request)
  return generationCandidateSchema.parse({ ...candidate, version: 1, candidateId,
    steps: candidate.steps.map((step, index) => {
      const destination = typeof step.destination === 'string' ? aliases[step.destination] : step.destination
      if (!destination) throw new Error(`${step.id}: 未知的当前请求目标别名 ${step.destination}`)
      const input = expandGenerationAssetReferences(step.input, assetAliases, ['steps', index, 'input'])
      return { ...step, destination, input, carrier: authoringToolCarrier(step.tool, input) }
    }),
  })
}

export const generationDiagnosticSchema = authoringToolReceiptV1Schema.shape.diagnostics.element
export const generationFailureSchema = z.object({
  version: z.literal(1), stage: z.enum(['candidate-parse', 'prepare', 'dynamic-admission', 'commit']),
  requestId: z.uuid().optional(), candidateId: z.uuid().optional(), stepId: identity.optional(), tool: identity.optional(),
  destination: z.union([authoringToolDestinationV1Schema, resultDestinationSchema]).optional(),
  diagnostics: z.array(generationDiagnosticSchema).min(1),
  assetIds: z.array(identity), packageIds: z.array(identity),
  behaviorEvidence: authoringToolReceiptV1Schema.shape.behaviorEvidence,
}).strict()
export type GenerationFailure = z.infer<typeof generationFailureSchema>

/** Keep structured validation locations through the display-summary boundary. */
export function generationFailureDiagnostics(error: unknown, fallbackCode: string): GenerationFailure['diagnostics'] {
  if (error instanceof z.ZodError) {
    const flatten = (issues: readonly z.ZodIssue[], prefix: (string | number)[] = []): GenerationFailure['diagnostics'] => issues.flatMap(issue => {
      const path = [...prefix, ...issue.path.map(segment => typeof segment === 'number' ? segment : String(segment))]
      return issue.code === 'invalid_union' ? issue.errors.flatMap(branch => flatten(branch, path))
        : [{ code: issue.code, message: issue.message, path }]
    })
    return flatten(error.issues)
  }
  return [{ code: fallbackCode, message: error instanceof Error ? error.message : String(error), path: [] }]
}

export class GenerationCandidatePreparationError extends Error {
  readonly failure: GenerationFailure
  constructor(failure: GenerationFailure) {
    super(failure.diagnostics.map(value => `${value.code}${value.path.length ? ` [${value.path.join('.')}]` : ''}: ${value.message}`).join('\n'))
    this.name = 'GenerationCandidatePreparationError'
    this.failure = generationFailureSchema.parse(failure)
  }
}

export function readGenerationFailure(error: unknown): GenerationFailure | undefined {
  const parsed = generationFailureSchema.safeParse(error && typeof error === 'object' ? Reflect.get(error, 'failure') : undefined)
  return parsed.success ? parsed.data : undefined
}

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
