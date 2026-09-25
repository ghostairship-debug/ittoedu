import { makeAuthoringAddress } from '../../shared/authoringAddress'
import type {
  CourseProjectDocument,
  LayerItem,
} from '../../shared/courseProjectTypes'
import { makeEffectiveLayerAuthoringAddress } from '../../core/tools/layerCommands'
import { locateCourseLayer } from '../course/effectiveLayerCommands'
import { isFlowDocumentBlockId } from '../course/effectiveLayerProjection'
import { isTeacherControllerLayerItem } from '../../core/tools/globalLayers'
import {
  selectFlowGlobalScope,
  selectFlowOverlay,
  type FlowAuthoringScope,
  type FlowEditorSelection,
} from '../course/flowEditorSlice'
import type { FlowOverlayPlacement } from '../course/flowOverlayProjection'

/**
 * Pointer/layer hit for a Flow overlay. `hitId` is ephemeral inspection only
 * and must never be copied into `authoringAddress` or saved.
 */
export interface FlowOverlayPointerHit {
  readonly layerItemId: string
  readonly field?: string
  readonly hitId?: string
}

export interface FlowOverlayAuthoringTarget {
  readonly ok: true
  readonly layerItemId: string
  readonly source: 'global' | 'surface'
  readonly authoringScope: FlowAuthoringScope
  readonly authoringAddress: string
  readonly field: string
  readonly placement: FlowOverlayPlacement
  readonly isTeacherController: boolean
  readonly ephemeralHitId?: string
}

export interface FlowOverlayAuthoringMiss {
  readonly ok: false
  readonly reason: string
}

export type FlowOverlayAuthoringResolve =
  | FlowOverlayAuthoringTarget
  | FlowOverlayAuthoringMiss

export const FLOW_DOCUMENT_HIT_NOT_OVERLAY_REASON = '这是文档块，不是浮层，不能写入图层'
export const FLOW_TEACHER_CONTROLLER_PLACEMENT: FlowOverlayPlacement = 'viewport-overlay'

export function flowOverlayPlacementForItem(item: LayerItem): FlowOverlayPlacement {
  return 'viewport-overlay'
}

export function isFlowTeacherControllerViewportOverlay(item: LayerItem): boolean {
  return isTeacherControllerLayerItem(item)
}

/**
 * Resolve a canvas/layer hit to a persistable overlay authoring target.
 * Clicking a global item (including the teacher controller) enters global scope.
 */
export function resolveFlowOverlayAuthoringTarget(
  project: CourseProjectDocument,
  locationId: string,
  hit: FlowOverlayPointerHit,
): FlowOverlayAuthoringResolve {
  if (!locationId.trim()) {
    return { ok: false, reason: '请先选择一个流式页面' }
  }
  if (!hit.layerItemId.trim()) {
    return { ok: false, reason: '所选浮层不能为空' }
  }
  if (isFlowDocumentBlockId(project, hit.layerItemId)) {
    return { ok: false, reason: FLOW_DOCUMENT_HIT_NOT_OVERLAY_REASON }
  }
  const located = locateCourseLayer(project, hit.layerItemId)
  if (!located || (located.source !== 'global' && located.source !== 'surface')) {
    return { ok: false, reason: `找不到浮层：${hit.layerItemId}` }
  }
  const field = hit.field?.trim() || 'item'
  const authoringAddress = makeEffectiveLayerAuthoringAddress(
    project.id,
    located,
    field,
  )
  if (authoringAddress.includes('hitId') || (hit.hitId && authoringAddress.includes(hit.hitId))) {
    return { ok: false, reason: '作者地址不能包含临时命中 id' }
  }
  const authoringScope: FlowAuthoringScope = located.source === 'global' ? 'global' : 'page'
  return {
    ok: true,
    layerItemId: located.item.layerItemId,
    source: located.source,
    authoringScope,
    authoringAddress,
    field,
    placement: flowOverlayPlacementForItem(located.item),
    isTeacherController: isTeacherControllerLayerItem(located.item),
    ...(hit.hitId ? { ephemeralHitId: hit.hitId } : {}),
  }
}

export function persistableFlowOverlayAddress(
  target: FlowOverlayAuthoringTarget,
): string {
  return target.authoringAddress
}

export function selectFlowAuthoringFromOverlayHit(
  project: CourseProjectDocument,
  locationId: string,
  hit: FlowOverlayPointerHit,
): { ok: true; selection: FlowEditorSelection } | FlowOverlayAuthoringMiss {
  const resolved = resolveFlowOverlayAuthoringTarget(project, locationId, hit)
  if (!resolved.ok) return resolved
  try {
    const selection = resolved.authoringScope === 'global'
      ? selectFlowOverlay(project, locationId, [resolved.layerItemId], 'global')
      : selectFlowOverlay(project, locationId, [resolved.layerItemId], 'page')
    if (selection.authoringAddress !== resolved.authoringAddress && resolved.field === 'item') {
      /* selectFlowOverlay always uses field:item; a more specific field stays on the target. */
    }
    if (resolved.ephemeralHitId && selection.authoringAddress.includes(resolved.ephemeralHitId)) {
      return { ok: false, reason: '作者地址不能包含临时命中 id' }
    }
    return { ok: true, selection }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : '无法选择浮层',
    }
  }
}

export function enterFlowGlobalAuthoringScope(
  project: CourseProjectDocument,
  locationId: string,
  overlayId?: string,
): FlowEditorSelection {
  return selectFlowGlobalScope(project, locationId, overlayId)
}

export function makeFlowGlobalScopeAddress(projectId: string, locationId: string): string {
  return makeAuthoringAddress({
    projectId,
    scope: 'global',
    carrier: 'native',
    layerItemId: locationId,
    field: 'scope',
  })
}
