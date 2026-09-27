import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { buildFlowEditorView } from '@/renderer/course/flowEditorView'
import type { FlowEditorSelection } from '@/renderer/course/flowEditorSlice'
import type { FlowCurrentSessionCommandPort } from '@/renderer/ui/flow/useFlowTextAuthoringController'
import { FlowOverlayAuthoringLayer } from '@/renderer/ui/flow/FlowOverlayAuthoringLayer'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

const source = `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){
  const button = document.createElement('button'); button.textContent = 'Add height';
  button.addEventListener('click', () => { window.__flowRuntimeClicks = (window.__flowRuntimeClicks || 0) + 1 });
  ctx.dom.root.appendChild(button);
  return {destroy(){ctx.dom.root.replaceChildren()}};
}})`

function runtimeView(anchored = true) {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const item: RuntimeLayerItem = {
    layerItemId: 'runtime-1', label: 'Page Runtime', kind: 'runtime',
    frame: { mode: 'absolute', x: 50, y: 20, width: 500, height: 100 }, order: 1,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true,
      renderMode: 'dom', source, content: { values: {} }, assets: {} },
  }
  project.surfaces = [{ id: 'flow', type: 'flow', title: 'Flow',
    layout: { readingWidth: 760, wideContentWidth: 1120 },
    blocks: [{ id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: 'Intro' }] } }],
    surfaceLayerItems: [{ item, visibility: { mode: 'all', locationIds: [] },
      ...(anchored ? { paragraphAnchor: { blockId: 'p', offsetY: 20, xRatio: 0.1 } } : {}) }],
  }]
  project.locations = [{ id: 'loc', kind: 'flow-block', surfaceId: 'flow', blockId: 'p', label: 'Intro' }]
  project.startLocationId = 'loc'
  return buildFlowEditorView({ project: courseProjectDocumentSchema.parse(project), locationId: 'loc' })
}

it('mounts anchored Runtime at the derived frame and leaves its button interactive while selected', async () => {
  const view = runtimeView()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const run = vi.fn(() => ({ ok: true })) as unknown as FlowCurrentSessionCommandPort['run']
  const heightChanges: Array<[string, number]> = []
  const targetUpdates: Array<[string, Readonly<RuntimeAuthoringTargetUpdate>]> = []
  const props = {
    view, locationId: 'loc', sessionToken: { surfaceType: 'flow' as const, locationId: 'loc', revision: view.revision, generation: 1 },
    assetUrls: {}, paperScrollTop: 0, paperWidth: 760,
    paragraphRects: [{ blockId: 'p', depth: 0, x: 0, y: 0, width: 760, height: 50 }],
    overlayViewportSize: { width: 900, height: 700 },
    runtimeFrames: { 'runtime-1': { x: 50, y: 20, width: 500, height: 950 } },
    onRuntimeHeightChange: (id: string, height: number) => heightChanges.push([id, height]),
    onRuntimeTargetsChanged: (id: string, update: Readonly<RuntimeAuthoringTargetUpdate>) => targetUpdates.push([id, update]),
    commands: { run }, children: <div />,
  }
  try {
    await act(async () => root.render(<FlowOverlayAuthoringLayer {...props} selection={null} />))
    const visual = host.querySelector<HTMLElement>('[data-testid="flow-layer-card-runtime-1"]')!
    const button = visual.querySelector('button')!
    expect(visual.style.height).toBe('950px')
    expect(button.textContent).toBe('Add height')
    const press = new Event('pointerdown', { bubbles: true, cancelable: true })
    Object.defineProperty(press, 'button', { value: 0 })
    button.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(false)
    button.click()
    expect((window as unknown as { __flowRuntimeClicks?: number }).__flowRuntimeClicks).toBe(1)
    expect(run).not.toHaveBeenCalled()

    await act(async () => root.render(<FlowOverlayAuthoringLayer {...props}
      selection={{ locationId: 'loc', surfaceId: 'flow', authoringScope: 'page', focus: 'overlay',
        selectedBlockId: null, selectedBlockIds: [], selectedOverlayIds: ['runtime-1'],
        textRange: null, authoringAddress: view.overlayLayers[0]!.authoringAddress } satisfies FlowEditorSelection} />))
    const chrome = host.querySelector<HTMLElement>('[data-testid="flow-layer-selection-runtime-1"]')!
    expect(chrome.style.height).toBe('950px')
    expect(chrome.style.pointerEvents).toBe('none')
    const selectedButton = host.querySelector<HTMLButtonElement>('[data-testid="flow-layer-card-runtime-1"] button')!
    selectedButton.click()
    expect((window as unknown as { __flowRuntimeClicks?: number }).__flowRuntimeClicks).toBe(2)
    expect(host.querySelector('[data-testid="flow-overlay-handle-runtime-1-se"]')).not.toBeNull()
    chrome.setPointerCapture = vi.fn()
    chrome.hasPointerCapture = vi.fn(() => true)
    chrome.releasePointerCapture = vi.fn()
    const overlayPlane = host.querySelector<HTMLElement>('[data-testid="flow-authoring-layer-overlay"]')!
    overlayPlane.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0,
      width: 900, height: 700, right: 900, bottom: 700, toJSON: () => ({}) }) as DOMRect
    const edge = chrome.querySelector<HTMLElement>('[data-runtime-drag-edge="top"]')!
    const pointer = (name: string, x: number, y: number) => {
      const event = new Event(name, { bubbles: true, cancelable: true })
      Object.defineProperties(event, { button: { value: 0 }, pointerId: { value: 1 },
        clientX: { value: x }, clientY: { value: y } })
      return event
    }
    const edgePress = pointer('pointerdown', 80, 20)
    edge.dispatchEvent(edgePress)
    expect(edgePress.defaultPrevented).toBe(true)
    expect(run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'select-overlay' }))
    await act(async () => {
      chrome.dispatchEvent(pointer('pointermove', 90, 30))
      chrome.dispatchEvent(pointer('pointerup', 90, 30))
    })
    expect(run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'transform-overlay-frame', frame: expect.objectContaining({ height: 100 }),
    }))
    expect(heightChanges.every(([id]) => id === 'runtime-1')).toBe(true)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { __flowRuntimeClicks?: number }).__flowRuntimeClicks
  }
  expect(targetUpdates.at(-1)).toMatchObject(['runtime-1', { targets: [] }])
})

it('keeps an unanchored paper Runtime on the existing fallback path', async () => {
  const view = runtimeView(false)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<FlowOverlayAuthoringLayer
      view={view} locationId="loc"
      sessionToken={{ surfaceType: 'flow', locationId: 'loc', revision: view.revision, generation: 1 }}
      selection={null} assetUrls={{}} paperScrollTop={0} paperWidth={760}
      overlayViewportSize={{ width: 900, height: 700 }}
      commands={{ run: () => ({ ok: true }) } as unknown as FlowCurrentSessionCommandPort}
    ><div /></FlowOverlayAuthoringLayer>))
    expect(host.querySelector('[data-testid="flow-page-runtime"]')).toBeNull()
    expect(host.querySelector('[data-testid="flow-layer-card-runtime-1"]')?.textContent).toContain('Page Runtime')
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
