import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { FlowSurfaceHost } from '../../player/surfaces/flow/FlowSurfaceHost'
import { createLocationTryRunNavigation } from './locationTryRunNavigation'
import { buildPublishedCourseV2Payload } from '../export/course/buildPublishedCourse'

/**
 * Workspace current-location try-run for Flow. Does not import Phaser or the
 * Slide preview iframe. Tests should import this module instead of Workspace.tsx.
 */
export async function mountFlowLocationTryRun(input: {
  container: HTMLElement
  project: CourseProjectDocument
  assetFiles?: Record<string, Uint8Array>
  components?: Record<string, ComponentPackageData>
  locationId: string
}) {
  const published = buildPublishedCourseV2Payload({
    project: input.project,
    assetFiles: input.assetFiles ?? {},
    components: input.components ?? {},
  })
  let host!: FlowSurfaceHost
  const navigation = createLocationTryRunNavigation(published, () => host?.locationId ?? input.locationId)
  host = new FlowSurfaceHost(published, {
    navigation: navigation.port,
    locationId: input.locationId,
    initialTocOpen: false,
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
      if (!target || target.kind !== 'flow-block') return false
      try {
        await host.setLocationId(target.id)
        navigation.notify()
        return true
      } catch {
        return false
      }
    },
  })
  await host.mount(input.container)
  await host.activate()
  return host
}
