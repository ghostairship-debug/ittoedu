import { commitResourceAwareAuthoringHistory } from './resourceAwareAuthoringHistory'
import { formulaAstToAccessibleText } from '../../shared/formulaLinear'
import { applyTextRunStyle, planTextRunRemap, remapTextRuns } from '../../shared/textRuns'
import { readChartText, type ChartTextDraft, type ChartTextField } from './chartTextDraft'
import { readLayerTextField, type LayerTextDraft, type LayerTextField } from './layerTextField'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { setComponentPropValue } from '../../shared/componentProps'
import { patchEffectiveLayerPropertiesAtTarget } from '../course/effectiveLayerCommands'
import { patchSlideTableCellText } from '../course/v9TableCommands'
import type {
  CourseProjectDocument,
  LayerItemOverride,
  NativeLayerItem,
  SlidePresentationState,
  SlideSceneDocument,
  SlideSurfaceDocument,
} from '../../shared/courseProjectTypes'
import type {
  FormulaAstNode,
  TextOverflowMode,
  TextRun,
  TextRunStyle,
  WritingMode,
} from '../../shared/contracts/native-v1'
import { SLIDE_BACKEND_NOT_CANDIDATE } from '../store/slideBackendPort'
import { SLIDE_REJECT_LOCKED, SLIDE_REJECT_STALE_REVISION, SLIDE_REJECT_WRONG_OWNER, SlideCommandError, commitSlideProjectMutation, selectSlideEditorLayers } from '../course/slideEditorCommands'
import {
  type SlideAuthoringSession,
  type SlideAuthoringTarget,
  type SlideAuthoringBackend,
  type SlideCommandResult,
  buildSlideEditorView,
  makeSlideAuthoringTarget,
  slideAuthoringGeneration,
} from '../course/slideAuthoringBackend'

export const V9_SLIDE_CONTENT_REJECT_NOT_CANDIDATE = SLIDE_BACKEND_NOT_CANDIDATE
export const V9_SLIDE_CONTENT_REJECT_COMPOSING = 'composing'
export const V9_SLIDE_CONTENT_REJECT_STALE_GENERATION = 'stale-generation'
export const V9_SLIDE_CONTENT_REJECT_INVALID_TARGET = 'invalid-target'

export type V9SlideContentEditKind = 'text' | 'formula' | 'chart-text' | 'field-text'
export type V9SlideContentEditSource = 'canvas' | 'properties'
export type V9SlideContentEditAction = 'commit' | 'cancel' | 'ignore' | 'defer'

export interface V9SlideTextContentSnapshot {
  readonly text: string
  readonly runs: TextRun[]
  readonly width: number
  readonly height: number
  readonly writingMode: WritingMode
  readonly overflow: TextOverflowMode
}

export interface V9SlideFormulaContentSnapshot {
  readonly ast: FormulaAstNode
  readonly accessibleText: string
  readonly formulaId: string
}

export interface V9SlideTextContentDraft {
  readonly text: string
  readonly runs: TextRun[]
  readonly width?: number
  readonly height?: number
}

export interface V9SlideFormulaContentDraft {
  readonly ast: FormulaAstNode
  readonly accessibleText?: string
}

export interface V9SlideContentEditSession {
  readonly kind: V9SlideContentEditKind
  readonly source: V9SlideContentEditSource
  readonly target: SlideAuthoringTarget
  readonly chartField?: ChartTextField
  readonly textField?: LayerTextField
  readonly composing: boolean
  readonly pendingAction: Exclude<V9SlideContentEditAction, 'ignore' | 'defer'> | null
  readonly original: V9SlideTextContentSnapshot | V9SlideFormulaContentSnapshot | ChartTextDraft | LayerTextDraft
  readonly draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft | ChartTextDraft | LayerTextDraft
}

export type BeginV9SlideContentEditResult = {
  readonly ok: true
  readonly edit: V9SlideContentEditSession
} | {
  readonly ok: false
  readonly reason: string
}

export type SlideFieldTextIntent = {
  readonly kind: 'begin-field'
  readonly target: SlideAuthoringTarget
  readonly field: LayerTextField
} | {
  readonly kind: 'update-field'
  readonly expectedEdit: V9SlideContentEditSession
  readonly text: string
  readonly composing: boolean
} | {
  readonly kind: 'begin-chart'
  readonly target: SlideAuthoringTarget
  readonly field: ChartTextField
} | {
  readonly kind: 'update-chart'
  readonly expectedEdit: V9SlideContentEditSession
  readonly draft: ChartTextDraft
  readonly composing: boolean
} | {
  readonly kind: 'commit' | 'cancel'
  readonly expectedEdit: V9SlideContentEditSession
}

