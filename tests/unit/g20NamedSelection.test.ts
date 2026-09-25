// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createNamedSelectionFixture } from '../helpers/g20NamedSelectionFixture'
import { captureCourseObjectSelection, resolveSlideSelectionLayer, SelectionContextController, selectionReference } from '../../src/renderer/workbench/SelectionContextController'
import { executionDocumentReferenceSchema } from '../../src/shared/workbench/executionDesktop'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { buildSlideEditorView } from '../../src/core/tools/slideLayerView'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

it('M04 named selection retains its state through freeze and grants only that state while global/surface objects remain base', async () => {
  const f = createNamedSelectionFixture(), driver = new CourseV9Driver()
  const registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID, bindingKey: binding => binding.path, persistence: { async append() {}, async save() { throw new Error('unused') } } })
  const session = await registry.create(f.model, '命名态.h5lesson'), gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const capture = captureCourseObjectSelection(session.read(), f.locationId, ['scene-text', 'global-text', 'surface-text'], 'named-a')
  expect(capture.targets).toEqual([
    { kind: 'course-object', locationId: f.locationId, itemId: 'scene-text', stateId: 'named-a' },
    { kind: 'course-object', locationId: f.locationId, itemId: 'global-text' },
    { kind: 'course-object', locationId: f.locationId, itemId: 'surface-text' },
  ])
  const controller = new SelectionContextController(async () => session.read()), reference = executionDocumentReferenceSchema.parse(selectionReference(capture, false))
  controller.setManual(session.documentId, capture); controller.setPinned([reference])
  controller.setManual(session.documentId, captureCourseObjectSelection(session.read(), f.locationId, ['scene-text'], 'named-b'))
  expect(controller.getPinned(session.documentId)?.targets[0]).toMatchObject({ stateId: 'named-a' })
  expect(reference.writable).toEqual([])
  const named = capture.targets[0]
  await gateway.beginRun({ runId: 'run', actor: 'agent', documents: [{ documentId: session.documentId, writable: [named] }] })
  const readonly = await gateway.issueTarget('run', session.documentId, named, { readOnly: true })
  expect(await gateway.execute('run', 'readonly', { name: 'text.replace', input: { target: readonly, content: '不应写入' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const base = await gateway.issueTarget('run', session.documentId, { kind: 'course-object', locationId: f.locationId, itemId: 'scene-text' })
  expect(await gateway.execute('run', 'base', { name: 'text.replace', input: { target: base, content: '不能回退基础态' } })).toMatchObject({ kind: 'error', code: 'not-authorized' })
  const handle = await gateway.issueTarget('run', session.documentId, named)
  expect(await gateway.execute('run', 'named', { name: 'text.replace', input: { target: handle, content: '只修改 A' } })).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
  const model = session.read().model; if (model.kind !== 'course-v9') throw new Error('fixture')
  const read = (stateId: string | null) => buildSlideEditorView({ project: model.project, locationId: f.locationId, stateId }).layers.find(layer => layer.selectionId === 'scene-text')!.item
  expect(read(null)).toMatchObject({ content: { data: { text: '基础态正文' } } })
  expect(read('named-b')).toMatchObject({ content: { data: { text: '命名态 B 正文' } } })
  expect(read('named-a')).toMatchObject({ content: { data: { text: '只修改 A' } } })
  expect(session.read().undoDepth).toBe(1)
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
