import { z } from 'zod'
import { authoringToolDestinationV1Schema, authoringToolCreateScopeV1Schema, authoringToolReceiptV1Schema, authoringToolTargetWireV1Schema } from './authoringToolContract'
import { workspaceIdentityV1Schema } from './workspaceIdentity'
import { authoringObservationInputSchema } from './authoringObservation'
import { authoringToolCarrier } from './authoringToolCarrier'
import { courseProjectAssetMetaSchema } from './contracts/media-v1/schema'

const identity = z.string().trim().min(1).max(200)
export const generationInputReferenceSchema = z.object({ $result: z.object({
  stepId: identity, kind: z.enum(['asset-id', 'package-id', 'item-id', 'location-id']), index: z.number().int().nonnegative().default(0),
}).strict() }).strict()
const assetResultReferenceSchema = z.object({ $result: generationInputReferenceSchema.shape.$result.extend({ kind: z.literal('asset-id') }) }).strict()
export const MAX_GENERATION_PROMPT_BYTES = 160_000
export const MAX_GENERATION_RESOURCE_BYTES = 12 * 1024 * 1024
export const MAX_GENERATION_TASK_DURATION_MS = 20 * 60 * 1000
export const generationResourceFileSchema = z.object({
  path: z.string().min(1).max(1000).refine(value => !value.includes('\\') && !value.includes(':') && !value.includes('\0')
    && !value.startsWith('/') && !value.split('/').some(part => !part || part === '.' || part === '..'), '需要资源根内相对路径'),
  encoding: z.enum(['utf8', 'base64']), content: z.string().max(MAX_GENERATION_RESOURCE_BYTES),
  mediaType: z.string().min(1).max(100).optional(), role: z.enum(['source', 'image', 'material', 'capability', 'structure', 'runtime-evidence']).optional(),
}).strict()
/** Candidate transport only: Main expands this exact media-import field into
 * the canonical tool's existing base64 string before renderer admission. */
