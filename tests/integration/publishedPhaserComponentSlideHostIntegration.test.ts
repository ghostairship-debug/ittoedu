import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('phaser', () => {
  class FakeEvents {
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()
    on(name: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
      return this
    }
    once(name: string, listener: (...args: unknown[]) => void) {
      const once = (...args: unknown[]) => {
        this.off(name, once)
        listener(...args)
      }
      return this.on(name, once)
    }
    off(name: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(name, (this.listeners.get(name) ?? []).filter((entry) => entry !== listener))
      return this
    }
    emit(name: string, ...args: unknown[]) {
      for (const listener of [...(this.listeners.get(name) ?? [])]) listener(...args)
    }
    listenerCount(name?: string) {
      if (name !== undefined) return this.listeners.get(name)?.length ?? 0
      return [...this.listeners.values()].reduce((count, entries) => count + entries.length, 0)
    }
  }
  const chain = () => {
    const events = new FakeEvents()
    const value = {
      active: true,
      children: [] as unknown[],
      add(entries: unknown | unknown[]) {
        value.children.push(...(Array.isArray(entries) ? entries : [entries]))
        return value
      },
      setOrigin() { return value },
      setInteractive() { return value },
      setName() { return value },
      setSize() { return value },
      setText() { return value },
      setVisible() { return value },
      on(name: string, listener: (...args: unknown[]) => void) {
        events.on(name, listener)
        return value
      },
      off(name: string, listener: (...args: unknown[]) => void) {
        events.off(name, listener)
        return value
      },
      destroy() { value.active = false },
    }
    return value
  }
  class Scene {
    game!: Game
    sys!: { game: Game }
    readonly children = { list: [] as ReturnType<typeof chain>[] }
    readonly #createObject = () => {
      const object = chain()
      this.children.list.push(object)
      return object
    }
    add = {
      container: this.#createObject,
      rectangle: this.#createObject,
      text: this.#createObject,
    }
    constructor(_config?: unknown) {}
  }
  class Game {
    readonly canvas = document.createElement('canvas')
    readonly events = new FakeEvents()
    readonly scale = { resize: vi.fn() }
    readonly loop = {
      started: true,
      running: true,
      game: this as Game | null,
      callback: (() => undefined) as (() => void) | null,
      stop: () => {
        this.loop.started = false
        this.loop.running = false
      },
      start: (callback: () => void) => {
        this.loop.callback = callback
        this.loop.started = true
        this.loop.running = true
      },
    }
    readonly destroy = vi.fn((removeCanvas?: boolean) => {
      this.pendingDestroy = true
      this.removeCanvas = removeCanvas === true
    })
    readonly step = vi.fn(() => {
      if (!this.pendingDestroy || this.destroyed) return
      this.destroyed = true
      this.events.emit('destroy')
      if (this.removeCanvas) this.canvas.remove()
      this.loop.game = null
      this.loop.callback = null
      this.loop.started = false
      this.loop.running = false
    })
    pendingDestroy = false
    destroyed = false
    removeCanvas = false
    constructor(config: { parent: HTMLElement; scene: Scene }) {
      config.parent.appendChild(this.canvas)
      config.scene.game = this
      config.scene.sys = { game: this }
      const fakeState = globalThis as unknown as { __fakePublishedPhaserGames?: unknown[] }
      fakeState.__fakePublishedPhaserGames ??= []
      fakeState.__fakePublishedPhaserGames.push(this)
      const boot = () => Reflect.get(config.scene, 'create').call(config.scene)
      const bootState = globalThis as unknown as {
        __deferPublishedPhaserBoot?: boolean
        __deferredPublishedPhaserBoots?: Array<() => void>
      }
      if (bootState.__deferPublishedPhaserBoot) {
        bootState.__deferredPublishedPhaserBoots ??= []
        bootState.__deferredPublishedPhaserBoots.push(boot)
      } else boot()
    }
    getTime() { return 1 }
  }
  return {
    CANVAS: 1,
    Core: { Events: { DESTROY: 'destroy' } },
    Scene,
    Game,
  }
})

