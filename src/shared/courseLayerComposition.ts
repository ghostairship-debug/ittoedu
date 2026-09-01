import { mergeCourseNativeData } from './courseProjectSchema'
import type {
  CourseLocation,
  CourseProjectDocument,
  CourseSurfaceType,
  FlowBodyLayerPlane,
  GlobalLayerPlane,
  LayerItem,
  LayerItemOverride,
  SlidePresentationState,
} from './courseProjectTypes'
import type {
  PublishedCourseSurface,
  PublishedCourseV2Payload,
  PublishedGlobalLayerEntry,
  PublishedLayerItem,
  PublishedScopedLayerItem,
  PublishedSlidePresentationState,
} from './publishedCourseTypes'
import { compareStableStrings } from './stableOrder'

export type CourseLayerCompositionSource = 'global' | 'surface' | 'scene' | 'world'

export interface CourseLayerCompositionEntry<Item> {
  readonly source: CourseLayerCompositionSource
  /** The item exists in its canonical global/surface/scene/world storage owner. */
  readonly stored: true
  /** Global/surface location membership applies; scene/world items always apply. */
  readonly applicable: boolean
  /** Hard render boundary: applicable and the materialized `item.visible` is true. */
  readonly mounted: boolean
  /** Initial playback visibility after the mount boundary. */
  readonly initiallyVisible: boolean
  /** Resolved persisted/legacy global plane; non-global entries carry `null`. */
  readonly globalPlane: GlobalLayerPlane | null
  /** Flow surface plane around semantic body; all other entries carry `null`. */
  readonly flowBodyPlane: FlowBodyLayerPlane | null
  /**
   * Dense back-to-front paint slot for the current composition. This is a
   * read-model fact only: renderers must not write it back to `item.order`.
   *
   * Effective global Underlay entries paint first, active surface/scene/world
   * content paints next, and effective global Overlay entries paint last.
   * Entries keep their authored order inside each group.
   */
  readonly stackOrder: number
  /** A detached, fully materialized item. Slide named-state overrides are applied. */
  readonly item: Item
}

export interface CourseLayerCompositionBackground {
  readonly color: string
  readonly assetId: string | null | undefined
}

export interface CourseLayerComposition<Item> {
  readonly locationId: string
  readonly surfaceId: string
  readonly surfaceType: CourseSurfaceType
  readonly sceneId: string | null
  /** Exact caller-selected state. `null` is the base scene. */
  readonly stateId: string | null
  readonly background: CourseLayerCompositionBackground | null
  /** Stable back-to-front paint order; each entry retains its authored item order. */
  readonly entries: readonly CourseLayerCompositionEntry<Item>[]
}

export interface ComposeCourseProjectLocationInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  /** Required and exact. The shared domain never follows a location or initial state. */
  readonly stateId: string | null
}

export interface PublishedCourseCompositionSource {
  readonly locations: readonly CourseLocation[]
  readonly globalLayerItems: readonly PublishedGlobalLayerEntry[]
  readonly surfaces: readonly PublishedCourseSurface[]
}

export interface ComposePublishedCourseLocationInput {
  readonly course: PublishedCourseCompositionSource | PublishedCourseV2Payload
  readonly locationId: string
  /** Required and exact. Published navigation resolves initial state before calling. */
  readonly stateId: string | null
}

type ComposableLayerItem = LayerItem | PublishedLayerItem
type ComposableState = SlidePresentationState | PublishedSlidePresentationState
type UnstackedCompositionEntry<Item> = Omit<
  CourseLayerCompositionEntry<Item>,
  'stackOrder'
>
type ComposableScopedLayerItem<Item extends ComposableLayerItem> = {
  readonly item: Item
  readonly bodyPlane?: FlowBodyLayerPlane
  readonly visibility: {
    readonly mode: 'all' | 'include' | 'exclude'
    readonly locationIds: readonly string[]
  }
}
type ComposableGlobalLayerItem<Item extends ComposableLayerItem> =
  ComposableScopedLayerItem<Item> & {
    readonly plane?: GlobalLayerPlane
  }

