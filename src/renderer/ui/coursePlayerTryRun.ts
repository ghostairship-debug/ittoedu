import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  createPublishedCourseSession,
  type PublishedCourseSession,
} from '../../player/surfaces/publishedDynamicHosts'
import {
  attachPublishedCourseStageFit,
  fitPublishedCourseStage,
} from '../../player/surfaces/publishedStageFit'
import { buildPublishedCourseV2Payload } from '../export/course/buildPublishedCourse'
import type { PublishedCourseV2Payload } from '../../shared/publishedCourseTypes'

export { attachPublishedCourseStageFit, fitPublishedCourseStage }

let previewNetworkLeaseSequence = 0

function nextPreviewNetworkLeaseId(): string {
  previewNetworkLeaseSequence += 1
  return `course-preview-${Date.now()}-${previewNetworkLeaseSequence}`
}

export function buildPublishedCourseTryRunPayload(input: {
  project: CourseProjectDocument
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
}): PublishedCourseV2Payload {
  return buildPublishedCourseV2Payload(input, {
    projectAssetUrl: (_assetId, metadata) => metadata.remote?.url,
  })
}

function previewRemoteAssetUrls(published: PublishedCourseV2Payload): string[] {
  return Object.values(published.assets)
    .map((asset) => asset.url)
    .filter((url) => {
      try {
        return new URL(url).protocol === 'https:'
      } catch {
        return false
      }
    })
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
      return
    }
    resolve()
  })
}

export async function waitForHostLayout(
  container: HTMLElement,
  options: { maxFrames?: number } = {},
): Promise<void> {
  const maxFrames = options.maxFrames ?? 16
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (container.clientWidth >= 8 && container.clientHeight >= 8) return
    await nextAnimationFrame()
  }
}

export async function mountPublishedCourseTryRun(input: {
  container: HTMLElement
  project: CourseProjectDocument
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
  locationId?: string | null
  playbackPathId?: string | null
  width?: number
  height?: number
}): Promise<PublishedCourseSession> {
  const published = buildPublishedCourseTryRunPayload({
    project: input.project,
    assetFiles: input.assetFiles,
    components: input.components,
  })
  const remoteAssetUrls = previewRemoteAssetUrls(published)
  const connectOrigins = input.project.network?.connectOrigins ?? []
  const networkRequired = remoteAssetUrls.length > 0 || connectOrigins.length > 0
  const leaseId = nextPreviewNetworkLeaseId()
  const desktop = window.desktopAPI
  if (
    networkRequired
    && (
      !desktop
      || typeof desktop.setPreviewNetworkPolicy !== 'function'
      || typeof desktop.releasePreviewNetworkPolicy !== 'function'
    )
  ) {
    throw new Error('当前宿主无法应用课件预览网络声明。')
  }

  let leaseApplied = false
  let session: PublishedCourseSession | null = null
  const releaseLease = async (): Promise<void> => {
    if (!leaseApplied) return
    leaseApplied = false
    await desktop!.releasePreviewNetworkPolicy({ leaseId })
  }

  try {
    if (networkRequired) {
      await desktop!.setPreviewNetworkPolicy({
        leaseId,
        connectOrigins: [...connectOrigins],
        remoteAssetUrls,
      })
      leaseApplied = true
    }
    await waitForHostLayout(input.container)
    session = createPublishedCourseSession(published, {
      playbackPathId: input.playbackPathId,
      ...(input.locationId ? { initialLocationId: input.locationId } : {}),
    })
    await session.mount(input.container)
    fitPublishedCourseStage(input.container)

    const destroySession = session.destroy.bind(session)
    session.destroy = async (): Promise<void> => {
      try {
        await destroySession()
      } finally {
        await releaseLease()
      }
    }
    return session
  } catch (error) {
    try {
      await session?.destroy()
    } finally {
      await releaseLease()
    }
    throw error
  }
}
