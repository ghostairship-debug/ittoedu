import type { CourseSurfaceType } from '../../shared/courseProjectTypes'

/** Minimal action ids aligned with product shortcuts; extend donor ids, do not fork. */
export const EDITOR_ACTION_IDS = [
  'select-all',
  'copy',
  'cut',
  'paste',
  'duplicate',
  'delete',
  'undo',
  'redo',
] as const

export type EditorActionId = (typeof EDITOR_ACTION_IDS)[number]

export const EDITOR_WRITE_ACTION_IDS = [
  'cut',
  'duplicate',
  'delete',
] as const satisfies readonly EditorActionId[]

export type EditorWriteActionId = (typeof EDITOR_WRITE_ACTION_IDS)[number]

export type EditorSurfaceKind = Extract<CourseSurfaceType, 'slide' | 'flow' | 'spatial-2d'>

export type EditorAuthoringScope = 'location' | 'global'

export type EditorFocusKind = 'none' | 'text' | 'block' | 'overlay' | 'layer'

export interface EditorSelectionItem {
  readonly itemId: string
  readonly locked?: boolean
}

export interface EditorTextRangeSnapshot {
  readonly blockId: string
  readonly start: number
  readonly end: number
  readonly listItemId?: string
  readonly tableRowId?: string
  readonly tableColumnId?: string
}

export interface EditorSelectionSnapshot {
  readonly locationId: string
  readonly revision: number
  readonly sessionGeneration: number
  readonly surfaceKind: EditorSurfaceKind
  /** Active Slide named state. Null for base Slide, Flow, and Spatial editing. */
  readonly stateId?: string | null
  readonly scope: EditorAuthoringScope
  readonly focus: EditorFocusKind
  /** Exact Flow text caret/range. Null for non-text selections and non-Flow surfaces. */
  readonly textRange?: EditorTextRangeSnapshot | null
  readonly itemIds: readonly string[]
  readonly items?: readonly EditorSelectionItem[]
}

export interface EditorActionAdapterResult {
  readonly ok: boolean
  readonly reason: string
}

export type EditorActionAdapterKind = 'global' | 'slide' | 'flow' | 'spatial'

export interface EditorActionResult extends EditorActionAdapterResult {
  readonly actionId: EditorActionId
  readonly adapter: EditorActionAdapterKind | 'none'
  readonly flowDeleteRoute?: FlowDeleteRoute
}

export interface EditorActionAdapter {
  execute(
    actionId: EditorActionId,
    snapshot: EditorSelectionSnapshot,
  ): EditorActionAdapterResult
}

export interface EditorActionAdapters {
  readonly global?: EditorActionAdapter
  readonly slide?: EditorActionAdapter
  readonly flow?: EditorActionAdapter
  readonly spatial?: EditorActionAdapter
}

export type FlowDeleteRoute = 'document' | 'overlay' | 'refuse'

const WRITE_ACTION_SET = new Set<EditorActionId>(EDITOR_WRITE_ACTION_IDS)

const ACTION_VERBS: Record<EditorActionId, string> = {
  'select-all': '全选',
  copy: '复制',
  cut: '剪切',
  paste: '粘贴',
  duplicate: '重复',
  delete: '删除',
  undo: '撤销',
  redo: '重做',
}

export const EDITOR_TEXT_FOCUS_LAYER_DELETE_REASON =
  '文字编辑中，Delete/Backspace 只编辑文本，不删除元素'

export const EDITOR_LOCKED_WRITE_REASON = '锁定元素不能执行此操作；请先解锁'

export function isEditorWriteAction(actionId: EditorActionId): boolean {
  return WRITE_ACTION_SET.has(actionId)
}

export function isTextEditorFocus(focus: EditorFocusKind): boolean {
  return focus === 'text'
}

export function createEditorSelectionSnapshot(
  input: EditorSelectionSnapshot,
): EditorSelectionSnapshot {
  if (!input.locationId.trim()) throw new TypeError('locationId 不能为空')
  if (!Number.isInteger(input.revision) || input.revision < 0) {
    throw new TypeError('revision 必须是非负整数')
  }
  if (!Number.isInteger(input.sessionGeneration) || input.sessionGeneration < 0) {
    throw new TypeError('sessionGeneration 必须是非负整数')
  }
  const itemIds = Object.freeze([...(input.itemIds ?? [])])
  const items = input.items
    ? Object.freeze(input.items.map((item) => Object.freeze({ ...item })))
    : undefined
  const textRange = input.textRange
    ? Object.freeze({ ...input.textRange })
    : null
  return Object.freeze({
    ...input,
    textRange,
    itemIds,
    items,
  })
}

export function describeEditorAction(actionId: EditorActionId): string {
  return ACTION_VERBS[actionId]
}

export function snapshotHasLockedWriteTarget(
  snapshot: EditorSelectionSnapshot,
): boolean {
  const items = snapshot.items
  if (!items || items.length === 0) return false
  const lockedIds = new Set(
    items.filter((item) => item.locked).map((item) => item.itemId),
  )
  return snapshot.itemIds.some((itemId) => lockedIds.has(itemId))
}
