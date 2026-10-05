import { documentDigest } from '../documents/documentDigest'
import type { ToolTarget } from '../../shared/workbench/tools'
import type { CourseInstanceRange } from './ToolTargets'

export interface SourceSplice { from: number; to: number; inserted: number }
export interface FlowSplice extends SourceSplice {
  surfaceId: string
  parentId: string | null
  blockId: string
  slot: Extract<ToolTarget, { kind: 'flow-range' }>['slot']
}
export interface ComponentTextSplice extends SourceSplice {
  surfaceId: string
  instanceId: string
  stateId?: string | null
  fieldScope?: 'data' | 'flowLayout'
  dataPath: string[]
}
export function mapAcknowledgedComponentRange<T extends CourseInstanceRange>(range: T, edits: readonly ComponentTextSplice[]): T {
  return mapAcknowledgedRange(range, edits.filter(edit => edit.surfaceId === range.surfaceId && edit.instanceId === range.instanceId
    && (edit.stateId ?? null) === (range.stateId ?? null) && (edit.fieldScope ?? 'data') === (range.fieldScope ?? 'data')
    && documentDigest(edit.dataPath) === documentDigest(range.dataPath)))
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
