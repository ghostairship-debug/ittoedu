import { MAX_SCENE_INTERACTIONS, type InteractionRule } from '@/shared/interactionTypes'
import {
  buildSlideEditorView,
  type DeepReadonly,
} from '@/renderer/course/slideEditorView'
import type {
  CourseProjectDocument,
  CourseSurfaceType,
  LayerItem,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '@/shared/courseProjectTypes'
import type { SoundDefinition } from '@/shared/contracts/media-v1'

export interface InteractionAuthoringNodeOption {
  readonly id: string
  readonly label: string
  readonly kind: LayerItem['kind']
  readonly nativeType: string | null
  readonly owner: 'scene' | 'global'
  readonly locked: boolean
  readonly visible: boolean
  readonly playbackInitialVisibility: 'inherit' | 'hidden'
}

export interface InteractionAuthoringSceneReference {
  readonly id: string
  readonly name: string
  readonly surfaceId: string
}

export interface InteractionAuthoringStateOption {
  readonly id: string
  readonly name: string
}

export interface InteractionAuthoringSoundOption {
  readonly id: string
  readonly name: string
  readonly channel: SoundDefinition['channel']
}

export interface InteractionAuthoringRuleCapacity {
  readonly used: number
  readonly limit: typeof MAX_SCENE_INTERACTIONS
}

interface InteractionAuthoringViewShared {
  readonly projectId: string
  readonly revision: number
  /** Interaction V1 scene references remain Slide scene IDs. */
  readonly sceneReferences: readonly InteractionAuthoringSceneReference[]
  readonly sounds: readonly InteractionAuthoringSoundOption[]
}

export interface AvailableLocalInteractionAuthoringView
  extends InteractionAuthoringViewShared {
  readonly availability: 'available'
  readonly carrier: 'slide-scene'
  readonly locationId: string
  readonly surfaceId: string
  readonly sceneId: string
  readonly sceneName: string
  readonly activeStateId: string | null
  readonly states: readonly InteractionAuthoringStateOption[]
  readonly nodes: readonly InteractionAuthoringNodeOption[]
  readonly rules: readonly InteractionRule[]
  readonly ruleCapacity: InteractionAuthoringRuleCapacity
}

export interface UnavailableLocalInteractionAuthoringView
  extends InteractionAuthoringViewShared {
  readonly availability: 'unavailable'
  readonly reason: 'no-local-interaction-carrier' | 'invalid-location'
  readonly locationId: string
  readonly surfaceId: string | null
  readonly surfaceType: Extract<CourseSurfaceType, 'flow' | 'spatial-2d'> | null
}

export type LocalInteractionAuthoringView =
  | AvailableLocalInteractionAuthoringView
  | UnavailableLocalInteractionAuthoringView

export interface GlobalInteractionAuthoringView
  extends InteractionAuthoringViewShared {
  readonly availability: 'available'
  readonly carrier: 'global'
  readonly activeLocationId: string | null
  readonly activeSurfaceType: CourseSurfaceType | null
  /** Null on Flow/Spatial: their locations are never relabelled as scenes. */
  readonly activeSlideSceneId: string | null
  readonly activeStateId: string | null
  readonly states: readonly InteractionAuthoringStateOption[]
  readonly nodes: readonly InteractionAuthoringNodeOption[]
  readonly rules: readonly InteractionRule[]
  readonly ruleCapacity: InteractionAuthoringRuleCapacity
}

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || ArrayBuffer.isView(value)
  ) {
    return value
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested)
  }
  return Object.freeze(value)
}

function nodeOption(
  item: DeepReadonly<LayerItem>,
  owner: InteractionAuthoringNodeOption['owner'],
): InteractionAuthoringNodeOption {
  return Object.freeze({
    id: item.layerItemId,
    label: item.label,
    kind: item.kind,
    nativeType: item.kind === 'native' ? item.content.nativeType : null,
    owner,
    locked: item.locked,
    visible: item.visible,
    playbackInitialVisibility: item.playbackInitialVisibility,
  })
}

function statesOf(scene: SlideSceneDocument | null): readonly InteractionAuthoringStateOption[] {
  return Object.freeze((scene?.presentation?.states ?? []).map((state) => Object.freeze({
    id: state.id,
    name: state.name,
  })))
}

function slideSceneReferences(
  project: CourseProjectDocument,
): readonly InteractionAuthoringSceneReference[] {
  const references: InteractionAuthoringSceneReference[] = []
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      references.push(Object.freeze({
        id: scene.id,
        name: scene.name,
        surfaceId: surface.id,
      }))
    }
  }
  return Object.freeze(references)
}

function soundOptions(
  project: CourseProjectDocument,
): readonly InteractionAuthoringSoundOption[] {
  return Object.freeze(
    Object.values(project.media.audio.sounds)
      .map((sound) => Object.freeze({
        id: sound.id,
        name: sound.name,
        channel: sound.channel,
      }))
      .sort((left, right) => (
        left.name.localeCompare(right.name, 'zh-CN')
        || left.id.localeCompare(right.id)
      )),
  )
}

