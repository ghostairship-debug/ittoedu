import { nanoid } from 'nanoid'
import {
  makeAuthoringAddress,
  type AuthoringAddressParts,
  type AuthoringCarrier,
} from '../../shared/authoringAddress'
import {
  getEffectiveLayerOrder,
  isCourseLayerVisibleAtLocation,
  sceneNodeToCourseLayerItem,
} from '../../shared/courseProjectModel'
import { resolveEffectiveGlobalLayerPlanes } from '../../shared/courseLayerComposition'
import type {
  CourseProjectDocument,
  GlobalLayerEntry,
  GlobalLayerPlane,
  LayerItem,
  LocationVisibility,
  NativeLayerItem,
  ScopedLayerItem,
} from '../../shared/courseProjectTypes'
import type { ProjectPlaybackSettings } from '../../shared/projectTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import {
  centerTeacherControllerAuthoringFrame,
  teacherControllerAuthoringRecoveryBounds,
} from '../../shared/teacherControllerLayout'
import type { DeepReadonly } from './slideEditorView'
import { createTeacherControllerNode } from '../project/createProject'
import {
  restoreCourseTeacherControllerLayer,
  synchronizeCourseTeacherControllerControls,
} from '../../shared/teacherControllerConsistency'
import {
  SLIDE_REJECT_LOCKED,
  SLIDE_REJECT_STALE_REVISION,
  SLIDE_REJECT_WRONG_OWNER,
  commitSlideProjectMutation,
} from './slideEditorCommands'
import { repairRemovedCourseReferences } from './courseReferenceCleanup'

export const LAYER_REJECT_LOCKED = SLIDE_REJECT_LOCKED
export const LAYER_REJECT_STALE_REVISION = SLIDE_REJECT_STALE_REVISION
export const LAYER_REJECT_WRONG_OWNER = SLIDE_REJECT_WRONG_OWNER

const LOCKED_WRITE_REASON = '图层已锁定，除解锁外不能修改。'
const CONTROLLER_MOVE_REASON = '教师控制器必须留在全局层，不能移动到页面或世界层。'
const CONTROLLER_DUPLICATE_REASON = '教师控制器不能重复，全课只需一个。'
const CONTROLLER_PLANE_REASON = '教师控制器固定在全局 Overlay，不能放到 Underlay。'
const CROSS_OWNER_REORDER_REASON = '不能跨来源假排序。请在同一来源内调整层级。'
const CROSS_GLOBAL_PLANE_REORDER_REASON = '全局 Underlay 与 Overlay 不能通过排序互换；请先在属性中切换图层位置。'
const INVALID_GLOBAL_REORDER_REASON = '全局平面排序必须包含该平面的全部图层，且不能混入其他来源。'

export interface LayerCommandOptions {
  readonly expectedRevision?: number
  readonly now?: string
}

/**
 * Document-level command result. Integrators wrap `nextDocument` in session
 * history. Temporary hit-test ids are never written here.
 */
export interface LayerCommandResult {
  readonly ok: boolean
  readonly reason?: string
  readonly nextDocument?: CourseProjectDocument
  readonly historyEntry?: boolean
  readonly createdLayerItemId?: string
}

/**
 * Owner target for R3-Z / R3-D. `authoringAddress` is always `makeAuthoringAddress`.
 * `locationId` is the current preview location and is not persisted.
 * Named state is `stateId` on a scene item, not a new source string.
 */
export interface EffectiveLayerCommandTarget {
  readonly authoringAddress: string
  readonly locationId: string
  readonly stateId?: string | null
}

export interface GlobalDeleteImpact {
  readonly layerItemId: string
  readonly label: string
  readonly isTeacherController: boolean
  readonly affectedLocationIds: readonly string[]
  readonly affectedLocationLabels: readonly string[]
  readonly message: string
}

export function lockedLayerWriteReason(): string {
  return LOCKED_WRITE_REASON
}

export function teacherControllerMustStayGlobalReason(): string {
  return CONTROLLER_MOVE_REASON
}

export function crossOwnerReorderReason(): string {
  return CROSS_OWNER_REORDER_REASON
}

