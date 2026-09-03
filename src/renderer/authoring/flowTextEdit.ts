import { applyTextRunStyle, remapTextRuns, toggleTextRunEmphasis } from '../../shared/textRuns'
import { formulaAstToAccessibleText, serializeFormulaAst } from '../../shared/formulaLinear'
import type { FormulaAstNode, FormulaNode, TextRun, TextRunStyle } from '../../shared/contracts/native-v1'
import type {
  CourseProjectDocument,
  FlowBlock,
  FlowFormulaBlock,
  FlowRichText,
  FlowTableCell,
} from '../../shared/courseProjectTypes'
import {
  applyFlowCommittedText,
  executeFlowEditorCommand,
  formatFlowEditorBlock,
  updateFlowEditorBlock,
  type FlowCommandOptions,
  type FlowCommandResult,
} from '../course/flowEditorCommands'
import {
  enterFlowTextEditing,
  flowBlockTargetFromSelection,
  selectFlowEditorBlocks,
  type FlowEditorSelection,
  type FlowTextRange,
} from '../course/flowEditorSlice'
import { isRichTextFlowBlock } from '../course/flowDocumentModel'

export const FLOW_TEXT_REJECT_COMPOSING = 'composing'
export const FLOW_TEXT_REJECT_NOT_EDITABLE = '当前块不能就地编辑文字'
export const FLOW_TEXT_REJECT_FORMULA_RUNS = '公式请使用公式编辑器'
export const FLOW_TEXT_REJECT_NO_SELECTION = '没有可设置格式的选区'
export const FLOW_DEFAULT_HIGHLIGHT = '#fff3a3'
export const FLOW_PAPER_TEXT_COLOR = '#1f2937'

export type FlowTextEditKind = 'rich-text' | 'plain-string' | 'formula'
export type FlowTextEditSource = 'paper' | 'properties'
export type FlowTextEditAction = 'commit' | 'cancel' | 'ignore' | 'defer'
export type FlowTextEditGesture = 'double-click' | 'enter' | 'click-text'
export type FlowPlainTextField = 'code' | 'body' | 'title'

export interface FlowRichTextDraft {
  readonly text: string
  readonly runs: TextRun[]
}

export interface FlowPlainTextDraft {
  readonly text: string
}

export interface FlowFormulaDraft {
  readonly ast: FormulaAstNode
  readonly accessibleText: string
  /** Raw linear input is Store-owned so save/recovery never races a local dialog draft. */
  readonly source: string
  readonly valid: boolean
  readonly hasSlots: boolean
}

export interface FlowTextEditSession {
  readonly kind: FlowTextEditKind
  readonly source: FlowTextEditSource
  readonly blockId: string
  readonly surfaceId: string
  readonly parentId: string | null
  readonly listItemId?: string
  readonly tableRowId?: string
  readonly tableColumnId?: string
  readonly field: 'text' | FlowPlainTextField | 'formula'
  readonly composing: boolean
  readonly pendingAction: Exclude<FlowTextEditAction, 'ignore' | 'defer'> | null
  readonly revision: number
  readonly original: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft
  readonly draft: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft
  readonly range: { start: number; end: number }
}

export type BeginFlowTextEditResult = {
  readonly ok: true
  readonly selection: FlowEditorSelection
  readonly edit: FlowTextEditSession
} | {
  readonly ok: false
  readonly reason: string
}

export interface FlowTextCommandResult extends FlowCommandResult {
  readonly nextEdit?: FlowTextEditSession | null
  readonly nextSelection?: FlowEditorSelection
}

export type FlowSelectionFormatMode = 'caret' | 'range' | 'whole-block'

export type FlowSelectionFormatField<T> =
  | { readonly state: 'unset' }
  | { readonly state: 'uniform'; readonly value: T }
  | { readonly state: 'mixed' }

export interface FlowSelectionFormat {
  readonly mode: FlowSelectionFormatMode
  readonly start: number
  readonly end: number
  readonly richText: boolean
  /** A collapsed caret is display-only until the editor supports pending typing styles. */
  readonly canApplyInlineStyle: boolean
  readonly hasMixedValue: boolean
  readonly fields: {
    readonly fontFamily: FlowSelectionFormatField<string>
    readonly fontSize: FlowSelectionFormatField<number>
    readonly color: FlowSelectionFormatField<string>
    readonly bold: FlowSelectionFormatField<boolean>
    readonly italic: FlowSelectionFormatField<boolean>
    readonly underline: FlowSelectionFormatField<boolean>
    readonly strike: FlowSelectionFormatField<boolean>
    readonly emphasis: FlowSelectionFormatField<boolean>
    readonly highlightColor: FlowSelectionFormatField<string | null>
  }
}

const FLOW_SELECTION_FORMAT_KEYS = [
  'fontFamily',
  'fontSize',
  'color',
  'bold',
  'italic',
  'underline',
  'strike',
  'emphasis',
  'highlightColor',
] as const satisfies readonly (keyof TextRunStyle)[]

function unsetFlowSelectionFormatFields(): FlowSelectionFormat['fields'] {
  return {
    fontFamily: { state: 'unset' },
    fontSize: { state: 'unset' },
    color: { state: 'unset' },
    bold: { state: 'unset' },
    italic: { state: 'unset' },
    underline: { state: 'unset' },
    strike: { state: 'unset' },
    emphasis: { state: 'unset' },
    highlightColor: { state: 'unset' },
  }
}