export const generationMediaFileReferenceSchema = z.object({
  $candidateFile: generationResourceFileSchema.shape.path.refine(value => value.startsWith('resources/'), '素材必须位于本轮 resources 目录'),
}).strict()
/** File transport only; the formal tool parses the materialized strict V9 artifact. */
export const generationProjectDocumentWireInputSchema = z.object({ artifact: generationMediaFileReferenceSchema }).strict()
export const generationAssetReferenceSchema = z.object({ $asset: z.string().regex(/^a[1-9][0-9]*$/) }).strict()
/** Main materializes only a current, closed candidate file into this internal source. */
export const generationMediaApplyFileSourceSchema = z.object({
  base64: z.string().min(1).max(90_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  filename: z.string().min(1).max(500), mimeType: z.string().min(1).max(120),
}).strict()
const mediaApplyFields = {
  kind: z.literal('image'), fit: z.enum(['contain', 'cover', 'stretch']).optional(),
  placement: z.enum(['content', 'background']).optional(), preserveResolution: z.boolean().optional(),
}
export const generationMediaApplyWireInputSchema = z.object({ ...mediaApplyFields,
  source: z.union([generationMediaFileReferenceSchema, generationAssetReferenceSchema, z.object({ assetId: z.union([identity, assetResultReferenceSchema]) }).strict()]),
}).strict()
export const generationMediaApplyInputSchema = generationMediaApplyWireInputSchema.extend({
  source: z.union([...generationMediaApplyWireInputSchema.shape.source.options, generationMediaApplyFileSourceSchema]),
}).strict()
export type GenerationMediaApplyInput = z.infer<typeof generationMediaApplyInputSchema>

/** Strict input, discovery and examples have one owner. This is a candidate
 * expansion, not a second document API or a standalone Builder tool. */
export function describeGenerationSemanticTools() {
  return [{ name: 'media.apply', candidateCarrier: { default: 'native' as const },
    description: '将真实图片应用到目标：已有图片保留实例身份和未指定显示属性；形状转换为图片并保留位置、层级与可映射引用；create目标插入图片。placement:background只用于正式背景目标。source使用本轮图片文件或已有图片资产。fit省略时保留已有显示方式，新图默认contain；Flow正文与背景只接受contain。preserveResolution:true保留文字图或大图原始清晰度。宿主完成图片准备、素材导入和一次可撤销提交，无需拼装工程步骤。',
    scopes: ['slide:scene', 'slide:surface', 'slide:global', 'flow:surface', 'flow:global', 'spatial-2d:world', 'spatial-2d:surface', 'spatial-2d:global'],
    inputSchema: z.toJSONSchema(generationMediaApplyWireInputSchema),
    examples: [{ input: { kind: 'image', source: { $candidateFile: 'resources/dog.png' }, fit: 'contain' } }],
  }]
}
export function visitGenerationInputReferences(value: unknown, visit: (reference: z.infer<typeof generationInputReferenceSchema>['$result']) => void) {
  if (!value || typeof value !== 'object') return
  if ('$result' in value) { visit(generationInputReferenceSchema.parse(value).$result); return }
  for (const nested of Object.values(value)) visitGenerationInputReferences(nested, visit)
}
export const generationCarrierSchema = z.enum(['native', 'recipe', 'existing-component', 'generated-component', 'runtime'])
/** Optional placement hints bound to the focus; these do not define edit permissions. */
export const generationSelectionActionSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('reorder'), target: authoringToolTargetWireV1Schema }).strict(),
  z.object({ operation: z.literal('duplicate'), target: authoringToolTargetWireV1Schema }).strict(),
  z.object({ operation: z.literal('insert-image-after'), target: authoringToolTargetWireV1Schema,
    destination: z.object({ kind: z.literal('create'), scope: authoringToolCreateScopeV1Schema }).strict(),
  }).strict(),
])
export type GenerationSelectionAction = z.infer<typeof generationSelectionActionSchema>
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
  selectionActions: z.array(generationSelectionActionSchema).min(1).max(100).optional(),
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
  request.selectionActions?.forEach((action, i) => {
    const selected = request.context && typeof request.context === 'object' && !Array.isArray(request.context) && request.context.reference === 'selection'
    if (!selected || !request.destinations.some(destination => destination.kind === 'update' && JSON.stringify(destination.target) === JSON.stringify(action.target))) {
      ctx.addIssue({ code: 'custom', message: '选区动作必须绑定本次选区中的精确 update target', path: ['selectionActions', i, 'target'] })
    }
    if (action.operation === 'insert-image-after') {
      const scope = action.destination.scope
      if (!request.destinations.some(destination => JSON.stringify(destination) === JSON.stringify(action.destination))
        || scope.insertion.kind !== 'after' || scope.insertion.siblingId !== action.target.itemId
        || scope.ownerKey !== action.target.ownerKey || scope.owner !== action.target.owner
        || scope.surfaceId !== action.target.surfaceId || scope.locationId !== action.target.locationId || scope.stateId !== action.target.stateId
        || !['owner', 'flow-body'].includes(scope.parent.kind)) {
        ctx.addIssue({ code: 'custom', message: '选区插图只允许在原对象同 owner 的精确 after 目标创建', path: ['selectionActions', i, 'destination'] })
      }
    }
  })
})

