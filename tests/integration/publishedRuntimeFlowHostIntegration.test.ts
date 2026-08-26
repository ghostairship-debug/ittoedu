import { afterEach, describe, expect, it, vi } from 'vitest'
import { addCourseFlowPage } from '@/renderer/course/courseLocationCommands'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  selectFlowEditorBlock,
  selectFlowGlobalScope,
} from '@/renderer/course/flowEditorSlice'
import { insertFlowSharedRuntime } from '@/renderer/course/flowSharedAuthoringAdapters'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { mountFlowLocationTryRun } from '@/renderer/ui/flowLocationTryRun'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '@/player/surfaces/publishedDynamicHosts'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  CourseRuntimeDefinition,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'

const NOW = '2026-08-26T01:00:00.000Z'
const sessions: PublishedCourseSession[] = []

interface FlowRuntimeFixture {
  project: CourseProjectDocument
  firstFlowLocationId: string
  secondFlowLocationId: string
  slideLocationId: string
  goodItemId: string
  globalItemId: string
  disabledItemId: string
  registerFailureItemId: string
  createFailureItemId: string
  lifecycleFailureItemId: string
  captureFailureItemId: string
  postFailureSurvivorItemId: string
}

function runtime(
  source: string,
  label: string,
  enabled = true,
): CourseRuntimeDefinition {
  return {
    protocol: 'surface-runtime',
    runtimeApiVersion: 3,
    enabled,
    renderMode: 'dom',
    source,
    content: { values: { label } },
    assets: {},
  }
}

function goodRuntimeSource(): string {
  return `
    CoursewareRuntime.define({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      create(ctx) {
        var state = window.__publishedFlowRuntimeProbe || {
          creates: 0, destroys: 0, suspends: 0, resumes: 0,
          visibleTrue: 0, visibleFalse: 0, clicks: 0, detachedClicks: 0,
          busCalls: 0, emitters: [], failureEmitters: []
        };
        window.__publishedFlowRuntimeProbe = state;
        state.creates += 1;
        ctx.courseState.set('flow-generation', state.creates);
        var listener = function () { state.busCalls += 1; };
        ctx.events.on('flow:probe', listener);
        state.emitters.push(function () { ctx.events.emit('flow:probe'); });
        state.failureEmitters.push(function () { ctx.events.emit('flow:failure-probe'); });
        ctx.events.emit('flow:probe');
        var button = document.createElement('button');
        button.dataset.publishedFlowRuntimeButton = 'true';
        button.textContent = ctx.content.get('label') + ':0';
        var attached = true;
        var onClick = function () {
          if (attached) state.clicks += 1;
          else state.detachedClicks += 1;
          button.textContent = ctx.content.get('label') + ':' + state.clicks;
        };
        button.addEventListener('click', onClick);
        ctx.dom.root.appendChild(button);
        return {
          setVisible(value) {
            if (value) state.visibleTrue += 1;
            else state.visibleFalse += 1;
          },
          suspend() { state.suspends += 1; },
          resume() { state.resumes += 1; },
          destroy() {
            attached = false;
            state.destroys += 1;
            button.removeEventListener('click', onClick);
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
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      create(ctx) {
        window.__flowLifecycleFailureCreates =
          (window.__flowLifecycleFailureCreates || 0) + 1;
        window.__flowLifecycleFailureDestroys =
          window.__flowLifecycleFailureDestroys || 0;
        window.__flowLifecycleStaleCalls =
          window.__flowLifecycleStaleCalls || 0;
        ctx.events.on('flow:failure-probe', function () {
          window.__flowLifecycleStaleCalls += 1;
        });
        var marker = document.createElement('div');
        marker.dataset.flowLifecycleFailure = 'true';
        ctx.dom.root.appendChild(marker);
        return {
          suspend() { throw new Error('Flow lifecycle failed intentionally'); },
          destroy() {
            window.__flowLifecycleFailureDestroys += 1;
            marker.remove();
          }
        };
      }
    });
  `
}

