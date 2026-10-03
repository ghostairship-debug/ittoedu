import type { FlowDocumentDraft } from '../../authoring/flowDocumentDraft'
import { projectWithBackgroundPreview, flowTextColorPreview } from '../../authoring/backgroundPreview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompositionAuthoringSelection } from '../../composition/WebCompositionAuthoringContent'
import { CompositionSelectionContext } from '../../workbench/CompositionSelectionContext'
import type { CompositionLayerItem } from '../../../shared/courseProjectTypes'
import { publishWebComposition } from '../../export/course/buildPublishedCourse'
import { CompositionEditorDialog } from '../../composition/CompositionEditorDialog'
import { useAssetObjectUrls } from '../useAssetObjectUrls'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { CourseAuthoringSession } from '../../authoring/courseAuthoringSession'
import type { FlowTextEditSession } from '../../authoring/flowTextEdit'
import { buildFlowEditorView, FLOW_SESSIONLESS_ERROR } from '../../course/flowEditorView'
import type { FlowAuthoringSession } from '../../project/createFlowCourseProject'
import {
  selectEditingScope,
  selectMediaAssetFiles,
  useEditorStore,
} from '../../store/editorStore'
import { mountFlowLocationTryRun } from '../flowLocationTryRun'
import type { FlowCurrentSessionCommandPort } from '../flow/useFlowTextAuthoringController'
import { FlowLocationWorkspace } from './FlowLocationWorkspace'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import type { ImportedImageAsset } from '../../project/assetManager'

type FlowWorkspaceStore = {
  readonly flowSession: FlowAuthoringSession | null
  readonly courseAuthoringSession: CourseAuthoringSession | null
  readonly canvasMode: 'edit' | 'run'
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly flowDocumentDraft?: FlowDocumentDraft | null
  readonly flowTextEdit: FlowTextEditSession | null
  readonly runFlowAuthoringIntent: FlowCurrentSessionCommandPort['run']
  readonly setCanvasMode: (mode: 'edit' | 'run') => void
}

function selectFlowSession(state: FlowWorkspaceStore) { return state.flowSession }
function selectCourseAuthoringSession(state: FlowWorkspaceStore) { return state.courseAuthoringSession }
function selectCanvasMode(state: FlowWorkspaceStore) { return state.canvasMode }
function selectComponentPackages(state: FlowWorkspaceStore) { return state.componentPackages }
function selectFlowTextEdit(state: FlowWorkspaceStore) { return state.flowTextEdit }
function selectRunFlowAuthoringIntent(state: FlowWorkspaceStore) { return state.runFlowAuthoringIntent }
function selectSetCanvasMode(state: FlowWorkspaceStore) { return state.setCanvasMode }