type ComposableSurface<Item extends ComposableLayerItem> =
  | {
      readonly id: string
      readonly type: 'slide'
      readonly surfaceLayerItems: readonly ComposableScopedLayerItem<Item>[]
      readonly scenes: readonly {
        readonly id: string
        readonly backgroundColor: string
        readonly backgroundAssetId?: string | null
        readonly layerItems: readonly Item[]
        readonly presentation?: {
          readonly states: readonly ComposableState[]
        }
      }[]
    }
  | {
      readonly id: string
      readonly type: 'flow'
      readonly surfaceLayerItems: readonly ComposableScopedLayerItem<Item>[]
    }
  | {
      readonly id: string
      readonly type: 'spatial-2d'
      readonly surfaceLayerItems: readonly ComposableScopedLayerItem<Item>[]
      readonly world: { readonly layerItems: readonly Item[] }
    }

interface CompositionDocument<Item extends ComposableLayerItem> {
  readonly locations: readonly CourseLocation[]
  readonly globalLayerItems: readonly ComposableGlobalLayerItem<Item>[]
  readonly surfaces: readonly ComposableSurface<Item>[]
}

function mergePlainRecords(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key]
    result[key] = value !== null && previous !== null &&
      typeof value === 'object' && typeof previous === 'object' &&
      !Array.isArray(value) && !Array.isArray(previous)
      ? mergePlainRecords(
          previous as Record<string, unknown>,
          value as Record<string, unknown>,
        )
      : structuredClone(value)
  }
  return result
}

/** Shared Slide override semantics for authoring V9 and raw Published V2 items. */
export function applyCourseLayerItemOverride<Item extends ComposableLayerItem>(
  source: Item,
  override: LayerItemOverride | undefined,
): Item {
  const item = structuredClone(source)
  if (!override) return item
  if (override.label !== undefined && 'label' in item) item.label = override.label
  if (override.frame) item.frame = { ...item.frame, ...override.frame, mode: 'absolute' }
  if (override.order !== undefined) item.order = override.order
  if (override.visible !== undefined) item.visible = override.visible
  if (override.locked !== undefined && 'locked' in item) item.locked = override.locked
  if (override.rotation !== undefined) item.rotation = override.rotation
  if (override.opacity !== undefined) item.opacity = override.opacity
  if (override.hitPolicy !== undefined) item.hitPolicy = override.hitPolicy
  if (override.playbackInitialVisibility !== undefined) {
    item.playbackInitialVisibility = override.playbackInitialVisibility
  }
  if (item.kind === 'native' && override.nativeData) {
    item.content.data = mergeCourseNativeData(
      item.content.data as Record<string, unknown>,
      override.nativeData,
    ) as typeof item.content.data
  }
  if (item.kind === 'component' && override.componentProps) {
    item.props = mergePlainRecords(item.props, override.componentProps)
  }
  return item
}

/** Applies overrides and the existing state order-slot semantics without mutating storage. */
export function materializeCourseSlideLayerItems<Item extends ComposableLayerItem>(
  items: readonly Item[],
  state: ComposableState | undefined,
): Item[] {
  const materialized = items.map((item) => (
    applyCourseLayerItemOverride(item, state?.layerItemOverrides[item.layerItemId])
  ))
  if (state?.layerItemOrder) {
    const byId = new Map(materialized.map((item) => [item.layerItemId, item]))
    const seen = new Set<string>()
    const ordered: Item[] = []
    for (const id of state.layerItemOrder) {
      const item = byId.get(id)
      if (!item || seen.has(id)) continue
      seen.add(id)
      ordered.push(item)
    }
    ordered.push(...materialized
      .filter((item) => !seen.has(item.layerItemId))
      .sort(compareCourseLayerItems))
    const orderSlots = materialized.map((item) => item.order).sort((left, right) => left - right)
    ordered.forEach((item, index) => {
      item.order = orderSlots[index]!
    })
  }
  return materialized.sort(compareCourseLayerItems)
}

