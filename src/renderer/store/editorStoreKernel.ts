import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { CourseAssetSidecar } from '../project/v9AssetAdapter'
import { emptyCourseAssetSidecar } from '../project/v9AssetAdapter'
import type { ComponentPackageData } from '../../shared/componentTypes'
import {
  applyEditorTransactionStep,
  type EditorTransactionStep,
} from '../authoring/editorTransaction'
import {
  applyHistoryResourceChanges,
  commitCourseResourceState,
  type CourseResourceState,
  type CourseResourceTransition,
  type HistoryResourceState,
} from './courseResourceState'
import {
  createSessionToken,
  surfaceTypeForLocation,
  updateCourseAuthoringSessionItems,
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringSession,
} from '../authoring/courseAuthoringSession'

export const SESSIONLESS_COURSE_REASON = '当前会话没有课程工程'

export type EditorUiSelection = {
  selectedNodeIds: string[]
  selectedNodeId: string | null
  editingScope: 'scene' | 'global'
  activeSceneId: string
  activePresentationStateId: string | null
}

export type EditorFeedback = {
  errorMessage?: string | null
  statusMessage?: string | null
}

export type EditorStoreKernel = {
  tryReadDocument(): CourseProjectDocument | null
  readDocument(): CourseProjectDocument
  readAuthoringSession(): CourseAuthoringSession | null
  writeAuthoringSession(session: CourseAuthoringSession | undefined): void
  readResources(): CourseResourceState
  commitResources(
    next: Pick<
      CourseResourceState,
      | 'courseAssetSidecar'
      | 'courseAssetSidecarPast'
      | 'courseAssetSidecarFuture'
      | 'courseComponentPackagesPast'
      | 'courseComponentPackagesFuture'
      | 'componentPackages'
    >,
  ): void
  applyResourceStep(input: {
    document: CourseProjectDocument
    sidecar: CourseAssetSidecar
    componentPackages: Readonly<Record<string, ComponentPackageData>>
    transactionStep?: EditorTransactionStep
    resourceTransition?: CourseResourceTransition
  }): HistoryResourceState | null
  setFeedback(feedback: EditorFeedback): void
  markDirty(dirty?: boolean): void
  readDirty(): boolean
  readSelection(): EditorUiSelection
  syncSelection(selection: EditorUiSelection): void
  failSessionless(reason?: string): never
}

export type EditorStoreKernelHost = {
  tryReadDocument(): CourseProjectDocument | null
  readAuthoringSession(): CourseAuthoringSession | null
  writeAuthoringSession(session: CourseAuthoringSession | undefined): void
  readResources(): CourseResourceState
  commit(patch: Record<string, unknown>): void
  readDirty(): boolean
  readSelection(): EditorUiSelection
  syncSelection(selection: EditorUiSelection): void
}

export function createEditorStoreKernel(host: EditorStoreKernelHost): EditorStoreKernel {
  return {
    tryReadDocument: host.tryReadDocument,
    readDocument() {
      const document = host.tryReadDocument()
      if (!document) throw new Error(SESSIONLESS_COURSE_REASON)
      return document
    },
    readAuthoringSession: host.readAuthoringSession,
    writeAuthoringSession: host.writeAuthoringSession,
    readResources: host.readResources,
    commitResources(next) {
      host.commit(next)
    },
    applyResourceStep: applyEditorResourceStep,
    setFeedback(feedback) {
      host.commit(feedback)
    },
    markDirty(dirty = true) {
      host.commit({ dirty })
    },
    readDirty: host.readDirty,
    readSelection: host.readSelection,
    syncSelection: host.syncSelection,
    failSessionless(reason = SESSIONLESS_COURSE_REASON): never {
      throw new Error(reason)
    },
  }
}

export function applyEditorResourceStep(input: {
  document: CourseProjectDocument
  sidecar: CourseAssetSidecar
  componentPackages: Readonly<Record<string, ComponentPackageData>>
  transactionStep?: EditorTransactionStep
  resourceTransition?: CourseResourceTransition
}): HistoryResourceState | null {
  if (
    input.transactionStep
    && input.resourceTransition
    && input.transactionStep.resourceChanges !== input.resourceTransition.resourceChanges
  ) {
    throw new Error('作者历史资源增量与编辑事务不一致')
  }
  if (input.transactionStep) {
    return applyEditorTransactionStep({
      document: input.document,
      resources: {
        componentPackages: input.componentPackages,
        assetFiles: input.sidecar.files,
      },
    }, input.transactionStep, 'forward').resources
  }
  if (input.resourceTransition) {
    return applyHistoryResourceChanges({
      componentPackages: input.componentPackages,
      assetFiles: input.sidecar.files,
    }, input.resourceTransition.resourceChanges, input.resourceTransition.resourceDirection)
  }
  return null
}

export function commitSurfaceResourcePersist(
  current: CourseResourceState,
  input: {
    document: CourseProjectDocument
    applyDocument?: CourseProjectDocument
    transactionStep?: EditorTransactionStep
    resourceTransition?: CourseResourceTransition
    sidecar?: CourseAssetSidecar
    sidecarDirection?: 'undo' | 'redo'
    componentPackages?: Record<string, ComponentPackageData>
    historyEntry?: boolean
    legacyPastCount: number
    legacyFutureCount: number
  },
): ReturnType<typeof commitCourseResourceState> {
  const presentSidecar = current.courseAssetSidecar ?? emptyCourseAssetSidecar()
  const applied = applyEditorResourceStep({
    document: input.applyDocument ?? input.document,
    sidecar: presentSidecar,
    componentPackages: current.componentPackages,
    transactionStep: input.transactionStep,
    resourceTransition: input.resourceTransition,
  })
  return commitCourseResourceState(current, {
    document: input.document,
    appliedResources: applied,
    sidecar: applied ? undefined : input.sidecar,
    sidecarDirection: applied ? undefined : input.sidecarDirection,
    componentPackages: applied ? undefined : input.componentPackages,
    historyEntry: input.historyEntry,
    legacyPastCount: input.legacyPastCount,
    legacyFutureCount: input.legacyFutureCount,
  })
}

export function courseSessionAfterSurfaceHistory(
  current: CourseAuthoringSession | null,
  project: CourseProjectDocument,
  locationId: string,
  input: {
    transactionStep?: EditorTransactionStep
    resourceTransition?: CourseResourceTransition
    sidecarDirection?: 'undo' | 'redo'
  },
): CourseAuthoringSession | undefined {
  if (!current) return undefined
  if (input.transactionStep) {
    return updateCourseAuthoringSessionRevision(current, project.revision)
  }
  if (!input.resourceTransition && !input.sidecarDirection) return undefined
  return updateCourseAuthoringSessionItems({
    token: createSessionToken({
      locationId,
      surfaceType: surfaceTypeForLocation(project, locationId),
      revision: project.revision,
    }, current.token.generation + 1),
    itemIds: current.itemIds,
  }, current.itemIds)
}
