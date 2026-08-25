import { afterEach, describe, expect, it } from 'vitest'
import {
  addCourseFlowPage,
  addCourseScene,
  addCourseSlidePage,
} from '@/renderer/course/courseLocationCommands'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { mountPublishedCourseTryRun } from '@/renderer/ui/coursePlayerTryRun'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '@/player/surfaces/publishedDynamicHosts'
import {
  createPublishedSurfaceRuntimeSession,
  mountPublishedSurfaceRuntime,
} from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  NativeLayerItem,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const NOW = '2026-08-25T09:00:00.000Z'
const sessions: PublishedCourseSession[] = []

function layerBase(layerItemId: string, order: number) {
  return {
    layerItemId,
    label: layerItemId,
    frame: {
      mode: 'absolute' as const,
      x: 40,
      y: 40 + order * 4,
      width: 320,
      height: 120,
    },
    order: 10_000 + order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto' as const,
    playbackInitialVisibility: 'inherit' as const,
  }
}

function runtimeItem(
  layerItemId: string,
  order: number,
  source: string,
  enabled = true,
  hitPolicy: 'auto' | 'pass-through' = 'auto',
): RuntimeLayerItem {
  return {
    ...layerBase(layerItemId, order),
    hitPolicy,
    kind: 'runtime',
    runtime: {
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      enabled,
      renderMode: 'dom',
      source,
      content: { values: { label: `按钮-${layerItemId}` } },
      assets: {},
    },
  }
}

function nativeText(layerItemId: string, order: number, text: string): NativeLayerItem {
  return {
    ...layerBase(layerItemId, order),
    kind: 'native',
    content: {
      nativeType: 'text',
      data: {
        text,
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 20,
          color: '#172033',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
          align: 'left',
          verticalAlign: 'top',
          writingMode: 'horizontal',
          lineSpacing: 1.2,
          letterSpacing: 0,
          padding: 0,
          overflow: 'fixed',
          backgroundColor: '#ffffff',
          backgroundOpacity: 0,
          cornerRadius: 0,
        },
      },
    },
  }
}

function projectWithRuntimeItems(items: RuntimeLayerItem[]): {
  project: CourseProjectDocument
  firstLocationId: string
  secondLocationId: string
  flowLocationId: string
} {
  let project = createBlankCourseProject({ now: NOW })
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide) throw new Error('expected initial Slide surface')
  const added = addCourseScene(project, {
    surfaceId: slide.id,
    now: NOW,
    expectedRevision: project.revision,
  })
  if (!added.ok) throw new Error(added.reason)
  project = added.project
  const flowAdded = addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })
  if (!flowAdded.ok) throw new Error(flowAdded.reason)
  project = flowAdded.project
  const locations = project.locations.filter((location) => (
    location.kind === 'slide-scene' && location.surfaceId === slide.id
  ))
  const firstLocation = locations[0]
  const secondLocation = locations[1]
  if (
    !firstLocation
    || firstLocation.kind !== 'slide-scene'
    || !secondLocation
    || secondLocation.kind !== 'slide-scene'
  ) throw new Error('expected two Slide locations')
  const flowLocation = project.locations.find((location) => location.kind === 'flow-block')
  if (!flowLocation) throw new Error('expected Flow location')

  const next = structuredClone(project)
  const nextSlide = next.surfaces.find((surface) => (
    surface.id === slide.id && surface.type === 'slide'
  ))
  if (!nextSlide || nextSlide.type !== 'slide') throw new Error('expected cloned Slide surface')
  const firstScene = nextSlide.scenes.find((scene) => scene.id === firstLocation.sceneId)
  const secondScene = nextSlide.scenes.find((scene) => scene.id === secondLocation.sceneId)
  if (!firstScene || !secondScene) throw new Error('expected two Slide scenes')
  firstScene.layerItems = [...items, nativeText('native-sibling', 100, '原生内容仍在')]
  secondScene.layerItems = [nativeText('second-scene', 1, '第二页')]
  return {
    project: courseProjectDocumentSchema.parse(next),
    firstLocationId: firstLocation.id,
    secondLocationId: secondLocation.id,
    flowLocationId: flowLocation.id,
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
  frameDocument.body.appendChild(container)
  return { frame, container, view }
}

