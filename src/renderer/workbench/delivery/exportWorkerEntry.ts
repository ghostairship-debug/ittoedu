import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import type { ComponentCompilePort } from '../../export/componentPlatform/buildHtml'
import { buildDocumentExport } from './buildDocumentExport'

declare global {
  interface Window {
    documentExportWorkerAPI?: {
      onBuildRequest(handler: (request: ExportBuildRequest) => void): () => void
      reply(reply: ExportBuildReply): void
      compileComponent: ComponentCompilePort
    }
  }
}

const api = window.documentExportWorkerAPI
if (!api) throw new Error('导出 worker 服务尚未连接')
const stop = api.onBuildRequest(request => {
  // Standalone headless sessions have no GUI drafts; Main still drains the formal Session.
  void buildDocumentExport(request, undefined, input => api.compileComponent(input), async () => {})
    .then(reply => api.reply(reply))
})
window.addEventListener('unload', stop, { once: true })
