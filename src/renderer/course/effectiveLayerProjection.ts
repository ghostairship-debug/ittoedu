import {
  composeCourseProjectLocation,
  type CourseLayerComposition,
} from '../../shared/courseLayerComposition'
import type {
  CourseProjectDocument,
  CourseSurfaceType,
  FlowBlock,
  GlobalLayerPlane,
  LayerItem,
  LocationVisibility,
  NativeLayerItem,
  ScopedLayerItem,
  SlidePresentationState,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  createCourseAuthoringScope,
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
  resolveCourseLocation,
  scopeTokenForSelectingRow,
  type CourseAuthoringOwner,
  type CourseAuthoringScopeToken,
} from '../authoring/courseAuthoringScope'

export type {
  CourseAuthoringAddressScope,
  CourseAuthoringOwner,
  CourseAuthoringScopeToken,
} from '../authoring/courseAuthoringScope'

export {
  authoringAddressScopeForOwner,
  carrierForLayerKind,
  courseAuthoringScopeFromLocation,
  createCourseAuthoringScope,
  defaultOwnerForSurface,
  makeLayerItemAuthoringAddress,
  ownerKeyFor,
  scopeTokenForSelectingRow,
} from '../authoring/courseAuthoringScope'

/** Display source on a layer row. `state` is scene storage with a named-state override applied. */
export type EffectiveLayerSource = 'global' | 'surface' | 'scene' | 'state' | 'world'

export type EffectiveLayerListKind = 'unified' | 'scene-only'

export const EFFECTIVE_LAYER_SOURCE_LABELS: Readonly<Record<EffectiveLayerSource, string>> = {
  global: '全课',
  surface: '当前内容',
  scene: '本页',
  state: '当前状态',
  world: '世界',
}

export const EFFECTIVE_LAYER_LOCKED_WRITE_REASON = '图层已锁定，除解锁外不能修改。'

/**
 * Location impact shown on a unified-layer row.
 * Global / surface rows carry `all | include | exclude + locationIds`.
 * Scene / world rows are local to the current owner and are not location-scoped.
 */
export type EffectiveLayerImpact =
  | {
      readonly kind: 'location'
      readonly mode: LocationVisibility['mode']
      readonly locationIds: readonly string[]
    }
  | {
      readonly kind: 'scene'
      readonly mode: 'owner'
      readonly locationIds: readonly []
    }
  | {
      readonly kind: 'world'
      readonly mode: 'owner'
      readonly locationIds: readonly []
    }

/**
 * Read-only unified layer row. Canvas, NodesTab and PropertiesTab must use
 * `owner` + `id` + `authoringAddress` as the same identity. No `hitId`.
 *
 * R3-Z passes `commandTargetFromRow(row)` into R3-A commands
 * (`globalLayerCommands` / `effectiveLayerCommands`). This module does not
 * mutate the document.
 */
export interface EffectiveLayerProjectionRow {
  readonly id: string
  readonly name: string
  readonly source: EffectiveLayerSource
  readonly sourceLabel: string
  readonly owner: CourseAuthoringOwner
  readonly ownerKey: string
  /** Global plane is part of the reorder boundary, not the storage owner identity. */
  readonly reorderGroupKey: string
  readonly authoringAddress: string
  readonly scopeToken: CourseAuthoringScopeToken
  readonly kind: LayerItem['kind']
  readonly isTeacherController: boolean
  readonly locked: boolean
  /** Item-level hide after named-state override. Independent of location impact. */
  readonly hidden: boolean
  readonly visibleAtLocation: boolean
  readonly effectiveVisible: boolean
  readonly selected: boolean
  readonly stateOverrideApplied: boolean
  readonly impact: EffectiveLayerImpact
  /** Effective persisted/legacy global plane; non-global rows carry `null`. */
  readonly globalPlane: GlobalLayerPlane | null
  /** Canonical dense back-to-front slot from the shared composition. */
  readonly stackOrder: number
  readonly item: LayerItem
}

