import { describe, expect, it, vi } from 'vitest'
import type { TeacherControllerAction } from '@/shared/projectTypes'
import {
  PUBLISHED_COURSE_FORMAT,
  PUBLISHED_COURSE_VERSION,
  type PublishedCourseV2Payload,
  type PublishedNativeLayerItem,
} from '@/shared/publishedCourseTypes'
import {
  SpatialSurfaceHost,
  type SpatialSurfaceHostOptions,
} from '@/player/surfaces/spatial/SpatialSurfaceHost'

const VIEWPORT = { width: 400, height: 240 }

function textStyle() {
  return {
    fontFamily: 'sans-serif',
    fontSize: 18,
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
    lineSpacing: 1.2,
    letterSpacing: 0,
    padding: 0,
    overflow: 'fixed' as const,
    backgroundColor: '#ffffff',
    backgroundOpacity: 0,
    cornerRadius: 0,
  }
}

function publishedImage(
  layerItemId: string,
  assetId: string,
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
      nativeType: 'image',
      data: {
        assetId,
        preserveAspectRatio: true,
        fit: 'contain',
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        cropX: 0.5,
        cropY: 0.5,
        flipX: false,
        flipY: false,
        cornerRadius: 0,
        feather: { amount: 0, mode: 'rectangle' },
        safeAreas: [],
      },
    },
  }
}

function publishedVideo(
  layerItemId: string,
  assetId: string,
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
      nativeType: 'video',
      data: {
        assetId,
        fit: 'contain',
        autoplay: false,
        loop: false,
        muted: false,
        volume: 1,
        playbackRate: 1,
        showControls: true,
        clickToToggle: true,
        startTime: 0,
        endTime: null,
        poster: { mode: 'video-frame', time: 0 },
        backgroundAudioMode: 'duck',
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
        showSceneProgress: true,
        collapsible: true,
        defaultCollapsed: false,
        buttons: [
          { id: 'prev', action: { type: 'scene.previous' }, label: '上一', visible: true },
          { id: 'next', action: { type: 'scene.next' }, label: '下一', visible: true },
          { id: 'go', action: { type: 'scene.go', sceneId: 'loc-detail' }, label: '跳转', visible: true },
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
      data: { text, runs: [], style: textStyle() },
    },
  }
}

function publishedCourse(): PublishedCourseV2Payload {
  const worldA = publishedText('world-a', '世界甲', { x: -80, y: -40, width: 120, height: 36 }, 0)
  const worldB = publishedText('world-b', '世界乙', { x: 240, y: 80, width: 120, height: 36 }, 1)
  return {
    format: PUBLISHED_COURSE_FORMAT,
    formatVersion: PUBLISHED_COURSE_VERSION,
    sourceSchemaVersion: 9,
    courseId: 'course-spatial',
    title: '空间课',
    assets: {},
    components: {},
    designTokens: {
      fonts: [{ id: 'body', label: '正文', fontFamily: 'sans-serif' }],
      colors: [{ id: 'text', label: '正文', color: '#172033' }],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: false, musicVolume: 0.3, fadeMs: 0 },
      },
    },
    playback: {
      controls: 'canvas',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    locations: [
      {
        id: 'loc-home',
        label: '全景',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'frame-home',
      },
      {
        id: 'loc-detail',
        label: '细节',
        kind: 'spatial-camera',
        surfaceId: 'surface-spatial',
        cameraFrameId: 'frame-detail',
      },
    ],
    startLocationId: 'loc-home',
    globalLayerItems: [
      {
        item: publishedText('global-hud', '全课 HUD', { x: 8, y: 8, width: 120, height: 28 }, 8),
        visibility: { mode: 'include', locationIds: ['loc-home'] },
      },
    ],
    globalInteractions: [],
    surfaces: [{
      id: 'surface-spatial',
      title: '知识地图',
      type: 'spatial-2d',
      surfaceLayerItems: [
        {
          item: publishedText('surface-note', '页面注记', { x: 16, y: 200, width: 80, height: 24 }, 2),
          visibility: { mode: 'exclude', locationIds: ['loc-detail'] },
        },
      ],
      world: {
        bounds: { mode: 'infinite' },
        layerItems: [worldA, worldB],
        paths: [{
          id: 'path-1',
          name: '探索路线',
          layerItemIds: ['world-a', 'world-b'],
          style: { color: '#112233', width: 3, dash: 'dashed' },
        }],
        relations: [{
          id: 'relation-1',
          sourceLayerItemId: 'world-a',
          targetLayerItemId: 'world-b',
          label: '从甲到乙',
          kind: 'arrow',
        }],
      },
      camera: {
        home: { x: 0, y: 0, zoom: 1 },
        frames: [
          { id: 'frame-home', name: '全景', x: 0, y: 0, zoom: 1 },
          { id: 'frame-detail', name: '细节', x: 300, y: 90, zoom: 2 },
        ],
      },
      semanticZoom: [],
    }],
  }
}

