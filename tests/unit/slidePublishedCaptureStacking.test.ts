import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeLayerItem } from '@/shared/courseProjectTypes'
import type { CapturePublishedSlideOptions } from '@/player/surfaces/publishedCapture'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'

const captureMocks = vi.hoisted(() => ({
  capturePublishedSlidePng: vi.fn(async (_input: CapturePublishedSlideOptions) => (
    'data:image/png;base64,AA=='
  )),
}))

vi.mock('@/player/surfaces/publishedCapture', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/player/surfaces/publishedCapture')>(),
  capturePublishedSlidePng: captureMocks.capturePublishedSlidePng,
}))

import { SlidePublishedAdapter } from '@/player/surfaces/slide/SlidePublishedAdapter'

const NOW = '2026-09-01T12:00:00.000Z'

function textItem(layerItemId: string, order: number): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 20, y: 20, width: 240, height: 48 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: {
        text: layerItemId,
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 18,
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

afterEach(() => {
  captureMocks.capturePublishedSlidePng.mockClear()
  document.body.replaceChildren()
})

describe('SlidePublishedAdapter static capture stacking', () => {
  it('captures local content before the controller and later global overlays', async () => {
    const project = createBlankCourseProject({ now: NOW })
    const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
    const controller = project.globalLayerItems.find((candidate) => (
      candidate.item.kind === 'native'
      && candidate.item.content.nativeType === 'teacher-controller'
    ))
    if (
      !controller
      || controller.item.kind !== 'native'
      || controller.item.content.nativeType !== 'teacher-controller'
    ) throw new Error('expected teacher controller')
    controller.item.content.data.includeInStaticExports = true
    surface.scenes[0]!.layerItems.push(textItem('slide-local-cover', 100_000))
    project.globalLayerItems.push({
      item: textItem('global-after-controller', 200_000),
      visibility: { mode: 'all', locationIds: [] },
    })
    const payload = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const publishedSurface = payload.surfaces.find((candidate) => candidate.type === 'slide')
    const location = payload.locations.find((candidate) => candidate.kind === 'slide-scene')
    if (!publishedSurface || publishedSurface.type !== 'slide' || !location) {
      throw new Error('expected Published Slide location')
    }
    const adapter = new SlidePublishedAdapter(payload, publishedSurface.id, {
      locationId: location.id,
      staticCapture: true,
      includeGlobalLayerItemsForStaticCapture: true,
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const abort = new AbortController()
    await adapter.mount({
      surfaceId: publishedSurface.id,
      container,
      signal: abort.signal,
      services: {
        navigate: vi.fn(),
        getCourseState: vi.fn(),
        setCourseState: vi.fn(),
        resolveAsset: vi.fn(),
      },
    })
    await adapter.activate()

    await adapter.capture({ purpose: 'export' })

    const input = captureMocks.capturePublishedSlidePng.mock.calls[0]?.[0]
    expect(input?.layers.map((layer) => layer.element.dataset.slideLayerItem)).toEqual([
      'slide-local-cover',
      controller.item.layerItemId,
      'global-after-controller',
    ])
    abort.abort()
    await adapter.destroy()
  })
})
