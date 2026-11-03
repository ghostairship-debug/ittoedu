// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state'
import { Fragment, Slice } from 'prosemirror-model'
import { joinBackward, splitBlock, toggleMark } from 'prosemirror-commands'
import { CellSelection } from 'prosemirror-tables'
import { strToU8 } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { children, descendants, NS, OfficePackage } from '../../src/main/workbench/office/officePackage'
import { toWordEditorDocument, wordEditorSchema, wordParagraphs, wordTransactionEdits } from '../../src/renderer/documentFiles/office/wordEditorModel'

async function fixture() {
  const created = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [
    { type: 'paragraph', runs: [{ text: 'Alpha ', bold: true }, { text: 'beta', italic: true }, { text: ' gamma' }] },
    { type: 'paragraph', text: 'Second paragraph' },
    { type: 'table', rows: [['A1', 'B1'], ['A2', 'B2']] },
    { type: 'paragraph', text: 'Untouched ending' },
  ] })
  const pkg = new OfficePackage(created.bytes), document = pkg.xml(pkg.main())
  const run = descendants(document, NS.word, 'r')[1], properties = children(run, NS.word, 'rPr')[0]
  const opaque = document.createElementNS('urn:word-kernel-test', 'probe:unknown'); opaque.setAttribute('keep', 'yes'); properties.appendChild(opaque)
  pkg.setBinary('customXml/opaque.bin', Uint8Array.of(0, 123, 255, 17)); pkg.write(pkg.main())
  return pkg.save()
}
function inspect(bytes: Uint8Array) {
  const value = inspectOfficeContent(bytes, 'docx')
  if (value.format !== 'docx') throw new Error('Expected Word')
  return value
}
function state(bytes: Uint8Array) { return EditorState.create({ doc: toWordEditorDocument(inspect(bytes)) }) }
async function apply(bytes: Uint8Array, transaction: Transaction) {
  const edits = wordTransactionEdits(transaction)
  const result = await applyOfficeContent(bytes, { format: 'docx', operation: 'edit', edits })
  expect(inspect(result.bytes).paragraphs.map(paragraph => paragraph.text)).toEqual(wordParagraphs(transaction.doc).map(paragraph => paragraph.node.textContent))
  return result
}
function command(current: EditorState, action: typeof splitBlock) {
  let transaction: Transaction | undefined
  expect(action(current, value => { transaction = value })).toBe(true)
  if (!transaction) throw new Error('No transaction')
  return transaction
}

