import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import type { FormulaAstNode } from '../../../shared/contracts/native-v1'
import {
  captureFlowEditorAuthoringTarget,
  type FlowEditorView,
} from '../../course/flowEditorView'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import {
  deferFlowTextAction,
  finishFlowTextComposition,
  FLOW_TEXT_REJECT_FORMULA_RUNS,
  isFlowTextDraftDirty,
  markFlowTextComposing,
  resolveFlowTextBlur,
  resolveFlowTextHistoryAction,
  updateFlowTextDraft,
  type FlowFormulaDraft,
  type FlowTextEditSession,
} from '../../authoring/flowTextEdit'
import type {
  FlowAuthoringIntent,
  FlowAuthoringReceipt,
} from '../../store/slices/flowAuthoringSlice'

export const FLOW_SELECTION_PRESERVING_SELECTOR = [
  '.flow-block-context-toolbar',
  '[data-flow-selection-preserving-target="true"]',
].join(',')

export function isFlowSelectionPreservingFocusTarget(
  target: EventTarget | null,
  workspace?: HTMLElement | null,
): target is HTMLElement {
  return target instanceof HTMLElement && (
    workspace?.contains(target) === true
    || target.closest(FLOW_SELECTION_PRESERVING_SELECTOR) !== null
  )
}

export interface FlowCurrentSessionCommandPort {
  readonly run: (
    target: CourseAuthoringTarget,
    intent: FlowAuthoringIntent,
  ) => FlowAuthoringReceipt
}

export interface UseFlowTextAuthoringControllerInput {
  readonly view: FlowEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly selection: FlowEditorSelection | null
  readonly readOnly: boolean
  readonly textEdit: FlowTextEditSession | null
  readonly workspaceRef: RefObject<HTMLElement | null>
  readonly commands: FlowCurrentSessionCommandPort
}

