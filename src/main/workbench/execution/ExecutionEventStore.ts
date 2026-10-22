import { TimingTrace } from './TimingTrace'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ImageJobTimingMark } from '../../../shared/workbench/images'
import {
  executionDetailKeys, executionBlobRefSchema, executionEventInputSchema, prepareExecutionEvents, applyExecutionProjectionOwned,
  type ExecutionEventSearchInput, type ExecutionEventSearchPage, type ExecutionBlobRef, type ExecutionEvent, type ExecutionEventInput, type ExecutionEventPage, type ExecutionProjection, type ExecutionProjectionPlan,
} from '../../../shared/workbench/executionEvents'
import type { ConversationMessage } from '../../../shared/workbench/conversations'
import { ExecutionTimelineReadModel } from '../../../shared/workbench/executionTimelineReadModel'
import type { ExecutionTimelinePageRequest, ExecutionTimelineGroupRequest, ExecutionTimelineBodyRequest } from '../../../shared/workbench/executionTimelineWindow'

import {
  EVENT_MAGIC as MAGIC, EVENT_COMMIT as COMMIT, EVENT_HEADER as HEADER, decodeExecutionRecords as decodeRecords,
  emptyExecutionEventFacts, replayExecutionSegment, observeExecutionExternalTools,
  ExecutionEventStoreError, type StoredExecutionEvent as Stored, type ExecutionEventSegment as Segment, type ExecutionEventFacts,
} from './executionEventLog'
import { EXECUTION_EVENT_CHECKPOINT, type ExecutionEventCheckpointMeta } from './executionEventCheckpoint'
import { createExecutionCheckpointInWorker, restoreExecutionEventsInWorker } from './executionEventCheckpointWorker'
export { ExecutionEventStoreError } from './executionEventLog'

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const queues = new Map<string, Promise<unknown>>()
const MAIN_CLOCK_INSTANCE = randomUUID()
export type ExecutionTimingStage = ImageJobTimingMark['stage'] | 'renderer.submit.clicked' | 'renderer.send.invoked' | 'renderer.first-visible'
  | 'submit.received' | 'submission.prepare.started' | 'submission.prepare.finished'
  | 'submission.attachments.started' | 'submission.attachments.finished'
  | 'engine.prepare.started' | 'engine.prepare.finished' | 'payload.compile.started' | 'payload.compile.finished'
  | 'request.prepared' | 'request.dispatched' | 'request.finished'
  | 'provider.first-event' | 'provider.first-content' | 'edit.content-decoded' | 'tool.started' | 'tool.finished'
  | 'document.applied' | 'save.started' | 'save.finished' | 'save.fact-observed' | 'run.ended'
export interface ExecutionTimingMark {
  markId: string
  conversationId: string
  taskId: string
  runId?: string
  requestId?: string
  toolCallId?: string
  stage: ExecutionTimingStage
  process: 'main' | 'renderer'
  clock: 'performance.now'
  clockInstanceId: string
  /** Wall-clock origin used only for a cross-process alignment estimate. */
  timeOriginMs?: number
  monotonicMs: number
  wallTimeMs: number
  /** A producer's wall-clock fact (e.g. DocumentHost save), not this mark's monotonic instant. */
  sourceWallTimeMs?: number
  detail?: { serializedBytes?: number; eventType?: string; contentKind?: string; outcome?: string; documentId?: string;
    operationId?: string; saveStatus?: string; attachmentCount?: number; imageCount?: number; imageBytes?: number;
    representationBytes?: number; itemId?: string; jobId?: string; referenceCount?: number; requestBytes?: number;
    httpStatus?: number; clockOffsetEstimateMs?: number; clockOffsetMethod?: 'timeOrigin' }
}
export function captureMainTiming(): Pick<ExecutionTimingMark, 'clockInstanceId' | 'monotonicMs' | 'wallTimeMs'>
  & { process: 'main'; clock: 'performance.now'; timeOriginMs: number } {
  return { process: 'main', clock: 'performance.now', clockInstanceId: MAIN_CLOCK_INSTANCE,
    timeOriginMs: performance.timeOrigin, monotonicMs: performance.now(), wallTimeMs: Date.now() }
}
function serial<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => {})
  return next
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  return JSON.stringify(value)
}
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try { await handle.sync() } finally { await handle.close() }
}
interface Loaded extends ExecutionEventFacts {
  checkpoint?: ExecutionEventCheckpointMeta
  readers: Map<string, ExecutionTimelineReadModel>
}
export interface ExecutionEventStoreOptions { directory: string; segmentBytes?: number; inlineBytes?: number }
export interface ExecutionEventPendingState {
  pendingEvents: number
  pendingTiming: number
  lastFailure?: { kind: 'event' | 'timing'; message: string }
  lastMaintenanceFailure?: string
}