function flowCharacterStyles(text: string, runs: readonly TextRun[]): TextRunStyle[] {
  const length = Array.from(text).length
  const styles = Array.from({ length }, (): TextRunStyle => ({}))
  for (const run of runs) {
    const start = Math.max(0, Math.min(length, Math.floor(run.start)))
    const end = Math.max(start, Math.min(length, Math.floor(run.end)))
    for (let index = start; index < end; index += 1) {
      Object.assign(styles[index], run.style)
    }
  }
  return styles
}

function deriveFlowSelectionFormatField<K extends keyof FlowSelectionFormat['fields']>(
  styles: readonly TextRunStyle[],
  key: K,
): FlowSelectionFormat['fields'][K] {
  if (styles.length === 0) return { state: 'unset' } as FlowSelectionFormat['fields'][K]
  const first = styles[0][key]
  for (let index = 1; index < styles.length; index += 1) {
    if (!Object.is(styles[index][key], first)) {
      return { state: 'mixed' } as FlowSelectionFormat['fields'][K]
    }
  }
  return first === undefined
    ? { state: 'unset' } as FlowSelectionFormat['fields'][K]
    : { state: 'uniform', value: first } as FlowSelectionFormat['fields'][K]
}

/**
 * The single read adapter for Flow inline-format UI. It derives sparse run
 * values directly from the live draft while editing, or from the selected
 * block when idle; it never creates a parallel toolbar formatting state.
 */
export function deriveFlowSelectionFormat(input: {
  readonly block: FlowBlock
  readonly edit?: FlowTextEditSession | null
}): FlowSelectionFormat {
  const activeEdit = input.edit?.blockId === input.block.id ? input.edit : null
  const mode: FlowSelectionFormatMode = activeEdit?.kind === 'rich-text'
    ? activeEdit.range.end > activeEdit.range.start ? 'range' : 'caret'
    : 'whole-block'
  const content = activeEdit?.kind === 'rich-text'
    ? activeEdit.draft as FlowRichTextDraft
    : isRichTextFlowBlock(input.block)
      ? { text: input.block.text, runs: input.block.runs ?? [] }
      : null
  if (!content) {
    return {
      mode,
      start: 0,
      end: 0,
      richText: false,
      canApplyInlineStyle: false,
      hasMixedValue: false,
      fields: unsetFlowSelectionFormatFields(),
    }
  }

  const length = Array.from(content.text).length
  const start = mode === 'whole-block'
    ? 0
    : Math.max(0, Math.min(length, activeEdit?.range.start ?? 0))
  const end = mode === 'whole-block'
    ? length
    : Math.max(start, Math.min(length, activeEdit?.range.end ?? start))
  const characterStyles = flowCharacterStyles(content.text, content.runs)
  const sampledStyles = mode === 'caret'
    ? length === 0
      ? []
      : [characterStyles[start === 0 ? 0 : Math.min(length - 1, start - 1)]]
    : characterStyles.slice(start, end)
  const fields = unsetFlowSelectionFormatFields()
  for (const key of FLOW_SELECTION_FORMAT_KEYS) {
    Object.assign(fields, { [key]: deriveFlowSelectionFormatField(sampledStyles, key) })
  }
  return {
    mode,
    start,
    end,
    richText: true,
    canApplyInlineStyle: mode !== 'caret' && end > start,
    hasMixedValue: Object.values(fields).some((field) => field.state === 'mixed'),
    fields,
  }
}

