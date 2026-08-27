import { describe, expect, it, vi } from 'vitest'

const publishedSessionProbe = vi.hoisted(() => ({
  calls: [] as Array<{ payload: unknown; options: unknown }>,
  sessions: [] as Array<{ mounts: number; destroys: number }>,
}))

vi.mock('@/player/surfaces/publishedDynamicHosts', () => ({
  createPublishedCourseSession(payload: unknown, options: unknown) {
    publishedSessionProbe.calls.push({ payload, options })
    const probe = { mounts: 0, destroys: 0 }
    publishedSessionProbe.sessions.push(probe)
    return {
      async mount() { probe.mounts += 1 },
      async destroy() { probe.destroys += 1 },
    }
  },
}))

import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import {
  buildPublishedCourseTryRunPayload,
  fitPublishedCourseHostForMode,
  fitPublishedCourseStage,
  mountPublishedCourseAuthoring,
  mountPublishedCourseTryRun,
  waitForHostLayout,
} from '@/renderer/ui/coursePlayerTryRun'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

function mockClientSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height })
}

describe('fitPublishedCourseStage', () => {
  it('letterboxes Slide, Flow and Spatial stages into a larger host', () => {
    const host = document.createElement('div')
    const slide = document.createElement('section')
    slide.className = 'slide-published-adapter'
    const flow = document.createElement('section')
    flow.className = 'flow-surface-host'
    const spatial = document.createElement('section')
    spatial.className = 'spatial-surface'
    host.append(slide, flow, spatial)
    mockClientSize(host, 1560, 992)

    fitPublishedCourseStage(host)

    const scale = Math.min(1560 / CANVAS_WIDTH, 992 / CANVAS_HEIGHT)
    for (const stage of [slide, flow, spatial]) {
      expect(stage.style.position).toBe('absolute')
      expect(stage.style.transformOrigin).toBe('0 0')
      expect(stage.style.transform).toBe(`scale(${scale})`)
      expect(stage.style.width).toBe(`${CANVAS_WIDTH}px`)
      expect(stage.style.height).toBe(`${CANVAS_HEIGHT}px`)
      expect(stage.style.left).toBe(`${(1560 - CANVAS_WIDTH * scale) / 2}px`)
      expect(stage.style.top).toBe(`${(992 - CANVAS_HEIGHT * scale) / 2}px`)
      expect(stage.dataset.stageFitScale).toBe(String(scale))
      expect(CANVAS_WIDTH / CANVAS_HEIGHT).toBeCloseTo(16 / 9)
    }
  })

  it('falls back to the design canvas when the host has no layout yet', () => {
    const host = document.createElement('div')
    const adapter = document.createElement('section')
    adapter.className = 'slide-published-adapter'
    host.append(adapter)
    mockClientSize(host, 0, 0)

    fitPublishedCourseStage(host)

    expect(adapter.style.transform).toBe('scale(1)')
    expect(adapter.style.left).toBe('0px')
    expect(adapter.style.top).toBe('0px')
  })

  it('leaves the canonical authoring stage to the Workspace transform', () => {
    const host = document.createElement('div')
    const adapter = document.createElement('section')
    adapter.className = 'slide-published-adapter'
    host.append(adapter)
    mockClientSize(host, 960, 640)

    fitPublishedCourseHostForMode(host, 'authoring')

    expect(adapter.style.transform).toBe('')
    expect(adapter.style.left).toBe('')
    expect(adapter.style.top).toBe('')
    expect(adapter.dataset.stageFitScale).toBeUndefined()
  })
})

