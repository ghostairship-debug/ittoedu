import { z } from 'zod'
import type { DocumentDeliveryServicePort, ExportReceipt, SaveReceipt } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const fileSaveInputSchema = z.object({
  target: z.string().min(1).max(200).describe('file.open/create 返回的 data.target 文档短句柄；不是文件路径、documentId 或正文 writableTarget。'),
  destination: z.string().min(1).max(1024).optional(),
}).strict()

export const documentExportInputSchema = z.object({
  target: z.string().min(1).max(200),
  format: z.enum(['html-offline', 'html-online', 'web-package', 'pptx', 'pdf', 'docx']).optional(),
  destination: z.string().min(1).max(1024).optional(),
  options: z.object({ pageIds: z.array(z.string().min(1)).min(1).optional().describe('静态格式页面选择与顺序：surfaceId 或 Spatial 的 surfaceId:frameId；省略时按作品顺序输出。'),
    pageSize: z.enum(['A4', 'letter', 'surface-native']).optional(),
    orientation: z.enum(['auto', 'portrait', 'landscape']).optional() }).strict().optional(),
}).strict()

/** One explicit save/export intent. The Gateway supplies an omitted current target. */
export const taskFinishDeliverySchema = documentExportInputSchema.partial({ target: true, format: true })
export type TaskFinishDelivery = z.infer<typeof taskFinishDeliverySchema>

export const documentDeliveryTools = [
  { name: 'file.save' as const, description: '保存已打开文档的当前正式内容。target 使用宿主返回的文档短句柄，destination 仅用于另存为。返回确切保存版本与脏状态。', inputSchema: fileSaveInputSchema,
    manual: { label: '保存文件', group: 'edit' as const, targetKinds: ['document'] as const } },
  { name: 'document.export' as const, description: '将已授权课件的当前内容导出；省略 format 默认离线单 HTML，保留互动并可直接运行。也可明确选择 html-online、web-package、pptx、pdf 或 Flow 讲义 docx；PPTX/PDF/DOCX 是静态格式，不承载自编程序互动。相对 destination 使用任务工作空间根目录。消费与人工导出相同的 V10 格式生产器。返回 generated 或 written 的真实状态。同任务同文档的既有导出未被修改时可原位更新，其他同名文件不覆盖。', inputSchema: documentExportInputSchema,
    manual: { label: '导出文档', group: 'edit' as const, targetKinds: ['document'] as const } },
]

export interface DocumentDeliveryToolContext {
  runId: string
  operationId: string
  requestDigest: string
  resolveHandle(handle: string, access: 'write'): Promise<{ documentId: string; epoch: string; revision: number } | null>
  signal?: AbortSignal
}

export interface TaskFinishDeliveryContext extends Pick<DocumentDeliveryToolContext, 'runId' | 'operationId' | 'requestDigest' | 'signal'> {
  current(target?: string): Promise<{ documentId: string; epoch: string; revision: number } | null>
}

export function documentDeliveryReceiptResult(receipt: SaveReceipt | ExportReceipt): ToolResult {
  return receipt.status === 'saved' || receipt.status === 'written' || receipt.status === 'generated'
    ? { kind: 'read', data: receipt }
    : { kind: 'error', code: receipt.status === 'rejected' ? 'delivery-rejected' : 'delivery-failed', message: receipt.reason ?? '保存或导出失败', data: receipt }
}

/** Target protocols stay with their callers; this owner performs the same mechanical delivery. */
export async function executeResolvedDocumentDelivery(service: DocumentDeliveryServicePort,
  context: Pick<DocumentDeliveryToolContext, 'runId' | 'operationId' | 'requestDigest' | 'signal'>,
  target: { documentId: string; epoch: string; revision: number }, input: Omit<TaskFinishDelivery, 'target'>): Promise<ToolResult> {
  context.signal?.throwIfAborted()
  const common = { runId: context.runId, operationId: context.operationId, requestDigest: context.requestDigest,
    documentId: target.documentId, epoch: target.epoch, destination: input.destination }
  const receipt = input.format
    ? await service.export({ ...common, revision: target.revision, format: input.format, options: input.options })
    : await service.save({ ...common, baseRevision: target.revision })
  return documentDeliveryReceiptResult(receipt)
}

export async function executeTaskFinishDelivery(service: DocumentDeliveryServicePort, context: TaskFinishDeliveryContext,
  raw: unknown): Promise<ToolResult> {
  const parsed = taskFinishDeliverySchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input', message: '保存或导出参数无效：' + parsed.error.issues.map(issue => issue.message).join('；') }
  const known = await service.lookup(context)
  if (known) return documentDeliveryReceiptResult(known)
  context.signal?.throwIfAborted()
  const target = await context.current(parsed.data.target)
  if (!target) return { kind: 'error', code: 'target-not-found', message: '当前目标文档不存在或没有写入授权' }
  return executeResolvedDocumentDelivery(service, context, target, parsed.data)
}

export async function executeDocumentDeliveryTool(
  service: DocumentDeliveryServicePort, context: DocumentDeliveryToolContext,
  name: 'file.save' | 'document.export', raw: unknown,
): Promise<ToolResult> {
  const parsed = name === 'file.save' ? fileSaveInputSchema.safeParse(raw) : documentExportInputSchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input',
    message: name === 'document.export' && raw && typeof raw === 'object' && 'format' in raw
      && !['html-offline', 'html-online', 'web-package', 'pptx', 'pdf', 'docx'].includes(String(raw.format))
      ? 'document.export 支持 html-offline、html-online、web-package、pptx、pdf、docx；DOCX 仅导出 Flow 讲义。'
      : '保存或导出参数无效：' + parsed.error.issues.map(issue => issue.message).join('；') }
  const existing = await service.lookup({ runId: context.runId, operationId: context.operationId, requestDigest: context.requestDigest })
  if (existing) return documentDeliveryReceiptResult(existing)
  context.signal?.throwIfAborted()
  const target = await context.resolveHandle(parsed.data.target, 'write')
  if (!target) return { kind: 'error', code: 'target-not-found', message: '目标文档不存在或没有写入授权' }
  const delivery: TaskFinishDelivery = parsed.data
  return executeResolvedDocumentDelivery(service, context, target, name === 'document.export'
    ? { ...delivery, format: delivery.format ?? 'html-offline' } : delivery)
}