function freezeEdit(edit: FlowTextEditSession): FlowTextEditSession {
  return Object.freeze({
    ...edit,
    original: Object.freeze(structuredClone(edit.original)),
    draft: Object.freeze(structuredClone(edit.draft)),
    range: Object.freeze({ ...edit.range }),
  })
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function failCommand(reason: string, extra: Partial<FlowTextCommandResult> = {}): FlowTextCommandResult {
  return { ok: false, reason, historyEntry: false, ...extra }
}

function identityDocument(
  document: CourseProjectDocument,
  extra: Partial<FlowTextCommandResult> = {},
): FlowTextCommandResult {
  return { ok: true, nextDocument: document, historyEntry: false, ...extra }
}

export function isFlowRangeEditableBlock(block: FlowBlock): boolean {
  return isRichTextFlowBlock(block) || block.type === 'list' || block.type === 'table'
}

export function isFlowPlainStringBlock(block: FlowBlock): boolean {
  return block.type === 'code' || block.type === 'callout' || block.type === 'section'
}

export function isFlowFormulaBlock(block: FlowBlock): block is FlowFormulaBlock {
  return block.type === 'formula'
}

export function cellToRichText(cell: FlowTableCell | undefined): FlowRichText {
  if (cell === undefined) return { text: '' }
  if (typeof cell === 'string') return { text: cell }
  return { text: cell.text, ...(cell.runs ? { runs: cell.runs } : {}) }
}

export function readFlowEditableContent(
  block: FlowBlock,
  nested?: Pick<FlowTextRange, 'listItemId' | 'tableRowId' | 'tableColumnId'>,
): {
  kind: FlowTextEditKind
  field: FlowTextEditSession['field']
  content: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft
} | null {
  if (isFlowFormulaBlock(block)) {
    return {
      kind: 'formula',
      field: 'formula',
      content: {
        ast: structuredClone(block.ast),
        accessibleText: block.accessibleText,
        source: serializeFormulaAst(block.ast),
        valid: true,
        hasSlots: false,
      },
    }
  }
  if (block.type === 'code') {
    return { kind: 'plain-string', field: 'code', content: { text: block.code } }
  }
  if (block.type === 'callout') {
    return { kind: 'plain-string', field: 'body', content: { text: block.body } }
  }
  if (block.type === 'section') {
    return { kind: 'plain-string', field: 'title', content: { text: block.title } }
  }
  if (block.type === 'list' && nested?.listItemId) {
    const item = block.items.find((entry) => entry.id === nested.listItemId)
    if (!item) return null
    return {
      kind: 'rich-text',
      field: 'text',
      content: { text: item.text, runs: structuredClone(item.runs ?? []) },
    }
  }
  if (block.type === 'table' && nested?.tableRowId && nested.tableColumnId) {
    const row = block.rows.find((entry) => entry.id === nested.tableRowId)
    if (!row) return null
    const rich = cellToRichText(row.cells[nested.tableColumnId])
    return {
      kind: 'rich-text',
      field: 'text',
      content: { text: rich.text, runs: structuredClone(rich.runs ?? []) },
    }
  }
  if (isRichTextFlowBlock(block)) {
    return {
      kind: 'rich-text',
      field: 'text',
      content: { text: block.text, runs: structuredClone(block.runs ?? []) },
    }
  }
  return null
}

export function resolveFlowFormatRange(
  text: string,
  range?: { start: number; end: number } | 'all' | null,
): { start: number; end: number } {
  const length = Array.from(text).length
  if (range === 'all' || range == null) return { start: 0, end: length }
  const start = Math.max(0, Math.min(length, range.start))
  const end = Math.max(start, Math.min(length, range.end))
  return { start, end }
}

export function flowFormulaBlockToAuthoringNode(block: {
  readonly id: string
  readonly formulaId: string
  readonly accessibleText: string
  readonly ast: FormulaAstNode
}): FormulaNode {
  return {
    id: block.id,
    name: '公式',
    type: 'formula',
    x: 0,
    y: 0,
    width: 420,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    formulaId: block.formulaId,
    accessibleText: block.accessibleText,
    ast: structuredClone(block.ast),
    style: { fontSize: 24, color: FLOW_PAPER_TEXT_COLOR, align: 'left' },
  }
}

function locateBlock(project: CourseProjectDocument, surfaceId: string, blockId: string): FlowBlock | null {
  const surface = project.surfaces.find((entry) => entry.id === surfaceId)
  if (!surface || surface.type !== 'flow') return null
  const visit = (blocks: readonly FlowBlock[]): FlowBlock | null => {
    for (const block of blocks) {
      if (block.id === blockId) return block
      if (block.type === 'section') {
        const nested = visit(block.blocks)
        if (nested) return nested
      }
    }
    return null
  }
  return visit(surface.blocks)
}

export function beginFlowTextEdit(input: {
  readonly project: CourseProjectDocument
  readonly selection: FlowEditorSelection
  readonly blockId: string
  readonly source?: FlowTextEditSource
  readonly range?: FlowTextRange
}): BeginFlowTextEditResult {
  const block = locateBlock(input.project, input.selection.surfaceId, input.blockId)
  if (!block) return { ok: false, reason: FLOW_TEXT_REJECT_NOT_EDITABLE }
  if (isFlowFormulaBlock(block)) {
    return { ok: false, reason: FLOW_TEXT_REJECT_FORMULA_RUNS }
  }
  const nested = input.range
    ? {
      listItemId: input.range.listItemId,
      tableRowId: input.range.tableRowId,
      tableColumnId: input.range.tableColumnId,
    }
    : undefined
  const readable = readFlowEditableContent(block, nested)
  if (!readable || readable.kind === 'formula') {
    return { ok: false, reason: FLOW_TEXT_REJECT_NOT_EDITABLE }
  }
  const length = readable.kind === 'rich-text'
    ? Array.from((readable.content as FlowRichTextDraft).text).length
    : Array.from((readable.content as FlowPlainTextDraft).text).length
  const start = input.range?.start ?? 0
  const end = input.range?.end ?? start
  const clamped = {
    start: Math.max(0, Math.min(length, start)),
    end: Math.max(0, Math.min(length, end)),
  }
  try {
    const selection = enterFlowTextEditing(input.project, input.selection, {
      blockId: input.blockId,
      start: clamped.start,
      end: clamped.end,
      ...(nested?.listItemId ? { listItemId: nested.listItemId } : {}),
      ...(nested?.tableRowId ? { tableRowId: nested.tableRowId } : {}),
      ...(nested?.tableColumnId ? { tableColumnId: nested.tableColumnId } : {}),
    })
    const target = flowBlockTargetFromSelection(input.project, selection)
    const original = structuredClone(readable.content)
    return {
      ok: true,
      selection,
      edit: freezeEdit({
        kind: readable.kind,
        source: input.source ?? 'paper',
        blockId: input.blockId,
        surfaceId: target.surfaceId,
        parentId: target.parentId,
        listItemId: nested?.listItemId,
        tableRowId: nested?.tableRowId,
        tableColumnId: nested?.tableColumnId,
        field: readable.field,
        composing: false,
        pendingAction: null,
        revision: input.project.revision,
        original,
        draft: structuredClone(original),
        range: clamped,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error && error.message.trim() ? error.message : FLOW_TEXT_REJECT_NOT_EDITABLE,
    }
  }
}

/**
 * Double-click, Enter on a selected block, and a second click on its text
 * all enter in-place editing through `enterFlowTextEditing`.
 */
export function applyFlowTextEditGesture(input: {
  readonly project: CourseProjectDocument
  readonly selection: FlowEditorSelection
  readonly blockId: string
  readonly gesture: FlowTextEditGesture
  readonly locationId?: string
  readonly offset?: number
  readonly end?: number
  readonly listItemId?: string
  readonly tableRowId?: string
  readonly tableColumnId?: string
  readonly source?: FlowTextEditSource
}): BeginFlowTextEditResult {
  void input.gesture
  const locationId = input.locationId ?? input.selection.locationId
  const selected = input.selection.selectedBlockId === input.blockId
    ? input.selection
    : selectFlowEditorBlocks(input.project, locationId, [input.blockId])
  const offset = input.offset ?? 0
  return beginFlowTextEdit({
    project: input.project,
    selection: selected,
    blockId: input.blockId,
    source: input.source,
    range: {
      blockId: input.blockId,
      start: offset,
      end: input.end ?? offset,
      ...(input.listItemId ? { listItemId: input.listItemId } : {}),
      ...(input.tableRowId ? { tableRowId: input.tableRowId } : {}),
      ...(input.tableColumnId ? { tableColumnId: input.tableColumnId } : {}),
    },
  })
}

export function beginFlowFormulaEdit(input: {
  readonly project: CourseProjectDocument
  readonly selection: FlowEditorSelection
  readonly blockId: string
  readonly source?: FlowTextEditSource
}): BeginFlowTextEditResult {
  const block = locateBlock(input.project, input.selection.surfaceId, input.blockId)
  if (!block || !isFlowFormulaBlock(block)) {
    return { ok: false, reason: FLOW_TEXT_REJECT_NOT_EDITABLE }
  }
  const selected = selectFlowEditorBlocks(input.project, input.selection.locationId, [input.blockId])
  const target = flowBlockTargetFromSelection(input.project, selected)
  const original: FlowFormulaDraft = {
    ast: structuredClone(block.ast),
    accessibleText: block.accessibleText,
    source: serializeFormulaAst(block.ast),
    valid: true,
    hasSlots: false,
  }
  return {
    ok: true,
    selection: selected,
    edit: freezeEdit({
      kind: 'formula',
      source: input.source ?? 'paper',
      blockId: input.blockId,
      surfaceId: target.surfaceId,
      parentId: target.parentId,
      field: 'formula',
      composing: false,
      pendingAction: null,
      revision: input.project.revision,
      original,
      draft: structuredClone(original),
      range: { start: 0, end: 0 },
    }),
  }
}

export function updateFlowTextDraft(
  edit: FlowTextEditSession,
  draft: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft,
): FlowTextEditSession {
  if (edit.kind === 'formula') {
    if (!('ast' in draft)) return edit
    return freezeEdit({
      ...edit,
      draft: {
        ast: structuredClone(draft.ast),
        accessibleText: draft.accessibleText ?? formulaAstToAccessibleText(draft.ast),
        source: draft.source,
        valid: draft.valid,
        hasSlots: draft.hasSlots,
      },
      range: edit.range,
    })
  }
  if (edit.kind === 'plain-string') {
    if (!('text' in draft) || 'runs' in draft) {
      if (!('text' in draft)) return edit
    }
    const text = 'text' in draft ? draft.text : (edit.draft as FlowPlainTextDraft).text
    return freezeEdit({
      ...edit,
      draft: { text },
      range: {
        start: Math.min(edit.range.start, Array.from(text).length),
        end: Math.min(edit.range.end, Array.from(text).length),
      },
    })
  }
  if (!('text' in draft)) return edit
  const previous = edit.draft as FlowRichTextDraft
  const text = draft.text
  const runs = 'runs' in draft && draft.runs
    ? draft.runs
    : remapTextRuns(previous.text, text, previous.runs)
  return freezeEdit({
    ...edit,
    draft: { text, runs },
    range: edit.range,
  })
}

export function updateFlowTextRange(
  edit: FlowTextEditSession,
  range: { start: number; end: number },
): FlowTextEditSession {
  const text = 'text' in edit.draft ? edit.draft.text : ''
  const length = Array.from(text).length
  return freezeEdit({
    ...edit,
    range: {
      start: Math.max(0, Math.min(length, range.start)),
      end: Math.max(0, Math.min(length, range.end)),
    },
  })
}

export function applyFlowTextEditRunStyle(
  edit: FlowTextEditSession,
  style: TextRunStyle,
  range?: { start: number; end: number } | 'all',
): FlowTextEditSession {
  if (edit.kind !== 'rich-text') return edit
  const draft = edit.draft as FlowRichTextDraft
  const resolved = resolveFlowFormatRange(draft.text, range ?? edit.range)
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs: applyTextRunStyle(draft.text, draft.runs, resolved.start, resolved.end, style),
    },
    range: resolved,
  })
}

