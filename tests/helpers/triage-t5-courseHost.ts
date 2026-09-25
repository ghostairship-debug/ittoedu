import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { courseViewModel } from '../../src/renderer/documents/CourseDocumentView'
import { withDefaultComponentController } from '../../src/renderer/components/teacherControllerComponent'
import { createBlankFlowCourseProject } from '../../src/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import { freezeCourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { createCourseStoreHost } from './courseStoreHost'

const blankProject = {
  slide: () => createBlankCourseProject({ includeDefaultController: false, controls: 'none' }),
  flow: () => createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' }),
  spatial: () => createBlankSpatialCourseProject({ includeDefaultController: false, controls: 'none' }),
} as const

export type AssignedCourseSurface = 'slide' | 'flow' | 'spatial'

/** Connect a real DocumentSession. The bootstrap document is a blank slide. */
export async function connectAssignedCourse(surface: AssignedCourseSurface = 'slide') {
  const host = await createCourseStoreHost()
  await host.open(blankProject[surface]())
  return host
}

/**
 * Open `project` as the active course. Omit `componentPackages` to attach the
 * default teacher-controller bytes when the project references that package.
 */
export async function openAssignedCourse(
  project: CourseProjectDocument,
  assetFiles: Record<string, Uint8Array> = {},
  componentPackages?: Record<string, ComponentPackageData>,
) {
  const host = await createCourseStoreHost()
  const packages = componentPackages ?? withDefaultComponentController(project).componentPackages
  const created = await host.api.create(
    courseViewModel({
      courseAssetSidecar: freezeCourseAssetSidecar(assetFiles),
      componentPackages: packages,
    }, project),
    `${project.title || 'course'}.h5lesson`,
  )
  await useEditorStore.getState().activateCourseDocument(created.documentId)
  await useEditorStore.getState().drainCourseDocument()
  return host
}

/** Committed document undo stack. Renderer `history.past` is always empty. */
export function assignedUndoDepth() {
  return useEditorStore.getState().courseDocument.snapshot?.undoDepth ?? 0
}

export function assignedRedoDepth() {
  return useEditorStore.getState().courseDocument.snapshot?.redoDepth ?? 0
}

async function drainSettled() {
  await Promise.resolve()
  await useEditorStore.getState().drainCourseDocument()
}

/** Wait until a fire-and-forget undo/redo has changed the committed stack. */
export async function undoAssignedCourse() {
  const beforeUndo = assignedUndoDepth()
  const beforeRedo = assignedRedoDepth()
  useEditorStore.getState().undo()
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await Promise.resolve()
    try { await useEditorStore.getState().drainCourseDocument() } catch { /* queue still moving */ }
    if (assignedUndoDepth() !== beforeUndo || assignedRedoDepth() !== beforeRedo) return
  }
  throw new Error(`undo did not commit (undo ${beforeUndo}, redo ${beforeRedo})`)
}

export async function redoAssignedCourse() {
  const beforeUndo = assignedUndoDepth()
  const beforeRedo = assignedRedoDepth()
  useEditorStore.getState().redo()
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await Promise.resolve()
    try { await useEditorStore.getState().drainCourseDocument() } catch { /* queue still moving */ }
    if (assignedUndoDepth() !== beforeUndo || assignedRedoDepth() !== beforeRedo) return
  }
  throw new Error(`redo did not commit (undo ${beforeUndo}, redo ${beforeRedo})`)
}

/** Drain after a command that should already be committed. Does not click undo. */
export async function settleAssignedCourse() {
  await drainSettled()
  await drainSettled()
}
