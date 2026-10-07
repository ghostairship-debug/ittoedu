import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import { createEditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { createInitialSlideOwnedState, createSlideAuthoringSlice } from '../../src/renderer/store/slices/slideAuthoringSlice'
import { SlideLocationWorkspace, type SlideWorkspacePorts } from '../../src/renderer/ui/workspaces/SlideLocationWorkspace'
import { createTextData, textComponentDataSchema, TEXT_DEFINITION } from '../../src/components/text'
import { TextContentTextarea, PropertyDraftBoundary, hasPropertiesDrafts, discardPropertiesDrafts } from '../../src/renderer/ui/properties/PropertyControls'
import { ChartProperties } from '../../src/renderer/ui/properties/ChartProperties'
import { createChartData, CHART_DEFINITION } from '../../src/components/chart'
import type { ChartCandidateData } from '../../src/renderer/course/chartContentOperations'
import { defaultShapeData, SHAPE_DEFINITION } from '../../src/components/shape'
import type { ComponentAuthorSpot, CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { authorSpotEdit, authorSpotImageEdits } from '../../src/renderer/componentPlatform/surfaces/slide/authorSpots'
import { proposeSlideLineHandle } from '../../src/renderer/ui/workspaceSlideAuthoring'
import { freeSurfaceTargets } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import { frameToSpaceMatrix, transformPoint } from '../../src/core/components/geometry'
import { resolveNativeLinePoints } from '../../src/shared/nativeLineGeometry'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { resolveWebResourceBindings } from '../../src/components/web/resources'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'
import type { DocumentEvent } from '../../src/shared/workbench/document'
import { placeQuickBar } from '../../src/renderer/editing/quickbar/placeQuickBar'

// Quickbar/AI is U7's consumer. This check exercises the original workspace gesture and rich text routes.
const selectionProbe = vi.hoisted(() => ({ bounds: null as null | ((id: string) => { left: number; top: number; width: number; height: number } | null) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: (props: { bounds?: typeof selectionProbe.bounds }) => { selectionProbe.bounds = props.bounds ?? null; return null } }))
const fixture = (): CourseProjectV10 => ({
  schemaVersion: 10, id: 'u4', revision: 0, title: '原画布',
  definitions: { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [SHAPE_DEFINITION.id]: SHAPE_DEFINITION },
  instances: {
    text: { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextData('人工文字'))),
      frame: { width: 240, height: 80, transform: [1, 0, 0, 1, 100, 60] } },
    shape: { id: 'shape', definitionId: SHAPE_DEFINITION.id, data: defaultShapeData(),
      frame: { width: 120, height: 90, transform: [1, 0, 0, 1, 500, 300] } },
  },
  surfaces: [{ id: 'slide', kind: 'slide', title: '演示', childIds: ['text', 'shape'], designSize: { width: 960, height: 640 } }],
  global: { underlay: [], overlay: [] }, assets: {},
})
async function host(project = fixture()) {
  const driver = new CourseV10Driver(), listeners = new Set<(event: DocumentEvent) => void>()
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => 'u4-doc', bindingKey: value => value.path,
    persistence: { async append() {}, async save() { throw new Error('File dialogs belong to the existing lifecycle check') } } })
  const first = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'u4.h5lesson')
  first.subscribe(event => listeners.forEach(listener => listener(event)))
  const api = {
    bootstrapCourse: async () => first.read(), read: async (id: string) => registry.get(id).read(),
    dispatch: async (operation: Parameters<DocumentHostAPI['dispatch']>[0]) => registry.get(operation.documentId).execute(operation),
    lookup: async (id: string, operationId: string) => registry.get(id).lookupOperation(operationId),
    subscribe: (listener: (event: DocumentEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } as DocumentHostAPI
  const bridge = new CourseV10DocumentBridge(); await bridge.connect(api)
  return { driver, first, bridge }
}
it('anchors the quick bar to the clicked internal author target so ordinary double click stays reachable', async () => {
  const project = fixture()
  project.instances.text.frame = { width: 900, height: 600, transform: [1, 0, 0, 1, 200, 140] }
  const h = await host(project), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  const frame = { width: 48.24, height: 24.09, transform: [1, 0, 0, 1, 153.82, 53.99] as [number, number, number, number, number, number] }
  const spot: ComponentAuthorSpot = { id: 'hello', instanceId: 'text', mountGeneration: 1, authorKey: 'hello', kind: 'text', initialValue: 'Hello',
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Hello' }, localBounds: frame,
    geometry: { frame, parentToInstance: [1, 0, 0, 1, 0, 0], author: {}, boxInsets: { width: 0, height: 0 } } }
  const open = vi.fn(), capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture'), release = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture')
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 40, left: 20, top: 40, right: 980, bottom: 680, width: 960, height: 640, toJSON() {} })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value() {} })
  const ports: SlideWorkspacePorts = {
    read: () => { const v = h.bridge.read(); return { project: v.editingProject, documentId: v.activeDocumentId, surfaceId: v.surfaceId, selectedInstanceIds: v.selectedInstanceIds,
      activation: v.activation, activeStateId: v.activeStateId, assetUrls: {}, canvasMode: 'edit', contentEdit: null, drawTool: null } },
    authorSpots: () => [spot], beginSpotEdit: async () => { open(); return {} as never },
    capture: () => kernel.captureTarget(), commit: async () => {}, edit: async () => {}, select: ids => kernel.selectInstances(ids), selectSurface() {},
    setCanvasMode() {}, setDrawTool() {}, report() {}, paste() {}, selectAll() {}, beginTextEdit: () => null, updateDataDraft() {}, commitTextEdit: async () => {}, cancelTextEdit() {},
    undo() {}, redo() {}, onElement() {}, onTargetElement() {}, addTextNode() {}, addFormulaNode() {}, addRectangleNode() {}, addShapeNode() {}, addTableNode() {}, addChartNode() {}, addExternalComponentNode() {}, drawShapeNode() {},
  }
  function Harness() { useSyncExternalStore(h.bridge.subscribe.bind(h.bridge), () => h.bridge.read()); return <SlideLocationWorkspace snapshot={ports.read()} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null}/> }
  try {
    render(<Harness/>); const workspace = screen.getByRole('main', { name: '画布' }), x = 398, y = 246
    fireEvent.pointerDown(workspace, { pointerId: 8, button: 0, clientX: x, clientY: y }); fireEvent.pointerUp(workspace, { pointerId: 8, button: 0, clientX: x, clientY: y })
    const anchor = selectionProbe.bounds!('text')!
    expect(anchor.left).toBeCloseTo(373.82); expect(anchor.top).toBeCloseTo(233.99); expect(anchor.width).toBeCloseTo(48.24); expect(anchor.height).toBeCloseTo(24.09)
    const bar = placeQuickBar(anchor, { left: 235, top: 212.53, right: 980, bottom: 680 }, { width: 201.52, height: 34 }, 8, 34)
    expect(bar.placement).toBe('below'); expect(bar.top).toBeGreaterThan(anchor.top + anchor.height)
    await act(async () => { fireEvent.doubleClick(workspace, { clientX: x, clientY: y }) }); expect(open).toHaveBeenCalledTimes(1)
    expect(h.first.read().undoDepth).toBe(0); expect(h.bridge.read().project).toEqual(project)
  } finally {
    cleanup(); h.bridge.dispose(); if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture); else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture
    if (release) Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', release); else delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})
