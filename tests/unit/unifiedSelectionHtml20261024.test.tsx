import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { HtmlSourceEditService } from '../../src/main/workbench/htmlPreview/HtmlSourceEditService'
import { HtmlPreviewPane } from '../../src/renderer/documentFiles/html/HtmlPreviewPane'
import { HtmlTextDrafts } from '../../src/renderer/documentFiles/html/htmlTextDrafts'
import { readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'
import { HtmlPreviewController } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import { installHtmlFrameAuthoring } from '../../src/shared/html/htmlFrameAuthoring'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { createNestedDomAuthoring } from '../../src/components/web/nestedAuthoringDom'
import { createAuthoringFrameGeometry } from '../../src/components/web/authoringFrame'
import { workbenchSelection } from '../../src/renderer/workbench/SelectionContextController'
import { elementCards } from '../../src/renderer/workbench/elementCards/elementCardController'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

const report = { handle: 'title', kind: 'text' as const, domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
  sectionOrder: null, rawText: 'Hello', attributeName: null, rect: { x: 20, y: 40, width: 200, height: 40 }, scriptCreated: false, bindingStatus: 'bound' as const,
  authoring: { authorKey: 'title-key', record: { kind: 'text' as const, binding: { kind: 'dom' as const, path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'title' } }], textIndex: 0, baseline: 'Hello' }, overrides: {} } },
  geometry: { frame: { width: 100, height: 20, transform: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] },
    parentToInstance: [2, 0, 0, 2, 0, 0] as [number, number, number, number, number, number], author: {}, boxInsets: { width: 0, height: 0 } } }

async function pane(commitDuringStyleResolve = false) {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const source = '<html><body><p id="title">Hello</p></body></html>', driver = new TextDriver()
  const session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch', model: driver.load(new TextEncoder().encode(source)),
    binding: { kind: 'file', path: 'sample.html', version: null, bindingVersion: 1 } }, driver,
    { async append() {}, async save(input) { return input.binding as Extract<typeof input.binding, { kind: 'file' }> } })
  const lease = { leaseId: 'lease', documentId: 'doc', epoch: 'epoch', revision: 0, bindingVersion: 1, loadId: 'load', url: 'about:blank' }
  const service = new HtmlSourceEditService({ async readDocument() { return session.read() }, execute: op => session.execute(op), withFileAccess: work => work() })
  const context = () => ({ lease, tabId: 'tab', entryRealPath: 'sample.html', rootRealPath: '.', bindingPath: 'sample.html', snapshot: session.read() })
  const previous = window.desktopAPI, requests: string[] = []
  let styleApplied = false
  Reflect.set(window, 'desktopAPI', { workspaceFiles: async (request: Parameters<typeof service.edit>[0] | Parameters<typeof service.resolveTarget>[0]) => {
    requests.push(request.type)
    const response = request.type === 'html-preview.resolve-target' ? await service.resolveTarget(request, context()) : await service.edit(request, context())
    if (request.type === 'html-preview.edit' && request.change.kind === 'style') styleApplied = true
    else if (styleApplied && commitDuringStyleResolve) {
      styleApplied = false
      view.rerender(createElement(HtmlPreviewPane, { ...props, committed: session.read() }))
    }
    return response
  } })
  const props = { lease, committed: session.read(), tabId: 'tab', textDrafts: new HtmlTextDrafts(), onUndo() {}, onRedo() {} }
  const view = render(createElement(HtmlPreviewPane, props))
  const iframe = view.getByTitle('HTML 预览') as HTMLIFrameElement
  Object.defineProperty(iframe, 'offsetWidth', { configurable: true, value: 400 }); Object.defineProperty(iframe, 'offsetHeight', { configurable: true, value: 200 })
  iframe.getBoundingClientRect = () => new DOMRect(100, 50, 400, 200)
  const posted = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  let seq = 0
  const receive = (data: Record<string, unknown>) => act(async () => { window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow, data: { protocol: 1, leaseId: 'lease', loadId: 'load', ...(data.event === 'ready' ? {} : { seq: ++seq }), ...data } })) })
  await receive({ event: 'ready', sectionCount: 0, sectionsAmbiguous: false })
  const mode = () => posted.mock.calls.map(call => call[0]).filter(value => value.type === 'html-preview.edit-mode').at(-1)!
  await receive({ event: 'edit-mode-ready', requestId: mode().requestId, enabled: false })
  fireEvent.click(view.getByRole('button', { name: '编辑' }))
  await receive({ event: 'edit-mode-ready', requestId: mode().requestId, enabled: true })
  return { view, session, requests, posted, receive, updateCommitted() { view.rerender(createElement(HtmlPreviewPane, { ...props, committed: session.read() })) },
    restore() { view.unmount(); Reflect.set(window, 'desktopAPI', previous) } }
}

