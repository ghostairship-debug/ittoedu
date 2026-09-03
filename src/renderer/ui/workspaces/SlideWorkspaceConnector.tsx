import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { CourseProjectDocument, LayerItem } from '../../../shared/courseProjectTypes'
import type { ShapeType } from '../../../shared/projectTypes'
import { buildSlideEditorView } from '../../course/slideEditorView'
import { isSlideAuthoringBackend, type SlideBackend } from '../../store/slideBackendPort'
import type { ImportedImageAsset } from '../../project/assetManager'
import type { EditorCanvasNodePatch } from '../../phaser/editorCanvasNode'
import { useEditorStore } from '../../store/editorStore'
import { projectV9EditingNodesWithDraft } from '../../store/slideEditorProjection'
import {
  attachPublishedCourseStageFit,
  mountPublishedCourseAuthoring,
  mountPublishedCourseTryRun,
} from '../coursePlayerTryRun'
import { sidecarFileIdsFrom } from '../workspaceSlidePreviewRebuild'
import {
  buildSlidePreviewRebuildKey,
  type SlidePreviewIdentityNode,
  type SlidePreviewRebuildScene,
} from '../workspaceSlidePreviewRebuild'
import {
  SlideLocationWorkspace,
  type SlideWorkspaceAuthoringPort,
  type SlideWorkspaceCanvasPort,
  type SlideWorkspaceContentPort,
  type SlideWorkspacePorts,
  type SlideWorkspaceRuntimePort,
  type SlideWorkspaceSelectionPort,
  type SlideWorkspaceSnapshot,
} from './SlideLocationWorkspace'

interface SlideWorkspaceConnectorProps {
  readonly onAddImage: (x?: number, y?: number) => void
  readonly onAddVideo: (x?: number, y?: number) => void
  readonly onSelectImageAsset: () => Promise<ImportedImageAsset | null>
}

const EMPTY_ASSET_FILES: Record<string, Uint8Array> = Object.freeze({})

function slidePreviewIdentityFromLayer(item: LayerItem): SlidePreviewIdentityNode | null {
  if (item.kind === 'runtime') return null
  if (item.kind === 'component') {
    return {
      id: item.layerItemId,
      type: 'external-component',
      component: item.component,
    }
  }
  return { id: item.layerItemId, type: item.content.nativeType }
}

function slidePreviewScenesFromCourse(
  project: CourseProjectDocument,
): SlidePreviewRebuildScene[] {
  return project.locations.flatMap((location) => {
    if (location.kind !== 'slide-scene') return []
    const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
    if (!surface || surface.type !== 'slide') return []
    const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
    if (!scene) return []
    const runtime = scene.layerItems.find((item) => item.kind === 'runtime')
    return [{
      id: scene.id,
      nodes: scene.layerItems.flatMap((item) => {
        const identity = slidePreviewIdentityFromLayer(item)
        return identity ? [identity] : []
      }),
      presentation: scene.presentation
        ? { states: scene.presentation.states.map((state) => ({ id: state.id })) }
        : undefined,
      runtime: runtime?.kind === 'runtime' ? runtime.runtime : undefined,
    }]
  })
}

function firstGlobalRuntime(project: CourseProjectDocument) {
  for (const entry of project.globalLayerItems) {
    if (entry.item.kind === 'runtime') return entry.item.runtime
  }
  return null
}

