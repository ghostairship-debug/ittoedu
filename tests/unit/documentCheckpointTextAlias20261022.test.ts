import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentJournalCodec, DocumentJournalDecoder } from '../../src/main/workbench/documentJournalCodec'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'

const state = (model: DocumentModel, savedModel: DocumentModel): DurableDocumentState => ({ schemaVersion: 3, disposition: 'active',
  documentId: 'text-alias', epoch: 'live', sequence: 0, revision: 0, savedRevision: 0, model, savedModel,
  binding: { kind: 'untitled', suggestedName: 'work.txt' }, past: [], future: [], operations: [], stoppedRuns: [] })
const checkpoint = (input: DurableDocumentState) => new DocumentJournalCodec().prepare('checkpoint', input).payload
const decode = (payload: Uint8Array) => {
  const result = new DocumentJournalDecoder().decode(payload)
  if (result.type !== 'checkpoint') throw new Error('Expected checkpoint')
  return result.value
}

it.each(['text', 'markdown'] as const)('encodes equal current/saved %s facts once without changing the input roles', kind => {
  const source = '保留正文'.repeat(65_536), resources = { assets: { image: new Uint8Array([1, 2, 3]) }, components: {} }
  const model: DocumentModel = { kind, source, resources }, savedModel = { ...model }
  const input = state(model, savedModel), payload = checkpoint(input), restored = decode(payload)
  // A separate resources map cannot share the wrapper even when its content is equal.
  const separate = checkpoint(state(model, { ...savedModel, resources: { ...resources } }))
  expect(separate.length - payload.length).toBeGreaterThan(source.length)
  expect(input.model).toBe(model)
  expect(input.savedModel).toBe(savedModel)
  expect(input.savedModel).not.toBe(input.model)
  expect(restored.model).toBe(restored.savedModel)
  expect(restored.model).toEqual(model)
})

it('keeps different source, resource identity, and kind as distinct checkpoint models', () => {
  const model: DocumentModel = { kind: 'text', source: 'current', resources: { assets: {}, components: {} } }
  for (const saved of [{ ...model, source: 'saved' }, { ...model, resources: { assets: {}, components: {} } },
    { ...model, kind: 'markdown' as const }]) {
    const restored = decode(checkpoint(state(model, saved)))
    expect(restored.model).not.toBe(restored.savedModel)
    expect(restored.model).toEqual(model)
    expect(restored.savedModel).toEqual(saved)
  }
})

it('restores the saved target and preserves Undo history after decoding an aliased checkpoint', async () => {
  let durable!: DurableDocumentState
  const persistence = { async append(value: DurableDocumentState) { durable = value },
    async save(): Promise<never> { throw new Error('This fixture does not write a file') } }
  const driver = new TextDriver(), before = 'old body', after = 'new body'
  const live = await DocumentSession.create({ documentId: 'text-alias', epoch: 'live', saved: true,
    binding: { kind: 'untitled', suggestedName: 'work.txt' },
    model: { kind: 'text', source: before, resources: { assets: {}, components: {} } } }, driver, persistence)
  expect((await live.execute({ documentId: live.documentId, epoch: 'live', operationId: 'edit', actor: 'human', baseRevision: 0,
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 3, text: 'new' } } })).status).toBe('applied')
  const restored = decode(checkpoint({ ...durable, savedRevision: 1, savedModel: { ...durable.model } }))
  expect(restored.model).toBe(restored.savedModel)
  const cold = await DocumentSession.restore(restored, 'cold', driver, persistence)
  expect(cold.read().model).toMatchObject({ kind: 'text', source: after })
  expect(cold.readRevision(0)?.model).toMatchObject({ kind: 'text', source: before })
  expect((await cold.execute({ documentId: cold.documentId, epoch: 'cold', operationId: 'undo', actor: 'human', baseRevision: 1,
    mutation: { type: 'undo' } })).status).toBe('applied')
  expect(cold.read().model).toMatchObject({ kind: 'text', source: before })
  expect(durable.savedRevision).toBe(1)
  expect(durable.savedModel).toMatchObject({ kind: 'text', source: after })
  expect(durable.operations).toHaveLength(2)
})
