import { generationCandidateSchema, generationRequestSchema, generationInputReferenceSchema, generationCommitReceiptSchema, type GenerationCandidate, type GenerationRequest, type GenerationCommitReceipt } from '../../../shared/generationContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../../shared/workspaceIdentity'
import { authoringToolDestinationV1Schema, type AuthoringToolDestinationV1, type AuthoringToolReceiptV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { createAuthoringToolFacade } from '../tools/authoringToolFacade'
import { authoringToolCarrier } from '../tools/authoringToolCarrier'
import { resolveAuthoringToolScope } from '../tools/authoringToolScope'
import { courseAuthoringScopeFromLocation } from '../courseAuthoringScope'
import { applyEditorTransactionStep, createEditorTransactionStep, type EditorTransactionStep } from '../editorTransaction'
import type { HistoryResourceChanges, HistoryResourceState } from '../../store/courseResourceState'
import { describeGenerationChanges } from './generationPreview'
import { captureSelectionReplacementScopes } from '../tools/semanticReplacementTool'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'

export interface GenerationCommitPort {
  readDocument(): CourseProjectDocument
  readResources(): HistoryResourceState
  readWorkspace(): WorkspaceIdentityV1
  readSessionGeneration(): number
  commit(step: EditorTransactionStep): boolean
}

function current(request: GenerationRequest, port: GenerationCommitPort) {
  return workspaceIdentityKey(port.readWorkspace()) === workspaceIdentityKey(request.workspace)
    && port.readDocument().id === request.workspace.projectId
    && port.readDocument().revision === request.documentRevision
    && port.readSessionGeneration() === request.sessionGeneration
}

function destinationFor(step: GenerationCandidate['steps'][number], request: GenerationRequest,
  document: CourseProjectDocument, receipts: Map<string, AuthoringToolReceiptV1>): AuthoringToolDestinationV1 {
  const raw = step.destination
  if (raw.kind === 'create' || raw.kind === 'update') {
    if (!request.destinations.some(allowed => JSON.stringify(allowed) === JSON.stringify(raw))) throw new Error('候选目标不在本次请求范围内')
    const destination = structuredClone(raw)
    const target = destination.kind === 'update' ? destination.target : destination.scope
    // Only the private planning document advances. The live revision is checked separately.
    target.documentRevision = document.revision
    return destination
  }
  const receipt = receipts.get(raw.stepId)
  const created = receipt?.affected.filter(effect => effect.operation === 'created') ?? []
  if (!receipt?.selection || !created.length) throw new Error('前序 step 没有创建可引用对象或位置')
  const hint = receipt.selection
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId: hint.locationId, stateId: hint.stateId, owner: hint.owner })
  const surface = document.surfaces.find(value => value.id === scope.surfaceId)!
  const wire = { projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' as const },
    sessionGeneration: request.sessionGeneration, surfaceType: surface.type, surfaceId: surface.id,
    locationId: hint.locationId, stateId: hint.stateId, owner: hint.owner, ownerKey: scope.ownerKey }
  if (raw.kind === 'created-scope') return authoringToolDestinationV1Schema.parse({ kind: 'create', scope: { ...wire, parent: raw.parent, insertion: raw.insertion } })
  const item = created[raw.index]
  if (!item?.authoringAddress || item.ownerKey !== wire.ownerKey) throw new Error('创建结果没有匹配的可编辑目标')
  return authoringToolDestinationV1Schema.parse({ kind: 'update', target: { ...wire, itemId: item.id, authoringAddress: item.authoringAddress } })
}

