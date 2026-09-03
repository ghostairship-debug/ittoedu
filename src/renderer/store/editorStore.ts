import { create } from 'zustand'
import type { ComponentPackageData } from '../../shared/componentTypes'
import {
  type InteractionRule,
  type MotionDirection,
  type MotionEffect,
} from '../../shared/interactionTypes'
import type {
  AudioChannel,
  AssetMeta,
  EmbeddedComponentPackageMeta,
  GlobalLayerItem,
  GlobalLayerVisibility,
  ProjectDesignTokens,
  ProjectAudioSettings,
  ShapeType,
  SoundDefinition,
  TextRun,
  TextRunStyle,
} from '../../shared/projectTypes'
import type { ProjectPlaybackSettings } from '../../shared/contracts/playback-v1/types'
import type { RuntimeDocument } from '../../shared/runtimeTypes'
import { UserFacingError } from '../../shared/errors'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import { rotatedRectangleAabb } from '../../shared/geometry'
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  MAX_PROJECT_SCENES,
  MAX_SCENE_NODES,
  MAX_SCENE_PRESENTATION_STATES,
  MIN_NODE_SIZE,
  MIN_VISIBLE_NODE_EDGE,
} from '../../shared/constants'
import {
  SESSIONLESS_COURSE_REASON,
  createEditorStoreKernel,
  courseSessionAfterSurfaceHistory,
  commitSurfaceResourcePersist,
} from './editorStoreKernel'
import {
  cloneCourseAssetSidecar,
  commitCourseResourceState,
  continuedCourseResourceStacks,
  emptyCourseResourceStacks,
  readCourseResourceState,
  type CourseResourceHistoryContinuation,
  type CourseResourceState,
  type CourseResourceTransition,
} from './courseResourceState'
import {
  applySceneNodePatchToCourseOverride,
  applySceneNodePatchToLayerItem,
  commandTargetForRow,
  findCourseSlideScene,
  findMutableCourseLayerItem,
  isSpatialDirectRowPropertyPatch,
  locationIdsToSceneIds,
  locationVisibilityFromScenePatch,
  normalizeNewNodeGeometry,
  normalizeNodeGeometry,
  projectGlobalVisibilityToSlides,
  sceneIdsToLocationIds,
  sessionFromLayerResult,
  slideSurfaceLayerPropertyPatch,
  spatialLayerPropertyPatch,
  v9NodePatchNeedsRoundTrip,
} from './v9LayerMutations'
import {
  detectActiveSurface,
  dispatchActiveSurface,
  exclusiveInactiveSurfaces,
  planActivateCourseLocation,
} from '../composition/surfaceRouter'
import { createCrossSurfaceCommands } from '../composition/crossSurfaceCommands'
import {
  applyV9BackendState,
  createSlideAuthoringSlice,
  persistSlideCandidateResult,
  persistSlideLayerCommand,
  persistSlideMediaResult,
  slidePersistSnapshotFrom,
} from './slices/slideAuthoringSlice'
import {
  applyFlowBackendState,
  createFlowAuthoringSlice,
  persistFlowResult as persistFlowResultFromSlice,
  flowPersistSnapshotFrom,
  type FlowAuthoringIntent,
  type FlowAuthoringReceipt,
} from './slices/flowAuthoringSlice'
import {
  applySpatialBackendState,
  createSpatialAuthoringSlice,
  persistSpatialResult as persistSpatialResultFromSlice,
  spatialPersistSnapshotFrom,
  type SpatialAuthoringIntent,
  type SpatialAuthoringReceipt,
} from './slices/spatialAuthoringSlice'
import { createEditorShellSlice } from './slices/editorShellSlice'
import { bindTeacherControllerAuthoringPorts } from '../authoring/v9TeacherControllerAuthoring'
import {
  applyEditorTransactionStep,
  createEditorTransactionStep,
  type EditorTransactionStep,
} from '../authoring/editorTransaction'
import {
  parseComponentPackageFiles,
  validateComponentRuntimeSource,
} from '../components/importComponentPackage'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '../components/componentPackageStore'
import {
  planCourseComponentPackageDeletion,
  type CourseComponentPackageReplacementFeedback,
  type CourseComponentPackageReplacementFailureCode,
} from '../components/courseComponentPackageTransactions'
import {
  beginV9SlideContentEdit,
  cancelV9SlideContentEdit,
  commitV9SlideContentEdit,
  commitV9SlideTextRunStyle,
  isV9SlideContentDraftDirty,
  updateV9SlideContentTextDraft,
  type V9SlideContentEditSession,
  type V9SlideFormulaContentDraft,
  type V9SlideTextContentDraft,
} from '../authoring/v9SlideContentEdit'
import { commitTeacherControllerAuthoringFrame } from '../authoring/v9TeacherControllerAuthoring'
import type { RuntimeTargetEditSession } from '../authoring/runtimeTargetEditSession'
import {
  commandTargetFromRow,
  scopeTokenForSelectingRow,
  type EffectiveLayerProjection,
  type EffectiveLayerProjectionRow,
} from '../course/effectiveLayerProjection'
import {
  buildCandidateEffectiveLayers as projectActiveSurfaceLayers,
  flowEffectiveLayers,
  spatialEffectiveLayers,
} from '../course/activeSurfaceProjection'
import {
  createRuntimeAuthoringActions,
} from '../runtime/commitRuntimeAuthoring'
import { createInteractionAuthoringActions } from '../interactions/commitInteractionAuthoring'
import { createComponentAuthoringActions } from '../components/commitComponentPackageAuthoring'
import {
  commitMediaLibraryImportAtTarget,
  createMediaAuthoringActions,
  type ImageAuthoringPorts,
} from '../media/commitCourseMediaAuthoring'
import {
  deleteEffectiveLayerItem,
  deleteEffectiveLayerItems,
  duplicateEffectiveLayerItem,
  findGlobalTeacherController,
  moveEffectiveLayerOwner,
  patchEffectiveLayerItem,
  patchEffectiveLayerItems,
  reorderEffectiveLayerItems,
  resolveEffectiveLayerTarget,
  restoreDefaultTeacherController,
  setGlobalLayerLocationVisibility,
  setGlobalLayerVisibleAtLocation,
  LAYER_REJECT_STALE_REVISION,
  type EffectiveLayerOwnerDestination,
  type EffectiveLayerPropertyPatch,
  type LayerCommandResult,
} from '../course/effectiveLayerCommands'
import {
  addCourseLibraryMediaToCanvas,
  bindCourseMediaSession,
  deleteCourseAsset,
  deleteCourseSound,
  importAndPlaceCourseMedia,
  importCourseSounds,
  replaceCourseLayerMedia,
  updateCourseAudioSettings,
  updateCourseSound,
  type CourseImageReplacementFeedback,
  type CourseImageReplacementPlanFailureCode,
  type CourseMediaCommandResult,
  type CourseMediaSession,
} from '../course/v9MediaAudioCommands'
import {
  type CourseMediaLibraryImportFeedback,
  type CourseMediaLibraryImportPlanFailureCode,
} from '../media/courseMediaLibraryImport'
import {
  type CourseRuntimeAssetReplacementFeedback,
  type CourseRuntimeAssetReplacementFailureCode,
  type CourseRuntimeAssetReplacementTarget,
} from '../runtime/courseRuntimeTransactions'
import {
  type RuntimeSourceAuthoringFeedback,
  type RuntimeSourceAuthoringPlanFailureCode,
} from '../runtime/runtimeSourceAuthoringCommands'
import {
  type CourseRuntimeContentTextTarget,
  type RuntimeContentTextAuthoringFeedback,
  type RuntimeContentTextAuthoringPlanFailureCode,
} from '../runtime/runtimeContentTextAuthoringCommands'
import {
  type CourseRuntimePropertyTarget,
  type CourseRuntimePropertyUpdate,
  type RuntimePropertyAuthoringFeedback,
  type RuntimePropertyAuthoringPlanFailureCode,
} from '../runtime/runtimePropertyAuthoringCommands'
import {
  type CourseRuntimeTemplateCreationTarget,
  type CourseRuntimeTemplateCreationFeedback,
  type CourseRuntimeTemplateCreationPlanFailureCode,
} from '../runtime/runtimeTemplateAuthoringCommands'
import {
  type InteractionAuthoringFeedback,
  type InteractionAuthoringPlanFailureCode,
  type InteractionAuthoringTarget,
} from '../interactions/interactionAuthoringCommands'
import type { InteractionTemplateRequest } from '../interactions/interactionTemplates'
import {
  addSlideComponentLayer,
  addSlideFormulaLayer,
  addSlideImageLayer,
  addSlideShapeLayer,
  addSlideTextLayer,
  addSlideVideoLayer,
  updateSlideNativeLayerContent,
  setSlideSimpleEntranceAnimation as writeSlideSimpleEntranceAnimation,
} from '../course/v9SlideContentCommands'
import {
  addSlideSceneInteractionRule,
  copySlideGlobalClipboard,
  deleteSlideSceneLayers,
  duplicateSlideGlobalLayers,
  duplicateSlideSceneLayers,
  executeSlideSceneAction,
  pasteSlideGlobalLayers,
  shouldIgnoreSlideLayerDeleteForFocus,
  updateSlideSceneInteractionRule,
  type SlideSceneActionId,
} from '../course/v9SlideActionCommands'
import type { V9SlideClipboardPayload } from '../course/v9SlideClipboard'
import {
  commitSlideAuthoringHistory,
  commitSlideEditorTransactionHistory,
  commitSlideProjectMutation,
  selectSlideEditorLayers,
  type SlideAuthoringHistory,
} from '../course/slideEditorCommands'
import {
  allocateCourseLayerOrder,
  setGlobalLayerScenePlane,
  sortScopedLayerList,
  updateCoursePlaybackSettings,
} from '../course/globalLayerCommands'
import { createBlankCourseProject } from '../project/createCourseProject'
import {
  courseProjectStartsAsSpatial,
  createBlankSpatialCourseProject,
} from '../project/createSpatialCourseProject'
import {
  courseProjectStartsAsFlow,
  createBlankFlowCourseProject,
  openFlowAuthoringSession,
  type FlowAuthoringSession,
} from '../project/createFlowCourseProject'
import {
  classifyFlowDeleteIntent,
  commitFlowEditorTransactionHistory,
  commitFlowEditorHistory,
  createFlowEditorHistory,
  flowEditorRedoResourceTransition,
  flowEditorUndoResourceTransition,
  redoFlowEditorHistory,
  selectFlowEditorBlock,
  selectFlowEditorBlocks,
  selectFlowOverlay,
  undoFlowEditorHistory,
  type FlowEditorHistory,
  type FlowEditorSelection,
} from '../course/flowEditorSlice'
import {
  executeFlowEditorCommand,
  executeFlowDelete,
  insertFlowEditorBlock,
  updateFlowEditorBlock,
  type FlowCommandResult,
  type FlowDeleteRequest,
} from '../course/flowEditorCommands'
import {
  enterFlowGlobalAuthoring,
  executeFlowSharedDelete,
  insertFlowSharedComponent,
  insertFlowSharedMedia,
  insertFlowSharedShape,
  type FlowSharedAuthoringResult,
} from '../course/flowSharedAuthoringAdapters'
import {
  formatFlowAuthoringBlock,
  formatFlowAuthoringTextStyle,
  commitFlowTextEdit,
  isFlowTextDraftDirty,
  type FlowTextEditSession,
} from '../authoring/flowTextEdit'
import { listFlowCourseTreePages } from '../course/flowEditorView'
import {
  addCourseFlowPage,
  addCourseScene,
  addCourseSlidePage,
  addCourseSpatialPage,
  deleteCourseLocation as applyDeleteCourseLocation,
  deleteCourseSurface as applyDeleteCourseSurface,
  moveCourseSlideScene as applyMoveCourseSlideScene,
  reorderCourseSurfaces as applyReorderCourseSurfaces,
  type CourseLocationCommandResult,
} from '../course/courseLocationCommands'
import {
  executeCourseLogicAuthoringCommand,
  type CourseLogicAuthoringCommand,
  type CourseLogicAuthoringResult,
} from '../course/courseLogicAuthoringCommands'
import type {
  CourseEditorDropdownAction,
  CourseEditorPrimaryAction,
} from '../course/courseEditorLayout'
import { deriveCourseEditorLayout } from '../course/courseEditorLayout'
import {
  createEditorSelectionSnapshot,
  resolveFlowDeleteRoute,
  routeEditorAction as routeEditorActionCore,
  type EditorActionId,
  type EditorActionResult,
  type EditorFocusKind,
  type EditorSelectionSnapshot,
} from '../course/editorActionRouting'
import {
  COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON,
  createSessionToken,
  buildCourseAuthoringSessionForProject,
  selectionSnapshotFromSession,
  switchCourseAuthoringLocation,
  updateCourseAuthoringSessionItems,
  updateCourseAuthoringSessionRevision,
  surfaceTypeForLocation,
  type CourseAuthoringSession,
  type CourseAuthoringSurfaceType,
  type CourseAuthoringTarget,
  type CurrentCourseAuthoringTargetIdentity,
} from '../authoring/courseAuthoringSession'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { resolveEffectiveGlobalLayerPlanes } from '../../shared/courseLayerComposition'
import { findFlowBlockRecursive, flowSurfaceIn } from '../course/flowDocumentModel'
import {
  resolveCourseSurfaceBackgroundColor,
  sceneNodeToCourseLayerItem,
} from '../../shared/courseProjectModel'
import type {
  CourseLocation,
  CourseProjectDocument,
  CourseRuntimeDefinition,
  LayerItem,
  LayerItemOverride,
  LocationVisibility,
  SlidePresentationState,
  SlideSceneDocument,
  SpatialSurfaceDocument,
} from '../../shared/courseProjectTypes'
import {
  addSpatialWorldComponentLayer,
  addSpatialWorldFormulaLayer,
  addSpatialWorldImageLayer,
  addSpatialWorldShapeLayer,
  addSpatialWorldTextLayer,
  addSpatialWorldVideoLayer,
  buildSpatialAuthoringSnapshot,
  openSpatialAuthoringSession,
  redoSpatialAuthoring,
  selectSpatialEditorLayers,
  selectSpatialLayers,
  setSpatialEditingScope,
  undoSpatialAuthoring,
  type SpatialAuthoringSession,
  type SpatialAuthoringSnapshot,
  type SpatialCommandResult,
  type SpatialEditorLayerScope,
} from '../course/spatialEditorCommands'
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
} from '../course/spatialCameraCommands'
import {
  addSpatialPathInSession,
  deleteSpatialPathInSession,
  deleteSpatialWorldLayersReportingReferences,
  reorderSpatialPathWaypointsInSession,
  setSpatialShowCameraFrames,
  updateSpatialPathInSession,
} from '../course/spatialPathCommands'
import {
  addSpatialRelationInSession,
  deleteSpatialRelationInSession,
  updateSpatialRelationInSession,
} from '../course/spatialRelationCommands'
import {
  copySpatialClipboard,
  duplicateSpatialLayers,
  pasteSpatialClipboard,
  type SpatialClipboardPayload,
} from '../course/spatialClipboardCommands'
import {
  addSpatialSemanticZoomRuleInSession,
  deleteSpatialSemanticZoomRuleInSession,
  updateSpatialSemanticZoomRuleInSession,
} from '../course/spatialSemanticZoom'
import {
  beginSpatialWorldContentEdit,
  commitSpatialWorldContentEdit,
  commitSpatialWorldTextRunStyle,
  isSpatialWorldContentDraftDirty,
  updateSpatialWorldContentFormulaDraft,
  updateSpatialWorldContentTextDraft,
  type SpatialWorldContentEditSession,
} from '../authoring/spatialWorldAuthoring'
import {
  commitSpatialAuthoringHistory,
  commitSpatialEditorTransactionHistory,
  commitSpatialProjectMutation,
  freezeSpatialSession,
  rejectSpatialCommand,
  spatialAuthoringLegacyHistoryEntryCount,
  spatialAuthoringRedoResourceTransition,
  spatialAuthoringUndoResourceTransition,
  succeedSpatialCommand,
} from '../course/spatialAuthoringHistory'
import { buildSpatialEditorView } from '../course/spatialEditorView'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
  slideAuthoringGeneration,
  type SlideAuthoringSession,
  transformSlideNativeLayers,
  type SlideAuthoringSnapshot,
  type SlideAuthoringBackend,
  type SlideCommandResult,
} from '../course/slideAuthoringBackend'
import {
  createCourseLifecycleSlice,
  exportCourseProjectArchiveBytes,
  openCourseProjectArchiveBytes,
} from './slices/courseLifecycleSlice'
import {
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  listCourseAssetReferences,
  type CourseAssetSidecar,
} from '../project/v9AssetAdapter'
import {
  executeSlideAuthoringCommand,
  getSlideBackendKind,
  isSlideAuthoringBackend,
  type SlideBackend,
  type SlideBackendKind,
} from './slideBackendPort'
import {
  applyV9SlideContentDraft,
  courseLayerItemToEditorCanvasNode,
  projectV9EditingNodes,
  projectV9SlideScenes,
} from './slideEditorProjection'
import type {
  EditorCanvasDocument,
  EditorCanvasNode,
  EditorCanvasNodePatch,
  EditorCanvasSceneView,
} from '../phaser/editorCanvasNode'


