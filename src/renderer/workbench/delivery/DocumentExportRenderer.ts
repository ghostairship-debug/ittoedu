import type { ExportBuildReply, ExportBuildRequest } from '../../../shared/workbench/toolPorts'
import { courseDeliverySnapshot } from '../../app/courseDeliverySnapshot'
import { prepareBundledFontEmbedding } from '../../export/bundledFontEmbedding'
import { buildPublishedCourseStandaloneHtml, buildPublishedCourseWebPackageAsync } from '../../export/course/buildCoursePackages'
import { collectCoursePackageExportPreflight, assertCoursePackagePreflightCanExport } from '../../export/course/coursePackagePreflight'
import { loadPlayerBundle } from '../../export/loadPlayerBundle'

/** Renderer-side producer. It only consumes Main's frozen snapshot and returns bytes. */
export async function buildDocumentExport(request: ExportBuildRequest, signal?: AbortSignal): Promise<ExportBuildReply> {
  const base = { requestId: request.requestId, identity: request.identity }
  try {
    signal?.throwIfAborted()
    const snapshot = courseDeliverySnapshot(request.snapshot)
    if (!snapshot || snapshot.documentId !== request.identity.documentId || snapshot.epoch !== request.identity.epoch
      || snapshot.revision !== request.identity.revision || snapshot.project.id !== request.identity.projectId)
      throw new Error('导出请求中的 Course V9 快照身份不一致')
    await prepareBundledFontEmbedding()
    signal?.throwIfAborted()
    const playerBundle = loadPlayerBundle()
    const delivery = request.format === 'web-package' ? 'web-package' : 'standalone-html'
    const mode = request.format === 'html-online' ? 'online-lightweight' : 'offline-portable'
    const sources = { project: snapshot.project, assetFiles: snapshot.assetFiles, components: snapshot.components }
    const preflight = collectCoursePackageExportPreflight(snapshot.project, delivery,
      { assetFiles: snapshot.assetFiles, components: snapshot.components }, playerBundle, new Date(),
      delivery === 'standalone-html' ? { singleHtmlMode: mode } : {})
    if (request.format === 'html-offline') {
      const remote = preflight.items.find(item => item.code === 'offline-managed-html-remote-media')
      if (remote) throw new Error(`${remote.message} 请先将远程媒体转为工程内素材，再生成离线文件。`)
    }
    assertCoursePackagePreflightCanExport(preflight)
    const warnings = preflight.items.filter(item => item.severity === 'warning').map(item => item.message)
    const file = request.format === 'web-package'
      ? { relativePath: 'course.zip', mimeType: 'application/zip',
          bytes: await buildPublishedCourseWebPackageAsync(sources, playerBundle, signal) }
      : { relativePath: 'index.html', mimeType: 'text/html',
          bytes: new TextEncoder().encode(buildPublishedCourseStandaloneHtml(sources,
            { playerBundle, singleHtmlMode: mode })) }
    signal?.throwIfAborted()
    return { ...base, status: 'generated', files: [file], warnings }
  } catch (error) {
    return { ...base, status: signal?.aborted ? 'cancelled' : 'failed', warnings: [],
      reason: error instanceof Error ? error.message : String(error) }
  }
}
