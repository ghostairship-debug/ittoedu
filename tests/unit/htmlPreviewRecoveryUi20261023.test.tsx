import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { HtmlDocumentEditor, type HtmlDocumentEditorHandle } from '../../src/renderer/documentFiles/html/HtmlDocumentEditor'
import { CanvasPlainTextEditor } from '../../src/renderer/ui/CanvasPlainTextEditor'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import { EditorView } from '@codemirror/view'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const source = '<p>old</p>'
const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 1, model: { kind: 'text', source, resources: { assets: {}, components: {} } },
  binding: { kind: 'file', path: '/lesson.html', version: 'v1', bindingVersion: 1 }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
async function preview(initialSource = source) {
  const workspaceFiles = vi.fn(async (request: { type: string; revision?: number; targets?: Array<{ handle: string }> }) => {
    if (request.type === 'html-preview.open') return { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1,
      loadId: 'load', url: `courseware-preview://${'a'.repeat(32)}.${'a'.repeat(32)}.app/${'a'.repeat(64)}/file/page.html` }
    if (request.type === 'html-preview.resolve-target') return { revision: 1, targets: request.targets!.map(target => ({ handle: target.handle, status: 'editable', locator: {
      documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1, targetKind: 'text', elementSpan: { start: 0, end: source.length },
      valueSpan: { start: 3, end: 6 }, expectedRaw: 'old', attributeName: null,
    } })) }
    if (request.type === 'html-preview.edit') return { status: 'rejected', reason: 'stale-revision' }
    return { released: true }
  })
  const documents = { readAuthoringDrafts: vi.fn(async () => null), writeAuthoringDrafts: vi.fn(async () => {}) }
  Object.defineProperty(window, 'desktopAPI', { configurable: true, value: { workspaceFiles, documents } })
  const ref = createRef<HtmlDocumentEditorHandle>()
  const props = { ref, tabId: 'tab', committed: { ...snapshot, model: { kind: 'text' as const, source: initialSource, resources: { assets: {}, components: {} } } },
    source: initialSource, onDraft: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() }
  const mounted = render(<HtmlDocumentEditor {...props} />)
  const iframe = await screen.findByTitle('HTML 预览') as HTMLIFrameElement
  Object.defineProperty(iframe, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(iframe, 'offsetHeight', { configurable: true, value: 600 })
  vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON() {} })
  const messages = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  let sequence = 0
  const send = (message: { event: string; [key: string]: unknown }) => act(() => { window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow,
    data: { protocol: 1, leaseId: 'lease', loadId: 'load', ...(message.event === 'ready' ? {} : { seq: ++sequence }), ...message } })) })
  const request = () => messages.mock.calls.map(([message]) => message as { type?: string; requestId?: string; enabled?: boolean }).filter(message => message.type === 'html-preview.edit-mode').at(-1)!
  const acknowledge = () => { const value = request(); send({ event: 'edit-mode-ready', requestId: value.requestId, enabled: value.enabled }) }
  send({ event: 'ready', sectionCount: 0, sectionsAmbiguous: false }); acknowledge()
  return { ref, iframe, send, request, acknowledge, documents, workspaceFiles, mounted, props, messages }
}

