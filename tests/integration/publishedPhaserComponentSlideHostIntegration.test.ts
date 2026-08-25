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
      setSize() { return value },
      setText() { return value },
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
    add = {
      container: () => chain(),
      rectangle: () => chain(),
      text: () => chain(),
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
      Reflect.get(config.scene, 'create').call(config.scene)
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
import { mountPublishedSlidePhaserComponent } from '../../src/player/surfaces/slide/publishedSlidePhaserComponentMount'
import {
  createPublishedCourseSession,
  createPublishedSurfaceHost,
} from '../../src/player/surfaces/publishedDynamicHosts'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import type { PublishedCourseComponent } from '../../src/shared/publishedCourseTypes'
import {
  createPublishedPhaserComponentV2Fixture,
  PUBLISHED_PHASER_COMPONENT_ID,
  PUBLISHED_PHASER_COMPONENT_ITEM_ID,
} from '../fixtures/publishedPhaserComponentV2Fixture'

interface FakeGameProbe {
  canvas: HTMLCanvasElement
  destroy: ReturnType<typeof vi.fn>
  step: ReturnType<typeof vi.fn>
  loop: { game: unknown; callback: unknown; started: boolean; running: boolean }
  destroyed: boolean
}

declare global {
  var __fakePublishedPhaserGames: FakeGameProbe[] | undefined
  interface Window {
    __publishedPhaserUnitProbe?: Record<string, unknown>
    __publishedPhaserLifecycleProbe?: Record<string, number>
    __publishedPhaserComponentV4Probe?: Record<string, unknown>
    __publishedPhaserComponentV4Games?: FakeGameProbe[]
  }
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
        var probe = window.__publishedPhaserUnitProbe = {
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
          destroy() { probe.destroys = (probe.destroys || 0) + 1; }
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
  document.body.replaceChildren()
  delete globalThis.__fakePublishedPhaserGames
  delete window.__publishedPhaserUnitProbe
  delete window.__publishedPhaserLifecycleProbe
  delete window.__publishedPhaserComponentV4Probe
  delete window.__publishedPhaserComponentV4Games
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
    await currentHost.mount({
      surfaceId: fixture.slideSurfaceId,
      container: currentRoot,
      services: services(),
      signal: new AbortController().signal,
    })
    await currentHost.activate()
    await currentHost.setLocationId?.(fixture.slideLocationIds[0])
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
    await currentHost.destroy()
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
    await session.restartCourse()
    await vi.waitFor(() => expect(courseRoot.querySelector(
      `[data-published-phaser-component="${PUBLISHED_PHASER_COMPONENT_ITEM_ID}"]`,
    )).not.toBeNull())
    await session.destroy()
    await flushTeardown()
    expect(globalThis.__fakePublishedPhaserGames?.every((game) => (
      game.destroyed && !game.canvas.isConnected && game.loop.game === null
    ))).toBe(true)
  })
})
