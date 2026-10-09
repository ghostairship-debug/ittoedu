// @vitest-environment node
import { readFileSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { mediaFileInput } from '../../src/main/workbench/admittedMediaResource'
import { createImageData } from '../../src/components/image/data'
import { createAudioData, createVideoData } from '../../src/components/media/data'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { mutationCallSchema } from '../../src/core/tools/ToolCatalog'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver(), roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
function fixture() {
  const project = createBlankCourseProjectV10('Existing media'), slideId = project.surfaces[0].id
  project.surfaces.push({ id: 'flow', kind: 'flow', title: 'Flow', childIds: [], flow: { layout: { widthMode: 'fluid', readingWidth: 860, wideContentWidth: 1100 } } },
    { id: 'space', kind: 'spatial', title: 'Spatial', childIds: [] })
  for (const key of ['image', 'video', 'audio']) project.definitions[key] = { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }
  const image = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="#22aa88"/></svg>')
  const video = new Uint8Array(readFileSync('tests/fixtures/r18CommonTasks/materials/motion.webm'))
  const audio = new Uint8Array(60), view = new DataView(audio.buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((character, index) => { audio[offset + index] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, 52, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, 16, true)
  const assets: Record<string, Uint8Array> = { image, video, audio }
  for (const [id, extension, mimeType] of [['image', 'svg', 'image/svg+xml'], ['video', 'webm', 'video/webm'], ['audio', 'wav', 'audio/wav']] as const)
    project.assets[id] = { id, filename: `${id}.${extension}`, path: `assets/${id}.${extension}`, mimeType, byteLength: assets[id].length }
  const objects = [['slide-image', slideId, 'image'], ['flow-video', 'flow', 'video'], ['space-video', 'space', 'video'], ['flow-audio', 'flow', 'audio']] as const
  for (const [index, [id, surfaceId, kind]] of objects.entries()) {
    const data = kind === 'image' ? { ...createImageData('image', 'Authored alternative'), fit: 'cover' as const, flipX: true }
      : kind === 'video' ? { ...createVideoData('video', `Authored ${id}`), loop: true, volume: .4, fit: 'cover' as const }
      : { ...createAudioData('audio', 'Authored narration'), loop: true, volume: .3 }
    project.instances[id] = { id, definitionId: kind, data, frame: { width: 220, height: 130, transform: [1, 0, 0, 1, 50 + index * 240, 70] } }
    project.surfaces.find(surface => surface.id === surfaceId)!.childIds.push(id)
  }
  return { model: { kind: 'course-v10' as const, project, resources: { assets, components: {} } }, objects, slideId }
}
async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-existing-media-')); roots.push(root)
  const { model, objects, slideId } = fixture(), filename = path.join(root, 'media.glx')
  await fs.writeFile(filename, driver.serialize(model))
  const replacement = { image: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="blue"/></svg>'),
    video: model.resources.assets.video.slice(), audio: model.resources.assets.audio.slice() }
  replacement.audio[44] = 1
  const sources = { image: path.join(root, 'replacement.svg'), video: path.join(root, 'replacement.webm'), audio: path.join(root, 'replacement.wav') }
  for (const kind of ['image', 'video', 'audio'] as const) await fs.writeFile(sources[kind], replacement[kind])
  const host = new DocumentHostService(path.join(root, 'journal')), opened = await host.open(filename), session = host.registry.get(opened.documentId)
  host.tools.configureHostServices({ mediaFiles: { read: async (runId, source) => {
    const access = host.tools.runFileAccess(runId)
    if (!access?.workspaceRoot) throw new Error('Missing workspace file grant')
    return mediaFileInput(await host.agentFiles.readAuthorizedFile({ runId, workspaceRoot: access.workspaceRoot, permission: access.permission }, source))
  } } })
  await host.tools.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: root } })
  const issue = (target: ToolTarget, readOnly = false) => host.tools.issueTarget('r', opened.documentId, target, { readOnly })
  return { root, filename, model, objects, slideId, host, session, replacement, sources, issue,
    current: () => { const current = session.read().model; if (current.kind !== 'course-v10') throw new Error('Expected V10'); return current },
    object: (id: string, surfaceId: string, readOnly = false) => issue({ kind: 'course-instance', surfaceId, instanceId: id }, readOnly),
    invoke: (id: string, name: string, input: unknown) => host.tools.execute('r', id, { name, input }),
    reopen: async () => { await host.internalAPI.save(opened.documentId); return (await new DocumentHostService(path.join(root, 'reopen')).open(filename)).model },
    undo: async () => { const before = session.read(); expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'undo-media', actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' }) } }
}
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }) }

it('reuses existing image/video/audio assets through component duplication across slide, flow and spatial pages in one undoable transaction', async () => {
  const f = await harness(), before = f.session.read()
  applied(await f.invoke('reuse-existing', 'batch', { operations: await Promise.all(f.objects.map(async ([id, surfaceId]) => ({ name: 'object.structure', input: { target: await f.object(id, surfaceId), action: 'duplicate' } }))) }))
  const after = f.current()
  expect(f.session.read().undoDepth).toBe(1)
  expect(after.project.assets).toEqual(f.model.project.assets); expect(after.resources).toEqual(before.model.resources)
  for (const [id, surfaceId] of f.objects) {
    const surface = after.project.surfaces.find(value => value.id === surfaceId)!
    const copy = surface.childIds.map(copyId => after.project.instances[copyId]).find(instance => !f.model.project.instances[instance.id] && instance.data && (instance.data as { title?: string }).title === (f.model.project.instances[id].data as { title?: string }).title && instance.definitionId === f.model.project.instances[id].definitionId)!
    expect(copy).toBeDefined(); expect(copy.id).not.toBe(id)
    expect(copy.data).toEqual(f.model.project.instances[id].data)
    expect(copy.frame).toEqual({ ...f.model.project.instances[id].frame, transform: [1, 0, 0, 1, f.model.project.instances[id].frame!.transform[4] + 20, 90] })
  }
  expect(await f.reopen()).toEqual(after)
  await f.undo(); expect(f.current()).toEqual({ ...before.model, project: { ...f.model.project, revision: f.session.read().revision } })
})

