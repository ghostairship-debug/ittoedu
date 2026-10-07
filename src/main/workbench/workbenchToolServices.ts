import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { HostToolServices } from '../../core/tools/HostToolServices'
import type { ToolRunGrant } from '../../shared/workbench/tools'
import type { AgentFileContext } from '../../core/tools/AgentFileTools'
import { materialListSchema, materialReadSchema } from '../../core/tools/MaterialTools'
import { dispatchMaterialTool } from './execution/MaterialReadTools'
import { attachmentsDesktopService } from './attachments/attachmentsDesktopService'
import type { ExportBuildReply, ExportBuildProgress } from '../../shared/workbench/toolPorts'
import { IPC_CHANNELS } from '../../shared/ipcTypes'
import { documentHost } from './documentHost'
import { ScopedSkillService, type SkillRoot } from './skills/ScopedSkillService'
import { BundledSkillService } from './skills/BundledSkillService'
import bundledSkills from '../../shared/generated/bundledSkills.json'
import { createProjectFileServices } from './projectFiles/projectFileServices'
import { ViewObservationService } from './observation/ViewObservationService'
import { ViewObservationDesktopService } from './observation/ViewObservationDesktopService'
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
import { PINNED_PYTHON_IMAGE_ID, PodmanComputeBackend } from './compute/PodmanComputeBackend'
import { WebResearchService, type WebResearchOptions } from './network/WebResearchService'
import { ManagedBrowserMcpService, type ManagedBrowserGrant } from './externalTools/ManagedBrowserMcpService'
import { createElectronEmbeddedBrowserFactory } from './browserEmbedded/ElectronEmbeddedBrowser'
import type { EmbeddedBrowserViewport } from '../../shared/workbench/embeddedBrowser'
import { BrowserActionApprovals, type BrowserActionApproval } from './externalTools/BrowserActionApprovals'
import { MediaCapabilityService } from './media/MediaCapabilityService'
import { DelegationJobService } from './delegation/DelegationJobService'
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