it('selects without input, edits only on explicit edit intent and Escape retains its frame and target', async () => {
  const test = await pane()
  try {
    await test.receive({ event: 'targets', intent: 'select', targets: [{ ...report, geometry: undefined }] })
    expect(test.view.queryByRole('textbox', { name: '编辑此处文字' })).toBeNull()
    expect(test.view.getByRole('toolbar', { name: 'HTML 对象快捷工具条' })).toBeTruthy()
    expect(test.view.getByLabelText('HTML 对象选框')).toBeTruthy()
    expect(test.view.queryByLabelText('缩放 HTML 对象 se')).toBeNull()
    expect(test.posted.mock.calls.map(call => call[0]).at(-1)).toMatchObject({ type: 'html-preview.selection', handle: 'title', editing: false })
    await test.receive({ event: 'targets', intent: 'edit', targets: [{ ...report, geometry: undefined }] })
    const input = test.view.getByRole('textbox', { name: '编辑此处文字' })
    expect(test.posted.mock.calls.map(call => call[0]).at(-1)).toMatchObject({ type: 'html-preview.selection', handle: 'title', editing: true })
    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }) })
    expect(test.view.queryByRole('textbox', { name: '编辑此处文字' })).toBeNull()
    expect(test.view.getByLabelText('HTML 对象选框')).toBeTruthy()
    expect(test.posted.mock.calls.map(call => call[0]).at(-1)).toMatchObject({ type: 'html-preview.selection', handle: 'title', editing: false })
    expect(test.session.read().undoDepth).toBe(0)
  } finally { test.restore() }
})

it('uses the shared HTML quick bar and opens AI on the current text after pending input is committed', async () => {
  const test = await pane()
  const unregister = workbenchSelection.register('doc', async () => test.session.read())
  const opened = vi.spyOn(elementCards, 'openText').mockReturnValue('html-entry-ai')
  try {
    await test.receive({ event: 'targets', intent: 'edit', targets: [report] })
    const toolbar = test.view.getByRole('toolbar', { name: 'HTML 对象快捷工具条' })
    expect(toolbar.closest('[data-selection-quick-bar]')).toBeTruthy()
    expect(test.view.getByRole('button', { name: '加粗' })).toBeTruthy()
    const input = test.view.getByRole('textbox', { name: '编辑此处文字' })
    input.textContent = 'Current human text'
    fireEvent.input(input)
    fireEvent.click(test.view.getByRole('button', { name: 'AI 修改' }))
    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
    expect(opened.mock.calls[0]![0]).toMatchObject({ documentId: 'doc', content: 'Current human text',
      target: { kind: 'html-author-field', authorKey: 'title-key', field: 'text' } })
    expect(test.session.read().undoDepth).toBe(1)
    expect(test.view.getByLabelText('HTML 对象选框')).toBeTruthy()
  } finally { unregister(); test.restore() }
})

it('formats an independent HTML text box and retains its selected handle when committed props arrive after the style ACK', async () => {
  const test = await pane(true)
  try {
    await test.receive({ event: 'targets', intent: 'select', targets: [report] })
    fireEvent.change(test.view.getByRole('spinbutton', { name: '字号' }), { target: { value: '32' } })
    await waitFor(() => expect(test.session.read().undoDepth).toBe(1))
    const saved = test.session.read()
    if (saved.model.kind !== 'text') throw new Error('text')
    expect(readHtmlAuthoringRecords(saved.model.source)['title-key']!.overrides.style).toMatchObject({ 'font-size': '32px' })
    await act(async () => { test.updateCommitted() })
    expect(test.view.getByRole('button', { name: '编辑文字' })).toBeTruthy()
    fireEvent.click(test.view.getByRole('button', { name: '编辑文字' }))
    await waitFor(() => expect(test.view.getByRole('textbox', { name: '编辑此处文字' })).toBeTruthy())
    expect(test.session.read().undoDepth).toBe(1)
  } finally { test.restore() }
})

