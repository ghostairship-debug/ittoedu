import path from 'node:path'
import { app } from 'electron'
import type { BrowserWindow } from 'electron'
import type { HostToolServices } from '../../core/tools/HostToolServices'
import { documentHost } from './documentHost'
import { ControlledBuildService } from './build/ControlledBuildService'
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
      if (!window || window.isDestroyed() || !entry) throw new Error('当前没有可用的课件准入窗口，请恢复应用窗口后重试。')
      return createElectronBuildAdmission(window.webContents, entry).run(payload, signal)
    },
  } })
  const services: HostToolServices = {
    beginRun: async grant => {
      if (grant.disclosedSettings && (await (await executionSettingsStore()).read()).profile.revision !== grant.disclosedSettings.profileRevision)
        throw new Error('模型或服务配置在发送时已变化；本次未请求模型，请核对后重新发送。')
      await roles.beginRun(grant.runId, grant.disclosedSettings)
    },
    images: { selection: (runId, _documentId, operation) => roles.selection(runId, operation),
      run: (request, options) => images.run(request, options), read: id => images.read(id),
      stop: id => images.stop(id), readResource: id => images.readResource(id),
      readReadyResourceFromJob: input => images.readReadyResourceFromJob(input) },
    builds: { create: (input, ticket) => builds.create(input, ticket), lookupCreate: (runId, ticket) => builds.lookupCreate(runId, ticket), execute: (runId, call) => builds.execute(runId, call),
      artifact: (runId, jobId, artifactId) => builds.artifact(runId, jobId, artifactId), cancelRun: runId => builds.cancelRun(runId) },
  }
  host.tools.configureHostServices(services)
  imageService = images
  imageRoles = roles
  installed = true
}
