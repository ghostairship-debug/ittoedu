import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { ToolRunGrant, ToolResult } from '../../../shared/workbench/tools'
import type { DocumentDeliveryServicePort } from '../../../shared/workbench/toolPorts'
import type { ComponentProjectSnapshot } from '../../../core/projectFiles/componentPlatform'
import { documentDeliveryReceiptResult } from '../../../core/tools/DocumentDeliveryTools'
import { documentExportInputSchema } from '../../../core/tools/DocumentDeliveryTools'
import { executeResolvedDocumentDelivery } from '../../../core/tools/DocumentDeliveryTools'

export const componentProjectDeliverySchema = z.object({
  project: z.string().min(1).optional(), destination: z.string().min(1).optional(),
  format: documentExportInputSchema.shape.format.optional(),
  options: documentExportInputSchema.shape.options,
}).strict()

export interface ComponentProjectDeliveryContext {
  runId: string
  operationId: string
  requestDigest: string
  signal?: AbortSignal
  /** Resolves the authorized current document, not a model-supplied epoch/revision or stale short handle. */
  current(project: string | undefined, access: 'write'): Promise<ComponentProjectSnapshot>
}

/** Resume known delivery before resolving a target. This never applies or reimports content. */
export async function deliverComponentProject(service: DocumentDeliveryServicePort, context: ComponentProjectDeliveryContext,
  raw: unknown): Promise<ToolResult> {
  const parsed = componentProjectDeliverySchema.safeParse(raw)
  if (!parsed.success) return { kind: 'error', code: 'invalid-input', message: '保存/导出参数无效：' + parsed.error.issues.map(issue => issue.message).join('；') }
  const known = await service.lookup(context)
  if (known) return documentDeliveryReceiptResult(known)
  context.signal?.throwIfAborted()
  const snapshot = await context.current(parsed.data.project, 'write')
  if (snapshot.model.kind !== 'course-v10') return { kind: 'error', code: 'unsupported-project', message: '此入口只交付当前 Project V10 工程。' }
  return executeResolvedDocumentDelivery(service, context, snapshot, parsed.data)
}

/** Used by the existing destination resolver before realpath(parent). No document or byte writer lives here. */
export async function prepareComponentDeliveryParent(filename: string, scope: ToolRunGrant['fileAccess'], signal?: AbortSignal): Promise<string> {
  if (!path.isAbsolute(filename) || filename.includes('\u0000')) throw new Error('保存目标必须是有效绝对路径。')
  if (scope?.permission === 'read-only') throw new Error('只读任务不能创建保存目录。')
  const parent = path.dirname(path.resolve(filename))
  let ancestor = parent
  for (;;) {
    try { await fs.realpath(ancestor); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(ancestor) === ancestor) throw error
      ancestor = path.dirname(ancestor)
    }
  }
  const actualAncestor = await fs.realpath(ancestor)
  const projectedParent = path.resolve(actualAncestor, path.relative(ancestor, parent))
  if (!scope && ancestor !== parent) throw new Error('当前连接没有新建保存目录的授权。')
  if (scope?.permission === 'workspace') {
    if (!scope.workspaceRoot || !isInsideRoot(await fs.realpath(scope.workspaceRoot), projectedParent)) throw new Error('保存目录位于授权工作空间外。')
  }
  signal?.throwIfAborted()
  await fs.mkdir(parent, { recursive: true })
  const actualParent = await fs.realpath(parent)
  if (scope?.permission === 'workspace' && !isInsideRoot(await fs.realpath(scope.workspaceRoot!), actualParent)) throw new Error('保存目录实际位置已移到授权工作空间外。')
  signal?.throwIfAborted()
  return actualParent
}
