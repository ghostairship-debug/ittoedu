import { shouldIgnoreSlideLayerDeleteForFocus } from './v9SlideActionCommands'
import {
  EDITOR_LOCKED_WRITE_REASON,
  EDITOR_TEXT_FOCUS_LAYER_DELETE_REASON,
  createEditorSelectionSnapshot,
  describeEditorAction,
  isEditorWriteAction,
  isTextEditorFocus,
  snapshotHasLockedWriteTarget,
  type EditorActionAdapter,
  type EditorActionAdapterKind,
  type EditorActionAdapterResult,
  type EditorActionAdapters,
  type EditorActionId,
  type EditorActionResult,
  type EditorSelectionSnapshot,
  type FlowDeleteRoute,
} from './editorActionTypes'

export {
  EDITOR_ACTION_IDS,
  EDITOR_LOCKED_WRITE_REASON,
  EDITOR_TEXT_FOCUS_LAYER_DELETE_REASON,
  EDITOR_WRITE_ACTION_IDS,
  createEditorSelectionSnapshot,
  describeEditorAction,
  isEditorWriteAction,
  isTextEditorFocus,
  type EditorActionAdapter,
  type EditorActionAdapters,
  type EditorActionId,
  type EditorActionResult,
  type EditorAuthoringScope,
  type EditorFocusKind,
  type EditorSelectionItem,
  type EditorSelectionSnapshot,
  type EditorSurfaceKind,
  type FlowDeleteRoute,
} from './editorActionTypes'

export function resolveEditorAdapterKind(
  snapshot: EditorSelectionSnapshot,
): EditorActionAdapterKind {
  if (snapshot.scope === 'global') return 'global'
  if (snapshot.surfaceKind === 'spatial-2d') return 'spatial'
  return snapshot.surfaceKind
}

/**
 * Flow delete sub-route for adapter wiring:
 * - text/block -> executeFlowDelete document semantics
 * - overlay -> executeFlowSharedDelete overlay semantics
 */
export function resolveFlowDeleteRoute(
  snapshot: EditorSelectionSnapshot,
): FlowDeleteRoute {
  if (snapshot.scope === 'global' && snapshot.focus !== 'overlay') {
    return 'refuse'
  }
  if (snapshot.focus === 'text' || snapshot.focus === 'block') return 'document'
  if (snapshot.focus === 'overlay') return 'overlay'
  return 'refuse'
}

export function isEditorTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    Boolean(target.isContentEditable)
  )
}

export function isEditorInteractiveControlTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('button, [role="button"], [role="menuitem"], [role="option"]'),
  )
}

export type KeyboardDeleteDisposition =
  | { readonly action: 'ignore' }
  | { readonly action: 'route'; readonly snapshot: EditorSelectionSnapshot }
  | { readonly action: 'legacy-delete' }

export interface KeyboardDeleteSessionSnapshot {
  readonly hasCourseProject: boolean
  readonly selection: EditorSelectionSnapshot | null
  readonly contentEditable: boolean
  readonly hasFlowSession: boolean
  readonly flowComposing: boolean
  readonly flowTextFocus: boolean
  readonly flowHasSelection: boolean
  readonly hasSlideBackend: boolean
  readonly slideTextEdit: boolean
  readonly slideFormulaEdit: boolean
  readonly slideTagName?: string
  readonly selectedNodeCount: number
  readonly editingText: boolean
}

/**
 * Delete routing for the App keyboard router. Surface forks live here so
 * App.tsx only supplies a captured session snapshot.
 */
export function resolveKeyboardDeleteDisposition(
  snapshot: KeyboardDeleteSessionSnapshot,
): KeyboardDeleteDisposition {
  if (snapshot.hasCourseProject) {
    if (!snapshot.selection) return { action: 'ignore' }
    if (snapshot.selection.focus === 'text' && snapshot.contentEditable) {
      return { action: 'ignore' }
    }
    return { action: 'route', snapshot: snapshot.selection }
  }
  if (snapshot.hasFlowSession) {
    if (
      snapshot.flowComposing
      || snapshot.flowTextFocus
      || snapshot.contentEditable
    ) {
      return { action: 'ignore' }
    }
    return snapshot.flowHasSelection
      ? { action: 'legacy-delete' }
      : { action: 'ignore' }
  }
  if (snapshot.hasSlideBackend) {
    if (shouldIgnoreSlideLayerDeleteForFocus({
      textEditSession: snapshot.slideTextEdit,
      formulaEditSession: snapshot.slideFormulaEdit,
      tagName: snapshot.slideTagName,
      isContentEditable: snapshot.contentEditable,
    })) {
      return { action: 'ignore' }
    }
    return snapshot.selectedNodeCount > 0
      ? { action: 'legacy-delete' }
      : { action: 'ignore' }
  }
  if (snapshot.selectedNodeCount > 0 && !snapshot.editingText) {
    return { action: 'legacy-delete' }
  }
  return { action: 'ignore' }
}