export type SlideFieldTextReceipt = { readonly ok: true; readonly edit: V9SlideContentEditSession | null } | { readonly ok: false; readonly reason: string }

export type V9SlideContentCommitFn = (
  session: SlideAuthoringSession,
  nextDocument: CourseProjectDocument | null,
) => SlideCommandResult

export interface CommitV9SlideContentOptions {
  readonly componentPackages?: Readonly<Record<string, ComponentPackageData>>
  readonly now?: string
  readonly expectedRevision?: number
  readonly expectedGeneration?: number
  readonly commit?: V9SlideContentCommitFn
}

function freezeEdit(edit: V9SlideContentEditSession): V9SlideContentEditSession {
  return Object.freeze({
    ...edit,
    target: edit.target,
    original: Object.freeze(structuredClone(edit.original)),
    draft: Object.freeze(structuredClone(edit.draft)),
  })
}

function rejectSession(session: SlideAuthoringSession, reason: string): SlideCommandResult {
  return {
    ok: false,
    reason,
    nextSession: session,
    historyEntry: false,
    selection: session.selection,
  }
}

function succeedIdentity(session: SlideAuthoringSession): SlideCommandResult {
  return {
    ok: true,
    nextSession: session,
    historyEntry: false,
    selection: session.selection,
  }
}

export function defaultCommitV9SlideContentDocument(
  session: SlideAuthoringSession,
  nextDocument: CourseProjectDocument | null,
): SlideCommandResult {
  if (!nextDocument) return succeedIdentity(session)
  const nextSession: SlideAuthoringSession = {
    sessionId: session.sessionId,
    history: commitResourceAwareAuthoringHistory(session.history, nextDocument),
    selection: session.selection,
    scope: session.scope,
    generation: session.generation,
  }
  return {
    ok: true,
    nextSession,
    historyEntry: true,
    selection: nextSession.selection,
  }
}

function selectionIncludingEditedLayer(
  session: SlideAuthoringSession,
  layerItemId: string,
): SlideAuthoringSession['selection'] {
  const selectionIds = session.selection.selectionIds.includes(layerItemId)
    ? [...session.selection.selectionIds]
    : [layerItemId]
  return selectSlideEditorLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
    selectionIds,
  })
}

function commitKeepingEditedLayer(
  result: SlideCommandResult,
  layerItemId: string,
): SlideCommandResult {
  if (!result.ok || !result.nextSession) return result
  if (result.nextSession.selection.selectionIds.includes(layerItemId)) return result
  try {
    const selection = selectionIncludingEditedLayer(result.nextSession, layerItemId)
    const nextSession = { ...result.nextSession, selection }
    return { ...result, nextSession, selection }
  } catch {
    return result
  }
}

/**
 * Persist a content-command result. Tests assign `result.nextSession`.
 * R2-Z should supply writeSession because SlideCandidateBackend has no setter.
 */
export function runV9SlideContentCommand(
  readSession: () => SlideAuthoringSession,
  writeSession: (session: SlideAuthoringSession) => void,
  run: (session: SlideAuthoringSession) => SlideCommandResult,
): SlideCommandResult {
  const result = run(readSession())
  if (result.ok && result.nextSession) writeSession(result.nextSession)
  return result
}

export function applyV9SlideTextRunStyle(
  text: string,
  runs: TextRun[],
  selectionStart: number,
  selectionEnd: number,
  patch: TextRunStyle,
): TextRun[] {
  return applyTextRunStyle(text, runs, selectionStart, selectionEnd, patch)
}

export function remapV9SlideTextRuns(
  previousText: string,
  nextText: string,
  runs: TextRun[],
): TextRun[] {
  return remapTextRuns(previousText, nextText, runs)
}

