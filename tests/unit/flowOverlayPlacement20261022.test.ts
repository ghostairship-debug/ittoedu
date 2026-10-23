import { afterEach, expect, it, vi } from 'vitest'
import { flowFrameFromClientElement } from '../../src/renderer/ui/flow/flowOverlayPlacement'
import { captureFlowBlockFrame, registerFlowMenuCapture } from '../../src/renderer/document/flowWorkspaceRegistry'
import { createFlowAuthoringSlice, createInitialFlowOwnedState } from '../../src/renderer/store/slices/flowAuthoringSlice'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createComponentContainerInstance, type ComponentFrame } from '../../src/shared/contracts/component-platform'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createChartData } from '../../src/components/chart/data'
import { createFormulaComponentData, createTextComponentData } from '../../src/components/text/data'
import type { EditorStoreKernel } from '../../src/renderer/store/editorStoreKernel'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'

const stops: (() => void)[] = []
afterEach(() => { stops.splice(0).forEach(stop => stop()); document.body.replaceChildren(); vi.restoreAllMocks() })

it('removes observation zoom and scroll while retaining the actual local affine presentation', () => {
  const paper = document.createElement('article'), content = document.createElement('div')
  document.body.append(paper); paper.append(content)
  paper.style.transform = 'matrix(0.8,0,0,0.8,0,0)'
  content.style.transform = 'matrix(0.5,0.1,-0.2,0.7,0,0)'
  Object.defineProperties(paper, { offsetWidth: { value: 1000 }, offsetHeight: { value: 2000 } })
  Object.defineProperties(content, { offsetWidth: { value: 600 }, offsetHeight: { value: 300 } })
  paper.getBoundingClientRect = () => new DOMRect(80, -600, 800, 1600)
  content.getBoundingClientRect = () => new DOMRect(112, 600, 288, 216)
  const frame = flowFrameFromClientElement(content, paper)!
  expect(frame.width).toBe(600); expect(frame.height).toBe(300)
  ;[0.5, 0.1, -0.2, 0.7, 100, 1500].forEach((value, i) => expect(frame.transform[i]).toBeCloseTo(value))
})

it('retains the chart design canvas and its actual SVG fit instead of redrawing it at the reading viewport size', () => {
  const paper = document.createElement('article'), content = document.createElement('div')
  document.body.append(paper); paper.append(content)
  content.innerHTML = '<div data-component-runtime-root="chart"><svg data-native-chart-id="chart" viewBox="0 0 600 300"></svg></div>'
  Object.defineProperties(paper, { offsetWidth: { value: 1000 }, offsetHeight: { value: 2000 } })
  Object.defineProperties(content, { offsetWidth: { value: 854 }, offsetHeight: { value: 520 } })
  paper.getBoundingClientRect = () => new DOMRect(16, 90, 1000, 2000)
  content.getBoundingClientRect = () => new DOMRect(53, 119, 854, 520)
  const svg = content.querySelector('svg')!
  Object.defineProperty(svg, 'viewBox', { value: { baseVal: { x: 0, y: 0, width: 600, height: 300 } } })
  Object.defineProperty(svg, 'getScreenCTM', { value: () => ({ a: 854 / 600, b: 0, c: 0, d: 854 / 600, e: 53, f: 165.5 }) })
  const frame = flowFrameFromClientElement(content, paper)!
  expect(frame.width).toBe(600); expect(frame.height).toBe(300)
  ;[854 / 600, 0, 0, 854 / 600, 37, 75.5].forEach((value, i) => expect(frame.transform[i]).toBeCloseTo(value))
})

