import { captureDocumentReference, workbenchSelection } from '../workbench/SelectionContextController'
import type { CourseDocumentsPort } from '../lessonWorkspace/controller/useDocumentTabsController'
import { forwardRef, useEffect, useMemo, useRef, useImperativeHandle, useState, type ReactNode } from 'react'
import type { LessonWorkspace } from '../../shared/lessonWorkspace'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../lessonWorkspace/LessonWorkspaceShell'
import { LessonMaterialBrowser } from '../lessonMaterials/LessonMaterialBrowser'
import type { LessonAuthoringMaterialSelection } from '../../shared/lessonAuthoring'
import { createDesktopDocumentPort } from './lessonDocumentPort'
import { ExecutionAssistant } from '../workbench/ExecutionAssistant'
import { WorkspaceRecoveryPanel } from '../workbench/WorkspaceRecoveryPanel'
import type { ExecutionDocumentReference } from '../../shared/workbench/executionDesktop'
import type { DocumentHostAPI, SaveDirectoryContext } from '../../shared/workbench/desktop'

export interface LessonWorkspaceHostProps {
  courseDocuments?: CourseDocumentsPort
  projectPath: string | null
  captureCourseDocument?(writable: boolean): Promise<ExecutionDocumentReference[]>
  prepareCourseDocuments?(): Promise<void>
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  onDirtyChange?(dirty: boolean): void
  documents?: DocumentHostAPI
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void
  children: ReactNode
}
export const LessonWorkspaceHost = forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceHostProps>(function LessonWorkspaceHost(props, ref) {
  const shell = useRef<LessonWorkspaceShellHandle>(null)
  useImperativeHandle(ref, () => ({
    showProject: () => shell.current?.showProject(),
    detachLesson: () => shell.current?.detachLesson(),
    flushAll: () => shell.current?.flushAll() ?? Promise.resolve(true),
    saveActiveDocument: () => shell.current?.saveActiveDocument() ?? Promise.resolve('none'),
    closeAll: () => shell.current?.closeAll() ?? Promise.resolve(true),
    preserveAll: () => shell.current?.preserveAll() ?? Promise.resolve(true),
    openFile: path => shell.current?.openFile(path) ?? Promise.resolve(),
    focusDocument: id => shell.current?.focusDocument(id) ?? Promise.resolve(),
  }), [])
  const [selections, setSelections] = useState<Record<string, LessonAuthoringMaterialSelection[]>>({})
  const api = window.desktopAPI
  useEffect(() => api?.onRequestFocusDocument?.(id => {
    void shell.current?.focusDocument(id).catch(error => { void api.reportDiagnostic({ source: 'renderer', message: error instanceof Error ? error.message : '无法定位保留的文档' }) })
  }), [api])
  const documents = props.documents ?? api?.documents
  const port = useMemo(() => api?.lessonFiles && documents ? createDesktopDocumentPort(api.lessonFiles, documents) : null, [api?.lessonFiles, documents])
  useEffect(() => workbenchSelection.setFallback(async id => {
    await props.prepareCourseDocuments?.()
    if (!api?.documents) throw new Error('文档服务尚未就绪')
    return api.documents.read(id)
  }), [api?.documents, props.prepareCourseDocuments])
  if (!api?.lesson || !api.workspaceFiles || !port) return <><p role="alert">工作台服务不可用，请重新打开应用。</p>{props.children}</>
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
  return <><LessonWorkspaceShell ref={shell} {...props} lessonOperation={api.lesson} workspaceFiles={api.workspaceFiles} documentPort={port}
    renderAssistant={(root, documentTarget, isCourse, drainDocuments) => api.execution ? <ExecutionAssistant root={root}
      onLocateDocument={id => shell.current?.focusDocument(id) ?? Promise.resolve()}
      prepareSend={async () => { if (!await drainDocuments()) return false; await props.prepareCourseDocuments?.(); return true }}
      captureDocuments={async writable => {
        const editor = documentTarget?.getEditor()
        if (editor) {
          if (!await editor.session.drain()) throw new Error('当前输入尚未提交，请先完成输入或处理冲突')
          const documentId = editor.session.documentId
          if (!documentId) throw new Error('文档会话尚未就绪')
          const snapshot = await api.documents!.read(documentId)
          return [captureDocumentReference(snapshot, writable)]
        }
        return isCourse ? props.captureCourseDocument?.(writable) ?? [] : []
      }} /> : <p role="alert">创作助手服务不可用，请重新打开应用。</p>}
    renderMaterial={(filename, lesson) => material(filename, lesson)} renderMaterials={lesson => material(undefined, lesson)} />
    <WorkspaceRecoveryPanel api={api.documents!} onRestored={id => shell.current?.focusDocument(id) ?? Promise.reject(new Error('文档视图尚未就绪'))} />
  </>
})
