import { useEffect, useRef, useState } from 'react'
import { Folder, ChevronUp, ChevronDown } from 'lucide-react'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import type { WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import { LessonDirectoryTree } from './LessonDirectoryTree'
import { WorkbenchSplitter } from './WorkbenchSplitter'
import { WorkbenchSessionDock } from '../../workbench/WorkbenchSessionPortal'
import { useWorkbenchSessionDock, type ConversationScope } from '../../workbench/WorkbenchSessionPortal'
import type { ProEditorPanel } from '../../ui/proEditorRailController'
export function WorkspaceResources({ props, layout, editorFocus = false, proPanel = null }: {
 props: LessonWorkspaceViewProps; layout: WorkbenchLayoutController; editorFocus?: boolean; proPanel?: ProEditorPanel
}) {
 const { state, actions } = props
 const navigation = useRef<HTMLElement>(null)
 const [height, setHeight] = useState(700)
 useEffect(() => {
   if (!navigation.current || typeof ResizeObserver === 'undefined') return
   const observer = new ResizeObserver(() => setHeight(navigation.current?.clientHeight || 700))
   observer.observe(navigation.current); return () => observer.disconnect()
 }, [])
 const sessionDock = useWorkbenchSessionDock()
 useEffect(() => { sessionDock.setScope?.(null) }, [state.workspace])
 const explorerOpen = editorFocus ? proPanel === 'resources' : layout.prefs.explorerOpen
 const conversationsOpen = editorFocus ? proPanel === 'conversations' : layout.prefs.conversationsOpen
 return <nav ref={navigation} className="lesson-workspace-navigation" aria-label="工作空间导航" data-explorer-open={explorerOpen} data-conversations-open={conversationsOpen}>
   <section className="lesson-workspace-pane lesson-workspace-files" data-collapsed={!explorerOpen} aria-label="资源管理器">
     <header><strong>资源管理器</strong>{!editorFocus && <button type="button" className="lesson-icon-button" title={explorerOpen ? '向上收起资源管理器' : '向下展开资源管理器'} aria-label={explorerOpen ? '收起资源管理器' : '展开资源管理器'} onClick={() => layout.setExplorerOpen(!explorerOpen)}>{explorerOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>}</header>
     {explorerOpen && (state.workspace ? <div className="lesson-pane-body">
       {!props.workspaceFiles && <button type="button" className="workspace-tree-root" aria-label="工作空间根目录" title={`${state.workspace} · 显示全部会话`} onClick={() => sessionDock.setScope?.(null)}><Folder size={16} aria-hidden="true" /><span>{state.workspace.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || state.workspace}</span></button>}
       <LessonDirectoryTree refreshVersion={state.treeVersion} files={props.workspaceFiles} directory={state.workspace} operation={props.operation}
         onFile={entry => { layout.setContentClosed(false); actions.setMobilePane('workbench'); void actions.run(() => actions.openFile(entry)) }}
         onDirectory={actions.setSelectedDirectory} onSaveDirectoryChange={props.onSaveDirectoryChange} onImportHtml={props.onImportHtml} onImportFlow={props.onImportFlow} />
     </div> : <div className="lesson-pane-body"><p>打开文件夹以浏览和整理文件。</p>
       <button type="button" onClick={() => void actions.run(() => actions.openWorkspace())}>打开文件夹</button>
     </div>)}
   </section>
   <div className="lesson-workspace-section-splitter" hidden={!explorerOpen || !conversationsOpen}
     onPointerDownCapture={layout.beginResize} onPointerUp={layout.endResize} onPointerCancel={layout.endResize} onLostPointerCapture={layout.endResize}>
     <WorkbenchSplitter label="调整资源管理器与会话列表高度" orientation="horizontal" direction={-1} value={height * layout.prefs.sessionsRatio}
       onResizeDelta={delta => layout.setSessionsRatio(layout.prefs.sessionsRatio + delta / Math.max(1, height - 72))} />
   </div>
   <section className="lesson-workspace-pane lesson-workspace-sessions" data-collapsed={!conversationsOpen} aria-label="会话管理区"
     style={explorerOpen && conversationsOpen ? { flex: `0 0 ${layout.prefs.sessionsRatio * 100}%`, maxHeight: 'none' } : undefined}>
     <header><strong>工作空间会话</strong>{!editorFocus && <button type="button" className="lesson-icon-button" title={conversationsOpen ? '向下收起会话列表' : '向上展开会话列表'} aria-label={conversationsOpen ? '收起会话列表' : '展开会话列表'} onClick={() => layout.setConversationsOpen(!conversationsOpen)}>{conversationsOpen ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>}</header>
     <div hidden={!conversationsOpen} className="workbench-session-region"><WorkbenchSessionDock /></div>
   </section>
 </nav>
}
