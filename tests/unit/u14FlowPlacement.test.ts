import { expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { DOCUMENT_BLOCK_DEFINITION, documentBlockData } from '../../src/components/document-block'
import { createTextComponentData } from '../../src/components/text/data'
import { flowDocumentInsertionAt, flowFloatingModeEdits } from '../../src/renderer/ui/flow/flowParagraphLayout'
import { flowPlacementEdits, flowReadingMembers, flowReadingOrderEdits } from '../../src/core/course/courseFlowEdits'
import { insertFlowMenu, resolveFlowMenuInsertionOptions, FLOW_DOCUMENT_INSERT_COMMANDS } from '../../src/renderer/ui/flow/flowInsertCommands'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import { flowDocumentBlock } from '../../src/core/components/document/flowDocumentProjection'
import { useMediaImport, type MediaImportPorts } from '../../src/renderer/app/useMediaImport'
import { flowParagraphAnchoredFrame } from '../../src/shared/flowParagraphAnchors'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import type { CapturedFlowMenuTarget } from '../../src/renderer/ui/flow/flowInsertCommands'

const probe = vi.hoisted(() => ({ state: {} as Record<string, unknown>, runtime: {} as Record<string, unknown> }))
vi.mock('../../src/renderer/store/editorStore', () => ({ useEditorStore: (select: (state: typeof probe.state) => unknown) => select(probe.state) }))
vi.mock('../../src/renderer/components/CourseV10RuntimeView', () => ({ useCourseV10Runtime: () => probe.runtime }))
vi.mock('../../src/renderer/ui/useAssetObjectUrls', () => ({ useAssetObjectUrls: () => ({}) }))
vi.mock('../../src/renderer/workbench/NativeSelectionContext', () => ({ NativeSelectionContext: () => null }))
vi.mock('../../src/renderer/project/assetManager', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), readImageDimensions: async () => ({ width: 480, height: 240 }),
}))
import { FlowWorkspace } from '../../src/renderer/ui/FlowWorkspace'

function lesson() {
  const project = createBlankCourseProjectV10('长章节')
  project.definitions = { [TEXT_DEFINITION.id]: TEXT_DEFINITION, [DOCUMENT_BLOCK_DEFINITION.id]: DOCUMENT_BLOCK_DEFINITION,
    behavior: { id: 'behavior', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.interaction' } } }
  const text = (id: string) => ({ id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(id))) })
  project.instances = { a: text('a'), b: text('b'), c: text('c'), d: text('d'),
    float: { ...text('float'), flowPlacement: { space: 'paper', plane: 'overlay' }, frame: { width: 100, height: 40, transform: [1, 0, 0, 1, 50, 140] } },
    behavior: { id: 'behavior', definitionId: 'behavior', data: {} },
    section: { id: 'section', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: documentBlockData({ id: 'section', type: 'section', title: { inlines: [] }, collapsedByDefault: false, blocks: [] }), childIds: ['c', 'd'] } }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['a', 'float', 'behavior', 'b', 'section'] }]
  project.global = { underlay: [], overlay: [] }
  return project
}

it('moves between reading neighbors across floating and behavior roots and keeps a serialized formal result', () => {
  const original = lesson(), container = { kind: 'surface' as const, surfaceId: 'flow' }
  expect(flowReadingMembers(original, container)).toEqual(['a', 'b', 'section'])
  const next = applyComponentOperation(original, captureComponentOperation(original, flowReadingOrderEdits(original, 'a', 'down')))
  expect(flowReadingMembers(next, container)).toEqual(['b', 'a', 'section'])
  expect(next.instances.float).toEqual(original.instances.float)
  expect(next.instances.behavior).toEqual(original.instances.behavior)
  const restored = applyComponentOperation(next, captureComponentOperation(next, flowReadingOrderEdits(next, 'a', 'up')))
  expect(flowReadingMembers(restored, container)).toEqual(['a', 'b', 'section'])
  const driver = new CourseV10Driver(), model = { kind: 'course-v10' as const, project: next, resources: { assets: {}, components: {} } }
  expect(driver.load(driver.serialize(model))).toEqual(model)
})