export function resolveV9SlideContentKeyDown(input: {
  readonly kind: V9SlideContentEditKind
  readonly composing: boolean
  readonly isComposingEvent?: boolean
  readonly key: string
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
}): V9SlideContentEditAction {
  if (input.composing || input.isComposingEvent) return 'ignore'
  if (input.key === 'Escape') return 'cancel'
  if (input.kind === 'formula') {
    return input.key === 'Enter' ? 'commit' : 'ignore'
  }
  if (input.key === 'Enter' && (input.ctrlKey || input.metaKey)) return 'commit'
  return 'ignore'
}

export function resolveV9SlideContentBlur(input: {
  readonly composing: boolean
  readonly blurReady?: boolean
}): V9SlideContentEditAction {
  if (input.blurReady === false) return 'ignore'
  if (input.composing) return 'defer'
  return 'commit'
}

export function resolveV9SlideContentSelectionChange(input: {
  readonly editingLayerItemId: string
  readonly nextSelectionIds: readonly string[]
  readonly composing: boolean
}): V9SlideContentEditAction {
  if (
    input.nextSelectionIds.length === 1 &&
    input.nextSelectionIds[0] === input.editingLayerItemId
  ) {
    return 'ignore'
  }
  if (input.composing) return 'defer'
  return 'commit'
}

export function markV9SlideContentComposing(
  edit: V9SlideContentEditSession,
  composing: boolean,
): V9SlideContentEditSession {
  if (edit.composing === composing) return edit
  return freezeEdit({
    ...edit,
    composing,
    pendingAction: composing ? edit.pendingAction : null,
  })
}

export function deferV9SlideContentAction(
  edit: V9SlideContentEditSession,
  action: 'commit' | 'cancel',
): V9SlideContentEditSession {
  return freezeEdit({ ...edit, pendingAction: action })
}

export function finishV9SlideContentComposition(
  edit: V9SlideContentEditSession,
): { readonly edit: V9SlideContentEditSession; readonly action: V9SlideContentEditAction } {
  const action = edit.pendingAction ?? 'ignore'
  return {
    edit: freezeEdit({ ...edit, composing: false, pendingAction: null }),
    action,
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function nativeItem(
  layer: { item: { kind: string; content?: { nativeType: string } } },
): layer is { item: NativeLayerItem } {
  return layer.item.kind === 'native'
}

function readContentSnapshot(
  item: NativeLayerItem,
): V9SlideTextContentSnapshot | V9SlideFormulaContentSnapshot {
  if (item.content.nativeType === 'text') {
    return {
      text: item.content.data.text,
      runs: structuredClone(item.content.data.runs),
      width: item.frame.width,
      height: item.frame.height,
      writingMode: item.content.data.style.writingMode,
      overflow: item.content.data.style.overflow,
    }
  }
  if (item.content.nativeType === 'formula') {
    return {
      ast: structuredClone(item.content.data.ast),
      accessibleText: item.content.data.accessibleText,
      formulaId: item.content.data.formulaId,
    }
  }
  throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '当前元素不是文字或公式')
}

function locateEditableNative(
  session: SlideAuthoringSession,
  layerItemId: string,
  nativeTypes: readonly string[] = ['text', 'formula'],
): { ok: true; item: NativeLayerItem } | { ok: false; reason: string } {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer) return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  if (layer.source !== session.scope) return { ok: false, reason: SLIDE_REJECT_WRONG_OWNER }
  if (!nativeItem(layer)) return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  const item = layer.item as NativeLayerItem
  if (!nativeTypes.includes(item.content.nativeType)) {
    return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  }
  if (item.locked) return { ok: false, reason: SLIDE_REJECT_LOCKED }
  return { ok: true, item }
}

export function beginV9SlideChartTextEdit(session: SlideAuthoringSession, layerItemId: string, field: ChartTextField): BeginV9SlideContentEditResult {
  const located = locateEditableNative(session, layerItemId, ['chart'])
  if (!located.ok) return located
  if (located.item.content.nativeType !== 'chart') return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  const text = readChartText(located.item.content.data, field)
  if (text === undefined) return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  const original: ChartTextDraft = { text, chart: structuredClone(located.item.content.data), error: null }
  return { ok: true, edit: freezeEdit({
    kind: 'chart-text', source: 'canvas', target: makeSlideAuthoringTarget(session, layerItemId, 'item'),
    chartField: field, composing: false, pendingAction: null, original, draft: structuredClone(original),
  }) }
}

