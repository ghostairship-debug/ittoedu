import { afterEach, expect, it, vi } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { createAuthoringFrameGeometry } from '../../src/components/web/authoringFrame'
import { installHtmlFrameAuthoring, htmlFrameAuthoringBootstrapSource, type HtmlFrameAuthoringBridge } from '../../src/shared/html/htmlFrameAuthoring'
import { locateHtmlSourceTarget } from '../../src/shared/html/htmlSourceLocator'
import { mountHtmlPreviewAgent } from '../../src/player/htmlPreview/htmlPreviewAgent'

const bridges: HtmlFrameAuthoringBridge[] = []
afterEach(() => { bridges.splice(0).forEach(bridge => bridge.dispose()); vi.restoreAllMocks(); document.body.replaceChildren() })

it('reports opaque text style and caret on selection, then enables text range dragging only after explicit editing', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const doc = frame.contentDocument!, view = doc.defaultView as Window & typeof globalThis
  doc.body.innerHTML = '<p>Alpha Beta</p>'
  const paragraph = doc.querySelector('p')!, node = paragraph.firstChild!
  const nativeRange = doc.createRange.bind(doc)
  vi.spyOn(doc, 'createRange').mockImplementation(() => {
    const range = nativeRange()
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => ({ x: 0, y: 0, width: 120, height: 24 }) })
    return range
  })
  Object.defineProperty(doc, 'caretPositionFromPoint', { configurable: true, value: (x: number) => ({ offsetNode: node, offset: x }) })
  view.requestAnimationFrame = vi.fn(() => 1)
  const report = { node, authorKey: 'field', initialValue: 'Alpha Beta', bindingStatus: 'bound' as const,
    record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], textIndex: 0, baseline: 'Alpha Beta' }, overrides: {} } }
  const factory = (() => ({ describe: () => report, scan: () => [report], geometry: () => undefined,
    textStyle: () => ({ 'font-family': 'Georgia', 'font-size': '24px', 'white-space': 'normal' }),
    visible: () => true, hit: () => report, roots: () => [doc], setActive() {}, suppressText() {}, refresh() {}, previewGeometry() {}, dispose() {} })) as unknown as typeof createDomAuthoring
  const sent = vi.spyOn(view.parent, 'postMessage').mockImplementation(() => {})
  const bridge = installHtmlFrameAuthoring(factory, doc); bridges.push(bridge)
  const receive = (value: Record<string, unknown>) => view.dispatchEvent(new view.MessageEvent('message', {
    source: view.parent, data: { protocol: 'cw-html-frame-authoring', ...value },
  }))
  receive({ type: 'state', route: '/opaque', base: 'https://sample.test/', sourcesChain: [], observe: true, editMode: true, visible: true })
  const pointer = (type: string, x: number) => paragraph.dispatchEvent(new view.MouseEvent(type, { button: 0, clientX: x, clientY: 5, bubbles: true, cancelable: true }))
  pointer('pointerdown', 2)
  const target = sent.mock.calls.map(call => call[0]).find(value => value.type === 'targets')!.targets[0]
  expect(target.textStyle).toEqual({ 'font-family': 'Georgia', 'font-size': '24px', 'white-space': 'normal' })
  expect(target.selection).toEqual({ anchor: 2, focus: 2 })
  pointer('pointermove', 7)
  expect(sent.mock.calls.map(call => call[0]).find(value => value.type === 'selection')).toBeUndefined()
  pointer('pointerup', 7)
  pointer('dblclick', 3)
  expect(sent.mock.calls.at(-1)![0]).toMatchObject({ type: 'targets', intent: 'edit', targets: [{ handle: target.handle, selection: { anchor: 3, focus: 3, word: true } }] })
  receive({ type: 'select', handle: target.handle, editable: true, editing: true })
  pointer('pointerdown', 3); pointer('pointermove', 7)
  expect(sent.mock.calls.map(call => call[0]).find(value => value.type === 'selection')).toMatchObject({ handle: target.handle, anchor: 3, focus: 7 })
  receive({ type: 'select', handle: null, editable: false })
  receive({ type: 'confirm', scanId: 'one', handles: [target.handle] })
  expect(doc.querySelector('[data-html-preview-edit-markers] > div')?.getAttribute('style')).toContain('dashed')
  receive({ type: 'confirm', scanId: 'two', handles: [] })
  expect(doc.querySelector('[data-html-preview-edit-markers]')).toBeNull()
})