export interface FlowTextAuthoringController {
  readonly edit: FlowTextEditSession | null
  readonly editRef: RefObject<FlowTextEditSession | null>
  readonly restyleToken: number
  readonly restyleRange: { readonly start: number; readonly end: number } | null
  readonly formulaBlockId: string | null
  readonly setFormulaBlockId: (blockId: string | null) => void
  readonly bumpRestyle: (range?: { readonly start: number; readonly end: number }) => void
  readonly adoptEditReceipt: (edit: FlowTextEditSession) => void
  readonly setEditState: (next: FlowTextEditSession | null) => void
  readonly commitCurrent: (keepSelected?: boolean, nextBlockId?: string) => void
  readonly cancelCurrent: () => void
  readonly flushOpenTextEdit: () => void
  readonly enterText: (
    blockId: string,
    gesture: 'double-click' | 'enter' | 'click-text',
    extra?: { offset?: number; listItemId?: string; tableRowId?: string; tableColumnId?: string },
  ) => void
  readonly openFormula: (blockId: string) => void
  readonly updateFormulaDraft: (draft: {
    readonly source: string
    readonly ast: FormulaAstNode | null
    readonly accessibleText: string
    readonly committable: boolean
    readonly hasSlots: boolean
  }) => void
  readonly setFormulaComposing: (composing: boolean) => void
  readonly commitFormula: (ast: FormulaAstNode, accessibleText: string) => void
  readonly handleHistoryKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

/**
 * IME/ref state mirrors the single Store-owned edit. Every delayed completion
 * retains the canonical block target captured when editing began.
 */
export function useFlowTextAuthoringController(
  input: UseFlowTextAuthoringControllerInput,
): FlowTextAuthoringController {
  const {
    view,
    sessionToken,
    selection,
    readOnly,
    textEdit,
    workspaceRef,
    commands,
  } = input
  const editRef = useRef<FlowTextEditSession | null>(textEdit)
  const editTargetRef = useRef<CourseAuthoringTarget | null>(null)
  const publishedEditRef = useRef<FlowTextEditSession | null>(null)
  const [restyleRequest, setRestyleRequest] = useState<{
    readonly token: number
    readonly range: { readonly start: number; readonly end: number } | null
  }>({ token: 0, range: null })
  const restyleToken = restyleRequest.token
  const [formulaBlockId, setFormulaBlockId] = useState<string | null>(null)

  const targetForBlock = useCallback((blockId: string) => (
    captureFlowEditorAuthoringTarget({
      view,
      sessionToken,
      target: { kind: 'block', blockId },
    })
  ), [sessionToken, view])

  useEffect(() => {
    const previousEdit = editRef.current
    editRef.current = textEdit
    if (Object.is(publishedEditRef.current, textEdit)) {
      publishedEditRef.current = null
    } else if (!Object.is(previousEdit, textEdit)) {
      setRestyleRequest((request) => ({
        token: request.token + 1,
        range: textEdit ? { ...textEdit.range } : null,
      }))
    }
    if (!textEdit) {
      editTargetRef.current = null
      setFormulaBlockId(null)
      return
    }
    const retainedTarget = editTargetRef.current
    if (
      retainedTarget
      && retainedTarget.itemId === textEdit.blockId
      && retainedTarget.documentRevision === textEdit.revision
    ) {
      return
    }
    if (retainedTarget) return
    if (view.revision !== textEdit.revision) return
    try {
      editTargetRef.current = targetForBlock(textEdit.blockId)
    } catch {
      // A delayed edit must keep its original target and become stale. Never
      // silently bind it to a newer document revision after a render.
    }
  }, [targetForBlock, textEdit, view.revision])

  const bumpRestyle = useCallback((range?: { readonly start: number; readonly end: number }) => {
    setRestyleRequest((request) => ({
      token: request.token + 1,
      range: range ? { ...range } : null,
    }))
  }, [])

  const adoptEditReceipt = useCallback((next: FlowTextEditSession) => {
    // A command-port receipt is already the Store-owned canonical edit. Adopt
    // it synchronously and mark it as published so the prop mirror effect does
    // not schedule a second, late restyle/focus cycle.
    publishedEditRef.current = next
    editRef.current = next
  }, [])

  const setEditState = useCallback((next: FlowTextEditSession | null) => {
    const expectedEdit = editRef.current
    const target = editTargetRef.current
    if (!target || !expectedEdit) return
    const receipt = commands.run(target, {
      kind: 'update-text-edit',
      expectedEdit,
      edit: next,
    })
    if (!receipt.ok) return
    publishedEditRef.current = next
    editRef.current = next
    if (!next) editTargetRef.current = null
  }, [commands])

  useEffect(() => {
    if (readOnly) return
    if (selection?.focus !== 'text' || !selection.selectedBlockId) return
    if (editRef.current?.blockId === selection.selectedBlockId) return
    const target = targetForBlock(selection.selectedBlockId)
    const receipt = commands.run(target, {
      kind: 'begin-text-edit',
      gesture: 'click-text',
      ...(selection.textRange?.start === undefined
        ? {}
        : { offset: selection.textRange.start }),
      ...(selection.textRange?.end === undefined
        ? {}
        : { end: selection.textRange.end }),
      ...(selection.textRange?.listItemId
        ? { listItemId: selection.textRange.listItemId }
        : {}),
      ...(selection.textRange?.tableRowId
        ? { tableRowId: selection.textRange.tableRowId }
        : {}),
      ...(selection.textRange?.tableColumnId
        ? { tableColumnId: selection.textRange.tableColumnId }
        : {}),
    })
    if (!receipt.ok || !receipt.edit) return
    editTargetRef.current = target
    publishedEditRef.current = receipt.edit
    editRef.current = receipt.edit
    bumpRestyle(receipt.edit.range)
  }, [bumpRestyle, commands, readOnly, selection, targetForBlock])

  const commitCurrent = useCallback((keepSelected = true, nextBlockId?: string) => {
    const current = editRef.current
    if (!current) return
    const action = resolveFlowTextBlur({ composing: current.composing, blurReady: true })
    if (action === 'defer') {
      setEditState(deferFlowTextAction(current, 'commit'))
      return
    }
    const target = editTargetRef.current
    if (!target) return
    const receipt = commands.run(target, {
      kind: 'commit-text-edit',
      edit: current,
      keepSelected,
      ...(nextBlockId ? { nextBlockId } : {}),
    })
    if (!receipt.ok) return
    publishedEditRef.current = null
    editRef.current = null
    editTargetRef.current = null
  }, [commands, setEditState])

  const flushOpenTextEdit = useCallback(() => {
    const current = editRef.current
    if (!current) return
    if (current.composing) {
      setEditState(deferFlowTextAction(current, 'commit'))
      return
    }
    commitCurrent(true)
  }, [commitCurrent, setEditState])

  useEffect(() => {
    if (readOnly) return
    const workspace = workspaceRef.current
    const ownerDocument = workspace?.ownerDocument
    if (!workspace || !ownerDocument) return
    let pendingCommit: number | null = null
    const ownerWindow = ownerDocument.defaultView ?? window
    const onFocusOut = (event: FocusEvent) => {
      const scheduledEdit = editRef.current
      if (!scheduledEdit || isFlowSelectionPreservingFocusTarget(event.relatedTarget, workspace)) {
        return
      }
      if (pendingCommit !== null) ownerWindow.clearTimeout(pendingCommit)
      pendingCommit = ownerWindow.setTimeout(() => {
        pendingCommit = null
        if (isFlowSelectionPreservingFocusTarget(ownerDocument.activeElement, workspace)) return
        if (!Object.is(editRef.current, scheduledEdit)) return
        commitCurrent(true)
      }, 0)
    }
    ownerDocument.addEventListener('focusout', onFocusOut)
    return () => {
      ownerDocument.removeEventListener('focusout', onFocusOut)
      if (pendingCommit !== null) ownerWindow.clearTimeout(pendingCommit)
    }
  }, [commitCurrent, readOnly, workspaceRef])

  useEffect(() => {
    if (readOnly) return
    if (
      editRef.current
      && editRef.current.kind !== 'formula'
      && selection?.focus !== 'text'
    ) {
      flushOpenTextEdit()
    }
  }, [flushOpenTextEdit, readOnly, selection])

  const cancelCurrent = useCallback(() => {
    const current = editRef.current
    if (!current) return
    const target = editTargetRef.current
    if (!target) return
    const receipt = commands.run(target, { kind: 'cancel-text-edit', edit: current })
    if (!receipt.ok) return
    publishedEditRef.current = null
    editRef.current = null
    editTargetRef.current = null
    if (current.kind === 'formula') setFormulaBlockId(null)
  }, [commands])

  const openFormula = useCallback((blockId: string) => {
    if (readOnly || selection?.authoringScope === 'global') return
    if (editRef.current?.kind === 'formula' && editRef.current.blockId === blockId) {
      setFormulaBlockId(blockId)
      return
    }
    const target = targetForBlock(blockId)
    const receipt = commands.run(target, { kind: 'begin-formula-edit' })
    if (!receipt.ok || !receipt.edit) return
    editTargetRef.current = target
    publishedEditRef.current = receipt.edit
    editRef.current = receipt.edit
    setFormulaBlockId(blockId)
  }, [commands, readOnly, selection?.authoringScope, targetForBlock])

  const updateFormulaDraft = useCallback((draft: {
    readonly source: string
    readonly ast: FormulaAstNode | null
    readonly accessibleText: string
    readonly committable: boolean
    readonly hasSlots: boolean
  }) => {
    const current = editRef.current
    if (!current || current.kind !== 'formula') return
    const previous = current.draft as FlowFormulaDraft
    setEditState(updateFlowTextDraft(current, {
      ast: draft.ast ?? previous.ast,
      accessibleText: draft.ast ? draft.accessibleText : previous.accessibleText,
      source: draft.source,
      valid: draft.committable,
      hasSlots: draft.hasSlots,
    }))
  }, [setEditState])

  const setFormulaComposing = useCallback((composing: boolean) => {
    const current = editRef.current
    if (!current || current.kind !== 'formula' || current.composing === composing) return
    setEditState(markFlowTextComposing(current, composing))
  }, [setEditState])

  const enterText = useCallback((
    blockId: string,
    gesture: 'double-click' | 'enter' | 'click-text',
    extra?: { offset?: number; listItemId?: string; tableRowId?: string; tableColumnId?: string },
  ) => {
    if (readOnly || selection?.authoringScope === 'global') return
    const target = targetForBlock(blockId)
    const receipt = commands.run(target, {
      kind: 'begin-text-edit',
      gesture,
      ...(extra?.offset === undefined ? {} : { offset: extra.offset }),
      ...(extra?.listItemId ? { listItemId: extra.listItemId } : {}),
      ...(extra?.tableRowId ? { tableRowId: extra.tableRowId } : {}),
      ...(extra?.tableColumnId ? { tableColumnId: extra.tableColumnId } : {}),
    })
    if (!receipt.ok) {
      if (receipt.reason === FLOW_TEXT_REJECT_FORMULA_RUNS) openFormula(blockId)
      return
    }
    if (!receipt.edit) return
    editTargetRef.current = target
    publishedEditRef.current = receipt.edit
    editRef.current = receipt.edit
    bumpRestyle(receipt.edit.range)
  }, [bumpRestyle, commands, openFormula, readOnly, selection?.authoringScope, targetForBlock])

  const commitFormula = useCallback((ast: FormulaAstNode, accessibleText: string) => {
    void ast
    void accessibleText
    // FormulaAuthoringEditor is controlled by the Store-owned edit passed to
    // this render. Do not let an effect/ref mirror become a second source of
    // truth for the Apply button's synchronous action.
    const current = textEdit
    if (!current || current.kind !== 'formula') return
    const draft = current.draft as FlowFormulaDraft
    if (!draft.valid) return
    const target = editTargetRef.current
    if (!target) return
    const receipt = commands.run(target, {
      kind: 'commit-text-edit',
      edit: current,
    })
    if (!receipt.ok) return
    publishedEditRef.current = null
    editRef.current = null
    editTargetRef.current = null
    setFormulaBlockId(null)
  }, [commands, textEdit])

  const handleHistoryKey = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = editRef.current
    if (!current || !(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() !== 'z' && event.key.toLowerCase() !== 'y') return
    const action = event.key.toLowerCase() === 'y'
      || (event.key.toLowerCase() === 'z' && event.shiftKey)
      ? 'redo' as const
      : 'undo' as const
    const resolved = resolveFlowTextHistoryAction({
      composing: current.composing,
      draftDirty: isFlowTextDraftDirty(current),
      action,
    })
    if (resolved === 'ignore' && current.composing) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (resolved === 'cancel') {
      event.preventDefault()
      event.stopPropagation()
      cancelCurrent()
    }
  }, [cancelCurrent])

  return {
    edit: textEdit,
    editRef,
    restyleToken,
    restyleRange: restyleRequest.range,
    formulaBlockId,
    setFormulaBlockId,
    bumpRestyle,
    adoptEditReceipt,
    setEditState,
    commitCurrent,
    cancelCurrent,
    flushOpenTextEdit,
    enterText,
    openFormula,
    updateFormulaDraft,
    setFormulaComposing,
    commitFormula,
    handleHistoryKey,
  }
}

export {
  finishFlowTextComposition,
  markFlowTextComposing,
}