export function isTeacherControllerLayerItem(
  item: LayerItem | DeepReadonly<LayerItem> | undefined,
): item is NativeLayerItem & {
  content: Extract<NativeLayerItem['content'], { nativeType: 'teacher-controller' }>
} {
  return Boolean(
    item &&
    item.kind === 'native' &&
    item.content.nativeType === 'teacher-controller',
  )
}

export function findGlobalTeacherController(
  project: Pick<CourseProjectDocument, 'globalLayerItems'>,
): GlobalLayerEntry | undefined {
  return project.globalLayerItems.find((entry) => isTeacherControllerLayerItem(entry.item))
}

export function carrierForLayerItem(item: LayerItem): AuthoringCarrier {
  if (item.kind === 'component') return 'component'
  if (item.kind === 'runtime') return 'runtime'
  return 'native'
}

export function makeGlobalLayerAuthoringAddress(
  projectId: string,
  layerItemId: string,
  carrier: AuthoringCarrier = 'native',
  field = 'item',
): string {
  return makeAuthoringAddress({
    projectId,
    scope: 'global',
    carrier,
    layerItemId,
    field,
  })
}

export function parseLayerAuthoringAddress(address: string): AuthoringAddressParts {
  const match = /^courseware:\/\/authoring\/([^/]+)\/(global|surface|scene)\/([^/]+)\/([^/]+)\/(native|runtime|component)\/([^?]+)\?field=(.+)$/.exec(
    address,
  )
  if (!match) {
    throw new Error('作者地址无效')
  }
  const surfaceRaw = decodeURIComponent(match[3]!)
  const sceneRaw = decodeURIComponent(match[4]!)
  return {
    projectId: decodeURIComponent(match[1]!),
    scope: match[2] as AuthoringAddressParts['scope'],
    surfaceId: surfaceRaw === '-' ? undefined : surfaceRaw,
    sceneId: sceneRaw === '-' ? undefined : sceneRaw,
    carrier: match[5] as AuthoringCarrier,
    layerItemId: decodeURIComponent(match[6]!),
    field: decodeURIComponent(match[7]!),
  }
}

export function failLayerCommand(reason: string): LayerCommandResult {
  return { ok: false, reason, historyEntry: false }
}

export function succeedLayerNoop(
  document: CourseProjectDocument,
  reason = '未变化',
): LayerCommandResult {
  return {
    ok: true,
    reason,
    nextDocument: document,
    historyEntry: false,
  }
}

export function succeedLayerMutation(
  nextDocument: CourseProjectDocument,
  reason: string,
  createdLayerItemId?: string,
): LayerCommandResult {
  return {
    ok: true,
    reason,
    nextDocument,
    historyEntry: true,
    createdLayerItemId,
  }
}

export function rejectIfStaleDocument(
  document: CourseProjectDocument,
  expectedRevision: number | undefined,
): LayerCommandResult | null {
  if (expectedRevision !== undefined && expectedRevision !== document.revision) {
    return failLayerCommand(LAYER_REJECT_STALE_REVISION)
  }
  return null
}

export function refuseLockedLayerWrite(
  item: LayerItem,
  unlocking: boolean,
): LayerCommandResult | null {
  if (item.locked && !unlocking) {
    return failLayerCommand(LAYER_REJECT_LOCKED)
  }
  return null
}

function requireLocation(
  project: CourseProjectDocument,
  locationId: string,
) {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  return location
}

export function requireGlobalLayerEntry(
  project: CourseProjectDocument,
  layerItemId: string,
): GlobalLayerEntry {
  const entry = project.globalLayerItems.find(
    (candidate) => candidate.item.layerItemId === layerItemId,
  )
  if (!entry) throw new Error(`找不到全局图层：${layerItemId}`)
  return entry
}

