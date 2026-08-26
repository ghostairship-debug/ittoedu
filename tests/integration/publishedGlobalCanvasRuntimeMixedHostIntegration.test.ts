import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({}))
import { createPublishedCourseSession, type PublishedCourseSession } from '@/player/surfaces/publishedDynamicHosts'
import { PublishedGlobalCanvasRuntimeOwner } from '@/player/surfaces/runtime/publishedGlobalCanvasRuntimeOwner'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type {
  InteractionActionStep,
  InteractionRule,
  NodeMotionAction,
} from '@/shared/contracts/interaction-v1/types'
import type {
  PublishedNativeLayerItem,
  PublishedRuntimeLayerItem,
  PublishedScopedLayerItem,
} from '@/shared/publishedCourseTypes'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const sessions: PublishedCourseSession[] = []

const interactionTextStyle = {
  fontFamily: 'sans-serif',
  fontSize: 20,
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

function interactionTrigger(id: string, order: number): PublishedScopedLayerItem {
  const item: PublishedNativeLayerItem = {
    layerItemId: id,
    kind: 'native',
    frame: { mode: 'absolute', x: order === 9_001 ? 400 : 560, y: 56, width: 120, height: 48 },
    order,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    content: {
      nativeType: 'text',
      data: { text: id, runs: [], style: interactionTextStyle },
    },
  }
  return { item, visibility: { mode: 'all', locationIds: [] } }
}

function visibilityRule(
  id: string,
  triggerId: string,
  runtimeId: string,
  type: NodeMotionAction['type'],
): InteractionRule {
  const action: NodeMotionAction = {
    type,
    nodeId: runtimeId,
    durationMs: 0,
    easing: 'linear',
    effect: 'none',
  }
  const step: InteractionActionStep = {
    id: `${id}-step`,
    start: 'after-previous',
    delayMs: 0,
    action,
  }
  return {
    id,
    enabled: true,
    trigger: { type: 'node.click', nodeId: triggerId },
    conditions: [],
    actions: [step],
  }
}

function mountDocument(): { frame: HTMLIFrameElement; container: HTMLElement; view: Window } {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  const frameDocument = frame.contentDocument
  const view = frame.contentWindow
  if (!frameDocument || !view) throw new Error('JSDOM iframe realm unavailable')
  const FrameHTMLElement = Reflect.get(view, 'HTMLElement') as typeof HTMLElement | undefined
  if (FrameHTMLElement && typeof FrameHTMLElement.prototype.scrollIntoView !== 'function') {
    FrameHTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
  }
  const container = frameDocument.createElement('div')
  Object.defineProperties(container, {
    clientWidth: { configurable: true, value: 1280 },
    clientHeight: { configurable: true, value: 720 },
  })
  frameDocument.body.appendChild(container)
  return { frame, container, view }
}

function globalProbeSource(): string {
  return `
    CoursewareRuntime.define({
      runtimeApiVersion: 2,
      create(ctx) {
        var probe = window.__publishedGlobalApi2Probe || {
          creates: 0, destroys: 0, suspends: 0, resumes: 0,
          visibleFalse: 0, visibleTrue: 0, scopes: [], contexts: []
        };
        window.__publishedGlobalApi2Probe = probe;
        probe.creates += 1;
        probe.scopes.push(ctx.scope);
        probe.contexts.push({ courseState: ctx.courseState, actions: ctx.actions });
        var count = 0;
        var button = document.createElement('button');
        button.dataset.publishedGlobalApi2Button = 'true';
        button.textContent = 'global:' + count;
        button.style.pointerEvents = 'auto';
        button.addEventListener('click', function () {
          count += 1;
          button.textContent = 'global:' + count;
        });
        ctx.dom.root.appendChild(button);
        return {
          setVisible(value) { value ? probe.visibleTrue += 1 : probe.visibleFalse += 1; },
          suspend() { probe.suspends += 1; },
          resume() { probe.resumes += 1; },
          destroy() {
            probe.destroys += 1;
            button.remove();
          }
        };
      }
    });
  `
}

function lifecycleFailureSource(): string {
  return `
    CoursewareRuntime.define({
      runtimeApiVersion: 2,
      create(ctx) {
        window.__publishedGlobalLifecycleCreates =
          (window.__publishedGlobalLifecycleCreates || 0) + 1;
        var marker = document.createElement('div');
        marker.dataset.publishedGlobalLifecycleMarker = 'true';
        ctx.dom.root.appendChild(marker);
        return {
          suspend() { throw new Error('global suspend failed intentionally'); },
          destroy() {
            window.__publishedGlobalLifecycleDestroys =
              (window.__publishedGlobalLifecycleDestroys || 0) + 1;
            marker.remove();
          }
        };
      }
    });
  `
}

function cloneRuntime(
  source: RuntimeLayerItem,
  itemId: string,
  runtimeSource: string,
  order: number,
): RuntimeLayerItem {
  const item = structuredClone(source)
  item.layerItemId = itemId
  item.label = itemId
  item.order = order
  item.runtime.source = runtimeSource
  item.frame = { mode: 'absolute', x: 48, y: 56, width: 320, height: 144 }
  item.hitPolicy = 'auto'
  return item
}

function mixedGlobalRuntimeProject(): {
  project: CourseProjectDocument
  slideLocationIds: readonly string[]
  flowLocationId: string
  spatialLocationId: string
  controllerId: string
  restartButtonId: string
} {
  const fixture = createPublishedCanvasRuntimeV2Fixture([
    { itemId: 'global-template-one', renderMode: 'dom', source: globalProbeSource() },
    { itemId: 'global-template-two', renderMode: 'dom', source: globalProbeSource() },
  ], { includeFlow: true, includeSpatial: true })
  if (!fixture.flowLocationId || !fixture.spatialLocationId) {
    throw new Error('expected true Mixed fixture')
  }
  const project = structuredClone(fixture.project)
  const controller = project.globalLayerItems.find((entry) => (
    entry.item.kind === 'native'
    && entry.item.content.nativeType === 'teacher-controller'
  ))
  if (
    !controller
    || controller.item.kind !== 'native'
    || controller.item.content.nativeType !== 'teacher-controller'
  ) throw new Error('expected global teacher controller')
  controller.item.content.data.defaultCollapsed = false
  const restartButton = controller.item.content.data.buttons.find(
    (button) => button.action.type === 'course.restart',
  )
  if (!restartButton) throw new Error('expected course.restart controller button')
  restartButton.visible = true
  const slide = project.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
  if (!slide || slide.type !== 'slide') throw new Error('expected Slide fixture')
  const authored = slide.scenes[0]?.layerItems.find(
    (item): item is RuntimeLayerItem => item.kind === 'runtime',
  )
  if (!authored) throw new Error('expected authored Runtime template')
  for (const scene of slide.scenes) {
    scene.layerItems = scene.layerItems.filter((item) => item.kind !== 'runtime')
  }

  const healthy = cloneRuntime(authored, 'global-api2-healthy', globalProbeSource(), 410)
  const registerFailure = cloneRuntime(authored, 'global-api2-register-failure', `
    window.__publishedGlobalRegisterAttempts =
      (window.__publishedGlobalRegisterAttempts || 0) + 1;
  `, 420)
  const createFailure = cloneRuntime(authored, 'global-api2-create-failure', `
    CoursewareRuntime.define({runtimeApiVersion:2,create(){
      window.__publishedGlobalCreateAttempts =
        (window.__publishedGlobalCreateAttempts || 0) + 1;
      throw new Error('global create failed intentionally');
    }});
  `, 430)
  const lifecycleFailure = cloneRuntime(
    authored,
    'global-api2-lifecycle-failure',
    lifecycleFailureSource(),
    440,
  )
  const disabled = cloneRuntime(authored, 'global-api2-disabled', `
    window.__publishedGlobalDisabledExecuted = true;
    CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}});
  `, 450)
  disabled.runtime.enabled = false
  const api3 = cloneRuntime(authored, 'global-api3-fallback', `
    window.__publishedGlobalApi3Executed = true;
    CoursewareRuntime.define({runtimeApiVersion:3,protocol:'surface-runtime',create(){
      return {destroy(){}};
    }});
  `, 460)
  api3.runtime.protocol = 'surface-runtime'
  api3.runtime.runtimeApiVersion = 3
  api3.runtime.renderMode = 'dom'

  project.globalLayerItems.push(...[
    healthy,
    registerFailure,
    createFailure,
    lifecycleFailure,
    disabled,
    api3,
  ].map((item) => ({ item, visibility: { mode: 'all' as const, locationIds: [] } })))
  return {
    project: courseProjectDocumentSchema.parse(project),
    slideLocationIds: fixture.slideLocationIds,
    flowLocationId: fixture.flowLocationId,
    spatialLocationId: fixture.spatialLocationId,
    controllerId: controller.item.layerItemId,
    restartButtonId: restartButton.id,
  }
}

function globalWrapper(
  container: HTMLElement,
  surfaceId: string,
  itemId: string,
): HTMLElement {
  const slot = container.querySelector<HTMLElement>(`[data-course-surface-slot="${surfaceId}"]`)
  if (!slot) throw new Error(`missing Surface slot ${surfaceId}`)
  const wrapper = [...slot.querySelectorAll<HTMLElement>('[data-layer-source="global"], [data-flow-overlay-source="global"]')]
    .find((candidate) => (
      candidate.dataset.globalLayerItem === itemId
      || candidate.dataset.flowOverlayItem === itemId
      || candidate.dataset.layerItemId === itemId
    ))
  if (!wrapper) throw new Error(`missing global wrapper ${itemId} on ${surfaceId}`)
  return wrapper
}

function runtimeButton(inner: HTMLElement): HTMLButtonElement | null {
  for (const mount of inner.querySelectorAll<HTMLElement>('.lesson-runtime-mount')) {
    const button = mount.shadowRoot?.querySelector<HTMLButtonElement>(
      '[data-published-global-api2-button="true"]',
    )
    if (button) return button
  }
  return null
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  document.body.replaceChildren()
})

