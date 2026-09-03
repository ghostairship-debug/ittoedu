import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { toUserMessage, UserFacingError } from '../../shared/errors'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type {
  OpenProjectFileResult,
  RecentProjectEntry,
  RecoveryProjectResult,
} from '../../shared/ipcTypes'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from '../components/componentPackageStore'
import {
  inspectCourseProjectArchiveIdentity,
  type CourseProjectArchiveData,
} from '../project/courseProjectArchive'
import {
  openDefaultCourseProjectAsync,
  saveCourseProjectDocumentAsync,
} from '../project/courseProjectIo'
import { shouldOfferCourseProjectRecovery } from '../project/courseProjectLifecycle'
import { RecoveryWriteCoordinator } from '../project/recoveryWriteCoordinator'

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
  captureIdentity(): Omit<CourseProjectLifecycleIdentity, 'epoch'>
  prepareDraft(): CourseProjectDraftPreparation<TDraftToken>
  acknowledgeSaved(path: string, token: TDraftToken): boolean
  captureRecoverySnapshot(): CourseProjectRecoveryCapture
  loadOpenedProject(input: CourseProjectOpenedLoad): void
  createBlankProject(): void
  createSpatialProject(): void
  createFlowProject(): void
  hasUnsavedChanges(): boolean
  projectPath(): string | null
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
  desktopAvailable(): boolean
  openProjectFile(): Promise<OpenProjectFileResult | null>
  openRecentProjectFile(path: string): Promise<OpenProjectFileResult>
  confirmProjectOpen(confirmationId: string): Promise<void>
  saveProjectFile(input: {
    path?: string
    suggestedName: string
    bytes: Uint8Array
  }): Promise<{ path: string } | null>
  listRecentProjects(): Promise<RecentProjectEntry[]>
  confirmDiscardChanges(): Promise<'discard' | 'cancel'>
  clearRecoveryProject(): Promise<void>
  writeRecoveryProject(input: {
    projectName: string
    projectPath?: string
    bytes: Uint8Array
  }): Promise<void>
  readRecoveryProject(): Promise<RecoveryProjectResult | null>
  peekProjectArchive(path: string): Promise<{ bytes: Uint8Array } | null>
  setWindowDirtyState(dirty: boolean): Promise<void>
  subscribeSaveRequest(handler: () => void): () => void
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

export interface CourseProjectLifecycleApi {
  readonly recentProjects: RecentProjectEntry[]
  readonly recoveryOffer: RecoveryProjectResult | null
  newProject(): void
  newSpatialProject(): void
  newFlowProject(): void
  openProject(): void
  openRecentProject(path: string): void
  saveProject(saveAs?: boolean): Promise<boolean>
  restoreRecovery(): void
  discardRecovery(): void
}

interface RecoverySnapshot {
  identity: CourseProjectLifecycleIdentity
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
  componentPackages: Record<string, ComponentPackageData>
  projectPath: string | null
  title: string
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) {
    console.error(error)
    return `${error.title}：${error.message}\n${error.suggestion}`
  }
  if (error instanceof Error && error.message.trim()) {
    console.error(error)
    return error.message
  }
  return toUserMessage(error, fallback)
}

function sameProjectIdentity(
  expected: CourseProjectLifecycleIdentity,
  current: CourseProjectLifecycleIdentity,
): boolean {
  return expected.projectId === current.projectId && expected.epoch === current.epoch
}

function courseArchiveDataFromSnapshot(
  snapshot: CanonicalCourseProjectSnapshot,
): CourseProjectArchiveData {
  return {
    project: snapshot.project,
    assetFiles: snapshot.assetFiles,
    componentFiles: componentPackagesToArchiveFiles(snapshot.componentPackages),
  }
}

