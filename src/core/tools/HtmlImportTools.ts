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
  if (receipt.status === 'cancelled') return { kind: 'error', code: 'html-import-cancelled', message: 'HTML 导入已取消；本次没有新的课件提交，先前已应用的修改保留。' }
  return { kind: 'error', code: 'html-import-failed', message: (receipt.reason ?? 'HTML 导入未完成') + '；请保留交互脚本与已确认内容，修复具体诊断后重试。applied 仅表示已提交，交付仍需 file.save。' }
}

/** Single canonical tool schema projected by both the built-in gateway and external MCP. */
export const htmlImportTool = {
  name: 'html.import' as const,
  description: '将已授权 HTML text 文档按页拆分或整份导入 Course V9，执行页内脚本并保留公共样式。source、target 使用当前任务的 t... 文档句柄；destinations 的位置字段可填同一课件本轮 listChildren 返回的当前 t... 目标句柄，或 read(课件文档句柄) 返回的稳定 id。修改页面后须重新读取目标，旧句柄会失效。一次准入和提交，支持单次撤销。',
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
