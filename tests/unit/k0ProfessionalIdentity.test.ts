// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentSourceAuthoringEdits } from '../../src/core/components/source/sourceAuthoringEdits'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library/insert'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { componentDefinitionBuiltinKey, type ComponentImplementation } from '../../src/shared/contracts/component-platform/project'

it('keeps professional authoring identity through shared source and library definition rebinding without replacing runtime source', () => {
  const project = createBlankCourseProjectV10('自定义专业组件')
  project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
  project.instances.text = { id: 'text', definitionId: 'text', data: { content: { inlines: [{ type: 'text', text: '可编辑' }] } } }
  project.surfaces[0].childIds = ['text']
  const implementation: ComponentImplementation = { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' }
  const edited = applyComponentOperation(project, captureComponentOperation(project,
    componentSourceAuthoringEdits({ kind: 'definition', definition: project.definitions.text }, implementation)))
  expect(componentDefinitionBuiltinKey(edited.definitions.text)).toBe('guoling.text')
  const insertion = prepareComponentLibraryInsertion(project, { schemaVersion: 1, id: 'reusable', title: '保留源码',
    definitions: { text: edited.definitions.text }, example: { instances: { text: edited.instances.text }, rootIds: ['text'] },
    assets: {}, resources: { assets: {}, components: {} } },
  { container: { kind: 'surface', surfaceId: project.surfaces[0].id }, index: 1 })
  const inserted = applyComponentOperation(project, insertion.command), id = insertion.identities.definitions.get('text')!
  expect(id).not.toBe('text')
  expect(componentDefinitionBuiltinKey(inserted.definitions[id])).toBe('guoling.text')
  expect(inserted.definitions[id].implementation).toMatchObject(implementation)
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project: inserted, resources: { assets: {}, components: {} } }))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  expect(componentDefinitionBuiltinKey(reopened.project.definitions[id])).toBe('guoling.text')
  const changedBuiltin = { ...inserted.definitions[id], implementation: { kind: 'builtin' as const, key: 'guoling.table' } }
  expect(componentDefinitionBuiltinKey(changedBuiltin)).toBe('guoling.table')
  expect(componentSourceAuthoringEdits({ kind: 'definition', definition: changedBuiltin }, implementation)[0]).toMatchObject({
    definition: { professionalBuiltinKey: 'guoling.table', implementation },
  })
})
