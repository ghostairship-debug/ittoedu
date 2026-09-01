import { describe, expect, it } from 'vitest'
import type {
  PublishedNativeLayerItem,
  PublishedSpatialSurface,
} from '@/shared/publishedCourseTypes'
import {
  SpatialSurfaceHost,
  createSpatialPlayerSessionSources,
} from '@/player/surfaces/spatial/SpatialSurfaceHost'
import type { PublishedSpatialRuntimeInput } from '@/player/surfaces/spatial/spatialModel'

const VIEWPORT = { width: 400, height: 240 }

function publishedText(
  layerItemId: string,
  text: string,
  frame: { x: number; y: number; width: number; height: number },
  order: number,
): PublishedNativeLayerItem {
  return {
    layerItemId,
    frame: { mode: 'absolute', ...frame },
    order,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'text',
      data: {
        text,
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 16,
          color: '#172033',
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          emphasis: false,
          highlightColor: null,
          align: 'left',
          verticalAlign: 'top',
          writingMode: 'horizontal',
          lineSpacing: 1.2,
          letterSpacing: 0,
          padding: 0,
          overflow: 'fixed',
          backgroundColor: '#ffffff',
          backgroundOpacity: 0,
          cornerRadius: 0,
        },
      },
    },
  }
}

function teacherController(
  layerItemId: string,
  frame: { x: number; y: number; width: number; height: number },
  order: number,
): PublishedNativeLayerItem {
  return {
    layerItemId,
    frame: { mode: 'absolute', ...frame },
    order,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    kind: 'native',
    content: {
      nativeType: 'teacher-controller',
      data: {
        title: '课堂导航',
        compact: false,
        showSceneProgress: false,
        collapsible: true,
        defaultCollapsed: false,
        buttons: [
          { id: 'prev', action: { type: 'scene.previous' }, label: '上一', visible: true },
          { id: 'next', action: { type: 'scene.next' }, label: '下一', visible: true },
          { id: 'mute', action: { type: 'audio.toggle-mute' }, label: '声音', visible: true },
        ],
        style: {
          backgroundColor: '#0b1720',
          backgroundOpacity: 0.9,
          accentColor: '#d9bf73',
          textColor: '#f3eee0',
          cornerRadius: 8,
        },
        includeInStaticExports: false,
      },
    },
  }
}

function spatialInput(): PublishedSpatialRuntimeInput {
  const surface: PublishedSpatialSurface = {
    id: 'surface-spatial',
    title: '知识地图',
    type: 'spatial-2d',
    surfaceLayerItems: [],
    world: {
      bounds: { mode: 'infinite' },
      layerItems: [
        publishedText('world-text', '世界文本', { x: -60, y: -20, width: 120, height: 40 }, 0),
      ],
      paths: [],
      relations: [],
    },
    camera: {
      home: { x: 0, y: 0, zoom: 1 },
      frames: [{ id: 'frame-home', name: '全景', x: 0, y: 0, zoom: 1 }],
    },
    semanticZoom: [],
  }
  return {
    surface,
    globalLayerItems: [
      {
        item: teacherController('global-controller', { x: 24, y: 180, width: 180, height: 48 }, 9),
        visibility: { mode: 'all', locationIds: [] },
        plane: 'underlay',
      },
      {
        item: publishedText('global-hud', '全课 HUD', { x: 12, y: 12, width: 96, height: 24 }, 8),
        visibility: { mode: 'all', locationIds: [] },
      },
    ],
    locations: [{
      id: 'loc-home',
      label: '全景',
      kind: 'spatial-camera',
      surfaceId: 'surface-spatial',
      cameraFrameId: 'frame-home',
    }],
    startLocationId: 'loc-home',
    playbackPathId: null,
  }
}

function geometry(element: HTMLElement) {
  return {
    left: element.style.left,
    top: element.style.top,
    width: element.style.width,
    height: element.style.height,
  }
}

describe('SpatialSurfaceHost viewport teacher controller', () => {
  it('keeps the real R3 controller on the viewport when world zoom and pan change', async () => {
    const container = document.createElement('div')
    const host = new SpatialSurfaceHost(spatialInput(), VIEWPORT)
    await host.mount(container)
    await host.activate()

    const root = container.querySelector<HTMLElement>('.spatial-surface')!
    const world = root.querySelector<SVGGElement>('[data-spatial-world]')!
    const underlay = root.querySelector<HTMLElement>('.spatial-global-underlay-layer')!
    const screen = root.querySelector<HTMLElement>('.spatial-screen-layer')!
    const controller = screen.querySelector<HTMLElement>('[data-layer-item-id="global-controller"]')!
    const hud = underlay.querySelector<HTMLElement>('[data-layer-item-id="global-hud"]')!
    const nav = controller.querySelector<HTMLElement>('.slide-native-teacher-controller')!

    expect(world.contains(controller)).toBe(false)
    expect(controller.parentElement).toBe(screen)
    expect(hud.parentElement).toBe(underlay)
    expect(controller.dataset.coordinateSpace).toBe('viewport')
    expect(hud.dataset.coordinateSpace).toBe('viewport')
    expect(controller.dataset.globalPlane).toBe('overlay')
    expect(hud.dataset.globalPlane).toBe('underlay')
    expect(Number(underlay.style.zIndex)).toBeLessThan(Number(screen.style.zIndex))
    expect(root.querySelector('svg')?.style.backgroundColor).toBe('transparent')
    expect(nav).not.toBeNull()
    expect(nav.querySelector('[data-controller-button-id="prev"]')?.textContent).toBe('上一')
    expect(nav.querySelector('[data-controller-button-id="next"]')?.textContent).toBe('下一')
    expect(controller.style.backgroundColor).not.toBe('rgb(254, 242, 242)')
    expect(getComputedStyle(controller).backgroundColor).not.toBe('rgb(254, 242, 242)')

    const controllerBefore = geometry(controller)
    const hudBefore = geometry(hud)
    expect(controllerBefore).toEqual({
      left: '24px',
      top: '180px',
      width: '180px',
      height: '48px',
    })

    for (const zoom of [0.5, 1, 2]) {
      await host.setRuntimeCamera({
        x: host.camera!.x,
        y: host.camera!.y,
        zoom,
        viewportWidth: VIEWPORT.width,
        viewportHeight: VIEWPORT.height,
      })
      expect(geometry(controller)).toEqual(controllerBefore)
      expect(geometry(hud)).toEqual(hudBefore)
      expect(world.getAttribute('transform')).toContain(`scale(${zoom})`)
    }

    await host.setRuntimeCamera({
      x: 130,
      y: -70,
      zoom: 2,
      viewportWidth: VIEWPORT.width,
      viewportHeight: VIEWPORT.height,
    })
    expect(geometry(controller)).toEqual(controllerBefore)
    expect(geometry(hud)).toEqual(hudBefore)
    expect(world.getAttribute('transform')).toContain('translate(-130 70)')

    const stage = host.getRenderedStageBounds()
    expect(stage).toMatchObject({ width: 400, height: 240 })
    expect(stage.width).not.toBe(180)
    expect(stage.height).not.toBe(48)

    await host.destroy()
  })

  it('exposes viewport audio/progress sources without inverse-scale chrome', () => {
    const sources = createSpatialPlayerSessionSources({
      courseProgressSource: {
        getLocations: () => [{ id: 'loc-home', name: '全景' }],
        getCurrentLocationId: () => 'loc-home',
      },
    })
    expect(sources.courseProgressSource?.getCurrentLocationId()).toBe('loc-home')
    expect(sources.audioChangeSource).toBeUndefined()
  })
})
