import { afterEach, expect, it, vi } from 'vitest'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { createPublishedSurfaceHost } from '@/player/surfaces/publishedDynamicHosts'
import { FlowSurfaceHost } from '@/player/surfaces/flow/FlowSurfaceHost'
import { registerPublishedCaptureResource } from '@/player/surfaces/publishedCapture'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import { buildPublishedFixture } from '../fixtures/teacherController'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

afterEach(() => { vi.restoreAllMocks() })

function adapter() {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = project.surfaces[0]
  if (surface?.type !== 'flow') throw new Error('Expected Flow surface')
  const payload = buildPublishedFixture({ project, assetFiles: {}, components: {} })
  return { host: createPublishedSurfaceHost(payload, surface.id), surfaceId: surface.id, locationId: payload.startLocationId }
}

it('routes a requested Flow layer to its PNG capture and preserves returned dimensions', async () => {
  const capture = vi.spyOn(FlowSurfaceHost.prototype, 'captureLayerItem').mockResolvedValue({
    format: 'data-url', content: 'data:image/png;base64,RkxPVw==', width: 420, height: 280,
  })
  const { host } = adapter()
  await expect(host.capture({ purpose: 'authoring', layerItemId: 'flow-runtime' })).resolves.toEqual({
    format: 'data-url', content: 'data:image/png;base64,RkxPVw==', width: 420, height: 280,
  })
  expect(capture).toHaveBeenCalledExactlyOnceWith('flow-runtime')
})

it('keeps the ordinary Flow location capture as JSON without capturing an item', async () => {
  const capture = vi.spyOn(FlowSurfaceHost.prototype, 'captureLayerItem')
  const { host, surfaceId, locationId } = adapter()
  await expect(host.capture({ purpose: 'thumbnail' })).resolves.toEqual({
    format: 'json', content: JSON.stringify({ surfaceId, locationId }),
  })
  expect(capture).not.toHaveBeenCalled()
})

it('propagates Flow capture preparation failure without producing a PNG', async () => {
  const capture = vi.spyOn(FlowSurfaceHost.prototype, 'captureLayerItem').mockRejectedValue(new Error('prepareCapture failed'))
  const { host } = adapter()
  await expect(host.capture({ purpose: 'export', layerItemId: 'flow-component' })).rejects.toThrow('prepareCapture failed')
  expect(capture).toHaveBeenCalledExactlyOnceWith('flow-component')
})

function dynamicProject(runtimeSource = 'CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){ctx.dom.root.dataset.captureProof="runtime";return {destroy(){}}}});'):
  { project: CourseProjectDocument; components: ReturnType<typeof componentPackagesFromArchive> } {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const runtime: RuntimeLayerItem = {
    layerItemId: 'paper-runtime', label: 'Runtime', order: 1, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    frame: { mode: 'absolute', x: 20, y: 30, width: 420, height: 180 }, kind: 'runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      source: runtimeSource,
      content: { values: {} }, assets: {} },
  }
  const fixture = listCourseProjectV9Fixtures().find(candidate => candidate.id === 'component')?.data
  if (!fixture) throw new Error('Expected component fixture')
  const donor = fixture.project.surfaces[0]
  if (donor?.type !== 'slide') throw new Error('Expected Slide component donor')
  const component = structuredClone(donor.scenes[0]!.layerItems.find(item => item.layerItemId === 'slide-quiz'))
  if (component?.kind !== 'component') throw new Error('Expected component layer')
  component.layerItemId = 'paper-component'
  component.paperSpace = 'paper'
  component.order = 2
  component.frame = { mode: 'absolute', x: 40, y: 220, width: 360, height: 210 }
  delete component.staticFallbackAssetId
  flow.surfaceLayerItems = [
    { item: runtime, visibility: { mode: 'all', locationIds: [] } },
    { item: component, visibility: { mode: 'all', locationIds: [] } },
  ]
  project.componentPackages = structuredClone(fixture.project.componentPackages)
  return { project, components: componentPackagesFromArchive(fixture.project, fixture.componentFiles) }
}

