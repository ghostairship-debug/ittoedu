// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { duplicateSurfaceEdits } from '../../src/renderer/store/slices/courseStructureSlice'
import { transformCourseImageAtTarget } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import { SHAPE_DEFINITION, defaultShapeData } from '../../src/components/shape/authoring'
import { decodeImageTransformPng, encodeImageTransformPng } from '../../src/shared/imageTransform'
import { isComponentVisibleAtSurface, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentResources } from '../../src/shared/workbench/document'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
async function setup(project: CourseProjectV10, resources: DocumentResources = { assets: {}, components: {} }) {
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-a0-captured-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources }, '捕获目标.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('No dialog in fixture') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => initial,
    saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    subscribe: listener => host.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge()
  cleanup.push(async () => bridge.dispose())
  await bridge.connect(api)
  return { bridge, host, directory, documentId: initial.documentId, kernel: createEditorStoreKernel({ bridge, commit() {} }) }
}

it('copies page scopes in the same formal undo entry while keeping global decorations shared', async () => {
  const project = createBlankCourseProjectV10('复制作用域')
  const sourceId = project.surfaces[0].id
  project.surfaces.push({ id: 'other', title: '不引用母版的页', kind: 'slide', childIds: [] })
  project.definitions[SHAPE_DEFINITION.id] = SHAPE_DEFINITION
  for (const [id, mode] of [['included', 'include'], ['excluded', 'exclude'], ['local', 'include']] as const) {
    project.instances[id] = { id, definitionId: SHAPE_DEFINITION.id, data: JSON.parse(JSON.stringify(defaultShapeData())),
      visibility: { mode, surfaceIds: [sourceId] } }
  }
  project.global.underlay = ['included', 'excluded']
  project.surfaces[0].childIds = ['local']
  const { bridge, kernel } = await setup(project)
  const copied = duplicateSurfaceEdits(kernel.readDocument(), sourceId)
  await kernel.editCaptured(kernel.capture(copied.edits))
  const after = kernel.readDocument(), copiedSurface = after.surfaces.find(surface => surface.id === copied.surfaceId)!
  expect(after.global.underlay).toEqual(['included', 'excluded'])
  expect(Object.keys(after.instances)).toHaveLength(Object.keys(project.instances).length + 1)
  expect(after.instances.included.visibility?.surfaceIds).toEqual([sourceId, copied.surfaceId])
  expect(after.instances.excluded.visibility?.surfaceIds).toEqual([sourceId, copied.surfaceId])
  expect(isComponentVisibleAtSurface(after.instances.included, copied.surfaceId)).toBe(true)
  expect(isComponentVisibleAtSurface(after.instances.excluded, copied.surfaceId)).toBe(false)
  expect(isComponentVisibleAtSurface(after.instances.included, 'other')).toBe(false)
  expect(after.instances[copiedSurface.childIds[0]].visibility?.surfaceIds).toEqual([copied.surfaceId])
  expect(bridge.read().snapshot?.undoDepth).toBe(1)
  await bridge.undo()
  expect(kernel.readDocument().surfaces.map(surface => surface.id)).toEqual(project.surfaces.map(surface => surface.id))
  expect(kernel.readDocument().instances.included.visibility?.surfaceIds).toEqual([sourceId])
  expect(kernel.readDocument().instances.excluded.visibility?.surfaceIds).toEqual([sourceId])
})

it('binds a pixel transform to its captured document and named state, preserving original bytes and undoing resource plus data together', async () => {
  const project = createBlankCourseProjectV10('图片像素变换')
  const surface = project.surfaces[0]
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  const data = createImageData('original', '原图'), frame = { width: 200, height: 100,
    transform: [1, .2, 0, 1, 30, 40] as [number, number, number, number, number, number] }
  project.instances.selected = { id: 'selected', definitionId: IMAGE_DEFINITION.id, data, frame }
  project.instances.neighbor = { id: 'neighbor', definitionId: IMAGE_DEFINITION.id, data: createImageData('original') }
  surface.childIds = ['selected', 'neighbor']
  surface.presentation = { initialStateId: 'reveal', states: [{ id: 'reveal', title: '揭示',
    overrides: { selected: { data: { ...data, alt: '命名态图片', crop: { left: .1, top: 0, right: 0, bottom: 0 } } } } }] }
  const bytes = encodeImageTransformPng({ width: 2, height: 1, data: Uint8Array.from([255, 0, 0, 127, 0, 0, 255, 255]) })
  project.assets.original = { id: 'original', path: 'assets/original.png', filename: '原件.png', mimeType: 'image/png' }
  const { bridge, kernel, host, directory, documentId } = await setup(project, { assets: { original: bytes }, components: {} })
  bridge.selectInstances(documentId, ['selected'], surface.id)
  bridge.selectPresentationState(documentId, 'reveal', surface.id)
  const target = kernel.captureTarget()
  const transformed = transformCourseImageAtTarget(kernel, target, [{ kind: 'replace-color', sourceColor: '#ff0000', targetColor: '#00ff00', tolerance: 0 }])
  // Browsing another instance/document cannot redirect the pending operation.
  await bridge.create()
  const otherDocumentId = bridge.read().activeDocumentId
  expect(otherDocumentId).not.toBe(documentId)
  await transformed
  expect(bridge.read().activeDocumentId).toBe(otherDocumentId)
  const captured = bridge.captureTarget(documentId), edited = imageDataSchema.parse(captured.editingProject.instances.selected.data)
  expect(edited.alt).toBe('命名态图片')
  expect(edited.originalAssetId).toBe('original')
  expect(edited.assetId).not.toBe('original')
  expect(captured.project.instances.selected.data).toEqual(data)
  expect(captured.project.instances.neighbor.data).toEqual(project.instances.neighbor.data)
  expect(captured.project.instances.selected.frame).toEqual(frame)
  expect(captured.resources.assets.original).toEqual(bytes)
  expect([...decodeImageTransformPng(captured.resources.assets[edited.assetId]).data]).toEqual([0, 255, 0, 127, 0, 0, 255, 255])
  const filename = path.join(directory, '图片像素变换.h5lesson')
  await host.internalAPI.save(documentId, filename)
  const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
  if (reopened.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.model.resources.assets[edited.assetId]).toEqual(captured.resources.assets[edited.assetId])
  expect(reopened.model.project.surfaces[0].presentation?.states[0].overrides.selected.data).toEqual(edited)
  await bridge.undo(documentId)
  const undone = bridge.captureTarget(documentId)
  expect(undone.resources.assets[edited.assetId]).toBeUndefined()
  expect(undone.resources.assets.original).toEqual(bytes)
  expect(undone.editingProject.instances.selected.data).toEqual(target.editingProject.instances.selected.data)
})
