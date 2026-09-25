import type { WorkspaceFilesAPI } from '../../shared/workbench/workspaceFiles'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../shared/lessonDesktopContract'
import type { LessonWorkspace } from '../../shared/lessonWorkspace'
import type { RecoverableDocumentFilePort } from '../documentFiles/documentFileSession'
import type { SaveDirectoryContext } from '../../shared/workbench/desktop'
import { useDocumentTabsController, type CourseDocumentsPort, type ActiveDocumentTarget } from './controller/useDocumentTabsController'
import { useLessonWorkspaceController } from './controller/useLessonWorkspaceController'
import { LessonWorkspaceView } from './view/LessonWorkspaceView'
import './lessonWorkspaceShell.css'

export interface LessonWorkspaceShellProps {
  workspaceFiles?: WorkspaceFilesAPI
  courseDocuments?: CourseDocumentsPort
  lessonOperation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  documentPort: RecoverableDocumentFilePort
  projectPath: string | null
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  renderAssistant?(root: string | null, documentTarget: ActiveDocumentTarget | undefined, isCourse: boolean, drainDocuments: () => Promise<boolean>): ReactNode
  renderMaterial?(path: string, lesson: LessonWorkspace | null): ReactNode
  renderMaterials?(lesson: LessonWorkspace): ReactNode
  onDirtyChange?(dirty: boolean): void
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void
  children: ReactNode
}

export interface LessonWorkspaceShellHandle {
  flushAll(): Promise<boolean>
  saveActiveDocument(): Promise<'course' | 'document' | 'none'>
  closeAll(): Promise<boolean>
  preserveAll(): Promise<boolean>
  openFile(path: string): Promise<void>
  focusDocument(documentId: string): Promise<void>
  detachLesson(): void
  showProject(): void
}

/** Composition and lifecycle bridge for the lesson workspace. Rendering and local writers live in dedicated modules. */
export const LessonWorkspaceShell = forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceShellProps>(function LessonWorkspaceShell(props, ref) {
  const tabs = useDocumentTabsController({ documentPort: props.documentPort, courseDocuments: props.courseDocuments })
  const workspace = useLessonWorkspaceController({ lessonOperation: props.lessonOperation, projectPath: props.projectPath, onOpenProject: props.onOpenProject, onNewProject: props.onNewProject, tabs })
  const shownWorkspace = useRef(workspace.state.workspace)
  useLayoutEffect(() => {
    if (shownWorkspace.current === workspace.state.workspace) return
    shownWorkspace.current = workspace.state.workspace
    props.onSaveDirectoryChange?.(null)
  }, [workspace.state.workspace, props.onSaveDirectoryChange])
  const dirty = tabs.tabs.some(tab => tab.dirty)
  useEffect(() => { props.onDirtyChange?.(dirty) }, [dirty, props.onDirtyChange])
  useImperativeHandle(ref, () => ({
    flushAll: tabs.flushAll,
    saveActiveDocument: tabs.saveActiveDocument,
    closeAll: tabs.closeAll,
    preserveAll: tabs.preserveAll,
    openFile: async path => workspace.actions.openFile({ path, name: path.split(/[\\/]/).pop() ?? path, kind: 'file' }),
    focusDocument: tabs.focusDocument,
    detachLesson: workspace.actions.detachLesson,
    showProject: workspace.actions.showProject,
  }), [tabs, workspace.actions, workspace.state.lesson])
  return <LessonWorkspaceView state={workspace.state} actions={workspace.actions} operation={props.lessonOperation} workspaceFiles={props.workspaceFiles} documentPort={props.documentPort} tabs={tabs} projectPath={props.projectPath} onSaveDirectoryChange={props.onSaveDirectoryChange}
    renderAssistant={props.renderAssistant} renderMaterial={props.renderMaterial} renderMaterials={props.renderMaterials}>{props.children}</LessonWorkspaceView>
})
