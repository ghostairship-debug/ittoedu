import type { ExportBuildReply, ExportBuildRequest, ExportBuildProgress } from '../../../shared/workbench/toolPorts'
import { courseDeliverySnapshot } from '../../app/courseDeliverySnapshot'
import { buildComponentHtml, buildComponentWebPackage, type ComponentCompilePort } from '../../export/componentPlatform/buildHtml'

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
  onProgress?: (progress: ExportBuildProgress) => void): Promise<ExportBuildReply> {
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
    const snapshot = courseDeliverySnapshot(request.snapshot)
    if (!snapshot || snapshot.documentId !== request.identity.documentId || snapshot.epoch !== request.identity.epoch
      || snapshot.revision !== request.identity.revision || snapshot.project.id !== request.identity.projectId)
      throw new Error('导出请求中的 V10 快照身份不一致')
    const compilation: ComponentCompilePort = async input => {
      signal?.throwIfAborted()
      progress('compiling')
      const result = await cancellable(() => compile(input), signal)
      signal?.throwIfAborted()
      progress('building')
      return result
    }
    progress('building')
    const built = await cancellable(() => request.format === 'web-package'
      ? buildComponentWebPackage(request.snapshot, compilation, signal)
      : buildComponentHtml(request.snapshot, compilation, request.format === 'html-online' ? 'online-lightweight' : 'offline-portable', signal), signal)
    signal?.throwIfAborted()
    const file = 'html' in built
      ? { relativePath: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode(built.html) }
      : { relativePath: 'course.zip', mimeType: 'application/zip', bytes: built.bytes }
    progress('complete')
    return { ...base, status: 'generated', files: [file], warnings: built.warnings }
  } catch (error) {
    return { ...base, status: signal?.aborted ? 'cancelled' : 'failed', warnings: [], reason: error instanceof Error ? error.message : String(error) }
  } finally { if (heartbeat !== undefined) clearInterval(heartbeat) }
}
