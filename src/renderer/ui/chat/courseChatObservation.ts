import type { GenerationCommitReceipt, GenerationRequest } from '../../../shared/generationContract'
import { generationRequestSchema, DEFAULT_GENERATION_TASK_DURATION_MS, MAX_GENERATION_TASK_DURATION_MS } from '../../../shared/generationContract'
import { z } from 'zod'
import type { DesktopAPI } from '../../../shared/ipcTypes'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { attachGenerationBehaviorEvidence } from '../../authoring/generation/generationBehaviorResources'
import { authoringObservationDraftToken, createAuthoringObservationController, readAuthoringObservationDraftState } from '../../authoring/generation/authoringObservation'
import { captureGenerationSnapshot } from '../../authoring/generation/generationSnapshot'
import type { CourseAuthoringSessionToken } from '../../authoring/courseAuthoringSession'
import type { CourseAuthoringOwner } from '../../authoring/courseAuthoringScope'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import { createGenerationImageSourceInspector } from '../../authoring/generation/generationImageDiagnostics'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { selectActiveCourseProjectDocument, selectEffectiveLayerProjection, selectMediaAssetFiles, useEditorStore } from '../../store/editorStore'

type SnapshotInput = Parameters<typeof captureGenerationSnapshot>[0]
type Execution = NonNullable<GenerationRequest['execution']>
// Editor selection lives in the local observation, not in the course file.
// Validate historical JSON before restoring its narrower text/table reference.
const recoveryFlowSelection = z.object({
  locationId: z.string(), surfaceId: z.string(), authoringScope: z.enum(['page', 'global']), focus: z.enum(['idle', 'text', 'block', 'overlay']),
  selectedBlockId: z.string().nullable(), selectedBlockIds: z.array(z.string()), selectedOverlayIds: z.array(z.string()), authoringAddress: z.string(),
  textRange: z.object({ blockId: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
    listItemId: z.string().optional(), tableRowId: z.string().optional(), tableColumnId: z.string().optional() }).strict().nullable(),
}).strict()
function recoverySelectedIds(request: GenerationRequest, locationId: string): string[] {
  const context = request.context as Record<string, unknown>
  if (!Array.isArray(context.pages)) return []
  const selectedAddresses = new Set(context.pages.flatMap(page => {
    if (!page || typeof page !== 'object' || Array.isArray(page)) return []
    const value = page as Record<string, unknown>
    return [value.items, value.blocks].flatMap(rows => Array.isArray(rows) ? rows.flatMap(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return []
      const value = row as Record<string, unknown>
      return value.selected === true && typeof value.target === 'string' ? [value.target] : []
    }) : [])
  }))
  // Package/source dependencies also have update destinations. Only the
  // snapshot's selected editable rows are the user's selection.
  return request.destinations.flatMap(value => value.kind === 'update' && value.target.locationId === locationId
    && selectedAddresses.has(value.target.authoringAddress) ? [value.target.itemId] : [])
}
export interface CourseChatTarget {
  readonly anchorId: string
  readonly locationId: string
  readonly surfaceId: string
  readonly stateId: string | null
  readonly selectedIds: readonly string[]
  readonly sessionToken: CourseAuthoringSessionToken
  readonly owner?: CourseAuthoringOwner
  readonly flowSelection?: FlowEditorSelection
}
const stopped = () => new Error('stale：任务已停止或重新开始')
const expired = () => new Error('本次设置的执行预算已到，请重新发送以继续；准备结果已丢弃')
function executionBudget(execution?: Execution): Execution {
  const startedAt = execution?.startedAt ?? Date.now()
  return { version: 1, startedAt, deadlineAt: Math.min(execution?.deadlineAt ?? startedAt + DEFAULT_GENERATION_TASK_DURATION_MS, startedAt + MAX_GENERATION_TASK_DURATION_MS) }
}

