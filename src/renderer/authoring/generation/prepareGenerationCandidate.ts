import { generationCandidateSchema, generationRequestSchema, generationInputReferenceSchema, generationCommitReceiptSchema, GenerationCandidatePreparationError, generationFailureDiagnostics, generationRecovery, type GenerationFailure, type GenerationCandidate, type GenerationRequest, type GenerationCommitReceipt } from '../../../shared/generationContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../../shared/workspaceIdentity'
import { authoringToolDestinationV1Schema, type AuthoringToolDestinationV1, type AuthoringToolReceiptV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { createAuthoringToolFacade } from '../tools/authoringToolFacade'
import { authoringToolCarrier } from '../../../shared/authoringToolCarrier'
import { resolveAuthoringToolScope } from '../tools/authoringToolScope'
import { courseAuthoringScopeFromLocation } from '../courseAuthoringScope'
import { applyEditorTransactionStep, createEditorTransactionStep, type EditorTransactionStep } from '../editorTransaction'
import type { HistoryResourceChanges, HistoryResourceState } from '../../store/courseResourceState'
import { describeGenerationChanges } from './generationPreview'
import { AuthoringToolFailure } from '../tools/executeAuthoringTool'
import { expandGenerationSemanticCandidate } from './expandGenerationSemanticCandidate'
import { captureBackgroundTargets } from '../tools/backgroundTool'
import { captureSelectionReplacementScopes } from '../tools/semanticReplacementTool'

export interface GenerationCommitPort {
  readDocument(): CourseProjectDocument
  readResources(): HistoryResourceState
  readWorkspace(): WorkspaceIdentityV1
  readSessionGeneration(): number
  isRequestCurrent?(request: GenerationRequest): boolean
  commit(step: EditorTransactionStep): boolean
}

function failureDiagnostics(error: unknown): GenerationFailure['diagnostics'] {
  if (error instanceof AuthoringToolFailure && error.diagnostics.length) return error.diagnostics
  const message = error instanceof Error ? error.message : String(error)
  return generationFailureDiagnostics(error, message.startsWith('stale：') ? 'stale' : 'candidate-prepare-failed')
}

function preparationError(error: unknown, context: Omit<GenerationFailure, 'version' | 'diagnostics' | 'behaviorEvidence'>,
  evidence: NonNullable<AuthoringToolReceiptV1['behaviorEvidence']>): GenerationCandidatePreparationError {
  if (error instanceof GenerationCandidatePreparationError) return error
  const failedEvidence = error instanceof AuthoringToolFailure ? error.behaviorEvidence ?? [] : []
  const diagnostics = failureDiagnostics(error)
  return new GenerationCandidatePreparationError({ version: 1, ...context, diagnostics, recovery: generationRecovery(diagnostics),
    ...(evidence.length || failedEvidence.length ? { behaviorEvidence: [...evidence, ...failedEvidence] } : {}) })
}

function current(request: GenerationRequest, port: GenerationCommitPort) {
  return workspaceIdentityKey(port.readWorkspace()) === workspaceIdentityKey(request.workspace)
    && (!request.execution || Date.now() < request.execution.deadlineAt)
    && port.readDocument().id === request.workspace.projectId
    && port.readDocument().revision === request.documentRevision
    && (port.isRequestCurrent ? port.isRequestCurrent(request) : port.readSessionGeneration() === request.sessionGeneration)
}

function destinationFor(step: GenerationCandidate['steps'][number], request: GenerationRequest,
  document: CourseProjectDocument, receipts: Map<string, AuthoringToolReceiptV1>): AuthoringToolDestinationV1 {
  const raw = step.destination
  if (raw.kind === 'create' || raw.kind === 'update') {
    if (!request.destinations.some(allowed => JSON.stringify(allowed) === JSON.stringify(raw))) throw new AuthoringToolFailure([{ code: 'unknown-request-target', path: ['destination'], message: '目标与本轮快照身份不匹配；请使用 request.json 当前目标别名，新建对象使用前序结果引用。选中对象不限制其他对象的修改。' }])
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
  if (raw.kind === 'created-background') {
    // A created item on an existing page is not evidence that a page was created.
    if (!created.some(effect => effect.id === hint.locationId || effect.id === scope.sceneId || effect.id === surface.id)) throw new Error('前序回执没有创建页面或 Surface，不能派生页面背景目标')
    return { kind: 'update', target: captureBackgroundTargets({ document, sessionToken: { locationId: hint.locationId, surfaceType: surface.type,
      revision: document.revision, generation: request.sessionGeneration }, stateId: null, reference: 'page' })[0]!.target }
  }
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

function resolveInput(value: unknown, receipts: Map<string, AuthoringToolReceiptV1>, path: string[] = ['input']): unknown {
  if (!value || typeof value !== 'object') return value
  if ('$result' in value) {
    const reference = generationInputReferenceSchema.parse(value).$result
    const receipt = receipts.get(reference.stepId)
    if (!receipt) throw new AuthoringToolFailure([{ code: 'missing-step-result', path, message: '输入引用没有前序宿主回执' }])
    const values = reference.kind === 'asset-id' ? receipt.resources.assetIds
      : reference.kind === 'package-id' ? receipt.resources.packageIds
      : reference.kind === 'location-id' ? receipt.selection ? [receipt.selection.locationId] : []
      : receipt.affected.filter(effect => effect.operation === 'created' && receipt.selection?.itemIds.includes(effect.id)).map(effect => effect.id)
    const result = values[reference.index]
    if (!result) throw new AuthoringToolFailure([{ code: 'invalid-result-reference', path, message: `前序宿主回执没有 ${reference.kind}[${reference.index}]；引用类别和索引必须匹配该步实际结果。` }])
    return result
  }
  return Array.isArray(value) ? value.map((entry, index) => resolveInput(entry, receipts, [...path, String(index)]))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveInput(entry, receipts, [...path, key])]))
}

