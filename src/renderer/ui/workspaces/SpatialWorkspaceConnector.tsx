import { projectWithBackgroundPreview } from '../../authoring/backgroundPreview'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CompositionAuthoringSelection } from '../../composition/WebCompositionAuthoringContent'
import { CompositionSelectionContext } from '../../workbench/CompositionSelectionContext'
import type { CompositionLayerItem } from '../../../shared/courseProjectTypes'
import { publishWebComposition } from '../../export/course/buildPublishedCourse'
import { CompositionEditorDialog } from '../../composition/CompositionEditorDialog'
import { useAssetObjectUrls } from '../useAssetObjectUrls'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { CourseAuthoringSession } from '../../authoring/courseAuthoringSession'
import type { SpatialAuthoringCommandPort } from '../../authoring/spatialAuthoringIntents'
import type { SpatialWorldContentEditSession } from '../../authoring/spatialWorldAuthoring'
import type { SpatialAuthoringSession } from '../../course/spatialEditorCommands'
import {
  buildSpatialEditorView,
  captureSpatialEditorAuthoringTarget,
  spatialEditorStableTargets,
  SPATIAL_SESSIONLESS_ERROR,
  type SpatialEditorGraphSelection,
} from '../../course/spatialEditorView'
import { selectMediaAssetFiles, useEditorStore } from '../../store/editorStore'
import { selectionObjectCommands } from '../../composition/selection/selectionObjectCommands'
import { mountPublishedCourseTryRun, reportTryRunInteractionDiagnostic } from '../coursePlayerTryRun'
import { SpatialLocationWorkspace } from './SpatialLocationWorkspace'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'

type SpatialWorkspaceStore = {
  readonly spatialSession: SpatialAuthoringSession | null
  readonly courseAuthoringSession: CourseAuthoringSession | null
  readonly canvasMode: 'edit' | 'run'
  readonly spatialContentEdit: SpatialWorldContentEditSession | null
  readonly spatialPlaybackPathId: string | null
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly spatialGraphSelection: SpatialEditorGraphSelection | null
  readonly runSpatialAuthoringIntent: SpatialAuthoringCommandPort['run']
  readonly setCanvasMode: (mode: 'edit' | 'run') => void
}

function selectSpatialSession(state: SpatialWorkspaceStore) { return state.spatialSession }
function selectCourseAuthoringSession(state: SpatialWorkspaceStore) { return state.courseAuthoringSession }
function selectCanvasMode(state: SpatialWorkspaceStore) { return state.canvasMode }
function selectSpatialContentEdit(state: SpatialWorkspaceStore) { return state.spatialContentEdit }
function selectSpatialPlaybackPathId(state: SpatialWorkspaceStore) { return state.spatialPlaybackPathId }
function selectComponentPackages(state: SpatialWorkspaceStore) { return state.componentPackages }
function selectSpatialGraphSelection(state: SpatialWorkspaceStore) { return state.spatialGraphSelection }
function selectRunSpatialAuthoringIntent(state: SpatialWorkspaceStore) { return state.runSpatialAuthoringIntent }
function selectSetCanvasMode(state: SpatialWorkspaceStore) { return state.setCanvasMode }

