import type { ExportBuildReply, ExportBuildRequest, ExportBuildProgress } from '../../../shared/workbench/toolPorts'
import { courseDeliverySnapshot } from '../../app/courseDeliverySnapshot'
import type { ComponentCompilePort } from '../../export/componentPlatform/buildHtml'
import { buildComponentDelivery, type ComponentOutputCapture } from '../../export/componentPlatform/delivery'
import type { PublishedCourseV3 } from '../../../shared/contracts/component-platform/published'

export type PrepareDocumentExportDrafts = (documentId: string, epoch: string) => Promise<void>

/** Stop waiting immediately; an already-running compiler cannot publish a late result. */
function cancellable<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work()
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('导出已取消')) }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => { signal.throwIfAborted(); return work() }).then(value => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) abort(); else resolve(value)
    }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) abort()
  })
}

/** Build only from Main's frozen snapshot and the supplied ports; no editor state is loaded. */
export async function buildDocumentExport(request: ExportBuildRequest, signal: AbortSignal | undefined,
  compile: ComponentCompilePort, prepareDrafts: PrepareDocumentExportDrafts,
  onProgress?: (progress: ExportBuildProgress) => void,
  options: { createCapture?: (payload: PublishedCourseV3) => Promise<ComponentOutputCapture> } = {}): Promise<ExportBuildReply> {
  const base = { requestId: request.requestId, identity: request.identity }
  let sequence = 0, stage: ExportBuildProgress['stage'] = 'preparing'
  const progress = (next = stage) => {
    if (signal?.aborted) return
    stage = next
    try { onProgress?.({ ...base, sequence: ++sequence, stage }) }
    catch { /* A lost transport message is handled by Main's no-response detector. */ }
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined
  try {
    signal?.throwIfAborted()
    progress()
    // Event-loop liveness while awaiting the existing compiler/build owner.
    // This does not impose a total-duration or content budget.
    if (onProgress) heartbeat = setInterval(progress, 15_000)
    if (request.phase === 'drain') {
      await cancellable(() => prepareDrafts(request.identity.documentId, request.identity.epoch), signal)
      signal?.throwIfAborted()
      progress('complete')
      return { ...base, status: 'drained', warnings: [] }
    }
    const snapshot = courseDeliverySnapshot(request.snapshot, request.options)
    if (!snapshot || snapshot.documentId !== request.identity.documentId || snapshot.epoch !== request.identity.epoch
      || snapshot.revision !== request.identity.revision || snapshot.project.id !== request.identity.projectId)
      throw new Error('导出请求中的 V10 快照身份不一致')
    const compilation: ComponentCompilePort = async (input, compilationSignal, compilationProgress) => {
      signal?.throwIfAborted()
      progress('compiling')
      const result = await cancellable(() => compile(input, compilationSignal ?? signal, () => { compilationProgress?.(); progress('compiling') }), signal)
      signal?.throwIfAborted()
      progress('building')
      return result
    }
    progress('building')
    const format = request.format === 'html-online' || request.format === 'html-offline' ? 'single-html' : request.format
    const built = await cancellable(() => buildComponentDelivery(snapshot, format, {
      compile: compilation, signal, createCapture: options.createCapture,
      singleHtmlMode: request.format === 'html-online' ? 'online-lightweight' : 'offline-portable',
      onProgress: () => progress('building'),
    }), signal)
    signal?.throwIfAborted()
    const warnings = built.report.items.map(item => item.message)
    const mimeTypes = { html: 'text/html', zip: 'application/zip', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' }
    const files = built.artifacts.filter(artifact => artifact.extension !== 'pdf').map(artifact => ({
      relativePath: artifact.extension === 'html' ? 'index.html' : artifact.extension === 'zip' ? 'course.zip'
        : artifact.extension === 'pptx' ? 'course.pptx' : artifact.suggestedName,
      mimeType: mimeTypes[artifact.extension], bytes: artifact.bytes ?? new TextEncoder().encode(artifact.html!),
    }))
    const printHtml = built.artifacts.find(artifact => artifact.extension === 'pdf')?.html
    progress('complete')
    return { ...base, status: 'generated', files, ...(printHtml ? { printHtml } : {}), warnings }
  } catch (error) {
    return { ...base, status: signal?.aborted ? 'cancelled' : 'failed', warnings: [], reason: error instanceof Error ? error.message : String(error) }
  } finally { if (heartbeat !== undefined) clearInterval(heartbeat) }
}
