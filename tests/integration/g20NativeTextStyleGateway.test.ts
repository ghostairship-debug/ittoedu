// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, TEXT_DEFINITION } from '../../src/components/text'
import { textComponentDataSchema } from '../../src/components/text/data'
import { resolveComponentPresentation } from '../../src/shared/contracts/component-platform/project'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { mutationCallSchema } from '../../src/core/tools/ToolCatalog'
it('commits public component text appearance in one named-state batch and preserves base, neighbors, frames, save/reopen and Undo', async () => {
  const driver = new CourseV10Driver(), project = createBlankCourseProjectV10('命名文字'), surfaceId = project.surfaces[0].id
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const data = createTextComponentData('标题'); data.appearance.emphasis = true; data.sizing.mode = 'fixed'
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)), frame: { width: 120, height: 90, transform: [1, 0, 0, 1, 40, 60] } }
  project.instances.neighbor = { ...structuredClone(project.instances.text), id: 'neighbor', frame: { width: 120, height: 90, transform: [1, 0, 0, 1, 300, 60] } }
  project.surfaces[0].childIds = ['text', 'neighbor']; project.surfaces[0].presentation = { states: [{ id: 'named-a', title: 'A', overrides: {} }, { id: 'named-b', title: 'B', overrides: {} }] }
  let serial = 0, saved = new Uint8Array()
  const registry = new DocumentRegistry({ drivers: [driver], createId: () => `style-${++serial}`, bindingKey: binding => binding.path, persistence: { async append() {}, async save(input) { saved = input.bytes.slice(); if (input.binding.kind !== 'file') throw new Error('File required'); return { ...input.binding, version: 'saved' } } } })
  const session = await registry.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'style.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], () => String(++serial))
  await gateway.beginRun({ runId: 'style', actor: 'agent', documents: [{ documentId: session.documentId, writable: [{ kind: 'course-surface', surfaceId, stateId: 'named-a' }] }] })
  const target = await gateway.issueTarget('style', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'text', stateId: 'named-a' })
  const other = await gateway.issueTarget('style', session.documentId, { kind: 'course-instance', surfaceId, instanceId: 'text', stateId: 'named-b' }), before = session.read()
  if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
  const properties = { data: { appearance: { fontFamily: 'Noto Sans SC', fontSize: 48, color: '#123456' } } }
  expect(mutationCallSchema.safeParse({ name: 'object.update', input: { target, properties } }).success).toBe(true)
  for (const properties of [{ nativeTextStyle: { fontSize: 48 } }, { nativeData: {} }, { inventedField: true }])
    expect(mutationCallSchema.safeParse({ name: 'object.update', input: { target, properties } }).success).toBe(false)
  expect(await gateway.execute('style', 'other', { name: 'object.update', input: { target: other, properties } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  expect(session.read()).toEqual(before)
  const result = await gateway.execute('style', 'text-and-style', { name: 'batch', input: { operations: [
    { name: 'text.replace', input: { target, content: '命名态 A 新正文😀' } }, { name: 'object.update', input: { target, properties } },
  ] } })
  expect(result, JSON.stringify(result)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const after = session.read(); if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.revision).toBe(before.revision + 1); expect(after.undoDepth).toBe(before.undoDepth + 1)
  const effective = resolveComponentPresentation(after.model.project, surfaceId, 'named-a'), text = textComponentDataSchema.parse(effective.instances.text.data)
  expect(text.content.inlines).toEqual([{ type: 'text', text: '命名态 A 新正文😀' }])
  expect(text.appearance).toMatchObject({ fontFamily: 'Noto Sans SC', fontSize: 48, color: '#123456', emphasis: true })
  expect(effective.instances.text.frame).toEqual(project.instances.text.frame)
  expect(after.model.project.instances).toEqual(project.instances)
  expect(resolveComponentPresentation(after.model.project, surfaceId, 'named-b').instances).toEqual(project.instances)
  await registry.save(session.documentId, { kind: 'file', path: 'named.h5lesson', version: null, bindingVersion: 0 })
  expect(driver.load(saved)).toEqual(after.model); expect(session.read().dirty).toBe(false)
  const current = session.read(); expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: 'undo', actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const undone = session.read().model
  if (undone.kind !== 'course-v10') throw new Error('Expected V10')
  expect({ ...undone.project, revision: before.model.project.revision }).toEqual(before.model.project)
  expect(undone.resources).toEqual(before.model.resources)
})
