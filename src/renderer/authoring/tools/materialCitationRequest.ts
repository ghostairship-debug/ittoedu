import type { MaterialRecordV1 } from '../../../shared/materialContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { courseAuthoringScopeFromLocation } from '../courseAuthoringScope'

export function createMaterialCitationRequest(input: {
  document: CourseProjectDocument; locationId: string; sessionGeneration: number; material: MaterialRecordV1
}) {
  const { document, locationId, sessionGeneration, material } = input
  const scope = courseAuthoringScopeFromLocation({ project: document, locationId })
  const surfaceType = document.surfaces.find(surface => surface.id === scope.surfaceId)!.type
  return { version: 1, requestId: crypto.randomUUID(), tool: 'material.citation', input: material,
    destination: { kind: 'create', scope: {
      projectId: document.id, documentRevision: document.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration,
      surfaceType, surfaceId: scope.surfaceId, locationId: scope.locationId, stateId: scope.stateId,
      owner: scope.owner, ownerKey: scope.ownerKey,
      parent: surfaceType === 'flow' ? { kind: 'flow-body', parentBlockId: null } : { kind: 'owner' }, insertion: { kind: 'append' },
    } },
  }
}