/** The single deterministic back-to-front ordering primitive for all composition stages. */
export function compareCourseLayerItems<Item extends { layerItemId: string; order: number }>(
  left: Item,
  right: Item,
): number {
  return left.order - right.order || compareStableStrings(left.layerItemId, right.layerItemId)
}

function scopedApplies(
  entry: ComposableScopedLayerItem<ComposableLayerItem>,
  locationId: string,
): boolean {
  if (entry.visibility.mode === 'all') return true
  const listed = entry.visibility.locationIds.includes(locationId)
  return entry.visibility.mode === 'include' ? listed : !listed
}

function resolveExactState(
  states: readonly ComposableState[] | undefined,
  stateId: string | null,
): ComposableState | undefined {
  if (stateId === null) return undefined
  const state = states?.find((candidate) => candidate.id === stateId)
  if (!state) throw new Error(`Unknown Slide state: ${stateId}`)
  return state
}

function isComposableTeacherController(item: ComposableLayerItem): boolean {
  return item.kind === 'native' && item.content.nativeType === 'teacher-controller'
}

/**
 * Resolves the additive global plane contract without consulting local content.
 * Explicit planes win. A legacy controller is always Overlay and acts as the
 * old global-only boundary; legacy projects without one resolve to Overlay.
 */
export function resolveEffectiveGlobalLayerPlanes<Item extends ComposableLayerItem>(
  entries: readonly ComposableGlobalLayerItem<Item>[],
): ReadonlyMap<string, GlobalLayerPlane> {
  const sorted = [...entries]
    .sort((left, right) => compareCourseLayerItems(left.item, right.item))
  const controller = sorted.find((candidate) => isComposableTeacherController(candidate.item))
  const result = new Map<string, GlobalLayerPlane>()
  for (const entry of sorted) {
    const plane = isComposableTeacherController(entry.item)
      ? 'overlay'
      : entry.plane ?? (controller && compareCourseLayerItems(entry.item, controller.item) < 0
        ? 'underlay'
        : 'overlay')
    result.set(entry.item.layerItemId, plane)
  }
  return result
}

function assignCompositionStackOrder<Item extends ComposableLayerItem>(
  entries: readonly UnstackedCompositionEntry<Item>[],
): CourseLayerCompositionEntry<Item>[] {
  const byAuthoredOrder = (left: UnstackedCompositionEntry<Item>, right: UnstackedCompositionEntry<Item>) => (
    compareCourseLayerItems(left.item, right.item)
  )
  const sorted = [...entries].sort(byAuthoredOrder)
  const ordered = [
    ...sorted.filter((entry) => entry.source === 'global' && entry.globalPlane === 'underlay'),
    ...sorted.filter((entry) => entry.source === 'surface' && entry.flowBodyPlane === 'underlay'),
    ...sorted.filter((entry) => entry.source !== 'global' && entry.flowBodyPlane !== 'underlay'),
    ...sorted.filter((entry) => entry.source === 'global' && entry.globalPlane === 'overlay'),
  ]
  return ordered.map((entry, stackOrder) => ({ ...entry, stackOrder }))
}