it('moves a nested body object without a prior frame to the overlay with its supplied destination frame', () => {
  const original = lesson()
  original.instances.section.frame = { width: 600, height: 400, transform: [1, 0, 0, 1, 100, 200] }
  const frame = { width: 320, height: 180, transform: [1, 0, 0, 1, 20, 30] as [number, number, number, number, number, number] }
  const edits = flowPlacementEdits(original, 'c', { kind: 'overlay', surfaceId: 'flow', placement: { space: 'paper', plane: 'overlay' }, frame })
  const next = applyComponentOperation(original, captureComponentOperation(original, edits))
  expect(next.instances.c).toEqual({ ...original.instances.c, frame, flowPlacement: { space: 'paper', plane: 'overlay' } })
  expect(next.instances.section.childIds).toEqual(['d'])
  expect(next.surfaces[0].childIds).toEqual([...original.surfaces[0].childIds, 'c'])
  expect(next.instances.d).toEqual(original.instances.d)
})

it('captures a section drop and menu insertion in the real container instead of the old top-level selection', () => {
  const project = lesson(), paper = document.createElement('article')
  paper.innerHTML = '<div data-flow-block-id="a"></div><div data-flow-block-id="section"><div data-flow-block-id="c"></div><div data-flow-block-id="d"></div></div>'
  const rect = (id: string, y: number, height: number) => { paper.querySelector<HTMLElement>(`[data-flow-block-id="${id}"]`)!.getBoundingClientRect = () => new DOMRect(20, y, 600, height) }
  rect('a', 0, 30); rect('section', 100, 1000); rect('c', 150, 50); rect('d', 300, 50)
  expect(flowDocumentInsertionAt(paper, project, 'flow', { x: 30, y: 155 })).toEqual({ container: { kind: 'instance', instanceId: 'section' }, index: 0, afterBlockId: null })
  expect(flowDocumentInsertionAt(paper, project, 'flow', { x: 30, y: 280 })).toEqual({ container: { kind: 'instance', instanceId: 'section' }, index: 1, afterBlockId: 'c' })
  const target: CapturedFlowMenuTarget = { project, editingProject: project, documentId: 'document', epoch: 'epoch', surfaceId: 'flow', activeStateId: null, resources: { assets: {}, components: {} }, instanceId: 'a', instanceIds: ['a'],
    flowMenuPage: { ok: true, documentId: 'document', projectId: project.id, revision: 0, locationId: 'flow', surfaceId: 'flow', generation: 1, selectedBlockId: 'c', selectionSignature: '', paperWidth: 800, bodyWidth: 728,
      paragraphRects: [{ blockId: 'c', depth: 1, x: 36, y: 150, width: 728, height: 50 }] } }
  expect(resolveFlowMenuInsertionOptions(target, { destination: 'document', kind: 'table', label: '表格' })).toMatchObject({ container: { kind: 'instance', instanceId: 'section' }, index: 1 })
  expect(resolveFlowMenuInsertionOptions(target, { destination: 'paper', kind: 'shape', label: '形状' })).toMatchObject({ x: 36, y: 216 })
  expect(resolveFlowMenuInsertionOptions(target, { destination: 'paper', kind: 'image', label: '图片' })).not.toHaveProperty('height')
  expect(FLOW_DOCUMENT_INSERT_COMMANDS.map(value => value.kind)).toEqual(expect.arrayContaining(['paragraph', 'quote', 'code', 'table', 'section']))
})