it('moves the exact independent geometry through body pointer phases and commits once at the final point', async () => {
  const test = await pane()
  const gesture = (phase: string, x: number, y: number) => test.receive({ event: 'gesture', phase, handle: 'title', pointerId: 1, x, y, shift: false, alt: false })
  try {
    await test.receive({ event: 'targets', intent: 'select', targets: [report] })
    await gesture('start', 20, 40); await gesture('update', 22, 40); await gesture('end', 22, 40)
    expect(test.session.read().undoDepth).toBe(0)
    await gesture('start', 20, 40); await gesture('update', 40, 50); await gesture('end', 60, 60)
    await waitFor(() => expect(test.session.read().undoDepth).toBe(1))
    expect(test.requests.filter(type => type === 'html-preview.edit')).toHaveLength(1)
    const saved = test.session.read().model
    if (saved.kind !== 'text') throw new Error('text')
    expect(readHtmlAuthoringRecords(saved.source)['title-key'].overrides.geometry).toMatchObject({ translateX: 20, translateY: 10 })
    expect(test.view.getByLabelText('HTML 对象选框')).toBeTruthy()
    expect(test.view.getAllByRole('toolbar', { name: 'HTML 对象快捷工具条' })).toHaveLength(1)
    await gesture('start', 60, 60); await gesture('update', 90, 90); await gesture('cancel', 100, 100)
    expect(test.session.read().undoDepth).toBe(1)
  } finally { test.restore() }
})

it('keeps a changed text target selected and immediately permits its own geometry without moving another owner', async () => {
  const test = await pane()
  try {
    await test.receive({ event: 'targets', intent: 'edit', targets: [report] })
    const input = test.view.getByRole('textbox', { name: '编辑此处文字' })
    input.textContent = 'Changed'
    fireEvent.input(input)
    await act(async () => { fireEvent.keyDown(input, { key: 'Escape' }) })
    await waitFor(() => expect(test.session.read().undoDepth).toBe(1))
    expect(test.view.queryByRole('textbox', { name: '编辑此处文字' })).toBeNull()
    expect(test.view.getByLabelText('HTML 对象选框')).toBeTruthy()
    const gesture = (phase: string, x: number, y: number) => test.receive({ event: 'gesture', phase, handle: 'title', pointerId: 1, x, y, shift: false, alt: false })
    await gesture('start', 20, 40); await gesture('end', 40, 60)
    await waitFor(() => expect(test.session.read().undoDepth).toBe(2))
    const saved = test.session.read().model
    if (saved.kind !== 'text') throw new Error('text')
    expect(saved.source).toContain('Changed')
    const record = readHtmlAuthoringRecords(saved.source)['title-key']
    expect(record.binding.baseline).toBe('Changed')
    expect(record.overrides.geometry).toMatchObject({ translateX: 10, translateY: 10 })
    expect(test.requests.filter(type => type === 'html-preview.edit')).toHaveLength(2)
  } finally { test.restore() }
})

it('maps nested author selection and the whole pointer lifecycle with the same affine frame facts', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const facts = createAuthoringFrameGeometry()
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document, undefined, false, undefined,
    () => ({ ...facts, frameMatrix: () => [0, .5, -.5, 0, 100, 20] as [number, number, number, number, number, number] }))
  const observed: unknown[] = []; bridge.onTargets(event => observed.push(event))
  const receive = (body: object) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
    data: { protocol: 'cw-html-frame-authoring', ...body } }))
  try {
    receive({ type: 'targets', event: 'targets', intent: 'edit', targets: [report] })
    receive({ type: 'gesture', handle: 'title', phase: 'start', pointerId: 9, x: 10, y: 20, shift: false, alt: true })
    receive({ type: 'gesture', handle: 'title', phase: 'end', pointerId: 9, x: 30, y: 40, shift: true, alt: false })
    expect(observed).toMatchObject([
      { event: 'targets', intent: 'edit', targets: [{ geometry: { parentToInstance: [0, 1, -1, 0, 100, 20] } }] },
      { event: 'gesture', phase: 'start', pointerId: 9, x: 90, y: 25, alt: true },
      { event: 'gesture', phase: 'end', pointerId: 9, x: 80, y: 35, shift: true },
    ])
  } finally { bridge.dispose() }
})

