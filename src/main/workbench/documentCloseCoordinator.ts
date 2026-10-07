import type { DocumentSnapshot } from '../../shared/workbench/document'

export type DocumentCloseChoice = 'save' | 'discard' | 'preserve' | 'cancel'
export interface DocumentClosePorts {
  list(): readonly DocumentSnapshot[]
  drain(): Promise<void>
  rendererDirty(): Promise<boolean>
  confirm(): DocumentCloseChoice | Promise<DocumentCloseChoice>
  cancelled?(): boolean
  /** Save/preserve flush input; discard only suspends input owners until Main closes or resumes them. */
  prepareRenderer(mode: 'save' | 'preserve' | 'discard', documentIds?: readonly string[]): Promise<boolean>
  save(documentId: string): Promise<DocumentSnapshot | null>
  discard?(snapshots: readonly DocumentSnapshot[]): Promise<boolean>
  withWriteBarrier?<T>(documentIds: readonly string[], work: () => Promise<T>): Promise<T>
  stopWriters?(documentIds: readonly string[]): Promise<void>
  /** Focus the retained document; reporting must never change close/save outcomes. */
  onBlocked?(documentId: string, reason: 'cancelled' | 'failed' | 'changed'): void | Promise<void>
}

/** Installed by the window lifecycle: the hide-to-tray prompt runs before any save protection. 'handled' keeps the app running. */
let beforeWindowClose: (() => Promise<'continue' | 'handled'>) | undefined
export function setBeforeWindowClose(hook?: () => Promise<'continue' | 'handled'>): void { beforeWindowClose = hook }

/** Decides close permission across every live document, independent of the foreground view. */
export async function prepareDocumentWindowClose(ports: DocumentClosePorts): Promise<boolean> {
  if (beforeWindowClose && await beforeWindowClose() === 'handled') return false
  const blocked = async (id: string, reason: 'cancelled' | 'failed' | 'changed') => {
    try { await ports.onBlocked?.(id, reason) } catch { /* Navigation cannot discard a retained draft. */ }
  }
  const hasDraft = await ports.rendererDirty()
  await ports.drain()
  const snapshots = ports.list(), ids = snapshots.map(snapshot => snapshot.documentId)
  const decision = hasDraft || snapshots.some(snapshot => snapshot.dirty || snapshot.saving) ? await ports.confirm() : 'preserve'
  if (decision === 'cancel' || ports.cancelled?.()) return false
  if (decision === 'preserve') {
    if (!(await ports.prepareRenderer('preserve'))) return false
    await ports.drain()
    return !ports.cancelled?.()
  }
  const work = async () => {
    if (decision === 'discard') {
      if (!await ports.prepareRenderer('discard', ids)) return false
      await ports.stopWriters?.(ids)
      if (ports.cancelled?.()) return false
      if (!ports.discard) throw new Error('当前窗口未接通放弃未保存更改')
      return ports.discard(snapshots)
    }
    await ports.stopWriters?.(ids)
    if (ports.cancelled?.()) return false
    if (!(await ports.prepareRenderer('save', ids))) return false
    await ports.drain()
    // One save attempt per document. Later input remains dirty instead of being silently resaved.
    for (const snapshot of ports.list()) {
      if (ports.cancelled?.()) return false
      if (!snapshot.dirty) continue
      try {
        const saved = await ports.save(snapshot.documentId)
        if (!saved) { await blocked(snapshot.documentId, 'cancelled'); return false }
        if (saved.dirty || saved.saving) { await blocked(snapshot.documentId, 'changed'); return false }
      } catch (error) {
        await blocked(snapshot.documentId, 'failed')
        throw error
      }
    }
    if (!(await ports.prepareRenderer('save', ids))) return false
    await ports.drain()
    const remaining = ports.list().find(snapshot => snapshot.dirty || snapshot.saving)
    if (remaining) { await blocked(remaining.documentId, 'changed'); return false }
    return !ports.cancelled?.()
  }
  return ports.withWriteBarrier ? ports.withWriteBarrier(ids, work) : work()
}
