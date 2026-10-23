import type { DocumentSnapshot } from '../../shared/workbench/document'
import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { SlideCanvasSize } from '../../shared/slideCanvas'
import type { CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../shared/workbench/document'
import type {
  OpenProjectFileResult,
  RecentProjectEntry,
  RecoveryProjectResult,
} from '../../shared/ipcTypes'

/** Renderer-only adapter: preserve completed writes while expiring only their old foreground intent. */
export function adaptCourseDocumentActivation(result: void | boolean | { documentId: string; activated: boolean },
  activateIf?: () => boolean, cancelNavigation?: () => void): void | boolean {
  if (result && typeof result === 'object' && !result.activated && activateIf?.()) cancelNavigation?.()
  return typeof result === 'boolean' ? result : undefined
}
export interface CanonicalCourseProjectSnapshot {
  readonly project: CourseProjectV10
  readonly resources: DocumentResources
}

export type CourseProjectDraftPreparation<TToken> =
  | {
      readonly ok: true
      readonly snapshot: CanonicalCourseProjectSnapshot
      readonly token: TToken
    }
  | {
      readonly ok: false
      readonly reason: string
    }

export type CourseProjectRecoveryCapture =
  | {
      readonly ok: true
      readonly snapshot: CanonicalCourseProjectSnapshot
    }
  | {
      readonly ok: false
      readonly reason: string
    }

/**
 * Identity captured when a lifecycle operation starts.
 * Late load/save/recovery results compare this before any document write.
 */
export interface CourseProjectLifecycleIdentity {
  readonly projectId: string
  readonly revision: number
  readonly documentId: string
  readonly epoch: string
}

export interface CourseProjectOpenedLoad {
  readonly project: CourseProjectV10
  readonly path: string | null
  readonly resources: DocumentResources
  readonly dirty?: boolean
  readonly statusMessage?: string
}

/** The content of a course that does not exist yet as a document. */
export interface CourseProjectContent {
  project: CourseProjectV10
  resources: DocumentResources
}

export interface CourseProjectLifecyclePorts<TDraftToken = unknown> {
  documents?: {
    ready(): Promise<void>
    snapshot(documentId?: string): DocumentSnapshot | null
    create(surface: 'slide' | 'flow' | 'spatial', canvas?: SlideCanvasSize, activateIf?: () => boolean): Promise<void | boolean>
    /** A new untitled course with given content, e.g. made from a PPT (M21). */
    createFrom?(content: CourseProjectContent, activateIf?: () => boolean): Promise<void | boolean>
    open(path: string, activateIf?: () => boolean): Promise<void | boolean>
    save(saveAs?: boolean, documentId?: string): Promise<DocumentSnapshot | null>
    drain(): Promise<DocumentSnapshot>
    /** Settles already admitted operations while raw recovery input stays local. */
    settle?(): Promise<DocumentSnapshot>
  }
  captureIdentity(): CourseProjectLifecycleIdentity
  prepareDraft?(): CourseProjectDraftPreparation<TDraftToken>
  acknowledgeSaved?(path: string, token: TDraftToken): boolean
  captureRecoverySnapshot?(): CourseProjectRecoveryCapture
  loadOpenedProject?(input: CourseProjectOpenedLoad): void
  createBlankProject?(): void
  createSpatialProject?(): void
  createFlowProject?(): void
  hasUnsavedChanges(): boolean
  projectPath(): string | null
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
  desktopAvailable(): boolean
  openProjectFile(): Promise<OpenProjectFileResult | null>
  openWorkspaceProjectFile?(path: string): Promise<OpenProjectFileResult>
  openRecentProjectFile(path: string): Promise<OpenProjectFileResult>
  confirmProjectOpen(confirmationId: string): Promise<void>
  saveProjectFile?(input: {
    path?: string
    suggestedName: string
    bytes: Uint8Array
  }): Promise<{ path: string } | null>
  beforeSave?(): Promise<boolean>
  beforeReplace?(): Promise<boolean>
  /** Claims this explicit UI request through the existing navigation owner. */
  beginForeground?(): () => boolean
  onProjectReplaced?(foreground?: () => boolean): void
  /** A local authoring owner may retain input that has not entered DocumentSession. */
  prepareBeforeClose?(mode?: 'save' | 'preserve', documentIds?: readonly string[]): boolean | Promise<boolean>
  preserveBeforeClose?(mode?: 'save' | 'preserve', documentIds?: readonly string[]): Promise<boolean>
  subscribePreserveAndCloseRequest?(handler: (documentIds?: readonly string[]) => Promise<boolean>): () => void
  onProjectSaved?(input: { projectId: string; path: string; previousPath: string | null; saveAs: boolean }): Promise<void>
  listRecentProjects(): Promise<RecentProjectEntry[]>
  clearRecoveryProject?(): Promise<void>
  writeRecoveryProject?(input: {
    projectName: string
    projectPath?: string
    bytes: Uint8Array
  }): Promise<void>
  readRecoveryProject?(): Promise<RecoveryProjectResult | null>
  peekProjectArchive?(path: string): Promise<{ bytes: Uint8Array } | null>
  setWindowDirtyState(dirty: boolean): Promise<void>
  subscribeSaveAndCloseRequest(handler: (documentIds?: readonly string[]) => Promise<boolean>): () => void
}

export interface CourseProjectLifecycleWatch {
  readonly dirty: boolean
  readonly projectTitle: string
  readonly projectPath: string | null
  readonly documentTrigger: unknown
  readonly sidecarTrigger: unknown
  readonly componentPackagesTrigger: unknown
  readonly slideDraftTrigger: unknown
  readonly spatialDraftTrigger: unknown
  readonly flowDraftTrigger: unknown
  readonly textEditTrigger: unknown
}

export interface CourseProjectOperationOptions { readonly isCurrent?: () => boolean }
export interface CourseProjectReplacementOptions extends CourseProjectOperationOptions {
  readonly origin?: 'lesson' | 'standalone'
  readonly canvas?: SlideCanvasSize
  /** A caller that already claimed navigation supplies the same live predicate. */
  readonly foreground?: () => boolean
}

export interface CourseProjectLifecycleApi {
  readonly recentProjects: RecentProjectEntry[]
  newProject(options?: CourseProjectReplacementOptions): Promise<boolean>
  /** A new untitled course whose content `make` builds first (it may fail, e.g. on an unreadable PPT). */
  newProjectFrom(make: () => Promise<CourseProjectContent>, options?: CourseProjectReplacementOptions): Promise<boolean>
  newSpatialProject(options?: CourseProjectReplacementOptions): Promise<boolean>
  newFlowProject(options?: CourseProjectReplacementOptions): Promise<boolean>
  openProject(): void
  openRecentProject(path: string, options?: CourseProjectReplacementOptions): Promise<boolean>
  saveProject(saveAs?: boolean, options?: CourseProjectOperationOptions): Promise<boolean>
}

/** Main owns content, file binding, fixed-revision save and durable recovery. */
export function useCourseProjectLifecycle<TDraftToken>(ports: CourseProjectLifecyclePorts<TDraftToken>, watch: CourseProjectLifecycleWatch): CourseProjectLifecycleApi {
  const ref = useRef(ports); ref.current = ports
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])
  const saving = useRef(false), replacement = useRef(0)
  const service = () => { const value = ref.current.documents; if (!value) throw new Error('课程文档服务未接通'); return value }
  const refresh = useCallback(async () => { try { setRecentProjects(await ref.current.listRecentProjects()) } catch { ref.current.reportError('最近工程列表暂不可读取') } }, [])
  const same = (before: ReturnType<typeof ports.captureIdentity>) => {
    const now = ref.current.captureIdentity()
    return before.projectId === now.projectId && before.revision === now.revision && before.documentId === now.documentId && before.epoch === now.epoch
  }
  const replace = useCallback(async (work: (isCurrent: () => boolean) => Promise<void | boolean>, options?: CourseProjectReplacementOptions): Promise<boolean> => {
    const foreground = options?.foreground ?? ref.current.beginForeground?.()
    const isCurrent = () => options?.isCurrent?.() !== false && foreground?.() !== false
    const result = await ref.current.runBusy(async () => {
      await service().ready()
      if (!isCurrent()) return false
      const identity = service().snapshot()
      const sameDocument = () => {
        const now = service().snapshot()
        return identity ? now?.documentId === identity.documentId && now.epoch === identity.epoch : !now
      }
      if (ref.current.beforeReplace && !(await ref.current.beforeReplace())) return false
      // Switching views retains the previous main-owned document and its History.
      // Only unfinished renderer input needs admission; nothing is discarded here.
      if (!sameDocument() || !isCurrent()) return false
      if (identity) await (service().settle?.() ?? service().drain())
      if (!sameDocument() || !isCurrent()) return false
      const epoch = ++replacement.current
      if (await work(isCurrent) === false) return false
      // A completed writer remains completed. Only its foreground effect expires.
      if (epoch === replacement.current && isCurrent() && options?.origin !== 'lesson') ref.current.onProjectReplaced?.(isCurrent)
      await refresh()
      return true
    }, '切换失败，当前修改仍保留。')
    return result === true
  }, [refresh])
  const newProject = useCallback((options?: CourseProjectReplacementOptions) => replace(isCurrent => service().create('slide', options?.canvas, isCurrent), options), [replace])
  const newProjectFrom = useCallback((make: () => Promise<CourseProjectContent>, options?: CourseProjectReplacementOptions) => replace(async isCurrent => {
    const content = await make()
    if (!isCurrent()) return false
    const create = service().createFrom
    if (!create) throw new Error('当前界面不能从已有内容新建 果铃工程')
    return create(content, isCurrent)
  }, options), [replace])
  const newFlowProject = useCallback((options?: CourseProjectReplacementOptions) => replace(isCurrent => service().create('flow', undefined, isCurrent), options), [replace])
  const newSpatialProject = useCallback((options?: CourseProjectReplacementOptions) => replace(isCurrent => service().create('spatial', undefined, isCurrent), options), [replace])
  const openProject = useCallback(() => { void replace(async isCurrent => {
    const identity = ref.current.captureIdentity()
    const file = await ref.current.openProjectFile()
    if (!file || !isCurrent()) return false
    if (!same(identity)) throw new Error('选择文件期间文档已改变，已取消打开')
    if (await service().open(file.path, isCurrent) === false) return false
    try { await ref.current.confirmProjectOpen(file.confirmationId) }
    catch (error) {
      if (isCurrent()) ref.current.commitStatus(`工程已打开，可继续编辑；最近工程记录确认失败，请稍后重新打开：${error instanceof Error ? error.message : String(error)}`)
    }
  }) }, [replace])
  const openRecentProject = useCallback((path: string, options?: CourseProjectReplacementOptions) => replace(isCurrent => service().open(path, isCurrent), options), [replace])
  const saveProject = useCallback(async (saveAs = false, options?: CourseProjectOperationOptions): Promise<boolean> => {
    if (saving.current || options?.isCurrent?.() === false) return false
    // The action queue may wait while the user selects another course. Retain
    // the clicked session, but allow its drafts and newer edits to enter Save.
    const target = service().snapshot()
    if (!target) return false
    saving.current = true
    try {
      const result = await ref.current.runBusy(async () => {
        await service().ready()
        const original = service().snapshot(target.documentId)
        if (!original || original.epoch !== target.epoch) throw new Error('原课件会话已关闭，已取消保存')
        if (ref.current.beforeSave && !(await ref.current.beforeSave())) return false
        if (options?.isCurrent?.() === false) return false
        const snapshot = service().snapshot(target.documentId)
        if (!snapshot || snapshot.epoch !== target.epoch) throw new Error('原课件会话已关闭，已取消保存')
        const previousPath = snapshot.binding.kind === 'file' ? snapshot.binding.path : null
        const saved = await service().save(saveAs, target.documentId)
        if (!saved || saved.documentId !== target.documentId || options?.isCurrent?.() === false) return false
        if (saved.binding.kind !== 'file') return false
        const current = service().snapshot()
        if (current?.documentId !== saved.documentId || current.epoch !== snapshot.epoch || saved.epoch !== snapshot.epoch) return false
        await ref.current.onProjectSaved?.({ projectId: saved.model.kind === 'course-v10' ? saved.model.project.id : '', path: saved.binding.path, previousPath, saveAs })
        const allSaved = !saved.dirty && !current.dirty && !ref.current.hasUnsavedChanges()
        ref.current.commitStatus(allSaved ? `已保存到 ${saved.binding.path}` : '已保存启动保存时的版本；后续修改尚未保存')
        await refresh()
        return allSaved
      }, '保存失败，请检查磁盘或另存为。')
      return result === true
    } finally { saving.current = false }
  }, [refresh])
  useEffect(() => {
    if (ref.current.desktopAvailable()) void service().ready().then(async () => {
      await refresh()
    }).catch(error => ref.current.reportError(error instanceof Error ? error.message : '文档服务无法连接'))
  }, [refresh])
  useEffect(() => {
    document.title = APP_NAME
    if (ref.current.desktopAvailable()) void ref.current.setWindowDirtyState(watch.dirty).catch(() => undefined)
  }, [watch.dirty, watch.projectTitle])
  const prepareBeforeClose = useCallback(async (mode: 'save' | 'preserve', documentIds?: readonly string[]): Promise<boolean> => {
    try {
      if (!(await (ref.current.preserveBeforeClose?.(mode, documentIds) ?? Promise.resolve(true)))) return false
      // Sidecar/card inputs settle first; then their course owner prepares the
      // resulting input once. Main reads authority and performs the final CAS.
      return await ref.current.prepareBeforeClose?.(mode, documentIds) !== false
    }
    catch (error) { ref.current.reportError(error instanceof Error ? error.message : '输入未确认，已取消关闭'); return false }
  }, [])
  useEffect(() => ref.current.desktopAvailable() ? ref.current.subscribeSaveAndCloseRequest(ids => prepareBeforeClose('save', ids)) : undefined, [prepareBeforeClose])
  useEffect(() => ref.current.desktopAvailable() ? ref.current.subscribePreserveAndCloseRequest?.(ids => prepareBeforeClose('preserve', ids)) : undefined, [prepareBeforeClose])
  return { recentProjects, newProject, newProjectFrom, newFlowProject, newSpatialProject, openProject, openRecentProject, saveProject }
}
