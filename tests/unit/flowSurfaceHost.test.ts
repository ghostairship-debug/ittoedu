import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { TeacherControllerAction } from '@/shared/projectTypes'
import type { PublishedCourseV2Payload } from '@/shared/publishedCourseTypes'
import type { PublishedFlowSurface, PublishedNativeLayerItem } from '@/shared/publishedCourseTypes'
import {
  FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY,
  FLOW_MEDIA_INLINE_SIZE_REFERENCE,
  resolveFlowMediaLayoutInlineSize,
  resolveFlowMediaLayoutProjection,
} from '@/shared/flowMediaLayout'
import { FlowSurfaceHost, type FlowSurfaceHostOptions } from '@/player/surfaces/flow/FlowSurfaceHost'
import { isPublishedFlowSurface } from '@/player/surfaces/flow/flowModel'
import {
  FLOW_RUNTIME_TOC_CLOSED_ARIA_LABEL,
  FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX,
  FLOW_RUNTIME_TOC_OPEN_ARIA_LABEL,
  flowRuntimeTocAnchorId,
} from '@/player/surfaces/flow/flowRuntimeToc'
import {
  createPublishedCourseSession,
  publishedControllerNavigationTarget,
} from '@/player/surfaces/publishedDynamicHosts'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import {
  buildFlowPrintPlan,
  flowPrintPlanHasRuntimeToc,
  renderFlowPrintHtml,
} from '@/renderer/export/course/flowPrintPlan'

