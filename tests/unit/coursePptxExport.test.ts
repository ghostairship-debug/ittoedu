import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import type { CourseProjectDocument } from '@/shared/courseProjectTypes'
import type { PublishedLayerItem } from '@/shared/publishedCourseTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  addCourseFlowPage,
  addCourseSlidePage,
  addCourseSpatialPage,
} from '@/renderer/course/courseLocationCommands'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import {
  buildCourseExportPageList,
  buildCoursePrintArtifacts,
} from '@/renderer/export/course/buildCoursePrintArtifacts'
import { buildCoursePptx } from '@/renderer/export/course/buildCoursePptx'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/createProject'

const NOW = '2026-08-17T12:00:00.000Z'
const ASSET_BYTES = new Uint8Array([1, 2, 3, 4])

function mixedPublishedFixture() {
  let project = createBlankCourseProject({ now: NOW, includeDefaultController: true })
  const flowAdded = addCourseFlowPage(project, {
    now: NOW,
    expectedRevision: project.revision,
    title: '讲义',
  })
  expect(flowAdded.ok).toBe(true)
  if (!flowAdded.ok) throw new Error(flowAdded.reason)
  project = flowAdded.project

  const spatialAdded = addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
    title: '空间',
  })
  expect(spatialAdded.ok).toBe(true)
  if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
  project = spatialAdded.project as CourseProjectDocument

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

function pureSlidePublishedFixture() {
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
  })
  const published = buildPublishedCourseV2Payload({
    project,
    assetFiles: {},
    components: {},
  })
  return { published, controllerId, globalTextId: globalText.layerItemId }
}

describe('buildCourseExportPageList', () => {
  it('derives Slide scene, Spatial camera-frame, and Flow print-plan pages from Published V2', () => {
    const { published } = mixedPublishedFixture()
    const pages = buildCourseExportPageList(published)
    expect(pages.some((page) => page.kind === 'slide-scene')).toBe(true)
    expect(pages.some((page) => page.kind === 'flow-document')).toBe(true)
    expect(pages.filter((page) => page.kind === 'spatial-frame').length).toBeGreaterThan(0)
    expect(pages.map((page) => page.kind)).not.toContain('global-layer')
  })
})

describe('buildCoursePptx', () => {
  it('returns PPTX bytes, excludes global HUD text, and keeps Spatial frames off 1280×720 crop', async () => {
    const { project, published } = mixedPublishedFixture()
    const globalBanner = project.globalLayerItems[0]?.item.layerItemId
    expect(globalBanner).toBeTruthy()

    const pages = buildCourseExportPageList(published)
    const spatialPage = pages.find((page) => page.kind === 'spatial-frame')
    expect(spatialPage).toBeTruthy()

    const result = await buildCoursePptx(published)
    expect(result.bytes.byteLength).toBeGreaterThan(100)
    expect(result.bytes[0]).toBe(0x50)
    expect(result.bytes[1]).toBe(0x4b)
    expect(result.slideCount).toBeGreaterThan(0)
    expect(result.report.some((item) => item.message.includes('全局图层'))).toBe(true)

    const archive = unzipSync(result.bytes)
    const slideXml = Object.entries(archive)
      .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .join('\n')
    expect(slideXml).not.toContain('全局')
    expect(slideXml).not.toContain(globalBanner!)
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
    expect(spatialSvg).toContain('data-spatial-viewport=')
  })

  it('composes visible pure-Slide globals while omitting the static-disabled controller', async () => {
    const { published, controllerId, globalTextId } = pureSlidePublishedFixture()
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
      },
      {
        item: runtime,
        visibility: { mode: 'include', locationIds: [published.startLocationId] },
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

    const archive = unzipSync(result.bytes)
    const slideXml = Object.entries(archive)
      .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .join('\n')
    expect(slideXml).toContain('全局可编辑页脚')
    expect(Object.entries(archive)
      .filter(([name]) => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
      .map(([, bytes]) => new TextDecoder().decode(bytes))
      .filter((xml) => xml.includes('全局可编辑页脚'))).toHaveLength(1)
    expect(slideXml).toContain(globalTextId)
    expect(slideXml).not.toContain(controllerId)
    expect(slideXml).toContain(component.layerItemId)
    expect(slideXml).toContain(runtime.layerItemId)
    expect(capturedIds).toEqual([component.layerItemId, runtime.layerItemId])
    expect(capturedLocationIds).toEqual([
      published.startLocationId,
      published.startLocationId,
    ])
    expect(result.report.some((item) => item.message.includes('默认不写入 PPTX'))).toBe(false)
  })

  it('reports missing asset bytes in Chinese without throwing', async () => {
    const { published } = mixedPublishedFixture()
    const broken = structuredClone(published)
    broken.assets['missing-slide-image'] = { mimeType: 'image/png', url: '' }

    const result = await buildCoursePptx(broken)
    expect(result.bytes.byteLength).toBeGreaterThan(0)
    expect(result.report.some((item) => (
      item.severity === 'error' && item.message.includes('缺少可离线引用')
    ))).toBe(true)
  })
})
