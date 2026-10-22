import type { DocumentSnapshot } from '../../../shared/workbench/document'
import type { ViewObservationIdentity } from '../../../shared/workbench/viewObservation'

/** An identity read never materializes the document's content or resources. */
export interface ViewObservationDocumentIdentity {
  documentId: string
  epoch: string
  revision: number
  kind: DocumentSnapshot['model']['kind']
}

export function observationDocumentIdentityMatches(current: ViewObservationDocumentIdentity, identity: ViewObservationIdentity): boolean {
  return current.documentId === identity.documentId && current.epoch === identity.epoch
    && current.revision === identity.revision && current.kind === 'course-v10'
}
