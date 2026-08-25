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

export { attachPublishedCourseStageFit, fitPublishedCourseStage }

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
  const published = buildPublishedCourseV2Payload({
    project: input.project,
    assetFiles: input.assetFiles,
    components: input.components,
  })
  await waitForHostLayout(input.container)
  const session = createPublishedCourseSession(published, {
    playbackPathId: input.playbackPathId,
    ...(input.locationId ? { initialLocationId: input.locationId } : {}),
  })
  await session.mount(input.container)
  fitPublishedCourseStage(input.container)
  return session
}