export function toggleFlowTextEditRunStyle(
  edit: FlowTextEditSession,
  key: keyof Omit<TextRunStyle, 'color' | 'highlightColor'>,
  range?: { start: number; end: number } | 'all',
): FlowTextEditSession {
  if (edit.kind !== 'rich-text') return edit
  const draft = edit.draft as FlowRichTextDraft
  const resolved = resolveFlowFormatRange(draft.text, range ?? edit.range)
  const enabled = rangeHasFlag(draft, resolved, key)
  return applyFlowTextEditRunStyle(edit, { [key]: !enabled }, resolved)
}

export function toggleFlowTextEditEmphasis(
  edit: FlowTextEditSession,
  range?: { start: number; end: number } | 'all',
): FlowTextEditSession {
  if (edit.kind !== 'rich-text') return edit
  const draft = edit.draft as FlowRichTextDraft
  const resolved = resolveFlowFormatRange(draft.text, range ?? edit.range)
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs: toggleTextRunEmphasis(draft.text, draft.runs, resolved.start, resolved.end, false),
    },
    range: resolved,
  })
}

export function clearFlowTextRangeStyle(
  text: string,
  runs: TextRun[],
  start: number,
  end: number,
): TextRun[] {
  const next: TextRun[] = []
  for (const run of runs) {
    if (run.end <= start || run.start >= end) {
      next.push(run)
      continue
    }
    if (run.start < start) next.push({ start: run.start, end: start, style: run.style })
    if (run.end > end) next.push({ start: end, end: run.end, style: run.style })
  }
  return next
}

