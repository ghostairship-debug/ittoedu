import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { TextSelection } from 'prosemirror-state'
import { strFromU8, unzipSync } from 'fflate'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import { TableComponentEditor } from '../../src/components/table/editor'
import * as sessions from '../../src/renderer/document/editorSession'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'

it('edits an ordinary plain cell with the real rich editor, promotes marks and saves actual rich DOCX content', async () => {
  const table = createTableData({ rows: 1, columns: 2 })
  table.rows[0].cells[0].text = '普通单元格'
  table.rows[0].cells[1].text = '保留邻格'
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'table-rich-edit', revision: 0, title: '表格',
    definitions: { [TABLE_DEFINITION.id]: TABLE_DEFINITION }, instances: { table: { id: 'table', definitionId: TABLE_DEFINITION.id, data: JSON.parse(JSON.stringify(table)), frame: { width: 640, height: 160, transform: [1, 0, 0, 1, 0, 0] } } },
    surfaces: [{ id: 'flow', kind: 'flow', title: '表格', childIds: ['table'] }], global: { underlay: [], overlay: [] }, assets: {} }
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, binding: { kind: 'untitled', suggestedName: 'table.h5lesson' } }, driver, { async append() {}, async save() { throw new Error('uses real Driver below') } })
  const factory = vi.spyOn(sessions, 'createLayoutEditor')
  const onEdit = vi.fn(async (edit: ComponentEdit) => {
    const before = session.read()
    if (before.model.kind !== 'course-v10') throw new Error('expected V10')
    const result = await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: crypto.randomUUID(), baseRevision: before.revision, actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, [edit]) } })
    if (result.status !== 'applied') throw new Error('edit rejected')
  })
  const ui = render(<TableComponentEditor instanceId="table" data={table} onEdit={onEdit} onUndo={() => {}} onRedo={() => {}} />)
  try {
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof sessions.createLayoutEditor>
    expect(ui.queryByRole('textbox', { name: '单元格内容' })).toBeNull()
    act(() => { editor.view.focus(); editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, 3))) })
    await act(async () => fireEvent.click(within(ui.getByRole('toolbar', { name: '正文工具' })).getByRole('button', { name: '粗体' })))
    await vi.waitFor(() => expect(onEdit).toHaveBeenCalledOnce())
    const snapshot = session.read(), model = snapshot.model
    if (model.kind !== 'course-v10') throw new Error('expected V10')
    const edited = parseTableData(model.project.instances.table.data)
    expect(edited.rows[0].cells[0]).not.toHaveProperty('text')
    expect(edited.rows[0].cells[0].content?.inlines).toMatchObject([{ text: '普通', style: { bold: true } }, { text: '单元格' }])
    expect(edited.rows[0].cells[1]).toEqual(table.rows[0].cells[1])
    expect(snapshot.undoDepth).toBe(1)
    expect(driver.load(driver.serialize(model))).toEqual(model)
    const word = await buildComponentDocx(model.project, { surfaceId: 'flow' })
    const xml = strFromU8(unzipSync(word.bytes)['word/document.xml'])
    const dom = new DOMParser().parseFromString(xml, 'application/xml')
    const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const run = Array.from(dom.getElementsByTagNameNS(w, 'r')).find(node => node.textContent === '普通')
    expect(run?.getElementsByTagNameNS(w, 'b')).toHaveLength(1)
    expect(dom.documentElement.textContent).toContain('保留邻格')
  } finally { cleanup(); factory.mockRestore() }
})