function foldResources(steps: readonly EditorTransactionStep[]): HistoryResourceChanges {
  const assets = new Map<string, NonNullable<HistoryResourceChanges['assetFileChanges']>[number]>()
  const packages = new Map<string, NonNullable<HistoryResourceChanges['componentPackageChanges']>[number]>()
  for (const step of steps) {
    for (const change of step.resourceChanges.assetFileChanges ?? []) {
      const prior = assets.get(change.assetId)
      assets.set(change.assetId, { assetId: change.assetId, before: prior ? prior.before : change.before, after: change.after })
    }
    for (const change of step.resourceChanges.componentPackageChanges ?? []) {
      const prior = packages.get(change.packageId)
      packages.set(change.packageId, { packageId: change.packageId, before: prior ? prior.before : change.before, after: change.after })
    }
  }
  return { assetFileChanges: [...assets.values()], componentPackageChanges: [...packages.values()] }
}

function resolveInput(value: unknown, receipts: Map<string, AuthoringToolReceiptV1>): unknown {
  if (!value || typeof value !== 'object') return value
  if ('$result' in value) {
    const reference = generationInputReferenceSchema.parse(value).$result
    const receipt = receipts.get(reference.stepId)
    if (!receipt) throw new Error('输入引用没有前序宿主回执')
    const values = reference.kind === 'asset-id' ? receipt.resources.assetIds
      : reference.kind === 'package-id' ? receipt.resources.packageIds
      : reference.kind === 'location-id' ? receipt.selection ? [receipt.selection.locationId] : []
      : receipt.affected.filter(effect => effect.operation === 'created').map(effect => effect.id)
    const result = values[reference.index]
    if (!result) throw new Error(`前序宿主回执没有 ${reference.kind}[${reference.index}]`)
    return result
  }
  return Array.isArray(value) ? value.map(entry => resolveInput(entry, receipts))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveInput(entry, receipts)]))
}

function selectionDependencies(candidate: GenerationCandidate, request: GenerationRequest, document: CourseProjectDocument) {
  const byId = new Map(candidate.steps.map(step => [step.id, step]))
  const selectionOnly = typeof request.context === 'object' && request.context !== null && !Array.isArray(request.context) && request.context.reference === 'selection'
  const dependencies = new Set<string>()
  const replacements = new Map<string, { stepId: string; index: number }>()
  const visit = (id: string) => {
    if (dependencies.has(id)) return
    const step = byId.get(id)
    if (!step) throw new Error('替换依赖步骤不存在')
    dependencies.add(id)
    const scan = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if ('$result' in value) { visit(generationInputReferenceSchema.parse(value).$result.stepId); return }
      Object.values(value).forEach(scan)
    }
    scan(step.input)
    if (step.destination.kind === 'created-item' || step.destination.kind === 'created-scope') visit(step.destination.stepId)
  }
  for (const step of candidate.steps) if (step.tool === 'selection.replace') {
    if (step.destination.kind !== 'update') throw new Error('替换目标必须是原请求的精确选中对象')
    const reference = generationInputReferenceSchema.safeParse(step.input && typeof step.input === 'object' && !Array.isArray(step.input) ? step.input.replacementItemId : null)
    if (!reference.success || reference.data.$result.kind !== 'item-id') throw new Error('replacementItemId 必须引用前序创建回执的 item-id，不能提供既有对象 ID')
    const result = reference.data.$result
    if (candidate.steps.findIndex(entry => entry.id === result.stepId) >= candidate.steps.indexOf(step)) throw new Error('替换对象必须先创建')
    replacements.set(step.id, { stepId: result.stepId, index: result.index })
    visit(step.id)
  }
  // A selected Runtime can consume one imported fallback without replacing the
  // Runtime itself. Admit only this exact, preceding resource dependency; do
  // not grant the import's arbitrary transitive references creation authority.
  for (const [index, step] of candidate.steps.entries()) if (selectionOnly && step.tool === 'runtime.source') {
    const fallback = step.input && typeof step.input === 'object' && !Array.isArray(step.input)
      ? step.input.staticFallback : undefined
    const assetId = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
      ? (fallback as Record<string, unknown>).assetId : undefined
    if (!assetId || typeof assetId !== 'object' || !('$result' in assetId)) continue
    const reference = generationInputReferenceSchema.parse(assetId).$result
    const imported = byId.get(reference.stepId)
    if (reference.kind !== 'asset-id' || reference.index !== 0 || !imported || imported.tool !== 'asset.media.import'
      || imported.destination.kind !== 'create' || candidate.steps.indexOf(imported) >= index) {
      throw new Error('Runtime 后备图片必须引用前序 asset.media.import 的 asset-id[0] 回执')
    }
    dependencies.add(imported.id)
  }
  if (selectionOnly) {
    const targets = request.destinations.flatMap(destination => destination.kind === 'update' ? [destination.target] : [])
    const scopes = captureSelectionReplacementScopes(document, targets)
    for (const step of candidate.steps) {
      if (step.destination.kind === 'created-scope') throw new Error('选中对象替换只允许附带的精确创建 scope')
      if (step.destination.kind !== 'create') continue
      if (!dependencies.has(step.id) || !scopes.some(scope => JSON.stringify(scope) === JSON.stringify(step.destination))) throw new Error('选中对象的附带创建 scope 仅可用于完整替换依赖或 Runtime 后备资源更新')
      if (['slide.structure', 'course.navigation'].includes(step.tool) || step.destination.scope.parent.kind === 'course-locations') throw new Error('选中对象替换不得创建课程位置')
    }
  }
  return { replacements, selectionOnly }
}