export function resolveGlobalLayerTarget(
  project: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
): GlobalLayerEntry {
  const parts = parseLayerAuthoringAddress(target.authoringAddress)
  if (parts.projectId !== project.id) {
    throw new Error('作者地址不属于当前工程')
  }
  if (parts.scope !== 'global') {
    throw new Error(LAYER_REJECT_WRONG_OWNER)
  }
  requireLocation(project, target.locationId)
  const entry = requireGlobalLayerEntry(project, parts.layerItemId)
  const expected = makeGlobalLayerAuthoringAddress(
    project.id,
    entry.item.layerItemId,
    carrierForLayerItem(entry.item),
    parts.field,
  )
  if (expected !== target.authoringAddress) {
    throw new Error(LAYER_REJECT_WRONG_OWNER)
  }
  return entry
}

function runDocumentMutation(
  document: CourseProjectDocument,
  mutate: (draft: CourseProjectDocument) => void,
  reason: string,
  options: LayerCommandOptions,
  createdLayerItemId?: string,
): LayerCommandResult {
  try {
    const next = commitSlideProjectMutation(document, mutate, options.now)
    return succeedLayerMutation(next, reason, createdLayerItemId)
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === LAYER_REJECT_WRONG_OWNER || error.message === LAYER_REJECT_LOCKED) {
        return failLayerCommand(error.message)
      }
      return failLayerCommand(error.message)
    }
    return failLayerCommand('命令失败')
  }
}

export function describeGlobalLayerDeleteImpact(
  project: CourseProjectDocument,
  layerItemId: string,
): GlobalDeleteImpact | null {
  const entry = project.globalLayerItems.find(
    (candidate) => candidate.item.layerItemId === layerItemId,
  )
  if (!entry) return null
  const locationIds = project.locations
    .filter((location) => isCourseLayerVisibleAtLocation(entry, location.id))
    .map((location) => location.id)
  const labels = project.locations
    .filter((location) => locationIds.includes(location.id))
    .map((location) => location.label)
  const isTeacherController = isTeacherControllerLayerItem(entry.item)
  const scope = locationIds.length === project.locations.length
    ? '全部页面'
    : labels.length > 0
      ? labels.join('、')
      : '当前可见范围'
  const restoreHint = isTeacherController
    ? '删除后可用“恢复教师控制器”重新加入默认控制台。'
    : '该全局内容不会复制到各页，删除后所有适用页面都会失去它。'
  return {
    layerItemId,
    label: entry.item.label,
    isTeacherController,
    affectedLocationIds: locationIds,
    affectedLocationLabels: labels,
    message: `删除全局层“${entry.item.label}”会影响${scope}。${restoreHint}`,
  }
}

export function sortScopedLayerList(entries: ScopedLayerItem[]): void {
  entries.sort((left, right) =>
    left.item.order - right.item.order ||
    left.item.layerItemId.localeCompare(right.item.layerItemId),
  )
}

export function sortLayerItemList(items: LayerItem[]): void {
  items.sort((left, right) =>
    left.order - right.order || left.layerItemId.localeCompare(right.layerItemId),
  )
}

export function sortAllCourseLayerLists(project: CourseProjectDocument): void {
  sortScopedLayerList(project.globalLayerItems)
  for (const surface of project.surfaces) {
    sortScopedLayerList(surface.surfaceLayerItems)
    if (surface.type === 'slide') {
      for (const scene of surface.scenes) sortLayerItemList(scene.layerItems)
    } else if (surface.type === 'spatial-2d') {
      sortLayerItemList(surface.world.layerItems)
    }
  }
}

export function collectCourseLayerItemIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  const visit = (item: LayerItem): void => {
    ids.add(item.layerItemId)
  }
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(visit))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(visit)
    }
  }
  return ids
}

export function visitAllCourseLayerItems(
  project: CourseProjectDocument,
  visit: (item: LayerItem) => void,
): void {
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(visit))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(visit)
    }
  }
}

export function allocateCourseLayerOrder(
  project: CourseProjectDocument,
  preferred: number,
): number {
  const used = new Set<number>()
  visitAllCourseLayerItems(project, (item) => {
    used.add(item.order)
  })
  let order = preferred
  while (used.has(order)) order += 1
  return order
}

export type GlobalLayerScenePlane = GlobalLayerPlane

