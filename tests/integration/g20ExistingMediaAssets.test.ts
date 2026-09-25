// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import sharp from 'sharp'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createImageNode, createVideoNode } from '../../src/core/tools/nativeNodeFactories'
import { allocateCourseLayerOrder } from '../../src/core/tools/layerOrder'
import { mutationCallSchema, describeTools } from '../../src/core/tools/ToolCatalog'
import { sceneNodeToCourseLayerItem } from '../../src/shared/courseProjectModel'
import { flowSurfaceIn, resolveFlowBlock } from '../../src/core/tools/flowDocumentModel'
import { locateCourseLayer } from '../../src/core/drivers/course/layerProperties'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV9Driver()
function fixture() {
  const model = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }>
  const mixed = driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/mixed.h5lesson'))) as typeof model
  model.project.surfaces.push(...mixed.project.surfaces.filter(surface => surface.type !== 'slide'))
  model.project.locations.push(...mixed.project.locations.filter(location => location.kind !== 'slide-scene'))
  model.project.mixedPrintPlan = { pageSize: 'surface-native', orientation: 'auto', entries: [
    ...model.project.surfaces.filter(surface => surface.type === 'slide').map(surface => ({ id: `print-${surface.id}`, kind: 'slide-scenes' as const, surfaceId: surface.id, sceneIds: surface.scenes.map(scene => scene.id) })),
    ...mixed.project.mixedPrintPlan!.entries.filter(entry => entry.kind !== 'slide-scenes'),
  ] }
  const webm = new Uint8Array(readFileSync('tests/fixtures/r18CommonTasks/materials/motion.webm'))
  const wave = new Uint8Array(60), view = new DataView(wave.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((letter, i) => { wave[offset + i] = letter.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, 52, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, 16, true)
  for (const id of ['video-a', 'video-b', 'audio-a', 'audio-b']) {
    const video = id.startsWith('video'), bytes = video ? webm : wave
    model.project.assets[id] = { id, filename: `${id}.${video ? 'webm' : 'wav'}`, kind: video ? 'video' : 'audio', mimeType: video ? 'video/webm' : 'audio/wav', path: `assets/${id}.${video ? 'webm' : 'wav'}`, byteLength: bytes.length, duration: 1 }
    model.resources.assets[id] = bytes.slice()
  }
  return model
}
async function harness(model: ReturnType<typeof fixture>) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(model, 'media.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const issue = (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly })
  const invoke = (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input })
  return { registry, session, gateway, issue, invoke, model: () => session.read().model as typeof model }
}
async function imageFixture(model: ReturnType<typeof fixture>) {
  const bytes = new Uint8Array(await sharp({ create: { width: 4, height: 3, channels: 4, background: '#22aa88' } }).png().toBuffer())
  model.project.assets['image-b'] = { id: 'image-b', filename: 'image-b.png', kind: 'image', mimeType: 'image/png', path: 'assets/image-b.png', byteLength: bytes.length, width: 4, height: 3 }
  model.resources.assets['image-b'] = bytes
  return 'image-b'
}
function locations(model: ReturnType<typeof fixture>) {
  const slide = model.project.locations.find(location => location.kind === 'slide-scene')!
  const flow = model.project.surfaces.find(surface => surface.type === 'flow')!
  const flowLocation = model.project.locations.find(location => location.surfaceId === flow.id)!
  const spatial = model.project.surfaces.find(surface => surface.type === 'spatial-2d')!
  const spatialLocation = model.project.locations.find(location => location.surfaceId === spatial.id)!
  return { slide, flow, flowLocation, spatial, spatialLocation }
}

