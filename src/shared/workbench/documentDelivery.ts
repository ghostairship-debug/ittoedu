import type { DocumentSnapshot } from './document'
import type { ExportBuildReply, ExportBuildRequest, ExportFormat } from './toolPorts'

export function exportExtension(format: ExportFormat): '.html' | '.zip' | '.pptx' | '.pdf' | '.docx' {
  return format === 'web-package' ? '.zip' : format === 'pptx' ? '.pptx' : format === 'pdf' ? '.pdf' : format === 'docx' ? '.docx' : '.html'
}

export function exportSuggestedName(snapshot: DocumentSnapshot, format: ExportFormat): string {
  const title = snapshot.model.kind === 'course-v10' ? snapshot.model.project.title : '课程'
  const stem = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || '课程'
  return `${stem}${format === 'web-package' ? '-网页包' : ''}${exportExtension(format)}`
}

export function validateExportBuildIdentity(request: ExportBuildRequest, reply: ExportBuildReply): void {
  if (reply.requestId !== request.requestId || reply.identity.documentId !== request.identity.documentId
    || reply.identity.epoch !== request.identity.epoch || reply.identity.revision !== request.identity.revision
    || reply.identity.projectId !== request.identity.projectId) throw new Error('导出回复身份与请求不一致')
  if (reply.status !== 'generated') throw new Error(reply.reason || (reply.status === 'cancelled' ? '导出已取消' : '导出生成失败'))
}

export function validateExportBuildFiles(request: ExportBuildRequest, reply: ExportBuildReply): NonNullable<ExportBuildReply['files']> {
  validateExportBuildIdentity(request, reply)
  if (!reply.files?.length || request.format !== 'docx' && reply.files.length !== 1) throw new Error('导出文件数量与格式不一致')
  const expected = request.format === 'web-package' ? 'course.zip' : request.format === 'pptx' ? 'course.pptx' : request.format === 'pdf' ? 'course.pdf' : 'index.html'
  const mimeType = request.format === 'web-package' ? 'application/zip' : request.format === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : request.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : request.format === 'pdf' ? 'application/pdf' : 'text/html'
  const names = new Set<string>()
  for (const file of reply.files) {
    if ((request.format === 'docx' ? !file.relativePath.toLowerCase().endsWith('.docx') : file.relativePath !== expected)
      || /[\\/\u0000]/.test(file.relativePath) || names.has(file.relativePath.toLowerCase())) throw new Error('导出文件名称无效或重复')
    names.add(file.relativePath.toLowerCase())
    if (file.mimeType !== mimeType) throw new Error('导出文件类型与格式不一致')
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength === 0) throw new Error('导出文件为空或字节类型无效')
    if (['web-package', 'pptx', 'docx'].includes(request.format) && (file.bytes[0] !== 0x50 || file.bytes[1] !== 0x4b)) throw new Error('导出文件不是有效 ZIP 数据')
    if (request.format === 'pdf' && new TextDecoder().decode(file.bytes.subarray(0, 5)) !== '%PDF-') throw new Error('PDF 生产器未返回 PDF 数据')
  }
  return reply.files
}

/** Single-file consumers keep their byte result; multi-Flow callers use the complete file list. */
export function validateExportBuildReply(request: ExportBuildRequest, reply: ExportBuildReply): Uint8Array {
  const files = validateExportBuildFiles(request, reply)
  if (files.length !== 1) throw new Error('此导出消费者需要单文件，请消费完整文件列表')
  return files[0]!.bytes
}

export function validateExportDestination(filename: string, format: ExportFormat): void {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/]|\/)/.test(filename)
    || !filename.toLowerCase().endsWith(exportExtension(format)))
    throw new Error(`导出目标必须是绝对路径，扩展名为 ${exportExtension(format)}`)
  if (filename.includes('\u0000')) throw new Error('导出目标路径无效')
}
