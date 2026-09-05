import type {
  CourseLocation,
  GlobalLayerPlane,
  SpatialCameraPose,
  SpatialPathDocument,
  SpatialRelationDocument,
  SpatialSemanticZoomRule,
} from '../../../shared/courseProjectTypes'
import {
  composePublishedCourseLocation,
  resolveEffectiveGlobalLayerPlanes,
  type CourseLayerComposition,
} from '../../../shared/courseLayerComposition'
import type {
  PublishedCourseV2Payload,
  PublishedGlobalLayerEntry,
  PublishedLayerItem,
  PublishedNativeLayerItem,
  PublishedScopedLayerItem,
  PublishedSpatialSurface,
} from '../../../shared/publishedCourseTypes'
import type { CourseBackgroundFields } from '../../../shared/effectiveBackground'

export type SpatialCoordinateSpace = 'world' | 'viewport'
export type SpatialLayerSource = 'world' | 'surface' | 'global'

export interface SpatialRuntimeCamera {
  x: number
  y: number
  zoom: number
  viewportWidth: number
  viewportHeight: number
}

export interface SpatialRuntimeViewport {
  width: number
  height: number
}

export interface PublishedSpatialRuntimeInput {
  surface: PublishedSpatialSurface
  globalLayerItems: readonly PublishedGlobalLayerEntry[]
  locations: readonly CourseLocation[]
  startLocationId: string
  playbackPathId: string | null
  courseBackground?: CourseBackgroundFields
}

export interface SpatialTourStop {
  pose: SpatialCameraPose
  frameId?: string
  pathId?: string
  layerItemId?: string
  locationId?: string
}

export interface SpatialPlaybackEntry {
  item: PublishedLayerItem
  source: SpatialLayerSource
  coordinateSpace: SpatialCoordinateSpace
  /** Resolved global plane; non-global entries carry null. */
  globalPlane: GlobalLayerPlane | null
  stackOrder: number
}

const POSE_EPSILON = 1e-4

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function positive(value: number, label: string): number {
  finite(value, label)
  if (value <= 0) throw new Error(`${label} must be greater than zero`)
  return value
}

export function validateSpatialRuntimeCamera(camera: SpatialRuntimeCamera): SpatialRuntimeCamera {
  finite(camera.x, 'camera.x')
  finite(camera.y, 'camera.y')
  positive(camera.zoom, 'camera.zoom')
  positive(camera.viewportWidth, 'camera.viewportWidth')
  positive(camera.viewportHeight, 'camera.viewportHeight')
  return { ...camera }
}

export function spatialRuntimeCameraFromPose(
  pose: SpatialCameraPose,
  viewport: SpatialRuntimeViewport,
): SpatialRuntimeCamera {
  return validateSpatialRuntimeCamera({
    x: pose.x,
    y: pose.y,
    zoom: pose.zoom,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  })
}

export function spatialWorldGroupTransform(camera: SpatialRuntimeCamera): string {
  validateSpatialRuntimeCamera(camera)
  return `translate(${camera.viewportWidth / 2} ${camera.viewportHeight / 2}) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`
}

export function spatialWorldToScreen(
  camera: SpatialRuntimeCamera,
  point: { x: number; y: number },
): { x: number; y: number } {
  validateSpatialRuntimeCamera(camera)
  return {
    x: (point.x - camera.x) * camera.zoom + camera.viewportWidth / 2,
    y: (point.y - camera.y) * camera.zoom + camera.viewportHeight / 2,
  }
}

export function spatialScreenToWorld(
  camera: SpatialRuntimeCamera,
  point: { x: number; y: number },
): { x: number; y: number } {
  validateSpatialRuntimeCamera(camera)
  return {
    x: (point.x - camera.viewportWidth / 2) / camera.zoom + camera.x,
    y: (point.y - camera.viewportHeight / 2) / camera.zoom + camera.y,
  }
}

