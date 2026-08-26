import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => ({}))
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { mountPublishedCourseTryRun } from '@/renderer/ui/coursePlayerTryRun'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '@/player/surfaces/publishedDynamicHosts'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

const sessions: PublishedCourseSession[] = []

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

function installStaticCaptureHarness(view: Window): void {
  const FrameHTMLElement = Reflect.get(view, 'HTMLElement') as typeof HTMLElement
  const FrameCanvas = Reflect.get(view, 'HTMLCanvasElement') as typeof HTMLCanvasElement
  Object.defineProperty(FrameHTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement): DOMRect {
      const width = Number.parseFloat(this.style.width) || 100
      const height = Number.parseFloat(this.style.height) || 100
      const left = Number.parseFloat(this.style.left) || 0
      const top = Number.parseFloat(this.style.top) || 0
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect
    },
  })
  Object.defineProperty(FrameCanvas.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement, type: string): CanvasRenderingContext2D | null {
      if (type !== '2d') return null
      return {
        canvas: this,
        globalAlpha: 1,
        fillStyle: '#000000',
        strokeStyle: '#000000',
        lineWidth: 1,
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        direction: 'ltr',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        save() {},
        restore() {},
        scale() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        rect() {},
        roundRect() {},
        clip() {},
        stroke() {},
        translate() {},
        rotate() {},
        fillText() {},
        drawImage() {},
        createLinearGradient() {
          return { addColorStop() {} } as CanvasGradient
        },
      } as unknown as CanvasRenderingContext2D
    },
  })
  Object.defineProperty(FrameCanvas.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/png;base64,AA==',
  })
}

function runtimeShadowNode(
  container: HTMLElement,
  itemId: string,
  selector: string,
): Element | null {
  const wrap = container.querySelector(`[data-slide-layer-item="${itemId}"]`)
  for (const mount of wrap?.querySelectorAll<HTMLElement>('.lesson-runtime-mount') ?? []) {
    const node = mount.shadowRoot?.querySelector(selector)
    if (node) return node
  }
  return null
}

