import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { documentFlowEditingPlugin } from '../../src/renderer/document/documentFlowEditing'
import { fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import type { DocumentBlock } from '../../src/shared/document/content'

const paragraph = (id: string, text: string): DocumentBlock => ({ id, type: 'paragraph', content: { inlines: text ? [{ type: 'text', text }] : [] } })
const group = (id: string, blocks: DocumentBlock[]): DocumentBlock => ({ id, type: 'course-instance', blocks })
const editors: ReturnType<typeof createLayoutEditor>[] = []
afterEach(() => { for (const editor of editors) { const host = editor.view.dom.parentElement; editor.destroy(); host?.remove() } editors.length = 0 })

function editor(blocks: DocumentBlock[], protectedLayout = true) {
  const host = document.createElement('div'); document.body.append(host)
  const change = vi.fn(() => true), diagnostic = vi.fn()
  const value = createLayoutEditor(host, { document: { content: { blocks }, resources: emptyDocumentResources() }, revision: '0', presentation: 'flow',
    projectionPlugins: protectedLayout ? [documentFlowEditingPlugin({ isMultiColumnLayout: id => id === 'grid' })] : [], change, diagnostic, undo() {}, redo() {} })
  editors.push(value)
  const position = (id: string) => { let found = -1; value.view.state.doc.descendants((node, at) => { if (node.attrs.id === id) found = at }); return found }
  const select = (id: string, offset: number, endId = id, endOffset = offset) => value.view.dispatch(value.view.state.tr.setSelection(TextSelection.create(value.view.state.doc, position(id) + 1 + offset, position(endId) + 1 + endOffset)))
  const key = (name: string) => value.view.someProp('handleKeyDown', handle => handle(value.view, new KeyboardEvent('keydown', { key: name })))
  const content = () => fromEditorDocument(value.view.state.doc).blocks
  return { value, change, diagnostic, position, select, key, content }
}

describe('native Flow layout deletion', () => {
  it('deletes a real cross-column text range without merging its partially selected column owners', () => {
    const blocks = [group('grid', [group('left', [paragraph('a', 'ABC')]), group('right', [paragraph('b', 'XYZ')])]), paragraph('neighbor', 'Tail')]
    // The existing PM range replacement is the concrete failure: right/b vanish.
    const original = editor(blocks, false)
    original.select('a', 1, 'b', 1); expect(original.key('Delete')).toBe(true)
    expect(original.content()[0]).toEqual(group('grid', [group('left', [paragraph('a', 'AYZ')])]))

    const fixed = editor(blocks)
    fixed.select('a', 1, 'b', 1); expect(fixed.key('Delete')).toBe(true)
    expect(fixed.content()).toEqual([group('grid', [group('left', [paragraph('a', 'A')]), group('right', [paragraph('b', 'YZ')])]), paragraph('neighbor', 'Tail')])
    expect(fixed.change).toHaveBeenCalledTimes(1)
    expect(fixed.diagnostic).not.toHaveBeenCalled()
  })

  it('removes a fully covered opaque object while retaining both partially selected layout items', () => {
    const opaque: DocumentBlock = { id: 'opaque', type: 'course-instance' }
    const fixed = editor([group('grid', [paragraph('left', 'ABC'), opaque, paragraph('right', 'XYZ')])])
    fixed.select('left', 1, 'right', 1); fixed.key('Backspace')
    expect(fixed.content()).toEqual([group('grid', [paragraph('left', 'A'), paragraph('right', 'YZ')])])
  })

  it.each(['Backspace', 'Delete'])('keeps direct column identities at a collapsed %s boundary', key => {
    const blocks = [group('grid', [paragraph('left', 'ABC'), paragraph('right', 'XYZ')])]
    const original = editor(blocks, false)
    original.select(key === 'Backspace' ? 'right' : 'left', key === 'Backspace' ? 0 : 3)
    expect(original.key(key)).toBe(true)
    expect(original.content()).toEqual([group('grid', [paragraph('left', 'ABCXYZ')])])

    const fixed = editor(blocks)
    fixed.select(key === 'Backspace' ? 'right' : 'left', key === 'Backspace' ? 0 : 3)
    expect(fixed.key(key)).toBe(true)
    expect(fixed.content()).toEqual(blocks)
    expect(fixed.change).not.toHaveBeenCalled()
  })

  it('allows an explicitly selected whole column to be deleted', () => {
    const fixed = editor([group('grid', [group('left', [paragraph('a', 'ABC')]), group('right', [paragraph('b', 'XYZ')])])])
    fixed.value.view.dispatch(fixed.value.view.state.tr.setSelection(NodeSelection.create(fixed.value.view.state.doc, fixed.position('right'))))
    expect(fixed.key('Delete')).toBe(true)
    expect(fixed.content()).toEqual([group('grid', [group('left', [paragraph('a', 'ABC')])])])
  })

  it('keeps ordinary paragraph merging and single-slot text deletion with the existing PM commands', () => {
    const ordinary = editor([paragraph('first', 'ABC'), paragraph('second', 'XYZ')])
    ordinary.select('second', 0); ordinary.key('Backspace')
    expect(ordinary.content()).toEqual([paragraph('first', 'ABCXYZ')])
    const fixed = editor([group('grid', [paragraph('left', 'ABC'), paragraph('right', 'XYZ')])])
    fixed.select('left', 1, 'left', 2); fixed.key('Delete')
    expect(fixed.content()).toEqual([group('grid', [paragraph('left', 'AC'), paragraph('right', 'XYZ')])])
  })

  it('keeps ordinary cross-paragraph deletion inside one section layout item', () => {
    const section: DocumentBlock = { id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [paragraph('a', 'ABC'), paragraph('b', 'XYZ')] }
    const fixed = editor([group('grid', [section, paragraph('neighbor', 'Tail')])])
    fixed.select('a', 1, 'b', 1); fixed.key('Delete')
    expect(fixed.content()).toEqual([group('grid', [{ ...section, blocks: [paragraph('a', 'AYZ')] }, paragraph('neighbor', 'Tail')])])
  })

  it('keeps ordinary same-column paragraph Backspace and range deletion', () => {
    const blocks = [group('grid', [group('column', [paragraph('a', 'ABC'), paragraph('b', 'XYZ')]), paragraph('neighbor', 'Tail')])]
    const backward = editor(blocks)
    backward.select('b', 0); backward.key('Backspace')
    expect(backward.content()).toEqual([group('grid', [group('column', [paragraph('a', 'ABCXYZ')]), paragraph('neighbor', 'Tail')])])
    const range = editor(blocks)
    range.select('a', 1, 'b', 1); range.key('Delete')
    expect(range.content()).toEqual([group('grid', [group('column', [paragraph('a', 'AYZ')]), paragraph('neighbor', 'Tail')])])
  })
})
