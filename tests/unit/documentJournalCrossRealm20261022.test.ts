import { describe, expect, it } from 'vitest'
import { serialize } from 'node:v8'
import vm from 'node:vm'
import type { DurableDocumentState } from '../../src/shared/workbench/document'
import { DocumentJournalCodec, DocumentJournalDecoder } from '../../src/main/workbench/documentJournalCodec'

describe('journal byte views across UI and Node realms', () => {
  it('reads a complete checkpoint and its resource bytes from the Node V8 realm', () => {
    const bytes = vm.runInNewContext('new Uint8Array([7, 8, 9])') as Uint8Array
    const state: DurableDocumentState = { schemaVersion: 3, disposition: 'active', documentId: 'cross-realm', epoch: 'e1',
      sequence: 0, revision: 0, savedRevision: null, binding: { kind: 'untitled', suggestedName: 'realm.md' },
      model: { kind: 'markdown', source: '# original', resources: { assets: { image: bytes }, components: {} } },
      past: [], future: [], operations: [], stoppedRuns: [] }
    const prepared = new DocumentJournalCodec().prepare('checkpoint', state)
    const decoded = new DocumentJournalDecoder().decode(prepared.payload)
    expect(decoded.type).toBe('checkpoint')
    if (decoded.type !== 'checkpoint') throw new Error('expected checkpoint')
    expect(decoded.value.model).toMatchObject({ source: '# original' })
    expect(Array.from(decoded.value.model.resources.assets.image)).toEqual([7, 8, 9])
  })

  it('still rejects a non-byte codec payload', () => {
    expect(() => new DocumentJournalDecoder().decode(serialize({ journalVersion: 3, type: 'checkpoint', buffers: [], value: [1, 2, 3] })))
      .toThrow('恢复日志codec无效')
  })
})