export function readGlobalLayerScenePlane(
  document: Pick<CourseProjectDocument, 'globalLayerItems'>,
  layerItemId: string,
): GlobalLayerScenePlane {
  const plane = resolveEffectiveGlobalLayerPlanes(document.globalLayerItems).get(layerItemId)
  if (!plane) throw new Error(`找不到全局图层：${layerItemId}`)
  return plane
}

/** Writes the orthogonal global plane without changing any authored order. */
export function setGlobalLayerScenePlane(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  plane: GlobalLayerScenePlane,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const entry = resolveGlobalLayerTarget(document, target)
    const locked = refuseLockedLayerWrite(entry.item, false)
    if (locked) return locked
    requireLocation(document, target.locationId)
    if (isTeacherControllerLayerItem(entry.item) && plane !== 'overlay') {
      return failLayerCommand(CONTROLLER_PLANE_REASON)
    }
    const currentPlane = readGlobalLayerScenePlane(document, entry.item.layerItemId)
    if (currentPlane === plane) {
      return succeedLayerNoop(document, '图层位置未变化')
    }
    return runDocumentMutation(document, (draft) => {
      const current = requireGlobalLayerEntry(draft, entry.item.layerItemId)
      if (isTeacherControllerLayerItem(current.item) && plane !== 'overlay') {
        throw new Error(CONTROLLER_PLANE_REASON)
      }
      current.plane = plane
    }, plane === 'underlay' ? '已放到场景内容下方' : '已放到场景内容上方', options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新图层位置')
  }
}

export function shiftCourseLayerOrdersAtOrAbove(
  project: CourseProjectDocument,
  fromInclusive: number,
): void {
  visitAllCourseLayerItems(project, (item) => {
    if (item.order >= fromInclusive) item.order += 1
  })
}

export function nextDuplicateLayerItemId(
  item: LayerItem,
  reserved: ReadonlySet<string>,
): string {
  const prefix = item.kind === 'native' ? item.content.nativeType : item.kind
  let candidate = `${prefix}-${nanoid(10)}`
  while (reserved.has(candidate)) candidate = `${prefix}-${nanoid(10)}`
  return candidate
}

function isPermutation(current: readonly string[], next: readonly string[]): boolean {
  return current.length === next.length &&
    new Set(next).size === next.length &&
    next.every((id) => current.includes(id))
}

export function ownerBackToFrontIds(items: readonly LayerItem[]): string[] {
  return getEffectiveLayerOrder(items).map((item) => item.layerItemId)
}

export function reorderOwnerOrderSlots(
  items: LayerItem[],
  orderedIdsBackToFront: readonly string[],
): boolean {
  const currentIds = ownerBackToFrontIds(items)
  if (!isPermutation(currentIds, orderedIdsBackToFront)) return false
  if (orderedIdsBackToFront.every((id, index) => id === currentIds[index])) return true
  const lockedWouldMove = items.some((item) => {
    if (!item.locked) return false
    return currentIds.indexOf(item.layerItemId) !== orderedIdsBackToFront.indexOf(item.layerItemId)
  })
  if (lockedWouldMove) {
    throw new Error(LAYER_REJECT_LOCKED)
  }
  const slots = items.map((item) => item.order).sort((left, right) => left - right)
  const byId = new Map(items.map((item) => [item.layerItemId, item]))
  orderedIdsBackToFront.forEach((id, index) => {
    const item = byId.get(id)
    if (!item) throw new Error(`找不到图层：${id}`)
    item.order = slots[index]!
  })
  return true
}

export function canonicalizeLocationVisibility(
  visibleLocationIds: ReadonlySet<string>,
  allLocationIds: readonly string[],
): LocationVisibility {
  if (allLocationIds.length === 0 || visibleLocationIds.size === allLocationIds.length) {
    return { mode: 'all', locationIds: [] }
  }
  if (visibleLocationIds.size === 0) {
    return { mode: 'exclude', locationIds: [...allLocationIds] }
  }
  const hidden = allLocationIds.filter((id) => !visibleLocationIds.has(id))
  if (hidden.length <= visibleLocationIds.size) {
    return { mode: 'exclude', locationIds: hidden }
  }
  return { mode: 'include', locationIds: allLocationIds.filter((id) => visibleLocationIds.has(id)) }
}

