import { courseAuthoringScopeFromLocation } from '../authoring/courseAuthoringScope'
import { createAuthoringToolFacade } from '../authoring/tools/authoringToolFacade'
import { planTeacherControllerComponentEdit } from '../components/teacherControllerComponent'
import { createEditorTransactionStep, type EditorTransactionStep } from '../authoring/editorTransaction'
import { readAuthoringToolSelection } from '../../shared/authoringToolContract'
import { projectEffectiveLayers } from '../course/effectiveLayerProjection'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CourseAuthoringOwner, CourseAuthoringScopeToken } from '../authoring/courseAuthoringScope'
import type { CoursewareBuilderV2Owner } from '../course/coursewareBuilderV2'
import type { AuthoringToolCommitPort } from '../authoring/tools/executeAuthoringTool'
import { createGenerationCandidateCoordinator } from '../authoring/generation/prepareGenerationCandidate'
import { verifyNativeInteractions } from '../authoring/generation/nativeInteractionVerification'
import { generationRequestSchema, type GenerationCommitReceipt, type GenerationRequest } from '../../shared/generationContract'
import { createSessionToken, updateCourseAuthoringSessionItems } from '../authoring/courseAuthoringSession'
import { preserveAuthoringSelectionAcrossTransaction } from '../authoring/authoringSelectionContinuity'

function preservesObservationHost(step: EditorTransactionStep, observation: GenerationRequest['observation']): boolean {
  if (!observation) return false
  const hint = readAuthoringToolSelection(step.selectionHint)
  if (!hint || (hint.locationId === observation.locationId && hint.stateId === observation.stateId)) return false
  // A batch's last operation may target another page. Keep the mounted source
  // for the required next observation, but never preserve a deleted target.
  try {
    const target = projectEffectiveLayers({ project: step.nextDocument, locationId: observation.locationId, stateId: observation.stateId })
    return target.surfaceId === observation.surfaceId && target.stateId === observation.stateId
  } catch { return false }
}