function probe(view: Window): Record<string, unknown> {
  const value = Reflect.get(view, '__publishedSurfaceRuntimeProbe')
  if (!value || typeof value !== 'object') throw new Error('runtime probe missing')
  return value as Record<string, unknown>
}

function creationProbeSource(probeKey: string): string {
  return `
    CoursewareRuntime.define({
      runtimeApiVersion: 3,
      create() {
        var key = ${JSON.stringify(probeKey)};
        window[key] = (window[key] || 0) + 1;
        return { destroy() {} };
      }
    });
  `
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  document.body.replaceChildren()
})

describe('Published V2 Slide scene Surface Runtime playback', () => {
  it('replaces duplicate scoped listeners and removes the parent subscription on destroy', () => {
    const source = `
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create(ctx) {
          window.__duplicateRuntimeCalls = 0;
          var listener = function () { window.__duplicateRuntimeCalls += 1; };
          ctx.events.on('probe:duplicate', listener);
          ctx.events.on('probe:duplicate', listener);
          window.__duplicateRuntimeNamedCount = ctx.events.listenerCount('probe:duplicate');
          window.__duplicateRuntimeTotalCount = ctx.events.listenerCount();
          return { destroy() {} };
        }
      });
    `
    const fixture = projectWithRuntimeItems([
      runtimeItem('duplicate-listener-runtime', 1, source),
    ])
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const publishedRuntime = payload.surfaces
      .filter((surface) => surface.type === 'slide')
      .flatMap((surface) => surface.scenes)
      .flatMap((scene) => scene.layerItems)
      .find((item) => item.layerItemId === 'duplicate-listener-runtime')
    if (!publishedRuntime || publishedRuntime.kind !== 'runtime') {
      throw new Error('published duplicate-listener Runtime missing')
    }
    const runtimeSession = createPublishedSurfaceRuntimeSession()
    const { frame, container, view } = mountDocument()
    const diagnostics: string[] = []
    const handle = mountPublishedSurfaceRuntime(container, {
      instanceId: 'duplicate-listener-runtime',
      runtime: publishedRuntime.runtime,
      width: 320,
      height: 120,
      visible: true,
      resolveAsset: () => undefined,
      session: runtimeSession,
      reportError: (phase, error) => diagnostics.push(`${phase}: ${error.message}`),
    })

    expect(handle.ok, diagnostics.join('\n')).toBe(true)
    expect(Reflect.get(view, '__duplicateRuntimeNamedCount')).toBe(1)
    expect(Reflect.get(view, '__duplicateRuntimeTotalCount')).toBe(1)
    expect(runtimeSession.events.listenerCount('probe:duplicate')).toBe(1)
    runtimeSession.events.emit('probe:duplicate')
    expect(Reflect.get(view, '__duplicateRuntimeCalls')).toBe(1)
    handle.destroy()
    expect(runtimeSession.events.listenerCount('probe:duplicate')).toBe(0)
    runtimeSession.events.emit('probe:duplicate')
    expect(Reflect.get(view, '__duplicateRuntimeCalls')).toBe(1)
    runtimeSession.destroy()
    frame.remove()
  })

  it('starts current-location try-run at the requested scene without executing inactive Slide hosts', async () => {
    let project = createBlankCourseProject({ now: NOW })
    const firstSlide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!firstSlide || firstSlide.type !== 'slide') throw new Error('expected first Slide surface')
    const sceneAdded = addCourseScene(project, {
      surfaceId: firstSlide.id,
      now: NOW,
      expectedRevision: project.revision,
    })
    if (!sceneAdded.ok) throw new Error(sceneAdded.reason)
    project = sceneAdded.project
    const slideAdded = addCourseSlidePage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    if (!slideAdded.ok) throw new Error(slideAdded.reason)
    project = slideAdded.project

    const next = structuredClone(project)
    const slideSurfaces = next.surfaces.filter((surface) => surface.type === 'slide')
    const primary = slideSurfaces.find((surface) => surface.id === firstSlide.id)
    const inactive = slideSurfaces.find((surface) => surface.id !== firstSlide.id)
    const primaryLocations = next.locations.filter((location) => (
      location.kind === 'slide-scene' && location.surfaceId === firstSlide.id
    ))
    const firstLocation = primaryLocations[0]
    const targetLocation = primaryLocations[1]
    const inactiveLocation = next.locations.find((location) => (
      location.kind === 'slide-scene' && location.surfaceId === inactive?.id
    ))
    if (
      !primary
      || primary.type !== 'slide'
      || !inactive
      || inactive.type !== 'slide'
      || !firstLocation
      || firstLocation.kind !== 'slide-scene'
      || !targetLocation
      || targetLocation.kind !== 'slide-scene'
      || !inactiveLocation
      || inactiveLocation.kind !== 'slide-scene'
    ) throw new Error('expected current-location Slide fixture')
    const firstScene = primary.scenes.find((scene) => scene.id === firstLocation.sceneId)
    const targetScene = primary.scenes.find((scene) => scene.id === targetLocation.sceneId)
    const inactiveScene = inactive.scenes.find((scene) => scene.id === inactiveLocation.sceneId)
    if (!firstScene || !targetScene || !inactiveScene) {
      throw new Error('expected current-location Slide scenes')
    }
    firstScene.layerItems = [runtimeItem(
      'try-run-first-runtime',
      1,
      creationProbeSource('__tryRunFirstCreates'),
    )]
    targetScene.layerItems = [runtimeItem(
      'try-run-target-runtime',
      1,
      creationProbeSource('__tryRunTargetCreates'),
    )]
    inactiveScene.layerItems = [runtimeItem(
      'try-run-inactive-runtime',
      1,
      creationProbeSource('__tryRunInactiveCreates'),
    )]
    const fixture = courseProjectDocumentSchema.parse(next)
    const fixtureBefore = structuredClone(fixture)
    const { frame, container, view } = mountDocument()
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 1280 },
      clientHeight: { configurable: true, value: 720 },
    })
    const session = await mountPublishedCourseTryRun({
      container,
      project: fixture,
      assetFiles: {},
      components: {},
      locationId: targetLocation.id,
    })
    sessions.push(session)

    expect(session.navigator.current?.locationId).toBe(targetLocation.id)
    expect(Reflect.get(view, '__tryRunFirstCreates')).toBeUndefined()
    expect(Reflect.get(view, '__tryRunTargetCreates')).toBe(1)
    expect(Reflect.get(view, '__tryRunInactiveCreates')).toBeUndefined()
    expect(fixture).toEqual(fixtureBefore)

    await session.destroy()
    sessions.splice(sessions.indexOf(session), 1)
    frame.remove()
  })

  it('executes clickable API 3 DOM in the target realm and rebuilds it per scene visit', async () => {
    const source = `
      CoursewareRuntime.define({
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        create(ctx) {
          var state = window.__publishedSurfaceRuntimeProbe || {
            creates: 0, destroys: 0, suspends: 0, resumes: 0,
            clicks: 0, detachedClicks: 0
          };
          window.__publishedSurfaceRuntimeProbe = state;
          state.creates += 1;
          ctx.courseState.set('realm-object', {
            n: state.creates,
            nested: [{ ok: true }]
          });
          var realmState = ctx.courseState.get('realm-object');
          state.courseStateRoundTrip = realmState.n;
          state.courseStateObjectRealm = Object.getPrototypeOf(realmState) === Object.prototype;
          state.courseStateArrayRealm = Object.getPrototypeOf(realmState.nested) === Array.prototype;
          ctx.courseState.set('realm-array', [{ value: state.creates }]);
          var realmArray = ctx.courseState.get('realm-array');
          state.courseStateTopArrayRealm = Object.getPrototypeOf(realmArray) === Array.prototype;
          ctx.courseState.set('content-copy', ctx.content.all());
          var contentCopy = ctx.courseState.get('content-copy');
          state.courseStateContentCopy = contentCopy.label;
          var shared = { value: state.creates };
          ctx.courseState.set('shared-reference', { first: shared, second: shared });
          var sharedCopy = ctx.courseState.get('shared-reference');
          state.courseStateSharedReference = sharedCopy.first === sharedCopy.second;
          var protoKey = {};
          Object.defineProperty(protoKey, '__proto__', {
            configurable: true, enumerable: true, writable: true, value: { safe: true }
          });
          ctx.courseState.set('proto-key', protoKey);
          var protoKeyCopy = ctx.courseState.get('proto-key');
          state.courseStateProtoKeySafe =
            Object.getPrototypeOf(protoKeyCopy) === Object.prototype
            && Object.prototype.hasOwnProperty.call(protoKeyCopy, '__proto__')
            && protoKeyCopy.__proto__.safe === true;
          try { ctx.courseState.set('invalid-realm-state', new Date()); } catch (error) {
            state.invalidCourseStateRejected = true;
          }
          state.contentFrozen = Object.isFrozen(ctx.content.all());
          try { ctx.content.all().label = 'mutated'; } catch (error) { state.mutationRejected = true; }
          try { ctx.content.get('missing'); } catch (error) { state.missingContentRejected = true; }
          try { ctx.assets.url('missing'); } catch (error) { state.missingBindingRejected = true; }
          try { ctx.assets.projectUrl('missing'); } catch (error) {
            state.missingProjectAssetRejected = true;
          }
          state.busCalls = state.busCalls || 0;
          var sharedListener = function () { state.busCalls += 1; };
          ctx.events.on('probe:a', sharedListener);
          ctx.events.on('probe:b', sharedListener);
          ctx.events.emit('probe:a');
          ctx.events.emit('probe:b');
          ctx.events.off('probe:a', sharedListener);
          ctx.events.emit('probe:a');
          ctx.events.emit('probe:b');
          state.emitAfterDestroy = function () { ctx.events.emit('probe:b'); };
          var button = document.createElement('button');
          button.dataset.publishedRuntimeButton = 'true';
          button.textContent = ctx.content.get('label');
          state.targetDocument = button.ownerDocument === ctx.dom.root.ownerDocument;
          var attached = true;
          var onClick = function () {
            if (attached) state.clicks += 1;
            else state.detachedClicks += 1;
            button.dataset.clicks = String(state.clicks);
          };
          button.addEventListener('click', onClick);
          ctx.dom.root.appendChild(button);
          return {
            suspend() { state.suspends += 1; },
            resume() { state.resumes += 1; },
            destroy() {
              if (!attached) throw new Error('double destroy');
              attached = false;
              state.destroys += 1;
              button.removeEventListener('click', onClick);
              button.remove();
            }
          };
        }
      });
    `
    const fixture = projectWithRuntimeItems([
      runtimeItem('surface-runtime-good', 1, source),
    ])
    const projectBefore = structuredClone(fixture.project)
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const payloadBefore = structuredClone(payload)
    const { frame, container, view } = mountDocument()
    const previousRuntimeApi = Object.freeze({ marker: 'previous-runtime-api' })
    Object.defineProperty(view, 'CoursewareRuntime', {
      configurable: true,
      enumerable: false,
      writable: false,
      value: previousRuntimeApi,
    })
    const previousRuntimeDescriptor = Object.getOwnPropertyDescriptor(
      view,
      'CoursewareRuntime',
    )
    const session = createPublishedCourseSession(payload)
    sessions.push(session)
    await session.mount(container)

    const firstButton = container.querySelector<HTMLButtonElement>(
      '[data-published-runtime-button="true"]',
    )
    expect(firstButton).not.toBeNull()
    expect(firstButton?.ownerDocument).toBe(frame.contentDocument)
    expect(firstButton?.textContent).toBe('按钮-surface-runtime-good')
    expect(Object.getOwnPropertyDescriptor(view, 'CoursewareRuntime'))
      .toEqual(previousRuntimeDescriptor)
    expect(Reflect.get(view, 'CoursewareRuntime')).toBe(previousRuntimeApi)
    firstButton?.click()
    expect(probe(view)).toMatchObject({
      creates: 1,
      destroys: 0,
      clicks: 1,
      suspends: 0,
      resumes: 0,
      courseStateRoundTrip: 1,
      courseStateObjectRealm: true,
      courseStateArrayRealm: true,
      courseStateTopArrayRealm: true,
      courseStateContentCopy: '按钮-surface-runtime-good',
      courseStateSharedReference: true,
      courseStateProtoKeySafe: true,
      invalidCourseStateRejected: true,
      contentFrozen: true,
      mutationRejected: true,
      missingContentRejected: true,
      missingBindingRejected: true,
      missingProjectAssetRejected: true,
      busCalls: 3,
      targetDocument: true,
    })

    await session.goToLocation(fixture.secondLocationId)
    expect(probe(view)).toMatchObject({ creates: 1, destroys: 1, clicks: 1 })
    const emitAfterDestroy = probe(view).emitAfterDestroy
    if (typeof emitAfterDestroy !== 'function') throw new Error('runtime event probe missing')
    emitAfterDestroy()
    expect(probe(view)).toMatchObject({ busCalls: 3 })
    firstButton?.click()
    expect(probe(view)).toMatchObject({ clicks: 1, detachedClicks: 0 })

    await session.goToLocation(fixture.firstLocationId)
    const secondButton = container.querySelector<HTMLButtonElement>(
      '[data-published-runtime-button="true"]',
    )
    expect(secondButton).not.toBe(firstButton)
    secondButton?.click()
    expect(probe(view)).toMatchObject({ creates: 2, destroys: 1, clicks: 2, busCalls: 6 })

    await session.goToLocation(fixture.flowLocationId)
    expect(probe(view)).toMatchObject({ creates: 2, destroys: 1, suspends: 1, resumes: 0 })
    await session.goToLocation(fixture.firstLocationId)
    const resumedButton = container.querySelector<HTMLButtonElement>(
      '[data-published-runtime-button="true"]',
    )
    expect(resumedButton).toBe(secondButton)
    expect(probe(view)).toMatchObject({ creates: 2, destroys: 1, suspends: 1, resumes: 1 })

    await session.goToLocation(fixture.flowLocationId)
    await session.navigator.goToLocation(fixture.firstLocationId, { force: true })
    const forcedButton = container.querySelector<HTMLButtonElement>(
      '[data-published-runtime-button="true"]',
    )
    expect(forcedButton).not.toBe(secondButton)
    expect(probe(view)).toMatchObject({
      creates: 3,
      destroys: 2,
      suspends: 2,
      resumes: 1,
      busCalls: 9,
      courseStateRoundTrip: 3,
    })

    await session.goToLocation(fixture.flowLocationId)
    await session.goToLocation(fixture.secondLocationId)
    expect(probe(view)).toMatchObject({
      creates: 3,
      destroys: 3,
      suspends: 3,
      resumes: 1,
    })
    secondButton?.click()
    expect(probe(view)).toMatchObject({ clicks: 2, detachedClicks: 0 })

    await session.goToLocation(fixture.firstLocationId)
    const directResumeButton = container.querySelector<HTMLButtonElement>(
      '[data-published-runtime-button="true"]',
    )
    expect(directResumeButton).not.toBe(secondButton)
    const slideSurfaceId = session.navigator.current?.surfaceId
    if (!slideSurfaceId) throw new Error('active Slide surface missing')
    expect((await session.player.suspendSurface(slideSurfaceId)).ok).toBe(true)
    expect((await session.player.resumeSurface(slideSurfaceId)).ok).toBe(true)
    expect(probe(view)).toMatchObject({
      creates: 4,
      destroys: 3,
      suspends: 4,
      resumes: 2,
      busCalls: 12,
    })

    await session.navigator.resetCurrentSurface()
    expect(session.navigator.current?.locationId).toBe(fixture.firstLocationId)
    expect(probe(view)).toMatchObject({ creates: 5, destroys: 4, busCalls: 15 })
    await session.navigator.resetCourse()
    expect(session.navigator.current?.locationId).toBe(fixture.firstLocationId)
    expect(probe(view)).toMatchObject({ creates: 6, destroys: 5, busCalls: 18 })

    await session.destroy()
    sessions.splice(sessions.indexOf(session), 1)
    expect(probe(view)).toMatchObject({ creates: 6, destroys: 6, clicks: 2 })
    expect(container.querySelector('[data-published-runtime-button]')).toBeNull()
    expect(fixture.project).toEqual(projectBefore)
    expect(payload).toEqual(payloadBefore)
    frame.remove()
  })

  it('skips disabled code and contains register/create failures to their own layer', async () => {
    const disabledSource = `
      window.__disabledSurfaceRuntimeExecuted = true;
      CoursewareRuntime.define({runtimeApiVersion: 3, create() { return {destroy() {}}; }});
    `
    const registerFailureSource = `
      window.__registerFailureSourceExecuted = true;
    `
    const createFailureSource = `
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create() {
          window.__createFailureReached = true;
          throw new Error('create failed intentionally');
        }
      });
    `
    const survivingSource = `
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create(ctx) {
          window.__survivingSurfaceRuntimeCreates =
            (window.__survivingSurfaceRuntimeCreates || 0) + 1;
          var marker = document.createElement('button');
          marker.dataset.survivingSurfaceRuntime = 'true';
          marker.textContent = ctx.content.get('label');
          ctx.dom.root.appendChild(marker);
          return {
            suspend() {
              window.__survivingSurfaceRuntimeSuspends =
                (window.__survivingSurfaceRuntimeSuspends || 0) + 1;
            },
            resume() {
              window.__survivingSurfaceRuntimeResumes =
                (window.__survivingSurfaceRuntimeResumes || 0) + 1;
            },
            destroy() { marker.remove(); }
          };
        }
      });
    `
    const lifecycleGetterFailureSource = `
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create() {
          return {
            get suspend() {
              window.__lifecycleGetterFailureReached = true;
              throw new Error('suspend getter failed intentionally');
            },
            destroy() {}
          };
        }
      });
    `
    const passThroughSource = `
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create(ctx) {
          window.__passThroughSurfaceRuntimeExecuted = true;
          var marker = document.createElement('div');
          marker.dataset.passThroughSurfaceRuntime = 'true';
          ctx.dom.root.appendChild(marker);
          return { destroy() { marker.remove(); } };
        }
      });
    `
    const fixture = projectWithRuntimeItems([
      runtimeItem('runtime-disabled', 1, disabledSource, false),
      runtimeItem('runtime-register-failure', 2, registerFailureSource),
      runtimeItem('runtime-create-failure', 3, createFailureSource),
      runtimeItem('runtime-lifecycle-getter-failure', 4, lifecycleGetterFailureSource),
      runtimeItem('runtime-survives', 5, survivingSource),
      runtimeItem('runtime-pass-through', 6, passThroughSource, true, 'pass-through'),
    ])
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const diagnostics: string[] = []
    const { frame, container, view } = mountDocument()
    const session = createPublishedCourseSession(payload, {
      services: {
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.message),
      },
    })
    sessions.push(session)
    await session.mount(container)

    expect(Reflect.get(view, '__disabledSurfaceRuntimeExecuted')).toBeUndefined()
    expect(Reflect.get(view, '__registerFailureSourceExecuted')).toBe(true)
    expect(Reflect.get(view, '__createFailureReached')).toBe(true)
    expect(Reflect.get(view, '__survivingSurfaceRuntimeCreates')).toBe(1)
    expect(Reflect.get(view, '__passThroughSurfaceRuntimeExecuted')).toBe(true)
    expect(container.querySelector(
      '[data-slide-layer-item="runtime-disabled"] [data-runtime-fallback]',
    )).toBeNull()
    expect(container.querySelector(
      '[data-slide-layer-item="runtime-register-failure"] [data-runtime-fallback="true"]',
    )).not.toBeNull()
    expect(container.querySelector(
      '[data-slide-layer-item="runtime-create-failure"] [data-runtime-fallback="true"]',
    )).not.toBeNull()
    expect(container.querySelector(
      '[data-slide-layer-item="runtime-survives"] [data-surviving-surface-runtime="true"]',
    )).not.toBeNull()
    const passThroughWrap = container.querySelector<HTMLElement>(
      '[data-slide-layer-item="runtime-pass-through"]',
    )
    expect(passThroughWrap?.querySelector('[data-pass-through-surface-runtime="true"]'))
      .not.toBeNull()
    expect(passThroughWrap?.style.pointerEvents).toBe('none')
    const passThroughRuntimeMount = passThroughWrap?.querySelector<HTMLElement>(
      '.published-surface-runtime-mount',
    )
    expect(passThroughRuntimeMount?.style.pointerEvents).toBe('inherit')
    expect(passThroughRuntimeMount?.querySelector<HTMLElement>(
      '[data-surface-runtime-root]',
    )?.style.pointerEvents).toBe('')
    expect(container.querySelector('[data-slide-layer-item="native-sibling"]')).not.toBeNull()
    await session.goToLocation(fixture.flowLocationId)
    expect(Reflect.get(view, '__lifecycleGetterFailureReached')).toBe(true)
    expect(Reflect.get(view, '__survivingSurfaceRuntimeSuspends')).toBe(1)
    await session.goToLocation(fixture.firstLocationId)
    expect(Reflect.get(view, '__survivingSurfaceRuntimeResumes')).toBe(1)
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics.join('\n')).toContain('register失败')
    expect(diagnostics.join('\n')).toContain('create失败')
    expect(diagnostics.join('\n')).toContain('lifecycle失败')
    frame.remove()
  })
})