function composeLocation<Item extends ComposableLayerItem>(input: {
  readonly document: CompositionDocument<Item>
  readonly locationId: string
  readonly stateId: string | null
}): CourseLayerComposition<Item> {
  const location = input.document.locations.find((candidate) => candidate.id === input.locationId)
  if (!location) throw new Error(`Unknown course location: ${input.locationId}`)
  const surface = input.document.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface) throw new Error(`Unknown course surface: ${location.surfaceId}`)

  let sceneId: string | null = null
  let background: CourseLayerCompositionBackground | null = null
  let localItems: readonly Item[] = []
  let localSource: Extract<CourseLayerCompositionSource, 'scene' | 'world'> | null = null

  if (surface.type === 'slide') {
    if (location.kind !== 'slide-scene') {
      throw new Error(`Location ${location.id} is not a Slide scene location`)
    }
    const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
    if (!scene) throw new Error(`Unknown Slide scene: ${location.sceneId}`)
    const state = resolveExactState(scene.presentation?.states, input.stateId)
    sceneId = scene.id
    localSource = 'scene'
    localItems = materializeCourseSlideLayerItems(scene.layerItems, state)
    background = {
      color: state?.backgroundColor ?? scene.backgroundColor,
      assetId: state?.backgroundAssetId === undefined
        ? scene.backgroundAssetId
        : state.backgroundAssetId,
    }
  } else if (surface.type === 'flow') {
    if (location.kind !== 'flow-block') {
      throw new Error(`Location ${location.id} is not a Flow block location`)
    }
    if (input.stateId !== null) throw new Error('Flow composition requires stateId null')
  } else {
    if (location.kind !== 'spatial-camera') {
      throw new Error(`Location ${location.id} is not a Spatial camera location`)
    }
    if (input.stateId !== null) throw new Error('Spatial composition requires stateId null')
    localSource = 'world'
    localItems = surface.world.layerItems.map((item) => structuredClone(item))
  }

  const entries: UnstackedCompositionEntry<Item>[] = []
  const push = (
    item: Item,
    source: CourseLayerCompositionSource,
    applicable: boolean,
    globalPlane: GlobalLayerPlane | null = null,
    flowBodyPlane: FlowBodyLayerPlane | null = null,
  ): void => {
    const mounted = applicable && item.visible
    entries.push({
      source,
      stored: true,
      applicable,
      mounted,
      initiallyVisible: mounted && item.playbackInitialVisibility !== 'hidden',
      globalPlane,
      flowBodyPlane,
      item,
    })
  }
  const effectiveGlobalPlanes = resolveEffectiveGlobalLayerPlanes(input.document.globalLayerItems)
  for (const entry of input.document.globalLayerItems) {
    const globalPlane = effectiveGlobalPlanes.get(entry.item.layerItemId)
    if (!globalPlane) throw new Error(`Missing effective global plane: ${entry.item.layerItemId}`)
    push(
      structuredClone(entry.item),
      'global',
      scopedApplies(entry, location.id),
      globalPlane,
    )
  }
  for (const entry of surface.surfaceLayerItems) {
    push(
      structuredClone(entry.item),
      'surface',
      scopedApplies(entry, location.id),
      null,
      surface.type === 'flow' ? (entry.bodyPlane ?? 'overlay') : null,
    )
  }
  if (localSource) {
    for (const item of localItems) push(item, localSource, true)
  }
  const stackedEntries = assignCompositionStackOrder(entries)

  return {
    locationId: location.id,
    surfaceId: surface.id,
    surfaceType: surface.type,
    sceneId,
    stateId: input.stateId,
    background,
    entries: stackedEntries,
  }
}

/** Canonical schema-valid Course Project V9 location composition. */
export function composeCourseProjectLocation(
  input: ComposeCourseProjectLocationInput,
): CourseLayerComposition<LayerItem> {
  return composeLocation({
    document: input.project as CompositionDocument<LayerItem>,
    locationId: input.locationId,
    stateId: input.stateId,
  })
}

/** Raw Published V2 adapter using exactly the same membership/order/state/visibility rule. */
export function composePublishedCourseLocation(
  input: ComposePublishedCourseLocationInput,
): CourseLayerComposition<PublishedLayerItem> {
  return composeLocation({
    document: input.course as CompositionDocument<PublishedLayerItem>,
    locationId: input.locationId,
    stateId: input.stateId,
  })
}
