import { isNativeProjectFilename } from '../../../shared/nativeProjectFile'
import { useEffect, useRef, useState } from 'react'
import { type LessonProject, type LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import { normalizeWorkspacePath, sameWorkspacePath } from '../../../shared/workspaceIdentity'
import { lessonProjectPath } from '../lessonConversationSelection'
import type { DocumentTabsController } from './useDocumentTabsController'

export interface LessonWorkspaceControllerProps {
  lessonOperation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  projectPath: string | null
  onBeforeWorkspaceChange?(): Promise<void>
  onOpenProject(path: string, foreground?: () => boolean): Promise<boolean>
  onNewProject(foreground?: () => boolean): Promise<boolean>
  onNewProjectFromPptx?(file: { name: string; bytes: Uint8Array }, signal?: AbortSignal, foreground?: () => boolean): Promise<boolean>
  tabs: DocumentTabsController
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
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importingCourse, setImportingCourse] = useState(false)
  const [treeVersion, setTreeVersion] = useState(0)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [mobilePane, setMobilePane] = useState<'navigation' | 'chat' | 'workbench'>('chat')
  const [projects, setProjects] = useState<LessonProject[]>([])
  const [activeDirectory, setActiveDirectory] = useState<DirectoryContext | null>(null)
  const [projectFolder, setProjectFolder] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [projectNotice, setProjectNotice] = useState<string | null>(null)
  const current = useRef({ lesson, lessons })
  current.current = { lesson, lessons }
  const workspaceGeneration = useRef(0), projectListing = useRef(0), projectPicker = useRef(0)
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace
  const actionTicket = useRef(0)
  const courseImport = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    let generation = workspaceGeneration.current
    void props.lessonOperation({ operation: 'recent-workspaces' })
      .then(async result => {
        if (!live) return
        const list = result.recent ?? []
        setRecent(list)
        // 启动默认回到上一次的工作空间；无记录或记录已失效时留在着陆页。
        let last: string | null = null
        try { last = localStorage.getItem(LAST_WORKSPACE_KEY) } catch { last = null }
        const match = last ? list.find(item => normalized(item) === normalized(last)) : undefined
        if (match && generation === workspaceGeneration.current) {
          const opening = openWorkspace(match)
          generation = workspaceGeneration.current
          await opening
        }
      })
      .catch(reason => { if (live && generation === workspaceGeneration.current) setError((reason as Error).message) })
    return () => { live = false; ++workspaceGeneration.current; props.tabs.cancelNavigation(); courseImport.current?.abort(); courseImport.current = null }
  }, [props.lessonOperation])
  async function run(action: () => Promise<void>) {
    const ticket = ++actionTicket.current
    setBusy(true); setError(null)
    try { await action() }
    catch (reason) { if (ticket === actionTicket.current && !(reason instanceof Error && reason.name === 'AbortError')) setError((reason as Error).message) }
    finally { if (ticket === actionTicket.current) setBusy(false) }
  }
  async function stopAndFlush() {
    await props.onBeforeWorkspaceChange?.()
    if (!(await props.tabs.drainAll())) throw new Error('请先在文档标签处理未保存稿或文件冲突，再切换课例。')
  }
  const captureCurrentNavigation = () => JSON.stringify([workspaceGeneration.current, props.tabs.captureNavigationIdentity()])
  function detachLesson(foreground?: () => boolean) {
    if (foreground?.() === false) return
    props.tabs.showCurrentCourse(foreground)
    setLesson(null); setStandalone(true); setMobilePane('workbench')
  }
  function showProject(foreground?: () => boolean) {
    if (foreground?.() === false) return
    props.tabs.showCurrentCourse(foreground)
    setStandalone(true)
    setMobilePane('workbench')
  }
  async function openWorkspace(directory?: string, create = false) {
    props.tabs.cancelNavigation()
    cancelNewCourseFromPptx()
    const generation = ++workspaceGeneration.current
    await stopAndFlush()
    if (generation !== workspaceGeneration.current) return
    const result = await props.lessonOperation(directory ? { operation: 'open-workspace', directory } : { operation: 'choose-workspace', create })
    if (generation !== workspaceGeneration.current || result.cancelled || !result.directory) return
    const listing = await props.lessonOperation({ operation: 'list-lessons', directory: result.directory })
    if (generation !== workspaceGeneration.current) return
    try { localStorage.setItem(LAST_WORKSPACE_KEY, result.directory) } catch { /* 隐私模式等场景下无法持久化，忽略 */ }
    workspaceRef.current = result.directory
    ++projectListing.current; ++projectPicker.current
    setWorkspace(result.directory); setStandalone(false); setSelectedDirectory(result.directory); setLessons(listing.lessons ?? []); setLesson(null)
    setProjects([]); setActiveDirectory(null); setProjectNotice(null); setProjectFolder(null); setProjectName('')
    try {
      await loadProjects(result.directory)
      if (generation !== workspaceGeneration.current) return
      // File navigation is independent of conversations. ExecutionAssistant owns
      // the current space's v2 conversations; never reopen a CLI thread here.
      setActiveDirectory({ kind: 'workspace' })
    }
    catch (reason) { if (generation === workspaceGeneration.current) setError((reason as Error).message) }
  }
  async function loadProjects(root?: string) {
    const directory = root ?? workspaceRef.current
    if (!directory) return []
    const generation = workspaceGeneration.current, ownsList = sameWorkspacePath(directory, workspaceRef.current)
    const ticket = ownsList ? ++projectListing.current : projectListing.current
    const result = await props.lessonOperation({ operation: 'list-projects', directory })
    const loaded = result.projects ?? []
    if (ownsList && generation === workspaceGeneration.current && ticket === projectListing.current && sameWorkspacePath(directory, workspaceRef.current)) setProjects(loaded)
    return loaded
  }
  /** V3.1：新建项目先弹系统对话框选择文件夹位置（对话框内可直接新建文件夹），再回到内联确认条命名。 */
  async function pickProjectFolder() {
    const directory = workspace
    if (!directory) return
    const generation = workspaceGeneration.current, ticket = ++projectPicker.current
    const result = await props.lessonOperation({ operation: 'choose-project-directory', directory })
    if (generation !== workspaceGeneration.current || ticket !== projectPicker.current || result.cancelled || !result.directory) return
    const picked = result.directory
    const root = normalized(directory)
    const target = normalized(picked)
    if (target === root) { setError('项目文件夹不能就是工作空间根目录本身，请选择其中的文件夹'); return }
    if (!target.startsWith(`${root}/`)) { setError('项目文件夹必须位于当前工作空间内'); return }
    setProjectFolder(picked)
    setProjectName(picked.replace(/[\\/]$/, '').split(/[\\/]/).pop() || picked)
    setProjectNotice(null)
  }
  function cancelProjectPick() { ++projectPicker.current; setProjectFolder(null); setProjectName(''); setProjectNotice(null) }
  async function createLessonProject() {
    const directory = workspace
    if (!directory || !projectName.trim() || !projectFolder) return
    const generation = workspaceGeneration.current, listing = ++projectListing.current
    const result = await props.lessonOperation({ operation: 'create-project', directory, name: projectName.trim(), path: projectFolder })
    if (generation !== workspaceGeneration.current) return
    if (!result.project) throw new Error('项目尚未创建')
    if (result.projects) { if (listing === projectListing.current) setProjects(result.projects) }
    else await loadProjects(directory)
    if (generation !== workspaceGeneration.current) return
    setProjectFolder(null); setProjectName('')
    setProjectNotice(`已创建项目：${result.project.normalizedPath}`)
  }
  async function removeProject(project: LessonProject) {
    const directory = workspace
    if (!directory) return
    const generation = workspaceGeneration.current, listing = ++projectListing.current
    const result = await props.lessonOperation({ operation: 'remove-project', directory, path: project.normalizedPath })
    if (generation !== workspaceGeneration.current) return
    const remaining = result.projects ?? []
    if (listing === projectListing.current) setProjects(remaining)
    const key = normalized(project.normalizedPath)
    setActiveDirectory(current => current?.kind === 'project' && normalized(current.project.normalizedPath) === key ? { kind: 'workspace' } : current)
  }
  function openDirectoryContext(target: DirectoryContext) { setActiveDirectory(target) }
  async function activate(next: LessonWorkspace) {
    props.tabs.cancelNavigation()
    const navigation = captureCurrentNavigation()
    const isCurrent = () => navigation === captureCurrentNavigation()
    await stopAndFlush()
    if (!isCurrent()) return
    const projectPath = lessonProjectPath(next)
    if (!(projectPath ? await props.onOpenProject(projectPath, isCurrent) : await props.onNewProject(isCurrent))) return
    if (!isCurrent()) return
    props.tabs.showCurrentCourse(isCurrent)
    setLesson(next); setStandalone(true); setMobilePane('workbench')
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
      const generation = workspaceGeneration.current
      if (isNativeProjectFilename(entry.name)) {
        const known = current.current.lessons.find(item =>
          normalized(item.identity.normalizedDirectory) === normalized(entry.path)
          || (lessonProjectPath(item) ? normalized(lessonProjectPath(item)!) === normalized(entry.path) : false))
        if (known) { await activate(known); return }
        props.tabs.cancelNavigation()
        const navigation = captureCurrentNavigation()
        const isCurrent = () => navigation === captureCurrentNavigation()
        await stopAndFlush()
        if (!isCurrent()) return
        if (await props.onOpenProject(entry.path, isCurrent)) {
          if (!isCurrent()) return
          if (!sameWorkspacePath(entry.path, props.projectPath)) detachLesson(isCurrent)
        }
        return
      }
      // Markdown、纯文本与 HTML 都通过同一正式文档会话打开。
      if (/\.(?:md|markdown|txt|html?)$/i.test(entry.name)) {
        const lesson = current.current.lesson
        try {
          await props.tabs.openTab({ path: entry.path, name: entry.name, kind: 'document', lesson })
        } catch (error) {
          if (generation !== workspaceGeneration.current) return
          if (!/\.txt$/i.test(entry.name) || !unsupportedTextEncoding(error)) throw error
          const result = await props.lessonOperation({ operation: 'open-external', path: entry.path })
          if (result.opened === false) throw new Error(`无法用系统应用打开 ${entry.name}：${result.openError ?? '没有可用的关联程序'}`)
          throw new Error(`${entry.name} 不是 UTF-8 编码的文本文件，已用系统程序打开`)
        }
        if (generation === workspaceGeneration.current) setMobilePane('workbench')
        return
      }
      if (/\.(?:pdf|png|jpe?g|webp|avif|gif|svg)$/i.test(entry.name)) {
        await props.tabs.openTab({ path: entry.path, name: entry.name, kind: 'media', lesson: current.current.lesson })
        if (generation === workspaceGeneration.current) setMobilePane('workbench')
        return
      }
      // 其余文件用系统默认应用打开；失败给出明确回执。
      const result = await props.lessonOperation({ operation: 'open-external', path: entry.path })
      if (result.opened === false) throw new Error(`无法用系统应用打开 ${entry.name}：${result.openError ?? '没有可用的关联程序'}`)
    })
  }
  async function newStandaloneProject() {
    props.tabs.cancelNavigation()
    const navigation = captureCurrentNavigation()
    const isCurrent = () => navigation === captureCurrentNavigation()
    await stopAndFlush()
    if (!isCurrent()) return
    if (await props.onNewProject(isCurrent) && isCurrent()) { detachLesson(isCurrent) }
  }
  async function newCourseFromPptx(file: File) {
    if (!props.onNewProjectFromPptx) throw new Error('当前界面不能从 PPT 新建 果铃工程')
    props.tabs.cancelNavigation()
    cancelNewCourseFromPptx()
    const controller = new AbortController()
    const navigation = captureCurrentNavigation()
    const isCurrent = () => navigation === captureCurrentNavigation()
    courseImport.current = controller; setImportingCourse(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      controller.signal.throwIfAborted()
      if (!isCurrent()) return false
      await stopAndFlush()
      controller.signal.throwIfAborted()
      if (!isCurrent()) return false
      const created = await props.onNewProjectFromPptx({ name: file.name, bytes }, controller.signal, isCurrent)
      controller.signal.throwIfAborted()
      if (!created || !isCurrent()) return false
      detachLesson(isCurrent)
      return created
    } finally {
      if (courseImport.current === controller) { courseImport.current = null; setImportingCourse(false) }
    }
  }
  function cancelNewCourseFromPptx() { courseImport.current?.abort(); courseImport.current = null; setImportingCourse(false) }
  return {
    state: { workspace, standalone, recent, selectedDirectory, lessons, lesson, name, creating, error, busy, importingCourse, treeVersion, explorerOpen, mobilePane, projects, activeDirectory, projectFolder, projectName, projectNotice },
    actions: {
      captureNavigationIdentity: () => String(workspaceGeneration.current),
      newCourse: newStandaloneProject, newCourseFromPptx, cancelNewCourseFromPptx, run, openWorkspace, activate, createLesson, openFile, newStandaloneProject, detachLesson, showProject,
      loadProjects, createLessonProject, removeProject, pickProjectFolder, cancelProjectPick, openDirectoryContext,
      setSelectedDirectory, setName, setCreating, refreshTree: () => { if (workspace) { setSelectedDirectory(workspace); setTreeVersion(value => value + 1) } },
      setExplorerOpen, setMobilePane,
      setProjectName, setProjectNotice,
    },
  }
}

function unsupportedTextEncoding(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'DesktopAPIError:TEXT_ENCODING_UNSUPPORTED') return true
  return 'code' in error && (error as { code?: unknown }).code === 'TEXT_ENCODING_UNSUPPORTED'
}

function normalized(value: string) { return normalizeWorkspacePath(value) }