export function beginV9SlideFieldTextEdit(session: SlideAuthoringSession, layerItemId: string, field: LayerTextField, packages: Readonly<Record<string, ComponentPackageData>> = {}): BeginV9SlideContentEditResult {
  const view = buildSlideEditorView({ project: session.history.present, locationId: session.selection.locationId, stateId: session.selection.stateId })
  const layer = view.layers.find(layer => layer.selectionId === layerItemId && layer.source === session.scope)
  if (!layer || layer.item.locked || !layer.item.visible) return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  const text = readLayerTextField(structuredClone(layer.item) as import('../../shared/courseProjectTypes').LayerItem, field, packages)
  if (text === undefined) return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_INVALID_TARGET }
  return { ok: true, edit: freezeEdit({
    kind: 'field-text', source: 'canvas', target: makeSlideAuthoringTarget(session, layerItemId, 'item'),
    textField: field, composing: false, pendingAction: null, original: { text }, draft: { text },
  }) }
}

export function updateV9SlideFieldTextDraft(edit: V9SlideContentEditSession, text: string, composing: boolean): V9SlideContentEditSession {
  if (edit.kind !== 'field-text') return edit
  return freezeEdit({ ...edit, draft: { text }, composing })
}

export function updateV9SlideChartTextDraft(edit: V9SlideContentEditSession, draft: ChartTextDraft, composing: boolean): V9SlideContentEditSession {
  if (edit.kind !== 'chart-text') return edit
  return freezeEdit({ ...edit, draft, composing })
}

export function beginV9SlideContentEdit(input: {
  readonly backend?: SlideAuthoringBackend | null
  readonly session?: SlideAuthoringSession
  readonly layerItemId: string
  readonly source?: V9SlideContentEditSource
}): BeginV9SlideContentEditResult {
  if (input.backend === null || (input.backend === undefined && !input.session)) {
    return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_NOT_CANDIDATE }
  }
  const session = input.backend?.getSession() ?? input.session
  if (!session) {
    return { ok: false, reason: V9_SLIDE_CONTENT_REJECT_NOT_CANDIDATE }
  }
  const located = locateEditableNative(session, input.layerItemId)
  if (!located.ok) return located
  const kind: V9SlideContentEditKind = located.item.content.nativeType === 'formula'
    ? 'formula'
    : 'text'
  const original = readContentSnapshot(located.item)
  const draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft = kind === 'text'
    ? {
      text: (original as V9SlideTextContentSnapshot).text,
      runs: structuredClone((original as V9SlideTextContentSnapshot).runs),
    }
    : {
      ast: structuredClone((original as V9SlideFormulaContentSnapshot).ast),
      accessibleText: (original as V9SlideFormulaContentSnapshot).accessibleText,
    }
  return {
    ok: true,
    edit: freezeEdit({
      kind,
      source: input.source ?? 'canvas',
      target: makeSlideAuthoringTarget(session, input.layerItemId),
      composing: false,
      pendingAction: null,
      original,
      draft,
    }),
  }
}

export function updateV9SlideContentTextDraft(
  edit: V9SlideContentEditSession,
  draft: V9SlideTextContentDraft,
): V9SlideContentEditSession {
  if (edit.kind !== 'text') return edit
  const previous = edit.draft as V9SlideTextContentDraft
  let runs = draft.runs
  if (!runs) {
    const mapping = planTextRunRemap(previous.text, draft.text, previous.runs)
    if (!mapping.ok) return edit
    runs = mapping.runs
  }
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs,
      ...(draft.width !== undefined ? { width: draft.width } : {}),
      ...(draft.height !== undefined ? { height: draft.height } : {}),
    },
  })
}

export function updateV9SlideContentFormulaDraft(
  edit: V9SlideContentEditSession,
  draft: V9SlideFormulaContentDraft,
): V9SlideContentEditSession {
  if (edit.kind !== 'formula') return edit
  return freezeEdit({
    ...edit,
    draft: {
      ast: structuredClone(draft.ast),
      accessibleText: draft.accessibleText ?? formulaAstToAccessibleText(draft.ast),
    },
  })
}

export function applyV9SlideContentEditRunStyle(
  edit: V9SlideContentEditSession,
  selectionStart: number,
  selectionEnd: number,
  patch: TextRunStyle,
): V9SlideContentEditSession {
  if (edit.kind !== 'text') return edit
  const draft = edit.draft as V9SlideTextContentDraft
  return freezeEdit({
    ...edit,
    draft: {
      ...draft,
      runs: applyTextRunStyle(
        draft.text,
        draft.runs,
        selectionStart,
        selectionEnd,
        patch,
      ),
    },
  })
}

