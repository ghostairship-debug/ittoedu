import type { CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import type { AdvancedDraftRecovery } from '../../shared/workbench/desktop'
import type { AuthoringDraftRecovery, DocumentHostAPI } from '../../shared/workbench/desktop'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import { equalComponentValue } from '../../core/drivers/courseV10Operations'
export type { AdvancedDraftRecovery } from '../../shared/workbench/desktop'

export interface AdvancedDraftIssue { documentId: string; epoch: string; message: string }
export interface CourseDraftProvider {
  hasDirty(documentId?: string): boolean
  prepare(documentId: string): Promise<AdvancedDraftIssue[]>
  preserve(documentId: string): AdvancedDraftRecovery[]
  restore(documentId: string, record: AdvancedDraftRecovery): void
  release(documentId: string): void
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
      const target = bridge.captureTarget(documentId)
      return [...value.providers.values()].flatMap(provider => provider.preserve(documentId))
        .concat([...value.pending.values()].filter(record => record.documentId === documentId))
        .map(record => ({ ...record, documentId, epoch: target.epoch, projectId: target.project.id }))
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
    /** Only the close owner calls this after confirmed preservation and successful close. */
    release(documentId: string): void {
      for (const provider of value.providers.values()) provider.release(documentId)
      for (const [key, record] of value.pending) if (record.documentId === documentId) value.pending.delete(key)
      notifyCourseDrafts(bridge)
    },
  }
}

export interface CourseInputRecoveryAdapter {
  preserveFlow(documentIds: readonly string[]): Promise<boolean>
  suspendFlow(epochs: readonly string[]): void
  resumeFlow(epochs: readonly string[]): void
}
interface CourseInputCapture {
  snapshot: DocumentSnapshot
  records: AuthoringDraftRecovery
  /** The existing Flow draft owner retains its own source and recovery format. */
  flowDraft: unknown
}
interface CourseInputPorts {
  capture(documentId: string): CourseInputCapture
  drain(documentId: string): Promise<unknown>
  restore(documentId: string, epoch: string, records: AuthoringDraftRecovery): void
  suspend(documentIds: readonly string[]): void
  resume(documentIds: readonly string[]): void
  error(message: string): void
  status(message: string): void
}

/** Input completion and recovery belong to the document, independently of its mounted view. */
export function createCourseInputLifecycle(bridge: CourseV10DocumentBridge, ports: CourseInputPorts) {
  let host: DocumentHostAPI | undefined
  let recovery: CourseInputRecoveryAdapter | undefined
  const restored = new Map<string, Promise<void>>()
  const suspended = new Map<string, string>()
  let writes = Promise.resolve()
  const ids = () => bridge.read().documents.map(snapshot => snapshot.documentId)
  const assertEpoch = (documentId: string, epoch: string) => {
    const current = ports.capture(documentId)
    if (current.snapshot.epoch !== epoch) throw new Error('输入所属文档已关闭或重开，原稿保留在本机')
    return current
  }
  const persist = async (documentId: string, records: AuthoringDraftRecovery) => {
    if (!host) throw new Error('输入恢复服务不可用，已保留原稿')
    if (records.advanced.length || records.properties.length) await host.writeAuthoringDrafts(documentId, records)
    else await host.clearAuthoringDrafts(documentId)
  }
  const restore = (documentId: string): Promise<void> => {
    const { snapshot } = ports.capture(documentId)
    const key = JSON.stringify([documentId, snapshot.epoch]), previous = restored.get(key)
    if (previous) return previous
    if (!host) return Promise.reject(new Error('输入恢复服务不可用，已保留原稿'))
    const pending = host.readAuthoringDrafts(documentId).then(records => {
      assertEpoch(documentId, snapshot.epoch)
      if (records) ports.restore(documentId, snapshot.epoch, records)
    }).catch(error => { restored.delete(key); throw error })
    restored.set(key, pending)
    return pending
  }
  return {
    connect(api: DocumentHostAPI, adapter?: CourseInputRecoveryAdapter) {
      if (api !== host) { restored.clear(); suspended.clear() }
      host = api; recovery = adapter
    },
    restore,
    hasDirty(documentIds: readonly string[] = ids()): boolean {
      return documentIds.filter(id => ids().includes(id)).some(id => {
        const current = ports.capture(id)
        return current.snapshot.dirty || current.records.advanced.length > 0 || current.records.properties.length > 0 || Boolean(current.flowDraft)
      })
    },
    async prepare(documentIds: readonly string[] = ids(), mode: 'save' | 'preserve' = 'preserve'): Promise<boolean> {
      try {
        for (const documentId of documentIds.filter(id => ids().includes(id))) {
          await restore(documentId)
          let issue: unknown
          try { await ports.drain(documentId) } catch (error) { issue = error }
          if (mode === 'save' && issue) throw issue
          const captured = ports.capture(documentId)
          await persist(documentId, captured.records)
          if (recovery && !await recovery.preserveFlow([documentId])) return false
          await bridge.drain([documentId])
          const current = assertEpoch(documentId, captured.snapshot.epoch)
          if (!equalComponentValue(captured.records, current.records) || current.flowDraft !== captured.flowDraft)
            throw new Error('保全期间又有新输入，原稿仍保留；请完成本次输入后再关闭')
          if (issue) ports.status('未完成的输入已保存在本机恢复稿中')
        }
        return true
      } catch (error) { ports.error(error instanceof Error ? error.message : '输入尚未保全，已取消关闭'); return false }
    },
    persist(documentIds: readonly string[] = ids()): Promise<void> {
      const captures = documentIds.map(documentId => ({ documentId, epoch: ports.capture(documentId).snapshot.epoch }))
      writes = writes.then(async () => {
        for (const { documentId, epoch } of captures) {
          if (suspended.has(documentId)) continue
          if (!bridge.read().documents.some(snapshot => snapshot.documentId === documentId && snapshot.epoch === epoch)) continue
          await restore(documentId)
          if (suspended.has(documentId)) continue
          await persist(documentId, assertEpoch(documentId, epoch).records)
        }
      }).catch(error => ports.error(error instanceof Error ? error.message : '输入恢复稿尚未保存'))
      return writes
    },
    async suspend(documentIds: readonly string[] = ids()): Promise<void> {
      const currentIds = documentIds.filter(id => ids().includes(id))
      for (const documentId of currentIds) suspended.set(documentId, ports.capture(documentId).snapshot.epoch)
      ports.suspend(currentIds)
      recovery?.suspendFlow(currentIds.map(documentId => suspended.get(documentId)!))
      // Let an admitted recovery write finish before Main removes this epoch's recovery.
      await writes
    },
    resume(documentIds: readonly string[] = [...suspended.keys()]): void {
      const epochs: string[] = [], currentIds: string[] = []
      for (const documentId of documentIds) {
        const epoch = suspended.get(documentId)
        suspended.delete(documentId)
        if (epoch && bridge.read().documents.some(snapshot => snapshot.documentId === documentId && snapshot.epoch === epoch)) {
          epochs.push(epoch); currentIds.push(documentId)
        }
      }
      ports.resume(currentIds)
      recovery?.resumeFlow(epochs)
    },
  }
}
