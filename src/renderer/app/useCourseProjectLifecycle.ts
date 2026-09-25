import type { DocumentSnapshot } from '../../shared/workbench/document'
import { useCallback, useEffect, useRef, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type {
  OpenProjectFileResult,
  RecentProjectEntry,
  RecoveryProjectResult,
} from '../../shared/ipcTypes'
export interface CanonicalCourseProjectSnapshot {
  readonly project: CourseProjectDocument
  readonly assetFiles: Record<string, Uint8Array>
  readonly componentPackages: Record<string, ComponentPackageData>
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
  readonly sessionGeneration: number
  readonly epoch: number
}

export interface CourseProjectOpenedLoad {
  readonly project: CourseProjectDocument
  readonly path: string | null
  readonly assetFiles: Record<string, Uint8Array>
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly dirty?: boolean
  readonly statusMessage?: string
}

export interface CourseProjectLifecyclePorts<TDraftToken = unknown> {
  documents?: {
    ready(): Promise<void>
    snapshot(): DocumentSnapshot | null
    create(surface: 'slide' | 'flow' | 'spatial'): Promise<void>
    open(path: string): Promise<void>
    save(saveAs?: boolean): Promise<DocumentSnapshot | null>
    drain(): Promise<DocumentSnapshot>
  }
  captureIdentity(): Omit<CourseProjectLifecycleIdentity, 'epoch'>
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
  onProjectReplaced?(): void
  preserveBeforeClose?(mode?: 'save' | 'preserve'): Promise<boolean>
  subscribePreserveAndCloseRequest?(handler: () => Promise<boolean>): () => void
  onProjectSaved?(input: { projectId: string; path: string; previousPath: string | null; saveAs: boolean }): Promise<void>
  listRecentProjects(): Promise<RecentProjectEntry[]>
  confirmDiscardChanges(): Promise<'discard' | 'cancel'>
  clearRecoveryProject?(): Promise<void>
  writeRecoveryProject?(input: {
    projectName: string
    projectPath?: string
    bytes: Uint8Array
  }): Promise<void>
  readRecoveryProject?(): Promise<RecoveryProjectResult | null>
  peekProjectArchive?(path: string): Promise<{ bytes: Uint8Array } | null>
  setWindowDirtyState(dirty: boolean): Promise<void>
  subscribeSaveAndCloseRequest(handler: () => Promise<boolean>): () => void
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
export interface CourseProjectReplacementOptions extends CourseProjectOperationOptions { readonly origin?: 'lesson' | 'standalone' }

export interface CourseProjectLifecycleApi {
  readonly recentProjects: RecentProjectEntry[]
  newProject(options?: CourseProjectReplacementOptions): Promise<boolean>
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
    return before.projectId === now.projectId && before.revision === now.revision && before.sessionGeneration === now.sessionGeneration
  }
  const replace = useCallback(async (work: () => Promise<void>, options?: CourseProjectReplacementOptions): Promise<boolean> => {
    const result = await ref.current.runBusy(async () => {
      await service().ready()
      if (options?.isCurrent?.() === false) return false
      const identity = service().snapshot()
      const sameDocument = () => {
        const now = service().snapshot()
        return identity ? now?.documentId === identity.documentId && now.epoch === identity.epoch : !now
      }
      if (ref.current.beforeReplace && !(await ref.current.beforeReplace())) return false
      // Switching views retains the previous main-owned document and its History.
      // Only unfinished renderer input needs admission; nothing is discarded here.
      if (!sameDocument() || options?.isCurrent?.() === false) return false
      if (identity) await service().drain()
      if (!sameDocument() || options?.isCurrent?.() === false) return false
      const epoch = ++replacement.current
      await work()
      if (epoch !== replacement.current || options?.isCurrent?.() === false) return false
      if (options?.origin !== 'lesson') ref.current.onProjectReplaced?.()
      await refresh()
      return true
    }, '课件切换失败，当前修改仍保留。')
    return result === true
  }, [refresh])
  const newProject = useCallback((options?: CourseProjectReplacementOptions) => replace(() => service().create('slide'), options), [replace])
  const newFlowProject = useCallback((options?: CourseProjectReplacementOptions) => replace(() => service().create('flow'), options), [replace])
  const newSpatialProject = useCallback((options?: CourseProjectReplacementOptions) => replace(() => service().create('spatial'), options), [replace])
  const openProject = useCallback(() => { void replace(async () => {
    const identity = ref.current.captureIdentity()
    const file = await ref.current.openProjectFile()
    if (!file) return
    if (!same(identity)) throw new Error('选择文件期间课件已改变，已取消打开')
    await service().open(file.path)
    await ref.current.confirmProjectOpen(file.confirmationId)
  }) }, [replace])
  const openRecentProject = useCallback((path: string, options?: CourseProjectReplacementOptions) => replace(() => service().open(path), options), [replace])
  const saveProject = useCallback(async (saveAs = false, options?: CourseProjectOperationOptions): Promise<boolean> => {
    if (saving.current || options?.isCurrent?.() === false) return false
    saving.current = true
    try {
      const result = await ref.current.runBusy(async () => {
        await service().ready()
        if (ref.current.beforeSave && !(await ref.current.beforeSave())) return false
        if (options?.isCurrent?.() === false) return false
        const snapshot = service().snapshot(), previousPath = ref.current.projectPath()
        const saved = await service().save(saveAs)
        if (!saved || !snapshot || saved.documentId !== snapshot.documentId || options?.isCurrent?.() === false) return false
        if (saved.binding.kind !== 'file') return false
        const current = service().snapshot()
        if (current?.documentId !== saved.documentId) return false
        await ref.current.onProjectSaved?.({ projectId: saved.model.kind === 'course-v9' ? saved.model.project.id : '', path: saved.binding.path, previousPath, saveAs })
        const allSaved = !current.dirty && !ref.current.hasUnsavedChanges()
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
    document.title = `${watch.projectTitle}${watch.dirty ? ' *' : ''} - ${APP_NAME}`
    if (ref.current.desktopAvailable()) void ref.current.setWindowDirtyState(watch.dirty).catch(() => undefined)
  }, [watch.dirty, watch.projectTitle])
  const prepareBeforeClose = useCallback(async (mode: 'save' | 'preserve'): Promise<boolean> => {
    try { if (service().snapshot()) await service().drain(); return await (ref.current.preserveBeforeClose?.(mode) ?? Promise.resolve(true)) }
    catch (error) { ref.current.reportError(error instanceof Error ? error.message : '输入未确认，已取消关闭'); return false }
  }, [])
  useEffect(() => ref.current.desktopAvailable() ? ref.current.subscribeSaveAndCloseRequest(() => prepareBeforeClose('save')) : undefined, [prepareBeforeClose])
  useEffect(() => ref.current.desktopAvailable() ? ref.current.subscribePreserveAndCloseRequest?.(() => prepareBeforeClose('preserve')) : undefined, [prepareBeforeClose])
  return { recentProjects, newProject, newFlowProject, newSpatialProject, openProject, openRecentProject, saveProject }
}
