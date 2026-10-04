import type { ComponentPackageData } from '../../shared/componentTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { SpatialSurfaceHost } from '../../player/surfaces/spatial/SpatialSurfaceHost'
import { adjacentPlaybackTarget, buildCoursePlaybackSequence, playbackNavigationProgress, type CoursePlaybackStep, type PlaybackNavigationViewPort } from '../../player/navigation/coursePlaybackSequence'
import { publishedControllerNavigationTarget } from '../../player/surfaces/publishedDynamicHosts'
import type { TeacherControllerAction } from '../../shared/teacherControllerConfig'
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
  const surfaceId = published.locations.find(location => location.id === input.locationId)?.surfaceId
  const scenes = buildCoursePlaybackSequence(published)
  const listeners = new Set<() => void>()
  const progress = () => playbackNavigationProgress(scenes, host?.locationId ?? input.locationId, host?.getPublishedPresentationStateId())
  const target = (action: TeacherControllerAction): CoursePlaybackStep | null => {
    let step: CoursePlaybackStep | null
    if (action.type === 'step.next' || action.type === 'step.previous' || action.type === 'scene.next' || action.type === 'scene.previous') {
      step = adjacentPlaybackTarget(scenes, progress(), action.type.startsWith('step.') ? 'step' : 'scene', action.type.endsWith('next') ? 'next' : 'previous')
    } else if (action.type === 'scene.replay') {
      const current = progress()
      step = current ? scenes[current.sceneIndex]!.steps[0]! : null
    } else {
      const location = publishedControllerNavigationTarget(action, { locations: published.locations, currentLocationId: host?.locationId ?? input.locationId, startLocationId: published.startLocationId })
      step = location ? scenes.flatMap(scene => scene.steps).find(entry => entry.locationId === location.id) ?? null : null
      if (step && action.type === 'scene.go' && action.targetStateId !== undefined) step = { ...step, stateId: action.targetStateId }
    }
    return step && published.locations.some(location => location.id === step.locationId && location.surfaceId === surfaceId) ? step : null
  }
  const navigation: PlaybackNavigationViewPort = {
    getProgress: progress,
    canExecute: action => ['step.next', 'step.previous', 'scene.next', 'scene.previous', 'scene.go', 'scene.replay', 'course.restart'].includes(action.type) ? target(action) !== null : true,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  host = SpatialSurfaceHost.fromPublishedCourse(
    published,
    {
      width: input.width ?? CANVAS_WIDTH,
      height: input.height ?? CANVAS_HEIGHT,
    },
    {
      locationId: input.locationId,
      navigation,
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
        const step = target(action)
        if (!step) return false
        try {
          const replay = action.type === 'scene.replay' || action.type === 'course.restart'
          if (!host.preparePublishedPresentationState(step.locationId, step.stateId, !replay)) return false
          host.preparePublishedLocation(step.locationId, replay)
          await host.setLocationId(step.locationId)
          for (const listener of listeners) listener()
          return true
        } catch {
          return false
        }
      },
    },
  )
  await host.mount(input.container)
  await host.activate()
  await host.setLocationId(input.locationId)
  return host
}
