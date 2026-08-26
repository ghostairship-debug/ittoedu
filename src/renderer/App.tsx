import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogSnapshot,
} from '../shared/componentCatalog'
import type { ComponentPackageData } from '../shared/componentTypes'
import {
  APP_EXECUTABLE_NAME,
  APP_NAME,
  RECOMMENDED_PROJECT_SCENES,
  RECOMMENDED_SCENE_NODES,
} from '../shared/constants'
import { toUserMessage, UserFacingError } from '../shared/errors'
import type { CourseProjectDocument } from '../shared/courseProjectTypes'
import type {
  BatchFileRejection,
  RecentProjectEntry,
  RecoveryProjectResult,
  SelectedImageBatchFile,
  SelectedMediaBatchFile,
} from '../shared/ipcTypes'
import type { AssetKind } from '../shared/projectTypes'
import { collectProjectHealth, summarizeProjectHealth } from '../shared/projectHealth'
import { buildExportPayload } from './export/buildExportPayload'
import { buildPublishedCourseV2Payload } from './export/course/buildPublishedCourse'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageAsync,
  collectCoursePackageExportPreflight,
  type CoursePackagePreflightReport,
  type SingleHtmlExportMode,
} from './export/course/buildCoursePackages'
import { buildCoursePptx } from './export/course/buildCoursePptx'
import { buildCoursePrintArtifacts } from './export/course/buildCoursePrintArtifacts'
import { buildFlowDocx, uniqueFlowDocxFilename } from './export/course/flowDocx'
import { buildPdfPrintHtml, buildPptx } from './export/buildPptx'
import { prepareBundledFontEmbedding } from './export/bundledFontEmbedding'
import {
  SINGLE_HTML_HARD_LIMIT_BYTES,
  SINGLE_HTML_WARNING_BYTES,
  utf8ByteLength,
} from './export/exportSize'
import {
  collectExportPreflight,
  type ExportPreflightItem,
  type ExportPreflightReport,
} from './export/exportPreflight'
import { loadPlayerBundle } from './export/loadPlayerBundle'
import { renderProjectSceneImages } from './export/renderSceneImages'
import {
  componentPackagesFromArchive,
  componentPackagesToArchiveFiles,
} from './components/componentPackageStore'
import {
  componentPackageSha256,
  importComponentPackageAsync,
} from './components/importComponentPackage'
import {
  buildAssetContentHashIndex,
  createImageAssetImport,
  createMediaAssetImport,
  readImageDimensions,
  readMediaMetadata,
  type ImportedImageAsset,
} from './project/assetManager'
import {
  commitMediaBatchImport,
  planMediaBatchImport,
  type MediaBatchLibraryFallback,
} from './project/mediaBatch'
import { openDefaultCourseProjectAsync, saveCourseProjectDocumentAsync } from './project/courseProjectIo'
import {
  inspectCourseProjectArchiveIdentity,
  type CourseProjectArchiveData,
} from './project/courseProjectArchive'
import { shouldOfferCourseProjectRecovery } from './project/courseProjectLifecycle'
import {
  dedupeCourseMediaImports,
  emptyCourseAssetSidecar,
} from './project/v9AssetAdapter'
import { RecoveryWriteCoordinator } from './project/recoveryWriteCoordinator'
import {
  projectCandidatePreviewDocument,
  selectActiveCourseProjectDocument,
  selectActiveScene,
  selectEditingNodes,
  selectMediaAssetFiles,
  selectSelectedNode,
  selectSlideAuthoringBackend,
  useEditorStore,
  MAX_BATCH_CANVAS_ITEMS,
  type ComponentPackageReplacementTarget,
  type ImportedAssetBatchItem,
} from './store/editorStore'
import { shouldIgnoreSlideLayerDeleteForFocus } from './course/v9SlideActionCommands'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { CopyableSummaryDialog } from './ui/CopyableSummaryDialog'
import { ExportSizeWarningDialog } from './ui/ExportSizeWarningDialog'
import { ExportPreflightDialog } from './ui/ExportPreflightDialog'
import { RightSidebar } from './ui/RightSidebar'
import { ScenePanel } from './ui/ScenePanel'
import { SceneStateStrip } from './ui/SceneStateStrip'
import { TopToolbar, type ExportFormat } from './ui/TopToolbar'
import { Workspace } from './ui/Workspace'
import { attachPublishedCourseStageFit, mountPublishedCourseTryRun } from './ui/coursePlayerTryRun'
import { beginSerializedSessionMount, enqueueSerial } from './ui/serializedSessionMount'
import type { PublishedCourseSession } from '../player/surfaces/publishedDynamicHosts'
import { ProjectHealthPanel } from './ui/ProjectHealthPanel'
import { componentCatalogInstallStatus } from './components/componentCatalogStatus'
import { planCatalogBatchJoin } from './components/componentLibraryModel'

const EMPTY_COMPONENT_CATALOG: ComponentCatalogSnapshot = {
  sources: [],
  packages: [],
  issues: [],
}

function desktopApi() {
  if (!window.desktopAPI) {
    throw new UserFacingError(
      '桌面功能不可用',
      '当前页面未运行在课件编辑器桌面环境中。',
      `请双击 ${APP_EXECUTABLE_NAME}.exe 启动软件。`,
    )
  }
  return window.desktopAPI
}

function activeCoursePublishSources() {
  const state = useEditorStore.getState()
  const document = selectActiveCourseProjectDocument(state)
  if (!document) return null
  return {
    project: document,
    assetFiles: selectMediaAssetFiles(state),
    components: state.componentPackages,
  }
}

type CourseDeliveryTarget = 'full-preview' | 'single-html' | 'web-package' | 'pdf'

function courseDeliveryUnavailable(target: CourseDeliveryTarget): UserFacingError {
  const title = target === 'full-preview'
    ? '整课预览不可用'
    : target === 'single-html'
      ? '单 HTML 导出不可用'
      : target === 'web-package'
        ? '网页包导出不可用'
        : 'PDF 导出不可用'
  return new UserFacingError(
    title,
    '当前编辑会话没有可发布的 Course Project V9 文档。',
    '请新建或重新打开受支持的课程工程后再试。',
  )
}

function isSlideOnlyCourseProject(project: CourseProjectDocument): boolean {
  return project.locations.every((location) => location.kind === 'slide-scene')
    && project.surfaces.every((surface) => surface.type === 'slide')
}

function mapCoursePackagePreflightItems(
  target: ExportPreflightReport['target'],
  report: CoursePackagePreflightReport,
): ExportPreflightItem[] {
  return report.items.map((item) => ({
    severity: item.severity,
    code: item.code as ExportPreflightItem['code'],
    message: item.message,
    target,
    ...(item.path ? { path: item.path } : {}),
  }))
}

function coursePackagePreflightToExportReport(
  target: 'single-html' | 'web-package',
  project: CourseProjectDocument,
  report: CoursePackagePreflightReport,
): ExportPreflightReport {
  return {
    reportVersion: 1,
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    target,
    generatedAt: report.generatedAt,
    items: mapCoursePackagePreflightItems(target, report),
    summary: { ...report.summary },
  }
}

