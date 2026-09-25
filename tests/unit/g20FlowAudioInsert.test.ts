// @vitest-environment node
import { expect, it } from 'vitest'
import type { AssetMeta } from '../../src/shared/contracts/media-v1/types'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '../../src/renderer/store/editorStore'
import { createCourseStoreHost } from '../helpers/courseStoreHost'

const store = () => useEditorStore.getState()
const audio = (id: string): { meta: AssetMeta; bytes: Uint8Array } => ({
  meta: { id, filename: `${id}.mp3`, mimeType: 'audio/mpeg', kind: 'audio', path: `assets/${id}.mp3`, byteLength: 4, duration: 2 },
  bytes: Uint8Array.from([1, 2, 3, 4]),
})
const mediaBlocks = () => {
  const project = selectActiveCourseProjectDocument(store())
  const surface = project?.surfaces.find(candidate => candidate.type === 'flow')
  return surface?.type === 'flow' ? surface.blocks.filter(block => block.type === 'media') : []
}

it('imports local audio into Flow body as a formal asset and media block with undo/redo resources', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  const documentId = store().courseDocument.documentId!
  store().addCourseContent('flow-page')
  await store().drainCourseDocument()
  const before = host.registry.get(documentId).read().undoDepth
  const result = store().insertFlowAudioNodes([audio('lesson-audio-a'), audio('lesson-audio-b')])
  expect(result).toEqual({ completedCount: 2, issues: [] })
  await store().drainCourseDocument()
  expect(host.registry.get(documentId).read().undoDepth).toBe(before + 2)
  expect(mediaBlocks().map(block => block.assetId)).toEqual(['lesson-audio-a', 'lesson-audio-b'])
  expect(selectActiveCourseProjectDocument(store())?.assets['lesson-audio-a']?.kind).toBe('audio')
  expect(selectMediaAssetFiles(store())['lesson-audio-b']).toEqual(Uint8Array.from([1, 2, 3, 4]))

  store().undo()
  await store().drainCourseDocument()
  expect(mediaBlocks().map(block => block.assetId)).toEqual(['lesson-audio-a'])
  expect(selectActiveCourseProjectDocument(store())?.assets['lesson-audio-b']).toBeUndefined()
  expect(selectMediaAssetFiles(store())['lesson-audio-b']).toBeUndefined()
  store().redo()
  await store().drainCourseDocument()
  expect(mediaBlocks().map(block => block.assetId)).toEqual(['lesson-audio-a', 'lesson-audio-b'])
  expect(selectMediaAssetFiles(store())['lesson-audio-b']).toEqual(Uint8Array.from([1, 2, 3, 4]))
})

it('rejects Flow global scope before importing audio bytes or creating a block', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  store().addCourseContent('flow-page')
  await store().drainCourseDocument()
  store().setEditingScope('global')
  const before = selectActiveCourseProjectDocument(store())?.revision
  const result = store().insertFlowAudioNodes([audio('global-audio')])
  expect(result.completedCount).toBe(0)
  expect(result.issues[0]?.message).toContain('Flow 当前文档页')
  expect(selectActiveCourseProjectDocument(store())?.revision).toBe(before)
  expect(selectActiveCourseProjectDocument(store())?.assets['global-audio']).toBeUndefined()
})

it('places a dropped Flow media block at the exact body anchor and rejects a stale anchor', async () => {
  const host = await createCourseStoreHost()
  await host.open(createBlankCourseProject({ includeDefaultController: false, controls: 'none' }))
  store().addCourseContent('flow-page')
  await store().drainCourseDocument()
  const before = store().flowSession?.history.present.surfaces.find(surface => surface.type === 'flow')
  if (before?.type !== 'flow') throw new Error('expected Flow surface')
  const firstBlockId = before.blocks[0]?.id
  if (!firstBlockId) throw new Error('expected first Flow block')

  const inserted = store().insertFlowMediaAt(audio('dropped-audio'), null)
  expect(inserted.ok, inserted.reason).toBe(true)
  await store().drainCourseDocument()
  const after = store().flowSession?.history.present.surfaces.find(surface => surface.type === 'flow')
  if (after?.type !== 'flow') throw new Error('expected Flow surface')
  expect(after.blocks[0]).toMatchObject({ type: 'media', assetId: 'dropped-audio' })
  expect(after.blocks[1]?.id).toBe(firstBlockId)
  const revision = selectActiveCourseProjectDocument(store())?.revision
  const stale = store().insertFlowMediaAt(audio('stale-audio'), 'missing-block')
  expect(stale).toMatchObject({ ok: false, reason: expect.stringContaining('位置已经改变') })
  expect(selectActiveCourseProjectDocument(store())?.revision).toBe(revision)
  expect(selectMediaAssetFiles(store())['stale-audio']).toBeUndefined()
})
