import { nanoid } from 'nanoid'
import { allocateInputStateKeys } from '../interactions/inputAuthoringState'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { resolveEffectiveGlobalLayerPlanes } from '../../shared/courseLayerComposition'
import { isCourseTeacherControllerLayerItem } from '../../shared/teacherControllerConsistency'
import {
  MAX_SCENE_INTERACTIONS,
  isNodeMotionAction,
  isVideoInteractionAction,
  type InteractionRule,
} from '../../shared/interactionTypes'
import type {
  CourseProjectDocument,
  GlobalLayerEntry,
  GlobalLayerPlane,
  LayerItem,
  SlidePresentationState,
  SlideSceneDocument,
} from '../../shared/courseProjectTypes'
import {
  SLIDE_REJECT_WRONG_OWNER,
  SlideCommandError,
  type SlideAuthoringSessionRef,
} from './slideEditorCommands'
import { buildSlideEditorView } from './slideEditorView'
import { allocateCourseLayerOrder, sortScopedLayerList } from './globalLayerCommands'
import {
  rebuildChartItemIds,
  rebuildTableItemIds,
} from '../project/nativeNodeFactories'

/** V8 duplicate/paste offset. R2-D owns consecutive insertion stagger for new inserts. */
export const SLIDE_SCENE_CLIPBOARD_OFFSET = 20

export type V9SlideClipboardScope = 'scene' | 'surface' | 'global'

export interface V9SlideClipboardItem {
  readonly item: LayerItem
}

export interface V9SlideGlobalClipboardItem {
  /** Canonical wrapper with the legacy effective plane explicitly materialized. */
  readonly entry: Omit<GlobalLayerEntry, 'plane'> & { readonly plane: GlobalLayerPlane }
}

export interface V9SlideClipboardResourceReferences {
  readonly assetIds: readonly string[]
  readonly componentPackages: readonly {
    readonly packageId: string
    readonly version: string
  }[]
}

interface V9SlideClipboardPayloadBase {
  readonly projectId: string
  readonly interactions: readonly InteractionRule[]
  readonly resourceReferences: V9SlideClipboardResourceReferences
}

export interface V9SlideLocalClipboardPayload extends V9SlideClipboardPayloadBase {
  readonly sourceScope: 'scene' | 'surface'
  readonly items: readonly V9SlideClipboardItem[]
}

export interface V9SlideGlobalClipboardPayload extends V9SlideClipboardPayloadBase {
  readonly sourceScope: 'global'
  readonly items: readonly V9SlideGlobalClipboardItem[]
}

export type V9SlideClipboardPayload =
  | V9SlideLocalClipboardPayload
  | V9SlideGlobalClipboardPayload

export const SLIDE_CLIPBOARD_EMPTY_REASON = '剪贴板为空，无法粘贴'
export const SLIDE_CLIPBOARD_WRONG_OWNER_REASON =
  '当前 Slide scene 命令不能粘贴 global/surface 图层；请交给 R3'
export const SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON =
  '教师控制器为全局单份，不能通过剪贴板复制'

function requireSlideLocation(project: CourseProjectDocument, locationId: string) {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  return { location, surface, scene }
}

function sceneLayers(session: SlideAuthoringSessionRef) {
  if (session.scope !== 'scene') {
    throw new SlideCommandError(
      SLIDE_REJECT_WRONG_OWNER,
      '当前编辑范围不是本页元素，不能复制或粘贴 scene 图层',
    )
  }
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  return view.layers.filter((layer) => layer.source === 'scene')
}

function authoringDuplicateIdPrefix(item: LayerItem): string {
  if (item.kind === 'native') return item.content.nativeType
  return item.kind
}

function usedOrders(project: CourseProjectDocument, surfaceId: string, sceneId: string): Set<number> {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  const used = new Set<number>()
  for (const entry of project.globalLayerItems) used.add(entry.item.order)
  if (!surface || surface.type !== 'slide') return used
  for (const entry of surface.surfaceLayerItems) used.add(entry.item.order)
  const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
  for (const item of scene?.layerItems ?? []) used.add(item.order)
  return used
}