function mergeCoursePackagePreflight(
  base: ExportPreflightReport,
  extra: CoursePackagePreflightReport,
): ExportPreflightReport {
  const mapped = mapCoursePackagePreflightItems(base.target, extra)
  const items = [...base.items]
  for (const item of mapped) {
    if (items.some((existing) => existing.code === item.code && existing.message === item.message)) {
      continue
    }
    items.push(item)
  }
  if (
    (base.target === 'pptx' || base.target === 'pdf') &&
    !items.some((item) => item.message.includes('全局图层与教师控制器'))
  ) {
    items.push({
      severity: 'info',
      code: 'static-export-controller-omitted',
      message: '全局图层与教师控制器默认不写入 PPTX/PDF/DOCX 文件。',
      target: base.target,
    })
  }
  const summary = { error: 0, warning: 0, info: 0, total: items.length, canExport: true }
  for (const item of items) summary[item.severity] += 1
  summary.canExport = summary.error === 0
  return { ...base, items, summary }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
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

interface BatchImportIssue {
  name: string
  message: string
}

interface PreparedAssetBatch {
  /** One item per successfully decoded selection; duplicates share asset IDs. */
  placements: ImportedAssetBatchItem[]
  /** Unique content that is not already present in the project. */
  additions: ImportedAssetBatchItem[]
  duplicateCount: number
  issues: BatchImportIssue[]
}

function desktopRejections(issues: BatchFileRejection[]): BatchImportIssue[] {
  return issues.map((issue) => ({
    name: issue.name,
    message: `${issue.message} ${issue.suggestion}`,
  }))
}

async function prepareAssetBatch<T extends {
  name: string
  mimeType: string
  bytes: Uint8Array
  sha256: string
}>(
  files: T[],
  kind: AssetKind,
  build: (file: T) => Promise<ImportedAssetBatchItem>,
): Promise<PreparedAssetBatch> {
  const state = useEditorStore.getState()
  const backend = selectSlideAuthoringBackend(state)
  const hashes = await buildAssetContentHashIndex(
    kind,
    backend ? backend.getSession().history.present.assets : state.project.assets,
    backend
      ? (state.slideCandidateSidecar?.files ?? {})
      : state.assetFiles,
  )
  const placements: ImportedAssetBatchItem[] = []
  const additions: ImportedAssetBatchItem[] = []
  const issues: BatchImportIssue[] = []
  let duplicateCount = 0

  for (const file of files) {
    const existing = hashes.get(file.sha256)
    if (existing) {
      duplicateCount += 1
      placements.push(existing)
      continue
    }
    try {
      const imported = await build(file)
      hashes.set(file.sha256, imported)
      additions.push(imported)
      placements.push(imported)
    } catch (error) {
      issues.push({
        name: file.name,
        message: readableError(error, '文件无法解码。'),
      })
    }
  }
  return { placements, additions, duplicateCount, issues }
}

async function importCandidateMediaIfInjected(input: {
  kind: AssetKind
  items: ImportedAssetBatchItem[]
  nativeType?: 'image' | 'video' | 'audio'
  mode?: 'add' | 'library'
  position?: { x?: number; y?: number }
}): Promise<boolean> {
  const state = useEditorStore.getState()
  const backend = selectSlideAuthoringBackend(state)
  if (!backend) return false
  const document = backend.getSession().history.present
  const sidecar = state.slideCandidateSidecar ?? emptyCourseAssetSidecar()
  const deduped = await dedupeCourseMediaImports(
    input.kind,
    document.assets,
    sidecar,
    input.items,
  )
  const items = input.mode === 'add' ? deduped.placements : deduped.additions
  state.importV9CandidateMedia({
    items,
    nativeType: input.nativeType,
    mode: input.mode,
    ...(typeof input.position?.x === 'number' ? { x: input.position.x } : {}),
    ...(typeof input.position?.y === 'number' ? { y: input.position.y } : {}),
  })
  return true
}

function formatBatchIssueSummary(issues: BatchImportIssue[]): string {
  const shown = issues.slice(0, 5).map((issue) => `• ${issue.name}：${issue.message}`)
  if (issues.length > shown.length) {
    shown.push(`• 其他 ${issues.length - shown.length} 个文件未导入`)
  }
  return shown.join('\n')
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function isInteractiveControlTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('button, [role="button"], [role="menuitem"], [role="option"]'),
  )
}

interface RecoverySnapshot {
  project: CourseProjectDocument
  assetFiles: Record<string, Uint8Array>
  componentPackages: Record<string, ComponentPackageData>
  projectPath: string | null
  title: string
}

function currentCourseArchiveData(): CourseProjectArchiveData {
  const state = useEditorStore.getState()
  const document = selectActiveCourseProjectDocument(state)
  if (!document) {
    throw new UserFacingError(
      '无法使用课程工程',
      '当前会话没有课程工程。',
      '请新建或打开课程工程后再保存。',
    )
  }
  return {
    project: document,
    assetFiles: { ...selectMediaAssetFiles(state) },
    componentFiles: componentPackagesToArchiveFiles(state.componentPackages),
  }
}

function createRecoveryWriteCoordinator(): RecoveryWriteCoordinator<
  RecoverySnapshot,
  Uint8Array
> {
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
      if (!window.desktopAPI) throw new Error('桌面恢复服务不可用。')
      await window.desktopAPI.writeRecoveryProject({
        projectName: snapshot.title,
        projectPath: snapshot.projectPath ?? undefined,
        bytes,
      })
    },
    onSuccess() {
      useEditorStore.getState().setStatus('已自动保存本地恢复副本')
    },
    onError(error) {
      console.error('本地恢复副本更新失败', error)
      useEditorStore.getState().setError('自动恢复副本写入失败，请立即手动保存工程。')
    },
  })
}

