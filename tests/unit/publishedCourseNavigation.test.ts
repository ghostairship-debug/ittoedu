import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { CourseProjectDocument, NativeLayerItem, ScopedLayerItem } from '@/shared/courseProjectTypes'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { addCourseFlowPage, addCourseScene, addCourseSpatialPage } from '@/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createFormulaNode } from '@/renderer/project/createProject'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '@/player/surfaces/publishedDynamicHosts'

const NOW = '2026-08-17T21:00:00.000Z'

function textStyle() {
  return {
    fontFamily: 'sans-serif',
    fontSize: 18,
    color: '#172033',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    emphasis: false,
    highlightColor: null,
    align: 'left' as const,
    verticalAlign: 'top' as const,
    writingMode: 'horizontal' as const,
    lineSpacing: 1.2,
    letterSpacing: 0,
    padding: 0,
    overflow: 'fixed' as const,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
  }
}

function requireOk<T extends { ok: boolean; reason?: string }>(result: T): T & { ok: true } {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason ?? 'command failed')
  return result as T & { ok: true }
}

function globalNote(locationId: string): ScopedLayerItem {
  const item: NativeLayerItem = {
    layerItemId: 'global-note',
    label: '仅首页',
    frame: { mode: 'absolute', x: 16, y: 16, width: 180, height: 32 },
    order: 50_000,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text: '仅首页可见', runs: [], style: textStyle() },
    },
  }
  return {
    item,
    visibility: { mode: 'include', locationIds: [locationId] },
  }
}

function mixedProject(): CourseProjectDocument {
  let project = createBlankCourseProject({ now: NOW })
  const slideSurface = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slideSurface) throw new Error('expected slide surface')
  const homeLocationId = project.startLocationId

  const sceneAdded = requireOk(addCourseScene(project, {
    surfaceId: slideSurface.id,
    now: NOW,
    expectedRevision: project.revision,
  }))
  project = sceneAdded.project

  const flowAdded = requireOk(addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  }))
  project = flowAdded.project

  const spatialAdded = requireOk(addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  }))
  project = spatialAdded.project

  return courseProjectDocumentSchema.parse({
    ...project,
    globalLayerItems: [...project.globalLayerItems, globalNote(homeLocationId)],
  })
}

