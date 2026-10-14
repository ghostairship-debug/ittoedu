import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../store/editorStore'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
import { createSpatialStateCameraPort } from '../../componentPlatform/surfaces/spatial/stateCamera'
import { initialSpatialSurfaceView } from '../../store/slices/spatialAuthoringSlice'
import { SpatialLocationWorkspace } from './SpatialLocationWorkspace'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { resolveComponentBackground } from '../../../shared/contracts/component-platform'
import { projectWithBackgroundPreview } from '../../authoring/backgroundPreview'
import { proEditorRailController } from '../proEditorRailController'

/** The original workspace consumes the active document's one World and canonical writer. */
export function SpatialWorkspaceConnector({ onDropWorkspaceMedia }: { onDropWorkspaceMedia?: WorkspaceMediaDropHandler }) {
  const runtime = useCourseV10Runtime()
  const source = useEditorStore(useShallow(state => ({
    views: state.spatialViewStates, canvasMode: state.canvasMode, activation: state.courseView.activation,
    contentEdit: state.slideContentEdit, previewBackgroundColor: state.previewBackgroundColor, courseView: state.courseView,
  })))
  const surface = runtime.project.surfaces.find(value => value.id === runtime.surfaceId && value.kind === 'spatial')
  const surfaceId = surface?.id
  const view = surfaceId ? source.views[runtime.documentId]?.[surfaceId] ?? initialSpatialSurfaceView(surface?.spatial?.home) : initialSpatialSurfaceView()
  useEffect(() => { runtime.navigation.changed() }, [runtime.navigation, view.activeCameraFrameId, view.playbackPathId, view.playbackStepIndex, view.viewport, source.canvasMode, surface?.spatial?.defaultPathId])
  useEffect(() => {
    if (!surfaceId) return
    const state = () => useEditorStore.getState(), documentId = runtime.documentId
    if (!state().spatialViewStates[documentId]?.[surfaceId]) state().initializeSpatialView(surfaceId, documentId)
    const camera = createSpatialStateCameraPort({
      read: () => state().readSpatialView(surfaceId, documentId).camera,
      set: pose => state().setSpatialSessionCamera(pose, surfaceId, documentId),
      subscribe: listener => useEditorStore.subscribe((next, previous) => {
        const pose = next.spatialViewStates[documentId]?.[surfaceId]?.camera
        const old = previous.spatialViewStates[documentId]?.[surfaceId]?.camera
        if (pose && pose !== old) listener(pose)
      }),
    })
    const unregister = runtime.registerCamera(surfaceId, camera, {
      frameId: () => state().readSpatialView(surfaceId, documentId).activeCameraFrameId,
      selectFrame: id => state().setSpatialActiveCameraFrameId(id, surfaceId, documentId),
      // Author inspection stays temporary; every run starts from the formal default route.
      pathId: () => state().canvasMode === 'edit' ? state().readSpatialView(surfaceId, documentId).playbackPathId : undefined,
      stepIndex: () => state().readSpatialView(surfaceId, documentId).playbackStepIndex,
      selectStep: index => state().setSpatialPlaybackStepIndex(index, surfaceId, documentId),
      viewport: () => state().courseView.views.find(value => value.documentId === documentId)?.model.project.surfaces.find(value => value.id === surfaceId)?.designSize
        ?? { width: 1280, height: 720 },
    })
    return () => { unregister(); camera.dispose() }
  }, [runtime.documentId, surfaceId, runtime.registerCamera])
  useEffect(() => {
    const controller = new AbortController()
    if (source.canvasMode !== 'run') runtime.setPlaying(false)
    else if (runtime.world.isPlaying()) return () => controller.abort()
    else if (surfaceId) void runtime.navigation.initializeSpatialPlayback(controller.signal).then(accepted => {
      if (!controller.signal.aborted && accepted) runtime.setPlaying(true)
    }).catch(error => { if (!controller.signal.aborted) useEditorStore.getState().setError(String(error)) })
    return () => controller.abort()
  }, [runtime.documentId, surfaceId, runtime.navigation, runtime.setPlaying, source.canvasMode])
  if (!surface) return <main className="workspace workspace--spatial" role="alert"><p className="property-hint">请先选择一个空间页面。</p></main>
  const state = () => useEditorStore.getState()
  const projection = source.canvasMode === 'edit' ? projectWithBackgroundPreview(runtime.project, source.previewBackgroundColor,
    runtime.documentId, surface.id, source.courseView.activeStateId, source.courseView.snapshot?.epoch) : runtime.project
  const projectedSurface = projection.surfaces.find(value => value.id === surface.id)!
  const background = resolveComponentBackground(projection, projectedSurface)
  const safe = (result: unknown) => { void Promise.resolve(result).catch(error => state().setError(error instanceof Error ? error.message : String(error))) }
  return <SpatialLocationWorkspace documentId={runtime.documentId} project={projection} surface={projectedSurface} view={view}
    teacherController={runtime.navigation.editorPort()}
    activeStateId={source.courseView.activeStateId}
    selectionIds={runtime.selectedInstanceIds} canvasMode={source.canvasMode} renderInstance={(id, displayProjection) => runtime.renderInstance(id, displayProjection ?? projection)}
    backgroundAssetUrl={background.assetId ? runtime.world.assetUrl(background.assetId) : null}
    onViewportChange={size => state().setSpatialViewport(size, surface.id, runtime.documentId)}
    captureTarget={() => state().courseKernel.captureTarget(runtime.documentId)}
    onEdits={(edits, captured = state().courseKernel.captureTarget(runtime.documentId)) => state().courseKernel.editCaptured(state().courseKernel.capture(edits, captured))}
    onSelect={ids => runtime.selectInstances(ids, surface.id)}
    onCamera={pose => state().setSpatialSessionCamera(pose, surface.id, runtime.documentId)}
    onActivateFrame={id => state().activateSpatialCameraFrame(surface.id, id)}
    onGraphSelect={selection => {
      state().setSpatialGraphSelection(selection, surface.id)
      if (selection) proEditorRailController.open('properties')
    }}
    onCanvasModeChange={mode => { safe(state().commitTextEdit().then(() => state().setCanvasMode(mode))) }}
    onResetPlayback={async playing => {
      await state().commitTextEdit()
      await runtime.resetPlayback(playing)
      if (state().courseView.activeDocumentId !== runtime.documentId) runtime.setPlaying(false)
    }}
    onEditContent={id => {
      runtime.selectInstances([id], surface.id)
      state().setActiveTab('properties')
      proEditorRailController.open('properties')
    }}
    contentEdit={source.contentEdit?.target.documentId === runtime.documentId && source.contentEdit.target.surfaceId === surface.id
      && source.contentEdit.target.activeStateId === source.courseView.activeStateId ? source.contentEdit : null}
    contentEditor={{ read: () => {
      const draft = state().slideContentEdit
      return draft?.target.documentId === runtime.documentId && draft.target.surfaceId === surface.id
        && draft.target.activeStateId === state().courseView.activeStateId ? draft : null
    },
      begin: id => state().beginSlideDataEdit(id), update: (data, composing, height, width, rangeProjection) => state().updateSlideDataDraft(data, composing, height, width, rangeProjection),
      setComposing: active => state().setSlideTextEditComposing(active),
      commit: () => state().commitTextEdit(), cancel: () => state().cancelTextEdit(), undo: () => { safe(state().undo()) }, redo: () => { safe(state().redo()) }, report: message => state().setError(message) }}
    onPaste={() => { safe(state().pasteNodes()) }} onSelectAll={() => state().selectAllNodes()}
    onShowInstances={ids => { safe(state().updateNodes(ids.map(nodeId => ({ nodeId, patch: { visible: true } })))); runtime.selectInstances(ids, surface.id) }}
    onDropWorkspaceMedia={onDropWorkspaceMedia} activation={source.activation} />
}
