// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import type { DocumentModel } from '../../src/shared/workbench/document'

function sample(): Extract<DocumentModel, { kind: 'course-v10' }> {
  const project = createBlankCourseProjectV10('引用')
  project.definitions.custom = { id: 'custom', role: 'content', implementation: { kind: 'builtin', key: 'group' } }
  project.instances.custom = { id: 'custom', definitionId: 'custom', data: {} }
  project.surfaces[0].childIds.push('custom')
  project.assets.art = { id: 'art', path: 'assets/art.png', mimeType: 'image/png' }
  return { kind: 'course-v10', project, resources: { assets: { art: new Uint8Array([1, 2, 3]) }, components: {} } }
}

it('keeps assets used by an effective builtin override, including a named presentation state', () => {
  const model = sample(), driver = new CourseV10Driver()
  model.project.instances.custom.implementationOverride = { kind: 'builtin', key: 'guoling.web' }
  model.project.instances.custom.data = { html: '<img src="picture">', resourceBindings: { picture: 'art' } }
  expect(() => driver.apply(model, captureComponentOperation(model.project, [{ type: 'asset.remove', assetId: 'art' }]))).toThrow('素材仍被工程内容使用')
  model.project.instances.custom.data = { html: '' }
  model.project.surfaces[0].presentation = { states: [{ id: 'show', title: '呈现', overrides: { custom: {
    data: { html: '<img src="picture">', resourceBindings: { picture: 'art' } },
  } } }] }
  expect(() => driver.apply(model, captureComponentOperation(model.project, [{ type: 'asset.remove', assetId: 'art' }]))).toThrow('素材仍被工程内容使用')
})

it('rechecks a newly edited definition source reference at actual removal without a broad definition conflict gate', () => {
  const model = sample(), driver = new CourseV10Driver()
  const remove = captureComponentOperation(model.project, [{ type: 'asset.remove', assetId: 'art' }])
  const changed = driver.apply(model, captureComponentOperation(model.project, [{ type: 'definition.set', definition: {
    ...model.project.definitions.custom,
    implementation: { kind: 'source', language: 'javascript', source: 'export default { mount() {} }', resourceBindings: { picture: 'art' } },
  } }]))
  expect(() => driver.apply(changed, remove)).toThrow('素材仍被工程内容使用')
  expect(changed.resources.assets.art).toEqual(new Uint8Array([1, 2, 3]))
})
