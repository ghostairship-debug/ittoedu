import path from 'node:path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { HostToolServices } from '../../core/tools/HostToolServices'
import type { ExportBuildReply } from '../../shared/workbench/toolPorts'
import { IPC_CHANNELS } from '../../shared/ipcTypes'
import { documentHost } from './documentHost'
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
import { DocumentDeliveryOperationStore } from './delivery/DocumentDeliveryOperationStore'
import { DocumentExportPort } from './delivery/DocumentExportPort'
import { resolveExportDestination, resolveSaveDestination, workbenchExportWriter } from './workbenchDeliveryAdapters'
import { createElectronBuildAdmission } from './build/ElectronBuildAdmission'
import { frozenImageRoles } from './images/frozenImageRoles'
import { ImageGenerationService } from './images/ImageGenerationService'
import { ChatGPTImageProvider } from './images/ChatGPTImageProvider'
import { OpenAIImagesApiProvider } from './images/OpenAIImagesApiProvider'
import { imageRoute } from './images/imageRoute'
import { executionSettingsStore, resolveOAuthCredential } from './providers/executionSettingsService'

let installed = false
let imageService: ImageGenerationService | undefined
let imageRoles: ReturnType<typeof frozenImageRoles> | undefined
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
      saveWithFact: (documentId, filename) => host.saveWithFact(documentId, filename),
      withFileLease: (documentId, work) => host.registry.get(documentId).withFileLease(lease => work(() => lease.read())) },
    operations: new DocumentDeliveryOperationStore(path.join(directory, 'document-delivery-operations')),
    authorize: async ({ runId }) => {
      if (host.tools.runFileAccess(runId)?.permission === 'read-only') throw new Error('只读任务不能保存或导出文件')
    },
    resolveSaveDestination: ({ runId, snapshot, requested }) => resolveSaveDestination(runId, snapshot, requested, id => host.tools.runFileAccess(id)),
    resolveExportDestination: ({ runId, snapshot, requested, format, suggestedName }) =>
      resolveExportDestination(runId, snapshot, requested, suggestedName, format, id => host.tools.runFileAccess(id)),
    build: { build: (request, signal) => currentExportPort().build(request, signal) },
    writer: workbenchExportWriter,
    signalForRun: runId => deliverySignals.get(runId)?.signal,
  })
  const services: HostToolServices = {
    htmlImports,
    deliveries,
    observations: {
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
    skills: new BundledSkillService(bundledSkills),
    beginRun: async grant => {
      if (grant.disclosedSettings && (await (await executionSettingsStore()).read()).profile.revision !== grant.disclosedSettings.profileRevision)
        throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
      await roles.beginRun(grant.runId, grant.disclosedSettings)
      deliverySignals.set(grant.runId, new AbortController())
    },
    stopRun: runId => { deliverySignals.get(runId)?.abort(); deliverySignals.delete(runId); observationImages.clearRun(runId) },
    images: { selection: (runId, _documentId, operation) => roles.selection(runId, operation),
      run: (request, options) => images.run(request, options), read: id => images.read(id),
      stop: id => images.stop(id), readResource: id => images.readResource(id),
      readReadyResourceFromJob: input => images.readReadyResourceFromJob(input) },
    builds: { create: (input, ticket) => builds.create(input, ticket), lookupCreate: (runId, ticket) => builds.lookupCreate(runId, ticket), execute: (runId, call) => builds.execute(runId, call),
      artifact: (runId, jobId, artifactId) => builds.artifact(runId, jobId, artifactId), cancelRun: runId => builds.cancelRun(runId),
      policy: (runId, documentId) => htmlImportNetworkGrants.policy(runId, documentId, () => host.registry.get(documentId).read()) },
  }
  host.tools.configureHostServices(services)
  imageService = images
  imageRoles = roles
  installed = true
}
