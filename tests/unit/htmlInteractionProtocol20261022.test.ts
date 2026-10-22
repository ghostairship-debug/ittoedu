import { afterEach, expect, it, vi } from 'vitest'
import { installAuthoringInputArbitration, authoringCaretOffset } from '../../src/components/web/ownedDocumentAuthoring'
import { HtmlPreviewController } from '../../src/renderer/documentFiles/html/htmlPreviewController'
import { htmlNodePath, htmlTargetFromPreview, htmlTargetNode } from '../../src/renderer/documentFiles/html/htmlEditingTarget'
import { inspectHtmlSource, flattenHtmlSourceNodes } from '../../src/shared/html/htmlSourceStructure'
import { extractHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { decorateHtmlFrameAuthoring, installHtmlFrameAuthoring } from '../../src/shared/html/htmlFrameAuthoring'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'
import { HtmlSourceAnalysis } from '../../src/renderer/documentFiles/html/htmlSourceAnalysis'
import { analyzeHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import { decodeHtmlEntities, indexHtmlElements, scanHtmlSource } from '../../src/shared/html/htmlSourceScanner'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

it('arbitrates the first pointer event before authored handlers, then releases normal run behavior', () => {
  const button = document.createElement('button'); button.textContent = 'Start'; document.body.append(button)
  let editing = true
  const select = vi.fn(), business = vi.fn()
  // The same function source is used in the early parser bootstrap.
  const install = new Function(`return (${installAuthoringInputArbitration.toString()})`)() as typeof installAuthoringInputArbitration
  const release = install(document, { editing: () => editing, select })
  button.addEventListener('pointerdown', business)
  button.addEventListener('click', business)
  button.addEventListener('dblclick', business)
  try {
    const down = new MouseEvent('pointerdown', { button: 0, clientX: 11, clientY: 22, bubbles: true, cancelable: true })
    button.dispatchEvent(down)
    button.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }))
    button.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }))
    expect(down.defaultPrevented).toBe(true)
    expect(select).toHaveBeenCalledTimes(1)
    expect(select.mock.calls[0]?.[0]).toEqual({ x: 11, y: 22 })
    button.dispatchEvent(new MouseEvent('dblclick', { button: 0, clientX: 11, clientY: 22, bubbles: true, cancelable: true }))
    expect(select).toHaveBeenCalledTimes(2)
    expect(select.mock.calls[1]?.[1].type).toBe('dblclick')
    expect(business).not.toHaveBeenCalled()
    editing = false
    button.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }))
    button.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true }))
    expect(business).toHaveBeenCalledTimes(2)
  } finally { release() }
})

it('keeps one discovery IPC in flight and retains the latest scan without losing its chunks', async () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const original = window.desktopAPI
  const pending: Array<{ targets: Array<{ handle: string }>; resolve(value: unknown): void }> = []
  window.desktopAPI = { ...original, workspaceFiles: vi.fn(input => new Promise(resolve => {
    pending.push({ targets: (input as { targets: Array<{ handle: string }> }).targets, resolve })
  })) } as typeof window.desktopAPI
  vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  const controller = new HtmlPreviewController(iframe, { leaseId: 'lease', loadId: 'load', documentId: 'doc', epoch: 'epoch',
    revision: 1, bindingVersion: 1, url: 'https://preview.invalid/' }, {
    onTarget: vi.fn(), onReady: vi.fn(), onEditModeReady: vi.fn(), onPage: vi.fn(), onEditing: vi.fn(),
    onApplied: vi.fn(), onEditSettled: vi.fn(), onPatchMismatch: vi.fn(),
  })
  const report = (seq: number, scanId: string, handle: string) => window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow, data: { protocol: 1, leaseId: 'lease', loadId: 'load', event: 'edit-targets', seq, scanId,
      targets: [{ handle, kind: 'text', domPath: [], sectionOrder: null, rawText: 'text', attributeName: null,
        rect: { x: 0, y: 0, width: 10, height: 10 }, scriptCreated: false }] },
  }))
  try {
    controller.setEditMode(true)
    report(1, 'old', 'old-in-flight'); report(2, 'old', 'old-pending')
    report(3, 'latest', 'latest-a'); report(4, 'latest', 'latest-b')
    expect(pending).toHaveLength(1)
    pending[0]!.resolve({ revision: 1, targets: [] })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(pending).toHaveLength(2)
    expect(pending[1]!.targets.map(target => target.handle)).toEqual(['latest-a', 'latest-b'])
    controller.dispose()
    pending[1]!.resolve({ revision: 1, targets: [] })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(pending).toHaveLength(2)
  } finally { controller.dispose(); window.desktopAPI = original }
})

