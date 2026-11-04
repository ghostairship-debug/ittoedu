import { componentSurface } from '../../../shared/contracts/component-platform/project'
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import type { FlowWorkspaceProps } from '../FlowWorkspace'
import { FlowWorkspace } from '../FlowWorkspace'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
import { CourseNavigationControls } from './CourseNavigationControls'
export type FlowCanvasMode = 'edit' | 'run'
export type FlowEditingScope = 'scene' | 'global'
export interface FlowTryRunSession { destroy(): void | Promise<void> }
export interface FlowLocationWorkspaceProps extends FlowWorkspaceProps {
  canvasMode: FlowCanvasMode
  editingScope: FlowEditingScope
  onCanvasModeChange(mode: FlowCanvasMode): void
  beforeNavigate?(): Promise<void>
}
/** The original shell keeps a single mounted body while switching edit/run. R0 owns every implementation. */
export function FlowLocationWorkspace(props: FlowLocationWorkspaceProps) {
  const runtime = useCourseV10Runtime()
  useEffect(() => {
    runtime.setPlaying(props.canvasMode === 'run')
    return () => runtime.setPlaying(false)
  }, [runtime.documentId, runtime.setPlaying, props.canvasMode])
  const [toolbarContainer, setToolbarContainer] = useState<HTMLDivElement | null>(null)
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  const [headerHeight, setHeaderHeight] = useState(44)
  useLayoutEffect(() => {
    if (!header) return
    const measure = () => setHeaderHeight(Math.ceil(header.getBoundingClientRect().height) || 44)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [header])
  const surface = componentSurface(props.project, props.surfaceId)
  const nested = !props.project.rootIds.includes(props.surfaceId)
  const editorNavigation = runtime.navigation.editorPort()
  const navigation = nested ? editorNavigation.forContainer?.(props.surfaceId) ?? editorNavigation : editorNavigation
  return <main className={`workspace workspace--${props.canvasMode} workspace--flow`} data-testid="flow-workspace-shell"
    data-flow-not-slide-stage="true" style={{ '--flow-workspace-header-height': `${headerHeight}px` } as CSSProperties}>
    <div ref={setHeader} className="flow-workspace-header">
      <div ref={setToolbarContainer} className="flow-workspace-toolbar-host" data-testid="flow-workspace-toolbar-host" />
      <div className={`canvas-label${props.editingScope === 'global' ? ' canvas-label--global' : ''}`}>{props.editingScope === 'global' ? '全局层 · 视口浮层' : surface?.title}</div>
      <CourseNavigationControls canvasMode={props.canvasMode} onCanvasModeChange={props.onCanvasModeChange}
        navigation={navigation} beforeNavigate={props.beforeNavigate}
        resetPlayback={async playing => {
          await props.beforeNavigate?.()
          await runtime.resetPlayback(playing, nested ? props.surfaceId : undefined)
        }}
        report={message => props.onStatus?.(message)} />
    </div>
    <div className="canvas-viewport"><FlowWorkspace {...props} toolbarContainer={toolbarContainer} readOnly={props.canvasMode === 'run'} /></div>
  </main>
}
