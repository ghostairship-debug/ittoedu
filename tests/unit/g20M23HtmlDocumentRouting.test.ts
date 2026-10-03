// @vitest-environment jsdom
import { createElement, createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { saveDocumentWithDialog } from '../../src/main/workbench/documentSaveDialog'
import { explorerContextCommands, explorerNewCommands, type ExplorerCommandPorts } from '../../src/renderer/lessonWorkspace/view/explorerCommands'
import { HtmlDocumentEditor } from '../../src/renderer/documentFiles/html/HtmlDocumentEditor'
import type { PlainTextDocumentEditorHandle } from '../../src/renderer/documentFiles/PlainTextDocumentEditor'
import { WorkspaceFilesTree } from '../../src/renderer/lessonWorkspace/view/WorkspaceFilesTree'
import type { WorkspaceFilesAPI, WorkspaceFilesRequest } from '../../src/shared/workbench/workspaceFiles'

const native = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, dialog: { showSaveDialog: native.showSaveDialog } }))
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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

it('reloads a changed HTML source with a fresh lease while keeping the view and releasing the latest lease on close', async () => {
  let revision = 1, opens = 0
  const workspaceFiles = vi.fn(async (request: { type: string; leaseId?: string }) => {
    if (request.type !== 'html-preview.open') return { released: true }
    opens++
    return { leaseId: `lease-${opens}`, documentId: 'doc', epoch: 'epoch', revision, bindingVersion: 1,
      loadId: `load-${opens}`, url: `courseware-preview://generation-${opens}.app/page.html` }
  })
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles } })
  const snapshot = (source: string) => ({ documentId: 'doc', epoch: 'epoch', revision,
    model: { kind: 'text', source, resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson/page.html', version: 'v1', bindingVersion: 1 } }) as DocumentSnapshot
  const props = { tabId: 'tab', committed: snapshot('<p>first</p>'), source: '<p>first</p>',
    onDraft: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() }
  const mounted = render(createElement(HtmlDocumentEditor, props))
  const frame = await screen.findByTitle('HTML 预览')
  await waitFor(() => expect(frame.getAttribute('src')).toBe('courseware-preview://generation-1.app/page.html'))
  revision = 2
  mounted.rerender(createElement(HtmlDocumentEditor, { ...props, committed: snapshot('<p>second</p>'), source: '<p>second</p>' }))
  await waitFor(() => expect(frame.getAttribute('src')).toBe('courseware-preview://generation-2.app/page.html'))
  expect(screen.getByTitle('HTML 预览')).toBe(frame)
  expect(opens).toBe(2)
  mounted.unmount()
  await waitFor(() => expect(workspaceFiles).toHaveBeenCalledWith({ type: 'html-preview.release', leaseId: 'lease-2', tabId: 'tab' }))
})

it('retains light-edit input through hiding, source view and reload, including typing between optimistic save and ACK', async () => {
  const original = '<p>old</p>'
  const snapshot = (source: string, revision = 1) => ({ documentId: 'doc', epoch: 'epoch', revision,
    model: { kind: 'text', source, resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson/page.html', version: 'v1', bindingVersion: 1 } }) as DocumentSnapshot
  const lease = { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1,
    loadId: 'load', url: `courseware-preview://${'a'.repeat(32)}.${'a'.repeat(32)}.app/${'a'.repeat(64)}/file/page.html` }
  const workspaceFiles = vi.fn(async (request: { type: string; revision?: number; targets?: Array<{ handle: string }> }) => {
    if (request.type === 'html-preview.open') return lease
    if (request.type === 'html-preview.resolve-target') return { revision: request.revision, targets: [{
      handle: request.targets![0].handle, status: 'editable', locator: { documentId: 'doc', epoch: 'epoch',
        revision: request.revision, bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: 10 },
        valueSpan: { start: 3, end: 6 }, expectedRaw: 'old', attributeName: null } }] }
    return { released: true }
  })
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles } })
  const ref = createRef<PlainTextDocumentEditorHandle>()
  const props = { ref, active: true, tabId: 'tab', committed: snapshot(original), source: original,
    onDraft: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onPendingDraftChange: vi.fn() }
  const mounted = render(createElement(HtmlDocumentEditor, props))
  const frame = await screen.findByTitle('HTML 预览') as HTMLIFrameElement
  let seq = 0
  const send = (message: { event: string; [key: string]: unknown }) => act(() => {
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
      data: { protocol: 1, leaseId: 'lease', loadId: 'load', ...(message.event === 'ready' ? {} : { seq: ++seq }), ...message } }))
  })
  const select = (handle: string) => send({ event: 'targets', targets: [{ handle, kind: 'text',
    domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
    sectionOrder: null, rawText: 'old', attributeName: null, rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false }] })
  select('first-frame')
  let input = await screen.findByRole('textbox', { name: 'HTML 文字' }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'new < & >' } })
  await waitFor(() => expect(props.onPendingDraftChange).toHaveBeenLastCalledWith(true))
  mounted.rerender(createElement(HtmlDocumentEditor, { ...props, active: false }))
  mounted.rerender(createElement(HtmlDocumentEditor, props))
  expect((screen.getByRole('textbox', { name: 'HTML 文字' }) as HTMLTextAreaElement).value).toBe('new < & >')
  fireEvent.click(screen.getByRole('button', { name: '源码' }))
  fireEvent.click(screen.getByRole('button', { name: '预览' }))
  expect((screen.getByRole('textbox', { name: 'HTML 文字' }) as HTMLTextAreaElement).value).toBe('new < & >')
  fireEvent.click(screen.getByRole('button', { name: '重新加载预览' }))
  expect(screen.queryByRole('textbox', { name: 'HTML 文字' })).toBeNull()
  fireEvent.load(frame)
  send({ event: 'ready', sectionCount: 0, sectionsAmbiguous: false })
  select('replacement-frame')
  input = await screen.findByRole('textbox', { name: 'HTML 文字' }) as HTMLTextAreaElement
  expect(input.value).toBe('new < & >')
  expect(props.onDraft).not.toHaveBeenCalled()
  expect(workspaceFiles.mock.calls.some(([request]) => request.type === 'html-preview.edit')).toBe(false)
  fireEvent.compositionStart(input)
  expect(ref.current!.flush().ready).toBe(false)
  fireEvent.compositionEnd(input)
  let flushed!: ReturnType<PlainTextDocumentEditorHandle['flush']>
  act(() => { flushed = ref.current!.flush() })
  expect(flushed).toEqual({ ready: true, source: '<p>new &lt; &amp; &gt;</p>' })
  expect(props.onPendingDraftChange).toHaveBeenLastCalledWith(true)
  // session.edit publishes source before the canonical snapshot/ACK has changed.
  mounted.rerender(createElement(HtmlDocumentEditor, { ...props, source: flushed.source }))
  expect(props.onPendingDraftChange).toHaveBeenLastCalledWith(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'HTML 文字' }), { target: { value: 'typed after save' } })
  let newer!: ReturnType<PlainTextDocumentEditorHandle['flush']>
  act(() => { newer = ref.current!.flush() })
  expect(newer).toEqual({ ready: true, source: '<p>typed after save</p>' })
  mounted.rerender(createElement(HtmlDocumentEditor, { ...props, source: newer.source, committed: snapshot(flushed.source, 2) }))
  expect(screen.queryByText(/原文字已变化，草稿仍保留/)).toBeNull()
  expect(props.onPendingDraftChange).toHaveBeenLastCalledWith(true)
  act(() => { expect(ref.current!.flush()).toEqual(newer) })
  mounted.rerender(createElement(HtmlDocumentEditor, { ...props, source: newer.source, committed: snapshot(newer.source, 3) }))
  await waitFor(() => expect(props.onPendingDraftChange).toHaveBeenLastCalledWith(false))
  mounted.unmount(); cleanup()
})