export default function App() {
  const [busy, setBusy] = useState(false)
  const [componentPackageRequest, setComponentPackageRequest] = useState<
    | {
      mode: 'replace'
      packageId: string
      target: ComponentPackageReplacementTarget
      packageData: ComponentPackageData
      sourceFileName: string
    }
    | null
  >(null)
  const [componentCatalog, setComponentCatalog] = useState<ComponentCatalogSnapshot>(
    EMPTY_COMPONENT_CATALOG,
  )
  const [batchOperationSummary, setBatchOperationSummary] = useState<{
    title: string
    summary: string
  } | null>(null)
  const [catalogPackageRequest, setCatalogPackageRequest] = useState<{
    mode: 'update'
    entries: AvailableComponentCatalogPackage[]
  } | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([])
  const [recoveryProject, setRecoveryProject] = useState<RecoveryProjectResult | null>(null)
  const [recoveryDecisionComplete, setRecoveryDecisionComplete] = useState(false)
  const [coursePreviewOpen, setCoursePreviewOpen] = useState(false)
  const [coursePreviewHost, setCoursePreviewHost] = useState<HTMLDivElement | null>(null)
  const coursePreviewSessionRef = useRef<PublishedCourseSession | null>(null)
  const coursePreviewFitRef = useRef<(() => void) | null>(null)
  const coursePreviewMountChainRef = useRef(Promise.resolve())
  const [coursePreviewFeedback, setCoursePreviewFeedback] = useState<{
    kind: 'loading' | 'error'
    title: string
    message: string
  } | null>(null)
  const [largeHtmlByteLength, setLargeHtmlByteLength] = useState<number | null>(null)
  const [projectHealthOpen, setProjectHealthOpen] = useState(false)
  const [exportPreflightReport, setExportPreflightReport] =
    useState<ExportPreflightReport | null>(null)
  const [pendingSingleHtmlMode, setPendingSingleHtmlMode] =
    useState<SingleHtmlExportMode | null>(null)
  const saveInFlightRef = useRef(false)
  const pendingLargeHtmlRef = useRef<{
    html: string
    mode: SingleHtmlExportMode
  } | null>(null)
  const recoveryRevisionRef = useRef(0)
  const recoveryCoordinatorRef = useRef<RecoveryWriteCoordinator<
    RecoverySnapshot,
    Uint8Array
  > | null>(null)
  if (recoveryCoordinatorRef.current === null && window.desktopAPI) {
    recoveryCoordinatorRef.current = createRecoveryWriteCoordinator()
  }

  const dirty = useEditorStore((state) => state.dirty)
  const project = useEditorStore((state) => state.project)
  const projectPath = useEditorStore((state) => state.projectPath)
  const activeCourseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(
    (state) => state.componentPackages,
  )
  const selectedNode = useEditorStore(selectSelectedNode)
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const editingScope = useEditorStore((state) => state.editingScope)
  const editorMode = useEditorStore((state) => state.editorMode)
  const activeTab = useEditorStore((state) => state.activeTab)
  const editingNodes = useEditorStore(selectEditingNodes)
  const activeScene = useEditorStore(selectActiveScene)
  const errorMessage = useEditorStore((state) => state.errorMessage)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const projectHealthDiagnostics = useMemo(
    () => collectProjectHealth(project, componentPackages),
    [project, componentPackages],
  )
  const projectHealthSummary = useMemo(
    () => summarizeProjectHealth(projectHealthDiagnostics),
    [projectHealthDiagnostics],
  )

  const setError = useEditorStore((state) => state.setError)
  const setStatus = useEditorStore((state) => state.setStatus)
  const createNewProject = useEditorStore((state) => state.createNewProject)
  const createNewSpatialProject = useEditorStore((state) => state.createNewSpatialProject)
  const createNewFlowProject = useEditorStore((state) => state.createNewFlowProject)
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const flowSession = useEditorStore((state) => state.flowSession)
  const loadCourseProject = useEditorStore((state) => state.loadCourseProject)
  const markSaved = useEditorStore((state) => state.markSaved)
  const importPackagesIntoStore = useEditorStore(
    (state) => state.importComponentPackages,
  )
  const captureComponentPackageReplacementTarget = useEditorStore(
    (state) => state.captureComponentPackageReplacementTarget,
  )
  const replacePackageAtTarget = useEditorStore(
    (state) => state.replaceComponentPackageAtTarget,
  )
  const addImageNodes = useEditorStore((state) => state.addImageNodes)
  const captureImageReplacementTarget = useEditorStore(
    (state) => state.captureImageReplacementTarget,
  )
  const replaceImageAssetAtTarget = useEditorStore(
    (state) => state.replaceImageAssetAtTarget,
  )
  const addVideoNodes = useEditorStore((state) => state.addVideoNodes)
  const captureMediaLibraryImportTarget = useEditorStore(
    (state) => state.captureMediaLibraryImportTarget,
  )
  const importAssetsAtTarget = useEditorStore(
    (state) => state.importAssetsAtTarget,
  )
  const importSounds = useEditorStore((state) => state.importSounds)

  const run = useCallback(
    async <T,>(operation: () => Promise<T>, fallback: string): Promise<T | undefined> => {
      if (busy) return undefined
      setBusy(true)
      setError(null)
      try {
        return await operation()
      } catch (error) {
        setError(readableError(error, fallback))
        return undefined
      } finally {
        setBusy(false)
      }
    },
    [busy, setError],
  )

  const reportBatchOutcome = useCallback((input: {
    label: string
    completedCount: number
    duplicateCount: number
    issues: BatchImportIssue[]
    libraryFallback?: MediaBatchLibraryFallback
  }) => {
    const details = [
      `已完成 ${input.completedCount} 项`,
      input.duplicateCount > 0 ? `内容重复 ${input.duplicateCount} 项（已复用素材）` : '',
      input.issues.length > 0 ? `失败 ${input.issues.length} 项` : '',
      input.libraryFallback === 'batch-size'
        ? '数量过多，已只加入媒体库'
        : '',
      input.libraryFallback === 'scene-capacity'
        ? '当前层容量不足，已改为只加入媒体库'
        : '',
    ].filter(Boolean)
    setStatus(`${input.label}：${details.join('；')}`)
    if (input.issues.length > 0) {
      setError(`${input.label}部分文件未完成：\n${formatBatchIssueSummary(input.issues)}`)
      setBatchOperationSummary({
        title: `${input.label}结果`,
        summary: [
          ...details,
          '',
          '未完成：',
          ...input.issues.map((issue) => `- ${issue.name}：${issue.message}`),
        ].join('\n'),
      })
    }
  }, [setError, setStatus])

  const refreshRecentProjects = useCallback(async () => {
    if (!window.desktopAPI) return
    setRecentProjects(await window.desktopAPI.listRecentProjects())
  }, [])

  const confirmDiscardIfNeeded = useCallback(async () => {
    if (!useEditorStore.getState().dirty) return true
    return (await desktopApi().confirmDiscardChanges()) === 'discard'
  }, [])

  const applyCourseArchive = useCallback((
    archive: CourseProjectArchiveData,
    path: string | null,
    extra?: { dirty?: boolean; statusMessage?: string },
  ) => {
    const packages = componentPackagesFromArchive(
      archive.project,
      archive.componentFiles,
    )
    loadCourseProject(archive.project, path, archive.assetFiles, packages)
    if (extra?.dirty || extra?.statusMessage) {
      useEditorStore.setState({
        ...(extra.dirty ? { dirty: true } : {}),
        ...(extra.statusMessage ? { statusMessage: extra.statusMessage } : {}),
      })
    }
  }, [loadCourseProject])

  const ingestOpenedCourseBytes = useCallback(async (
    bytes: Uint8Array,
    path: string | null,
    extra?: { dirty?: boolean; statusMessage?: string },
  ): Promise<void> => {
    const archive = await openDefaultCourseProjectAsync(bytes)
    applyCourseArchive(archive, path, extra)
  }, [applyCourseArchive])

  const handleNew = useCallback(() => {
    void run(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      await desktopApi().clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      createNewProject()
    }, '新建课件失败，请重试。')
  }, [confirmDiscardIfNeeded, createNewProject, run])

  const handleNewSpatial = useCallback(() => {
    void run(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      await desktopApi().clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      createNewSpatialProject()
    }, '新建无限画布课件失败，请重试。')
  }, [confirmDiscardIfNeeded, createNewSpatialProject, run])

  const handleNewFlow = useCallback(() => {
    void run(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      await desktopApi().clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      createNewFlowProject()
    }, '新建流式讲义课件失败，请重试。')
  }, [confirmDiscardIfNeeded, createNewFlowProject, run])

  const handleOpen = useCallback(() => {
    void run(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const file = await desktopApi().openProject()
      if (!file) return
      await ingestOpenedCourseBytes(file.bytes, file.path)
      await desktopApi().clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      await refreshRecentProjects()
    }, '打开工程失败。请检查文件是否损坏后重试。')
  }, [confirmDiscardIfNeeded, ingestOpenedCourseBytes, refreshRecentProjects, run])

  const handleOpenRecent = useCallback((path: string) => {
    void run(async () => {
      if (!(await confirmDiscardIfNeeded())) return
      const file = await desktopApi().openRecentProject({ path })
      await ingestOpenedCourseBytes(file.bytes, file.path)
      await desktopApi().clearRecoveryProject().catch((error) => {
        console.error('清理恢复数据失败', error)
      })
      await refreshRecentProjects()
    }, '最近工程打开失败。文件可能已被移动，请使用“打开工程”重新选择。')
  }, [confirmDiscardIfNeeded, ingestOpenedCourseBytes, refreshRecentProjects, run])

  const handleSave = useCallback(
    async (saveAs = false) => {
      if (saveInFlightRef.current) return false
      saveInFlightRef.current = true
      let savedCurrentRevision = false
      try {
        await run(async () => {
          const state = useEditorStore.getState()
          const archive = currentCourseArchiveData()
          const savedDocument = archive.project
          const savedSidecar = state.slideCandidateSidecar
          const savedComponentRevision = state.componentPackages
          const bytes = await saveCourseProjectDocumentAsync(archive)
          const result = await desktopApi().saveProject({
            path: saveAs ? undefined : (state.projectPath ?? undefined),
            suggestedName: `${archive.project.title}.h5lesson`,
            bytes,
          })
          if (result) {
            const current = useEditorStore.getState()
            const revisionStillCurrent =
              selectActiveCourseProjectDocument(current) === savedDocument &&
              current.slideCandidateSidecar === savedSidecar &&
              current.componentPackages === savedComponentRevision
            if (revisionStillCurrent) {
              markSaved(result.path)
              savedCurrentRevision = true
              await desktopApi().clearRecoveryProject().catch((error) => {
                console.error('清理恢复数据失败', error)
              })
            } else {
              useEditorStore.setState({
                projectPath: result.path,
                dirty: true,
                statusMessage: '已保存启动保存时的版本；之后的修改尚未保存',
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
    [markSaved, refreshRecentProjects, run],
  )

  const selectAndImportImage = useCallback(
    async (
      mode: 'add' | 'library' | 'replace',
      position?: { x?: number; y?: number },
    ) => {
      await run(async () => {
        if (mode === 'replace') {
          const target = captureImageReplacementTarget()
          if (!target) {
            throw new UserFacingError(
              '无法替换图片',
              '当前没有可替换的 Slide 图片。',
              '请先选择当前幻灯片中的图片，再点击“替换图片”。',
            )
          }
          const file = await desktopApi().selectImage()
          if (!file) return
          const dimensions = await readImageDimensions(file.bytes, file.mimeType)
          const imported = createImageAssetImport(file, { dimensions })
          const result = replaceImageAssetAtTarget(
            target,
            imported.meta,
            imported.bytes,
          )
          if (!result.ok) {
            throw new UserFacingError(
              '无法替换图片',
              result.reason,
              '请重新选择目标图片，再次点击“替换图片”。',
            )
          }
          return
        }

        const libraryTarget = captureMediaLibraryImportTarget()
        if (!libraryTarget) {
          throw new UserFacingError(
            '无法导入图片',
            '当前没有可写入的 Course Project。',
            '请重新打开或新建课件后再试。',
          )
        }
        const batch = await desktopApi().selectImages()
        if (!batch) return
        const prepared = await prepareAssetBatch<SelectedImageBatchFile>(
          batch.accepted,
          'image',
          async (file) => {
            const dimensions = await readImageDimensions(file.bytes, file.mimeType)
            const imported = createImageAssetImport(file, { dimensions })
            return { meta: imported.meta, bytes: imported.bytes }
          },
        )
        const issues = [...desktopRejections(batch.rejected), ...prepared.issues]
        const importPlan = planMediaBatchImport(
          mode,
          prepared.placements.length,
          MAX_BATCH_CANVAS_ITEMS,
        )
        const importIntoCapturedLibrary = (items: ImportedAssetBatchItem[]) => {
          const result = importAssetsAtTarget(libraryTarget, items)
          if (!result.ok) {
            throw new UserFacingError(
              '图片批量入库已取消',
              result.reason,
              '工程已发生变化；请重新选择文件后再试。',
            )
          }
        }
        if (importPlan.destination === 'library') {
          importIntoCapturedLibrary(prepared.additions)
          reportBatchOutcome({
            label: mode === 'library' ? '图片批量入库' : '图片批量添加',
            completedCount: prepared.additions.length,
            duplicateCount: prepared.duplicateCount,
            issues,
            ...(importPlan.overflowToLibrary
              ? { libraryFallback: 'batch-size' as const }
              : {}),
          })
          return
        }
        if (await importCandidateMediaIfInjected({
          kind: 'image',
          items: mode === 'library' ? prepared.additions : prepared.placements,
          nativeType: 'image',
          mode,
          position,
        })) {
          reportBatchOutcome({
            label: mode === 'library' ? '图片批量入库' : '图片批量添加',
            completedCount: mode === 'library'
              ? prepared.additions.length
              : prepared.placements.length,
            duplicateCount: prepared.duplicateCount,
            issues,
          })
          return
        }
        const commitResult = commitMediaBatchImport({
          plan: importPlan,
          placements: prepared.placements,
          additions: prepared.additions,
          placeOnCanvas: (items) => addImageNodes(items, position),
          importIntoLibrary: importIntoCapturedLibrary,
        })
        reportBatchOutcome({
          label: mode === 'library' ? '图片批量入库' : '图片批量添加',
          completedCount: commitResult.completedCount,
          duplicateCount: prepared.duplicateCount,
          issues,
          libraryFallback: commitResult.libraryFallback,
        })
      }, '图片读取失败。请重新选择受支持的图片。')
    },
    [
      addImageNodes,
      captureMediaLibraryImportTarget,
      captureImageReplacementTarget,
      importAssetsAtTarget,
      replaceImageAssetAtTarget,
      reportBatchOutcome,
      run,
    ],
  )

  const selectImageAsset = useCallback(async (): Promise<ImportedImageAsset | null> => {
    const imported = await run(async () => {
      const file = await desktopApi().selectImage()
      if (!file) return null
      const dimensions = await readImageDimensions(file.bytes, file.mimeType)
      return createImageAssetImport(file, { dimensions })
    }, '图片读取失败。请重新选择受支持的图片。')
    return imported ?? null
  }, [run])

  const selectAndImportAudio = useCallback(async () => {
    await run(async () => {
      const batch = await desktopApi().selectAudios()
      if (!batch) return
      const prepared = await prepareAssetBatch<SelectedMediaBatchFile>(
        batch.accepted,
        'audio',
        async (file) => {
          const metadata = await readMediaMetadata(file.bytes, file.mimeType, 'audio')
          const imported = createMediaAssetImport(file, 'audio', metadata)
          return { meta: imported.meta, bytes: imported.bytes }
        },
      )
      if (await importCandidateMediaIfInjected({
        kind: 'audio',
        items: prepared.additions,
        nativeType: 'audio',
        mode: 'library',
      })) {
        reportBatchOutcome({
          label: '声音批量入库',
          completedCount: prepared.additions.length,
          duplicateCount: prepared.duplicateCount,
          issues: [...desktopRejections(batch.rejected), ...prepared.issues],
        })
        return
      }
      importSounds(prepared.additions)
      reportBatchOutcome({
        label: '声音批量入库',
        completedCount: prepared.additions.length,
        duplicateCount: prepared.duplicateCount,
        issues: [...desktopRejections(batch.rejected), ...prepared.issues],
      })
    }, '声音读取失败。请重新选择受支持的声音文件。')
  }, [importSounds, reportBatchOutcome, run])

  const selectAndImportVideo = useCallback(async (
    mode: 'add' | 'library',
    position?: { x?: number; y?: number },
  ) => {
    await run(async () => {
      const libraryTarget = captureMediaLibraryImportTarget()
      if (!libraryTarget) {
        throw new UserFacingError(
          '无法导入视频',
          '当前没有可写入的 Course Project。',
          '请重新打开或新建课件后再试。',
        )
      }
      const batch = await desktopApi().selectVideos()
      if (!batch) return
      const prepared = await prepareAssetBatch<SelectedMediaBatchFile>(
        batch.accepted,
        'video',
        async (file) => {
          const metadata = await readMediaMetadata(file.bytes, file.mimeType, 'video')
          const imported = createMediaAssetImport(file, 'video', metadata)
          return { meta: imported.meta, bytes: imported.bytes }
        },
      )
      const issues = [...desktopRejections(batch.rejected), ...prepared.issues]
      const importPlan = planMediaBatchImport(
        mode,
        prepared.placements.length,
        MAX_BATCH_CANVAS_ITEMS,
      )
      const importIntoCapturedLibrary = (items: ImportedAssetBatchItem[]) => {
        const result = importAssetsAtTarget(libraryTarget, items)
        if (!result.ok) {
          throw new UserFacingError(
            '视频批量入库已取消',
            result.reason,
            '工程已发生变化；请重新选择文件后再试。',
          )
        }
      }
      if (importPlan.destination === 'library') {
        importIntoCapturedLibrary(prepared.additions)
        reportBatchOutcome({
          label: mode === 'add' ? '视频批量添加' : '视频批量入库',
          completedCount: prepared.additions.length,
          duplicateCount: prepared.duplicateCount,
          issues,
          ...(importPlan.overflowToLibrary
            ? { libraryFallback: 'batch-size' as const }
            : {}),
        })
        return
      }
      if (await importCandidateMediaIfInjected({
        kind: 'video',
        items: mode === 'library' ? prepared.additions : prepared.placements,
        nativeType: 'video',
        mode,
        position,
      })) {
        reportBatchOutcome({
          label: mode === 'add' ? '视频批量添加' : '视频批量入库',
          completedCount: mode === 'add'
            ? prepared.placements.length
            : prepared.additions.length,
          duplicateCount: prepared.duplicateCount,
          issues,
        })
        return
      }
      const commitResult = commitMediaBatchImport({
        plan: importPlan,
        placements: prepared.placements,
        additions: prepared.additions,
        placeOnCanvas: (items) => addVideoNodes(items, position),
        importIntoLibrary: importIntoCapturedLibrary,
      })
      reportBatchOutcome({
        label: mode === 'add' ? '视频批量添加' : '视频批量入库',
        completedCount: commitResult.completedCount,
        duplicateCount: prepared.duplicateCount,
        issues: [...desktopRejections(batch.rejected), ...prepared.issues],
        libraryFallback: commitResult.libraryFallback,
      })
    }, '视频读取失败。请重新选择 MP4 或 WebM 文件。')
  }, [
    addVideoNodes,
    captureMediaLibraryImportTarget,
    importAssetsAtTarget,
    reportBatchOutcome,
    run,
  ])

  const handleImportComponent = useCallback(() => {
    void run(async () => {
      const batch = await desktopApi().selectComponentPackages()
      if (!batch) return
      const issues = batch.rejected.map((item) =>
        `${item.name}：${item.title}；${item.message}；${item.suggestion}`,
      )
      const packagesById = new Map<string, ComponentPackageData>()
      const currentPackages = useEditorStore.getState().componentPackages
      for (const file of batch.accepted) {
        try {
          const imported = await importComponentPackageAsync(file.bytes, {
            provenance: {
              sha256: file.sha256,
              importedAt: new Date().toISOString(),
              sourceLabel: `手动导入：${file.name}`,
            },
          })
          const packageId = imported.manifest.id
          const duplicateInBatch = packagesById.get(packageId)
          if (duplicateInBatch) {
            issues.push(
              `${file.name}：同一批次已包含组件 ${packageId} ` +
              `v${duplicateInBatch.manifest.version}，请每个 ID 只选择一个版本。`,
            )
            continue
          }
          const existing = currentPackages[packageId]
          if (existing) {
            const sameLockedPackage =
              existing.manifest.version === imported.manifest.version &&
              existing.provenance?.sha256 === imported.provenance?.sha256
            issues.push(sameLockedPackage
              ? `${file.name}：工程已经包含完全相同的组件，已跳过。`
              : `${file.name}：工程已包含 ${packageId} v${existing.manifest.version}；请从工程组件菜单审阅更新或替换。`)
            continue
          }
          packagesById.set(packageId, imported)
        } catch (error) {
          issues.push(`${file.name}：${readableError(error, '组件包内容无效。')}`)
        }
      }

      const packages = [...packagesById.values()]
      if (packages.length === 0) {
        useEditorStore.getState().setStatus('外部组件导入未改变工程')
        if (issues.length > 0) {
          setError(`没有可加入工程的组件：\n${issues.slice(0, 8).join('\n')}`)
        }
        return
      }
      importPackagesIntoStore(packages)
      useEditorStore.getState().setStatus(
        issues.length > 0
          ? `已加入 ${packages.length} 个外部组件，${issues.length} 项未加入`
          : `已加入 ${packages.length} 个外部组件`,
      )
      if (issues.length > 0) {
        setError(
          `已加入 ${packages.length} 个组件；另有 ${issues.length} 项未加入：\n` +
          issues.slice(0, 8).join('\n'),
        )
      }
    }, '外部组件读取失败。请重新选择 .h5component 文件。')
  }, [importPackagesIntoStore, run, setError])

  const handleReplaceComponent = useCallback((packageId: string) => {
    void run(async () => {
      const target = captureComponentPackageReplacementTarget(packageId)
      if (!target) {
        throw new UserFacingError(
          '组件替换已取消',
          `工程中不存在可替换的组件包“${packageId}”。`,
          '请刷新工程组件列表后重试。',
        )
      }
      const file = await desktopApi().selectComponentPackage()
      if (!file) return
      const sha256 = await componentPackageSha256(file.bytes)
      const imported = await importComponentPackageAsync(file.bytes, {
        provenance: {
          sha256,
          importedAt: new Date().toISOString(),
          sourceLabel: `手动替换：${file.name}`,
        },
      })
      if (imported.manifest.id !== packageId) {
        throw new UserFacingError(
          '组件替换已取消',
          `所选包 ID 为“${imported.manifest.id}”，与工程组件“${packageId}”不一致。`,
          '请选择同一组件 ID 的新版本；需要并存的组件应作为新包导入。',
        )
      }
      setComponentPackageRequest({
        mode: 'replace',
        packageId,
        target,
        packageData: imported,
        sourceFileName: file.name,
      })
    }, '组件替换包读取失败，工程内原版本已保留。')
  }, [captureComponentPackageReplacementTarget, run])

  const performComponentReplacement = useCallback(() => {
    const request = componentPackageRequest
    setComponentPackageRequest(null)
    if (!request) return
    void run(async () => {
      const result = replacePackageAtTarget(request.target, request.packageData)
      if (!result.ok) {
        throw new UserFacingError(
          '组件替换失败',
          result.reason,
          '工程或组件状态已发生变化，请重新开始替换。',
        )
      }
    }, '组件替换失败，工程内原版本已保留。')
  }, [componentPackageRequest, replacePackageAtTarget, run])

  const performCatalogPackageOperation = useCallback(async (
    entries: AvailableComponentCatalogPackage[],
    mode: 'add' | 'update',
  ): Promise<boolean> => {
    const completed = await run(async () => {
      const stateBefore = useEditorStore.getState()
      const pendingEntries = mode === 'add'
        ? entries.filter((entry) =>
            componentCatalogInstallStatus(
              entry,
              stateBefore.componentPackages[entry.packageId],
            ) === 'available',
          )
        : entries
      if (mode === 'add' && pendingEntries.length === 0) {
        stateBefore.setStatus('所选组件均已加入工程')
        return true
      }
      const updateEntry = pendingEntries[0]
      if (
        mode === 'update' &&
        (!updateEntry || componentCatalogInstallStatus(
          updateEntry,
          stateBefore.componentPackages[updateEntry.packageId],
        ) !== 'update-available')
      ) {
        throw new UserFacingError(
          '组件更新已取消',
          '工程内组件与目录状态已发生变化。',
          '请刷新组件目录，重新审阅版本和哈希后再试。',
        )
      }
      const updateTarget = mode === 'update' && updateEntry
        ? stateBefore.captureComponentPackageReplacementTarget(updateEntry.packageId)
        : null
      if (mode === 'update' && !updateTarget) {
        throw new UserFacingError(
          '组件更新已取消',
          '工程内组件替换目标已经失效。',
          '请刷新组件目录，重新审阅版本和哈希后再试。',
        )
      }

      const importedPackages: ComponentPackageData[] = []
      for (const entry of pendingEntries) {
        const file = await desktopApi().readComponentCatalogPackage({
          sourceId: entry.sourceId,
          packageId: entry.packageId,
          version: entry.version,
        })
        if (file.sha256 !== entry.sha256) {
          throw new UserFacingError(
            '组件目录已改变',
            `组件“${entry.name}”读取到的包哈希与当前目录快照不一致。`,
            '请刷新组件库并重新确认该版本。',
          )
        }
        importedPackages.push(await importComponentPackageAsync(file.bytes, {
          expectedId: entry.packageId,
          expectedVersion: entry.version,
          provenance: {
            sha256: file.sha256,
            importedAt: new Date().toISOString(),
            sourceLabel: entry.sourceLabel,
          },
        }))
      }
      if (mode === 'update') {
        const result = replacePackageAtTarget(updateTarget!, importedPackages[0]!)
        if (!result.ok) {
          throw new UserFacingError(
            '组件更新已取消',
            result.reason,
            '工程或组件状态已发生变化，请刷新组件目录后重试。',
          )
        }
        return true
      }
      const latestState = useEditorStore.getState()
      for (const entry of pendingEntries) {
        if (componentCatalogInstallStatus(
          entry,
          latestState.componentPackages[entry.packageId],
        ) !== 'available') {
          throw new UserFacingError(
            '组件加入已取消',
            '工程内组件状态在目录读取期间发生变化。',
            '请返回组件库重新选择，避免覆盖刚刚完成的修改。',
          )
        }
      }
      importPackagesIntoStore(importedPackages)
      useEditorStore.getState().setStatus(`已加入 ${importedPackages.length} 个组件`)
      return true
    }, mode === 'update'
      ? '组件更新失败，工程内原版本已保留。'
      : '目录组件嵌入失败，工程未改变。')
    return completed === true
  }, [importPackagesIntoStore, replacePackageAtTarget, run])

  const requestCatalogPackageBatch = useCallback(async (
    entries: AvailableComponentCatalogPackage[],
  ): Promise<boolean> => {
    const state = useEditorStore.getState()
    const plan = planCatalogBatchJoin(entries, state.componentPackages)
    const pendingEntries = plan.entries
    if (pendingEntries.length === 0) {
      state.setStatus('所选组件均已加入工程')
      return true
    }
    return performCatalogPackageOperation(pendingEntries, 'add')
  }, [performCatalogPackageOperation])

  const requestCatalogPackageUpdate = useCallback((
    entry: AvailableComponentCatalogPackage,
  ) => {
    setCatalogPackageRequest({ entries: [entry], mode: 'update' })
  }, [])

  const handleRefreshComponentCatalog = useCallback(() => {
    void run(async () => {
      setComponentCatalog(await desktopApi().loadComponentCatalog())
    }, '组件目录刷新失败。')
  }, [run])

  const buildHtml = useCallback((
    singleHtmlMode: SingleHtmlExportMode = 'offline-portable',
  ) => {
    const sources = activeCoursePublishSources()
    if (!sources) throw courseDeliveryUnavailable('single-html')
    return buildPublishedCourseStandaloneHtml(sources, {
      playerBundle: loadPlayerBundle(),
      singleHtmlMode,
    })
  }, [])

  const handlePreview = useCallback(() => {
    void run(async () => {
      if (!activeCoursePublishSources()) throw courseDeliveryUnavailable('full-preview')
      setCoursePreviewFeedback({
        kind: 'loading',
        title: '正在准备整课预览',
        message: '正在载入 CoursePlayer…',
      })
      setCoursePreviewOpen(true)
    }, '整课预览不可用。请重新打开课程工程后重试。')
  }, [run])

  const writeSingleHtml = useCallback(async (
    html: string,
    mode: SingleHtmlExportMode,
  ) => {
    const state = useEditorStore.getState()
    const title = selectActiveCourseProjectDocument(state)?.title ?? state.project.title
    const result = await desktopApi().exportHtml({
      suggestedName: `${title}.html`,
      html,
    })
    if (result) {
      const label = mode === 'online-lightweight' ? '在线轻量单 HTML' : '离线便携单 HTML'
      state.setStatus(`${label}已导出到 ${result.path}`)
    }
  }, [])

  const handleExportHtml = useCallback((
    mode: SingleHtmlExportMode = 'offline-portable',
  ) => {
    void run(async () => {
      // The builders are synchronous, so the bundled font bytes have to be in
      // hand before the build starts; this is the only await that can put them
      // there. Free after the first export of a session, and free in any host
      // whose byte source is already synchronous.
      await prepareBundledFontEmbedding()
      const html = buildHtml(mode)
      const byteLength = utf8ByteLength(html)
      if (byteLength > SINGLE_HTML_WARNING_BYTES) {
        pendingLargeHtmlRef.current = { html, mode }
        setLargeHtmlByteLength(byteLength)
        return
      }
      await writeSingleHtml(html, mode)
    }, '导出失败。请检查磁盘空间并重试。')
  }, [buildHtml, run, writeSingleHtml])

  const handleExportWebPackage = useCallback(() => {
    void run(async () => {
      const state = useEditorStore.getState()
      state.setStatus('正在生成网页包…')
      const sources = activeCoursePublishSources()
      if (!sources) throw courseDeliveryUnavailable('web-package')
      await prepareBundledFontEmbedding()
      const bytes = await buildPublishedCourseWebPackageAsync(sources, loadPlayerBundle())
      const title = sources.project.title
      const result = await desktopApi().exportWebPackage({
        suggestedName: `${title}-网页包.zip`,
        bytes,
      })
      if (result) state.setStatus(`网页包已导出到 ${result.path}`)
    }, '网页包导出失败。请检查磁盘空间并重试。')
  }, [run])

  const handleExportPptx = useCallback(() => {
    void run(async () => {
      const state = useEditorStore.getState()
      state.setStatus('正在生成可编辑 PPTX 对象…')
      const sources = activeCoursePublishSources()
      const preview = projectCandidatePreviewDocument(state)
      const slideOnlyCourse = Boolean(
        sources
        && preview
        && isSlideOnlyCourseProject(sources.project),
      )
      if (sources && !slideOnlyCourse) {
        const published = buildPublishedCourseV2Payload(sources)
        const built = await buildCoursePptx(published)
        if (built.bytes.byteLength === 0) {
          throw new Error(built.report.map((item) => item.message).join('\n') || '未能生成 PPTX')
        }
        const result = await desktopApi().exportBinary({
          suggestedName: `${sources.project.title}.pptx`,
          extension: 'pptx',
          bytes: built.bytes,
        })
        if (result) {
          const notes = built.warnings.length > 0
            ? `；${built.warnings.length} 项内容已按导出说明处理`
            : ''
          state.setStatus(`PPTX 已导出 ${built.slideCount} 页到 ${result.path}${notes}`)
        }
        return
      }
      const assetFiles = preview?.assetFiles ?? selectMediaAssetFiles(state)
      const payload = buildExportPayload({
        project: preview?.project ?? state.project,
        assetFiles,
        components: state.componentPackages,
      })
      const bytes = await buildPptx(payload, assetFiles)
      const result = await desktopApi().exportBinary({
        suggestedName: `${state.project.title}.pptx`,
        extension: 'pptx',
        bytes,
      })
      if (result) {
        state.setStatus(
          `PPTX 已导出到 ${result.path}（可编辑对象保持独立；需保真的内容按预检说明静态化）`,
        )
      }
    }, 'PPTX 导出失败。请减少大图片数量后重试。')
  }, [run])

  const handleExportPdf = useCallback(() => {
    void run(async () => {
      const state = useEditorStore.getState()
      const sources = activeCoursePublishSources()
      if (sources) {
        state.setStatus('正在渲染 PDF 页面…')
        const published = buildPublishedCourseV2Payload(sources)
        const artifacts = await buildCoursePrintArtifacts(published, {
          resolveAssetBytes: (assetId) => {
            const meta = sources.project.assets[assetId]
            const bytes = sources.assetFiles[assetId]
            return meta && bytes
              ? { bytes, mimeType: meta.mimeType, filename: meta.filename }
              : undefined
          },
        })
        const pdfFile = artifacts.files.find((file) => file.kind === 'pdf-html')
        if (pdfFile) {
          const result = await desktopApi().exportPdf({
            suggestedName: `${sources.project.title}.pdf`,
            html: decodeUtf8(pdfFile.bytes),
          })
          if (result) {
            const notes = artifacts.warnings.length > 0
              ? `；${artifacts.warnings.length} 项内容已按导出说明处理`
              : ''
            state.setStatus(`PDF 已导出到 ${result.path}${notes}`)
          }
          return
        }
        if (!isSlideOnlyCourseProject(sources.project)) {
          throw new UserFacingError(
            'PDF 导出不完整',
            '未生成覆盖当前课程全部表面的 PDF 打印内容。',
            '请检查混合打印计划后重试；为避免遗漏 Flow 或 Spatial 内容，本次未回退到旧版 Slide 快照。',
          )
        }
        const preview = projectCandidatePreviewDocument(state)
        const rasterFiles = preview?.assetFiles ?? selectMediaAssetFiles(state)
        const rasterProject = preview?.project ?? state.project
        const images = await renderProjectSceneImages(rasterProject, rasterFiles, 1.5)
        const result = await desktopApi().exportPdf({
          suggestedName: `${sources.project.title}.pdf`,
          html: buildPdfPrintHtml(sources.project.title, images),
        })
        if (result) {
          const notes = artifacts.warnings.length > 0
            ? `；${artifacts.warnings.length} 项内容已按导出说明处理`
            : ''
          state.setStatus(`PDF 已导出到 ${result.path}${notes}`)
        }
        return
      }
      throw courseDeliveryUnavailable('pdf')
    }, 'PDF 导出失败。请减少大图片数量后重试。')
  }, [run])

  const handleExportDocx = useCallback(() => {
    void run(async () => {
      const sources = activeCoursePublishSources()
      if (!sources) {
        throw new Error('DOCX 讲义仅适用于当前课程工程中的流式讲义')
      }
      const published = buildPublishedCourseV2Payload(sources)
      const flowSurface = published.surfaces.find((surface) => surface.type === 'flow')
      if (!flowSurface) {
        throw new Error('当前课程没有流式讲义，无法导出 DOCX')
      }
      const built = buildFlowDocx(flowSurface, {
        resolveAsset: (assetId) => {
          const meta = sources.project.assets[assetId]
          const bytes = sources.assetFiles[assetId]
          return meta && bytes
            ? { bytes, mimeType: meta.mimeType, filename: meta.filename }
            : undefined
        },
      })
      const result = await desktopApi().exportBinary({
        suggestedName: uniqueFlowDocxFilename(flowSurface.title),
        extension: 'docx',
        bytes: built.bytes,
      })
      if (result) {
        const notes = built.warnings.length > 0
          ? `；${built.warnings.length} 项内容已按导出说明处理`
          : ''
        useEditorStore.getState().setStatus(`DOCX 讲义已导出到 ${result.path}${notes}`)
      }
    }, 'DOCX 导出失败。请先新增流式讲义页面后重试。')
  }, [run])

  const handleExport = useCallback((
    format: ExportFormat,
    singleHtmlMode: SingleHtmlExportMode = 'offline-portable',
  ) => {
    if (format === 'docx') {
      handleExportDocx()
      return
    }
    const requestedSingleHtmlMode = format === 'single-html' ? singleHtmlMode : null
    setPendingSingleHtmlMode(requestedSingleHtmlMode)
    const state = useEditorStore.getState()
    const sources = activeCoursePublishSources()
    if (!sources) {
      if (format === 'single-html' || format === 'web-package') {
        setPendingSingleHtmlMode(null)
        void run(async () => {
          throw courseDeliveryUnavailable(format)
        }, '课程交付不可用。请重新打开课程工程后重试。')
        return
      }
      const base = collectExportPreflight(
        state.project,
        format,
        {
          assetFiles: selectMediaAssetFiles(state),
          components: state.componentPackages,
        },
      )
      setExportPreflightReport(base)
      return
    }
    const delivery = format === 'web-package' ? 'web-package' : 'standalone-html'
    const v9 = collectCoursePackageExportPreflight(
      sources.project,
      delivery,
      {
        assetFiles: sources.assetFiles,
        components: sources.components,
      },
      loadPlayerBundle(),
      new Date(),
      { singleHtmlMode: requestedSingleHtmlMode ?? undefined },
    )
    if (format === 'single-html' || format === 'web-package') {
      setExportPreflightReport(coursePackagePreflightToExportReport(
        format,
        sources.project,
        v9,
      ))
      return
    }
    const base = collectExportPreflight(
      state.project,
      format,
      {
        assetFiles: selectMediaAssetFiles(state),
        components: state.componentPackages,
      },
    )
    setExportPreflightReport(mergeCoursePackagePreflight(base, v9))
  }, [handleExportDocx, run])

  const continuePreflightExport = useCallback(() => {
    const report = exportPreflightReport
    if (!report?.summary.canExport) return
    const singleHtmlMode = pendingSingleHtmlMode ?? 'offline-portable'
    setExportPreflightReport(null)
    setPendingSingleHtmlMode(null)
    if (report.target === 'single-html') handleExportHtml(singleHtmlMode)
    else if (report.target === 'web-package') handleExportWebPackage()
    else if (report.target === 'pptx') handleExportPptx()
    else handleExportPdf()
  }, [
    exportPreflightReport,
    handleExportHtml,
    handleExportPdf,
    handleExportPptx,
    handleExportWebPackage,
    pendingSingleHtmlMode,
  ])

  const locatePreflightItem = useCallback((item: ExportPreflightItem) => {
    const state = useEditorStore.getState()
    const globalNode = item.nodeId
      ? state.project.globalLayer.some(({ node }) => node.id === item.nodeId)
      : false
    state.setEditingScope(globalNode ? 'global' : 'scene')
    if (item.sceneId) state.setActiveScene(item.sceneId)
    if (!globalNode && item.stateId !== undefined) {
      state.setActivePresentationState(item.stateId)
    }
    if (item.nodeId) state.selectNode(item.nodeId)
    state.setActiveTab('properties')
    state.setStatus(`已定位导出预检问题：${item.message}`)
    setExportPreflightReport(null)
    setPendingSingleHtmlMode(null)
  }, [])

  const saveExportPreflightReport = useCallback(() => {
    const report = exportPreflightReport
    if (!report) return
    void run(async () => {
      const state = useEditorStore.getState()
      const bytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`)
      const result = await desktopApi().exportBinary({
        suggestedName: `${state.project.title}-${report.target}-preflight.json`,
        extension: 'json',
        bytes,
      })
      if (result) state.setStatus(`导出预检报告已保存到 ${result.path}`)
    }, '导出预检报告保存失败。请换一个可写目录后重试。')
  }, [exportPreflightReport, run])

  const handleExportDiagnostics = useCallback(() => {
    void run(async () => {
      const result = await desktopApi().exportDiagnostics()
      if (result) useEditorStore.getState().setStatus(`诊断报告已导出到 ${result.path}`)
    }, '诊断报告导出失败。请换一个可写目录后重试。')
  }, [run])

  const clearLargeHtmlWarning = useCallback(() => {
    pendingLargeHtmlRef.current = null
    setLargeHtmlByteLength(null)
  }, [])

  useEffect(() => {
    document.title = `${project.title}${dirty ? ' *' : ''} - ${APP_NAME}`
    if (window.desktopAPI) {
      void window.desktopAPI.setDirtyState(dirty).catch((error) => {
        console.error('同步未保存状态失败', error)
      })
    }
  }, [dirty, project.title])

  useEffect(() => {
    if (!window.desktopAPI) {
      setRecoveryDecisionComplete(true)
      return
    }
    let cancelled = false
    void Promise.all([
      window.desktopAPI.listRecentProjects(),
      window.desktopAPI.readRecoveryProject(),
    ]).then(async ([recent, recovery]) => {
      if (cancelled) return
      setRecentProjects(recent)
      if (!recovery) {
        setRecoveryDecisionComplete(true)
        return
      }
      let official = null as ReturnType<typeof inspectCourseProjectArchiveIdentity> | null
      if (recovery.projectPath && typeof window.desktopAPI.peekProjectArchive === 'function') {
        try {
          const peeked = await window.desktopAPI.peekProjectArchive({
            path: recovery.projectPath,
          })
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
        setRecoveryProject(recovery)
        return
      }
      await window.desktopAPI.clearRecoveryProject().catch((error) => {
        console.error('静默清理不可恢复副本失败', error)
      })
      if (cancelled) return
      setRecoveryProject(null)
      setRecoveryDecisionComplete(true)
    }).catch((error) => {
      if (cancelled) return
      console.error('读取本地恢复状态失败', error)
      setRecoveryDecisionComplete(true)
      setError('无法读取本地恢复状态；请在编辑后及时手动保存。')
    })
    return () => { cancelled = true }
  }, [setError])

  useEffect(() => {
    if (!coursePreviewOpen || !coursePreviewHost) {
      const leftover = coursePreviewSessionRef.current
      coursePreviewSessionRef.current = null
      if (leftover) enqueueSerial(coursePreviewMountChainRef, () => leftover.destroy())
      return
    }
    if (!activeCourseDocument) {
      setCoursePreviewOpen(false)
      return
    }
    setCoursePreviewFeedback({
      kind: 'loading',
      title: '正在准备整课预览',
      message: '正在载入 CoursePlayer…',
    })
    return beginSerializedSessionMount(coursePreviewMountChainRef, () => mountPublishedCourseTryRun({
      container: coursePreviewHost,
      project: activeCourseDocument,
      assetFiles: sidecarFiles,
      components: componentPackages,
    }), {
      onReady: (session) => {
        coursePreviewFitRef.current?.()
        coursePreviewFitRef.current = attachPublishedCourseStageFit(coursePreviewHost)
        coursePreviewSessionRef.current = session
        setCoursePreviewFeedback(null)
      },
      onError: (error) => {
        setCoursePreviewFeedback({
          kind: 'error',
          title: '整课预览启动失败',
          message: readableError(error, '播放器未能完成启动。请关闭后重试。'),
        })
      },
      onCleanup: () => {
        coursePreviewFitRef.current?.()
        coursePreviewFitRef.current = null
        coursePreviewSessionRef.current = null
      },
    })
  }, [
    activeCourseDocument,
    componentPackages,
    coursePreviewHost,
    coursePreviewOpen,
    sidecarFiles,
  ])

  useEffect(() => {
    if (!window.desktopAPI) return
    let cancelled = false
    void window.desktopAPI.loadComponentCatalog().then((snapshot) => {
      if (!cancelled) setComponentCatalog(snapshot)
    }).catch((error) => {
      if (cancelled) return
      console.error('读取组件目录失败', error)
      setError('本地组件目录读取失败；仍可手动导入 .h5component。')
    })
    return () => { cancelled = true }
  }, [setError])

  useEffect(() => {
    const coordinator = recoveryCoordinatorRef.current
    if (!coordinator) return
    if (!recoveryDecisionComplete || !dirty) {
      coordinator.cancel()
      return
    }
    const state = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(state)
    if (!document) {
      coordinator.cancel()
      return
    }
    recoveryRevisionRef.current += 1
    coordinator.schedule(recoveryRevisionRef.current, {
      project: document,
      assetFiles: { ...selectMediaAssetFiles(state) },
      componentPackages: state.componentPackages,
      projectPath: state.projectPath,
      title: document.title,
    })
  }, [sidecarFiles, componentPackages, dirty, project, projectPath, recoveryDecisionComplete])

  useEffect(() => () => {
    recoveryCoordinatorRef.current?.dispose()
  }, [])

  useEffect(() => {
    if (!window.desktopAPI) return
    return window.desktopAPI.onRequestSave(() => {
      void handleSave(false)
    })
  }, [handleSave])

  useEffect(() => {
    if (!window.desktopAPI) return
    return window.desktopAPI.onRequestSaveAndClose(() => handleSave(false))
  }, [handleSave])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || isEditingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        void handleSave(event.shiftKey)
      } else if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) useEditorStore.getState().redo()
        else useEditorStore.getState().undo()
      } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault()
        useEditorStore.getState().redo()
      } else if ((event.ctrlKey || event.metaKey) && key === 'n') {
        event.preventDefault()
        handleNew()
      } else if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault()
        handleOpen()
      } else if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault()
        const state = useEditorStore.getState()
        state.selectNodes(selectEditingNodes(state).map((node) => node.id))
      } else if ((event.ctrlKey || event.metaKey) && key === 'c') {
        event.preventDefault()
        useEditorStore.getState().copySelectedNodes()
      } else if ((event.ctrlKey || event.metaKey) && key === 'v') {
        event.preventDefault()
        useEditorStore.getState().pasteNodes()
      } else if ((event.ctrlKey || event.metaKey) && key === 'd') {
        event.preventDefault()
        useEditorStore.getState().duplicateSelectedNodes()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        const state = useEditorStore.getState()
        if (selectActiveCourseProjectDocument(state)) {
          const snapshot = state.createLiveEditorSelectionSnapshot(event.target)
          if (!snapshot) return
          if (
            snapshot.focus === 'text' &&
            event.target instanceof HTMLElement &&
            event.target.isContentEditable
          ) return
          const result = state.routeEditorAction('delete', snapshot)
          if (result.ok || result.reason) {
            event.preventDefault()
          }
          return
        }
        if (state.flowSession) {
          if (
            state.flowTextEdit?.composing
            || state.flowSession.selection.focus === 'text'
            || (event.target instanceof HTMLElement && event.target.isContentEditable)
          ) return
          if (
            state.selectedNodeIds.length > 0
            || state.flowSession.selection.selectedBlockIds.length > 0
            || state.flowSession.selection.selectedOverlayIds.length > 0
          ) {
            event.preventDefault()
            state.deleteSelectedNodes()
          }
          return
        }
        if (selectSlideAuthoringBackend(state)) {
          if (shouldIgnoreSlideLayerDeleteForFocus({
            textEditSession: Boolean(
              state.editingTextNodeId || state.v9ContentEdit?.kind === 'text',
            ),
            formulaEditSession: state.v9ContentEdit?.kind === 'formula',
            tagName: event.target instanceof HTMLElement ? event.target.tagName : undefined,
            isContentEditable: event.target instanceof HTMLElement
              ? event.target.isContentEditable
              : false,
          })) return
          if (state.selectedNodeIds.length > 0) {
            event.preventDefault()
            state.deleteSelectedNodes()
          }
          return
        }
        if (state.selectedNodeIds.length > 0 && !state.editingTextNodeId) {
          event.preventDefault()
          state.deleteSelectedNodes()
        }
      } else if (event.key.startsWith('Arrow')) {
        // Direction keys belong to the focused control first. In particular,
        // dnd-kit's keyboard layer reordering also uses ArrowUp / ArrowDown.
        if (isInteractiveControlTarget(event.target)) return
        const distance = event.shiftKey ? 10 : 1
        const movement = {
          ArrowLeft: [-distance, 0],
          ArrowRight: [distance, 0],
          ArrowUp: [0, -distance],
          ArrowDown: [0, distance],
        }[event.key]
        if (movement && useEditorStore.getState().selectedNodeIds.length > 0) {
          event.preventDefault()
          useEditorStore.getState().nudgeSelection(movement[0], movement[1])
        }
      } else if (event.key === 'Escape') {
        useEditorStore.getState().selectNodes([])
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleNew, handleOpen, handleSave])

  return (
    <div className="app-shell">
      <TopToolbar
        busy={busy}
        onNew={handleNew}
        onNewSpatial={handleNewSpatial}
        onNewFlow={handleNewFlow}
        onOpen={handleOpen}
        recentProjects={recentProjects}
        onOpenRecent={handleOpenRecent}
        onSave={(saveAs) => void handleSave(saveAs)}
        healthSummary={projectHealthSummary}
        onOpenHealth={() => setProjectHealthOpen(true)}
        onPreview={handlePreview}
        onExport={handleExport}
      />
      <div
        className={`app-main${
          editorMode === 'professional' && activeTab === 'developer'
            ? ' app-main--developer'
            : ''
        }`}
      >
        <ScenePanel />
        <div className="editor-center">
          <Workspace
            onAddImage={(x, y) =>
              void selectAndImportImage('add', { x, y })
            }
            onAddVideo={(x, y) =>
              void selectAndImportVideo('add', { x, y })
            }
            onSelectImageAsset={selectImageAsset}
          />
          {spatialSession || flowSession ? null : <SceneStateStrip />}
        </div>
        <RightSidebar
          onAddImage={(x, y) =>
            void selectAndImportImage('add', { x, y })
          }
          onReplaceImage={() => void selectAndImportImage('replace')}
          onAddVideo={(x, y) => void selectAndImportVideo('add', { x, y })}
          onImportImage={() => void selectAndImportImage('library')}
          onImportAudio={() => void selectAndImportAudio()}
          onImportVideo={() => void selectAndImportVideo('library')}
          onImportExternalComponents={handleImportComponent}
          onReplaceComponent={handleReplaceComponent}
          componentCatalog={componentCatalog}
          onRefreshComponentCatalog={handleRefreshComponentCatalog}
          onAddCatalogComponents={requestCatalogPackageBatch}
          onUpdateCatalogComponent={requestCatalogPackageUpdate}
        />
      </div>
      <footer className="status-bar" aria-live="polite">
        <span className="status-dot" />
        <span>{busy ? '正在处理…' : (statusMessage ?? '就绪')}</span>
        <span className="status-bar__spacer" />
        <span>{editingScope === 'global' ? '全局层' : activeScene.name}</span>
        <span>·</span>
        <span>{editingScope === 'global' ? `${editingNodes.length} 个全局元素` : `${activeScene.nodes.length} 个节点`}</span>
        {(project.scenes.length > RECOMMENDED_PROJECT_SCENES ||
          activeScene.nodes.length > RECOMMENDED_SCENE_NODES) && (
          <>
            <span>·</span>
            <span className="status-bar__warning" title="大型课件建议使用网页包导出，以减少启动和内存压力">
              大型课件 · 建议网页包
            </span>
          </>
        )}
        <span>·</span>
        <span>{selectedNodeIds.length > 1 ? `已选 ${selectedNodeIds.length} 个图层` : selectedNode ? `已选：${selectedNode.name}` : editingScope === 'global' ? '未选择全局元素' : '未选择节点'}</span>
        <span>·</span>
        <span>{projectPath ? '工程已命名' : '尚未保存'}</span>
      </footer>

      {errorMessage && (
        <div className="toast" role="alert">
          <AlertCircle size={19} />
          <div className="toast__content">{errorMessage}</div>
          <button
            type="button"
            className="icon-button"
            title="关闭错误提示"
            aria-label="关闭错误提示"
            onClick={() => setError(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(componentPackageRequest)}
        title="审阅组件包替换"
        message={componentPackageRequest
          ? (() => {
              const current = componentPackages[componentPackageRequest.packageId]
              const next = componentPackageRequest.packageData
              return `组件：${next.manifest.name} (${next.manifest.id})\n当前版本：${current?.manifest.version ?? '未知'}\n新版本：${next.manifest.version}\n文件：${componentPackageRequest.sourceFileName}\nSHA-256：${next.provenance?.sha256 ?? '未登记'}\n\n确认后，场景与全局层中的全部实例会切换到该包并保留当前属性；此操作可以撤销。请只替换为已审阅的可信代码。`
            })()
          : ''}
        confirmLabel="确认替换"
        onCancel={() => setComponentPackageRequest(null)}
        onConfirm={performComponentReplacement}
      />
      <ConfirmDialog
        open={Boolean(catalogPackageRequest)}
        title="审阅目录组件更新"
        message={catalogPackageRequest
          ? (() => {
              const entry = catalogPackageRequest.entries[0]!
              return `组件：${entry.name} v${entry.version}\n来源：${entry.sourceLabel}\nSHA-256：${entry.sha256}\n质量：${entry.quality}\n发布阻断：${entry.releaseBlockers?.join('、') || '无'}\n\n更新会改变工程锁定的组件代码和全部实例，必须明确审阅。读取时仍会重新校验哈希。`
            })()
          : ''}
        confirmLabel="确认更新"
        onCancel={() => setCatalogPackageRequest(null)}
        onConfirm={() => {
          const request = catalogPackageRequest
          setCatalogPackageRequest(null)
          if (!request) return
          void performCatalogPackageOperation(request.entries, request.mode)
        }}
      />
      <ProjectHealthPanel
        open={projectHealthOpen}
        onClose={() => setProjectHealthOpen(false)}
        onExportDiagnostics={handleExportDiagnostics}
      />
      <CopyableSummaryDialog
        open={batchOperationSummary !== null}
        title={batchOperationSummary?.title ?? '批次结果'}
        summary={batchOperationSummary?.summary ?? ''}
        onClose={() => setBatchOperationSummary(null)}
      />
      <ExportPreflightDialog
        report={exportPreflightReport}
        onCancel={() => {
          setExportPreflightReport(null)
          setPendingSingleHtmlMode(null)
        }}
        onContinue={continuePreflightExport}
        onLocate={locatePreflightItem}
        onSaveReport={saveExportPreflightReport}
      />
      <ExportSizeWarningDialog
        open={largeHtmlByteLength !== null}
        byteLength={largeHtmlByteLength ?? 0}
        hardLimitBytes={SINGLE_HTML_HARD_LIMIT_BYTES}
        onCancel={clearLargeHtmlWarning}
        onExportWebPackage={() => {
          clearLargeHtmlWarning()
          handleExportWebPackage()
        }}
        onContinueSingleHtml={() => {
          const pending = pendingLargeHtmlRef.current
          clearLargeHtmlWarning()
          if (!pending) return
          void run(
            () => writeSingleHtml(pending.html, pending.mode),
            '单 HTML 导出失败。请改用网页包或检查磁盘空间。',
          )
        }}
      />
      <ConfirmDialog
        open={Boolean(recoveryProject)}
        title="发现未完成的本地恢复副本"
        message={recoveryProject ? `课件：${recoveryProject.projectName}\n保存时间：${new Date(recoveryProject.savedAt).toLocaleString('zh-CN')}\n\n恢复后请重新保存工程；如果这些修改已经不需要，可以丢弃副本。` : ''}
        confirmLabel="恢复课件"
        cancelLabel="丢弃副本"
        onCancel={() => {
          void desktopApi().clearRecoveryProject().catch((error) => {
            setError(readableError(error, '恢复副本清理失败。'))
          }).finally(() => {
            setRecoveryProject(null)
            setRecoveryDecisionComplete(true)
          })
        }}
        onConfirm={() => {
          if (!recoveryProject) return
          void run(async () => {
            await ingestOpenedCourseBytes(
              recoveryProject.bytes,
              null,
              {
                dirty: true,
                statusMessage: '已恢复未保存的课件，请尽快另存为工程文件',
              },
            )
            await desktopApi().clearRecoveryProject()
            setRecoveryProject(null)
            setRecoveryDecisionComplete(true)
          }, '恢复课件失败。恢复副本可能已经损坏。')
        }}
      />
      {coursePreviewOpen ? (
        <div
          className="modal-backdrop course-preview-overlay"
          data-testid="course-preview-overlay"
          role="presentation"
        >
          <section
            className="course-preview-shell"
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-preview-title"
          >
            <header className="course-preview-chrome">
              <div>
                <h2 className="modal__title" id="course-preview-title">整课预览</h2>
                <p className="modal__message">Published Course V2 · CoursePlayer · 1280 × 720</p>
              </div>
              <div className="course-preview-chrome__actions">
                <button
                  type="button"
                  className="secondary-button"
                  data-testid="course-preview-previous"
                  onClick={() => void coursePreviewSessionRef.current?.previous()}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-testid="course-preview-next"
                  onClick={() => void coursePreviewSessionRef.current?.next()}
                >
                  下一页
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setCoursePreviewOpen(false)}
                >
                  关闭预览
                </button>
              </div>
            </header>
            <div className="course-preview-viewport">
              <div
                ref={setCoursePreviewHost}
                className="course-preview-host"
                data-testid="course-preview-host"
              />
              {coursePreviewFeedback ? (
                <div
                  className={`runtime-preview-loading runtime-preview-loading--${coursePreviewFeedback.kind} course-try-run-feedback`}
                  role={coursePreviewFeedback.kind === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                  data-testid="course-preview-feedback"
                >
                  <div className="runtime-preview-loading__panel">
                    {coursePreviewFeedback.kind === 'loading' && (
                      <LoaderCircle
                        className="runtime-preview-loading__spinner"
                        size={24}
                        aria-hidden="true"
                      />
                    )}
                    <strong>{coursePreviewFeedback.title}</strong>
                    <span>{coursePreviewFeedback.message}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
