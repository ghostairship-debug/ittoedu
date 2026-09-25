// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { DocumentModel } from '../../src/shared/workbench/document'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'
const driver = new CourseV9Driver()
function applied(r: ToolResult) { expect(r, JSON.stringify(r)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (r.kind !== 'document-operation') throw new Error('ACK'); return r }
function fixture() { return driver.load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson'))) as Extract<DocumentModel, { kind: 'course-v9' }> }
async function harness(model = fixture(), scope: ToolTarget[] = [{ kind: 'document' }]) {
  let id = 0
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `doc-${++id}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(model, 'pages.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++id))
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: scope }] })
  return { model, session, gateway, issue: (target: ToolTarget, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly }), project: () => (session.read().model as typeof model).project,
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }), undo: async (operationId = 'undo') => { const s = session.read(); await session.execute({ documentId: s.documentId, epoch: s.epoch, operationId, actor: 'human', baseRevision: s.revision, mutation: { type: 'undo' } }) } }
}

import { openCourseMediaSession, updateCourseSound, updateCourseAudioSettings } from '../../src/renderer/course/v9MediaAudioCommands'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { AudioManager } from '../../src/player/AudioManager'
import { CourseEventBus } from '../../src/player/CourseEventBus'
import { planCreateCourseSound } from '../../src/core/tools/courseAudio'

function audioFixture() {
  const model = fixture()
  // A real minimal PCM WAV, not a claimed imported/decoded resource.
  const bytes = new Uint8Array(60), view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((character, i) => { bytes[offset + i] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, 52, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, 16, true)
  for (const id of ['audio-one', 'audio-two']) {
    model.project.assets[id] = { id, filename: `${id}.wav`, kind: 'audio', mimeType: 'audio/wav', path: `assets/${id}.wav`, byteLength: bytes.length, duration: 0.001 }
    model.resources.assets[id] = bytes.slice()
  }
  return model
}

it('audio settings and sound CRUD use manual planners with one History, real asset closure, Published values and original-format reopen', async () => {
  const model = audioFixture(), f = await harness(model), audio = await f.issue({ kind: 'course-audio' })
  const asset = await f.issue({ kind: 'course-asset', assetId: 'audio-one' }, true)
  const properties = { defaultMuted: true, masterVolume: 0.4, channelVolumes: { music: 0.3 }, narrationDucking: { enabled: true, musicVolume: 0.2, fadeMs: 234.4 } }
  const added = applied(await f.invoke('create-settings', 'batch', { operations: [
    { name: 'sound.create', input: { target: audio, asset, properties: { name: 'Narration', channel: 'narration', defaultVolume: 0.75 } } },
    { name: 'audio.settings', input: { target: audio, properties } },
  ] }))
  const soundTarget = (await f.gateway.resolveEditTarget('r', added.affected[0])).target
  if (soundTarget.kind !== 'course-sound') throw new Error('sound target')
  const soundId = soundTarget.soundId, beforeUpdate = f.project()
  const manualSettings = updateCourseAudioSettings(openCourseMediaSession(model.project), properties)
  expect(manualSettings.ok).toBe(true)
  expect({ ...f.project().media.audio, sounds: {} }).toEqual({ ...manualSettings.nextSession.history.present.media.audio, sounds: {} })
  expect(f.project().media.audio.narrationDucking.fadeMs).toBe(234)
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(model.resources)
  const patch = { name: 'Renamed voice', channel: 'music' as const, defaultLoop: true }
  const manual = updateCourseSound(openCourseMediaSession(beforeUpdate), soundId, { ...patch, assetId: 'audio-two' })
  applied(await f.invoke('update-sound', 'sound.update', { target: added.affected[0], asset: await f.issue({ kind: 'course-asset', assetId: 'audio-two' }, true), properties: patch }))
  expect(f.project().media.audio.sounds[soundId]).toEqual(manual.nextSession.history.present.media.audio.sounds[soundId])
  expect(f.project().media.audio.sounds[soundId].defaultVolume).toBe(0.75)
  const published = buildPublishedCourseV2Payload({ project: f.project(), assetFiles: f.session.read().model.resources.assets, components: {} })
  expect(published.media.audio).toEqual(f.project().media.audio)
  const manager = new AudioManager(published, () => '', new CourseEventBus())
  expect(manager.muted()).toBe(true); expect(manager.masterVolume()).toBe(0.4); manager.destroy()
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().media.audio).toEqual(beforeUpdate.media.audio)
  const latest = await f.issue(soundTarget)
  applied(await f.invoke('delete-sound', 'sound.delete', { target: latest }))
  expect(f.project().media.audio.sounds[soundId]).toBeUndefined()
  expect(f.project().assets).toEqual(model.project.assets); expect(f.session.read().model.resources).toEqual(model.resources)
  await f.undo('undo-delete'); expect(f.project().media.audio.sounds[soundId]).toEqual(beforeUpdate.media.audio.sounds[soundId])
})

it('sound references protect definitions and batch failures preserve audio settings and bytes without widening local grants', async () => {
  const model = audioFixture(), planned = planCreateCourseSound(model.project, 'audio-one', { name: 'Referenced' }); model.project = planned.project
  const surface = model.project.surfaces[0]; if (surface.type !== 'slide') throw new Error('slide')
  surface.scenes[0].interactions.push({ id: 'audio-rule', enabled: true, trigger: { type: 'scene.enter' }, conditions: [], actions: [{ id: 'audio-step', start: 'after-previous', delayMs: 0, action: { type: 'audio.play', soundId: planned.soundId } }] })
  const f = await harness(model), sound = await f.issue({ kind: 'course-sound', soundId: planned.soundId }), audio = await f.issue({ kind: 'course-audio' })
  expect(await f.invoke('reject-referenced', 'batch', { operations: [
    { name: 'audio.settings', input: { target: audio, properties: { masterVolume: 0.01 } } },
    { name: 'sound.delete', input: { target: sound } },
  ] })).toMatchObject({ kind: 'error', message: expect.stringContaining('引用') })
  expect(f.session.read().undoDepth).toBe(0); expect(f.project()).toEqual(model.project)
  expect(await f.invoke('invalid-volume', 'audio.settings', { target: audio, properties: { masterVolume: 2 } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(await f.invoke('raw-asset-id', 'sound.create', { target: audio, asset: 'audio-one' })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  const local = await harness(model, [{ kind: 'course-sound', soundId: planned.soundId }])
  expect(await local.invoke('no-global-settings', 'audio.settings', { target: await local.issue({ kind: 'course-audio' }), properties: { defaultMuted: true } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  applied(await local.invoke('permitted-sound', 'sound.update', { target: await local.issue({ kind: 'course-sound', soundId: planned.soundId }), properties: { name: 'Local rename' } }))
  const published = buildPublishedCourseV2Payload({ project: local.project(), assetFiles: model.resources.assets, components: {} })
  const publishedSurface = published.surfaces[0]
  expect(JSON.stringify(publishedSurface)).toContain(planned.soundId)
  expect(local.session.read().model.resources).toEqual(model.resources)
})

it('asset handles detect byte replacement and read-only discovery retains its ceiling, while unrelated page edits do not stale audio', async () => {
  const model = audioFixture(), f = await harness(model), staleAsset = await f.issue({ kind: 'course-asset', assetId: 'audio-one' }, true)
  const audio = await f.issue({ kind: 'course-audio' }), snapshot = f.session.read()
  const nextModel = structuredClone(snapshot.model); if (nextModel.kind !== 'course-v9') throw new Error('course')
  nextModel.resources.assets['audio-one'][44] = 1
  await f.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-byte-replacement', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'command', command: { type: 'course.replace', project: nextModel.project, resources: nextModel.resources } } })
  expect(await f.invoke('stale-bytes', 'sound.create', { target: audio, asset: staleAsset })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  applied(await f.invoke('fresh-asset', 'sound.create', { target: audio, asset: await f.issue({ kind: 'course-asset', assetId: 'audio-one' }, true) }))
  const readOnlyAudio = await f.issue({ kind: 'course-audio' }, true)
  const children = await f.invoke('children', 'listChildren', { target: readOnlyAudio })
  expect(children.kind).toBe('read')
  const child = ((children as Extract<ToolResult, {kind:'read'}>).data as { target: string }[])[0]
  // Discovery returns its formal envelope; no write authority can escape a readonly parent.
  expect(await f.invoke('readonly-child', 'sound.update', { target: child.target, properties: { name: 'Forbidden' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const audioFresh = await f.issue({ kind: 'course-audio' })
  applied(await f.invoke('page-rename', 'surface.rename', { target: await f.issue({ kind: 'course-surface', surfaceId: model.project.surfaces[0].id }), name: 'Independent page change' }))
  applied(await f.invoke('audio-after-page', 'audio.settings', { target: audioFresh, properties: { masterVolume: 0.8 } }))
  expect(f.project().media.audio.masterVolume).toBe(0.8)
})
