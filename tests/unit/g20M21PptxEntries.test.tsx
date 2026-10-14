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
import type { RegisteredWorkspaceRoot, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { pptxImportFixture } from '../fixtures/pptxImport'
import { createCourseFromPptx } from '../../src/renderer/project/pptxCourseCreation'
import { confirmPptxLosses } from '../../src/renderer/project/confirmPptxLosses'

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

function contentImports() {
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'recent-workspaces': return { recent: [] }
      case 'list-lessons': return { lessons: [] }
      case 'list-projects': return { projects: [] }
      default: throw new Error(`Unexpected ${request.operation}`)
    }
  })
  const port: RecoverableDocumentFilePort = { openDocument: async () => { throw new Error('ENOENT') }, watchDocument: () => () => {}, saveDocument: vi.fn() }
  const onNewProject = vi.fn(async () => true), completed = vi.fn(), flow = vi.fn(), html = vi.fn()
  const onNewProjectFromPptx = vi.fn(async ({ name, bytes }: { name: string; bytes: Uint8Array }) => {
    const course = await createCourseFromPptx(bytes, name.replace(/\.pptx$/i, ''))
    if (!await confirmPptxLosses(name, course.issues)) return false
    completed(course)
    return true
  })
  render(<LessonWorkspaceShell lessonOperation={operation} documentPort={port} projectPath={null}
    onOpenProject={async () => true} onNewProject={onNewProject} onNewProjectFromPptx={onNewProjectFromPptx} onImportFlow={flow} onImportHtml={html}>课程宿主</LessonWorkspaceShell>)
  const choosePptx = (bytes: Uint8Array, name = '第一课.pptx') => {
    fireEvent.click(screen.getByLabelText('导入'))
    fireEvent.click(screen.getByRole('menuitem', { name: /PowerPoint/ }))
    const file = Object.assign(new File([bytes.slice().buffer], name), { arrayBuffer: async () => bytes.slice().buffer })
    fireEvent.change(screen.getByLabelText('选择要导入的 PPT'), { target: { files: [file] } })
  }
  return { onNewProject, onNewProjectFromPptx, completed, flow, html, choosePptx }
}

it('keeps creation in folder/MD/TXT/course order and removes the explorer-only PPT writer', async () => {
  const { directory, service } = await workspace()
  const bytes = pptxImportFixture()
  await fs.writeFile(path.join(directory, '第一课.pptx'), bytes)
  const onFile = vi.fn()
  render(<LessonDirectoryTree directory={directory} files={service.operate} operation={async () => ({})} onFile={onFile} onDirectory={vi.fn()} />)
  const file = await screen.findByRole('button', { name: '第一课.pptx' })
  const create = document.querySelector('.workspace-files-create-options') as HTMLElement
  expect(within(create).getAllByRole('menuitem').map(button => button.getAttribute('aria-label')))
    .toEqual(['新建文件夹', '新建 MD 文档', '新建 TXT 文档', '新建 果铃工程'])
  fireEvent.contextMenu(file)
  const menu = screen.getByRole('menu', { name: '文件菜单' })
  expect(within(menu).queryByRole('menuitem', { name: /导入为.*果铃工程/ })).toBeNull()
  expect(within(menu).queryByRole('menuitem', { name: /从 PPT 新建/ })).toBeNull()
  expect(onFile).not.toHaveBeenCalled()
  expect((await fs.readdir(directory)).filter(name => name.endsWith('.glx'))).toEqual([])
  expect(new Uint8Array(await fs.readFile(path.join(directory, '第一课.pptx')))).toEqual(bytes)
})

it('imports PPT through the empty content import menu, preserving actual parsing and the existing course callback', async () => {
  const fixture = contentImports(), bytes = pptxImportFixture()
  expect(screen.queryByRole('button', { name: /从 PPT 新建/ })).toBeNull()
  fixture.choosePptx(bytes)
  await waitFor(() => expect(fixture.completed).toHaveBeenCalledOnce())
  expect(fixture.onNewProjectFromPptx).toHaveBeenCalledWith({ name: '第一课.pptx', bytes })
  expect(fixture.completed.mock.calls[0][0].project.surfaces).toHaveLength(1)
  expect(fixture.completed.mock.calls[0][0].project.surfaces[0].kind).toBe('slide')
  expect(fixture.onNewProject).not.toHaveBeenCalled()
  fireEvent.click(screen.getByLabelText('导入'))
  fireEvent.click(screen.getByRole('menuitem', { name: /Word、MD、TXT/ }))
  expect(fixture.flow).toHaveBeenCalledExactlyOnceWith()
  fireEvent.click(screen.getByLabelText('导入'))
  fireEvent.click(screen.getByRole('menuitem', { name: /HTML 页面/ }))
  expect(fixture.html).toHaveBeenCalledExactlyOnceWith()
})

it('content import retains the existing PPT loss confirmation and cancelling makes no course', async () => {
  const fixture = contentImports(), bytes = pptxImportFixture({ unsupported: true })
  fixture.choosePptx(bytes, '带损失.pptx')
  const dialog = await screen.findByRole('alertdialog', { name: '确认 PPT 转换结果' })
  expect((within(dialog).getByLabelText('完整 PPT 转换损失详情') as HTMLTextAreaElement).value).toContain('第 1 页')
  fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '确认 PPT 转换结果' })).toBeNull())
  expect(fixture.completed).not.toHaveBeenCalled()
  fixture.choosePptx(bytes, '带损失.pptx')
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: '确认 PPT 转换结果' })).getByRole('button', { name: '确认并新建' }))
  await waitFor(() => expect(fixture.completed).toHaveBeenCalledOnce())
})

it('main still writes only a valid native course archive and reads actual PPTX bytes', async () => {
  const { directory, service, root } = await workspace()
  const deck = pptxImportFixture()
  await fs.writeFile(path.join(directory, 'deck.pptx'), deck)
  await fs.writeFile(path.join(directory, 'notes.txt'), 'x')
  const listed = await service.operate({ type: 'list', workspaceId: root.workspaceId, directoryEntryId: root.rootEntryId })
  const entry = (name: string) => listed.entries.find((item): item is Extract<WorkspaceListItem, { status: 'accessible' }> => item.status === 'accessible' && item.name === name)!
  const scope = (value: RegisteredWorkspaceRoot) => ({ workspaceId: value.workspaceId })
  await expect(service.operate({ type: 'create-course', operationId: 'not-a-course', ...scope(root), targetDirectoryId: root.rootEntryId,
    name: 'bad.glx', archive: new Uint8Array([1, 2, 3]) })).rejects.toThrow('此入口只支持 Project V10 归档，原文件未修改。')
  await expect(fs.stat(path.join(directory, 'bad.glx'))).rejects.toThrow()
  await expect(service.operate({ type: 'read-pptx', ...scope(root), entryId: entry('notes.txt').entryId })).rejects.toThrow('只能把 .pptx 文件导入为 果铃工程')
  const read = await service.operate({ type: 'read-pptx', ...scope(root), entryId: entry('deck.pptx').entryId })
  expect(read.name).toBe('deck.pptx')
  expect(read.bytes).toEqual(deck)
})
