// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createDocumentJournal, readDocumentFileVersion } from '../../src/main/workbench/documentJournal'
import type { DocumentModel, DocumentSnapshot, DurableDocumentState } from '../../src/shared/workbench/document'
import type { LegacyCourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory)
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(resolved, { recursive: true, force: true })
  }
})

function legacyProject(revision: number, collision: boolean, title = 'Retained work'): LegacyCourseProjectV10 {
  return { schemaVersion: 10, id: 'same-work', revision, title,
    definitions: { group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'group' } } },
    instances: { content: { id: 'content', definitionId: 'group', data: { text: 'Keep content' } },
      ...(collision ? { scene: { id: 'scene', definitionId: 'group', data: { text: 'Deleted object' } } } : {}) },
    surfaces: [{ id: 'scene', kind: 'slide', title: 'Retained page', childIds: collision ? ['content', 'scene'] : ['content'] }],
    global: { underlay: [], overlay: [] }, assets: {} }
}

const material = (project: unknown) => ({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }) as DocumentModel
const archive = (project: unknown) => zipSync({ 'project.json': strToU8(JSON.stringify(project)) })

it('retains the restored container identity when the same bound V10 file is externally changed and reconciled', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-disk-identity-')); directories.push(directory)
  const journalDirectory = path.join(directory, 'documents'), filename = path.join(directory, 'retained.glx')
  const before = material(legacyProject(6, true)), currentProject = legacyProject(7, false), current = material(currentProject)
  await fs.writeFile(filename, archive(currentProject))
  const version = await readDocumentFileVersion(filename, 'course-v10')
  const input: DurableDocumentState = { schemaVersion: 2, disposition: 'active', documentId: 'retained', epoch: 'old-epoch', sequence: 2,
    revision: 7, savedRevision: 7, model: current, savedModel: current,
    binding: { kind: 'file', path: filename, version, bindingVersion: 1 },
    past: [{ operationId: 'delete-old-object', actor: 'human', beforeRevision: 6, revision: 7, before, after: current }], future: [],
    operations: [], stoppedRuns: [] }
  await createDocumentJournal({ directory: journalDirectory }).append(input)
  const originalHost = new DocumentHostService(journalDirectory)
  await originalHost.internalAPI.restore(input.documentId)
  const retained = await createDocumentJournal({ directory: journalDirectory }).inspect(input.documentId)
  expect(retained).toMatchObject({ courseProjectMigrationIds: { surfaceIds: { scene: 'container:scene' } },
    model: { project: { schemaVersion: 11 } }, past: [{ before: { project: { schemaVersion: 11 } } }] })
  // Cold restore reads only converted models; the old namespace relation must survive independently.
  const host = new DocumentHostService(journalDirectory)
  const restored = await host.internalAPI.restore(input.documentId)
  expect(restored).not.toHaveProperty('courseProjectMigrationIds')
  expect(restored.model).not.toHaveProperty('courseProjectMigrationIds')
  if (restored.model.kind !== 'course-v10') throw new Error('expected work project')
  const restoredRootId = restored.model.project.rootIds[0]
  expect(restoredRootId).not.toBe('scene')

  await fs.writeFile(filename, archive(legacyProject(7, false, 'Externally retitled')))
  const observation = await host.observeFile(restored.documentId)
  expect(observation.version).not.toBe(version)
  if (observation.model?.kind !== 'course-v10') throw new Error('expected disk work project')
  expect(observation.model.project.title).toBe('Externally retitled')
  const reconciled: DocumentSnapshot = await host.reconcileFile({ documentId: restored.documentId, epoch: restored.epoch,
    baseRevision: restored.revision, bindingVersion: observation.bindingVersion, version: observation.version, choice: 'disk' })
  expect(reconciled).toMatchObject({ undoDepth: 2, model: { project: { title: 'Externally retitled', rootIds: [restoredRootId] } } })
  if (reconciled.model.kind !== 'course-v10') throw new Error('expected reconciled work project')
  expect(observation.model.project.rootIds).toEqual([restoredRootId])
  expect(reconciled.model.project.instances.content.data).toEqual({ text: 'Keep content' })
  expect(reconciled.model.project.instances.scene).toBeUndefined()
})

it('retains the initial V10 open identity after an external edit removes the colliding object', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glx-open-identity-')); directories.push(directory)
  const filename = path.join(directory, 'retained.glx'), journalDirectory = path.join(directory, 'documents')
  await fs.writeFile(filename, archive(legacyProject(7, true)))
  const host = new DocumentHostService(journalDirectory), opened = await host.open(filename)
  if (opened.model.kind !== 'course-v10') throw new Error('expected work project')
  const rootId = opened.model.project.rootIds[0]
  expect(rootId).not.toBe('scene')
  await fs.writeFile(filename, archive(legacyProject(8, false, 'Updated externally')))
  const observed = await host.observeFile(opened.documentId)
  const adopted = await host.reconcileFile({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
    bindingVersion: observed.bindingVersion, version: observed.version, choice: 'disk' })
  expect(adopted).toMatchObject({ undoDepth: 1, model: { project: { rootIds: [rootId], title: 'Updated externally' } } })
  expect(adopted.model).not.toHaveProperty('courseProjectMigrationIds')

  const withNewSurface = legacyProject(9, false, 'New external page')
  withNewSurface.instances['new-page'] = { id: 'new-page', definitionId: 'group', data: { text: 'New colliding object' } }
  withNewSurface.surfaces.push({ id: 'new-page', kind: 'slide', title: 'New page', childIds: ['new-page'] })
  await fs.writeFile(filename, archive(withNewSurface))
  const added = await host.observeFile(opened.documentId)
  expect(added).not.toHaveProperty('courseProjectMigrationIds')
  const addedSnapshot = await host.reconcileFile({ documentId: adopted.documentId, epoch: adopted.epoch, baseRevision: adopted.revision,
    bindingVersion: added.bindingVersion, version: added.version, choice: 'disk' })
  expect(addedSnapshot).toMatchObject({ model: { project: { rootIds: [rootId, 'container:new-page'] } } })

  delete withNewSurface.instances['new-page']
  withNewSurface.surfaces[1].childIds = []
  await fs.writeFile(filename, archive(withNewSurface))
  const removed = await host.observeFile(opened.documentId)
  const removedSnapshot = await host.reconcileFile({ documentId: addedSnapshot.documentId, epoch: addedSnapshot.epoch, baseRevision: addedSnapshot.revision,
    bindingVersion: removed.bindingVersion, version: removed.version, choice: 'disk' })
  expect(removedSnapshot).toMatchObject({ model: { project: { rootIds: [rootId, 'container:new-page'] } } })
})