export function isLocationVisibleInSpec(
  visibility: LocationVisibility,
  locationId: string,
): boolean {
  if (visibility.mode === 'all') return true
  const listed = visibility.locationIds.includes(locationId)
  return visibility.mode === 'include' ? listed : !listed
}

export function visibilityAfterTogglingLocation(
  current: LocationVisibility,
  locationId: string,
  visible: boolean,
  allLocationIds: readonly string[],
): LocationVisibility {
  const visibleSet = new Set(
    allLocationIds.filter((id) => id === locationId ? visible : isLocationVisibleInSpec(current, id)),
  )
  return canonicalizeLocationVisibility(visibleSet, allLocationIds)
}

function sameVisibility(left: LocationVisibility, right: LocationVisibility): boolean {
  return left.mode === right.mode &&
    left.locationIds.length === right.locationIds.length &&
    left.locationIds.every((id, index) => id === right.locationIds[index])
}

export function validateLocationVisibilitySpec(
  project: CourseProjectDocument,
  visibility: LocationVisibility,
): LocationVisibility {
  const known = new Set(project.locations.map((location) => location.id))
  const unique = [...new Set(visibility.locationIds)]
  if (unique.some((id) => !known.has(id))) {
    throw new Error('可见范围引用了不存在的课程位置')
  }
  if (visibility.mode !== 'all' && unique.length === 0) {
    throw new Error('仅所选/排除所选必须至少包含一个课程位置')
  }
  if (visibility.mode === 'all') {
    return { mode: 'all', locationIds: [] }
  }
  return { mode: visibility.mode, locationIds: unique }
}

export function reorderGlobalLayerItems(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  orderedLayerItemIds: readonly string[],
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    if (orderedLayerItemIds.length === 0) throw new Error(INVALID_GLOBAL_REORDER_REASON)
    const targetEntry = resolveGlobalLayerTarget(document, target)
    const effectivePlanes = resolveEffectiveGlobalLayerPlanes(document.globalLayerItems)
    const plane = effectivePlanes.get(targetEntry.item.layerItemId)
    if (!plane) throw new Error(INVALID_GLOBAL_REORDER_REASON)
    const requestedPlanes = orderedLayerItemIds.map((id) => effectivePlanes.get(id))
    if (requestedPlanes.some((requestedPlane) => requestedPlane === undefined)) {
      throw new Error(INVALID_GLOBAL_REORDER_REASON)
    }
    if (requestedPlanes.some((requestedPlane) => requestedPlane !== plane)) {
      return failLayerCommand(CROSS_GLOBAL_PLANE_REORDER_REASON)
    }
    const currentIds = ownerBackToFrontIds(document.globalLayerItems
      .filter((entry) => effectivePlanes.get(entry.item.layerItemId) === plane)
      .map((entry) => entry.item))
    if (!isPermutation(currentIds, orderedLayerItemIds)) {
      return failLayerCommand(INVALID_GLOBAL_REORDER_REASON)
    }
    if (orderedLayerItemIds.every((id, index) => id === currentIds[index])) {
      return succeedLayerNoop(document, '顺序未变化')
    }
    return runDocumentMutation(document, (draft) => {
      const livePlanes = resolveEffectiveGlobalLayerPlanes(draft.globalLayerItems)
      draft.globalLayerItems.forEach((entry) => {
        const effectivePlane = livePlanes.get(entry.item.layerItemId)
        if (!effectivePlane) throw new Error(INVALID_GLOBAL_REORDER_REASON)
        entry.plane = effectivePlane
      })
      const items = draft.globalLayerItems
        .filter((entry) => entry.plane === plane)
        .map((entry) => entry.item)
      if (!reorderOwnerOrderSlots(items, orderedLayerItemIds)) {
        throw new Error(INVALID_GLOBAL_REORDER_REASON)
      }
      sortScopedLayerList(draft.globalLayerItems)
    }, '已调整全局层顺序', options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : INVALID_GLOBAL_REORDER_REASON)
  }
}

