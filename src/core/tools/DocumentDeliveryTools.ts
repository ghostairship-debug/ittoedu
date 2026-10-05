import { z } from 'zod'
import type { DocumentDeliveryServicePort, ExportReceipt, SaveReceipt } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const fileSaveInputSchema = z.object({
  target: z.string().min(1).max(200).describe('file.open/create 返回的 data.target 文档短句柄；不是文件路径、documentId 或正文 writableTarget。'),
  destination: z.string().min(1).max(1024).optional(),
}).strict()

export const documentExportInputSchema = z.object({
  target: z.string().min(1).max(200),
  format: z.enum(['html-offline', 'html-online', 'web-package']),
  destination: z.string().min(1).max(1024).optional(),
}).strict()

export const documentDeliveryTools = [
  { name: 'file.save' as const, description: '保存已打开文档的当前正式内容。target 使用宿主返回的文档短句柄，destination 仅用于另存为。返回确切保存版本与脏状态。', inputSchema: fileSaveInputSchema,
    manual: { label: '保存文件', group: 'edit' as const, targetKinds: ['document'] as const } },
  { name: 'document.export' as const, description: '将已授权的课件文档导出为离线单 HTML、在线单 HTML 或网页包，返回生成与写盘的真实状态。Project V10 使用同一 Published V3 输出。同任务同文档的既有导出未被修改时可原位更新；其他同名文件不覆盖，不需先删除旧文件。', inputSchema: documentExportInputSchema,
    manual: { label: '导出文档', group: 'edit' as const, targetKinds: ['document'] as const } },
]

export interface DocumentDeliveryToolContext {
  runId: string
  operationId: string
  requestDigest: string
  resolveHandle(handle: string, access: 'write'): Promise<{ documentId: string; epoch: string; revision: number } | null>
}

export function documentDeliveryReceiptResult(receipt: SaveReceipt | ExportReceipt): ToolResult {
  return receipt.status === 'saved' || receipt.status === 'written' || receipt.status === 'generated'
    ? { kind: 'read', data: receipt }
    : { kind: 'error', code: receipt.status === 'rejected' ? 'delivery-rejected' : 'delivery-failed', message: receipt.reason ?? '保存或导出失败' }
}

export async function executeDocumentDeliveryTool(
  service: DocumentDeliveryServicePort, context: DocumentDeliveryToolContext,
  name: 'file.save' | 'document.export', raw: unknown,
): Promise<ToolResult> {
  const parsed = name === 'file.save' ? fileSaveInputSchema.safeParse(raw) : documentExportInputSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input',
    message: name === 'document.export' && raw && typeof raw === 'object' && 'format' in raw
      && !['html-offline', 'html-online', 'web-package'].includes(String(raw.format))
      ? 'document.export 当前仅支持 html-offline、html-online、web-package；PPTX、PDF、DOCX 请使用现有人工导出入口。'
      : '保存或导出参数无效：' + parsed.error.issues.map(issue => issue.message).join('；') }
  const existing = await service.lookup({ runId: context.runId, operationId: context.operationId, requestDigest: context.requestDigest })
  if (existing) return documentDeliveryReceiptResult(existing)
  const target = await context.resolveHandle(parsed.data.target, 'write')
  if (!target) return { kind: 'error', code: 'target-not-found', message: '目标文档不存在或没有写入授权' }
  const common = { runId: context.runId, operationId: context.operationId, requestDigest: context.requestDigest,
    documentId: target.documentId, epoch: target.epoch, destination: parsed.data.destination }
  const receipt = name === 'file.save'
    ? await service.save({ ...common, baseRevision: target.revision })
    : await service.export({ ...common, revision: target.revision,
      format: (parsed.data as z.infer<typeof documentExportInputSchema>).format })
  return documentDeliveryReceiptResult(receipt)
}