export function SpatialWorkspaceConnector({ onDropWorkspaceMedia }: { onDropWorkspaceMedia?: WorkspaceMediaDropHandler }) {
  const documentId = useEditorStore((state) => state.courseDocument.documentId)
  const session = useEditorStore(selectSpatialSession)
  const authoringSession = useEditorStore(selectCourseAuthoringSession)
  const canvasMode = useEditorStore(selectCanvasMode)
  const contentEdit = useEditorStore(selectSpatialContentEdit)
  const playbackPathId = useEditorStore(selectSpatialPlaybackPathId)
  const assetFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(selectComponentPackages)
  const graphSelection = useEditorStore(selectSpatialGraphSelection)
  const runSpatialAuthoringIntent = useEditorStore(selectRunSpatialAuthoringIntent)
  const setCanvasMode = useEditorStore(selectSetCanvasMode)
  const submitCompositionEdit = useEditorStore(state => state.submitCompositionEdit)
  const [compositionEditor, setCompositionEditor] = useState<{ documentId: string; layerItemId: string } | null>(null)
  const compositionCanvasRef = useRef<HTMLDivElement>(null)
  const [compositionSelection, setCompositionSelection] = useState<{ documentId: string; locationId: string; selection: CompositionAuthoringSelection } | null>(null)
  const captureRuntimeContentTextTarget = useEditorStore(
    (state) => state.captureRuntimeContentTextTarget,
  )
  const updateRuntimeContentTextAtTarget = useEditorStore(
    (state) => state.updateRuntimeContentTextAtTarget,
  )
  const commands = useMemo<SpatialAuthoringCommandPort>(() => ({
    run: runSpatialAuthoringIntent,
  }), [runSpatialAuthoringIntent])
  const runtimeContentAuthoring = useMemo(() => ({
    captureRuntimeContentTextTarget,
    updateRuntimeContentTextAtTarget,
  }), [captureRuntimeContentTextTarget, updateRuntimeContentTextAtTarget])
  const previewBackgroundColor = useEditorStore((state) => state.previewBackgroundColor)
  const view = useMemo(() => {
    if (!session) return null
    return buildSpatialEditorView({
      project: projectWithBackgroundPreview(session.history.present, canvasMode === 'edit' ? previewBackgroundColor : null, {
        locationId: session.selection.locationId, stateId: null, generation: authoringSession?.token.generation ?? -1,
      }),
      locationId: session.selection.locationId,
      sessionCamera: session.sessionCamera,
    })
  }, [session, previewBackgroundColor, authoringSession, canvasMode])
  const assetMimeTypes = useMemo(() => session
    ? Object.fromEntries(
      Object.entries(session.history.present.assets).map(([id, meta]) => [id, meta.mimeType]),
    )
    : {}, [session])
  const compositionAssetUrls = useAssetObjectUrls(assetFiles, assetMimeTypes)
  const editingComposition = compositionEditor?.documentId === documentId
    ? view?.layers.find(layer => layer.selectionId === compositionEditor.layerItemId && layer.item.kind === 'composition')?.item : undefined
  const selectedComposition = view?.layers.find(layer => layer.item.kind === 'composition'
    && session?.selection.selectionIds.includes(layer.selectionId))?.item
  const publishedComposition = useMemo(() => session && editingComposition?.kind === 'composition'
    ? publishWebComposition({ project: session.history.present, assetFiles, components: componentPackages }, editingComposition.content as CompositionLayerItem['content'])
    : null, [session, editingComposition, assetFiles, componentPackages])
  const targets = view ? spatialEditorStableTargets(view) : []
  const authoringTargets = useMemo(() => {
    if (!view || !authoringSession) return null
    if (
      authoringSession.token.surfaceType !== 'spatial-2d'
      || authoringSession.token.locationId !== view.locationId
      || authoringSession.token.revision !== view.revision
    ) return null
    try {
      const worldTarget = captureSpatialEditorAuthoringTarget({
        view,
        sessionToken: authoringSession.token,
        target: { kind: 'world', field: 'world' },
      })
      const layerTarget = (layerItemId: string, field: 'frame' | 'item') => captureSpatialEditorAuthoringTarget({
        view,
        sessionToken: authoringSession.token,
        target: { kind: 'layer', layerItemId, field },
      })
      const layerTargets = new Map(view.layers.map((layer) => [layer.selectionId, layerTarget(layer.selectionId, 'frame')] as const))
      // Property patches (showing a hidden object again) address the whole item.
      const layerItemTargets = new Map(view.layers.map((layer) => [layer.selectionId, layerTarget(layer.selectionId, 'item')] as const))
      return { worldTarget, layerTargets, layerItemTargets }
    } catch {
      return null
    }
  }, [authoringSession, view])
  const tryRunSnapshot = useMemo(() => session
    ? {
      project: session.history.present,
      locationId: session.selection.locationId,
      playbackPathId,
      assetFiles,
      componentPackages,
    }
    : null, [assetFiles, componentPackages, playbackPathId, session])
  const onMountTryRun = useCallback((container: HTMLElement) => {
    if (!tryRunSnapshot) throw new Error('not-spatial-session')
    return mountPublishedCourseTryRun({
      container,
      project: tryRunSnapshot.project,
      assetFiles: tryRunSnapshot.assetFiles,
      components: tryRunSnapshot.componentPackages,
      locationId: tryRunSnapshot.locationId,
      playbackPathId: tryRunSnapshot.playbackPathId,
      onInteractionDiagnostic: reportTryRunInteractionDiagnostic,
    })
  }, [tryRunSnapshot])

  if (!session || !view || !authoringTargets) {
    return (
      <main className="workspace workspace--spatial" data-testid="spatial-workspace-sessionless"
        data-spatial-not-slide-stage="true" role="alert">
        <p className="property-hint">{SPATIAL_SESSIONLESS_ERROR}</p>
      </main>
    )
  }

  const activeCompositionSelection = compositionSelection?.documentId === documentId && compositionSelection.locationId === view.locationId
    && selectedComposition?.kind === 'composition' && selectedComposition.layerItemId === compositionSelection.selection.layerItemId
    ? compositionSelection.selection : null
  const selectCompositionContent = (selection: CompositionAuthoringSelection) => {
    if (documentId) setCompositionSelection({ documentId, locationId: view.locationId, selection })
  }
  return (
    <div ref={compositionCanvasRef} style={{ display: 'grid', position: 'relative', minWidth: 0, minHeight: 0 }}>
    <SpatialLocationWorkspace
      documentId={documentId}
      view={view}
      showCameraFrames={session.showCameraFrames}
      targets={targets}
      selectionIds={session.selection.selectionIds}
      graphSelection={graphSelection}
      canvasMode={canvasMode}
      scope={session.scope}
      contentEdit={contentEdit}
      assetFiles={assetFiles}
      assetMimeTypes={assetMimeTypes}
      componentPackages={componentPackages}
      project={session.history.present}
      runtimeContentAuthoring={runtimeContentAuthoring}
      worldTarget={authoringTargets.worldTarget}
      layerTargets={authoringTargets.layerTargets}
      layerItemTargets={authoringTargets.layerItemTargets}
      commands={commands}
      onCanvasModeChange={setCanvasMode}
      onPaste={selectionObjectCommands.paste}
      onSelectAll={selectionObjectCommands.selectAll}
      onMountTryRun={onMountTryRun}
      onDropWorkspaceMedia={onDropWorkspaceMedia}
      onCompositionSelection={selectCompositionContent} selectedCompositionNode={activeCompositionSelection}
      onCompositionEdit={canvasMode === 'edit' && documentId ? async (layerItemId, edit) => {
        if (useEditorStore.getState().courseDocument.documentId !== documentId) throw new Error('当前文档已切换，请重新选择组合内容')
        const result = await submitCompositionEdit(layerItemId, edit)
        if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error('message' in result ? result.message : '修改未完成')
      } : undefined}
      onEditComposition={layerItemId => { if (documentId) setCompositionEditor({ documentId, layerItemId }) }}
    />
    <CompositionSelectionContext documentId={documentId} revision={session.history.present.revision} locationId={view.locationId}
      canvasRoot={compositionCanvasRef.current} enabled={canvasMode === 'edit'}
      selection={activeCompositionSelection} onRestoreSelection={selectCompositionContent} />
    {canvasMode === 'edit' && selectedComposition?.kind === 'composition' && documentId && <button type="button"
      style={{ position: 'absolute', right: 24, bottom: 24, zIndex: 30 }} disabled={selectedComposition.locked}
      onClick={() => setCompositionEditor({ documentId, layerItemId: selectedComposition.layerItemId })}>编辑组合内容</button>}
    {canvasMode === 'edit' && editingComposition?.kind === 'composition' && publishedComposition && compositionEditor && <CompositionEditorDialog
      key={`${documentId}:${editingComposition.layerItemId}`}
      item={editingComposition as CompositionLayerItem} content={publishedComposition}
      assetUrls={compositionAssetUrls} projectId={session.history.present.id} components={componentPackages}
      onEdit={async edit => {
        if (useEditorStore.getState().courseDocument.documentId !== compositionEditor.documentId) throw new Error('当前文档已切换，请重新选择组合内容')
        const result = await submitCompositionEdit(compositionEditor.layerItemId, edit)
        if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error('message' in result ? result.message : '修改未完成')
      }} onClose={() => setCompositionEditor(null)} />}
    </div>
  )
}