/** A durable fact log, not a Run/Conversation owner. It has no execution callbacks or recovery replay hooks. */
export class ExecutionEventStore {
  private readonly timingTrace = new TimingTrace()
  private readonly directory: string
  private readonly segmentBytes: number
  private readonly inlineBytes: number
  private readonly loaded = new Map<string, Loaded>()
  private readonly maintenance = new Map<string, Promise<void>>()
  private lastMaintenanceFailure?: string
  private readonly consumers = new Map<string, Set<string>>()
  // At most two parsed segments; old pages remain on disk and are revalidated on change.
  private readonly pages = new Map<string, { stamp: string; records: Stored[]; size: number }>()
  private readonly listeners = new Set<(event: ExecutionEvent) => void>()
  private readonly pending = new Map<Promise<unknown>, 'event' | 'timing'>()
  private lastFailure?: ExecutionEventPendingState['lastFailure']
  private track<T>(promise: Promise<T>, kind: 'event' | 'timing'): Promise<T> {
    this.pending.set(promise, kind)
    void promise.then(() => { this.pending.delete(promise) }, error => {
      this.pending.delete(promise)
      this.lastFailure = { kind, message: error instanceof Error ? error.message : String(error) }
    })
    return promise
  }
  /** Non-authoritative display recording: queue now, observe durability through subscribe or flushPending. */
  enqueue(input: ExecutionEventInput): void { void this.append(input).catch(() => {}) }
  getPendingState(): ExecutionEventPendingState {
    let pendingEvents = 0, pendingTiming = 0
    for (const kind of this.pending.values()) { if (kind === 'event') pendingEvents++; else pendingTiming++ }
    return { pendingEvents, pendingTiming, ...(this.lastFailure ? { lastFailure: { ...this.lastFailure } } : {}), ...(this.lastMaintenanceFailure ? { lastMaintenanceFailure: this.lastMaintenanceFailure } : {}) }
  }
  /** Call after producers stop. Failures remain diagnostic; they cannot change or replay the business outcome. */
  async flushPending(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending.keys()])
  }
  /** Durable append observation only; observers never participate in the acknowledgement. */
  subscribe(listener: (event: ExecutionEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  /** Only real run/view owners retain the in-memory projection; the durable log owns history. */
  retain(conversationId: string, consumer: string): void {
    this.folder(conversationId)
    let consumers = this.consumers.get(conversationId)
    if (!consumers) { consumers = new Set(); this.consumers.set(conversationId, consumers) }
    consumers.add(consumer)
  }
  release(conversationId: string, consumer: string): Promise<void> {
    const consumers = this.consumers.get(conversationId)
    consumers?.delete(consumer)
    if (!consumers?.size) this.consumers.delete(conversationId)
    return this.lock(conversationId, async () => { this.loaded.get(conversationId)?.readers.delete(consumer); this.releaseIdle(conversationId) })
  }
  private releaseIdle(conversationId: string): void {
    if (!this.consumers.get(conversationId)?.size && !this.loaded.get(conversationId)?.activeExternalTools.size) this.loaded.delete(conversationId)
  }
  /** Optional derived maintenance never extends a durable append acknowledgement. */
  private checkpointLater(conversationId: string, state: Loaded): void {
    if (this.maintenance.has(conversationId)) return
    const added = state.sourceBytes - (state.checkpoint?.sourceBytes ?? 0)
    if (added < (state.checkpoint?.cacheBytes ?? this.segmentBytes)) return
    const cursor = state.projection.cursor, directory = this.folder(conversationId)
    const segments = state.segments.map(({ name, size }) => ({ name, size }))
    const temporary = path.join(directory, `.projection.${randomUUID()}.tmp`)
    let succeeded = false
    const work = (async () => {
      try {
        const checkpoint = await createExecutionCheckpointInWorker({ directory, conversationId, segments }, temporary)
        if (checkpoint.cursor !== cursor) throw new Error('派生检查点与固定事件游标不匹配')
        await this.lock(conversationId, async () => {
          const current = this.loaded.get(conversationId)
          if (current?.checkpoint && current.checkpoint.cursor > checkpoint.cursor) return
          await fs.rename(temporary, path.join(directory, EXECUTION_EVENT_CHECKPOINT))
          await syncDirectory(directory)
          if (current) current.checkpoint = checkpoint
        })
        succeeded = true
      } finally { await fs.rm(temporary, { force: true }) }
    })()
    this.maintenance.set(conversationId, work)
    void work.catch(error => { this.lastMaintenanceFailure = error instanceof Error ? error.message : String(error) })
      .finally(() => {
        if (this.maintenance.get(conversationId) === work) this.maintenance.delete(conversationId)
        const current = this.loaded.get(conversationId)
        if (succeeded && current) this.checkpointLater(conversationId, current)
      })
  }
  /** Explicit diagnostic drain; execution producers need only flushPending(). */
  async flushMaintenance(): Promise<void> {
    while (this.maintenance.size) await Promise.all([...this.maintenance.values()])
  }
  constructor(options: ExecutionEventStoreOptions) {
    this.directory = path.resolve(options.directory)
    this.segmentBytes = options.segmentBytes ?? 1024 * 1024
    this.inlineBytes = options.inlineBytes ?? 16 * 1024
    if (!Number.isSafeInteger(this.segmentBytes) || this.segmentBytes < 512 || !Number.isSafeInteger(this.inlineBytes) || this.inlineBytes < 1) throw new RangeError('事件存储大小限制无效')
  }
  private folder(conversationId: string) {
    if (!conversationId || conversationId.length > 512) throw new Error('会话标识无效')
    return path.join(this.directory, digest(conversationId))
  }
  private timingFile(conversationId: string, taskId: string): string {
    if (!taskId || taskId.length > 512) throw new Error('计时任务标识无效')
    return path.join(this.folder(conversationId), 'timing', `${digest(taskId)}.json`)
  }
  private timingLock<T>(conversationId: string, taskId: string, action: () => Promise<T>): Promise<T> {
    const filename = this.timingFile(conversationId, taskId)
    return serial(process.platform === 'win32' ? filename.toLowerCase() : filename, action)
  }
  private async readTimingUnlocked(conversationId: string, taskId: string): Promise<ExecutionTimingMark[]> {
    return this.timingTrace.read(this.timingFile(conversationId, taskId), conversationId, taskId)
  }

  /**
   * Append-idempotent diagnostic trace. Main persists renderer facts with their distinct clock identity.
   * Marks are buffered per file in memory and flushed with a single open + writeFile + handle.sync when
   * the buffer reaches TIMING_BATCH_MARKS, when the run terminates (`run.ended`/`save.finished`), or on
   * read; an awaited recordTiming resolves only after its mark is durable. The diagnostic file is
   * crash-atomic only at flush boundaries — pending marks may be lost on process kill; durability of the
   * event log itself is unchanged.
   */
  private readonly timingPending = new Map<string, { marks: ExecutionTimingMark[]; waiters: { resolve: () => void; reject: (error: unknown) => void }[]; scheduled: boolean }>()
  recordTiming(mark: ExecutionTimingMark): Promise<void> {
    return this.track(this.queueTiming(mark), 'timing')
  }
  private queueTiming(mark: ExecutionTimingMark): Promise<void> {
    if (!mark.markId || !mark.taskId || !['main', 'renderer'].includes(mark.process) || mark.clock !== 'performance.now'
      || !mark.clockInstanceId || !Number.isFinite(mark.monotonicMs) || mark.monotonicMs < 0
      || !Number.isFinite(mark.wallTimeMs) || mark.wallTimeMs < 0
      || mark.process === 'renderer' && (!Number.isFinite(mark.timeOriginMs) || mark.timeOriginMs! < 0)) return Promise.reject(new Error('计时标记无效'))
    const filename = this.timingFile(mark.conversationId, mark.taskId)
    const key = process.platform === 'win32' ? filename.toLowerCase() : filename
    let bucket = this.timingPending.get(key)
    if (!bucket) { bucket = { marks: [], waiters: [], scheduled: false }; this.timingPending.set(key, bucket) }
    bucket.marks.push(structuredClone(mark))
    return new Promise<void>((resolve, reject) => {
      bucket!.waiters.push({ resolve, reject })
      const hot = bucket!.marks.length >= 32 || mark.stage === 'run.ended'
      if (hot || !bucket!.scheduled) {
        bucket!.scheduled = true
        // setImmediate coalesces same-tick recorders into one flush; `hot` skips nothing — every mark still durable.
        setImmediate(() => { void this.flushTiming(mark.conversationId, mark.taskId).catch(() => {}) })
      }
    })
  }
  /** Drains buffered marks for this file with one fsync; resolves all waiters enqueued since the bucket opened. */
  private flushTiming(conversationId: string, taskId: string): Promise<void> {
    return this.timingLock(conversationId, taskId, async () => {
      const filename = this.timingFile(conversationId, taskId)
      const key = process.platform === 'win32' ? filename.toLowerCase() : filename
      const bucket = this.timingPending.get(key)
      if (!bucket || !bucket.marks.length) { if (bucket) bucket.scheduled = false; return }
      const drains = bucket.marks.splice(0, bucket.marks.length), waiters = bucket.waiters.splice(0, bucket.waiters.length)
      bucket.scheduled = bucket.marks.length > 0
      try {
        await this.timingTrace.appendBatch(filename, drains)
        for (const waiter of waiters) waiter.resolve()
      } catch (error) {
        for (const waiter of waiters) waiter.reject(error)
        throw error
      } finally {
        if (bucket.marks.length && !bucket.scheduled) {
          bucket.scheduled = true
          setImmediate(() => { void this.flushTiming(conversationId, taskId).catch(() => {}) })
        }
      }
    })
  }
  readTiming(conversationId: string, taskId: string): Promise<ExecutionTimingMark[]> {
    return this.timingLock(conversationId, taskId, async () => {
      const filename = this.timingFile(conversationId, taskId)
      const key = process.platform === 'win32' ? filename.toLowerCase() : filename
      const bucket = this.timingPending.get(key)
      if (bucket?.marks.length) {
        const drains = bucket.marks.splice(0, bucket.marks.length), waiters = bucket.waiters.splice(0, bucket.waiters.length)
        bucket.scheduled = false
        try {
          await this.timingTrace.appendBatch(filename, drains)
          for (const waiter of waiters) waiter.resolve()
        } catch (error) { for (const waiter of waiters) waiter.reject(error); throw error }
      }
      return structuredClone(await this.readTimingUnlocked(conversationId, taskId))
    })
  }
  private lock<T>(conversationId: string, action: () => Promise<T>) {
    const filename = this.folder(conversationId)
    return serial(process.platform === 'win32' ? filename.toLowerCase() : filename, action)
  }
  private async segmentNames(conversationId: string) {
    try { return (await fs.readdir(this.folder(conversationId))).filter(name => /^\d{16}\.events$/.test(name)).sort() }
    catch (error) { if (missing(error)) return []; throw error }
  }
  private async scan(conversationId: string, name: string, last: boolean): Promise<{ records: Stored[]; size: number }> {
    const filename = path.join(this.folder(conversationId), name)
    const stat = await fs.stat(filename), stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
    const cached = this.pages.get(filename)
    if (cached?.stamp === stamp) { this.pages.delete(filename); this.pages.set(filename, cached); return cached }
    const bytes = await fs.readFile(filename)
    const { records, size: offset } = decodeRecords(conversationId, bytes)
    if (offset !== bytes.length) {
      if (!last) throw new ExecutionEventStoreError('event-corrupt', '非末段事件日志不完整')
      const handle = await fs.open(filename, 'r+')
      try { await handle.truncate(offset); await handle.sync() } finally { await handle.close() }
    }
    const current = await fs.stat(filename)
    this.pages.delete(filename)
    this.pages.set(filename, { records, size: offset, stamp: `${current.size}:${current.mtimeMs}:${current.ctimeMs}` })
    while (this.pages.size > 2) this.pages.delete(this.pages.keys().next().value!)
    return { records, size: offset }
  }
  private async state(conversationId: string): Promise<Loaded> {
    const cached = this.loaded.get(conversationId)
    if (cached && (this.consumers.get(conversationId)?.size || cached.activeExternalTools.size)) return cached
    const names = await this.segmentNames(conversationId), tail = cached?.segments.at(-1)
    if (cached && names.length === cached.segments.length && (!tail || (names.at(-1) === tail.name && (await fs.stat(path.join(this.folder(conversationId), tail.name))).size === tail.size))) return cached
    const prefixes = await Promise.all(names.map(async name => ({ name, size: (await fs.stat(path.join(this.folder(conversationId), name))).size })))
    let state: Loaded
    if (prefixes.reduce((bytes, prefix) => bytes + prefix.size, 0) >= this.segmentBytes || await fs.access(path.join(this.folder(conversationId), EXECUTION_EVENT_CHECKPOINT)).then(() => true, error => { if (missing(error)) return false; throw error })) {
      // Only the fixed source prefixes cross this boundary. Old JSON/schema/fold work
      // and checkpoint encoding stay off Main; source bytes are still integrity-read.
      const restored = await restoreExecutionEventsInWorker({ directory: this.folder(conversationId), conversationId, segments: prefixes })
      for (const repair of restored.repairs) {
        const handle = await fs.open(path.join(this.folder(conversationId), repair.name), 'r+')
        try { await handle.truncate(repair.size); await handle.sync() } finally { await handle.close() }
      }
      state = { ...restored.facts, ...(restored.checkpoint ? { checkpoint: restored.checkpoint } : {}), readers: new Map() }
    } else {
      state = { ...emptyExecutionEventFacts(conversationId), readers: new Map() }
      for (const [index, name] of names.entries()) {
        const scanned = await this.scan(conversationId, name, index === names.length - 1)
        const first = scanned.records[0]?.event.sequence ?? Number(name.slice(0, 16))
        if (first !== Number(name.slice(0, 16))) throw new ExecutionEventStoreError('event-corrupt', '事件分段游标不匹配')
        const last = scanned.records.at(-1)?.event.sequence ?? state.projection.cursor
        replayExecutionSegment(state, { name, size: scanned.size, first, last }, scanned.records)
      }
    }
    this.loaded.set(conversationId, state)
    this.checkpointLater(conversationId, state)
    return state
  }
  private async blob(conversationId: string, text: string): Promise<ExecutionBlobRef> {
    const bytes = Buffer.from(text, 'utf8'), ref: ExecutionBlobRef = { id: digest(bytes), bytes: bytes.length, mime: 'text/plain;charset=utf-8' }
    const directory = path.join(this.folder(conversationId), 'blobs'), filename = path.join(directory, ref.id)
    await fs.mkdir(directory, { recursive: true })
    const temporary = path.join(directory, `.${ref.id}.${randomUUID()}.tmp`)
    const handle = await fs.open(temporary, 'wx')
    try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
    try {
      try { await fs.link(temporary, filename) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || digest(await fs.readFile(filename)) !== ref.id) throw error }
      await syncDirectory(directory)
    } finally { await fs.rm(temporary, { force: true }) }
    return ref
  }
  append(input: ExecutionEventInput): Promise<ExecutionEvent> { return this.batchAppend([input]).then(events => events[0]!) }
  /** One atomic record/fsync for a bounded batch. Individual append has the same durable acknowledgement contract. */
  batchAppend(inputs: readonly ExecutionEventInput[]): Promise<ExecutionEvent[]> { return this.track(this.appendBatch(inputs), 'event') }
  private async appendBatch(inputs: readonly ExecutionEventInput[]): Promise<ExecutionEvent[]> {
    if (!inputs.length || inputs.length > 5000) return Promise.reject(new RangeError('一次事件写入需要 1 至 5000 项'))
    const parsed = inputs.map(input => executionEventInputSchema.parse(input)) // Freeze and reject undeclared native/secret fields before yielding.
    const conversationId = parsed[0]!.conversationId
    if (parsed.some(input => input.conversationId !== conversationId)) return Promise.reject(new Error('一次写入只能属于一个会话'))
    return this.lock(conversationId, async () => {
      try {
      const state = await this.state(conversationId), pending: Stored[] = [], results: ExecutionEvent[] = []
      const receipts = new Map<string, { inputDigest: string; sequence: number }>(), newEvents = new Map<string, ExecutionEvent>()
      for (const input of parsed) {
        const inputDigest = digest(stable(input)), existing = receipts.get(input.eventId) ?? state.receipts.get(input.eventId)
        if (existing) {
          if (existing.inputDigest !== inputDigest) throw new ExecutionEventStoreError('event-id-conflict', '同一事件标识已用于不同载荷')
          const event = newEvents.get(input.eventId) ?? (await this.page(conversationId, state, existing.sequence - 1, 1)).events[0]!
          results.push(event); continue
        }
        const data: ExecutionEvent['data'] = { ...input.data }
        for (const field of ['text', ...executionDetailKeys] as const) {
          const value = data[field]
          if (value !== undefined && Buffer.byteLength(value, 'utf8') > this.inlineBytes) { data[`${field}Ref`] = await this.blob(conversationId, value); delete data[field] }
        }
        const event: ExecutionEvent = { ...input, sequence: state.projection.cursor + pending.length + 1, data }
        pending.push({ inputDigest, event }); newEvents.set(input.eventId, event); receipts.set(input.eventId, { inputDigest, sequence: event.sequence }); results.push(event)
      }
      if (!pending.length) return structuredClone(results)
      let plan: ExecutionProjectionPlan
      try { plan = prepareExecutionEvents(state.projection, pending.map(record => record.event)) }
      catch (error) { throw new ExecutionEventStoreError('event-item-conflict', (error as Error).message) }
      const payload = Buffer.from(JSON.stringify(pending), 'utf8')
      // The existing record format encodes its byte length as an unsigned 32-bit integer.
      if (payload.length > 0xffff_ffff) throw new RangeError('事件记录无法用当前 32 位长度字段编码')
      const header = Buffer.alloc(HEADER); MAGIC.copy(header); header.writeUInt32BE(payload.length, 8); header.writeUInt32BE((~payload.length) >>> 0, 12); createHash('sha256').update(payload).digest().copy(header, 16)
      const encoded = Buffer.concat([header, payload, COMMIT])
      await fs.mkdir(this.folder(conversationId), { recursive: true })
      let segment = state.segments.at(-1)
      if (!segment || (segment.size > 0 && segment.size + encoded.length > this.segmentBytes)) segment = { name: `${String(pending[0]!.event.sequence).padStart(16, '0')}.events`, size: 0, first: pending[0]!.event.sequence, last: state.projection.cursor }
      const filename = path.join(this.folder(conversationId), segment.name), handle = await fs.open(filename, 'a+')
      const before = (await handle.stat()).size
      try { await handle.writeFile(encoded); await handle.sync() }
      catch (error) {
        try {
          // Windows append handles cannot ftruncate; the same owner repairs the
          // failed append through a read/write handle before accepting another one.
          const repair = await fs.open(filename, 'r+')
          try { await repair.truncate(before); await repair.sync() } finally { await repair.close() }
        } catch (rollback) { throw new AggregateError([error, rollback], '事件日志未能恢复原追加边界') }
        throw error
      }
      finally { await handle.close() }
      await syncDirectory(this.folder(conversationId))
      await syncDirectory(this.directory)
      segment.size = before + encoded.length; segment.last = plan.cursor
      if (state.segments.at(-1) !== segment) state.segments.push(segment)
      state.sourceBytes += encoded.length
      applyExecutionProjectionOwned(state.projection, plan)
      for (const [owner, reader] of state.readers) {
        try { reader.apply(plan) } catch { state.readers.delete(owner) } // A display cache cannot fail a durable append.
      }
      for (const [id, receipt] of receipts) state.receipts.set(id, receipt)
      observeExecutionExternalTools(state, pending.map(record => record.event))
      for (const record of pending) for (const field of ['text', ...executionDetailKeys] as const) {
        const ref = record.event.data[`${field}Ref`]
        if (ref) state.blobs.set(ref.id, ref)
      }
      for (const record of pending) for (const listener of this.listeners) {
        try { listener(structuredClone(record.event)) } catch { /* A projection cannot fail durable event storage. */ }
      }
      this.checkpointLater(conversationId, state)
      return structuredClone(results)
      } catch (error) {
        // A frame may already be durable when close/directory sync fails. The
        // next operation must rebuild its head from that real committed prefix.
        this.loaded.delete(conversationId)
        throw error
      } finally { this.releaseIdle(conversationId) }
    })
  }
  private async page(conversationId: string, state: Loaded, after: number, limit: number): Promise<ExecutionEventPage> {
    const events: ExecutionEvent[] = []
    for (const [index, segment] of state.segments.entries()) {
      if (segment.last <= after) continue
      const scanned = await this.scan(conversationId, segment.name, index === state.segments.length - 1)
      for (const record of scanned.records) if (record.event.sequence > after && events.length < limit) events.push(record.event)
      if (events.length >= limit) break
    }
    const cursor = events.at(-1)?.sequence ?? after
    return { events: structuredClone(events), cursor, hasMore: cursor < state.projection.cursor }
  }
  readPage(input: { conversationId: string; after?: number; limit?: number }): Promise<ExecutionEventPage> {
    const after = input.after ?? 0, limit = input.limit ?? 200
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) return Promise.reject(new RangeError('事件分页参数无效'))
    return this.lock(input.conversationId, async () => {
      try {
        const state = await this.state(input.conversationId)
        if (after > state.projection.cursor) throw new RangeError('事件游标超出当前会话')
        return await this.page(input.conversationId, state, after, limit)
      } finally { this.releaseIdle(input.conversationId) }
    })
  }
  /** Read a durable event identity without replaying its source action. */
  findEvent(conversationId: string, eventId: string): Promise<ExecutionEvent | null> {
    return this.lock(conversationId, async () => {
      try {
        const state = await this.state(conversationId)
        const receipt = state.receipts.get(eventId)
        return receipt ? (await this.page(conversationId, state, receipt.sequence - 1, 1)).events[0] ?? null : null
      } finally { this.releaseIdle(conversationId) }
    })
  }
  /** Searches immutable events (including superseded snapshots), never the execution machinery. */
  async search(input: ExecutionEventSearchInput): Promise<ExecutionEventSearchPage> {
    const query = input.query.trim().toLocaleLowerCase(), after = input.after ?? 0, limit = input.limit ?? 20
    if (!query || query.length > 500 || !Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return Promise.reject(new RangeError('历史搜索参数无效'))
    const snapshot = await this.lock(input.conversationId, async () => {
      try {
      const state = await this.state(input.conversationId)
      if (after > state.projection.cursor) throw new RangeError('事件游标超出当前会话')
      return { cursor: state.projection.cursor, segments: state.segments.map(segment => ({ ...segment })),
        blobs: new Map([...state.blobs].map(([id, ref]) => [id, { ...ref }])) }
      } finally { this.releaseIdle(input.conversationId) }
    })
    const hits: ExecutionEventSearchPage['hits'] = []
    let cursor = after, scanned = 0
    segments: for (const segment of snapshot.segments) {
      if (scanned === 2000 || hits.length === limit) break
      if (segment.last <= after) continue
      for (const { event } of await this.readPrefix(input.conversationId, segment)) {
        if (event.sequence <= after || event.sequence > snapshot.cursor) continue
        if (scanned === 2000 || hits.length === limit) break segments
        cursor = event.sequence; scanned++
        const values = [event.data.label, event.data.toolName, event.data.documentName, event.data.targetLabel, event.data.status].filter((value): value is string => value !== undefined)
        for (const field of ['text', ...executionDetailKeys] as const) {
          const ref = event.data[`${field}Ref`]
          if (ref) values.push(Buffer.from(await this.blobBytes(input.conversationId, snapshot, ref)).toString('utf8'))
          else if (event.data[field] !== undefined) values.push(event.data[field]!)
        }
        const text = values.find(value => value.toLocaleLowerCase().includes(query))
        if (text !== undefined) { const index = text.toLocaleLowerCase().indexOf(query); hits.push({ event, excerpt: text.slice(Math.max(0, index - 80), index + query.length + 160) }) }
      }
    }
    return { hits, cursor, hasMore: cursor < snapshot.cursor }
  }
  /** The captured prefix was durable before releasing the conversation lock; later appends are outside this read. */
  private async readPrefix(conversationId: string, segment: Segment): Promise<Stored[]> {
    const handle = await fs.open(path.join(this.folder(conversationId), segment.name), 'r')
    const bytes = Buffer.alloc(segment.size)
    try {
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) throw new ExecutionEventStoreError('event-corrupt', '已提交事件前缀不完整')
        offset += bytesRead
      }
    } finally { await handle.close() }
    const decoded = decodeRecords(conversationId, bytes)
    if (decoded.size !== bytes.length) throw new ExecutionEventStoreError('event-corrupt', '已提交事件前缀不完整')
    return decoded.records
  }
  private async blobBytes(conversationId: string, state: { blobs: ReadonlyMap<string, ExecutionBlobRef> }, ref: ExecutionBlobRef): Promise<Uint8Array> {
    const owner = state.blobs.get(ref.id)
    if (!owner || owner.bytes !== ref.bytes || owner.mime !== ref.mime) throw new ExecutionEventStoreError('blob-not-owned', '输出引用不属于当前会话')
    const filename = path.join(this.folder(conversationId), 'blobs', ref.id)
    if ((await fs.lstat(filename)).isSymbolicLink()) throw new ExecutionEventStoreError('blob-corrupt', '输出引用不是普通文件')
    const bytes = await fs.readFile(filename)
    if (bytes.length !== ref.bytes || digest(bytes) !== ref.id) throw new ExecutionEventStoreError('blob-corrupt', '输出内容校验失败')
    return new Uint8Array(bytes)
  }
  snapshot(conversationId: string): Promise<ExecutionProjection> {
    return this.lock(conversationId, async () => {
      try { return structuredClone((await this.state(conversationId)).projection) }
      finally { this.releaseIdle(conversationId) }
    })
  }
  private readView<T>(conversationId: string, owner: string, messages: readonly ConversationMessage[], read: (reader: ExecutionTimelineReadModel) => T): Promise<T> {
    return this.lock(conversationId, async () => {
      try {
        const state = await this.state(conversationId)
        let reader = state.readers.get(owner)
        if (!reader) { reader = new ExecutionTimelineReadModel(state.projection, messages); state.readers.set(owner, reader) }
        else reader.setMessages(messages)
        return structuredClone(read(reader))
      } finally { this.releaseIdle(conversationId) }
    })
  }
  /** Explicit display windows; the complete snapshot/event history APIs remain available. */
  timelinePage(conversationId: string, owner: string, messages: readonly ConversationMessage[], input: ExecutionTimelinePageRequest = {}) {
    return this.readView(conversationId, owner, messages, reader => reader.entryPage(input))
  }
  timelineGroup(conversationId: string, owner: string, messages: readonly ConversationMessage[], input: ExecutionTimelineGroupRequest) {
    return this.readView(conversationId, owner, messages, reader => reader.groupPage(input))
  }
  timelineBody(conversationId: string, owner: string, messages: readonly ConversationMessage[], input: ExecutionTimelineBodyRequest) {
    return this.readView(conversationId, owner, messages, reader => reader.readBody(input))
  }
  async readBlob(conversationId: string, input: ExecutionBlobRef): Promise<Uint8Array> {
    const ref = executionBlobRefSchema.parse(input)
    return this.lock(conversationId, async () => {
      try { return await this.blobBytes(conversationId, await this.state(conversationId), ref) }
      finally { this.releaseIdle(conversationId) }
    })
  }
}
