// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'

it('applies a delayed local AI reply through Gateway while preserving human geometry and another object, and retains final CAS', async () => {
  const project = createBlankCourseProjectV10('在途共编'), driver = new CourseV10Driver()
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html: '<p>Original</p>', authoringRecords: {
    local: { kind: 'text', scope: { item: 'one' }, binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text: 'Human text' } },
  } } }
  project.instances.b = { id: 'b', definitionId: WEB_DEFINITION.id, data: { html: 'Other original' } }
  project.surfaces[0].childIds = ['a', 'b']
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => crypto.randomUUID(), bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, '共编.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], () => crypto.randomUUID())
  const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'a', dataPath: ['authoringRecords', 'local', 'overrides', 'text'] }
  await gateway.beginRun({ runId: 'ai', actor: 'agent', documents: [{ documentId: session.documentId, writable: [target] }] })
  const handle = await gateway.issueTarget('ai', session.documentId, target)
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const ai = wait.then(() => gateway.execute('ai', 'reply', { name: 'text.replace', input: { target: handle, content: 'AI continued' } }))
  const human = async (edits: ComponentEdit[]) => {
    const current = session.read()
    if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
    return session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      operationId: crypto.randomUUID(), actor: 'human', mutation: { type: 'command', command: captureComponentOperation(current.model.project, edits) } })
  }
  expect(await human([{ type: 'data.set', instanceId: 'a', path: ['authoringRecords', 'local', 'overrides', 'geometry'], value: { translateX: 40, width: 220 } },
    { type: 'data.set', instanceId: 'b', path: ['html'], value: 'Human changed B' }])).toMatchObject({ status: 'applied' })
  release()
  expect(await ai).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const current = session.read()
  if (current.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(webDataSchema.parse(current.model.project.instances.a.data).authoringRecords!.local.overrides).toEqual({ text: 'AI continued', geometry: { translateX: 40, width: 220 } })
  expect(webDataSchema.parse(current.model.project.instances.b.data).html).toBe('Human changed B')
  const stale = await gateway.issueTarget('ai', session.documentId, target)
  expect(await human([{ type: 'data.set', instanceId: 'a', path: target.dataPath, value: 'Human changed same text' }])).toMatchObject({ status: 'applied' })
  expect(await gateway.execute('ai', 'conflicted-reply', { name: 'text.replace', input: { target: stale, content: 'Stale AI' } })).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: 'stale-final-cas', actor: 'agent',
    mutation: { type: 'command', command: captureComponentOperation(current.model.project, [{ type: 'data.set', instanceId: 'a', path: target.dataPath, value: 'Stale AI' }]) } })).toMatchObject({ status: 'conflict', code: 'stale-revision' })
})