it('retains the current pointer range and word intent while its source target is resolving', async () => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const original = window.desktopAPI, onTarget = vi.fn(), pending: Array<(value: unknown) => void> = []
  window.desktopAPI = { ...original, workspaceFiles: vi.fn(() => new Promise(resolve => pending.push(resolve))) } as typeof window.desktopAPI
  vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
  const controller = new HtmlPreviewController(iframe, { leaseId: 'lease', loadId: 'load', documentId: 'doc', epoch: 'epoch',
    revision: 1, bindingVersion: 1, url: 'https://preview.invalid/' }, {
    onTarget, onReady: vi.fn(), onEditModeReady: vi.fn(), onPage: vi.fn(), onEditing: vi.fn(),
    onApplied: vi.fn(), onEditSettled: vi.fn(), onPatchMismatch: vi.fn(),
  })
  let seq = 0
  const message = (body: object) => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow,
    data: { protocol: 1, leaseId: 'lease', loadId: 'load', seq: ++seq, ...body } }))
  const target = (handle: string) => message({ event: 'targets', targets: [{ handle, kind: 'text', domPath: [], sectionOrder: null,
    rawText: 'Editable heading', attributeName: null, rect: { x: 0, y: 0, width: 100, height: 40 }, scriptCreated: false,
    selection: { anchor: 5, focus: 5 } }] })
  try {
    controller.setEditMode(true)
    target('old'); message({ event: 'selection', handle: 'old', anchor: 1, focus: 6 })
    target('current'); message({ event: 'selection', handle: 'current', anchor: 5, focus: 5, word: true })
    message({ event: 'selection', handle: 'old', anchor: 0, focus: 2 })
    pending[1]!({ revision: 1, targets: [{ handle: 'current', status: 'not-editable', reason: 'source-mismatch' }] })
    await Promise.resolve()
    expect(onTarget).toHaveBeenLastCalledWith(expect.objectContaining({ report: expect.objectContaining({ handle: 'current',
      selection: { anchor: 5, focus: 5, word: true } }) }), expect.any(String))
    const count = onTarget.mock.calls.length
    pending[0]!({ revision: 1, targets: [{ handle: 'old', status: 'not-editable', reason: 'source-mismatch' }] })
    await Promise.resolve(); expect(onTarget).toHaveBeenCalledTimes(count)
  } finally { controller.dispose(); window.desktopAPI = original }
})

it('uses source addresses for static targets and retains author identity without inventing a dynamic source span', () => {
  const source = '<main><script>keep()</script><p id="a">Text</p><img src="x.png"></main>'
  const structure = inspectHtmlSource(source), nodes = flattenHtmlSourceNodes(structure.roots)
  const paragraph = nodes.find(node => node.attributes.id === 'a')!, text = paragraph.children[0]!
  const path = htmlNodePath(structure.roots, text.key)!
  expect(path.at(-1)).toEqual({ name: 'p', index: 1 })
  expect(htmlTargetNode({ revision: 1, source: text.address }, nodes, 1)?.key).toBe(text.key)
  expect(htmlTargetNode({ revision: 0, source: text.address }, nodes, 1)).toBeUndefined()
  const target = htmlTargetFromPreview({ report: { handle: 'live', kind: 'text', domPath: path, sectionOrder: null,
    rawText: 'Text', attributeName: null, rect: { x: 0, y: 0, width: 10, height: 10 }, scriptCreated: true,
    authoring: { authorKey: 'author', record: { kind: 'text', binding: { kind: 'dom', path: [], baseline: 'Text' }, overrides: {} } } },
    resolved: { handle: 'live', status: 'not-editable', reason: 'script-created' } }, 1)
  expect(target).toEqual({ revision: 1, authorKey: 'author' })
})

it('extracts one software payload without treating an invalid empty payload as an absent wrapper', () => {
  const source = '<p>Keep</p><script id="cw-html-authoring-records" type="application/json">{"version":1,"records":{},"sources":{"child":{"html":"<p>Child</p>","base":"https://example.test/"}}}</script>'
  expect(extractHtmlAuthoringRecords(source)).toEqual({ source: '<p>Keep</p>', authoringRecords: {},
    frameSources: { child: { html: '<p>Child</p>', base: 'https://example.test/' } } })
  expect(() => readHtmlAuthoringRecords('<script id="cw-html-authoring-records">{}</script>')).toThrow('作者数据区格式不完整')
})


