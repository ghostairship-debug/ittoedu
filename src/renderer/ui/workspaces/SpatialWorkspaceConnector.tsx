import { useCallback, useMemo } from 'react'
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
import { mountPublishedCourseTryRun } from '../coursePlayerTryRun'
import { SpatialLocationWorkspace } from './SpatialLocationWorkspace'

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

export function SpatialWorkspaceConnector() {
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
  const commands = useMemo<SpatialAuthoringCommandPort>(() => ({
    run: runSpatialAuthoringIntent,
  }), [runSpatialAuthoringIntent])
  const view = useMemo(() => session
    ? buildSpatialEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
      sessionCamera: session.sessionCamera,
    })
    : null, [session])
  const assetMimeTypes = useMemo(() => session
    ? Object.fromEntries(
      Object.entries(session.history.present.assets).map(([id, meta]) => [id, meta.mimeType]),
    )
    : {}, [session])
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
      const layerTargets = new Map(view.layers.map((layer) => [
        layer.selectionId,
        captureSpatialEditorAuthoringTarget({
          view,
          sessionToken: authoringSession.token,
          target: { kind: 'layer', layerItemId: layer.selectionId, field: 'frame' },
        }),
      ] as const))
      return { worldTarget, layerTargets }
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

  return (
    <SpatialLocationWorkspace
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
      worldTarget={authoringTargets.worldTarget}
      layerTargets={authoringTargets.layerTargets}
      commands={commands}
      onCanvasModeChange={setCanvasMode}
      onMountTryRun={onMountTryRun}
    />
  )
}
