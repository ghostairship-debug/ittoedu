import { nanoid } from 'nanoid'
import { MAX_SCENE_NODES } from '../../shared/constants'
import { resolveEffectiveGlobalLayerPlanes } from '../../shared/courseLayerComposition'
import {
  MAX_SCENE_INTERACTIONS,
  isNodeMotionAction,
  isVideoInteractionAction,
  type InteractionRule,
} from '../../shared/interactionTypes'
import type {
  CourseProjectDocument,
  GlobalLayerPlane,
  LayerItem,
  LocationVisibility,
  ScopedLayerItem,
  SlideSceneDocument,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import { ownerKeyFor } from '../authoring/courseAuthoringScope'
import {
  isTeacherControllerLayerItem,
  projectEffectiveLayers,
} from './effectiveLayerProjection'
import {
  allocateCourseLayerOrder,
  sortAllCourseLayerLists,
} from './globalLayerCommands'
import {
  SpatialCommandError,
  bumpSpatialGeneration,
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  commitSpatialProjectMutation,
  rejectSpatialCommand,
  rejectSpatialIfStale,
  replaceSpatialSession,
  succeedSpatialCommand,
  type SpatialAuthoringSession,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import {
  selectSpatialEditorLayers,
  spatialSurfaceIn,
} from './spatialEditorCommands'
import type { SpatialEditorLayerScope } from './spatialEditorView'
import { planSpatialGraphAfterWorldCopy } from './spatialRelationCommands'

export const SPATIAL_CLIPBOARD_OFFSET = 20
export const SPATIAL_CLIPBOARD_EMPTY_REASON = '剪贴板为空，无法粘贴'
export const SPATIAL_CLIPBOARD_STALE_REASON = '剪贴板内容已失效，请重新复制'
export const SPATIAL_CLIPBOARD_WRONG_OWNER_REASON =
  '剪贴板内容不属于当前 Spatial 编辑范围，请切换到原图层范围后重试'
export const SPATIAL_CLIPBOARD_CONTROLLER_REASON = '教师控制器不能复制或重复'

export interface SpatialClipboardResourceReferences {
  readonly assetIds: readonly string[]
  readonly componentPackages: readonly {
    readonly packageId: string
    readonly version: string
  }[]
}

export interface SpatialClipboardItem {
  readonly item: LayerItem
  readonly authoringAddress: string
  /** Global/surface storage fact. World items intentionally carry null. */
  readonly visibility: LocationVisibility | null
  /** Effective source plane for global items; non-global items carry null. */
  readonly plane: GlobalLayerPlane | null
}

/** Session-only canonical clipboard. It is never serialized or mirrored to V8 fields. */
export interface SpatialClipboardPayload {
  readonly projectId: string
  readonly sessionId: string
  /** Informational source revision; paste validity is not revision-gated. */
  readonly capturedRevision: number
  readonly locationId: string
  readonly surfaceId: string
  readonly owner: SpatialEditorLayerScope
  readonly ownerKey: string
  readonly items: readonly SpatialClipboardItem[]
  readonly interactions: readonly InteractionRule[]
  readonly resourceReferences: SpatialClipboardResourceReferences
}

export interface SpatialClipboardCommandResult extends SpatialCommandResult {
  readonly createdIds?: readonly string[]
}

interface CaptureOptions {
  readonly allowTargetOwner?: boolean
}

function spatialContext(session: SpatialAuthoringSession): {
  readonly surface: SpatialSurfaceDocument
  readonly locationId: string
  readonly surfaceId: string
} {
  const project = session.history.present
  const location = project.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'spatial-camera') {
    throw new SpatialCommandError('wrong-owner', '当前位置不是 Spatial 镜头位置')
  }
  if (location.surfaceId !== session.selection.surfaceId) {
    throw new SpatialCommandError('wrong-owner', 'Spatial 会话与当前位置不一致')
  }
  return {
    surface: spatialSurfaceIn(project, location.surfaceId),
    locationId: location.id,
    surfaceId: location.surfaceId,
  }
}

function allLayerItemIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  project.globalLayerItems.forEach((entry) => ids.add(entry.item.layerItemId))
  project.surfaces.forEach((surface) => {
    surface.surfaceLayerItems.forEach((entry) => ids.add(entry.item.layerItemId))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems.forEach((item) => ids.add(item.layerItemId))
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => ids.add(item.layerItemId))
    }
  })
  return ids
}

