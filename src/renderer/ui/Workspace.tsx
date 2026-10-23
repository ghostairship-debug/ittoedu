import type { ImportedImageAsset } from '../project/assetManager'
import type { MediaImportItem } from '../app/useMediaImport'
import type { WorkspaceMediaDropHandler } from '../lessonWorkspace/workspaceMediaDrop'
import { FlowWorkspaceConnector } from './workspaces/FlowWorkspaceConnector'
import { SlideWorkspaceConnector } from './workspaces/SlideWorkspaceConnector'
import { SpatialWorkspaceConnector } from './workspaces/SpatialWorkspaceConnector'
import { useWorkspaceRoute } from './workspaces/WorkspaceRouteContext'
import { useEffect, useRef, type ReactNode } from 'react'
import { selectActiveSlideContentEdit, useEditorStore } from '../store/editorStore'
import { containerEditingPath, globalContainerEditingLocation } from '../documents/containerEditingContext'
import { isComponentVisibleAtSurface } from '../../shared/contracts/component-platform/project'
import { useCourseV10Runtime } from '../components/CourseV10RuntimeView'
import { useComponentAuthorInteraction } from './workspaces/useComponentAuthorInteraction'
import { NativeSelectionContext } from '../workbench/NativeSelectionContext'

interface WorkspaceProps {
  onAddImage(x?: number, y?: number): void
  onAddVideo(x?: number, y?: number): void
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
  onSelectMediaAsset?(kind: 'image' | 'audio' | 'video'): Promise<MediaImportItem | null>
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
}

