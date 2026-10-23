import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { createV10StoreHost, deferred } from '../helpers/courseV10StoreHost'
import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { courseDraftLifecycle } from '../../src/renderer/authoring/courseDraftLifecycle'
import { createInitialSlideOwnedState, createSlideAuthoringSlice, slideContentEditInScope } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { createFlowDocumentRecoveryPort } from '../../src/renderer/authoring/flowDocumentDraft'
import { DocumentInputRecovery } from '../../src/main/workbench/DocumentInputRecovery'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ComponentAuthorSpot, JsonValue } from '../../src/shared/contracts/component-platform'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'

const hosts: Awaited<ReturnType<typeof createV10StoreHost>>[] = [], directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  hosts.splice(0).forEach(host => host.bridge.dispose())
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'editing-scope-'))) throw new Error('Unexpected test cleanup target')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
function lostSuccessfulAck(host: Awaited<ReturnType<typeof createV10StoreHost>>) {
  const dispatch = host.api.dispatch.bind(host.api), lookup = host.api.lookup.bind(host.api)
  let visible = false
  vi.spyOn(host.api, 'dispatch').mockImplementationOnce(async (operation, options) => { await dispatch(operation, options); throw new Error('lost original ACK') })
  vi.spyOn(host.api, 'lookup').mockImplementation((id, operationId) => visible ? lookup(id, operationId) : Promise.resolve(null))
  return () => { visible = true }
}
async function fixture(marked = false) {
  const originalData = JSON.parse(JSON.stringify(createTextComponentData('old')))
  if (marked) originalData.content.inlines[0].rangeIds = ['R']
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'recovery-scope', revision: 0, title: '输入恢复',
    definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, ...(marked ? { note: { id: 'note', role: 'behavior' as const, implementation: { kind: 'builtin' as const, key: 'guoling.popover' } } } : {}) },
    instances: { text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: originalData, ...(marked ? { childIds: ['note'] } : {}) },
      ...(marked ? { note: { id: 'note', definitionId: 'note', data: { label: '注释', content: '原范围注释' }, attachments: [
        { instanceId: 'note', target: { kind: 'text-range' as const, instanceId: 'text', dataPath: ['content'], rangeId: 'R' } }] } } : {}) },
    surfaces: [{ id: 'slide', kind: 'slide', title: '当前页', childIds: ['text'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const host = await createV10StoreHost(project); hosts.push(host)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(host.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const lifecycle = courseDraftLifecycle(host.bridge)
  slice.beginSlideDataEdit('text')
  slice.updateSlideDataDraft(createTextComponentData('human draft'))
  const records = lifecycle.preserve(host.first.documentId)
  return { ...host, slice, lifecycle, records, owned: () => owned }
}

it('consumes an already applied native draft instead of restoring its obsolete baseline', async () => {
  const h = await fixture()
  await h.slice.commitSlideContentEdit()
  expect(h.lifecycle.restore(h.first.documentId, h.records)).toMatchObject({ adopted: h.records, issues: [] })
  expect(h.owned().slideContentEdit).toBeNull()
  expect(h.lifecycle.preserve(h.first.documentId)).toEqual([])
})

it('rebases only changed professional fields and keeps an unrelated current color', async () => {
  const h = await fixture()
  h.slice.cancelTextEdit()
  await h.kernel.edit([{ type: 'data.set', instanceId: 'text', path: ['appearance', 'color'], value: '#e63946' }])
  expect(h.lifecycle.restore(h.first.documentId, h.records).issues).toEqual([])
  const restored = textComponentDataSchema.parse(h.owned().slideContentEdit?.data)
  expect(restored.appearance.color).toBe('#e63946')
  expect(restored.content.inlines).toMatchObject([{ type: 'text', text: 'human draft' }])
  await h.slice.commitSlideContentEdit()
  expect(textComponentDataSchema.parse(h.model().project.instances.text.data).appearance.color).toBe('#e63946')
})

it('keeps unrelated properties even when they change during the current uncommitted input', async () => {
  const h = await fixture()
  await h.kernel.edit([{ type: 'data.set', instanceId: 'text', path: ['appearance', 'color'], value: '#0055aa' }])
  await h.slice.commitSlideContentEdit()
  const data = textComponentDataSchema.parse(h.model().project.instances.text.data)
  expect(data.appearance.color).toBe('#0055aa')
  expect(data.content.inlines).toMatchObject([{ type: 'text', text: 'human draft' }])
})

it('finishes an active intent already present in canonical fields without submitting it twice', async () => {
  const h = await fixture()
  await h.kernel.edit([{ type: 'data.set', instanceId: 'text', path: ['content'], value: createTextComponentData('human draft').content as unknown as JsonValue }])
  await h.slice.commitSlideContentEdit()
  expect(h.operations).toHaveLength(1)
  expect(h.owned().slideContentEdit).toBeNull()
})

it('does not consume recovery input merely because an unacknowledged optimistic proposal has the same value', async () => {
  const h = await fixture(), gate = deferred(), entered = deferred()
  h.slice.cancelTextEdit()
  h.controls.before = async () => { entered.resolve(); await gate.promise }
  const pending = h.kernel.edit([{ type: 'data.set', instanceId: 'text', path: ['content'], value: createTextComponentData('human draft').content as unknown as JsonValue }])
  await entered.promise
  h.lifecycle.restore(h.first.documentId, h.records)
  expect(h.owned().slideContentEdit).not.toBeNull()
  expect(h.lifecycle.preserve(h.first.documentId)).toHaveLength(1)
  gate.resolve(); await pending
  await h.slice.commitSlideContentEdit()
  expect(h.operations).toHaveLength(1)
})

it('advances native newer B through the original accepted A after a late ACK without replaying A', async () => {
  const h = await fixture(), reveal = lostSuccessfulAck(h)
  expect(await h.slice.commitSlideContentInput().catch(error => error)).toHaveProperty('operationId')
  h.slice.updateSlideDataDraft(createTextComponentData('new B'))
  reveal(); await h.slice.commitSlideContentInput()
  expect(textComponentDataSchema.parse(h.model().project.instances.text.data).content.inlines).toMatchObject([{ text: 'new B' }])
  expect(h.operations).toHaveLength(2)
  expect(h.owned().slideContentEdit?.commitError).toBeUndefined()
})

it('keeps a real external native content conflict after original A is confirmed instead of rebasing B onto C', async () => {
  const h = await fixture(), reveal = lostSuccessfulAck(h)
  expect(await h.slice.commitSlideContentInput().catch(error => error)).toHaveProperty('operationId')
  const snapshot = h.first.read()
  await h.first.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: 'external-C', actor: 'agent',
    mutation: { type: 'command', command: captureComponentOperation(h.model().project, [{ type: 'data.set', instanceId: 'text', path: ['content'],
      value: createTextComponentData('external C').content as unknown as JsonValue }]) } })
  h.slice.updateSlideDataDraft(createTextComponentData('new B'))
  reveal(); await expect(h.slice.commitSlideContentInput()).rejects.toThrow()
  expect(textComponentDataSchema.parse(h.model().project.instances.text.data).content.inlines).toMatchObject([{ text: 'external C' }])
  expect(textComponentDataSchema.parse(h.owned().slideContentEdit?.data).content.inlines).toMatchObject([{ text: 'new B' }])
})

it('advances source-region offsets through original A before completing newer source B', async () => {
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'source-late-ack', revision: 0, title: '源码输入',
    definitions: { custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } } },
    instances: { field: { id: 'field', definitionId: 'custom', data: { html: '<p>old</p>' } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '页', childIds: ['field'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const h = await createV10StoreHost(project); hosts.push(h)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  await slice.beginSlideSpotEdit({ id: 'source', instanceId: 'field', kind: 'text', mountGeneration: 1, initialValue: 'old',
    sourceRegion: { kind: 'data', path: ['html'], start: 3, end: 6, encoding: 'html-text' }, localBounds: { width: 200, height: 100, transform: [1, 0, 0, 1, 0, 0] } })
  slice.updateSlideSpotDraft('A')
  const reveal = lostSuccessfulAck(h)
  expect(await slice.commitSlideContentEdit().catch(error => error)).toHaveProperty('operationId')
  slice.updateSlideSpotDraft('new B')
  reveal(); await slice.commitSlideContentEdit()
  expect(h.model().project.instances.field.data).toEqual({ html: '<p>new B</p>' })
  expect(h.operations).toHaveLength(2)
  expect(owned.slideContentEdit).toBeNull()
})

it('retains a true overlapping input without taking the active editor from the current target', async () => {
  const h = await fixture()
  h.slice.cancelTextEdit()
  await h.kernel.edit([{ type: 'data.set', instanceId: 'text', path: ['content'], value: createTextComponentData('other writer').content as unknown as JsonValue }])
  expect(h.lifecycle.restore(h.first.documentId, h.records).issues).toEqual([])
  expect(h.owned().slideContentEdit).toBeNull()
  expect(h.owned().retainedSlideContentEdits).toHaveLength(1)
  expect(await h.lifecycle.prepare(h.first.documentId)).toEqual({ ready: true, issues: [] })
  const current = h.slice.beginSlideDataEdit('text')!
  expect(textComponentDataSchema.parse(current.data).content.inlines).toMatchObject([{ text: 'other writer' }])
  expect(slideContentEditInScope(current, { documentId: 'other-document', epoch: current.target.epoch, surfaceId: current.target.surfaceId, activeStateId: null })).toBeNull()
  expect(slideContentEditInScope(current, { documentId: current.target.documentId, epoch: current.target.epoch, surfaceId: current.target.surfaceId, activeStateId: null })).toBe(current)
})

it('durably retains surface A raw before surface B succeeds and clears, including a fresh recovery owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editing-scope-')); directories.push(root)
  const h = await fixture()
  const snapshot = h.first.read()
  const owner = { ...snapshot, binding: { kind: 'file', path: path.join(root, 'project.glx'), version: 'disk', bindingVersion: 1 } } as Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'model' | 'binding'>
  const inputs = new DocumentInputRecovery(path.join(root, 'raw'))
  const port = createFlowDocumentRecoveryPort({ readAuthoringDrafts: () => inputs.read(owner),
    writeAuthoringDrafts: (_id, drafts) => inputs.write(owner, drafts), claimAuthoringDrafts: (_id, _epoch, claims) => inputs.claim(owner, claims) })
  const targetA = { documentId: owner.documentId, documentEpoch: owner.epoch, projectId: h.model().project.id,
    projectPath: path.join(root, 'project.glx'), epoch: 'input-owner-A', surfaceId: 'flow-A', revision: 0 }
  const rawA = { ...targetA, source: '$unfinished A', composing: false, diagnostics: [] }
  await port.write(rawA, targetA)
  await port.retain!(rawA, targetA)
  await port.clear(targetA)
  const targetB = { ...targetA, epoch: 'input-owner-B', surfaceId: 'flow-B' }
  await port.write({ ...targetB, source: 'B input', composing: false, diagnostics: [] }, targetB)
  await port.clear(targetB)
  const cold = new DocumentInputRecovery(path.join(root, 'raw'))
  const reopened = { ...owner, documentId: 'reopened-document', epoch: 'new-session' }
  expect((await cold.read(reopened))?.flow?.map(record => record.source)).toEqual(['$unfinished A'])
})