it('keeps the displayed position when switching fixed, paragraph and viewport modes and clears stale anchors', () => {
  const project = lesson(), instance = project.instances.float
  const rects = [{ blockId: 'a', depth: 0, x: 36, y: 100, width: 728, height: 30 }]
  const apply = (edits: ReturnType<typeof flowFloatingModeEdits>) => applyComponentOperation(project, captureComponentOperation(project, edits)).instances.float
  const anchored = apply(flowFloatingModeEdits('float', instance.frame!, instance.flowPlacement!, 'paragraph', 800, rects, { x: 80, y: -900 }))
  expect(anchored.flowPlacement!.paragraphAnchor).toEqual({ blockId: 'a', offsetY: 40, xRatio: 50 / 800 })
  const shown = flowParagraphAnchoredFrame(anchored.flowPlacement!.paragraphAnchor!, { x: 50, y: 140, width: 100, height: 40 }, 800, [{ ...rects[0], y: 200 }])!
  const displayed = { ...anchored.frame!, transform: [1, 0, 0, 1, shown.x, shown.y] as [number, number, number, number, number, number] }
  const fixed = apply(flowFloatingModeEdits('float', displayed, anchored.flowPlacement!, 'fixed', 800, rects, { x: 80, y: -900 }))
  expect(fixed.frame!.transform).toEqual([1, 0, 0, 1, 50, 240]); expect(fixed.flowPlacement).toEqual({ space: 'paper', plane: 'overlay' })
  const viewport = apply(flowFloatingModeEdits('float', fixed.frame!, fixed.flowPlacement!, 'viewport', 800, rects, { x: 80, y: -900 }))
  expect(viewport.frame!.transform).toEqual([1, 0, 0, 1, 130, -660]); expect(viewport.flowPlacement).toEqual({ space: 'viewport', plane: 'overlay' })
  const paper = apply(flowFloatingModeEdits('float', viewport.frame!, viewport.flowPlacement!, 'fixed', 800, rects, { x: 80, y: -900 }))
  expect(paper.frame).toEqual(fixed.frame)
})