function sharedView(project: CourseProjectDocument): InteractionAuthoringViewShared {
  return {
    projectId: project.id,
    revision: project.revision,
    sceneReferences: slideSceneReferences(project),
    sounds: soundOptions(project),
  }
}

function capacity(rules: readonly InteractionRule[]): InteractionAuthoringRuleCapacity {
  return Object.freeze({ used: rules.length, limit: MAX_SCENE_INTERACTIONS })
}

function slideSceneAtLocation(
  project: CourseProjectDocument,
  locationId: string,
): {
  location: Extract<CourseProjectDocument['locations'][number], { kind: 'slide-scene' }>
  surface: SlideSurfaceDocument
  scene: SlideSceneDocument
} | null {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'slide-scene') return null
  const surface = project.surfaces.find(
    (candidate): candidate is SlideSurfaceDocument => (
      candidate.id === location.surfaceId && candidate.type === 'slide'
    ),
  )
  const scene = surface?.scenes.find((candidate) => candidate.id === location.sceneId)
  return surface && scene ? { location, surface, scene } : null
}

/**
 * Selects the honest local Interaction carrier. Flow and Spatial deliberately
 * return an unavailable discriminant instead of an empty writable V8 scene.
 */
export function selectLocalInteractionAuthoringView(
  project: CourseProjectDocument,
  locationId: string,
  activeStateId?: string | null,
): LocalInteractionAuthoringView {
  const shared = sharedView(project)
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) {
    return deepFreeze({
      ...shared,
      availability: 'unavailable' as const,
      reason: 'invalid-location' as const,
      locationId,
      surfaceId: null,
      surfaceType: null,
    })
  }
  if (location.kind !== 'slide-scene') {
    const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
    const surfaceType = surface?.type === 'flow' || surface?.type === 'spatial-2d'
      ? surface.type
      : null
    return deepFreeze({
      ...shared,
      availability: 'unavailable' as const,
      reason: surfaceType ? 'no-local-interaction-carrier' as const : 'invalid-location' as const,
      locationId,
      surfaceId: location.surfaceId,
      surfaceType,
    })
  }
  const resolved = slideSceneAtLocation(project, locationId)
  if (!resolved) {
    return deepFreeze({
      ...shared,
      availability: 'unavailable' as const,
      reason: 'invalid-location' as const,
      locationId,
      surfaceId: location.surfaceId,
      surfaceType: null,
    })
  }
  const { surface, scene } = resolved
  const resolvedStateId = activeStateId === undefined
    ? resolved.location.stateId ?? null
    : activeStateId
  if (
    resolvedStateId !== null
    && !scene.presentation?.states.some((state) => state.id === resolvedStateId)
  ) {
    return deepFreeze({
      ...shared,
      availability: 'unavailable' as const,
      reason: 'invalid-location' as const,
      locationId,
      surfaceId: location.surfaceId,
      surfaceType: null,
    })
  }
  const effectiveSceneItems = buildSlideEditorView({
    project,
    locationId,
    stateId: resolvedStateId,
  })
    .layers
    .filter((layer) => layer.source === 'scene')
    .map((layer) => layer.item)
  const rules = structuredClone(scene.interactions)
  return deepFreeze({
    ...shared,
    availability: 'available' as const,
    carrier: 'slide-scene' as const,
    locationId,
    surfaceId: surface.id,
    sceneId: scene.id,
    sceneName: scene.name,
    activeStateId: resolvedStateId,
    states: statesOf(scene),
    nodes: effectiveSceneItems.map((item) => nodeOption(item, 'scene')),
    rules,
    ruleCapacity: capacity(rules),
  })
}

/** Project-global rules are writable from every Surface through one V9 carrier. */
export function selectGlobalInteractionAuthoringView(
  project: CourseProjectDocument,
  activeLocationId: string | null = null,
  activeStateId?: string | null,
): GlobalInteractionAuthoringView {
  const location = activeLocationId
    ? project.locations.find((candidate) => candidate.id === activeLocationId)
    : undefined
  const surface = location
    ? project.surfaces.find((candidate) => candidate.id === location.surfaceId)
    : undefined
  const resolvedSlide = activeLocationId
    ? slideSceneAtLocation(project, activeLocationId)
    : null
  const requestedStateId = resolvedSlide
    ? activeStateId === undefined
      ? resolvedSlide.location.stateId ?? null
      : activeStateId
    : null
  const resolvedStateId = requestedStateId !== null
    && resolvedSlide?.scene.presentation?.states.some(
      (state) => state.id === requestedStateId,
    )
    ? requestedStateId
    : null
  const rules = structuredClone(project.globalInteractions)
  return deepFreeze({
    ...sharedView(project),
    availability: 'available' as const,
    carrier: 'global' as const,
    activeLocationId: location?.id ?? null,
    activeSurfaceType: surface?.type ?? null,
    activeSlideSceneId: resolvedSlide?.scene.id ?? null,
    activeStateId: resolvedStateId,
    states: statesOf(resolvedSlide?.scene ?? null),
    nodes: project.globalLayerItems.map((entry) => nodeOption(entry.item, 'global')),
    rules,
    ruleCapacity: capacity(rules),
  })
}
