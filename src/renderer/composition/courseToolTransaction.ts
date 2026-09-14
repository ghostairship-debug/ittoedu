import { readAuthoringToolSelection } from '../../shared/authoringToolContract'
import type { EditorTransactionStep } from '../authoring/editorTransaction'
import { authoringLegacyHistoryEntryCount, commitEditorTransactionToAuthoringHistory, type ResourceAwareAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { buildCourseAuthoringSessionForProject, updateCourseAuthoringSessionItems, updateCourseAuthoringSessionRevision, type CourseAuthoringSession } from '../authoring/courseAuthoringSession'
import { selectSlideToolResult, selectFlowToolResult, selectSpatialToolResult } from '../authoring/toolSelection'
import { createSlideAuthoringBackend, openSlideAuthoringSession } from '../course/slideAuthoringBackend'
import { selectFlowEditorBlock } from '../course/flowEditorSlice'
import { openSpatialAuthoringSession } from '../course/spatialEditorCommands'
import { applyV9BackendState } from '../store/slices/slideAuthoringSlice'
import { applyFlowBackendState } from '../store/slices/flowAuthoringSlice'
import { applySpatialBackendState } from '../store/slices/spatialAuthoringSlice'
import { commitSurfaceResourcePersist } from '../store/editorStoreKernel'
import type { CourseResourceState } from '../store/courseResourceState'

/** Course navigation owns cross-Surface routing; the root only binds ports. */
export function persistCrossSurfaceToolTransaction(step: EditorTransactionStep, statusMessage: string, ports: {
  session: CourseAuthoringSession | null
  path: string | null
  readHistory(): ResourceAwareAuthoringHistory | null
  readResources(): CourseResourceState
  write(patch: Record<string, unknown>): void
  preserveBrowsing?: boolean
  reprojectBrowsing?(history: ResourceAwareAuthoringHistory): Record<string, unknown> | null
}): boolean | undefined {
  if (ports.preserveBrowsing) {
    const history = ports.readHistory(), session = ports.session
    if (!history || !session || !step.nextDocument.locations.some(location => location.id === session.token.locationId)) return false
    const nextHistory = commitEditorTransactionToAuthoringHistory(history, step)
    const backend = ports.reprojectBrowsing?.(nextHistory)
    if (!backend) return false
    const resources = commitSurfaceResourcePersist(ports.readResources(), {
      document: step.nextDocument, applyDocument: history.present, transactionStep: step,
      historyEntry: true, legacyPastCount: authoringLegacyHistoryEntryCount(nextHistory.past),
      legacyFutureCount: authoringLegacyHistoryEntryCount(nextHistory.future),
    })
    ports.write({ ...backend, ...resources, dirty: true, errorMessage: null, statusMessage,
      courseAuthoringSession: updateCourseAuthoringSessionRevision(session, step.nextDocument.revision) })
    return true
  }
  const hint = readAuthoringToolSelection(step.selectionHint)
  const location = hint && step.nextDocument.locations.find(entry => entry.id === hint.locationId)
  const surface = location && step.nextDocument.surfaces.find(entry => entry.id === location.surfaceId)
  if (!surface || !ports.session || surface.type === ports.session.token.surfaceType) return undefined
  const history = ports.readHistory()
  if (!history) return false
  const patch = planCourseToolTransaction({ step, statusMessage, history, resources: ports.readResources(), session: ports.session, path: ports.path })
  ports.write(patch)
  return true
}

/** Prepare the destination backend, history and resources before one Store write. */
function planCourseToolTransaction(input: {
  step: EditorTransactionStep
  history: ResourceAwareAuthoringHistory
  resources: CourseResourceState
  session: CourseAuthoringSession
  path: string | null
  statusMessage: string
}): Record<string, unknown> {
  const { step } = input
  const hint = readAuthoringToolSelection(step.selectionHint)
  if (!hint) throw new Error('跨表面事务需要正式作者选区')
  const project = step.nextDocument
  const location = project.locations.find((entry) => entry.id === hint.locationId)
  if (!location) throw new Error('课程导航目标已失效')
  const history = commitEditorTransactionToAuthoringHistory(input.history, step)
  const resources = commitSurfaceResourcePersist(input.resources, {
    document: project, applyDocument: input.history.present, transactionStep: step,
    historyEntry: true, legacyPastCount: authoringLegacyHistoryEntryCount(history.past),
    legacyFutureCount: authoringLegacyHistoryEntryCount(history.future),
  })
  const extra = { path: input.path, dirty: true, statusMessage: input.statusMessage }
  let backend: Record<string, unknown>
  if (location.kind === 'slide-scene') {
    const selected = selectSlideToolResult(project, hint)
    backend = applyV9BackendState(createSlideAuthoringBackend({ ...openSlideAuthoringSession(project, { locationId: location.id }), history,
      scope: selected.owner, selection: selected.selection }), extra)
  } else if (location.kind === 'flow-block') {
    const selection = selectFlowToolResult(project, hint)
    backend = applyFlowBackendState({ history, selection: hint.itemIds.length ? selection : selectFlowEditorBlock(project, location.id, location.blockId) }, extra)
  } else {
    const selected = selectSpatialToolResult(project, hint)
    backend = applySpatialBackendState({ ...openSpatialAuthoringSession(project, { locationId: location.id }), history,
      scope: selected.owner, selection: selected.selection }, extra)
  }
  const fresh = buildCourseAuthoringSessionForProject(project, location.id)
  return { ...backend, ...resources, courseAuthoringSession: updateCourseAuthoringSessionItems({ ...fresh, token: { ...fresh.token, generation: input.session.token.generation + 1 } }, hint.itemIds) }
}