function controllerMinOrder(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
): number {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  const orders: number[] = []
  const visit = (item: LayerItem): void => {
    if (item.kind === 'native' && item.content.nativeType === 'teacher-controller') {
      orders.push(item.order)
    }
  }
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  if (!surface || surface.type !== 'slide') {
    return Number.POSITIVE_INFINITY
  }
  surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
  surface.scenes.find((scene) => scene.id === sceneId)?.layerItems.forEach(visit)
  return orders.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...orders)
}

function shiftOrdersAtOrAbove(project: CourseProjectDocument, fromInclusive: number): void {
  const visit = (item: LayerItem): void => {
    if (item.order >= fromInclusive) item.order += 1
  }
  project.globalLayerItems.forEach((entry) => visit(entry.item))
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => visit(entry.item))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => scene.layerItems.forEach(visit))
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach(visit)
    }
  })
}

export function reserveTopSceneLayerOrder(
  project: CourseProjectDocument,
  surfaceId: string,
  sceneId: string,
): number {
  const surface = project.surfaces.find((candidate) => candidate.id === surfaceId)
  if (!surface || surface.type !== 'slide') throw new Error('当前幻灯片已失效')
  const scene = surface.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) throw new Error('当前幻灯片已失效')
  const used = usedOrders(project, surfaceId, sceneId)
  const sceneMax = scene.layerItems.length === 0
    ? -1
    : Math.max(...scene.layerItems.map((item) => item.order))
  let order = sceneMax + 1
  while (used.has(order)) order += 1
  const controllerOrder = controllerMinOrder(project, surfaceId, sceneId)
  if (order >= controllerOrder) {
    shiftOrdersAtOrAbove(project, controllerOrder)
    return controllerOrder
  }
  return order
}

export function sortSlideSceneLayerItems(scene: SlideSceneDocument): void {
  scene.layerItems.sort((left, right) =>
    left.order - right.order || left.layerItemId.localeCompare(right.layerItemId),
  )
}

export function collectSlideClipboardResourceReferences(
  items: readonly LayerItem[],
): V9SlideClipboardResourceReferences {
  const assetIds = new Set<string>()
  const packages = new Map<string, string>()
  for (const item of items) {
    if (item.kind === 'component') {
      packages.set(item.component.packageId, item.component.version)
      if (item.staticFallbackAssetId) assetIds.add(item.staticFallbackAssetId)
      continue
    }
    if (item.kind === 'runtime') {
      Object.values(item.runtime.assets).forEach(({ assetId }) => assetIds.add(assetId))
      if (item.runtime.staticFallback?.assetId) assetIds.add(item.runtime.staticFallback.assetId)
      continue
    }
    if (item.content.nativeType === 'image') {
      assetIds.add(item.content.data.assetId)
    } else if (item.content.nativeType === 'video') {
      assetIds.add(item.content.data.assetId)
      if (item.content.data.poster.assetId) assetIds.add(item.content.data.poster.assetId)
    }
  }
  return {
    assetIds: [...assetIds].sort(),
    componentPackages: [...packages]
      .map(([packageId, version]) => ({ packageId, version }))
      .sort((left, right) => left.packageId.localeCompare(right.packageId)),
  }
}

export function validateSlideClipboardResourceReferences(
  project: CourseProjectDocument,
  references: V9SlideClipboardResourceReferences,
): void {
  for (const assetId of references.assetIds) {
    if (!project.assets[assetId]) throw new Error(`复制内容引用的素材已失效：${assetId}`)
  }
  for (const reference of references.componentPackages) {
    const current = project.componentPackages[reference.packageId]
    if (!current || current.version !== reference.version) {
      throw new Error(
        `复制内容引用的组件已失效：${reference.packageId}@${reference.version}`,
      )
    }
  }
}

