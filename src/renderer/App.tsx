import { captureDocumentReference } from './workbench/SelectionContextController'
import { CourseAdvancedChrome, CourseEditorFrame } from './documents/CourseEditorChromeContext'
import { CourseLightToolbar } from './documents/CourseLightToolbar'
import { HtmlImportDialog, type HtmlImportDestination } from './documents/HtmlImportDialog'
import { elementCards } from './workbench/elementCards/elementCardController'
import { locateCourseLayer } from '../core/drivers/course/layerProperties'
import { CourseEditorActionsContext, type CourseEditorActions } from './documents/CourseEditorActionsContext'
import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LessonWorkspaceHost } from './app/LessonWorkspaceHost'
import type { LessonWorkspaceShellHandle } from './lessonWorkspace/LessonWorkspaceShell'
import {
  APP_EXECUTABLE_NAME,
  RECOMMENDED_PROJECT_SCENES,
  RECOMMENDED_SCENE_NODES,
} from '../shared/constants'
import { toUserMessage, UserFacingError } from '../shared/errors'
import { formatPageInsets, WINDOW_PAGE_INSETS } from '../shared/pageFrame'
import { FLOW_COMPONENT_BLOCK_HEIGHT } from '../shared/flowBodyPresentation'
import {
  collectCourseProjectHealth,
  summarizeCourseProjectHealth,
} from '../shared/courseProjectHealth'
import {
  componentPackagesToArchiveFiles,
  componentPackagesFromArchive,
} from './components/componentPackageStore'
import { emptyCourseAssetSidecar } from './project/v9AssetAdapter'
import { createSlideLightEditingPort } from './composition/selection/slideLightEditingPort'
import { useComponentLibrary } from './app/useComponentLibrary'
import { selectAvailableBuiltInCatalogPackages } from './components/componentLibraryModel'
import { useCourseDelivery } from './app/useCourseDelivery'
import { courseDeliverySnapshot } from './app/courseDeliverySnapshot'
import { useCourseProjectLifecycle } from './app/useCourseProjectLifecycle'
import { useFlowDocumentRecovery } from './app/useFlowDocumentRecovery'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from './course/flowEditorView'
import { findFlowBlockRecursive, flowBlockLabel, flowSurfaceIn, walkFlowBlocks } from '../core/tools/flowDocumentModel'
import { createExternalComponentNode, createImageNode, createShapeNode, createTextNode } from '../core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '../shared/courseProjectModel'
import { resolveComponentPresetProps } from '../shared/componentProps'
import { componentSupportsScope } from '../shared/componentCapabilities'
import type { ComponentPackageData } from '../shared/componentTypes'
import { prepareFlowMenuComponentInsertion } from './course/flowMenuComponentInsertion'
import type { NativeLayerItem, ComponentLayerItem } from '../shared/courseProjectTypes'
import type { FlowInsertCommand } from './ui/flow/flowInsertCommands'
import type { FlowDeepInsertPayload } from './ui/RightSidebar'
import { flowMenuPaperPlacement } from './ui/flow/flowMenuPaperPlacement'
import { useEditorKeyboardRouter } from './app/useEditorKeyboardRouter'
import { useMediaImport } from './app/useMediaImport'
import type { WorkspaceMediaDropHandler } from './lessonWorkspace/workspaceMediaDrop'
import type { DocumentHostAPI, SaveDirectoryContext } from '../shared/workbench/desktop'
import {
  selectCanUndoActiveSurface,
  selectCanRedoActiveSurface,
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActiveScene,
  selectEditingNodes,
  selectEditingScope,
  selectEffectiveLayerProjection,
  selectMediaAssetFiles,
  selectMediaAssets,
  selectSelectedNode,
  selectSelectedNodeId,
  selectSelectedNodeIds,
  selectSlideAuthoringBackend,
  selectHasUnsavedCourseChanges,
  useEditorStore,
} from './store/editorStore'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { CopyableSummaryDialog } from './ui/CopyableSummaryDialog'
import { ExportSizeWarningDialog } from './ui/ExportSizeWarningDialog'
import { ExportPreflightDialog } from './ui/ExportPreflightDialog'
import { RightSidebar } from './ui/RightSidebar'
import { ScenePanel } from './ui/ScenePanel'
import { CourseBottomNavigation } from './ui/BottomSceneNavigator'
import { captureFlowMenuPage, requestFlowBlockFocus, requestFlowBlockSelection, type FlowMenuPageCapture } from './ui/FlowWorkspace'
import { TopToolbar } from './ui/TopToolbar'
import { Workspace } from './ui/Workspace'
import { ProjectHealthPanel } from './ui/ProjectHealthPanel'
import { ProjectColorPaletteContext } from './ui/ColorInput'
import { RecipePanel } from './ui/recipes/RecipePanel'
import { ProductivityDialog } from './ui/productivity/ProductivityDialog'
import { MaterialLibraryDialog } from './ui/MaterialLibraryDialog'
import { EditorPanelLayout } from './ui/EditorPanelLayout'
import { createMaterialCitationRequest } from './authoring/tools/materialCitationRequest'
import type { ProductivityContext } from './authoring/productivity'
import { resolveCourseProjectDiagnosticTargetRoute } from './diagnostics/projectHealthNavigation'
import { createCourseFromPptx, pptxCourseStem } from './project/pptxCourseCreation'

