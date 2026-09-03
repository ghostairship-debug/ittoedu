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
import { emptyCourseAssetSidecar, freezeCourseAssetSidecar } from '../../project/v9AssetAdapter'
import { createBlankCourseProject } from '../../project/createCourseProject'
import {
  courseProjectStartsAsFlow,
  createBlankFlowCourseProject,
} from '../../project/createFlowCourseProject'
import {
  courseProjectStartsAsSpatial,
  createBlankSpatialCourseProject,
} from '../../project/createSpatialCourseProject'

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

export function createCourseLifecycleSlice(
  _kernel: EditorStoreKernel,
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
} {
  return {
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