it('keeps a conflicting draft accessible when its source text changes and blocks flush until it is handled', async () => {
  const workspaceFiles = vi.fn(async (request: { type: string }) => request.type === 'html-preview.open'
    ? { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1, loadId: 'load', url: 'courseware-preview://app/file/page.html' }
    : { revision: 1, targets: [{ handle: 'text', status: 'editable', locator: { documentId: 'doc', epoch: 'epoch', revision: 1,
      bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: 10 }, valueSpan: { start: 3, end: 6 }, expectedRaw: 'old', attributeName: null } }] })
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles } })
  const committed = { documentId: 'doc', epoch: 'epoch', revision: 1, model: { kind: 'text', source: '<p>old</p>', resources: { assets: {}, components: {} } },
    binding: { kind: 'file', path: '/lesson/page.html', version: 'v1', bindingVersion: 1 } } as DocumentSnapshot
  const ref = createRef<PlainTextDocumentEditorHandle>()
  const props = { ref, tabId: 'tab', committed, source: '<p>old</p>', onDraft: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() }
  const mounted = render(createElement(HtmlDocumentEditor, props))
  const frame = await screen.findByTitle('HTML 预览') as HTMLIFrameElement
  act(() => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { protocol: 1, leaseId: 'lease', loadId: 'load', seq: 1,
    event: 'targets', targets: [{ handle: 'text', kind: 'text', domPath: [{ name: 'p', index: 0 }], sectionOrder: null, rawText: 'old',
      attributeName: null, rect: { x: 0, y: 0, width: 40, height: 20 }, scriptCreated: false }] } })) })
  fireEvent.change(await screen.findByRole('textbox', { name: 'HTML 文字' }), { target: { value: 'my draft' } })
  const changed = '<p>external</p>'
  mounted.rerender(createElement(HtmlDocumentEditor, { ...props, source: changed,
    committed: { ...committed, revision: 2, model: { ...committed.model, source: changed } } as DocumentSnapshot }))
  expect(await screen.findByText(/原文字已变化，草稿仍保留/)).toBeTruthy()
  expect((screen.getByRole('textbox', { name: '保留的 HTML 文字草稿：old' }) as HTMLTextAreaElement).value).toBe('my draft')
  expect(ref.current!.flush()).toEqual({ ready: false, source: changed })
  fireEvent.click(screen.getByRole('button', { name: '放弃这份草稿' }))
  expect(ref.current!.flush()).toEqual({ ready: true, source: changed })
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