export function clearFlowTextEditRangeStyle(
  edit: FlowTextEditSession,
  range?: { start: number; end: number } | 'all',
): FlowTextEditSession {
  if (edit.kind !== 'rich-text') return edit
  const draft = edit.draft as FlowRichTextDraft
  const resolved = resolveFlowFormatRange(draft.text, range ?? edit.range)
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs: clearFlowTextRangeStyle(draft.text, draft.runs, resolved.start, resolved.end),
    },
    range: resolved,
  })
}

function rangeHasFlag(
  draft: FlowRichTextDraft,
  range: { start: number; end: number },
  key: keyof Omit<TextRunStyle, 'color' | 'highlightColor'>,
): boolean {
  if (range.end <= range.start) return false
  for (let index = range.start; index < range.end; index += 1) {
    const style: TextRunStyle = {}
    for (const run of draft.runs) {
      if (index >= run.start && index < run.end) Object.assign(style, run.style)
    }
    if (!style[key]) return false
  }
  return true
}

export function markFlowTextComposing(
  edit: FlowTextEditSession,
  composing: boolean,
): FlowTextEditSession {
  if (edit.composing === composing) return edit
  return freezeEdit({
    ...edit,
    composing,
    pendingAction: composing ? edit.pendingAction : null,
  })
}

export function deferFlowTextAction(
  edit: FlowTextEditSession,
  action: 'commit' | 'cancel',
): FlowTextEditSession {
  return freezeEdit({ ...edit, pendingAction: action })
}

export function finishFlowTextComposition(
  edit: FlowTextEditSession,
): { readonly edit: FlowTextEditSession; readonly action: FlowTextEditAction } {
  const action = edit.pendingAction ?? 'ignore'
  return {
    edit: freezeEdit({ ...edit, composing: false, pendingAction: null }),
    action,
  }
}

export function resolveFlowTextKeyDown(input: {
  readonly kind: FlowTextEditKind
  readonly composing: boolean
  readonly isComposingEvent?: boolean
  readonly key: string
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
}): FlowTextEditAction {
  if (input.composing || input.isComposingEvent) return 'ignore'
  if (input.key === 'Escape') return 'cancel'
  if (input.kind === 'formula') {
    return input.key === 'Enter' ? 'commit' : 'ignore'
  }
  if (input.key === 'Enter' && (input.ctrlKey || input.metaKey)) return 'commit'
  return 'ignore'
}

export function resolveFlowTextBlur(input: {
  readonly composing: boolean
  readonly blurReady?: boolean
}): FlowTextEditAction {
  if (input.blurReady === false) return 'ignore'
  if (input.composing) return 'defer'
  return 'commit'
}

export function resolveFlowTextSelectionChange(input: {
  readonly editingBlockId: string
  readonly nextSelectedBlockIds: readonly string[]
  readonly composing: boolean
}): FlowTextEditAction {
  if (
    input.nextSelectedBlockIds.length === 1 &&
    input.nextSelectedBlockIds[0] === input.editingBlockId
  ) {
    return 'ignore'
  }
  if (input.composing) return 'defer'
  return 'commit'
}

export function resolveFlowTextHistoryAction(input: {
  readonly composing: boolean
  readonly draftDirty: boolean
  readonly action: 'undo' | 'redo'
}): FlowTextEditAction {
  if (input.composing) return 'ignore'
  if (input.action === 'undo' && input.draftDirty) return 'cancel'
  return 'ignore'
}

export function isFlowTextDraftDirty(edit: FlowTextEditSession): boolean {
  if (edit.kind === 'formula') {
    const original = edit.original as FlowFormulaDraft
    const draft = edit.draft as FlowFormulaDraft
    if (!draft.valid) return draft.source !== original.source
    return !sameJson(original.ast, draft.ast)
      || original.accessibleText !== draft.accessibleText
  }
  return !sameJson(edit.original, edit.draft)
}

export function flowTextEditSelection(
  document: CourseProjectDocument,
  locationId: string,
  edit: FlowTextEditSession,
): FlowEditorSelection {
  if (edit.kind === 'formula') {
    return selectFlowEditorBlocks(document, locationId, [edit.blockId])
  }
  return selectFlowEditorBlocks(document, locationId, [edit.blockId], {
    focus: 'text',
    textRange: {
      blockId: edit.blockId,
      start: edit.range.start,
      end: edit.range.end,
      ...(edit.listItemId ? { listItemId: edit.listItemId } : {}),
      ...(edit.tableRowId ? { tableRowId: edit.tableRowId } : {}),
      ...(edit.tableColumnId ? { tableColumnId: edit.tableColumnId } : {}),
    },
  })
}

function writeNestedRichText(
  document: CourseProjectDocument,
  edit: FlowTextEditSession,
  draft: FlowRichTextDraft,
  options: FlowCommandOptions,
): FlowCommandResult {
  return updateFlowEditorBlock(document, {
    surfaceId: edit.surfaceId,
    blockId: edit.blockId,
    parentId: edit.parentId,
  }, (block) => {
    if (edit.listItemId && block.type === 'list') {
      const item = block.items.find((entry) => entry.id === edit.listItemId)
      if (!item) throw new Error('找不到列表项')
      item.text = draft.text
      if (draft.runs.length > 0) item.runs = draft.runs
      else delete item.runs
      return
    }
    if (edit.tableRowId && edit.tableColumnId && block.type === 'table') {
      const row = block.rows.find((entry) => entry.id === edit.tableRowId)
      if (!row) throw new Error('找不到表格行')
      row.cells[edit.tableColumnId] = draft.runs.length > 0
        ? { text: draft.text, runs: draft.runs }
        : draft.text
      return
    }
    throw new Error('当前块不能写入正文')
  }, options)
}

