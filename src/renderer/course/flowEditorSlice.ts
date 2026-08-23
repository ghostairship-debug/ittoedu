import { makeAuthoringAddress } from '../../shared/authoringAddress'
import type {
  CourseProjectDocument,
  FlowBlock,
  FlowSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  FLOW_GLOBAL_STRUCTURE_REASON,
  assertUniqueBlockId,
  carrierForFlowBlock,
  findFlowBlockRecursive,
  flowSurfaceIn,
  makeFlowBlockAuthoringAddress,
} from './flowDocumentModel'
import type { EditorTransactionStep } from '../authoring/editorTransaction'
import {
  authoringLegacyHistoryEntryCount,
  authoringHistoryRedoResourceTransition,
  authoringHistoryUndoResourceTransition,
  commitEditorTransactionToAuthoringHistory,
  commitResourceAwareAuthoringHistory,
  createResourceAwareAuthoringHistory,
  isAuthoringHistoryTransactionFrame,
  redoResourceAwareAuthoringHistory,
  RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT,
  undoResourceAwareAuthoringHistory,
  type AuthoringHistoryResourceTransition,
  type AuthoringHistoryTransactionFrame,
  type ResourceAwareAuthoringHistoryEntry,
} from '../authoring/resourceAwareAuthoringHistory'

export type FlowAuthoringScope = 'page' | 'global'
export type FlowEditorFocusKind = 'idle' | 'text' | 'block' | 'overlay'
export type FlowDeleteIntent = 'text-delete' | 'block-delete' | 'overlay-delete' | 'refuse'

export interface FlowTextRange {
  readonly blockId: string
  readonly start: number
  readonly end: number
  readonly listItemId?: string
  readonly tableRowId?: string
  readonly tableColumnId?: string
}

/**
 * Frozen editor-only Flow selection. It is never persisted. `authoringAddress`
 * is always `makeAuthoringAddress` and never a temporary hitId.
 */
export interface FlowEditorSelection {
  readonly locationId: string
  readonly surfaceId: string
  readonly authoringScope: FlowAuthoringScope
  readonly focus: FlowEditorFocusKind
  readonly selectedBlockId: string | null
  readonly selectedBlockIds: readonly string[]
  readonly selectedOverlayIds: readonly string[]
  readonly textRange: FlowTextRange | null
  readonly authoringAddress: string
}

export interface FlowEditorBlockTarget {
  readonly surfaceId: string
  readonly blockId: string
  readonly parentId: string | null
}

export interface FlowEditorHistory {
  readonly present: CourseProjectDocument
  readonly past: readonly FlowEditorHistoryEntry[]
  readonly future: readonly FlowEditorHistoryEntry[]
}

export type FlowEditorTransactionFrame = AuthoringHistoryTransactionFrame
export type FlowEditorHistoryEntry = ResourceAwareAuthoringHistoryEntry
export type FlowEditorResourceTransition = AuthoringHistoryResourceTransition
export const FLOW_EDITOR_HISTORY_LIMIT = RESOURCE_AWARE_AUTHORING_HISTORY_LIMIT

export function isFlowEditorTransactionFrame(
  entry: FlowEditorHistoryEntry,
): entry is FlowEditorTransactionFrame {
  return isAuthoringHistoryTransactionFrame(entry)
}

export function flowEditorLegacyHistoryEntryCount(
  entries: readonly FlowEditorHistoryEntry[],
): number {
  return authoringLegacyHistoryEntryCount(entries)
}

export function createFlowEditorHistory(project: CourseProjectDocument): FlowEditorHistory {
  return createResourceAwareAuthoringHistory(project)
}

export function commitFlowEditorHistory(
  history: FlowEditorHistory,
  next: CourseProjectDocument,
  limit = FLOW_EDITOR_HISTORY_LIMIT,
): FlowEditorHistory {
  if (next === history.present) return history
  return commitResourceAwareAuthoringHistory(history, next, limit)
}

export function commitFlowEditorTransactionHistory(
  history: FlowEditorHistory,
  step: EditorTransactionStep,
  limit = FLOW_EDITOR_HISTORY_LIMIT,
): FlowEditorHistory {
  return commitEditorTransactionToAuthoringHistory(history, step, limit)
}

export function flowEditorUndoResourceTransition(
  history: FlowEditorHistory,
): FlowEditorResourceTransition | undefined {
  return authoringHistoryUndoResourceTransition(history)
}

export function flowEditorRedoResourceTransition(
  history: FlowEditorHistory,
): FlowEditorResourceTransition | undefined {
  return authoringHistoryRedoResourceTransition(history)
}