interface SlideCandidateUiProjection {
  scenes: EditorCanvasSceneView[]
  activeScene: EditorCanvasSceneView
  nodes: EditorCanvasNode[]
}

function isV9SlideTextContentDraft(
  draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft,
): draft is V9SlideTextContentDraft {
  return 'text' in draft && 'runs' in draft
}

function courseRuntimeToDocument(runtime: CourseRuntimeDefinition): RuntimeDocument {
  return {
    runtimeApiVersion: 2,
    enabled: runtime.enabled,
    renderMode: runtime.renderMode,
    source: runtime.source,
    content: structuredClone(runtime.content),
    assets: structuredClone(runtime.assets),
    ...(runtime.nodeBindings ? { nodeBindings: structuredClone(runtime.nodeBindings) } : {}),
    ...(runtime.staticFallback
      ? {
          staticFallback: {
            assetId: runtime.staticFallback.assetId,
            coverage: runtime.staticFallback.coverage === 'scene' ? 'full-scene' : 'runtime-layer',
            layer: 'overlay' as const,
          },
        }
      : {}),
  }
}

function firstRuntimeItem(items: readonly LayerItem[]): LayerItem | undefined {
  return items.find((item) => item.kind === 'runtime')
}

function attachProjectedRuntimes(
  document: CourseProjectDocument,
  scenes: EditorCanvasSceneView[],
): { scenes: EditorCanvasSceneView[]; globalRuntime?: RuntimeDocument } {
  const globalRuntimeItem = firstRuntimeItem(document.globalLayerItems.map((entry) => entry.item))
  const nextScenes = scenes.map((scene) => {
    const surface = document.surfaces.find((candidate) => (
      candidate.type === 'slide' && candidate.scenes.some((item) => item.id === scene.id)
    ))
    const source = surface && surface.type === 'slide'
      ? surface.scenes.find((item) => item.id === scene.id)
      : undefined
    const runtimeItem = source ? firstRuntimeItem(source.layerItems) : undefined
    if (!runtimeItem || runtimeItem.kind !== 'runtime') return scene
    return { ...scene, runtime: courseRuntimeToDocument(runtimeItem.runtime) }
  })
  return {
    scenes: nextScenes,
    ...(globalRuntimeItem?.kind === 'runtime'
      ? { globalRuntime: courseRuntimeToDocument(globalRuntimeItem.runtime) }
      : {}),
  }
}