function scopedEntriesForOwner(
  project: CourseProjectDocument,
  surface: SpatialSurfaceDocument,
  owner: SpatialEditorLayerScope,
): ScopedLayerItem[] | null {
  if (owner === 'global') return project.globalLayerItems
  if (owner === 'surface') return surface.surfaceLayerItems
  return null
}

function ownerItems(
  project: CourseProjectDocument,
  surface: SpatialSurfaceDocument,
  owner: SpatialEditorLayerScope,
): LayerItem[] {
  return scopedEntriesForOwner(project, surface, owner)?.map((entry) => entry.item)
    ?? surface.world.layerItems
}

function canonicalClipboardItem(
  project: CourseProjectDocument,
  surface: SpatialSurfaceDocument,
  owner: SpatialEditorLayerScope,
  layerItemId: string,
  globalPlanes: ReadonlyMap<string, GlobalLayerPlane>,
): {
  readonly item: LayerItem
  readonly visibility: LocationVisibility | null
  readonly plane: GlobalLayerPlane | null
} {
  const scoped = scopedEntriesForOwner(project, surface, owner)
  if (scoped) {
    const entry = scoped.find((candidate) => candidate.item.layerItemId === layerItemId)
    if (!entry) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
    const plane = owner === 'global' ? globalPlanes.get(layerItemId) : null
    if (owner === 'global' && !plane) throw new SpatialCommandError('invalid-selection')
    return { item: entry.item, visibility: entry.visibility, plane: plane ?? null }
  }
  const item = surface.world.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
  if (!item) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
  return { item, visibility: null, plane: null }
}

function collectCopiedInteractionRules(
  interactions: readonly InteractionRule[],
  sourceIds: ReadonlySet<string>,
): InteractionRule[] {
  const copied = interactions.filter(
    (rule) => 'nodeId' in rule.trigger && sourceIds.has(rule.trigger.nodeId),
  )
  const copiedRuleIds = new Set(copied.map((rule) => rule.id))
  const copiedActionIds = new Set(copied.flatMap((rule) => rule.actions.map((step) => step.id)))
  let changed = true
  while (changed) {
    changed = false
    for (const rule of interactions) {
      if (
        copiedRuleIds.has(rule.id)
        || rule.trigger.type !== 'animation.completed'
        || !copiedActionIds.has(rule.trigger.actionId)
      ) continue
      copied.push(rule)
      copiedRuleIds.add(rule.id)
      rule.actions.forEach((step) => copiedActionIds.add(step.id))
      changed = true
    }
  }
  return copied
}

