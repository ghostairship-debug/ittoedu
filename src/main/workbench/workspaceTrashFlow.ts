import path from 'node:path'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { ResolvedWorkspaceEntry, WorkspaceOperationResult } from '../../shared/workbench/workspaceFiles'

export interface WorkspaceTrashPorts {
  entries(): Promise<ResolvedWorkspaceEntry[]>
  documents(): Promise<DocumentSnapshot[]>
  hasWriters(documentId: string): Promise<boolean>
  confirm(input: { entries: ResolvedWorkspaceEntry[]; documents: DocumentSnapshot[]; hasWriters: boolean }): Promise<boolean>
  withBarrier<T>(documentIds: string[], operation: () => Promise<T>): Promise<T>
  stopWriters(documentId: string): Promise<void>
  trash(): Promise<WorkspaceOperationResult>
}
const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
function matches(snapshot: DocumentSnapshot, entries: ResolvedWorkspaceEntry[]) {
  if (snapshot.binding.kind !== 'file') return false
  const filename = key(snapshot.binding.path)
  return entries.some(entry => {
    const source = key(entry.resolvedPath)
    if (entry.kind === 'file') return filename === source
    const relative = path.relative(source, filename)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  })
}

/** Confirm once, stop writers, then retain open documents as untitled through the existing binding transaction. */
export async function workspaceTrashFlow(operationId: string, ports: WorkspaceTrashPorts): Promise<WorkspaceOperationResult> {
  const entries = await ports.entries(), documents = (await ports.documents()).filter(snapshot => matches(snapshot, entries))
  const hasWriters = (await Promise.all(documents.map(snapshot => ports.hasWriters(snapshot.documentId)))).some(Boolean)
  if (!await ports.confirm({ entries, documents, hasWriters })) {
    return { operationId, status: 'cancelled', items: entries.map(entry => ({ status: 'cancelled', sourceEntryId: entry.entryId, affectedPaths: [] })), affectedPaths: [] }
  }
  // Include documents opened during confirmation. Their current drafts are retained by FileCoordinator.
  const current = (await ports.documents()).filter(snapshot => matches(snapshot, entries))
  return ports.withBarrier(current.map(snapshot => snapshot.documentId), async () => {
    for (const snapshot of current) await ports.stopWriters(snapshot.documentId)
    return ports.trash()
  })
}
