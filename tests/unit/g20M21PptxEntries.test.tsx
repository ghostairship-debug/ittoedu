import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import { LessonDirectoryTree } from '../../src/renderer/lessonWorkspace/view/LessonDirectoryTree'
import { LessonWorkspaceShell } from '../../src/renderer/lessonWorkspace/LessonWorkspaceShell'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import type { LessonDesktopRequest } from '../../src/shared/lessonDesktopContract'
import type { RegisteredWorkspaceRoot, WorkspaceListItem } from '../../src/shared/workbench/workspaceFiles'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'
import { pptxImportFixture } from '../fixtures/pptxImport'
import { createCourseFromPptx, type PptxCourse } from '../../src/renderer/project/pptxCourseCreation'
import { confirmPptxLosses } from '../../src/renderer/project/confirmPptxLosses'
import { plainDocumentText } from '../../src/shared/document/content'
import { textComponentDataSchema } from '../../src/components/text/data'
import { shapeDataSchema } from '../../src/components/shape/data'

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
const roots: string[] = []
const services: WorkspaceFilesDesktopService[] = []
afterEach(async () => {
  cleanup(); localStorage.clear(); vi.unstubAllGlobals()
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('g20-m21-pptx-'))
      throw new Error('Invalid temp root')
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

function contentImports(prepared?: Promise<void>) {
  const operation = vi.fn(async (request: LessonDesktopRequest) => {
    switch (request.operation) {
      case 'recent-workspaces': return { recent: [] }
      case 'list-lessons': return { lessons: [] }
      case 'list-projects': return { projects: [] }
      case 'choose-workspace': return { directory: '/workspace/later' }
      case 'list-directory': return { entries: [] }
      default: throw new Error(`Unexpected ${request.operation}`)
    }
  })
  const port: RecoverableDocumentFilePort = { openDocument: async () => { throw new Error('ENOENT') }, watchDocument: () => () => {}, saveDocument: vi.fn() }
  const onNewProject = vi.fn(async () => true), completed = vi.fn<(course: PptxCourse) => void>(), flow = vi.fn(), html = vi.fn()
  const onNewProjectFromPptx = vi.fn(async ({ name, bytes }: { name: string; bytes: Uint8Array }, _signal?: AbortSignal, _foreground?: () => boolean) => {
    const course = await createCourseFromPptx(bytes, name.replace(/\.pptx$/i, ''))
    await prepared
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
  return { operation, onNewProject, onNewProjectFromPptx, completed, flow, html, choosePptx }
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
  expect(fixture.onNewProjectFromPptx).toHaveBeenCalledExactlyOnceWith({ name: '第一课.pptx', bytes }, expect.any(AbortSignal), expect.any(Function))
  const [, signal, foreground] = fixture.onNewProjectFromPptx.mock.calls[0]!
  expect(signal?.aborted).toBe(false)
  expect(foreground?.()).toBe(true)
  const project = fixture.completed.mock.calls[0][0].project
  expect(project.rootIds).toHaveLength(1)
  const slide = project.instances[project.rootIds[0]!]!
  expect(slide).toMatchObject({ name: '导入演示', container: { kind: 'slide', designSize: { width: 1280, height: 720 } } })
  expect(slide.childIds).toHaveLength(2)
  const children = slide.childIds!.map(id => project.instances[id]!)
  expect(children.map(instance => instance.name)).toEqual(['课题 文字', '基础图形'])
  expect(plainDocumentText(textComponentDataSchema.parse(children[0]!.data).content)).toBe('知识 😀')
  expect(shapeDataSchema.parse(children[1]!.data).shapeType).toBe('ellipse')
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

it('cancels a pending content import and ignores its late success after later workspace navigation', async () => {
  let release!: () => void
  const prepared = new Promise<void>(resolve => { release = resolve })
  const fixture = contentImports(prepared)
  fixture.choosePptx(pptxImportFixture())
  await waitFor(() => expect(fixture.onNewProjectFromPptx).toHaveBeenCalledOnce())
  const [, signal, foreground] = fixture.onNewProjectFromPptx.mock.calls[0]!
  expect(signal?.aborted).toBe(false)
  expect(foreground?.()).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '取消导入' }))
  expect(signal?.aborted).toBe(true)
  fireEvent.click(screen.getByLabelText('切换工作空间'))
  fireEvent.click(screen.getByRole('button', { name: '选择其他工作空间文件夹…' }))
  await waitFor(() => expect(screen.getByLabelText('切换工作空间')).toHaveAttribute('title', '/workspace/later'))
  const resources = within(screen.getByRole('tablist', { name: '工作台区域' })).getByRole('tab', { name: '资源管理器与会话列表' })
  fireEvent.click(resources)
  expect(resources).toHaveAttribute('aria-selected', 'true')
  expect(foreground?.()).toBe(false)
  // Deliberately deliver success despite cancellation. The real controller must
  // retain later navigation rather than relying on a guard in this callback.
  await act(async () => { release(); expect(await fixture.onNewProjectFromPptx.mock.results[0]!.value).toBe(true) })
  expect(fixture.completed).toHaveBeenCalledOnce()
  expect(fixture.onNewProject).not.toHaveBeenCalled()
  expect(screen.getByLabelText('切换工作空间')).toHaveAttribute('title', '/workspace/later')
  expect(resources).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('region', { name: '没有打开的文件' })).toBeInTheDocument()
  expect(screen.queryByText('正在导入 PPT…')).toBeNull()
  expect(document.querySelector('.lesson-workspace-error')).toBeNull()
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