export function patchGlobalLayerItem(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  patch: { readonly visible?: boolean; readonly locked?: boolean; readonly label?: string },
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const entry = resolveGlobalLayerTarget(document, target)
    const unlocking = patch.locked === false
    const locked = refuseLockedLayerWrite(entry.item, unlocking)
    if (locked) return locked
    const nextLabel = patch.label !== undefined ? patch.label.trim() : undefined
    if (nextLabel !== undefined && nextLabel.length === 0) {
      return failLayerCommand('名称不能为空')
    }
    const unchanged =
      (patch.visible === undefined || entry.item.visible === patch.visible) &&
      (patch.locked === undefined || entry.item.locked === patch.locked) &&
      (nextLabel === undefined || entry.item.label === nextLabel)
    if (unchanged) return succeedLayerNoop(document, '未变化')
    return runDocumentMutation(document, (draft) => {
      const current = requireGlobalLayerEntry(draft, entry.item.layerItemId)
      if (patch.visible !== undefined) current.item.visible = patch.visible
      if (patch.locked !== undefined) current.item.locked = patch.locked
      if (nextLabel !== undefined) current.item.label = nextLabel.slice(0, 200)
    }, nextLabel !== undefined
      ? `已重命名为“${nextLabel.slice(0, 200)}”`
      : patch.locked !== undefined
        ? (patch.locked ? '已锁定图层' : '已解锁图层')
        : (patch.visible ? '已显示图层' : '已隐藏图层'), options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新全局图层')
  }
}

/**
 * Sets `all | include | exclude + locationIds`. Does not change active location
 * or the course location order.
 */
export function setGlobalLayerLocationVisibility(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  visibility: LocationVisibility,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const entry = resolveGlobalLayerTarget(document, target)
    const locked = refuseLockedLayerWrite(entry.item, false)
    if (locked) return locked
    const nextVisibility = validateLocationVisibilitySpec(document, visibility)
    if (sameVisibility(entry.visibility, nextVisibility)) {
      return succeedLayerNoop(document, '可见范围未变化')
    }
    const startLocationId = document.startLocationId
    const locationOrder = document.locations.map((location) => location.id)
    return runDocumentMutation(document, (draft) => {
      const current = requireGlobalLayerEntry(draft, entry.item.layerItemId)
      current.visibility = nextVisibility
      if (draft.startLocationId !== startLocationId) {
        throw new Error('当前页显隐不能改变活动位置')
      }
      const nextOrder = draft.locations.map((location) => location.id)
      if (nextOrder.some((id, index) => id !== locationOrder[index])) {
        throw new Error('当前页显隐不能改变课程顺序')
      }
    }, '已更新全局层可见范围', options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新可见范围')
  }
}

/**
 * Shows or hides a global item at the current location only. Does not change
 * `startLocationId` or `locations` order, and does not write V8 `sceneIds`.
 */
export function setGlobalLayerVisibleAtLocation(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  visible: boolean,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const entry = resolveGlobalLayerTarget(document, target)
    const locked = refuseLockedLayerWrite(entry.item, false)
    if (locked) return locked
    requireLocation(document, target.locationId)
    const currentlyVisible = isCourseLayerVisibleAtLocation(entry, target.locationId)
    if (currentlyVisible === visible) {
      return succeedLayerNoop(document, '当前页显隐未变化')
    }
    const nextVisibility = visibilityAfterTogglingLocation(
      entry.visibility,
      target.locationId,
      visible,
      document.locations.map((location) => location.id),
    )
    return setGlobalLayerLocationVisibility(document, target, nextVisibility, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新当前页显隐')
  }
}

function cloneDuplicatedLayerItem(
  item: LayerItem,
  nextId: string,
): LayerItem {
  const duplicate = structuredClone(item)
  duplicate.layerItemId = nextId
  duplicate.label = `${item.label} 副本`.slice(0, 200)
  duplicate.frame.x += 20
  duplicate.frame.y += 20
  duplicate.locked = false
  return duplicate
}

