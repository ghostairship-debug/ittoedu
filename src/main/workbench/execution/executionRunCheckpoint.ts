import { createHash } from 'node:crypto'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type RunStateChange = { kind: 'replace'; value: Json }
  | { kind: 'object'; fields: Record<string, RunStateChange>; remove: string[] }
  | { kind: 'array'; length: number; items: Record<string, RunStateChange> }
export interface RunCheckpoint { record: ExecutionRunRecord; generation?: string }

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const object = (value: unknown): value is Record<string, Json> => !!value && typeof value === 'object' && !Array.isArray(value)
const assign = <T>(target: Record<string, T>, key: string, value: T) => {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** Capture before yielding. Only private, unchanged JSON branches may be shared. */
export function captureRunRecord(record: ExecutionRunRecord, previous?: ExecutionRunRecord): ExecutionRunRecord {
  const ancestors = new Set<object>()
  const capture = (value: unknown, before: Json | undefined): Json | undefined => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'bigint') throw new TypeError('运行恢复记录不能包含 BigInt')
    if (typeof value !== 'object') return undefined
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
    if (ancestors.has(value)) throw new TypeError('运行恢复记录不能包含循环引用')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        const old = Array.isArray(before) ? before : undefined
        let same = old?.length === value.length
        const next = value.map((entry, index) => {
          const item = capture(entry, old?.[index]) ?? null
          if (item !== old?.[index]) same = false
          return item
        })
        // JSON arrays encode holes as null, just like undefined array entries.
        for (let index = 0; index < next.length; index++) if (!(index in next)) { next[index] = null; same = false }
        return same ? old : next
      }
      const old = object(before) ? before : undefined
      const next: Record<string, Json> = {}
      let size = 0, same = !!old
      for (const key of Object.keys(value)) {
        const item = capture((value as Record<string, unknown>)[key], old && own(old, key) ? old[key] : undefined)
        if (item === undefined) continue
        assign(next, key, item); size++
        if (!old || !own(old, key) || item !== old[key]) same = false
      }
      return same && Object.keys(old!).length === size ? old : next
    } finally { ancestors.delete(value) }
  }
  return capture(record, previous as unknown as Json) as unknown as ExecutionRunRecord
}

export function diffRunRecords(before: ExecutionRunRecord, after: ExecutionRunRecord): RunStateChange | undefined {
  const diff = (old: Json | undefined, next: Json): RunStateChange | undefined => {
    if (old === next) return undefined
    if (Array.isArray(old) && Array.isArray(next)) {
      const items: Record<string, RunStateChange> = {}
      for (let index = 0; index < next.length; index++) {
        const change = diff(old[index], next[index])
        if (change) assign(items, String(index), change)
      }
      return Object.keys(items).length || old.length !== next.length ? { kind: 'array', length: next.length, items } : undefined
    }
    if (object(old) && object(next)) {
      const fields: Record<string, RunStateChange> = {}, remove = Object.keys(old).filter(key => !own(next, key))
      for (const key of Object.keys(next)) {
        const change = diff(own(old, key) ? old[key] : undefined, next[key])
        if (change) assign(fields, key, change)
      }
      return Object.keys(fields).length || remove.length ? { kind: 'object', fields, remove } : undefined
    }
    return { kind: 'replace', value: next }
  }
  return diff(before as unknown as Json, after as unknown as Json)
}

function applyChange(before: Json | undefined, change: RunStateChange): Json {
  if (change.kind === 'replace' && own(change, 'value')) return change.value
  if (change.kind === 'object' && object(before) && object(change.fields) && Array.isArray(change.remove)
    && change.remove.every(key => typeof key === 'string')) {
    const result: Record<string, Json> = {}
    for (const key of Object.keys(before)) assign(result, key, before[key])
    for (const key of change.remove) delete result[key]
    for (const key of Object.keys(change.fields)) assign(result, key, applyChange(own(before, key) ? before[key] : undefined, change.fields[key]))
    return result
  }
  if (change.kind === 'array' && Array.isArray(before) && Number.isSafeInteger(change.length) && change.length >= 0 && object(change.items)) {
    const result = before.slice(0, change.length)
    result.length = change.length
    for (const key of Object.keys(change.items)) {
      const index = Number(key)
      if (!Number.isSafeInteger(index) || String(index) !== key || index < 0 || index >= change.length) throw new Error('运行恢复增量数组无效')
      result[index] = applyChange(before[index], change.items[key])
    }
    return result
  }
  throw new Error('运行恢复增量无效')
}

export function encodeRunCheckpoint(record: ExecutionRunRecord, generation: string): string {
  return JSON.stringify({ schemaVersion: 2, kind: 'execution-run-checkpoint', generation, record })
}

export function decodeRunCheckpoint(bytes: string): RunCheckpoint {
  const value = JSON.parse(bytes)
  if (value?.schemaVersion === 1) return { record: value as ExecutionRunRecord }
  if (value?.schemaVersion !== 2 || value.kind !== 'execution-run-checkpoint'
    || typeof value.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(value.generation) || !object(value.record)) throw new Error('运行恢复检查点无效')
  return { generation: value.generation, record: value.record as unknown as ExecutionRunRecord }
}

const MAGIC = Buffer.from('G20RUN01'), COMMIT = Buffer.from('G20RCMIT'), HEADER = 56, LENGTH_MASK = (1n << 64n) - 1n

export function encodeRunChange(runId: string, generation: string, baseSequence: number, effect: RunStateChange): Buffer {
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'execution-run-change', runId, generation, baseSequence, sequence: baseSequence + 1, effect }))
  const header = Buffer.alloc(HEADER)
  const length = BigInt(payload.length)
  MAGIC.copy(header); header.writeBigUInt64LE(length, 8); header.writeBigUInt64LE(length ^ LENGTH_MASK, 16)
  createHash('sha256').update(payload).digest().copy(header, 24)
  return Buffer.concat([header, payload, COMMIT])
}

/** Stored state only: recovery never invokes tools, model calls or document writes. */
export function restoreRunChanges(checkpoint: RunCheckpoint, bytes: Buffer): { record: ExecutionRunRecord; sequence: number; committedBytes: number } {
  let record = checkpoint.record, sequence = 0, offset = 0
  while (offset < bytes.length) {
    if (bytes.length - offset < HEADER) break
    if (!bytes.subarray(offset, offset + MAGIC.length).equals(MAGIC)) throw new Error('运行恢复增量头无效')
    const size = bytes.readBigUInt64LE(offset + 8)
    if ((size ^ bytes.readBigUInt64LE(offset + 16)) !== LENGTH_MASK) throw new Error('运行恢复增量长度损坏')
    if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('运行恢复增量长度无效')
    const end = offset + HEADER + Number(size), committed = end + COMMIT.length
    if (committed > bytes.length) break
    const payload = bytes.subarray(offset + HEADER, end)
    if (!bytes.subarray(end, committed).equals(COMMIT)
      || !createHash('sha256').update(payload).digest().equals(bytes.subarray(offset + 24, offset + HEADER))) throw new Error('运行恢复增量损坏')
    const value = JSON.parse(payload.toString('utf8'))
    if (value.schemaVersion !== 1 || value.kind !== 'execution-run-change' || value.runId !== record.runId || value.generation !== checkpoint.generation
      || value.baseSequence !== sequence || value.sequence !== sequence + 1 || !object(value.effect)) throw new Error('运行恢复增量顺序无效')
    record = applyChange(record as unknown as Json, value.effect as unknown as RunStateChange) as unknown as ExecutionRunRecord
    sequence = value.sequence; offset = committed
  }
  return { record, sequence, committedBytes: offset }
}
