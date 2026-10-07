import { captureDocumentReference, workbenchSelection } from '../workbench/SelectionContextController'
import type { CourseDocumentsPort } from '../lessonWorkspace/controller/useDocumentTabsController'
import { forwardRef, useEffect, useMemo, useRef, useImperativeHandle, useState, type ReactNode } from 'react'
import type { LessonWorkspace } from '../../shared/lessonWorkspace'
import { LessonWorkspaceShell, type LessonWorkspaceShellHandle } from '../lessonWorkspace/LessonWorkspaceShell'
import { LessonMaterialBrowser } from '../lessonMaterials/LessonMaterialBrowser'
import type { LessonAuthoringMaterialSelection } from '../../shared/lessonAuthoring'
import { createDesktopDocumentPort } from './lessonDocumentPort'
import { ExecutionAssistant, type ExecutionAssistantHandle } from '../workbench/ExecutionAssistant'
import { WorkspaceRecoveryPanel } from '../workbench/WorkspaceRecoveryPanel'
import type { ExecutionDocumentReference } from '../../shared/workbench/executionDesktop'
import type { DocumentHostAPI, SaveDirectoryContext } from '../../shared/workbench/desktop'

export interface LessonWorkspaceHostProps {
  courseDocuments?: CourseDocumentsPort
  projectPath: string | null
  captureCourseDocument?(writable: boolean): Promise<ExecutionDocumentReference[]>
  prepareCourseDocuments?(documentIds?: readonly string[]): Promise<void>
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  onNewProjectFromPptx?(file: { name: string; bytes: Uint8Array }): Promise<boolean>
  onDirtyChange?(dirty: boolean): void
  onActiveDocumentChange?(active: { kind: 'document' | 'material' | 'course'; name: string } | null): void
  documents?: DocumentHostAPI
  onSaveDirectoryChange?(directory: SaveDirectoryContext | null): void
  onImportHtml?(directory: SaveDirectoryContext, sourceEntryId?: string): void
  children: ReactNode
}
export const LessonWorkspaceHost = forwardRef<LessonWorkspaceShellHandle, LessonWorkspaceHostProps>(function LessonWorkspaceHost(props, ref) {
  const shell = useRef<LessonWorkspaceShellHandle>(null)
  const assistant = useRef<ExecutionAssistantHandle>(null)
  useImperativeHandle(ref, () => ({
    showProject: () => shell.current?.showProject(),
    detachLesson: () => shell.current?.detachLesson(),
    flushAll: () => shell.current?.flushAll() ?? Promise.resolve(true),
    saveActiveDocument: () => shell.current?.saveActiveDocument() ?? Promise.resolve('none'),
    closeAll: () => shell.current?.closeAll() ?? Promise.resolve(true),
    preserveAll: async () => { await assistant.current?.preserveDraft(); return shell.current?.preserveAll() ?? true },
    openFile: path => shell.current?.openFile(path) ?? Promise.resolve(),
    focusDocument: id => shell.current?.focusDocument(id) ?? Promise.resolve(),
  }), [])
  const [selections, setSelections] = useState<Record<string, LessonAuthoringMaterialSelection[]>>({})
  const selectionsRef = useRef(selections); selectionsRef.current = selections
  const activeLessonKey = useRef<string | null>(null)
  const api = window.desktopAPI
  useEffect(() => api?.onRequestFocusDocument?.(id => {
    void shell.current?.focusDocument(id).catch(error => { void api.reportDiagnostic({ source: 'renderer', message: error instanceof Error ? error.message : '无法定位保留的文档' }) })
  }), [api])
  const documents = props.documents ?? api?.documents
  const port = useMemo(() => api?.lessonFiles && documents ? createDesktopDocumentPort(api.lessonFiles, documents) : null, [api?.lessonFiles, documents])
  useEffect(() => workbenchSelection.setFallback(async id => {
    await props.prepareCourseDocuments?.([id])
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
    renderAssistant={(root, documentTarget, isCourse, drainDocuments, lesson) => {
      const lessonKey = lesson ? lesson.identity.normalizedDirectory + ':' + lesson.identity.lessonId : null
      activeLessonKey.current = lessonKey
      return api.execution ? <ExecutionAssistant ref={assistant} root={root}
      captureMaterials={async () => {
        if (!lesson || !lessonKey || !api.lessonMaterials) return undefined
        const chosen = structuredClone(selectionsRef.current[lessonKey] ?? [])
        if (!chosen.length) return undefined
        const target = { lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory }
        const records = await api.lessonMaterials.list(target)
        if (activeLessonKey.current !== lessonKey) throw new Error('课例已切换，请在当前课例重新发送。')
        for (const choice of chosen) {
          const record = records.find(item => item.id === choice.id)
          if (!record || record.extractionVersion !== choice.extractionVersion
            || choice.fragmentIds.some(id => !record.fragments.some(fragment => fragment.id === id)))
            throw new Error('所选材料已更新或不可读取，请重新选择材料片段后发送。')
        }
        return { target, selections: chosen }
      }}
      onLocateDocument={id => shell.current?.focusDocument(id) ?? Promise.resolve()}
      prepareSend={async (ids = []) => { if (!await drainDocuments(ids)) return false; await props.prepareCourseDocuments?.(ids); return true }}
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
      }} /> : <p role="alert">创作助手服务不可用，请重新打开应用。</p>
    }}
    renderMaterial={(filename, lesson) => material(filename, lesson)} renderMaterials={lesson => material(undefined, lesson)} />
    <WorkspaceRecoveryPanel api={api.documents!} onRestored={id => shell.current?.focusDocument(id) ?? Promise.reject(new Error('文档视图尚未就绪'))} />
  </>
})