import { CourseEventBus } from '../../src/player/CourseEventBus'
import { HostEvidenceRecorder } from '../../src/player/HostEvidenceRecorder'
import { attachPublishedCoursePresenter } from '../../src/player/publishedCoursePresenter'
import { CoursePlayer } from '../../src/player/surfaces/CoursePlayer'
import { SlidePublishedAdapter } from '../../src/player/surfaces/slide/SlidePublishedAdapter'
import { mountPublishedSlidePhaserComponent } from '../../src/player/surfaces/slide/publishedSlidePhaserComponentMount'
import {
  createPublishedCourseSession,
  createPublishedSurfaceHost,
} from '../../src/player/surfaces/publishedDynamicHosts'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import type { PublishedCourseComponent } from '../../src/shared/publishedCourseTypes'
import {
  createPublishedPhaserComponentV2Fixture,
  PUBLISHED_PHASER_COMPONENT_ID,
  PUBLISHED_PHASER_COMPONENT_ITEM_ID,
} from '../fixtures/publishedPhaserComponentV2Fixture'

interface FakeGameProbe {
  canvas: HTMLCanvasElement
  events: {
    once(name: string, listener: () => void): unknown
    listenerCount(name?: string): number
  }
  destroy: ReturnType<typeof vi.fn>
  step: ReturnType<typeof vi.fn>
  loop: { game: unknown; callback: unknown; started: boolean; running: boolean }
  destroyed: boolean
}

declare global {
  var __fakePublishedPhaserGames: FakeGameProbe[] | undefined
  var __deferPublishedPhaserBoot: boolean | undefined
  var __deferredPublishedPhaserBoots: Array<() => void> | undefined
  interface Window {
    __publishedPhaserUnitProbe?: Record<string, unknown>
    __publishedPhaserLifecycleProbe?: Record<string, number>
    __publishedPhaserComponentV4Probe?: Record<string, unknown>
    __publishedPhaserComponentV4Games?: FakeGameProbe[]
    __slideReplayRuntimeProbe?: Record<string, number>
  }
}

const SLIDE_REPLAY_RUNTIME_ITEM_ID = 'slide-replay-api2-runtime'

const SLIDE_REPLAY_RUNTIME_SOURCE = `
CoursewareRuntime.define({
  runtimeApiVersion: 2,
  create(ctx) {
    var probe = window.__slideReplayRuntimeProbe || {
      creates: 0, destroys: 0, coreDestroys: 0
    };
    window.__slideReplayRuntimeProbe = probe;
    probe.creates += 1;
    var game = ctx.phaser.scene.game;
    game.events.once(ctx.Phaser.Core.Events.DESTROY, function () {
      probe.coreDestroys += 1;
    });
    var panel = ctx.phaser.scene.add.rectangle(0, 0, ctx.width, ctx.height, 0x1d4ed8, 1)
      .setOrigin(0, 0);
    ctx.phaser.root.add(panel);
    return {
      destroy() {
        probe.destroys += 1;
      }
    };
  }
});
`

function replayRuntimeItem(order: number): RuntimeLayerItem {
  return {
    layerItemId: SLIDE_REPLAY_RUNTIME_ITEM_ID,
    label: 'Slide replay API 2 runtime',
    frame: { mode: 'absolute', x: 520, y: 87, width: 280, height: 210 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'phaser',
      source: SLIDE_REPLAY_RUNTIME_SOURCE,
      content: { values: {} },
      assets: {},
    },
  }
}

interface PhaserReplayGeneration {
  componentCanvas: HTMLCanvasElement
  runtimeCanvas: HTMLCanvasElement
  componentGame: FakeGameProbe
  runtimeGame: FakeGameProbe
}

