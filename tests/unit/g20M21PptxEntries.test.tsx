import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { LessonDirectoryTree } from '../../src/renderer/lessonWorkspace/view/LessonDirectoryTree'
import { LessonWorkspaceShell } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { RegisteredWorkspaceRoot, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { pptxImportFixture } from '../fixtures/pptxImport'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
const roots: string[] = []
const services: WorkspaceFilesDesktopService[] = []
afterEach(async () => {
  cleanup(); vi.unstubAllGlobals()
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) {
    if (!root.startsWith(os.tmpdir())) throw new Error('Invalid temp root')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function workspace() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m21-pptx-'))
  roots.push(directory)
  const { host } = createMarkdownTestHost(path.join(directory, 'journal'))
  const service = new WorkspaceFilesDesktopService(host.files)
  services.push(service)
  const root = await service.authorizeRoot(directory)
  return { directory, service, root }
}

function renderTree(directory: string, service: WorkspaceFilesDesktopService) {
  const onFile = vi.fn()
  render(<LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})} onFile={onFile} onDirectory={vi.fn()} />)
  return onFile
}

/** The only page of an H5 presentation made from the fixture. */
async function pptCourse(file: string) {
  const course = openCourseProjectArchive(new Uint8Array(await fs.readFile(file)))
  expect(course.project.surfaces).toHaveLength(1)
  expect(course.project.surfaces[0]!.type).toBe('slide')
  return course
}

it('M21 imports a .pptx from its right-click menu as a new H5 presentation beside it and opens it', async () => {
  const { directory, service } = await workspace()
  await fs.writeFile(path.join(directory, '第一课.pptx'), pptxImportFixture())
  // The name is taken, so the new file is numbered; the .pptx stays as it was.
  await fs.writeFile(path.join(directory, '第一课.h5lesson'), 'taken')
  const onFile = renderTree(directory, service)
  fireEvent.contextMenu(await screen.findByRole('button', { name: '第一课.pptx' }))
  const menu = screen.getByRole('menu', { name: '文件菜单' })
  expect(within(menu).getAllByRole('menuitem')[0]).toHaveTextContent('导入为 H5 演示')
  fireEvent.click(within(menu).getByRole('menuitem', { name: '导入为 H5 演示' }))
  const created = path.join(directory, '第一课 (2).h5lesson')
  await waitFor(() => expect(onFile).toHaveBeenCalledWith({ name: '第一课 (2).h5lesson', kind: 'file', path: created }))
  const course = await pptCourse(created)
  expect(course.project.title).toBe('第一课')
  expect(await fs.readFile(path.join(directory, '第一课.h5lesson'), 'utf8')).toBe('taken')
  expect(new Uint8Array(await fs.readFile(path.join(directory, '第一课.pptx'))).byteLength).toBeGreaterThan(0)

  // Other files do not offer it.
  fireEvent.contextMenu(screen.getByRole('button', { name: '第一课.h5lesson' }))
  expect(within(screen.getByRole('menu', { name: '文件菜单' })).queryByRole('menuitem', { name: '导入为 H5 演示' })).toBeNull()
})

it('M21 makes a new H5 presentation from a chosen PPT in the folder the 新建 menu was opened for', async () => {
  const { directory, service } = await workspace()
  await fs.mkdir(path.join(directory, 'unit'))
  const onFile = renderTree(directory, service)
  fireEvent.click(await screen.findByRole('button', { name: 'unit' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '从 PPT 新建 H5 演示' }))
  const bytes = pptxImportFixture()
  const file = Object.assign(new File([bytes], '期末复习.pptx'), { arrayBuffer: async () => bytes.slice().buffer })
  fireEvent.change(screen.getByLabelText('选择要在此文件夹新建为 H5 演示的 PPT'), { target: { files: [file] } })
  const created = path.join(directory, 'unit', '期末复习.h5lesson')
  await waitFor(() => expect(onFile).toHaveBeenCalledWith({ name: '期末复习.h5lesson', kind: 'file', path: created }))
  expect((await pptCourse(created)).project.title).toBe('期末复习')

  // A file that is not a PPT fails before anything is written.
  const broken = Object.assign(new File(['not a zip'], '坏文件.pptx'), { arrayBuffer: async () => new TextEncoder().encode('not a zip').buffer })
  fireEvent.click(screen.getByRole('menuitem', { name: '从 PPT 新建 H5 演示' }))
  fireEvent.change(screen.getByLabelText('选择要在此文件夹新建为 H5 演示的 PPT'), { target: { files: [broken] } })
  await screen.findByRole('alert')
  expect(await fs.readdir(path.join(directory, 'unit'))).toEqual(['期末复习.h5lesson'])
})

