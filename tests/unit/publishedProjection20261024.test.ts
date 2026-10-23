import { expect, it } from 'vitest'
import { publishedComponentModel, resolveModelPlayerPresentation } from '../../src/player/componentPlatform/publishedProjection'
import type { PublishedCourseV3 } from '../../src/shared/contracts/component-platform/published'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { TeacherControllerPort } from '../../src/shared/contracts/component-platform/teacherController'

it('projects published metadata and logical identities without retaining delivery URLs or altering the payload', () => {
  const payload = { schemaVersion: 4, id: 'projection', title: 'Projection', definitions: {}, instances: {}, rootIds: [],
    global: { underlay: [], overlay: [] }, assets: { 'photo / one': { id: 'photo / one', filename: 'original.webp',
      mimeType: 'image/webp', url: 'data:image/webp;base64,YQ==', width: 800, height: 500 } } } as unknown as PublishedCourseV3
  const before = structuredClone(payload), model = publishedComponentModel(payload)
  expect(model).toMatchObject({ kind: 'course-v10', project: { schemaVersion: 11, revision: 0, id: payload.id,
    assets: { 'photo / one': { id: 'photo / one', filename: 'original.webp', path: 'assets/photo%20%2F%20one', width: 800, height: 500 } } },
    resources: { assets: {}, components: {} } })
  expect(model.project.assets['photo / one']).not.toHaveProperty('url')
  expect(model.project.instances).toBe(payload.instances)
  expect(model.project.definitions).toBe(payload.definitions)
  expect(payload).toEqual(before)
})

it('applies parent then nested presentation to one disposable projection and leaves the source untouched', () => {
  const source: CourseProjectV10 = { schemaVersion: 11, id: 'nested', revision: 3, title: 'Nested', rootIds: ['parent'], assets: {},
    global: { underlay: [], overlay: [] }, definitions: {}, instances: {
      parent: { id: 'parent', definitionId: 'slide', data: {}, childIds: ['child'], container: { kind: 'slide', presentation: {
        states: [{ id: 'detail', title: 'Parent', overrides: { leaf: { data: 'parent value', frame: { width: 300, height: 100, transform: [1, 0, 0, 1, 5, 6] } } } }] } } },
      child: { id: 'child', definitionId: 'slide', data: {}, childIds: ['leaf'], container: { kind: 'slide', presentation: {
        states: [{ id: 'detail', title: 'Child', overrides: { leaf: { data: 'child value' } } }] } } },
      leaf: { id: 'leaf', definitionId: 'text', data: 'author value' },
    } }
  const before = structuredClone(source), visited: string[] = []
  const navigation = { forContainer: (id: string) => { visited.push(id); return { currentStateId: () => 'detail' } } } as unknown as TeacherControllerPort
  const projected = resolveModelPlayerPresentation(source, navigation)
  expect(visited).toEqual(['parent', 'child'])
  expect(projected.instances.leaf).toMatchObject({ data: 'child value', frame: { width: 300, height: 100 } })
  expect(source).toEqual(before)
  expect(resolveModelPlayerPresentation(source)).toBe(source)
})
