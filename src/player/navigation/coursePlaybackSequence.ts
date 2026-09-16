import type { TeacherControllerAction } from '../../shared/teacherControllerConfig'

import type { PublishedCourseV2Payload } from '../../shared/publishedCourseTypes'
import type { CourseLocation, CourseProjectDocument } from '../../shared/courseProjectTypes'

export function playbackSceneKey(location: CourseLocation): string {
  return location.kind === 'slide-scene'
    ? `slide:${location.surfaceId}:${location.sceneId}`
    : `${location.kind}:${location.surfaceId}`
}

export interface CoursePlaybackStep {
  readonly id: string
  readonly locationId: string
  readonly stateId?: string
  readonly name: string
}

/** One contiguous occurrence of a scene. A later return is a new occurrence. */
export interface CoursePlaybackScene {
  readonly id: string
  readonly surfaceId: string
  readonly kind: 'slide' | 'flow' | 'spatial'
  readonly name: string
  readonly steps: readonly CoursePlaybackStep[]
}

export interface PlaybackNavigationProgress {
  readonly sceneId: string
  readonly sceneIndex: number
  readonly sceneCount: number
  readonly sceneName: string
  readonly stepId: string
  readonly stepIndex: number
  readonly stepCount: number
  readonly stepName: string
  readonly canPreviousStep: boolean
  readonly canNextStep: boolean
  readonly canPreviousScene: boolean
  readonly canNextScene: boolean
}

/** Read-only chrome port. The session remains the sole navigation writer. */
export interface PlaybackNavigationViewPort {
  getProgress(): PlaybackNavigationProgress | null
  canExecute(action: TeacherControllerAction): boolean
  subscribe(listener: () => void): () => void
}

export type PlaybackDirection = 'next' | 'previous'
export type PlaybackNavigationLevel = 'step' | 'scene'

export function buildCoursePlaybackSequence(
  payload: Pick<PublishedCourseV2Payload, 'locations' | 'surfaces'> | Pick<CourseProjectDocument, 'locations' | 'surfaces'>,
): readonly CoursePlaybackScene[] {
  const scenes: Array<Omit<CoursePlaybackScene, 'steps'> & { steps: CoursePlaybackStep[] }> = []
  let previousKey: string | undefined
  for (const location of payload.locations) {
    const surface = payload.surfaces.find(entry => entry.id === location.surfaceId)
    if (!surface) throw new Error(`Navigation surface ${location.surfaceId} is unavailable`)
    const slide = surface.type === 'slide' && location.kind === 'slide-scene'
      ? surface.scenes.find(entry => entry.id === location.sceneId)
      : undefined
    const key = playbackSceneKey(location)
    if (key !== previousKey) {
      scenes.push({
        id: location.id,
        surfaceId: surface.id,
        kind: surface.type === 'spatial-2d' ? 'spatial' : surface.type,
        name: slide?.name ?? surface.title,
        steps: [],
      })
      previousKey = key
    }
    const scene = scenes.at(-1)!
    const presentation = slide?.presentation
    const explicitStateId = location.kind === 'slide-scene' ? location.stateId : undefined
    const states = explicitStateId
      ? [presentation?.states.find(state => state.id === explicitStateId)]
      : presentation
        ? [
            presentation.states.find(state => state.id === presentation.initialStateId),
            ...presentation.states.filter(state => state.id !== presentation.initialStateId),
          ]
        : []
    if ((explicitStateId || presentation) && states.some(state => !state)) {
      throw new Error(`Navigation presentation state for ${location.id} is unavailable`)
    }
    if (states.length) {
      for (const state of states) {
        if (!state) continue
        scene.steps.push({
          id: JSON.stringify([location.id, state.id]),
          locationId: location.id,
          stateId: state.id,
          name: state.name,
        })
      }
    } else {
      scene.steps.push({ id: JSON.stringify([location.id]), locationId: location.id, name: location.label })
    }
  }
  return scenes
}

export function playbackNavigationProgress(
  scenes: readonly CoursePlaybackScene[],
  locationId: string | null,
  stateId?: string | null,
): PlaybackNavigationProgress | null {
  if (locationId === null) return null
  const sceneIndex = scenes.findIndex(scene => scene.steps.some(step => step.locationId === locationId))
  const scene = scenes[sceneIndex]
  if (!scene) return null
  const matchingState = scene.steps.findIndex(step => step.locationId === locationId && step.stateId === (stateId ?? undefined))
  // An explicit-state deep link can be changed by Runtime setState. It retains
  // its authored location position; no additional step or index is persisted.
  const stepIndex = matchingState >= 0 ? matchingState : scene.steps.findIndex(step => step.locationId === locationId)
  const step = scene.steps[stepIndex]!
  return {
    sceneId: scene.id, sceneIndex, sceneCount: scenes.length, sceneName: scene.name,
    stepId: step.id, stepIndex, stepCount: scene.steps.length, stepName: step.name,
    canPreviousStep: sceneIndex > 0 || stepIndex > 0,
    canNextStep: sceneIndex < scenes.length - 1 || stepIndex < scene.steps.length - 1,
    canPreviousScene: sceneIndex > 0,
    canNextScene: sceneIndex < scenes.length - 1,
  }
}

export function adjacentPlaybackTarget(
  scenes: readonly CoursePlaybackScene[],
  progress: PlaybackNavigationProgress | null,
  level: PlaybackNavigationLevel,
  direction: PlaybackDirection,
): CoursePlaybackStep | null {
  if (!progress) return null
  const delta = direction === 'next' ? 1 : -1
  if (level === 'step') {
    const step = scenes[progress.sceneIndex]?.steps[progress.stepIndex + delta]
    if (step) return step
  }
  const scene = scenes[progress.sceneIndex + delta]
  if (!scene) return null
  return level === 'step' && direction === 'previous' ? scene.steps.at(-1)! : scene.steps[0]!
}
