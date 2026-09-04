import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  addCourseFlowPage,
  addCourseSpatialPage,
} from '@/renderer/course/courseLocationCommands'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { buildPublishedCourseV2Payload, type CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'
import {
  buildCourseExportPageList,
  buildCoursePrintArtifacts,
  composePublishedSlideStaticPage,
} from '@/renderer/export/course/buildCoursePrintArtifacts'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import {
  buildFlowPrintPlan,
  flowPrintOmittedOverlayMessage,
  flowPrintPlanHasRuntimeToc,
  renderFlowPrintBodyHtml,
  renderFlowPrintHtml,
} from '@/renderer/export/course/flowPrintPlan'
import { adaptCoursePdfProducerFindings } from '@/renderer/export/exportPreflight'
import { createPublishedCourseV2PrintCaptureSession } from '@/renderer/export/playerCapture'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import {
  listCourseProjectV9Fixtures,
  type CourseProjectV9FixtureId,
} from '../fixtures/course-project-v9'

const printCapture = vi.hoisted(() => ({
  create: vi.fn(),
  capturePage: vi.fn(),
  destroy: vi.fn(),
}))

vi.mock('@/renderer/export/playerCapture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/export/playerCapture')>()
  return {
    ...actual,
    createPublishedCourseV2PrintCaptureSession: printCapture.create,
  }
})

const NOW = '2026-08-17T12:00:00.000Z'
const ASSET_BYTES = new Uint8Array([1, 2, 3, 4])
const V2_CAPTURE_IMAGE = 'data:image/png;base64,AA=='
const SPATIAL_CAPTURE_IMAGE = 'data:image/png;base64,AQ=='

function surfaceCapture(
  content: string,
  width: number,
  height: number,
  warnings: string[] = [],
) {
  return {
    format: 'data-url' as const,
    content,
    width,
    height,
    warnings,
  }
}

function defaultCaptureForRequest(request: { width?: number; height?: number }) {
  const isSpatial = request.width === 1120 && request.height === 760
  return surfaceCapture(
    isSpatial ? SPATIAL_CAPTURE_IMAGE : V2_CAPTURE_IMAGE,
    request.width ?? 1280,
    request.height ?? 720,
  )
}

beforeEach(() => {
  printCapture.capturePage.mockReset().mockImplementation(defaultCaptureForRequest)
  printCapture.destroy.mockReset().mockResolvedValue(undefined)
  printCapture.create.mockReset().mockResolvedValue({
    capturePage: printCapture.capturePage,
    destroy: printCapture.destroy,
  })
})

