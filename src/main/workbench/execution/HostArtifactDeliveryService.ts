import { publishNewFile } from '../publishNewFile'
import { DocumentSaveFailure } from '../../../shared/workbench/documentSave'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExecutionPermissionMode } from '../../../shared/workbench/executionPermission'
import { validateWorkspaceEntryName } from '../WorkspaceFiles'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code
const samePath = (a: string, b: string) => process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
function inside(root: string, target: string): boolean {
  const base = process.platform === 'win32' ? root.toLowerCase() : root
  const candidate = process.platform === 'win32' ? target.toLowerCase() : target
  const relative = path.relative(base, candidate)
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export type ArtifactSourceKind = 'image' | 'compute' | 'delegation'
export interface ArtifactDeliveryInput {
  runId: string
  operationId: string
  /** Frozen canonical workspace root and permission from the accepted run. */
  workspaceRoot: string
  permission: ExecutionPermissionMode
  /** User-selected path. Relative paths resolve from the frozen workspace root. */
  destination: string
  sourceKind: ArtifactSourceKind
  sourceId: string
  /** Main has already verified these bytes against the image/compute owner. */
  bytes: Uint8Array
  /** Exact canonical target from an approval for this operation, when required. */
  approvedTargetPath?: string
  /** Throws when the run has stopped or its write authority was revoked. */
  assertActive(): void
}
export interface ArtifactDeliveryPreflight {
  path: string
  parent: string
  outsideWorkspace: boolean
  approvalRequired: boolean
}
export interface ArtifactDeliveryResult {
  operationId: string
  status: 'written' | 'rejected' | 'conflict' | 'stopped' | 'unknown'
  path: string
  sourceKind: ArtifactSourceKind
  sourceId: string
  byteLength: number
  version: string
  /** Unknown means bytes may have appeared; never automatically retry this operation. */
  observed?: 'matching' | 'missing' | 'different'
  message?: string
}
type DeliveryRecord = Omit<ArtifactDeliveryResult, 'status'> & {
  schemaVersion: 1
  runId: string
  requestDigest: string
  status: ArtifactDeliveryResult['status'] | 'prepared'
}
class DeliveryStopped extends Error {
  constructor() { super('运行已停止，成果未交付'); this.name = 'DeliveryStopped' }
}
function publicReceipt(record: DeliveryRecord, status: ArtifactDeliveryResult['status'],
  observed?: ArtifactDeliveryResult['observed']): ArtifactDeliveryResult {
  return { operationId: record.operationId, status, path: record.path, sourceKind: record.sourceKind,
    sourceId: record.sourceId, byteLength: record.byteLength, version: record.version,
    ...(observed ? { observed } : {}), ...(record.message ? { message: record.message } : {}) }
}
export interface HostArtifactDeliveryOptions {
  /** App-managed durable receipts; separate from the user's workspace. */
  journalDirectory: string
  /** Use DocumentHostService.fileCoordinator.withFileOperation. */
  withFileOperation<T>(work: () => Promise<T>): Promise<T>
  assertTarget?(filename: string): void | Promise<void>
}

async function verifyNoSymlinkDirectory(directory: string): Promise<string> {
  const root = path.parse(directory).root
  let current = root
  for (const segment of path.relative(root, directory).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('目标父路径包含符号链接或非目录')
  }
  const canonical = await fs.realpath(directory)
  if (!samePath(canonical, directory)) throw new Error('目标父路径经过符号链接，请选择真实目录')
  return canonical
}

/** Create-only delivery of verified image/compute bytes into a user-authorized workspace path. */
export class HostArtifactDeliveryService {
  private readonly inFlight = new Map<string, { runId: string; requestDigest: string; result: Promise<ArtifactDeliveryResult> }>()
  private readonly stoppedRuns = new Set<string>()
  constructor(private readonly options: HostArtifactDeliveryOptions) {
    if (!path.isAbsolute(options.journalDirectory)) throw new Error('成果回执目录必须是绝对路径')
  }

  async preflight(input: Pick<ArtifactDeliveryInput, 'workspaceRoot' | 'permission' | 'destination' | 'approvedTargetPath'>): Promise<ArtifactDeliveryPreflight> {
    if (!path.isAbsolute(input.workspaceRoot)) throw new Error('任务缺少已冻结的绝对工作空间根')
    if (!input.destination || input.destination.includes('\0')) throw new Error('成果目标路径无效')
    if (input.permission === 'read-only') throw new Error('只读任务不能交付文件')
    const root = await verifyNoSymlinkDirectory(input.workspaceRoot)
    const wanted = path.resolve(root, input.destination)
    validateWorkspaceEntryName(path.basename(wanted))
    const parent = await verifyNoSymlinkDirectory(path.dirname(wanted))
    const target = path.join(parent, path.basename(wanted))
    const outsideWorkspace = !inside(root, target)
    const approvalRequired = input.permission === 'ask' || input.permission === 'workspace' && outsideWorkspace
    if (input.approvedTargetPath !== undefined && (!path.isAbsolute(input.approvedTargetPath)
      || !samePath(input.approvedTargetPath, target)))
      throw new Error('本次批准的成果目标与实际路径不一致')
    return { path: target, parent, outsideWorkspace, approvalRequired }
  }

  private file(operationId: string): string {
    if (!operationId) throw new Error('成果操作编号无效')
    return path.join(this.options.journalDirectory, `${hash(Buffer.from(operationId))}.json`)
  }
  private async readRecord(operationId: string): Promise<DeliveryRecord | null> {
    let bytes: string
    try { bytes = await fs.readFile(this.file(operationId), 'utf8') }
    catch (error) { if (missing(error)) return null; throw error }
    const record = JSON.parse(bytes) as DeliveryRecord
    if (record.schemaVersion !== 1 || record.operationId !== operationId || !record.requestDigest
      || !['prepared', 'written', 'rejected', 'conflict', 'stopped', 'unknown'].includes(record.status))
      throw new Error('成果回执记录无效；结果未知，不能自动重试')
    return record
  }
  private async createRecord(record: DeliveryRecord): Promise<DeliveryRecord> {
    await fs.mkdir(this.options.journalDirectory, { recursive: true })
    const filename = this.file(record.operationId)
    try {
      const handle = await fs.open(filename, 'wx')
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync() }
      finally { await handle.close() }
      return record
    } catch (error) {
      if (code(error) !== 'EEXIST') throw error
      const existing = await this.readRecord(record.operationId)
      if (!existing) throw new Error('成果回执身份冲突')
      return existing
    }
  }
  private async updateRecord(record: DeliveryRecord): Promise<void> {
    const filename = this.file(record.operationId), temporary = `${filename}.${randomUUID()}.tmp`
    const handle = await fs.open(temporary, 'wx')
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync() }
    finally { await handle.close() }
    try { await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  private async observed(record: DeliveryRecord): Promise<ArtifactDeliveryResult['observed']> {
    try {
      const stat = await fs.lstat(record.path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== record.byteLength) return 'different'
      return hash(await fs.readFile(record.path)) === record.version.slice('sha256:'.length) ? 'matching' : 'different'
    } catch (error) { return missing(error) ? 'missing' : 'different' }
  }
  private async resultFromRecord(record: DeliveryRecord): Promise<ArtifactDeliveryResult> {
    if (record.status === 'rejected' || record.status === 'conflict' || record.status === 'stopped')
      return publicReceipt(record, record.status)
    const observed = await this.observed(record)
    if (record.status === 'prepared') return { ...publicReceipt(record, 'unknown', observed),
      message: '交付在最终回执前中断；即使目标字节相同，也不能证明来源，本次不会自动重放' }
    if (record.status === 'written' && observed !== 'matching') return { ...publicReceipt(record, 'unknown', observed),
      message: '已交付文件后来改变或不可读；请检查当前位置' }
    return publicReceipt(record, record.status, record.status === 'unknown' ? observed : undefined)
  }
  async lookup(operationId: string, runId?: string): Promise<ArtifactDeliveryResult | null> {
    const pending = this.inFlight.get(operationId)
    if (pending) {
      if (runId !== undefined && pending.runId !== runId) throw new Error('成果回执不属于当前运行')
      return pending.result
    }
    const record = await this.readRecord(operationId)
    if (record && runId !== undefined && record.runId !== runId) throw new Error('成果回执不属于当前运行')
    return record ? this.resultFromRecord(record) : null
  }

  /** Revokes future deliveries and waits for a write already crossing its commit point. */
  async stopRun(runId: string): Promise<void> {
    this.stoppedRuns.add(runId)
    await Promise.allSettled([...this.inFlight.values()].filter(item => item.runId === runId).map(item => item.result))
  }
  private assertLive(input: Pick<ArtifactDeliveryInput, 'runId' | 'assertActive'>): void {
    if (this.stoppedRuns.has(input.runId)) throw new DeliveryStopped()
    try { input.assertActive() } catch { throw new DeliveryStopped() }
  }

  async deliver(input: ArtifactDeliveryInput): Promise<ArtifactDeliveryResult> {
    if (this.stoppedRuns.has(input.runId)) throw new DeliveryStopped()
    if (!input.runId || !input.sourceId
      || !['image', 'compute', 'delegation'].includes(input.sourceKind)) throw new Error('成果来源身份无效')
    if (!(input.bytes instanceof Uint8Array)) throw new Error('成果字节无效')
    const bytes = Uint8Array.from(input.bytes), digest = hash(bytes)
    const scope = await this.preflight(input)
    if (scope.approvalRequired && !input.approvedTargetPath) throw new Error('成果写入需要本次目标的明确批准')
    const requestDigest = hash(Buffer.from(JSON.stringify([input.runId, scope.path, input.sourceKind, input.sourceId, digest])))
    const pending = this.inFlight.get(input.operationId)
    if (pending) {
      if (pending.requestDigest !== requestDigest) throw new Error('同一成果操作编号不能用于不同目标或字节')
      return pending.result
    }
    const prepared: DeliveryRecord = { schemaVersion: 1, operationId: input.operationId, runId: input.runId,
      requestDigest, status: 'prepared', path: scope.path, sourceKind: input.sourceKind,
      sourceId: input.sourceId, byteLength: bytes.byteLength, version: `sha256:${digest}` }
    const result = this.perform(input, prepared, bytes)
    this.inFlight.set(input.operationId, { runId: input.runId, requestDigest, result })
    try { return await result }
    finally { this.inFlight.delete(input.operationId) }
  }

  private async perform(input: ArtifactDeliveryInput, prepared: DeliveryRecord, bytes: Uint8Array): Promise<ArtifactDeliveryResult> {
    const existing = await this.createRecord(prepared)
    if (existing.requestDigest !== prepared.requestDigest) throw new Error('同一成果操作编号不能用于不同目标或字节')
    if (existing !== prepared) return this.resultFromRecord(existing)
    let publication: 'not-published' | 'unknown' | 'published' = 'not-published'
    try {
      await this.options.withFileOperation(async () => {
        const scope = await this.preflight(input)
        await this.options.assertTarget?.(scope.path)
        if (!samePath(scope.path, prepared.path)) throw new Error('成果目标在提交前改变')
        this.assertLive(input)
        const temporary = path.join(scope.parent, `.${path.basename(scope.path)}.${randomUUID()}.tmp`)
        let owned = false
        try {
          const handle = await fs.open(temporary, 'wx')
          owned = true
          try { await handle.writeFile(bytes); await handle.sync() }
          finally { await handle.close() }
          await verifyNoSymlinkDirectory(scope.parent)
          this.assertLive(input)
          publication = 'unknown'
          try { await publishNewFile(temporary, scope.path) }
          catch (error) {
            if (error instanceof DocumentSaveFailure) publication = error.publication
            throw error
          }
          publication = 'published'
        } finally {
          if (owned && publication !== 'unknown') await fs.rm(temporary, { force: true }).catch(() => undefined)
        }
      })
      await verifyNoSymlinkDirectory(path.dirname(prepared.path))
      const observed = await this.observed(prepared)
      if (observed !== 'matching') throw new Error('成果已发布但读回不一致')
      const written: DeliveryRecord = { ...prepared, status: 'written' }
      await this.updateRecord(written)
      return publicReceipt(written, 'written')
    } catch (error) {
      const status: ArtifactDeliveryResult['status'] = publication !== 'not-published' ? 'unknown'
        : code(error) === 'EEXIST' ? 'conflict' : error instanceof DeliveryStopped ? 'stopped' : 'rejected'
      const record: DeliveryRecord = { ...prepared, status,
        message: status === 'conflict' ? '目标文件已存在，未覆盖' : status === 'stopped' ? '运行停止，成果未交付'
          : status === 'rejected' ? `成果尚未发布，可处理原因后再次保存：${error instanceof Error ? error.message : String(error)}`
            : error instanceof Error ? error.message : '交付结果未知' }
      await this.updateRecord(record).catch(() => undefined)
      return publicReceipt(record, status, status === 'unknown' ? await this.observed(record) : undefined)
    }
  }
}
