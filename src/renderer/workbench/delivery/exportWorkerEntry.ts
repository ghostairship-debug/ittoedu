import type { ExportBuildReply, ExportBuildRequest, ExportBuildCancel, ExportBuildProgress } from '../../../shared/workbench/toolPorts'
import type { CaptureObservationInput } from '../../../shared/ipcTypes'
import type { ComponentCompilePort } from '../../export/componentPlatform/buildHtml'
import { buildDocumentExport } from './buildDocumentExport'
import { createComponentDeliveryCapture } from '../../export/componentPlatform/capture'

declare global {
  interface Window {
    documentExportWorkerAPI?: {
      onBuildRequest(handler: (request: ExportBuildRequest) => void): () => void
      onBuildCancel(handler: (cancel: ExportBuildCancel) => void): () => void
      progress(progress: ExportBuildProgress): void
      reply(reply: ExportBuildReply): void
      compileComponent(input: Parameters<ComponentCompilePort>[0]): ReturnType<ComponentCompilePort>
      capturePublished(input: { requestId: string; identity: ExportBuildRequest['identity'];
        capture: Extract<CaptureObservationInput, { kind: 'published' }> }): Promise<{ dataUrl: string; width: number; height: number }>
    }
  }
}

const api = window.documentExportWorkerAPI
if (!api) throw new Error('导出 worker 服务尚未连接')
const active = new Map<string, { identity: ExportBuildRequest['identity']; controller: AbortController }>()
const sameIdentity = (left: ExportBuildRequest['identity'], right: ExportBuildRequest['identity']) =>
  left.documentId === right.documentId && left.epoch === right.epoch && left.revision === right.revision && left.projectId === right.projectId
const stopCancel = api.onBuildCancel(cancel => {
  const job = active.get(cancel.requestId)
  if (job && sameIdentity(job.identity, cancel.identity)) job.controller.abort(new Error('导出已取消'))
})
const stop = api.onBuildRequest(request => {
  if (active.has(request.requestId)) return // The transport must not start a duplicate producer.
  const job = { identity: structuredClone(request.identity), controller: new AbortController() }
  active.set(request.requestId, job)
  const signal = job.controller.signal
  const compile: ComponentCompilePort = async (input, compilationSignal, progress) => {
    const currentSignal = compilationSignal ?? signal
    currentSignal.throwIfAborted()
    const result = await api.compileComponent(input)
    currentSignal.throwIfAborted()
    progress?.()
    return result
  }
  // Standalone headless sessions have no GUI drafts; Main still drains the formal Session.
  void buildDocumentExport(request, signal, compile, async () => {}, progress => api.progress(progress), {
    createCapture: payload => createComponentDeliveryCapture(payload, input => {
      signal.throwIfAborted()
      if (!('published' in input)) throw new Error('导出仅捕获当前冻结的 Published 内容')
      return api.capturePublished({ requestId: request.requestId, identity: job.identity, capture: input })
    }),
  }).then(reply => { if (active.get(request.requestId) === job) api.reply(reply) })
    .finally(() => { if (active.get(request.requestId) === job) active.delete(request.requestId) })
})
window.addEventListener('unload', () => {
  stop(); stopCancel()
  for (const job of active.values()) job.controller.abort(new Error('导出宿主已关闭'))
  active.clear()
}, { once: true })
