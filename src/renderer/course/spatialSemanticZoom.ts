import type {
  LayerItem,
  SpatialSemanticZoomRule,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  catchSpatialCommand,
  commitSpatialAuthoringHistory,
  commitSpatialProjectMutation,
  rejectSpatialIfStale,
  type SpatialAuthoringHistory,
  type SpatialAuthoringSession,
  type SpatialCommandOptions,
  type SpatialCommandResult,
} from './spatialAuthoringHistory'
import { spatialSurfaceIn } from './spatialEditorCommands'
import { commitSpatialGraphHistoryResult } from './spatialPathCommands'
import { spatialGraphAuthoringAddress, spatialGraphValuesEqual, stableSpatialGraphId, validateSpatialPathLayerItemIds } from '../../core/tools/spatialPath'

export interface AddSpatialSemanticZoomRuleInput {
  readonly surfaceId: string
  readonly layerItemIds: readonly string[]
  readonly minZoom: number
  readonly maxZoom: number
  readonly visible?: boolean
  readonly id?: string
  readonly now?: string
}

export type SpatialSemanticZoomRuleUpdate =
  | Partial<Omit<SpatialSemanticZoomRule, 'id'>>
  | ((rule: SpatialSemanticZoomRule) => void)

export function spatialSemanticZoomAuthoringAddress(
  projectId: string,
  surfaceId: string,
  ruleId: string,
  field = 'semanticZoom',
): string {
  return spatialGraphAuthoringAddress({
    projectId,
    surfaceId,
    entityId: ruleId,
    field,
  })
}

export function validateSpatialSemanticZoomRange(minZoom: number, maxZoom: number): void {
  if (!Number.isFinite(minZoom) || minZoom < 0) {
    throw new Error('语义缩放最小缩放必须是不小于 0 的数字')
  }
  if (!Number.isFinite(maxZoom) || maxZoom <= 0) {
    throw new Error('语义缩放最大缩放必须大于 0')
  }
  if (minZoom >= maxZoom) {
    throw new Error('语义缩放最小缩放必须小于最大缩放')
  }
}

function semanticZoomRuleIn(
  surface: SpatialSurfaceDocument,
  ruleId: string,
): SpatialSemanticZoomRule {
  const rule = surface.semanticZoom.find((candidate) => candidate.id === ruleId)
  if (!rule) throw new Error('找不到语义缩放规则，请刷新后重试')
  return rule
}

function validateRuleLayerItemIds(
  surface: SpatialSurfaceDocument,
  layerItemIds: readonly string[],
): string[] {
  try {
    return validateSpatialPathLayerItemIds(surface, layerItemIds)
  } catch (error) {
    if (error instanceof Error && error.message === '路径至少需要经过一个世界图层') {
      throw new Error('语义缩放规则至少需要一个世界图层')
    }
    if (error instanceof Error && error.message === '路径不能重复经过同一图层') {
      throw new Error('语义缩放规则不能重复同一图层')
    }
    if (error instanceof Error && error.message === '路径引用了不存在的世界图层') {
      throw new Error('语义缩放规则引用了不存在的世界图层')
    }
    throw error
  }
}

/**
 * Visibility policy only. Items not covered by any matching rule stay visible.
 * Conflicting overlapping rules must all allow visibility.
 */
export function isSpatialItemSemanticallyVisible(
  itemId: string,
  zoom: number,
  rules: readonly SpatialSemanticZoomRule[],
): boolean {
  const applicable = rules.filter((rule) =>
    rule.layerItemIds.includes(itemId) && zoom >= rule.minZoom && zoom < rule.maxZoom,
  )
  if (applicable.length === 0) return true
  return applicable.every((rule) => rule.visible)
}

export function spatialSemanticZoomWorldVisibility(
  items: readonly LayerItem[],
  zoom: number,
  rules: readonly SpatialSemanticZoomRule[],
): ReadonlyMap<string, boolean> {
  return new Map(items.map((item) => [
    item.layerItemId,
    item.visible && isSpatialItemSemanticallyVisible(item.layerItemId, zoom, rules),
  ]))
}

/**
 * Semantic zoom never rewrites selection. Hidden items remain selected so
 * Properties / 撤销 still point at the same stable ids.
 */
