// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { resolveComponentPresentation, type ComponentAuthoring, type JsonValue } from '../../src/shared/contracts/component-platform'

it('lists, reads and applies state authoring at the same instance through Session CAS and save reload', async () => {
  const authoring = (text: string): ComponentAuthoring => ({ records: { title: { kind: 'text',
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text } } } })
  const project = createBlankCourseProjectV10('Authoring files'), surfaceId = componentSurfaces(project)[0].id
  project.definitions.source = { id: 'source', title: 'Source', role: 'content', implementation: {
    kind: 'source', language: 'javascript', source: 'export default { mount() {} }' } }
  project.instances.source = { id: 'source', definitionId: 'source', data: 7 }
  project.instances.neighbor = { id: 'neighbor', definitionId: 'source', data: { title: 'Neighbor business' }, authoring: authoring('Neighbor') }
  testContainerInstance(project, 0).childIds = ['source', 'neighbor']
  testContainerInstance(project, 0).container.presentation = { states: [
    { id: 'local', title: 'Local', overrides: { source: { authoring: authoring('Local') } } },
    { id: 'sibling', title: 'Sibling', overrides: {} },
  ] }
  const driver = new CourseV10Driver(), resources = { assets: {}, components: {} }
  let savedBytes: Uint8Array | undefined
  const session = await DocumentSession.create({ documentId: 'authoring', epoch: 'epoch',
    binding: { kind: 'file', path: 'authoring.h5lesson', version: null, bindingVersion: 0 },
    model: { kind: 'course-v10', project, resources } }, driver, { async append() {}, async save(input) {
      savedBytes = input.bytes
      if (input.binding.kind !== 'file') throw new Error('Expected file binding')
      return input.binding
    } })
  const coordinator = new ComponentProjectFileCoordinator({ document: async () => session.read() as ComponentProjectSnapshot,
    scope: () => ({ kind: 'instance', instanceId: 'source', state: { surfaceId, stateId: 'local' } }),
    async source() { throw new Error('Only literal content is used') },
    async apply(_run, operationId, _digest, baseline, request) {
      if (request.intent !== 'canonical') throw new Error('Authoring file must use canonical edits')
      const receipt = await session.execute({ documentId: baseline.documentId, epoch: baseline.epoch, operationId,
        baseRevision: baseline.revision, actor: 'agent', mutation: { type: 'command', command: captureComponentOperation(baseline.model.project, request.edits) } })
      return { commit: receipt.status === 'applied' ? 'committed' : 'not_committed', usability: 'usable', delivery: 'not_requested',
        input: request, diagnostics: [], insertedIds: [], receipt }
    } })
  const files = componentProjectFiles(project, resources)
  const file = files.find(file => file.binding?.kind === 'instance-authoring' && file.binding.instanceId === 'source')!
  const neighbor = files.find(file => file.binding?.kind === 'instance-authoring' && file.binding.instanceId === 'neighbor')!
  expect(file.path).toMatch(/\.authoring\.json$/)
  expect(file.target).toEqual({ kind: 'instance', instanceId: 'source' })
  expect(JSON.parse(file.content!)).toEqual({})
  const listed = await coordinator.execute('run', 'list', 'list', 'project.list', {})
  expect(listed).toMatchObject({ kind: 'read', data: { files: expect.arrayContaining([{ path: file.path, type: 'data', note: expect.any(String) }]) } })
  expect(JSON.stringify(listed)).not.toContain(neighbor.path)
  expect(await coordinator.execute('run', 'read-neighbor', 'read-neighbor', 'project.read', { path: neighbor.path })).toMatchObject({ kind: 'error', code: 'not-found' })
  const read = await coordinator.execute('run', 'read', 'read', 'project.read', { path: file.path })
  if (read.kind !== 'read') throw new Error('Expected authoring source read')
  expect(JSON.parse((read.data as { content: string }).content)).toEqual(authoring('Local'))
  const before = session.read() as ComponentProjectSnapshot
  const humanEdits = presentationComponentEdits(before.model.project, surfaceId, 'local', [
    { type: 'authoring.set', instanceId: 'source', path: [], value: authoring('Human') as unknown as JsonValue },
  ])
  expect((await session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: 'human', baseRevision: before.revision,
    actor: 'human', mutation: { type: 'command', command: captureComponentOperation(before.model.project, humanEdits) } })).status).toBe('applied')
  const conflicted = await coordinator.execute('run', 'stale-apply', 'stale-apply', 'project.apply', { path: file.path, content: JSON.stringify(authoring('Stale')) })
  expect(conflicted).toMatchObject({ kind: 'read', data: { commit: 'not_committed', receipt: { status: 'conflict' } } })
  expect(resolveComponentPresentation((session.read() as ComponentProjectSnapshot).model.project, surfaceId, 'local').instances.source.authoring).toEqual(authoring('Human'))
  const refreshed = await coordinator.execute('run', 'refresh', 'refresh', 'project.read', { path: file.path })
  expect(refreshed).toMatchObject({ kind: 'read', data: { content: JSON.stringify(authoring('Human'), null, 2) } })
  const applied = await coordinator.execute('run', 'apply', 'apply', 'project.apply', { path: file.path, content: JSON.stringify(authoring('Agent after read')) })
  expect(applied).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
  await session.save()
  expect(savedBytes).toBeDefined()
  const reopened = driver.load(savedBytes!)
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(resolveComponentPresentation(reopened.project, surfaceId, 'local').instances.source.authoring).toEqual(authoring('Agent after read'))
  expect(resolveComponentPresentation(reopened.project, surfaceId, 'sibling').instances.source.authoring).toBeUndefined()
  expect(reopened.project.instances.source.data).toBe(7)
  expect(reopened.project.instances.source.authoring).toBeUndefined()
  expect(reopened.project.instances.neighbor).toEqual(project.instances.neighbor)
  expect(reopened.project.definitions.source.implementation).toEqual(project.definitions.source.implementation)
})