it('preserves explicit range removal through parking, original recovery directory and archive cold reconstruction', async () => {
  const h = await fixture(true)
  h.slice.updateSlideDataDraft(h.model().project.instances.text.data, false, undefined, undefined, [{ path: ['content'], ranges: [] }])
  const records = h.lifecycle.preserve(h.first.documentId)
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'editing-scope-')); directories.push(root)
  const owner = { ...h.first.read(), binding: { kind: 'file', path: path.join(root, 'ranges.glx'), version: 'disk', bindingVersion: 1 } } as Pick<DocumentSnapshot, 'documentId' | 'epoch' | 'model' | 'binding'>
  await new DocumentInputRecovery(path.join(root, 'raw')).write(owner, { advanced: records })
  h.slice.parkSlideContentEdit(h.first.documentId)
  const model = h.driver.load(h.driver.serialize(h.model()))
  if (model.kind !== 'course-v10') throw new Error('Expected course model')
  const cold = await createV10StoreHost(model.project, model.resources); hosts.push(cold)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(cold.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const recovered = await new DocumentInputRecovery(path.join(root, 'raw')).read({ ...cold.first.read(), binding: owner.binding })
  courseDraftLifecycle(cold.bridge).restore(cold.first.documentId, recovered?.advanced ?? [])
  expect(owned.slideContentEdit?.rangeProjection).toEqual([{ path: ['content'], ranges: [] }])
  await slice.commitSlideContentEdit()
  expect(textComponentDataSchema.parse(cold.model().project.instances.text.data).content.inlines).toEqual([{ type: 'text', text: 'old' }])
  expect(cold.model().project.instances.note).toBeUndefined()
})

