import { officeFocus } from '../../workbench/officeFocus'
import { captureMarkdownSelection, workbenchSelection } from '../../workbench/SelectionContextController'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import { useEffect, useRef, useState } from 'react'
import type { ContextualEditTarget } from '../../../shared/document/ports'
import type { LessonDocumentEditorHandle } from '../../documentFiles/LessonDocumentEditor'
import type { RecoverableDocumentFilePort } from '../../documentFiles/documentFileSession'
import type { LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { MediaFileEditorHandle } from '../../documentFiles/media/MediaFileEditor'
import type { FileArtifactBinding, MediaFileDraftInput, MediaFileSnapshot, MediaFilesRequest } from '../../../shared/workbench/mediaFiles'
import type { DocxPreviewSnapshot, PptxPreviewRequest, PptxPreviewSnapshot } from '../../../shared/workbench/officePreview'
import type { PptxObjectEdit, OfficeEditContent } from '../../../shared/workbench/officeFiles'
import type { OfficeDocumentRequest, OfficeDocumentSnapshot } from '../../../shared/workbench/officeDocument'
import type { OfficeEditorHandle } from '../../documentFiles/office/officeEditorHandle'

export type LessonFileTab = {
  id: string
  documentId?: string
  path: string
  name: string
  kind: 'document' | 'material' | 'course' | 'media' | 'presentation' | 'word' | 'spreadsheet'
  mediaSnapshot?: MediaFileSnapshot
  pptxSnapshot?: PptxPreviewSnapshot
  docxSnapshot?: DocxPreviewSnapshot
  officeSnapshot?: OfficeDocumentSnapshot
  officePending?: boolean
  officeStale?: boolean
  officeMessage?: string
  officeError?: string
  dirty: boolean
  lesson: LessonWorkspace | null
}

export interface CourseDocumentsPort {
  activation?: number
  documents: readonly DocumentSnapshot[]
  activeDocumentId: string | null
  /** Reads the current course view/selection scope without changing it. */
  captureScope?(): () => boolean
  activate(documentId: string, activateIf?: () => boolean): Promise<void | boolean>
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
  createText(name?: string): Promise<void>
  tabs: LessonFileTab[]
  activeTab: string
  /** Reads the existing navigation request identity without starting a navigation. */
  captureNavigationIdentity(): string
  cancelNavigation(): void
  showCurrentCourse(foreground?: () => boolean): void
  setActiveTab(tab: string): void
  focusDocument(documentId: string): Promise<void | boolean>
  openTab(tab: Omit<LessonFileTab, 'dirty' | 'id' | 'documentId'>): Promise<void>
  closeTab(tab: LessonFileTab): Promise<boolean>
  removeTab(path: string): void
  registerEditor(path: string, editor: LessonDocumentEditorHandle | null): void
  editorRef(path: string): (editor: LessonDocumentEditorHandle | null) => void
  mediaEditorRef(id: string): (editor: MediaFileEditorHandle | null) => void
  mediaFiles(request: MediaFilesRequest): Promise<MediaFileSnapshot>
  updateMediaSnapshot(id: string, snapshot: MediaFileSnapshot): void
  reloadPptx(id: string): Promise<PptxPreviewSnapshot>
  editPptx(id: string, edits: PptxObjectEdit[]): Promise<void>
  commitPptx(id: string, binding: FileArtifactBinding, bytes: Uint8Array): Promise<PptxPreviewSnapshot>
  officeEditorRef(id: string): (editor: OfficeEditorHandle | null) => void
  movePptxHistory(id: string, action: 'undo' | 'redo'): Promise<void>
  reloadDocx(id: string): Promise<DocxPreviewSnapshot>
  reloadOffice(id: string): Promise<OfficeDocumentSnapshot>
  editOffice(id: string, binding: FileArtifactBinding, content: OfficeEditContent): Promise<OfficeDocumentSnapshot>
  moveOfficeHistory(id: string, action: 'undo' | 'redo'): Promise<OfficeDocumentSnapshot>
  updateDirty(path: string, dirty: boolean): void
  flushAll(): Promise<boolean>
  prepareOfficeFiles(paths: readonly string[]): Promise<boolean>
  saveActiveDocument(): Promise<'course' | 'document' | 'none'>
  drainAll(documentIds?: readonly string[]): Promise<boolean>
  captureMediaDrafts(source: string, kind: 'file' | 'directory'): MediaFileDraftInput[]
  preserveAll(mode?: 'save' | 'preserve', documentIds?: readonly string[]): Promise<boolean>
  hasDirtyInputs(documentIds?: readonly string[]): boolean
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
  const [activeTab, setActiveState] = useState('')
  const activeTabRef = useRef(activeTab)
  function setActive(id: string) { activeTabRef.current = id; setActiveState(id) }
  const navigation = useRef(0)
  const courseRef = useRef(courseDocuments); courseRef.current = courseDocuments
  const previousCourse = useRef<string | null>(null)
  const previousActivation = useRef<number | undefined>(undefined)
  const pendingCourse = useRef<{ id: string; ticket: number } | null>(null)
  function cancelNavigation() { ++navigation.current; pendingCourse.current = null }
  function showCurrentCourse(foreground?: () => boolean) {
    if (foreground?.() === false) return
    const course = courseRef.current, active = course?.activeDocumentId
    if (!active || !course.documents.some(snapshot => snapshot.documentId === active)) return
    if (!foreground) cancelNavigation()
    else pendingCourse.current = null
    setActive(active)
  }
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
      const pending = { id, ticket }; pendingCourse.current = pending
      const isCurrent = () => ticket === navigation.current
      const scope = course.captureScope?.()
      const canActivate = () => isCurrent() && scope?.() !== false
      void course.activate(id, canActivate).then(activated => { if (activated !== false && isCurrent()) setActive(id) })
        .catch(() => { /* The course lifecycle retains the draft and reports its error. */ })
        .finally(() => { if (pendingCourse.current === pending) pendingCourse.current = null })
    } else { pendingCourse.current = null; setActive(id) }
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
      const explicit = pending?.id === active && pending.ticket === navigation.current
      const current = activeTabRef.current
      const showingCourse = !current || tabsRef.current.some(tab => tab.id === current && tab.kind === 'course')
      if (explicit || !pending && showingCourse) setActive(active!)
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
  const officeReadTokens = useRef(new Map<string, number>())
  const docxRequests = useRef(new Map<string, string>())
  const latestOfficeBindings = useRef(new Map<string, FileArtifactBinding>())
  const officeMutations = useRef(new Map<string, Promise<unknown>>())
  const officeEditors = useRef(new Map<string, OfficeEditorHandle>())
  const officeEditorRefs = useRef(new Map<string, (editor: OfficeEditorHandle | null) => void>())
  function officeEditorRef(id: string) {
    let callback = officeEditorRefs.current.get(id)
    if (!callback) { callback = editor => { if (editor) officeEditors.current.set(id, editor); else officeEditors.current.delete(id) }; officeEditorRefs.current.set(id, callback) }
    return callback
  }
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
    if (!await drainOfficeInputs()) return false
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
    if (tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet') {
      if (!await drainOfficeInputs(tab.id)) throw new Error('当前 Office 修改尚未保存，请处理编辑区提示')
      return 'document'
    }
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
    cancelNavigation()
    for (const id of docxRequests.current.keys()) cancelOfficeRead(id)
    officeReadTokens.current.clear(); latestOfficeBindings.current.clear()
    for (const editor of documents.current.values()) editor.session.dispose()
    documents.current.clear()
    mediaEditors.current.clear()
    for (const stop of subscriptions.current.values()) stop()
    subscriptions.current.clear()
    tabsRef.current = []; setTabs([])
    setActive('')
  }
  async function closeAll() {
    if (!(await flushAll())) return false
    await disposeDocuments()
    return true
  }
  async function preserveAll(mode: 'save' | 'preserve' = 'preserve', documentIds?: readonly string[]) {
    if (!documentIds && !await drainOfficeInputs()) return false
    // 同 flushAll：preserveDraft 期间的重渲染会删/增注册表键，必须按 await 前的快照遍历。
    for (const [filename, editor] of [...documents.current]) {
      if (documentIds && (!editor.session.documentId || !documentIds.includes(editor.session.documentId))) continue
      if (!(await editor.preserveDraft())) { setActiveTab(tabsRef.current.find(tab => tab.id === filename)?.id ?? filename); return false }
    }
    for (const [id, editor] of documentIds ? [] : [...mediaEditors.current]) {
      if (!await (mode === 'save' ? editor.flush() : editor.preserveDraft())) { setActiveTab(id); return false }
    }
    const unregistered = !documentIds && tabsRef.current.find(tab => tab.kind === 'media' && tab.dirty && !mediaEditors.current.has(tab.id))
    if (unregistered) { setActiveTab(unregistered.id); return false }
    return true
  }
  function hasDirtyInputs(documentIds?: readonly string[]): boolean {
    return tabsRef.current.some(tab => tab.dirty && (!documentIds || tab.documentId && documentIds.includes(tab.documentId)))
      || [...documents.current.values()].some(editor => editor.session.getSnapshot().dirty
        && (!documentIds || editor.session.documentId && documentIds.includes(editor.session.documentId)))
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
    if (tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet') {
      const id = crypto.randomUUID()
      const opened: LessonFileTab = { ...tab, id, dirty: false, officePending: true,
        officeMessage: tab.kind === 'word' ? '正在打开 Word 文稿…' : tab.kind === 'spreadsheet' ? '正在打开 Excel 工作簿…' : '正在载入演示文稿…' }
      tabsRef.current = [...tabsRef.current, opened]
      setTabs(current => current.some(item => item.id === id) ? current : [...current, opened])
      if (ticket === navigation.current) setActive(id)
      // Keep the tab and its retry/close controls visible during first-use setup.
      await readOfficeTab(id).catch(() => {})
      return
    }
    const snapshot = tab.kind === 'document' ? await documentPort.documents?.open(tab.path) : undefined
    const mediaSnapshot = tab.kind === 'media' ? await requestMediaFiles({ type: 'media-file.open-path', path: tab.path }) : undefined
    if (tab.kind === 'document' && !snapshot) throw new Error('文档服务尚未连接')
    const filename = mediaSnapshot?.binding.path ?? tab.path
    const alreadyOpened = mediaSnapshot && tabsRef.current.find(item => normalized(item.path) === normalized(filename))
    if (alreadyOpened) { if (ticket === navigation.current) setActiveTab(alreadyOpened.id); return }
    const id = snapshot?.documentId ?? crypto.randomUUID()
    const opened = { ...tab, path: filename, id, documentId: snapshot?.documentId, mediaSnapshot, dirty: snapshot?.dirty ?? false }
    if (mediaSnapshot) tabsRef.current = [...tabsRef.current, opened]
    setTabs(current => current.some(item => item.id === id) ? current : [...current, opened])
    if (ticket === navigation.current) setActive(id)
  }
  async function createSource(name: string, kind: 'markdown' | 'text') {
    const api = documentPort.documents
    if (!api) throw new Error('文档服务尚未连接')
    const ticket = ++navigation.current
    const extension = kind === 'markdown' ? '.md' : '.txt'
    const title = name.toLowerCase().endsWith(extension) ? name : `${name || '未命名文档'}${extension}`
    const snapshot = await api.create({ kind, source: '', resources: { assets: {}, components: {} } }, title)
    setTabs(current => [...current, { id: snapshot.documentId, documentId: snapshot.documentId, path: '', name: title, kind: 'document', dirty: snapshot.dirty, lesson: null }])
    if (ticket === navigation.current) setActive(snapshot.documentId)
  }
  const createMarkdown = (name = '未命名 MD 文档') => createSource(name, 'markdown')
  const createText = (name = '未命名 TXT 文档') => createSource(name, 'text')
  async function focusDocument(documentId: string) {
    const api = documentPort.documents
    if (!api) throw new Error('文档服务尚未连接')
    const ticket = ++navigation.current
    pendingCourse.current = null
    const isCurrent = () => ticket === navigation.current
    const scope = courseRef.current?.captureScope?.()
    const canActivate = () => isCurrent() && scope?.() !== false
    const snapshot = await api.read(documentId)
    if (!canActivate()) return false
    if (snapshot.model.kind === 'course-v10') {
      if (!courseRef.current) throw new Error('果铃工程视图尚未连接')
      const pending = { id: documentId, ticket }; pendingCourse.current = pending
      try {
        const activated = await courseRef.current.activate(documentId, canActivate)
        if (activated !== false && isCurrent()) { setActive(documentId); return true }
        return false
      } finally { if (pendingCourse.current === pending) pendingCourse.current = null }
      return
    }
    if (!tabsRef.current.some(tab => tab.id === documentId)) {
      const path = snapshot.binding.kind === 'file' ? snapshot.binding.path : ''
      const name = snapshot.binding.kind === 'file' ? path.split(/[\\/]/).pop()! : snapshot.binding.suggestedName
      setTabs(current => current.some(tab => tab.id === documentId) ? current : [...current, { id: documentId, documentId, path, name, kind: 'document', dirty: snapshot.dirty, lesson: null }])
    }
    if (isCurrent()) { setActive(documentId); return true }
    return false
  }
  async function closeTab(tab: LessonFileTab) {
    if ((tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet') && !await drainOfficeInputs(tab.id)) return false
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
    cancelOfficeRead(id); latestOfficeBindings.current.delete(id)
    mediaEditors.current.delete(id); officeEditors.current.delete(id); officeEditorRefs.current.delete(id)
    editorRefs.current.delete(id); mediaEditorRefs.current.delete(id)
    documents.current.delete(id); subscriptions.current.get(id)?.(); subscriptions.current.delete(id)
    const remaining = tabsRef.current.filter(item => item.id !== id)
    tabsRef.current = remaining; setTabs(remaining)
    if (activeTabRef.current === id) setActiveTab(remaining.at(-1)?.id ?? '')
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
    if (event.type === 'closed') return
    const snapshot = event.type === 'changed' ? event.head ?? event.snapshot : event.head
    const filename = snapshot.binding.kind === 'file' ? snapshot.binding.path : ''
    const name = snapshot.binding.kind === 'file' ? filename.split(/[\\/]/).pop() ?? filename : snapshot.binding.suggestedName
    const tab = tabsRef.current.find(item => item.documentId === snapshot.documentId || documents.current.get(item.id)?.session.documentId === snapshot.documentId)
    if (!tab || tab.path === filename && tab.name === name) return
    setTabs(current => current.map(item => item.id === tab.id ? { ...item, documentId: snapshot.documentId, path: filename, name } : item))
  }), [documentPort.documents])
  useEffect(() => window.desktopAPI?.onMediaArtifactBindingChanged?.(({ before, binding }) => {
    const matches = (current: MediaFileSnapshot['binding']) => normalized(current.path) === normalized(before.path)
      && current.fileVersion === before.fileVersion && current.bindingVersion === before.bindingVersion
    const rebound = new Set<string>()
    for (const [id, editor] of mediaEditors.current) if (matches(editor.binding())) { editor.rebind(binding); rebound.add(id) }
    const affected = tabsRef.current.filter(tab => (tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet')
      && normalized(tab.path) === normalized(before.path))
    for (const tab of affected) latestOfficeBindings.current.set(tab.id, binding)
    const ids = new Set(affected.map(tab => tab.id)), contentChanged = before.fileVersion !== binding.fileVersion
    const relocate = (current: LessonFileTab[]) => current.map(tab => {
      if (tab.kind === 'media' && tab.mediaSnapshot && (rebound.has(tab.id) || matches(tab.mediaSnapshot.binding)))
        return { ...tab, path: binding.path, name: binding.path.split(/[\\/]/).pop() ?? tab.name, mediaSnapshot: { ...tab.mediaSnapshot, binding } }
      if (!ids.has(tab.id)) return tab
      // A changed file needs new bytes/inspection as one snapshot. Never attach
      // the new writer version to the old rendered or editable content.
      return { ...tab, path: binding.path, name: binding.path.split(/[\\/]/).pop() ?? tab.name,
        ...(contentChanged ? { officeStale: true } : {
          ...(tab.pptxSnapshot ? { pptxSnapshot: { ...tab.pptxSnapshot, binding } } : {}),
          ...(tab.docxSnapshot ? { docxSnapshot: { ...tab.docxSnapshot, binding } } : {}),
          ...(tab.officeSnapshot ? { officeSnapshot: { ...tab.officeSnapshot, binding } } : {}),
        }) }
    })
    tabsRef.current = relocate(tabsRef.current)
    setTabs(relocate)
    for (const tab of affected) if (contentChanged && !officeMutations.current.has(tab.id)) void readOfficeTab(tab.id).catch(() => {})
  }), [])
  useEffect(() => window.desktopAPI?.onDocxPreviewProgress?.(({ requestId, message }) => {
    const id = [...docxRequests.current].find(([, current]) => current === requestId)?.[0]
    if (id) updateOfficeTab(id, tab => ({ ...tab, officeMessage: message }))
  }), [])
  useEffect(() => () => {
    cancelNavigation()
    for (const id of docxRequests.current.keys()) cancelOfficeRead(id)
    for (const stop of subscriptions.current.values()) stop()
  }, [])
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
  function updateOfficeTab(id: string, change: (tab: LessonFileTab) => LessonFileTab) {
    const update = (current: LessonFileTab[]) => {
      const next = current.map(tab => tab.id === id ? change(tab) : tab)
      return next.some((tab, index) => tab !== current[index]) ? next : current
    }
    tabsRef.current = update(tabsRef.current); setTabs(update)
  }
  function cancelOfficeRead(id: string) {
    officeReadTokens.current.set(id, (officeReadTokens.current.get(id) ?? 0) + 1)
    const requestId = docxRequests.current.get(id)
    docxRequests.current.delete(id)
    if (requestId) void window.desktopAPI?.cancelDocxPreview?.({ requestId }).catch(() => {})
  }
  function publishOfficeSnapshot(id: string, snapshot: PptxPreviewSnapshot | DocxPreviewSnapshot | OfficeDocumentSnapshot) {
    const tab = tabsRef.current.find(item => item.id === id), latest = latestOfficeBindings.current.get(id)
    if (!tab || normalized(tab.path) !== normalized(snapshot.binding.path)
      || latest && latest.bindingVersion > snapshot.binding.bindingVersion) throw new Error('文件标签或版本已改变，请重新载入当前原件')
    latestOfficeBindings.current.set(id, snapshot.binding)
    officeFocus.updateBinding(snapshot.binding.path, snapshot.binding)
    updateOfficeTab(id, current => ({ ...current,
      ...('pdfBytes' in snapshot ? { docxSnapshot: snapshot } : snapshot.inspection?.format === 'docx' || snapshot.inspection?.format === 'xlsx'
        ? { officeSnapshot: snapshot as OfficeDocumentSnapshot } : { pptxSnapshot: snapshot as PptxPreviewSnapshot }),
      path: snapshot.binding.path, name: snapshot.binding.path.split(/[\\/]/).pop() ?? current.name,
      officeStale: false, officeError: undefined,
    }))
  }
  async function readOfficeTab(id: string): Promise<PptxPreviewSnapshot | OfficeDocumentSnapshot> {
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab || tab.kind !== 'presentation' && tab.kind !== 'word' && tab.kind !== 'spreadsheet') throw new Error('Office 文件标签已关闭')
    cancelOfficeRead(id)
    const ticket = officeReadTokens.current.get(id)!
    updateOfficeTab(id, current => ({ ...current, officePending: true, officeError: undefined,
      officeMessage: tab.kind === 'word' ? '正在打开 Word 文稿…' : tab.kind === 'spreadsheet' ? '正在打开 Excel 工作簿…' : '正在载入演示文稿…' }))
    try {
      const snapshot = tab.kind === 'presentation'
        ? await window.desktopAPI?.pptxPreview?.({ type: 'pptx-preview.open', path: tab.path })
        : await window.desktopAPI?.officeDocument?.({ type: 'office-document.open', path: tab.path })
      if (!snapshot) throw new Error('Office 原件服务尚未连接')
      if (officeReadTokens.current.get(id) !== ticket) throw new Error('此载入已被更新的请求取代')
      publishOfficeSnapshot(id, snapshot)
      return snapshot
    } catch (reason) {
      if (officeReadTokens.current.get(id) === ticket) updateOfficeTab(id, current => ({ ...current,
        officeError: `${current.pptxSnapshot || current.docxSnapshot || current.officeSnapshot ? '未能取得最新原件，当前仍显示上一次内容。' : ''}${reason instanceof Error ? reason.message : String(reason)}`,
      }))
      throw reason
    } finally {
      if (officeReadTokens.current.get(id) === ticket) {
        docxRequests.current.delete(id)
        updateOfficeTab(id, current => ({ ...current, officePending: false, officeMessage: undefined }))
      }
    }
  }
  async function reloadPptx(id: string): Promise<PptxPreviewSnapshot> {
    if (tabsRef.current.find(tab => tab.id === id)?.kind !== 'presentation') throw new Error('演示文稿标签已关闭')
    return await readOfficeTab(id) as PptxPreviewSnapshot
  }
  async function reloadDocx(id: string): Promise<DocxPreviewSnapshot> {
    if (tabsRef.current.find(tab => tab.id === id)?.kind !== 'word') throw new Error('Word 文件标签已关闭')
    const tab = tabsRef.current.find(item => item.id === id)!
    const requestId = crypto.randomUUID(); docxRequests.current.set(id, requestId)
    try {
      const snapshot = await window.desktopAPI?.docxPreview?.({ type: 'docx-preview.open', path: tab.path, requestId })
      if (!snapshot) throw new Error('分页对照服务尚未连接')
      updateOfficeTab(id, current => ({ ...current, docxSnapshot: snapshot }))
      return snapshot
    } finally { docxRequests.current.delete(id) }
  }
  async function reloadOffice(id: string): Promise<OfficeDocumentSnapshot> {
    const tab = tabsRef.current.find(item => item.id === id)
    if (tab?.kind !== 'word' && tab?.kind !== 'spreadsheet') throw new Error('Office 编辑标签已关闭')
    return await readOfficeTab(id) as OfficeDocumentSnapshot
  }
  async function mutateOffice(id: string, request: Exclude<OfficeDocumentRequest, { type: 'office-document.open' }>): Promise<OfficeDocumentSnapshot> {
    if (officeMutations.current.has(id)) throw new Error('上一项原件修改尚未完成')
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab?.officeSnapshot || tab.officePending || tab.officeStale || !window.desktopAPI?.officeDocument)
      throw new Error('请等待原件就绪；当前输入已保留')
    cancelOfficeRead(id)
    updateOfficeTab(id, current => ({ ...current, officePending: true, officeError: undefined, officeMessage: '正在保存原件…' }))
    const work = Promise.resolve().then(async () => {
      try {
        const snapshot = await window.desktopAPI!.officeDocument!(request)
        publishOfficeSnapshot(id, snapshot); return snapshot
      } catch (reason) {
        updateOfficeTab(id, current => ({ ...current, officeStale: true, officeError: reason instanceof Error ? reason.message : String(reason) }))
        throw reason
      } finally {
        officeMutations.current.delete(id)
        updateOfficeTab(id, current => ({ ...current, officePending: false, officeMessage: undefined }))
      }
    })
    officeMutations.current.set(id, work)
    return work
  }
  async function editOffice(id: string, binding: FileArtifactBinding, content: OfficeEditContent) {
    return mutateOffice(id, { type: 'office-document.edit', binding, content })
  }
  async function moveOfficeHistory(id: string, action: 'undo' | 'redo') {
    if (!await drainOfficeInputs(id)) throw new Error('当前输入尚未保存')
    const binding = tabsRef.current.find(tab => tab.id === id)?.officeSnapshot?.binding
    if (!binding) throw new Error('Office 文件尚未就绪')
    return mutateOffice(id, { type: action === 'undo' ? 'office-document.undo' : 'office-document.redo', binding })
  }
  async function mutatePptx(id: string, request: Extract<PptxPreviewRequest, { type: 'pptx-preview.edit' | 'pptx-preview.commit' | 'pptx-preview.undo' | 'pptx-preview.redo' }>): Promise<PptxPreviewSnapshot> {
    if (officeMutations.current.has(id)) throw new Error('上一项原件修改尚未完成，请稍后重试')
    const tab = tabsRef.current.find(item => item.id === id)
    if (!tab?.pptxSnapshot || tab.officePending || tab.officeStale || !window.desktopAPI?.pptxPreview)
      throw new Error('请等原件最新版本载入后再修改；当前输入已保留')
    cancelOfficeRead(id)
    updateOfficeTab(id, current => ({ ...current, officePending: true, officeError: undefined, officeMessage: '正在保存演示文稿原件…' }))
    // Install the pending owner before invoking IPC: its binding event can arrive
    // before the invoke response and must not launch a competing reload.
    const work = Promise.resolve().then(async () => {
      try { const snapshot = await window.desktopAPI!.pptxPreview!(request); publishOfficeSnapshot(id, snapshot); return snapshot }
      catch (reason) {
        updateOfficeTab(id, current => ({ ...current, officeStale: true,
          officeError: reason instanceof Error ? reason.message : String(reason) }))
        throw reason
      } finally {
        officeMutations.current.delete(id)
        updateOfficeTab(id, current => ({ ...current, officePending: false, officeMessage: undefined }))
      }
    })
    officeMutations.current.set(id, work)
    try { return await work }
    catch (reason) {
      // Unknown receipts or external changes must be recoverable from the same
      // authorized tab; retain the action error in the object editor itself.
      await readOfficeTab(id).catch(() => {})
      throw reason
    }
  }
  async function editPptx(id: string, edits: PptxObjectEdit[]) {
    const binding = tabsRef.current.find(tab => tab.id === id)?.pptxSnapshot?.binding
    if (!binding) throw new Error('演示文稿尚未就绪')
    await mutatePptx(id, { type: 'pptx-preview.edit', binding, content: { format: 'pptx', edits } })
  }
  async function commitPptx(id: string, binding: FileArtifactBinding, bytes: Uint8Array) {
    return mutatePptx(id, { type: 'pptx-preview.commit', binding, bytes: Uint8Array.from(bytes) })
  }
  async function movePptxHistory(id: string, action: 'undo' | 'redo') {
    const binding = tabsRef.current.find(tab => tab.id === id)?.pptxSnapshot?.binding
    if (!binding) throw new Error('演示文稿尚未就绪')
    await mutatePptx(id, { type: action === 'undo' ? 'pptx-preview.undo' : 'pptx-preview.redo', binding })
  }
  async function drainOfficeInputs(id?: string): Promise<boolean> {
    for (const [currentId, editor] of [...officeEditors.current]) if (!id || id === currentId) {
      if (!await editor.flush()) { setActiveTab(currentId); return false }
    }
    for (const [currentId, pending] of [...officeMutations.current]) if (!id || id === currentId) {
      try { await pending } catch { setActiveTab(currentId); return false }
    }
    const dirty = tabsRef.current.find(tab => (tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet') && tab.dirty && (!id || id === tab.id))
    if (!dirty) return true
    updateOfficeTab(dirty.id, tab => ({ ...tab, officeError: '请先应用或取消对象面板中的修改，再关闭或切换工作空间。' }))
    setActiveTab(dirty.id); return false
  }
  async function prepareOfficeFiles(paths: readonly string[]): Promise<boolean> {
    const selected = new Set(paths.map(normalized))
    // Freeze file identities before waiting: a later tab click must neither skip
    // a captured Office draft nor add the newly focused file to this submission.
    const ids = tabsRef.current.filter(tab => selected.has(normalized(tab.path))
      && (tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet')).map(tab => tab.id)
    for (const id of ids) if (!await drainOfficeInputs(id)) return false
    // Earlier files remain editable while a later file is saving. Refuse this
    // submission if a captured draft changed again; do not silently send an
    // older disk version or loop while the user is still typing.
    for (const id of ids) {
      const tab = tabsRef.current.find(item => item.id === id)
      if (!tab) return false
      if (tab.dirty || tab.officePending || officeMutations.current.has(id)) {
        setActiveTab(id); return false
      }
    }
    return true
  }
  function updateDirty(path: string, dirty: boolean) {
    updateOfficeTab(path, tab => {
      const clearNotice = !dirty && tab.officeError === '请先应用或取消对象面板中的修改，再关闭或切换工作空间。'
      return tab.dirty === dirty && !clearNotice ? tab : { ...tab, dirty, ...(clearNotice ? { officeError: undefined } : {}) }
    })
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
      } else if (key === 's' && (tab.kind === 'presentation' || tab.kind === 'word' || tab.kind === 'spreadsheet')) {
        event.preventDefault(); event.stopPropagation(); void drainOfficeInputs(tab.id)
      } else if (key === 's' && tab.kind === 'media') {
        event.preventDefault(); event.stopPropagation()
        void mediaEditors.current.get(tab.id)?.flush()
      }
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [activeTab, courseDocuments])
  const drainAll = async (documentIds?: readonly string[]) => {
    if (!documentIds && !await drainOfficeInputs()) return false
    for (const editor of [...documents.current.values()]) {
      if (documentIds && !documentIds.includes(editor.session.documentId ?? '')) continue
      if (!await editor.session.drain()) return false
    }
    if (!documentIds) for (const [id, editor] of [...mediaEditors.current]) {
      if (!await editor.drain()) { setActiveTab(id); return false }
    }
    return true
  }
  function captureMediaDrafts(source: string, kind: 'file' | 'directory'): MediaFileDraftInput[] {
    const parent = normalized(source).replace(/\/$/, '')
    const drafts: MediaFileDraftInput[] = []
    for (const tab of tabsRef.current) if (tab.kind === 'media') {
      const editor = mediaEditors.current.get(tab.id)
      const filename = normalized(editor?.binding().path ?? tab.path)
      if (kind === 'file' ? filename !== parent : filename !== parent && !filename.startsWith(`${parent}/`)) continue
      if (!editor) throw new Error('媒体编辑器尚未连接，当前稿已保留')
      drafts.push(editor.captureCopyDraft())
    }
    return drafts
  }
  return { tabs, activeTab, captureNavigationIdentity: () => String(navigation.current), cancelNavigation, showCurrentCourse, isCourseActive: tabs.some(tab => tab.id === activeTab && tab.kind === 'course'), createMarkdown, createText, setActiveTab, focusDocument, openTab, closeTab, removeTab, registerEditor, editorRef, mediaEditorRef, mediaFiles: requestMediaFiles, updateMediaSnapshot, reloadPptx, editPptx, commitPptx, officeEditorRef, movePptxHistory, reloadDocx, reloadOffice, editOffice, moveOfficeHistory, updateDirty, flushAll, prepareOfficeFiles, saveActiveDocument, drainAll, captureMediaDrafts, preserveAll, hasDirtyInputs, suspendForClose, resumeAfterCloseCancelled, closeAll, disposeDocuments, activeDocumentTarget, selectionChanged, sendContextualCommand }
}

function normalized(value: string) { return value.replace(/\\/g, '/').toLowerCase() }