it('M21 main writes only a valid H5 presentation handed to create-course and reads only .pptx files', async () => {
  const { directory, service, root } = await workspace()
  const deck = pptxImportFixture()
  await fs.writeFile(path.join(directory, 'deck.pptx'), deck)
  await fs.writeFile(path.join(directory, 'notes.txt'), 'x')
  const listed = await service.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const entry = (name: string) => listed.entries.find((item): item is Extract<WorkspaceListItem, { status: 'accessible' }> => item.status === 'accessible' && item.name === name)!
  const scope = (value: RegisteredWorkspaceRoot) => ({ workspaceId: value.workspaceId })

  await expect(service.operate({ type: 'create-course', operationId: 'not-a-course', ...scope(root), targetDirectoryId: root.rootEntryId,
    name: 'bad.h5lesson', archive: new Uint8Array([1, 2, 3]) })).rejects.toThrow('转换得到的文件不是有效的 H5 演示')
  await expect(fs.stat(path.join(directory, 'bad.h5lesson'))).rejects.toThrow()

  await expect(service.operate({ type: 'read-pptx', ...scope(root), entryId: entry('notes.txt').entryId })).rejects.toThrow('只能把 .pptx 文件导入为 H5 演示')
  const read = await service.operate({ type: 'read-pptx', ...scope(root), entryId: entry('deck.pptx').entryId })
  expect(read.name).toBe('deck.pptx')
  expect(read.bytes).toEqual(deck)
})

it('M21 work area: the empty page and the tab bar 新建 menu both make a new H5 presentation from a chosen PPT', async () => {
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'recent-workspaces': return { recent: [] }
      case 'list-lessons': return { lessons: [] }
      case 'list-projects': return { projects: [] }
      default: throw new Error(`Unexpected ${request.operation}`)
    }
  })
  const port: RecoverableDocumentFilePort = { openDocument: async () => { throw new Error('ENOENT') }, watchDocument: () => () => {}, saveDocument: vi.fn() }
  const onNewProject = vi.fn(async () => true), onNewProjectFromPptx = vi.fn(async () => true)
  render(<LessonWorkspaceShell lessonOperation={operation} documentPort={port} projectPath={null}
    onOpenProject={async () => true} onNewProject={onNewProject} onNewProjectFromPptx={onNewProjectFromPptx}>课程宿主</LessonWorkspaceShell>)
  const entries = screen.getAllByRole('button', { name: '从 PPT 新建 H5 演示' })
  // One in the 新建 popover of the tab bar, one on the empty page.
  expect(entries).toHaveLength(2)
  const bytes = pptxImportFixture()
  for (const [index, entry] of entries.entries()) {
    fireEvent.click(entry)
    const file = Object.assign(new File([bytes], `第${index + 1}课.pptx`), { arrayBuffer: async () => bytes.slice().buffer })
    fireEvent.change(screen.getByLabelText('选择要新建为 H5 演示的 PPT'), { target: { files: [file] } })
    await waitFor(() => expect(onNewProjectFromPptx).toHaveBeenLastCalledWith({ name: `第${index + 1}课.pptx`, bytes }))
  }
  expect(onNewProjectFromPptx).toHaveBeenCalledTimes(2)
  expect(onNewProject).not.toHaveBeenCalled()
})


it('lists the actual source-page losses before creation and cancel makes no course file', async () => {
  const { directory, service } = await workspace(), bytes = pptxImportFixture({ unsupported: true })
  const original = path.join(directory, '带损失.pptx'); await fs.writeFile(original, bytes)
  const onFile = renderTree(directory, service)
  const begin = async () => {
    fireEvent.contextMenu(await screen.findByRole('button', { name: '带损失.pptx' }))
    fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('menuitem', { name: '导入为 H5 演示' }))
    return screen.findByRole('alertdialog', { name: '确认 PPT 转换结果' })
  }
  const dialog = await begin()
  const details = within(dialog).getByLabelText('完整 PPT 转换损失详情') as HTMLTextAreaElement
  expect(details.value).toContain('第 1 页'); expect(details.value.length).toBeGreaterThan(10)
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '确认 PPT 转换结果' })).toBeNull())
  expect(onFile).not.toHaveBeenCalled()
  expect((await fs.readdir(directory)).filter(file => file.endsWith('.h5lesson'))).toEqual([])
  expect(await fs.readFile(original)).toEqual(Buffer.from(bytes))
  const accepted = await begin()
  fireEvent.click(within(accepted).getByRole('button', { name: '确认并新建' }))
  await waitFor(() => expect(onFile).toHaveBeenCalled())
  expect(await fs.readFile(original)).toEqual(Buffer.from(bytes))
})
