import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAssetObjectUrls } from '../useAssetObjectUrls'
import { projectWithBackgroundPreview } from '../../authoring/backgroundPreview'
import type { ImportedImageAsset } from '../../project/assetManager'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { useEditorStore } from '../../store/editorStore'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
import { projectWithSlideContentDraft } from '../../store/slices/slideAuthoringSlice'
import { SlideLocationWorkspace, type SlideWorkspaceSnapshot, type SlideWorkspacePorts } from './SlideLocationWorkspace'

interface SlideWorkspaceConnectorProps {
  onAddImage(x?: number, y?: number): void
  onAddVideo(x?: number, y?: number): void
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
}
/** Original Slide entry point, consuming the document Bridge and persistent R0 world. */
export function SlideWorkspaceConnector(props: SlideWorkspaceConnectorProps) {
  const runtime = useCourseV10Runtime()
  const mimeTypes = useMemo(() => Object.fromEntries(Object.values(runtime.project.assets).map(asset => [asset.id, asset.mimeType ?? 'application/octet-stream'])), [runtime.project.assets])
  const assetUrls = useAssetObjectUrls(runtime.resources.assets, mimeTypes)
  const source = useEditorStore(useShallow(state => ({
    courseView: state.courseView, canvasMode: state.canvasMode,
    contentEdit: state.slideContentEdit, drawTool: state.slideDrawTool, editingScope: state.editingScope, backgroundPreview: state.previewBackgroundColor,
  })))
  const read = (): SlideWorkspaceSnapshot => {
    const state = useEditorStore.getState(), view = state.courseBridge.read()
    return {
      project: view.editingProject && view.activeDocumentId ? projectWithBackgroundPreview(projectWithSlideContentDraft(view.editingProject, state.slideContentEdit,
        { documentId: view.activeDocumentId, epoch: view.snapshot?.epoch, surfaceId: view.surfaceId, activeStateId: view.activeStateId }), state.previewBackgroundColor,
        view.activeDocumentId, view.surfaceId, view.activeStateId, view.snapshot?.epoch) : null,
      documentId: view.activeDocumentId, surfaceId: view.surfaceId, selectedInstanceIds: view.selectedInstanceIds,
      activation: view.activation, activeStateId: view.activeStateId,
      canvasMode: state.canvasMode, contentEdit: state.slideContentEdit, drawTool: state.slideDrawTool, assetUrls, editingScope: state.editingScope,
    }
  }
  const snapshot: SlideWorkspaceSnapshot = {
    project: source.courseView.editingProject && source.courseView.activeDocumentId ? projectWithBackgroundPreview(projectWithSlideContentDraft(source.courseView.editingProject, source.contentEdit,
      { documentId: source.courseView.activeDocumentId, epoch: source.courseView.snapshot?.epoch, surfaceId: source.courseView.surfaceId, activeStateId: source.courseView.activeStateId }), source.backgroundPreview,
      source.courseView.activeDocumentId, source.courseView.surfaceId, source.courseView.activeStateId, source.courseView.snapshot?.epoch) : null,
    documentId: source.courseView.activeDocumentId, surfaceId: source.courseView.surfaceId, selectedInstanceIds: source.courseView.selectedInstanceIds,
    activation: source.courseView.activation, activeStateId: source.courseView.activeStateId,
    canvasMode: source.canvasMode, contentEdit: source.contentEdit, drawTool: source.drawTool, assetUrls, editingScope: source.editingScope,
  }
  useEffect(() => {
    runtime.setPlaying(source.canvasMode === 'run')
  }, [runtime.setPlaying, source.canvasMode])
  const ports = useMemo<SlideWorkspacePorts>(() => {
    const state = () => useEditorStore.getState()
    const report = (message: string) => state().setStatus(message)
    const safe = (result: unknown) => { void Promise.resolve(result).catch(error => report(error instanceof Error ? error.message : String(error))) }
    return {
      read, report,
      capture: documentId => state().courseBridge.captureTarget(documentId ?? runtime.documentId),
      commit: (edits, target, group) => state().courseBridge.editCaptured(state().courseBridge.capture(edits, target), group),
      edit: (edits, group) => runtime.edit(edits, group),
      select: ids => runtime.selectInstances(ids),
      selectSurface: id => state().courseBridge.selectSurface(runtime.documentId, id),
      resetPlayback: async playing => {
        await state().commitSlideContentEdit()
        await runtime.resetPlayback(playing)
        if (state().courseView.activeDocumentId !== runtime.documentId) runtime.setPlaying(false)
      },
      setCanvasMode: mode => {
        if (mode === 'run') safe(state().commitSlideContentEdit().then(() => state().setCanvasMode(mode)))
        else state().setCanvasMode(mode)
      },
      setDrawTool: tool => state().setSlideDrawTool(tool),
      paste: () => { safe(state().pasteNodes()) }, selectAll: () => state().selectAllNodes(),
      beginTextEdit: id => state().beginSlideDataEdit(id),
      beginSpotEdit: (spot, target) => state().beginSlideSpotEdit(spot, target, () => runtime.world.authorSpots().find(current =>
        current.instanceId === spot.instanceId && current.kind === spot.kind
        && (spot.authorKey ? current.authorKey === spot.authorKey && JSON.stringify(current.scope ?? {}) === JSON.stringify(spot.scope ?? {})
          : current.id === spot.id && current.mountGeneration === spot.mountGeneration))),
      updateSpotDraft: (value, composing) => state().updateSlideSpotDraft(value, composing),
      authorSpots: () => runtime.world.authorSpots(), subscribeAuthorSpots: runtime.world.subscribeAuthorSpots,
      previewAuthorSpot: (id, geometry) => runtime.world.previewAuthorSpot(id, geometry),
      teacherController: runtime.navigation.editorPort(),
      registerObservation: runtime.registerObservation,
      navigationChanged: runtime.navigation.changed,
      updateDataDraft: (data, composing, height) => state().updateSlideDataDraft(data, composing, height),
      setTextComposing: active => state().setSlideTextEditComposing(active),
      commitTextEdit: () => state().commitSlideContentEdit(), cancelTextEdit: () => state().cancelTextEdit(),
      undo: () => { safe(state().undo()) }, redo: () => { safe(state().redo()) },
      onElement: runtime.onElement, onTargetElement: runtime.onTargetElement,
      addTextNode: (x, y) => safe(state().addTextNode(x, y)),
      addFormulaNode: (x, y) => safe(state().addFormulaNode(x, y)),
      addRectangleNode: (x, y) => safe(state().addRectangleNode(x, y)),
      addShapeNode: (type, x, y) => safe(state().addShapeNode(type, x, y)),
      addTableNode: (x, y) => safe(state().addTableNode(x, y)),
      addChartNode: (type, x, y) => safe(state().addChartNode(type, x, y)),
      addExternalComponentNode: (id, x, y, preset) => safe(state().addExternalComponentNode(id, x, y, preset)),
      drawShapeNode: (input, target) => safe(state().drawSlideShapeNode(input, target)),
    }
  }, [runtime.documentId, runtime.world, runtime.navigation, runtime.onElement, runtime.onTargetElement, runtime.selectInstances, runtime.edit, runtime.resetPlayback, runtime.registerObservation])
  return <SlideLocationWorkspace snapshot={snapshot} ports={ports} documentId={snapshot.documentId} {...props} />
}
