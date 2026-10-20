import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import { resolveRendererEntryUrl } from '../rendererEntry'
import type { BrowserWindow } from 'electron'
import type { HostToolServices } from '../../core/tools/HostToolServices'
import { artifactDeliverySource } from '../../core/tools/HostArtifactTools'
import type { ToolRunGrant } from '../../shared/workbench/tools'
import type { AgentFileContext } from '../../core/tools/AgentFileTools'
import { AgentFileOutcomeUnknown } from '../../core/tools/AgentFileTools'
import { materialListSchema } from '../../core/tools/MaterialTools'
import { dispatchMaterialTool, readMaterialImageSource } from './execution/MaterialReadTools'
import { attachmentsDesktopService } from './attachments/attachmentsDesktopService'
import type { ExportBuildReply, ExportBuildProgress } from '../../shared/workbench/toolPorts'
import type { ModelConnectionSnapshot } from '../../shared/workbench/modelProvider'
import type { SpeechSelectionSnapshot } from '../../shared/workbench/speechSettings'
import { IPC_CHANNELS } from '../../shared/ipcTypes'
import { documentHost } from './documentHost'
import { uiExportBuildRequest } from './uiDocumentSnapshot'
import { ScopedSkillService, type SkillRoot } from './skills/ScopedSkillService'
import { BundledSkillService } from './skills/BundledSkillService'
import bundledSkills from '../../shared/generated/bundledSkills.json'
import { createProjectFileServices } from './projectFiles/projectFileServices'
import { ViewObservationService } from './observation/ViewObservationService'
import { ViewObservationDesktopService } from './observation/ViewObservationDesktopService'
import type { PublishedActionPreviewPort } from './observation/HtmlActionService'
import { ObservationImageStore } from './observation/ObservationImageStore'
import { DocumentDeliveryService } from './delivery/DocumentDeliveryService'
import { ExecutionRunStore } from './execution/ExecutionRunStore'
import { DocumentDeliveryOperationStore } from './delivery/DocumentDeliveryOperationStore'
import { DocumentExportPort } from './delivery/DocumentExportPort'
import { HeadlessDocumentExportWorker } from './delivery/HeadlessDocumentExportWorker'
import { resolveExportDestination, resolveSaveDestination, workbenchExportWriter } from './workbenchDeliveryAdapters'
import { frozenImageRoles } from './images/frozenImageRoles'
import { ImageGenerationService } from './images/ImageGenerationService'
import { HostJobService } from './jobs/HostJobService'
import { ComputeJobService } from './compute/ComputeJobService'
import { PyodideComputeBackend } from './compute/PyodideComputeBackend'
import { WebResearchService, type WebResearchOptions } from './network/WebResearchService'
import { ManagedBrowserMcpService, type ManagedBrowserGrant } from './externalTools/ManagedBrowserMcpService'
import { createElectronEmbeddedBrowserFactory } from './browserEmbedded/ElectronEmbeddedBrowser'
import type { EmbeddedBrowserViewport } from '../../shared/workbench/embeddedBrowser'
import { BrowserActionApprovals, type BrowserActionApproval, type BrowserTaskAction } from './externalTools/BrowserActionApprovals'
import { MediaCapabilityService } from './media/MediaCapabilityService'
import { SpeechMediaJobAdapter } from './media/SpeechMediaJobAdapter'
import { WindowsSpeechSynthesizer } from './media/WindowsSpeechSynthesizer'
import { freezeSpeechSelection, speechConnectionCapability } from './speechSelection'
import { DelegationJobService } from './delegation/DelegationJobService'
import { ReadonlyTaskRunner } from './delegation/ReadonlyTaskRunner'
import { NativeTaskRunner, type NativeExecutionEnginePort } from './delegation/NativeTaskRunner'
import { freezeTaskInputs, freezeComputeInputs } from './delegation/freezeTaskInputs'
import { OpenAIChatProvider } from './providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, OpenAIResponsesProvider } from './providers/ChatGPTResponsesProvider'
import { AnthropicMessagesProvider } from './providers/AnthropicMessagesProvider'
import { routeModelProviders } from './providers/ModelProviderRouter'
import { freezeSearchSelection } from './network/SearchRouter'
import { defaultSearchSettings } from '../../shared/workbench/searchSettings'
import { createSearchRouter } from './network/searchService'
import { ChatGPTImageProvider } from './images/ChatGPTImageProvider'
import { OpenAIImagesApiProvider } from './images/OpenAIImagesApiProvider'
import { imageRoute } from './images/imageRoute'
import { executionSettingsStore, resolveOAuthCredential } from './providers/executionSettingsService'
import { createWorkbenchOpenImageService } from './assetSources/pixabayDesktopService'
import { AssetLibraryService } from './assetSources/componentLibrarySearch'
import { componentCatalogManager } from '../componentCatalogManager'
import { renderPdfFromHtml } from '../pdfExport'
import { createHtmlActionServices } from './observation/TaskHtmlPreview'
import type { HtmlPreviewService } from './htmlPreview/HtmlPreviewService'
import { PptxCourseImportProducer } from './pptxImport/PptxCourseImportProducer'
import { mediaFileInput } from './admittedMediaResource'

