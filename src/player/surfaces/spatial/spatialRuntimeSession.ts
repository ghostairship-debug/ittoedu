import type { SpatialCameraPose } from '../../../shared/courseProjectTypes'
import type { PublishedCourseV2Payload } from '../../../shared/publishedCourseTypes'
import {
  clonePublishedSpatialInput,
  publishedPoseForLocation,
  publishedSpatialInputFromCourse,
  spatialCameraTourStops,
  spatialPosesEqual,
  spatialRuntimeCameraFromPose,
  spatialRuntimeCameraPose,
  validateSpatialRuntimeCamera,
  type PublishedSpatialRuntimeInput,
  type SpatialRuntimeCamera,
  type SpatialRuntimeViewport,
  type SpatialTourStop,
} from './spatialModel'

export interface SpatialRuntimeSession {
  readonly input: PublishedSpatialRuntimeInput
  readonly viewport: SpatialRuntimeViewport
  readonly locationId: string
  readonly playbackPathId: string | null
  readonly camera: SpatialRuntimeCamera | null
  readonly tourIndex: number
  readonly stops: readonly SpatialTourStop[]
  readonly active: boolean
}

export interface SpatialRuntimeStepResult {
  session: SpatialRuntimeSession
  atBoundary: boolean
}

export interface OpenSpatialRuntimeSessionOptions {
  surfaceId?: string
  playbackPathId?: string | null
  locationId?: string
}

function copyViewport(viewport: SpatialRuntimeViewport): SpatialRuntimeViewport {
  return { width: viewport.width, height: viewport.height }
}

function copySession(session: SpatialRuntimeSession): SpatialRuntimeSession {
  return {
    input: session.input,
    viewport: copyViewport(session.viewport),
    locationId: session.locationId,
    playbackPathId: session.playbackPathId,
    camera: session.camera ? { ...session.camera } : null,
    tourIndex: session.tourIndex,
    stops: session.stops,
    active: session.active,
  }
}

function cameraFromPose(
  pose: SpatialCameraPose,
  viewport: SpatialRuntimeViewport,
): SpatialRuntimeCamera {
  return spatialRuntimeCameraFromPose(pose, viewport)
}

function indexMatchingPose(
  stops: readonly SpatialTourStop[],
  pose: SpatialCameraPose,
): number {
  return stops.findIndex((stop) => spatialPosesEqual(stop.pose, pose))
}

function locationAfterStop(
  session: SpatialRuntimeSession,
  stop: SpatialTourStop | undefined,
): string {
  return stop?.locationId ?? session.locationId
}

function isPublishedCourseSource(
  source: PublishedCourseV2Payload | PublishedSpatialRuntimeInput,
): source is PublishedCourseV2Payload {
  return 'format' in source && source.format === 'h5course-published'
}

function buildSession(
  input: PublishedSpatialRuntimeInput,
  viewport: SpatialRuntimeViewport,
  locationId: string,
  playbackPathId: string | null,
): SpatialRuntimeSession {
  const document = clonePublishedSpatialInput({ ...input, playbackPathId })
  const stops = spatialCameraTourStops(document)
  const home = document.surface.camera.home
  return {
    input: document,
    viewport: copyViewport(viewport),
    locationId,
    playbackPathId,
    camera: cameraFromPose(home, viewport),
    tourIndex: indexMatchingPose(stops, home),
    stops,
    active: true,
  }
}

export function openSpatialRuntimeSession(
  source: PublishedCourseV2Payload | PublishedSpatialRuntimeInput,
  viewport: SpatialRuntimeViewport,
  options: OpenSpatialRuntimeSessionOptions = {},
): SpatialRuntimeSession {
  const input = isPublishedCourseSource(source)
    ? publishedSpatialInputFromCourse(source, {
        surfaceId: options.surfaceId,
        playbackPathId: options.playbackPathId ?? null,
      })
    : clonePublishedSpatialInput({
        ...source,
        playbackPathId: options.playbackPathId ?? source.playbackPathId,
      })
  const locationId = options.locationId ?? input.startLocationId
  return buildSession(input, viewport, locationId, input.playbackPathId)
}

