import { projectWithBackgroundPreview } from '../../authoring/backgroundPreview'
import { selectionObjectCommands } from '../../composition/selection/selectionObjectCommands'
import { useMemo, useRef, useState } from 'react'
import type { CompositionAuthoringSelection } from '../../composition/WebCompositionAuthoringContent'
import { CompositionSelectionContext } from '../../workbench/CompositionSelectionContext'
import { useShallow } from 'zustand/react/shallow'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { CourseProjectDocument, LayerItem } from '../../../shared/courseProjectTypes'
import type { ShapeType } from '../../../shared/contracts/native-v1/types'
import { buildSlideEditorView } from '../../../core/tools/slideLayerView'
import type { ImportedImageAsset } from '../../project/assetManager'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import type { EditorCanvasNodePatch } from '../../phaser/editorCanvasNode'
import {
  selectSlideWorkspaceSource,
  useEditorStore,
} from '../../store/editorStore'
import { projectV9EditingNodesWithDraft } from '../../store/slideEditorProjection'
import {
  mountPublishedCourseAuthoring,
  mountPublishedCourseTryRun,
  reportTryRunInteractionDiagnostic,
} from '../coursePlayerTryRun'
import { sidecarFileIdsFrom } from '../workspaceSlidePreviewRebuild'
import { useAssetObjectUrls } from '../useAssetObjectUrls'
import { publishLayerItem } from '../../export/course/buildPublishedCourse'
import { CompositionEditorDialog } from '../../composition/CompositionEditorDialog'
import { captureLiveSceneBaseline, liveSceneChangesSince, liveSceneItemLabel, sceneWithLiveCarriers } from './liveSceneChanges'
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
  readonly onDropWorkspaceMedia?: WorkspaceMediaDropHandler
}

