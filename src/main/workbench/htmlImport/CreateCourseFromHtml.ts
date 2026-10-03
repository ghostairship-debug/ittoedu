import path from 'node:path'
import type { ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import type { SaveReceipt } from '../../../shared/workbench/toolPorts'
import type { ModelToolCall, ToolResult } from '../../../shared/workbench/tools'

export interface CreateCourseFromHtmlInput {
  sourcePath: string
  name?: string
  /** Output directory; file.create resolves it in the frozen run file context. */
  path?: string
}

export type CreateCourseFromHtmlChild = 'file.open' | 'file.create' | 'html.import' | 'file.save'

export interface CreateCourseFromHtmlPorts {
  /** Query the existing child call and its original receipt. Unknown outcomes must not return null. */
  lookupChild(callId: string, name: CreateCourseFromHtmlChild): Promise<ToolResult | null>
  /** Use the existing host execution path, including permissions, stop checks and durable child receipts. */
  executeChild(callId: string, call: ModelToolCall): Promise<ToolResult>
  /** Attach/resolve only within the run's existing authorization, then issue a current document handle. */
  documentTarget(documentId: string, access: 'read' | 'write'): Promise<string>
}

export interface CreateCourseFromHtmlContext {
  /** Host-assigned outer call identity, retained across recovery. */
  callId: string
  permission: ExecutionPermissionMode
  assertActive(): void
}

export interface CreatedCourseFromHtml {
  status: 'saved' | 'imported'
  sourcePath: string
  path: string
  documentId: string
  saved: boolean
  import: Extract<ToolResult, { kind: 'document-operation' }>
  save: ToolResult
  saveError?: string
}

function data(result: ToolResult): Record<string, unknown> | null {
  return result.kind === 'read' && result.data !== null && typeof result.data === 'object'
    ? result.data as Record<string, unknown> : null
}

function failure(code: string, message: string): ToolResult { return { kind: 'error', code, message } }

/** Compose existing operations; this use case owns no document state, journal or writer. */
export async function createCourseFromHtml(
  input: CreateCourseFromHtmlInput, context: CreateCourseFromHtmlContext, ports: CreateCourseFromHtmlPorts,
): Promise<ToolResult> {
  context.assertActive()
  if (context.permission === 'read-only') return failure('permission-denied', '只读任务不能创建课件')

  const child = async (step: string, name: CreateCourseFromHtmlChild, makeInput: () => unknown | Promise<unknown>): Promise<ToolResult> => {
    context.assertActive()
    const callId = `${context.callId}:${step}`
    const previous = await ports.lookupChild(callId, name)
    if (previous) return previous
    context.assertActive()
    const childInput = await makeInput()
    context.assertActive()
    return ports.executeChild(callId, { name, input: childInput })
  }

  const sourceResult = await child('open-source', 'file.open', () => ({ path: input.sourcePath }))
  if (sourceResult.kind === 'error') return sourceResult
  const source = data(sourceResult)
  if (typeof source?.documentId !== 'string' || source.kind !== 'text'
    || typeof source.path !== 'string' || !/\.html?$/i.test(source.path))
    return failure('invalid-html-source', '来源不是已打开的 HTML 文本文档；没有创建课件')

  const requestedName = input.name ?? (path.basename(source.path).replace(/\.html?$/i, '') || '课件')
  const name = /\.h5lesson$/i.test(requestedName) ? requestedName : `${requestedName}.h5lesson`
  const createdResult = await child('create', 'file.create', () => ({
    name, kind: 'course-v9', ...(input.path === undefined ? {} : { path: input.path }),
  }))
  if (createdResult.kind === 'error') return createdResult
  const created = data(createdResult)
  if (typeof created?.path !== 'string') return failure('course-create-failed', (() => {
    const operation = created?.operation as { items?: { error?: { message?: string } }[] } | undefined
    return operation?.items?.find(item => item.error?.message)?.error?.message ?? '课件文件未创建，HTML 尚未导入'
  })())

  // A successful create can lose its open acknowledgement. Reopen that same file; never create another.
  let documentId = typeof created.documentId === 'string' ? created.documentId : undefined
  if (!documentId) {
    const reopened = await child('open-target', 'file.open', () => ({ path: created.path }))
    if (reopened.kind === 'error') return reopened
    const opened = data(reopened)
    if (typeof opened?.documentId !== 'string' || opened.kind !== 'course-v9')
      return failure('course-open-failed', `课件文件已创建但未打开：${created.path}；HTML 尚未导入`)
    documentId = opened.documentId
  }
  const targetDocumentId = documentId
  const imported = await child('import', 'html.import', async () => ({
    source: await ports.documentTarget(source.documentId as string, 'read'),
    target: await ports.documentTarget(targetDocumentId, 'write'),
  }))
  if (imported.kind === 'error') return { ...imported, message: `${imported.message}；课件文件：${created.path}` }
  if (imported.kind !== 'document-operation'
    || imported.result.status !== 'applied' && imported.result.status !== 'unchanged')
    return failure('html-import-failed', `${imported.kind === 'document-operation' && 'message' in imported.result ? imported.result.message : 'HTML 未提交'}；课件文件：${created.path}`)

  const saved = await child('save', 'file.save', async () => ({
    target: await ports.documentTarget(targetDocumentId, 'write'),
  }))
  if (saved.kind === 'error' && /outcome-unknown/.test(saved.code))
    return { ...saved, message: `HTML 已导入 ${created.path}；${saved.message}` }
  const receipt = data(saved) as Partial<SaveReceipt> | null
  const savedSuccessfully = receipt?.status === 'saved' && receipt.documentId === targetDocumentId
  const result: CreatedCourseFromHtml = {
    status: savedSuccessfully ? 'saved' : 'imported', sourcePath: source.path, path: created.path,
    documentId: targetDocumentId, saved: savedSuccessfully, import: imported, save: saved,
    ...(!savedSuccessfully ? { saveError: saved.kind === 'error' ? saved.message : receipt?.reason ?? 'HTML 已导入，但尚未确认保存成功' } : {}),
  }
  return { kind: 'read', data: result }
}