describe('SpatialSurfaceHost published V2 runtime', () => {
  it('reads world/camera/path/relation from Published Course V2 and does not fake a 1280×720 page', async () => {
    const course = publishedCourse()
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT)
    await host.mount(container)
    await host.activate()

    const root = container.querySelector<HTMLElement>('.spatial-surface')!
    const world = root.querySelector<SVGGElement>('[data-spatial-world]')!
    expect(root.style.width).toBe('400px')
    expect(root.style.height).toBe('240px')
    expect(root.dataset.worldBoundsMode).toBe('infinite')
    expect(root.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 400 240')
    expect(root.querySelector('[data-slide-page]')).toBeNull()
    expect(world.querySelector('[data-layer-item-id="world-a"]')).not.toBeNull()
    expect(world.querySelector('[data-spatial-path-id="path-1"]')).not.toBeNull()
    expect(world.querySelector('[data-spatial-relation-id="relation-1"]')).not.toBeNull()
    expect(host.publishedPaths().map((path) => path.id)).toEqual(['path-1'])
    expect(host.publishedRelations().map((relation) => relation.id)).toEqual(['relation-1'])
    expect(host.camera).toMatchObject({ x: 0, y: 0, zoom: 1, viewportWidth: 400, viewportHeight: 240 })

    await host.destroy()
  })

  it('starts at the published home camera, walks frames or the selected path, and never writes back', async () => {
    const course = publishedCourse()
    const cameraBefore = structuredClone(course.surfaces[0]!.type === 'spatial-2d'
      ? course.surfaces[0].camera
      : { home: { x: 0, y: 0, zoom: 1 }, frames: [] })
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT, {
      sessionCamera: { x: 999, y: 888, zoom: 8 },
    } as SpatialSurfaceHostOptions)
    await host.mount(container)
    await host.activate()

    expect(host.camera).toMatchObject({ x: 0, y: 0, zoom: 1 })
    const next = await host.goNext()
    expect(next.atBoundary).toBe(false)
    expect(host.camera).toMatchObject({ x: 300, y: 90, zoom: 2 })
    expect(host.locationId).toBe('loc-detail')

    const previous = await host.goPrevious()
    expect(previous.atBoundary).toBe(false)
    expect(host.camera).toMatchObject({ x: 0, y: 0, zoom: 1 })

    await host.setPlaybackPath('path-1')
    const alongPath = await host.goNext()
    expect(alongPath.atBoundary).toBe(false)
    expect(host.camera?.x).toBe(-80 + 60)
    expect(host.camera?.y).toBe(-40 + 18)
    expect(host.camera?.zoom).toBe(1)

    const spatial = course.surfaces[0]
    if (spatial?.type !== 'spatial-2d') throw new Error('expected spatial')
    expect(spatial.camera).toEqual(cameraBefore)
    expect(host.publishedCameraSnapshot()).toEqual(cameraBefore)
    expect(spatial.world.paths?.map((path) => path.layerItemIds)).toEqual([['world-a', 'world-b']])
    expect(spatial.world.relations?.[0]?.id).toBe('relation-1')

    await host.destroy()
  })

  it('applies location visibility.mode + locationIds and resets the runtime camera on leave/re-enter', async () => {
    const course = publishedCourse()
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT)
    await host.mount(container)
    await host.activate()

    const root = container.querySelector<HTMLElement>('.spatial-surface')!
    expect(root.querySelector('[data-layer-item-id="global-hud"]')).not.toBeNull()
    expect(root.querySelector('[data-layer-item-id="surface-note"]')).not.toBeNull()

    await host.setLocationId('loc-detail')
    expect(root.querySelector('[data-layer-item-id="global-hud"]')).toBeNull()
    expect(root.querySelector('[data-layer-item-id="surface-note"]')).toBeNull()
    expect(host.camera).toMatchObject({ x: 300, y: 90, zoom: 2 })

    await host.setLocationId('loc-home')
    expect(root.querySelector('[data-layer-item-id="global-hud"]')).not.toBeNull()
    expect(root.querySelector('[data-layer-item-id="surface-note"]')).not.toBeNull()

    await host.setRuntimeCamera({
      x: 180,
      y: -70,
      zoom: 3,
      viewportWidth: 400,
      viewportHeight: 240,
    })
    expect(host.camera).toMatchObject({ x: 180, y: -70, zoom: 3 })

    await host.suspend()
    expect(host.camera).toBeNull()
    await host.resume()
    expect(host.camera).toMatchObject({ x: 0, y: 0, zoom: 1 })
    expect(host.publishedCameraSnapshot().home).toEqual({ x: 0, y: 0, zoom: 1 })

    await host.destroy()
  })
})

