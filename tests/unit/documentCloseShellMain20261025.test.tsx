import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import { DocumentFileSession } from '../../src/renderer/documentFiles/documentFileSession'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import { IPC_CHANNELS } from '../../src/shared/ipcTypes'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'
import * as editorSessions from '../../src/renderer/document/editorSession'

const native = vi.hoisted(() => ({ message: vi.fn(), ipc: undefined as unknown as EventEmitter }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  native.ipc = new EventEmitter()
  return { app: undefined, dialog: { showMessageBox: native.message }, ipcMain: native.ipc }
})
vi.mock('../../src/main/workbench/execution/ExecutionDesktopService', () => ({
  executionDesktopService: async () => ({ writableTasksForDocument: async () => ({ runIds: [], submissionIds: [] }) }),
}))
vi.mock('../../src/main/workbench/external/externalDesktopService', () => ({
  externalMcpService: async () => ({ writableSessionsForDocument: () => [] }),
}))
vi.mock('../../src/main/workbench/documentSaveDialog', () => ({
  saveDocumentWithDialog: vi.fn(async () => { throw new Error('Cancelled close must not reach save') }),
}))
import { closeDocumentWithDialog } from '../../src/main/workbench/documentCloseDialog'

const roots: string[] = []
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); native.message.mockReset() })
afterEach(async () => {
  cleanup(); native.ipc.removeAllListeners(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('close-shell-main-'))
      throw new Error('Unexpected close fixture directory')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'close-shell-main-')); roots.push(root)
  const filename = path.join(root, 'a.md'), journal = path.join(root, 'journal')
  await fs.writeFile(filename, 'A base\n\nKeep tail\n')
  const h = createMarkdownTestHost(journal)
  const filesFor = (documents: typeof h.documents) => ({ ...createLessonDocumentFiles({
    recoveryDirectory: path.join(root, 'file-metadata'), validateTarget: async () => {}, documents,
  }), documents })
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'recent-workspaces': return { recent: [] }
      case 'list-lessons': return { lessons: [] }
      case 'list-projects': return { projects: [] }
      case 'list-directory': return { entries: [{ kind: 'file' as const, path: filename, name: 'a.md' }] }
      default: throw new Error(`Unexpected shell operation: ${request.operation}`)
    }
  })
  const mount = (documents = h.documents) => {
    const handle = createRef<LessonWorkspaceShellHandle>()
    const ui = render(<LessonWorkspaceShell ref={handle} lessonOperation={operation} documentPort={filesFor(documents)} projectPath={null}
      onOpenProject={async () => true} onNewProject={async () => true} renderAssistant={() => <p>统一助手</p>}>课程宿主</LessonWorkspaceShell>)
    return { ...ui, handle }
  }
  const mainWindow = (handle: ReturnType<typeof mount>['handle']) => {
    const sends: unknown[][] = [], pending: Promise<void>[] = []
    const contents = Object.assign(new EventEmitter(), { send: (channel: string, requestIdOrIds: string | string[], ids?: string[]) => {
      sends.push([channel, requestIdOrIds, ids])
      if (channel === IPC_CHANNELS.requestResumeClose) { handle.current!.resumeAfterCloseCancelled(requestIdOrIds as string[]); return }
      if (channel !== IPC_CHANNELS.requestPreserveAndClose) throw new Error(`Unexpected close preparation: ${channel}`)
      const task = handle.current!.preserveAll('preserve', ids).then(ready => {
        native.ipc.emit(IPC_CHANNELS.preserveAndCloseResult, { sender: contents }, requestIdOrIds, ready, undefined, handle.current!.hasDirtyInputs(ids))
      })
      pending.push(task)
    } })
    return { window: Object.assign(new EventEmitter(), { webContents: contents, isDestroyed: () => false }) as unknown as BrowserWindow,
      sends, drain: () => Promise.all(pending) }
  }
  return { ...h, root, filename, journal, mount, mainWindow }
}

