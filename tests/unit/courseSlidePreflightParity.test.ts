import { describe, expect, it } from 'vitest'
import {
  adaptCoursePptxProducerFindings,
  collectCourseProjectExportPreflight,
} from '@/renderer/export/exportPreflight'
import {
  collectCourseProjectSlideVisualPreflight,
  collectCourseProjectSlideVisualPreflightItems,
  collectCourseSlideLocationVisualPreflightItems,
  SLIDE_VISUAL_PREFLIGHT_CODES,
} from '@/renderer/export/slideVisualPreflight'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { composeCourseProjectLocation } from '@/shared/courseLayerComposition'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type {
  CourseProjectDocument,
  NativeLayerItem,
  SlideSurfaceDocument,
} from '@/shared/courseProjectTypes'

const NOW = new Date('2026-08-26T00:00:00.000Z')
const TARGET = 'pptx' as const
const emptyResources = { assetFiles: {}, components: {} }
const visualCodes = new Set<string>(SLIDE_VISUAL_PREFLIGHT_CODES)

function blankV9Project(): CourseProjectDocument {
  const project = createBlankCourseProject({
    id: 'slide-preflight-parity',
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
    idFactory: () => 'v9-id',
  })
  const surface = project.surfaces[0]
  const location = project.locations[0]
  if (!surface || surface.type !== 'slide' || !location || location.kind !== 'slide-scene') {
    throw new Error('expected blank Slide project')
  }
  surface.id = 'surface-parity'
  location.id = 'location-a'
  location.label = '位置 A'
  location.surfaceId = surface.id
  location.sceneId = 'scene-parity'
  project.startLocationId = location.id
  const scene = surface.scenes[0]!
  scene.id = 'scene-parity'
  scene.name = '对等场景'
  scene.backgroundColor = '#ffffff'
  scene.layerItems = []
  scene.presentation = {
    initialStateId: 'state-initial',
    states: [{
      id: 'state-initial',
      name: '初始状态',
      backgroundColor: '#000000',
      layerItemOverrides: {},
    }],
  }
  return project
}

function slideSurface(project: CourseProjectDocument): SlideSurfaceDocument {
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected Slide surface')
  return surface
}

function textItem(input: {
  id: string
  x: number
  order?: number
  color?: string
  backgroundColor?: string
  playbackInitialVisibility?: 'inherit' | 'hidden'
}): NativeLayerItem {
  const node = createTextNode({
    id: input.id,
    name: input.id,
    x: input.x,
    y: 40,
    width: 200,
    height: 80,
    text: '可读文字',
    style: {
      color: input.color ?? '#111111',
      backgroundColor: input.backgroundColor ?? '#ffffff',
      fontSize: 32,
    },
    playbackInitialVisibility: input.playbackInitialVisibility ?? 'inherit',
  })
  return sceneNodeToCourseLayerItem(node, input.order ?? 1) as NativeLayerItem
}

function visualFixture(): CourseProjectDocument {
  const course = blankV9Project()
  const scene = slideSurface(course).scenes[0]!
  scene.layerItems = [
    createTextNode({
      id: 'outside-a', name: 'outside-a', x: 1400, y: 40, width: 200, height: 80,
      text: '画布外 A', style: {
        fontSize: 32, color: '#111111', backgroundColor: '#ffffff', backgroundOpacity: 1,
      },
    }),
    createTextNode({
      id: 'outside-b', name: 'outside-b', x: 1500, y: 140, width: 200, height: 80,
      text: '画布外 B', style: {
        fontSize: 32, color: '#111111', backgroundColor: '#ffffff', backgroundOpacity: 1,
      },
    }),
    createTextNode({
      id: 'contrast', name: 'contrast', x: 40, y: 240, width: 240, height: 80,
      text: '背景对比', style: {
        fontSize: 32,
        color: '#ffffff',
        backgroundColor: '#ffffff',
        backgroundOpacity: 0,
      },
    }),
  ].map((node, index) => sceneNodeToCourseLayerItem(node, index + 1))
  scene.presentation!.states[0]!.layerItemOrder = ['outside-b', 'outside-a', 'contrast']
  return courseProjectDocumentSchema.parse(course)
}

function countCode(
  items: readonly { code: string }[],
  code: string,
): number {
  return items.filter((item) => item.code === code).length
}

