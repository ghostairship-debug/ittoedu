// @vitest-environment node
import { expect, it } from 'vitest'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
import { IMAGE_DEFINITION, createImageData, imageDataSchema } from '../../src/components/image'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseAuthorData, importCourseMediaLibrary, importCourseSounds, insertCourseMedia, replaceCourseImageAtTarget,
  type ImportedAssetBatchItem } from '../../src/renderer/media/commitCourseMediaAuthoring'

function item(id: string, kind: 'image' | 'video' | 'audio' = 'image'): ImportedAssetBatchItem {
  const bytes = new TextEncoder().encode(id)
  return { meta: { id, kind, path: `assets/${id}`, filename: `${id}.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'mp3'}`,
    mimeType: kind === 'image' ? 'image/png' : `${kind}/${kind === 'video' ? 'mp4' : 'mpeg'}`, byteLength: bytes.length,
    ...(kind === 'audio' ? { duration: 65 } : { width: 800, height: 600 }) }, bytes }
}
function fixture() {
  const project = createBlankCourseProjectV10('资源事务'), original = item('original')
  project.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION
  project.assets.original = { ...original.meta, remote: { url: 'https://assets.example.test/original.png' } }
  for (const id of ['A', 'B']) project.instances[id] = { id, definitionId: IMAGE_DEFINITION.id,
    data: courseAuthorData({ ...createImageData('original'), alt: id, flipX: true, fit: 'cover', crop: { left: .1, top: 0, right: 0, bottom: .2 },
      safeAreas: [{ id: 'subject', label: '主体', x: .1, y: .1, width: .8, height: .8 }] }),
    frame: { width: 320, height: 180, transform: [1, 0, 0, 1, id === 'A' ? 40 : 400, 50] } }
  project.surfaces[0].childIds.push('A', 'B')
  return { project, resources: { assets: { original: original.bytes }, components: {} } }
}

it('commits mixed canvas, Global HUD, large library and sounds as resource-bearing transactions with isolated input buffers and reversible archives', async () => {
  const h = await createV10StoreHost(createBlankCourseProjectV10('批量媒体')), image = item('diagram'), video = item('lesson', 'video'), sound = item('rain', 'audio')
  const expected = structuredClone([image, video]), source = { kind: 'asset-library' as const, author: '老师', license: { id: 'CC0' } }
  image.meta.source = source
  try {
    const inserted = await insertCourseMedia(h.kernel, h.kernel.captureTarget(), [image, video], { x: 60, y: 80 })
    expect(inserted.instanceIds).toHaveLength(2); expect(h.first.read().undoDepth).toBe(1)
    expect(h.model().project.instances[inserted.instanceIds[0]].frame).toMatchObject({ width: 480, height: 360, transform: [1, 0, 0, 1, 60, 80] })
    image.bytes.fill(0); image.meta.filename = 'changed.png'; source.author = 'changed'
    expect(h.model().resources.assets.diagram).toEqual(expected[0].bytes)
    expect(h.model().project.assets.diagram).toMatchObject({ filename: 'diagram.png', source: { author: '老师' } })
    const reuse = { meta: { ...h.model().project.assets.diagram, kind: 'image' as const, mimeType: 'image/png', filename: 'diagram.png', byteLength: expected[0].bytes.length }, bytes: expected[0].bytes }
    const duplicates = await insertCourseMedia(h.kernel, h.kernel.captureTarget(), [reuse, reuse], { container: { kind: 'global', plane: 'overlay' } })
    expect(new Set([...inserted.instanceIds, ...duplicates.instanceIds]).size).toBe(4)
    expect(h.model().project.global.overlay).toEqual(expect.arrayContaining(duplicates.instanceIds))
    expect(Object.keys(h.model().project.assets)).toEqual(['diagram', 'lesson']); expect(h.first.read().undoDepth).toBe(2)
    await h.kernel.edit([{ type: 'data.set', instanceId: duplicates.instanceIds[0], path: ['alt'], value: '仅第一副本' }])
    expect(imageDataSchema.parse(h.model().project.instances[duplicates.instanceIds[1]].data).alt).toBe('diagram.png')
    const beforeLibrary = structuredClone(h.model().project.instances), batch = Array.from({ length: 14 }, (_, index) => item(`library-${index}`))
    await importCourseMediaLibrary(h.kernel, h.kernel.captureTarget(), batch)
    expect(h.model().project.instances).toEqual(beforeLibrary); expect(h.first.read().undoDepth).toBe(4)
    const beforeReuse = structuredClone(h.first.read())
    await importCourseMediaLibrary(h.kernel, h.kernel.captureTarget(), batch)
    expect(h.first.read()).toEqual(beforeReuse)
    await importCourseSounds(h.kernel, h.kernel.captureTarget(), [sound])
    expect(h.first.read().undoDepth).toBe(5)
    expect(Object.values(h.model().project.media!.audio.sounds)).toEqual([expect.objectContaining({ assetId: 'rain', name: 'rain' })])
    await h.bridge.save(); const saved = h.driver.load(h.disk.get('saved.glx')!)
    expect(saved).toEqual(h.model())
    await h.bridge.undo(); expect(h.model().project.assets.rain).toBeUndefined(); expect(h.model().resources.assets.rain).toBeUndefined()
    await h.bridge.undo(); expect(batch.every(value => !h.model().project.assets[value.meta.id] && !h.model().resources.assets[value.meta.id])).toBe(true)
    await h.bridge.redo(); await h.bridge.redo()
    expect(h.model().resources).toEqual(saved.resources)
    const all = Object.keys(h.model().project.instances)
    expect(new Set(all).size).toBe(all.length)
  } finally { h.bridge.dispose() }
})

