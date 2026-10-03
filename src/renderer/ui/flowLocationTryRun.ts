import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { FlowSurfaceHost } from '../../player/surfaces/flow/FlowSurfaceHost'
import { PlaybackViewSession } from '../../player/playbackViewSession'
import { PlayerPresenterInput } from '../../player/PlayerPresenterInput'
import { buildCoursePlaybackSequence, edgePlaybackTarget, playbackNavigationProgress } from '../../player/navigation/coursePlaybackSequence'
import { createLocationTryRunNavigation } from './locationTryRunNavigation'
import { buildPublishedCourseV2Payload } from '../export/course/buildPublishedCourse'
import { registerAuthoringObservationHost } from '../authoring/generation/authoringObservation'

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
  const playbackView = new PlaybackViewSession()
  const published = buildPublishedCourseV2Payload({
    project: input.project,
    assetFiles: input.assetFiles ?? {},
    components: input.components ?? {},
  })
  let host!: FlowSurfaceHost
  const navigation = createLocationTryRunNavigation(published, () => host?.locationId ?? input.locationId)
  const goTo = async (locationId: string): Promise<boolean> => {
    try {
      await host.setLocationId(locationId)
      navigation.notify()
      return true
    } catch {
      return false
    }
  }
  host = new FlowSurfaceHost(published, {
    navigation: navigation.port,
    locationId: input.locationId,
    initialTocOpen: false,
    playbackView,
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
      return target?.kind === 'flow-block' ? goTo(target.id) : false
    },
  })
  const viewport = playbackView.mount(input.container)
  await host.mount(viewport)
  await host.activate()
  playbackView.activate(host.surfaceId)
  const unregisterObservation = registerAuthoringObservationHost({
    root: input.container, source: 'trial',
    read: () => ({ projectId: input.project.id, documentRevision: input.project.revision, ...host.readObservationState() }),
  })
  // The same course keys as the exported player, limited to this surface like the controller.
  const scenes = buildCoursePlaybackSequence(published)
  const keys = new PlayerPresenterInput({
    root: input.container,
    keyboardNavigation: published.playback.keyboardNavigation,
    presenter: published.playback.presenter,
    navigate: (command) => {
      const target = command.kind === 'edge'
        ? published.locations.find(location => location.id
          === edgePlaybackTarget(scenes, playbackNavigationProgress(scenes, host.locationId), command.edge)?.locationId)
        : navigation.target({ type: `${command.kind}.${command.direction}` as const })
      if (target?.kind !== 'flow-block' || target.surfaceId !== host.surfaceId) return false
      void goTo(target.id)
      return true
    },
    // A single Flow surface carries no authored presenter rules.
    onAuthoredCommand: () => false,
  })
  const destroyHost = host.destroy.bind(host)
  host.destroy = async () => {
    keys.destroy()
    unregisterObservation()
    await destroyHost()
    playbackView.destroy()
  }
  return host
}