function fixture(kind: string) {
  let project = createBlankCourseProjectV10('Flow placement'), owned = createInitialFlowOwnedState()
  const root = project.rootIds[0]
  project.definitions.flow = { id: 'flow', role: 'mixed', implementation: { kind: 'builtin', key: 'guoling.container.flow' } }
  project.definitions.item = { id: 'item', role: 'content', implementation: { kind: 'builtin', key: `guoling.${kind}` } }
  project.instances[root] = createComponentContainerInstance({ id: root, kind: 'flow', title: 'Flow', childIds: ['item'] }, 'flow')
  const data = kind === 'chart' ? createChartData() : kind === 'formula' ? createFormulaComponentData('formula', 'x') : kind === 'text' ? createTextComponentData('Text') : {}
  project.instances.item = { id: 'item', definitionId: 'item', data: JSON.parse(JSON.stringify(data)),
    ...(kind === 'image' ? {} : { frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 0, 0] } }) }
  const target = (): CapturedCourseTarget => ({ documentId: 'doc', epoch: 'epoch', project, editingProject: project,
    resources: { assets: {}, components: {} }, surfaceId: root, activeStateId: null, instanceId: 'item', instanceIds: ['item'] })
  const commit = vi.fn(async (operation: ReturnType<typeof captureComponentOperation>) => { project = applyComponentOperation(project, operation) })
  const kernel = { captureTarget: target, readView: () => ({ activeDocumentId: 'doc' }),
    capture: (edits: Parameters<typeof captureComponentOperation>[1]) => captureComponentOperation(project, edits),
    editCaptured: commit, setFeedback: vi.fn() } as unknown as EditorStoreKernel
  const actions = createFlowAuthoringSlice(kernel, { read: () => owned, patch: patch => { owned = { ...owned, ...patch } } })
  return { target, actions, commit, read: () => project }
}

it.each(['chart', 'image', 'formula', 'text', 'group'])('keeps the observed %s at its current paper position through the formal conversion owner', async kind => {
  const f = fixture(kind), original = structuredClone(f.read().instances.item.data)
  const observed: ComponentFrame = { width: 620, height: 310, transform: [1, 0, 0, 1, 53, 1700] }
  stops.push(registerFlowMenuCapture(() => ({ ok: true, documentId: 'doc', projectId: f.read().id, revision: f.read().revision,
    locationId: f.target().surfaceId!, surfaceId: f.target().surfaceId!, generation: 1, selectedBlockId: 'item', selectionSignature: '',
    paperWidth: 900, bodyWidth: 820, paragraphRects: [], readFrame: id => id === 'item' ? observed : null })))
  expect(await f.actions.runFlowAuthoringIntent(f.target(), { kind: 'convert-block-to-overlay' })).toMatchObject({ ok: true, historyEntry: true })
  expect(f.read().instances.item).toMatchObject({ frame: observed, flowPlacement: { space: 'paper', plane: 'overlay' }, data: original })
  expect(f.commit).toHaveBeenCalledOnce()
  expect(await f.actions.runFlowAuthoringIntent(f.target(), { kind: 'convert-overlay-to-document' })).toMatchObject({ ok: true })
  expect(f.read().instances.item.flowPlacement).toBeUndefined()
  expect(f.read().instances.item.data).toEqual(original)
})

it('ignores another view while retaining the existing model conversion fallback', async () => {
  const f = fixture('chart'), retained = f.read().instances.item.frame
  stops.push(registerFlowMenuCapture(() => ({ ok: true, documentId: 'other', projectId: f.read().id, revision: f.read().revision,
    locationId: f.target().surfaceId!, surfaceId: f.target().surfaceId!, generation: 1, selectedBlockId: 'item', selectionSignature: '',
    paperWidth: 900, bodyWidth: 820, paragraphRects: [], readFrame: () => ({ width: 1, height: 1, transform: [1, 0, 0, 1, 0, 9000] }) })))
  expect(captureFlowBlockFrame(f.target(), 'item')).toBeNull()
  expect(await f.actions.runFlowAuthoringIntent(f.target(), { kind: 'convert-block-to-overlay' })).toMatchObject({ ok: true })
  expect(f.read().instances.item.frame).toEqual(retained)
})
