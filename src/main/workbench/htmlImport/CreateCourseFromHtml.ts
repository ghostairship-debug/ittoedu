import { nativeProjectFilename } from '../../../shared/nativeProjectFile'
import path from 'node:path'
import type { ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import type { SaveReceipt } from '../../../shared/workbench/toolPorts'
import type { ModelToolCall, ToolResult } from '../../../shared/workbench/tools'
import type { DocumentOperationResult } from '../../../shared/workbench/document'
import { splitHtmlSections, type HtmlSectionPage } from './splitHtmlSections'
import { prepareMeasurementDocument } from '../contentApply/measurement/prepareMeasurementDocument'

export interface CreateCourseFromHtmlInput {
  sourcePath: string
  name?: string
  /** Output directory; file.create resolves it in the frozen run file context. */
  path?: string
}

export type CreateCourseFromHtmlChild = 'file.open' | 'file.create' | 'read' | 'project.list' | 'project.apply' | 'file.save'

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

function committedReceipt(value: unknown, documentId: string): value is Extract<DocumentOperationResult, { status: 'applied' | 'unchanged' }> {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Record<string, unknown>
  return (receipt.status === 'applied' || receipt.status === 'unchanged') && receipt.documentId === documentId
    && typeof receipt.operationId === 'string' && typeof receipt.beforeRevision === 'number' && typeof receipt.revision === 'number'
    && receipt.persistence === 'recoverable'
}

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
  if (typeof source?.documentId !== 'string' || typeof source.path !== 'string')
    return failure('invalid-html-source', '来源文件未打开；没有创建课件')
  const sourceTarget = await ports.documentTarget(source.documentId, 'read')
  let sourceHtml = '', cursor: string | undefined, part = 0
  do {
    const captured = await child(`capture-source-${part++}`, 'read', () => ({ target: sourceTarget, limit: 640, ...(cursor ? { cursor } : {}) }))
    if (captured.kind === 'error') return captured
    const value = data(captured)
    if (typeof value?.text !== 'string') return failure('invalid-html-source', '当前 HTML 正文未捕获；没有创建课件')
    sourceHtml += value.text
    cursor = captured.kind === 'read' ? captured.nextCursor : undefined
  } while (cursor)
  // A shared program can couple sections through state or navigation. Keep that
  // program once; ordinary independent pages use the existing host surfaces.
  const sections: HtmlSectionPage[] = prepareMeasurementDocument({ html: sourceHtml }).documentProgramReason
    ? [{ order: 0, id: null, html: sourceHtml }] : splitHtmlSections(sourceHtml).sections

  const requestedName = input.name ?? (path.parse(source.path).name || '课件')
  const name = nativeProjectFilename(requestedName)
  const createdResult = await child('create', 'file.create', () => ({
    name, kind: 'course-v10', ...(input.path === undefined ? {} : { path: input.path }),
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
    if (typeof opened?.documentId !== 'string' || opened.kind !== 'course-v10')
      return failure('course-open-failed', `课件文件已创建但未打开：${created.path}；HTML 尚未导入`)
    documentId = opened.documentId
  }
  const targetDocumentId = documentId
  const project = await ports.documentTarget(targetDocumentId, 'write')
  const listed = await child('list-target', 'project.list', () => ({ project }))
  if (listed.kind === 'error') return listed
  const files = data(listed)?.files
  const targetPath = Array.isArray(files) ? files.find(file => file && typeof file === 'object'
    && file.type === 'structure' && typeof file.path === 'string' && file.path.startsWith('pages/'))?.path : undefined
  if (typeof targetPath !== 'string') return failure('course-target-missing', `课件文件已创建，但没有可导入的页面：${created.path}`)
  let receipt!: Extract<DocumentOperationResult, { status: 'applied' | 'unchanged' }>
  const affected: string[] = [], warnings: NonNullable<Extract<ToolResult, { kind: 'document-operation' }>['advisories']>[number][] = []
  for (const section of sections) {
    let pagePath = targetPath
    if (section.order > 0) {
      const added = await child(`page-${section.order}`, 'project.apply', () => ({ project, path: 'pages', intent: 'surface.add', kind: 'slide', title: section.title ?? `第 ${section.order + 1} 页` }))
      if (added.kind === 'error') return added
      const id = data(added)?.insertedIds
      const listed = await child(`list-page-${section.order}`, 'project.list', () => ({ project }))
      if (listed.kind === 'error') return listed
      const files = data(listed)?.files
      // surface.add appends; read its formal directory instead of guessing a title slug.
      const pages = Array.isArray(files) ? files.filter(file => file?.type === 'structure' && typeof file.path === 'string' && file.path.startsWith('pages/')) : []
      pagePath = pages.at(-1)?.path
      if (!Array.isArray(id) || !id.length || typeof pagePath !== 'string') return failure('course-target-missing', `新页面已提交，但目录不可用：${created.path}`)
    } else if (sections.length > 1 && section.title) {
      const titled = await child('title-page-0', 'project.apply', () => ({ project, path: pagePath, intent: 'surface.title', title: section.title }))
      if (titled.kind === 'error') return titled
    }
    const applied = await child(section.order ? `import-${section.order}` : 'import', 'project.apply', () => ({
      project, path: pagePath, from: source.path, content: section.html, intent: 'insert',
    }))
    const result = data(applied)
    if (applied.kind === 'error') return { ...applied, message: `${applied.message}；课件文件：${created.path}` }
    const committed = applied.kind === 'document-operation' ? applied.result : result?.receipt
    if (!committedReceipt(committed, targetDocumentId)) return failure('html-import-failed', `第 ${section.order + 1} 页未得到正式提交回执；课件文件：${created.path}`)
    receipt = committed
    if (applied.kind === 'document-operation') affected.push(...applied.affected)
    if (Array.isArray(result?.insertedIds)) affected.push(...result.insertedIds.filter(id => typeof id === 'string'))
    if (Array.isArray(result?.diagnostics)) warnings.push(...result.diagnostics.filter(item => typeof item?.message === 'string')
      .map(item => ({ step: section.order, code: 'html-import-warning' as const, message: item.message + (typeof item.reference === 'string' ? ` (${item.reference})` : '') })))
  }
  const imported: Extract<ToolResult, { kind: 'document-operation' }> = { kind: 'document-operation', result: receipt,
    affected,
    ...(warnings.length ? { advisories: warnings } : {}) }

  const saved = await child('save', 'file.save', async () => ({
    target: await ports.documentTarget(targetDocumentId, 'write'),
  }))
  if (saved.kind === 'error' && /outcome-unknown/.test(saved.code))
    return { ...saved, message: `HTML 已导入 ${created.path}；${saved.message}` }
  const saveReceipt = data(saved) as Partial<SaveReceipt> | null
  const savedSuccessfully = saveReceipt?.status === 'saved' && saveReceipt.documentId === targetDocumentId
  const result: CreatedCourseFromHtml = {
    status: savedSuccessfully ? 'saved' : 'imported', sourcePath: source.path, path: created.path,
    documentId: targetDocumentId, saved: savedSuccessfully, import: imported, save: saved,
    ...(!savedSuccessfully ? { saveError: saved.kind === 'error' ? saved.message : saveReceipt?.reason ?? 'HTML 已导入，但尚未确认保存成功' } : {}),
  }
  return { kind: 'read', data: result }
}
