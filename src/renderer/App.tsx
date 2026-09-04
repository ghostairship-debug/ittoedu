import { AlertCircle, LoaderCircle, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  APP_EXECUTABLE_NAME,
  RECOMMENDED_PROJECT_SCENES,
  RECOMMENDED_SCENE_NODES,
} from '../shared/constants'
import { toUserMessage, UserFacingError } from '../shared/errors'
import {
  collectCourseProjectHealth,
  summarizeCourseProjectHealth,
} from '../shared/courseProjectHealth'
import {
  componentPackagesToArchiveFiles,
} from './components/componentPackageStore'
import { emptyCourseAssetSidecar } from './project/v9AssetAdapter'
import { useComponentLibrary } from './app/useComponentLibrary'
import { useCourseDelivery } from './app/useCourseDelivery'
import { useCourseProjectLifecycle } from './app/useCourseProjectLifecycle'
import { useEditorKeyboardRouter } from './app/useEditorKeyboardRouter'
import { useMediaImport } from './app/useMediaImport'
import {
  selectActiveCourseLocationId,
  selectActiveCourseProjectDocument,
  selectActiveScene,
  selectEditingNodes,
  selectEditingScope,
  selectEffectiveLayerProjection,
  selectMediaAssetFiles,
  selectMediaAssets,
  selectSelectedNode,
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
import { SceneStateStrip } from './ui/SceneStateStrip'
import { TopToolbar } from './ui/TopToolbar'
import { Workspace } from './ui/Workspace'
import { ProjectHealthPanel } from './ui/ProjectHealthPanel'
import { resolveCourseProjectDiagnosticTargetRoute } from './diagnostics/projectHealthNavigation'

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
  const [busy, setBusy] = useState(false)
  const [projectHealthOpen, setProjectHealthOpen] = useState(false)

  const dirty = useEditorStore(selectHasUnsavedCourseChanges)
  const projectPath = useEditorStore((state) => state.projectPath)
  const activeCourseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(
    (state) => state.componentPackages,
  )
  const v9ContentEdit = useEditorStore((state) => state.v9ContentEdit)
  const spatialContentEdit = useEditorStore((state) => state.spatialContentEdit)
  const flowTextEdit = useEditorStore((state) => state.flowTextEdit)
  const selectedNode = useEditorStore(selectSelectedNode)
  const selectedNodeIds = useEditorStore(selectSelectedNodeIds)
  const editingScope = useEditorStore(selectEditingScope)
  const editorMode = useEditorStore((state) => state.editorMode)
  const activeTab = useEditorStore((state) => state.activeTab)
  const editingNodes = useEditorStore(selectEditingNodes)
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
    prepareDraft: () => useEditorStore.getState().prepareCourseProjectPersistence(),
    acknowledgeSaved: (path, token) => (
      useEditorStore.getState().acknowledgeCourseProjectSaved(path, token)
    ),
    captureRecoverySnapshot: () => (
      useEditorStore.getState().captureCourseProjectRecoverySnapshot()
    ),
    loadOpenedProject(input) {
      loadCourseProject(
        input.project,
        input.path,
        input.assetFiles,
        input.componentPackages,
      )
      if (input.dirty || input.statusMessage) {
        useEditorStore.setState({
          ...(input.dirty ? { dirty: true } : {}),
          ...(input.statusMessage ? { statusMessage: input.statusMessage } : {}),
        })
      }
    },
    createBlankProject: createNewProject,
    createSpatialProject: createNewSpatialProject,
    createFlowProject: createNewFlowProject,
    hasUnsavedChanges: () => selectHasUnsavedCourseChanges(useEditorStore.getState()),
    projectPath: () => useEditorStore.getState().projectPath,
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
    desktopAvailable: () => Boolean(window.desktopAPI),
    openProjectFile: () => desktopApi().openProject(),
    openRecentProjectFile: (path) => desktopApi().openRecentProject({ path }),
    confirmProjectOpen: (confirmationId) => desktopApi().confirmProjectOpen({ confirmationId }),
    saveProjectFile: (input) => desktopApi().saveProject(input),
    listRecentProjects: async () => {
      if (!window.desktopAPI) return []
      return window.desktopAPI.listRecentProjects()
    },
    confirmDiscardChanges: () => desktopApi().confirmDiscardChanges(),
    clearRecoveryProject: () => desktopApi().clearRecoveryProject(),
    writeRecoveryProject: (input) => desktopApi().writeRecoveryProject(input),
    readRecoveryProject: async () => {
      if (!window.desktopAPI) return null
      return window.desktopAPI.readRecoveryProject()
    },
    peekProjectArchive: async (path) => {
      if (typeof window.desktopAPI?.peekProjectArchive !== 'function') return null
      return window.desktopAPI.peekProjectArchive({ path })
    },
    setWindowDirtyState: async (nextDirty) => {
      if (!window.desktopAPI) return
      await window.desktopAPI.setDirtyState(nextDirty)
    },
    subscribeSaveRequest: (handler) => {
      if (!window.desktopAPI) return () => undefined
      return window.desktopAPI.onRequestSave(handler)
    },
    subscribeSaveAndCloseRequest: (handler) => {
      if (!window.desktopAPI) return () => undefined
      return window.desktopAPI.onRequestSaveAndClose(handler)
    },
  }, {
    dirty,
    projectTitle: activeCourseDocument?.title ?? '',
    projectPath,
    documentTrigger: activeCourseDocument,
    sidecarTrigger: sidecarFiles,
    componentPackagesTrigger: componentPackages,
    slideDraftTrigger: v9ContentEdit,
    spatialDraftTrigger: spatialContentEdit,
    flowDraftTrigger: flowTextEdit,
    textEditTrigger: undefined,
  })

  const courseDelivery = useCourseDelivery({
    readCanonicalSnapshot() {
      const state = useEditorStore.getState()
      const document = selectActiveCourseProjectDocument(state)
      if (!document) return null
      return {
        project: document,
        assetFiles: selectMediaAssetFiles(state),
        components: state.componentPackages,
      }
    },
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
        if (route.tab === 'automation' || route.tab === 'components') {
          state.setEditorMode('professional')
        }
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
    importSounds: (items) => {
      useEditorStore.getState().importSounds([...items])
    },
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
    selectVideos: () => desktopApi().selectVideos(),
    runBusy: run,
    commitStatus: setStatus,
    reportError: setError,
  })

  const componentLibrary = useComponentLibrary({
    captureIdentity: captureCourseIdentity,
    captureReplacementTarget: (packageId) => (
      useEditorStore.getState().captureComponentPackageReplacementTarget(packageId)
    ),
    readInstalledPackages: () => useEditorStore.getState().componentPackages,
    replacePackageAtTarget: (target, packageData) => (
      useEditorStore.getState().replaceComponentPackageAtTarget(target, packageData)
    ),
    importPackages: (packages) => {
      useEditorStore.getState().importComponentPackages([...packages])
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

  useEditorKeyboardRouter({
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

  return (
    <div className="app-shell">
      <TopToolbar
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
        onPreview={courseDelivery.openPreview}
        onExport={courseDelivery.exportCourse}
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
              void mediaImport.selectAndImportImage('add', { x, y })
            }
            onAddVideo={(x, y) =>
              void mediaImport.selectAndImportVideo('add', { x, y })
            }
            onSelectImageAsset={mediaImport.selectImageAsset}
          />
          {spatialSession || flowSession ? null : <SceneStateStrip />}
        </div>
        <RightSidebar
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
      </div>
      <footer className="status-bar" aria-live="polite">
        <span className="status-dot" />
        <span>{busy ? '正在处理…' : (statusMessage ?? '就绪')}</span>
        <span className="status-bar__spacer" />
        <span>{editingScope === 'global' ? '全局层' : activeScene.name}</span>
        <span>·</span>
        <span>{editingScope === 'global' ? `${editingNodes.length} 个全局元素` : `${activeScene.nodes.length} 个节点`}</span>
        {(slideSceneCount > RECOMMENDED_PROJECT_SCENES ||
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
      <ConfirmDialog
        open={Boolean(courseProjectLifecycle.recoveryOffer)}
        title="发现未完成的本地恢复副本"
        message={courseProjectLifecycle.recoveryOffer ? `课件：${courseProjectLifecycle.recoveryOffer.projectName}\n保存时间：${new Date(courseProjectLifecycle.recoveryOffer.savedAt).toLocaleString('zh-CN')}\n\n恢复后请重新保存工程；如果这些修改已经不需要，可以丢弃副本。` : ''}
        confirmLabel="恢复课件"
        cancelLabel="丢弃副本"
        onCancel={courseProjectLifecycle.discardRecovery}
        onConfirm={courseProjectLifecycle.restoreRecovery}
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
                <p className="modal__message">Published Course V2 · CoursePlayer · 1280 × 720</p>
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
    </div>
  )
}
