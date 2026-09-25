import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { withDefaultComponentController } from '../../components/teacherControllerComponent'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { EditorStoreKernel } from '../editorStoreKernel'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../../core/drivers/codecs/courseProjectArchive'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '../../components/componentPackageStore'
import {
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  type CourseAssetSidecar,
} from '../../project/v9AssetAdapter'
import { createBlankCourseProject } from '../../../core/course/createCourseProject'
import {
  courseProjectStartsAsFlow,
  createBlankFlowCourseProject,
} from '../../project/createFlowCourseProject'
import {
  courseProjectStartsAsSpatial,
  createBlankSpatialCourseProject,
} from '../../project/createSpatialCourseProject'

export interface CourseProjectPersistenceSnapshot {
  readonly project: CourseProjectDocument
  readonly assetFiles: Record<string, Uint8Array>
  readonly componentPackages: Record<string, ComponentPackageData>
}

export interface CourseProjectPersistenceToken {
  readonly document: CourseProjectDocument
  readonly sidecar: CourseAssetSidecar | null
  readonly componentPackages: Record<string, ComponentPackageData>
}

export type PrepareCourseProjectPersistenceResult =
  | {
      readonly ok: true
      readonly snapshot: CourseProjectPersistenceSnapshot
      readonly token: CourseProjectPersistenceToken
    }
  | {
      readonly ok: false
      readonly reason: string
    }

export type CaptureCourseProjectRecoveryResult =
  | {
      readonly ok: true
      readonly snapshot: CourseProjectPersistenceSnapshot
    }
  | {
      readonly ok: false
      readonly reason: string
    }

export type CourseLifecycleOwnedState = {
  projectPath: string | null
  dirty: boolean
}

export type CourseLifecycleLoadExtra = {
  sidecar: ReturnType<typeof freezeCourseAssetSidecar>
  path: string | null
  dirty: boolean
  statusMessage: string | null
  componentPackages?: Record<string, ComponentPackageData>
}

export type CourseLifecyclePorts = {
  replace(project: CourseProjectDocument, path: string | null, assetFiles: Record<string, Uint8Array>, componentPackages: Record<string, ComponentPackageData>): Promise<void>
  readCommitted(): import('../../../shared/workbench/document').DocumentSnapshot
  read(): CourseLifecycleOwnedState
  patch(patch: Partial<CourseLifecycleOwnedState>): void
  applySlide(project: CourseProjectDocument, extra: CourseLifecycleLoadExtra): void
  applyFlow(project: CourseProjectDocument, extra: CourseLifecycleLoadExtra): void
  applySpatial(project: CourseProjectDocument, extra: CourseLifecycleLoadExtra): void
  detectSurface(): 'slide' | 'spatial' | 'flow' | null
  slide: {
    commitDraftForPersistence(): { ok: true } | { ok: false; reason: string }
    materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string }
  }
  spatial: {
    commitDraftForPersistence(): { ok: true } | { ok: false; reason: string }
    materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string }
  }
  flow: {
    commitDraftForPersistence(): { ok: true } | { ok: false; reason: string }
    materializeDraft(document: CourseProjectDocument, purpose?: 'recovery' | 'observation'): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string }
  }
  readResources(): {
    courseAssetSidecar: CourseAssetSidecar | null
    componentPackages: Record<string, ComponentPackageData>
  }
  hasDirtyContentDraft(): boolean
}

export function exportCourseProjectArchiveBytes(input: {
  readonly project: CourseProjectDocument
  readonly assetFiles: Record<string, Uint8Array>
  readonly componentPackages: Record<string, ComponentPackageData>
}): Uint8Array {
  return createCourseProjectArchive({
    project: input.project,
    assetFiles: Object.fromEntries(
      Object.entries(input.assetFiles).map(([assetId, bytes]) => [assetId, bytes.slice()]),
    ),
    componentFiles: componentPackagesToArchiveFiles(input.componentPackages),
  })
}

export function openCourseProjectArchiveBytes(bytes: Uint8Array): {
  readonly project: CourseProjectDocument
  readonly sidecar: ReturnType<typeof freezeCourseAssetSidecar>
  readonly componentPackages: Record<string, ComponentPackageData>
} {
  const archive = openCourseProjectArchive(bytes)
  return {
    project: archive.project,
    sidecar: freezeCourseAssetSidecar(archive.assetFiles),
    componentPackages: componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    ),
  }
}

function snapshotPersistence(
  document: CourseProjectDocument,
  resources: { courseAssetSidecar: CourseAssetSidecar | null; componentPackages: Record<string, ComponentPackageData> },
): CourseProjectPersistenceSnapshot {
  return {
    project: document,
    assetFiles: Object.fromEntries(
      Object.entries(resources.courseAssetSidecar?.files ?? {}).map(([assetId, bytes]) => [assetId, bytes.slice()]),
    ),
    componentPackages: Object.fromEntries(
      Object.entries(resources.componentPackages).map(([packageId, packageData]) => [
        packageId,
        structuredClone(packageData),
      ]),
    ),
  }
}

