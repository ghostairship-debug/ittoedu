import { describe, expect, it, vi } from 'vitest'
import type { RuntimeHostOptions } from '@/player/RuntimeHost'

vi.mock('phaser', () => ({
  CANVAS: 1,
  Scene: class { add = { container: () => ({}) } },
  Game: class {
    canvas = document.createElement('canvas')
    constructor(options: { parent: HTMLElement; scene: { create(): void } }) {
      options.parent.append(this.canvas)
      options.scene.create()
    }
    destroy() { this.canvas.remove() }
  },
}))
vi.mock('@/player/RuntimeRegistry', async importOriginal => ({
  ...await importOriginal<typeof import('@/player/RuntimeRegistry')>(),
  RuntimeRegistry: class { dispose() {} },
}))
vi.mock('@/player/RuntimeHost', () => ({
  RuntimeHost: class {
    constructor(options: RuntimeHostOptions) {
      if (options.runtime.renderMode === 'phaser') return
      const button = document.createElement('button')
      button.style.pointerEvents = 'auto'
      button.textContent = 'Explicit DOM control'
      options.environment.dom.overlay.append(button)
    }
    getFailure() { return null }
    setVisible() {}
    suspend() {}
    resume() {}
    destroy() {}
  },
}))

import { mountPublishedCanvasRuntime } from '@/player/surfaces/runtime/publishedCanvasRuntimeMount'
import { createPublishedSurfaceRuntimeSession } from '@/player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { setPublishedGlobalCanvasRuntimeState, setPublishedGlobalCanvasRuntimeInteractionVisibility } from '@/player/surfaces/runtime/publishedGlobalCanvasRuntimePointer'
import { SlidePublishedAdapter } from '@/player/surfaces/slide/SlidePublishedAdapter'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'
import type { PublishedRuntimeLayerItem } from '@/shared/publishedCourseTypes'
import type { RuntimeRenderMode } from '@/shared/runtimeTypes'

function fixture(renderMode: RuntimeRenderMode) {
  const source = 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
  const authored = createPublishedCanvasRuntimeV2Fixture([{ itemId: 'pointer-runtime', renderMode, source }])
  const payload = buildPublishedCourseV2Payload({ project: authored.project, assetFiles: {}, components: {} })
  const surface = payload.surfaces.find(surface => surface.id === authored.slideSurfaceId)!
  if (surface.type !== 'slide') throw new Error('Expected Slide fixture')
  const item = surface.scenes.flatMap(scene => scene.layerItems).find(item => item.layerItemId === 'pointer-runtime') as PublishedRuntimeLayerItem
  return { authored, payload, item }
}

describe('API 2 Runtime pointer planes', () => {
  it.each(['dom', 'phaser', 'hybrid'] as const)('keeps %s mount and scene wrapper pointer planes aligned', async mode => {
    const { payload, authored, item } = fixture(mode)
    const container = document.createElement('div')
    document.body.append(container)
    const session = createPublishedSurfaceRuntimeSession()
    const handle = mountPublishedCanvasRuntime(container, { instanceId: 'pointer-mount', runtime: item.runtime,
      width: 640, height: 360, visible: true, session, resolveAsset: () => undefined })
    try {
      await handle.waitForReady()
      const expected = mode === 'dom' ? 'none' : 'inherit'
      expect(container.querySelector<HTMLElement>('.published-canvas-runtime-mount')!.style.pointerEvents).toBe(expected)
      const plane = container.querySelector<HTMLElement>('[data-canvas-runtime-phaser]')!
      expect(plane.style.pointerEvents).toBe(expected)
      if (mode === 'dom') expect(plane.childElementCount).toBe(0)
      else expect(plane.querySelector('canvas')!.style.pointerEvents).toBe('inherit')
      if (mode !== 'phaser') expect(container.querySelector('button')!.style.pointerEvents).toBe('auto')
    } finally { handle.destroy(); session.destroy(); container.replaceChildren() }

    const adapter = new SlidePublishedAdapter(payload, authored.slideSurfaceId)
    try {
      await adapter.mount({ surfaceId: authored.slideSurfaceId, container, signal: new AbortController().signal,
        services: { navigate: async () => undefined, getCourseState: () => undefined, setCourseState: () => undefined, resolveAsset: () => undefined } })
      await adapter.activate()
      expect(container.querySelector<HTMLElement>('[data-slide-layer-item="pointer-runtime"]')!.style.pointerEvents)
        .toBe(mode === 'dom' ? 'none' : 'auto')
    } finally { await adapter.destroy(); container.remove() }
  })

  it.each(['dom', 'phaser', 'hybrid'] as const)('restores the %s global wrapper after visibility and fallback changes without overriding DOM controls', mode => {
    const { item } = fixture(mode)
    item.hitPolicy = 'auto'
    const target = document.createElement('div'), button = document.createElement('button')
    button.style.pointerEvents = 'auto'; target.append(button)
    const expected = mode === 'dom' ? 'none' : 'auto'
    setPublishedGlobalCanvasRuntimeState(target, 'playback', item)
    expect(target.style.pointerEvents).toBe(expected)
    setPublishedGlobalCanvasRuntimeInteractionVisibility(target, item, false)
    expect(target.style.pointerEvents).toBe('none')
    setPublishedGlobalCanvasRuntimeInteractionVisibility(target, item, true)
    expect(target.style.pointerEvents).toBe(expected)
    setPublishedGlobalCanvasRuntimeState(target, 'fallback', item)
    expect(target.style.pointerEvents).toBe('none')
    setPublishedGlobalCanvasRuntimeState(target, 'playback', item)
    expect(target.style.pointerEvents).toBe(expected)
    expect(button.style.pointerEvents).toBe('auto')
    setPublishedGlobalCanvasRuntimeState(target, 'playback', { ...item, hitPolicy: 'pass-through' })
    expect(target.style.pointerEvents).toBe('none')
  })
})
