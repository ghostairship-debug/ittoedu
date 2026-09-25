import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ImageJobTimingMark } from '../../../shared/workbench/images'
import {
  emptyExecutionProjection, executionDetailKeys, executionBlobRefSchema, executionEventInputSchema, executionEventSchema, foldExecutionEvents,
  type ExecutionEventSearchInput, type ExecutionEventSearchPage, type ExecutionBlobRef, type ExecutionEvent, type ExecutionEventInput, type ExecutionEventPage, type ExecutionProjection,
} from '../../../shared/workbench/executionEvents'

const MAGIC = Buffer.from('G20EVT01'), COMMIT = Buffer.from('G20ECMIT'), HEADER = 48, MAX_RECORD = 64 * 1024 * 1024
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
interface Stored { inputDigest: string; event: ExecutionEvent }
interface Segment { name: string; size: number; first: number; last: number }
interface Loaded {
  segments: Segment[]; projection: ExecutionProjection
  receipts: Map<string, { inputDigest: string; sequence: number }>
  blobs: Map<string, ExecutionBlobRef>
}
export class ExecutionEventStoreError extends Error {
  constructor(readonly code: 'event-corrupt' | 'event-id-conflict' | 'event-item-conflict' | 'blob-not-owned' | 'blob-corrupt', message: string) { super(message); this.name = 'ExecutionEventStoreError' }
}
export interface ExecutionEventStoreOptions { directory: string; segmentBytes?: number; inlineBytes?: number }