it('refreshes only the recognized software bootstrap body and continues into an authored srcdoc', () => {
  const child = '<script id="cw-html-frame-bootstrap">oldChild()</script><p>Child</p>'
  const encoded = child.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  const authored = '<script>const marker="cw-html-frame-bootstrap"; keep()</script>'
  const source = `<!doctype html><html><head><script id='cw-html-frame-bootstrap' data-own="preserve">oldRoot()</script>${authored}</head><body><iframe srcdoc="${encoded}"></iframe></body></html>`
  const result = decorateHtmlFrameAuthoring(source, 'newGuard()')
  expect(result).toContain(`<script id='cw-html-frame-bootstrap' data-own="preserve">newGuard()</script>${authored}`)
  const attribute = scanHtmlSource(result).tokens.find(token => token.kind === 'start-tag' && token.name === 'iframe')!.attributes!.find(attribute => attribute.name === 'srcdoc')!
  const nested = attribute.decodedValue ?? decodeHtmlEntities(result.slice(attribute.valueSpan!.start, attribute.valueSpan!.end))
  expect(nested).toBe('<script id="cw-html-frame-bootstrap">newGuard()</script><p>Child</p>')
  expect(indexHtmlElements(result).elements.filter(element => element.name === 'script' && element.id === 'cw-html-frame-bootstrap')).toHaveLength(1)
  expect(decorateHtmlFrameAuthoring(result, 'newGuard()')).toBe(result)
})


it('reinstalls the parser input owner on a real bootstrap while retaining the current edit controls', () => {
  let editing: (() => boolean) | undefined
  const release = vi.fn()
  const input = vi.fn((_document, options) => { editing = options.editing; return release }) as unknown as typeof installAuthoringInputArbitration
  const first = installHtmlFrameAuthoring(createDomAuthoring, document, input)
  first.setEditMode(true)
  const second = installHtmlFrameAuthoring(createDomAuthoring, document, input, true)
  try {
    expect(second).not.toBe(first)
    expect(release).toHaveBeenCalledTimes(1)
    expect(input).toHaveBeenCalledTimes(2)
    expect(editing?.()).toBe(true)
    expect(installHtmlFrameAuthoring(createDomAuthoring, document, input)).toBe(second)
    expect(input).toHaveBeenCalledTimes(2)
  } finally { second.dispose() }
})


it('shares each caller-owned source analysis without retaining prior revisions or re-reading a software payload', () => {
  const source = '<p>Keep</p><script id="cw-html-authoring-records">{"version":1,"records":{}}</script>'
  const scan = vi.fn(() => scanHtmlSource(source).tokens)
  const authoring = analyzeHtmlAuthoringRecords(source, scan)
  expect(authoring.authoringRecords).toBe(authoring.authoringRecords)
  expect(authoring.frameSources).toBe(authoring.frameSources)
  expect(authoring.source).toBe('<p>Keep</p>')
  expect(scan).toHaveBeenCalledTimes(1)
  const analysis = new HtmlSourceAnalysis(source)
  expect(analysis.scan).toBe(analysis.scan)
  expect(analysis.authoring).toBe(analysis.authoring)
  expect(analysis.structure).toBe(analysis.structure)
  expect(analysis.nodes).toBe(analysis.nodes)
  expect(new HtmlSourceAnalysis('<p>Next</p>').authoring.source).toBe('<p>Next</p>')
})


it('measures only current intersections after scrolling and leaves formerly confirmed markers outside the geometry batch', () => {
  document.body.innerHTML = '<p id="first">First</p><p id="second">Second</p>'
  let intersect: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void = () => {}
  const watched = new Set<Element>()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe(element: Element) { watched.add(element) }
    unobserve(element: Element) { watched.delete(element) }
    disconnect() { watched.clear() }
  })
  const frames = new Map<number, FrameRequestCallback>(); let next = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++next, callback); return next })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const drain = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0) }
  const measured: string[] = []
  const rangeBox = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: function (this: Range) {
    measured.push(this.startContainer.parentElement?.id ?? '')
    return { x: 10, y: 10, width: 40, height: 20, left: 10, top: 10, right: 50, bottom: 30, toJSON: () => ({}) }
  } })
  const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const release = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  try {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true, requestId: 'mode' })
    const first = document.querySelector('#first')!, second = document.querySelector('#second')!
    expect(watched.has(first)).toBe(true); expect(watched.has(second)).toBe(true)
    measured.length = 0
    intersect([{ target: first, isIntersecting: true }, { target: second, isIntersecting: false }]); drain()
    expect(measured).toContain('first'); expect(measured).not.toContain('second')
    const report = sent.mock.calls.map(call => call[0]).reverse().find(value => value.event === 'edit-targets')
    command({ type: 'html-preview.confirm-targets', loadId: 'load', scanId: report.scanId, handles: report.targets.map((target: { handle: string }) => target.handle) })
    measured.length = 0
    intersect([{ target: first, isIntersecting: false }, { target: second, isIntersecting: true }]); drain()
    expect(measured).not.toContain('first'); expect(measured).toContain('second')
  } finally {
    release()
    ;(window as Window & { __cwHtmlFrameAuthoring?: { dispose(): void } }).__cwHtmlFrameAuthoring?.dispose()
    if (rangeBox) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBox)
    else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
  }
})


