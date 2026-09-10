import type { GenerationCommitReceipt, GenerationRequest } from '../../../shared/generationContract'
import { generationRequestSchema, MAX_GENERATION_TASK_DURATION_MS } from '../../../shared/generationContract'
import type { DesktopAPI } from '../../../shared/ipcTypes'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { attachGenerationBehaviorEvidence } from '../../authoring/generation/generationBehaviorResources'
import { createAuthoringObservationController } from '../../authoring/generation/authoringObservation'
import { captureGenerationSnapshot } from '../../authoring/generation/generationSnapshot'
import { createGenerationImageSourceInspector } from '../../authoring/generation/generationImageDiagnostics'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { selectActiveCourseProjectDocument, selectEffectiveLayerProjection, selectMediaAssetFiles, useEditorStore } from '../../store/editorStore'

type SnapshotInput = Parameters<typeof captureGenerationSnapshot>[0]
type Execution = NonNullable<GenerationRequest['execution']>
const stopped = () => new Error('stale：任务已停止或重新开始')
const expired = () => new Error('本任务的20分钟执行期限已到，请重新发送以继续；准备结果已丢弃')
function executionBudget(execution?: Execution): Execution {
  const startedAt = execution?.startedAt ?? Date.now()
  return { version: 1, startedAt, deadlineAt: Math.min(execution?.deadlineAt ?? Infinity, startedAt + MAX_GENERATION_TASK_DURATION_MS) }
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
  function invalidate() {
    captureEpoch++
    pendingCapture?.abort()
    pendingCapture = undefined
  }
  function beginCapture(execution?: Execution) {
    if (disposed) throw stopped()
    invalidate()
    const epoch = captureEpoch, abort = new AbortController(), budget = executionBudget(execution)
    pendingCapture = abort
    const requireCurrent = () => {
      if (disposed || epoch !== captureEpoch || abort.signal.aborted) throw stopped()
      if (Date.now() >= budget.deadlineAt) throw expired()
    }
    return {
      execution: budget,
      requireCurrent,
      async stage<T>(operation: () => Promise<T>) {
        requireCurrent()
        const value = await awaitCourseChatStage(operation, budget, abort.signal)
        requireCurrent()
        return value
      },
      finish() { if (pendingCapture === abort) pendingCapture = undefined },
    }
  }
  const observation = createAuthoringObservationController({
    read() {
      const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
      const projection = selectEffectiveLayerProjection(state), session = state.courseAuthoringSession
      if (!document || !projection || !session || state.projectPath !== owner.projectPath || document.id !== owner.projectId) return null
      return { document, sessionGeneration: session.token.generation, surfaceId: projection.surfaceId,
        locationId: projection.locationId, stateId: projection.stateId, selectedIds: session.itemIds,
        draft: projection.surfaceType === 'slide' ? state.v9ContentEdit : projection.surfaceType === 'flow' ? state.flowTextEdit : state.spatialContentEdit,
        spatialCamera: projection.surfaceType === 'spatial-2d' && state.spatialSession?.selection.locationId === projection.locationId
          ? state.spatialSession.sessionCamera : undefined,
        assetFiles: selectMediaAssetFiles(state), componentPackages: state.componentPackages, previewBackgroundColor: state.previewBackgroundColor }
    },
    prepareForEdit: () => useEditorStore.getState().prepareCourseProjectPersistence(),
    materializeDraft: () => useEditorStore.getState().captureCourseProjectRecoverySnapshot(),
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
  function targetIds(document: Parameters<typeof projectEffectiveLayers>[0]['project'], location: string) {
    const projection = projectEffectiveLayers({ project: document, locationId: location })
    return new Set([...projection.unifiedRows.map(row => row.id), ...(projection.surfaceType === 'flow'
      ? buildFlowEditorView({ project: document, locationId: location }).blocks.map(block => block.blockId) : [])])
  }
  const bridge = {
    dispose: () => { disposed = true; invalidate(); observation.dispose() }, invalidate, fileCurrent,
    isCurrent(request: GenerationRequest) {
      const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
      return !disposed && state.projectPath === owner.projectPath && document?.id === owner.projectId && document.revision === request.documentRevision
        && state.courseAuthoringSession?.token.generation === request.sessionGeneration
    },
    async capture(input: Input): Promise<GenerationRequest> {
      const capture = beginCapture(input.execution)
      try {
        await capture.stage(fileCurrent)
        const captured = await capture.stage(() => observation.capture({ intent: input.intent ?? 'edit' }))
        const state = useEditorStore.getState(), session = state.courseAuthoringSession
        if (!session) throw new Error('课程会话已关闭')
        const nextSelectionIds = [...session.itemIds], nextLocationId = captured.observation.locationId
        const projection = projectEffectiveLayers({ project: captured.document, locationId: nextLocationId, stateId: captured.observation.stateId })
        const request = captureGenerationSnapshot({ ...input, document: captured.document, projection,
          sessionToken: { ...session.token, locationId: nextLocationId, surfaceType: projection.surfaceType }, selectedIds: nextSelectionIds,
          componentPackages: state.componentPackages, observation: captured.observation, observationResourceFiles: captured.resourceFiles })
        const inspected = await capture.stage(() => inspectImageSources(request, captured.document.assets, selectMediaAssetFiles(state)))
        if (!bridge.isCurrent(inspected)) throw new Error('stale：图片源预检期间课件或会话发生变化，请重新观察')
        const result = generationRequestSchema.parse({ ...inspected, execution: capture.execution, resourceFiles: [...(inspected.resourceFiles ?? []), ...captured.resourceFiles] })
        capture.requireCurrent()
        capturedInput = { ...input, execution: capture.execution }
        selectionIds = nextSelectionIds; locationId = nextLocationId; createdLocationIds = []
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
    async refreshFromUser(text: string, intent: 'discuss' | 'plan' | 'edit', execution?: Execution): Promise<GenerationRequest> {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      return bridge.capture({ ...capturedInput, execution: executionBudget(execution), intent, expectedResult: 'auto', instruction: bridge.instructionWithUserInput(text) })
    },
    async captureNext(previous: GenerationRequest, receipt?: GenerationCommitReceipt, behaviorEvidence: readonly DynamicBehaviorObservation[] = []) {
      if (!capturedInput || !locationId) throw new Error('当前任务引用已关闭')
      const capture = beginCapture(previous.execution ?? capturedInput.execution)
      const input = capturedInput, nextLocationId = locationId
      const priorSelectionIds = selectionIds, priorCreatedLocationIds = createdLocationIds
      try {
        const expectedRevision = receipt?.afterRevision ?? previous.documentRevision
        const currentDocument = selectActiveCourseProjectDocument(useEditorStore.getState())
        if (currentDocument?.revision !== expectedRevision) throw new Error('stale：课件在任务期间发生其他修改')
        await capture.stage(fileCurrent)
        const created = receipt?.affected.filter(effect => effect.operation === 'created').map(effect => effect.id) ?? []
        const currentIds = targetIds(currentDocument, nextLocationId)
        const nextSelectionIds = [...new Set([...priorSelectionIds, ...created])].filter(id => currentIds.has(id))
        const captured = await capture.stage(() => observation.capture({ intent: previous.intent ?? 'edit', dynamicTargetIds: nextSelectionIds }))
        if (captured.document.revision !== expectedRevision) throw new Error('stale：捕获期间课件发生其他修改')
        const state = useEditorStore.getState(), session = state.courseAuthoringSession
        if (!session) throw new Error('课程会话已关闭')
        const nextCreatedLocationIds = [...new Set([...priorCreatedLocationIds, ...created.filter(id => captured.document.locations.some(location => location.id === id))])]
        const projection = projectEffectiveLayers({ project: captured.document, locationId: nextLocationId,
          stateId: previous.observation?.locationId === nextLocationId ? previous.observation.stateId : null })
        const request = captureGenerationSnapshot({ ...input, document: captured.document, projection,
          additionalLocationIds: nextCreatedLocationIds,
          sessionToken: { ...session.token, locationId: nextLocationId, surfaceType: projection.surfaceType }, selectedIds: nextSelectionIds,
          componentPackages: state.componentPackages, observation: captured.observation, observationResourceFiles: captured.resourceFiles, previousResult: receipt ?? null })
        const inspected = await capture.stage(() => inspectImageSources(request, captured.document.assets, selectMediaAssetFiles(state)))
        if (!bridge.isCurrent(inspected)) throw new Error('stale：图片源预检期间课件或会话发生变化，请重新观察')
        const result = attachGenerationBehaviorEvidence(generationRequestSchema.parse({ ...inspected, execution: capture.execution,
          resourceFiles: [...(inspected.resourceFiles ?? []), ...captured.resourceFiles] }), behaviorEvidence, receipt)
        capture.requireCurrent()
        selectionIds = nextSelectionIds; createdLocationIds = nextCreatedLocationIds
        return result
      } finally { capture.finish() }
    },
  }
  return bridge
}