// New identities are resolved from earlier host results, never guessed by a CLI.
const resultDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created-background'), stepId: identity }).strict(),
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
    destination: z.union([authoringToolDestinationV1Schema, resultDestinationSchema]),
    input: z.json(),
  }).strict()).min(1).max(1000),
}).strict().superRefine((candidate, ctx) => {
  const seen = new Set<string>()
  candidate.steps.forEach((step, i) => {
    if (step.tool === 'media.apply') {
      const parsed = generationMediaApplyInputSchema.safeParse(step.input)
      if (!parsed.success) parsed.error.issues.forEach(issue => ctx.addIssue({ ...issue, path: ['steps', i, 'input', ...issue.path] }))
    }
    if (seen.has(step.id)) ctx.addIssue({ code: 'custom', message: '重复 step ID', path: ['steps', i, 'id'] })
    if ('stepId' in step.destination && !seen.has(step.destination.stepId)) ctx.addIssue({ code: 'custom', message: '只能引用已完成的前序 step', path: ['steps', i, 'destination'] })
    try { visitGenerationInputReferences(step.input, reference => {
      if (!seen.has(reference.stepId)) ctx.addIssue({ code: 'custom', message: '输入只能引用前序宿主结果', path: ['steps', i, 'input'] })
    }) } catch { ctx.addIssue({ code: 'custom', message: '输入结果引用格式无效', path: ['steps', i, 'input'] }) }
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
    input: z.json(),
  }).strict()).min(1).max(1000),
}).strict().superRefine((candidate, ctx) => {
  candidate.steps.forEach((step, i) => {
    if (step.tool !== 'media.apply') return
    const parsed = generationMediaApplyInputSchema.safeParse(step.input)
    if (!parsed.success) parsed.error.issues.forEach(issue => ctx.addIssue({ ...issue, path: ['steps', i, 'input', ...issue.path] }))
  })
})
export type GenerationShortCandidate = z.infer<typeof generationShortCandidateSchema>
export const generationCandidateTransportSchema = z.discriminatedUnion('version', [generationCandidateSchema, generationShortCandidateSchema])

export function generationDestinationAliases(request: Pick<GenerationRequest, 'destinations'>): Record<string, GenerationRequest['destinations'][number]> {
  return Object.fromEntries(request.destinations.map((destination, index) => [`d${index + 1}`, structuredClone(destination)]))
}

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
      let input = expandGenerationAssetReferences(step.input, assetAliases, ['steps', index, 'input'])
      if (step.tool === 'media.apply' && input && typeof input === 'object' && !Array.isArray(input) && typeof Reflect.get(input, 'source') === 'string') {
        input = { ...input, source: { assetId: Reflect.get(input, 'source') } }
      }
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
  recovery: z.object({ action: z.enum(['repair-candidate', 'supply-resource', 'use-open-path', 'refresh-baseline', 'verify-result']), message: z.string().min(1).max(2000) }).strict().optional(),
  behaviorEvidence: authoringToolReceiptV1Schema.shape.behaviorEvidence,
}).strict()
export type GenerationFailure = z.infer<typeof generationFailureSchema>

/** Recovery guidance follows typed producer codes, never guesses permission
 * decisions from prose and never dispatches a second model loop. */
export function generationRecovery(diagnostics: GenerationFailure['diagnostics']): GenerationFailure['recovery'] {
  const codes = new Set(diagnostics.map(diagnostic => diagnostic.code))
  if (codes.has('artifact-baseline-conflict') || codes.has('revision-conflict')) return { action: 'refresh-baseline', message: '保持用户变化；读取当前基线并重建完整结果或快捷组合，不改版本号覆盖已有变化。' }
  if (codes.has('shortcut-not-supported')) return { action: 'use-open-path', message: '此快捷入口未覆盖当前目标；可组合正式基础命令或由原生 CLI 提交 project.document，保留要求的可编辑结构。' }
  if (codes.has('missing-required-resource')) return { action: 'supply-resource', message: '复用已交付素材或补齐真实资源与前序引用，不重复生成有效素材。' }
  if (codes.has('result-mismatch')) return { action: 'verify-result', message: '依据所列具体结果缺项修正；本次候选未提交，不将摘要当作完成证明。' }
  if (['invalid-input', 'operation-target-mismatch', 'operation-parent-mismatch', 'unknown-request-target', 'invalid-result-reference', 'missing-step-result'].some(code => codes.has(code))) return { action: 'repair-candidate', message: '按准确 step/path 修正输入或目标后重交同一任务候选，保留有效资源；无需默认重写完整工程。' }
  return undefined
}

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