let installed = false
let imageService: ImageGenerationService | undefined
let imageRoles: ReturnType<typeof frozenImageRoles> | undefined
let browserActionApprovals: BrowserActionApprovals | undefined
let browserService: ManagedBrowserMcpService | undefined
let exportPort: DocumentExportPort | undefined
let exportOwnerId: number | undefined
let headlessExportWorker: HeadlessDocumentExportWorker | undefined
let htmlActionServices: ReturnType<typeof createHtmlActionServices> | undefined
let htmlActionOptions: Parameters<typeof createHtmlActionServices>[0] | undefined
export function setWorkbenchHtmlPreview(live: HtmlPreviewService): void {
  if (!htmlActionOptions) throw new Error('HTML 页面操作服务尚未安装')
  htmlActionOptions.live = live
}
export function workbenchHtmlActions() {
  if (!htmlActionServices) throw new Error('HTML 页面操作服务尚未安装')
  return htmlActionServices.actions
}
export function releaseWorkbenchHtmlDocument(documentId: string): void { htmlActionServices?.preview.releaseDocument(documentId) }
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
  const userSkillDirectory = path.resolve(process.env.COURSEWARE_SKILLS_DESTINATION || path.join(app.getPath('home'), '.agents', 'skills'))
  return [{ source: 'user', directory: userSkillDirectory, authorizedRoot: userSkillDirectory },
    ...(grant.fileAccess?.workspaceRoot ? [{ source: 'workspace' as const, directory: path.join(grant.fileAccess.workspaceRoot, '.agents', 'skills'),
      authorizedRoot: grant.fileAccess.workspaceRoot }] : [])]
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
    agentBundlePath: path.join(app.getAppPath(), 'dist-renderer', 'html-preview-agent.iife.js') }
  htmlActionServices = createHtmlActionServices(htmlActionOptions)
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
  const configuredImage = process.env.GUOLING_COMPUTE_IMAGE
  const computeImage = configuredImage && /^sha256:[a-f0-9]{64}$/.test(configuredImage) ? configuredImage : PINNED_PYTHON_IMAGE_ID
  const compute = new ComputeJobService({ directory: path.join(directory, 'compute'),
    backend: new PodmanComputeBackend({ distro: process.env.GUOLING_COMPUTE_WSL_DISTRO || 'Ubuntu', image: computeImage }) })
  const delegation = new DelegationJobService({ directory: path.join(directory, 'delegation', 'jobs'),
    copyRootBase: path.join(directory, 'delegation', 'copies') })
  // The installed Codex CLI rejected both real command and patch writes. An operator must
  // verify an actual authorized copy write before enabling product-paid delegation.
  const delegationWriteVerified = process.env.GUOLING_CODEX_DELEGATION_WRITE_VERIFIED === '1'
  const jobs = new HostJobService({ images, compute, delegation })
  const webOptions: WebResearchOptions = {}
  const web = new WebResearchService(webOptions)
  const openImages = createWorkbenchOpenImageService(app.getVersion())
  const assetLibrary = new AssetLibraryService({ catalog: componentCatalogManager })
  // Agent and human share the task's main-owned embedded page.
  const approvals = new BrowserActionApprovals()
  const mcp = new ManagedBrowserMcpService({ scratchRoot: path.join(directory, 'browser'),
    embeddedBackend: createElectronEmbeddedBrowserFactory(context.getMainWindow),
    readUpload: async ({ runId, path: source }) => {
      const file = await host.agentFiles.readAuthorizedFile(fileContext(runId), source)
      return { name: file.name, bytes: file.bytes }
    },
    approveExternalAction: async input => approvals.consume({ runId: input.runId, operationId: input.operationId,
      tool: input.tool, arguments: input.arguments, snapshotId: input.snapshotId }) })
  // Speech/video/music have no verified provider adapter in the current connection set.
  const media = new MediaCapabilityService()
  const observationImages = new ObservationImageStore()
  const observations = new ViewObservationService({
    snapshot: documentId => host.registry.get(documentId).drain(),
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
  const materialImages = new Map<string, Map<string, { mimeType: string; bytes: Uint8Array }>>()
  const fileContext = (runId: string, approvedPaths?: readonly string[], assertActive?: () => void): AgentFileContext => {
    const grant = runGrants.get(runId), access = grant?.fileAccess
    if (!access?.workspaceRoot) throw new Error('任务缺少已冻结的文件读取范围')
    return { runId, workspaceRoot: access.workspaceRoot, permission: access.permission,
      conversationHome: access.conversationHome, conversationHomeRoot: access.conversationHomeRoot,
      readOnlyRoots: Object.values(access.boundPaths ?? {}), approvedOutsidePaths: approvedPaths,
      assertActive: () => { deliverySignals.get(runId)?.signal.throwIfAborted(); if (!runGrants.has(runId)) throw new Error('任务已停止'); assertActive?.() } }
  }
  const frozenSkillRoots = new Map<string, readonly SkillRoot[]>()
  const skills = new ScopedSkillService(new BundledSkillService(bundledSkills), async runId => {
    if (!deliverySignals.has(runId) || deliverySignals.get(runId)!.signal.aborted) throw new Error('Skill 读取任务已停止')
    return frozenSkillRoots.get(runId) ?? []
  })
  const currentExportPort = (): DocumentExportPort => {
    const window = context.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('当前没有可用的导出窗口')
    if (exportOwnerId !== window.webContents.id || !exportPort) {
      disposeWorkbenchExportPort()
      const ownerId = window.webContents.id
      exportOwnerId = ownerId
      const ownedPort = new DocumentExportPort(ownerId, request => window.webContents.send(IPC_CHANNELS.documentExportBuildRequest, request),
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
    htmlActions: { execute: (runId, document, action) => workbenchHtmlActions().executeDocumentAction(runId, document, action),
      readResource: (runId, resourceId) => workbenchHtmlActions().readResource(runId, resourceId) },
    office: { execute: async ({ grant, operationId, name, input, approvedPaths, assertActive }) => {
      const result = await host.agentFiles.executeOffice(fileContext(grant.runId, approvedPaths, assertActive), name, input, operationId)
      return { kind: 'read', data: result.data }
    } },
    artifacts: {
      lookup: (runId, operationId) => host.artifactDeliveries.lookup(operationId, runId),
      save: ({ grant, operationId, source, bytes, approvedPaths, assertActive }) => {
        const access = fileContext(grant.runId, approvedPaths, assertActive)
        const destination = path.resolve(access.workspaceRoot, source.destination)
        return host.artifactDeliveries.deliver({ runId: grant.runId, operationId, workspaceRoot: access.workspaceRoot,
          permission: access.permission, destination: source.destination, sourceKind: source.kind,
          sourceId: source.kind === 'image' ? `${source.job}@${source.resourceId}` : `${source.job}@${source.name}`, bytes,
          approvedTargetPath: approvedPaths?.find(value => path.resolve(value) === destination), assertActive: access.assertActive! })
      },
    },
    computeInputs: { freeze: async (runId, sources) => {
      const inputs = await Promise.all(sources.map(source => host.agentFiles.readAuthorizedFile(fileContext(runId), source)))
      if (new Set(inputs.map(input => input.name)).size !== inputs.length) throw new Error('计算输入文件重名；请先选择不同文件名')
      return inputs.map(({ name, bytes }) => ({ name, bytes }))
    } },
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
        if ('admittedSourceIds' in result) for (const id of result.admittedSourceIds) ids.add(id)
        if (name === 'material.read' && 'modelMessage' in result && result.modelMessage) {
          const requested = materialReadSchema.parse(input)
          const image = await attachments.readRepresentation(requested.attachmentId, requested.representationId)
          const resourceId = `material:${requested.attachmentId}:${requested.representationId}`
          let resources = materialImages.get(runId)
          if (!resources) { resources = new Map(); materialImages.set(runId, resources) }
          resources.set(resourceId, { mimeType: image.representation.mediaType, bytes: image.bytes })
          return { kind: 'read', data: { ...result.data, image: { resourceId, mimeType: image.representation.mediaType } } }
        }
        return { kind: 'read', data: result.data }
      },
      readResource: async ({ runId, resourceId }) => {
        const image = materialImages.get(runId)?.get(resourceId)
        if (!image) throw new Error('材料图片不属于当前任务或已失效')
        return image
      },
    },
    projectFiles: createProjectFileServices(host),
    deliveries,
    observations: {
      stopRun: runId => observations.stopRun(runId),
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
      availability: () => ({ ready: delegationWriteVerified,
        reason: delegationWriteVerified ? 'Codex Luna Fast 委派连接已显式验证可写'
          : '当前 Codex 委派写入被执行器策略阻断；本次未启动收费模型请求' }),
      startManaged: input => delegation.startManaged(input),
      readArtifact: (runId, jobId, name) => delegation.readArtifact(runId, jobId, name),
      cancel: (runId, jobId) => delegation.cancel(runId, jobId),
      cancelRun: runId => delegation.cancelRun(runId),
    },
    web: { search: input => web.search(input), open: async input => {
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
      if (grant.disclosedSettings && (await (await executionSettingsStore()).read()).profile.revision !== grant.disclosedSettings.profileRevision)
        throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
      await roles.beginRun(grant.runId, grant.disclosedSettings)
      frozenSkillRoots.set(grant.runId, workbenchSkillRootsForGrant(grant))
      const controller = new AbortController()
      deliverySignals.set(grant.runId, controller)
      runGrants.set(grant.runId, structuredClone(grant))
      materialIds.set(grant.runId, new Set(grant.materialIds ?? []))
      try {
        webOptions.materials = (await attachmentsDesktopService()).attachments
        web.beginRun(grant.runId)
        openImages.beginRun(grant.runId)
        await mcp.beginRun(grant.runId, managedBrowserGrantForRun(grant))
        approvals.beginRun(grant.runId)
        media.beginRun(grant.runId, { writable: grant.actor === 'agent' && !!grant.fileAccess && grant.fileAccess.permission !== 'read-only', capabilities: [] })
      } catch (error) {
        controller.abort(); deliverySignals.delete(grant.runId)
        runGrants.delete(grant.runId); materialIds.delete(grant.runId); materialImages.delete(grant.runId)
        approvals.revokeRun(grant.runId)
        frozenSkillRoots.delete(grant.runId)
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
      runGrants.delete(runId); materialIds.delete(runId); materialImages.delete(runId); host.agentFiles.releaseRun(runId)
      await host.artifactDeliveries.stopRun(runId)
      await Promise.allSettled([web.stopRun(runId), mcp.stopRun(runId), media.stopRun(runId), ...(compute ? [compute.cancelRun(runId)] : [])])
    },
    images: { selection: (runId, _documentId, operation) => roles.selection(runId, operation),
      run: (request, options) => images.start(request, options), read: id => images.read(id),
      stop: id => images.stop(id), readResource: id => images.readResource(id),
      readReadyResourceFromJob: input => images.readReadyResourceFromJob(input) },
  }
  host.tools.configureHostServices(services)
  imageService = images
  imageRoles = roles
  browserActionApprovals = approvals
  browserService = mcp
  installed = true
}
