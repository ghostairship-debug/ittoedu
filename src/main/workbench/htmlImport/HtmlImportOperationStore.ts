import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { documentDigest } from '../../../core/documents/documentDigest'
import type { HtmlImportReceipt } from '../../../shared/workbench/toolPorts'

export interface HtmlImportChildCall { callId: string; name: string; input: unknown }
export interface HtmlImportOperationRecord {
  runId: string
  operationId: string
  requestDigest: string
  status: 'started' | 'preparing' | 'checking' | 'ready' | 'committing' | 'committed' | 'failed' | 'cancelled'
  children: HtmlImportChildCall[]
  targetDocumentId?: string
  jobId?: string
  artifactId?: string
  pages?: readonly { order: number; location: string; runtimeId: string }[]
  warnings?: readonly { code: string; message: string }[]
  receipt?: HtmlImportReceipt
  reason?: string
}

/** The outer operation and every child call are durably fixed before dispatch. */
export class HtmlImportOperationStore {
  private readonly memory = new Map<string, HtmlImportOperationRecord>()
  private readonly tails = new Map<string, Promise<unknown>>()
  constructor(private readonly directory: string) {}

  private key(runId: string, operationId: string): string { return `${runId}\u0000${operationId}` }
  private file(key: string): string { return path.join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`) }
  private async read(key: string): Promise<HtmlImportOperationRecord | null> {
    const known = this.memory.get(key)
    if (known) return structuredClone(known)
    try {
      const record = JSON.parse(await fs.readFile(this.file(key), 'utf8')) as HtmlImportOperationRecord
      if (this.key(record.runId, record.operationId) !== key || !Array.isArray(record.children)) throw new Error('HTML 导入操作记录损坏')
      this.memory.set(key, record)
      return structuredClone(record)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(task)
    this.tails.set(key, result)
    void result.finally(() => { if (this.tails.get(key) === result) this.tails.delete(key) }).catch(() => undefined)
    return result
  }
  private async save(key: string, record: HtmlImportOperationRecord): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const filename = this.file(key), temporary = `${filename}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
      this.memory.set(key, structuredClone(record))
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  async lookup(runId: string, operationId: string): Promise<HtmlImportOperationRecord | null> {
    const key = this.key(runId, operationId)
    await this.tails.get(key)?.catch(() => undefined)
    return this.read(key)
  }
  async start(input: Pick<HtmlImportOperationRecord, 'runId' | 'operationId' | 'requestDigest'>): Promise<{ record: HtmlImportOperationRecord; created: boolean }> {
    const key = this.key(input.runId, input.operationId)
    return this.serial(key, async () => {
      const existing = await this.read(key)
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) throw new Error('同一 HTML 导入操作编号不能改变请求参数')
        return { record: existing, created: false }
      }
      const record: HtmlImportOperationRecord = { ...input, status: 'started', children: [] }
      await this.save(key, record)
      return { record, created: true }
    })
  }
  async patch(runId: string, operationId: string, change: Partial<HtmlImportOperationRecord>): Promise<HtmlImportOperationRecord> {
    const key = this.key(runId, operationId)
    return this.serial(key, async () => {
      const prior = await this.read(key)
      if (!prior) throw new Error('HTML 导入操作记录不存在')
      if (prior.status === 'committed' && change.status !== 'committed') throw new Error('已提交的 HTML 导入不能改写状态')
      if (prior.status === 'cancelled' && change.status && change.status !== 'cancelled') throw new Error('HTML 导入已取消')
      const next = { ...prior, ...change, runId, operationId, requestDigest: prior.requestDigest }
      await this.save(key, next)
      return next
    })
  }
  async child(runId: string, operationId: string, child: HtmlImportChildCall): Promise<void> {
    const key = this.key(runId, operationId)
    await this.serial(key, async () => {
      const prior = await this.read(key)
      if (!prior) throw new Error('HTML 导入操作记录不存在')
      if (prior.status === 'cancelled') throw new Error('HTML 导入已取消')
      const existing = prior.children.find(item => item.callId === child.callId)
      if (existing) {
        if (documentDigest(existing) !== documentDigest(child)) throw new Error('HTML 导入子调用身份与参数不一致')
        return
      }
      prior.children.push(structuredClone(child))
      await this.save(key, prior)
    })
  }
}