it('uses the shared paragraph factory and retains the professional table adapter through the actual Flow menu', async () => {
  let project = lesson()
  const target = { project, editingProject: project, resources: { assets: {}, components: {} }, documentId: 'flow-u13', epoch: 'epoch', surfaceId: 'flow', instanceId: 'c', instanceIds: ['c'], activeStateId: null }
  const kernel = { capture: (edits: Parameters<typeof captureComponentOperation>[1]) => captureComponentOperation(project, edits),
    editCaptured: async (operation: Parameters<typeof applyComponentOperation>[1]) => { project = applyComponentOperation(project, operation) }, selectInstances: () => {} } as unknown as EditorStoreKernel
  const paragraph = await insertFlowMenu(kernel, target, { destination: 'document', kind: 'paragraph', label: '正文' }, { text: '正文内容', container: { kind: 'instance', instanceId: 'section' }, index: 1 })
  expect(project.instances[paragraph.instanceIds[0]].definitionId).toBe(TEXT_DEFINITION.id)
  expect(flowDocumentBlock(project, 'flow', paragraph.instanceIds[0])).toMatchObject({ type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文内容' }] } })
  const table = await insertFlowMenu(kernel, { ...target, project, editingProject: project }, { destination: 'document', kind: 'table', label: '表格' }, { container: { kind: 'instance', instanceId: 'section' }, index: 2 })
  expect(project.instances[table.instanceIds[0]].definitionId).toBe(TABLE_DEFINITION.id)
  expect(flowDocumentBlock(project, 'flow', table.instanceIds[0])).toMatchObject({ type: 'table', columns: expect.any(Array), rows: expect.any(Array) })
  expect(project.instances.section.childIds!.slice(1, 3)).toEqual([paragraph.instanceIds[0], table.instanceIds[0]])
})

it('uses the actual Flow floating toolbar without turning a fixed drag into paragraph anchoring and resets the current scroll', async () => {
  const project = lesson(), resources = { assets: {}, components: {} }
  const target = { project, editingProject: project, resources, documentId: 'flow-u14', epoch: 'epoch', surfaceId: 'flow', instanceId: 'float', instanceIds: ['float'], activeStateId: null }
  const capture = vi.fn((edits: unknown) => ({ edits })), editCaptured = vi.fn(async () => {})
  const bridge = { captureTarget: () => target, capture, editCaptured, read: () => ({ activation: 1 }) }
  let observation: { reset(): void } | undefined
  probe.state = { courseBridge: bridge, courseKernel: bridge, flowDocumentDrafts: {}, setFlowDocumentDraft: () => {}, setFlowContextSelection: () => {}, flowEditingInstance: null, slideContentEdit: null }
  probe.runtime = { resources, selectedInstanceIds: ['float'], selectInstances: () => {}, onElement: () => {}, onTargetElement: () => {}, world: { beforeProjectionMutation: () => {}, afterProjectionMutation: () => {} }, renderInstance: () => null,
    navigation: { changed: () => {} }, registerObservation: (_id: string, binding: { reset(): void }) => { observation = binding; return () => {} } }
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.dataset.testid === 'flow-paper' ? new DOMRect(80, -600, 800, 1200) : new DOMRect(0, 0, 800, 600)
  })
  let ui: ReturnType<typeof render> | undefined
  try {
    ui = render(createElement(FlowWorkspace, { documentId: 'flow-u14', project, surfaceId: 'flow', onSelectImageAsset: async () => null }))
    const move = ui.getByRole('button', { name: '移动' })
    move.setPointerCapture = () => {}
    fireEvent.pointerDown(move, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(move, { pointerId: 1, clientX: 130, clientY: 150 })
    await act(async () => fireEvent.pointerUp(move, { pointerId: 1, clientX: 130, clientY: 150 }))
    expect(capture.mock.calls.at(-1)![0]).toEqual([{ type: 'frame.set', instanceId: 'float', frame: { width: 100, height: 40, transform: [1, 0, 0, 1, 80, 190] } }])
    await act(async () => fireEvent.change(ui!.getByLabelText('浮层定位模式'), { target: { value: 'viewport' } }))
    expect(capture.mock.calls.at(-1)![0]).toEqual([
      { type: 'frame.set', instanceId: 'float', frame: { width: 100, height: 40, transform: [1, 0, 0, 1, 130, -460] } },
      { type: 'instance.flowPlacement.set', instanceId: 'float', flowPlacement: { space: 'viewport', plane: 'overlay' } },
    ])
    await act(async () => fireEvent.click(ui!.getByRole('button', { name: '移到正文下方' })))
    expect(capture.mock.calls.at(-1)![0]).toEqual([
      { type: 'instance.flowPlacement.set', instanceId: 'float', flowPlacement: { space: 'paper', plane: 'underlay' } },
    ])
    await act(async () => fireEvent.click(ui!.getByRole('button', { name: '转为正文' })))
    expect(capture.mock.calls.at(-1)![0]).toEqual([{ type: 'instance.flowPlacement.set', instanceId: 'float', flowPlacement: null }])
    const scroller = ui.getByTestId('flow-workspace-scroll'); scroller.scrollTop = 700; scroller.scrollLeft = 20
    act(() => observation!.reset())
    expect(scroller.scrollTop).toBe(0); expect(scroller.scrollLeft).toBe(0)
  } finally { ui?.unmount(); rect.mockRestore(); vi.unstubAllGlobals() }
})

it('passes a chapter-start workspace media drop through the normal importer and formal insertion owner', async () => {
  let project = lesson()
  const captured = { project, editingProject: project, resources: { assets: {}, components: {} }, documentId: 'drop-u14', epoch: 'epoch', surfaceId: 'flow', instanceId: 'a', instanceIds: ['a'], activeStateId: null }
  const kernel = { capture: (edits: Parameters<typeof captureComponentOperation>[1]) => captureComponentOperation(project, edits),
    editCaptured: async (operation: Parameters<typeof applyComponentOperation>[1]) => { project = applyComponentOperation(project, operation) }, selectInstances: () => {} } as unknown as EditorStoreKernel
  const ports = { kernel, selectImage: async () => null, selectImages: async () => null, selectAudios: async () => null, selectVideos: async () => null,
    runBusy: async (operation: () => Promise<unknown>) => operation(), commitStatus: () => {}, reportError: () => {} } as MediaImportPorts
  const hook = renderHook(() => useMediaImport(ports))
  try {
    const result = await hook.result.current.importWorkspaceMedia({ items: [{ workspaceId: 'workspace', entryId: 'image', name: 'chapter.png', mimeType: 'image/png', bytes: new Uint8Array([1]), mediaKind: 'image' }],
      placement: { surface: 'flow', container: { kind: 'instance', instanceId: 'section' }, index: 0, afterBlockId: null },
      target: { captured, documentId: captured.documentId, projectId: project.id, revision: project.revision, locationId: 'flow', surfaceId: 'flow', sessionGeneration: 1 } })
    expect(result.ok).toBe(true)
    const inserted = project.instances.section.childIds![0]
    expect(flowDocumentBlock(project, 'flow', inserted)).toMatchObject({ type: 'media', mediaKind: 'image' })
    expect(project.instances.section.childIds!.slice(1)).toEqual(['c', 'd'])
    expect(project.surfaces[0].childIds).toEqual(['a', 'float', 'behavior', 'b', 'section'])
  } finally { hook.unmount() }
})
