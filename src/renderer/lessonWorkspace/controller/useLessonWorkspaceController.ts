import { useEffect, useRef, useState } from 'react'
import { type LessonProject, type LessonWorkspace } from '../../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult, LessonDirectoryEntry } from '../../../shared/lessonDesktopContract'
import { normalizeWorkspacePath, sameWorkspacePath } from '../../../shared/workspaceIdentity'
import { lessonProjectPath } from '../lessonConversationSelection'
import type { DocumentTabsController } from './useDocumentTabsController'

export interface LessonWorkspaceControllerProps {
  lessonOperation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  projectPath: string | null
  onOpenProject(path: string): Promise<boolean>
  onNewProject(): Promise<boolean>
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
    if (!(await props.tabs.drainAll())) throw new Error('请先在文档标签处理未保存稿或文件冲突，再切换课例。')
  }
  function detachLesson() {
    setLesson(null); setStandalone(true); setMobilePane('workbench')
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
    try { localStorage.setItem(LAST_WORKSPACE_KEY, result.directory) } catch { /* 隐私模式等场景下无法持久化，忽略 */ }
    setWorkspace(result.directory); setStandalone(false); setSelectedDirectory(result.directory); setLessons(listing.lessons ?? []); setLesson(null)
    setProjects([]); setActiveDirectory(null); setProjectNotice(null); setProjectFolder(null); setProjectName('')
    try {
      await loadProjects(result.directory)
      // File navigation is independent of conversations. ExecutionAssistant owns
      // the current space's v2 conversations; never reopen a CLI thread here.
      setActiveDirectory({ kind: 'workspace' })
    }
    catch (reason) { setError((reason as Error).message) }
  }
  async function loadProjects(root?: string) {
    const directory = root ?? workspace
    if (!directory) return []
    const result = await props.lessonOperation({ operation: 'list-projects', directory })
    const loaded = result.projects ?? []
    setProjects(loaded)
    return loaded
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
    if (activeDirectory?.kind === 'project' && normalized(activeDirectory.project.normalizedPath) === key) setActiveDirectory({ kind: 'workspace' })
  }
  function openDirectoryContext(target: DirectoryContext) { setActiveDirectory(target) }
  async function activate(next: LessonWorkspace) {
    await stopAndFlush()
    const projectPath = lessonProjectPath(next)
    if (!(projectPath ? await props.onOpenProject(projectPath) : await props.onNewProject())) return
    setLesson(next); setStandalone(true); setMobilePane('workbench'); props.tabs.setActiveTab('course')
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
        const known = current.current.lessons.find(item =>
          normalized(item.identity.normalizedDirectory) === normalized(entry.path)
          || (lessonProjectPath(item) ? normalized(lessonProjectPath(item)!) === normalized(entry.path) : false))
        if (known) { await activate(known); return }
        await stopAndFlush()
        if (await props.onOpenProject(entry.path)) {
          if (!sameWorkspacePath(entry.path, props.projectPath)) detachLesson()
        }
        return
      }
      // 工作空间内所有 Markdown 均通过同一正式文档会话打开。
      if (/\.(?:md|markdown)$/i.test(entry.name)) {
        const lesson = current.current.lesson
        await props.tabs.openTab({ path: entry.path, name: entry.name, kind: 'document', lesson })
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
    if (await props.onNewProject()) { detachLesson() }
  }
  return {
    state: { workspace, standalone, recent, selectedDirectory, lessons, lesson, name, creating, error, busy, treeVersion, explorerOpen, mobilePane, projects, activeDirectory, projectFolder, projectName, projectNotice },
    actions: {
      newCourse: newStandaloneProject, run, openWorkspace, activate, createLesson, openFile, newStandaloneProject, detachLesson, showProject,
      loadProjects, createLessonProject, removeProject, pickProjectFolder, cancelProjectPick, openDirectoryContext,
      setSelectedDirectory, setName, setCreating, refreshTree: () => { if (workspace) { setSelectedDirectory(workspace); setTreeVersion(value => value + 1) } },
      setExplorerOpen, setMobilePane,
      setProjectName, setProjectNotice,
    },
  }
}

function normalized(value: string) { return normalizeWorkspacePath(value) }
