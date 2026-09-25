import { useEffect, useRef, useState, type ReactNode } from 'react'
import { WorkbenchSplitter } from './WorkbenchSplitter'
import { resolveWorkbenchWidths, type WorkbenchLayoutController } from './useWorkbenchLayoutPrefs'
import type { ProEditorPanel } from '../../ui/proEditorRailController'
export function WorkspaceGrid({ layout, editorFocus, proPanel = null, mobilePane, selectPane, resources, content, assistant }: {
 layout: WorkbenchLayoutController; editorFocus: boolean; mobilePane: 'navigation' | 'chat' | 'workbench';
 proPanel?: ProEditorPanel;
 selectPane(pane: 'navigation' | 'chat' | 'workbench'): void; resources: ReactNode; content: ReactNode; assistant: ReactNode;
}) {
 const host = useRef<HTMLDivElement>(null)
 const [width, setWidth] = useState(1200)
 useEffect(() => {
   const element = host.current
   if (!element) return
   const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? element.clientWidth))
   observer.observe(element)
   return () => observer.disconnect()
 }, [])
 const sizes = resolveWorkbenchWidths(layout.prefs, width, editorFocus)
 const hasAssistant = assistant !== null && assistant !== false
 const chat = hasAssistant && !editorFocus ? sizes.chat : 0
 const navTrack = sizes.nav ? (!sizes.content && !chat ? 'minmax(0,1fr)' : `${sizes.nav}px`) : '0px'
 const chatTrack = chat ? (sizes.content ? `${chat}px` : 'minmax(0,1fr)') : '0px'
 const navSplitter = sizes.navSplitter
 const chatSplitter = sizes.chatSplitter && !!chat
 const pane = mobilePane
 return <div ref={host} className="lesson-workspace-columns workspace-grid" data-active-pane={pane} data-editor-focus={editorFocus}
   data-pro-panel={editorFocus ? proPanel ?? '' : ''}
   data-nav-collapsed={!editorFocus && !sizes.nav} data-content-closed={!sizes.content} data-chat-closed={!editorFocus && !chat}
   style={{ gridTemplateColumns: `${navTrack} ${navSplitter ? 5 : 0}px ${sizes.content ? 'minmax(0,1fr)' : '0px'} ${chatSplitter ? 5 : 0}px ${chatTrack}` }}>
   <div className="lesson-workspace-pane-switcher" role="tablist" aria-label="工作台区域">
     {(['navigation', 'workbench', 'chat'] as const).map((id, index) => <button key={id} type="button" role="tab" aria-selected={pane === id}
       onClick={() => { selectPane(id); if (id === 'navigation') layout.setNavCollapsed(false); if (id === 'workbench') layout.setContentClosed(false); if (id === 'chat') layout.setChatClosed(false) }}>
       {['资源管理器与会话列表', '内容', 'AI 助手'][index]}</button>)}
   </div>
   <div className="workspace-region workspace-region--resources">{resources}</div>
   <div className="workspace-grid-splitter workspace-grid-splitter--resources" hidden={!navSplitter}
     onPointerDownCapture={layout.beginResize} onPointerUp={layout.endResize} onPointerCancel={layout.endResize} onLostPointerCapture={layout.endResize}>
     <WorkbenchSplitter label="调整资源区宽度" orientation="vertical" value={sizes.nav}
       onResizeDelta={delta => layout.setNavWidth(Math.min(sizes.nav + delta, width - chat - (sizes.content ? 320 : 0) - 10))} />
   </div>
   <div className="workspace-region workspace-region--content">{content}</div>
   <div className="workspace-grid-splitter workspace-grid-splitter--assistant" hidden={!chatSplitter}
     onPointerDownCapture={layout.beginResize} onPointerUp={layout.endResize} onPointerCancel={layout.endResize} onLostPointerCapture={layout.endResize}>
     <WorkbenchSplitter label="调整会话区宽度" orientation="vertical" value={chat}
       onResizeDelta={delta => layout.setChatWidth(Math.min(chat - delta, width - sizes.nav - 330))} />
   </div>
   <div className="workspace-region workspace-region--assistant">{assistant}</div>
 </div>
}