it('replaces frozen image A after selecting B and editing B while preserving authored display and one resource History entry', async () => {
  const f = fixture(), h = await createV10StoreHost(f.project, f.resources)
  try {
    h.kernel.selectInstances(['A']); const target = h.kernel.captureTarget(), a = structuredClone(h.model().project.instances.A)
    h.kernel.selectInstances(['B'])
    await h.kernel.edit([{ type: 'data.set', instanceId: 'B', path: ['alt'], value: '新人工说明' }])
    const b = structuredClone(h.model().project.instances.B), depth = h.first.read().undoDepth, replacement = item('replacement')
    await replaceCourseImageAtTarget(h.kernel, target, replacement)
    expect(h.first.read().undoDepth).toBe(depth + 1)
    expect(h.bridge.read().selectedInstanceId).toBe('B'); expect(h.model().project.instances.B).toEqual(b)
    expect(h.model().project.instances.A.frame).toEqual(a.frame)
    expect(h.model().project.instances.A.data).toEqual({ ...imageDataSchema.parse(a.data), assetId: 'replacement', originalAssetId: 'replacement' })
    expect(h.model().resources.assets.replacement).toEqual(replacement.bytes)
    await h.bridge.undo(); expect(h.model().project.instances.A).toEqual(a); expect(h.model().project.instances.B).toEqual(b)
    expect(h.model().project.assets.replacement).toBeUndefined(); expect(h.model().resources.assets.replacement).toBeUndefined()
    await h.bridge.redo(); await h.bridge.save()
    expect(h.driver.load(h.disk.get('saved.glx')!)).toEqual(h.model())
    expect(h.model().resources.assets.original).toEqual(f.resources.assets.original)
    expect(h.model().project.assets.original.remote).toEqual(f.project.assets.original.remote)
  } finally { h.bridge.dispose() }
})

it('rejects conflicting identities, changed or removed frozen images and closed documents with no resource or History write', async () => {
  const f = fixture(), h = await createV10StoreHost(f.project, f.resources)
  try {
    h.kernel.selectInstances(['A'])
    const original = item('original'), before = structuredClone(h.first.read())
    await importCourseMediaLibrary(h.kernel, h.kernel.captureTarget(), [original])
    expect(h.first.read()).toEqual(before)
    for (const bad of [{ meta: { ...original.meta, filename: 'wrong.png' }, bytes: original.bytes },
      { meta: { ...original.meta, width: 999 }, bytes: original.bytes },
      { meta: { ...original.meta, source: { kind: 'user-material' as const, author: 'different' } }, bytes: original.bytes },
      { meta: original.meta, bytes: new Uint8Array(original.bytes.length) }]) {
      await expect(importCourseMediaLibrary(h.kernel, h.kernel.captureTarget(), [item('must-not-leak'), bad])).rejects.toThrow('素材身份已存在')
      await expect(replaceCourseImageAtTarget(h.kernel, h.kernel.captureTarget(), bad)).rejects.toThrow('素材身份已存在')
      expect(h.first.read()).toEqual(before)
    }
    const duplicate = item('batch-identity')
    await expect(importCourseMediaLibrary(h.kernel, h.kernel.captureTarget(), [duplicate, { ...duplicate, bytes: new Uint8Array(duplicate.bytes.length) }])).rejects.toThrow('素材身份已存在')
    expect(h.first.read()).toEqual(before)
    const changed = h.kernel.captureTarget()
    await h.kernel.edit([{ type: 'data.set', instanceId: 'A', path: ['alt'], value: '人工新值' }])
    let snapshot = structuredClone(h.first.read())
    await expect(replaceCourseImageAtTarget(h.kernel, changed, item('late-change'))).rejects.toThrow()
    expect(h.first.read()).toEqual(snapshot)
    const removed = h.kernel.captureTarget()
    await h.kernel.edit([{ type: 'instance.remove', instanceId: 'A' }])
    snapshot = structuredClone(h.first.read())
    await expect(replaceCourseImageAtTarget(h.kernel, removed, item('late-delete'))).rejects.toThrow()
    expect(h.first.read()).toEqual(snapshot)
    h.kernel.selectInstances(['B']); const closed = h.kernel.captureTarget()
    const second = await h.api.create({ kind: 'course-v10', project: f.project, resources: f.resources }, 'second.glx')
    await h.bridge.activate(second.documentId); await h.bridge.close(h.first.documentId)
    const untouched = structuredClone(h.registry.get(second.documentId).read())
    await expect(replaceCourseImageAtTarget(h.kernel, closed, item('late-close'))).rejects.toThrow()
    expect(h.registry.get(second.documentId).read()).toEqual(untouched)
    const minimal = item('minimal'), project = createBlankCourseProjectV10('已接纳的最小元数据')
    minimal.meta.path = 'assets/minimal.png'
    project.assets.minimal = { id: 'minimal', path: minimal.meta.path, mimeType: minimal.meta.mimeType }
    const third = await h.api.create({ kind: 'course-v10', project, resources: { assets: { minimal: minimal.bytes }, components: {} } }, 'minimal.glx')
    await h.bridge.activate(third.documentId)
    const inserted = await insertCourseMedia(h.kernel, h.kernel.captureTarget(), [minimal])
    const model = h.registry.get(third.documentId).read().model
    if (model.kind !== 'course-v10') throw new Error('Expected a Course V10 document')
    expect(model.project.assets.minimal).toEqual(project.assets.minimal)
    expect(model.project.instances[inserted.instanceIds[0]].frame).toMatchObject({ width: 480, height: 360 })
    expect(model.resources.assets.minimal).toEqual(minimal.bytes)
    const docs = await h.api.list()
    await expect(h.api.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'missing.glx')).rejects.toThrow('工程素材字节缺失')
    expect(await h.api.list()).toEqual(docs)
  } finally { h.bridge.dispose() }
})