/** A durable fact log, not a Run/Conversation owner. It has no execution callbacks or recovery replay hooks. */
export class ExecutionEventStore {
  private readonly directory: string
  private readonly segmentBytes: number
  private readonly inlineBytes: number
  private readonly loaded = new Map<string, Loaded>()
  // At most two parsed segments; old pages remain on disk and are revalidated on change.
  private readonly pages = new Map<string, { stamp: string; records: Stored[]; size: number }>()
  private readonly listeners = new Set<(event: ExecutionEvent) => void>()
  /** Durable append observation only; observers never participate in the acknowledgement. */
  subscribe(listener: (event: ExecutionEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
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
    let raw: string
    try { raw = await fs.readFile(this.timingFile(conversationId, taskId), 'utf8') }
    catch (error) { if (missing(error)) return []; throw error }
    const stored: unknown = JSON.parse(raw)
    if (!stored || typeof stored !== 'object' || (stored as { version?: unknown }).version !== 1
      || (stored as { conversationId?: unknown }).conversationId !== conversationId
      || (stored as { taskId?: unknown }).taskId !== taskId || !Array.isArray((stored as { marks?: unknown }).marks)) throw new Error('计时记录无效')
    return (stored as { marks: ExecutionTimingMark[] }).marks
  }
  /** Append-idempotent diagnostic trace. Main persists renderer facts with their distinct clock identity. */
  recordTiming(mark: ExecutionTimingMark): Promise<void> {
    return this.timingLock(mark.conversationId, mark.taskId, async () => {
      if (!mark.markId || !mark.taskId || !['main', 'renderer'].includes(mark.process) || mark.clock !== 'performance.now'
        || !mark.clockInstanceId || !Number.isFinite(mark.monotonicMs) || mark.monotonicMs < 0
        || !Number.isFinite(mark.wallTimeMs) || mark.wallTimeMs < 0
        || mark.process === 'renderer' && (!Number.isFinite(mark.timeOriginMs) || mark.timeOriginMs! < 0)) throw new Error('计时标记无效')
      const marks = await this.readTimingUnlocked(mark.conversationId, mark.taskId)
      const existing = marks.find(value => value.markId === mark.markId)
      if (existing) {
        if (stable(existing) !== stable(mark)) throw new Error('计时标记身份冲突')
        return
      }
      if (marks.length >= 2048) throw new Error('计时标记数量超限')
      const filename = this.timingFile(mark.conversationId, mark.taskId), directory = path.dirname(filename)
      await fs.mkdir(directory, { recursive: true })
      const temporary = `${filename}.${randomUUID()}.tmp`
      try {
        const handle = await fs.open(temporary, 'wx')
        try { await handle.writeFile(JSON.stringify({ version: 1, conversationId: mark.conversationId, taskId: mark.taskId,
          marks: [...marks, structuredClone(mark)] })); await handle.sync() } finally { await handle.close() }
        await fs.rename(temporary, filename)
        await syncDirectory(directory)
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    })
  }
  readTiming(conversationId: string, taskId: string): Promise<ExecutionTimingMark[]> {
    return this.timingLock(conversationId, taskId, () => this.readTimingUnlocked(conversationId, taskId).then(marks => structuredClone(marks)))
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
    const records: Stored[] = []
    let offset = 0
    while (offset < bytes.length) {
      if (bytes.length - offset < HEADER) break
      const header = bytes.subarray(offset, offset + HEADER), length = header.readUInt32BE(8)
      if (!header.subarray(0, 8).equals(MAGIC) || length > MAX_RECORD || header.readUInt32BE(12) !== ((~length) >>> 0)) throw new ExecutionEventStoreError('event-corrupt', '事件记录头损坏')
      const end = offset + HEADER + length + COMMIT.length
      if (end > bytes.length) break
      const payload = bytes.subarray(offset + HEADER, end - COMMIT.length)
      if (!bytes.subarray(end - COMMIT.length, end).equals(COMMIT) || !createHash('sha256').update(payload).digest().equals(header.subarray(16))) throw new ExecutionEventStoreError('event-corrupt', '完整事件记录校验失败')
      try {
        const decoded: unknown = JSON.parse(payload.toString('utf8'))
        if (!Array.isArray(decoded) || !decoded.length) throw new Error('Empty record')
        for (const input of decoded) {
          if (!input || typeof input !== 'object' || typeof input.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.inputDigest)) throw new Error('Invalid record')
          const event = executionEventSchema.parse(input.event)
          if (event.conversationId !== conversationId) throw new Error('Wrong conversation')
          records.push({ inputDigest: input.inputDigest, event })
        }
      } catch (error) { throw new ExecutionEventStoreError('event-corrupt', `完整事件记录不可读取：${error instanceof Error ? error.message : String(error)}`) }
      offset = end
    }
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
    const names = await this.segmentNames(conversationId), cached = this.loaded.get(conversationId), tail = cached?.segments.at(-1)
    if (cached && names.length === cached.segments.length && (!tail || (names.at(-1) === tail.name && (await fs.stat(path.join(this.folder(conversationId), tail.name))).size === tail.size))) return cached
    const state: Loaded = { segments: [], projection: emptyExecutionProjection(conversationId), receipts: new Map(), blobs: new Map() }
    for (const [index, name] of names.entries()) {
      const scanned = await this.scan(conversationId, name, index === names.length - 1)
      const first = scanned.records[0]?.event.sequence ?? Number(name.slice(0, 16))
      if (first !== Number(name.slice(0, 16))) throw new ExecutionEventStoreError('event-corrupt', '事件分段游标不匹配')
      let expected = state.projection.cursor
      for (const record of scanned.records) {
        if (state.receipts.has(record.event.eventId) || record.event.sequence !== ++expected) throw new ExecutionEventStoreError('event-corrupt', '事件身份重复或游标不连续')
        state.receipts.set(record.event.eventId, { inputDigest: record.inputDigest, sequence: record.event.sequence })
        for (const field of ['text', ...executionDetailKeys] as const) {
          const ref = record.event.data[`${field}Ref`]
          if (ref) state.blobs.set(ref.id, ref)
        }
      }
      try { state.projection = foldExecutionEvents(state.projection, scanned.records.map(record => record.event)) }
      catch (error) { throw new ExecutionEventStoreError('event-corrupt', (error as Error).message) }
      state.segments.push({ name, size: scanned.size, first, last: state.projection.cursor })
    }
    this.loaded.set(conversationId, state)
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
  async batchAppend(inputs: readonly ExecutionEventInput[]): Promise<ExecutionEvent[]> {
    if (!inputs.length || inputs.length > 5000) return Promise.reject(new RangeError('一次事件写入需要 1 至 5000 项'))
    const parsed = inputs.map(input => executionEventInputSchema.parse(input)) // Freeze and reject undeclared native/secret fields before yielding.
    const conversationId = parsed[0]!.conversationId
    if (parsed.some(input => input.conversationId !== conversationId)) return Promise.reject(new Error('一次写入只能属于一个会话'))
    return this.lock(conversationId, async () => {
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
      let projection: ExecutionProjection
      try { projection = foldExecutionEvents(state.projection, pending.map(record => record.event)) }
      catch (error) { throw new ExecutionEventStoreError('event-item-conflict', (error as Error).message) }
      const payload = Buffer.from(JSON.stringify(pending), 'utf8')
      if (payload.length > MAX_RECORD) throw new RangeError('事件批次超过支持大小')
      const header = Buffer.alloc(HEADER); MAGIC.copy(header); header.writeUInt32BE(payload.length, 8); header.writeUInt32BE((~payload.length) >>> 0, 12); createHash('sha256').update(payload).digest().copy(header, 16)
      const encoded = Buffer.concat([header, payload, COMMIT])
      await fs.mkdir(this.folder(conversationId), { recursive: true })
      let segment = state.segments.at(-1)
      if (!segment || (segment.size > 0 && segment.size + encoded.length > this.segmentBytes)) segment = { name: `${String(pending[0]!.event.sequence).padStart(16, '0')}.events`, size: 0, first: pending[0]!.event.sequence, last: state.projection.cursor }
      const filename = path.join(this.folder(conversationId), segment.name), handle = await fs.open(filename, 'a+')
      const before = (await handle.stat()).size
      try { await handle.writeFile(encoded); await handle.sync() }
      catch (error) { await handle.truncate(before); await handle.sync(); throw error }
      finally { await handle.close() }
      await syncDirectory(this.folder(conversationId))
      await syncDirectory(this.directory)
      segment.size = before + encoded.length; segment.last = projection.cursor
      if (state.segments.at(-1) !== segment) state.segments.push(segment)
      state.projection = projection; for (const [id, receipt] of receipts) state.receipts.set(id, receipt)
      for (const record of pending) for (const field of ['text', ...executionDetailKeys] as const) {
        const ref = record.event.data[`${field}Ref`]
        if (ref) state.blobs.set(ref.id, ref)
      }
      for (const record of pending) for (const listener of this.listeners) {
        try { listener(structuredClone(record.event)) } catch { /* A projection cannot fail durable event storage. */ }
      }
      return structuredClone(results)
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
      const state = await this.state(input.conversationId)
      if (after > state.projection.cursor) throw new RangeError('事件游标超出当前会话')
      return this.page(input.conversationId, state, after, limit)
    })
  }
  /** Read a durable event identity without replaying its source action. */
  findEvent(conversationId: string, eventId: string): Promise<ExecutionEvent | null> {
    return this.lock(conversationId, async () => {
      const state = await this.state(conversationId)
      const receipt = state.receipts.get(eventId)
      return receipt ? (await this.page(conversationId, state, receipt.sequence - 1, 1)).events[0] ?? null : null
    })
  }
  /** Searches immutable events (including superseded snapshots), never the execution machinery. */
  search(input: ExecutionEventSearchInput): Promise<ExecutionEventSearchPage> {
    const query = input.query.trim().toLocaleLowerCase(), after = input.after ?? 0, limit = input.limit ?? 20
    if (!query || query.length > 500 || !Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return Promise.reject(new RangeError('历史搜索参数无效'))
    return this.lock(input.conversationId, async () => {
      const state = await this.state(input.conversationId)
      if (after > state.projection.cursor) throw new RangeError('事件游标超出当前会话')
      const hits: ExecutionEventSearchPage['hits'] = []
      let cursor = after, scanned = 0
      while (cursor < state.projection.cursor && scanned < 2000 && hits.length < limit) {
        const page = await this.page(input.conversationId, state, cursor, Math.min(200, 2000 - scanned))
        for (const event of page.events) {
          cursor = event.sequence; scanned++
          const values = [event.data.label, event.data.toolName, event.data.documentName, event.data.targetLabel, event.data.status].filter((value): value is string => value !== undefined)
          for (const field of ['text', ...executionDetailKeys] as const) {
            const ref = event.data[`${field}Ref`]
            if (ref) values.push(Buffer.from(await this.blobBytes(input.conversationId, state, ref)).toString('utf8'))
            else if (event.data[field] !== undefined) values.push(event.data[field]!)
          }
          const text = values.find(value => value.toLocaleLowerCase().includes(query))
          if (text !== undefined) { const index = text.toLocaleLowerCase().indexOf(query); hits.push({ event, excerpt: text.slice(Math.max(0, index - 80), index + query.length + 160) }) }
          if (hits.length === limit) break
        }
      }
      return { hits, cursor, hasMore: cursor < state.projection.cursor }
    })
  }
  private async blobBytes(conversationId: string, state: Loaded, ref: ExecutionBlobRef): Promise<Uint8Array> {
    const owner = state.blobs.get(ref.id)
    if (!owner || owner.bytes !== ref.bytes || owner.mime !== ref.mime) throw new ExecutionEventStoreError('blob-not-owned', '输出引用不属于当前会话')
    const filename = path.join(this.folder(conversationId), 'blobs', ref.id)
    if ((await fs.lstat(filename)).isSymbolicLink()) throw new ExecutionEventStoreError('blob-corrupt', '输出引用不是普通文件')
    const bytes = await fs.readFile(filename)
    if (bytes.length !== ref.bytes || digest(bytes) !== ref.id) throw new ExecutionEventStoreError('blob-corrupt', '输出内容校验失败')
    return new Uint8Array(bytes)
  }
  snapshot(conversationId: string): Promise<ExecutionProjection> { return this.lock(conversationId, async () => structuredClone((await this.state(conversationId)).projection)) }
  async readBlob(conversationId: string, input: ExecutionBlobRef): Promise<Uint8Array> {
    const ref = executionBlobRefSchema.parse(input)
    return this.lock(conversationId, async () => {
      return this.blobBytes(conversationId, await this.state(conversationId), ref)
    })
  }
}
