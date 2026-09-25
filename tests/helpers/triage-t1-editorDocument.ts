import { expect, vi } from 'vitest'
import type { DocumentHistoryEntry, DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ComponentPackageData } from '../../src/shared/componentTypes'
import type { CourseProjectDocument } from '../../src/shared/courseProjectTypes'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { courseViewModel } from '../../src/renderer/documents/CourseDocumentView'
import { freezeCourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'
import { createCourseStoreHost } from './courseStoreHost'

export type CourseStoreHost = Awaited<ReturnType<typeof createCourseStoreHost>>

let host: CourseStoreHost | null = null

/** Connects the real in-memory document host. The renderer Store stays a projection. */
export async function bootCourseStore(): Promise<CourseStoreHost> {
  host = await createCourseStoreHost()
  return host
}

export function courseStoreHost(): CourseStoreHost {
  if (!host) throw new Error('course store host is not booted')
  return host
}

/**
 * Replaces the active course document with `project`. The renderer `loadCourseProject` action is
 * fire-and-forget, so create the document on the host and activate it explicitly instead.
 */
export async function replaceCourseProject(
  project: CourseProjectDocument,
  assetFiles: Record<string, Uint8Array> = {},
  componentPackages: Record<string, ComponentPackageData> = {},
): Promise<void> {
  const created = await courseStoreHost().api.create(
    courseViewModel({
      courseAssetSidecar: freezeCourseAssetSidecar(assetFiles),
      componentPackages,
    }, project),
    `${project.title || 'course'}.h5lesson`,
  )
  await useEditorStore.getState().activateCourseDocument(created.documentId)
  await settleCourse()
}

/**
 * Waits until the formal document session has applied queued commands and the renderer projection
 * shows the same revision. Does not commit view drafts. The renderer projection dispatches its
 * queued commands one after another, so the formal session tail can still be empty while a later
 * command is still waiting in that queue.
 */
export async function settleCourse(): Promise<void> {
  const id = useEditorStore.getState().courseDocument.documentId
  if (!id) throw new Error('expected active Surface session')
  const session = courseStoreHost().registry.get(id)
  for (let attempt = 0; attempt < 2000 && useEditorStore.getState().courseDocument.pending > 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (useEditorStore.getState().courseDocument.pending > 0) throw new Error('课程输入尚未确认')
  await session.drain()
  await vi.waitFor(() => {
    expect(useEditorStore.getState().courseDocument.snapshot?.revision).toBe(session.read().revision)
  })
}

/** Formal main-session snapshot. The renderer projection is only a view of it. */
export function formalSnapshot(): DocumentSnapshot {  const id = useEditorStore.getState().courseDocument.documentId
  if (!id) throw new Error('expected active Surface session')
  return courseStoreHost().registry.get(id).read()
}

/** Formal receipt for "no write happened" assertions: content, revision and both history depths. */
export function formalReceipt(): { revision: number; undoDepth: number; redoDepth: number; model: DocumentSnapshot['model'] } {
  const snapshot = formalSnapshot()
  return { revision: snapshot.revision, undoDepth: snapshot.undoDepth, redoDepth: snapshot.redoDepth, model: snapshot.model }
}

function sessionHistory(): { past: DocumentHistoryEntry[]; future: DocumentHistoryEntry[] } {
  const id = useEditorStore.getState().courseDocument.documentId
  if (!id) throw new Error('expected active Surface session')
  const session = courseStoreHost().registry.get(id) as unknown as {
    state: { past: DocumentHistoryEntry[]; future: DocumentHistoryEntry[] }
  }
  return session.state
}

/** Formal DocumentSession history. Entries are before/after snapshots, not renderer immer patches. */
export function formalHistory(): { past: readonly DocumentHistoryEntry[]; future: readonly DocumentHistoryEntry[] } {
  return sessionHistory()
}

export async function undoCourse(): Promise<void> {
  await settleCourse()
  const before = sessionHistory().past.length
  useEditorStore.getState().undo()
  if (before === 0) {
    await settleCourse()
    return
  }
  await vi.waitFor(() => {
    expect(sessionHistory().past.length).toBe(before - 1)
  })
  await settleCourse()
}

export async function redoCourse(): Promise<void> {
  await settleCourse()
  const before = sessionHistory().future.length
  useEditorStore.getState().redo()
  if (before === 0) {
    await settleCourse()
    return
  }
  await vi.waitFor(() => {
    expect(sessionHistory().future.length).toBe(before - 1)
  })
  await settleCourse()
}
