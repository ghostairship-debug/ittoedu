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
import type { PlayerAuthoringHostMessage } from '../../shared/playerAuthoringProtocol'

export { attachPublishedCourseStageFit, fitPublishedCourseStage }

export function fitPublishedCourseHostForMode(
  container: HTMLElement,
  mode: 'playback' | 'authoring',
): void {
  // The authoring host already occupies the canonical 1280×720 stage and
  // follows Workspace's single stage transform. A second letterbox here would
  // move the Published pixels without moving the sibling authoring targets.
  if (mode === 'authoring') return
  fitPublishedCourseStage(container)
}

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
  return buildPublishedCourseV2Payload(input)
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

export interface PublishedCourseMountInput {
  container: HTMLElement
  project: CourseProjectDocument
  assetFiles: Readonly<Record<string, Uint8Array>>
  components: Readonly<Record<string, ComponentPackageData>>
  locationId?: string | null
  /** Session-only Slide state used for the first current-position try-run mount. */
  initialPresentationStateId?: string | null
  playbackPathId?: string | null
  width?: number
  height?: number
  authoring?: {
    sessionId: string
    scope: 'scene' | 'surface' | 'global'
    stateId: string | null
    onMessage?: (message: PlayerAuthoringHostMessage) => void
  }
  onSessionCreated?: (session: PublishedCourseSession) => void
}

export async function mountPublishedCourseTryRun(
  input: PublishedCourseMountInput,
): Promise<PublishedCourseSession> {
  const publishSources = {
    project: input.project,
    assetFiles: input.assetFiles,
    components: input.components,
  }
  // Authoring and playback execute the same Published closure in this
  // document, so both lease only URLs that survived publishing plus the
  // project's exact declared origins.
  const playback = input.authoring === undefined
  if (!playback && input.initialPresentationStateId != null) {
    throw new Error('Published 作者宿主不能接收试运行初始命名状态。')
  }
  const published = buildPublishedCourseTryRunPayload(publishSources)
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
      ...(playback && input.initialPresentationStateId != null
        ? { initialPresentationStateId: input.initialPresentationStateId }
        : {}),
      ...(input.authoring
        ? {
            authoring: {
              ...input.authoring,
              // Component editor schemas are authoring-only sidecar data and
              // deliberately remain outside the Published Course V2 contract.
              componentPackages: input.components,
            },
          }
        : {}),
    })
    input.onSessionCreated?.(session)
    await session.mount(input.container)
    fitPublishedCourseHostForMode(
      input.container,
      input.authoring ? 'authoring' : 'playback',
    )

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

export function mountPublishedCourseAuthoring(
  input: Omit<PublishedCourseMountInput, 'authoring' | 'initialPresentationStateId'> & {
    sessionId: string
    scope: 'scene' | 'surface' | 'global'
    stateId: string | null
    onMessage?: (message: PlayerAuthoringHostMessage) => void
  },
): Promise<PublishedCourseSession> {
  const {
    sessionId,
    scope,
    stateId,
    onMessage,
    ...mountInput
  } = input
  return mountPublishedCourseTryRun({
    ...mountInput,
    authoring: {
      sessionId,
      scope,
      stateId,
      ...(onMessage ? { onMessage } : {}),
    },
  })
}
