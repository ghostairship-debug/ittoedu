import { z } from 'zod'
import type { HtmlImportDestination, HtmlImportReceipt, HtmlImportServicePort } from '../../shared/workbench/toolPorts'
import type { ToolResult } from '../../shared/workbench/tools'

export const htmlImportDestinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slide-new'), surface: z.string().min(1), after: z.string().min(1).optional() }).strict(),
  z.object({ kind: z.literal('slide-existing'), location: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('flow-insert'), container: z.string().min(1) }).strict(),
])

export const htmlImportInputSchema = z.object({
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  mode: z.enum(['auto', 'sections', 'whole']).default('auto'),
  destinations: z.array(htmlImportDestinationSchema).min(1),
}).strict()

export type HtmlImportInput = z.infer<typeof htmlImportInputSchema>

export function htmlImportReceiptResult(receipt: HtmlImportReceipt): ToolResult {
  if (receipt.commit) return { kind: 'document-operation', result: receipt.commit, affected: receipt.pages.map(page => page.runtimeId) }
  return { kind: 'error', code: 'html-import-failed', message: receipt.reason ?? 'HTML 导入未完成' }
}

/** Single canonical tool schema projected by both the built-in gateway and external MCP. */
export const htmlImportTool = {
  name: 'html.import' as const,
  description: '将已授权 HTML text 文档按页拆分或整份导入到 Course V9 目标文档的 Slide 或 Flow 表面，执行本页内脚本并保留公共样式。通过一次受控准入与一次正式提交完成，支持单次撤销。',
  inputSchema: htmlImportInputSchema,
  manual: { label: '导入 HTML 页面', group: 'edit' as const, targetKinds: ['document'] as const },
}

export async function executeHtmlImport(
  service: HtmlImportServicePort,
  context: {
    runId: string
    operationId: string
    requestDigest: string
    resolveHandle(handle: string, access: 'read' | 'write'): Promise<{ documentId: string; epoch: string; revision: number; bindingVersion: number | null } | null>
    signal?: AbortSignal
  },
  input: unknown,
): Promise<ToolResult> {
  const parsed = htmlImportInputSchema.safeParse(input)
  if (!parsed.success) {
    return { kind: 'error', code: 'invalid-input', message: 'HTML 导入参数无效：' + parsed.error.issues.map(i => i.message).join('；') }
  }

  // Idempotency lookup先于重新解析句柄与读取当前源文
  const existing = await service.lookup({
    runId: context.runId,
    operationId: context.operationId,
    requestDigest: context.requestDigest,
  })
  if (existing) return htmlImportReceiptResult(existing)

  const sourceDoc = await context.resolveHandle(parsed.data.source, 'read')
  if (!sourceDoc) {
    return { kind: 'error', code: 'source-not-found', message: '未找到来源 HTML 文档或未授权' }
  }

  const targetDoc = await context.resolveHandle(parsed.data.target, 'write')
  if (!targetDoc) {
    return { kind: 'error', code: 'target-not-found', message: '未找到目标课程文档或未授权' }
  }

  const receipt = await service.import({
    runId: context.runId,
    operationId: context.operationId,
    requestDigest: context.requestDigest,
    sourceDocumentId: sourceDoc.documentId,
    sourceEpoch: sourceDoc.epoch,
    sourceRevision: sourceDoc.revision,
    sourceBindingVersion: sourceDoc.bindingVersion,
    targetDocumentId: targetDoc.documentId,
    targetEpoch: targetDoc.epoch,
    targetRevision: targetDoc.revision,
    mode: parsed.data.mode,
    destinations: parsed.data.destinations as readonly HtmlImportDestination[],
    signal: context.signal,
  })

  return htmlImportReceiptResult(receipt)
}