export function createAuthoringToolActions(ports: {
  kernel: Pick<EditorStoreKernel, 'readDocument' | 'readAuthoringSession' | 'writeAuthoringSession' | 'persistTransaction' | 'readResources' | 'waitForCommit' | 'drain'>
  readScope(): CourseAuthoringScopeToken
  activateScope(input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }): void
  hasContentDraft(): boolean
  readProjectPath(): string | null
}) {
  let generation: ReturnType<typeof createGenerationCandidateCoordinator> | undefined
  let committingRequestId: string | undefined
  let binding: { requestId: string; currentReason(): string | null; preserveBrowsing(): boolean; committed(receipt: GenerationCommitReceipt): void } | undefined
  const withSelectionContinuity = (step: EditorTransactionStep) => {
    const session = ports.kernel.readAuthoringSession()
    if (!session) return { step, preservesCurrentSelection: false }
    const scope = ports.readScope()
    return preserveAuthoringSelectionAcrossTransaction(step, {
      locationId: session.token.locationId,
      stateId: scope.stateId,
      owner: scope.owner,
      itemIds: session.itemIds,
    })
  }
  const commitPort: AuthoringToolCommitPort & Pick<CoursewareBuilderV2Owner, 'readResources'> = {
    beforeExecute: async () => { await ports.kernel.drain() },
    readDocument: () => ports.kernel.readDocument(),
    readResources: () => {
      const resources = ports.kernel.readResources()
      return { assetFiles: resources.courseAssetSidecar?.files ?? {}, componentPackages: resources.componentPackages }
    },
    validateDestination(destination) {
      const target = destination.kind === 'update' ? destination.target : destination.scope
      const project = ports.kernel.readDocument()
      if (project.id !== target.projectId || project.revision !== target.documentRevision) return { code: 'revision-conflict', message: '目标文档已改变', path: ['destination'] }
      try {
        const scope = courseAuthoringScopeFromLocation({ project, locationId: target.locationId, owner: target.owner, stateId: target.stateId })
        if (scope.surfaceId !== target.surfaceId || scope.ownerKey !== target.ownerKey) return { code: 'owner-mismatch', message: '目标范围与文档不一致', path: ['destination', 'owner'] }
      } catch { return { code: 'target-missing', message: '目标位置已不存在', path: ['destination'] } }
      if (ports.hasContentDraft()) return { code: 'active-content-draft', message: '请先完成当前文字或调色编辑', path: ['destination'] }
      return null
    },
    commit: async (step) => {
      const continuity = withSelectionContinuity(step)
      return ports.kernel.persistTransaction(continuity.step, '已应用创作工具修改', {
        preserveBrowsing: continuity.preservesCurrentSelection,
      }) && await ports.kernel.waitForCommit()
    },
  }
  const facade = createAuthoringToolFacade(commitPort)
  return {
    createCoursewareBuilderOwner(): CoursewareBuilderV2Owner {
      const projectId = ports.kernel.readDocument().id
      const ensureCurrent = () => {
        if (ports.kernel.readDocument().id !== projectId) throw new Error('Builder 工程已切换，请重新开始构建')
      }
      return Object.freeze({
        beforeExecute: async () => { await ports.kernel.drain(); ensureCurrent() },
        readDocument() { ensureCurrent(); return commitPort.readDocument() },
        readResources() { ensureCurrent(); return commitPort.readResources() },
        readScope() { ensureCurrent(); return ports.readScope() },
        readGeneration() {
          ensureCurrent()
          const session = ports.kernel.readAuthoringSession()
          if (!session) throw new Error('当前没有有效的作者会话')
          return session.token.generation
        },
        validateDestination(destination) { ensureCurrent(); return commitPort.validateDestination(destination) },
        commit(step) { ensureCurrent(); return !ports.hasContentDraft() && commitPort.commit(step) },
        activate(input) {
          ensureCurrent()
          if (ports.hasContentDraft()) throw new Error('请先完成当前内容编辑')
          ports.activateScope(input)
        },
      } satisfies CoursewareBuilderV2Owner)
    },
    manageTeacherControllerComponent(itemId: string, operation: 'restore') {
      if (ports.hasContentDraft()) throw new Error('请先完成当前内容编辑')
      const document = ports.kernel.readDocument()
      const plan = planTeacherControllerComponentEdit(document, ports.kernel.readResources().componentPackages, itemId, operation)
      const step = createEditorTransactionStep(document, plan)
      if (!step || !ports.kernel.persistTransaction(step, '已恢复默认控制台源码')) throw new Error('控制台修改未提交，请重新选择后重试')
    },
    bindGenerationTaskRequest(request: GenerationRequest, ports: { currentReason(): string | null; preserveBrowsing(): boolean; committed(receipt: GenerationCommitReceipt): void }) {
      binding = { requestId: request.requestId, ...ports }
    },
    releaseGenerationTaskRequest(requestId: string) { if (binding?.requestId === requestId) binding = undefined },
    isGenerationTaskCommitting(requestId: string) { return committingRequestId === requestId },
    async prepareGenerationCandidate(request: unknown, candidate: unknown) {
      if (ports.hasContentDraft()) throw new Error('请先完成当前文字或调色编辑')
      const parsed = generationRequestSchema.parse(request)
      const path = ports.readProjectPath()
      await ports.kernel.drain()
      generation?.discard()
      generation = createGenerationCandidateCoordinator({
        verifyInteractions: verifyNativeInteractions,
        readDocument: () => ports.kernel.readDocument(),
        readResources: () => {
          const resources = ports.kernel.readResources()
          return { assetFiles: resources.courseAssetSidecar?.files ?? {}, componentPackages: resources.componentPackages }
        },
        readWorkspace: () => ports.readProjectPath() === path ? parsed.workspace : { ...parsed.workspace, projectId: 'stale-workspace' },
        readSessionGeneration: () => ports.kernel.readAuthoringSession()?.token.generation ?? -1,
        isRequestCurrent: request => binding?.requestId === request.requestId
          ? binding!.currentReason() === null
          : ports.kernel.readAuthoringSession()?.token.generation === request.sessionGeneration,
        commit: async (step, afterCommit) => {
          if (ports.hasContentDraft()) return false
          const anchored = binding?.requestId === parsed.requestId
          if (anchored && binding!.currentReason()) return false
          committingRequestId = parsed.requestId
          try {
            const continuity = withSelectionContinuity(step)
            return ports.kernel.persistTransaction(continuity.step, '已应用 AI 候选，可一次撤销', {
            preserveBrowsing: continuity.preservesCurrentSelection && anchored && (binding!.preserveBrowsing()
              || (afterCommit?.action !== 'finish' && preservesObservationHost(step, parsed.observation))),
          }) && await ports.kernel.waitForCommit() }
          finally { committingRequestId = undefined }
        },
      })
      return generation.prepare(parsed, candidate)
    },
    discardGenerationCandidate() { generation?.discard() },
    stopGenerationCandidate() {
      generation?.discard()
      const session = ports.kernel.readAuthoringSession()
      if (session) ports.kernel.writeAuthoringSession(updateCourseAuthoringSessionItems({
        ...session, token: createSessionToken(session.token, session.token.generation + 1),
      }, session.itemIds))
    },
    async applyGenerationCandidate(previewId: string) {
      const result = await generation?.apply(previewId) ?? { status: 'stale' as const }
      if (result.status !== 'stale' && binding?.requestId === result.receipt.requestId) binding.committed(result.receipt)
      return result
    },
    async runAuthoringTool(request: unknown) {
      return facade.execute(request)
    },
  }
}