export interface EffectiveLayerProjection {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly surfaceType: CourseSurfaceType
  readonly sceneId: string | null
  readonly stateId: string | null
  readonly scope: CourseAuthoringScopeToken
  /** Back-to-front, including location-hidden global/surface rows. */
  readonly unifiedRows: readonly EffectiveLayerProjectionRow[]
  /**
   * Scene storage only. Global teacher-controller is never rewritten as a
   * scene row here.
   */
  readonly sceneOnlyRows: readonly EffectiveLayerProjectionRow[]
  /**
   * Membership of `getEffectiveCourseLayerOrder` (visible at this location),
   * with named-state overrides applied to scene items.
   */
  readonly compositedRows: readonly EffectiveLayerProjectionRow[]
}

export interface ProjectEffectiveLayersInput {
  readonly project: CourseProjectDocument
  readonly locationId: string
  /** `undefined` follows the location; `null` is the base scene. */
  readonly stateId?: string | null
  readonly selectedIds?: readonly string[]
  /**
   * Viewing owner. Defaults from the location's surface. Selecting a global
   * row should pass `owner: 'global'` after `scopeTokenForSelectingRow`.
   */
  readonly owner?: CourseAuthoringOwner
}

export function isTeacherControllerLayerItem(
  item: LayerItem | undefined,
): item is NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return Boolean(
    item &&
    item.kind === 'native' &&
    item.content.nativeType === 'teacher-controller',
  )
}

export function visualFrontToBackRows(
  rows: readonly EffectiveLayerProjectionRow[],
): EffectiveLayerProjectionRow[] {
  return [...rows].reverse()
}

export function rowsForListKind(
  projection: EffectiveLayerProjection,
  kind: EffectiveLayerListKind,
): readonly EffectiveLayerProjectionRow[] {
  return kind === 'scene-only' ? projection.sceneOnlyRows : projection.unifiedRows
}

/**
 * Identity R3-Z should give R3-A. `authoringAddress` is `makeAuthoringAddress`.
 * Owner/id are explicit so commands do not infer a fake scene owner.
 */
export interface EffectiveLayerCommandTargetInput {
  readonly authoringAddress: string
  readonly owner: CourseAuthoringOwner
  readonly ownerKey: string
  readonly layerItemId: string
  readonly locationId: string
  readonly stateId: string | null
}

export function commandTargetFromRow(
  row: EffectiveLayerProjectionRow,
): EffectiveLayerCommandTargetInput {
  return Object.freeze({
    authoringAddress: row.authoringAddress,
    owner: row.owner,
    ownerKey: row.ownerKey,
    layerItemId: row.id,
    locationId: row.scopeToken.locationId,
    stateId: row.scopeToken.stateId,
  })
}

/**
 * Owner-aware UI input contract for R3-Z → R3-A.
 * This lane only builds the read-only payload; it does not run commands.
 *
 * @example Reorder two rows inside one global plane (NodesTab drag, then
 * reverse visual order back to engine back-to-front ids):
 * ```
 * const input = createEffectiveLayerReorderInput({
 *   unifiedRows: projection.unifiedRows,
 *   fromId: 'global-banner',
 *   toId: 'teacher-controller',
 *   placement: 'after',
 * })
 * // input.owner === 'global'
 * // input.sameReorderGroup === true
 * // input.orderedLayerItemIds is the complete Overlay permutation, back-to-front
 * // R3-Z: reorderGlobalLayerItems(document, target, input.orderedLayerItemIds)
 * ```
 *
 * @example Cross-owner or cross-global-plane drops carry no permutation so
 * R3-A can refuse them without writing:
 * ```
 * createEffectiveLayerReorderInput({
 *   unifiedRows,
 *   fromId: 'teacher-controller',
 *   toId: 'slide-title',
 *   placement: 'before',
 * }).sameOwner === false
 * // R3-A must not pretend the controller became a scene item.
 * ```
 *
 * @example Lock / hide / duplicate / delete:
 * ```
 * createEffectiveLayerItemActionInput(row, 'lock')
 * createEffectiveLayerItemActionInput(row, 'hide')
 * createEffectiveLayerItemActionInput(row, 'duplicate')
 * createEffectiveLayerItemActionInput(row, 'delete')
 * // Named-state scene rows use deleteMode: 'hide-in-state'.
 * // R3-Z forwards commandTargetFromRow(row) + action to R3-A.
 * ```
 */