function makePreviewRebuildKey(input: {
  readonly project: CourseProjectDocument | null
  readonly locationId: string | null
  readonly view: ReturnType<typeof buildSlideEditorView> | null
  readonly canvasMode: 'edit' | 'run'
  readonly editingScope: 'scene' | 'global'
  readonly stateId: string | null
  readonly sidecarFileIds: readonly string[]
  readonly componentPackages: Record<string, ComponentPackageData>
}) {
  if (!input.project) return JSON.stringify({ mode: input.canvasMode, empty: true })
  const previewScenes = slidePreviewScenesFromCourse(input.project)
  const currentSceneId = input.view?.sceneId ?? previewScenes[0]?.id ?? ''
  const currentPreviewScene = previewScenes.find((candidate) => candidate.id === currentSceneId)
    ?? { id: currentSceneId, nodes: [] }
  const location = input.project.locations.find((candidate) => (
    candidate.id === input.locationId && candidate.kind === 'slide-scene'
  ))
  const surface = location
    ? input.project.surfaces.find((candidate) => (
      candidate.id === location.surfaceId && candidate.type === 'slide'
    ))
    : undefined
  const scene = location?.kind === 'slide-scene' && surface?.type === 'slide'
    ? surface.scenes.find((candidate) => candidate.id === location.sceneId)
    : undefined
  return buildSlidePreviewRebuildKey({
    canvasMode: input.canvasMode,
    editingScope: input.editingScope,
    activePresentationStateId: input.stateId,
    scene: currentPreviewScene,
    scenes: previewScenes,
    globalLayer: [],
    globalRuntime: firstGlobalRuntime(input.project),
    assets: input.project.assets,
    candidateGlobals: input.project.globalLayerItems,
    candidateLocalItems: surface?.type === 'slide' && scene
      ? [
        ...scene.layerItems.map((item) => ({ owner: 'scene' as const, item })),
        ...surface.surfaceLayerItems.map((entry) => ({
          owner: 'surface' as const,
          item: entry.item,
          visibility: entry.visibility,
        })),
      ]
      : null,
    candidateAssets: input.project.assets,
    sidecarFileIds: input.sidecarFileIds,
    componentPackages: input.componentPackages,
  })
}

interface SlideWorkspaceSourceStore {
  readonly slideBackend: SlideBackend
  readonly slideCandidateSnapshot: { readonly locationId: string } | null
  readonly canvasMode: 'edit' | 'run'
  readonly editingScope: 'scene' | 'global'
  readonly selectedNodeIds: string[]
  readonly selectedNodeId: string | null
  readonly editingTextNodeId: string | null
  readonly activePresentationStateId: string | null
  readonly courseAssetSidecar: { readonly files: Record<string, Uint8Array> } | null
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly v9ContentEdit: SlideWorkspaceSnapshot['contentEdit']
  readonly setCanvasMode: SlideWorkspaceCanvasPort['setCanvasMode']
  readonly selectNodes: (ids: string[]) => void
  readonly selectNode: (id: string | null, additive?: boolean) => void
  readonly beginTextEdit: SlideWorkspaceContentPort['beginTextEdit']
  readonly commitTextEdit: SlideWorkspaceContentPort['commitTextEdit']
  readonly cancelTextEdit: SlideWorkspaceContentPort['cancelTextEdit']
  readonly updateTextEditDraft: SlideWorkspaceContentPort['updateTextEditDraft']
  readonly setStatus: (message: string | null) => void
  readonly updateNode: (nodeId: string, patch: EditorCanvasNodePatch) => void
  readonly updateNodes: (nodes: Array<{ nodeId: string; patch: EditorCanvasNodePatch }>) => void
  readonly addTextNode: (x?: number, y?: number) => void
  readonly addFormulaNode: (x?: number, y?: number) => void
  readonly addRectangleNode: (x?: number, y?: number) => void
  readonly addShapeNode: (shapeType: ShapeType, x?: number, y?: number) => void
  readonly addExternalComponentNode: SlideWorkspaceContentPort['addExternalComponentNode']
  readonly captureRuntimeContentTextTarget: SlideWorkspaceRuntimePort['captureRuntimeContentTextTarget']
  readonly updateRuntimeContentTextAtTarget: SlideWorkspaceRuntimePort['updateRuntimeContentTextAtTarget']
  readonly captureRuntimeAssetReplacementTarget: SlideWorkspaceRuntimePort['captureRuntimeAssetReplacementTarget']
  readonly replaceRuntimeAssetAtTarget: SlideWorkspaceRuntimePort['replaceRuntimeAssetAtTarget']
  readonly runSlideCandidateCommand: SlideWorkspaceAuthoringPort['run']
  readonly applySlideCandidateCommand: SlideWorkspaceAuthoringPort['applySlideCommand']
  readonly setActiveTab: (tab: 'properties') => void
}