async function currentReplayGeneration(root: HTMLElement): Promise<PhaserReplayGeneration> {
  await vi.waitFor(() => {
    expect(root.querySelector(
      `canvas[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).not.toBeNull()
    expect(root.querySelector(
      `[data-canvas-runtime-phaser="${SLIDE_REPLAY_RUNTIME_ITEM_ID}"] canvas`,
    )).not.toBeNull()
  })
  const componentCanvas = root.querySelector<HTMLCanvasElement>(
    `canvas[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
  )!
  const runtimeCanvas = root.querySelector<HTMLCanvasElement>(
    `[data-canvas-runtime-phaser="${SLIDE_REPLAY_RUNTIME_ITEM_ID}"] canvas`,
  )!
  const componentGame = globalThis.__fakePublishedPhaserGames?.find(
    (game) => game.canvas === componentCanvas,
  )
  const runtimeGame = globalThis.__fakePublishedPhaserGames?.find(
    (game) => game.canvas === runtimeCanvas,
  )
  if (!componentGame || !runtimeGame) throw new Error('expected current fake Phaser games')
  return { componentCanvas, runtimeCanvas, componentGame, runtimeGame }
}

async function expectFreshReplayGeneration(
  root: HTMLElement,
  previous: PhaserReplayGeneration,
): Promise<PhaserReplayGeneration> {
  await vi.waitFor(() => {
    expect(previous.componentCanvas.isConnected).toBe(false)
    expect(previous.runtimeCanvas.isConnected).toBe(false)
    expect(root.querySelector(
      `canvas[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).not.toBe(previous.componentCanvas)
    expect(root.querySelector(
      `[data-canvas-runtime-phaser="${SLIDE_REPLAY_RUNTIME_ITEM_ID}"] canvas`,
    )).not.toBe(previous.runtimeCanvas)
  })
  expect(previous.componentGame.destroyed).toBe(true)
  expect(previous.runtimeGame.destroyed).toBe(true)
  return currentReplayGeneration(root)
}

function encode(source: string): { encoding: 'base64-utf16le'; data: string } {
  const bytes = new Uint8Array(source.length * 2)
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    bytes[index * 2] = code & 0xff
    bytes[index * 2 + 1] = code >>> 8
  }
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return { encoding: 'base64-utf16le', data: btoa(binary) }
}

function publishedComponent(
  version: string,
  source: string,
  assetUrl = `data:image/svg+xml,${version}`,
): PublishedCourseComponent {
  return {
    id: PUBLISHED_PHASER_COMPONENT_ID,
    name: `Phaser ${version}`,
    version,
    contentSha256: version,
    apiVersion: 4,
    scopes: ['scene'],
    renderMode: 'phaser',
    code: encode(source),
    assets: { badge: { mimeType: 'image/svg+xml', url: assetUrl } },
  }
}

function runtime(version: string): string {
  return `
    window.CoursewareComponent.define({
      id: '${PUBLISHED_PHASER_COMPONENT_ID}',
      runtimeApiVersion: 4,
      create(ctx) {
        var previousProbe = window.__publishedPhaserUnitProbe;
        var probe = window.__publishedPhaserUnitProbe = {
          creates: ((previousProbe && previousProbe.creates) || 0) + 1,
          version: '${version}',
          context: ctx.renderMode === 'phaser' && !!ctx.phaser.Phaser
            && !!ctx.phaser.scene && !!ctx.phaser.root
            && !('dom' in ctx) && !('Phaser' in ctx) && !('root' in ctx) && !('editor' in ctx),
          props: JSON.parse(JSON.stringify(ctx.props)),
          assetUrl: ctx.assetUrl('badge'),
          projectAssetUrl: ctx.projectAssetUrl('project-asset')
        };
        ctx.events.on('unit:tick', function () { probe.ticks = (probe.ticks || 0) + 1; });
        ctx.emit('unit:ready', { version: '${version}' });
        ctx.phaser.scene.game.events.once(ctx.phaser.Phaser.Core.Events.DESTROY, function () {
          probe.coreDestroys = (probe.coreDestroys || 0) + 1;
        });
        return {
          setMode(mode) { probe.mode = mode; },
          resize(width, height) { probe.resize = { width: width, height: height }; },
          setVisible(value) { probe.visible = value; },
          suspend() { probe.suspends = (probe.suspends || 0) + 1; ctx.phaser.scene.game.loop.stop(); },
          resume() { probe.resumes = (probe.resumes || 0) + 1; },
          destroy() {
            probe.destroys = (probe.destroys || 0) + 1;
            ctx.emit('unit:stale-destroy', { version: '${version}' });
          }
        };
      }
    });
  `
}

function services() {
  return {
    navigate: vi.fn(),
    getCourseState: vi.fn(),
    setCourseState: vi.fn(),
    resolveAsset: vi.fn((assetId: string) => `asset:${assetId}`),
    reportDiagnostic: vi.fn(),
  }
}

async function flushTeardown(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  delete globalThis.__fakePublishedPhaserGames
  delete globalThis.__deferPublishedPhaserBoot
  delete globalThis.__deferredPublishedPhaserBoots
  delete window.__publishedPhaserUnitProbe
  delete window.__publishedPhaserLifecycleProbe
  delete window.__publishedPhaserComponentV4Probe
  delete window.__publishedPhaserComponentV4Games
  delete window.__slideReplayRuntimeProbe
  Reflect.deleteProperty(window, '__H5_LESSON_PLAYER__')
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

describe('Published Slide Phaser Component API 4 host', () => {
  it('uses the exact package version and exposes only the declared Phaser context', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const events = new CourseEventBus()
    const emitted: Array<{ eventName: string; payload?: unknown }> = []
    const v1 = publishedComponent('1.0.0', runtime('v1'))
    const v2 = publishedComponent('2.0.0', runtime('v2'))
    const handle = mountPublishedSlidePhaserComponent(container, {
      container,
      componentId: PUBLISHED_PHASER_COMPONENT_ID,
      version: '2.0.0',
      instanceId: 'exact-version-instance',
      width: 360,
      height: 210,
      props: { label: '精确版本' },
      components: {
        [PUBLISHED_PHASER_COMPONENT_ID]: v1,
        [`${PUBLISHED_PHASER_COMPONENT_ID}@2.0.0`]: v2,
      },
      resolveAsset: (assetId) => `project:${assetId}`,
      events,
      emit: (eventName, payload) => emitted.push({ eventName, payload }),
    })

    await vi.waitFor(() => expect(window.__publishedPhaserUnitProbe?.version).toBe('v2'))
    expect(window.__publishedPhaserUnitProbe).toMatchObject({
      context: true,
      props: { label: '精确版本' },
      assetUrl: 'data:image/svg+xml,2.0.0',
      projectAssetUrl: 'project:project-asset',
      mode: 'preview',
      resize: { width: 360, height: 210 },
      visible: true,
    })
    expect(emitted).toEqual([{ eventName: 'unit:ready', payload: { version: 'v2' } }])
    expect(events.listenerCount('unit:tick')).toBe(1)
    events.emit('unit:tick')
    expect(window.__publishedPhaserUnitProbe?.ticks).toBe(1)

    handle.setVisible(false)
    handle.suspend()
    handle.setVisible(true)
    handle.resume()
    expect(window.__publishedPhaserUnitProbe).toMatchObject({
      suspends: 1,
      resumes: 1,
      visible: true,
    })

    handle.destroy()
    handle.destroy()
    await flushTeardown()
    expect(emitted).toEqual([{ eventName: 'unit:ready', payload: { version: 'v2' } }])
    expect(events.listenerCount()).toBe(0)
    expect(window.__publishedPhaserUnitProbe).toMatchObject({ destroys: 1, coreDestroys: 1 })
    expect(globalThis.__fakePublishedPhaserGames).toHaveLength(1)
    const game = globalThis.__fakePublishedPhaserGames![0]!
    expect(game.destroy).toHaveBeenCalledOnce()
    expect(game.step).toHaveBeenCalledOnce()
    expect(game.canvas.isConnected).toBe(false)
    expect(game.loop.game).toBeNull()
    expect(game.loop.callback).toBeNull()
  })

  it('quarantines one lifecycle failure into one fallback and still completes stopped-loop teardown', async () => {
    const source = `
      window.CoursewareComponent.define({
        id: '${PUBLISHED_PHASER_COMPONENT_ID}', runtimeApiVersion: 4,
        create(ctx) {
          var probe = window.__publishedPhaserLifecycleProbe = { creates: 1 };
          ctx.phaser.scene.game.events.once(ctx.phaser.Phaser.Core.Events.DESTROY, function () {
            probe.coreDestroys = (probe.coreDestroys || 0) + 1;
          });
          return {
            setMode() {},
            resize() { ctx.phaser.scene.game.loop.stop(); throw new Error('resize failed intentionally'); },
            destroy() { probe.destroys = (probe.destroys || 0) + 1; throw new Error('destroy failed intentionally'); }
          };
        }
      });
    `
    const reports: Array<{ phase: string; message: string }> = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountPublishedSlidePhaserComponent(container, {
      container,
      componentId: PUBLISHED_PHASER_COMPONENT_ID,
      version: '1.0.0',
      width: 320,
      height: 180,
      components: {
        [`${PUBLISHED_PHASER_COMPONENT_ID}@1.0.0`]: publishedComponent('1.0.0', source),
      },
      reportError: (phase, error) => reports.push({ phase, message: error.message }),
    })

    await vi.waitFor(() => expect(container.querySelectorAll('.published-component-fallback'))
      .toHaveLength(1))
    await flushTeardown()
    expect(handle.ok).toBe(false)
    expect(container.querySelectorAll('.published-component-fallback')).toHaveLength(1)
    expect(container.querySelector('.published-slide-phaser-component-mount')).toBeNull()
    expect(reports.filter((report) => report.phase === 'lifecycle')).toEqual([
      { phase: 'lifecycle', message: 'resize failed intentionally' },
    ])
    expect(reports.filter((report) => report.phase === 'destroy')).toEqual([
      { phase: 'destroy', message: 'destroy failed intentionally' },
    ])
    expect(window.__publishedPhaserLifecycleProbe).toEqual({
      creates: 1,
      destroys: 1,
      coreDestroys: 1,
    })
    const game = globalThis.__fakePublishedPhaserGames![0]!
    expect(game.destroy).toHaveBeenCalledOnce()
    expect(game.step).toHaveBeenCalledOnce()
  })

  it('isolates registration failure without constructing a Game', () => {
    const reports: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountPublishedSlidePhaserComponent(container, {
      container,
      componentId: PUBLISHED_PHASER_COMPONENT_ID,
      version: '1.0.0',
      width: 320,
      height: 180,
      components: {
        [`${PUBLISHED_PHASER_COMPONENT_ID}@1.0.0`]: publishedComponent(
          '1.0.0',
          "throw new Error('registration failed intentionally')",
        ),
      },
      reportError: (phase) => reports.push(phase),
    })
    expect(handle.ok).toBe(false)
    expect(reports).toEqual(['register'])
    expect(container.querySelectorAll('.published-component-fallback')).toHaveLength(1)
    expect(globalThis.__fakePublishedPhaserGames ?? []).toHaveLength(0)
  })

  it('isolates synchronous component create failure and tears down its booting Game once', async () => {
    const reports: string[] = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    const handle = mountPublishedSlidePhaserComponent(container, {
      container,
      componentId: PUBLISHED_PHASER_COMPONENT_ID,
      version: '1.0.0',
      width: 320,
      height: 180,
      components: {
        [`${PUBLISHED_PHASER_COMPONENT_ID}@1.0.0`]: publishedComponent(
          '1.0.0',
          `window.CoursewareComponent.define({
            id: '${PUBLISHED_PHASER_COMPONENT_ID}', runtimeApiVersion: 4,
            create() { throw new Error('create failed intentionally'); }
          });`,
        ),
      },
      reportError: (phase) => reports.push(phase),
    })

    await vi.waitFor(() => expect(container.querySelectorAll('.published-component-fallback'))
      .toHaveLength(1))
    await flushTeardown()
    expect(handle.ok).toBe(false)
    expect(reports).toEqual(['create'])
    expect(container.querySelectorAll('.published-component-fallback')).toHaveLength(1)
    const game = globalThis.__fakePublishedPhaserGames![0]!
    expect(game.destroy).toHaveBeenCalledOnce()
    expect(game.step).toHaveBeenCalledOnce()
    expect(game.destroyed).toBe(true)
  })

  it('does not create a zombie when a replaced Slide generation finishes Phaser boot late', async () => {
    globalThis.__deferPublishedPhaserBoot = true
    const fixture = createPublishedPhaserComponentV2Fixture()
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: fixture.assetFiles,
      components: fixture.components,
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const host = createPublishedSurfaceHost(payload, fixture.slideSurfaceId)
    const player = new CoursePlayer([host], { services: services() })
    expect(await player.mountSurface(fixture.slideSurfaceId, container)).toEqual({ ok: true })
    expect(await player.activateSurface(fixture.slideSurfaceId)).toEqual({ ok: true })

    await vi.waitFor(() => expect(globalThis.__fakePublishedPhaserGames).toHaveLength(1))
    const game = globalThis.__fakePublishedPhaserGames![0]!
    const coreDestroy = vi.fn()
    game.events.once('destroy', coreDestroy)
    await host.setLocationId?.(fixture.slideLocationIds[1])
    await flushTeardown()
    for (const boot of globalThis.__deferredPublishedPhaserBoots?.splice(0) ?? []) boot()
    await flushTeardown()

    expect(window.__publishedPhaserComponentV4Probe).toBeUndefined()
    expect(coreDestroy).toHaveBeenCalledOnce()
    expect(game.destroy).toHaveBeenCalledOnce()
    expect(game.step).toHaveBeenCalledOnce()
    expect(game.canvas.isConnected).toBe(false)
    expect(game.events.listenerCount()).toBe(0)
    expect(container.querySelector(
      `[data-slide-layer-item="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).toBeNull()
    expect(container.querySelector('.published-component-fallback')).toBeNull()
    await player.destroy()
  })

  it('waits for prepared noncurrent and forced locations before materializing deferred Phaser', async () => {
    await import('phaser')

    const runPreparedActivation = async (
      targetIndex: 0 | 1,
      forced: boolean,
      version: string,
    ): Promise<void> => {
      const fixture = createPublishedPhaserComponentV2Fixture(runtime(version))
      const payload = buildPublishedCourseV2Payload({
        project: fixture.project,
        assetFiles: fixture.assetFiles,
        components: fixture.components,
      })
      const container = document.createElement('div')
      document.body.appendChild(container)
      const host = new SlidePublishedAdapter(payload, fixture.slideSurfaceId)
      const player = new CoursePlayer([host], { services: services() })
      const emitted: unknown[] = []
      const onEmit = (event: Event) => emitted.push((event as CustomEvent).detail)
      window.addEventListener('courseware-component-event', onEmit)
      try {
        expect(await player.mountSurface(fixture.slideSurfaceId, container)).toEqual({ ok: true })
        host.preparePublishedLocation(fixture.slideLocationIds[targetIndex], forced)
        expect(await player.activateSurface(fixture.slideSurfaceId)).toEqual({ ok: true })
        await flushTeardown()

        expect(globalThis.__fakePublishedPhaserGames ?? []).toHaveLength(0)
        expect(window.__publishedPhaserUnitProbe).toBeUndefined()
        expect(emitted).toEqual([])

        await host.setLocationId(fixture.slideLocationIds[targetIndex])
        if (targetIndex === 0) {
          await vi.waitFor(() => expect(window.__publishedPhaserUnitProbe).toMatchObject({
            creates: 1,
            version,
          }))
          expect(globalThis.__fakePublishedPhaserGames).toHaveLength(1)
          expect(emitted).toHaveLength(1)
        } else {
          await flushTeardown()
          expect(globalThis.__fakePublishedPhaserGames ?? []).toHaveLength(0)
          expect(window.__publishedPhaserUnitProbe).toBeUndefined()
          expect(emitted).toEqual([])
        }
      } finally {
        window.removeEventListener('courseware-component-event', onEmit)
        await player.destroy()
        document.body.replaceChildren()
        delete globalThis.__fakePublishedPhaserGames
        delete window.__publishedPhaserUnitProbe
      }
    }

    await runPreparedActivation(1, false, 'prepared-noncurrent')
    await runPreparedActivation(0, true, 'prepared-forced')
  })

  it('routes the materialized scene item for current-location and whole-course preview consumers', async () => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const fixture = createPublishedPhaserComponentV2Fixture()
    const payload = buildPublishedCourseV2Payload({
      project: fixture.project,
      assetFiles: fixture.assetFiles,
      components: fixture.components,
    })

    const currentRoot = document.createElement('div')
    document.body.appendChild(currentRoot)
    const currentHost = createPublishedSurfaceHost(payload, fixture.slideSurfaceId)
    const currentPlayer = new CoursePlayer([currentHost], { services: services() })
    expect(await currentPlayer.mountSurface(fixture.slideSurfaceId, currentRoot))
      .toEqual({ ok: true })
    expect(currentRoot.querySelector<HTMLElement>(
      `[data-slide-layer-item="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )?.dataset.slideComponentState).toBe('deferred')
    expect(currentRoot.querySelector(
      `[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).toBeNull()
    expect(await currentPlayer.activateSurface(fixture.slideSurfaceId)).toEqual({ ok: true })
    await vi.waitFor(() => expect(currentRoot.querySelector(
      `[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).not.toBeNull())
    const wrapper = currentRoot.querySelector<HTMLElement>(
      `[data-slide-layer-item="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )!
    expect(wrapper.style.left).toBe('123px')
    expect(wrapper.style.top).toBe('87px')
    expect(wrapper.style.width).toBe('360px')
    expect(wrapper.style.height).toBe('210px')
    const publishedSlide = payload.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
    if (!publishedSlide || publishedSlide.type !== 'slide') throw new Error('expected Slide payload')
    const firstScene = publishedSlide.scenes[0]!
    const componentOrder = firstScene.layerItems.find(
      (item) => item.layerItemId === PUBLISHED_PHASER_COMPONENT_ITEM_ID,
    )?.order
    const sentinelOrder = firstScene.layerItems.find(
      (item) => item.layerItemId === 'published-phaser-order-sentinel',
    )?.order
    expect(wrapper.style.zIndex).toBe(String(componentOrder))
    expect(currentRoot.querySelector<HTMLElement>(
      '[data-slide-layer-item="published-phaser-order-sentinel"]',
    )?.style.zIndex).toBe(String(sentinelOrder))
    expect(Number(componentOrder)).toBeLessThan(Number(sentinelOrder))
    await currentPlayer.destroy()
    await flushTeardown()

    const courseRoot = document.createElement('div')
    document.body.appendChild(courseRoot)
    const session = createPublishedCourseSession(payload)
    await session.mount(courseRoot)
    await vi.waitFor(() => expect(courseRoot.querySelector(
      `[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).not.toBeNull())
    const firstGenerationGameCount = globalThis.__fakePublishedPhaserGames?.length ?? 0
    await session.goToIndex(1)
    await session.goToIndex(0)
    await vi.waitFor(() => expect(globalThis.__fakePublishedPhaserGames?.length ?? 0)
      .toBeGreaterThan(firstGenerationGameCount))
    await session.goToIndex(2)
    const suspendedProbe = window.__publishedPhaserComponentV4Probe
    expect(suspendedProbe).toMatchObject({ stopped: true })
    await session.goToIndex(0)
    expect(window.__publishedPhaserComponentV4Probe).toMatchObject({ resumes: 1 })
    await session.goToIndex(2)
    window.__publishedPhaserComponentV4Probe = {}
    const gameCountBeforeInactiveRestart = globalThis.__fakePublishedPhaserGames?.length ?? 0
    await session.restartCourse()
    await vi.waitFor(() => expect(courseRoot.querySelector(
      `[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).not.toBeNull())
    await vi.waitFor(() => expect(window.__publishedPhaserComponentV4Probe)
      .toMatchObject({ creates: 1 }))
    expect(Number(window.__publishedPhaserComponentV4Probe?.destroys ?? 0)).toBe(0)
    expect(globalThis.__fakePublishedPhaserGames).toHaveLength(
      gameCountBeforeInactiveRestart + 1,
    )
    await session.destroy()
    await flushTeardown()
    expect(globalThis.__fakePublishedPhaserGames?.every((game) => (
      game.destroyed && !game.canvas.isConnected && game.loop.game === null
    ))).toBe(true)
  })

  it('forces one location generation for authored, bridge, and escape replay without history', async () => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    const fixture = createPublishedPhaserComponentV2Fixture()
    const project = structuredClone(fixture.project)
    const slide = project.surfaces.find((surface) => surface.id === fixture.slideSurfaceId)
    if (!slide || slide.type !== 'slide') throw new Error('expected Slide fixture')
    const firstScene = slide.scenes[0]!
    firstScene.layerItems.push(replayRuntimeItem(
      Math.max(...firstScene.layerItems.map((item) => item.order)) + 10,
    ))
    const authoredController = project.globalLayerItems.find(({ item }) => (
      item.kind === 'native' && item.content.nativeType === 'teacher-controller'
    ))?.item
    if (
      !authoredController
      || authoredController.kind !== 'native'
      || authoredController.content.nativeType !== 'teacher-controller'
    ) throw new Error('expected authored teacher controller')
    authoredController.content.data.collapsible = false
    authoredController.content.data.defaultCollapsed = false
    const validProject = courseProjectDocumentSchema.parse(project)
    const payload = buildPublishedCourseV2Payload({
      project: validProject,
      assetFiles: fixture.assetFiles,
      components: fixture.components,
    })
    const publishedController = payload.globalLayerItems.find(({ item }) => (
      item.kind === 'native' && item.content.nativeType === 'teacher-controller'
    ))?.item
    if (
      !publishedController
      || publishedController.kind !== 'native'
      || publishedController.content.nativeType !== 'teacher-controller'
    ) throw new Error('expected Published teacher controller')
    const replayButtonId = publishedController.content.data.buttons.find(
      (button) => button.action.type === 'scene.replay',
    )?.id
    const nextButtonId = publishedController.content.data.buttons.find(
      (button) => button.action.type === 'scene.next',
    )?.id
    if (!replayButtonId || !nextButtonId) throw new Error('expected controller replay/next buttons')

    const root = document.createElement('div')
    Object.defineProperties(root, {
      clientWidth: { configurable: true, value: 1280 },
      clientHeight: { configurable: true, value: 720 },
    })
    document.body.appendChild(root)
    const diagnostics: string[] = []
    const session = createPublishedCourseSession(payload, {
      services: {
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic.message),
      },
    })
    expect(await session.replayScene()).toBe(false)
    const aborted = new AbortController()
    aborted.abort()
    expect(await session.replayScene(aborted.signal)).toBe(false)
    await session.mount(root)
    const initialLocationId = session.getProgress().locationId
    await session.goToIndex(1)
    await session.navigator.back()
    expect(session.getProgress().locationId).toBe(initialLocationId)
    expect(session.navigator.canGoBack).toBe(false)
    vi.spyOn(HostEvidenceRecorder.prototype, 'beginTeacherEscapeClick')
      .mockReturnValue(() => undefined)
    attachPublishedCoursePresenter(root, session, payload)
    const bridge = window.__H5_LESSON_PLAYER__
    if (!bridge) throw new Error('expected Published presenter bridge')

    const controllerButton = (buttonId: string): HTMLButtonElement => {
      const button = root.querySelector<HTMLButtonElement>(
        `[data-global-layer-item="${publishedController.layerItemId}"] `
          + `[data-controller-button-id="${buttonId}"]`,
      )
      if (!button) throw new Error(`missing controller button ${buttonId}`)
      return button
    }
    const expectLocationUnchanged = (): void => {
      expect(session.getProgress()).toMatchObject({
        index: 0,
        locationId: initialLocationId,
      })
      expect(session.navigator.canGoBack).toBe(false)
    }
    const expectProbeGeneration = async (
      componentCreates: number,
      runtimeCreates: number,
    ): Promise<void> => {
      await vi.waitFor(() => {
        expect(window.__publishedPhaserComponentV4Probe).toMatchObject({
          creates: componentCreates,
          destroys: componentCreates - 1,
          coreDestroys: componentCreates - 1,
        })
        expect(window.__slideReplayRuntimeProbe).toMatchObject({
          creates: runtimeCreates,
          destroys: runtimeCreates - 1,
          coreDestroys: runtimeCreates - 1,
        })
      })
    }

    let generation = await currentReplayGeneration(root)
    expect(diagnostics).toEqual([])
    await expectProbeGeneration(2, 1)
    expectLocationUnchanged()

    controllerButton(replayButtonId).click()
    generation = await expectFreshReplayGeneration(root, generation)
    await expectProbeGeneration(3, 2)
    expectLocationUnchanged()

    expect(bridge.replayScene()).toBe(true)
    generation = await expectFreshReplayGeneration(root, generation)
    await expectProbeGeneration(4, 3)
    expectLocationUnchanged()

    const escapeReplay = root.querySelector<HTMLButtonElement>(
      '[data-testid="teacher-escape-replay"]',
    )
    if (!escapeReplay) throw new Error('expected teacher escape replay control')
    escapeReplay.click()
    generation = await expectFreshReplayGeneration(root, generation)
    await expectProbeGeneration(5, 4)
    expectLocationUnchanged()

    const replayFailure = new Error('replay failed intentionally')
    const goToLocation = vi.spyOn(session.navigator, 'goToLocation')
      .mockRejectedValueOnce(replayFailure)
    await expect(session.replayScene()).rejects.toBe(replayFailure)
    goToLocation.mockRestore()
    expectLocationUnchanged()
    generation = await (async () => {
      const previous = generation
      expect(await session.replayScene()).toBe(true)
      return expectFreshReplayGeneration(root, previous)
    })()
    await expectProbeGeneration(6, 5)
    expectLocationUnchanged()

    controllerButton(nextButtonId).click()
    await vi.waitFor(() => {
      expect(session.getProgress().locationId).toBe(fixture.slideLocationIds[1])
    })
    await session.goToLocation(initialLocationId)
    generation = await currentReplayGeneration(root)

    bridge.destroy()
    await session.destroy()
    await flushTeardown()
    expect(bridge.replayScene()).toBe(false)
    expect(await session.replayScene()).toBe(false)
    expect(generation.componentCanvas.isConnected).toBe(false)
    expect(generation.runtimeCanvas.isConnected).toBe(false)
  })
})
