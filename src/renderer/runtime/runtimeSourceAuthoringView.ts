import {
  captureCourseAuthoringTarget,
  type CourseAuthoringSessionToken,
  type CourseAuthoringTarget,
} from '@/renderer/authoring/courseAuthoringSession'
import {
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
  type CourseAuthoringOwner,
} from '@/renderer/authoring/courseAuthoringScope'
import type {
  CourseProjectDocument,
  CourseRuntimeDefinition,
  CourseSurfaceDocument,
  RuntimeLayerItem,
  SlidePresentationState,
} from '@/shared/courseProjectTypes'
import {
  captureCourseRuntimeTemplateCreationTarget,
  type CourseRuntimeTemplateCreationTarget,
} from './runtimeTemplateAuthoringCommands'

export const COURSE_RUNTIME_SOURCE_AUTHORING_FIELD = 'runtime/source' as const

export type RuntimeSourceAuthoringCarrier =
  | 'global-layer'
  | 'surface-layer'
  | 'slide-scene'
  | 'spatial-world'

export type RuntimeSourceReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends readonly (infer Item)[] ? readonly RuntimeSourceReadonly<Item>[]
      : T extends object ? { readonly [Key in keyof T]: RuntimeSourceReadonly<T[Key]> }
        : T

export interface SelectRuntimeSourceAuthoringViewInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  /** The existing editor calls every non-global scope `scene`, including Flow and Spatial. */
  readonly editingScope: 'scene' | 'global'
  /** `undefined` follows the persisted Slide location; `null` selects its base state. */
  readonly activeStateId?: string | null
  readonly sessionToken: CourseAuthoringSessionToken
}

export interface AvailableRuntimeSourceAuthoringView {
  readonly availability: 'available'
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly label: string
  /**
   * Exact draft binding. State is deliberately absent because Runtime source is
   * shared by all named states; revision and session generation remain exact.
   */
  readonly documentKey: string
  readonly runtime: RuntimeSourceReadonly<CourseRuntimeDefinition>
  readonly target: CourseAuthoringTarget
  readonly effectiveLocked: boolean
}

export interface UnavailableRuntimeSourceAuthoringView {
  readonly availability: 'unavailable'
  readonly reason:
    | 'invalid-location'
    | 'invalid-session'
    | 'invalid-state'
    | 'runtime-missing'
  readonly label: string
  readonly documentKey: null
  /** Present only for the supported empty Slide scene/global Runtime slot. */
  readonly creationTarget?: CourseRuntimeTemplateCreationTarget | null
}

export type RuntimeSourceAuthoringView =
  | AvailableRuntimeSourceAuthoringView
  | UnavailableRuntimeSourceAuthoringView

interface ResolvedViewCarrier {
  readonly carrier: RuntimeSourceAuthoringCarrier
  readonly owner: CourseAuthoringOwner
  readonly sceneId: string | null
  readonly item: RuntimeLayerItem | undefined
  readonly labelPrefix: string
  readonly presentationState: SlidePresentationState | null
}

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
    || Object.isFrozen(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function unavailable(
  reason: UnavailableRuntimeSourceAuthoringView['reason'],
  label: string,
  creationTarget: CourseRuntimeTemplateCreationTarget | null = null,
): UnavailableRuntimeSourceAuthoringView {
  return Object.freeze({
    availability: 'unavailable' as const,
    reason,
    label,
    documentKey: null,
    creationTarget,
  })
}

function firstRuntime(
  items: ReadonlyArray<CourseProjectDocument['globalLayerItems'][number]['item']>,
): RuntimeLayerItem | undefined {
  const item = items.find((candidate) => candidate.kind === 'runtime')
  return item?.kind === 'runtime' ? item : undefined
}

function surfaceAtLocation(
  project: CourseProjectDocument,
  locationId: string,
): {
  readonly location: CourseProjectDocument['locations'][number]
  readonly surface: CourseSurfaceDocument
} | null {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) return null
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface) return null
  const kindMatches =
    (location.kind === 'slide-scene' && surface.type === 'slide')
    || (location.kind === 'flow-block' && surface.type === 'flow')
    || (location.kind === 'spatial-camera' && surface.type === 'spatial-2d')
  return kindMatches ? { location, surface } : null
}

function resolveState(
  input: SelectRuntimeSourceAuthoringViewInput,
  resolved: NonNullable<ReturnType<typeof surfaceAtLocation>>,
): {
  readonly ok: true
  readonly stateId: string | null
  readonly presentationState: SlidePresentationState | null
} | { readonly ok: false } {
  if (resolved.location.kind !== 'slide-scene' || resolved.surface.type !== 'slide') {
    return input.activeStateId == null
      ? { ok: true, stateId: null, presentationState: null }
      : { ok: false }
  }
  const stateId = input.activeStateId === undefined
    ? resolved.location.stateId ?? null
    : input.activeStateId
  if (stateId === null) {
    return { ok: true, stateId, presentationState: null }
  }
  const sceneId = resolved.location.sceneId
  const scene = resolved.surface.scenes.find(
    (candidate) => candidate.id === sceneId,
  )
  const presentationState = scene?.presentation?.states.find(
    (candidate) => candidate.id === stateId,
  ) ?? null
  return presentationState
    ? { ok: true, stateId, presentationState }
    : { ok: false }
}

