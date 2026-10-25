import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import { HtmlPreviewPane } from '../../src/renderer/documentFiles/html/HtmlPreviewPane'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([false, true])('keeps a paste before the cut receipt on the same HTML field, or retires it when Escape cleared that owner (%s)', async escape => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const source = '<html><body><p id="title">Old</p></body></html>', driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'clipboard', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: 'keys.html', version: null, bindingVersion: 1 } }, driver,
  { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const lease = { leaseId: 'lease', loadId: 'load', documentId: session.documentId, epoch: 'epoch', revision: 0, bindingVersion: 1, url: 'about:blank' }
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  let release!: () => void, cutWaiting = false
  const cutReceipt = new Promise<void>(resolve => { release = resolve })
  const edits: string[] = []
  vi.stubGlobal('desktopAPI', { workspaceFiles: async (request: Parameters<typeof service.edit>[0] | Parameters<typeof service.resolveTarget>[0]) => {
    const context = { lease, tabId: 'tab', snapshot: session.read(), entryRealPath: 'keys.html', rootRealPath: '.', bindingPath: 'keys.html' }
    if (request.type === 'html-preview.resolve-target') return service.resolveTarget(request, context)
    edits.push(request.change.kind === 'text' ? request.change.value : request.change.kind)
    const response = await service.edit(request, context)
    if (request.change.kind === 'text' && request.change.value === '') { cutWaiting = true; await cutReceipt }
    return response
  } })
  const ui = render(<HtmlPreviewPane lease={lease} committed={session.read()} tabId="tab" textDrafts={new HtmlTextDrafts()} onUndo={() => {}} onRedo={() => {}} />)
  const frame = ui.getByTitle('HTML 预览') as HTMLIFrameElement
  Object.defineProperties(frame, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } })
  frame.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
  let seq = 0
  const receive = (value: { event: string; [key: string]: unknown }) => act(async () => { window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { protocol: 1, leaseId: 'lease', loadId: 'load', ...(value.event === 'ready' ? {} : { seq: ++seq }), ...value } })) })
  await receive({ event: 'ready', sectionCount: 0, sectionsAmbiguous: false })
  const mode = () => posted.mock.calls.map(call => call[0]).filter(value => value.type === 'html-preview.edit-mode').at(-1)!
  await receive({ event: 'edit-mode-ready', requestId: mode().requestId, enabled: false })
  fireEvent.click(ui.getByRole('button', { name: '编辑' }))
  await receive({ event: 'edit-mode-ready', requestId: mode().requestId, enabled: true })
  await receive({ event: 'targets', intent: 'select', targets: [{ handle: 'title', kind: 'text', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
    sectionOrder: null, rawText: 'Old', attributeName: null, rect: { x: 20, y: 20, width: 80, height: 30 }, scriptCreated: false, bindingStatus: 'bound',
    authoring: { authorKey: 'title', record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'title' } }], textIndex: 0, baseline: 'Old' }, overrides: {} } } }] })
  const pane = ui.container.querySelector('.html-preview-pane')!
  const previousText = document.createElement('p'); previousText.textContent = 'Previous unrelated selection'; document.body.append(previousText)
  const previousRange = document.createRange(); previousRange.selectNodeContents(previousText)
  document.getSelection()?.removeAllRanges(); document.getSelection()?.addRange(previousRange)
  const data = { setData: vi.fn(), getData: () => 'Next' }
  try {
    fireEvent.cut(pane, { clipboardData: { setData() { throw new Error('Clipboard unavailable') } } })
    expect(session.read().undoDepth).toBe(0)
    expect(edits).toEqual([])
    fireEvent.cut(pane, { clipboardData: data })
    await waitFor(() => expect(cutWaiting).toBe(true))
    expect(session.read().undoDepth).toBe(1)
    fireEvent.paste(pane, { clipboardData: data })
    if (escape) fireEvent.keyDown(pane, { key: 'Escape' })
    await act(async () => { release() })
    await waitFor(() => expect(session.read().undoDepth).toBe(escape ? 1 : 2))
    expect(edits).toEqual(escape ? [''] : ['', 'Next'])
    if (escape) {
      expect(ui.queryByLabelText('HTML 对象选框')).toBeNull()
      expect(ui.getByRole('button', { name: '完成编辑' })).toBeEnabled()
    }
  } finally { release(); previousText.remove(); document.getSelection()?.removeAllRanges() }
})