function textDraftChanged(
  original: V9SlideTextContentSnapshot,
  draft: V9SlideTextContentDraft,
): boolean {
  if (draft.text !== original.text) return true
  if (!sameJson(draft.runs, original.runs)) return true
  if (draft.width !== undefined && draft.width !== original.width) return true
  if (draft.height !== undefined && draft.height !== original.height) return true
  return false
}

function formulaDraftChanged(
  original: V9SlideFormulaContentSnapshot,
  draft: V9SlideFormulaContentDraft,
): boolean {
  const accessibleText = draft.accessibleText ?? formulaAstToAccessibleText(draft.ast)
  return !sameJson(draft.ast, original.ast) || accessibleText !== original.accessibleText
}

export function isV9SlideContentDraftDirty(edit: V9SlideContentEditSession): boolean {
  if (edit.kind === 'chart-text' || edit.kind === 'field-text') return !sameJson(edit.original, edit.draft)
  if (edit.kind === 'text') {
    return textDraftChanged(
      edit.original as V9SlideTextContentSnapshot,
      edit.draft as V9SlideTextContentDraft,
    )
  }
  return formulaDraftChanged(
    edit.original as V9SlideFormulaContentSnapshot,
    edit.draft as V9SlideFormulaContentDraft,
  )
}

function rejectIfStaleEdit(
  session: SlideAuthoringSession,
  edit: V9SlideContentEditSession,
  options: CommitV9SlideContentOptions,
): SlideCommandResult | null {
  const liveGeneration = slideAuthoringGeneration(session.sessionId)
  const expectedGeneration = options.expectedGeneration ?? edit.target.generation
  if (
    expectedGeneration !== session.generation ||
    expectedGeneration !== liveGeneration ||
    edit.target.sessionId !== session.sessionId
  ) {
    return rejectSession(session, V9_SLIDE_CONTENT_REJECT_STALE_GENERATION)
  }
  const expectedRevision = options.expectedRevision ?? edit.target.revision
  if (expectedRevision !== session.history.present.revision) {
    return rejectSession(session, SLIDE_REJECT_STALE_REVISION)
  }
  return null
}

function deleteEmptyLayerOverride(
  overrides: Record<string, LayerItemOverride>,
  layerItemId: string,
): void {
  const override = overrides[layerItemId]
  if (override && Object.keys(override).length === 0) {
    delete overrides[layerItemId]
  }
}

function assignSparseNativeData(
  override: LayerItemOverride,
  baseData: Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  const nativeData = { ...(override.nativeData ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (sameJson(value, baseData[key])) delete nativeData[key]
    else nativeData[key] = structuredClone(value)
  }
  if (Object.keys(nativeData).length === 0) delete override.nativeData
  else override.nativeData = nativeData
}

function resolveWritableScene(
  project: CourseProjectDocument,
  session: SlideAuthoringSession,
): {
  scene: SlideSceneDocument
  state: SlidePresentationState | undefined
  surface: SlideSurfaceDocument
} {
  const location = project.locations.find(
    (candidate) => candidate.id === session.selection.locationId,
  )
  if (!location || location.kind !== 'slide-scene') {
    throw new SlideCommandError(SLIDE_REJECT_WRONG_OWNER, '当前位置不是幻灯片')
  }
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') {
    throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '当前幻灯片已失效')
  }
  const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
  if (!scene) {
    throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '当前幻灯片已失效')
  }
  const state = session.selection.stateId === null
    ? undefined
    : scene.presentation?.states.find((candidate) => candidate.id === session.selection.stateId)
  if (session.selection.stateId !== null && !state) {
    throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '当前状态已失效')
  }
  return { scene, state, surface }
}

function applyNativeContentPatch(
  item: NativeLayerItem,
  patch: Record<string, unknown>,
): void {
  if (item.locked) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
  }
  const data = item.content.data as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    data[key] = structuredClone(value)
  }
}

