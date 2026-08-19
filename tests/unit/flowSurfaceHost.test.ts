import { afterEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { TeacherControllerAction } from '@/shared/projectTypes'
import type { PublishedCourseV2Payload } from '@/shared/publishedCourseTypes'
import type { PublishedFlowSurface, PublishedNativeLayerItem } from '@/shared/publishedCourseTypes'
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
})

describe('FlowSurfaceHost playback controller and video', () => {
  it('positions the runtime overlay on the host, not as a window-covering fixed layer', async () => {
    const { host, container } = await mountHost()
    const overlay = container.querySelector<HTMLElement>('[data-testid="flow-runtime-overlay"]')!
    expect(overlay.style.position).toBe('absolute')
    expect(overlay.style.position).not.toBe('fixed')
    expect(overlay.style.top).toBe('0px')
    expect(overlay.style.right).toBe('0px')
    expect(overlay.style.bottom).toBe('0px')
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
    const video = container.querySelector<HTMLVideoElement>('[data-flow-overlay-item="flow-overlay-video"] video')
    expect(video).not.toBeNull()
    expect(video?.controls).toBe(true)
    expect(video?.getAttribute('src')).toBe('https://example.test/clip.mp4')
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

    const { host, container } = await mountHost(course)

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
    const overlay = container.querySelector<HTMLElement>('[data-testid="flow-runtime-overlay"]')!
    expect(overlay.style.pointerEvents).toBe('none')

    const frame = container.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')!
    expect(frame.style.pointerEvents).toBe('auto')

    const next = container.querySelector<HTMLButtonElement>('[data-controller-button-id="next"]')!
    next.click()
    await vi.waitFor(() => {
      expect(actions).toEqual([{ type: 'scene.next' }])
    })

    await host.destroy()
  })

  it('renders media block with wide layout matching wideContentWidth', async () => {
    const course = publishedCourse()
    const surf = course.surfaces[0] as PublishedFlowSurface
    surf.layout = { readingWidth: 760, wideContentWidth: 1120 }
    surf.blocks.push({
      id: 'media-wide',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'video',
      layout: 'wide',
      altText: '宽幅视频',
    })

    const { host, container } = await mountHost(course)
    const figure = container.querySelector<HTMLElement>('[data-flow-block-id="media-wide"]')!
    expect(figure).not.toBeNull()
    expect(figure.dataset.flowMediaLayout).toBe('wide')
    expect(figure.style.maxWidth).toBe(`${surf.layout.wideContentWidth}px`)

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
      id: 'media-wrap-right',
      type: 'media',
      assetId: 'clip',
      mediaKind: 'image',
      layout: 'content-width',
      wrap: 'right',
    })

    const { host, container } = await mountHost(course)
    const figLeft = container.querySelector<HTMLElement>('[data-flow-block-id="media-wrap-left"]')!
    expect(figLeft).not.toBeNull()
    expect(figLeft.style.float).toBe('left')
    expect(figLeft.style.margin).toBe('0px 16px 8px 0px')

    const figRight = container.querySelector<HTMLElement>('[data-flow-block-id="media-wrap-right"]')!
    expect(figRight).not.toBeNull()
    expect(figRight.style.float).toBe('right')
    expect(figRight.style.margin).toBe('0px 0px 8px 16px')

    await host.destroy()
  })

  it('follows paper scroll for paperSpace overlays while keeping controllers and viewport overlays fixed', async () => {
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
    surf.surfaceLayerItems.push({
      item: {
        layerItemId: 'overlay-paper-item',
        label: '跟滚浮层',
        kind: 'native',
        frame: { mode: 'absolute', x: 50, y: 300, width: 200, height: 100 },
        order: 10,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        paperSpace: 'paper',
        content: {
          nativeType: 'image',
          data: { assetId: 'clip' },
        },
      },
      visibility: { mode: 'all', locationIds: [] },
    })
    surf.surfaceLayerItems.push({
      item: {
        layerItemId: 'overlay-viewport-item',
        label: '固定浮层',
        kind: 'native',
        frame: { mode: 'absolute', x: 50, y: 300, width: 200, height: 100 },
        order: 11,
        visible: true,
        locked: false,
        rotation: 0,
        opacity: 1,
        hitPolicy: 'auto',
        content: {
          nativeType: 'image',
          data: { assetId: 'clip' },
        },
      },
      visibility: { mode: 'all', locationIds: [] },
    })

    const { host, container } = await mountHost(course)
    const article = container.querySelector<HTMLElement>('[data-testid="flow-runtime-article"]')!
    const paperOverlay = container.querySelector<HTMLElement>('[data-flow-overlay-item="overlay-paper-item"]')!
    const viewportOverlay = container.querySelector<HTMLElement>('[data-flow-overlay-item="overlay-viewport-item"]')!
    const controller = container.querySelector<HTMLElement>('[data-testid="flow-runtime-teacher-controller"]')!

    expect(paperOverlay).not.toBeNull()
    expect(paperOverlay.dataset.flowPaperSpace).toBe('paper')
    expect(paperOverlay.style.top).toBe('300px')
    expect(viewportOverlay.style.top).toBe('300px')
    expect(controller.style.top).toBe('640px')

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
    expect(viewportOverlay.style.top).toBe('300px')
    expect(controller.style.top).toBe('640px')

    await host.destroy()
  })
})
