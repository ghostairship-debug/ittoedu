import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { readUtf8File } from '../readUtf8File'
import type { ExecutionRunRecord, ExecutionToolRecord } from '../../../shared/workbench/execution'
import type { ToolResult } from '../../../shared/workbench/tools'
import type { ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { DocumentHostService } from '../DocumentHostService'
import { createTextDriver } from '../../../core/drivers/TextDriver'
import { ChangeReviewStore, type ChangeReviewCapture } from './ChangeReviewStore'

const FILE_MUTATIONS = new Set(['file.create', 'file.write', 'file.patch', 'file.mkdir', 'file.copy', 'file.move', 'file.rename', 'file.trash'])
const OUTSIDE_EFFECTS = new Set(['mcp.invoke', 'compute.run', 'job.cancel', 'job.start', 'media.start',
  'agent.delegate', 'image.generate', 'image.edit', 'build.import'])
const textDriver = createTextDriver()
const hash = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const recordData = (result: ToolResult | undefined): Record<string, unknown> | null =>
  result?.kind === 'read' && result.data !== null && typeof result.data === 'object' ? result.data as Record<string, unknown> : null

export type ChangeReviewAvailability = 'ready' | 'conflict' | 'no-before-snapshot' | 'unverified' | 'external' | 'unsupported'
export interface ChangeReviewEntry {
  entryId: string
  runId: string
  callId: string
  name: string
  path: string | null
  documentId?: string
  status: 'applied' | 'unchanged' | 'partial' | 'reported' | 'failed' | 'unknown'
  source: 'host-document' | 'host-file' | 'external'
  beforeVersion?: string
  afterVersion?: string
  availability: ChangeReviewAvailability
  reason?: string
  /** Human-readable bounded preview; complete before bytes remain only in the local review store. */
  preview?: { before: string; after: string; truncated: boolean }
}
export interface ChangeReviewPage {
  total: number
  entries: ChangeReviewEntry[]
  nextOffset?: number
  files: Array<{ path: string; entryIds: string[] }>
}
export type ChangeRollbackResult = { entryId: string; status: 'reverted' | 'conflict' | 'unavailable' | 'unknown'; message: string; documentId?: string; saved?: boolean }
export interface ChangeReviewAuthority {
  workspaceRoot: string
  permission: ExecutionPermissionMode
  /** Exact external paths approved for this user action; a historical run grant is never reused. */
  approvedOutsidePaths?: readonly string[]
  assertActive?(): void
}

/** Main-only review of real run receipts. File rollback is a new CAS mutation, never a replay of the old task. */
export class ExecutionChangeReviewService {
  readonly store: ChangeReviewStore
  constructor(private readonly host: DocumentHostService, directory: string) { this.store = new ChangeReviewStore(directory) }

  private live(filename: string) {
    return this.host.registry.list().find(snapshot => snapshot.binding.kind === 'file' && samePath(snapshot.binding.path, filename))
  }

  private async ordinaryFile(filename: string): Promise<{ version: string; text: string; mode: number; identity?: string }> {
    return readUtf8File(filename, { limit: 4000 })
  }

  /** Call after file preflight and before the side effect. Missing/oversize before content is recorded as unavailable. */
  async prepareFileMutation(input: { runId: string; callId: string; name: string; paths: readonly string[]; toolInput?: unknown }): Promise<void> {
    if (!['file.write', 'file.patch', 'file.create'].includes(input.name) || !input.paths[0]) return
    const filename = path.resolve(input.paths[0])
    const existing = await this.store.read(input.runId, input.callId)
    if (existing) {
      if (existing.name !== input.name || !samePath(existing.path, filename)) throw new Error('同一变更审阅编号对应不同文件操作')
      return
    }
    let before: ChangeReviewCapture['before']
    const live = this.live(filename)
    if (live) before = { kind: 'document', documentId: live.documentId, epoch: live.epoch, revision: live.revision }
    else {
      try {
        before = await this.store.captureFile(filename)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') before = { kind: 'missing' }
        else throw new Error('无法保全修改前正文，未开始覆盖；请检查源文件和快照目录', { cause: error })
      }
    }
    const kind = input.toolInput && typeof input.toolInput === 'object' ? (input.toolInput as { kind?: unknown }).kind : undefined
    const expectedCreatedVersion = input.name === 'file.create' && ['markdown', 'text', 'html'].includes(String(kind ?? 'markdown'))
      ? hash(Buffer.from('', 'utf8')) : undefined
    await this.store.save({ schemaVersion: 1, runId: input.runId, callId: input.callId, name: input.name, path: filename, before,
      ...(expectedCreatedVersion ? { expectedCreatedVersion } : {}) })
  }

  /** Call only after a committed tool return. A missing after snapshot keeps rollback unavailable. */
  async completeFileMutation(input: { runId: string; callId: string; result: ToolResult }): Promise<void> {
    try {
      const capture = await this.store.read(input.runId, input.callId)
      if (!capture) return
      const data = recordData(input.result)
      if (!data) return
      const documentResult = data.documentResult as { status?: string; documentId?: string; revision?: number; operationId?: string } | undefined
      if (documentResult?.status === 'applied' && documentResult.documentId && Number.isSafeInteger(documentResult.revision)) {
        const live = this.live(capture.path)
        if (live?.documentId !== documentResult.documentId || live.revision !== documentResult.revision) return
        capture.after = { version: `document:${live.documentId}:${live.epoch}:${live.revision}`,
          documentId: live.documentId, epoch: live.epoch, revision: live.revision }
      } else if (data.status === 'written' || data.saved === true || (data.operation && typeof data.operation === 'object'
        && (data.operation as { items?: Array<{ status?: unknown; targetPath?: unknown }> }).items?.some(item =>
          item.status === 'success' && item.targetPath === capture.path))) {
        const expected = typeof data.afterVersion === 'string' ? data.afterVersion : capture.expectedCreatedVersion ?? null
        if (!expected) return
        const current = await this.ordinaryFile(capture.path)
        if (current.version !== expected) return
        capture.after = { version: expected, mode: current.mode, ...(current.identity ? { identity: current.identity } : {}) }
      }
      if (capture.after) await this.store.save(capture)
    } catch {
      // The canonical file/document receipt already succeeded. A review indexing failure must not rewrite that fact.
    }
  }

  private async entry(run: ExecutionRunRecord, tool: ExecutionToolRecord,
    operationItem?: { index: number; status?: string; sourcePath?: string; targetPath?: string }): Promise<ChangeReviewEntry | null> {
    const { callId, call, result } = tool
    if (!result || tool.state !== 'returned') return null
    const capture = await this.store.read(run.runId, callId)
    const data = recordData(result)
    const documentResult = result.kind === 'document-operation' ? result.result
      : data?.documentResult as { status?: string; documentId?: string; operationId?: string; revision?: number } | undefined
    const operation = data?.operation as { items?: Array<{ status?: string; sourcePath?: string; targetPath?: string }> } | undefined
    const operationApplied = operationItem ? operationItem.status === 'success' || operationItem.status === 'partial'
      : operation?.items?.some(item => item.status === 'success' || item.status === 'partial') ?? false
    const changed = documentResult?.status === 'applied' || data?.status === 'written' || operationApplied
    const isFile = FILE_MUTATIONS.has(call.name)
    const isDocument = !!documentResult?.documentId
    if (!isFile && !isDocument && !OUTSIDE_EFFECTS.has(call.name)) return null
    const pathName = operationItem?.targetPath ?? operationItem?.sourcePath ?? capture?.path
      ?? (isDocument ? run.documentPaths?.[documentResult.documentId!] : undefined)
      ?? (typeof data?.path === 'string' ? data.path : operation?.items?.find(item => item.targetPath)?.targetPath
        ?? operation?.items?.find(item => item.sourcePath)?.sourcePath)
      ?? null
    const source = isDocument ? 'host-document' : isFile ? 'host-file' : 'external'
    const unknownEffect = result.kind === 'error' && /(?:outcome|effect)-unknown/u.test(result.code)
    const status: ChangeReviewEntry['status'] = unknownEffect ? 'unknown'
      : result.kind === 'error' || documentResult && !['applied', 'unchanged'].includes(documentResult.status ?? '')
      || operationItem?.status === 'failed' || operationItem?.status === 'cancelled'
      ? 'failed' : operationItem?.status === 'partial' || !operationItem && (operation as { status?: string } | undefined)?.status === 'partial'
        ? 'partial' : changed ? 'applied' : documentResult?.status === 'unchanged' || data?.status === 'unchanged' ? 'unchanged'
          : source === 'external' ? data?.status === 'unknown' ? 'unknown' : 'reported'
            : result.kind === 'read' && isFile ? 'failed' : 'unknown'
    let availability: ChangeReviewAvailability = 'unsupported', reason = '此操作没有可验证的自动回退方法'
    if (source === 'external') { availability = 'external'; reason = '外部作用需到原系统核对，不能自动撤销' }
    else if (status === 'unknown') { availability = 'unverified'; reason = '原操作结果未知，不能自动撤销' }
    else if (status === 'applied' && isDocument && documentResult?.operationId) {
      availability = 'ready'; reason = ''
    } else if (status === 'applied' && capture) {
      if (capture.before.kind === 'unavailable') { availability = 'no-before-snapshot'; reason = capture.before.reason }
      else if (!capture.after) { availability = 'unverified'; reason = '缺少提交后版本证据' }
      else if (capture.before.kind === 'missing' || capture.before.kind === 'file') { availability = 'ready'; reason = '' }
    } else if (status === 'applied' && isFile) { availability = 'no-before-snapshot'; reason = '此操作没有修改前快照' }
    const entry: ChangeReviewEntry = { entryId: operationItem ? `${callId}:${operationItem.index}` : callId,
      runId: run.runId, callId, name: call.name, path: pathName,
      ...(isDocument ? { documentId: documentResult!.documentId } : {}), status, source,
      ...(capture?.before.kind === 'file' ? { beforeVersion: capture.before.version } : {}),
      ...(capture?.after ? { afterVersion: capture.after.version } : {}), availability, ...(reason ? { reason } : {}) }
    if (capture?.before.kind === 'file' && status === 'applied' && capture.after) {
      const before = capture.before.text
      let after = ''
      try { const current = await this.ordinaryFile(capture.path); if (current.version === capture.after.version) after = current.text } catch { /* preview is optional */ }
      entry.preview = { before: before.slice(0, 4000), after: after.slice(0, 4000), truncated: (capture.before.blob?.characters ?? before.length) > 4000 || after.length >= 4000 }
    }
    if (entry.availability === 'ready' && capture?.after && source === 'host-file') {
      try {
        const current = await this.ordinaryFile(capture.path)
        if (!this.matchesAfter(current, capture.after) || this.live(capture.path)) {
          entry.availability = 'conflict'; entry.reason = '当前文件已改变或已由编辑器打开'
        }
      } catch { entry.availability = 'conflict'; entry.reason = '当前文件已不存在或不可读取' }
    }
    if (entry.availability === 'ready' && isDocument && documentResult?.operationId) {
      try {
        const current = this.host.registry.get(documentResult.documentId!).read()
        if (current.undoHead?.operationId !== documentResult.operationId || current.undoHead.actor !== 'agent') {
          entry.availability = 'conflict'; entry.reason = '原修改已不是文档历史顶部'
        }
      } catch { entry.availability = 'conflict'; entry.reason = '文档当前未打开，请恢复文档后重新审阅' }
    }
    return entry
  }

  async inspect(run: ExecutionRunRecord, input: { offset?: number; limit?: number } = {}): Promise<ChangeReviewPage> {
    const limit = Math.max(1, Math.min(100, input.limit ?? 50)), offset = Math.max(0, input.offset ?? 0)
    const relevant = run.tools.filter(tool => tool.state === 'returned' && (FILE_MUTATIONS.has(tool.call.name)
      || tool.result?.kind === 'document-operation' || OUTSIDE_EFFECTS.has(tool.call.name)))
    const units: Array<{ tool: ExecutionToolRecord; operationItem?: { index: number; status?: string; sourcePath?: string; targetPath?: string } }> = relevant.flatMap(tool => {
      const data = recordData(tool.result), operation = data?.operation as { items?: Array<{ status?: string; sourcePath?: string; targetPath?: string }> } | undefined
      return operation?.items && operation.items.length > 1
        ? operation.items.map((value, index) => ({ tool, operationItem: { ...value, index } })) : [{ tool }]
    })
    const entries = (await Promise.all(units.slice(offset, offset + limit).map(unit => this.entry(run, unit.tool, unit.operationItem))))
      .filter((value): value is ChangeReviewEntry => value !== null)
    const grouped = new Map<string, string[]>()
    for (const entry of entries) { const key = entry.path ?? '外部/未知'; grouped.set(key, [...(grouped.get(key) ?? []), entry.entryId]) }
    return { total: units.length, entries, ...(offset + limit < units.length ? { nextOffset: offset + limit } : {}),
      files: [...grouped].map(([file, entryIds]) => ({ path: file, entryIds })) }
  }

  private assertAuthority(filename: string, authority: ChangeReviewAuthority): void {
    if (authority.permission === 'read-only') throw new Error('当前权限不允许回退内容')
    if (!path.isAbsolute(authority.workspaceRoot)) throw new Error('缺少授权的工作空间根')
    if (authority.permission !== 'full' && !isInsideRoot(authority.workspaceRoot, filename)
      && !(authority.approvedOutsidePaths ?? []).some(approved => samePath(path.resolve(approved), path.resolve(filename))))
      throw new Error('工作空间外回退需要本次明确授权')
  }

  private matchesAfter(current: { version: string; mode: number; identity?: string }, after: NonNullable<ChangeReviewCapture['after']>): boolean {
    return current.version === after.version && (after.identity === undefined || current.identity === after.identity)
      && (after.mode === undefined || current.mode === after.mode)
  }

  private async revertFile(capture: ChangeReviewCapture, authority: ChangeReviewAuthority, entryId: string): Promise<ChangeRollbackResult> {
    const filename = capture.path
    this.assertAuthority(filename, authority)
    if (!capture.after) return { entryId, status: 'unavailable', message: '缺少提交后版本证据' }
    return this.host.fileCoordinator.withFileOperation(async () => {
      await this.host.assertFileAvailable(filename)
      if (this.live(filename)) return { entryId, status: 'conflict', message: '文件已在编辑器中打开，请使用文档历史回退' }
      let current: Awaited<ReturnType<typeof this.ordinaryFile>>
      try { current = await this.ordinaryFile(filename) }
      catch { return { entryId, status: 'conflict', message: '文件已不存在或类型已改变' } }
      if (!this.matchesAfter(current, capture.after!)) return { entryId, status: 'conflict', message: '文件在原修改后已改变，未覆盖后续修改' }
      if (capture.before.kind === 'missing') {
        const preserved = this.store.preservationPath()
        await fs.mkdir(path.dirname(preserved), { recursive: true })
        try {
          await fs.copyFile(filename, preserved, 1)
          const handle = await fs.open(preserved, 'r+')
          try { await handle.sync() } finally { await handle.close() }
          if (hash(await fs.readFile(preserved)) !== capture.after!.version ||
            !this.matchesAfter(await this.ordinaryFile(filename), capture.after!) || this.live(filename)) {
            await fs.rm(preserved, { force: true })
            return { entryId, status: 'conflict', message: '新建文件在回收前再次改变，未移走' }
          }
          authority.assertActive?.()
          await fs.unlink(filename)
          return { entryId, status: 'reverted', message: `新建文件已移走并保全于 ${preserved}`, saved: true }
        } catch (error) {
          return { entryId, status: 'unknown', message: `文件保全或移走结果需检查：${error instanceof Error ? error.message : String(error)}` }
        }
      }
      if (capture.before.kind !== 'file') return { entryId, status: 'unavailable', message: '没有可恢复的修改前正文' }
      const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`)
      try {
        await this.store.writeBefore(capture.before, temporary)
        await fs.chmod(temporary, capture.before.mode)
        if (!this.matchesAfter(await this.ordinaryFile(filename), capture.after!) || this.live(filename))
          return { entryId, status: 'conflict', message: '提交前文件再次改变，未覆盖' }
        authority.assertActive?.()
        await fs.rename(temporary, filename)
        return { entryId, status: 'reverted', message: '已恢复修改前正文并保存', saved: true }
      } catch (error) {
        return { entryId, status: 'unknown', message: `回退结果需检查：${error instanceof Error ? error.message : String(error)}` }
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    })
  }

  /** One item at a time: a multi-file review never claims an all-or-nothing transaction. */
  async rollback(run: ExecutionRunRecord, entryId: string, authority: ChangeReviewAuthority): Promise<ChangeRollbackResult> {
    if (authority.permission === 'read-only' || !path.isAbsolute(authority.workspaceRoot))
      return { entryId, status: 'unavailable', message: '当前授权不允许回退内容' }
    const tool = run.tools.find(value => value.callId === entryId && value.state === 'returned')
    if (!tool) return { entryId, status: 'unavailable', message: '找不到已返回的原操作回执' }
    const entry = await this.entry(run, tool)
    if (!entry || entry.status !== 'applied' || entry.availability !== 'ready')
      return { entryId, status: entry?.availability === 'conflict' ? 'conflict' : 'unavailable',
        message: entry?.reason ?? '原操作没有确认应用' }
    const capture = await this.store.read(run.runId, tool.callId)
    const data = recordData(tool.result)
    const documentResult = tool.result?.kind === 'document-operation' ? tool.result.result
      : data?.documentResult as { status?: string; documentId?: string; operationId?: string } | undefined
    if (documentResult?.documentId && documentResult.operationId) {
      const session = this.host.registry.get(documentResult.documentId), current = await session.drain()
      if (current.binding.kind === 'file') this.assertAuthority(current.binding.path, authority)
      if (entry.path && current.binding.kind === 'file' && !samePath(current.binding.path, entry.path))
        return { entryId, status: 'conflict', message: '文档文件绑定已改变，未撤销' }
      if (current.undoHead?.operationId !== documentResult.operationId || current.undoHead.actor !== 'agent')
        return { entryId, status: 'conflict', message: '原修改已不是历史顶部，未覆盖后续修改' }
      authority.assertActive?.()
      const result = await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
        operationId: `review:${randomUUID()}`, actor: 'human', mutation: { type: 'undo', expectedTopOperationId: documentResult.operationId } })
      return result.status === 'applied' ? { entryId, status: 'reverted', message: '已从文档历史撤销；保存后写入文件', documentId: current.documentId, saved: false }
        : { entryId, status: result.status === 'conflict' ? 'conflict' : 'unknown', message: '文档历史回退未确认', documentId: current.documentId }
    }
    if (!capture || capture.before.kind === 'unavailable' || !capture.after || !entry.path)
      return { entryId, status: 'unavailable', message: '缺少安全回退所需的前后版本' }
    return this.revertFile(capture, authority, entryId)
  }
}
