import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { InteractionRule } from '@/shared/contracts/interaction-v1/types'
import { addCourseFlowPage, addCourseSpatialPage } from '@/renderer/course/courseLocationCommands'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createPublishedCourseSession, type PublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type {
  PublishedCourseV2Payload,
  PublishedScopedLayerItem,
} from '@/shared/publishedCourseTypes'

const NOW = '2026-08-25T04:20:00.000Z'
const GLOBAL_TRIGGER_ID = 'mixed-session-global-trigger'
const GLOBAL_TARGET_ID = 'mixed-session-global-target'

const textStyle = {
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

function requireOk<T extends { ok: boolean; reason?: string }>(result: T): T & { ok: true } {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.reason ?? 'command failed')
  return result as T & { ok: true }
}

function mixedControllerProject(): CourseProjectDocument {
  let project = createBlankCourseProject({ now: NOW })
  project = requireOk(addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })).project
  project = requireOk(addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })).project

  return courseProjectDocumentSchema.parse({
    ...project,
    globalLayerItems: project.globalLayerItems.map((entry) => {
      const item = entry.item
      if (item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') {
        return entry
      }
      return {
        ...entry,
        item: {
          ...item,
          content: {
            ...item.content,
            data: {
              ...item.content.data,
              defaultCollapsed: true,
              buttons: item.content.data.buttons.map((button) => (
                button.action.type === 'course.restart'
                  ? { ...button, visible: true }
                  : button
              )),
            },
          },
        },
      }
    }),
  })
}

function globalInteractionItem(
  layerItemId: string,
  order: number,
  hidden = false,
): PublishedScopedLayerItem {
  return {
    item: {
      layerItemId,
      frame: {
        mode: 'absolute',
        x: 40,
        y: layerItemId === GLOBAL_TRIGGER_ID ? 40 : 100,
        width: 220,
        height: 40,
      },
      order,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: hidden ? 'hidden' : 'inherit',
      kind: 'native',
      content: {
        nativeType: 'text',
        data: { text: layerItemId, runs: [], style: textStyle },
      },
    },
    visibility: { mode: 'all', locationIds: [] },
  }
}

function addGlobalVisibilityProbe(payload: PublishedCourseV2Payload): void {
  payload.globalLayerItems.push(
    globalInteractionItem(GLOBAL_TRIGGER_ID, 60_000),
    globalInteractionItem(GLOBAL_TARGET_ID, 60_001, true),
  )
  const rule: InteractionRule = {
    id: 'mixed-session-reveal-global',
    enabled: true,
    trigger: { type: 'node.click', nodeId: GLOBAL_TRIGGER_ID },
    conditions: [],
    actions: [{
      id: 'mixed-session-enter-global',
      start: 'after-previous',
      delayMs: 0,
      action: {
        type: 'node.enter',
        nodeId: GLOBAL_TARGET_ID,
        durationMs: 0,
        easing: 'linear',
        effect: 'none',
      },
    }],
  }
  payload.globalInteractions.push(rule)
}

function controllerFrame(
  container: HTMLElement,
  kind: 'slide' | 'flow' | 'spatial',
  controllerId: string,
): HTMLElement {
  const selector = kind === 'slide'
    ? `[data-global-layer-item="${controllerId}"]`
    : kind === 'flow'
      ? `.flow-runtime-teacher-controller-frame[data-layer-item-id="${controllerId}"]`
      : `.spatial-screen-teacher-controller[data-layer-item-id="${controllerId}"]`
  const frame = container.querySelector<HTMLElement>(selector)
  if (!frame) throw new Error(`missing ${kind} controller ${controllerId}`)
  return frame
}

function controllerRoot(frame: HTMLElement): HTMLElement {
  const root = frame.querySelector<HTMLElement>('.slide-native-teacher-controller')
  if (!root) throw new Error('missing teacher controller root')
  return root
}

function globalInteractionFrame(
  container: HTMLElement,
  kind: 'slide' | 'flow' | 'spatial',
  layerItemId: string,
): HTMLElement {
  const rootSelector = kind === 'slide'
    ? '.slide-published-adapter'
    : kind === 'flow'
      ? '.flow-surface-host'
      : '.spatial-surface'
  const itemSelector = kind === 'slide'
    ? `[data-global-layer-item="${layerItemId}"]`
    : kind === 'flow'
      ? `[data-flow-overlay-item="${layerItemId}"]`
      : `[data-layer-item-id="${layerItemId}"]`
  const item = container.querySelector<HTMLElement>(`${rootSelector} ${itemSelector}`)
  if (!item) throw new Error(`missing ${kind} global interaction item ${layerItemId}`)
  return item
}

