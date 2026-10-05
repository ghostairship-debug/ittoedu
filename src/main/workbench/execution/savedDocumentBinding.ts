import path from 'node:path'
import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { SavedCourseIdentity } from '../../../shared/workbench/documentSave'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'

const pathKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

/** Clean file snapshots prove their save revision; dirty snapshots require the actual successful-save fact. */
export function savedDocumentBinding(snapshot: DocumentSnapshot): SavedCourseIdentity | undefined {
  if (snapshot.binding.kind !== 'file' || snapshot.model.kind !== 'course-v10' || snapshot.dirty) return
  return { kind: 'course-v10', path: snapshot.binding.path, projectId: snapshot.model.project.id,
    epoch: snapshot.epoch, savedRevision: snapshot.revision, fileVersion: snapshot.binding.version }
}
export function matchesSavedDocument(binding: SavedCourseIdentity, snapshot: DocumentSnapshot): boolean {
  return binding.kind === 'course-v10' && snapshot.model.kind === binding.kind
    && snapshot.binding.kind === 'file' && pathKey(binding.path) === pathKey(snapshot.binding.path)
    && binding.projectId === snapshot.model.project.id
}
/** A formal rename changes location, never the revision/epoch proved by the last save. */
export function reboundSavedDocumentBinding(snapshot: DocumentSnapshot, binding: SavedCourseIdentity): SavedCourseIdentity | undefined {
  if (snapshot.binding.kind !== 'file' || snapshot.model.kind !== binding.kind
    || snapshot.model.project.id !== binding.projectId) return
  return { ...binding, path: snapshot.binding.path }
}
/** Only host-recorded bindings are consulted; documentPaths alone and model text confer no identity. */
export function continuationDocumentIds(lineage: readonly ExecutionRunRecord[], snapshots: readonly DocumentSnapshot[]): Map<string, string> {
  const bindings = Object.assign({}, ...lineage.map(run => run.documentBindings ?? {})) as Record<string, SavedCourseIdentity>
  const ids = new Map<string, string>()
  for (const [oldId, binding] of Object.entries(bindings)) {
    const live = snapshots.find(snapshot => matchesSavedDocument(binding, snapshot))
    if (live) ids.set(oldId, live.documentId)
  }
  return ids
}
