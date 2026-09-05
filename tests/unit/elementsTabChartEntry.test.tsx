import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ElementsTab } from '../../src/renderer/ui/ElementsTab'
import {
  selectSlideAuthoringDocument,
  useEditorStore,
} from '../../src/renderer/store/editorStore'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { COURSE_PROJECT_SCHEMA_VERSION } from '../../src/shared/courseProjectTypes'
import {
  createSlideAuthoringBackend,
  openSlideAuthoringSession,
} from '../../src/renderer/course/slideAuthoringBackend'

const NOW = '2026-09-05T00:00:00.000Z'

function v9EmptySlideFixture() {
  return courseProjectDocumentSchema.parse({
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'elements-tab-chart-test',
    revision: 1,
    title: 'Chart Entry Test',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-photo': {
        id: 'asset-photo',
        filename: 'photo.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'assets/photo.png',
        byteLength: 8,
        width: 800,
        height: 600,
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
    locations: [{
      id: 'location-scene-1',
      label: '场景 1',
      kind: 'slide-scene',
      surfaceId: 'surface-slide',
      sceneId: 'scene-1',
    }],
    startLocationId: 'location-scene-1',
    surfaces: [{
      id: 'surface-slide',
      title: '演示',
      type: 'slide',
      canvas: { width: 1280, height: 720 },
      surfaceLayerItems: [],
      scenes: [{
        id: 'scene-1',
        name: '场景 1',
        backgroundColor: '#ffffff',
        layerItems: [],
        interactions: [],
      }],
    }],
  })
}

function injectCandidate() {
  const backend = createSlideAuthoringBackend(
    openSlideAuthoringSession(v9EmptySlideFixture()),
  )
  useEditorStore.getState().injectV9SlideCandidateBackend(backend)
  return backend
}

describe('ElementsTab Chart Entry', () => {
  beforeEach(() => {
    injectCandidate()
    useEditorStore.setState({
      flowSession: null,
      spatialSession: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders single chart button in Slide scene, opens picker on click, and inserts selected chart', () => {
    render(<ElementsTab onAddImage={() => undefined} />)

    // Single add-chart button exists
    const chartBtn = screen.getByTestId('add-chart')
    expect(chartBtn).toBeInTheDocument()

    // Flat chart type buttons are not yet visible
    expect(screen.queryByTestId('add-chart-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chart-picker-panel')).not.toBeInTheDocument()

    // Click add-chart to open picker
    fireEvent.click(chartBtn)
    expect(screen.getByTestId('chart-picker-panel')).toBeInTheDocument()
    for (const type of ['bar', 'line', 'area', 'pie', 'donut']) {
      expect(screen.getByTestId(`add-chart-${type}`)).toBeInTheDocument()
    }

    // Click bar chart -> inserts node and closes picker
    fireEvent.click(screen.getByTestId('add-chart-bar'))
    expect(screen.queryByTestId('chart-picker-panel')).not.toBeInTheDocument()

    const doc = selectSlideAuthoringDocument(useEditorStore.getState())
    const slideSurface = doc?.surfaces[0]
    if (!slideSurface || slideSurface.type !== 'slide') throw new Error('expected slide surface')
    const scene = slideSurface.scenes[0]
    expect(scene?.layerItems.some((item) => (
      item.kind === 'native' && item.content.nativeType === 'chart' && item.content.data.chartType === 'bar'
    ))).toBe(true)
  })

  it('closes picker on Escape key without inserting a chart', () => {
    render(<ElementsTab onAddImage={() => undefined} />)

    const chartBtn = screen.getByTestId('add-chart')
    fireEvent.click(chartBtn)
    expect(screen.getByTestId('chart-picker-panel')).toBeInTheDocument()

    const docBefore = selectSlideAuthoringDocument(useEditorStore.getState())
    const slideSurfaceBefore = docBefore?.surfaces[0]
    if (!slideSurfaceBefore || slideSurfaceBefore.type !== 'slide') throw new Error('expected slide surface')
    const initialItemCount = slideSurfaceBefore.scenes[0]?.layerItems.length ?? 0

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('chart-picker-panel')).not.toBeInTheDocument()

    const docAfter = selectSlideAuthoringDocument(useEditorStore.getState())
    const slideSurfaceAfter = docAfter?.surfaces[0]
    if (!slideSurfaceAfter || slideSurfaceAfter.type !== 'slide') throw new Error('expected slide surface')
    const finalItemCount = slideSurfaceAfter.scenes[0]?.layerItems.length ?? 0
    expect(finalItemCount).toBe(initialItemCount)
  })

  it('renders only 1 disabled card explaining limitation in Flow surface', () => {
    useEditorStore.setState({
      flowSession: {
        selection: { authoringScope: 'surface' } as any,
        history: { past: [], present: v9EmptySlideFixture(), future: [] },
      },
    })

    render(<ElementsTab onAddImage={() => undefined} />)

    expect(screen.queryByTestId('add-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-chart-bar')).not.toBeInTheDocument()

    const disabledBtn = screen.getByTestId('add-chart-disabled')
    expect(disabledBtn).toBeInTheDocument()
    expect(disabledBtn).toBeDisabled()
    expect(disabledBtn).toHaveAttribute('title', '图表仅支持演示页场景')
  })

  it('displays matching chart type cards directly when searching', () => {
    render(<ElementsTab onAddImage={() => undefined} />)

    const searchInput = screen.getByLabelText('搜索元素内容')
    fireEvent.change(searchInput, { target: { value: '折线图' } })

    // Directly shows add-chart-line
    expect(screen.getByTestId('add-chart-line')).toBeInTheDocument()
    expect(screen.queryByTestId('add-chart-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-chart')).not.toBeInTheDocument()
  })
})