let installed = false
let skillCatalogService: ScopedSkillService | undefined
let imageService: ImageGenerationService | undefined
let imageRoles: ReturnType<typeof frozenImageRoles> | undefined
let browserActionApprovals: BrowserActionApprovals | undefined
let browserService: ManagedBrowserMcpService | undefined
let exportPort: DocumentExportPort | undefined
let exportOwnerId: number | undefined
let headlessExportWorker: HeadlessDocumentExportWorker | undefined
let htmlActionServices: ReturnType<typeof createHtmlActionServices> | undefined
let publishedViewService: ViewObservationDesktopService | undefined
let htmlActionOptions: Parameters<typeof createHtmlActionServices>[0] | undefined
let pptxImportProducer: PptxCourseImportProducer | undefined
let computeBackend: PyodideComputeBackend | undefined
let nativeExecutionEngine: NativeExecutionEnginePort | undefined
let delegationService: DelegationJobService | undefined
/** User controls and model tools share the existing job lifecycle. */
export function workbenchDelegationService(): DelegationJobService {
  if (!delegationService) throw new Error('子任务服务尚未安装')
  return delegationService
}
/** Composition injects the same Engine used for the parent conversation. */
export function setWorkbenchNativeExecution(engine: NativeExecutionEnginePort): void { nativeExecutionEngine = engine }
export function setWorkbenchHtmlPreview(live: HtmlPreviewService): void {
  if (!htmlActionOptions) throw new Error('HTML 页面操作服务尚未安装')
  htmlActionOptions.live = live
}
export function workbenchHtmlActions() {
  if (!htmlActionServices) throw new Error('HTML 页面操作服务尚未安装')
  return htmlActionServices.actions
}
export function releaseWorkbenchHtmlDocument(documentId: string): void {
  htmlActionServices?.preview.releaseDocument(documentId)
  publishedViewService?.releaseDocument(documentId)
}
export function acceptWorkbenchExportBuildReply(reply: ExportBuildReply, senderId: number): boolean {
  return exportPort?.accept(reply, senderId) ?? false
}
export function acceptWorkbenchExportBuildProgress(progress: ExportBuildProgress, senderId: number): boolean {
  return exportPort?.progress(progress, senderId) ?? false
}
export function disposeWorkbenchExportPort(): void {
  exportPort?.dispose(); exportPort = undefined; exportOwnerId = undefined
}
export function disposeHeadlessWorkbenchWorkers(): void {
  headlessExportWorker?.dispose(); headlessExportWorker = undefined
  htmlActionServices?.dispose(); htmlActionServices = undefined; htmlActionOptions = undefined
  publishedViewService?.dispose(); publishedViewService = undefined
  pptxImportProducer?.dispose(); pptxImportProducer = undefined
  computeBackend?.dispose(); computeBackend = undefined
}
export function workbenchImageService(): ImageGenerationService {
  if (!imageService) throw new Error('图片服务尚未安装')
  return imageService
}
export function workbenchImageSelection(runId: string, operation: 'generate' | 'edit') {
  if (!imageRoles) throw new Error('图片角色尚未安装')
  return imageRoles.selection(runId, operation)
}
/** Browser scope is frozen with the document run; outside-workspace uploads have no implicit grant. */
export function workbenchSkillRootsForGrant(grant: ToolRunGrant): readonly SkillRoot[] {
  return workbenchSkillRoots(grant.fileAccess?.workspaceRoot)
}
function workbenchSkillRoots(workspaceRoot?: string): readonly SkillRoot[] {
  const userSkillDirectory = path.resolve(process.env.COURSEWARE_SKILLS_DESTINATION || path.join(app.getPath('home'), '.agents', 'skills'))
  return [{ source: 'user', directory: userSkillDirectory, authorizedRoot: userSkillDirectory },
    ...(workspaceRoot ? [{ source: 'workspace' as const, directory: path.join(workspaceRoot, '.agents', 'skills'), authorizedRoot: workspaceRoot }] : [])]
}
export async function workbenchSkillCatalog(workspaceRoot?: string) {
  if (!skillCatalogService) throw new Error('Skill目录服务尚未就绪')
  return skillCatalogService.catalogForRoots(workbenchSkillRoots(workspaceRoot))
}
export function managedBrowserGrantForRun(grant: Parameters<NonNullable<HostToolServices['beginRun']>>[0]): ManagedBrowserGrant {
  const permission = grant.actor === 'agent' ? grant.fileAccess?.permission : 'read-only'
  return {
    permission: permission === 'full' ? 'full-access' : permission === 'workspace' ? 'workspace-write'
      : permission === 'ask' ? 'ask-before-edit' : 'read-only',
    allowPublicNavigation: true,
    ...(grant.fileAccess?.workspaceRoot ? { uploadRoot: grant.fileAccess.workspaceRoot } : {}),
  }
}
/** Call only after the product ApprovalView approves the exact model action. */
export function approveWorkbenchBrowserAction(input: BrowserActionApproval): void {
  if (!browserActionApprovals || !browserService) throw new Error('受管浏览器尚未安装')
  if (browserService.approvalContext(input.runId).snapshotId !== input.snapshotId)
    throw new Error('外部页面已变化，请重新观察后批准具体操作')
  browserActionApprovals.grant(input)
}
/** Main obtains action facts from the owned browser; a model cannot supply the authorization classification. */
export function authorizeWorkbenchBrowserActionFromTask(input: Parameters<ManagedBrowserMcpService['authorizeTaskAction']>[0]): Promise<boolean> {
  return browserService ? browserService.authorizeTaskAction(input) : Promise.resolve(false)
}
export function browserTaskActionWithinGrant(grant: ToolRunGrant, action: BrowserTaskAction): boolean {
  const scope = grant.webAuthorization
  if (!scope?.actions.length || action.action === 'unknown' || grant.fileAccess?.permission === 'read-only') return false
  try {
    const origins = new Set(scope.origins.map(value => new URL(value).origin))
    if (!origins.has(new URL(action.pageUrl).origin) || action.destinationUrl && !origins.has(new URL(action.destinationUrl).origin)) return false
    return action.action === 'prepare' || scope.actions.includes(action.action)
  } catch { return false }
}
export async function controlWorkbenchBrowser(runId: string, action: 'status' | 'takeover' | 'resume') {
  if (!browserService) throw new Error('本任务尚未启动受管浏览器')
  if (action === 'status') return browserService.controlState(runId)
  browserActionApprovals?.invalidate(runId)
  return browserService.control(runId, action)
}
export function viewportWorkbenchBrowser(runId: string, input: EmbeddedBrowserViewport) {
  if (!browserService) throw new Error('本任务尚未启动受管浏览器')
  return browserService.viewport(runId, input)
}

