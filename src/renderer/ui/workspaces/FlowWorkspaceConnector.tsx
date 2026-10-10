import { selectEditingScope, useEditorStore } from '../../store/editorStore'
import { FlowLocationWorkspace } from './FlowLocationWorkspace'
import type { WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import type { ImportedImageAsset } from '../../project/assetManager'
import { projectWithBackgroundPreview } from '../../authoring/backgroundPreview'
import { projectWithSlideContentDraft } from '../../store/slices/slideAuthoringSlice'
export function FlowWorkspaceConnector({ onDropWorkspaceMedia, onSelectImageAsset, onSelectMediaAsset }: { onDropWorkspaceMedia?: WorkspaceMediaDropHandler; onSelectImageAsset(): Promise<ImportedImageAsset | null>; onSelectMediaAsset?(kind:'image'|'audio'|'video'):Promise<ImportedImageAsset|null> }) {
  const courseView = useEditorStore(state => state.courseView)
  const canvasMode = useEditorStore(state => state.canvasMode)
  const editingScope = useEditorStore(selectEditingScope)
  const setCanvasMode = useEditorStore(state => state.setCanvasMode)
  const setStatus = useEditorStore(state => state.setStatus)
  const preview = useEditorStore(state => state.previewBackgroundColor)
  const contentDraft = useEditorStore(state => state.slideContentEdit)
  const currentProject = courseView.editingProject ?? courseView.project
  const editingProject = currentProject && canvasMode === 'edit' ? projectWithSlideContentDraft(currentProject,contentDraft,{
    documentId:courseView.activeDocumentId ?? '',epoch:courseView.snapshot?.epoch,surfaceId:courseView.surfaceId,activeStateId:courseView.activeStateId,
  }) : currentProject
  const project = editingProject && canvasMode === 'edit' ? projectWithBackgroundPreview(editingProject,preview,courseView.activeDocumentId,courseView.surfaceId,courseView.activeStateId,courseView.snapshot?.epoch) : editingProject
  const surface = project?.surfaces.find(value => value.id === courseView.surfaceId)
  if (!project || !courseView.activeDocumentId || surface?.kind !== 'flow') return <main className="workspace workspace--flow" role="alert"><p className="property-hint">没有活动的 Flow 编辑会话</p></main>
  return <FlowLocationWorkspace documentId={courseView.activeDocumentId} project={project} surfaceId={surface.id}
    canvasMode={canvasMode} editingScope={editingScope === 'global' ? 'global' : 'scene'}
    beforeNavigate={() => useEditorStore.getState().commitTextEdit()}
    onCanvasModeChange={mode => { void useEditorStore.getState().commitTextEdit().then(() => setCanvasMode(mode)).catch(error => setStatus(error instanceof Error ? error.message : String(error))) }}
    onDropWorkspaceMedia={onDropWorkspaceMedia} onSelectImageAsset={onSelectImageAsset} onSelectMediaAsset={onSelectMediaAsset} onStatus={setStatus} />
}