export function panSpatialRuntimeCamera(
  camera: SpatialRuntimeCamera,
  screenDelta: { x: number; y: number },
): SpatialRuntimeCamera {
  return validateSpatialRuntimeCamera({
    ...camera,
    x: camera.x - finite(screenDelta.x, 'pan.x') / camera.zoom,
    y: camera.y - finite(screenDelta.y, 'pan.y') / camera.zoom,
  })
}

export function zoomSpatialRuntimeCameraAt(
  camera: SpatialRuntimeCamera,
  nextZoom: number,
  screenAnchor: { x: number; y: number },
  limits: { min: number; max: number } = { min: 0.05, max: 32 },
): SpatialRuntimeCamera {
  positive(limits.min, 'minZoom')
  positive(limits.max, 'maxZoom')
  if (limits.min > limits.max) throw new Error('minZoom cannot exceed maxZoom')
  const before = spatialScreenToWorld(camera, screenAnchor)
  const zoom = Math.min(limits.max, Math.max(limits.min, positive(nextZoom, 'zoom')))
  const provisional = { ...camera, zoom }
  const after = spatialScreenToWorld(provisional, screenAnchor)
  return validateSpatialRuntimeCamera({
    ...provisional,
    x: provisional.x + before.x - after.x,
    y: provisional.y + before.y - after.y,
  })
}

export function spatialPosesEqual(
  left: SpatialCameraPose,
  right: SpatialCameraPose,
  epsilon = POSE_EPSILON,
): boolean {
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.zoom - right.zoom) <= epsilon
  )
}

export function isPublishedScopedVisible(
  visibility: PublishedScopedLayerItem['visibility'],
  locationId: string | null,
): boolean {
  if (visibility.mode === 'all') return true
  if (!locationId) return false
  const listed = visibility.locationIds.includes(locationId)
  return visibility.mode === 'include' ? listed : !listed
}

