// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import PptxGenJS from 'pptxgenjs'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { openEditor } from '@web-ppt/editor'
import type { EditorSession } from '@web-ppt/editor'
import { queryTableGrid, validateEditDoc } from '@web-ppt/edit-core'
import { serializeEditDoc } from '@web-ppt/edit-core/save'
import { arrangePptxObjects, copyPptxObjects, editPptxTable, formatPptxObjectText, insertPptxShape, pastePptxObjects, pptxFocus, queryPptxObjectRunProps, restorePptxSelection, selectAllPptxObjects, selectPptxContextTarget } from '../../src/renderer/documentFiles/office/pptxCanvasCommands'

let original: Uint8Array
const sessions: EditorSession[] = [], opaque = Uint8Array.of(0, 119, 255, 31)
beforeAll(async () => {
  const ppt = new PptxGenJS(); ppt.layout = 'LAYOUT_WIDE'
  const slide = ppt.addSlide()
  for (let i = 0; i < 4; i++) slide.addText('对象 ' + i, { x: 1 + i * 2, y: 1 + i * .3, w: 1.5, h: .8, fontSize: 20, objectName: 'object-' + i })
  ppt.addSlide().addText('范围外页面', { x: 1, y: 1, w: 8, h: 1 })
  const bytes = await ppt.write({ outputType: 'uint8array' }); if (!(bytes instanceof Uint8Array)) throw new Error('PPT fixture expected')
  const parts = unzipSync(bytes); parts['customXml/opaque.bin'] = opaque
  parts['[Content_Types].xml'] = strToU8(strFromU8(parts['[Content_Types].xml']).replace('</Types>', '<Default Extension="bin" ContentType="application/octet-stream"/></Types>'))
  original = zipSync(parts)
})
afterEach(() => { for (const session of sessions.splice(0)) session.dispose() })
async function open(bytes = original) { const session = await openEditor(bytes, { historyLimit: 0 }); sessions.push(session); return session.editor }