export function duplicateGlobalLayerItem(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const entry = resolveGlobalLayerTarget(document, target)
    if (isTeacherControllerLayerItem(entry.item)) {
      return failLayerCommand(CONTROLLER_DUPLICATE_REASON)
    }
    const locked = refuseLockedLayerWrite(entry.item, false)
    if (locked) return locked
    const sourcePlane = readGlobalLayerScenePlane(document, entry.item.layerItemId)
    const reserved = collectCourseLayerItemIds(document)
    const createdId = nextDuplicateLayerItemId(entry.item, reserved)
    return runDocumentMutation(document, (draft) => {
      const current = requireGlobalLayerEntry(draft, entry.item.layerItemId)
      const duplicate = cloneDuplicatedLayerItem(current.item, createdId)
      shiftCourseLayerOrdersAtOrAbove(draft, current.item.order + 1)
      duplicate.order = current.item.order + 1
      draft.globalLayerItems.push({
        item: duplicate,
        plane: sourcePlane,
        visibility: structuredClone(current.visibility),
      })
      sortScopedLayerList(draft.globalLayerItems)
    }, `已复制“${entry.item.label}”`, options, createdId)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法复制全局图层')
  }
}

export function deleteGlobalLayerItem(
  document: CourseProjectDocument,
  target: EffectiveLayerCommandTarget,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const entry = resolveGlobalLayerTarget(document, target)
    const locked = refuseLockedLayerWrite(entry.item, false)
    if (locked) return locked
    const impact = describeGlobalLayerDeleteImpact(document, entry.item.layerItemId)
    return runDocumentMutation(document, (draft) => {
      const index = draft.globalLayerItems.findIndex(
        (candidate) => candidate.item.layerItemId === entry.item.layerItemId,
      )
      if (index < 0) throw new Error(`找不到全局图层：${entry.item.layerItemId}`)
      draft.globalLayerItems.splice(index, 1)
      repairRemovedCourseReferences(draft, {
        removedLocationIds: new Set(),
        removedLayerItemIds: new Set([entry.item.layerItemId]),
      })
      if (isTeacherControllerLayerItem(entry.item)) {
        synchronizeCourseTeacherControllerControls(draft)
      }
    }, impact?.message ?? `已删除“${entry.item.label}”`, options)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法删除全局图层')
  }
}

function nextFrontGlobalOrder(project: CourseProjectDocument): number {
  let max = -1
  visitAllCourseLayerItems(project, (item) => {
    if (item.order > max) max = item.order
  })
  return max + 1
}

function appendDefaultTeacherController(
  project: CourseProjectDocument,
  node = createTeacherControllerNode({
    id: `teacher-controller-${nanoid(8)}`,
  }),
): string {
  if (findGlobalTeacherController(project)) {
    throw new Error(CONTROLLER_DUPLICATE_REASON)
  }
  const item = sceneNodeToCourseLayerItem(node, nextFrontGlobalOrder(project))
  project.globalLayerItems.push({
    item,
    plane: 'overlay',
    visibility: { mode: 'all', locationIds: [] },
  })
  project.playback.controls = 'canvas'
  sortScopedLayerList(project.globalLayerItems)
  return item.layerItemId
}

function applyCoursePlaybackPatch(
  project: CourseProjectDocument,
  patch: Partial<ProjectPlaybackSettings>,
): void {
  if (patch.controls !== undefined) project.playback.controls = patch.controls
  if (patch.keyboardNavigation !== undefined) {
    project.playback.keyboardNavigation = patch.keyboardNavigation
  }
  if (patch.presenter !== undefined) {
    project.playback.presenter = structuredClone(patch.presenter)
  }

  if (patch.controls === 'none') {
    for (const entry of project.globalLayerItems) {
      if (isTeacherControllerLayerItem(entry.item)) {
        entry.item.playbackInitialVisibility = 'hidden'
      }
    }
  } else if (patch.controls === 'canvas') {
    const controller = findGlobalTeacherController(project)
    if (controller) restoreCourseTeacherControllerLayer(controller)
    else appendDefaultTeacherController(project)
  }

  if (patch.controls !== undefined) {
    synchronizeCourseTeacherControllerControls(project)
    project.playback.controls = patch.controls
  }
}