it('retains invalid Chart property input and refuses to open a different canvas author field', async () => {
  const project = fixture(), source = '// 原文字'
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  project.instances.custom = { id: 'custom', definitionId: 'custom', data: {}, frame: { width: 300, height: 160, transform: [1, 0, 0, 1, 280, 180] } }
  project.surfaces[0].childIds.push('custom')
  const chart = createChartData()
  project.definitions[CHART_DEFINITION.id] = CHART_DEFINITION
  project.instances.chart = { id: 'chart', definitionId: CHART_DEFINITION.id, data: JSON.parse(JSON.stringify(chart)), frame: { width: 320, height: 200, transform: [1, 0, 0, 1, 0, 0] } }
  project.surfaces[0].childIds.push('chart')
  const h = await host(project), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const spot: ComponentAuthorSpot = { id: 'registered-text', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: '原文字',
    sourceRegion: { kind: 'implementation', start: source.indexOf('原文字'), end: source.length }, localBounds: { width: 180, height: 40, transform: [1, 0, 0, 1, 10, 20] } }
  const current = vi.fn(() => spot), captured = kernel.captureTarget()
  const commit = vi.fn(async (candidate: ChartCandidateData) => {
    const data = structuredClone(chart); data.series[0].points[0].value = candidate.series[0].values[0]
    await kernel.edit([{ type: 'data.set', instanceId: 'chart', path: [], value: JSON.parse(JSON.stringify(data)) }]); return null
  })
  try {
    render(<PropertyDraftBoundary bindingKey={JSON.stringify([captured.documentId, captured.epoch, 'chart'])} onStale={() => {}}>
      <ChartProperties bindingKey={JSON.stringify([captured.documentId, captured.epoch, 'chart'])} node={{ id: 'chart', type: 'chart', ...chart }} commands={{ patchTitle() {}, patchType() {}, patchStyle() {}, commitTableData: commit }}/>
    </PropertyDraftBoundary>)
    const input = screen.getByLabelText('系列一 在 甲 的值')
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'not-a-number' } })
    await act(async () => { expect(await slice.beginSlideSpotEdit(spot, captured, current)).toBeNull() })
    expect(input).toHaveValue('not-a-number'); expect(hasPropertiesDrafts(captured.documentId)).toBe(true)
    expect(owned.slideContentEdit).toBeNull(); expect(current).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled()
    expect(h.first.read().undoDepth).toBe(0); expect(h.bridge.read().project).toEqual(project)
    fireEvent.change(input, { target: { value: '21' } })
    await act(async () => {
      const opened = await slice.beginSlideSpotEdit(spot, captured, current)
      expect(opened?.target.project.revision).toBe(1)
      expect(opened?.target.project.instances.chart.data).toMatchObject({ series: [{ points: [{ value: 21 }, { value: 35 }] }] })
    })
    expect(current).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledTimes(1)
    expect(h.first.read().undoDepth).toBe(1)
  } finally { cleanup(); discardPropertiesDrafts(captured.documentId); h.bridge.dispose() }
})
it('commits registered spot drafts once and preserves source frames and replacement resources', async () => {
  const project = fixture(), source = 'export default {mount(){return {update(){},dispose(){}}}}; // 原文字'
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'source', language: 'javascript', source } }
  project.instances.custom = { id: 'custom', definitionId: 'custom', data: { label: '原文字', assetId: 'old' },
    frame: { width: 300, height: 160, transform: [0.9, 0.2, -0.1, 1, 280, 180] } }
  project.surfaces[0].childIds.push('custom')
  const h = await host(project), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  let owned = createInitialSlideOwnedState()
  const slice = createSlideAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  const spot: ComponentAuthorSpot = { id: 'registered-text', instanceId: 'custom', mountGeneration: 1, kind: 'text', initialValue: '原文字',
    sourceRegion: { kind: 'implementation', start: source.indexOf('原文字'), end: source.length },
    localBounds: { width: 180, height: 40, transform: [1, 0, 0, 1, 10, 20] } }
  try {
    expect(await slice.beginSlideSpotEdit(spot)).not.toBeNull()
    slice.updateSlideSpotDraft('局部修订', false)
    const commit = slice.commitSlideContentEdit()
    expect(slice.commitSlideContentEdit()).toBe(commit)
    const saving = slice.commitDraftForPersistence('u4-doc')
    await commit; expect(await saving).toEqual({ ok: true })
    expect(h.first.read().undoDepth).toBe(1)
    expect(h.bridge.read().project!.definitions.custom.implementation).toEqual(project.definitions.custom.implementation)
    expect(h.bridge.read().project!.instances.custom.implementationOverride).toEqual({ kind: 'source', language: 'javascript', source: source.replace('原文字', '局部修订') })
    expect(h.bridge.read().project!.instances.custom.frame).toEqual(project.instances.custom.frame)
    const target = kernel.captureTarget()
    const image: ComponentAuthorSpot = { ...spot, id: 'registered-image', kind: 'image', initialValue: 'old', sourceRegion: undefined, dataPath: ['assetId'] }
    const bytes = new Uint8Array([1, 2, 3])
    await kernel.editCaptured(kernel.capture([{ type: 'asset.add', asset: { id: 'replacement', path: 'assets/replacement.png', mimeType: 'image/png', byteLength: bytes.length }, bytes },
      authorSpotEdit(target.editingProject, image, 'replacement')], target))
    expect(h.first.read().undoDepth).toBe(2)
    expect(h.bridge.read().project!.instances.custom.data).toEqual({ label: '原文字', assetId: 'replacement' })
    expect(h.bridge.read().project!.instances.custom.frame).toEqual(project.instances.custom.frame)
    const reopened = await h.driver.load(await h.driver.serialize(h.first.read().model))
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.resources.assets.replacement).toEqual(bytes)
    expect(reopened.project.instances.custom).toEqual(h.bridge.read().project!.instances.custom)
    await kernel.navigateHistory('undo')
    expect(h.bridge.read().project!.instances.custom.data).toEqual({ label: '原文字', assetId: 'old' })
  } finally { h.bridge.dispose() }
})
it('edits registered HTML text and image attributes with their source encoding', () => {
  const project = fixture(), html = '<p>A &amp; B</p><img src="old&amp;image"><img src=old>'
  project.instances.text.data = { html }
  const spot: ComponentAuthorSpot = { id: 'html-text', instanceId: 'text', mountGeneration: 1, kind: 'text', initialValue: 'A & B',
    sourceRegion: { kind: 'data', path: ['html'], start: html.indexOf('A &amp; B'), end: html.indexOf('</p>'), encoding: 'html-text' },
    localBounds: { width: 100, height: 30, transform: [1, 0, 0, 1, 0, 0] } }
  expect(authorSpotEdit(project, spot, 'C < D & E')).toMatchObject({ type: 'data.set', path: ['html'], value: html.replace('A &amp; B', 'C &lt; D &amp; E') })
  const image: ComponentAuthorSpot = { ...spot, kind: 'image', initialValue: 'old&image',
    sourceRegion: { kind: 'data', path: ['html'], start: html.indexOf('old&amp;image'), end: html.indexOf('old&amp;image') + 'old&amp;image'.length, encoding: 'html-attribute' } }
  expect(authorSpotEdit(project, image, 'new" & image')).toMatchObject({ value: html.replace('old&amp;image', 'new&quot; &amp; image') })
  const unquoted: ComponentAuthorSpot = { ...image, initialValue: 'old', sourceRegion: { ...image.sourceRegion!, start: html.lastIndexOf('old'), end: html.lastIndexOf('old') + 3 } }
  expect(authorSpotEdit(project, unquoted, 'new image=1')).toMatchObject({ value: html.replace('src=old', 'src=new&#32;image&#61;1') })
})
it('replaces an HTML spot image through a managed resource binding and reopens it', async () => {
  const project = fixture(), html = '<img src="old.png">'
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html }, frame: { width: 300, height: 200, transform: [1, 0.15, -0.1, 1, 280, 190] } }
  project.surfaces[0].childIds.push('web')
  const h = await host(project), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  const spot: ComponentAuthorSpot = { id: 'registered-html-image', instanceId: 'web', mountGeneration: 1, kind: 'image', initialValue: 'old.png',
    sourceRegion: { kind: 'data', path: ['html'], start: html.indexOf('old.png'), end: html.indexOf('old.png') + 7, encoding: 'html-attribute' },
    localBounds: { width: 80, height: 50, transform: [1, 0, 0, 1, 0, 0] } }
  try {
    const target = kernel.captureTarget(), bytes = new Uint8Array([1, 2, 3])
    await kernel.editCaptured(kernel.capture(authorSpotImageEdits(target.editingProject, spot, { meta: { id: 'new-image', path: 'assets/new-image.png', mimeType: 'image/png' }, bytes }), target))
    const current = h.bridge.read().project!, data = current.instances.web.data as { html: string; resourceBindings: Record<string, string> }
    const token = Object.keys(data.resourceBindings)[0]
    expect(token).toMatch(/^cw-resource:spot-[a-zA-Z0-9_.-]+$/)
    expect(data.resourceBindings[token]).toBe('new-image')
    expect(data.html).toBe('<img src="' + token + '">')
    const runtime = resolveWebResourceBindings(current.instances.web, id => id === 'new-image' ? 'blob:replacement-image' : undefined)
    expect((runtime.data as { html: string }).html).toContain('src="blob:replacement-image"')
    expect(current.instances.web.frame).toEqual(project.instances.web.frame)
    expect(h.first.read().undoDepth).toBe(1)
    const reopened = await h.driver.load(await h.driver.serialize(h.first.read().model))
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.project.instances.web.data).toEqual(data)
    expect(reopened.resources.assets['new-image']).toEqual(bytes)
    await kernel.navigateHistory('undo')
    expect(h.bridge.read().project!.instances.web.data).toEqual({ html })
  } finally { h.bridge.dispose() }
})
it('keeps original Slide interactions on the V10 writer', async () => {
  const h = await host(), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  let owned = createInitialSlideOwnedState(), mode: 'edit' | 'run' = 'edit', uiVersion = 0
  const uiListeners = new Set<() => void>(), update = () => { uiVersion++; uiListeners.forEach(listener => listener()) }
  const slice = createSlideAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch }; update() } })
  const observation = { current: null as { readZoom(): number; setZoom(value: number): void; reset(): void } | null }
  const releaseObservation = vi.fn(), navigationChanged = vi.fn(), drawShapeNode = vi.fn()
  const stopBridge = h.bridge.subscribe(update)
  const pointer = class extends MouseEvent { pointerId: number; constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
  vi.stubGlobal('PointerEvent', pointer)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const rect = { x: 20, y: 40, left: 20, top: 40, right: 1940, bottom: 1320, width: 1920, height: 1280, toJSON() {} }
  // jsdom's Range lacks selection geometry used by ProseMirror's scheduled scroll.
  const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }) })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this.classList.contains('canvas-stage-stack') ? rect : { ...rect, width: 960, height: 640 } })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value() {} })
  const ports: SlideWorkspacePorts = {
    read: () => { const v = h.bridge.read(); return { project: v.editingProject, documentId: v.activeDocumentId, surfaceId: v.surfaceId,
      selectedInstanceIds: v.selectedInstanceIds, activation: v.activation, activeStateId: v.activeStateId, assetUrls: {},
      canvasMode: mode, contentEdit: owned.slideContentEdit, drawTool: owned.slideDrawTool } },
    registerObservation: (id, binding) => { expect(id).toBe('slide'); observation.current = binding; return () => { observation.current = null; releaseObservation() } },
    navigationChanged,
    capture: () => kernel.captureTarget(), commit: (edits, target, group) => kernel.editCaptured(kernel.capture(edits, target), group),
    edit: (edits, group) => kernel.edit(edits, group), select: ids => kernel.selectInstances(ids), selectSurface: id => kernel.selectSurface(id),
    setCanvasMode: value => { mode = value; update() }, setDrawTool: tool => { owned = { ...owned, slideDrawTool: tool }; update() }, report() {},
    paste() {}, selectAll: () => kernel.selectInstances(['text', 'shape']), beginTextEdit: slice.beginSlideDataEdit,
    updateDataDraft: slice.updateSlideDataDraft, commitTextEdit: slice.commitSlideContentEdit, cancelTextEdit: slice.cancelTextEdit,
    undo: () => { void kernel.navigateHistory('undo') }, redo: () => { void kernel.navigateHistory('redo') },
    onElement() {}, onTargetElement() {}, addTextNode() {}, addFormulaNode() {}, addRectangleNode() {}, addShapeNode() {},
    addTableNode() {}, addChartNode() {}, addExternalComponentNode() {}, drawShapeNode,
  }
  function Harness() {
    useSyncExternalStore(listener => { uiListeners.add(listener); return () => { uiListeners.delete(listener) } }, () => uiVersion)
    return <SlideLocationWorkspace snapshot={ports.read()} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null} />
  }
  try {
    render(<Harness />)
    expect(screen.getByRole('group', { name: '画布视图' })).toBeVisible()
    expect(screen.getByRole('button', { name: '适合窗口' })).toBeVisible()
    expect(observation.current!.readZoom()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '放大画布' }))
    expect(observation.current!.readZoom()).toBeCloseTo(1.1)
    act(() => observation.current!.setZoom(3))
    expect(observation.current!.readZoom()).toBe(2)
    act(() => observation.current!.reset())
    expect(observation.current!.readZoom()).toBe(1)
    expect(navigationChanged).toHaveBeenCalled()
    const workspace = screen.getByRole('main', { name: '画布' })
    const beforeDrawing = structuredClone(h.bridge.read().project)
    act(() => ports.setDrawTool('line'))
    expect(workspace).toHaveStyle({ cursor: 'crosshair' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(owned.slideDrawTool).toBeNull()
    expect(workspace.style.cursor).toBe('')
    act(() => ports.setDrawTool('elbow-arrow'))
    fireEvent.pointerDown(workspace, { pointerId: 9, button: 0, clientX: 1820, clientY: 1100 })
    fireEvent.pointerMove(workspace, { pointerId: 9, buttons: 1, clientX: 1760, clientY: 1060 })
    expect(document.querySelector('.canvas-line-overlay line[stroke-dasharray="6 4"]')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(owned.slideDrawTool).toBeNull()
    expect(document.querySelector('.canvas-line-overlay line[stroke-dasharray="6 4"]')).toBeNull()
    fireEvent.pointerUp(workspace, { pointerId: 9, button: 0, clientX: 1760, clientY: 1060 })
    expect(drawShapeNode).not.toHaveBeenCalled()
    expect(h.first.read().undoDepth).toBe(0)
    expect(h.bridge.read().project).toEqual(beforeDrawing)
    const beforeNeighbor = structuredClone(h.bridge.read().project!.instances.shape)
    fireEvent.pointerDown(workspace, { pointerId: 1, button: 0, clientX: 260, clientY: 200 })
    fireEvent.pointerMove(workspace, { pointerId: 1, buttons: 1, clientX: 300, clientY: 240, altKey: true })
    expect(h.first.read().undoDepth).toBe(0)
    expect(document.querySelector('[data-component-instance="text"]')).toHaveStyle({ transform: 'matrix(1,0,0,1,120,80)' })
    fireEvent.pointerUp(workspace, { pointerId: 1, button: 0, clientX: 300, clientY: 240, altKey: true })
    await waitFor(() => expect(h.first.read().undoDepth).toBe(1))
    expect(h.bridge.read().project!.instances.text.frame!.transform[4]).toBeCloseTo(120, 8)
    expect(h.bridge.read().project!.instances.text.frame!.transform[5]).toBeCloseTo(80, 8)
    expect(h.bridge.read().project!.instances.shape).toEqual(beforeNeighbor)
    await act(async () => { await kernel.navigateHistory('undo') })
    expect(h.bridge.read().project!.instances.text.frame!.transform).toEqual([1, 0, 0, 1, 100, 60])
    fireEvent.contextMenu(workspace, { clientX: 1820, clientY: 1100 })
    expect(screen.getByRole('menuitem', { name: '在此插入文字' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.doubleClick(workspace, { clientX: 260, clientY: 200 })
    await waitFor(() => expect(document.querySelector('[data-component-professional-editor] .ProseMirror')).not.toBeNull())
    const rich = document.querySelector<HTMLElement>('[data-component-professional-editor] .ProseMirror')!
    fireEvent.compositionStart(rich)
    expect(owned.slideContentEdit?.composing).toBe(true)
    await expect(slice.commitSlideContentEdit()).rejects.toThrow('请先完成正在输入的文字')
    fireEvent.compositionEnd(rich)
    await act(async () => { await Promise.resolve(); slice.updateSlideDataDraft(createTextData('人工修订'), false); await slice.commitSlideContentEdit() })
    expect(h.first.read().undoDepth).toBe(1)
    const current = h.bridge.read().project!
    expect(current.instances.text.data).toMatchObject({ content: { inlines: [{ type: 'text', text: '人工修订' }] } })
    expect(current.instances.text.frame).toEqual(fixture().instances.text.frame)
    const bytes = await h.driver.serialize(h.first.read().model)
    const reopened = await h.driver.load(bytes)
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.project.instances).toEqual(current.instances)
    fireEvent.click(screen.getByRole('button', { name: '当前位置试运行' }))
    expect(document.querySelector('.canvas-stage-stack')).toHaveStyle({ visibility: 'visible' })
    expect(document.querySelector('[data-component-instance="text"]')).toBeVisible()
  } finally {
    cleanup(); expect(observation.current).toBeNull(); expect(releaseObservation).toHaveBeenCalled(); stopBridge(); h.bridge.dispose()
    // Drain the editor's already scheduled selection observer before removing DOM shims.
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 25)) })
    if (rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBounds)
    else delete (Range.prototype as Partial<Range>).getBoundingClientRect
    if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
    else delete (Range.prototype as Partial<Range>).getClientRects
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})

