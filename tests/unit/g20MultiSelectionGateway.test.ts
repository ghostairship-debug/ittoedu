// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'
import { captureCourseObjectSelection, selectionReference } from '../../src/renderer/workbench/SelectionContextController'

it('M04-T04 two same-page selected objects stay independently writable through the same run', async () => {
  const fixture = createNamedSelectionFixture(), driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(fixture.model, '多选.h5lesson')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const selection = captureCourseObjectSelection(session.read(), fixture.locationId, ['scene-text', 'scene-other'], 'named-a')
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
  if (model.kind !== 'course-v9') throw new Error('fixture')
  const item = (stateId: string | null, id: string) => buildSlideEditorView({ project: model.project, locationId: fixture.locationId, stateId })
    .layers.find(layer => layer.selectionId === id)?.item
  expect(item('named-a', 'scene-text')).toMatchObject({ content: { data: { text: replacement[0] } } })
  expect(item('named-a', 'scene-other')).toMatchObject({ content: { data: { text: replacement[1] } } })
  expect(item('named-b', 'scene-text')).toMatchObject({ content: { data: { text: '命名态 B 正文' } } })
  expect(item(null, 'scene-text')).toMatchObject({ content: { data: { text: '基础态正文' } } })
  expect(after.undoDepth).toBe(2)
  for (let index = 0; index < 2; index++) {
    const current = session.read()
    expect(await session.execute({ documentId: current.documentId, epoch: current.epoch, operationId: randomUUID(), baseRevision: current.revision,
      actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  }
  const reverted = session.read()
  if (reverted.model.kind !== 'course-v9') throw new Error('fixture')
  expect(reverted.model.project.surfaces).toEqual(fixture.model.project.surfaces)
  expect(reverted.model.project.globalLayerItems).toEqual(fixture.model.project.globalLayerItems)
  expect(reverted.undoDepth).toBe(0)
})
