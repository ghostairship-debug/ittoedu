import { useEffect, useRef, useState } from 'react'
import { conversationOwnerOf, type ConversationOwner, type LessonConversation, type LessonProject, type LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import { normalizeWorkspacePath } from '../../../shared/workspaceIdentity'
import { lessonProjectPath, selectLessonConversation } from '../lessonConversationSelection'
import type { DocumentTabsController } from './useDocumentTabsController'

export interface LessonWorkspaceControllerProps {
  lessonOperation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  projectPath: string | null
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
  onActiveLesson?(lesson: LessonWorkspace | null, conversation: LessonConversation | null): void
  onActiveDirectoryConversation?(conversation: LessonConversation | null): void
  tabs: DocumentTabsController
  scopeRef: { current: string }
}

/** 目录上下文：整个工作空间或其下的一个项目文件夹。 */
export type DirectoryContext = { kind: 'workspace' } | { kind: 'project'; project: LessonProject }

const LAST_WORKSPACE_KEY = 'guoling-last-workspace'

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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [treeVersion, setTreeVersion] = useState(0)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [conversationsOpen, setConversationsOpen] = useState(true)
  const [workflowOpen, setWorkflowOpen] = useState(true)
  const [mobilePane, setMobilePane] = useState<'navigation' | 'chat' | 'workbench'>('chat')
  const [projects, setProjects] = useState<LessonProject[]>([])
  const [directoryConversations, setDirectoryConversations] = useState<LessonConversation[]>([])
  const [projectConversations, setProjectConversationsState] = useState<Record<string, LessonConversation[]>>({})
  const [directoryConversation, setDirectoryConversation] = useState<LessonConversation | null>(null)
  const [activeDirectory, setActiveDirectory] = useState<DirectoryContext | null>(null)
  const [projectFolder, setProjectFolder] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectNotice, setProjectNotice] = useState<string | null>(null)
  const current = useRef({ lesson, conversation, lessons, directoryConversation })
  current.current = { lesson, conversation, lessons, directoryConversation }
  props.scopeRef.current = lesson && conversation
    ? JSON.stringify(['lesson', lesson.identity.lessonId, normalized(lesson.identity.normalizedDirectory), conversation.conversationId])
    : directoryConversation
      ? JSON.stringify(['directory', '', normalized((() => {
          try {
            const owner = conversationOwnerOf(directoryConversation)
            return owner.kind === 'project' ? owner.projectPath : owner.kind === 'workspace' ? owner.workspaceRoot : ''
          } catch { return workspace ?? '' }
        })()), directoryConversation.conversationId])
      : ''
  useEffect(() => { props.onActiveDirectoryConversation?.(directoryConversation) }, [directoryConversation, props.onActiveDirectoryConversation])

  useEffect(() => {
    void props.lessonOperation({ operation: 'recent-workspaces' })
      .then(async result => {
        const list = result.recent ?? []
        setRecent(list)
        // 启动默认回到上一次的工作空间；无记录或记录已失效时留在着陆页。
        let last: string | null = null
        try { last = localStorage.getItem(LAST_WORKSPACE_KEY) } catch { last = null }
        const match = last ? list.find(item => normalized(item) === normalized(last)) : undefined
        if (match) await openWorkspace(match)
      })
      .catch(reason => setError((reason as Error).message))
  }, [props.lessonOperation])
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
    try { localStorage.setItem(LAST_WORKSPACE_KEY, result.directory) } catch { /* 隐私模式等场景下无法持久化，忽略 */ }
    setWorkspace(result.directory); setStandalone(false); setSelectedDirectory(result.directory); setLessons(listing.lessons ?? []); setLesson(null); setConversation(null); setConversations([])
    setProjects([]); setDirectoryConversations([]); setDirectoryConversation(null); setActiveDirectory(null); setProjectNotice(null); setProjectFolder(null); setProjectName(''); setProjectConversationsState({})
    props.onActiveLesson?.(null, null)
    try {
      const loadedProjects = await loadProjects(result.directory)
      const loaded = await loadDirectoryConversations(result.directory, loadedProjects)
      const remembered = readRememberedConversation(result.directory)
      const restored = remembered ? findRememberedConversation(remembered, loaded.workspaceConversations, loadedProjects, loaded.projectConversations) : undefined
      if (restored) {
        setDirectoryConversation(restored.conversation)
        setActiveDirectory(restored.directory)
      } else {
        setActiveDirectory({ kind: 'workspace' })
        setDirectoryConversation([...loaded.workspaceConversations].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null)
      }
    }
    catch (reason) { setError((reason as Error).message) }
  }
  function directoryOwnerOf(target: DirectoryContext, root: string): ConversationOwner {
    return target.kind === 'workspace' ? { kind: 'workspace', workspaceRoot: normalized(root) } : { kind: 'project', workspaceRoot: normalized(root), projectPath: target.project.normalizedPath }
  }
  async function loadProjects(root?: string) {
    const directory = root ?? workspace
    if (!directory) return []
    const result = await props.lessonOperation({ operation: 'list-projects', directory })
    const loaded = result.projects ?? []
    setProjects(loaded)
    return loaded
  }
  /** V3.1：一次载入工作空间会话与每个项目各自的会话，左栏按项目分组同时展示。 */
  async function loadDirectoryConversations(directory: string, projectList: LessonProject[]) {
    const workspaceListing = await props.lessonOperation({ operation: 'list-conversations', owner: directoryOwnerOf({ kind: 'workspace' }, directory) })
    const workspaceConversations = workspaceListing.conversations ?? []
    setDirectoryConversations(workspaceConversations)
    const entries = await Promise.all(projectList.map(async project => {
      const listing = await props.lessonOperation({ operation: 'list-conversations', owner: directoryOwnerOf({ kind: 'project', project }, directory) })
      return [normalized(project.normalizedPath), listing.conversations ?? []] as const
    }))
    const projectConversations = Object.fromEntries(entries)
    setProjectConversationsState(projectConversations)
    return { workspaceConversations, projectConversations }
  }
  /** V3.1：新建项目先弹系统对话框选择文件夹位置（对话框内可直接新建文件夹），再回到内联确认条命名。 */
  async function pickProjectFolder() {
    const directory = workspace
    if (!directory) return
    const result = await props.lessonOperation({ operation: 'choose-project-directory', directory })
    if (result.cancelled || !result.directory) return
    const picked = result.directory
    const root = normalized(directory)
    const target = normalized(picked)
    if (target === root) { setError('项目文件夹不能就是工作空间根目录本身，请选择其中的文件夹'); return }
    if (!target.startsWith(`${root}/`)) { setError('项目文件夹必须位于当前工作空间内'); return }
    setProjectFolder(picked)
    setProjectName(picked.replace(/[\\/]$/, '').split(/[\\/]/).pop() || picked)
    setProjectNotice(null)
  }
  function cancelProjectPick() { setProjectFolder(null); setProjectName(''); setProjectNotice(null) }
  async function createLessonProject() {
    const directory = workspace
    if (!directory || !projectName.trim() || !projectFolder) return
    const result = await props.lessonOperation({ operation: 'create-project', directory, name: projectName.trim(), path: projectFolder })
    if (!result.project) throw new Error('项目尚未创建')
    const loaded = result.projects ?? await loadProjects(directory)
    setProjects(loaded)
    await loadDirectoryConversations(directory, loaded)
    setProjectFolder(null); setProjectName('')
    setProjectNotice(`已创建项目：${result.project.normalizedPath}`)
  }
  async function removeProject(project: LessonProject) {
    const directory = workspace
    if (!directory) return
    const result = await props.lessonOperation({ operation: 'remove-project', directory, path: project.normalizedPath })
    const remaining = result.projects ?? []
    setProjects(remaining)
    const key = normalized(project.normalizedPath)
    setProjectConversationsState(current => { const next = { ...current }; delete next[key]; return next })
    if (activeDirectory?.kind === 'project' && normalized(activeDirectory.project.normalizedPath) === key) setActiveDirectory({ kind: 'workspace' })
    if (directoryConversation) {
      try {
        const owner = conversationOwnerOf(directoryConversation)
        if (owner.kind === 'project' && normalized(owner.projectPath) === key) setDirectoryConversation(null)
      } catch { /* 身份不完整的旧记录不处理 */ }
    }
  }
  /** 设置"新对话"归属作用域；分组列表始终同时展示，不再切换目录上下文。 */
  function openDirectoryContext(target: DirectoryContext) {
    setActiveDirectory(target)
  }
  async function createDirectoryConversation(target?: DirectoryContext, title?: string) {
    const directory = workspace
    if (!directory) return
    const owner = directoryOwnerOf(target ?? activeDirectory ?? { kind: 'workspace' }, directory)
    const result = await props.lessonOperation({ operation: 'create-conversation', owner, ...(title?.trim() ? { title: title.trim() } : {}) })
    if (!result.conversation) throw new Error('对话尚未创建')
    if (owner.kind === 'project') setProjectConversationsState(current => ({ ...current, [normalized(owner.projectPath)]: [...(current[normalized(owner.projectPath)] ?? []), result.conversation!] }))
    else setDirectoryConversations(current => [...current, result.conversation!])
    setDirectoryConversation(result.conversation)
    if (current.current.lesson) {
      setLesson(null)
      setConversation(null)
      setConversations([])
      props.onActiveLesson?.(null, null)
    }
    rememberConversation(directory, result.conversation.conversationId)
    setMobilePane('chat')
  }
  function selectDirectoryConversation(next: LessonConversation) {
    setDirectoryConversation(next)
    if (workspace) rememberConversation(workspace, next.conversationId)
    if (current.current.lesson) {
      setLesson(null)
      setConversation(null)
      setConversations([])
      props.onActiveLesson?.(null, null)
    }
    // 选中哪个分组下的会话，"新对话"作用域就跟随哪个分组。
    try {
      const owner = conversationOwnerOf(next)
      if (owner.kind === 'project') {
        const project = projects.find(item => normalized(item.normalizedPath) === normalized(owner.projectPath))
        setActiveDirectory(project ? { kind: 'project', project } : { kind: 'workspace' })
      } else setActiveDirectory({ kind: 'workspace' })
    } catch { setActiveDirectory({ kind: 'workspace' }) }
    setMobilePane('chat')
  }
  /** 回到课例上下文；activeDirectory 保留，可再次进入。 */
  function clearDirectoryContext() { setDirectoryConversation(null) }
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
    setLesson(next); setConversations(available.some(item => item.conversationId === active!.conversationId) ? available : [...available, active]); setConversation(active); setDirectoryConversation(null); props.tabs.setActiveTab(next.manifest.coursePath ? 'course' : 'materials')
    props.onActiveLesson?.(next, active)
  }
  async function selectConversation(next: LessonConversation) {
    await stopAndFlush()
    if (next.projectTarget && normalized(next.projectTarget.normalizedPath) !== normalized(props.projectPath ?? '')) {
      if (!(await props.onOpenProject(next.projectTarget.normalizedPath))) return
    }
    if (!current.current.lesson) return
    setConversation(next); setDirectoryConversation(null); props.onActiveLesson?.(current.current.lesson, next)
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
        if (current.current.directoryConversation) {
          await stopAndFlush()
          if (await props.onOpenProject(entry.path)) {
            props.tabs.setActiveTab('course')
            setMobilePane('workbench')
          }
          return
        }
        const known = current.current.lessons.find(item =>
          normalized(item.identity.normalizedDirectory) === normalized(entry.path)
          || (lessonProjectPath(item) ? normalized(lessonProjectPath(item)!) === normalized(entry.path) : false))
        if (known) { await activate(known); return }
        await stopAndFlush()
        if (await props.onOpenProject(entry.path)) {
          await props.tabs.disposeDocuments()
          if (normalized(entry.path) !== normalized(props.projectPath ?? '')) detachLesson()
          props.tabs.setActiveTab('course')
        }
        return
      }
      // F04：工作空间内所有 MD 都在本软件中打开。目录会话下即使课例残留也走真实文件 ref。
      if (/\.md$/i.test(entry.name)) {
        const lesson = current.current.directoryConversation ? null : current.current.lesson
        props.tabs.openTab({ path: entry.path, name: entry.name, kind: 'document', lesson })
        setMobilePane('workbench')
        return
      }
      // 其余文件用系统默认应用打开；失败给出明确回执。
      const result = await props.lessonOperation({ operation: 'open-external', path: entry.path })
      if (result.opened === false) throw new Error(`无法用系统应用打开 ${entry.name}：${result.openError ?? '没有可用的关联程序'}`)
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
  function applyDirectoryBinding(next: LessonConversation) {
    const active = current.current.directoryConversation
    if (!active || active.conversationId !== next.conversationId) return
    setDirectoryConversation(next)
    try {
      const owner = conversationOwnerOf(next)
      if (owner.kind === 'project') {
        const key = normalized(owner.projectPath)
        setProjectConversationsState(currentConversations => ({ ...currentConversations, [key]: (currentConversations[key] ?? []).map(item => item.conversationId === next.conversationId ? next : item) }))
      } else {
        setDirectoryConversations(currentConversations => currentConversations.map(item => item.conversationId === next.conversationId ? next : item))
      }
    } catch { /* 身份不完整的旧记录只更新当前会话 */ }
  }
  return {
    state: { workspace, standalone, recent, selectedDirectory, lessons, lesson, conversations, conversation, name, creating, error, busy, treeVersion, explorerOpen, conversationsOpen, workflowOpen, mobilePane, projects, directoryConversations, projectConversations, directoryConversation, activeDirectory, projectFolder, projectName, projectNotice },
    actions: {
      run, openWorkspace, activate, selectConversation, createLesson, openFile, newStandaloneProject, detachLesson, showProject, applyBinding, applyDirectoryBinding,
      loadProjects, createLessonProject, removeProject, pickProjectFolder, cancelProjectPick, openDirectoryContext, createDirectoryConversation, selectDirectoryConversation, clearDirectoryContext,
      setSelectedDirectory, setName, setCreating, refreshTree: () => { if (workspace) { setSelectedDirectory(workspace); setTreeVersion(value => value + 1) } },
      setExplorerOpen, setConversationsOpen, setWorkflowOpen, setMobilePane,
      setConversations, setDirectoryConversations,
      setProjectConversations: (path: string, conversations: LessonConversation[]) => setProjectConversationsState(current => ({ ...current, [normalized(path)]: conversations })),
      setProjectName, setProjectNotice,
      clearConversation: () => { void props.tabs.stopDocumentEdit(); setConversation(null); props.onActiveLesson?.(null, null) },
    },
  }
}

