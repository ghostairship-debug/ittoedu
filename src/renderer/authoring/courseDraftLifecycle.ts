import type { CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import type { AdvancedDraftRecovery } from '../../shared/workbench/desktop'
import type { AuthoringDraftRecovery, AuthoringRecoveryClaim, DocumentHostAPI, PropertyDraftRecovery } from '../../shared/workbench/desktop'
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
type Lifecycle = { providers: Map<AdvancedDraftRecovery['kind'], CourseDraftProvider>; listeners: Set<() => void>; pending: Map<string, AdvancedDraftRecovery[]> }
const lifecycles = new WeakMap<CourseV10DocumentBridge, Lifecycle>()
const draftKey = (record: AdvancedDraftRecovery) => JSON.stringify([record.documentId, record.kind, record.key])
/** Providers recompute these diagnostics while retaining the recovered input. */
function draftInput(record: AdvancedDraftRecovery): unknown {
  const payload = record.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const { message: _message, recoveryBlocked: _recoveryBlocked, ...input } = payload
  return input
}
const sameDraftInput = (left: AdvancedDraftRecovery, right: AdvancedDraftRecovery) =>
  left.projectId === right.projectId && draftKey(left) === draftKey(right) && equalComponentValue(draftInput(left), draftInput(right))
function keepPending(value: Lifecycle, record: AdvancedDraftRecovery): void {
  const key = draftKey(record), pending = value.pending.get(key) ?? []
  if (!pending.some(current => sameDraftInput(current, record))) value.pending.set(key, [...pending, record])
}
function providerHasInput(provider: CourseDraftProvider, record: AdvancedDraftRecovery): boolean {
  return provider.preserve(record.documentId).some(current => sameDraftInput(current, record))
}
function state(bridge: CourseV10DocumentBridge): Lifecycle {
  let value = lifecycles.get(bridge)
  if (!value) { value = { providers: new Map(), listeners: new Set(), pending: new Map() }; lifecycles.set(bridge, value) }
  return value
}
export function notifyCourseDrafts(bridge: CourseV10DocumentBridge): void { for (const listener of state(bridge).listeners) listener() }
export function registerCourseDraftProvider(bridge: CourseV10DocumentBridge, kind: AdvancedDraftRecovery['kind'], provider: CourseDraftProvider): void {
  const value = state(bridge)
  value.providers.set(kind, provider)
  for (const [key, records] of value.pending) if (records[0]?.kind === kind && records.length === 1) {
    const record = records[0]
    try {
      const current = provider.preserve(record.documentId).filter(candidate => draftKey(candidate) === key)
      if (current.length && !current.every(candidate => sameDraftInput(candidate, record))) continue
      if (!providerHasInput(provider, record)) provider.restore(record.documentId, record)
      if (providerHasInput(provider, record)) value.pending.delete(key)
    } catch { /* Keep raw input when its original target is unavailable. */ }
  }
}
/** Collects the two advanced input owners; all writes still go through their captured Bridge edits. */
export function courseDraftLifecycle(bridge: CourseV10DocumentBridge) {
  const value = state(bridge)
  return {
    subscribe(listener: () => void) { value.listeners.add(listener); return () => { value.listeners.delete(listener) } },
    hasDirty(documentId?: string): boolean {
      return [...value.pending.values()].flat().some(record => !documentId || record.documentId === documentId)
        || [...value.providers.values()].some(provider => provider.hasDirty(documentId))
    },
    async prepare(documentId: string): Promise<{ ready: boolean; issues: AdvancedDraftIssue[] }> {
      const issues: AdvancedDraftIssue[] = []
      for (const provider of value.providers.values()) issues.push(...await provider.prepare(documentId))
      for (const records of value.pending.values()) if (records[0]?.documentId === documentId) issues.push({ documentId, epoch: records[0].epoch,
        message: records.length > 1 ? '同一高级编辑位置有多份不同恢复稿，原文均已保留，请选择后接续。' : '高级编辑恢复稿已保留，请打开对应编辑入口修正。' })
      return { ready: !issues.length, issues }
    },
    preserve(documentId: string): AdvancedDraftRecovery[] {
      const target = bridge.captureTarget(documentId)
      return [...value.providers.values()].flatMap(provider => provider.preserve(documentId))
        .concat([...value.pending.values()].flat().filter(record => record.documentId === documentId))
        .map(record => ({ ...record, documentId, epoch: target.epoch, projectId: target.project.id }))
    },
    restore(documentId: string, records: readonly AdvancedDraftRecovery[]): { restored: number; adopted: AdvancedDraftRecovery[]; issues: AdvancedDraftIssue[] } {
      const target = bridge.captureTarget(documentId), issues: AdvancedDraftIssue[] = []
      const adopted: AdvancedDraftRecovery[] = [], candidates = new Map<string, Array<{ saved: AdvancedDraftRecovery; record: AdvancedDraftRecovery }>>()
      for (const saved of records) {
        if (saved.projectId !== target.project.id) { issues.push({ documentId, epoch: target.epoch, message: '恢复稿属于其他工程，已保留原记录。' }); continue }
        const record = { ...saved, documentId, epoch: target.epoch }
        const key = draftKey(record), entries = candidates.get(key) ?? []
        candidates.set(key, [...entries, { saved, record }])
      }
      for (const [key, entries] of candidates) {
        const record = entries[0]!.record, alternatives = [...value.pending.get(key) ?? []]
        for (const entry of entries) if (!alternatives.some(current => sameDraftInput(current, entry.record))) alternatives.push(entry.record)
        const provider = value.providers.get(record.kind)
        const current = provider?.preserve(documentId).filter(candidate => draftKey(candidate) === key) ?? []
        if (alternatives.length > 1 || current.some(candidate => !sameDraftInput(candidate, record))) {
          for (const entry of entries) keepPending(value, entry.record)
          issues.push({ documentId, epoch: target.epoch, message: '同一高级编辑位置有多份不同输入，原文均已保留，请选择后接续。' })
          continue
        }
        try {
          if (provider) {
            if (!providerHasInput(provider, record)) provider.restore(documentId, record)
            if (providerHasInput(provider, record)) value.pending.delete(key)
            else {
              keepPending(value, record)
              issues.push({ documentId, epoch: target.epoch, message: '恢复入口尚未接续原输入，原稿仍保留。' })
            }
          } else keepPending(value, record)
          adopted.push(...entries.map(entry => entry.saved))
        } catch (error) {
          keepPending(value, record)
          adopted.push(...entries.map(entry => entry.saved))
          issues.push({ documentId, epoch: target.epoch, message: error instanceof Error ? error.message : String(error) })
        }
      }
      notifyCourseDrafts(bridge)
      return { restored: adopted.length, adopted, issues }
    },
    /** Only the close owner calls this after confirmed preservation and successful close. */
    release(documentId: string): void {
      for (const provider of value.providers.values()) provider.release(documentId)
      for (const [key, records] of value.pending) if (records[0]?.documentId === documentId) value.pending.delete(key)
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
  restore(documentId: string, epoch: string, records: AuthoringDraftRecovery): { advanced: AdvancedDraftRecovery[]; properties: PropertyDraftRecovery[] }
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
  const unadopted = new Map<string, AuthoringRecoveryClaim[]>()
  const suspended = new Map<string, string>()
  let writes = Promise.resolve()
  const ids = () => bridge.read().documents.map(snapshot => snapshot.documentId)
  const assertEpoch = (documentId: string, epoch: string) => {
    const current = ports.capture(documentId)
    if (current.snapshot.epoch !== epoch) throw new Error('输入所属文档已关闭或重开，原稿保留在本机')
    return current
  }
  const persist = async (documentId: string, records: AuthoringDraftRecovery, epoch: string, api = host) => {
    if (!api) throw new Error('输入恢复服务不可用，已保留原稿')
    const retainedRecords = unadopted.get(JSON.stringify([documentId, epoch]))
    // This owner controls only these two slices. Empty input must not erase Flow or Source conflicts.
    await api.writeAuthoringDrafts(documentId, { advanced: records.advanced, properties: records.properties,
      ...(retainedRecords?.length ? { retainedRecords } : {}) }, epoch)
  }
  const restore = (documentId: string): Promise<void> => {
    const { snapshot } = ports.capture(documentId)
    const key = JSON.stringify([documentId, snapshot.epoch]), previous = restored.get(key)
    if (previous) return previous
    const api = host
    if (!api) return Promise.reject(new Error('输入恢复服务不可用，已保留原稿'))
    const pending = api.readAuthoringDrafts(documentId).then(async records => {
      assertEpoch(documentId, snapshot.epoch)
      if (!records) return
      const adopted = ports.restore(documentId, snapshot.epoch, records)
      assertEpoch(documentId, snapshot.epoch)
      const claims = (records.recoveryRecords ?? []).filter(record =>
        record.kind === 'advanced' && adopted.advanced.some(value => equalComponentValue(value, record.value))
        || record.kind === 'properties' && adopted.properties.some(value => equalComponentValue(value, record.value)))
        .map(({ id, digest }) => ({ id, digest }))
      unadopted.set(key, (records.recoveryRecords ?? [])
        .filter(record => (record.kind === 'advanced' || record.kind === 'properties')
          && !claims.some(claim => claim.id === record.id && claim.digest === record.digest))
        .map(({ id, digest }) => ({ id, digest })))
      // Main durably copies these exact raw records before consuming their old identities.
      // Publish the remapped provider capture afterwards so it cannot delete a selected identity before claim.
      if (claims.length) await api.claimAuthoringDrafts?.(documentId, snapshot.epoch, claims)
      const current = assertEpoch(documentId, snapshot.epoch)
      await persist(documentId, current.records, snapshot.epoch, api)
    }).catch(error => { restored.delete(key); throw error })
    restored.set(key, pending)
    return pending
  }
  return {
    connect(api: DocumentHostAPI, adapter?: CourseInputRecoveryAdapter) {
      if (api !== host) { restored.clear(); unadopted.clear(); suspended.clear() }
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
          await persist(documentId, captured.records, captured.snapshot.epoch)
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
          await persist(documentId, assertEpoch(documentId, epoch).records, epoch)
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
