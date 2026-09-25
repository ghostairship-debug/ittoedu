import { expect, it, vi } from 'vitest'
import type { AssetMeta } from '../../src/shared/contracts/media-v1'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'
import { openSpatialAuthoringSession } from '../../src/renderer/course/spatialEditorCommands'
import { undoSpatialAuthoringHistory, redoSpatialAuthoringHistory } from '../../src/renderer/course/spatialAuthoringHistory'
import { createMediaAuthoringActions, type MediaAuthoringPorts } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { emptyCourseAssetSidecar, type CourseAssetSidecar } from '../../src/renderer/project/v9AssetAdapter'

function fixture() {
  const project = createBlankSpatialCourseProject({ now: '2026-09-23T00:00:00.000Z', controls: 'none', includeDefaultController: false })
  let session = openSpatialAuthoringSession(project)
  let sidecar: CourseAssetSidecar = emptyCourseAssetSidecar()
  let feedback: { errorMessage?: string | null; statusMessage?: string | null } = {}
  const persistSpatial = vi.fn<MediaAuthoringPorts['persistSpatial']>((result, extra) => {
    if (!result.ok || !result.nextSession) return
    session = result.nextSession
    sidecar = extra?.sidecar ?? sidecar
    feedback = { errorMessage: null, statusMessage: extra?.statusMessage }
  })
  const ports: MediaAuthoringPorts = {
    read: () => ({ document: session.history.present, sidecar, componentPackages: {}, authoringSession: null,
      editingScope: 'scene', activeSceneId: '', projection: null, hasSlideSession: false, hasFlowSession: false, hasSpatialSession: true }),
    readSlideSession: () => null,
    readSpatialSession: () => session,
    readFlowSession: () => null,
    setFeedback: value => { feedback = value },
    persistTransaction: () => false,
    persistCandidateResult: () => { throw new Error('Unexpected Slide transaction') },
    persistMedia: result => result,
    persistSpatial,
    persistFlow: result => result,
  }
  return { actions: createMediaAuthoringActions(ports), read: () => ({ session, sidecar, feedback }), persistSpatial }
}

function audio(id: string, bytes: Uint8Array): { meta: AssetMeta; bytes: Uint8Array } {
  return { meta: { id, filename: `${id}.mp3`, kind: 'audio', mimeType: 'audio/mpeg', path: `assets/${id}.mp3`,
    byteLength: bytes.byteLength, duration: 2 }, bytes }
}

it('commits Spatial audio to sound definitions, resource sidecar and one Spatial History frame', () => {
  const f = fixture(), initial = f.read().session.history.present
  const items = [audio('voice-a', Uint8Array.from([1, 2, 3, 4])), audio('voice-b', Uint8Array.from([5, 6, 7, 8]))]
  const ids = f.actions.importSounds(items)
  expect(ids).toHaveLength(2)
  expect(f.persistSpatial).toHaveBeenCalledOnce()
  expect(f.persistSpatial.mock.calls[0]?.[0]).toMatchObject({ ok: true, historyEntry: true })
  const { session, sidecar, feedback } = f.read(), present = session.history.present
  expect(feedback.errorMessage).toBeNull()
  expect(feedback.statusMessage).toContain('声音库供互动播放')
  expect(present.revision).toBe(initial.revision + 1)
  expect(session.history.past).toHaveLength(1)
  expect(ids.map(id => present.media.audio.sounds[id]?.assetId)).toEqual(['voice-a', 'voice-b'])
  expect([...sidecar.files['voice-a']!]).toEqual([1, 2, 3, 4])
  expect([...sidecar.files['voice-b']!]).toEqual([5, 6, 7, 8])
  const spatial = present.surfaces.find(surface => surface.type === 'spatial-2d')
  expect(spatial?.type === 'spatial-2d' ? spatial.world.layerItems : []).toHaveLength(0)

  const driver = new CourseV9Driver()
  const reopened = driver.load(driver.serialize({ kind: 'course-v9', project: present,
    resources: { assets: { ...sidecar.files }, components: {} } }))
  if (reopened.kind !== 'course-v9') throw new Error('Expected reopened Course V9')
  expect(ids.map(id => reopened.project.media.audio.sounds[id]?.assetId)).toEqual(['voice-a', 'voice-b'])
  expect([...reopened.resources.assets['voice-a']!]).toEqual([1, 2, 3, 4])

  const undone = undoSpatialAuthoringHistory(session.history)
  expect(undone.present.media.audio.sounds[ids[0]!]).toBeUndefined()
  expect(redoSpatialAuthoringHistory(undone).present.media.audio.sounds[ids[0]!]?.assetId).toBe('voice-a')
})

it('rejects an invalid mixed batch atomically without a Spatial History or sidecar write', () => {
  const f = fixture(), before = f.read()
  const valid = audio('valid-audio', Uint8Array.from([1, 2, 3]))
  const invalid = { ...audio('not-audio', Uint8Array.from([4, 5, 6])), meta: {
    ...audio('not-audio', Uint8Array.from([4, 5, 6])).meta, kind: 'image' as const, mimeType: 'image/png',
  } }
  expect(f.actions.importSounds([valid, invalid])).toEqual([])
  const after = f.read()
  expect(f.persistSpatial).not.toHaveBeenCalled()
  expect(after.session.history.present.revision).toBe(before.session.history.present.revision)
  expect(after.session.history.present.assets['valid-audio']).toBeUndefined()
  expect(after.sidecar.files['valid-audio']).toBeUndefined()
  expect(after.feedback.errorMessage).toContain('不是音频素材')
})

it('reports no success when the Spatial persistence adapter does not accept the transaction', () => {
  const f = fixture()
  f.persistSpatial.mockImplementation(() => undefined)
  const ids = f.actions.importSounds([audio('voice-uncommitted', Uint8Array.from([1, 2, 3, 4]))])
  expect(ids).toEqual([])
  expect(f.read().session.history.present.assets['voice-uncommitted']).toBeUndefined()
  expect(f.read().feedback.errorMessage).toContain('声音未写入')
})