describe('waitForHostLayout', () => {
  it('waits until the host has a usable size', async () => {
    const host = document.createElement('div')
    mockClientSize(host, 0, 0)
    let frames = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames += 1
      if (frames === 3) mockClientSize(host, 1280, 720)
      callback(frames)
      return frames
    })
    try {
      await waitForHostLayout(host)
      expect(host.clientWidth).toBe(1280)
      expect(frames).toBe(3)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('buildPublishedCourseTryRunPayload', () => {
  it('embeds referenced local bytes even when project assets retain remote metadata', () => {
    const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'multi-asset')!
    const project = structuredClone(fixture.data.project)
    project.assets.photo.remote = { url: 'https://cdn.example.com/photo.png?rev=2' }
    project.assets.unused = {
      ...structuredClone(project.assets.photo),
      id: 'unused',
      filename: 'unused.png',
      path: 'assets/unused.png',
      remote: { url: 'https://unused.example.com/image.png' },
    }
    const assetFiles = {
      ...fixture.data.assetFiles,
      unused: fixture.data.assetFiles.photo!,
    }

    const published = buildPublishedCourseTryRunPayload({
      project,
      assetFiles,
      components: {},
    })

    expect(published.assets.photo?.url).toMatch(/^data:image\/png;base64,/)
    expect(published.assets.diagram?.url).toMatch(/^data:image\/png;base64,/)
    expect(published.assets.clip?.url).toMatch(/^data:video\/mp4;base64,/)
    expect(published.assets.voice?.url).toMatch(/^data:audio\/mpeg;base64,/)
    expect(published.assets.unused).toBeUndefined()
  })
})

describe('mountPublishedCourseTryRun', () => {
  it('shares local asset URLs while leasing only explicit playback origins', async () => {
    publishedSessionProbe.calls.length = 0
    publishedSessionProbe.sessions.length = 0
    const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'multi-asset')!
    const project = structuredClone(fixture.data.project)
    const remoteUrl = 'https://cdn.example.com/photo.png?rev=3'
    project.assets.photo.remote = { url: remoteUrl }
    project.network = { connectOrigins: ['https://api.example.com'] }
    const container = document.createElement('div')
    mockClientSize(container, 1280, 720)
    const setPreviewNetworkPolicy = vi.fn(async (_input: {
      leaseId: string
      connectOrigins: string[]
      remoteAssetUrls: string[]
    }) => undefined)
    const releasePreviewNetworkPolicy = vi.fn(async (_input: {
      leaseId: string
    }) => undefined)
    const previousDesktopApi = Object.getOwnPropertyDescriptor(window, 'desktopAPI')
    Object.defineProperty(window, 'desktopAPI', {
      configurable: true,
      value: { setPreviewNetworkPolicy, releasePreviewNetworkPolicy },
    })

    try {
      const playback = await mountPublishedCourseTryRun({
        container,
        project,
        assetFiles: fixture.data.assetFiles,
        components: {},
        locationId: 'location-current',
        initialPresentationStateId: 'state-current',
      })
      expect(setPreviewNetworkPolicy).toHaveBeenCalledOnce()
      expect(setPreviewNetworkPolicy).toHaveBeenCalledWith(expect.objectContaining({
        connectOrigins: ['https://api.example.com'],
        remoteAssetUrls: [],
      }))
      const playbackPhotoUrl = (publishedSessionProbe.calls[0]!.payload as {
        assets: Record<string, { url: string }>
      }).assets.photo?.url
      expect(playbackPhotoUrl).toMatch(/^data:image\/png;base64,/)
      expect(publishedSessionProbe.calls[0]!.options).toMatchObject({
        initialLocationId: 'location-current',
        initialPresentationStateId: 'state-current',
      })
      const leaseId = setPreviewNetworkPolicy.mock.calls[0]![0].leaseId

      await playback.destroy()
      expect(releasePreviewNetworkPolicy).toHaveBeenCalledOnce()
      expect(releasePreviewNetworkPolicy).toHaveBeenCalledWith({ leaseId })

      const authoring = await mountPublishedCourseAuthoring({
        container,
        project,
        assetFiles: fixture.data.assetFiles,
        components: {},
        sessionId: 'authoring-after-preview',
        scope: 'scene',
        stateId: null,
      })
      expect(setPreviewNetworkPolicy).toHaveBeenCalledTimes(1)
      const authoringPhotoUrl = (publishedSessionProbe.calls[1]!.payload as {
        assets: Record<string, { url: string }>
      }).assets.photo?.url
      expect(authoringPhotoUrl).toMatch(/^data:image\/png;base64,/)
      expect(authoringPhotoUrl).toBe(playbackPhotoUrl)
      expect(publishedSessionProbe.calls[1]!.options)
        .not.toHaveProperty('initialPresentationStateId')

      await authoring.destroy()
      expect(releasePreviewNetworkPolicy).toHaveBeenCalledTimes(1)
      expect(publishedSessionProbe.sessions).toEqual([
        { mounts: 1, destroys: 1 },
        { mounts: 1, destroys: 1 },
      ])
    } finally {
      if (previousDesktopApi) {
        Object.defineProperty(window, 'desktopAPI', previousDesktopApi)
      } else {
        Reflect.deleteProperty(window, 'desktopAPI')
      }
    }
  })
})