export interface EffectiveLayerReorderInput {
  readonly action: 'reorder'
  readonly fromId: string
  readonly toId: string
  readonly fromOwner: CourseAuthoringOwner
  readonly toOwner: CourseAuthoringOwner
  readonly fromOwnerKey: string
  readonly toOwnerKey: string
  readonly sameOwner: boolean
  readonly fromReorderGroupKey: string
  readonly toReorderGroupKey: string
  readonly sameReorderGroup: boolean
  readonly placement: 'before' | 'after'
  readonly owner: CourseAuthoringOwner | null
  readonly ownerKey: string | null
  /** Complete reorder-group permutation, back-to-front. Empty across owner/global-plane boundaries. */
  readonly orderedLayerItemIds: readonly string[]
  readonly locationId: string
  readonly stateId: string | null
}

export type EffectiveLayerItemAction =
  | 'lock'
  | 'unlock'
  | 'hide'
  | 'show'
  | 'duplicate'
  | 'delete'

export interface EffectiveLayerItemActionInput {
  readonly action: EffectiveLayerItemAction
  readonly target: EffectiveLayerCommandTargetInput
  readonly deleteMode: 'delete' | 'hide-in-state'
  readonly writeBlockedReason: string | null
}

export function createEffectiveLayerReorderInput(input: {
  readonly unifiedRows: readonly EffectiveLayerProjectionRow[]
  readonly fromId: string
  readonly toId: string
  readonly placement: 'before' | 'after'
}): EffectiveLayerReorderInput {
  const from = requireRow(input.unifiedRows, input.fromId)
  const to = requireRow(input.unifiedRows, input.toId)
  const sameOwner = from.ownerKey === to.ownerKey
  const sameReorderGroup = from.reorderGroupKey === to.reorderGroupKey
  const orderedLayerItemIds = sameReorderGroup
    ? moveOwnerIds(input.unifiedRows, from, to, input.placement)
    : []
  return Object.freeze({
    action: 'reorder' as const,
    fromId: from.id,
    toId: to.id,
    fromOwner: from.owner,
    toOwner: to.owner,
    fromOwnerKey: from.ownerKey,
    toOwnerKey: to.ownerKey,
    sameOwner,
    fromReorderGroupKey: from.reorderGroupKey,
    toReorderGroupKey: to.reorderGroupKey,
    sameReorderGroup,
    placement: input.placement,
    owner: sameReorderGroup ? from.owner : null,
    ownerKey: sameReorderGroup ? from.ownerKey : null,
    orderedLayerItemIds: Object.freeze(orderedLayerItemIds),
    locationId: from.scopeToken.locationId,
    stateId: from.scopeToken.stateId,
  })
}

export function createEffectiveLayerItemActionInput(
  row: EffectiveLayerProjectionRow,
  action: EffectiveLayerItemAction,
): EffectiveLayerItemActionInput {
  const unlocking = action === 'unlock'
  const writeBlockedReason = row.locked && !unlocking
    ? EFFECTIVE_LAYER_LOCKED_WRITE_REASON
    : null
  const deleteMode = row.owner === 'scene' && row.scopeToken.stateId
    ? 'hide-in-state'
    : 'delete'
  return Object.freeze({
    action,
    target: commandTargetFromRow(row),
    deleteMode,
    writeBlockedReason,
  })
}

export function describeLayerImpact(impact: EffectiveLayerImpact): string {
  if (impact.kind === 'scene') return '仅本页'
  if (impact.kind === 'world') return '世界图层'
  if (impact.mode === 'all') return '全部页面'
  if (impact.mode === 'include') return '仅所选页面'
  return '指定页面除外'
}

/**
 * Ordinary Flow blocks are document items. The generic layer adapter must not
 * list them as z-order rows.
 */
