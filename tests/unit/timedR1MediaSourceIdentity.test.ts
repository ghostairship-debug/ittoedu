// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { replaceCourseImageAtTarget, replaceCourseMediaAtTarget, transformCourseImageAtTarget,
  type ImportedAssetBatchItem } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import { AUDIO_DEFINITION, VIDEO_DEFINITION, createAudioData, createVideoData } from '../../src/components/media'
import { decodeImageTransformPng, encodeImageTransformPng } from '../../src/shared/imageTransform'
import type { ComponentDefinition, CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentResources } from '../../src/shared/workbench/document'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
function customized(definition: ComponentDefinition): ComponentDefinition {
  return { ...structuredClone(definition), id: `library-${definition.id}`, professionalBuiltinKey: definition.id,
    implementation: { kind: 'source', language: 'javascript', source: 'export default { mount(context) { context.root.textContent = "custom source"; } };' } }
}
async function setup(project: CourseProjectV10, resources: DocumentResources) {
  const directory = await mkdtemp(path.join(tmpdir(), 'guoling-r1-source-media-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources }, '专业源码媒体.h5lesson')
  const unavailable = async (): Promise<never> => { throw new Error('No dialog in fixture') }
  const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => initial,
    saveWithDialog: unavailable, closeWithDialog: unavailable, discardRecovery: unavailable,
    close: async (documentId, discardDirty) => { await host.operate({ type: 'close', documentId, discardDirty }) },
    subscribe: listener => host.subscribeEvents(listener) }
  const bridge = new CourseV10DocumentBridge()
  cleanup.push(async () => bridge.dispose())
  await bridge.connect(api)
  return { bridge, documentId: initial.documentId, kernel: createEditorStoreKernel({ bridge, commit() {} }) }
}
const frame = { width: 243, height: 119, transform: [1, .2, 0, 1, 31, 49] as [number, number, number, number, number, number] }
function imported(id: string, kind: 'image' | 'audio' | 'video', bytes: Uint8Array): ImportedAssetBatchItem {
  const extension = kind === 'image' ? 'png' : kind === 'audio' ? 'ogg' : 'mp4'
  return { meta: { id, kind, filename: `${id}.${extension}`, path: `assets/${id}.${extension}`,
    mimeType: `${kind}/${extension}`, byteLength: bytes.byteLength }, bytes }
}

it('replaces and transforms a customized professional image without replacing source, frame or captured state', async () => {
  const project = createBlankCourseProjectV10('定制图片续编辑'), surface = project.surfaces[0]
  const definition = customized(IMAGE_DEFINITION)
  project.definitions[definition.id] = definition
  const data = { ...createImageData('original', '原图说明'), fit: 'cover' as const,
    crop: { left: .1, top: 0, right: .2, bottom: 0 }, flipX: true }
  const stateData = { ...data, alt: '命名态人工说明' }
  project.instances.image = { id: 'image', definitionId: definition.id, data, frame }
  project.instances.neighbor = { id: 'neighbor', definitionId: definition.id, data: createImageData('original') }
  surface.childIds = ['image', 'neighbor']
  surface.presentation = { initialStateId: 'question', states: [{ id: 'question', title: '提问', overrides: { image: { data: stateData } } }] }
  const originalBytes = encodeImageTransformPng({ width: 1, height: 1, data: Uint8Array.from([0, 0, 255, 255]) })
  const replacementBytes = encodeImageTransformPng({ width: 1, height: 1, data: Uint8Array.from([255, 0, 0, 127]) })
  const replacement = imported('replacement', 'image', replacementBytes)
  project.assets.original = { ...imported('original', 'image', originalBytes).meta }
  const { bridge, documentId, kernel } = await setup(project, { assets: { original: originalBytes }, components: {} })
  bridge.selectInstances(documentId, ['image'], surface.id)
  bridge.selectPresentationState(documentId, 'question', surface.id)
  const original = kernel.captureTarget()
  // The captured image remains the replacement target after browsing a sibling.
  bridge.selectInstances(documentId, ['neighbor'], surface.id)
  await replaceCourseImageAtTarget(kernel, original, replacement)
  const replaced = bridge.captureTarget(documentId)
  const replacedData = { ...stateData, assetId: replacement.meta.id, originalAssetId: replacement.meta.id }
  expect(replaced.editingProject.instances.image.data).toEqual(replacedData)
  expect(replaced.project.instances.image.data).toEqual(data)
  expect(replaced.project.instances.image.frame).toEqual(frame)
  expect(replaced.project.definitions[definition.id]).toEqual(definition)
  expect(replaced.project.instances.image.definitionId).toBe(definition.id)
  expect(replaced.project.instances.neighbor).toEqual(project.instances.neighbor)
  expect(replaced.resources.assets.original).toEqual(originalBytes)
  expect(replaced.resources.assets.replacement).toEqual(replacementBytes)
  expect(bridge.read().snapshot?.undoDepth).toBe(1)
  bridge.selectInstances(documentId, ['image'], surface.id)
  const transform = transformCourseImageAtTarget(kernel, kernel.captureTarget(),
    [{ kind: 'replace-color', sourceColor: '#ff0000', targetColor: '#00ff00', tolerance: 0 }])
  bridge.selectInstances(documentId, ['neighbor'], surface.id)
  await transform
  const transformed = bridge.captureTarget(documentId), edited = imageDataSchema.parse(transformed.editingProject.instances.image.data)
  expect(edited).toEqual({ ...replacedData, assetId: expect.any(String) })
  expect(edited.assetId).not.toBe('replacement')
  expect([...decodeImageTransformPng(transformed.resources.assets[edited.assetId]).data]).toEqual([0, 255, 0, 127])
  expect(transformed.project.instances.image.data).toEqual(data)
  expect(transformed.project.instances.image.frame).toEqual(frame)
  expect(transformed.project.definitions[definition.id]).toEqual(definition)
  expect(transformed.project.instances.neighbor).toEqual(project.instances.neighbor)
  expect(transformed.resources.assets.replacement).toEqual(replacementBytes)
  expect(bridge.read().snapshot?.undoDepth).toBe(2)
  await bridge.undo(documentId)
  const undoTransform = bridge.captureTarget(documentId)
  expect(undoTransform.editingProject.instances.image.data).toEqual(replacedData)
  expect(undoTransform.resources.assets[edited.assetId]).toBeUndefined()
  await bridge.undo(documentId)
  const undoReplace = bridge.captureTarget(documentId)
  expect(undoReplace.editingProject.instances.image.data).toEqual(stateData)
  expect(undoReplace.resources.assets.replacement).toBeUndefined()
  expect(undoReplace.resources.assets.original).toEqual(originalBytes)
  expect(undoReplace.project.definitions[definition.id]).toEqual(definition)
})

it.each(['audio', 'video'] as const)('replaces customized professional %s using the same media predicate and one formal undo', async kind => {
  const project = createBlankCourseProjectV10('定制播放媒体'), surface = project.surfaces[0]
  const definition = customized(kind === 'audio' ? AUDIO_DEFINITION : VIDEO_DEFINITION)
  project.definitions[definition.id] = definition
  const data = kind === 'audio'
    ? { ...createAudioData('original', '人工旁白'), volume: .35, loop: true, startTime: 2, endTime: 8 }
    : { ...createVideoData('original', '人工视频'), volume: .35, loop: true, startTime: 2, endTime: 8, fit: 'cover' as const }
  project.instances.media = { id: 'media', definitionId: definition.id, data, frame }
  project.instances.neighbor = { id: 'neighbor', definitionId: definition.id, data }
  surface.childIds = ['media', 'neighbor']
  const originalBytes = Uint8Array.from([1, 2, 3]), replacement = imported('replacement', kind, Uint8Array.from([4, 5, 6]))
  project.assets.original = { ...imported('original', kind, originalBytes).meta }
  const { bridge, documentId, kernel } = await setup(project, { assets: { original: originalBytes }, components: {} })
  bridge.selectInstances(documentId, ['media'], surface.id)
  const target = kernel.captureTarget()
  bridge.selectInstances(documentId, ['neighbor'], surface.id)
  await replaceCourseMediaAtTarget(kernel, target, replacement)
  const replaced = bridge.captureTarget(documentId)
  expect(replaced.project.instances.media).toEqual({ ...project.instances.media, data: { ...data, assetId: 'replacement' } })
  expect(replaced.project.instances.neighbor).toEqual(project.instances.neighbor)
  expect(replaced.project.definitions[definition.id]).toEqual(definition)
  expect(replaced.resources.assets.original).toEqual(originalBytes)
  expect(replaced.resources.assets.replacement).toEqual(replacement.bytes)
  expect(bridge.read().snapshot?.undoDepth).toBe(1)
  // A different media kind still rejects before adding resources or changing author data.
  const mismatched = imported('wrong-kind', kind === 'audio' ? 'video' : 'audio', Uint8Array.from([7]))
  await expect(replaceCourseMediaAtTarget(kernel, target, mismatched)).rejects.toThrow('同类型')
  expect(bridge.captureTarget(documentId).resources.assets['wrong-kind']).toBeUndefined()
  expect(bridge.read().snapshot?.undoDepth).toBe(1)
  await bridge.undo(documentId)
  const undone = bridge.captureTarget(documentId)
  expect(undone.project.instances.media).toEqual(project.instances.media)
  expect(undone.resources.assets.replacement).toBeUndefined()
  expect(undone.resources.assets.original).toEqual(originalBytes)
  expect(undone.project.definitions[definition.id]).toEqual(definition)
})