it('maps every remote report using the same affine frame facts for bounds, geometry and glyphs', () => {
  const frame = document.createElement('iframe'); document.body.append(frame)
  const facts = createAuthoringFrameGeometry()
  const frameFactory = () => ({ ...facts, frameMatrix: () => [0, .5, -.5, 0, 100, 20] as [number, number, number, number, number, number] })
  const bridge = installHtmlFrameAuthoring(createDomAuthoring, document, undefined, false, undefined, frameFactory); bridges.push(bridge)
  const received: unknown[] = []; bridge.onTargets(event => received.push(event))
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { protocol: 'cw-html-frame-authoring', type: 'targets', event: 'targets', targets: [{
    handle: 'remote', kind: 'text', domPath: [], sectionOrder: null, rawText: 'Rotate', attributeName: null, scriptCreated: true,
    rect: { x: 10, y: 20, width: 80, height: 30 }, textStyle: { 'font-size': '40px', transform: 'matrix(1,0,0,1,0,0)' },
    geometry: { parentToInstance: [1, 0, 0, 1, 7, 9], frame: { width: 80, height: 30, transform: [1, 0, 0, 1, 0, 0] } },
  }] } }))
  expect(received).toMatchObject([{ event: 'targets', targets: [{ rect: { x: 75, y: 25, width: 15, height: 40 },
    textStyle: { transform: 'matrix(0,0.5,-0.5,0,0,0)' }, geometry: { parentToInstance: [0, .5, -.5, 0, 95.5, 23.5] } }] }])
})

it('keeps a proven earlier target editable despite a later malformed comment, and serializes all parser dependencies', () => {
  const source = '<html><head></head><body><p>Keep</p><!-- unfinished'
  const target = locateHtmlSourceTarget(source, { handle: 'keep', kind: 'text', domPath: [{ name: 'html', index: 0 }, { name: 'body', index: 1 }, { name: 'p', index: 0 }],
    sectionOrder: null, rawText: 'Keep', attributeName: null, rect: { x: 0, y: 0, width: 50, height: 20 }, scriptCreated: false },
  { documentId: 'doc', epoch: 'epoch', revision: 1, bindingVersion: 1 })
  expect(target.status).toBe('editable')
  new Function(htmlFrameAuthoringBootstrapSource())()
  const bridge = (window as Window & { __cwHtmlFrameAuthoring?: HtmlFrameAuthoringBridge }).__cwHtmlFrameAuthoring!
  bridges.push(bridge)
  expect(bridge.controlState?.()).toEqual({ editMode: false, visible: true })
})

it('reports a failed mode preparation without a false ACK and accepts a later explicit retry', () => {
  document.body.innerHTML = '<p>Still available</p>'
  const nativeRange = document.createRange.bind(document)
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = nativeRange()
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(0, 0, 100, 20) })
    return range
  })
  const sent = vi.spyOn(window, 'postMessage').mockImplementation(() => {})
  const release = mountHtmlPreviewAgent(document)
  const command = (data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { source: window, data }))
  command({ type: 'html-preview.init', leaseId: 'lease', loadId: 'load' })
  const styles = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw new Error('style measurement failed') })
  try {
    command({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'first', enabled: true })
    expect(sent.mock.calls.map(call => call[0])).toContainEqual(expect.objectContaining({ event: 'edit-mode-error', requestId: 'first', enabled: true }))
    expect(sent.mock.calls.map(call => call[0])).not.toContainEqual(expect.objectContaining({ event: 'edit-mode-ready', requestId: 'first' }))
    styles.mockRestore()
    command({ type: 'html-preview.edit-mode', loadId: 'load', requestId: 'retry', enabled: true })
    expect(sent.mock.calls.map(call => call[0])).toContainEqual(expect.objectContaining({ event: 'edit-mode-ready', requestId: 'retry', enabled: true }))
  } finally { styles.mockRestore(); release() }
})
