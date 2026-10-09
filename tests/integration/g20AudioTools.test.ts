// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { courseAudioSettingsEdits, courseAudioSettings } from '../../src/core/course/courseMediaEdits'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { AudioManager } from '../../src/player/AudioManager'
import { CourseEventBus } from '../../src/player/CourseEventBus'
import { interactionBehavior, interactionRules } from '../../src/shared/componentInteractionData'
import type { ToolResult, ToolTarget } from '../../src/shared/workbench/tools'

const driver = new CourseV10Driver()
function fixture() {
  const project = createBlankCourseProjectV10('Audio'), bytes = new Uint8Array(60), view = new DataView(bytes.buffer)
  const ascii = (offset: number, value: string) => [...value].forEach((character, i) => { bytes[offset + i] = character.charCodeAt(0) })
  ascii(0, 'RIFF'); view.setUint32(4, 52, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, 16, true)
  const assets: Record<string, Uint8Array> = {}
  for (const id of ['audio-one', 'audio-two']) {
    project.assets[id] = { id, filename: `${id}.wav`, mimeType: 'audio/wav', path: `assets/${id}.wav`, byteLength: bytes.length }
    assets[id] = bytes.slice()
  }
  return { kind: 'course-v10' as const, project, resources: { assets, components: {} } }
}
async function harness(model = fixture(), scope: ToolTarget[] = [{ kind: 'document' }]) {
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('No physical save requested') } } })
  const session = await registry.create(model, 'audio.glx'), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'r', actor: 'agent', documents: [{ documentId: session.documentId, writable: scope }] })
  return { model, session, gateway, issue: (target: ToolTarget = { kind: 'document' }, readOnly = false) => gateway.issueTarget('r', session.documentId, target, { readOnly }),
    project: () => { const current = session.read().model; if (current.kind !== 'course-v10') throw new Error('Expected V10'); return current.project },
    invoke: (id: string, name: string, input: unknown) => gateway.execute('r', id, { name, input }),
    undo: async (operationId = 'undo') => { const before = session.read(); expect(await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId,
      actor: 'human', baseRevision: before.revision, mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' }) } }
}
function applied(result: ToolResult) { expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); if (result.kind !== 'document-operation') throw new Error('Missing receipt'); return result }

it('audio settings and sound CRUD share manual semantics, one History, original bytes, Published values and archive reopen', async () => {
  const model = fixture(), f = await harness(model), target = await f.issue()
  const settings = { defaultMuted: true, masterVolume: .4, channelVolumes: { music: .3 }, narrationDucking: { enabled: true, musicVolume: .2, fadeMs: 234 } }
  applied(await f.invoke('create-settings', 'batch', { operations: [
    { name: 'course.media', input: { target, change: { kind: 'import-sounds', assets: ['audio-one'] } } },
    { name: 'course.media', input: { target, change: { kind: 'audio', settings } } },
  ] }))
  const audio = courseAudioSettings(f.project()), soundId = Object.keys(audio.sounds)[0]
  const manual = courseAudioSettingsEdits(model.project, settings)[0]
  if (manual.type !== 'project.media.set') throw new Error('Expected media edit')
  expect({ ...audio, sounds: {} }).toEqual({ ...manual.media!.audio, sounds: {} })
  expect(audio.sounds[soundId]).toMatchObject({ assetId: 'audio-one', defaultVolume: 1, defaultLoop: false })
  expect(f.session.read().undoDepth).toBe(1); expect(f.session.read().model.resources).toEqual(model.resources)
  const beforeUpdate = structuredClone(f.project())
  applied(await f.invoke('update-sound', 'course.media', { target: await f.issue(), change: { kind: 'sound', soundId,
    settings: { name: 'Renamed voice', assetId: 'audio-two', channel: 'music', defaultLoop: true } } }))
  expect(courseAudioSettings(f.project()).sounds[soundId]).toEqual({ ...audio.sounds[soundId], name: 'Renamed voice', assetId: 'audio-two', channel: 'music', defaultLoop: true })
  const published = await buildPublishedCourseV3({ project: f.project(), assetBytes: f.session.read().model.resources.assets, componentFiles: {} })
  expect(published.payload.media?.audio).toEqual(courseAudioSettings(f.project()))
  const manager = new AudioManager(published.payload, () => '', new CourseEventBus())
  expect(manager.muted()).toBe(true); expect(manager.masterVolume()).toBe(.4); manager.destroy()
  expect(driver.load(driver.serialize(f.session.read().model))).toEqual(f.session.read().model)
  await f.undo(); expect(f.project().media).toEqual(beforeUpdate.media)
  applied(await f.invoke('delete-sound', 'course.media', { target: await f.issue(), change: { kind: 'sound', soundId, settings: null } }))
  expect(courseAudioSettings(f.project()).sounds[soundId]).toBeUndefined()
  expect(f.project().assets).toEqual(model.project.assets); expect(f.session.read().model.resources).toEqual(model.resources)
  await f.undo('undo-delete'); expect(f.project().media).toEqual(beforeUpdate.media)
})

it('referenced sounds and invalid batch inputs preserve audio settings, resource bytes and page-only grants', async () => {
  const model = fixture()
  model.project.surfaces[0].presentation = { states: [{ id: 'answer', title: 'Answer', overrides: {} }] }
  const f = await harness(model)
  applied(await f.invoke('import', 'course.media', { target: await f.issue(), change: { kind: 'import-sounds', assets: ['audio-one'] } }))
  const soundId = Object.keys(courseAudioSettings(f.project()).sounds)[0], surfaceId = f.project().surfaces[0].id
  applied(await f.invoke('audio-rule', 'interaction.update', { target: await f.issue({ kind: 'course-surface', surfaceId }), change: { kind: 'add', rule: {
    name: 'audio-rule', enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
    actions: [{ start: 'after-previous', delayMs: 0, action: { type: 'audio.play', soundId } }],
  } } }))
  const before = f.session.read(), target = await f.issue()
  expect(await f.invoke('reject-referenced', 'batch', { operations: [
    { name: 'course.media', input: { target, change: { kind: 'audio', settings: { masterVolume: .01 } } } },
    { name: 'course.media', input: { target, change: { kind: 'sound', soundId, settings: null } } },
  ] })).toMatchObject({ kind: 'error', message: expect.stringContaining('引用') })
  expect(f.session.read()).toEqual(before)
  const behavior = interactionBehavior(f.project(), { kind: 'surface', surfaceId })!
  const ruleId = interactionRules(behavior)[0].id
  applied(await f.invoke('remove-base-rule', 'interaction.update', { target: await f.issue({ kind: 'course-surface', surfaceId }),
    change: { kind: 'remove', ruleId } }))
  applied(await f.invoke('state-ended-rule', 'interaction.update', { target: await f.issue({ kind: 'course-surface', surfaceId, stateId: 'answer' }), change: { kind: 'add', rule: {
    name: 'state-audio-rule', enabled: true, trigger: { type: 'audio.ended', soundId }, conditions: [],
    actions: [{ start: 'after-previous', delayMs: 0, action: { type: 'audio.stop', target: { kind: 'sound', soundId } } }],
  } } }))
  expect(interactionRules(interactionBehavior(f.project(), { kind: 'surface', surfaceId }))).toEqual([])
  const stateBefore = f.session.read(), fresh = await f.issue()
  expect(await f.invoke('reject-state-reference', 'course.media', { target: fresh, change: { kind: 'sound', soundId, settings: null } }))
    .toMatchObject({ kind: 'error', message: expect.stringContaining('引用') })
  expect(f.session.read()).toEqual(stateBefore)
  expect(await f.invoke('invalid-volume', 'course.media', { target: fresh, change: { kind: 'audio', settings: { masterVolume: 2 } } })).toMatchObject({ kind: 'error', code: 'invalid-input' })
  expect(await f.invoke('wrong-resource', 'course.media', { target: fresh, change: { kind: 'import-sounds', assets: ['missing'] } })).toMatchObject({ kind: 'error', code: 'invalid-target' })
  expect(f.session.read()).toEqual(stateBefore)
  const current = stateBefore.model; if (current.kind !== 'course-v10') throw new Error('Expected V10')
  const local = await harness(current, [{ kind: 'course-surface', surfaceId }])
  expect(await local.invoke('no-global-settings', 'course.media', { target: await local.issue(), change: { kind: 'audio', settings: { defaultMuted: true } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  applied(await local.invoke('local-page', 'surface.configure', { target: await local.issue({ kind: 'course-surface', surfaceId }), settings: { title: 'Local rename' } }))
  expect(local.project().media).toEqual(current.project.media); expect(local.session.read().model.resources).toEqual(model.resources)
})

it('rejects conflicting bytes under an existing asset identity and preserves the readonly discovery ceiling', async () => {
  const model = fixture(), f = await harness(model), snapshot = f.session.read()
  const bytes = Uint8Array.from(model.resources.assets['audio-one']); bytes[44] = 1
  await expect(f.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: 'human-byte-replacement', actor: 'human', baseRevision: snapshot.revision,
    mutation: { type: 'command', command: captureComponentOperation(model.project, [{ type: 'asset.add', asset: model.project.assets['audio-one'], bytes }]) } })).resolves.toMatchObject({ status: 'failed' })
  expect(f.session.read()).toEqual(snapshot)
  const readonly = await f.issue({ kind: 'document' }, true), children = await f.invoke('children', 'listChildren', { target: readonly })
  expect(children.kind).toBe('read')
  if (children.kind !== 'read') throw new Error('Expected children')
  const page = (children.data as { target: string; kind: string }[]).find(child => child.kind === 'course-surface')!
  expect(await f.invoke('readonly-child', 'surface.configure', { target: page.target, settings: { title: 'Forbidden' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(await f.invoke('readonly-audio', 'course.media', { target: readonly, change: { kind: 'audio', settings: { masterVolume: .8 } } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  applied(await f.invoke('page-rename', 'surface.configure', { target: await f.issue({ kind: 'course-surface', surfaceId: model.project.surfaces[0].id }), settings: { title: 'Independent page change' } }))
  applied(await f.invoke('audio-after-page', 'course.media', { target: await f.issue(), change: { kind: 'audio', settings: { masterVolume: .8 } } }))
  expect(courseAudioSettings(f.project()).masterVolume).toBe(.8)
  expect(f.session.read().model.resources).toEqual(model.resources)
})
