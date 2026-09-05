import { create } from 'zustand'
import type { ComponentPackageData } from '../../shared/componentTypes'
import {
  type InteractionRule,
  type MotionDirection,
  type MotionEffect,
} from '../../shared/interactionTypes'
import type { EmbeddedComponentPackageMeta } from '../../shared/contracts/component-v4'
import type {
  AudioChannel,
  AssetMeta,
  ProjectAudioSettings,
  SoundDefinition,
} from '../../shared/contracts/media-v1'
import type { ProjectDesignTokens } from '../../shared/contracts/design-v1'
import type { ShapeType, TextRun, TextRunStyle } from '../../shared/contracts/native-v1'
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
  persistFlowLayerCommand,
  persistFlowResult as persistFlowResultFromSlice,
  flowPersistSnapshotFrom,
  type FlowAuthoringIntent,
  type FlowAuthoringReceipt,
} from './slices/flowAuthoringSlice'
import {
  applySpatialBackendState,
  createSpatialAuthoringSlice,
  persistSpatialLayerCommand,
  persistSpatialResult as persistSpatialResultFromSlice,
  spatialPersistSnapshotFrom,
  type SpatialAuthoringIntent,
  type SpatialAuthoringReceipt,
} from './slices/spatialAuthoringSlice'
import { createEditorShellSlice } from './slices/editorShellSlice'
import { createCourseStructureSlice } from './slices/courseStructureSlice'
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
  buildCandidateEffectiveLayers,
  projectActiveScene,
  projectEditingNodes,
  projectEffectiveLayerProjection,
  projectSlideSceneList,
} from '../course/editorCanvasProjection'
import {
  createRuntimeAuthoringActions,
} from '../runtime/commitRuntimeAuthoring'
import { createInteractionAuthoringActions } from '../interactions/commitInteractionAuthoring'
import { createComponentAuthoringActions } from '../components/commitComponentPackageAuthoring'
import {
  commitMediaLibraryImportAtTarget,
  createMediaAuthoringActions,
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

import type {
  EditorCanvasDocument,
  EditorCanvasNode,
  EditorCanvasNodePatch,
  EditorCanvasSceneView,
} from '../phaser/editorCanvasNode'


export type SpatialGraphSelection =
  | { readonly kind: 'path'; readonly id: string }
  | { readonly kind: 'relation'; readonly id: string }

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

import type { EditorShellOwnedState } from './slices/editorShellSlice'
import type { SlideOwnedState } from './slices/slideAuthoringSlice'
import type { FlowOwnedState } from './slices/flowAuthoringSlice'
import type { SpatialOwnedState } from './slices/spatialAuthoringSlice'
import type { CourseLifecycleOwnedState } from './slices/courseLifecycleSlice'

export interface EditorRootOwnedState {
  courseAuthoringSession: CourseAuthoringSession | null
  readonly assetFiles: Record<string, Uint8Array>
}

export type EditorOwnedState =
  & EditorRootOwnedState
  & EditorShellOwnedState
  & SlideOwnedState
  & FlowOwnedState
  & SpatialOwnedState
  & CourseLifecycleOwnedState
  & CourseResourceState

type SliceInternalPorts =
  | 'commitDraft'
  | 'commitDraftForPersistence'
  | 'materializeDraft'
  | 'persistLayerCommand'
  | 'deriveFocus'
  | 'executeAction'
  | 'executeGlobalAction'
  | 'commitSlideCandidateTextRunStyle'
  | 'setScope'

export type EditorState =
  & EditorOwnedState
  & ReturnType<typeof createCourseLifecycleSlice>
  & ReturnType<typeof createEditorShellSlice>
  & Omit<ReturnType<typeof createCourseStructureSlice>, 'addCourseContent' | 'addScene' | 'reorderCourseSurfaces' | 'deleteCourseSurface' | 'moveCourseSlideScene'>
  & Omit<ReturnType<typeof createSlideAuthoringSlice>, SliceInternalPorts>
  & Omit<ReturnType<typeof createFlowAuthoringSlice>, SliceInternalPorts>
  & Omit<ReturnType<typeof createSpatialAuthoringSlice>, SliceInternalPorts>
  & ReturnType<typeof createRuntimeAuthoringActions>
  & ReturnType<typeof createMediaAuthoringActions>
  & ReturnType<typeof createComponentAuthoringActions>
  & ReturnType<typeof createInteractionAuthoringActions>
  & ReturnType<typeof createCrossSurfaceCommands>
  & {
      commitSlideCandidateTextRunStyle(input: {
        layerItemId: string
        selectionStart: number
        selectionEnd: number
        patch: TextRunStyle
        source?: TextEditSource
      }): SlideCommandResult | SpatialCommandResult
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
          flowClipboard: current.flowClipboard,
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

  const runtimeAuthoringActions = createRuntimeAuthoringActions({
    read: () => {
      const state = get()
      return {
        document: selectActiveCourseProjectDocument(state),
        sidecar: state.courseAssetSidecar,
        componentPackages: state.componentPackages,
        authoringSession: state.courseAuthoringSession,
        editingScope: selectEditingScope(state),
        activeSceneId: selectActiveSceneId(state),
        projection: buildCandidateEffectiveLayers(state),
        hasSlideSession: Boolean(state.slideBackend),
      }
    },
    setFeedback: (feedback) => set(feedback),
    persistTransaction: (step, statusMessage) => kernel.persistTransaction(step, statusMessage),
    persistSlideCommand: (run, extra) => {
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) {
        return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false }
      }
      return persistCandidateResult(run(backend.getSession()), extra)
    },
    persistProject: (document, options) => {
      kernel.persistDocument(document, options)
    },
  })

  const mediaAuthoringActions = createMediaAuthoringActions({
    read: () => {
      const state = get()
      return {
        document: selectActiveCourseProjectDocument(state),
        sidecar: state.courseAssetSidecar,
        componentPackages: state.componentPackages,
        authoringSession: state.courseAuthoringSession,
        editingScope: selectEditingScope(state),
        activeSceneId: selectActiveSceneId(state),
        projection: buildCandidateEffectiveLayers(state),
        hasSlideSession: Boolean(selectSlideAuthoringBackend(state)),
        hasFlowSession: Boolean(state.flowSession),
        hasSpatialSession: Boolean(state.spatialSession),
      }
    },
    readSlideSession: () => selectSlideAuthoringBackend(get())?.getSession() ?? null,
    readSpatialSession: () => get().spatialSession,
    readFlowSession: () => get().flowSession,
    setFeedback: (feedback) => set(feedback),
    persistTransaction: (step, statusMessage) => kernel.persistTransaction(step, statusMessage),
    persistCandidateResult: (result, extra) => {
      persistCandidateResult(result, extra)
    },
    persistMedia: (result) => slideAuthoringSlice.persistMediaResult(result, get().errorMessage),
    persistSpatial: (result, extra) => {
      persistSpatialResult(result, extra)
    },
    persistFlow: (result, extra) => {
      persistFlowResult(result, extra)
    },
  })
  const componentAuthoringActions = createComponentAuthoringActions({
    readSlideSession: () => selectSlideAuthoringBackend(get())?.getSession() ?? null,
    read: () => {
      const state = get()
      return {
        document: selectActiveCourseProjectDocument(state),
        sidecar: state.courseAssetSidecar,
        componentPackages: state.componentPackages,
        authoringSession: state.courseAuthoringSession,
        editingScope: selectEditingScope(state),
        interactionStateId: selectActivePresentationStateId(state),
        hasSpatialSession: Boolean(state.spatialSession),
        hasFlowSession: Boolean(state.flowSession),
      }
    },
    readSpatialSession: () => get().spatialSession,
    readFlowSession: () => get().flowSession,
    setFeedback: (feedback) => set(feedback),
    setActiveTab: (tab) => {
      const simpleHidden = new Set<string>(['components', 'automation', 'developer'])
      const activeTab = get().editorMode === 'simple' && simpleHidden.has(tab)
        ? 'elements'
        : tab
      set({ activeTab, errorMessage: null })
    },
    persistTransaction: (step, statusMessage) => kernel.persistTransaction(step, statusMessage),
    persistProject: (project, extra) => {
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
      persistCandidateResult({
        ok: true,
        nextSession: {
          ...backend.getSession(),
          history: commitSlideAuthoringHistory(backend.getSession().history, project),
        },
        historyEntry: true,
        selection: backend.getSession().selection,
      }, extra)
    },
    persistSpatial: (result, extra) => {
      persistSpatialResult(result, extra)
    },
    persistFlow: (result, extra) => {
      persistFlowResult(result, extra)
    },
    persistSlideCommand: (run, extra) => {
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) {
        return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false }
      }
      return persistCandidateResult(run(backend.getSession()), extra)
    },
  })
  const interactionAuthoringActions = createInteractionAuthoringActions({
    read: () => {
      const state = get()
      return {
        document: selectActiveCourseProjectDocument(state),
        sidecar: state.courseAssetSidecar,
        componentPackages: state.componentPackages,
        authoringSession: state.courseAuthoringSession,
        editingScope: selectEditingScope(state),
        interactionLocationId:
          state.spatialSession?.selection.locationId
          ?? state.flowSession?.selection.locationId
          ?? state.slideCandidateSnapshot?.locationId
          ?? null,
        interactionStateId: selectActivePresentationStateId(state),
      }
    },
    setFeedback: (feedback) => set(feedback),
    persistTransaction: (step, statusMessage) => kernel.persistTransaction(step, statusMessage),
    persistSlideCommand: (run, extra) => {
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) {
        return { ok: false, reason: 'not-slide-authoring-backend', historyEntry: false }
      }
      return persistCandidateResult(run(backend.getSession()), extra)
    },
    persistProject: (document, options) => {
      kernel.persistDocument(document, options)
    },
  })


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
    persistDocument: (document, options) => {
      const state = get()
      const active = detectActiveSurface({
        spatialLocationId: state.spatialSession?.selection.locationId ?? null,
        flowLocationId: state.flowSession?.selection.locationId ?? null,
        slideLocationId: state.slideCandidateSnapshot?.locationId ?? null,
        editingScope: selectEditingScope(state),
        composing: Boolean(
          state.flowTextEdit?.composing ||
          state.v9ContentEdit ||
          state.spatialContentEdit ||
          state.editingTextNodeId,
        ),
      })
      return dispatchActiveSurface<boolean>(active, {
        slide: () => slideAuthoringSlice.persistDocument(document, options),
        flow: () => flowAuthoringSlice.persistDocument(document, options),
        spatial: () => spatialAuthoringSlice.persistDocument(document, options),
        none: () => false,
      })
    },
    persistTransaction: (step, statusMessage) => {
      const state = get()
      const active = detectActiveSurface({
        spatialLocationId: state.spatialSession?.selection.locationId ?? null,
        flowLocationId: state.flowSession?.selection.locationId ?? null,
        slideLocationId: state.slideCandidateSnapshot?.locationId ?? null,
        editingScope: selectEditingScope(state),
        composing: Boolean(
          state.flowTextEdit?.composing ||
          state.v9ContentEdit ||
          state.spatialContentEdit ||
          state.editingTextNodeId,
        ),
      })
      return dispatchActiveSurface<boolean>(active, {
        slide: () => slideAuthoringSlice.persistTransaction(step, statusMessage),
        flow: () => flowAuthoringSlice.persistTransaction(step, statusMessage),
        spatial: () => spatialAuthoringSlice.persistTransaction(step, statusMessage),
        none: () => false,
      })
    },
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
        flowClipboard: current.flowClipboard,
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
    openPropertiesTab: () => set({ activeTab: 'properties' }),
  })
  const detectSurface = () => detectActiveSurface({
    spatialLocationId: get().spatialSession?.selection.locationId ?? null,
    flowLocationId: get().flowSession?.selection.locationId ?? null,
    slideLocationId: get().slideCandidateSnapshot?.locationId ?? null,
    editingScope: selectEditingScope(get()),
    composing: Boolean(
      get().flowTextEdit?.composing ||
      get().v9ContentEdit ||
      get().spatialContentEdit ||
      get().editingTextNodeId,
    ),
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
    detectSurface,
    slide: slideAuthoringSlice,
    spatial: spatialAuthoringSlice,
    flow: flowAuthoringSlice,
    readResources: () => readCourseResourceState(get()),
    hasDirtyContentDraft: () => selectHasDirtyCourseContentDraft(get()),
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
        slideDrawTool: current.slideDrawTool,
        previewBackgroundColor: current.previewBackgroundColor,
      }
    },
    patch: (patch) => set(patch),
  })
  const courseStructureSlice = createCourseStructureSlice(kernel, {
    readActiveLocationId: () => selectActiveCourseLocationId(get()),
  })
  const crossSurfaceCommands = createCrossSurfaceCommands({
    structure: courseStructureSlice,
    detect: () => detectActiveSurface({
      spatialLocationId: get().spatialSession?.selection.locationId ?? null,
      flowLocationId: get().flowSession?.selection.locationId ?? null,
      slideLocationId: get().slideCandidateSnapshot?.locationId ?? null,
      editingScope: selectEditingScope(get()),
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
          flowClipboard: current.flowClipboard,
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
          slideDrawTool: current.slideDrawTool,
          previewBackgroundColor: current.previewBackgroundColor,
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
      prepareCourseProjectPersistence: () => courseLifecycleSlice.prepareCourseProjectPersistence(),
      captureCourseProjectRecoverySnapshot: () => courseLifecycleSlice.captureCourseProjectRecoverySnapshot(),
      acknowledgeCourseProjectSaved: (path, token) => courseLifecycleSlice.acknowledgeCourseProjectSaved(path, token),
      reopenArchive: (bytes) => courseLifecycleSlice.reopenArchive(bytes),
      exportArchive: () => courseLifecycleSlice.exportArchive(),
    },
    readResources: () => readCourseResourceState(get()),
    readActiveLocationId: () => selectActiveCourseLocationId(get()),
    hasDirtyContentDraft: () => selectHasDirtyCourseContentDraft(get()),
    readProjection: () => buildCandidateEffectiveLayers(get()),
    persistLayer: {
      slide: (result, extra) => slideAuthoringSlice.persistLayerCommand(result, extra),
      spatial: (result, extra) => spatialAuthoringSlice.persistLayerCommand(result, extra),
      flow: (result, extra) => flowAuthoringSlice.persistLayerCommand(result, extra),
    },
  })

  return {
    canvasMode: 'edit',
    projectPath: null,
    dirty: false,
    get assetFiles() {
      return selectMediaAssetFiles(get())
    },
    componentPackages: {},
    editorMode: loadEditorMode(),
    activeTab: 'elements',
    editingTextNodeId: null,
    slideDrawTool: null,
    previewBackgroundColor: null,
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
    flowClipboard: null,
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
    ...courseStructureSlice,
    ...crossSurfaceCommands,

  }
})