function slidePreviewIdentityFromLayer(item: LayerItem): SlidePreviewIdentityNode | null {
  if (item.kind === 'runtime') return null
  if (item.kind === 'composition') return { id: item.layerItemId, type: 'composition' }
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

export function SlideWorkspaceConnector({
  onAddImage,
  onAddVideo,
  onDropWorkspaceMedia,
  onSelectImageAsset,
}: SlideWorkspaceConnectorProps) {
  const runSlideFieldTextIntent = useEditorStore(state => state.runSlideFieldTextIntent)
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
    setSlideTextEditComposing,
    setStatus,
    updateNode,
    updateNodes,
    addTextNode,
    addFormulaNode,
    addRectangleNode,
    addShapeNode,
    addTableNode,
    addChartNode,
    addExternalComponentNode,
    captureRuntimeContentTextTarget,
    updateRuntimeContentTextAtTarget,
    captureRuntimeAssetReplacementTarget,
    replaceRuntimeAssetAtTarget,
    writeComponentTextRule,
    replaceComponentAssetAtKey,
    runSlideCandidateCommand,
    applySlideCandidateCommand,
    setActiveTab,
    slideDrawTool,
    setSlideDrawTool,
    drawSlideShapeNode,
    activateCourseLocation,
  ] = useEditorStore(useShallow(selectSlideWorkspaceSource))
  const previewBackgroundColor = useEditorStore((state) => state.previewBackgroundColor)
  const documentId = useEditorStore((state) => state.courseDocument.documentId)
  const sessionGeneration = useEditorStore((state) => state.courseAuthoringSession?.token.generation ?? -1)
  const submitDynamicFallbackIntent = useEditorStore(state => state.submitDynamicFallbackIntent)
  const dynamicFallbackState = useEditorStore(state => state.dynamicFallbackState)
  const retryDynamicFallback = useEditorStore(state => state.retryDynamicFallback)
  const discardDynamicFallback = useEditorStore(state => state.discardDynamicFallback)
  const submitCompositionEdit = useEditorStore(state => state.submitCompositionEdit)
  const [compositionEditor, setCompositionEditor] = useState<{ documentId: string; layerItemId: string } | null>(null)
  const compositionCanvasRef = useRef<HTMLDivElement>(null)
  const [compositionSelection, setCompositionSelection] = useState<{ documentId: string; locationId: string; selection: CompositionAuthoringSelection } | null>(null)
  const view = useMemo(() => {
    if (!project || !locationId) return null
    return buildSlideEditorView({
      project: projectWithBackgroundPreview(project, canvasMode === 'edit' ? previewBackgroundColor : null, {
        locationId, stateId: activePresentationStateId, generation: backend?.getSession().generation ?? -1,
      }),
      locationId,
      stateId: activePresentationStateId,
    })
  }, [activePresentationStateId, locationId, project, previewBackgroundColor, backend, canvasMode])
  const editingNodes = useMemo(() => backend
    ? projectV9EditingNodesWithDraft(backend, contentEdit)
    : [], [backend, contentEdit])
  const selectedNode = editingNodes.find((node) => node.id === selectedNodeId)
  const selectedComposition = view?.layers.find(layer => layer.item.layerItemId === selectedNodeId && layer.item.kind === 'composition')?.item
  const editingComposition = compositionEditor?.documentId === documentId
    ? view?.layers.find(layer => layer.item.layerItemId === compositionEditor.layerItemId && layer.item.kind === 'composition')?.item : undefined
  const publishedComposition = useMemo(() => {
    if (!project || editingComposition?.kind !== 'composition') return null
    const published = publishLayerItem({ project, assetFiles, components: componentPackages }, editingComposition as LayerItem)
    return published.kind === 'composition' ? published : null
  }, [project, editingComposition, assetFiles, componentPackages])
  const assetMimeTypes = useMemo(() => Object.fromEntries(Object.entries(project?.assets ?? {}).map(([id, asset]) => [id, asset.mimeType])), [project?.assets])
  const compositionAssetUrls = useAssetObjectUrls(assetFiles, assetMimeTypes)
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
    sessionGeneration,
    previewRebuildKey,
    tryRunMountKey,
    drawTool: slideDrawTool,
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
    sessionGeneration,
    slideDrawTool,
    tryRunMountKey,
    view,
  ])
  const ports = useMemo<SlideWorkspacePorts>(() => ({
    canvas: {
      setCanvasMode,
      setDrawTool: (tool) => setSlideDrawTool(tool),
      setStatus: (message) => setStatus(message),
      showLocation: (id) => activateCourseLocation(id),
    },
    selection: {
      selectNodes: (ids) => selectNodes([...ids]),
      selectNode: (id) => selectNode(id),
      paste: selectionObjectCommands.paste,
      selectAll: selectionObjectCommands.selectAll,
    },
    content: {
      beginTextEdit: (nodeId, origin) => beginTextEdit(nodeId, origin),
      commitTextEdit,
      cancelTextEdit,
      updateTextEditDraft,
      setTextEditComposing: setSlideTextEditComposing,
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
      addTableNode: (x, y) => addTableNode(x, y),
      addChartNode: (chartType, x, y) => addChartNode(chartType, x, y),
      addExternalComponentNode,
      drawShapeNode: (input) => drawSlideShapeNode(input),
    },
    runtime: {
      captureRuntimeContentTextTarget,
      captureRuntimeAssetReplacementTarget,
      submitDynamicFallbackIntent,
      dynamicFallbackState,
      retryDynamicFallback,
      discardDynamicFallback,
    },
    authoring: {
      runFieldTextIntent: runSlideFieldTextIntent,
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
    liveScene: {
      capture: () => project ? captureLiveSceneBaseline(project, tryRunMountKey) : null,
      changesSince: (baseline, sceneId) => project ? liveSceneChangesSince(baseline, project, sceneId) : null,
      sceneWithCarriers: (id) => project ? sceneWithLiveCarriers(project, id) : null,
      itemLabel: (sceneId, itemId) => project ? liveSceneItemLabel(project, sceneId, itemId) : '这个对象',
    },
    tryRun: {
      mount: (container, resume) => {
        if (!project) throw new Error('not-slide-session')
        return mountPublishedCourseTryRun({
          container,
          project,
          assetFiles,
          components: componentPackages,
          locationId,
          // A page loaded again after an edit on it (M15 运行现场) starts where it was, with its course state.
          initialPresentationStateId: !locationId ? null : resume ? resume.stateId : activePresentationStateId,
          ...(resume?.courseState ? { initialCourseState: resume.courseState } : {}),
          onInteractionDiagnostic: reportTryRunInteractionDiagnostic,
        })
      },
    },
  }), [
    addExternalComponentNode,
    runSlideFieldTextIntent,
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
    submitDynamicFallbackIntent,
    dynamicFallbackState,
    retryDynamicFallback,
    discardDynamicFallback,
    commitTextEdit,
    componentPackages,
    drawSlideShapeNode,
    locationId,
    project,
    tryRunMountKey,
    runSlideCandidateCommand,
    selectNode,
    selectNodes,
    setActiveTab,
    setCanvasMode,
    activateCourseLocation,
    setSlideDrawTool,
    setStatus,
    updateNode,
    updateNodes,
    updateTextEditDraft,
    setSlideTextEditComposing,
  ])

  const activeCompositionSelection = compositionSelection?.documentId === documentId && compositionSelection.locationId === locationId
    && selectedComposition?.kind === 'composition' && selectedComposition.layerItemId === compositionSelection.selection.layerItemId
    ? compositionSelection.selection : null
  const selectCompositionContent = (selection: CompositionAuthoringSelection) => {
    if (documentId && locationId) setCompositionSelection({ documentId, locationId, selection })
  }
  return (
    <div ref={compositionCanvasRef} style={{ display: 'grid', position: 'relative', minWidth: 0, minHeight: 0 }}>
    <SlideLocationWorkspace
      snapshot={snapshot}
      documentId={documentId}
      ports={ports}
      onAddImage={onAddImage}
      onAddVideo={onAddVideo}
      onSelectImageAsset={onSelectImageAsset}
      onDropWorkspaceMedia={onDropWorkspaceMedia}
      onCompositionSelection={selectCompositionContent} selectedCompositionNode={activeCompositionSelection}
      onCompositionEdit={canvasMode === 'edit' && documentId ? async (layerItemId, edit) => {
        if (useEditorStore.getState().courseDocument.documentId !== documentId) throw new Error('当前文档已切换，请重新选择组合内容')
        const result = await submitCompositionEdit(layerItemId, edit)
        if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error('message' in result ? result.message : '修改未完成')
      } : undefined}
    />
    <CompositionSelectionContext documentId={documentId} revision={project?.revision ?? 0} locationId={locationId}
      stateId={activePresentationStateId} canvasRoot={compositionCanvasRef.current} enabled={canvasMode === 'edit'}
      selection={activeCompositionSelection} onRestoreSelection={selectCompositionContent} />
    {canvasMode === 'edit' && selectedComposition?.kind === 'composition' && documentId && <button type="button"
      style={{ position: 'absolute', right: 24, bottom: 24, zIndex: 30 }}
      disabled={selectedComposition.locked}
      onClick={() => setCompositionEditor({ documentId, layerItemId: selectedComposition.layerItemId })}>编辑组合内容</button>}
    {editingComposition?.kind === 'composition' && publishedComposition && compositionEditor && <CompositionEditorDialog
      key={`${documentId}:${editingComposition.layerItemId}`}
      item={editingComposition as import('../../../shared/courseProjectTypes').CompositionLayerItem}
      content={publishedComposition.content} assetUrls={compositionAssetUrls} projectId={project?.id} components={componentPackages}
      onEdit={async edit => {
        if (useEditorStore.getState().courseDocument.documentId !== compositionEditor.documentId) throw new Error('当前文档已切换，请重新选择组合内容')
        const result = await submitCompositionEdit(compositionEditor.layerItemId, edit)
        if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error('message' in result ? result.message : '修改未完成')
      }}
      onClose={() => setCompositionEditor(null)} />}
    </div>
  )
}
