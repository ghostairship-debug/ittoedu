import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import {
  addCourseFlowPage,
  addCourseSpatialPage,
} from '@/renderer/course/courseLocationCommands'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  buildCourseExportPageList,
  buildCoursePrintArtifacts,
  renderPublishedSpatialFrameSvg,
  SPATIAL_EXPORT_VIEWPORT,
} from '@/renderer/export/course/buildCoursePrintArtifacts'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import {
  buildFlowPrintPlan,
  flowPrintPlanHasRuntimeToc,
  renderFlowPrintBodyHtml,
  renderFlowPrintHtml,
} from '@/renderer/export/course/flowPrintPlan'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'

const NOW = '2026-08-17T12:00:00.000Z'
const ASSET_BYTES = new Uint8Array([1, 2, 3, 4])

function mixedPublishedFixture() {
  let project = createBlankCourseProject({ now: NOW, includeDefaultController: true })
  const flowAdded = addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
    title: '阅读任务',
  })
  expect(flowAdded.ok).toBe(true)
  if (!flowAdded.ok) throw new Error(flowAdded.reason)
  project = flowAdded.project

  const spatialAdded = addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
    title: '无限画布',
  })
  expect(spatialAdded.ok).toBe(true)
  if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
  project = spatialAdded.project as CourseProjectDocument

  const spatialSurface = project.surfaces.find((surface) => surface.type === 'spatial-2d')
  if (spatialSurface?.type === 'spatial-2d') {
    spatialSurface.world.bounds = { mode: 'infinite' }
  }
  if (!project.mixedPrintPlan) throw new Error('expected mixed print plan')
  const printRank = new Map([
    ['spatial-frames', 0],
    ['flow-document', 1],
    ['slide-scenes', 2],
  ])
  project.mixedPrintPlan.entries.sort((left, right) => (
    printRank.get(left.kind)! - printRank.get(right.kind)!
  ))

  const assetFiles = Object.fromEntries(
    Object.keys(project.assets).map((id) => [id, ASSET_BYTES]),
  )
  const published = buildPublishedCourseV2Payload({
    project,
    assetFiles,
    components: {},
  })
  return { project, published }
}

