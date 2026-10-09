// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { captureCourseObjectSelection, resolveSlideSelectionLayer, SelectionContextController, selectionReference } from '../../src/renderer/workbench/SelectionContextController'
import { executionDocumentReferenceSchema } from '../../src/shared/workbench/executionDesktop'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createCurrentSelectionFixture } from '../helpers/g20CurrentSelectionFixture'
import { readCourseInstanceText } from '../../src/core/tools/ToolTargets'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

it('freezes current named-state instance selections and pins, refusing read-only, other-state and base writes without broadening the grant', async () => {
  const f = createCurrentSelectionFixture(), driver = new CourseV10Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(f.model, 'named.glx'), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const capture = captureCourseObjectSelection(session.read(), f.surfaceId, ['scene-text', 'global-text'], 'named-a')
  expect(capture.targets).toEqual(['scene-text', 'global-text'].map(instanceId => ({ kind: 'course-instance', surfaceId: f.surfaceId, instanceId, stateId: 'named-a' })))
  const controller = new SelectionContextController(async () => session.read()), reference = executionDocumentReferenceSchema.parse(selectionReference(capture, false))
  controller.setManual(session.documentId, capture); controller.setPinned([reference])
  controller.setManual(session.documentId, captureCourseObjectSelection(session.read(), f.surfaceId, ['scene-text'], 'named-b'))
  expect(controller.getPinned(session.documentId)?.targets).toEqual(capture.targets)
  expect(reference.writable).toEqual([])
  const named = capture.targets[0]
  if (named.kind !== 'course-instance') throw new Error('Expected current instance selection')
  await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [named] }] })
  const before = session.read()
  for (const [operation, target, readOnly] of [
    ['readonly', named, true], ['base', { ...named, stateId: null }, false], ['other-state', { ...named, stateId: 'named-b' }, false],
    ['unselected-global', capture.targets[1], false],
  ] as const) {
    const handle = await gateway.issueTarget('run', session.documentId, target, { readOnly })
    expect(await gateway.execute('run', operation, { name: 'text.replace', input: { target: handle, content: 'BAD' } })).toMatchObject({ code: 'not-authorized' })
    expect(session.read()).toEqual(before)
  }
  const handle = await gateway.issueTarget('run', session.documentId, named)
  expect(await gateway.execute('run', 'named', { name: 'text.replace', input: { target: handle, content: '只修改 A' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const model = session.read().model
  if (model.kind !== 'course-v10') throw new Error('Expected current course')
  const text = (stateId: string | null) => readCourseInstanceText(model, { kind: 'course-instance', surfaceId: f.surfaceId, instanceId: 'scene-text', stateId })
  expect(text(null)).toMatchObject({ inlines: [{ text: '基础态正文' }] })
  expect(text('named-b')).toMatchObject({ inlines: [{ text: '命名态 B 正文' }] })
  expect(text('named-a')).toMatchObject({ inlines: [{ text: '只修改 A' }] })
  expect(model.project.instances['global-text']).toEqual(f.project.instances['global-text'])
  expect(session.read().undoDepth).toBe(1)
  expect(driver.load(driver.serialize(model))).toEqual(model)
  expect(() => captureCourseObjectSelection(session.read(), f.surfaceId, ['scene-text'], 'missing')).toThrow()
})
it('M04 preview resolves materialized named-state content and refuses another state or a base fallback', () => {
  const f = createNamedSelectionFixture(), a = buildSlideEditorView({ project: f.model.project, locationId: f.locationId, stateId: 'named-a' }), b = buildSlideEditorView({ project: f.model.project, locationId: f.locationId, stateId: 'named-b' })
  const target = { kind: 'course-object' as const, locationId: f.locationId, itemId: 'scene-text', stateId: 'named-a' }
  expect(resolveSlideSelectionLayer(a, target)?.item).toMatchObject({ frame: { x: 160 }, content: { data: { text: '命名态 A 正文' } } })
  expect(resolveSlideSelectionLayer(b, target)).toBeUndefined()
  expect(resolveSlideSelectionLayer(a, { ...target, stateId: undefined })).toBeUndefined()
  expect(resolveSlideSelectionLayer(b, { kind: 'course-object', locationId: f.locationId, itemId: 'global-text' })?.item).toMatchObject({ content: { data: { text: '全局基础对象' } } })
  const snapshot: DocumentSnapshot = { documentId: 'doc', epoch: 'epoch', revision: 0, model: f.model, binding: { kind: 'untitled', suggestedName: 'x.h5lesson' }, dirty: false, saving: false, recoverable: true, undoDepth: 0, redoDepth: 0 }
  expect(() => captureCourseObjectSelection(snapshot, f.locationId, ['scene-text'], 'missing')).toThrow()
})