function normalized(value: string) { return normalizeWorkspacePath(value) }
function conversationMemoryKey(root: string) { return `${LAST_WORKSPACE_KEY}:conversation:${normalized(root)}` }
function rememberConversation(root: string, conversationId: string) {
  try { localStorage.setItem(conversationMemoryKey(root), conversationId) } catch { /* 隐私模式等场景下无法持久化，忽略 */ }
}
function readRememberedConversation(root: string): string | null {
  try { return localStorage.getItem(conversationMemoryKey(root)) } catch { return null }
}
function findRememberedConversation(
  conversationId: string,
  workspaceConversations: LessonConversation[],
  projects: LessonProject[],
  projectConversations: Record<string, LessonConversation[]>,
): { conversation: LessonConversation; directory: DirectoryContext } | undefined {
  const workspaceHit = workspaceConversations.find(item => item.conversationId === conversationId)
  if (workspaceHit) return { conversation: workspaceHit, directory: { kind: 'workspace' } }
  for (const project of projects) {
    const hit = (projectConversations[normalized(project.normalizedPath)] ?? []).find(item => item.conversationId === conversationId)
    if (hit) return { conversation: hit, directory: { kind: 'project', project } }
  }
  return undefined
}
function relativeFile(lesson: LessonWorkspace, filename: string) {
  const root = lesson.identity.normalizedDirectory.replace(/[\\/]$/, '')
  return normalized(filename).startsWith(`${normalized(root)}/`) ? filename.replace(/\\/g, '/').slice(root.length + 1) : null
}