/**
 * Updates course-wide playback settings without choosing a Surface history.
 * Store integrations persist the returned document through the active Slide,
 * Flow or Spatial adapter, so one invocation creates at most one history step.
 */
export function updateCoursePlaybackSettings(
  document: CourseProjectDocument,
  patch: Partial<ProjectPlaybackSettings>,
  options: LayerCommandOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  try {
    const candidate = structuredClone(document)
    applyCoursePlaybackPatch(candidate, patch)
    const unchanged = JSON.stringify(candidate.playback) === JSON.stringify(document.playback) &&
      JSON.stringify(candidate.globalLayerItems) === JSON.stringify(document.globalLayerItems)
    if (unchanged) return succeedLayerNoop(document, '成品控制设置未变化')
    return runDocumentMutation(
      document,
      (draft) => applyCoursePlaybackPatch(draft, patch),
      '成品控制设置已更新',
      options,
    )
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法更新成品控制设置')
  }
}

interface TeacherControllerRestoreOptions extends LayerCommandOptions {
  /** Slide authoring locks are ownership state and must survive a delivery repair. */
  readonly preserveAuthoringLock?: boolean
}

function resetCourseTeacherControllerAuthoringFrame(entry: ScopedLayerItem): void {
  if (!isTeacherControllerLayerItem(entry.item)) return
  const recovery = teacherControllerAuthoringRecoveryBounds(
    entry.item.content.data,
    entry.item.frame,
    entry.item.rotation,
  )
  if (
    recovery.left >= 0 &&
    recovery.top >= 0 &&
    recovery.right <= CANVAS_WIDTH &&
    recovery.bottom <= CANVAS_HEIGHT
  ) return
  const frame = centerTeacherControllerAuthoringFrame(
    entry.item.content.data,
    entry.item.frame,
    entry.item.rotation,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  )
  entry.item.frame = {
    ...entry.item.frame,
    ...frame,
  }
}

/**
 * Restores the one global teacher controller to delivery-visible consistency.
 * It never writes a scene or Surface-local item.
 */
export function restoreDefaultTeacherController(
  document: CourseProjectDocument,
  options: TeacherControllerRestoreOptions = {},
): LayerCommandResult {
  const stale = rejectIfStaleDocument(document, options.expectedRevision)
  if (stale) return stale
  const existing = findGlobalTeacherController(document)
  try {
    if (existing) {
      const candidate = structuredClone(existing)
      if (!options.preserveAuthoringLock) candidate.item.locked = false
      restoreCourseTeacherControllerLayer(candidate)
      resetCourseTeacherControllerAuthoringFrame(candidate)
      const unchanged = JSON.stringify(candidate) === JSON.stringify(existing) &&
        document.playback.controls === 'canvas'
      if (unchanged) return succeedLayerNoop(document, '教师控制器已可用')
      return runDocumentMutation(document, (draft) => {
        const entry = findGlobalTeacherController(draft)
        if (!entry || !isTeacherControllerLayerItem(entry.item)) {
          throw new Error('全课控制器已失效，请重新选择。')
        }
        if (!options.preserveAuthoringLock) entry.item.locked = false
        restoreCourseTeacherControllerLayer(entry)
        resetCourseTeacherControllerAuthoringFrame(entry)
        draft.playback.controls = 'canvas'
        synchronizeCourseTeacherControllerControls(draft)
      }, '已恢复教师控制器', options, existing.item.layerItemId)
    }
    const node = createTeacherControllerNode({ id: `teacher-controller-${nanoid(8)}` })
    const createdId = node.id
    return runDocumentMutation(document, (draft) => {
      appendDefaultTeacherController(draft, node)
    }, '已恢复教师控制器', options, createdId)
  } catch (error) {
    return failLayerCommand(error instanceof Error ? error.message : '无法恢复教师控制器')
  }
}

export {
  CONTROLLER_DUPLICATE_REASON,
  CONTROLLER_PLANE_REASON,
  CONTROLLER_MOVE_REASON,
  CROSS_GLOBAL_PLANE_REORDER_REASON,
  CROSS_OWNER_REORDER_REASON,
  INVALID_GLOBAL_REORDER_REASON,
}
