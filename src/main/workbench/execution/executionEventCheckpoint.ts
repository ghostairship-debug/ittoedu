import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ExecutionBlobRef, ExecutionProjection } from '../../../shared/workbench/executionEvents'
import {
  decodeExecutionRecords, emptyExecutionEventFacts, ExecutionEventStoreError, replayExecutionRecords,
  type ExecutionEventFacts, type ExecutionEventSegment,
} from './executionEventLog'

const MAGIC = Buffer.from('G20ECP01'), HEADER = 48
export const EXECUTION_EVENT_CHECKPOINT = 'projection.checkpoint'
export interface ExecutionEventCheckpointMeta { cursor: number; sourceBytes: number; cacheBytes: number }
export interface ExecutionEventPrefix { name: string; size: number }
export interface ExecutionEventRestoreInput { directory: string; conversationId: string; segments: ExecutionEventPrefix[] }
interface Checkpoint {
  version: 1; conversationId: string; cursor: number
  segments: (ExecutionEventSegment & { hash: string })[]
  projection: ExecutionProjection; receipts: [string, { inputDigest: string; sequence: number }][]
  blobs: [string, ExecutionBlobRef][]; activeExternalTools: string[]; endedRuns: string[]
}
export interface RestoredExecutionEvents {
  facts: ExecutionEventFacts; checkpoint?: ExecutionEventCheckpointMeta
  repairs: { name: string; size: number; before: number }[]
  /** Observability for focused recovery checks; source integrity hashing is still required. */
  replayedEvents: number; verifiedPrefixBytes: number
}
async function prefixBytes(directory: string, prefix: ExecutionEventPrefix, start = 0): Promise<Buffer> {
  const handle = await fs.open(path.join(directory, prefix.name), 'r')
  try {
    const bytes = Buffer.alloc(prefix.size - start)
    let read = 0
    while (read < bytes.length) {
      const { bytesRead } = await handle.read(bytes, read, bytes.length - read, start + read)
      if (!bytesRead) throw new ExecutionEventStoreError('event-corrupt', '事件已提交前缀被截断')
      read += bytesRead
    }
    return bytes
  } finally { await handle.close() }
}
/** Hash the source without constructing old JSON/event objects. */
async function prefixHash(directory: string, prefix: ExecutionEventPrefix): Promise<string> {
  const handle = await fs.open(path.join(directory, prefix.name), 'r'), hash = createHash('sha256')
  try {
    const chunk = Buffer.alloc(Math.min(prefix.size, 256 * 1024))
    let offset = 0
    while (offset < prefix.size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, prefix.size - offset), offset)
      if (!bytesRead) throw new Error('事件前缀已变化')
      hash.update(chunk.subarray(0, bytesRead)); offset += bytesRead
    }
    return hash.digest('hex')
  } finally { await handle.close() }
}
async function readCheckpoint(input: ExecutionEventRestoreInput): Promise<{ value: Checkpoint; bytes: number; verified: number } | null> {
  try {
    const bytes = await fs.readFile(path.join(input.directory, EXECUTION_EVENT_CHECKPOINT))
    if (bytes.length < HEADER || !bytes.subarray(0, 8).equals(MAGIC)) return null
    const length = bytes.readUInt32BE(8)
    if (bytes.readUInt32BE(12) !== ((~length) >>> 0) || bytes.length !== HEADER + length) return null
    const payload = bytes.subarray(HEADER)
    if (!createHash('sha256').update(payload).digest().equals(bytes.subarray(16, HEADER))) return null
    const value = JSON.parse(payload.toString('utf8')) as Checkpoint
    if (value.version !== 1 || value.conversationId !== input.conversationId || !Number.isSafeInteger(value.cursor) || value.cursor < 0
      || value.projection?.conversationId !== input.conversationId || value.projection.cursor !== value.cursor || !Array.isArray(value.projection.items)
      || !Array.isArray(value.segments) || value.segments.length > input.segments.length || !Array.isArray(value.receipts)
      || !Array.isArray(value.blobs) || !Array.isArray(value.activeExternalTools) || !Array.isArray(value.endedRuns)) return null
    let cursor = 0, verified = 0
    for (const [index, prefix] of value.segments.entries()) {
      const source = input.segments[index]
      if (!source || source.name !== prefix.name || !Number.isSafeInteger(prefix.size) || prefix.size < 0 || prefix.size > source.size
        || !/^[a-f0-9]{64}$/.test(prefix.hash) || prefix.first !== Number(prefix.name.slice(0, 16)) || prefix.first !== cursor + 1
        || !Number.isSafeInteger(prefix.last) || prefix.last < cursor || index < value.segments.length - 1 && prefix.size !== source.size) return null
      if (await prefixHash(input.directory, prefix) !== prefix.hash) return null
      cursor = prefix.last; verified += prefix.size
    }
    if (cursor !== value.cursor || value.receipts.length !== value.cursor) return null
    return { value, bytes: bytes.length, verified }
  } catch { return null } // Derived cache is disposable; the source log decides recovery.
}
/** Fixed durable source prefixes only. This routine never writes or repairs the log. */
export async function restoreExecutionEvents(input: ExecutionEventRestoreInput): Promise<RestoredExecutionEvents> {
  const cached = await readCheckpoint(input), facts = emptyExecutionEventFacts(input.conversationId)
  if (cached) {
    facts.projection = cached.value.projection
    facts.segments = cached.value.segments.map(({ hash: _hash, ...segment }) => segment)
    facts.receipts = new Map(cached.value.receipts); facts.blobs = new Map(cached.value.blobs)
    facts.activeExternalTools = new Set(cached.value.activeExternalTools); facts.endedRuns = new Set(cached.value.endedRuns)
    facts.sourceBytes = cached.verified
  }
  const repairs: RestoredExecutionEvents['repairs'] = []
  let replayedEvents = 0
  for (const [index, prefix] of input.segments.entries()) {
    const covered = facts.segments[index]
    if (covered && covered.size === prefix.size) continue
    const start = covered?.size ?? 0, bytes = await prefixBytes(input.directory, prefix, start)
    const scanned = decodeExecutionRecords(input.conversationId, bytes), size = start + scanned.size
    if (scanned.size !== bytes.length) {
      if (index !== input.segments.length - 1) throw new ExecutionEventStoreError('event-corrupt', '非末段事件日志不完整')
      repairs.push({ name: prefix.name, size, before: prefix.size })
    }
    const first = covered?.first ?? scanned.records[0]?.event.sequence ?? Number(prefix.name.slice(0, 16))
    if (first !== Number(prefix.name.slice(0, 16))) throw new ExecutionEventStoreError('event-corrupt', '事件分段游标不匹配')
    replayExecutionRecords(facts, scanned.records); replayedEvents += scanned.records.length
    const segment = { name: prefix.name, first, last: facts.projection.cursor, size }
    if (covered) facts.segments[index] = segment
    else facts.segments.push(segment)
    facts.sourceBytes += size - start
  }
  return { facts, ...(cached ? { checkpoint: { cursor: cached.value.cursor, sourceBytes: cached.verified, cacheBytes: cached.bytes } } : {}), repairs,
    replayedEvents, verifiedPrefixBytes: cached?.verified ?? 0 }
}
export async function writeExecutionCheckpoint(input: ExecutionEventRestoreInput, temporary: string): Promise<ExecutionEventCheckpointMeta> {
  const restored = await restoreExecutionEvents(input)
  if (restored.repairs.length) throw new ExecutionEventStoreError('event-corrupt', '检查点只能覆盖已提交事件前缀')
  const facts = restored.facts, segments: Checkpoint['segments'] = []
  for (const segment of facts.segments) segments.push({ ...segment, hash: await prefixHash(input.directory, segment) })
  const value: Checkpoint = { version: 1, conversationId: input.conversationId, cursor: facts.projection.cursor, segments,
    projection: facts.projection, receipts: [...facts.receipts], blobs: [...facts.blobs],
    activeExternalTools: [...facts.activeExternalTools], endedRuns: [...facts.endedRuns] }
  const payload = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(HEADER)
  if (payload.length > 0xffff_ffff) throw new RangeError('事件检查点无法用当前长度字段编码')
  MAGIC.copy(header); header.writeUInt32BE(payload.length, 8); header.writeUInt32BE((~payload.length) >>> 0, 12)
  createHash('sha256').update(payload).digest().copy(header, 16)
  const handle = await fs.open(temporary, 'wx')
  try { await handle.writeFile(header); await handle.writeFile(payload); await handle.sync() } finally { await handle.close() }
  return { cursor: facts.projection.cursor, sourceBytes: facts.sourceBytes, cacheBytes: HEADER + payload.length }
}
