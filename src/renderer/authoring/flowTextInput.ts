import type { FlowTextContent } from '../../shared/document/content'
import type { BackgroundMode } from '../../shared/courseProjectTypes'
import { applyTextRunStyle, planTextRunRemap, toggleTextRunEmphasis } from '../../shared/textRuns'
import { formulaAstToAccessibleText } from '../../shared/formulaLinear'
import { isRichTextFlowBlock } from '../../core/tools/flowDocumentModel'
import type { FormulaAstNode, FormulaNode, TextRun, TextRunStyle } from '../../shared/contracts/native-v1'
import type { FlowBlock, FlowFormulaBlock, FlowHeadingBlock, FlowRichText, FlowTableCell } from '../../shared/courseProjectTypes'
import type { FlowTextRange } from '../course/flowEditorSlice'
import type { ChartTextField, ChartTextDraft } from './chartTextDraft'

export type FlowBlockFormatSpec =
  | { kind: 'heading-level'; level: FlowHeadingBlock['level'] }
  | { kind: 'convert-heading'; level: FlowHeadingBlock['level'] }
  | { kind: 'convert-paragraph' }
  | { kind: 'convert-quote' }
  | { kind: 'list-ordered'; ordered: boolean }
  | { kind: 'text-style'; style: TextRunStyle; range?: 'all' | { start: number; end: number } }

export interface FlowBodyDestination {
  readonly parentBlockId: string | null
  readonly index: number
  readonly wrap?: 'none' | 'left' | 'right'
}

export const FLOW_TEXT_REJECT_SHARED_DOCUMENT = '请在正文编辑器中编辑此内容'
export const FLOW_TEXT_REJECT_COMPOSING = 'composing'
export const FLOW_TEXT_REJECT_NOT_EDITABLE = '当前块不能就地编辑文字'
export const FLOW_TEXT_REJECT_FORMULA_RUNS = '公式请使用公式编辑器'
export const FLOW_TEXT_REJECT_NO_SELECTION = '没有可设置格式的选区'
export const FLOW_DEFAULT_HIGHLIGHT = '#fff3a3'
export const FLOW_PAPER_TEXT_COLOR = '#1f2937'

export type FlowTextEditKind = 'rich-text' | 'plain-string' | 'formula' | 'chart-text'
export type FlowTextEditSource = 'paper' | 'properties'
export type FlowTextEditAction = 'commit' | 'cancel' | 'ignore' | 'defer'
export type FlowTextEditGesture = 'double-click' | 'enter' | 'click-text'
export type FlowPlainTextField = 'code' | 'body' | 'title' | 'table-caption' | 'table-header'

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
  readonly overlayScope?: 'page' | 'global'
  readonly kind: FlowTextEditKind
  readonly source: FlowTextEditSource
  readonly blockId: string
  readonly surfaceId: string
  readonly parentId: string | null
  readonly listItemId?: string
  readonly tableRowId?: string
  readonly tableColumnId?: string
  readonly chartField?: ChartTextField
  readonly field: 'text' | FlowPlainTextField | 'formula'
  readonly composing: boolean
  readonly pendingAction: Exclude<FlowTextEditAction, 'ignore' | 'defer'> | null
  readonly revision: number
  readonly original: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft | ChartTextDraft
  readonly draft: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft | ChartTextDraft
  readonly range: { start: number; end: number }
  /** Session-only style patch applied to text subsequently inserted at a caret. */
  readonly pendingStyle: TextRunStyle
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
  readonly canApplyInlineStyle: boolean
  readonly hasPendingStyle: boolean
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

function inlineFormatSample(content: FlowRichText): FlowRichTextDraft {
  let text = ''; const runs: TextRun[] = []
  for (const inline of content.inlines) {
    const start = Array.from(text).length
    text += inline.type === 'text' ? inline.text : '\ufffc'
    if (inline.style) runs.push({ start, end: Array.from(text).length, style: inline.style })
  }
  return { text, runs }
}

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

function flowCaretStyle(
  text: string,
  runs: readonly TextRun[],
  caret: number,
  pendingStyle: TextRunStyle = {},
): TextRunStyle {
  const characterStyles = flowCharacterStyles(text, runs)
  const inherited = characterStyles.length === 0
    ? {}
    : characterStyles[caret === 0 ? 0 : Math.min(characterStyles.length - 1, caret - 1)]
  return { ...inherited, ...pendingStyle }
}

