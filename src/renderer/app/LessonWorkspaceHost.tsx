import { forwardRef, useMemo, useRef, useImperativeHandle, useState, type ReactNode } from 'react'
import type { LessonWorkspace, LessonConversation } from '../../shared/lessonWorkspace'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../lessonWorkspace/LessonWorkspaceShell'
import { LessonConversationChat } from '../ui/chat/LessonConversationChat'
import { LessonMaterialBrowser } from '../lessonMaterials/LessonMaterialBrowser'
import { LessonAuthoringPanel } from '../lessonAuthoring/LessonAuthoringPanel'
import type { LessonAssemblyInput, LessonBuildTarget } from '../../shared/lessonAuthoringDesktop'
import type { LessonAuthoringMaterialSelection } from '../../shared/lessonAuthoring'
import type { LocalAgentId } from '../../shared/localAgentContract'
import { createDesktopDocumentPort } from './lessonDocumentPort'

export interface LessonWorkspaceHostProps {
  projectId: string
  projectPath: string | null
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  onActiveLesson(lesson: LessonWorkspace | null, conversation: LessonConversation | null): void
  onDirtyChange?(dirty: boolean): void
  observeEmptyProject(lesson: LessonWorkspace['identity'], conversationId: string): LessonBuildTarget
  continueProjectEditing(lesson: LessonWorkspace['identity'], conversationId: string, expectedProjectId: string): Promise<void>
  assemble(input: LessonAssemblyInput, conversationId: string): Promise<string>
  children: ReactNode
}
export const LessonWorkspaceHost = forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceHostProps>(function LessonWorkspaceHost(props, ref) {
  const shell = useRef<LessonWorkspaceShellHandle>(null)
  useImperativeHandle(ref, () => ({
    stopDocumentEdit: async () => { await shell.current?.stopDocumentEdit() },
    editDocument: async (...args) => { if (!shell.current) throw new Error('课例工作台尚未就绪'); await shell.current.editDocument(...args) },
    showProject: () => shell.current?.showProject(),
    detachLesson: () => shell.current?.detachLesson(),
    flushAll: () => shell.current?.flushAll() ?? Promise.resolve(true),
    closeAll: () => shell.current?.closeAll() ?? Promise.resolve(true),
    preserveAll: () => shell.current?.preserveAll() ?? Promise.resolve(true),
    applyBinding: (lesson, conversation) => shell.current?.applyBinding(lesson, conversation),
    openFile: path => shell.current?.openFile(path) ?? Promise.resolve(),
  }), [])
  const [selections, setSelections] = useState<Record<string, LessonAuthoringMaterialSelection[]>>({})
  const [adapter, setAdapter] = useState<LocalAgentId>('codex')
  const api = window.desktopAPI
  const port = useMemo(() => api?.lessonFiles ? createDesktopDocumentPort(api.lessonFiles) : null, [api?.lessonFiles])
  if (!api?.lesson || !port) return <>{props.children}</>
  const material = (sourcePath: string | undefined, lesson: LessonWorkspace | null) => {
    const service = api.lessonMaterials
    if (!lesson || !service) return <p>请先打开课例，再添加或读取材料。</p>
    const target = { lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory }
    const key = lesson.identity.normalizedDirectory + ':' + lesson.identity.lessonId
    return <LessonMaterialBrowser targetKey={JSON.stringify(target)} selections={selections[key] ?? []}
      onSelect={(record, fragmentIds) => setSelections(current => ({ ...current, [key]: [...(current[key] ?? []).filter(item => item.id !== record.id), ...(fragmentIds.length ? [{ id: record.id, extractionVersion: record.extractionVersion, fragmentIds }] : [])] }))}
      selectSource={() => service.selectSource(sourcePath ? { path: sourcePath } : undefined)}
      list={() => service.list(target)} importMaterial={input => service.importMaterial(target, input)} read={input => service.read(target, input)} />
  }
  return <LessonWorkspaceShell ref={shell} {...props} lessonOperation={api.lesson} documentPort={port} documentAiOperation={api.lessonDocumentAi}
    onActiveLesson={(lesson, conversation) => {
      props.onActiveLesson(lesson, conversation)
      if (lesson && conversation && api.lessonAuthoring) {
        const key = lesson.identity.normalizedDirectory + ':' + lesson.identity.lessonId
        void api.lessonAuthoring({ operation: 'read', lesson: lesson.identity, conversationId: conversation.conversationId }).then(result => {
          setSelections(current => current[key] !== undefined ? current : { ...current, [key]: result.view.state.materials.map(({ id, extractionVersion, fragmentIds }) => ({ id, extractionVersion, fragmentIds })) })
        }).catch(() => { /* The workflow panel presents authoritative read errors. */ })
      }
    }}
    renderChat={(lesson, conversation, documentTarget) => <LessonConversationChat documentTarget={documentTarget} lesson={lesson} conversation={conversation} projectId={props.projectId} projectPath={props.projectPath} />}
    renderMaterial={(filename, lesson) => material(filename, lesson)} renderMaterials={lesson => material(undefined, lesson)}
    renderWorkflow={(lesson, conversation) => api.lessonAuthoring && <>
      <details className="lesson-workflow-settings"><summary>文档创作助手 · {adapter === 'codex' ? 'Codex' : adapter === 'claude' ? 'Claude' : 'OpenCode'}</summary><label>创作流程 CLI <select aria-label="创作流程 CLI" value={adapter} onChange={event => setAdapter(event.target.value as LocalAgentId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option></select></label></details>
      <LessonAuthoringPanel observeEmptyProject={() => props.observeEmptyProject(lesson.identity, conversation.conversationId)} lesson={lesson.identity} conversationId={conversation.conversationId} adapter={adapter} operate={api.lessonAuthoring}
        continueProjectEditing={expectedProjectId => props.continueProjectEditing(lesson.identity, conversation.conversationId, expectedProjectId)}
        materialSelections={selections[lesson.identity.normalizedDirectory + ':' + lesson.identity.lessonId] ?? []}
        flushDocuments={() => shell.current?.flushAll() ?? Promise.resolve(true)}
        openDocument={relativePath => { void shell.current?.openFile(`${lesson.identity.normalizedDirectory}/${relativePath}`) }}
        cancelDocumentRepair={() => shell.current?.stopDocumentEdit() ?? Promise.resolve()}
        repairDocument={async (relativePath, instruction, ticket) => {
          if (!shell.current || !api.lessonAuthoring) throw new Error('课例文档修改入口尚未就绪')
          const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId, normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId }
          await shell.current.editDocument(`${lesson.identity.normalizedDirectory}/${relativePath}`, workspace, adapter, instruction, async (ref, expectedVersion) => {
            if (ref.lessonId !== ticket.lesson.lessonId || ref.relativePath !== relativePath) throw new Error('阶段修改返回了不同文档，当前阶段未继续')
            await api.lessonAuthoring!({ operation: 'complete-document-repair', lesson: ticket.lesson, conversationId: conversation.conversationId, ticket, expectedVersion })
          })
        }}
        assemble={input => props.assemble(input, conversation.conversationId)} onProjectReady={() => shell.current?.showProject()} />
    </>} />
})