describe('published course Mixed navigation', () => {
  const sessions: PublishedCourseSession[] = []

  beforeAll(() => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
    }
  })

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  })

  it('walks Mixed location order, catalog, progress, and next/previous', async () => {
    const project = mixedProject()
    const before = structuredClone(project)
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const catalog = session.listCatalog()
    expect(catalog.map((entry) => entry.id)).toEqual(payload.locations.map((location) => location.id))
    expect(catalog.map((entry) => entry.kind)).toEqual(['slide', 'slide', 'flow', 'spatial-2d'])
    expect(session.navigator.current).toMatchObject({
      locationId: payload.startLocationId,
      index: 0,
      total: 4,
    })
    expect(session.getProgress()).toMatchObject({
      index: 0,
      total: 4,
      ratio: 0.25,
      atStart: true,
      atEnd: false,
    })

    const second = await session.next()
    expect(second).toMatchObject({ index: 1, kind: 'slide', total: 4 })
    expect(session.getProgress()).toMatchObject({ index: 1, ratio: 0.5, atStart: false, atEnd: false })

    const flow = await session.next()
    expect(flow).toMatchObject({ index: 2, kind: 'flow' })
    expect(session.player.activeSurfaceId).toBe(flow?.surfaceId)

    const spatial = await session.next()
    expect(spatial).toMatchObject({ index: 3, kind: 'spatial-2d' })
    expect(session.getProgress()).toMatchObject({ atEnd: true, ratio: 1 })
    expect(await session.next()).toBeNull()

    expect(await session.previous()).toMatchObject({ index: 2, kind: 'flow' })
    expect(await session.goToIndex(0)).toMatchObject({
      locationId: payload.startLocationId,
      index: 0,
    })

    expect(project).toEqual(before)
    expect(payload.locations).toEqual(before.locations)
    container.remove()
  })

  it('shows global overlay only on the included active location', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const homeId = payload.startLocationId
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const slideRoot = container.querySelector<HTMLElement>('.slide-published-adapter')
    expect(slideRoot?.hidden).toBe(false)
    expect(slideRoot?.querySelector('[data-global-layer-item="global-note"]')).not.toBeNull()

    await session.next()
    expect(slideRoot?.dataset.locationId).not.toBe(homeId)
    expect(slideRoot?.querySelector('[data-global-layer-item="global-note"]')).toBeNull()

    await session.next()
    const flowRoot = container.querySelector<HTMLElement>('.flow-surface-host')
    expect(flowRoot?.hidden).toBe(false)
    expect(slideRoot?.hidden).toBe(true)
    expect(flowRoot?.querySelector('[data-flow-overlay-item="global-note"]')).toBeNull()

    await session.next()
    const spatialRoot = container.querySelector<HTMLElement>('.spatial-surface')
    expect(spatialRoot?.hidden).toBe(false)
    expect(spatialRoot?.querySelector('[data-layer-item-id="global-note"]')).toBeNull()

    await session.goToLocation(homeId)
    expect(slideRoot?.hidden).toBe(false)
    expect(slideRoot?.querySelector('[data-global-layer-item="global-note"]')).not.toBeNull()
    container.remove()
  })

  it('mounts the global teacher controller on Slide Published Adapter', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const controllerId = payload.globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))?.item.layerItemId
    expect(controllerId).toBeTruthy()
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const slideRoot = container.querySelector<HTMLElement>('.slide-published-adapter')
    expect(slideRoot?.querySelector('.slide-native-teacher-controller')).not.toBeNull()
    expect(slideRoot?.querySelector(`[data-native-type="teacher-controller"]`)).not.toBeNull()
    expect(slideRoot?.querySelector(`[data-global-layer-item="${controllerId}"]`)).not.toBeNull()
    container.remove()
  })

  it('keeps the global teacher controller on Flow and Spatial in whole-course preview', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const flowLocation = payload.locations.find((location) => location.kind === 'flow-block')
    const spatialLocation = payload.locations.find((location) => location.kind === 'spatial-camera')
    expect(flowLocation && spatialLocation).toBeTruthy()
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    await session.goToLocation(flowLocation!.id)
    const flowRoot = container.querySelector<HTMLElement>('.flow-surface-host')
    const flowController = flowRoot?.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')
    expect(flowRoot?.hidden).toBe(false)
    expect(flowController).not.toBeNull()
    expect(flowRoot?.style.height).toBe('720px')
    expect(parseFloat(flowController!.style.top) + parseFloat(flowController!.style.height)).toBeLessThanOrEqual(720)

    await session.goToLocation(spatialLocation!.id)
    const spatialRoot = container.querySelector<HTMLElement>('.spatial-surface')
    const spatialController = spatialRoot?.querySelector<HTMLElement>('.spatial-screen-teacher-controller')
    expect(spatialRoot?.hidden).toBe(false)
    expect(spatialController).not.toBeNull()
    expect(spatialRoot?.style.height).toBe('720px')
    expect(parseFloat(spatialController!.style.top) + parseFloat(spatialController!.style.height)).toBeLessThanOrEqual(720)
    container.remove()
  })

  it('shows include-scoped global component fallback only on the selected location', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const homeId = payload.startLocationId
    const included = payload.locations.find((location) => (
      location.kind === 'slide-scene' && location.id !== homeId
    ))
    expect(included).toBeTruthy()
    payload.globalLayerItems.push({
      item: {
        layerItemId: 'global-nav',
        frame: { mode: 'absolute', x: 40, y: 40, width: 400, height: 80 },
        order: 60_000,
        visible: true,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
        kind: 'component',
        component: { packageId: 'com.example.global-nav', version: '4.0.0' },
        props: { content: { title: '教师全局导航', buttons: { next: '继续学习' } } },
      },
      visibility: { mode: 'include', locationIds: [included!.id] },
    })
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const slideRoot = container.querySelector<HTMLElement>('.slide-published-adapter')
    expect(slideRoot?.hidden).toBe(false)
    expect(slideRoot?.querySelector('[data-global-layer-item="global-nav"]')).toBeNull()

    await session.goToLocation(included!.id)
    const fallback = slideRoot?.querySelector<HTMLElement>('[data-global-layer-item="global-nav"]')
    expect(fallback).not.toBeNull()
    expect(fallback?.dataset.slideFallbackKind).toBe('component')
    expect(fallback?.textContent).toBe('[组件后备：com.example.global-nav@4.0.0]')
    const innerFallback = fallback?.querySelector<HTMLElement>('.published-component-fallback-label')
    expect(innerFallback).not.toBeNull()
    expect(innerFallback?.style.background).toMatch(/#0f766e|rgb\(15,\s*118,\s*110\)/)
    expect(innerFallback?.style.color).toMatch(/#fff(?:fff)?|rgb\(255,\s*255,\s*255\)/)
    expect(slideRoot?.querySelector('[data-global-layer-item="global-note"]')).toBeNull()

    await session.goToLocation(homeId)
    expect(slideRoot?.querySelector('[data-global-layer-item="global-nav"]')).toBeNull()
    container.remove()
  })

  it('removes its own surface slots so overlapping remount does not stack hosts', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const first = createPublishedCourseSession(payload)
    sessions.push(first)
    await first.mount(container)
    expect(container.querySelectorAll('[data-course-surface-slot]')).toHaveLength(payload.surfaces.length)

    const second = createPublishedCourseSession(payload)
    sessions.push(second)
    const destroying = first.destroy()
    await second.mount(container)
    await destroying

    expect(container.querySelectorAll('[data-course-surface-slot]')).toHaveLength(payload.surfaces.length)
    expect(container.querySelectorAll('.slide-published-adapter')).toHaveLength(1)
    expect(container.querySelectorAll('.flow-surface-host')).toHaveLength(1)
    expect(container.querySelectorAll('.spatial-surface')).toHaveLength(1)
    await second.destroy()
    expect(container.querySelectorAll('[data-course-surface-slot]')).toHaveLength(0)
    container.remove()
  })

  it('hides inactive Mixed surface slots so they cannot steal pointer events', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const visibleSlots = () => [...container.querySelectorAll<HTMLElement>('[data-course-surface-slot]')]
      .filter((slot) => slot.style.visibility !== 'hidden')
    expect(visibleSlots()).toHaveLength(1)
    expect(visibleSlots()[0]?.dataset.courseSurfaceSlot).toBe(session.navigator.current?.surfaceId)

    await session.next()
    await session.next()
    expect(session.navigator.current?.kind).toBe('flow')
    expect(visibleSlots()).toHaveLength(1)
    expect(visibleSlots()[0]?.dataset.courseSurfaceSlot).toBe(session.navigator.current?.surfaceId)
    expect(container.querySelector<HTMLElement>('.slide-published-adapter')?.hidden).toBe(true)
    container.remove()
  })

  it('paints slide formulas as math canvases instead of accessible text', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function mockContext(this: HTMLCanvasElement, type: string) {
      if (type !== '2d') return null
      return {
        arc: vi.fn(),
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        clip: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        lineTo: vi.fn(),
        measureText: vi.fn((value: string) => ({ width: Math.max(8, Array.from(value).length * 12) })),
        moveTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        rect: vi.fn(),
        restore: vi.fn(),
        rotate: vi.fn(),
        save: vi.fn(),
        scale: vi.fn(),
        stroke: vi.fn(),
        translate: vi.fn(),
        fillStyle: '',
        strokeStyle: '',
        font: '',
        globalAlpha: 1,
        imageSmoothingEnabled: true,
        lineWidth: 1,
        textAlign: 'left',
        textBaseline: 'alphabetic',
      } as unknown as CanvasRenderingContext2D
    })
    const project = mixedProject()
    const formula = createFormulaNode({
      id: 'formula-slide',
      formulaId: 'formula:slide-x',
      accessibleText: 'x 的平方',
      ast: { type: 'token', value: 'x' },
      x: 80,
      y: 80,
      width: 240,
      height: 96,
    })
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(formula, 40))
    const payload = buildPublishedCourseV2Payload({
      project: courseProjectDocumentSchema.parse(project),
      assetFiles: {},
      components: {},
    })
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)
    const math = container.querySelector<HTMLElement>('[role="math"]')
    expect(math).not.toBeNull()
    expect(math?.getAttribute('aria-label')).toBe('x 的平方')
    expect(math?.querySelector('canvas')).not.toBeNull()
    expect(math?.dataset.formulaFallback).toBeUndefined()
    expect(math?.textContent).toBe('')
    vi.restoreAllMocks()
    container.remove()
  })

  it('enables pointer events only on the active published surface slot', async () => {
    const project = mixedProject()
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const slots = () => [...container.querySelectorAll<HTMLElement>('[data-course-surface-slot]')]
    const activeSurfaceId = () => session.navigator.current?.surfaceId

    expect(slots().length).toBeGreaterThan(0)
    for (const slot of slots()) {
      const active = slot.dataset.courseSurfaceSlot === activeSurfaceId()
      expect(slot.style.pointerEvents).toBe(active ? 'auto' : 'none')
    }

    const flowLocation = payload.locations.find((location) => location.kind === 'flow-block')
    expect(flowLocation).toBeTruthy()
    await session.goToLocation(flowLocation!.id)
    expect(session.navigator.current?.kind).toBe('flow')

    for (const slot of slots()) {
      const active = slot.dataset.courseSurfaceSlot === activeSurfaceId()
      expect(slot.style.pointerEvents).toBe(active ? 'auto' : 'none')
    }

    container.remove()
  })
})