describe('Slide export-preflight V9 behavior', () => {
  it('keeps the public V9 visual report item-for-item stable at fixed now', () => {
    const report = collectCourseProjectSlideVisualPreflight(visualFixture(), TARGET, NOW)

    expect(report).toEqual({
      reportVersion: 1,
      projectId: 'slide-preflight-parity',
      schemaVersion: 9,
      target: 'pptx',
      generatedAt: NOW.toISOString(),
      items: [
        {
          severity: 'error',
          code: 'node-fully-outside-canvas',
          message: '场景“对等场景”的基础画面中，节点“outside-a”完全位于 1280×720 画布之外。',
          target: 'pptx',
          sceneId: 'scene-parity',
          nodeId: 'outside-a',
        },
        {
          severity: 'error',
          code: 'node-fully-outside-canvas',
          message: '场景“对等场景”的基础画面中，节点“outside-b”完全位于 1280×720 画布之外。',
          target: 'pptx',
          sceneId: 'scene-parity',
          nodeId: 'outside-b',
        },
        {
          severity: 'error',
          code: 'node-fully-outside-canvas',
          message: '场景“对等场景”的状态“初始状态”中，节点“outside-b”完全位于 1280×720 画布之外。',
          target: 'pptx',
          sceneId: 'scene-parity',
          stateId: 'state-initial',
          nodeId: 'outside-b',
        },
        {
          severity: 'error',
          code: 'node-fully-outside-canvas',
          message: '场景“对等场景”的状态“初始状态”中，节点“outside-a”完全位于 1280×720 画布之外。',
          target: 'pptx',
          sceneId: 'scene-parity',
          stateId: 'state-initial',
          nodeId: 'outside-a',
        },
        {
          severity: 'warning',
          code: 'text-low-contrast',
          message: '场景“对等场景”的基础画面中，节点“contrast”的估算文字对比度仅 1.00:1；这是启发式提醒，请在真实投影环境人工确认。',
          target: 'pptx',
          sceneId: 'scene-parity',
          nodeId: 'contrast',
        },
      ],
      summary: { error: 4, warning: 1, info: 0, total: 5, canExport: false },
    })
  })

  it('reports two outside-canvas findings for a surface-shared item', () => {
    const project = blankV9Project()
    slideSurface(project).surfaceLayerItems = [{
      item: textItem({ id: 'surface-outside', x: 1400 }),
      visibility: { mode: 'all', locationIds: [] },
    }]
    const parsed = courseProjectDocumentSchema.parse(project)
    const v9Items = collectCourseProjectSlideVisualPreflightItems(parsed, TARGET)

    expect(countCode(v9Items, 'node-fully-outside-canvas')).toBe(2)
  })

  it('keeps a location-scoped global item in A only when two locations point at one scene', () => {
    const project = blankV9Project()
    project.locations.push({
      ...structuredClone(project.locations[0]!),
      id: 'location-b',
      label: '位置 B',
    })
    project.globalLayerItems = [{
      item: textItem({ id: 'global-a-only', x: 1400 }),
      visibility: { mode: 'include', locationIds: ['location-a'] },
    }]
    const parsed = courseProjectDocumentSchema.parse(project)
    const aItems = collectCourseSlideLocationVisualPreflightItems({
      project: parsed, locationId: 'location-a', target: TARGET,
    })
    const bItems = collectCourseSlideLocationVisualPreflightItems({
      project: parsed, locationId: 'location-b', target: TARGET,
    })
    const wholeItems = collectCourseProjectSlideVisualPreflightItems(parsed, TARGET)

    expect({
      locationA: countCode(aItems, 'node-fully-outside-canvas'),
      locationB: countCode(bItems, 'node-fully-outside-canvas'),
      deduplicatedWholeProject: countCode(wholeItems, 'node-fully-outside-canvas'),
    }).toEqual({ locationA: 2, locationB: 0, deduplicatedWholeProject: 2 })
  })

  it('checks base and an exact noninitial override without following the initial state', () => {
    const project = blankV9Project()
    const scene = slideSurface(project).scenes[0]!
    scene.layerItems = [textItem({ id: 'state-target', x: 40 })]
    scene.presentation!.states.push({
      id: 'state-noninitial',
      name: '非初始状态',
      layerItemOverrides: {
        'state-target': { frame: { x: 1400 } },
      },
    })
    const parsed = courseProjectDocumentSchema.parse(project)
    const items = collectCourseSlideLocationVisualPreflightItems({
      project: parsed, locationId: 'location-a', target: TARGET,
    }).filter(({ code }) => code === 'node-fully-outside-canvas')

    expect(items.map(({ stateId, nodeId }) => ({ stateId: stateId ?? null, nodeId })))
      .toEqual([{ stateId: 'state-noninitial', nodeId: 'state-target' }])
  })

  it('treats playback-initial hidden as mounted, with a +2 delta from hard hidden', () => {
    const project = blankV9Project()
    const scene = slideSurface(project).scenes[0]!
    scene.layerItems = [textItem({
      id: 'playback-hidden-outside',
      x: 1400,
      playbackInitialVisibility: 'hidden',
    })]
    const parsed = courseProjectDocumentSchema.parse(project)
    const composition = composeCourseProjectLocation({
      project: parsed, locationId: 'location-a', stateId: null,
    })
    const entry = composition.entries.find(
      ({ item }) => item.layerItemId === 'playback-hidden-outside',
    )
    const mountedCount = countCode(
      collectCourseProjectSlideVisualPreflightItems(parsed, TARGET),
      'node-fully-outside-canvas',
    )
    const hardHidden = structuredClone(parsed)
    const hiddenItem = slideSurface(hardHidden).scenes[0]!.layerItems[0]!
    hiddenItem.visible = false
    const hiddenCount = countCode(
      collectCourseProjectSlideVisualPreflightItems(
        courseProjectDocumentSchema.parse(hardHidden), TARGET,
      ),
      'node-fully-outside-canvas',
    )

    expect(entry).toMatchObject({ mounted: true, initiallyVisible: false })
    expect({ mountedCount, hiddenCount, delta: mountedCount - hiddenCount })
      .toEqual({ mountedCount: 2, hiddenCount: 0, delta: 2 })
  })

  it('inherits stable order and exact background only from shared composition', () => {
    const project = blankV9Project()
    const scene = slideSurface(project).scenes[0]!
    const b = textItem({ id: 'outside-b', x: 1500, order: 2 })
    const a = textItem({ id: 'outside-a', x: 1400, order: 1 })
    const contrast = textItem({
      id: 'contrast', x: 40, order: 3, color: '#ffffff', backgroundColor: '#ffffff',
    })
    scene.layerItems = [a, b, contrast]
    scene.presentation!.states[0]!.backgroundColor = '#000000'
    scene.presentation!.states[0]!.layerItemOverrides['outside-b'] = { order: 1 }
    const parsed = courseProjectDocumentSchema.parse(project)
    const baseComposition = composeCourseProjectLocation({
      project: parsed, locationId: 'location-a', stateId: null,
    })
    const namedComposition = composeCourseProjectLocation({
      project: parsed, locationId: 'location-a', stateId: 'state-initial',
    })
    const items = collectCourseSlideLocationVisualPreflightItems({
      project: parsed, locationId: 'location-a', target: TARGET,
    })
    const outsideIds = items
      .filter(({ code }) => code === 'node-fully-outside-canvas')
      .map(({ nodeId, stateId }) => `${stateId ?? 'base'}:${nodeId}`)
    const contrastFindings = items
      .filter(({ code, nodeId }) => code === 'text-low-contrast' && nodeId === 'contrast')
      .map(({ stateId }) => stateId ?? null)

    expect(baseComposition.entries.map(({ item }) => item.layerItemId))
      .toEqual(['outside-a', 'outside-b', 'contrast'])
    expect(namedComposition.background).toEqual({ color: '#000000', assetId: null })
    expect(outsideIds).toEqual([
      'base:outside-a',
      'base:outside-b',
      'state-initial:outside-a',
      'state-initial:outside-b',
    ])
    expect(contrastFindings).toEqual([null])
  })

  it('keeps the saved V9 report on catalog health plus the PPTX adapter contract', () => {
    const course = visualFixture()
    const report = collectCourseProjectExportPreflight(course, TARGET, emptyResources, NOW)
    expect(report).toMatchObject({
      reportVersion: 1,
      schemaVersion: 9,
      target: TARGET,
    })
    expect(report.items.filter(({ code }) => visualCodes.has(code)).length).toBeGreaterThan(0)
    expect(adaptCoursePptxProducerFindings(course, emptyResources, []).every((item) => (
      item.code === 'static-export-preflight'
      || item.code === 'static-export-warning'
      || item.code === 'static-export-info'
      || item.code === 'static-export-interactions-omitted'
      || item.code === 'static-export-audio-omitted'
      || item.code === 'static-export-video-poster'
      || item.code === 'static-export-controller-omitted'
    ))).toBe(true)
  })
})
