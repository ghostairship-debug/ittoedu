import { useEffect, useRef, useState } from 'react'
import type { LessonConversation, LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import { lessonProjectPath, selectLessonConversation } from '../lessonConversationSelection'
import type { DocumentTabsController } from './useDocumentTabsController'

export interface LessonWorkspaceControllerProps {
  lessonOperation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  projectPath: string | null
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  onActiveLesson?(lesson: LessonWorkspace | null, conversation: LessonConversation | null): void
  tabs: DocumentTabsController
  scopeRef: { current: string }
}

export function useLessonWorkspaceController(props: LessonWorkspaceControllerProps) {
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [standalone, setStandalone] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null)
  const [lessons, setLessons] = useState<LessonWorkspace[]>([])
  const [lesson, setLesson] = useState<LessonWorkspace | null>(null)
  const [conversations, setConversations] = useState<LessonConversation[]>([])
  const [conversation, setConversation] = useState<LessonConversation | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [openingCopy, setOpeningCopy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [treeVersion, setTreeVersion] = useState(0)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [conversationsOpen, setConversationsOpen] = useState(true)
  const [workflowOpen, setWorkflowOpen] = useState(true)
  const [mobilePane, setMobilePane] = useState<'navigation' | 'chat' | 'workbench'>('chat')
  const current = useRef({ lesson, conversation })
  current.current = { lesson, conversation }
  props.scopeRef.current = lesson && conversation ? JSON.stringify([lesson.identity.lessonId, normalized(lesson.identity.normalizedDirectory), conversation.conversationId]) : ''

  useEffect(() => { void props.lessonOperation({ operation: 'recent-workspaces' }).then(result => setRecent(result.recent ?? [])).catch(reason => setError((reason as Error).message)) }, [props.lessonOperation])
  async function run(action: () => Promise<void>) { setBusy(true); setError(null); try { await action() } catch (reason) { setError((reason as Error).message) } finally { setBusy(false) } }
  async function stopAndFlush() {
    await props.tabs.stopAllAiEdits()
    if (!(await props.tabs.flushAll())) throw new Error('请先在文档标签处理未保存稿或文件冲突，再切换课例。')
  }
  function detachLesson() {
    setLesson(null); setConversation(null); setConversations([]); setStandalone(true); setMobilePane('workbench'); props.tabs.setActiveTab('course')
    props.onActiveLesson?.(null, null)
  }
  function showProject() {
    setStandalone(true)
    setMobilePane('workbench')
    props.tabs.setActiveTab('course')
  }
  async function openWorkspace(directory?: string, create = false) {
    await stopAndFlush()
    const result = await props.lessonOperation(directory ? { operation: 'open-workspace', directory } : { operation: 'choose-workspace', create })
    if (result.cancelled || !result.directory) return
    const listing = await props.lessonOperation({ operation: 'list-lessons', directory: result.directory })
    await props.tabs.disposeDocuments()
    setWorkspace(result.directory); setStandalone(false); setSelectedDirectory(result.directory); setLessons(listing.lessons ?? []); setLesson(null); setConversation(null); setConversations([])
    props.onActiveLesson?.(null, null)
  }
  async function activate(next: LessonWorkspace, preferred?: LessonConversation) {
    await stopAndFlush()
    const projectPath = lessonProjectPath(next)
    const listing = await props.lessonOperation({ operation: 'list-conversations', lesson: next.identity })
    const available = listing.conversations ?? []
    let active = selectLessonConversation(next, available, preferred)
    if (!active) active = (await props.lessonOperation({ operation: 'create-conversation', lesson: next.identity })).conversation
    if (!active) throw new Error('课例对话创建失败')
    if (!(projectPath ? await props.onOpenProject(projectPath) : await props.onNewProject())) return
    await props.tabs.disposeDocuments()
    setLesson(next); setConversations(available.some(item => item.conversationId === active!.conversationId) ? available : [...available, active]); setConversation(active); props.tabs.setActiveTab(next.manifest.coursePath ? 'course' : 'materials')
    props.onActiveLesson?.(next, active)
  }
  async function selectConversation(next: LessonConversation) {
    await stopAndFlush()
    if (next.projectTarget && normalized(next.projectTarget.normalizedPath) !== normalized(props.projectPath ?? '')) {
      if (!(await props.onOpenProject(next.projectTarget.normalizedPath))) return
    }
    if (!current.current.lesson) return
    setConversation(next); props.onActiveLesson?.(current.current.lesson, next)
  }
  async function openLesson(asCopy = false) {
    const result = await props.lessonOperation({ operation: 'open-lesson', ...(asCopy ? { asCopy: true } : {}) })
    if (result.cancelled || !result.lesson) return
    setLessons(currentLessons => [...currentLessons.filter(item => item.identity.lessonId !== result.lesson!.identity.lessonId), result.lesson!])
    await activate(result.lesson, result.conversation)
  }
  async function createLesson() {
    if (!selectedDirectory || !name.trim()) return
    const result = await props.lessonOperation({ operation: 'create-lesson', directory: selectedDirectory, name: name.trim() })
    if (!result.lesson) throw new Error('课例目录尚未创建')
    setLessons(currentLessons => [...currentLessons.filter(item => item.identity.lessonId !== result.lesson!.identity.lessonId), result.lesson!])
    setCreating(false); setName(''); setTreeVersion(value => value + 1)
    await activate(result.lesson)
  }
  async function openFile(entry: LessonDirectoryEntry) {
    await run(async () => {
      if (/\.h5lesson$/i.test(entry.name)) {
        await stopAndFlush()
        if (await props.onOpenProject(entry.path)) {
          await props.tabs.disposeDocuments()
          if (normalized(entry.path) !== normalized(props.projectPath ?? '')) detachLesson()
          props.tabs.setActiveTab('course')
        }
        return
      }
      const active = current.current.lesson
      const kind = /\.md$/i.test(entry.name) && active && relativeFile(active, entry.path) ? 'document' : 'material'
      props.tabs.openTab({ path: entry.path, name: entry.name, kind, lesson: active })
      setMobilePane('workbench')
    })
  }
  async function newStandaloneProject() {
    await stopAndFlush()
    if (await props.onNewProject()) { await props.tabs.disposeDocuments(); detachLesson() }
  }
  function applyBinding(nextLesson: LessonWorkspace, nextConversation: LessonConversation) {
    const active = current.current.lesson
    if (!active || active.identity.lessonId !== nextLesson.identity.lessonId || normalized(active.identity.normalizedDirectory) !== normalized(nextLesson.identity.normalizedDirectory)) return
    setLesson(nextLesson); setConversation(nextConversation)
    setConversations(currentConversations => currentConversations.some(item => item.conversationId === nextConversation.conversationId) ? currentConversations.map(item => item.conversationId === nextConversation.conversationId ? nextConversation : item) : [...currentConversations, nextConversation])
    setLessons(currentLessons => currentLessons.map(item => item.identity.lessonId === nextLesson.identity.lessonId ? nextLesson : item))
  }
  return {
    state: { workspace, standalone, recent, selectedDirectory, lessons, lesson, conversations, conversation, name, creating, openingCopy, error, busy, treeVersion, explorerOpen, conversationsOpen, workflowOpen, mobilePane },
    actions: {
      run, openWorkspace, activate, selectConversation, openLesson, createLesson, openFile, newStandaloneProject, detachLesson, showProject, applyBinding,
      setSelectedDirectory, setName, setCreating, setOpeningCopy, refreshTree: () => { if (workspace) { setSelectedDirectory(workspace); setTreeVersion(value => value + 1) } },
      setExplorerOpen, setConversationsOpen, setWorkflowOpen, setMobilePane,
      setConversations,
      clearConversation: () => { void props.tabs.stopDocumentEdit(); setConversation(null); props.onActiveLesson?.(null, null) },
    },
  }
}

function normalized(value: string) { return value.replace(/\\/g, '/').toLowerCase() }
function relativeFile(lesson: LessonWorkspace, filename: string) {
  const root = lesson.identity.normalizedDirectory.replace(/[\\/]$/, '')
  return normalized(filename).startsWith(`${normalized(root)}/`) ? filename.replace(/\\/g, '/').slice(root.length + 1) : null
}