function buildCandidateEffectiveLayers(
  state: Pick<EditorState, 'slideBackend' | 'slideCandidateSnapshot' | 'spatialSession' | 'flowSession'>,
): EffectiveLayerProjection | null {
  return projectActiveSurfaceLayers({
    slideBackend: isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null,
    spatialSession: state.spatialSession,
    flowSession: state.flowSession,
  })
}

export type SpatialGraphSelection =
  | { readonly kind: 'path'; readonly id: string }
  | { readonly kind: 'relation'; readonly id: string }

function spatialEditingNodes(
  session: SpatialAuthoringSession,
  edit: SpatialWorldContentEditSession | null,
): EditorCanvasNode[] {
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    sessionCamera: session.sessionCamera,
  })
  const wanted = session.scope === 'global' ? 'viewport' : 'world'
  return view.layers.flatMap((layer): EditorCanvasNode[] => {
    if (layer.coordinateSpace !== wanted) return []
    const node = courseLayerItemToEditorCanvasNode(layer.item as LayerItem)
    if (!node) return []
    if (
      edit?.kind === 'text' &&
      edit.target.layerItemId === node.id &&
      node.type === 'text' &&
      isV9SlideTextContentDraft(edit.draft)
    ) {
      return [{
        ...node,
        text: edit.draft.text,
        runs: structuredClone(edit.draft.runs),
        ...(typeof edit.draft.width === 'number' ? { width: edit.draft.width } : {}),
        ...(typeof edit.draft.height === 'number' ? { height: edit.draft.height } : {}),
      }]
    }
    return [node]
  })
}

function flowEditingNodes(session: FlowAuthoringSession): EditorCanvasNode[] {
  const projection = flowEffectiveLayers(session)
  const wanted = session.selection.authoringScope === 'global' ? 'global' : null
  return projection.unifiedRows.flatMap((row) => {
    if (wanted && row.owner !== wanted) return []
    const node = courseLayerItemToEditorCanvasNode(row.item)
    return node ? [node] : []
  })
}

export type {
  SidebarTab,
  EditorMode,
  EditingScope,
  CanvasMode,
  TextEditSource,
} from './slices/editorShellSlice'
export type { AlignmentMode } from './slices/slideOwnedCommands'
export type { SimpleEntranceAnimationConfig } from '../course/v9SlideContentCommands'

import type {
  SidebarTab,
  EditorMode,
  EditingScope,
  CanvasMode,
  TextEditSource,
} from './slices/editorShellSlice'
import type { AlignmentMode } from './slices/slideOwnedCommands'
import type { SimpleEntranceAnimationConfig } from '../course/v9SlideContentCommands'
import type {
  CourseProjectPersistenceSnapshot,
  CourseProjectPersistenceToken,
  PrepareCourseProjectPersistenceResult,
  CaptureCourseProjectRecoveryResult,
} from './slices/courseLifecycleSlice'

const EDITOR_MODE_STORAGE_KEY = 'courseware-editor:mode'

function loadEditorMode(): EditorMode {
  try {
    return globalThis.localStorage?.getItem(EDITOR_MODE_STORAGE_KEY) === 'professional'
      ? 'professional'
      : 'simple'
  } catch {
    return 'simple'
  }
}


import type {
  ImageReplacementCommitResult,
  ImportedAssetBatchItem,
  MediaLibraryImportCommitResult,
  ProjectAudioSettingsPatch,
} from '../media/commitCourseMediaAuthoring'
import type {
  ComponentPackageReplacementCommitResult,
  ComponentPackageReplacementTarget,
} from '../components/commitComponentPackageAuthoring'
import type {
  RuntimeAssetReplacementCommitResult,
  RuntimeContentTextAuthoringCommitResult,
  RuntimePropertyAuthoringCommitResult,
  RuntimeSourceAuthoringCommitResult,
  RuntimeTemplateCreationCommitResult,
} from '../runtime/commitRuntimeAuthoring'
import type {
  InteractionAuthoringCommitResult,
} from '../interactions/commitInteractionAuthoring'
import type {
  CourseProjectRevisionTarget,
} from '../authoring/courseAuthoringSession'

export type {
  CourseProjectPersistenceSnapshot,
  CourseProjectPersistenceToken,
  PrepareCourseProjectPersistenceResult,
  CaptureCourseProjectRecoveryResult,
} from './slices/courseLifecycleSlice'

export interface EditorState {
  activeSceneId: string
  /** `null` edits the canonical base scene. */
  activePresentationStateId: string | null
  editingScope: EditingScope
  canvasMode: CanvasMode
  selectedNodeId: string | null
  selectedNodeIds: string[]
  projectPath: string | null
  dirty: boolean
  readonly assetFiles: Record<string, Uint8Array>
  componentPackages: Record<string, ComponentPackageData>
  editorMode: EditorMode
  activeTab: SidebarTab
  editingTextNodeId: string | null
  statusMessage: string | null
  errorMessage: string | null
  /** Product Slide authoring backend. Null while Flow or Spatial session is active. */
  slideBackend: SlideBackend
  /** Cached after successful candidate commands so Zustand subscribers refresh. */
  slideCandidateSnapshot: SlideAuthoringSnapshot | null
  slideCandidateClipboard: V9SlideClipboardPayload | null
  v9ContentEdit: V9SlideContentEditSession | null
  /** Candidate asset bytes. Not V8 `assetFiles`. Undo/redo restores this with session history. */
  courseAssetSidecar: CourseAssetSidecar | null
  courseAssetSidecarPast: CourseAssetSidecar[]
  courseAssetSidecarFuture: CourseAssetSidecar[]
  /** Executable component payloads. Undo/redo restores this with session history. */
  courseComponentPackagesPast: Record<string, ComponentPackageData>[]
  courseComponentPackagesFuture: Record<string, ComponentPackageData>[]
  /** Pure Spatial authoring session. Null on the default Slide product path. */
  spatialSession: SpatialAuthoringSession | null
  /** Session-only canonical Spatial clipboard; never mirrored into legacy clipboard fields. */
  spatialClipboard: SpatialClipboardPayload | null
  spatialContentEdit: SpatialWorldContentEditSession | null
  spatialGraphSelection: SpatialGraphSelection | null
  spatialPlaybackPathId: string | null
  /** Pure Flow authoring session. Null on the default Slide product path. */
  flowSession: FlowAuthoringSession | null
  flowTextEdit: FlowTextEditSession | null
  courseAuthoringSession: CourseAuthoringSession | null