function createRecoveryWriteCoordinator(
  portsRef: { current: CourseProjectLifecyclePorts<unknown> },
  captureIdentity: () => CourseProjectLifecycleIdentity,
): RecoveryWriteCoordinator<RecoverySnapshot, Uint8Array> {
  return new RecoveryWriteCoordinator({
    delayMs: 1800,
    async build(snapshot, signal) {
      return saveCourseProjectDocumentAsync({
        project: snapshot.project,
        assetFiles: snapshot.assetFiles,
        componentFiles: componentPackagesToArchiveFiles(
          snapshot.componentPackages,
        ),
      }, { signal })
    },
    async write(bytes, snapshot) {
      const ports = portsRef.current
      if (!ports.desktopAvailable()) throw new Error('桌面恢复服务不可用。')
      if (!sameProjectIdentity(snapshot.identity, captureIdentity())) {
        throw new DOMException('已取消', 'AbortError')
      }
      await ports.writeRecoveryProject({
        projectName: snapshot.title,
        projectPath: snapshot.projectPath ?? undefined,
        bytes,
      })
    },
    onSuccess() {
      portsRef.current.commitStatus('已自动保存本地恢复副本')
    },
    onError(error) {
      console.error('本地恢复副本更新失败', error)
      portsRef.current.reportError('自动恢复副本写入失败，请立即手动保存工程。')
    },
  })
}