export function isSpatialTeacherControllerItem(
  item: PublishedLayerItem,
): item is PublishedNativeLayerItem & {
  content: Extract<PublishedNativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

export function spatialPlaybackCoordinateSpace(
  source: SpatialLayerSource,
  item: PublishedLayerItem,
): SpatialCoordinateSpace {
  if (isSpatialTeacherControllerItem(item) || source === 'global') return 'viewport'
  return 'world'
}

export function isSpatialViewportPlaybackItem(
  source: SpatialLayerSource,
  item: PublishedLayerItem,
): boolean {
  return spatialPlaybackCoordinateSpace(source, item) === 'viewport'
}

export function clonePublishedSpatialInput(
  input: PublishedSpatialRuntimeInput,
): PublishedSpatialRuntimeInput {
  return {
    surface: structuredClone(input.surface),
    globalLayerItems: structuredClone(input.globalLayerItems),
    locations: structuredClone(input.locations),
    startLocationId: input.startLocationId,
    playbackPathId: input.playbackPathId,
    courseBackground: input.courseBackground ? structuredClone(input.courseBackground) : undefined,
  }
}

export function publishedSpatialInputFromCourse(
  course: PublishedCourseV2Payload,
  options: { surfaceId?: string; playbackPathId?: string | null } = {},
): PublishedSpatialRuntimeInput {
  const surface = course.surfaces.find((candidate): candidate is PublishedSpatialSurface => (
    candidate.type === 'spatial-2d' &&
    (options.surfaceId ? candidate.id === options.surfaceId : true)
  ))
  if (!surface) {
    throw new Error('Published Course V2 中没有 Spatial 表面')
  }
  const locations = course.locations.filter((location) => (
    location.kind === 'spatial-camera' && location.surfaceId === surface.id
  ))
  const startLocationId = locations.some((location) => location.id === course.startLocationId)
    ? course.startLocationId
    : locations[0]?.id ?? surface.id
  return clonePublishedSpatialInput({
    surface,
    globalLayerItems: course.globalLayerItems,
    locations,
    startLocationId,
    playbackPathId: options.playbackPathId ?? null,
    courseBackground: {
      backgroundColor: course.backgroundColor,
      backgroundAssetId: course.backgroundAssetId,
    },
  })
}

export function publishedSpatialPaths(
  surface: PublishedSpatialSurface,
): SpatialPathDocument[] {
  return [...(surface.world.paths ?? [])]
}

export function publishedSpatialRelations(
  surface: PublishedSpatialSurface,
): SpatialRelationDocument[] {
  return [...(surface.world.relations ?? [])]
}

export function publishedCameraSnapshot(surface: PublishedSpatialSurface): {
  home: SpatialCameraPose
  frames: PublishedSpatialSurface['camera']['frames']
} {
  return structuredClone(surface.camera)
}

function layerCenter(item: PublishedLayerItem): { x: number; y: number } {
  return {
    x: item.frame.x + item.frame.width / 2,
    y: item.frame.y + item.frame.height / 2,
  }
}

function locationForFrame(
  locations: readonly CourseLocation[],
  surfaceId: string,
  frameId: string,
): string | undefined {
  return locations.find((location) => (
    location.kind === 'spatial-camera' &&
    location.surfaceId === surfaceId &&
    location.cameraFrameId === frameId
  ))?.id
}

export function spatialPathWaypoints(
  surface: PublishedSpatialSurface,
  pathId: string,
): SpatialTourStop[] {
  const path = publishedSpatialPaths(surface).find((candidate) => candidate.id === pathId)
  if (!path) return []
  const items = new Map(surface.world.layerItems.map((item) => [item.layerItemId, item]))
  const zoom = surface.camera.home.zoom
  return path.layerItemIds.flatMap((layerItemId) => {
    const item = items.get(layerItemId)
    if (!item) return []
    const center = layerCenter(item)
    return [{
      pose: { x: center.x, y: center.y, zoom },
      pathId,
      layerItemId,
    }]
  })
}

export function spatialCameraTourStops(
  input: PublishedSpatialRuntimeInput,
): SpatialTourStop[] {
  const { surface, playbackPathId, locations } = input
  if (playbackPathId) {
    const waypoints = spatialPathWaypoints(surface, playbackPathId)
    if (waypoints.length > 0) return waypoints
  }
  if (surface.camera.frames.length > 0) {
    return surface.camera.frames.map((frame) => ({
      pose: { x: frame.x, y: frame.y, zoom: frame.zoom },
      frameId: frame.id,
      locationId: locationForFrame(locations, surface.id, frame.id),
    }))
  }
  return [{ pose: { ...surface.camera.home } }]
}

export function publishedPoseForLocation(
  input: PublishedSpatialRuntimeInput,
  locationId: string,
): SpatialCameraPose {
  const location = input.locations.find((candidate) => candidate.id === locationId)
  if (location?.kind === 'spatial-camera') {
    const frame = input.surface.camera.frames.find((candidate) => candidate.id === location.cameraFrameId)
    if (frame) return { x: frame.x, y: frame.y, zoom: frame.zoom }
  }
  return { ...input.surface.camera.home }
}

export function isSpatialItemSemanticallyVisible(
  itemId: string,
  zoom: number,
  rules: readonly SpatialSemanticZoomRule[],
): boolean {
  const applicable = rules.filter((rule) => (
    rule.layerItemIds.includes(itemId) && zoom >= rule.minZoom && zoom < rule.maxZoom
  ))
  if (applicable.length === 0) return true
  return applicable.every((rule) => rule.visible)
}

export function collectSpatialPlaybackEntries(
  input: PublishedSpatialRuntimeInput,
  locationId: string | null,
): SpatialPlaybackEntry[] {
  if (locationId !== null) {
    return composePublishedSpatialLocation({ input, locationId }).entries
      .filter((entry) => entry.mounted)
      .map((entry) => ({
        item: entry.item,
        source: entry.source as SpatialLayerSource,
        globalPlane: entry.globalPlane,
        stackOrder: entry.stackOrder,
        coordinateSpace: spatialPlaybackCoordinateSpace(
          entry.source as SpatialLayerSource,
          entry.item,
        ),
      }))
  }
  const effectiveGlobalPlanes = resolveEffectiveGlobalLayerPlanes(input.globalLayerItems)
  const entries = [
    ...input.globalLayerItems
      .filter((entry) => (
        entry.item.visible && isPublishedScopedVisible(entry.visibility, locationId)
      ))
      .map((entry) => ({
        item: entry.item,
        source: 'global' as const,
        globalPlane: effectiveGlobalPlanes.get(entry.item.layerItemId) ?? 'overlay',
        coordinateSpace: spatialPlaybackCoordinateSpace('global', entry.item),
      })),
    ...input.surface.surfaceLayerItems
      .filter((entry) => (
        entry.item.visible && isPublishedScopedVisible(entry.visibility, locationId)
      ))
      .map((entry) => ({
        item: entry.item,
        source: 'surface' as const,
        globalPlane: null,
        coordinateSpace: spatialPlaybackCoordinateSpace('surface', entry.item),
      })),
    ...input.surface.world.layerItems
      .filter((item) => item.visible)
      .map((item) => ({
        item,
        source: 'world' as const,
        globalPlane: null,
        coordinateSpace: spatialPlaybackCoordinateSpace('world', item),
      })),
  ]
  const sorted = [...entries].sort((left, right) => (
    left.item.order - right.item.order ||
    left.item.layerItemId.localeCompare(right.item.layerItemId)
  ))
  return [
    ...sorted.filter((entry) => entry.source === 'global' && entry.globalPlane === 'underlay'),
    ...sorted.filter((entry) => entry.source !== 'global'),
    ...sorted.filter((entry) => entry.source === 'global' && entry.globalPlane === 'overlay'),
  ]
    .map((entry, stackOrder) => ({ ...entry, stackOrder }))
}

/** Valid-location Published adapter; camera and semantic culling stay outside this domain. */
export function composePublishedSpatialLocation(input: {
  readonly input: PublishedSpatialRuntimeInput
  readonly locationId: string
}): CourseLayerComposition<PublishedLayerItem> {
  return composePublishedCourseLocation({
    course: {
      locations: input.input.locations,
      globalLayerItems: input.input.globalLayerItems,
      surfaces: [input.input.surface],
    },
    locationId: input.locationId,
    stateId: null,
  })
}

function worldRectIntersects(
  item: PublishedLayerItem,
  camera: SpatialRuntimeCamera,
  overscanPx = 100,
): boolean {
  const width = camera.viewportWidth / camera.zoom
  const height = camera.viewportHeight / camera.zoom
  const overscan = Math.max(0, overscanPx) / camera.zoom
  const view = {
    x: camera.x - width / 2 - overscan,
    y: camera.y - height / 2 - overscan,
    width: width + overscan * 2,
    height: height + overscan * 2,
  }
  const frame = item.frame
  return (
    frame.x + frame.width >= view.x &&
    view.x + view.width >= frame.x &&
    frame.y + frame.height >= view.y &&
    view.y + view.height >= frame.y
  )
}

export function worldItemVisibleInRuntimeCamera(
  item: PublishedLayerItem,
  camera: SpatialRuntimeCamera,
  rules: readonly SpatialSemanticZoomRule[],
): boolean {
  if (item.playbackInitialVisibility === 'hidden') return false
  return worldItemWithinRuntimeCamera(item, camera, rules)
}

/**
 * Renderer/camera scope without transient Interaction visibility. Playback-hidden
 * nodes must remain mountable in this scope so node.enter can reveal them.
 */
export function worldItemWithinRuntimeCamera(
  item: PublishedLayerItem,
  camera: SpatialRuntimeCamera,
  rules: readonly SpatialSemanticZoomRule[],
): boolean {
  if (!item.visible) return false
  if (!worldRectIntersects(item, camera)) return false
  return isSpatialItemSemanticallyVisible(item.layerItemId, camera.zoom, rules)
}
