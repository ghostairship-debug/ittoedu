import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { buildCourseTreeView, planCourseTreeReorder, ScenePanel } from '../../src/renderer/ui/ScenePanel'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { createTextComponentData } from '../../src/components/text/data'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
function course(snapshot: DocumentSnapshot) { if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10'); return snapshot.model.project }

const store = () => useEditorStore.getState()
afterEach(() => { cleanup(); store().cancelTextEdit(); store().courseBridge.dispose() })
async function fixture() {
  const host = await createCourseDocumentHost()
  await store().connectCourseDocuments(host.api)
  await store().addCourseContent('flow-page')
  await store().addCourseContent('spatial-page')
  store().setEditingScope('scene')
  const documentId = store().courseView.activeDocumentId!, session = host.registry.get(documentId)
  const spatialId = store().courseView.surfaceId!
  await store().addTextNode()
  await store().addSpatialCameraFrameFromSession(spatialId)
  const world = store().courseView.project!.surfaces.find(surface => surface.id === spatialId)!
  return { host, documentId, session, spatialId, cameraId: world.spatial!.frames[0].id, cameraTitle: world.spatial!.frames[0].title!, textId: world.childIds[0] }
}

it('keeps page and camera tree targets separate and makes same-owner reorders one undoable operation', async () => {
  const h = await fixture(), project = store().courseView.project!, tree = buildCourseTreeView(project)
  render(<ScenePanel />)
  expect(tree.pages.map(page => page.kind)).toEqual(['slide-page', 'flow-page', 'spatial-page'])
  for (const page of tree.pages) expect(screen.getByLabelText(`拖动“${page.label}”`)).toBeInTheDocument()
  const spatial = tree.pages[2], camera = spatial.children[0].children[0]
  expect(screen.getByLabelText(`拖动“${camera.label}”`)).toBeInTheDocument()
  expect(planCourseTreeReorder(project, tree.pages, camera.id, tree.pages[0].id)).toBeNull()
  const plan = planCourseTreeReorder(project, tree.pages, spatial.id, tree.pages[0].id)
  if (plan?.kind !== 'surfaces') throw new Error('Expected a page reorder')
  const before = h.session.read()
  await act(async () => { expect((await store().reorderCourseSurfaces(plan.surfaceIds)).ok).toBe(true) })
  expect(store().courseView.project!.surfaces.map(surface => surface.id)).toEqual(plan.surfaceIds)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  await act(async () => { await store().courseBridge.undo(h.documentId) })
  expect(h.session.read().model).toMatchObject({ project: { ...course(before), revision: h.session.read().revision }, resources: before.model.resources })
  await act(async () => { fireEvent.click(screen.getByTestId(`spatial-camera-${camera.id}`)) })
  expect(store().readSpatialView(h.spatialId).activeCameraFrameId).toBe(h.cameraId)
  expect(h.session.read().undoDepth).toBe(before.undoDepth)
})

it('deletes a real page only after confirmation, restores it with one Undo, and guards the last page', async () => {
  const h = await fixture(), slide = store().courseView.project!.surfaces[0]
  render(<ScenePanel />)
  const before = h.session.read()
  fireEvent.click(screen.getByRole('button', { name: `删除页面“${slide.title}”` }))
  expect(h.session.read()).toEqual(before)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '删除页面' })); await store().courseBridge.drain() })
  expect(store().courseView.project!.surfaces.some(surface => surface.id === slide.id)).toBe(false)
  expect(h.session.read().undoDepth).toBe(before.undoDepth + 1)
  await act(async () => { await store().courseBridge.undo(h.documentId) })
  expect(h.session.read().model).toMatchObject({ project: { ...course(before), revision: h.session.read().revision }, resources: before.model.resources })
  cleanup()
  await act(async () => { await store().createCourseDocument('slide') })
  render(<ScenePanel />)
  expect(screen.getByRole('button', { name: /删除页面/ })).toBeDisabled()
})

it.each(['page', 'camera'] as const)('rejects a delayed %s delete after its author target changes', async kind => {
  const h = await fixture(), page = store().courseView.project!.surfaces.find(surface => surface.id === h.spatialId)!
  render(<ScenePanel />)
  fireEvent.click(screen.getByRole('button', { name: kind === 'camera' ? `删除镜头“${h.cameraTitle}”` : `删除页面“${page.title}”` }))
  await act(async () => {
    if (kind === 'camera') await store().renameSpatialCameraFrame(h.spatialId, h.cameraId, '并发重命名')
    else await store().renameCourseSurface(h.spatialId, '并发重命名')
  })
  const before = h.session.read()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: kind === 'camera' ? '删除镜头' : '删除页面' })); await store().courseBridge.drain() })
  await waitFor(() => expect(store().errorMessage).toBeTruthy())
  expect(h.session.read()).toEqual(before)
})

it.each(['page', 'camera'] as const)('rejects the delayed %s delete when an unacknowledged content draft opens after the dialog', async kind => {
  const h = await fixture(), page = store().courseView.project!.surfaces.find(surface => surface.id === h.spatialId)!
  render(<ScenePanel />)
  fireEvent.click(screen.getByRole('button', { name: kind === 'camera' ? `删除镜头“${h.cameraTitle}”` : `删除页面“${page.title}”` }))
  act(() => {
    expect(store().beginSlideDataEdit(h.textId, 'canvas')).not.toBeNull()
    store().updateSlideDataDraft(createTextComponentData('尚未提交的教师文字'), true)
  })
  const draft = store().slideContentEdit, before = h.session.read()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: kind === 'camera' ? '删除镜头' : '删除页面' })); await store().courseBridge.drain() })
  expect(h.session.read()).toEqual(before)
  expect(store().slideContentEdit).toBe(draft)
  expect(store().errorMessage).toBeTruthy()
})