it('replays an already ended pointer after asynchronous source resolution without starting a second capture', async () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const previous = window.desktopAPI, onGesture = vi.fn(), resolve: Array<(value: unknown) => void> = []
  Reflect.set(window, 'desktopAPI', { workspaceFiles: vi.fn(() => new Promise(done => resolve.push(done))) })
  const controller = new HtmlPreviewController(iframe, { leaseId: 'lease', loadId: 'load', documentId: 'doc', epoch: 'epoch', revision: 0, bindingVersion: 1, url: 'about:blank' },
    { onTarget() {}, onReady() {}, onEditModeReady() {}, onPage() {}, onEditing() {}, onApplied() {}, onEditSettled() {}, onPatchMismatch() {}, onGesture })
  let seq = 0
  const send = (body: object) => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow,
    data: { protocol: 1, leaseId: 'lease', loadId: 'load', seq: ++seq, ...body } }))
  try {
    controller.setEditMode(true)
    send({ event: 'targets', intent: 'select', targets: [report] })
    send({ event: 'gesture', phase: 'start', handle: 'title', pointerId: 7, x: 1, y: 2, shift: false, alt: false })
    send({ event: 'gesture', phase: 'end', handle: 'title', pointerId: 7, x: 21, y: 22, shift: false, alt: false })
    expect(onGesture).not.toHaveBeenCalled()
    resolve[0]!({ revision: 0, targets: [{ handle: 'title', status: 'editable', locator: { revision: 0 } }] })
    await act(async () => {})
    expect(onGesture.mock.calls.map(call => call[0].phase)).toEqual(['start', 'end'])
    expect(onGesture.mock.calls[1]![0]).toMatchObject({ x: 21, y: 22 })
  } finally { controller.dispose(); Reflect.set(window, 'desktopAPI', previous) }
})

it('keeps author clicks inert, suppresses source text only during content input, and restores normal run clicks', () => {
  document.body.innerHTML = '<p id="title">Hello</p><button>Business</button>'
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const originalRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => { const range = originalRange(); Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(0, 0, 100, 20) }); return range })
  const paragraph = document.querySelector('p')!, text = paragraph.firstChild!
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: text, offset: 1 }) })
  const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => {}), business = vi.fn()
  const release = mountHtmlPreviewAgent(document), command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  const consumer = Reflect.get(window, '__cwHtmlAuthoringConsumer') as ReturnType<typeof createDomAuthoring>
  vi.spyOn(consumer, 'hit').mockImplementation(() => consumer.describe(text) ?? undefined)
  const suppress = vi.spyOn(Reflect.get(window, '__cwHtmlAuthoringConsumer') as { suppressText(node?: Node): void }, 'suppressText')
  document.querySelector('button')!.addEventListener('click', business)
  try {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true, requestId: 'mode' })
    paragraph.dispatchEvent(new MouseEvent('click', { button: 0, clientX: 1, clientY: 1, bubbles: true, cancelable: true }))
    const selected = sent.mock.calls.map(call => call[0]).findLast(value => value.event === 'targets')
    expect(selected).toMatchObject({ intent: 'select', targets: [{ rawText: 'Hello' }] })
    command({ type: 'html-preview.selection', loadId: 'load', handle: selected.targets[0].handle, editable: true, editing: false })
    expect(suppress).toHaveBeenLastCalledWith(undefined)
    paragraph.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: 1, clientY: 1, bubbles: true, cancelable: true }))
    expect(sent.mock.calls.map(call => call[0]).findLast(value => value.event === 'targets')).toMatchObject({ intent: 'edit' })
    command({ type: 'html-preview.selection', loadId: 'load', handle: selected.targets[0].handle, editable: true, editing: true })
    expect(suppress).toHaveBeenLastCalledWith(text)
    command({ type: 'html-preview.selection', loadId: 'load', handle: selected.targets[0].handle, editable: true, editing: false })
    expect(suppress).toHaveBeenLastCalledWith(undefined)
    document.querySelector('button')!.click(); expect(business).not.toHaveBeenCalled()
    command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: false, requestId: 'run' })
    document.querySelector('button')!.click(); expect(business).toHaveBeenCalledOnce()
  } finally { release(); Reflect.deleteProperty(document, 'caretPositionFromPoint') }
})