describe('SpatialSurfaceHost playback camera gestures', () => {
  function dispatchPointer(target: EventTarget, type: string, clientX: number, clientY: number) {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      isPrimary: true,
    }))
  }

  it('session-pans from unoccupied canvas without writing published home', async () => {
    const course = publishedCourse()
    const spatial = course.surfaces[0]
    if (spatial?.type !== 'spatial-2d') throw new Error('expected spatial')
    const homeBefore = { ...spatial.camera.home }
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT)
    await host.mount(container)
    await host.activate()

    const root = container.querySelector<HTMLElement>('.spatial-surface')!
    dispatchPointer(root, 'pointerdown', 40, 40)
    dispatchPointer(root, 'pointermove', 80, 40)
    expect(host.camera).toMatchObject({ x: -40, y: 0, zoom: 1 })
    expect(spatial.camera.home).toEqual(homeBefore)
    expect(host.publishedCameraSnapshot().home).toEqual(homeBefore)

    await host.destroy()
  })

  it('does not steal pan from world video controls', async () => {
    const course = publishedCourse()
    const spatial = course.surfaces[0]
    if (spatial?.type !== 'spatial-2d') throw new Error('expected spatial')
    spatial.world.layerItems.push(
      publishedVideo('world-video', 'clip', { x: 120, y: 40, width: 160, height: 90 }, 5),
    )
    course.assets = {
      clip: { mimeType: 'video/mp4', url: 'https://example.test/clip.mp4' },
    }
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT)
    await host.mount(container)
    await host.activate()

    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    dispatchPointer(video!, 'pointerdown', 20, 20)
    dispatchPointer(video!, 'pointermove', 90, 20)
    expect(host.camera).toMatchObject({ x: 0, y: 0, zoom: 1 })

    await host.destroy()
  })
})

