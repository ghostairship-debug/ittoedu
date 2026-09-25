import type { DocumentSnapshot } from '../../shared/workbench/document'

export interface DocumentClosePorts {
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
  if (await ports.hasWritableTasks()) {
    if (!await ports.confirmStop()) return false
    await ports.stopWritableTasks()
  }
  let snapshot = await ports.read()
  let discard = false
  if (snapshot.dirty) {
    const decision = await ports.chooseDirty(snapshot)
    if (decision === 'cancel') return false
    if (decision === 'save') {
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
    await ports.close(snapshot, discard)
    return true
  })
}