export function commitFlowTextEdit(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  edit: FlowTextEditSession,
  options: FlowCommandOptions = {},
): FlowTextCommandResult {
  if (edit.composing) return failCommand(FLOW_TEXT_REJECT_COMPOSING, { nextEdit: edit })
  if ((options.expectedRevision ?? edit.revision) !== document.revision) {
    return failCommand('工程版本已变化，请重新编辑', { nextEdit: edit })
  }
  if (!isFlowTextDraftDirty(edit)) {
    return identityDocument(document, { nextEdit: null, nextSelection: selection })
  }

  if (edit.kind === 'formula') {
    const draft = edit.draft as FlowFormulaDraft
    if (!draft.valid) {
      return failCommand(
        draft.hasSlots ? '请先补全公式占位符' : '请先修复公式输入错误',
        { nextEdit: edit },
      )
    }
    const accessibleText = draft.accessibleText || formulaAstToAccessibleText(draft.ast)
    const result = updateFlowEditorBlock(document, {
      surfaceId: edit.surfaceId,
      blockId: edit.blockId,
      parentId: edit.parentId,
    }, (block) => {
      if (block.type !== 'formula') throw new Error(FLOW_TEXT_REJECT_FORMULA_RUNS)
      block.ast = structuredClone(draft.ast)
      block.accessibleText = accessibleText
    }, options)
    return { ...result, nextEdit: null, nextSelection: selection }
  }

  if (edit.kind === 'plain-string') {
    const text = (edit.draft as FlowPlainTextDraft).text
    if (edit.field === 'title') {
      const result = updateFlowEditorBlock(document, {
        surfaceId: edit.surfaceId,
        blockId: edit.blockId,
        parentId: edit.parentId,
      }, (block) => {
        if (block.type !== 'section') throw new Error(FLOW_TEXT_REJECT_NOT_EDITABLE)
        block.title = text
      }, options)
      return { ...result, nextEdit: null, nextSelection: selection }
    }
    const result = executeFlowEditorCommand(document, selection, {
      name: 'apply-text',
      text,
    }, options)
    return { ...result, nextEdit: null, nextSelection: selection }
  }

  const draft = edit.draft as FlowRichTextDraft
  if (edit.listItemId || (edit.tableRowId && edit.tableColumnId)) {
    const result = writeNestedRichText(document, edit, draft, options)
    return { ...result, nextEdit: null, nextSelection: selection }
  }
  const result = executeFlowEditorCommand(document, selection, {
    name: 'apply-text',
    text: draft.text,
    runs: draft.runs,
  }, options)
  return { ...result, nextEdit: null, nextSelection: selection }
}

export function cancelFlowTextEdit(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  edit: FlowTextEditSession,
): FlowTextCommandResult {
  void edit
  return identityDocument(document, { nextEdit: null, nextSelection: selection })
}

/**
 * Properties tab and the paper toolbar share this function so one selection
 * writes one `text` + `runs` transaction. Do not give Properties a second
 * whole-string draft.
 */