function sameResourceReferences(
  left: V9SlideClipboardResourceReferences,
  right: V9SlideClipboardResourceReferences,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function collectCopiedInteractionRules(
  interactions: readonly InteractionRule[],
  sourceIds: ReadonlySet<string>,
): InteractionRule[] {
  const selected = interactions.filter(
    (rule) => 'nodeId' in rule.trigger && sourceIds.has(rule.trigger.nodeId),
  )
  const selectedIds = new Set(selected.map((rule) => rule.id))
  const actionIds = new Set(selected.flatMap((rule) => rule.actions.map((step) => step.id)))
  let changed = true
  while (changed) {
    changed = false
    for (const rule of interactions) {
      if (
        selectedIds.has(rule.id) ||
        rule.trigger.type !== 'animation.completed' ||
        !actionIds.has(rule.trigger.actionId)
      ) continue
      selected.push(rule)
      selectedIds.add(rule.id)
      rule.actions.forEach((step) => actionIds.add(step.id))
      changed = true
    }
  }
  return selected
}

export function remapCopiedInteractionRules(
  rules: readonly InteractionRule[],
  idMap: ReadonlyMap<string, string>,
  ruleIds?: ReadonlyMap<string, string>,
  stateKeys?: ReadonlyMap<string, string>,
): InteractionRule[] {
  const actionIdMap = new Map(
    rules.flatMap((rule) => rule.actions.map(
      (step) => [step.id, `action-${nanoid(10)}`] as const,
    )),
  )
  return rules.map((source) => {
    const rule = structuredClone(source)
    rule.id = ruleIds?.get(source.id) ?? `rule-${nanoid(10)}`
    for (const condition of rule.conditions) {
      if ('key' in condition && stateKeys?.has(condition.key)) condition.key = stateKeys.get(condition.key)!
    }
    if ('nodeId' in rule.trigger) {
      rule.trigger.nodeId = idMap.get(rule.trigger.nodeId) ?? rule.trigger.nodeId
    } else if (rule.trigger.type === 'animation.completed') {
      rule.trigger.actionId = actionIdMap.get(rule.trigger.actionId) ?? rule.trigger.actionId
    }
    rule.actions.forEach((step) => {
      step.id = actionIdMap.get(step.id) ?? `action-${nanoid(10)}`
      const action = step.action
      if (action.type === 'course-state.set' && stateKeys?.has(action.key)) action.key = stateKeys.get(action.key)!
      if (
        (isVideoInteractionAction(action) || isNodeMotionAction(action)) &&
        idMap.has(action.nodeId)
      ) {
        action.nodeId = idMap.get(action.nodeId)!
      }
    })
    return rule
  })
}

export function rewriteLayerInternalReferences(
  item: LayerItem,
  idMap: ReadonlyMap<string, string>,
): void {
  if (item.kind !== 'runtime' || !item.runtime.nodeBindings) return
  item.runtime.nodeBindings = Object.fromEntries(
    Object.entries(item.runtime.nodeBindings).map(([key, layerItemId]) => [
      key,
      idMap.get(layerItemId) ?? layerItemId,
    ]),
  )
}

function cloneClipboardItem(
  item: LayerItem,
  nextId: string,
  idMap: ReadonlyMap<string, string>,
): LayerItem {
  const duplicate = structuredClone(item)
  duplicate.layerItemId = nextId
  duplicate.label = `${item.label} 副本`.slice(0, 200)
  duplicate.frame.x += SLIDE_SCENE_CLIPBOARD_OFFSET
  duplicate.frame.y += SLIDE_SCENE_CLIPBOARD_OFFSET
  duplicate.locked = false
  if (duplicate.kind === 'native') {
    if (duplicate.content.nativeType === 'table') {
      duplicate.content.data = rebuildTableItemIds(duplicate.content.data)
    } else if (duplicate.content.nativeType === 'chart') {
      duplicate.content.data = rebuildChartItemIds(duplicate.content.data)
    }
  }
  rewriteLayerInternalReferences(duplicate, idMap)
  return duplicate
}

function copyNamedStateOverrides(
  scene: SlideSceneDocument,
  sourceId: string,
  duplicateId: string,
): void {
  scene.presentation?.states.forEach((state) => {
    const sourceOverride = state.layerItemOverrides[sourceId]
    if (sourceOverride) {
      const duplicateOverride = structuredClone(sourceOverride)
      if (duplicateOverride.frame?.x !== undefined) {
        duplicateOverride.frame.x += SLIDE_SCENE_CLIPBOARD_OFFSET
      }
      if (duplicateOverride.frame?.y !== undefined) {
        duplicateOverride.frame.y += SLIDE_SCENE_CLIPBOARD_OFFSET
      }
      if (duplicateOverride.label !== undefined) {
        duplicateOverride.label = `${duplicateOverride.label} 副本`.slice(0, 200)
      }
      delete duplicateOverride.locked
      delete duplicateOverride.order
      if (Object.keys(duplicateOverride.frame ?? {}).length === 0) {
        delete duplicateOverride.frame
      }
      if (Object.keys(duplicateOverride).length > 0) {
        state.layerItemOverrides[duplicateId] = duplicateOverride
      }
    }
    if (state.layerItemOrder?.includes(sourceId)) {
      const order = [...state.layerItemOrder]
      order.splice(order.indexOf(sourceId) + 1, 0, duplicateId)
      state.layerItemOrder = order
    }
  })
}

function showDuplicateInNamedState(
  presentationState: SlidePresentationState,
  sourceVisible: boolean,
  duplicateId: string,
): void {
  if (sourceVisible) presentationState.layerItemOverrides[duplicateId] = { visible: true }
}

/**
 * Snapshot of scene-scope layers plus interaction subgraphs. Does not write history.
 * Global/surface selection is refused; locked items may be copied.
 */
export function copySlideSceneClipboard(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
): V9SlideLocalClipboardPayload {
  const uniqueIds = [...new Set(layerItemIds)]
  if (uniqueIds.length === 0) throw new Error('没有可复制的选择')
  const layers = sceneLayers(session)
  const byId = new Map(layers.map((layer) => [layer.selectionId, layer]))
  const missing = uniqueIds.find((id) => !byId.has(id))
  if (missing !== undefined) {
    throw new SlideCommandError('invalid-selection', '所选元素已失效，请重新选择')
  }
  const { scene } = requireSlideLocation(
    session.history.present,
    session.selection.locationId,
  )
  const sourceIds = new Set(uniqueIds)
  // A managed answer is copied with its local feedback so it remains usable
  // when pasted into another scene. Unlisted professional rules stay independent.
  const families = new Set(uniqueIds.flatMap(id => {
    const item = byId.get(id)!.item
    return item.kind === 'native' && item.content.nativeType === 'input' ? item.content.data.ruleFamilyRuleIds : []
  }))
  for (const rule of scene.interactions) {
    if (!families.has(rule.id)) continue
    for (const { action } of rule.actions) {
      if (isNodeMotionAction(action) && byId.has(action.nodeId) && !sourceIds.has(action.nodeId)) {
        sourceIds.add(action.nodeId)
        uniqueIds.push(action.nodeId)
      }
    }
  }
  const items = uniqueIds.map((layerItemId) => ({
    item: structuredClone(byId.get(layerItemId)!.item) as LayerItem,
  }))
  const resourceReferences = collectSlideClipboardResourceReferences(
    items.map((entry) => entry.item),
  )
  validateSlideClipboardResourceReferences(session.history.present, resourceReferences)
  return {
    projectId: session.history.present.id,
    sourceScope: 'scene',
    items,
    interactions: collectCopiedInteractionRules(scene.interactions, sourceIds).map(
      (rule) => structuredClone(rule),
    ),
    resourceReferences,
  }
}

/**
 * Snapshots canonical global wrappers and their interaction subgraph without
 * passing through the lossy V8 SceneNode projection. Legacy planes are frozen
 * to their current effective value so a later paste cannot flip them.
 */
export function copySlideGlobalClipboard(
  session: SlideAuthoringSessionRef,
  layerItemIds: readonly string[],
): V9SlideGlobalClipboardPayload {
  if (session.scope !== 'global') {
    throw new SlideCommandError(
      SLIDE_REJECT_WRONG_OWNER,
      '当前编辑范围不是全局层，不能复制 global 图层',
    )
  }
  const uniqueIds = [...new Set(layerItemIds)]
  if (uniqueIds.length === 0) throw new Error('没有可复制的选择')
  const project = session.history.present
  const byId = new Map(
    project.globalLayerItems.map((entry) => [entry.item.layerItemId, entry] as const),
  )
  const missing = uniqueIds.find((id) => !byId.has(id))
  if (missing !== undefined) {
    throw new SlideCommandError('invalid-selection', '所选全局元素已失效，请重新选择')
  }
  if (uniqueIds.some((id) => isCourseTeacherControllerLayerItem(byId.get(id)?.item))) {
    throw new Error(SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON)
  }
  const effectivePlanes = resolveEffectiveGlobalLayerPlanes(project.globalLayerItems)
  const sourceIds = new Set(uniqueIds)
  const items = uniqueIds.map((layerItemId) => {
    const entry = structuredClone(byId.get(layerItemId)!)
    const plane = effectivePlanes.get(layerItemId)
    if (!plane) throw new Error(`找不到全局图层平面：${layerItemId}`)
    return { entry: { ...entry, plane } }
  })
  const resourceReferences = collectSlideClipboardResourceReferences(
    items.map(({ entry }) => entry.item),
  )
  validateSlideClipboardResourceReferences(project, resourceReferences)
  return {
    projectId: project.id,
    sourceScope: 'global',
    items,
    interactions: collectCopiedInteractionRules(project.globalInteractions, sourceIds).map(
      (rule) => structuredClone(rule),
    ),
    resourceReferences,
  }
}

export interface PasteSlideSceneClipboardInput {
  readonly locationId: string
  readonly stateId: string | null
  readonly clipboard: V9SlideClipboardPayload
}

/**
 * Mutates a draft document. Caller must wrap this in one commitSlideProjectMutation.
 */
export function mutatePasteSlideSceneClipboard(
  draft: CourseProjectDocument,
  input: PasteSlideSceneClipboardInput,
): string[] {
  const clipboard = input.clipboard
  if (clipboard.items.length === 0) throw new Error(SLIDE_CLIPBOARD_EMPTY_REASON)
  if (clipboard.sourceScope !== 'scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, SLIDE_CLIPBOARD_WRONG_OWNER_REASON)
  }
  if (clipboard.projectId !== draft.id) {
    throw new Error('剪贴板不属于当前课件，请重新复制')
  }
  const derivedReferences = collectSlideClipboardResourceReferences(
    clipboard.items.map((entry) => entry.item),
  )
  if (!sameResourceReferences(derivedReferences, clipboard.resourceReferences)) {
    throw new Error('剪贴板资源引用已失效，请重新复制')
  }
  validateSlideClipboardResourceReferences(draft, clipboard.resourceReferences)
  const { surface, scene } = requireSlideLocation(draft, input.locationId)
  if (scene.layerItems.length + clipboard.items.length > MAX_SCENE_NODES) {
    throw new Error(`粘贴后将超过每场景 ${MAX_SCENE_NODES} 个图层的上限。`)
  }
  const idMap = new Map<string, string>()
  for (const entry of clipboard.items) {
    idMap.set(entry.item.layerItemId, `${authoringDuplicateIdPrefix(entry.item)}-${nanoid(10)}`)
  }
  const pastedIds: string[] = []
  const ruleIds = new Map(clipboard.interactions.map(rule => [rule.id, `rule-${nanoid(10)}`]))
  const stateKeys = new Map<string, string>()
  for (const entry of clipboard.items) {
    const nextId = idMap.get(entry.item.layerItemId)!
    const duplicate = cloneClipboardItem(entry.item, nextId, idMap)
    if (duplicate.kind === 'native' && duplicate.content.nativeType === 'input') {
      const data = duplicate.content.data
      if (stateKeys.has(data.stateKey) || stateKeys.has(data.validityKey)) throw new Error('所选输入共享状态键，请分别复制')
      const keys = allocateInputStateKeys(draft, data.answerType, nanoid)
      stateKeys.set(data.stateKey, keys.stateKey)
      stateKeys.set(data.validityKey, keys.validityKey)
      Object.assign(data, keys)
      data.ruleFamilyRuleIds = data.ruleFamilyRuleIds.map(id => {
        const mapped = ruleIds.get(id)
        if (!mapped) throw new Error('剪贴板缺失输入判题规则，请重新复制')
        return mapped
      })
    }
    duplicate.order = reserveTopSceneLayerOrder(draft, surface.id, scene.id)
    if (input.stateId !== null) duplicate.visible = false
    scene.layerItems.push(duplicate)
    pastedIds.push(nextId)
    if (input.stateId === null) {
      copyNamedStateOverrides(scene, entry.item.layerItemId, nextId)
    } else {
      const presentationState = scene.presentation?.states.find(
        (candidate) => candidate.id === input.stateId,
      )
      if (!presentationState) throw new Error('当前命名状态已失效')
      showDuplicateInNamedState(presentationState, entry.item.visible, nextId)
    }
  }
  const remapped = remapCopiedInteractionRules(clipboard.interactions, idMap, ruleIds, stateKeys)
  if (scene.interactions.length + remapped.length > MAX_SCENE_INTERACTIONS) {
    throw new Error(`当前范围最多 ${MAX_SCENE_INTERACTIONS} 条规则`)
  }
  scene.interactions.push(...remapped)
  sortSlideSceneLayerItems(scene)
  return pastedIds
}

/** Mutates a draft document; the caller owns the single history commit. */
export function mutatePasteSlideGlobalClipboard(
  draft: CourseProjectDocument,
  clipboard: V9SlideClipboardPayload,
): string[] {
  if (clipboard.items.length === 0) throw new Error(SLIDE_CLIPBOARD_EMPTY_REASON)
  if (clipboard.sourceScope !== 'global') {
    throw new SlideCommandError(
      SLIDE_REJECT_WRONG_OWNER,
      '当前全局层不能粘贴 scene/surface 图层',
    )
  }
  if (clipboard.projectId !== draft.id) {
    throw new Error('剪贴板不属于当前课件，请重新复制')
  }
  if (draft.globalLayerItems.length + clipboard.items.length > MAX_SCENE_NODES) {
    throw new Error(`粘贴后将超过全局层 ${MAX_SCENE_NODES} 个元素的上限。`)
  }
  if (clipboard.items.some(({ entry }) => isCourseTeacherControllerLayerItem(entry.item))) {
    throw new Error(SLIDE_GLOBAL_CONTROLLER_CLIPBOARD_REASON)
  }
  const derivedReferences = collectSlideClipboardResourceReferences(
    clipboard.items.map(({ entry }) => entry.item),
  )
  if (!sameResourceReferences(derivedReferences, clipboard.resourceReferences)) {
    throw new Error('剪贴板资源引用已失效，请重新复制')
  }
  validateSlideClipboardResourceReferences(draft, clipboard.resourceReferences)
  const idMap = new Map<string, string>()
  for (const { entry } of clipboard.items) {
    idMap.set(
      entry.item.layerItemId,
      `${authoringDuplicateIdPrefix(entry.item)}-${nanoid(10)}`,
    )
  }
  const remapped = remapCopiedInteractionRules(clipboard.interactions, idMap)
  if (draft.globalInteractions.length + remapped.length > MAX_SCENE_INTERACTIONS) {
    throw new Error(`全局层最多 ${MAX_SCENE_INTERACTIONS} 条规则`)
  }
  const prepared = clipboard.items.map(({ entry }) => {
    const nextId = idMap.get(entry.item.layerItemId)!
    return {
      source: entry,
      nextId,
      duplicate: cloneClipboardItem(entry.item, nextId, idMap),
    }
  })
  const paintOrder = [...prepared].sort((left, right) => {
    if (left.source.plane !== right.source.plane) {
      return left.source.plane === 'underlay' ? -1 : 1
    }
    return left.source.item.order - right.source.item.order
      || left.source.item.layerItemId.localeCompare(right.source.item.layerItemId)
  })
  let preferredOrder = draft.globalLayerItems.reduce(
    (maximum, entry) => Math.max(maximum, entry.item.order + 1),
    0,
  )
  for (const { source, duplicate } of paintOrder) {
    duplicate.order = allocateCourseLayerOrder(draft, preferredOrder)
    preferredOrder = duplicate.order + 1
    draft.globalLayerItems.push({
      item: duplicate,
      visibility: structuredClone(source.visibility),
      plane: source.plane,
    })
  }
  draft.globalInteractions.push(...remapped)
  sortScopedLayerList(draft.globalLayerItems)
  return prepared.map(({ nextId }) => nextId)
}