it('keeps a conflicted tab and canonical History, preserves unapplied merge input through Main cancel, and restores both in a new Host without writing disk', async () => {
  const f = await fixture(), baseline = await f.documents.open(f.filename)
  const canonical = 'A teacher\n\nKeep tail\n', disk = 'A external\n\nKeep tail\n'
  await f.documents.dispatch({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
    operationId: 'teacher-before-conflict', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: canonical } } })
  await fs.writeFile(f.filename, disk)
  const save = vi.spyOn(f.host, 'saveToPath'), close = vi.spyOn(DocumentFileSession.prototype, 'close')
  const ui = f.mount()
  await act(async () => { await ui.handle.current!.openFile(f.filename) })
  expect((await screen.findAllByRole('button', { name: '此处保留当前稿' })).length).toBeGreaterThan(0)
  const manualInput = within(screen.getByRole('group', { name: '冲突 1' })).getByLabelText('合并内容')
  const editor = document.querySelector('.ProseMirror')
  expect(editor).not.toBeNull()
  fireEvent.change(manualInput, { target: { value: 'manual merge, not applied' } })
  fireEvent.click(screen.getByRole('button', { name: '关闭 a.md' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  await act(async () => { expect(await close.mock.results.at(-1)!.value).toBe(false) })
  expect(screen.getByRole('tab', { name: /a.md/ })).toBeInTheDocument()
  await act(async () => { expect(await ui.handle.current!.closeAll()).toBe(false) })
  await act(async () => { expect(await ui.handle.current!.preserveAll()).toBe(true) })
  expect(document.querySelector('.ProseMirror')).toBe(editor)
  expect(await f.documents.read(baseline.documentId)).toMatchObject({ dirty: true, undoDepth: 1, model: { source: canonical } })
  expect((await f.documents.readAuthoringDrafts(baseline.documentId))!.sourceConflicts).toEqual([
    expect.objectContaining({ source: canonical, hunks: [expect.objectContaining({ text: 'manual merge, not applied' })] }),
  ])
  const bridge = f.mainWindow(ui.handle)
  native.message.mockResolvedValue({ response: 2 })
  await act(async () => { expect(await closeDocumentWithDialog(bridge.window, f.host, baseline.documentId)).toBe(false); await bridge.drain() })
  expect(native.message).toHaveBeenCalledWith(bridge.window, expect.objectContaining({ title: '保存文档更改' }))
  expect(bridge.sends.at(-1)).toEqual([IPC_CHANNELS.requestResumeClose, [baseline.documentId], undefined])
  expect(document.querySelector('.ProseMirror')).toBe(editor)
  fireEvent.change(manualInput, { target: { value: 'manual input after cancelled close' } })
  await act(async () => { expect(await ui.handle.current!.preserveAll()).toBe(true) })
  expect(save).not.toHaveBeenCalled()
  expect(await fs.readFile(f.filename, 'utf8')).toBe(disk)
  ui.unmount()

  const restarted = createMarkdownTestHost(f.journal)
  expect((await restarted.documents.recoverySummaries!()).some(value => value.documentId === baseline.documentId)).toBe(true)
  // The existing recovery entry restores the journal before asking Shell to
  // focus its document; ordinary Open File does not silently select a draft.
  await restarted.documents.restore(baseline.documentId)
  const restoredUi = f.mount(restarted.documents)
  await act(async () => { await restoredUi.handle.current!.focusDocument(baseline.documentId) })
  await waitFor(() => expect(within(screen.getByRole('group', { name: '冲突 1' })).getByLabelText('合并内容'))
    .toHaveValue('manual input after cancelled close'))
  const recovered = (await restarted.documents.list()).find(value => value.documentId === baseline.documentId)!
  expect(recovered).toMatchObject({ dirty: true, undoDepth: 1, model: { source: canonical } })
  expect(recovered.epoch).not.toBe(baseline.epoch)
  await act(async () => { expect(await restoredUi.handle.current!.preserveAll()).toBe(true) })
  await waitFor(async () => expect((await restarted.documents.readAuthoringDrafts(recovered.documentId))!.sourceConflicts).toEqual([
    expect.objectContaining({ epoch: recovered.epoch, source: canonical,
      hunks: [expect.objectContaining({ text: 'manual input after cancelled close' })] }),
  ]))
  expect(await fs.readFile(f.filename, 'utf8')).toBe(disk)
})

it('returns from the real Main cancel to the same mounted editor, accepts new input and undoes it once without saving the file', async () => {
  const f = await fixture(), baseline = await f.documents.open(f.filename), canonical = 'A teacher\n\nKeep tail\n'
  await f.documents.dispatch({ documentId: baseline.documentId, epoch: baseline.epoch, baseRevision: baseline.revision,
    operationId: 'teacher-before-close', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: canonical } } })
  const layouts = vi.spyOn(editorSessions, 'createLayoutEditor'), ui = f.mount()
  await act(async () => { await ui.handle.current!.openFile(f.filename) })
  await screen.findByText('A teacher')
  const editor = document.querySelector('.ProseMirror'), layout = layouts.mock.results.at(-1)!.value as ReturnType<typeof editorSessions.createLayoutEditor>
  const bridge = f.mainWindow(ui.handle), save = vi.spyOn(f.host, 'saveToPath')
  native.message.mockResolvedValue({ response: 2 })
  await act(async () => { expect(await closeDocumentWithDialog(bridge.window, f.host, baseline.documentId)).toBe(false); await bridge.drain() })
  expect(document.querySelector('.ProseMirror')).toBe(editor)
  act(() => { layout.view.dispatch(layout.view.state.tr.insertText(' after cancel', 1 + 'A teacher'.length)) })
  await act(async () => { expect(await ui.handle.current!.preserveAll()).toBe(true) })
  await waitFor(async () => expect(await f.documents.read(baseline.documentId)).toMatchObject({ undoDepth: 2,
    model: { source: 'A teacher after cancel\n\nKeep tail\n' } }))
  fireEvent.keyDown(layout.view.dom, { key: 'z', ctrlKey: true })
  await waitFor(async () => expect(await f.documents.read(baseline.documentId)).toMatchObject({ undoDepth: 1, redoDepth: 1, model: { source: canonical } }))
  expect(document.querySelector('.ProseMirror')).toBe(editor)
  expect(save).not.toHaveBeenCalled()
  expect(await fs.readFile(f.filename, 'utf8')).toBe('A base\n\nKeep tail\n')
})