it('waits for the property draft ACK before selecting the neighbor from the same pointer gesture', async () => {
  const h = await host(), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  let owned = createInitialSlideOwnedState(), uiVersion = 0
  const listeners = new Set<() => void>(), update = () => { uiVersion++; listeners.forEach(listener => listener()) }
  const slice = createSlideAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch }; update() } })
  const stopBridge = h.bridge.subscribe(update), events: string[] = [], report = vi.fn()
  let acknowledge!: () => void
  const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve })
  const execute = h.first.execute.bind(h.first)
  const dispatch = vi.spyOn(h.first, 'execute').mockImplementation(async operation => {
    const receipt = await execute(operation)
    await acknowledgement
    return receipt
  })
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 }
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const rect = { x: 20, y: 40, left: 20, top: 40, right: 1940, bottom: 1320, width: 1920, height: 1280, toJSON() {} }
  const rangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
  const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
  const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
  const release = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture')
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }) })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this.classList.contains('canvas-stage-stack') ? rect : { ...rect, width: 960, height: 640 } })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value() {} })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value() {} })
  const ports: SlideWorkspacePorts = {
    read: () => { const v = h.bridge.read(); return { project: v.editingProject, documentId: v.activeDocumentId, surfaceId: v.surfaceId,
      selectedInstanceIds: v.selectedInstanceIds, activation: v.activation, activeStateId: v.activeStateId, assetUrls: {},
      canvasMode: 'edit', contentEdit: owned.slideContentEdit, drawTool: owned.slideDrawTool } },
    capture: () => kernel.captureTarget(), commit: (edits, target, group) => kernel.editCaptured(kernel.capture(edits, target), group),
    edit: (edits, group) => kernel.edit(edits, group),
    select: ids => { events.push('select'); kernel.selectInstances(ids) }, selectSurface: id => kernel.selectSurface(id),
    setCanvasMode() {}, setDrawTool() {}, report, paste() {}, selectAll() {}, beginTextEdit: slice.beginSlideDataEdit,
    updateDataDraft: slice.updateSlideDataDraft,
    commitTextEdit: () => { events.push('commit'); return slice.commitSlideContentEdit() }, cancelTextEdit: slice.cancelTextEdit,
    undo() {}, redo() {}, onElement() {}, onTargetElement() {}, addTextNode() {}, addFormulaNode() {}, addRectangleNode() {}, addShapeNode() {},
    addTableNode() {}, addChartNode() {}, addExternalComponentNode() {}, drawShapeNode() {},
  }
  function Harness() {
    useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => uiVersion)
    const snapshot = ports.read(), data = textComponentDataSchema.parse(owned.slideContentEdit?.data ?? snapshot.project!.instances.text.data)
    const value = data.content.inlines.map(inline => inline.type === 'text' ? inline.text : '\uFFFC').join('')
    return <>
      {snapshot.selectedInstanceIds.includes('text') && <section className="property-section"><TextContentTextarea label="文字内容" value={value}
        onBegin={() => { slice.beginSlideDataEdit('text', 'properties') }}
        onChange={next => { slice.updateSlideDataDraft(createTextData(next)) }}
        onCommit={() => { events.push('property-blur'); void slice.commitSlideContentEdit() }}
        onCancel={slice.cancelTextEdit}/></section>}
      <SlideLocationWorkspace snapshot={snapshot} ports={ports} onAddImage={() => {}} onAddVideo={() => {}} onSelectImageAsset={async () => null}/>
    </>
  }
  try {
    kernel.selectInstances(['text'])
    const neighbor = structuredClone(h.bridge.read().project!.instances.shape)
    render(<Harness/>)
    const input = screen.getByLabelText('文字内容')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: '同次点击保留输入' } })
    expect(owned.slideContentEdit?.source).toBe('properties')
    expect(input).toHaveFocus()
    const workspace = screen.getByRole('main', { name: '画布' })
    const frame = neighbor.frame!, clientX = rect.left + 2 * (frame.transform[4] + frame.width / 2), clientY = rect.top + 2 * (frame.transform[5] + frame.height / 2)
    const down = new PointerEvent('pointerdown', { pointerId: 7, button: 0, clientX, clientY, bubbles: true, cancelable: true })
    fireEvent(workspace, down)
    // A non-cancelled pointerdown permits the browser mousedown to blur the field.
    if (!down.defaultPrevented) act(() => input.blur())
    fireEvent.pointerUp(workspace, { pointerId: 7, button: 0, clientX, clientY })
    expect(events).toEqual(['property-blur', 'commit'])
    expect(h.bridge.read().selectedInstanceIds).toEqual(['text'])
    expect(screen.getByLabelText('文字内容')).toBe(input)
    expect(owned.slideContentEdit).not.toBeNull()
    acknowledge()
    await waitFor(() => expect(h.bridge.read().selectedInstanceIds).toEqual(['shape']))
    expect(owned.slideContentEdit).toBeNull()
    expect(events).toEqual(['property-blur', 'commit', 'select'])
    expect(screen.queryByLabelText('文字内容')).toBeNull()
    expect(h.first.read().undoDepth).toBe(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(h.bridge.read().project!.instances.text.data).toMatchObject({ content: { inlines: [{ type: 'text', text: '同次点击保留输入' }] } })
    expect(h.bridge.read().project!.instances.shape).toEqual(neighbor)
    expect(h.bridge.read().selectedInstanceIds).toEqual(['shape'])
    expect(report).not.toHaveBeenCalled()
  } finally {
    acknowledge(); cleanup(); stopBridge(); h.bridge.dispose()
    await act(async () => { await new Promise(resolve => window.setTimeout(resolve, 25)) })
    if (rangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', rangeBounds)
    else delete (Range.prototype as Partial<Range>).getBoundingClientRect
    if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
    else delete (Range.prototype as Partial<Range>).getClientRects
    if (capture) Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', capture)
    else delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture
    if (release) Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', release)
    else delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture
    vi.restoreAllMocks(); vi.unstubAllGlobals()
  }
})

