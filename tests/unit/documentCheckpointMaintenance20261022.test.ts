// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import * as archive from '../../src/main/workbench/documentArchiveWorker'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentJournalCodec, DocumentJournalDecoder } from '../../src/main/workbench/documentJournalCodec'
import { createDocumentAcceptedChange, createDocumentStateTransition } from '../../src/core/documents/documentStateEffects'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'

const roots: string[] = []
const checkpointControl = vi.hoisted(() => ({ calls: 0,
  invoke: undefined as undefined | ((value: DurableDocumentState) => Promise<Uint8Array>),
  real: undefined as undefined | ((value: DurableDocumentState) => Promise<Uint8Array>) }))
vi.mock('../../src/main/workbench/documentArchiveWorker', async importOriginal => {
  const actual = await importOriginal<typeof archive>()
  checkpointControl.real = actual.createDocumentJournalCheckpoint
  return { ...actual, createDocumentJournalCheckpoint: async (value: DurableDocumentState) => {
    checkpointControl.calls++
    return checkpointControl.invoke ? checkpointControl.invoke(value) : actual.createDocumentJournalCheckpoint(value)
  } }
})
afterEach(async () => {
  checkpointControl.calls = 0; checkpointControl.invoke = undefined
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), 'guoling-checkpoint-maintenance-'))) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const state = (): DurableDocumentState => ({ schemaVersion: 3, disposition: 'active', documentId: 'checkpoint-maintained', epoch: 'epoch',
  sequence: 0, revision: 0, savedRevision: null, binding: { kind: 'untitled', suggestedName: 'work.txt' },
  model: { kind: 'text', source: 'first', resources: { assets: {}, components: {} } }, past: [], future: [], operations: [], stoppedRuns: [] })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-checkpoint-maintenance-')); roots.push(root)
  const filename = path.join(root, `${createHash('sha256').update('checkpoint-maintained').digest('hex')}.journal`)
  return { root, filename, journal: createDocumentJournal({ directory: root }) }
}
const payload = (record: Uint8Array) => {
  const bytes = Buffer.from(record.buffer, record.byteOffset, record.byteLength)
  expect(bytes.subarray(0, 8).toString()).toBe('G20JNL01')
  return bytes.subarray(48, 48 + bytes.readUInt32BE(8))
}
const nextState = (before: DurableDocumentState, model: DocumentModel): DurableDocumentState => ({ ...before, model,
  sequence: before.sequence + 1, revision: before.revision + 1 })

it('uses the same checkpoint dictionary for worker encoding and original-buffer continuation, without transferring shared or unrelated bytes', async () => {
  const original = state(), backing = new Uint8Array(1024 * 1024).fill(91), bytes = backing.subarray(512, 520)
  original.model.resources = { assets: { first: bytes, alias: bytes }, components: { package: { 'asset.bin': bytes } } }
  original.savedModel = original.model
  const record = await archive.createDocumentJournalCheckpoint(original)
  expect(record.byteLength).toBeLessThan(8 * 1024)
  expect(backing.byteLength).toBe(1024 * 1024)
  expect(bytes[0]).toBe(91)
  const decoder = new DocumentJournalDecoder(), checkpoint = decoder.decode(payload(record))
  if (checkpoint.type !== 'checkpoint') throw new Error('expected checkpoint')
  expect(checkpoint.value.model.resources.assets.first).toBe(checkpoint.value.model.resources.assets.alias)
  expect(checkpoint.value.savedModel).toBe(checkpoint.value.model)
  expect(checkpoint.value.savedModel!.resources.assets.first).toBe(checkpoint.value.model.resources.assets.first)
  const codec = new DocumentJournalCodec(); codec.adoptCheckpoint(original)
  const model: DocumentModel = { kind: 'text', resources: original.model.resources, source: 'second' }
  const after = nextState(original, model), change = createDocumentAcceptedChange(original.model, model)
  const prepared = codec.prepare('transition', createDocumentStateTransition(original, after, change))
  expect(prepared.payload.byteLength).toBeLessThan(8 * 1024)
  const transition = decoder.decode(prepared.payload)
  if (transition.type !== 'transition' || transition.value.modelChange?.kind !== 'source') throw new Error('expected source transition')
  expect(transition.value.modelChange.afterResources.assets.first).toBe(checkpoint.value.model.resources.assets.first)
})

