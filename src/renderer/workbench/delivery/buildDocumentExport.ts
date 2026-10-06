import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import { courseDeliverySnapshot } from '../../app/courseDeliverySnapshot'
import { buildComponentHtml, buildComponentWebPackage, type ComponentCompilePort } from '../../export/componentPlatform/buildHtml'

export type PrepareDocumentExportDrafts = (documentId: string, epoch: string) => Promise<void>

/** Build only from Main's frozen snapshot and the supplied ports; no editor state is loaded. */
export async function buildDocumentExport(request: ExportBuildRequest, signal: AbortSignal | undefined,
  compile: ComponentCompilePort, prepareDrafts: PrepareDocumentExportDrafts): Promise<ExportBuildReply> {
  const base = { requestId: request.requestId, identity: request.identity }
  try {
    signal?.throwIfAborted()
    if (request.phase === 'drain') {
      await prepareDrafts(request.identity.documentId, request.identity.epoch)
      signal?.throwIfAborted()
      return { ...base, status: 'drained', warnings: [] }
    }
    const snapshot = courseDeliverySnapshot(request.snapshot)
    if (!snapshot || snapshot.documentId !== request.identity.documentId || snapshot.epoch !== request.identity.epoch
      || snapshot.revision !== request.identity.revision || snapshot.project.id !== request.identity.projectId)
      throw new Error('导出请求中的 V10 快照身份不一致')
    const built = request.format === 'web-package'
      ? await buildComponentWebPackage(request.snapshot, compile, signal)
      : await buildComponentHtml(request.snapshot, compile, request.format === 'html-online' ? 'online-lightweight' : 'offline-portable')
    signal?.throwIfAborted()
    const file = 'html' in built
      ? { relativePath: 'index.html', mimeType: 'text/html', bytes: new TextEncoder().encode(built.html) }
      : { relativePath: 'course.zip', mimeType: 'application/zip', bytes: built.bytes }
    return { ...base, status: 'generated', files: [file], warnings: built.warnings }
  } catch (error) {
    return { ...base, status: signal?.aborted ? 'cancelled' : 'failed', warnings: [], reason: error instanceof Error ? error.message : String(error) }
  }
}
