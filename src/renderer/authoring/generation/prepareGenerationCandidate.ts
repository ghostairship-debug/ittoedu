import { generationCandidateSchema, generationRequestSchema, generationInputReferenceSchema, type GenerationCandidate, type GenerationRequest } from '../../../shared/generationContract'
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

/** Private candidate planning uses the existing product facade; the live document is never a scratchpad. */
export function createGenerationCandidateCoordinator(port: GenerationCommitPort) {
  const prepared = new Map<string, { request: GenerationRequest; step: EditorTransactionStep | null }>()
  let epoch = 0
  let controller: AbortController | undefined
  return Object.freeze({
    discard() { epoch++; controller?.abort(); prepared.clear() },
    async prepare(rawRequest: unknown, rawCandidate: unknown) {
      const request = generationRequestSchema.parse(rawRequest)
      const candidate = generationCandidateSchema.parse(rawCandidate)
      if (candidate.requestId !== request.requestId) throw new Error('候选不属于当前请求')
      if (!current(request, port)) throw new Error('stale：工程或会话已改变')
      const token = ++epoch
      controller?.abort()
      const abort = controller = new AbortController()
      prepared.clear()
      const initial = structuredClone(port.readDocument())
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
        const receipt = await facade.execute({ version: 1, requestId: `${candidate.candidateId}:${item.id}`, tool: item.tool,
          destination: destinationFor(item, request, state.document, receipts), input: resolveInput(item.input, receipts) })
        if (abort.signal.aborted || token !== epoch || receipt.status === 'stale' || !current(request, port)) throw new Error('stale：候选运行已取消或工程已改变')
        if (receipt.status !== 'committed' && receipt.status !== 'unchanged') throw new Error(`${item.id}: ${receipt.diagnostics.map(value => value.message).join('; ')}`)
        receipts.set(item.id, receipt)
      }
      if (token !== epoch || !current(request, port)) throw new Error('stale：候选已过期')
      const step = plans.length ? createEditorTransactionStep(initial, {
        projectId: initial.id, baseRevision: initial.revision, nextDocument: { ...state.document, revision: initial.revision + 1 },
        resourceChanges: foldResources(plans), selectionHint: plans.at(-1)?.selectionHint,
      }) : null
      const previewId = crypto.randomUUID()
      prepared.set(previewId, { request, step })
      return structuredClone({ previewId, candidateId: candidate.candidateId, summary: candidate.summary,
        beforeRevision: initial.revision, afterRevision: step?.nextDocument.revision ?? initial.revision,
        // These are preparation results, not successful live-project commit receipts.
        plannedEffects: [...receipts.values()].flatMap(value => value.affected),
        ...describeGenerationChanges(initial, step?.nextDocument ?? initial),
        document: step?.nextDocument ?? initial, resources: state.resources })
    },
    apply(previewId: string) {
      const entry = prepared.get(previewId)
      prepared.delete(previewId)
      if (!entry || !current(entry.request, port)) return { status: 'stale' as const }
      if (!entry.step) return { status: 'unchanged' as const }
      return port.commit(entry.step) ? { status: 'committed' as const, beforeRevision: entry.step.baseRevision, afterRevision: entry.step.nextDocument.revision }
        : { status: 'stale' as const }
    },
  })
}