it('replaces admitted media and a background with original bytes while retaining authored fields, one History, save/reopen and Undo', async () => {
  const f = await harness(), before = f.session.read()
  applied(await f.invoke('replace-existing', 'batch', { operations: [
    ...await Promise.all(f.objects.map(async ([id, surfaceId, kind]) => ({ name: 'media.apply', input: { target: await f.object(id, surfaceId), source: f.sources[kind] } }))),
    { name: 'surface.configure', input: { target: await f.issue({ kind: 'course-surface', surfaceId: f.slideId }), settings: { background: { source: f.sources.image } } } },
  ] }))
  const after = f.current(); expect(f.session.read().undoDepth).toBe(1)
  for (const [id, , kind] of f.objects) {
    const prior = f.model.project.instances[id], next = after.project.instances[id], assetId = (next.data as { assetId: string }).assetId
    expect(assetId).not.toBe(kind)
    expect(next).toEqual({ ...prior, data: { ...(prior.data as object), assetId, ...(kind === 'image' ? { originalAssetId: assetId } : {}) } })
    expect(after.resources.assets[assetId]).toEqual(f.replacement[kind])
  }
  const background = after.project.surfaces.find(surface => surface.id === f.slideId)!.background!
  expect(background.mode).toBe('own'); expect(after.resources.assets[background.assetId!]).toEqual(f.replacement.image)
  for (const id of Object.keys(f.model.project.assets)) { expect(after.project.assets[id]).toEqual(f.model.project.assets[id]); expect(after.resources.assets[id]).toEqual(f.model.resources.assets[id]) }
  expect(await f.reopen()).toEqual(after)
  await f.undo(); expect(f.current()).toEqual({ ...before.model, project: { ...f.model.project, revision: f.session.read().revision } })
})

it('rejects forged, stale write, cross-document, readonly and wrong-type references while reading current asset bytes', async () => {
  const f = await harness(), target = await f.object('slide-image', f.slideId), picture = await f.issue({ kind: 'course-asset', assetId: 'image' }, true), audio = await f.issue({ kind: 'course-asset', assetId: 'audio' }, true)
  const before = f.session.read()
  expect(mutationCallSchema.safeParse({ name: 'media.insert', input: { target, asset: picture, resource: 'both' } }).success).toBe(false)
  expect(await f.invoke('raw-id', 'media.apply', { target, asset: 'image' })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('wrong-asset', 'media.apply', { target, asset: audio })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('wrong-source', 'media.apply', { target, source: f.sources.video })).toMatchObject({ kind: 'error' })
  expect(await f.invoke('readonly', 'media.apply', { target: await f.object('slide-image', f.slideId, true), asset: picture })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.invoke('atomic-wrong-source', 'batch', { operations: [
    { name: 'media.apply', input: { target, source: f.sources.image } },
    { name: 'media.apply', input: { target: await f.object('flow-audio', 'flow'), source: f.sources.video } },
  ] })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(before)
  const other = await f.host.registry.create(fixture().model, 'other.glx')
  await f.host.tools.beginRun({ runId: 'other', actor: 'agent', documents: [{ documentId: other.documentId, writable: [{ kind: 'document' }] }] })
  const foreign = await f.host.tools.issueTarget('other', other.documentId, { kind: 'course-asset', assetId: 'image' }, { readOnly: true })
  expect(await f.invoke('foreign', 'media.apply', { target, asset: foreign })).toMatchObject({ kind: 'error' })
  expect(f.session.read()).toEqual(before)
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-byte-edit', actor: 'human', baseRevision: before.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.model.project, [{ type: 'asset.replace', asset: { ...f.model.project.assets.image, byteLength: f.replacement.image.length }, bytes: f.replacement.image, expectedBytes: f.model.resources.assets.image }]) } })).toMatchObject({ status: 'applied' })
  const byteEdited = f.session.read(), oldWriteTarget = await f.object('slide-image', f.slideId)
  expect(await f.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human-image-edit', actor: 'human', baseRevision: byteEdited.revision,
    mutation: { type: 'command', command: captureComponentOperation(f.current().project, [{ type: 'data.set', instanceId: 'slide-image', path: ['alt'], value: 'Concurrent human alt' }]) } })).toMatchObject({ status: 'applied' })
  const humanEdited = f.session.read()
  expect(await f.invoke('stale-write', 'media.apply', { target: oldWriteTarget, asset: picture })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(f.session.read()).toEqual(humanEdited)
  applied(await f.invoke('current-existing-image', 'media.apply', { target: await f.object('slide-image', f.slideId), asset: picture }))
  expect(f.current().project.instances['slide-image'].data).toMatchObject({ alt: 'Concurrent human alt' })
  expect(f.current().resources.assets[(f.current().project.instances['slide-image'].data as { assetId: string }).assetId]).toEqual(f.replacement.image)
})