function v9Sources(id: CourseProjectV9FixtureId): CoursePublishSources {
  const fixture = listCourseProjectV9Fixtures().find((candidate) => candidate.id === id)
  if (!fixture) throw new Error(`missing Course Project V9 fixture ${id}`)
  return {
    project: structuredClone(fixture.data.project),
    assetFiles: { ...fixture.data.assetFiles },
    components: Object.keys(fixture.data.componentFiles).length === 0
      ? {}
      : componentPackagesFromArchive(fixture.data.project, fixture.data.componentFiles),
  }
}

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
  it('preserves Flow rich-text font family and size in semantic HTML and DOCX', () => {
    const project = createBlankFlowCourseProject({ now: NOW })
    const surface = project.surfaces.find((candidate) => candidate.type === 'flow')
    if (surface?.type !== 'flow') throw new Error('expected flow surface')
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected flow paragraph')
    paragraph.text = '甲乙丙丁'
    paragraph.runs = [{
      start: 2,
      end: 4,
      style: { fontFamily: 'SimSun', fontSize: 30, bold: true },
    }]

    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const flowSurface = published.surfaces.find((candidate) => candidate.type === 'flow')
    if (flowSurface?.type !== 'flow') throw new Error('expected published flow surface')

    const html = renderFlowPrintBodyHtml(buildFlowPrintPlan(flowSurface))
    expect(html).toContain('<span style="font-family:SimSun;font-size:30px;font-weight:700">丙丁</span>')

    const docx = buildFlowDocx(flowSurface)
    const documentXml = strFromU8(unzipSync(docx.bytes)['word/document.xml']!)
    expect(documentXml).toContain('<w:rFonts w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun"/>')
    expect(documentXml).toContain('<w:sz w:val="60"/><w:szCs w:val="60"/>')
    expect(documentXml).toContain('<w:b/>')
    expect(documentXml).toContain('<w:t>丙丁</w:t>')
  })

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
    const slideSurface = published.surfaces.find((surface) => surface.type === 'slide')
    if (spatialSurface?.type !== 'spatial-2d' || slideSurface?.type !== 'slide') {
      throw new Error('expected Slide and Spatial surfaces')
    }
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
    expect(printCapture.create).toHaveBeenCalledOnce()
    expect(printCapture.create).toHaveBeenCalledWith(expect.objectContaining({
      includeGlobalLayerItems: false,
    }))
    expect(printCapture.capturePage).toHaveBeenCalledTimes(2)
    expect(printCapture.capturePage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      surfaceId: spatialSurface.id,
      width: 1120,
      height: 760,
    }))
    expect(printCapture.capturePage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      surfaceId: slideSurface.id,
      width: 1280,
      height: 720,
    }))
    expect(printCapture.destroy).toHaveBeenCalledOnce()

    const mixedHtml = new TextDecoder().decode(
      result.files.find((file) => file.kind === 'flow-print-html')!.bytes,
    )
    expect(mixedHtml).not.toContain('全局')
    expect(mixedHtml).not.toContain(project.globalLayerItems[0]?.item.layerItemId ?? 'missing-global')
    expect(mixedHtml).not.toContain('flow-runtime-toc')
    expect(mixedHtml).toContain(SPATIAL_CAPTURE_IMAGE)
    expect(mixedHtml).toContain(V2_CAPTURE_IMAGE)
    expect(mixedHtml).toContain('data-capture-width="1120" data-capture-height="760"')
    expect(mixedHtml).toContain('data-capture-width="1280" data-capture-height="720"')
    expect(mixedHtml).toMatch(/\.course-visual-print-capture\{[^}]*object-fit:contain/)

    const pdfHtml = new TextDecoder().decode(
      result.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(pdfHtml.match(/<!doctype html>/gi)).toHaveLength(1)
    expect(pdfHtml.match(/<html\b/gi)).toHaveLength(1)
    expect(pdfHtml.match(/<body\b/gi)).toHaveLength(1)
    expect(pdfHtml.match(/class="page /g)).toHaveLength(result.pages.length)
    expect(pdfHtml).toContain('@page{size:A4 landscape;margin:0}')
    expect(pdfHtml).toContain('class="course-visual-print-canvas course-slide-print-canvas"')
    expect(pdfHtml).toContain('class="course-visual-print-canvas course-spatial-print-canvas"')
    expect(pdfHtml).toContain('.flow-print-document{padding:12mm 15mm;overflow-wrap:anywhere;')
    expect(pdfHtml).toContain('course-slide-print-page')
    expect(pdfHtml).toContain('flow-print-document')
    expect(pdfHtml).toBe(mixedHtml)
    expect([
      ...pdfHtml.matchAll(/<section class="page [^"]*"[^>]*data-page-id="([^"]+)"/g),
    ].map((match) => match[1])).toEqual(result.pages.map((page) => page.id))

    const nativePublished = structuredClone(published)
    if (!nativePublished.mixedPrintPlan) throw new Error('expected mixed print plan')
    nativePublished.mixedPrintPlan.pageSize = 'surface-native'
    const nativeResult = await buildCoursePrintArtifacts(nativePublished)
    const nativePdf = new TextDecoder().decode(
      nativeResult.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(nativePdf).toContain('@page{size:13.333333in 7.5in;margin:0}')
    expect(nativePdf).toContain('object-fit:contain')
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
    expect(spatialPdf).toContain('course-spatial-print-page')
    expect(spatialPdf).toContain(SPATIAL_CAPTURE_IMAGE)
    expect(spatialPdf).toContain('data-capture-width="1120" data-capture-height="760"')
    expect(spatialPdf).toContain('object-fit:contain')
    expect(spatialPdf).toContain('@page{size:A4 landscape;margin:0}')
    expect(spatialPdf).not.toContain('@page { size: 13.333in 7.5in')

    const slideProject = createBlankCourseProject({ now: NOW, includeDefaultController: true })
    const globalText = sceneNodeToCourseLayerItem(createTextNode({
      id: 'global-print-text',
      text: '纯 Slide 全局页脚',
      x: 48,
      y: 650,
      width: 360,
      height: 44,
    }), 900)
    slideProject.globalLayerItems.push({
      item: globalText,
      visibility: { mode: 'include', locationIds: [slideProject.startLocationId] },
    })
    const slide = buildPublishedCourseV2Payload({
      project: slideProject,
      assetFiles: {},
      components: {},
    })
    const captureGlobalFlags: Array<boolean | undefined> = []
    const captureLocationIds: Array<string | undefined> = []
    const capturedSlideResult = await buildCoursePrintArtifacts(slide, {
      captureSlideScene: (input) => {
        captureGlobalFlags.push(input.includeGlobalLayerItems)
        captureLocationIds.push(input.locationId)
        return surfaceCapture(V2_CAPTURE_IMAGE, 1280, 720)
      },
    })
    const capturedSlidePdf = new TextDecoder().decode(
      capturedSlideResult.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(capturedSlidePdf).toContain('<img src="data:image/png;base64,AA=="')
    expect(capturedSlidePdf).toContain('data-capture-width="1280" data-capture-height="720"')
    expect(capturedSlidePdf).toContain('object-fit: contain')
    expect(capturedSlidePdf).not.toContain('course-slide-print-page')
    const capturedSlidePrint = new TextDecoder().decode(
      capturedSlideResult.files.find((file) => file.kind === 'flow-print-html')!.bytes,
    )
    expect(capturedSlidePrint).toContain('data-capture-width="1280" data-capture-height="720"')
    expect(captureGlobalFlags).toEqual([true])
    expect(captureLocationIds).toEqual([slide.startLocationId])
    expect(capturedSlideResult.report.some((item) => (
      item.message.includes('默认不写入 PDF')
    ))).toBe(false)
  })

  it('renders a native Flow image into PDF HTML instead of a silent text fallback', async () => {
    const result = await buildCoursePrintArtifacts(v9Sources('flow'))
    const pdfHtml = new TextDecoder().decode(
      result.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )

    expect(pdfHtml).toContain('data-flow-print="image"')
    expect(pdfHtml).toContain('class="flow-print-image"')
    expect(pdfHtml).toMatch(/<img[^>]+src="data:image\/png;base64,/)
    expect(pdfHtml).toContain('alt="插图"')
    expect(pdfHtml).not.toContain('[媒体后备：插图]')
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

  it('uses the first course-order location for each exported Slide scene', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const original = published.locations.find((location) => location.kind === 'slide-scene')
    if (!original || original.kind !== 'slide-scene') throw new Error('expected Slide location')
    published.locations.unshift({ ...structuredClone(original), id: 'course-order-first-location' })

    const pages = buildCourseExportPageList(published)
    expect(pages.find((page) => page.kind === 'slide-scene')?.locationId)
      .toBe('course-order-first-location')
    const capturedLocationIds: string[] = []
    await buildCoursePrintArtifacts(published, {
      captureSlideScene: ({ locationId }) => {
        capturedLocationIds.push(locationId)
        return surfaceCapture(V2_CAPTURE_IMAGE, 1280, 720)
      },
    })
    expect(capturedLocationIds).toEqual(['course-order-first-location'])
  })

  it('reuses canonical named-state overrides and order slots for Slide static composition', () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
    if (!surface || surface.type !== 'slide' || !surface.scenes[0]) {
      throw new Error('expected Slide fixture')
    }
    const first = sceneNodeToCourseLayerItem(createTextNode({
      id: 'state-first',
      text: '基础文字',
      x: 80,
      y: 80,
      width: 320,
      height: 80,
    }), 10)
    const second = sceneNodeToCourseLayerItem(createTextNode({
      id: 'state-second',
      text: '第二层',
      x: 120,
      y: 120,
      width: 320,
      height: 80,
    }), 30)
    const scene = surface.scenes[0]
    scene.layerItems = [first, second]
    scene.presentation = {
      initialStateId: 'state_export',
      states: [{
        id: 'state_export',
        name: '导出状态',
        layerItemOverrides: {
          [first.layerItemId]: { nativeData: { text: '状态覆盖文字' } },
        },
        layerItemOrder: [second.layerItemId, first.layerItemId],
      }],
    }
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const publishedSurface = published.surfaces.find((candidate) => candidate.type === 'slide')
    const location = published.locations.find((candidate) => candidate.kind === 'slide-scene')
    if (
      !publishedSurface
      || publishedSurface.type !== 'slide'
      || !location
      || location.kind !== 'slide-scene'
    ) throw new Error('expected Published Slide fixture')
    const publishedScene = publishedSurface.scenes.find(
      (candidate) => candidate.id === location.sceneId,
    )
    if (!publishedScene) throw new Error('expected Published Slide scene')

    const composition = composePublishedSlideStaticPage(
      published,
      publishedSurface,
      publishedScene,
      { includeGlobalLayerItems: false, locationId: location.id },
    )

    expect(composition.items.map((item) => [item.layerItemId, item.order])).toEqual([
      [second.layerItemId, 10],
      [first.layerItemId, 30],
    ])
    const materializedFirst = composition.items.find(
      (item) => item.layerItemId === first.layerItemId,
    )
    expect(materializedFirst?.kind).toBe('native')
    if (materializedFirst?.kind !== 'native' || materializedFirst.content.nativeType !== 'text') {
      throw new Error('expected materialized text')
    }
    expect(materializedFirst.content.data.text).toBe('状态覆盖文字')
  })

  it('reports a Slide print-plan scene that has no concrete course location', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    published.locations = []

    const result = await buildCoursePrintArtifacts(published)
    const page = result.pages.find((candidate) => candidate.kind === 'slide-scene')
    expect(page?.locationId).toBeUndefined()
    expect(result.report).toContainEqual(expect.objectContaining({
      severity: 'error',
      pageId: page?.id,
      message: expect.stringContaining('没有课程位置'),
    }))
    expect(result.files.some((file) => file.kind === 'pdf-html')).toBe(false)
  })

  it('fails closed without either printable HTML artifact when a Spatial capture fails', async () => {
    const sources = v9Sources('mixed')
    printCapture.capturePage.mockImplementation((request: { width?: number; height?: number }) => {
      if (request.width === 1120 && request.height === 760) {
        throw new Error('spatial capture generation failed')
      }
      return defaultCaptureForRequest(request)
    })
    const result = await buildCoursePrintArtifacts(sources)

    expect(result.report).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: expect.stringContaining('spatial capture generation failed'),
    }))
    expect(result.files.some((file) => file.kind === 'pdf-html')).toBe(false)
    expect(result.files.some((file) => file.kind === 'flow-print-html')).toBe(false)
    expect(printCapture.destroy).toHaveBeenCalledOnce()
  })

  it('retains Published V2 capture warnings as page-scoped producer facts', async () => {
    printCapture.capturePage.mockImplementation((request) => {
      const capture = defaultCaptureForRequest(request)
      return { ...capture, warnings: ['已使用确定性静态后备'] }
    })

    const result = await buildCoursePrintArtifacts(v9Sources('spatial'))

    expect(result.report.filter((item) => item.message.includes('已使用确定性静态后备')))
      .toEqual(result.pages.map((page) => expect.objectContaining({
        severity: 'warning',
        pageId: page.id,
      })))
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('已使用确定性静态后备'),
    ]))
    expect(result.files.some((file) => file.kind === 'pdf-html')).toBe(true)
  })
})

