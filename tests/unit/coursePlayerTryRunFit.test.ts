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
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { buildSlideEditorView } from '@/renderer/course/slideEditorView'
import {
  nativeRenderInputFromLayerItem,
  nativeRenderInputFromPublishedItem,
  nativeRenderInputFromV9Item,
} from '@/player/surfaces/slide/publishedNativeRendering'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  parsePlayerAuthoringPatchCommand,
} from '@/shared/playerAuthoringProtocol'
import type { NativeLayerItem } from '@/shared/courseProjectTypes'
import type { PublishedLayerItem } from '@/shared/publishedCourseTypes'
import { analyzeTextNodeLayout } from '@/shared/textLayout'
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
  it('shares local asset URLs and exact-origin leases across playback and authoring', async () => {
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
      expect(setPreviewNetworkPolicy).toHaveBeenCalledTimes(2)
      expect(setPreviewNetworkPolicy).toHaveBeenLastCalledWith(expect.objectContaining({
        connectOrigins: ['https://api.example.com'],
        remoteAssetUrls: [],
      }))
      const authoringLeaseId = setPreviewNetworkPolicy.mock.calls[1]![0].leaseId
      expect(authoringLeaseId).not.toBe(leaseId)
      const authoringPhotoUrl = (publishedSessionProbe.calls[1]!.payload as {
        assets: Record<string, { url: string }>
      }).assets.photo?.url
      expect(authoringPhotoUrl).toMatch(/^data:image\/png;base64,/)
      expect(authoringPhotoUrl).toBe(playbackPhotoUrl)
      expect(publishedSessionProbe.calls[1]!.options)
        .not.toHaveProperty('initialPresentationStateId')

      await authoring.destroy()
      expect(releasePreviewNetworkPolicy).toHaveBeenCalledTimes(2)
      expect(releasePreviewNetworkPolicy).toHaveBeenLastCalledWith({
        leaseId: authoringLeaseId,
      })
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

function fixtureById(id: string) {
  const fixture = listCourseProjectV9Fixtures().find((entry) => entry.id === id)
  if (!fixture) throw new Error(`missing V9 fixture ${id}`)
  return fixture
}

function slideLocationId(project: ReturnType<typeof fixtureById>['data']['project']) {
  const location = project.locations.find((candidate) => candidate.kind === 'slide-scene')
  if (!location || location.kind !== 'slide-scene') {
    throw new Error('expected a Slide location')
  }
  return location
}

function publishedItemById(
  published: ReturnType<typeof buildPublishedCourseTryRunPayload>,
  layerItemId: string,
): PublishedLayerItem | undefined {
  for (const surface of published.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
      if (item) return item
    }
    for (const entry of surface.surfaceLayerItems) {
      if (entry.item.layerItemId === layerItemId) return entry.item
    }
  }
  return published.globalLayerItems.find((entry) => entry.item.layerItemId === layerItemId)?.item
}

describe('Published authoring complete snapshot from V9', () => {
  it('builds NativeRenderInput patches that the existing protocol accepts', () => {
    for (const id of [
      'slide-native',
      'slide-presentation-state',
      'global-layer-teacher-controller',
      'component',
      'canvas-runtime',
      'multi-asset',
    ] as const) {
      const { data } = fixtureById(id)
      const location = slideLocationId(data.project)
      const view = buildSlideEditorView({
        project: data.project,
        locationId: location.id,
        stateId: location.stateId ?? null,
      })
      expect(view.sceneId).toBe(location.sceneId)
      for (const layer of view.layers) {
        if (layer.item.kind === 'runtime') continue
        const node = layer.item.kind === 'native'
          ? nativeRenderInputFromV9Item(layer.item as NativeLayerItem)
          : {
              id: layer.item.layerItemId,
              name: layer.item.label,
              type: 'external-component' as const,
              x: layer.item.frame.x,
              y: layer.item.frame.y,
              width: layer.item.frame.width,
              height: layer.item.frame.height,
              rotation: layer.item.rotation,
              opacity: layer.item.opacity,
              visible: layer.item.visible,
              locked: layer.item.locked,
              playbackInitialVisibility: layer.item.playbackInitialVisibility,
              component: structuredClone(layer.item.component),
              props: structuredClone(layer.item.props),
            }
        if (layer.item.kind === 'native') {
          expect(nativeRenderInputFromLayerItem(layer.item as NativeLayerItem)).toEqual(node)
        }
        const parsed = parsePlayerAuthoringPatchCommand({
          type: PLAYER_AUTHORING_MESSAGE_TYPES.patch,
          protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
          sessionId: 'authoring-session',
          requestId: `request-${layer.item.layerItemId}`,
          revision: 1,
          context: {
            sceneId: view.sceneId,
            stateId: view.presentation?.activeStateId ?? null,
          },
          patch: {
            kind: 'native-node',
            target: {
              kind: 'native-node',
              scope: layer.source === 'global' ? 'global' : 'scene',
              nodeId: node.id,
            },
            node,
          },
        })
        expect(parsed.ok, `${id}:${layer.item.layerItemId}`).toBe(true)
      }
    }
  })

  it('keeps authoring NativeRenderInput aligned with try-run Published paint input', () => {
    const { data } = fixtureById('slide-native')
    const project = structuredClone(data.project)
    const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
    const title = surface?.type === 'slide'
      ? surface.scenes[0]?.layerItems.find((item) => item.layerItemId === 'slide-title')
      : undefined
    if (!title || title.kind !== 'native' || title.content.nativeType !== 'text') {
      throw new Error('expected slide-title text')
    }
    title.content.data.style.overflow = 'shrink'
    title.content.data.style.fontSize = 48
    title.content.data.text = '判别式可以把根的情况一次看清楚'.repeat(4)
    title.frame.width = 180
    title.frame.height = 56

    const location = slideLocationId(project)
    const sources = {
      project,
      assetFiles: data.assetFiles,
      components: {},
    }
    const published = buildPublishedCourseTryRunPayload(sources)
    expect(published).toEqual(buildPublishedCourseV2Payload(sources))

    const fromV9 = nativeRenderInputFromV9Item(title)
    const publishedItem = publishedItemById(published, 'slide-title')
    if (!publishedItem || publishedItem.kind !== 'native') {
      throw new Error('expected published slide-title')
    }
    const fromPublished = nativeRenderInputFromPublishedItem(publishedItem)
    expect(fromV9.type).toBe('text')
    expect(fromPublished.type).toBe('text')
    if (fromV9.type !== 'text' || fromPublished.type !== 'text') return
    expect(fromPublished.style.overflow).toBe('shrink')
    expect(fromPublished.style.fontFamily).toBe(fromV9.style.fontFamily)
    expect(fromPublished.text).toBe(fromV9.text)
    expect(analyzeTextNodeLayout(fromPublished).fontSize).toBe(
      analyzeTextNodeLayout(fromV9).fontSize,
    )
    expect(analyzeTextNodeLayout(fromV9).fontSize).toBeLessThan(48)
    expect(published.assets.badge?.url).toMatch(/^data:image\/png;base64,/)
    expect(location.sceneId).toBe('scene-1')
  })
})