it('inserts existing image/video Native and audio Flow media through read-only asset handles without importing bytes', async () => {
  const model = fixture(), f = await harness(model), l = locations(model)
  const originalImage = Object.values(model.project.assets).find(asset => asset.kind === 'image')!
  const image = await f.issue({ kind: 'course-asset', assetId: originalImage.id }, true)
  const video = await f.issue({ kind: 'course-asset', assetId: 'video-a' }, true)
  const audio = await f.issue({ kind: 'course-asset', assetId: 'audio-a' }, true)
  const slideOwner = await f.issue({ kind: 'course-owner', locationId: l.slide.id, owner: 'scene' })
  const flowOverlay = await f.issue({ kind: 'course-owner', locationId: l.flowLocation.id, owner: 'surface' })
  const spatialOwner = await f.issue({ kind: 'course-owner', locationId: l.spatialLocation.id, owner: 'world' })
  const flowBody = await f.issue({ kind: 'flow-container', surfaceId: l.flow.id, parentId: null, index: flowSurfaceIn(model.project, l.flow.id).blocks.length })
  const before = f.session.read()
  const result = await f.invoke('insert-existing', 'batch', { operations: [
    { name: 'media.insert', input: { target: slideOwner, asset: image, properties: { label: '已有图片', width: 220, height: 130 } } },
    { name: 'media.insert', input: { target: flowOverlay, asset: video, properties: { label: '已有视频' } } },
    { name: 'media.insert', input: { target: spatialOwner, asset: video, properties: { width: 320, height: 180 } } },
    { name: 'media.insert', input: { target: flowBody, asset: audio, flow: { layout: 'wide', caption: { inlines: [{ type: 'text', text: '讲解音频' }] } } } },
  ] })
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (result.kind !== 'document-operation') throw new Error(JSON.stringify(result))
  expect(f.session.read().undoDepth).toBe(1)
  expect(f.model().project.assets).toEqual(before.model.kind === 'course-v9' ? before.model.project.assets : {})
  expect(f.model().resources).toEqual(before.model.resources)
  const created = await Promise.all(result.affected.map(async handle => (await f.gateway.resolveEditTarget('r', handle)).target))
  expect(created.map(target => target.kind)).toEqual(['course-object', 'course-object', 'course-object', 'flow-block'])
  for (const [index, kind, assetId] of [[0, 'image', originalImage.id], [1, 'video', 'video-a'], [2, 'video', 'video-a']] as const) {
    const target = created[index]
    if (target.kind !== 'course-object') throw new Error('Native target')
    expect(locateCourseLayer(f.model().project, target.itemId)?.item).toMatchObject({ content: { nativeType: kind, data: { assetId } } })
  }
  const block = created[3]
  if (block.kind !== 'flow-block') throw new Error('Flow target')
  expect(resolveFlowBlock(f.model().project, block).block).toMatchObject({ type: 'media', mediaKind: 'audio', assetId: 'audio-a', layout: 'wide', caption: { inlines: [{ type: 'text', text: '讲解音频' }] } })
  expect(driver.load(driver.serialize(f.model()))).toEqual(f.model())
  const current = f.session.read()
  await f.session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo-media', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })
  expect(f.model().project.surfaces).toEqual((before.model as typeof model).project.surfaces)
  expect(f.model().project.assets).toEqual((before.model as typeof model).project.assets)
  expect(f.model().resources).toEqual(before.model.resources)
})