export function formatFlowAuthoringTextStyle(input: {
  readonly document: CourseProjectDocument
  readonly selection: FlowEditorSelection
  readonly style: TextRunStyle
  readonly range?: { start: number; end: number } | 'all'
  readonly edit?: FlowTextEditSession | null
  readonly now?: string
  readonly expectedRevision?: number
}): FlowTextCommandResult {
  const options: FlowCommandOptions = {
    now: input.now,
    expectedRevision: input.expectedRevision ?? input.document.revision,
  }
  if (input.edit) {
    if (input.edit.composing) {
      return failCommand(FLOW_TEXT_REJECT_COMPOSING, { nextEdit: input.edit })
    }
    if (input.edit.kind !== 'rich-text') {
      return failCommand(FLOW_TEXT_REJECT_NOT_EDITABLE, { nextEdit: input.edit })
    }
    const nextEdit = applyFlowTextEditRunStyle(input.edit, input.style, input.range)
    return identityDocument(input.document, {
      nextEdit,
      nextSelection: input.selection,
    })
  }
  const block = locateBlock(input.document, input.selection.surfaceId, input.selection.selectedBlockId ?? '')
  if (!block) return failCommand(FLOW_TEXT_REJECT_NO_SELECTION)
  if (
    input.range !== undefined &&
    input.range !== 'all'
  ) {
    let targetText: string | null = null
    if (block.type === 'list' && input.selection.textRange?.listItemId) {
      targetText = block.items.find(
        (entry) => entry.id === input.selection.textRange?.listItemId,
      )?.text ?? null
    } else if (
      block.type === 'table' &&
      input.selection.textRange?.tableRowId &&
      input.selection.textRange.tableColumnId
    ) {
      const row = block.rows.find(
        (entry) => entry.id === input.selection.textRange?.tableRowId,
      )
      if (row) targetText = cellToRichText(row.cells[input.selection.textRange.tableColumnId]).text
    } else if (isRichTextFlowBlock(block)) {
      targetText = block.text
    }
    if (targetText !== null) {
      const resolved = resolveFlowFormatRange(targetText, input.range)
      if (resolved.end <= resolved.start) {
        return identityDocument(input.document, {
          nextEdit: null,
          nextSelection: input.selection,
        })
      }
    }
  }
  if (block.type === 'list' && input.selection.textRange?.listItemId) {
    const item = block.items.find((entry) => entry.id === input.selection.textRange?.listItemId)
    if (!item) return failCommand(FLOW_TEXT_REJECT_NOT_EDITABLE)
    const resolved = resolveFlowFormatRange(item.text, input.range ?? 'all')
    const runs = applyTextRunStyle(item.text, item.runs ?? [], resolved.start, resolved.end, input.style)
    const result = updateFlowEditorBlock(input.document, flowBlockTargetFromSelection(input.document, input.selection), (current) => {
      if (current.type !== 'list') throw new Error(FLOW_TEXT_REJECT_NOT_EDITABLE)
      const target = current.items.find((entry) => entry.id === item.id)
      if (!target) throw new Error('找不到列表项')
      if (runs.length > 0) target.runs = runs
      else delete target.runs
    }, options)
    return { ...result, nextEdit: null }
  }
  if (block.type === 'table' && input.selection.textRange?.tableRowId && input.selection.textRange.tableColumnId) {
    const rowId = input.selection.textRange.tableRowId
    const columnId = input.selection.textRange.tableColumnId
    const row = block.rows.find((entry) => entry.id === rowId)
    if (!row) return failCommand(FLOW_TEXT_REJECT_NOT_EDITABLE)
    const rich = cellToRichText(row.cells[columnId])
    const resolved = resolveFlowFormatRange(rich.text, input.range ?? 'all')
    const runs = applyTextRunStyle(rich.text, rich.runs ?? [], resolved.start, resolved.end, input.style)
    const result = updateFlowEditorBlock(input.document, flowBlockTargetFromSelection(input.document, input.selection), (current) => {
      if (current.type !== 'table') throw new Error(FLOW_TEXT_REJECT_NOT_EDITABLE)
      const targetRow = current.rows.find((entry) => entry.id === rowId)
      if (!targetRow) throw new Error('找不到表格行')
      targetRow.cells[columnId] = runs.length > 0 ? { text: rich.text, runs } : rich.text
    }, options)
    return { ...result, nextEdit: null }
  }
  if (!isRichTextFlowBlock(block)) return failCommand(FLOW_TEXT_REJECT_NOT_EDITABLE)
  const resolved = resolveFlowFormatRange(
    block.text,
    input.range ?? 'all',
  )
  const result = executeFlowEditorCommand(input.document, input.selection, {
    name: 'format',
    spec: { kind: 'text-style', style: input.style, range: resolved },
  }, options)
  return { ...result, nextEdit: null }
}

export function formatFlowAuthoringBlock(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  spec: Parameters<typeof formatFlowEditorBlock>[2],
  options: FlowCommandOptions = {},
): FlowCommandResult {
  return executeFlowEditorCommand(document, selection, { name: 'format', spec }, options)
}

export function commitFlowFormulaAst(
  document: CourseProjectDocument,
  selection: FlowEditorSelection,
  ast: FormulaAstNode,
  accessibleText: string,
  options: FlowCommandOptions = {},
): FlowCommandResult {
  const target = flowBlockTargetFromSelection(document, selection)
  return updateFlowEditorBlock(document, target, (block) => {
    if (block.type !== 'formula') throw new Error(FLOW_TEXT_REJECT_FORMULA_RUNS)
    block.ast = structuredClone(ast)
    block.accessibleText = accessibleText
  }, options)
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function styleAt(runs: readonly TextRun[], index: number): TextRunStyle {
  const style: TextRunStyle = {}
  for (const run of runs) {
    if (index >= run.start && index < run.end) Object.assign(style, run.style)
  }
  return style
}

export function buildFlowRichTextHtml(text: string, runs: readonly TextRun[] = []): string {
  return Array.from(text).map((character, index) => {
    if (character === '\n') return '<br>'
    const style = styleAt(runs, index)
    const decorations = [
      style.underline ? 'underline' : '',
      style.strike ? 'line-through' : '',
    ].filter(Boolean).join(' ')
    const css = [
      style.color !== undefined ? `color:${style.color}` : '',
      style.fontFamily !== undefined ? `font-family:${style.fontFamily}` : '',
      style.fontSize !== undefined ? `font-size:${style.fontSize}px` : '',
      style.bold !== undefined ? `font-weight:${style.bold ? '700' : '400'}` : '',
      style.italic !== undefined ? `font-style:${style.italic ? 'italic' : 'normal'}` : '',
      decorations ? 'display:inline-block' : '',
      decorations ? `text-decoration-line:${decorations}` : '',
      style.highlightColor ? `background-color:${style.highlightColor}` : '',
      style.highlightColor === null ? 'background-color:transparent' : '',
      style.emphasis !== undefined
        ? `text-emphasis-style:${style.emphasis ? 'filled circle' : 'none'}`
        : '',
      style.emphasis !== undefined
        ? `-webkit-text-emphasis-style:${style.emphasis ? 'filled circle' : 'none'}`
        : '',
      style.emphasis !== undefined ? 'text-emphasis-position:under right' : '',
      style.emphasis !== undefined ? '-webkit-text-emphasis-position:under right' : '',
    ].filter(Boolean).join(';')
    return css ? `<span style="${css}">${escapeHtml(character)}</span>` : escapeHtml(character)
  }).join('')
}

function rgbToHex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) return null
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
}