  createNewProject(): void
  createNewSpatialProject(): void
  createNewFlowProject(): void
  loadProject(
    project: unknown,
    path: string | null,
    assetFiles?: Record<string, Uint8Array>,
    componentPackages?: Record<string, ComponentPackageData>,
  ): void
  loadCourseProject(
    project: CourseProjectDocument,
    path: string | null,
    assetFiles?: Record<string, Uint8Array>,
    componentPackages?: Record<string, ComponentPackageData>,
  ): void
  prepareCourseProjectPersistence(): PrepareCourseProjectPersistenceResult
  captureCourseProjectRecoverySnapshot(): CaptureCourseProjectRecoveryResult
  acknowledgeCourseProjectSaved(path: string, token: CourseProjectPersistenceToken): boolean
  setEditingScope(scope: EditingScope): void
  setCanvasMode(mode: CanvasMode): void
  setEditorMode(mode: EditorMode): void
  setActiveTab(tab: SidebarTab): void
  setStatus(message: string | null): void
  setError(message: string | null): void
  renameProject(title: string): void
  setEditingTextNode(nodeId: string | null): void
  beginTextEdit(nodeId: string, source?: TextEditSource): void
  updateTextEditDraft(
    nodeId: string,
    text: string,
    runs: TextRun[],
    height?: number,
    width?: number,
  ): void
  commitTextEdit(): void
  cancelTextEdit(): void

  addScene(): void
  addCourseContent(
    action: CourseEditorPrimaryAction | CourseEditorDropdownAction,
    options?: { surfaceId?: string },
  ): void
  reorderCourseSurfaces(surfaceIds: string[]): void
  deleteCourseSurface(surfaceId: string): void
  moveCourseSlideScene(locationId: string, targetSurfaceId: string, toIndex?: number): void
  activateCourseLocation(locationId: string): void
  createLiveEditorSelectionSnapshot(
    focus?: EditorFocusKind | EventTarget | null,
  ): EditorSelectionSnapshot | null
  routeEditorAction(
    actionId: EditorActionId,
    snapshot?: EditorSelectionSnapshot,
  ): EditorActionResult
  duplicateScene(sceneId: string): void
  deleteScene(sceneId: string): boolean
  reorderScenes(sceneIds: string[]): void
  updateScene(
    sceneId: string,
    patch: Partial<Pick<EditorCanvasDocument, 'name' | 'backgroundColor' | 'backgroundAssetId'>>,
  ): void
  createRuntimeTemplateAtTarget(
    target: CourseRuntimeTemplateCreationTarget,
  ): RuntimeTemplateCreationCommitResult
  updateRuntimeSourceAtTarget(
    target: CourseAuthoringTarget,
    source: string,
  ): RuntimeSourceAuthoringCommitResult
  captureRuntimeContentTextTarget(
    session: Readonly<RuntimeTargetEditSession>,
  ): CourseRuntimeContentTextTarget | null
  updateRuntimeContentTextAtTarget(
    target: CourseRuntimeContentTextTarget,
    value: string,
  ): RuntimeContentTextAuthoringCommitResult
  updateRuntimePropertyAtTarget(
    target: CourseRuntimePropertyTarget,
    update: CourseRuntimePropertyUpdate,
  ): RuntimePropertyAuthoringCommitResult
  captureRuntimeAssetReplacementTarget(
    session: Readonly<RuntimeTargetEditSession>,
  ): CourseRuntimeAssetReplacementTarget | null
  replaceRuntimeAssetAtTarget(
    target: CourseRuntimeAssetReplacementTarget,
    asset: AssetMeta,
    bytes: Uint8Array,
  ): RuntimeAssetReplacementCommitResult
  setActiveScene(sceneId: string): void
  setActivePresentationState(stateId: string | null): void
  addPresentationState(name?: string): void
  duplicatePresentationState(stateId: string): void
  renamePresentationState(stateId: string, name: string): void
  deletePresentationState(stateId: string): boolean
  setInitialPresentationState(stateId: string): void
  setThumbnailPresentationState(stateId: string): void
  updatePresentationState(
    stateId: string,
    patch: Partial<Pick<SlidePresentationState, 'name' | 'description' | 'backgroundColor' | 'backgroundAssetId'>>,
  ): void
  clearNodePresentationOverride(nodeId: string): void
  clearPresentationStateOverrides(stateId: string): void

  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(shapeType: ShapeType, x?: number, y?: number): void
  addImageNode(asset: AssetMeta, bytes: Uint8Array, x?: number, y?: number): void
  addVideoNode(asset: AssetMeta, bytes: Uint8Array, x?: number, y?: number): void
  addImageNodes(
    items: ImportedAssetBatchItem[],
    position?: { x?: number; y?: number },
  ): string[]
  addVideoNodes(
    items: ImportedAssetBatchItem[],
    position?: { x?: number; y?: number },
  ): string[]
  importAsset(asset: AssetMeta, bytes: Uint8Array): void
  importAssets(items: ImportedAssetBatchItem[]): void
  captureMediaLibraryImportTarget(): CourseProjectRevisionTarget | null
  importAssetsAtTarget(
    target: CourseProjectRevisionTarget,
    items: ImportedAssetBatchItem[],
  ): MediaLibraryImportCommitResult
  captureImageReplacementTarget(): CourseAuthoringTarget | null
  replaceImageAssetAtTarget(
    target: CourseAuthoringTarget,
    asset: AssetMeta,
    bytes: Uint8Array,
  ): ImageReplacementCommitResult
  importSound(asset: AssetMeta, bytes: Uint8Array, sound?: Partial<SoundDefinition>): string
  importSounds(items: ImportedAssetBatchItem[]): string[]
  updateAudioSettings(patch: ProjectAudioSettingsPatch): void
  updateSound(soundId: string, patch: Partial<Omit<SoundDefinition, 'id'>>): void
  deleteSound(soundId: string): boolean
  deleteAsset(assetId: string): boolean
  applyInteractionTemplateAtTarget(
    target: InteractionAuthoringTarget,
    template: InteractionTemplateRequest,
  ): InteractionAuthoringCommitResult
  updateInteractionRuleAtTarget(
    target: InteractionAuthoringTarget,
    ruleId: string,
    patch: Partial<Omit<InteractionRule, 'id'>>,
  ): InteractionAuthoringCommitResult
  applyCourseLogicAuthoringCommand(
    command: CourseLogicAuthoringCommand,
  ): CourseLogicAuthoringResult
  addInteractionRule(sceneId: string, rule: InteractionRule): void
  updateInteractionRule(sceneId: string, ruleId: string, rule: InteractionRule): void
  deleteInteractionRule(sceneId: string, ruleId: string): void
  duplicateInteractionRule(sceneId: string, ruleId: string): string | null
  moveInteractionRule(
    sceneId: string,
    ruleId: string,
    direction: -1 | 1,
  ): void
  addGlobalInteractionRule(rule: InteractionRule): void
  updateGlobalInteractionRule(ruleId: string, rule: InteractionRule): void
  deleteGlobalInteractionRule(ruleId: string): void
  duplicateGlobalInteractionRule(ruleId: string): string | null
  moveGlobalInteractionRule(ruleId: string, direction: -1 | 1): void
  setSimpleEntranceAnimation(
    nodeId: string,
    config: SimpleEntranceAnimationConfig | null,
  ): void
  updatePlayback(patch: Partial<ProjectPlaybackSettings>): void
  updateDesignTokens(tokens: ProjectDesignTokens): void
  ensureTeacherController(): void
  addExternalComponentNode(packageId: string, x?: number, y?: number, presetId?: string): void
  importComponentPackage(packageData: ComponentPackageData): void
  importComponentPackages(packageData: ComponentPackageData[]): void
  deleteComponentPackage(packageId: string): boolean
  replaceComponentPackage(packageId: string, packageData: ComponentPackageData): void
  captureComponentPackageReplacementTarget(
    packageId: string,
  ): ComponentPackageReplacementTarget | null
  replaceComponentPackageAtTarget(
    target: ComponentPackageReplacementTarget,
    packageData: ComponentPackageData,
  ): ComponentPackageReplacementCommitResult
  createEditableComponentCopy(packageId: string, nodeId?: string): string | null
  updateEditableComponentPackage(
    packageId: string,
    patch: Partial<Pick<ComponentPackageData, 'manifest' | 'runtimeSource'>>,
  ): void
  deleteNode(nodeId: string): void
  deleteSelectedNodes(): void
  duplicateNode(nodeId: string): void
  duplicateSelectedNodes(): void
  copySelectedNodes(): void
  pasteNodes(): void
  nudgeSelection(dx: number, dy: number): void
  alignSelection(mode: AlignmentMode): void
  distributeSelection(axis: 'horizontal' | 'vertical'): void
  updateNodes(patches: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>): void
  updateNode(nodeId: string, patch: EditorCanvasNodePatch): void
  updateGlobalLayerSettings(
    nodeId: string,
    patch: Partial<Pick<GlobalLayerItem, 'layer' | 'visibility'>>,
  ): void
  reorderNodes(nodeIds: string[]): void
  selectNode(nodeId: string | null, additive?: boolean): void
  selectNodes(nodeIds: string[]): void

  undo(): void
  redo(): void