function desktopApi() {
  if (!window.desktopAPI) {
    throw new UserFacingError(
      '桌面功能不可用',
      '当前页面未运行在果铃编辑器桌面环境中。',
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

function captureCourseIdentity() {
  const state = useEditorStore.getState()
  const document = selectActiveCourseProjectDocument(state)
  if (!document) return null
  const projection = selectEffectiveLayerProjection(state)
  return {
    projectId: document.id,
    revision: document.revision,
    locationId: selectActiveCourseLocationId(state),
    sessionGeneration: state.courseAuthoringSession?.token.generation ?? 0,
    surfaceId: projection?.surfaceId ?? null,
    owner: projection?.scope.owner ?? null,
    ownerKey: projection?.scope.ownerKey ?? null,
  }
}

export default function App() {
  const lessonShell = useRef<LessonWorkspaceShellHandle>(null)
  const saveDirectory = useRef<SaveDirectoryContext | null>(null)
  const rawDocuments = window.desktopAPI?.documents
  const documentsWithSaveDirectory = useMemo<DocumentHostAPI | null>(() => rawDocuments ? {
    ...rawDocuments,
    saveWithDialog: (documentId, saveAs, suggestedDirectory) => rawDocuments.saveWithDialog(documentId, saveAs, suggestedDirectory ?? saveDirectory.current ?? undefined),
    closeWithDialog: (documentId, suggestedDirectory) => rawDocuments.closeWithDialog(documentId, suggestedDirectory ?? saveDirectory.current ?? undefined),
  } : null, [rawDocuments])
  const setSaveDirectory = useCallback((directory: SaveDirectoryContext | null) => { saveDirectory.current = directory }, [])
  const [lessonDirty, setLessonDirty] = useState(false)
  const [activeWorkspaceDocument, setActiveWorkspaceDocument] = useState<{ kind: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [htmlImportDialog, setHtmlImportDialog] = useState<{ documentId: string; epoch: string; revision: number; projectId: string;
    sourcePath: string | null; destinations: HtmlImportDestination[]; busy: boolean; error: string | null } | null>(null)
  const [projectHealthOpen, setProjectHealthOpen] = useState(false)
  const [materialsOpen, setMaterialsOpen] = useState(false)
  const [designTool, setDesignTool] = useState<{ kind: 'recipe' | 'productivity' | 'pptx'; context: ProductivityContext } | null>(null)
  const hasFlowSurface = useEditorStore(state => Boolean(selectActiveCourseProjectDocument(state)?.surfaces.some(surface => surface.type === 'flow')))
  const openDesignTool = (kind: 'recipe' | 'productivity' | 'pptx') => {
    const context = useEditorStore.getState().prepareDesignProduction()
    if (context) setDesignTool({ kind, context })
  }

  const canUndoCourse = useEditorStore(selectCanUndoActiveSurface)
  const canRedoCourse = useEditorStore(selectCanRedoActiveSurface)
  const courseCanvasMode = useEditorStore(state => state.canvasMode)
  const courseConnection = useEditorStore(state => state.courseDocument)
  const dirty = useEditorStore(selectHasUnsavedCourseChanges)
  const projectPath = useEditorStore((state) => state.projectPath)
  const activeCourseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const designSessionToken = useEditorStore(state => state.courseAuthoringSession?.token)
  const projectColors = useMemo(() => activeCourseDocument?.designTokens.colors.map(
    token => ({ name: token.label, value: token.color }),
  ) ?? [], [activeCourseDocument?.designTokens.colors])
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(
    (state) => state.componentPackages,
  )
  const v9ContentEdit = useEditorStore((state) => state.v9ContentEdit)
  const spatialContentEdit = useEditorStore((state) => state.spatialContentEdit)
  const flowTextEdit = useEditorStore((state) => state.flowTextEdit)
  const flowDocumentDraft = useEditorStore((state) => state.flowDocumentDraft)
  const selectedItemName = useEditorStore(state =>
    selectEffectiveLayerProjection(state)?.unifiedRows.find(row => row.selected)?.name ?? selectSelectedNode(state)?.name ?? null)
  const selectedNodeIds = useEditorStore(selectSelectedNodeIds)
  const editingScope = useEditorStore(selectEditingScope)
  const insertSurface = useEditorStore(state => state.spatialSession ? 'spatial' : state.flowSession ? 'flow' : state.slideCandidateSnapshot ? 'slide' : null)
  const spatialInsertScope = useEditorStore(state => state.spatialSession?.scope ?? null)
  const activeTab = useEditorStore((state) => state.activeTab)
  const editingItemCount = useEditorStore(state => {
    const projection = selectEffectiveLayerProjection(state)
    return projection?.surfaceType === 'slide'
      ? projection.unifiedRows.filter(row => row.owner === projection.scope.owner).length
      : selectEditingNodes(state).length
  })
  const activeScene = useEditorStore(selectActiveScene)
  const slideSceneCount = useMemo(
    () => activeCourseDocument
      ? activeCourseDocument.surfaces.reduce(
          (count, surface) => count + (surface.type === 'slide' ? surface.scenes.length : 0),
          0,
        )
      : 0,
    [activeCourseDocument],
  )
  const errorMessage = useEditorStore((state) => state.errorMessage)
  const statusMessage = useEditorStore((state) => state.statusMessage)
  const courseProjectHealthDiagnostics = useMemo(
    () => activeCourseDocument
      ? collectCourseProjectHealth(activeCourseDocument, {
          assetFiles: sidecarFiles,
          componentFiles: componentPackagesToArchiveFiles(componentPackages),
        })
      : null,
    [activeCourseDocument, componentPackages, sidecarFiles],
  )
  const projectHealthSummary = useMemo(
    () => courseProjectHealthDiagnostics
      ? summarizeCourseProjectHealth(courseProjectHealthDiagnostics)
      : { error: 0, warning: 0, info: 0, total: 0, canExport: true },
    [courseProjectHealthDiagnostics],
  )

  const setError = useEditorStore((state) => state.setError)
  const setStatus = useEditorStore((state) => state.setStatus)
  const createNewProject = useEditorStore((state) => state.createNewProject)
  const createNewSpatialProject = useEditorStore((state) => state.createNewSpatialProject)
  const createNewFlowProject = useEditorStore((state) => state.createNewFlowProject)
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const flowSession = useEditorStore((state) => state.flowSession)
  const loadCourseProject = useEditorStore((state) => state.loadCourseProject)

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
    target: flowSession && designSessionToken?.surfaceType === 'flow' ? {
      projectId: flowSession.history.present.id,
      projectPath,
      surfaceId: flowSession.selection.surfaceId,
      revision: flowSession.history.present.revision,
      epoch: designSessionToken.generation,
    } : null,
    draft: flowDocumentDraft,
    port: flowRecoveryPort,
    onRestore(draft) {
      const current = useEditorStore.getState()
      const session = current.flowSession
      const token = current.courseAuthoringSession?.token
      if (!session || !token || token.surfaceType !== 'flow' || current.flowDocumentDraft
        || session.selection.surfaceId !== draft.surfaceId || session.history.present.revision !== draft.revision) return
      const view = buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId })
      current.runFlowAuthoringIntent(captureFlowEditorAuthoringTarget({ view, sessionToken: token, target: { kind: 'surface' } }), {
        kind: 'update-document-draft', source: draft.source, diagnostics: draft.diagnostics, composing: false,
      })
    },
    onError: setError,
  })

  const courseProjectLifecycle = useCourseProjectLifecycle({
    captureIdentity() {
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)
      return {
        projectId: document?.id ?? '',
        revision: document?.revision ?? 0,
        sessionGeneration: state.courseAuthoringSession?.token.generation ?? 0,
      }
    },
    documents: {
      ready: () => {
        const host = documentsWithSaveDirectory
        if (!host) return Promise.reject(new Error('课程文档服务不可用'))
        return useEditorStore.getState().connectCourseDocuments(host)
      },
      snapshot: () => useEditorStore.getState().courseDocument.snapshot,
      create: (surface, canvas) => useEditorStore.getState().createCourseDocument(surface, canvas),
      createFrom: content => useEditorStore.getState().createCourseDocumentFrom(content.project, content.assetFiles, content.componentPackages),
      open: path => useEditorStore.getState().openCourseDocument(path),
      save: saveAs => useEditorStore.getState().saveCourseDocument(saveAs),
      drain: () => useEditorStore.getState().drainCourseDocument(),
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
    beforeReplace: async () => await flowRecovery.flush(),
    onProjectReplaced: () => lessonShell.current?.detachLesson(),
    preserveBeforeClose: async () => {
      if (!(await flowRecovery.flush()) || !(await lessonShell.current?.preserveAll() ?? true)) return false
      await useEditorStore.getState().drainAllCourseDocuments()
      return true
    },
    subscribePreserveAndCloseRequest: handler => window.desktopAPI?.onRequestPreserveAndClose?.(async () => {
      const ready = await handler()
      return { ready, ...(ready && saveDirectory.current ? { suggestedDirectory: saveDirectory.current } : {}) }
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
      return window.desktopAPI.onRequestSaveAndClose(handler)
    },
  }, {
    dirty: dirty || lessonDirty,
    projectTitle: activeWorkspaceDocument?.kind === 'course' ? activeCourseDocument?.title ?? activeWorkspaceDocument.name : activeWorkspaceDocument?.name ?? '',
    projectPath,
    documentTrigger: activeCourseDocument,
    sidecarTrigger: sidecarFiles,
    componentPackagesTrigger: componentPackages,
    slideDraftTrigger: v9ContentEdit,
    spatialDraftTrigger: spatialContentEdit,
    flowDraftTrigger: flowDocumentDraft ?? flowTextEdit,
    textEditTrigger: undefined,
  })
  // The work area's "从 PPT 新建 H5 演示": a new untitled H5 presentation holding the PPT's pages (M21).
  const newProjectFromPptx = async ({ name, bytes }: { name: string; bytes: Uint8Array }) => {
    const title = pptxCourseStem(name)
    let issues = 0
    const created = await courseProjectLifecycle.newProjectFrom(async () => {
      const course = await createCourseFromPptx(bytes, title)
      issues = course.issues.length
      return course
    }, { origin: 'lesson' })
    if (created) setStatus(issues ? `已从 PPT 新建 H5 演示「${title}」；${issues} 项内容未保留或已简化` : `已从 PPT 新建 H5 演示「${title}」`)
    return created
  }

  const htmlImportInFlight = useRef(false)
  const openHtmlImport = async (directory?: SaveDirectoryContext, sourceEntryId?: string) => {
    try {
      if (!desktopApi().htmlImport) throw new Error('HTML 导入服务不可用')
      const documentId = useEditorStore.getState().courseDocument.documentId
      if (!documentId) throw new Error('请先打开一份 H5 演示')
      const snapshot = await useEditorStore.getState().drainCourseDocument()
      if (snapshot.documentId !== documentId || snapshot.model.kind !== 'course-v9') {
        throw new Error('当前 H5 演示已切换，请重新发起导入')
      }
      const project = snapshot.model.project
      const activeLocationId = selectActiveCourseLocationId(useEditorStore.getState())
      const destinations: HtmlImportDestination[] = project.locations.flatMap<HtmlImportDestination>(location => {
        const surface = project.surfaces.find(item => item.id === location.surfaceId)
        if (location.kind === 'slide-scene' && surface?.type === 'slide') {
          return [{ locationId: location.id, surfaceType: 'slide' as const, label: location.label }]
        }
        if (location.kind !== 'flow-block' || surface?.type !== 'flow') return []
        const anchors: { blockId: string; label: string }[] = []
        walkFlowBlocks(surface.blocks, block => {
          if (block.type === 'paragraph') anchors.push({ blockId: block.id, label: flowBlockLabel(block).slice(0, 60) })
        })
        return [{ locationId: location.id, surfaceType: 'flow' as const, label: location.label, anchors }]
      })
      if (!destinations.length) throw new Error('当前 H5 演示没有可导入 HTML 的页面')
      destinations.sort((left, right) => Number(right.locationId === activeLocationId) - Number(left.locationId === activeLocationId))
      const sourcePath = sourceEntryId
        ? (await desktopApi().workspaceFiles!({ type: 'resolve', workspaceId: directory!.workspaceId, entryId: sourceEntryId })).resolvedPath
        : null
      const current = useEditorStore.getState().courseDocument
      if (current.documentId !== snapshot.documentId || current.snapshot?.epoch !== snapshot.epoch || current.snapshot.revision !== snapshot.revision) {
        throw new Error('当前 H5 演示已变化，请重新发起导入')
      }
      setHtmlImportDialog({ documentId, epoch: snapshot.epoch, revision: snapshot.revision, projectId: project.id,
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
      const snapshot = await useEditorStore.getState().drainCourseDocument()
      if (snapshot.documentId !== dialog.documentId || snapshot.epoch !== dialog.epoch || snapshot.revision !== dialog.revision
        || snapshot.model.kind !== 'course-v9' || snapshot.model.project.id !== dialog.projectId) {
        throw new Error('当前 H5 演示已变化，请重新选择导入位置')
      }
      const api = desktopApi().htmlImport
      if (!api) throw new Error('HTML 导入服务不可用')
      const result = await api.import({
        documentId: dialog.documentId, epoch: dialog.epoch, revision: dialog.revision,
        locationId: target.locationId, ...(target.anchorBlockId ? { anchorBlockId: target.anchorBlockId } : {}),
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
      const confirmed = await useEditorStore.getState().drainCourseDocument()
      if (confirmed.documentId !== dialog.documentId || confirmed.epoch !== dialog.epoch
        || confirmed.revision < result.receipt.revision) {
        throw new Error('导入已提交，但当前文档尚未同步；请重新打开页面核对')
      }
      setHtmlImportDialog(null)
      setStatus(result.notices.length ? 'HTML 页面已导入；在线图片/音视频链接已保留，离线时可能无法使用' : 'HTML 页面已导入到所选位置')
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
      if (!state.courseDocument.documentId) return null
      return courseDeliverySnapshot(await state.drainCourseDocument())
    },
    readCanonicalSnapshot: () => courseDeliverySnapshot(useEditorStore.getState().courseDocument.snapshot),
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
    navigateFinding(item) {
      const state = useEditorStore.getState()
      const courseProject = selectActiveCourseProjectDocument(state)
      if (courseProject && item.diagnosticTarget) {
        const route = resolveCourseProjectDiagnosticTargetRoute(
          courseProject,
          item.diagnosticTarget,
          item.code,
          item.path,
        )
        if (route.locationId) state.activateCourseLocation(route.locationId)
        state.setEditingScope(route.scope)
        if (route.layerItemId) state.selectNode(route.layerItemId)
        state.setActiveTab(route.tab)
        return
      }
      const document = selectActiveCourseProjectDocument(state)
      const globalNode = item.nodeId
        ? Boolean(document?.globalLayerItems.some(({ item: layer }) => (
          layer.layerItemId === item.nodeId
        )))
        : false
      state.setEditingScope(globalNode ? 'global' : 'scene')
      if (item.sceneId) state.setActiveScene(item.sceneId)
      if (!globalNode && item.stateId !== undefined) {
        state.setActivePresentationState(item.stateId)
      }
      if (item.nodeId) state.selectNode(item.nodeId)
      state.setActiveTab('properties')
    },
    exportHtml: (input) => desktopApi().exportHtml(input),
    exportWebPackage: (input) => desktopApi().exportWebPackage(input),
    exportPdf: (input) => desktopApi().exportPdf(input),
    exportBinary: (input) => desktopApi().exportBinary(input),
  }, {
    documentTrigger: activeCourseDocument,
    sidecarTrigger: sidecarFiles,
    componentPackagesTrigger: componentPackages,
  })

  const mediaImport = useMediaImport({
    captureIdentity: captureCourseIdentity,
    captureDocumentId: () => useEditorStore.getState().courseDocument.documentId,
    captureSurfaceKind: () => {
      const state = useEditorStore.getState()
      return state.spatialSession ? 'spatial' : state.flowSession ? 'flow' : state.slideCandidateSnapshot ? 'slide' : null
    },
    captureFlowAudioTarget: () => {
      const flow = useEditorStore.getState().flowSession
      return flow?.selection.authoringScope === 'page' ? captureCourseIdentity() : null
    },
    captureLibraryTarget: () => (
      useEditorStore.getState().captureMediaLibraryImportTarget()
    ),
    captureImageReplacementTarget: () => (
      useEditorStore.getState().captureImageReplacementTarget()
    ),
    readMediaLibrarySnapshot() {
      const state = useEditorStore.getState()
      return {
        assets: selectMediaAssets(state),
        files: selectMediaAssetFiles(state),
      }
    },
    readCandidateMediaContext() {
      const state = useEditorStore.getState()
      const backend = selectSlideAuthoringBackend(state)
      if (!backend) return null
      return {
        assets: backend.getSession().history.present.assets,
        sidecar: state.courseAssetSidecar ?? emptyCourseAssetSidecar(),
      }
    },
    readCourseMediaContext() {
      const state = useEditorStore.getState()
      const project = selectActiveCourseProjectDocument(state)
      return project ? { assets: project.assets, sidecar: state.courseAssetSidecar ?? emptyCourseAssetSidecar() } : null
    },
    replaceImageAtTarget: (target, asset, bytes) => (
      useEditorStore.getState().replaceImageAssetAtTarget(target, asset, bytes)
    ),
    importAssetsAtTarget: (target, items) => (
      useEditorStore.getState().importAssetsAtTarget(target, [...items])
    ),
    placeImageNodes: (items, position) => (
      useEditorStore.getState().addImageNodes([...items], position)
    ),
    placeVideoNodes: (items, position) => (
      useEditorStore.getState().addVideoNodes([...items], position)
    ),
    placeFlowAudioNodes: async (items) => {
      const placed = useEditorStore.getState().insertFlowAudioNodes([...items])
      if (placed.completedCount > 0) await useEditorStore.getState().drainCourseDocument()
      return placed
    },
    placeFlowMediaAt: (item, afterBlockId) => (
      useEditorStore.getState().insertFlowMediaAt(item, afterBlockId)
    ),
    importSounds: (items) => useEditorStore.getState().importSounds([...items]),
    commitCandidateMedia(input) {
      useEditorStore.getState().importV9CandidateMedia({
        items: [...input.items],
        nativeType: input.nativeType,
        mode: input.mode,
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
      })
    },
    selectImage: () => desktopApi().selectImage(),
    selectImages: () => desktopApi().selectImages(),
    selectAudios: () => desktopApi().selectAudios(),
    selectAudio: () => desktopApi().selectAudio(),
    selectVideos: () => desktopApi().selectVideos(),
    selectVideo: () => desktopApi().selectVideo(),
    replaceSelectedVideo: (asset, bytes) => useEditorStore.getState().replaceSelectedVideo(asset, bytes),
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
  })

  const dropWorkspaceMedia: WorkspaceMediaDropHandler = async request => {
    const placed = await mediaImport.importWorkspaceMedia(request)
    if (!placed.ok || !placed.assetId) return { ok: false, reason: placed.reason ?? '媒体拖入未完成。' }
    try {
      const confirmed = await useEditorStore.getState().drainCourseDocument()
      if (confirmed.documentId !== request.target.documentId || confirmed.revision <= request.target.revision
        || confirmed.model.kind !== 'course-v9' || !confirmed.model.project.assets[placed.assetId]) {
        return { ok: false, reason: '当前文档没有确认这次媒体插入，请检查后重新拖入。' }
      }
      if (placed.soundId && confirmed.model.project.media.audio.sounds[placed.soundId]?.assetId !== placed.assetId) {
        return { ok: false, reason: '当前文档没有确认声音库导入，请检查后重新拖入。' }
      }
      if (placed.soundId) setStatus('音频已加入声音库，可供互动播放')
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : '媒体插入尚未得到文档确认。' }
    }
  }

  const componentLibrary = useComponentLibrary({
    captureIdentity: captureCourseIdentity,
    captureReplacementTarget: (packageId) => (
      useEditorStore.getState().captureComponentPackageReplacementTarget(packageId)
    ),
    readInstalledPackages: () => useEditorStore.getState().componentPackages,
    replacePackageAtTarget: (target, packageData) => (
      useEditorStore.getState().replaceComponentPackageAtTarget(target, packageData)
    ),
    captureInsertionTarget: () => useEditorStore.getState().captureComponentInsertionTarget(),
    insertPackages: (target, packages) => {
      const result = useEditorStore.getState().insertComponentPackagesAtTarget(target, packages)
      if (result.ok) useEditorStore.getState().selectNodes(result.layerItemIds ?? [])
      return result
    },
    selectComponentPackage: () => desktopApi().selectComponentPackage(),
    selectComponentPackages: () => desktopApi().selectComponentPackages(),
    desktopAvailable: () => Boolean(window.desktopAPI),
    loadCatalog: () => desktopApi().loadComponentCatalog(),
    readCatalogPackage: (input) => desktopApi().readComponentCatalogPackage(input),
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
  })

  type CapturedFlowMenuPage = Extract<FlowMenuPageCapture, { ok: true }>
  const [pendingFlowComponent, setPendingFlowComponent] = useState<{ command: FlowInsertCommand; capture: CapturedFlowMenuPage } | null>(null)

  const captureFlowMenuTarget = async (capture?: CapturedFlowMenuPage) => {
    let page: FlowMenuPageCapture = capture ?? captureFlowMenuPage()
    if (!page.ok) throw new Error(page.reason)
    if (!capture) {
      const before = useEditorStore.getState()
      const flow = before.flowSession
      if (before.courseDocument.documentId === page.documentId && flow
        && flow.history.present.id === page.projectId && flow.selection.surfaceId === page.surfaceId
        && flow.selection.locationId === page.locationId && flow.history.present.revision !== page.revision) {
        await before.drainCourseDocument()
        await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()))
        const refreshed = captureFlowMenuPage()
        if (!refreshed.ok || refreshed.documentId !== page.documentId || refreshed.projectId !== page.projectId
          || refreshed.surfaceId !== page.surfaceId || refreshed.locationId !== page.locationId
          || refreshed.generation !== page.generation || refreshed.selectedBlockId !== page.selectedBlockId
          || refreshed.selectionSignature !== page.selectionSignature) {
          throw new Error('正文或选区已变化，请重新打开插入菜单')
        }
        page = refreshed
      }
    }
    const state = useEditorStore.getState()
    const flow = state.flowSession
    const token = state.courseAuthoringSession?.token
    if (state.canvasMode !== 'edit' || !flow || !token || token.surfaceType !== 'flow'
      || flow.selection.authoringScope !== 'page' || state.courseDocument.documentId !== page.documentId
      || flow.history.present.id !== page.projectId || flow.history.present.revision !== page.revision
      || flow.selection.locationId !== page.locationId || flow.selection.surfaceId !== page.surfaceId
      || JSON.stringify(flow.selection) !== page.selectionSignature
      || token.generation !== page.generation || token.revision !== page.revision) {
      throw new Error('文档或编辑位置已变化，请重新打开插入菜单')
    }
    const view = buildFlowEditorView({ project: flow.history.present, locationId: page.locationId })
    const selected = page.selectedBlockId
    const target = captureFlowEditorAuthoringTarget({ view, sessionToken: token,
      target: selected ? { kind: 'block', blockId: selected } : { kind: 'surface' } })
    return { page, target, project: flow.history.present, state }
  }

  const insertFlowMenu = (command: FlowInsertCommand, payload?: FlowDeepInsertPayload, frozen?: CapturedFlowMenuPage, preparedPackage?: ComponentPackageData) => {
    void (async () => {
      try {
        const { page, target, project, state } = await captureFlowMenuTarget(frozen)
        const confirmFlowMenuCommit = async (expectedRevision: number) => {
          const confirmed = await useEditorStore.getState().drainCourseDocument()
          if (confirmed.documentId !== page.documentId || confirmed.revision < expectedRevision
            || confirmed.model.kind !== 'course-v9' || confirmed.model.project.id !== page.projectId) {
            throw new Error('当前文档尚未确认这次插入，请检查后重试')
          }
          setStatus('已插入到当前 Flow 页面')
        }
        const commit = async (intent: Parameters<typeof state.runFlowAuthoringIntent>[1]) => {
          const live = useEditorStore.getState()
          if (live.courseDocument.documentId !== page.documentId || JSON.stringify(live.flowSession?.selection) !== page.selectionSignature) {
            throw new Error('文档或选区已变化，请重新插入')
          }
          const receipt = live.runFlowAuthoringIntent(target, intent)
          if (!receipt.ok) throw new Error(receipt.reason ?? '插入尚未提交')
          await confirmFlowMenuCommit(page.revision + 1)
        }
        if (command.destination === 'document' && ['heading', 'list', 'table', 'formula', 'divider', 'callout', 'section'].includes(command.kind)) {
          await commit({ kind: 'menu-insert-document', documentKind: command.kind as 'heading' | 'list' | 'table' | 'formula' | 'divider' | 'callout' | 'section' })
          return
        }
        if (command.kind === 'component') {
          if (!payload?.packageId) { setPendingFlowComponent({ command, capture: page }); return }
          const installed = preparedPackage ?? state.componentPackages[payload.packageId]
          const embedded = project.componentPackages[payload.packageId]
          if (!installed || installed.manifest.id !== payload.packageId
            || (embedded && embedded.version !== installed.manifest.version)) throw new Error('组件包或版本已变化')
          const manifest = installed.manifest
          if (!componentSupportsScope(manifest, 'scene')) throw new Error('该组件不支持当前文档页')
          const props = payload.presetId ? resolveComponentPresetProps(manifest, payload.presetId) : structuredClone(manifest.defaultProps)
          if (command.destination === 'paper') {
            const placement = flowMenuPaperPlacement(page, manifest.defaultSize)
            const item = sceneNodeToCourseLayerItem(createExternalComponentNode({
              name: manifest.name, component: { packageId: manifest.id, version: manifest.version },
              props, width: placement.frame.width, height: placement.frame.height,
              x: placement.frame.x, y: placement.frame.y,
            })) as ComponentLayerItem
            await commit(embedded
              ? { kind: 'menu-insert-paper', item, ...placement }
              : { kind: 'menu-insert-paper-component', item, packageData: installed, ...placement })
            return
          }
          const surface = flowSurfaceIn(project, page.surfaceId)
          const selected = page.selectedBlockId ? findFlowBlockRecursive(surface.blocks, page.selectedBlockId) : null
          if (page.selectedBlockId && !selected) throw new Error('正文插入目标已变化')
          const step = await prepareFlowMenuComponentInsertion({
            project, resources: { assetFiles: selectMediaAssetFiles(state), componentPackages: state.componentPackages },
            target: { projectId: page.projectId, documentRevision: page.revision,
              locationId: page.locationId, surfaceId: page.surfaceId },
            destination: { parentBlockId: selected?.parentId ?? null, index: selected ? selected.index + 1 : surface.blocks.length },
            packageId: manifest.id, packageData: installed, presetId: payload.presetId,
            width: page.bodyWidth, height: FLOW_COMPONENT_BLOCK_HEIGHT,
          })
          const live = useEditorStore.getState()
          if (live.courseDocument.documentId !== page.documentId || JSON.stringify(live.flowSession?.selection) !== page.selectionSignature) {
            throw new Error('文档或选区已变化，请重新插入')
          }
          const result = live.commitFlowMenuComponentAtTarget(target, step)
          if (!result.ok) throw new Error(result.reason ?? '正文组件未提交')
          await confirmFlowMenuCommit(page.revision + 1)
          return
        }
        if (command.destination === 'paper' && (command.kind === 'text-box' || command.kind === 'shape')) {
          const placement = flowMenuPaperPlacement(page, command.kind === 'text-box'
            ? { width: 280, height: 120 } : { width: 180, height: 120 })
          const item = sceneNodeToCourseLayerItem(command.kind === 'text-box'
            ? createTextNode({ text: '请输入文本', x: placement.frame.x, y: placement.frame.y,
                width: placement.frame.width, height: placement.frame.height })
            : createShapeNode('rectangle', { x: placement.frame.x, y: placement.frame.y,
                width: placement.frame.width, height: placement.frame.height })) as NativeLayerItem
          await commit({ kind: 'menu-insert-paper', item, ...placement })
          return
        }
        if (command.kind === 'image' || command.kind === 'video' || command.kind === 'audio') {
          if (command.destination === 'paper' && command.kind !== 'image') throw new Error('纸面菜单仅支持图片媒体')
          const existing = payload?.assetId ? project.assets[payload.assetId] : null
          if (payload?.assetId && (!existing || existing.kind !== command.kind)) throw new Error('所选媒体素材已变化')
          const prepared = existing ? null : await mediaImport.selectTargetMedia({
            kind: command.kind,
            captureTarget: () => page,
            isTargetCurrent: captured => {
              const live = useEditorStore.getState()
              const flow = live.flowSession
              const token = live.courseAuthoringSession?.token
              return live.canvasMode === 'edit' && live.courseDocument.documentId === captured.documentId
                && flow?.selection.authoringScope === 'page' && flow.history.present.id === captured.projectId
                && flow.history.present.revision === captured.revision
                && flow.selection.locationId === captured.locationId && flow.selection.surfaceId === captured.surfaceId
                && JSON.stringify(flow.selection) === captured.selectionSignature
                && token?.surfaceType === 'flow' && token.generation === captured.generation
                && token.revision === captured.revision
            },
          })
          if (!existing && !prepared) return
          const asset = existing ?? prepared?.asset
          if (!asset) throw new Error('所选媒体素材未准备完成')
          const source = existing ? { kind: 'existing' as const, assetId: asset.id } : prepared!.source
          if (command.destination === 'paper') {
            const imageWidth = Math.min(320, Math.max(80, asset.width ?? 320))
            const imageHeight = Math.max(80, Math.min(240, imageWidth * ((asset.height ?? 180) / (asset.width ?? 320))))
            const placement = flowMenuPaperPlacement(page, { width: imageWidth, height: imageHeight })
            const item = sceneNodeToCourseLayerItem(createImageNode({ assetId: asset.id,
              width: placement.frame.width, height: placement.frame.height,
              x: placement.frame.x, y: placement.frame.y })) as NativeLayerItem
            prepared?.assertCurrent()
            await commit({ kind: 'menu-insert-media', placement: 'paper', mediaKind: 'image', source, item, ...placement })
          } else {
            prepared?.assertCurrent()
            await commit({ kind: 'menu-insert-media', placement: 'document', mediaKind: command.kind, source })
          }
          return
        }
        throw new Error('当前插入类型不可用')
      } catch (error) { setError(error instanceof Error ? error.message : 'Flow 插入失败') }
    })()
  }

  useEditorKeyboardRouter({
    isReadOnly: () => courseDelivery.previewOpen || useEditorStore.getState().canvasMode === 'run',
    captureDeleteSnapshot(target) {
      const state = useEditorStore.getState()
      const flow = state.flowSession
      return {
        hasCourseProject: Boolean(selectActiveCourseProjectDocument(state)),
        selection: state.createLiveEditorSelectionSnapshot(target),
        contentEditable: target instanceof HTMLElement && target.isContentEditable,
        hasFlowSession: Boolean(flow),
        flowComposing: Boolean(state.flowTextEdit?.composing),
        flowTextFocus: flow?.selection.focus === 'text',
        flowHasSelection: Boolean(
          flow && (
            selectSelectedNodeIds(state).length > 0
            || flow.selection.selectedBlockIds.length > 0
            || flow.selection.selectedOverlayIds.length > 0
          ),
        ),
        hasSlideBackend: Boolean(selectSlideAuthoringBackend(state)),
        slideTextEdit: Boolean(
          state.editingTextNodeId || state.v9ContentEdit?.kind === 'text',
        ),
        slideFormulaEdit: state.v9ContentEdit?.kind === 'formula',
        ...(target instanceof HTMLElement ? { slideTagName: target.tagName } : {}),
        selectedNodeCount: selectSelectedNodeIds(state).length,
        editingText: Boolean(state.editingTextNodeId),
      }
    },
    routeEditorAction: (actionId, snapshot) => (
      useEditorStore.getState().routeEditorAction(actionId, snapshot)
    ),
    deleteSelectedNodes: () => useEditorStore.getState().deleteSelectedNodes(),
    copySelection: () => useEditorStore.getState().copySelectedNodes(),
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
  const slideLight = useMemo(() => {
    const readCurrent = () => {
      const state = useEditorStore.getState()
      const connection = state.courseDocument
      const snapshot = connection.snapshot
      const backend = selectSlideAuthoringBackend(state)
      const candidate = state.slideCandidateSnapshot
      if (!connection.connected || connection.pending || connection.error || !snapshot ||
        snapshot.model.kind !== 'course-v9' || snapshot.documentId !== connection.documentId ||
        !backend || !candidate || state.flowSession || state.spatialSession ||
        state.canvasMode !== 'edit' || selectEditingScope(state) !== 'scene' ||
        state.v9ContentEdit || state.editingTextNodeId || state.flowDocumentDraft) return null
      const project = backend.getSession().history.present
      const token = state.courseAuthoringSession?.token
      if (snapshot.model.project.id !== project.id || snapshot.model.project.revision !== project.revision ||
        token?.surfaceType !== 'slide' || token.locationId !== candidate.locationId ||
        token.revision !== project.revision) return null
      const selected = candidate.selection.selectionIds
      const itemId = selected.length === 1 && project.surfaces.some(surface => surface.type === 'slide' &&
        surface.scenes.some(scene => scene.id === candidate.sceneId &&
          scene.layerItems.some(item => item.layerItemId === selected[0]))) ? selected[0]! : null
      return { documentId: snapshot.documentId, epoch: snapshot.epoch, project,
        locationId: candidate.locationId, stateId: candidate.selection.stateId, itemId, pending: connection.pending }
    }
    return createSlideLightEditingPort({
      readCurrent,
      async commit(step, target) {
        const current = readCurrent()
        if (!current || current.documentId !== target.documentId || current.epoch !== target.epoch ||
          current.project.id !== target.projectId || current.project.revision !== target.expectedRevision ||
          current.locationId !== target.locationId || current.stateId !== target.stateId ||
          (target.kind === 'object' && current.itemId !== target.itemId)) return false
        const store = useEditorStore.getState()
        const token = store.courseAuthoringSession?.token
        if (!token || !store.commitDesignProduction(step, token)) return false
        const confirmed = await useEditorStore.getState().drainCourseDocument()
        return confirmed.documentId === target.documentId && confirmed.epoch === target.epoch &&
          confirmed.model.kind === 'course-v9' && confirmed.model.project.id === target.projectId &&
          confirmed.model.project.revision === step.nextDocument.revision
      },
      async chooseAudio() {
        const prepared = await mediaImportRef.current.selectTargetMedia({
          kind: 'audio',
          captureTarget: readCurrent,
          isTargetCurrent: target => {
            const live = readCurrent()
            return Boolean(live && live.documentId === target.documentId && live.epoch === target.epoch
              && live.project.id === target.project.id && live.project.revision === target.project.revision
              && live.locationId === target.locationId && live.stateId === target.stateId
              && live.itemId === target.itemId)
          },
        })
        if (!prepared) return null
        prepared.assertCurrent()
        return { asset: prepared.asset, bytes: prepared.bytes }
      },
      createId: () => crypto.randomUUID(),
    })
  }, [])
  const slideLightPageTarget = slideLight.capturePage()
  const slideLightPageView = slideLightPageTarget ? slideLight.viewPage(slideLightPageTarget) : null
  const courseEditorActions = useMemo<CourseEditorActions>(() => ({
    replaceImage: () => { void mediaImportRef.current.selectAndImportImage('replace') },
    replaceVideo: () => { void mediaImportRef.current.replaceSelectedVideo() },
    slideLight,
  }), [slideLight])

  return (
    <ProjectColorPaletteContext.Provider value={projectColors}>
    <CourseEditorActionsContext.Provider value={courseEditorActions}>
    <LessonWorkspaceHost ref={lessonShell} projectPath={projectPath} documents={documentsWithSaveDirectory ?? undefined} onSaveDirectoryChange={setSaveDirectory}
      courseDocuments={{ documents: courseConnection.documents, activation: courseConnection.activation,
        activeDocumentId: courseConnection.documentId,
        activate: id => useEditorStore.getState().activateCourseDocument(id),
        close: id => useEditorStore.getState().closeCourseDocument(id) }}
      prepareCourseDocuments={async () => { await useEditorStore.getState().drainAllCourseDocuments() }}
      captureCourseDocument={async writable => {
        const snapshot = await useEditorStore.getState().drainCourseDocument()
        return [captureDocumentReference(snapshot, writable)]
      }}
      onOpenProject={path => courseProjectLifecycle.openRecentProject(path, { origin: 'lesson' })} onNewProject={() => courseProjectLifecycle.newProject({ origin: 'lesson' })} onNewProjectFromPptx={newProjectFromPptx} onDirtyChange={setLessonDirty} onActiveDocumentChange={setActiveWorkspaceDocument}
      onImportHtml={(directory, sourceEntryId) => { void openHtmlImport(directory, sourceEntryId) }}
>
    <CourseEditorFrame lightTools={<CourseLightToolbar
      slideLightPage={slideLightPageView ? { view: slideLightPageView, run: command => slideLight.runPage(slideLightPageView.target, command) } : null}
      documentId={courseConnection.documentId}
      isCurrentDocument={id => useEditorStore.getState().courseDocument.documentId === id}
      canUndo={canUndoCourse} canRedo={canRedoCourse}
      canUndoLatestAgent={courseConnection.snapshot?.undoHead?.actor === 'agent'}
      undo={() => useEditorStore.getState().undo()} redo={() => useEditorStore.getState().redo()}
      undoLatestAgent={() => { void useEditorStore.getState().undoLatestAgentCourseDocument().catch(error => setError(error instanceof Error ? error.message : '撤销最近 AI 修改失败')) }}
      save={() => { void courseProjectLifecycle.saveProject(false) }}
      saveAs={() => { void courseProjectLifecycle.saveProject(true) }}
      onReplaceImage={() => { void mediaImport.selectAndImportImage('replace') }}
      onAddText={() => { void (async () => {
        const before = useEditorStore.getState()
        const documentId = before.courseDocument.documentId
        const revision = selectActiveCourseProjectDocument(before)?.revision
        const locationId = selectActiveCourseLocationId(before)
        const priorSelection = selectSelectedNodeId(before)
        const priorFlowBlock = before.flowSession?.selection.selectedBlockId
        before.addTextNode()
        try { await useEditorStore.getState().drainCourseDocument() }
        catch (error) { setError(error instanceof Error ? error.message : '文字插入尚未确认。'); return }
        const after = useEditorStore.getState()
        if (selectActiveCourseLocationId(after) !== locationId) return
        const flow = after.flowSession
        const flowBlockId = flow?.selection.selectedBlockId
        if (documentId && after.courseDocument.documentId === documentId && flow && flowBlockId
          && flowBlockId !== priorFlowBlock && revision !== undefined
          && flow.history.present.revision > revision && flow.selection.authoringScope === 'page') {
          const found = findFlowBlockRecursive(flowSurfaceIn(flow.history.present, flow.selection.surfaceId).blocks, flowBlockId)
          if (found?.block.type === 'paragraph') {
            requestFlowBlockFocus({ documentId, surfaceId: flow.selection.surfaceId, blockId: flowBlockId, revision: flow.history.present.revision })
          }
          return
        }
        const selectedId = selectSelectedNodeId(after)
        const selected = selectSelectedNode(after)
        if (documentId && after.courseDocument.documentId === documentId
          && revision !== undefined && (selectActiveCourseProjectDocument(after)?.revision ?? revision) > revision
          && selectedId && selectedId !== priorSelection && selected?.id === selectedId && selected.type === 'text'
          && (after.spatialSession || after.slideCandidateSnapshot)) {
          after.beginTextEdit(selectedId, 'canvas')
        }
      })() }}
      onImportHtml={() => { void openHtmlImport() }}
      onAddImage={() => { void mediaImport.selectAndImportImage('add') }}
      onAddVideo={() => { void mediaImport.selectAndImportVideo('add') }}
      onAddAudio={() => {
        if (useEditorStore.getState().flowSession) { void mediaImport.selectAndInsertFlowAudio(); return }
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
      onPreview={courseDelivery.openPreview} onExport={courseDelivery.exportCourse}
      elementCards={{
        exists: card => {
          const state = useEditorStore.getState(), project = selectActiveCourseProjectDocument(state), target = card.target
          if (!project || state.courseDocument.documentId !== card.documentId) return false
          if (target.kind === 'course-object') return Boolean(locateCourseLayer(project, target.itemId))
          const surface = target.kind === 'flow-block' ? project.surfaces.find(item => item.id === target.surfaceId) : undefined
          return target.kind === 'flow-block' && surface?.type === 'flow' && Boolean(findFlowBlockRecursive(surface.blocks, target.blockId))
        },
        jump: card => {
          const target = card.target, state = useEditorStore.getState()
          if (state.courseDocument.documentId !== card.documentId) return
          if (target.kind === 'flow-block') {
            const locations = selectActiveCourseProjectDocument(state)?.locations ?? []
            const location = locations.find(item => item.kind === 'flow-block' && item.surfaceId === target.surfaceId && item.blockId === target.blockId)
              ?? locations.find(item => item.surfaceId === target.surfaceId)
            if (!location) return
            state.activateCourseLocation(location.id)
            requestFlowBlockSelection({ documentId: card.documentId, surfaceId: target.surfaceId, blockId: target.blockId })
            elementCards.requestOpen(card.key)
            return
          }
          if (target.kind !== 'course-object') return
          const global = Boolean(selectActiveCourseProjectDocument(state)?.globalLayerItems.some(({ item }) => item.layerItemId === target.itemId))
          state.activateCourseLocation(target.locationId)
          state.setEditingScope(global ? 'global' : 'scene')
          if (!global && target.stateId) state.setActivePresentationState(target.stateId)
          state.selectNode(target.itemId)
          elementCards.requestOpen(card.key)
        },
      }}
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
      /></CourseAdvancedChrome>
      <EditorPanelLayout
        className={`app-main${activeTab === 'developer' ? ' app-main--developer' : ''}`}
      >
        <ScenePanel />
        <div className="editor-center">
          <Workspace
            onDropWorkspaceMedia={dropWorkspaceMedia}
            onAddImage={(x, y) =>
              void mediaImport.selectAndImportImage('add', { x, y })
            }
            onAddVideo={(x, y) =>
              void mediaImport.selectAndImportVideo('add', { x, y })
            }
            onSelectImageAsset={mediaImport.selectImageAsset}
          />
          <CourseBottomNavigation documentId={courseConnection.documentId} />
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
        />
      </EditorPanelLayout>
      {pendingFlowComponent && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingFlowComponent(null)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="flow-component-choice-title" onMouseDown={event => event.stopPropagation()}>
          <h2 id="flow-component-choice-title">选择要插入的组件</h2>
          <p>将组件插入{pendingFlowComponent.command.destination === 'document' ? '正文' : '纸面'}。选择已有组件或内置组件。</p>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {Object.values(componentPackages).map(data =>
              <button key={data.manifest.id} type="button" className="secondary-button" onClick={() => {
                const pending = pendingFlowComponent
                setPendingFlowComponent(null)
                insertFlowMenu(pending.command, { packageId: data.manifest.id }, pending.capture, data)
              }}>{data.manifest.name}</button>)}
            {selectAvailableBuiltInCatalogPackages(componentLibrary.componentCatalog.packages, componentPackages)
              .map(entry => <button key={entry.packageId} type="button" className="secondary-button" onClick={() => {
                const pending = pendingFlowComponent
                setPendingFlowComponent(null)
                void componentLibrary.prepareCatalogPackage(entry).then(data => {
                  if (data) insertFlowMenu(pending.command, { packageId: data.manifest.id }, pending.capture, data)
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
        <span>{editingScope === 'global' ? '全局层' : activeScene.name}</span>
        <span>·</span>
        <span>{editingScope === 'global' ? `${editingItemCount} 个全局元素` : `${editingItemCount} 个节点`}</span>
        {(slideSceneCount > RECOMMENDED_PROJECT_SCENES ||
          editingItemCount > RECOMMENDED_SCENE_NODES) && (
          <>
            <span>·</span>
            <span className="status-bar__warning" title="大型 H5 演示建议使用网页包导出，以减少启动和内存压力">
              大型 H5 演示 · 建议网页包
            </span>
          </>
        )}
        <span>·</span>
        <span>{selectedNodeIds.length > 1 ? `已选 ${selectedNodeIds.length} 个图层` : selectedItemName ? `已选：${selectedItemName}` : editingScope === 'global' ? '未选择全局元素' : '未选择节点'}</span>
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
        open={Boolean(componentLibrary.replacementRequest)}
        title="审阅组件包替换"
        message={componentLibrary.replacementRequest
          ? (() => {
              const current = componentPackages[componentLibrary.replacementRequest!.packageId]
              const next = componentLibrary.replacementRequest!.packageData
              return `组件：${next.manifest.name} (${next.manifest.id})\n当前版本：${current?.manifest.version ?? '未知'}\n新版本：${next.manifest.version}\n文件：${componentLibrary.replacementRequest!.sourceFileName}\nSHA-256：${next.provenance?.sha256 ?? '未登记'}\n\n确认后，场景与全局层中的全部实例会切换到该包并保留当前属性；此操作可以撤销。请只替换为已审阅的可信代码。`
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
        const receipt = await state.runAuthoringTool(createMaterialCitationRequest({ document, locationId,
          sessionGeneration: state.courseAuthoringSession!.token.generation, material }))
        if (receipt.status !== 'committed') throw new Error(receipt.diagnostics.map(entry => entry.message).join('；') || '材料引用未提交')
      }} />}
      {designTool?.kind === 'recipe' && <div className="modal-backdrop" role="presentation">
        <section className="design-production-dialog" role="dialog" aria-modal="true" aria-label="新建配方页">
          <header><h2>新建配方页</h2><button type="button" aria-label="关闭配方" onClick={() => setDesignTool(null)}><X size={18} /></button></header>
          <RecipePanel project={activeCourseDocument ?? designTool.context.document} locationId={designSessionToken?.locationId ?? designTool.context.sessionToken.locationId}
            sessionGeneration={designSessionToken?.generation} error={errorMessage ?? undefined}
            onApply={input => {
              const store = useEditorStore.getState()
              const live = store.readDesignProductionContext()
              if (live && store.applyCourseRecipe(input, live.sessionToken)) setDesignTool(null)
            }} />
        </section>
      </div>}
      {(designTool?.kind === 'productivity' || designTool?.kind === 'pptx') && <ProductivityDialog
        key={designTool.kind}
        pptxOnly={designTool.kind === 'pptx'}
        getContext={() => {
          const context = useEditorStore.getState().readDesignProductionContext()
          if (!context) throw new Error('当前工程会话已关闭')
          return context
        }}
        getAssetFiles={() => selectMediaAssetFiles(useEditorStore.getState())}
        onCommit={step => {
          const store = useEditorStore.getState()
          const live = store.readDesignProductionContext()
          if (!live || !store.commitDesignProduction(step, live.sessionToken)) return false
          const hint = step.selectionHint
          if (hint && typeof hint === 'object' && 'locationId' in hint && typeof hint.locationId === 'string') {
            store.activateCourseLocation(hint.locationId)
          }
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
        hardLimitBytes={courseDelivery.singleHtmlHardLimitBytes}
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
    </CourseEditorFrame>
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