function selectSlideWorkspaceSource(state: SlideWorkspaceSourceStore) {
  const backend = isSlideAuthoringBackend(state.slideBackend) ? state.slideBackend : null
  const project = backend?.getSession().history.present ?? null
  return [
    backend,
    project,
    state.slideCandidateSnapshot?.locationId ?? null,
    state.canvasMode,
    state.editingScope,
    state.selectedNodeIds,
    state.selectedNodeId,
    state.editingTextNodeId,
    state.activePresentationStateId,
    state.courseAssetSidecar?.files ?? EMPTY_ASSET_FILES,
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
    state.setStatus,
    state.updateNode,
    state.updateNodes,
    state.addTextNode,
    state.addFormulaNode,
    state.addRectangleNode,
    state.addShapeNode,
    state.addExternalComponentNode,
    state.captureRuntimeContentTextTarget,
    state.updateRuntimeContentTextAtTarget,
    state.captureRuntimeAssetReplacementTarget,
    state.replaceRuntimeAssetAtTarget,
    state.runSlideCandidateCommand,
    state.applySlideCandidateCommand,
    state.setActiveTab,
  ] as const
}

export function SlideWorkspaceConnector({
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
}: SlideWorkspaceConnectorProps) {
  const [
    backend,
    project,
    locationId,
    canvasMode,
    editingScope,
    selectedNodeIds,
    selectedNodeId,
    editingTextNodeId,
    activePresentationStateId,
    assetFiles,
    componentPackages,
    sidecar,
    contentEdit,
    setCanvasMode,
    selectNodes,
    selectNode,
    beginTextEdit,
    commitTextEdit,
    cancelTextEdit,
    updateTextEditDraft,
    setStatus,
    updateNode,
    updateNodes,
    addTextNode,
    addFormulaNode,
    addRectangleNode,
    addShapeNode,
    addExternalComponentNode,
    captureRuntimeContentTextTarget,
    updateRuntimeContentTextAtTarget,
    captureRuntimeAssetReplacementTarget,
    replaceRuntimeAssetAtTarget,
    runSlideCandidateCommand,
    applySlideCandidateCommand,
    setActiveTab,
  ] = useEditorStore(useShallow(selectSlideWorkspaceSource))
  const view = useMemo(() => project && locationId
    ? buildSlideEditorView({
      project,
      locationId,
      stateId: activePresentationStateId,
    })
    : null, [activePresentationStateId, locationId, project])
  const editingNodes = useMemo(() => backend
    ? projectV9EditingNodesWithDraft(backend, contentEdit)
    : [], [backend, contentEdit])
  const selectedNode = editingNodes.find((node) => node.id === selectedNodeId)
  const sidecarFileIds = useMemo(
    () => sidecarFileIdsFrom(sidecar?.files, assetFiles),
    [assetFiles, sidecar],
  )
  const previewRebuildKey = useMemo(() => makePreviewRebuildKey({
    project,
    locationId,
    view,
    canvasMode,
    editingScope,
    stateId: activePresentationStateId,
    sidecarFileIds,
    componentPackages,
  }), [
    activePresentationStateId,
    canvasMode,
    componentPackages,
    editingScope,
    locationId,
    project,
    sidecarFileIds,
    view,
  ])
  const tryRunMountKey = useMemo(() => project
    ? JSON.stringify({
      id: project.id,
      revision: project.revision,
      sidecar: Object.keys(assetFiles).sort(),
      packages: Object.keys(componentPackages).sort(),
    })
    : null, [assetFiles, componentPackages, project])
  const snapshot = useMemo<SlideWorkspaceSnapshot>(() => ({
    view,
    locationId,
    backend,
    backendKind: backend ? 'slide-authoring' : 'unavailable',
    componentPackages,
    sidecarFileIds,
    editingScope,
    presentationStateId: activePresentationStateId,
    canvasMode,
    editingNodes,
    selectedNodeIds,
    selectedNode,
    editingTextNodeId,
    contentEdit,
    sceneId: backend?.getSnapshot().sceneId ?? (() => {
      const location = project?.locations.find((item) => item.id === locationId)
      return location?.kind === 'slide-scene' ? location.sceneId : ''
    })(),
    projectId: project?.id ?? '',
    projectRevision: project?.revision ?? 0,
    previewRebuildKey,
    tryRunMountKey,
  }), [
    activePresentationStateId,
    backend,
    canvasMode,
    componentPackages,
    contentEdit,
    editingNodes,
    editingScope,
    editingTextNodeId,
    locationId,
    project,
    previewRebuildKey,
    selectedNode,
    selectedNodeIds,
    sidecarFileIds,
    tryRunMountKey,
    view,
  ])
  const ports = useMemo<SlideWorkspacePorts>(() => ({
    canvas: {
      setCanvasMode,
      setStatus: (message) => setStatus(message),
    },
    selection: {
      selectNodes: (ids) => selectNodes([...ids]),
      selectNode: (id) => selectNode(id),
    },
    content: {
      beginTextEdit: (nodeId, origin) => beginTextEdit(nodeId, origin),
      commitTextEdit,
      cancelTextEdit,
      updateTextEditDraft,
      updateNode: (nodeId, patch) => updateNode(
        nodeId,
        patch as Parameters<typeof updateNode>[1],
      ),
      updateNodes: (nodes) => updateNodes(nodes.map(({ nodeId, patch }) => ({
        nodeId,
        patch: patch as Parameters<typeof updateNode>[1],
      }))),
      addTextNode,
      addFormulaNode,
      addRectangleNode,
      addShapeNode: (shapeType, x, y) => addShapeNode(
        shapeType as Parameters<typeof addShapeNode>[0],
        x,
        y,
      ),
      addExternalComponentNode,
    },
    runtime: {
      captureRuntimeContentTextTarget,
      updateRuntimeContentTextAtTarget,
      captureRuntimeAssetReplacementTarget,
      replaceRuntimeAssetAtTarget,
    },
    authoring: {
      run: runSlideCandidateCommand,
      afterSelectLayers: (command) => {
        if (command.ok && (command.selection?.selectionIds.length ?? 0) > 0) {
          setActiveTab('properties')
        }
      },
      applySlideCommand: applySlideCandidateCommand,
    },
    preview: {
      mount: (input) => {
        if (!project || !locationId) throw new Error('not-slide-session')
        return mountPublishedCourseAuthoring({
          ...input,
          project,
          assetFiles,
          components: componentPackages,
          locationId,
          stateId: activePresentationStateId,
        })
      },
    },
    tryRun: {
      mount: (container) => {
        if (!project) throw new Error('not-slide-session')
        return mountPublishedCourseTryRun({
          container,
          project,
          assetFiles,
          components: componentPackages,
          locationId,
          initialPresentationStateId: locationId ? activePresentationStateId : null,
        })
      },
      attachStageFit: attachPublishedCourseStageFit,
    },
  }), [
    addExternalComponentNode,
    addFormulaNode,
    addRectangleNode,
    addShapeNode,
    addTextNode,
    activePresentationStateId,
    applySlideCandidateCommand,
    assetFiles,
    beginTextEdit,
    cancelTextEdit,
    captureRuntimeAssetReplacementTarget,
    captureRuntimeContentTextTarget,
    commitTextEdit,
    componentPackages,
    replaceRuntimeAssetAtTarget,
    locationId,
    project,
    runSlideCandidateCommand,
    selectNode,
    selectNodes,
    setActiveTab,
    setCanvasMode,
    setStatus,
    updateNode,
    updateNodes,
    updateRuntimeContentTextAtTarget,
    updateTextEditDraft,
  ])

  return (
    <SlideLocationWorkspace
      snapshot={snapshot}
      ports={ports}
      onAddImage={onAddImage}
      onAddVideo={onAddVideo}
      onSelectImageAsset={onSelectImageAsset}
    />
  )
}
