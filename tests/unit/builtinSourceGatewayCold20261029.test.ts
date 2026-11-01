// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

it('prepares a cold builtin Source before object.update reads the deferred author entry', async () => {
  vi.resetModules()
  const [{ createBlankCourseProjectV10 }, { CourseV10Driver }, { DocumentRegistry }, { DocumentToolGateway }, sources] = await Promise.all([
    import('../../src/core/course/createCourseProjectV10'), import('../../src/core/drivers/CourseV10Driver'),
    import('../../src/core/documents/DocumentRegistry'), import('../../src/core/tools/DocumentToolGateway'),
    import('../../src/core/components/source/builtinSources'),
  ])
  const project = createBlankCourseProjectV10('Cold Source update'), driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw Error('Serialization is checked directly') } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'cold.glx')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  await gateway.beginRun({ runId: 'cold-source', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'document' }] }] })
  const call = (name: string, input: Record<string, unknown>) => gateway.execute('cold-source', randomUUID(), { name, input })
  const surface = await gateway.issueTarget('cold-source', session.documentId, { kind: 'course-surface', surfaceId: project.rootIds[0] })
  expect(sources.hasBuiltinComponentSource('guoling.shape')).toBe(false)
  const inserted = await call('object.insert', { target: surface, kind: 'shape', shapeType: 'rounded-rectangle', x: 20, y: 20, width: 300, height: 180 })
  expect(inserted, JSON.stringify(inserted)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  if (inserted.kind !== 'document-operation') throw Error('Insert failed')
  expect(sources.hasBuiltinComponentSource('guoling.shape')).toBe(false)
  const before = session.read(), source = 'export default { mount({root}) { root.textContent="cold source ready"; return {update(){},dispose(){root.replaceChildren()}} } }'
  const changed = await call('object.update', { target: inserted.affected[0], properties: { label: 'Cold custom control', implementation: { kind: 'source', language: 'javascript', source } } })
  expect(changed, JSON.stringify(changed)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  expect(sources.hasBuiltinComponentSource('guoling.shape')).toBe(true)
  const after = session.read()
  expect(after.undoDepth - before.undoDepth).toBe(1)
  if (after.model.kind !== 'course-v10' || before.model.kind !== 'course-v10') throw Error('Wrong model')
  const id = Object.keys(after.model.project.instances).find(id => id !== project.rootIds[0])!
  expect(after.model.project.instances[id].implementationOverride).toMatchObject({ kind: 'source', source })
  expect(after.model.project.instances[id].data).toEqual(before.model.project.instances[id].data)
  expect(after.model.project.instances[project.rootIds[0]]).toEqual(before.model.project.instances[project.rootIds[0]])
  const reopened = await driver.load(await driver.serialize(after.model))
  expect(reopened).toEqual(after.model)
  const [{ componentCompilationInput }, { createEsbuildComponentCompiler }] = await Promise.all([
    import('../../src/core/components/compilation/componentCompilationInput'), import('../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'),
  ])
  const implementation = after.model.project.instances[id].implementationOverride!
  if (implementation.kind !== 'source') throw Error('Expected Source implementation')
  expect((await createEsbuildComponentCompiler().compile(componentCompilationInput(after.model.project, implementation, after.model.resources))).status).toBe('ready')
}, 60000)