it('delegates an older root frame guard to the current preview owner after a real remount', () => {
  document.body.innerHTML = '<p>Current text</p>'
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const rangeBox = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({
    x: 10, y: 10, width: 40, height: 20, left: 10, top: 10, right: 50, bottom: 30, toJSON: () => ({}),
  }) })
  const caret = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
  Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => {
    const range = document.createRange(); const text = document.querySelector('p')!.firstChild!; range.setStart(text, 0); range.setEnd(text, text.textContent!.length); return range
  } })
  const posted = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  const enable = (loadId: string) => {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId })
    command({ type: 'html-preview.edit-mode', loadId, enabled: true, requestId: 'mode' })
  }
  const parserBridge = installHtmlFrameAuthoring(createDomAuthoring, document)
  let release = mountHtmlPreviewAgent(document)
  try {
    enable('old')
    release()
    expect((window as Window & { __cwHtmlFrameAuthoring?: unknown }).__cwHtmlFrameAuthoring).toBe(parserBridge)
    release = mountHtmlPreviewAgent(document)
    enable('current')
    posted.mockClear()
    document.querySelector('p')!.dispatchEvent(new MouseEvent('click', { button: 0, clientX: 12, clientY: 12, bubbles: true, cancelable: true }))
    expect(posted.mock.calls.map(call => call[0]).filter(value => value.event === 'targets')).toMatchObject([
      { loadId: 'current', targets: [{ rawText: 'Current text' }] },
    ])
  } finally {
    release()
    ;(window as Window & { __cwHtmlFrameAuthoring?: { dispose(): void } }).__cwHtmlFrameAuthoring?.dispose()
    if (rangeBox) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBox); else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    if (caret) Object.defineProperty(document, 'caretRangeFromPoint', caret); else Reflect.deleteProperty(document, 'caretRangeFromPoint')
  }
})


it('keeps caret intent only for the exact current text leaf and counts UTF-16 units', () => {
  document.body.innerHTML = '<p>A😀B</p><p>A😀B</p>'
  const [text, other] = [...document.querySelectorAll('p')].map(element => element.firstChild!)
  const descriptor = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', { configurable: true, value: () => ({ offsetNode: text, offset: 3 }) })
  try {
    const offset = new Function(`return (${authoringCaretOffset.toString()})`)() as typeof authoringCaretOffset
    expect(offset(document, text, 1, 1)).toBe(3)
    expect(offset(document, other, 1, 1)).toBeUndefined()
    expect(offset(document, text!.parentElement!, 1, 1)).toBeUndefined()
  } finally {
    if (descriptor) Object.defineProperty(document, 'caretPositionFromPoint', descriptor); else Reflect.deleteProperty(document, 'caretPositionFromPoint')
  }
})


it('retires registered child realms while hidden even when their own old document tree stays connected', async () => {
  document.body.innerHTML = '<iframe></iframe>'
  const frame = document.querySelector('iframe')!, child = frame.contentDocument!
  child.open(); child.write('<p>Child</p><iframe></iframe>'); child.close()
  const nested = child.querySelector('iframe')!.contentDocument!
  nested.open(); nested.write('<p>Nested</p>'); nested.close()
  const childElement = child.querySelector('p')!, nestedElement = nested.querySelector('p')!
  const childText = childElement.firstChild!, nestedText = nestedElement.firstChild!
  // jsdom clears removed frame trees eagerly; preserve the old document's
  // connected-node signal so this checks realm ownership, not only DOM removal.
  Object.defineProperty(childText, 'isConnected', { configurable: true, value: true })
  Object.defineProperty(nestedText, 'isConnected', { configurable: true, value: true })
  const watched = new Set<Element>()
  vi.stubGlobal('IntersectionObserver', class {
    observe(element: Element) { watched.add(element) }
    unobserve(element: Element) { watched.delete(element) }
    disconnect() { watched.clear() }
  })
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const release = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  try {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true, requestId: 'mode' })
    expect(watched.has(childElement)).toBe(true)
    expect(watched.has(nestedElement)).toBe(true)
    command({ type: 'html-preview.visibility', loadId: 'load', active: false })
    frame.remove()
    expect(childText.isConnected).toBe(true)
    expect(nestedText.isConnected).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(watched.has(childElement)).toBe(false)
    expect(watched.has(nestedElement)).toBe(false)
  } finally {
    release()
    ;(window as Window & { __cwHtmlFrameAuthoring?: { dispose(): void } }).__cwHtmlFrameAuthoring?.dispose()
  }
})

