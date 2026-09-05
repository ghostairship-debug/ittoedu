import { describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PublishedLayerItem } from '@/shared/publishedCourseTypes'
import type { RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { ImageNode } from '@/shared/contracts/native-v1/types'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { componentPackagesFromArchive } from '@/renderer/components/componentPackageStore'
import { addCourseSlidePage } from '@/renderer/course/courseLocationCommands'
import { buildPublishedCourseV2Payload, type CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'
import { buildCourseExportPageList } from '@/renderer/export/course/buildCoursePrintArtifacts'
import { buildCoursePptx } from '@/renderer/export/course/buildCoursePptx'
import { collectCourseProjectExportPreflight } from '@/renderer/export/exportPreflight'
import { addPptxFormulaNode, addPptxShapeNode } from '@/renderer/export/pptxTextAndShape'
import { WIDE_SLIDE_HEIGHT, WIDE_SLIDE_WIDTH } from '@/renderer/export/pptxShared'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { APP_COMPANY, APP_NAME, CANVAS_HEIGHT, CANVAS_WIDTH } from '@/shared/constants'
import { createShapeNode, createTextNode, createFormulaNode, createTableNode, createChartNode, createTableLayerItem, createChartLayerItem } from '@/renderer/project/nativeNodeFactories'
import {
  listCourseProjectV9Fixtures,
  type CourseProjectV9FixtureId,
} from '../fixtures/course-project-v9'

const NOW = '2026-08-17T12:00:00.000Z'

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

function decodePptxSlides(bytes: Uint8Array): string {
  const archive = unzipSync(bytes)
  return Object.entries(archive)
    .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
    .map(([, slideBytes]) => new TextDecoder().decode(slideBytes))
    .join('\n')
}

describe('buildCourseExportPageList', () => {
  it('derives Slide scene, Spatial camera-frame, and Flow print-plan pages from Published V2', () => {
    const published = buildPublishedCourseV2Payload(v9Sources('mixed'))
    const pages = buildCourseExportPageList(published)
    expect(pages.some((page) => page.kind === 'slide-scene')).toBe(true)
    expect(pages.some((page) => page.kind === 'flow-document')).toBe(true)
    expect(pages.filter((page) => page.kind === 'spatial-frame').length).toBeGreaterThan(0)
    expect(pages.map((page) => page.kind)).not.toContain('global-layer')
  })
})

describe('buildCoursePptx', () => {
  it('keeps the V2 PPTX helper boundary independent of V8 project types', () => {
    const helperSources = [
      'src/renderer/export/course/buildCoursePptx.ts',
      'src/renderer/export/pptxShared.ts',
      'src/renderer/export/pptxTextAndShape.ts',
      'src/renderer/export/renderPptxComponentSnapshots.ts',
      'src/renderer/export/renderPptxRuntimeSnapshots.ts',
      'src/shared/imageEffects.ts',
    ].map((relativePath) => readFileSync(join(process.cwd(), relativePath), 'utf8'))

    for (const source of helperSources) {
      expect(source).not.toMatch(
        /from ['"][^'"]*\/projectTypes['"]/,
      )
      const retiredSymbols = [
        ['Scene', 'Node'].join(''),
        ['buildExport', 'Payload'].join(''),
        ['Player', 'App'].join(''),
      ]
      expect(source).not.toMatch(new RegExp(`\\b(?:${retiredSymbols.join('|')})\\b`))
    }
    expect(helperSources.join('\n')).toMatch(/contracts\/native-v1\/types/)
  })

  it('builds from V9 mixed sources, keeps Slide text editable, and keeps Spatial off 1280×720 crop', async () => {
    const sources = v9Sources('mixed')
    const published = buildPublishedCourseV2Payload(sources)
    const pages = buildCourseExportPageList(published)
    const spatialPage = pages.find((page) => page.kind === 'spatial-frame')
    expect(spatialPage).toBeTruthy()

    const result = await buildCoursePptx(sources)
    expect(result.bytes.byteLength).toBeGreaterThan(100)
    expect(result.bytes[0]).toBe(0x50)
    expect(result.bytes[1]).toBe(0x4b)
    expect(result.slideCount).toBeGreaterThan(0)
    expect(result.report.some((item) => item.message.includes('全局图层'))).toBe(true)
    expect(result.report.some((item) => item.message.includes('没有 PPTX 映射'))).toBe(true)

    const archive = unzipSync(result.bytes)
    const slideXml = decodePptxSlides(result.bytes)
    expect(slideXml).toContain('Mixed 起始页')
    expect(slideXml).not.toContain('跨表面横幅')
    expect(slideXml).not.toContain('global-banner')
    expect(result.pages.find((page) => page.id === spatialPage!.id)).toBeTruthy()

    const spatialPages = pages.filter((page) => page.kind === 'spatial-frame')
    const spatialPageIndex = spatialPages.findIndex((page) => page.id === spatialPage!.id)
    const spatialSlideNumber = pages.filter((page) => page.kind === 'slide-scene').length
      + spatialPageIndex
      + 1
    const spatialRelsPath = `ppt/slides/_rels/slide${spatialSlideNumber}.xml.rels`
    const spatialRelsBytes = archive[spatialRelsPath]
    expect(spatialRelsBytes, `${spatialRelsPath} should exist`).toBeTruthy()
    const spatialRelsXml = new TextDecoder().decode(spatialRelsBytes)
    const spatialMediaTarget = spatialRelsXml.match(/Target="\.\.\/media\/([^"?]+\.svg)"/)?.[1]
    expect(spatialMediaTarget, 'Spatial slide should reference an SVG in ppt/media').toBeTruthy()

    const spatialMediaPath = `ppt/media/${spatialMediaTarget}`
    const spatialMediaBytes = archive[spatialMediaPath]
    expect(spatialMediaBytes, `${spatialMediaPath} should exist`).toBeTruthy()
    const spatialSvg = new TextDecoder().decode(spatialMediaBytes)
    expect(spatialSvg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(spatialSvg).toContain(`data-spatial-frame="${spatialPage!.cameraFrameId ?? 'home'}"`)
    expect(spatialSvg).toContain('data-spatial-viewport="1120x760"')
    expect(spatialSvg).not.toContain('data-spatial-viewport="1280x720"')
  })

  it('renders a Native image from its complete V1 crop/effect input', async () => {
    const sources = v9Sources('multi-asset')
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const imageItem = slide.scenes[0]?.layerItems.find((item) => (
      item.kind === 'native' && item.content.nativeType === 'image'
    ))
    if (!imageItem || imageItem.kind !== 'native' || imageItem.content.nativeType !== 'image') {
      throw new Error('expected Native image')
    }
    Object.assign(imageItem.content.data, {
      fit: 'cover',
      crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 },
      cropX: 0.25,
      cropY: 0.75,
      flipX: true,
      flipY: true,
      cornerRadius: 18,
      feather: { amount: 24, mode: 'ellipse' },
    })
    const renderedInputs: Array<{ node: ImageNode; assetDataUrl: string }> = []
    const result = await buildCoursePptx(sources, {
      renderNativeImage(input) {
        renderedInputs.push(structuredClone(input))
        return `data:image/png;base64,${Buffer.from(sources.assetFiles.photo!).toString('base64')}`
      },
    })

    expect(result.bytes.byteLength).toBeGreaterThan(100)
    expect(renderedInputs).toHaveLength(1)
    expect(renderedInputs[0]?.assetDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(renderedInputs[0]?.node).toMatchObject({
      type: 'image',
      assetId: 'photo',
      fit: 'cover',
      crop: { left: 0.1, top: 0.2, right: 0.15, bottom: 0.05 },
      cropX: 0.25,
      cropY: 0.75,
      flipX: true,
      flipY: true,
      cornerRadius: 18,
      feather: { amount: 24, mode: 'ellipse' },
    })
    expect(decodePptxSlides(result.bytes)).toContain('slide-photo · 可编辑图片')
  })

  it('reports Spatial static fallbacks and unsupported carriers in builder and preflight', async () => {
    const sources = v9Sources('spatial')
    const spatial = sources.project.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (!spatial || spatial.type !== 'spatial-2d') throw new Error('expected Spatial surface')
    spatial.world.layerItems.push(
      sceneNodeToCourseLayerItem(createShapeNode('diamond', {
        id: 'spatial-shape',
        name: '空间图形',
        x: 20,
        y: 30,
      }), 30),
    )
    const runtime: RuntimeLayerItem = {
      layerItemId: 'spatial-runtime-no-fallback',
      label: '空间运行时',
      frame: { mode: 'absolute', x: 120, y: 180, width: 320, height: 180 },
      order: 40,
      visible: true,
      locked: false,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'surface',
      playbackInitialVisibility: 'inherit',
      kind: 'runtime',
      runtime: {
        protocol: 'surface-runtime',
        runtimeApiVersion: 3,
        enabled: true,
        renderMode: 'dom',
        source: 'CoursewareRuntime.define({runtimeApiVersion:3,protocol:"surface-runtime",create(){return{destroy(){}}}})',
        content: { values: {} },
        assets: {},
      },
    }
    spatial.world.layerItems.push(runtime)

    const built = await buildCoursePptx(sources)
    const preflight = collectCourseProjectExportPreflight(
      sources.project,
      'pptx',
      { assetFiles: sources.assetFiles, components: sources.components },
      new Date(NOW),
      { playerBundle: '/* player */' },
    )
    const shapeMessage = 'Spatial 原生对象“spatial-shape”（shape）没有 PPTX 镜头映射，已明确省略。'
    const runtimeMessage = 'Spatial 运行时“spatial-runtime-no-fallback”缺少可用静态后备，PPTX 镜头使用可见占位。'

    expect(built.report).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: shapeMessage }),
      expect.objectContaining({ severity: 'warning', message: runtimeMessage }),
    ]))
    expect(built.warnings).toEqual(expect.arrayContaining([shapeMessage, runtimeMessage]))
    expect(preflight.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'warning',
        code: 'static-export-warning',
        message: shapeMessage,
        diagnosticTarget: expect.objectContaining({
          kind: 'layer-item',
          owner: 'world',
          layerItemId: 'spatial-shape',
        }),
      }),
      expect.objectContaining({
        severity: 'warning',
        code: 'static-export-warning',
        message: runtimeMessage,
        diagnosticTarget: expect.objectContaining({
          kind: 'layer-item',
          owner: 'world',
          layerItemId: runtime.layerItemId,
        }),
      }),
    ]))
  })

  it('composes visible pure-Slide globals while omitting the static-disabled controller', async () => {
    const sources = v9Sources('global-layer-teacher-controller')
    const result = await buildCoursePptx(sources)
    const slideXml = decodePptxSlides(result.bytes)
    expect(slideXml).toContain('全课横幅')
    expect(slideXml).toContain('global-banner')
    expect(slideXml).not.toContain('teacher-controller-main')
    expect(slideXml).not.toContain('教师控制台')
    expect(result.report.some((item) => item.message.includes('默认不写入 PPTX'))).toBe(false)
  })

  it('captures Component/Runtime through the V2 identity, not a restored V8 payload', async () => {
    let project = createBlankCourseProject({ now: NOW, includeDefaultController: true })
    const secondPage = addCourseSlidePage(project, {
      now: NOW,
      expectedRevision: project.revision,
    })
    if (!secondPage.ok) throw new Error(secondPage.reason)
    project = secondPage.project
    const controllerId = project.globalLayerItems[0]?.item.layerItemId
    if (!controllerId) throw new Error('expected global teacher controller')
    const globalText = sceneNodeToCourseLayerItem(createTextNode({
      id: 'global-editable-text',
      name: '全局可编辑文字',
      text: '全局可编辑页脚',
      x: 48,
      y: 650,
      width: 420,
      height: 48,
    }), 900)
    project.globalLayerItems.push({
      item: globalText,
      visibility: { mode: 'include', locationIds: [project.startLocationId] },
      plane: 'overlay',
    })
    const published = buildPublishedCourseV2Payload({
      project,
      assetFiles: {},
      components: {},
    })
    const base = {
      frame: { mode: 'absolute' as const, x: 520, y: 520, width: 260, height: 100 },
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto' as const,
      playbackInitialVisibility: 'inherit' as const,
    }
    const component: PublishedLayerItem = {
      ...base,
      layerItemId: 'global-component-static',
      order: 901,
      kind: 'component',
      component: { packageId: 'component.quiz', version: '4.0.0' },
      props: {},
    }
    const runtime: PublishedLayerItem = {
      ...base,
      layerItemId: 'global-runtime-static',
      order: 902,
      kind: 'runtime',
      runtime: {
        protocol: 'canvas-runtime',
        runtimeApiVersion: 2,
        enabled: true,
        renderMode: 'dom',
        code: { encoding: 'base64-utf16le', data: '' },
        content: { values: {} },
        assets: {},
      },
    }
    published.globalLayerItems.push(
      {
        item: component,
        visibility: { mode: 'include', locationIds: [published.startLocationId] },
        plane: 'overlay',
      },
      {
        item: runtime,
        visibility: { mode: 'include', locationIds: [published.startLocationId] },
        plane: 'overlay',
      },
    )
    const capturedIds: string[] = []
    const capturedLocationIds: string[] = []
    const result = await buildCoursePptx(published, {
      captureDynamicItem: ({ item, locationId }) => {
        capturedIds.push(item.layerItemId)
        capturedLocationIds.push(locationId)
        return undefined
      },
    })

    const slideXml = decodePptxSlides(result.bytes)
    expect(slideXml).toContain('全局可编辑页脚')
    expect(Object.entries(unzipSync(result.bytes))
      .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .filter((xml) => xml.includes('全局可编辑页脚'))).toHaveLength(1)
    expect(slideXml).toContain(globalText.layerItemId)
    expect(slideXml).not.toContain(controllerId)
    expect(slideXml).toContain(component.layerItemId)
    expect(slideXml).toContain(runtime.layerItemId)
    expect(capturedIds).toEqual([component.layerItemId, runtime.layerItemId])
    expect(capturedLocationIds).toEqual([
      published.startLocationId,
      published.startLocationId,
    ])
  })

  it('reports missing asset bytes in Chinese without throwing', async () => {
    const published = buildPublishedCourseV2Payload(v9Sources('mixed'))
    const broken = structuredClone(published)
    broken.assets['missing-slide-image'] = { mimeType: 'image/png', url: '' }

    const result = await buildCoursePptx(broken)
    expect(result.bytes.byteLength).toBe(0)
    expect(result.slideCount).toBe(0)
    expect(result.report.some((item) => (
      item.severity === 'error' && item.message.includes('缺少可离线引用')
    ))).toBe(true)
  })

  it('blocks both preflight and file emission when any Slide scene has no course location', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const sources: CoursePublishSources = { project, assetFiles: {}, components: {} }
    const surface = project.surfaces.find((candidate) => candidate.type === 'slide')
    if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
    const orphan = structuredClone(surface.scenes[0]!)
    orphan.id = 'orphan-scene'
    orphan.name = '未定位场景'
    surface.scenes.push(orphan)

    const preflight = collectCourseProjectExportPreflight(
      sources.project,
      'pptx',
      { assetFiles: sources.assetFiles, components: sources.components },
      new Date(NOW),
      { playerBundle: '/* player */' },
    )
    expect(preflight.summary.canExport).toBe(false)
    expect(preflight.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: expect.stringContaining('未定位场景'),
    }))

    const result = await buildCoursePptx(sources)
    expect(result.bytes.byteLength).toBe(0)
    expect(result.slideCount).toBe(0)
    expect(result.report).toContainEqual(expect.objectContaining({
      severity: 'error',
      message: expect.stringContaining('未定位场景'),
    }))
  })

  it('returns no PPTX bytes for Flow-only courses and names the missing mapping', async () => {
    const result = await buildCoursePptx(v9Sources('flow'))
    expect(result.bytes.byteLength).toBe(0)
    expect(result.slideCount).toBe(0)
    expect(result.report.some((item) => (
      item.severity === 'error'
      && item.message.includes('没有可映射到 PPTX')
    ))).toBe(true)
  })

  it('生成原生文字和图形，不退化为整页图片', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    project.title = '可编辑 PPTX'
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.layerItems = [
      sceneNodeToCourseLayerItem(createShapeNode('rounded-rectangle', {
        id: 'shape-pptx',
        name: '信息卡片',
        x: 180,
        y: 120,
        playbackInitialVisibility: 'hidden',
      }), 10),
      sceneNodeToCourseLayerItem(createTextNode({
        id: 'text-pptx',
        name: '可编辑标题',
        text: 'PowerPoint 中可修改',
        style: {
          fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
        },
      }), 20),
    ]
    const result = await buildCoursePptx({
      project,
      assetFiles: {},
      components: {},
    })
    const archive = unzipSync(result.bytes)
    const slideXml = decodePptxSlides(result.bytes)
    const corePropertiesXml = new TextDecoder().decode(archive['docProps/core.xml'])
    const applicationPropertiesXml = new TextDecoder().decode(archive['docProps/app.xml'])
    const parsed = new DOMParser().parseFromString(slideXml, 'application/xml')

    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(slideXml).toContain('PowerPoint 中可修改')
    expect(slideXml.match(/<p:sp>/g)).toHaveLength(2)
    expect(slideXml).not.toContain('<p:pic>')
    expect(slideXml).not.toContain('<p:timing>')
    expect(slideXml).toContain('typeface="Microsoft YaHei"')
    expect(corePropertiesXml).toContain(`>${APP_NAME}<`)
    expect(applicationPropertiesXml).toContain(`>${APP_COMPANY}<`)
  })

  it('导出 Slide 表格为原生可编辑 PPTX 表格，不截图', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const table = createTableNode({ id: 'table-pptx', name: '数据表格' })
    slide.scenes[0]!.layerItems = [createTableLayerItem(table, 10)]

    const result = await buildCoursePptx({
      project,
      assetFiles: {},
      components: {},
    })
    const slideXml = decodePptxSlides(result.bytes)
    const parsed = new DOMParser().parseFromString(slideXml, 'application/xml')

    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(slideXml).toContain('<a:tbl>')
    expect(slideXml).toContain('标题 1')
    expect(slideXml).toContain('单元格 2-1')
    expect(slideXml).not.toContain('<p:pic>')
    expect(result.warnings.filter((message) => message.includes('表格'))).toHaveLength(0)
  })

  it('表格旋转与点线边框在导出与 preflight 中给出明示 warning', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const table = createTableNode({
      id: 'table-rotated',
      name: '旋转表格',
      rotation: 30,
      style: { lineStyle: 'dotted' },
    })
    slide.scenes[0]!.layerItems = [createTableLayerItem(table, 10)]

    const result = await buildCoursePptx({
      project,
      assetFiles: {},
      components: {},
    })
    expect(result.warnings.some((message) => (
      message.includes('table-rotated') && message.includes('旋转')
    ))).toBe(true)
    expect(result.warnings.some((message) => (
      message.includes('table-rotated') && message.includes('点线')
    ))).toBe(true)
    // The table body is still present as a native PPTX table.
    expect(decodePptxSlides(result.bytes)).toContain('<a:tbl>')

    const preflight = collectCourseProjectExportPreflight(
      project,
      'pptx',
      { assetFiles: {}, components: {} },
      new Date(NOW),
      { playerBundle: '/* player */' },
    )
    const warnings = preflight.items.filter((item) => (
      item.code === 'static-export-warning' && item.message.includes('旋转表格')
    ))
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it.each([
    ['bar', '<c:barChart>'],
    ['line', '<c:lineChart>'],
    ['area', '<c:areaChart>'],
    ['pie', '<c:pieChart>'],
    ['donut', '<c:doughnutChart>'],
  ] as const)('导出 %s 图表为原生可编辑 PPTX 图表', async (chartType, chartTag) => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const chart = createChartNode({ id: `chart-pptx-${chartType}`, chartType })
    slide.scenes[0]!.layerItems = [createChartLayerItem(chart, 10)]

    const result = await buildCoursePptx({
      project,
      assetFiles: {},
      components: {},
    })
    const archive = unzipSync(result.bytes)
    const chartEntries = Object.keys(archive).filter((name) => (
      /^ppt\/charts\/chart\d+\.xml$/.test(name)
    ))
    expect(chartEntries.length).toBeGreaterThan(0)
    const chartXml = new TextDecoder().decode(archive[chartEntries[0]!])
    const parsed = new DOMParser().parseFromString(chartXml, 'application/xml')
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(chartXml).toContain(chartTag)
    expect(chartXml).toContain('类别 1')

    const slideRels = Object.keys(archive)
      .filter((name) => /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(name))
      .map((name) => new TextDecoder().decode(archive[name]!))
      .join('\n')
    expect(slideRels).toContain('relationships/chart')

    if (chartType === 'bar') {
      expect(chartXml).toContain('barDir val="col"')
      expect(chartXml).toContain('grouping val="clustered"')
    }
    if (chartType === 'donut') {
      expect(chartXml).toContain('<c:holeSize val="50"/>')
    }
  })

  it('rejects a retired V8-era export package instead of restoring the old PPTX builder', async () => {
    await expect(buildCoursePptx({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    } as never)).rejects.toThrow(/Published Course V2|V9 发布源|旧版导出包/)
  })

  it('staticizes PPTX formulas as a transparent image with traceable metadata', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {
        arc: vi.fn(),
        beginPath: vi.fn(),
        clearRect: vi.fn(),
        clip: vi.fn(),
        closePath: vi.fn(),
        drawImage: vi.fn(),
        fill: vi.fn(),
        fillRect: vi.fn(),
        fillText: vi.fn(),
        lineTo: vi.fn(),
        measureText: vi.fn((value: string) => ({
          width: Math.max(8, Array.from(value).length * 14),
        })),
        moveTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        rect: vi.fn(),
        roundRect: vi.fn(),
        restore: vi.fn(),
        rotate: vi.fn(),
        save: vi.fn(),
        scale: vi.fn(),
        stroke: vi.fn(),
        strokeRect: vi.fn(),
        translate: vi.fn(),
        fillStyle: '',
        strokeStyle: '',
        font: '',
        globalAlpha: 1,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        lineCap: 'butt',
        lineJoin: 'miter',
        lineWidth: 1,
        textAlign: 'left',
        textBaseline: 'alphabetic',
      } as unknown as CanvasRenderingContext2D,
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,Zm9ybXVsYQ==',
    )
    const formula = createFormulaNode({
      id: 'formula-pptx',
      formulaId: 'math.pptx.1',
      accessibleText: '二分之一',
      ast: {
        type: 'fraction',
        numerator: { type: 'token', value: '1' },
        denominator: { type: 'token', value: '2' },
      },
    })
    const slide = { addImage: vi.fn() }

    addPptxFormulaNode(
      slide as never,
      formula,
      { x: 13.333 / 1280, y: 7.5 / 720 },
    )

    expect(slide.addImage).toHaveBeenCalledWith(expect.objectContaining({
      data: 'data:image/png;base64,Zm9ybXVsYQ==',
      objectName: expect.stringContaining('静态公式'),
      altText: expect.stringContaining('math.pptx.1'),
    }))
  })

  describe('addPptxShapeNode line geometry', () => {
    it('positions a non-default straight line at its authored bbox and keeps position invariant to draw direction, flipping only the arrow mapping', () => {
      const forward = createShapeNode('line', {
        id: 'line-mock-forward',
        name: '对角线',
        x: 100,
        y: 50,
        width: 300,
        height: 200,
      })
      // Bottom-left -> top-right ("/"): drawn from its own bottom/right point
      // toward its top/left point.
      forward.lineGeometry = { kind: 'straight', start: [0, 1], end: [1, 0] }
      const forwardSlide = { addShape: vi.fn() }
      expect(addPptxShapeNode(forwardSlide as never, forward, { x: 1, y: 1 })).toEqual([])
      expect(forwardSlide.addShape).toHaveBeenCalledWith('line', expect.objectContaining({
        x: 100, y: 50, w: 300, h: 200, flipH: false, flipV: true, rotate: 0,
      }))

      // Same visual segment, authored in the opposite direction (top-right ->
      // bottom-left). Position must stay identical; only the flip flags that
      // decide which end an asymmetric arrowhead lands on may change.
      const reversed = createShapeNode('line', {
        id: 'line-mock-reversed',
        name: '对角线反向',
        x: 100,
        y: 50,
        width: 300,
        height: 200,
      })
      reversed.lineGeometry = { kind: 'straight', start: [1, 0], end: [0, 1] }
      const reversedSlide = { addShape: vi.fn() }
      expect(addPptxShapeNode(reversedSlide as never, reversed, { x: 1, y: 1 })).toEqual([])
      expect(reversedSlide.addShape).toHaveBeenCalledWith('line', expect.objectContaining({
        x: 100, y: 50, w: 300, h: 200, flipH: true, flipV: false, rotate: 0,
      }))
    })

    it('rotates a straight line about its own center before translating to absolute coordinates', () => {
      const node = createShapeNode('line', {
        id: 'line-mock-rotated',
        name: '旋转直线',
        x: 100,
        y: 50,
        width: 300,
        height: 200,
        rotation: 90,
      })
      node.lineGeometry = { kind: 'straight', start: [0, 1], end: [1, 0] }
      const slide = { addShape: vi.fn() }
      addPptxShapeNode(slide as never, node, { x: 1, y: 1 })
      const call = slide.addShape.mock.calls[0]?.[1] as Record<string, unknown>
      expect(call.rotate).toBe(0)
      expect(call.x as number).toBeCloseTo(150, 9)
      expect(call.y as number).toBeCloseTo(0, 9)
      expect(call.w as number).toBeCloseTo(200, 9)
      expect(call.h as number).toBeCloseTo(300, 9)
      expect(call.flipH).toBe(false)
      expect(call.flipV).toBe(false)
    })

    it('falls back to the default straight geometry when lineGeometry is absent, matching the pre-existing visual', () => {
      const node = createShapeNode('line', { id: 'line-mock-default', name: '默认线', x: 10, y: 20, width: 400, height: 60 })
      const slide = { addShape: vi.fn() }
      addPptxShapeNode(slide as never, node, { x: 1, y: 1 })
      expect(slide.addShape).toHaveBeenCalledWith('line', expect.objectContaining({
        x: 10, y: 50, w: 400, h: 0, flipH: false, flipV: false, rotate: 0,
      }))
    })

    it('renders a non-default elbow via the shared point resolver as a static SVG image, not bentArrow, and returns a locatable pptx-static-elbow warning', () => {
      const node = createShapeNode('elbow-arrow', {
        id: 'elbow-mock',
        name: '折线箭头',
        x: 50,
        y: 400,
        width: 400,
        height: 150,
      })
      node.lineGeometry = { kind: 'elbow', start: [0, 0.2], end: [1, 0.8], axis: 'horizontal', position: 0.6 }
      const slide = { addImage: vi.fn() }
      const warnings = addPptxShapeNode(slide as never, node, { x: 1, y: 1 })

      expect(slide.addImage).toHaveBeenCalledTimes(1)
      const call = slide.addImage.mock.calls[0]?.[0] as { data: string; x: number; y: number; w: number; h: number }
      expect(call.x).toBe(50)
      expect(call.y).toBe(430)
      expect(call.w).toBe(400)
      expect(call.h).toBe(90)
      expect(call.data.startsWith('data:image/svg+xml;base64,')).toBe(true)
      const svg = Buffer.from(call.data.split(',')[1]!, 'base64').toString('utf8')
      expect(svg).toContain('<polyline')
      expect(svg).toContain('points="0,0 240,0 240,90 400,90"')
      expect(svg).toContain('stroke="#2563eb"')
      expect(svg).toContain('stroke-width="4"')
      expect(svg).not.toContain('stroke-dasharray')

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('elbow-mock')
      expect(warnings[0]).toContain('pptx-static-elbow')
    })

    it('applies dashed/dotted lineStyle to the elbow static-fallback stroke-dasharray', () => {
      const node = createShapeNode('elbow-arrow', {
        id: 'elbow-dashed',
        name: '虚线折线',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        style: { lineStyle: 'dashed' },
      })
      const slide = { addImage: vi.fn() }
      addPptxShapeNode(slide as never, node, { x: 1, y: 1 })
      const call = slide.addImage.mock.calls[0]?.[0] as { data: string }
      const svg = Buffer.from(call.data.split(',')[1]!, 'base64').toString('utf8')
      expect(svg).toContain('stroke-dasharray')
    })
  })

  it('导出非默认直线时保留手绘的端点位置与方向，而不是回退成通宽水平线', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const lineNode = createShapeNode('line', {
      id: 'shape-line-diag',
      name: '对角线',
      x: 100,
      y: 50,
      width: 300,
      height: 200,
    })
    lineNode.lineGeometry = { kind: 'straight', start: [0, 1], end: [1, 0] }
    slide.scenes[0]!.layerItems = [sceneNodeToCourseLayerItem(lineNode, 10)]

    const result = await buildCoursePptx({ project, assetFiles: {}, components: {} })
    const slideXml = decodePptxSlides(result.bytes)
    const parsed = new DOMParser().parseFromString(slideXml, 'application/xml')
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0)

    const needleIndex = slideXml.indexOf('shape-line-diag')
    expect(needleIndex).toBeGreaterThan(-1)
    const spStart = slideXml.lastIndexOf('<p:sp>', needleIndex)
    const spEnd = slideXml.indexOf('</p:sp>', needleIndex) + '</p:sp>'.length
    expect(spStart).toBeGreaterThan(-1)
    const spXml = slideXml.slice(spStart, spEnd)

    expect(spXml).toContain('<a:prstGeom prst="line">')
    const xfrmOpenTag = spXml.match(/<a:xfrm[^>]*>/)?.[0] ?? ''
    expect(xfrmOpenTag).toContain('flipV="1"')
    expect(xfrmOpenTag).not.toContain('flipH="1"')
    expect(xfrmOpenTag).not.toContain('rot=')

    const off = spXml.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/)
    const ext = spXml.match(/<a:ext cx="(-?\d+)" cy="(-?\d+)"\/>/)
    expect(off).toBeTruthy()
    expect(ext).toBeTruthy()
    const scaleX = WIDE_SLIDE_WIDTH / CANVAS_WIDTH
    const scaleY = WIDE_SLIDE_HEIGHT / CANVAS_HEIGHT
    const toEmuX = (px: number) => Math.round(914400 * px * scaleX)
    const toEmuY = (px: number) => Math.round(914400 * px * scaleY)
    expect(Number(off![1])).toBe(toEmuX(100))
    expect(Number(off![2])).toBe(toEmuY(50))
    expect(Number(ext![1])).toBe(toEmuX(300))
    expect(Number(ext![2])).toBe(toEmuY(200))

    // The old fixed-horizontal export put this at the vertical midline
    // (y=150) with zero height; assert we are nowhere near that shape.
    expect(Number(off![2])).not.toBe(toEmuY(150))
    expect(Number(ext![2])).not.toBe(0)
  })

  it('导出折线箭头时使用带可定位 warning 的静态 SVG 后备，而不是失真的 bentArrow 图形', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const elbowNode = createShapeNode('elbow-arrow', {
      id: 'shape-elbow-static',
      name: '折线箭头',
      x: 50,
      y: 400,
      width: 400,
      height: 150,
    })
    elbowNode.lineGeometry = { kind: 'elbow', start: [0, 0.2], end: [1, 0.8], axis: 'horizontal', position: 0.6 }
    slide.scenes[0]!.layerItems = [sceneNodeToCourseLayerItem(elbowNode, 10)]

    const result = await buildCoursePptx({ project, assetFiles: {}, components: {} })
    const slideXml = decodePptxSlides(result.bytes)
    expect(slideXml).not.toContain('bentArrow')
    expect(slideXml).toContain('<p:pic>')
    // The only `<p:sp>` on this slide is the warning-note textbox; the elbow
    // itself must not additionally render as a native `<p:sp>` autoshape.
    expect(slideXml.match(/<p:sp>/g)).toHaveLength(1)
    expect(slideXml).toContain('shape-elbow-static')

    expect(result.warnings.some((message) => (
      message.includes('shape-elbow-static') && message.includes('pptx-static-elbow')
    ))).toBe(true)

    const archive = unzipSync(result.bytes)
    const elbowSvg = Object.entries(archive)
      .filter(([name]) => name.startsWith('ppt/media/') && name.endsWith('.svg'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .find((svg) => svg.includes('<polyline'))
    expect(elbowSvg, 'expected an embedded SVG media part with a polyline').toBeTruthy()
    expect(elbowSvg).toContain('points="0,0 240,0 240,90 400,90"')
    expect(elbowSvg).toContain('stroke="#2563eb"')
    expect(elbowSvg).toContain('stroke-width="4"')
  })
})