export function spatialRuntimeGoNext(session: SpatialRuntimeSession): SpatialRuntimeStepResult {
  if (!session.camera || !session.active) {
    return { session: copySession(session), atBoundary: true }
  }
  const nextIndex = session.tourIndex < 0 ? 0 : session.tourIndex + 1
  if (nextIndex >= session.stops.length) {
    return { session: copySession(session), atBoundary: true }
  }
  const stop = session.stops[nextIndex]!
  return {
    atBoundary: false,
    session: {
      ...copySession(session),
      camera: cameraFromPose(stop.pose, session.viewport),
      tourIndex: nextIndex,
      locationId: locationAfterStop(session, stop),
    },
  }
}

export function spatialRuntimeGoPrevious(session: SpatialRuntimeSession): SpatialRuntimeStepResult {
  if (!session.camera || !session.active) {
    return { session: copySession(session), atBoundary: true }
  }
  if (session.tourIndex <= 0) {
    const home = session.input.surface.camera.home
    const alreadyHome = spatialPosesEqual(spatialRuntimeCameraPose(session.camera), home)
    if (alreadyHome && session.tourIndex <= 0) {
      return { session: copySession(session), atBoundary: true }
    }
    return {
      atBoundary: false,
      session: {
        ...copySession(session),
        camera: cameraFromPose(home, session.viewport),
        tourIndex: indexMatchingPose(session.stops, home),
      },
    }
  }
  const previousIndex = session.tourIndex - 1
  const stop = session.stops[previousIndex]!
  return {
    atBoundary: false,
    session: {
      ...copySession(session),
      camera: cameraFromPose(stop.pose, session.viewport),
      tourIndex: previousIndex,
      locationId: locationAfterStop(session, stop),
    },
  }
}

export function enterSpatialRuntimeLocation(
  session: SpatialRuntimeSession,
  locationId: string,
): SpatialRuntimeSession {
  const pose = publishedPoseForLocation(session.input, locationId)
  const next = buildSession(
    session.input,
    session.viewport,
    locationId,
    session.playbackPathId,
  )
  return {
    ...next,
    camera: cameraFromPose(pose, session.viewport),
    tourIndex: indexMatchingPose(next.stops, pose),
    active: true,
  }
}

export function leaveSpatialRuntimeLocation(session: SpatialRuntimeSession): SpatialRuntimeSession {
  return {
    ...copySession(session),
    camera: null,
    active: false,
  }
}

export function reopenSpatialRuntimeSession(session: SpatialRuntimeSession): SpatialRuntimeSession {
  return enterSpatialRuntimeLocation(
    {
      ...session,
      camera: null,
      active: false,
    },
    session.locationId,
  )
}

export function setSpatialRuntimeCamera(
  session: SpatialRuntimeSession,
  camera: SpatialRuntimeCamera,
): SpatialRuntimeSession {
  if (!session.active) return copySession(session)
  const next = validateSpatialRuntimeCamera({
    ...camera,
    viewportWidth: session.viewport.width,
    viewportHeight: session.viewport.height,
  })
  return {
    ...copySession(session),
    camera: next,
    tourIndex: indexMatchingPose(session.stops, next),
  }
}

export function selectSpatialRuntimePlaybackPath(
  session: SpatialRuntimeSession,
  playbackPathId: string | null,
): SpatialRuntimeSession {
  const locationId = session.locationId
  const rebuilt = buildSession(session.input, session.viewport, locationId, playbackPathId)
  if (!session.active || !session.camera) {
    return { ...rebuilt, camera: null, active: false }
  }
  return {
    ...rebuilt,
    camera: {
      ...session.camera,
      viewportWidth: session.viewport.width,
      viewportHeight: session.viewport.height,
    },
    active: true,
  }
}

export function spatialRuntimeAtStart(session: SpatialRuntimeSession): boolean {
  if (!session.camera) return true
  const home = session.input.surface.camera.home
  return session.tourIndex <= 0 && spatialPosesEqual(spatialRuntimeCameraPose(session.camera), home)
}

export function spatialRuntimeAtEnd(session: SpatialRuntimeSession): boolean {
  if (!session.camera || session.stops.length === 0) return true
  return session.tourIndex >= session.stops.length - 1
}