let selectedNodeIdsCache: {
  readonly source: readonly string[]
  readonly result: string[]
} | null = null

/** Sessionless 回退：根镜像已删除，无会话时选区恒为空。 */
const EMPTY_ROOT_SELECTED_NODE_IDS: readonly string[] = Object.freeze([])

export const selectSelectedNodeIds = (state: EditorState): string[] => {
  const source: readonly string[] = state.spatialSession
    ? state.spatialSession.selection.selectionIds
    : state.flowSession
      ? state.flowSession.selection.selectedOverlayIds
      : state.slideCandidateSnapshot
        ? state.slideCandidateSnapshot.selection.selectionIds
        : EMPTY_ROOT_SELECTED_NODE_IDS
  if (selectedNodeIdsCache?.source === source) return selectedNodeIdsCache.result
  const result = [...source]
  selectedNodeIdsCache = { source, result }
  return result
}

export const selectSelectedNodeId = (state: EditorState): string | null =>
  selectSelectedNodeIds(state).at(-1) ?? null

export const selectEditingScope = (state: EditorState): EditingScope => {
  if (state.spatialSession) return state.spatialSession.scope === 'global' ? 'global' : 'scene'
  if (state.flowSession) return state.flowSession.selection.authoringScope === 'global' ? 'global' : 'scene'
  if (state.slideCandidateSnapshot) return state.slideCandidateSnapshot.scope === 'global' ? 'global' : 'scene'
  return 'scene'
}

