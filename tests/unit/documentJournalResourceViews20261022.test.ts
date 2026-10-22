import { expect, it } from 'vitest'
import { DocumentJournalCodec, DocumentJournalDecoder } from '../../src/main/workbench/documentJournalCodec'
import { createDocumentAcceptedChange, createDocumentStateTransition } from '../../src/core/documents/documentStateEffects'
import type { DocumentModel, DurableDocumentState } from '../../src/shared/workbench/document'

it('retains one resource view across records and keeps replaced versions distinct', () => {
  const originalBytes = new Uint8Array([7, 8, 9]), replacedBytes = new Uint8Array([3, 2, 1])
  const model: DocumentModel = { kind: 'text', source: 'before', resources: { assets: { raw: originalBytes }, components: {} } }
  const initial: DurableDocumentState = { schemaVersion: 3, disposition: 'active', documentId: 'views', epoch: 'e', sequence: 0,
    revision: 0, savedRevision: 0, model, binding: { kind: 'untitled', suggestedName: 'views.txt' }, past: [], future: [], operations: [], stoppedRuns: [] }
  const afterModel: DocumentModel = { ...model, source: 'after', resources: { assets: { raw: originalBytes }, components: {} } }
  const effect = createDocumentAcceptedChange(model, afterModel)
  const after: DurableDocumentState = { ...initial, sequence: 1, revision: 1, model: afterModel,
    past: [{ operationId: 'input', actor: 'human', beforeRevision: 0, revision: 1, effects: [effect] }],
    operations: [{ operationId: 'input', digest: 'request', effect, result: { status: 'applied', documentId: 'views', operationId: 'input',
      beforeRevision: 0, revision: 1, persistence: 'recoverable' } }] }
  const codec = new DocumentJournalCodec(), decoder = new DocumentJournalDecoder()
  const checkpoint = codec.prepare('checkpoint', initial); checkpoint.commit()
  const first = decoder.decode(checkpoint.payload)
  if (first.type !== 'checkpoint') throw new Error('expected checkpoint')
  const owned = first.value.model.resources.assets.raw
  const transition = codec.prepare('transition', createDocumentStateTransition(initial, after, effect)); transition.commit()
  const next = decoder.decode(transition.payload)
  if (next.type !== 'transition' || next.value.modelChange?.kind !== 'source') throw new Error('expected source transition')
  expect(next.value.modelChange.beforeResources.assets.raw).toBe(owned)
  expect(next.value.modelChange.afterResources.assets.raw).toBe(owned)
  expect(owned).toBeInstanceOf(Uint8Array)
  const replacement = createDocumentAcceptedChange(afterModel, { ...afterModel, resources: { assets: { raw: replacedBytes }, components: {} } })
  const replacementRecord = codec.prepare('transition', { documentId: 'views', baseSequence: 1, sequence: 2, epoch: 'e', revision: 2,
    savedRevision: 0, disposition: 'active', modelChange: replacement }); replacementRecord.commit()
  const replaced = decoder.decode(replacementRecord.payload)
  if (replaced.type !== 'transition' || replaced.value.modelChange?.kind !== 'source') throw new Error('expected resource transition')
  expect(replaced.value.modelChange.beforeResources.assets.raw).toBe(owned)
  expect(replaced.value.modelChange.afterResources.assets.raw).not.toBe(owned)
  expect(Array.from(owned)).toEqual([7, 8, 9])
  expect(Array.from(replaced.value.modelChange.afterResources.assets.raw)).toEqual([3, 2, 1])
  const freshCheckpoint = codec.prepare('checkpoint', after); freshCheckpoint.commit()
  const fresh = decoder.decode(freshCheckpoint.payload)
  if (fresh.type !== 'checkpoint') throw new Error('expected independent checkpoint')
  const savedEffect = fresh.value.past[0].effects![0]
  if (savedEffect.kind !== 'source') throw new Error('expected source effect')
  expect(fresh.value.model.resources.assets.raw).toBe(savedEffect.beforeResources.assets.raw)
  expect(fresh.value.model.resources.assets.raw).not.toBe(owned)
})