describe('Word ProseMirror projection to original OOXML', () => {
  it('projects paragraph order, mixed inline styles and real table cells without flattening', async () => {
    const bytes = await fixture(), current = state(bytes)
    expect(current.doc.child(2).type.name).toBe('table')
    expect(wordParagraphs(current.doc)).toHaveLength(7)
    expect(current.doc.firstChild!.child(0).marks[0].type.name).toBe('bold')
    expect(current.doc.firstChild!.child(1).marks[0].type.name).toBe('italic')
    expect(inspect(bytes).body?.[2]).toMatchObject({ type: 'table', rows: [[[2], [3]], [[4], [5]]], simple: true })
  })

  it('uses selection ranges for format changes and preserves unknown run properties and other ZIP parts', async () => {
    const bytes = await fixture(), before = new OfficePackage(bytes)
    let current = state(bytes); current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 8, 10)))
    const transaction = command(current, toggleMark(wordEditorSchema.marks.underline))
    expect(wordTransactionEdits(transaction)).toEqual([{ type: 'textStyle', index: 0, from: 7, to: 9, style: { underline: true } }])
    const result = await apply(bytes, transaction), after = new OfficePackage(result.bytes)
    expect(result.changedParts).toEqual(['word/document.xml'])
    for (const name of Object.keys(before.parts).filter(name => name !== before.main())) expect(after.parts[name]).toEqual(before.parts[name])
    const styled = inspect(result.bytes).paragraphs[0].runs!.filter(run => run.text)
    expect(styled.filter(run => run.style.underline).map(run => run.text).join('')).toBe('et')
    expect(descendants(after.xml(after.main()), 'urn:word-kernel-test', 'unknown').every(node => node.getAttribute('keep') === 'yes')).toBe(true)
  })

  it('replays Enter, paragraph join and multi-paragraph paste with inherited opaque properties intact', async () => {
    let bytes = await fixture(), current = state(bytes)
    current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 9)))
    const split = command(current, splitBlock); bytes = (await apply(bytes, split)).bytes
    expect(inspect(bytes).paragraphs.slice(0, 2).map(paragraph => paragraph.text)).toEqual(['Alpha be', 'ta gamma'])
    let pkg = new OfficePackage(bytes)
    expect(descendants(pkg.xml(pkg.main()), 'urn:word-kernel-test', 'unknown')).toHaveLength(2)
    current = state(bytes); const second = wordParagraphs(current.doc)[1]
    current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, second.from)))
    bytes = (await apply(bytes, command(current, joinBackward))).bytes
    expect(inspect(bytes).paragraphs[0].text).toBe('Alpha beta gamma')
    current = state(bytes); current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 7, 11)))
    const paste = new Slice(Fragment.from([
      wordEditorSchema.nodes.paragraph.create(null, wordEditorSchema.text('中文', [wordEditorSchema.marks.bold.create()])),
      wordEditorSchema.nodes.paragraph.create(null, wordEditorSchema.text('后续', [wordEditorSchema.marks.underline.create()])),
    ]), 1, 1)
    bytes = (await apply(bytes, current.tr.replaceSelection(paste))).bytes
    expect(inspect(bytes).paragraphs.slice(0, 2).map(paragraph => paragraph.text)).toEqual(['Alpha 中文', '后续 gamma'])
    pkg = new OfficePackage(bytes)
    expect(pkg.parts['customXml/opaque.bin']).toEqual(Uint8Array.of(0, 123, 255, 17))
    expect(inspect(bytes).paragraphs[1].runs!.find(run => run.text === '后续')?.style.underline).toBe(true)
  })

  it('maps every step against its own document after indices shift', async () => {
    const bytes = await fixture(), current = state(bytes)
    const transaction = current.tr.insertText('新', 2).split(5).insertText('后', 9)
    const result = await apply(bytes, transaction)
    expect(inspect(result.bytes).paragraphs).toHaveLength(8)
  })

  it('keeps a surrogate pair intact when PM finds only the differing low surrogate of an emoji', async () => {
    const created = await applyOfficeContent(undefined, { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'A😀B' }] })
    const current = state(created.bytes), transaction = current.tr.insertText('😁'.slice(1), 3, 4)
    expect(transaction.doc.textContent).toBe('A😁B')
    await apply(created.bytes, transaction)
  })

  it('supports table-cell typing and rectangular cell formatting through the same owner edits', async () => {
    let bytes = await fixture(), current = state(bytes)
    const first = wordParagraphs(current.doc)[2]
    bytes = (await apply(bytes, current.tr.insertText('编辑', first.from + 1))).bytes
    expect(inspect(bytes).tables[0][0][0]).toBe('A编辑1')
    current = state(bytes)
    const cells: number[] = []; current.doc.descendants((node, pos) => { if (node.type.name === 'table_cell') cells.push(pos) })
    current = current.apply(current.tr.setSelection(CellSelection.create(current.doc, cells[0], cells[3])))
    const result = await apply(bytes, command(current, toggleMark(wordEditorSchema.marks.bold)))
    expect(inspect(result.bytes).paragraphs.slice(2, 6).every(paragraph => paragraph.style?.bold)).toBe(true)
  })

  it('keeps opaque inline objects editable while rejecting structural removal and cross-cell joins', async () => {
    let bytes = await fixture(), pkg = new OfficePackage(bytes), document = pkg.xml(pkg.main())
    const first = descendants(document, NS.word, 'p')[0], marker = document.createElementNS(NS.word, 'w:bookmarkStart')
    marker.setAttributeNS(NS.word, 'w:id', '9'); marker.setAttributeNS(NS.word, 'w:name', 'KeepMe'); first.insertBefore(marker, first.firstChild)
    pkg.write(pkg.main()); bytes = pkg.save()
    let current = state(bytes)
    expect(inspect(bytes).paragraphs[0]).toMatchObject({ editable: true, structureEditable: false })
    bytes = (await apply(bytes, current.tr.insertText('可改', 2))).bytes
    pkg = new OfficePackage(bytes); expect(descendants(pkg.xml(pkg.main()), NS.word, 'bookmarkStart')).toHaveLength(1)
    current = state(bytes); current = current.apply(current.tr.setSelection(TextSelection.create(current.doc, 4)))
    expect(() => wordTransactionEdits(command(current, splitBlock))).toThrow('受保护结构')
    await expect(applyOfficeContent(bytes, { format: 'docx', operation: 'edit', edits: [{ type: 'replaceRange', start: { paragraph: 2, offset: 1 }, end: { paragraph: 3, offset: 1 }, paragraphs: [{ runs: [] }] }] })).rejects.toThrow('表格边界')
  })

  it('rejects out-of-range and field edits without changing the source bytes', async () => {
    const original = await fixture(), pkg = new OfficePackage(original), document = pkg.xml(pkg.main())
    const first = descendants(document, NS.word, 'p')[0], field = document.createElementNS(NS.word, 'w:fldSimple'); field.setAttributeNS(NS.word, 'w:instr', 'PAGE'); first.appendChild(field)
    pkg.write(pkg.main()); const bytes = pkg.save(), copy = Uint8Array.from(bytes)
    await expect(applyOfficeContent(bytes, { format: 'docx', operation: 'edit', edits: [{ type: 'replaceRange', start: { paragraph: 0, offset: 0 }, end: { paragraph: 0, offset: 1 }, paragraphs: [{ runs: [{ text: 'x' }] }] }] })).rejects.toThrow('自动域')
    await expect(applyOfficeContent(original, { format: 'docx', operation: 'edit', edits: [{ type: 'textStyle', index: 0, from: 0, to: 999, style: { bold: true } }] })).rejects.toThrow('范围不存在')
    expect(bytes).toEqual(copy)
    expect(strToU8(inspect(bytes).paragraphs[0].text).length).toBeGreaterThan(0)
  })

  it('does not let outer paragraph character formatting reach nested textbox paragraphs', async () => {
    const pkg = new OfficePackage(await fixture()), document = pkg.xml(pkg.main()), outer = descendants(document, NS.word, 'p')[0]
    const run = document.createElementNS(NS.word, 'w:r'), picture = document.createElementNS(NS.word, 'w:pict')
    const shape = document.createElementNS('urn:schemas-microsoft-com:vml', 'v:shape'), textbox = document.createElementNS('urn:schemas-microsoft-com:vml', 'v:textbox')
    const content = document.createElementNS(NS.word, 'w:txbxContent'), nested = document.createElementNS(NS.word, 'w:p')
    const nestedRun = document.createElementNS(NS.word, 'w:r'), text = document.createElementNS(NS.word, 'w:t'); text.textContent = 'Nested text'
    nestedRun.appendChild(text); nested.appendChild(nestedRun); content.appendChild(nested); textbox.appendChild(content); shape.appendChild(textbox); picture.appendChild(shape); run.appendChild(picture); outer.appendChild(run)
    pkg.write(pkg.main()); const bytes = pkg.save(), originalNested = nested.toString()
    expect(inspect(bytes).paragraphs[0].editable).toBe(false)
    await expect(applyOfficeContent(bytes, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraphStyle', index: 0, style: { bold: true } }] })).rejects.toThrow('避免扩大修改范围')
    const result = await applyOfficeContent(bytes, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraphStyle', index: 0, style: { alignment: 'center' } }] })
    const after = new OfficePackage(result.bytes)
    expect(descendants(after.xml(after.main()), NS.word, 'txbxContent')[0].firstChild!.toString()).toBe(originalNested)
  })
})
