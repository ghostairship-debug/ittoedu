import { componentSurface } from '../../../shared/contracts/component-platform/project'
import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { selectActiveSlideContentEdit, useEditorStore } from '../../store/editorStore'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
import { createSpatialStateCameraPort } from '../../componentPlatform/surfaces/spatial/stateCamera'
import { initialSpatialSurfaceView } from '../../store/slices/spatialAuthoringSlice'
import { SpatialLocationWorkspace } from './SpatialLocationWorkspace'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { projectWithBackgroundPreview } from '../../authoring/backgroundPreview'
import { proEditorRailController } from '../proEditorRailController'
import type { ImportedImageAsset } from '../../project/assetManager'

/** The original workspace consumes the active document's one World and canonical writer. */
export function SpatialWorkspaceConnector({ onDropWorkspaceMedia, onSelectImageAsset }: { onDropWorkspaceMedia?: WorkspaceMediaDropHandler; onSelectImageAsset?(): Promise<ImportedImageAsset | null> }) {
  const runtime = useCourseV10Runtime()
  const source = useEditorStore(useShallow(state => ({
    views: state.spatialViewStates, canvasMode: state.canvasMode, activation: state.courseView.activation,
    contentEdit: selectActiveSlideContentEdit(state), previewBackgroundColor: state.previewBackgroundColor, courseView: state.courseView,
  })))
  const selectedSurface = componentSurface(runtime.project, runtime.surfaceId ?? '')
  const surface = selectedSurface?.kind === 'spatial' ? selectedSurface : undefined
  const surfaceId = surface?.id
  const nested = Boolean(surfaceId && !runtime.project.rootIds.includes(surfaceId))
  const editorNavigation = runtime.navigation.editorPort()
  const navigation = nested && surfaceId ? editorNavigation.forContainer?.(surfaceId) ?? editorNavigation : editorNavigation
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
      viewport: () => {
        const project = state().courseView.views.find(value => value.documentId === documentId)?.model.project
        return (project && componentSurface(project, surfaceId)?.designSize) ?? { width: 1280, height: 720 }
      },
    })
    return () => { unregister(); camera.dispose() }
  }, [runtime.documentId, surfaceId, runtime.registerCamera])
  useEffect(() => {
    const controller = new AbortController()
    if (source.canvasMode !== 'run') runtime.setPlaying(false)
    else if (runtime.world.isPlaying()) return () => controller.abort()
    else if (surfaceId) void (nested
      ? navigation.execute({ type: 'scene.go', sceneId: surfaceId }, controller.signal, undefined)
      : runtime.navigation.initializeSpatialPlayback(controller.signal)).then(accepted => {
      if (!controller.signal.aborted && accepted) runtime.setPlaying(true)
    }).catch(error => { if (!controller.signal.aborted) useEditorStore.getState().setError(String(error)) })
    return () => controller.abort()
  }, [runtime.documentId, surfaceId, runtime.navigation, runtime.setPlaying, source.canvasMode, nested, navigation])
  if (!surface) return <main className="workspace workspace--spatial" role="alert"><p className="property-hint">请先选择一个空间页面。</p></main>
  const state = () => useEditorStore.getState()
  const projection = source.canvasMode === 'edit' ? projectWithBackgroundPreview(runtime.project, source.previewBackgroundColor,
    runtime.documentId, surface.id, source.courseView.activeStateId, source.courseView.snapshot?.epoch) : runtime.project
  const projectedSurface = componentSurface(projection, surface.id)!
  const safe = (result: unknown) => { void Promise.resolve(result).catch(error => state().setError(error instanceof Error ? error.message : String(error))) }
  return <SpatialLocationWorkspace documentId={runtime.documentId} project={projection} surface={projectedSurface} view={view}
    teacherController={navigation}
    activeStateId={source.courseView.activeStateId}
    activeGroupId={source.courseView.activeGroupId}
    selectionIds={runtime.selectedInstanceIds} canvasMode={source.canvasMode} renderInstance={(id, displayProjection) => runtime.renderInstance(id, displayProjection ?? projection)}
    resolveBackgroundAsset={id => runtime.world.assetUrl(id) ?? undefined}
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
      await runtime.resetPlayback(playing, nested ? surface.id : undefined)
      if (state().courseView.activeDocumentId !== runtime.documentId) runtime.setPlaying(false)
    }}
    onEditContent={id => {
      runtime.selectInstances([id], surface.id)
      state().setActiveTab('properties')
      proEditorRailController.open('properties')
    }}
    onEnterGroup={id => { safe(state().navigateCourseView(() => state().courseBridge.enterGroup(runtime.documentId, id))) }}
    onEnterContainer={id => { safe(state().navigateCourseView(() => { state().courseBridge.enterContainer(runtime.documentId, id); state().setEditingScope('scene') })) }}
    contentEdit={source.contentEdit?.target.documentId === runtime.documentId && source.contentEdit.target.surfaceId === surface.id
      && source.contentEdit.target.activeStateId === source.courseView.activeStateId ? source.contentEdit : null}
    contentEditor={{ read: () => {
      const draft = selectActiveSlideContentEdit(state())
      return draft?.target.documentId === runtime.documentId && draft.target.surfaceId === surface.id
        && draft.target.activeStateId === state().courseView.activeStateId ? draft : null
    },
      readProject: () => state().courseBridge.read().editingProject ?? projection,
      begin: id => state().beginSlideDataEdit(id), update: (data, composing, height, width, rangeProjection, historyGroup, layoutReady) => state().updateSlideDataDraft(data, composing, height, width, rangeProjection, historyGroup, layoutReady),
      commitInput: () => state().commitSlideContentInput(),
      preserve: () => state().retainTextEdit(),
      setComposing: active => state().setSlideTextEditComposing(active),
      commit: () => state().commitTextEdit(), cancel: () => state().cancelTextEdit(), undo: () => { safe(state().undo()) }, redo: () => { safe(state().redo()) }, report: message => state().setError(message) }}
    onPaste={() => { safe(state().pasteNodes()) }} onSelectAll={() => state().selectAllNodes()}
    onShowInstances={ids => { safe(state().updateNodes(ids.map(nodeId => ({ nodeId, patch: { visible: true } })))); runtime.selectInstances(ids, surface.id) }}
    onSelectImageAsset={onSelectImageAsset} onDropWorkspaceMedia={onDropWorkspaceMedia} activation={source.activation} />
}
