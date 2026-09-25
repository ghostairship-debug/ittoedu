import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { LessonDirectoryTree } from '../../src/renderer/lessonWorkspace/view/LessonDirectoryTree'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { createCourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { createLessonDocumentFiles } from '../../src/main/lessonDocumentFiles'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
const roots: string[] = []
const services: WorkspaceFilesDesktopService[] = []
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); for (const service of services.splice(0)) service.dispose(); vi.restoreAllMocks(); for (const root of roots.splice(0)) { if (!root.startsWith(os.tmpdir())) throw new Error('Invalid temp root'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-file-tree-')); roots.push(root); return root }
it('reports selected file and folder scopes without opening a file on single click', async () => {
  const directory = await fixture(), folder = path.join(directory, 'unit')
  await fs.mkdir(folder); await fs.writeFile(path.join(folder, 'a.md'), 'text')
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files)
  services.push(service); await service.authorizeRoot(directory)
  const onScope = vi.fn(), onFile = vi.fn()
  render(<LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})}
    onFile={onFile} onDirectory={vi.fn()} onScope={onScope} />)
  fireEvent.click(await screen.findByRole('button', { name: 'unit' }))
  await waitFor(() => expect(onScope).toHaveBeenCalledWith(folder, 'folder', expect.any(String)))
  fireEvent.click(screen.getByRole('button', { name: '展开 unit' }))
  fireEvent.click(await screen.findByRole('button', { name: 'a.md' }))
  await waitFor(() => expect(onScope).toHaveBeenLastCalledWith(path.join(folder, 'a.md'), 'file', expect.any(String)))
  expect(onFile).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '工作空间根目录' }))
  expect(onScope).toHaveBeenLastCalledWith(directory, 'folder', expect.any(String))
})
it('keeps a newer watcher listing when an earlier refresh returns after it', async () => {
  const directory = await fixture()
  const root = { workspaceId: 'workspace', rootEntryId: 'root', resolvedPath: directory }
  const a: WorkspaceListItem = { status: 'accessible', entryId: 'a', name: 'a.md', kind: 'file' }
  const b: WorkspaceListItem = { status: 'accessible', entryId: 'b', name: 'b.md', kind: 'file' }
  const listeners = new Set<(event: { workspaceId: string }) => void>()
  let entries = [a], holdNext = false, heldStarted = false
  let release!: (value: { entries: WorkspaceListItem[] }) => void
  const held = new Promise<{ entries: WorkspaceListItem[] }>(resolve => { release = resolve })
  const files = Object.assign(async (request: WorkspaceFilesRequest): Promise<unknown> => {
    if (request.type === 'root') return root
    if (request.type === 'watch') return { workspaceId: root.workspaceId, watching: true }
    if (request.type === 'list') {
      if (holdNext) { holdNext = false; heldStarted = true; return held }
      return { entries }
    }
    throw new Error(`Unexpected ${request.type}`)
  }, { subscribe(listener: (event: { workspaceId: string }) => void) { listeners.add(listener); return () => { listeners.delete(listener) } } }) as unknown as WorkspaceFilesAPI
  render(<LessonDirectoryTree directory={directory} files={files} operation={async () => ({})} onFile={vi.fn()} onDirectory={vi.fn()} />)
  await screen.findByRole('button', { name: 'a.md' })
  await waitFor(() => expect(listeners.size).toBe(1))
  holdNext = true
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(heldStarted).toBe(true))
  entries = [a, b]
  act(() => { for (const listener of listeners) listener({ workspaceId: root.workspaceId }) })
  await screen.findByRole('button', { name: 'b.md' })
  await act(async () => { release({ entries: [a] }); await held })
  expect(screen.getByRole('button', { name: 'b.md' })).toBeInTheDocument()
})
it('retains expansion and selection when a watcher sees an external directory rename', async () => {
  const directory = await fixture()
  const folder = path.join(directory, 'folder')
  await fs.mkdir(folder)
  await fs.writeFile(path.join(folder, 'note.md'), 'keep')
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files)
  services.push(service); await service.authorizeRoot(directory)
  render(<LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})} onFile={vi.fn()} onDirectory={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '展开 folder' }))
  const note = await screen.findByRole('button', { name: 'note.md' })
  fireEvent.click(note)
  const folderId = screen.getByRole('button', { name: 'folder' }).getAttribute('data-entry-id')
  const noteId = note.getAttribute('data-entry-id')

  await fs.rename(folder, path.join(directory, 'renamed'))
  const renamed = await screen.findByRole('button', { name: 'renamed' })
  expect(renamed).toHaveAttribute('data-entry-id', folderId)
  expect(renamed.closest('li')).toHaveAttribute('data-open', 'true')
  expect(screen.getByRole('button', { name: 'note.md' })).toHaveAttribute('data-entry-id', noteId)
  expect(screen.getByRole('button', { name: 'note.md' })).toHaveAttribute('aria-pressed', 'true')
})
it('does not submit a rename when Enter belongs to its Cancel button', async () => {
  const directory = await fixture()
  await fs.writeFile(path.join(directory, 'note.md'), 'keep')
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files)
  services.push(service); await service.authorizeRoot(directory)
  render(<LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})} onFile={vi.fn()} onDirectory={vi.fn()} />)
  const note = await screen.findByRole('button', { name: 'note.md' })
  fireEvent.click(note)
  fireEvent.keyDown(note, { key: 'F2' })
  fireEvent.change(screen.getByLabelText('文件名称'), { target: { value: 'wrong.md' } })
  const cancel = screen.getByRole('button', { name: '取消' })
  fireEvent.keyDown(cancel, { key: 'Enter' })
  fireEvent.click(cancel)
  expect(await fs.readFile(path.join(directory, 'note.md'), 'utf8')).toBe('keep')
  await expect(fs.access(path.join(directory, 'wrong.md'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('moves a Markdown file through explicit resource choice and keeps an expanded destination while refreshing results', async () => {
  const directory = await fixture(), target = path.join(directory, 'target')
  await fs.mkdir(target); await fs.writeFile(path.join(directory, 'note.md'), '![A](image.png)'); await fs.writeFile(path.join(directory, 'image.png'), 'image')
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files)
  services.push(service); await service.authorizeRoot(directory)
  render(<LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})} onFile={vi.fn()} onDirectory={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '展开 target' }))
  fireEvent.click(await screen.findByRole('button', { name: 'note.md' }))
  fireEvent.contextMenu(screen.getByRole('button', { name: 'note.md' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('button', { name: '移动到…' }))
  const select = await screen.findByLabelText('目标文件夹')
  await waitFor(() => expect([...select.querySelectorAll('option')].some(item => item.textContent === 'target')).toBe(true))
  const targetId = [...select.querySelectorAll('option')].find(item => item.textContent === 'target')!.value
  fireEvent.change(select, { target: { value: targetId } })
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  const continueResources = await screen.findByRole('button', { name: '连同资源继续' }); await waitFor(() => expect(continueResources).not.toBeDisabled()); fireEvent.click(continueResources)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(await fs.readFile(path.join(target, 'note.md'), 'utf8')).toBe('![A](image.png)')
  expect(await fs.readFile(path.join(target, 'image.png'), 'utf8')).toBe('image')
  expect(await fs.readFile(path.join(directory, 'image.png'), 'utf8')).toBe('image')
  expect(screen.getByRole('button', { name: 'target' }).closest('li')).toHaveAttribute('data-open', 'true')
  expect(screen.getByRole('button', { name: 'note.md' })).toBeInTheDocument()
})
it('renames a dirty open tab without replacing its editor, preserves History, and saves only the new binding', async () => {
  const directory = await fixture(), filename = path.join(directory, 'note.md')
  await fs.writeFile(filename, '原稿')
  const { host, documents } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files); services.push(service); await service.authorizeRoot(directory)
  const files = { ...createLessonDocumentFiles({ recoveryDirectory: path.join(directory, 'ai'), validateTarget: async () => {}, documents }), documents }
  const handle = createRef<LessonWorkspaceShellHandle>()
  render(<LessonWorkspaceShell ref={handle} workspaceFiles={service.operate} documentPort={files} lessonOperation={async request => request.operation === 'choose-workspace' ? { directory } : { lessons: [], projects: [], conversations: [] }} projectPath={null} onOpenProject={async () => true} onNewProject={async () => true}>课件</LessonWorkspaceShell>)
  fireEvent.click(screen.getByRole('button', { name: '选择其他工作空间文件夹…' }))
  fireEvent.dblClick(await screen.findByRole('button', { name: 'note.md' }))
  fireEvent.click(screen.getByRole('button', { name: 'note.md' }))
  await screen.findByText('原稿')
  const editor = document.querySelector('.ProseMirror')!
  const before = (await documents.list())[0]!
  await act(async () => { await documents.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: 'edit', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: '教师新稿' } } }) })
  fireEvent.contextMenu(screen.getByRole('button', { name: 'note.md' }))
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('button', { name: '重命名' }))
  fireEvent.change(screen.getByLabelText('文件名称'), { target: { value: 'renamed.md' } })
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await screen.findByRole('tab', { name: /renamed.md/ })
  expect(document.querySelector('.ProseMirror')).toBe(editor)
  expect((await documents.read(before.documentId)).undoDepth).toBe(1)
  await act(async () => { expect(await handle.current!.preserveAll()).toBe(true) })
  expect(screen.getByRole('tab', { name: /renamed.md/ })).toBeInTheDocument()
  expect(document.querySelector('.ProseMirror')).toBe(editor)
  fireEvent.click(screen.getByRole('button', { name: /^保存$/ }))
  await waitFor(async () => expect(await fs.readFile(path.join(directory, 'renamed.md'), 'utf8')).toBe('教师新稿'))
  await expect(fs.access(filename)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('keeps keyboard commands scoped to the tree and performs multi-file clipboard, child creation, watcher refresh and rename cancellation', async () => {
  const directory = await fixture(); await fs.mkdir(path.join(directory, 'child'))
  await fs.writeFile(path.join(directory, 'a.md'), 'A'); await fs.writeFile(path.join(directory, 'b.md'), 'B')
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files); services.push(service); await service.authorizeRoot(directory)
  const opened = vi.fn()
  render(<><input aria-label="聊天文字" defaultValue="keep" /><LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})} onFile={opened} onDirectory={vi.fn()} /></>)
  const a = await screen.findByRole('button', { name: 'a.md' }), b = screen.getByRole('button', { name: 'b.md' })
  fireEvent.click(a); expect(opened).not.toHaveBeenCalled()
  fireEvent.keyDown(a, { key: 'Enter' }); await waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  fireEvent.click(b, { ctrlKey: true }); fireEvent.keyDown(b, { key: 'c', ctrlKey: true })
  fireEvent.click(screen.getByRole('button', { name: 'child' })); fireEvent.keyDown(screen.getByRole('button', { name: 'child' }), { key: 'v', ctrlKey: true })
  await waitFor(async () => expect(await fs.readFile(path.join(directory, 'child', 'a.md'), 'utf8')).toBe('A'))
  expect(await fs.readFile(path.join(directory, 'child', 'b.md'), 'utf8')).toBe('B')
  await waitFor(() => expect(screen.getByRole('button', { name: '新建文本文件' })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: '新建文本文件' }))
  const name = screen.getByLabelText('文件名称'); fireEvent.change(name, { target: { value: 'notes.txt' } })
  for (const key of ['F2', 'Delete']) fireEvent.keyDown(name, { key })
  for (const key of ['c', 'x', 'v']) fireEvent.keyDown(name, { key, ctrlKey: true })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await waitFor(async () => expect(await fs.readFile(path.join(directory, 'child', 'notes.txt'), 'utf8')).toBe(''))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await fs.writeFile(path.join(directory, 'external.txt'), 'external')
  await screen.findByRole('button', { name: 'external.txt' })
  expect(screen.getByRole('button', { name: 'child' }).closest('li')).toHaveAttribute('data-open', 'true')
  await waitFor(() => expect(screen.getByRole('button', { name: '新建文档' })).not.toBeDisabled())
  const chat = screen.getByLabelText('聊天文字')
  for (const key of ['F2', 'Delete']) fireEvent.keyDown(chat, { key })
  for (const key of ['c', 'x', 'v']) fireEvent.keyDown(chat, { key, ctrlKey: true })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'external.txt' })); fireEvent.keyDown(screen.getByRole('button', { name: 'external.txt' }), { key: 'F2' })
  fireEvent.keyDown(screen.getByLabelText('文件名称'), { key: 'Escape' }); expect(await fs.readFile(path.join(directory, 'external.txt'), 'utf8')).toBe('external')
  fireEvent.click(screen.getByRole('button', { name: 'child' })); fireEvent.click(screen.getByRole('button', { name: '新建课件' }))
  fireEvent.change(screen.getByLabelText('文件名称'), { target: { value: 'new-course' } }); fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await waitFor(async () => { const model = await createCourseV9Driver().load(await fs.readFile(path.join(directory, 'child', 'new-course.h5lesson'))); expect(model.kind).toBe('course-v9') })
  await waitFor(() => expect(screen.getByRole('button', { name: '新建文档' })).not.toBeDisabled())
  const dropped = Object.assign(new File(['payload'], 'photo.png'), { arrayBuffer: async () => new TextEncoder().encode('payload').buffer })
  let reads = 0
  const directoryEntry = { name: 'bundle', isFile: false, isDirectory: true, createReader: () => ({ readEntries: (resolve: (entries: unknown[]) => void) => resolve(reads++ ? [] : [{ name: 'photo.png', isFile: true, isDirectory: false, file: (resolveFile: (file: File) => void) => resolveFile(dropped) }]) }) }
  fireEvent.drop(screen.getByRole('button', { name: '工作空间根目录' }), { dataTransfer: { files: [dropped], items: [{ kind: 'file', webkitGetAsEntry: () => directoryEntry }], types: ['Files'], getData: () => '' } })
  await waitFor(async () => expect(await fs.readFile(path.join(directory, 'bundle', 'photo.png'), 'utf8')).toBe('payload'))

})
