import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import {
  FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY,
  FLOW_MEDIA_INLINE_SIZE_REFERENCE,
  resolveFlowMediaLayoutInlineSize,
  resolveFlowMediaLayoutProjection,
} from '@/shared/flowMediaLayout'
import {
  createImageNode,
  createTextNode,
  createVideoNode,
} from '@/renderer/project/createProject'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import { buildFlowEditorView } from '@/renderer/course/flowEditorView'
import {
  replaceFlowMediaBlockAsset,
  updateFlowEditorBlock,
} from '@/renderer/course/flowEditorCommands'
import {
  flowBlockTargetFromSelection,
  selectFlowEditorBlock,
} from '@/renderer/course/flowEditorSlice'
import { FlowWorkspace } from '@/renderer/ui/FlowWorkspace'

/**
 * Proves Flow EDIT mode paper and overlay image/video rendering from sidecar bytes.
 * Does not prove try-run playback, Workspace.tsx wiring, or FlowSurfaceHost.
 */
const NOW = '2026-08-18T14:31:00.000Z'
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
const MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 1, 2, 3])

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
let createObjectUrl: ReturnType<typeof vi.fn>
let revokeObjectUrl: ReturnType<typeof vi.fn>
let objectUrlSequence = 0

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
  } else {
    Reflect.deleteProperty(URL, 'createObjectURL')
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
  } else {
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})

