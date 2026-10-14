// @vitest-environment node
import { serialize } from 'node:v8'
import { expect, it, vi } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { createTextDriver } from '../../src/core/drivers/TextDriver'
import * as digests from '../../src/core/documents/documentDigest'
import { documentEqual } from '../../src/core/documents/documentEqual'
import type { DocumentModel, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

const md = (source: string, bytes?: Uint8Array): Extract<DocumentModel, { kind: 'markdown' }> => ({ kind: 'markdown', source,
  resources: { assets: bytes ? { 'picture.png': bytes } : {}, components: {} } })
function persistence() {
  let last!: DurableDocumentState
  const port: DocumentPersistence = { async append(state) { last = state }, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('file')
    return { ...input.binding, version: 'saved' }
  } }
  return { port, get last() { return last } }
}

it('CA005 compares shared immutable bytes without hashing document models and detects real replacement', async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024), p = persistence(), driver = createMarkdownDriver()
  bytes[0] = 7
  const session = await DocumentSession.create({ documentId: 'perf', epoch: 'e', model: md('before', bytes), binding: { kind: 'untitled', suggestedName: 'perf.md' } }, driver, p.port)
  const digest = vi.spyOn(digests, 'documentDigest')
  try {
    const snapshot = session.read()
    const result = await session.execute({ documentId: 'perf', epoch: 'e', operationId: 'edit', baseRevision: 0, actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: 'after' } } })
    expect(result.status).toBe('applied')
    expect(digest.mock.calls.some(([value]) => value && typeof value === 'object' && 'kind' in value && 'resources' in value)).toBe(false)
    const changed = snapshot.model.resources.assets['picture.png'].slice(); changed[0] = 8
    expect(documentEqual(snapshot.model, { ...snapshot.model, resources: { assets: { 'picture.png': changed }, components: {} } })).toBe(false)
    expect(documentEqual(snapshot.model, { ...snapshot.model, source: 'before' })).toBe(true)
  } finally { digest.mockRestore() }
})

it('CA225 stores precise typing facts without an entire source in every receipt, and cold facts/Undo survive', async () => {
  const p = persistence(), driver = createMarkdownDriver(), source = '正文'.repeat(16_384)
  const session = await DocumentSession.create({ documentId: 'typing', epoch: 'e', model: md(source), binding: { kind: 'untitled', suggestedName: 'typing.md' } }, driver, p.port)
  for (let index = 0; index < 40; index++) {
    const result = await session.execute({ documentId: 'typing', epoch: 'e', operationId: `key-${index}`, baseRevision: index, actor: 'human', historyGroup: 'typing',
      mutation: { type: 'command', command: { type: 'markdown.splice', from: source.length + index, to: source.length + index, text: '字' } } })
    expect(result.status).toBe('applied')
  }
  expect(p.last.past).toHaveLength(1)
  expect(p.last.operations.every(receipt => receipt.before === undefined && receipt.after === undefined && receipt.sourceChange?.kind === 'edits')).toBe(true)
  const characters = p.last.operations.reduce((total, receipt) => total + (receipt.sourceChange?.kind === 'edits'
    ? receipt.sourceChange.edits.reduce((size, edit) => size + edit.removed.length + edit.text.length, 0) : 0), 0)
  expect(characters).toBe(40)
  const restored = await DocumentSession.restore(structuredClone(p.last), 'cold', driver, p.port)
  const changes = restored.committedChangesSince(0)
  expect(changes).toHaveLength(40)
  expect(changes[20]!.before).toMatchObject({ source: source + '字'.repeat(20) })
  expect(changes[20]!.after).toMatchObject({ source: source + '字'.repeat(21) })
  const undo = await restored.execute({ documentId: 'typing', epoch: 'cold', operationId: 'undo', baseRevision: 40, actor: 'human', mutation: { type: 'undo' } })
  expect(undo.status).toBe('applied'); expect(restored.read().model).toMatchObject({ source })
  const redo = await restored.execute({ documentId: 'typing', epoch: 'cold', operationId: 'redo', baseRevision: 41, actor: 'human', mutation: { type: 'redo' } })
  expect(redo.status).toBe('applied'); expect(restored.read().model).toMatchObject({ source: source + '字'.repeat(40) })
  // Actual journal payload evidence, reported without using a byte-budget correctness gate.
  expect(serialize(p.last).byteLength).toBeGreaterThan(0)
})

it('CA291 version listeners and Registry identity queries do not allocate model snapshots', async () => {
  const p = persistence(), driver = createMarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver], persistence: p.port,
    createId: (() => { let id = 0; return () => `id-${++id}` })(), bindingKey: binding => binding.path })
  const session = await registry.create(md('text', new Uint8Array(4 * 1024 * 1024)), 'perf.md')
  let versions = 0, full = 0
  for (let index = 0; index < 80; index++) session.subscribeVersion(event => { if (event.type === 'changed') { versions++; expect(event).not.toHaveProperty('model') } })
  session.subscribe(event => { if (event.type === 'changed') { full++; expect(event.snapshot.model.resources.assets['picture.png']).toHaveLength(4 * 1024 * 1024) } })
  const clone = vi.spyOn(globalThis, 'structuredClone')
  try {
    expect(registry.has(session.documentId)).toBe(true); expect(registry.has('cold')).toBe(false)
    expect(clone).not.toHaveBeenCalled()
    session.reportSaveFailure(new Error('diagnostic'))
    expect(versions).toBe(80); expect(full).toBe(1); expect(clone).toHaveBeenCalledTimes(1)
  } finally { clone.mockRestore() }
})

it.each(['markdown', 'text'] as const)('CA005 %s keeps owned unchanged resource bytes while its public apply stays detached', async kind => {
  const bytes = new Uint8Array(4 * 1024 * 1024), driver = kind === 'markdown' ? createMarkdownDriver() : createTextDriver()
  const model: DocumentModel = { ...md('before', bytes), kind }
  const owned = await driver.applyValidated!(model, { type: 'markdown.replace', source: 'after' })
  expect(owned.resources.assets['picture.png']).toBe(bytes)
  const publicResult = await driver.apply(model, { type: 'markdown.replace', source: 'after' })
  publicResult.resources.assets['picture.png'][0] = 9
  expect(model.resources.assets['picture.png'][0]).toBe(0)
})
