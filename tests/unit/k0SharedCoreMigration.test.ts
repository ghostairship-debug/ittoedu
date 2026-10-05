// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation, ComponentOperationConflict } from '../../src/core/drivers/courseV10Operations'
import { createImageData } from '../../src/components/image/data'
import { isComponentVisibleAtSurface } from '../../src/shared/contracts/component-platform/project'
import type { DocumentModel } from '../../src/shared/workbench/document'

function sample(): Extract<DocumentModel, { kind: 'course-v10' }> {
  const project = createBlankCourseProjectV10('共享母版')
  project.surfaces[0].id = 'page-a'
  project.surfaces.push({ id: 'page-b', kind: 'slide', title: '第二页', childIds: [] })
  project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
  project.assets.art = { id: 'art', path: 'assets/art.png', mimeType: 'image/png' }
  for (const [id, mode, surfaceIds] of [
    ['shared', 'include', ['page-a', 'page-b']],
    ['single', 'include', ['page-a']],
    ['excluded', 'exclude', ['page-a']],
  ] as const) {
    project.instances[id] = { id, definitionId: 'image', data: createImageData('art'),
      visibility: { mode, surfaceIds: [...surfaceIds] } }
    project.global.underlay.push(id)
  }
  return { kind: 'course-v10', project, resources: { assets: { art: new Uint8Array([1, 2, 3]) }, components: {} } }
}

it('removes a page from shared visibility while preserving empty includes, instances and their saved resources', () => {
  const model = sample(), driver = new CourseV10Driver()
  const result = driver.apply(model, captureComponentOperation(model.project, [{ type: 'surface.remove', surfaceId: 'page-a' }]))
  if (result.kind !== 'course-v10') throw new Error('expected V10')
  expect(result.project.instances.shared.visibility).toEqual({ mode: 'include', surfaceIds: ['page-b'] })
  expect(result.project.instances.single.visibility).toEqual({ mode: 'include', surfaceIds: [] })
  expect(isComponentVisibleAtSurface(result.project.instances.single, 'page-b')).toBe(false)
  expect(result.project.instances.excluded.visibility).toEqual({ mode: 'exclude', surfaceIds: [] })
  expect(result.project.global.underlay).toEqual(['shared', 'single', 'excluded'])
  expect(result.resources.assets.art).toEqual(model.resources.assets.art)
  const reopened = driver.load(driver.serialize(result))
  expect(reopened).toMatchObject({ project: { instances: { single: { visibility: { mode: 'include', surfaceIds: [] } } } },
    resources: { assets: { art: new Uint8Array([1, 2, 3]) } } })
})

it('captures only affected visibility for page deletion and rejects a stale visibility cleanup', () => {
  const model = sample(), driver = new CourseV10Driver()
  const remove = captureComponentOperation(model.project, [{ type: 'surface.remove', surfaceId: 'page-a' }])
  const renamed = driver.apply(model, captureComponentOperation(model.project, [{ type: 'instance.patch', instanceId: 'shared', patch: { name: '人工名称' } }]))
  expect(driver.apply(renamed, remove)).toMatchObject({ project: { instances: { shared: { name: '人工名称' } } } })
  const rescoped = driver.apply(model, captureComponentOperation(model.project, [{ type: 'instance.patch', instanceId: 'shared',
    patch: { visibility: { mode: 'include', surfaceIds: ['page-b'] } } }]))
  expect(() => driver.apply(rescoped, remove)).toThrow(ComponentOperationConflict)
})

it('roundtrips a byte delivery URL independently of provenance and keeps the embedded offline bytes', () => {
  const model = sample(), driver = new CourseV10Driver()
  model.project.assets.art.remote = { url: 'https://cdn.example.org/assets/art.png' }
  model.project.assets.art.source = { kind: 'user-material', url: 'https://example.org/library/art' }
  const reopened = driver.load(driver.serialize(model))
  expect(reopened).toMatchObject({ project: { assets: { art: {
    remote: { url: 'https://cdn.example.org/assets/art.png' }, source: { url: 'https://example.org/library/art' },
  } } }, resources: { assets: { art: new Uint8Array([1, 2, 3]) } } })
})