function hasFlowTextStyle(style: TextRunStyle): boolean {
  return Object.keys(style).length > 0
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
  readonly range?: { start: number; end: number } | null
}): FlowSelectionFormat {
  const activeEdit = input.edit?.blockId === input.block.id ? input.edit : null
  const mode: FlowSelectionFormatMode = activeEdit?.kind === 'rich-text'
    ? activeEdit.range.end > activeEdit.range.start ? 'range' : 'caret'
    : input.range && input.range.end > input.range.start ? 'range' : 'whole-block'
  const content = activeEdit?.kind === 'rich-text'
    ? activeEdit.draft as FlowRichTextDraft
    : isRichTextFlowBlock(input.block)
      ? inlineFormatSample(input.block.content)
      : null
  if (!content) {
    return {
      mode,
      start: 0,
      end: 0,
      richText: false,
      canApplyInlineStyle: false,
      hasPendingStyle: false,
      hasMixedValue: false,
      fields: unsetFlowSelectionFormatFields(),
    }
  }

  const length = Array.from(content.text).length
  const start = mode === 'whole-block'
    ? 0
    : Math.max(0, Math.min(length, input.range?.start ?? activeEdit?.range.start ?? 0))
  const end = mode === 'whole-block'
    ? length
    : Math.max(start, Math.min(length, input.range?.end ?? activeEdit?.range.end ?? start))
  const characterStyles = flowCharacterStyles(content.text, content.runs)
  const sampledStyles = mode === 'caret'
    ? [flowCaretStyle(
        content.text,
        content.runs,
        start,
        activeEdit?.kind === 'rich-text' ? activeEdit.pendingStyle : {},
      )]
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
    canApplyInlineStyle: mode === 'caret'
      ? activeEdit?.kind === 'rich-text'
      : end > start,
    hasPendingStyle: activeEdit?.kind === 'rich-text'
      ? hasFlowTextStyle(activeEdit.pendingStyle)
      : false,
    hasMixedValue: Object.values(fields).some((field) => field.state === 'mixed'),
    fields,
  }
}

export function freezeEdit(edit: FlowTextEditSession): FlowTextEditSession {
  return Object.freeze({
    ...edit,
    original: Object.freeze(structuredClone(edit.original)),
    draft: Object.freeze(structuredClone(edit.draft)),
    range: Object.freeze({ ...edit.range }),
    pendingStyle: Object.freeze(structuredClone(edit.pendingStyle)),
  })
}

export function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
  return cell ? structuredClone(cell) : { inlines: [] }
}