/** Initial preparation and observation share the task's absolute deadline. */
export async function awaitCourseChatStage<T>(operation: () => Promise<T>, execution: Execution, signal: AbortSignal): Promise<T> {
  const deadlineAt = Math.min(execution.deadlineAt, execution.startedAt + MAX_GENERATION_TASK_DURATION_MS)
  const requireActive = () => {
    if (signal.aborted) throw stopped()
    if (Date.now() >= deadlineAt) throw expired()
  }
  requireActive()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const interrupted = new Promise<never>((_, reject) => {
      onAbort = () => reject(stopped())
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      timer = setTimeout(() => reject(expired()), Math.max(0, deadlineAt - Date.now()))
    })
    const value = await Promise.race([Promise.resolve().then(() => { requireActive(); return operation() }), interrupted])
    requireActive()
    return value
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

export function createCourseChatObservation(api: DesktopAPI, owner: { projectId: string; projectPath: string }) {
  const inspectImageSources = createGenerationImageSourceInspector()
  let disposed = false
  let captureEpoch = 0
  let pendingCapture: AbortController | undefined
  let observingAnchor: Anchor | undefined
  let observingSelection: readonly string[] | undefined
  let preparingInitialDraft = false
  const anchors = new Map<string, Anchor>()
  const requests = new Map<string, Anchor>()
  function snapshot() {
    const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
    if (!document || !state.courseAuthoringSession || state.projectPath !== owner.projectPath || document.id !== owner.projectId) {
      throw new Error('stale：工程已关闭、切换或另存为，请重新观察')
    }
    return { document, revision: document.revision, assetFiles: selectMediaAssetFiles(state), componentPackages: state.componentPackages,
      draft: JSON.stringify([authoringObservationDraftToken(state.v9ContentEdit), authoringObservationDraftToken(state.flowTextEdit), authoringObservationDraftToken(state.flowDocumentDraft),
        authoringObservationDraftToken(state.spatialContentEdit), authoringObservationDraftToken(state.previewBackgroundColor),
        readAuthoringObservationDraftState()]) }
  }
  type Anchor = ReturnType<typeof snapshot> & { target: CourseChatTarget; invalidReason?: string; requestId?: string; receipt?: GenerationCommitReceipt; input?: Input }
  function anchorReason(anchor: Anchor): string | null {
    if (anchor.invalidReason) return anchor.invalidReason
    let current: ReturnType<typeof snapshot>
    try { current = snapshot() } catch (error) { return anchor.invalidReason = error instanceof Error ? error.message : String(error) }
    if (current.document !== anchor.document || current.revision !== anchor.revision) return anchor.invalidReason = 'stale：课件内容已改变，未应用候选已丢弃；请重新观察后继续'
    if (current.assetFiles !== anchor.assetFiles || current.componentPackages !== anchor.componentPackages) return anchor.invalidReason = 'stale：课件资源已改变，未应用候选已丢弃；请重新观察后继续'
    if (current.draft !== anchor.draft) return anchor.invalidReason = 'stale：教师正在编辑文字、公式、图表或颜色，旧候选已丢弃；当前草稿已保留'
    if (!current.document.locations.some(location => location.id === anchor.target.locationId)) return anchor.invalidReason = 'stale：原任务目标已不存在，请重新观察'
    return null
  }
  const unsubscribe = useEditorStore.subscribe(() => {
    if (preparingInitialDraft) return
    for (const anchor of anchors.values()) {
      if (anchor.requestId && useEditorStore.getState().isGenerationTaskCommitting(anchor.requestId)) continue
      anchorReason(anchor)
    }
  })
  function cancelCapture() {
    captureEpoch++
    pendingCapture?.abort()
    pendingCapture = undefined
  }
  function invalidate() {
    cancelCapture()
    for (const anchor of anchors.values()) anchor.invalidReason = 'stale：任务已停止或重新开始'
    for (const requestId of requests.keys()) useEditorStore.getState().releaseGenerationTaskRequest(requestId)
  }
  function beginCapture(anchor: Anchor, execution?: Execution) {
    if (disposed) throw stopped()
    cancelCapture()
    observingAnchor = anchor
    observingSelection = anchor.target.selectedIds
    const epoch = captureEpoch, abort = new AbortController(), budget = executionBudget(execution)
    pendingCapture = abort
    const requireCurrent = () => {
      if (disposed || epoch !== captureEpoch || abort.signal.aborted) throw stopped()
      if (Date.now() >= budget.deadlineAt) throw expired()
      const reason = anchorReason(anchor)
      if (reason) throw new Error(reason)
    }
    return {
      execution: budget,
      requireCurrent,
      async stage<T>(operation: () => Promise<T>) {
        requireCurrent()
        let timer: ReturnType<typeof setInterval> | undefined
        try {
          const invalidated = new Promise<never>((_, reject) => { timer = setInterval(() => { try { requireCurrent() } catch (error) { reject(error) } }, 100) })
          const value = await Promise.race([awaitCourseChatStage(operation, budget, abort.signal), invalidated])
          requireCurrent()
          return value
        } finally { clearInterval(timer) }
      },
      finish() { if (pendingCapture === abort) { pendingCapture = undefined; observingAnchor = undefined; observingSelection = undefined } },
    }
  }
  const observation = createAuthoringObservationController({
    read() {
      const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
      const target = observingAnchor?.target, session = state.courseAuthoringSession
      const projection = target && document ? projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }) : selectEffectiveLayerProjection(state)
      if (!document || !projection || !session || state.projectPath !== owner.projectPath || document.id !== owner.projectId) return null
      const active = session.token.locationId === projection.locationId
      return { document, sessionGeneration: active ? session.token.generation : target?.sessionToken.generation ?? session.token.generation, surfaceId: projection.surfaceId,
        locationId: projection.locationId, stateId: projection.stateId, selectedIds: observingSelection ?? target?.selectedIds ?? session.itemIds,
        draft: active ? (projection.surfaceType === 'slide' ? state.v9ContentEdit : projection.surfaceType === 'flow' ? state.flowDocumentDraft ?? state.flowTextEdit : state.spatialContentEdit) : null,
        spatialCamera: projection.surfaceType === 'spatial-2d' && state.spatialSession?.selection.locationId === projection.locationId
          ? state.spatialSession.sessionCamera : undefined,
        assetFiles: selectMediaAssetFiles(state), componentPackages: state.componentPackages, previewBackgroundColor: active ? state.previewBackgroundColor : null }
    },
    prepareForEdit: () => useEditorStore.getState().prepareCourseProjectPersistence(),
    materializeDraft: () => useEditorStore.getState().captureCourseProjectObservationSnapshot(),
    captureImage(rect) {
      if (!api.captureAuthoringObservation) throw new Error('当前宿主无法捕获课件画面，请更新应用后重试')
      return api.captureAuthoringObservation(rect)
    },
  })
  async function fileCurrent() {
    const result = await api.localAgent({ operation: 'file-status', ...owner })
    if (result.fileStatus?.status !== 'current') throw new Error(`stale：${result.fileStatus?.message ?? '工程文件状态不可用'}；请重新打开磁盘版本，或将当前课件另存为后继续`)
  }
  // Only captureNext may bind a commit receipt to an in-progress task. A new
  // user request retains native conversation history, not an old completion.
  type Input = Pick<SnapshotInput, 'workspace' | 'instruction' | 'scope' | 'purpose' | 'intent' | 'applyPolicy' | 'expectedResult' | 'confirmedDocuments' | 'materials' | 'catalogPackages'>
    & Pick<GenerationRequest, 'execution'>
  let capturedInput: Input | undefined
  let selectionIds: string[] = []
  let locationId: string | undefined
  let createdLocationIds: string[] = []
  function targetIds(document: Parameters<typeof projectEffectiveLayers>[0]['project'], target: Pick<CourseChatTarget, 'locationId' | 'stateId' | 'owner'>) {
    const projection = projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner })
    return new Set([...projection.unifiedRows.map(row => row.id), ...(projection.surfaceType === 'flow'
      ? buildFlowEditorView({ project: document, locationId: target.locationId }).blocks.map(block => block.blockId) : [])])
  }
  function requireAnchor(target: CourseChatTarget): Anchor {
    const anchor = anchors.get(target.anchorId)
    if (!anchor || anchor.target !== target) throw stopped()
    const reason = anchorReason(anchor)
    if (reason) throw new Error(reason)
    return anchor
  }
  function assertObservedTarget(target: CourseChatTarget, request: { locationId: string; surfaceId: string; stateId: string | null }) {
    if (target.locationId !== request.locationId || target.surfaceId !== request.surfaceId || target.stateId !== request.stateId) {
      throw new Error('原任务目标的观察不可用：结构与画面的位置或呈现状态不一致，请返回原目标后重新观察')
    }
  }
  function hasChangedBrowsing(target: CourseChatTarget): boolean {
    const state = useEditorStore.getState(), session = state.courseAuthoringSession
    const projection = selectEffectiveLayerProjection(state)
    const sameIds = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every(id => right.includes(id))
    if (!projection || !session || projection.locationId !== target.locationId || projection.surfaceId !== target.surfaceId
      || projection.stateId !== target.stateId || projection.scope.owner !== target.owner || !sameIds(session.itemIds, target.selectedIds)) return true
    if (projection.surfaceType !== 'flow') return false
    const current = state.flowSession?.selection, frozen = target.flowSelection
    if (!current || !frozen) return current !== frozen
    return current.locationId !== frozen.locationId || current.surfaceId !== frozen.surfaceId || current.authoringScope !== frozen.authoringScope
      || current.focus !== frozen.focus || current.selectedBlockId !== frozen.selectedBlockId || current.authoringAddress !== frozen.authoringAddress
      || !sameIds(current.selectedBlockIds, frozen.selectedBlockIds) || !sameIds(current.selectedOverlayIds, frozen.selectedOverlayIds)
      || current.textRange?.blockId !== frozen.textRange?.blockId || current.textRange?.start !== frozen.textRange?.start
      || current.textRange?.end !== frozen.textRange?.end || current.textRange?.listItemId !== frozen.textRange?.listItemId
      || current.textRange?.tableRowId !== frozen.textRange?.tableRowId || current.textRange?.tableColumnId !== frozen.textRange?.tableColumnId
  }
  function bindRequest(anchor: Anchor, request: GenerationRequest) {
    if (anchor.requestId) requests.delete(anchor.requestId)
    anchor.requestId = request.requestId
    anchor.receipt = undefined
    requests.set(request.requestId, anchor)
    useEditorStore.getState().bindGenerationTaskRequest(request, {
      currentReason: () => bridge.currentReason(request),
      // An unchanged target should follow the transaction's result selection,
      // e.g. select the new image after replacing a shape. Browsing tokens can
      // advance without a teacher selection change, so compare formal state.
      preserveBrowsing: () => hasChangedBrowsing(anchor.target),
      committed(receipt) {
        // This callback is invoked only by the real coordinator's apply receipt.
        const current = snapshot()
        if (receipt.requestId !== request.requestId || receipt.beforeRevision !== anchor.revision
          || current.revision !== receipt.afterRevision || current.draft !== anchor.draft) {
          anchor.invalidReason = 'stale：实际提交回执与本任务不一致，请重新观察'
          return
        }
        Object.assign(anchor, current, { receipt })
      },
    })
  }
  const bridge = {
    dispose: () => { disposed = true; invalidate(); unsubscribe(); observation.dispose(); anchors.clear(); requests.clear() }, invalidate, fileCurrent,
    freezeTarget(): CourseChatTarget {
      if (disposed) throw stopped()
      const current = snapshot(), state = useEditorStore.getState(), session = state.courseAuthoringSession!
      const projection = selectEffectiveLayerProjection(state) ?? projectEffectiveLayers({ project: current.document, locationId: session.token.locationId })
      const target: CourseChatTarget = Object.freeze({ anchorId: crypto.randomUUID(), locationId: projection.locationId,
        surfaceId: projection.surfaceId, stateId: projection.stateId, owner: projection.scope.owner,
        selectedIds: Object.freeze([...session.itemIds]), sessionToken: Object.freeze({ ...session.token }),
        ...(projection.surfaceType === 'flow' && state.flowSession ? { flowSelection: structuredClone(state.flowSession.selection) } : {}) })
      anchors.set(target.anchorId, { ...current, target })
      return target
    },
    currentReason(request: GenerationRequest): string | null {
      if (disposed) return 'stale：任务引用已关闭'
      const anchor = requests.get(request.requestId)
      if (!anchor) return 'stale：任务已停止或重新开始'
      return anchorReason(anchor) ?? (anchor.revision !== request.documentRevision ? 'stale：该阶段已提交，请以实际回执重新观察' : null)
    },
    isCurrent(request: GenerationRequest) { return bridge.currentReason(request) === null },
    async capture(input: Input & { target?: CourseChatTarget; prepareDrafts?: boolean }): Promise<GenerationRequest> {
      const target = input.target ?? bridge.freezeTarget(), anchor = requireAnchor(target)
      const capture = beginCapture(anchor, input.execution)
      try {
        // Only the initial, unchanged active target may flush its existing draft.
        // Background/repair/next-stage observations are always read-only.
        if (input.prepareDrafts !== false && (input.intent ?? 'edit') === 'edit' && useEditorStore.getState().courseAuthoringSession?.token.locationId === target.locationId) {
          preparingInitialDraft = true
          try { observation.prepareForEdit(); Object.assign(anchor, snapshot()) }
          finally { preparingInitialDraft = false }
        }
        await capture.stage(fileCurrent)
        const captured = await capture.stage(() => observation.capture({ intent: input.intent ?? 'edit', target, prepareDrafts: false }))
        assertObservedTarget(target, captured.observation)
        if (captured.document !== anchor.document || captured.observation.documentRevision !== anchor.revision) throw new Error('stale：原目标观察与当前文档版本不一致')
        const state = useEditorStore.getState(), session = state.courseAuthoringSession
        if (!session) throw new Error('课程会话已关闭')
        const nextSelectionIds = [...target.selectedIds], nextLocationId = target.locationId
        const projection = projectEffectiveLayers({ project: captured.document, locationId: nextLocationId, stateId: target.stateId, owner: target.owner })
        const request = captureGenerationSnapshot({ ...input, document: captured.document, projection,
          sessionToken: { ...target.sessionToken, revision: captured.document.revision, generation: captured.observation.sessionGeneration }, selectedIds: nextSelectionIds,
          flowSelection: target.flowSelection,
          componentPackages: state.componentPackages, observation: captured.observation, observationResourceFiles: captured.resourceFiles })
        const inspected = await capture.stage(() => inspectImageSources(request, captured.document.assets, selectMediaAssetFiles(state)))
        const result = generationRequestSchema.parse({ ...inspected, execution: capture.execution, resourceFiles: [...(inspected.resourceFiles ?? []), ...captured.resourceFiles] })
        capture.requireCurrent()
        const { target: _target, prepareDrafts: _prepareDrafts, ...originalInput } = input
        capturedInput = { ...originalInput, execution: capture.execution }
        anchor.input = capturedInput
        selectionIds = nextSelectionIds; locationId = nextLocationId; createdLocationIds = []
        bindRequest(anchor, result)
        return result
      } finally { capture.finish() }
    },
    instructionWithUserInput(text: string): string {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      return `${capturedInput.instruction}\n\n用户最新输入（使用当前画面、内容与选择；仅更新引用不撤销原任务，未明确改变或取消的目标继续执行；明确改变目标时以最新输入为准）：${text}`
    },
    rememberUserInput(text: string) {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      capturedInput = { ...capturedInput, instruction: bridge.instructionWithUserInput(text) }
    },
    async refreshFromUser(text: string, intent: 'discuss' | 'plan' | 'edit', execution?: Execution, target?: CourseChatTarget, scope?: SnapshotInput['scope']): Promise<GenerationRequest> {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      return bridge.capture({ ...capturedInput, target, scope: scope ?? capturedInput.scope, execution: executionBudget(execution), intent, expectedResult: 'auto', instruction: bridge.instructionWithUserInput(text) })
    },
    async captureRecovery(previous: GenerationRequest, text: string, execution?: Execution): Promise<GenerationRequest> {
      const parsed = generationRequestSchema.parse(previous), current = snapshot()
      if (parsed.workspace.projectId !== owner.projectId || parsed.workspace.normalizedPath.toLowerCase().replace(/\\/g, '/') !== owner.projectPath.toLowerCase().replace(/\\/g, '/')) throw new Error('原任务不属于当前工程位置，不能恢复')
      const oldAnchor = requests.get(parsed.requestId)
      const context = parsed.context as Record<string, unknown>
      if (!oldAnchor?.input && Array.isArray(context.materials) && context.materials.length) throw new Error('旧记录保留了材料引用，但没有本轮可读取的材料内容，请重新选择材料后继续')
      const scope = context.reference
      if (scope !== 'selection' && scope !== 'page' && scope !== 'course') throw new Error('旧记录缺少原引用范围，请重新明确编辑目标')
      const destination = parsed.destinations[0]
      const address = destination?.kind === 'update' ? destination.target : destination?.scope
      const locationId = oldAnchor?.target.locationId ?? parsed.observation?.locationId ?? address?.locationId
      if (!locationId || !address) throw new Error('旧记录缺少原编辑目标，请重新明确目标')
      const projection = projectEffectiveLayers({ project: current.document, locationId,
        stateId: oldAnchor?.target.stateId ?? parsed.observation?.stateId ?? address.stateId, owner: oldAnchor?.target.owner ?? address.owner })
      let selectedIds = recoverySelectedIds(parsed, locationId)
      const currentIds = targetIds(current.document, { locationId, stateId: projection.stateId, owner: projection.scope.owner })
      if (oldAnchor?.receipt) selectedIds = [...new Set([...selectedIds, ...oldAnchor.receipt.affected
        .filter(effect => effect.operation === 'created').map(effect => effect.id)])].filter(id => currentIds.has(id))
      selectedIds = selectedIds.filter(id => currentIds.has(id))
      const flowSelection = oldAnchor?.target.flowSelection ?? (context.flowSelection ? recoveryFlowSelection.parse(context.flowSelection) : undefined)
      if (flowSelection && (flowSelection.locationId !== locationId || flowSelection.surfaceId !== projection.surfaceId)) throw new Error('旧记录的正文选区与原目标不一致，请重新选择目标')
      // A user-authorized recovery creates a new anchor, never revives the stale
      // request or imports its receipt. Capture remains read-only for drafts.
      const target: CourseChatTarget = Object.freeze({ anchorId: crypto.randomUUID(), locationId, surfaceId: projection.surfaceId,
        stateId: projection.stateId, owner: projection.scope.owner, selectedIds: Object.freeze([...selectedIds]),
        sessionToken: Object.freeze({ locationId, surfaceType: projection.surfaceType, revision: current.revision, generation: parsed.sessionGeneration }),
        ...(flowSelection ? { flowSelection } : {}) })
      anchors.set(target.anchorId, { ...current, target })
      return bridge.capture({ workspace: parsed.workspace, instruction: `${parsed.instruction}\n\n用户明确继续：${text}\n请根据最新观察接回原目标，结合宿主已提交成果和最后失败处理剩余工作，不重复提交已完成阶段。`,
        scope, purpose: parsed.purpose, intent: parsed.intent ?? 'edit', applyPolicy: parsed.applyPolicy,
        expectedResult: 'auto', confirmedDocuments: parsed.confirmedDocuments, execution: executionBudget(execution), target, prepareDrafts: false,
        ...(oldAnchor?.input ? { materials: oldAnchor.input.materials, catalogPackages: oldAnchor.input.catalogPackages } : {}) })
    },
    async captureNext(previous: GenerationRequest, receipt?: GenerationCommitReceipt, behaviorEvidence: readonly DynamicBehaviorObservation[] = []) {
      if (!capturedInput || !locationId) throw new Error('当前任务引用已关闭')
      const anchor = requests.get(previous.requestId)
      if (!anchor || (receipt && (anchor.receipt !== receipt || receipt.requestId !== previous.requestId
        || receipt.beforeRevision !== previous.documentRevision))) throw new Error('stale：缺少本任务的实际提交回执，不能推进旧观察')
      const target = anchor.target
      const capture = beginCapture(anchor, previous.execution ?? capturedInput.execution)
      const input = capturedInput, nextLocationId = locationId
      const priorSelectionIds = selectionIds, priorCreatedLocationIds = createdLocationIds
      try {
        const expectedRevision = receipt?.afterRevision ?? previous.documentRevision
        const currentDocument = selectActiveCourseProjectDocument(useEditorStore.getState())
        if (currentDocument?.revision !== expectedRevision) throw new Error('stale：课件在任务期间发生其他修改')
        await capture.stage(fileCurrent)
        const created = receipt?.affected.filter(effect => effect.operation === 'created').map(effect => effect.id) ?? []
        const currentIds = targetIds(currentDocument, target)
        const nextSelectionIds = [...new Set([...priorSelectionIds, ...created])].filter(id => currentIds.has(id))
        observingSelection = nextSelectionIds
        const captured = await capture.stage(() => observation.capture({ intent: previous.intent ?? 'edit', dynamicTargetIds: nextSelectionIds, target, prepareDrafts: false }))
        assertObservedTarget(target, captured.observation)
        if (captured.document !== anchor.document || captured.document.revision !== expectedRevision || captured.observation.documentRevision !== expectedRevision) throw new Error('stale：捕获期间课件发生其他修改')
        const state = useEditorStore.getState(), session = state.courseAuthoringSession
        if (!session) throw new Error('课程会话已关闭')
        const nextCreatedLocationIds = [...new Set([...priorCreatedLocationIds, ...created.filter(id => captured.document.locations.some(location => location.id === id))])]
        const projection = projectEffectiveLayers({ project: captured.document, locationId: nextLocationId,
          stateId: target.stateId, owner: target.owner })
        const request = captureGenerationSnapshot({ ...input, document: captured.document, projection,
          additionalLocationIds: nextCreatedLocationIds,
          sharedComponentSourceAddresses: previous.destinations.flatMap(destination => destination.kind === 'update' ? [destination.target.authoringAddress] : []),
          sessionToken: { ...target.sessionToken, revision: captured.document.revision, generation: captured.observation.sessionGeneration }, selectedIds: nextSelectionIds,
          flowSelection: target.flowSelection,
          componentPackages: state.componentPackages, observation: captured.observation, observationResourceFiles: captured.resourceFiles, previousResult: receipt ?? null })
        const inspected = await capture.stage(() => inspectImageSources(request, captured.document.assets, selectMediaAssetFiles(state)))
        const result = attachGenerationBehaviorEvidence(generationRequestSchema.parse({ ...inspected, execution: capture.execution,
          resourceFiles: [...(inspected.resourceFiles ?? []), ...captured.resourceFiles] }), behaviorEvidence, receipt)
        capture.requireCurrent()
        selectionIds = nextSelectionIds; createdLocationIds = nextCreatedLocationIds
        bindRequest(anchor, result)
        return result
      } finally { capture.finish() }
    },
  }
  return bridge
}
