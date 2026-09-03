import {
  assertParsedPublishedCourseV2,
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
  type CoursePlayer,
} from '../../player/surfaces/CoursePlayer'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '../../player/surfaces/publishedDynamicHosts'
import type {
  SurfaceCapture,
  SurfaceCaptureRequest,
} from '../../player/surfaces/SurfaceHost'

const DEFAULT_CAPTURE_TIMEOUT_MS = 10_000

export function settleCaptureFrames(milliseconds = 120): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    window.setTimeout(finish, milliseconds + 80)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.setTimeout(finish, milliseconds))
    })
  })
}

export {
  assertParsedPublishedCourseV2,
  PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR,
}

export interface PublishedCourseV2CaptureHandle {
  readonly session: PublishedCourseSession
  readonly player: CoursePlayer
  capture(request?: SurfaceCaptureRequest): Promise<string>
  destroy(): Promise<void>
}

function firstPublishedCapturableSurfaceId(payload: {
  surfaces: readonly { id: string; type: string }[]
}): string {
  const slide = payload.surfaces.find((surface) => surface.type === 'slide')
  const surface = slide ?? payload.surfaces[0]
  if (!surface) throw new Error('Published Course V2 没有可捕获的表面')
  return surface.id
}

/**
 * Mounts an already-parsed Published Course V2 onto CoursePlayer for capture.
 * Leftover player export envelopes and legacy player objects fail before any host
 * is created.
 */
export async function mountPublishedCourseV2Capture(input: {
  payload: unknown
  container: HTMLElement
  locationId?: string
  includeGlobalLayerItems?: boolean
}): Promise<PublishedCourseV2CaptureHandle> {
  assertParsedPublishedCourseV2(input.payload)
  const session = createPublishedCourseSession(input.payload, {
    staticCapture: true,
    includeGlobalLayerItemsForStaticCapture: input.includeGlobalLayerItems === true,
    ...(input.locationId ? { initialLocationId: input.locationId } : {}),
  })
  try {
    await session.mount(input.container)
  } catch (cause) {
    try {
      await session.destroy()
    } catch {
      // The mount failure remains authoritative; teardown is best effort.
    }
    throw cause
  }
  return {
    session,
    player: session.player,
    async capture(request: SurfaceCaptureRequest = { purpose: 'export' }) {
      const result = await session.player.capturePublishedCourseV2Surface(
        input.payload,
        firstPublishedCapturableSurfaceId(input.payload as {
          surfaces: readonly { id: string; type: string }[]
        }),
        request,
      )
      if (!result.ok || result.value?.format !== 'data-url') {
        throw result.failure?.error ?? new Error('Published Course V2 捕获没有返回图片')
      }
      return result.value.content
    },
    destroy: () => session.destroy(),
  }
}

/**
 * One-shot V2 capture. 033/041–043 should call this instead of the legacy player.
 * Leftover player payloads fail loudly without probing the legacy player object.
 */
export async function capturePublishedCourseV2Stage(input: {
  payload: unknown
  document?: Document
  locationId?: string
  surfaceId?: string
  layerItemId?: string
  includeGlobalLayerItems?: boolean
}): Promise<string> {
  assertParsedPublishedCourseV2(input.payload)
  const targetDocument = input.document ?? document
  const root = targetDocument.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  Object.assign(root.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1280px',
    height: '720px',
    overflow: 'hidden',
    pointerEvents: 'none',
    opacity: '0',
  })
  targetDocument.body.append(root)
  let handle: PublishedCourseV2CaptureHandle | null = null
  try {
    handle = await mountPublishedCourseV2Capture({
      payload: input.payload,
      container: root,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      includeGlobalLayerItems: input.includeGlobalLayerItems,
    })
    const surfaceId = input.surfaceId ?? firstPublishedCapturableSurfaceId(input.payload)
    if (input.locationId) await handle.session.goToLocation(input.locationId)
    await settleCaptureFrames()
    const result = await handle.player.capturePublishedCourseV2Surface(
      input.payload,
      surfaceId,
      {
        purpose: 'export',
        ...(input.layerItemId ? { layerItemId: input.layerItemId } : {}),
      },
    )
    if (!result.ok || result.value?.format !== 'data-url') {
      throw result.failure?.error ?? new Error('Published Course V2 捕获没有返回图片')
    }
    return result.value.content
  } finally {
    try {
      await handle?.destroy()
    } finally {
      root.remove()
    }
  }
}