export function Workspace({
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
  onSelectMediaAsset,
  onDropWorkspaceMedia,
}: WorkspaceProps) {
  const route = useWorkspaceRoute()
  const view = useEditorStore(state => state.courseView)
  const retainedInputs = useEditorStore(state => state.retainedSlideContentEdits)
  const retained = (retainedInputs ?? []).filter(record => record.documentId === view.activeDocumentId)
  const selected = view.project?.instances[view.selectedInstanceId ?? '']
  const bridge = useEditorStore(state => state.courseBridge)
  const sharedLocation = view.project && selected?.container ? globalContainerEditingLocation(view.project, selected.id) : null
  const canEnterSelected = Boolean(selected?.container && view.project && view.rootInstanceId && containerEditingPath(view.project, view.rootInstanceId, selected.id) && (!sharedLocation || sharedLocation.path.every(id => isComponentVisibleAtSurface(view.project!.instances[id], view.rootInstanceId ?? ''))))
  const scopeControls = view.activeDocumentId && (view.editingContainerId || canEnterSelected) ? <nav aria-label="容器编辑位置"
    style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', flex: '0 0 auto' }}>
    {view.editingContainerId && <button type="button" data-testid="container-edit-return" onClick={() => {
      const documentId = view.activeDocumentId!
      void useEditorStore.getState().navigateCourseView(() => {
        bridge.leaveContainer(documentId)
        if (view.editingPlane && (view.editingPath?.length ?? 0) <= 1) {
          useEditorStore.getState().setEditingScope('global')
          bridge.selectInstances(documentId, [view.editingContainerId!])
        }
      })
    }}>返回上层</button>}
    <span>{view.editingPlane ? view.editingPlane === 'underlay' ? '共享底层 / ' : '共享浮层 / ' : ''}{view.editingPath?.map(id => view.project?.instances[id]?.name ?? view.project?.title ?? id).join(' / ')}</span>
    {canEnterSelected && selected && selected.id !== view.surfaceId && <button type="button" data-testid="container-edit-enter" onClick={() => {
      const documentId = view.activeDocumentId!, containerId = selected.id
      void useEditorStore.getState().navigateCourseView(() => {
        bridge.enterContainer(documentId, containerId); useEditorStore.getState().setEditingScope('scene')
      })
    }}>进入容器编辑</button>}
  </nav> : null
  const retainedView = retained.length ? <details style={{ padding: '4px 10px', fontSize: 12 }}>
    <summary>保留的文字原稿（{retained.length}）</summary>
    <p>这些输入尚未应用，当前内容可以继续编辑。可复制原文后在对应位置接续。</p>
    {retained.map((record, index) => {
      const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : {}
      const raw = typeof payload.spotText === 'string' ? payload.spotText : JSON.stringify(payload.spotValue ?? payload.data ?? record.payload, null, 2)
      return <label key={`${record.key}:${index}`} style={{ display: 'block' }}>原稿 {index + 1}
        <textarea readOnly aria-label={`保留的文字原稿 ${index + 1}`} value={raw} rows={4} style={{ width: '100%' }} />
      </label>
    })}
  </details> : null
  const hasHeader = Boolean(scopeControls || retainedView)
  const frame = (content: ReactNode) => <div data-container-editor-frame="" style={{ display: 'grid', gridTemplateRows: hasHeader ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)', minWidth: 0, minHeight: 0 }}>
    {hasHeader && <div>{scopeControls}{retainedView}</div>}{content}
  </div>
  if (route.kind === 'conflict') {
    return (
      <main className="workspace" data-testid="workspace-route-conflict" role="alert">
        <p className="property-hint">{route.message}</p>
      </main>
    )
  }
  if (route.kind === 'program') return frame(<ProgramWorkspace rootInstanceId={route.rootInstanceId} onSelectImageAsset={onSelectImageAsset} />)
  if (route.kind === 'flow') return frame(<FlowWorkspaceConnector onDropWorkspaceMedia={onDropWorkspaceMedia} onSelectImageAsset={onSelectImageAsset} onSelectMediaAsset={onSelectMediaAsset} />)
  if (route.kind === 'spatial') return frame(<SpatialWorkspaceConnector onDropWorkspaceMedia={onDropWorkspaceMedia} onSelectImageAsset={onSelectImageAsset} />)
  return frame(
    <SlideWorkspaceConnector
      onAddImage={onAddImage}
      onAddVideo={onAddVideo}
      onSelectImageAsset={onSelectImageAsset}
      onDropWorkspaceMedia={onDropWorkspaceMedia}
    />
  )
}

/** A program consumes the actual workspace viewport and the existing component runtime. */
function ProgramWorkspace({ rootInstanceId, onSelectImageAsset }: { rootInstanceId: string; onSelectImageAsset(): Promise<ImportedImageAsset | null> }) {
  const runtime = useCourseV10Runtime()
  const canvasMode = useEditorStore(state => state.canvasMode)
  const root = useRef<HTMLElement>(null)
  const contentDraft = useEditorStore(selectActiveSlideContentEdit)
  const authorInteraction = useComponentAuthorInteraction({ root, documentId: runtime.documentId, surfaceId: runtime.surfaceId ?? null,
    enabled: canvasMode === 'edit', selectImage: onSelectImageAsset, report: message => useEditorStore.getState().setError(message) })
  useEffect(() => { runtime.setPlaying(canvasMode === 'run') }, [runtime.setPlaying, canvasMode])
  return <main ref={root} className="workspace workspace--program" data-testid="program-workspace"
    onPointerDownCapture={event => { authorInteraction.pointerFromElement(event) }}
    onContextMenuCapture={event => { authorInteraction.contextMenuFromElement(event) }}
    style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0, minHeight: 0, flex: 1 }}>
    <NativeSelectionContext documentId={runtime.documentId} revision={runtime.project.revision} surfaceId={runtime.surfaceId}
      itemIds={runtime.selectedInstanceIds} enabled={canvasMode === 'edit'} textEditing={Boolean(contentDraft)}
      authorSpot={authorInteraction.selectedSpot} authorBounds={authorInteraction.authorBounds} />
    <div style={{ display: 'flex', gap: 8, flex: '0 0 auto', padding: '6px 10px' }}>
      {(['edit', 'run'] as const).map(mode => <button key={mode} type="button" aria-pressed={canvasMode === mode} onClick={() => {
        void useEditorStore.getState().commitTextEdit().then(() => useEditorStore.getState().setCanvasMode(mode))
          .catch(error => useEditorStore.getState().setError(String(error)))
      }}>{mode === 'edit' ? '编辑' : '试运行'}</button>)}
      {canvasMode === 'edit' && <span role="status">点文字编辑；选中对象后使用可用手柄</span>}
      <button type="button" onClick={() => runtime.selectInstances([rootInstanceId])}>选择程序</button>
    </div>
    <div data-program-viewport="" style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
      {runtime.project.global.underlay.map(id => runtime.renderInstance(id, runtime.project, 'free'))}
      {runtime.renderInstance(rootInstanceId, runtime.project, 'program')}
      {runtime.project.global.overlay.map(id => runtime.renderInstance(id, runtime.project, 'free'))}
    </div>
    {authorInteraction.editor}
  </main>
}
