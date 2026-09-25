import { useEffect, useRef } from 'react'
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
 const sessionDock = useWorkbenchSessionDock()
 useEffect(() => { sessionDock.setScope?.(null) }, [state.workspace])
 const setConversationScope = (path: string, kind: 'folder' | 'file', workspaceId?: string) => {
   const root = state.workspace?.replace(/\\/g, '/').replace(/\/$/, '')
   const selected = path.replace(/\\/g, '/')
   if (!root || selected.toLocaleLowerCase() === root.toLocaleLowerCase()) { sessionDock.setScope?.(null); return }
   const relative = selected.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`) ? selected.slice(root.length + 1) : ''
   sessionDock.setScope?.(relative ? { kind, path: relative, workspaceId } satisfies ConversationScope : null)
 }
 const explorerOpen = editorFocus ? proPanel === 'resources' : layout.prefs.explorerOpen
 const conversationsOpen = editorFocus ? proPanel === 'conversations' : layout.prefs.conversationsOpen
 return <nav ref={navigation} className="lesson-workspace-navigation" aria-label="工作空间导航" data-explorer-open={explorerOpen} data-conversations-open={conversationsOpen}>
   <section className="lesson-workspace-pane lesson-workspace-files" hidden={!explorerOpen} aria-label="资源管理器">
     <header><strong>资源管理器</strong></header>
     {state.workspace ? <div className="lesson-pane-body">
       <button type="button" className="lesson-workspace-root" title="显示全部会话" style={{ border: 0, padding: 0, background: 'transparent', cursor: 'pointer', width: '100%' }} onClick={() => sessionDock.setScope?.(null)}>{state.workspace}</button>
       <LessonDirectoryTree refreshVersion={state.treeVersion} files={props.workspaceFiles} directory={state.workspace} operation={props.operation}
         onFile={entry => { layout.setContentClosed(false); actions.setMobilePane('workbench'); void actions.run(() => actions.openFile(entry)) }}
         onDirectory={actions.setSelectedDirectory} onScope={setConversationScope} onSaveDirectoryChange={props.onSaveDirectoryChange} />
     </div> : <div className="lesson-pane-body"><p>打开文件夹以浏览和整理文件。</p>
       <button type="button" onClick={() => void actions.run(() => actions.openWorkspace())}>打开文件夹</button>
     </div>}
   </section>
   <div className="lesson-workspace-section-splitter" hidden={!explorerOpen || !conversationsOpen}
     onPointerDownCapture={layout.beginResize} onPointerUp={layout.endResize} onPointerCancel={layout.endResize} onLostPointerCapture={layout.endResize}>
     <WorkbenchSplitter label="调整资源管理器与会话列表高度" orientation="horizontal" direction={-1} value={layout.prefs.sessionsHeight}
       onResizeDelta={delta => layout.setSessionsHeight(Math.min(layout.prefs.sessionsHeight + delta, (navigation.current?.clientHeight ?? 700) - 180))} />
   </div>
   <section className="lesson-workspace-pane lesson-workspace-sessions" hidden={!conversationsOpen} aria-label="会话管理区"
     style={explorerOpen ? { flexBasis: layout.prefs.sessionsHeight } : undefined}>
     <WorkbenchSessionDock />
   </section>
 </nav>
}