it('finishes editing after a rejected field while retaining its input, and keeps business interaction blocked until the mode ACK', async () => {
  const view = await preview()
  expect(screen.getByRole('button', { name: '编辑' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  await waitFor(() => expect(view.request().enabled).toBe(true)); view.acknowledge()
  view.send({ event: 'targets', targets: [{ handle: 'field', kind: 'text', domPath: [], sectionOrder: null,
    rawText: 'old', attributeName: null, rect: { x: 20, y: 20, width: 80, height: 20 }, scriptCreated: false,
    selection: { anchor: 1, focus: 1 }, textStyle: { 'font-family': 'Georgia', 'white-space': 'normal' } }] })
  const input = await screen.findByRole('textbox', { name: '编辑此处文字' })
  expect(input.style.fontFamily).toBe('Georgia'); expect(input.style.whiteSpace).toBe('normal')
  input.textContent = 'retained input'; fireEvent.input(input)
  fireEvent.click(screen.getByRole('button', { name: '完成编辑' }))
  await waitFor(() => expect(view.request().enabled).toBe(false))
  expect(view.iframe.style.pointerEvents).toBe('none')
  view.acknowledge()
  expect(screen.queryByRole('textbox', { name: '编辑此处文字' })).toBeNull()
  expect(screen.getByRole('button', { name: '编辑' })).toBeEnabled()
  expect(screen.getByRole('textbox', { name: /保留的 HTML 文字草稿/ })).toHaveValue('retained input')
  await act(async () => { await view.ref.current!.prepare() })
  expect(view.documents.writeAuthoringDrafts).toHaveBeenCalled()
})

it('ends mode failure waiting and leaves the source editor available without faking an edit-mode ACK', async () => {
  const view = await preview()
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  await waitFor(() => expect(view.request().enabled).toBe(true))
  view.send({ event: 'edit-mode-error', requestId: view.request().requestId, enabled: true, message: '此预览没有完成编辑准备，可重新连接。' })
  expect(screen.queryByText('正在准备编辑模式…')).toBeNull()
  expect(screen.getByRole('button', { name: '重新连接预览' })).toBeEnabled()
  expect(view.iframe.style.pointerEvents).toBe('none')
  fireEvent.click(screen.getByRole('button', { name: '源码' }))
  expect(screen.getByRole('textbox', { name: '纯文本编辑' })).toBeTruthy()
})

it('commits the final IME input only once when blur requested completion before compositionend', () => {
  const commit = vi.fn()
  render(<CanvasPlainTextEditor presentation="inline" bounds={{ x: 0, y: 0, width: 120, height: 30 }} label="正文" value="原文"
    onDraftChange={vi.fn()} onCommit={commit} onCancel={vi.fn()} />)
  const input = screen.getByRole('textbox', { name: '正文' })
  fireEvent.compositionStart(input); input.textContent = '中文'; fireEvent.input(input)
  fireEvent.blur(input); expect(commit).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input); fireEvent.blur(input)
  expect(commit).toHaveBeenCalledExactlyOnceWith('中文')
})

it('patches an exact selected text change despite an unrelated malformed tail, without reloading the preview', async () => {
  const original = '<p>old</p><!--unfinished', view = await preview(original)
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  await waitFor(() => expect(view.request().enabled).toBe(true)); view.acknowledge()
  view.send({ event: 'targets', targets: [{ handle: 'field', kind: 'text', domPath: [], sectionOrder: null,
    rawText: 'old', attributeName: null, rect: { x: 20, y: 20, width: 80, height: 20 }, scriptCreated: false }] })
  await screen.findByRole('textbox', { name: '编辑此处文字' })
  const changed = original.replace('old', 'new')
  view.mounted.rerender(<HtmlDocumentEditor {...view.props} source={changed} committed={{ ...view.props.committed, revision: 2,
    model: { ...view.props.committed.model, source: changed } }} />)
  await waitFor(() => expect(view.messages.mock.calls.map(([message]) => message)).toContainEqual(expect.objectContaining({
    type: 'html-preview.patch', handle: 'field', value: 'new', expected: 'old',
  })))
  expect(view.workspaceFiles.mock.calls.filter(([request]) => request.type === 'html-preview.open')).toHaveLength(1)
})

it('prepares source typed during the recovery ACK instead of returning the captured old source', async () => {
  const view = await preview()
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  await waitFor(() => expect(view.request().enabled).toBe(true)); view.acknowledge()
  view.send({ event: 'targets', targets: [{ handle: 'field', kind: 'text', domPath: [], sectionOrder: null,
    rawText: 'old', attributeName: null, rect: { x: 20, y: 20, width: 80, height: 20 }, scriptCreated: false }] })
  const input = await screen.findByRole('textbox', { name: '编辑此处文字' })
  input.textContent = 'unapplied field'; fireEvent.input(input)
  fireEvent.click(screen.getByRole('button', { name: '源码' }))
  const code = EditorView.findFromDOM(screen.getByRole('textbox', { name: '纯文本编辑' }))!
  let release!: () => void
  view.documents.writeAuthoringDrafts.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  let preparing!: ReturnType<HtmlDocumentEditorHandle['prepare']>
  act(() => { preparing = view.ref.current!.prepare() })
  await waitFor(() => expect(view.documents.writeAuthoringDrafts).toHaveBeenCalledOnce())
  const latest = '<p>new source typing</p>'
  act(() => { code.dispatch({ changes: { from: 0, to: code.state.doc.length, insert: latest } }) })
  let prepared!: Awaited<typeof preparing>
  await act(async () => { release(); prepared = await preparing })
  expect(prepared).toMatchObject({ ready: true, source: latest })
  expect(code.state.doc.toString()).toBe(latest)
  expect(screen.getByRole('textbox', { name: /保留的 HTML 文字草稿/ })).toHaveValue('unapplied field')
})

it.each([
  { label: 'a left-aligned full-width paragraph', x: 0, width: 800 },
  { label: 'a split heading run beside other text', x: 260, width: 240 },
])('keeps the move action in the existing toolbar for $label without overlaying the document', async ({ x, width }) => {
  const view = await preview()
  fireEvent.click(screen.getByRole('button', { name: '编辑' }))
  await waitFor(() => expect(view.request().enabled).toBe(true)); view.acknowledge()
  const record = { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], textIndex: 0, baseline: 'old' }, overrides: {} }
  view.send({ event: 'targets', targets: [{ handle: 'full-width', kind: 'text', domPath: [], sectionOrder: null,
    rawText: 'old', attributeName: null, rect: { x, y: 20, width, height: 60 }, scriptCreated: false,
    authoring: { authorKey: 'wide-paragraph', record }, geometry: { frame: { width, height: 60, transform: [1, 0, 0, 1, x, 20] },
      parentToInstance: [1, 0, 0, 1, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } } }] })
  const control = await screen.findByRole('button', { name: '移动 HTML 内部对象' })
  expect(screen.getByRole('toolbar', { name: 'HTML 分页' })).toContainElement(control)
  expect(control).toBeEnabled()
  expect(control.style.position).not.toBe('absolute')
  expect(document.querySelector('.html-preview-pane__body')).not.toContainElement(control)
  expect(screen.getByRole('textbox', { name: '编辑此处文字' }).textContent).toBe('old')
})
