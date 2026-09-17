import { useRef, useState } from 'react'
import type { LocalAgentId } from '../../../shared/localAgentContract'
import type { LessonAgentWorkspace } from '../../../shared/workspaceIdentity'
import type { LessonDocumentAiAPI } from '../../../shared/lessonDocumentAiTask'
import type { DocumentFileRef, DocumentFileVersion } from '../../../shared/document/ports'
import { DocumentAiTaskController, type DocumentChatTarget } from '../../documentFiles/documentAiTaskController'
import type { LessonDocumentEditorHandle } from '../../documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../documentFiles/documentFileSession'
import type { LessonWorkspace } from '../../../shared/lessonWorkspace'

export type LessonFileTab = {
  path: string
  name: string
  kind: 'document' | 'material'
  dirty: boolean
  lesson: LessonWorkspace | null
}

export interface DocumentTabsController {
  tabs: LessonFileTab[]
  activeTab: string
  setActiveTab(tab: string): void
  openTab(tab: Omit<LessonFileTab, 'dirty'>): void
  closeTab(tab: LessonFileTab): Promise<boolean>
  removeTab(path: string): void
  registerEditor(path: string, editor: LessonDocumentEditorHandle | null): void
  updateDirty(path: string, dirty: boolean): void
  flushAll(): Promise<boolean>
  preserveAll(): Promise<boolean>
  closeAll(): Promise<boolean>
  disposeDocuments(): Promise<void>
  stopDocumentEdit(): Promise<void>
  stopAllAiEdits(): Promise<void>
  activeDocumentTarget(): DocumentChatTarget | undefined
  editDocument(filename: string, scope: LessonAgentWorkspace, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>): Promise<void>
}

/** Owns only transient document-tab state and document-session lifecycles. */
export function useDocumentTabsController({ documentPort, documentAiOperation, scopeRef }: {
  documentPort: RecoverableDocumentFilePort
  documentAiOperation?: LessonDocumentAiAPI
  scopeRef: { current: string }
}): DocumentTabsController {
  const [tabs, setTabs] = useState<LessonFileTab[]>([])
  const [activeTab, setActiveTab] = useState('course')
  const documents = useRef(new Map<string, LessonDocumentEditorHandle>())
  const waitingEditors = useRef(new Map<string, (editor: LessonDocumentEditorHandle) => void>())
  const documentRepair = useRef<DocumentAiTaskController | null>(null)
  const documentRepairEpoch = useRef(0)

  async function stopDocumentEdit() {
    ++documentRepairEpoch.current
    const controller = documentRepair.current
    documentRepair.current = null
    await controller?.stop()
  }
  async function stopAllAiEdits() {
    await stopDocumentEdit()
    for (const editor of documents.current.values()) await editor.session.stopAiEdits()
  }
  async function flushAll() {
    for (const [filename, editor] of documents.current) {
      if (!(await editor.flush())) { setActiveTab(filename); return false }
    }
    return true
  }
  async function disposeDocuments() {
    for (const editor of documents.current.values()) editor.session.dispose(false)
    documents.current.clear()
    waitingEditors.current.clear()
    setTabs([])
    setActiveTab('course')
  }
  async function closeAll() {
    await stopAllAiEdits()
    if (!(await flushAll())) return false
    await disposeDocuments()
    return true
  }
  async function preserveAll() {
    await stopAllAiEdits()
    for (const [filename, editor] of documents.current) {
      if (!(await editor.session.preserveDraft())) { setActiveTab(filename); return false }
    }
    await disposeDocuments()
    return true
  }
  function openTab(tab: Omit<LessonFileTab, 'dirty'>) {
    setTabs(current => current.some(item => item.path === tab.path) ? current : [...current, { ...tab, dirty: false }])
    setActiveTab(tab.path)
  }
  async function closeTab(tab: LessonFileTab) {
    const editor = documents.current.get(tab.path)
    if (editor && !(await editor.close())) { setActiveTab(tab.path); return false }
    removeTab(tab.path)
    return true
  }
  function removeTab(path: string) {
    documents.current.delete(path)
    setTabs(current => current.filter(item => item.path !== path))
    if (activeTab === path) setActiveTab('course')
  }
  function registerEditor(path: string, editor: LessonDocumentEditorHandle | null) {
    if (!editor) { documents.current.delete(path); return }
    documents.current.set(path, editor)
    waitingEditors.current.get(path)?.(editor)
  }
  function updateDirty(path: string, dirty: boolean) {
    setTabs(current => current.some(tab => tab.path === path && tab.dirty !== dirty)
      ? current.map(tab => tab.path === path ? { ...tab, dirty } : tab) : current)
  }
  function activeDocumentTarget() {
    const tab = tabs.find(item => item.path === activeTab && item.kind === 'document' && item.lesson)
    return tab ? { name: tab.name, getEditor: () => documents.current.get(tab.path) ?? null } : undefined
  }
  async function editDocument(filename: string, scope: LessonAgentWorkspace, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>) {
    const repairEpoch = ++documentRepairEpoch.current
    await documentRepair.current?.stop()
    documentRepair.current = null
    if (!documentAiOperation) throw new Error('文档修改入口未连接')
    const editor = documents.current.get(filename) ?? await new Promise<LessonDocumentEditorHandle>((resolve, reject) => {
      const timer = setTimeout(() => { waitingEditors.current.delete(filename); reject(new Error('教学文档尚未打开，请重试')) }, 10000)
      waitingEditors.current.set(filename, value => { clearTimeout(timer); waitingEditors.current.delete(filename); resolve(value) })
    })
    if (!editor.session.getSnapshot().disk) await new Promise<void>((resolve, reject) => {
      const unsubscribe = editor.session.subscribe(() => {
        if (editor.session.getSnapshot().disk) { clearTimeout(timer); unsubscribe(); resolve() }
      })
      const timer = setTimeout(() => { unsubscribe(); reject(new Error('当前文件尚未读取完成')) }, 10000)
    })
    const expectedScope = JSON.stringify([scope.lessonId, normalized(scope.normalizedDirectory), scope.conversationId])
    if (repairEpoch !== documentRepairEpoch.current) throw new Error('文档修复已停止')
    if (scopeRef.current !== expectedScope) throw new Error('课例对话已切换，请在当前课例重新发起修改')
    const controller = new DocumentAiTaskController(documentAiOperation, scope, message => editor.session.setAiMessage(message))
    documentRepair.current = controller
    await controller.start({ name: filename, getEditor: () => editor }, adapter, instruction, async (ref, version) => {
      if (repairEpoch !== documentRepairEpoch.current || scopeRef.current !== expectedScope) throw new Error('课例对话已切换或修复已停止，原阶段任务未继续')
      await onApplied?.(ref, version)
    })
  }
  return { tabs, activeTab, setActiveTab, openTab, closeTab, removeTab, registerEditor, updateDirty, flushAll, preserveAll, closeAll, disposeDocuments, stopDocumentEdit, stopAllAiEdits, activeDocumentTarget, editDocument }
}

function normalized(value: string) { return value.replace(/\\/g, '/').toLowerCase() }
