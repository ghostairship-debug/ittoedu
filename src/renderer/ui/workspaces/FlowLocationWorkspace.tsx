import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { MousePointer2, Play } from 'lucide-react'
import type { FlowWorkspaceProps } from '../FlowWorkspace'
import { FlowWorkspace } from '../FlowWorkspace'
import { FLOW_WORKSPACE_HEADER_HEIGHT } from '../FlowBlockContextToolbar'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
export type FlowCanvasMode = 'edit' | 'run'
export type FlowEditingScope = 'scene' | 'global'
export interface FlowTryRunSession { destroy(): void | Promise<void> }
export interface FlowLocationWorkspaceProps extends FlowWorkspaceProps {
  canvasMode: FlowCanvasMode
  editingScope: FlowEditingScope
  onCanvasModeChange(mode: FlowCanvasMode): void
}
/** The original shell keeps a single mounted body while switching edit/run. R0 owns every implementation. */
export function FlowLocationWorkspace(props: FlowLocationWorkspaceProps) {
  const runtime = useCourseV10Runtime()
  useEffect(() => {
    runtime.setPlaying(props.canvasMode === 'run')
    return () => runtime.setPlaying(false)
  }, [runtime.documentId, runtime.setPlaying, props.canvasMode])
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(FLOW_WORKSPACE_HEADER_HEIGHT)
  useLayoutEffect(() => {
    if (!toolbarContainer) return
    const measure = () => setHeaderHeight(Math.max(FLOW_WORKSPACE_HEADER_HEIGHT, Math.ceil(toolbarContainer.getBoundingClientRect().height) + 12))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(toolbarContainer)
    return () => observer.disconnect()
  }, [toolbarContainer])
  const surface = props.project.surfaces.find(value => value.id === props.surfaceId)
  return <main className={`workspace workspace--${props.canvasMode} workspace--flow`} data-testid="flow-workspace-shell"
    data-flow-not-slide-stage="true" style={{ '--flow-workspace-header-height': `${headerHeight}px` } as CSSProperties}>
    <div ref={setToolbarContainer} className="flow-workspace-toolbar-host" data-testid="flow-workspace-toolbar-host" style={{ height: 'auto' }} />
    <div className="canvas-mode-switch" role="group" aria-label="画布模式">
      <button type="button" className={props.canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''} aria-pressed={props.canvasMode === 'edit'} onClick={() => props.onCanvasModeChange('edit')}><MousePointer2 size={13} />编辑状态</button>
      <button type="button" className={props.canvasMode === 'run' ? 'canvas-mode-switch__active' : ''} aria-pressed={props.canvasMode === 'run'} onClick={() => props.onCanvasModeChange('run')}><Play size={13} />当前位置试运行</button>
    </div>
    <div className={`canvas-label${props.editingScope === 'global' ? ' canvas-label--global' : ''}`}>{props.editingScope === 'global' ? '全局层 · 视口浮层' : surface?.title}</div>
    <div className="canvas-viewport"><FlowWorkspace {...props} toolbarContainer={toolbarContainer} readOnly={props.canvasMode === 'run'} /></div>
  </main>
}
