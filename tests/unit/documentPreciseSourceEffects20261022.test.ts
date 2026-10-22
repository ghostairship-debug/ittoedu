import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { createDocumentAcceptedChange } from '../../src/core/documents/documentStateEffects'
import { DocumentJournalCodec, DocumentJournalDecoder } from '../../src/main/workbench/documentJournalCodec'
import { sourceEditsFromChanges, type SourceEdit, type SourceRangeChange } from '../../src/shared/document/sourceMerge'
import type { DurableDocumentState } from '../../src/shared/workbench/document'

const apply = (source: string, edits: readonly SourceEdit[]) => [...edits].reverse().reduce((value, edit) => value.slice(0, edit.from) + edit.text + value.slice(edit.to), source)
it.each([
  { before: 'abcdefghij', stages: [{ from: 3, to: 3, text: 'WXYZ' }, { from: 4, to: 6, text: 'Q' }], expected: [{ from: 3, to: 3, text: 'WQZ' }] },
  { before: 'abcdefghij', stages: [{ from: 2, to: 6, text: 'X' }, { from: 1, to: 4, text: 'YZ' }], expected: [{ from: 1, to: 7, text: 'YZ' }] },
  { before: '', stages: [{ from: 0, to: 0, text: 'added' }, { from: 0, to: 5, text: '' }], expected: [] },
])('composes actual replacements through inserted or deleted ranges without diffing the source: $before', ({ before, stages, expected }) => {
  const next = stages.reduce((value, edit) => apply(value, [edit]), before)
  const edits = sourceEditsFromChanges(before, next, stages.map(edit => ({ from: edit.from, to: edit.to, inserted: edit.text.length })))
  expect(edits).toEqual(expected)
  expect(apply(before, edits!)).toBe(next)
})

it('keeps the normal lossless replacement when range facts omit another actual source change', () => {
  expect(sourceEditsFromChanges('abc', 'aXY', [{ from: 1, to: 2, inserted: 1 }])).toBeUndefined()
  const resources = { assets: {}, components: {} }
  const effect = createDocumentAcceptedChange({ kind: 'text', source: 'abc', resources }, { kind: 'text', source: 'aXY', resources }, undefined, undefined,
    [{ from: 1, to: 2, inserted: 1 }])
  expect(effect).toMatchObject({ kind: 'source', edits: [{ from: 1, removed: 'bc', text: 'XY' }] })
})

it('retains distant accepted source ranges, group Undo/Redo and every receipt through a cold checkpoint', async () => {
  const middle = 'unchanged author body '.repeat(50_000), before = `old-records|${middle}|old-consumer`
  let durable!: DurableDocumentState
  const persistence = { async append(state: DurableDocumentState) { durable = state }, async save(): Promise<never> { throw new Error('No file save in the source effect fixture') } }
  const driver = new TextDriver(), session = await DocumentSession.create({ documentId: 'source-ranges', epoch: 'live', saved: true,
    binding: { kind: 'untitled', suggestedName: 'work.html' }, model: { kind: 'text', source: before, resources: { assets: {}, components: {} } } }, driver, persistence)
  const first: SourceEdit[] = [{ from: 0, to: 'old-records'.length, text: 'new-records' },
    { from: before.length - 'old-consumer'.length, to: before.length, text: 'upgraded-consumer' }]
  const after = apply(before, first)
  const dispatch = async (source: string, changes: SourceRangeChange[], operationId: string) => session.execute({ documentId: session.documentId, epoch: 'live',
    operationId, actor: 'human', baseRevision: session.readIdentity().revision, historyGroup: 'one-edit', textChanges: { source: changes, flow: [] },
    mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
  expect((await dispatch(after, [...first].reverse().map(edit => ({ from: edit.from, to: edit.to, inserted: edit.text.length })), 'first')).status).toBe('applied')
  const second = { from: 2, to: 5, text: 'WXYZ' }, latest = apply(after, [second])
  expect((await dispatch(latest, [{ from: second.from, to: second.to, inserted: second.text.length }], 'amend')).status).toBe('applied')
  expect(session.read().undoDepth).toBe(1)
  for (const type of ['undo', 'redo'] as const) {
    expect((await session.execute({ documentId: session.documentId, epoch: 'live', operationId: type, actor: 'human', baseRevision: session.readIdentity().revision,
      mutation: { type } })).status).toBe('applied')
    const source = session.read().model
    if (source.kind !== 'text') throw new Error('Expected source')
    expect(source.source).toBe(type === 'undo' ? before : latest)
  }
  expect(durable.operations).toHaveLength(4)
  for (const receipt of durable.operations) {
    expect(receipt.effect?.kind).toBe('source')
    if (receipt.effect?.kind !== 'source') throw new Error('Expected source effect')
    expect(receipt.effect.edits.reduce((size, edit) => size + edit.removed.length + edit.text.length, 0)).toBeLessThan(100)
  }
  const checkpoint = new DocumentJournalCodec().prepare('checkpoint', durable)
  const recovered = new DocumentJournalDecoder().decode(checkpoint.payload)
  if (recovered.type !== 'checkpoint') throw new Error('Expected checkpoint')
  const cold = await DocumentSession.restore(recovered.value, 'cold', driver, persistence)
  expect(cold.read().revision).toBe(4)
  expect(cold.committedChangesSince(0)).toHaveLength(4)
  expect(cold.readRevision(1)?.model).toMatchObject({ kind: 'text', source: after })
  expect(cold.readRevision(2)?.model).toMatchObject({ kind: 'text', source: latest })
  const source = cold.read().model
  if (source.kind !== 'text') throw new Error('Expected source')
  expect(source.source).toBe(latest)
})
