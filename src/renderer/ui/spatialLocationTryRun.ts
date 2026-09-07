import type { ComponentPackageData } from '../../shared/componentTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { SpatialSurfaceHost } from '../../player/surfaces/spatial/SpatialSurfaceHost'
import { createLocationTryRunNavigation } from './locationTryRunNavigation'
import { buildPublishedCourseV2Payload } from '../export/course/buildPublishedCourse'

/**
 * Workspace current-location try-run. Does not import Phaser or the Slide
 * preview iframe. Tests should import this module instead of Workspace.tsx.
 */
export async function mountSpatialLocationTryRun(input: {
  container: HTMLElement
  project: CourseProjectDocument
  assetFiles?: Record<string, Uint8Array>
  components?: Record<string, ComponentPackageData>
  locationId: string
  playbackPathId?: string | null
  width?: number
  height?: number
}) {
  const published = buildPublishedCourseV2Payload({
    project: input.project,
    assetFiles: input.assetFiles ?? {},
    components: input.components ?? {},
  })
  let host!: SpatialSurfaceHost
  const navigation = createLocationTryRunNavigation(published, () => host?.locationId ?? input.locationId)
  host = SpatialSurfaceHost.fromPublishedCourse(
    published,
    {
      width: input.width ?? CANVAS_WIDTH,
      height: input.height ?? CANVAS_HEIGHT,
    },
    {
      locationId: input.locationId,
      navigation: navigation.port,
      playbackPathId: input.playbackPathId ?? null,
      playbackControls: published.playback.controls === 'none' ? 'none' : 'canvas',
      resolveAsset: (assetId) => published.assets[assetId]?.url,
      courseProgressSource: {
        getLocations: () => published.locations.map((location) => ({
          id: location.id,
          name: location.label,
        })),
        getCurrentLocationId: () => host.locationId,
        getStateLabel: () => null,
      },
      executeTeacherControllerAction: async (action) => {
        const target = navigation.target(action)
        if (!target || target.kind !== 'spatial-camera' || target.surfaceId !== host.id) {
          return false
        }
        try {
          await host.setLocationId(target.id)
          navigation.notify()
          return true
        } catch {
          return false
        }
      },
    },
  )
  await host.mount(input.container)
  await host.activate()
  return host
}
