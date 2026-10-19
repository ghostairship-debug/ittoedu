// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createTextDriver } from '../../src/core/drivers/TextDriver'
import { mapMarkdownRange } from '../../src/core/tools/ToolTargets'
import type { DocumentModel, DocumentPersistence, DurableDocumentState } from '../../src/shared/workbench/document'

const text = (source: string): DocumentModel => ({ kind: 'text', source, resources: { assets: {}, components: {} } })

describe('source refresh receipts', () => {
  it('keeps current-draft acknowledgement at each known edit stage', () => {
    expect(mapMarkdownRange('aaa', 'baba', { kind: 'markdown-range', from: 1, to: 2 }, true))
      .toEqual({ kind: 'markdown-range', from: 2, to: 3 })
    expect(mapMarkdownRange('aaa', 'aba', { kind: 'markdown-range', from: 0, to: 1 }, true))
      .toEqual({ kind: 'markdown-range', from: 0, to: 0 })
  })
  it('restores the complete external draft, independent range mapping and ordinary Undo/Redo from a compact receipt', async () => {
    let durable!: DurableDocumentState
    const persistence: DocumentPersistence = { async append(state) { durable = state }, async save(input) {
      if (input.binding.kind !== 'file') throw new Error('file')
      return input.binding
    } }
    const base = `😀prefix | ${'a'.repeat(160)} | TARGET | ${'b'.repeat(160)} | tail🈀`
    const next = `😃prefix | ${'c'.repeat(160)} | TARGET | ${'d'.repeat(160)} | tail🈁`
    const session = await DocumentSession.create({ documentId: 'refresh', epoch: 'first', model: text(base), saved: true,
      binding: { kind: 'file', path: '/draft.html', version: 'old', bindingVersion: 1 } }, createTextDriver(), persistence)
    await session.reconcileFile({ epoch: 'first', baseRevision: 0, bindingVersion: 1 }, async () => ({ model: text(next), version: 'new', matchesDisk: true }))
    expect(durable.operations[0]!.sourceChange).toMatchObject({ kind: 'edits', edits: [{ from: 0, removed: base, text: next }] })
    expect(durable.operations[0]!.textChanges).toBeUndefined()
    const restored = await DocumentSession.restore(durable, 'restored', createTextDriver(), persistence)
    expect(restored.read()).toMatchObject({ revision: 1, dirty: false, undoDepth: 1, model: { source: next } })
    const change = restored.committedChangesSince(0)[0]!
    expect(change.sourceChange).toEqual({ kind: 'changed', before: base, after: next })
    expect(mapMarkdownRange(base, next, { kind: 'markdown-range', from: base.indexOf('TARGET'), to: base.indexOf('TARGET') + 6 }))
      .toEqual({ kind: 'markdown-range', from: next.indexOf('TARGET'), to: next.indexOf('TARGET') + 6 })
    for (const [type, source] of [['undo', base], ['redo', next]] as const) {
      expect(await restored.execute({ documentId: restored.documentId, epoch: 'restored', operationId: type,
        baseRevision: restored.read().revision, actor: 'human', mutation: { type } })).toMatchObject({ status: 'applied' })
      expect(restored.read().model).toMatchObject({ source })
    }
    await restored.execute({ documentId: restored.documentId, epoch: 'restored', operationId: 'typing', baseRevision: restored.read().revision,
      actor: 'human', mutation: { type: 'command', command: { type: 'markdown.splice', from: 10, to: 11, text: 'typed' } } })
    expect(durable.operations.at(-1)!.sourceChange).toMatchObject({ kind: 'edits', edits: [{ from: 10, removed: next.slice(10, 11), text: 'typed' }] })
    expect(durable.operations.at(-1)!.textChanges?.source).toEqual([{ from: 10, to: 11, inserted: 5 }])
  })
})