function writeNativeContent(
  project: CourseProjectDocument,
  session: SlideAuthoringSession,
  layerItemId: string,
  patch: Record<string, unknown>,
): void {
  if (session.scope === 'global') {
    const entry = project.globalLayerItems.find((candidate) => candidate.item.layerItemId === layerItemId)
    if (!entry || entry.item.kind !== 'native') {
      throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '所选元素已失效，请重新选择')
    }
    applyNativeContentPatch(entry.item, patch)
    return
  }
  if (session.scope === 'surface') {
    const { surface } = resolveWritableScene(project, session)
    const entry = surface.surfaceLayerItems.find((candidate) => candidate.item.layerItemId === layerItemId)
    if (!entry || entry.item.kind !== 'native') {
      throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '所选元素已失效，请重新选择')
    }
    applyNativeContentPatch(entry.item, patch)
    return
  }
  const { scene, state } = resolveWritableScene(project, session)
  const base = scene.layerItems.find((item) => item.layerItemId === layerItemId)
  if (!base || base.kind !== 'native') {
    throw new SlideCommandError(V9_SLIDE_CONTENT_REJECT_INVALID_TARGET, '所选元素已失效，请重新选择')
  }
  if (base.locked) {
    throw new SlideCommandError(SLIDE_REJECT_LOCKED, '当前元素已锁定')
  }
  if (!state) {
    applyNativeContentPatch(base, patch)
    return
  }
  const override = state.layerItemOverrides[base.layerItemId] ?? {}
  assignSparseNativeData(
    override,
    base.content.data as unknown as Record<string, unknown>,
    patch,
  )
  state.layerItemOverrides[base.layerItemId] = override
  deleteEmptyLayerOverride(state.layerItemOverrides, base.layerItemId)
}

function mutateContentDocument(
  session: SlideAuthoringSession,
  mutate: (draft: CourseProjectDocument) => void,
  now?: string,
): CourseProjectDocument {
  return commitSlideProjectMutation(session.history.present, mutate, now)
}

