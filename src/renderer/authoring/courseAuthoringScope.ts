import { makeAuthoringAddress, type AuthoringCarrier } from '../../shared/authoringAddress'
import type {
  CourseLocation,
  CourseProjectDocument,
  CourseSurfaceDocument,
  CourseSurfaceType,
  LayerItem,
} from '../../shared/courseProjectTypes'

/**
 * Storage owner of a layer item. This is the token NodesTab / Workspace /
 * Properties must share. It is not a persisted `projectMode` and is not a
 * temporary hit-test id.
 *
 * Flow ordinary blocks are not owners here: they stay on the document outline,
 * not the generic z-order adapter.
 */
export type CourseAuthoringOwner = 'global' | 'surface' | 'scene' | 'world'

/** `makeAuthoringAddress` only encodes global / surface / scene. World uses surface. */
export type CourseAuthoringAddressScope = 'global' | 'surface' | 'scene'

/**
 * Current authoring scope. Selecting a global row must set `owner: 'global'`
 * without changing `locationId`. Flow overlay layers and Spatial world items
 * reuse this same token; they do not invent a second scope module.
 *
 * @example
 * const viewing = courseAuthoringScopeFromLocation({
 *   project,
 *   locationId: 'location-scene-1',
 * })
 * // viewing.owner === 'scene'
 *
 * const afterSelectingController = scopeTokenForSelectingRow(viewing, globalRow)
 * // afterSelectingController.owner === 'global'
 * // afterSelectingController.locationId === 'location-scene-1'
 */
export interface CourseAuthoringScopeToken {
  readonly owner: CourseAuthoringOwner
  /** `global` | `surface:{surfaceId}` | `scene:{sceneId}` | `world:{surfaceId}` */
  readonly ownerKey: string
  /** Current course location (page). Scope switches do not rewrite this. */
  readonly locationId: string
  /** Surface of the current location; viewing context for overlay lists. */
  readonly surfaceId: string
  /** Set only while the edited owner is a Slide scene. */
  readonly sceneId: string | null
  /** Named Slide state of the current location; independent of owner. */
  readonly stateId: string | null
}

export function ownerKeyFor(
  owner: CourseAuthoringOwner,
  surfaceId: string,
  sceneId: string | null,
): string {
  if (owner === 'global') return 'global'
  if (owner === 'surface') return `surface:${surfaceId}`
  if (owner === 'world') return `world:${surfaceId}`
  if (!sceneId?.trim()) {
    throw new TypeError('scene owner 需要 sceneId')
  }
  return `scene:${sceneId}`
}

export function defaultOwnerForSurface(type: CourseSurfaceType): CourseAuthoringOwner {
  if (type === 'slide') return 'scene'
  if (type === 'spatial-2d') return 'world'
  return 'surface'
}

export function authoringAddressScopeForOwner(
  owner: CourseAuthoringOwner,
): CourseAuthoringAddressScope {
  if (owner === 'global') return 'global'
  if (owner === 'scene') return 'scene'
  return 'surface'
}

export function carrierForLayerKind(kind: LayerItem['kind']): AuthoringCarrier {
  return kind
}

export function createCourseAuthoringScope(input: {
  readonly owner: CourseAuthoringOwner
  readonly locationId: string
  readonly surfaceId: string
  readonly sceneId?: string | null
  readonly stateId?: string | null
}): CourseAuthoringScopeToken {
  const sceneId = input.owner === 'scene' ? (input.sceneId ?? null) : null
  if (input.owner === 'scene' && !sceneId?.trim()) {
    throw new TypeError('scene owner 需要 sceneId')
  }
  return Object.freeze({
    owner: input.owner,
    ownerKey: ownerKeyFor(input.owner, input.surfaceId, sceneId),
    locationId: input.locationId,
    surfaceId: input.surfaceId,
    sceneId,
    stateId: input.stateId ?? null,
  })
}

export function resolveCourseLocation(
  project: CourseProjectDocument,
  locationId: string,
): {
  location: CourseLocation
  surface: CourseSurfaceDocument
} {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface) throw new Error(`找不到表面：${location.surfaceId}`)
  if (location.kind === 'slide-scene' && surface.type !== 'slide') {
    throw new Error(`Location ${locationId} does not belong to surface ${surface.id}`)
  }
  if (location.kind === 'flow-block' && surface.type !== 'flow') {
    throw new Error(`Location ${locationId} does not belong to surface ${surface.id}`)
  }
  if (location.kind === 'spatial-camera' && surface.type !== 'spatial-2d') {
    throw new Error(`Location ${locationId} does not belong to surface ${surface.id}`)
  }
  return { location, surface }
}

export function courseAuthoringScopeFromLocation(input: {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly owner?: CourseAuthoringOwner
  /** `undefined` follows the location; `null` is the base scene (no named state). */
  readonly stateId?: string | null
}): CourseAuthoringScopeToken {
  const { location, surface } = resolveCourseLocation(input.project, input.locationId)
  const owner = input.owner ?? defaultOwnerForSurface(surface.type)
  const sceneId = location.kind === 'slide-scene' ? location.sceneId : null
  const locationStateId = location.kind === 'slide-scene'
    ? (location.stateId ?? null)
    : null
  const stateId = input.stateId === undefined ? locationStateId : input.stateId
  return createCourseAuthoringScope({
    owner,
    locationId: location.id,
    surfaceId: surface.id,
    sceneId,
    stateId,
  })
}

/**
 * Selecting a layer row switches owner to that row's storage owner and keeps
 * the current location / named state. Canvas, NodesTab and PropertiesTab must
 * all consume this token so they point at the same owner.
 */
export function scopeTokenForSelectingRow(
  current: CourseAuthoringScopeToken,
  row: {
    readonly scopeToken: CourseAuthoringScopeToken
  },
): CourseAuthoringScopeToken {
  return createCourseAuthoringScope({
    owner: row.scopeToken.owner,
    locationId: current.locationId,
    surfaceId: current.surfaceId,
    sceneId: row.scopeToken.sceneId,
    stateId: current.stateId,
  })
}

/**
 * Stable identity shared by canvas hit, the layer row and the property panel.
 * Field defaults to `item`; callers may pass a more specific field but must
 * never persist a temporary `hitId`.
 */
export function makeLayerItemAuthoringAddress(input: {
  readonly projectId: string
  readonly owner: CourseAuthoringOwner
  readonly surfaceId: string
  readonly sceneId: string | null
  readonly kind: LayerItem['kind']
  readonly layerItemId: string
  readonly field?: string
}): string {
  const scope = authoringAddressScopeForOwner(input.owner)
  return makeAuthoringAddress({
    projectId: input.projectId,
    scope,
    surfaceId: scope === 'global' ? undefined : input.surfaceId,
    sceneId: scope === 'scene' ? input.sceneId ?? undefined : undefined,
    carrier: carrierForLayerKind(input.kind),
    layerItemId: input.layerItemId,
    field: input.field ?? 'item',
  })
}