export function isFlowDocumentBlockId(
  project: CourseProjectDocument,
  id: string,
): boolean {
  for (const surface of project.surfaces) {
    if (surface.type !== 'flow') continue
    if (collectFlowBlockIds(surface.blocks).has(id)) return true
  }
  return false
}

export function projectEffectiveLayers(
  input: ProjectEffectiveLayersInput,
): EffectiveLayerProjection {
  const { project, locationId } = input
  const { location, surface } = resolveCourseLocation(project, locationId)
  const selected = new Set(input.selectedIds ?? [])
  const locationStateId = location.kind === 'slide-scene' ? (location.stateId ?? null) : null
  const stateId = surface.type === 'slide'
    ? (input.stateId === undefined ? locationStateId : input.stateId)
    : null
  const scene = surface.type === 'slide' && location.kind === 'slide-scene'
    ? surface.scenes.find((candidate) => candidate.id === location.sceneId)
    : undefined
  if (surface.type === 'slide' && location.kind === 'slide-scene' && !scene) {
    throw new Error(`找不到 Slide 场景：${location.sceneId}`)
  }
  const state = resolveNamedState(scene, stateId)
  const viewing = createCourseAuthoringScope({
    owner: input.owner ?? (
      surface.type === 'slide' ? 'scene' : surface.type === 'spatial-2d' ? 'world' : 'surface'
    ),
    locationId,
    surfaceId: surface.id,
    sceneId: scene?.id ?? null,
    stateId,
  })

  const composition = composeEffectiveLayerLocation({ project, locationId, stateId })
  const rows = composition.entries.map((entry) => {
    const scoped = entry.source === 'global'
      ? project.globalLayerItems.find((candidate) => candidate.item.layerItemId === entry.item.layerItemId)
      : entry.source === 'surface'
        ? surface.surfaceLayerItems.find((candidate) => candidate.item.layerItemId === entry.item.layerItemId)
        : undefined
    return toRow({
      project,
      viewing,
      item: entry.item,
      owner: entry.source,
      scoped,
      state,
      selected: selected.has(entry.item.layerItemId),
      locationId,
      sceneId: scene?.id ?? null,
      visibleAtLocation: entry.applicable,
      globalPlane: entry.globalPlane,
      stackOrder: entry.stackOrder,
    })
  })

  const compositedIds = new Set(composition.entries
    .filter((entry) => entry.applicable)
    .map((entry) => entry.item.layerItemId))
  const sceneOnlyRows = rows.filter((row) => (
    row.owner === 'scene' && !row.isTeacherController
  ))

  return Object.freeze({
    projectId: project.id,
    revision: project.revision,
    locationId,
    surfaceId: surface.id,
    surfaceType: surface.type,
    sceneId: scene?.id ?? null,
    stateId,
    scope: viewing,
    unifiedRows: Object.freeze(rows),
    sceneOnlyRows: Object.freeze(sceneOnlyRows),
    compositedRows: Object.freeze(rows.filter((row) => compositedIds.has(row.id))),
  })
}

/** Exact-state adapter for the unified renderer layer projection. */
export function composeEffectiveLayerLocation(input: {
  readonly project: CourseProjectDocument
  readonly locationId: string
  readonly stateId: string | null
}): CourseLayerComposition<LayerItem> {
  return composeCourseProjectLocation(input)
}

function resolveNamedState(
  scene: SlideSurfaceDocument['scenes'][number] | undefined,
  stateId: string | null,
): SlidePresentationState | undefined {
  if (!scene || stateId === null) return undefined
  const state = scene.presentation?.states.find((candidate) => candidate.id === stateId)
  if (!state) throw new Error(`找不到 Slide 状态：${stateId}`)
  return state
}

