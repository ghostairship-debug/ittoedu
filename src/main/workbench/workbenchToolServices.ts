import path from 'node:path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { HostToolServices } from '../../core/tools/HostToolServices'
import type { ExportBuildReply } from '../../shared/workbench/toolPorts'
import { IPC_CHANNELS } from '../../shared/ipcTypes'
import { documentHost } from './documentHost'
import { ScopedSkillService, type SkillRoot } from './skills/ScopedSkillService'
import { EnabledSkillRootStore } from './skills/EnabledSkillRootStore'
import { BundledSkillService } from './skills/BundledSkillService'
import bundledSkills from '../../shared/generated/bundledSkills.json'
import { ControlledBuildService } from './build/ControlledBuildService'
import { htmlImportNetworkGrants } from './htmlImport/htmlImportNetworkGrants'
import { HtmlImportToolService } from './htmlImport/HtmlImportToolService'
import { HtmlImportOperationStore } from './htmlImport/HtmlImportOperationStore'
import { ViewObservationService } from './observation/ViewObservationService'
import { ViewObservationDesktopService } from './observation/ViewObservationDesktopService'
import { ObservationImageStore } from './observation/ObservationImageStore'
import { DocumentDeliveryService } from './delivery/DocumentDeliveryService'
import { ExecutionRunStore } from './execution/ExecutionRunStore'
import { DocumentDeliveryOperationStore } from './delivery/DocumentDeliveryOperationStore'
import { DocumentExportPort } from './delivery/DocumentExportPort'
import { resolveExportDestination, resolveSaveDestination, workbenchExportWriter } from './workbenchDeliveryAdapters'
import { createElectronBuildAdmission } from './build/ElectronBuildAdmission'
import { frozenImageRoles } from './images/frozenImageRoles'
import { ImageGenerationService } from './images/ImageGenerationService'
import { HostJobService } from './jobs/HostJobService'
import { ComputeJobService } from './compute/ComputeJobService'
import { PINNED_PYTHON_IMAGE_ID, PodmanComputeBackend } from './compute/PodmanComputeBackend'
import { WebResearchService } from './network/WebResearchService'
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
import { AssetLibraryService, readComponentLibrary } from './assetSources/componentLibrarySearch'
import { managedComponentLibrary } from '../componentCatalogSources'

