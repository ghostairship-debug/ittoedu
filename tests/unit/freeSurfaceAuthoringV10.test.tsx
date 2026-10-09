import { act, cleanup } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
import { importCourseSounds, insertCourseMedia } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { courseAudioSettings } from '../../src/core/course/courseMediaEdits'
import type { AssetMeta } from '../../src/shared/contracts/media-v1'

afterEach(() => { cleanup(); useEditorStore.getState().cancelTextEdit(); useEditorStore.getState().courseBridge.dispose() })
async function spatialHost() {
  const host = await createCourseDocumentHost()
  await useEditorStore.getState().connectCourseDocuments(host.api)
  await useEditorStore.getState().createCourseDocument('spatial')
  useEditorStore.getState().setEditingScope('scene')
  const documentId = useEditorStore.getState().courseView.activeDocumentId!
  const session = host.registry.get(documentId)
  return { host, documentId, session, kernel: useEditorStore.getState().courseKernel }
}
const asset = (id: string, kind: AssetMeta['kind'], bytes: Uint8Array) => ({ meta: {
  id, kind, filename: `${id}.${kind === 'audio' ? 'mp3' : 'mp4'}`, mimeType: kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
  path: `assets/${id}`, byteLength: bytes.length, width: 640, height: 360,
} satisfies AssetMeta, bytes })

