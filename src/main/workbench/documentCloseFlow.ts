import type { DocumentSnapshot } from '../../shared/workbench/document'

export interface DocumentClosePorts {
  /** A failed renderer draft can be discarded explicitly without first committing or saving it. */
  discardOnly?: boolean
  /** Complete or suspend this document's inputs; Main still owns the close decision. */
  prepareRenderer?(mode: 'save' | 'preserve' | 'discard'): Promise<boolean>
  rendererDirty?(): boolean
  read(): Promise<DocumentSnapshot>
  hasWritableTasks(): Promise<boolean>
  confirmStop(): Promise<boolean>
  stopWritableTasks(): Promise<void>
  chooseDirty(snapshot: DocumentSnapshot): Promise<'save' | 'discard' | 'cancel'>
  save(): Promise<DocumentSnapshot | null>
  withBarrier<T>(operation: () => Promise<T>): Promise<T>
  close(snapshot: DocumentSnapshot, discardDirty: boolean): Promise<void>
}

/** A dialog decision applies only to the exact content the user saw. */
export async function closeDocumentFlow(ports: DocumentClosePorts): Promise<boolean> {
  if (!ports.discardOnly && await ports.prepareRenderer?.('preserve') === false) return false
  if (await ports.hasWritableTasks()) {
    if (!await ports.confirmStop()) return false
    await ports.stopWritableTasks()
  }
  let snapshot = await ports.read()
  let discard = false
  if (snapshot.dirty || ports.rendererDirty?.() || ports.discardOnly) {
    const decision = await ports.chooseDirty(snapshot)
    if (decision === 'cancel') return false
    if (decision === 'save') {
      if (ports.discardOnly) return false
      if (await ports.prepareRenderer?.('save') === false) return false
      const saved = await ports.save()
      if (!saved || saved.dirty) return false
      snapshot = saved
    } else discard = true
  }
  // An external task can attach while a modal is open. Its subsequent changes
  // are protected by the final content-version check inside DocumentSession.
  return ports.withBarrier(async () => {
    if (await ports.hasWritableTasks()) {
      if (!await ports.confirmStop()) return false
      await ports.stopWritableTasks()
    }
    if (await ports.prepareRenderer?.(discard ? 'discard' : 'save') === false) return false
    if (!discard) {
      const current = await ports.read()
      if (current.epoch !== snapshot.epoch || current.revision !== snapshot.revision || current.dirty !== snapshot.dirty) return false
    }
    await ports.close(snapshot, discard)
    return true
  })
}