export function undoFlowEditorHistory(history: FlowEditorHistory): FlowEditorHistory {
  return undoResourceAwareAuthoringHistory(history)
}

export function redoFlowEditorHistory(history: FlowEditorHistory): FlowEditorHistory {
  return redoResourceAwareAuthoringHistory(history)
}

function freezeSelection(selection: FlowEditorSelection): FlowEditorSelection {
  return Object.freeze({
    locationId: selection.locationId,
    surfaceId: selection.surfaceId,
    authoringScope: selection.authoringScope,
    focus: selection.focus,
    selectedBlockId: selection.selectedBlockId,
    selectedBlockIds: Object.freeze([...selection.selectedBlockIds]),
    selectedOverlayIds: Object.freeze([...selection.selectedOverlayIds]),
    textRange: selection.textRange ? Object.freeze({ ...selection.textRange }) : null,
    authoringAddress: selection.authoringAddress,
  })
}

function requireFlowLocation(
  project: CourseProjectDocument,
  locationId: string,
): Extract<CourseProjectDocument['locations'][number], { kind: 'flow-block' }> {
  if (typeof locationId !== 'string' || locationId.trim() === '') {
    throw new Error('课程位置不能为空')
  }
  const matches = project.locations.filter((candidate) => candidate.id === locationId)
  if (matches.length === 0) throw new Error(`找不到课程位置：${locationId}`)
  if (matches.length > 1) throw new Error(`课程位置 ID 重复：${locationId}`)
  const location = matches[0]!
  if (location.kind !== 'flow-block') {
    throw new Error('当前课程位置不是 Flow 内容块，请重新选择')
  }
  return location
}

function resolveBlockTarget(
  surface: FlowSurfaceDocument,
  blockId: string,
): { block: FlowBlock; parentId: string | null } {
  assertUniqueBlockId(surface, blockId)
  const found = findFlowBlockRecursive(surface.blocks, blockId)
  if (!found) throw new Error(`找不到 Flow 块：${blockId}`)
  return { block: found.block, parentId: found.parentId }
}

export function flowBlockTargetFromSelection(
  project: CourseProjectDocument,
  selection: FlowEditorSelection,
  blockId = selection.selectedBlockId,
): FlowEditorBlockTarget {
  if (!blockId) throw new Error('所选 Flow 块不能为空')
  const surface = flowSurfaceIn(project, selection.surfaceId)
  const found = resolveBlockTarget(surface, blockId)
  return {
    surfaceId: selection.surfaceId,
    blockId: found.block.id,
    parentId: found.parentId,
  }
}

export function selectFlowEditorBlock(
  project: CourseProjectDocument,
  locationId: string,
  blockId: string,
): FlowEditorSelection {
  return selectFlowEditorBlocks(project, locationId, [blockId])
}

export function selectFlowEditorBlocks(
  project: CourseProjectDocument,
  locationId: string,
  blockIds: readonly string[],
  options: {
    focus?: Extract<FlowEditorFocusKind, 'block' | 'text'>
    textRange?: FlowTextRange | null
  } = {},
): FlowEditorSelection {
  const location = requireFlowLocation(project, locationId)
  if (blockIds.length === 0) throw new Error('所选 Flow 块不能为空')
  const surface = flowSurfaceIn(project, location.surfaceId)
  const uniqueIds: string[] = []
  const seen = new Set<string>()
  let lastBlock: FlowBlock | null = null
  for (const blockId of blockIds) {
    if (typeof blockId !== 'string' || blockId.trim() === '') {
      throw new Error('所选 Flow 块不能为空')
    }
    if (seen.has(blockId)) throw new Error(`所选 Flow 块重复：${blockId}`)
    seen.add(blockId)
    const found = resolveBlockTarget(surface, blockId)
    uniqueIds.push(found.block.id)
    lastBlock = found.block
  }
  const primary = uniqueIds[uniqueIds.length - 1]!
  const focus = options.focus ?? 'block'
  const textRange = focus === 'text'
    ? (options.textRange ?? { blockId: primary, start: 0, end: 0 })
    : null
  return freezeSelection({
    locationId,
    surfaceId: location.surfaceId,
    authoringScope: 'page',
    focus,
    selectedBlockId: primary,
    selectedBlockIds: uniqueIds,
    selectedOverlayIds: [],
    textRange,
    authoringAddress: makeFlowBlockAuthoringAddress({
      projectId: project.id,
      surfaceId: location.surfaceId,
      blockId: primary,
      field: focus === 'text' ? 'text' : 'block',
      carrier: lastBlock ? carrierForFlowBlock(lastBlock) : 'native',
    }),
  })
}