function domProbeSource(key: string): string {
  return `
    CoursewareRuntime.define({
      runtimeApiVersion: 2,
      create(ctx) {
        var key = ${JSON.stringify(key)};
        var state = window[key] || {
          creates: 0, destroys: 0, suspends: 0, resumes: 0,
          visibleFalse: 0, visibleTrue: 0, busCalls: 0, staleCalls: 0
        };
        window[key] = state;
        state.creates += 1;
        var alive = true;
        var button = document.createElement('button');
        button.dataset.publishedCanvasRuntimeButton = key;
        button.textContent = key;
        button.style.pointerEvents = 'auto';
        ctx.dom.root.appendChild(button);
        var listener = function () {
          if (alive) state.busCalls += 1;
          else state.staleCalls += 1;
        };
        ctx.events.on('canvas:probe', listener);
        state.emit = function () { ctx.events.emit('canvas:probe'); };
        var raf = window.requestAnimationFrame(function tick() {
          if (!alive) state.staleCalls += 1;
          else raf = window.requestAnimationFrame(tick);
        });
        return {
          setVisible(value) { value ? state.visibleTrue += 1 : state.visibleFalse += 1; },
          suspend() { state.suspends += 1; },
          resume() { state.resumes += 1; },
          destroy() {
            if (!alive) throw new Error('double destroy');
            alive = false;
            state.destroys += 1;
            window.cancelAnimationFrame(raf);
            button.remove();
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
  enabled = true,
): RuntimeLayerItem {
  const item = structuredClone(source)
  item.layerItemId = itemId
  item.label = itemId
  item.order = order
  item.runtime.enabled = enabled
  item.runtime.source = runtimeSource
  return item
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  document.body.replaceChildren()
})

describe('Published V2 Slide scene canvas-runtime API 2 playback', () => {
  it('runs the real template/source authoring output only at the requested try-run location', async () => {
    const fixture = createPublishedCanvasRuntimeV2Fixture([
      {
        itemId: 'authored-first-dom',
        renderMode: 'dom',
        source: domProbeSource('__authoredFirstDom'),
      },
      {
        itemId: 'authored-target-dom',
        renderMode: 'dom',
        source: domProbeSource('__authoredTargetDom'),
      },
    ])
    const before = structuredClone(fixture.project)
    const { frame, container, view } = mountDocument()
    const session = await mountPublishedCourseTryRun({
      container,
      project: fixture.project,
      assetFiles: {},
      components: {},
      locationId: fixture.slideLocationIds[1]!,
    })
    sessions.push(session)

    expect(session.navigator.current?.locationId).toBe(fixture.slideLocationIds[1])
    expect(Reflect.get(view, '__authoredFirstDom')).toBeUndefined()
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__authoredTargetDom')).toMatchObject({ creates: 1, destroys: 0 })
    })
    expect(Reflect.has(view, 'CoursewareRuntime')).toBe(false)
    expect(runtimeShadowNode(
      container,
      'authored-target-dom',
      '[data-published-canvas-runtime-button="__authoredTargetDom"]',
    )).not.toBeNull()
    expect(fixture.project).toEqual(before)
    frame.remove()
  })

  it('rebuilds per location generation, suspends across Surface leave, resets, and isolates failures', async () => {
    const fixture = createPublishedCanvasRuntimeV2Fixture([
      {
        itemId: 'authored-scene-one',
        renderMode: 'dom',
        source: domProbeSource('__canvasSceneOne'),
      },
      {
        itemId: 'authored-scene-two',
        renderMode: 'dom',
        source: domProbeSource('__canvasSceneTwo'),
      },
    ], { includeFlow: true })
    if (!fixture.flowLocationId) throw new Error('expected Flow location')
    const project = structuredClone(fixture.project)
    const slide = project.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
    const flow = project.surfaces.find((surface) => surface.type === 'flow')
    if (!slide || slide.type !== 'slide' || !flow || flow.type !== 'flow') {
      throw new Error('expected Slide/Flow fixture')
    }
    const firstScene = slide.scenes[0]!
    const secondScene = slide.scenes[1]!
    const firstRuntime = firstScene.layerItems.find(
      (item): item is RuntimeLayerItem => item.kind === 'runtime',
    )!
    const secondRuntime = secondScene.layerItems.find(
      (item): item is RuntimeLayerItem => item.kind === 'runtime',
    )!
    firstRuntime.order = 300
    secondRuntime.order = 300
    firstScene.layerItems.push(
      cloneRuntime(firstRuntime, 'disabled-canvas-runtime', `
        window.__disabledCanvasRuntimeExecuted = true;
        CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}});
      `, 310, false),
      cloneRuntime(firstRuntime, 'register-failure-canvas-runtime', `
        window.__canvasRegisterFailureExecuted = true;
      `, 320),
      cloneRuntime(firstRuntime, 'create-failure-canvas-runtime', `
        CoursewareRuntime.define({runtimeApiVersion:2,create(){
          window.__canvasCreateFailureExecuted = true;
          throw new Error('create failed intentionally');
        }});
      `, 330),
    )
    secondScene.layerItems.push(cloneRuntime(secondRuntime, 'lifecycle-failure-canvas-runtime', `
      CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){
        window.__canvasLifecycleCreates = (window.__canvasLifecycleCreates || 0) + 1;
        var marker = document.createElement('div');
        marker.dataset.canvasLifecycleFailure = 'true';
        ctx.dom.root.appendChild(marker);
        return {
          suspend(){ throw new Error('suspend failed intentionally'); },
          destroy(){
            window.__canvasLifecycleDestroys = (window.__canvasLifecycleDestroys || 0) + 1;
            marker.remove();
          }
        };
      }});
    `, 310))
    project.globalLayerItems.push({
      item: cloneRuntime(firstRuntime, 'global-api2-played', `
        window.__globalCanvasRuntimeExecuted = true;
        CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}});
      `, 100),
      visibility: { mode: 'all', locationIds: [] },
    })
    slide.surfaceLayerItems.push({
      item: cloneRuntime(firstRuntime, 'surface-api2-not-played', `
        window.__surfaceCanvasRuntimeExecuted = true;
        CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}});
      `, 200),
      visibility: { mode: 'all', locationIds: [] },
    })
    flow.surfaceLayerItems.push({
      item: cloneRuntime(firstRuntime, 'flow-api2-not-played', `
        window.__flowCanvasRuntimeExecuted = true;
        CoursewareRuntime.define({runtimeApiVersion:2,create(){return {destroy(){}}}});
      `, 200),
      visibility: { mode: 'all', locationIds: [] },
    })
    const validProject = courseProjectDocumentSchema.parse(project)
    const before = structuredClone(validProject)
    const payload = buildPublishedCourseV2Payload({
      project: validProject,
      assetFiles: {},
      components: {},
    })
    const payloadBefore = structuredClone(payload)
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
      expect(Reflect.get(view, '__canvasSceneOne')).toMatchObject({ creates: 1, destroys: 0 })
    })
    expect([...container.querySelectorAll<HTMLElement>('[data-slide-layer-item]')].map((element) => ({
      id: element.dataset.slideLayerItem,
      state: element.dataset.slideRuntimeState,
      children: element.childElementCount,
    }))).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'register-failure-canvas-runtime' }),
      expect.objectContaining({ id: 'create-failure-canvas-runtime' }),
    ]))
    await vi.waitFor(() => {
      expect(
        Reflect.get(view, '__canvasRegisterFailureExecuted'),
        diagnostics.join('\n'),
      ).toBe(true)
      expect(Reflect.get(view, '__canvasCreateFailureExecuted')).toBe(true)
    })
    expect(Reflect.get(view, '__disabledCanvasRuntimeExecuted')).toBeUndefined()
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__globalCanvasRuntimeExecuted')).toBe(true)
    })
    expect(Reflect.get(view, '__surfaceCanvasRuntimeExecuted')).toBeUndefined()
    expect(container.querySelector('[data-slide-layer-item="register-failure-canvas-runtime"] [data-runtime-fallback="true"]')).not.toBeNull()
    expect(container.querySelector('[data-slide-layer-item="create-failure-canvas-runtime"] [data-runtime-fallback="true"]')).not.toBeNull()

    await session.goToLocation(fixture.slideLocationIds[1]!)
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__canvasSceneOne')).toMatchObject({ creates: 1, destroys: 1 })
      expect(Reflect.get(view, '__canvasSceneTwo')).toMatchObject({ creates: 1, destroys: 0 })
    })
    const secondButton = runtimeShadowNode(
      container,
      'authored-scene-two',
      '[data-published-canvas-runtime-button="__canvasSceneTwo"]',
    )
    expect(secondButton).not.toBeNull()

    await session.goToLocation(fixture.flowLocationId)
    expect(Reflect.get(view, '__canvasSceneTwo')).toMatchObject({
      creates: 1,
      destroys: 0,
      suspends: 1,
      visibleFalse: 1,
    })
    expect(Reflect.get(view, '__canvasLifecycleDestroys')).toBe(1)
    expect(Reflect.get(view, '__flowCanvasRuntimeExecuted')).toBeUndefined()
    await session.goToLocation(fixture.slideLocationIds[1]!)
    expect(runtimeShadowNode(
      container,
      'authored-scene-two',
      '[data-published-canvas-runtime-button="__canvasSceneTwo"]',
    ))
      .toBe(secondButton)
    expect(Reflect.get(view, '__canvasSceneTwo')).toMatchObject({ resumes: 1, visibleTrue: 1 })
    expect(container.querySelector('[data-slide-layer-item="lifecycle-failure-canvas-runtime"] [data-runtime-fallback="true"]')).not.toBeNull()

    await session.navigator.goToLocation(fixture.slideLocationIds[1]!, { force: true })
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__canvasSceneTwo')).toMatchObject({ creates: 2, destroys: 1 })
    })
    await session.navigator.resetCurrentSurface()
    expect(session.navigator.current?.locationId).toBe(fixture.slideLocationIds[0])
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__canvasSceneOne')).toMatchObject({ creates: 2, destroys: 1 })
    })
    await session.navigator.resetCourse()
    expect(session.navigator.current?.locationId).toBe(fixture.slideLocationIds[0])
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__canvasSceneOne')).toMatchObject({ creates: 3, destroys: 2 })
    })

    const sceneOneProbe = Reflect.get(view, '__canvasSceneOne') as { emit?: () => void }
    sceneOneProbe.emit?.()
    expect(Reflect.get(view, '__canvasSceneOne')).toMatchObject({ busCalls: 1, staleCalls: 0 })
    expect(diagnostics.join('\n')).toContain('register失败')
    expect(diagnostics.join('\n')).toContain('create失败')
    expect(diagnostics.join('\n')).toContain('lifecycle失败')

    await session.destroy()
    sessions.splice(sessions.indexOf(session), 1)
    sceneOneProbe.emit?.()
    expect(Reflect.get(view, '__canvasSceneOne')).toMatchObject({
      creates: 3,
      destroys: 3,
      busCalls: 1,
      staleCalls: 0,
    })
    expect(container.querySelector('.published-canvas-runtime-mount')).toBeNull()
    expect(validProject).toEqual(before)
    expect(payload).toEqual(payloadBefore)
    frame.remove()
  })

  it('does not execute an inactive Slide API 2 host for capture', async () => {
    const fixture = createPublishedCanvasRuntimeV2Fixture([{
      itemId: 'capture-inactive-api2',
      renderMode: 'dom',
      source: domProbeSource('__captureInactiveApi2'),
    }], { includeFlow: true })
    if (!fixture.flowLocationId) throw new Error('expected Flow location')
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const { frame, container, view } = mountDocument()
    installStaticCaptureHarness(view)
    const session = createPublishedCourseSession(payload, {
      initialLocationId: fixture.flowLocationId,
    })
    sessions.push(session)
    await session.mount(container)

    expect(Reflect.get(view, '__captureInactiveApi2')).toBeUndefined()
    const slideSlot = container.querySelector<HTMLElement>(
      `[data-course-surface-slot="${fixture.slideSurfaceId}"]`,
    )
    const slideRoot = slideSlot?.querySelector<HTMLElement>('.slide-published-adapter')
    expect(slideSlot?.style.visibility).toBe('hidden')
    expect(slideRoot?.hidden).toBe(true)
    expect((await session.player.captureSurface(fixture.slideSurfaceId, {
      purpose: 'authoring',
    })).ok).toBe(true)
    expect(Reflect.get(view, '__captureInactiveApi2')).toBeUndefined()
    expect(slideSlot?.style.visibility).toBe('hidden')
    expect(slideRoot?.hidden).toBe(true)
    frame.remove()
  })
})
