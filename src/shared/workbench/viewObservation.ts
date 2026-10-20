import { z } from 'zod'
import type { DocumentModel, DocumentSnapshot } from './document'
import type { ObservationResult } from './toolPorts'

const identity = z.string().trim().min(1).max(200)
const observeOptions = { detail: z.enum(['auto', 'low', 'high']).optional(),
  query: z.string().optional(), offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(), cursor: z.string().min(1).optional(),
  clip: z.object({ x: z.number().finite(), y: z.number().finite(),
    width: z.number().finite().positive(), height: z.number().finite().positive() }).strict().optional(),
  purpose: z.enum(['required', 'diagnostic']).optional() }
export const viewObserveInputSchema = z.union([
  z.object({ target: identity, ...observeOptions }).strict(),
  z.object({ project: z.string().min(1).max(1000).optional(), path: z.string().min(1).max(500), ...observeOptions }).strict(),
  z.object(observeOptions).strict(),
])
export type ViewObserveInput = z.infer<typeof viewObserveInputSchema>
export const isViewObservationTool = (name: string): boolean =>
  name === 'view.observe' || name === 'view.click' || name === 'view.input'

export type ViewObservationIdentity = ObservationResult['identity']
export type ViewObservationSnapshot = DocumentSnapshot & { model: Extract<DocumentModel, { kind: 'course-v10' }> }
export interface ViewObservationCapture {
  identity: ViewObservationIdentity
  png: Uint8Array
  width: number
  height: number
  structure: readonly string[]
  diagnostics: readonly string[]
}

export function sameObservationTarget(a: ViewObservationIdentity, b: ViewObservationIdentity): boolean {
  return a.documentId === b.documentId && a.epoch === b.epoch && a.revision === b.revision
    && a.locationId === b.locationId && (a.stateId ?? null) === (b.stateId ?? null)
}

export function sameObservationIdentity(a: ViewObservationIdentity, b: ViewObservationIdentity): boolean {
  return sameObservationTarget(a, b) && a.viewGeneration === b.viewGeneration
}

export function observationSnapshotMatches(snapshot: DocumentSnapshot, identity: ViewObservationIdentity,
  projectId: string): snapshot is ViewObservationSnapshot {
  return snapshot.documentId === identity.documentId && snapshot.epoch === identity.epoch
    && snapshot.revision === identity.revision && snapshot.model.kind === 'course-v10'
    && snapshot.model.project.id === projectId
    && snapshot.model.project.surfaces.some(surface => surface.id === identity.locationId
      && (!identity.stateId || surface.presentation?.states.some(state => state.id === identity.stateId)))
}