function collectResourceReferences(items: readonly LayerItem[]): SpatialClipboardResourceReferences {
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

function validateResourceReferences(
  project: CourseProjectDocument,
  references: SpatialClipboardResourceReferences,
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
  left: SpatialClipboardResourceReferences,
  right: SpatialClipboardResourceReferences,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function validateRuntimeBindings(
  items: readonly LayerItem[],
  knownLayerItemIds: ReadonlySet<string>,
): void {
  for (const item of items) {
    if (item.kind !== 'runtime' || !item.runtime.nodeBindings) continue
    for (const layerItemId of Object.values(item.runtime.nodeBindings)) {
      if (!knownLayerItemIds.has(layerItemId)) {
        throw new Error(`Runtime 图层引用已失效：${layerItemId}`)
      }
    }
  }
}

function validateScopedVisibilityReferences(
  project: CourseProjectDocument,
  items: readonly SpatialClipboardItem[],
): void {
  const locationIds = new Set(project.locations.map((location) => location.id))
  for (const entry of items) {
    for (const locationId of entry.visibility?.locationIds ?? []) {
      if (!locationIds.has(locationId)) {
        throw new Error(`剪贴板可见范围引用已失效：${locationId}`)
      }
    }
  }
}

function slideScenes(project: CourseProjectDocument): Map<string, SlideSceneDocument> {
  const scenes = new Map<string, SlideSceneDocument>()
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    surface.scenes.forEach((scene) => scenes.set(scene.id, scene))
  }
  return scenes
}

function validateCopiedInteractionReferences(
  project: CourseProjectDocument,
  rules: readonly InteractionRule[],
  knownLayerItemIds: ReadonlySet<string>,
): void {
  const scenes = slideScenes(project)
  const soundIds = new Set(Object.keys(project.media.audio.sounds))
  const actionIds = new Set<string>()
  for (const rule of rules) {
    for (const step of rule.actions) {
      if (actionIds.has(step.id)) throw new Error(`互动动作 ID 重复：${step.id}`)
      actionIds.add(step.id)
    }
  }
  for (const rule of rules) {
    const scopedSceneIds = rule.conditions
      .filter((condition) => condition.type === 'scene.in')
      .flatMap((condition) => condition.sceneIds)
    for (const sceneId of scopedSceneIds) {
      if (!scenes.has(sceneId)) throw new Error(`互动场景引用已失效：${sceneId}`)
    }
    const stateScenes = scopedSceneIds.length > 0
      ? [...new Set(scopedSceneIds)].map((sceneId) => scenes.get(sceneId)!)
      : [...scenes.values()]
    const validateState = (stateId: string): void => {
      if (!stateScenes.some((scene) => (
        scene.presentation?.states.some((state) => state.id === stateId)
      ))) {
        throw new Error(`互动状态引用已失效：${stateId}`)
      }
    }
    if ('nodeId' in rule.trigger && !knownLayerItemIds.has(rule.trigger.nodeId)) {
      throw new Error(`互动触发引用已失效：${rule.trigger.nodeId}`)
    }
    if (rule.trigger.type === 'audio.ended' && !soundIds.has(rule.trigger.soundId)) {
      throw new Error(`互动声音引用已失效：${rule.trigger.soundId}`)
    }
    if (rule.trigger.type === 'presentation.enter') {
      validateState(rule.trigger.stateId)
    }
    if (
      rule.trigger.type === 'animation.completed'
      && !actionIds.has(rule.trigger.actionId)
    ) {
      throw new Error(`互动动画引用已失效：${rule.trigger.actionId}`)
    }
    for (const condition of rule.conditions) {
      if (condition.type !== 'presentation.in') continue
      condition.stateIds.forEach(validateState)
    }
    for (const step of rule.actions) {
      const action = step.action
      if (
        (isVideoInteractionAction(action) || isNodeMotionAction(action))
        && !knownLayerItemIds.has(action.nodeId)
      ) {
        throw new Error(`互动动作引用已失效：${action.nodeId}`)
      }
      if (action.type === 'audio.play' && !soundIds.has(action.soundId)) {
        throw new Error(`互动声音引用已失效：${action.soundId}`)
      }
      if (
        (
          action.type === 'audio.pause'
          || action.type === 'audio.resume'
          || action.type === 'audio.stop'
          || action.type === 'audio.toggle-mute'
        )
        && action.target.kind === 'sound'
        && !soundIds.has(action.target.soundId)
      ) {
        throw new Error(`互动声音引用已失效：${action.target.soundId}`)
      }
      if (action.type === 'presentation.set') validateState(action.stateId)
      if (action.type === 'scene.go') {
        const targetScene = scenes.get(action.sceneId)
        if (!targetScene) throw new Error(`互动场景引用已失效：${action.sceneId}`)
        if (
          action.targetStateId
          && !targetScene.presentation?.states.some(
            (state) => state.id === action.targetStateId,
          )
        ) {
          throw new Error(`互动目标状态引用已失效：${action.targetStateId}`)
        }
      }
    }
  }
}

function stableDuplicateLayerId(item: LayerItem, used: Set<string>): string {
  const kind = item.kind === 'native' ? item.content.nativeType : item.kind
  let id = `${kind}-${nanoid(10)}`
  while (used.has(id)) id = `${kind}-${nanoid(10)}`
  used.add(id)
  return id
}

function remapCopiedInteractions(
  rules: readonly InteractionRule[],
  layerIdMap: ReadonlyMap<string, string>,
  usedRuleIds: Set<string>,
  usedActionIds: Set<string>,
): InteractionRule[] {
  const actionIdMap = new Map<string, string>()
  for (const rule of rules) {
    for (const step of rule.actions) {
      if (actionIdMap.has(step.id)) throw new Error(`互动动作 ID 重复：${step.id}`)
      let id = `action-${nanoid(10)}`
      while (usedActionIds.has(id)) id = `action-${nanoid(10)}`
      usedActionIds.add(id)
      actionIdMap.set(step.id, id)
    }
  }
  return rules.map((source) => {
    const rule = structuredClone(source)
    let ruleId = `rule-${nanoid(10)}`
    while (usedRuleIds.has(ruleId)) ruleId = `rule-${nanoid(10)}`
    usedRuleIds.add(ruleId)
    rule.id = ruleId
    if ('nodeId' in rule.trigger) {
      rule.trigger.nodeId = layerIdMap.get(rule.trigger.nodeId) ?? rule.trigger.nodeId
    } else if (rule.trigger.type === 'animation.completed') {
      const mapped = actionIdMap.get(rule.trigger.actionId)
      if (!mapped) throw new Error(`互动动画引用已失效：${rule.trigger.actionId}`)
      rule.trigger.actionId = mapped
    }
    rule.actions.forEach((step) => {
      step.id = actionIdMap.get(step.id)!
      const action = step.action
      if (
        (isVideoInteractionAction(action) || isNodeMotionAction(action))
        && layerIdMap.has(action.nodeId)
      ) {
        action.nodeId = layerIdMap.get(action.nodeId)!
      }
    })
    return rule
  })
}

function captureSpatialClipboard(
  session: SpatialAuthoringSession,
  layerItemIds: readonly string[],
  options: CaptureOptions = {},
): SpatialClipboardPayload {
  const uniqueIds = [...new Set(layerItemIds)]
  if (uniqueIds.length === 0) throw new Error('没有可复制的选择')
  const project = session.history.present
  const { surface, locationId, surfaceId } = spatialContext(session)
  const projection = projectEffectiveLayers({
    project,
    locationId,
    selectedIds: uniqueIds,
    owner: session.scope,
  })
  const rows = uniqueIds.map((layerItemId) => {
    const row = projection.unifiedRows.find((candidate) => candidate.id === layerItemId)
    if (!row) throw new SpatialCommandError('invalid-selection', '所选元素已失效，请重新选择')
    return row
  })
  const owner = rows[0]!.owner
  if (owner === 'scene') throw new SpatialCommandError('wrong-owner')
  const ownerKey = rows[0]!.ownerKey
  if (rows.some((row) => row.ownerKey !== ownerKey)) {
    throw new SpatialCommandError('wrong-owner', '一次只能复制同一图层范围内的元素')
  }
  if (!options.allowTargetOwner && owner !== session.scope) {
    throw new SpatialCommandError('wrong-owner', SPATIAL_CLIPBOARD_WRONG_OWNER_REASON)
  }
  if (rows.some((row) => isTeacherControllerLayerItem(row.item))) {
    throw new Error(SPATIAL_CLIPBOARD_CONTROLLER_REASON)
  }
  if (rows.some((row) => row.locked)) {
    throw new SpatialCommandError('locked')
  }
  const globalPlanes = resolveEffectiveGlobalLayerPlanes(project.globalLayerItems)
  const items = rows.map((row): SpatialClipboardItem => {
    const canonical = canonicalClipboardItem(project, surface, owner, row.id, globalPlanes)
    return {
      item: structuredClone(canonical.item),
      authoringAddress: row.authoringAddress,
      visibility: canonical.visibility ? structuredClone(canonical.visibility) : null,
      plane: canonical.plane,
    }
  })
  const sourceIds = new Set(uniqueIds)
  const interactions = collectCopiedInteractionRules(
    project.globalInteractions,
    sourceIds,
  ).map((rule) => structuredClone(rule))
  const knownLayerItemIds = allLayerItemIds(project)
  validateScopedVisibilityReferences(project, items)
  validateRuntimeBindings(items.map((entry) => entry.item), knownLayerItemIds)
  validateCopiedInteractionReferences(project, interactions, knownLayerItemIds)
  const resourceReferences = collectResourceReferences(items.map((entry) => entry.item))
  validateResourceReferences(project, resourceReferences)
  return {
    projectId: project.id,
    sessionId: session.sessionId,
    capturedRevision: project.revision,
    locationId,
    surfaceId,
    owner,
    ownerKey,
    items,
    interactions,
    resourceReferences,
  }
}

/** Copy is read-only; locked or non-copyable layers are rejected as one batch. */
export function copySpatialClipboard(
  session: SpatialAuthoringSession,
  layerItemIds: readonly string[],
): SpatialClipboardPayload {
  return captureSpatialClipboard(session, layerItemIds)
}

function validateClipboardForPaste(
  session: SpatialAuthoringSession,
  clipboard: SpatialClipboardPayload,
): { readonly surface: SpatialSurfaceDocument; readonly items: readonly LayerItem[] } {
  const project = session.history.present
  const { surface, locationId, surfaceId } = spatialContext(session)
  if (clipboard.items.length === 0) throw new Error(SPATIAL_CLIPBOARD_EMPTY_REASON)
  if (
    clipboard.projectId !== project.id
    || clipboard.sessionId !== session.sessionId
  ) {
    throw new SpatialCommandError('stale-revision', SPATIAL_CLIPBOARD_STALE_REASON)
  }
  if (
    clipboard.locationId !== locationId
    || clipboard.surfaceId !== surfaceId
    || clipboard.owner !== session.scope
    || clipboard.ownerKey !== ownerKeyFor(clipboard.owner, surfaceId, null)
  ) {
    throw new SpatialCommandError('wrong-owner', SPATIAL_CLIPBOARD_WRONG_OWNER_REASON)
  }
  const sourceIds = clipboard.items.map((entry) => entry.item.layerItemId)
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new SpatialCommandError('invalid-selection', '剪贴板包含重复元素')
  }
  const projection = projectEffectiveLayers({
    project,
    locationId,
    selectedIds: [],
    owner: clipboard.owner,
  })
  for (const entry of clipboard.items) {
    const row = projection.unifiedRows.find(
      (candidate) => candidate.id === entry.item.layerItemId,
    )
    if (
      !row
      || row.ownerKey !== clipboard.ownerKey
      || row.authoringAddress !== entry.authoringAddress
      || row.item.kind !== entry.item.kind
    ) {
      throw new SpatialCommandError('invalid-selection', SPATIAL_CLIPBOARD_STALE_REASON)
    }
    if (row.locked) throw new SpatialCommandError('locked')
    if (isTeacherControllerLayerItem(entry.item)) {
      throw new Error(SPATIAL_CLIPBOARD_CONTROLLER_REASON)
    }
    if ((clipboard.owner === 'world') !== (entry.visibility === null)) {
      throw new SpatialCommandError('wrong-owner', SPATIAL_CLIPBOARD_WRONG_OWNER_REASON)
    }
  }
  const items = clipboard.items.map((entry) => entry.item)
  const derivedReferences = collectResourceReferences(items)
  if (!sameResourceReferences(derivedReferences, clipboard.resourceReferences)) {
    throw new Error('剪贴板资源引用已失效，请重新复制')
  }
  validateResourceReferences(project, derivedReferences)
  const knownLayerItemIds = allLayerItemIds(project)
  validateScopedVisibilityReferences(project, clipboard.items)
  validateRuntimeBindings(items, knownLayerItemIds)
  validateCopiedInteractionReferences(project, clipboard.interactions, knownLayerItemIds)
  if (ownerItems(project, surface, clipboard.owner).length + items.length > MAX_SCENE_NODES) {
    throw new Error(`粘贴后将超过当前图层范围 ${MAX_SCENE_NODES} 个元素的上限。`)
  }
  if (project.globalInteractions.length + clipboard.interactions.length > MAX_SCENE_INTERACTIONS) {
    throw new Error(`当前作用域最多 ${MAX_SCENE_INTERACTIONS} 条互动规则`)
  }
  return { surface, items }
}