function toRow(input: {
  readonly project: CourseProjectDocument
  readonly viewing: CourseAuthoringScopeToken
  readonly item: LayerItem
  readonly owner: CourseAuthoringOwner
  readonly scoped: ScopedLayerItem | undefined
  readonly state: SlidePresentationState | undefined
  readonly selected: boolean
  readonly locationId: string
  readonly sceneId: string | null
  readonly visibleAtLocation: boolean
  readonly globalPlane: GlobalLayerPlane | null
  readonly stackOrder: number
}): EffectiveLayerProjectionRow {
  const { item, owner, scoped, state, viewing } = input
  const stateOverrideApplied = owner === 'scene' &&
    Boolean(state?.layerItemOverrides[item.layerItemId])
  const source: EffectiveLayerSource = stateOverrideApplied ? 'state' : owner
  const visibleAtLocation = input.visibleAtLocation
  const scopeToken = scopeTokenForSelectingRow(viewing, {
    scopeToken: createCourseAuthoringScope({
      owner,
      locationId: viewing.locationId,
      surfaceId: viewing.surfaceId,
      sceneId: owner === 'scene' ? input.sceneId : null,
      stateId: viewing.stateId,
    }),
  })
  const impact: EffectiveLayerImpact = owner === 'global' || owner === 'surface'
    ? {
        kind: 'location',
        mode: scoped?.visibility.mode ?? 'all',
        locationIds: Object.freeze([...(scoped?.visibility.locationIds ?? [])]),
      }
    : owner === 'world'
      ? { kind: 'world', mode: 'owner', locationIds: Object.freeze([]) }
      : { kind: 'scene', mode: 'owner', locationIds: Object.freeze([]) }
  const ownerKey = ownerKeyFor(owner, viewing.surfaceId, owner === 'scene' ? input.sceneId : null)
  const reorderGroupKey = owner === 'global'
    ? `${ownerKey}:${input.globalPlane ?? 'overlay'}`
    : ownerKey

  return Object.freeze({
    id: item.layerItemId,
    name: item.label,
    source,
    sourceLabel: EFFECTIVE_LAYER_SOURCE_LABELS[source],
    owner,
    ownerKey,
    reorderGroupKey,
    authoringAddress: makeLayerItemAuthoringAddress({
      projectId: input.project.id,
      owner,
      surfaceId: viewing.surfaceId,
      sceneId: owner === 'scene' ? input.sceneId : null,
      kind: item.kind,
      layerItemId: item.layerItemId,
    }),
    scopeToken,
    kind: item.kind,
    isTeacherController: isTeacherControllerLayerItem(item),
    locked: item.locked,
    hidden: !item.visible,
    visibleAtLocation,
    effectiveVisible: visibleAtLocation && item.visible,
    selected: input.selected,
    stateOverrideApplied,
    impact,
    globalPlane: input.globalPlane,
    stackOrder: input.stackOrder,
    item,
  })
}

function requireRow(
  rows: readonly EffectiveLayerProjectionRow[],
  id: string,
): EffectiveLayerProjectionRow {
  const row = rows.find((candidate) => candidate.id === id)
  if (!row) throw new Error(`找不到图层：${id}`)
  return row
}

function moveOwnerIds(
  unifiedRows: readonly EffectiveLayerProjectionRow[],
  from: EffectiveLayerProjectionRow,
  to: EffectiveLayerProjectionRow,
  placement: 'before' | 'after',
): string[] {
  const ownerRows = unifiedRows.filter((row) => row.reorderGroupKey === from.reorderGroupKey)
  const ids = ownerRows.map((row) => row.id)
  const fromIndex = ids.indexOf(from.id)
  let toIndex = ids.indexOf(to.id)
  if (fromIndex < 0 || toIndex < 0) return ids
  ids.splice(fromIndex, 1)
  toIndex = ids.indexOf(to.id)
  const insertAt = placement === 'before' ? toIndex : toIndex + 1
  ids.splice(insertAt, 0, from.id)
  return ids
}

function collectFlowBlockIds(blocks: readonly FlowBlock[]): Set<string> {
  const ids = new Set<string>()
  const walk = (entries: readonly FlowBlock[]): void => {
    for (const block of entries) {
      ids.add(block.id)
      if (block.type === 'section') walk(block.blocks)
    }
  }
  walk(blocks)
  return ids
}
