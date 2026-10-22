import { expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { documentHostRequestSchema } from '../../src/shared/workbench/desktop'
import type { DocumentOperation, DurableDocumentState } from '../../src/shared/workbench/document'

async function fixture(source: string) {
  let durable!: DurableDocumentState
  const persistence = { async append(state: DurableDocumentState) { durable = state }, async save(): Promise<never> { throw new Error('No file save in this fixture') } }
  const session = await DocumentSession.create({ documentId: 'hinted-source', epoch: 'live', saved: true,
    binding: { kind: 'untitled', suggestedName: 'work.html' }, model: { kind: 'text', source, resources: { assets: {}, components: {} } } }, new TextDriver(), persistence)
  const operation = (next: string): DocumentOperation => ({ documentId: session.documentId, epoch: 'live', baseRevision: 0,
    operationId: 'replace', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: next } } })
  return { session, operation, durable: () => durable }
}

it('proves advisory ranges once, persists canonical facts and replays the same operation without the advisory data', async () => {
  const middle = 'unchanged author '.repeat(20_000), before = `alpha|${middle}|omega`, after = `ALPHA|${middle}|OMEGA!`
  const h = await fixture(before), operation = h.operation(after)
  const hints = [{ from: before.length - 5, to: before.length, inserted: 6 }, { from: 0, to: 5, inserted: 5 }]
  const applied = await h.session.execute(operation, { sourceChangeHints: hints })
  expect(applied.status).toBe('applied')
  const receipt = h.durable().operations[0]
  expect(receipt.effect?.kind).toBe('source')
  if (receipt.effect?.kind !== 'source') throw new Error('Expected source effect')
  expect(receipt.effect.edits.map(edit => [edit.from, edit.removed, edit.text])).toEqual([[0, 'alpha', 'ALPHA'], [before.length - 5, 'omega', 'OMEGA!']])
  expect(receipt.textChanges?.source).toEqual([{ from: 0, to: 5, inserted: 5 }, { from: before.length - 5, to: before.length, inserted: 6 }])
  expect(receipt.textChanges?.source).not.toEqual(hints)
  expect(receipt).not.toHaveProperty('sourceChangeHints')
  expect(operation).not.toHaveProperty('sourceChangeHints')
  expect(await h.session.execute(operation)).toEqual(applied)
  expect(await h.session.execute(operation, { sourceChangeHints: [{ from: 999, to: 999, inserted: 999 }] })).toEqual(applied)
  expect(h.durable().operations).toHaveLength(1)
  expect(h.session.read().revision).toBe(1)
  expect((await h.session.execute({ ...operation, operationId: 'stale' }, { sourceChangeHints: hints })).status).toBe('conflict')
})

it('keeps valid source content and drops unproved advisory facts when their basis omits another change', async () => {
  const h = await fixture('alpha|middle|omega'), operation = h.operation('ALPHA|middle|OMEGA!')
  expect((await h.session.execute(operation, { sourceChangeHints: [{ from: 0, to: 5, inserted: 6 }] })).status).toBe('applied')
  const receipt = h.durable().operations[0]
  expect(receipt.textChanges).toBeUndefined()
  expect(receipt).not.toHaveProperty('sourceChangeHints')
  expect(receipt.effect).toMatchObject({ kind: 'source', edits: [{ from: 0, removed: 'alpha|middle|omega', text: 'ALPHA|middle|OMEGA!' }] })
  expect(h.session.read().model).toMatchObject({ kind: 'text', source: 'ALPHA|middle|OMEGA!' })
})

it('keeps source advice outside the strict human operation schema without opening trusted Host facts', async () => {
  const h = await fixture('before'), operation = h.operation('after')
  const parsed = documentHostRequestSchema.parse({ type: 'dispatch', operation, sourceChangeHints: [{ from: 0, to: 6, inserted: 5 }] })
  if (parsed.type !== 'dispatch') throw new Error('Expected dispatch')
  expect(parsed.operation).toEqual(operation)
  expect(parsed.sourceChangeHints).toEqual([{ from: 0, to: 6, inserted: 5 }])
  const malformed = documentHostRequestSchema.parse({ type: 'dispatch', operation, sourceChangeHints: [{ from: -1, to: 1, inserted: 1 }] })
  expect(malformed).not.toHaveProperty('sourceChangeHints', expect.any(Array))
  for (const authority of [{ actor: 'agent' }, { runId: 'spoof' }, { requestDigest: 'spoof' }, { textChanges: { source: [], flow: [] } }, { sourceChangeHints: [] }])
    expect(documentHostRequestSchema.safeParse({ type: 'dispatch', operation: { ...operation, ...authority } }).success).toBe(false)
})