  /** Test/dev only. Do not bind to App, menus, or URL query. */
  injectV9SlideCandidateBackend(backend: SlideAuthoringBackend): void
  /** Test/dev only. Discards the in-memory candidate and returns the session to V8. */
  clearV9SlideCandidateBackend(): void
  runSlideCandidateCommand(
    run: (backend: SlideAuthoringBackend) => SlideCommandResult,
  ): SlideCommandResult
  applySlideCandidateSession(session: SlideAuthoringSession): void
  applySlideCandidateCommand(
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: {
      clipboard?: V9SlideClipboardPayload | null
      statusMessage?: string | null
      clearContentEdit?: boolean
      sidecar?: CourseAssetSidecar
      sidecarDirection?: 'undo' | 'redo'
    },
  ): SlideCommandResult
  importV9CandidateMedia(input: {
    items: ImportedAssetBatchItem[]
    nativeType?: 'image' | 'video' | 'audio'
    mode?: 'add' | 'library'
    x?: number
    y?: number
  }): CourseMediaCommandResult
  /** Test helper. Reloads a V9 zip into the default V9 session. */
  exportV9SlideCandidateArchive(): Uint8Array | null
  /** Reopens a V9 zip as the current session. Does not call V8 loadProject. */
  reopenV9SlideCandidateArchive(bytes: Uint8Array): boolean
  runSpatialCommand(
    run: (session: SpatialAuthoringSession) => SpatialCommandResult,
    extra?: { statusMessage?: string | null; sidecar?: CourseAssetSidecar; clearContentEdit?: boolean },
  ): SpatialCommandResult
  applySpatialAuthoringSession(
    session: SpatialAuthoringSession,
    extra?: { historyEntry?: boolean; statusMessage?: string | null },
  ): SpatialCommandResult
  runSpatialAuthoringIntent(
    target: CourseAuthoringTarget,
    intent: SpatialAuthoringIntent,
  ): SpatialAuthoringReceipt
  applyFlowCommand(
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra?: { statusMessage?: string | null; sidecar?: CourseAssetSidecar },
  ): FlowCommandResult | FlowSharedAuthoringResult
  runFlowAuthoringIntent(
    target: CourseAuthoringTarget,
    intent: FlowAuthoringIntent,
  ): FlowAuthoringReceipt
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
  setSpatialGraphSelection(selection: SpatialGraphSelection | null): void
  setSpatialPlaybackPathId(pathId: string | null): void
  moveCandidateLayerOwner(fromId: string, toId: string): void
  setCandidateGlobalLayerLocationVisibility(
    nodeId: string,
    visibility: { mode: 'all' | 'include' | 'exclude'; locationIds: string[] },
  ): void
  setCandidateGlobalLayerVisibleAtLocation(nodeId: string, visible: boolean): void
  commitSlideCandidateTextRunStyle(input: {
    layerItemId: string
    selectionStart: number
    selectionEnd: number
    patch: TextRunStyle
    source?: TextEditSource
  }): SlideCommandResult | SpatialCommandResult
}


const EMPTY_SCENE_NODES: EditorCanvasNode[] = []

function editingNodes(state: EditorState): EditorCanvasNode[] {
  const backend = isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null
  if (backend) return applyV9SlideContentDraft(projectV9EditingNodes(backend), state.v9ContentEdit)
  if (state.spatialSession) return spatialEditingNodes(state.spatialSession, state.spatialContentEdit)
  if (state.flowSession) return flowEditingNodes(state.flowSession)
  return EMPTY_SCENE_NODES
}

export function selectHasDirtyCourseContentDraft(state: EditorState): boolean {
  if (
    state.spatialContentEdit
    && isSpatialWorldContentDraftDirty(state.spatialContentEdit)
  ) {
    return true
  }
  if (state.flowTextEdit && isFlowTextDraftDirty(state.flowTextEdit)) return true
  if (state.v9ContentEdit && isV9SlideContentDraftDirty(state.v9ContentEdit)) return true
  return false
}

export function selectHasUnsavedCourseChanges(state: EditorState): boolean {
  return state.dirty || selectHasDirtyCourseContentDraft(state)
}

