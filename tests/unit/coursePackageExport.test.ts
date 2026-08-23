import { strFromU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import {
  addCourseFlowPage,
  addCourseSpatialPage,
} from '@/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import type { CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'
import {
  buildCoursePackages,
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageFiles,
  collectCoursePackageExportPreflight,
} from '@/renderer/export/course/buildCoursePackages'

const NOW = '2026-08-17T12:00:00.000Z'
const PLAYER_BUNDLE = 'window.__COURSE_PLAYER_PLACEHOLDER__=true;'

function mixedSources(): CoursePublishSources {
  let project = createBlankCourseProject({ now: NOW, includeDefaultController: false, controls: 'none' })
  const originalLocationIds = project.locations.map((location) => location.id)

  const flowAdded = addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })
  expect(flowAdded.ok).toBe(true)
  if (!flowAdded.ok) throw new Error(flowAdded.reason)
  project = flowAdded.project

  const spatialAdded = addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })
  expect(spatialAdded.ok).toBe(true)
  if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
  project = spatialAdded.project

  expect(project.locations.map((location) => location.id)).toEqual([
    ...originalLocationIds,
    flowAdded.activatedLocationId,
    spatialAdded.activatedLocationId,
  ])
  expect(project.surfaces.map((surface) => surface.type)).toEqual(['slide', 'flow', 'spatial-2d'])
  courseProjectDocumentSchema.parse(project)

  return {
    project,
    assetFiles: {},
    components: {},
  }
}

function assertRelativeManifest(paths: readonly string[]): void {
  for (const path of paths) {
    expect(path).not.toMatch(/^[A-Za-z]:/)
    expect(path.startsWith('/')).toBe(false)
    expect(path.includes('\\')).toBe(false)
  }
}

describe('course package export', () => {
  it('builds mixed Slide+Flow+Spatial standalone HTML and web package from one V2 producer', () => {
    const sources = mixedSources()
    const standalone = buildCoursePackages(sources, 'standalone-html', PLAYER_BUNDLE)
    const webPackage = buildCoursePackages(sources, 'web-package', PLAYER_BUNDLE)

    expect(publishedCourseV2Schema.parse(standalone.payload)).toEqual(standalone.payload)
    expect(standalone.payload).toEqual(webPackage.payload)
    expect(standalone.payload.surfaces.map((surface) => surface.type))
      .toEqual(['slide', 'flow', 'spatial-2d'])

    const html = strFromU8(standalone.files['index.html']!)
    expect(html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(html).toContain('window.__COURSE_PLAYER_PLACEHOLDER__=true')
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain('.course-nav')
    assertRelativeManifest(standalone.manifest)

    const courseData = strFromU8(webPackage.files['course-data.js']!)
    const webIndex = strFromU8(webPackage.files['index.html']!)
    expect(courseData).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(courseData).not.toContain('data:image/')
    expect(webIndex).toContain("default-src 'none'")
    expect(webIndex).toContain("script-src 'self' 'unsafe-eval'")
    expect(webIndex).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(webIndex).toContain("style-src 'self' 'unsafe-inline'")
    expect(webIndex).toContain("connect-src 'self'")
    expect(html).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:")
    expect(html).toContain("style-src 'unsafe-inline'")
    expect(webPackage.manifest).toEqual(expect.arrayContaining([
      'index.html',
      'course-data.js',
      'player/player.css',
      'player/player.iife.js',
    ]))
    assertRelativeManifest(webPackage.manifest)
    expect(strFromU8(webPackage.files['player/player.css']!)).not.toContain('.course-nav')

    const archiveFiles = unzipSync(zipSync(webPackage.files))
    expect(Object.keys(archiveFiles).sort()).toEqual(webPackage.manifest.slice().sort())
  })

  it('keeps offline relative asset paths in the web package file graph', () => {
    const sources = mixedSources()
    const files = buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)
    const html = buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)

    expect(html).toContain('"format":"h5course-published"')
    expect(strFromU8(files['course-data.js']!)).toContain('"formatVersion":2')
    for (const path of Object.keys(files)) {
      expect(path.includes(':')).toBe(false)
      expect(path.startsWith('/')).toBe(false)
    }
  })

  it('reports missing publish resources in Chinese preflight before export', () => {
    let project: CourseProjectDocument = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    project.assets.hero = {
      id: 'hero',
      filename: 'hero.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/hero.png',
      byteLength: 4,
      width: 100,
      height: 100,
    }
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.backgroundAssetId = 'hero'

    const report = collectCoursePackageExportPreflight(
      project,
      'web-package',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
    )

    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'asset-bytes-missing',
      message: expect.stringContaining('hero.png'),
    }))
    expect(report.summary.canExport).toBe(false)
    expect(report.generatedAt).toBe('2026-08-17T00:00:00.000Z')
  })
})