it('imports a Spatial sound batch and resource bytes through the unique Session, rejects mixed batches, and saves/undoes/redoes once', async () => {
  const { host, documentId, session, kernel } = await spatialHost()
  const before = session.read()
  if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
  const valid = asset('voice-a', 'audio', new Uint8Array([1, 2, 3]))
  const invalid = asset('not-audio', 'video', new Uint8Array([4, 5]))
  await expect(importCourseSounds(kernel, kernel.captureTarget(), [valid, invalid])).rejects.toThrow('只接受音频')
  expect(session.read()).toEqual(before)
  await act(async () => { await importCourseSounds(kernel, kernel.captureTarget(), [valid, asset('voice-b', 'audio', new Uint8Array([6, 7]))]) })
  const changed = session.read()
  if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
  const project = changed.model.project
  expect(changed.undoDepth).toBe(1)
  expect(Object.values(courseAudioSettings(project).sounds).map(sound => sound.assetId)).toEqual(['voice-a', 'voice-b'])
  expect(project.surfaces[0].childIds).toEqual([])
  expect(Array.from(changed.model.resources.assets['voice-a'])).toEqual(Array.from(valid.bytes))
  const reopened = host.driver.load(host.driver.serialize(changed.model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project).toEqual(changed.model.project)
  expect(Array.from(reopened.resources.assets['voice-a'])).toEqual(Array.from(valid.bytes))
  await act(async () => { await useEditorStore.getState().courseBridge.undo(documentId) })
  expect(session.read().undoDepth).toBe(0)
  expect(session.read().model).toMatchObject({ project: { ...before.model.project, revision: session.read().revision }, resources: before.model.resources })
  await act(async () => { await useEditorStore.getState().courseBridge.redo(documentId) })
  expect(session.read().model).toMatchObject({ project: { ...changed.model.project, revision: session.read().revision } })
})

it('inserts repeated Spatial video resources in the exact world/global owner with one History entry and retains distinct identities', async () => {
  const { host, documentId, session, kernel } = await spatialHost()
  const original = kernel.readDocument(), surfaceId = kernel.readView().surfaceId!
  const video = asset('clip', 'video', new Uint8Array([0, 0, 0, 1]))
  let world!: Awaited<ReturnType<typeof insertCourseMedia>>, hud!: typeof world
  await act(async () => { world = await insertCourseMedia(kernel, kernel.captureTarget(), [video], { x: 600, y: -400 }) })
  expect(session.read().undoDepth).toBe(1)
  expect(kernel.readDocument().surfaces.find(surface => surface.id === surfaceId)!.childIds).toEqual(world.instanceIds)
  expect(kernel.readDocument().instances[world.instanceIds[0]].frame).toEqual({ width: 480, height: 270, transform: [1, 0, 0, 1, 600, -400] })
  await act(async () => { hud = await insertCourseMedia(kernel, kernel.captureTarget(), [video], { container: { kind: 'global', plane: 'overlay' }, x: 30, y: 40 }) })
  const changed = session.read()
  if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(world.instanceIds[0]).not.toBe(hud.instanceIds[0])
  expect(kernel.readDocument().global.overlay).toEqual([...original.global.overlay, ...hud.instanceIds])
  expect(kernel.readDocument().surfaces.find(surface => surface.id === surfaceId)!.childIds).not.toContain(hud.instanceIds[0])
  expect(kernel.readDocument().instances[hud.instanceIds[0]].frame!.transform.slice(4)).toEqual([30, 40])
  expect(changed.undoDepth).toBe(2)
  expect(Array.from(changed.model.resources.assets.clip)).toEqual(Array.from(video.bytes))
  const reopened = host.driver.load(host.driver.serialize(changed.model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project).toEqual(changed.model.project)
  expect(Array.from(reopened.resources.assets.clip)).toEqual(Array.from(video.bytes))
  await act(async () => { await useEditorStore.getState().courseBridge.undo(documentId) })
  expect(kernel.readDocument().instances[hud.instanceIds[0]]).toBeUndefined()
  expect(kernel.readDocument().instances[world.instanceIds[0]]).toBeDefined()
  expect(Array.from(session.read().model.resources.assets.clip)).toEqual(Array.from(video.bytes))
})

it('keeps Mixed location try-run and session cameras out of author data and History while navigating all three surfaces', async () => {
  const { documentId, session } = await spatialHost()
  await act(async () => { await useEditorStore.getState().addCourseContent('slide-page'); await useEditorStore.getState().addCourseContent('flow-page') })
  const original = session.read()
  await act(async () => { useEditorStore.getState().setCanvasMode('run'); await Promise.resolve() })
  for (const surface of useEditorStore.getState().courseView.project!.surfaces) {
    await act(async () => { useEditorStore.getState().activateCourseLocation(surface.id); await Promise.resolve() })
    expect(useEditorStore.getState().canvasMode).toBe('run')
    if (surface.kind === 'spatial') {
      act(() => { useEditorStore.getState().setSpatialSessionCamera({ x: 900, y: -300, zoom: 2 }); useEditorStore.getState().setSpatialShowCameraFrames(true) })
      expect(useEditorStore.getState().readSpatialView(surface.id, documentId).camera).toEqual({ x: 900, y: -300, zoom: 2 })
    }
  }
  expect(session.read()).toEqual(original)
})

it('rejects captured Spatial camera/path and object callbacks after their author targets change with zero extra History or resource writes', async () => {
  const { session, kernel } = await spatialHost(), store = () => useEditorStore.getState(), surfaceId = store().courseView.surfaceId!
  await act(async () => { await store().addTextNode(); await store().addSpatialCameraFrameFromSession(surfaceId) })
  const textId = kernel.readDocument().surfaces[0].childIds[0], cameraId = kernel.readDocument().surfaces[0].spatial!.frames[0].id
  await act(async () => { await store().addSpatialPath(surfaceId, { title: '巡游', instanceIds: [textId], frameIds: [cameraId] }) })
  const captured = kernel.captureTarget(), pathId = captured.project.surfaces[0].spatial!.paths![0].id
  const object = kernel.capture([{ type: 'data.set', instanceId: textId, path: ['appearance', 'color'], value: '#abcdef' }], captured)
  await act(async () => { await store().renameSpatialCameraFrame(surfaceId, cameraId, '教师重命名'); await store().editComponents([
    { type: 'data.set', instanceId: textId, path: ['appearance', 'color'], value: '#123456' },
  ]) })
  const before = session.read()
  await expect(store().deleteSpatialCameraFrame(surfaceId, cameraId, captured)).rejects.toThrow('已变化')
  await expect(store().updateSpatialPath(surfaceId, pathId, { title: '迟到路径' }, captured)).rejects.toThrow('已变化')
  await expect(kernel.editCaptured(object)).rejects.toThrow('已变化')
  expect(session.read()).toEqual(before)
})