function captureFailureSource(): string {
  return `
    CoursewareRuntime.define({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      create(ctx) {
        window.__flowCaptureFailureCreates =
          (window.__flowCaptureFailureCreates || 0) + 1;
        window.__flowCaptureFailureDestroys =
          window.__flowCaptureFailureDestroys || 0;
        window.__flowCaptureStaleCalls =
          window.__flowCaptureStaleCalls || 0;
        ctx.events.on('flow:failure-probe', function () {
          window.__flowCaptureStaleCalls += 1;
        });
        var marker = document.createElement('div');
        marker.dataset.flowCaptureFailure = 'true';
        ctx.dom.root.appendChild(marker);
        ctx.capture.waitUntil(Promise.resolve().then(function () {
          throw new Error('Flow capture failed intentionally');
        }));
        ctx.capture.waitUntil(Promise.resolve().then(function () {
          throw new Error('Flow capture failed again intentionally');
        }));
        return {
          destroy() {
            window.__flowCaptureFailureDestroys += 1;
            marker.remove();
          }
        };
      }
    });
  `
}

function postFailureSurvivorSource(): string {
  return `
    CoursewareRuntime.define({
      protocol: 'surface-runtime',
      runtimeApiVersion: 3,
      create() {
        window.__flowPostFailureCreates =
          (window.__flowPostFailureCreates || 0) + 1;
        window.__flowPostFailureSuspends =
          window.__flowPostFailureSuspends || 0;
        window.__flowPostFailureResumes =
          window.__flowPostFailureResumes || 0;
        window.__flowPostFailureDestroys =
          window.__flowPostFailureDestroys || 0;
        return {
          suspend() { window.__flowPostFailureSuspends += 1; },
          resume() { window.__flowPostFailureResumes += 1; },
          destroy() { window.__flowPostFailureDestroys += 1; }
        };
      }
    });
  `
}

function insertRuntime(
  project: CourseProjectDocument,
  locationId: string,
  blockId: string,
  id: string,
  definition: CourseRuntimeDefinition,
  global = false,
): { project: CourseProjectDocument; itemId: string } {
  const selection = global
    ? selectFlowGlobalScope(project, locationId)
    : selectFlowEditorBlock(project, locationId, blockId)
  const result = insertFlowSharedRuntime(project, selection, {
    id,
    label: id,
    runtime: definition,
  }, { now: NOW })
  if (!result.ok || !result.nextDocument || !result.createdLayerItemIds?.[0]) {
    throw new Error(result.reason ?? `failed to author ${id}`)
  }
  return { project: result.nextDocument, itemId: result.createdLayerItemIds[0] }
}

