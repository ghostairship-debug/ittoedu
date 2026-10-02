import { describe, expect, it, vi } from 'vitest'
import type {
  PublishedCanvasRuntimeMountHandle,
  PublishedCanvasRuntimeMountOptions,
} from '@/player/surfaces/runtime/publishedCanvasRuntimeMount'
import type { RuntimeAuthoringTargetUpdate } from '@/shared/runtimeTypes'

const mountedOptions = vi.hoisted(() => new Map<string, PublishedCanvasRuntimeMountOptions>())
const liveSinks = vi.hoisted(() => new Map<string, (update: RuntimeAuthoringTargetUpdate) => void>())

vi.mock('phaser', () => ({}))
vi.mock('@/player/surfaces/runtime/publishedCanvasRuntimeMount', () => ({
  mountPublishedCanvasRuntime(
    container: HTMLElement,
    options: PublishedCanvasRuntimeMountOptions,
  ): PublishedCanvasRuntimeMountHandle {
    mountedOptions.set(options.instanceId, options)
    return {
      ok: true,
      element: container,
      applyAuthoringContentValue: () => false,
      applyAuthoringTextOverrides: () => false,
      waitForReady: () => Promise.resolve(),
      waitForCaptureReady: () => Promise.resolve(),
      restoreAfterCapture() {},
      setVisible() {},
      suspend() {},
      resume() {},
      destroy() {},
      startLiveEdit(input) {
        liveSinks.set(options.instanceId, input.onTargetsChanged)
        return () => liveSinks.delete(options.instanceId)
      },
    }
  },
}))

import { SlidePublishedAdapter } from '@/player/surfaces/slide/SlidePublishedAdapter'
import { buildPublishedFixture } from '../fixtures/teacherController'
import { createPublishedCanvasRuntimeV2Fixture } from '../fixtures/publishedCanvasRuntimeV2Fixture'

describe('Slide Runtime target truncation publication', () => {
  it.each(['authoring', 'live'] as const)('keeps truncation scoped to the current item and clears it in %s mode', async (mode) => {
    mountedOptions.clear()
    liveSinks.clear()
    const source = 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})'
    const fixture = createPublishedCanvasRuntimeV2Fixture([
      { itemId: 'truncated-runtime', renderMode: 'dom', source },
      { itemId: 'complete-runtime', renderMode: 'dom', source },
    ])
    const payload = buildPublishedFixture({ project: fixture.project, assetFiles: {}, components: {} })
    payload.globalLayerItems = []
    const surface = payload.surfaces.find((candidate) => candidate.id === fixture.slideSurfaceId)
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide fixture')
    const firstScene = surface.scenes[0]!
    firstScene.layerItems = surface.scenes.flatMap((scene) => scene.layerItems)
    const updates: Readonly<RuntimeAuthoringTargetUpdate>[] = []
    const adapter = new SlidePublishedAdapter(payload, surface.id, {
      locationId: fixture.slideLocationIds[0],
      ...(mode === 'authoring' ? { authoring: {
        scope: 'scene' as const,
        stateId: null,
        onRuntimeTargetsChanged: (update: Readonly<RuntimeAuthoringTargetUpdate>) => updates.push(update),
      } } : {}),
    })
    const container = document.createElement('div')
    document.body.append(container)
    try {
      await adapter.mount({
        surfaceId: surface.id,
        container,
        signal: new AbortController().signal,
        services: {
          navigate: () => undefined,
          getCourseState: () => undefined,
          setCourseState: () => undefined,
          resolveAsset: () => undefined,
        },
      })
      await adapter.activate()
      if (mode === 'live') {
        expect(adapter.beginLiveEdit((entry) => {
          if (entry.kind === 'runtime') updates.push(entry.update)
        })).not.toBeNull()
      }
      const emit = (itemId: string, truncated: boolean, empty = false) => {
        const sink = mode === 'authoring'
          ? mountedOptions.get(itemId)?.authoring?.onTargetsChanged
          : liveSinks.get(itemId)
        expect(sink).toBeTypeOf('function')
        sink!({
          revision: 1,
          scope: 'scene',
          sceneId: firstScene.id,
          truncated,
          targets: empty ? [] : [{
            targetId: `${itemId}-text`,
            scope: 'scene',
            sceneId: firstScene.id,
            kind: 'text',
            key: 'title',
            layer: 'overlay',
            source: 'registered',
            bounds: { x: 0, y: 0, width: 100, height: 20 },
          }],
        })
      }

      emit('truncated-runtime', true)
      emit('complete-runtime', false)
      expect(updates.at(-1)).toMatchObject({
        truncatedItemIds: ['truncated-runtime'],
        targets: expect.arrayContaining([
          expect.objectContaining({ nodeId: 'truncated-runtime' }),
          expect.objectContaining({ nodeId: 'complete-runtime' }),
        ]),
      })
      emit('truncated-runtime', false)
      expect(updates.at(-1)).toMatchObject({ truncatedItemIds: [] })
      expect(updates.at(-1)?.targets).toHaveLength(2)
      emit('truncated-runtime', true, true)
      expect(updates.at(-1)).toMatchObject({ truncatedItemIds: ['truncated-runtime'] })
      expect(updates.at(-1)?.targets).toHaveLength(1)
      emit('truncated-runtime', false, true)
      emit('complete-runtime', false, true)
      expect(updates.at(-1)).toMatchObject({ targets: [], truncatedItemIds: [] })
    } finally {
      await adapter.destroy()
      container.remove()
    }
  })
})
