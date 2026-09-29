// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { saveDocumentWithDialog } from '../../src/main/workbench/documentSaveDialog'
import { explorerContextCommands, explorerNewCommands, type ExplorerCommandPorts } from '../../src/renderer/lessonWorkspace/view/explorerCommands'
import { HtmlDocumentEditor } from '../../src/renderer/documentFiles/html/HtmlDocumentEditor'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest } from '../../src/shared/workbench/workspaceFiles'

const native = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, dialog: { showSaveDialog: native.showSaveDialog } }))

it('starts HTML in an isolated preview and keeps its iframe when switching to source', async () => {
  const workspaceFiles = vi.fn(async (request: { type: string }) => request.type === 'html-preview.open'
    ? { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1, loadId: 'load', url: `courseware-preview://${'a'.repeat(32)}.${'a'.repeat(32)}.app/${'a'.repeat(64)}/file/page.html` }
    : { released: true })
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles } })
  const committed = { documentId: 'doc', epoch: 'epoch', revision: 1, model: { kind: 'text', source: '<p>hello</p>', resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson/page.html', version: 'v1', bindingVersion: 1 } } as DocumentSnapshot
  const mounted = render(createElement(HtmlDocumentEditor, { tabId: 'tab', committed, source: '<p>hello</p>', onDraft: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() }))
  const frame = await screen.findByTitle('HTML 预览')
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  expect(frame.getAttribute('src')).toBe(`courseware-preview://${'a'.repeat(32)}.${'a'.repeat(32)}.app/${'a'.repeat(64)}/file/page.html`)
  expect((frame.closest('.html-document-editor__preview') as HTMLElement | null)?.hidden).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '源码' }))
  expect((frame.closest('.html-document-editor__preview') as HTMLElement | null)?.hidden).toBe(true)
  expect(screen.getByRole('textbox', { name: '纯文本编辑' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '预览' }))
  expect(screen.getByTitle('HTML 预览')).toBe(frame)
  mounted.unmount(); cleanup()
})

it('opens an HTML file in the workbench on double click and keeps browser open explicit', async () => {
  const onFile = vi.fn(), operation = vi.fn().mockResolvedValue({ opened: true })
  const files = vi.fn(async (request: WorkspaceFilesRequest) => {
    if (request.type === 'root') return { workspaceId: 'space', rootEntryId: 'root', resolvedPath: '/lesson' }
    if (request.type === 'watch') return { workspaceId: 'space', watching: true }
    if (request.type === 'list') return { entries: [{ status: 'accessible', entryId: 'html', name: 'page.htm', kind: 'file' }] }
    if (request.type === 'resolve') return { workspaceId: 'space', entryId: request.entryId, kind: 'file', resolvedPath: '/lesson/page.htm' }
    throw new Error(`unexpected ${request.type}`)
  }) as unknown as WorkspaceFilesAPI
  render(createElement(WorkspaceFilesTree, { directory: '/lesson', files, operation, onFile, onDirectory: vi.fn() }))
  const row = await screen.findByRole('button', { name: 'page.htm' })
  fireEvent.doubleClick(row)
  await waitFor(() => expect(onFile).toHaveBeenCalledWith({ name: 'page.htm', kind: 'file', path: '/lesson/page.htm' }))
  expect(operation).not.toHaveBeenCalled()
  fireEvent.contextMenu(row)
  fireEvent.click(within(screen.getByRole('menu', { name: '文件菜单' })).getByRole('menuitem', { name: '用浏览器打开' }))
  await waitFor(() => expect(operation).toHaveBeenCalledWith({ operation: 'open-external', path: '/lesson/page.htm' }))
  cleanup()
})

it('creates an HTML file through the existing file service request and opens its tab', async () => {
  const onFile = vi.fn()
  const requests: WorkspaceFilesRequest[] = []
  const files = (async (request: WorkspaceFilesRequest) => {
    requests.push(request)
    if (request.type === 'root') return { workspaceId: 'space', rootEntryId: 'root', resolvedPath: '/lesson' }
    if (request.type === 'watch') return { workspaceId: 'space', watching: true }
    if (request.type === 'list') return { entries: [] }
    if (request.type === 'create-text') return { status: 'success', items: [{ status: 'success', targetPath: `/lesson/${request.name}` }] }
    throw new Error(`unexpected ${request.type}`)
  }) as WorkspaceFilesAPI
  render(createElement(WorkspaceFilesTree, { directory: '/lesson', files, onFile, onDirectory: vi.fn() }))
  await screen.findByRole('tree', { name: '工作空间文件' })
  fireEvent.click(screen.getByRole('menuitem', { name: '新建 HTML 文档' }))
  const name = await screen.findByRole('textbox', { name: '文件名称' })
  expect((name as HTMLInputElement).value).toBe('新建 HTML 文档.html')
  fireEvent.click(screen.getByRole('button', { name: '确认' }))
  await waitFor(() => expect(requests).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'create-text', name: '新建 HTML 文档.html' })])))
  await waitFor(() => expect(onFile).toHaveBeenCalledWith({ name: '新建 HTML 文档.html', kind: 'file', path: '/lesson/新建 HTML 文档.html' }))
  cleanup()
})

it('offers HTML creation and browser opening without replacing the import action', () => {
  const ports: ExplorerCommandPorts = { create: vi.fn(), newFromPptx: vi.fn(), importPptx: vi.fn(), importHtml: vi.fn(), openHtmlExternal: vi.fn(),
    rename: vi.fn(), copy: vi.fn(), cut: vi.fn(), paste: vi.fn(), copyTo: vi.fn(), moveTo: vi.fn(), trash: vi.fn(), copyPath: vi.fn(), reveal: vi.fn() }
  explorerNewCommands(null, ports).find(item => item.id === 'file.new-html')?.run()
  expect(ports.create).toHaveBeenCalledWith('create-html')
  const commands = explorerContextCommands({ blocked: null, selected: 1, pptx: false, htmlImport: 'selected', htmlFile: true, clipboard: 0 }, ports)
  commands.find(item => item.id === 'file.open-html-browser')?.run()
  commands.find(item => item.id === 'file.import-html')?.run()
  expect(ports.openHtmlExternal).toHaveBeenCalledOnce()
  expect(ports.importHtml).toHaveBeenCalledOnce()
  expect(explorerContextCommands({ blocked: null, selected: 1, pptx: false, htmlImport: null, htmlFile: false, clipboard: 0 }, ports).some(item => item.id === 'file.open-html-browser')).toBe(false)
})

it.each(['page.html', 'page.htm', 'notes.txt'])('Save As keeps the current text extension for %s', async name => {
  const filename = `/lesson/${name}`
  const snapshot = { model: { kind: 'text', source: '', resources: { assets: {}, components: {} } }, binding: { kind: 'file', path: filename, version: 'v1', bindingVersion: 1 } } as DocumentSnapshot
  const saveToPath = vi.fn().mockResolvedValue(snapshot)
  const documents = { registry: { get: () => ({ drain: async () => snapshot }) }, saveToPath } as unknown as DocumentHostService
  native.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: filename })
  await saveDocumentWithDialog({} as BrowserWindow, documents, 'doc', true)
  const options = native.showSaveDialog.mock.lastCall?.[1]
  expect(options.defaultPath).toBe(filename)
  expect(options.filters[0].extensions).toEqual([name.split('.').pop()])
  expect(saveToPath).toHaveBeenCalledWith('doc', filename, true)
})
