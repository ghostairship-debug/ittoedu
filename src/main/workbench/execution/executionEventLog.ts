import { createHash } from 'node:crypto'
import {
  emptyExecutionProjection, executionDetailKeys, executionEventSchema, prepareExecutionEvents, applyExecutionProjectionOwned,
  type ExecutionBlobRef, type ExecutionEvent, type ExecutionProjection,
} from '../../../shared/workbench/executionEvents'

export const EVENT_MAGIC = Buffer.from('G20EVT01'), EVENT_COMMIT = Buffer.from('G20ECMIT'), EVENT_HEADER = 48
export interface StoredExecutionEvent { inputDigest: string; event: ExecutionEvent }
export interface ExecutionEventSegment { name: string; size: number; first: number; last: number }
export interface ExecutionEventFacts {
  segments: ExecutionEventSegment[]; projection: ExecutionProjection
  receipts: Map<string, { inputDigest: string; sequence: number }>
  blobs: Map<string, ExecutionBlobRef>; activeExternalTools: Set<string>; endedRuns: Set<string>
  sourceBytes: number
}
export class ExecutionEventStoreError extends Error {
  constructor(readonly code: 'event-corrupt' | 'event-id-conflict' | 'event-item-conflict' | 'blob-not-owned' | 'blob-corrupt', message: string) { super(message); this.name = 'ExecutionEventStoreError' }
}
export function decodeExecutionRecords(conversationId: string, bytes: Buffer): { records: StoredExecutionEvent[]; size: number } {
  const records: StoredExecutionEvent[] = []
  let offset = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < EVENT_HEADER) break
    const header = bytes.subarray(offset, offset + EVENT_HEADER), length = header.readUInt32BE(8)
    if (!header.subarray(0, 8).equals(EVENT_MAGIC) || header.readUInt32BE(12) !== ((~length) >>> 0)) throw new ExecutionEventStoreError('event-corrupt', '事件记录头损坏')
    const end = offset + EVENT_HEADER + length + EVENT_COMMIT.length
    if (end > bytes.length) break
    const payload = bytes.subarray(offset + EVENT_HEADER, end - EVENT_COMMIT.length)
    if (!bytes.subarray(end - EVENT_COMMIT.length, end).equals(EVENT_COMMIT) || !createHash('sha256').update(payload).digest().equals(header.subarray(16))) throw new ExecutionEventStoreError('event-corrupt', '完整事件记录校验失败')
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
  return { records, size: offset }
}
export function emptyExecutionEventFacts(conversationId: string): ExecutionEventFacts {
  return { segments: [], projection: emptyExecutionProjection(conversationId), receipts: new Map(), blobs: new Map(), activeExternalTools: new Set(), endedRuns: new Set(), sourceBytes: 0 }
}
export function observeExecutionExternalTools(state: ExecutionEventFacts, events: readonly ExecutionEvent[]): void {
  for (const event of events) {
    if (event.type === 'run.end' || event.type === 'run.state' && ['completed', 'failed', 'stopped', 'partial', 'interrupted', 'cancelled'].includes(event.data.status ?? '')) {
      state.endedRuns.add(event.runId)
      const prefix = `${JSON.stringify([event.runId]).slice(0, -1)},`
      for (const key of state.activeExternalTools) if (key.startsWith(prefix)) state.activeExternalTools.delete(key)
    }
    if (event.source !== 'external-mcp' || event.type !== 'tool' || event.data.status === undefined) continue
    const key = JSON.stringify([event.runId, event.itemId])
    if (!state.endedRuns.has(event.runId) && ['running', 'executing', 'pending', 'queued', 'stopping'].includes(event.data.status)) state.activeExternalTools.add(key)
    else state.activeExternalTools.delete(key)
  }
}
/** The same recovery rules serve the short Main path and long worker path. */
export function replayExecutionRecords(state: ExecutionEventFacts, records: readonly StoredExecutionEvent[]): void {
  let expected = state.projection.cursor
  for (const record of records) {
    if (state.receipts.has(record.event.eventId) || record.event.sequence !== ++expected) throw new ExecutionEventStoreError('event-corrupt', '事件身份重复或游标不连续')
    state.receipts.set(record.event.eventId, { inputDigest: record.inputDigest, sequence: record.event.sequence })
    for (const field of ['text', ...executionDetailKeys] as const) {
      const ref = record.event.data[`${field}Ref`]
      if (ref) state.blobs.set(ref.id, ref)
    }
  }
  const events = records.map(record => record.event)
  try { applyExecutionProjectionOwned(state.projection, prepareExecutionEvents(state.projection, events)) }
  catch (error) { throw new ExecutionEventStoreError('event-corrupt', (error as Error).message) }
  observeExecutionExternalTools(state, events)
}
export function replayExecutionSegment(state: ExecutionEventFacts, segment: ExecutionEventSegment, records: readonly StoredExecutionEvent[]): void {
  replayExecutionRecords(state, records)
  state.segments.push(segment); state.sourceBytes += segment.size
}
