import { describe, expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { editorPositionToPoint, fromEditorDocument, toEditorDocument } from '../../src/renderer/document/documentAdapter'
import { documentEditorSchema } from '../../src/renderer/document/editorSchema'
import type { DocumentContent } from '../../src/shared/document/content'
import { emptyDocumentResources } from '../../src/shared/document/resources'

const text = (value: string) => ({ inlines: [{ type: 'text' as const, text: value }] })
const initial: DocumentContent = { blocks: [
  { id: 'before', type: 'paragraph', content: text('Before') },
  { id: 'table', type: 'table', caption: text('Caption 😀'),
    columns: ['a', 'b', 'c'].map(id => ({ id, header: text(id) })),
    rows: ['r1', 'r2'].map(id => ({ id, cells: Object.fromEntries(['a', 'b', 'c'].map(column => [column, text(`${id}-${column}`)])) })) },
  { id: 'after', type: 'paragraph', content: text('After') },
] }

function at(doc: ReturnType<typeof toEditorDocument>, key: string) {
  let position = -1
  doc.descendants((node, offset) => { if (position < 0 && node.attrs.key === key) position = offset + 1; return position < 0 })
  if (position < 0) throw new Error(`Missing ${key}`)
  return position
}
function cell(doc: ReturnType<typeof toEditorDocument>, row: string, column: string) {
  let position = -1
  const key = `cell:${JSON.stringify([row, column])}`
  doc.descendants((node, offset) => { if (position < 0 && node.type.spec.tableRole && node.firstChild?.attrs.key === key) position = offset; return position < 0 })
  if (position < 0) throw new Error(`Missing ${key}`)
  return position
}
function setup(content = initial) {
  const host = document.createElement('div'); document.body.append(host)
  const diagnostic = vi.fn(), change = vi.fn()
  const options = { document: { content, resources: emptyDocumentResources() }, revision: '1', change, diagnostic, undo: vi.fn(), redo: vi.fn(), presentation: 'flow' as const }
  const editor = createLayoutEditor(host, options)
  const update = (next: DocumentContent, revision: string) => editor.update({ ...options, document: { ...options.document, content: next }, revision })
  return { editor, update, change, diagnostic, close: () => { editor.destroy(); host.remove() } }
}

describe('M16 table projection after canonical Undo and Redo', () => {
  it('round trips a local two-cell formatting edit with caption, rows, and adjacent blocks intact', () => {
    const { editor, update, change, diagnostic, close } = setup()
    try {
      const doc = editor.view.state.doc
      const mark = documentEditorSchema.marks.style.create({ value: { bold: true } })
      const tr = editor.view.state.tr
        .addMark(at(doc, 'cell:["r1","a"]'), at(doc, 'cell:["r1","a"]') + 4, mark)
        .addMark(at(doc, 'cell:["r1","b"]'), at(doc, 'cell:["r1","b"]') + 4, mark)
      editor.view.dispatch(tr)
      expect(change).toHaveBeenCalledOnce()
      const edited = change.mock.lastCall![0].content as DocumentContent
      expect(edited.blocks[0]).toEqual(initial.blocks[0])
      expect(edited.blocks[2]).toEqual(initial.blocks[2])
      expect((edited.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'table' }>).rows[0].cells.c).toEqual(text('r1-c'))

      update(initial, '2')
      expect(editor.view.state.doc.eq(toEditorDocument(initial))).toBe(true)
      expect(fromEditorDocument(editor.view.state.doc)).toEqual(initial)
      update(edited, '3')
      expect(editor.view.state.doc.eq(toEditorDocument(edited))).toBe(true)
      expect(fromEditorDocument(editor.view.state.doc)).toEqual(edited)
      expect(diagnostic).not.toHaveBeenCalled()
    } finally { close() }
  })

  it('restores a two-cell selection after canonical table replacement', () => {
    const { editor, update, close } = setup()
    try {
      const doc = editor.view.state.doc
      editor.view.dispatch(editor.view.state.tr.setSelection(CellSelection.create(doc, cell(doc, 'r1', 'a'), cell(doc, 'r1', 'b'))))
      const table = initial.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'table' }>
      const changed: DocumentContent = { blocks: [initial.blocks[0], { ...table, caption: text('Long caption 😀'), rows: [...table.rows, { id: 'r3', cells: { a: text('a3'), b: text('b3'), c: text('c3') } }] }, initial.blocks[2]] }
      update(changed, '2')
      expect(editor.view.state.doc.eq(toEditorDocument(changed))).toBe(true)
      expect(editor.readSelection()).toMatchObject({ kind: 'cells', tableId: 'table', anchor: { rowId: 'r1', columnId: 'a' }, head: { rowId: 'r1', columnId: 'b' } })
    } finally { close() }
  })

  it('restores reverse text selection by logical offsets across emoji and math after a caption change', () => {
    const table = initial.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'table' }>
    const rich = { inlines: [
      { type: 'text' as const, text: '😀A' },
      { type: 'math' as const, formulaId: 'math-1', latex: 'x', accessibleText: 'x' },
      { type: 'text' as const, text: 'B' },
    ] }
    const before: DocumentContent = { blocks: [initial.blocks[0], { ...table, rows: [{ ...table.rows[0], cells: { ...table.rows[0].cells, a: rich } }, table.rows[1]] }, initial.blocks[2]] }
    const { editor, update, close } = setup(before)
    try {
      const doc = editor.view.state.doc, start = at(doc, 'cell:["r1","a"]')
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(doc, start + 4, start + 2)))
      const after: DocumentContent = { blocks: [before.blocks[0], { ...(before.blocks[1] as typeof table), caption: text('Longer caption') }, before.blocks[2]] }
      update(after, '2')
      expect(editor.view.state.doc.eq(toEditorDocument(after))).toBe(true)
      expect(editor.view.state.selection).toBeInstanceOf(TextSelection)
      expect(editor.view.state.selection.anchor).toBeGreaterThan(editor.view.state.selection.head)
      expect(editorPositionToPoint(editor.view.state.doc, editor.view.state.selection.anchor)).toMatchObject({ blockId: 'table', slot: { kind: 'cell', rowId: 'r1', columnId: 'a' }, offset: 3 })
      expect(editorPositionToPoint(editor.view.state.doc, editor.view.state.selection.head)).toMatchObject({ blockId: 'table', slot: { kind: 'cell', rowId: 'r1', columnId: 'a' }, offset: 1 })
    } finally { close() }
  })

  it('replaces complete containers across tables and within a section', () => {
    const table = initial.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'table' }>
    const second = { ...table, id: 'table-2', columns: table.columns.map(column => ({ ...column, id: `${column.id}-2` })),
      rows: table.rows.map(row => ({ ...row, id: `${row.id}-2`, cells: Object.fromEntries(table.columns.map(column => [`${column.id}-2`, row.cells[column.id]])) })) }
    const before: DocumentContent = { blocks: [initial.blocks[0],
      { id: 'section', type: 'section', title: text('Section'), collapsedByDefault: false, blocks: [table] },
      { id: 'middle', type: 'paragraph', content: text('Middle') }, second, initial.blocks[2]] }
    const firstChanged = { ...table, caption: text('First changed') }
    const lastChanged = { ...second, caption: text('Second changed') }
    const after: DocumentContent = { blocks: [before.blocks[0],
      { ...(before.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'section' }>), blocks: [firstChanged] },
      before.blocks[2], lastChanged, before.blocks[4]] }
    const { editor, update, close } = setup(before)
    try {
      update(after, '2')
      expect(editor.view.state.doc.eq(toEditorDocument(after))).toBe(true)
      expect(fromEditorDocument(editor.view.state.doc)).toEqual(after)
      update(before, '3')
      expect(editor.view.state.doc.eq(toEditorDocument(before))).toBe(true)
    } finally { close() }
  })

  it('keeps a valid mapped selection when its caption slot is deleted', () => {
    const { editor, update, close } = setup()
    try {
      const doc = editor.view.state.doc
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(doc, at(doc, 'caption') + 2)))
      const table = initial.blocks[1] as Extract<DocumentContent['blocks'][number], { type: 'table' }>
      const { caption: _caption, ...withoutCaption } = table
      const after: DocumentContent = { blocks: [initial.blocks[0], withoutCaption, initial.blocks[2]] }
      update(after, '2')
      expect(editor.view.state.doc.eq(toEditorDocument(after))).toBe(true)
      expect(fromEditorDocument(editor.view.state.doc)).toEqual(after)
      expect(editor.view.state.selection.from).toBeGreaterThanOrEqual(0)
      expect(editor.view.state.selection.to).toBeLessThanOrEqual(editor.view.state.doc.content.size)
    } finally { close() }
  })
})