export function FlowWorkspaceConnector({ onDropWorkspaceMedia, onSelectImageAsset }: { onDropWorkspaceMedia?: WorkspaceMediaDropHandler; onSelectImageAsset(): Promise<ImportedImageAsset | null> }) {
  const documentId = useEditorStore(state => state.courseDocument.documentId)
  const session = useEditorStore(selectFlowSession)
  const authoringSession = useEditorStore(selectCourseAuthoringSession)
  const canvasMode = useEditorStore(selectCanvasMode)
  const editingScope = useEditorStore(selectEditingScope)
  const assetFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(selectComponentPackages)
  const textEdit = useEditorStore(selectFlowTextEdit)
  const documentDraft = useEditorStore(state => state.flowDocumentDraft)
  const runFlowAuthoringIntent = useEditorStore(selectRunFlowAuthoringIntent)
  const setCanvasMode = useEditorStore(selectSetCanvasMode)
  const setStatus = useEditorStore(state => state.setStatus)
  const submitCompositionEdit = useEditorStore(state => state.submitCompositionEdit)
  const [compositionEditor, setCompositionEditor] = useState<{ documentId: string; layerItemId: string } | null>(null)
  const compositionCanvasRef = useRef<HTMLDivElement>(null)
  const [compositionSelection, setCompositionSelection] = useState<{ documentId: string; locationId: string; selection: CompositionAuthoringSelection } | null>(null)
  const activeDocumentId = useRef(documentId)
  activeDocumentId.current = documentId
  useEffect(() => {
    activeDocumentId.current = documentId
    return () => { activeDocumentId.current = null }
  }, [documentId])
  const reportStatus = useCallback((message: string) => {
    if (documentId && activeDocumentId.current === documentId) setStatus(message)
  }, [documentId, setStatus])
  const commands = useMemo<FlowCurrentSessionCommandPort>(() => ({
    run: runFlowAuthoringIntent,
  }), [runFlowAuthoringIntent])
  const previewBackgroundColor = useEditorStore((state) => state.previewBackgroundColor)
  const textPreview = useMemo(() => session && canvasMode === 'edit'
    ? flowTextColorPreview(session.history.present, previewBackgroundColor, authoringSession?.token.generation ?? -1, session.selection.locationId)
    : null, [session, canvasMode, previewBackgroundColor, authoringSession])
  const view = useMemo(() => {
    if (!session) return null
    return buildFlowEditorView({
      project: projectWithBackgroundPreview(textPreview?.project ?? session.history.present, canvasMode === 'edit' ? previewBackgroundColor : null, {
        locationId: session.selection.locationId, stateId: null, generation: authoringSession?.token.generation ?? -1,
      }),
      locationId: session.selection.locationId,
    })
  }, [session, previewBackgroundColor, authoringSession, canvasMode, textPreview])
  const compositionProject = session?.history.present
  const publishCompositionContent = useCallback((item: CompositionLayerItem) => {
    if (!compositionProject) throw new Error('当前 Flow 文档已关闭')
    return publishWebComposition({ project: compositionProject, assetFiles, components: componentPackages }, item.content)
  }, [compositionProject, assetFiles, componentPackages])
  const editingComposition = compositionEditor?.documentId === documentId
    ? view?.overlayLayers.find(layer => layer.selectionId === compositionEditor.layerItemId && layer.item.kind === 'composition')?.item : undefined
  const selectedComposition = view?.overlayLayers.find(layer => layer.item.kind === 'composition'
    && session?.selection.selectedOverlayIds.includes(layer.selectionId))?.item
  const publishedComposition = useMemo(() => editingComposition?.kind === 'composition'
    ? publishCompositionContent(editingComposition as CompositionLayerItem) : null, [editingComposition, publishCompositionContent])
  const assetMimeTypes = useMemo(() => Object.fromEntries(Object.entries(session?.history.present.assets ?? {}).map(([id, asset]) => [id, asset.mimeType])), [session])
  const compositionAssetUrls = useAssetObjectUrls(assetFiles, assetMimeTypes)
  const tryRunSnapshot = useMemo(() => session
    ? {
      project: session.history.present,
      locationId: session.selection.locationId,
      assetFiles,
      componentPackages,
    }
    : null, [assetFiles, componentPackages, session])
  const onMountTryRun = useCallback((container: HTMLElement) => {
    if (!tryRunSnapshot) throw new Error('not-flow-session')
    return mountFlowLocationTryRun({
      container,
      project: tryRunSnapshot.project,
      assetFiles: tryRunSnapshot.assetFiles,
      components: tryRunSnapshot.componentPackages,
      locationId: tryRunSnapshot.locationId,
    })
  }, [tryRunSnapshot])

  if (
    !session
    || !view
    || !authoringSession
    || authoringSession.token.surfaceType !== 'flow'
    || authoringSession.token.locationId !== view.locationId
    || authoringSession.token.revision !== view.revision
  ) {
    return (
      <main className="workspace workspace--flow" data-testid="flow-workspace-sessionless"
        data-flow-not-slide-stage="true" role="alert">
        <p className="property-hint">{FLOW_SESSIONLESS_ERROR}</p>
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
    <FlowLocationWorkspace
      documentId={documentId}
      view={view}
      sessionToken={authoringSession.token}
      assets={session.history.present.assets}
      selection={session.selection}
      textEdit={textEdit}
      documentDraft={documentDraft}
      previewTextEdit={textPreview?.edit ?? null}
      canvasMode={canvasMode}
      editingScope={editingScope === 'global' ? 'global' : 'scene'}
      assetFiles={assetFiles}
      componentPackages={componentPackages}
      commands={commands}
      onCanvasModeChange={setCanvasMode}
      onMountTryRun={onMountTryRun}
      onDropWorkspaceMedia={onDropWorkspaceMedia}
      onSelectImageAsset={onSelectImageAsset}
      onStatus={reportStatus}
      publishCompositionContent={publishCompositionContent}
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
