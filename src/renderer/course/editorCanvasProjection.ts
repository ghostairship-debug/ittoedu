import type { CourseProjectDocument, CourseRuntimeDefinition, LayerItem } from '../../shared/courseProjectTypes'
import type { RuntimeDocument } from '../../shared/runtimeTypes'
import type { EditorCanvasNode, EditorCanvasSceneView } from '../phaser/editorCanvasNode'
import type { FlowAuthoringSession } from '../project/createFlowCourseProject'
import type { SpatialAuthoringSession } from './spatialEditorCommands'
import type { SlideAuthoringBackend, SlideAuthoringSnapshot } from './slideAuthoringBackend'
import { isSlideAuthoringBackend, type SlideBackend } from '../store/slideBackendPort'
import {
  projectEffectiveLayers,
  type EffectiveLayerProjection,
} from './effectiveLayerProjection'
import { buildSpatialEditorView } from './spatialEditorView'
import {
  applyV9SlideContentDraft,
  courseLayerItemToEditorCanvasNode,
  projectV9SlideScenes,
  projectV9EditingNodes,
} from '../store/slideEditorProjection'
import type { V9SlideContentEditSession, V9SlideFormulaContentDraft, V9SlideTextContentDraft } from '../authoring/v9SlideContentEdit'
import type { SpatialWorldContentEditSession } from '../authoring/spatialWorldAuthoring'
import { SESSIONLESS_COURSE_REASON } from '../store/editorStoreKernel'

export type ActiveSurfaceProjectionInput = {
  readonly slideBackend: SlideAuthoringBackend | null
  readonly spatialSession: SpatialAuthoringSession | null
  readonly flowSession: FlowAuthoringSession | null
}

export interface EditorCanvasProjectionState {
  readonly slideBackend: SlideBackend | null
  readonly slideCandidateSnapshot?: SlideAuthoringSnapshot | null
  readonly v9ContentEdit?: V9SlideContentEditSession | null
  readonly spatialSession: SpatialAuthoringSession | null
  readonly spatialContentEdit?: SpatialWorldContentEditSession | null
  readonly flowSession: FlowAuthoringSession | null
}

export interface SlideCandidateUiProjection {
  scenes: EditorCanvasSceneView[]
  activeScene: EditorCanvasSceneView
  nodes: EditorCanvasNode[]
}

export function isV9SlideTextContentDraft(
  draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft,
): draft is V9SlideTextContentDraft {
  return 'text' in draft && 'runs' in draft
}

export function courseRuntimeToDocument(runtime: CourseRuntimeDefinition): RuntimeDocument {
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

export function firstRuntimeItem(items: readonly LayerItem[]): LayerItem | undefined {
  return items.find((item) => item.kind === 'runtime')
}

export function attachProjectedRuntimes(
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

export function spatialEffectiveLayers(
  session: SpatialAuthoringSession,
): EffectiveLayerProjection {
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: null,
    selectedIds: session.selection.selectionIds,
    owner: session.scope,
  })
}

export function flowEffectiveLayers(
  session: FlowAuthoringSession,
): EffectiveLayerProjection {
  return projectEffectiveLayers({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: null,
    selectedIds: [...session.selection.selectedOverlayIds],
    owner: session.selection.authoringScope === 'global' ? 'global' : 'surface',
  })
}

export function buildCandidateEffectiveLayers(
  state: {
    readonly slideBackend?: SlideBackend | null
    readonly spatialSession: SpatialAuthoringSession | null
    readonly flowSession: FlowAuthoringSession | null
  },
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
    owner: session.scope,
  })
}