it('materializes rich-field range intent locally and writes only the actual custom field after retention', async () => {
  const content = { inlines: [{ type: 'text' as const, text: 'same', rangeIds: ['R'] }] }
  const project = createTestProjectFromLegacy({ schemaVersion: 10, id: 'custom-field-recovery', revision: 0, title: '字段恢复',
    definitions: { custom: { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } },
      note: { id: 'note', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } } },
    instances: { field: { id: 'field', definitionId: 'custom', data: { cell: content }, childIds: ['note'] },
      note: { id: 'note', definitionId: 'note', data: { label: '注释', content: '注释正文' }, attachments: [
        { instanceId: 'note', target: { kind: 'text-range', instanceId: 'field', dataPath: ['cell'], rangeId: 'R' } }] } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '页', childIds: ['field'] }], global: { underlay: [], overlay: [] }, assets: {} })
  const h = await createV10StoreHost(project); hosts.push(h)
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(h.kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const spot: ComponentAuthorSpot = { id: 'cell', instanceId: 'field', kind: 'text', mountGeneration: 1, dataPath: ['cell'], initialValue: content,
    localBounds: { width: 300, height: 100, transform: [1, 0, 0, 1, 0, 0] } }
  await slice.beginSlideSpotEdit(spot)
  slice.updateSlideDataDraft(createTextComponentData(content), false, undefined, undefined, [{ path: ['content'], ranges: [] }])
  const lifecycle = courseDraftLifecycle(h.bridge), records = lifecycle.preserve(h.first.documentId)
  slice.cancelTextEdit()
  expect(lifecycle.restore(h.first.documentId, records).issues).toEqual([])
  await slice.commitSlideContentEdit()
  expect(h.model().project.instances.field.data).toEqual({ cell: { inlines: [{ type: 'text', text: 'same' }] } })
  expect(h.model().project.instances.note).toBeUndefined()
})
