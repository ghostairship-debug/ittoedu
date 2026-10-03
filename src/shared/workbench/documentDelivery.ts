import type { DocumentSnapshot } from './document'
import type { ExportBuildReply, ExportBuildRequest, ExportFormat } from './toolPorts'

export function exportExtension(format: ExportFormat): '.html' | '.zip' {
  return format === 'web-package' ? '.zip' : '.html'
}

export function exportSuggestedName(snapshot: DocumentSnapshot, format: ExportFormat): string {
  const title = snapshot.model.kind === 'course-v9' ? snapshot.model.project.title : '课程'
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || '课程'
  return `${stem}${format === 'web-package' ? '-网页包' : ''}${exportExtension(format)}`
}

export function validateExportBuildReply(request: ExportBuildRequest, reply: ExportBuildReply): Uint8Array {
  if (reply.requestId !== request.requestId || reply.identity.documentId !== request.identity.documentId
    || reply.identity.epoch !== request.identity.epoch || reply.identity.revision !== request.identity.revision
    || reply.identity.projectId !== request.identity.projectId) throw new Error('导出回复身份与请求不一致')
  if (reply.status !== 'generated') throw new Error(reply.reason || (reply.status === 'cancelled' ? '导出已取消' : '导出生成失败'))
  if (reply.files?.length !== 1) throw new Error('导出结果必须恰好包含一个文件')
  const file = reply.files[0]
  const expected = request.format === 'web-package' ? 'course.zip' : 'index.html'
  if (file.relativePath !== expected || file.relativePath.includes('\\') || file.relativePath.includes('\u0000')
    || file.relativePath.split('/').some(part => part === '.' || part === '..')) throw new Error('导出文件相对路径无效')
  const mimeType = request.format === 'web-package' ? 'application/zip' : 'text/html'
  if (file.mimeType !== mimeType) throw new Error('导出文件类型与格式不一致')
  if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0)
    throw new Error('导出文件为空或字节类型无效')
  if (request.format === 'web-package' && (file.bytes[0] !== 0x50 || file.bytes[1] !== 0x4b))
    throw new Error('网页包不是有效 ZIP 数据')
  return file.bytes
}

export function validateExportDestination(filename: string, format: ExportFormat): void {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]|\/)/.test(filename)
    || !filename.toLowerCase().endsWith(exportExtension(format)))
    throw new Error(`导出目标必须是绝对路径，扩展名为 ${exportExtension(format)}`)
  if (filename.includes('\u0000')) throw new Error('导出目标路径无效')
}
