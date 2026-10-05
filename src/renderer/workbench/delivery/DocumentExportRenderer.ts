import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import { courseDeliverySnapshot } from '../../app/courseDeliverySnapshot'
import { buildComponentHtml, buildComponentWebPackage, type ComponentCompilePort } from '../../export/componentPlatform/buildHtml'
import { useEditorStore } from '../../store/editorStore'

export type PrepareDocumentExportDrafts = (documentId: string, epoch: string) => Promise<void>
async function prepareRootDrafts(documentId: string, epoch: string): Promise<void> {
  const root = useEditorStore.getState()
  const current = root.courseKernel.readView().documents.find(snapshot => snapshot.documentId === documentId)
  if (!current || current.epoch !== epoch || current.model.kind !== 'course-v10') throw new Error('准备导出的目标文档已关闭或重开')
  const drained = await root.drainCourseDocument(documentId)
  if (drained.documentId !== documentId || drained.epoch !== epoch) throw new Error('准备导出时目标文档已变化')
}

/** Main supplies a frozen formal snapshot; this consumer never rereads the active UI. */
export async function buildDocumentExport(request: ExportBuildRequest, signal?: AbortSignal,
  compile: ComponentCompilePort = input => {
    if (!window.desktopAPI) throw new Error('源码编译服务尚未连接')
    return window.desktopAPI.compileComponent(input)
  }, prepareDrafts: PrepareDocumentExportDrafts = prepareRootDrafts): Promise<ExportBuildReply> {
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
