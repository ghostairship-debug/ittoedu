// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { prepareCourseObjectPaste } from '../../src/renderer/composition/crossSurfaceCommands'
import { componentDefinitionPresentation, componentFieldPresentation } from '../../src/renderer/ui/properties/componentDefinitionPresentation'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import { resolveComponentPresentation, type JsonObject } from '../../src/shared/contracts/component-platform/project'
import type { CapturedCourseTarget } from '../../src/renderer/documents/CourseV10DocumentBridge'

function fixture() {
  const project = createBlankCourseProjectV10('完整作者对象')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.a = { id: 'a', definitionId: WEB_DEFINITION.id, data: { html: 'Base' }, frame: { width: 100, height: 30, transform: [1, 0, 0, 1, 10, 20] } }
  project.surfaces[0].childIds = ['a']
  return project
}
it('enforces inherited author locks for data, frame and named-state edits while allowing an explicit unlock', () => {
  const project = fixture()
  project.instances.group = { id: 'group', definitionId: WEB_DEFINITION.id, data: { html: '' }, childIds: ['a'], locked: true }
  project.surfaces[0].childIds = ['group']
  for (const edits of [
    [{ type: 'data.set' as const, instanceId: 'a', path: ['html'], value: 'Changed' }],
    [{ type: 'frame.set' as const, instanceId: 'a', frame: { width: 200, height: 30, transform: [1, 0, 0, 1, 10, 20] as [number, number, number, number, number, number] } }],
    [{ type: 'surface.presentation.set' as const, surfaceId: project.surfaces[0].id, presentation: { states: [{ id: 'answer', title: '答案', overrides: { a: { visible: false } } }] } }],
  ]) expect(() => applyComponentOperation(project, captureComponentOperation(project, edits))).toThrow('已锁定')
  const unlocked = applyComponentOperation(project, captureComponentOperation(project, [
    { type: 'instance.patch', instanceId: 'group', patch: { locked: false } },
    { type: 'data.set', instanceId: 'a', path: ['html'], value: 'Changed' },
  ]))
  expect(webDataSchema.parse(unlocked.instances.a.data).html).toBe('Changed')
  expect(webDataSchema.parse(project.instances.a.data).html).toBe('Base')
})
it('copies base values, all named states and local records in one undoable saved transaction', async () => {
  const project = fixture(), surfaceId = project.surfaces[0].id
  project.instances.a.data = { html: 'Base', authoringRecords: { local: { kind: 'text', scope: { item: 'a' },
    binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' }, overrides: { text: 'Human', geometry: { translateX: 12 } } } } }
  project.surfaces[0].presentation = { states: [
    { id: 'question', title: '问题', overrides: { a: { visible: false } }, order: ['a'] },
    { id: 'answer', title: '答案', overrides: { a: { data: { html: 'Answer' }, frame: { width: 150, height: 40, transform: [1, 0, 0, 1, 40, 60] } } }, order: ['a'] },
  ] }
  const resources = { assets: {}, components: {} }
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, resources,
    editingProject: resolveComponentPresentation(project, surfaceId, 'answer'), activeStateId: 'answer', surfaceId, instanceIds: ['a'], instanceId: 'a' }
  const plan = prepareCourseObjectPaste({ documentId: 'doc', project, roots: ['a'], resources },
    { capturedTarget: target, container: { kind: 'surface', surfaceId }, index: 1, keepOwner: true, offset: { x: 20, y: 20 } })
  const driver = new CourseV10Driver(), session = await DocumentSession.create({ documentId: 'doc', epoch: 'epoch',
    model: { kind: 'course-v10', project, resources }, binding: { kind: 'untitled', suggestedName: 'copy.h5lesson' } }, driver,
  { async append() {}, async save() { throw new Error('Archive check uses the real Driver') } })
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'copy', baseRevision: 0, actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, plan.edits) } })).toMatchObject({ status: 'applied' })
  const snapshot = session.read(), model = snapshot.model
  if (model.kind !== 'course-v10') throw new Error('Expected V10')
  const id = plan.idMap.get('a')!, copied = model.project.instances[id]
  expect(webDataSchema.parse(copied.data).authoringRecords).toEqual(webDataSchema.parse(project.instances.a.data).authoringRecords)
  expect(webDataSchema.parse(copied.data).html).toBe('Base')
  expect(model.project.surfaces[0].presentation?.states[0].overrides[id]).toEqual({ visible: false })
  expect(model.project.surfaces[0].presentation?.states[1].overrides[id]).toMatchObject({ data: { html: 'Answer' }, frame: { transform: [1, 0, 0, 1, 60, 80] } })
  expect(model.project.surfaces[0].presentation?.states[1].order).toEqual(['a', id])
  const reopened = driver.load(driver.serialize(model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(reopened.project.instances.a).toEqual(project.instances.a)
  expect(snapshot.undoDepth).toBe(1)
  expect(await session.execute({ documentId: 'doc', epoch: 'epoch', operationId: 'undo', baseRevision: snapshot.revision, actor: 'human', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
  const restored = session.read().model
  if (restored.kind !== 'course-v10') throw new Error('Expected V10')
  expect(restored.project.instances).toEqual(project.instances)
})
it('keeps professional presentation and field metadata for source-customized definitions', () => {
  const definition = { ...WEB_DEFINITION, implementation: { kind: 'source' as const, language: 'javascript' as const, source: 'export default {}' }, professionalBuiltinKey: 'guoling.web', dataSchema: {} as JsonObject }
  expect(componentDefinitionPresentation(definition).builtinKey).toBe('guoling.web')
  expect(componentFieldPresentation(definition, ['html']).label).toBe('HTML 内容')
})
