import {
  applyPatches,
  current,
  enablePatches,
  isDraft,
  produce,
  produceWithPatches,
} from 'immer'
import { nanoid } from 'nanoid'
import { create } from 'zustand'
import type {
  ComponentManifest,
  ComponentPackageData,
} from '../../shared/componentTypes'
import { componentManifestSchema } from '../../shared/componentSchema'
import { componentSupportsScope } from '../../shared/componentCapabilities'
import {
  isNodeMotionAction,
  isVideoInteractionAction,
  type InteractionRule,
  type MotionDirection,
  type MotionEffect,
  type NodeMotionAction,
} from '../../shared/interactionTypes'
import { resolveComponentPresetProps } from '../../shared/componentProps'
import type {
  AudioChannel,
  AssetMeta,
  DeepPartial,
  EmbeddedComponentPackageMeta,
  GlobalLayerItem,
  GlobalLayerVisibility,
  ProjectDocument,
  ProjectDesignTokens,
  ProjectAudioSettings,
  SceneDocument,
  SceneNode,
  SceneNodeOverride,
  ScenePresentationState,
  ShapeType,
  SoundDefinition,
  TextNode,
  TextRun,
  TextRunStyle,
  VideoNode,
} from '../../shared/projectTypes'
import {
  applySceneNodeOverride,
  createDefaultScenePresentation,
  deriveSceneNodeOverride,
  ensureScenePresentation,
  findPresentationState,
  isNodeOverriddenInState,
  materializeScene,
  rewritePresentationNodeIds,
} from '../../shared/presentation'
import type { RuntimeDocument } from '../../shared/runtimeTypes'
import { UserFacingError } from '../../shared/errors'
import {
  analyzeProjectAssetReferences,
  describeProjectAssetReference,
} from '../../shared/assetReferences'
import {
  evaluateComponentPackageDeletion,
} from '../../shared/componentPackageLifecycle'
import { componentContentSha256 } from '../../shared/componentContentIntegrity'
import { rotatedRectangleAabb } from '../../shared/geometry'
import {
  isCourseTeacherControllerLayerItem,
  synchronizeCourseTeacherControllerControls,
  synchronizeTeacherControllerControls,
} from '../../shared/teacherControllerConsistency'
import { constrainTeacherControllerAuthoringFrame } from '../../shared/teacherControllerLayout'
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
  createExternalComponentNode,
  createFormulaNode,
  createImageNode,
  createProject,
  createRectangleNode,
  createShapeNode,
  createScene,
  createTeacherControllerNode,
  createTextNode,
  createVideoNode,
} from '../project/createProject'
import {
  applyHistoryResourceChanges,
  cloneProject,
  emptyHistory,
  pushHistory,
  type AssetFileHistoryChange,
  type ComponentPackageHistoryChange,
  type HistoryEntry,
  type HistoryResourceChanges,
  type HistoryResourceDirection,
  type HistoryState,
} from './history'
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
  planCourseComponentPackageReplacement,
  type CourseComponentPackageReplacementFeedback,
  type CourseComponentPackageReplacementFailureCode,
} from '../components/courseComponentPackageTransactions'
import {
  beginV9SlideContentEdit,
  cancelV9SlideContentEdit,
  commitV9SlideContentEdit,
  commitV9SlideTextRunStyle,
  updateV9SlideContentTextDraft,
  type V9SlideContentEditSession,
  type V9SlideFormulaContentDraft,
  type V9SlideTextContentDraft,
} from '../authoring/v9SlideContentEdit'
import { commitTeacherControllerAuthoringFrame } from '../authoring/v9TeacherControllerAuthoring'
import type { RuntimeTargetEditSession } from '../authoring/runtimeTargetEditSession'
import {
  commandTargetFromRow,
  projectEffectiveLayers,
  scopeTokenForSelectingRow,
  type EffectiveLayerProjection,
  type EffectiveLayerProjectionRow,
} from '../course/effectiveLayerProjection'
import {
  CROSS_OWNER_REORDER_REASON,
  deleteEffectiveLayerItem,
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
  planCourseImageReplacement,
  replaceCourseLayerMedia,
  updateCourseAudioSettings,
  updateCourseSound,
  type CourseImageReplacementFeedback,
  type CourseImageReplacementPlanFailureCode,
  type CourseMediaCommandResult,
  type CourseMediaSession,
} from '../course/v9MediaAudioCommands'
import {
  planCourseMediaLibraryImport,
  type CourseMediaLibraryImportFeedback,
  type CourseMediaLibraryImportPlanFailureCode,
} from '../media/courseMediaLibraryImport'
import {
  captureCourseRuntimeAssetReplacementTarget,
  planCourseRuntimeAssetReplacement,
  type CourseRuntimeAssetReplacementFeedback,
  type CourseRuntimeAssetReplacementFailureCode,
  type CourseRuntimeAssetReplacementTarget,
} from '../runtime/courseRuntimeTransactions'
import {
  planRuntimeSourceUpdate,
  type RuntimeSourceAuthoringFeedback,
  type RuntimeSourceAuthoringPlanFailureCode,
} from '../runtime/runtimeSourceAuthoringCommands'
import {
  captureCourseRuntimeContentTextTarget,
  planRuntimeContentTextUpdate,
  type CourseRuntimeContentTextTarget,
  type RuntimeContentTextAuthoringFeedback,
  type RuntimeContentTextAuthoringPlanFailureCode,
} from '../runtime/runtimeContentTextAuthoringCommands'
import {
  planRuntimePropertyUpdate,
  type CourseRuntimePropertyTarget,
  type CourseRuntimePropertyUpdate,
  type RuntimePropertyAuthoringFeedback,
  type RuntimePropertyAuthoringPlanFailureCode,
} from '../runtime/runtimePropertyAuthoringCommands'
import {
  planRuntimeTemplateCreation,
  type CourseRuntimeTemplateCreationTarget,
  type CourseRuntimeTemplateCreationFeedback,
  type CourseRuntimeTemplateCreationPlanFailureCode,
} from '../runtime/runtimeTemplateAuthoringCommands'
import {
  planApplyInteractionTemplate,
  planUpdateInteractionRule,
  type InteractionAuthoringFeedback,
  type InteractionAuthoringPlanFailureCode,
  type InteractionAuthoringPlanResult,
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
  executeSlideSceneAction,
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
  slideAuthoringLegacyHistoryEntryCount,
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
  flowEditorLegacyHistoryEntryCount,
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
  COURSE_AUTHORING_TARGET_REJECTION_REASONS,
  COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON,
  captureCourseAuthoringTarget,
  createCourseAuthoringSession,
  createSessionToken,
  selectionSnapshotFromSession,
  switchCourseAuthoringLocation,
  updateCourseAuthoringSessionItems,
  updateCourseAuthoringSessionRevision,
  type CourseAuthoringSession,
  type CourseAuthoringSurfaceType,
  type CourseAuthoringTarget,
  type CurrentCourseAuthoringTargetIdentity,
} from '../authoring/courseAuthoringSession'
import { courseProjectDocumentSchema } from '../../shared/courseProjectSchema'
import { findFlowBlockRecursive, flowSurfaceIn } from '../course/flowDocumentModel'
import {
  migrateProjectV8ToCourseProjectV9,
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
  addSpatialSemanticZoomRuleInSession,
  deleteSpatialSemanticZoomRuleInSession,
  updateSpatialSemanticZoomRuleInSession,
} from '../course/spatialSemanticZoom'
import {
  beginSpatialWorldContentEdit,
  commitSpatialWorldContentEdit,
  commitSpatialWorldTextRunStyle,
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
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../project/courseProjectArchive'
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
  courseLayerItemToSceneNode,
  projectV9EditingNodes,
  projectV9SlideScenes,
} from './slideEditorProjection'

enablePatches()

interface SlideCandidateUiProjection {
  scenes: SceneDocument[]
  activeScene: SceneDocument
  nodes: SceneNode[]
}

function withV9ContentDraft(
  edit: V9SlideContentEditSession | null,
  nodes: SceneNode[],
): SceneNode[] {
  if (!edit) return nodes
  return nodes.map((node) => {
    if (node.id !== edit.target.layerItemId) return node
    if (edit.kind === 'text' && node.type === 'text') {
      const draft = edit.draft as V9SlideTextContentDraft
      return {
        ...node,
        text: draft.text,
        runs: structuredClone(draft.runs),
        ...(typeof draft.width === 'number' ? { width: draft.width } : {}),
        ...(typeof draft.height === 'number' ? { height: draft.height } : {}),
      }
    }
    if (edit.kind === 'formula' && node.type === 'formula') {
      const draft = edit.draft as V9SlideFormulaContentDraft
      return {
        ...node,
        ast: structuredClone(draft.ast),
        ...(draft.accessibleText === undefined
          ? {}
          : { accessibleText: draft.accessibleText }),
      }
    }
    return node
  })
}

function isV9SlideTextContentDraft(
  draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft,
): draft is V9SlideTextContentDraft {
  return 'text' in draft && 'runs' in draft
}

function flowLocationBlockId(
  locations: readonly CourseLocation[],
  locationId: string,
): string | undefined {
  const location = locations.find((item) => item.id === locationId)
  return location?.kind === 'flow-block' ? location.blockId : undefined
}

function emptySidecarStacks(): Pick<
  EditorState,
  | 'slideCandidateSidecar'
  | 'slideCandidateSidecarPast'
  | 'slideCandidateSidecarFuture'
  | 'slideCandidateComponentPackagesPast'
  | 'slideCandidateComponentPackagesFuture'
> {
  return {
    slideCandidateSidecar: emptyCourseAssetSidecar(),
    slideCandidateSidecarPast: [],
    slideCandidateSidecarFuture: [],
    slideCandidateComponentPackagesPast: [],
    slideCandidateComponentPackagesFuture: [],
  }
}

interface CourseResourceHistoryContinuation {
  readonly sidecarPast: CourseAssetSidecar[]
  readonly sidecarFuture: CourseAssetSidecar[]
  readonly componentPackagesPast: Record<string, ComponentPackageData>[]
  readonly componentPackagesFuture: Record<string, ComponentPackageData>[]
}

function continuedSidecarStacks(
  continuation?: CourseResourceHistoryContinuation,
): Pick<
  EditorState,
  | 'slideCandidateSidecarPast'
  | 'slideCandidateSidecarFuture'
  | 'slideCandidateComponentPackagesPast'
  | 'slideCandidateComponentPackagesFuture'
> {
  if (!continuation) {
    return {
      slideCandidateSidecarPast: [],
      slideCandidateSidecarFuture: [],
      slideCandidateComponentPackagesPast: [],
      slideCandidateComponentPackagesFuture: [],
    }
  }
  return {
    slideCandidateSidecarPast: continuation.sidecarPast,
    slideCandidateSidecarFuture: continuation.sidecarFuture,
    slideCandidateComponentPackagesPast: continuation.componentPackagesPast,
    slideCandidateComponentPackagesFuture: continuation.componentPackagesFuture,
  }
}

function cloneSidecar(sidecar: CourseAssetSidecar): CourseAssetSidecar {
  return freezeCourseAssetSidecar(sidecar.files)
}

function projectedAssetFiles(sidecar: CourseAssetSidecar | null | undefined): Record<string, Uint8Array> {
  if (!sidecar) return {}
  return Object.fromEntries(
    Object.entries(sidecar.files).map(([assetId, bytes]) => [assetId, bytes.slice()]),
  )
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
  scenes: SceneDocument[],
): { scenes: SceneDocument[]; globalRuntime?: RuntimeDocument } {
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

function findMutableCourseLayerItem(
  draft: CourseProjectDocument,
  layerItemId: string,
): LayerItem | null {
  const global = draft.globalLayerItems.find((entry) => entry.item.layerItemId === layerItemId)
  if (global) return global.item
  for (const surface of draft.surfaces) {
    if (surface.type !== 'slide') continue
    for (const scene of surface.scenes) {
      const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
      if (item) return item
    }
    const shared = surface.surfaceLayerItems.find((entry) => entry.item.layerItemId === layerItemId)
    if (shared) return shared.item
  }
  return null
}

function applySceneNodePatchToLayerItem(
  item: LayerItem,
  patch: DeepPartial<SceneNode>,
  componentPackages: Record<string, ComponentPackageData>,
): void {
  const current = courseLayerItemToSceneNode(item)
  if (!current) return
  const next = normalizeNodeGeometry(
    current,
    patchSceneNode(current, patch),
    patch,
    componentPackages,
  )
  const converted = sceneNodeToCourseLayerItem(next, item.order)
  converted.hitPolicy = item.hitPolicy
  Object.assign(item, converted)
}

function layerItemOverrideToNodeOverride(
  override: LayerItemOverride,
): SceneNodeOverride {
  const next: Record<string, unknown> = {}
  if (override.label !== undefined) next.name = override.label
  if (override.frame?.x !== undefined) next.x = override.frame.x
  if (override.frame?.y !== undefined) next.y = override.frame.y
  if (override.frame?.width !== undefined) next.width = override.frame.width
  if (override.frame?.height !== undefined) next.height = override.frame.height
  if (override.rotation !== undefined) next.rotation = override.rotation
  if (override.opacity !== undefined) next.opacity = override.opacity
  if (override.visible !== undefined) next.visible = override.visible
  if (override.locked !== undefined) next.locked = override.locked
  if (override.playbackInitialVisibility !== undefined) {
    next.playbackInitialVisibility = override.playbackInitialVisibility
  }
  if (override.nativeData) Object.assign(next, structuredClone(override.nativeData))
  if (override.componentProps) next.props = structuredClone(override.componentProps)
  return next as SceneNodeOverride
}

function sceneNodeOverrideToLayerItemOverride(
  override: SceneNodeOverride,
  node: SceneNode,
): LayerItemOverride {
  const source = structuredClone(override) as Record<string, unknown>
  const migrated: LayerItemOverride = {}
  if (typeof source.name === 'string') migrated.label = source.name
  delete source.name

  const frame: LayerItemOverride['frame'] = {}
  ;(['x', 'y', 'width', 'height'] as const).forEach((key) => {
    if (typeof source[key] === 'number') frame[key] = source[key] as never
    delete source[key]
  })
  if (Object.keys(frame).length > 0) migrated.frame = frame

  if (typeof source.visible === 'boolean') migrated.visible = source.visible
  if (typeof source.locked === 'boolean') migrated.locked = source.locked
  if (typeof source.rotation === 'number') migrated.rotation = source.rotation
  if (typeof source.opacity === 'number') migrated.opacity = source.opacity
  if (source.playbackInitialVisibility === 'inherit' || source.playbackInitialVisibility === 'hidden') {
    migrated.playbackInitialVisibility = source.playbackInitialVisibility
  }
  delete source.visible
  delete source.rotation
  delete source.opacity
  delete source.locked
  delete source.playbackInitialVisibility
  delete source.id
  delete source.type
  delete source.component

  if (node.type === 'external-component') {
    if (source.props && typeof source.props === 'object' && !Array.isArray(source.props)) {
      migrated.componentProps = source.props as Record<string, unknown>
    }
    delete source.props
  }
  if (Object.keys(source).length > 0) migrated.nativeData = source
  return migrated
}

function applySceneNodePatchToCourseOverride(
  draft: CourseProjectDocument,
  sceneId: string,
  stateId: string,
  nodeId: string,
  patch: DeepPartial<SceneNode>,
  componentPackages: Record<string, ComponentPackageData>,
): void {
  const scene = findCourseSlideScene(draft, sceneId)
  if (!scene) return
  const baseItem = scene.layerItems.find((item) => item.layerItemId === nodeId)
  if (!baseItem || (baseItem.locked && patch.locked !== false)) return
  const baseNode = courseLayerItemToSceneNode(baseItem)
  if (!baseNode) return
  const presentation = scene.presentation
  const state = presentation?.states.find((candidate) => candidate.id === stateId)
  if (!state) return
  const currentOverride = state.layerItemOverrides[nodeId]
  const currentNode = applySceneNodeOverride(
    baseNode,
    currentOverride ? layerItemOverrideToNodeOverride(currentOverride) : undefined,
  )
  const next = normalizeNodeGeometry(
    currentNode,
    patchSceneNode(currentNode, patch),
    patch,
    componentPackages,
  )
  const nodeOverride = deriveSceneNodeOverride(baseNode, next)
  if (!nodeOverride || Object.keys(nodeOverride).length === 0) {
    delete state.layerItemOverrides[nodeId]
    return
  }
  state.layerItemOverrides[nodeId] = sceneNodeOverrideToLayerItemOverride(nodeOverride, baseNode)
}

function removeCourseComponentPackage(
  draft: CourseProjectDocument,
  packageId: string,
): void {
  for (const [key, meta] of Object.entries(draft.componentPackages)) {
    if (meta.packageId === packageId) delete draft.componentPackages[key]
  }
}

function appendGlobalCourseNode(draft: CourseProjectDocument, node: SceneNode): void {
  const item = sceneNodeToCourseLayerItem(node)
  let preferred = 0
  for (const entry of draft.globalLayerItems) {
    if (entry.item.order >= preferred) preferred = entry.item.order + 1
  }
  item.order = allocateCourseLayerOrder(draft, preferred)
  draft.globalLayerItems.push({
    item,
    visibility: { mode: 'all', locationIds: [] },
  })
  sortScopedLayerList(draft.globalLayerItems)
}

const V9_SPECIALIZED_NODE_PATCH_KEYS = new Set([
  'locked',
  'visible',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'text',
  'style',
  'name',
])

function v9NodePatchNeedsRoundTrip(patch: DeepPartial<SceneNode>): boolean {
  return Object.keys(patch).some((key) => !V9_SPECIALIZED_NODE_PATCH_KEYS.has(key))
}

function v9NodePatchTouchesFrame(patch: DeepPartial<SceneNode>): boolean {
  return patch.x !== undefined ||
    patch.y !== undefined ||
    patch.width !== undefined ||
    patch.height !== undefined ||
    patch.rotation !== undefined
}

function constrainRoundTripTeacherControllerFrame(
  item: LayerItem,
  patch: DeepPartial<SceneNode>,
): void {
  if (!v9NodePatchTouchesFrame(patch) || !isCourseTeacherControllerLayerItem(item)) return
  const frame = constrainTeacherControllerAuthoringFrame(
    item.content.data,
    item.frame,
    item.rotation,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  )
  item.frame = { ...item.frame, ...frame }
}

function locationIdsToSceneIds(
  document: SlideAuthoringSession['history']['present'],
  locationIds: readonly string[],
): string[] {
  return locationIds.flatMap((locationId) => {
    const location = document.locations.find((candidate) => candidate.id === locationId)
    return location?.kind === 'slide-scene' ? [location.sceneId] : []
  })
}

function sceneIdsToLocationIds(
  document: CourseProjectDocument,
  sceneIds: readonly string[],
): string[] {
  const wanted = new Set(sceneIds)
  return document.locations.flatMap((location) => (
    location.kind === 'slide-scene'
      && location.stateId === undefined
      && wanted.has(location.sceneId)
      ? [location.id]
      : []
  ))
}

function locationVisibilityFromScenePatch(
  document: CourseProjectDocument,
  visibility: GlobalLayerVisibility,
): LocationVisibility {
  const remaining = document.locations.filter(
    (location) => location.kind === 'slide-scene' && location.stateId === undefined,
  )
  if (visibility.mode === 'all') return { mode: 'all', locationIds: [] }
  const locationIds = sceneIdsToLocationIds(document, visibility.sceneIds)
  if (locationIds.length > 0) return { mode: visibility.mode, locationIds }
  if (visibility.mode === 'exclude') return { mode: 'all', locationIds: [] }
  const fallback = remaining[0]?.id
  if (!fallback) return { mode: 'all', locationIds: [] }
  return { mode: visibility.mode, locationIds: [fallback] }
}

type V9PreviewState = Pick<
  EditorState,
  'slideBackend' | 'slideCandidateUi' | 'slideCandidateSidecar' | 'v9ContentEdit'
>

export function projectCandidatePreviewDocument(
  state: V9PreviewState,
): { project: ProjectDocument; assetFiles: Record<string, Uint8Array> } | null {
  const backend = isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null
  if (!backend) return null
  const document = backend.getSession().history.present
  const ui = state.slideCandidateUi ?? buildSlideCandidateUi(backend, state.v9ContentEdit)
  const sidecar = state.slideCandidateSidecar ?? emptyCourseAssetSidecar()
  const globalLayer = document.globalLayerItems.flatMap((entry) => {
    const node = courseLayerItemToSceneNode(entry.item)
    if (!node) return []
    return [{
      node,
      layer: 'overlay' as const,
      visibility: {
        mode: entry.visibility.mode,
        sceneIds: locationIdsToSceneIds(document, entry.visibility.locationIds),
      },
    }]
  })
  const runtimes = attachProjectedRuntimes(document, ui.scenes)
  return {
    project: {
      schemaVersion: 8,
      id: document.id,
      title: document.title,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      canvas: { width: 1280, height: 720 },
      scenes: runtimes.scenes,
      assets: structuredClone(document.assets),
      componentPackages: structuredClone(document.componentPackages),
      globalLayer,
      globalInteractions: structuredClone(document.globalInteractions),
      designTokens: structuredClone(document.designTokens),
      media: structuredClone(document.media),
      playback: structuredClone(document.playback),
      ...(runtimes.globalRuntime ? { globalRuntime: runtimes.globalRuntime } : {}),
    },
    assetFiles: projectedAssetFiles(sidecar),
  }
}

function buildCandidateEffectiveLayers(
  state: Pick<EditorState, 'slideBackend' | 'slideCandidateSnapshot' | 'spatialSession' | 'flowSession'>,
): EffectiveLayerProjection | null {
  if (state.spatialSession) {
    return spatialEffectiveLayers(state.spatialSession)
  }
  if (state.flowSession) {
    return flowEffectiveLayers(state.flowSession)
  }
  const backend = isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null
  if (!backend) return null
  const session = backend.getSession()
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
    selectedIds: session.selection.selectionIds,
    owner: session.scope === 'global' ? 'global' : 'scene',
  })
}

function findCandidateLayerRow(
  state: Pick<EditorState, 'slideBackend' | 'slideCandidateSnapshot' | 'spatialSession' | 'flowSession'>,
  layerItemId: string,
): EffectiveLayerProjectionRow | null {
  return buildCandidateEffectiveLayers(state)?.unifiedRows.find((row) => row.id === layerItemId) ?? null
}

function commandTargetForRow(row: EffectiveLayerProjectionRow) {
  const input = commandTargetFromRow(row)
  return {
    authoringAddress: input.authoringAddress,
    locationId: input.locationId,
    stateId: input.stateId,
  }
}

const SPATIAL_CROSS_OWNER_SELECTION_REASON = 'Spatial 暂不支持跨范围多选，请先取消当前选择。'
const SPATIAL_UNSUPPORTED_PROPERTY_REASON = '当前元素不支持这项 Spatial 属性'
const SPATIAL_INVALID_PROPERTY_VALUE_REASON = 'Spatial 属性值无效'

const SPATIAL_LAYER_PROPERTY_KEYS = new Set([
  'name',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'visible',
  'locked',
  'playbackInitialVisibility',
  'style',
])

const SPATIAL_DIRECT_ROW_PROPERTY_KEYS = new Set(['name', 'visible', 'locked'])

function isSpatialDirectRowPropertyPatch(patch: DeepPartial<SceneNode>): boolean {
  const record = patch as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => record[key] !== undefined)
  return keys.length > 0 && keys.every((key) => SPATIAL_DIRECT_ROW_PROPERTY_KEYS.has(key))
}

function spatialLayerPropertyPatch(
  node: SceneNode | null,
  patch: DeepPartial<SceneNode>,
): { readonly ok: true; readonly patch: EffectiveLayerPropertyPatch } |
  { readonly ok: false; readonly reason: string } {
  const record = patch as Record<string, unknown>
  const unsupported = Object.keys(record).find((key) => !SPATIAL_LAYER_PROPERTY_KEYS.has(key))
  if (unsupported) {
    return { ok: false, reason: `${SPATIAL_UNSUPPORTED_PROPERTY_REASON}：${unsupported}` }
  }
  if (record.style !== undefined && node?.type !== 'text') {
    return { ok: false, reason: `${SPATIAL_UNSUPPORTED_PROPERTY_REASON}：仅文字支持整节点样式` }
  }
  if (
    record.style !== undefined &&
    (record.style === null || typeof record.style !== 'object' || Array.isArray(record.style))
  ) {
    return { ok: false, reason: SPATIAL_INVALID_PROPERTY_VALUE_REASON }
  }
  const frame: NonNullable<EffectiveLayerPropertyPatch['frame']> = {}
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    if (record[key] !== undefined) frame[key] = record[key] as number
  }
  return {
    ok: true,
    patch: {
      ...(record.name !== undefined ? { label: record.name as string } : {}),
      ...(Object.keys(frame).length > 0 ? { frame } : {}),
      ...(record.rotation !== undefined ? { rotation: record.rotation as number } : {}),
      ...(record.opacity !== undefined ? { opacity: record.opacity as number } : {}),
      ...(record.visible !== undefined ? { visible: record.visible as boolean } : {}),
      ...(record.locked !== undefined ? { locked: record.locked as boolean } : {}),
      ...(record.playbackInitialVisibility !== undefined
        ? {
            playbackInitialVisibility: record.playbackInitialVisibility as
              EffectiveLayerPropertyPatch['playbackInitialVisibility'],
          }
        : {}),
      ...(record.style !== undefined
        ? { nativeTextStyle: record.style as EffectiveLayerPropertyPatch['nativeTextStyle'] }
        : {}),
    },
  }
}

function spatialSelectionScopeForRow(
  session: SpatialAuthoringSession,
  row: EffectiveLayerProjectionRow,
): SpatialEditorLayerScope | null {
  try {
    const located = resolveEffectiveLayerTarget(
      session.history.present,
      commandTargetForRow(row),
    )
    return located.source === 'global' || located.source === 'surface' || located.source === 'world'
      ? located.source
      : null
  } catch {
    return null
  }
}

function sessionFromLayerResult(
  session: SlideAuthoringSession,
  result: LayerCommandResult,
): SlideCommandResult {
  if (!result.ok || !result.nextDocument) {
    return {
      ok: false,
      reason: result.reason,
      historyEntry: false,
      nextSession: session,
      selection: session.selection,
    }
  }
  const nextHistory = result.historyEntry
    ? commitSlideAuthoringHistory(session.history, result.nextDocument)
    : {
        present: result.nextDocument,
        past: session.history.past,
        future: session.history.future,
      }
  const createdId = result.createdLayerItemId
  const remainingIds = existingLayerItemIds(result.nextDocument)
  const selectionIds = createdId
    ? [createdId]
    : session.selection.selectionIds.filter((id) => remainingIds.has(id))
  return {
    ok: true,
    reason: result.reason,
    historyEntry: Boolean(result.historyEntry),
    nextSession: {
      sessionId: session.sessionId,
      history: nextHistory,
      selection: {
        locationId: session.selection.locationId,
        stateId: session.selection.stateId,
        selectionIds,
      },
      scope: session.scope,
      generation: session.generation,
    },
    selection: {
      locationId: session.selection.locationId,
      stateId: session.selection.stateId,
      selectionIds,
    },
  }
}

function existingLayerItemIds(project: CourseProjectDocument): Set<string> {
  const ids = new Set<string>()
  project.globalLayerItems.forEach((entry) => ids.add(entry.item.layerItemId))
  for (const surface of project.surfaces) {
    surface.surfaceLayerItems.forEach((entry) => ids.add(entry.item.layerItemId))
    if (surface.type === 'slide') {
      surface.scenes.forEach((scene) => {
        scene.layerItems.forEach((item) => ids.add(item.layerItemId))
      })
    } else if (surface.type === 'spatial-2d') {
      surface.world.layerItems.forEach((item) => ids.add(item.layerItemId))
    }
  }
  return ids
}

function buildSlideCandidateUi(
  backend: SlideAuthoringBackend,
  edit: V9SlideContentEditSession | null,
): SlideCandidateUiProjection {
  const document = backend.getSession().history.present
  const scenes = attachProjectedRuntimes(document, projectV9SlideScenes(backend)).scenes
  const snapshotSceneId = backend.getSnapshot().sceneId
  const activeScene = scenes.find((scene) => scene.id === snapshotSceneId) ?? scenes[0]
  const namedStateActive = backend.getSnapshot().stateId !== null
  if (!activeScene) {
    return { scenes, activeScene: {
      id: snapshotSceneId,
      name: '场景',
      backgroundColor: '#ffffff',
      nodes: [],
      interactions: [],
    }, nodes: [] }
  }
  return {
    scenes,
    activeScene: {
      ...activeScene,
      nodes: namedStateActive
        ? activeScene.nodes
        : withV9ContentDraft(edit, activeScene.nodes),
    },
    nodes: withV9ContentDraft(edit, projectV9EditingNodes(backend)),
  }
}

function candidateViewState(
  backend: SlideAuthoringBackend,
  edit: V9SlideContentEditSession | null,
): Pick<EditorState, 'slideCandidateUi' | 'slideCandidateEffectiveLayers'> {
  return {
    slideCandidateUi: buildSlideCandidateUi(backend, edit),
    slideCandidateEffectiveLayers: buildCandidateEffectiveLayers({
      slideBackend: backend,
      slideCandidateSnapshot: backend.getSnapshot(),
      spatialSession: null,
      flowSession: null,
    }),
  }
}

function emptyCandidateViewState(): Pick<
  EditorState,
  'slideCandidateUi' | 'slideCandidateEffectiveLayers'
> {
  return {
    slideCandidateUi: null,
    slideCandidateEffectiveLayers: null,
  }
}

function v9HistoryToStoreHistory(history: {
  readonly past: readonly unknown[]
  readonly future: readonly unknown[]
}): HistoryState {
  const entry = (): HistoryEntry => ({
    patches: [{ op: 'replace', path: ['revision'], value: 1 }],
    inversePatches: [{ op: 'replace', path: ['revision'], value: 0 }],
  })
  return {
    past: history.past.map(entry),
    future: history.future.map(entry),
  }
}

function findCourseSlideScene(
  project: CourseProjectDocument,
  sceneId: string,
): SlideSceneDocument | null {
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    const scene = surface.scenes.find((item) => item.id === sceneId)
    if (scene) return scene
  }
  return null
}

function derivedV8ProjectFromBackend(
  backend: SlideAuthoringBackend,
  sidecar: CourseAssetSidecar | null,
  edit: V9SlideContentEditSession | null,
): ProjectDocument {
  const view = candidateViewState(backend, edit)
  const preview = projectCandidatePreviewDocument({
    slideBackend: backend,
    slideCandidateUi: view.slideCandidateUi,
    slideCandidateSidecar: sidecar,
    v9ContentEdit: edit,
  })
  if (!preview) {
    throw new Error('V9 会话缺少可投影的课程工程')
  }
  return preview.project
}

export type SpatialGraphSelection =
  | { readonly kind: 'path'; readonly id: string }
  | { readonly kind: 'relation'; readonly id: string }

function spatialSurfaceFromSession(
  session: SpatialAuthoringSession,
): SpatialSurfaceDocument {
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId,
  )
  if (!surface || surface.type !== 'spatial-2d') {
    throw new Error('当前会话没有 Spatial 表面')
  }
  return surface
}

function spatialEditingNodes(
  session: SpatialAuthoringSession,
  edit: SpatialWorldContentEditSession | null,
): SceneNode[] {
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
  })
  const wanted = session.scope === 'global' ? 'viewport' : 'world'
  return view.layers.flatMap((layer): SceneNode[] => {
    if (layer.coordinateSpace !== wanted) return []
    const node = courseLayerItemToSceneNode(layer.item as LayerItem)
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

function derivedV8ProjectFromSpatial(
  session: SpatialAuthoringSession,
  sidecar: CourseAssetSidecar | null,
  edit: SpatialWorldContentEditSession | null,
): ProjectDocument {
  const document = session.history.present
  const view = buildSpatialEditorView({
    project: document,
    locationId: session.selection.locationId,
  })
  const surface = document.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId && candidate.type === 'spatial-2d',
  ) as SpatialSurfaceDocument | undefined
  const nodes = spatialEditingNodes(session, edit)
  const globalLayer = document.globalLayerItems.flatMap((entry) => {
    const node = courseLayerItemToSceneNode(entry.item)
    if (!node) return []
    return [{
      node,
      layer: 'overlay' as const,
      visibility: {
        mode: entry.visibility.mode,
        sceneIds: [],
      },
    }]
  })
  return {
    schemaVersion: 8,
    id: document.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    canvas: { width: 1280, height: 720 },
    scenes: [{
      id: view.camera.activeFrameId,
      name: view.surfaceTitle,
      backgroundColor: resolveCourseSurfaceBackgroundColor(surface?.backgroundColor),
      backgroundAssetId: null,
      nodes: session.scope === 'global' ? [] : nodes,
      presentation: createDefaultScenePresentation(),
      interactions: [],
    }],
    assets: structuredClone(document.assets),
    componentPackages: structuredClone(document.componentPackages),
    globalLayer,
    globalInteractions: structuredClone(document.globalInteractions),
    designTokens: structuredClone(document.designTokens),
    media: structuredClone(document.media),
    playback: structuredClone(document.playback),
    ...(sidecar ? {} : {}),
  }
}

function spatialViewState(
  session: SpatialAuthoringSession,
  sidecar: CourseAssetSidecar | null,
  edit: SpatialWorldContentEditSession | null,
): Pick<EditorState, 'project' | 'slideCandidateUi' | 'slideCandidateEffectiveLayers'> {
  const project = derivedV8ProjectFromSpatial(session, sidecar, edit)
  return {
    project,
    slideCandidateUi: {
      scenes: project.scenes,
      activeScene: project.scenes[0]!,
      nodes: spatialEditingNodes(session, edit),
    },
    slideCandidateEffectiveLayers: spatialEffectiveLayers(session),
  }
}

function spatialEffectiveLayers(
  session: SpatialAuthoringSession,
) {
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: null,
    selectedIds: session.selection.selectionIds,
    owner: session.scope,
  })
}

function spatialHistoryToStoreHistory(
  history: SpatialAuthoringSession['history'],
): HistoryState {
  return v9HistoryToStoreHistory(history)
}

function flowEffectiveLayers(session: FlowAuthoringSession) {
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: null,
    selectedIds: [...session.selection.selectedOverlayIds],
    owner: session.selection.authoringScope === 'global' ? 'global' : 'surface',
  })
}

function flowEditingNodes(session: FlowAuthoringSession): SceneNode[] {
  const projection = flowEffectiveLayers(session)
  const wanted = session.selection.authoringScope === 'global' ? 'global' : null
  return projection.unifiedRows.flatMap((row) => {
    if (wanted && row.owner !== wanted) return []
    const node = courseLayerItemToSceneNode(row.item)
    return node ? [node] : []
  })
}

function derivedV8ProjectFromFlow(
  session: FlowAuthoringSession,
  sidecar: CourseAssetSidecar | null,
): ProjectDocument {
  const document = session.history.present
  const pages = listFlowCourseTreePages(document)
  const currentPage = pages.find((page) => (
    page.startLocationId === session.selection.locationId
    || page.headings.some((heading) => heading.locationId === session.selection.locationId)
  ))
  const nodes = flowEditingNodes(session)
  const globalLayer = document.globalLayerItems.flatMap((entry) => {
    const node = courseLayerItemToSceneNode(entry.item)
    if (!node) return []
    return [{
      node,
      layer: 'overlay' as const,
      visibility: {
        mode: entry.visibility.mode,
        sceneIds: [],
      },
    }]
  })
  return {
    schemaVersion: 8,
    id: document.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    canvas: { width: 1280, height: 720 },
    scenes: [{
      id: session.selection.locationId,
      name: currentPage?.surfaceTitle ?? '流式讲义',
      backgroundColor: '#ffffff',
      backgroundAssetId: null,
      nodes: session.selection.authoringScope === 'global' ? [] : nodes,
      presentation: createDefaultScenePresentation(),
      interactions: [],
    }],
    assets: structuredClone(document.assets),
    componentPackages: structuredClone(document.componentPackages),
    globalLayer,
    globalInteractions: structuredClone(document.globalInteractions),
    designTokens: structuredClone(document.designTokens),
    media: structuredClone(document.media),
    playback: structuredClone(document.playback),
    ...(sidecar ? {} : {}),
  }
}

function flowViewState(
  session: FlowAuthoringSession,
  sidecar: CourseAssetSidecar | null,
): Pick<EditorState, 'project' | 'slideCandidateUi' | 'slideCandidateEffectiveLayers'> {
  const project = derivedV8ProjectFromFlow(session, sidecar)
  const nodes = flowEditingNodes(session)
  return {
    project,
    slideCandidateUi: {
      scenes: project.scenes,
      activeScene: project.scenes[0]!,
      nodes,
    },
    slideCandidateEffectiveLayers: flowEffectiveLayers(session),
  }
}

function documentWithFlowAsset(
  document: CourseProjectDocument,
  asset: AssetMeta,
): CourseProjectDocument {
  if (document.assets[asset.id]) return document
  return {
    ...document,
    assets: {
      ...document.assets,
      [asset.id]: structuredClone(asset),
    },
  }
}

const PROJECT_AUDIO_CHANNELS = [
  'music',
  'narration',
  'sfx',
  'ui',
  'video',
] as const satisfies readonly AudioChannel[]

function clampAudioVolume(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback
}

export type SidebarTab =
  | 'elements'
  | 'components'
  | 'layers'
  | 'properties'
  | 'automation'
  | 'developer'
export type EditorMode = 'simple' | 'professional'
export type EditingScope = 'scene' | 'global'
export type CanvasMode = 'edit' | 'run'
export type AlignmentMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export type TextEditSource = 'canvas' | 'properties'

export interface SimpleEntranceAnimationConfig {
  effect: Exclude<MotionEffect, 'none'>
  direction?: MotionDirection
  durationMs: number
  delayMs: number
}

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

function persistEditorMode(mode: EditorMode): void {
  try {
    globalThis.localStorage?.setItem(EDITOR_MODE_STORAGE_KEY, mode)
  } catch {
    // UI preference persistence is best-effort and never affects project data.
  }
}

interface TextEditSnapshot {
  text: string
  runs: TextRun[]
  width: number
  height: number
}

export interface TextEditSession {
  scope: EditingScope
  sceneId: string
  presentationStateId: string | null
  nodeId: string
  source: TextEditSource
  original: TextEditSnapshot
  dirtyBefore: boolean
}

export interface ProjectAudioSettingsPatch {
  defaultMuted?: boolean
  masterVolume?: number
  channelVolumes?: Partial<Record<AudioChannel, number>>
  narrationDucking?: Partial<ProjectAudioSettings['narrationDucking']>
}

export interface ImportedAssetBatchItem {
  meta: AssetMeta
  bytes: Uint8Array
}

export type ImageReplacementCommitResult =
  | {
      readonly ok: true
      readonly status: 'replaced' | 'unchanged'
      readonly feedback: CourseImageReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseImageReplacementPlanFailureCode
      readonly reason: string
    }

export interface CourseProjectRevisionTarget {
  readonly projectId: string
  readonly documentRevision: number
}

export type MediaLibraryImportCommitResult =
  | {
      readonly ok: true
      readonly status: 'imported' | 'unchanged'
      readonly feedback: CourseMediaLibraryImportFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseMediaLibraryImportPlanFailureCode
      readonly reason: string
    }

export interface ComponentPackageReplacementTarget extends CourseProjectRevisionTarget {
  readonly packageId: string
}

export type ComponentPackageReplacementCommitResult =
  | {
      readonly ok: true
      readonly status: 'replaced' | 'unchanged'
      readonly feedback: CourseComponentPackageReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseComponentPackageReplacementFailureCode
      readonly reason: string
    }

export type RuntimeAssetReplacementCommitResult =
  | {
      readonly ok: true
      readonly status: 'replaced' | 'unchanged'
      readonly feedback: CourseRuntimeAssetReplacementFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseRuntimeAssetReplacementFailureCode
      readonly reason: string
    }

export type RuntimeSourceAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'committed' | 'unchanged'
      readonly feedback: RuntimeSourceAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimeSourceAuthoringPlanFailureCode
      readonly reason: string
    }

export type RuntimeContentTextAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'updated' | 'unchanged'
      readonly feedback: RuntimeContentTextAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimeContentTextAuthoringPlanFailureCode
      readonly reason: string
    }

export type RuntimePropertyAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'updated' | 'unchanged'
      readonly feedback: RuntimePropertyAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: RuntimePropertyAuthoringPlanFailureCode
      readonly reason: string
    }

export type RuntimeTemplateCreationCommitResult =
  | {
      readonly ok: true
      readonly status: 'created'
      readonly feedback: CourseRuntimeTemplateCreationFeedback
    }
  | {
      readonly ok: false
      readonly code: CourseRuntimeTemplateCreationPlanFailureCode
      readonly reason: string
    }

export type InteractionAuthoringCommitResult =
  | {
      readonly ok: true
      readonly status: 'committed' | 'unchanged'
      readonly feedback: InteractionAuthoringFeedback
    }
  | {
      readonly ok: false
      readonly code: InteractionAuthoringPlanFailureCode
      readonly reason: string
    }

export interface EditorState {
  project: ProjectDocument
  activeSceneId: string
  /** `null` edits the canonical base scene. */
  activePresentationStateId: string | null
  editingScope: EditingScope
  canvasMode: CanvasMode
  selectedNodeId: string | null
  selectedNodeIds: string[]
  clipboardNodes: SceneNode[]
  clipboardGlobalItems: GlobalLayerItem[]
  clipboardInteractionRules: InteractionRule[]
  projectPath: string | null
  dirty: boolean
  history: HistoryState
  assetFiles: Record<string, Uint8Array>
  componentPackages: Record<string, ComponentPackageData>
  editorMode: EditorMode
  activeTab: SidebarTab
  editingTextNodeId: string | null
  textEditSession: TextEditSession | null
  statusMessage: string | null
  errorMessage: string | null
  /** Product Slide authoring backend. Null while Flow or Spatial session is active. */
  slideBackend: SlideBackend
  /** Cached after successful candidate commands so Zustand subscribers refresh. */
  slideCandidateSnapshot: SlideAuthoringSnapshot | null
  slideCandidateClipboard: V9SlideClipboardPayload | null
  v9ContentEdit: V9SlideContentEditSession | null
  /** Stable V8-shaped projection so React 19 getSnapshot does not loop. */
  slideCandidateUi: SlideCandidateUiProjection | null
  /** Cached R3-D projection; rebuilt only when the candidate session is persisted. */
  slideCandidateEffectiveLayers: EffectiveLayerProjection | null
  /** Candidate asset bytes. Not V8 `assetFiles`. Undo/redo restores this with session history. */
  slideCandidateSidecar: CourseAssetSidecar | null
  slideCandidateSidecarPast: CourseAssetSidecar[]
  slideCandidateSidecarFuture: CourseAssetSidecar[]
  /** Executable component payloads. Undo/redo restores this with session history. */
  slideCandidateComponentPackagesPast: Record<string, ComponentPackageData>[]
  slideCandidateComponentPackagesFuture: Record<string, ComponentPackageData>[]
  /** Pure Spatial authoring session. Null on the default Slide product path. */
  spatialSession: SpatialAuthoringSession | null
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
    project: ProjectDocument,
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
  markSaved(path: string, project?: ProjectDocument): void
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
    patch: Partial<Pick<SceneDocument, 'name' | 'backgroundColor' | 'backgroundAssetId'>>,
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
    patch: Partial<Pick<ScenePresentationState, 'name' | 'description' | 'backgroundColor' | 'backgroundAssetId'>>,
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
  updatePlayback(patch: Partial<ProjectDocument['playback']>): void
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
  updateNodes(patches: Array<{ nodeId: string; patch: DeepPartial<SceneNode> }>): void
  updateNode(nodeId: string, patch: DeepPartial<SceneNode>): void
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
  applyFlowCommand(
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra?: { statusMessage?: string | null; sidecar?: CourseAssetSidecar },
  ): FlowCommandResult | FlowSharedAuthoringResult
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

function currentScene(state: Pick<EditorState, 'project' | 'activeSceneId'>) {
  return state.project.scenes.find((scene) => scene.id === state.activeSceneId)
}

function normalizeProjectPresentations(project: ProjectDocument): ProjectDocument {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      presentation: structuredClone(ensureScenePresentation(scene)),
    })),
  }
}

function validPresentationStateId(
  scene: SceneDocument,
  requested: string | null,
): string | null {
  if (requested === null) return null
  return ensureScenePresentation(scene).states.some((state) => state.id === requested)
    ? requested
    : ensureScenePresentation(scene).initialStateId
}

function mutablePresentation(scene: SceneDocument) {
  scene.presentation ??= createDefaultScenePresentation()
  return scene.presentation
}

function mutablePresentationState(
  scene: SceneDocument,
  stateId: string,
): ScenePresentationState | undefined {
  return mutablePresentation(scene).states.find((state) => state.id === stateId)
}

function setPresentationNodeOverride(
  scene: SceneDocument,
  stateId: string,
  nodeId: string,
  override: SceneNodeOverride | undefined,
): void {
  const state = mutablePresentationState(scene, stateId)
  if (!state) return
  if (override && Object.keys(override).length > 0) {
    state.nodeOverrides[nodeId] = structuredClone(override)
  } else {
    delete state.nodeOverrides[nodeId]
  }
}

function appendNodesToScene(
  scene: SceneDocument,
  nodes: SceneNode[],
  stateId: string | null,
): void {
  if (stateId === null) {
    scene.nodes.push(...nodes.map((node) => structuredClone(node)))
    return
  }
  for (const effectiveNode of nodes) {
    const baseNode = { ...structuredClone(effectiveNode), visible: false }
    scene.nodes.push(baseNode)
    setPresentationNodeOverride(
      scene,
      stateId,
      baseNode.id,
      deriveSceneNodeOverride(baseNode, effectiveNode),
    )
    const state = mutablePresentationState(scene, stateId)
    if (state?.nodeOrder) state.nodeOrder.push(baseNode.id)
  }
}

function removeBaseNodes(scene: SceneDocument, nodeIds: ReadonlySet<string>): void {
  scene.nodes = scene.nodes.filter((node) => !nodeIds.has(node.id))
  for (const state of mutablePresentation(scene).states) {
    for (const nodeId of nodeIds) delete state.nodeOverrides[nodeId]
    if (state.nodeOrder) {
      const remainingOrder = state.nodeOrder.filter(
        (nodeId) => !nodeIds.has(nodeId),
      )
      state.nodeOrder = remainingOrder.length > 0 ? remainingOrder : undefined
    }
  }
}

let cachedGlobalLayer: ProjectDocument['globalLayer'] | null = null
let cachedGlobalNodes: SceneNode[] = []
let cachedScene: SceneDocument | null = null
let cachedSceneStateId: string | null = null
let cachedSceneNodes: SceneNode[] = []

function editingNodes(
  state: Pick<EditorState, 'project' | 'activeSceneId' | 'activePresentationStateId' | 'editingScope'>,
): SceneNode[] {
  if (state.editingScope !== 'global') {
    const scene = currentScene(state)
    if (!scene) return []
    if (state.activePresentationStateId === null) return scene.nodes
    if (
      cachedScene !== scene ||
      cachedSceneStateId !== state.activePresentationStateId
    ) {
      cachedScene = scene
      cachedSceneStateId = state.activePresentationStateId
      cachedSceneNodes = materializeScene(scene, state.activePresentationStateId).nodes
    }
    return cachedSceneNodes
  }
  if (cachedGlobalLayer !== state.project.globalLayer) {
    cachedGlobalLayer = state.project.globalLayer
    cachedGlobalNodes = state.project.globalLayer.map((item) => item.node)
  }
  return cachedGlobalNodes
}

function normalizedVisibility(
  validSceneIds: Iterable<string>,
  visibility: GlobalLayerVisibility,
): GlobalLayerVisibility {
  const validIds = [...new Set(validSceneIds)]
  if (visibility.mode === 'all') {
    return { mode: 'all', sceneIds: [] }
  }
  const sceneIds = new Set(validIds)
  const selectedIds = [...new Set(visibility.sceneIds)].filter(
    (id) => sceneIds.has(id),
  )
  if (selectedIds.length > 0) {
    return { mode: visibility.mode, sceneIds: selectedIds }
  }
  if (visibility.mode === 'exclude') {
    return { mode: 'all', sceneIds: [] }
  }
  const fallbackSceneId = validIds[0]
  if (!fallbackSceneId) return { mode: 'all', sceneIds: [] }
  return {
    mode: visibility.mode,
    sceneIds: [fallbackSceneId],
  }
}

function textNodeForSession(
  project: ProjectDocument,
  session: TextEditSession,
): TextNode | undefined {
  const scene = project.scenes.find((item) => item.id === session.sceneId)
  const node = session.scope === 'global'
    ? project.globalLayer.find((item) => item.node.id === session.nodeId)?.node
    : scene
      ? materializeScene(scene, session.presentationStateId).nodes
        .find((item) => item.id === session.nodeId)
      : undefined
  return node?.type === 'text' ? node : undefined
}

function sameTextSnapshot(node: TextNode, snapshot: TextEditSnapshot): boolean {
  return (
    node.text === snapshot.text &&
    node.width === snapshot.width &&
    node.height === snapshot.height &&
    JSON.stringify(node.runs) === JSON.stringify(snapshot.runs)
  )
}

function projectWithTextSnapshot(
  project: ProjectDocument,
  session: TextEditSession,
  snapshot: TextEditSnapshot = session.original,
): ProjectDocument {
  const scene = project.scenes.find((item) => item.id === session.sceneId)
  const baseNode = scene?.nodes.find((item) => item.id === session.nodeId)
  const effectiveNode = scene && session.scope !== 'global'
    ? materializeScene(scene, session.presentationStateId).nodes
      .find((item) => item.id === session.nodeId)
    : undefined
  const nextEffective = effectiveNode?.type === 'text'
    ? {
        ...effectiveNode,
        text: snapshot.text,
        runs: structuredClone(snapshot.runs),
        width: snapshot.width,
        height: snapshot.height,
      }
    : undefined
  const stateOverride =
    session.scope !== 'global' &&
    session.presentationStateId !== null &&
    baseNode?.type === 'text' &&
    nextEffective?.type === 'text'
      ? deriveSceneNodeOverride(baseNode, nextEffective)
      : undefined
  return produce(project, (draft) => {
    if (session.scope === 'global') {
      const node = draft.globalLayer.find(
        (item) => item.node.id === session.nodeId,
      )?.node
      if (node?.type !== 'text') return
      node.text = snapshot.text
      node.runs = structuredClone(snapshot.runs)
      node.width = snapshot.width
      node.height = snapshot.height
      return
    }
    const draftScene = draft.scenes.find((item) => item.id === session.sceneId)
    if (!draftScene) return
    if (session.presentationStateId !== null) {
      setPresentationNodeOverride(
        draftScene as SceneDocument,
        session.presentationStateId,
        session.nodeId,
        stateOverride,
      )
      return
    }
    const node = draftScene.nodes.find((item) => item.id === session.nodeId)
    if (node?.type !== 'text') return
    node.text = snapshot.text
    node.runs = structuredClone(snapshot.runs)
    node.width = snapshot.width
    node.height = snapshot.height
  })
}

/**
 * Finalise a live text draft without losing unrelated edits. The history
 * snapshot is based on the current project with only this session's text
 * restored, so one undo step affects exactly one text-edit transaction.
 */
function commitTextEditSessionState(state: EditorState): EditorState {
  const session = state.textEditSession
  if (!session) return state
  const node = textNodeForSession(state.project, session)
  if (!node) {
    return {
      ...state,
      editingTextNodeId: null,
      textEditSession: null,
    }
  }
  const changed = !sameTextSnapshot(node, session.original)
  const restoredProject = changed
    ? projectWithTextSnapshot(state.project, session)
    : state.project
  const finalSnapshot: TextEditSnapshot = {
    text: node.text,
    runs: structuredClone(node.runs),
    width: node.width,
    height: node.height,
  }
  const [, patches, inversePatches] = changed
      ? produceWithPatches(restoredProject, (draft) => {
        const finalProject = projectWithTextSnapshot(
          restoredProject,
          session,
          finalSnapshot,
        )
        if (session.scope === 'global') {
          const source = finalProject.globalLayer.find(
            (item) => item.node.id === session.nodeId,
          )?.node
          const target = draft.globalLayer.find(
            (item) => item.node.id === session.nodeId,
          )?.node
          if (source?.type !== 'text' || target?.type !== 'text') return
          target.text = source.text
          target.runs = structuredClone(source.runs)
          target.width = source.width
          target.height = source.height
          return
        }
        const sourceScene = finalProject.scenes.find(
          (item) => item.id === session.sceneId,
        )
        const targetScene = draft.scenes.find(
          (item) => item.id === session.sceneId,
        )
        if (!sourceScene || !targetScene) return
        if (session.presentationStateId !== null) {
          const sourceOverride = findPresentationState(
            sourceScene,
            session.presentationStateId,
          )?.nodeOverrides[session.nodeId]
          setPresentationNodeOverride(
            targetScene as SceneDocument,
            session.presentationStateId,
            session.nodeId,
            sourceOverride,
          )
          return
        }
        const source = sourceScene.nodes.find((item) => item.id === session.nodeId)
        const target = targetScene.nodes.find((item) => item.id === session.nodeId)
        if (source?.type !== 'text' || target?.type !== 'text') return
        target.text = source.text
        target.runs = structuredClone(source.runs)
        target.width = source.width
        target.height = source.height
      })
    : [state.project, [], []]
  return {
    ...state,
    history: changed
      ? pushHistory(state.history, patches, inversePatches)
      : state.history,
    dirty: changed ? true : session.dirtyBefore,
    editingTextNodeId: null,
    textEditSession: null,
  }
}

function cancelTextEditSessionState(state: EditorState): EditorState {
  const session = state.textEditSession
  if (!session) return state
  return {
    ...state,
    project: textNodeForSession(state.project, session)
      ? projectWithTextSnapshot(state.project, session)
      : state.project,
    dirty: session.dirtyBefore,
    editingTextNodeId: null,
    textEditSession: null,
    statusMessage: '已取消文字编辑',
  }
}

function sameIds(actual: string[], requested: string[]) {
  return (
    actual.length === requested.length &&
    actual.every((id) => requested.includes(id)) &&
    new Set(requested).size === requested.length
  )
}

function rewriteInteractionRuleForSceneCopy(
  rule: InteractionRule,
  nodeIdMap: ReadonlyMap<string, string>,
  sourceSceneId: string,
  targetSceneId: string,
  actionIdMap: ReadonlyMap<string, string>,
): InteractionRule {
  const copy = structuredClone(rule)
  copy.id = `rule_${nanoid()}`
  if ('nodeId' in copy.trigger) {
    copy.trigger.nodeId = nodeIdMap.get(copy.trigger.nodeId) ?? copy.trigger.nodeId
  }
  if (copy.trigger.type === 'animation.completed') {
    copy.trigger.actionId = actionIdMap.get(copy.trigger.actionId) ?? copy.trigger.actionId
  }
  copy.actions = copy.actions.map((step) => {
    const action = step.action
    const id = actionIdMap.get(step.id) ?? `action_${nanoid()}`
    if (action.type === 'scene.go' && action.sceneId === sourceSceneId) {
      return { ...step, id, action: { ...action, sceneId: targetSceneId } }
    }
    if (isVideoInteractionAction(action) || isNodeMotionAction(action)) {
      return {
        ...step,
        id,
        action: {
          ...action,
          nodeId: nodeIdMap.get(action.nodeId) ?? action.nodeId,
        },
      }
    }
    return { ...step, id }
  })
  return copy
}

function rewriteInteractionRuleForNodeCopy(
  rule: InteractionRule,
  nodeIdMap: ReadonlyMap<string, string>,
): InteractionRule {
  const copy = structuredClone(rule)
  copy.id = `rule_${nanoid()}`
  if ('nodeId' in copy.trigger) {
    copy.trigger.nodeId = nodeIdMap.get(copy.trigger.nodeId) ?? copy.trigger.nodeId
  }
  const actionIdMap = new Map(
    copy.actions.map((step) => [step.id, `action_${nanoid()}`]),
  )
  if (copy.trigger.type === 'animation.completed') {
    copy.trigger.actionId = actionIdMap.get(copy.trigger.actionId) ?? copy.trigger.actionId
  }
  copy.actions = copy.actions.map((step) => {
    const action = step.action
    return {
      ...step,
      id: actionIdMap.get(step.id)!,
      action: isVideoInteractionAction(action) || isNodeMotionAction(action)
        ? { ...action, nodeId: nodeIdMap.get(action.nodeId) ?? action.nodeId }
        : action,
    }
  })
  return copy
}

function duplicateInteractionRuleForAuthoring(
  rule: InteractionRule,
): InteractionRule {
  const copy = structuredClone(rule)
  const actionIdMap = new Map(
    copy.actions.map((step) => [step.id, `action_${nanoid()}`]),
  )
  copy.id = `interaction_${nanoid()}`
  copy.name = `${copy.name || '未命名规则'} · 副本`.slice(0, 80)
  if (
    copy.trigger.type === 'animation.completed' &&
    actionIdMap.has(copy.trigger.actionId)
  ) {
    copy.trigger.actionId = actionIdMap.get(copy.trigger.actionId)!
  }
  copy.actions = copy.actions.map((step) => ({
    ...step,
    id: actionIdMap.get(step.id)!,
  }))
  return copy
}

function moveInteractionRuleWithinKind(
  rules: InteractionRule[],
  ruleId: string,
  direction: -1 | 1,
): boolean {
  const index = rules.findIndex((rule) => rule.id === ruleId)
  if (index < 0) return false
  const clickRule = rules[index]!.trigger.type === 'node.click'
  let target = index + direction
  while (
    target >= 0 &&
    target < rules.length &&
    (rules[target]!.trigger.type === 'node.click') !== clickRule
  ) {
    target += direction
  }
  if (target < 0 || target >= rules.length) return false
  const [rule] = rules.splice(index, 1)
  if (!rule) return false
  rules.splice(target, 0, rule)
  return true
}

/**
 * Completion triggers are references, not free-form event names. Structural
 * edits may remove their source motion action, so prune dependants to a fixed
 * point and never leave an unsaveable chain behind.
 */
function withoutDanglingAnimationCompletionRules(
  rules: readonly InteractionRule[],
): InteractionRule[] {
  let retained = [...rules]
  while (true) {
    const motionActionIds = new Set(retained.flatMap((rule) =>
      rule.actions.flatMap((step) => isNodeMotionAction(step.action)
        ? [step.id]
        : []),
    ))
    const next = retained.filter((rule) =>
      rule.trigger.type !== 'animation.completed' ||
      motionActionIds.has(rule.trigger.actionId),
    )
    if (next.length === retained.length) return next
    retained = next
  }
}

function simpleEntranceRuleMatchesState(
  rule: InteractionRule,
  nodeId: string,
  stateId: string | null,
): boolean {
  if (
    !rule.id.startsWith('simple_entrance_') ||
    rule.trigger.type !== 'node.activated' ||
    rule.trigger.nodeId !== nodeId ||
    rule.actions.length !== 1
  ) {
    return false
  }
  const [step] = rule.actions
  if (
    !step ||
    step.start !== 'after-previous' ||
    !isNodeMotionAction(step.action) ||
    step.action.type !== 'node.enter' ||
    step.action.nodeId !== nodeId
  ) {
    return false
  }
  if (rule.conditions.some((condition) => condition.type !== 'presentation.in')) {
    return false
  }
  const presentationConditions = rule.conditions.filter(
    (condition) => condition.type === 'presentation.in',
  )
  if (stateId === null) return presentationConditions.length === 0
  return presentationConditions.length === 1 &&
    presentationConditions[0]!.stateIds.length === 1 &&
    presentationConditions[0]!.stateIds[0] === stateId
}

export function findSimpleEntranceAnimationRule(
  rules: readonly InteractionRule[],
  nodeId: string,
  stateId: string | null,
): InteractionRule | undefined {
  return rules.find((rule) => simpleEntranceRuleMatchesState(
    rule,
    nodeId,
    stateId,
  ))
}

export function hasAdvancedEntranceAnimation(
  rules: readonly InteractionRule[],
  nodeId: string,
  stateId: string | null,
): boolean {
  return rules.some((rule) => (
    rule.actions.some((step) => (
      isNodeMotionAction(step.action) &&
      step.action.type === 'node.enter' &&
      step.action.nodeId === nodeId
    )) &&
    (
      stateId === null ||
      !rule.conditions.some((condition) => condition.type === 'presentation.in') ||
      rule.conditions.some((condition) => (
        condition.type === 'presentation.in' &&
        condition.stateIds.includes(stateId)
      ))
    ) &&
    !simpleEntranceRuleMatchesState(rule, nodeId, stateId)
  ))
}

function entranceRuleAppliesToState(
  rule: InteractionRule,
  nodeId: string,
  stateId: string | null,
): boolean {
  if (!rule.actions.some((step) => (
    isNodeMotionAction(step.action) &&
    step.action.type === 'node.enter' &&
    step.action.nodeId === nodeId
  ))) {
    return false
  }
  const presentationConditions = rule.conditions.filter(
    (condition) => condition.type === 'presentation.in',
  )
  if (stateId === null) return presentationConditions.length === 0
  return presentationConditions.length === 0 ||
    presentationConditions.some((condition) => condition.stateIds.includes(stateId))
}

function simpleEntranceAction(
  nodeId: string,
  config: SimpleEntranceAnimationConfig,
): NodeMotionAction {
  const common = {
    type: 'node.enter' as const,
    nodeId,
    durationMs: Math.min(10_000, Math.max(0, config.durationMs)),
    easing: 'ease-out' as const,
  }
  return config.effect === 'slide'
    ? {
        ...common,
        effect: 'slide',
        direction: config.direction ?? 'left',
      }
    : {
        ...common,
        effect: config.effect,
      }
}

function setSceneNodePlaybackInitialVisibility(
  scene: SceneDocument,
  stateId: string | null,
  nodeId: string,
  playbackInitialVisibility: SceneNode['playbackInitialVisibility'],
): void {
  const baseNode = scene.nodes.find((node) => node.id === nodeId)
  if (!baseNode) return
  if (stateId === null) {
    baseNode.playbackInitialVisibility = playbackInitialVisibility
    return
  }
  const sceneSnapshot = isDraft(scene) ? current(scene) : scene
  const baseNodeSnapshot = sceneSnapshot.nodes.find((node) => node.id === nodeId)
  const effectiveNode = materializeScene(sceneSnapshot, stateId).nodes.find(
    (node) => node.id === nodeId,
  )
  if (!baseNodeSnapshot || !effectiveNode) return
  const nextNode = {
    ...effectiveNode,
    playbackInitialVisibility,
  } as SceneNode
  setPresentationNodeOverride(
    scene,
    stateId,
    nodeId,
    deriveSceneNodeOverride(baseNodeSnapshot, nextNode),
  )
}

function patchSceneNode(node: SceneNode, patch: DeepPartial<SceneNode>): SceneNode {
  const safePatch = { ...patch } as DeepPartial<SceneNode> & {
    id?: unknown
    type?: unknown
  }
  delete safePatch.id
  delete safePatch.type
  const common = { ...node, ...safePatch }
  if (node.type === 'text') {
    const typedPatch = safePatch as DeepPartial<typeof node>
    return {
      ...common,
      type: 'text',
      style: { ...node.style, ...typedPatch.style },
    } as SceneNode
  }
  if (node.type === 'formula') {
    const typedPatch = safePatch as DeepPartial<typeof node>
    return {
      ...common,
      type: 'formula',
      style: { ...node.style, ...typedPatch.style },
    } as SceneNode
  }
  if (node.type === 'shape') {
    const typedPatch = safePatch as DeepPartial<typeof node>
    return {
      ...common,
      type: 'shape',
      style: { ...node.style, ...typedPatch.style },
    } as SceneNode
  }
  if (node.type === 'external-component') {
    const typedPatch = safePatch as DeepPartial<typeof node>
    return {
      ...common,
      type: 'external-component',
      component: { ...node.component, ...typedPatch.component },
      props: { ...node.props, ...typedPatch.props },
    } as SceneNode
  }
  if (node.type === 'image') {
    const typedPatch = safePatch as DeepPartial<typeof node>
    return {
      ...common,
      type: 'image',
      crop: { ...node.crop, ...typedPatch.crop },
      feather: { ...node.feather, ...typedPatch.feather },
    } as SceneNode
  }
  if (node.type === 'video') {
    const typedPatch = safePatch as DeepPartial<typeof node>
    return {
      ...common,
      type: 'video',
      poster: { ...node.poster, ...typedPatch.poster },
    } as SceneNode
  }
  const typedPatch = safePatch as DeepPartial<Extract<SceneNode, { type: 'teacher-controller' }>>
  return {
    ...common,
    type: 'teacher-controller',
    style: { ...node.style, ...typedPatch.style },
    buttons: typedPatch.buttons
      ? typedPatch.buttons.map((button, index) => ({
          ...node.buttons[index],
          ...button,
        })) as typeof node.buttons
      : node.buttons,
  } as SceneNode
}

function hasPatchKey(
  patch: DeepPartial<SceneNode>,
  key: 'width' | 'height',
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

function normalizeNodeGeometry(
  previous: SceneNode,
  next: SceneNode,
  patch: DeepPartial<SceneNode>,
  components: Readonly<Record<string, ComponentPackageData>>,
): SceneNode {
  const changedWidth = hasPatchKey(patch, 'width')
  const changedHeight = hasPatchKey(patch, 'height')
  let minimumWidth = MIN_NODE_SIZE
  let minimumHeight = MIN_NODE_SIZE
  let preserveAspectRatio = false

  if (previous.type === 'image') {
    preserveAspectRatio = previous.preserveAspectRatio
  } else if (previous.type === 'video') {
    preserveAspectRatio = true
  } else if (previous.type === 'external-component') {
    const manifest = components[previous.component.packageId]?.manifest
    preserveAspectRatio = manifest?.preserveAspectRatio ?? true
    minimumWidth = manifest?.minSize.width ?? MIN_NODE_SIZE
    minimumHeight = manifest?.minSize.height ?? MIN_NODE_SIZE
  }

  let width = Math.max(minimumWidth, next.width)
  let height = Math.max(minimumHeight, next.height)
  if (preserveAspectRatio && changedWidth !== changedHeight) {
    const ratio = previous.width / previous.height
    if (changedWidth) {
      height = width / ratio
      if (height < minimumHeight) {
        height = minimumHeight
        width = height * ratio
      }
    } else {
      width = height * ratio
      if (width < minimumWidth) {
        width = minimumWidth
        height = width / ratio
      }
    }
  }

  const x = Math.min(
    CANVAS_WIDTH - MIN_VISIBLE_NODE_EDGE,
    Math.max(-width + MIN_VISIBLE_NODE_EDGE, next.x),
  )
  const y = Math.min(
    CANVAS_HEIGHT - MIN_VISIBLE_NODE_EDGE,
    Math.max(-height + MIN_VISIBLE_NODE_EDGE, next.y),
  )
  return { ...next, x, y, width, height }
}

function normalizeNewNodeGeometry(
  node: SceneNode,
  components: Readonly<Record<string, ComponentPackageData>>,
): SceneNode {
  return normalizeNodeGeometry(
    node,
    node,
    {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    },
    components,
  )
}

const DEFAULT_INSERTION_COLUMNS = 6
const DEFAULT_INSERTION_OFFSET = 20
export const MAX_BATCH_CANVAS_ITEMS = 12

function offsetDefaultInsertion(
  node: SceneNode,
  existingNodeCount: number,
  hasExplicitPosition: boolean,
): SceneNode {
  if (hasExplicitPosition) return node
  const slot = existingNodeCount % (DEFAULT_INSERTION_COLUMNS * 4)
  return {
    ...node,
    x: node.x + (slot % DEFAULT_INSERTION_COLUMNS) * DEFAULT_INSERTION_OFFSET,
    y: node.y + Math.floor(slot / DEFAULT_INSERTION_COLUMNS) * DEFAULT_INSERTION_OFFSET,
  }
}

/**
 * Produces a deterministic, non-overlapping layout for a small import batch.
 * Every returned node is fully inside the fixed Project V8 canvas.
 */
export function layoutMediaBatchNodes(nodes: SceneNode[]): SceneNode[] {
  if (nodes.length <= 1) return nodes
  const margin = 24
  const gap = 20
  const columns = Math.min(
    4,
    Math.max(1, Math.ceil(Math.sqrt(nodes.length * (CANVAS_WIDTH / CANVAS_HEIGHT)))),
  )
  const rows = Math.ceil(nodes.length / columns)
  const availableWidth = CANVAS_WIDTH - margin * 2 - gap * (columns - 1)
  const availableHeight = CANVAS_HEIGHT - margin * 2 - gap * (rows - 1)
  const cellWidth = availableWidth / columns
  const cellHeight = availableHeight / rows

  return nodes.map((node, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const scale = Math.min(1, cellWidth / node.width, cellHeight / node.height)
    const width = Math.max(MIN_NODE_SIZE, node.width * scale)
    const height = Math.max(MIN_NODE_SIZE, node.height * scale)
    return {
      ...node,
      x: margin + column * (cellWidth + gap) + (cellWidth - width) / 2,
      y: margin + row * (cellHeight + gap) + (cellHeight - height) / 2,
      width,
      height,
    }
  })
}

function componentMeta(
  data: ComponentPackageData,
  authoring?: Pick<
    EmbeddedComponentPackageMeta,
    'editableCopy' | 'sourcePackageId'
  >,
): EmbeddedComponentPackageMeta {
  const base = `components/${data.manifest.id}@${data.manifest.version}`
  return {
    packageId: data.manifest.id,
    version: data.manifest.version,
    name: data.manifest.name,
    manifestPath: `${base}/manifest.json`,
    runtimePath: `${base}/${data.manifest.entry}`,
    contentSha256: data.contentSha256 ?? componentContentSha256(data.files),
    thumbnailPath: data.manifest.thumbnail
      ? `${base}/${data.manifest.thumbnail}`
      : undefined,
    ...(data.provenance === undefined ? {} : data.provenance),
    ...(authoring?.editableCopy ? { editableCopy: true } : {}),
    ...(authoring?.sourcePackageId
      ? { sourcePackageId: authoring.sourcePackageId }
      : {}),
  }
}

export function editableComponentPackageId(
  sourceId: string,
  suffix: string,
): string {
  return `${sourceId}.editable.${suffix.toLowerCase().replace(/[^a-z0-9]/g, 'x')}`
}

function rewriteComponentDefinitionId(
  source: string,
  previousId: string,
  nextId: string,
): string {
  const rewritten = source.replaceAll(previousId, nextId)
  if (rewritten === source) {
    throw new UserFacingError(
      '无法创建可编辑副本',
      '组件运行时中没有找到可安全替换的组件 ID。',
      '该组件可能使用了动态 ID；请由组件作者提供允许编辑的源码版本。',
    )
  }
  return rewritten
}

function componentFilesWithAuthoredCode(
  packageData: ComponentPackageData,
  manifest: ComponentManifest,
  runtimeSource: string,
): Record<string, Uint8Array> {
  const files = Object.fromEntries(
    Object.entries(packageData.files).map(([path, bytes]) => [
      path,
      Uint8Array.from(bytes),
    ]),
  )
  const encoder = new TextEncoder()
  files['manifest.json'] = encoder.encode(JSON.stringify(manifest, null, 2))
  files[manifest.entry] = encoder.encode(runtimeSource)
  return files
}

function assertEditableComponentPackage(
  packageId: string,
  packageData: ComponentPackageData | undefined,
  packageMeta: EmbeddedComponentPackageMeta | undefined,
): asserts packageData is ComponentPackageData {
  if (!packageData || packageMeta?.editableCopy !== true) {
    throw new UserFacingError(
      '组件代码不可修改',
      '第三方组件包默认只读。',
      '请先创建工程内可编辑副本，再修改其 Manifest 或 Runtime。',
    )
  }
}

function validateEditableComponentPackage(
  packageData: ComponentPackageData,
  project: ProjectDocument,
  additionalScopes: ReadonlyArray<'scene' | 'global'> = [],
): void {
  const parsed = componentManifestSchema.safeParse(packageData.manifest)
  if (!parsed.success) {
    throw new UserFacingError(
      '组件 Manifest 校验失败',
      parsed.error.issues[0]?.message ?? 'Manifest 无效。',
      '请修正字段后重试，当前工程未发生变化。',
    )
  }
  validateComponentRuntimeSource(packageData.runtimeSource)
  const id = packageData.manifest.id
  if (
    !packageData.runtimeSource.includes(JSON.stringify(id)) &&
    !packageData.runtimeSource.includes(`'${id}'`) &&
    !packageData.runtimeSource.includes(`\`${id}\``)
  ) {
    throw new UserFacingError(
      '组件 Runtime 校验失败',
      `运行时源码没有登记可编辑副本 ID“${id}”。`,
      '请确保 CoursewareComponent.define 的 id 与 Manifest 完全一致。',
    )
  }
  if (
    !new RegExp(
      `["']?runtimeApiVersion["']?\\s*:\\s*${packageData.manifest.runtimeApiVersion}\\b`,
    ).test(packageData.runtimeSource)
  ) {
    throw new UserFacingError(
      '组件 Runtime 校验失败',
      `运行时源码没有静态登记 API ${packageData.manifest.runtimeApiVersion}。`,
      '请确保 CoursewareComponent.define 的 runtimeApiVersion 与 Manifest 完全一致。',
    )
  }

  // Reuse the same archive/path/entry/thumbnail/asset validation as import.
  const reparsed = parseComponentPackageFiles(packageData.files, {
    expectedId: id,
    expectedVersion: packageData.manifest.version,
  })
  if (reparsed.runtimeSource !== packageData.runtimeSource) {
    throw new UserFacingError(
      '组件 Runtime 校验失败',
      '组件入口文件与当前代码框内容不一致。',
      '请重新应用 Runtime 后再修改 Manifest。',
    )
  }

  const requiredScopes = new Set<'scene' | 'global'>(additionalScopes)
  for (const scene of project.scenes) {
    if (
      scene.nodes.some(
        (node) =>
          node.type === 'external-component' &&
          node.component.packageId === id,
      )
    ) {
      requiredScopes.add('scene')
    }
  }
  if (
    project.globalLayer.some(
      (item) =>
        item.node.type === 'external-component' &&
        item.node.component.packageId === id,
    )
  ) {
    requiredScopes.add('global')
  }
  for (const scope of requiredScopes) {
    if (!componentSupportsScope(packageData.manifest, scope)) {
      throw new UserFacingError(
        '组件作用域校验失败',
        `当前组件仍有${scope === 'scene' ? '场景' : '全局'}实例，但 Manifest 已不支持该作用域。`,
        '请保留现有实例所需作用域，或先删除/替换这些实例。',
      )
    }
  }
}

interface ComponentPackageMutation {
  packageId: string
  next?: ComponentPackageData
}

function applyComponentPackageValue(
  packages: Readonly<Record<string, ComponentPackageData>>,
  packageId: string,
  value: ComponentPackageData | undefined,
): Record<string, ComponentPackageData> {
  const nextPackages = { ...packages }
  if (value) nextPackages[packageId] = value
  else delete nextPackages[packageId]
  return nextPackages
}

function applyComponentPackageHistoryChanges(
  packages: Readonly<Record<string, ComponentPackageData>>,
  changes: ComponentPackageHistoryChange[] | undefined,
  direction: 'undo' | 'redo',
): Record<string, ComponentPackageData> {
  if (!changes?.length) return packages as Record<string, ComponentPackageData>
  return changes.reduce(
    (nextPackages, change) => applyComponentPackageValue(
      nextPackages,
      change.packageId,
      direction === 'undo' ? change.before : change.after,
    ),
    packages as Record<string, ComponentPackageData>,
  )
}

function applyAssetFileHistoryChanges(
  files: Readonly<Record<string, Uint8Array>>,
  changes: AssetFileHistoryChange[] | undefined,
  direction: 'undo' | 'redo',
): Record<string, Uint8Array> {
  if (!changes?.length) return files as Record<string, Uint8Array>
  const nextFiles = { ...files }
  for (const change of changes) {
    const value = direction === 'undo' ? change.before : change.after
    if (value === undefined) delete nextFiles[change.assetId]
    else nextFiles[change.assetId] = value.slice()
  }
  return nextFiles
}

function surfaceTypeForLocation(
  project: CourseProjectDocument,
  locationId: string,
): CourseAuthoringSurfaceType {
  const location = project.locations.find((candidate) => candidate.id === locationId)
  if (!location) throw new Error(`找不到课程位置：${locationId}`)
  const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
  if (!surface || (
    surface.type !== 'slide' &&
    surface.type !== 'flow' &&
    surface.type !== 'spatial-2d'
  )) {
    throw new Error(`找不到可编辑表面：${location.surfaceId}`)
  }
  return surface.type
}

function openFlowAuthoringSessionAtLocation(
  project: CourseProjectDocument,
  locationId: string,
): FlowAuthoringSession {
  const parsed = courseProjectDocumentSchema.parse(structuredClone(project))
  const location = parsed.locations.find(
    (candidate) => candidate.id === locationId && candidate.kind === 'flow-block',
  )
  if (!location || location.kind !== 'flow-block') {
    throw new Error(`找不到 Flow 位置：${locationId}`)
  }
  return {
    history: createFlowEditorHistory(parsed),
    selection: selectFlowEditorBlock(parsed, location.id, location.blockId),
  }
}

function buildCourseAuthoringSessionForProject(
  project: CourseProjectDocument,
  locationId: string,
  itemIds: readonly string[] = [],
): CourseAuthoringSession {
  return createCourseAuthoringSession({
    locationId,
    surfaceType: surfaceTypeForLocation(project, locationId),
    revision: project.revision,
    itemIds,
  })
}

function resolveEditorFocus(
  state: EditorState,
  focus?: EditorFocusKind | EventTarget | null,
): EditorFocusKind {
  if (focus === 'text' || focus === 'block' || focus === 'overlay' || focus === 'layer' || focus === 'none') {
    return focus
  }
  if (state.flowSession) {
    if (state.flowTextEdit?.composing || state.flowSession.selection.focus === 'text') return 'text'
    if (state.flowSession.selection.focus === 'block') return 'block'
    if (state.flowSession.selection.selectedOverlayIds.length > 0) return 'overlay'
    return 'none'
  }
  if (state.spatialSession) {
    if (state.spatialContentEdit || state.editingTextNodeId) return 'text'
    if (state.selectedNodeIds.length > 0) return 'layer'
    return 'none'
  }
  if (selectSlideAuthoringBackend(state)) {
    const tagName = focus instanceof HTMLElement ? focus.tagName : undefined
    const isContentEditable = focus instanceof HTMLElement ? focus.isContentEditable : false
    if (shouldIgnoreSlideLayerDeleteForFocus({
      textEditSession: Boolean(state.editingTextNodeId || state.v9ContentEdit?.kind === 'text'),
      formulaEditSession: state.v9ContentEdit?.kind === 'formula',
      tagName,
      isContentEditable,
    })) return 'text'
    if (state.selectedNodeIds.length > 0) return 'layer'
    return 'none'
  }
  if (state.editingTextNodeId) return 'text'
  if (state.selectedNodeIds.length > 0) return 'layer'
  return 'none'
}

function collectLiveEditorItemIds(state: EditorState): readonly string[] {
  if (state.flowSession) {
    if (state.flowSession.selection.selectedOverlayIds.length > 0) {
      return state.flowSession.selection.selectedOverlayIds
    }
    if (state.flowSession.selection.selectedBlockIds.length > 0) {
      return state.flowSession.selection.selectedBlockIds
    }
    return []
  }
  return state.selectedNodeIds
}

export const useEditorStore = create<EditorState>((set, get) => {
  const initialCourse = createBlankCourseProject()
  const initialBackend = createSlideAuthoringBackend(openSlideAuthoringSession(initialCourse))
  const initialSidecar = emptyCourseAssetSidecar()
  const initialSnapshot = initialBackend.getSnapshot()
  const initialProject = derivedV8ProjectFromBackend(initialBackend, initialSidecar, null)

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
    const sidecar = extra.sidecar ?? emptyCourseAssetSidecar()
    const project = derivedV8ProjectFromBackend(backend, sidecar, null)
    const courseProject = backend.getSession().history.present
    set({
      spatialSession: null,
      spatialContentEdit: null,
      spatialGraphSelection: null,
      spatialPlaybackPathId: null,
      flowSession: null,
      flowTextEdit: null,
      slideBackend: backend,
      slideCandidateSnapshot: snapshot,
      slideCandidateClipboard: extra.clearClipboard === false
        ? get().slideCandidateClipboard
        : null,
      v9ContentEdit: null,
      ...candidateViewState(backend, null),
      ...continuedSidecarStacks(extra.resourceHistory),
      slideCandidateSidecar: sidecar,
      project,
      activeSceneId: snapshot.sceneId,
      activePresentationStateId: snapshot.stateId,
      editingScope: snapshot.scope === 'global' ? 'global' : 'scene',
      selectedNodeIds: [...snapshot.selection.selectionIds],
      selectedNodeId: snapshot.selection.selectionIds.at(-1) ?? null,
      editingTextNodeId: null,
      textEditSession: null,
      canvasMode: extra.canvasMode ?? 'edit',
      errorMessage: null,
      history: v9HistoryToStoreHistory(backend.getSession().history),
      dirty: extra.dirty ?? false,
      projectPath: extra.path === undefined ? null : extra.path,
      statusMessage: extra.statusMessage ?? `已打开“${project.title}”`,
      componentPackages: extra.componentPackages ?? {},
      assetFiles: projectedAssetFiles(sidecar),
      clipboardNodes: [],
      clipboardGlobalItems: [],
      clipboardInteractionRules: [],
      courseAuthoringSession: buildCourseAuthoringSessionForProject(
        courseProject,
        snapshot.locationId,
        snapshot.selection.selectionIds,
      ),
    })
  }

  const persistCandidateResult = (
    result: SlideCommandResult,
    extra: {
      clipboard?: V9SlideClipboardPayload | null
      statusMessage?: string | null
      clearContentEdit?: boolean
      sidecar?: CourseAssetSidecar
      sidecarDirection?: 'undo' | 'redo'
      componentPackages?: Record<string, ComponentPackageData>
      transactionStep?: EditorTransactionStep
      courseAuthoringSession?: CourseAuthoringSession
    } = {},
  ): SlideCommandResult => {
    const current = get()
    if (!isSlideAuthoringBackend(current.slideBackend)) return result
    if (!result.ok) {
      if (result.reason) {
        set({ errorMessage: result.reason, statusMessage: null })
      }
      return result
    }
    let nextBackend = result.nextSession
      ? createSlideAuthoringBackend(result.nextSession)
      : current.slideBackend
    const editedLayerItemId = extra.clearContentEdit
      ? current.v9ContentEdit?.target.layerItemId
      : undefined
    if (editedLayerItemId) {
      const liveSnapshot = nextBackend.getSnapshot()
      if (!liveSnapshot.selection.selectionIds.includes(editedLayerItemId)) {
        const restored = nextBackend.selectLayers([editedLayerItemId], false, {
          expectedRevision: liveSnapshot.revision,
        })
        if (restored.ok && restored.nextSession) {
          nextBackend = createSlideAuthoringBackend(restored.nextSession)
        }
      }
    }
    const snapshot = nextBackend.getSnapshot()
    const generation = slideAuthoringGeneration(snapshot.sessionId)
    const keepEdit = extra.clearContentEdit
      ? null
      : current.v9ContentEdit && current.v9ContentEdit.target.generation === generation
        ? current.v9ContentEdit
        : null
    const presentSidecar = current.slideCandidateSidecar ?? emptyCourseAssetSidecar()
    let nextSidecar = extra.sidecar ? cloneSidecar(extra.sidecar) : presentSidecar
    let nextPast = current.slideCandidateSidecarPast
    let nextFuture = current.slideCandidateSidecarFuture
    let nextPackagePast = current.slideCandidateComponentPackagesPast ?? []
    let nextPackageFuture = current.slideCandidateComponentPackagesFuture ?? []
    let nextPackages: Record<string, ComponentPackageData> = {
      ...current.componentPackages,
      ...(extra.componentPackages ?? {}),
    }
    const resourceTransition = result.resourceTransition
    const resourceAware = resourceTransition !== undefined
    if (resourceAware) {
      if (
        extra.transactionStep &&
        extra.transactionStep.resourceChanges !== resourceTransition.resourceChanges
      ) {
        throw new Error('Slide 历史资源增量与编辑事务不一致')
      }
      const resources = extra.transactionStep
        ? applyEditorTransactionStep({
            document: current.slideBackend.getSession().history.present,
            resources: {
              componentPackages: current.componentPackages,
              assetFiles: presentSidecar.files,
            },
          }, extra.transactionStep, resourceTransition.resourceDirection).resources
        : applyHistoryResourceChanges({
            componentPackages: current.componentPackages,
            assetFiles: presentSidecar.files,
          }, resourceTransition.resourceChanges, resourceTransition.resourceDirection)
      nextSidecar = freezeCourseAssetSidecar(resources.assetFiles)
      nextPackages = { ...resources.componentPackages }
      if (result.historyEntry) {
        nextFuture = []
        nextPackageFuture = []
      }
    } else if (extra.sidecarDirection === 'undo') {
      const previous = current.slideCandidateSidecarPast.at(-1)
      if (previous) {
        nextFuture = [presentSidecar, ...current.slideCandidateSidecarFuture]
        nextSidecar = previous
        nextPast = current.slideCandidateSidecarPast.slice(0, -1)
      }
      const previousPackages = (current.slideCandidateComponentPackagesPast ?? []).at(-1)
      if (previousPackages) {
        nextPackageFuture = [current.componentPackages, ...(current.slideCandidateComponentPackagesFuture ?? [])]
        nextPackages = previousPackages
        nextPackagePast = (current.slideCandidateComponentPackagesPast ?? []).slice(0, -1)
      }
    } else if (extra.sidecarDirection === 'redo') {
      const upcoming = current.slideCandidateSidecarFuture[0]
      if (upcoming) {
        nextPast = [...current.slideCandidateSidecarPast, presentSidecar]
        nextSidecar = upcoming
        nextFuture = current.slideCandidateSidecarFuture.slice(1)
      }
      const upcomingPackages = (current.slideCandidateComponentPackagesFuture ?? [])[0]
      if (upcomingPackages) {
        nextPackagePast = [...(current.slideCandidateComponentPackagesPast ?? []), current.componentPackages]
        nextPackages = upcomingPackages
        nextPackageFuture = (current.slideCandidateComponentPackagesFuture ?? []).slice(1)
      }
    } else if (result.historyEntry) {
      nextPast = [...current.slideCandidateSidecarPast, presentSidecar]
      nextFuture = []
      nextSidecar = extra.sidecar ? cloneSidecar(extra.sidecar) : presentSidecar
      nextPackagePast = [...(current.slideCandidateComponentPackagesPast ?? []), current.componentPackages]
      nextPackageFuture = []
      nextPackages = {
        ...current.componentPackages,
        ...(extra.componentPackages ?? {}),
      }
    } else if (extra.sidecar) {
      nextSidecar = cloneSidecar(extra.sidecar)
    }
    const nextHistory = nextBackend.getSession().history
    const legacyPastCount = slideAuthoringLegacyHistoryEntryCount(nextHistory.past)
    const legacyFutureCount = slideAuthoringLegacyHistoryEntryCount(nextHistory.future)
    nextPast = legacyPastCount === 0 ? [] : nextPast.slice(-legacyPastCount)
    nextFuture = nextFuture.slice(0, legacyFutureCount)
    nextPackagePast = legacyPastCount === 0
      ? []
      : nextPackagePast.slice(-legacyPastCount)
    nextPackageFuture = nextPackageFuture.slice(0, legacyFutureCount)
    const presentPackageIds = new Set(
      Object.keys(nextBackend.getSession().history.present.componentPackages),
    )
    const nextComponentPackages = Object.fromEntries(
      Object.entries(nextPackages).filter(([packageId]) => presentPackageIds.has(packageId)),
    )
    const historyDirection = extra.sidecarDirection ?? (
      resourceTransition
        ? resourceTransition.resourceDirection === 'inverse' ? 'undo' : 'redo'
        : undefined
    )
    const nextCourseAuthoringSession = extra.courseAuthoringSession ?? (
      historyDirection && current.courseAuthoringSession
        // Undo/redo can return to an earlier revision number; advance the
        // existing Session lifecycle so pre-history async targets stay stale.
          ? updateCourseAuthoringSessionItems({
            token: createSessionToken({
              locationId: snapshot.locationId,
              surfaceType: 'slide',
              revision: nextBackend.getSession().history.present.revision,
            }, current.courseAuthoringSession.token.generation + 1),
            itemIds: current.courseAuthoringSession.itemIds,
          }, resourceTransition
            ? current.courseAuthoringSession.itemIds
            : snapshot.selection.selectionIds)
        : undefined
    )
    set({
      slideBackend: nextBackend,
      slideCandidateSnapshot: snapshot,
      activeSceneId: snapshot.sceneId,
      activePresentationStateId: snapshot.stateId,
      slideCandidateSidecar: nextSidecar,
      slideCandidateSidecarPast: nextPast,
      slideCandidateSidecarFuture: nextFuture,
      slideCandidateComponentPackagesPast: nextPackagePast,
      slideCandidateComponentPackagesFuture: nextPackageFuture,
      project: derivedV8ProjectFromBackend(nextBackend, nextSidecar, keepEdit),
      history: v9HistoryToStoreHistory(nextBackend.getSession().history),
      dirty: resourceAware || extra.sidecarDirection || result.historyEntry
        ? true
        : current.dirty,
      ...(extra.clipboard !== undefined
        ? { slideCandidateClipboard: extra.clipboard }
        : {}),
      componentPackages: nextComponentPackages,
      selectedNodeIds: [...snapshot.selection.selectionIds],
      selectedNodeId: snapshot.selection.selectionIds.at(-1) ?? null,
      editingScope: snapshot.scope === 'global' ? 'global' : 'scene',
      v9ContentEdit: keepEdit,
      ...candidateViewState(nextBackend, keepEdit),
      ...(extra.clearContentEdit || (current.v9ContentEdit && !keepEdit)
        ? { editingTextNodeId: null }
        : {}),
      errorMessage: null,
      ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
      assetFiles: projectedAssetFiles(nextSidecar),
      ...(nextCourseAuthoringSession
        ? { courseAuthoringSession: nextCourseAuthoringSession }
        : {}),
    })
    return result
  }

  type StoreResourceTransition = {
    readonly resourceChanges: HistoryResourceChanges
    readonly resourceDirection: HistoryResourceDirection
  }

  const applyPersistedResourceTransition = (
    document: CourseProjectDocument,
    sidecar: CourseAssetSidecar,
    componentPackages: Readonly<Record<string, ComponentPackageData>>,
    input: {
      transactionStep?: EditorTransactionStep
      resourceTransition?: StoreResourceTransition
    },
  ) => {
    if (
      input.transactionStep
      && input.resourceTransition
      && input.transactionStep.resourceChanges !== input.resourceTransition.resourceChanges
    ) {
      throw new Error('作者历史资源增量与编辑事务不一致')
    }
    if (input.transactionStep) {
      return applyEditorTransactionStep({
        document,
        resources: {
          componentPackages,
          assetFiles: sidecar.files,
        },
      }, input.transactionStep, 'forward').resources
    }
    if (input.resourceTransition) {
      return applyHistoryResourceChanges({
        componentPackages,
        assetFiles: sidecar.files,
      }, input.resourceTransition.resourceChanges, input.resourceTransition.resourceDirection)
    }
    return null
  }

  const courseSessionAfterSurfaceHistory = (
    current: CourseAuthoringSession | null,
    project: CourseProjectDocument,
    locationId: string,
    input: {
      transactionStep?: EditorTransactionStep
      resourceTransition?: StoreResourceTransition
      sidecarDirection?: 'undo' | 'redo'
    },
  ): CourseAuthoringSession | undefined => {
    if (!current) return undefined
    if (input.transactionStep) {
      return updateCourseAuthoringSessionRevision(current, project.revision)
    }
    if (!input.resourceTransition && !input.sidecarDirection) return undefined
    return updateCourseAuthoringSessionItems({
      token: createSessionToken({
        locationId,
        surfaceType: surfaceTypeForLocation(project, locationId),
        revision: project.revision,
      }, current.token.generation + 1),
      itemIds: current.itemIds,
    }, current.itemIds)
  }

  const persistSpatialResult = (
    result: SpatialCommandResult,
    extra: {
      statusMessage?: string | null
      sidecar?: CourseAssetSidecar
      sidecarDirection?: 'undo' | 'redo'
      componentPackages?: Record<string, ComponentPackageData>
      clearContentEdit?: boolean
      transactionStep?: EditorTransactionStep
      resourceTransition?: StoreResourceTransition
    } = {},
  ): SpatialCommandResult => {
    const current = get()
    const session = result.nextSession ?? current.spatialSession
    if (!session) return result
    if (!result.ok) {
      const rawReason = result.reason ?? 'unknown-spatial-command-failure'
      const normalizedReason = rawReason.trim().toLowerCase()
      let teacherMessage = '操作未完成。请重新选择目标后再试。'
      if (/^[\[{]/.test(normalizedReason) || /"(?:code|path)"\s*:/.test(rawReason)) {
        teacherMessage = '课件内容格式不正确。请检查刚才的输入后重试。'
      } else if (normalizedReason === 'locked' || rawReason.includes('锁定')) {
        teacherMessage = '当前内容已锁定。请先解锁后重试。'
      } else if (normalizedReason === 'stale-revision' || normalizedReason.includes('stale')) {
        teacherMessage = '课件内容已更新。请重新选择后再试。'
      } else if (normalizedReason === 'wrong-owner' || rawReason.includes('不属于')) {
        teacherMessage = '当前内容不在这个编辑范围内。请切换到对应图层后重试。'
      } else if (
        normalizedReason === 'invalid-selection'
        || normalizedReason === 'invalid-target'
        || rawReason.includes('已失效')
        || rawReason.includes('找不到')
      ) {
        teacherMessage = '所选内容已失效。请重新选择后再试。'
      } else if (normalizedReason === 'invalid-color') {
        teacherMessage = '颜色值无效。请重新选择颜色后再试。'
      } else if (rawReason.includes('名称不能为空')) {
        teacherMessage = '名称不能为空。请输入名称后再试。'
      } else if (rawReason.includes('不支持') && rawReason.includes('属性')) {
        teacherMessage = '当前元素不支持这项属性，未保存任何更改。'
      } else if (
        rawReason.includes('属性值无效') ||
        /必须是有效数字|必须大于|必须是文字|超出允许范围|不透明度必须|初始状态无效|范围无效|状态无效|样式无效/.test(rawReason)
      ) {
        teacherMessage = '属性值无效，未保存任何更改。请修正后再试。'
      } else if (/排序|顺序|层级|跨来源/.test(rawReason)) {
        teacherMessage = '图层顺序未更新。请在同一分组内重新排序。'
      }
      set({ errorMessage: teacherMessage, statusMessage: null })
      const diagnosticSession = current.spatialSession ?? session
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
    const keepEdit = extra.clearContentEdit
      ? null
      : current.spatialContentEdit
    if (
      (extra.transactionStep || extra.resourceTransition)
      && (extra.sidecar || extra.sidecarDirection)
    ) {
      throw new Error('Spatial 资源事务不能同时使用完整 sidecar 快照')
    }
    const presentSidecar = current.slideCandidateSidecar ?? emptyCourseAssetSidecar()
    let nextSidecar = extra.sidecar ? cloneSidecar(extra.sidecar) : presentSidecar
    let nextPast = current.slideCandidateSidecarPast
    let nextFuture = current.slideCandidateSidecarFuture
    let nextPackagePast = current.slideCandidateComponentPackagesPast
    let nextPackageFuture = current.slideCandidateComponentPackagesFuture
    let nextPackages = extra.componentPackages ?? current.componentPackages
    const resources = applyPersistedResourceTransition(
      current.spatialSession?.history.present ?? session.history.present,
      presentSidecar,
      current.componentPackages,
      extra,
    )
    const resourceAware = resources !== null
    if (resources) {
      nextSidecar = freezeCourseAssetSidecar(resources.assetFiles)
      nextPackages = { ...resources.componentPackages }
      if (result.historyEntry) {
        nextFuture = []
        nextPackageFuture = []
      }
    } else if (extra.sidecarDirection === 'undo') {
      const previous = current.slideCandidateSidecarPast.at(-1)
      if (previous) {
        nextFuture = [presentSidecar, ...current.slideCandidateSidecarFuture]
        nextSidecar = previous
        nextPast = current.slideCandidateSidecarPast.slice(0, -1)
      }
      const previousPackages = current.slideCandidateComponentPackagesPast.at(-1)
      if (previousPackages) {
        nextPackageFuture = [
          current.componentPackages,
          ...current.slideCandidateComponentPackagesFuture,
        ]
        nextPackages = previousPackages
        nextPackagePast = current.slideCandidateComponentPackagesPast.slice(0, -1)
      }
    } else if (extra.sidecarDirection === 'redo') {
      const upcoming = current.slideCandidateSidecarFuture[0]
      if (upcoming) {
        nextPast = [...current.slideCandidateSidecarPast, presentSidecar]
        nextSidecar = upcoming
        nextFuture = current.slideCandidateSidecarFuture.slice(1)
      }
      const upcomingPackages = current.slideCandidateComponentPackagesFuture[0]
      if (upcomingPackages) {
        nextPackagePast = [
          ...current.slideCandidateComponentPackagesPast,
          current.componentPackages,
        ]
        nextPackages = upcomingPackages
        nextPackageFuture = current.slideCandidateComponentPackagesFuture.slice(1)
      }
    } else if (result.historyEntry) {
      nextPast = [...current.slideCandidateSidecarPast, presentSidecar]
      nextFuture = []
      nextSidecar = extra.sidecar ? cloneSidecar(extra.sidecar) : presentSidecar
      nextPackagePast = [
        ...current.slideCandidateComponentPackagesPast,
        current.componentPackages,
      ]
      nextPackageFuture = []
    } else if (extra.sidecar) {
      nextSidecar = cloneSidecar(extra.sidecar)
    }
    const legacyPastCount = spatialAuthoringLegacyHistoryEntryCount(session.history.past)
    const legacyFutureCount = spatialAuthoringLegacyHistoryEntryCount(session.history.future)
    nextPast = legacyPastCount === nextPast.length
      ? nextPast
      : legacyPastCount === 0
        ? []
        : nextPast.slice(-legacyPastCount)
    nextFuture = legacyFutureCount === nextFuture.length
      ? nextFuture
      : nextFuture.slice(0, legacyFutureCount)
    nextPackagePast = legacyPastCount === nextPackagePast.length
      ? nextPackagePast
      : legacyPastCount === 0
        ? []
        : nextPackagePast.slice(-legacyPastCount)
    nextPackageFuture = legacyFutureCount === nextPackageFuture.length
      ? nextPackageFuture
      : nextPackageFuture.slice(0, legacyFutureCount)
    const presentPackageIds = new Set(Object.keys(session.history.present.componentPackages))
    const nextComponentPackages = resourceAware || extra.componentPackages || extra.sidecarDirection
      ? Object.fromEntries(
          Object.entries(nextPackages).filter(([packageId]) => presentPackageIds.has(packageId)),
        )
      : current.componentPackages
    const snapshot = buildSpatialAuthoringSnapshot(session)
    const graphSelection = current.spatialGraphSelection
    const keep = extra.clearContentEdit ? null : keepEdit
    const nextCourseAuthoringSession = courseSessionAfterSurfaceHistory(
      current.courseAuthoringSession,
      session.history.present,
      session.selection.locationId,
      extra,
    )
    set({
      spatialSession: session,
      spatialContentEdit: extra.clearContentEdit ? null : keepEdit,
      slideCandidateSnapshot: null,
      ...spatialViewState(session, nextSidecar, keep),
      slideCandidateSidecar: nextSidecar,
      slideCandidateSidecarPast: nextPast,
      slideCandidateSidecarFuture: nextFuture,
      slideCandidateComponentPackagesPast: nextPackagePast,
      slideCandidateComponentPackagesFuture: nextPackageFuture,
      history: spatialHistoryToStoreHistory(session.history),
      dirty: resourceAware || extra.sidecarDirection || result.historyEntry ? true : current.dirty,
      selectedNodeIds: [...session.selection.selectionIds],
      selectedNodeId: session.selection.selectionIds.at(-1) ?? null,
      editingScope: session.scope === 'global' ? 'global' : 'scene',
      activeSceneId: snapshot.activeCameraFrameId,
      activePresentationStateId: null,
      componentPackages: nextComponentPackages,
      ...(extra.clearContentEdit ? { editingTextNodeId: null } : {}),
      errorMessage: null,
      ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
      ...(graphSelection && session.selection.selectionIds.length > 0
        ? { spatialGraphSelection: null }
        : {}),
      assetFiles: projectedAssetFiles(nextSidecar),
      ...(nextCourseAuthoringSession
        ? { courseAuthoringSession: nextCourseAuthoringSession }
        : {}),
    })
    return result
  }

  const persistSpatialLayerCommand = (
    result: LayerCommandResult,
    extra?: { statusMessage?: string | null },
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
    return persistSpatialResult(
      succeedSpatialCommand({ ...session, history }, Boolean(result.historyEntry)),
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
    const sidecar = extra.sidecar ?? emptyCourseAssetSidecar()
    const snapshot = buildSpatialAuthoringSnapshot(session)
    set({
      spatialSession: session,
      spatialContentEdit: null,
      spatialGraphSelection: null,
      spatialPlaybackPathId: null,
      flowSession: null,
      flowTextEdit: null,
      slideBackend: null,
      slideCandidateSnapshot: null,
      slideCandidateClipboard: null,
      v9ContentEdit: null,
      ...spatialViewState(session, sidecar, null),
      ...continuedSidecarStacks(extra.resourceHistory),
      slideCandidateSidecar: sidecar,
      activeSceneId: snapshot.activeCameraFrameId,
      activePresentationStateId: null,
      editingScope: session.scope === 'global' ? 'global' : 'scene',
      selectedNodeIds: [...session.selection.selectionIds],
      selectedNodeId: session.selection.selectionIds.at(-1) ?? null,
      editingTextNodeId: null,
      textEditSession: null,
      canvasMode: extra.canvasMode ?? 'edit',
      errorMessage: null,
      history: spatialHistoryToStoreHistory(session.history),
      dirty: extra.dirty ?? false,
      projectPath: extra.path === undefined ? null : extra.path,
      statusMessage: extra.statusMessage ?? `已打开“${session.history.present.title}”`,
      componentPackages: extra.componentPackages ?? {},
      assetFiles: projectedAssetFiles(sidecar),
      clipboardNodes: [],
      clipboardGlobalItems: [],
      clipboardInteractionRules: [],
      courseAuthoringSession: buildCourseAuthoringSessionForProject(
        session.history.present,
        session.selection.locationId,
        session.selection.selectionIds,
      ),
    })
  }

  const persistFlowResult = (
    result: FlowCommandResult | FlowSharedAuthoringResult,
    extra: {
      statusMessage?: string | null
      sidecar?: CourseAssetSidecar
      sidecarDirection?: 'undo' | 'redo'
      componentPackages?: Record<string, ComponentPackageData>
      selection?: FlowEditorSelection | null
      clearTextEdit?: boolean
      replaceHistory?: FlowEditorHistory
      transactionStep?: EditorTransactionStep
      resourceTransition?: StoreResourceTransition
    } = {},
  ): FlowCommandResult | FlowSharedAuthoringResult => {
    const current = get()
    const session = current.flowSession
    if (!session) return result
    if (!result.ok) {
      if (result.reason) {
        set({ errorMessage: result.reason, statusMessage: null })
      }
      return result
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
    const presentSidecar = current.slideCandidateSidecar ?? emptyCourseAssetSidecar()
    let nextSidecar = extra.sidecar ? cloneSidecar(extra.sidecar) : presentSidecar
    let nextPast = current.slideCandidateSidecarPast
    let nextFuture = current.slideCandidateSidecarFuture
    let nextPackagePast = current.slideCandidateComponentPackagesPast
    let nextPackageFuture = current.slideCandidateComponentPackagesFuture
    let nextPackages = extra.componentPackages ?? current.componentPackages
    const resources = applyPersistedResourceTransition(
      session.history.present,
      presentSidecar,
      current.componentPackages,
      extra,
    )
    const resourceAware = resources !== null
    if (resources) {
      nextSidecar = freezeCourseAssetSidecar(resources.assetFiles)
      nextPackages = { ...resources.componentPackages }
      if (result.historyEntry) {
        nextFuture = []
        nextPackageFuture = []
      }
    } else if (extra.sidecarDirection === 'undo') {
      const previous = current.slideCandidateSidecarPast.at(-1)
      if (previous) {
        nextFuture = [presentSidecar, ...current.slideCandidateSidecarFuture]
        nextSidecar = previous
        nextPast = current.slideCandidateSidecarPast.slice(0, -1)
      }
      const previousPackages = current.slideCandidateComponentPackagesPast.at(-1)
      if (previousPackages) {
        nextPackageFuture = [
          current.componentPackages,
          ...current.slideCandidateComponentPackagesFuture,
        ]
        nextPackages = previousPackages
        nextPackagePast = current.slideCandidateComponentPackagesPast.slice(0, -1)
      }
    } else if (extra.sidecarDirection === 'redo') {
      const upcoming = current.slideCandidateSidecarFuture[0]
      if (upcoming) {
        nextPast = [...current.slideCandidateSidecarPast, presentSidecar]
        nextSidecar = upcoming
        nextFuture = current.slideCandidateSidecarFuture.slice(1)
      }
      const upcomingPackages = current.slideCandidateComponentPackagesFuture[0]
      if (upcomingPackages) {
        nextPackagePast = [
          ...current.slideCandidateComponentPackagesPast,
          current.componentPackages,
        ]
        nextPackages = upcomingPackages
        nextPackageFuture = current.slideCandidateComponentPackagesFuture.slice(1)
      }
    } else if (result.historyEntry) {
      nextPast = [...current.slideCandidateSidecarPast, presentSidecar]
      nextFuture = []
      nextSidecar = extra.sidecar ? cloneSidecar(extra.sidecar) : presentSidecar
      nextPackagePast = [
        ...current.slideCandidateComponentPackagesPast,
        current.componentPackages,
      ]
      nextPackageFuture = []
    } else if (extra.sidecar) {
      nextSidecar = cloneSidecar(extra.sidecar)
    }
    const legacyPastCount = flowEditorLegacyHistoryEntryCount(history.past)
    const legacyFutureCount = flowEditorLegacyHistoryEntryCount(history.future)
    nextPast = legacyPastCount === nextPast.length
      ? nextPast
      : legacyPastCount === 0
        ? []
        : nextPast.slice(-legacyPastCount)
    nextFuture = legacyFutureCount === nextFuture.length
      ? nextFuture
      : nextFuture.slice(0, legacyFutureCount)
    nextPackagePast = legacyPastCount === nextPackagePast.length
      ? nextPackagePast
      : legacyPastCount === 0
        ? []
        : nextPackagePast.slice(-legacyPastCount)
    nextPackageFuture = legacyFutureCount === nextPackageFuture.length
      ? nextPackageFuture
      : nextPackageFuture.slice(0, legacyFutureCount)
    const presentPackageIds = new Set(Object.keys(history.present.componentPackages))
    const nextComponentPackages = resourceAware || extra.componentPackages || extra.sidecarDirection
      ? Object.fromEntries(
          Object.entries(nextPackages).filter(([packageId]) => presentPackageIds.has(packageId)),
        )
      : current.componentPackages
    const nextSession: FlowAuthoringSession = { history, selection }
    const nextCourseAuthoringSession = courseSessionAfterSurfaceHistory(
      current.courseAuthoringSession,
      history.present,
      selection.locationId,
      extra,
    )
    set({
      flowSession: nextSession,
      flowTextEdit: extra.clearTextEdit ? null : current.flowTextEdit,
      spatialSession: null,
      slideCandidateSnapshot: null,
      ...flowViewState(nextSession, nextSidecar),
      slideCandidateSidecar: nextSidecar,
      slideCandidateSidecarPast: nextPast,
      slideCandidateSidecarFuture: nextFuture,
      slideCandidateComponentPackagesPast: nextPackagePast,
      slideCandidateComponentPackagesFuture: nextPackageFuture,
      history: v9HistoryToStoreHistory(history),
      dirty: resourceAware || extra.sidecarDirection || result.historyEntry ? true : current.dirty,
      selectedNodeIds: [...selection.selectedOverlayIds],
      selectedNodeId: selection.selectedOverlayIds.at(-1) ?? null,
      editingScope: selection.authoringScope === 'global' ? 'global' : 'scene',
      activeSceneId: selection.locationId,
      activePresentationStateId: null,
      componentPackages: nextComponentPackages,
      errorMessage: null,
      ...(extra.statusMessage !== undefined ? { statusMessage: extra.statusMessage } : {}),
      assetFiles: projectedAssetFiles(nextSidecar),
      ...(nextCourseAuthoringSession
        ? { courseAuthoringSession: nextCourseAuthoringSession }
        : {}),
    })
    return result
  }

  const activeCourseDocument = (state: EditorState): CourseProjectDocument | null => (
    state.spatialSession?.history.present
    ?? state.flowSession?.history.present
    ?? selectSlideAuthoringBackend(state)?.getSession().history.present
    ?? null
  )

  const captureCourseProjectRevisionTarget = (): CourseProjectRevisionTarget | null => {
    const document = activeCourseDocument(get())
    return document
      ? Object.freeze({
          projectId: document.id,
          documentRevision: document.revision,
        })
      : null
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

  const rejectRuntimeSourceAuthoring = (
    code: RuntimeSourceAuthoringPlanFailureCode,
    reason: string,
  ): RuntimeSourceAuthoringCommitResult => {
    set({ errorMessage: reason, statusMessage: null })
    return { ok: false, code, reason }
  }

  const commitRuntimeSourceAtTarget = (
    target: CourseAuthoringTarget,
    source: string,
  ): RuntimeSourceAuthoringCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    if (!document || document.id !== target.projectId) {
      return rejectRuntimeSourceAuthoring(
        'project-mismatch',
        '运行时源码草稿不属于当前 Course Project。',
      )
    }
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    if (!projection || !authoringSession) {
      return rejectRuntimeSourceAuthoring(
        'invalid-target',
        '当前没有可提交运行时源码的课程作者会话。',
      )
    }
    const expectedScope = target.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== target.owner
      || projection.scope.ownerKey !== target.ownerKey
    ) {
      return rejectRuntimeSourceAuthoring(
        'owner-mismatch',
        '当前编辑范围已切换，运行时源码没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )

    const planned = planRuntimeSourceUpdate({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      source,
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimeSourceAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      set({ errorMessage: null, statusMessage: '运行时源码没有变化' })
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimeSourceAuthoring(
        'invalid-document',
        '运行时源码事务缺少结果信息，未写入工程。',
      )
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return rejectRuntimeSourceAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '运行时源码事务无效，未写入工程。',
      )
    }
    if (!step || !persistProjectResourceTransaction(
      step,
      target.owner === 'global'
        ? '已更新全局运行时源码'
        : '已更新当前作用域的运行时源码',
    )) {
      return rejectRuntimeSourceAuthoring(
        'invalid-document',
        '当前没有可提交运行时源码的课程编辑会话。',
      )
    }
    return { ok: true, status: 'committed', feedback }
  }

  const captureRuntimeContentTextTargetForSession = (
    session: Readonly<RuntimeTargetEditSession>,
  ): CourseRuntimeContentTextTarget | null => {
    const state = get()
    const document = activeCourseDocument(state)
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    if (
      !document
      || !projection
      || !authoringSession
      || session.kind !== 'text'
      || session.projectId !== document.id
      || session.scope !== state.editingScope
      || session.sceneId !== state.activeSceneId
      || authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return null
    }

    let expectedOwner: 'global' | 'scene'
    let projectedItemId: string | undefined
    if (session.scope === 'global') {
      if (projection.surfaceType !== 'slide') return null
      expectedOwner = 'global'
      projectedItemId = document.globalLayerItems.find(
        (entry) => entry.item.kind === 'runtime',
      )?.item.layerItemId
    } else {
      const location = document.locations.find(
        (candidate) => candidate.id === projection.locationId,
      )
      const surface = document.surfaces.find(
        (candidate) => candidate.id === projection.surfaceId,
      )
      if (
        !location
        || location.kind !== 'slide-scene'
        || !surface
        || surface.type !== 'slide'
        || session.sceneId !== location.sceneId
      ) {
        // The current authoring iframe only projects Slide scene/global Runtime.
        return null
      }
      expectedOwner = 'scene'
      projectedItemId = surface.scenes.find(
        (scene) => scene.id === location.sceneId,
      )?.layerItems.find((item) => item.kind === 'runtime')?.layerItemId
    }
    if (!projectedItemId) return null

    const row = projection.unifiedRows.find((candidate) => (
      candidate.owner === expectedOwner
      && candidate.id === projectedItemId
      && candidate.item.kind === 'runtime'
    ))
    if (
      !row
      || row.item.kind !== 'runtime'
      || row.locked
      || !Object.hasOwn(row.item.runtime.content.values, session.key)
    ) {
      return null
    }
    const initialValue = row.item.runtime.content.values[session.key]
    if (typeof initialValue !== 'string') return null

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    try {
      return captureCourseRuntimeContentTextTarget({
        sessionToken: authoringSession.token,
        projectId: document.id,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: row.owner,
        sceneId: row.scopeToken.sceneId,
        itemId: row.id,
        contentKey: session.key,
        initialValue,
      })
    } catch {
      return null
    }
  }

  const rejectRuntimeContentTextAuthoring = (
    code: RuntimeContentTextAuthoringPlanFailureCode,
    reason: string,
  ): RuntimeContentTextAuthoringCommitResult => ({
    ok: false,
    code,
    reason,
  })

  const commitRuntimeContentTextAtTarget = (
    target: CourseRuntimeContentTextTarget,
    value: string,
  ): RuntimeContentTextAuthoringCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    if (!document || document.id !== target.courseTarget.projectId) {
      return rejectRuntimeContentTextAuthoring(
        'project-mismatch',
        '运行时文字目标不属于当前 Course Project。',
      )
    }
    if (!projection || !authoringSession) {
      return rejectRuntimeContentTextAuthoring(
        'session-stale',
        '运行时文字编辑会话已过期，请重新选择目标。',
      )
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return rejectRuntimeContentTextAuthoring(
        'session-stale',
        '运行时文字编辑会话已过期，请重新选择目标。',
      )
    }
    const expectedScope = target.courseTarget.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== target.courseTarget.owner
      || projection.scope.ownerKey !== target.courseTarget.ownerKey
    ) {
      return rejectRuntimeContentTextAuthoring(
        'owner-mismatch',
        '当前编辑范围已切换，运行时文字没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planRuntimeContentTextUpdate({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      value,
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimeContentTextAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimeContentTextAuthoring(
        'invalid-document',
        '运行时文字事务缺少结果信息，未写入工程。',
      )
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return rejectRuntimeContentTextAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '运行时文字事务无效，未写入工程。',
      )
    }
    if (!step || !persistProjectResourceTransaction(
      step,
      target.courseTarget.owner === 'global'
        ? '已更新全局运行时文字；此内容由整课共享'
        : '已更新运行时文字；此内容由当前场景的所有状态共享',
    )) {
      return rejectRuntimeContentTextAuthoring(
        'invalid-document',
        '当前 Course Project 没有可用的作者会话。',
      )
    }
    return { ok: true, status: 'updated', feedback }
  }

  const rejectRuntimePropertyAuthoring = (
    code: RuntimePropertyAuthoringPlanFailureCode,
    reason: string,
  ): RuntimePropertyAuthoringCommitResult => ({
    ok: false,
    code,
    reason,
  })

  const commitRuntimePropertyAtTarget = (
    target: CourseRuntimePropertyTarget,
    update: CourseRuntimePropertyUpdate,
  ): RuntimePropertyAuthoringCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    const stable = target.courseTarget
    if (!document || document.id !== stable.projectId) {
      return rejectRuntimePropertyAuthoring(
        'project-mismatch',
        '运行时属性目标不属于当前 Course Project。',
      )
    }
    if (!projection || !authoringSession) {
      return rejectRuntimePropertyAuthoring(
        'session-stale',
        '运行时属性编辑会话已过期，请重新选择目标。',
      )
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return rejectRuntimePropertyAuthoring(
        'session-stale',
        '运行时属性编辑会话已过期，请重新选择目标。',
      )
    }
    const expectedScope = stable.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== stable.owner
      || projection.scope.ownerKey !== stable.ownerKey
    ) {
      return rejectRuntimePropertyAuthoring(
        'owner-mismatch',
        '当前编辑范围已切换，运行时属性没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planRuntimePropertyUpdate({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      update,
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimePropertyAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimePropertyAuthoring(
        'invalid-document',
        '运行时属性事务缺少结果信息，未写入工程。',
      )
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return rejectRuntimePropertyAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '运行时属性事务无效，未写入工程。',
      )
    }
    const fieldLabel = target.field === 'enabled' ? '启用状态' : '渲染模式'
    if (!step || !persistProjectResourceTransaction(
      step,
      stable.owner === 'global'
        ? `已更新全局运行时${fieldLabel}`
        : `已更新当前作用域的运行时${fieldLabel}`,
    )) {
      return rejectRuntimePropertyAuthoring(
        'invalid-document',
        '当前 Course Project 没有可用的作者会话。',
      )
    }
    return { ok: true, status: 'updated', feedback }
  }

  const rejectRuntimeTemplateCreation = (
    code: CourseRuntimeTemplateCreationPlanFailureCode,
    reason: string,
  ): RuntimeTemplateCreationCommitResult => {
    set({ errorMessage: reason, statusMessage: null })
    return { ok: false, code, reason }
  }

  const commitRuntimeTemplateCreationAtTarget = (
    target: CourseRuntimeTemplateCreationTarget,
  ): RuntimeTemplateCreationCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    if (!document || document.id !== target.projectId) {
      return rejectRuntimeTemplateCreation(
        'project-mismatch',
        '运行时模板目标不属于当前 Course Project。',
      )
    }
    if (!projection || !authoringSession) {
      return rejectRuntimeTemplateCreation(
        'session-stale',
        '运行时模板创建会话已过期，请重新打开开发工作台。',
      )
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return rejectRuntimeTemplateCreation(
        'session-stale',
        '运行时模板创建会话已过期，请重新打开开发工作台。',
      )
    }
    const expectedScope = target.owner === 'global' ? 'global' : 'scene'
    if (
      state.editingScope !== expectedScope
      || projection.scope.owner !== target.owner
      || projection.scope.ownerKey !== target.ownerKey
    ) {
      return rejectRuntimeTemplateCreation(
        'owner-mismatch',
        '当前编辑范围已切换，运行时模板没有写入。',
      )
    }

    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planRuntimeTemplateCreation({
      project: document,
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      },
      target,
      newItemId: nanoid(),
      now: new Date().toISOString(),
    })
    if (!planned.ok) {
      return rejectRuntimeTemplateCreation(planned.code, planned.reason)
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectRuntimeTemplateCreation(
        'invalid-document',
        '运行时模板事务缺少结果信息，未写入工程。',
      )
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return rejectRuntimeTemplateCreation(
        'invalid-document',
        error instanceof Error ? error.message : '运行时模板事务无效，未写入工程。',
      )
    }
    if (!step || !persistProjectResourceTransaction(
      step,
      target.owner === 'global'
        ? '已创建全局运行时模板'
        : '已创建场景运行时模板',
    )) {
      return rejectRuntimeTemplateCreation(
        'invalid-document',
        '当前 Course Project 没有可用的作者会话。',
      )
    }
    return { ok: true, status: 'created', feedback }
  }

  const rejectInteractionAuthoring = (
    code: InteractionAuthoringPlanFailureCode,
    reason: string,
  ): InteractionAuthoringCommitResult => {
    set({ errorMessage: reason, statusMessage: null })
    return { ok: false, code, reason }
  }

  const currentInteractionLocationId = (state: EditorState): string | null => (
    state.spatialSession?.selection.locationId
    ?? state.flowSession?.selection.locationId
    ?? state.slideCandidateSnapshot?.locationId
    ?? null
  )

  const currentInteractionStateId = (state: EditorState): string | null => (
    state.slideCandidateSnapshot?.stateId ?? null
  )

  const validateActiveInteractionTarget = (
    state: EditorState,
    target: InteractionAuthoringTarget,
  ): InteractionAuthoringCommitResult | null => {
    const expectedLocationId = target.carrier === 'slide-scene'
      ? target.locationId
      : target.activeLocationId
    if (
      expectedLocationId !== undefined
      && currentInteractionLocationId(state) !== expectedLocationId
    ) {
      return rejectInteractionAuthoring(
        'revision-conflict',
        '当前页面已切换，互动规则没有写入。请在目标页面重试。',
      )
    }
    if (
      target.activeStateId !== undefined
      && currentInteractionStateId(state) !== target.activeStateId
    ) {
      return rejectInteractionAuthoring(
        'revision-conflict',
        '当前演示状态已切换，互动规则没有写入。请在目标状态重试。',
      )
    }
    return null
  }

  const persistInteractionAuthoringPlan = (
    document: CourseProjectDocument,
    planned: InteractionAuthoringPlanResult,
    statusMessage: string,
  ): InteractionAuthoringCommitResult => {
    if (!planned.ok) {
      return rejectInteractionAuthoring(planned.code, planned.reason)
    }
    if (planned.status === 'no-op') {
      set({ errorMessage: null, statusMessage: '互动规则没有变化' })
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    const feedback = planned.plan.feedback
    if (!feedback) {
      return rejectInteractionAuthoring(
        'invalid-document',
        '互动事务缺少结果信息，未写入工程。',
      )
    }
    let step: EditorTransactionStep
    try {
      const candidate = createEditorTransactionStep(document, planned.plan)
      if (!candidate) {
        set({ errorMessage: null, statusMessage: '互动规则没有变化' })
        return { ok: true, status: 'unchanged', feedback }
      }
      step = candidate
    } catch (error) {
      return rejectInteractionAuthoring(
        'invalid-document',
        error instanceof Error ? error.message : '互动事务无效，未写入工程。',
      )
    }
    if (!persistProjectResourceTransaction(step, statusMessage)) {
      return rejectInteractionAuthoring(
        'invalid-document',
        '当前没有可提交互动规则的课程编辑会话。',
      )
    }
    return { ok: true, status: 'committed', feedback }
  }

  const commitMediaLibraryImportAtTarget = (
    target: CourseProjectRevisionTarget,
    items: ImportedAssetBatchItem[],
  ): MediaLibraryImportCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    if (!document || document.id !== target.projectId) {
      return {
        ok: false,
        code: 'project-mismatch',
        reason: '媒体库导入目标不属于当前 Course Project，请重新选择文件。',
      }
    }
    const planned = planCourseMediaLibraryImport({
      project: document,
      sidecar: state.slideCandidateSidecar ?? emptyCourseAssetSidecar(),
      items: items.map((item) => ({ meta: item.meta, bytes: item.bytes })),
      projectId: target.projectId,
      baseRevision: target.documentRevision,
      now: new Date().toISOString(),
    })
    if (!planned.ok) return planned
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return {
        ok: false,
        code: 'invalid-asset',
        reason: error instanceof Error ? error.message : '媒体库导入计划无效。',
      }
    }
    if (!step || !persistProjectResourceTransaction(
      step,
      `已批量导入 ${planned.plan.feedback?.importedAssetIds.length ?? items.length} 个媒体素材`,
    )) {
      return {
        ok: false,
        code: 'invalid-asset',
        reason: '当前 Course Project 没有可用的作者会话。',
      }
    }
    return {
      ok: true,
      status: 'imported',
      feedback: planned.plan.feedback!,
    }
  }

  const captureComponentReplacementTarget = (
    packageId: string,
  ): ComponentPackageReplacementTarget | null => {
    const state = get()
    const document = activeCourseDocument(state)
    if (
      !document
      || !Object.hasOwn(document.componentPackages, packageId)
      || !Object.hasOwn(state.componentPackages, packageId)
    ) {
      return null
    }
    return Object.freeze({
      projectId: document.id,
      documentRevision: document.revision,
      packageId,
    })
  }

  const commitComponentReplacementAtTarget = (
    target: ComponentPackageReplacementTarget,
    packageData: ComponentPackageData,
  ): ComponentPackageReplacementCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    if (!document || document.id !== target.projectId) {
      return {
        ok: false,
        code: 'project-mismatch',
        reason: '组件替换目标不属于当前 Course Project，请重新开始替换。',
      }
    }
    const planned = planCourseComponentPackageReplacement({
      project: document,
      componentPackages: state.componentPackages,
      packageId: target.packageId,
      replacement: packageData,
      expected: {
        projectId: target.projectId,
        revision: target.documentRevision,
      },
      now: new Date().toISOString(),
    })
    if (!planned.ok) return planned
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return {
        ok: false,
        code: 'invalid-document',
        reason: error instanceof Error ? error.message : '组件替换计划无效。',
      }
    }
    if (!step || !persistProjectResourceTransaction(
      step,
      `组件“${packageData.manifest.name}”已替换为 ${planned.plan.feedback?.replacementVersion ?? packageData.manifest.version}，${planned.plan.feedback?.affectedInstances.length ?? 0} 个实例已同步`,
    )) {
      return {
        ok: false,
        code: 'invalid-document',
        reason: '当前 Course Project 没有可用的作者会话。',
      }
    }
    set({ activeTab: 'components', errorMessage: null })
    return {
      ok: true,
      status: 'replaced',
      feedback: planned.plan.feedback!,
    }
  }

  const captureRuntimeAssetTarget = (
    session: Readonly<RuntimeTargetEditSession>,
  ): CourseRuntimeAssetReplacementTarget | null => {
    const state = get()
    const document = activeCourseDocument(state)
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    if (
      !document
      || !projection
      || !authoringSession
      || session.kind !== 'asset'
      || session.projectId !== document.id
      || session.scope !== state.editingScope
      || session.sceneId !== state.activeSceneId
      || authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return null
    }
    let expectedOwner: 'global' | 'scene'
    let projectedItemId: string | undefined
    if (session.scope === 'global') {
      if (projection.surfaceType !== 'slide') return null
      expectedOwner = 'global'
      projectedItemId = document.globalLayerItems.find(
        (entry) => entry.item.kind === 'runtime',
      )?.item.layerItemId
    } else {
      const location = document.locations.find(
        (candidate) => candidate.id === projection.locationId,
      )
      const surface = document.surfaces.find(
        (candidate) => candidate.id === projection.surfaceId,
      )
      if (
        !location
        || location.kind !== 'slide-scene'
        || !surface
        || surface.type !== 'slide'
        || session.sceneId !== location.sceneId
      ) {
        // The current authoring iframe only projects Slide scene/global Runtime.
        return null
      }
      expectedOwner = 'scene'
      projectedItemId = surface.scenes.find(
        (scene) => scene.id === location.sceneId,
      )?.layerItems.find((item) => item.kind === 'runtime')?.layerItemId
    }
    if (!projectedItemId) return null
    const row = projection.unifiedRows.find((candidate) => (
      candidate.owner === expectedOwner
      && candidate.id === projectedItemId
      && candidate.item.kind === 'runtime'
    ))
    if (
      !row
      || row.item.kind !== 'runtime'
      || row.item.locked
      || !Object.hasOwn(row.item.runtime.assets, session.key)
    ) {
      return null
    }
    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    try {
      return captureCourseRuntimeAssetReplacementTarget({
        sessionToken: authoringSession.token,
        projectId: document.id,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: row.owner,
        sceneId: row.scopeToken.sceneId,
        itemId: row.id,
        bindingKey: session.key,
      })
    } catch {
      return null
    }
  }

  const commitRuntimeAssetReplacementAtTarget = (
    target: CourseRuntimeAssetReplacementTarget,
    asset: AssetMeta,
    bytes: Uint8Array,
  ): RuntimeAssetReplacementCommitResult => {
    const state = get()
    const document = activeCourseDocument(state)
    const projection = buildCandidateEffectiveLayers(state)
    let authoringSession = state.courseAuthoringSession
    if (!document || document.id !== target.courseTarget.projectId) {
      return {
        ok: false,
        code: 'project-mismatch',
        reason: 'Runtime 素材替换目标不属于当前 Course Project。',
      }
    }
    if (!projection || !authoringSession) {
      return {
        ok: false,
        code: 'session-stale',
        reason: 'Runtime 素材替换会话已过期，请重新选择目标。',
      }
    }
    if (
      authoringSession.token.locationId !== projection.locationId
      || authoringSession.token.surfaceType !== projection.surfaceType
    ) {
      return {
        ok: false,
        code: 'session-stale',
        reason: 'Runtime 素材替换会话已过期，请重新选择目标。',
      }
    }
    const targetRow = projection.unifiedRows.find((row) => (
      row.id === target.courseTarget.itemId
      && row.owner === target.courseTarget.owner
      && row.item.kind === 'runtime'
    ))
    const scopeCompatible = target.courseTarget.owner === 'global'
      ? state.editingScope === 'global'
      : state.editingScope === 'scene'
    if (!targetRow || !scopeCompatible) {
      return {
        ok: false,
        code: targetRow ? 'owner-mismatch' : 'item-missing',
        reason: targetRow
          ? 'Runtime 素材替换目标的共享范围已改变。'
          : '原 Runtime 图层已不存在，请重新选择目标。',
      }
    }
    authoringSession = updateCourseAuthoringSessionRevision(
      authoringSession,
      document.revision,
    )
    const planned = planCourseRuntimeAssetReplacement({
      project: document,
      sidecar: state.slideCandidateSidecar ?? emptyCourseAssetSidecar(),
      currentIdentity: {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: targetRow.owner,
        ownerKey: targetRow.scopeToken.ownerKey,
      },
      target,
      asset,
      bytes,
      now: new Date().toISOString(),
    })
    if (!planned.ok) return planned
    if (planned.status === 'no-op') {
      return {
        ok: true,
        status: 'unchanged',
        feedback: planned.feedback,
      }
    }
    let step: EditorTransactionStep | null
    try {
      step = createEditorTransactionStep(document, planned.plan)
    } catch (error) {
      return {
        ok: false,
        code: 'invalid-document',
        reason: error instanceof Error ? error.message : 'Runtime 素材替换计划无效。',
      }
    }
    if (!step || !persistProjectResourceTransaction(
      step,
      target.courseTarget.owner === 'global'
        ? '已替换全局运行时图片；此素材由整课共享'
        : '已替换运行时图片；此素材由当前场景的所有状态共享',
    )) {
      return {
        ok: false,
        code: 'invalid-document',
        reason: '当前 Course Project 没有可用的作者会话。',
      }
    }
    return {
      ok: true,
      status: 'replaced',
      feedback: planned.plan.feedback!,
    }
  }

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

  const persistCourseProjectCommand = (
    result: CourseLocationCommandResult,
    extra: { statusMessage?: string | null } = {},
  ) => {
    if (!result.ok) {
      if (result.reason) set({ errorMessage: result.reason, statusMessage: null })
      return
    }
    const state = get()
    const nextProject = result.project
    if (state.spatialSession) {
      const history = commitSpatialAuthoringHistory(state.spatialSession.history, nextProject)
      persistSpatialResult(
        succeedSpatialCommand({ ...state.spatialSession, history }, true),
        extra,
      )
      return
    }
    if (state.flowSession) {
      persistFlowResult({
        ok: true,
        nextDocument: nextProject,
        historyEntry: true,
        selection: state.flowSession.selection,
      }, extra)
      return
    }
    const backend = selectSlideAuthoringBackend(state)
    if (backend) {
      const session = backend.getSession()
      const history = commitSlideAuthoringHistory(session.history, nextProject)
      persistCandidateResult({
        ok: true,
        nextSession: { ...session, history },
        historyEntry: true,
      }, extra)
    }
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
    const sidecar = extra.sidecar ?? emptyCourseAssetSidecar()
    set({
      flowSession: session,
      flowTextEdit: null,
      spatialSession: null,
      spatialContentEdit: null,
      spatialGraphSelection: null,
      spatialPlaybackPathId: null,
      slideBackend: null,
      slideCandidateSnapshot: null,
      slideCandidateClipboard: null,
      v9ContentEdit: null,
      ...flowViewState(session, sidecar),
      ...continuedSidecarStacks(extra.resourceHistory),
      slideCandidateSidecar: sidecar,
      activeSceneId: session.selection.locationId,
      activePresentationStateId: null,
      editingScope: session.selection.authoringScope === 'global' ? 'global' : 'scene',
      selectedNodeIds: [...session.selection.selectedOverlayIds],
      selectedNodeId: session.selection.selectedOverlayIds.at(-1) ?? null,
      editingTextNodeId: null,
      textEditSession: null,
      canvasMode: extra.canvasMode ?? 'edit',
      errorMessage: null,
      history: v9HistoryToStoreHistory(session.history),
      dirty: extra.dirty ?? false,
      projectPath: extra.path === undefined ? null : extra.path,
      statusMessage: extra.statusMessage ?? `已打开“${session.history.present.title}”`,
      componentPackages: extra.componentPackages ?? {},
      assetFiles: projectedAssetFiles(sidecar),
      clipboardNodes: [],
      clipboardGlobalItems: [],
      clipboardInteractionRules: [],
      courseAuthoringSession: buildCourseAuthoringSessionForProject(
        session.history.present,
        session.selection.locationId,
        session.selection.selectedOverlayIds,
      ),
    })
  }

  const persistLayerCommand = (
    result: LayerCommandResult,
    extra?: { statusMessage?: string | null },
  ): SlideCommandResult => {
    const backend = selectSlideAuthoringBackend(get())
    if (!backend) {
      return {
        ok: false,
        reason: 'not-slide-authoring-backend',
        historyEntry: false,
      }
    }
    return persistCandidateResult(sessionFromLayerResult(backend.getSession(), result), extra)
  }

  const currentMediaSession = (): CourseMediaSession | null => {
    const backend = selectSlideAuthoringBackend(get())
    if (!backend) return null
    return bindCourseMediaSession(
      backend.getSession(),
      get().slideCandidateSidecar ?? emptyCourseAssetSidecar(),
    )
  }

  const persistMediaResult = (
    result: CourseMediaCommandResult,
  ): CourseMediaCommandResult => {
    const capacityError =
      `当前场景已达到或将超过 ${MAX_SCENE_NODES} 个节点上限。请删除不需要的节点，或新建场景后继续。`
    const keepCapacityError = get().errorMessage === capacityError
    persistCandidateResult({
      ok: result.ok,
      reason: result.reason,
      nextSession: result.nextSession,
      historyEntry: result.historyEntry,
      selection: result.selection,
    }, {
      sidecar: result.sidecar,
      statusMessage: result.ok ? result.reason ?? null : undefined,
    })
    if (result.ok && (result.libraryFallback === 'scene-capacity' || keepCapacityError)) {
      set({
        errorMessage: capacityError,
        statusMessage: null,
        activeTab: 'elements',
      })
    }
    return result
  }

  const runV9DocumentMutation = (
    recipe: (draft: CourseProjectDocument) => void,
    extra: {
      statusMessage?: string | null
      sidecar?: CourseAssetSidecar
      selectionIds?: readonly string[]
      scope?: 'global' | 'scene'
      componentPackages?: Record<string, ComponentPackageData>
    } = {},
  ): SlideCommandResult => {
    return runCandidateSession((session) => {
      try {
        const project = commitSlideProjectMutation(session.history.present, recipe)
        const selectionIds = extra.selectionIds
          ? [...extra.selectionIds]
          : [...session.selection.selectionIds]
        const selection = selectSlideEditorLayers({
          project,
          locationId: session.selection.locationId,
          stateId: session.selection.stateId,
          selectionIds,
        })
        return {
          ok: true,
          historyEntry: true,
          nextSession: {
            ...session,
            history: commitSlideAuthoringHistory(session.history, project),
            selection,
            scope: extra.scope ?? session.scope,
          },
          selection,
        }
      } catch (error) {
        return {
          ok: false,
          reason: error instanceof Error ? error.message : '无法写入当前课件',
          historyEntry: false,
          nextSession: session,
          selection: session.selection,
        }
      }
    }, extra)
  }

  const appendV9GlobalNode = (
    node: SceneNode,
    extra: { statusMessage?: string | null; sidecar?: CourseAssetSidecar } = {},
  ): boolean => {
    if (!selectSlideAuthoringBackend(get()) || get().editingScope !== 'global') return false
    runV9DocumentMutation((draft) => {
      appendGlobalCourseNode(draft, node)
    }, {
      ...extra,
      selectionIds: [node.id],
      scope: 'global',
    })
    return true
  }

  const runCandidateSession = (
    run: (session: SlideAuthoringSession) => SlideCommandResult,
    extra?: {
      clipboard?: V9SlideClipboardPayload | null
      statusMessage?: string | null
      clearContentEdit?: boolean
      sidecar?: CourseAssetSidecar
      sidecarDirection?: 'undo' | 'redo'
      componentPackages?: Record<string, ComponentPackageData>
    },
  ): SlideCommandResult => {
    const backend = selectSlideAuthoringBackend(get())
    if (!backend) {
      return {
        ok: false,
        reason: 'not-slide-authoring-backend',
        historyEntry: false,
      }
    }
    return persistCandidateResult(run(backend.getSession()), extra)
  }

  const runCandidateAction = (
    actionId: SlideSceneActionId,
    extra: {
      orderedLayerItemIds?: readonly string[]
      focus?: Parameters<typeof shouldIgnoreSlideLayerDeleteForFocus>[0]
    } = {},
  ) => {
    const backend = selectSlideAuthoringBackend(get())
    if (!backend) {
      return {
        ok: false,
        reason: 'not-slide-authoring-backend',
        historyEntry: false,
        actionId,
        clipboard: get().slideCandidateClipboard,
      }
    }
    const execution = executeSlideSceneAction(actionId, backend.getSession(), {
      clipboard: get().slideCandidateClipboard,
      expectedRevision: backend.getSnapshot().revision,
      orderedLayerItemIds: extra.orderedLayerItemIds,
      focus: extra.focus,
    })
    persistCandidateResult(execution, {
      clipboard: execution.clipboard,
      statusMessage: execution.ok ? execution.reason ?? null : undefined,
    })
    return execution
  }

  const commitOpenCandidateContentEdit = (
    nextSelectionIds: readonly string[],
  ): SlideAuthoringBackend | null => {
    const state = get()
    const backend = selectSlideAuthoringBackend(state)
    const edit = state.v9ContentEdit
    if (!backend) return null
    if (!edit) return backend
    const keep =
      nextSelectionIds.length === 1 &&
      nextSelectionIds[0] === edit.target.layerItemId
    if (keep) return backend
    persistCandidateResult(
      commitV9SlideContentEdit(backend.getSession(), edit),
      { clearContentEdit: true },
    )
    return selectSlideAuthoringBackend(get())
  }

  const persistOpenV9ContentEdit = (): SlideAuthoringBackend | null => {
    const state = get()
    const backend = selectSlideAuthoringBackend(state)
    const edit = state.v9ContentEdit
    if (!backend) return null
    if (!edit) return backend
    persistCandidateResult(
      commitV9SlideContentEdit(backend.getSession(), edit),
      { clearContentEdit: true },
    )
    return selectSlideAuthoringBackend(get())
  }

  const persistOpenSpatialContentEdit = (): SpatialAuthoringSession | null => {
    const state = get()
    const session = state.spatialSession
    const edit = state.spatialContentEdit
    if (!session) return null
    if (!edit) return session
    persistSpatialResult(
      commitSpatialWorldContentEdit(session, edit),
      { clearContentEdit: true },
    )
    return get().spatialSession
  }

  const commit = (
    _recipe: (draft: ProjectDocument) => void,
    _selection?: string | null,
    _componentPackageMutation?: ComponentPackageMutation | ComponentPackageMutation[],
  ) => {
    // V9 is the only document in the store; mutations must go through V9 course commands
  }

  const canAddNodes = (count = 1): boolean => {
    const state = get()
    const backend = selectSlideAuthoringBackend(state)
    const length = backend
      ? state.editingScope === 'global'
        ? backend.getSession().history.present.globalLayerItems.length
        : findCourseSlideScene(
            backend.getSession().history.present,
            backend.getSnapshot().sceneId,
          )?.layerItems.length ?? 0
      : editingNodes(state).length
    if (count > 0 && length + count <= MAX_SCENE_NODES) return true
    set({
      errorMessage: state.editingScope === 'global'
        ? `全局层已达到或将超过 ${MAX_SCENE_NODES} 个元素上限。请删除不需要的全局元素后继续。`
        : `当前场景已达到或将超过 ${MAX_SCENE_NODES} 个节点上限。请删除不需要的节点，或新建场景后继续。`,
      statusMessage: null,
    })
    return false
  }

  const canAddNode = (): boolean => canAddNodes(1)

  const appendNodeToEditingScope = (node: SceneNode): void => {
    const state = get()
    const sceneId = state.activeSceneId
    commit((draft) => {
      if (state.editingScope === 'global') {
        draft.globalLayer.push({
          node,
          layer: 'overlay',
          visibility: { mode: 'all', sceneIds: [] },
        })
      } else {
        const scene = draft.scenes.find((scene) => scene.id === sceneId)
        if (scene) {
          appendNodesToScene(
            scene as SceneDocument,
            [node],
            state.activePresentationStateId,
          )
        }
      }
    }, node.id)
  }

  const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => {
    if (left.byteLength !== right.byteLength) return false
    return left.every((value, index) => value === right[index])
  }

  interface AssetFileMutation {
    assetId: string
    after?: Uint8Array
    /** Import rejects an existing different payload; replacement opts in. */
    allowReplace?: boolean
  }

  const commitAssetTransaction = (
    _fileMutations: AssetFileMutation[],
    _recipe: (draft: ProjectDocument) => void,
    _selectedNodeIds: string[] | undefined,
    _statusMessage: string,
  ): void => {
    // V9 is the only document in the store; asset mutations must go through V9 course commands
  }

  const commitAssetBatch = (
    items: ImportedAssetBatchItem[],
    recipe: (draft: ProjectDocument) => void,
    selectedNodeIds: string[] | undefined,
    statusMessage: string,
  ): void => {
    if (items.length === 0) return
    const uniqueItems = new Map<string, ImportedAssetBatchItem>()
    for (const item of items) {
      const duplicate = uniqueItems.get(item.meta.id)
      if (duplicate && !sameBytes(duplicate.bytes, item.bytes)) {
        throw new UserFacingError(
          '素材导入失败',
          `批次中出现了相同 ID 但内容不同的素材“${item.meta.filename}”。`,
          '请取消导入并重新选择文件。',
        )
      }
      uniqueItems.set(item.meta.id, {
        meta: structuredClone(item.meta),
        bytes: item.bytes.slice(),
      })
    }

    commitAssetTransaction(
      [...uniqueItems.values()].map((item) => ({
        assetId: item.meta.id,
        after: item.bytes,
      })),
      (draft) => {
        for (const item of uniqueItems.values()) {
          if (!draft.assets[item.meta.id]) {
            draft.assets[item.meta.id] = structuredClone(item.meta)
          }
        }
        recipe(draft)
      },
      selectedNodeIds,
      statusMessage,
    )
  }

  return {
    project: initialProject,
    activeSceneId: initialProject.scenes[0].id,
    activePresentationStateId: null,
    editingScope: 'scene',
    canvasMode: 'edit',
    selectedNodeId: null,
    selectedNodeIds: [],
    clipboardNodes: [],
    clipboardGlobalItems: [],
    clipboardInteractionRules: [],
    projectPath: null,
    dirty: false,
    history: emptyHistory(),
    assetFiles: {},
    componentPackages: {},
    editorMode: loadEditorMode(),
    activeTab: 'elements',
    editingTextNodeId: null,
    textEditSession: null,
    statusMessage: '已创建新课件',
    errorMessage: null,
    slideBackend: initialBackend,
    slideCandidateSnapshot: initialSnapshot,
    slideCandidateClipboard: null,
    v9ContentEdit: null,
    ...candidateViewState(initialBackend, null),
    slideCandidateSidecar: initialSidecar,
    slideCandidateSidecarPast: [],
    slideCandidateSidecarFuture: [],
    slideCandidateComponentPackagesPast: [],
    slideCandidateComponentPackagesFuture: [],
    spatialSession: null,
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

    injectV9SlideCandidateBackend(backend) {
      if (!isSlideAuthoringBackend(backend)) return
      applyV9Backend(backend, {
        sidecar: emptyCourseAssetSidecar(),
        dirty: false,
        statusMessage: null,
        path: null,
      })
    },

    clearV9SlideCandidateBackend() {
      const project = createBlankCourseProject()
      applyV9Backend(
        createSlideAuthoringBackend(openSlideAuthoringSession(project)),
        {
          sidecar: emptyCourseAssetSidecar(),
          dirty: false,
          statusMessage: null,
          path: null,
        },
      )
    },

    runSlideCandidateCommand(run) {
      return persistCandidateResult(
        executeSlideAuthoringCommand(get().slideBackend, run),
      )
    },

    applySlideCandidateSession(session) {
      if (!isSlideAuthoringBackend(get().slideBackend)) return
      persistCandidateResult({
        ok: true,
        nextSession: session,
        historyEntry: false,
      })
    },

    applySlideCandidateCommand(run, extra) {
      return runCandidateSession(run, extra)
    },

    importV9CandidateMedia(input) {
      const media = currentMediaSession()
      if (!media) {
        return {
          ok: false,
          reason: 'not-slide-authoring-backend',
          nextSession: undefined as unknown as SlideAuthoringSession,
          sidecar: emptyCourseAssetSidecar(),
          historyEntry: false,
        }
      }
      const items = input.items.map((item) => ({ meta: item.meta, bytes: item.bytes }))
      if (input.nativeType === 'audio') {
        return persistMediaResult(importCourseSounds(media, items, {
          expectedRevision: media.session.history.present.revision,
        }))
      }
      if (!input.nativeType) {
        const target = captureCourseProjectRevisionTarget()
        const committed = target
          ? commitMediaLibraryImportAtTarget(target, items)
          : {
              ok: false as const,
              code: 'project-mismatch' as const,
              reason: '当前没有可写入的 Course Project。',
            }
        const backend = selectSlideAuthoringBackend(get())
        return {
          ok: committed.ok,
          reason: committed.ok ? undefined : committed.reason,
          nextSession: backend?.getSession() ?? media.session,
          sidecar: get().slideCandidateSidecar ?? media.sidecar,
          historyEntry: committed.ok && committed.status === 'imported',
          selection: backend?.getSession().selection ?? media.session.selection,
          importedAssetIds: committed.ok
            ? committed.feedback.importedAssetIds
            : [],
          reusedAssetIds: committed.ok
            ? committed.feedback.reusedAssetIds
            : [],
          destination: 'library' as const,
        }
      }
      if (
        get().editingScope === 'global'
        && (input.mode ?? 'library') === 'add'
        && (input.nativeType === 'image' || input.nativeType === 'video')
      ) {
        for (const item of items) {
          if (input.nativeType === 'image') {
            get().addImageNode(item.meta, item.bytes, input.x, input.y)
          } else {
            get().addVideoNode(item.meta, item.bytes, input.x, input.y)
          }
        }
        const backend = selectSlideAuthoringBackend(get())
        return {
          ok: Boolean(backend),
          reason: backend ? '图片已添加到全局层' : 'not-slide-authoring-backend',
          nextSession: backend?.getSession() ?? media.session,
          sidecar: get().slideCandidateSidecar ?? emptyCourseAssetSidecar(),
          historyEntry: Boolean(backend),
          selection: backend?.getSession().selection ?? media.session.selection,
        }
      }
      return persistMediaResult(importAndPlaceCourseMedia(media, {
        items,
        nativeType: input.nativeType,
        mode: input.mode ?? 'library',
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
      }, {
        expectedRevision: media.session.history.present.revision,
      }))
    },

    exportV9SlideCandidateArchive() {
      const spatial = get().spatialSession
      const flow = get().flowSession
      const backend = selectSlideAuthoringBackend(get())
      const project = spatial?.history.present
        ?? flow?.history.present
        ?? backend?.getSession().history.present
      if (!project) return null
      const sidecar = get().slideCandidateSidecar ?? emptyCourseAssetSidecar()
      return createCourseProjectArchive({
        project,
        assetFiles: Object.fromEntries(
          Object.entries(sidecar.files).map(([assetId, bytes]) => [assetId, bytes.slice()]),
        ),
        componentFiles: componentPackagesToArchiveFiles(get().componentPackages),
      })
    },

    reopenV9SlideCandidateArchive(bytes) {
      try {
        const archive = openCourseProjectArchive(bytes)
        const componentPackages = componentPackagesFromArchive(
          archive.project,
          archive.componentFiles,
        )
        if (courseProjectStartsAsSpatial(archive.project)) {
          applySpatialBackend(openSpatialAuthoringSession(archive.project), {
            sidecar: freezeCourseAssetSidecar(archive.assetFiles),
            componentPackages,
            dirty: false,
            statusMessage: `已打开“${archive.project.title}”`,
            path: get().projectPath,
          })
          return true
        }
        if (courseProjectStartsAsFlow(archive.project)) {
          applyFlowBackend(openFlowAuthoringSession(archive.project), {
            sidecar: freezeCourseAssetSidecar(archive.assetFiles),
            componentPackages,
            dirty: false,
            statusMessage: `已打开“${archive.project.title}”`,
            path: get().projectPath,
          })
          return true
        }
        const backend = createSlideAuthoringBackend(openSlideAuthoringSession(archive.project))
        applyV9Backend(backend, {
          sidecar: freezeCourseAssetSidecar(archive.assetFiles),
          componentPackages,
          dirty: false,
          statusMessage: `已打开“${archive.project.title}”`,
          path: get().projectPath,
        })
        return true
      } catch (error) {
        set({
          errorMessage: error instanceof Error ? error.message : '无法打开课程工程',
          statusMessage: null,
        })
        return false
      }
    },

    runSpatialCommand(run, extra) {
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
      return persistSpatialResult(run(session), extra)
    },

    applySpatialAuthoringSession(session, extra = {}) {
      const state = get()
      const currentDocument = activeCourseDocument(state)
      const commandResult = Object.prototype.hasOwnProperty.call(extra, 'historyEntry')
      const stale = Boolean(
        currentDocument && (
          session.history.present.id !== currentDocument.id ||
          session.history.present.revision < currentDocument.revision ||
          !state.spatialSession ||
          (commandResult && session.sessionId !== state.spatialSession.sessionId)
        ),
      )
      if (stale) {
        set({
          errorMessage: '课件内容已更新。旧的 Spatial 会话没有写入。',
          statusMessage: null,
        })
        return rejectSpatialCommand(state.spatialSession ?? session, 'stale-revision')
      }
      return persistSpatialResult(
        succeedSpatialCommand(session, extra.historyEntry === true),
        { statusMessage: extra.statusMessage },
      )
    },

    applyFlowCommand(result, extra = {}) {
      return persistFlowResult(result, extra)
    },

    applyFlowSelection(selection) {
      const flow = get().flowSession
      if (!flow) return
      persistFlowResult({
        ok: true,
        nextDocument: flow.history.present,
        historyEntry: false,
        selection: selection ?? flow.selection,
      }, {
        selection: selection ?? flow.selection,
        clearTextEdit: selection?.focus !== 'text',
      })
    },

    setFlowTextEdit(edit) {
      set({ flowTextEdit: edit })
    },

    insertFlowLibraryMedia(assetId, request = {}) {
      const flow = get().flowSession
      if (!flow) {
        return { ok: false, reason: '请先选择一个流式页面', historyEntry: false }
      }
      return persistFlowResult(
        insertFlowSharedMedia(flow.history.present, flow.selection, {
          assetId,
          altKey: request.altKey,
          menuAction: request.menuAction,
        }, { expectedRevision: flow.history.present.revision }),
      ) as FlowSharedAuthoringResult
    },

    formatFlowTextStyle(style) {
      const flow = get().flowSession
      if (!flow) {
        return { ok: false, reason: '请先选择一个流式页面', historyEntry: false }
      }
      const formatted = formatFlowAuthoringTextStyle({
        document: flow.history.present,
        selection: flow.selection,
        style,
        edit: get().flowTextEdit,
        expectedRevision: flow.history.present.revision,
      })
      if (formatted.nextEdit) {
        set({ flowTextEdit: formatted.nextEdit })
      }
      return persistFlowResult(formatted, {
        selection: formatted.nextSelection ?? flow.selection,
      }) as FlowCommandResult
    },

    formatFlowBlock(spec) {
      const flow = get().flowSession
      if (!flow) {
        return { ok: false, reason: '请先选择一个流式页面', historyEntry: false }
      }
      return persistFlowResult(
        formatFlowAuthoringBlock(flow.history.present, flow.selection, spec, {
          expectedRevision: flow.history.present.revision,
        }),
      ) as FlowCommandResult
    },

    renameFlowHeading(locationId, title) {
      const flow = get().flowSession
      if (!flow) return
      const document = flow.history.present
      const location = document.locations.find((candidate) => candidate.id === locationId)
      if (!location || location.kind !== 'flow-block') return
      persistFlowResult(updateFlowEditorBlock(document, {
        surfaceId: location.surfaceId,
        blockId: location.blockId,
        parentId: findFlowBlockRecursive(
          flowSurfaceIn(document, location.surfaceId).blocks,
          location.blockId,
        )?.parentId ?? null,
      }, { text: title }, { expectedRevision: document.revision }), {
        selection: flow.selection,
      })
    },

    renameFlowPage(surfaceId, title) {
      const flow = get().flowSession
      if (!flow) return
      const next = commitSlideProjectMutation(flow.history.present, (draft) => {
        const surface = draft.surfaces.find((candidate) => candidate.id === surfaceId)
        if (surface) surface.title = title
      })
      persistFlowResult({
        ok: true,
        nextDocument: next,
        historyEntry: true,
        selection: flow.selection,
      }, { statusMessage: '已重命名页面' })
    },

    setSpatialGraphSelection(selection) {
      set({
        spatialGraphSelection: selection,
        ...(selection
          ? { selectedNodeId: null, selectedNodeIds: [], activeTab: 'properties' as const }
          : {}),
      })
    },

    setSpatialPlaybackPathId(pathId) {
      set({ spatialPlaybackPathId: pathId })
    },

    moveCandidateLayerOwner(fromId, toId) {
      const spatial = get().spatialSession
      if (spatial) {
        const projection = buildCandidateEffectiveLayers(get())
        const from = projection?.unifiedRows.find((row) => row.id === fromId)
        const to = projection?.unifiedRows.find((row) => row.id === toId)
        if (!from || !to) return
        const destination: EffectiveLayerOwnerDestination = {
          source: to.owner,
          surfaceId: to.scopeToken.surfaceId,
          sceneId: to.scopeToken.sceneId,
        }
        persistSpatialLayerCommand(moveEffectiveLayerOwner(
          spatial.history.present,
          commandTargetForRow(from),
          destination,
          { expectedRevision: spatial.history.present.revision },
        ))
        return
      }
      const flow = get().flowSession
      if (flow) {
        const projection = buildCandidateEffectiveLayers(get())
        const from = projection?.unifiedRows.find((row) => row.id === fromId)
        const to = projection?.unifiedRows.find((row) => row.id === toId)
        if (!from || !to) return
        const destination: EffectiveLayerOwnerDestination = {
          source: to.owner,
          surfaceId: to.scopeToken.surfaceId,
          sceneId: to.scopeToken.sceneId,
        }
        persistFlowLayerCommand(moveEffectiveLayerOwner(
          flow.history.present,
          commandTargetForRow(from),
          destination,
          { expectedRevision: flow.history.present.revision },
        ))
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) return
      const projection = buildCandidateEffectiveLayers(get())
      const from = projection?.unifiedRows.find((row) => row.id === fromId)
      const to = projection?.unifiedRows.find((row) => row.id === toId)
      if (!from || !to) return
      const destination: EffectiveLayerOwnerDestination = {
        source: to.owner,
        surfaceId: to.scopeToken.surfaceId,
        sceneId: to.scopeToken.sceneId,
      }
      persistLayerCommand(moveEffectiveLayerOwner(
        backend.getSession().history.present,
        commandTargetForRow(from),
        destination,
        { expectedRevision: backend.getSnapshot().revision },
      ))
    },

    setCandidateGlobalLayerLocationVisibility(nodeId, visibility) {
      const spatial = get().spatialSession
      if (spatial) {
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row || row.owner !== 'global') return
        persistSpatialLayerCommand(setGlobalLayerLocationVisibility(
          spatial.history.present,
          commandTargetForRow(row),
          visibility,
          { expectedRevision: spatial.history.present.revision },
        ))
        return
      }
      const flow = get().flowSession
      if (flow) {
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row || row.owner !== 'global') return
        persistFlowLayerCommand(setGlobalLayerLocationVisibility(
          flow.history.present,
          commandTargetForRow(row),
          visibility,
          { expectedRevision: flow.history.present.revision },
        ))
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) return
      const row = findCandidateLayerRow(get(), nodeId)
      if (!row || row.owner !== 'global') return
      persistLayerCommand(setGlobalLayerLocationVisibility(
        backend.getSession().history.present,
        commandTargetForRow(row),
        visibility,
        { expectedRevision: backend.getSnapshot().revision },
      ))
    },

    setCandidateGlobalLayerVisibleAtLocation(nodeId, visible) {
      const spatial = get().spatialSession
      if (spatial) {
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row || row.owner !== 'global') return
        persistSpatialLayerCommand(setGlobalLayerVisibleAtLocation(
          spatial.history.present,
          commandTargetForRow(row),
          visible,
          { expectedRevision: spatial.history.present.revision },
        ))
        return
      }
      const flow = get().flowSession
      if (flow) {
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row || row.owner !== 'global') return
        persistFlowLayerCommand(setGlobalLayerVisibleAtLocation(
          flow.history.present,
          commandTargetForRow(row),
          visible,
          { expectedRevision: flow.history.present.revision },
        ))
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (!backend) return
      const row = findCandidateLayerRow(get(), nodeId)
      if (!row || row.owner !== 'global') return
      persistLayerCommand(setGlobalLayerVisibleAtLocation(
        backend.getSession().history.present,
        commandTargetForRow(row),
        visible,
        { expectedRevision: backend.getSnapshot().revision },
      ))
    },

    commitSlideCandidateTextRunStyle(input) {
      const spatial = get().spatialSession
      if (spatial) {
        return persistSpatialResult(commitSpatialWorldTextRunStyle(spatial, {
          layerItemId: input.layerItemId,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          patch: input.patch,
          source: input.source ?? 'properties',
        }), { clearContentEdit: true })
      }
      return runCandidateSession(
        (session) => commitV9SlideTextRunStyle(session, {
          layerItemId: input.layerItemId,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          patch: input.patch,
          source: input.source ?? 'properties',
        }),
        { clearContentEdit: true },
      )
    },

    createNewProject() {
      const project = createBlankCourseProject()
      applyV9Backend(
        createSlideAuthoringBackend(openSlideAuthoringSession(project)),
        {
          sidecar: emptyCourseAssetSidecar(),
          path: null,
          dirty: false,
          statusMessage: '已创建新课件',
        },
      )
    },

    createNewSpatialProject() {
      const project = createBlankSpatialCourseProject()
      applySpatialBackend(openSpatialAuthoringSession(project), {
        sidecar: emptyCourseAssetSidecar(),
        path: null,
        dirty: false,
        statusMessage: '已创建空白无限画布课件',
      })
    },

    createNewFlowProject() {
      const project = createBlankFlowCourseProject()
      applyFlowBackend(openFlowAuthoringSession(project), {
        sidecar: emptyCourseAssetSidecar(),
        path: null,
        dirty: false,
        statusMessage: '已创建空白流式讲义课件',
      })
    },

    loadCourseProject(project, path, assetFiles = {}, componentPackages = {}) {
      if (courseProjectStartsAsSpatial(project)) {
        applySpatialBackend(openSpatialAuthoringSession(project), {
          sidecar: freezeCourseAssetSidecar(assetFiles),
          path,
          dirty: false,
          statusMessage: `已打开“${project.title}”`,
          componentPackages,
        })
        return
      }
      if (courseProjectStartsAsFlow(project)) {
        applyFlowBackend(openFlowAuthoringSession(project), {
          sidecar: freezeCourseAssetSidecar(assetFiles),
          path,
          dirty: false,
          statusMessage: `已打开“${project.title}”`,
          componentPackages,
        })
        return
      }
      applyV9Backend(
        createSlideAuthoringBackend(openSlideAuthoringSession(project)),
        {
          sidecar: freezeCourseAssetSidecar(assetFiles),
          path,
          dirty: false,
          statusMessage: `已打开“${project.title}”`,
          componentPackages,
        },
      )
    },

    loadProject(project, path, assetFiles = {}, componentPackages = {}) {
      const migrated = migrateProjectV8ToCourseProjectV9(project)
      get().loadCourseProject(migrated, path, assetFiles, componentPackages)
    },

    markSaved(path, project) {
      const spatial = get().spatialSession
      if (spatial) {
        persistOpenSpatialContentEdit()
        const live = get().spatialSession ?? spatial
        set({
          projectPath: path,
          dirty: false,
          statusMessage: `已保存到 ${path}`,
          editingTextNodeId: null,
          textEditSession: null,
          spatialContentEdit: null,
          ...(project
            ? { project: normalizeProjectPresentations(cloneProject(project)) }
            : {
                project: derivedV8ProjectFromSpatial(
                  live,
                  get().slideCandidateSidecar,
                  null,
                ),
              }),
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        set({
          projectPath: path,
          dirty: false,
          statusMessage: `已保存到 ${path}`,
          flowTextEdit: null,
          ...(project
            ? { project: normalizeProjectPresentations(cloneProject(project)) }
            : {
                project: derivedV8ProjectFromFlow(flow, get().slideCandidateSidecar),
              }),
        })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistOpenV9ContentEdit()
        const nextBackend = selectSlideAuthoringBackend(get()) ?? backend
        set({
          projectPath: path,
          dirty: false,
          statusMessage: `已保存到 ${path}`,
          editingTextNodeId: null,
          textEditSession: null,
          v9ContentEdit: null,
          ...(project
            ? { project: normalizeProjectPresentations(cloneProject(project)) }
            : {
                project: derivedV8ProjectFromBackend(
                  nextBackend,
                  get().slideCandidateSidecar,
                  null,
                ),
              }),
        })
        return
      }
    },

    setEditingScope(editingScope) {
      const spatial = get().spatialSession
      if (spatial) {
        persistSpatialResult(setSpatialEditingScope(
          spatial,
          editingScope === 'global' ? 'global' : 'world',
        ), {
          statusMessage: editingScope === 'global' ? '正在编辑全局层' : '正在编辑无限画布',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const document = flow.history.present
        if (editingScope === 'global') {
          const entered = enterFlowGlobalAuthoring(document, flow.selection.locationId)
          if (!entered.ok || !('selection' in entered)) {
            if (entered.reason) set({ errorMessage: entered.reason, statusMessage: null })
            return
          }
          persistFlowResult({
            ok: true,
            nextDocument: document,
            historyEntry: false,
            selection: entered.selection,
          }, {
            statusMessage: '正在编辑全局层',
            clearTextEdit: true,
          })
          return
        }
        persistFlowResult({
          ok: true,
          nextDocument: document,
          historyEntry: false,
          selection: selectFlowEditorBlock(
            document,
            flow.selection.locationId,
            flow.selection.selectedBlockId
              ?? flowLocationBlockId(document.locations, flow.selection.locationId)
              ?? flow.selection.locationId,
          ),
        }, {
          statusMessage: '正在编辑流式讲义',
          clearTextEdit: true,
        })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistCandidateResult(backend.setScope(
          editingScope === 'global' ? 'global' : 'scene',
          { expectedRevision: backend.getSnapshot().revision },
        ))
        return
      }
      set((state) => {
        if (state.editingScope === editingScope) return state
        return {
          ...commitTextEditSessionState(state),
          editingScope,
          selectedNodeId: null,
          selectedNodeIds: [],
          editingTextNodeId: null,
          textEditSession: null,
          activeTab: 'properties',
          statusMessage: editingScope === 'global'
            ? '正在编辑全局层'
            : `正在编辑“${currentScene(state)?.name ?? '当前场景'}”`,
        }
      })
    },

    setCanvasMode(canvasMode) {
      const spatial = get().spatialSession
      if (spatial) {
        set({
          canvasMode,
          selectedNodeId: canvasMode === 'run' ? null : get().selectedNodeId,
          selectedNodeIds: canvasMode === 'run' ? [] : get().selectedNodeIds,
          editingTextNodeId: null,
          textEditSession: null,
          spatialContentEdit: null,
          spatialGraphSelection: canvasMode === 'run' ? null : get().spatialGraphSelection,
          statusMessage: canvasMode === 'run'
            ? '正在运行当前课件；切回编辑可直接修改元素'
            : '已返回无限画布编辑',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        set({
          canvasMode,
          flowTextEdit: canvasMode === 'run' ? null : get().flowTextEdit,
          statusMessage: canvasMode === 'run'
            ? '正在运行当前流式讲义；切回编辑可继续改稿纸'
            : '已返回流式讲义编辑',
        })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistOpenV9ContentEdit()
        const live = selectSlideAuthoringBackend(get()) ?? backend
        const scene = currentScene(get())
        const nextStateId =
          canvasMode === 'run' && get().activePresentationStateId === null && scene
            ? ensureScenePresentation(scene).initialStateId
            : get().activePresentationStateId
        if (nextStateId !== live.getSession().selection.stateId) {
          persistCandidateResult(live.activateState(nextStateId, {
            expectedRevision: live.getSnapshot().revision,
          }))
        }
        const after = get()
        set({
          canvasMode,
          selectedNodeId: canvasMode === 'run' ? null : after.selectedNodeId,
          selectedNodeIds: canvasMode === 'run' ? [] : after.selectedNodeIds,
          editingTextNodeId: null,
          textEditSession: null,
          v9ContentEdit: null,
          statusMessage: canvasMode === 'run'
            ? '正在运行当前课件；切回编辑可直接修改元素'
            : '已返回状态编辑画布',
        })
        return
      }
      set((state) => {
        const prepared = commitTextEditSessionState(state)
        const scene = currentScene(prepared)
        const activePresentationStateId =
          canvasMode === 'run' && prepared.activePresentationStateId === null && scene
            ? ensureScenePresentation(scene).initialStateId
            : prepared.activePresentationStateId
        return {
          ...prepared,
          activePresentationStateId,
          canvasMode,
          selectedNodeId: canvasMode === 'run' ? null : prepared.selectedNodeId,
          selectedNodeIds: canvasMode === 'run' ? [] : prepared.selectedNodeIds,
          editingTextNodeId: null,
          textEditSession: null,
          statusMessage: canvasMode === 'run'
            ? '正在运行当前课件；切回编辑可直接修改元素'
            : '已返回状态编辑画布',
        }
      })
    },

    setEditorMode(editorMode) {
      persistEditorMode(editorMode)
      set((state) => ({
        ...commitTextEditSessionState(state),
        editorMode,
        activeTab: editorMode === 'simple' &&
          (state.activeTab === 'components' || state.activeTab === 'automation' || state.activeTab === 'developer')
          ? 'properties'
          : state.activeTab,
        statusMessage: editorMode === 'simple'
          ? '已切换到简洁模式'
          : '已切换到专业模式',
      }))
    },

    setActiveTab(activeTab) {
      set((state) => ({
        ...commitTextEditSessionState(state),
        activeTab,
      }))
    },
    setStatus(statusMessage) {
      set({ statusMessage })
    },
    setError(errorMessage) {
      set({ errorMessage })
    },

    renameProject(title) {
      const normalized = title.trim().slice(0, 80)
      if (!normalized) {
        set({ errorMessage: '课件名称不能为空。' })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        if (normalized === backend.getSession().history.present.title) return
        runCandidateSession(
          (session) => {
            const project = commitSlideProjectMutation(session.history.present, (draft) => {
              draft.title = normalized
            })
            return {
              ok: true,
              nextSession: {
                ...session,
                history: commitSlideAuthoringHistory(session.history, project),
              },
              historyEntry: true,
              selection: session.selection,
            }
          },
          { statusMessage: `课件已重命名为“${normalized}”` },
        )
        return
      }
      const flow = get().flowSession
      if (flow) {
        if (normalized === flow.history.present.title) return
        persistFlowResult({
          ok: true,
          nextDocument: commitSlideProjectMutation(flow.history.present, (draft) => {
            draft.title = normalized
          }),
          historyEntry: true,
          selection: flow.selection,
        }, { statusMessage: `课件已重命名为“${normalized}”` })
        return
      }
      if (normalized === get().project.title) return
      commit((draft) => {
        draft.title = normalized
      })
      set({ statusMessage: `课件已重命名为“${normalized}”` })
    },
    setEditingTextNode(editingTextNodeId) {
      if (editingTextNodeId) get().beginTextEdit(editingTextNodeId, 'canvas')
      else get().commitTextEdit()
    },
    beginTextEdit(nodeId, source = 'canvas') {
      const spatial = get().spatialSession
      if (spatial) {
        const existingSpatial = get().spatialContentEdit
        if (
          existingSpatial?.target.layerItemId === nodeId &&
          existingSpatial.source === source
        ) {
          return
        }
        if (existingSpatial) get().commitTextEdit()
        const nextSpatial = get().spatialSession
        if (!nextSpatial) return
        const begun = beginSpatialWorldContentEdit({
          session: nextSpatial,
          layerItemId: nodeId,
          source,
        })
        if (!begun.ok) {
          set({ errorMessage: begun.reason, statusMessage: null })
          return
        }
        set({
          spatialContentEdit: begun.edit,
          editingTextNodeId: source === 'canvas' && begun.edit.kind === 'text' ? nodeId : null,
          textEditSession: null,
          errorMessage: null,
          ...spatialViewState(nextSpatial, get().slideCandidateSidecar, begun.edit),
        })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const existing = get().v9ContentEdit
        if (
          existing?.target.layerItemId === nodeId &&
          existing.source === source
        ) {
          return
        }
        if (existing) get().commitTextEdit()
        const nextBackend = selectSlideAuthoringBackend(get())
        if (!nextBackend) return
        const begun = beginV9SlideContentEdit({
          backend: nextBackend,
          layerItemId: nodeId,
          source,
        })
        if (begun.ok) {
          set({
            v9ContentEdit: begun.edit,
            ...candidateViewState(nextBackend, begun.edit),
            editingTextNodeId: source === 'canvas' && begun.edit.kind === 'text' ? nodeId : null,
            textEditSession: null,
            errorMessage: null,
          })
          return
        }
        const current = get()
        const node = editingNodes(current).find((item) => item.id === nodeId)
        const scene = currentScene(current)
        if (node?.type === 'text' && scene && current.editingScope !== 'global') {
          set({
            errorMessage: null,
            editingTextNodeId: source === 'canvas' ? nodeId : null,
            textEditSession: {
              scope: current.editingScope,
              sceneId: scene.id,
              presentationStateId: current.editingScope === 'scene'
                ? current.activePresentationStateId
                : null,
              nodeId,
              source,
              original: {
                text: node.text,
                runs: structuredClone(node.runs),
                width: node.width,
                height: node.height,
              },
              dirtyBefore: current.dirty,
            },
          })
          return
        }
        set({ errorMessage: begun.reason, statusMessage: null })
        return
      }
      set((state) => {
        if (
          state.textEditSession?.nodeId === nodeId &&
          state.textEditSession.source === source
        ) {
          return state
        }
        const prepared = commitTextEditSessionState(state)
        const scene = currentScene(prepared)
        const node = editingNodes(prepared).find((item) => item.id === nodeId)
        if (!scene || node?.type !== 'text') return prepared
        return {
          ...prepared,
          editingTextNodeId: source === 'canvas' ? nodeId : null,
          textEditSession: {
            scope: prepared.editingScope,
            sceneId: scene.id,
            presentationStateId: prepared.editingScope === 'scene'
              ? prepared.activePresentationStateId
              : null,
            nodeId,
            source,
            original: {
              text: node.text,
              runs: structuredClone(node.runs),
              width: node.width,
              height: node.height,
            },
            dirtyBefore: prepared.dirty,
          },
        }
      })
    },
    updateTextEditDraft(nodeId, text, runs, height, width) {
      const state = get()
      if (state.spatialSession && state.spatialContentEdit) {
        if (state.spatialContentEdit.target.layerItemId !== nodeId) return
        if (state.spatialContentEdit.kind !== 'text') return
        const nextEdit = updateSpatialWorldContentTextDraft(state.spatialContentEdit, {
          text,
          runs,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        })
        set({
          spatialContentEdit: nextEdit,
          ...spatialViewState(
            state.spatialSession,
            state.slideCandidateSidecar,
            nextEdit,
          ),
        })
        return
      }
      if (selectSlideAuthoringBackend(state) && state.v9ContentEdit) {
        if (state.v9ContentEdit.target.layerItemId !== nodeId) return
        if (state.v9ContentEdit.kind !== 'text') return
        const nextEdit = updateV9SlideContentTextDraft(state.v9ContentEdit, {
          text,
          runs,
          ...(width !== undefined ? { width } : {}),
          ...(height !== undefined ? { height } : {}),
        })
        const backend = selectSlideAuthoringBackend(get())
        set({
          v9ContentEdit: nextEdit,
          ...(backend ? candidateViewState(backend, nextEdit) : {}),
        })
        return
      }
      set((state) => {
        const session = state.textEditSession
        if (!session || session.nodeId !== nodeId) return state
        const current = textNodeForSession(state.project, session)
        if (!current) return state
        const nextHeight = height === undefined
          ? current.height
          : Math.max(MIN_NODE_SIZE, height)
        const nextWidth = width === undefined
          ? current.width
          : Math.max(MIN_NODE_SIZE, width)
        if (
          current.text === text &&
          current.width === nextWidth &&
          current.height === nextHeight &&
          JSON.stringify(current.runs) === JSON.stringify(runs)
        ) {
          return state
        }
        const project = projectWithTextSnapshot(state.project, session, {
          text,
          runs,
          width: nextWidth,
          height: nextHeight,
        })
        if (project === state.project) return state
        return { ...state, project, dirty: true }
      })
    },
    commitTextEdit() {
      const state = get()
      if (state.spatialSession && state.spatialContentEdit) {
        persistSpatialResult(
          commitSpatialWorldContentEdit(state.spatialSession, state.spatialContentEdit),
          { clearContentEdit: true },
        )
        return
      }
      const backend = selectSlideAuthoringBackend(state)
      if (backend && state.v9ContentEdit) {
        persistCandidateResult(
          commitV9SlideContentEdit(backend.getSession(), state.v9ContentEdit),
          { clearContentEdit: true },
        )
        return
      }
      if (backend && state.textEditSession) {
        const session = state.textEditSession
        const node = textNodeForSession(state.project, session)
        if (node && node.type === 'text' && !sameTextSnapshot(node, session.original)) {
          runV9DocumentMutation((draft) => {
            const item = findMutableCourseLayerItem(draft, session.nodeId)
            if (!item) return
            applySceneNodePatchToLayerItem(item, {
              text: node.text,
              runs: node.runs,
              width: node.width,
              height: node.height,
            }, get().componentPackages)
          }, { statusMessage: '已更新文字' })
        }
        set({ editingTextNodeId: null, textEditSession: null })
        return
      }
      set((state) => commitTextEditSessionState(state))
    },
    cancelTextEdit() {
      const state = get()
      if (state.spatialSession && state.spatialContentEdit) {
        set({
          spatialContentEdit: null,
          editingTextNodeId: null,
          project: derivedV8ProjectFromSpatial(
            state.spatialSession,
            state.slideCandidateSidecar,
            null,
          ),
        })
        return
      }
      const backend = selectSlideAuthoringBackend(state)
      if (backend && state.v9ContentEdit) {
        cancelV9SlideContentEdit(backend.getSession(), state.v9ContentEdit)
        set({
          v9ContentEdit: null,
          editingTextNodeId: null,
          ...candidateViewState(backend, null),
        })
        return
      }
      set((state) => cancelTextEditSessionState(state))
    },

    addCourseContent(action, options = {}) {
      const project = selectActiveCourseProjectDocument(get())
      if (!project) return
      let result: CourseLocationCommandResult
      const expectedRevision = project.revision
      if (action === 'scene') {
        if (!options.surfaceId) {
          set({ errorMessage: '找不到当前 Slide 表面', statusMessage: null })
          return
        }
        const slideSurface = project.surfaces.find(
          (surface) => surface.id === options.surfaceId && surface.type === 'slide',
        )
        const sceneCount = slideSurface?.type === 'slide' ? slideSurface.scenes.length : 0
        if (sceneCount >= MAX_PROJECT_SCENES) {
          set({
            errorMessage: `工程已达到 ${MAX_PROJECT_SCENES} 个场景上限。请删除不需要的场景后再试。`,
            statusMessage: null,
          })
          return
        }
        result = addCourseScene(project, {
          surfaceId: options.surfaceId,
          title: `场景 ${sceneCount + 1}`,
          expectedRevision,
        })
      } else if (action === 'slide-page') {
        result = addCourseSlidePage(project, { expectedRevision })
      } else if (action === 'flow-page') {
        result = addCourseFlowPage(project, { expectedRevision })
      } else {
        result = addCourseSpatialPage(project, { expectedRevision })
      }
      if (!result.ok) {
        set({ errorMessage: result.reason, statusMessage: null })
        return
      }
      const statusMessage = action === 'scene'
        ? '已新建场景'
        : action === 'slide-page'
          ? '已新增演示页面'
          : action === 'flow-page'
            ? '已新增流式讲义'
            : '已新增无限画布'
      persistCourseProjectCommand(result, { statusMessage })
      get().activateCourseLocation(result.activatedLocationId)
    },

    reorderCourseSurfaces(surfaceIds) {
      const project = selectActiveCourseProjectDocument(get())
      if (!project) return
      persistCourseProjectCommand(applyReorderCourseSurfaces(project, surfaceIds, {
        expectedRevision: project.revision,
        activeLocationId: selectActiveCourseLocationId(get()) ?? undefined,
      }))
    },

    deleteCourseSurface(surfaceId) {
      const project = selectActiveCourseProjectDocument(get())
      if (!project) return
      const activeLocationId = selectActiveCourseLocationId(get()) ?? undefined
      const active = activeLocationId
        ? project.locations.find((location) => location.id === activeLocationId)
        : undefined
      if (active?.surfaceId === surfaceId) {
        const fallback = project.locations.find((location) => location.surfaceId !== surfaceId)
        if (fallback) get().activateCourseLocation(fallback.id)
      }
      const liveProject = selectActiveCourseProjectDocument(get()) ?? project
      const result = applyDeleteCourseSurface(liveProject, surfaceId, {
        expectedRevision: liveProject.revision,
        activeLocationId: selectActiveCourseLocationId(get()) ?? activeLocationId,
      })
      if (!result.ok) {
        set({ errorMessage: result.reason, statusMessage: null })
        return
      }
      persistCourseProjectCommand(result, { statusMessage: '已删除页面' })
      if (result.activatedLocationId) get().activateCourseLocation(result.activatedLocationId)
    },

    moveCourseSlideScene(locationId, targetSurfaceId, toIndex) {
      const project = selectActiveCourseProjectDocument(get())
      if (!project) return
      const result = applyMoveCourseSlideScene(project, locationId, targetSurfaceId, {
        expectedRevision: project.revision,
        toIndex,
        activeLocationId: selectActiveCourseLocationId(get()) ?? undefined,
      })
      if (!result.ok) {
        set({ errorMessage: result.reason, statusMessage: null })
        return
      }
      persistCourseProjectCommand(result, { statusMessage: '已调整演示页面' })
      if (result.activatedLocationId) get().activateCourseLocation(result.activatedLocationId)
    },

    addScene() {
      const project = selectActiveCourseProjectDocument(get())
      if (!project) return
      const activeLocationId = selectActiveCourseLocationId(get())
      const layout = deriveCourseEditorLayout(project, activeLocationId ?? undefined)
      if (layout.primary.action === 'scene' && layout.primary.surfaceId) {
        get().addCourseContent('scene', { surfaceId: layout.primary.surfaceId })
        return
      }
      get().addCourseContent(layout.primary.action)
    },

    activateCourseLocation(locationId) {
      const state = get()
      const project = selectActiveCourseProjectDocument(state)
      if (!project) return
      const location = project.locations.find((candidate) => candidate.id === locationId)
      if (!location) return

      const composing = Boolean(
        state.flowTextEdit?.composing ||
        state.v9ContentEdit ||
        state.spatialContentEdit ||
        state.editingTextNodeId,
      )
      if (composing) {
        set({ errorMessage: COURSE_AUTHORING_TEXT_COMPOSING_SWITCH_REASON, statusMessage: null })
        return
      }

      let nextAuthoringSession = state.courseAuthoringSession
      try {
        const surfaceType = surfaceTypeForLocation(project, locationId)
        if (nextAuthoringSession) {
          const switched = switchCourseAuthoringLocation(nextAuthoringSession, {
            locationId,
            surfaceType,
            revision: project.revision,
            composing: false,
          })
          if ('ok' in switched && switched.ok === false) {
            set({ errorMessage: switched.reason, statusMessage: null })
            return
          }
          nextAuthoringSession = switched as CourseAuthoringSession
        } else {
          nextAuthoringSession = buildCourseAuthoringSessionForProject(project, locationId)
        }
      } catch (error) {
        set({
          errorMessage: error instanceof Error ? error.message : '无法切换课程位置',
          statusMessage: null,
        })
        return
      }

      const canonicalHistory = state.spatialSession?.history
        ?? state.flowSession?.history
        ?? selectSlideAuthoringBackend(state)?.getSession().history
      if (!canonicalHistory) return
      const preserve = {
        sidecar: state.slideCandidateSidecar ?? emptyCourseAssetSidecar(),
        path: state.projectPath,
        dirty: state.dirty,
        componentPackages: state.componentPackages,
        statusMessage: null as string | null,
        resourceHistory: {
          sidecarPast: state.slideCandidateSidecarPast,
          sidecarFuture: state.slideCandidateSidecarFuture,
          componentPackagesPast: state.slideCandidateComponentPackagesPast,
          componentPackagesFuture: state.slideCandidateComponentPackagesFuture,
        },
        ...(state.canvasMode === 'run' ? { canvasMode: 'run' as const } : {}),
      }

      if (location.kind === 'flow-block') {
        if (
          state.flowSession?.selection.locationId === locationId &&
          state.editingScope !== 'global'
        ) {
          set({
            courseAuthoringSession: updateCourseAuthoringSessionItems(nextAuthoringSession, []),
            selectedNodeIds: [],
            selectedNodeId: null,
            flowTextEdit: null,
          })
          return
        }
        const fresh = openFlowAuthoringSessionAtLocation(project, locationId)
        applyFlowBackend({ ...fresh, history: canonicalHistory }, preserve)
        set({ courseAuthoringSession: nextAuthoringSession })
        return
      }

      if (location.kind === 'spatial-camera') {
        if (
          state.spatialSession?.selection.locationId === locationId &&
          state.editingScope !== 'global'
        ) {
          set({
            courseAuthoringSession: updateCourseAuthoringSessionItems(nextAuthoringSession, []),
            selectedNodeIds: [],
            selectedNodeId: null,
            spatialContentEdit: null,
            editingTextNodeId: null,
          })
          return
        }
        const fresh = openSpatialAuthoringSession(project, { locationId })
        applySpatialBackend(freezeSpatialSession({ ...fresh, history: canonicalHistory }), preserve)
        set({ courseAuthoringSession: nextAuthoringSession })
        return
      }

      if (location.kind === 'slide-scene') {
        if (state.spatialSession || state.flowSession) {
          applyV9Backend(
            createSlideAuthoringBackend({
              ...openSlideAuthoringSession(project, { locationId }),
              history: canonicalHistory,
            }),
            preserve,
          )
          set({ courseAuthoringSession: nextAuthoringSession })
          return
        }
        const backend = selectSlideAuthoringBackend(state)
        if (backend) {
          persistOpenV9ContentEdit()
          const live = selectSlideAuthoringBackend(get()) ?? backend
          persistCandidateResult(live.activateScene(location.sceneId, {
            expectedRevision: live.getSnapshot().revision,
          }), { clearContentEdit: true })
          set({
            courseAuthoringSession: updateCourseAuthoringSessionItems(nextAuthoringSession, []),
            selectedNodeIds: [],
            selectedNodeId: null,
          })
        }
      }
    },

    createLiveEditorSelectionSnapshot(focus) {
      const state = get()
      const project = selectActiveCourseProjectDocument(state)
      if (!project) return null
      const locationId = selectActiveCourseLocationId(state)
      if (!locationId) return null
      let session = state.courseAuthoringSession
      if (!session) {
        try {
          session = buildCourseAuthoringSessionForProject(
            project,
            locationId,
            collectLiveEditorItemIds(state),
          )
        } catch {
          return null
        }
      } else if (session.token.revision !== project.revision) {
        session = updateCourseAuthoringSessionRevision(session, project.revision)
      }
      const scope = state.editingScope === 'global' ? 'global' : 'location'
      const focusKind = resolveEditorFocus(state, focus)
      const itemIds = collectLiveEditorItemIds(state)
      return createEditorSelectionSnapshot(
        selectionSnapshotFromSession(
          updateCourseAuthoringSessionItems(session, itemIds),
          { scope, focus: focusKind },
        ),
      )
    },

    routeEditorAction(actionId, snapshot) {
      const live = snapshot ?? get().createLiveEditorSelectionSnapshot()
      if (!live) {
        const reason = '当前没有可路由的编辑会话'
        set({ errorMessage: reason, statusMessage: null })
        return { actionId, ok: false, reason, adapter: 'none' }
      }
      const result = routeEditorActionCore({
        actionId,
        snapshot: live,
        adapters: {
          slide: {
            execute: (id) => {
              if (id !== 'delete') {
                return { ok: false, reason: `Slide 尚未接入${id}` }
              }
              const backend = selectSlideAuthoringBackend(get())
              if (!backend) return { ok: false, reason: '当前不是 Slide 编辑会话' }
              if (live.itemIds.length === 0) {
                return { ok: false, reason: '没有可删除的选择' }
              }
              for (const nodeId of live.itemIds) {
                const row = findCandidateLayerRow(get(), nodeId)
                if (!row) continue
                persistLayerCommand(deleteEffectiveLayerItem(
                  backend.getSession().history.present,
                  commandTargetForRow(row),
                  { expectedRevision: backend.getSnapshot().revision },
                ))
              }
              return { ok: true, reason: live.scope === 'global' ? '全局元素已删除' : '节点已删除' }
            },
          },
          flow: {
            execute: (id) => {
              if (id !== 'delete') {
                return { ok: false, reason: `Flow 尚未接入${id}` }
              }
              const flow = get().flowSession
              if (!flow) return { ok: false, reason: '当前不是 Flow 编辑会话' }
              const route = resolveFlowDeleteRoute(live)
              if (route === 'document') {
                persistFlowResult(executeFlowDelete(
                  flow.history.present,
                  flow.selection,
                  { expectedRevision: flow.history.present.revision },
                ))
                return { ok: true, reason: '已删除' }
              }
              if (route === 'overlay') {
                persistFlowResult(executeFlowSharedDelete(
                  flow.history.present,
                  flow.selection,
                  { expectedRevision: flow.history.present.revision },
                ))
                return { ok: true, reason: '已删除浮层' }
              }
              return { ok: false, reason: '没有可删除的选择' }
            },
          },
          spatial: {
            execute: (id) => {
              if (id !== 'delete') {
                return { ok: false, reason: `Spatial 尚未接入${id}` }
              }
              const spatial = get().spatialSession
              if (!spatial) return { ok: false, reason: '当前不是 Spatial 编辑会话' }
              if (get().spatialContentEdit || get().editingTextNodeId) {
                return { ok: false, reason: '文字编辑中，Delete/Backspace 只编辑文本，不删除元素' }
              }
              if (live.itemIds.length === 0) {
                return { ok: false, reason: '没有可删除的选择' }
              }
              for (const nodeId of live.itemIds) {
                get().deleteNode(nodeId)
              }
              return { ok: true, reason: '节点已删除' }
            },
          },
          global: {
            execute: (id) => {
              if (id !== 'delete') {
                return { ok: false, reason: `全局层尚未接入${id}` }
              }
              const current = get()
              const flow = current.flowSession
              if (flow) {
                persistFlowResult(executeFlowSharedDelete(
                  flow.history.present,
                  flow.selection,
                  { expectedRevision: flow.history.present.revision },
                ))
                return { ok: true, reason: '已删除' }
              }
              const backend = selectSlideAuthoringBackend(current)
              if (backend && live.itemIds.length > 0) {
                for (const nodeId of live.itemIds) {
                  const row = findCandidateLayerRow(current, nodeId)
                  if (!row) continue
                  persistLayerCommand(deleteEffectiveLayerItem(
                    backend.getSession().history.present,
                    commandTargetForRow(row),
                    { expectedRevision: backend.getSnapshot().revision },
                  ))
                }
                return { ok: true, reason: '全局元素已删除' }
              }
              if (current.spatialSession) {
                for (const nodeId of [...current.selectedNodeIds]) {
                  current.deleteNode(nodeId)
                }
                return { ok: true, reason: '全局元素已删除' }
              }
              return { ok: false, reason: '没有可删除的选择' }
            },
          },
        },
      })
      if (!result.ok) {
        set({ errorMessage: result.reason, statusMessage: null })
      } else {
        set({ statusMessage: result.reason, errorMessage: null })
      }
      return result
    },

    duplicateScene(sceneId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistCandidateResult(backend.duplicateScene(sceneId, {
          expectedRevision: backend.getSnapshot().revision,
        }))
        return
      }
      if (get().project.scenes.length >= MAX_PROJECT_SCENES) {
        set({ errorMessage: `工程已达到 ${MAX_PROJECT_SCENES} 个场景上限。`, statusMessage: null })
        return
      }
      const sourceIndex = get().project.scenes.findIndex((scene) => scene.id === sceneId)
      if (sourceIndex < 0) return
      const source = get().project.scenes[sourceIndex]
      const nodeIdMap = new Map(
        source.nodes.map((node) => [node.id, `${node.type}_${nanoid()}`]),
      )
      const runtime = source.runtime
        ? structuredClone(source.runtime)
        : undefined
      if (runtime?.nodeBindings) {
        runtime.nodeBindings = Object.fromEntries(
          Object.entries(runtime.nodeBindings).map(([key, nodeId]) => [
            key,
            nodeIdMap.get(nodeId) ?? nodeId,
          ]),
        )
      }
      const copySceneId = `scene_${nanoid()}`
      const actionIdMap = new Map(
        source.interactions.flatMap((rule) => rule.actions).map((step) => [
          step.id,
          `action_${nanoid()}`,
        ]),
      )
      const copy: SceneDocument = {
        ...structuredClone(source),
        id: copySceneId,
        name: `${source.name} 副本`,
        ...(runtime ? { runtime } : {}),
        nodes: source.nodes.map((node) => ({
          ...structuredClone(node),
          id: nodeIdMap.get(node.id)!,
        })),
        presentation: rewritePresentationNodeIds(
          ensureScenePresentation(source),
          nodeIdMap,
        ),
        interactions: source.interactions.map((rule) =>
          rewriteInteractionRuleForSceneCopy(
            rule,
            nodeIdMap,
            source.id,
            copySceneId,
            actionIdMap,
          ),
        ),
      }
      commit((draft) => {
        draft.scenes.splice(sourceIndex + 1, 0, copy)
        for (const rule of draft.globalInteractions) {
          for (const condition of rule.conditions) {
            if (
              condition.type === 'scene.in' &&
              condition.sceneIds.includes(source.id) &&
              !condition.sceneIds.includes(copySceneId)
            ) {
              condition.sceneIds.push(copySceneId)
            }
          }
        }
      }, null)
      set({
        activeSceneId: copy.id,
        activePresentationStateId: null,
        editingScope: 'scene',
        statusMessage: `已复制“${source.name}”`,
      })
    },

    deleteScene(sceneId) {
      const state = get()
      const project = selectActiveCourseProjectDocument(state)
      const location = project?.locations.find((candidate) =>
        candidate.kind === 'slide-scene' &&
        candidate.sceneId === sceneId &&
        candidate.stateId === undefined,
      )
      if (project && location) {
        const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
        const lastSceneOnSurface = surface?.type === 'slide' && surface.scenes.length <= 1
        const remainingElsewhere = project.locations.some(
          (candidate) => candidate.surfaceId !== location.surfaceId,
        )
        if (lastSceneOnSurface) {
          if (!remainingElsewhere) return false
          const activeLocationId = selectActiveCourseLocationId(get())
          const active = activeLocationId
            ? project.locations.find((candidate) => candidate.id === activeLocationId)
            : undefined
          if (active?.surfaceId === location.surfaceId) {
            const fallbackLocation = project.locations.find(
              (candidate) => candidate.surfaceId !== location.surfaceId,
            )
            if (fallbackLocation) get().activateCourseLocation(fallbackLocation.id)
          }
          const liveProject = selectActiveCourseProjectDocument(get()) ?? project
          const liveLocation = liveProject.locations.find((candidate) =>
            candidate.kind === 'slide-scene' &&
            candidate.sceneId === sceneId &&
            candidate.stateId === undefined,
          )
          if (!liveLocation) return false
          const result = applyDeleteCourseLocation(liveProject, liveLocation.id, {
            expectedRevision: liveProject.revision,
            activeLocationId: selectActiveCourseLocationId(get()) ?? undefined,
          })
          if (!result.ok) {
            set({ errorMessage: result.reason, statusMessage: null })
            return false
          }
          persistCourseProjectCommand(result, { statusMessage: '场景已删除' })
          if (result.activatedLocationId) get().activateCourseLocation(result.activatedLocationId)
          return true
        }
        const backend = selectSlideAuthoringBackend(get())
        if (backend) {
          runV9DocumentMutation((draft) => {
            const removing = new Set(
              draft.locations
                .filter((candidate) => candidate.kind === 'slide-scene' && candidate.sceneId === sceneId)
                .map((candidate) => candidate.id),
            )
            const remaining = draft.locations
              .filter((candidate) => candidate.kind === 'slide-scene' && candidate.sceneId !== sceneId)
              .map((candidate) => candidate.id)
            for (const entry of draft.globalLayerItems) {
              if (entry.visibility.mode !== 'include') continue
              const nextIds = entry.visibility.locationIds.filter((id) => !removing.has(id))
              if (nextIds.length === 0 && remaining[0]) {
                entry.visibility = { mode: 'include', locationIds: [remaining[0]] }
              }
            }
          })
          const live = selectSlideAuthoringBackend(get())
          if (!live) return false
          const result = persistCandidateResult(live.deleteScene(sceneId, {
            expectedRevision: live.getSnapshot().revision,
          }))
          return result.ok
        }
      }
      if (state.project.scenes.length <= 1) return false
      const index = state.project.scenes.findIndex((scene) => scene.id === sceneId)
      if (index < 0) return false
      const fallback =
        state.project.scenes[index - 1] ?? state.project.scenes[index + 1]
      commit((draft) => {
        draft.scenes = draft.scenes.filter((scene) => scene.id !== sceneId)
        const remainingSceneIds = draft.scenes.map((scene) => scene.id)
        for (const item of draft.globalLayer) {
          item.visibility = normalizedVisibility(
            remainingSceneIds,
            {
              ...item.visibility,
              sceneIds: item.visibility.sceneIds.filter((id) => id !== sceneId),
            },
          )
        }
        for (const remainingScene of draft.scenes) {
          remainingScene.interactions = remainingScene.interactions.filter((rule) =>
            !rule.actions.some(({ action }) =>
              action.type === 'scene.go' && action.sceneId === sceneId,
            ),
          )
          remainingScene.interactions = withoutDanglingAnimationCompletionRules(
            remainingScene.interactions,
          )
        }
        draft.globalInteractions = draft.globalInteractions.filter((rule) => {
          if (rule.actions.some(({ action }) => (
            action.type === 'scene.go' && action.sceneId === sceneId
          ))) return false
          for (const condition of rule.conditions) {
            if (condition.type !== 'scene.in') continue
            condition.sceneIds = condition.sceneIds.filter((id) => id !== sceneId)
            if (condition.sceneIds.length === 0) return false
          }
          return true
        })
        draft.globalInteractions = withoutDanglingAnimationCompletionRules(
          draft.globalInteractions,
        )
        for (const item of draft.globalLayer) {
          if (item.node.type !== 'teacher-controller') continue
          item.node.buttons = item.node.buttons.filter((button) => !(
            button.action.type === 'scene.go' && button.action.sceneId === sceneId
          ))
          if (item.node.buttons.length === 0) {
            item.node.buttons.push({
              id: `teacher_button_${nanoid()}`,
              label: '下一场景',
              visible: true,
              action: { type: 'scene.next' },
            })
          }
        }
      }, null)
      if (state.activeSceneId === sceneId) {
        set({
          activeSceneId: fallback.id,
          activePresentationStateId: null,
        })
      }
      set({ statusMessage: '场景已删除' })
      return true
    },

    reorderScenes(sceneIds) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistCandidateResult(backend.reorderScenes(sceneIds, {
          expectedRevision: backend.getSnapshot().revision,
        }))
        return
      }
      const scenes = get().project.scenes
      if (!sameIds(scenes.map((scene) => scene.id), sceneIds)) return
      const byId = new Map(scenes.map((scene) => [scene.id, scene]))
      const reordered = sceneIds.map((id) => structuredClone(byId.get(id)!))
      commit((draft) => {
        draft.scenes = reordered
      })
    },

    updateScene(sceneId, patch) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        runCandidateSession((session) => {
          const current = findCourseSlideScene(session.history.present, sceneId)
          if (!current) {
            return {
              ok: false,
              reason: '找不到当前幻灯片',
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const nextName = patch.name !== undefined ? patch.name.trim() : current.name
          const nextBackground = patch.backgroundColor ?? current.backgroundColor
          const nextAsset = patch.backgroundAssetId !== undefined
            ? patch.backgroundAssetId
            : current.backgroundAssetId
          if (
            nextName === current.name &&
            nextBackground === current.backgroundColor &&
            nextAsset === current.backgroundAssetId
          ) {
            return {
              ok: true,
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            if (!scene) return
            if (nextName) scene.name = nextName
            if (patch.backgroundColor !== undefined) scene.backgroundColor = patch.backgroundColor
            if (patch.backgroundAssetId !== undefined) scene.backgroundAssetId = patch.backgroundAssetId
            draft.locations.forEach((location) => {
              if (location.kind === 'slide-scene' && location.sceneId === sceneId && location.stateId === undefined) {
                const surface = draft.surfaces.find((item) => item.id === location.surfaceId)
                location.label = `${surface?.title ?? draft.title} · ${scene.name}`
              }
            })
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        })
        return
      }
      const activeStateId = get().activeSceneId === sceneId && get().editingScope === 'scene'
        ? get().activePresentationStateId
        : null
      commit((draft) => {
        const scene = draft.scenes.find((item) => item.id === sceneId)
        if (!scene) return
        if (patch.name !== undefined && patch.name.trim()) {
          scene.name = patch.name.trim()
        }
        if (patch.backgroundColor !== undefined) {
          if (activeStateId === null) {
            scene.backgroundColor = patch.backgroundColor
          } else {
            const state = mutablePresentationState(
              scene as SceneDocument,
              activeStateId,
            )
            if (state) {
              state.backgroundColor = patch.backgroundColor === scene.backgroundColor
                ? undefined
                : patch.backgroundColor
            }
          }
        }
        if (patch.backgroundAssetId !== undefined) {
          if (activeStateId === null) {
            scene.backgroundAssetId = patch.backgroundAssetId
          } else {
            const state = mutablePresentationState(
              scene as SceneDocument,
              activeStateId,
            )
            if (state) {
              state.backgroundAssetId = patch.backgroundAssetId === scene.backgroundAssetId
                ? undefined
                : patch.backgroundAssetId
            }
          }
        }
      })
    },

    updateRuntimeSourceAtTarget(target, source) {
      return commitRuntimeSourceAtTarget(target, source)
    },

    captureRuntimeContentTextTarget(session) {
      return captureRuntimeContentTextTargetForSession(session)
    },

    updateRuntimeContentTextAtTarget(target, value) {
      return commitRuntimeContentTextAtTarget(target, value)
    },

    updateRuntimePropertyAtTarget(target, update) {
      return commitRuntimePropertyAtTarget(target, update)
    },

    createRuntimeTemplateAtTarget(target) {
      return commitRuntimeTemplateCreationAtTarget(target)
    },

    captureRuntimeAssetReplacementTarget(session) {
      return captureRuntimeAssetTarget(session)
    },

    replaceRuntimeAssetAtTarget(target, asset, bytes) {
      return commitRuntimeAssetReplacementAtTarget(target, asset, bytes)
    },

    setActiveScene(activeSceneId) {
      const spatial = get().spatialSession
      if (spatial) {
        persistSpatialResult(activateSpatialCameraFrame(spatial, activeSceneId))
        return
      }
      const flow = get().flowSession
      if (flow) {
        const document = flow.history.present
        const location = document.locations.find((candidate) => candidate.id === activeSceneId)
        if (!location || location.kind !== 'flow-block') return
        persistFlowResult({
          ok: true,
          nextDocument: document,
          historyEntry: false,
          selection: selectFlowEditorBlock(document, location.id, location.blockId),
        }, { clearTextEdit: true })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistOpenV9ContentEdit()
        const live = selectSlideAuthoringBackend(get()) ?? backend
        persistCandidateResult(live.activateScene(activeSceneId, {
          expectedRevision: live.getSnapshot().revision,
        }))
        return
      }
      const target = get().project.scenes.find((scene) => scene.id === activeSceneId)
      if (!target) return
      set((state) => ({
        ...commitTextEditSessionState(state),
        activeSceneId,
        activePresentationStateId: null,
        editingScope: 'scene',
        selectedNodeId: null,
        selectedNodeIds: [],
        editingTextNodeId: null,
        textEditSession: null,
        statusMessage: null,
      }))
    },

    setActivePresentationState(activePresentationStateId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistOpenV9ContentEdit()
        const live = selectSlideAuthoringBackend(get()) ?? backend
        persistCandidateResult(live.activateState(activePresentationStateId, {
          expectedRevision: live.getSnapshot().revision,
        }))
        return
      }
      const scene = currentScene(get())
      if (!scene || (
        activePresentationStateId !== null &&
        !ensureScenePresentation(scene).states.some(
          (state) => state.id === activePresentationStateId,
        )
      )) return
      set((state) => ({
        ...commitTextEditSessionState(state),
        activePresentationStateId,
        editingScope: 'scene',
        canvasMode: state.canvasMode,
        selectedNodeId: null,
        selectedNodeIds: [],
        editingTextNodeId: null,
        textEditSession: null,
        statusMessage: activePresentationStateId === null
          ? '正在编辑场景基础（会影响所有状态）'
          : `正在编辑状态“${findPresentationState(scene, activePresentationStateId)?.name ?? activePresentationStateId}”`,
      }))
    },

    addPresentationState(name) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const scene = currentScene(get())
        if (!scene) return
        if (ensureScenePresentation(scene).states.length >= MAX_SCENE_PRESENTATION_STATES) {
          set({ errorMessage: `当前场景已达到 ${MAX_SCENE_PRESENTATION_STATES} 个状态上限。` })
          return
        }
        const nextName = name?.trim() || `状态 ${ensureScenePresentation(scene).states.length + 1}`
        persistCandidateResult(backend.addState(nextName, {
          expectedRevision: backend.getSnapshot().revision,
        }), { statusMessage: `已新增状态“${nextName}”` })
        return
      }
      const state = get()
      const scene = currentScene(state)
      if (!scene) return
      if (ensureScenePresentation(scene).states.length >= MAX_SCENE_PRESENTATION_STATES) {
        set({ errorMessage: `当前场景已达到 ${MAX_SCENE_PRESENTATION_STATES} 个状态上限。` })
        return
      }
      const stateId = `state_${nanoid()}`
      const nextName = name?.trim() || `状态 ${ensureScenePresentation(scene).states.length + 1}`
      commit((draft) => {
        const draftScene = draft.scenes.find((item) => item.id === scene.id)
        if (!draftScene) return
        mutablePresentation(draftScene as SceneDocument).states.push({
          id: stateId,
          name: nextName,
          nodeOverrides: {},
        })
      }, null)
      set({
        activePresentationStateId: stateId,
        editingScope: 'scene',
        canvasMode: 'edit',
        statusMessage: `已新增状态“${nextName}”`,
      })
    },

    duplicatePresentationState(stateId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const scene = currentScene(get())
        const source = scene && findPresentationState(scene, stateId)
        if (!scene || !source) return
        if (ensureScenePresentation(scene).states.length >= MAX_SCENE_PRESENTATION_STATES) {
          set({ errorMessage: `当前场景已达到 ${MAX_SCENE_PRESENTATION_STATES} 个状态上限。` })
          return
        }
        persistCandidateResult(backend.duplicateState(stateId, {
          expectedRevision: backend.getSnapshot().revision,
        }), { statusMessage: `已复制状态“${source.name}”` })
        return
      }
      const scene = currentScene(get())
      const source = scene && findPresentationState(scene, stateId)
      if (!scene || !source) return
      if (ensureScenePresentation(scene).states.length >= MAX_SCENE_PRESENTATION_STATES) {
        set({ errorMessage: `当前场景已达到 ${MAX_SCENE_PRESENTATION_STATES} 个状态上限。` })
        return
      }
      const copyId = `state_${nanoid()}`
      const copyName = `${source.name} 副本`
      commit((draft) => {
        const draftScene = draft.scenes.find((item) => item.id === scene.id)
        if (!draftScene) return
        const presentation = mutablePresentation(draftScene as SceneDocument)
        const index = presentation.states.findIndex((item) => item.id === stateId)
        presentation.states.splice(index + 1, 0, {
          ...structuredClone(source),
          id: copyId,
          name: copyName,
        })
      }, null)
      set({
        activePresentationStateId: copyId,
        editingScope: 'scene',
        canvasMode: 'edit',
        statusMessage: `已复制状态“${source.name}”`,
      })
    },

    renamePresentationState(stateId, name) {
      const nextName = name.trim()
      if (!nextName) return
      get().updatePresentationState(stateId, { name: nextName })
    },

    deletePresentationState(stateId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const scene = currentScene(get())
        const presentation = scene && ensureScenePresentation(scene)
        if (!scene || !presentation || presentation.states.length <= 1) return false
        if (!presentation.states.some((state) => state.id === stateId)) return false
        const result = persistCandidateResult(backend.deleteState(stateId, {
          expectedRevision: backend.getSnapshot().revision,
        }), { statusMessage: '状态已删除' })
        return result.ok
      }
      const scene = currentScene(get())
      const presentation = scene && ensureScenePresentation(scene)
      if (!scene || !presentation || presentation.states.length <= 1) return false
      if (!presentation.states.some((state) => state.id === stateId)) return false
      const fallback = presentation.states.find((state) => state.id !== stateId)!
      const fallbackId = presentation.initialStateId === stateId
        ? fallback.id
        : presentation.initialStateId
      commit((draft) => {
        const draftScene = draft.scenes.find((item) => item.id === scene.id)
        if (!draftScene) return
        const draftPresentation = mutablePresentation(draftScene as SceneDocument)
        draftPresentation.states = draftPresentation.states.filter(
          (state) => state.id !== stateId,
        )
        if (draftPresentation.initialStateId === stateId) {
          draftPresentation.initialStateId = fallback.id
        }
        if (draftPresentation.thumbnailStateId === stateId) {
          draftPresentation.thumbnailStateId = draftPresentation.initialStateId
        }
        draftScene.interactions = draftScene.interactions.filter((rule) => {
          if (rule.trigger.type === 'presentation.enter' && rule.trigger.stateId === stateId) return false
          if (rule.conditions.some((condition) =>
            condition.type === 'presentation.in' && condition.stateIds.includes(stateId),
          )) return false
          return !rule.actions.some(({ action }) =>
            action.type === 'presentation.set' && action.stateId === stateId,
          )
        })
        draftScene.interactions = withoutDanglingAnimationCompletionRules(
          draftScene.interactions,
        )
        // Cross-scene entry rules remain useful after the state is removed.
        // Drop only the stale optional state target so they safely enter the
        // destination scene's (possibly newly selected) initial state.
        for (const projectScene of draft.scenes) {
          for (const rule of projectScene.interactions) {
            for (const step of rule.actions) {
              const action = step.action
              if (
                action.type === 'scene.go' &&
                action.sceneId === scene.id &&
                action.targetStateId === stateId
              ) {
                delete action.targetStateId
              }
            }
          }
        }
        for (const rule of draft.globalInteractions) {
          for (const step of rule.actions) {
            const action = step.action
            if (
              action.type === 'scene.go' &&
              action.sceneId === scene.id &&
              action.targetStateId === stateId
            ) {
              delete action.targetStateId
            }
          }
        }
        for (const item of draft.globalLayer) {
          if (item.node.type !== 'teacher-controller') continue
          item.node.buttons = item.node.buttons.map((button) => {
            if (
              button.action.type !== 'scene.go' ||
              button.action.sceneId !== scene.id ||
              button.action.targetStateId !== stateId
            ) return button
            const { targetStateId: _removed, ...action } = button.action
            return { ...button, action }
          })
        }
      }, null)
      if (get().activePresentationStateId === stateId) {
        set({ activePresentationStateId: fallbackId })
      }
      set({ statusMessage: '状态已删除' })
      return true
    },

    setInitialPresentationState(stateId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const sceneId = backend.getSnapshot().sceneId
        runCandidateSession((session) => {
          const current = findCourseSlideScene(session.history.present, sceneId)
          if (!current?.presentation?.states.some((item) => item.id === stateId)) {
            return {
              ok: false,
              reason: '找不到当前状态',
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            if (scene?.presentation) scene.presentation.initialStateId = stateId
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: '已设为运行时初始状态' })
        return
      }
      const scene = currentScene(get())
      if (!scene || !findPresentationState(scene, stateId)) return
      commit((draft) => {
        const target = draft.scenes.find((item) => item.id === scene.id)
        if (target) mutablePresentation(target as SceneDocument).initialStateId = stateId
      })
      set({ statusMessage: '已设为运行时初始状态' })
    },

    setThumbnailPresentationState(stateId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const sceneId = backend.getSnapshot().sceneId
        runCandidateSession((session) => {
          const current = findCourseSlideScene(session.history.present, sceneId)
          if (!current?.presentation?.states.some((item) => item.id === stateId)) {
            return {
              ok: false,
              reason: '找不到当前状态',
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            if (scene?.presentation) scene.presentation.thumbnailStateId = stateId
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: '已设为场景缩略图状态' })
        return
      }
      const scene = currentScene(get())
      if (!scene || !findPresentationState(scene, stateId)) return
      commit((draft) => {
        const target = draft.scenes.find((item) => item.id === scene.id)
        if (target) mutablePresentation(target as SceneDocument).thumbnailStateId = stateId
      })
      set({ statusMessage: '已设为场景缩略图状态' })
    },

    updatePresentationState(stateId, patch) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        if (patch.name !== undefined) {
          persistCandidateResult(backend.renameState(stateId, patch.name, {
            expectedRevision: backend.getSnapshot().revision,
          }))
        }
        const remaining = patch.description !== undefined
          || patch.backgroundColor !== undefined
          || patch.backgroundAssetId !== undefined
        if (!remaining) return
        const sceneId = backend.getSnapshot().sceneId
        runCandidateSession((session) => {
          const current = findCourseSlideScene(session.history.present, sceneId)
          if (!current?.presentation?.states.some((item) => item.id === stateId)) {
            return {
              ok: false,
              reason: '找不到当前状态',
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            const state = scene?.presentation?.states.find((item) => item.id === stateId)
            if (!scene || !state) return
            if (patch.description !== undefined) {
              state.description = patch.description.trim() || undefined
            }
            if (patch.backgroundColor !== undefined) {
              state.backgroundColor = patch.backgroundColor === scene.backgroundColor
                ? undefined
                : patch.backgroundColor
            }
            if (patch.backgroundAssetId !== undefined) {
              state.backgroundAssetId = patch.backgroundAssetId === scene.backgroundAssetId
                ? undefined
                : patch.backgroundAssetId
            }
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        })
        return
      }
      const scene = currentScene(get())
      if (!scene || !findPresentationState(scene, stateId)) return
      commit((draft) => {
        const target = draft.scenes.find((item) => item.id === scene.id)
        const state = target && mutablePresentationState(
          target as SceneDocument,
          stateId,
        )
        if (!state) return
        if (patch.name !== undefined && patch.name.trim()) state.name = patch.name.trim()
        if (patch.description !== undefined) {
          state.description = patch.description.trim() || undefined
        }
        if (patch.backgroundColor !== undefined) {
          state.backgroundColor = patch.backgroundColor === target.backgroundColor
            ? undefined
            : patch.backgroundColor
        }
        if (patch.backgroundAssetId !== undefined) {
          state.backgroundAssetId = patch.backgroundAssetId === target.backgroundAssetId
            ? undefined
            : patch.backgroundAssetId
        }
      })
    },

    clearNodePresentationOverride(nodeId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const stateId = get().activePresentationStateId
        const scene = currentScene(get())
        if (!scene || stateId === null || !isNodeOverriddenInState(scene, stateId, nodeId)) return
        const sceneId = backend.getSnapshot().sceneId
        runCandidateSession((session) => {
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const target = findCourseSlideScene(draft, sceneId)
            const state = target?.presentation?.states.find((item) => item.id === stateId)
            if (state) delete state.layerItemOverrides[nodeId]
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: '已恢复此元素在当前状态中的基础值' })
        return
      }
      const state = get()
      const scene = currentScene(state)
      const stateId = state.activePresentationStateId
      if (!scene || stateId === null || !isNodeOverriddenInState(scene, stateId, nodeId)) return
      commit((draft) => {
        const target = draft.scenes.find((item) => item.id === scene.id)
        if (target) setPresentationNodeOverride(target as SceneDocument, stateId, nodeId, undefined)
      })
      set({ statusMessage: '已恢复此元素在当前状态中的基础值' })
    },

    clearPresentationStateOverrides(stateId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const scene = currentScene(get())
        if (!scene || !findPresentationState(scene, stateId)) return
        const sceneId = backend.getSnapshot().sceneId
        runCandidateSession((session) => {
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const target = findCourseSlideScene(draft, sceneId)
            const state = target?.presentation?.states.find((item) => item.id === stateId)
            if (!state) return
            state.layerItemOverrides = {}
            state.layerItemOrder = undefined
            state.backgroundColor = undefined
            state.backgroundAssetId = undefined
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: '当前状态已恢复为基础场景' })
        return
      }
      const scene = currentScene(get())
      if (!scene || !findPresentationState(scene, stateId)) return
      commit((draft) => {
        const target = draft.scenes.find((item) => item.id === scene.id)
        const state = target && mutablePresentationState(target as SceneDocument, stateId)
        if (!state) return
        state.nodeOverrides = {}
        state.nodeOrder = undefined
        state.backgroundColor = undefined
        state.backgroundAssetId = undefined
      }, null)
      set({ statusMessage: '当前状态已恢复为基础场景' })
    },

    addTextNode(x, y) {
      const spatial = get().spatialSession
      if (spatial) {
        persistSpatialResult(addSpatialWorldTextLayer(spatial, {
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: spatial.history.present.revision }), {
          statusMessage: '已添加文本',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const document = flow.history.present
        const surface = flowSurfaceIn(document, flow.selection.surfaceId)
        const found = flow.selection.selectedBlockId
          ? findFlowBlockRecursive(surface.blocks, flow.selection.selectedBlockId)
          : null
        const inserted = insertFlowEditorBlock(document, {
          surfaceId: flow.selection.surfaceId,
          parentId: found?.parentId ?? null,
          index: found ? found.index + 1 : surface.blocks.length,
          block: { type: 'paragraph', text: '' },
        }, { expectedRevision: document.revision })
        const createdId = inserted.createdBlockIds?.[0]
        persistFlowResult(inserted, {
          statusMessage: '已插入段落',
          ...(inserted.ok && inserted.nextDocument && createdId
            ? {
                selection: selectFlowEditorBlocks(
                  inserted.nextDocument,
                  flow.selection.locationId,
                  [createdId],
                ),
              }
            : {}),
        })
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        if (!canAddNode()) return
        const state = get()
        const node = normalizeNewNodeGeometry(
          offsetDefaultInsertion(
            createTextNode(x, y),
            editingNodes(state).length,
            x !== undefined || y !== undefined,
          ),
          state.componentPackages,
        )
        if (node.type !== 'text') return
        if (appendV9GlobalNode(node, { statusMessage: '已添加全局文本' })) return
        runCandidateSession(
          (session) => addSlideTextLayer(session, {
            id: node.id,
            x: node.x,
            y: node.y,
            text: node.text,
            label: node.name,
          }, {
            expectedRevision: session.history.present.revision,
          }),
          { statusMessage: '已添加文本' },
        )
        return
      }
      if (!canAddNode()) return
      const state = get()
      const node = normalizeNewNodeGeometry(
        offsetDefaultInsertion(
          createTextNode(x, y),
          editingNodes(state).length,
          x !== undefined || y !== undefined,
        ),
        state.componentPackages,
      )
      appendNodeToEditingScope(node)
      set({
        statusMessage: get().editingScope === 'global'
          ? '已添加全局文本'
          : '已添加文本',
      })
    },

    addFormulaNode(x, y) {
      const spatial = get().spatialSession
      if (spatial) {
        persistSpatialResult(addSpatialWorldFormulaLayer(spatial, {
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: spatial.history.present.revision }), {
          statusMessage: '已添加公式',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const document = flow.history.present
        const surface = flowSurfaceIn(document, flow.selection.surfaceId)
        const found = flow.selection.selectedBlockId
          ? findFlowBlockRecursive(surface.blocks, flow.selection.selectedBlockId)
          : null
        persistFlowResult(insertFlowEditorBlock(document, {
          surfaceId: flow.selection.surfaceId,
          parentId: found?.parentId ?? null,
          index: found ? found.index + 1 : surface.blocks.length,
          block: {
            type: 'formula',
            formulaId: `formula-${nanoid(8)}`,
            accessibleText: 'x',
            ast: { type: 'token', value: 'x' },
          },
        }, { expectedRevision: document.revision }), {
          statusMessage: '已插入公式',
        })
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        if (!canAddNode()) return
        const state = get()
        const node = normalizeNewNodeGeometry(
          offsetDefaultInsertion(
            createFormulaNode(x, y),
            editingNodes(state).length,
            x !== undefined || y !== undefined,
          ),
          state.componentPackages,
        )
        if (appendV9GlobalNode(node, {
          statusMessage: '已添加全局公式',
        })) return
        runCandidateSession(
          (session) => addSlideFormulaLayer(session, {
            id: node.id,
            x: node.x,
            y: node.y,
            label: node.name,
          }, {
            expectedRevision: session.history.present.revision,
          }),
          {
            statusMessage: get().editingScope === 'global' ? '已添加全局公式' : '已添加公式',
          },
        )
        return
      }
      if (!canAddNode()) return
      const state = get()
      const node = normalizeNewNodeGeometry(
        offsetDefaultInsertion(
          createFormulaNode(x, y),
          editingNodes(state).length,
          x !== undefined || y !== undefined,
        ),
        state.componentPackages,
      )
      appendNodeToEditingScope(node)
      set({
        statusMessage: get().editingScope === 'global'
          ? '已添加全局公式'
          : '已添加公式',
      })
    },

    addRectangleNode(x, y) {
      get().addShapeNode('rectangle', x, y)
    },

    addShapeNode(shapeType, x, y) {
      const spatial = get().spatialSession
      if (spatial) {
        persistSpatialResult(addSpatialWorldShapeLayer(spatial, {
          shapeType,
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: spatial.history.present.revision }), {
          statusMessage: `已添加“${shapeType}”`,
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        persistFlowResult(insertFlowSharedShape(flow.history.present, flow.selection, {
          shapeType,
        }, { expectedRevision: flow.history.present.revision }), {
          statusMessage: `已作为页面浮层添加图形`,
        })
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        if (!canAddNode()) return
        const state = get()
        const node = normalizeNewNodeGeometry(
          offsetDefaultInsertion(
            createShapeNode(shapeType, { x, y }),
            editingNodes(state).length,
            x !== undefined || y !== undefined,
          ),
          state.componentPackages,
        )
        if (appendV9GlobalNode(node, {
          statusMessage: `已添加全局“${node.name}”`,
        })) return
        runCandidateSession(
          (session) => addSlideShapeLayer(session, {
            shapeType,
            id: node.id,
            x: node.x,
            y: node.y,
            label: node.name,
          }, {
            expectedRevision: session.history.present.revision,
          }),
          {
            statusMessage: get().editingScope === 'global'
              ? `已添加全局“${node.name}”`
              : `已添加“${node.name}”`,
          },
        )
        return
      }
      if (!canAddNode()) return
      const state = get()
      const node = normalizeNewNodeGeometry(
        offsetDefaultInsertion(
          createShapeNode(shapeType, { x, y }),
          editingNodes(state).length,
          x !== undefined || y !== undefined,
        ),
        state.componentPackages,
      )
      appendNodeToEditingScope(node)
      set({
        statusMessage: get().editingScope === 'global'
          ? `已添加全局“${node.name}”`
          : `已添加“${node.name}”`,
      })
    },

    addImageNode(asset, bytes, x, y) {
      const spatial = get().spatialSession
      if (spatial) {
        const sidecar = get().slideCandidateSidecar ?? emptyCourseAssetSidecar()
        const files = { ...sidecar.files, [asset.id]: bytes.slice() }
        const present = spatial.history.present
        const withAsset = present.assets[asset.id]
          ? spatial
          : {
              ...spatial,
              history: {
                ...spatial.history,
                present: {
                  ...present,
                  assets: { ...present.assets, [asset.id]: structuredClone(asset) },
                },
              },
            }
        persistSpatialResult(addSpatialWorldImageLayer(withAsset, {
          assetId: asset.id,
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: present.revision }), {
          sidecar: freezeCourseAssetSidecar(files),
          statusMessage: '已添加图片',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const sidecar = get().slideCandidateSidecar ?? emptyCourseAssetSidecar()
        const files = { ...sidecar.files, [asset.id]: bytes.slice() }
        const prepared = documentWithFlowAsset(flow.history.present, asset)
        persistFlowResult(insertFlowSharedMedia(prepared, flow.selection, {
          assetId: asset.id,
        }, { expectedRevision: flow.history.present.revision }), {
          sidecar: freezeCourseAssetSidecar(files),
          statusMessage: '已插入文中图片',
        })
        return
      }
      const media = currentMediaSession()
      if (media) {
        if (get().editingScope === 'global') {
          if (!canAddNode()) return
          const initialState = get()
          const node = normalizeNewNodeGeometry(
            offsetDefaultInsertion(
              createImageNode(asset.id, asset.width, asset.height, x, y),
              editingNodes(initialState).length,
              x !== undefined || y !== undefined,
            ),
            initialState.componentPackages,
          )
          const sidecar = freezeCourseAssetSidecar({
            ...(get().slideCandidateSidecar?.files ?? {}),
            [asset.id]: bytes.slice(),
          })
          runV9DocumentMutation((draft) => {
            if (!draft.assets[asset.id]) draft.assets[asset.id] = structuredClone(asset)
            appendGlobalCourseNode(draft, node)
          }, {
            sidecar,
            statusMessage: '图片已添加到全局层',
            selectionIds: [node.id],
            scope: 'global',
          })
          return
        }
        const present = media.session.history.present
        if (present.assets[asset.id]) {
          persistMediaResult(addCourseLibraryMediaToCanvas(media, asset.id, {
            ...(typeof x === 'number' ? { x } : {}),
            ...(typeof y === 'number' ? { y } : {}),
          }, { expectedRevision: present.revision }))
          return
        }
        persistMediaResult(importAndPlaceCourseMedia(media, {
          items: [{ meta: asset, bytes }],
          nativeType: 'image',
          mode: 'add',
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: present.revision }))
        return
      }
      if (!canAddNode()) return
      const initialState = get()
      const node = normalizeNewNodeGeometry(
        offsetDefaultInsertion(
          createImageNode(asset.id, asset.width, asset.height, x, y),
          editingNodes(initialState).length,
          x !== undefined || y !== undefined,
        ),
        initialState.componentPackages,
      )
      const sceneId = initialState.activeSceneId
      commitAssetBatch([{ meta: asset, bytes }], (draft) => {
        if (initialState.editingScope === 'global') {
          draft.globalLayer.push({
            node,
            layer: 'overlay',
            visibility: { mode: 'all', sceneIds: [] },
          })
        } else {
          const scene = draft.scenes.find((item) => item.id === sceneId)
          if (scene) appendNodesToScene(
            scene as SceneDocument,
            [node],
            initialState.activePresentationStateId,
          )
        }
      }, [node.id], initialState.editingScope === 'global'
        ? '图片已添加到全局层'
        : '图片已添加到画布')
    },

    addVideoNode(asset, bytes, x, y) {
      const spatial = get().spatialSession
      if (spatial) {
        const sidecar = get().slideCandidateSidecar ?? emptyCourseAssetSidecar()
        const files = { ...sidecar.files, [asset.id]: bytes.slice() }
        persistSpatialResult(addSpatialWorldVideoLayer(spatial, {
          assetId: asset.id,
          asset,
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: spatial.history.present.revision }), {
          sidecar: freezeCourseAssetSidecar(files),
          statusMessage: '已添加视频',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const sidecar = get().slideCandidateSidecar ?? emptyCourseAssetSidecar()
        const files = { ...sidecar.files, [asset.id]: bytes.slice() }
        const prepared = documentWithFlowAsset(flow.history.present, asset)
        persistFlowResult(insertFlowSharedMedia(prepared, flow.selection, {
          assetId: asset.id,
        }, { expectedRevision: flow.history.present.revision }), {
          sidecar: freezeCourseAssetSidecar(files),
          statusMessage: '已插入文中视频',
        })
        return
      }
      const media = currentMediaSession()
      if (media) {
        if (get().editingScope === 'global') {
          if (!canAddNode()) return
          const initialState = get()
          const node = normalizeNewNodeGeometry(
            offsetDefaultInsertion(
              createVideoNode({
                assetId: asset.id,
                width: asset.width ?? 640,
                height: asset.height ?? 360,
                x,
                y,
              }),
              editingNodes(initialState).length,
              x !== undefined || y !== undefined,
            ),
            initialState.componentPackages,
          )
          const sidecar = freezeCourseAssetSidecar({
            ...(get().slideCandidateSidecar?.files ?? {}),
            [asset.id]: bytes.slice(),
          })
          runV9DocumentMutation((draft) => {
            if (!draft.assets[asset.id]) draft.assets[asset.id] = structuredClone(asset)
            appendGlobalCourseNode(draft, node)
          }, {
            sidecar,
            statusMessage: '视频已添加到全局层',
            selectionIds: [node.id],
            scope: 'global',
          })
          return
        }
        const present = media.session.history.present
        if (present.assets[asset.id]) {
          persistMediaResult(addCourseLibraryMediaToCanvas(media, asset.id, {
            ...(typeof x === 'number' ? { x } : {}),
            ...(typeof y === 'number' ? { y } : {}),
          }, { expectedRevision: present.revision }))
          return
        }
        persistMediaResult(importAndPlaceCourseMedia(media, {
          items: [{ meta: asset, bytes }],
          nativeType: 'video',
          mode: 'add',
          ...(typeof x === 'number' ? { x } : {}),
          ...(typeof y === 'number' ? { y } : {}),
        }, { expectedRevision: present.revision }))
        return
      }
      if (!canAddNode()) return
      const initialState = get()
      const node = normalizeNewNodeGeometry(
        offsetDefaultInsertion(
          createVideoNode({
            assetId: asset.id,
            width: asset.width ?? 640,
            height: asset.height ?? 360,
            x,
            y,
          }),
          editingNodes(initialState).length,
          x !== undefined || y !== undefined,
        ),
        initialState.componentPackages,
      )
      const sceneId = initialState.activeSceneId
      commitAssetBatch([{ meta: asset, bytes }], (draft) => {
        if (initialState.editingScope === 'global') {
          draft.globalLayer.push({
            node,
            layer: 'overlay',
            visibility: { mode: 'all', sceneIds: [] },
          })
        } else {
          const scene = draft.scenes.find((item) => item.id === sceneId)
          if (scene) appendNodesToScene(
            scene as SceneDocument,
            [node],
            initialState.activePresentationStateId,
          )
        }
      }, [node.id], initialState.editingScope === 'global'
        ? '视频已添加到全局层'
        : '视频已添加到画布')
    },

    addImageNodes(items, position) {
      if (get().spatialSession || get().flowSession) {
        for (const item of items) {
          get().addImageNode(item.meta, item.bytes, position?.x, position?.y)
        }
        return items.map((item) => item.meta.id)
      }
      const media = currentMediaSession()
      if (media) {
        const result = persistMediaResult(importAndPlaceCourseMedia(media, {
          items: items.map((item) => ({ meta: item.meta, bytes: item.bytes })),
          nativeType: 'image',
          mode: 'add',
          ...(typeof position?.x === 'number' ? { x: position.x } : {}),
          ...(typeof position?.y === 'number' ? { y: position.y } : {}),
        }, { expectedRevision: media.session.history.present.revision }))
        return [...(result.placedLayerItemIds ?? [])]
      }
      if (items.length === 0 || !canAddNodes(items.length)) return []
      if (items.length > MAX_BATCH_CANVAS_ITEMS) {
        set({
          errorMessage: `一次最多在画布排放 ${MAX_BATCH_CANVAS_ITEMS} 张图片。请先批量加入媒体库，再按需放置。`,
          statusMessage: null,
        })
        return []
      }
      const state = get()
      let nodes = items.map(({ meta }) => createImageNode(
        meta.id,
        meta.width,
        meta.height,
        items.length === 1 ? position?.x : undefined,
        items.length === 1 ? position?.y : undefined,
      ))
      nodes = layoutMediaBatchNodes(nodes).map((node) =>
        normalizeNewNodeGeometry(node, state.componentPackages),
      ) as typeof nodes
      const sceneId = state.activeSceneId
      commitAssetBatch(items, (draft) => {
        if (state.editingScope === 'global') {
          draft.globalLayer.push(...nodes.map((node) => ({
            node,
            layer: 'overlay' as const,
            visibility: { mode: 'all' as const, sceneIds: [] },
          })))
        } else {
          const scene = draft.scenes.find((item) => item.id === sceneId)
          if (scene) {
            appendNodesToScene(
              scene as SceneDocument,
              nodes,
              state.activePresentationStateId,
            )
          }
        }
      }, nodes.map((node) => node.id), `已批量添加 ${nodes.length} 张图片`)
      return nodes.map((node) => node.id)
    },

    addVideoNodes(items, position) {
      if (get().spatialSession || get().flowSession) {
        for (const item of items) {
          get().addVideoNode(item.meta, item.bytes, position?.x, position?.y)
        }
        return items.map((item) => item.meta.id)
      }
      const media = currentMediaSession()
      if (media) {
        const result = persistMediaResult(importAndPlaceCourseMedia(media, {
          items: items.map((item) => ({ meta: item.meta, bytes: item.bytes })),
          nativeType: 'video',
          mode: 'add',
          ...(typeof position?.x === 'number' ? { x: position.x } : {}),
          ...(typeof position?.y === 'number' ? { y: position.y } : {}),
        }, { expectedRevision: media.session.history.present.revision }))
        return [...(result.placedLayerItemIds ?? [])]
      }
      if (items.length === 0 || !canAddNodes(items.length)) return []
      if (items.length > MAX_BATCH_CANVAS_ITEMS) {
        set({
          errorMessage: `一次最多在画布排放 ${MAX_BATCH_CANVAS_ITEMS} 个视频。请先批量加入媒体库，再按需放置。`,
          statusMessage: null,
        })
        return []
      }
      const state = get()
      let nodes = items.map(({ meta }) => createVideoNode({
        assetId: meta.id,
        width: meta.width ?? 640,
        height: meta.height ?? 360,
        x: items.length === 1 ? position?.x : undefined,
        y: items.length === 1 ? position?.y : undefined,
      }))
      nodes = layoutMediaBatchNodes(nodes).map((node) =>
        normalizeNewNodeGeometry(node, state.componentPackages),
      ) as typeof nodes
      const sceneId = state.activeSceneId
      commitAssetBatch(items, (draft) => {
        if (state.editingScope === 'global') {
          draft.globalLayer.push(...nodes.map((node) => ({
            node,
            layer: 'overlay' as const,
            visibility: { mode: 'all' as const, sceneIds: [] },
          })))
        } else {
          const scene = draft.scenes.find((item) => item.id === sceneId)
          if (scene) {
            appendNodesToScene(
              scene as SceneDocument,
              nodes,
              state.activePresentationStateId,
            )
          }
        }
      }, nodes.map((node) => node.id), `已批量添加 ${nodes.length} 个视频`)
      return nodes.map((node) => node.id)
    },

    importAsset(asset, bytes) {
      const target = captureCourseProjectRevisionTarget()
      if (!target) return
      const result = commitMediaLibraryImportAtTarget(target, [{ meta: asset, bytes }])
      if (!result.ok) set({ errorMessage: result.reason, statusMessage: null })
    },

    importAssets(items) {
      const capacityError =
        `当前场景已达到或将超过 ${MAX_SCENE_NODES} 个节点上限。请删除不需要的节点，或新建场景后继续。`
      const keepCapacityError = get().errorMessage === capacityError
      const target = captureCourseProjectRevisionTarget()
      if (!target) return
      const result = commitMediaLibraryImportAtTarget(target, items)
      if (!result.ok) set({ errorMessage: result.reason, statusMessage: null })
      else if (keepCapacityError) {
        set({ errorMessage: capacityError, statusMessage: null, activeTab: 'elements' })
      }
    },

    captureMediaLibraryImportTarget() {
      return captureCourseProjectRevisionTarget()
    },

    importAssetsAtTarget(target, items) {
      return commitMediaLibraryImportAtTarget(target, items)
    },

    captureImageReplacementTarget() {
      const state = get()
      const backend = selectSlideAuthoringBackend(state)
      const selectedId = backend?.getSession().selection.selectionIds.at(-1)
      if (!backend || state.flowSession || state.spatialSession || !selectedId) return null
      const slideSession = backend.getSession()
      const document = slideSession.history.present
      const projection = buildCandidateEffectiveLayers(state)
      const row = projection?.unifiedRows.find((candidate) => candidate.id === selectedId)
      if (
        !projection ||
        projection.surfaceType !== 'slide' ||
        projection.scope.owner !== 'scene' ||
        !row ||
        row.owner !== 'scene' ||
        row.ownerKey !== projection.scope.ownerKey ||
        row.item.kind !== 'native' ||
        row.item.content.nativeType !== 'image'
      ) {
        return null
      }
      let authoringSession = state.courseAuthoringSession
      if (!authoringSession) return null
      if (
        authoringSession.token.locationId !== projection.locationId ||
        authoringSession.token.surfaceType !== 'slide'
      ) {
        return null
      }
      authoringSession = updateCourseAuthoringSessionRevision(
        authoringSession,
        document.revision,
      )
      return captureCourseAuthoringTarget({
        sessionToken: authoringSession.token,
        projectId: projection.projectId,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: row.owner,
        ownerKey: row.ownerKey,
        itemId: row.id,
        authoringAddress: row.authoringAddress,
      })
    },

    replaceImageAssetAtTarget(target, asset, bytes) {
      const state = get()
      const backend = selectSlideAuthoringBackend(state)
      const activeProject = selectActiveCourseProjectDocument(state)
      const reject = (
        code: CourseImageReplacementPlanFailureCode,
        reason?: string,
      ): ImageReplacementCommitResult => ({
        ok: false,
        code,
        reason: reason ?? COURSE_AUTHORING_TARGET_REJECTION_REASONS[
          code as keyof typeof COURSE_AUTHORING_TARGET_REJECTION_REASONS
        ] ?? '图片替换目标已失效，请重新选择后再试',
      })
      if (!activeProject || activeProject.id !== target.projectId) {
        return reject('project-mismatch')
      }
      if (!state.courseAuthoringSession) return reject('session-stale')
      if (!backend) {
        return reject(
          state.courseAuthoringSession.token.generation === target.sessionGeneration
            ? 'surface-or-location'
            : 'session-stale',
        )
      }
      const session = backend.getSession()
      const document = session.history.present
      const projection = buildCandidateEffectiveLayers(state)
      if (!projection) return reject('surface-or-location')
      let authoringSession = state.courseAuthoringSession
      if (!authoringSession) return reject('session-stale')
      authoringSession = updateCourseAuthoringSessionRevision(
        authoringSession,
        document.revision,
      )
      const currentIdentity: CurrentCourseAuthoringTargetIdentity = {
        projectId: document.id,
        documentRevision: document.revision,
        sessionToken: authoringSession.token,
        surfaceId: projection.surfaceId,
        stateId: projection.stateId,
        owner: projection.scope.owner,
        ownerKey: projection.scope.ownerKey,
      }
      const planned = planCourseImageReplacement({
        project: document,
        sidecar: state.slideCandidateSidecar ?? emptyCourseAssetSidecar(),
        currentIdentity,
        target,
        asset,
        bytes,
        now: new Date().toISOString(),
      })
      if (!planned.ok) return planned
      if (planned.status === 'no-op') {
        return {
          ok: true,
          status: 'unchanged',
          feedback: planned.feedback,
        }
      }

      let step: ReturnType<typeof createEditorTransactionStep>
      try {
        step = createEditorTransactionStep(document, planned.plan)
        if (!step) return reject('invalid-asset', '图片替换没有产生可提交的变化')
      } catch (error) {
        return reject(
          'invalid-asset',
          error instanceof Error ? error.message : undefined,
        )
      }
      const nextSession = {
        ...session,
        history: commitSlideEditorTransactionHistory(session.history, step),
      }
      persistCandidateResult({
        ok: true,
        nextSession,
        historyEntry: true,
        selection: session.selection,
        resourceTransition: {
          resourceChanges: step.resourceChanges,
          resourceDirection: 'forward',
        },
      }, {
        statusMessage: '图片已替换',
        transactionStep: step,
        courseAuthoringSession: updateCourseAuthoringSessionItems(
          updateCourseAuthoringSessionRevision(
            authoringSession,
            step.nextDocument.revision,
          ),
          session.selection.selectionIds,
        ),
      })
      return {
        ok: true,
        status: 'replaced',
        feedback: planned.plan.feedback!,
      }
    },

    importSound(asset, bytes, sound = {}) {
      const media = currentMediaSession()
      if (media) {
        const result = persistMediaResult(importCourseSounds(media, [{ meta: asset, bytes }], {
          expectedRevision: media.session.history.present.revision,
          sound,
        }))
        return result.soundIds?.[0] ?? ''
      }
      const soundId = `sound_${nanoid()}`
      const definition: SoundDefinition = {
        id: soundId,
        name: sound.name?.trim() || asset.filename.replace(/\.[^.]+$/, ''),
        assetId: asset.id,
        channel: sound.channel ?? 'sfx',
        defaultVolume: sound.defaultVolume ?? 1,
        defaultLoop: sound.defaultLoop ?? false,
      }
      commitAssetBatch([{ meta: asset, bytes }], (draft) => {
        draft.media.audio.sounds[soundId] = definition
      }, undefined, `已导入声音“${definition.name}”`)
      set({ activeTab: 'elements' })
      return soundId
    },

    importSounds(items) {
      const media = currentMediaSession()
      if (media) {
        const result = persistMediaResult(importCourseSounds(media, items.map((item) => ({
          meta: item.meta,
          bytes: item.bytes,
        })), { expectedRevision: media.session.history.present.revision }))
        return [...(result.soundIds ?? [])]
      }
      if (items.length === 0) return []
      const definitions = items.map(({ meta }) => ({
        id: `sound_${nanoid()}`,
        name: meta.filename.replace(/\.[^.]+$/, ''),
        assetId: meta.id,
        channel: 'sfx' as const,
        defaultVolume: 1,
        defaultLoop: false,
      }))
      commitAssetBatch(items, (draft) => {
        for (const definition of definitions) {
          draft.media.audio.sounds[definition.id] = definition
        }
      }, [], `已批量导入 ${definitions.length} 个声音`)
      return definitions.map((definition) => definition.id)
    },

    updateAudioSettings(patch) {
      const media = currentMediaSession()
      if (media) {
        persistMediaResult(updateCourseAudioSettings(media, patch, {
          expectedRevision: media.session.history.present.revision,
        }))
        return
      }
      commit((draft) => {
        const audio = draft.media.audio
        if (patch.defaultMuted !== undefined) {
          audio.defaultMuted = patch.defaultMuted
        }
        if (patch.masterVolume !== undefined) {
          audio.masterVolume = clampAudioVolume(
            patch.masterVolume,
            audio.masterVolume,
          )
        }
        if (patch.channelVolumes) {
          for (const channel of PROJECT_AUDIO_CHANNELS) {
            const value = patch.channelVolumes[channel]
            if (value !== undefined) {
              audio.channelVolumes[channel] = clampAudioVolume(
                value,
                audio.channelVolumes[channel],
              )
            }
          }
        }
        if (patch.narrationDucking?.enabled !== undefined) {
          audio.narrationDucking.enabled = patch.narrationDucking.enabled
        }
        if (patch.narrationDucking?.musicVolume !== undefined) {
          audio.narrationDucking.musicVolume = clampAudioVolume(
            patch.narrationDucking.musicVolume,
            audio.narrationDucking.musicVolume,
          )
        }
        if (
          patch.narrationDucking?.fadeMs !== undefined &&
          Number.isFinite(patch.narrationDucking.fadeMs)
        ) {
          audio.narrationDucking.fadeMs = Math.max(
            0,
            Math.round(patch.narrationDucking.fadeMs),
          )
        }
      })
      set({ statusMessage: '全局声音设置已更新' })
    },

    updateSound(soundId, patch) {
      const media = currentMediaSession()
      if (media) {
        persistMediaResult(updateCourseSound(media, soundId, patch, {
          expectedRevision: media.session.history.present.revision,
        }))
        return
      }
      commit((draft) => {
        const sound = draft.media.audio.sounds[soundId]
        if (!sound) return
        if (patch.name !== undefined && patch.name.trim()) sound.name = patch.name.trim()
        if (patch.assetId !== undefined) sound.assetId = patch.assetId
        if (patch.channel !== undefined) sound.channel = patch.channel
        if (patch.defaultVolume !== undefined) {
          sound.defaultVolume = Math.max(0, Math.min(1, patch.defaultVolume))
        }
        if (patch.defaultLoop !== undefined) sound.defaultLoop = patch.defaultLoop
      })
      set({ statusMessage: '声音设置已更新' })
    },

    deleteSound(soundId) {
      const media = currentMediaSession()
      if (media) {
        return persistMediaResult(deleteCourseSound(media, soundId, {
          expectedRevision: media.session.history.present.revision,
        })).ok
      }
      const state = get()
      const referenced = state.project.scenes.some((scene) =>
        scene.interactions.some((rule) =>
          rule.trigger.type === 'audio.ended' && rule.trigger.soundId === soundId ||
          rule.actions.some(({ action }) =>
            action.type === 'audio.play' && action.soundId === soundId ||
            ('target' in action && action.type.startsWith('audio.') &&
              action.target.kind === 'sound' && action.target.soundId === soundId),
          ),
        ),
      )
      if (referenced) {
        set({
          errorMessage: '该声音仍被交互规则引用。请先删除或改写相关声音动作。',
          statusMessage: null,
        })
        return false
      }
      const sound = state.project.media.audio.sounds[soundId]
      if (!sound) return false
      commit((draft) => {
        delete draft.media.audio.sounds[soundId]
      })
      set({ statusMessage: `已删除声音“${sound.name}”` })
      return true
    },

    deleteAsset(assetId) {
      const media = currentMediaSession()
      if (media) {
        const state = get()
        const projected = analyzeProjectAssetReferences(state.project, {
          componentPackages: state.componentPackages,
        }).graph.get(assetId) ?? []
        const courseRefs = listCourseAssetReferences(media.session.history.present, assetId)
        if (projected.length > 0) {
          const locations = projected
            .slice(0, 3)
            .map(describeProjectAssetReference)
            .join('；')
          set({
            errorMessage: `该素材仍被引用，不能删除：${locations}${projected.length > 3 ? `；另有 ${projected.length - 3} 处` : ''}。`,
            statusMessage: null,
          })
          return false
        }
        if (courseRefs.length > 0) {
          return persistMediaResult(deleteCourseAsset(media, assetId, {
            expectedRevision: media.session.history.present.revision,
          })).ok
        }
        return persistMediaResult(deleteCourseAsset(media, assetId, {
          expectedRevision: media.session.history.present.revision,
        })).ok
      }
      const state = get()
      const references = analyzeProjectAssetReferences(state.project, {
        componentPackages: state.componentPackages,
      }).graph.get(assetId) ?? []
      if (references.length > 0) {
        const locations = references
          .slice(0, 3)
          .map(describeProjectAssetReference)
          .join('；')
        set({
          errorMessage: `该素材仍被引用，不能删除：${locations}${references.length > 3 ? `；另有 ${references.length - 3} 处` : ''}。`,
          statusMessage: null,
        })
        return false
      }
      if (!state.project.assets[assetId]) return false
      commitAssetTransaction(
        [{ assetId }],
        (draft) => { delete draft.assets[assetId] },
        undefined,
        '未使用素材已删除',
      )
      return true
    },

    applyInteractionTemplateAtTarget(target, template) {
      const state = get()
      const targetFailure = validateActiveInteractionTarget(state, target)
      if (targetFailure) return targetFailure
      const document = activeCourseDocument(state)
      if (!document) {
        return rejectInteractionAuthoring(
          'invalid-document',
          '当前没有可编辑的 Course Project V9 工程。',
        )
      }
      return persistInteractionAuthoringPlan(
        document,
        planApplyInteractionTemplate({
          project: document,
          target,
          template,
          now: new Date().toISOString(),
        }),
        '互动模板已创建；元素初始状态与规则已同步',
      )
    },

    updateInteractionRuleAtTarget(target, ruleId, patch) {
      const state = get()
      const targetFailure = validateActiveInteractionTarget(state, target)
      if (targetFailure) return targetFailure
      const document = activeCourseDocument(state)
      if (!document) {
        return rejectInteractionAuthoring(
          'invalid-document',
          '当前没有可编辑的 Course Project V9 工程。',
        )
      }
      return persistInteractionAuthoringPlan(
        document,
        planUpdateInteractionRule({
          project: document,
          target,
          ruleId,
          patch,
          now: new Date().toISOString(),
        }),
        '交互映射已更新',
      )
    },

    addInteractionRule(sceneId, rule) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        if (backend.getSnapshot().sceneId !== sceneId) {
          persistCandidateResult(backend.activateScene(sceneId, {
            expectedRevision: backend.getSnapshot().revision,
          }))
        }
        runCandidateSession(
          (session) => addSlideSceneInteractionRule(session, rule, {
            expectedRevision: session.history.present.revision,
          }),
          { statusMessage: '交互映射已添加' },
        )
        return
      }
      commit((draft) => {
        const scene = draft.scenes.find((item) => item.id === sceneId)
        if (!scene || scene.interactions.some((item) => item.id === rule.id)) return
        scene.interactions.push(structuredClone(rule))
      })
      set({ statusMessage: '交互映射已添加' })
    },

    updateInteractionRule(sceneId, ruleId, rule) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        runCandidateSession((session) => {
          const result = updateSlideSceneInteractionRule(session, ruleId, rule, {
            expectedRevision: session.history.present.revision,
          })
          if (!result.ok || !result.nextSession) return result
          const project = commitSlideProjectMutation(result.nextSession.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            if (scene) scene.interactions = withoutDanglingAnimationCompletionRules(scene.interactions)
          })
          return {
            ...result,
            nextSession: {
              ...result.nextSession,
              history: {
                present: project,
                past: result.nextSession.history.past,
                future: result.nextSession.history.future,
              },
            },
          }
        }, { statusMessage: '交互映射已更新' })
        return
      }
      commit((draft) => {
        const scene = draft.scenes.find((item) => item.id === sceneId)
        const index = scene?.interactions.findIndex((item) => item.id === ruleId) ?? -1
        if (!scene || index < 0) return
        scene.interactions[index] = structuredClone({ ...rule, id: ruleId })
        scene.interactions = withoutDanglingAnimationCompletionRules(scene.interactions)
      })
      set({ statusMessage: '交互映射已更新' })
    },

    deleteInteractionRule(sceneId, ruleId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        runCandidateSession((session) => {
          const current = findCourseSlideScene(session.history.present, sceneId)
          if (!current || !current.interactions.some((item) => item.id === ruleId)) {
            return {
              ok: false,
              reason: '找不到该交互规则',
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            if (!scene) return
            scene.interactions = withoutDanglingAnimationCompletionRules(
              scene.interactions.filter((item) => item.id !== ruleId),
            )
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: '交互映射已删除' })
        return
      }
      commit((draft) => {
        const scene = draft.scenes.find((item) => item.id === sceneId)
        if (scene) {
          scene.interactions = withoutDanglingAnimationCompletionRules(
            scene.interactions.filter((item) => item.id !== ruleId),
          )
        }
      })
      set({ statusMessage: '交互映射已删除' })
    },

    duplicateInteractionRule(sceneId, ruleId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const source = findCourseSlideScene(backend.getSession().history.present, sceneId)
          ?.interactions.find((rule) => rule.id === ruleId)
        if (!source) return null
        const copy = duplicateInteractionRuleForAuthoring(source)
        runCandidateSession((session) => {
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            const index = scene?.interactions.findIndex((rule) => rule.id === ruleId) ?? -1
            if (!scene || index < 0) return
            scene.interactions.splice(index + 1, 0, structuredClone(copy))
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: '规则副本已创建' })
        return copy.id
      }
      const source = get().project.scenes
        .find((scene) => scene.id === sceneId)
        ?.interactions.find((rule) => rule.id === ruleId)
      if (!source) return null
      const copy = duplicateInteractionRuleForAuthoring(source)
      commit((draft) => {
        const scene = draft.scenes.find((item) => item.id === sceneId)
        const index = scene?.interactions.findIndex((rule) => rule.id === ruleId) ?? -1
        if (!scene || index < 0) return
        scene.interactions.splice(index + 1, 0, structuredClone(copy))
      })
      set({ statusMessage: '规则副本已创建' })
      return copy.id
    },

    moveInteractionRule(sceneId, ruleId, direction) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        runCandidateSession((session) => {
          const current = findCourseSlideScene(session.history.present, sceneId)
          if (!current) {
            return {
              ok: false,
              reason: '找不到当前幻灯片',
              historyEntry: false,
              nextSession: session,
              selection: session.selection,
            }
          }
          const project = commitSlideProjectMutation(session.history.present, (draft) => {
            const scene = findCourseSlideScene(draft, sceneId)
            if (scene) moveInteractionRuleWithinKind(scene.interactions, ruleId, direction)
          })
          return {
            ok: true,
            historyEntry: true,
            nextSession: {
              ...session,
              history: commitSlideAuthoringHistory(session.history, project),
            },
            selection: session.selection,
          }
        }, { statusMessage: direction < 0 ? '规则已上移' : '规则已下移' })
        return
      }
      commit((draft) => {
        const rules = draft.scenes.find((scene) => scene.id === sceneId)
          ?.interactions
        if (rules) moveInteractionRuleWithinKind(rules, ruleId, direction)
      })
      set({ statusMessage: direction < 0 ? '规则已上移' : '规则已下移' })
    },

    addGlobalInteractionRule(rule) {
      if (selectSlideAuthoringBackend(get())) {
        runV9DocumentMutation((draft) => {
          if (draft.globalInteractions.some((item) => item.id === rule.id)) return
          draft.globalInteractions.push(structuredClone(rule))
        }, { statusMessage: '全局交互映射已添加' })
        return
      }
      commit((draft) => {
        if (draft.globalInteractions.some((item) => item.id === rule.id)) return
        draft.globalInteractions.push(structuredClone(rule))
      })
      set({ statusMessage: '全局交互映射已添加' })
    },

    updateGlobalInteractionRule(ruleId, rule) {
      if (selectSlideAuthoringBackend(get())) {
        runV9DocumentMutation((draft) => {
          const index = draft.globalInteractions.findIndex((item) => item.id === ruleId)
          if (index < 0) return
          draft.globalInteractions[index] = structuredClone({ ...rule, id: ruleId })
          draft.globalInteractions = withoutDanglingAnimationCompletionRules(
            draft.globalInteractions,
          )
        }, { statusMessage: '全局交互映射已更新' })
        return
      }
      commit((draft) => {
        const index = draft.globalInteractions.findIndex((item) => item.id === ruleId)
        if (index < 0) return
        draft.globalInteractions[index] = structuredClone({ ...rule, id: ruleId })
        draft.globalInteractions = withoutDanglingAnimationCompletionRules(
          draft.globalInteractions,
        )
      })
      set({ statusMessage: '全局交互映射已更新' })
    },

    deleteGlobalInteractionRule(ruleId) {
      if (selectSlideAuthoringBackend(get())) {
        runV9DocumentMutation((draft) => {
          draft.globalInteractions = withoutDanglingAnimationCompletionRules(
            draft.globalInteractions.filter((item) => item.id !== ruleId),
          )
        }, { statusMessage: '全局交互映射已删除' })
        return
      }
      commit((draft) => {
        draft.globalInteractions = withoutDanglingAnimationCompletionRules(
          draft.globalInteractions.filter((item) => item.id !== ruleId),
        )
      })
      set({ statusMessage: '全局交互映射已删除' })
    },

    duplicateGlobalInteractionRule(ruleId) {
      const source = get().project.globalInteractions.find(
        (rule) => rule.id === ruleId,
      )
      if (!source) return null
      const copy = duplicateInteractionRuleForAuthoring(source)
      if (selectSlideAuthoringBackend(get())) {
        runV9DocumentMutation((draft) => {
          const index = draft.globalInteractions.findIndex(
            (rule) => rule.id === ruleId,
          )
          if (index >= 0) {
            draft.globalInteractions.splice(index + 1, 0, structuredClone(copy))
          }
        }, { statusMessage: '全局规则副本已创建' })
        return copy.id
      }
      commit((draft) => {
        const index = draft.globalInteractions.findIndex(
          (rule) => rule.id === ruleId,
        )
        if (index >= 0) {
          draft.globalInteractions.splice(index + 1, 0, structuredClone(copy))
        }
      })
      set({ statusMessage: '全局规则副本已创建' })
      return copy.id
    },

    moveGlobalInteractionRule(ruleId, direction) {
      if (selectSlideAuthoringBackend(get())) {
        runV9DocumentMutation((draft) => {
          moveInteractionRuleWithinKind(
            draft.globalInteractions,
            ruleId,
            direction,
          )
        }, { statusMessage: direction < 0 ? '全局规则已上移' : '全局规则已下移' })
        return
      }
      commit((draft) => {
        moveInteractionRuleWithinKind(
          draft.globalInteractions,
          ruleId,
          direction,
        )
      })
      set({ statusMessage: direction < 0 ? '全局规则已上移' : '全局规则已下移' })
    },

    setSimpleEntranceAnimation(nodeId, config) {
      if (selectSlideAuthoringBackend(get())) {
        runCandidateSession(
          (session) => writeSlideSimpleEntranceAnimation(session, nodeId, config, {
            expectedRevision: session.history.present.revision,
          }),
        )
        return
      }
      const state = get()
      if (state.editingScope !== 'scene') {
        set({
          errorMessage: '全局元素的动画作用域较复杂，请在专业模式的规则面板中配置。',
          statusMessage: null,
        })
        return
      }
      const scene = currentScene(state)
      if (!scene) return
      const stateId = state.activePresentationStateId
      const existingRule = findSimpleEntranceAnimationRule(
        scene.interactions,
        nodeId,
        stateId,
      )
      if (
        config &&
        hasAdvancedEntranceAnimation(scene.interactions, nodeId, stateId)
      ) {
        set({
          errorMessage: '该元素已有专业动画规则。请切换到专业模式编辑，避免重复播放。',
          statusMessage: null,
        })
        return
      }
      const effectiveNode = editingNodes(state).find((node) => node.id === nodeId)
      if (!effectiveNode || (!config && !existingRule)) return

      commit((draft) => {
        const draftScene = draft.scenes.find((item) => item.id === scene.id)
        if (!draftScene) return
        const rules = draftScene.interactions
        const ruleIndex = existingRule
          ? rules.findIndex((rule) => rule.id === existingRule.id)
          : -1

        if (config) {
          const action = simpleEntranceAction(nodeId, config)
          if (ruleIndex >= 0) {
            const current = rules[ruleIndex]!
            rules[ruleIndex] = {
              ...current,
              name: `${effectiveNode.name} · 出现动画`.slice(0, 80),
              enabled: true,
              actions: [{
                ...current.actions[0]!,
                delayMs: Math.min(60_000, Math.max(0, config.delayMs)),
                action,
              }],
            }
          } else {
            rules.push({
              id: `simple_entrance_${nanoid()}`,
              name: `${effectiveNode.name} · 出现动画`.slice(0, 80),
              enabled: true,
              trigger: { type: 'node.activated', nodeId },
              conditions: stateId === null
                ? []
                : [{ type: 'presentation.in', stateIds: [stateId] }],
              actions: [{
                id: `action_${nanoid()}`,
                start: 'after-previous',
                delayMs: Math.min(60_000, Math.max(0, config.delayMs)),
                action,
              }],
            })
          }
          setSceneNodePlaybackInitialVisibility(
            draftScene as SceneDocument,
            stateId,
            nodeId,
            'hidden',
          )
          return
        }

        draftScene.interactions = withoutDanglingAnimationCompletionRules(
          rules.filter((_, index) => index !== ruleIndex),
        )
        const stillHasEntrance = draftScene.interactions.some((rule) =>
          entranceRuleAppliesToState(rule, nodeId, stateId),
        )
        if (!stillHasEntrance) {
          setSceneNodePlaybackInitialVisibility(
            draftScene as SceneDocument,
            stateId,
            nodeId,
            'inherit',
          )
        }
      }, nodeId)
      set({
        statusMessage: config
          ? `已为“${effectiveNode.name}”设置出现动画`
          : `已移除“${effectiveNode.name}”的出现动画`,
      })
    },

    updatePlayback(patch) {
      const state = get()
      const document = state.spatialSession?.history.present
        ?? state.flowSession?.history.present
        ?? selectSlideAuthoringBackend(state)?.getSession().history.present
      if (!document) {
        set({
          errorMessage: '当前 Course Project 没有可用的作者会话。',
          statusMessage: null,
        })
        return
      }
      const result = updateCoursePlaybackSettings(document, patch, {
        expectedRevision: document.revision,
      })
      const extra = {
        statusMessage: result.ok ? result.reason ?? '成品控制设置已更新' : undefined,
      }
      if (state.spatialSession) {
        persistSpatialLayerCommand(result, extra)
        return
      }
      if (state.flowSession) {
        persistFlowLayerCommand(result, extra)
        return
      }
      persistLayerCommand(result, extra)
    },

    updateDesignTokens(tokens) {
      if (selectSlideAuthoringBackend(get())) {
        runV9DocumentMutation((draft) => {
          draft.designTokens = structuredClone(tokens)
        }, { statusMessage: '项目字体与色板 Token 已更新' })
        return
      }
      commit((draft) => {
        draft.designTokens = structuredClone(tokens)
      })
      set({ statusMessage: '项目字体与色板 Token 已更新' })
    },

    ensureTeacherController() {
      const sourceTab = get().activeTab
      const selectRestoredTeacherController = (
        layerItemId: string,
        existedBeforeRestore: boolean,
      ) => {
        get().selectNode(layerItemId)
        if (!existedBeforeRestore) set({ activeTab: sourceTab })
      }
      const spatial = get().spatialSession
      if (spatial) {
        const existedBeforeRestore = Boolean(findGlobalTeacherController(spatial.history.present))
        const result = restoreDefaultTeacherController(
          spatial.history.present,
          { expectedRevision: spatial.history.present.revision },
        )
        persistSpatialLayerCommand(result, {
          statusMessage: result.ok ? result.reason : undefined,
        })
        if (result.ok) {
          const restored = findGlobalTeacherController(
            get().spatialSession?.history.present ?? spatial.history.present,
          )
          if (restored) {
            selectRestoredTeacherController(restored.item.layerItemId, existedBeforeRestore)
          }
        }
        return
      }
      const flow = get().flowSession
      if (flow) {
        const existedBeforeRestore = Boolean(findGlobalTeacherController(flow.history.present))
        const result = restoreDefaultTeacherController(
          flow.history.present,
          { expectedRevision: flow.history.present.revision },
        )
        persistFlowLayerCommand(result, {
          statusMessage: result.ok ? result.reason : undefined,
        })
        if (result.ok) {
          const restored = findGlobalTeacherController(
            get().flowSession?.history.present ?? flow.history.present,
          )
          if (restored) {
            selectRestoredTeacherController(restored.item.layerItemId, existedBeforeRestore)
          }
        }
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const document = backend.getSession().history.present
        const existedBeforeRestore = Boolean(findGlobalTeacherController(document))
        const result = restoreDefaultTeacherController(document, {
          expectedRevision: document.revision,
          preserveAuthoringLock: true,
        })
        persistLayerCommand(result, {
          statusMessage: result.ok ? result.reason : undefined,
        })
        if (result.ok) {
          const restored = findGlobalTeacherController(
            selectSlideAuthoringBackend(get())?.getSession().history.present ?? document,
          )
          if (restored) {
            selectRestoredTeacherController(restored.item.layerItemId, existedBeforeRestore)
          }
        }
        return
      }
      set({
        errorMessage: '当前 Course Project 没有可用的作者会话。',
        statusMessage: null,
      })
    },

    addExternalComponentNode(packageId, x, y, presetId) {
      const data = get().componentPackages[packageId]
      if (!data) return
      const scope = get().editingScope
      if (!componentSupportsScope(data.manifest, scope)) {
        set({
          errorMessage: scope === 'global'
            ? `组件“${data.manifest.name}”未声明支持全局层。`
            : `组件“${data.manifest.name}”未声明支持场景层。`,
          statusMessage: null,
        })
        return
      }
      if (!canAddNode()) return
      const state = get()
      const node = normalizeNewNodeGeometry(
        offsetDefaultInsertion(
          createExternalComponentNode(data.manifest, x, y),
          editingNodes(state).length,
          x !== undefined || y !== undefined,
        ),
        state.componentPackages,
      )
      if (node.type !== 'external-component') return
      let presetLabel: string | undefined
      if (presetId) {
        const preset = data.manifest.presets?.find((item) => item.id === presetId)
        if (preset && node.type === 'external-component') {
          node.name = `${data.manifest.name} · ${preset.label}`
          node.props = resolveComponentPresetProps(data.manifest, preset)
          presetLabel = preset.label
        }
      }
      const spatial = get().spatialSession
      if (spatial) {
        persistSpatialResult(addSpatialWorldComponentLayer(spatial, {
          packageId,
          version: data.manifest.version,
          props: node.props,
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          label: node.name,
        }, { expectedRevision: spatial.history.present.revision }), {
          statusMessage: `已添加“${presetLabel ?? data.manifest.name}”`,
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const present = flow.history.present
        const prepared = present.componentPackages[packageId]
          ? present
          : {
              ...present,
              componentPackages: {
                ...present.componentPackages,
                [packageId]: componentMeta(data),
              },
            }
        persistFlowResult(insertFlowSharedComponent(prepared, flow.selection, {
          packageId,
          manifest: data.manifest,
          props: node.props,
          id: node.id,
          label: node.name,
        }, { expectedRevision: present.revision }), {
          statusMessage: `已添加“${presetLabel ?? data.manifest.name}”`,
        })
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        if (appendV9GlobalNode(node, {
          statusMessage: scope === 'global'
            ? `已将“${presetLabel ?? data.manifest.name}”添加到全局层`
            : `已添加“${presetLabel ?? data.manifest.name}”`,
        })) return
        runCandidateSession(
          (session) => addSlideComponentLayer(session, {
            packageId,
            manifest: data.manifest,
            props: node.props,
            presetId,
            id: node.id,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
            label: node.name,
          }, {
            expectedRevision: session.history.present.revision,
          }),
          {
            statusMessage: scope === 'global'
              ? `已将“${presetLabel ?? data.manifest.name}”添加到全局层`
              : `已添加“${presetLabel ?? data.manifest.name}”`,
          },
        )
        return
      }
      appendNodeToEditingScope(node)
      set({
        statusMessage: scope === 'global'
          ? `已将“${presetLabel ?? data.manifest.name}”添加到全局层`
          : `已添加“${presetLabel ?? data.manifest.name}”`,
      })
    },

    importComponentPackage(packageData) {
      get().importComponentPackages([packageData])
    },

    importComponentPackages(packageData) {
      if (packageData.length === 0) return
      const existingPackages = get().componentPackages
      const pendingIds = new Set<string>()
      for (const data of packageData) {
        const id = data.manifest.id
        if (pendingIds.has(id)) {
          throw new UserFacingError(
            '组件批量导入失败',
            `所选文件中包含多个 ID 为“${id}”的组件包。`,
            '每个组件 ID 每批只能加入一个版本；请取消重复选择后重试。',
          )
        }
        pendingIds.add(id)
        const existing = existingPackages[id]
        if (!existing) continue
        const sameVersion = existing.manifest.version === data.manifest.version
        throw new UserFacingError(
          '组件导入失败',
          sameVersion
            ? `组件“${existing.manifest.name}” ${existing.manifest.version} 已经加入工程。`
            : `工程已包含组件“${existing.manifest.name}” ${existing.manifest.version}，不能再加入同 ID 的 ${data.manifest.version}。`,
          sameVersion
            ? '请直接从“工程组件”插入实例；若要更新代码，请使用该组件的管理菜单。'
            : '请从“工程组件”的管理菜单审阅更新或替换，实例会统一升级。',
        )
      }

      const packagesToAdd = Object.fromEntries(
        packageData.map((data) => [data.manifest.id, data]),
      )
      const spatial = get().spatialSession
      if (spatial) {
        const project = commitSpatialProjectMutation(spatial.history.present, (draft) => {
          packageData.forEach((data) => {
            draft.componentPackages[data.manifest.id] = componentMeta(data)
          })
        })
        persistSpatialResult(succeedSpatialCommand({
          ...spatial,
          history: commitSpatialAuthoringHistory(spatial.history, project),
        }, true), {
          componentPackages: { ...get().componentPackages, ...packagesToAdd },
          statusMessage: packageData.length === 1
            ? `已将组件“${packageData[0]!.manifest.name}”加入工程`
            : `已将 ${packageData.length} 个组件加入工程`,
        })
        set({
          activeTab: get().editorMode === 'professional' ? 'components' : get().activeTab,
          errorMessage: null,
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const project = commitSlideProjectMutation(flow.history.present, (draft) => {
          packageData.forEach((data) => {
            draft.componentPackages[data.manifest.id] = componentMeta(data)
          })
        })
        persistFlowResult({
          ok: true,
          nextDocument: project,
          historyEntry: true,
          selection: flow.selection,
        }, {
          componentPackages: { ...get().componentPackages, ...packagesToAdd },
          statusMessage: packageData.length === 1
            ? `已将组件“${packageData[0]!.manifest.name}”加入工程`
            : `已将 ${packageData.length} 个组件加入工程`,
        })
        set({
          activeTab: get().editorMode === 'professional' ? 'components' : get().activeTab,
          errorMessage: null,
        })
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        runCandidateSession(
          (session) => {
            const project = commitSlideProjectMutation(session.history.present, (draft) => {
              packageData.forEach((data) => {
                draft.componentPackages[data.manifest.id] = componentMeta(data)
              })
            })
            return {
              ok: true,
              historyEntry: true,
              nextSession: {
                ...session,
                history: commitSlideAuthoringHistory(session.history, project),
              },
              selection: session.selection,
            }
          },
          {
            componentPackages: packagesToAdd,
            statusMessage: packageData.length === 1
              ? `已将组件“${packageData[0]!.manifest.name}”加入工程`
              : `已将 ${packageData.length} 个组件加入工程`,
          },
        )
        set({
          activeTab: get().editorMode === 'professional' ? 'components' : get().activeTab,
          errorMessage: null,
        })
        return
      }

      commit((draft) => {
        packageData.forEach((data) => {
          draft.componentPackages[data.manifest.id] = componentMeta(data)
        })
      }, undefined, packageData.map((data) => ({
        packageId: data.manifest.id,
        next: data,
      })))
      set({
        activeTab: get().editorMode === 'professional' ? 'components' : get().activeTab,
        errorMessage: null,
        statusMessage: packageData.length === 1
          ? `已将组件“${packageData[0]!.manifest.name}”加入工程`
          : `已将 ${packageData.length} 个组件加入工程`,
      })
    },

    deleteComponentPackage(packageId) {
      const state = get()
      const decision = evaluateComponentPackageDeletion(state.project, packageId)
      if (!decision.packageExists) {
        set({
          errorMessage: `工程中不存在组件包“${packageId}”。`,
          statusMessage: null,
        })
        return false
      }
      if (!decision.canDelete) {
        const { sceneInstanceCount, globalInstanceCount } = decision.usage
        set({
          errorMessage: `组件包仍被 ${sceneInstanceCount} 个场景实例和 ${globalInstanceCount} 个全局实例引用。请先删除这些实例，再删除组件包。`,
          statusMessage: null,
        })
        return false
      }

      const packageName = state.componentPackages[packageId]?.manifest.name ?? packageId
      if (selectSlideAuthoringBackend(get())) {
        const result = runV9DocumentMutation((draft) => {
          removeCourseComponentPackage(draft, packageId)
        }, { statusMessage: `未使用组件包“${packageName}”已删除` })
        if (result.ok) {
          set({ errorMessage: null })
        }
        return result.ok
      }
      commit((draft) => {
        for (const [key, meta] of Object.entries(draft.componentPackages)) {
          if (meta.packageId === packageId) delete draft.componentPackages[key]
        }
      }, undefined, { packageId })
      set({
        errorMessage: null,
        statusMessage: `未使用组件包“${packageName}”已删除`,
      })
      return true
    },

    replaceComponentPackage(packageId, packageData) {
      const replacementId = packageData.manifest.id
      if (replacementId !== packageId) {
        throw new UserFacingError(
          '组件替换失败',
          `所选组件包 ID 为“${replacementId}”，与待替换的“${packageId}”不一致。`,
          '请选择同一组件 ID 的新版本；替换不会自动把实例迁移到另一种组件。',
        )
      }
      const currentPackage = get().componentPackages[packageId]
      const currentHash = currentPackage?.provenance?.sha256
      const replacementHash = packageData.provenance?.sha256
      if (
        currentPackage?.manifest.version === packageData.manifest.version &&
        currentHash !== undefined &&
        replacementHash !== undefined &&
        currentHash !== replacementHash
      ) {
        throw new UserFacingError(
          '组件替换失败',
          `组件“${packageId}”的 ${packageData.manifest.version} 版本与工程内同版本哈希不一致。`,
          '同一 ID 与版本必须锁定到完全相同的包；请让组件维护者提升版本号后再更新。',
        )
      }
      const target = captureComponentReplacementTarget(packageId)
      if (!target) {
        throw new UserFacingError(
          '组件替换失败',
          `工程中不存在可替换的组件包“${packageId}”。`,
          '请刷新工程组件列表后重试。',
        )
      }
      const result = commitComponentReplacementAtTarget(target, packageData)
      if (!result.ok) {
        throw new UserFacingError(
          '组件替换失败',
          result.reason,
          result.code === 'unsupported-scope'
            ? '请使用 supportedScopes 覆盖现有实例范围的同 ID 组件包，或先删除不兼容范围内的实例。'
            : '当前工程未发生变化，请检查组件包内容、版本与工程状态后重试。',
        )
      }
    },

    captureComponentPackageReplacementTarget(packageId) {
      return captureComponentReplacementTarget(packageId)
    },

    replaceComponentPackageAtTarget(target, packageData) {
      return commitComponentReplacementAtTarget(target, packageData)
    },

    createEditableComponentCopy(packageId, nodeId) {
      const state = get()
      const source = state.componentPackages[packageId]
      if (!source) {
        set({
          errorMessage: `工程中不存在组件包“${packageId}”。`,
          statusMessage: null,
        })
        return null
      }
      if (
        nodeId &&
        state.editingScope === 'scene' &&
        state.activePresentationStateId !== null
      ) {
        set({
          errorMessage:
            '命名状态只能覆盖组件公开属性，不能改变组件包身份。请切换到“基础”后再创建可编辑副本。',
          statusMessage: null,
        })
        return null
      }
      const selected = nodeId
        ? editingNodes(state).find((node) => node.id === nodeId)
        : undefined
      if (
        nodeId &&
        (
          selected?.type !== 'external-component' ||
          selected.component.packageId !== packageId
        )
      ) {
        throw new UserFacingError(
          '无法切换组件副本',
          '所选实例与待复制组件不一致。',
          '请重新选择组件实例后再试。',
        )
      }
      const suffix = nanoid(6)
      const safeSuffix = suffix.toLowerCase().replace(/[^a-z0-9]/g, 'x')
      const nextId = editableComponentPackageId(packageId, suffix)
      const nextVersion = `0.1.0-edit.${safeSuffix}`
      const manifest = {
        ...structuredClone(source.manifest),
        id: nextId,
        name: `${source.manifest.name}（可编辑副本）`,
        version: nextVersion,
        description: `由工程内“${source.manifest.name}”创建的可编辑副本。`,
      } as ComponentManifest
      const runtimeSource = rewriteComponentDefinitionId(
        source.runtimeSource,
        source.manifest.id,
        nextId,
      )
      const sourceWithoutProvenance = { ...source }
      delete sourceWithoutProvenance.provenance
      const authoredFiles = componentFilesWithAuthoredCode(
        source,
        manifest,
        runtimeSource,
      )
      const packageData: ComponentPackageData = {
        ...sourceWithoutProvenance,
        manifest,
        runtimeSource,
        files: authoredFiles,
        contentSha256: componentContentSha256(authoredFiles),
      }
      validateEditableComponentPackage(
        packageData,
        state.project,
        selected
          ? [state.editingScope === 'global' ? 'global' : 'scene']
          : [],
      )
      const sourceMeta = Object.values(state.project.componentPackages).find(
        (meta) =>
          meta.packageId === packageId &&
          meta.version === source.manifest.version,
      )
      const authoring = {
        editableCopy: true as const,
        sourcePackageId: sourceMeta?.sourcePackageId ?? packageId,
      }

      if (selectSlideAuthoringBackend(get())) {
        const result = runV9DocumentMutation((draft) => {
          draft.componentPackages[nextId] = componentMeta(packageData, authoring)
          if (!selected || selected.type !== 'external-component') return
          const layer = findMutableCourseLayerItem(draft, selected.id)
          if (layer?.kind === 'component') {
            layer.component = { packageId: nextId, version: nextVersion }
          }
        }, {
          componentPackages: { [nextId]: packageData },
          selectionIds: selected ? [selected.id] : undefined,
          statusMessage: `已创建“${manifest.name}”，原组件包保持不变`,
        })
        if (!result.ok) return null
        set({
          activeTab: 'developer',
          errorMessage: null,
        })
        return nextId
      }

      commit((draft) => {
        draft.componentPackages[nextId] = componentMeta(packageData, authoring)
        if (!selected || selected.type !== 'external-component') return
        if (state.editingScope === 'global') {
          const item = draft.globalLayer.find(
            (entry) => entry.node.id === selected.id,
          )
          if (item?.node.type === 'external-component') {
            item.node.component = { packageId: nextId, version: nextVersion }
          }
          return
        }
        const scene = draft.scenes.find(
          (item) => item.id === state.activeSceneId,
        )
        if (!scene) return
        const node = scene.nodes.find((item) => item.id === selected.id)
        if (node?.type === 'external-component') {
          node.component = { packageId: nextId, version: nextVersion }
        }
      }, nodeId, { packageId: nextId, next: packageData })
      set({
        activeTab: 'developer',
        errorMessage: null,
        statusMessage: `已创建“${manifest.name}”，原组件包保持不变`,
      })
      return nextId
    },

    updateEditableComponentPackage(packageId, patch) {
      const state = get()
      const currentPackage = state.componentPackages[packageId]
      const currentMeta = Object.values(state.project.componentPackages).find(
        (meta) =>
          meta.packageId === packageId &&
          meta.version === currentPackage?.manifest.version,
      )
      assertEditableComponentPackage(packageId, currentPackage, currentMeta)
      const manifest = patch.manifest
        ? structuredClone(patch.manifest)
        : structuredClone(currentPackage.manifest)
      if (
        manifest.id !== currentPackage.manifest.id ||
        manifest.version !== currentPackage.manifest.version
      ) {
        throw new UserFacingError(
          '组件代码不可修改',
          '可编辑副本的 ID 和版本不能在代码框内改写。',
          '如需新的身份，请从当前组件再次创建副本。',
        )
      }
      const runtimeSource = patch.runtimeSource ?? currentPackage.runtimeSource
      const authoredFiles = componentFilesWithAuthoredCode(
        currentPackage,
        manifest,
        runtimeSource,
      )
      const nextPackage: ComponentPackageData = {
        ...currentPackage,
        manifest,
        runtimeSource,
        files: authoredFiles,
        contentSha256: componentContentSha256(authoredFiles),
      }
      validateEditableComponentPackage(nextPackage, state.project)
      if (selectSlideAuthoringBackend(get())) {
        const result = runV9DocumentMutation((draft) => {
          removeCourseComponentPackage(draft, packageId)
          draft.componentPackages[packageId] = componentMeta(nextPackage, {
            editableCopy: true,
            sourcePackageId: currentMeta?.sourcePackageId,
          })
        }, {
          componentPackages: { [packageId]: nextPackage },
          statusMessage: `组件“${nextPackage.manifest.name}”代码已更新`,
        })
        if (result.ok) {
          set({
            activeTab: 'developer',
            errorMessage: null,
          })
        }
        return
      }
      commit((draft) => {
        for (const [key, meta] of Object.entries(draft.componentPackages)) {
          if (meta.packageId === packageId) delete draft.componentPackages[key]
        }
        draft.componentPackages[packageId] = componentMeta(nextPackage, {
          editableCopy: true,
          sourcePackageId: currentMeta?.sourcePackageId,
        })
      }, undefined, { packageId, next: nextPackage })
      set({
        activeTab: 'developer',
        errorMessage: null,
        statusMessage: `组件“${nextPackage.manifest.name}”代码已更新`,
      })
    },

    deleteNode(nodeId) {
      const spatial = get().spatialSession
      if (spatial) {
        if (get().spatialContentEdit || get().editingTextNodeId) return
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row) return
        if (row.owner === 'world') {
          persistSpatialResult(selectSpatialLayers(spatial, { layerItemIds: [nodeId] }, {
            expectedRevision: spatial.history.present.revision,
          }))
          const live = get().spatialSession
          if (!live) return
          const deleted = deleteSpatialWorldLayersReportingReferences(live, {
            expectedRevision: live.history.present.revision,
          })
          persistSpatialResult(deleted, {
            statusMessage: deleted.cleanupSummary || '节点已删除',
          })
          return
        }
        persistSpatialLayerCommand(deleteEffectiveLayerItem(
          spatial.history.present,
          commandTargetForRow(row),
          { expectedRevision: spatial.history.present.revision },
        ))
        return
      }
      const flow = get().flowSession
      if (flow) {
        if (get().flowTextEdit?.composing || flow.selection.focus === 'text') return
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row) return
        persistFlowResult(executeFlowSharedDelete(flow.history.present, selectFlowOverlay(
          flow.history.present,
          flow.selection.locationId,
          [nodeId],
          row.owner === 'global' ? 'global' : 'page',
        ), { expectedRevision: flow.history.present.revision }))
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        const backend = selectSlideAuthoringBackend(get())
        if (!backend) return
        if (shouldIgnoreSlideLayerDeleteForFocus({
          textEditSession: Boolean(get().editingTextNodeId || get().v9ContentEdit?.kind === 'text'),
          formulaEditSession: get().v9ContentEdit?.kind === 'formula',
        })) return
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row) return
        if (get().editingScope === 'scene' && backend.getSession().selection.stateId !== null) {
          get().updateNode(nodeId, { visible: false })
          set({
            selectedNodeId: null,
            selectedNodeIds: [],
            statusMessage: '元素已在当前状态中隐藏；基础元素仍保留',
          })
          return
        }
        persistLayerCommand(deleteEffectiveLayerItem(
          backend.getSession().history.present,
          commandTargetForRow(row),
          { expectedRevision: backend.getSnapshot().revision },
        ))
        return
      }
      const state = get()
      const sceneId = state.activeSceneId
      if (!editingNodes(state).some((node) => node.id === nodeId)) return
      if (state.editingScope === 'scene' && state.activePresentationStateId !== null) {
        get().updateNode(nodeId, { visible: false })
        set({
          selectedNodeId: null,
          selectedNodeIds: [],
          statusMessage: '元素已在当前状态中隐藏；基础元素仍保留',
        })
        return
      }
      commit((draft) => {
        if (state.editingScope === 'global') {
          draft.globalLayer = draft.globalLayer.filter(
            (instance) => instance.node.id !== nodeId,
          )
          draft.globalInteractions = draft.globalInteractions.filter((rule) =>
            !('nodeId' in rule.trigger && rule.trigger.nodeId === nodeId) &&
            !rule.actions.some(({ action }) =>
              (isVideoInteractionAction(action) || isNodeMotionAction(action)) &&
              action.nodeId === nodeId,
            ),
          )
          draft.globalInteractions = withoutDanglingAnimationCompletionRules(
            draft.globalInteractions,
          )
        } else {
          const draftScene = draft.scenes.find((item) => item.id === sceneId)
          if (draftScene) {
            removeBaseNodes(draftScene as SceneDocument, new Set([nodeId]))
            draftScene.interactions = draftScene.interactions.filter((rule) =>
              !('nodeId' in rule.trigger && rule.trigger.nodeId === nodeId) &&
              !rule.actions.some(({ action }) =>
                (isVideoInteractionAction(action) || isNodeMotionAction(action)) &&
                action.nodeId === nodeId,
              ),
            )
            draftScene.interactions = withoutDanglingAnimationCompletionRules(
              draftScene.interactions,
            )
          }
        }
      }, null)
      set({ statusMessage: state.editingScope === 'global' ? '全局元素已删除' : '节点已删除' })
    },

    deleteSelectedNodes() {
      const state = get()
      if (selectActiveCourseProjectDocument(state)) {
        get().routeEditorAction('delete')
        return
      }
      const spatial = get().spatialSession
      if (spatial) {
        if (get().spatialContentEdit || get().editingTextNodeId) return
        for (const nodeId of [...get().selectedNodeIds]) {
          get().deleteNode(nodeId)
        }
        return
      }
      const flow = get().flowSession
      if (flow) {
        if (get().flowTextEdit?.composing) return
        const intent = classifyFlowDeleteIntent(flow.selection)
        if (intent.intent === 'text-delete') return
        persistFlowResult(executeFlowSharedDelete(
          flow.history.present,
          flow.selection,
          { expectedRevision: flow.history.present.revision },
        ))
        return
      }
      if (selectSlideAuthoringBackend(get())) {
        if (shouldIgnoreSlideLayerDeleteForFocus({
          textEditSession: Boolean(get().editingTextNodeId || get().v9ContentEdit?.kind === 'text'),
          formulaEditSession: get().v9ContentEdit?.kind === 'formula',
        })) return
        for (const nodeId of [...get().selectedNodeIds]) {
          const backend = selectSlideAuthoringBackend(get())
          if (!backend) break
          const row = findCandidateLayerRow(get(), nodeId)
          if (!row) continue
          persistLayerCommand(deleteEffectiveLayerItem(
            backend.getSession().history.present,
            commandTargetForRow(row),
            { expectedRevision: backend.getSnapshot().revision },
          ))
        }
        return
      }
      const ids = new Set(state.selectedNodeIds)
      if (ids.size === 0) return
      const sceneId = state.activeSceneId
      if (state.editingScope === 'scene' && state.activePresentationStateId !== null) {
        get().updateNodes([...ids].map((nodeId) => ({
          nodeId,
          patch: { visible: false },
        })))
        set({
          selectedNodeId: null,
          selectedNodeIds: [],
          statusMessage: `已在当前状态中隐藏 ${ids.size} 个图层`,
        })
        return
      }
      commit((draft) => {
        if (state.editingScope === 'global') {
          draft.globalLayer = draft.globalLayer.filter(
            (instance) => !ids.has(instance.node.id),
          )
          draft.globalInteractions = draft.globalInteractions.filter((rule) =>
            !('nodeId' in rule.trigger && ids.has(rule.trigger.nodeId)) &&
            !rule.actions.some(({ action }) =>
              (isVideoInteractionAction(action) || isNodeMotionAction(action)) &&
              ids.has(action.nodeId),
            ),
          )
          draft.globalInteractions = withoutDanglingAnimationCompletionRules(
            draft.globalInteractions,
          )
        } else {
          const scene = draft.scenes.find((item) => item.id === sceneId)
          if (scene) {
            removeBaseNodes(scene as SceneDocument, ids)
            scene.interactions = scene.interactions.filter((rule) =>
              !('nodeId' in rule.trigger && ids.has(rule.trigger.nodeId)) &&
              !rule.actions.some(({ action }) =>
                (isVideoInteractionAction(action) || isNodeMotionAction(action)) &&
                ids.has(action.nodeId),
              ),
            )
            scene.interactions = withoutDanglingAnimationCompletionRules(
              scene.interactions,
            )
          }
        }
      }, null)
      set({
        statusMessage: state.editingScope === 'global'
          ? `已删除 ${ids.size} 个全局元素`
          : `已删除 ${ids.size} 个图层`,
      })
    },

    duplicateNode(nodeId) {
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row) return
        if (row.owner === 'global') {
          const createdId = `${nodeId}_copy_${nanoid(8)}`
          runV9DocumentMutation((draft) => {
            const entry = draft.globalLayerItems.find(
              (item) => item.item.layerItemId === nodeId,
            )
            if (!entry) return
            const duplicate = structuredClone(entry)
            duplicate.item.layerItemId = createdId
            duplicate.item.label = `${entry.item.label} 副本`.slice(0, 200)
            duplicate.item.frame.x += 20
            duplicate.item.frame.y += 20
            duplicate.item.locked = false
            duplicate.item.order = allocateCourseLayerOrder(draft, entry.item.order + 1)
            draft.globalLayerItems.push(duplicate)
            sortScopedLayerList(draft.globalLayerItems)
            const copies = draft.globalInteractions.flatMap((rule) => {
              if (rule.trigger.type !== 'node.click' || rule.trigger.nodeId !== nodeId) {
                return []
              }
              const copy = duplicateInteractionRuleForAuthoring(rule)
              copy.trigger = { type: 'node.click', nodeId: createdId }
              return [copy]
            })
            draft.globalInteractions.push(...copies)
          }, {
            selectionIds: [createdId],
            scope: 'global',
            statusMessage: '已复制全局元素',
          })
          return
        }
        persistLayerCommand(duplicateEffectiveLayerItem(
          backend.getSession().history.present,
          commandTargetForRow(row),
          { expectedRevision: backend.getSnapshot().revision },
        ))
        return
      }
      if (!canAddNode()) return
      const state = get()
      const sceneId = state.activeSceneId
      const source = editingNodes(state).find((node) => node.id === nodeId)
      if (!source) return
      const copy = normalizeNewNodeGeometry(
        {
          ...structuredClone(source),
          id: `${source.type}_${nanoid()}`,
          name: `${source.name} 副本`,
          x: source.x + 20,
          y: source.y + 20,
          locked: false,
        },
        state.componentPackages,
      )
      const copiedClickRules = state.editingScope === 'scene'
        ? (currentScene(state)?.interactions ?? [])
            .filter((rule) => (
              rule.trigger.type === 'node.click' && rule.trigger.nodeId === nodeId
            ))
            .map((rule) => ({
              ...structuredClone(rule),
              id: `rule_${nanoid()}`,
              trigger: { type: 'node.click' as const, nodeId: copy.id },
            }))
        : state.project.globalInteractions
            .filter((rule) => (
              rule.trigger.type === 'node.click' && rule.trigger.nodeId === nodeId
            ))
            .map((rule) => ({
              ...structuredClone(rule),
              id: `rule_${nanoid()}`,
              trigger: { type: 'node.click' as const, nodeId: copy.id },
            }))
      if (state.editingScope === 'global') {
        const placement = state.project.globalLayer.find(
          (instance) => instance.node.id === nodeId,
        )
        if (!placement) return
        commit((draft) => {
          draft.globalLayer.push({
            ...structuredClone(placement),
            node: copy as typeof placement.node,
          })
          draft.globalInteractions.push(...copiedClickRules)
        }, copy.id)
      } else {
        commit((draft) => {
          const scene = draft.scenes.find((scene) => scene.id === sceneId)
          if (scene) {
            appendNodesToScene(
              scene as SceneDocument,
              [copy],
              state.activePresentationStateId,
            )
            scene.interactions.push(...copiedClickRules)
          }
        }, copy.id)
      }
      set({
        activeTab: 'properties',
        statusMessage: state.editingScope === 'global'
          ? `已复制全局元素“${source.name}”`
          : `已复制“${source.name}”`,
      })
    },

    duplicateSelectedNodes() {
      if (selectSlideAuthoringBackend(get())) {
        runCandidateAction('duplicate')
        return
      }
      const state = get()
      const selected = editingNodes(state).filter((node) => state.selectedNodeIds.includes(node.id))
      if (selected.length === 0) return
      if (editingNodes(state).length + selected.length > MAX_SCENE_NODES) {
        set({
          errorMessage: state.editingScope === 'global'
            ? `复制后将超过全局层 ${MAX_SCENE_NODES} 个元素的上限。`
            : `复制后将超过每场景 ${MAX_SCENE_NODES} 个图层的上限。`,
        })
        return
      }
      const copies = selected.map((source) => normalizeNewNodeGeometry({
        ...structuredClone(source),
        id: `${source.type}_${nanoid()}`,
        name: `${source.name} 副本`,
        x: source.x + 20,
        y: source.y + 20,
        locked: false,
      }, state.componentPackages))
      const copiedNodeIds = new Map(
        selected.map((source, index) => [source.id, copies[index]!.id]),
      )
      const copiedClickRules = state.editingScope === 'scene'
        ? (currentScene(state)?.interactions ?? []).flatMap((rule) => {
            if (rule.trigger.type !== 'node.click') return []
            const copiedNodeId = copiedNodeIds.get(rule.trigger.nodeId)
            if (!copiedNodeId) return []
            return [{
              ...structuredClone(rule),
              id: `rule_${nanoid()}`,
              trigger: {
                type: 'node.click' as const,
                nodeId: copiedNodeId,
              },
            }]
          })
        : state.project.globalInteractions.flatMap((rule) => {
            if (rule.trigger.type !== 'node.click') return []
            const copiedNodeId = copiedNodeIds.get(rule.trigger.nodeId)
            if (!copiedNodeId) return []
            return [{
              ...structuredClone(rule),
              id: `rule_${nanoid()}`,
              trigger: {
                type: 'node.click' as const,
                nodeId: copiedNodeId,
              },
            }]
          })
      const sceneId = state.activeSceneId
      if (state.editingScope === 'global') {
        const placements = new Map(
          state.project.globalLayer.map((item) => [item.node.id, item]),
        )
        commit((draft) => {
          copies.forEach((node, index) => {
            const sourcePlacement = placements.get(selected[index]!.id)
            if (!sourcePlacement) return
            draft.globalLayer.push({
              ...structuredClone(sourcePlacement),
              node,
            })
          })
          draft.globalInteractions.push(...copiedClickRules)
        })
      } else {
        commit((draft) => {
          const scene = draft.scenes.find((scene) => scene.id === sceneId)
          if (scene) {
            appendNodesToScene(
              scene as SceneDocument,
              copies,
              state.activePresentationStateId,
            )
            scene.interactions.push(...copiedClickRules)
          }
        })
      }
      set({
        selectedNodeIds: copies.map((node) => node.id),
        selectedNodeId: copies.at(-1)?.id ?? null,
        activeTab: 'properties',
        statusMessage: state.editingScope === 'global'
          ? `已复制 ${copies.length} 个全局元素`
          : `已复制 ${copies.length} 个图层`,
      })
    },

    copySelectedNodes() {
      if (selectSlideAuthoringBackend(get()) && get().editingScope !== 'global') {
        runCandidateAction('copy')
        return
      }
      const state = get()
      const selected = editingNodes(state).filter((node) => state.selectedNodeIds.includes(node.id))
      if (selected.length === 0) return
      if (state.editingScope === 'global') {
        const ids = new Set(selected.map((node) => node.id))
        const placements = state.project.globalLayer.filter((item) => ids.has(item.node.id))
        set({
          clipboardNodes: [],
          clipboardGlobalItems: structuredClone(placements),
          clipboardInteractionRules: structuredClone(
            state.project.globalInteractions.filter((rule) => (
              'nodeId' in rule.trigger && ids.has(rule.trigger.nodeId)
            )),
          ),
          statusMessage: `已复制 ${placements.length} 个全局元素到剪贴板`,
        })
      } else {
        const ids = new Set(selected.map((node) => node.id))
        set({
          clipboardNodes: structuredClone(selected),
          clipboardGlobalItems: [],
          clipboardInteractionRules: structuredClone(
            (currentScene(state)?.interactions ?? []).filter((rule) => (
              'nodeId' in rule.trigger && ids.has(rule.trigger.nodeId)
            )),
          ),
          statusMessage: `已复制 ${selected.length} 个图层到剪贴板`,
        })
      }
    },

    pasteNodes() {
      if (selectSlideAuthoringBackend(get()) && get().editingScope !== 'global') {
        runCandidateAction('paste')
        return
      }
      if (selectSlideAuthoringBackend(get()) && get().editingScope === 'global') {
        const state = get()
        if (state.clipboardGlobalItems.length === 0) return
        if (state.project.globalLayer.length + state.clipboardGlobalItems.length > MAX_SCENE_NODES) {
          set({ errorMessage: `粘贴后将超过全局层 ${MAX_SCENE_NODES} 个元素的上限。` })
          return
        }
        const copies = state.clipboardGlobalItems.map((source) => ({
          ...structuredClone(source),
          node: normalizeNewNodeGeometry({
            ...structuredClone(source.node),
            id: `${source.node.type}_${nanoid()}`,
            name: `${source.node.name} 副本`,
            x: source.node.x + 20,
            y: source.node.y + 20,
            locked: false,
          }, state.componentPackages),
        }))
        const nodeIdMap = new Map(
          state.clipboardGlobalItems.map((source, index) => [
            source.node.id,
            copies[index]!.node.id,
          ]),
        )
        const copiedRules = state.clipboardInteractionRules.map((rule) =>
          rewriteInteractionRuleForNodeCopy(rule, nodeIdMap),
        )
        runV9DocumentMutation((draft) => {
          for (const copy of copies) {
            appendGlobalCourseNode(draft, copy.node)
            const entry = draft.globalLayerItems.find(
              (item) => item.item.layerItemId === copy.node.id,
            )
            if (entry) {
              entry.visibility = locationVisibilityFromScenePatch(draft, copy.visibility)
            }
          }
          draft.globalInteractions.push(...copiedRules)
        }, {
          selectionIds: copies.map((instance) => instance.node.id),
          scope: 'global',
          statusMessage: `已粘贴 ${copies.length} 个全局元素`,
        })
        return
      }
      const state = get()
      if (state.editingScope === 'global') {
        if (state.clipboardGlobalItems.length === 0) return
        if (state.project.globalLayer.length + state.clipboardGlobalItems.length > MAX_SCENE_NODES) {
          set({ errorMessage: `粘贴后将超过全局层 ${MAX_SCENE_NODES} 个元素的上限。` })
          return
        }
        const copies = state.clipboardGlobalItems.map((source) => ({
          ...structuredClone(source),
          node: normalizeNewNodeGeometry({
            ...structuredClone(source.node),
            id: `${source.node.type}_${nanoid()}`,
            name: `${source.node.name} 副本`,
            x: source.node.x + 20,
            y: source.node.y + 20,
            locked: false,
          }, state.componentPackages),
        }))
        const nodeIdMap = new Map(
          state.clipboardGlobalItems.map((source, index) => [
            source.node.id,
            copies[index]!.node.id,
          ]),
        )
        const copiedRules = state.clipboardInteractionRules.map((rule) =>
          rewriteInteractionRuleForNodeCopy(rule, nodeIdMap),
        )
        commit((draft) => {
          draft.globalLayer.push(...copies as GlobalLayerItem[])
          draft.globalInteractions.push(...copiedRules)
        })
        set({
          selectedNodeIds: copies.map((instance) => instance.node.id),
          selectedNodeId: copies.at(-1)?.node.id ?? null,
          activeTab: 'properties',
          statusMessage: `已粘贴 ${copies.length} 个全局元素`,
        })
        return
      }
      if (state.clipboardNodes.length === 0) return
      if ((currentScene(state)?.nodes.length ?? 0) + state.clipboardNodes.length > MAX_SCENE_NODES) {
        set({ errorMessage: `粘贴后将超过每场景 ${MAX_SCENE_NODES} 个图层的上限。` })
        return
      }
      const copies = state.clipboardNodes.map((source) => normalizeNewNodeGeometry({
        ...structuredClone(source),
        id: `${source.type}_${nanoid()}`,
        name: `${source.name} 副本`,
        x: source.x + 20,
        y: source.y + 20,
        locked: false,
      }, state.componentPackages))
      const nodeIdMap = new Map(
        state.clipboardNodes.map((source, index) => [source.id, copies[index]!.id]),
      )
      const copiedRules = state.clipboardInteractionRules.map((rule) =>
        rewriteInteractionRuleForNodeCopy(rule, nodeIdMap),
      )
      const sceneId = state.activeSceneId
      commit((draft) => {
        const scene = draft.scenes.find((scene) => scene.id === sceneId)
        if (scene) {
          appendNodesToScene(
            scene as SceneDocument,
            copies,
            state.activePresentationStateId,
          )
          scene.interactions.push(...copiedRules)
        }
      })
      set({ selectedNodeIds: copies.map((node) => node.id), selectedNodeId: copies.at(-1)?.id ?? null, activeTab: 'properties', statusMessage: `已粘贴 ${copies.length} 个图层` })
    },

    nudgeSelection(dx, dy) {
      const state = get()
      const nodes = editingNodes(state).filter(
        (node) => state.selectedNodeIds.includes(node.id) && !node.locked,
      )
      get().updateNodes(nodes.map((node) => ({
        nodeId: node.id,
        patch: { x: node.x + dx, y: node.y + dy },
      })))
    },

    alignSelection(mode) {
      const state = get()
      const nodes = editingNodes(state).filter((node) => state.selectedNodeIds.includes(node.id) && !node.locked)
      if (nodes.length < 2) return
      const boundsById = new Map(
        nodes.map((node) => [node.id, rotatedRectangleAabb(node)]),
      )
      const bounds = [...boundsById.values()]
      const left = Math.min(...bounds.map((item) => item.left))
      const right = Math.max(...bounds.map((item) => item.right))
      const top = Math.min(...bounds.map((item) => item.top))
      const bottom = Math.max(...bounds.map((item) => item.bottom))
      const translations = new Map<string, { dx: number; dy: number }>()
      for (const node of nodes) {
        const visual = boundsById.get(node.id)!
        let dx = 0
        let dy = 0
        if (mode === 'left') dx = left - visual.left
        else if (mode === 'center') dx = (left + right) / 2 - visual.centerX
        else if (mode === 'right') dx = right - visual.right
        else if (mode === 'top') dy = top - visual.top
        else if (mode === 'middle') dy = (top + bottom) / 2 - visual.centerY
        else dy = bottom - visual.bottom
        translations.set(node.id, { dx, dy })
      }
      get().updateNodes(nodes.map((node) => {
        const translation = translations.get(node.id)!
        return {
          nodeId: node.id,
          patch: {
            x: node.x + translation.dx,
            y: node.y + translation.dy,
          },
        }
      }))
      set({ statusMessage: `已对齐 ${nodes.length} 个图层` })
    },

    distributeSelection(axis) {
      const state = get()
      const nodes = editingNodes(state).filter((node) => state.selectedNodeIds.includes(node.id) && !node.locked)
      if (nodes.length < 3) return
      const boundsById = new Map(
        nodes.map((node) => [node.id, rotatedRectangleAabb(node)]),
      )
      const sorted = [...nodes].sort((a, b) => {
        const aBounds = boundsById.get(a.id)!
        const bBounds = boundsById.get(b.id)!
        return axis === 'horizontal'
          ? aBounds.left - bBounds.left
          : aBounds.top - bBounds.top
      })
      const firstBounds = boundsById.get(sorted[0]!.id)!
      const lastBounds = boundsById.get(sorted.at(-1)!.id)!
      const span = axis === 'horizontal'
        ? lastBounds.right - firstBounds.left
        : lastBounds.bottom - firstBounds.top
      const totalSize = sorted.reduce((sum, node) => {
        const visual = boundsById.get(node.id)!
        return sum + (axis === 'horizontal' ? visual.width : visual.height)
      }, 0)
      const gap = (span - totalSize) / (sorted.length - 1)
      const translations = new Map<string, number>()
      let cursor = axis === 'horizontal' ? firstBounds.left : firstBounds.top
      for (const node of sorted) {
        const visual = boundsById.get(node.id)!
        const current = axis === 'horizontal' ? visual.left : visual.top
        translations.set(node.id, cursor - current)
        cursor += (axis === 'horizontal' ? visual.width : visual.height) + gap
      }
      get().updateNodes(nodes.map((node) => {
        const delta = translations.get(node.id) ?? 0
        return {
          nodeId: node.id,
          patch: axis === 'horizontal'
            ? { x: node.x + delta }
            : { y: node.y + delta },
        }
      }))
      set({ statusMessage: `已等距分布 ${nodes.length} 个图层` })
    },

    updateNodes(patches) {
      const spatial = get().spatialSession
      if (spatial) {
        if (patches.length === 0) return
        const document = spatial.history.present
        const selectedIds = new Set(spatial.selection.selectionIds)
        const requestedIds = patches.map((item) => item.nodeId)
        const rejectPropertyUpdate = (reason: string) => {
          persistSpatialResult(rejectSpatialCommand(spatial, reason))
        }
        if (new Set(requestedIds).size !== requestedIds.length) {
          rejectPropertyUpdate('invalid-selection')
          return
        }
        const currentNodes = new Map(
          spatialEditingNodes(spatial, get().spatialContentEdit).map((node) => [node.id, node]),
        )
        const updates = [] as Array<{
          target: ReturnType<typeof commandTargetForRow>
          patch: EffectiveLayerPropertyPatch
        }>
        for (const item of patches) {
          const row = findCandidateLayerRow(get(), item.nodeId)
          if (!row) {
            rejectPropertyUpdate('invalid-target')
            return
          }
          const directRowPatch = isSpatialDirectRowPropertyPatch(item.patch)
          if (!directRowPatch) {
            if (!selectedIds.has(item.nodeId)) {
              rejectPropertyUpdate('invalid-selection')
              return
            }
            const owner = spatialSelectionScopeForRow(spatial, row)
            if (owner !== spatial.scope) {
              rejectPropertyUpdate('wrong-owner')
              return
            }
          }
          const node = directRowPatch
            ? courseLayerItemToSceneNode(row.item)
            : currentNodes.get(item.nodeId) ?? null
          if (!node && !directRowPatch) {
            rejectPropertyUpdate('invalid-target')
            return
          }
          const planned = spatialLayerPropertyPatch(node, item.patch)
          if (!planned.ok) {
            rejectPropertyUpdate(planned.reason)
            return
          }
          updates.push({ target: commandTargetForRow(row), patch: planned.patch })
        }
        const result = patchEffectiveLayerItems(document, updates, {
          expectedRevision: document.revision,
        })
        if (result.ok && !result.historyEntry) {
          set({ errorMessage: null, statusMessage: '属性未变化' })
          return
        }
        persistSpatialLayerCommand(result, {
          statusMessage: `已更新 ${updates.length} 个图层属性`,
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        if (patches.length === 0) return
        const document = flow.history.present
        const revision = document.revision
        const lockPatches = patches.filter((item) => item.patch.locked !== undefined)
        const visiblePatches = patches.filter((item) => item.patch.visible !== undefined)
        for (const item of lockPatches) {
          const row = findCandidateLayerRow(get(), item.nodeId)
          if (!row) continue
          persistFlowLayerCommand(patchEffectiveLayerItem(
            get().flowSession?.history.present ?? document,
            commandTargetForRow(row),
            { locked: Boolean(item.patch.locked) },
            { expectedRevision: get().flowSession?.history.present.revision ?? revision },
          ))
        }
        for (const item of visiblePatches) {
          const row = findCandidateLayerRow(get(), item.nodeId)
          if (!row) continue
          persistFlowLayerCommand(patchEffectiveLayerItem(
            get().flowSession?.history.present ?? document,
            commandTargetForRow(row),
            { visible: Boolean(item.patch.visible) },
            { expectedRevision: get().flowSession?.history.present.revision ?? revision },
          ))
        }
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        if (patches.length === 0) return
        const snapshot = backend.getSnapshot()
        if (get().editingScope === 'scene' && snapshot.stateId !== null) {
          runV9DocumentMutation((draft) => {
            for (const item of patches) {
              applySceneNodePatchToCourseOverride(
                draft,
                snapshot.sceneId,
                snapshot.stateId!,
                item.nodeId,
                item.patch,
                get().componentPackages,
              )
            }
          })
          return
        }
        const document = backend.getSession().history.present
        const globalIds = new Set(
          document.globalLayerItems.map((entry) => entry.item.layerItemId),
        )
        const roundTripPatches = patches.filter((item) => (
          globalIds.has(item.nodeId) || v9NodePatchNeedsRoundTrip(item.patch)
        ))
        if (roundTripPatches.length > 0) {
          runV9DocumentMutation((draft) => {
            for (const item of roundTripPatches) {
              const layer = findMutableCourseLayerItem(draft, item.nodeId)
              if (!layer || (layer.locked && item.patch.locked !== false)) continue
              applySceneNodePatchToLayerItem(layer, item.patch, get().componentPackages)
              constrainRoundTripTeacherControllerFrame(layer, item.patch)
            }
            synchronizeCourseTeacherControllerControls(draft)
          })
        }
        const remaining = patches.filter((item) => (
          !roundTripPatches.some((candidate) => candidate.nodeId === item.nodeId)
        ))
        if (remaining.length === 0) return
        const revision = backend.getSnapshot().revision
        const lockPatches = remaining.filter((item) => item.patch.locked !== undefined)
        const visiblePatches = remaining.filter((item) => item.patch.visible !== undefined)
        const framePatches = remaining.filter((item) => (
          item.patch.x !== undefined ||
          item.patch.y !== undefined ||
          item.patch.width !== undefined ||
          item.patch.height !== undefined ||
          item.patch.rotation !== undefined
        ))
        for (const item of lockPatches) {
          const row = findCandidateLayerRow(get(), item.nodeId)
          if (!row) continue
          persistLayerCommand(patchEffectiveLayerItem(
            selectSlideAuthoringBackend(get())?.getSession().history.present ?? document,
            commandTargetForRow(row),
            { locked: Boolean(item.patch.locked) },
            { expectedRevision: selectSlideAuthoringBackend(get())?.getSnapshot().revision ?? revision },
          ))
        }
        const controllerPatches = framePatches.filter((item) => (
          findCandidateLayerRow(get(), item.nodeId)?.isTeacherController
        ))
        const sceneFramePatches = framePatches.filter((item) => (
          !findCandidateLayerRow(get(), item.nodeId)?.isTeacherController
        ))
        const live = selectSlideAuthoringBackend(get()) ?? backend
        for (const item of controllerPatches) {
          const row = findCandidateLayerRow(get(), item.nodeId)
          if (!row || row.item.kind !== 'native') continue
          persistCandidateResult(commitTeacherControllerAuthoringFrame(live.getSession(), {
            layerItemId: item.nodeId,
            frame: {
              x: typeof item.patch.x === 'number' ? item.patch.x : row.item.frame.x,
              y: typeof item.patch.y === 'number' ? item.patch.y : row.item.frame.y,
              width: typeof item.patch.width === 'number' ? item.patch.width : row.item.frame.width,
              height: typeof item.patch.height === 'number' ? item.patch.height : row.item.frame.height,
            },
            rotation: typeof item.patch.rotation === 'number' ? item.patch.rotation : row.item.rotation,
          }, { expectedRevision: live.getSnapshot().revision }))
        }
        const contentPatches = remaining.filter((item) => (
          ('text' in item.patch && item.patch.text !== undefined) ||
          ('style' in item.patch && item.patch.style !== undefined) ||
          item.patch.name !== undefined
        ))
        if (sceneFramePatches.length > 0 || contentPatches.length > 0) {
          const neededIds = [...new Set([
            ...sceneFramePatches.map((item) => item.nodeId),
            ...contentPatches.map((item) => item.nodeId),
          ])]
          const liveForSelect = selectSlideAuthoringBackend(get()) ?? backend
          const selected = new Set(liveForSelect.getSnapshot().selection.selectionIds)
          if (neededIds.some((id) => !selected.has(id))) {
            persistCandidateResult(liveForSelect.selectLayers(neededIds, false, {
              expectedRevision: liveForSelect.getSnapshot().revision,
            }))
          }
          runCandidateSession((session) => {
            let next = session
            if (sceneFramePatches.length > 0) {
              const current = new Map(
                projectV9EditingNodes(createSlideAuthoringBackend(next)).map((node) => [node.id, node]),
              )
              const transformed = transformSlideNativeLayers(next, {
                nodes: sceneFramePatches.flatMap((item) => {
                  const node = current.get(item.nodeId)
                  if (!node) return []
                  return [{
                    nodeId: item.nodeId,
                    x: typeof item.patch.x === 'number' ? item.patch.x : node.x,
                    y: typeof item.patch.y === 'number' ? item.patch.y : node.y,
                    width: typeof item.patch.width === 'number' ? item.patch.width : node.width,
                    height: typeof item.patch.height === 'number' ? item.patch.height : node.height,
                    rotation: typeof item.patch.rotation === 'number'
                      ? item.patch.rotation
                      : node.rotation,
                  }]
                }),
              }, { expectedRevision: next.history.present.revision })
              if (!transformed.ok) return transformed
              next = transformed.nextSession ?? next
            }
            for (const item of contentPatches) {
              const nativeData: Record<string, unknown> = {}
              if ('text' in item.patch && typeof item.patch.text === 'string') {
                nativeData.text = item.patch.text
              }
              if ('style' in item.patch && item.patch.style) {
                nativeData.style = item.patch.style
              }
              const contentResult = updateSlideNativeLayerContent(
                next,
                item.nodeId,
                {
                  nativeData,
                  ...(typeof item.patch.name === 'string' ? { label: item.patch.name } : {}),
                },
                { expectedRevision: next.history.present.revision },
              )
              if (!contentResult.ok) return contentResult
              next = contentResult.nextSession ?? next
            }
            if (next.history.present === session.history.present) {
              return {
                ok: true,
                historyEntry: false,
                nextSession: next,
                selection: next.selection,
              }
            }
            return {
              ok: true,
              historyEntry: true,
              nextSession: {
                ...next,
                history: commitSlideAuthoringHistory(session.history, next.history.present),
              },
              selection: next.selection,
            }
          })
        }
        for (const item of visiblePatches) {
          const row = findCandidateLayerRow(get(), item.nodeId)
          if (!row) continue
          persistLayerCommand(patchEffectiveLayerItem(
            selectSlideAuthoringBackend(get())?.getSession().history.present ?? document,
            commandTargetForRow(row),
            { visible: Boolean(item.patch.visible) },
            { expectedRevision: selectSlideAuthoringBackend(get())?.getSnapshot().revision ?? revision },
          ))
        }
        return
      }
      if (patches.length === 0) return
      const state = get()
      const sceneId = state.activeSceneId
      const byId = new Map(patches.map((item) => [item.nodeId, item.patch]))
      const effectiveById = new Map(
        editingNodes(state).map((node) => [node.id, node]),
      )
      const scene = currentScene(state)
      const stateOverrides = new Map<string, SceneNodeOverride | undefined>()
      if (
        state.editingScope === 'scene' &&
        state.activePresentationStateId !== null &&
        scene
      ) {
        const baseById = new Map(scene.nodes.map((node) => [node.id, node]))
        for (const [nodeId, patch] of byId) {
          const previous = effectiveById.get(nodeId)
          const baseNode = baseById.get(nodeId)
          if (!previous || !baseNode) continue
          const next = normalizeNodeGeometry(
            previous,
            patchSceneNode(previous, patch),
            patch,
            state.componentPackages,
          )
          stateOverrides.set(nodeId, deriveSceneNodeOverride(baseNode, next))
        }
      }
      commit((draft) => {
        if (state.editingScope === 'global') {
          for (const instance of draft.globalLayer) {
            const patch = byId.get(instance.node.id)
            if (!patch) continue
            instance.node = normalizeNodeGeometry(
              instance.node,
              patchSceneNode(instance.node, patch),
              patch,
              state.componentPackages,
            ) as typeof instance.node
          }
        } else {
          const draftScene = draft.scenes.find((item) => item.id === sceneId)
          if (!draftScene) return
          if (state.activePresentationStateId !== null) {
            for (const [nodeId, override] of stateOverrides) {
              setPresentationNodeOverride(
                draftScene as SceneDocument,
                state.activePresentationStateId,
                nodeId,
                override,
              )
            }
            return
          }
          draftScene.nodes = draftScene.nodes.map((node) => {
            const patch = byId.get(node.id)
            return patch
              ? normalizeNodeGeometry(node, patchSceneNode(node, patch), patch, state.componentPackages)
              : node
          })
        }
      })
    },

    updateNode(nodeId, patch) {
      get().updateNodes([{ nodeId, patch }])
    },

    updateGlobalLayerSettings(nodeId, patch) {
      const persistCandidatePlane = (
        document: CourseProjectDocument,
        persist: (result: LayerCommandResult) => unknown,
        revision: number,
      ) => {
        if (patch.layer === undefined) return
        const row = findCandidateLayerRow(get(), nodeId)
        if (!row || row.owner !== 'global') return
        persist(setGlobalLayerScenePlane(
          document,
          commandTargetForRow(row),
          patch.layer,
          { expectedRevision: revision },
        ))
      }
      const spatial = get().spatialSession
      if (spatial) {
        persistCandidatePlane(
          spatial.history.present,
          persistSpatialLayerCommand,
          spatial.history.present.revision,
        )
        if (patch.visibility) {
          get().setCandidateGlobalLayerLocationVisibility(
            nodeId,
            locationVisibilityFromScenePatch(spatial.history.present, patch.visibility),
          )
        }
        return
      }
      const flow = get().flowSession
      if (flow) {
        persistCandidatePlane(
          flow.history.present,
          persistFlowLayerCommand,
          flow.history.present.revision,
        )
        if (patch.visibility) {
          get().setCandidateGlobalLayerLocationVisibility(
            nodeId,
            locationVisibilityFromScenePatch(flow.history.present, patch.visibility),
          )
        }
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        persistCandidatePlane(
          backend.getSession().history.present,
          persistLayerCommand,
          backend.getSnapshot().revision,
        )
        if (patch.visibility) {
          const document = backend.getSession().history.present
          get().setCandidateGlobalLayerLocationVisibility(
            nodeId,
            locationVisibilityFromScenePatch(document, patch.visibility),
          )
        }
        return
      }
      commit((draft) => {
        const instance = draft.globalLayer.find(
          (item) => item.node.id === nodeId,
        )
        if (!instance) return
        if (patch.layer !== undefined) instance.layer = patch.layer
        if (patch.visibility !== undefined) {
          instance.visibility = normalizedVisibility(
            draft.scenes.map((scene) => scene.id),
            patch.visibility,
          )
        }
      })
    },

    reorderNodes(nodeIds) {
      const spatial = get().spatialSession
      if (spatial) {
        const projection = buildCandidateEffectiveLayers(get())
        const first = projection?.unifiedRows.find((row) => row.id === nodeIds[0])
        if (!first) return
        persistSpatialLayerCommand(reorderEffectiveLayerItems(
          spatial.history.present,
          commandTargetForRow(first),
          nodeIds,
          { expectedRevision: spatial.history.present.revision },
        ))
        return
      }
      const flow = get().flowSession
      if (flow) {
        const projection = buildCandidateEffectiveLayers(get())
        const first = projection?.unifiedRows.find((row) => row.id === nodeIds[0])
        if (!first) return
        persistFlowLayerCommand(reorderEffectiveLayerItems(
          flow.history.present,
          commandTargetForRow(first),
          nodeIds,
          { expectedRevision: flow.history.present.revision },
        ))
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        if (get().editingScope === 'global') {
          const projection = buildCandidateEffectiveLayers(get())
          if (!projection) return
          const first = projection.unifiedRows.find((row) => row.id === nodeIds[0])
          if (!first) return
          if (nodeIds.some((id) => {
            const row = projection.unifiedRows.find((candidate) => candidate.id === id)
            return !row || row.ownerKey !== first.ownerKey
          })) {
            persistLayerCommand({
              ok: false,
              reason: CROSS_OWNER_REORDER_REASON,
              historyEntry: false,
            })
            return
          }
          persistLayerCommand(reorderEffectiveLayerItems(
            backend.getSession().history.present,
            commandTargetForRow(first),
            nodeIds,
            { expectedRevision: backend.getSnapshot().revision },
          ))
          return
        }
        runCandidateAction('reorder', { orderedLayerItemIds: nodeIds })
        return
      }
      const state = get()
      const nodes = editingNodes(state)
      if (!sameIds(nodes.map((node) => node.id), nodeIds)) return
      const sceneId = state.activeSceneId
      commit((draft) => {
        if (state.editingScope === 'global') {
          const byId = new Map(
            draft.globalLayer.map((item) => [item.node.id, item]),
          )
          draft.globalLayer = nodeIds.map((id) => byId.get(id)!)
        } else {
          const target = draft.scenes.find((item) => item.id === sceneId)
          if (target) {
            if (state.activePresentationStateId !== null) {
              const presentationState = mutablePresentationState(
                target as SceneDocument,
                state.activePresentationStateId,
              )
              if (presentationState) {
                const baseOrder = target.nodes.map((node) => node.id)
                presentationState.nodeOrder = baseOrder.every(
                  (nodeId, index) => nodeIds[index] === nodeId,
                )
                  ? undefined
                  : [...nodeIds]
              }
            } else {
              const byId = new Map(target.nodes.map((node) => [node.id, node]))
              target.nodes = nodeIds.map((id) => byId.get(id)!)
            }
          }
        }
      })
    },

    selectNode(selectedNodeId, additive = false) {
      const spatial = get().spatialSession
      if (spatial) {
        const preflightProjection = buildCandidateEffectiveLayers(get())
        const preflightRow = selectedNodeId === null
          ? null
          : preflightProjection?.unifiedRows.find((candidate) => candidate.id === selectedNodeId) ?? null
        if (selectedNodeId !== null && !preflightRow) {
          return
        }
        const preflightScope = preflightRow
          ? spatialSelectionScopeForRow(spatial, preflightRow)
          : spatial.scope
        if (!preflightScope) {
          set({ errorMessage: '所选图层的作者地址已失效，请重新选择。', statusMessage: null })
          return
        }
        if (
          additive &&
          spatial.selection.selectionIds.length > 0 &&
          spatial.scope !== preflightScope
        ) {
          set({ errorMessage: SPATIAL_CROSS_OWNER_SELECTION_REASON, statusMessage: null })
          return
        }
        persistOpenSpatialContentEdit()
        const live = get().spatialSession ?? spatial
        const projection = buildCandidateEffectiveLayers(get())
        const row = selectedNodeId === null
          ? null
          : projection?.unifiedRows.find((candidate) => candidate.id === selectedNodeId) ?? null
        if (selectedNodeId !== null && !row) return
        const desiredScope = row ? spatialSelectionScopeForRow(live, row) : live.scope
        if (!desiredScope) {
          set({ errorMessage: '所选图层的作者地址已失效，请重新选择。', statusMessage: null })
          return
        }
        let selectionSession = live
        if (selectionSession.scope !== desiredScope) {
          const scoped = setSpatialEditingScope(selectionSession, desiredScope)
          if (!scoped.ok || !scoped.nextSession) {
            persistSpatialResult(scoped)
            return
          }
          selectionSession = scoped.nextSession
        }
        const result = selectSpatialLayers(selectionSession, {
          layerItemIds: selectedNodeId === null ? [] : [selectedNodeId],
          additive: selectedNodeId !== null && additive,
        }, {
          expectedRevision: selectionSession.history.present.revision,
        })
        const persisted = persistSpatialResult(result)
        if (!persisted.ok) return
        const selectedNodeIds = persisted.nextSession?.selection.selectionIds ?? []
        set({
          activeTab: selectedNodeIds.length > 0 ? 'properties' : get().activeTab,
          spatialGraphSelection: selectedNodeIds.length > 0 ? null : get().spatialGraphSelection,
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const projection = buildCandidateEffectiveLayers(get())
        const available = new Set(projection?.unifiedRows.map((row) => row.id) ?? [])
        if (selectedNodeId !== null && !available.has(selectedNodeId)) {
          return
        }
        const previous = get().selectedNodeIds
        const selectedNodeIds = selectedNodeId === null
          ? []
          : additive
            ? previous.includes(selectedNodeId)
              ? previous.filter((id) => id !== selectedNodeId)
              : [...previous, selectedNodeId]
            : [selectedNodeId]
        const document = flow.history.present
        const row = selectedNodeId ? projection?.unifiedRows.find((item) => item.id === selectedNodeId) : null
        persistFlowResult({
          ok: true,
          nextDocument: document,
          historyEntry: false,
          selection: selectedNodeIds.length > 0
            ? selectFlowOverlay(
                document,
                flow.selection.locationId,
                selectedNodeIds,
                row?.owner === 'global' ? 'global' : 'page',
              )
            : selectFlowEditorBlock(
                document,
                flow.selection.locationId,
                flowLocationBlockId(document.locations, flow.selection.locationId)
                  ?? flow.selection.selectedBlockId
                  ?? flow.selection.locationId,
              ),
        }, { clearTextEdit: true })
        set({ activeTab: selectedNodeIds.length > 0 ? 'properties' : get().activeTab })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const projection = buildCandidateEffectiveLayers(get())
        const available = new Set(projection?.unifiedRows.map((row) => row.id) ?? [])
        if (selectedNodeId !== null && !available.has(selectedNodeId)) {
          return
        }
        const previous = get().selectedNodeIds
        const selectedNodeIds = selectedNodeId === null
          ? []
          : additive
            ? previous.includes(selectedNodeId)
              ? previous.filter((id) => id !== selectedNodeId)
              : [...previous, selectedNodeId]
            : [selectedNodeId]
        const row = selectedNodeId ? projection?.unifiedRows.find((item) => item.id === selectedNodeId) : null
        const desiredScope = row
          ? (scopeTokenForSelectingRow(projection!.scope, row).owner === 'global' ? 'global' : 'scene')
          : backend.getSession().scope === 'global' ? 'global' : 'scene'
        let nextBackend = commitOpenCandidateContentEdit(selectedNodeIds)
        if (!nextBackend) return
        if ((nextBackend.getSession().scope === 'global') !== (desiredScope === 'global')) {
          persistCandidateResult(nextBackend.setScope(desiredScope, {
            expectedRevision: nextBackend.getSnapshot().revision,
          }))
          nextBackend = selectSlideAuthoringBackend(get())
          if (!nextBackend) return
        }
        persistCandidateResult(nextBackend.selectLayers(selectedNodeIds, false, {
          expectedRevision: nextBackend.getSnapshot().revision,
        }))
        set({ activeTab: selectedNodeIds.length > 0 ? 'properties' : get().activeTab })
        return
      }
      const nodes = editingNodes(get())
      if (
        selectedNodeId !== null &&
        !nodes.some((node) => node.id === selectedNodeId)
      ) {
        return
      }
      const previous = get().selectedNodeIds
      const selectedNodeIds = selectedNodeId === null
        ? []
        : additive
          ? previous.includes(selectedNodeId)
            ? previous.filter((id) => id !== selectedNodeId)
            : [...previous, selectedNodeId]
          : [selectedNodeId]
      set((state) => ({
        ...commitTextEditSessionState(state),
        selectedNodeId: selectedNodeIds.at(-1) ?? null,
        selectedNodeIds,
        editingTextNodeId: null,
        textEditSession: null,
        activeTab: selectedNodeIds.length > 0 ? 'properties' : state.activeTab,
      }))
    },

    selectNodes(nodeIds) {
      const spatial = get().spatialSession
      if (spatial) {
        persistOpenSpatialContentEdit()
        const live = get().spatialSession ?? spatial
        const available = new Set(
          (buildCandidateEffectiveLayers(get())?.unifiedRows ?? []).map((row) => row.id),
        )
        const selectedNodeIds = [...new Set(nodeIds)].filter((id) => available.has(id))
        persistSpatialResult(selectSpatialLayers(live, {
          layerItemIds: selectedNodeIds,
        }, {
          expectedRevision: live.history.present.revision,
        }))
        set({
          activeTab: selectedNodeIds.length > 0 ? 'properties' : get().activeTab,
          spatialGraphSelection: selectedNodeIds.length > 0 ? null : get().spatialGraphSelection,
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const available = new Set(
          (buildCandidateEffectiveLayers(get())?.unifiedRows ?? []).map((row) => row.id),
        )
        const selectedNodeIds = [...new Set(nodeIds)].filter((id) => available.has(id))
        const document = flow.history.present
        const row = selectedNodeIds[0]
          ? buildCandidateEffectiveLayers(get())?.unifiedRows.find((item) => item.id === selectedNodeIds[0])
          : null
        persistFlowResult({
          ok: true,
          nextDocument: document,
          historyEntry: false,
          selection: selectedNodeIds.length > 0
            ? selectFlowOverlay(
                document,
                flow.selection.locationId,
                selectedNodeIds,
                row?.owner === 'global' ? 'global' : 'page',
              )
            : selectFlowEditorBlock(
                document,
                flow.selection.locationId,
                flowLocationBlockId(document.locations, flow.selection.locationId)
                  ?? flow.selection.selectedBlockId
                  ?? flow.selection.locationId,
              ),
        }, { clearTextEdit: true })
        set({ activeTab: selectedNodeIds.length > 0 ? 'properties' : get().activeTab })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const available = new Set(
          (buildCandidateEffectiveLayers(get())?.unifiedRows ?? []).map((row) => row.id),
        )
        const selectedNodeIds = [...new Set(nodeIds)].filter((id) => available.has(id))
        const nextBackend = commitOpenCandidateContentEdit(selectedNodeIds)
        if (!nextBackend) return
        persistCandidateResult(nextBackend.selectLayers(selectedNodeIds, false, {
          expectedRevision: nextBackend.getSnapshot().revision,
        }))
        set({ activeTab: selectedNodeIds.length > 0 ? 'properties' : get().activeTab })
        return
      }
      const available = new Set(editingNodes(get()).map((node) => node.id))
      const selectedNodeIds = [...new Set(nodeIds)].filter((id) => available.has(id))
      set((state) => ({
        ...commitTextEditSessionState(state),
        selectedNodeIds,
        selectedNodeId: selectedNodeIds.at(-1) ?? null,
        editingTextNodeId: null,
        textEditSession: null,
        activeTab: selectedNodeIds.length > 0 ? 'properties' : state.activeTab,
      }))
    },

    undo() {
      const spatial = get().spatialSession
      if (spatial) {
        const before = spatial.history.present
        const resourceTransition = spatialAuthoringUndoResourceTransition(spatial.history)
        const result = undoSpatialAuthoring(spatial)
        const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
        persistSpatialResult(result, {
          clearContentEdit: true,
          ...(moved
            ? resourceTransition
              ? { resourceTransition }
              : { sidecarDirection: 'undo' as const }
            : {}),
          statusMessage: '已撤销',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        const edit = get().flowTextEdit
        if (edit?.composing) return
        if (edit && isFlowTextDraftDirty(edit)) {
          persistFlowResult({
            ok: true,
            nextDocument: flow.history.present,
            historyEntry: false,
            selection: flow.selection,
          }, {
            clearTextEdit: true,
            statusMessage: '已取消本次编辑',
          })
          return
        }
        const resourceTransition = flowEditorUndoResourceTransition(flow.history)
        const nextHistory = undoFlowEditorHistory(flow.history)
        if (nextHistory === flow.history) {
          set({ statusMessage: '已撤销' })
          return
        }
        persistFlowResult({
          ok: true,
          nextDocument: nextHistory.present,
          historyEntry: false,
          selection: flow.selection,
        }, {
          replaceHistory: nextHistory,
          ...(resourceTransition
            ? { resourceTransition }
            : { sidecarDirection: 'undo' as const }),
          clearTextEdit: true,
          statusMessage: '已撤销',
        })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const before = backend.getSession().history.present
        const result = backend.undo()
        const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
        persistCandidateResult(result, {
          clearContentEdit: true,
          ...(moved && !result.resourceTransition
            ? { sidecarDirection: 'undo' as const }
            : {}),
        })
        return
      }
    },

    redo() {
      const spatial = get().spatialSession
      if (spatial) {
        const before = spatial.history.present
        const resourceTransition = spatialAuthoringRedoResourceTransition(spatial.history)
        const result = redoSpatialAuthoring(spatial)
        const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
        persistSpatialResult(result, {
          clearContentEdit: true,
          ...(moved
            ? resourceTransition
              ? { resourceTransition }
              : { sidecarDirection: 'redo' as const }
            : {}),
          statusMessage: '已重做',
        })
        return
      }
      const flow = get().flowSession
      if (flow) {
        if (get().flowTextEdit?.composing) return
        const resourceTransition = flowEditorRedoResourceTransition(flow.history)
        const nextHistory = redoFlowEditorHistory(flow.history)
        if (nextHistory === flow.history) {
          set({ statusMessage: '已重做' })
          return
        }
        persistFlowResult({
          ok: true,
          nextDocument: nextHistory.present,
          historyEntry: false,
          selection: flow.selection,
        }, {
          replaceHistory: nextHistory,
          ...(resourceTransition
            ? { resourceTransition }
            : { sidecarDirection: 'redo' as const }),
          clearTextEdit: true,
          statusMessage: '已重做',
        })
        return
      }
      const backend = selectSlideAuthoringBackend(get())
      if (backend) {
        const before = backend.getSession().history.present
        const result = backend.redo()
        const moved = Boolean(result.ok && result.nextSession && result.nextSession.history.present !== before)
        persistCandidateResult(result, {
          clearContentEdit: true,
          ...(moved && !result.resourceTransition
            ? { sidecarDirection: 'redo' as const }
            : {}),
        })
        return
      }
    },
  }
})

export const selectActiveScene = (state: EditorState) => {
  if (state.slideCandidateUi) return state.slideCandidateUi.activeScene
  return state.project.scenes.find((scene) => scene.id === state.activeSceneId) ??
    state.project.scenes[0]
}

export const selectSlideSceneList = (state: EditorState): SceneDocument[] =>
  state.slideCandidateUi?.scenes ?? state.project.scenes

export const selectEditingNodes = (state: EditorState) =>
  state.slideCandidateUi?.nodes ?? editingNodes(state)

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
): EffectiveLayerProjection | null => state.slideCandidateEffectiveLayers

const EMPTY_CANDIDATE_ASSET_FILES: Record<string, Uint8Array> = Object.freeze({})

export const selectMediaAssets = (state: EditorState) =>
  selectActiveCourseProjectDocument(state)?.assets ?? state.project.assets

export const selectMediaAssetFiles = (state: EditorState): Record<string, Uint8Array> => {
  if (state.spatialSession || state.flowSession || selectSlideAuthoringBackend(state)) {
    return state.slideCandidateSidecar?.files ?? EMPTY_CANDIDATE_ASSET_FILES
  }
  return state.assetFiles
}

export const selectAudioSettings = (state: EditorState) =>
  selectActiveCourseProjectDocument(state)?.media.audio ?? state.project.media.audio

export const selectCandidateGlobalLayerItems = (state: EditorState) =>
  selectActiveCourseProjectDocument(state)?.globalLayerItems ?? null
