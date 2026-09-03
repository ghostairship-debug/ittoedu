import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { CourseAssetSidecar } from '../../project/v9AssetAdapter'
import { emptyCourseAssetSidecar } from '../../project/v9AssetAdapter'
import {
  activateSpatialCameraFrame,
  addSpatialCameraFrameFromSession,
  deleteSpatialCameraFrameInSession,
  fitSpatialSessionToHomeCamera,
  fitSpatialSessionToWorldContent,
  renameSpatialCameraFrameInSession,
  reorderSpatialCameraFramesInSession,
  setSpatialCameraHomeFromSession,
  updateActiveSpatialCameraFrameFromSession,
} from '../../course/spatialCameraCommands'
import {
  addSpatialPathInSession,
  deleteSpatialPathInSession,
  reorderSpatialPathWaypointsInSession,
  setSpatialShowCameraFrames,
  updateSpatialPathInSession,
} from '../../course/spatialPathCommands'
import {
  addSpatialRelationInSession,
  deleteSpatialRelationInSession,
  updateSpatialRelationInSession,
} from '../../course/spatialRelationCommands'
import {
  addSpatialSemanticZoomRuleInSession,
  deleteSpatialSemanticZoomRuleInSession,
  updateSpatialSemanticZoomRuleInSession,
} from '../../course/spatialSemanticZoom'
import {
  addSpatialWorldFormulaLayer,
  addSpatialWorldShapeLayer,
  addSpatialWorldTextLayer,
  buildSpatialAuthoringSnapshot,
  panSpatialSessionCamera,
  redoSpatialAuthoring,
  selectSpatialEditorLayers,
  selectSpatialLayers,
  setSpatialEditingScope,
  transformSpatialViewportLayersInSession,
  transformSpatialWorldLayersInSession,
  undoSpatialAuthoring,
  updateSpatialSurfaceBackgroundColor,
  zoomSpatialSessionCamera,
  type SpatialAuthoringSession,
  type SpatialCommandResult,
  type SpatialEditorWorldTransform,
} from '../../course/spatialEditorCommands'
import {
  commitSpatialAuthoringHistory,
  commitSpatialEditorTransactionHistory,
  rejectSpatialCommand,
  spatialAuthoringLegacyHistoryEntryCount,
  spatialAuthoringRedoResourceTransition,
  spatialAuthoringUndoResourceTransition,
  replaceSpatialSession,
  succeedSpatialCommand,
} from '../../course/spatialAuthoringHistory'
import {
  beginSpatialWorldContentEdit,
  commitSpatialWorldContentEdit,
  commitSpatialWorldTextRunStyle,
  isSpatialWorldContentDraftDirty,
  markSpatialWorldContentComposing,
  updateSpatialWorldContentFormulaDraft,
  updateSpatialWorldContentTextDraft,
} from '../../authoring/spatialWorldAuthoring'
import type { V9SlideTextContentDraft } from '../../authoring/v9SlideContentEdit'
import {
  deleteEffectiveLayerItems,
  findGlobalTeacherController,
  locateCourseLayer,
  patchEffectiveLayerItems,
  restoreDefaultTeacherController,
  type LayerCommandResult,
} from '../../course/effectiveLayerCommands'
import { commitSlideProjectMutation } from '../../course/slideEditorCommands'
import type { ShapeType, TextRun } from '../../../shared/projectTypes'
import {
  copySpatialClipboard,
  duplicateSpatialLayers,
  pasteSpatialClipboard,
  type SpatialClipboardPayload,
} from '../../course/spatialClipboardCommands'
import { buildCandidateEffectiveLayers } from '../../course/activeSurfaceProjection'
import { courseLayerItemToEditorCanvasNode } from '../slideEditorProjection'
import {
  commandTargetForRow,
  isSpatialDirectRowPropertyPatch,
  spatialLayerPropertyPatch,
} from '../v9LayerMutations'
import type { SpatialWorldContentEditSession } from '../../authoring/spatialWorldAuthoring'
import {
  type SpatialAuthoringIntent,
  type SpatialAuthoringReceipt,
  type SpatialGraphSelection,
} from '../../authoring/spatialAuthoringIntents'
export type {
  SpatialAuthoringIntent,
  SpatialAuthoringReceipt,
  SpatialGraphSelection,
} from '../../authoring/spatialAuthoringIntents'
import {
  COURSE_AUTHORING_STALE_SESSION_REASON,
  surfaceTypeForLocation,
  switchCourseAuthoringLocation,
  updateCourseAuthoringSessionItems,
  validateCourseAuthoringTarget,
  type CourseAuthoringSession,
  type CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import {
  buildSpatialEditorView,
  captureSpatialEditorAuthoringTarget,
  type SpatialEditorAuthoringTargetInput,
} from '../../course/spatialEditorView'
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

export type SpatialOwnedState = {
  spatialSession: SpatialAuthoringSession | null
  spatialClipboard: SpatialClipboardPayload | null
  spatialContentEdit: SpatialWorldContentEditSession | null
  spatialGraphSelection: SpatialGraphSelection | null
  spatialPlaybackPathId: string | null
}

export type SpatialPersistExtra = {
  statusMessage?: string | null
  sidecar?: CourseAssetSidecar
  sidecarDirection?: 'undo' | 'redo'
  componentPackages?: Record<string, ComponentPackageData>
  clearContentEdit?: boolean
  contentEdit?: SpatialWorldContentEditSession | null
  transactionStep?: EditorTransactionStep
  resourceTransition?: CourseResourceTransition
  graphSelection?: SpatialGraphSelection | null
}

export type SpatialPersistSnapshot = SpatialOwnedState & {
  resources: CourseResourceState
  dirty: boolean
  authoringSession: CourseAuthoringSession | null
}

export type SpatialApplyBackendExtra = {
  sidecar?: CourseAssetSidecar
  path?: string | null
  dirty?: boolean
  statusMessage?: string | null
  componentPackages?: Record<string, ComponentPackageData>
  canvasMode?: 'edit' | 'run'
  resourceHistory?: CourseResourceHistoryContinuation
}

export type SpatialAuthoringPorts = {
  read(): SpatialOwnedState
  readAuthoringSession(): CourseAuthoringSession | null
  patch(patch: Partial<SpatialOwnedState> & { editingTextNodeId?: string | null }): void
  persist(
    result: SpatialCommandResult,
    extra?: SpatialPersistExtra,
  ): SpatialCommandResult
  applyBackend(session: SpatialAuthoringSession, extra?: SpatialApplyBackendExtra): void
  openPropertiesTab?(): void
}

function spatialFailureMessage(rawReason: string): string {
  const normalizedReason = rawReason.trim().toLowerCase()
  if (/^[\[{]/.test(normalizedReason) || /"(?:code|path)"\s*:/.test(rawReason)) {
    return '课件内容格式不正确。请检查刚才的输入后重试。'
  }
  if (normalizedReason === 'locked' || rawReason.includes('锁定')) {
    return '当前内容已锁定。请先解锁后重试。'
  }
  if (normalizedReason === 'stale-revision' || rawReason.includes('stale')) {
    return '课件内容已更新。请重新选择后再试。'
  }
  if (normalizedReason === 'wrong-owner' || rawReason.includes('不属于')) {
    return '当前内容不在这个编辑范围内。请切换到对应图层后重试。'
  }
  if (/剪贴板为空|教师控制器|超过.*上限|最多.*互动规则/.test(rawReason)) {
    return rawReason
  }
  if (/引用已失效|资源引用已失效|素材已失效|组件已失效/.test(rawReason)) {
    return '复制内容引用的资源已失效。请重新复制后再试。'
  }
  if (
    normalizedReason === 'invalid-selection'
    || normalizedReason === 'invalid-target'
    || rawReason.includes('已失效')
    || rawReason.includes('找不到')
  ) {
    return '所选内容已失效。请重新选择后再试。'
  }
  if (normalizedReason === 'invalid-color') {
    return '颜色值无效。请重新选择颜色后再试。'
  }
  if (rawReason.includes('名称不能为空')) {
    return '名称不能为空。请输入名称后再试。'
  }
  if (rawReason.includes('不支持') && rawReason.includes('属性')) {
    return '当前元素不支持这项属性，未保存任何更改。'
  }
  if (
    rawReason.includes('属性值无效') ||
    /必须是有效数字|必须大于|必须是文字|超出允许范围|不透明度必须|初始状态无效|范围无效|状态无效|样式无效/.test(rawReason)
  ) {
    return '属性值无效，未保存任何更改。请修正后再试。'
  }
  if (/排序|顺序|层级|跨来源/.test(rawReason)) {
    return '图层顺序未更新。请在同一分组内重新排序。'
  }
  return '操作未完成。请重新选择目标后再试。'
}

function spatialCourseAuthoringSessionAfterResult(
  current: CourseAuthoringSession | null,
  session: SpatialAuthoringSession,
): CourseAuthoringSession | undefined {
  if (!current) return undefined
  const switched = switchCourseAuthoringLocation(current, {
    locationId: session.selection.locationId,
    surfaceType: surfaceTypeForLocation(
      session.history.present,
      session.selection.locationId,
    ),
    revision: session.history.present.revision,
  })
  if ('ok' in switched && switched.ok === false) return undefined
  return updateCourseAuthoringSessionItems(
    switched as CourseAuthoringSession,
    session.selection.selectionIds,
  )
}

export function persistSpatialResult(
  snapshot: SpatialPersistSnapshot,
  commit: (patch: Record<string, unknown>) => void,
  result: SpatialCommandResult,
  extra: SpatialPersistExtra = {},
): SpatialCommandResult {
  const session = result.nextSession ?? snapshot.spatialSession
  if (!session) return result
  if (!result.ok) {
    const rawReason = result.reason ?? 'unknown-spatial-command-failure'
    commit({ errorMessage: spatialFailureMessage(rawReason), statusMessage: null })
    const diagnosticSession = snapshot.spatialSession ?? session
    try {
      if (window.desktopAPI?.reportDiagnostic) {
        const selectionIds = diagnosticSession.selection.selectionIds
        void window.desktopAPI.reportDiagnostic({
          source: 'renderer',
          message: [
            'Spatial command context',
            JSON.stringify({
              projectId: diagnosticSession.history.present.id,
              sessionId: diagnosticSession.sessionId,
              revision: diagnosticSession.history.present.revision,
              generation: diagnosticSession.generation,
              locationId: diagnosticSession.selection.locationId,
              surfaceId: diagnosticSession.selection.surfaceId,
              scope: diagnosticSession.scope,
              selectionCount: selectionIds.length,
              selectionIds: selectionIds.slice(0, 20),
              selectionTruncated: selectionIds.length > 20,
            }),
          ].join('\n'),
          stack: rawReason,
        }).catch(() => undefined)
      }
    } catch {
      // A local diagnostic failure must never replace the actionable teacher message.
    }
    return result
  }
  const previousSession = snapshot.spatialSession
  const hasNonFeedbackExtra = Boolean(
    extra.sidecar
    || extra.sidecarDirection
    || extra.componentPackages
    || extra.clearContentEdit
    || Object.prototype.hasOwnProperty.call(extra, 'contentEdit')
    || extra.transactionStep
    || extra.resourceTransition
    || Object.prototype.hasOwnProperty.call(extra, 'graphSelection'),
  )
  if (
    previousSession
    && session === previousSession
    && !result.historyEntry
    && !hasNonFeedbackExtra
  ) {
    commit({
      errorMessage: null,
      ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
    })
    return result
  }
  const surfaceHistoryChanged = !previousSession
    || previousSession.history.present !== session.history.present
    || previousSession.history.past !== session.history.past
    || previousSession.history.future !== session.history.future
  const spatialClipboardContextChanged = !previousSession
    || previousSession.history.present.id !== session.history.present.id
    || previousSession.sessionId !== session.sessionId
    || previousSession.selection.locationId !== session.selection.locationId
    || previousSession.selection.surfaceId !== session.selection.surfaceId
  if (
    (extra.transactionStep || extra.resourceTransition)
    && (extra.sidecar || extra.sidecarDirection)
  ) {
    throw new Error('Spatial 资源事务不能同时使用完整 sidecar 快照')
  }
  const applyDocument = snapshot.spatialSession?.history.present ?? session.history.present
  const resourceCommitRequired = Boolean(
    result.historyEntry
    || session.history.present !== applyDocument
    || extra.transactionStep
    || extra.resourceTransition
    || extra.sidecar
    || extra.sidecarDirection
    || extra.componentPackages,
  )
  const committed = resourceCommitRequired
    ? commitSurfaceResourcePersist(snapshot.resources, {
        document: session.history.present,
        applyDocument,
        transactionStep: extra.transactionStep,
        resourceTransition: extra.resourceTransition,
        sidecar: extra.sidecar,
        sidecarDirection: extra.sidecarDirection,
        componentPackages: extra.componentPackages,
        historyEntry: result.historyEntry,
        legacyPastCount: spatialAuthoringLegacyHistoryEntryCount(session.history.past),
        legacyFutureCount: spatialAuthoringLegacyHistoryEntryCount(session.history.future),
      })
    : snapshot.resources
  const snapshotView = buildSpatialAuthoringSnapshot(session)
  const graphSelection = snapshot.spatialGraphSelection
  // A resource-bearing undo/redo keeps the same location, so the location-switch
  // helper would retain the generation and let a stale target pass the freshness
  // guard. Slide and Flow bump it on the same move; Spatial has to as well.
  const nextCourseAuthoringSession = courseSessionAfterSurfaceHistory(
    snapshot.authoringSession,
    session.history.present,
    session.selection.locationId,
    {
      resourceTransition: extra.resourceTransition,
      sidecarDirection: extra.sidecarDirection,
    },
  ) ?? spatialCourseAuthoringSessionAfterResult(
    snapshot.authoringSession,
    session,
  )
  commit({
    spatialSession: session,
    ...(spatialClipboardContextChanged ? { spatialClipboard: null } : {}),
    spatialContentEdit: extra.clearContentEdit
      ? null
      : extra.contentEdit !== undefined
        ? extra.contentEdit
        : snapshot.spatialContentEdit,
    slideCandidateSnapshot: null,
    ...committed,
    dirty: extra.transactionStep || extra.resourceTransition || extra.sidecarDirection || result.historyEntry
      ? true
      : snapshot.dirty,
    selectedNodeIds: [...session.selection.selectionIds],
    selectedNodeId: session.selection.selectionIds.at(-1) ?? null,
    editingScope: session.scope === 'global' ? 'global' : 'scene',
    activeSceneId: snapshotView.activeCameraFrameId,
    activePresentationStateId: null,
    ...(extra.clearContentEdit
      ? { editingTextNodeId: null }
      : extra.contentEdit !== undefined
        ? { editingTextNodeId: extra.contentEdit?.target.layerItemId ?? null }
        : {}),
    errorMessage: null,
    ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
    ...(graphSelection && session.selection.selectionIds.length > 0
      ? { spatialGraphSelection: null }
      : {}),
    ...(extra.graphSelection !== undefined
      ? { spatialGraphSelection: extra.graphSelection }
      : {}),
    ...(nextCourseAuthoringSession
      ? { courseAuthoringSession: nextCourseAuthoringSession }
      : {}),
  })
  return result
}

export function applySpatialBackendState(
  session: SpatialAuthoringSession,
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
  const snapshot = buildSpatialAuthoringSnapshot(session)
  return {
    ...exclusiveInactiveSurfaces('spatial'),
    spatialSession: session,
    spatialClipboard: null,
    spatialContentEdit: null,
    spatialGraphSelection: null,
    spatialPlaybackPathId: null,
    ...continuedCourseResourceStacks(extra.resourceHistory),
    courseAssetSidecar: sidecar,
    activeSceneId: snapshot.activeCameraFrameId,
    activePresentationStateId: null,
    editingScope: session.scope === 'global' ? 'global' : 'scene',
    selectedNodeIds: [...session.selection.selectionIds],
    selectedNodeId: session.selection.selectionIds.at(-1) ?? null,
    editingTextNodeId: null,
    canvasMode: extra.canvasMode ?? 'edit',
    errorMessage: null,
    dirty: extra.dirty ?? false,
    projectPath: extra.path === undefined ? null : extra.path,
    statusMessage: extra.statusMessage ?? `已打开“${session.history.present.title}”`,
    componentPackages: extra.componentPackages ?? {},
  }
}

type SpatialResolvedTargetKind = SpatialEditorAuthoringTargetInput['kind']

type ResolvedSpatialAuthoringTarget = {
  readonly session: SpatialAuthoringSession
  readonly view: ReturnType<typeof buildSpatialEditorView>
  readonly targetKind: SpatialResolvedTargetKind
}

function courseTargetField(target: CourseAuthoringTarget): string | null {
  const marker = '?field='
  const index = target.authoringAddress.indexOf(marker)
  if (index < 0) return null
  try {
    return decodeURIComponent(target.authoringAddress.slice(index + marker.length))
  } catch {
    return null
  }
}

function sameCourseTargetIdentity(
  left: CourseAuthoringTarget,
  right: CourseAuthoringTarget,
): boolean {
  return left.owner === right.owner
    && left.ownerKey === right.ownerKey
    && left.itemId === right.itemId
    && left.authoringAddress === right.authoringAddress
}

function resolveSpatialAuthoringTarget(
  spatial: SpatialAuthoringPorts,
  target: CourseAuthoringTarget,
): ResolvedSpatialAuthoringTarget | SpatialAuthoringReceipt {
  const session = spatial.read().spatialSession
  const authoringSession = spatial.readAuthoringSession()
  if (!session || !authoringSession) {
    return { ok: false, reason: '没有活动的 Spatial 编辑会话', historyEntry: false }
  }
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    sessionCamera: session.sessionCamera,
  })
  const field = courseTargetField(target)
  if (!field) {
    return { ok: false, reason: COURSE_AUTHORING_STALE_SESSION_REASON, historyEntry: false }
  }

  const candidates: Array<{
    readonly kind: SpatialResolvedTargetKind
    readonly input: SpatialEditorAuthoringTargetInput
  }> = [
    { kind: 'surface', input: { kind: 'surface', field } },
    { kind: 'world', input: { kind: 'world', field } },
    ...view.layers
      .filter((layer) => layer.selectionId === target.itemId)
      .map((layer) => ({
        kind: 'layer' as const,
        input: { kind: 'layer' as const, layerItemId: layer.selectionId, field },
      })),
    ...view.camera.frames
      .filter((frame) => frame.id === target.itemId)
      .map((frame) => ({
        kind: 'camera-frame' as const,
        input: { kind: 'camera-frame' as const, frameId: frame.id, field },
      })),
    ...view.worldGraph.paths
      .filter((path) => path.pathId === target.itemId)
      .map((path) => ({
        kind: 'path' as const,
        input: { kind: 'path' as const, pathId: path.pathId, field },
      })),
    ...view.worldGraph.relations
      .filter((relation) => relation.relationId === target.itemId)
      .map((relation) => ({
        kind: 'relation' as const,
        input: { kind: 'relation' as const, relationId: relation.relationId, field },
      })),
    ...view.visibilityRules
      .filter((rule) => rule.id === target.itemId)
      .map((rule) => ({
        kind: 'semantic-rule' as const,
        input: { kind: 'semantic-rule' as const, ruleId: rule.id, field },
      })),
  ]

  let canonical: CourseAuthoringTarget | null = null
  let targetKind: SpatialResolvedTargetKind | null = null
  for (const candidate of candidates) {
    try {
      const captured = captureSpatialEditorAuthoringTarget({
        view,
        sessionToken: authoringSession.token,
        target: candidate.input,
      })
      if (
        captured.itemId === target.itemId
        && captured.owner === target.owner
        && captured.ownerKey === target.ownerKey
        && captured.authoringAddress === target.authoringAddress
      ) {
        canonical = captured
        targetKind = candidate.kind
        break
      }
    } catch {
      // Continue through same-id entity kinds; validation below owns the result.
    }
  }
  if (!canonical || !targetKind) {
    return { ok: false, reason: COURSE_AUTHORING_STALE_SESSION_REASON, historyEntry: false }
  }
  const validation = validateCourseAuthoringTarget({
    target,
    current: {
      projectId: session.history.present.id,
      documentRevision: session.history.present.revision,
      sessionToken: authoringSession.token,
      surfaceId: view.surfaceId,
      stateId: null,
      owner: canonical.owner,
      ownerKey: canonical.ownerKey,
    },
    hasItem: (captured) => sameCourseTargetIdentity(captured, canonical!),
  })
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, historyEntry: false }
  }
  return { session, view, targetKind }
}

function sameSpatialSelectionIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sameSpatialCamera(
  left: SpatialAuthoringSession['sessionCamera'],
  right: SpatialAuthoringSession['sessionCamera'],
): boolean {
  return left.x === right.x && left.y === right.y && left.zoom === right.zoom
}

function sameSpatialGraphSelection(
  left: SpatialGraphSelection | null,
  right: SpatialGraphSelection | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && left.kind === right.kind && left.id === right.id
}

export function createSpatialAuthoringSlice(
  kernel: EditorStoreKernel,
  spatial: SpatialAuthoringPorts,
): {
  runSpatialAuthoringIntent(
    target: CourseAuthoringTarget,
    intent: SpatialAuthoringIntent,
  ): SpatialAuthoringReceipt
  runSpatialCommand(
    run: (session: SpatialAuthoringSession) => SpatialCommandResult,
    extra?: SpatialPersistExtra,
  ): SpatialCommandResult
  applySpatialAuthoringSession(
    session: SpatialAuthoringSession,
    extra?: { historyEntry?: boolean; statusMessage?: string | null },
  ): SpatialCommandResult
  setSpatialPlaybackPathId(pathId: string | null): void
  commitDraft(): SpatialAuthoringSession | null
  commitDraftForPersistence(): { ok: true } | { ok: false; reason: string }
  materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string }
  undo(): void
  redo(): void
  setScope(scope: 'global' | 'world'): void
  renameProject(title: string): void
  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(shapeType: string, x?: number, y?: number): void
  beginTextEdit(nodeId: string, source?: 'canvas' | 'properties'): void
  updateTextEditDraft(nodeId: string, text: string, runs: TextRun[], height?: number, width?: number): void
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
  commitSlideCandidateTextRunStyle(input: {
    layerItemId: string
    selectionStart: number
    selectionEnd: number
    patch: import('../../../shared/projectTypes').TextRunStyle
    source?: 'canvas' | 'properties'
  }): SpatialCommandResult
  persistLayerCommand(
    result: LayerCommandResult,
    extra?: { statusMessage?: string | null; selectionIds?: readonly string[] },
  ): SpatialCommandResult
  persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean
  persistDocument(document: CourseProjectDocument, options?: { statusMessage?: string | null; historyEntry?: boolean }): boolean
  activateCameraFrame(frameId: string): boolean
  setSpatialGraphSelection(selection: SpatialGraphSelection | null): void
} {
  const commitDraft = (): SpatialAuthoringSession | null => {
    const owned = spatial.read()
    const session = owned.spatialSession
    if (!session) return null
    if (!owned.spatialContentEdit) return session
    const result = commitSpatialWorldContentEdit(session, owned.spatialContentEdit)
    spatial.persist(result, result.ok ? { clearContentEdit: true } : undefined)
    if (!result.ok || !result.nextSession) return null
    return spatial.read().spatialSession
  }

  const commitTextEdit = (): void => {
    const owned = spatial.read()
    if (!owned.spatialSession || !owned.spatialContentEdit) return
    spatial.persist(
      commitSpatialWorldContentEdit(owned.spatialSession, owned.spatialContentEdit),
      { clearContentEdit: true },
    )
  }

  const addShapeNode = (shapeType: string, x?: number, y?: number): void => {
    const session = spatial.read().spatialSession
    if (!session) return
    spatial.persist(addSpatialWorldShapeLayer(session, {
      shapeType: shapeType as ShapeType,
      ...(typeof x === 'number' ? { x } : {}),
      ...(typeof y === 'number' ? { y } : {}),
    }, { expectedRevision: session.history.present.revision }), { statusMessage: '已添加形状' })
  }

  const selectNode = (nodeId: string | null, additive = false): void => {
    const session = spatial.read().spatialSession
    if (!session) return
    const planSelection = (base: SpatialAuthoringSession) => {
      if (nodeId === null) {
        return selectSpatialLayers(base, { layerItemIds: [] }, {
          expectedRevision: base.history.present.revision,
        })
      }
      const projection = buildCandidateEffectiveLayers({
        slideBackend: null,
        spatialSession: base,
        flowSession: null,
      })
      const row = projection?.unifiedRows.find((candidate) => candidate.id === nodeId)
      if (!row) return rejectSpatialCommand(base, 'invalid-target')
      const nextScope = row?.owner === 'global' || row?.owner === 'surface' || row?.owner === 'world'
        ? row.owner
        : base.scope
      if (additive && nextScope !== base.scope) return rejectSpatialCommand(base, '不能跨范围多选')
      const scoped = nextScope === base.scope
        ? base
        : replaceSpatialSession(base, { scope: nextScope })
      return selectSpatialLayers(scoped, {
        layerItemIds: [nodeId],
        additive,
      }, { expectedRevision: base.history.present.revision })
    }

    const preflight = planSelection(session)
    if (!preflight.ok) {
      if (preflight.reason === '不能跨范围多选') {
        kernel.setFeedback({ errorMessage: preflight.reason, statusMessage: null })
      } else {
        spatial.persist(preflight)
      }
      return
    }
    const live = commitDraft()
    if (!live) return
    spatial.persist(planSelection(live))
  }

  const updateNodes = (
    patches: Array<{
      nodeId: string
      patch: import('../../phaser/editorCanvasNode').EditorCanvasNodePatch
    }>,
  ): void => {
    const session = spatial.read().spatialSession
    if (!session) kernel.failSessionless()
    if (patches.length === 0) return
    const projection = buildCandidateEffectiveLayers({
      slideBackend: null,
      spatialSession: session,
      flowSession: null,
    })
    const selectedIds = new Set(session.selection.selectionIds)
    const updates = [] as Array<{
      target: ReturnType<typeof commandTargetForRow>
      patch: import('../../course/effectiveLayerCommands').EffectiveLayerPropertyPatch
    }>
    for (const item of patches) {
      const row = projection?.unifiedRows.find((candidate) => candidate.id === item.nodeId)
      if (!row) {
        spatial.persist(rejectSpatialCommand(session, 'invalid-target'))
        return
      }
      const direct = isSpatialDirectRowPropertyPatch(item.patch)
      if (!direct && !selectedIds.has(item.nodeId)) {
        spatial.persist(rejectSpatialCommand(session, 'invalid-selection'))
        return
      }
      const node = courseLayerItemToEditorCanvasNode(row.item)
      const planned = spatialLayerPropertyPatch(direct ? node : node, item.patch)
      if (!planned.ok) {
        spatial.persist(rejectSpatialCommand(session, planned.reason))
        return
      }
      updates.push({ target: commandTargetForRow(row), patch: planned.patch })
    }
    const result = patchEffectiveLayerItems(session.history.present, updates, {
      expectedRevision: session.history.present.revision,
    })
    if (result.ok && !result.historyEntry) {
      kernel.setFeedback({ errorMessage: null, statusMessage: '属性未变化' })
      return
    }
    if (!result.ok || !result.nextDocument) {
      spatial.persist(rejectSpatialCommand(session, result.reason ?? 'layer-command-failed'))
      return
    }
    spatial.persist(succeedSpatialCommand({
      ...session,
      history: commitSpatialAuthoringHistory(session.history, result.nextDocument),
    }, true), { statusMessage: `已更新 ${updates.length} 个图层属性` })
  }

  const deleteNode = (nodeId: string): void => {
    const session = spatial.read().spatialSession
    if (!session) kernel.failSessionless()
    const row = buildCandidateEffectiveLayers({
      slideBackend: null,
      spatialSession: session,
      flowSession: null,
    })?.unifiedRows.find((candidate) => candidate.id === nodeId)
    if (!row) return
    const result = deleteEffectiveLayerItems(
      session.history.present,
      [commandTargetForRow(row)],
      { expectedRevision: session.history.present.revision },
    )
    if (!result.ok || !result.nextDocument) {
      spatial.persist(rejectSpatialCommand(session, result.reason ?? 'delete-failed'))
      return
    }
    spatial.persist(succeedSpatialCommand({
      ...session,
      history: commitSpatialAuthoringHistory(session.history, result.nextDocument),
      selection: {
        ...session.selection,
        selectionIds: session.selection.selectionIds.filter((id) => id !== nodeId),
      },
    }, true))
  }

  const rejectIntent = (reason: string): SpatialAuthoringReceipt => {
    kernel.setFeedback({ errorMessage: spatialFailureMessage(reason), statusMessage: null })
    return { ok: false, reason, historyEntry: false }
  }

  const intentRequiresDraftCommit = (intent: SpatialAuthoringIntent): boolean => {
    switch (intent.kind) {
      case 'begin-content-edit':
      case 'update-text-content-edit':
      case 'set-content-edit-composing':
      case 'commit-text-content-edit':
      case 'commit-formula-content-edit':
      case 'cancel-content-edit':
      case 'pan-session-camera':
      case 'zoom-session-camera':
      case 'fit-home-camera':
      case 'set-show-camera-frames':
      case 'fit-world-content':
      case 'set-playback-path':
      case 'activate-camera-frame':
        return false
      default:
        return true
    }
  }

  const runSpatialAuthoringIntent = (
    target: CourseAuthoringTarget,
    intent: SpatialAuthoringIntent,
  ): SpatialAuthoringReceipt => {
    const resolved = resolveSpatialAuthoringTarget(spatial, target)
    if (!('session' in resolved)) return rejectIntent(resolved.reason ?? COURSE_AUTHORING_STALE_SESSION_REASON)
    const baseSession = resolved.session
    const ownedAtStart = spatial.read()
    if (!Object.is(ownedAtStart.spatialContentEdit, intent.expectedContentEdit)) {
      return rejectIntent('stale-revision')
    }

    const requireTargetKind = (...kinds: readonly SpatialResolvedTargetKind[]) => {
      if (!kinds.includes(resolved.targetKind)) {
        throw new Error(COURSE_AUTHORING_STALE_SESSION_REASON)
      }
    }

    const validateAdditionalTarget = (
      candidate: CourseAuthoringTarget,
      expectedKind: SpatialResolvedTargetKind,
    ): boolean => {
      const extra = resolveSpatialAuthoringTarget(spatial, candidate)
      return 'session' in extra
        && extra.session === baseSession
        && extra.targetKind === expectedKind
    }

    const persistReceipt = (
      result: SpatialCommandResult,
      extra: SpatialPersistExtra = {},
      edit?: SpatialWorldContentEditSession | null,
    ): SpatialAuthoringReceipt => {
      const persisted = spatial.persist(result, extra)
      return {
        ok: persisted.ok,
        ...(persisted.reason ? { reason: persisted.reason } : {}),
        historyEntry: Boolean(persisted.historyEntry),
        ...(edit !== undefined ? { edit } : {}),
      }
    }

    let workingSession = baseSession
    let committedEdit: SpatialWorldContentEditSession | null = null
    if (intentRequiresDraftCommit(intent)) {
      const currentEdit = ownedAtStart.spatialContentEdit
      if (!Object.is(currentEdit, intent.expectedContentEdit ?? null)) {
        return rejectIntent('stale-revision')
      }
      if (currentEdit) {
        const committed = commitSpatialWorldContentEdit(baseSession, currentEdit)
        if (!committed.ok || !committed.nextSession) {
          return rejectIntent(committed.reason ?? '文字草稿提交失败')
        }
        workingSession = committed.nextSession
        committedEdit = currentEdit
      }
    }

    const coalesceCommittedEdit = (result: SpatialCommandResult): SpatialCommandResult => {
      if (!committedEdit || !result.ok || !result.nextSession) return result
      const finalSession = result.nextSession
      const historyEntry = finalSession.history.present !== baseSession.history.present
      return {
        ...result,
        historyEntry,
        nextSession: replaceSpatialSession(finalSession, {
          history: historyEntry
            ? {
                past: [...baseSession.history.past, baseSession.history.present],
                present: finalSession.history.present,
                future: [],
              }
            : baseSession.history,
        }),
      }
    }

    const finish = (
      result: SpatialCommandResult,
      extra: SpatialPersistExtra = {},
    ): SpatialAuthoringReceipt => {
      const combined = coalesceCommittedEdit(result)
      if (committedEdit && !combined.ok) {
        return rejectIntent(combined.reason ?? 'Spatial 操作失败')
      }
      return persistReceipt(combined, {
        ...extra,
        ...(committedEdit ? { clearContentEdit: true } : {}),
      }, committedEdit ? null : undefined)
    }

    try {
      switch (intent.kind) {
        case 'select-layers': {
          requireTargetKind('world', 'layer')
          let scoped = workingSession
          const requestedScope = intent.scope
            ?? (resolved.targetKind === 'layer'
              ? target.owner as 'global' | 'surface' | 'world'
              : workingSession.scope)
          if (requestedScope !== workingSession.scope) {
            const changed = setSpatialEditingScope(workingSession, requestedScope)
            if (!changed.ok || !changed.nextSession) return rejectIntent(changed.reason ?? 'wrong-owner')
            scoped = changed.nextSession
          }
          return finish(selectSpatialLayers(scoped, {
            layerItemIds: [...intent.layerItemIds],
            additive: intent.additive,
          }, { expectedRevision: scoped.history.present.revision }))
        }
        case 'set-scope': {
          requireTargetKind('world', 'surface', 'layer')
          return finish(setSpatialEditingScope(workingSession, intent.scope))
        }
        case 'transform-layers': {
          requireTargetKind('layer')
          if (
            !sameSpatialSelectionIds(workingSession.selection.selectionIds, intent.expectedSelectionIds)
            || !sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)
            || intent.targets.length !== intent.layers.length
            || !sameCourseTargetIdentity(target, intent.targets[0] ?? target)
            || intent.targets.some((candidate, index) => candidate.itemId !== intent.layers[index]?.layerItemId)
            || intent.targets.some((candidate) => !validateAdditionalTarget(candidate, 'layer'))
          ) {
            return rejectIntent('stale-revision')
          }
          const result = intent.coordinateSpace === 'viewport'
            ? transformSpatialViewportLayersInSession(workingSession, {
                layers: [...intent.layers],
              }, { expectedRevision: workingSession.history.present.revision })
            : transformSpatialWorldLayersInSession(workingSession, {
                layers: [...intent.layers],
              }, { expectedRevision: workingSession.history.present.revision })
          return finish(result)
        }
        case 'patch-layers': {
          requireTargetKind('layer')
          if (
            intent.updates.length === 0
            || !sameCourseTargetIdentity(target, intent.updates[0]!.target)
            || !sameSpatialSelectionIds(baseSession.selection.selectionIds, intent.expectedSelectionIds)
            || intent.updates.some((update) => !intent.expectedSelectionIds.includes(update.target.itemId))
            || intent.updates.some((update) => !validateAdditionalTarget(update.target, 'layer'))
          ) {
            return rejectIntent('stale-revision')
          }
          const projection = buildCandidateEffectiveLayers({
            slideBackend: null,
            spatialSession: workingSession,
            flowSession: null,
          })
          const updates = [] as Array<{
            target: ReturnType<typeof commandTargetForRow>
            patch: import('../../course/effectiveLayerCommands').EffectiveLayerPropertyPatch
          }>
          for (const update of intent.updates) {
            const row = projection?.unifiedRows.find((candidate) => (
              candidate.id === update.target.itemId
              && candidate.authoringAddress === update.target.authoringAddress
            ))
            if (!row) return rejectIntent('stale-revision')
            const node = courseLayerItemToEditorCanvasNode(row.item)
            const planned = spatialLayerPropertyPatch(node, update.patch)
            if (!planned.ok) return rejectIntent(planned.reason)
            updates.push({ target: commandTargetForRow(row), patch: planned.patch })
          }
          const result = patchEffectiveLayerItems(workingSession.history.present, updates, {
            expectedRevision: workingSession.history.present.revision,
          })
          if (!result.ok || !result.nextDocument) {
            return rejectIntent(result.reason ?? 'layer-command-failed')
          }
          if (!result.historyEntry) {
            return finish(succeedSpatialCommand(workingSession, false), {
              statusMessage: '属性未变化',
            })
          }
          return finish(succeedSpatialCommand(replaceSpatialSession(workingSession, {
            history: commitSpatialAuthoringHistory(workingSession.history, result.nextDocument),
          }), true), { statusMessage: `已更新 ${updates.length} 个图层属性` })
        }
        case 'pan-session-camera': {
          requireTargetKind('world')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(panSpatialSessionCamera(baseSession, intent.delta))
        }
        case 'zoom-session-camera': {
          requireTargetKind('world')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(zoomSpatialSessionCamera(baseSession, intent.zoom))
        }
        case 'fit-home-camera': {
          requireTargetKind('world')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(fitSpatialSessionToHomeCamera(baseSession))
        }
        case 'begin-content-edit': {
          requireTargetKind('layer')
          if (!Object.is(ownedAtStart.spatialContentEdit, intent.expectedEdit)) {
            return rejectIntent('stale-revision')
          }
          if (intent.expectedEdit) {
            if (intent.expectedEdit.target.layerItemId === target.itemId) {
              return { ok: true, historyEntry: false, edit: intent.expectedEdit }
            }
            return rejectIntent('请先完成当前文字编辑')
          }
          const requestedScope = target.owner as 'global' | 'surface' | 'world'
          const scopedResult = requestedScope === baseSession.scope
            ? succeedSpatialCommand(baseSession, false)
            : setSpatialEditingScope(baseSession, requestedScope)
          if (!scopedResult.ok || !scopedResult.nextSession) {
            return rejectIntent(scopedResult.reason ?? 'wrong-owner')
          }
          const selectedResult = selectSpatialLayers(scopedResult.nextSession, {
            layerItemIds: [target.itemId],
          }, { expectedRevision: scopedResult.nextSession.history.present.revision })
          if (!selectedResult.ok || !selectedResult.nextSession) {
            return rejectIntent(selectedResult.reason ?? 'invalid-selection')
          }
          const begun = beginSpatialWorldContentEdit({
            session: selectedResult.nextSession,
            layerItemId: target.itemId,
            source: intent.source,
          })
          if (!begun.ok) return rejectIntent(begun.reason)
          const edit = Object.freeze({ ...begun.edit, courseTarget: target })
          return persistReceipt(selectedResult, { contentEdit: edit }, edit)
        }
        case 'update-text-content-edit': {
          requireTargetKind('layer')
          const live = ownedAtStart.spatialContentEdit
          if (
            !live
            || !Object.is(live, intent.expectedEdit)
            || !Object.is(live.courseTarget, target)
            || live.kind !== 'text'
          ) {
            return rejectIntent('stale-revision')
          }
          const edit = updateSpatialWorldContentTextDraft(live, {
            text: intent.text,
            runs: [...intent.runs],
            ...(intent.width !== undefined ? { width: intent.width } : {}),
            ...(intent.height !== undefined ? { height: intent.height } : {}),
          })
          spatial.patch({ spatialContentEdit: edit })
          return { ok: true, historyEntry: false, edit }
        }
        case 'set-content-edit-composing': {
          requireTargetKind('layer')
          const live = ownedAtStart.spatialContentEdit
          if (
            !live
            || !Object.is(live, intent.expectedEdit)
            || !Object.is(live.courseTarget, target)
          ) {
            return rejectIntent('stale-revision')
          }
          const edit = markSpatialWorldContentComposing(live, intent.composing)
          if (edit !== live) spatial.patch({ spatialContentEdit: edit })
          return { ok: true, historyEntry: false, edit }
        }
        case 'commit-text-content-edit': {
          requireTargetKind('layer')
          const live = ownedAtStart.spatialContentEdit
          if (
            !live
            || !Object.is(live, intent.expectedEdit)
            || !Object.is(live.courseTarget, target)
            || live.kind !== 'text'
          ) {
            return rejectIntent('stale-revision')
          }
          const edit = updateSpatialWorldContentTextDraft(live, {
            text: intent.text,
            runs: [...intent.runs],
            ...(intent.width !== undefined ? { width: intent.width } : {}),
            ...(intent.height !== undefined ? { height: intent.height } : {}),
          })
          return persistReceipt(
            commitSpatialWorldContentEdit(baseSession, edit),
            { clearContentEdit: true },
            null,
          )
        }
        case 'commit-formula-content-edit': {
          requireTargetKind('layer')
          const live = ownedAtStart.spatialContentEdit
          if (
            !live
            || !Object.is(live, intent.expectedEdit)
            || !Object.is(live.courseTarget, target)
            || live.kind !== 'formula'
          ) {
            return rejectIntent('stale-revision')
          }
          const edit = updateSpatialWorldContentFormulaDraft(live, {
            ast: intent.ast,
            accessibleText: intent.accessibleText,
          })
          return persistReceipt(
            commitSpatialWorldContentEdit(baseSession, edit),
            { clearContentEdit: true },
            null,
          )
        }
        case 'cancel-content-edit': {
          requireTargetKind('layer')
          const live = ownedAtStart.spatialContentEdit
          if (!live || !Object.is(live, intent.expectedEdit) || !Object.is(live.courseTarget, target)) {
            return rejectIntent('stale-revision')
          }
          spatial.patch({ spatialContentEdit: null, editingTextNodeId: null })
          return { ok: true, historyEntry: false, edit: null }
        }
        case 'commit-text-run-style': {
          requireTargetKind('layer')
          const live = ownedAtStart.spatialContentEdit
          if (
            !live
            || !Object.is(live, intent.expectedEdit)
            || !Object.is(live.courseTarget, target)
            || live.kind !== 'text'
          ) {
            return rejectIntent('stale-revision')
          }
          return finish(commitSpatialWorldTextRunStyle(workingSession, {
            layerItemId: target.itemId,
            selectionStart: intent.selectionStart,
            selectionEnd: intent.selectionEnd,
            patch: intent.patch,
            source: 'properties',
          }, { expectedRevision: workingSession.history.present.revision }))
        }
        case 'set-surface-background':
          requireTargetKind('surface')
          return finish(updateSpatialSurfaceBackgroundColor(
            workingSession,
            intent.backgroundColor,
          ))
        case 'set-show-camera-frames':
          requireTargetKind('world')
          if (baseSession.showCameraFrames !== intent.expectedShow) return rejectIntent('stale-revision')
          return finish(setSpatialShowCameraFrames(baseSession, intent.show))
        case 'add-camera-frame':
          requireTargetKind('world')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(addSpatialCameraFrameFromSession(workingSession, {
            ...(intent.name ? { name: intent.name } : {}),
            expectedRevision: workingSession.history.present.revision,
          }), { statusMessage: '已添加镜头' })
        case 'rename-camera-frame':
          requireTargetKind('camera-frame')
          return finish(renameSpatialCameraFrameInSession(
            workingSession,
            target.itemId,
            intent.name,
          ))
        case 'reorder-camera-frame':
          requireTargetKind('camera-frame')
          if (!sameSpatialSelectionIds(
            resolved.view.camera.frames.map((frame) => frame.id),
            intent.expectedFrameIds,
          )) return rejectIntent('stale-revision')
          return finish(reorderSpatialCameraFramesInSession(
            workingSession,
            target.itemId,
            intent.toIndex,
          ))
        case 'delete-camera-frame':
          requireTargetKind('camera-frame')
          return finish(deleteSpatialCameraFrameInSession(workingSession, target.itemId))
        case 'set-camera-home-from-session':
          requireTargetKind('world')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(setSpatialCameraHomeFromSession(workingSession))
        case 'update-camera-frame-from-session':
          requireTargetKind('camera-frame')
          if (resolved.view.camera.activeFrameId !== target.itemId) return rejectIntent('stale-revision')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(updateActiveSpatialCameraFrameFromSession(workingSession))
        case 'activate-camera-frame':
          requireTargetKind('camera-frame')
          if (ownedAtStart.spatialContentEdit !== null) {
            return rejectIntent('请先完成当前文字编辑')
          }
          return finish(activateSpatialCameraFrame(workingSession, target.itemId))
        case 'fit-world-content':
          requireTargetKind('world')
          if (!sameSpatialCamera(baseSession.sessionCamera, intent.expectedCamera)) {
            return rejectIntent('stale-revision')
          }
          return finish(fitSpatialSessionToWorldContent(baseSession, {
            viewportWidth: intent.viewportWidth,
            viewportHeight: intent.viewportHeight,
          }))
        case 'set-playback-path': {
          requireTargetKind('world')
          if (ownedAtStart.spatialPlaybackPathId !== intent.expectedPathId) {
            return rejectIntent('stale-revision')
          }
          if (
            intent.pathId !== null
            && (
              !intent.pathTarget
              || intent.pathTarget.itemId !== intent.pathId
              || !validateAdditionalTarget(intent.pathTarget, 'path')
            )
          ) {
            return rejectIntent('stale-revision')
          }
          spatial.patch({ spatialPlaybackPathId: intent.pathId })
          return { ok: true, historyEntry: false }
        }
        case 'add-semantic-rule':
          requireTargetKind('world')
          return finish(addSpatialSemanticZoomRuleInSession(workingSession, {
            ...intent.rule,
            layerItemIds: [...intent.rule.layerItemIds],
          }))
        case 'update-semantic-rule':
          requireTargetKind('semantic-rule')
          return finish(updateSpatialSemanticZoomRuleInSession(
            workingSession,
            target.itemId,
            intent.patch,
          ))
        case 'delete-semantic-rule':
          requireTargetKind('semantic-rule')
          return finish(deleteSpatialSemanticZoomRuleInSession(workingSession, target.itemId))
        case 'add-path':
          requireTargetKind('world')
          return finish(addSpatialPathInSession(workingSession, {
            ...intent.input,
            layerItemIds: [...intent.input.layerItemIds],
          }))
        case 'rename-path':
          requireTargetKind('path')
          return finish(updateSpatialPathInSession(workingSession, target.itemId, {
            name: intent.name,
          }))
        case 'update-path-style':
          requireTargetKind('path')
          return finish(updateSpatialPathInSession(workingSession, target.itemId, {
            style: intent.style,
          }))
        case 'reorder-path-waypoints':
          requireTargetKind('path')
          return finish(reorderSpatialPathWaypointsInSession(
            workingSession,
            target.itemId,
            [...intent.layerItemIds],
          ))
        case 'delete-path':
          requireTargetKind('path')
          return finish(deleteSpatialPathInSession(workingSession, target.itemId))
        case 'add-relation':
          requireTargetKind('world')
          return finish(addSpatialRelationInSession(workingSession, intent.input))
        case 'update-relation-label':
          requireTargetKind('relation')
          return finish(updateSpatialRelationInSession(workingSession, target.itemId, {
            label: intent.label,
          }))
        case 'update-relation-kind':
          requireTargetKind('relation')
          return finish(updateSpatialRelationInSession(workingSession, target.itemId, {
            kind: intent.relationKind,
          }))
        case 'delete-relation':
          requireTargetKind('relation')
          return finish(deleteSpatialRelationInSession(workingSession, target.itemId))
        case 'set-graph-selection':
          requireTargetKind('world', 'path', 'relation')
          if (!sameSpatialGraphSelection(ownedAtStart.spatialGraphSelection, intent.expectedSelection)) {
            return rejectIntent('stale-revision')
          }
          if (intent.selection && workingSession.selection.selectionIds.length > 0) {
            const cleared = selectSpatialLayers(workingSession, {
              layerItemIds: [],
            }, { expectedRevision: workingSession.history.present.revision })
            if (!cleared.ok || !cleared.nextSession) {
              return rejectIntent(cleared.reason ?? 'invalid-selection')
            }
            workingSession = cleared.nextSession
          }
          return finish(succeedSpatialCommand(
            workingSession,
            workingSession.history.present !== baseSession.history.present,
          ), { graphSelection: intent.selection })
      }
    } catch (error) {
      return rejectIntent(error instanceof Error ? error.message : 'Spatial 操作失败')
    }
  }

  return {
    runSpatialAuthoringIntent,
    runSpatialCommand(run, extra) {
      const session = spatial.read().spatialSession
      if (!session) {
        return {
          ok: false,
          reason: 'not-spatial-session',
          historyEntry: false,
          nextSession: session as unknown as SpatialAuthoringSession,
          selection: { locationId: '', surfaceId: '', selectionIds: [] },
        }
      }
      return spatial.persist(run(session), extra)
    },
    applySpatialAuthoringSession(session, extra = {}) {
      const currentDocument = kernel.tryReadDocument()
      const owned = spatial.read()
      const commandResult = Object.prototype.hasOwnProperty.call(extra, 'historyEntry')
      const stale = Boolean(
        currentDocument && (
          session.history.present.id !== currentDocument.id ||
          session.history.present.revision < currentDocument.revision ||
          !owned.spatialSession ||
          (commandResult && session.sessionId !== owned.spatialSession.sessionId)
        ),
      )
      if (stale) {
        kernel.setFeedback({
          errorMessage: '课件内容已更新。旧的 Spatial 会话没有写入。',
          statusMessage: null,
        })
        return rejectSpatialCommand(owned.spatialSession ?? session, 'stale-revision')
      }
      return spatial.persist(
        succeedSpatialCommand(session, extra.historyEntry === true),
        { statusMessage: extra.statusMessage },
      )
    },
    setSpatialPlaybackPathId(pathId) {
      spatial.patch({ spatialPlaybackPathId: pathId })
    },
    commitDraft,
    commitDraftForPersistence(): { ok: true } | { ok: false; reason: string } {
      const owned = spatial.read()
      const session = owned.spatialSession
      const edit = owned.spatialContentEdit
      if (!edit || !session) return { ok: true }
      if (edit.composing) return { ok: false, reason: 'composing' }
      if (isSpatialWorldContentDraftDirty(edit)) {
        if (edit.target.revision !== session.history.present.revision) {
          return { ok: false, reason: 'stale-revision' }
        }
        const result = commitSpatialWorldContentEdit(session, edit)
        if (!result.ok) {
          return { ok: false, reason: result.reason ?? '无法提交活动文字草稿' }
        }
        spatial.persist(result, { clearContentEdit: true })
      } else {
        spatial.patch({ spatialContentEdit: null })
      }
      return { ok: true }
    },
    materializeDraft(document: CourseProjectDocument): { readonly ok: true; readonly document: CourseProjectDocument } | { readonly ok: false; readonly reason: string } {
      const owned = spatial.read()
      const edit = owned.spatialContentEdit
      if (!edit || edit.kind !== 'text') return { ok: true, document }
      const clone = structuredClone(document)
      const located = locateCourseLayer(clone, edit.target.layerItemId)
      const item = located?.item
      if (item && item.kind === 'native' && item.content.nativeType === 'text') {
        const draft = edit.draft as V9SlideTextContentDraft
        const data = item.content.data as { text: string; runs?: unknown }
        data.text = draft.text
        if (draft.runs) data.runs = structuredClone(draft.runs)
        if (draft.width !== undefined) item.frame.width = draft.width
        if (draft.height !== undefined) item.frame.height = draft.height
      }
      return { ok: true, document: clone }
    },
    undo() {
      const session = spatial.read().spatialSession
      if (!session) return
      const before = session.history.present
      const resourceTransition = spatialAuthoringUndoResourceTransition(session.history)
      const result = undoSpatialAuthoring(session)
      const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
      spatial.persist(result, {
        clearContentEdit: true,
        ...(moved ? resourceTransition ? { resourceTransition } : { sidecarDirection: 'undo' as const } : {}),
        statusMessage: '已撤销',
      })
    },
    redo() {
      const session = spatial.read().spatialSession
      if (!session) return
      const before = session.history.present
      const resourceTransition = spatialAuthoringRedoResourceTransition(session.history)
      const result = redoSpatialAuthoring(session)
      const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
      spatial.persist(result, {
        clearContentEdit: true,
        ...(moved ? resourceTransition ? { resourceTransition } : { sidecarDirection: 'redo' as const } : {}),
        statusMessage: '已重做',
      })
    },
    setScope(scope) {
      const session = spatial.read().spatialSession
      if (!session) return
      spatial.persist(setSpatialEditingScope(session, scope), {
        statusMessage: scope === 'global' ? '正在编辑全局层' : '正在编辑无限画布',
      })
    },
    renameProject(title) {
      const session = spatial.read().spatialSession
      if (!session) return
      if (title === session.history.present.title) return
      const next = commitSlideProjectMutation(session.history.present, (draft) => {
        draft.title = title
      })
      spatial.persist(succeedSpatialCommand({
        ...session,
        history: {
          ...session.history,
          present: next,
          past: [...session.history.past, session.history.present],
          future: [],
        },
      }, true), { statusMessage: `课件已重命名为“${title}”` })
    },
    addTextNode(x, y) {
      const session = spatial.read().spatialSession
      if (!session) return
      spatial.persist(addSpatialWorldTextLayer(session, {
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: session.history.present.revision }), { statusMessage: '已添加文本' })
    },
    addFormulaNode(x, y) {
      const session = spatial.read().spatialSession
      if (!session) return
      spatial.persist(addSpatialWorldFormulaLayer(session, {
        ...(typeof x === 'number' ? { x } : {}),
        ...(typeof y === 'number' ? { y } : {}),
      }, { expectedRevision: session.history.present.revision }), { statusMessage: '已添加公式' })
    },
    addRectangleNode(x, y) {
      addShapeNode('rect', x, y)
    },
    addShapeNode,
    beginTextEdit(nodeId, source = 'canvas') {
      const owned = spatial.read()
      const session = owned.spatialSession
      if (!session) return
      if (
        owned.spatialContentEdit?.target.layerItemId === nodeId &&
        owned.spatialContentEdit.source === source
      ) {
        return
      }
      const preflight = beginSpatialWorldContentEdit({
        session,
        layerItemId: nodeId,
        source,
      })
      if (!preflight.ok) {
        kernel.setFeedback({ errorMessage: preflight.reason, statusMessage: null })
        return
      }
      const next = owned.spatialContentEdit ? commitDraft() : session
      if (!next) return
      const begun = beginSpatialWorldContentEdit({
        session: next,
        layerItemId: nodeId,
        source,
      })
      if (!begun.ok) {
        kernel.setFeedback({ errorMessage: begun.reason, statusMessage: null })
        return
      }
      spatial.patch({ spatialContentEdit: begun.edit, editingTextNodeId: nodeId })
    },
    updateTextEditDraft(nodeId, text, runs, height, width) {
      const edit = spatial.read().spatialContentEdit
      if (!edit || edit.target.layerItemId !== nodeId || edit.kind !== 'text') return
      spatial.patch({
        spatialContentEdit: updateSpatialWorldContentTextDraft(edit, {
          text,
          runs,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        }),
      })
    },
    commitTextEdit,
    cancelTextEdit() {
      spatial.patch({ spatialContentEdit: null, editingTextNodeId: null })
    },
    selectNode,
    ensureTeacherController() {
      const session = spatial.read().spatialSession
      if (!session) return
      const result = restoreDefaultTeacherController(session.history.present, {
        expectedRevision: session.history.present.revision,
      })
      if (!result.ok || !result.nextDocument) return
      spatial.persist(succeedSpatialCommand({
        ...session,
        history: result.historyEntry
          ? {
              ...session.history,
              present: result.nextDocument,
              past: [...session.history.past, session.history.present],
              future: [],
            }
          : {
              ...session.history,
              present: result.nextDocument,
            },
      }, Boolean(result.historyEntry)), { statusMessage: result.reason })
    },
    selectNodes(nodeIds) {
      const session = spatial.read().spatialSession
      if (!session) {
        kernel.failSessionless()
      }
      const layerItemIds = [...new Set(nodeIds)]
      const preflight = selectSpatialLayers(session, { layerItemIds }, {
        expectedRevision: session.history.present.revision,
      })
      if (!preflight.ok) {
        spatial.persist(preflight)
        return
      }
      const live = commitDraft()
      if (!live) return
      spatial.persist(selectSpatialLayers(live, {
        layerItemIds,
      }, { expectedRevision: live.history.present.revision }))
    },
    updateNodes,
    updateNode(nodeId, patch) {
      updateNodes([{ nodeId, patch }])
    },
    copySelectedNodes() {
      const session = spatial.read().spatialSession
      if (!session) kernel.failSessionless()
      try {
        const clipboard = copySpatialClipboard(session, session.selection.selectionIds)
        spatial.patch({ spatialClipboard: clipboard })
        kernel.setFeedback({
          errorMessage: null,
          statusMessage: `已复制 ${clipboard.items.length} 个 Spatial 图层到剪贴板`,
        })
      } catch (error) {
        spatial.persist(rejectSpatialCommand(
          session,
          error instanceof Error ? error.message : '无法复制 Spatial 图层',
        ))
      }
    },
    pasteNodes() {
      const session = spatial.read().spatialSession
      if (!session) kernel.failSessionless()
      const result = pasteSpatialClipboard(session, spatial.read().spatialClipboard, {
        expectedRevision: session.history.present.revision,
      })
      spatial.persist(result, {
        statusMessage: result.ok
          ? `已粘贴 ${result.createdIds?.length ?? 0} 个 Spatial 图层`
          : undefined,
      })
    },
    deleteNode,
    deleteSelectedNodes() {
      for (const nodeId of [...(spatial.read().spatialSession?.selection.selectionIds ?? [])]) {
        deleteNode(nodeId)
      }
    },
    duplicateSelectedNodes() {
      const session = spatial.read().spatialSession
      if (!session) kernel.failSessionless()
      spatial.persist(duplicateSpatialLayers(session, session.selection.selectionIds, {
        expectedRevision: session.history.present.revision,
      }))
    },
    duplicateNode(nodeId) {
      const session = spatial.read().spatialSession
      if (!session) kernel.failSessionless()
      const projection = buildCandidateEffectiveLayers({
        slideBackend: null,
        spatialSession: session,
        flowSession: null,
      })
      const row = projection?.unifiedRows.find((candidate) => candidate.id === nodeId)
      const scoped = row?.owner === 'global' || row?.owner === 'surface' || row?.owner === 'world'
        ? replaceSpatialSession(session, { scope: row.owner })
        : session
      spatial.persist(duplicateSpatialLayers(scoped, [nodeId], {
        expectedRevision: session.history.present.revision,
        allowTargetOwner: true,
      }))
    },
    commitSlideCandidateTextRunStyle(input) {
      const session = spatial.read().spatialSession
      if (!session) kernel.failSessionless()
      return spatial.persist(commitSpatialWorldTextRunStyle(session, {
        layerItemId: input.layerItemId,
        selectionStart: input.selectionStart,
        selectionEnd: input.selectionEnd,
        patch: input.patch,
        source: input.source ?? 'properties',
      }), { clearContentEdit: true })
    },
    persistLayerCommand(
      result: LayerCommandResult,
      extra?: { statusMessage?: string | null; selectionIds?: readonly string[] },
    ) {
      return persistSpatialLayerCommand(spatial, result, extra)
    },
    persistTransaction(step: EditorTransactionStep, statusMessage: string): boolean {
      return persistSpatialTransaction(spatial, step, statusMessage)
    },
    persistDocument(document: CourseProjectDocument, options?: { statusMessage?: string | null; historyEntry?: boolean }): boolean {
      return persistSpatialDocument(spatial, document, options)
    },
    activateCameraFrame(frameId: string): boolean {
      const before = spatial.read()
      if (before.spatialContentEdit && !commitDraft()) return false
      const current = spatial.read()
      const session = current.spatialSession
      const authoringSession = spatial.readAuthoringSession()
      if (!session || !authoringSession) return false
      try {
        const view = buildSpatialEditorView({
          project: session.history.present,
          locationId: session.selection.locationId,
          sessionCamera: session.sessionCamera,
        })
        const target = captureSpatialEditorAuthoringTarget({
          view,
          sessionToken: authoringSession.token,
          target: { kind: 'camera-frame', frameId, field: 'session.activeCameraFrameId' },
        })
        return runSpatialAuthoringIntent(target, {
          kind: 'activate-camera-frame',
          expectedContentEdit: null,
        }).ok
      } catch (error) {
        kernel.setFeedback({
          errorMessage: error instanceof Error ? error.message : '无法切换 Spatial 镜头',
          statusMessage: null,
        })
        return false
      }
    },
    setSpatialGraphSelection(selection: SpatialGraphSelection | null): void {
      const current = spatial.read()
      const authoringSession = spatial.readAuthoringSession()
      const token = authoringSession?.token
      if (!current.spatialSession || !token) return kernel.failSessionless()
      const view = buildSpatialEditorView({
        project: current.spatialSession.history.present,
        locationId: current.spatialSession.selection.locationId,
        sessionCamera: current.spatialSession.sessionCamera,
      })
      const target = captureSpatialEditorAuthoringTarget({
        view,
        sessionToken: token,
        target: selection?.kind === 'path'
          ? { kind: 'path', pathId: selection.id, field: 'session.graphSelection' }
          : selection?.kind === 'relation'
            ? { kind: 'relation', relationId: selection.id, field: 'session.graphSelection' }
            : { kind: 'world', field: 'session.graphSelection' },
      })
      const receipt = runSpatialAuthoringIntent(target, {
        kind: 'set-graph-selection',
        selection,
        expectedSelection: current.spatialGraphSelection,
        expectedContentEdit: current.spatialContentEdit,
      })
      if (receipt.ok && selection) {
        spatial.openPropertiesTab?.()
      }
    },
  }
}