export function workbenchBrowserApprovalContext(runId: string): { pageUrl?: string; snapshotId?: string } {
  if (!browserService) throw new Error('受管浏览器尚未安装')
  return browserService.approvalContext(runId)
}
/** One DocumentHost owns the Gateway used by the built-in Engine and all external MCP clients. */
export function installWorkbenchToolServices(context: { getMainWindow(): BrowserWindow | null; getRendererEntryUrl(): string | null; headless?: boolean }): void {
  if (installed) return
  const host = documentHost(), directory = path.join(app.getPath('userData'), 'workbench-v2')
  htmlActionOptions = { readDocument: documentId => host.registry.get(documentId).drain(),
    taskTargetContext: runId => delegationService?.targetContextForRun(runId) ?? Promise.resolve(null),
    agentBundlePath: path.join(app.getAppPath(), 'dist-renderer', 'html-preview-agent.iife.js') }
  const observationImages = new ObservationImageStore()
  const publishedOwner = () => {
    if (!publishedViewService) {
      const entry = context.getRendererEntryUrl()
      if (!entry) throw new Error('当前没有可用的页面观察入口')
      publishedViewService = new ViewObservationDesktopService({ rendererEntryUrl: entry, compilation: host.compilation,
        snapshot: documentId => host.registry.get(documentId).drain() })
    }
    return publishedViewService
  }
  const published: PublishedActionPreviewPort = {
    contextForTarget: input => publishedOwner().contextForTarget(input),
    currentContext: input => publishedOwner().currentContext(input),
    readState: input => publishedOwner().readState(input),
    releaseContext: input => publishedViewService?.releaseContext(input),
    releaseRun: runId => publishedViewService?.releaseRun(runId),
  }
  htmlActionServices = createHtmlActionServices(htmlActionOptions, { images: observationImages, published })
  if (context.headless) {
    const entry = context.getRendererEntryUrl()
    if (!entry) throw new Error('后台导出资源入口不可用')
    headlessExportWorker = new HeadlessDocumentExportWorker(entry, host.compilation)
  }
  const roles = frozenImageRoles(async role => (await executionSettingsStore()).snapshot(role))
  const oauthImages = new ChatGPTImageProvider({ credentialResolver: resolveOAuthCredential })
  const apiImages = new OpenAIImagesApiProvider({ credentialResolver: connection => executionSettingsStore().then(store => store.resolveCredential(connection)) })
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'),
    provider: { generate: (request, references, options) =>
      (imageRoute(request) === 'chatgpt-oauth' ? oauthImages : apiImages).generate(request, references, options) },
    resolveReference: (runId, documentId, resource) => host.tools.readImageResource(runId, documentId, resource),
  })
  const computeDevURL = app.isPackaged || !process.env.VITE_DEV_SERVER_URL ? undefined : resolveRendererEntryUrl()
  computeBackend = new PyodideComputeBackend({ preloadPath: path.join(__dirname, '..', '..', 'preload', 'compute.js'),
    ...(computeDevURL ? { rendererURL: new URL('compute.html', computeDevURL).href }
      : { rendererFile: path.join(app.getAppPath(), 'dist-renderer', 'compute.html') }),
    runtimeDirectory: path.join(app.getAppPath(), computeDevURL ? 'public' : 'dist-renderer', 'vendor', 'compute-runtime') })
  const compute = new ComputeJobService({ directory: path.join(directory, 'compute'),
    backend: computeBackend })
  const apiCredential = async (connection: Readonly<ModelConnectionSnapshot>) => (await executionSettingsStore()).resolveCredential(connection)
  const readonlyProvider = routeModelProviders({
    'openai-chat': new OpenAIChatProvider({ credentialResolver: apiCredential }),
    'openai-responses': new OpenAIResponsesProvider({ credentialResolver: apiCredential }),
    'anthropic-messages': new AnthropicMessagesProvider({ credentialResolver: apiCredential }),
    'chatgpt-responses': new ChatGPTResponsesProvider({ credentialResolver: resolveOAuthCredential }),
  })
  const parentRuns = new ExecutionRunStore(path.join(directory, 'runs'))
  const delegation = new DelegationJobService({ directory: path.join(directory, 'delegation', 'jobs'),
    copyRootBase: path.join(directory, 'delegation', 'copies'), readonlyRunner: new ReadonlyTaskRunner({ provider: readonlyProvider,
      parentSelection: async runId => (await parentRuns.read(runId))?.input.selection ?? null }),
    nativeRunner: new NativeTaskRunner({ engine: () => nativeExecutionEngine,
      resolveSelection: (model, inherited) => executionSettingsStore().then(store => store.captureDelegationSelection(model, inherited)) }) })
  delegationService = delegation
  // The installed Codex CLI rejected both real command and patch writes. An operator must
  // verify an actual authorized copy write before enabling product-paid delegation.
  const delegationWriteVerified = process.env.GUOLING_CODEX_DELEGATION_WRITE_VERIFIED === '1'
  const jobs = new HostJobService({ images, compute, delegation })
  const search = createSearchRouter({ provider: readonlyProvider, credential: apiCredential, observeCapability: (selection, status, actualModel) => executionSettingsStore().then(store => store.recordNativeSearchCapability(selection, status, actualModel)) })
  const webOptions: WebResearchOptions = { searchProvider: search }
  const web = new WebResearchService(webOptions)
  const openImages = createWorkbenchOpenImageService(app.getVersion(), { pageSource: ({ runId, source, signal }) =>
    web.open({ runId, ...( /^https?:\/\//i.test(source) ? { url: source } : { sourceId: source }), signal }) })
  const assetLibrary = new AssetLibraryService({ catalog: componentCatalogManager })
  // Agent and human share the task's main-owned embedded page.
  const approvals = new BrowserActionApprovals()
  const mcp = new ManagedBrowserMcpService({ scratchRoot: path.join(directory, 'browser'),
    embeddedBackend: createElectronEmbeddedBrowserFactory(context.getMainWindow),
    readUpload: async ({ runId, path: source }) => {
      const file = await host.agentFiles.readAuthorizedFile(fileContext(runId), source)
      return { name: file.name, bytes: file.bytes }
    },
    authorizeTaskAction: input => approvals.grantFromTask(input),
    approveExternalAction: async input => {
      if (input.pageUrl && input.action) await approvals.grantFromTask({ ...input, pageUrl: input.pageUrl, action: input.action })
      return approvals.consume(input)
    } })
  const speechSelections = new Map<string, SpeechSelectionSnapshot>()
  const speech = new SpeechMediaJobAdapter({ directory: path.join(directory, 'media'), local: new WindowsSpeechSynthesizer(),
    resolveConnection: async (capability, runId) => {
      const connection = speechSelections.get(runId)?.connection
      if (!connection || connection.id !== capability.connectionId || connection.revision !== capability.connectionRevision)
        throw new Error('本次任务没有该冻结语音连接；未使用当前配置替代。')
      return connection
    }, credentialResolver: apiCredential })
  const media = new MediaCapabilityService([speech])
  const observations = new ViewObservationService({
    snapshot: documentId => host.registry.get(documentId).drain(),
    observeInteractive: ({ runId, identity, snapshot, projectId, signal }) =>
      htmlActionServices!.actions.observePublished(runId, { identity: { ...identity, projectId }, snapshot, signal }),
    captureIsolated: input => {
      const entry = context.getRendererEntryUrl()
      if (!entry) throw new Error('当前没有可用的画面观察入口')
      return new ViewObservationDesktopService({ rendererEntryUrl: entry, compilation: host.compilation }).captureIsolated(input)
    },
    images: observationImages,
  })
  const deliverySignals = new Map<string, AbortController>()
  const runGrants = new Map<string, ToolRunGrant>()
  const materialIds = new Map<string, Set<string>>()
  const fileContext = (runId: string, approvedPaths?: readonly string[], assertActive?: () => void): AgentFileContext => {
    const grant = runGrants.get(runId), access = grant?.fileAccess
    if (!access?.workspaceRoot) throw new Error('任务缺少已冻结的文件读取范围')
    return { runId, workspaceRoot: access.workspaceRoot, permission: access.permission,
      conversationHome: access.conversationHome, conversationHomeRoot: access.conversationHomeRoot,
      boundPaths: Object.values(access.boundPaths ?? {}), approvedOutsidePaths: approvedPaths,
      assertActive: () => { deliverySignals.get(runId)?.signal.throwIfAborted(); if (!runGrants.has(runId)) throw new Error('任务已停止'); assertActive?.() } }
  }
  const frozenSkillRoots = new Map<string, readonly SkillRoot[]>()
  const skills = new ScopedSkillService(new BundledSkillService(bundledSkills), async runId => {
    if (!deliverySignals.has(runId) || deliverySignals.get(runId)!.signal.aborted) throw new Error('Skill 读取任务已停止')
    return frozenSkillRoots.get(runId) ?? []
  })
  skillCatalogService = skills
  const currentExportPort = (): DocumentExportPort => {
    const window = context.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('当前没有可用的导出窗口')
    if (exportOwnerId !== window.webContents.id || !exportPort) {
      disposeWorkbenchExportPort()
      const ownerId = window.webContents.id
      exportOwnerId = ownerId
      const ownedPort = new DocumentExportPort(ownerId, request => window.webContents.send(IPC_CHANNELS.documentExportBuildRequest, uiExportBuildRequest(request)),
        cancel => { if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.documentExportBuildCancel, cancel) })
      exportPort = ownedPort
      const disposeOwner = () => { if (exportOwnerId === ownerId && exportPort === ownedPort) disposeWorkbenchExportPort() }
      window.once('closed', disposeOwner)
      window.webContents.once('render-process-gone', disposeOwner)
      window.webContents.once('destroyed', disposeOwner)
      window.webContents.on('did-start-navigation', navigation => {
        if (navigation.isMainFrame) disposeOwner()
      })
    }
    return exportPort
  }
  const deliveries = new DocumentDeliveryService({
    documents: { read: documentId => host.registry.get(documentId).drain(),
      prepareDrafts: async (documentId, epoch) => {
        const snapshot = await host.registry.get(documentId).drain()
        if (snapshot.epoch !== epoch || snapshot.model.kind !== 'course-v10') throw new Error('导出目标已关闭或重开')
        // This branch exists only on the dedicated Main host, never an attachment to GUI.
        if (context.headless) return
        const reply = await currentExportPort().build({ requestId: randomUUID(), phase: 'drain', format: 'html-offline', snapshot,
          identity: { documentId, epoch, revision: snapshot.revision, projectId: snapshot.model.project.id } })
        if (reply.status !== 'drained') throw new Error(reply.reason ?? '课件编辑尚未完成，未生成导出')
      },
      saveWithFact: (documentId, filename, identity) => host.saveWithFact(documentId, filename, identity),
      lookupSave: (documentId, identity) => host.lookupSave(documentId, identity),
      withFileLease: (documentId, work) => host.registry.get(documentId).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'document-delivery-operations')),
    taskRunIds: runId => new ExecutionRunStore(path.join(directory, 'runs')).taskLineage(runId),
    authorize: async ({ runId }) => {
      if (host.tools.runFileAccess(runId)?.permission === 'read-only') throw new Error('只读任务不能保存或导出文件')
    },
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, id => host.tools.runFileAccess(id)),
    resolveExportDestination: ({ runId, snapshot, requested, format, suggestedName }) =>
      resolveExportDestination(runId, snapshot, requested, suggestedName, format, id => host.tools.runFileAccess(id)),
    build: { build: (request, signal) => context.headless
      ? headlessExportWorker!.build(request, signal) : currentExportPort().build(request, signal) },
    renderPdf: async (html, signal) => {
      signal?.throwIfAborted()
      const bytes = await renderPdfFromHtml(html, context.getMainWindow() ?? undefined)
      signal?.throwIfAborted()
      return bytes
    },
    writer: workbenchExportWriter,
    withFileOperation: work => host.fileCoordinator.withFileOperation(work),
    assertExportTarget: async filename => {
      await host.assertFileAvailable(filename)
      const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
      for (const snapshot of host.registry.list()) if (snapshot.binding.kind === 'file' && key(snapshot.binding.path) === key(filename)
        && (await host.registry.get(snapshot.documentId).drain()).dirty) throw new Error('导出目标存在尚未保存的修改；请选择新文件名')
    },
    signalForRun: runId => deliverySignals.get(runId)?.signal,
  })
  const services: HostToolServices = {
    matchesSavedDocument: (sourceDocumentId, currentDocumentId) => host.matchesSavedDocument(sourceDocumentId, currentDocumentId),
    pptxImport: { lookup: async (runId, operationId, requestDigest) => {
      const previous = await host.agentFiles.lookupPreparedCourse(runId, operationId, requestDigest)
      return previous ? { kind: 'read', data: previous.data } : null
    }, import: async ({ grant, operationId, requestDigest, path: sourcePath, destination, assertActive }) => {
      const previous = await host.agentFiles.lookupPreparedCourse(grant.runId, operationId, requestDigest)
      if (previous) return { kind: 'read', data: previous.data }
      const access = fileContext(grant.runId, undefined, assertActive)
      const source = await host.agentFiles.readAuthorizedFile(access, sourcePath)
      if (!/\.pptx$/i.test(source.name)) throw new Error('此导入入口需要 PPTX 文件')
      const entry = context.getRendererEntryUrl()
      if (!entry) throw new Error('PowerPoint 导入宿主尚未准备好')
      const prepared = await (pptxImportProducer ??= new PptxCourseImportProducer(entry)).prepare({ bytes: source.bytes, filename: source.name },
        deliverySignals.get(grant.runId)?.signal)
      assertActive()
      const filename = destination ? path.resolve(access.workspaceRoot, destination) : undefined
      try {
        const outcome = await host.agentFiles.createPreparedCourse(access, { ...(filename ? { path: path.dirname(filename) } : {}),
          name: filename ? path.basename(filename) : prepared.suggestedName, bytes: prepared.archiveBytes }, operationId,
          { requestDigest, issues: prepared.issues })
        const data = outcome.data as Record<string, unknown>
        if (data.historical === true) return { kind: 'read', data }
        const operation = data.operation as { status?: string } | undefined
        if (operation?.status !== 'success') return { kind: 'error', code: 'pptx-import-file-failed', message: '转换内容已准备，但目标课件未创建；请核对目标路径', data }
        return { kind: 'read', data: { ...data, status: 'saved', issues: prepared.issues,
          ...(outcome.opened ? { documentId: outcome.opened.documentId } : {}) } }
      } catch (error) {
        if (error instanceof AgentFileOutcomeUnknown) return { kind: 'error', code: 'tool-outcome-unknown',
          message: 'PPTX 导入写盘回执未确认；请先核对目标课件，不要重复转换或创建', data: { destination: filename ?? prepared.suggestedName } }
        throw error
      }
    } },
    htmlActions: { execute: (runId, document, action) => workbenchHtmlActions().executeDocumentAction(runId, document, action),
      readResource: (runId, resourceId) => workbenchHtmlActions().readResource(runId, resourceId) },
    office: { execute: async ({ grant, operationId, name, input, approvedPaths, assertActive }) => {
      const result = await host.agentFiles.executeOffice(fileContext(grant.runId, approvedPaths, assertActive), name, input, operationId)
      return { kind: 'read', data: result.data }
    } },
    artifacts: {
      lookup: (runId, operationId) => host.artifactDeliveries.lookup(operationId, runId),
      preflight: ({ grant, destination }) => {
        const access = fileContext(grant.runId)
        return host.artifactDeliveries.preflight({ workspaceRoot: access.workspaceRoot, permission: access.permission, destination })
      },
      save: ({ grant, operationId, source, bytes, approvedPaths, assertActive }) => {
        const access = fileContext(grant.runId, approvedPaths, assertActive)
        const destination = path.resolve(access.workspaceRoot, source.destination)
        return host.artifactDeliveries.deliver({ runId: grant.runId, operationId, workspaceRoot: access.workspaceRoot,
          permission: access.permission, destination: source.destination, ...artifactDeliverySource(source), bytes,
          approvedTargetPath: approvedPaths?.find(value => path.resolve(value) === destination), assertActive: access.assertActive! })
      },
    },
    mediaFiles: { read: async (runId, source) => mediaFileInput(await host.agentFiles.readAuthorizedFile(fileContext(runId), source)) },
    taskInputs: { freeze: async (runId, sources, options = {}) => freezeTaskInputs(sources, {
      assertActive: () => fileContext(runId).assertActive?.(),
      isMaterial: source => materialIds.get(runId)?.has(source) === true,
      material: async (source, signal, modelRepresentation = true) => {
          const attachments = (await attachmentsDesktopService()).attachments
          const ids = materialIds.get(runId)!
          const original = await attachments.readOriginal(source)
          if (!modelRepresentation) return { name: original.snapshot.name, mimeType: original.snapshot.mediaType,
            bytes: original.bytes, version: original.snapshot.digest }
          let representation: string
          try {
            const read = await dispatchMaterialTool(attachments, ids, 'material.read', {
              attachmentId: source, representation: 'text', maxChars: 64000 }, signal ?? deliverySignals.get(runId)?.signal)
            if ('admittedSourceIds' in read) for (const id of read.admittedSourceIds ?? []) ids.add(id)
            representation = JSON.stringify(read.data)
          } catch (error) {
            signal?.throwIfAborted()
            // Extraction is a model view; unavailable text must not discard the original.
            representation = JSON.stringify({ source, name: original.snapshot.name, mediaType: original.snapshot.mediaType,
              byteLength: original.bytes.byteLength, textUnavailable: error instanceof Error ? error.message : String(error) })
          }
          return { name: original.snapshot.name, mimeType: original.snapshot.mediaType, bytes: original.bytes,
            version: original.snapshot.digest, representation }
      },
      authorize: source => host.agentFiles.authorizeTaskInput(fileContext(runId), source),
      opened: filename => host.readOpenedTaskInput(filename),
      disk: source => host.agentFiles.readAuthorizedFile(fileContext(runId), source),
    }, options) },
    computeInputs: { freeze: (runId, sources) => freezeComputeInputs(sources,
      (selected, options) => services.taskInputs!.freeze(runId, selected, options), deliverySignals.get(runId)?.signal) },
    materials: {
      admit: async (runId, sourceIds) => {
        const ids = materialIds.get(runId)
        if (!ids) throw new Error('材料读取任务已停止')
        const attachments = (await attachmentsDesktopService()).attachments
        for (const id of sourceIds) { await attachments.readSnapshot(id); ids.add(id) }
        deliverySignals.get(runId)?.signal.throwIfAborted()
      },
      read: async (runId, name, raw) => {
        const ids = materialIds.get(runId)
        if (!ids) throw new Error('材料读取任务已停止')
        const attachments = (await attachmentsDesktopService()).attachments
        let input = raw
        if (name === 'material.list') {
          const requested = materialListSchema.parse(raw)
          if (requested.path) {
            const file = await host.agentFiles.readAuthorizedFile(fileContext(runId), requested.path)
            const snapshot = await attachments.receiveBytes({ name: file.name, bytes: file.bytes,
              source: { kind: 'workspace', authorizationId: runId, pathHint: file.path } }, { signal: deliverySignals.get(runId)?.signal })
            ids.add(snapshot.id)
            input = { attachmentId: snapshot.id, offset: requested.offset, limit: requested.limit }
          }
        }
        const result = await dispatchMaterialTool(attachments, ids, name, input, deliverySignals.get(runId)?.signal)
        if ('admittedSourceIds' in result) for (const id of result.admittedSourceIds ?? []) ids.add(id)
        return { kind: 'read', data: { ...result.data, ...('admittedSourceIds' in result ? { admittedSourceIds: result.admittedSourceIds } : {}) } }
      },
      readResource: async ({ runId, resourceId }) => {
        const ids = materialIds.get(runId)
        if (!ids) throw new Error('材料读取任务已停止')
        return readMaterialImageSource((await attachmentsDesktopService()).attachments, ids, resourceId, deliverySignals.get(runId)?.signal)
      },
    },
    projectFiles: createProjectFileServices(host),
    deliveries,
    observations: {
      stopRun: runId => observations.stopRun(runId),
      actionIdentity: runId => {
        try { return htmlActionServices?.actions.publishedIdentity(runId) ?? null }
        catch { return null }
      },
      click: input => {
        const signal = deliverySignals.get(input.runId)?.signal
        if (!signal || signal.aborted) throw new Error('观察任务已停止')
        return htmlActionServices!.actions.clickPublished(input.runId, { operationId: input.operationId, handle: input.handle })
      },
      input: input => {
        const signal = deliverySignals.get(input.runId)?.signal
        if (!signal || signal.aborted) throw new Error('观察任务已停止')
        return htmlActionServices!.actions.inputPublished(input.runId, { operationId: input.operationId, handle: input.handle, value: input.value })
      },
      observe: input => {
        const signal = deliverySignals.get(input.runId)?.signal
        if (!signal || signal.aborted) throw new Error('观察任务已停止')
        return observations.observe({ ...input, signal })
      },
      readResource: input => {
        if (!deliverySignals.has(input.runId)) throw new Error('观察任务已停止')
        return observations.readResource(input)
      },
    },
    skills,
    jobs,
    ...(compute ? { compute } : {}),
    delegation: {
      models: () => executionSettingsStore().then(store => store.availableDelegationModels()),
      availability: () => ({ ready: delegationWriteVerified,
        reason: delegationWriteVerified ? 'Codex Luna Fast 委派连接已显式验证可写'
          : '当前 Codex 委派写入被执行器策略阻断；本次未启动收费模型请求' }),
      startManaged: input => delegation.startManaged(input),
      prepareLocal: input => delegation.prepareLocal(input),
      authorizeLocal: input => delegation.authorizeLocal(input),
      startLocal: input => delegation.startLocal(input),
      startReadonly: input => delegation.startReadonly(input),
      startNative: input => delegation.startNative(input),
      resumeNative: input => delegation.resumeNative(input),
      message: (runId, jobId, submissionId, text) => delegation.message(runId, jobId, submissionId, text),
      readArtifact: (runId, jobId, name) => delegation.readArtifact(runId, jobId, name),
      cancel: (runId, jobId) => delegation.cancel(runId, jobId),
      cancelRun: runId => delegation.cancelRun(runId),
    },
    web: { describe: runId => {
      const frozen = search.selection(runId), mode = frozen?.settings.mode ?? 'off'
      const backend = mode === 'off' ? 'off' : mode === 'deepseek' ? 'deepseek-official' : mode === 'openai' || mode === 'auto' && frozen?.openai
        ? 'openai-native' : frozen?.settings.independent === 'searxng' ? 'searxng' : 'exa-mcp'
      const configured = !!frozen && (backend === 'off' ? false : backend === 'openai-native' ? !!frozen.openai : backend === 'deepseek-official' ? !!frozen.deepseek : backend === 'searxng' ? !!frozen.settings.searxngURL : true)
      return { mode, backend, configured, detail: frozen?.diagnostic ?? (backend === 'exa-mcp' ? '免 Key 托管 Exa MCP，有限额；实际可用性以调用回执为准' : configured ? '本次运行已冻结选择；配置不等于实网调用成功' : '所选后端尚未配置或已关闭；web.open 可独立读取 URL') }
    }, search: input => web.search(input), open: async input => {
      const result = await web.open(input)
      if (result.status === 'material') {
        const ids = materialIds.get(input.runId)
        if (!ids) throw new Error('联网材料任务已停止')
        result.attachmentIds.forEach(id => ids.add(id))
      }
      return result
    } },
    mcp,
    media,
    openImages: { search: input => openImages.search(input), preview: input => openImages.preview(input),
      readPreview: (runId, resourceId) => openImages.readPreview(runId, resourceId), fetch: input => openImages.fetch(input) },
    assetLibrary: { search: input => assetLibrary.search(input), read: input => assetLibrary.read(input),
      import: async ({ runId, file }) => {
        const source = await host.agentFiles.readAuthorizedFile(fileContext(runId), file)
        deliverySignals.get(runId)?.signal.throwIfAborted()
        return assetLibrary.import(source.bytes)
      },
      delete: ({ runId: _runId, ...input }) => assetLibrary.delete(input),
      save: ({ runId: _runId, ...input }) => assetLibrary.save(input) },
    beginRun: async grant => {
      const parentRunId = grant.delegatedBy?.runId
      if (!parentRunId && grant.disclosedSettings && (await (await executionSettingsStore()).read()).profile.revision !== grant.disclosedSettings.profileRevision)
        throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
      const speechSelection = grant.speechSelection ?? (parentRunId
        ? { unavailableReason: '父任务未冻结远程语音 API 配置；本机语音仍可独立使用。' }
        : freezeSpeechSelection(await (await executionSettingsStore()).read()))
      await roles.beginRun(grant.runId, grant.disclosedSettings, parentRunId)
      const parentSearch = parentRunId ? search.selection(parentRunId) : undefined
      search.beginRun(grant.runId, parentRunId ? parentSearch ?? { settings: { ...defaultSearchSettings(), mode: 'off' },
        profileRevision: grant.disclosedSettings?.profileRevision ?? 0, openai: null, deepseek: null,
        diagnostic: '原父任务冻结的搜索配置未保留；当前子任务仍可继续，重新启用搜索需要新主任务配置。' }
        : freezeSearchSelection(await (await executionSettingsStore()).read(), grant.searchSelection))
      frozenSkillRoots.set(grant.runId, workbenchSkillRootsForGrant(grant))
      const controller = new AbortController()
      deliverySignals.set(grant.runId, controller)
      runGrants.set(grant.runId, structuredClone(grant))
      speechSelections.set(grant.runId, structuredClone(speechSelection))
      materialIds.set(grant.runId, new Set(grant.materialIds ?? []))
      try {
        webOptions.materials = (await attachmentsDesktopService()).attachments
        web.beginRun(grant.runId)
        openImages.beginRun(grant.runId)
        await mcp.beginRun(grant.runId, managedBrowserGrantForRun(grant))
        approvals.beginRun(grant.runId, input => !controller.signal.aborted && browserTaskActionWithinGrant(grant, input))
        const localSpeech = await speech.discoverLocal()
        const remoteSpeech = speechConnectionCapability(speechSelection)
        controller.signal.throwIfAborted()
        media.beginRun(grant.runId, { writable: grant.actor === 'agent' && !!grant.fileAccess && grant.fileAccess.permission !== 'read-only',
          capabilities: [...(localSpeech.capability ? [localSpeech.capability] : []), ...(remoteSpeech ? [remoteSpeech] : [])],
          unavailableReasons: { ...(localSpeech.reason ? { 'speech:local': localSpeech.reason } : {}),
            ...(!remoteSpeech ? { 'speech:remote': speechSelection.unavailableReason ?? '本次任务未配置远程语音 API。' } : {}) } })
      } catch (error) {
        controller.abort(); deliverySignals.delete(grant.runId)
        runGrants.delete(grant.runId); speechSelections.delete(grant.runId); materialIds.delete(grant.runId)
        approvals.revokeRun(grant.runId)
        frozenSkillRoots.delete(grant.runId)
        search.endRun(grant.runId)
        await Promise.allSettled([web.stopRun(grant.runId), mcp.endRun(grant.runId), media.stopRun(grant.runId)])
        web.endRun(grant.runId); media.endRun(grant.runId); openImages.endRun(grant.runId)
        throw error
      }
    },
    stopRun: async runId => {
      htmlActionServices?.actions.stopRun(runId)
      approvals.revokeRun(runId)
      deliverySignals.get(runId)?.abort(); deliverySignals.delete(runId); observationImages.clearRun(runId); skills.release(runId)
      openImages.stopRun(runId)
      frozenSkillRoots.delete(runId)
      search.endRun(runId)
      runGrants.delete(runId); speechSelections.delete(runId); materialIds.delete(runId); host.agentFiles.releaseRun(runId)
      await host.artifactDeliveries.stopRun(runId)
      await Promise.allSettled([web.stopRun(runId), mcp.stopRun(runId), media.stopRun(runId), delegation.cancelRun(runId), ...(compute ? [compute.cancelRun(runId)] : [])])
    },
    images: { describe: runId => roles.describe(runId),
      selection: (runId, _documentId, operation) => roles.selection(runId, operation),
      run: (request, options) => images.start(request, options), read: id => images.read(id),
      stop: id => images.stop(id), readResource: id => images.readResource(id),
      registerWorkspaceResource: (scope, image, source) => images.registerWorkspaceResource(scope, image, source),
      readWorkspaceResource: (scope, resource) => images.readWorkspaceResource(scope, resource),
      readReadyResourceFromJob: input => images.readReadyResourceFromJob(input) },
  }
  host.tools.configureHostServices(services)
  imageService = images
  imageRoles = roles
  browserActionApprovals = approvals
  browserService = mcp
  installed = true
}
