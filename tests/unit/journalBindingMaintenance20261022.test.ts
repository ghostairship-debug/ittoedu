// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { JournalBindingIndex, journalIdentity } from '../../src/main/workbench/JournalBindingIndex'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import type { DurableDocumentState } from '../../src/shared/workbench/document'

const roots: string[] = [], releases: Array<() => void> = []
afterEach(async () => {
  releases.splice(0).forEach(release => release())
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.join(path.resolve(os.tmpdir()), 'guoling-binding-maintenance-'))) throw new Error('Unexpected fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const state = (sequence = 0): DurableDocumentState => ({ schemaVersion: 3, disposition: 'active', documentId: 'maintained', epoch: 'epoch',
  sequence, revision: sequence, savedRevision: null, binding: { kind: 'untitled', suggestedName: 'work.txt' },
  model: { kind: 'text', source: `current-${sequence}`, resources: { assets: {}, components: {} } },
  past: [], future: [], operations: [], stoppedRuns: [] })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-binding-maintenance-')); roots.push(root)
  const filename = path.join(root, `${createHash('sha256').update('maintained').digest('hex')}.journal`)
  return { root, filename }
}
function delayIndexSync() {
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { started = resolve })
  releases.push(release)
  const open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const file = await open(...args)
    if (String(args[0]).includes('.binding-')) {
      const sync = file.sync.bind(file)
      file.sync = async () => { started(); await gate; await sync() }
    }
    return file
  })
  return { ready, release }
}

it('acknowledges the authoritative append while optional index fsync is blocked, and still recovers without that index', async () => {
  const { root, filename } = await fixture(), gate = delayIndexSync()
  const journal = createDocumentJournal({ directory: root })
  await journal.append(state())
  await gate.ready
  expect((await journal.listBindings())[0]).toMatchObject({ documentId: 'maintained', sequence: 0 })
  expect(await createDocumentJournal({ directory: root }).recover('maintained')).toMatchObject({ sequence: 0, model: state().model })
  gate.release()
  await expect.poll(async () => JSON.parse(await fs.readFile(`${filename}.binding.json`, 'utf8')).version).toBe(2)
})

it('coalesces pending metadata to the latest durable identity and never stamps old metadata with a newer journal identity', async () => {
  const { filename } = await fixture(), index = new JournalBindingIndex(), gate = delayIndexSync()
  await fs.writeFile(filename, 'first')
  await index.update(filename, state(), 0)
  await gate.ready
  await fs.appendFile(filename, '-second')
  await index.update(filename, state(1), 0)
  await fs.appendFile(filename, '-third')
  await index.update(filename, state(2), 0)
  expect(await index.read(filename)).toMatchObject({ sequence: 2 })
  gate.release()
  await expect.poll(async () => {
    try { return JSON.parse(JSON.parse(await fs.readFile(`${filename}.binding.json`, 'utf8')).body).sequence }
    catch { return -1 }
  }).toBe(2)
  expect(await new JournalBindingIndex().read(filename)).toMatchObject({ sequence: 2 })
  await index.discard(filename)
})

it('retires an in-flight optional writer before discard completes, preventing late binding resurrection', async () => {
  const { filename } = await fixture(), index = new JournalBindingIndex(), gate = delayIndexSync()
  await fs.writeFile(filename, 'journal')
  await index.update(filename, state(), 0)
  await gate.ready
  const discarded = index.discard(filename)
  gate.release()
  await discarded
  await expect(fs.stat(`${filename}.binding.json`)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await fs.readdir(path.dirname(filename))).filter(name => name.endsWith('.tmp'))).toEqual([])
})

it('does not mark old state fresh when an external write overtakes the captured durable head', async () => {
  const { filename } = await fixture(), index = new JournalBindingIndex()
  await fs.writeFile(filename, 'accepted')
  const acceptedIdentity = (await journalIdentity(filename))!
  await fs.appendFile(filename, '-external')
  await index.update(filename, state(), 0, acceptedIdentity)
  expect(await index.read(filename)).toBeNull()
  // A missing captured head is explicit; an externally recreated file must not
  // cause the optional updater to fetch a new identity for the old state.
  await index.update(filename, state(), 0, null)
  expect(await index.read(filename)).toBeNull()
  await index.discard(filename)
})