let installed = false
let imageService: ImageGenerationService | undefined
let imageRoles: ReturnType<typeof frozenImageRoles> | undefined
let skillRootStore: EnabledSkillRootStore | undefined
let browserActionApprovals: BrowserActionApprovals | undefined
let browserService: ManagedBrowserMcpService | undefined
let exportPort: DocumentExportPort | undefined
let exportOwnerId: number | undefined
export function acceptWorkbenchExportBuildReply(reply: ExportBuildReply, senderId: number): boolean {
  return exportPort?.accept(reply, senderId) ?? false
}
export function disposeWorkbenchExportPort(): void {
  exportPort?.dispose(); exportPort = undefined; exportOwnerId = undefined
}
export function workbenchImageService(): ImageGenerationService {
  if (!imageService) throw new Error('图片服务尚未安装')
  return imageService
}
export function workbenchImageSelection(runId: string, operation: 'generate' | 'edit') {
  if (!imageRoles) throw new Error('图片角色尚未安装')
  return imageRoles.selection(runId, operation)
}
/** User/workspace Skills remain disabled until the user explicitly enables each real root. */
export function workbenchEnabledSkillRootStore(): EnabledSkillRootStore {
  if (!skillRootStore) throw new Error('Skill 根启用服务尚未安装')
  return skillRootStore
}
/** Browser scope is frozen with the document run; outside-workspace uploads have no implicit grant. */
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
export function installWorkbenchToolServices(context: { getMainWindow(): BrowserWindow | null; getRendererEntryUrl(): string | null }): void {
  if (installed) return
  const host = documentHost(), directory = path.join(app.getPath('userData'), 'workbench-v2')
  const roles = frozenImageRoles(async role => (await executionSettingsStore()).snapshot(role))
  const oauthImages = new ChatGPTImageProvider({ credentialResolver: resolveOAuthCredential })
  const apiImages = new OpenAIImagesApiProvider({ credentialResolver: connection => executionSettingsStore().then(store => store.resolveCredential(connection)) })
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'),
    provider: { generate: (request, references, options) =>
      (imageRoute(request) === 'chatgpt-oauth' ? oauthImages : apiImages).generate(request, references, options) },
    resolveReference: (runId, documentId, resource) => host.tools.readImageResource(runId, documentId, resource),
  })
  const builds = new ControlledBuildService({ directory: path.join(directory, 'builds'), admission: {
    run(payload, signal) {
      const window = context.getMainWindow(), entry = context.getRendererEntryUrl()
      if (!window || window.isDestroyed() || !entry) throw new Error('当前没有可用的准入窗口，请恢复应用窗口后重试。')
      return createElectronBuildAdmission(window.webContents, entry).run(payload, signal)
    },
  } })
  const configuredImage = process.env.GUOLING_COMPUTE_IMAGE
  const computeImage = configuredImage && /^sha256:[a-f0-9]{64}$/.test(configuredImage) ? configuredImage : PINNED_PYTHON_IMAGE_ID
  const compute = new ComputeJobService({ directory: path.join(directory, 'compute'),
    backend: new PodmanComputeBackend({ distro: process.env.GUOLING_COMPUTE_WSL_DISTRO || 'Ubuntu', image: computeImage }) })
  const delegation = new DelegationJobService({ directory: path.join(directory, 'delegation', 'jobs'),
    copyRootBase: path.join(directory, 'delegation', 'copies') })
  // The installed Codex CLI rejected both real command and patch writes. An operator must
  // verify an actual authorized copy write before enabling product-paid delegation.
  const delegationWriteVerified = process.env.GUOLING_CODEX_DELEGATION_WRITE_VERIFIED === '1'
  const jobs = new HostJobService({ images, builds, compute, delegation })
  const web = new WebResearchService()
  const openImages = createWorkbenchOpenImageService(app.getVersion())
  const assetLibrary = new AssetLibraryService({ load: () => readComponentLibrary(app.getAppPath(), app.getPath('userData')),
    managedLibrary: managedComponentLibrary(app.getPath('userData')) })
  // Agent and human share the task's main-owned embedded page.
  const approvals = new BrowserActionApprovals()
  const mcp = new ManagedBrowserMcpService({ scratchRoot: path.join(directory, 'browser'),
    embeddedBackend: createElectronEmbeddedBrowserFactory(context.getMainWindow),
    approveExternalAction: async input => approvals.consume({ runId: input.runId, operationId: input.operationId,
      tool: input.tool, arguments: input.arguments, snapshotId: input.snapshotId }) })
  // Speech/video/music have no verified provider adapter in the current connection set.
  const media = new MediaCapabilityService()
  const htmlImports = new HtmlImportToolService({
    documents: { read: documentId => host.registry.get(documentId).drain(), get: documentId => host.registry.get(documentId) },
    gateway: host.tools,
    cancelJob: async (runId, jobId) => { await builds.execute(runId, { type: 'cancel', jobId }) },
    networkGrants: htmlImportNetworkGrants,
    operationStore: new HtmlImportOperationStore(path.join(directory, 'html-import-operations')),
  })
  const observationImages = new ObservationImageStore()
  const observations = new ViewObservationService({
    snapshot: documentId => host.registry.get(documentId).drain(),
    captureIsolated: input => {
      const entry = context.getRendererEntryUrl()
      if (!entry) throw new Error('当前没有可用的画面观察入口')
      return new ViewObservationDesktopService({ rendererEntryUrl: entry }).captureIsolated(input)
    },
    images: observationImages,
  })
  const deliverySignals = new Map<string, AbortController>()
  const enabledSkillRoots = new EnabledSkillRootStore(path.join(directory, 'enabled-skill-roots.json'))
  const frozenSkillRoots = new Map<string, readonly SkillRoot[]>()
  const skillRootErrors = new Map<string, string>()
  const skills = new ScopedSkillService(new BundledSkillService(bundledSkills), async runId => {
    if (!deliverySignals.has(runId) || deliverySignals.get(runId)!.signal.aborted) throw new Error('Skill 读取任务已停止')
    if (skillRootErrors.has(runId)) throw new Error(skillRootErrors.get(runId))
    // Fresh state can revoke a root, but cannot add one absent from the task start.
    const enabled = await enabledSkillRoots.enabledRoots(frozenSkillRoots.get(runId) ?? [])
    if (deliverySignals.get(runId)?.signal.aborted) throw new Error('Skill 读取任务已停止')
    return enabled.roots
  })
  const currentExportPort = (): DocumentExportPort => {
    const window = context.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('当前没有可用的导出窗口')
    if (exportOwnerId !== window.webContents.id || !exportPort) {
      disposeWorkbenchExportPort()
      const ownerId = window.webContents.id
      exportOwnerId = ownerId
      const ownedPort = new DocumentExportPort(ownerId, request => window.webContents.send(IPC_CHANNELS.documentExportBuildRequest, request))
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
    build: { build: (request, signal) => currentExportPort().build(request, signal) },
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
    htmlImports,
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
    web,
    mcp,
    media,
    openImages: { search: input => openImages.search(input), preview: input => openImages.preview(input),
      readPreview: (runId, resourceId) => openImages.readPreview(runId, resourceId), fetch: input => openImages.fetch(input) },
    assetLibrary: { search: input => assetLibrary.search(input), read: input => assetLibrary.read(input),
      save: ({ runId: _runId, ...input }) => assetLibrary.save(input) },
    beginRun: async grant => {
      if (grant.disclosedSettings && (await (await executionSettingsStore()).read()).profile.revision !== grant.disclosedSettings.profileRevision)
        throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
      await roles.beginRun(grant.runId, grant.disclosedSettings)
      const candidates: SkillRoot[] = [{ source: 'user', directory: path.join(directory, 'skills'), authorizedRoot: directory },
        ...(grant.fileAccess?.workspaceRoot ? [{ source: 'workspace' as const, directory: path.join(grant.fileAccess.workspaceRoot, '.agents', 'skills'),
          authorizedRoot: grant.fileAccess.workspaceRoot }] : [])]
      try { frozenSkillRoots.set(grant.runId, (await enabledSkillRoots.enabledRoots(candidates)).roots) }
      catch (error) { frozenSkillRoots.set(grant.runId, []); skillRootErrors.set(grant.runId,
        error instanceof Error ? `Skill 启用配置无法读取：${error.message}` : 'Skill 启用配置无法读取') }
      const controller = new AbortController()
      deliverySignals.set(grant.runId, controller)
      try {
        web.beginRun(grant.runId)
        openImages.beginRun(grant.runId)
        await mcp.beginRun(grant.runId, managedBrowserGrantForRun(grant))
        approvals.beginRun(grant.runId)
        media.beginRun(grant.runId, { writable: grant.actor === 'agent' && !!grant.fileAccess && grant.fileAccess.permission !== 'read-only', capabilities: [] })
      } catch (error) {
        controller.abort(); deliverySignals.delete(grant.runId)
        approvals.revokeRun(grant.runId)
        frozenSkillRoots.delete(grant.runId); skillRootErrors.delete(grant.runId)
        await Promise.allSettled([web.stopRun(grant.runId), mcp.endRun(grant.runId), media.stopRun(grant.runId)])
        web.endRun(grant.runId); media.endRun(grant.runId); openImages.endRun(grant.runId)
        throw error
      }
    },
    stopRun: async runId => {
      approvals.revokeRun(runId)
      deliverySignals.get(runId)?.abort(); deliverySignals.delete(runId); observationImages.clearRun(runId); skills.release(runId)
      openImages.stopRun(runId)
      frozenSkillRoots.delete(runId); skillRootErrors.delete(runId)
      await Promise.allSettled([web.stopRun(runId), mcp.stopRun(runId), media.stopRun(runId), ...(compute ? [compute.cancelRun(runId)] : [])])
    },
    images: { selection: (runId, _documentId, operation) => roles.selection(runId, operation),
      run: (request, options) => images.start(request, options), read: id => images.read(id),
      stop: id => images.stop(id), readResource: id => images.readResource(id),
      readReadyResourceFromJob: input => images.readReadyResourceFromJob(input) },
    builds: { create: (input, ticket) => builds.create(input, ticket), lookupCreate: (runId, ticket) => builds.lookupCreate(runId, ticket), execute: (runId, call) => builds.execute(runId, call),
      artifact: (runId, jobId, artifactId) => builds.artifact(runId, jobId, artifactId), cancelRun: runId => builds.cancelRun(runId),
      policy: (runId, documentId) => htmlImportNetworkGrants.policy(runId, documentId, () => host.registry.get(documentId).read()) },
  }
  host.tools.configureHostServices(services)
  imageService = images
  imageRoles = roles
  skillRootStore = enabledSkillRoots
  browserActionApprovals = approvals
  browserService = mcp
  installed = true
}
