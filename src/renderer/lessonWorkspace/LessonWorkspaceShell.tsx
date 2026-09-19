import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { ReactNode } from 'react'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../shared/lessonDesktopContract'
import type { LessonConversation, LessonWorkspace } from '../../shared/lessonWorkspace'
import type { ConversationAgentWorkspace, LessonAgentWorkspace } from '../../shared/workspaceIdentity'
import type { LocalAgentId } from '../../shared/localAgentContract'
import type { LessonDocumentAiAPI } from '../../shared/lessonDocumentAiTask'
import type { DocumentFileRef, DocumentFileVersion } from '../../shared/document/ports'
import type { RecoverableDocumentFilePort } from '../documentFiles/documentFileSession'
import type { DocumentChatTarget } from '../documentFiles/documentAiTaskController'
import { useDocumentTabsController } from './controller/useDocumentTabsController'
import { useLessonWorkspaceController } from './controller/useLessonWorkspaceController'
import { LessonWorkspaceView } from './view/LessonWorkspaceView'
import './lessonWorkspaceShell.css'

export interface LessonWorkspaceShellProps {
  lessonOperation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  documentPort: RecoverableDocumentFilePort
  /** App composition resolves the preload capability; the workspace never reads window globals. */
  documentAiOperation?: LessonDocumentAiAPI
  projectId: string
  projectPath: string | null
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  renderChat(lesson: LessonWorkspace, conversation: LessonConversation, documentTarget?: DocumentChatTarget): ReactNode
  renderDirectoryChat?(root: string, conversation: LessonConversation, documentTarget?: DocumentChatTarget): ReactNode
  renderMaterial?(path: string, lesson: LessonWorkspace | null): ReactNode
  renderMaterials?(lesson: LessonWorkspace): ReactNode
  renderWorkflow?(lesson: LessonWorkspace, conversation: LessonConversation): ReactNode
  onActiveLesson?(lesson: LessonWorkspace | null, conversation: LessonConversation | null): void
  onActiveDirectoryConversation?(conversation: LessonConversation | null): void
  onDirtyChange?(dirty: boolean): void
  children: ReactNode
}

export interface LessonWorkspaceShellHandle {
  stopDocumentEdit(): Promise<void>
  editDocument(filename: string, scope: ConversationAgentWorkspace, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>): Promise<void>
  flushAll(): Promise<boolean>
  closeAll(): Promise<boolean>
  preserveAll(): Promise<boolean>
  applyBinding(lesson: LessonWorkspace, conversation: LessonConversation): void
  applyDirectoryBinding(conversation: LessonConversation): void
  openFile(path: string): Promise<void>
  detachLesson(): void
  showProject(): void
}

/** Composition and lifecycle bridge for the lesson workspace. Rendering and local writers live in dedicated modules. */
export const LessonWorkspaceShell = forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceShellProps>(function LessonWorkspaceShell(props, ref) {
  const scopeRef = useRef('')
  const tabs = useDocumentTabsController({ documentPort: props.documentPort, documentAiOperation: props.documentAiOperation, scopeRef })
  const workspace = useLessonWorkspaceController({ lessonOperation: props.lessonOperation, projectPath: props.projectPath, onOpenProject: props.onOpenProject, onNewProject: props.onNewProject, onActiveLesson: props.onActiveLesson, onActiveDirectoryConversation: props.onActiveDirectoryConversation, tabs, scopeRef })
  const dirty = tabs.tabs.some(tab => tab.dirty)
  useEffect(() => { props.onDirtyChange?.(dirty) }, [dirty, props.onDirtyChange])
  useImperativeHandle(ref, () => ({
    stopDocumentEdit: tabs.stopDocumentEdit,
    editDocument: async (filename, scope, adapter, instruction, onApplied) => {
      const current = workspace.state.lesson
      const normalized = filename.replace(/\\/g, '/').toLowerCase()
      const existing = tabs.tabs.find(tab => tab.path.replace(/\\/g, '/').toLowerCase() === normalized)
      const target = existing?.path ?? filename
      if (current && !existing) tabs.openTab({ path: filename, name: filename.split(/[\\/]/).pop() ?? filename, kind: 'document', lesson: current })
      await tabs.editDocument(target, scope, adapter, instruction, onApplied)
    },
    flushAll: tabs.flushAll,
    closeAll: tabs.closeAll,
    preserveAll: tabs.preserveAll,
    applyBinding: workspace.actions.applyBinding,
    applyDirectoryBinding: workspace.actions.applyDirectoryBinding,
    openFile: async path => workspace.actions.openFile({ path, name: path.split(/[\\/]/).pop() ?? path, kind: 'file' }),
    detachLesson: workspace.actions.detachLesson,
    showProject: workspace.actions.showProject,
  }), [tabs, workspace.actions, workspace.state.lesson])
  return <LessonWorkspaceView state={workspace.state} actions={workspace.actions} operation={props.lessonOperation} documentPort={props.documentPort} tabs={tabs} projectPath={props.projectPath}
    renderChat={props.renderChat} renderDirectoryChat={props.renderDirectoryChat} renderMaterial={props.renderMaterial} renderMaterials={props.renderMaterials} renderWorkflow={props.renderWorkflow}>{props.children}</LessonWorkspaceView>
})