export function useCourseProjectLifecycle<TDraftToken>(
  ports: CourseProjectLifecyclePorts<TDraftToken>,
  watch: CourseProjectLifecycleWatch,
): CourseProjectLifecycleApi {
  const portsRef = useRef(ports)
  portsRef.current = ports

  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryProjectResult | null>(null)
  const [recoveryDecisionComplete, setRecoveryDecisionComplete] = useState(false)
  const saveInFlightRef = useRef(false)
  const loadEpochRef = useRef(0)
  const captureIdentity = (): CourseProjectLifecycleIdentity => ({
    ...portsRef.current.captureIdentity(),
    epoch: loadEpochRef.current,
  })
  const recoveryRevisionRef = useRef(0)
  const recoveryOfferRef = useRef<RecoveryProjectResult | null>(null)
  recoveryOfferRef.current = recoveryOffer
  const recoveryCoordinatorRef = useRef<RecoveryWriteCoordinator<
    RecoverySnapshot,
    Uint8Array
  > | null>(null)
  if (recoveryCoordinatorRef.current === null && ports.desktopAvailable()) {
    recoveryCoordinatorRef.current = createRecoveryWriteCoordinator(
      portsRef as { current: CourseProjectLifecyclePorts<unknown> },
      captureIdentity,
    )
  }

  const beginMutation = (): number => {
    loadEpochRef.current += 1
    return loadEpochRef.current
  }

  const isCurrentMutation = (epoch: number): boolean => loadEpochRef.current === epoch

  const refreshRecentProjects = useCallback(async () => {
    if (!portsRef.current.desktopAvailable()) return
    setRecentProjects(await portsRef.current.listRecentProjects())
  }, [])

  const confirmDiscardIfNeeded = useCallback(async () => {
    if (!portsRef.current.hasUnsavedChanges()) return true
    return (await portsRef.current.confirmDiscardChanges()) === 'discard'
  }, [])

  const applyCourseArchive = useCallback((
    archive: CourseProjectArchiveData,
    path: string | null,
    extra?: { dirty?: boolean; statusMessage?: string },
    started?: CourseProjectLifecycleIdentity,
    epoch?: number,
  ): boolean => {
    if (epoch !== undefined && !isCurrentMutation(epoch)) return false
    const current = captureIdentity()
    if (started && !sameProjectIdentity(started, current)) return false
    const packages = componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    )
    portsRef.current.loadOpenedProject({
      project: archive.project,
      path,
      assetFiles: archive.assetFiles,
      componentPackages: packages,
      dirty: extra?.dirty,
      statusMessage: extra?.statusMessage,
    })
    return true
  }, [])

  const ingestOpenedCourseBytes = useCallback(async (
    bytes: Uint8Array,
    path: string | null,
    extra?: { dirty?: boolean; statusMessage?: string },
    epoch?: number,
  ): Promise<boolean> => {
    const started = captureIdentity()
    const archive = await openDefaultCourseProjectAsync(bytes)
    return applyCourseArchive(archive, path, extra, started, epoch)
  }, [applyCourseArchive])

  const ingestOpenedProjectFile = useCallback(async (
    file: OpenProjectFileResult,
    epoch: number,
  ): Promise<boolean> => {
    const applied = await ingestOpenedCourseBytes(file.bytes, file.path, undefined, epoch)
    if (!applied) return false
    await portsRef.current.confirmProjectOpen(file.confirmationId).catch((error) => {
      console.error('确认最近工程失败', error)
    })
    return true
  }, [ingestOpenedCourseBytes])

  const newProject = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const epoch = beginMutation()
      await portsRef.current.clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      if (!isCurrentMutation(epoch)) return
      portsRef.current.createBlankProject()
    }, '新建课件失败，请重试。')
  }, [confirmDiscardIfNeeded])

  const newSpatialProject = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const epoch = beginMutation()
      await portsRef.current.clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      if (!isCurrentMutation(epoch)) return
      portsRef.current.createSpatialProject()
    }, '新建无限画布课件失败，请重试。')
  }, [confirmDiscardIfNeeded])

  const newFlowProject = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const epoch = beginMutation()
      await portsRef.current.clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      if (!isCurrentMutation(epoch)) return
      portsRef.current.createFlowProject()
    }, '新建流式讲义课件失败，请重试。')
  }, [confirmDiscardIfNeeded])

  const openProject = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const file = await portsRef.current.openProjectFile()
      if (!file) return
      const epoch = beginMutation()
      const applied = await ingestOpenedProjectFile(file, epoch)
      if (!applied) return
      await portsRef.current.clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      await refreshRecentProjects()
    }, '打开工程失败。请检查文件是否损坏后重试。')
  }, [confirmDiscardIfNeeded, ingestOpenedProjectFile, refreshRecentProjects])

  const openRecentProject = useCallback((path: string) => {
    void portsRef.current.runBusy(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const file = await portsRef.current.openRecentProjectFile(path)
      const epoch = beginMutation()
      const applied = await ingestOpenedProjectFile(file, epoch)
      if (!applied) return
      await portsRef.current.clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      await refreshRecentProjects()
    }, '最近工程打开失败。文件可能已被移动，请使用“打开工程”重新选择。')
  }, [confirmDiscardIfNeeded, ingestOpenedProjectFile, refreshRecentProjects])

  const saveProject = useCallback(
    async (saveAs = false) => {
      if (saveInFlightRef.current) return false
      saveInFlightRef.current = true
      let savedCurrentRevision = false
      try {
        await portsRef.current.runBusy(async () => {
          const preparation = portsRef.current.prepareDraft()
          if (!preparation.ok) {
            throw new UserFacingError(
              '无法保存当前文字草稿',
              preparation.reason,
              '请结束输入法组合或重新选择有效文字后再保存。',
            )
          }
          const identity = captureIdentity()
          const currentPath = saveAs ? undefined : (portsRef.current.projectPath() ?? undefined)
          const archive = courseArchiveDataFromSnapshot(preparation.snapshot)
          const bytes = await saveCourseProjectDocumentAsync(archive)
          if (!sameProjectIdentity(identity, captureIdentity())) {
            return
          }
          const result = await portsRef.current.saveProjectFile({
            path: currentPath,
            suggestedName: `${archive.project.title}.h5lesson`,
            bytes,
          })
          if (result) {
            if (!sameProjectIdentity(identity, captureIdentity())) {
              return
            }
            const allChangesSaved = portsRef.current.acknowledgeSaved(
              result.path,
              preparation.token,
            )
            if (allChangesSaved) {
              savedCurrentRevision = true
              await portsRef.current.clearRecoveryProject().catch((error) => {
                console.error('清理恢复数据失败', error)
              })
            }
            await refreshRecentProjects()
          }
        }, '保存失败。请检查磁盘空间或另存为其他位置。')
      } finally {
        saveInFlightRef.current = false
      }
      return savedCurrentRevision
    },
    [refreshRecentProjects],
  )

  const restoreRecovery = useCallback(() => {
    const offer = recoveryOfferRef.current
    if (!offer) return
    void portsRef.current.runBusy(async () => {
      const epoch = beginMutation()
      const applied = await ingestOpenedCourseBytes(
        offer.bytes,
        null,
        {
          dirty: true,
          statusMessage: '已恢复未保存的课件，请尽快另存为工程文件',
        },
        epoch,
      )
      if (!applied) return
      await portsRef.current.clearRecoveryProject()
      setRecoveryOffer(null)
      setRecoveryDecisionComplete(true)
    }, '恢复课件失败。恢复副本可能已经损坏。')
  }, [ingestOpenedCourseBytes])

  const discardRecovery = useCallback(() => {
    void portsRef.current.clearRecoveryProject().catch((error) => {
      portsRef.current.reportError(readableError(error, '恢复副本清理失败。'))
    }).finally(() => {
      setRecoveryOffer(null)
      setRecoveryDecisionComplete(true)
    })
  }, [])

  useEffect(() => {
    document.title = `${watch.projectTitle}${watch.dirty ? ' *' : ''} - ${APP_NAME}`
    if (!portsRef.current.desktopAvailable()) return
    void portsRef.current.setWindowDirtyState(watch.dirty).catch((error) => {
      console.error('同步未保存状态失败', error)
    })
  }, [watch.dirty, watch.projectTitle])

  useEffect(() => {
    if (!portsRef.current.desktopAvailable()) {
      setRecoveryDecisionComplete(true)
      return
    }
    let cancelled = false
    void Promise.all([
      portsRef.current.listRecentProjects(),
      portsRef.current.readRecoveryProject(),
    ]).then(async ([recent, recovery]) => {
      if (cancelled) return
      setRecentProjects(recent)
      if (!recovery) {
        setRecoveryDecisionComplete(true)
        return
      }
      let official = null as ReturnType<typeof inspectCourseProjectArchiveIdentity> | null
      if (recovery.projectPath) {
        try {
          const peeked = await portsRef.current.peekProjectArchive(recovery.projectPath)
          if (peeked) official = inspectCourseProjectArchiveIdentity(peeked.bytes)
        } catch {
          official = null
        }
      }
      if (cancelled) return
      const offer = shouldOfferCourseProjectRecovery({
        recovery: inspectCourseProjectArchiveIdentity(recovery.bytes),
        official,
      })
      if (offer === 'offer') {
        setRecoveryOffer(recovery)
        return
      }
      await portsRef.current.clearRecoveryProject().catch((error) => {
        console.error('静默清理不可恢复副本失败', error)
      })
      if (cancelled) return
      setRecoveryOffer(null)
      setRecoveryDecisionComplete(true)
    }).catch((error) => {
      if (cancelled) return
      console.error('读取本地恢复状态失败', error)
      setRecoveryDecisionComplete(true)
      portsRef.current.reportError('无法读取本地恢复状态；请在编辑后及时手动保存。')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const coordinator = recoveryCoordinatorRef.current
    if (!coordinator) return
    if (!recoveryDecisionComplete || !watch.dirty) {
      coordinator.cancel()
      return
    }
    const capture = portsRef.current.captureRecoverySnapshot()
    if (!capture.ok) {
      coordinator.cancel()
      return
    }
    const snapshot = capture.snapshot
    recoveryRevisionRef.current += 1
    coordinator.schedule(recoveryRevisionRef.current, {
      identity: captureIdentity(),
      project: snapshot.project,
      assetFiles: snapshot.assetFiles,
      componentPackages: snapshot.componentPackages,
      projectPath: portsRef.current.projectPath(),
      title: snapshot.project.title,
    })
  }, [
    recoveryDecisionComplete,
    watch.componentPackagesTrigger,
    watch.dirty,
    watch.documentTrigger,
    watch.flowDraftTrigger,
    watch.projectPath,
    watch.sidecarTrigger,
    watch.slideDraftTrigger,
    watch.spatialDraftTrigger,
    watch.textEditTrigger,
  ])

  useEffect(() => () => {
    recoveryCoordinatorRef.current?.dispose()
  }, [])

  useEffect(() => {
    if (!portsRef.current.desktopAvailable()) return
    return portsRef.current.subscribeSaveRequest(() => {
      void saveProject(false)
    })
  }, [saveProject])

  useEffect(() => {
    if (!portsRef.current.desktopAvailable()) return
    return portsRef.current.subscribeSaveAndCloseRequest(() => saveProject(false))
  }, [saveProject])

  return useMemo(() => ({
    recentProjects,
    recoveryOffer,
    newProject,
    newSpatialProject,
    newFlowProject,
    openProject,
    openRecentProject,
    saveProject,
    restoreRecovery,
    discardRecovery,
  }), [
    discardRecovery,
    newFlowProject,
    newProject,
    newSpatialProject,
    openProject,
    openRecentProject,
    recentProjects,
    recoveryOffer,
    restoreRecovery,
    saveProject,
  ])
}
