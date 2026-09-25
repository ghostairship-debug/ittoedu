// @vitest-environment node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentJournal, readDocumentFileVersion, readDocumentMarkdownResources } from '../../src/main/workbench/documentJournal'
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
function state(documentId = 'document-a', sequence = 0): DurableDocumentState {
  return { schemaVersion: 1, documentId, epoch: 'epoch-a', sequence, revision: sequence, savedRevision: null,
    binding: { kind: 'untitled', suggestedName: '未命名.md' }, model: model(), past: [], future: [], operations: [], stoppedRuns: [] }
}
const journalFile = (directory: string, id: string) => path.join(directory, `${createHash('sha256').update(id).digest('hex')}.journal`)

describe('G20 durable document journal', () => {
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

  it('saves the captured revision, preserves Save As originals and refuses external file changes', async () => {
    const { root, journal } = await fixture()
    const filename = path.join(root, 'lesson.md')
    const draft = model('revision r')
    const serialized = bytes('revision r')
    const input = { documentId: 'doc', revision: 4, model: draft, bytes: serialized,
      binding: { kind: 'file' as const, path: filename, version: null, bindingVersion: 1 } }
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
    const source = '![图片](assets/image.bin)\n[组件](packages/demo)'
    const draft = model(source)
    draft.resources.assets['assets/image.bin'] = new Uint8Array([0, 255, 1])
    draft.resources.components['packages/demo'] = { 'index.js': bytes('export default {}'), 'media/part.bin': bytes('component media') }
    const input = { documentId: 'doc', revision: 1, model: draft, bytes: bytes(source),
      binding: { kind: 'file' as const, path: filename, version: null, bindingVersion: 1 } }
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('injected package publish failure'))
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
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('injected replacement failure'))
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
    const source = '# 标题\r\n\r\n![图片](assets/photo.bin)\r\n[组件](packages/demo)\r\n[旧失效链接](missing.txt)\r\n\r\n```cw-object-v1\r\n{ 未完成 JSON\r\n```\r\n'
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
