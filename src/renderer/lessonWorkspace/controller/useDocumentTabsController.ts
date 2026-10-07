import { captureMarkdownSelection, workbenchSelection } from '../../workbench/SelectionContextController'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { useEffect, useRef, useState } from 'react'
import type { ContextualEditTarget } from '../../../shared/document/ports'
import type { LessonDocumentEditorHandle } from '../../documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../documentFiles/documentFileSession'
import type { LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { MediaFileEditorHandle } from '../../documentFiles/media/MediaFileEditor'
import type { MediaFileSnapshot, MediaFilesRequest } from '../../../shared/workbench/mediaFiles'

export type LessonFileTab = {
  id: string
  documentId?: string
  path: string
  name: string
  kind: 'document' | 'material' | 'course' | 'media'
  mediaSnapshot?: MediaFileSnapshot
  dirty: boolean
  lesson: LessonWorkspace | null
}

export interface CourseDocumentsPort {
  activation?: number
  documents: readonly DocumentSnapshot[]
  activeDocumentId: string | null
  activate(documentId: string): Promise<void>
  close(documentId: string): Promise<boolean>
}
export interface ActiveDocumentTarget {
  name: string
  getEditor(): LessonDocumentEditorHandle | null
  getContextualEditTarget(): ContextualEditTarget | null
}
export interface DocumentTabsController {
  isCourseActive: boolean
  createMarkdown(name?: string): Promise<void>
  tabs: LessonFileTab[]
  activeTab: string
  setActiveTab(tab: string): void
  focusDocument(documentId: string): Promise<void>
  openTab(tab: Omit<LessonFileTab, 'dirty' | 'id' | 'documentId'>): Promise<void>
  closeTab(tab: LessonFileTab): Promise<boolean>
  removeTab(path: string): void
  registerEditor(path: string, editor: LessonDocumentEditorHandle | null): void
  editorRef(path: string): (editor: LessonDocumentEditorHandle | null) => void
  mediaEditorRef(id: string): (editor: MediaFileEditorHandle | null) => void
  mediaFiles(request: MediaFilesRequest): Promise<MediaFileSnapshot>
  updateMediaSnapshot(id: string, snapshot: MediaFileSnapshot): void
  updateDirty(path: string, dirty: boolean): void
  flushAll(): Promise<boolean>
  saveActiveDocument(): Promise<'course' | 'document' | 'none'>
  drainAll(): Promise<boolean>
  preserveAll(mode?: 'save' | 'preserve'): Promise<boolean>
  suspendForClose(documentIds?: readonly string[]): void
  resumeAfterCloseCancelled(documentIds?: readonly string[]): void
  closeAll(): Promise<boolean>
  disposeDocuments(): Promise<void>
  activeDocumentTarget(): ActiveDocumentTarget | undefined
  selectionChanged(path: string): void
  sendContextualCommand(path: string, instruction: string, target: ContextualEditTarget): void
}

/** Owns only transient document-tab state and document-session lifecycles. */
export function useDocumentTabsController({ documentPort, courseDocuments, mediaFiles }: {
  courseDocuments?: CourseDocumentsPort
  documentPort: RecoverableDocumentFilePort
  mediaFiles?(request: MediaFilesRequest): Promise<MediaFileSnapshot>
}): DocumentTabsController {
  const [tabs, setTabs] = useState<LessonFileTab[]>([])
  const [activeTab, setActive] = useState('')
  const navigation = useRef(0)
  const courseRef = useRef(courseDocuments); courseRef.current = courseDocuments
  const previousCourse = useRef<string | null>(null)
  const previousActivation = useRef<number | undefined>(undefined)
  const pendingCourse = useRef<{ id: string; ticket: number } | null>(null)
  function setActiveTab(id: string) {
    const course = courseRef.current
    if (id === 'course') {
      const active = course?.activeDocumentId
      if (!active || !course?.documents.some(item => item.documentId === active)) return
      id = active
    }
    const ticket = ++navigation.current
    const tab = tabsRef.current.find(value => value.id === id)
    if (tab?.kind === 'course' && course) {
      pendingCourse.current = { id, ticket }
      void course.activate(id).then(() => { if (ticket === navigation.current) setActive(id) }).catch(() => { /* The course lifecycle retains the draft and reports its error. */ })
    } else setActive(id)
  }
  useEffect(() => {
    const snapshots = courseDocuments?.documents ?? []
    setTabs(current => [...current.filter(tab => tab.kind !== 'course'), ...snapshots.map(snapshot => ({
      id: snapshot.documentId, documentId: snapshot.documentId, kind: 'course' as const,
      path: snapshot.binding.kind === 'file' ? snapshot.binding.path : '',
      name: snapshot.binding.kind === 'file' ? snapshot.binding.path.split(/[\\/]/).pop()! : snapshot.binding.suggestedName,
      dirty: snapshot.dirty, lesson: null,
    }))])
    const active = courseDocuments?.activeDocumentId ?? null
    if ((active !== previousCourse.current || courseDocuments?.activation !== previousActivation.current) && snapshots.some(item => item.documentId === active)) {
      const pending = pendingCourse.current
      if (!pending || pending.id !== active || pending.ticket === navigation.current) setActive(active!)
      if (pending?.id === active) pendingCourse.current = null
    }
    previousCourse.current = active
    previousActivation.current = courseDocuments?.activation
  }, [courseDocuments?.documents, courseDocuments?.activeDocumentId, courseDocuments?.activation])
  const tabsRef = useRef(tabs); tabsRef.current = tabs
  const subscriptions = useRef(new Map<string, () => void>())
  const documents = useRef(new Map<string, LessonDocumentEditorHandle>())
  const editorRefs = useRef(new Map<string, (editor: LessonDocumentEditorHandle | null) => void>())
  const mediaEditors = useRef(new Map<string, MediaFileEditorHandle>())
  const mediaEditorRefs = useRef(new Map<string, (editor: MediaFileEditorHandle | null) => void>())
  const mediaFilesRef = useRef(mediaFiles); mediaFilesRef.current = mediaFiles
  const requestMediaFiles = async (request: MediaFilesRequest) => {
    const api = mediaFilesRef.current ?? window.desktopAPI?.mediaFiles
    if (!api) throw new Error('图片和 PDF 文件服务尚未连接')
    return api(request)
  }
  const [, updateSelection] = useState(0)
  function selectionChanged(path: string) { if (path === activeTab) updateSelection(value => value + 1) }
  async function sendContextualCommand(path: string, instruction: string, target: ContextualEditTarget) {
    const editor = documents.current.get(path)
    const documentId = editor?.session.documentId
    if (!documentId) throw new Error('当前文档尚未就绪')
    const snapshot = await workbenchSelection.prepare(documentId)
    await workbenchSelection.request(captureMarkdownSelection(snapshot, target), instruction, true)
  }

  async function flushAll() {
    // 保存期间的重渲染会删/增注册表键，按 await 前的快照遍历，一次调用只判一次。
    for (const [filename, editor] of [...documents.current]) {
      if (!(await editor.flush())) { setActiveTab(tabsRef.current.find(tab => tab.id === filename)?.id ?? filename); return false }
    }
    for (const [id, editor] of [...mediaEditors.current]) {
      if (!await editor.flush()) { setActiveTab(id); return false }
    }
    // 标签仍标记未保存、注册表里却没有活编辑器时 flush 无从执行：必须按未保存拒绝切换，
    // 否则该标签会被静默移除、当前稿丢失（V02 冲突用例 :62 的红点即此分支缺失）。
    const unregistered = tabsRef.current.find(tab => tab.dirty && (tab.kind === 'document' && !documents.current.has(tab.id) || tab.kind === 'media' && !mediaEditors.current.has(tab.id)))
    if (unregistered) { setActiveTab(unregistered.id); return false }
    return true
  }
  async function saveActiveDocument(): Promise<'course' | 'document' | 'none'> {
    const tab = tabsRef.current.find(item => item.id === activeTab)
    if (!tab) return 'none'
    if (tab.kind === 'course') return 'course'
    if (tab.kind === 'material') return 'none'
    if (tab.kind === 'media') {
      const editor = mediaEditors.current.get(tab.id)
      if (!editor) throw new Error('当前文件尚未就绪，请稍后重试保存')
      await editor.flush()
      return 'document'
    }
    const editor = documents.current.get(tab.id)
    if (!editor) throw new Error('当前文档尚未就绪，请稍后重试保存')
    await editor.flush()
    return 'document'
  }
  async function disposeDocuments() {
    for (const editor of documents.current.values()) editor.session.dispose()
    documents.current.clear()
    mediaEditors.current.clear()
    for (const stop of subscriptions.current.values()) stop()
    subscriptions.current.clear()
    setTabs([])
    setActive('')
  }
  async function closeAll() {
    if (!(await flushAll())) return false
    await disposeDocuments()
    return true
  }
  async function preserveAll(mode: 'save' | 'preserve' = 'preserve') {
    // 同 flushAll：preserveDraft 期间的重渲染会删/增注册表键，必须按 await 前的快照遍历。
    for (const [filename, editor] of [...documents.current]) {
      if (!(await editor.preserveDraft())) { setActiveTab(tabsRef.current.find(tab => tab.id === filename)?.id ?? filename); return false }
    }
    for (const [id, editor] of [...mediaEditors.current]) {
      if (!await (mode === 'save' ? editor.flush() : editor.preserveDraft())) { setActiveTab(id); return false }
    }
    const unregistered = tabsRef.current.find(tab => tab.kind === 'media' && tab.dirty && !mediaEditors.current.has(tab.id))
    if (unregistered) { setActiveTab(unregistered.id); return false }
    return true
  }
  function suspendForClose(documentIds?: readonly string[]) {
    for (const editor of documents.current.values()) if (!documentIds || editor.session.documentId && documentIds.includes(editor.session.documentId)) editor.session.suspendForClose()
    if (!documentIds) for (const editor of mediaEditors.current.values()) editor.suspendForClose()
  }
  function resumeAfterCloseCancelled(documentIds?: readonly string[]) {
    for (const editor of documents.current.values()) if (!documentIds || editor.session.documentId && documentIds.includes(editor.session.documentId)) editor.session.resumeAfterCloseCancelled()
    if (!documentIds) for (const editor of mediaEditors.current.values()) editor.resumeAfterCloseCancelled()
  }
  async function openTab(tab: Omit<LessonFileTab, 'dirty' | 'id' | 'documentId'>) {
    const ticket = ++navigation.current
    const existing = tabsRef.current.find(item => tab.path && normalized(item.path) === normalized(tab.path))
    if (existing) { setActiveTab(existing.id); return }
    const snapshot = tab.kind === 'document' ? await documentPort.documents?.open(tab.path) : undefined
    const mediaSnapshot = tab.kind === 'media' ? await requestMediaFiles({ type: 'media-file.open-path', path: tab.path }) : undefined
    if (tab.kind === 'document' && !snapshot) throw new Error('文档服务尚未连接')
    const id = snapshot?.documentId ?? (mediaSnapshot ? `media:${normalized(mediaSnapshot.binding.path)}` : crypto.randomUUID())
    setTabs(current => current.some(item => item.id === id) ? current : [...current, { ...tab, path: mediaSnapshot?.binding.path ?? tab.path, id, documentId: snapshot?.documentId, mediaSnapshot, dirty: snapshot?.dirty ?? false }])
    if (ticket === navigation.current) setActive(id)
  }
  async function createMarkdown(name = '未命名文档') {
    const api = documentPort.documents
    if (!api) throw new Error('文档服务尚未连接')
    const ticket = ++navigation.current
    const title = /\.md$/i.test(name) ? name : `${name || '未命名文档'}.md`
    const snapshot = await api.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, title)
    setTabs(current => [...current, { id: snapshot.documentId, documentId: snapshot.documentId, path: '', name: title, kind: 'document', dirty: snapshot.dirty, lesson: null }])
    if (ticket === navigation.current) setActive(snapshot.documentId)
  }
  async function focusDocument(documentId: string) {
    const api = documentPort.documents
    if (!api) throw new Error('文档服务尚未连接')
    const snapshot = await api.read(documentId)
    if (snapshot.model.kind === 'course-v10') {
      const ticket = ++navigation.current
      if (!courseRef.current) throw new Error('H5 演示视图尚未连接')
      pendingCourse.current = { id: documentId, ticket }
      await courseRef.current.activate(documentId)
      if (ticket === navigation.current) setActive(documentId)
      return
    }
    if (!tabsRef.current.some(tab => tab.id === documentId)) {
      const path = snapshot.binding.kind === 'file' ? snapshot.binding.path : ''
      const name = snapshot.binding.kind === 'file' ? path.split(/[\\/]/).pop()! : snapshot.binding.suggestedName
      setTabs(current => current.some(tab => tab.id === documentId) ? current : [...current, { id: documentId, documentId, path, name, kind: 'document', dirty: snapshot.dirty, lesson: null }])
    }
    setActiveTab(documentId)
  }
  async function closeTab(tab: LessonFileTab) {
    if (tab.kind === 'course') {
      if (!courseRef.current || !await courseRef.current.close(tab.id)) return false
    } else if (tab.kind === 'media') {
      const editor = mediaEditors.current.get(tab.id)
      if (!editor && tab.dirty) return false
      if (editor && !await editor.close()) { setActiveTab(tab.id); return false }
    } else {
      const editor = documents.current.get(tab.id)
      if (!editor && tab.kind === 'document') return false
      if (editor && !(await editor.close())) { setActiveTab(tab.id); return false }
    }
    removeTab(tab.id)
    return true
  }
  function removeTab(id: string) {
    mediaEditors.current.delete(id)
    documents.current.delete(id); subscriptions.current.get(id)?.(); subscriptions.current.delete(id)
    const remaining = tabsRef.current.filter(item => item.id !== id)
    setTabs(remaining)
    if (activeTab === id) setActiveTab(remaining.at(-1)?.id ?? '')
  }
  function registerEditor(id: string, editor: LessonDocumentEditorHandle | null) {
    subscriptions.current.get(id)?.(); subscriptions.current.delete(id)
    if (!editor) { documents.current.delete(id); return }
    documents.current.set(id, editor)
    const follow = () => {
      const documentId = editor.session.documentId
      if (documentId) setTabs(current => current.some(tab => tab.id === id && tab.documentId !== documentId) ? current.map(tab => tab.id === id ? { ...tab, documentId } : tab) : current)
    }
    subscriptions.current.set(id, editor.session.subscribe(follow)); follow()
  }
  useEffect(() => documentPort.documents?.subscribe(event => {
    if (event.type !== 'changed' || event.snapshot.binding.kind !== 'file') return
    const snapshot = event.snapshot, filename = event.snapshot.binding.path
    const tab = tabsRef.current.find(item => item.documentId === snapshot.documentId || documents.current.get(item.id)?.session.documentId === snapshot.documentId)
    if (!tab || tab.path === filename) return
    setTabs(current => current.map(item => item.id === tab.id ? { ...item, documentId: snapshot.documentId, path: filename, name: filename.split(/[\\/]/).pop() ?? filename } : item))
  }), [documentPort.documents])
  useEffect(() => () => { for (const stop of subscriptions.current.values()) stop() }, [])
  /**
   * 每个 path 一个身份稳定的 ref 回调。内联 `ref={editor => registerEditor(tab.path, editor)}` 每次
   * 重渲染都是新函数，React 会先用 null 调旧回调（delete）再用实例调新回调（set）——同键被删后重新插入，
   * 在 Map 的键序里移到末尾，正在 await 中遍历它的循环就会反复回访同一条目（V02 冲突用例的不收敛根因）。
   * flushAll/preserveAll 的快照遍历是止血，这里消除抖动本身。
   */
  function editorRef(path: string) {
    let callback = editorRefs.current.get(path)
    if (!callback) {
      callback = (editor: LessonDocumentEditorHandle | null) => registerEditor(path, editor)
      editorRefs.current.set(path, callback)
    }
    return callback
  }
  function mediaEditorRef(id: string) {
    let callback = mediaEditorRefs.current.get(id)
    if (!callback) {
      callback = editor => { if (editor) mediaEditors.current.set(id, editor); else mediaEditors.current.delete(id) }
      mediaEditorRefs.current.set(id, callback)
    }
    return callback
  }
  function updateMediaSnapshot(id: string, snapshot: MediaFileSnapshot) {
    setTabs(current => current.map(tab => tab.id === id ? { ...tab, mediaSnapshot: snapshot, path: snapshot.binding.path, name: snapshot.binding.path.split(/[\\/]/).pop() ?? tab.name, dirty: false } : tab))
  }
  function updateDirty(path: string, dirty: boolean) {
    setTabs(current => current.some(tab => tab.id === path && tab.dirty !== dirty)
      ? current.map(tab => tab.id === path ? { ...tab, dirty } : tab) : current)
  }
  function activeDocumentTarget(): ActiveDocumentTarget | undefined {
    const tab = tabs.find(item => item.id === activeTab && item.kind === 'document')
    return tab ? {
      name: tab.name,
      getEditor: () => documents.current.get(tab.id) ?? null,
      getContextualEditTarget: () => documents.current.get(tab.id)?.getContextualEditTarget() ?? null,
    } : undefined
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey)) return
      const tab = tabsRef.current.find(item => item.id === activeTab)
      if (!tab) return
      const key = event.key.toLowerCase()
      if (key === 'w') { event.preventDefault(); void closeTab(tab) }
      else if (key === 's' && tab.kind === 'document') {
        event.preventDefault()
        event.stopPropagation()
        const editor = documents.current.get(tab.id)
        if (editor) void (event.shiftKey ? editor.saveAs() : editor.flush())
      } else if (key === 's' && tab.kind === 'media') {
        event.preventDefault(); event.stopPropagation()
        void mediaEditors.current.get(tab.id)?.flush()
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [activeTab, courseDocuments])
  const drainAll = async (documentIds?: readonly string[]) => {
    for (const editor of [...documents.current.values()]) {
      if (documentIds && !documentIds.includes(editor.session.documentId ?? '')) continue
      if (!await editor.session.drain()) return false
    }
    if (!documentIds) for (const [id, editor] of [...mediaEditors.current]) {
      if (!await editor.drain()) { setActiveTab(id); return false }
    }
    return true
  }
  return { tabs, activeTab, isCourseActive: tabs.some(tab => tab.id === activeTab && tab.kind === 'course'), createMarkdown, setActiveTab, focusDocument, openTab, closeTab, removeTab, registerEditor, editorRef, mediaEditorRef, mediaFiles: requestMediaFiles, updateMediaSnapshot, updateDirty, flushAll, saveActiveDocument, drainAll, preserveAll, suspendForClose, resumeAfterCloseCancelled, closeAll, disposeDocuments, activeDocumentTarget, selectionChanged, sendContextualCommand }
}

function normalized(value: string) { return value.replace(/\\/g, '/').toLowerCase() }