describe('SpatialSurfaceHost playback video and controller actions', () => {
  function playbackCourse(): PublishedCourseV2Payload {
    const course = publishedCourse()
    const spatial = course.surfaces[0]
    if (spatial?.type !== 'spatial-2d') throw new Error('expected spatial')
    spatial.world.layerItems.push(
      publishedImage('world-missing-image', 'missing', { x: 40, y: 40, width: 80, height: 60 }, 4),
      publishedVideo('world-video', 'clip', { x: 120, y: 40, width: 160, height: 90 }, 5),
    )
    course.globalLayerItems.push({
      item: teacherController('global-controller', { x: 24, y: 180, width: 220, height: 48 }, 9),
      visibility: { mode: 'all', locationIds: [] },
    })
    course.assets = {
      clip: { mimeType: 'video/mp4', url: 'https://example.test/clip.mp4' },
    }
    return course
  }

  it('renders world video from published assets without resolveAsset and outside foreignObject', async () => {
    const course = playbackCourse()
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT)
    await host.mount(container)
    await host.activate()

    const htmlLayer = container.querySelector('[data-testid="spatial-world-html"]')
    const video = container.querySelector('video')
    expect(htmlLayer).not.toBeNull()
    expect(video).not.toBeNull()
    expect(video?.controls).toBe(true)
    expect(video?.getAttribute('src')).toBe('https://example.test/clip.mp4')
    expect(video?.closest('foreignObject')).toBeNull()
    expect(htmlLayer?.contains(video)).toBe(true)
    expect(container.querySelector('[data-spatial-world] video')).toBeNull()

    const world = container.querySelector<SVGGElement>('[data-spatial-world]')!
    expect(world.querySelector('image[href=""]')).toBeNull()
    expect(world.querySelector('[data-layer-item-id="world-missing-image"] image')).toBeNull()

    await host.destroy()
  })

  it('renders world video and does not append an empty SVG image href', async () => {
    const course = playbackCourse()
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT, {
      resolveAsset: (assetId) => course.assets[assetId]?.url,
    })
    await host.mount(container)
    await host.activate()

    const world = container.querySelector<SVGGElement>('[data-spatial-world]')!
    const video = container.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.controls).toBe(true)
    expect(video?.getAttribute('src')).toBe('https://example.test/clip.mp4')
    expect(video?.closest('foreignObject')).toBeNull()
    expect(world.querySelector('video')).toBeNull()
    expect(world.querySelector('image[href=""]')).toBeNull()
    expect(world.querySelector('[data-layer-item-id="world-missing-image"] image')).toBeNull()

    await host.destroy()
  })

  it('forwards scene.next through executeTeacherControllerAction without local tour walk', async () => {
    const actions: TeacherControllerAction[] = []
    const course = playbackCourse()
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT, {
      executeTeacherControllerAction: (action) => {
        actions.push(action)
        return true
      },
    })
    await host.mount(container)
    await host.activate()

    const next = container.querySelector<HTMLButtonElement>('[data-controller-button-id="next"]')!
    next.click()
    await vi.waitFor(() => {
      expect(actions).toEqual([{ type: 'scene.next' }])
    })
    expect(host.locationId).toBe('loc-home')

    await host.destroy()
  })

  it('hides the teacher controller when playbackControls is none', async () => {
    const course = playbackCourse()
    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT, {
      playbackControls: 'none',
    })
    await host.mount(container)
    await host.activate()

    const controller = container.querySelector<HTMLElement>('[data-layer-item-id="global-controller"]')!
    expect(controller.hidden).toBe(true)

    await host.destroy()
  })

  it('mounts Component API 4 interactive components in world foreignObject and viewport HUD', async () => {
    function encodeUtf16(src: string) {
      const bytes = new Uint8Array(src.length * 2)
      for (let i = 0; i < src.length; i++) {
        const code = src.charCodeAt(i)
        bytes[i * 2] = code & 0xff
        bytes[i * 2 + 1] = code >>> 8
      }
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
      return { encoding: 'base64-utf16le' as const, data: btoa(binary) }
    }

    const course = playbackCourse()
    course.components['spatial-card@1.0.0'] = {
      id: 'spatial-card',
      name: '空间卡片',
      version: '1.0.0',
      contentSha256: 'sha-spatial-card',
      apiVersion: 4,
      scopes: ['scene', 'global'],
      renderMode: 'dom',
      code: encodeUtf16(`
        window.CoursewareComponent.define({
          id: 'spatial-card',
          runtimeApiVersion: 4,
          create(context) {
            const card = document.createElement('div')
            card.className = 'spatial-interactive-card'
            card.textContent = context.props.title || '卡片内容'
            context.dom.root.appendChild(card)
            return {
              destroy() { card.remove() },
            }
          },
        })
      `),
      assets: {},
    }

    const spatialSurf = course.surfaces[0] as import('@/shared/publishedCourseTypes').PublishedSpatialSurface
    spatialSurf.world.layerItems.push({
      layerItemId: 'world-comp-1',
      kind: 'component',
      component: { packageId: 'spatial-card', version: '1.0.0' },
      props: { title: '世界组件' },
      staticFallbackAssetId: 'world-comp-fallback',
      frame: { mode: 'absolute', x: 200, y: 150, width: 120, height: 60 },
      order: 10,
      visible: true,
      rotation: 0,
      opacity: 1,
      hitPolicy: 'auto',
      playbackInitialVisibility: 'inherit',
    })

    course.globalLayerItems.push({
      item: {
        layerItemId: 'hud-comp-1',
        kind: 'component',
        component: { packageId: 'spatial-card', version: '1.0.0' },
        props: { title: 'HUD组件' },
        staticFallbackAssetId: 'hud-comp-fallback',
        frame: { mode: 'absolute', x: 10, y: 10, width: 100, height: 40 },
        order: 20,
        visible: true,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        playbackInitialVisibility: 'inherit',
      },
      visibility: { mode: 'all', locationIds: [] },
    })

    const container = document.createElement('div')
    const host = SpatialSurfaceHost.fromPublishedCourse(course, VIEWPORT)
    await host.mount(container)
    expect(container.querySelector('.published-component-mount')).toBeNull()
    host.preparePublishedLocation('loc-detail', false)
    await host.activate()
    expect(container.querySelector('.published-component-mount')).toBeNull()
    await host.setLocationId('loc-detail')

    // World component in foreignObject
    const worldItem = container.querySelector('[data-layer-item-id="world-comp-1"]')
    expect(worldItem).not.toBeNull()
    const foreign = worldItem?.querySelector('foreignObject')
    expect(foreign).not.toBeNull()
    const worldMount = foreign?.querySelector('.published-component-mount')
    expect(worldMount).not.toBeNull()
    const worldCard = worldMount?.shadowRoot?.querySelector('.spatial-interactive-card')
    expect(worldCard?.textContent).toBe('世界组件')

    // HUD component in screenLayer
    const hudItem = container.querySelector('[data-layer-item-id="hud-comp-1"]')
    expect(hudItem).not.toBeNull()
    const hudMount = hudItem?.querySelector('.published-component-mount')
    expect(hudMount).not.toBeNull()
    const hudCard = hudMount?.shadowRoot?.querySelector('.spatial-interactive-card')
    expect(hudCard?.textContent).toBe('HUD组件')

    host.preparePublishedLocation('loc-detail', true)
    await host.setLocationId('loc-detail')
    const replayedWorldMount = container.querySelector(
      '[data-layer-item-id="world-comp-1"] .published-component-mount',
    )
    expect(replayedWorldMount).not.toBeNull()
    expect(replayedWorldMount).not.toBe(worldMount)

    await host.destroy()
  })
})