export const useEditorStore = create<EditorState>((set, get) => {
  const initialCourse = createBlankCourseProject()
  const initialBackend = createSlideAuthoringBackend(openSlideAuthoringSession(initialCourse))
  const initialSidecar = emptyCourseAssetSidecar()
  const initialSnapshot = initialBackend.getSnapshot()

  const applyV9Backend = (
    backend: SlideAuthoringBackend,
    extra: {
      sidecar?: CourseAssetSidecar
      path?: string | null
      dirty?: boolean
      statusMessage?: string | null
      componentPackages?: Record<string, ComponentPackageData>
      clearClipboard?: boolean
      canvasMode?: CanvasMode
      resourceHistory?: CourseResourceHistoryContinuation
    } = {},
  ) => {
    const snapshot = backend.getSnapshot()
    set({
      ...applyV9BackendState(backend, {
        ...extra,
        currentClipboard: get().slideCandidateClipboard,
      }),
      courseAuthoringSession: buildCourseAuthoringSessionForProject(
        backend.getSession().history.present,
        snapshot.locationId,
        snapshot.selection.selectionIds,
      ),
    })
  }

  const persistCandidateResult = (
    result: SlideCommandResult,
    extra: Parameters<typeof persistSlideCandidateResult>[3] = {},
  ): SlideCommandResult => {
    const current = get()
    return persistSlideCandidateResult(
      slidePersistSnapshotFrom(
        {
          slideBackend: current.slideBackend,
          slideCandidateSnapshot: current.slideCandidateSnapshot,
          slideCandidateClipboard: current.slideCandidateClipboard,
          v9ContentEdit: current.v9ContentEdit,
        },
        current,
        current.dirty,
        current.courseAuthoringSession,
      ),
      (patch) => set(patch),
      result,
      extra,
    )
  }

  const persistSpatialResult = (
    result: SpatialCommandResult,
    extra: Parameters<typeof persistSpatialResultFromSlice>[3] = {},
  ): SpatialCommandResult => {
    const current = get()
    return persistSpatialResultFromSlice(
      spatialPersistSnapshotFrom(
        {
          spatialSession: current.spatialSession,
          spatialClipboard: current.spatialClipboard,
          spatialContentEdit: current.spatialContentEdit,
          spatialGraphSelection: current.spatialGraphSelection,
          spatialPlaybackPathId: current.spatialPlaybackPathId,
        },
        current,
        current.dirty,
        current.courseAuthoringSession,
      ),
      (patch) => set(patch),
      result,
      extra,
    )
  }

  const persistSpatialLayerCommand = (
    result: LayerCommandResult,
    extra?: { statusMessage?: string | null; selectionIds?: readonly string[] },
  ): SpatialCommandResult => {
    const session = get().spatialSession
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
      return persistSpatialResult(
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
    return persistSpatialResult(
      succeedSpatialCommand({ ...session, history, selection }, Boolean(result.historyEntry)),
      extra,
    )
  }

  const applySpatialBackend = (
    session: SpatialAuthoringSession,
    extra: {
      sidecar?: CourseAssetSidecar
      path?: string | null
      dirty?: boolean
      statusMessage?: string | null
      componentPackages?: Record<string, ComponentPackageData>
      canvasMode?: CanvasMode
      resourceHistory?: CourseResourceHistoryContinuation
    } = {},
  ) => {
    set({
      ...applySpatialBackendState(session, extra),
      courseAuthoringSession: buildCourseAuthoringSessionForProject(
        session.history.present,
        session.selection.locationId,
        session.selection.selectionIds,
      ),
    })
  }

  const persistFlowResult = (
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra: Parameters<typeof persistFlowResultFromSlice>[3] = {},
  ): FlowCommandResult | FlowSharedAuthoringResult => {
    const current = get()
    return persistFlowResultFromSlice(
      flowPersistSnapshotFrom(
        {
          flowSession: current.flowSession,
          flowTextEdit: current.flowTextEdit,
        },
        current,
        current.dirty,
        current.courseAuthoringSession,
      ),
      (patch) => set(patch),
      result,
      extra,
    )
  }

  const persistProjectResourceTransaction = (
    step: EditorTransactionStep,
    statusMessage: string,
  ): boolean => {
    const state = get()
    if (state.spatialSession) {
      const session = state.spatialSession
      const history = commitSpatialEditorTransactionHistory(session.history, step)
      persistSpatialResult(succeedSpatialCommand({
        ...session,
        history,
      }, true), {
        transactionStep: step,
        statusMessage,
      })
      return true
    }
    if (state.flowSession) {
      const session = state.flowSession
      const history = commitFlowEditorTransactionHistory(session.history, step)
      persistFlowResult({
        ok: true,
        nextDocument: step.nextDocument,
        historyEntry: true,
        selection: session.selection,
      }, {
        replaceHistory: history,
        transactionStep: step,
        statusMessage,
      })
      return true
    }
    const backend = selectSlideAuthoringBackend(state)
    if (!backend) return false
    const session = backend.getSession()
    const authoringSession = state.courseAuthoringSession
    persistCandidateResult({
      ok: true,
      nextSession: {
        ...session,
        history: commitSlideEditorTransactionHistory(session.history, step),
      },
      historyEntry: true,
      selection: session.selection,
      resourceTransition: {
        resourceChanges: step.resourceChanges,
        resourceDirection: 'forward',
      },
    }, {
      transactionStep: step,
      statusMessage,
      ...(authoringSession
        ? {
            courseAuthoringSession: updateCourseAuthoringSessionItems(
              updateCourseAuthoringSessionRevision(
                authoringSession,
                step.nextDocument.revision,
              ),
              authoringSession.itemIds,
            ),
          }
        : {}),
    })
    return true
  }

  const featurePorts: ImageAuthoringPorts = {
    read() {
      const state = get()
      return {
        document: selectActiveCourseProjectDocument(state),
        sidecar: state.courseAssetSidecar,
        componentPackages: state.componentPackages,
        authoringSession: state.courseAuthoringSession,
        editingScope: state.editingScope,
        activeSceneId: state.activeSceneId,
        projection: buildCandidateEffectiveLayers(state),
        interactionLocationId: state.spatialSession?.selection.locationId
          ?? state.flowSession?.selection.locationId
          ?? state.slideCandidateSnapshot?.locationId
          ?? null,
        interactionStateId: state.slideCandidateSnapshot?.stateId ?? null,
        hasSlideSession: Boolean(selectSlideAuthoringBackend(state)),
        hasFlowSession: Boolean(state.flowSession),
        hasSpatialSession: Boolean(state.spatialSession),
      }
    },
    persistTransaction: persistProjectResourceTransaction,
    persistCandidateResult: (result, extra) => {
      persistCandidateResult(result, extra)
    },
    setFeedback(feedback) {
      set(feedback)
    },
    setActiveTab(tab) {
      const simpleHidden = new Set<string>(['components', 'automation', 'developer'])
      const activeTab = get().editorMode === 'simple' && simpleHidden.has(tab)
        ? 'elements'
        : tab
      set({ activeTab, errorMessage: null })
    },
    readSlideSession() {
      return selectSlideAuthoringBackend(get())?.getSession() ?? null
    },
    readSpatialSession() {
      return get().spatialSession
    },
    readFlowSession() {
      return get().flowSession
    },
    persistProject(project, extra) {
      const state = get()
      if (state.spatialSession) {
        persistSpatialResult(succeedSpatialCommand({
          ...state.spatialSession,
          history: commitSpatialAuthoringHistory(state.spatialSession.history, project),
        }, true), extra)
        return
      }
      if (state.flowSession) {
        persistFlowResult({
          ok: true,
          nextDocument: project,
          historyEntry: true,
          selection: state.flowSession.selection,
        }, extra)
        return
      }
      const backend = selectSlideAuthoringBackend(state)
      if (!backend) return
      const session = backend.getSession()
      persistCandidateResult({
        ok: true,
        nextSession: {
          ...session,
          history: commitSlideAuthoringHistory(session.history, project),
        },
        historyEntry: true,
      }, extra)
    },
    persistSlideCommand(run, extra) {
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) {
        return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false }
      }
      return persistCandidateResult(run(backend.getSession()), extra)
    },
    persistMedia(result) {
      return slideAuthoringSlice.persistMediaResult(result, get().errorMessage)
    },
    persistLayer(result, extra) {
      slideAuthoringSlice.persistLayerCommand(result, extra)
    },
    persistSpatial(result, extra) {
      persistSpatialResult(result, extra)
    },
    persistFlow(result, extra) {
      persistFlowResult(result, extra)
    },
  }
  const runtimeAuthoringActions = createRuntimeAuthoringActions(featurePorts)
  const mediaAuthoringActions = createMediaAuthoringActions(featurePorts)
  const componentAuthoringActions = createComponentAuthoringActions(featurePorts)
  const interactionAuthoringActions = createInteractionAuthoringActions(featurePorts)

  const persistFlowLayerCommand = (
    result: LayerCommandResult,
    extra?: { statusMessage?: string | null },
  ) => {
    const session = get().flowSession
    if (!session) {
      return { ok: false, reason: 'not-flow-session', historyEntry: false } as const
    }
    if (!result.ok || !result.nextDocument) {
      if (result.reason) set({ errorMessage: result.reason, statusMessage: null })
      return { ok: false, reason: result.reason ?? 'layer-command-failed', historyEntry: false } as const
    }
    const overlayId = result.createdLayerItemId ?? session.selection.selectedOverlayIds[0]
    let selection = session.selection
    if (overlayId) {
      try {
        selection = selectFlowOverlay(
          result.nextDocument,
          session.selection.locationId,
          session.selection.selectedOverlayIds.includes(overlayId)
            ? [...session.selection.selectedOverlayIds]
            : [overlayId],
          session.selection.authoringScope,
        )
      } catch {
        selection = session.selection
      }
    }
    return persistFlowResult({
      ok: true,
      reason: result.reason,
      nextDocument: result.nextDocument,
      historyEntry: Boolean(result.historyEntry),
      selection,
    }, extra)
  }

  const applyFlowBackend = (
    session: FlowAuthoringSession,
    extra: {
      sidecar?: CourseAssetSidecar
      path?: string | null
      dirty?: boolean
      statusMessage?: string | null
      componentPackages?: Record<string, ComponentPackageData>
      canvasMode?: CanvasMode
      resourceHistory?: CourseResourceHistoryContinuation
    } = {},
  ) => {
    set({
      ...applyFlowBackendState(session, extra),
      courseAuthoringSession: buildCourseAuthoringSessionForProject(
        session.history.present,
        session.selection.locationId,
        session.selection.selectedOverlayIds,
      ),
    })
  }


  const kernel = createEditorStoreKernel({
    tryReadDocument: () => selectActiveCourseProjectDocument(get()),
    readAuthoringSession: () => get().courseAuthoringSession,
    writeAuthoringSession: (session) => set({ courseAuthoringSession: session ?? null }),
    readResources: () => readCourseResourceState(get()),
    commit: (patch) => set(patch),
    readDirty: () => get().dirty,
    readSelection: () => {
      const current = get()
      return {
        selectedNodeIds: current.selectedNodeIds,
        selectedNodeId: current.selectedNodeId,
        editingScope: current.editingScope,
        activeSceneId: current.activeSceneId,
        activePresentationStateId: current.activePresentationStateId,
      }
    },
    syncSelection: (selection) => set(selection),
  })
  const slideAuthoringSlice = createSlideAuthoringSlice(kernel, {
    read: () => {
      const current = get()
      return {
        slideBackend: current.slideBackend,
        slideCandidateSnapshot: current.slideCandidateSnapshot,
        slideCandidateClipboard: current.slideCandidateClipboard,
        v9ContentEdit: current.v9ContentEdit,
      }
    },
    patch: (patch) => set(patch),
    persist: persistCandidateResult,
    applyBackend: applyV9Backend,
  })
  const flowAuthoringSlice = createFlowAuthoringSlice(kernel, {
    read: () => {
      const current = get()
      return {
        flowSession: current.flowSession,
        flowTextEdit: current.flowTextEdit,
      }
    },
    readAuthoringSession: () => get().courseAuthoringSession,
    readAssetSidecar: () => get().courseAssetSidecar,
    patch: (patch) => set(patch),
    persist: persistFlowResult,
    applyBackend: applyFlowBackend,
  })
  const spatialAuthoringSlice = createSpatialAuthoringSlice(kernel, {
    read: () => {
      const current = get()
      return {
        spatialSession: current.spatialSession,
        spatialClipboard: current.spatialClipboard,
        spatialContentEdit: current.spatialContentEdit,
        spatialGraphSelection: current.spatialGraphSelection,
        spatialPlaybackPathId: current.spatialPlaybackPathId,
      }
    },
    readAuthoringSession: () => get().courseAuthoringSession,
    patch: (patch) => set(patch),
    persist: persistSpatialResult,
    applyBackend: applySpatialBackend,
  })
  const courseLifecycleSlice = createCourseLifecycleSlice(kernel, {
    read: () => {
      const current = get()
      return { projectPath: current.projectPath, dirty: current.dirty }
    },
    patch: (patch) => set(patch),
    applySlide: (project, extra) => applyV9Backend(
      createSlideAuthoringBackend(openSlideAuthoringSession(project)),
      extra,
    ),
    applyFlow: (project, extra) => applyFlowBackend(
      openFlowAuthoringSession(project),
      extra,
    ),
    applySpatial: (project, extra) => applySpatialBackend(
      openSpatialAuthoringSession(project),
      extra,
    ),
  })
  const editorShellSlice = createEditorShellSlice(kernel, {
    read: () => {
      const current = get()
      return {
        editorMode: current.editorMode,
        activeTab: current.activeTab,
        canvasMode: current.canvasMode,
        statusMessage: current.statusMessage,
        errorMessage: current.errorMessage,
        editingTextNodeId: current.editingTextNodeId,
      }
    },
    patch: (patch) => set(patch),
  })
  bindTeacherControllerAuthoringPorts({
    readBackend: () => selectSlideAuthoringBackend(get()),
    commit: (run) => get().applySlideCandidateCommand(run),
  })
  const crossSurfaceCommands = createCrossSurfaceCommands({
    detect: () => detectActiveSurface({
      spatialLocationId: get().spatialSession?.selection.locationId ?? null,
      flowLocationId: get().flowSession?.selection.locationId ?? null,
      slideLocationId: get().slideCandidateSnapshot?.locationId ?? null,
      editingScope: get().editingScope,
      composing: Boolean(
        get().flowTextEdit?.composing ||
        get().v9ContentEdit ||
        get().spatialContentEdit ||
        get().editingTextNodeId,
      ),
    }),
    kernel,
    slide: {
      read: () => {
        const current = get()
        return {
          slideBackend: current.slideBackend,
          slideCandidateSnapshot: current.slideCandidateSnapshot,
          v9ContentEdit: current.v9ContentEdit,
        }
      },
      persist: persistCandidateResult,
      applyBackend: applyV9Backend,
      patch: (patch) => set(patch),
      ...slideAuthoringSlice,
    },
    flow: {
      read: () => {
        const current = get()
        return {
          flowSession: current.flowSession,
          flowTextEdit: current.flowTextEdit,
        }
      },
      persist: persistFlowResult,
      applyBackend: applyFlowBackend,
      patch: (patch) => set(patch),
      ...flowAuthoringSlice,
    },
    spatial: {
      read: () => {
        const current = get()
        return {
          spatialSession: current.spatialSession,
          spatialContentEdit: current.spatialContentEdit,
          spatialGraphSelection: current.spatialGraphSelection,
          courseAuthoringSession: current.courseAuthoringSession,
        }
      },
      persist: persistSpatialResult,
      applyBackend: applySpatialBackend,
      runAuthoringIntent: spatialAuthoringSlice.runSpatialAuthoringIntent,
      patch: (patch) => set(patch),
      ...spatialAuthoringSlice,
    },
    shell: {
      read: () => {
        const current = get()
        return {
          editorMode: current.editorMode,
          activeTab: current.activeTab,
          canvasMode: current.canvasMode,
          statusMessage: current.statusMessage,
          errorMessage: current.errorMessage,
          editingTextNodeId: current.editingTextNodeId,
        }
      },
      patch: (patch) => set(patch),
    },
    lifecycle: {
      read: () => {
        const current = get()
        return { projectPath: current.projectPath, dirty: current.dirty }
      },
      patch: (patch) => set(patch),
    },
    readResources: () => readCourseResourceState(get()),
    readActiveLocationId: () => selectActiveCourseLocationId(get()),
    hasDirtyContentDraft: () => selectHasDirtyCourseContentDraft(get()),
    readProjection: () => buildCandidateEffectiveLayers(get()),
    persistLayer: {
      slide: (result, extra) => slideAuthoringSlice.persistLayerCommand(result, extra),
      spatial: persistSpatialLayerCommand,
      flow: persistFlowLayerCommand,
    },
  })

  return {
    activeSceneId: initialSnapshot.sceneId,
    activePresentationStateId: null,
    editingScope: 'scene',
    canvasMode: 'edit',
    selectedNodeId: null,
    selectedNodeIds: [],
    projectPath: null,
    dirty: false,
    get assetFiles() {
      return selectMediaAssetFiles(get())
    },
    componentPackages: {},
    editorMode: loadEditorMode(),
    activeTab: 'elements',
    editingTextNodeId: null,
    statusMessage: '已创建新课件',
    errorMessage: null,
    slideBackend: initialBackend,
    slideCandidateSnapshot: initialSnapshot,
    slideCandidateClipboard: null,
    v9ContentEdit: null,
    courseAssetSidecar: initialSidecar,
    courseAssetSidecarPast: [],
    courseAssetSidecarFuture: [],
    courseComponentPackagesPast: [],
    courseComponentPackagesFuture: [],
    spatialSession: null,
    spatialClipboard: null,
    spatialContentEdit: null,
    spatialGraphSelection: null,
    spatialPlaybackPathId: null,
    flowSession: null,
    flowTextEdit: null,
    courseAuthoringSession: buildCourseAuthoringSessionForProject(
      initialCourse,
      initialSnapshot.locationId,
      initialSnapshot.selection.selectionIds,
    ),
    ...slideAuthoringSlice,
    ...flowAuthoringSlice,
    ...spatialAuthoringSlice,
    ...courseLifecycleSlice,
    ...editorShellSlice,
    ...runtimeAuthoringActions,
    ...mediaAuthoringActions,
    ...componentAuthoringActions,
    ...interactionAuthoringActions,
    ...crossSurfaceCommands,

  }
})

