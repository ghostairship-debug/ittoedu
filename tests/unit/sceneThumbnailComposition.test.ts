import { describe, expect, it } from 'vitest'
import type {
  NativeLayerItem,
  RuntimeLayerItem,
} from '@/shared/courseProjectTypes'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  buildSceneThumbnailComposition,
  hasEnabledRuntime,
  hasUnrepresentedRuntime,
} from '@/renderer/ui/sceneThumbnailComposition'

function textStyle() {
  return {
    fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
    fontSize: 24,
    color: '#172033',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    emphasis: false,
    highlightColor: null,
    align: 'left' as const,
    verticalAlign: 'top' as const,
    writingMode: 'horizontal' as const,
    lineSpacing: 1.3,
    letterSpacing: 0,
    padding: 4,
    overflow: 'fixed' as const,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
  }
}

function nativeText(
  layerItemId: string,
  order: number,
  extra: Partial<Pick<NativeLayerItem, 'frame' | 'opacity' | 'playbackInitialVisibility'>> = {},
): NativeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: extra.frame ?? { mode: 'absolute', x: 40, y: 40, width: 220, height: 80 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: extra.opacity ?? 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: extra.playbackInitialVisibility ?? 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: { text: layerItemId, runs: [], style: textStyle() },
    },
  }
}

function runtimeLayer(
  layerItemId: string,
  order: number,
  assetId: string | null,
  coverage: 'surface' | 'scene' = 'surface',
  enabled = true,
): RuntimeLayerItem {
  return {
    layerItemId,
    label: layerItemId,
    frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'surface',
    playbackInitialVisibility: 'inherit',
    kind: 'runtime',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled,
      renderMode: 'hybrid',
      source: 'CoursewareRuntime.define({runtimeApiVersion:2,create(){return{destroy(){}}}})',
      content: { values: {} },
      assets: {},
      ...(assetId
        ? { staticFallback: { assetId, coverage } }
        : {}),
    },
  }
}

function labels(
  entries: ReturnType<typeof buildSceneThumbnailComposition>,
): string[] {
  return entries.map((entry) => entry.kind === 'layer'
    ? `${entry.source}:layer:${entry.item.layerItemId}`
    : `${entry.source}:fallback:${entry.fallback.assetId}:${entry.fallback.coverage}`)
}

describe('scene thumbnail runtime composition', () => {
  it('matches Player order for global underlay and scene overlay fallbacks', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const locationId = project.startLocationId
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const scene = surface.scenes[0]!
    scene.layerItems = [
      nativeText('scene-node', 1),
      runtimeLayer('scene-overlay-runtime', 2, 'scene-overlay', 'surface'),
    ]
    project.globalLayerItems = [
      {
        item: nativeText('global-underlay-node', 1),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'underlay',
      },
      {
        item: runtimeLayer('global-underlay-runtime', 2, 'global-underlay', 'scene'),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'underlay',
      },
      {
        item: nativeText('global-overlay-node', 3),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'overlay',
      },
    ]

    expect(labels(buildSceneThumbnailComposition({
      project,
      locationId,
      stateId: null,
    }))).toEqual([
      'global:layer:global-underlay-node',
      'global:fallback:global-underlay:scene',
      'scene:layer:scene-node',
      'scene:fallback:scene-overlay:surface',
      'global:layer:global-overlay-node',
    ])
  })

  it('places scene underlay before scene nodes and global overlay last', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const locationId = project.startLocationId
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const scene = surface.scenes[0]!
    scene.layerItems = [
      runtimeLayer('scene-underlay-runtime', 1, 'scene-underlay', 'surface'),
      nativeText('scene-node', 2),
    ]
    project.globalLayerItems = [
      {
        item: nativeText('excluded-node', 1),
        visibility: { mode: 'include', locationIds: ['another-scene'] },
        plane: 'overlay',
      },
      {
        item: nativeText('global-overlay-node', 2),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'overlay',
      },
      {
        item: runtimeLayer('global-overlay-runtime', 3, 'global-overlay', 'surface'),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'overlay',
      },
    ]

    expect(labels(buildSceneThumbnailComposition({
      project,
      locationId,
      stateId: null,
    }))).toEqual([
      'scene:fallback:scene-underlay:surface',
      'scene:layer:scene-node',
      'global:layer:global-overlay-node',
      'global:fallback:global-overlay:surface',
    ])
  })

  it('only badges enabled runtimes that have no static representation', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const locationId = project.startLocationId
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const scene = surface.scenes[0]!

    scene.layerItems = [runtimeLayer('scene-runtime', 1, null)]
    expect(hasEnabledRuntime({ project, locationId, stateId: null })).toBe(true)
    expect(hasUnrepresentedRuntime({ project, locationId, stateId: null })).toBe(true)

    scene.layerItems = [runtimeLayer('scene-runtime', 1, 'fallback')]
    expect(hasUnrepresentedRuntime({ project, locationId, stateId: null })).toBe(false)

    scene.layerItems = [runtimeLayer('scene-runtime', 1, null, 'surface', false)]
    expect(hasEnabledRuntime({ project, locationId, stateId: null })).toBe(false)
    expect(hasUnrepresentedRuntime({ project, locationId, stateId: null })).toBe(false)

    project.globalLayerItems = [{
      item: runtimeLayer('global-runtime', 1, null),
      visibility: { mode: 'all', locationIds: [] },
      plane: 'overlay',
    }]
    expect(hasUnrepresentedRuntime({ project, locationId, stateId: null })).toBe(true)
  })

  it('keeps playback-hidden nodes at their authored stable frame for thumbnail drawing', () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const locationId = project.startLocationId
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'slide') throw new Error('expected slide')
    const node = nativeText('animated-title', 1, {
      frame: { mode: 'absolute', x: 320, y: 180, width: 480, height: 120 },
      opacity: 0.72,
      playbackInitialVisibility: 'hidden',
    })
    surface.scenes[0]!.layerItems = [node]

    const entry = buildSceneThumbnailComposition({
      project,
      locationId,
      stateId: null,
    })[0]
    expect(entry).toMatchObject({
      kind: 'layer',
      item: {
        layerItemId: node.layerItemId,
        frame: { x: 320, y: 180, width: 480, height: 120 },
        opacity: 0.72,
        playbackInitialVisibility: 'hidden',
      },
    })
  })
})
