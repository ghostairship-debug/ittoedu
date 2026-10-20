// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import type { DocumentModel, DocumentSnapshot } from '../../src/shared/workbench/document'
import { uiDocumentEvent, uiDocumentResult, uiDocumentSnapshot, uiExportBuildRequest } from '../../src/main/workbench/uiDocumentSnapshot'

function model(): DocumentModel {
  const backing = new Uint8Array(4096).fill(217)
  backing.set([1, 2, 3, 4], 31)
  backing.set([11, 12, 13], 99)
  return { kind: 'text', source: 'unchanged author source', resources: {
    assets: { asset: backing.subarray(31, 35) },
    components: { component: { 'entry.js': Buffer.from(backing.buffer, 99, 3) } },
  } }
}
function snapshot(): DocumentSnapshot {
  return { documentId: 'document', epoch: 'epoch', revision: 0, model: model(), binding: { kind: 'untitled', suggestedName: 'draft.txt' },
    dirty: true, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
}
function bounded(value: DocumentModel) {
  const asset = value.resources.assets.asset, component = value.resources.components.component['entry.js']
  expect([...asset]).toEqual([1, 2, 3, 4])
  expect([...component]).toEqual([11, 12, 13])
  for (const bytes of [asset, component]) {
    expect(bytes.byteOffset).toBe(0)
    expect(bytes.buffer.byteLength).toBe(bytes.byteLength)
  }
}

describe('UI document resource backing', () => {
  it('copies exact view bytes from both resource containers without changing the Session or source snapshot', async () => {
    const session = await DocumentSession.create({ documentId: 'document', epoch: 'epoch', model: model(),
      binding: { kind: 'untitled', suggestedName: 'draft.txt' } }, new TextDriver(), {
      async append() {}, async save() { throw new Error('This transport check does not save files') },
    })
    const original = session.read(), output = uiDocumentSnapshot(original)
    bounded(output.model)
    expect(original.model.resources.assets.asset.buffer.byteLength).toBe(4096)
    expect(output.model.resources.assets.asset.buffer).not.toBe(original.model.resources.assets.asset.buffer)
    expect({ ...output, model: { ...output.model, resources: original.model.resources } }).toEqual(original)
    output.model.resources.assets.asset[0] = 42
    output.model.resources.components.component['entry.js'][0] = 43
    expect([...original.model.resources.assets.asset]).toEqual([1, 2, 3, 4])
    expect([...session.read().model.resources.assets.asset]).toEqual([1, 2, 3, 4])
    expect([...session.read().model.resources.components.component['entry.js']]).toEqual([11, 12, 13])
    expect(session.read()).toEqual(original)
  })

  it('serializes the document API’s declared snapshot, array, optional-save and disk-model carriers', () => {
    const original = snapshot()
    bounded((uiDocumentResult({ type: 'read', documentId: original.documentId }, original) as DocumentSnapshot).model)
    bounded((uiDocumentResult({ type: 'recoverable' }, [original]) as DocumentSnapshot[])[0]!.model)
    bounded((uiDocumentResult({ type: 'save-dialog', documentId: original.documentId }, original) as DocumentSnapshot).model)
    expect(uiDocumentResult({ type: 'save-dialog', documentId: original.documentId }, null)).toBeNull()
    const observation = { bindingVersion: 3, version: 'disk', baseSource: 'saved source', model: original.model }
    const disk = uiDocumentResult({ type: 'observe-file', documentId: original.documentId }, observation) as typeof observation
    bounded(disk.model)
    expect({ ...disk, model: observation.model }).toEqual(observation)
    const missing = { bindingVersion: 3, version: null, model: null }
    expect(uiDocumentResult({ type: 'observe-file', documentId: original.documentId }, missing)).toEqual(missing)
    const receipt = { status: 'applied', documentId: original.documentId, operationId: 'original-operation', beforeRevision: 0, revision: 1, persistence: 'recoverable' }
    expect(uiDocumentResult({ type: 'lookup', documentId: original.documentId, operationId: 'original-operation' }, receipt)).toBe(receipt)
  })

  it('uses the same snapshot owner for changed events and both export producers without changing ACK identities', () => {
    const original = snapshot()
    const event = uiDocumentEvent({ type: 'changed', snapshot: original, operationId: 'operation', appliedChanges: { changes: [], affectedTargets: [] } })
    if (event.type !== 'changed') throw new Error('Expected changed event')
    bounded(event.snapshot.model)
    expect(event.operationId).toBe('operation')
    expect(event.appliedChanges).toEqual({ changes: [], affectedTargets: [] })
    const closed = { type: 'closed' as const, documentId: original.documentId, epoch: original.epoch }
    expect(uiDocumentEvent(closed)).toBe(closed)
    const identity = { documentId: original.documentId, epoch: original.epoch, revision: original.revision, projectId: 'project' }
    const request = uiExportBuildRequest({ requestId: 'request', identity, format: 'html-offline', phase: 'drain', snapshot: original })
    bounded(request.snapshot.model)
    expect(request.requestId).toBe('request')
    expect(request.identity).toBe(identity)
    expect(request.phase).toBe('drain')
    expect(original.model.resources.assets.asset.buffer.byteLength).toBe(4096)
  })
})
