import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON,
  surfaceTypeForLocation,
  switchCourseAuthoringLocation,
  type CourseAuthoringSession,
} from '../authoring/courseAuthoringSession'

export type ActiveSurfaceKind = 'slide' | 'flow' | 'spatial'

export type SurfaceRouterSessionSnapshot = {
  readonly spatialLocationId: string | null
  readonly flowLocationId: string | null
  readonly slideLocationId: string | null
  readonly editingScope: 'scene' | 'global'
  readonly composing: boolean
}

export type SurfaceActivationPlan =
  | {
      readonly ok: false
      readonly reason: string
    }
  | {
      readonly ok: true
      readonly kind: 'noop-same-location'
      readonly locationId: string
      readonly surface: ActiveSurfaceKind
      readonly authoringSession: CourseAuthoringSession
    }
  | {
      readonly ok: true
      readonly kind: 'open-flow' | 'open-spatial' | 'open-slide' | 'activate-slide-scene'
      readonly locationId: string
      readonly surface: ActiveSurfaceKind
      readonly authoringSession: CourseAuthoringSession
      readonly sceneId?: string
    }

export function detectActiveSurface(
  snapshot: SurfaceRouterSessionSnapshot,
): ActiveSurfaceKind | null {
  if (snapshot.spatialLocationId) return 'spatial'
  if (snapshot.flowLocationId) return 'flow'
  if (snapshot.slideLocationId) return 'slide'
  return null
}

export function planActivateCourseLocation(input: {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly snapshot: SurfaceRouterSessionSnapshot
  readonly authoringSession: CourseAuthoringSession | null
  readonly buildSession: (locationId: string) => CourseAuthoringSession
}): SurfaceActivationPlan {
  const location = input.project.locations.find((candidate) => candidate.id === input.locationId)
  if (!location) {
    return { ok: false, reason: '找不到要打开的课程位置' }
  }
  if (input.snapshot.composing) {
    return { ok: false, reason: COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON }
  }

  let nextAuthoringSession = input.authoringSession
  try {
    const surfaceType = surfaceTypeForLocation(input.project, input.locationId)
    if (nextAuthoringSession) {
      const switched = switchCourseAuthoringLocation(nextAuthoringSession, {
        locationId: input.locationId,
        surfaceType,
        revision: input.project.revision,
        composing: false,
      })
      if ('ok' in switched && switched.ok === false) {
        return { ok: false, reason: switched.reason }
      }
      nextAuthoringSession = switched as CourseAuthoringSession
    } else {
      nextAuthoringSession = input.buildSession(input.locationId)
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : '无法切换课程位置',
    }
  }

  if (location.kind === 'flow-block') {
    if (
      input.snapshot.flowLocationId === input.locationId &&
      input.snapshot.editingScope !== 'global'
    ) {
      return {
        ok: true,
        kind: 'noop-same-location',
        locationId: input.locationId,
        surface: 'flow',
        authoringSession: nextAuthoringSession,
      }
    }
    return {
      ok: true,
      kind: 'open-flow',
      locationId: input.locationId,
      surface: 'flow',
      authoringSession: nextAuthoringSession,
    }
  }

  if (location.kind === 'spatial-camera') {
    if (
      input.snapshot.spatialLocationId === input.locationId &&
      input.snapshot.editingScope !== 'global'
    ) {
      return {
        ok: true,
        kind: 'noop-same-location',
        locationId: input.locationId,
        surface: 'spatial',
        authoringSession: nextAuthoringSession,
      }
    }
    return {
      ok: true,
      kind: 'open-spatial',
      locationId: input.locationId,
      surface: 'spatial',
      authoringSession: nextAuthoringSession,
    }
  }

  if (location.kind === 'slide-scene') {
    if (input.snapshot.spatialLocationId || input.snapshot.flowLocationId) {
      return {
        ok: true,
        kind: 'open-slide',
        locationId: input.locationId,
        surface: 'slide',
        authoringSession: nextAuthoringSession,
        sceneId: location.sceneId,
      }
    }
    return {
      ok: true,
      kind: 'activate-slide-scene',
      locationId: input.locationId,
      surface: 'slide',
      authoringSession: nextAuthoringSession,
      sceneId: location.sceneId,
    }
  }

  return { ok: false, reason: '当前课程位置没有可打开的编辑表面' }
}

export function dispatchActiveSurface<T>(
  surface: ActiveSurfaceKind | null,
  handlers: {
    slide: () => T
    flow: () => T
    spatial: () => T
    sessionless?: () => T
    none?: () => T
  },
): T {
  if (surface === 'spatial') return handlers.spatial()
  if (surface === 'flow') return handlers.flow()
  if (surface === 'slide') return handlers.slide()
  if (handlers.sessionless) return handlers.sessionless()
  if (handlers.none) return handlers.none()
  throw new Error('未提供针对无活动表面（sessionless/none）的处理回调')
}

export type InactiveSurfaceClear = {
  readonly spatialSession: null
  readonly spatialClipboard: null
  readonly spatialContentEdit: null
  readonly spatialGraphSelection: null
  readonly spatialPlaybackPathId: null
  readonly flowSession: null
  readonly flowTextEdit: null
  readonly flowClipboard: null
  readonly slideBackend: null
  readonly slideCandidateSnapshot: null
  readonly slideCandidateClipboard: null
  readonly v9ContentEdit: null
}

export function exclusiveInactiveSurfaces(
  active: ActiveSurfaceKind,
): Partial<InactiveSurfaceClear> {
  if (active === 'slide') {
    return {
      spatialSession: null,
      spatialClipboard: null,
      spatialContentEdit: null,
      spatialGraphSelection: null,
      spatialPlaybackPathId: null,
      flowSession: null,
      flowTextEdit: null,
      flowClipboard: null,
    }
  }
  if (active === 'flow') {
    return {
      spatialSession: null,
      spatialClipboard: null,
      spatialContentEdit: null,
      spatialGraphSelection: null,
      spatialPlaybackPathId: null,
      slideBackend: null,
      slideCandidateSnapshot: null,
      slideCandidateClipboard: null,
      v9ContentEdit: null,
    }
  }
  return {
    flowSession: null,
    flowTextEdit: null,
    flowClipboard: null,
    slideBackend: null,
    slideCandidateSnapshot: null,
    slideCandidateClipboard: null,
    v9ContentEdit: null,
  }
}
