import { cloneDocumentResources } from '../../core/drivers/resources'
import type { DocumentEvent, DocumentModel, DocumentSnapshot } from '../../shared/workbench/document'
import type { DocumentFileObservation, DocumentHostRequest } from '../../shared/workbench/desktop'
import type { ExportBuildRequest } from '../../shared/workbench/toolPorts'

function uiDocumentModel(model: DocumentModel): DocumentModel {
  // V8 recovery can return small views into one large journal buffer. Electron's
  // contextBridge copies that backing per view, so send only each resource's bytes.
  return { ...model, resources: cloneDocumentResources(model.resources) }
}

/** Transport only: canonical models and the detached snapshot's identity remain unchanged. */
export function uiDocumentSnapshot(snapshot: DocumentSnapshot): DocumentSnapshot {
  return { ...snapshot, model: uiDocumentModel(snapshot.model) }
}

export function uiDocumentEvent(event: DocumentEvent): DocumentEvent {
  return event.type === 'changed' ? { ...event, snapshot: uiDocumentSnapshot(event.snapshot) } : event
}

export function uiExportBuildRequest(request: ExportBuildRequest): ExportBuildRequest {
  return { ...request, snapshot: uiDocumentSnapshot(request.snapshot) }
}

/** These are the document API's declared carriers, not an arbitrary JSON walk. */
export function uiDocumentResult(input: DocumentHostRequest, result: unknown): unknown {
  switch (input.type) {
    case 'list':
    case 'recoverable':
      return (result as DocumentSnapshot[]).map(uiDocumentSnapshot)
    case 'bootstrap-course':
    case 'create':
    case 'open':
    case 'read':
    case 'rename':
    case 'save':
    case 'save-dialog':
    case 'reconcile-file':
    case 'restore':
      return result === null ? null : uiDocumentSnapshot(result as DocumentSnapshot)
    case 'observe-file': {
      const observation = result as DocumentFileObservation
      return { ...observation, model: observation.model ? uiDocumentModel(observation.model) : null }
    }
    case 'reveal':
    case 'read-authoring-drafts':
    case 'write-authoring-drafts':
    case 'claim-authoring-drafts':
    case 'clear-authoring-drafts':
    case 'dispatch':
    case 'lookup':
    case 'close':
    case 'close-dialog':
    case 'discard-recovery':
      return result
  }
  const exhaustive: never = input
  return exhaustive
}