beforeEach(() => {
  objectUrlSequence = 0
  createObjectUrl = vi.fn((blob: Blob) => `blob:flow-${blob.type}-${++objectUrlSequence}`)
  revokeObjectUrl = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-workspace-media',
    revision: 1,
    title: 'Flow 媒体稿纸',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'cover.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/cover.png',
        byteLength: PNG.byteLength,
        width: 640,
        height: 360,
      },
      'asset-video': {
        id: 'asset-video',
        filename: 'clip.mp4',
        mimeType: 'video/mp4',
        kind: 'video',
        path: 'media/clip.mp4',
        byteLength: MP4.byteLength,
        width: 1280,
        height: 720,
      },
      'asset-audio': {
        id: 'asset-audio',
        filename: 'voice.mp3',
        mimeType: 'audio/mpeg',
        kind: 'audio',
        path: 'media/voice.mp3',
        byteLength: 8,
      },
      'asset-image-2': {
        id: 'asset-image-2',
        filename: 'cover-b.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/cover-b.png',
        byteLength: PNG.byteLength,
        width: 640,
        height: 360,
      },
    },
    componentPackages: {},
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
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function createMediaFlowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '媒体稿纸' },
    {
      id: 'media-image',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '示意图',
      caption: '封面图',
      layout: 'content-width',
    },
    {
      id: 'media-video',
      type: 'media',
      assetId: 'asset-video',
      mediaKind: 'video',
      altText: '讲解步骤视频',
      caption: '讲解视频',
      layout: 'wide',
    },
    {
      id: 'media-image-full',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '全宽示意图',
      layout: 'full-width',
    },
    {
      id: 'media-audio',
      type: 'media',
      assetId: 'asset-audio',
      mediaKind: 'audio',
      caption: '旁白',
      layout: 'content-width',
    },
  ]
  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'h1',
      label: '媒体稿纸',
      kind: 'flow-block',
      surfaceId: 'flow',
      blockId: 'h1',
    }],
    startLocationId: 'h1',
    surfaces: [{
      id: 'flow',
      type: 'flow',
      title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [
        {
          item: sceneNodeToCourseLayerItem(createTextNode({
            id: 'overlay-text',
            name: '浮层文字',
            text: '注释',
          }), 10),
          visibility: { mode: 'all', locationIds: [] },
        },
        {
          item: sceneNodeToCourseLayerItem(createImageNode({
            id: 'overlay-image',
            name: '浮层图片',
            assetId: 'asset-image',
            width: 240,
            height: 135,
            x: 40,
            y: 40,
          }), 20),
          visibility: { mode: 'all', locationIds: [] },
        },
        {
          item: sceneNodeToCourseLayerItem(createVideoNode({
            id: 'overlay-video',
            name: '浮层视频',
            assetId: 'asset-video',
            width: 320,
            height: 180,
            x: 300,
            y: 80,
          }), 30),
          visibility: { mode: 'all', locationIds: [] },
        },
      ],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

const SIDECAR_FILES: Record<string, Uint8Array> = {
  'asset-image': PNG,
  'asset-video': MP4,
  'asset-audio': new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  'asset-image-2': PNG,
}

function renderMediaPaper(project = createMediaFlowProject()) {
  const view = buildFlowEditorView({ project, locationId: 'h1' })
  const result = render(
    <div style={{ width: 900, height: 640 }}>
      <FlowWorkspace
        project={project}
        view={view}
        selection={null}
        assetFiles={SIDECAR_FILES}
      />
    </div>,
  )
  return { ...result, project, view }
}

describe('FlowWorkspace edit media', () => {
  it('projects all three media tiers from the shared responsive mapping', () => {
    const widths = { readingWidth: 760, wideContentWidth: 1120 }
    const matrix = [700, 904, 1280].map((containerWidth) => [
      resolveFlowMediaLayoutInlineSize('content-width', widths, containerWidth),
      resolveFlowMediaLayoutInlineSize('wide', widths, containerWidth),
      resolveFlowMediaLayoutInlineSize('full-width', widths, containerWidth),
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

    renderMediaPaper()
    const root = screen.getByTestId('flow-workspace-scroll')
    expect(root.style.containerType).toBe('inline-size')
    expect(root).toHaveAttribute('data-flow-media-query-root', 'true')

    const cases = [
      ['media-image', 'content-width'],
      ['media-video', 'wide'],
      ['media-image-full', 'full-width'],
    ] as const
    for (const [blockId, layout] of cases) {
      const projection = resolveFlowMediaLayoutProjection(layout, widths)
      const figure = screen.getByTestId(`flow-block-${blockId}`).querySelector<HTMLElement>('figure')!
      expect(figure).toHaveClass(projection.className)
      expect(figure.dataset.flowMediaWidthTier).toBe(projection.tier)
      expect(figure.style.getPropertyValue(FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY)).toBe(projection.inlineSize)
      expect(figure.style.width).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(figure.style.maxWidth).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(figure.style.inlineSize).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(figure.style.maxInlineSize).toBe(FLOW_MEDIA_INLINE_SIZE_REFERENCE)
      expect(figure.style.left).toBe('50%')
      expect(figure.style.insetInlineStart).toBe('')
      expect(figure.style.transform).toBe('translateX(-50%)')
    }
  })

  it('fills paper image src from sidecar object URLs and keeps the block as document-block', () => {
    renderMediaPaper()
    const block = screen.getByTestId('flow-block-media-image')
    expect(block.getAttribute('data-flow-layer-kind')).toBe('document-block')
    const image = block.querySelector('img')
    expect(image).toBeTruthy()
    expect(image).toHaveAttribute('data-flow-asset-id', 'asset-image')
    expect(image).toHaveAttribute('src')
    expect(image?.getAttribute('src')).toMatch(/^blob:flow-image\/png-/)
    expect(image?.getAttribute('alt')).toBe('示意图')
    expect(createObjectUrl).toHaveBeenCalled()
  })

  it('renders paper video as a video element instead of a permanent placeholder label', () => {
    renderMediaPaper()
    const block = screen.getByTestId('flow-block-media-video')
    expect(block.getAttribute('data-flow-layer-kind')).toBe('document-block')
    expect(block.textContent).not.toContain('视频占位符')
    const video = block.querySelector('video')
    expect(video).toBeTruthy()
    expect(video).toHaveAttribute('data-flow-asset-id', 'asset-video')
    expect(video).toHaveAttribute('data-flow-media-kind', 'video')
    expect(video).toHaveAttribute('src')
    expect(video?.getAttribute('src')).toMatch(/^blob:flow-video\/mp4-/)
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('aria-label', '讲解步骤视频')
    expect(video).toHaveProperty('muted', true)
    expect(video).toHaveAttribute('playsinline')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(screen.getByTestId('flow-block-media-audio').textContent).toContain('音频占位符')
  })

  it('draws native image and video overlays instead of a label fallback', () => {
    renderMediaPaper()
    const imageCard = screen.getByTestId('flow-layer-card-overlay-image')
    const overlayImage = imageCard.querySelector('[data-flow-overlay-media="image"]')
    expect(overlayImage?.tagName).toBe('IMG')
    expect(overlayImage).toHaveAttribute('src')
    expect(overlayImage?.getAttribute('src')).toMatch(/^blob:flow-image\/png-/)
    expect(imageCard.textContent).not.toContain('浮层图片')

    const videoCard = screen.getByTestId('flow-layer-card-overlay-video')
    const overlayVideo = videoCard.querySelector('[data-flow-overlay-media="video"]')
    expect(overlayVideo?.tagName).toBe('VIDEO')
    expect(overlayVideo).toHaveAttribute('src')
    expect(overlayVideo?.getAttribute('src')).toMatch(/^blob:flow-video\/mp4-/)
    expect(videoCard.textContent).not.toContain('浮层视频')
    expect(videoCard.textContent).not.toContain('浮层')

    expect(screen.getByTestId('flow-layer-card-overlay-text').textContent).toContain('浮层文字')
  })

  it('keeps overlay pointer-events as layer none and card auto so media can still be selected', () => {
    renderMediaPaper()
    expect(screen.getByTestId('flow-authoring-layer-overlay')).toHaveStyle({ pointerEvents: 'none' })
    expect(screen.getByTestId('flow-layer-card-overlay-image')).toHaveStyle({ pointerEvents: 'auto' })
    expect(screen.getByTestId('flow-layer-card-overlay-video')).toHaveStyle({ pointerEvents: 'auto' })
    const overlayImage = screen.getByTestId('flow-layer-card-overlay-image').querySelector('img')
    expect(overlayImage).toHaveStyle({ pointerEvents: 'none' })
  })

  it('marks a selected paper image and writes alt, layout, and a same-kind replacement assetId', () => {
    const project = createMediaFlowProject()
    const selection = selectFlowEditorBlock(project, 'h1', 'media-image')
    const view = buildFlowEditorView({ project, locationId: 'h1' })
    const { rerender } = render(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={selection}
          assetFiles={SIDECAR_FILES}
        />
      </div>,
    )
    const selectedFigure = screen.getByTestId('flow-block-media-image').querySelector('figure')
    expect(selectedFigure).toHaveAttribute('data-flow-media-selected', 'true')
    expect(selectedFigure).toHaveAttribute('data-flow-media-layout', 'content-width')
    expect(screen.getByTestId('flow-block-media-video').querySelector('figure'))
      .not.toHaveAttribute('data-flow-media-selected')

    const target = flowBlockTargetFromSelection(project, selection)
    const updated = updateFlowEditorBlock(project, target, {
      altText: '新说明',
      caption: '新题注',
      layout: 'wide',
    })
    expect(updated.ok).toBe(true)
    const replaced = replaceFlowMediaBlockAsset(updated.nextDocument!, target, 'asset-image-2')
    expect(replaced.ok).toBe(true)
    const next = replaced.nextDocument!
    const nextView = buildFlowEditorView({ project: next, locationId: 'h1' })
    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={next}
          view={nextView}
          selection={selectFlowEditorBlock(next, 'h1', 'media-image')}
          assetFiles={SIDECAR_FILES}
        />
      </div>,
    )
    const image = screen.getByTestId('flow-block-media-image').querySelector('img')
    expect(image).toHaveAttribute('data-flow-asset-id', 'asset-image-2')
    expect(image).toHaveAttribute('alt', '新说明')
    expect(image).toHaveAttribute('src')
    expect(image?.getAttribute('src')).toMatch(/^blob:flow-image\/png-/)
    expect(screen.getByTestId('flow-block-media-image').querySelector('figure'))
      .toHaveAttribute('data-flow-media-layout', 'wide')
    expect(screen.getByTestId('flow-block-media-image').textContent).toContain('新题注')
    expect(screen.getByTestId('flow-block-media-image').getAttribute('data-flow-layer-kind'))
      .toBe('document-block')
  })
})
