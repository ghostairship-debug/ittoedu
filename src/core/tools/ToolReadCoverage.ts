import { readTarget } from './ToolTargets'
import { documentDigest } from '../documents/documentDigest'
import { isSourceDocumentModel, type DocumentSnapshot } from '../../shared/workbench/document'
import type { ToolTarget } from '../../shared/workbench/tools'

export interface SourceSplice { from: number; to: number; inserted: number }
export interface FlowSplice extends SourceSplice {
  surfaceId: string
  parentId: string | null
  blockId: string
  slot: Extract<ToolTarget, { kind: 'flow-range' }>['slot']
}
type Range = { from: number; to: number }
/** Exact host-acknowledged edits, never a heuristic diff or a new grant. */
export function mapAcknowledgedRange<T extends Range>(range: T, edits: readonly SourceSplice[]): T {
  let next = { ...range }
  for (const edit of edits) {
    const delta = edit.inserted - (edit.to - edit.from)
    if (edit.to <= next.from && edit.from < next.from) next = { ...next, from: next.from + delta, to: next.to + delta }
    else if (edit.from >= next.to && edit.from > next.from) { /* outside, after */ }
    else if (next.from <= edit.from && next.to >= edit.to) next = { ...next, to: next.to + delta }
    else throw new Error('旧范围仅被部分覆盖，需重新定位')
  }
  return next
}
export function mapAcknowledgedFlowRange<T extends Extract<ToolTarget, { kind: 'flow-range' }>>(
  range: T, edits: readonly FlowSplice[]): T {
  return mapAcknowledgedRange(range, edits.filter(edit => edit.surfaceId === range.surfaceId
    && edit.parentId === range.parentId && edit.blockId === range.blockId
    && documentDigest(edit.slot) === documentDigest(range.slot)))
}
interface Observation { target: ToolTarget; total: number; intervals: Range[] }
interface DocumentReads { epoch: string; revision: number; entries: Map<string, Observation> }

/** Only text actually returned by read/preview is counted. No document bodies are retained here. */
export class ToolReadCoverage {
  private readonly runs = new Map<string, Map<string, DocumentReads>>()
  clear(runId: string) { this.runs.delete(runId) }
  record(runId: string, snapshot: DocumentSnapshot, target: ToolTarget, total: number, from: number, to: number): void {
    let docs = this.runs.get(runId)
    if (!docs) this.runs.set(runId, docs = new Map())
    let reads = docs.get(snapshot.documentId)
    if (!reads || reads.epoch !== snapshot.epoch || reads.revision !== snapshot.revision) {
      reads = { epoch: snapshot.epoch, revision: snapshot.revision, entries: new Map() }
      docs.set(snapshot.documentId, reads)
    }
    const key = documentDigest(target), entry = reads.entries.get(key) ?? { target: structuredClone(target), total, intervals: [] }
    const intervals = [...entry.intervals, { from, to }].sort((a, b) => a.from - b.from)
    entry.intervals = []
    for (const interval of intervals) {
      const last = entry.intervals.at(-1)
      if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to)
      else entry.intervals.push({ ...interval })
    }
    reads.entries.set(key, entry)
  }
  /** A canonical ACK explains these changes; a different revision never inherits observations. */
  advance(runId: string, before: DocumentSnapshot, after: DocumentSnapshot,
    edits: readonly SourceSplice[], flowEdits: readonly FlowSplice[] = []): void {
    const docs = this.runs.get(runId), reads = docs?.get(before.documentId)
    if (!docs || !reads || reads.epoch !== before.epoch || reads.revision !== before.revision) return
    docs.set(before.documentId, { epoch: after.epoch, revision: after.revision, entries: new Map() })
    for (const entry of reads.entries.values()) try {
      if (isSourceDocumentModel(before.model) && isSourceDocumentModel(after.model)
        && (entry.target.kind === 'document' || entry.target.kind === 'markdown-range')) {
        const base = entry.target.kind === 'document' ? 0 : entry.target.from
        const next = entry.target.kind === 'document' ? entry.target : mapAcknowledgedRange(entry.target, edits)
        const nextBase = next.kind === 'document' ? 0 : next.from
        const total = next.kind === 'document' ? after.model.source.length : next.to - next.from
        for (const interval of entry.intervals) try {
          const mapped = mapAcknowledgedRange({ from: base + interval.from, to: base + interval.to }, edits)
          this.record(runId, after, next, total, mapped.from - nextBase, mapped.to - nextBase)
        } catch { /* A partially replaced observation must be read again. */ }
      } else {
        const next = entry.target.kind === 'flow-range' ? mapAcknowledgedFlowRange(entry.target, flowEdits) : entry.target
        const oldText = JSON.stringify(readTarget(before.model, entry.target)), newText = JSON.stringify(readTarget(after.model, next))
        for (const interval of entry.intervals) {
          if (oldText === newText) this.record(runId, after, next, newText.length, interval.from, interval.to)
          else if (interval.from === 0 && interval.to === entry.total) this.record(runId, after, next, newText.length, 0, newText.length)
        }
      }
    } catch { /* A removed target has no new observation. */ }
  }
  has(runId: string, snapshot: DocumentSnapshot, target: ToolTarget): boolean {
    const reads = this.runs.get(runId)?.get(snapshot.documentId)
    if (!reads || reads.epoch !== snapshot.epoch || reads.revision !== snapshot.revision) return false
    if (isSourceDocumentModel(snapshot.model) && (target.kind === 'document' || target.kind === 'markdown-range')) {
      const from = target.kind === 'document' ? 0 : target.from, to = target.kind === 'document' ? snapshot.model.source.length : target.to
      const ranges = [...reads.entries.values()].flatMap(entry => {
        if (entry.target.kind !== 'document' && entry.target.kind !== 'markdown-range') return []
        const base = entry.target.kind === 'document' ? 0 : entry.target.from
        return entry.intervals.map(interval => ({ from: base + interval.from, to: base + interval.to }))
      }).sort((a, b) => a.from - b.from)
      let end = from, seen = false
      for (const range of ranges) if (range.from <= end && range.to >= end) { seen = true; end = Math.max(end, range.to) }
      return seen && end >= to
    }
    const entry = reads.entries.get(documentDigest(target))
    return !!entry?.intervals.some(interval => interval.from === 0 && interval.to === entry.total)
  }
}