export const selectActivePresentationStateId = (state: EditorState): string | null =>
  state.slideCandidateSnapshot?.selection.stateId ?? null

export const selectActiveSceneId = (state: EditorState): string =>
  state.slideCandidateSnapshot?.sceneId
  ?? state.flowSession?.selection.locationId
  ?? state.spatialSession?.selection.locationId
  ?? ''

export const selectActiveScene = (state: EditorState): EditorCanvasSceneView => projectActiveScene(state)

export const selectSlideSceneList = (state: EditorState): EditorCanvasSceneView[] => projectSlideSceneList(state)

export const selectEditingNodes = (state: EditorState): EditorCanvasNode[] => projectEditingNodes(state)

export const selectSelectedNode = (state: EditorState) => {
  const id = selectSelectedNodeId(state)
  return selectEditingNodes(state).find((node) => node.id === id) ?? null
}

export const selectSelectedNodes = (state: EditorState) => {
  const selected = new Set(selectSelectedNodeIds(state))
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

export const selectEffectiveLayerProjection = (
  state: EditorState,
): EffectiveLayerProjection | null => projectEffectiveLayerProjection(state)

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

/** Pure composition selector for the Slide Workspace connector. */
export const selectSlideWorkspaceSource = (state: EditorState) => {
  const backend = selectSlideAuthoringBackend(state)
  return [
    backend,
    backend?.getSession().history.present ?? null,
    state.slideCandidateSnapshot?.locationId ?? null,
    state.canvasMode,
    selectEditingScope(state),
    selectSelectedNodeIds(state),
    selectSelectedNodeId(state),
    state.v9ContentEdit?.kind === 'text' && state.v9ContentEdit.source === 'canvas'
      ? state.v9ContentEdit.target.layerItemId
      : null,
    selectActivePresentationStateId(state),
    selectMediaAssetFiles(state),
    state.componentPackages,
    state.courseAssetSidecar,
    state.v9ContentEdit,
    state.setCanvasMode,
    state.selectNodes,
    state.selectNode,
    state.beginTextEdit,
    state.commitTextEdit,
    state.cancelTextEdit,
    state.updateTextEditDraft,
    state.setSlideTextEditComposing,
    state.setStatus,
    state.updateNode,
    state.updateNodes,
    state.addTextNode,
    state.addFormulaNode,
    state.addRectangleNode,
    state.addShapeNode,
    state.addTableNode,
    state.addChartNode,
    state.addExternalComponentNode,
    state.captureRuntimeContentTextTarget,
    state.updateRuntimeContentTextAtTarget,
    state.captureRuntimeAssetReplacementTarget,
    state.replaceRuntimeAssetAtTarget,
    state.runSlideCandidateCommand,
    state.applySlideCandidateCommand,
    state.setActiveTab,
    state.slideDrawTool,
    state.setSlideDrawTool,
    state.drawSlideShapeNode,
  ] as const
}

export const selectAudioSettings = (state: EditorState) => {
  const document = selectActiveCourseProjectDocument(state)
  if (!document) throw new Error(SESSIONLESS_COURSE_REASON)
  return document.media.audio
}

export const selectCandidateGlobalLayerItems = (state: EditorState) =>
  selectActiveCourseProjectDocument(state)?.globalLayerItems ?? null
