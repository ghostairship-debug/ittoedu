import type { DocumentSnapshot } from '../../shared/workbench/document'

export type DocumentCloseChoice = 'save' | 'preserve' | 'cancel'
export interface DocumentClosePorts {
  list(): readonly DocumentSnapshot[]
  drain(): Promise<void>
  rendererDirty(): Promise<boolean>
  confirm(): DocumentCloseChoice | Promise<DocumentCloseChoice>
  cancelled?(): boolean
  /** Flushes unfinished input to canonical recovery; it must not dispose views or save files. */
  prepareRenderer(mode: 'save' | 'preserve'): Promise<boolean>
  save(documentId: string): Promise<DocumentSnapshot | null>
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
  // A background view may still hold input that has not reached its main session.
  if (!(await ports.prepareRenderer('preserve'))) return false
  await ports.drain()
  const decision = hasDraft || ports.list().some(snapshot => snapshot.dirty) ? await ports.confirm() : 'preserve'
  if (decision === 'cancel' || ports.cancelled?.()) return false
  if (decision === 'preserve') {
    if (!(await ports.prepareRenderer('preserve'))) return false
    await ports.drain()
    return !ports.cancelled?.()
  }

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
  // Inputs entered during native dialogs or disk I/O must reach main before the final check.
  if (!(await ports.prepareRenderer('save'))) return false
  await ports.drain()
  const remaining = ports.list().find(snapshot => snapshot.dirty || snapshot.saving)
  if (remaining) { await blocked(remaining.documentId, 'changed'); return false }
  return !ports.cancelled?.()
}