function flowRuntimeFixture(): FlowRuntimeFixture {
  let project = createBlankCourseProject({ now: NOW })
  const slideLocation = project.locations.find((location) => location.kind === 'slide-scene')
  if (!slideLocation) throw new Error('expected initial Slide location')
  const added = addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })
  if (!added.ok) throw new Error(added.reason)
  project = added.project

  const withLocations = structuredClone(project)
  const flow = withLocations.surfaces.find((surface) => surface.type === 'flow')
  if (!flow || flow.type !== 'flow') throw new Error('expected authored Flow surface')
  flow.blocks = [
    { id: 'flow-runtime-heading-a', type: 'heading', level: 1, text: 'Runtime A' },
    { id: 'flow-runtime-heading-b', type: 'heading', level: 1, text: 'Runtime B' },
  ]
  syncFlowCourseLocations(withLocations, flow.id)
  project = courseProjectDocumentSchema.parse(withLocations)
  const flowLocations = project.locations.filter((location) => (
    location.kind === 'flow-block' && location.surfaceId === flow.id
  ))
  const firstFlowLocation = flowLocations.find((location) => (
    location.kind === 'flow-block' && location.blockId === 'flow-runtime-heading-a'
  ))
  const secondFlowLocation = flowLocations.find((location) => (
    location.kind === 'flow-block' && location.blockId === 'flow-runtime-heading-b'
  ))
  if (!firstFlowLocation || !secondFlowLocation) {
    throw new Error('expected two authored Flow locations')
  }

  const good = insertRuntime(
    project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-good',
    runtime(goodRuntimeSource(), 'Flow 真实 Runtime'),
  )
  const disabled = insertRuntime(
    good.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-disabled',
    runtime(`
      window.__disabledFlowRuntimeExecuted = true;
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create() { return { destroy() {} }; }
      });
    `, '禁用 Flow Runtime', false),
  )
  const lifecycleFailure = insertRuntime(
    disabled.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-lifecycle-failure',
    runtime(lifecycleFailureSource(), '生命周期失败'),
  )
  const registerFailure = insertRuntime(
    lifecycleFailure.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-register-failure',
    runtime(`
      window.__flowRegisterFailureReached = true;
    `, '注册失败后备'),
  )
  const captureFailure = insertRuntime(
    registerFailure.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-capture-failure',
    runtime(captureFailureSource(), '异步捕获失败'),
  )
  const createFailure = insertRuntime(
    captureFailure.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-create-failure',
    runtime(`
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create() {
          window.__flowCreateFailureReached = true;
          throw new Error('Flow create failed intentionally');
        }
      });
    `, '创建失败后备'),
  )
  const postFailureSurvivor = insertRuntime(
    createFailure.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-post-failure-survivor',
    runtime(postFailureSurvivorSource(), '失败后幸存实例'),
  )
  const globalRuntime = insertRuntime(
    postFailureSurvivor.project,
    firstFlowLocation.id,
    'flow-runtime-heading-a',
    'flow-runtime-global',
    runtime(`
      window.__globalFlowRuntimeExecuted = true;
      CoursewareRuntime.define({
        runtimeApiVersion: 3,
        create() { return { destroy() {} }; }
      });
    `, '全局 Flow Runtime 后备'),
    true,
  )
  const finalProject = structuredClone(globalRuntime.project)
  const finalFlow = finalProject.surfaces.find((surface) => surface.id === flow.id)
  if (!finalFlow || finalFlow.type !== 'flow') throw new Error('expected final Flow surface')
  const lifecycleEntry = finalFlow.surfaceLayerItems.find((entry) => (
    entry.item.layerItemId === lifecycleFailure.itemId
  ))
  const survivorEntry = finalFlow.surfaceLayerItems.find((entry) => (
    entry.item.layerItemId === postFailureSurvivor.itemId
  ))
  if (!lifecycleEntry || !survivorEntry) throw new Error('expected ordered lifecycle fixtures')
  finalFlow.surfaceLayerItems = [
    ...finalFlow.surfaceLayerItems.filter((entry) => (
      entry !== lifecycleEntry && entry !== survivorEntry
    )),
    lifecycleEntry,
    survivorEntry,
  ]
  const precedingOrders = [
    ...finalProject.globalLayerItems.map((entry) => entry.item.order),
    ...finalFlow.surfaceLayerItems.slice(0, -2).map((entry) => entry.item.order),
  ]
  const nextOrder = Math.max(-1, ...precedingOrders) + 1
  lifecycleEntry.item.order = nextOrder
  survivorEntry.item.order = nextOrder + 1
  finalProject.startLocationId = firstFlowLocation.id
  return {
    project: courseProjectDocumentSchema.parse(finalProject),
    firstFlowLocationId: firstFlowLocation.id,
    secondFlowLocationId: secondFlowLocation.id,
    slideLocationId: slideLocation.id,
    goodItemId: good.itemId,
    disabledItemId: disabled.itemId,
    registerFailureItemId: registerFailure.itemId,
    createFailureItemId: createFailure.itemId,
    lifecycleFailureItemId: lifecycleFailure.itemId,
    captureFailureItemId: captureFailure.itemId,
    postFailureSurvivorItemId: postFailureSurvivor.itemId,
    globalItemId: globalRuntime.itemId,
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
  const value = Reflect.get(view, '__publishedFlowRuntimeProbe')
  if (!value || typeof value !== 'object') throw new Error('Flow runtime probe missing')
  return value as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()))
  document.body.replaceChildren()
})