it('reframes a Slide line endpoint in affine space as one undoable saved edit', async () => {
  const project = fixture()
  project.instances.shape.data = { ...defaultShapeData('line'), lineGeometry: { kind: 'straight', start: [0, 0.5], end: [1, 0.5] } }
  project.instances.shape.frame!.transform = [0.8, 0.3, -0.2, 1.1, 500, 300]
  const h = await host(project), kernel = createEditorStoreKernel({ bridge: h.bridge, commit() {} })
  try {
    const target = freeSurfaceTargets(project, 'slide').find(value => value.instanceId === 'shape')!
    const geometry = { kind: 'straight' as const, start: [0, 0.5] as [number, number], end: [1, 0.5] as [number, number] }
    const matrix = frameToSpaceMatrix(target.frame, target.parentToSurface)
    const opposite = transformPoint(matrix, { x: target.frame.width, y: target.frame.height / 2 })
    const desired = transformPoint(matrix, { x: -80, y: -40 })
    const proposal = proposeSlideLineHandle(target, geometry, 'start', desired)!
    const points = resolveNativeLinePoints(proposal.geometry, proposal.frame.width, proposal.frame.height)
    const nextMatrix = frameToSpaceMatrix(proposal.frame, target.parentToSurface)
    const moved = transformPoint(nextMatrix, points[0]), kept = transformPoint(nextMatrix, points.at(-1)!)
    expect(moved.x).toBeCloseTo(desired.x); expect(moved.y).toBeCloseTo(desired.y)
    expect(kept.x).toBeCloseTo(opposite.x); expect(kept.y).toBeCloseTo(opposite.y)
    expect(proposal.frame.transform.slice(0, 4)).toEqual(target.frame.transform.slice(0, 4))
    const captured = kernel.captureTarget()
    await kernel.editCaptured(kernel.capture([{ type: 'frame.set', instanceId: 'shape', frame: proposal.frame },
      { type: 'data.set', instanceId: 'shape', path: ['lineGeometry'], value: proposal.geometry }], captured))
    expect(h.first.read().undoDepth).toBe(1)
    expect(h.bridge.read().project!.instances.text).toEqual(project.instances.text)
    const reopened = await h.driver.load(await h.driver.serialize(h.first.read().model))
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.project.instances.shape.frame).toEqual(proposal.frame)
    expect(reopened.project.instances.shape.data).toMatchObject({ lineGeometry: proposal.geometry })
    await kernel.navigateHistory('undo')
    expect(h.bridge.read().project!.instances.shape).toEqual(project.instances.shape)
  } finally { h.bridge.dispose() }
})



