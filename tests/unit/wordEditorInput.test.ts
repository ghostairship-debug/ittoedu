import { fireEvent, waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vitest'
import { createWordEditor } from '../../src/renderer/documentFiles/office/wordEditorKernel'
import { wordParagraphs, type WordEdit } from '../../src/renderer/documentFiles/office/wordEditorModel'

describe('Word editor keyboard routing', () => {
  it('routes a plain Enter at the caret through the PM keymap and requests one structural save', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const edits: WordEdit[] = [], save = vi.fn(), error = vi.fn()
    const kernel = createWordEditor(host, { format: 'docx', paragraphs: [{ index: 0, text: '前半段后半段', editable: true, structureEditable: true }], tables: [], body: [{ type: 'paragraph', index: 0 }] }, {
      changed: value => edits.push(...value), selection: vi.fn(), composition: vi.fn(), save, error, history: vi.fn(),
    })
    kernel.view.setProps({ handleScrollToSelection: () => true })
    try {
      kernel.focusParagraph(0, 3)
      const allowedDefault = fireEvent.keyDown(kernel.view.dom, { key: 'Enter', code: 'Enter', keyCode: 13 })
      expect(allowedDefault).toBe(false)
      expect(error).not.toHaveBeenCalled()
      expect(wordParagraphs(kernel.view.state.doc).map(paragraph => paragraph.node.textContent)).toEqual(['前半段', '后半段'])
      expect(edits).toEqual([{ type: 'replaceRange', start: { paragraph: 0, offset: 3 }, end: { paragraph: 0, offset: 3 }, paragraphs: [{ runs: [], style: {} }, { runs: [], style: {} }] }])
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    } finally { kernel.destroy(); host.remove() }
  })
})
