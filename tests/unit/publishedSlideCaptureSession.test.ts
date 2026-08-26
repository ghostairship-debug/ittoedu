import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublishedLayerItem } from '@/shared/publishedCourseTypes'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

const dynamicHosts = vi.hoisted(() => ({
  createPublishedCourseSession: vi.fn(),
}))

vi.mock('@/player/surfaces/publishedDynamicHosts', () => dynamicHosts)

import { createPublishedSlideCaptureSession } from '@/renderer/export/course/publishedSlideCapture'

const NOW = '2026-08-27T12:00:00.000Z'

function dynamicItem(layerItemId: string): PublishedLayerItem {
  return {
    layerItemId,
    order: 1,
    frame: { mode: 'absolute', x: 0, y: 0, width: 100, height: 100 },
    rotation: 0,
    opacity: 1,
    visible: true,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled: true,
      renderMode: 'dom',
      code: { encoding: 'base64-utf16le', data: '' },
      content: { values: {} },
      assets: {},
    },
  }
}

function publishedFixture() {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const published = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
  const surface = published.surfaces.find((candidate) => candidate.type === 'slide')
  const location = published.locations.find((candidate) => candidate.kind === 'slide-scene')
  if (!surface || surface.type !== 'slide' || !location || location.kind !== 'slide-scene') {
    throw new Error('expected Slide fixture')
  }
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('expected Slide scene')
  scene.layerItems.push(dynamicItem('scene-runtime'))
  published.globalLayerItems.push({
    item: dynamicItem('global-runtime'),
    visibility: { mode: 'all', locationIds: [] },
  })
  return { published, surface, scene, location }
}

afterEach(() => {
  dynamicHosts.createPublishedCourseSession.mockReset()
  document.body.replaceChildren()
})

describe('Published Slide capture session generations', () => {
  it('is lazy, serial, clears excluded globals, and isolates a layer generation', async () => {
    const { published, surface, scene, location } = publishedFixture()
    let resolveFirst!: () => void
    const firstCapture = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const payloads: Array<typeof published> = []
    dynamicHosts.createPublishedCourseSession.mockImplementation((payload: typeof published) => {
      const generation = payloads.length
      payloads.push(payload)
      return {
        mount: vi.fn().mockResolvedValue(undefined),
        goToLocation: vi.fn().mockResolvedValue(undefined),
        player: {
          captureSurface: vi.fn(async () => {
            if (generation === 0) await firstCapture
            return { ok: true, value: { format: 'data-url', content: 'data:image/png;base64,AA==' } }
          }),
        },
        destroy: vi.fn().mockResolvedValue(undefined),
      }
    })

    const session = await createPublishedSlideCaptureSession(published, {
      includeGlobalLayerItems: false,
    })
    expect(dynamicHosts.createPublishedCourseSession).not.toHaveBeenCalled()
    const pageCapture = session.captureScene({ surface, scene, locationId: location.id })
    const layerCapture = session.captureLayer({
      surface,
      scene,
      locationId: location.id,
      layerItemId: 'scene-runtime',
    })
    await vi.waitFor(() => expect(payloads).toHaveLength(1))
    expect(payloads[0]?.globalLayerItems).toEqual([])
    const destroyed = session.destroy()
    await expect(session.captureScene({ surface, scene, locationId: location.id }))
      .rejects.toThrow('已销毁')
    expect(payloads).toHaveLength(1)

    resolveFirst()
    await pageCapture
    await layerCapture
    await destroyed
    expect(payloads).toHaveLength(2)
    expect(payloads[1]?.globalLayerItems).toEqual([])
    const generatedSurface = payloads[1]?.surfaces[0]
    expect(generatedSurface?.type).toBe('slide')
    if (generatedSurface?.type !== 'slide') throw new Error('expected generated Slide')
    expect(generatedSurface.surfaceLayerItems).toEqual([])
    expect(generatedSurface.scenes).toHaveLength(1)
    expect(generatedSurface.scenes[0]?.layerItems.map((item) => item.layerItemId))
      .toEqual(['scene-runtime'])
    expect(document.querySelector('[data-published-static-capture-host]')).toBeNull()
  })

  it('propagates a dynamic layer capture failure to the PPTX fallback owner', async () => {
    const { published, surface, scene, location } = publishedFixture()
    dynamicHosts.createPublishedCourseSession.mockReturnValue({
      mount: vi.fn().mockResolvedValue(undefined),
      goToLocation: vi.fn().mockResolvedValue(undefined),
      player: {
        captureSurface: vi.fn().mockResolvedValue({
          ok: false,
          failure: { error: new Error('runtime prepare failed') },
        }),
      },
      destroy: vi.fn().mockResolvedValue(undefined),
    })
    const session = await createPublishedSlideCaptureSession(published, {
      includeGlobalLayerItems: false,
    })
    await expect(session.captureLayer({
      surface,
      scene,
      locationId: location.id,
      layerItemId: 'scene-runtime',
    })).rejects.toThrow('runtime prepare failed')
    await session.destroy()
  })
})
