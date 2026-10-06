import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import type { ComponentCompilePort } from '../../export/componentPlatform/buildHtml'
import { useEditorStore } from '../../store/editorStore'
import { buildDocumentExport as buildCapturedDocumentExport, type PrepareDocumentExportDrafts } from './buildDocumentExport'

export type { PrepareDocumentExportDrafts } from './buildDocumentExport'
async function prepareRootDrafts(documentId: string, epoch: string): Promise<void> {
  const root = useEditorStore.getState()
  const current = root.courseKernel.readView().documents.find(snapshot => snapshot.documentId === documentId)
  if (!current || current.epoch !== epoch || current.model.kind !== 'course-v10') throw new Error('准备导出的目标文档已关闭或重开')
  const drained = await root.drainCourseDocument(documentId)
  if (drained.documentId !== documentId || drained.epoch !== epoch) throw new Error('准备导出时目标文档已变化')
}

/** GUI adapter retains the local editor draft drain before Main captures its formal snapshot. */
export async function buildDocumentExport(request: ExportBuildRequest, signal?: AbortSignal,
  compile: ComponentCompilePort = input => {
    if (!window.desktopAPI) throw new Error('源码编译服务尚未连接')
    return window.desktopAPI.compileComponent(input)
  }, prepareDrafts: PrepareDocumentExportDrafts = prepareRootDrafts): Promise<ExportBuildReply> {
  return buildCapturedDocumentExport(request, signal, compile, prepareDrafts)
}
