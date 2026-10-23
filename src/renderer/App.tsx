import { componentSurfaces, componentContainers } from '../shared/contracts/component-platform/project'
import { captureCourseDocumentReference, workbenchSelection } from './workbench/SelectionContextController'
import { CourseAdvancedChrome, CourseEditorFrame, useCourseEditorChrome } from './documents/CourseEditorChromeContext'
import { CourseLightToolbar } from './documents/CourseLightToolbar'
import { openCoursePageProperties } from './composition/properties/openCoursePageProperties'
import { HtmlImportDialog, type HtmlImportDestination } from './documents/HtmlImportDialog'
import { planFlowImport } from './project/flowImportTransaction'
import { createBlankCourseProjectV10, createBlankProgramProject } from '../core/course/createCourseProjectV10'
import { loadBuiltinComponentSource } from '../core/components/source/builtinSources'
import { applyComponentOperation, captureComponentOperation } from '../core/drivers/courseV10Operations'
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
import { collectComponentProjectHealth } from '../core/components/componentProjectHealth'
import { summarizeCourseProjectHealth } from '../shared/componentProjectHealth'
import { createSlideLightEditingPort } from './composition/selection/slideLightEditingPort'
import { useComponentLibrary } from './app/useComponentLibrary'
import { prepareComponentDefinitionEntryAtTarget, insertComponentPackagesAtTarget } from './components/insertComponentPackages'
import { selectCurrentCatalogPackages, selectProjectLibraryDefinitions } from './components/componentLibraryModel'
import { useCourseDelivery } from './app/useCourseDelivery'
import { courseDeliverySnapshot } from './app/courseDeliverySnapshot'
import { resolveCourseProjectDeliveryFindingRoute, selectCourseProjectDiagnosticRoute } from './diagnostics/projectHealthNavigation'
import { CoursePreviewNotices } from './app/CoursePreviewNotices'
import { adaptCourseDocumentActivation, useCourseProjectLifecycle } from './app/useCourseProjectLifecycle'
import { useFlowDocumentRecovery } from './app/useFlowDocumentRecovery'
import { createFlowDocumentRecoveryPort } from './authoring/flowDocumentDraft'
import { captureFlowMenuTarget, refreshFlowMenuTarget, releaseFlowMenuTarget, flowInsertionBoundaryBlockId, resolveFlowMenuInsertionOptions, insertFlowMenu as commitFlowMenu, type CapturedFlowMenuTarget, type FlowInsertCommand } from './ui/flow/flowInsertCommands'
import { insertCourseMedia, insertCoursePreparedMedia, prepareCourseLibraryAsset, transformCourseImageAtTarget, type CourseInsertionOptions, type ImportedAssetBatchItem } from './media/commitCourseMediaAuthoring'
import { DocumentInsertionTargetError } from '../shared/document/blockInsertion'
import { readComponentInteractionSounds, setComponentClickInteraction } from './interactions/componentInteractionAuthoring'
import { flowBodyIds } from './componentPlatform/surfaces/flow/documentProjection'
import { capturedCourseViewIsCurrent, isCourseComponentInputFailure, settleCourseComponentInput, type CapturedCourseTarget, type CourseUnconfirmedInputIdentity } from './documents/CourseV10DocumentBridge'
import { exportPdfWithSignal } from './export/pdfExportClient'
import { courseInsertionViewPlacement } from './media/commitCourseMediaAuthoring'
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
  selectEditingNodes, selectEditingScope, selectMediaAssetFiles, selectActiveCourseResources,
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
import { buildFrozenDelivery } from './workbench/delivery/frozenDeliveryRenderer'
import type { ProductivityContext } from './authoring/productivity'
import { BundledFontBoundary } from './app/BundledFontBoundary'
import { confirmPptxLosses } from './project/confirmPptxLosses'
import { pptxCourseStem } from './project/pptxCourseCreation'
import { preparePptxCourseOffThread } from './project/pptxImportClient'
import { CourseV10RuntimeView } from './components/CourseV10RuntimeView'
import type { DocumentSnapshot } from '../shared/workbench/document'
import type { CourseProjectV10 } from '../shared/contracts/component-platform'
import { projectWithBackgroundPreview } from './authoring/backgroundPreview'
import { projectWithSlideContentDraft } from './store/slices/slideAuthoringSlice'
import { selectActiveSlideContentEdit } from './store/editorStore'

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