it('encodes equivalent immutable text endpoints once without mutating their input identities', () => {
  const original = state()
  original.model = { kind: 'text', source: '同一源文'.repeat(50_000), resources: { assets: {}, components: {} } }
  const base = new DocumentJournalCodec().prepare('checkpoint', original).payload
  original.savedModel = original.model
  const shared = new DocumentJournalCodec().prepare('checkpoint', original).payload
  expect(shared.byteLength).toBeLessThan(base.byteLength + 1024)
  const decoded = new DocumentJournalDecoder().decode(shared)
  if (decoded.type !== 'checkpoint') throw new Error('expected checkpoint')
  expect(decoded.value.savedModel).toBe(decoded.value.model)
  expect(isDeepStrictEqual(decoded.value, original)).toBe(true)
  const current = original.model, saved = { ...current }
  original.savedModel = saved
  const equivalentPayload = new DocumentJournalCodec().prepare('checkpoint', original).payload
  expect(equivalentPayload.byteLength).toBeLessThan(base.byteLength + 1024)
  const equivalent = new DocumentJournalDecoder().decode(equivalentPayload)
  if (equivalent.type !== 'checkpoint') throw new Error('expected checkpoint')
  // Equivalent text with the same immutable resources may share its encoded
  // endpoint, while the caller's current and saved model roles stay untouched.
  expect(original.model).toBe(current)
  expect(original.savedModel).toBe(saved)
  expect(original.savedModel).not.toBe(original.model)
  expect(equivalent.value.savedModel).toBe(equivalent.value.model)
  expect(isDeepStrictEqual(equivalent.value, original)).toBe(true)
})

it('lets a new durable suffix overtake blocked preparation and keeps the full current state when optional jobs fail', async () => {
  const { root, filename, journal } = await fixture(), initial = state()
  await journal.append(initial)
  const bytes = new Uint8Array(17 * 1024 * 1024).fill(23)
  const firstModel: DocumentModel = { kind: 'text', source: 'second', resources: { assets: { large: bytes }, components: {} } }
  const first = nextState(initial, firstModel), firstChange = createDocumentAcceptedChange(initial.model, firstModel)
  first.past = [{ operationId: 'accepted', effects: [firstChange] }]
  first.stoppedRuns = ['never-replay']
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  checkpointControl.invoke = async value => {
    if (++calls === 1) { await gate; return checkpointControl.real!(value) }
    throw new Error('optional worker unavailable')
  }
  await journal.appendTransition!(createDocumentStateTransition(initial, first, firstChange), first)
  await expect.poll(() => calls).toBe(1)
  const secondModel: DocumentModel = { ...firstModel, source: 'third' }
  const second = nextState(first, secondModel), secondChange = createDocumentAcceptedChange(firstModel, secondModel)
  await journal.appendTransition!(createDocumentStateTransition(first, second, secondChange), second)
  expect((await journal.inspect(initial.documentId))?.sequence).toBe(2)
  release()
  await expect.poll(() => calls).toBe(2)
  // The stale job was not allowed to replace its newer suffix. The next job's
  // injected failure also leaves the already acknowledged journal authoritative.
  const retained = await createDocumentJournal({ directory: root }).recover(initial.documentId)
  expect(retained).toMatchObject({ sequence: 2, revision: 2, stoppedRuns: ['never-replay'], model: { source: 'third' } })
  expect(retained!.past).toHaveLength(1)
  expect(retained!.model.resources.assets.large!.byteLength).toBe(bytes.byteLength)
  expect(new DocumentJournalDecoder().decode(payload(await fs.readFile(filename))).value.sequence).toBe(0)
  await journal.discard(initial.documentId)
}, 15_000)

it('publishes a complete worker checkpoint and appends an exact decodable resource-sharing continuation', async () => {
  const { root, filename, journal } = await fixture(), initial = state()
  await journal.append(initial)
  const bytes = new Uint8Array(17 * 1024 * 1024).fill(17)
  const firstModel: DocumentModel = { kind: 'text', source: 'second', resources: { assets: { large: bytes }, components: {} } }
  const first = nextState(initial, firstModel), change = createDocumentAcceptedChange(initial.model, firstModel)
  const failures: string[] = []
  let published = false
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (...args: Parameters<typeof fs.rename>) => {
    try {
      await rename(...args)
      if (String(args[0]).includes('.checkpoint-')) published = true
    } catch (error) { failures.push(String(error)); throw error }
  })
  checkpointControl.invoke = async value => {
    try { return await checkpointControl.real!(value) } catch (error) { failures.push(String(error)); throw error }
  }
  await journal.appendTransition!(createDocumentStateTransition(initial, first, change), first)
  await expect.poll(() => ({ published, calls: checkpointControl.calls, failures }), { timeout: 10_000 })
    .toEqual({ published: true, calls: 1, failures: [] })
  const decoded = new DocumentJournalDecoder().decode(payload(await fs.readFile(filename)))
  expect(decoded.type === 'checkpoint' ? decoded.value.sequence : -1).toBe(1)
  const secondModel: DocumentModel = { ...firstModel, source: 'after-checkpoint' }
  const second = nextState(first, secondModel)
  await journal.appendTransition!(createDocumentStateTransition(first, second, createDocumentAcceptedChange(firstModel, secondModel)), second)
  const restored = await createDocumentJournal({ directory: root }).recover(initial.documentId)
  expect(restored).toMatchObject({ sequence: 2, model: { source: 'after-checkpoint' } })
  expect(isDeepStrictEqual(restored!.model.resources.assets.large, bytes)).toBe(true)
  await journal.discard(initial.documentId)
}, 15_000)