export function spatialSemanticZoomKeepsSelection(
  selectionIds: readonly string[],
): readonly string[] {
  return selectionIds
}

export function addSpatialSemanticZoomRule(
  history: SpatialAuthoringHistory,
  input: AddSpatialSemanticZoomRuleInput,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, input.surfaceId)
  validateSpatialSemanticZoomRange(input.minZoom, input.maxZoom)
  const layerItemIds = validateRuleLayerItemIds(surface, input.layerItemIds)
  const ruleId = stableSpatialGraphId('semantic-zoom', input.id)
  if (surface.semanticZoom.some((rule) => rule.id === ruleId)) {
    throw new Error('语义缩放规则 ID 已存在，请重新生成后重试')
  }

  const next = commitSpatialProjectMutation(project, (draft) => {
    spatialSurfaceIn(draft, input.surfaceId).semanticZoom.push({
      id: ruleId,
      layerItemIds,
      minZoom: input.minZoom,
      maxZoom: input.maxZoom,
      visible: input.visible ?? true,
    })
  }, input.now)
  return commitSpatialAuthoringHistory(history, next)
}

export function updateSpatialSemanticZoomRule(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  ruleId: string,
  update: SpatialSemanticZoomRuleUpdate,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  const current = semanticZoomRuleIn(surface, ruleId)
  const nextRule = structuredClone(current)
  if (typeof update === 'function') {
    update(nextRule)
  } else if (update !== null && typeof update === 'object') {
    Object.assign(nextRule, structuredClone(update))
  } else {
    throw new Error('语义缩放更新数据无效')
  }
  nextRule.id = current.id
  validateSpatialSemanticZoomRange(nextRule.minZoom, nextRule.maxZoom)
  nextRule.layerItemIds = validateRuleLayerItemIds(surface, nextRule.layerItemIds)
  if (spatialGraphValuesEqual(current, nextRule)) return history

  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const index = draftSurface.semanticZoom.findIndex((rule) => rule.id === ruleId)
    if (index < 0) throw new Error('找不到语义缩放规则，请刷新后重试')
    draftSurface.semanticZoom[index] = nextRule
  }, now)
  return commitSpatialAuthoringHistory(history, next)
}

export function deleteSpatialSemanticZoomRule(
  history: SpatialAuthoringHistory,
  surfaceId: string,
  ruleId: string,
  now?: string,
): SpatialAuthoringHistory {
  const project = history.present
  const surface = spatialSurfaceIn(project, surfaceId)
  if (!surface.semanticZoom.some((rule) => rule.id === ruleId)) {
    throw new Error('找不到语义缩放规则，请刷新后重试')
  }
  const next = commitSpatialProjectMutation(project, (draft) => {
    const draftSurface = spatialSurfaceIn(draft, surfaceId)
    const index = draftSurface.semanticZoom.findIndex((rule) => rule.id === ruleId)
    if (index < 0) throw new Error('找不到语义缩放规则，请刷新后重试')
    draftSurface.semanticZoom.splice(index, 1)
  }, now)
  return commitSpatialAuthoringHistory(history, next)
}

export function addSpatialSemanticZoomRuleInSession(
  session: SpatialAuthoringSession,
  input: Omit<AddSpatialSemanticZoomRuleInput, 'surfaceId'> & { readonly surfaceId?: string },
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(session, addSpatialSemanticZoomRule(session.history, {
      ...input,
      surfaceId: input.surfaceId ?? session.selection.surfaceId,
      now: input.now ?? options.now,
    }))
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function updateSpatialSemanticZoomRuleInSession(
  session: SpatialAuthoringSession,
  ruleId: string,
  update: SpatialSemanticZoomRuleUpdate,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      updateSpatialSemanticZoomRule(
        session.history,
        session.selection.surfaceId,
        ruleId,
        update,
        options.now,
      ),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}

export function deleteSpatialSemanticZoomRuleInSession(
  session: SpatialAuthoringSession,
  ruleId: string,
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const stale = rejectSpatialIfStale(session, options.expectedRevision)
  if (stale) return stale
  try {
    return commitSpatialGraphHistoryResult(
      session,
      deleteSpatialSemanticZoomRule(
        session.history,
        session.selection.surfaceId,
        ruleId,
        options.now,
      ),
    )
  } catch (error) {
    return catchSpatialCommand(session, error)
  }
}
