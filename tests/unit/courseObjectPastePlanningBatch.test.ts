import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { testContainerInstance } from '../helpers/glxWorkFixture'
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import * as library from '../../src/core/components/library'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseObjectPastePlanningBatch } from '../../src/core/course/courseObjectEdits'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { ComponentEdit } from '../../src/shared/contracts/component-platform/operations'
import type { DocumentResources } from '../../src/shared/workbench/document'

afterEach(() => vi.restoreAllMocks())
const bytes = (text: string) => new TextEncoder().encode(text)
function fixture() {
  const project = createBlankCourseProjectV10('Source closure'), resources: DocumentResources = { assets: { photo: bytes('<svg/>') },
    components: { owner: { 'main.js': bytes("import shared from './shared'; export default shared") } } }
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript',
    workspace: { ownerId: 'owner', entry: 'main.js' }, moduleBindings: { './shared': 'shared' } } }
  project.definitions.shared = { id: 'shared', role: 'content', implementation: { kind: 'source', language: 'javascript',
    source: "export default { mount(context) { context.resources.url('picture'); return { dispose() {} } } }", resourceBindings: { picture: 'photo' } } }
  project.instances.source = { id: 'source', definitionId: 'source', data: { caption: 'Original' } }
  testContainerInstance(project, 0).childIds = ['source']
  project.assets.photo = { id: 'photo', path: 'assets/photo.svg', mimeType: 'image/svg+xml' }
  return { kind: 'course-v10' as const, project, resources }
}

it('reuses the same Source closure within a batch while giving every copy independent identities and bytes', () => {
  const driver = new CourseV10Driver(), original = fixture(), before = structuredClone(original)
  const extraction = vi.spyOn(library, 'extractComponentLibraryEntry'), copies = createCourseObjectPastePlanningBatch(), planning = driver.beginPlanningBatch(original)
  let model = original
  const ids: string[] = [], owners: string[] = []
  for (let index = 0; index < 5; index++) {
    const surface = componentSurfaces(model.project)[0]
    const copy = copies.prepare({ documentId: 'same', project: model.project, resources: model.resources, roots: ['source'] },
      { capturedTarget: { documentId: 'same', ...model, surfaceId: surface.id }, container: { kind: 'surface', surfaceId: surface.id }, index: testContainerInstance(model.project, 0).childIds.length })
    const command = captureComponentOperation(model.project, copy.edits)
    model = planning.apply(command) as typeof original
    copies.applied(command.edits)
    const id = copy.rootIds[0], implementation = model.project.definitions[model.project.instances[id].definitionId].implementation
    if (implementation.kind !== 'source' || !implementation.workspace) throw new Error('workspace copy required')
    ids.push(id); owners.push(implementation.workspace.ownerId)
    expect(model.project.instances[id].data).toEqual({ caption: 'Original' })
    expect(model.resources.components[implementation.workspace.ownerId]['main.js']).toEqual(original.resources.components.owner['main.js'])
    expect(model.resources.components[implementation.workspace.ownerId]['main.js']).not.toBe(original.resources.components.owner['main.js'])
    expect(implementation.moduleBindings?.['./shared']).not.toBe('shared')
  }
  expect(extraction).toHaveBeenCalledTimes(1)
  expect(new Set(ids).size).toBe(5); expect(new Set(owners).size).toBe(5)
  expect(original).toEqual(before)
  const reopened = driver.load(driver.serialize(model)) as typeof model
  expect(testContainerInstance(reopened.project, 0).childIds).toEqual(['source', ...ids])
  expect(reopened.resources.assets.photo).toEqual(before.resources.assets.photo)
  for (const owner of owners) expect(reopened.resources.components[owner]['main.js']).toEqual(before.resources.components.owner['main.js'])
})

it.each(['files', 'definition', 'data', 'asset'] as const)('refreshes captured closure after a real %s edit', kind => {
  const driver = new CourseV10Driver(), copies = createCourseObjectPastePlanningBatch(), extraction = vi.spyOn(library, 'extractComponentLibraryEntry')
  let model = fixture()
  const prepare = () => copies.prepare({ documentId: 'same', project: model.project, resources: model.resources, roots: ['source'] },
    { capturedTarget: { documentId: 'same', ...model, surfaceId: componentSurfaces(model.project)[0].id },
      container: { kind: 'surface', surfaceId: componentSurfaces(model.project)[0].id }, index: testContainerInstance(model.project, 0).childIds.length })
  prepare()
  const edits: ComponentEdit[] = kind === 'files' ? [{ type: 'component.files.set', ownerId: 'owner', expectedFiles: model.resources.components.owner,
    files: { 'main.js': bytes("import shared from './shared'; /* changed */ export default shared") } }]
    : kind === 'definition' ? [{ type: 'definition.set', definition: { ...model.project.definitions.shared, title: 'Changed' } }]
      : kind === 'data' ? [{ type: 'data.set', instanceId: 'source', path: ['caption'], value: 'Changed' }]
        : [{ type: 'asset.replace', asset: model.project.assets.photo, expectedBytes: model.resources.assets.photo, bytes: bytes('<svg>Changed</svg>') }]
  model = driver.apply(model, captureComponentOperation(model.project, edits)) as typeof model
  copies.applied(edits)
  const copy = prepare()
  expect(extraction).toHaveBeenCalledTimes(2)
  const next = driver.apply(model, captureComponentOperation(model.project, copy.edits)) as typeof model
  expect(next.project.instances[copy.rootIds[0]].data).toEqual(model.project.instances.source.data)
  expect(next.resources.assets.photo).toEqual(model.resources.assets.photo)
})
