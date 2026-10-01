import { z } from 'zod'
import type { DocumentModel, DocumentSnapshot } from './document'
import type { ObservationResult } from './toolPorts'

const identity = z.string().trim().min(1).max(200)
export const viewObserveInputSchema = z.object({ target: identity, detail: z.enum(['auto', 'low', 'high']).optional(),
  purpose: z.enum(['required', 'diagnostic']).optional() }).strict()
export type ViewObserveInput = z.infer<typeof viewObserveInputSchema>

export type ViewObservationIdentity = ObservationResult['identity']
export type ViewObservationSnapshot = DocumentSnapshot & { model: Extract<DocumentModel, { kind: 'course-v9' }> }
export interface ViewObservationCapture {
  identity: ViewObservationIdentity
  png: Uint8Array
  width: number
  height: number
  structure: readonly string[]
  diagnostics: readonly string[]
}

export function sameObservationIdentity(a: ViewObservationIdentity, b: ViewObservationIdentity): boolean {
  return a.documentId === b.documentId && a.epoch === b.epoch && a.revision === b.revision
    && a.locationId === b.locationId && a.viewGeneration === b.viewGeneration
}

export function observationSnapshotMatches(snapshot: DocumentSnapshot, identity: ViewObservationIdentity,
  projectId: string): snapshot is ViewObservationSnapshot {
  return snapshot.documentId === identity.documentId && snapshot.epoch === identity.epoch
    && snapshot.revision === identity.revision && snapshot.model.kind === 'course-v9'
    && snapshot.model.project.id === projectId
    && snapshot.model.project.locations.some(location => location.id === identity.locationId)
}