export interface PublishedCourseV2PrintCaptureSession {
  capturePage(input: {
    locationId: string
    surfaceId: string
    frameId?: string
    width?: number
    height?: number
  }): Promise<SurfaceCapture>
  destroy(): Promise<void>
}

function appendHiddenPublishedV2CaptureRoot(targetDocument: Document): HTMLElement {
  const root = targetDocument.createElement('div')
  root.setAttribute('aria-hidden', 'true')
  Object.assign(root.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '1280px',
    height: '720px',
    overflow: 'visible',
    pointerEvents: 'none',
    opacity: '0',
  })
  targetDocument.body.append(root)
  return root
}

/**
 * PDF print capture over the r11-031 V2 seam: one CoursePlayer mount, then
 * goToLocation + capturePublishedCourseV2Surface. Leftover player envelopes
 * and legacy player objects fail before any host is created.
 */
export async function createPublishedCourseV2PrintCaptureSession(input: {
  payload: unknown
  includeGlobalLayerItems?: boolean
  document?: Document
}): Promise<PublishedCourseV2PrintCaptureSession> {
  assertParsedPublishedCourseV2(input.payload)
  const targetDocument = input.document ?? document
  const root = appendHiddenPublishedV2CaptureRoot(targetDocument)
  let handle: PublishedCourseV2CaptureHandle | null = null
  try {
    handle = await mountPublishedCourseV2Capture({
      payload: input.payload,
      container: root,
      includeGlobalLayerItems: input.includeGlobalLayerItems,
    })
  } catch (error) {
    root.remove()
    throw error
  }
  const mounted = handle
  let closing = false
  let queue: Promise<void> = Promise.resolve()
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    if (closing) return Promise.reject(new Error('Published Course V2 打印捕获会话已销毁'))
    const scheduled = queue.then(work, work)
    queue = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }
  return {
    capturePage(request) {
      return enqueue(async () => {
        assertParsedPublishedCourseV2(input.payload)
        if (request.width) root.style.width = `${request.width}px`
        if (request.height) root.style.height = `${request.height}px`
        await mounted.session.goToLocation(request.locationId)
        await settleCaptureFrames()
        const result = await mounted.player.capturePublishedCourseV2Surface(
          input.payload,
          request.surfaceId,
          {
            purpose: 'export',
            ...(request.frameId ? { frameId: request.frameId } : {}),
            ...(request.width ? { width: request.width } : {}),
            ...(request.height ? { height: request.height } : {}),
          },
        )
        if (!result.ok || result.value?.format !== 'data-url') {
          throw result.failure?.error ?? new Error('Published Course V2 捕获没有返回图片')
        }
        return result.value
      })
    },
    async destroy() {
      if (closing) {
        await queue
        return
      }
      closing = true
      await queue
      try {
        await mounted.destroy()
      } finally {
        root.remove()
      }
    },
  }
}

/**
 * V2 capture-ready wait. Passing a legacy player object or payload fails
 * immediately.
 */
export async function waitForPublishedCourseCaptureReady(
  host: unknown,
  _timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
): Promise<void> {
  assertParsedPublishedCourseV2Host(host)
  await settleCaptureFrames()
}

function assertParsedPublishedCourseV2Host(host: unknown): void {
  if (
    host
    && typeof host === 'object'
    && 'player' in host
    && (host as { player?: unknown }).player
    && typeof (host as { player: { capturePublishedCourseV2Surface?: unknown } }).player
      .capturePublishedCourseV2Surface === 'function'
  ) {
    return
  }
  if (
    host
    && typeof host === 'object'
    && typeof (host as { capturePublishedCourseV2Surface?: unknown })
      .capturePublishedCourseV2Surface === 'function'
  ) {
    return
  }
  throw new Error(PUBLISHED_COURSE_V2_SEAM_LEGACY_ERROR)
}
