import { useRef, useState } from 'react'
import type { LocalAgentId } from '../../../shared/localAgentContract'
import type { ConversationAgentWorkspace } from '../../../shared/workspaceIdentity'
import type { LessonDocumentAiAPI } from '../../../shared/lessonDocumentAiTask'
import type { DocumentFileRef, DocumentFileVersion, ContextualEditTarget } from '../../../shared/document/ports'
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
  editorRef(path: string): (editor: LessonDocumentEditorHandle | null) => void
  updateDirty(path: string, dirty: boolean): void
  flushAll(): Promise<boolean>
  preserveAll(): Promise<boolean>
  closeAll(): Promise<boolean>
  disposeDocuments(): Promise<void>
  stopDocumentEdit(): Promise<void>
  stopAllAiEdits(): Promise<void>
  activeDocumentTarget(): DocumentChatTarget | undefined
  selectionChanged(path: string): void
  sendContextualCommand(path: string, instruction: string, target: ContextualEditTarget): void
  editDocument(filename: string, scope: ConversationAgentWorkspace, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>): Promise<void>
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
  const editorRefs = useRef(new Map<string, (editor: LessonDocumentEditorHandle | null) => void>())
  const waitingEditors = useRef(new Map<string, (editor: LessonDocumentEditorHandle) => void>())
  const documentRepair = useRef<DocumentAiTaskController | null>(null)
  const documentRepairEpoch = useRef(0)
  const [, updateSelection] = useState(0)
  const commandListeners = useRef(new Map<string, (instruction: string, target: ContextualEditTarget) => void>())
  function selectionChanged(path: string) { if (path === activeTab) updateSelection(value => value + 1) }
  function sendContextualCommand(path: string, instruction: string, target: ContextualEditTarget) {
    const listener = commandListeners.current.get(path)
    if (!listener) throw new Error('请先打开当前目录的创作助手，再发送编辑要求。')
    listener(instruction, target)
  }

  async function stopDocumentEdit() {
    ++documentRepairEpoch.current
    const controller = documentRepair.current
    documentRepair.current = null
    await controller?.stop()
  }
  async function stopAllAiEdits() {
    await stopDocumentEdit()
    // 遍历活 Map 会在 await 期间被 ref 回调删/增同一键而反复回访同一条目：标签里的编辑器 ref 是内联函数，
    // 每次重渲染 React 都先 detach（delete）再 attach（set），而 session.stopAiEdits 自身的 observe/update
    // 就会触发重渲染。V02 冲突用例里该循环因此永不收敛，stopAndFlush 根本走不到 flushAll 的守卫。
    for (const editor of [...documents.current.values()]) await editor.session.stopAiEdits()
  }
  async function flushAll() {
    // 与 stopAllAiEdits 同理：保存期间的重渲染会删/增注册表键，按 await 前的快照遍历，一次调用只判一次。
    for (const [filename, editor] of [...documents.current]) {
      if (!(await editor.flush())) { setActiveTab(filename); return false }
    }
    // 标签仍标记未保存、注册表里却没有活编辑器时 flush 无从执行：必须按未保存拒绝切换，
    // 否则该标签会被静默移除、当前稿丢失（V02 冲突用例 :62 的红点即此分支缺失）。
    const unregistered = tabs.find(tab => tab.dirty && !documents.current.has(tab.path))
    if (unregistered) { setActiveTab(unregistered.path); return false }
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
    // 同 flushAll/stopAllAiEdits：preserveDraft 期间的重渲染会删/增注册表键，必须按 await 前的快照遍历。
    for (const [filename, editor] of [...documents.current]) {
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
  /**
   * 每个 path 一个身份稳定的 ref 回调。内联 `ref={editor => registerEditor(tab.path, editor)}` 每次
   * 重渲染都是新函数，React 会先用 null 调旧回调（delete）再用实例调新回调（set）——同键被删后重新插入，
   * 在 Map 的键序里移到末尾，正在 await 中遍历它的循环就会反复回访同一条目（V02 冲突用例的不收敛根因）。
   * flushAll/stopAllAiEdits/preserveAll 的快照遍历是止血，这里消除抖动本身。
   */
  function editorRef(path: string) {
    let callback = editorRefs.current.get(path)
    if (!callback) {
      callback = (editor: LessonDocumentEditorHandle | null) => registerEditor(path, editor)
      editorRefs.current.set(path, callback)
    }
    return callback
  }
  function updateDirty(path: string, dirty: boolean) {
    setTabs(current => current.some(tab => tab.path === path && tab.dirty !== dirty)
      ? current.map(tab => tab.path === path ? { ...tab, dirty } : tab) : current)
  }
  function activeDocumentTarget(): DocumentChatTarget | undefined {
    const tab = tabs.find(item => item.path === activeTab && item.kind === 'document')
    return tab ? {
      name: tab.name,
      getEditor: () => documents.current.get(tab.path) ?? null,
      getContextualEditTarget: () => documents.current.get(tab.path)?.getContextualEditTarget() ?? null,
      subscribeCommands: listener => { commandListeners.current.set(tab.path, listener); return () => { if (commandListeners.current.get(tab.path) === listener) commandListeners.current.delete(tab.path) } },
    } : undefined
  }
  async function editDocument(filename: string, scope: ConversationAgentWorkspace, adapter: LocalAgentId, instruction: string, onApplied?: (ref: DocumentFileRef, version: DocumentFileVersion) => Promise<void>) {
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
    const expectedScope = JSON.stringify([scope.kind, scope.kind === 'lesson' ? scope.lessonId : '', normalized(scope.normalizedDirectory), scope.conversationId])
    if (repairEpoch !== documentRepairEpoch.current) throw new Error('文档修复已停止')
    if (scopeRef.current !== expectedScope) throw new Error('课例对话已切换，请在当前课例重新发起修改')
    const controller = new DocumentAiTaskController(documentAiOperation, scope, message => editor.session.setAiMessage(message))
    documentRepair.current = controller
    await controller.start({ name: filename, scope: 'document', getEditor: () => editor }, adapter, instruction, async (ref, version) => {
      if (repairEpoch !== documentRepairEpoch.current || scopeRef.current !== expectedScope) throw new Error('课例对话已切换或修复已停止，原阶段任务未继续')
      await onApplied?.(ref, version)
    })
  }
  return { tabs, activeTab, setActiveTab, openTab, closeTab, removeTab, registerEditor, editorRef, updateDirty, flushAll, preserveAll, closeAll, disposeDocuments, stopDocumentEdit, stopAllAiEdits, activeDocumentTarget, editDocument, selectionChanged, sendContextualCommand }
}

function normalized(value: string) { return value.replace(/\\/g, '/').toLowerCase() }
