import { afterEach, describe, expect, it, vi } from 'vitest'
import * as publishedDynamicHosts from '../../src/player/surfaces/publishedDynamicHosts'
import {
  capturePublishedCourseV2Stage,
  createPublishedCourseV2PrintCaptureSession,
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
  waitForPublishedCourseCaptureReady,
} from '../../src/renderer/export/playerCapture'
import { buildPublishedCourseV2Payload } from '../../src/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '../../src/renderer/project/createCourseProject'
import { createBlankSpatialCourseProject } from '../../src/renderer/project/createSpatialCourseProject'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('Published Course V2 capture seam', () => {
  it('rejects leftover player export envelopes and legacy player objects without probing them', async () => {
    const legacyPayload = {
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    }
    const playerApp: unknown = {
      game: { scene: { getScene: () => ({ load: { isLoading: () => false } }) } },
      waitForCaptureReady: vi.fn(),
    }
    await expect(capturePublishedCourseV2Stage({ payload: legacyPayload }))
      .rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
    await expect(capturePublishedCourseV2Stage({ payload: playerApp }))
      .rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
    await expect(waitForPublishedCourseCaptureReady(playerApp))
      .rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
  })

  it('mounts parsed Published V2 through CoursePlayer and captures via the V2 seam', async () => {
    const published = buildPublishedCourseV2Payload({
      project: createBlankCourseProject({
        now: '2026-09-02T00:00:00.000Z',
        includeDefaultController: false,
        controls: 'none',
      }),
      assetFiles: {},
      components: {},
    })
    const capturePublishedCourseV2Surface = vi.fn(async () => ({
      ok: true as const,
      value: { format: 'data-url' as const, content: 'data:image/png;base64,VTI=' },
    }))
    const goToLocation = vi.fn().mockResolvedValue(undefined)
    const destroy = vi.fn().mockResolvedValue(undefined)
    const session = {
      mount: vi.fn().mockResolvedValue(undefined),
      goToLocation,
      player: { capturePublishedCourseV2Surface },
      destroy,
    }
    vi.spyOn(publishedDynamicHosts, 'createPublishedCourseSession').mockReturnValue(
      session as never,
    )

    await expect(capturePublishedCourseV2Stage({
      payload: published,
      locationId: published.startLocationId,
    })).resolves.toBe('data:image/png;base64,VTI=')
    expect(publishedDynamicHosts.createPublishedCourseSession).toHaveBeenCalledWith(
      published,
      expect.objectContaining({ staticCapture: true }),
    )
    expect(capturePublishedCourseV2Surface).toHaveBeenCalled()
    expect(destroy).toHaveBeenCalled()
  })

  it('allows a CoursePlayer V2 host to wait for capture-ready frames', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0))
    const pending = waitForPublishedCourseCaptureReady({
      capturePublishedCourseV2Surface: vi.fn(),
    })
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects a legacy player object for PDF print capture without probing it', async () => {
    const playerApp: unknown = {
      game: { scene: { getScene: () => ({ load: { isLoading: () => false } }) } },
      waitForCaptureReady: vi.fn(),
    }
    const createSession = vi.spyOn(publishedDynamicHosts, 'createPublishedCourseSession')
    await expect(createPublishedCourseV2PrintCaptureSession({ payload: playerApp }))
      .rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
    await expect(createPublishedCourseV2PrintCaptureSession({
      payload: { project: { schemaVersion: 8, scenes: [] }, assets: {}, components: {} },
    })).rejects.toThrow(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
    expect(createSession).not.toHaveBeenCalled()
  })

  it('destroys the V2 session and hidden root when print capture mount fails', async () => {
    const published = buildPublishedCourseV2Payload({
      project: createBlankCourseProject({
        now: '2026-09-02T00:00:00.000Z',
        includeDefaultController: false,
        controls: 'none',
      }),
      assetFiles: {},
      components: {},
    })
    const destroy = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(publishedDynamicHosts, 'createPublishedCourseSession').mockReturnValue({
      mount: vi.fn().mockRejectedValue(new Error('mount failed')),
      destroy,
    } as never)
    const rootsBefore = document.body.querySelectorAll('[aria-hidden="true"]').length

    await expect(createPublishedCourseV2PrintCaptureSession({ payload: published }))
      .rejects.toThrow('mount failed')

    expect(destroy).toHaveBeenCalledOnce()
    expect(document.body.querySelectorAll('[aria-hidden="true"]')).toHaveLength(rootsBefore)
  })

  it('captures print pages through capturePublishedCourseV2Surface and goToLocation', async () => {
    const published = buildPublishedCourseV2Payload({
      project: createBlankCourseProject({
        now: '2026-09-02T00:00:00.000Z',
        includeDefaultController: false,
        controls: 'none',
      }),
      assetFiles: {},
      components: {},
    })
    const capturePublishedCourseV2Surface = vi.fn(async () => ({
      ok: true as const,
      value: {
        format: 'data-url' as const,
        content: 'data:image/png;base64,UERG=',
        width: 1120,
        height: 760,
        warnings: ['静态捕获已使用封面帧'],
      },
    }))
    const goToLocation = vi.fn().mockResolvedValue(undefined)
    const destroy = vi.fn().mockResolvedValue(undefined)
    const session = {
      mount: vi.fn().mockResolvedValue(undefined),
      goToLocation,
      player: { capturePublishedCourseV2Surface },
      destroy,
    }
    vi.spyOn(publishedDynamicHosts, 'createPublishedCourseSession').mockReturnValue(
      session as never,
    )

    const printSession = await createPublishedCourseV2PrintCaptureSession({
      payload: published,
      includeGlobalLayerItems: true,
    })
    await expect(printSession.capturePage({
      locationId: published.startLocationId,
      surfaceId: published.surfaces[0]!.id,
      frameId: 'scene-frame-1',
      width: 1120,
      height: 760,
    })).resolves.toEqual({
      format: 'data-url',
      content: 'data:image/png;base64,UERG=',
      width: 1120,
      height: 760,
      warnings: ['静态捕获已使用封面帧'],
    })
    expect(publishedDynamicHosts.createPublishedCourseSession).toHaveBeenCalledWith(
      published,
      expect.objectContaining({
        staticCapture: true,
        includeGlobalLayerItemsForStaticCapture: true,
      }),
    )
    expect(goToLocation).toHaveBeenCalledWith(published.startLocationId)
    expect(capturePublishedCourseV2Surface).toHaveBeenCalledWith(
      published,
      published.surfaces[0]!.id,
      {
        purpose: 'export',
        frameId: 'scene-frame-1',
        width: 1120,
        height: 760,
      },
    )
    await printSession.destroy()
    expect(destroy).toHaveBeenCalled()
  })

  it('captures a pure Spatial course without requiring a Slide surface', async () => {
    const published = buildPublishedCourseV2Payload({
      project: createBlankSpatialCourseProject({
        now: '2026-09-02T00:00:00.000Z',
        includeDefaultController: false,
        controls: 'none',
      }),
      assetFiles: {},
      components: {},
    })
    expect(published.surfaces.every((surface) => surface.type !== 'slide')).toBe(true)
    const spatial = published.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (spatial?.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    const frameId = spatial.camera.frames[0]!.id
    const capture = {
      format: 'data-url' as const,
      content: 'data:image/png;base64,U1BBVElBTA==',
      width: 1120,
      height: 760,
    }
    const capturePublishedCourseV2Surface = vi.fn(async () => ({
      ok: true as const,
      value: capture,
    }))
    const goToLocation = vi.fn().mockResolvedValue(undefined)
    const destroy = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(publishedDynamicHosts, 'createPublishedCourseSession').mockReturnValue({
      mount: vi.fn().mockResolvedValue(undefined),
      goToLocation,
      player: { capturePublishedCourseV2Surface },
      destroy,
    } as never)

    const printSession = await createPublishedCourseV2PrintCaptureSession({
      payload: published,
    })
    await expect(printSession.capturePage({
      locationId: published.startLocationId,
      surfaceId: spatial.id,
      frameId,
      width: 1120,
      height: 760,
    })).resolves.toEqual(capture)
    expect(goToLocation).toHaveBeenCalledWith(published.startLocationId)
    expect(capturePublishedCourseV2Surface).toHaveBeenCalledWith(
      published,
      spatial.id,
      {
        purpose: 'export',
        frameId,
        width: 1120,
        height: 760,
      },
    )

    await printSession.destroy()
    expect(destroy).toHaveBeenCalled()
  })
})