let cachedSlideUiPresent: object | null = null
let cachedSlideUiEdit: V9SlideContentEditSession | null | undefined
let cachedSlideUiSceneId = ''
let cachedSlideUiStateId: string | null = null
let cachedSlideUiScope: string | null = null
let cachedSlideUiLocationId = ''
let cachedSlideUi: SlideCandidateUiProjection | null = null

let cachedSpatialPresent: object | null = null
let cachedSpatialEdit: SpatialWorldContentEditSession | null | undefined
let cachedSpatialScope: string | null = null
let cachedSpatialLocationId = ''
let cachedSpatialNodes: EditorCanvasNode[] = []

let cachedFlowPresent: object | null = null
let cachedFlowLocationId = ''
let cachedFlowScope: string | null = null
let cachedFlowOverlayKey = ''
let cachedFlowNodes: EditorCanvasNode[] = []

function slideAuthoringUiFromState(state: EditorState): SlideCandidateUiProjection | null {
  const backend = isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null
  if (!backend) {
    cachedSlideUi = null
    return null
  }
  const present = backend.getSession().history.present
  const snapshot = state.slideCandidateSnapshot ?? backend.getSnapshot()
  if (
    cachedSlideUi &&
    cachedSlideUiPresent === present &&
    cachedSlideUiEdit === state.v9ContentEdit &&
    cachedSlideUiSceneId === snapshot.sceneId &&
    cachedSlideUiStateId === snapshot.stateId &&
    cachedSlideUiScope === snapshot.scope &&
    cachedSlideUiLocationId === snapshot.locationId
  ) {
    return cachedSlideUi
  }
  const document = backend.getSession().history.present
  const scenes = attachProjectedRuntimes(document, projectV9SlideScenes(backend)).scenes
  const snapshotSceneId = snapshot.sceneId
  const activeScene = scenes.find((scene) => scene.id === snapshotSceneId) ?? scenes[0]
  const namedStateActive = snapshot.stateId !== null
  cachedSlideUi = !activeScene
    ? {
        scenes,
        activeScene: {
          id: snapshotSceneId,
          name: '场景',
          backgroundColor: '#ffffff',
          nodes: [],
          interactions: [],
        },
        nodes: [],
      }
    : {
        scenes,
        activeScene: {
          ...activeScene,
          nodes: namedStateActive
            ? activeScene.nodes
            : applyV9SlideContentDraft(activeScene.nodes, state.v9ContentEdit),
        },
        nodes: applyV9SlideContentDraft(projectV9EditingNodes(backend), state.v9ContentEdit),
      }
  cachedSlideUiPresent = present
  cachedSlideUiEdit = state.v9ContentEdit
  cachedSlideUiSceneId = snapshot.sceneId
  cachedSlideUiStateId = snapshot.stateId
  cachedSlideUiScope = snapshot.scope
  cachedSlideUiLocationId = snapshot.locationId
  return cachedSlideUi
}

function spatialEditingNodesFromState(state: EditorState): EditorCanvasNode[] | null {
  const session = state.spatialSession
  if (!session) return null
  if (
    cachedSpatialPresent === session.history.present &&
    cachedSpatialEdit === state.spatialContentEdit &&
    cachedSpatialScope === session.scope &&
    cachedSpatialLocationId === session.selection.locationId
  ) {
    return cachedSpatialNodes
  }
  cachedSpatialPresent = session.history.present
  cachedSpatialEdit = state.spatialContentEdit
  cachedSpatialScope = session.scope
  cachedSpatialLocationId = session.selection.locationId
  cachedSpatialNodes = spatialEditingNodes(session, state.spatialContentEdit)
  return cachedSpatialNodes
}

function flowEditingNodesFromState(state: EditorState): EditorCanvasNode[] | null {
  const session = state.flowSession
  if (!session) return null
  const overlayKey = session.selection.selectedOverlayIds.join('\0')
  if (
    cachedFlowPresent === session.history.present &&
    cachedFlowLocationId === session.selection.locationId &&
    cachedFlowScope === session.selection.authoringScope &&
    cachedFlowOverlayKey === overlayKey
  ) {
    return cachedFlowNodes
  }
  cachedFlowPresent = session.history.present
  cachedFlowLocationId = session.selection.locationId
  cachedFlowScope = session.selection.authoringScope
  cachedFlowOverlayKey = overlayKey
  cachedFlowNodes = flowEditingNodes(session)
  return cachedFlowNodes
}

