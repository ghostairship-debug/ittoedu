import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '../../../player/surfaces/publishedDynamicHosts'
import type {
  PublishedCourseV2Payload,
  PublishedSlideScene,
  PublishedSlideSurface,
} from '../../../shared/publishedCourseTypes'

export interface PublishedSlideCaptureSession {
  captureScene(input: {
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    locationId: string
  }): Promise<string>
  captureLayer(input: {
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    locationId: string
    layerItemId: string
  }): Promise<string>
  destroy(): Promise<void>
}

function createCaptureRoot(document: Document): HTMLElement {
  const root = document.createElement('div')
  root.dataset.publishedStaticCaptureHost = 'true'
  root.setAttribute('aria-hidden', 'true')
  root.inert = true
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0 auto auto 0',
    width: '1280px',
    height: '720px',
    overflow: 'hidden',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-2147483648',
  })
  document.body.appendChild(root)
  return root
}

function slideLocationId(
  published: PublishedCourseV2Payload,
  surface: PublishedSlideSurface,
  scene: PublishedSlideScene,
  requested: string,
): string {
  const location = published.locations.find((candidate) => (
    candidate.id === requested
    && candidate.kind === 'slide-scene'
    && candidate.surfaceId === surface.id
    && candidate.sceneId === scene.id
  ))
  if (!location) {
    throw new Error(`Published 静态捕获找不到 Slide 位置“${requested}”`)
  }
  return location.id
}

async function capture(
  session: PublishedCourseSession,
  input: {
    surface: PublishedSlideSurface
    locationId: string
    layerItemId?: string
  },
): Promise<string> {
  await session.goToLocation(input.locationId)
  const result = await session.player.captureSurface(input.surface.id, {
    purpose: 'export',
    ...(input.layerItemId ? { layerItemId: input.layerItemId } : {}),
  })
  if (!result.ok || result.value?.format !== 'data-url') {
    throw result.failure?.error ?? new Error('Published Slide 静态捕获没有返回图片')
  }
  if (!result.value.content.startsWith('data:image/')) {
    throw new Error('Published Slide 静态捕获返回了无效图片数据')
  }
  return result.value.content
}

function capturePayloadForGeneration(
  published: PublishedCourseV2Payload,
  input: {
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    locationId: string
    includeGlobalLayerItems: boolean
    layerItemId?: string
  },
): PublishedCourseV2Payload {
  const locationId = slideLocationId(
    published,
    input.surface,
    input.scene,
    input.locationId,
  )
  const location = published.locations.find((candidate) => candidate.id === locationId)!
  const scene = structuredClone(input.scene)
  const surface = structuredClone(input.surface)
  surface.scenes = [scene]

  let globalLayerItems = input.includeGlobalLayerItems
    ? structuredClone(published.globalLayerItems)
    : []
  if (input.layerItemId) {
    const layerItemId = input.layerItemId
    const sceneMatches = scene.layerItems.filter((item) => item.layerItemId === layerItemId)
    const surfaceMatches = surface.surfaceLayerItems.filter((entry) => (
      entry.item.layerItemId === layerItemId
    ))
    const globalMatches = globalLayerItems.filter((entry) => (
      entry.item.layerItemId === layerItemId
    ))
    const matches = sceneMatches.length + surfaceMatches.length + globalMatches.length
    if (matches !== 1) {
      throw new Error(matches === 0
        ? `Published 静态捕获找不到动态图层“${layerItemId}”`
        : `Published 静态捕获发现重复动态图层“${layerItemId}”`)
    }
    const target = sceneMatches[0]
      ?? surfaceMatches[0]?.item
      ?? globalMatches[0]?.item
    if (!target || (target.kind !== 'component' && target.kind !== 'runtime')) {
      throw new Error(`Published 图层“${layerItemId}”不是可实例捕获的动态图层`)
    }
    scene.layerItems = sceneMatches
    surface.surfaceLayerItems = surfaceMatches
    globalLayerItems = globalMatches
  }

  return {
    ...structuredClone(published),
    surfaces: [surface],
    locations: [structuredClone(location)],
    startLocationId: locationId,
    globalLayerItems,
  }
}

async function captureGeneration(
  published: PublishedCourseV2Payload,
  options: {
    document: Document
    includeGlobalLayerItems: boolean
    surface: PublishedSlideSurface
    scene: PublishedSlideScene
    locationId: string
    layerItemId?: string
  },
): Promise<string> {
  const root = createCaptureRoot(options.document)
  let session: PublishedCourseSession | null = null
  try {
    const payload = capturePayloadForGeneration(published, options)
    session = createPublishedCourseSession(payload, {
      staticCapture: true,
      includeGlobalLayerItemsForStaticCapture: options.includeGlobalLayerItems,
    })
    await session.mount(root)
    return await capture(session, options)
  } finally {
    try {
      await session?.destroy()
    } finally {
      root.remove()
    }
  }
}

/** One serialized Published generation is mounted only for the requested capture. */
export async function createPublishedSlideCaptureSession(
  published: PublishedCourseV2Payload,
  options: {
    includeGlobalLayerItems: boolean
    document?: Document
  },
): Promise<PublishedSlideCaptureSession> {
  const targetDocument = options.document ?? document
  if (!published.locations.some((location) => location.kind === 'slide-scene')) {
    throw new Error('Published 课程没有可捕获的 Slide 位置')
  }
  let closing = false
  let queue: Promise<void> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new Error('Published Slide 静态捕获会话已销毁'))
    const scheduled = queue.then(work, work)
    queue = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }
  return {
    captureScene(input) {
      return enqueue(() => captureGeneration(published, {
        ...input,
        document: targetDocument,
        includeGlobalLayerItems: options.includeGlobalLayerItems,
      }))
    },
    captureLayer(input) {
      return enqueue(() => captureGeneration(published, {
        ...input,
        document: targetDocument,
        includeGlobalLayerItems: options.includeGlobalLayerItems,
      }))
    },
    async destroy() {
      if (closing) return queue
      closing = true
      await queue
    },
  }
}
