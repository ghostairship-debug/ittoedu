// @vitest-environment node
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { deserialize, serialize } from 'node:v8'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentJournal, readDocumentFileVersion } from '../../src/main/workbench/documentJournal'
import { journalIdentity } from '../../src/main/workbench/JournalBindingIndex'
import { markdownReferences, readDocumentMarkdownResources } from '../../src/main/workbench/documentSourceResources'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { parseDocumentMarkdown } from '../../src/shared/document/markdown'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-journal-'))
  roots.push(root)
  const directory = path.join(root, 'recovery')
  return { root, directory, journal: createDocumentJournal({ directory }) }
}
const bytes = (value: string) => new TextEncoder().encode(value)
const model = (source = '正文'): DocumentModel => ({ kind: 'markdown', source, resources: { assets: {}, components: {} } })
const componentReference = '\n```cw-object-v1\n' + JSON.stringify({ kind: 'flow-block', block: { id: 'code', type: 'code', code: '' },
  resources: { assets: [], components: [{ packageId: 'demo', version: '1', source: { kind: 'relative', path: 'packages/demo' } }] } }) + '\n```\n'
function state(documentId = 'document-a', sequence = 0): DurableDocumentState {
  return { schemaVersion: 2, disposition: 'active', documentId, epoch: 'epoch-a', sequence, revision: sequence, savedRevision: null,
    binding: { kind: 'untitled', suggestedName: '未命名.md' }, model: model(), past: [], future: [], operations: [], stoppedRuns: [] }
}
const journalFile = (directory: string, id: string) => path.join(directory, `${createHash('sha256').update(id).digest('hex')}.journal`)
async function waitForBindingIndex(filename: string, sequence: number) {
  await expect.poll(async () => {
    try {
      const envelope = JSON.parse(await fs.readFile(`${filename}.binding.json`, 'utf8')), entry = JSON.parse(envelope.body)
      return { version: envelope.version, sequence: entry.sequence, fresh: entry.identity === await journalIdentity(filename) }
    } catch { return null }
  }).toEqual({ version: 2, sequence, fresh: true })
}

/** Save refuses a revision that was never appended to this document's recovery journal. */
async function remember(journal: ReturnType<typeof createDocumentJournal>, documentId: string, revision: number, source = '正文') {
  await journal.append({ ...state(documentId, revision), model: model(source) })
}

