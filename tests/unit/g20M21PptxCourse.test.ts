import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { afterEach, expect, it, vi } from 'vitest'
import * as assetManager from '../../src/renderer/project/assetManager'
import { openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { createCourseFromPptx, pptxCourseArchive, pptxCourseCanvas, pptxCourseStem } from '../../src/renderer/project/pptxCourseCreation'
import { pptxImportFixture } from '../fixtures/pptxImport'

afterEach(() => { vi.restoreAllMocks() })

/** The fixture with another page size. */
function withPageSize(bytes: Uint8Array, cx: number, cy: number): Uint8Array {
  const files = unzipSync(bytes)
  files['ppt/presentation.xml'] = strToU8(strFromU8(files['ppt/presentation.xml']!).replace(/<p:sldSz[^>]*\/>/, `<p:sldSz cx="${cx}" cy="${cy}"/>`))
  return zipSync(files)
}

it('M21 gives an H5 presentation made from a PPT the PPT\'s own page ratio', () => {
  const fixture = pptxImportFixture()
  expect(pptxCourseCanvas(fixture)).toEqual({ width: 1280, height: 720 })
  expect(pptxCourseCanvas(withPageSize(fixture, 9144000, 6858000))).toEqual({ width: 1024, height: 768 })
  expect(pptxCourseCanvas(withPageSize(fixture, 6858000, 12192000))).toEqual({ width: 720, height: 1280 })
  expect(pptxCourseCanvas(withPageSize(fixture, 12000000, 6000000))).toEqual({ width: 1280, height: 640 })
  expect(pptxCourseStem('D:\\课件\\第一课.PPTX')).toBe('第一课')
})

it('M21 makes a new H5 presentation holding only the PPT\'s pages, with their media, that opens as a valid file', async () => {
  // jsdom cannot decode images; the importer measures them through this seam.
  vi.spyOn(assetManager, 'readImageDimensions').mockResolvedValue({ width: 200, height: 200 })
  const course = await createCourseFromPptx(withPageSize(pptxImportFixture({ image: true }), 9144000, 6858000), '第一课')
  expect(course.issues).toEqual([])
  const slides = course.project.surfaces.filter(surface => surface.kind === 'slide')
  // The blank page a new course starts with is gone; the PPT's page is the course.
  expect(slides).toHaveLength(1)
  expect(course.project.surfaces).toHaveLength(1)
  expect(slides[0].designSize).toEqual({ width: 1024, height: 768 })
  expect(Object.keys(course.resources.assets).length).toBeGreaterThan(0)
  expect(Object.keys(course.project.assets)).toEqual(Object.keys(course.resources.assets))
  // The controller is a normal current builtin definition and global instance.
  expect(course.project.definitions['guoling.navigation'].implementation).toMatchObject({ kind: 'builtin' })
  expect(course.project.global.overlay.some(id => course.project.instances[id].definitionId === 'guoling.navigation')).toBe(true)
  const reopened = openCourseProjectV10Archive(pptxCourseArchive(course))
  expect(reopened.project).toEqual(JSON.parse(JSON.stringify(course.project)))
  expect(Object.keys(reopened.resources.assets).sort()).toEqual(Object.keys(course.resources.assets).sort())
})
