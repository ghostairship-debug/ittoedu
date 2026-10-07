import type { WorkspaceFilesAPI } from '../../shared/workbench/workspaceFiles'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../shared/lessonDesktopContract'
import type { LessonWorkspace } from '../../shared/lessonWorkspace'
import type { RecoverableDocumentFilePort } from '../documentFiles/documentFileSession'
import type { SaveDirectoryContext } from '../../shared/workbench/desktop'
import { useDocumentTabsController, type CourseDocumentsPort, type ActiveDocumentTarget, type LessonFileTab } from './controller/useDocumentTabsController'
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
  /** A new H5 presentation made from a PPT (M21). */
  onNewProjectFromPptx?(file: { name: string; bytes: Uint8Array }): Promise<boolean>
  renderAssistant?(root: string | null, documentTarget: ActiveDocumentTarget | undefined, isCourse: boolean, drainDocuments: (documentIds?: readonly string[]) => Promise<boolean>, lesson: LessonWorkspace | null): ReactNode
  renderMaterial?(path: string, lesson: LessonWorkspace | null): ReactNode
  renderMaterials?(lesson: LessonWorkspace): ReactNode
  onDirtyChange?(dirty: boolean): void
  /** The file shown in the content area, which names the window. */
  onActiveDocumentChange?(active: { kind: LessonFileTab['kind']; name: string } | null): void
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void
  onImportHtml?(directory: SaveDirectoryContext, sourceEntryId?: string): void
  prepareCurrentCopy?(): Promise<boolean>
  children: ReactNode
}

export interface LessonWorkspaceShellHandle {
  flushAll(): Promise<boolean>
  saveActiveDocument(): Promise<'course' | 'document' | 'none'>
  closeAll(): Promise<boolean>
  preserveAll(mode?: 'save' | 'preserve'): Promise<boolean>
  suspendForClose(documentIds?: readonly string[]): void
  resumeAfterCloseCancelled(documentIds?: readonly string[]): void
  openFile(path: string): Promise<void>
  focusDocument(documentId: string): Promise<void>
  detachLesson(): void
  showProject(): void
}

/** Composition and lifecycle bridge for the lesson workspace. Rendering and local writers live in dedicated modules. */
export const LessonWorkspaceShell = forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceShellProps>(function LessonWorkspaceShell(props, ref) {
  const tabs = useDocumentTabsController({ documentPort: props.documentPort, courseDocuments: props.courseDocuments })
  const workspace = useLessonWorkspaceController({ lessonOperation: props.lessonOperation, projectPath: props.projectPath, onOpenProject: props.onOpenProject, onNewProject: props.onNewProject, onNewProjectFromPptx: props.onNewProjectFromPptx, tabs })
  const shownWorkspace = useRef(workspace.state.workspace)
  useLayoutEffect(() => {
    if (shownWorkspace.current === workspace.state.workspace) return
    shownWorkspace.current = workspace.state.workspace
    props.onSaveDirectoryChange?.(null)
  }, [workspace.state.workspace, props.onSaveDirectoryChange])
  const dirty = tabs.tabs.some(tab => tab.dirty)
  useEffect(() => { props.onDirtyChange?.(dirty) }, [dirty, props.onDirtyChange])
  const activeTab = tabs.tabs.find(tab => tab.id === tabs.activeTab)
  const activeKind = activeTab?.kind, activeName = activeTab?.name
  useEffect(() => { props.onActiveDocumentChange?.(activeKind && activeName ? { kind: activeKind, name: activeName } : null) }, [activeKind, activeName, props.onActiveDocumentChange])
  useImperativeHandle(ref, () => ({
    flushAll: tabs.flushAll,
    saveActiveDocument: tabs.saveActiveDocument,
    closeAll: tabs.closeAll,
    preserveAll: tabs.preserveAll,
    suspendForClose: tabs.suspendForClose,
    resumeAfterCloseCancelled: tabs.resumeAfterCloseCancelled,
    openFile: async path => workspace.actions.openFile({ path, name: path.split(/[\\/]/).pop() ?? path, kind: 'file' }),
    focusDocument: tabs.focusDocument,
    detachLesson: workspace.actions.detachLesson,
    showProject: workspace.actions.showProject,
  }), [tabs, workspace.actions, workspace.state.lesson])
  return <LessonWorkspaceView state={workspace.state} actions={workspace.actions} operation={props.lessonOperation} workspaceFiles={props.workspaceFiles} documentPort={props.documentPort} tabs={tabs} projectPath={props.projectPath} onSaveDirectoryChange={props.onSaveDirectoryChange} onImportHtml={props.onImportHtml}
    prepareCurrentCopy={async () => { if (!await tabs.drainAll()) return false; return props.prepareCurrentCopy?.() ?? true }}
    renderAssistant={props.renderAssistant} renderMaterial={props.renderMaterial} renderMaterials={props.renderMaterials}>{props.children}</LessonWorkspaceView>
})
