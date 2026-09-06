import { readAuthoringToolSelection } from '../../shared/authoringToolContract'
import type { EditorTransactionStep } from '../authoring/editorTransaction'
import { authoringLegacyHistoryEntryCount, commitEditorTransactionToAuthoringHistory, type ResourceAwareAuthoringHistory } from '../authoring/resourceAwareAuthoringHistory'
import { buildCourseAuthoringSessionForProject, type CourseAuthoringSession } from '../authoring/courseAuthoringSession'
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
}): boolean | undefined {
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
  if (!hint || hint.itemIds.length || hint.stateId !== null) throw new Error('跨表面课程导航需要空对象选区')
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
    if (hint.owner !== 'scene') throw new Error('Slide 导航 owner 不匹配')
    backend = applyV9BackendState(createSlideAuthoringBackend({ ...openSlideAuthoringSession(project, { locationId: location.id }), history }), extra)
  } else if (location.kind === 'flow-block') {
    if (hint.owner !== 'surface') throw new Error('Flow 导航 owner 不匹配')
    backend = applyFlowBackendState({ history, selection: selectFlowEditorBlock(project, location.id, location.blockId) }, extra)
  } else {
    if (hint.owner !== 'world') throw new Error('Spatial 导航 owner 不匹配')
    backend = applySpatialBackendState({ ...openSpatialAuthoringSession(project, { locationId: location.id }), history }, extra)
  }
  const fresh = buildCourseAuthoringSessionForProject(project, location.id)
  return { ...backend, ...resources, courseAuthoringSession: { ...fresh, token: { ...fresh.token, generation: input.session.token.generation + 1 } } }
}