describe('Published V2 session-global canvas-runtime API 2 ownership', () => {
  it('composes hidden/exit/enter pointer state on Slide, Flow and Spatial without activating fallbacks', async () => {
    const fixture = mixedGlobalRuntimeProject()
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const healthy = payload.globalLayerItems.find((entry): entry is PublishedScopedLayerItem & {
      item: PublishedRuntimeLayerItem
    } => entry.item.kind === 'runtime' && entry.item.layerItemId === 'global-api2-healthy')
    if (!healthy) throw new Error('missing healthy Published global Runtime')
    healthy.item.playbackInitialVisibility = 'hidden'
    const hitNone = structuredClone(healthy)
    hitNone.item.layerItemId = 'global-api2-hit-none'
    hitNone.item.order = 8_500
    hitNone.item.hitPolicy = 'pass-through'
    payload.globalLayerItems.push(
      hitNone,
      interactionTrigger('global-runtime-enter', 9_001),
      interactionTrigger('global-runtime-exit', 9_002),
    )
    payload.globalInteractions.push(
      visibilityRule(
        'global-runtime-enter-rule',
        'global-runtime-enter',
        healthy.item.layerItemId,
        'node.enter',
      ),
      visibilityRule(
        'global-runtime-exit-rule',
        'global-runtime-exit',
        healthy.item.layerItemId,
        'node.exit',
      ),
      visibilityRule(
        'global-runtime-hit-none-enter-rule',
        'global-runtime-enter',
        hitNone.item.layerItemId,
        'node.enter',
      ),
      visibilityRule(
        'global-runtime-hit-none-exit-rule',
        'global-runtime-exit',
        hitNone.item.layerItemId,
        'node.exit',
      ),
      visibilityRule(
        'global-runtime-fallback-enter-rule',
        'global-runtime-enter',
        'global-api2-create-failure',
        'node.enter',
      ),
      visibilityRule(
        'global-runtime-fallback-exit-rule',
        'global-runtime-exit',
        'global-api2-create-failure',
        'node.exit',
      ),
    )
    const { frame, container } = mountDocument()
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    await session.mount(container)

    const locations = [
      fixture.slideLocationIds[0]!,
      fixture.flowLocationId,
      fixture.spatialLocationId,
    ]
    for (const [index, locationId] of locations.entries()) {
      if (index > 0) await session.goToLocation(locationId)
      const surfaceId = session.navigator.current!.surfaceId
      const wrapper = globalWrapper(container, surfaceId, healthy.item.layerItemId)
      const hitNoneWrapper = globalWrapper(container, surfaceId, hitNone.item.layerItemId)
      const failed = globalWrapper(container, surfaceId, 'global-api2-create-failure')

      expect(wrapper.dataset.interactionVisibility).toBe('hidden')
      expect(wrapper.style.visibility).toBe('hidden')
      expect(wrapper.style.pointerEvents).toBe('none')
      expect(hitNoneWrapper.dataset.interactionVisibility).toBe('hidden')
      expect(hitNoneWrapper.dataset.publishedGlobalRuntimeHitPolicy).toBe('pass-through')
      expect(hitNoneWrapper.style.pointerEvents).toBe('none')
      await vi.waitFor(() => {
        expect(failed.dataset.globalRuntimeState).toBe('fallback')
        expect(failed.dataset.publishedGlobalRuntimeHitPolicy).toBe('auto')
        expect(failed.style.pointerEvents).toBe('none')
      })

      globalWrapper(container, surfaceId, 'global-runtime-enter').click()
      await vi.waitFor(() => {
        expect(wrapper.dataset.interactionVisibility).toBe('visible')
        expect(wrapper.style.visibility).toBe('visible')
        expect(wrapper.style.pointerEvents).toBe('auto')
        expect(hitNoneWrapper.dataset.interactionVisibility).toBe('visible')
        expect(hitNoneWrapper.style.pointerEvents).toBe('none')
        expect(failed.dataset.interactionVisibility).toBe('visible')
        expect(failed.style.pointerEvents).toBe('none')
      })

      globalWrapper(container, surfaceId, 'global-runtime-exit').click()
      await vi.waitFor(() => {
        expect(wrapper.dataset.interactionVisibility).toBe('hidden')
        expect(wrapper.style.visibility).toBe('hidden')
        expect(wrapper.style.pointerEvents).toBe('none')
        expect(hitNoneWrapper.dataset.interactionVisibility).toBe('hidden')
        expect(hitNoneWrapper.style.pointerEvents).toBe('none')
        expect(failed.dataset.interactionVisibility).toBe('hidden')
        expect(failed.style.pointerEvents).toBe('none')
      })
      expect(failed.style.pointerEvents).toBe('none')
    }

    const spatialSurfaceId = session.navigator.current!.surfaceId
    const spatialWrapper = globalWrapper(container, spatialSurfaceId, healthy.item.layerItemId)
    globalWrapper(container, spatialSurfaceId, 'global-runtime-enter').click()
    await vi.waitFor(() => expect(spatialWrapper.style.pointerEvents).toBe('auto'))
    expect(globalWrapper(container, spatialSurfaceId, hitNone.item.layerItemId)
      .style.pointerEvents).toBe('none')
    expect(globalWrapper(container, spatialSurfaceId, 'global-api2-create-failure')
      .style.pointerEvents).toBe('none')

    await session.destroy()
    sessions.splice(sessions.indexOf(session), 1)
    frame.remove()
  })

  it('moves one instance through Slide, Flow and Spatial wrappers and rebuilds only on restart', async () => {
    const fixture = mixedGlobalRuntimeProject()
    fixture.project.courseState = [{
      key: 'restart-probe',
      valueType: 'string',
      defaultValue: 'default',
    }]
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const before = structuredClone(payload)
    const diagnostics: string[] = []
    const { frame, container, view } = mountDocument()
    const session = createPublishedCourseSession(payload, {
      services: {
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.message),
      },
    })
    sessions.push(session)
    await session.mount(container)

    await vi.waitFor(() => {
      expect(Reflect.get(view, '__publishedGlobalApi2Probe')).toMatchObject({
        creates: 1,
        destroys: 0,
        scopes: ['global'],
      })
      expect(Reflect.get(view, '__publishedGlobalRegisterAttempts')).toBe(1)
      expect(Reflect.get(view, '__publishedGlobalCreateAttempts')).toBe(1)
      expect(Reflect.get(view, '__publishedGlobalLifecycleCreates')).toBe(1)
    })
    expect(Reflect.get(view, '__publishedGlobalDisabledExecuted')).toBeUndefined()
    expect(Reflect.get(view, '__publishedGlobalApi3Executed')).toBeUndefined()

    const slideSurfaceId = session.navigator.current!.surfaceId
    await vi.waitFor(() => {
      for (const itemId of ['global-api2-register-failure', 'global-api2-create-failure']) {
        const wrapper = globalWrapper(container, slideSurfaceId, itemId)
        expect(wrapper.dataset.globalRuntimeState).toBe('fallback')
        expect(wrapper.style.pointerEvents).toBe('none')
        expect(wrapper.querySelectorAll('[data-runtime-fallback="true"]')).toHaveLength(1)
      }
    })
    expect(diagnostics.filter((message) => message.includes('register失败'))).toHaveLength(1)
    expect(diagnostics.filter((message) => message.includes('create失败'))).toHaveLength(1)
    expect(globalWrapper(container, slideSurfaceId, 'global-api2-disabled')
      .dataset.slideRuntimeState).toBe('disabled')
    expect(globalWrapper(container, slideSurfaceId, 'global-api3-fallback')
      .dataset.slideRuntimeState).toBe('fallback')
    expect(container.querySelector(
      '[data-published-global-runtime-inner="global-api2-disabled"], '
      + '[data-published-global-runtime-inner="global-api3-fallback"]',
    )).toBeNull()

    const slideWrapper = globalWrapper(container, slideSurfaceId, 'global-api2-healthy')
    const inner = slideWrapper.querySelector<HTMLElement>(
      '[data-published-global-runtime-inner="global-api2-healthy"]',
    )
    if (!inner) throw new Error('missing global Runtime inner')
    const button = runtimeButton(inner)
    if (!button) throw new Error('missing global Runtime button')
    expect(slideWrapper.style.left).toBe('48px')
    expect(slideWrapper.style.top).toBe('56px')
    expect(slideWrapper.style.zIndex).toBe('410')
    expect(slideWrapper.style.pointerEvents).toBe('auto')
    expect(slideWrapper.style.padding).toBe('')
    expect(slideWrapper.querySelector('[data-runtime-fallback="true"]')).toBeNull()
    expect(slideWrapper.dataset.globalRuntimeState).toBe('playback')
    button.click()
    expect(button.textContent).toBe('global:1')

    await session.goToLocation(fixture.slideLocationIds[1]!)
    const secondSlideWrapper = globalWrapper(container, slideSurfaceId, 'global-api2-healthy')
    expect(secondSlideWrapper.firstElementChild).toBe(inner)
    expect(runtimeButton(inner)).toBe(button)
    expect(button.textContent).toBe('global:1')

    const currentBeforeFailure = structuredClone(session.navigator.current)
    const setSurfaceLocation = session.player.setSurfaceLocation.bind(session.player)
    const failedTargetSurfaceId = payload.locations.find(
      (location) => location.id === fixture.flowLocationId,
    )!.surfaceId
    const setLocationSpy = vi.spyOn(session.player, 'setSurfaceLocation')
      .mockImplementation(async (surfaceId, locationId) => (
        surfaceId === failedTargetSurfaceId
          ? {
              ok: false,
              failure: {
                surfaceId,
                kind: 'flow',
                phase: 'execute',
                error: new Error('forced global Runtime navigation rollback'),
              },
            }
          : setSurfaceLocation(surfaceId, locationId)
      ))
    await expect(session.goToLocation(fixture.flowLocationId)).rejects.toThrow(
      'forced global Runtime navigation rollback',
    )
    setLocationSpy.mockRestore()
    expect(session.navigator.current).toEqual(currentBeforeFailure)
    const restoredSlideWrapper = globalWrapper(container, slideSurfaceId, 'global-api2-healthy')
    expect(restoredSlideWrapper.firstElementChild).toBe(inner)
    expect(restoredSlideWrapper.dataset.globalRuntimeState).toBe('playback')
    expect(restoredSlideWrapper.style.pointerEvents).toBe('auto')
    expect(runtimeButton(inner)).toBe(button)
    expect(globalWrapper(container, failedTargetSurfaceId, 'global-api2-healthy')
      .querySelector('[data-published-global-runtime-inner]')).toBeNull()

    await session.goToLocation(fixture.flowLocationId)
    const flowSurfaceId = session.navigator.current!.surfaceId
    const flowWrapper = globalWrapper(container, flowSurfaceId, 'global-api2-healthy')
    expect(flowWrapper.firstElementChild).toBe(inner)
    expect(flowWrapper.style.left).toBe('48px')
    expect(flowWrapper.style.top).toBe('56px')
    expect(flowWrapper.style.zIndex).toBe('410')
    expect(flowWrapper.style.pointerEvents).toBe('auto')
    expect(runtimeButton(inner)).toBe(button)

    await vi.waitFor(() => {
      expect(globalWrapper(
        container,
        flowSurfaceId,
        'global-api2-lifecycle-failure',
      ).querySelectorAll('[data-runtime-fallback="true"]')).toHaveLength(1)
    })
    expect(Reflect.get(view, '__publishedGlobalLifecycleDestroys')).toBe(1)
    expect(diagnostics.filter((message) => message.includes('lifecycle失败'))).toHaveLength(1)

    await session.goToLocation(fixture.spatialLocationId)
    const spatialSurfaceId = session.navigator.current!.surfaceId
    const spatialWrapper = globalWrapper(container, spatialSurfaceId, 'global-api2-healthy')
    expect(spatialWrapper.firstElementChild).toBe(inner)
    expect(spatialWrapper.style.left).toBe('48px')
    expect(spatialWrapper.style.top).toBe('56px')
    expect(spatialWrapper.style.zIndex).toBe('410')
    expect(runtimeButton(inner)).toBe(button)

    await session.goToLocation(fixture.slideLocationIds[0]!)
    expect(globalWrapper(container, slideSurfaceId, 'global-api2-healthy').firstElementChild)
      .toBe(inner)
    expect(runtimeButton(inner)).toBe(button)
    expect(button.textContent).toBe('global:1')

    await session.navigator.goToLocation(fixture.slideLocationIds[0]!, {
      force: true,
      recordHistory: false,
    })
    expect(runtimeButton(inner)).toBe(button)
    await session.navigator.resetCurrentSurface()
    expect(runtimeButton(inner)).toBe(button)
    expect(Reflect.get(view, '__publishedGlobalApi2Probe')).toMatchObject({
      creates: 1,
      destroys: 0,
    })

    const beforeRestartProbe = Reflect.get(view, '__publishedGlobalApi2Probe') as {
      contexts: Array<{
        courseState: {
          get(key: string): unknown
          set(key: string, value: unknown): void
        }
        actions: { nextScene(): boolean }
      }>
    }
    const staleContext = beforeRestartProbe.contexts.at(-1)!
    staleContext.courseState.set('restart-probe', 'before-restart')
    expect(staleContext.courseState.get('restart-probe')).toBe('before-restart')

    const resetCourse = session.player.resetCourse.bind(session.player)
    let releaseReset: () => void = () => {}
    const resetGate = new Promise<void>((resolve) => {
      releaseReset = resolve
    })
    const resetSpy = vi.spyOn(session.player, 'resetCourse').mockImplementation(async () => {
      await resetGate
      return resetCourse()
    })
    const restart = session.restartCourse()
    await vi.waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1))
    expect(staleContext.courseState.get('restart-probe')).toBe('default')
    staleContext.courseState.set('restart-probe', 'stale-write')
    expect(staleContext.courseState.get('restart-probe')).toBe('default')
    expect(staleContext.actions.nextScene()).toBe(false)
    releaseReset()
    await restart
    resetSpy.mockRestore()
    const immediateRestartInner = globalWrapper(
      container,
      slideSurfaceId,
      'global-api2-healthy',
    ).querySelector<HTMLElement>('[data-published-global-runtime-inner="global-api2-healthy"]')
    expect(immediateRestartInner).not.toBeNull()
    expect(immediateRestartInner).not.toBe(inner)
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__publishedGlobalApi2Probe')).toMatchObject({
        creates: 2,
        destroys: 1,
        scopes: ['global', 'global'],
      })
    })
    const restartedInner = globalWrapper(
      container,
      slideSurfaceId,
      'global-api2-healthy',
    ).querySelector<HTMLElement>('[data-published-global-runtime-inner="global-api2-healthy"]')
    if (!restartedInner) throw new Error('missing restarted global Runtime inner')
    const restartedButton = runtimeButton(restartedInner)
    expect(restartedInner).not.toBe(inner)
    expect(restartedButton).not.toBe(button)
    expect(restartedButton?.textContent).toBe('global:0')
    const restartedProbe = Reflect.get(view, '__publishedGlobalApi2Probe') as {
      contexts: Array<{ courseState: { get(key: string): unknown; set(key: string, value: unknown): void } }>
    }
    const restartedContext = restartedProbe.contexts.at(-1)!
    expect(restartedContext).not.toBe(staleContext)
    expect(restartedContext.courseState.get('restart-probe')).toBe('default')
    restartedContext.courseState.set('restart-probe', 'fresh-write')
    expect(restartedContext.courseState.get('restart-probe')).toBe('fresh-write')

    const controllerFrame = globalWrapper(container, slideSurfaceId, fixture.controllerId)
    const controllerRestart = controllerFrame.querySelector<HTMLButtonElement>(
      `[data-controller-button-id="${fixture.restartButtonId}"]`,
    )
    if (!controllerRestart) throw new Error('missing controller restart button')
    controllerRestart.click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe(payload.startLocationId)
      expect(Reflect.get(view, '__publishedGlobalApi2Probe')).toMatchObject({
        creates: 3,
        destroys: 2,
        scopes: ['global', 'global', 'global'],
      })
    })
    const controllerRestartInner = globalWrapper(
      container,
      slideSurfaceId,
      'global-api2-healthy',
    ).querySelector<HTMLElement>('[data-published-global-runtime-inner="global-api2-healthy"]')
    expect(controllerRestartInner).not.toBeNull()
    expect(controllerRestartInner).not.toBe(restartedInner)

    const probe = Reflect.get(view, '__publishedGlobalApi2Probe') as {
      suspends: number
      resumes: number
      visibleFalse: number
      visibleTrue: number
    }
    expect(probe.suspends).toBeGreaterThanOrEqual(6)
    expect(probe.resumes).toBeGreaterThanOrEqual(6)
    expect(probe.visibleFalse).toBeGreaterThanOrEqual(6)
    expect(probe.visibleTrue).toBeGreaterThanOrEqual(6)
    expect(container.querySelectorAll(
      '[data-global-runtime-state="fallback"] [data-runtime-fallback="true"]',
    ).length).toBeGreaterThanOrEqual(2)
    expect(payload).toEqual(before)

    await session.destroy()
    await session.destroy()
    sessions.splice(sessions.indexOf(session), 1)
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__publishedGlobalApi2Probe')).toMatchObject({
        creates: 3,
        destroys: 3,
      })
    })
    expect(container.querySelector('[data-published-global-runtime-inner]')).toBeNull()
    frame.remove()
  })

  it('does not attach or execute after an owner is destroyed during async initialization', async () => {
    const fixture = mixedGlobalRuntimeProject()
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const { frame, container, view } = mountDocument()
    const target = container.ownerDocument.createElement('div')
    container.appendChild(target)
    const services = {
      navigate: () => undefined,
      getCourseState: () => undefined,
      setCourseState: () => undefined,
      resolveAsset: (assetId: string) => payload.assets[assetId]?.url,
    }
    const owner = new PublishedGlobalCanvasRuntimeOwner({
      payload,
      hosts: [{
        id: payload.surfaces[0]!.id,
        getPublishedGlobalRuntimeMountTarget: () => target,
      }],
      services,
      resolveAsset: services.resolveAsset,
    })

    owner.mount(container.ownerDocument)
    owner.destroy()
    owner.moveTo(payload.surfaces[0]!.id)
    await Promise.resolve()
    await Promise.resolve()

    expect(Reflect.get(view, '__publishedGlobalApi2Probe')).toBeUndefined()
    expect(target.querySelector('[data-published-global-runtime-inner]')).toBeNull()
    expect(container.querySelector('.published-canvas-runtime-mount')).toBeNull()
    frame.remove()
  })
})