export function pasteSpatialClipboard(
  session: SpatialAuthoringSession,
  clipboard: SpatialClipboardPayload | null,
  options: SpatialCommandOptions = {},
): SpatialClipboardCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  if (!clipboard) return rejectSpatialCommand(session, SPATIAL_CLIPBOARD_EMPTY_REASON)
  try {
    const project = session.history.present
    const { surface, items } = validateClipboardForPaste(session, clipboard)
    const usedLayerItemIds = allLayerItemIds(project)
    const layerIdMap = new Map<string, string>()
    for (const item of items) {
      layerIdMap.set(item.layerItemId, stableDuplicateLayerId(item, usedLayerItemIds))
    }
    const usedRuleIds = new Set(project.globalInteractions.map((rule) => rule.id))
    const usedActionIds = new Set(
      project.globalInteractions.flatMap((rule) => rule.actions.map((step) => step.id)),
    )
    const remappedInteractions = remapCopiedInteractions(
      clipboard.interactions,
      layerIdMap,
      usedRuleIds,
      usedActionIds,
    )
    const copiedIds = [...layerIdMap.values()]
    const ownerOrder = ownerItems(project, surface, clipboard.owner).reduce(
      (highest, item) => Math.max(highest, item.order),
      -1,
    )
    const next = commitSpatialProjectMutation(project, (draft) => {
      const draftSurface = spatialSurfaceIn(draft, clipboard.surfaceId)
      let preferredOrder = ownerOrder + 1
      clipboard.items.forEach((entry) => {
        const duplicate = structuredClone(entry.item)
        duplicate.layerItemId = layerIdMap.get(entry.item.layerItemId)!
        duplicate.label = `${entry.item.label} 副本`.slice(0, 200)
        duplicate.frame.x += SPATIAL_CLIPBOARD_OFFSET
        duplicate.frame.y += SPATIAL_CLIPBOARD_OFFSET
        duplicate.locked = false
        duplicate.order = allocateCourseLayerOrder(draft, preferredOrder)
        preferredOrder = duplicate.order + 1
        if (duplicate.kind === 'runtime' && duplicate.runtime.nodeBindings) {
          duplicate.runtime.nodeBindings = Object.fromEntries(
            Object.entries(duplicate.runtime.nodeBindings).map(([key, layerItemId]) => [
              key,
              layerIdMap.get(layerItemId) ?? layerItemId,
            ]),
          )
        }
        if (clipboard.owner === 'global') {
          draft.globalLayerItems.push({
            item: duplicate,
            plane: entry.plane ?? 'overlay',
            visibility: structuredClone(entry.visibility!),
          })
        } else if (clipboard.owner === 'surface') {
          draftSurface.surfaceLayerItems.push({
            item: duplicate,
            visibility: structuredClone(entry.visibility!),
          })
        } else {
          draftSurface.world.layerItems.push(duplicate)
        }
      })
      if (clipboard.owner === 'world') {
        const relationPlan = planSpatialGraphAfterWorldCopy(draftSurface, layerIdMap)
        if (relationPlan.relationsToAdd.length > 0) {
          draftSurface.world.relations = [
            ...(draftSurface.world.relations ?? []),
            ...relationPlan.relationsToAdd.map((relation) => structuredClone(relation)),
          ]
        }
      }
      draft.globalInteractions.push(...remappedInteractions)
      sortAllCourseLayerLists(draft)
    }, options.now)
    const selection = selectSpatialEditorLayers({
      project: next,
      locationId: session.selection.locationId,
      selectionIds: copiedIds,
    })
    const nextSession = replaceSpatialSession(session, {
      history: commitSpatialAuthoringHistory(session.history, next),
      selection,
      scope: clipboard.owner,
    })
    return {
      ...succeedSpatialCommand(nextSession, true),
      createdIds: copiedIds,
    }
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

/** Duplicate is one atomic capture+paste and never mutates the Store clipboard. */
export function duplicateSpatialLayers(
  session: SpatialAuthoringSession,
  layerItemIds: readonly string[],
  options: SpatialCommandOptions & { readonly allowTargetOwner?: boolean } = {},
): SpatialClipboardCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    const clipboard = captureSpatialClipboard(session, layerItemIds, {
      allowTargetOwner: options.allowTargetOwner,
    })
    const ownerChanged = clipboard.owner !== session.scope
    const targetSession = ownerChanged
      ? replaceSpatialSession(session, { scope: clipboard.owner })
      : session
    const result = pasteSpatialClipboard(targetSession, clipboard, options)
    if (!result.ok || !result.nextSession) {
      return rejectSpatialCommand(session, result.reason ?? '无法重复 Spatial 图层')
    }
    if (!ownerChanged) return result
    const nextSession = replaceSpatialSession(result.nextSession, {
      generation: bumpSpatialGeneration(session),
    })
    return {
      ...result,
      nextSession,
      selection: nextSession.selection,
    }
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}
