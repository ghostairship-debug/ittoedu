import { captureCourseDocumentReference, workbenchSelection } from './workbench/SelectionContextController'
import { CourseAdvancedChrome, CourseEditorFrame, useCourseEditorChrome } from './documents/CourseEditorChromeContext'
import { CourseLightToolbar } from './documents/CourseLightToolbar'
import { HtmlImportDialog, type HtmlImportDestination } from './documents/HtmlImportDialog'
import { elementCards } from './workbench/elementCards/elementCardController'
import { CourseEditorActionsContext, type CourseEditorActions } from './documents/CourseEditorActionsContext'
import { AlertCircle, FileClock, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { LessonWorkspaceHost } from './app/LessonWorkspaceHost'
import type { LessonWorkspaceShellHandle } from './lessonWorkspace/LessonWorkspaceShell'
import {
  APP_EXECUTABLE_NAME,
  RECOMMENDED_PROJECT_SCENES,
  RECOMMENDED_SCENE_NODES,
} from '../shared/constants'
import { toUserMessage, UserFacingError } from '../shared/errors'
import { formatPageInsets, WINDOW_PAGE_INSETS } from '../shared/pageFrame'
import {
  collectComponentProjectHealth,
  summarizeCourseProjectHealth,
} from '../shared/componentProjectHealth'
import { createSlideLightEditingPort } from './composition/selection/slideLightEditingPort'
import { useComponentLibrary } from './app/useComponentLibrary'
import { insertComponentDefinitionAtTarget, insertComponentPackagesAtTarget } from './components/insertComponentPackages'
import { selectCurrentCatalogPackages } from './components/componentLibraryModel'
import { useCourseDelivery } from './app/useCourseDelivery'
import { courseDeliverySnapshot } from './app/courseDeliverySnapshot'
import { resolveCourseProjectDeliveryFindingRoute } from './diagnostics/projectHealthNavigation'
import { useCourseProjectLifecycle } from './app/useCourseProjectLifecycle'
import { useFlowDocumentRecovery } from './app/useFlowDocumentRecovery'
import { captureFlowMenuTarget, resolveFlowMenuInsertionOptions, insertFlowMenu as commitFlowMenu, type CapturedFlowMenuTarget, type FlowInsertCommand } from './ui/flow/flowInsertCommands'
import { insertCourseMedia, insertCoursePreparedMedia, transformCourseImageAtTarget, type CourseInsertionOptions } from './media/commitCourseMediaAuthoring'
import { readComponentInteractionSounds, setComponentClickInteraction } from './interactions/componentInteractionAuthoring'
import { flowBodyIds } from './componentPlatform/surfaces/flow/documentProjection'
import type { CapturedCourseTarget } from './documents/CourseV10DocumentBridge'
import type { ComponentLibraryEntry } from '../shared/contracts/component-platform/library'
import { createComponentElementCardNavigation } from './workbench/elementCards/ElementCardIndicator'
import type { FlowDeepInsertPayload } from './ui/RightSidebar'
import { useEditorKeyboardRouter } from './app/useEditorKeyboardRouter'
import { useCourseCanvasPaste } from './app/useCourseCanvasPaste'
import { useMediaImport } from './app/useMediaImport'
import type { WorkspaceMediaDropHandler } from './lessonWorkspace/workspaceMediaDrop'
import type { DocumentHostAPI, SaveDirectoryContext } from '../shared/workbench/desktop'
import {
  selectCanUndoActiveSurface, selectCanRedoActiveSurface,
  selectActiveCourseLocationId, selectActiveCourseProjectDocument,
  selectEditingNodes, selectEditingScope, selectMediaAssetFiles,
  selectSelectedNodeIds, selectHasUnsavedCourseChanges, selectHasUnsavedCourseDocuments, useEditorStore,
} from './store/editorStore'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { CopyableSummaryDialog } from './ui/CopyableSummaryDialog'
import { ExportSizeWarningDialog } from './ui/ExportSizeWarningDialog'
import { ExportPreflightDialog } from './ui/ExportPreflightDialog'
import { CourseExportSettingsDialog } from './app/CourseExportSettingsDialog'
import { RightSidebar } from './ui/RightSidebar'
import { ScenePanel } from './ui/ScenePanel'
import { CourseBottomNavigation } from './ui/BottomSceneNavigator'
import { requestFlowBlockFocus, requestFlowBlockSelection } from './document/flowWorkspaceRegistry'
import { TopToolbar } from './ui/TopToolbar'
import { proEditorRailController } from './ui/proEditorRailController'
import { Workspace } from './ui/Workspace'
import { ProjectHealthPanel } from './ui/ProjectHealthPanel'
import { ProjectColorPaletteContext } from './ui/ColorInput'
import { RecipePanel } from './ui/recipes/RecipePanel'
import { applyRecipe } from './recipes/applyRecipe'
import { ProductivityDialog } from './ui/productivity/ProductivityDialog'
import { MaterialLibraryDialog } from './ui/MaterialLibraryDialog'
import { EditorPanelLayout } from './ui/EditorPanelLayout'
import { createMaterialCitationRequest } from './authoring/tools/materialCitationRequest'
import { insertMaterialCitation } from './authoring/tools/materialCitationTool'
import { buildDocumentExport } from './workbench/delivery/DocumentExportRenderer'
import type { ProductivityContext } from './authoring/productivity'
import { BundledFontBoundary } from './app/BundledFontBoundary'
import { confirmPptxLosses } from './project/confirmPptxLosses'
import { createCourseFromPptx, pptxCourseStem } from './project/pptxCourseCreation'
import { CourseV10RuntimeView } from './components/CourseV10RuntimeView'
import type { DocumentSnapshot } from '../shared/workbench/document'
import { resolveComponentPresentation } from '../shared/contracts/component-platform'
import { projectWithBackgroundPreview } from './authoring/backgroundPreview'
import { projectWithSlideContentDraft } from './store/slices/slideAuthoringSlice'

function desktopApi() {
  if (!window.desktopAPI) {
    throw new UserFacingError(
      '桌面功能不可用',
      '当前页面未运行在果铃工作台桌面环境中。',
      `请双击 ${APP_EXECUTABLE_NAME}.exe 启动软件。`,
    )
  }
  return window.desktopAPI
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

async function drainCourseDocument(documentId = useEditorStore.getState().courseView.activeDocumentId): Promise<DocumentSnapshot> {
  if (!documentId) throw new Error('请先打开一份 果铃工程')
  return useEditorStore.getState().drainCourseDocument(documentId)
}

/** One runtime world per document survives view and surface switches. */
function CourseWorkspaces(props: ComponentProps<typeof Workspace>) {
  const view = useEditorStore(state => state.courseView)
  const bridge = useEditorStore(state => state.courseBridge)
  const report = useEditorStore(state => state.setError)
  const preview = useEditorStore(state => state.previewBackgroundColor)
  const contentDraft = useEditorStore(state => state.slideContentEdit)
  const chrome = useCourseEditorChrome()
  return <>{view.views.map(document => {
    const active = document.documentId === view.activeDocumentId
    const epoch = view.documents.find(snapshot => snapshot.documentId === document.documentId)?.epoch
    const effective = projectWithSlideContentDraft(resolveComponentPresentation(document.model.project, document.surfaceId, document.activeStateId), contentDraft, { documentId: document.documentId, epoch,
      surfaceId: document.surfaceId, activeStateId: document.activeStateId })
    const renderProject = projectWithBackgroundPreview(effective, preview, document.documentId, document.surfaceId, document.activeStateId, epoch)
    return <div key={document.documentId} hidden={!active} style={active ? { display: 'flex', flex: 1, minHeight: 0 } : undefined}>
      <CourseV10RuntimeView active={active} documentId={document.documentId} model={document.model} surfaceId={document.surfaceId}
        activeStateId={document.activeStateId}
        renderProject={renderProject}
        selectedInstanceId={document.selectedInstanceId} selectedInstanceIds={document.selectedInstanceIds}
        player={false} bridge={bridge} report={report}
        onSelect={id => bridge.selectInstances(document.documentId, id ? [id] : [])}
        onSelectInstances={(ids, surfaceId) => bridge.selectInstances(document.documentId, ids, surfaceId)}
        onSurfaceSelect={id => bridge.selectSurface(document.documentId, id)}
        projectionKey={`${active}:${document.surfaceId}:${chrome.mode}`}
        renderWorkspace={() => active ? <Workspace {...props} /> : null} />
    </div>
  })}</>
}

export default function App() {
  useEffect(() => {
    const api = window.desktopAPI
    if (!api?.onDocumentExportBuildRequest || !api.sendDocumentExportBuildReply) return
    const builds = new Map<string, { controller: AbortController; identity: import('../shared/workbench/toolPorts').ExportBuildRequest['identity'] }>()
    const stopRequests = api.onDocumentExportBuildRequest(request => {
      // Main owns request identity. Re-delivery does not start a second build.
      if (builds.has(request.requestId)) return
      const build = { controller: new AbortController(), identity: structuredClone(request.identity) }
      builds.set(request.requestId, build)
      void buildDocumentExport(request, build.controller.signal, undefined, undefined, progress => {
        if (builds.get(request.requestId) === build && !build.controller.signal.aborted) void api.sendDocumentExportBuildProgress?.(progress)
      }).then(reply => api.sendDocumentExportBuildReply?.(reply))
        .catch(error => console.error('文档导出生成回复失败', error))
        .finally(() => { if (builds.get(request.requestId) === build) builds.delete(request.requestId) })
    })
    const stopCancellation = api.onDocumentExportBuildCancel?.(request => {
      const build = builds.get(request.requestId), identity = request.identity
      if (build && build.identity.documentId === identity.documentId && build.identity.epoch === identity.epoch
        && build.identity.revision === identity.revision && build.identity.projectId === identity.projectId) build.controller.abort()
    })
    return () => { stopRequests(); stopCancellation?.(); for (const build of builds.values()) build.controller.abort() }
  }, [])
  const lessonShell = useRef<LessonWorkspaceShellHandle>(null)
  const openingLaunchFiles = useRef(false)
  useEffect(() => {
    const api = window.desktopAPI
    if (!api?.launchFiles) return
    const open = async () => {
      if (openingLaunchFiles.current) return
      openingLaunchFiles.current = true
      try {
        for (;;) {
          const requests = await api.launchFiles!({ type: 'list' })
          if (!requests.length || !lessonShell.current) break
          for (const request of requests) {
            try { await lessonShell.current.openFile(request.path) }
            catch (error) { setError(`无法打开 ${request.path}：${error instanceof Error ? error.message : String(error)}`) }
            await api.launchFiles!({ type: 'ack', id: request.id })
          }
        }
      } finally { openingLaunchFiles.current = false }
    }
    const start = () => { void open().catch(error => setError(error instanceof Error ? error.message : '启动文件暂时无法打开')) }
    const stop = api.onLaunchFilesChanged?.(start)
    start(); return () => stop?.()
  }, [])
  const saveDirectory = useRef<SaveDirectoryContext | null>(null)
  const rawDocuments = window.desktopAPI?.documents
  const courseInputs = useEditorStore(state => state.courseInputs)
  const restoreCourseInputs = courseInputs.restore
  const prepareCourseClose = courseInputs.prepare
  const documentsWithSaveDirectory = useMemo<DocumentHostAPI | null>(() => rawDocuments ? {
    ...rawDocuments,
    saveWithDialog: (documentId, saveAs, suggestedDirectory) => rawDocuments.saveWithDialog(documentId, saveAs, suggestedDirectory ?? saveDirectory.current ?? undefined),
    closeWithDialog: (documentId, suggestedDirectory, discardOnly) =>
      rawDocuments.closeWithDialog(documentId, suggestedDirectory ?? saveDirectory.current ?? undefined, discardOnly),
  } : null, [rawDocuments])
  const setSaveDirectory = useCallback((directory: SaveDirectoryContext | null) => { saveDirectory.current = directory }, [])
  const [lessonDirty, setLessonDirty] = useState(false)
  const [activeWorkspaceDocument, setActiveWorkspaceDocument] = useState<{ kind: string; name: string } | null>(null)
  const activeWorkspaceKind = useRef<string | null>(null)
  activeWorkspaceKind.current = activeWorkspaceDocument?.kind ?? null
  const [busy, setBusy] = useState(false)
  const [htmlImportDialog, setHtmlImportDialog] = useState<{ documentId: string; epoch: string; revision: number; projectId: string; surfaceId: string | null; stateId: string | null;
    sourcePath: string | null; destinations: HtmlImportDestination[]; busy: boolean; error: string | null } | null>(null)
  const [projectHealthOpen, setProjectHealthOpen] = useState(false)
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [designTool, setDesignTool] = useState<{ kind: 'recipe' | 'productivity' | 'pptx'; context: ProductivityContext } | null>(null)
  const hasFlowSurface = useEditorStore(state => Boolean(state.courseView.project?.surfaces.some(surface => surface.kind === 'flow')))
  const openDesignTool = (kind: 'recipe' | 'productivity' | 'pptx') => {
    const documentId = useEditorStore.getState().courseView.activeDocumentId
    if (!documentId) { setError('请先打开一份 果铃工程'); return }
    void run(async () => {
      await drainCourseDocument(documentId)
      const context = useEditorStore.getState().readDesignProductionContext(documentId)
      if (context) setDesignTool({ kind, context })
    }, '当前工程输入尚未确认。')
  }

  const canUndoCourse = useEditorStore(selectCanUndoActiveSurface)
  const canRedoCourse = useEditorStore(selectCanRedoActiveSurface)
  const courseCanvasMode = useEditorStore(state => state.canvasMode)
  const courseConnection = useEditorStore(state => state.courseView)
  useEffect(() => {
    for (const snapshot of courseConnection.documents) void restoreCourseInputs(snapshot.documentId)
      .catch(error => useEditorStore.getState().setError(error instanceof Error ? error.message : '输入恢复暂未完成，原稿保留在本机'))
  }, [courseConnection.documents, rawDocuments])
  const courseKernel = useEditorStore(state => state.courseKernel)
  const allCourseDirty = useEditorStore(selectHasUnsavedCourseDocuments)
  const projectPath = useEditorStore((state) => state.projectPath)
  const activeCourseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const projectColors = useMemo(() => activeCourseDocument?.designTokens?.colors.map(token => ({ name: token.label, value: token.color })) ?? [], [activeCourseDocument?.designTokens])
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const flowDocumentDraft = useEditorStore(state => state.flowDocumentDraft)
  const localDraftVersion = useEditorStore(state => state.localDraftVersion)
  const [retainedFlowOpen, setRetainedFlowOpen] = useState(false)
  const selectedItemName = useEditorStore(state => {
    const project = state.courseView.project
    const item = project?.instances[state.courseView.selectedInstanceId ?? '']
    if (!item || !project) return null
    const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data : {}
    return typeof data.name === 'string' ? data.name : typeof data.text === 'string' ? data.text.slice(0, 60) : project.definitions[item.definitionId]?.title ?? item.id
  })
  const selectedNodeIds = useEditorStore(selectSelectedNodeIds)
  const editingScope = useEditorStore(selectEditingScope)
  const insertSurface = activeCourseDocument?.surfaces.find(surface => surface.id === courseConnection.surfaceId)?.kind ?? null
  const spatialInsertScope = useEditorStore(state => state.courseView.project?.surfaces.find(surface => surface.id === state.courseView.surfaceId)?.kind === 'spatial'
    ? state.readSpatialView(state.courseView.surfaceId ?? '', state.courseView.activeDocumentId ?? '').scope : null)
  const activeTab = useEditorStore(state => state.activeTab)
  const editingItemCount = editingScope === 'global'
    ? (activeCourseDocument?.global.underlay.length ?? 0) + (activeCourseDocument?.global.overlay.length ?? 0)
    : activeCourseDocument?.surfaces.find(surface => surface.id === courseConnection.surfaceId)?.childIds.length ?? 0
  const activeScene = activeCourseDocument?.surfaces.find(surface => surface.id === courseConnection.surfaceId)
  const slideSceneCount = activeCourseDocument?.surfaces.filter(surface => surface.kind === 'slide').length ?? 0
  const errorMessage = useEditorStore((state) => state.errorMessage)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const courseProjectHealthDiagnostics = useMemo(
    () => activeCourseDocument && projectHealthOpen
      ? collectComponentProjectHealth(activeCourseDocument, {
          assetFiles: sidecarFiles,
        })
      : null,
    [activeCourseDocument, sidecarFiles, projectHealthOpen],
  )
  const projectHealthSummary = useMemo(
    () => courseProjectHealthDiagnostics
      ? summarizeCourseProjectHealth(courseProjectHealthDiagnostics)
      : null,
    [courseProjectHealthDiagnostics],
  )

  const setError = useEditorStore((state) => state.setError)
  const setStatus = useEditorStore((state) => state.setStatus)
  const actionTail = useRef<Promise<unknown>>(Promise.resolve())
  const run = useCallback(
    <T,>(operation: () => Promise<T>, fallback: string): Promise<T | undefined> => {
      // Native shortcuts can arrive before an open/import finishes. Keep the request
      // in order instead of silently dropping it because a React busy flag is set.
      const result = actionTail.current.then(async () => {
        setBusy(true)
        setError(null)
        try { return await operation() }
        catch (error) { setError(readableError(error, fallback)); return undefined }
        finally { setBusy(false) }
      })
      actionTail.current = result.then(() => undefined, () => undefined)
      return result
    },
    [setError],
  )

  const flowRecoveryPort = useMemo(() => window.desktopAPI?.flowDocumentRecovery ?? null, [])
  const flowRecovery = useFlowDocumentRecovery({
    target: insertSurface === 'flow' && activeCourseDocument && courseConnection.snapshot && courseConnection.surfaceId ? {
      projectId: activeCourseDocument.id, projectPath, surfaceId: courseConnection.surfaceId,
      revision: activeCourseDocument.revision, epoch: courseConnection.snapshot.epoch,
    } : null,
    draft: flowDocumentDraft,
    port: flowRecoveryPort,
    onRestore(draft) {
      const current = useEditorStore.getState()
      if (current.courseView.surfaceId !== draft.surfaceId || current.courseView.project?.revision !== draft.revision || current.flowDocumentDraft) return
      current.restoreFlowDocumentDraft(draft)
    },
    onError: setError,
  })
  async function suspendCloseInputs(documentIds?: readonly string[]) {
    const pending = courseInputs.suspend(documentIds)
    lessonShell.current?.suspendForClose(documentIds)
    await pending
  }
  function resumeCloseInputs(documentIds?: readonly string[]) {
    courseInputs.resume(documentIds)
    lessonShell.current?.resumeAfterCloseCancelled(documentIds)
  }
  useEffect(() => {
    const api = window.desktopAPI
    const prepareSource = api?.onRequestPrepareDocumentInput?.(async documentId => { await workbenchSelection.prepare(documentId) })
    const captureSpatialViewport = api?.onRequestCaptureSpatialViewport?.(async input => {
      await workbenchSelection.prepare(input.documentId)
      if (activeWorkspaceKind.current !== 'course') throw new Error('当前空间视口尚未运行，请打开原空间视口后重试。')
      return useEditorStore.getState().captureSpatialViewport(input)
    })
    const captureMediaCopy = api?.onRequestCaptureMediaCopy?.((source, kind) => {
      if (!lessonShell.current) throw new Error('文件编辑界面尚未就绪，当前媒体稿未确认')
      return lessonShell.current.captureMediaDrafts(source, kind)
    })
    const discard = api?.onRequestDiscardAndClose?.(async ids => {
      await suspendCloseInputs(ids)
      await flowRecovery.flush()
      return true
    })
    const resume = api?.onRequestResumeClose?.(() => resumeCloseInputs())
    return () => { prepareSource?.(); captureSpatialViewport?.(); captureMediaCopy?.(); discard?.(); resume?.() }
  }, [rawDocuments, flowRecovery.flush])
  useEffect(() => {
    if (!rawDocuments) return
    void courseInputs.persist()
  }, [localDraftVersion, courseConnection.documents, rawDocuments])
  const preserveFlowInputs = async (documentIds?: readonly string[]): Promise<boolean> => {
    const state = useEditorStore.getState()
    const entries = Object.entries(state.flowDocumentDrafts ?? {}).flatMap(([documentId, draft]) => {
      if (!draft || documentIds && !documentIds.includes(documentId)) return []
      const snapshot = state.courseView.documents.find(value => value.documentId === documentId)
      if (!snapshot || snapshot.model.kind !== 'course-v10') return []
      return [{ target: { projectId: snapshot.model.project.id, projectPath: snapshot.binding.kind === 'file' ? snapshot.binding.path : null,
        surfaceId: draft.surfaceId, revision: draft.revision, epoch: snapshot.epoch }, draft }]
    })
    return flowRecovery.flushAll(entries)
  }

  const courseProjectLifecycle = useCourseProjectLifecycle({
    captureIdentity() {
      const view = useEditorStore.getState().courseView
      return { projectId: view.project?.id ?? '', revision: view.project?.revision ?? 0,
        documentId: view.activeDocumentId ?? '', epoch: view.snapshot?.epoch ?? '' }
    },
    documents: {
      ready: () => {
        const host = documentsWithSaveDirectory
        if (!host) return Promise.reject(new Error('课程文档服务不可用'))
        return useEditorStore.getState().connectCourseDocuments(host, {
          preserveFlow: preserveFlowInputs, suspendFlow: flowRecovery.suspendForClose, resumeFlow: flowRecovery.resumeAfterCloseCancelled,
        })
      },
      snapshot: () => useEditorStore.getState().courseView.snapshot,
      create: (surface, canvas) => useEditorStore.getState().createCourseDocument(surface, canvas),
      createFrom: content => useEditorStore.getState().createCourseDocumentFrom(content.project, content.resources),
      open: path => useEditorStore.getState().openCourseDocument(path),
      save: saveAs => useEditorStore.getState().saveCourseDocument(saveAs, saveDirectory.current ?? undefined),
      drain: () => drainCourseDocument(),
      settle: async () => {
        const state = useEditorStore.getState(), id = state.courseView.activeDocumentId
        if (!id) throw new Error('当前没有打开的课件')
        const [snapshot] = await state.courseBridge.drain([id])
        if (!snapshot) throw new Error('当前课件已关闭')
        return snapshot
      },
    },
    hasUnsavedChanges: () => selectHasUnsavedCourseChanges(useEditorStore.getState()),
    projectPath: () => useEditorStore.getState().projectPath,
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
    desktopAvailable: () => Boolean(window.desktopAPI),
    openProjectFile: () => desktopApi().openProject(),
    openWorkspaceProjectFile: async path => {
      const result = await desktopApi().lesson?.({ operation: 'open-project', path })
      if (!result?.projectFile) throw new Error('文件未读取成功')
      return result.projectFile
    },
    openRecentProjectFile: (path) => desktopApi().openRecentProject({ path }),
    confirmProjectOpen: (confirmationId) => desktopApi().confirmProjectOpen({ confirmationId }),
    beforeReplace: async () => await prepareCourseClose(),
    onProjectReplaced: () => lessonShell.current?.detachLesson(),
    preserveBeforeClose: async (mode, ids) => {
      if (!ids) {
        await elementCards.flushDrafts()
        if (!await flowRecovery.flush()) return false
      }
      if (!(await lessonShell.current?.preserveAll(mode, ids) ?? true)) return false
      await useEditorStore.getState().courseBridge.drain(ids)
      return true
    },
    prepareBeforeClose: (mode, ids) => prepareCourseClose(ids, mode),
    subscribePreserveAndCloseRequest: handler => window.desktopAPI?.onRequestPreserveAndClose?.(async ids => {
      const ready = await handler(ids)
      return { ready, dirty: courseInputs.hasDirty(ids) || Boolean(lessonShell.current?.hasDirtyInputs(ids)), ...(ready && saveDirectory.current ? { suggestedDirectory: saveDirectory.current } : {}) }
    }) ?? (() => undefined),
    beforeSave: () => flowRecovery.flush(),
    listRecentProjects: async () => {
      if (!window.desktopAPI) return []
      return window.desktopAPI.listRecentProjects()
    },
    setWindowDirtyState: async (nextDirty) => {
      if (!window.desktopAPI) return
      await window.desktopAPI.setDirtyState(nextDirty)
    },
    subscribeSaveAndCloseRequest: (handler) => {
      if (!window.desktopAPI) return () => undefined
      return window.desktopAPI.onRequestSaveAndClose(async ids => {
        const ready = await handler(ids)
        return { ready, dirty: courseInputs.hasDirty(ids) || Boolean(lessonShell.current?.hasDirtyInputs(ids)), ...(ready && saveDirectory.current ? { suggestedDirectory: saveDirectory.current } : {}) }
      })
    },
  }, {
    dirty: allCourseDirty || lessonDirty,
    projectTitle: activeWorkspaceDocument?.kind === 'course' ? activeCourseDocument?.title ?? activeWorkspaceDocument.name : activeWorkspaceDocument?.name ?? '',
    projectPath,
    documentTrigger: activeCourseDocument,
    sidecarTrigger: sidecarFiles,
    componentPackagesTrigger: courseConnection.views,
    slideDraftTrigger: courseConnection.pending,
    spatialDraftTrigger: courseConnection.pending,
    flowDraftTrigger: flowDocumentDraft,
    textEditTrigger: undefined,
  })
  // The work area's "从 PPT 新建 果铃工程": a new untitled H5 presentation holding the PPT's pages (M21).
  const newProjectFromPptx = async ({ name, bytes }: { name: string; bytes: Uint8Array }) => {
    const title = pptxCourseStem(name)
    const course = await createCourseFromPptx(bytes, title)
    if (!await confirmPptxLosses(name, course.issues)) return false
    const issues = course.issues.length
    const created = await courseProjectLifecycle.newProjectFrom(async () => course, { origin: 'lesson' })
    if (created) setStatus(issues ? `已从 PPT 新建 果铃工程「${title}」；${issues} 项内容未保留或已简化` : `已从 PPT 新建 果铃工程「${title}」`)
    return created
  }

  const htmlImportInFlight = useRef(false)
  const openHtmlImport = async (directory?: SaveDirectoryContext, sourceEntryId?: string) => {
    try {
      if (!desktopApi().htmlImport) throw new Error('HTML 导入服务不可用')
      const documentId = useEditorStore.getState().courseView.activeDocumentId
      if (!documentId) throw new Error('请先打开一份 果铃工程')
      const snapshot = await useEditorStore.getState().drainCourseDocument()
      if (snapshot.documentId !== documentId || snapshot.model.kind !== 'course-v10') {
        throw new Error('当前 果铃工程已切换，请重新发起导入')
      }
      const project = snapshot.model.project
      const activeLocationId = selectActiveCourseLocationId(useEditorStore.getState())
      const destinations: HtmlImportDestination[] = project.surfaces.flatMap<HtmlImportDestination>(surface => {
        if (surface.kind === 'slide') return [{ locationId: surface.id, surfaceType: 'slide', label: surface.title }]
        if (surface.kind !== 'flow') return []
        const bodyIds = (ids: readonly string[]): string[] => ids.flatMap(id => [id, ...bodyIds(project.instances[id]?.childIds ?? [])])
        const anchors = bodyIds(flowBodyIds(project, surface.id)).flatMap(id => {
          const instance = project.instances[id], definition = instance && project.definitions[instance.definitionId]
          const data = instance?.data
          const paragraph = definition?.implementation.kind === 'builtin' && definition.implementation.key === 'guoling.text'
            || data && typeof data === 'object' && !Array.isArray(data) && data.type === 'paragraph'
          return paragraph ? [{ blockId: id, label: instance.name ?? definition?.title ?? id }] : []
        })
        return [{ locationId: surface.id, surfaceType: 'flow', label: surface.title, anchors }]
      })
      if (!destinations.length) throw new Error('当前 果铃工程没有可导入 HTML 的页面')
      destinations.sort((left, right) => Number(right.locationId === activeLocationId) - Number(left.locationId === activeLocationId))
      const sourcePath = sourceEntryId
        ? (await desktopApi().workspaceFiles!({ type: 'resolve', workspaceId: directory!.workspaceId, entryId: sourceEntryId })).resolvedPath
        : null
      const current = useEditorStore.getState().courseView
      if (current.activeDocumentId !== snapshot.documentId || current.snapshot?.epoch !== snapshot.epoch || current.snapshot.revision !== snapshot.revision) {
        throw new Error('当前 果铃工程已变化，请重新发起导入')
      }
      setHtmlImportDialog({ documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: project.id,
        surfaceId: current.surfaceId, stateId: current.activeStateId,
        sourcePath, destinations, busy: false, error: null })
    } catch (error) {
      setError(readableError(error, '无法开始 HTML 导入'))
    }
  }
  const confirmHtmlImport = async (target: { locationId: string; anchorBlockId?: string }) => {
    const dialog = htmlImportDialog
    if (!dialog || dialog.busy || htmlImportInFlight.current) return
    htmlImportInFlight.current = true
    setHtmlImportDialog({ ...dialog, busy: true, error: null })
    try {
      const snapshot = await drainCourseDocument(dialog.documentId)
      if (snapshot.documentId !== dialog.documentId || snapshot.epoch !== dialog.epoch
        || snapshot.model.kind !== 'course-v10' || snapshot.model.project.id !== dialog.projectId) {
        throw new Error('当前 果铃工程已变化，请重新选择导入位置')
      }
      const api = desktopApi().htmlImport
      if (!api) throw new Error('HTML 导入服务不可用')
      const surface = snapshot.model.project.surfaces.find(surface => surface.id === target.locationId)
      const workspace = (document.querySelector<HTMLElement>('.flow-workspace__scroll') ?? document.querySelector<HTMLElement>('.editor-center'))?.getBoundingClientRect()
      const viewport = surface?.kind === 'flow' && workspace && workspace.height > 0
        ? { width: Math.ceil(surface.flow?.layout.readingWidth ?? workspace.width), height: Math.ceil(workspace.height) } : undefined
      const result = await api.import({
        documentId: dialog.documentId, epoch: dialog.epoch, revision: snapshot.revision,
        surfaceId: target.locationId, ...(target.anchorBlockId ? { anchorInstanceId: target.anchorBlockId } : {}),
        stateId: dialog.surfaceId === target.locationId ? dialog.stateId : null, ...(viewport ? { viewport } : {}),
        source: dialog.sourcePath ? { kind: 'file', path: dialog.sourcePath } : { kind: 'choose' },
      })
      if (!result) {
        setHtmlImportDialog(null)
        setStatus('已取消 HTML 导入')
        return
      }
      if (result.receipt.status !== 'applied') {
        throw new Error(result.receipt.status === 'unchanged' ? 'HTML 页面没有产生可导入内容' : ('message' in result.receipt ? result.receipt.message : 'HTML 导入未提交'))
      }
      const confirmed = await drainCourseDocument(dialog.documentId)
      if (confirmed.documentId !== dialog.documentId || confirmed.epoch !== dialog.epoch
        || confirmed.revision < result.receipt.revision) {
        throw new Error('导入已提交，但当前文档尚未同步；请重新打开页面核对')
      }
      setHtmlImportDialog(null)
      setStatus(result.notices.length ? `HTML 页面已导入；${result.notices.join('；')}` : 'HTML 页面已导入到所选位置')
    } catch (error) {
      setHtmlImportDialog(current => current?.documentId === dialog.documentId && current.epoch === dialog.epoch
        ? { ...current, busy: false, error: readableError(error, 'HTML 导入失败') } : current)
    } finally {
      htmlImportInFlight.current = false
    }
  }

  useEffect(() => window.desktopAPI?.onRequestSave(() => {
    void (async () => {
      const target = await lessonShell.current?.saveActiveDocument()
      if (target === 'course') await courseProjectLifecycle.saveProject(false)
    })().catch(error => setError(error instanceof Error ? error.message : '当前文档保存失败'))
  }), [courseProjectLifecycle.saveProject, setError])

  const courseDelivery = useCourseDelivery({
    // A sessionless workbench (every course document closed) has no publish source;
    // reporting that as the designed "no publishable document" failure keeps the
    // internal bridge error out of the user-facing export contract.
    captureSnapshot: async () => {
      const state = useEditorStore.getState()
      if (!state.courseView.activeDocumentId) return null
      return courseDeliverySnapshot(await state.drainCourseDocument())
    },
    readCanonicalSnapshot: () => courseDeliverySnapshot(useEditorStore.getState().courseView.snapshot),
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
    navigateFinding(item) {
      const state = useEditorStore.getState()
      const project = state.courseView.project
      if (!project) return
      const route = resolveCourseProjectDeliveryFindingRoute(project, item)
      if (!route.available) { state.setStatus(route.reason); return }
      if (route.surfaceId) state.courseKernel.selectSurface(route.surfaceId)
      state.setEditingScope(route.scope)
      state.courseKernel.selectInstances(route.instanceId ? [route.instanceId] : [], route.surfaceId)
      state.setActiveTab(route.tab)
    },
    compileComponent: input => desktopApi().compileComponent(input),
    captureAuthoringObservation: rect => desktopApi().captureAuthoringObservation!(rect),
    exportHtml: (input) => desktopApi().exportHtml(input),
    exportWebPackage: (input) => desktopApi().exportWebPackage(input),
    exportPdf: (input) => desktopApi().exportPdf(input),
    exportBinary: (input) => desktopApi().exportBinary(input),
  }, {
    documentTrigger: activeCourseDocument,
    sidecarTrigger: sidecarFiles,
    componentPackagesTrigger: courseConnection.views,
  })

  const captureInsertionPlacement = (target: CapturedCourseTarget): CourseInsertionOptions => {
    const current = useEditorStore.getState()
    if (selectEditingScope(current) !== 'global') {
      if (target.project.surfaces.find(surface => surface.id === target.surfaceId)?.kind !== 'spatial') return {}
      const camera = current.readSpatialView(target.surfaceId ?? '', target.documentId).camera
      return { center: { x: camera.x, y: camera.y } }
    }
    const selected = target.instanceIds[0]
    const owns = (roots: readonly string[]): boolean => roots.some(id => id === selected || owns(target.project.instances[id]?.childIds ?? []))
    return { container: { kind: 'global', plane: selected && owns(target.project.global.underlay) ? 'underlay' : 'overlay' } }
  }
  useCourseCanvasPaste({
    kernel: courseKernel,
    isReadOnly: () => courseDelivery.previewOpen || useEditorStore.getState().canvasMode === 'run',
    ownsPaste: () => {
      const state = useEditorStore.getState()
      return !state.courseView.project || Boolean(state.flowDocumentDraft?.composing)
    },
    capturePlacement: captureInsertionPlacement,
    copyInternalClipboard: (event, cut) => useEditorStore.getState().copyCourseClipboard(event.clipboardData, cut),
    pasteInternalClipboard: event => useEditorStore.getState().pasteCourseClipboard(event.clipboardData),
    reportError: setError,
    commitStatus: setStatus,
  })
  const mediaImport = useMediaImport({
    kernel: courseKernel,
    capturePlacement: captureInsertionPlacement,
    selectImage: () => desktopApi().selectImage(),
    selectImages: () => desktopApi().selectImages(),
    selectAudios: () => desktopApi().selectAudios(),
    selectAudio: () => desktopApi().selectAudio(),
    selectVideos: () => desktopApi().selectVideos(),
    selectVideo: () => desktopApi().selectVideo(),
    runBusy: run, commitStatus: setStatus, reportError: setError,
  })

  const dropWorkspaceMedia: WorkspaceMediaDropHandler = async request => {
    if (!request.target.documentId) return { ok: false, reason: '请先打开一份课件再拖入媒体。' }
    const placed = await mediaImport.importWorkspaceMedia(request)
    if (!placed.ok || !placed.assetId) return { ok: false, reason: placed.reason ?? '媒体拖入未完成。' }
    try {
      const confirmed = await useEditorStore.getState().drainCourseDocument(request.target.documentId)
      if (confirmed.documentId !== request.target.documentId || confirmed.revision <= request.target.revision
        || confirmed.model.kind !== 'course-v10' || !confirmed.model.project.assets[placed.assetId]) {
        return { ok: false, reason: '当前文档没有确认这次媒体插入，请检查后重新拖入。' }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : '媒体插入尚未得到文档确认。' }
    }
  }

  const componentLibrary = useComponentLibrary({
    kernel: courseKernel,
    capturePlacement: captureInsertionPlacement,
    selectComponentPackage: () => desktopApi().selectComponentPackage(),
    selectComponentPackages: () => desktopApi().selectComponentPackages(),
    desktopAvailable: () => Boolean(window.desktopAPI),
    loadCatalog: () => desktopApi().loadComponentCatalog(),
    readCatalogPackage: input => desktopApi().readComponentCatalogPackage(input),
    installLibraryEntry: bytes => desktopApi().installComponentLibraryEntry({ bytes }),
    deleteCatalogPackage: input => desktopApi().deleteComponentCatalogPackage(input),
    runBusy: run, commitStatus: setStatus, reportError: setError,
  })

  const [pendingFlowComponent, setPendingFlowComponent] = useState<{ command: FlowInsertCommand; capture: CapturedFlowMenuTarget } | null>(null)
  const insertFlowMenu = (command: FlowInsertCommand, payload?: FlowDeepInsertPayload, captured?: CapturedFlowMenuTarget, entry?: ComponentLibraryEntry) => {
    void run(async () => {
      const target = captured ?? captureFlowMenuTarget(courseKernel)
      const options = resolveFlowMenuInsertionOptions(target, command)
      if (command.kind === 'component') {
        if (!entry && !payload?.packageId) { setPendingFlowComponent({ command, capture: target }); return }
        const inserted = entry
          ? await insertComponentPackagesAtTarget(courseKernel, target, [entry], options)
          : await insertComponentDefinitionAtTarget(courseKernel, target, payload!.packageId!, payload?.presetId, options)
        if (!inserted.ok) throw new Error(inserted.reason ?? '组件插入未提交')
        await drainCourseDocument(target.documentId)
        setStatus(`已插入${command.label}`)
        return
      }
      let result
      if ((command.kind === 'image' || command.kind === 'video' || command.kind === 'audio') && !payload?.assetId) {
        const selected = await (command.kind === 'image' ? mediaImport.selectImageAsset()
          : command.kind === 'video' ? mediaImport.selectVideoAsset() : mediaImport.selectAudioAsset())
        if (!selected) return
        result = await insertCourseMedia(courseKernel, target, [selected], options)
      } else result = await commitFlowMenu(courseKernel, target, command, { assetId: payload?.assetId })
      const confirmed = await drainCourseDocument(target.documentId)
      const current = courseKernel.readView()
      if (current.activeDocumentId === target.documentId && current.surfaceId === target.surfaceId && result.instanceIds[0]) {
        requestFlowBlockSelection({ documentId: target.documentId, surfaceId: result.surfaceId, blockId: result.instanceIds[0] })
        if (command.kind === 'heading' || command.kind === 'text-box') requestFlowBlockFocus({ documentId: target.documentId,
          surfaceId: result.surfaceId, blockId: result.instanceIds[0], revision: confirmed.revision })
      }
      setStatus(`已插入${command.label}`)
    }, `${command.label}插入失败。`)
  }

  useEditorKeyboardRouter({
    isReadOnly: () => courseDelivery.previewOpen || useEditorStore.getState().canvasMode === 'run',
    captureDeleteSnapshot(target) {
      const state = useEditorStore.getState(), view = state.courseView
      const kind = view.project?.surfaces.find(surface => surface.id === view.surfaceId)?.kind
      const contentEditable = target instanceof HTMLElement && target.isContentEditable
      const draft = state.slideContentEdit
      const draftImplementation = draft && view.project?.definitions[draft.definitionId]?.implementation
      return {
        hasCourseProject: Boolean(view.project),
        selection: state.createLiveEditorSelectionSnapshot(target),
        contentEditable,
        hasFlowSession: kind === 'flow', flowComposing: Boolean(state.flowDocumentDraft?.composing),
        flowTextFocus: contentEditable, flowHasSelection: view.selectedInstanceIds.length > 0,
        hasSlideBackend: kind === 'slide', slideTextEdit: Boolean(draft),
        slideFormulaEdit: Boolean(draftImplementation && draftImplementation.kind === 'builtin' && draftImplementation.key === 'guoling.formula'),
        ...(target instanceof HTMLElement ? { slideTagName: target.tagName } : {}),
        selectedNodeCount: view.selectedInstanceIds.length, editingText: Boolean(draft),
      }
    },
    routeEditorAction: (actionId, snapshot) => (
      useEditorStore.getState().routeEditorAction(actionId, snapshot)
    ),
    deleteSelectedNodes: () => useEditorStore.getState().deleteSelectedNodes(),
    copySelection: () => useEditorStore.getState().copySelectedNodes(),
    cutSelection: () => useEditorStore.getState().cutSelectedNodes(),
    pasteClipboard: () => useEditorStore.getState().pasteNodes(),
    duplicateSelection: () => useEditorStore.getState().duplicateSelectedNodes(),
    nudgeSelection: (dx, dy) => useEditorStore.getState().nudgeSelection(dx, dy),
    undo: () => useEditorStore.getState().undo(),
    redo: () => useEditorStore.getState().redo(),
    selectAll() {
      const state = useEditorStore.getState()
      state.selectNodes(selectEditingNodes(state).map((node) => node.id))
    },
    clearSelection: () => useEditorStore.getState().selectNodes([]),
    selectedCount: () => selectSelectedNodeIds(useEditorStore.getState()).length,
    saveProject: (saveAs) => {
      void courseProjectLifecycle.saveProject(saveAs)
    },
    newProject: () => courseProjectLifecycle.newProject(),
    openProject: () => courseProjectLifecycle.openProject(),
  })

  const handleExportDiagnostics = useCallback(() => {
    void run(async () => {
      const result = await desktopApi().exportDiagnostics()
      if (result) useEditorStore.getState().setStatus(`诊断报告已导出到 ${result.path}`)
    }, '诊断报告导出失败。请换一个可写目录后重试。')
  }, [run])
  const mediaImportRef = useRef(mediaImport); mediaImportRef.current = mediaImport
  const slideLight = useMemo(() => createSlideLightEditingPort({
    kernel: courseKernel,
    async chooseAudio() {
      const prepared = await mediaImportRef.current.selectTargetMedia({
        kind: 'audio', captureTarget: () => courseKernel.captureTarget(),
        isTargetCurrent: target => courseKernel.readView().documents.some(snapshot => snapshot.documentId === target.documentId && snapshot.epoch === target.epoch),
      })
      if (!prepared) return null
      prepared.assertCurrent()
      return { asset: prepared.asset, bytes: prepared.bytes }
    },
    placeAudio: async (target, selected) => { await insertCoursePreparedMedia(courseKernel, target, selected) },
    runInteraction: (target, kind, value) => setComponentClickInteraction(courseKernel, target, kind, value),
    readSounds: readComponentInteractionSounds,
  }), [courseKernel])
  const elementCardNavigation = useMemo(() => createComponentElementCardNavigation({ kernel: courseKernel, reportError: setError,
    activateDocument: id => useEditorStore.getState().activateCourseDocument(id), drainDocument: id => drainCourseDocument(id),
  }), [courseKernel, setError])
  const slideLightPageTarget = slideLight.capturePage()
  const slideLightPageView = slideLightPageTarget ? slideLight.viewPage(slideLightPageTarget) : null
  const courseEditorActions = useMemo<CourseEditorActions>(() => ({
    replaceImage: () => { void mediaImportRef.current.selectAndImportImage('replace') },
    replaceVideo: () => { void mediaImportRef.current.replaceSelectedVideo() },
    transformImage: operations => transformCourseImageAtTarget(courseKernel, courseKernel.captureTarget(), operations),
    slideLight,
  }), [courseKernel, slideLight])

  return (
    <ProjectColorPaletteContext.Provider value={projectColors}>
    <CourseEditorActionsContext.Provider value={courseEditorActions}>
    <LessonWorkspaceHost ref={lessonShell} projectPath={projectPath} documents={documentsWithSaveDirectory ?? undefined} onSaveDirectoryChange={setSaveDirectory}
      courseDocuments={{ documents: courseConnection.documents, activation: courseConnection.activation,
        activeDocumentId: courseConnection.activeDocumentId,
        activate: id => useEditorStore.getState().activateCourseDocument(id),
        close: async id => {
          return useEditorStore.getState().closeCourseDocument(id)
        } }}
      prepareCourseDocuments={async ids => { await useEditorStore.getState().drainAllCourseDocuments(ids) }}
      captureCourseDocument={async writable => {
        const state = useEditorStore.getState(), { activeDocumentId, surfaceId } = state.courseView
        if (!activeDocumentId) throw new Error('当前没有打开的课件。')
        return [await captureCourseDocumentReference({ documentId: activeDocumentId, surfaceId }, writable,
          id => state.drainCourseDocument(id))]
      }}
      onOpenProject={path => courseProjectLifecycle.openRecentProject(path, { origin: 'lesson' })} onNewProject={() => courseProjectLifecycle.newProject({ origin: 'lesson' })} onNewProjectFromPptx={newProjectFromPptx} onDirtyChange={setLessonDirty} onActiveDocumentChange={setActiveWorkspaceDocument}
      onImportHtml={(directory, sourceEntryId) => { void openHtmlImport(directory, sourceEntryId) }}
      toolbarExtras={flowRecovery.retained.length > 0 && <button type="button" title="查看保留的正文原稿" onClick={() => setRetainedFlowOpen(true)}><FileClock size={14} />保留原稿 ({flowRecovery.retained.length})</button>}
>
    <BundledFontBoundary><CourseEditorFrame lightTools={<CourseLightToolbar
      slideLightPage={slideLightPageView ? { view: slideLightPageView, run: command => slideLight.runPage(slideLightPageView.target, command) } : null}
      documentId={courseConnection.activeDocumentId}
      isCurrentDocument={id => useEditorStore.getState().courseView.activeDocumentId === id}
      canUndo={canUndoCourse} canRedo={canRedoCourse}
      canUndoLatestAgent={courseConnection.snapshot?.undoHead?.actor === 'agent'}
      undo={() => useEditorStore.getState().undo()} redo={() => useEditorStore.getState().redo()}
      undoLatestAgent={() => { void useEditorStore.getState().undoLatestAgentCourseDocument().catch(error => setError(error instanceof Error ? error.message : '撤销最近 AI 修改失败')) }}
      save={() => { void courseProjectLifecycle.saveProject(false) }}
      saveAs={() => { void courseProjectLifecycle.saveProject(true) }}
      onReplaceImage={() => { void mediaImport.selectAndImportImage('replace') }}
      onAddText={() => { void (async () => {
        const before = useEditorStore.getState(), target = before.courseKernel.captureTarget()
        await before.addTextNode()
        await drainCourseDocument(target.documentId)
        const after = useEditorStore.getState(), view = after.courseView
        if (view.activeDocumentId !== target.documentId || view.surfaceId !== target.surfaceId) return
        const id = view.selectedInstanceId
        if (!id || target.instanceIds.includes(id)) return
        const instance = view.project?.instances[id]
        const definition = instance && view.project?.definitions[instance.definitionId]
        if (definition?.implementation.kind !== 'builtin' || definition.implementation.key !== 'guoling.text') return
        if (insertSurface === 'flow' && target.surfaceId) {
          requestFlowBlockFocus({ documentId: target.documentId, surfaceId: target.surfaceId, blockId: id, revision: view.project!.revision })
        } else after.beginTextEdit(id, 'canvas')
      })().catch(error => setError(readableError(error, '文字插入尚未确认。'))) }}
      onImportHtml={() => { void openHtmlImport() }}
      onAddImage={() => { void mediaImport.selectAndImportImage('add') }}
      onAddVideo={() => { void mediaImport.selectAndImportVideo('add') }}
      onAddAudio={() => {
        if (insertSurface === 'flow') { void mediaImport.selectAndInsertFlowAudio(); return }
        if (insertSurface === 'slide') {
          const target = slideLight.capturePage()
          if (!target) { setError('当前演示页尚未就绪，请稍后重试'); return }
          void slideLight.placeAudio(target).catch(error => setError(error instanceof Error ? error.message : '放置音频失败'))
          return
        }
        void mediaImport.selectAndImportAudio()
      }}
      onAddShape={shapeType => useEditorStore.getState().addShapeNode(shapeType)}
      onAddFormula={() => useEditorStore.getState().addFormulaNode()}
      flowInsertMenu={{ onInsert: command => insertFlowMenu(command) }}
      insertSurface={insertSurface} editingScope={editingScope} spatialScope={spatialInsertScope}
      mode={courseCanvasMode}
      busy={busy} hasFlowSurface={hasFlowSurface}
      onPreview={courseDelivery.openPreview} onExport={courseDelivery.exportCourse} onExportSettings={courseDelivery.openExportSettings}
      onToggleProperties={() => { useEditorStore.getState().setActiveTab('properties'); proEditorRailController.toggle('properties') }}
      elementCards={elementCardNavigation}
      reportError={setError} />}>
      <CourseAdvancedChrome><TopToolbar
        busy={busy}
        onNew={courseProjectLifecycle.newProject}
        onNewSpatial={courseProjectLifecycle.newSpatialProject}
        onNewFlow={courseProjectLifecycle.newFlowProject}
        onOpen={courseProjectLifecycle.openProject}
        recentProjects={courseProjectLifecycle.recentProjects}
        onOpenRecent={courseProjectLifecycle.openRecentProject}
        onSave={(saveAs) => void courseProjectLifecycle.saveProject(saveAs)}
        healthSummary={projectHealthSummary}
        onOpenHealth={() => setProjectHealthOpen(true)}
        onOpenRecipes={() => openDesignTool('recipe')}
        onOpenProductivity={() => openDesignTool('productivity')}
        onImportPptx={() => openDesignTool('pptx')}
        onOpenMaterials={() => setMaterialsOpen(true)}
        onPreview={courseDelivery.openPreview}
        onExport={courseDelivery.exportCourse}
        onExportSettings={courseDelivery.openExportSettings}
      /></CourseAdvancedChrome>
      {courseDelivery.exportSettingsOpen && <CourseExportSettingsDialog pages={courseDelivery.exportSettingsPages}
        onCancel={courseDelivery.closeExportSettings} onConfirm={courseDelivery.confirmExportSettings} />}
      <EditorPanelLayout
        className={`app-main${activeTab === 'developer' ? ' app-main--developer' : ''}`}
      >
        <ScenePanel />
        <div className="editor-center">
          <CourseWorkspaces
            onDropWorkspaceMedia={dropWorkspaceMedia}
            onAddImage={(x, y) =>
              void mediaImport.selectAndImportImage('add', { x, y })
            }
            onAddVideo={(x, y) =>
              void mediaImport.selectAndImportVideo('add', { x, y })
            }
            onSelectImageAsset={mediaImport.selectImageAsset}
          onSelectMediaAsset={mediaImport.selectMediaAsset}
          />
          <CourseBottomNavigation documentId={courseConnection.activeDocumentId} />
        </div>
        <RightSidebar
          onFlowInsert={insertFlowMenu}
          onAddImage={(x, y) =>
            void mediaImport.selectAndImportImage('add', { x, y })
          }
          onReplaceImage={() => void mediaImport.selectAndImportImage('replace')}
          onAddVideo={(x, y) => void mediaImport.selectAndImportVideo('add', { x, y })}
          onImportImage={() => void mediaImport.selectAndImportImage('library')}
          onImportAudio={() => void mediaImport.selectAndImportAudio()}
          onImportVideo={() => void mediaImport.selectAndImportVideo('library')}
          onImportExternalComponents={componentLibrary.importExternalPackages}
          onReplaceComponent={componentLibrary.replacePackage}
          componentCatalog={componentLibrary.componentCatalog}
          onRefreshComponentCatalog={componentLibrary.refreshCatalog}
          onAddCatalogComponents={componentLibrary.addCatalogPackages}
          onUpdateCatalogComponent={componentLibrary.requestCatalogUpdate}
          onExtractSelection={componentLibrary.extractSelection}
          onDeleteCatalogComponent={componentLibrary.deleteCatalogPackage}
        />
      </EditorPanelLayout>
      {pendingFlowComponent && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingFlowComponent(null)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="flow-component-choice-title" onMouseDown={event => event.stopPropagation()}>
          <h2 id="flow-component-choice-title">选择要插入的组件</h2>
          <p>将组件插入{pendingFlowComponent.command.destination === 'document' ? '正文' : '纸面'}。选择已有组件或内置组件。</p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {componentLibrary.installedEntries.map(entry =>
              <button key={entry.id} type="button" className="secondary-button" onClick={() => {
                const pending = pendingFlowComponent
                setPendingFlowComponent(null)
                insertFlowMenu(pending.command, { packageId: entry.id }, pending.capture, entry)
              }}>{entry.title}</button>)}
            {selectCurrentCatalogPackages(componentLibrary.componentCatalog.packages.filter(entry => entry.sourceTrust === 'built-in' && !componentLibrary.installedEntries.some(installed => installed.id === entry.packageId)))
              .map(entry => <button key={entry.packageId} type="button" className="secondary-button" onClick={() => {
                const pending = pendingFlowComponent
                setPendingFlowComponent(null)
                void componentLibrary.prepareCatalogPackage(entry).then(data => {
                  if (data) insertFlowMenu(pending.command, { packageId: data.id }, pending.capture, data)
                }).catch(error => setError(error instanceof Error ? error.message : '组件包准备失败'))
              }}>{entry.name}</button>)}
          </div>
          <div className="modal__actions">
            <button type="button" className="secondary-button" onClick={() => setPendingFlowComponent(null)}>取消</button>
          </div>
        </section>
      </div>}
      <footer className="status-bar" aria-live="polite">
        <span className="status-dot" />
        <span>{courseDelivery.exportProgress === 'cancelling' ? '正在清理已取消的导出…' : busy ? '正在处理…' : (statusMessage ?? '就绪')}</span>
        {courseDelivery.exportProgress === 'generating' && <button type="button" onClick={courseDelivery.cancelExport}>取消导出</button>}
        {courseDelivery.exportProgress === 'saving' && <span>正在准备保存，可在保存对话框取消</span>}
        <span className="status-bar__spacer" />
        <span>{editingScope === 'global' ? '全局层' : activeScene?.title ?? '未打开课程'}</span>
        <span>·</span>
        <span>{editingScope === 'global' ? `${editingItemCount} 个全局元素` : `${editingItemCount} 个节点`}</span>
        {(slideSceneCount > RECOMMENDED_PROJECT_SCENES ||
          editingItemCount > RECOMMENDED_SCENE_NODES) && (
          <>
            <span>·</span>
            <span className="status-bar__warning" title="大型 果铃工程建议使用网页包导出，以减少启动和内存压力">
              大型 果铃工程 · 建议网页包
            </span>
          </>
        )}
        <span>·</span>
        <span>{selectedNodeIds.length > 1 ? `已选 ${selectedNodeIds.length} 个图层` : selectedItemName ? `已选：${selectedItemName}` : editingScope === 'global' ? '未选择全局元素' : '未选择节点'}</span>
        <span>·</span>
        <span>{projectPath ? '工程已命名' : '尚未保存'}</span>
      </footer>

      {retainedFlowOpen && flowRecovery.retained.length > 0 && <div className="modal-backdrop" role="presentation">
        <section className="modal copyable-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="retained-flow-title">
          <header className="copyable-summary-dialog__header"><h2 id="retained-flow-title">保留的正文原稿</h2>
            <button type="button" className="icon-button" title="关闭原稿" aria-label="关闭原稿" onClick={() => setRetainedFlowOpen(false)}><X size={17} /></button>
          </header>
          {flowRecovery.retained.map((record, index) => <details key={`${record.epoch}:${record.revision}`} open={index === 0}>
            <summary>版本 {record.revision} · {record.surfaceId}</summary>
            <textarea className="copyable-summary-dialog__content" aria-label={`版本 ${record.revision} 的正文原稿`} value={record.source} readOnly />
          </details>)}
          <div className="modal__actions"><button type="button" className="primary-button" onClick={() => setRetainedFlowOpen(false)}>完成</button></div>
        </section>
      </div>}

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
        open={Boolean(componentLibrary.replacementRequest)}
        title="审阅组件包替换"
        message={componentLibrary.replacementRequest
          ? (() => {
              const current = activeCourseDocument?.definitions[componentLibrary.replacementRequest!.packageId]
              const next = componentLibrary.replacementRequest!.packageData
              return `组件：${next.title} (${next.id})\n当前版本：${current?.version ?? '未知'}\n新版本：${Object.values(next.definitions)[0]?.version ?? '未指定'}\n文件：${componentLibrary.replacementRequest!.sourceFileName}\n\n确认后，场景与全局层中的全部实例会切换到该包并保留当前属性；此操作可以撤销。请只替换为已审阅的可信代码。`
            })()
          : ''}
        confirmLabel="确认替换"
        onCancel={componentLibrary.cancelReplacement}
        onConfirm={componentLibrary.confirmReplacement}
      />
      <ConfirmDialog
        open={Boolean(componentLibrary.catalogUpdateRequest)}
        title="审阅目录组件更新"
        message={componentLibrary.catalogUpdateRequest
          ? (() => {
              const entry = componentLibrary.catalogUpdateRequest!.entries[0]!
              return `组件：${entry.name} v${entry.version}\n来源：${entry.sourceLabel}\nSHA-256：${entry.sha256}\n质量：${entry.quality}\n发布阻断：${entry.releaseBlockers?.join('、') || '无'}\n\n更新会改变工程锁定的组件代码和全部实例，必须明确审阅。读取时仍会重新校验哈希。`
            })()
          : ''}
        confirmLabel="确认更新"
        onCancel={componentLibrary.cancelCatalogUpdate}
        onConfirm={componentLibrary.confirmCatalogUpdate}
      />
      <ProjectHealthPanel
        open={projectHealthOpen}
        onClose={() => setProjectHealthOpen(false)}
        onExportDiagnostics={handleExportDiagnostics}
      />
      {materialsOpen && activeCourseDocument && <MaterialLibraryDialog key={`${activeCourseDocument.id}:${projectPath}`} projectId={activeCourseDocument.id} projectPath={projectPath} onClose={() => setMaterialsOpen(false)} onInsert={async material => {
        const state = useEditorStore.getState()
        const document = selectActiveCourseProjectDocument(state)
        const locationId = selectActiveCourseLocationId(state)
        if (!document || !locationId || state.projectPath !== projectPath || document.id !== material.workspace.projectId) throw new Error('工程已变化，请重新打开材料库')
        const receipt = await insertMaterialCitation(state.courseKernel, createMaterialCitationRequest({ kernel: state.courseKernel, material }))
        if (receipt.status !== 'committed') throw new Error('材料引用未提交')
        await drainCourseDocument(receipt.documentId)
      }} />}
      {designTool?.kind === 'recipe' && <div className="modal-backdrop" role="presentation">
        <section className="design-production-dialog" role="dialog" aria-modal="true" aria-label="新建配方页">
          <header><h2>新建配方页</h2><button type="button" aria-label="关闭配方" onClick={() => setDesignTool(null)}><X size={18} /></button></header>
          <RecipePanel project={activeCourseDocument ?? designTool.context.document}
            locationId={courseConnection.surfaceId ?? designTool.context.target.surfaceId ?? ''}
            sessionGeneration={courseConnection.activation} captureTarget={() => courseKernel.captureTarget()}
            error={errorMessage ?? undefined}
            onApply={input => { void run(async () => {
              const result = await applyRecipe(courseKernel, input)
              if (!result.ok) throw new Error(result.reason)
              await drainCourseDocument(input.target.documentId)
              setDesignTool(null)
            }, '配方页创建失败。') }} />
        </section>
      </div>}
      {(designTool?.kind === 'productivity' || designTool?.kind === 'pptx') && <ProductivityDialog
        key={designTool.kind}
        pptxOnly={designTool.kind === 'pptx'}
        getContext={() => designTool.context}
        getAssetFiles={() => courseKernel.readView().views.find(view => view.documentId === designTool.context.target.documentId)?.model.resources.assets ?? {}}
        onCommit={async step => {
          const store = useEditorStore.getState()
          if (!await store.commitDesignProduction(step)) return false
          if (step.createdSurfaceId && store.courseView.activeDocumentId === step.documentId) store.courseKernel.selectSurface(step.createdSurfaceId, step.documentId)
          setDesignTool(null)
          return true
        }}
        onClose={() => setDesignTool(null)}
      />}
      <CopyableSummaryDialog
        open={mediaImport.batchOperationSummary !== null}
        title={mediaImport.batchOperationSummary?.title ?? '批次结果'}
        summary={mediaImport.batchOperationSummary?.summary ?? ''}
        onClose={mediaImport.clearBatchSummary}
      />
      <ExportPreflightDialog
        report={courseDelivery.exportPreflightReport}
        onCancel={courseDelivery.cancelPreflight}
        onContinue={courseDelivery.continuePreflightExport}
        onLocate={courseDelivery.locatePreflightItem}
        onSaveReport={courseDelivery.savePreflightReport}
      />
      <ExportSizeWarningDialog
        open={courseDelivery.largeHtmlByteLength !== null}
        byteLength={courseDelivery.largeHtmlByteLength ?? 0}
        onCancel={courseDelivery.cancelLargeHtml}
        onExportWebPackage={courseDelivery.exportLargeHtmlAsWebPackage}
        onContinueSingleHtml={courseDelivery.continueLargeHtml}
      />
      {courseDelivery.previewOpen ? (
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
                <p className="modal__message">查看实际播放效果</p>
              </div>
              <div className="course-preview-chrome__actions">
                <button
                  type="button"
                  className="secondary-button"
                  data-testid="course-preview-previous"
                  onClick={courseDelivery.previousPreview}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  data-testid="course-preview-next"
                  onClick={courseDelivery.nextPreview}
                >
                  下一页
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={courseDelivery.closePreview}
                >
                  关闭预览
                </button>
              </div>
            </header>
            <div className="course-preview-viewport">
              <div
                ref={courseDelivery.bindPreviewHost}
                className="course-preview-host"
                data-testid="course-preview-host"
                data-page-insets={formatPageInsets(WINDOW_PAGE_INSETS)}
              />
              {courseDelivery.previewFeedback ? (
                <div
                  className={`runtime-preview-loading runtime-preview-loading--${courseDelivery.previewFeedback.kind} course-try-run-feedback`}
                  role={courseDelivery.previewFeedback.kind === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                  data-testid="course-preview-feedback"
                >
                  <div className="runtime-preview-loading__panel">
                    {courseDelivery.previewFeedback.kind === 'loading' && (
                      <LoaderCircle
                        className="runtime-preview-loading__spinner"
                        size={24}
                        aria-hidden="true"
                      />
                    )}
                    <strong>{courseDelivery.previewFeedback.title}</strong>
                    <span>{courseDelivery.previewFeedback.message}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </CourseEditorFrame></BundledFontBoundary>
    {htmlImportDialog && <HtmlImportDialog
      sourceName={htmlImportDialog.sourcePath?.split(/[\\/]/).pop() ?? null}
      destinations={htmlImportDialog.destinations}
      busy={htmlImportDialog.busy}
      error={htmlImportDialog.error}
      onCancel={() => setHtmlImportDialog(null)}
      onImport={target => { void confirmHtmlImport(target) }} />}
    </LessonWorkspaceHost>
    </CourseEditorActionsContext.Provider>
    </ProjectColorPaletteContext.Provider>
  )
}
