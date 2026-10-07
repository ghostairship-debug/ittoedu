import type { CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import type { JsonValue } from '../../shared/contracts/component-platform/project'

export interface AdvancedDraftIssue { documentId: string; epoch: string; message: string }
/** Local recovery input, never author content or a replayable operation. */
export interface AdvancedDraftRecovery {
  kind: 'source' | 'json'
  projectId: string
  documentId: string
  epoch: string
  key: string
  payload: JsonValue
}
export interface CourseDraftProvider {
  hasDirty(documentId?: string): boolean
  prepare(documentId: string): Promise<AdvancedDraftIssue[]>
  preserve(documentId: string): AdvancedDraftRecovery[]
  restore(documentId: string, record: AdvancedDraftRecovery): void
}
type Lifecycle = { providers: Map<AdvancedDraftRecovery['kind'], CourseDraftProvider>; listeners: Set<() => void>; pending: Map<string, AdvancedDraftRecovery> }
const lifecycles = new WeakMap<CourseV10DocumentBridge, Lifecycle>()
function state(bridge: CourseV10DocumentBridge): Lifecycle {
  let value = lifecycles.get(bridge)
  if (!value) { value = { providers: new Map(), listeners: new Set(), pending: new Map() }; lifecycles.set(bridge, value) }
  return value
}
export function notifyCourseDrafts(bridge: CourseV10DocumentBridge): void { for (const listener of state(bridge).listeners) listener() }
export function registerCourseDraftProvider(bridge: CourseV10DocumentBridge, kind: AdvancedDraftRecovery['kind'], provider: CourseDraftProvider): void {
  const value = state(bridge)
  value.providers.set(kind, provider)
  for (const [key, record] of value.pending) if (record.kind === kind) {
    try { provider.restore(record.documentId, record); value.pending.delete(key) } catch { /* Keep raw input when its original target is unavailable. */ }
  }
}
/** Collects the two advanced input owners; all writes still go through their captured Bridge edits. */
export function courseDraftLifecycle(bridge: CourseV10DocumentBridge) {
  const value = state(bridge)
  return {
    subscribe(listener: () => void) { value.listeners.add(listener); return () => { value.listeners.delete(listener) } },
    hasDirty(documentId?: string): boolean {
      return [...value.pending.values()].some(record => !documentId || record.documentId === documentId)
        || [...value.providers.values()].some(provider => provider.hasDirty(documentId))
    },
    async prepare(documentId: string): Promise<{ ready: boolean; issues: AdvancedDraftIssue[] }> {
      const issues: AdvancedDraftIssue[] = []
      for (const provider of value.providers.values()) issues.push(...await provider.prepare(documentId))
      for (const record of value.pending.values()) if (record.documentId === documentId) issues.push({ documentId, epoch: record.epoch, message: '高级编辑恢复稿已保留，请打开对应编辑入口修正。' })
      return { ready: !issues.length, issues }
    },
    preserve(documentId: string): AdvancedDraftRecovery[] {
      return [...value.providers.values()].flatMap(provider => provider.preserve(documentId))
        .concat([...value.pending.values()].filter(record => record.documentId === documentId))
    },
    restore(documentId: string, records: readonly AdvancedDraftRecovery[]): { restored: number; issues: AdvancedDraftIssue[] } {
      const target = bridge.captureTarget(documentId), issues: AdvancedDraftIssue[] = []
      let restored = 0
      for (const saved of records) {
        if (saved.projectId !== target.project.id) { issues.push({ documentId, epoch: target.epoch, message: '恢复稿属于其他工程，已保留原记录。' }); continue }
        const record = { ...saved, documentId, epoch: target.epoch }
        try {
          const provider = value.providers.get(record.kind)
          if (provider) provider.restore(documentId, record)
          else value.pending.set(JSON.stringify([documentId, record.kind, record.key]), record)
          restored++
        } catch (error) {
          value.pending.set(JSON.stringify([documentId, record.kind, record.key]), record)
          issues.push({ documentId, epoch: target.epoch, message: error instanceof Error ? error.message : String(error) })
        }
      }
      notifyCourseDrafts(bridge)
      return { restored, issues }
    },
  }
}