it('replaces existing Native, Flow and background media in place, retaining fields and one History', async () => {
  const model = fixture(), newImage = await imageFixture(model), l = locations(model)
  const originalImage = Object.values(model.project.assets).find(asset => asset.kind === 'image' && asset.id !== newImage)!
  if (l.slide.kind !== 'slide-scene') throw new Error('Slide location')
  const slide = model.project.surfaces.find(surface => surface.id === l.slide.surfaceId)!
  if (slide.type !== 'slide') throw new Error('Slide surface')
  const scene = slide.scenes.find(scene => scene.id === l.slide.sceneId)!
  const image = sceneNodeToCourseLayerItem(createImageNode({ id: 'existing-image', assetId: originalImage.id, fit: 'cover', x: 50, y: 70, width: 310, height: 210 }))
  const video = sceneNodeToCourseLayerItem(createVideoNode({ id: 'existing-video', assetId: 'video-a', x: 400, y: 70, width: 300, height: 180 }))
  for (const item of [image, video]) { item.order = allocateCourseLayerOrder(model.project, scene.layerItems.length + 1); scene.layerItems.push(item) }
  const flow = flowSurfaceIn(model.project, l.flow.id)
  for (const [id, mediaKind, assetId] of [['flow-image', 'image', originalImage.id], ['flow-video', 'video', 'video-a'], ['flow-audio', 'audio', 'audio-a']] as const) {
    flow.blocks.push({ id, type: 'media', mediaKind, assetId, layout: 'wide', altText: `保留 ${id}` })
  }
  const f = await harness(model), before = f.session.read()
  const picture = await f.issue({ kind: 'course-asset', assetId: newImage }, true)
  const newVideo = await f.issue({ kind: 'course-asset', assetId: 'video-b' }, true)
  const newAudio = await f.issue({ kind: 'course-asset', assetId: 'audio-b' }, true)
  const targets: ToolTarget[] = [
    { kind: 'course-object', locationId: l.slide.id, itemId: image.layerItemId },
    { kind: 'course-object', locationId: l.slide.id, itemId: video.layerItemId },
    ...(['flow-image', 'flow-video', 'flow-audio'] as const).map(blockId => ({ kind: 'flow-block' as const, surfaceId: l.flow.id, parentId: null, blockId })),
    { kind: 'course-background', owner: 'scene', surfaceId: slide.id, sceneId: scene.id },
  ]
  const handles = await Promise.all(targets.map(target => f.issue(target)))
  const result = await f.invoke('replace-existing', 'batch', { operations: handles.map((target, index) => ({ name: 'media.apply', input: { target, asset: [picture, newVideo, picture, newVideo, newAudio, picture][index] } })) })
  expect(result).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(f.session.read().undoDepth).toBe(1)
  const after = f.model()
  for (const [prior, assetId] of [[image, newImage], [video, 'video-b']] as const) {
    const item = locateCourseLayer(after.project, prior.layerItemId)?.item
    if (item?.kind !== 'native' || prior.kind !== 'native') throw new Error('Native item')
    expect(item).toEqual({ ...prior, content: { ...prior.content, data: { ...prior.content.data, assetId } } })
  }
  for (const [id, assetId] of [['flow-image', newImage], ['flow-video', 'video-b'], ['flow-audio', 'audio-b']] as const) {
    const previous = resolveFlowBlock(model.project, { surfaceId: l.flow.id, parentId: null, blockId: id }).block
    expect(resolveFlowBlock(after.project, { surfaceId: l.flow.id, parentId: null, blockId: id }).block).toEqual({ ...previous, assetId })
  }
  const nextSlide = after.project.surfaces.find(surface => surface.id === slide.id)!
  if (nextSlide.type !== 'slide') throw new Error('Slide surface')
  expect(nextSlide.scenes.find(value => value.id === scene.id)).toMatchObject({ backgroundAssetId: newImage, backgroundMode: 'own' })
  expect(after.project.assets).toEqual(model.project.assets)
  expect(after.resources).toEqual(model.resources)
  expect(driver.load(driver.serialize(after))).toEqual(after)
  const current = f.session.read()
  await f.session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: 'undo-replace', actor: 'human', baseRevision: current.revision, mutation: { type: 'undo' } })
  expect(f.model().project.surfaces).toEqual((before.model as typeof model).project.surfaces)
  expect(f.model().project.assets).toEqual((before.model as typeof model).project.assets)
  expect(f.model().resources).toEqual(before.model.resources)
})

it('rejects forged, stale, cross-document and wrong-carrier asset references atomically', async () => {
  const model = fixture(), f = await harness(model), l = locations(model)
  const asset = await f.issue({ kind: 'course-asset', assetId: 'audio-a' }, true)
  const owner = await f.issue({ kind: 'course-owner', locationId: l.slide.id, owner: 'scene' })
  const background = await f.issue({ kind: 'course-background', owner: 'surface', surfaceId: l.flow.id })
  const flow = await f.issue({ kind: 'flow-container', surfaceId: l.flow.id, parentId: null })
  expect(mutationCallSchema.safeParse({ name: 'media.insert', input: { target: owner, asset, resource: 'both' } }).success).toBe(false)
  expect(JSON.stringify(describeTools(['media.insert'])[0].schema)).toContain('flow')
  expect(await f.invoke('raw-id', 'media.insert', { target: flow, asset: 'audio-a' })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(await f.invoke('audio-native', 'media.insert', { target: owner, asset })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('audio-background', 'media.apply', { target: background, asset })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('native-flow-options', 'media.insert', { target: owner, asset, flow: { layout: 'wide' } })).toMatchObject({ kind: 'error' })
  expect(f.session.read().undoDepth).toBe(0)
  expect(f.model()).toEqual(model)

  const other = await f.registry.create(fixture(), 'other.h5lesson')
  await f.gateway.beginRun({ runId: 'other', actor: 'agent', documents: [{ documentId: other.documentId, writable: [{ kind: 'document' }] }] })
  const foreign = await f.gateway.issueTarget('other', other.documentId, { kind: 'course-asset', assetId: 'video-a' }, { readOnly: true })
  expect(await f.invoke('foreign', 'media.insert', { target: owner, asset: foreign })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  const old = await f.issue({ kind: 'course-asset', assetId: 'video-a' }, true)
  const snapshot = f.session.read(), changed = structuredClone(snapshot.model)
  if (changed.kind !== 'course-v9') throw new Error('Course model')
  changed.resources.assets['video-a'][10] ^= 1
  await f.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-byte-edit', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'command', command: { type: 'course.replace', project: changed.project, resources: changed.resources } } })
  expect(await f.invoke('stale', 'media.insert', { target: owner, asset: old })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(f.session.read().undoDepth).toBe(1)
})
