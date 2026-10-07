import { expect, it, vi } from 'vitest'
import { prepareDocumentTextEdit, requestDocumentSelection } from '../../src/renderer/document/documentSelectionCommands'
import { captureMarkdownSelection, workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { DocumentContextSelection } from '../../src/shared/document/ports'

function fixture() {
  const snapshot: DocumentSnapshot = { documentId: 'selection-command-test', epoch: 'epoch', revision: 3,
    binding: { kind: 'untitled', suggestedName: 'test.md' }, model: { kind: 'markdown', source: '甲选中文字乙', resources: { assets: {}, components: {} } },
    dirty: true, saving: false, recoverable: true, undoDepth: 1, redoDepth: 0 }
  const target: DocumentContextSelection = { selection: null, ranges: [{ from: 1, to: 5, before: '选中文字' }],
    revision: '甲选中文字乙', mode: 'source', source: '甲选中文字乙', label: '所选源文' }
  return { snapshot, target }
}

it('prepares a text card and sends content-only AI for the same held source range', async () => {
  const { snapshot, target } = fixture(), sent = vi.fn()
  const release = workbenchSelection.register(snapshot.documentId, async () => snapshot), releaseRequest = workbenchSelection.onRequest(sent)
  try {
    expect(await prepareDocumentTextEdit(snapshot.documentId, target, captureMarkdownSelection)).toEqual({
      target: { kind: 'markdown-range', from: 1, to: 5 }, label: '所选源文', content: '选中文字' })
    await requestDocumentSelection(snapshot.documentId, target, '改得更简洁', captureMarkdownSelection)
    expect(sent).toHaveBeenCalledOnce()
    expect(sent.mock.calls[0][0]).toMatchObject({ selection: { documentId: snapshot.documentId, epoch: 'epoch', revision: 3,
      targets: [{ kind: 'markdown-range', from: 1, to: 5 }] }, instruction: '改得更简洁', contentOutput: { target: { kind: 'markdown-range', from: 1, to: 5 } } })
  } finally { release(); releaseRequest() }
})

it('does not send or retarget a held selection after its source changes during input preparation', async () => {
  const { snapshot, target } = fixture(), sent = vi.fn()
  const release = workbenchSelection.register(snapshot.documentId, async () => ({ ...snapshot, revision: 4,
    model: { kind: 'markdown', source: '新的正文', resources: { assets: {}, components: {} } } })), releaseRequest = workbenchSelection.onRequest(sent)
  try {
    await expect(requestDocumentSelection(snapshot.documentId, target, '修改原文字', captureMarkdownSelection)).rejects.toThrow('选区已改变')
    expect(sent).not.toHaveBeenCalled()
    expect(target.ranges).toEqual([{ from: 1, to: 5, before: '选中文字' }])
  } finally { release(); releaseRequest() }
})