/** Replacement lineage is checked independently of the UI focus. */
function replacementDependencies(candidate: GenerationCandidate) {
  const replacements = new Map<string, { stepId: string; index: number }>()
  for (const [index, step] of candidate.steps.entries()) if (step.tool === 'selection.replace') {
    if (step.destination.kind !== 'update' && step.destination.kind !== 'created-item') throw new Error('替换需要精确对象 update 或前序 created-item 目标')
    const reference = generationInputReferenceSchema.safeParse(step.input && typeof step.input === 'object' && !Array.isArray(step.input) ? step.input.replacementItemId : null)
    if (!reference.success || reference.data.$result.kind !== 'item-id') throw new Error('replacementItemId 必须引用前序创建回执的 item-id，不能提供既有对象 ID')
    const result = reference.data.$result
    const source = candidate.steps.findIndex(entry => entry.id === result.stepId)
    if (source < 0 || source >= index) throw new Error('替换对象必须先创建')
    replacements.set(step.id, { stepId: result.stepId, index: result.index })
  }
  return replacements
}

/** Private candidate planning uses the existing product facade; the live document is never a scratchpad. */
export function createGenerationCandidateCoordinator(port: GenerationCommitPort) {
  const prepared = new Map<string, { request: GenerationRequest; step: EditorTransactionStep | null; receipt: GenerationCommitReceipt }>()
  let epoch = 0
  let controller: AbortController | undefined
  return Object.freeze({
    discard() { epoch++; controller?.abort(); prepared.clear() },
    async prepare(rawRequest: unknown, rawCandidate: unknown) {
      const failureContext: Omit<GenerationFailure, 'version' | 'diagnostics' | 'behaviorEvidence'> = { stage: 'candidate-parse', assetIds: [], packageIds: [] }
      const acquiredEvidence: NonNullable<AuthoringToolReceiptV1['behaviorEvidence']> = []
      try {
      const request = generationRequestSchema.parse(rawRequest)
      failureContext.requestId = request.requestId
      const candidate = generationCandidateSchema.parse(rawCandidate)
      failureContext.candidateId = candidate.candidateId
      failureContext.stage = 'prepare'
      if ((request.intent ?? 'edit') !== 'edit') throw new Error('讨论或规划意图仅允许只读答复，不能准备工程写入')
      if (candidate.requestId !== request.requestId) throw new Error('候选不属于当前请求')
      if (!current(request, port)) throw new Error('stale：工程或会话已改变')
      const token = ++epoch
      controller?.abort()
      const abort = controller = new AbortController()
      prepared.clear()
      const initial = structuredClone(port.readDocument())
      const initialResources = structuredClone(port.readResources())
      const replacementPlan = replacementDependencies(candidate)
      let state = { document: initial, resources: initialResources }
      const plans: EditorTransactionStep[] = []
      const receipts = new Map<string, AuthoringToolReceiptV1>()
      const semanticResources = new Map<string, AuthoringToolReceiptV1['resources']>()
      const semanticCreated = new Map<string, Set<string>>()
      const facade = createAuthoringToolFacade({
        signal: abort.signal,
        readDocument: () => state.document, readResources: () => state.resources,
        validateDestination(destination) {
          try { resolveAuthoringToolScope(state.document, destination); return null }
          catch (error) { return { code: 'invalid-target', message: String(error), path: ['destination'] } }
        },
        commit(step) { state = applyEditorTransactionStep(state, step, 'forward'); plans.push(step); return true },
      })
      const queue = candidate.steps.map(item => ({ item, expanded: false, sourceId: item.id }))
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const { item, expanded, sourceId } = queue[cursor]!
        failureContext.stepId = item.id; failureContext.tool = item.tool; failureContext.destination = item.destination
        if (token !== epoch || !current(request, port)) throw new Error('stale：候选运行已取消或工程已改变')
        if (!request.allowedCarriers.includes(item.carrier)) throw new Error('请求未允许此载体')
        const actualCarrier = authoringToolCarrier(item.tool, item.input)
        if (item.carrier !== actualCarrier) throw new Error(`${item.id}: ${item.tool} 要求carrier=${actualCarrier}，声明载体与实际工具不一致`)
        if ((actualCarrier === 'generated-component' || actualCarrier === 'runtime') && (typeof window === 'undefined' || !window.desktopAPI?.dynamicAdmission)) throw new Error('自动动态候选需要桌面独立进程准入')
        const replacement = replacementPlan.get(item.id)
        const rebase = (raw: AuthoringToolDestinationV1) => {
          const next = structuredClone(raw)
          ;(next.kind === 'update' ? next.target : next.scope).documentRevision = state.document.revision
          return next
        }
        const destination = expanded && (item.destination.kind === 'create' || item.destination.kind === 'update')
          ? rebase(item.destination) : destinationFor(item, request, state.document, receipts)
        const input = resolveInput(item.input, receipts)
        if (replacement) {
          const created = receipts.get(replacement.stepId)?.affected.filter(effect => effect.operation === 'created')[replacement.index]
          if (!created?.authoringAddress || destination.kind !== 'update' || created.ownerKey !== destination.target.ownerKey) throw new Error('替换创建回执不属于原对象 owner')
        }
        failureContext.destination = destination
        if (item.tool === 'media.apply') {
          // Validate and resolve the public target first. Expansion sees only
          // current private state and canonical scopes derived from that target.
          const destinations = request.destinations.map(rebase)
          destinations.push(destination)
          const { target, surface } = resolveAuthoringToolScope(state.document, destination)
          const resourceScope = courseAuthoringScopeFromLocation({ project: state.document, locationId: target.locationId, stateId: null, owner: 'global' })
          const { itemId: _item, authoringAddress: _address, ...resourceTarget } = target as typeof target & { itemId?: string; authoringAddress?: string }
          destinations.push(authoringToolDestinationV1Schema.parse({ kind: 'create', scope: { ...resourceTarget,
            surfaceId: surface.id, owner: 'global', ownerKey: resourceScope.ownerKey, stateId: null,
            parent: { kind: 'owner' }, insertion: { kind: 'append' } } }))
          if (destination.kind === 'update' && !(input && typeof input === 'object' && Reflect.get(input, 'placement') === 'background')) {
            destinations.push(...captureSelectionReplacementScopes(state.document, [destination.target]))
          }
          const effectiveRequest = { ...request, destinations, selectionActions: request.selectionActions?.map(action => ({ ...action,
            target: { ...action.target, documentRevision: state.document.revision },
            ...('destination' in action ? { destination: rebase(action.destination) } : {}) })) } as GenerationRequest
          const expansion = await expandGenerationSemanticCandidate({ ...candidate, steps: [{ ...item, destination, input: input as typeof item.input }] },
            effectiveRequest, state.document, state.resources.assetFiles, () => token === epoch && current(request, port), new Set(queue.map(entry => entry.item.id)))
          for (const [id, dependency] of replacementDependencies(expansion)) replacementPlan.set(id, dependency)
          queue.splice(cursor, 1, ...expansion.steps.map(item => ({ item, expanded: true, sourceId })))
          cursor--; continue
        }
        failureContext.stepId = sourceId
        const collectResourceIds = (value: unknown): void => {
          if (!value || typeof value !== 'object') return
          for (const [key, nested] of Object.entries(value)) {
            if (typeof nested === 'string' && (key === 'assetId' || key === 'staticFallbackAssetId') && !failureContext.assetIds.includes(nested)) failureContext.assetIds.push(nested)
            if (typeof nested === 'string' && key === 'packageId' && !failureContext.packageIds.includes(nested)) failureContext.packageIds.push(nested)
            collectResourceIds(nested)
          }
        }
        collectResourceIds(input)
        const receipt = await facade.execute({ version: 1, requestId: `${candidate.candidateId}:${item.id}`, tool: item.tool, destination, input })
        failureContext.assetIds = [...new Set([...failureContext.assetIds, ...receipt.resources.assetIds])]
        failureContext.packageIds = [...new Set([...failureContext.packageIds, ...receipt.resources.packageIds])]
        acquiredEvidence.push(...receipt.behaviorEvidence ?? [])
        if (abort.signal.aborted || token !== epoch || receipt.status === 'stale' || !current(request, port)) throw new Error('stale：候选运行已取消或工程已改变')
        if (receipt.status !== 'committed' && receipt.status !== 'unchanged') {
          if (receipt.diagnostics.some(value => value.code.startsWith('dynamic-'))) failureContext.stage = 'dynamic-admission'
          throw new AuthoringToolFailure(receipt.diagnostics.length ? receipt.diagnostics : [{ code: `tool-${receipt.status}`, message: `工具 ${item.tool} 未成功完成`, path: [] }])
        }
        if (expanded) {
          const prior = semanticResources.get(sourceId) ?? { assetIds: [], packageIds: [] }
          const resources = { assetIds: [...new Set([...prior.assetIds, ...receipt.resources.assetIds])], packageIds: [...new Set([...prior.packageIds, ...receipt.resources.packageIds])] }
          semanticResources.set(sourceId, resources)
          const created = semanticCreated.get(sourceId) ?? new Set<string>()
          for (const effect of receipt.affected) if (effect.operation === 'created' && receipt.selection?.itemIds.includes(effect.id)) created.add(effect.id)
          semanticCreated.set(sourceId, created)
          receipts.set(item.id, item.id === sourceId ? { ...receipt, resources,
            affected: receipt.affected.map(effect => created.has(effect.id) && effect.operation === 'updated' ? { ...effect, operation: 'created' } : effect) } : receipt)
        } else receipts.set(item.id, receipt)
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
      } catch (error) { throw preparationError(error, failureContext, acquiredEvidence) }
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
