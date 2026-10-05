// @vitest-environment node
import { expect, it } from 'vitest'
import { reboundSavedDocumentBinding } from '../../src/main/workbench/execution/savedDocumentBinding'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { SavedCourseIdentity } from '../../src/shared/workbench/documentSave'

it('updates a formal file location while preserving the original save proof for a dirty recovered session', () => {
  const saved: SavedCourseIdentity = { kind: 'course-v10', path: 'old.h5lesson', projectId: 'project',
    epoch: 'saved-session', savedRevision: 3, fileVersion: 'saved-file' }
  const snapshot = { documentId: 'document', epoch: 'restored-session', revision: 7, dirty: true,
    binding: { kind: 'file', path: 'renamed.h5lesson', version: 'saved-file', bindingVersion: 2 },
    model: { kind: 'course-v10', project: { id: 'project' } } } as DocumentSnapshot
  expect(reboundSavedDocumentBinding(snapshot, saved)).toEqual({ ...saved, path: 'renamed.h5lesson' })
  expect(reboundSavedDocumentBinding({ ...snapshot,
    binding: { ...snapshot.binding, kind: 'file', path: 'moved.h5lesson', version: 'external-change', bindingVersion: 3 } }, saved))
    .toEqual({ ...saved, path: 'moved.h5lesson' })
  expect(reboundSavedDocumentBinding({ ...snapshot, binding: { kind: 'untitled', suggestedName: 'copy' } }, saved)).toBeUndefined()
  expect(reboundSavedDocumentBinding({ ...snapshot, model: { ...snapshot.model,
    project: { id: 'another-project' } } } as DocumentSnapshot, saved)).toBeUndefined()
})