function authoredBackgroundColor(element: HTMLElement, root: HTMLElement): string | null {
  let current: HTMLElement | null = element
  while (current && current !== root) {
    if (current.style.backgroundColor) return getComputedStyle(current).backgroundColor
    current = current.parentElement
  }
  return null
}

function isTransparentColor(value: string): boolean {
  if (value === 'transparent') return true
  const match = value.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/i)
  return Boolean(match && Number(match[1]) === 0)
}

interface StyledCharacter {
  value: string
  style: TextRunStyle
}

export function extractFlowRichTextFromEditor(root: HTMLElement): FlowRichTextDraft {
  const characters: StyledCharacter[] = []
  const visit = (current: Node) => {
    if (current.nodeType === Node.TEXT_NODE) {
      const parent = current.parentElement ?? root
      const computed = getComputedStyle(parent)
      const color = rgbToHex(computed.color)
      const authoredBackground = authoredBackgroundColor(parent, root)
      const background = authoredBackground ? rgbToHex(authoredBackground) : null
      const decoration = computed.textDecorationLine
      const emphasisStyle = computed.getPropertyValue('text-emphasis-style') ||
        computed.getPropertyValue('-webkit-text-emphasis-style')
      const emphasis = emphasisStyle !== '' && emphasisStyle !== 'none'
      const rootColor = rgbToHex(getComputedStyle(root).color)
      const style: TextRunStyle = {
        ...(color && color !== (rootColor ?? FLOW_PAPER_TEXT_COLOR) ? { color } : {}),
        ...(Number.parseInt(computed.fontWeight, 10) >= 600 ? { bold: true } : {}),
        ...(computed.fontStyle === 'italic' ? { italic: true } : {}),
        ...(decoration.includes('underline') ? { underline: true } : {}),
        ...(decoration.includes('line-through') ? { strike: true } : {}),
        ...(emphasis ? { emphasis: true } : {}),
        ...(authoredBackground && isTransparentColor(authoredBackground)
          ? { highlightColor: null }
          : background ? { highlightColor: background } : {}),
      }
      if (style.highlightColor === null) delete style.highlightColor
      for (const value of Array.from(current.textContent ?? '')) characters.push({ value, style })
      return
    }
    if (current instanceof HTMLBRElement) {
      characters.push({ value: '\n', style: {} })
      return
    }
    const block = current instanceof HTMLElement && ['DIV', 'P'].includes(current.tagName)
    if (block && characters.length > 0 && characters.at(-1)?.value !== '\n') {
      characters.push({ value: '\n', style: {} })
    }
    current.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  while (characters.at(-1)?.value === '\n') characters.pop()
  const text = characters.map((character) => character.value).join('')
  const runs: TextRun[] = []
  let start = 0
  while (start < characters.length) {
    const serialized = JSON.stringify(characters[start]!.style)
    let end = start + 1
    while (end < characters.length && JSON.stringify(characters[end]!.style) === serialized) end += 1
    if (Object.keys(characters[start]!.style).length > 0) {
      runs.push({ start, end, style: characters[start]!.style })
    }
    start = end
  }
  return { text, runs }
}

function logicalText(root: Node): string {
  const characters: string[] = []
  const visit = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      characters.push(...Array.from(current.textContent ?? ''))
      return
    }
    if (current instanceof HTMLBRElement) {
      characters.push('\n')
      return
    }
    const block = current instanceof HTMLElement && ['DIV', 'P'].includes(current.tagName)
    if (block && characters.length > 0 && characters.at(-1) !== '\n') {
      characters.push('\n')
    }
    current.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  while (characters.at(-1) === '\n') characters.pop()
  return characters.join('')
}

export function logicalFlowSelectionOffsets(
  root: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (
    !(range.startContainer === root || root.contains(range.startContainer)) ||
    !(range.endContainer === root || root.contains(range.endContainer))
  ) {
    return null
  }
  const offsetTo = (container: Node, offset: number): number => {
    const prefix = document.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(container, offset)
    const holder = document.createElement('div')
    holder.append(prefix.cloneContents())
    return Array.from(logicalText(holder)).length
  }
  const start = offsetTo(range.startContainer, range.startOffset)
  const end = offsetTo(range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}

interface DomPoint {
  node: Node
  offset: number
}

function domPointAtLogicalOffset(root: HTMLElement, target: number): DomPoint {
  let remaining = Math.max(0, target)
  const visit = (current: Node): DomPoint | null => {
    if (current.nodeType === Node.TEXT_NODE) {
      const values = Array.from(current.textContent ?? '')
      if (remaining <= values.length) {
        return {
          node: current,
          offset: values.slice(0, remaining).join('').length,
        }
      }
      remaining -= values.length
      return null
    }
    if (current instanceof HTMLBRElement) {
      const parent = current.parentNode
      if (!parent) return null
      const index = Array.prototype.indexOf.call(parent.childNodes, current) as number
      if (remaining === 0) return { node: parent, offset: index }
      remaining -= 1
      if (remaining === 0) return { node: parent, offset: index + 1 }
      return null
    }
    for (const child of Array.from(current.childNodes)) {
      const point = visit(child)
      if (point) return point
    }
    return null
  }
  return visit(root) ?? { node: root, offset: root.childNodes.length }
}

export function restoreFlowLogicalSelection(
  root: HTMLElement,
  start: number,
  end: number,
): void {
  const range = document.createRange()
  const startPoint = domPointAtLogicalOffset(root, start)
  const endPoint = domPointAtLogicalOffset(root, end)
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export {
  applyFlowCommittedText,
  enterFlowTextEditing,
  executeFlowEditorCommand,
  formatFlowEditorBlock,
  selectFlowEditorBlocks,
}
