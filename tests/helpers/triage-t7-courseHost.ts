import { courseViewModel } from '../../src/renderer/documents/CourseDocumentView'
import { freezeCourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { createCourseStoreHost } from './courseStoreHost'

export type TriageCourseHost = Awaited<ReturnType<typeof createCourseStoreHost>>

/** Connect the real document kernel. The startup document is only a bootstrap. */
export async function bootTriageCourseHost(): Promise<TriageCourseHost> {
  return createCourseStoreHost()
}

/**
 * Open `project` as the active course through DocumentSession.
 * Asset bytes and component packages are the formal resources, not empty placeholders.
 */
export async function projectCourse(
  host: TriageCourseHost,
  project: CourseProjectDocument,
  assetFiles: Record<string, Uint8Array> = {},
  componentPackages: Record<string, ComponentPackageData> = {},
): Promise<string> {
  const model = courseViewModel(
    { courseAssetSidecar: freezeCourseAssetSidecar(assetFiles), componentPackages },
    structuredClone(project),
  )
  const created = await host.api.create(model, `${project.title || 'course'}.h5lesson`)
  await useEditorStore.getState().activateCourseDocument(created.documentId)
  await useEditorStore.getState().drainCourseDocument()
  return created.documentId
}

export function formalCourse(host: TriageCourseHost, documentId?: string | null): DocumentSnapshot {
  const id = documentId ?? useEditorStore.getState().courseDocument.documentId
  if (!id) throw new Error('Expected an active course document')
  return host.registry.get(id).read()
}

export function formalProject(host: TriageCourseHost, documentId?: string | null): CourseProjectDocument {
  const snapshot = formalCourse(host, documentId)
  if (snapshot.model.kind !== 'course-v9') throw new Error('Expected a course document')
  return snapshot.model.project
}

/** DocumentSession revision only moves forward, including undo and redo. */
export function projectBody(project: CourseProjectDocument): CourseProjectDocument {
  const next = structuredClone(project)
  next.revision = 0
  next.updatedAt = ''
  return next
}

/** Wait until the optimistic projection has been acknowledged by DocumentSession. */
export async function settleCourse(): Promise<void> {
  await useEditorStore.getState().drainCourseDocument()
}

async function waitForHistory(
  host: TriageCourseHost,
  direction: 'undo' | 'redo',
): Promise<void> {
  const beforeDepth = formalCourse(host).undoDepth
  const beforeRedo = formalCourse(host).redoDepth
  const beforeGeneration = useEditorStore.getState().courseAuthoringSession?.token.generation ?? -1
  useEditorStore.getState()[direction]()
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const snapshot = formalCourse(host)
    const generation = useEditorStore.getState().courseAuthoringSession?.token.generation ?? -1
    const moved = direction === 'undo'
      ? snapshot.undoDepth < beforeDepth && snapshot.redoDepth > beforeRedo
      : snapshot.undoDepth > beforeDepth && snapshot.redoDepth < beforeRedo
    if (moved && generation > beforeGeneration) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`${direction} did not reach the document session`)
}

export function undoCourse(host: TriageCourseHost): Promise<void> {
  return waitForHistory(host, 'undo')
}

export function redoCourse(host: TriageCourseHost): Promise<void> {
  return waitForHistory(host, 'redo')
}
