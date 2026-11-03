// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DocxFileEditor } from '../../src/renderer/documentFiles/office/DocxFileEditor'
import { XlsxFileEditor } from '../../src/renderer/documentFiles/office/XlsxFileEditor'
import type { OfficeDocumentSnapshot } from '../../src/shared/workbench/officeDocument'
import type { OfficeEditorHandle } from '../../src/renderer/documentFiles/office/officeEditorHandle'

afterEach(cleanup)
function snapshot(format: 'docx' | 'xlsx', version = 'v1'): OfficeDocumentSnapshot {
  return { binding: { path: `D:/sample.${format}`, bindingVersion: 1, fileVersion: version }, bytes: new Uint8Array(), history: { undoDepth: 1, redoDepth: 0, entries: [] }, inspection: format === 'docx'
    ? { format, paragraphs: [{ index: 0, text: version === 'v1' ? 'Original text' : 'New AI text', editable: true }], tables: [] }
    : { format, sheets: [{ name: 'Data', part: 'xl/worksheets/sheet1.xml', sheetId: '1', cells: [{ cell: 'A1', value: version === 'v1' ? 10 : 99 }] }] } }
}

describe('Office leaf drafts use the version where input began', () => {
  it('keeps Word input after an external revision and submits the original binding', async () => {
    const original = snapshot('docx'), onEdit = vi.fn().mockRejectedValue(new Error('version conflict'))
    const props = { snapshot: original, name: 'sample.docx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const view = render(<DocxFileEditor {...props} />)
    const textbox = screen.getByRole('textbox', { name: '第 1 段' })
    textbox.textContent = 'Human draft'; fireEvent.input(textbox)
    view.rerender(<DocxFileEditor {...props} snapshot={snapshot('docx', 'v2')} />)
    expect(textbox.textContent).toBe('Human draft')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    const [binding, content] = onEdit.mock.calls[0]
    expect(binding).toEqual(original.binding)
    expect(content.format).toBe('docx')
    let applied = 'Original text'
    for (const edit of content.edits) {
      expect(edit).toMatchObject({ type: 'replaceRange', start: { paragraph: 0 }, end: { paragraph: 0 } })
      expect(edit.paragraphs).toHaveLength(1)
      applied = applied.slice(0, edit.start.offset) + edit.paragraphs[0].runs.map((run: { text: string }) => run.text).join('') + applied.slice(edit.end.offset)
    }
    expect(applied).toBe('Human draft')
    expect(await screen.findByText('version conflict')).toBeTruthy()
    expect(textbox.textContent).toBe('Human draft')
  })

  it('keeps Excel formula input after an external revision and submits the original binding', async () => {
    const original = snapshot('xlsx'), onEdit = vi.fn().mockRejectedValue(new Error('version conflict'))
    const props = { snapshot: original, name: 'sample.xlsx', onEdit, onUndo: vi.fn(), onRedo: vi.fn() }
    const view = render(<XlsxFileEditor {...props} />)
    const cell = screen.getByRole('textbox', { name: 'Data!A1' }) as HTMLInputElement
    fireEvent.change(cell, { target: { value: '=A2*2' } })
    view.rerender(<XlsxFileEditor {...props} snapshot={snapshot('xlsx', 'v2')} />)
    expect(cell.value).toBe('=A2*2')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith(original.binding, { format: 'xlsx', edits: [{ sheet: 'Data', cell: 'A1', value: { formula: 'A2*2' } }] }))
    expect(await screen.findByText('version conflict')).toBeTruthy()
    expect(cell.value).toBe('=A2*2')
  })

  it('allows the shared history owner to flush an already drained editor without reentrant failure', async () => {
    const ref = createRef<OfficeEditorHandle>(), original = snapshot('docx')
    const onUndo = vi.fn(async () => { expect(await ref.current!.flush()).toBe(true) })
    render(<DocxFileEditor ref={ref} snapshot={original} name="sample.docx" onEdit={vi.fn()} onUndo={onUndo} onRedo={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(onUndo).toHaveBeenCalledTimes(1))
  })
})