function resolveCarrier(
  input: SelectRuntimeSourceAuthoringViewInput,
  resolved: NonNullable<ReturnType<typeof surfaceAtLocation>>,
  presentationState: SlidePresentationState | null,
): ResolvedViewCarrier | null {
  const { location, surface } = resolved
  if (input.editingScope === 'global') {
    return {
      carrier: 'global-layer',
      owner: 'global',
      sceneId: null,
      item: firstRuntime(input.project.globalLayerItems.map((entry) => entry.item)),
      labelPrefix: '全局 Runtime',
      presentationState: null,
    }
  }
  if (location.kind === 'slide-scene' && surface.type === 'slide') {
    const sceneId = location.sceneId
    const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
    if (!scene) return null
    return {
      carrier: 'slide-scene',
      owner: 'scene',
      sceneId: scene.id,
      item: firstRuntime(scene.layerItems),
      labelPrefix: `场景 · ${scene.name}`,
      presentationState,
    }
  }
  if (location.kind === 'flow-block' && surface.type === 'flow') {
    return {
      carrier: 'surface-layer',
      owner: 'surface',
      sceneId: null,
      item: firstRuntime(surface.surfaceLayerItems.map((entry) => entry.item)),
      labelPrefix: `Flow · ${surface.title}`,
      presentationState: null,
    }
  }
  if (location.kind === 'spatial-camera' && surface.type === 'spatial-2d') {
    return {
      carrier: 'spatial-world',
      owner: 'world',
      sceneId: null,
      item: firstRuntime(surface.world.layerItems),
      labelPrefix: `Spatial · ${surface.title}`,
      presentationState: null,
    }
  }
  return null
}

function documentKey(target: CourseAuthoringTarget): string {
  return JSON.stringify([
    'runtime-source',
    target.projectId,
    target.documentRevision,
    target.sessionGeneration,
    target.surfaceType,
    target.surfaceId,
    target.locationId,
    target.owner,
    target.ownerKey,
    target.itemId,
    target.authoringAddress,
  ])
}

/**
 * Selects the first canonical V9 Runtime in the current Developer scope.
 * Flow blocks and V8 scene projections are never presented as writable Runtime
 * carriers.
 */
export function selectRuntimeSourceAuthoringView(
  input: SelectRuntimeSourceAuthoringViewInput,
): RuntimeSourceAuthoringView {
  const resolved = surfaceAtLocation(input.project, input.locationId)
  if (!resolved) {
    return unavailable('invalid-location', '当前课程位置无效')
  }
  if (
    input.sessionToken.locationId !== input.locationId
    || input.sessionToken.surfaceType !== resolved.surface.type
    || input.sessionToken.revision !== input.project.revision
  ) {
    return unavailable('invalid-session', 'Runtime 编辑会话已失效')
  }
  const state = resolveState(input, resolved)
  if (!state.ok) {
    return unavailable('invalid-state', '当前呈现状态无效')
  }
  const carrier = resolveCarrier(input, resolved, state.presentationState)
  if (!carrier) {
    return unavailable('invalid-location', '当前课程位置没有有效的 Runtime carrier')
  }
  if (!carrier.item) {
    const creationTarget = (
      resolved.location.kind === 'slide-scene'
      && resolved.surface.type === 'slide'
      && (carrier.owner === 'scene' || carrier.owner === 'global')
    )
      ? captureCourseRuntimeTemplateCreationTarget({
          sessionToken: input.sessionToken,
          projectId: input.project.id,
          surfaceId: resolved.surface.id,
          stateId: state.stateId,
          owner: carrier.owner,
          sceneId: carrier.owner === 'scene' ? carrier.sceneId : null,
        })
      : null
    return unavailable(
      'runtime-missing',
      `${carrier.labelPrefix} 尚未创建 Runtime`,
      creationTarget,
    )
  }

  const ownerKey = ownerKeyFor(
    carrier.owner,
    resolved.surface.id,
    carrier.sceneId,
  )
  const authoringAddress = makeLayerItemAuthoringAddress({
    projectId: input.project.id,
    owner: carrier.owner,
    surfaceId: resolved.surface.id,
    sceneId: carrier.sceneId,
    kind: 'runtime',
    layerItemId: carrier.item.layerItemId,
    field: COURSE_RUNTIME_SOURCE_AUTHORING_FIELD,
  })
  const target = captureCourseAuthoringTarget({
    sessionToken: input.sessionToken,
    projectId: input.project.id,
    surfaceId: resolved.surface.id,
    stateId: resolved.surface.type === 'slide' ? state.stateId : null,
    owner: carrier.owner,
    ownerKey,
    itemId: carrier.item.layerItemId,
    authoringAddress,
  })
  const effectiveLocked = carrier.presentationState?.layerItemOverrides[
    carrier.item.layerItemId
  ]?.locked ?? carrier.item.locked

  return deepFreeze({
    availability: 'available' as const,
    carrier: carrier.carrier,
    label: `${carrier.labelPrefix} · ${carrier.item.label}`,
    documentKey: documentKey(target),
    runtime: structuredClone(carrier.item.runtime),
    target,
    effectiveLocked,
  })
}
