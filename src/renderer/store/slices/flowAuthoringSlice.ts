import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { FormulaAstNode } from '../../../shared/contracts/native-v1'
import type { TextRun, TextRunStyle } from '../../../shared/projectTypes'
import type { CourseAssetSidecar } from '../../project/v9AssetAdapter'
import { emptyCourseAssetSidecar, freezeCourseAssetSidecar } from '../../project/v9AssetAdapter'
import { createImageAssetImport, createMediaAssetImport } from '../../project/assetManager'
import type { FlowAuthoringSession } from '../../project/createFlowCourseProject'
import {
  commitFlowEditorHistory,
  flowEditorLegacyHistoryEntryCount,
  flowEditorRedoResourceTransition,
  flowEditorUndoResourceTransition,
  redoFlowEditorHistory,
  flowBlockTargetFromSelection,
  selectFlowEditorBlock,
  selectFlowEditorBlocks,
  selectFlowOverlay,
  undoFlowEditorHistory,
  type FlowEditorHistory,
  type FlowEditorSelection,
} from '../../course/flowEditorSlice'
import {
  executeFlowDelete,
  executeFlowEditorCommand,
  importAndReplaceFlowMediaBlock,
  insertFlowEditorBlock,
  replaceFlowMediaBlockAsset,
  updateFlowEditorBlock,
  updateFlowSurfaceBackgroundColor,
  type FlowCommandResult,
  type FlowDeleteRequest,
  type FlowEditorCommandRequest,
} from '../../course/flowEditorCommands'
import {
  findGlobalTeacherController,
  patchEffectiveLayerItem,
  restoreDefaultTeacherController,
} from '../../course/effectiveLayerCommands'
import { buildCandidateEffectiveLayers } from '../../course/activeSurfaceProjection'
import { commandTargetForRow } from '../v9LayerMutations'
import {
  enterFlowGlobalAuthoring,
  commitFlowOverlayFormulaAst,
  convertFlowComponentBlockToOverlay,
  convertFlowMediaBlockToOverlay,
  convertFlowOverlayComponentToDocument,
  convertFlowOverlayMediaToDocument,
  insertFlowSharedMedia,
  insertFlowSharedShape,
  patchFlowOverlayPaperSpace,
  transformFlowOverlayFrame,
  type FlowSharedAuthoringResult,
} from '../../course/flowSharedAuthoringAdapters'
import {
  applyFlowTextEditGesture,
  beginFlowFormulaEdit,
  commitFlowFormulaAst,
  commitFlowTextEdit,
  formatFlowAuthoringBlock,
  formatFlowAuthoringTextStyle,
  flowTextEditSelection,
  isFlowTextDraftDirty,
  type FlowTextEditSession,
} from '../../authoring/flowTextEdit'
import { findFlowBlockRecursive, flowSurfaceIn } from '../../course/flowDocumentModel'
import { nanoid } from 'nanoid'
import { LAYER_REJECT_STALE_REVISION } from '../../course/effectiveLayerCommands'
import { commitSlideProjectMutation } from '../../course/slideEditorCommands'
import {
  COURSE_AUTHORING_STALE_SESSION_REASON,
  validateCourseAuthoringTarget,
  surfaceTypeForLocation,
  switchCourseAuthoringLocation,
  updateCourseAuthoringSessionItems,
  type CourseAuthoringSession,
  type CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import {
  buildFlowEditorView,
  captureFlowEditorAuthoringTarget,
} from '../../course/flowEditorView'
import type { EditorTransactionStep } from '../../authoring/editorTransaction'
import { exclusiveInactiveSurfaces } from '../../composition/surfaceRouter'
import {
  commitSurfaceResourcePersist,
  courseSessionAfterSurfaceHistory,
  type EditorStoreKernel,
} from '../editorStoreKernel'
import {
  continuedCourseResourceStacks,
  readCourseResourceState,
  type CourseResourceHistoryContinuation,
  type CourseResourceState,
  type CourseResourceTransition,
} from '../courseResourceState'

export type FlowOwnedState = {
  flowSession: FlowAuthoringSession | null
  flowTextEdit: FlowTextEditSession | null
}

export type FlowPersistExtra = {
  statusMessage?: string | null
  sidecar?: CourseAssetSidecar
  sidecarDirection?: 'undo' | 'redo'
  componentPackages?: Record<string, ComponentPackageData>
  selection?: FlowEditorSelection | null
  clearTextEdit?: boolean
  textEdit?: FlowTextEditSession | null
  committedTextEdit?: FlowTextEditSession
  discardedTextEdit?: FlowTextEditSession
  replaceHistory?: FlowEditorHistory
  transactionStep?: EditorTransactionStep
  resourceTransition?: CourseResourceTransition
}

export type FlowPersistSnapshot = FlowOwnedState & {
  resources: CourseResourceState
  dirty: boolean
  authoringSession: CourseAuthoringSession | null
}

export type FlowApplyBackendExtra = {
  sidecar?: CourseAssetSidecar
  path?: string | null
  dirty?: boolean
  statusMessage?: string | null
  componentPackages?: Record<string, ComponentPackageData>
  canvasMode?: 'edit' | 'run'
  resourceHistory?: CourseResourceHistoryContinuation
}

export type FlowAuthoringPorts = {
  read(): FlowOwnedState
  readAuthoringSession(): CourseAuthoringSession | null
  readAssetSidecar(): CourseAssetSidecar | null
  patch(patch: Partial<FlowOwnedState>): void
  persist(
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra?: FlowPersistExtra,
  ): FlowCommandResult | FlowSharedAuthoringResult
  applyBackend(session: FlowAuthoringSession, extra?: FlowApplyBackendExtra): void
}

export type FlowAuthoringIntent = (
  | {
      readonly kind: 'select-blocks'
      readonly blockIds: readonly string[]
      readonly focus?: 'block' | 'text'
      readonly textRange?: FlowEditorSelection['textRange']
    }
  | { readonly kind: 'select-overlay'; readonly layerItemIds: readonly string[] }
  | {
      readonly kind: 'begin-text-edit'
      readonly gesture: 'double-click' | 'enter' | 'click-text'
      readonly offset?: number
      readonly end?: number
      readonly listItemId?: string
      readonly tableRowId?: string
      readonly tableColumnId?: string
    }
  | { readonly kind: 'begin-formula-edit' }
  | {
      readonly kind: 'update-text-edit'
      readonly expectedEdit: FlowTextEditSession
      readonly edit: FlowTextEditSession | null
    }
  | {
      readonly kind: 'commit-text-edit'
      readonly edit: FlowTextEditSession
      readonly keepSelected?: boolean
      readonly nextBlockId?: string
    }
  | { readonly kind: 'cancel-text-edit'; readonly edit: FlowTextEditSession }
  | {
      readonly kind: 'format-text-style'
      readonly style: TextRunStyle
      readonly expectedEdit: FlowTextEditSession | null
    }
  | { readonly kind: 'format-block'; readonly spec: Parameters<typeof formatFlowAuthoringBlock>[2] }
  | {
      readonly kind: 'execute-editor-command'
      readonly blockIds: readonly string[]
      readonly command: FlowEditorCommandRequest
    }
  | {
      readonly kind: 'delete-blocks'
      readonly blockIds: readonly string[]
      readonly direction?: 'backward' | 'forward'
    }
  | {
      readonly kind: 'transform-overlay-frame'
      readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
    }
  | {
      readonly kind: 'commit-block-formula'
      readonly ast: FormulaAstNode
      readonly accessibleText: string
      readonly expectedEdit: FlowTextEditSession | null
    }
  | { readonly kind: 'rename-page'; readonly title: string }
  | { readonly kind: 'set-paper-background'; readonly backgroundColor: string }
  | { readonly kind: 'patch-block'; readonly patch: Record<string, unknown> }
  | { readonly kind: 'replace-media-asset'; readonly assetId: string }
  | {
      readonly kind: 'import-replacement-media'
      readonly name: string
      readonly mimeType: string
      readonly bytes: Uint8Array
    }
  | { readonly kind: 'move-block'; readonly direction: 'up' | 'down' }
  | { readonly kind: 'convert-block-to-overlay' }
  | { readonly kind: 'convert-overlay-to-document' }
  | { readonly kind: 'patch-overlay-paper-space'; readonly paperSpace: 'viewport' | 'paper' }
  | { readonly kind: 'commit-overlay-formula'; readonly ast: FormulaAstNode; readonly accessibleText: string }
) & {
  /** Exact edit visible when a document mutation callback was created. */
  readonly expectedEdit?: FlowTextEditSession | null
}

export interface FlowAuthoringReceipt {
  readonly ok: boolean
  readonly reason?: string
  readonly historyEntry: boolean
  readonly edit?: FlowTextEditSession | null
}

const FLOW_ACTIVE_EDIT_REQUIRES_ATOMIC_COMMIT =
  '当前文字草稿尚未原子提交，请完成文字编辑后重试'

function flowIntentMutatesDocument(intent: FlowAuthoringIntent): boolean {
  switch (intent.kind) {
    case 'format-block':
    case 'execute-editor-command':
    case 'delete-blocks':
    case 'transform-overlay-frame':
    case 'rename-page':
    case 'set-paper-background':
    case 'patch-block':
    case 'replace-media-asset':
    case 'import-replacement-media':
    case 'move-block':
    case 'convert-block-to-overlay':
    case 'convert-overlay-to-document':
    case 'patch-overlay-paper-space':
    case 'commit-overlay-formula':
      return true
    default:
      return false
  }
}

function flowEditMatchesTarget(
  edit: FlowTextEditSession,
  target: CourseAuthoringTarget,
): boolean {
  return edit.blockId === target.itemId
    && edit.surfaceId === target.surfaceId
    && edit.revision === target.documentRevision
}

function sameFlowEditIdentity(
  left: FlowTextEditSession,
  right: FlowTextEditSession,
): boolean {
  return left.kind === right.kind
    && left.source === right.source
    && left.blockId === right.blockId
    && left.surfaceId === right.surfaceId
    && left.parentId === right.parentId
    && left.listItemId === right.listItemId
    && left.tableRowId === right.tableRowId
    && left.tableColumnId === right.tableColumnId
    && left.field === right.field
    && left.revision === right.revision
}

function sameFlowEditorSelection(
  left: FlowEditorSelection,
  right: FlowEditorSelection,
): boolean {
  const leftRange = left.textRange
  const rightRange = right.textRange
  const sameRange = leftRange === null
    ? rightRange === null
    : rightRange !== null
      && leftRange.blockId === rightRange.blockId
      && leftRange.start === rightRange.start
      && leftRange.end === rightRange.end
      && leftRange.listItemId === rightRange.listItemId
      && leftRange.tableRowId === rightRange.tableRowId
      && leftRange.tableColumnId === rightRange.tableColumnId
  return left.locationId === right.locationId
    && left.surfaceId === right.surfaceId
    && left.authoringScope === right.authoringScope
    && left.focus === right.focus
    && left.selectedBlockId === right.selectedBlockId
    && sameRange
    && left.authoringAddress === right.authoringAddress
    && left.selectedBlockIds.length === right.selectedBlockIds.length
    && left.selectedBlockIds.every((id, index) => id === right.selectedBlockIds[index])
    && left.selectedOverlayIds.length === right.selectedOverlayIds.length
    && left.selectedOverlayIds.every((id, index) => id === right.selectedOverlayIds[index])
}

export function persistFlowResult(
  snapshot: FlowPersistSnapshot,
  commit: (patch: Record<string, unknown>) => void,
  result: FlowCommandResult | FlowSharedAuthoringResult,
  extra: FlowPersistExtra = {},
): FlowCommandResult | FlowSharedAuthoringResult {
  const session = snapshot.flowSession
  if (!session) return result
  if (!result.ok) {
    if (result.reason) {
      commit({ errorMessage: result.reason, statusMessage: null })
    }
    return result
  }
  const openEdit = snapshot.flowTextEdit
  const commitsOpenEdit = Boolean(openEdit && Object.is(extra.committedTextEdit, openEdit))
  const discardsOpenEdit = Boolean(openEdit && Object.is(extra.discardedTextEdit, openEdit))
  if (
    openEdit
    && isFlowTextDraftDirty(openEdit)
    && (
      (
        result.historyEntry
        && (
          (commitsOpenEdit && openEdit.revision !== session.history.present.revision)
          || (!commitsOpenEdit && !discardsOpenEdit)
        )
      )
      || (extra.clearTextEdit && !commitsOpenEdit && !discardsOpenEdit)
    )
  ) {
    const rejected = {
      ok: false as const,
      reason: FLOW_ACTIVE_EDIT_REQUIRES_ATOMIC_COMMIT,
      historyEntry: false,
    }
    commit({ errorMessage: rejected.reason, statusMessage: null })
    return rejected
  }
  const nextDocument = extra.replaceHistory?.present ?? result.nextDocument ?? session.history.present
  const history = extra.replaceHistory ?? (result.historyEntry
    ? commitFlowEditorHistory(session.history, nextDocument)
    : { ...session.history, present: nextDocument })
  const nextSelection = extra.selection === undefined
    ? (result.selection ?? session.selection)
    : extra.selection
  const selection = nextSelection ?? session.selection
  if (
    (extra.transactionStep || extra.resourceTransition)
    && (extra.sidecar || extra.sidecarDirection)
  ) {
    throw new Error('Flow 资源事务不能同时使用完整 sidecar 快照')
  }
  const committed = commitSurfaceResourcePersist(snapshot.resources, {
    document: history.present,
    applyDocument: session.history.present,
    transactionStep: extra.transactionStep,
    resourceTransition: extra.resourceTransition,
    sidecar: extra.sidecar,
    sidecarDirection: extra.sidecarDirection,
    componentPackages: extra.componentPackages,
    historyEntry: result.historyEntry,
    legacyPastCount: flowEditorLegacyHistoryEntryCount(history.past),
    legacyFutureCount: flowEditorLegacyHistoryEntryCount(history.future),
  })
  const nextSession: FlowAuthoringSession = { history, selection }
  const historyAdjustedCourseSession = courseSessionAfterSurfaceHistory(
    snapshot.authoringSession,
    history.present,
    selection.locationId,
    extra,
  ) ?? snapshot.authoringSession
  const nextItemIds = sameFlowEditorSelection(session.selection, selection)
    ? (historyAdjustedCourseSession?.itemIds ?? [])
    : selection.selectedOverlayIds.length > 0
      ? selection.selectedOverlayIds
      : selection.selectedBlockIds
  const switchedCourseSession = historyAdjustedCourseSession
    ? switchCourseAuthoringLocation(historyAdjustedCourseSession, {
        locationId: selection.locationId,
        surfaceType: surfaceTypeForLocation(history.present, selection.locationId),
        revision: history.present.revision,
      })
    : null
  const nextCourseAuthoringSession = switchedCourseSession && 'token' in switchedCourseSession
    ? updateCourseAuthoringSessionItems(
        switchedCourseSession,
        nextItemIds,
      )
    : undefined
  commit({
    flowSession: nextSession,
    flowTextEdit: extra.textEdit !== undefined
      ? extra.textEdit
      : extra.clearTextEdit || Boolean(result.historyEntry && openEdit && !commitsOpenEdit)
        ? null
        : snapshot.flowTextEdit,
    spatialSession: null,
    slideCandidateSnapshot: null,
    ...committed,
    dirty: extra.transactionStep || extra.resourceTransition || extra.sidecarDirection || result.historyEntry
      ? true
      : snapshot.dirty,
    selectedNodeIds: [...selection.selectedOverlayIds],
    selectedNodeId: selection.selectedOverlayIds.at(-1) ?? null,
    editingScope: selection.authoringScope === 'global' ? 'global' : 'scene',
    activeSceneId: selection.locationId,
    activePresentationStateId: null,
    errorMessage: null,
    ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
    ...(nextCourseAuthoringSession
      ? { courseAuthoringSession: nextCourseAuthoringSession }
      : {}),
  })
  return result
}

export function applyFlowBackendState(
  session: FlowAuthoringSession,
  extra: {
    sidecar?: CourseAssetSidecar
    path?: string | null
    dirty?: boolean
    statusMessage?: string | null
    componentPackages?: Record<string, ComponentPackageData>
    canvasMode?: 'edit' | 'run'
    resourceHistory?: CourseResourceHistoryContinuation
  } = {},
): Record<string, unknown> {
  const sidecar = extra.sidecar ?? emptyCourseAssetSidecar()
  return {
    ...exclusiveInactiveSurfaces('flow'),
    flowSession: session,
    flowTextEdit: null,
    ...continuedCourseResourceStacks(extra.resourceHistory),
    courseAssetSidecar: sidecar,
    activeSceneId: session.selection.locationId,
    activePresentationStateId: null,
    editingScope: session.selection.authoringScope === 'global' ? 'global' : 'scene',
    selectedNodeIds: [...session.selection.selectedOverlayIds],
    selectedNodeId: session.selection.selectedOverlayIds.at(-1) ?? null,
    editingTextNodeId: null,
    canvasMode: extra.canvasMode ?? 'edit',
    errorMessage: null,
    dirty: extra.dirty ?? false,
    projectPath: extra.path === undefined ? null : extra.path,
    statusMessage: extra.statusMessage ?? `已打开“${session.history.present.title}”`,
    componentPackages: extra.componentPackages ?? {},
  }
}

function flowLocationBlockId(
  locations: FlowAuthoringSession['history']['present']['locations'],
  locationId: string,
): string | undefined {
  const location = locations.find((item) => item.id === locationId)
  return location?.kind === 'flow-block' ? location.blockId : undefined
}

function flowReceipt(
  result: Pick<FlowCommandResult | FlowSharedAuthoringResult, 'ok' | 'reason' | 'historyEntry'>,
  edit?: FlowTextEditSession | null,
): FlowAuthoringReceipt {
  return {
    ok: result.ok,
    ...(result.reason ? { reason: result.reason } : {}),
    historyEntry: Boolean(result.historyEntry),
    ...(edit === undefined ? {} : { edit }),
  }
}

function rejectedFlowReceipt(reason: string): FlowAuthoringReceipt {
  return { ok: false, reason, historyEntry: false }
}

type ResolvedFlowAuthoringTarget = {
  readonly session: FlowAuthoringSession
  readonly document: FlowAuthoringSession['history']['present']
}

function resolveFlowAuthoringTarget(
  flow: FlowAuthoringPorts,
  target: CourseAuthoringTarget,
): ResolvedFlowAuthoringTarget | FlowAuthoringReceipt {
  const session = flow.read().flowSession
  const authoringSession = flow.readAuthoringSession()
  if (!session || !authoringSession) {
    return rejectedFlowReceipt('没有活动的 Flow 编辑会话')
  }
  const document = session.history.present
  let view
  try {
    view = buildFlowEditorView({
      project: document,
      locationId: session.selection.locationId,
    })
  } catch {
    return rejectedFlowReceipt('没有活动的 Flow 编辑会话')
  }
  let canonicalTarget: CourseAuthoringTarget
  try {
    const block = view.blocks.find((entry) => entry.blockId === target.itemId)
    const layer = view.overlayLayers.find((entry) => entry.selectionId === target.itemId)
    canonicalTarget = captureFlowEditorAuthoringTarget({
      view,
      sessionToken: authoringSession.token,
      target: target.itemId === view.surfaceId
        ? { kind: 'surface' }
        : block
          ? { kind: 'block', blockId: block.blockId }
          : layer
            ? { kind: 'overlay', layerItemId: layer.selectionId }
            : (() => { throw new Error(COURSE_AUTHORING_STALE_SESSION_REASON) })(),
    })
  } catch {
    return rejectedFlowReceipt(COURSE_AUTHORING_STALE_SESSION_REASON)
  }
  const validation = validateCourseAuthoringTarget({
    target,
    current: {
      projectId: document.id,
      documentRevision: document.revision,
      sessionToken: authoringSession.token,
      surfaceId: view.surfaceId,
      stateId: null,
      owner: canonicalTarget.owner,
      ownerKey: canonicalTarget.ownerKey,
    },
    hasItem: (captured) => (
      captured.itemId === canonicalTarget.itemId
      && captured.owner === canonicalTarget.owner
      && captured.ownerKey === canonicalTarget.ownerKey
      && captured.authoringAddress === canonicalTarget.authoringAddress
    ),
  })
  if (!validation.ok) return rejectedFlowReceipt(validation.reason)
  return { session, document }
}

function flowBlockSelection(
  document: FlowAuthoringSession['history']['present'],
  target: CourseAuthoringTarget,
  blockIds: readonly string[] = [target.itemId],
  options: {
    focus?: 'block' | 'text'
    textRange?: FlowEditorSelection['textRange']
  } = {},
): FlowEditorSelection {
  return selectFlowEditorBlocks(document, target.locationId, blockIds, options)
}

function flowOverlaySelection(
  document: FlowAuthoringSession['history']['present'],
  target: CourseAuthoringTarget,
  layerItemIds: readonly string[] = [target.itemId],
): FlowEditorSelection {
  return selectFlowOverlay(
    document,
    target.locationId,
    layerItemIds,
    target.owner === 'global' ? 'global' : 'page',
  )
}

export function createFlowAuthoringSlice(
  _kernel: EditorStoreKernel,
  flow: FlowAuthoringPorts,
): {
  runFlowAuthoringIntent(
    target: CourseAuthoringTarget,
    intent: FlowAuthoringIntent,
  ): FlowAuthoringReceipt
  applyFlowCommand(
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra?: { statusMessage?: string | null; sidecar?: CourseAssetSidecar },
  ): FlowCommandResult | FlowSharedAuthoringResult
  deleteFlowSelection(request: FlowDeleteRequest): FlowCommandResult
  applyFlowSelection(selection: FlowEditorSelection | null): void
  setFlowTextEdit(edit: FlowTextEditSession | null): void
  insertFlowLibraryMedia(
    assetId: string,
    request?: { altKey?: boolean; menuAction?: 'insert-document' | 'insert-overlay' },
  ): FlowSharedAuthoringResult
  formatFlowTextStyle(style: TextRunStyle): FlowCommandResult
  formatFlowBlock(spec: Parameters<typeof formatFlowAuthoringBlock>[2]): FlowCommandResult
  renameFlowHeading(locationId: string, title: string): void
  renameFlowPage(surfaceId: string, title: string): void
  commitDraft(): boolean
  undo(): void
  redo(): void
  setScope(scope: 'global' | 'scene'): void
  renameProject(title: string): void
  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(shapeType: string, x?: number, y?: number): void
  beginTextEdit(_nodeId: string, _source?: 'canvas' | 'properties'): void
  updateTextEditDraft(_nodeId: string, _text: string, _runs: TextRun[], _height?: number, _width?: number): void
  commitTextEdit(): void
  cancelTextEdit(): void
  selectNode(nodeId: string | null, additive?: boolean): void
  ensureTeacherController(): void
  selectNodes(nodeIds: string[]): void
  updateNodes(patches: Array<{ nodeId: string; patch: import('../../phaser/editorCanvasNode').EditorCanvasNodePatch }>): void
  updateNode(nodeId: string, patch: import('../../phaser/editorCanvasNode').EditorCanvasNodePatch): void
  copySelectedNodes(): void
  pasteNodes(): void
  deleteNode(nodeId: string): void
  deleteSelectedNodes(): void
  duplicateSelectedNodes(): void
  duplicateNode(nodeId: string): void
} {
  const missingSession = (): FlowCommandResult => ({
    ok: false,
    reason: '请先选择一个流式页面',
    historyEntry: false,
  })

  const commitDraft = (): boolean => {
    const owned = flow.read()
    const session = owned.flowSession
    const edit = owned.flowTextEdit
    if (!session || !edit) return true
    if (edit.revision !== session.history.present.revision) {
      flow.persist({
        ok: false,
        reason: LAYER_REJECT_STALE_REVISION,
        historyEntry: false,
      })
      return false
    }
    if (!edit.composing && !isFlowTextDraftDirty(edit)) {
      flow.patch({ flowTextEdit: null })
      return true
    }
    const result = commitFlowTextEdit(
      session.history.present,
      flowTextEditSelection(
        session.history.present,
        session.selection.locationId,
        edit,
      ),
      edit,
      { expectedRevision: edit.revision },
    )
    flow.persist(result, {
      clearTextEdit: result.ok,
      committedTextEdit: edit,
      ...(result.ok
        ? {
            selection: selectFlowEditorBlocks(
              result.nextDocument ?? session.history.present,
              session.selection.locationId,
              [edit.blockId],
            ),
          }
        : {}),
    })
    return result.ok
  }

  const selectNode = (nodeId: string | null, additive = false): void => {
    if (!commitDraft()) return
    const session = flow.read().flowSession
    if (!session) return
    const document = session.history.present
    if (nodeId === null) {
      flow.persist({
        ok: true,
        nextDocument: document,
        historyEntry: false,
        selection: selectFlowEditorBlock(
          document,
          session.selection.locationId,
          session.selection.selectedBlockId ?? session.selection.locationId,
        ),
      }, { selection: session.selection, clearTextEdit: true })
      return
    }
    const projection = buildCandidateEffectiveLayers({
      slideBackend: null,
      spatialSession: null,
      flowSession: session,
    })
    const overlayRow = projection?.unifiedRows.find((row) => row.id === nodeId)
    if (overlayRow) {
      const previous = session.selection.selectedOverlayIds
      const selectedNodeIds = additive
        ? previous.includes(nodeId)
          ? previous.filter((id) => id !== nodeId)
          : [...previous, nodeId]
        : [nodeId]
      flow.persist({
        ok: true,
        nextDocument: document,
        historyEntry: false,
        selection: selectFlowOverlay(
          document,
          session.selection.locationId,
          selectedNodeIds,
          session.selection.authoringScope,
        ),
      }, { clearTextEdit: true })
      return
    }
    try {
      flow.persist({
        ok: true,
        nextDocument: document,
        historyEntry: false,
        selection: selectFlowEditorBlock(document, session.selection.locationId, nodeId),
      }, { clearTextEdit: true })
    } catch {
      flow.persist({
        ok: true,
        nextDocument: document,
        historyEntry: false,
        selection: session.selection,
      }, { clearTextEdit: true })
    }
  }

  const updateNodes = (
    patches: Array<{
      nodeId: string
      patch: import('../../phaser/editorCanvasNode').EditorCanvasNodePatch
    }>,
  ): void => {
    if (patches.length === 0 || !commitDraft()) return
    const session = flow.read().flowSession
    if (!session) return
    const projection = buildCandidateEffectiveLayers({
      slideBackend: null,
      spatialSession: null,
      flowSession: session,
    })
    for (const item of patches) {
      const row = projection?.unifiedRows.find((candidate) => candidate.id === item.nodeId)
      if (!row) continue
      if (item.patch.locked !== undefined) {
        const result = patchEffectiveLayerItem(
          flow.read().flowSession?.history.present ?? session.history.present,
          commandTargetForRow(row),
          { locked: Boolean(item.patch.locked) },
          { expectedRevision: flow.read().flowSession?.history.present.revision ?? session.history.present.revision },
        )
        if (result.ok && result.nextDocument) {
          flow.persist({
            ok: true,
            nextDocument: result.nextDocument,
            historyEntry: Boolean(result.historyEntry),
            selection: session.selection,
          })
        }
      }
      if (item.patch.visible !== undefined) {
        const live = flow.read().flowSession ?? session
        const result = patchEffectiveLayerItem(
          live.history.present,
          commandTargetForRow(row),
          { visible: Boolean(item.patch.visible) },
          { expectedRevision: live.history.present.revision },
        )
        if (result.ok && result.nextDocument) {
          flow.persist({
            ok: true,
            nextDocument: result.nextDocument,
            historyEntry: Boolean(result.historyEntry),
            selection: live.selection,
          })
        }
      }
    }
  }

  const runFlowAuthoringIntent = (
    target: CourseAuthoringTarget,
    intent: FlowAuthoringIntent,
  ): FlowAuthoringReceipt => {
    const resolved = resolveFlowAuthoringTarget(flow, target)
    if (!('session' in resolved)) return resolved
    const { session } = resolved
    let document = resolved.document
    let committedEdit: FlowTextEditSession | null = null
    let committedSelection: FlowEditorSelection | null = null
    let committedHistoryEntry = false

    if (flowIntentMutatesDocument(intent)) {
      const currentEdit = flow.read().flowTextEdit
      if (!Object.is(currentEdit, intent.expectedEdit ?? null)) {
        return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
      }
      if (currentEdit) {
        if (currentEdit.revision !== document.revision) {
          return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
        }
        const textSelection = flowTextEditSelection(
          document,
          session.selection.locationId,
          currentEdit,
        )
        const committed = commitFlowTextEdit(document, textSelection, currentEdit, {
          expectedRevision: currentEdit.revision,
        })
        if (!committed.ok) {
          return rejectedFlowReceipt(committed.reason ?? '文字草稿提交失败')
        }
        document = committed.nextDocument ?? document
        committedEdit = currentEdit
        committedHistoryEntry = Boolean(committed.historyEntry)
        committedSelection = selectFlowEditorBlocks(
          document,
          session.selection.locationId,
          [currentEdit.blockId],
        )
      }
    }

    const persistIntentResult = (
      result: FlowCommandResult | FlowSharedAuthoringResult,
      extra: FlowPersistExtra = {},
      edit?: FlowTextEditSession | null,
    ): FlowAuthoringReceipt => {
      if (committedEdit && !result.ok) return flowReceipt(result, edit)
      const combined = committedEdit && result.ok
        ? {
            ...result,
            nextDocument: result.nextDocument ?? document,
            historyEntry: committedHistoryEntry || Boolean(result.historyEntry),
          }
        : result
      const combinedExtra = committedEdit
        ? {
            ...extra,
            selection: extra.selection ?? result.selection ?? committedSelection ?? session.selection,
            clearTextEdit: true,
            committedTextEdit: committedEdit,
          }
        : extra
      const persisted = flow.persist(combined, combinedExtra)
      return flowReceipt(persisted, committedEdit ? null : edit)
    }

    try {
      switch (intent.kind) {
        case 'select-blocks': {
          const selection = flowBlockSelection(document, target, intent.blockIds, {
            ...(intent.focus ? { focus: intent.focus } : {}),
            ...(intent.textRange !== undefined ? { textRange: intent.textRange } : {}),
          })
          return persistIntentResult({
            ok: true,
            nextDocument: document,
            historyEntry: false,
            selection,
          }, {
            selection,
            clearTextEdit: selection.focus !== 'text',
          })
        }
        case 'select-overlay': {
          const selection = flowOverlaySelection(document, target, intent.layerItemIds)
          return persistIntentResult({
            ok: true,
            nextDocument: document,
            historyEntry: false,
            selection,
          }, { selection, clearTextEdit: true })
        }
        case 'begin-text-edit': {
          if (flow.read().flowTextEdit) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          const selection = flowBlockSelection(document, target)
          const begun = applyFlowTextEditGesture({
            project: document,
            selection,
            blockId: target.itemId,
            gesture: intent.gesture,
            locationId: target.locationId,
            ...(intent.offset === undefined ? {} : { offset: intent.offset }),
            ...(intent.end === undefined ? {} : { end: intent.end }),
            ...(intent.listItemId ? { listItemId: intent.listItemId } : {}),
            ...(intent.tableRowId ? { tableRowId: intent.tableRowId } : {}),
            ...(intent.tableColumnId ? { tableColumnId: intent.tableColumnId } : {}),
          })
          if (!begun.ok) return rejectedFlowReceipt(begun.reason)
          return persistIntentResult({
            ok: true,
            nextDocument: document,
            historyEntry: false,
            selection: begun.selection,
          }, { selection: begun.selection, textEdit: begun.edit }, begun.edit)
        }
        case 'begin-formula-edit': {
          if (flow.read().flowTextEdit) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          const selection = flowBlockSelection(document, target)
          const begun = beginFlowFormulaEdit({
            project: document,
            selection,
            blockId: target.itemId,
          })
          if (!begun.ok) return rejectedFlowReceipt(begun.reason)
          return persistIntentResult({
            ok: true,
            nextDocument: document,
            historyEntry: false,
            selection: begun.selection,
          }, { selection: begun.selection, textEdit: begun.edit }, begun.edit)
        }
        case 'update-text-edit': {
          if (
            !Object.is(flow.read().flowTextEdit, intent.expectedEdit)
            || !flowEditMatchesTarget(intent.expectedEdit, target)
            || (
              intent.edit
              && (
                !sameFlowEditIdentity(intent.expectedEdit, intent.edit)
                || !flowEditMatchesTarget(intent.edit, target)
              )
            )
          ) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          flow.patch({ flowTextEdit: intent.edit })
          return { ok: true, historyEntry: false, edit: intent.edit }
        }
        case 'commit-text-edit': {
          if (
            !Object.is(flow.read().flowTextEdit, intent.edit)
            || !flowEditMatchesTarget(intent.edit, target)
          ) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          const textRange = {
            blockId: target.itemId,
            start: intent.edit.range.start,
            end: intent.edit.range.end,
            ...(intent.edit.listItemId ? { listItemId: intent.edit.listItemId } : {}),
            ...(intent.edit.tableRowId ? { tableRowId: intent.edit.tableRowId } : {}),
            ...(intent.edit.tableColumnId ? { tableColumnId: intent.edit.tableColumnId } : {}),
          }
          const selection = flowBlockSelection(document, target, [target.itemId], {
            focus: 'text',
            textRange,
          })
          const result = commitFlowTextEdit(document, selection, intent.edit, {
            expectedRevision: target.documentRevision,
          })
          const resultDocument = result.nextDocument ?? document
          const nextSelection = flowBlockSelection(
            resultDocument,
            target,
            [intent.nextBlockId ?? target.itemId],
          )
          return persistIntentResult(result, {
            selection: nextSelection,
            clearTextEdit: result.ok,
            committedTextEdit: intent.edit,
          }, result.ok ? null : intent.edit)
        }
        case 'cancel-text-edit': {
          if (
            !Object.is(flow.read().flowTextEdit, intent.edit)
            || !flowEditMatchesTarget(intent.edit, target)
          ) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          const selection = flowBlockSelection(document, target)
          return persistIntentResult({
            ok: true,
            nextDocument: document,
            historyEntry: false,
            selection,
          }, {
            selection,
            clearTextEdit: true,
            discardedTextEdit: intent.edit,
          }, null)
        }
        case 'format-text-style': {
          const liveEdit = flow.read().flowTextEdit
          if (
            !Object.is(liveEdit, intent.expectedEdit)
            || (
              liveEdit
              && (
                liveEdit.blockId !== target.itemId
                || liveEdit.surfaceId !== target.surfaceId
                || liveEdit.revision !== target.documentRevision
                || session.selection.selectedBlockId !== target.itemId
                || session.selection.focus !== 'text'
              )
            )
          ) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          const selection = liveEdit
            ? session.selection
            : flowBlockSelection(document, target)
          const formatted = formatFlowAuthoringTextStyle({
            document,
            selection,
            style: intent.style,
            edit: liveEdit,
            range: liveEdit?.range,
            expectedRevision: target.documentRevision,
          })
          return persistIntentResult(formatted, {
            selection: formatted.nextSelection ?? selection,
            ...(formatted.nextEdit !== undefined ? { textEdit: formatted.nextEdit } : {}),
          }, formatted.nextEdit)
        }
        case 'format-block': {
          const selection = flowBlockSelection(document, target)
          return persistIntentResult(formatFlowAuthoringBlock(
            document,
            selection,
            intent.spec,
            { expectedRevision: document.revision },
          ))
        }
        case 'execute-editor-command': {
          const selection = flowBlockSelection(document, target, intent.blockIds)
          return persistIntentResult(executeFlowEditorCommand(
            document,
            selection,
            intent.command,
            { expectedRevision: document.revision },
          ))
        }
        case 'delete-blocks': {
          const selection = flowBlockSelection(document, target, intent.blockIds)
          return persistIntentResult(executeFlowDelete(document, selection, {
            expectedRevision: document.revision,
            direction: intent.direction,
          }), { clearTextEdit: true })
        }
        case 'transform-overlay-frame': {
          const selection = flowOverlaySelection(document, target)
          return persistIntentResult(transformFlowOverlayFrame(
            document,
            selection,
            intent.frame,
            { expectedRevision: document.revision },
          ))
        }
        case 'commit-block-formula': {
          if (
            !Object.is(flow.read().flowTextEdit, intent.expectedEdit)
            || (
              intent.expectedEdit
              && (
                intent.expectedEdit.kind !== 'formula'
                || !flowEditMatchesTarget(intent.expectedEdit, target)
              )
            )
          ) {
            return rejectedFlowReceipt(LAYER_REJECT_STALE_REVISION)
          }
          const selection = flowBlockSelection(document, target)
          return persistIntentResult(commitFlowFormulaAst(
            document,
            selection,
            intent.ast,
            intent.accessibleText,
            { expectedRevision: target.documentRevision },
          ), {
            clearTextEdit: true,
            ...(intent.expectedEdit ? { committedTextEdit: intent.expectedEdit } : {}),
          }, null)
        }
        case 'rename-page': {
          return persistIntentResult({
            ok: true,
            nextDocument: commitSlideProjectMutation(document, (draft) => {
              const surface = draft.surfaces.find((candidate) => (
                candidate.id === target.surfaceId && candidate.type === 'flow'
              ))
              if (surface) surface.title = intent.title
            }),
            historyEntry: true,
            selection: committedSelection ?? session.selection,
          }, { statusMessage: '已重命名页面' })
        }
        case 'set-paper-background': {
          return persistIntentResult(updateFlowSurfaceBackgroundColor(
            document,
            target.surfaceId,
            intent.backgroundColor,
            { expectedRevision: document.revision },
          ), { statusMessage: '已修改稿纸背景色' })
        }
        case 'patch-block': {
          const selection = flowBlockSelection(document, target)
          return persistIntentResult(updateFlowEditorBlock(
            document,
            flowBlockTargetFromSelection(document, selection),
            intent.patch,
            { expectedRevision: document.revision },
          ))
        }
        case 'replace-media-asset': {
          const selection = flowBlockSelection(document, target)
          return persistIntentResult(replaceFlowMediaBlockAsset(
            document,
            flowBlockTargetFromSelection(document, selection),
            intent.assetId,
            { expectedRevision: document.revision },
          ))
        }
        case 'import-replacement-media': {
          const selection = flowBlockSelection(document, target)
          const found = findFlowBlockRecursive(
            flowSurfaceIn(document, target.surfaceId).blocks,
            target.itemId,
          )
          const block = found?.block
          if (!block || block.type !== 'media') {
            return rejectedFlowReceipt('当前块不是媒体块')
          }
          const asset = block.mediaKind === 'image'
            ? createImageAssetImport({
                name: intent.name,
                mimeType: intent.mimeType || 'image/png',
                bytes: intent.bytes,
              })
            : createMediaAssetImport(
                { name: intent.name, mimeType: intent.mimeType, bytes: intent.bytes },
                block.mediaKind,
                { duration: 0 },
              )
          const sidecar = flow.readAssetSidecar()
          if (!sidecar) return rejectedFlowReceipt('缺少当前 Flow 资源边车')
          return persistIntentResult(importAndReplaceFlowMediaBlock(
            document,
            flowBlockTargetFromSelection(document, selection),
            asset.meta,
            { expectedRevision: document.revision },
          ), {
            sidecar: freezeCourseAssetSidecar({
              ...sidecar.files,
              [asset.meta.id]: asset.bytes,
            }),
          })
        }
        case 'move-block': {
          const selection = flowBlockSelection(document, target)
          const surface = flowSurfaceIn(document, target.surfaceId)
          const found = findFlowBlockRecursive(surface.blocks, target.itemId)
          if (!found) return rejectedFlowReceipt(`找不到 Flow 块：${target.itemId}`)
          const parent = found.parentId
            ? findFlowBlockRecursive(surface.blocks, found.parentId)?.block
            : null
          const siblingCount = parent && 'blocks' in parent && Array.isArray(parent.blocks)
            ? parent.blocks.length
            : surface.blocks.length
          const nextIndex = intent.direction === 'up'
            ? Math.max(0, found.index - 1)
            : Math.min(siblingCount, found.index + 1)
          return persistIntentResult(executeFlowEditorCommand(document, selection, {
            name: 'move',
            destination: {
              parentId: found.parentId,
              index: nextIndex,
              surfaceId: target.surfaceId,
            },
          }, { expectedRevision: document.revision }))
        }
        case 'convert-block-to-overlay': {
          const selection = flowBlockSelection(document, target)
          const found = findFlowBlockRecursive(
            flowSurfaceIn(document, target.surfaceId).blocks,
            target.itemId,
          )
          if (found?.block.type === 'media') {
            return persistIntentResult(convertFlowMediaBlockToOverlay(document, selection, {
              expectedRevision: document.revision,
            }))
          }
          if (found?.block.type === 'component') {
            return persistIntentResult(convertFlowComponentBlockToOverlay(document, selection, {
              expectedRevision: document.revision,
            }))
          }
          return rejectedFlowReceipt('当前正文块不能改为页面浮层')
        }
        case 'convert-overlay-to-document': {
          const selection = flowOverlaySelection(document, target)
          const layer = buildFlowEditorView({ project: document, locationId: target.locationId })
            .overlayLayers.find((entry) => entry.selectionId === target.itemId)
          if (layer?.item.kind === 'component') {
            return persistIntentResult(convertFlowOverlayComponentToDocument(document, selection, {
              expectedRevision: document.revision,
            }))
          }
          return persistIntentResult(convertFlowOverlayMediaToDocument(document, selection, {
            expectedRevision: document.revision,
          }))
        }
        case 'patch-overlay-paper-space': {
          return persistIntentResult(patchFlowOverlayPaperSpace(
            document,
            flowOverlaySelection(document, target),
            intent.paperSpace,
            { expectedRevision: document.revision },
          ))
        }
        case 'commit-overlay-formula': {
          return persistIntentResult(commitFlowOverlayFormulaAst(
            document,
            flowOverlaySelection(document, target),
            intent.ast,
            intent.accessibleText,
            { expectedRevision: document.revision },
          ))
        }
      }
    } catch (error) {
      return rejectedFlowReceipt(error instanceof Error ? error.message : 'Flow 操作失败')
    }
  }

  return {
    runFlowAuthoringIntent,
    applyFlowCommand(result, extra = {}) {
      return flow.persist(result, extra)
    },
    deleteFlowSelection(request) {
      const session = flow.read().flowSession
      if (
        !session
        || session.history.present.revision !== request.expectedRevision
        || !sameFlowEditorSelection(session.selection, request.selection)
      ) {
        return flow.persist({
          ok: false,
          reason: LAYER_REJECT_STALE_REVISION,
          historyEntry: false,
        }) as FlowCommandResult
      }
      const selection = request.deleteSelectedBlocks
        ? selectFlowEditorBlocks(
            session.history.present,
            session.selection.locationId,
            session.selection.selectedBlockIds,
          )
        : session.selection
      const result = executeFlowDelete(session.history.present, selection, {
        expectedRevision: request.expectedRevision,
        direction: request.direction,
      })
      return flow.persist(result, {
        clearTextEdit: result.ok && selection.focus !== 'text',
      }) as FlowCommandResult
    },
    applyFlowSelection(selection) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      flow.persist({
        ok: true,
        nextDocument: session.history.present,
        historyEntry: false,
        selection: selection ?? session.selection,
      }, {
        selection: selection ?? session.selection,
        clearTextEdit: selection?.focus !== 'text',
      })
    },
    setFlowTextEdit(edit) {
      flow.patch({ flowTextEdit: edit })
    },
    insertFlowLibraryMedia(assetId, request = {}) {
      if (!commitDraft()) {
        return { ok: false, reason: '无法提交活动文字草稿', historyEntry: false }
      }
      const session = flow.read().flowSession
      if (!session) {
        return { ok: false, reason: '请先选择一个流式页面', historyEntry: false }
      }
      return flow.persist(
        insertFlowSharedMedia(session.history.present, session.selection, {
          assetId,
          altKey: request.altKey,
          menuAction: request.menuAction,
        }, { expectedRevision: session.history.present.revision }),
      ) as FlowSharedAuthoringResult
    },
    formatFlowTextStyle(style) {
      const owned = flow.read()
      const session = owned.flowSession
      if (!session) return missingSession()
      const formatted = formatFlowAuthoringTextStyle({
        document: session.history.present,
        selection: session.selection,
        style,
        edit: owned.flowTextEdit,
        expectedRevision: session.history.present.revision,
      })
      if (formatted.nextEdit) {
        flow.patch({ flowTextEdit: formatted.nextEdit })
        if (!formatted.historyEntry) return formatted
      }
      return flow.persist(formatted, {
        selection: formatted.nextSelection ?? session.selection,
      }) as FlowCommandResult
    },
    formatFlowBlock(spec) {
      if (!commitDraft()) return missingSession()
      const session = flow.read().flowSession
      if (!session) return missingSession()
      return flow.persist(
        formatFlowAuthoringBlock(session.history.present, session.selection, spec, {
          expectedRevision: session.history.present.revision,
        }),
      ) as FlowCommandResult
    },
    renameFlowHeading(locationId, title) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const document = session.history.present
      const location = document.locations.find((candidate) => candidate.id === locationId)
      if (!location || location.kind !== 'flow-block') return
      flow.persist(updateFlowEditorBlock(document, {
        surfaceId: location.surfaceId,
        blockId: location.blockId,
        parentId: findFlowBlockRecursive(
          flowSurfaceIn(document, location.surfaceId).blocks,
          location.blockId,
        )?.parentId ?? null,
      }, { text: title }, { expectedRevision: document.revision }), {
        selection: session.selection,
      })
    },
    renameFlowPage(surfaceId, title) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      flow.persist({
        ok: true,
        nextDocument: commitSlideProjectMutation(session.history.present, (draft) => {
          const surface = draft.surfaces.find((candidate) => candidate.id === surfaceId)
          if (surface) surface.title = title
        }),
        historyEntry: true,
        selection: session.selection,
      }, { statusMessage: '已重命名页面' })
    },
    commitDraft,
    undo() {
      const owned = flow.read()
      const session = owned.flowSession
      if (!session) return
      const edit = owned.flowTextEdit
      if (edit?.composing) return
      if (edit && isFlowTextDraftDirty(edit)) {
        flow.persist({
          ok: true,
          nextDocument: session.history.present,
          historyEntry: false,
          selection: session.selection,
        }, {
          clearTextEdit: true,
          discardedTextEdit: edit,
          statusMessage: '已取消本次编辑',
        })
        return
      }
      const resourceTransition = flowEditorUndoResourceTransition(session.history)
      const nextHistory = undoFlowEditorHistory(session.history)
      if (nextHistory === session.history) return
      flow.persist({
        ok: true,
        nextDocument: nextHistory.present,
        historyEntry: false,
        selection: session.selection,
      }, {
        replaceHistory: nextHistory,
        ...(resourceTransition ? { resourceTransition } : { sidecarDirection: 'undo' as const }),
        clearTextEdit: true,
        statusMessage: '已撤销',
      })
    },
    redo() {
      const owned = flow.read()
      const session = owned.flowSession
      if (!session) return
      const edit = owned.flowTextEdit
      if (edit?.composing || (edit && isFlowTextDraftDirty(edit))) return
      const resourceTransition = flowEditorRedoResourceTransition(session.history)
      const nextHistory = redoFlowEditorHistory(session.history)
      if (nextHistory === session.history) return
      flow.persist({
        ok: true,
        nextDocument: nextHistory.present,
        historyEntry: false,
        selection: session.selection,
      }, {
        replaceHistory: nextHistory,
        ...(resourceTransition ? { resourceTransition } : { sidecarDirection: 'redo' as const }),
        clearTextEdit: true,
        statusMessage: '已重做',
      })
    },
    setScope(scope) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const document = session.history.present
      if (scope === 'global') {
        const entered = enterFlowGlobalAuthoring(document, session.selection.locationId)
        if (!entered.ok || !('selection' in entered)) {
          if (entered.reason) {
            // feedback via persist failure
          }
          return
        }
        flow.persist({
          ok: true,
          nextDocument: document,
          historyEntry: false,
          selection: entered.selection,
        }, { statusMessage: '正在编辑全局层', clearTextEdit: true })
        return
      }
      flow.persist({
        ok: true,
        nextDocument: document,
        historyEntry: false,
        selection: selectFlowEditorBlock(
          document,
          session.selection.locationId,
          session.selection.selectedBlockId
            ?? flowLocationBlockId(document.locations, session.selection.locationId)
            ?? session.selection.locationId,
        ),
      }, { statusMessage: '正在编辑流式讲义', clearTextEdit: true })
    },
    renameProject(title) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      if (title === session.history.present.title) return
      flow.persist({
        ok: true,
        nextDocument: commitSlideProjectMutation(session.history.present, (draft) => {
          draft.title = title
        }),
        historyEntry: true,
        selection: session.selection,
      }, { statusMessage: `课件已重命名为“${title}”` })
    },
    addTextNode() {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const document = session.history.present
      const surface = flowSurfaceIn(document, session.selection.surfaceId)
      const found = session.selection.selectedBlockId
        ? findFlowBlockRecursive(surface.blocks, session.selection.selectedBlockId)
        : null
      const inserted = insertFlowEditorBlock(document, {
        surfaceId: session.selection.surfaceId,
        parentId: found?.parentId ?? null,
        index: found ? found.index + 1 : surface.blocks.length,
        block: { type: 'paragraph', text: '' },
      }, { expectedRevision: document.revision })
      const createdId = inserted.createdBlockIds?.[0]
      flow.persist(inserted, {
        statusMessage: '已插入段落',
        ...(inserted.ok && inserted.nextDocument && createdId
          ? { selection: selectFlowEditorBlocks(inserted.nextDocument, session.selection.locationId, [createdId]) }
          : {}),
      })
    },
    addFormulaNode() {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const document = session.history.present
      const surface = flowSurfaceIn(document, session.selection.surfaceId)
      const found = session.selection.selectedBlockId
        ? findFlowBlockRecursive(surface.blocks, session.selection.selectedBlockId)
        : null
      flow.persist(insertFlowEditorBlock(document, {
        surfaceId: session.selection.surfaceId,
        parentId: found?.parentId ?? null,
        index: found ? found.index + 1 : surface.blocks.length,
        block: {
          type: 'formula',
          formulaId: `formula-${nanoid(8)}`,
          accessibleText: 'x',
          ast: { type: 'token', value: 'x' },
        },
      }, { expectedRevision: document.revision }), { statusMessage: '已插入公式' })
    },
    addRectangleNode() {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const result = insertFlowSharedShape(
        session.history.present,
        session.selection,
        { shapeType: 'rectangle' },
        { expectedRevision: session.history.present.revision },
      )
      flow.persist(result, { statusMessage: result.reason ?? '已作为页面浮层添加图形' })
    },
    addShapeNode(shapeType) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const result = insertFlowSharedShape(
        session.history.present,
        session.selection,
        { shapeType: shapeType as import('../../../shared/projectTypes').ShapeType },
        { expectedRevision: session.history.present.revision },
      )
      flow.persist(result, { statusMessage: result.reason ?? '已作为页面浮层添加图形' })
    },
    beginTextEdit() {},
    updateTextEditDraft() {},
    commitTextEdit() {
      commitDraft()
    },
    cancelTextEdit() {
      flow.patch({ flowTextEdit: null })
    },
    selectNode,
    ensureTeacherController() {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const result = restoreDefaultTeacherController(session.history.present, {
        expectedRevision: session.history.present.revision,
      })
      if (!result.ok || !result.nextDocument) return
      flow.persist({
        ok: true,
        nextDocument: result.nextDocument,
        historyEntry: Boolean(result.historyEntry),
        selection: session.selection,
      }, { statusMessage: result.reason })
      const restored = findGlobalTeacherController(result.nextDocument)
      if (restored) selectNode(restored.item.layerItemId)
    },
    selectNodes(nodeIds) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      const selectedNodeIds = [...new Set(nodeIds)]
      flow.persist({
        ok: true,
        nextDocument: session.history.present,
        historyEntry: false,
        selection: selectedNodeIds.length > 0
          ? selectFlowOverlay(
            session.history.present,
            session.selection.locationId,
            selectedNodeIds,
            session.selection.authoringScope,
          )
          : session.selection,
      }, { clearTextEdit: true })
    },
    updateNodes,
    updateNode(nodeId, patch) {
      updateNodes([{ nodeId, patch }])
    },
    copySelectedNodes() {},
    pasteNodes() {},
    deleteNode(nodeId) {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      flow.persist(executeFlowDelete(
        session.history.present,
        selectFlowOverlay(
          session.history.present,
          session.selection.locationId,
          [nodeId],
          session.selection.authoringScope,
        ),
        { expectedRevision: session.history.present.revision },
      ))
    },
    deleteSelectedNodes() {
      if (!commitDraft()) return
      const session = flow.read().flowSession
      if (!session) return
      flow.persist(executeFlowDelete(
        session.history.present,
        session.selection,
        { expectedRevision: session.history.present.revision },
      ))
    },
    duplicateSelectedNodes() {},
    duplicateNode() {},
  }
}

export function flowPersistSnapshotFrom(
  owned: FlowOwnedState,
  resources: CourseResourceState,
  dirty: boolean,
  authoringSession: CourseAuthoringSession | null,
): FlowPersistSnapshot {
  return {
    ...owned,
    resources: readCourseResourceState(resources),
    dirty,
    authoringSession,
  }
}
