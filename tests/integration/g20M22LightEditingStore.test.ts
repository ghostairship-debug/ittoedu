// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { createSlideLightEditingPort } from '../../src/renderer/composition/selection/slideLightEditingPort'
import { insertCoursePreparedMedia } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseDocumentHost, deferred } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
afterEach(() => store().courseBridge.dispose())
async function fixture() {
  const host = await createCourseDocumentHost(); await store().connectCourseDocuments(host.api)
  const project = createBlankCourseProjectV10('轻编辑'), page = project.surfaces[0]
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  for (const id of ['text', 'neighbor']) project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))), frame: { width: 200, height: 80, transform: [1, 0, 0, 1, id === 'text' ? 40 : 340, 60] } }
  page.childIds = ['text', 'neighbor']; page.presentation = { initialStateId: 'base', states: [{ id: 'base', title: '初始', overrides: {} }, { id: 'named', title: '展开', overrides: {} }] }
  project.surfaces.push({ ...structuredClone(page), id: 'other-page', childIds: [] })
  await store().createCourseDocumentFrom(project); store().selectNode('text')
  const documentId = store().courseView.activeDocumentId!, session = host.registry.get(documentId)
  const controls: { choose?: () => Promise<void> } = {}
  const audio = { asset: { id: 'm22-wav', filename: 'click.wav', mimeType: 'audio/wav', kind: 'audio' as const, path: 'assets/click.wav', byteLength: 44 }, bytes: new Uint8Array(44) }
  const port = createSlideLightEditingPort({ kernel: store().courseKernel, chooseAudio: async () => { await controls.choose?.(); return audio },
    placeAudio: async (target, selected) => { await insertCoursePreparedMedia(store().courseKernel, target, selected) } })
  return { host, session, documentId, project, pageId: page.id, controls, port }
}