describe('G20 durable document journal', () => {
  it('reads legacy active journals and upgrades the next Session write without changing document content', async () => {
    const { directory, journal } = await fixture()
    const current = state('legacy')
    current.schemaVersion = 1
    delete current.disposition
    const payload = serialize(current), header = Buffer.alloc(48)
    Buffer.from('G20JNL01').copy(header)
    header.writeUInt32BE(payload.length, 8)
    header.writeUInt32BE((~payload.length) >>> 0, 12)
    createHash('sha256').update(payload).digest().copy(header, 16)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(journalFile(directory, current.documentId), Buffer.concat([header, payload, Buffer.from('G20DONE!')]))
    expect(await journal.recover(current.documentId)).toEqual(current)
    const restored = await DocumentSession.restore(current, 'new-epoch', createMarkdownDriver(), journal)
    expect(restored.read().model).toEqual(current.model)
    expect(await journal.recover(current.documentId)).toMatchObject({ schemaVersion: 3, disposition: 'active', sequence: 1, epoch: 'new-epoch' })
  })

  it.each(['closed', 'discarded'] as const)('keeps %s records out of recovery and binding reservations after restart', async disposition => {
    const { directory, journal } = await fixture(), current = state(`terminal-${disposition}`)
    await journal.append(current)
    await journal.finalize!(current, disposition)
    const restarted = createDocumentJournal({ directory })
    expect(await restarted.recover(current.documentId)).toBeNull()
    expect(await restarted.list()).toEqual([])
    expect(await restarted.listBindings()).toEqual([])
    expect(await restarted.inspect(current.documentId)).toMatchObject({ schemaVersion: 2, disposition, sequence: 1, revision: current.revision })
    // The previous reader accepted schemaVersion 1 only. Both the terminal payload
    // and its optional index now carry version 2 rather than looking active to it.
    const filename = journalFile(directory, current.documentId), encoded = await fs.readFile(filename)
    const firstSize = encoded.readUInt32BE(8), lastOffset = 48 + firstSize + 8
    const terminal = deserialize(encoded.subarray(lastOffset + 48, lastOffset + 48 + encoded.readUInt32BE(lastOffset + 8))) as DurableDocumentState
    expect(terminal.schemaVersion).not.toBe(1)
    await waitForBindingIndex(filename, 1)
    expect(JSON.parse(await fs.readFile(`${filename}.binding.json`, 'utf8')).version).toBe(2)
    await expect(restarted.append({ ...current, sequence: 2 })).rejects.toMatchObject({ code: 'journal-sequence-conflict' })
  })

  it('persists discard before cleanup and never restores its draft if journal deletion fails', async () => {
    const { directory, journal } = await fixture(), current = state('discard-cleanup-failure')
    await journal.append(current)
    const filename = journalFile(directory, current.documentId), remove = fs.rm.bind(fs)
    vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target) === filename) throw Object.assign(new Error('journal is busy'), { code: 'EBUSY' })
      return remove(target, options)
    })
    await expect(journal.discard(current.documentId)).rejects.toThrow('journal is busy')
    const restarted = createDocumentJournal({ directory })
    expect(await restarted.inspect(current.documentId)).toMatchObject({ disposition: 'discarded', sequence: 1 })
    expect(await restarted.recover(current.documentId)).toBeNull()
    expect(await restarted.listBindings()).toEqual([])
    vi.restoreAllMocks()
    await restarted.discard(current.documentId)
    await expect(fs.stat(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not delete an active journal when the terminal write fails', async () => {
    const { directory, journal } = await fixture(), current = state('discard-ack-failure')
    await journal.append(current)
    const filename = journalFile(directory, current.documentId), open = fs.open.bind(fs)
    vi.spyOn(fs, 'open').mockImplementation(async (target, flags, ...rest) => {
      if (String(target) === filename && flags === 'a+') throw new Error('disk full')
      return open(target, flags, ...rest)
    })
    await expect(journal.discard(current.documentId)).rejects.toThrow('disk full')
    expect(await createDocumentJournal({ directory }).recover(current.documentId)).toMatchObject({ disposition: 'active', sequence: 0 })
  })

  it('recovers resources, history and receipts atomically, discards only a torn tail and rejects complete corruption', async () => {
    const { directory, journal } = await fixture()
    const first = state()
    first.model.resources.assets['assets/a.bin'] = new Uint8Array([0, 255, 13, 10])
    first.model.resources.components['packages/a'] = { 'index.js': bytes('export default 1') }
    first.past.push({ operationId: 'op-a', before: model('旧'), after: first.model })
    first.operations.push({ operationId: 'op-a', digest: 'payload-a', result: { status: 'applied', documentId: first.documentId, operationId: 'op-a', beforeRevision: 0, revision: 1, persistence: 'recoverable' } })
    first.stoppedRuns.push('cancelled-run')
    await journal.append(first)
    const filename = journalFile(directory, first.documentId)
    const committed = await fs.readFile(filename)
    await journal.append(first) // Lost ACK retries must not create another record.
    expect((await fs.stat(filename)).size).toBe(committed.length)
    await expect(journal.append({ ...first, revision: 99 })).rejects.toMatchObject({ code: 'journal-sequence-conflict' })
    const other = state('document-b')
    await journal.append(other)
    const recovered = await createDocumentJournal({ directory }).recover(first.documentId)
    expect(recovered).toEqual(first)
    expect(recovered!.model.resources.assets['assets/a.bin']).toBeInstanceOf(Uint8Array)
    expect(await journal.list()).toEqual(expect.arrayContaining(['document-a', 'document-b']))
    expect(await journal.recover('unknown')).toBeNull()

    await journal.append({ ...first, sequence: 1, revision: 1, model: model('新') })
    const complete = await fs.readFile(filename)
    const tail = complete.subarray(committed.length)
    for (const length of [7, 48, tail.length - 1]) {
      await fs.writeFile(filename, Buffer.concat([committed, tail.subarray(0, length)]))
      expect(await createDocumentJournal({ directory }).recover(first.documentId)).toEqual(first)
      expect((await fs.stat(filename)).size).toBe(committed.length)
    }
    const corrupted = Buffer.from(complete)
    corrupted[committed.length + 50] ^= 1
    await fs.writeFile(filename, corrupted)
    await expect(journal.recover(first.documentId)).rejects.toMatchObject({ code: 'journal-corrupt' })
    expect(await fs.readFile(filename)).toEqual(corrupted) // Never silently truncate committed history.
    expect(await journal.recover('document-b')).toEqual(other)
  })

  it('reconciles an interrupted text Save As from its recorded save intent', async () => {
    const { root, directory, journal } = await fixture()
    const documentId = 'text-save-intent'
    const source = '<!doctype html>\r\n<title>课件</title>\r\n'
    const draft: DocumentModel = { kind: 'text', source, resources: { assets: {}, components: {} } }
    await journal.append({ ...state(documentId, 1), model: draft })
    const filename = path.join(root, 'lesson.html')
    await journal.save({ documentId, revision: 1, model: draft, bytes: bytes(source),
      binding: { kind: 'file', path: filename, version: null, bindingVersion: 1 } })
    expect(await fs.readFile(filename, 'utf8')).toBe(source)
    const recovered = await createDocumentJournal({ directory }).recover(documentId)
    expect(recovered).toMatchObject({ savedRevision: 1, binding: { kind: 'file', path: filename, bindingVersion: 1 } })
    expect(recovered?.binding.kind === 'file' && recovered.binding.version).toBe(await readDocumentFileVersion(filename, 'text'))
  })

  it('saves the captured revision, preserves Save As originals and refuses external file changes', async () => {
    const { root, journal } = await fixture()
    const filename = path.join(root, 'lesson.md')
    const draft = model('revision r')
    const serialized = bytes('revision r')
    const input = { documentId: 'doc', revision: 4, model: draft, bytes: serialized,
      binding: { kind: 'file' as const, path: filename, version: null, bindingVersion: 1 } }
    await remember(journal, 'doc', 4, 'revision r')
    const saving = journal.save(input)
    if (draft.kind === 'markdown') draft.source = 'revision r+1'
    serialized.fill(0)
    const binding = await saving
    expect(await fs.readFile(filename, 'utf8')).toBe('revision r')
    expect(draft.kind === 'markdown' && draft.source).toBe('revision r+1')
    expect(binding.version).toBe(await readDocumentFileVersion(filename, 'markdown'))
    expect(binding.path).toBe(filename)
    await fs.writeFile(filename, 'external writer')
    await expect(journal.save({ ...input, binding, model: model('my new draft'), bytes: bytes('my new draft') })).rejects.toMatchObject({ code: 'file-conflict' })
    expect(await fs.readFile(filename, 'utf8')).toBe('external writer')
    const copy = path.join(root, 'copy.md')
    const copyBinding = await journal.save({ ...input, binding: { ...binding, path: copy, version: null, bindingVersion: 2 }, model: model('my new draft'), bytes: bytes('my new draft') })
    expect(await fs.readFile(copy, 'utf8')).toBe('my new draft')
    expect(await fs.readFile(filename, 'utf8')).toBe('external writer')
    await expect(journal.save({ ...input, model: model('overwrite'), bytes: bytes('overwrite') })).rejects.toMatchObject({ code: 'file-conflict' })
    expect(copyBinding.bindingVersion).toBe(2)
  })

  it('keeps Markdown resource closure complete, protects shared attachments, and leaves the old file intact on save failure', async () => {
    const { root, journal } = await fixture()
    const filename = path.join(root, 'lesson.md')
    const source = '![图片](assets/image.bin)' + componentReference
    const draft = model(source)
    draft.resources.assets['assets/image.bin'] = new Uint8Array([0, 255, 1])
    draft.resources.components['packages/demo'] = { 'index.js': bytes('export default {}'), 'media/part.bin': bytes('component media') }
    const input = { documentId: 'doc', revision: 1, model: draft, bytes: bytes(source),
      binding: { kind: 'file' as const, path: filename, version: null, bindingVersion: 1 } }
    await remember(journal, 'doc', 1, source)
    const rename = fs.rename.bind(fs)
    let failPackage = true
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === path.join(root, 'packages/demo') && failPackage) {
        failPackage = false
        throw new Error('injected package publish failure')
      }
      return rename(from, to)
    })
    await expect(journal.save(input)).rejects.toThrow('injected package publish failure')
    await expect(fs.access(filename)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.access(path.join(root, 'packages/demo'))).rejects.toMatchObject({ code: 'ENOENT' })
    const binding = await journal.save(input)
    expect(await fs.readFile(path.join(root, 'assets/image.bin'))).toEqual(Buffer.from([0, 255, 1]))
    expect(await fs.readFile(path.join(root, 'packages/demo/media/part.bin'), 'utf8')).toBe('component media')
    const changed = model(source)
    changed.resources.assets['assets/image.bin'] = bytes('replacement')
    await expect(journal.save({ ...input, binding, model: changed })).rejects.toMatchObject({ code: 'resource-conflict' })
    expect(await fs.readFile(filename, 'utf8')).toBe(source)
    const extended = model(source)
    extended.resources.components['packages/demo'] = { 'new.js': bytes('new') }
    await expect(journal.save({ ...input, binding, model: extended })).rejects.toMatchObject({ code: 'resource-conflict' })
    await expect(fs.access(path.join(root, 'packages/demo/new.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    const invalid = model('![坏路径](../outside.bin)')
    await expect(journal.save({ ...input, binding, model: invalid, bytes: bytes(invalid.kind === 'markdown' ? invalid.source : '') })).rejects.toThrow()
    const incomplete = model('![missing](packages/demo/missing.bin)')
    incomplete.resources.components = draft.resources.components
    await expect(journal.save({ ...input, binding, model: incomplete, bytes: bytes(incomplete.kind === 'markdown' ? incomplete.source : '') })).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(filename, 'utf8')).toBe(source)

    const next = model('![new](assets/new.bin)')
    next.resources.assets['assets/new.bin'] = bytes('complete new resource')
    let failReplacement = true
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === filename && failReplacement) {
        failReplacement = false
        throw Object.assign(new Error('injected replacement failure'), { code: 'EACCES' })
      }
      return rename(from, to)
    })
    await expect(journal.save({ ...input, binding, model: next, bytes: bytes('![new](assets/new.bin)') })).rejects.toThrow('injected replacement failure')
    expect(await fs.readFile(filename, 'utf8')).toBe(source)
    expect(await fs.readFile(path.join(root, 'assets/new.bin'), 'utf8')).toBe('complete new resource')
    expect((await fs.readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await fs.writeFile(path.join(root, 'assets/image.bin'), 'external changed attachment')
    expect(await readDocumentFileVersion(filename, 'markdown')).not.toBe(binding.version)
    await expect(journal.save({ ...input, binding })).rejects.toMatchObject({ code: 'file-conflict' })
  })

  it('opens literal Markdown with dangling links and malformed extension JSON, then preserves source and local resources on Save As', async () => {
    const { root, journal } = await fixture()
    const original = path.join(root, 'original')
    const destination = path.join(root, 'copy')
    await fs.mkdir(path.join(original, 'assets'), { recursive: true })
    await fs.mkdir(path.join(original, 'packages/demo/media'), { recursive: true })
    await fs.mkdir(destination)
    const source = '# 标题\r\n\r\n![图片](assets/photo.bin)\r\n[旧失效链接](missing.txt)\r\n\r\n```cw-object-v1\r\n{ 未完成 JSON\r\n```\r\n' + componentReference
    const filename = path.join(original, 'lesson.md')
    await fs.writeFile(filename, source)
    await fs.writeFile(path.join(original, 'assets/photo.bin'), new Uint8Array([0, 255, 2]))
    await fs.writeFile(path.join(original, 'packages/demo/index.js'), 'export default {}')
    await fs.writeFile(path.join(original, 'packages/demo/media/part.bin'), 'nested attachment')
    const resources = await readDocumentMarkdownResources(filename)
    expect(Object.keys(resources.assets)).toEqual(['assets/photo.bin'])
    expect(Object.keys(resources.components['packages/demo']).sort()).toEqual(['index.js', 'media/part.bin'])
    const draft: DocumentModel = { kind: 'markdown', source, resources }
    const version = await readDocumentFileVersion(filename, 'markdown')
    await remember(journal, 'doc', 2, source)
    await journal.save({ documentId: 'doc', revision: 2, model: draft, bytes: bytes(source),
      binding: { kind: 'file', path: filename, version, bindingVersion: 1 } })
    const copy = path.join(destination, 'copy.md')
    await journal.save({ documentId: 'doc', revision: 2, model: draft, bytes: bytes(source),
      binding: { kind: 'file', path: copy, version: null, bindingVersion: 2 } })
    expect(await fs.readFile(copy, 'utf8')).toBe(source)
    expect(await fs.readFile(filename, 'utf8')).toBe(source)
    expect(await readDocumentMarkdownResources(copy)).toEqual(resources)
    await expect(fs.access(path.join(destination, 'missing.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

it('CA-126 rejects externally replaced publication bytes without acknowledging or replaying the save', async () => {
  const { root, directory, journal } = await fixture(), filename = path.join(root, 'lesson.md')
  await fs.writeFile(filename, 'original')
  const binding = { kind: 'file' as const, path: filename, version: await readDocumentFileVersion(filename, 'markdown'), bindingVersion: 1 }
  const session = await DocumentSession.create({ documentId: 'publication-conflict', epoch: 'epoch', model: model('original'), binding, saved: true }, createMarkdownDriver(), journal)
  await session.execute({ documentId: session.documentId, epoch: 'epoch', baseRevision: 0, operationId: 'edit', actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: 'my draft' } } })
  const identity = { runId: 'run', operationId: 'save-original-intent', requestDigest: 'request' }
  const rename = fs.rename.bind(fs)
  const publication = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    await rename(source, target)
    if (String(target) === filename) await fs.writeFile(filename, 'external writer after publication')
  })
  await expect(session.save(undefined, undefined, identity)).rejects.toMatchObject({ publication: 'unknown', code: 'file-conflict' })
  publication.mockRestore()
  expect(session.read()).toMatchObject({ revision: 1, dirty: true, binding, model: { source: 'my draft' } })
  expect(await journal.lookupSave(session.documentId, identity)).toBeNull()
  expect(await createDocumentJournal({ directory }).recover(session.documentId)).toMatchObject({ savedRevision: 0, revision: 1, binding, model: { source: 'my draft' } })
  expect((await fs.readdir(directory)).some(name => name.endsWith('.save-intent.json'))).toBe(true)
  await expect(session.save()).rejects.toMatchObject({ publication: 'not-published', code: 'file-conflict' })
  expect(await fs.readFile(filename, 'utf8')).toBe('external writer after publication')
})

it('CA-066/104 saves and reopens navigation, literal object paths and local malformed objects without losing usable resources', async () => {
  const { root, journal } = await fixture(), original = path.join(root, 'original'), destination = path.join(root, 'copy')
  await fs.mkdir(path.join(original, 'resources'), { recursive: true }); await fs.mkdir(destination)
  for (const name of ['old.png', 'plot#1.png', 'plot%20one.png', 'raw%.png']) await fs.writeFile(path.join(original, 'resources', name), name)
  const object = { kind: 'flow-block', block: { id: 'kept-code', type: 'code', code: '' }, resources: { assets: [
    { assetId: 'hash', source: { kind: 'relative', path: 'resources/plot#1.png' } },
    { assetId: 'percent', source: { kind: 'relative', path: 'resources/plot%20one.png' } },
  ], components: [] } }
  const malformed = { resources: { assets: [{ assetId: 'hero' }, null, { source: { kind: 'relative', path: '../unsafe.bin' } }], components: {} } }
  const source = '[上级](../资料.md) [资源目录](resources) [百分号](raw%)\n<a href="../notes.md">导航</a>\n'
    + '![旧图](resources/old.png) ![百分号图](resources/raw%.png)\n```cw-object-v1\n' + JSON.stringify(object)
    + '\n```\n```cw-object-v1\n' + JSON.stringify(malformed) + '\n```\n后续正文\n'
  const filename = path.join(original, 'lesson.md'); await fs.writeFile(filename, source)
  expect(await markdownReferences(source)).toEqual(['resources/old.png', 'resources/plot#1.png', 'resources/plot%20one.png', 'resources/raw%.png'])
  let nextId = 0
  const parsed = parseDocumentMarkdown(source, { target: 'file', createId: kind => `${kind}-local-${++nextId}`, recoverUnsupportedBlocks: true,
    resolveImage: href => ({ assetId: `image-${++nextId}`, source: { kind: 'relative', path: href } }) })
  expect(parsed.status, JSON.stringify(parsed.diagnostics)).toBe('valid')
  expect(parsed.source).toBe(source)
  expect(parsed.diagnostics.length).toBeGreaterThan(0)
  const resources = await readDocumentMarkdownResources(filename)
  expect(Object.keys(resources.components)).toEqual([])
  expect(Object.keys(resources.assets).sort()).toEqual(await markdownReferences(source))
  const nextSource = source + '\n![新增](resources/new.png)\n', draft: DocumentModel = { kind: 'markdown', source: nextSource, resources }
  draft.resources.assets['resources/new.png'] = bytes('new image')
  await remember(journal, 'navigation', 1, nextSource)
  await journal.save({ documentId: 'navigation', revision: 1, model: draft, bytes: bytes(nextSource),
    binding: { kind: 'file', path: filename, version: await readDocumentFileVersion(filename, 'markdown'), bindingVersion: 1 } })
  const copy = path.join(destination, 'copy.md')
  await journal.save({ documentId: 'navigation', revision: 1, model: draft, bytes: bytes(nextSource),
    binding: { kind: 'file', path: copy, version: null, bindingVersion: 2 } })
  expect(await fs.readFile(copy, 'utf8')).toBe(nextSource)
  const reopened = await readDocumentMarkdownResources(copy)
  expect(Object.keys(reopened.assets).sort()).toEqual(Object.keys(draft.resources.assets).sort())
  expect(reopened.components).toEqual(draft.resources.components)
  for (const relative of Object.keys(reopened.assets)) expect(Buffer.from(reopened.assets[relative]!)).toEqual(Buffer.from(draft.resources.assets[relative]!))
  expect(await fs.readFile(path.join(destination, 'resources/plot#1.png'), 'utf8')).toBe('plot#1.png')
  expect(await fs.readFile(path.join(destination, 'resources/plot%20one.png'), 'utf8')).toBe('plot%20one.png')
})

it('reads recovery records without loading the whole journal and preserves history, receipts and stopped runs', async () => {
  const { directory, journal } = await fixture()
  const original = state('streamed')
  original.model.resources.assets['blob'] = new Uint8Array([1, 2, 3])
  original.past.push({ operationId: 'history', before: model('before'), after: original.model })
  original.future.push({ operationId: 'redo', before: original.model, after: model('after') })
  original.stoppedRuns.push('stopped')
  await journal.append(original)
  const filename = journalFile(directory, original.documentId)
  const beforeBytes = await fs.readFile(filename)
  const readFile = fs.readFile.bind(fs)
  vi.spyOn(fs, 'readFile').mockImplementation(((input: Parameters<typeof fs.readFile>[0], ...rest: unknown[]) => {
    if (String(input).endsWith('.journal')) throw new Error('whole-journal read forbidden')
    return (readFile as (...args: unknown[]) => Promise<unknown>)(input, ...rest)
  }) as typeof fs.readFile)
  expect(await createDocumentJournal({ directory }).recover('streamed')).toEqual(original)
  expect(await journal.list()).toEqual(['streamed'])
  expect(await readFile(filename)).toEqual(beforeBytes)
  await journal.append({ ...original, sequence: 1, revision: 1 })
  expect(await journal.recover('streamed')).toEqual({ ...original, sequence: 1, revision: 1 })
})

it('compacts repeated full snapshots without dropping undo/redo, receipts, resources or stop barriers', async () => {
  const { directory, journal } = await fixture()
  const current = state('checkpoint')
  current.model.resources.assets['large'] = new Uint8Array(2 * 1024 * 1024).fill(7)
  current.past.push({ operationId: 'old', before: model('before'), after: current.model })
  current.future.push({ operationId: 'redo', before: current.model, after: model('after') })
  current.operations.push({ operationId: 'old', digest: 'proof', result: { status: 'applied', documentId: current.documentId,
    operationId: 'old', beforeRevision: 0, revision: 1, persistence: 'recoverable' } })
  current.stoppedRuns.push('never-replay')
  await journal.append(current)
  const filename = journalFile(directory, current.documentId), oneRecord = (await fs.stat(filename)).size
  for (let sequence = 1; sequence < 12; sequence++) await journal.append({ ...current, sequence, revision: sequence })
  expect((await fs.stat(filename)).size).toBeLessThan(oneRecord * 8)
  const latest = { ...current, sequence: 11, revision: 11 }
  // Native typed-array comparison avoids enumerating millions of bytes in the test reporter.
  expect(isDeepStrictEqual(await createDocumentJournal({ directory }).recover(current.documentId), latest)).toBe(true)
  const compactSize = (await fs.stat(filename)).size
  await journal.append(latest)
  expect((await fs.stat(filename)).size).toBe(compactSize)
  expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
}, 20_000)

it('indexes bindings without reopening unrelated journal payloads and invalidates external changes', async () => {
  const { root, directory, journal } = await fixture()
  const a = { ...state('large-a'), binding: { kind: 'file' as const, path: path.join(root, 'a.md'), version: null, bindingVersion: 1 } }
  a.model = model('A'.repeat(1024 * 1024))
  await journal.append(a)
  const b = { ...state('b'), binding: { kind: 'file' as const, path: path.join(root, 'b.md'), version: null, bindingVersion: 1 } }
  await journal.append(b)
  await Promise.all([waitForBindingIndex(journalFile(directory, a.documentId), a.sequence), waitForBindingIndex(journalFile(directory, b.documentId), b.sequence)])
  const open = vi.spyOn(fs, 'open')
  const restarted = createDocumentJournal({ directory })
  expect((await restarted.listBindings()).map(entry => entry.documentId).sort()).toEqual(['b', 'large-a'])
  expect(open.mock.calls.some(call => String(call[0]).endsWith('.journal'))).toBe(false)
  await restarted.recover('b')
  expect(open.mock.calls.some(call => String(call[0]) === journalFile(directory, 'large-a'))).toBe(false)
  const filename = journalFile(directory, 'large-a'), original = await fs.readFile(filename)
  const corrupt = Buffer.from(original); corrupt[55] ^= 1
  await fs.writeFile(filename, corrupt)
  expect(await restarted.listBindings()).toEqual(expect.arrayContaining([expect.objectContaining({ documentId: 'large-a', unavailable: true }), expect.objectContaining({ documentId: 'b' })]))
  await expect(restarted.assertAvailable([a.binding.path])).rejects.toThrow('无法读取')
  await expect(restarted.assertAvailable([b.binding.path])).resolves.toBeUndefined()
  await expect(restarted.recover('large-a')).rejects.toMatchObject({ code: 'journal-corrupt' })
  expect(await fs.readFile(filename)).toEqual(corrupt)
})

it('keeps diagnostic inspection read-only and does not rescan history on a verified append', async () => {
  const { directory, journal } = await fixture(), first = state('indexed')
  await journal.append(first)
  const open = vi.spyOn(fs, 'open')
  await journal.append({ ...first, sequence: 1, revision: 1 })
  expect(open.mock.calls.filter(call => String(call[0]).endsWith('.journal') && call[1] === 'r')).toHaveLength(0)
  const filename = journalFile(directory, first.documentId)
  await fs.appendFile(filename, 'torn')
  const size = (await fs.stat(filename)).size
  expect(await journal.inspect(first.documentId)).toMatchObject({ sequence: 1 })
  expect((await fs.stat(filename)).size).toBe(size)
  expect(await journal.recover(first.documentId)).toMatchObject({ sequence: 1 })
  expect((await fs.stat(filename)).size).toBe(size - 4)
})

it('does not reload an unrelated clean journal merely because an acknowledged save intent remains', async () => {
  const { root, directory, journal } = await fixture(), filename = path.join(root, 'clean.md')
  await fs.writeFile(filename, 'clean')
  const binding = { kind: 'file' as const, path: filename, version: await readDocumentFileVersion(filename, 'markdown'), bindingVersion: 1 }
  const current = { ...state('clean', 1), model: model('clean'), binding, savedRevision: 1 }
  await journal.append(current)
  await journal.save({ documentId: current.documentId, revision: 1, model: current.model, binding, bytes: bytes('clean') })
  await waitForBindingIndex(journalFile(directory, current.documentId), current.sequence)
  const open = vi.spyOn(fs, 'open')
  expect((await createDocumentJournal({ directory }).listBindings())[0]).toMatchObject({ documentId: 'clean', savedRevision: 1, binding })
  expect(open.mock.calls.some(call => String(call[0]).endsWith('.journal'))).toBe(false)
})

it('keeps the durable append and complete history when checkpoint replacement fails', async () => {
  const { directory, journal } = await fixture(), current = state('failed-checkpoint')
  current.model.resources.assets['large'] = new Uint8Array(2 * 1024 * 1024).fill(9)
  current.past.push({ operationId: 'history', before: model('old'), after: current.model })
  current.stoppedRuns.push('stopped-run')
  const rename = fs.rename.bind(fs)
  let failedCheckpoints = 0
  vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
    if (String(source).includes('.checkpoint-')) { failedCheckpoints++; throw new Error('fixture replacement interrupted') }
    return rename(source, target)
  })
  for (let sequence = 0; sequence < 10; sequence++) await journal.append({ ...current, sequence, revision: sequence })
  expect(failedCheckpoints).toBeGreaterThan(0)
  expect(isDeepStrictEqual(await createDocumentJournal({ directory }).recover(current.documentId), { ...current, sequence: 9, revision: 9 })).toBe(true)
  expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([])
}, 20_000)