it('upgrades an old saved nested observer without changing the authored DOM or running its handlers', () => {
  document.body.innerHTML = '<p>Keep program state</p>'
  const element = document.querySelector('p')!, business = vi.fn(); element.onclick = business
  const old = { documents: () => [document], dispose: vi.fn(), setActive: undefined, targets: undefined }
  Reflect.set(window, '__cwHtmlAuthoringConsumer', old)
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const release = mountHtmlPreviewAgent(document)
  try {
    const current = (window as Window & { __cwHtmlAuthoringConsumer?: { targets?: unknown; setActive?: unknown } }).__cwHtmlAuthoringConsumer
    expect(old.dispose).toHaveBeenCalledOnce()
    expect(current?.targets).toBeTypeOf('function'); expect(current?.setActive).toBeTypeOf('function')
    expect(document.querySelector('p')).toBe(element)
    expect(element.textContent).toBe('Keep program state')
    expect(business).not.toHaveBeenCalled()
    element.click()
    expect(business).toHaveBeenCalledOnce()
  } finally {
    release()
    ;(window as Window & { __cwHtmlFrameAuthoring?: { dispose(): void } }).__cwHtmlFrameAuthoring?.dispose()
  }
})


it('releases only the preview agent-owned fallback frame bridge on teardown', () => {
  document.body.innerHTML = '<p>Keep</p>'
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const own = mountHtmlPreviewAgent(document)
  const bridgeWindow = window as Window & { __cwHtmlFrameAuthoring?: unknown }
  expect(bridgeWindow.__cwHtmlFrameAuthoring).toBeDefined()
  own()
  expect(bridgeWindow.__cwHtmlFrameAuthoring).toBeUndefined()
  const parserBridge = installHtmlFrameAuthoring(createDomAuthoring, document)
  const inherited = mountHtmlPreviewAgent(document)
  inherited()
  expect(bridgeWindow.__cwHtmlFrameAuthoring).toBe(parserBridge)
  parserBridge.dispose()
})


it('maps an author key only when the static source is unique, keeping explicit source spans usable', () => {
  const structure = inspectHtmlSource('<p data-cw-author-key="same">First</p><p data-cw-author-key="same">Second</p>')
  const nodes = flattenHtmlSourceNodes(structure.roots), text = nodes.find(node => node.value === 'Second')!
  expect(htmlTargetNode({ revision: 1, authorKey: 'same' }, nodes, 1)).toBeUndefined()
  expect(htmlTargetNode({ revision: 1, authorKey: 'same', source: text.address }, nodes, 1)).toBe(text)
  const unique = flattenHtmlSourceNodes(inspectHtmlSource('<p data-cw-author-key="unique">Only</p>').roots)
  expect(htmlTargetNode({ revision: 1, authorKey: 'unique' }, unique, 1)?.name).toBe('p')
})

it('rebinds a changed child document root before observing later child mutations', async () => {
  document.body.innerHTML = '<iframe></iframe>'
  const frame = document.querySelector('iframe')!, child = frame.contentDocument!
  child.open(); child.write('<p>Old</p>'); child.close()
  const watched = new Set<Element>()
  vi.stubGlobal('IntersectionObserver', class {
    observe(element: Element) { watched.add(element) }
    unobserve(element: Element) { watched.delete(element) }
    disconnect() { watched.clear() }
  })
  const frames = new Map<number, FrameRequestCallback>(); let next = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++next, callback); return next })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const drain = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0) }
  vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const release = mountHtmlPreviewAgent(document)
  const command = (data: object) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  try {
    command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
    command({ type: 'html-preview.edit-mode', loadId: 'load', enabled: true, requestId: 'mode' })
    const root = child.createElement('html'); root.innerHTML = '<head></head><body><p>Current</p></body>'
    child.replaceChild(root, child.documentElement)
    frame.dispatchEvent(new Event('load'))
    drain()
    const later = child.createElement('p'); later.textContent = 'Later'; child.body.append(later)
    await new Promise(resolve => setTimeout(resolve, 0)); drain()
    expect(watched.has(later)).toBe(true)
  } finally {
    release()
    ;(window as Window & { __cwHtmlFrameAuthoring?: { dispose(): void } }).__cwHtmlFrameAuthoring?.dispose()
  }
})
