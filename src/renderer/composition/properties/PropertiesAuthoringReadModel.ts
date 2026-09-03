import type { CourseAuthoringSessionToken } from '../../authoring/courseAuthoringSession'
import { updateCourseAuthoringSessionRevision } from '../../authoring/courseAuthoringSession'
import type { FlowTextEditSession } from '../../authoring/flowTextEdit'
import type {
  SpatialGraphSelection,
} from '../../authoring/spatialAuthoringIntents'
import type { SpatialWorldContentEditSession } from '../../authoring/spatialWorldAuthoring'
import { findGlobalTeacherController } from '../../authoring/v9TeacherControllerAuthoring'
import { buildFlowEditorView, type FlowEditorView } from '../../course/flowEditorView'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import type { EffectiveLayerProjectionRow } from '../../course/effectiveLayerProjection'
import {
  isTeacherControllerLayerItem,
  readGlobalLayerScenePlane,
} from '../../course/globalLayerCommands'
import {
  buildSpatialEditorView,
  type SpatialEditorView,
} from '../../course/spatialEditorView'
import {
  collectV9InteractionRuleWarnings,
  interactionLayerTargetFromItem,
  type InteractionLayerTarget,
  v9SlideScenes,
} from '../../course/slideInteractionView'
import { selectRuntimeInspectorAuthoringView } from '../../runtime/runtimeInspectorAuthoringView'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectCandidateGlobalLayerItems,
  selectEffectiveLayerProjection,
  selectSlideAuthoringSnapshot,
  type EditorState,
} from '../../store/editorStore'
import { isCourseLayerVisibleAtLocation } from '../../../shared/courseProjectModel'
import type {
  CourseLocation,
  CourseProjectDocument,
  SlideSceneDocument,
} from '../../../shared/courseProjectTypes'
import type { ProjectPlaybackSettings } from '../../../shared/contracts/playback-v1'
import type { V9SlideContentEditSession } from '../../authoring/v9SlideContentEdit'
import type { RuntimeInspectorAuthoringView } from '../../runtime/runtimeInspectorAuthoringView'
import { slideAuthoringGeneration } from '../../course/slideAuthoringBackend'
import type { CourseGlobalLayerView } from '../../ui/properties/CourseGlobalPropertiesPanel'
import {
  propertiesViewFromLayerItem,
} from '../../ui/properties/propertiesItemView'
import type { PropertiesItemView } from '../../ui/properties/SlideNativePropertiesPanel'

export interface FlowPropertiesReadModel {
  /** Internal owner snapshot used only by the composition command adapter. */
  readonly document: CourseProjectDocument
  readonly view: FlowEditorView
  readonly selection: FlowEditorSelection
  readonly assets: CourseProjectDocument['assets']
  readonly textEdit: FlowTextEditSession | null
}

export interface SpatialPropertiesReadModel {
  readonly view: SpatialEditorView
  readonly scope: 'global' | 'surface' | 'world'
  readonly selectionIds: readonly string[]
  readonly contentEdit: SpatialWorldContentEditSession | null
  readonly graphSelection: SpatialGraphSelection | null
  readonly playbackPathId: string | null
  readonly showCameraFrames: boolean
}

export interface PropertiesSceneReadModel {
  readonly id: string
  readonly name: string
  readonly backgroundColor: string
  readonly interactions: SlideSceneDocument['interactions']
  readonly presentation: SlideSceneDocument['presentation']
}

export interface PropertiesOwnerReadModel {
  readonly identity: {
    readonly projectId: string | null
    readonly revision: number
    readonly generation: number
    readonly locationId: string | null
    readonly owner: 'scene' | 'surface' | 'global'
    readonly stateId: string | null
  }
  readonly authoringToken: CourseAuthoringSessionToken | null
  readonly flow: FlowPropertiesReadModel | null
  readonly spatial: SpatialPropertiesReadModel | null
  readonly editorMode: 'simple' | 'professional'
  readonly editingScope: 'scene' | 'global'
  readonly propertiesOwner: 'scene' | 'surface' | 'global'
  readonly selectedNodeIds: readonly string[]
  readonly selectedRows: readonly EffectiveLayerProjectionRow[]
  readonly selectedViews: readonly PropertiesItemView[]
  readonly selectedRow: EffectiveLayerProjectionRow | null
  readonly selectedView: PropertiesItemView | null
  readonly activeState: {
    readonly id: string
    readonly name: string
    readonly backgroundColor: string | null
  } | null
  readonly scene: PropertiesSceneReadModel | null
  readonly slideScenes: ReturnType<typeof v9SlideScenes>
  readonly interactionNodes: readonly InteractionLayerTarget[]
  readonly interactionWarnings: ReturnType<typeof collectV9InteractionRuleWarnings>
  readonly globalInteractions: CourseProjectDocument['globalInteractions']
  readonly globalSourceNodes: readonly InteractionLayerTarget[]
  readonly sounds: CourseProjectDocument['media']['audio']['sounds']
  readonly courseState: CourseProjectDocument['courseState']
  readonly assets: CourseProjectDocument['assets']
  readonly componentManifests: Readonly<Record<string, {
    readonly manifest: EditorState['componentPackages'][string]['manifest']
  }>>
  readonly globalLayer: CourseGlobalLayerView | null
  readonly globalSummary: {
    readonly count: number
    readonly underlayCount: number
    readonly overlayCount: number
    readonly hasTeacherController: boolean
    readonly playback: ProjectPlaybackSettings | undefined
    readonly designTokens: CourseProjectDocument['designTokens'] | null
  }
  readonly selectedIsGlobal: boolean
  readonly runtimeView: RuntimeInspectorAuthoringView | null
  readonly slideSessionIdentity: {
    readonly sessionId: string
    readonly revision: number
    readonly generation: number
    readonly scope: 'scene' | 'surface' | 'global'
    readonly locationId: string
    readonly stateId: string | null
  } | null
  readonly textEdit: V9SlideContentEditSession | null
}