export function commitV9SlideContentEdit(
  session: SlideAuthoringSession,
  edit: V9SlideContentEditSession,
  options: CommitV9SlideContentOptions = {},
): SlideCommandResult {
  const commit = options.commit ?? defaultCommitV9SlideContentDocument
  if (edit.composing) return rejectSession(session, V9_SLIDE_CONTENT_REJECT_COMPOSING)
  const stale = rejectIfStaleEdit(session, edit, options)
  if (stale) return stale
  if (edit.kind === 'field-text') {
    const field = edit.textField
    if (!field) return rejectSession(session, V9_SLIDE_CONTENT_REJECT_INVALID_TARGET)
    const current = beginV9SlideFieldTextEdit(session, edit.target.layerItemId, field, options.componentPackages)
    if (!current.ok) return rejectSession(session, current.reason)
    if (!isV9SlideContentDraftDirty(edit)) return commitKeepingEditedLayer(commit(session, null), edit.target.layerItemId)
    const view = buildSlideEditorView({ project: session.history.present, locationId: session.selection.locationId, stateId: session.selection.stateId })
    const item = view.layers.find(layer => layer.selectionId === edit.target.layerItemId)!.item
    const text = (edit.draft as LayerTextDraft).text
    try {
      let patch: import('../course/effectiveLayerCommands').EffectiveLayerPropertiesPatchAtTarget
      if (field.kind === 'table-cell' && item.kind === 'native' && item.content.nativeType === 'table') {
        const result = patchSlideTableCellText(session, { layerItemId: edit.target.layerItemId, cellId: field.cellId, text }, { expectedRevision: edit.target.revision, now: options.now })
        if (!result.ok) return rejectSession(session, result.reason ?? '单元格文字提交失败')
        return commitKeepingEditedLayer(commit(session, result.nextSession?.history.present ?? null), edit.target.layerItemId)
      } else if (field.kind === 'component-prop' && item.kind === 'component') {
        patch = { componentProps: setComponentPropValue(structuredClone(item.props), field.key, text) }
      } else return rejectSession(session, V9_SLIDE_CONTENT_REJECT_INVALID_TARGET)
      const result = patchEffectiveLayerPropertiesAtTarget(session.history.present, {
        authoringAddress: edit.target.authoringAddress, locationId: session.selection.locationId, stateId: session.selection.stateId,
      }, patch, { expectedRevision: edit.target.revision, now: options.now })
      if (!result.ok) return rejectSession(session, result.reason ?? '文字提交失败')
      return commitKeepingEditedLayer(commit(session, result.nextDocument ?? null), edit.target.layerItemId)
    } catch (error) { return rejectSession(session, error instanceof Error ? error.message : '文字提交失败') }
  }
  if (edit.kind === 'chart-text') {
    if (!edit.chartField) return rejectSession(session, V9_SLIDE_CONTENT_REJECT_INVALID_TARGET)
    const current = beginV9SlideChartTextEdit(session, edit.target.layerItemId, edit.chartField)
    if (!current.ok) return rejectSession(session, current.reason)
    const draft = edit.draft as ChartTextDraft
    if (draft.error) return rejectSession(session, draft.error)
    if (!isV9SlideContentDraftDirty(edit)) return commitKeepingEditedLayer(commit(session, null), edit.target.layerItemId)
    try {
      const next = mutateContentDocument(session, project => {
        writeNativeContent(project, session, edit.target.layerItemId, draft.chart)
      }, options.now)
      return commitKeepingEditedLayer(commit(session, next), edit.target.layerItemId)
    } catch (error) {
      return rejectSession(session, error instanceof Error ? error.message : '图表文字提交失败')
    }
  }
  const located = locateEditableNative(session, edit.target.layerItemId)
  if (!located.ok) return rejectSession(session, located.reason)
  if (located.item.content.nativeType !== edit.kind) {
    return rejectSession(session, V9_SLIDE_CONTENT_REJECT_INVALID_TARGET)
  }

  try {
    if (edit.kind === 'text') {
      const original = edit.original as V9SlideTextContentSnapshot
      const draft = edit.draft as V9SlideTextContentDraft
      if (!textDraftChanged(original, draft)) {
        return commitKeepingEditedLayer(commit(session, null), edit.target.layerItemId)
      }
      const result = patchEffectiveLayerPropertiesAtTarget(session.history.present, {
        authoringAddress: edit.target.authoringAddress,
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
      }, {
        nativeData: { text: draft.text, runs: draft.runs },
        frame: { width: draft.width, height: draft.height },
      }, { expectedRevision: edit.target.revision, now: options.now })
      if (!result.ok) return rejectSession(session, result.reason ?? '文字提交失败')
      return commitKeepingEditedLayer(commit(session, result.nextDocument ?? null), edit.target.layerItemId)
    }

    const original = edit.original as V9SlideFormulaContentSnapshot
    const draft = edit.draft as V9SlideFormulaContentDraft
    if (!formulaDraftChanged(original, draft)) {
      return commitKeepingEditedLayer(commit(session, null), edit.target.layerItemId)
    }
    const accessibleText = draft.accessibleText ?? formulaAstToAccessibleText(draft.ast)
    const next = mutateContentDocument(session, (project) => {
      writeNativeContent(project, session, edit.target.layerItemId, {
        ast: draft.ast,
        accessibleText,
      })
    }, options.now)
    return commitKeepingEditedLayer(commit(session, next), edit.target.layerItemId)
  } catch (error) {
    if (error instanceof SlideCommandError) return rejectSession(session, error.reason)
    if (error instanceof Error) return rejectSession(session, error.message)
    return rejectSession(session, '命令失败')
  }
}

export function cancelV9SlideContentEdit(
  session: SlideAuthoringSession,
  edit: V9SlideContentEditSession,
  options: CommitV9SlideContentOptions = {},
): SlideCommandResult {
  const stale = rejectIfStaleEdit(session, edit, options)
  if (stale) return stale
  return succeedIdentity(session)
}

export function commitV9SlideTextRunStyle(
  session: SlideAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly selectionStart: number
    readonly selectionEnd: number
    readonly patch: TextRunStyle
    readonly source?: V9SlideContentEditSource
  },
  options: CommitV9SlideContentOptions = {},
): SlideCommandResult {
  const begun = beginV9SlideContentEdit({
    session,
    layerItemId: input.layerItemId,
    source: input.source ?? 'properties',
  })
  if (!begun.ok) return rejectSession(session, begun.reason)
  const edited = applyV9SlideContentEditRunStyle(
    begun.edit,
    input.selectionStart,
    input.selectionEnd,
    input.patch,
  )
  return commitV9SlideContentEdit(session, edited, options)
}

export function readV9SlideNativeContent(
  session: SlideAuthoringSession,
  layerItemId: string,
): NativeLayerItem | null {
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer || layer.item.kind !== 'native') return null
  return layer.item as NativeLayerItem
}
