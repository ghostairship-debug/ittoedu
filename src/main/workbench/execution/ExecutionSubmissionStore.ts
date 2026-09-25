import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExecutionStart } from '../../../shared/workbench/execution'
import type { ExecutionSubmissionRecord } from '../../../shared/workbench/executionDesktop'

export interface StoredExecutionSubmission extends ExecutionSubmissionRecord {
  schemaVersion: 1
  /** Digest of the stable user payload. expectedRevision is intentionally excluded. */
  digest: string
  start: ExecutionStart
  attachmentIds: string[]
  conversationRevision?: number
  continuation?: { runId: string; facts: string }
}

const clone = <T>(value: T): T => structuredClone(value)
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'

/** Durable acceptance owner. A starting record without a matching run checkpoint is never replayed. */
export class ExecutionSubmissionStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) {}
  private file(submissionId: string): string {
    if (!submissionId || submissionId.length > 512) throw new Error('提交编号无效')
    return path.join(this.directory, `${createHash('sha256').update(submissionId).digest('hex')}.json`)
  }
  private pausesFile(): string { return path.join(this.directory, 'queue-pauses.json') }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.catch(() => undefined).then(action)
    this.tail = operation
    return operation
  }
  private validate(value: unknown, submissionId?: string): StoredExecutionSubmission {
    const record = value as StoredExecutionSubmission
    if (!record || typeof record !== 'object' || record.schemaVersion !== 1 || !record.submissionId
      || submissionId && record.submissionId !== submissionId || !record.workspaceId || !record.conversationId
      || !['queued', 'starting', 'accepted', 'failed', 'cancelled'].includes(record.state)
      || !['queue', 'adjust'].includes(record.mode) || !record.digest || !record.start
      || record.start.taskId !== record.submissionId || record.start.conversationId !== record.conversationId
      || !Array.isArray(record.documents) || !Array.isArray(record.attachments) || !Array.isArray(record.attachmentIds)
      || !Number.isSafeInteger(record.createdAt) || !Number.isSafeInteger(record.updatedAt)) throw new Error('执行提交恢复记录无效')
    return record
  }
  private async write(record: StoredExecutionSubmission): Promise<void> {
    this.validate(record, record.submissionId)
    await fs.mkdir(this.directory, { recursive: true })
    const filename = this.file(record.submissionId), temporary = `${filename}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  create(record: StoredExecutionSubmission): Promise<{ record: StoredExecutionSubmission; created: boolean }> {
    const copy = clone(record)
    return this.serial(async () => {
      const existing = await this.readDirect(copy.submissionId)
      if (existing) {
        if (existing.digest !== copy.digest || existing.workspaceId !== copy.workspaceId || existing.conversationId !== copy.conversationId) {
          throw new Error('同一提交编号已用于不同消息，已拒绝重复发送')
        }
        return { record: clone(existing), created: false }
      }
      await this.write(copy)
      return { record: clone(copy), created: true }
    })
  }
  update(submissionId: string, patch: Partial<Pick<StoredExecutionSubmission, 'state' | 'updatedAt' | 'runId' | 'failure' | 'conversationRevision' | 'continuation'>>): Promise<StoredExecutionSubmission> {
    return this.serial(async () => {
      const previous = await this.readDirect(submissionId)
      if (!previous) throw new Error('执行提交不存在')
      const next = { ...previous, ...clone(patch) }
      await this.write(next)
      return clone(next)
    })
  }
  private async readDirect(submissionId: string): Promise<StoredExecutionSubmission | null> {
    let bytes: string
    try { bytes = await fs.readFile(this.file(submissionId), 'utf8') }
    catch (error) { if (missing(error)) return null; throw error }
    return this.validate(JSON.parse(bytes), submissionId)
  }
  read(submissionId: string): Promise<StoredExecutionSubmission | null> {
    return this.serial(async () => clone(await this.readDirect(submissionId)))
  }
  list(): Promise<StoredExecutionSubmission[]> {
    return this.serial(async () => {
      let names: string[]
      try { names = await fs.readdir(this.directory) }
      catch (error) { if (missing(error)) return []; throw error }
      const records: StoredExecutionSubmission[] = []
      for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
        const record = this.validate(JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')))
        if (path.basename(this.file(record.submissionId)) !== name) throw new Error('执行提交恢复记录身份不匹配')
        records.push(record)
      }
      return records.sort((a, b) => a.createdAt - b.createdAt || a.submissionId.localeCompare(b.submissionId)).map(clone)
    })
  }
  private async readPauses(): Promise<Record<string, 'external-handoff'>> {
    let bytes: string
    try { bytes = await fs.readFile(this.pausesFile(), 'utf8') }
    catch (error) { if (missing(error)) return {}; throw error }
    const value = JSON.parse(bytes) as Record<string, unknown>
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.values(value).some(reason => reason !== 'external-handoff')) throw new Error('执行队列暂停记录无效')
    return value as Record<string, 'external-handoff'>
  }
  private async writePauses(pauses: Record<string, 'external-handoff'>): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const filename = this.pausesFile(), temporary = `${filename}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(pauses)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
  pause(conversationId: string): Promise<void> {
    return this.serial(async () => { const pauses = await this.readPauses(); pauses[conversationId] = 'external-handoff'; await this.writePauses(pauses) })
  }
  resume(conversationId: string): Promise<void> {
    return this.serial(async () => { const pauses = await this.readPauses(); if (!(conversationId in pauses)) return; delete pauses[conversationId]; await this.writePauses(pauses) })
  }
  pausedReason(conversationId: string): Promise<'external-handoff' | undefined> {
    return this.serial(async () => (await this.readPauses())[conversationId])
  }
}