export function shouldRefuseLayerDeleteForTextFocus(
  snapshot: EditorSelectionSnapshot,
  actionId: EditorActionId,
): boolean {
  if (actionId !== 'delete') return false
  if (!isTextEditorFocus(snapshot.focus)) return false
  // Flow inline text uses document delete semantics via executeFlowDelete.
  if (snapshot.surfaceKind === 'flow' && snapshot.scope === 'location') return false
  return true
}

export function resolveEditorActionAvailability(
  actionId: EditorActionId,
  snapshot: EditorSelectionSnapshot,
): EditorActionAdapterResult {
  if (shouldRefuseLayerDeleteForTextFocus(snapshot, actionId)) {
    return {
      ok: false,
      reason: EDITOR_TEXT_FOCUS_LAYER_DELETE_REASON,
    }
  }

  if (
    isEditorWriteAction(actionId) &&
    actionId !== 'delete' &&
    isTextEditorFocus(snapshot.focus)
  ) {
    return {
      ok: false,
      reason: `文字编辑中，不能${describeEditorAction(actionId)}元素`,
    }
  }

  if (isEditorWriteAction(actionId) && snapshotHasLockedWriteTarget(snapshot)) {
    return {
      ok: false,
      reason: EDITOR_LOCKED_WRITE_REASON,
    }
  }

  if (actionId === 'delete') {
    if (snapshot.surfaceKind === 'flow') {
      const route = resolveFlowDeleteRoute(snapshot)
      if (route === 'refuse') {
        return { ok: false, reason: '没有可删除的选择' }
      }
      if (route === 'overlay' && snapshot.itemIds.length === 0) {
        return { ok: false, reason: '没有可删除的选择' }
      }
    } else if (snapshot.itemIds.length === 0 && snapshot.scope !== 'global') {
      return { ok: false, reason: '没有可删除的选择' }
    }
  }

  if (
    (actionId === 'copy' || actionId === 'cut' || actionId === 'duplicate') &&
    snapshot.itemIds.length === 0 &&
    snapshot.scope !== 'global'
  ) {
    return { ok: false, reason: `没有可${describeEditorAction(actionId)}的选择` }
  }

  return { ok: true, reason: `${describeEditorAction(actionId)}当前选择` }
}

export function routeEditorAction(input: {
  readonly actionId: EditorActionId
  readonly snapshot: EditorSelectionSnapshot
  readonly adapters: EditorActionAdapters
}): EditorActionResult {
  const availability = resolveEditorActionAvailability(input.actionId, input.snapshot)
  if (!availability.ok) {
    return {
      actionId: input.actionId,
      ok: false,
      reason: availability.reason,
      adapter: 'none',
      flowDeleteRoute: input.snapshot.surfaceKind === 'flow' && input.actionId === 'delete'
        ? resolveFlowDeleteRoute(input.snapshot)
        : undefined,
    }
  }

  const adapterKind = resolveEditorAdapterKind(input.snapshot)
  const adapter = input.adapters[adapterKind]
  if (!adapter) {
    return {
      actionId: input.actionId,
      ok: false,
      reason: adapterKind === 'global'
        ? '尚未接入全局层动作适配器'
        : `尚未接入 ${adapterKind} 动作适配器`,
      adapter: 'none',
      flowDeleteRoute: input.snapshot.surfaceKind === 'flow' && input.actionId === 'delete'
        ? resolveFlowDeleteRoute(input.snapshot)
        : undefined,
    }
  }

  const flowDeleteRoute = input.snapshot.surfaceKind === 'flow' && input.actionId === 'delete'
    ? resolveFlowDeleteRoute(input.snapshot)
    : undefined

  try {
    const result = adapter.execute(input.actionId, input.snapshot)
    return finalizeAdapterResult(input.actionId, adapterKind, result, flowDeleteRoute)
  } catch (error) {
    return {
      actionId: input.actionId,
      ok: false,
      adapter: adapterKind,
      reason: error instanceof Error && error.message.trim()
        ? error.message
        : `${describeEditorAction(input.actionId)}失败`,
      flowDeleteRoute,
    }
  }
}

function finalizeAdapterResult(
  actionId: EditorActionId,
  adapter: EditorActionAdapterKind,
  result: EditorActionAdapterResult | null | undefined,
  flowDeleteRoute?: FlowDeleteRoute,
): EditorActionResult {
  if (!result || typeof result.ok !== 'boolean' || !result.reason?.trim()) {
    return {
      actionId,
      ok: false,
      adapter,
      reason: '适配器未返回明确结果',
      flowDeleteRoute,
    }
  }
  return {
    actionId,
    ok: result.ok,
    adapter,
    reason: result.reason,
    flowDeleteRoute,
  }
}
