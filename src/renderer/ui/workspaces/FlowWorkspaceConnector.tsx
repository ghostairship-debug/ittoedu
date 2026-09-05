import { useCallback, useMemo } from 'react'
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

type FlowWorkspaceStore = {
  readonly flowSession: FlowAuthoringSession | null
  readonly courseAuthoringSession: CourseAuthoringSession | null
  readonly canvasMode: 'edit' | 'run'
  readonly componentPackages: Record<string, ComponentPackageData>
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

export function FlowWorkspaceConnector() {
  const session = useEditorStore(selectFlowSession)
  const authoringSession = useEditorStore(selectCourseAuthoringSession)
  const canvasMode = useEditorStore(selectCanvasMode)
  const editingScope = useEditorStore(selectEditingScope)
  const assetFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(selectComponentPackages)
  const textEdit = useEditorStore(selectFlowTextEdit)
  const runFlowAuthoringIntent = useEditorStore(selectRunFlowAuthoringIntent)
  const setCanvasMode = useEditorStore(selectSetCanvasMode)
  const commands = useMemo<FlowCurrentSessionCommandPort>(() => ({
    run: runFlowAuthoringIntent,
  }), [runFlowAuthoringIntent])
  const previewBackgroundColor = useEditorStore((state) => state.previewBackgroundColor)
  const view = useMemo(() => {
    if (!session) return null
    const baseView = buildFlowEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
    })
    if (!previewBackgroundColor) return baseView
    return {
      ...baseView,
      backgroundColor: previewBackgroundColor,
    }
  }, [session, previewBackgroundColor])
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

  return (
    <FlowLocationWorkspace
      view={view}
      sessionToken={authoringSession.token}
      assets={session.history.present.assets}
      selection={session.selection}
      textEdit={textEdit}
      canvasMode={canvasMode}
      editingScope={editingScope === 'global' ? 'global' : 'scene'}
      assetFiles={assetFiles}
      componentPackages={componentPackages}
      commands={commands}
      onCanvasModeChange={setCanvasMode}
      onMountTryRun={onMountTryRun}
    />
  )
}