export function createCourseLifecycleSlice(
  kernel: EditorStoreKernel,
  lifecycle: CourseLifecyclePorts,
): {
  createNewProject(): void
  createNewSpatialProject(): void
  createNewFlowProject(): void
  loadCourseProject(
    project: CourseProjectDocument,
    path: string | null,
    assetFiles?: Record<string, Uint8Array>,
    componentPackages?: Record<string, ComponentPackageData>,
  ): void
  loadProject(
    project: unknown,
    path: string | null,
    assetFiles?: Record<string, Uint8Array>,
    componentPackages?: Record<string, ComponentPackageData>,
  ): void
  prepareCourseProjectPersistence(): PrepareCourseProjectPersistenceResult
  captureCourseProjectRecoverySnapshot(): CaptureCourseProjectRecoveryResult
  captureCourseProjectObservationSnapshot(): CaptureCourseProjectRecoveryResult
  acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean
  reopenArchive(bytes: Uint8Array): Promise<boolean>
  exportArchive(): Uint8Array | null
} {
  const captureDraftSnapshot = (purpose: 'recovery' | 'observation'): CaptureCourseProjectRecoveryResult => {
    const document = kernel.tryReadDocument()
    if (!document) return { ok: false, reason: '当前会话没有课程工程' }
    const slideResult = lifecycle.slide.materializeDraft(document)
    if (!slideResult.ok) return slideResult
    const spatialResult = lifecycle.spatial.materializeDraft(slideResult.document)
    if (!spatialResult.ok) return spatialResult
    const flowResult = lifecycle.flow.materializeDraft(spatialResult.document, purpose)
    if (!flowResult.ok) return flowResult
    return { ok: true, snapshot: snapshotPersistence(flowResult.document, lifecycle.readResources()) }
  }
  return {
    exportArchive(): Uint8Array | null {
      const snapshot = lifecycle.readCommitted()
      if (snapshot.model.kind !== 'course-v9') return null
      return createCourseProjectArchive({ project: snapshot.model.project, assetFiles: snapshot.model.resources.assets, componentFiles: snapshot.model.resources.components })
    },
    async reopenArchive(bytes: Uint8Array): Promise<boolean> {
      try {
        const archive = openCourseProjectArchiveBytes(bytes)
        await lifecycle.replace(archive.project, null, archive.sidecar.files, archive.componentPackages)
        return true
      } catch (error) {
        kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : '无法打开课程工程', statusMessage: null })
        return false
      }
    },
    prepareCourseProjectPersistence(): PrepareCourseProjectPersistenceResult {
      const surface = lifecycle.detectSurface()
      if (surface === 'slide') {
        const commit = lifecycle.slide.commitDraftForPersistence()
        if (!commit.ok) return commit
      } else if (surface === 'spatial') {
        const commit = lifecycle.spatial.commitDraftForPersistence()
        if (!commit.ok) return commit
      } else if (surface === 'flow') {
        const commit = lifecycle.flow.commitDraftForPersistence()
        if (!commit.ok) return commit
      }
      const document = kernel.tryReadDocument()
      if (!document) return { ok: false, reason: '当前会话没有课程工程' }
      const resources = lifecycle.readResources()
      return {
        ok: true,
        snapshot: snapshotPersistence(document, resources),
        token: {
          document,
          sidecar: resources.courseAssetSidecar,
          componentPackages: resources.componentPackages,
        },
      }
    },

    captureCourseProjectRecoverySnapshot(): CaptureCourseProjectRecoveryResult {
      return captureDraftSnapshot('recovery')
    },

    captureCourseProjectObservationSnapshot(): CaptureCourseProjectRecoveryResult {
      return captureDraftSnapshot('observation')
    },

    acknowledgeCourseProjectSaved(path: string, _token: CourseProjectPersistenceToken): boolean {
      // A renderer caller cannot acknowledge bytes or clear main-owned dirty state.
      const snapshot = lifecycle.readCommitted()
      return snapshot.binding.kind === 'file' && snapshot.binding.path === path && !snapshot.dirty && !lifecycle.hasDirtyContentDraft()
    },
    createNewProject() {
      const bundle = withDefaultComponentController(createBlankCourseProject())
      void lifecycle.replace(bundle.project, null, {}, bundle.componentPackages).catch(error => kernel.setFeedback({ errorMessage: String(error) }))
    },
    createNewSpatialProject() {
      const bundle = withDefaultComponentController(createBlankSpatialCourseProject())
      void lifecycle.replace(bundle.project, null, {}, bundle.componentPackages).catch(error => kernel.setFeedback({ errorMessage: String(error) }))
    },
    createNewFlowProject() {
      const bundle = withDefaultComponentController(createBlankFlowCourseProject())
      void lifecycle.replace(bundle.project, null, {}, bundle.componentPackages).catch(error => kernel.setFeedback({ errorMessage: String(error) }))
    },
    loadCourseProject(project, path, assetFiles = {}, componentPackages = {}) {
      void lifecycle.replace(project, path, assetFiles, componentPackages).catch(error => kernel.setFeedback({ errorMessage: String(error) }))
    },
    loadProject(_project, _path, _assetFiles = {}, _componentPackages = {}) {
      throw new Error('V8 工程不能打开或导入。请使用 loadCourseProject 与 Course Project V9。')
    },
  }
}

export function courseDocumentFromKernel(kernel: EditorStoreKernel): CourseProjectDocument {
  return kernel.readDocument()
}