it('captures mounted Runtime and Component wrappers at their individual PNG sizes', async () => {
  const { project, components } = dynamicProject()
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const payload = buildPublishedFixture({ project, assetFiles: {}, components })
  const host = createPublishedSurfaceHost(payload, flow.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const context = new Proxy({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high', globalAlpha: 1 }, {
    get(target, property) {
      if (property === 'measureText') return () => ({ width: 0 })
      return Reflect.get(target, property) ?? (() => undefined)
    },
  }) as unknown as CanvasRenderingContext2D
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  const dataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,RkxPVw==')
  try {
    await host.mount({ surfaceId: flow.id, container, signal: new AbortController().signal,
      services: { navigate: vi.fn(), getCourseState: vi.fn(), setCourseState: vi.fn(), resolveAsset: vi.fn() } })
    await host.activate()
    for (const [id, width, height] of [['paper-runtime', 420, 180], ['paper-component', 360, 210]] as const) {
      const wrap = container.querySelector<HTMLElement>(`[data-flow-overlay-item="${id}"]`)
      if (!wrap) throw new Error(`Mounted ${id} wrapper missing`)
      vi.spyOn(wrap, 'offsetWidth', 'get').mockReturnValue(width)
      vi.spyOn(wrap, 'offsetHeight', 'get').mockReturnValue(height)
      vi.spyOn(wrap, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
        right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect)
      await expect(host.capture({ purpose: 'authoring', layerItemId: id })).resolves.toEqual({
        format: 'data-url', content: 'data:image/png;base64,RkxPVw==', width, height,
      })
    }
    expect(canvas).toHaveBeenCalled()
    expect(dataUrl).toHaveBeenCalledTimes(2)
  } finally {
    await host.destroy()
    container.remove()
  }
})

it('uses the post-barrier Runtime height for both PNG pixels and returned capture size', async () => {
  const { project, components } = dynamicProject()
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const host = createPublishedSurfaceHost(buildPublishedFixture({ project, assetFiles: {}, components }), flow.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const context = new Proxy({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high', globalAlpha: 1 }, {
    get(target, property) {
      if (property === 'measureText') return () => ({ width: 0 })
      return Reflect.get(target, property) ?? (() => undefined)
    },
  }) as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
  const renderedHeights: number[] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function render(this: HTMLCanvasElement) {
    renderedHeights.push(this.height)
    return `data:image/png;base64,${btoa(String(this.height))}`
  })
  let stop: (() => void) | undefined
  try {
    await host.mount({ surfaceId: flow.id, container, signal: new AbortController().signal,
      services: { navigate: vi.fn(), getCourseState: vi.fn(), setCourseState: vi.fn(), resolveAsset: vi.fn() } })
    await host.activate()
    const wrap = container.querySelector<HTMLElement>('[data-flow-overlay-item="paper-runtime"]')
    if (!wrap) throw new Error('Mounted Runtime wrapper missing')
    let height = 180
    vi.spyOn(wrap, 'offsetWidth', 'get').mockReturnValue(420)
    vi.spyOn(wrap, 'offsetHeight', 'get').mockImplementation(() => height)
    vi.spyOn(wrap, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0,
      right: 420, bottom: height, width: 420, height, toJSON: () => ({}) } as DOMRect))
    stop = registerPublishedCaptureResource(wrap, { async waitForCaptureReady() { height = 290 } })
    await expect(host.capture({ purpose: 'authoring', layerItemId: 'paper-runtime' })).resolves.toEqual({
      format: 'data-url', content: `data:image/png;base64,${btoa('290')}`, width: 420, height: 290,
    })
    expect(renderedHeights).toEqual([290])
  } finally {
    stop?.()
    await host.destroy()
    container.remove()
  }
})

it.each([
  ['prepareCapture', 'CoursewareRuntime.define({runtimeApiVersion:3,create(){return {prepareCapture(){throw new Error("Flow capture blocked")},destroy(){}}}});'],
  ['capture barrier', 'CoursewareRuntime.define({runtimeApiVersion:3,create(){return {destroy(){}}}});'],
])('stops before PNG rendering when a mounted Runtime %s rejects', async (_phase, source) => {
  const { project, components } = dynamicProject(source)
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const host = createPublishedSurfaceHost(buildPublishedFixture({ project, assetFiles: {}, components }), flow.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  const dataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
  const restore = vi.fn()
  let stop: (() => void) | undefined
  try {
    await host.mount({ surfaceId: flow.id, container, signal: new AbortController().signal,
      services: { navigate: vi.fn(), getCourseState: vi.fn(), setCourseState: vi.fn(), resolveAsset: vi.fn() } })
    await host.activate()
    const wrap = container.querySelector<HTMLElement>('[data-flow-overlay-item="paper-runtime"]')
    if (!wrap) throw new Error('Mounted Runtime wrapper missing')
    vi.spyOn(wrap, 'offsetWidth', 'get').mockReturnValue(420)
    vi.spyOn(wrap, 'offsetHeight', 'get').mockReturnValue(180)
    stop = registerPublishedCaptureResource(wrap, {
      async waitForCaptureReady() { if (_phase === 'capture barrier') throw new Error('Flow capture blocked') },
      restoreAfterCapture: restore,
    })
    await expect(host.capture({ purpose: 'export', layerItemId: 'paper-runtime' })).rejects.toThrow('Flow capture blocked')
    expect(canvas).not.toHaveBeenCalled()
    expect(dataUrl).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledOnce()
  } finally {
    stop?.()
    await host.destroy()
    container.remove()
  }
})

it('restores prepared resources when post-barrier geometry becomes invalid', async () => {
  const { project, components } = dynamicProject()
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const host = createPublishedSurfaceHost(buildPublishedFixture({ project, assetFiles: {}, components }), flow.id)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
  const dataUrl = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
  const restore = vi.fn()
  let stop: (() => void) | undefined
  try {
    await host.mount({ surfaceId: flow.id, container, signal: new AbortController().signal,
      services: { navigate: vi.fn(), getCourseState: vi.fn(), setCourseState: vi.fn(), resolveAsset: vi.fn() } })
    await host.activate()
    const wrap = container.querySelector<HTMLElement>('[data-flow-overlay-item="paper-runtime"]')
    if (!wrap) throw new Error('Mounted Runtime wrapper missing')
    let height = 180
    vi.spyOn(wrap, 'offsetWidth', 'get').mockReturnValue(420)
    vi.spyOn(wrap, 'offsetHeight', 'get').mockImplementation(() => height)
    stop = registerPublishedCaptureResource(wrap, {
      async waitForCaptureReady() { height = 0 }, restoreAfterCapture: restore,
    })
    await expect(host.capture({ purpose: 'export', layerItemId: 'paper-runtime' })).rejects.toThrow('没有可见布局尺寸')
    expect(canvas).not.toHaveBeenCalled()
    expect(dataUrl).not.toHaveBeenCalled()
    expect(restore).toHaveBeenCalledOnce()
  } finally {
    stop?.()
    await host.destroy()
    container.remove()
  }
})
