import type { PublishedCourseV2Payload } from '../../shared/publishedCourseTypes'
import type { TeacherControllerAction } from '../../shared/contracts/native-v1'
import { buildCoursePlaybackSequence, playbackNavigationProgress, type PlaybackNavigationViewPort } from '../../player/navigation/coursePlaybackSequence'
import { publishedControllerNavigationTarget } from '../../player/surfaces/publishedDynamicHosts'

/** Current-surface preview uses the course projection, with cross-surface targets unavailable. */
export function createLocationTryRunNavigation(payload: PublishedCourseV2Payload, readLocationId: () => string) {
  const scenes = buildCoursePlaybackSequence(payload)
  const listeners = new Set<() => void>()
  const target = (action: TeacherControllerAction) => {
    const currentId = readLocationId()
    const location = publishedControllerNavigationTarget(action, { locations: payload.locations, currentLocationId: currentId, startLocationId: payload.startLocationId })
    const current = payload.locations.find(entry => entry.id === currentId)
    return location?.surfaceId === current?.surfaceId ? location : null
  }
  const port: PlaybackNavigationViewPort = {
    getProgress: () => playbackNavigationProgress(scenes, readLocationId()),
    canExecute: action => ['step.next', 'step.previous', 'scene.next', 'scene.previous', 'scene.go', 'scene.replay', 'course.restart'].includes(action.type) ? target(action) !== null : true,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  return { port, target, notify: () => { for (const listener of listeners) listener() } }
}
