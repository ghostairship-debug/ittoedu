import { useState } from 'react'
import type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'
import { useWorkbenchLayoutPrefs } from './useWorkbenchLayoutPrefs'
import { WorkspaceChrome } from './WorkspaceChrome'
import { WorkspaceResources } from './WorkspaceResources'
import { WorkspaceContentHost } from './WorkspaceContentHost'
import { WorkspaceSessionHost } from './WorkspaceSessionHost'
import { WorkspaceGrid } from './WorkspaceGrid'
import { WorkbenchSessionPortalProvider } from '../../workbench/WorkbenchSessionPortal'
import { proEditorRailController, useProEditorRailState } from '../../ui/proEditorRailController'
import { WorkspaceMediaSourceProvider } from '../workspaceMediaSourceContext'
export type { LessonWorkspaceViewProps } from './lessonWorkspaceViewTypes'

/** Composition only: layout changes retain each region's parent and component identity. */
export function LessonWorkspaceView(props: LessonWorkspaceViewProps) {
 const layout = useWorkbenchLayoutPrefs()
 const [editorFocus, setEditorFocus] = useState(false)
 const { activePanel } = useProEditorRailState()
 const exitEditor = () => { proEditorRailController.close(); setEditorFocus(false) }
 return <WorkspaceMediaSourceProvider directory={props.state.workspace} files={props.workspaceFiles}><WorkbenchSessionPortalProvider><div className="lesson-workspace-shell" data-execution={true} data-editor-focus={editorFocus}>
   {!editorFocus && <WorkspaceChrome props={props} layout={layout} proPanel={activePanel} exitEditor={exitEditor} />}
   {props.state.error && <div role="alert" className="lesson-workspace-error">{props.state.error}</div>}
   <WorkspaceGrid layout={layout} editorFocus={editorFocus} proPanel={activePanel} mobilePane={props.state.mobilePane} selectPane={props.actions.setMobilePane}
     resources={<WorkspaceResources props={props} layout={layout} editorFocus={editorFocus} proPanel={activePanel} />}
     content={<WorkspaceContentHost props={props} layout={layout} editorFocus={editorFocus} enterEditor={() => { proEditorRailController.close(); setEditorFocus(true); props.actions.setMobilePane('workbench') }} exitEditor={exitEditor} />}
     assistant={<WorkspaceSessionHost props={props} />} />
 </div></WorkbenchSessionPortalProvider></WorkspaceMediaSourceProvider>
}
