// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { resolveComponentPresentation } from '../../src/shared/contracts/component-platform/project'
import { readCourseInstanceText } from '../../src/core/tools/ToolTargets'
import { captureCourseObjectSelection, selectionReference } from '../../src/renderer/workbench/SelectionContextController'

it('M04-T04 two same-page selected objects stay independently writable through the same run', async () => {
  const fixture = createCurrentSelectionFixture(), driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(fixture.model, '多选.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const selection = captureCourseObjectSelection(session.read(), fixture.surfaceId, ['scene-text', 'scene-other'], 'named-a')
  const reference = selectionReference(selection, true)
  expect(reference.writable).toEqual(selection.targets)
  await gateway.beginRun({ runId: 'multi-run', actor: 'agent', documents: [{ documentId: session.documentId, writable: reference.writable }] })
  const handles = await Promise.all(selection.targets.map(target => gateway.issueTarget('multi-run', session.documentId, target)))
  const replacement = ['多选甲已修改', '多选乙已修改']
  for (const [index, handle] of handles.entries()) {
    expect(await gateway.execute('multi-run', `replace-${index}`, { name: 'text.replace', input: { target: handle, content: replacement[index] } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  }
  const after = session.read(), model = after.model
  if (model.kind !== 'course-v10') throw new Error('fixture')
  const text = (stateId: string | null, id: string) => readCourseInstanceText({ ...model, project: resolveComponentPresentation(model.project, fixture.surfaceId, stateId) },
    { kind: 'course-instance', surfaceId: fixture.surfaceId, instanceId: id, stateId: null })
  expect(text('named-a', 'scene-text')).toMatchObject({ inlines: [{ text: replacement[0] }] })
  expect(text('named-a', 'scene-other')).toMatchObject({ inlines: [{ text: replacement[1] }] })
  expect(text('named-b', 'scene-text')).toMatchObject({ inlines: [{ text: '命名态 B 正文' }] })
  expect(text(null, 'scene-text')).toMatchObject({ inlines: [{ text: '基础态正文' }] })
  expect(model.resources).toEqual(fixture.model.resources)
  expect(driver.load(driver.serialize(model))).toEqual(model)
  expect(after.undoDepth).toBe(2)
  for (let index = 0; index < 2; index++) {
    const current = session.read()
    expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: randomUUID(), baseRevision: current.revision,
      actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  }
  const reverted = session.read()
  if (reverted.model.kind !== 'course-v10') throw new Error('fixture')
  expect(reverted.model.project.surfaces).toEqual(fixture.model.project.surfaces)
  expect(reverted.model.project.global).toEqual(fixture.model.project.global)
  expect(reverted.undoDepth).toBe(0)
})