/** Private candidate planning uses the existing product facade; the live document is never a scratchpad. */
export function createGenerationCandidateCoordinator(port: GenerationCommitPort) {
  const prepared = new Map<string, { request: GenerationRequest; step: EditorTransactionStep | null; receipt: GenerationCommitReceipt }>()
  let epoch = 0
  let controller: AbortController | undefined
  return Object.freeze({
    discard() { epoch++; controller?.abort(); prepared.clear() },
    async prepare(rawRequest: unknown, rawCandidate: unknown) {
      const request = generationRequestSchema.parse(rawRequest)
      const candidate = generationCandidateSchema.parse(rawCandidate)
      if ((request.intent ?? 'edit') !== 'edit') throw new Error('讨论或规划意图仅允许只读答复，不能准备工程写入')
      if (candidate.requestId !== request.requestId) throw new Error('候选不属于当前请求')
      if (!current(request, port)) throw new Error('stale：工程或会话已改变')
      const token = ++epoch
      controller?.abort()
      const abort = controller = new AbortController()
      prepared.clear()
      const initial = structuredClone(port.readDocument())
      const replacementPlan = selectionDependencies(candidate, request, initial)
      let state = { document: initial, resources: structuredClone(port.readResources()) }
      const plans: EditorTransactionStep[] = []
      const receipts = new Map<string, AuthoringToolReceiptV1>()
      const facade = createAuthoringToolFacade({
        signal: abort.signal,
        readDocument: () => state.document, readResources: () => state.resources,
        validateDestination(destination) {
          try { resolveAuthoringToolScope(state.document, destination); return null }
          catch (error) { return { code: 'invalid-target', message: String(error), path: ['destination'] } }
        },
        commit(step) { state = applyEditorTransactionStep(state, step, 'forward'); plans.push(step); return true },
      })
      for (const item of candidate.steps) {
        if (token !== epoch || !current(request, port)) throw new Error('stale：候选运行已取消或工程已改变')
        if (!request.allowedCarriers.includes(item.carrier)) throw new Error('请求未允许此载体')
        const actualCarrier = authoringToolCarrier(item.tool, item.input)
        if (item.carrier !== actualCarrier) throw new Error(`${item.id}: ${item.tool} 要求carrier=${actualCarrier}，声明载体与实际工具不一致`)
        if ((actualCarrier === 'generated-component' || actualCarrier === 'runtime') && (typeof window === 'undefined' || !window.desktopAPI?.dynamicAdmission)) throw new Error('自动动态候选需要桌面独立进程准入')
        const replacement = replacementPlan.replacements.get(item.id)
        if (replacement) {
          const created = receipts.get(replacement.stepId)?.affected.filter(effect => effect.operation === 'created')[replacement.index]
          if (!created?.authoringAddress || item.destination.kind !== 'update' || created.ownerKey !== item.destination.target.ownerKey) throw new Error('替换创建回执不属于原对象 owner')
        }
        const receipt = await facade.execute({ version: 1, requestId: `${candidate.candidateId}:${item.id}`, tool: item.tool,
          destination: destinationFor(item, request, state.document, receipts), input: resolveInput(item.input, receipts) })
        if (abort.signal.aborted || token !== epoch || receipt.status === 'stale' || !current(request, port)) throw new Error('stale：候选运行已取消或工程已改变')
        if (receipt.status !== 'committed' && receipt.status !== 'unchanged') throw new AuthoringToolFailure(receipt.diagnostics.map(value => ({ ...value, message: `${item.id}: ${value.message}` })), receipt.behaviorEvidence)
        receipts.set(item.id, receipt)
      }
      if (replacementPlan.selectionOnly) {
        const replacedIds = new Set([...replacementPlan.replacements.values()].map(reference => receipts.get(reference.stepId)?.affected.filter(effect => effect.operation === 'created')[reference.index]?.id))
        for (const item of candidate.steps) if (item.destination.kind === 'create') {
          const receipt = receipts.get(item.id)!
          const resourceIds = new Set([...receipt.resources.assetIds, ...receipt.resources.packageIds])
          if (receipt.affected.some(effect => effect.operation === 'created' && !resourceIds.has(effect.id) && !replacedIds.has(effect.id))) throw new Error('选中对象替换不能附带未被消费的新对象')
        }
      }
      if (token !== epoch || !current(request, port)) throw new Error('stale：候选已过期')
      const step = plans.length ? createEditorTransactionStep(initial, {
        projectId: initial.id, baseRevision: initial.revision, nextDocument: { ...state.document, revision: initial.revision + 1 },
        resourceChanges: foldResources(plans), selectionHint: plans.at(-1)?.selectionHint,
      }) : null
      const previewId = crypto.randomUUID()
      // Validate metadata before the live commit, but publish no receipt until that commit succeeds.
      const receipt = generationCommitReceiptSchema.parse({ version: 1, requestId: request.requestId, candidateId: candidate.candidateId,
        workspace: request.workspace, status: step ? 'committed' : 'unchanged', beforeRevision: initial.revision, afterRevision: step?.nextDocument.revision ?? initial.revision,
        affected: step ? [...receipts.values()].flatMap(value => value.affected) : [],
        resources: { assetIds: step ? [...new Set([...receipts.values()].flatMap(value => value.resources.assetIds))] : [],
          packageIds: step ? [...new Set([...receipts.values()].flatMap(value => value.resources.packageIds))] : [] } })
      prepared.set(previewId, { request, step, receipt })
      return structuredClone({ previewId, candidateId: candidate.candidateId, summary: candidate.summary,
        beforeRevision: initial.revision, afterRevision: step?.nextDocument.revision ?? initial.revision,
        // These are preparation results, not successful live-project commit receipts.
        plannedEffects: [...receipts.values()].flatMap(value => value.affected),
        behaviorEvidence: [...receipts.values()].flatMap(value => value.behaviorEvidence ?? []),
        ...describeGenerationChanges(initial, step?.nextDocument ?? initial),
        document: step?.nextDocument ?? initial, resources: state.resources })
    },
    apply(previewId: string) {
      const entry = prepared.get(previewId)
      prepared.delete(previewId)
      if (!entry || !current(entry.request, port)) return { status: 'stale' as const }
      if (!entry.step) return { status: 'unchanged' as const, receipt: structuredClone(entry.receipt) }
      return port.commit(entry.step) ? { status: 'committed' as const, beforeRevision: entry.step.baseRevision, afterRevision: entry.step.nextDocument.revision, receipt: structuredClone(entry.receipt) }
        : { status: 'stale' as const }
    },
  })
}