function expectCollapsed(frame: HTMLElement, collapsed: boolean): void {
  const button = frame.querySelector<HTMLButtonElement>('[data-teacher-controller-collapse="true"]')
  expect(button?.getAttribute('aria-label')).toBe(
    collapsed ? '展开教师控制器' : '收起教师控制器',
  )
}

function moveController(frame: HTMLElement, key: 'ArrowLeft' | 'ArrowRight'): number {
  controllerRoot(frame).dispatchEvent(new KeyboardEvent('keydown', {
    key,
    altKey: true,
    bubbles: true,
  }))
  return Number.parseFloat(frame.style.left)
}

describe('Mixed teacher controller runtime Session', () => {
  const sessions: PublishedCourseSession[] = []

  beforeAll(() => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
    }
    if (typeof HTMLElement.prototype.animate !== 'function') {
      Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        writable: true,
        value: () => ({ cancel: vi.fn(), finished: Promise.resolve() }) as unknown as Animation,
      })
    }
  })

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.destroy()))
    document.body.replaceChildren()
  })

  it('shares collapse, scopes offsets per Surface, and rehydrates authored defaults on restart', async () => {
    const project = mixedControllerProject()
    const projectBefore = structuredClone(project)
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    addGlobalVisibilityProbe(payload)
    const payloadBefore = structuredClone(payload)
    const controllerEntry = payload.globalLayerItems.find((entry) => (
      entry.item.kind === 'native'
      && entry.item.content.nativeType === 'teacher-controller'
    ))
    if (
      !controllerEntry
      || controllerEntry.item.kind !== 'native'
      || controllerEntry.item.content.nativeType !== 'teacher-controller'
    ) throw new Error('fixture requires a stable global teacher controller')
    const controllerId = controllerEntry.item.layerItemId
    const authoredLeft = controllerEntry.item.frame.x
    const restartButtonId = controllerEntry.item.content.data.buttons.find(
      (button) => button.action.type === 'course.restart',
    )?.id
    if (!restartButtonId) throw new Error('fixture requires a course.restart button')
    const flowLocation = payload.locations.find((location) => location.kind === 'flow-block')
    const spatialLocation = payload.locations.find((location) => location.kind === 'spatial-camera')
    if (!flowLocation || !spatialLocation) throw new Error('fixture requires all three surfaces')

    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const globalTrigger = globalInteractionFrame(container, 'slide', GLOBAL_TRIGGER_ID)
    let globalTarget = globalInteractionFrame(container, 'slide', GLOBAL_TARGET_ID)
    expect(globalTarget.dataset.interactionVisibility).toBe('hidden')
    globalTrigger.click()
    await vi.waitFor(() => {
      globalTarget = globalInteractionFrame(container, 'slide', GLOBAL_TARGET_ID)
      expect(globalTarget.dataset.interactionVisibility).toBe('visible')
    })

    let slide = controllerFrame(container, 'slide', controllerId)
    expectCollapsed(slide, true)
    slide.querySelector<HTMLButtonElement>('[data-teacher-controller-collapse="true"]')?.click()
    slide = controllerFrame(container, 'slide', controllerId)
    expectCollapsed(slide, false)
    expect(moveController(slide, 'ArrowRight')).toBe(authoredLeft + 8)

    await session.goToLocation(flowLocation.id)
    let flow = controllerFrame(container, 'flow', controllerId)
    expectCollapsed(flow, false)
    expect(Number.parseFloat(flow.style.left)).toBe(authoredLeft)
    expect(moveController(flow, 'ArrowRight')).toBe(authoredLeft + 8)

    await session.goToLocation(spatialLocation.id)
    let spatial = controllerFrame(container, 'spatial', controllerId)
    expectCollapsed(spatial, false)
    expect(Number.parseFloat(spatial.style.left)).toBe(authoredLeft)
    expect(moveController(spatial, 'ArrowLeft')).toBe(authoredLeft - 8)

    await session.goToLocation(flowLocation.id)
    flow = controllerFrame(container, 'flow', controllerId)
    expectCollapsed(flow, false)
    expect(Number.parseFloat(flow.style.left)).toBe(authoredLeft + 8)

    await session.goToLocation(payload.startLocationId)
    slide = controllerFrame(container, 'slide', controllerId)
    expectCollapsed(slide, false)
    expect(Number.parseFloat(slide.style.left)).toBe(authoredLeft + 8)

    await session.goToLocation(spatialLocation.id)
    spatial = controllerFrame(container, 'spatial', controllerId)
    expect(Number.parseFloat(spatial.style.left)).toBe(authoredLeft - 8)

    const currentBeforeFailure = structuredClone(session.navigator.current)
    const canGoBackBeforeFailure = session.navigator.canGoBack
    const resetSurface = session.player.resetSurface.bind(session.player)
    const resetSurfaceSpy = vi.spyOn(session.player, 'resetSurface')
      .mockImplementation(async (surfaceId, scope) => {
        if (surfaceId === flowLocation.surfaceId) {
          return {
            ok: false,
            failure: {
              surfaceId,
              kind: 'flow',
              phase: 'reset',
              error: new Error('forced Mixed reset failure'),
            },
          }
        }
        return resetSurface(surfaceId, scope)
      })
    await expect(session.restartCourse()).rejects.toThrow('forced Mixed reset failure')
    resetSurfaceSpy.mockRestore()

    expect(session.navigator.current).toEqual(currentBeforeFailure)
    expect(session.navigator.canGoBack).toBe(canGoBackBeforeFailure)
    spatial = controllerFrame(container, 'spatial', controllerId)
    expectCollapsed(spatial, false)
    expect(Number.parseFloat(spatial.style.left)).toBe(authoredLeft - 8)
    expect(globalInteractionFrame(container, 'spatial', GLOBAL_TARGET_ID)
      .dataset.interactionVisibility).toBe('visible')

    expect((await session.navigator.back())?.locationId).toBe(payload.startLocationId)
    slide = controllerFrame(container, 'slide', controllerId)
    expectCollapsed(slide, false)
    expect(Number.parseFloat(slide.style.left)).toBe(authoredLeft + 8)

    await session.goToLocation(flowLocation.id)
    flow = controllerFrame(container, 'flow', controllerId)
    expectCollapsed(flow, false)
    expect(Number.parseFloat(flow.style.left)).toBe(authoredLeft + 8)

    await session.goToLocation(spatialLocation.id)
    spatial = controllerFrame(container, 'spatial', controllerId)
    expectCollapsed(spatial, false)
    expect(Number.parseFloat(spatial.style.left)).toBe(authoredLeft - 8)
    const restart = spatial.querySelector<HTMLButtonElement>(
      `[data-controller-button-id="${restartButtonId}"]`,
    )
    if (!restart) throw new Error('expanded controller must expose course.restart')
    restart.click()

    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(payload.startLocationId)
      expectCollapsed(controllerFrame(container, 'slide', controllerId), true)
      expect(globalInteractionFrame(container, 'slide', GLOBAL_TARGET_ID)
        .dataset.interactionVisibility).toBe('hidden')
    })
    slide = controllerFrame(container, 'slide', controllerId)
    expect(Number.parseFloat(slide.style.left)).toBe(authoredLeft)

    await session.goToLocation(flowLocation.id)
    flow = controllerFrame(container, 'flow', controllerId)
    expectCollapsed(flow, true)
    expect(Number.parseFloat(flow.style.left)).toBe(authoredLeft)

    await session.goToLocation(spatialLocation.id)
    spatial = controllerFrame(container, 'spatial', controllerId)
    expectCollapsed(spatial, true)
    expect(Number.parseFloat(spatial.style.left)).toBe(authoredLeft)

    expect(project.revision).toBe(projectBefore.revision)
    expect(project).toEqual(projectBefore)
    expect(payload).toEqual(payloadBefore)
  })

  it('lets each Surface controller bypass one guard without leaking authority to public navigation', async () => {
    const payload = buildPublishedCourseV2Payload({
      project: mixedControllerProject(),
      assetFiles: {},
      components: {},
    })
    const [slideLocation, flowLocation, spatialLocation] = payload.locations
    if (
      slideLocation?.kind !== 'slide-scene'
      || flowLocation?.kind !== 'flow-block'
      || spatialLocation?.kind !== 'spatial-camera'
    ) throw new Error('fixture requires ordered Slide, Flow, and Spatial locations')
    payload.courseState = [{
      key: 'ready',
      valueType: 'boolean',
      defaultValue: false,
    }]
    payload.navigationGuards = [
      {
        id: 'block-slide-to-flow',
        effect: 'block',
        fromLocationIds: [slideLocation.id],
        toLocationIds: [flowLocation.id],
        match: 'all',
        conditions: [{
          type: 'compare',
          key: 'ready',
          operator: 'eq',
          value: false,
        }],
        message: 'Slide must stay guarded',
      },
      {
        id: 'block-flow-to-spatial',
        effect: 'block',
        fromLocationIds: [flowLocation.id],
        toLocationIds: [spatialLocation.id],
        match: 'all',
        conditions: [{
          type: 'compare',
          key: 'ready',
          operator: 'eq',
          value: false,
        }],
        message: 'Flow must stay guarded',
      },
      {
        id: 'block-spatial-to-flow',
        effect: 'block',
        fromLocationIds: [spatialLocation.id],
        toLocationIds: [flowLocation.id],
        match: 'all',
        conditions: [{
          type: 'compare',
          key: 'ready',
          operator: 'eq',
          value: false,
        }],
        message: 'Spatial must stay guarded',
      },
      {
        id: 'block-flow-to-slide',
        effect: 'block',
        fromLocationIds: [flowLocation.id],
        toLocationIds: [slideLocation.id],
        match: 'all',
        conditions: [{
          type: 'compare',
          key: 'ready',
          operator: 'eq',
          value: false,
        }],
        message: 'Flow-to-Slide must stay guarded',
      },
    ]
    const controllerEntry = payload.globalLayerItems.find((entry) => (
      entry.item.kind === 'native'
      && entry.item.content.nativeType === 'teacher-controller'
    ))
    if (
      !controllerEntry
      || controllerEntry.item.kind !== 'native'
      || controllerEntry.item.content.nativeType !== 'teacher-controller'
    ) throw new Error('fixture requires a global teacher controller')
    const controllerId = controllerEntry.item.layerItemId
    controllerEntry.item.content.data.defaultCollapsed = false
    const nextButton = controllerEntry.item.content.data.buttons.find(
      (button) => button.action.type === 'scene.next',
    )
    const previousButton = controllerEntry.item.content.data.buttons.find(
      (button) => button.action.type === 'scene.previous',
    )
    if (!nextButton || !previousButton) throw new Error('fixture requires next/previous controls')
    nextButton.visible = true
    previousButton.visible = true
    const goToSlideButtonId = 'controller-go-to-slide'
    controllerEntry.item.content.data.buttons.push({
      id: goToSlideButtonId,
      action: { type: 'scene.go', sceneId: slideLocation.sceneId },
      label: 'Go to Slide',
      visible: true,
    })
    const reportDiagnostic = vi.fn()
    const session = createPublishedCourseSession(payload, {
      services: { reportDiagnostic },
    })
    sessions.push(session)
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)

    const clickControllerButton = (
      kind: 'slide' | 'flow' | 'spatial',
      buttonId: string,
    ): void => {
      const button = controllerFrame(container, kind, controllerId)
        .querySelector<HTMLButtonElement>(`[data-controller-button-id="${buttonId}"]`)
      if (!button) throw new Error(`missing ${kind} controller button ${buttonId}`)
      button.click()
    }

    await expect(session.goToLocation(flowLocation.id)).rejects.toThrow('Slide must stay guarded')
    expect(session.navigator.current?.locationId).toBe(slideLocation.id)
    const activateSurfaceSpy = vi.spyOn(session.player, 'activateSurface')
      .mockRejectedValueOnce(new Error('forced controller navigation failure'))
    clickControllerButton('slide', nextButton.id)
    await vi.waitFor(() => {
      expect(session.navigator.hasPendingNavigation).toBe(false)
      expect(session.navigator.current?.locationId).toBe(slideLocation.id)
      expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('forced controller navigation failure'),
      }))
    })
    activateSurfaceSpy.mockRestore()
    await expect(session.goToLocation(flowLocation.id)).rejects.toThrow('Slide must stay guarded')
    expect(session.navigator.current?.locationId).toBe(slideLocation.id)
    clickControllerButton('slide', nextButton.id)
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(flowLocation.id)
    })

    await expect(session.goToLocation(spatialLocation.id)).rejects.toThrow('Flow must stay guarded')
    expect(session.navigator.current?.locationId).toBe(flowLocation.id)
    clickControllerButton('flow', nextButton.id)
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(spatialLocation.id)
    })

    await expect(session.goToLocation(flowLocation.id)).rejects.toThrow('Spatial must stay guarded')
    expect(session.navigator.current?.locationId).toBe(spatialLocation.id)
    clickControllerButton('spatial', previousButton.id)
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(flowLocation.id)
    })

    await expect(session.goToLocation(slideLocation.id)).rejects.toThrow('Flow-to-Slide must stay guarded')
    expect(session.navigator.current?.locationId).toBe(flowLocation.id)
    clickControllerButton('flow', goToSlideButtonId)
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(slideLocation.id)
    })

    await expect(session.goToLocation(flowLocation.id)).rejects.toThrow('Slide must stay guarded')
    expect(session.navigator.current?.locationId).toBe(slideLocation.id)
    const navigationWarnings = reportDiagnostic.mock.calls.filter(([diagnostic]) => (
      diagnostic.severity === 'warning'
    ))
    expect(navigationWarnings).toHaveLength(6)
    expect(reportDiagnostic).toHaveBeenLastCalledWith(expect.objectContaining({
      severity: 'warning',
      message: 'Slide must stay guarded',
    }))
  })
})