describe('r11-042 V9 fixture print facts', () => {
  it('records Slide/Flow/Spatial/Mixed page, size, background, overlay and dynamic facts', async () => {
    const slide = await buildCoursePrintArtifacts(v9Sources('slide-native'))
    expect(slide.pages.map((page) => page.kind)).toEqual(['slide-scene'])
    expect(printCapture.create).toHaveBeenCalledOnce()
    expect(printCapture.capturePage).toHaveBeenCalledWith({
      locationId: 'location-scene-1',
      surfaceId: 'surface-slide',
      width: 1280,
      height: 720,
    })
    expect(printCapture.destroy).toHaveBeenCalledOnce()
    const slidePdf = new TextDecoder().decode(
      slide.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(slidePdf).toContain(V2_CAPTURE_IMAGE)
    expect(slidePdf).toContain('@page { size: 13.333in 7.5in; margin: 0; }')
    const slidePrint = new TextDecoder().decode(
      slide.files.find((file) => file.kind === 'flow-print-html')!.bytes,
    )
    expect(slidePrint).toContain('course-slide-print-canvas')
    expect(slidePrint).toContain(V2_CAPTURE_IMAGE)
    expect(slidePrint).toContain('data-capture-width="1280" data-capture-height="720"')
    expect(slidePrint).toContain('background:#fff')
    expect(slidePrint).not.toContain('global-banner')

    printCapture.create.mockClear()
    printCapture.capturePage.mockClear()
    printCapture.destroy.mockClear()
    const flowSources = v9Sources('flow')
    const flowProjectSurface = flowSources.project.surfaces.find((surface) => surface.type === 'flow')
    if (!flowProjectSurface || flowProjectSurface.type !== 'flow') throw new Error('expected Flow project')
    flowProjectSurface.backgroundColor = '#345678'
    const flow = await buildCoursePrintArtifacts(flowSources)
    expect(printCapture.create).not.toHaveBeenCalled()
    expect(flow.pages.map((page) => page.kind)).toEqual(['flow-document'])
    const flowPdf = new TextDecoder().decode(
      flow.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(flowPdf).toContain('class="page flow-print-document"')
    expect(flowPdf).toContain('@page{size:A4 portrait;margin:0}')
    expect(flowPdf).toContain('流式讲义')
    expect(flowPdf).toContain('background:#345678')
    expect(flowPdf).toContain('data-flow-floating-layers="omitted"')
    expect(flowPdf).toContain('data-flow-omitted-floating-layer-count="2"')
    expect(flowPdf).not.toContain('讲义浮层')
    const publishedFlow = buildPublishedCourseV2Payload(flowSources).surfaces.find(
      (surface) => surface.type === 'flow',
    )
    if (!publishedFlow || publishedFlow.type !== 'flow') throw new Error('expected Flow fixture')
    const plan = buildFlowPrintPlan(publishedFlow)
    expect(flowPrintOmittedOverlayMessage(plan)).toContain('2 个浮层不进入语义分页')
    expect(flow.report.some((item) => item.message.includes('浮层不进入语义分页'))).toBe(true)

    const spatialSources = v9Sources('spatial')
    const spatialProjectSurface = spatialSources.project.surfaces.find(
      (surface) => surface.type === 'spatial-2d',
    )
    if (!spatialProjectSurface || spatialProjectSurface.type !== 'spatial-2d') {
      throw new Error('expected Spatial project')
    }
    spatialProjectSurface.backgroundColor = '#654321'
    spatialProjectSurface.surfaceLayerItems.push({
      item: sceneNodeToCourseLayerItem(createTextNode({
        id: 'spatial-surface-marker',
        text: '空间浮层',
        x: 20,
        y: 20,
        width: 200,
        height: 48,
      }), 950),
      visibility: { mode: 'all', locationIds: [] },
    })
    printCapture.create.mockClear()
    printCapture.capturePage.mockClear()
    printCapture.destroy.mockClear()
    const spatial = await buildCoursePrintArtifacts(spatialSources)
    expect(spatial.pages.map((page) => page.kind)).toEqual(['spatial-frame', 'spatial-frame'])
    expect(printCapture.create).toHaveBeenCalledOnce()
    expect(printCapture.capturePage).toHaveBeenCalledTimes(2)
    expect(printCapture.capturePage.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({
        frameId: 'camera-home',
        width: 1120,
        height: 760,
      }),
      expect.objectContaining({
        frameId: 'camera-detail',
        width: 1120,
        height: 760,
      }),
    ])
    expect(printCapture.destroy).toHaveBeenCalledOnce()
    const spatialPrint = new TextDecoder().decode(
      spatial.files.find((file) => file.kind === 'flow-print-html')!.bytes,
    )
    expect(spatialPrint.match(new RegExp(SPATIAL_CAPTURE_IMAGE, 'g'))).toHaveLength(2)
    expect(spatialPrint.match(/data-capture-width="1120" data-capture-height="760"/g))
      .toHaveLength(2)
    expect(spatialPrint).toContain('object-fit:contain')
    const spatialPdf = new TextDecoder().decode(
      spatial.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(spatialPdf).toBe(spatialPrint)
    expect(spatialPdf).toContain('course-spatial-print-page')
    expect(spatial.pages).toHaveLength(2)

    printCapture.create.mockClear()
    printCapture.capturePage.mockClear()
    printCapture.destroy.mockClear()
    const mixed = await buildCoursePrintArtifacts(v9Sources('mixed'))
    expect(mixed.pages.map((page) => page.kind)).toEqual([
      'slide-scene',
      'flow-document',
      'spatial-frame',
    ])
    const mixedPdf = new TextDecoder().decode(
      mixed.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    const mixedPrint = new TextDecoder().decode(
      mixed.files.find((file) => file.kind === 'flow-print-html')!.bytes,
    )
    expect(mixedPdf).toBe(mixedPrint)
    expect(printCapture.create).toHaveBeenCalledOnce()
    expect(printCapture.capturePage).toHaveBeenCalledTimes(2)
    expect(printCapture.capturePage.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ width: 1280, height: 720 }),
      expect.objectContaining({ width: 1120, height: 760 }),
    ])
    expect(mixedPdf).toContain('@page{size:13.333333in 7.5in;margin:0}')
    expect(mixedPdf).toContain('alt="演示页"')
    expect(mixedPdf).toContain('讲义标题')
    expect(mixedPdf).toContain('course-slide-print-canvas')
    expect(mixedPdf).toContain('course-spatial-print-canvas')
    expect(mixedPdf).toContain('background:#ffffff')
    expect(mixedPdf).toContain('data-published-v2-capture="true"')
    expect(mixedPdf).toContain(V2_CAPTURE_IMAGE)
    expect(mixedPdf).toContain(SPATIAL_CAPTURE_IMAGE)
    expect(mixedPdf).toContain('data-capture-width="1280" data-capture-height="720"')
    expect(mixedPdf).toContain('data-capture-width="1120" data-capture-height="760"')
    expect(mixedPdf).toContain('object-fit:contain')
    expect(mixedPdf).not.toContain('跨表面横幅')
    expect([
      ...mixedPdf.matchAll(/<section class="page [^"]*"[^>]*data-page-id="([^"]+)"/g),
    ].map((match) => match[1])).toEqual(mixed.pages.map((page) => page.id))
    expect(mixed.report.some((item) => item.message.includes('全局图层'))).toBe(true)

    printCapture.create.mockClear()
    printCapture.capturePage.mockClear()
    printCapture.destroy.mockClear()
    const component = await buildCoursePrintArtifacts(v9Sources('component'))
    expect(component.report.some((item) => (
      item.message.includes('slide-quiz') && item.message.includes('静态后备图')
    ))).toBe(false)
    expect(new TextDecoder().decode(
      component.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )).toContain(V2_CAPTURE_IMAGE)
    expect(createPublishedCourseV2PrintCaptureSession).toHaveBeenCalled()
  })

  it('rejects a V8 source instead of restoring the retired raster path', async () => {
    await expect(buildCoursePrintArtifacts({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    } as never)).rejects.toThrow(/Published Course V2|V9 发布源|Legacy Project/)
    expect(printCapture.create).not.toHaveBeenCalled()
  })

  it('adapts PDF producer facts without copying health rules', async () => {
    const mixed = v9Sources('mixed')
    const mixedFindings = adaptCoursePdfProducerFindings(mixed.project, {
      assetFiles: mixed.assetFiles,
      components: mixed.components,
    }, [])
    expect(mixedFindings.some((item) => (
      item.code === 'static-export-info'
      && item.message.includes('全局图层与教师控制器默认不写入 PDF')
    ))).toBe(true)

    const flow = v9Sources('flow')
    const flowFindings = adaptCoursePdfProducerFindings(flow.project, {
      assetFiles: flow.assetFiles,
      components: flow.components,
    }, [])
    expect(flowFindings.some((item) => (
      item.code === 'static-export-info'
      && item.message.includes('浮层不进入语义分页')
    ))).toBe(true)

    const component = v9Sources('component')
    const componentFindings = adaptCoursePdfProducerFindings(component.project, {
      assetFiles: component.assetFiles,
      components: component.components,
    }, [])
    expect(componentFindings.some((item) => (
      item.message.includes('slide-quiz') && item.message.includes('静态后备图')
    ))).toBe(false)

    const spatialComponent = v9Sources('spatial')
    const componentItem = component.project.surfaces
      .flatMap((surface) => surface.type === 'slide'
        ? surface.scenes.flatMap((scene) => scene.layerItems)
        : [])
      .find((item) => item.kind === 'component')
    const spatialSurface = spatialComponent.project.surfaces.find(
      (surface) => surface.type === 'spatial-2d',
    )
    if (!componentItem || !spatialSurface || spatialSurface.type !== 'spatial-2d') {
      throw new Error('expected Component and Spatial fixtures')
    }
    const spatialComponentItem = structuredClone(componentItem)
    spatialComponentItem.frame = {
      ...spatialComponentItem.frame,
      mode: 'absolute',
      x: 0,
      y: 0,
    }
    spatialComponentItem.order = spatialSurface.world.layerItems.reduce(
      (highest, item) => Math.max(highest, item.order),
      -1,
    ) + 1
    spatialSurface.world.layerItems.push(spatialComponentItem)
    Object.assign(spatialComponent.project.assets, component.project.assets)
    Object.assign(spatialComponent.project.componentPackages, component.project.componentPackages)
    Object.assign(spatialComponent.assetFiles, component.assetFiles)
    Object.assign(spatialComponent.components, component.components)

    const spatialBuilt = await buildCoursePrintArtifacts(spatialComponent)
    const fallbackMessage = spatialBuilt.report.find((item) => (
      item.message.includes('slide-quiz') && item.message.includes('Spatial PDF')
    ))?.message
    expect(fallbackMessage).toContain('静态后备图')
    const spatialComponentPdf = new TextDecoder().decode(
      spatialBuilt.files.find((file) => file.kind === 'pdf-html')!.bytes,
    )
    expect(spatialComponentPdf).toContain(SPATIAL_CAPTURE_IMAGE)
    expect(spatialComponentPdf).toContain('data-capture-width="1120" data-capture-height="760"')

    const spatialComponentFindings = adaptCoursePdfProducerFindings(
      spatialComponent.project,
      {
        assetFiles: spatialComponent.assetFiles,
        components: spatialComponent.components,
      },
      [],
    )
    expect(spatialComponentFindings.some((item) => item.message === fallbackMessage)).toBe(true)
  })
})
