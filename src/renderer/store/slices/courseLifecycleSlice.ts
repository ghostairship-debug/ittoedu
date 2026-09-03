import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { EditorStoreKernel } from '../editorStoreKernel'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../../project/courseProjectArchive'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '../../components/componentPackageStore'
import {
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  type CourseAssetSidecar,
} from '../../project/v9AssetAdapter'
import { createBlankCourseProject } from '../../project/createCourseProject'
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
    materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string }
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
  acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean
  reopenArchive(bytes: Uint8Array): boolean
  exportArchive(): Uint8Array | null
} {
  return {
    exportArchive(): Uint8Array | null {
      const document = kernel.tryReadDocument()
      if (!document) return null
      const resources = lifecycle.readResources()
      return exportCourseProjectArchiveBytes({
        project: document,
        assetFiles: (resources.courseAssetSidecar ?? emptyCourseAssetSidecar()).files,
        componentPackages: resources.componentPackages,
      })
    },
    reopenArchive(bytes: Uint8Array): boolean {
      try {
        const archive = openCourseProjectArchiveBytes(bytes)
        const componentPackages = archive.componentPackages
        const extra: CourseLifecycleLoadExtra = {
          sidecar: archive.sidecar,
          componentPackages,
          dirty: false,
          statusMessage: `已打开“${archive.project.title}”`,
          path: lifecycle.read().projectPath,
        }
        if (courseProjectStartsAsSpatial(archive.project)) {
          lifecycle.applySpatial(archive.project, extra)
          return true
        }
        if (courseProjectStartsAsFlow(archive.project)) {
          lifecycle.applyFlow(archive.project, extra)
          return true
        }
        lifecycle.applySlide(archive.project, extra)
        return true
      } catch (error) {
        kernel.setFeedback({
          errorMessage: error instanceof Error ? error.message : '无法打开课程工程',
          statusMessage: null,
        })
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
      const document = kernel.tryReadDocument()
      if (!document) return { ok: false, reason: '当前会话没有课程工程' }
      const slideResult = lifecycle.slide.materializeDraft(document)
      if (!slideResult.ok) return slideResult
      const spatialResult = lifecycle.spatial.materializeDraft(slideResult.document)
      if (!spatialResult.ok) return spatialResult
      const flowResult = lifecycle.flow.materializeDraft(spatialResult.document)
      if (!flowResult.ok) return flowResult
      return {
        ok: true,
        snapshot: snapshotPersistence(flowResult.document, lifecycle.readResources()),
      }
    },

    acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean {
      const document = kernel.tryReadDocument()
      const resources = lifecycle.readResources()
      const allChangesSaved =
        document === token.document
        && resources.courseAssetSidecar === token.sidecar
        && resources.componentPackages === token.componentPackages
        && !lifecycle.hasDirtyContentDraft()
      lifecycle.patch({
        projectPath: path,
        dirty: !allChangesSaved,
      })
      kernel.setFeedback({
        statusMessage: allChangesSaved
          ? `已保存到 ${path}`
          : '已保存启动保存时的版本；之后的修改尚未保存',
      })
      return allChangesSaved
    },
    createNewProject() {
      lifecycle.applySlide(createBlankCourseProject(), {
        sidecar: emptyCourseAssetSidecar(),
        path: null,
        dirty: false,
        statusMessage: '已创建新课件',
      })
    },
    createNewSpatialProject() {
      lifecycle.applySpatial(createBlankSpatialCourseProject(), {
        sidecar: emptyCourseAssetSidecar(),
        path: null,
        dirty: false,
        statusMessage: '已创建空白无限画布课件',
      })
    },
    createNewFlowProject() {
      lifecycle.applyFlow(createBlankFlowCourseProject(), {
        sidecar: emptyCourseAssetSidecar(),
        path: null,
        dirty: false,
        statusMessage: '已创建空白流式讲义课件',
      })
    },
    loadCourseProject(project, path, assetFiles = {}, componentPackages = {}) {
      const extra: CourseLifecycleLoadExtra = {
        sidecar: freezeCourseAssetSidecar(assetFiles),
        path,
        dirty: false,
        statusMessage: `已打开“${project.title}”`,
        componentPackages,
      }
      if (courseProjectStartsAsSpatial(project)) {
        lifecycle.applySpatial(project, extra)
        return
      }
      if (courseProjectStartsAsFlow(project)) {
        lifecycle.applyFlow(project, extra)
        return
      }
      lifecycle.applySlide(project, extra)
    },
    loadProject(_project, _path, _assetFiles = {}, _componentPackages = {}) {
      throw new Error('V8 工程不能打开或导入。请使用 loadCourseProject 与 Course Project V9。')
    },
  }
}

export function courseDocumentFromKernel(kernel: EditorStoreKernel): CourseProjectDocument {
  return kernel.readDocument()
}
