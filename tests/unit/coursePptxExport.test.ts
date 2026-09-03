import { describe, expect, it } from 'vitest'
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
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { APP_COMPANY, APP_NAME } from '@/shared/constants'
import { createShapeNode, createTextNode } from '@/renderer/project/nativeNodeFactories'
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
      expect(source).not.toMatch(/\b(?:SceneNode|buildExportPayload|PlayerApp)\b/)
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
    expect(result.bytes.byteLength).toBeGreaterThan(0)
    expect(result.report.some((item) => (
      item.severity === 'error' && item.message.includes('缺少可离线引用')
    ))).toBe(true)
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

  it('rejects a retired V8-era export package instead of restoring the old PPTX builder', async () => {
    await expect(buildCoursePptx({
      project: { schemaVersion: 8, scenes: [] },
      assets: {},
      components: {},
    } as never)).rejects.toThrow(/Published Course V2|V9 发布源|旧版导出包/)
  })
})