describe('Published V2 Flow surface Runtime playback', () => {
  it('executes the actual Flow author command output in current-location try-run', async () => {
    const fixture = flowRuntimeFixture()
    const before = structuredClone(fixture.project)
    const { frame, container, view } = mountDocument()
    const host = await mountFlowLocationTryRun({
      container,
      project: fixture.project,
      locationId: fixture.firstFlowLocationId,
    })

    const button = container.querySelector<HTMLButtonElement>('[data-published-flow-runtime-button]')
    expect(button?.ownerDocument).toBe(frame.contentDocument)
    expect(button?.textContent).toBe('Flow 真实 Runtime:0')
    button?.click()
    expect(button?.textContent).toBe('Flow 真实 Runtime:1')
    expect(Reflect.get(view, '__globalFlowRuntimeExecuted')).toBeUndefined()
    expect(Reflect.get(view, '__disabledFlowRuntimeExecuted')).toBeUndefined()
    expect(Reflect.get(view, '__flowRegisterFailureReached')).toBe(true)
    expect(Reflect.get(view, '__flowCreateFailureReached')).toBe(true)
    const globalFallback = container.querySelector<HTMLElement>(
      `[data-flow-overlay-item="${fixture.globalItemId}"][data-flow-runtime-state="fallback"]`,
    )
    const disabledFallback = container.querySelector<HTMLElement>(
      `[data-flow-overlay-item="${fixture.disabledItemId}"][data-flow-runtime-state="disabled"]`,
    )
    expect(globalFallback?.querySelector('[data-runtime-fallback="true"]')?.textContent)
      .toBe('全局 Flow Runtime 后备')
    expect(disabledFallback?.querySelector('[data-runtime-fallback="true"]')?.textContent)
      .toBe('禁用 Flow Runtime')
    expect(container.querySelector(
      `[data-flow-overlay-item="${fixture.registerFailureItemId}"] [data-runtime-fallback="true"]`,
    )).not.toBeNull()
    expect(container.querySelector(
      `[data-flow-overlay-item="${fixture.createFailureItemId}"] [data-runtime-fallback="true"]`,
    )).not.toBeNull()
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(1)
      const captureFallback = container.querySelector<HTMLElement>(
        `[data-flow-overlay-item="${fixture.captureFailureItemId}"]`,
      )
      expect(captureFallback?.dataset.flowRuntimeState).toBe('fallback')
      expect(captureFallback?.querySelector('[data-flow-capture-failure]')).toBeNull()
    })
    expect(fixture.project).toEqual(before)

    await host.destroy()
    expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(1)
    frame.remove()
  })

  it('isolates failures and preserves location generations, suspension, reset, and destroy', async () => {
    const fixture = flowRuntimeFixture()
    const projectBefore = structuredClone(fixture.project)
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
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

    const firstButton = container.querySelector<HTMLButtonElement>('[data-published-flow-runtime-button]')
    expect(firstButton).not.toBeNull()
    expect(probe(view)).toMatchObject({ creates: 1, destroys: 0, suspends: 0, resumes: 0 })
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__flowCaptureFailureCreates')).toBe(1)
      expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(1)
    })
    expect(container.querySelector(
      `[data-flow-overlay-item="${fixture.lifecycleFailureItemId}"] [data-flow-lifecycle-failure]`,
    )).not.toBeNull()
    expect(container.querySelector(
      `[data-flow-overlay-item="${fixture.postFailureSurvivorItemId}"]`,
    )).not.toBeNull()

    await session.goToLocation(fixture.secondFlowLocationId)
    const secondButton = container.querySelector<HTMLButtonElement>('[data-published-flow-runtime-button]')
    expect(secondButton).not.toBe(firstButton)
    expect(probe(view)).toMatchObject({ creates: 2, destroys: 1, busCalls: 2 })
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__flowCaptureFailureCreates')).toBe(2)
      expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(2)
    })
    const firstEmitter = (probe(view).emitters as unknown[])[0]
    if (typeof firstEmitter !== 'function') throw new Error('first Flow event emitter missing')
    firstEmitter()
    expect(probe(view)).toMatchObject({ busCalls: 2 })
    firstButton?.click()
    expect(probe(view)).toMatchObject({ clicks: 0, detachedClicks: 0 })

    await session.goToLocation(fixture.slideLocationId)
    expect(probe(view)).toMatchObject({
      creates: 2,
      destroys: 1,
      suspends: 1,
      visibleFalse: 1,
    })
    expect(diagnostics.some((message) => message.includes('lifecycle失败'))).toBe(true)
    expect(diagnostics.some((message) => message.includes('Flow capture failed intentionally')))
      .toBe(true)
    expect(diagnostics.some((message) => message.includes('register失败'))).toBe(true)
    expect(diagnostics.some((message) => message.includes('create失败'))).toBe(true)
    const lifecycleFallback = container.querySelector<HTMLElement>(
      `[data-flow-overlay-item="${fixture.lifecycleFailureItemId}"]`,
    )
    expect(lifecycleFallback?.dataset.flowRuntimeState).toBe('fallback')
    expect(lifecycleFallback?.querySelector('[data-flow-lifecycle-failure]')).toBeNull()
    expect(lifecycleFallback?.querySelector('[data-runtime-fallback="true"]')?.textContent)
      .toBe('生命周期失败')
    expect(Reflect.get(view, '__flowLifecycleFailureDestroys')).toBe(2)
    expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(2)
    expect(Reflect.get(view, '__flowPostFailureSuspends')).toBe(1)
    const failureEmitter = (probe(view).failureEmitters as unknown[])[1]
    if (typeof failureEmitter !== 'function') throw new Error('Flow failure emitter missing')
    failureEmitter()
    expect(Reflect.get(view, '__flowLifecycleStaleCalls')).toBe(0)
    expect(Reflect.get(view, '__flowCaptureStaleCalls')).toBe(0)
    await session.goToLocation(fixture.secondFlowLocationId)
    const resumedButton = container.querySelector<HTMLButtonElement>('[data-published-flow-runtime-button]')
    expect(resumedButton).toBe(secondButton)
    expect(probe(view)).toMatchObject({ creates: 2, destroys: 1, resumes: 1, visibleTrue: 3 })
    expect(Reflect.get(view, '__flowPostFailureResumes')).toBe(1)

    await session.navigator.goToLocation(fixture.secondFlowLocationId, { force: true })
    const forcedButton = container.querySelector<HTMLButtonElement>('[data-published-flow-runtime-button]')
    expect(forcedButton).not.toBe(secondButton)
    expect(probe(view)).toMatchObject({ creates: 3, destroys: 2 })
    await vi.waitFor(() => {
      expect(Reflect.get(view, '__flowLifecycleFailureDestroys')).toBe(2)
      expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(3)
    })

    await session.navigator.resetCurrentSurface()
    expect(session.navigator.current?.locationId).toBe(fixture.firstFlowLocationId)
    expect(probe(view)).toMatchObject({ creates: 4, destroys: 3 })
    await session.navigator.resetCourse()
    expect(session.navigator.current?.locationId).toBe(fixture.firstFlowLocationId)
    expect(probe(view)).toMatchObject({ creates: 5, destroys: 4 })

    await session.destroy()
    sessions.splice(sessions.indexOf(session), 1)
    expect(probe(view)).toMatchObject({ creates: 5, destroys: 5, busCalls: 5 })
    expect(Reflect.get(view, '__flowLifecycleFailureCreates')).toBe(5)
    expect(Reflect.get(view, '__flowLifecycleFailureDestroys')).toBe(5)
    expect(Reflect.get(view, '__flowCaptureFailureCreates')).toBe(5)
    expect(Reflect.get(view, '__flowCaptureFailureDestroys')).toBe(5)
    expect(Reflect.get(view, '__flowPostFailureCreates')).toBe(5)
    expect(Reflect.get(view, '__flowPostFailureDestroys')).toBe(5)
    const latestEmitter = (probe(view).emitters as unknown[]).at(-1)
    if (typeof latestEmitter !== 'function') throw new Error('latest Flow event emitter missing')
    latestEmitter()
    expect(probe(view)).toMatchObject({ busCalls: 5 })
    expect(container.querySelector('[data-published-flow-runtime-button]')).toBeNull()
    expect(fixture.project).toEqual(projectBefore)
    expect(payload).toEqual(payloadBefore)
    frame.remove()
  })

  it('does not execute an inactive Flow host', async () => {
    const fixture = flowRuntimeFixture()
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: {},
      components: {},
    })
    const { frame, container, view } = mountDocument()
    const session = createPublishedCourseSession(payload, {
      initialLocationId: fixture.slideLocationId,
    })
    sessions.push(session)
    await session.mount(container)

    expect(session.navigator.current?.locationId).toBe(fixture.slideLocationId)
    expect(Reflect.get(view, '__publishedFlowRuntimeProbe')).toBeUndefined()
    expect(Reflect.get(view, '__flowLifecycleFailureCreates')).toBeUndefined()
    expect(Reflect.get(view, '__flowCaptureFailureCreates')).toBeUndefined()
    expect(Reflect.get(view, '__flowPostFailureCreates')).toBeUndefined()
    expect(container.querySelector(
      `[data-flow-overlay-item="${fixture.goodItemId}"][data-flow-runtime-state="deferred"]`,
    )).not.toBeNull()
    frame.remove()
  })
})
