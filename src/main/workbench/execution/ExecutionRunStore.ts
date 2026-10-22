import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import { restoreStoredContentOutput } from './storedContentOutput'
import { trustedRunDocumentIds } from './executionOutcome'
import { captureRunRecord, decodeRunCheckpoint, diffRunRecords, encodeRunChange, encodeRunCheckpoint, restoreRunChanges } from './executionRunCheckpoint'

const writes = new Map<string, Promise<unknown>>()
const fileKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
interface DurableHead { record: ExecutionRunRecord; generation: string; sequence: number; checkpointBytes: number; tailBytes: number }
// Private snapshots of active runs only. Every store instance shares the existing
// per-file queue, so another instance cannot append against a stale durable head.
const heads = new Map<string, DurableHead>()
const active = (record: ExecutionRunRecord) => ['queued', 'running', 'stopping'].includes(record.status)
const changesFile = (filename: string, generation: string) => `${filename}.${generation}.changes`
function queued<T>(filename: string, work: () => Promise<T>): Promise<T> {
  const key = fileKey(filename)
  const operation = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(work)
  const tail = operation.catch(() => undefined)
  writes.set(key, tail)
  void tail.finally(() => { if (writes.get(key) === tail) writes.delete(key) })
  return operation
}

/** Engine checkpoints only; an unavailable record never becomes an empty replacement run. */
export class ExecutionRunStore {
  private readonly unavailable = new Map<string, string>()
  private readonly activity = new Map<string, ExecutionRunRecord['status']>()
  private readonly documentRuns = new Map<string, Set<string>>()
  private readonly runDocuments = new Map<string, readonly string[]>()
  private readonly publications = new Map<string, number>()
  private readonly captures = new Map<string, ExecutionRunRecord>()
  private documentIndexReady = false
  private documentIndexLoading?: Promise<void>
  constructor(private readonly directory: string) {}
  get recoveryIssues(): string[] { return [...this.unavailable.values()] }
  private file(runId: string): string {
    if (!runId || runId.length > 512) throw new Error('运行编号无效')
    return path.join(this.directory, `${createHash('sha256').update(runId).digest('hex')}.json`)
  }
  private validate(value: ExecutionRunRecord, filename: string, expected?: string): ExecutionRunRecord {
    if (value.schemaVersion !== 1 || expected && value.runId !== expected || !Number.isSafeInteger(value.version)
      || !value.input || typeof value.input.conversationId !== 'string' || !Array.isArray(value.input.documents)
      || !Array.isArray(value.messages) || !Array.isArray(value.tools) || !Array.isArray(value.requests)
      || path.basename(this.file(value.runId)) !== path.basename(filename)) throw new Error('运行恢复记录无效')
    if (value.input.contentOutput) value.input.contentOutput = restoreStoredContentOutput(value.input.contentOutput)
    return value
  }
  private observe(record: ExecutionRunRecord): void {
    this.activity.set(record.runId, record.status)
    this.indexDocuments(record)
  }
  private removeDocumentIndex(runId: string): void {
    for (const documentId of this.runDocuments.get(runId) ?? []) {
      const runs = this.documentRuns.get(documentId)
      runs?.delete(runId)
      if (!runs?.size) this.documentRuns.delete(documentId)
    }
    this.runDocuments.delete(runId)
  }
  private indexDocuments(record: ExecutionRunRecord): void {
    this.removeDocumentIndex(record.runId)
    const documents = trustedRunDocumentIds(record)
    this.runDocuments.set(record.runId, documents)
    for (const documentId of documents) {
      const runs = this.documentRuns.get(documentId) ?? new Set<string>()
      runs.add(record.runId); this.documentRuns.set(documentId, runs)
    }
  }
  private async checkpoint(filename: string, record: ExecutionRunRecord, old?: DurableHead): Promise<DurableHead> {
    const generation = randomUUID(), bytes = encodeRunCheckpoint(record, generation)
    const temporary = `${filename}.${randomUUID()}.tmp`
    let complete = false
    try {
      const file = await fs.open(temporary, 'wx')
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
      complete = true
      const retryDelays = [25, 75, 150, 300]
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(temporary, filename); break }
        catch (error) {
          if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= retryDelays.length) throw error
          // Retry the same closed, flushed candidate. The old authoritative
          // checkpoint and its referenced tail remain readable throughout.
          await delay(retryDelays[attempt])
        }
      }
      // The new generation is authoritative before retiring its predecessor.
      // A failed cleanup cannot cause an old tail to be applied to a new head.
      if (old) await fs.rm(changesFile(filename, old.generation), { force: true }).catch(() => undefined)
      return { record, generation, sequence: 0, checkpointBytes: Buffer.byteLength(bytes), tailBytes: 0 }
    } finally {
      if (!complete) await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }
  private async append(filename: string, head: DurableHead, frame: Buffer, record: ExecutionRunRecord): Promise<DurableHead> {
    try {
      const file = await fs.open(changesFile(filename, head.generation), 'a+')
      try {
        const before = (await file.stat()).size
        try { await file.writeFile(frame); await file.sync() }
        catch (cause) {
          // Failed saves do not advance the durable base. Restore the last ACKed
          // boundary before any later save/read can use this same file queue.
          try {
            // Windows append handles do not permit ftruncate. Repair through a
            // read/write handle while the same file queue excludes other writers.
            const repair = await fs.open(changesFile(filename, head.generation), 'r+')
            try { await repair.truncate(before); await repair.sync() } finally { await repair.close() }
          }
          catch (rollback) { throw new AggregateError([cause, rollback], '运行恢复增量未能恢复原边界') }
          throw cause
        }
        return { ...head, record, sequence: head.sequence + 1, tailBytes: before + frame.length }
      } finally { await file.close() }
    } catch (error) {
      // Even close() may fail after a frame was flushed. A later save publishes
      // a fresh complete generation instead of appending against an uncertain base.
      heads.delete(fileKey(filename))
      throw error
    }
  }
  save(record: ExecutionRunRecord, options: { checkpoint?: boolean } = {}): Promise<void> {
    const filename = this.file(record.runId), key = fileKey(filename)
    const copy = captureRunRecord(record, this.captures.get(key) ?? heads.get(key)?.record)
    this.captures.set(key, copy)
    const operation = queued(filename, async () => {
      await fs.mkdir(this.directory, { recursive: true })
      const head = heads.get(key)
      let next: DurableHead
      if (!head || options.checkpoint) next = await this.checkpoint(filename, copy, head)
      else {
        const effect = diffRunRecords(head.record, copy)
        const frame = effect && encodeRunChange(copy.runId, head.generation, head.sequence, effect)
        // Bound repeated reconstruction by the actual accumulated byte cost,
        // rather than a run/message count or a content refusal threshold.
        next = !frame ? head : head.tailBytes + frame.length >= head.checkpointBytes
          ? await this.checkpoint(filename, copy, head) : await this.append(filename, head, frame, copy)
      }
      if (active(copy)) heads.set(key, next); else heads.delete(key)
      this.publications.set(key, (this.publications.get(key) ?? 0) + 1)
      this.unavailable.delete(filename)
      this.observe(copy)
    })
    void operation.then(() => { if (this.captures.get(key) === copy) this.captures.delete(key) }, () => { if (this.captures.get(key) === copy) this.captures.delete(key) })
    return operation
  }
  private async loadUnlocked(filename: string, expected?: string): Promise<ExecutionRunRecord> {
    const checkpoint = decodeRunCheckpoint(await fs.readFile(filename, 'utf8'))
    this.validate(checkpoint.record, filename, expected)
    if (!checkpoint.generation) return checkpoint.record
    const tail = changesFile(filename, checkpoint.generation)
    let bytes: Buffer
    try { bytes = await fs.readFile(tail) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return checkpoint.record; throw error }
    const restored = restoreRunChanges(checkpoint, bytes)
    if (restored.committedBytes !== bytes.length) {
      // Only an uncommitted final frame is repairable. A complete corrupt frame
      // throws above and preserves its original bytes for diagnosis.
      const file = await fs.open(tail, 'r+')
      try { await file.truncate(restored.committedBytes); await file.sync() } finally { await file.close() }
    }
    return this.validate(restored.record, filename, expected)
  }
  private async load(filename: string, expected?: string): Promise<ExecutionRunRecord> {
    // Atomic legacy JSON reads may finish after a save, as before. Incremental
    // state is always reread in the same queue as append and partial-tail repair.
    const checkpoint = decodeRunCheckpoint(await fs.readFile(filename, 'utf8'))
    return checkpoint.generation ? queued(filename, () => this.loadUnlocked(filename, expected)) : this.validate(checkpoint.record, filename, expected)
  }
  /** Current process facts from the existing checkpoint owner; no history body reads for a close prompt. */
  activeRunIds(): string[] { return [...this.activity].filter(([, status]) => ['queued', 'running', 'stopping'].includes(status)).map(([id]) => id) }
  async read(runId: string): Promise<ExecutionRunRecord | null> {
    const filename = this.file(runId)
    const key = fileKey(filename), observedPublication = this.publications.get(key) ?? 0
    await writes.get(key)
    try {
      const value = await this.load(filename, runId)
      if ((this.publications.get(key) ?? 0) === observedPublication) this.observe(value)
      this.unavailable.delete(filename)
      return value
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        if ((this.publications.get(key) ?? 0) === observedPublication) this.removeDocumentIndex(runId)
        return null
      }
      const message = `一份历史运行记录无法读取，原文件保留：${path.basename(filename)}`
      this.unavailable.set(filename, message)
      throw new Error(message, { cause })
    }
  }
  async list(): Promise<ExecutionRunRecord[]> {
    await Promise.all([...writes].filter(([name]) => fileKey(path.dirname(name)) === fileKey(this.directory)).map(([, promise]) => promise))
    let names: string[]
    try { names = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const values: ExecutionRunRecord[] = []
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const filename = path.join(this.directory, name)
      const key = fileKey(filename), observedPublication = this.publications.get(key) ?? 0
      try {
        const record = await this.load(filename)
        values.push(record)
        if ((this.publications.get(key) ?? 0) === observedPublication) this.observe(record)
        this.unavailable.delete(filename)
      } catch {
        this.unavailable.set(filename, `一份历史运行记录无法读取，原文件保留：${name}`)
      }
    }
    for (const filename of this.unavailable.keys()) if (!names.includes(path.basename(filename))) this.unavailable.delete(filename)
    this.documentIndexReady = true
    return values
  }
  /** Rebuildable lookup only. Records are still freshly read and checked by the existing owner. */
  async forDocument(documentId: string): Promise<ExecutionRunRecord[]> {
    if (!this.documentIndexReady) {
      this.documentIndexLoading ??= this.list().then(() => { this.documentIndexReady = true })
        .finally(() => { this.documentIndexLoading = undefined })
      await this.documentIndexLoading
    }
    const records: ExecutionRunRecord[] = []
    for (const runId of [...this.documentRuns.get(documentId) ?? []]) {
      try {
        const record = await this.read(runId)
        if (record && trustedRunDocumentIds(record).includes(documentId)) records.push(record)
      } catch { /* Like list(), keep the unreadable original and its recovery diagnostic. */ }
    }
    return records
  }
  /** Only Main's explicit task-continuation links confer export ownership; ordinary conversation history does not. */
  async taskLineage(runId: string): Promise<string[]> {
    const first = await this.read(runId)
    if (!first) return [runId]
    const ids = [runId], seen = new Set(ids)
    let parent = first.taskContinuedFrom
    while (parent) {
      if (seen.has(parent)) throw new Error('任务续接链存在循环')
      const record = await this.read(parent)
      if (!record || record.input.conversationId !== first.input.conversationId
        || ['queued', 'running', 'stopping'].includes(record.status)) throw new Error('原任务归属无法核实，未覆盖旧导出')
      ids.push(parent); seen.add(parent); parent = record.taskContinuedFrom
    }
    return ids
  }
}