export function spatialEditingNodes(
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

export function flowEditingNodes(session: FlowAuthoringSession): EditorCanvasNode[] {
  const projection = flowEffectiveLayers(session)
  const wanted = session.selection.authoringScope === 'global' ? 'global' : null
  return projection.unifiedRows.flatMap((row) => {
    if (wanted && row.owner !== wanted) return []
    const node = courseLayerItemToEditorCanvasNode(row.item)
    return node ? [node] : []
  })
}

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

export function slideAuthoringUiFromState(state: EditorCanvasProjectionState): SlideCandidateUiProjection | null {
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
            : applyV9SlideContentDraft(activeScene.nodes, state.v9ContentEdit ?? null),
        },
        nodes: applyV9SlideContentDraft(projectV9EditingNodes(backend), state.v9ContentEdit ?? null),
      }
  cachedSlideUiPresent = present
  cachedSlideUiEdit = state.v9ContentEdit
  cachedSlideUiSceneId = snapshot.sceneId
  cachedSlideUiStateId = snapshot.stateId
  cachedSlideUiScope = snapshot.scope
  cachedSlideUiLocationId = snapshot.locationId
  return cachedSlideUi
}

export function spatialEditingNodesFromState(state: EditorCanvasProjectionState): EditorCanvasNode[] | null {
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
  cachedSpatialNodes = spatialEditingNodes(session, state.spatialContentEdit ?? null)
  return cachedSpatialNodes
}

export function flowEditingNodesFromState(state: EditorCanvasProjectionState): EditorCanvasNode[] | null {
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

export function syntheticActiveScene(
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

export function projectActiveScene(state: EditorCanvasProjectionState): EditorCanvasSceneView {
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

export function projectSlideSceneList(state: EditorCanvasProjectionState): EditorCanvasSceneView[] {
  const slideUi = slideAuthoringUiFromState(state)
  if (slideUi) return slideUi.scenes
  return EMPTY_SLIDE_SCENES
}

const EMPTY_CANVAS_NODES: EditorCanvasNode[] = []

export function projectEditingNodes(state: EditorCanvasProjectionState): EditorCanvasNode[] {
  const slideUi = slideAuthoringUiFromState(state)
  if (slideUi) return slideUi.nodes
  const spatialNodes = spatialEditingNodesFromState(state)
  if (spatialNodes) return spatialNodes
  const flowNodes = flowEditingNodesFromState(state)
  if (flowNodes) return flowNodes
  return EMPTY_CANVAS_NODES
}

let cachedProjectionPresent: object | null = null
let cachedProjectionLocationId = ''
let cachedProjectionStateId: string | null = null
let cachedProjectionScope: string | null = null
let cachedProjectionSelectionKey = ''
let cachedProjectionSurface: 'slide' | 'spatial' | 'flow' | null = null
let cachedProjection: EffectiveLayerProjection | null = null

export function projectEffectiveLayerProjection(
  state: EditorCanvasProjectionState,
): EffectiveLayerProjection | null {
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
  const backend = isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null
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

export function resetEditorCanvasProjectionCache(): void {
  cachedSlideUiPresent = null
  cachedSlideUiEdit = undefined
  cachedSlideUiSceneId = ''
  cachedSlideUiStateId = null
  cachedSlideUiScope = null
  cachedSlideUiLocationId = ''
  cachedSlideUi = null

  cachedSpatialPresent = null
  cachedSpatialEdit = undefined
  cachedSpatialScope = null
  cachedSpatialLocationId = ''
  cachedSpatialNodes = []

  cachedFlowPresent = null
  cachedFlowLocationId = ''
  cachedFlowScope = null
  cachedFlowOverlayKey = ''
  cachedFlowNodes = []

  cachedSyntheticSceneKind = null
  cachedSyntheticScenePresent = null
  cachedSyntheticSceneLocationId = ''
  cachedSyntheticSceneNodes = null
  cachedSyntheticScene = null

  cachedProjectionPresent = null
  cachedProjectionLocationId = ''
  cachedProjectionStateId = null
  cachedProjectionScope = null
  cachedProjectionSelectionKey = ''
  cachedProjectionSurface = null
  cachedProjection = null
}