describe('PPT canvas helpers compose the actual 0.5 editor commands', () => {
  it('keeps multiselection layer order and native group selection in single transactions', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0], ids = [...editor.doc.slides[slideId].children]
    editor.select({ kind: 'elements', ids: [ids[2], ids[0]], enteredGroup: null })
    arrangePptxObjects(editor, slideId, 'front')
    expect(editor.doc.slides[slideId].children).toEqual([ids[1], ids[3], ids[0], ids[2]])
    arrangePptxObjects(editor, slideId, 'back')
    expect(editor.doc.slides[slideId].children).toEqual([ids[0], ids[2], ids[1], ids[3]])
    const changes: string[] = []; editor.subscribe(change => { if (change.source !== 'selection') changes.push(change.source) })
    editor.exec({ type: 'Group', ids: [ids[0], ids[2]] })
    expect(editor.selection.kind).toBe('elements')
    if (editor.selection.kind !== 'elements') throw new Error('group selection expected')
    const group = editor.selection.ids[0]
    expect(editor.selection.ids).toHaveLength(1)
    expect(editor.doc.elements[group].src.kind).toBe('group')
    selectPptxContextTarget(editor, slideId, ids[0])
    expect(editor.selection.ids).toEqual([group])
    arrangePptxObjects(editor, slideId, 'rotate')
    editor.exec({ type: 'Ungroup', id: group })
    expect(editor.selection.kind === 'elements' && [...editor.selection.ids].sort()).toEqual([ids[0], ids[2]].sort())
    expect(changes).toEqual(['transaction', 'transaction', 'transaction'])
    expect(editor.history.undoCount).toBe(0)
    editor.exec({ type: 'SetLocked', id: ids[1], locked: true })
    editor.select({ kind: 'elements', ids: [ids[0]], enteredGroup: null })
    selectPptxContextTarget(editor, slideId, ids[1])
    expect(editor.selection).toEqual({ kind: 'none' })
    validateEditDoc(editor.doc)
  })

  it('copies and pastes real OOXML objects, selects their new identities and preserves unknown parts', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0], ids = [...editor.doc.slides[slideId].children]
    editor.select({ kind: 'elements', ids: [ids[0], ids[2]], enteredGroup: null })
    const payload = copyPptxObjects(editor, slideId)!
    pastePptxObjects(editor, slideId, payload)
    expect(editor.doc.slides[slideId].children).toHaveLength(6)
    expect(editor.selection.kind).toBe('elements')
    if (editor.selection.kind !== 'elements') throw new Error('paste selection expected')
    expect(editor.selection.ids).toHaveLength(2)
    expect(editor.selection.ids.every(id => !ids.includes(id))).toBe(true)
    const focus = pptxFocus(editor, slideId)
    expect(focus.shapeIds).toHaveLength(2)
    const result = await serializeEditDoc(editor.doc), parts = unzipSync(result.bytes)
    expect(parts['customXml/opaque.bin']).toEqual(opaque)
    expect(parts['ppt/slides/slide2.xml']).toEqual(unzipSync(original)['ppt/slides/slide2.xml'])
    const reopened = await open(result.bytes), reopenedSlide = reopened.doc.slideOrder[0]
    restorePptxSelection(reopened, reopenedSlide, focus.shapeIds)
    expect(pptxFocus(reopened, reopenedSlide)).toEqual(focus)
    expect(reopened.doc.slides[reopenedSlide].children).toHaveLength(6)
    validateEditDoc(reopened.doc)
  })

  it('moves a consecutive multiselection one layer as a block without crossing the top or bottom', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0], ids = [...editor.doc.slides[slideId].children]
    editor.select({ kind: 'elements', ids: [ids[0], ids[1]], enteredGroup: null })
    arrangePptxObjects(editor, slideId, 'forward')
    expect(editor.doc.slides[slideId].children).toEqual([ids[2], ids[0], ids[1], ids[3]])
    arrangePptxObjects(editor, slideId, 'forward')
    expect(editor.doc.slides[slideId].children).toEqual([ids[2], ids[3], ids[0], ids[1]])
    arrangePptxObjects(editor, slideId, 'forward')
    expect(editor.doc.slides[slideId].children).toEqual([ids[2], ids[3], ids[0], ids[1]])
    arrangePptxObjects(editor, slideId, 'backward')
    expect(editor.doc.slides[slideId].children).toEqual([ids[2], ids[0], ids[1], ids[3]])
    arrangePptxObjects(editor, slideId, 'backward')
    arrangePptxObjects(editor, slideId, 'backward')
    expect(editor.doc.slides[slideId].children).toEqual(ids)
  })

  it('creates a transparent editable text box without a second history and aligns selected objects', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0], changes: string[] = []
    editor.subscribe(change => { if (change.source !== 'selection') changes.push(change.source) })
    const id = insertPptxShape(editor, slideId, 'rect', true)!
    expect(id).toBeTruthy()
    expect(changes).toEqual(['transaction', 'transaction'])
    const shape = editor.effectiveElement(id)
    expect(shape.kind).toBe('shape')
    if (shape.kind !== 'shape') throw new Error('text shape expected')
    expect(shape.text?.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('')).toBe('双击编辑文字')
    expect(shape.fill?.type).toBe('none')
    expect(queryPptxObjectRunProps(editor, slideId)?.color.value).toBe('rgb(32,33,36)')
    expect(queryPptxObjectRunProps(editor, slideId)?.size.value).toBe(32)
    selectAllPptxObjects(editor, slideId)
    arrangePptxObjects(editor, slideId, 'left')
    const values = editor.doc.slides[slideId].children.map(child => editor.effectiveElement(child).x)
    expect(values.every(x => Math.abs(x - values[0]) < .01)).toBe(true)
    const result = await serializeEditDoc(editor.doc), reopened = await open(result.bytes)
    expect(reopened.doc.slides[reopened.doc.slideOrder[0]].children).toHaveLength(5)
    expect(editor.history.undoCount).toBe(0)
  })

  it('edits table rows, columns and merged cells through stable SDK identities', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0]
    editor.exec({ type: 'AddTable', slideId, rows: 2, cols: 2, rect: { x: 60, y: 200, w: 400, h: 150 } })
    if (editor.selection.kind !== 'elements') throw new Error('table selection expected')
    const id = editor.selection.ids[0]
    editPptxTable(editor, slideId, 'addRow'); editPptxTable(editor, slideId, 'addColumn')
    expect(queryTableGrid(editor.doc, id).rows).toHaveLength(3)
    expect(queryTableGrid(editor.doc, id).columns).toHaveLength(3)
    editor.select({ kind: 'table', id, cells: [{ r: 0, c: 0 }, { r: 0, c: 1 }] })
    editPptxTable(editor, slideId, 'merge')
    expect(queryTableGrid(editor.doc, id).merges).toHaveLength(1)
    editor.select({ kind: 'table', id, cells: [{ r: 0, c: 0 }] })
    editPptxTable(editor, slideId, 'split')
    expect(queryTableGrid(editor.doc, id).merges).toHaveLength(0)
    editor.select({ kind: 'table', id, cells: [{ r: 2, c: 2 }] })
    editPptxTable(editor, slideId, 'removeRow')
    editor.select({ kind: 'table', id, cells: [{ r: 1, c: 2 }] })
    editPptxTable(editor, slideId, 'removeColumn')
    const result = await serializeEditDoc(editor.doc), reopened = await open(result.bytes)
    const table = Object.values(reopened.doc.elements).find(record => record.src.kind === 'table')!
    expect(queryTableGrid(reopened.doc, table.id).rows).toHaveLength(2)
    expect(queryTableGrid(reopened.doc, table.id).columns).toHaveLength(2)
    validateEditDoc(reopened.doc)
  })

  it('formats selected text objects without an active caret, reports mixed styles and preserves unselected text', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0], ids = [...editor.doc.slides[slideId].children]
    editor.select({ kind: 'elements', ids: [ids[0]], enteredGroup: null })
    formatPptxObjectText(editor, slideId, { kind: 'run', props: { size: 40 / .75, b: true } })
    expect(queryPptxObjectRunProps(editor, slideId)?.size.value).toBeCloseTo(40 / .75)
    editor.select({ kind: 'elements', ids: [ids[0], ids[1]], enteredGroup: null })
    expect(queryPptxObjectRunProps(editor, slideId)?.size.mixed).toBe(true)
    const changes: string[] = []; editor.subscribe(change => { if (change.source !== 'selection') changes.push(change.source) })
    formatPptxObjectText(editor, slideId, { kind: 'run', props: { size: 32 / .75, b: true } })
    expect(changes).toEqual(['transaction'])
    expect(queryPptxObjectRunProps(editor, slideId)?.size).toEqual({ value: 32 / .75, mixed: false })
    expect(editor.selection).toEqual({ kind: 'elements', ids: [ids[0], ids[1]], enteredGroup: null })
    const focus = pptxFocus(editor, slideId), result = await serializeEditDoc(editor.doc), reopened = await open(result.bytes), nextSlide = reopened.doc.slideOrder[0]
    restorePptxSelection(reopened, nextSlide, focus.shapeIds)
    expect(queryPptxObjectRunProps(reopened, nextSlide)?.b.value).toBe(true)
    expect(queryPptxObjectRunProps(reopened, nextSlide)?.size.value).toBeCloseTo(32 / .75)
    reopened.select({ kind: 'elements', ids: [reopened.doc.slides[nextSlide].children[2]], enteredGroup: null })
    expect(queryPptxObjectRunProps(reopened, nextSlide)?.size.value).toBeCloseTo(20 / .75)
    expect(editor.history.undoCount).toBe(0)
    validateEditDoc(reopened.doc)
  })

  it('copies an edited table with projected row templates while preserving its source and future row editing', async () => {
    const editor = await open(), slideId = editor.doc.slideOrder[0]
    editor.exec({ type: 'AddTable', slideId, rows: 3, cols: 3, rect: { x: 60, y: 200, w: 400, h: 150 } })
    if (editor.selection.kind !== 'elements') throw new Error('table selection expected')
    const id = editor.selection.ids[0]
    editPptxTable(editor, slideId, 'addRow'); editPptxTable(editor, slideId, 'addColumn')
    editor.exec({ type: 'EditText', id, cell: { r: 3, c: 3 }, ops: [{ type: 'replace', from: { p: 0, r: 0, off: 0 }, to: { p: 0, r: 0, off: 0 }, text: '新增格保留' }] })
    const confirm = editor.captureSavepoint(); await serializeEditDoc(editor.doc); confirm()
    const source = structuredClone(editor.doc.elements[id].src), payload = copyPptxObjects(editor, slideId)!
    pastePptxObjects(editor, slideId, payload)
    const copyId = editor.selection.ids[0], copy = editor.effectiveElement(copyId)
    expect(copyId).not.toBe(id)
    expect(editor.doc.elements[id].src).toEqual(source)
    if (copy.kind !== 'table') throw new Error('table copy expected')
    expect(copy.rows).toHaveLength(4); expect(copy.colWidths).toHaveLength(4)
    expect(copy.rows[3].cells[3].text?.paragraphs[0].runs.map(run => run.text).join('')).toBe('新增格保留')
    expect(copy.editInfo?.tableRowAppend?.regular[0].cells).toHaveLength(4)
    editPptxTable(editor, slideId, 'addRow')
    expect(queryTableGrid(editor.doc, copyId).rows).toHaveLength(5)
    // Same column count can still have a different identity/order. Delete a
    // source column and insert its replacement before the first source column.
    const grid = queryTableGrid(editor.doc, copyId)
    editor.exec({ type: 'RemoveColumn', id: copyId, column: grid.columns[1].id })
    editor.exec({ type: 'InsertColumn', id: copyId, at: { before: grid.columns[0].id } })
    pastePptxObjects(editor, slideId, copyPptxObjects(editor, slideId)!)
    const result = await serializeEditDoc(editor.doc), reopened = await open(result.bytes)
    expect(Object.values(reopened.doc.elements).filter(record => record.src.kind === 'table')).toHaveLength(3)
    expect(queryTableGrid(editor.doc, id).rows).toHaveLength(4)
    expect(editor.history.undoCount).toBe(0)
    validateEditDoc(reopened.doc)
  })

  it('retains distinct source-column styles when removal and insertion leave the copied table at the same width', async () => {
    const ppt = new PptxGenJS(), colors = ['CC3333', '338833', '3355CC', '9955AA']
    ppt.addSlide().addTable(Array.from({ length: 2 }, () => colors.map((color, index) => ({ text: String(index), options: { fill: { color } } }))), { x: 1, y: 1, w: 6, h: 2 })
    const bytes = await ppt.write({ outputType: 'uint8array' }); if (!(bytes instanceof Uint8Array)) throw new Error('PPT fixture expected')
    const editor = await open(bytes), slideId = editor.doc.slideOrder[0], id = editor.doc.slides[slideId].children[0]
    editor.select({ kind: 'elements', ids: [id], enteredGroup: null })
    const source = editor.doc.elements[id].src
    if (source.kind !== 'table' || !source.editInfo?.tableRowAppend) throw new Error('source table templates expected')
    const before = source.editInfo.tableRowAppend.regular[0].cells.map(cell => cell.fill)
    expect(new Set(before.map(fill => JSON.stringify(fill))).size).toBe(4)
    const grid = queryTableGrid(editor.doc, id)
    editor.exec({ type: 'RemoveColumn', id, column: grid.columns[1].id })
    editor.exec({ type: 'InsertColumn', id, at: { before: grid.columns[0].id } })
    const payload = copyPptxObjects(editor, slideId)!, copy = payload.records[payload.roots[0]].src
    if (copy.kind !== 'table') throw new Error('table clipboard expected')
    const expected = [before[0], before[0], before[2], before[3]]
    expect(copy.editInfo?.tableRowAppend?.regular[0].cells.map(cell => cell.fill)).toEqual(expected)
    pastePptxObjects(editor, slideId, payload)
    if (editor.selection.kind !== 'elements') throw new Error('pasted table selection expected')
    const copyId = editor.selection.ids[0]
    editPptxTable(editor, slideId, 'addRow')
    const table = editor.effectiveElement(copyId)
    if (table.kind !== 'table') throw new Error('table copy expected')
    expect(table.rows.at(-1)?.cells.map(cell => cell.fill)).toEqual(expected)
    validateEditDoc(editor.doc)
  })
})
