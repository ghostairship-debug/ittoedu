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
import { generationRequestSchema, type GenerationCommitReceipt, type GenerationRequest } from '../../shared/generationContract'
import { createSessionToken, updateCourseAuthoringSessionItems } from '../authoring/courseAuthoringSession'

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
  kernel: Pick<EditorStoreKernel, 'readDocument' | 'readAuthoringSession' | 'writeAuthoringSession' | 'persistTransaction' | 'readResources'>
  readScope(): CourseAuthoringScopeToken
  activateScope(input: { locationId: string; owner?: CourseAuthoringOwner; stateId?: string | null }): void
  hasContentDraft(): boolean
  readProjectPath(): string | null
}) {
  let generation: ReturnType<typeof createGenerationCandidateCoordinator> | undefined
  let committingRequestId: string | undefined
  let binding: { requestId: string; currentReason(): string | null; preserveBrowsing(): boolean; committed(receipt: GenerationCommitReceipt): void } | undefined
  const commitPort: AuthoringToolCommitPort & Pick<CoursewareBuilderV2Owner, 'readResources'> = {
    readDocument: () => ports.kernel.readDocument(),
    readResources: () => {
      const resources = ports.kernel.readResources()
      return { assetFiles: resources.courseAssetSidecar?.files ?? {}, componentPackages: resources.componentPackages }
    },
    validateDestination(destination) {
      const target = destination.kind === 'update' ? destination.target : destination.scope
      const session = ports.kernel.readAuthoringSession()
      if (!session || session.token.generation !== target.sessionGeneration ||
        session.token.locationId !== target.locationId || session.token.surfaceType !== target.surfaceType) {
        return { code: 'session-stale', message: '当前作者会话与目标不一致', path: ['destination', 'sessionGeneration'] }
      }
      const scope = ports.readScope()
      if (scope.owner !== target.owner || scope.stateId !== target.stateId) {
        return { code: 'owner-mismatch', message: '当前 owner / 呈现状态与目标不一致', path: ['destination', 'owner'] }
      }
      if (ports.hasContentDraft()) return { code: 'active-content-draft', message: '请先完成当前文字或调色编辑', path: ['destination'] }
      return null
    },
    commit: (step) => ports.kernel.persistTransaction(step, '已应用创作工具修改'),
  }
  const facade = createAuthoringToolFacade(commitPort)
  return {
    createCoursewareBuilderOwner(): CoursewareBuilderV2Owner {
      const projectId = ports.kernel.readDocument().id
      const ensureCurrent = () => {
        if (ports.kernel.readDocument().id !== projectId) throw new Error('Builder 工程已切换，请重新开始构建')
      }
      return Object.freeze({
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
      if (!path) throw new Error('请先保存工程')
      generation?.discard()
      generation = createGenerationCandidateCoordinator({
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
        commit: (step, afterCommit) => {
          if (ports.hasContentDraft()) return false
          const anchored = binding?.requestId === parsed.requestId
          if (anchored && binding!.currentReason()) return false
          committingRequestId = parsed.requestId
          try { return ports.kernel.persistTransaction(step, '已应用 AI 候选，可一次撤销', {
            preserveBrowsing: anchored && (binding!.preserveBrowsing()
              || (afterCommit?.action !== 'finish' && preservesObservationHost(step, parsed.observation))),
          }) }
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
    applyGenerationCandidate(previewId: string) {
      const result = generation?.apply(previewId) ?? { status: 'stale' as const }
      if (result.status !== 'stale' && binding?.requestId === result.receipt.requestId) binding.committed(result.receipt)
      return result
    },
    async runAuthoringTool(request: unknown) {
      return facade.execute(request)
    },
  }
}