export function readFlowEditableContent(
  block: FlowBlock,
  nested?: Pick<FlowTextRange, 'listItemId' | 'tableRowId' | 'tableColumnId'>,
): {
  kind: FlowTextEditKind
  field: FlowTextEditSession['field']
  content: FlowRichTextDraft | FlowPlainTextDraft | FlowFormulaDraft
} | null {
  void block; void nested; return null
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


export function updateFlowChartTextDraft(edit: FlowTextEditSession, draft: ChartTextDraft, composing: boolean): FlowTextEditSession {
  if (edit.kind !== 'chart-text') return edit
  return freezeEdit({ ...edit, draft, composing })
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
  let runs = 'runs' in draft ? draft.runs : undefined
  if (!runs) {
    const mapping = planTextRunRemap(previous.text, text, previous.runs)
    if (!mapping.ok) return edit
    runs = mapping.runs
  }
  if (text !== previous.text && hasFlowTextStyle(edit.pendingStyle)) {
    const previousLength = Array.from(previous.text).length
    const nextLength = Array.from(text).length
    const replacedLength = Math.max(0, edit.range.end - edit.range.start)
    const insertedLength = nextLength - (previousLength - replacedLength)
    if (insertedLength > 0) {
      const insertionStart = Math.max(0, Math.min(nextLength, edit.range.start))
      const insertionEnd = Math.max(
        insertionStart,
        Math.min(nextLength, insertionStart + insertedLength),
      )
      runs = applyTextRunStyle(
        text,
        runs,
        insertionStart,
        insertionEnd,
        edit.pendingStyle,
      )
    }
  }
  return freezeEdit({
    ...edit,
    draft: { text, runs },
    range: edit.range,
  })
}

export function updateFlowTextRange(
  edit: FlowTextEditSession,
  range: { start: number; end: number },
  options: { readonly preservePendingStyle?: boolean } = {},
): FlowTextEditSession {
  const text = 'text' in edit.draft ? edit.draft.text : ''
  const length = Array.from(text).length
  const nextRange = {
    start: Math.max(0, Math.min(length, range.start)),
    end: Math.max(0, Math.min(length, range.end)),
  }
  const moved = nextRange.start !== edit.range.start || nextRange.end !== edit.range.end
  return freezeEdit({
    ...edit,
    range: nextRange,
    pendingStyle: moved && !options.preservePendingStyle ? {} : edit.pendingStyle,
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
  if (resolved.end <= resolved.start) {
    return freezeEdit({
      ...edit,
      pendingStyle: { ...edit.pendingStyle, ...style },
      range: resolved,
    })
  }
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs: applyTextRunStyle(draft.text, draft.runs, resolved.start, resolved.end, style),
    },
    range: resolved,
    pendingStyle: {},
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
  const enabled = resolved.end <= resolved.start
    ? Boolean(flowCaretStyle(draft.text, draft.runs, resolved.start, edit.pendingStyle)[key])
    : rangeHasFlag(draft, resolved, key)
  return applyFlowTextEditRunStyle(edit, { [key]: !enabled }, resolved)
}

export function toggleFlowTextEditEmphasis(
  edit: FlowTextEditSession,
  range?: { start: number; end: number } | 'all',
): FlowTextEditSession {
  if (edit.kind !== 'rich-text') return edit
  const draft = edit.draft as FlowRichTextDraft
  const resolved = resolveFlowFormatRange(draft.text, range ?? edit.range)
  if (resolved.end <= resolved.start) {
    const emphasized = Boolean(
      flowCaretStyle(draft.text, draft.runs, resolved.start, edit.pendingStyle).emphasis,
    )
    return applyFlowTextEditRunStyle(edit, { emphasis: !emphasized }, resolved)
  }
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs: toggleTextRunEmphasis(draft.text, draft.runs, resolved.start, resolved.end, false),
    },
    range: resolved,
    pendingStyle: {},
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
  if (resolved.end <= resolved.start) {
    return freezeEdit({ ...edit, range: resolved, pendingStyle: {} })
  }
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs: clearFlowTextRangeStyle(draft.text, draft.runs, resolved.start, resolved.end),
    },
    range: resolved,
    pendingStyle: {},
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
  readonly overlayScope?: 'page' | 'global'
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

function authoredInlineStyleValue(
  element: HTMLElement,
  root: HTMLElement,
  read: (candidate: HTMLElement) => string,
): string | null {
  let current: HTMLElement | null = element
  while (current && current !== root) {
    const value = read(current).trim()
    if (value) return value
    current = current.parentElement
  }
  return null
}

function normalizeAuthoredFontFamily(value: string): string {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
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
      const authoredFontFamily = authoredInlineStyleValue(parent, root, (candidate) => (
        candidate.style.fontFamily
      ))
      const authoredFontSize = authoredInlineStyleValue(parent, root, (candidate) => (
        candidate.style.fontSize
      ))
      const fontSize = authoredFontSize ? Number.parseFloat(authoredFontSize) : Number.NaN
      const authoredBaseline = authoredInlineStyleValue(parent, root, candidate => candidate.style.verticalAlign)
      const baseline = authoredBaseline?.endsWith('em') ? Number.parseFloat(authoredBaseline) : Number.NaN
      const style: TextRunStyle = {
        ...(Number.isFinite(baseline) ? { baseline } : {}),
        ...(color && color !== (rootColor ?? FLOW_PAPER_TEXT_COLOR) ? { color } : {}),
        ...(authoredFontFamily ? { fontFamily: normalizeAuthoredFontFamily(authoredFontFamily) } : {}),
        ...(Number.isFinite(fontSize) && fontSize > 0 ? { fontSize } : {}),
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


export type FlowEditorBlockInput = FlowBlock extends infer Block
  ? Block extends FlowBlock
    ? Omit<Block, 'id'> & { id?: string }
    : never
  : never


export interface InsertFlowEditorBlockInput {
  readonly surfaceId: string
  readonly parentId: string | null
  readonly index: number
  readonly block: FlowEditorBlockInput
}

export interface MoveFlowEditorBlockDestination {
  readonly parentId: string | null
  readonly index: number
  readonly surfaceId?: string
}


export type FlowEditorCommandRequest =
  | { name: 'insert'; input: InsertFlowEditorBlockInput }
  | { name: 'split'; offset?: number }
  | { name: 'merge' }
  | { name: 'move'; destination: MoveFlowEditorBlockDestination }
  | { name: 'delete'; direction?: 'backward' | 'forward' }
  | { name: 'indent' }
  | { name: 'outdent' }
  | { name: 'format'; spec: FlowBlockFormatSpec }
  | { name: 'cut' }
  | { name: 'copy' }
  | { name: 'paste'; clipboard?: readonly FlowBlock[] }
  | { name: 'duplicate' }
  | { name: 'apply-text'; content: FlowTextContent }


export interface FlowSurfaceBackgroundPatch {
  readonly backgroundMode?: BackgroundMode
  readonly backgroundColor?: string
  readonly backgroundAssetId?: string | null
}