function activeSlideScene(
  project: CourseProjectDocument | null,
  locationId: string | null,
  snapshotSceneId: string | null,
): SlideSceneDocument | null {
  if (!project) return null
  for (const surface of project.surfaces) {
    if (surface.type !== 'slide') continue
    if (snapshotSceneId) {
      const scene = surface.scenes.find((candidate) => candidate.id === snapshotSceneId)
      if (scene) return scene
    }
    if (locationId) {
      const location = project.locations.find((candidate) => candidate.id === locationId)
      if (location?.kind === 'slide-scene' && location.surfaceId === surface.id) {
        return surface.scenes.find((candidate) => candidate.id === location.sceneId) ?? null
      }
    }
    if (surface.scenes[0]) return surface.scenes[0]
  }
  return null
}

function candidateLocationVisibilityLabel(
  location: CourseLocation,
  surfaces: CourseProjectDocument['surfaces'],
): string {
  if (location.kind !== 'slide-scene') return location.label
  const surface = surfaces.find((item) => item.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') return location.label
  return surface.scenes.find((item) => item.id === location.sceneId)?.name ?? location.label
}

function buildGlobalLayerView(
  nodeId: string,
  project: CourseProjectDocument,
  locationId: string,
): CourseGlobalLayerView | null {
  const entry = project.globalLayerItems.find(
    (candidate) => candidate.item.layerItemId === nodeId,
  )
  if (!entry) return null
  return {
    nodeId,
    visibleHere: isCourseLayerVisibleAtLocation(entry, locationId),
    visibility: entry.visibility,
    scenePlane: readGlobalLayerScenePlane(project, nodeId),
    isController: isTeacherControllerLayerItem(entry.item),
    locationKind: project.locations.find((location) => location.id === locationId)?.kind,
    locations: project.locations.map((location) => ({
      id: location.id,
      label: candidateLocationVisibilityLabel(location, project.surfaces),
    })),
  }
}

/**
 * Named, read-only projection for Properties. The complete editor state and
 * Course document stop here; the UI adapter receives only owner views and
 * stable scalar identities.
 */
const propertiesReadModelCache = new WeakMap<EditorState, PropertiesOwnerReadModel>()

export function selectPropertiesAuthoringReadModel(state: EditorState): PropertiesOwnerReadModel {
  const cached = propertiesReadModelCache.get(state)
  if (cached) return cached
  const project = selectActiveCourseProjectDocument(state)
  const locationId = selectActiveCourseLocationId(state)
  const snapshot = selectSlideAuthoringSnapshot(state)
  const projection = selectEffectiveLayerProjection(state)
  const flowSession = state.flowSession
  const spatialSession = state.spatialSession
  const propertiesOwner = !flowSession && !spatialSession && snapshot?.scope
    ? snapshot.scope
    : state.editingScope
  const selectedRows = (projection?.unifiedRows ?? []).filter((row) => (
    state.selectedNodeIds.includes(row.id)
  ))
  const selectedRow = selectedRows.length === 1 ? selectedRows[0]! : null
  const selectedViews = selectedRows.map((row) => propertiesViewFromLayerItem(row.item))
  const selectedView = selectedRow ? propertiesViewFromLayerItem(selectedRow.item) : null
  const scene = activeSlideScene(project, locationId, snapshot?.sceneId ?? null)
  const activeState = state.activePresentationStateId === null
    ? null
    : scene?.presentation?.states.find(
        (candidate) => candidate.id === state.activePresentationStateId,
      ) ?? null
  const candidateGlobalItems = selectCandidateGlobalLayerItems(state)
  const globalEntries = candidateGlobalItems ?? project?.globalLayerItems ?? []
  const globalRows = (projection?.unifiedRows ?? []).filter((row) => row.owner === 'global')
  const globalCount = globalRows.length > 0 ? globalRows.length : globalEntries.length
  const underlayCount = globalRows.filter((row) => row.globalPlane === 'underlay').length
  const runtimeAuthoringSession = project && state.courseAuthoringSession
    ? updateCourseAuthoringSessionRevision(state.courseAuthoringSession, project.revision)
    : null
  const activeLocation = project?.locations.find((candidate) => candidate.id === locationId)
  const runtimeView = project && locationId && runtimeAuthoringSession
    ? selectRuntimeInspectorAuthoringView({
        project,
        locationId,
        editingScope: state.editingScope,
        activeStateId: activeLocation?.kind === 'slide-scene'
          ? state.activePresentationStateId
          : null,
        sessionToken: runtimeAuthoringSession.token,
      })
    : null
  const flow = flowSession
    ? {
        document: flowSession.history.present,
        view: buildFlowEditorView({
          project: flowSession.history.present,
          locationId: flowSession.selection.locationId,
        }),
        selection: flowSession.selection,
        assets: flowSession.history.present.assets,
        textEdit: state.flowTextEdit,
      }
    : null
  const spatial = spatialSession
    ? {
        view: buildSpatialEditorView({
          project: spatialSession.history.present,
          locationId: spatialSession.selection.locationId,
          sessionCamera: spatialSession.sessionCamera,
        }),
        scope: spatialSession.scope,
        selectionIds: spatialSession.selection.selectionIds,
        contentEdit: state.spatialContentEdit,
        graphSelection: state.spatialGraphSelection,
        playbackPathId: state.spatialPlaybackPathId,
        showCameraFrames: spatialSession.showCameraFrames,
      }
    : null
  const selectedIsGlobal = propertiesOwner === 'global'
    || Boolean(globalEntries.some((entry) => entry.item.layerItemId === selectedView?.id))
    || Boolean(selectedRow?.isTeacherController)
  const slideScenes = project ? v9SlideScenes(project) : []
  const interactionNodes = (projection?.unifiedRows ?? []).map((row) => (
    interactionLayerTargetFromItem(row.item)
  ))
  const interactionWarnings = project && scene
    ? collectV9InteractionRuleWarnings(project, scene.interactions)
    : {}
  const controller = project ? findGlobalTeacherController(project) : null
  const result: PropertiesOwnerReadModel = {
    identity: {
      projectId: project?.id ?? null,
      revision: project?.revision ?? 0,
      generation: snapshot
        ? slideAuthoringGeneration(snapshot.sessionId)
        : state.courseAuthoringSession?.token.generation ?? 0,
      locationId,
      owner: propertiesOwner,
      stateId: state.activePresentationStateId,
    },
    authoringToken: state.courseAuthoringSession?.token ?? null,
    flow,
    spatial,
    editorMode: state.editorMode,
    editingScope: state.editingScope,
    propertiesOwner,
    selectedNodeIds: state.selectedNodeIds,
    selectedRows,
    selectedViews,
    selectedRow,
    selectedView,
    activeState: activeState
      ? {
          id: activeState.id,
          name: activeState.name,
          backgroundColor: activeState.backgroundColor ?? null,
        }
      : null,
    scene: scene
      ? {
          id: scene.id,
          name: scene.name,
          backgroundColor: activeState?.backgroundColor ?? scene.backgroundColor,
          interactions: scene.interactions,
          presentation: scene.presentation,
        }
      : null,
    slideScenes,
    interactionNodes,
    interactionWarnings,
    globalInteractions: project?.globalInteractions ?? [],
    globalSourceNodes: globalEntries.map((entry) => interactionLayerTargetFromItem(entry.item)),
    sounds: project?.media.audio.sounds ?? {},
    courseState: project?.courseState ?? [],
    assets: project?.assets ?? {},
    componentManifests: Object.fromEntries(Object.entries(state.componentPackages).map(
      ([id, packed]) => [id, { manifest: packed.manifest }],
    )),
    globalLayer: project && locationId && selectedView
      ? buildGlobalLayerView(selectedView.id, project, locationId)
      : null,
    globalSummary: {
      count: globalCount,
      underlayCount,
      overlayCount: globalCount - underlayCount,
      hasTeacherController: Boolean(controller),
      playback: project?.playback,
      designTokens: project?.designTokens ?? null,
    },
    selectedIsGlobal,
    runtimeView,
    slideSessionIdentity: snapshot
      ? {
          sessionId: snapshot.sessionId,
          revision: snapshot.revision,
          generation: slideAuthoringGeneration(snapshot.sessionId),
          scope: snapshot.scope,
          locationId: snapshot.locationId,
          stateId: snapshot.stateId,
        }
      : null,
    textEdit: state.v9ContentEdit,
  }
  propertiesReadModelCache.set(state, result)
  return result
}