describe('buildCoursePrintArtifacts', () => {
  it('builds mixed print/DOCX file list and keeps HUD plus runtime TOC out of files', async () => {
    const { project, published } = mixedPublishedFixture()
    const flowSurface = published.surfaces.find((surface) => surface.type === 'flow')
    if (flowSurface?.type !== 'flow') throw new Error('expected flow surface')

    const plan = buildFlowPrintPlan(flowSurface)
    expect(plan.includesRuntimeToc).toBe(false)
    expect(flowPrintPlanHasRuntimeToc(plan)).toBe(false)
    const flowBody = renderFlowPrintBodyHtml(plan)
    expect(flowBody).not.toMatch(/<!doctype|<html\b|<head\b|<body\b/i)
    const flowHtml = renderFlowPrintHtml(plan)
    expect(flowHtml.split(flowBody)).toHaveLength(2)
    expect(flowHtml).not.toContain('flow-runtime-toc')
    expect(flowHtml).not.toContain('打开目录')

    const docx = buildFlowDocx(flowSurface)
    const docxXml = strFromU8(unzipSync(docx.bytes)['word/document.xml']!)
    expect(docxXml).not.toContain('flow-runtime-toc')
    expect(docxXml).not.toContain('打开目录')

    const spatialSurface = published.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (spatialSurface?.type !== 'spatial-2d') throw new Error('expected spatial surface')
    const { svg, viewport } = renderPublishedSpatialFrameSvg(
      spatialSurface,
      spatialSurface.camera.frames[0]?.id,
      () => undefined,
    )
    expect(viewport).toEqual(SPATIAL_EXPORT_VIEWPORT)
    expect(viewport.width).not.toBe(1280)
    expect(viewport.height).not.toBe(720)
    expect(svg).toContain('data-spatial-viewport="1120x760"')

    const result = await buildCoursePrintArtifacts(published, {
      resolveAssetBytes: (assetId) => ({
        bytes: ASSET_BYTES,
        mimeType: published.assets[assetId]?.mimeType ?? 'application/octet-stream',
      }),
    })

    expect(buildCourseExportPageList(published).length).toBeGreaterThan(0)
    expect(result.files.some((file) => file.kind === 'flow-print-html')).toBe(true)
    expect(result.files.some((file) => file.kind === 'docx')).toBe(true)
    expect(result.report.some((item) => item.message.includes('全局图层'))).toBe(true)

    const mixedHtml = new TextDecoder().decode(
      result.files.find((file) => file.kind === 'flow-print-html')!.bytes,
    )
    expect(mixedHtml).not.toContain('全局')
    expect(mixedHtml).not.toContain(project.globalLayerItems[0]?.item.layerItemId ?? 'missing-global')
    expect(mixedHtml).not.toContain('flow-runtime-toc')
    expect(mixedHtml).toContain('data-spatial-viewport="1120x760"')

    const pdfHtml = new TextDecoder().decode(
      result.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(pdfHtml.match(/<!doctype html>/gi)).toHaveLength(1)
    expect(pdfHtml.match(/<html\b/gi)).toHaveLength(1)
    expect(pdfHtml.match(/<body\b/gi)).toHaveLength(1)
    expect(pdfHtml.match(/class="page /g)).toHaveLength(result.pages.length)
    expect(pdfHtml).toContain('@page{size:A4 landscape;margin:0}')
    expect(pdfHtml).toContain('class="course-slide-print-canvas"')
    expect(pdfHtml).toMatch(/\.course-slide-print-canvas\{[^}]*transform:scale\(0\.\d+\)/)
    expect(pdfHtml).toContain('.course-spatial-print-page svg{display:block;width:100%;height:100%}')
    expect(pdfHtml).toContain('.flow-print-document{padding:12mm 15mm;overflow-wrap:anywhere}')
    expect(pdfHtml).toContain('course-slide-print-page')
    expect(pdfHtml).toContain('flow-print-document')
    expect(pdfHtml).toContain('data-spatial-viewport="1120x760"')
    expect([
      ...pdfHtml.matchAll(
        /<section class="page (course-slide-print-page|flow-print-document|course-spatial-print-page)"/g,
      ),
    ].map((match) => match[1])).toEqual(result.pages.map((page) => ({
      'slide-scene': 'course-slide-print-page',
      'flow-document': 'flow-print-document',
      'spatial-frame': 'course-spatial-print-page',
    })[page.kind]))

    const nativePublished = structuredClone(published)
    if (!nativePublished.mixedPrintPlan) throw new Error('expected mixed print plan')
    nativePublished.mixedPrintPlan.pageSize = 'surface-native'
    const nativeResult = await buildCoursePrintArtifacts(nativePublished)
    const nativePdf = new TextDecoder().decode(
      nativeResult.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(nativePdf).toContain('@page{size:13.333333in 7.5in;margin:0}')
    expect(nativePdf).toContain('transform:scale(1.000000)')
  })

  it('selects semantic Flow, image Spatial, and retained pure-Slide PDF inputs', async () => {
    const flow = buildPublishedCourseV2Payload({
      project: createBlankFlowCourseProject({ now: NOW }),
      assetFiles: {},
      components: {},
    })
    const flowResult = await buildCoursePrintArtifacts(flow)
    const flowPdf = new TextDecoder().decode(
      flowResult.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(flowPdf).toContain('class="page flow-print-document"')
    expect(flowPdf).toContain('@page{size:A4 portrait;margin:0}')
    expect(flowPdf.match(/<!doctype html>/gi)).toHaveLength(1)
    expect(flowPdf.match(/<html\b/gi)).toHaveLength(1)
    expect(flowPdf.match(/<body\b/gi)).toHaveLength(1)

    const spatial = buildPublishedCourseV2Payload({
      project: createBlankSpatialCourseProject({ now: NOW }),
      assetFiles: {},
      components: {},
    })
    const spatialResult = await buildCoursePrintArtifacts(spatial)
    const spatialPdf = new TextDecoder().decode(
      spatialResult.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(spatialPdf).toContain('<img src="data:image/svg+xml')
    expect(spatialPdf).not.toContain('course-spatial-print-page')

    const slide = buildPublishedCourseV2Payload({
      project: createBlankCourseProject({ now: NOW }),
      assetFiles: {},
      components: {},
    })
    const slideResult = await buildCoursePrintArtifacts(slide)
    expect(slideResult.files.some((file) => file.kind === 'pdf-html')).toBe(false)

    const capturedSlideResult = await buildCoursePrintArtifacts(slide, {
      captureSlideScene: () => 'data:image/png;base64,AA==',
    })
    const capturedSlidePdf = new TextDecoder().decode(
      capturedSlideResult.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(capturedSlidePdf).toContain('<img src="data:image/png;base64,AA=="')
    expect(capturedSlidePdf).not.toContain('course-slide-print-page')
  })

  it('returns Chinese reasons for missing assets without throwing', async () => {
    const { published } = mixedPublishedFixture()
    const broken = structuredClone(published)
    broken.assets['missing-flow-image'] = { mimeType: 'image/png', url: '' }

    const result = await buildCoursePrintArtifacts(broken)
    expect(result.files.length).toBeGreaterThan(0)
    expect(result.report.some((item) => (
      item.severity === 'error' && item.message.includes('缺少可离线引用')
    ))).toBe(true)
  })
})
