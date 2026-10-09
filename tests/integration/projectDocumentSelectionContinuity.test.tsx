// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { useEditorStore } from '@/renderer/store/editorStore'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
afterEach(() => store().courseBridge.dispose())
it('chooses a surviving surface after removing the active page and keeps selection valid through Undo/Redo', async () => {
  const h = await createCourseDocumentHost()
  await store().connectCourseDocuments(h.api)
  const original = structuredClone(store().courseView.project!)
  const first = original.surfaces[0].id
  await store().editComponents([{ type: 'surface.insert', index: 1, surface: { id: 'flow', kind: 'flow', title: '讲义', childIds: [] } }])
  const before = store().courseView.snapshot!, documentId = store().courseView.activeDocumentId!
  expect(store().courseView.surfaceId).toBe(first)
  await store().editComponents([{ type: 'surface.remove', surfaceId: first }])
  expect(store().courseView.surfaceId).toBe('flow')
  expect(store().courseView.selectedInstanceIds).toEqual([])
  expect(store().courseView.snapshot!.undoDepth).toBe(before.undoDepth + 1)
  await store().courseBridge.undo(documentId)
  expect(store().courseView.project!.surfaces).toEqual(before.model.kind === 'course-v10' ? before.model.project.surfaces : [])
  expect(store().courseView.project!.surfaces.some(surface => surface.id === store().courseView.surfaceId)).toBe(true)
  await store().courseBridge.redo(documentId)
  expect(store().courseView.surfaceId).toBe('flow')
  expect(store().courseView.project!.surfaces.map(surface => surface.id)).toEqual(['flow'])
})
