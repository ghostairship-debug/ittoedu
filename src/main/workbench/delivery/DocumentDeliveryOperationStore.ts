import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExportReceipt, SaveReceipt } from '../../../shared/workbench/toolPorts'

export interface DeliveryOperationRecord {
  runId: string
  operationId: string
  requestDigest: string
  kind: 'save' | 'export'
  status: 'started' | 'generated' | 'writing' | 'completed' | 'failed'
  receipt?: SaveReceipt | ExportReceipt
  path?: string
  contentSha256?: string
  publicationIdentity?: string | null
  fileVersion?: string | null
  documentId?: string
}

/** Durable outer-operation ticket. An interrupted disk write is queried, never replayed. */
export class DocumentDeliveryOperationStore {
  private readonly tails = new Map<string, Promise<unknown>>()
  constructor(private readonly directory: string) {}

  private key(runId: string, operationId: string): string { return `${runId}\u0000${operationId}` }
  private filename(key: string): string { return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`) }
  private async read(key: string): Promise<DeliveryOperationRecord | null> {
    try {
      const record = JSON.parse(await fs.readFile(this.filename(key), 'utf8')) as DeliveryOperationRecord
      if (this.key(record.runId, record.operationId) !== key || !['save', 'export'].includes(record.kind))
        throw new Error('保存/导出操作记录损坏')
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const promise = (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(task)
    this.tails.set(key, promise)
    void promise.finally(() => { if (this.tails.get(key) === promise) this.tails.delete(key) }).catch(() => undefined)
    return promise
  }
  private async write(key: string, record: DeliveryOperationRecord): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const destination = this.filename(key), temporary = `${destination}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx', 0o600)
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, destination)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  async lookup(runId: string, operationId: string): Promise<DeliveryOperationRecord | null> {
    const key = this.key(runId, operationId)
    await this.tails.get(key)?.catch(() => undefined)
    return this.read(key)
  }
  async start(input: Pick<DeliveryOperationRecord, 'runId' | 'operationId' | 'requestDigest' | 'kind'>): Promise<{ record: DeliveryOperationRecord; created: boolean }> {
    const key = this.key(input.runId, input.operationId)
    return this.serial(key, async () => {
      const existing = await this.read(key)
      if (existing) {
        if (existing.requestDigest !== input.requestDigest || existing.kind !== input.kind)
          throw new Error('同一保存/导出操作编号不能改变请求')
        return { record: existing, created: false }
      }
      const record: DeliveryOperationRecord = { ...input, status: 'started' }
      await this.write(key, record)
      return { record, created: true }
    })
  }
  async ownsExportVersion(input: { runId: string; documentId: string; epoch: string; path: string; format: string; fileVersion: string; taskRunIds?: readonly string[] }): Promise<boolean> {
    await Promise.all([...this.tails.values()].map(tail => tail.catch(() => undefined)))
    let names: string[]
    try { names = await fs.readdir(this.directory) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
    const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
    let owned = false
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const record = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')) as DeliveryOperationRecord
      if (record.kind !== 'export' || !record.path || key(record.path) !== key(input.path)) continue
      if (record.status === 'writing') return false // An unresolved write is never replaced by a new attempt.
      const receipt = record.receipt as ExportReceipt | undefined
      if ((record.runId === input.runId || input.taskRunIds?.includes(record.runId)) && record.status === 'completed' && receipt?.status === 'written'
        && receipt.documentId === input.documentId && (receipt.epoch === input.epoch
          || record.runId !== input.runId && input.taskRunIds?.includes(record.runId))
        && receipt.format === input.format && receipt.fileVersion === input.fileVersion) owned = true
    }
    return owned
  }
  async patch(runId: string, operationId: string, change: Partial<DeliveryOperationRecord>): Promise<DeliveryOperationRecord> {
    const key = this.key(runId, operationId)
    return this.serial(key, async () => {
      const prior = await this.read(key)
      if (!prior) throw new Error('保存/导出操作记录不存在')
      if (prior.status === 'completed') throw new Error('已完成的保存/导出操作不能改写')
      const next = { ...prior, ...change, runId, operationId, requestDigest: prior.requestDigest, kind: prior.kind }
      await this.write(key, next)
      return next
    })
  }
}
