// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation, ComponentOperationConflict } from '../../src/core/drivers/courseV10Operations'
import { createImageData } from '../../src/components/image/data'
import type { DocumentModel } from '../../src/shared/workbench/document'

it('replaces the same asset with metadata and bytes together, preserves references and rejects stale bytes or metadata', () => {
  const project = createBlankCourseProjectV10('同身份素材'), driver = new CourseV10Driver()
  project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
  project.assets.art = { id: 'art', path: 'assets/art.svg', mimeType: 'image/svg+xml', width: 40, height: 20 }
  project.instances.image = { id: 'image', definitionId: 'image', data: createImageData('art') }
  project.surfaces[0].childIds.push('image')
  project.background = { assetId: 'art' }
  const before: DocumentModel = { kind: 'course-v10', project, resources: { assets: { art: new Uint8Array([1, 2, 3]) }, components: {} } }
  const replace = captureComponentOperation(project, [{ type: 'asset.replace', asset: { ...project.assets.art, width: 80 },
    bytes: new Uint8Array([4, 5]), expectedBytes: before.resources.assets.art }])
  const after = driver.apply(before, replace)
  expect(after).toMatchObject({ project: { assets: { art: { width: 80 } }, instances: { image: { data: { assetId: 'art' } } }, background: { assetId: 'art' } },
    resources: { assets: { art: new Uint8Array([4, 5]) } } })
  expect(driver.load(driver.serialize(after))).toEqual(after)
  expect(before.resources.assets.art).toEqual(new Uint8Array([1, 2, 3]))
  const changedBytes = { ...before, resources: { ...before.resources, assets: { art: new Uint8Array([1, 9, 3]) } } }
  expect(() => driver.apply(changedBytes, replace)).toThrow(ComponentOperationConflict)
  const changedMetadata = { ...before, project: { ...project, assets: { art: { ...project.assets.art, width: 90 } } } }
  expect(() => driver.apply(changedMetadata, replace)).toThrow(ComponentOperationConflict)
})