function overlayVideo(): PublishedNativeLayerItem {
  return {
    layerItemId: 'flow-overlay-video',
    kind: 'native',
    frame: { mode: 'absolute', x: 80, y: 80, width: 320, height: 180 },
    order: 12,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    content: {
      nativeType: 'video',
      data: {
        assetId: 'clip',
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

function overlayText(): PublishedNativeLayerItem {
  return {
    layerItemId: 'flow-overlay-text',
    kind: 'native',
    frame: { mode: 'absolute', x: 48, y: 48, width: 240, height: 72 },
    order: 10,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    content: {
      nativeType: 'text',
      data: {
        text: '可交互提示',
        runs: [],
        style: {
          fontFamily: 'sans-serif',
          fontSize: 20,
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

function teacherController(): PublishedNativeLayerItem {
  return {
    layerItemId: 'flow-controller',
    kind: 'native',
    frame: { mode: 'absolute', x: 24, y: 640, width: 520, height: 64 },
    order: 20,
    visible: true,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    content: {
      nativeType: 'teacher-controller',
      data: {
        title: '教师控制',
        showSceneProgress: true,
        compact: false,
        collapsible: true,
        defaultCollapsed: false,
        buttons: [
          { id: 'prev', label: '上一场景', visible: true, action: { type: 'scene.previous' } },
          { id: 'next', label: '下一场景', visible: true, action: { type: 'scene.next' } },
          { id: 'mute', label: '声音', visible: true, action: { type: 'audio.toggle-mute' } },
        ],
        style: {
          backgroundColor: '#ffffff',
          backgroundOpacity: 1,
          accentColor: '#2563eb',
          textColor: '#172033',
          cornerRadius: 8,
        },
        includeInStaticExports: false,
      },
    },
  }
}

function flowSurface(): PublishedFlowSurface {
  return {
    id: 'flow-host',
    type: 'flow',
    title: '运行讲义',
    layout: { readingWidth: 760, wideContentWidth: 1120 },
    blocks: [
      { id: 'h1', type: 'heading', level: 1, text: '阅读任务' },
      { id: 'p1', type: 'paragraph', text: '长文正文' },
      {
        id: 'list-1',
        type: 'list',
        ordered: false,
        items: [{ id: 'li-1', text: '证据一' }],
      },
      {
        id: 'table-1',
        type: 'table',
        caption: '工厂记录',
        columns: [{ id: 'col-a', header: '年份' }],
        rows: [{ id: 'row-1', cells: { 'col-a': { text: '1894' } } }],
      },
      {
        id: 'formula-1',
        type: 'formula',
        formulaId: 'fx',
        accessibleText: 'x',
        ast: { type: 'token', value: 'x' },
      },
      {
        id: 'media-1',
        type: 'media',
        assetId: 'missing-audio',
        mediaKind: 'audio',
        altText: '厂区录音',
        layout: 'content-width',
      },
      { id: 'h2', type: 'heading', level: 2, text: '材料 B' },
    ],
    surfaceLayerItems: [],
  }
}

function publishedCourse(): PublishedCourseV2Payload {
  const surface = flowSurface()
  return {
    format: 'h5course-published',
    formatVersion: 2,
    sourceSchemaVersion: 9,
    courseId: 'published-flow',
    title: '运行讲义课',
    assets: {
      clip: { mimeType: 'video/mp4', url: 'https://example.test/clip.mp4' },
    },
    components: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
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
      { id: 'loc-h1', label: '阅读任务', kind: 'flow-block', surfaceId: 'flow-host', blockId: 'h1' },
      { id: 'loc-h2', label: '材料 B', kind: 'flow-block', surfaceId: 'flow-host', blockId: 'h2' },
    ],
    startLocationId: 'loc-h1',
    globalLayerItems: [
      {
        item: teacherController(),
        visibility: { mode: 'all', locationIds: [] },
      },
      {
        item: overlayVideo(),
        visibility: { mode: 'all', locationIds: [] },
      },
    ],
    globalInteractions: [],
    surfaces: [surface],
  }
}

async function mountHost(course = publishedCourse(), options: FlowSurfaceHostOptions = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const host = new FlowSurfaceHost(course, options)
  await host.mount(container)
  await host.activate()
  return { host, container, course }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('FlowSurfaceHost runtime TOC', () => {
  it('starts collapsed against the viewport left edge and does not read author DOM', async () => {
    const { host, container, course } = await mountHost()
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-toc-toggle"]')!
    const drawer = container.querySelector<HTMLElement>('[data-testid="flow-runtime-toc-drawer"]')!
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    expect(host.tocOpen).toBe(false)
    expect(toggle.getAttribute('aria-label')).toBe(FLOW_RUNTIME_TOC_CLOSED_ARIA_LABEL)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.style.position).toBe('fixed')
    expect(toggle.style.left).toBe('0px')
    expect(toggle.querySelector('[data-flow-runtime-toc-chevron="right"]')).not.toBeNull()
    expect(drawer.style.position).toBe('fixed')
    expect(drawer.style.transform).toBe('translateX(-100%)')
    expect(article.style.marginLeft).toBe('0px')
    const publishedFlow = course.surfaces.find(isPublishedFlowSurface)
    expect(host.playbackDocument.surfaces[0]?.blocks).toEqual(publishedFlow?.blocks)
    article.innerHTML = '<p data-forged="true">forged from author DOM</p>'
    expect(host.playbackDocument.surfaces[0]?.blocks[1]).toMatchObject({ id: 'p1', type: 'paragraph' })
    await host.destroy()
  })

  it('opens a left inset drawer, jumps heading anchors, and keeps paragraphs out of TOC', async () => {
    const { host, container } = await mountHost()
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="flow-runtime-toc-toggle"]')!
    const drawer = container.querySelector<HTMLElement>('[data-testid="flow-runtime-toc-drawer"]')!
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    toggle.click()
    expect(host.tocOpen).toBe(true)
    expect(toggle.getAttribute('aria-label')).toBe(FLOW_RUNTIME_TOC_OPEN_ARIA_LABEL)
    expect(toggle.style.left).toBe(`${FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX}px`)
    expect(toggle.querySelector('[data-flow-runtime-toc-chevron="left"]')).not.toBeNull()
    expect(drawer.style.transform).toBe('translateX(0)')
    expect(article.style.marginLeft).toBe(`${FLOW_RUNTIME_TOC_DRAWER_WIDTH_PX}px`)

    const items = [...container.querySelectorAll<HTMLElement>('[data-flow-runtime-toc-item]')]
    expect(items.map((item) => item.dataset.flowTocBlockId).filter(Boolean)).toEqual(['h1', 'h2'])
    expect(container.querySelector('[data-flow-toc-block-id="p1"]')).toBeNull()
    expect(container.querySelector(`#${flowRuntimeTocAnchorId('h1')}`)?.tagName).toBe('H1')

    const heading = container.querySelector<HTMLElement>(`#${flowRuntimeTocAnchorId('h2')}`)!
    heading.scrollIntoView = vi.fn()
    items.find((item) => item.dataset.flowTocBlockId === 'h2')!.click()
    expect(heading.scrollIntoView).toHaveBeenCalled()

    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(host.tocOpen).toBe(false)
    expect(toggle.getAttribute('aria-label')).toBe(FLOW_RUNTIME_TOC_CLOSED_ARIA_LABEL)
    expect(article.style.marginLeft).toBe('0px')
    await host.destroy()
  })
})

describe('FlowSurfaceHost course session overlay', () => {
  it('mounts the shared teacher controller on the viewport overlay, not as a document footer', async () => {
    const { host, container } = await mountHost()
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    const overlay = container.querySelector<HTMLElement>('[data-testid="flow-runtime-overlay"]')!
    const controller = overlay.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')
    expect(controller).not.toBeNull()
    expect(article.contains(controller)).toBe(false)
    expect(article.querySelector('.slide-native-teacher-controller')).toBeNull()
    expect(overlay.querySelector('.slide-native-teacher-controller')).not.toBeNull()
    const progress = overlay.querySelector<HTMLElement>('.slide-teacher-controller-progress')
    expect(progress?.textContent).toContain('运行讲义')
    expect(progress?.textContent).not.toContain('语义长文覆盖图层')
    expect(host.surface.id).toBe('flow-host')
    await host.destroy()
  })

  it('uses physical Underlay, body, surface and Overlay roots independent of raw order', async () => {
    const course = publishedCourse()
    const surface = course.surfaces[0]
    if (!surface || surface.type !== 'flow') throw new Error('expected Flow surface')
    surface.backgroundColor = '#123456'
    const underlay = course.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'flow-overlay-video',
    )!
    underlay.plane = 'underlay'
    underlay.item.order = 9_000
    const controllerEntry = course.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'flow-controller',
    )!
    controllerEntry.plane = 'overlay'
    surface.surfaceLayerItems.push({
      item: {
        ...overlayText(),
        layerItemId: 'flow-local-cover',
        order: 2_000,
      },
      visibility: { mode: 'all', locationIds: [] },
    })
    surface.surfaceLayerItems.push({
      item: {
        ...overlayText(),
        layerItemId: 'flow-local-underlay',
        order: 1_999,
      },
      bodyPlane: 'underlay',
      visibility: { mode: 'all', locationIds: [] },
    })
    course.globalLayerItems.push({
      plane: 'overlay',
      item: {
        ...overlayText(),
        layerItemId: 'flow-global-after-controller',
        order: 3_000,
      },
      visibility: { mode: 'all', locationIds: [] },
    })
    const { host, container } = await mountHost(course)
    const local = container.querySelector<HTMLElement>(
      '[data-flow-overlay-item="flow-local-cover"]',
    )!
    const controller = container.querySelector<HTMLElement>(
      '[data-testid="flow-runtime-teacher-controller"]',
    )!
    const laterGlobal = container.querySelector<HTMLElement>(
      '[data-flow-overlay-item="flow-global-after-controller"]',
    )!
    const globalUnderlay = container.querySelector<HTMLElement>(
      '[data-flow-layer-plane="global-underlay"]',
    )!
    const surfaceUnderlay = container.querySelector<HTMLElement>(
      '[data-flow-layer-plane="surface-underlay"]',
    )!
    const surfaceOverlay = container.querySelector<HTMLElement>(
      '[data-flow-layer-plane="surface-overlay"]',
    )!
    const globalOverlay = container.querySelector<HTMLElement>(
      '[data-flow-layer-plane="global-overlay"]',
    )!
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    const underlayItem = container.querySelector<HTMLElement>(
      '[data-flow-overlay-item="flow-overlay-video"]',
    )!
    const localUnderlay = container.querySelector<HTMLElement>(
      '[data-flow-overlay-item="flow-local-underlay"]',
    )!

    expect([...host.rootElement!.children].slice(0, 5)).toEqual([
      globalUnderlay,
      surfaceUnderlay,
      article,
      surfaceOverlay,
      globalOverlay,
    ])
    expect(host.rootElement?.style.backgroundColor).toBe('rgb(18, 52, 86)')
    expect(article.style.background).toBe('transparent')
    expect(globalUnderlay.style.zIndex).toBe('0')
    expect(surfaceUnderlay.style.zIndex).toBe('1')
    expect(article.style.zIndex).toBe('2')
    expect(surfaceOverlay.style.zIndex).toBe('3')
    expect(globalOverlay.style.zIndex).toBe('4')
    expect(globalUnderlay.style.pointerEvents).toBe('none')
    expect(surfaceUnderlay.style.pointerEvents).toBe('none')
    expect(surfaceOverlay.style.pointerEvents).toBe('none')
    expect(globalOverlay.style.pointerEvents).toBe('none')
    expect(underlayItem.parentElement).toBe(globalUnderlay)
    expect(localUnderlay.parentElement).toBe(surfaceUnderlay)
    expect(local.parentElement).toBe(surfaceOverlay)
    expect(local.dataset.flowBodyPlane).toBe('overlay')
    expect(localUnderlay.dataset.flowBodyPlane).toBe('underlay')
    expect(controller.parentElement).toBe(globalOverlay)
    expect(laterGlobal.parentElement).toBe(globalOverlay)
    expect(Number(controller.style.zIndex)).toBeLessThan(Number(laterGlobal.style.zIndex))
    await host.destroy()
  })

  it('keeps the active interaction generation usable when a course update is rejected', async () => {
    const course = publishedCourse()
    course.globalLayerItems.unshift({
      item: overlayText(),
      visibility: { mode: 'all', locationIds: [] },
    })
    const { host, container } = await mountHost(course)
    const port = host.getPublishedInteractionSurfacePort()!
    const text = container.querySelector<HTMLElement>(
      '[data-flow-overlay-item="flow-overlay-text"]',
    )!
    let clicks = 0
    const unbind = port.bindNodeClick('flow-overlay-text', () => {
      clicks += 1
    })
    expect(unbind).not.toBeNull()
    text.click()
    expect(clicks).toBe(1)

    const invalid = structuredClone(course)
    invalid.surfaces = []
    await expect(host.updatePublishedCourse(invalid)).rejects.toThrow('课件没有 Flow 页面')

    expect(container.querySelector('[data-flow-overlay-item="flow-overlay-text"]')).toBe(text)
    text.click()
    expect(clicks).toBe(2)
    unbind?.()
    await host.destroy()
  })
})

describe('Flow print and DOCX helpers', () => {
  it('keeps document structure and never ships the runtime TOC drawer', async () => {
    const { host, container } = await mountHost()
    expect(container.querySelector('[data-testid="flow-runtime-toc-drawer"]')).not.toBeNull()

    const plan = buildFlowPrintPlan(host.surface)
    expect(plan.includesRuntimeToc).toBe(false)
    expect(flowPrintPlanHasRuntimeToc(plan)).toBe(false)
    expect(plan.nodes.map((node) => node.type)).toEqual([
      'document-title',
      'heading',
      'paragraph',
      'list',
      'table',
      'formula',
      'media',
      'heading',
    ])
    const html = renderFlowPrintHtml(plan)
    expect(html).toContain('阅读任务')
    expect(html).toContain('长文正文')
    expect(html).toContain('证据一')
    expect(html).toContain('1894')
    expect(html).toContain('公式说明：x')
    expect(html).toContain('[媒体后备：厂区录音]')
    expect(html).not.toContain('flow-runtime-toc')
    expect(html).not.toContain('打开目录')

    const docx = buildFlowDocx(host.surface)
    const files = unzipSync(docx.bytes)
    const documentXml = strFromU8(files['word/document.xml']!)
    expect(documentXml).toContain('阅读任务')
    expect(documentXml).toContain('长文正文')
    expect(documentXml).toContain('证据一')
    expect(documentXml).toContain('1894')
    expect(documentXml).toContain('公式说明：x')
    expect(documentXml).toContain('[媒体后备：厂区录音]')
    expect(documentXml).not.toContain('flow-runtime-toc')
    expect(documentXml).not.toContain('打开目录')
    expect(documentXml).not.toContain('收起目录')
    await host.destroy()
  })

  it('explicitly reports that reflowed print and DOCX omit page overlays', () => {
    const surface = flowSurface()
    surface.surfaceLayerItems.push({
      item: overlayText(),
      bodyPlane: 'underlay',
      visibility: { mode: 'all', locationIds: [] },
    })
    const plan = buildFlowPrintPlan(surface)
    expect(plan.includesFloatingLayers).toBe(false)
    expect(plan.omittedFloatingLayerCount).toBe(1)
    const html = renderFlowPrintHtml(plan)
    expect(html).toContain('data-flow-floating-layers="omitted"')
    expect(html).toContain('data-flow-omitted-floating-layer-count="1"')
    expect(html).not.toContain('可交互提示')
    const docx = buildFlowDocx(surface)
    expect(docx.warnings).toContain('DOCX 采用正文重排，已省略 1 个页面浮层。')
    expect(docx.report).toContainEqual({
      disposition: 'omitted',
      detail: 'DOCX 采用正文重排，已省略 1 个页面浮层。',
    })
  })
})

describe('FlowSurfaceHost playback controller and video', () => {
  it('positions every runtime plane on the host, not as a window-covering fixed layer', async () => {
    const { host, container } = await mountHost()
    const planes = [...container.querySelectorAll<HTMLElement>('[data-flow-layer-plane]')]
    expect(planes.map((plane) => plane.dataset.flowLayerPlane)).toEqual([
      'global-underlay',
      'surface-underlay',
      'surface-overlay',
      'global-overlay',
    ])
    for (const plane of planes) {
      expect(plane.style.position).toBe('absolute')
      expect(plane.style.position).not.toBe('fixed')
      expect(plane.style.top).toBe('0px')
      expect(plane.style.right).toBe('0px')
      expect(plane.style.bottom).toBe('0px')
    }
    await host.destroy()
  })

  it('writes the teacher-controller session offset back to the overlay frame', async () => {
    const { host, container } = await mountHost()
    const frame = container.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')!
    const nav = frame.querySelector<HTMLElement>('.slide-native-teacher-controller')!
    expect(frame.style.left).toBe('24px')
    expect(frame.style.top).toBe('640px')
    nav.focus()
    nav.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))
    expect(frame.style.left).toBe('32px')
    expect(frame.style.top).toBe('640px')
    await host.destroy()
  })

  it('renders a playable overlay video from the published asset URL', async () => {
    const { host, container } = await mountHost()
    const wrapper = container.querySelector<HTMLElement>('[data-flow-overlay-item="flow-overlay-video"]')!
    const video = wrapper.querySelector<HTMLVideoElement>('video')
    expect(video).not.toBeNull()
    expect(video?.controls).toBe(true)
    expect(video?.getAttribute('src')).toBe('https://example.test/clip.mp4')
    expect(wrapper.style.pointerEvents).toBe('auto')
    expect(wrapper.inert).toBe(false)
    expect(video?.style.pointerEvents).toBe('auto')
    await host.destroy()
  })

  it('keeps a pass-through overlay video inert through its media descendant', async () => {
    const course = publishedCourse()
    const videoEntry = course.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'flow-overlay-video',
    )
    if (!videoEntry) throw new Error('expected overlay video')
    videoEntry.item.hitPolicy = 'pass-through'
    const { host, container } = await mountHost(course)
    const wrapper = container.querySelector<HTMLElement>('[data-flow-overlay-item="flow-overlay-video"]')!
    const video = wrapper.querySelector<HTMLVideoElement>('video')!
    expect(wrapper.style.pointerEvents).toBe('none')
    expect(wrapper.inert).toBe(true)
    expect(video.style.pointerEvents).toBe('none')
    await host.destroy()
  })

  it('skips the teacher controller when playback.controls is none', async () => {
    const course = publishedCourse()
    course.playback.controls = 'none'
    const { host, container } = await mountHost(course)
    expect(container.querySelector('[data-testid="flow-runtime-teacher-controller"]')).toBeNull()
    expect(container.querySelector('.slide-native-teacher-controller')).toBeNull()
    expect(container.querySelector('video')).not.toBeNull()
    await host.destroy()
  })

  it('forwards scene.next through executeTeacherControllerAction', async () => {
    const actions: TeacherControllerAction[] = []
    const { host, container } = await mountHost(publishedCourse(), {
      executeTeacherControllerAction: (action) => {
        actions.push(action)
        return true
      },
    })
    const next = container.querySelector<HTMLButtonElement>('[data-controller-button-id="next"]')!
    next.click()
    await vi.waitFor(() => {
      expect(actions).toEqual([{ type: 'scene.next' }])
    })
    expect(host.locationId).toBe('loc-h1')
    await host.destroy()
  })

  it('navigates Mixed locations from the Flow controller in a published session', async () => {
    if (typeof HTMLElement.prototype.scrollIntoView !== 'function') {
      HTMLElement.prototype.scrollIntoView = function scrollIntoView() {}
    }
    const session = createPublishedCourseSession(publishedCourse())
    const container = document.createElement('div')
    document.body.appendChild(container)
    await session.mount(container)
    expect(session.navigator.current?.locationId).toBe('loc-h1')
    const next = container.querySelector<HTMLButtonElement>('[data-controller-button-id="next"]')!
    next.click()
    await vi.waitFor(() => {
      expect(session.navigator.current?.locationId).toBe('loc-h2')
    })
    await session.destroy()
  })

  it('maps scene.go onto a published location id', () => {
    const course = publishedCourse()
    expect(publishedControllerNavigationTarget(
      { type: 'scene.go', sceneId: 'loc-h2' },
      {
        locations: course.locations,
        currentLocationId: 'loc-h1',
        startLocationId: course.startLocationId,
      },
    )?.id).toBe('loc-h2')
    expect(publishedControllerNavigationTarget(
      { type: 'audio.toggle-mute' },
      {
        locations: course.locations,
        currentLocationId: 'loc-h1',
        startLocationId: course.startLocationId,
      },
    )).toBeNull()
  })

  it('mounts Component API 4 interactive components in paper block and overlay when package exists', async () => {
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

    const course = publishedCourse()
    course.components['flow-quiz@1.0.0'] = {
      id: 'flow-quiz',
      name: '测验',
      version: '1.0.0',
      contentSha256: 'sha-quiz',
      apiVersion: 4,
      scopes: ['scene', 'global'],
      renderMode: 'dom',
      code: encodeUtf16(`
        window.CoursewareComponent.define({
          id: 'flow-quiz',
          runtimeApiVersion: 4,
          create(context) {
            const btn = document.createElement('button')
            btn.className = 'quiz-submit'
            btn.textContent = context.props.question || '题目'
            context.dom.root.appendChild(btn)
            return {
              destroy() { btn.remove() },
            }
          },
        })
      `),
      assets: {},
    }

    const flowSurf = course.surfaces[0] as PublishedFlowSurface
    flowSurf.blocks.push({
      id: 'flow-comp-block',
      type: 'component',
      component: { packageId: 'flow-quiz', version: '1.0.0' },
      props: { question: '互动测验一' },
      staticFallbackAssetId: 'quiz-fallback',
    })

    flowSurf.surfaceLayerItems = [
      {
        item: {
          layerItemId: 'overlay-comp-1',
          kind: 'component',
          component: { packageId: 'flow-quiz', version: '1.0.0' },
          props: { question: '浮层测验' },
          staticFallbackAssetId: 'overlay-quiz-fallback',
          frame: { mode: 'absolute', x: 100, y: 100, width: 200, height: 80 },
          order: 15,
          visible: true,
          rotation: 0,
          opacity: 1,
          hitPolicy: 'auto',
          playbackInitialVisibility: 'inherit',
        },
        visibility: { mode: 'all', locationIds: [] },
      },
    ]

    const container = document.createElement('div')
    document.body.appendChild(container)
    const host = new FlowSurfaceHost(course)
    await host.mount(container)
    expect(container.querySelector('.published-component-mount')).toBeNull()
    host.preparePublishedLocation('loc-h2', false)
    await host.activate()
    expect(container.querySelector('.published-component-mount')).toBeNull()
    await host.setLocationId('loc-h2')

    // Paper block component
    const blockEl = container.querySelector('[data-flow-block-id="flow-comp-block"]')
    expect(blockEl).not.toBeNull()
    const blockMount = blockEl?.querySelector('.published-component-mount')
    expect(blockMount).not.toBeNull()
    const blockBtn = blockMount?.shadowRoot?.querySelector('.quiz-submit')
    expect(blockBtn?.textContent).toBe('互动测验一')

    // Overlay component
    const overlayEl = container.querySelector('[data-flow-overlay-item="overlay-comp-1"]')
    expect(overlayEl).not.toBeNull()
    const overlayMount = overlayEl?.querySelector('.published-component-mount')
    expect(overlayMount).not.toBeNull()
    const overlayBtn = overlayMount?.shadowRoot?.querySelector('.quiz-submit')
    expect(overlayBtn?.textContent).toBe('浮层测验')

    await host.destroy()
  })

  it('renders fallback image with resolved URL when component package is missing', async () => {
    const course = publishedCourse()
    course.assets['missing-fallback-img'] = {
      mimeType: 'image/png',
      url: 'https://example.test/missing-fallback.png',
    }
    const flowSurf = course.surfaces[0] as PublishedFlowSurface
    flowSurf.blocks.push({
      id: 'missing-comp-block',
      type: 'component',
      component: { packageId: 'uninstalled-pkg', version: '1.0.0' },
      props: {},
      staticFallbackAssetId: 'missing-fallback-img',
    })

    const { host, container } = await mountHost(course)
    const blockEl = container.querySelector('[data-flow-block-id="missing-comp-block"]')
    expect(blockEl).not.toBeNull()
    const img = blockEl?.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('https://example.test/missing-fallback.png')
    await host.destroy()
  })
})

describe('FlowSurfaceHost paper scroll and media layout', () => {
  it('supports wheel scrolling on long papers with pointerEvents auto and overflow auto', async () => {
    const course = publishedCourse()
    const surf = course.surfaces[0] as PublishedFlowSurface
    surf.blocks = [
      { id: 'h-top', type: 'heading', level: 1, text: '长文标题' },
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `p-${i + 1}`,
        type: 'paragraph' as const,
        text: `段落内容 ${i + 1}`,
      })),
    ]

    const { host, container } = await mountHost(course)
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    expect(article).not.toBeNull()
    expect(article.dataset.flowPaperScroll).toBe('true')
    expect(article.style.pointerEvents).toBe('auto')
    expect(article.style.overflow).toBe('auto')
    expect(article.style.overscrollBehavior).toBe('contain')

    let currentScrollTop = 0
    Object.defineProperty(article, 'clientHeight', { value: 720, configurable: true })
    Object.defineProperty(article, 'scrollHeight', { value: 4000, configurable: true })
    Object.defineProperty(article, 'scrollTop', {
      get: () => currentScrollTop,
      set: (val: number) => {
        currentScrollTop = val
      },
      configurable: true,
    })

    const wheelEvt = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true })
    article.dispatchEvent(wheelEvt)
    expect(article.scrollTop).toBeGreaterThan(0)
    expect(article.scrollTop).toBe(120)

    await host.destroy()
  })

  it('preserves teacher controller pointerEvents auto and forwards scene.next click', async () => {
    const actions: TeacherControllerAction[] = []
    const { host, container } = await mountHost(publishedCourse(), {
      executeTeacherControllerAction: (action) => {
        actions.push(action)
        return true
      },
    })
    const planes = [...container.querySelectorAll<HTMLElement>('[data-flow-layer-plane]')]
    expect(planes).toHaveLength(4)
    expect(planes.every((plane) => plane.style.pointerEvents === 'none')).toBe(true)

    const frame = container.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')!
    expect(frame.style.pointerEvents).toBe('auto')

    const next = container.querySelector<HTMLButtonElement>('[data-controller-button-id="next"]')!
    next.click()
    await vi.waitFor(() => {
      expect(actions).toEqual([{ type: 'scene.next' }])
    })

    await host.destroy()
  })

  it('uses the shared responsive mapping for all three Player media tiers', async () => {
    const course = publishedCourse()
    const surf = course.surfaces[0] as PublishedFlowSurface
    surf.layout = { readingWidth: 760, wideContentWidth: 1120 }
    surf.blocks.push({
      id: 'media-content',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      layout: 'content-width',
      altText: '正文视频',
    })
    surf.blocks.push({
      id: 'media-wide',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      layout: 'wide',
      altText: '宽幅视频',
    })
    surf.blocks.push({
      id: 'media-full',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      layout: 'full-width',
      altText: '最宽视频',
    })

    const { host, container } = await mountHost(course)
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    expect(article.style.containerType).toBe('inline-size')
    expect(article.dataset.flowMediaQueryRoot).toBe('true')

    const matrix = [700, 904, 1280].map((containerWidth) => [
      resolveFlowMediaLayoutInlineSize('content-width', surf.layout, containerWidth),
      resolveFlowMediaLayoutInlineSize('wide', surf.layout, containerWidth),
      resolveFlowMediaLayoutInlineSize('full-width', surf.layout, containerWidth),
    ])
    expect(matrix).toEqual([
      [572, 604, 636],
      [760, 808, 840],
      [760, 1120, 1216],
    ])
    for (const [content, wide, full] of matrix) {
      expect(content).toBeLessThan(wide!)
      expect(wide).toBeLessThan(full!)
    }
    const cases = [
      ['media-content', 'content-width'],
      ['media-wide', 'wide'],
      ['media-full', 'full-width'],
    ] as const
    for (const [blockId, layout] of cases) {
      const projection = resolveFlowMediaLayoutProjection(layout, surf.layout)
      const media = container.querySelector<HTMLElement>(`[data-flow-block-id="${blockId}"]`)!
      expect(media.classList.contains(projection.className)).toBe(true)
      expect(media.dataset.flowMediaWidthTier).toBe(projection.tier)
      expect(media.style.getPropertyValue(FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY)).toBe(projection.inlineSize)
      expect(media.style.width).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(media.style.maxWidth).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(media.style.inlineSize).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(media.style.maxInlineSize).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(media.style.left).toBe('50%')
      expect(media.style.insetInlineStart).toBe('')
      expect(media.style.transform).toBe('translateX(-50%)')
    }

    const figure = container.querySelector<HTMLElement>('[data-flow-block-id="media-wide"]')!
    expect(figure).not.toBeNull()
    expect(figure.dataset.flowMediaLayout).toBe('wide')
    expect(figure.style.maxWidth).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)

    const video = figure.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.style.maxWidth).toBe('100%')

    await host.destroy()
  })

  it('applies paragraph textAlign, lineHeight, and run fontFamily in try-run', async () => {
    const course = publishedCourse()
    const surf = course.surfaces[0] as PublishedFlowSurface
    surf.blocks = [{
      id: 'p-typed',
      type: 'paragraph',
      text: 'A',
      textAlign: 'center',
      lineSpacing: 8,
      runs: [{ start: 0, end: 1, style: { fontFamily: 'serif', fontSize: 20 } }],
    }]

    const { host, container } = await mountHost(course)
    const paragraph = container.querySelector<HTMLElement>('[data-flow-block-id="p-typed"]')!
    expect(paragraph.style.textAlign).toBe('center')
    expect(paragraph.style.lineHeight).toBe('2.1')
    const span = paragraph.querySelector('span')
    expect(span?.style.fontFamily).toBe('serif')
    expect(span?.style.fontSize).toBe('20px')
    await host.destroy()
  })

  it('renders media block with wrap left/right styling', async () => {
    const course = publishedCourse()
    const surf = course.surfaces[0] as PublishedFlowSurface
    surf.blocks.push({
      id: 'media-wrap-left',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'image',
      layout: 'content-width',
      wrap: 'left',
    })
    surf.blocks.push({
      id: 'p-after-left',
      type: 'paragraph',
      text: '绕排后续段落',
    })
    surf.blocks.push({
      id: 'media-wrap-right',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'image',
      layout: 'content-width',
      wrap: 'right',
    })
    surf.blocks.push({
      id: 'media-wrap-none',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'image',
      layout: 'content-width',
    })
    surf.blocks.push({
      id: 'comp-wrap-left',
      type: 'component',
      component: { packageId: 'test-pkg', version: '1.0.0' },
      props: {},
      staticFallbackAssetId: '',
      wrap: 'left',
    })

    const { host, container } = await mountHost(course)
    const figLeft = container.querySelector<HTMLElement>('[data-flow-block-id="media-wrap-left"]')!
    expect(figLeft).not.toBeNull()
    expect(figLeft.style.float).toBe('left')
    expect(figLeft.style.width).toBe('48%')
    expect(figLeft.style.inlineSize).toBe('48%')
    expect(figLeft.style.left).toBe('')
    expect(figLeft.style.insetInlineStart).toBe('')
    expect(figLeft.style.transform).toBe('')
    expect(figLeft.style.margin).toBe('0px 16px 8px 0px')

    const pAfter = container.querySelector<HTMLElement>('[data-flow-block-id="p-after-left"]')!
    expect(pAfter).not.toBeNull()
    expect(figLeft.parentElement).toBe(pAfter.parentElement)
    expect(figLeft.nextElementSibling).toBe(pAfter)

    const figRight = container.querySelector<HTMLElement>('[data-flow-block-id="media-wrap-right"]')!
    expect(figRight).not.toBeNull()
    expect(figRight.style.float).toBe('right')
    expect(figRight.style.width).toBe('48%')
    expect(figRight.style.inlineSize).toBe('48%')
    expect(figRight.style.left).toBe('')
    expect(figRight.style.insetInlineStart).toBe('')
    expect(figRight.style.transform).toBe('')
    expect(figRight.style.margin).toBe('0px 0px 8px 16px')

    const figNone = container.querySelector<HTMLElement>('[data-flow-block-id="media-wrap-none"]')!
    expect(figNone).not.toBeNull()
    expect(figNone.style.float).toBe('none')
    expect(figNone.style.width).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
    expect(figNone.style.left).toBe('50%')
    expect(figNone.style.insetInlineStart).toBe('')
    expect(figNone.style.transform).toBe('translateX(-50%)')

    const compLeft = container.querySelector<HTMLElement>('[data-flow-block-id="comp-wrap-left"]')!
    expect(compLeft).not.toBeNull()
    expect(compLeft.style.float).toBe('left')
    expect(compLeft.style.width).toBe('48%')
    expect(compLeft.style.margin).toBe('0px 16px 8px 0px')

    await host.destroy()
  })

  it('follows paper scroll for paperSpace overlays while keeping controllers and viewport overlays fixed', async () => {
    const course = publishedCourse()
    const surf = course.surfaces[0] as PublishedFlowSurface
    const globalPaperEntry = course.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'flow-overlay-video',
    )!
    globalPaperEntry.plane = 'underlay'
    globalPaperEntry.item.frame = {
      mode: 'absolute', x: 70, y: 350, width: 200, height: 100,
    }
    globalPaperEntry.item.paperSpace = 'paper'
    surf.blocks = [
      { id: 'h-top', type: 'heading', level: 1, text: '长文标题' },
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `p-${i + 1}`,
        type: 'paragraph' as const,
        text: `段落内容 ${i + 1}`,
      })),
    ]
    surf.surfaceLayerItems.push({
      item: {
        ...overlayVideo(),
        layerItemId: 'overlay-paper-item',
        frame: { mode: 'absolute', x: 50, y: 300, width: 200, height: 100 },
        order: 10,
        paperSpace: 'paper',
      },
      visibility: { mode: 'all', locationIds: [] },
    })
    surf.surfaceLayerItems.push({
      item: {
        ...overlayVideo(),
        layerItemId: 'overlay-viewport-item',
        frame: { mode: 'absolute', x: 50, y: 300, width: 200, height: 100 },
        order: 11,
      },
      visibility: { mode: 'all', locationIds: [] },
    })

    const { host, container } = await mountHost(course)
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    const paperOverlay = container.querySelector<HTMLElement>('[data-flow-overlay-item="overlay-paper-item"]')!
    const globalPaperOverlay = container.querySelector<HTMLElement>(
      '[data-flow-overlay-item="flow-overlay-video"]',
    )!
    const viewportOverlay = container.querySelector<HTMLElement>('[data-flow-overlay-item="overlay-viewport-item"]')!
    const controller = container.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')!

    expect(paperOverlay).not.toBeNull()
    expect(paperOverlay.dataset.flowPaperSpace).toBe('paper')
    expect(globalPaperOverlay.dataset.flowPaperSpace).toBe('paper')
    expect(globalPaperOverlay.parentElement).toHaveAttribute(
      'data-flow-layer-plane',
      'global-underlay',
    )
    expect(paperOverlay.style.left).toBe('50px')
    expect(globalPaperOverlay.style.left).toBe('70px')
    expect(paperOverlay.style.top).toBe('300px')
    expect(globalPaperOverlay.style.top).toBe('350px')
    expect(viewportOverlay.style.top).toBe('300px')
    expect(controller.style.top).toBe('640px')

    host.setTocOpen(true)
    expect(article.style.marginLeft).toBe('260px')
    expect(paperOverlay.style.left).toBe('310px')
    expect(globalPaperOverlay.style.left).toBe('330px')
    expect(viewportOverlay.style.left).toBe('50px')
    expect(controller.style.left).toBe('24px')

    let currentScrollTop = 0
    Object.defineProperty(article, 'clientHeight', { value: 720, configurable: true })
    Object.defineProperty(article, 'scrollHeight', { value: 4000, configurable: true })
    Object.defineProperty(article, 'scrollTop', {
      get: () => currentScrollTop,
      set: (val: number) => {
        currentScrollTop = val
      },
      configurable: true,
    })

    currentScrollTop = 100
    article.dispatchEvent(new Event('scroll'))

    expect(paperOverlay.style.top).toBe('200px')
    expect(globalPaperOverlay.style.top).toBe('250px')
    expect(viewportOverlay.style.top).toBe('300px')
    expect(controller.style.top).toBe('640px')

    host.setTocOpen(false)
    expect(article.style.marginLeft).toBe('0px')
    expect(paperOverlay.style.left).toBe('50px')
    expect(globalPaperOverlay.style.left).toBe('70px')
    expect(viewportOverlay.style.left).toBe('50px')
    expect(controller.style.left).toBe('24px')

    await host.destroy()
  })
})
