// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { splitBlock } from 'prosemirror-commands'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { toWordEditorDocument, wordTransactionEdits } from '../../src/renderer/documentFiles/office/wordEditorModel'

it('commits PM paragraph edits through real file CAS and one shared history, then cold reopens', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'word-pm-owner-'))
  try {
    const workspace = path.join(directory, 'workspace'); await fs.mkdir(workspace)
    const owner = path.join(directory, 'owner'), host = new DocumentHostService(owner), root = await host.files.registerRoot(workspace)
    const office = new OfficeFileService(host)
    const created = await office.create({ operationId: 'word-pm-fixture', workspaceId: root.workspaceId, targetDirectoryId: root.rootEntryId, name: 'word.docx' },
      { format: 'docx', operation: 'create', blocks: [{ type: 'paragraph', text: 'BeforeAfter' }, { type: 'paragraph', text: 'Keep me' }] })
    if (created.inspection.format !== 'docx') throw new Error('Expected Word')
    let state = EditorState.create({ doc: toWordEditorDocument(created.inspection) })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 7)))
    let edits: ReturnType<typeof wordTransactionEdits> = []
    expect(splitBlock(state, transaction => { edits = wordTransactionEdits(transaction) })).toBe(true)
    const changed = await office.edit(created.binding, { format: 'docx', operation: 'edit', edits }, { actor: 'human' })
    expect((await office.history(changed.binding)).undoDepth).toBe(1)
    expect((await office.history(changed.binding)).entries[0].actor).toBe('human')
    const words = async (file: string) => {
      const inspection = inspectOfficeContent(await fs.readFile(file), 'docx')
      if (inspection.format !== 'docx') throw new Error('Expected Word')
      return inspection.paragraphs.map(paragraph => paragraph.text)
    }
    expect(await words(changed.binding.path)).toEqual(['Before', 'After', 'Keep me'])
    await expect(office.edit(created.binding, { format: 'docx', operation: 'edit', edits })).rejects.toThrow('文件绑定已失效')
    const undone = await office.moveHistory(changed.binding, 'undo', { actor: 'human' })
    expect(await words(undone.binding.path)).toEqual(['BeforeAfter', 'Keep me'])
    const redone = await office.moveHistory(undone.binding, 'redo', { actor: 'human' })
    expect(await words(redone.binding.path)).toEqual(['Before', 'After', 'Keep me'])
    const coldHost = new DocumentHostService(owner), binding = await coldHost.artifacts.bind(redone.binding.path), coldOffice = new OfficeFileService(coldHost)
    expect((await coldOffice.inspect(binding, 'docx')).inspection).toEqual(redone.inspection)
    expect((await coldOffice.history(binding)).undoDepth).toBe(1)
    const newer = await coldOffice.edit(binding, { format: 'docx', operation: 'edit', edits: [{ type: 'paragraph', index: 0, text: 'AI continuation' }] }, { actor: 'ai' })
    await expect(coldOffice.edit(binding, { format: 'docx', operation: 'edit', edits }, { actor: 'human' })).rejects.toThrow('文件绑定已失效')
    expect(await words(newer.binding.path)).toEqual(['AI continuation', 'After', 'Keep me'])
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
}, 30000)