it('commits actual object, empty-page background and audio actions once each, preserves neighbors, and reopens and undoes the resulting bytes', async () => {
  const f = await fixture(), target = f.port.captureObject()!, before = f.session.read()
  const opacity = f.port.viewObject(target).commands.find(value => value.id === 'slide.opacity.50')!
  await f.port.runObject(target, opacity)
  expect(store().courseView.project!.instances.text.style?.opacity).toBe(.5)
  expect(f.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(store().courseView.project!.instances.neighbor).toEqual(f.project.instances.neighbor)
  expect(store().courseView.project!.instances.text.frame).toEqual(f.project.instances.text.frame)
  await store().courseBridge.undo(f.documentId); expect(store().courseView.project!.instances.text.style?.opacity).toBeUndefined()
  await store().courseBridge.redo(f.documentId)
  store().selectNode(null)
  expect(f.port.captureObject()).toBeNull()
  const page = f.port.capturePage()!, background = f.port.viewPage(page).commands.find(value => value.id === 'slide.background.dbeafe')!
  await f.port.runPage(page, background)
  expect(store().courseView.project!.surfaces[0].background?.color).toBe('#dbeafe')
  expect(f.session.read().undoDepth).toBe(before.undoDepth + 2)
  await f.port.placeAudio(f.port.capturePage()!)
  const saved = f.session.read(); if (saved.model.kind !== 'course-v10') throw new Error('Expected V10')
  const audioId = store().courseView.selectedInstanceId!
  expect(saved.undoDepth).toBe(before.undoDepth + 3)
  expect(saved.model.project.instances[audioId].data).toMatchObject({ assetId: 'm22-wav' })
  expect(saved.model.resources.assets['m22-wav']).toHaveLength(44)
  expect(f.host.driver.load(f.host.driver.serialize(saved.model))).toEqual(saved.model)
  await store().courseBridge.undo(f.documentId)
  expect(store().courseView.project!.instances[audioId]).toBeUndefined()
  expect(f.session.read().undoDepth).toBe(before.undoDepth + 2)
})

it('rejects stale object menus after selection, page, document, epoch or pending ACK changes, while rebasing unrelated edits', async () => {
  const f = await fixture(), target = f.port.captureObject()!, command = f.port.viewObject(target).commands.find(value => value.id === 'slide.opacity.50')!
  store().selectNode('neighbor'); const before = f.session.read()
  await expect(f.port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  expect(f.session.read()).toEqual(before)
  store().selectNode('text'); store().courseBridge.selectPresentationState(f.documentId, 'named')
  await expect(f.port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  expect(f.session.read()).toEqual(before)
  store().courseBridge.selectPresentationState(f.documentId, null)
  store().selectNode('text'); store().courseBridge.selectSurface(f.documentId, 'other-page')
  await expect(f.port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  store().courseBridge.selectSurface(f.documentId, f.pageId); store().selectNode('text')
  await store().createCourseDocument('slide')
  await expect(f.port.runObject(target, command)).rejects.toThrow('选择或文档已改变')
  await store().activateCourseDocument(f.documentId); store().selectNode('text')
  const pending = deferred(), entered = deferred()
  f.host.controls.beforeAppend = async () => { entered.resolve(); await pending.promise }
  const write = store().editComponents([{ type: 'data.set', instanceId: 'neighbor', path: ['appearance', 'color'], value: '#abcdef' }])
  await entered.promise; expect(f.port.captureObject()).toBeNull(); expect(f.port.capturePage()).toBeNull()
  const delayed = f.port.runObject(target, command)
  pending.resolve(); await write
  await expect(delayed).rejects.toThrow('选择或文档已改变')
  expect(f.session.read().undoDepth).toBe(before.undoDepth + 1)
  expect(store().courseView.project!.instances.text.style?.opacity).toBeUndefined()
  f.host.controls.beforeAppend = undefined
  // A teacher edit of another object does not invalidate this object's captured command.
  await f.port.runObject(target, command)
  expect(store().courseView.project!.instances.text.style?.opacity).toBe(.5)
  expect(store().courseView.project!.instances.neighbor.data).toMatchObject({ appearance: { color: '#abcdef' } })
  const stale = f.port.captureObject()!, staleCommand = f.port.viewObject(stale).commands.find(value => value.id === 'slide.opacity.75')!
  await store().closeCourseDocument(f.documentId); await f.host.api.restore(f.documentId); await store().activateCourseDocument(f.documentId); store().selectNode('text')
  const restored = f.host.registry.get(f.documentId).read()
  await expect(f.port.runObject(stale, staleCommand)).rejects.toThrow('选择或文档已改变')
  expect(f.host.registry.get(f.documentId).read().revision).toBe(restored.revision)
})

it('rejects late audio selections after switching page/document or restoring an epoch without writing resources to either document', async () => {
  for (const change of ['selection', 'state', 'page', 'document', 'epoch'] as const) {
    const f = await fixture(); store().selectNode(null)
    const target = f.port.capturePage()!, original = f.session.read()
    f.controls.choose = async () => {
      if (change === 'selection') store().selectNode('text')
      else if (change === 'state') store().courseBridge.selectPresentationState(f.documentId, 'named')
      else if (change === 'page') store().courseBridge.selectSurface(f.documentId, 'other-page')
      else if (change === 'document') await store().createCourseDocument('slide')
      else { await store().closeCourseDocument(f.documentId); await f.host.api.restore(f.documentId); await store().activateCourseDocument(f.documentId) }
    }
    await expect(f.port.placeAudio(target)).rejects.toThrow('选择或文档已改变')
    const current = f.host.registry.get(f.documentId).read()
    expect(current.revision).toBe(original.revision); expect(current.undoDepth).toBe(original.undoDepth)
    expect(current.model.resources.assets['m22-wav']).toBeUndefined()
    expect(store().courseView.snapshot!.model.resources.assets['m22-wav']).toBeUndefined()
    store().courseBridge.dispose()
  }
})

it('keeps locked commands visible with their reason and refuses their writes', async () => {
  const f = await fixture()
  await store().editComponents([{ type: 'instance.patch', instanceId: 'text', patch: { locked: true } }])
  const target = f.port.captureObject()!, command = f.port.viewObject(target).commands.find(value => value.id === 'slide.opacity.50')!, before = f.session.read()
  expect(command.disabledReason).toContain('锁定')
  await expect(f.port.runObject(target, command)).rejects.toThrow('锁定')
  expect(f.session.read()).toEqual(before)
})
