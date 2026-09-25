import { vi } from 'vitest'
import { createCourseStoreHost } from './courseStoreHost'
import { selectActiveCourseProjectDocument, useEditorStore } from '@/renderer/store/editorStore'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { ComponentPackageData } from '@/shared/componentTypes'

export type CourseHost = Awaited<ReturnType<typeof createCourseStoreHost>>

/** Renderer history is a cursor. Formal undo depth lives on the document session. */
export function formalCourse(host: CourseHost, documentId: string) {
  return host.registry.get(documentId).read()
}

export function activeDocumentId(): string {
  const documentId = useEditorStore.getState().courseDocument.documentId
  if (!documentId) throw new Error('course document is not active')
  return documentId
}

/** Blank connected Slide document. Replaces a synchronous createNewProject(). */
export async function connectCourseHost() {
  const host = await createCourseStoreHost()
  return { host, documentId: activeDocumentId() }
}

/**
 * Open `project` as the formal document.
 * Pass assetFiles/componentPackages when the test needs those exact bytes;
 * host.open otherwise zero-fills asset bytes and only knows the default controller.
 */
export async function openCourseOnHost(
  project: CourseProjectDocument,
  extras?: {
    assetFiles?: Record<string, Uint8Array>
    componentPackages?: Record<string, ComponentPackageData>
  },
) {
  const host = await createCourseStoreHost()
  const custom = Boolean(
    (extras?.assetFiles && Object.keys(extras.assetFiles).length)
    || (extras?.componentPackages && Object.keys(extras.componentPackages).length),
  )
  if (!custom) {
    try {
      await host.open(project)
      if (selectActiveCourseProjectDocument(useEditorStore.getState())?.id === project.id) {
        return { host, documentId: activeDocumentId() }
      }
    } catch {
      // Unknown component bytes or archive rejection: create from the caller payload.
    }
  }
  useEditorStore.getState().loadCourseProject(
    project,
    null,
    extras?.assetFiles ?? {},
    extras?.componentPackages ?? {},
  )
  await vi.waitFor(() => {
    const current = selectActiveCourseProjectDocument(useEditorStore.getState())
    if (!current || current.id !== project.id) throw new Error(`waiting for ${project.id}`)
  })
  await useEditorStore.getState().drainCourseDocument()
  return { host, documentId: activeDocumentId() }
}

export async function settleCourse() {
  return useEditorStore.getState().drainCourseDocument()
}

/** DocumentSession revision only increases. Compare authored content without that stamp. */
export function courseContent<T extends { revision: number; updatedAt: string }>(project: T) {
  const { revision: _revision, updatedAt: _updatedAt, ...content } = project
  return content
}

export async function undoSettled(host: CourseHost, documentId: string) {
  const before = formalCourse(host, documentId).undoDepth
  useEditorStore.getState().undo()
  await vi.waitFor(() => {
    const depth = formalCourse(host, documentId).undoDepth
    if (depth !== before - 1) throw new Error(`undo pending ${depth} vs ${before}`)
  })
  await useEditorStore.getState().drainCourseDocument()
}

export async function redoSettled(host: CourseHost, documentId: string) {
  const before = formalCourse(host, documentId).undoDepth
  useEditorStore.getState().redo()
  await vi.waitFor(() => {
    const depth = formalCourse(host, documentId).undoDepth
    if (depth !== before + 1) throw new Error(`redo pending ${depth} vs ${before}`)
  })
  await useEditorStore.getState().drainCourseDocument()
}