it.each([false, true])('terminates an empty paint hit without re-entering the root document (nested=%s)', nested => {
  if (nested) document.body.append(document.createElement('iframe'))
  const frame = document.querySelector('iframe')
  if (frame) frame.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600)
  let rootReads = 0, childReads = 0
  const factory: typeof createDomAuthoring = (root, options) => ({ ...createDomAuthoring(root, options, () => []),
    paintedElementAt() {
      if (root.ownerDocument === document) {
        if (++rootReads > 1) throw new Error('An empty hit re-entered the root')
        return frame ?? undefined
      }
      if (++childReads > 1) throw new Error('An empty hit revisited the child')
      return undefined
    },
    hit() { return undefined },
  })
  const adapter = createNestedDomAuthoring(document.documentElement, factory, { records: () => ({}) },
    () => ({ ...createAuthoringFrameGeometry(), frameMatrix: () => [1, 0, 0, 1, 0, 0] }))
  try {
    expect(adapter.documents()).toHaveLength(nested ? 2 : 1)
    expect(adapter.hit(20, 30)).toBeUndefined()
    expect(rootReads).toBe(1)
    expect(childReads).toBe(nested ? 1 : 0)
  } finally { adapter.dispose() }
})

it('edits the painted image when pointer capture retargets the second click and double click to the root', () => {
  document.body.innerHTML = '<img src="asset.png" width="100" height="60">'
  const image = document.querySelector('img')!, root = document.documentElement
  image.getBoundingClientRect = () => new DOMRect(10, 20, 100, 60)
  const elementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')
  const elementsFromPoint = Object.getOwnPropertyDescriptor(document, 'elementsFromPoint')
  const setPointerCapture = Object.getOwnPropertyDescriptor(root, 'setPointerCapture')
  const releasePointerCapture = Object.getOwnPropertyDescriptor(root, 'releasePointerCapture')
  const adoptedStyleSheets = Object.getOwnPropertyDescriptor(document, 'adoptedStyleSheets')
  const replaceSync = Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'replaceSync')
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => image })
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [image, document.body, root] })
  // jsdom has no layout/capture or constructable-sheet implementation. Supply
  // only those browser facts while keeping the real paint reader and agent.
  Object.defineProperty(document, 'adoptedStyleSheets', { configurable: true, writable: true, value: [] })
  Object.defineProperty(CSSStyleSheet.prototype, 'replaceSync', { configurable: true, value() {} })
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element))
  const capture = vi.fn()
  Object.defineProperty(root, 'setPointerCapture', { configurable: true, value: capture })
  Object.defineProperty(root, 'releasePointerCapture', { configurable: true, value() {} })
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1); vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const release = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  const pointer = (target: Element, type: string) => {
    const event = new MouseEvent(type, { button: 0, clientX: 20, clientY: 30, bubbles: true, cancelable: true })
    Object.defineProperty(event, 'pointerId', { value: 7 })
    target.dispatchEvent(event)
  }
  try {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true, requestId: 'mode' })
    pointer(image, 'pointerdown'); pointer(root, 'pointerup'); pointer(root, 'click')
    expect(capture).toHaveBeenCalledWith(7)
    pointer(root, 'pointerdown'); pointer(root, 'pointerup'); pointer(root, 'click'); pointer(root, 'dblclick')
    const edits = sent.mock.calls.map(call => call[0]).filter(value => value.event === 'targets' && value.intent === 'edit')
    expect(edits).toMatchObject([{ targets: [{ kind: 'image', rawText: 'asset.png' }] }])
    expect(edits).toHaveLength(1)
  } finally {
    release()
    for (const [object, key, descriptor] of [[document, 'elementFromPoint', elementFromPoint], [document, 'elementsFromPoint', elementsFromPoint],
      [root, 'setPointerCapture', setPointerCapture], [root, 'releasePointerCapture', releasePointerCapture],
      [document, 'adoptedStyleSheets', adoptedStyleSheets], [CSSStyleSheet.prototype, 'replaceSync', replaceSync]] as const) {
      if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key)
    }
  }
})
