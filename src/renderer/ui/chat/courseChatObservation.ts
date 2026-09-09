import type { GenerationCommitReceipt, GenerationRequest } from '../../../shared/generationContract'
import { generationRequestSchema } from '../../../shared/generationContract'
import type { DesktopAPI } from '../../../shared/ipcTypes'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { attachGenerationBehaviorEvidence } from '../../authoring/generation/generationBehaviorResources'
import { createAuthoringObservationController } from '../../authoring/generation/authoringObservation'
import { captureGenerationSnapshot } from '../../authoring/generation/generationSnapshot'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { selectActiveCourseProjectDocument, selectEffectiveLayerProjection, selectMediaAssetFiles, useEditorStore } from '../../store/editorStore'

type SnapshotInput = Parameters<typeof captureGenerationSnapshot>[0]
export function createCourseChatObservation(api: DesktopAPI, owner: { projectId: string; projectPath: string }) {
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
    dispose: () => observation.dispose(), fileCurrent,
    isCurrent(request: GenerationRequest) {
      const state = useEditorStore.getState(), document = selectActiveCourseProjectDocument(state)
      return state.projectPath === owner.projectPath && document?.id === owner.projectId && document.revision === request.documentRevision
        && state.courseAuthoringSession?.token.generation === request.sessionGeneration
    },
    async capture(input: Input): Promise<GenerationRequest> {
      await fileCurrent()
      const captured = await observation.capture({ intent: input.intent ?? 'edit' })
      const state = useEditorStore.getState(), session = state.courseAuthoringSession
      if (!session) throw new Error('课程会话已关闭')
      capturedInput = input; selectionIds = [...session.itemIds]
      locationId = captured.observation.locationId; createdLocationIds = []
      const projection = projectEffectiveLayers({ project: captured.document, locationId, stateId: captured.observation.stateId })
      const request = captureGenerationSnapshot({ ...input, document: captured.document, projection,
        sessionToken: { ...session.token, locationId, surfaceType: projection.surfaceType }, selectedIds: selectionIds,
        componentPackages: state.componentPackages, observation: captured.observation })
      return generationRequestSchema.parse({ ...request, resourceFiles: [...(request.resourceFiles ?? []), ...captured.resourceFiles] })
    },
    instructionWithUserInput(text: string): string {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      return `${capturedInput.instruction}\n\n用户最新输入（使用当前画面、内容与选择；仅更新引用不撤销原任务，未明确改变或取消的目标继续执行；明确改变目标时以最新输入为准）：${text}`
    },
    rememberUserInput(text: string) {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      capturedInput = { ...capturedInput, instruction: bridge.instructionWithUserInput(text) }
    },
    async refreshFromUser(text: string, intent: 'discuss' | 'plan' | 'edit'): Promise<GenerationRequest> {
      if (!capturedInput) throw new Error('当前任务引用已关闭')
      return bridge.capture({ ...capturedInput, intent, expectedResult: 'auto', instruction: bridge.instructionWithUserInput(text) })
    },
    async captureNext(previous: GenerationRequest, receipt?: GenerationCommitReceipt, behaviorEvidence: readonly DynamicBehaviorObservation[] = []) {
      if (!capturedInput || !locationId) throw new Error('当前任务引用已关闭')
      const expectedRevision = receipt?.afterRevision ?? previous.documentRevision
      const currentDocument = selectActiveCourseProjectDocument(useEditorStore.getState())
      if (currentDocument?.revision !== expectedRevision) throw new Error('stale：课件在任务期间发生其他修改')
      await fileCurrent()
      const created = receipt?.affected.filter(effect => effect.operation === 'created').map(effect => effect.id) ?? []
      const currentIds = targetIds(currentDocument, locationId)
      const nextSelectionIds = [...new Set([...selectionIds, ...created])].filter(id => currentIds.has(id))
      const captured = await observation.capture({ intent: previous.intent ?? 'edit', dynamicTargetIds: nextSelectionIds })
      if (captured.document.revision !== expectedRevision) throw new Error('stale：捕获期间课件发生其他修改')
      const state = useEditorStore.getState(), session = state.courseAuthoringSession
      if (!session) throw new Error('课程会话已关闭')
      selectionIds = nextSelectionIds
      createdLocationIds = [...new Set([...createdLocationIds, ...created.filter(id => captured.document.locations.some(location => location.id === id))])]
      const projection = projectEffectiveLayers({ project: captured.document, locationId,
        stateId: previous.observation?.locationId === locationId ? previous.observation.stateId : null })
      const request = captureGenerationSnapshot({ ...capturedInput, document: captured.document, projection,
        additionalLocationIds: createdLocationIds,
        sessionToken: { ...session.token, locationId, surfaceType: projection.surfaceType }, selectedIds: selectionIds,
        componentPackages: state.componentPackages, observation: captured.observation, previousResult: receipt ?? null })
      return attachGenerationBehaviorEvidence(generationRequestSchema.parse({ ...request, resourceFiles: [...(request.resourceFiles ?? []), ...captured.resourceFiles] }), behaviorEvidence, receipt)
    },
  }
  return bridge
}