function recoveryInputText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return JSON.stringify(payload, null, 2) ?? ''
  const input = payload as Record<string, unknown>
  for (const key of ['raw', 'spotText', 'source']) if (typeof input[key] === 'string') return input[key] as string
  const value = input.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const files = (value as Record<string, unknown>).files
    if (files && typeof files === 'object' && !Array.isArray(files)) {
      const text = Object.entries(files).flatMap(([name, file]) => file && typeof file === 'object' && typeof (file as { text?: unknown }).text === 'string'
        ? [`${name}\n${(file as { text: string }).text}`] : []).join('\n\n')
      if (text) return text
    }
  }
  return JSON.stringify(value ?? payload, null, 2)
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
    const renderProject = (effectiveProject: CourseProjectV10) => projectWithBackgroundPreview(
      projectWithSlideContentDraft(effectiveProject, contentDraft, { documentId: document.documentId, epoch,
        surfaceId: document.surfaceId, activeStateId: document.activeStateId }),
      preview, document.documentId, document.surfaceId, document.activeStateId, epoch)
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
  const captureWorkspaceNavigation = () => {
    const owner = lessonShell.current, token = owner?.captureNavigationIdentity()
    return () => Boolean(owner && owner === lessonShell.current && owner.captureNavigationIdentity() === token)
  }
  const beginWorkspaceNavigation = () => {
    lessonShell.current?.cancelNavigation()
    return captureWorkspaceNavigation()
  }
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
  const hasFlowSurface = useEditorStore(state => Boolean((state.courseView.project == null ? undefined : componentContainers(state.courseView.project).some(surface => surface.kind === 'flow'))))
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
  const unconfirmedInput = courseKernel.bridge.captureUnconfirmedInput()
  const [checkingInput, setCheckingInput] = useState<string | null>(null)
  const [knownUnappliedInput, setKnownUnappliedInput] = useState<CourseUnconfirmedInputIdentity | null>(null)
  const allCourseDirty = useEditorStore(selectHasUnsavedCourseDocuments)
  const projectPath = useEditorStore((state) => state.projectPath)
  const activeCourseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const projectColors = useMemo(() => activeCourseDocument?.designTokens?.colors.map(token => ({ name: token.label, value: token.color })) ?? [], [activeCourseDocument?.designTokens])
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const courseResources = useEditorStore(selectActiveCourseResources)
  const flowDocumentDraft = useEditorStore(state => state.flowDocumentDraft)
  const localDraftVersion = useEditorStore(state => state.localDraftVersion)
  const preservedInputDrafts = useMemo(() => courseInputs.readDrafts(), [courseInputs, localDraftVersion, courseConnection.documents])
  const preservedInputCount = preservedInputDrafts.reduce((count, input) => count + input.advanced.length + input.properties.length, 0)
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
  const insertSurface = (activeCourseDocument == null ? undefined : componentContainers(activeCourseDocument).find(surface => surface.id === courseConnection.surfaceId)?.kind) ?? null
  const spatialInsertScope = useEditorStore(state => (state.courseView.project == null ? undefined : componentContainers(state.courseView.project).find(surface => surface.id === state.courseView.surfaceId)?.kind) === 'spatial'
    ? state.readSpatialView(state.courseView.surfaceId ?? '', state.courseView.activeDocumentId ?? '').scope : null)
  const activeTab = useEditorStore(state => state.activeTab)
  const editingItemCount = editingScope === 'global'
    ? (activeCourseDocument?.global.underlay.length ?? 0) + (activeCourseDocument?.global.overlay.length ?? 0)
    : (activeCourseDocument == null ? undefined : componentContainers(activeCourseDocument).find(surface => surface.id === courseConnection.surfaceId)?.childIds.length) ?? 0
  const activeScene = (activeCourseDocument == null ? undefined : componentContainers(activeCourseDocument).find(surface => surface.id === courseConnection.surfaceId))
  const slideSceneCount = (activeCourseDocument == null ? undefined : componentSurfaces(activeCourseDocument).filter(surface => surface.kind === 'slide').length) ?? 0
  const errorMessage = useEditorStore((state) => state.errorMessage)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const courseProjectHealthDiagnostics = useMemo(
    () => activeCourseDocument && projectHealthOpen
      ? collectComponentProjectHealth(activeCourseDocument, courseResources)
      : null,
    [activeCourseDocument, courseResources, projectHealthOpen],
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

  const flowRecoveryPort = useMemo(() => rawDocuments ? createFlowDocumentRecoveryPort(rawDocuments) : null, [rawDocuments])
  const flowRecovery = useFlowDocumentRecovery({
    target: insertSurface === 'flow' && activeCourseDocument && courseConnection.snapshot && courseConnection.surfaceId ? {
      documentId: courseConnection.snapshot.documentId, projectId: activeCourseDocument.id, projectPath, surfaceId: courseConnection.surfaceId,
      revision: activeCourseDocument.revision, epoch: courseConnection.snapshot.epoch,
    } : null,
    draft: flowDocumentDraft,
    port: flowRecoveryPort,
    onRestore(draft) {
      const current = useEditorStore.getState()
      if (current.courseView.activeDocumentId !== courseConnection.snapshot?.documentId || current.courseView.surfaceId !== draft.surfaceId || current.courseView.project?.revision !== draft.revision || current.flowDocumentDraft) return false
      current.restoreFlowDocumentDraft(draft)
      return useEditorStore.getState().flowDocumentDraft === draft
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
    const prepareSource = api?.onRequestPrepareDocumentInput?.(documentId => workbenchSelection.flushInput(documentId))
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
  const preserveFlowInputs = async (documentIds?: readonly string[], retain = false): Promise<boolean> => {
    const state = useEditorStore.getState()
    const entries = Object.entries(state.flowDocumentDrafts ?? {}).flatMap(([documentId, draft]) => {
      if (!draft || documentIds && !documentIds.includes(documentId)) return []
      const snapshot = state.courseView.documents.find(value => value.documentId === documentId)
      if (!snapshot || snapshot.model.kind !== 'course-v10') return []
      return [{ target: { documentId, projectId: snapshot.model.project.id, projectPath: snapshot.binding.kind === 'file' ? snapshot.binding.path : null,
        surfaceId: draft.surfaceId, revision: draft.revision, epoch: snapshot.epoch }, draft }]
    })
    return flowRecovery.flushAll(entries, { retain })
  }
  const inspectUnconfirmedInput = async (finish = false) => {
    const foregroundIsCurrent = captureWorkspaceNavigation()
    const target = courseKernel.bridge.captureUnconfirmedInput()
    if (!target) return
    const originalMessage = useEditorStore.getState().errorMessage
    const currentScope = () => {
      const view = courseKernel.readView()
      return foregroundIsCurrent() && view.activeDocumentId === target.documentId && view.snapshot?.epoch === target.epoch
    }
    setCheckingInput(target.operationId)
    try {
      if (finish) {
        // These are existing raw-input owners. End never clears their records,
        // another operation, or a live composition.
        await courseInputs.persist([target.documentId])
        if (!await preserveFlowInputs([target.documentId], true)) throw new Error('当前正文原稿尚未保全，请稍后再结束这次操作。')
        const outcome = await courseKernel.bridge.endUnconfirmedInput(target)
        if (!currentScope()) return
        if (outcome === 'pending') { setStatus('这次修改仍未确认，现有内容和输入继续保留。'); return }
        setKnownUnappliedInput(null)
        setStatus(outcome === 'applied' ? '已核实，这次修改已经应用。' : '这次未应用操作已结束，现有内容和其他输入保留。')
      } else {
        const outcome = await courseKernel.bridge.queryUnconfirmedInput(target)
        if (!currentScope()) return
        if (outcome.status === 'unsubmitted' || outcome.status === 'settled' && !('revision' in outcome.result)) {
          setKnownUnappliedInput(target)
          setStatus('已核实，这次修改没有应用；可以结束此操作，现有内容和原稿保留。')
          return
        }
        if (outcome.status !== 'settled') { setStatus('这次修改暂未确认，现有内容和输入继续保留。'); return }
        setKnownUnappliedInput(null)
        setStatus('已核实，这次修改已经应用。')
      }
      const state = useEditorStore.getState()
      if (!courseKernel.readView().error && state.errorMessage === originalMessage) state.setError(null)
    } catch (error) {
      const remaining = courseKernel.bridge.captureUnconfirmedInput(target.documentId)
      if (currentScope() && remaining?.epoch === target.epoch && remaining.operationId === target.operationId)
        setStatus(error instanceof Error ? `${error.message}；原输入仍保留。` : '暂未核实，原输入仍保留。')
    } finally { setCheckingInput(current => current === target.operationId ? null : current) }
  }

  const unconfirmedInputActions = unconfirmedInput && activeWorkspaceKind.current === 'course' && <span style={{ display: 'inline-flex', gap: 6, flexShrink: 0 }}>
    <button type="button" style={{ minHeight: 22, height: 22, padding: '1px 6px', fontSize: 11 }} title="只查询原操作，不重复写入"
      disabled={checkingInput === unconfirmedInput.operationId} onClick={() => { void inspectUnconfirmedInput() }}>
      {checkingInput === unconfirmedInput.operationId ? '正在核实…' : '核实上次修改'}</button>
    {knownUnappliedInput?.documentId === unconfirmedInput.documentId && knownUnappliedInput.epoch === unconfirmedInput.epoch
      && knownUnappliedInput.operationId === unconfirmedInput.operationId && <button type="button" style={{ minHeight: 22, height: 22, padding: '1px 6px', fontSize: 11 }}
        disabled={checkingInput === unconfirmedInput.operationId} title="保留已登记原稿，只结束已核实未写入的这一次操作"
        onClick={() => { void inspectUnconfirmedInput(true) }}>结束未应用操作</button>}
  </span>
  const completeCourseActivation = (result: void | boolean | { documentId: string; activated: boolean }, activateIf?: () => boolean): void | boolean => {
    return adaptCourseDocumentActivation(result, activateIf, () => lessonShell.current?.cancelNavigation())
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
      snapshot: documentId => {
        const view = useEditorStore.getState().courseView
        return documentId ? view.documents.find(snapshot => snapshot.documentId === documentId) ?? null : view.snapshot
      },
      create: async (surface, canvas, activateIf) => completeCourseActivation(await useEditorStore.getState().createCourseDocument(surface, canvas, activateIf), activateIf),
      createFrom: async (content, activateIf) => completeCourseActivation(await useEditorStore.getState().createCourseDocumentFrom(content.project, content.resources, activateIf), activateIf),
      open: async (path, activateIf) => completeCourseActivation(await useEditorStore.getState().openCourseDocument(path, activateIf), activateIf),
      save: (saveAs, documentId) => useEditorStore.getState().saveCourseDocument(saveAs, saveDirectory.current ?? undefined, documentId),
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
    beginForeground: beginWorkspaceNavigation,
    onProjectReplaced: foreground => lessonShell.current?.detachLesson(foreground),
    preserveBeforeClose: async (mode, ids) => {
      if (!ids) {
        await elementCards.flushDrafts()
        if (!await flowRecovery.flush()) return false
      }
      if (!(await lessonShell.current?.preserveAll(mode, ids) ?? true)) return false
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
  const newProjectFromPptx = async ({ name, bytes }: { name: string; bytes: Uint8Array }, signal?: AbortSignal, foreground?: () => boolean) => {
    const foregroundIsCurrent = foreground ?? beginWorkspaceNavigation()
    const title = pptxCourseStem(name)
    const course = await preparePptxCourseOffThread(bytes, name, signal)
    if (signal?.aborted || !foregroundIsCurrent()) return false
    if (!await confirmPptxLosses(name, course.issues)) return false
    if (signal?.aborted || !foregroundIsCurrent()) return false
    const issues = course.issues.length
    const created = await courseProjectLifecycle.newProjectFrom(async () => ({ project: course.model.project, resources: course.model.resources }), { origin: 'lesson', foreground: foregroundIsCurrent })
    if (created && foregroundIsCurrent()) setStatus(issues ? `已从 PPT 新建 果铃工程「${title}」；${issues} 项内容未保留或已简化` : `已从 PPT 新建 果铃工程「${title}」`)
    return created
  }

  const htmlImportInFlight = useRef(false)
  const [flowImportIssues, setFlowImportIssues] = useState<{ name: string; issues: string[] } | null>(null)
  const openFlowImport = async (directory?: SaveDirectoryContext, sourceEntryId?: string) => {
    const foregroundIsCurrent = beginWorkspaceNavigation()
    try {
      const service = desktopApi().flowImport
      if (!service) throw new Error('文档导入服务不可用，请重新打开应用')
      const bridge = useEditorStore.getState().courseBridge
      const target = activeWorkspaceDocument?.kind === 'course' ? bridge.captureTarget() : null
      const originalDocument = bridge.read().activeDocumentId
      let activateImportedProject = false
      const imported = await service.read({ directory, sourceEntryId })
      if (!imported) return
      if (target) {
        const current = bridge.captureTarget(target.documentId)
        if (current.epoch !== target.epoch) throw new Error('原导入工程已关闭，原文件仍保留。')
        const planned = planFlowImport(current.project, imported)
        await bridge.editCaptured(bridge.capture(planned.edits, { ...current, surfaceId: null, activeStateId: null }), 'flow-import')
        if (foregroundIsCurrent() && capturedCourseViewIsCurrent(bridge.read(), target)) {
          bridge.selectSurface(target.documentId, planned.surfaceId)
          activateImportedProject = true
        }
      } else {
        if (!foregroundIsCurrent() || bridge.read().activeDocumentId !== originalDocument) return
        const project = createBlankCourseProjectV10(imported.name.replace(/\.[^.]+$/, ''))
        const planned = planFlowImport(project, imported)
        planned.edits.push({ type: 'surface.remove', surfaceId: componentSurfaces(project)[0].id })
        const next = applyComponentOperation(project, captureComponentOperation(project, planned.edits))
        const created = await courseProjectLifecycle.newProjectFrom(async () => ({ project: next,
          resources: { assets: Object.fromEntries(imported.assets.map(entry => [entry.asset.id, entry.bytes])), components: {} } }), { origin: 'lesson', foreground: foregroundIsCurrent })
        if (!created) return
        activateImportedProject = foregroundIsCurrent()
      }
      if (activateImportedProject) lessonShell.current?.showProject(foregroundIsCurrent)
      setStatus(`已将 ${imported.name} 导入为可编辑 Flow；原文件保留。`)
      if (imported.issues.length && activateImportedProject && foregroundIsCurrent()) setFlowImportIssues({ name: imported.name, issues: imported.issues })
    } catch (failure) { setError(readableError(failure, '文档导入未完成；原文件仍保留')) }
  }
  const openHtmlImport = async (directory?: SaveDirectoryContext, sourceEntryId?: string) => {
    const foregroundIsCurrent = beginWorkspaceNavigation()
    try {
      if (!desktopApi().htmlImport) throw new Error('HTML 导入服务不可用')
      // An empty/plain-document work area must not import into an unrelated background course.
      // The existing lifecycle preserves every prior document and creates the canonical target.
      if (activeWorkspaceKind.current !== 'course' || !useEditorStore.getState().courseView.activeDocumentId) {
        if (!await courseProjectLifecycle.newProject({ origin: 'lesson', foreground: foregroundIsCurrent }) || !foregroundIsCurrent()) return
        lessonShell.current?.showProject(foregroundIsCurrent)
      }
      const documentId = useEditorStore.getState().courseView.activeDocumentId
      if (!documentId) throw new Error('请先打开一份 果铃工程')
      const snapshot = await useEditorStore.getState().drainCourseDocument()
      if (!foregroundIsCurrent()) return
      if (snapshot.documentId !== documentId || snapshot.model.kind !== 'course-v10') {
        throw new Error('当前 果铃工程已切换，请重新发起导入')
      }
      const project = snapshot.model.project
      const activeLocationId = selectActiveCourseLocationId(useEditorStore.getState())
      const rootContainers = componentSurfaces(project)
      const activeContainer = componentContainers(project).find(value => value.id === activeLocationId)
      const importContainers = activeContainer && !rootContainers.some(value => value.id === activeContainer.id)
        ? [activeContainer, ...rootContainers] : rootContainers
      const destinations: HtmlImportDestination[] = importContainers.flatMap<HtmlImportDestination>(surface => {
        if (surface.kind === 'slide') return [{ locationId: surface.id, surfaceType: 'slide', label: surface.title }]
        if (surface.kind !== 'flow') return []
        const bodyIds = (ids: readonly string[]): string[] => ids.flatMap(id => project.instances[id]?.container
          ? [] : [id, ...bodyIds(project.instances[id]?.childIds ?? [])])
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
      if (!foregroundIsCurrent()) return
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
    const foregroundIsCurrent = captureWorkspaceNavigation()
    const originalViewport = (document.querySelector<HTMLElement>('.flow-workspace__scroll') ?? document.querySelector<HTMLElement>('.editor-center'))?.getBoundingClientRect()
    htmlImportInFlight.current = true
    const pendingDialog = { ...dialog, busy: true, error: null }
    setHtmlImportDialog(pendingDialog)
    try {
      const snapshot = await drainCourseDocument(dialog.documentId)
      if (snapshot.documentId !== dialog.documentId || snapshot.epoch !== dialog.epoch
        || snapshot.model.kind !== 'course-v10' || snapshot.model.project.id !== dialog.projectId) {
        throw new Error('当前 果铃工程已变化，请重新选择导入位置')
      }
      const api = desktopApi().htmlImport
      if (!api) throw new Error('HTML 导入服务不可用')
      const surface = componentContainers(snapshot.model.project).find(surface => surface.id === target.locationId)
      const workspace = originalViewport
      const viewport = surface?.kind === 'flow' && workspace && workspace.height > 0
        ? { width: Math.ceil(surface.flow?.layout.readingWidth ?? workspace.width), height: Math.ceil(workspace.height) } : undefined
      const result = await api.import({
        documentId: dialog.documentId, epoch: dialog.epoch, revision: snapshot.revision,
        surfaceId: target.locationId, ...(target.anchorBlockId ? { anchorInstanceId: target.anchorBlockId } : {}),
        stateId: dialog.surfaceId === target.locationId ? dialog.stateId : null, ...(viewport ? { viewport } : {}),
        source: dialog.sourcePath ? { kind: 'file', path: dialog.sourcePath } : { kind: 'choose' },
      })
      if (!result) {
        setHtmlImportDialog(current => current === pendingDialog ? null : current)
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
      setHtmlImportDialog(current => current === pendingDialog ? null : current)
      if (foregroundIsCurrent()) setStatus(result.notices.length ? `HTML 页面已导入；${result.notices.join('；')}` : 'HTML 页面已导入到所选位置')
    } catch (error) {
      setHtmlImportDialog(current => current === pendingDialog
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
      void state.navigateCourseView(() => {
        selectCourseProjectDiagnosticRoute(state.courseKernel, route, state.setEditingScope)
        state.setActiveTab(route.tab)
      })
    },
    compileComponent: input => desktopApi().compileComponent(input),
    buildOutput: buildFrozenDelivery,
    captureAuthoringObservation: rect => desktopApi().captureAuthoringObservation!(rect),
    exportHtml: (input) => desktopApi().exportHtml(input),
    exportWebPackage: (input) => desktopApi().exportWebPackage(input),
    exportPdf: (input, options) => exportPdfWithSignal(desktopApi(), input, options),
    exportBinary: (input) => desktopApi().exportBinary(input),
  }, {
    documentTrigger: activeCourseDocument,
    sidecarTrigger: sidecarFiles,
    componentPackagesTrigger: courseConnection.views,
    liveDocuments: courseConnection.documents,
  })

  const captureInsertionPlacement = (target: CapturedCourseTarget): CourseInsertionOptions => {
    const current = useEditorStore.getState()
    const scope = selectEditingScope(current)
    const camera = scope !== 'global' && componentContainers(target.project).find(surface => surface.id === target.surfaceId)?.kind === 'spatial'
      ? current.readSpatialView(target.surfaceId ?? '', target.documentId).camera : null
    return courseInsertionViewPlacement(target, { scope, plane: current.courseView.editingPlane, camera })
  }
  useCourseCanvasPaste({
    kernel: courseKernel,
    isReadOnly: () => activeWorkspaceKind.current !== 'course' || courseDelivery.previewOpen || useEditorStore.getState().canvasMode === 'run',
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

  const [pendingFlowComponent, setPendingFlowComponent] = useState<{ command: FlowInsertCommand; capture: CapturedFlowMenuTarget;
    payload?: FlowDeepInsertPayload; entry?: ComponentLibraryEntry; media?: ImportedAssetBatchItem; reason?: string; afterBlockId?: string | null; inputFailure?: unknown } | null>(null)
  const pendingFlowComponentRef = useRef(pendingFlowComponent); pendingFlowComponentRef.current = pendingFlowComponent
  useEffect(() => () => { const pending = pendingFlowComponentRef.current; if (pending) releaseFlowMenuTarget(pending.capture) }, [])
  const closeFlowComponentChoice = async () => {
    const pending = pendingFlowComponent
    if (!pending) return
    try {
      if (pending.inputFailure && await settleCourseComponentInput(pending.inputFailure) === 'pending') {
        setError('这次插入结果仍在核实，已准备内容保留，请稍后重试。'); return
      }
    } catch (error) { setError(readableError(error, '暂未核实这次插入，已准备内容仍保留。')); return }
    releaseFlowMenuTarget(pending.capture)
    setPendingFlowComponent(current => current === pending ? null : current)
  }
  const insertFlowMenu = (command: FlowInsertCommand, payload?: FlowDeepInsertPayload, captured?: CapturedFlowMenuTarget,
    entry?: ComponentLibraryEntry, preparedMedia?: ImportedAssetBatchItem, afterBlockId?: string) => {
    let target: CapturedFlowMenuTarget
    try { target = captured ?? captureFlowMenuTarget(courseKernel, command.destination === 'document') }
    catch (error) { setError(readableError(error, `${command.label}插入失败。`)); return }
    void run(async () => {
      let kept = false, media = preparedMedia
      try {
      if (command.kind === 'component') {
        if (!entry && !payload?.packageId) { kept = true; setPendingFlowComponent({ command, capture: target }); return }
        if (payload?.presetId) throw new Error('此定义没有该预设，请选择组件库的完整条目。')
        entry ??= await prepareComponentDefinitionEntryAtTarget(courseKernel, target, payload!.packageId!, { sourceInstanceId: payload?.sourceInstanceId, catalogEntry: payload?.catalogEntry })
      }
      if (['image', 'video', 'audio'].includes(command.kind) && !media) {
        media = payload?.assetId ? await prepareCourseLibraryAsset(courseKernel, target, payload.assetId)
          : await (command.kind === 'image' ? mediaImport.selectImageAsset() : command.kind === 'video' ? mediaImport.selectVideoAsset() : mediaImport.selectAudioAsset()) ?? undefined
        if (!media) return
      }
      target = await refreshFlowMenuTarget(courseKernel, target)
      const options = resolveFlowMenuInsertionOptions(target, command, {
        ...(payload?.chartType ? { chartType: payload.chartType } : {}),
        ...(afterBlockId ? { flowSelection: { revision: String(target.project.revision), kind: 'object', blockId: afterBlockId } as const } : {}),
      })
      if (command.kind === 'component') {
        const inserted = await insertComponentPackagesAtTarget(courseKernel, target, [entry!], options)
        if (!inserted.ok) throw inserted.targetInvalid ? new DocumentInsertionTargetError(inserted.reason ?? '组件插入位置已失效') : inserted.inputFailure ?? new Error(inserted.reason ?? '组件插入未提交')
        await drainCourseDocument(target.documentId)
        setStatus(`已插入${command.label}`)
        return
      }
      let result
      if (media) result = await insertCourseMedia(courseKernel, target, [media], options)
      else result = await commitFlowMenu(courseKernel, target, command, options)
      const confirmed = await drainCourseDocument(target.documentId)
      const current = courseKernel.readView()
      if (current.activeDocumentId === target.documentId && current.surfaceId === target.surfaceId && result.surfaceId && result.instanceIds[0]) {
        requestFlowBlockSelection({ documentId: target.documentId, surfaceId: result.surfaceId, blockId: result.instanceIds[0] })
        if (command.kind === 'heading' || command.kind === 'text-box') requestFlowBlockFocus({ documentId: target.documentId,
          surfaceId: result.surfaceId, blockId: result.instanceIds[0], revision: confirmed.revision })
      }
      setStatus(`已插入${command.label}`)
      } catch (error) {
        if (!(error instanceof DocumentInsertionTargetError) && !isCourseComponentInputFailure(error)) throw error
        // The prepared entry/media is retained below before ending only this failed proposal.
        let boundary: string | null = null
        try { boundary = flowInsertionBoundaryBlockId(target) } catch { /* A deleted bookmark has no valid block-boundary fallback. */ }
        const pending = { command, capture: target, payload, entry, media, reason: error.message, afterBlockId: boundary,
          ...(isCourseComponentInputFailure(error) ? { inputFailure: error } : {}) }
        setPendingFlowComponent(pending)
        if (isCourseComponentInputFailure(error) && await settleCourseComponentInput(error) === 'applied') {
          setPendingFlowComponent(current => current === pending ? null : current)
          setStatus(`已插入${command.label}`)
        } else setError(error.message)
      } finally { if (!kept) releaseFlowMenuTarget(target) }
    }, `${command.label}插入失败。`)
  }
  const resumeFlowInsertion = async (afterBlock = false) => {
    const pending = pendingFlowComponent
    if (!pending) return
    try { if (pending.inputFailure) {
      const outcome = await settleCourseComponentInput(pending.inputFailure)
      if (outcome === 'pending') { setError('这次插入结果仍在核实，已准备内容保留，请稍后重试。'); return }
      if (outcome === 'applied') { setPendingFlowComponent(current => current === pending ? null : current); setStatus('插入已经完成'); return }
    } } catch (error) { setError(readableError(error, '暂未核实这次插入，已准备内容仍保留。')); return }
    let target: CapturedFlowMenuTarget
    try {
      target = captureFlowMenuTarget(courseKernel, pending.command.destination === 'document')
      if (target.documentId !== pending.capture.documentId || target.surfaceId !== pending.capture.surfaceId) {
        releaseFlowMenuTarget(target)
        throw new Error('请回到原讲义页面选择插入位置，已准备内容仍保留。')
      }
    } catch (error) { setError(readableError(error, '请在原讲义重新选择插入位置')); return }
    setPendingFlowComponent(null)
    insertFlowMenu(pending.command, pending.payload, target, pending.entry, pending.media, afterBlock ? pending.afterBlockId ?? undefined : undefined)
  }

  useEditorKeyboardRouter({
    isReadOnly: () => activeWorkspaceKind.current !== 'course' || courseDelivery.previewOpen || useEditorStore.getState().canvasMode === 'run',
    captureDeleteSnapshot(target) {
      const state = useEditorStore.getState(), view = state.courseView
      const kind = (view.project == null ? undefined : componentContainers(view.project).find(surface => surface.id === view.surfaceId)?.kind)
      const contentEditable = target instanceof HTMLElement && target.isContentEditable
      const draft = selectActiveSlideContentEdit(state)
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
  const courseEditorActions = useMemo<CourseEditorActions>(() => ({
    replaceImage: () => { void mediaImportRef.current.selectAndImportImage('replace') },
    replaceVideo: () => { void mediaImportRef.current.replaceSelectedVideo() },
    transformImage: operations => transformCourseImageAtTarget(courseKernel, courseKernel.captureTarget(), operations),
    slideLight,
  }), [courseKernel, slideLight])

  const courseCommonTools = (toolbarMode: 'light' | 'deep') => <CourseLightToolbar
    toolbarMode={toolbarMode}
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
    onImportFlow={() => { void openFlowImport() }} onImportPptx={() => openDesignTool('pptx')}
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
    onOpenPageProperties={insertSurface ? () => { void openCoursePageProperties({ kernel: useEditorStore.getState().courseKernel,
      drain: id => drainCourseDocument(id), open: surfaceId => {
        const current = useEditorStore.getState()
        current.setEditingScope('scene')
        if ((current.courseView.project == null ? undefined : componentContainers(current.courseView.project).find(surface => surface.id === surfaceId)?.kind) === 'spatial') current.setSpatialGraphSelection(null, surfaceId)
        current.setActiveTab('properties'); proEditorRailController.open('properties')
      },
    }).catch(error => setError(readableError(error, '打开页面属性失败。'))) } : undefined}
    elementCards={elementCardNavigation}
    reportError={setError} />

  return (
    <ProjectColorPaletteContext.Provider value={projectColors}>
    <CourseEditorActionsContext.Provider value={courseEditorActions}>
    <LessonWorkspaceHost ref={lessonShell} projectPath={projectPath} documents={documentsWithSaveDirectory ?? undefined} onSaveDirectoryChange={setSaveDirectory}
      courseDocuments={{ documents: courseConnection.documents, activation: courseConnection.activation,
        activeDocumentId: courseConnection.activeDocumentId,
        captureScope: () => {
          if (activeWorkspaceKind.current !== 'course') return () => true
          const original = useEditorStore.getState(), scope = selectEditingScope(original), mode = original.canvasMode
          const ownsView = original.courseBridge.captureViewScope()
          return () => activeWorkspaceKind.current === 'course' && selectEditingScope(useEditorStore.getState()) === scope
            && useEditorStore.getState().canvasMode === mode && ownsView()
        },
        activate: (id, activateIf) => useEditorStore.getState().activateCourseDocument(id, activateIf),
        close: async id => {
          return useEditorStore.getState().closeCourseDocument(id)
        } }}
      prepareCourseDocuments={ids => useEditorStore.getState().flushAllCourseDocuments(ids)}
      captureCourseDocument={async (writable, prepare = true) => {
        const state = useEditorStore.getState(), { activeDocumentId, surfaceId } = state.courseView
        if (!activeDocumentId) throw new Error('当前没有打开的课件。')
        return [await captureCourseDocumentReference({ documentId: activeDocumentId, surfaceId }, writable,
          id => prepare ? state.drainCourseDocument(id) : rawDocuments!.read(id))]
      }}
      onOpenProject={(path, foreground) => courseProjectLifecycle.openRecentProject(path, { origin: 'lesson', foreground })} onNewProject={foreground => courseProjectLifecycle.newProject({ origin: 'lesson', foreground })} onNewProjectFromPptx={newProjectFromPptx} onDirtyChange={setLessonDirty} onActiveDocumentChange={setActiveWorkspaceDocument}
      onImportHtml={(directory, sourceEntryId) => { void openHtmlImport(directory, sourceEntryId) }} onImportFlow={(directory, sourceEntryId) => { void openFlowImport(directory, sourceEntryId) }}
      toolbarExtras={<>
        {flowRecovery.retained.length + preservedInputCount > 0 && <button type="button" title="查看保留的输入原稿" onClick={() => setRetainedFlowOpen(true)}><FileClock size={14} />输入原稿 ({flowRecovery.retained.length + preservedInputCount})</button>}
      </>}
>
    <BundledFontBoundary><CourseEditorFrame lightTools={courseCommonTools('light')}>
      <CourseAdvancedChrome><TopToolbar
        commonTools={courseCommonTools('deep')}
        busy={busy}
        onNew={courseProjectLifecycle.newProject}
        onNewSpatial={courseProjectLifecycle.newSpatialProject}
        onNewFlow={courseProjectLifecycle.newFlowProject}
        onNewProgram={() => { void courseProjectLifecycle.newProjectFrom(async () => {
          await loadBuiltinComponentSource('guoling.html-program')
          return { project: createBlankProgramProject(), resources: { components: {}, assets: {} } }
        }) }}
        onOpen={courseProjectLifecycle.openProject}
        recentProjects={courseProjectLifecycle.recentProjects}
        onOpenRecent={courseProjectLifecycle.openRecentProject}
        onSave={(saveAs) => void courseProjectLifecycle.saveProject(saveAs)}
        healthSummary={projectHealthSummary}
        onOpenHealth={() => setProjectHealthOpen(true)}
        onOpenRecipes={() => openDesignTool('recipe')}
        onOpenProductivity={() => openDesignTool('productivity')}
        onImportPptx={() => openDesignTool('pptx')}
        onImportFlow={() => { void openFlowImport() }} onImportHtml={() => { void openHtmlImport() }}
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
      {pendingFlowComponent?.reason && <section role="region" aria-label="待插入内容" className="modal" style={{ position: 'fixed', right: 24, bottom: 60, zIndex: 1000, maxWidth: 420 }}>
        <h2>请重新选择插入位置</h2><p>{pendingFlowComponent.reason}</p>
        <p>已准备的{pendingFlowComponent.command.label}保留在此处。请回到原讲义选择位置后继续。</p>
        <div className="modal__actions">
          <button type="button" onClick={() => resumeFlowInsertion()}>插入到原讲义当前位置</button>
          {pendingFlowComponent.afterBlockId && <button type="button" onClick={() => resumeFlowInsertion(true)}>在原所在块下方插入</button>}
          <button type="button" className="secondary-button" onClick={closeFlowComponentChoice}>取消</button>
        </div>
      </section>}
      {pendingFlowComponent && !pendingFlowComponent.reason && <div className="modal-backdrop" role="presentation" onMouseDown={closeFlowComponentChoice}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="flow-component-choice-title" onMouseDown={event => event.stopPropagation()}>
          <h2 id="flow-component-choice-title">选择要插入的组件</h2>
          <p>将组件插入{pendingFlowComponent.command.destination === 'document' ? '正文' : '纸面'}。选择已有组件或内置组件。</p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {selectProjectLibraryDefinitions(pendingFlowComponent.capture.project.definitions).map(definition => {
              const sources = Object.values(pendingFlowComponent.capture.project.instances).filter(instance => instance.definitionId === definition.id)
              const catalog = selectCurrentCatalogPackages(componentLibrary.componentCatalog.packages.filter(entry => entry.packageId === definition.library?.packageId && entry.sourceTrust !== 'prompt' && entry.quality !== 'deprecated'))[0]
              return <div key={definition.id}>
                <p>{definition.title ?? definition.id} · 复制现有实例</p>
                {catalog && <button type="button" className="secondary-button" onClick={() => {
                  const pending = pendingFlowComponent
                  setPendingFlowComponent(null)
                  void componentLibrary.prepareCatalogPackage(catalog).then(data => {
                    if (data) insertFlowMenu(pending.command, { packageId: data.id }, pending.capture, data)
                    else releaseFlowMenuTarget(pending.capture)
                  }).catch(error => { releaseFlowMenuTarget(pending.capture); setError(error instanceof Error ? error.message : '组件包准备失败') })
                }}>从组件库新建</button>}
                {sources.length ? sources.map(source => <button key={source.id} type="button" className="secondary-button" onClick={() => {
                  const pending = pendingFlowComponent
                  setPendingFlowComponent(null)
                  insertFlowMenu(pending.command, { packageId: definition.id, sourceInstanceId: source.id }, pending.capture)
                }}>复制 {source.name ?? source.id}</button>) : <p>此定义没有可复制的实例，请选择组件库条目。</p>}
              </div>
            })}
            {selectCurrentCatalogPackages(componentLibrary.componentCatalog.packages.filter(entry => entry.sourceTrust === 'built-in' && !Object.values(pendingFlowComponent.capture.project.definitions).some(definition => definition.library?.packageId === entry.packageId)))
              .map(entry => <button key={entry.packageId} type="button" className="secondary-button" onClick={() => {
                const pending = pendingFlowComponent
                setPendingFlowComponent(null)
                void componentLibrary.prepareCatalogPackage(entry).then(data => {
                  if (data) insertFlowMenu(pending.command, { packageId: data.id }, pending.capture, data)
                  else releaseFlowMenuTarget(pending.capture)
                }).catch(error => { releaseFlowMenuTarget(pending.capture); setError(error instanceof Error ? error.message : '组件包准备失败') })
              }}>{entry.name}</button>)}
          </div>
          <div className="modal__actions">
            <button type="button" className="secondary-button" onClick={closeFlowComponentChoice}>取消</button>
          </div>
        </section>
      </div>}
      <footer className="status-bar" aria-live="polite">
        {unconfirmedInputActions}
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

      {retainedFlowOpen && flowRecovery.retained.length + preservedInputCount > 0 && <div className="modal-backdrop" role="presentation">
        <section className="modal copyable-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="retained-flow-title">
          <header className="copyable-summary-dialog__header"><h2 id="retained-flow-title">保留的输入原稿</h2>
            <button type="button" className="icon-button" title="关闭原稿" aria-label="关闭原稿" onClick={() => setRetainedFlowOpen(false)}><X size={17} /></button>
          </header>
          {flowRecovery.retained.map((record, index) => <details key={record.recovery.id} open={index === 0}>
            <summary>版本 {record.revision} · {record.surfaceId}</summary>
            <textarea className="copyable-summary-dialog__content" aria-label={`版本 ${record.revision} 的正文原稿`} value={record.source} readOnly />
          </details>)}
          {preservedInputDrafts.map(input => <div key={input.documentId}>
            {input.advanced.map((record, index) => <details key={`${record.kind}:${record.key}:${index}`}>
              <summary>{input.projectTitle ?? '工程'} · {record.kind === 'source' ? '源码' : record.kind === 'json' ? 'JSON' : '文字'}原稿 {index + 1}</summary>
              <textarea className="copyable-summary-dialog__content" aria-label={`保留的${record.kind}原稿 ${index + 1}`} value={recoveryInputText(record.payload)} readOnly />
            </details>)}
            {input.properties.map((record, index) => <details key={`${record.bindingKey}:${index}`}>
              <summary>{input.projectTitle ?? '工程'} · {record.label || '属性'}原稿</summary>
              <textarea className="copyable-summary-dialog__content" aria-label={`保留的属性原稿 ${index + 1}`} value={record.raw} readOnly />
            </details>)}
          </div>)}
          <div className="modal__actions"><button type="button" className="primary-button" onClick={() => setRetainedFlowOpen(false)}>完成</button></div>
        </section>
      </div>}

      {errorMessage && (
        <div className="toast" role="alert">
          <AlertCircle size={19} />
          <div className="toast__content">{errorMessage}{unconfirmedInputActions && <div>{unconfirmedInputActions}</div>}</div>
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
              return `组件：${next.title} (${next.id})\n当前版本：${current?.version ?? '未知'}\n新版本：${Object.values(next.definitions)[0]?.version ?? '未指定'}\n文件：${componentLibrary.replacementRequest!.sourceFileName}\n\n${componentLibrary.replacementRequest!.sourceReview.summary}\n\n确认后，全部实例会切换到该包并保留当前属性与私有覆盖；此操作可以撤销。`
            })()
          : ''}
        details={componentLibrary.replacementRequest && <details className="modal__details"><summary>查看来源与更新差异</summary>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '40vh', overflow: 'auto' }}>{componentLibrary.replacementRequest.sourceReview.sourceDiff}</pre></details>}
        confirmLabel={componentLibrary.replacementRequest?.sourceReview.localSourceModified ? '替换本地共享源码' : '确认替换'}
        cancelLabel="保留当前版本"
        onCancel={componentLibrary.cancelReplacement}
        onConfirm={componentLibrary.confirmReplacement}
      />
      <ConfirmDialog
        open={Boolean(componentLibrary.catalogUpdateRequest)}
        title="审阅目录组件更新"
        message={componentLibrary.catalogUpdateRequest
          ? (() => {
              const entry = componentLibrary.catalogUpdateRequest!.entries[0]!
              return `组件：${entry.name} v${entry.version}\n来源：${entry.sourceLabel}\n质量：${entry.quality}\n\n${componentLibrary.catalogUpdateRequest!.sourceReview.summary}\n\n更新会改变工程锁定的共享组件代码，实例属性与私有覆盖会保留。`
            })()
          : ''}
        details={componentLibrary.catalogUpdateRequest && <details className="modal__details"><summary>查看来源与更新差异</summary>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: '40vh', overflow: 'auto' }}>{componentLibrary.catalogUpdateRequest.sourceReview.sourceDiff}</pre></details>}
        confirmLabel={componentLibrary.catalogUpdateRequest?.sourceReview.localSourceModified ? '更新并替换本地源码' : '确认更新'}
        cancelLabel="保留当前版本"
        onCancel={componentLibrary.cancelCatalogUpdate}
        onConfirm={componentLibrary.confirmCatalogUpdate}
      />
      <ProjectHealthPanel
        open={projectHealthOpen}
        diagnostics={courseProjectHealthDiagnostics ?? undefined}
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
              <CoursePreviewNotices messages={courseDelivery.previewDiagnostics} />
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
    {flowImportIssues && <div className="lesson-modal-backdrop" role="presentation"><section className="lesson-modal" role="dialog" aria-modal="true" aria-label="导入说明">
      <h3>{flowImportIssues.name} 已导入</h3><p>可编辑内容已保存到当前工程草稿。以下内容需要核对，原文件仍保留。</p>
      <ul>{flowImportIssues.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
      <button type="button" onClick={() => setFlowImportIssues(null)}>继续编辑</button>
    </section></div>}
    </LessonWorkspaceHost>
    </CourseEditorActionsContext.Provider>
    </ProjectColorPaletteContext.Provider>
  )
}