export function enterFlowTextEditing(
  project: CourseProjectDocument,
  selection: FlowEditorSelection,
  range: FlowTextRange,
): FlowEditorSelection {
  if (selection.authoringScope === 'global') {
    throw new Error(FLOW_GLOBAL_STRUCTURE_REASON)
  }
  return selectFlowEditorBlocks(project, selection.locationId, [range.blockId], {
    focus: 'text',
    textRange: range,
  })
}

export function selectFlowOverlay(
  project: CourseProjectDocument,
  locationId: string,
  overlayIds: readonly string[],
  authoringScope: FlowAuthoringScope = 'page',
): FlowEditorSelection {
  const location = requireFlowLocation(project, locationId)
  if (overlayIds.length === 0) throw new Error('所选浮层不能为空')
  const uniqueIds: string[] = []
  const seen = new Set<string>()
  for (const overlayId of overlayIds) {
    if (typeof overlayId !== 'string' || overlayId.trim() === '') {
      throw new Error('所选浮层不能为空')
    }
    if (seen.has(overlayId)) throw new Error(`所选浮层重复：${overlayId}`)
    seen.add(overlayId)
    uniqueIds.push(overlayId)
  }
  const primary = uniqueIds[uniqueIds.length - 1]!
  const surface = flowSurfaceIn(project, location.surfaceId)
  const surfaceItem = surface.surfaceLayerItems.find((entry) => entry.item.layerItemId === primary)
  const globalItem = project.globalLayerItems.find((entry) => entry.item.layerItemId === primary)
  const item = authoringScope === 'global' ? (globalItem ?? surfaceItem) : (surfaceItem ?? globalItem)
  if (!item) throw new Error(`找不到浮层：${primary}`)
  const scope = authoringScope === 'global' || globalItem?.item.layerItemId === primary
    ? 'global'
    : 'surface'
  return freezeSelection({
    locationId,
    surfaceId: location.surfaceId,
    authoringScope,
    focus: 'overlay',
    selectedBlockId: null,
    selectedBlockIds: [],
    selectedOverlayIds: uniqueIds,
    textRange: null,
    authoringAddress: makeAuthoringAddress({
      projectId: project.id,
      scope,
      surfaceId: scope === 'global' ? undefined : location.surfaceId,
      carrier: item.item.kind === 'component'
        ? 'component'
        : item.item.kind === 'runtime' ? 'runtime' : 'native',
      layerItemId: primary,
      field: 'item',
    }),
  })
}

export function selectFlowGlobalScope(
  project: CourseProjectDocument,
  locationId: string,
  overlayId?: string,
): FlowEditorSelection {
  const location = requireFlowLocation(project, locationId)
  const overlayIds = overlayId
    ? [overlayId]
    : project.globalLayerItems[0]
      ? [project.globalLayerItems[0].item.layerItemId]
      : []
  if (overlayIds.length === 0) {
    return freezeSelection({
      locationId,
      surfaceId: location.surfaceId,
      authoringScope: 'global',
      focus: 'idle',
      selectedBlockId: null,
      selectedBlockIds: [],
      selectedOverlayIds: [],
      textRange: null,
      authoringAddress: makeAuthoringAddress({
        projectId: project.id,
        scope: 'global',
        carrier: 'native',
        layerItemId: locationId,
        field: 'scope',
      }),
    })
  }
  return selectFlowOverlay(project, locationId, overlayIds, 'global')
}

export function classifyFlowDeleteIntent(selection: FlowEditorSelection): {
  intent: FlowDeleteIntent
  reason?: string
} {
  if (selection.authoringScope === 'global' && selection.focus !== 'overlay') {
    return { intent: 'refuse', reason: FLOW_GLOBAL_STRUCTURE_REASON }
  }
  if (selection.focus === 'text') return { intent: 'text-delete' }
  if (selection.focus === 'overlay') return { intent: 'overlay-delete' }
  if (selection.focus === 'block' && selection.selectedBlockIds.length > 0) {
    return { intent: 'block-delete' }
  }
  return { intent: 'refuse', reason: '没有可删除的选择' }
}

export function classifyFlowLayerKind(
  kind: 'document-block' | 'overlay',
): 'document-block' | 'overlay' {
  return kind
}

export function isFlowZOrderLayerBlock(_block: FlowBlock): false {
  return false
}