let cachedSyntheticSceneKind: 'spatial' | 'flow' | null = null
let cachedSyntheticScenePresent: object | null = null
let cachedSyntheticSceneLocationId = ''
let cachedSyntheticSceneNodes: EditorCanvasNode[] | null = null
let cachedSyntheticScene: EditorCanvasSceneView | null = null

function syntheticActiveScene(
  kind: 'spatial' | 'flow',
  present: object,
  locationId: string,
  nodes: EditorCanvasNode[],
  name: string,
): EditorCanvasSceneView {
  if (
    cachedSyntheticScene
    && cachedSyntheticSceneKind === kind
    && cachedSyntheticScenePresent === present
    && cachedSyntheticSceneLocationId === locationId
    && cachedSyntheticSceneNodes === nodes
  ) {
    return cachedSyntheticScene
  }
  cachedSyntheticSceneKind = kind
  cachedSyntheticScenePresent = present
  cachedSyntheticSceneLocationId = locationId
  cachedSyntheticSceneNodes = nodes
  cachedSyntheticScene = {
    id: locationId,
    name,
    backgroundColor: '#ffffff',
    nodes,
    interactions: [],
  }
  return cachedSyntheticScene
}

export const selectActiveScene = (state: EditorState) => {
  const slideUi = slideAuthoringUiFromState(state)
  if (slideUi) return slideUi.activeScene
  const spatialNodes = spatialEditingNodesFromState(state)
  if (spatialNodes && state.spatialSession) {
    return syntheticActiveScene(
      'spatial',
      state.spatialSession.history.present,
      state.spatialSession.selection.locationId,
      spatialNodes,
      '无限画布',
    )
  }
  const flowNodes = flowEditingNodesFromState(state)
  if (flowNodes && state.flowSession) {
    return syntheticActiveScene(
      'flow',
      state.flowSession.history.present,
      state.flowSession.selection.locationId,
      flowNodes,
      '流式讲义',
    )
  }
  throw new Error(SESSIONLESS_COURSE_REASON)
}

const EMPTY_SLIDE_SCENES: EditorCanvasSceneView[] = []

export const selectSlideSceneList = (state: EditorState): EditorCanvasSceneView[] => {
  const slideUi = slideAuthoringUiFromState(state)
  if (slideUi) return slideUi.scenes
  return EMPTY_SLIDE_SCENES
}

export const selectEditingNodes = (state: EditorState) => {
  const slideUi = slideAuthoringUiFromState(state)
  if (slideUi) return slideUi.nodes
  const spatialNodes = spatialEditingNodesFromState(state)
  if (spatialNodes) return spatialNodes
  const flowNodes = flowEditingNodesFromState(state)
  if (flowNodes) return flowNodes
  return editingNodes(state)
}

export const selectSelectedNode = (state: EditorState) =>
  selectEditingNodes(state).find(
    (node) => node.id === state.selectedNodeId,
  ) ?? null

export const selectSelectedNodes = (state: EditorState) => {
  const selected = new Set(state.selectedNodeIds)
  return selectEditingNodes(state).filter((node) => selected.has(node.id))
}

export const selectSlideBackendKind = (state: EditorState): SlideBackendKind =>
  getSlideBackendKind(state.slideBackend)

export const selectSlideAuthoringBackend = (
  state: EditorState,
): SlideAuthoringBackend | null =>
  isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null

export const selectSlideAuthoringSnapshot = (
  state: EditorState,
): SlideAuthoringSnapshot | null =>
  state.slideCandidateSnapshot

export const selectSlideAuthoringDocument = (state: EditorState) =>
  selectSlideAuthoringBackend(state)?.getSession().history.present ?? null

function selectActiveSurfaceHistory(state: EditorState): {
  readonly past: readonly unknown[]
  readonly future: readonly unknown[]
} | null {
  return state.spatialSession?.history
    ?? state.flowSession?.history
    ?? selectSlideAuthoringBackend(state)?.getSession().history
    ?? null
}

/** Toolbar/history UI reads the active Surface owner, never the count-only Store mirror. */
export const selectCanUndoActiveSurface = (state: EditorState): boolean =>
  (selectActiveSurfaceHistory(state)?.past.length ?? 0) > 0

export const selectCanRedoActiveSurface = (state: EditorState): boolean =>
  (selectActiveSurfaceHistory(state)?.future.length ?? 0) > 0

export const selectActiveCourseProjectDocument = (state: EditorState) =>
  state.spatialSession?.history.present
  ?? state.flowSession?.history.present
  ?? selectSlideAuthoringBackend(state)?.getSession().history.present
  ?? null

export const selectActiveCourseLocationId = (state: EditorState): string | null => {
  if (state.spatialSession) return state.spatialSession.selection.locationId
  if (state.flowSession) return state.flowSession.selection.locationId
  if (state.slideCandidateSnapshot) return state.slideCandidateSnapshot.locationId
  return null
}

let cachedProjectionPresent: object | null = null
let cachedProjectionLocationId = ''
let cachedProjectionStateId: string | null = null
let cachedProjectionScope: string | null = null
let cachedProjectionSelectionKey = ''
let cachedProjectionSurface: 'slide' | 'spatial' | 'flow' | null = null
let cachedProjection: EffectiveLayerProjection | null = null

export const selectEffectiveLayerProjection = (
  state: EditorState,
): EffectiveLayerProjection | null => {
  if (state.spatialSession) {
    const session = state.spatialSession
    const selectionKey = session.selection.selectionIds.join('\0')
    if (
      cachedProjection
      && cachedProjectionSurface === 'spatial'
      && cachedProjectionPresent === session.history.present
      && cachedProjectionLocationId === session.selection.locationId
      && cachedProjectionScope === session.scope
      && cachedProjectionSelectionKey === selectionKey
    ) {
      return cachedProjection
    }
    cachedProjectionSurface = 'spatial'
    cachedProjectionPresent = session.history.present
    cachedProjectionLocationId = session.selection.locationId
    cachedProjectionStateId = null
    cachedProjectionScope = session.scope
    cachedProjectionSelectionKey = selectionKey
    cachedProjection = buildCandidateEffectiveLayers(state)
    return cachedProjection
  }
  if (state.flowSession) {
    const session = state.flowSession
    const selectionKey = session.selection.selectedOverlayIds.join('\0')
    if (
      cachedProjection
      && cachedProjectionSurface === 'flow'
      && cachedProjectionPresent === session.history.present
      && cachedProjectionLocationId === session.selection.locationId
      && cachedProjectionScope === session.selection.authoringScope
      && cachedProjectionSelectionKey === selectionKey
    ) {
      return cachedProjection
    }
    cachedProjectionSurface = 'flow'
    cachedProjectionPresent = session.history.present
    cachedProjectionLocationId = session.selection.locationId
    cachedProjectionStateId = null
    cachedProjectionScope = session.selection.authoringScope
    cachedProjectionSelectionKey = selectionKey
    cachedProjection = buildCandidateEffectiveLayers(state)
    return cachedProjection
  }
  const backend = selectSlideAuthoringBackend(state)
  if (!backend) {
    cachedProjection = null
    cachedProjectionPresent = null
    cachedProjectionSurface = null
    return null
  }
  const session = backend.getSession()
  const selectionKey = session.selection.selectionIds.join('\0')
  if (
    cachedProjection
    && cachedProjectionSurface === 'slide'
    && cachedProjectionPresent === session.history.present
    && cachedProjectionLocationId === session.selection.locationId
    && cachedProjectionStateId === session.selection.stateId
    && cachedProjectionScope === session.scope
    && cachedProjectionSelectionKey === selectionKey
  ) {
    return cachedProjection
  }
  cachedProjectionSurface = 'slide'
  cachedProjectionPresent = session.history.present
  cachedProjectionLocationId = session.selection.locationId
  cachedProjectionStateId = session.selection.stateId
  cachedProjectionScope = session.scope
  cachedProjectionSelectionKey = selectionKey
  cachedProjection = buildCandidateEffectiveLayers(state)
  return cachedProjection
}

const EMPTY_CANDIDATE_ASSET_FILES: Record<string, Uint8Array> = Object.freeze({})

const EMPTY_MEDIA_ASSETS: Readonly<Record<string, AssetMeta>> = Object.freeze({})

export const selectMediaAssets = (state: EditorState) =>
  selectActiveCourseProjectDocument(state)?.assets ?? EMPTY_MEDIA_ASSETS

export const selectMediaAssetFiles = (state: EditorState): Record<string, Uint8Array> => {
  if (state.spatialSession || state.flowSession || selectSlideAuthoringBackend(state)) {
    return state.courseAssetSidecar?.files ?? EMPTY_CANDIDATE_ASSET_FILES
  }
  return EMPTY_CANDIDATE_ASSET_FILES
}

export const selectAudioSettings = (state: EditorState) => {
  const document = selectActiveCourseProjectDocument(state)
  if (!document) throw new Error(SESSIONLESS_COURSE_REASON)
  return document.media.audio
}

export const selectCandidateGlobalLayerItems = (state: EditorState) =>
  selectActiveCourseProjectDocument(state)?.globalLayerItems ?? null