export function persistSpatialLayerCommand(
  spatial: SpatialAuthoringPorts,
  result: LayerCommandResult,
  extra?: { statusMessage?: string | null; selectionIds?: readonly string[] },
): SpatialCommandResult {
  const session = spatial.read().spatialSession
  if (!session) {
    return {
      ok: false,
      reason: 'not-spatial-session',
      historyEntry: false,
      nextSession: session as unknown as SpatialAuthoringSession,
      selection: { locationId: '', surfaceId: '', selectionIds: [] },
    }
  }
  if (!result.ok || !result.nextDocument) {
    return spatial.persist(
      rejectSpatialCommand(session, result.reason ?? 'layer-command-failed'),
    )
  }
  const history = result.historyEntry
    ? commitSpatialAuthoringHistory(session.history, result.nextDocument)
    : { ...session.history, present: result.nextDocument }
  const selection = extra?.selectionIds === undefined
    ? session.selection
    : selectSpatialEditorLayers({
        project: result.nextDocument,
        locationId: session.selection.locationId,
        selectionIds: extra.selectionIds,
      })
  return spatial.persist(
    succeedSpatialCommand({ ...session, history, selection }, Boolean(result.historyEntry)),
    extra,
  )
}

export function spatialPersistSnapshotFrom(
  owned: SpatialOwnedState,
  resources: CourseResourceState,
  dirty: boolean,
  authoringSession: CourseAuthoringSession | null,
): SpatialPersistSnapshot {
  return {
    ...owned,
    resources: readCourseResourceState(resources),
    dirty,
    authoringSession,
  }
}

export function persistSpatialTransaction(
  spatial: SpatialAuthoringPorts,
  step: EditorTransactionStep,
  statusMessage: string,
): boolean {
  const session = spatial.read().spatialSession
  if (!session) return false
  const history = commitSpatialEditorTransactionHistory(session.history, step)
  spatial.persist(succeedSpatialCommand({
    ...session,
    history,
  }, true), {
    transactionStep: step,
    statusMessage,
  })
  return true
}

export function persistSpatialDocument(
  spatial: SpatialAuthoringPorts,
  document: CourseProjectDocument,
  options?: { statusMessage?: string | null; historyEntry?: boolean },
): boolean {
  const session = spatial.read().spatialSession
  if (!session) return false
  const history = options?.historyEntry
    ? commitSpatialAuthoringHistory(session.history, document)
    : { ...session.history, present: document }
  spatial.persist(succeedSpatialCommand({ ...session, history }, Boolean(options?.historyEntry)), {
    statusMessage: options?.statusMessage,
  })
  return true
}
