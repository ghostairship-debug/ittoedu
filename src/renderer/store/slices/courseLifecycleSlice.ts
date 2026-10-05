import type { CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import { createTeacherControllerFrame } from '../../../components/teacher-controller/data'
import type { DocumentResources } from '../../../shared/workbench/document'
import type { SlideCanvasSize } from '../../../shared/slideCanvas'
import { createBlankCourseProjectV10 } from '../../../core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../../core/drivers/CourseV10Driver'
import { cloneDocumentResources } from '../../../core/drivers/resources'
import type { CourseV10DocumentBridge } from '../../documents/CourseV10DocumentBridge'
import type { EditorStoreKernel } from '../editorStoreKernel'

export interface CourseProjectPersistenceSnapshot {
  readonly project: CourseProjectV10
  readonly resources: DocumentResources
}
export interface CourseProjectPersistenceToken {
  readonly documentId: string
  readonly epoch: string
  readonly revision: number
}
export type PrepareCourseProjectPersistenceResult =
  | { readonly ok: true; readonly snapshot: CourseProjectPersistenceSnapshot; readonly token: CourseProjectPersistenceToken }
  | { readonly ok: false; readonly reason: string }
export type CaptureCourseProjectRecoveryResult =
  | { readonly ok: true; readonly snapshot: CourseProjectPersistenceSnapshot }
  | { readonly ok: false; readonly reason: string }
export type CourseLifecycleOwnedState = { projectPath: string | null; dirty: boolean }
export type CourseLifecyclePorts = {
  bridge: CourseV10DocumentBridge
  read(): CourseLifecycleOwnedState
  patch(patch: Partial<CourseLifecycleOwnedState>): void
}

export function createCourseProjectContent(surface: 'slide' | 'flow' | 'spatial', canvas?: SlideCanvasSize): CourseProjectPersistenceSnapshot {
  const project = createBlankCourseProjectV10()
  const page = project.surfaces[0]
  page.kind = surface
  page.title = surface === 'flow' ? '讲义' : surface === 'spatial' ? '空间' : page.title
  if (surface === 'slide') {
    page.designSize = canvas ?? page.designSize
    for (const id of project.global.overlay) if (project.instances[id].definitionId === 'guoling.navigation') project.instances[id].frame = createTeacherControllerFrame(page.designSize)
  } else if (surface === 'flow') delete page.designSize
  else page.spatial = { home: { x: 0, y: 0, zoom: 1 }, frames: [] }
  return { project, resources: { assets: {}, components: {} } }
}

export function exportCourseProjectArchiveBytes(input: CourseProjectPersistenceSnapshot): Uint8Array {
  return new CourseV10Driver().serialize({ kind: 'course-v10', project: input.project, resources: input.resources })
}
export function openCourseProjectArchiveBytes(bytes: Uint8Array): CourseProjectPersistenceSnapshot {
  const model = new CourseV10Driver().load(bytes)
  if (model.kind !== 'course-v10') throw new Error('请打开 Course Project V10 工程；旧工程原件仍保留')
  return { project: model.project, resources: model.resources }
}

/** Lifecycle delegates formal writes, file binding and History to the existing Session. */
export function createCourseLifecycleSlice(kernel: EditorStoreKernel, lifecycle: CourseLifecyclePorts) {
  const capture = (): PrepareCourseProjectPersistenceResult => {
    const view = kernel.readView()
    if (!view.project || !view.snapshot) return { ok: false, reason: '当前会话没有课程工程' }
    if (view.error) return { ok: false, reason: view.error }
    return {
      ok: true,
      snapshot: { project: structuredClone(view.project), resources: cloneDocumentResources(kernel.readResources()) },
      token: { documentId: view.snapshot.documentId, epoch: view.snapshot.epoch, revision: view.snapshot.revision },
    }
  }
  const report = (error: unknown) => kernel.setFeedback({ errorMessage: error instanceof Error ? error.message : String(error) })
  const create = (surface: 'slide' | 'flow' | 'spatial', canvas?: SlideCanvasSize) => {
    void lifecycle.bridge.create({ kind: 'course-v10', ...createCourseProjectContent(surface, canvas) }).catch(report)
  }
  return {
    createNewProject(canvas?: SlideCanvasSize) { create('slide', canvas) },
    createNewSpatialProject() { create('spatial') },
    createNewFlowProject() { create('flow') },
    loadCourseProject(project: CourseProjectV10, path: string | null, resources: DocumentResources = { assets: {}, components: {} }) {
      // File bindings are opened by Main; in-memory imported content creates an untitled document.
      void (path ? lifecycle.bridge.open(path) : lifecycle.bridge.create({ kind: 'course-v10', project, resources })).catch(report)
    },
    loadProject(project: unknown, path: string | null, resources: DocumentResources = { assets: {}, components: {} }) {
      if (!project || typeof project !== 'object' || !('schemaVersion' in project) || project.schemaVersion !== 10) {
        throw new Error('请使用 Course Project V10 工程；旧工程原件仍保留')
      }
      const model = { kind: 'course-v10' as const, project: project as CourseProjectV10, resources }
      new CourseV10Driver().validate(model)
      void (path ? lifecycle.bridge.open(path) : lifecycle.bridge.create(model)).catch(report)
    },
    prepareCourseProjectPersistence: capture,
    captureCourseProjectRecoverySnapshot(): CaptureCourseProjectRecoveryResult { return capture() },
    captureCourseProjectObservationSnapshot(): CaptureCourseProjectRecoveryResult { return capture() },
    acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean {
      const view = kernel.readView(), snapshot = view.snapshot
      return Boolean(snapshot && snapshot.documentId === token.documentId && snapshot.epoch === token.epoch
        && snapshot.binding.kind === 'file' && snapshot.binding.path === path && !snapshot.dirty && view.pending === 0)
    },
    async reopenArchive(bytes: Uint8Array): Promise<boolean> {
      try { await lifecycle.bridge.create({ kind: 'course-v10', ...openCourseProjectArchiveBytes(bytes) }); return true }
      catch (error) { report(error); return false }
    },
    exportArchive(): Uint8Array | null {
      const view = kernel.readView()
      if (!view.snapshot || view.pending || view.error || view.snapshot.model.kind !== 'course-v10') return null
      return new CourseV10Driver().serialize(view.snapshot.model)
    },
  }
}
export function courseDocumentFromKernel(kernel: EditorStoreKernel): CourseProjectV10 { return kernel.readDocument() }
