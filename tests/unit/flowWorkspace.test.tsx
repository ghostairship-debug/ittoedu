import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, type ComponentProps } from 'react'
import { TextSelection } from 'prosemirror-state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as editorSession from '@/renderer/document/editorSession'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { captureGenerationFixture } from '../fixtures/generationSnapshot'
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
  resolveFlowMediaLayoutProjection,
} from '@/shared/flowMediaLayout'
import { createTextNode } from '@/renderer/project/nativeNodeFactories'
import { flowSurfaceIn, syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import {
  buildFlowEditorView,
  captureFlowEditorAuthoringTarget,
  FLOW_SESSIONLESS_ERROR,
} from '@/renderer/course/flowEditorView'
import { selectFlowEditorBlocks, selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import { FlowWorkspace as ProductFlowWorkspace } from '@/renderer/ui/FlowWorkspace'
import { FlowWorkspaceTestHarness as FlowWorkspace } from '../helpers/FlowWorkspaceTestHarness'
import { Workspace } from '@/renderer/ui/Workspace'
import { FlowLocationWorkspace, type FlowLocationWorkspaceProps } from '@/renderer/ui/workspaces/FlowLocationWorkspace'
import { FLOW_WORKSPACE_HEADER_HEIGHT } from '@/renderer/ui/FlowBlockContextToolbar'
import { PlaybackViewSession } from '@/player/playbackViewSession'
import { useEditorStore } from '@/renderer/store/editorStore'
import { authoringObservationDraftToken } from '@/renderer/authoring/generation/authoringObservation'
import type { FlowDocumentDraft } from '@/renderer/authoring/flowDocumentDraft'
import {
  extractFlowRichTextFromEditor,
  updateFlowTextDraft,
  type FlowFormulaDraft,
  type FlowTextEditSession,
} from '@/renderer/authoring/flowTextEdit'
import type { FlowCommandResult } from '@/renderer/course/flowEditorCommands'
import type { FlowEditorSelection } from '@/renderer/course/flowEditorSlice'



vi.mock('@/renderer/phaser/createEditorGame', () => ({
  createEditorGame: () => ({
    bridge: {},
    game: { scale: { refresh: () => undefined } },
    destroy: () => undefined,
  }),
}))

vi.mock('@/renderer/ui/flowLocationTryRun', () => ({
  mountFlowLocationTryRun: vi.fn(async () => ({ destroy: vi.fn() })),
}))

/**
 * Proves Flow paper hit-testing, in-place editing, context toolbar, and formula dialog.
 * Also proves the root Workspace sessionless dispatch; it does not cover
 * PropertiesTab, MediaTab, Player, or default open/save.
 */
const NOW = '2026-08-17T17:10:00.000Z'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useEditorStore.getState().createNewProject()
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-workspace',
    revision: 1,
    title: 'Flow 稿纸',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'cover.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/cover.png',
        byteLength: 1024,
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

function createFlowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '工业化让城市生活变得更好吗？' }] }},
    {
      id: 'p-body',
      type: 'paragraph',
      content: { inlines: [{"type":"text","text":"阅读","style":{"bold":true}},{"type":"text","text":"任务"}] },
    },
    {
      id: 'list-1',
      type: 'list',
      ordered: true,
      items: [{ id: 'item-1', content: { inlines: [{ type: 'text', text: '项目一' }] }}],
    },
    {
      id: 'table-1',
      type: 'table',
      caption: { inlines: [{ type: 'text', text: '材料' }] },
      columns: [{ id: 'column-a', header: { inlines: [{ type: 'text', text: '列 A' }] }}],
      rows: [{ id: 'row-1', cells: { 'column-a': { inlines: [{ type: 'text', text: '单元格' }] }} }],
    },
    {
      id: 'formula-1',
      type: 'formula',
      formulaId: 'f-formula-1',
      accessibleText: 'a + b',
      latex: "a+b",
    },
    {
      id: 'media-1',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '示意图',
      caption: { inlines: [{ type: 'text', text: '封面图' }] },
      layout: 'content-width',
    },
  ]
  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'h1',
      label: '工业化让城市生活变得更好吗？',
      kind: 'flow-block',
      surfaceId: 'flow',
      blockId: 'h1',
    }],
    startLocationId: 'h1',
    globalLayerItems: [
      {
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'global-underlay',
          name: '全局底图',
          text: '底图',
        }), 10_000),
        plane: 'underlay',
        visibility: { mode: 'all', locationIds: [] },
      },
      {
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'global-overlay',
          name: '全局前景',
          text: '前景',
        }), 10_001),
        plane: 'overlay',
        visibility: { mode: 'all', locationIds: [] },
      },
    ],
    surfaces: [{
      id: 'flow',
      type: 'flow',
      title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [{
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'overlay-text',
          name: '浮层文字',
          text: '浮层',
        }), 20),
        visibility: { mode: 'all', locationIds: [] },
      }, {
        item: sceneNodeToCourseLayerItem(createTextNode({
          id: 'underlay-text',
          name: '正文下方浮层',
          text: '正文下方',
        }), 21),
        bodyPlane: 'underlay',
        visibility: { mode: 'all', locationIds: [] },
      }],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

function renderPaper(project = createFlowProject(), selection: FlowEditorSelection | null = null) {
  const view = buildFlowEditorView({ project, locationId: 'h1' })
  const onProjectChange = vi.fn<(result: FlowCommandResult) => void>()
  const onSelectionChange = vi.fn<(next: FlowEditorSelection | null) => void>()
  const onTextEditChange = vi.fn()
  const result = render(
    <div style={{ width: 900, height: 640 }}>
      <FlowWorkspace
        project={project}
        view={view}
        selection={selection}
        onProjectChange={onProjectChange}
        onSelectionChange={onSelectionChange}
        onTextEditChange={onTextEditChange}
      />
    </div>,
  )
  return { ...result, project, view, onProjectChange, onSelectionChange, onTextEditChange }
}
describe('FlowWorkspace paper', () => {




  it('clears an existing overlay selection from outside paper without changing the document', () => {
    const project = createFlowProject()
    const { onProjectChange, onSelectionChange } = renderPaper(project, selectFlowOverlay(project, 'h1', ['overlay-text']))
    fireEvent.click(screen.getByTestId('flow-workspace-scroll'))
    expect(onSelectionChange.mock.calls.at(-1)?.[0]).toMatchObject({ focus: 'idle', selectedBlockIds: [], selectedOverlayIds: [] })
    expect(onProjectChange.mock.calls.filter(([result]) => result.historyEntry)).toHaveLength(0)
  })

  it('root Workspace keeps a missing Flow session in the Flow fail-loud shell', () => {
    useEditorStore.getState().createNewFlowProject()
    expect(useEditorStore.getState().courseAuthoringSession?.token.surfaceType).toBe('flow')
    useEditorStore.setState({ flowSession: null })

    render(
      <Workspace
        onAddImage={() => undefined}
        onAddVideo={() => undefined}
        onSelectImageAsset={async () => null}
      />,
    )

    expect(screen.getByTestId('flow-workspace-sessionless')).toHaveTextContent(
      FLOW_SESSIONLESS_ERROR,
    )
    expect(screen.queryByTestId('slide-workspace-sessionless')).not.toBeInTheDocument()
  })





  it('does not import legacy projectTypes or projectSchema', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../src/renderer/ui/FlowWorkspace.tsx'),
      'utf8',
    )
    expect(source).not.toMatch(/projectTypes/)
    expect(source).not.toMatch(/projectSchema/)
    expect(source).not.toMatch(/editorStore/)
    expect(source).not.toMatch(/useEditorStore/)
    expect(source).toMatch(/useFlowTextAuthoringController/)
    expect(source).toMatch(/FlowOverlayAuthoringLayer/)
  })

  it('fails loud without an active Flow location instead of falling back to a V8 project', () => {
    const project = createFlowProject()
    const view = {
      ...buildFlowEditorView({ project, locationId: 'h1' }),
      locationId: '',
      activeBlockId: '',
      activeLocation: {
        locationId: '',
        surfaceId: '',
        blockId: '',
        label: '',
      },
    }
    expect(() => render(
      <ProductFlowWorkspace
        view={view}
        sessionToken={{ locationId: 'h1', surfaceType: 'flow', revision: project.revision, generation: 1 }}
        assets={project.assets}
        selection={null}
        textEdit={null}
        commands={{ run: () => ({ ok: false, historyEntry: false }) }}
      />,
    )).toThrow(FLOW_SESSIONLESS_ERROR)
  })

  it('binds the authoring observation identity to the rendered document source draft', () => {
    const project = createFlowProject()
    const draft: FlowDocumentDraft = {
      surfaceId: 'flow', revision: project.revision, source: '# 尚未提交的有效正文\n', diagnostics: [], composing: false,
    }
    render(
      <ProductFlowWorkspace
        view={buildFlowEditorView({ project, locationId: 'h1' })}
        sessionToken={{ locationId: 'h1', surfaceType: 'flow', revision: project.revision, generation: 1 }}
        assets={project.assets}
        selection={null}
        documentDraft={draft}
        textEdit={null}
        commands={{ run: () => ({ ok: false, historyEntry: false }) }}
      />,
    )

    expect(screen.getByTestId('flow-workspace')).toHaveAttribute(
      'data-observation-draft-token',
      String(authoringObservationDraftToken(draft)),
    )
    expect(screen.getByRole('textbox', { name: '正文源文编辑' })).toHaveTextContent('尚未提交的有效正文')
  })

  it('paints idle paragraph runs instead of plain text', () => {
    renderPaper()
    const rich = screen.getByTestId('flow-block-p-body')
    expect(rich?.textContent).toBe('阅读任务')
    expect(rich?.innerHTML).toMatch(/font-weight:\s*(bold|700)/)
    expect(screen.getByRole('textbox', { name: '正文排版编辑' })).toHaveAttribute('contenteditable', 'true')
  })

  it('is a scrolling reading paper, not a 1280×720 slide stage', () => {
    renderPaper()
    const workspace = screen.getByTestId('flow-workspace')
    const paper = screen.getByTestId('flow-paper')
    const scroll = screen.getByTestId('flow-workspace-scroll')
    const underlay = screen.getByTestId('flow-authoring-global-underlay')
    const surfaceUnderlay = screen.getByTestId('flow-authoring-surface-underlay')
    const surfaceOverlay = screen.getByTestId('flow-authoring-surface-overlay')
    const overlay = screen.getByTestId('flow-authoring-layer-overlay')
    const selectionPlane = screen.getByTestId('flow-authoring-selection-plane')
    expect(workspace.getAttribute('data-flow-not-slide-stage')).toBe('true')
    expect(workspace.getAttribute('data-flow-project-id')).toBe('flow-workspace')
    expect(workspace.getAttribute('data-flow-location-id')).toBe('h1')
    expect(workspace.getAttribute('data-flow-surface-id')).toBe('flow')
    expect(workspace.getAttribute('data-flow-active-block-id')).toBe('h1')
    expect(screen.getByTestId('flow-block-p-body').getAttribute('data-flow-layer-kind')).toBe('document-block')
    expect(screen.getByTestId('flow-block-formula-1').getAttribute('data-flow-layer-kind')).toBe('document-block')
    expect(screen.getByTestId('flow-layer-card-overlay-text').getAttribute('data-flow-overlay-owner')).toBe('surface')
    expect(screen.getByTestId('flow-layer-card-overlay-text').getAttribute('data-flow-overlay-owner-key')).toBe('surface:flow')
    expect(screen.getByTestId('flow-layer-card-global-overlay').getAttribute('data-flow-overlay-owner')).toBe('global')
    expect(screen.getByTestId('flow-layer-card-global-underlay').getAttribute('data-flow-overlay-locked')).toBe('false')
    expect(paper.getAttribute('data-flow-reading-width')).toBe('760')
    expect(paper).toHaveStyle({ maxWidth: '760px', background: 'transparent' })
    expect(scroll).toHaveStyle({ overflow: 'auto', zIndex: '2' })
    expect(workspace).not.toHaveStyle({ width: '1280px' })
    expect(workspace).not.toHaveStyle({ height: '720px' })
    expect(underlay.parentElement).toBe(workspace)
    expect(surfaceUnderlay.parentElement).toBe(workspace)
    expect(surfaceOverlay.parentElement).toBe(workspace)
    expect(overlay.parentElement).toBe(workspace)
    expect(selectionPlane.parentElement).toBe(workspace)
    expect([...workspace.children].filter(child => child !== workspace.querySelector('.flow-document-format-host'))).toEqual([
      underlay,
      surfaceUnderlay,
      scroll,
      surfaceOverlay,
      overlay,
      selectionPlane,
    ])
    expect(underlay).toHaveStyle({ zIndex: '0', pointerEvents: 'none' })
    expect(surfaceUnderlay).toHaveStyle({ zIndex: '1', pointerEvents: 'none' })
    expect(surfaceOverlay).toHaveStyle({ zIndex: '3', pointerEvents: 'none' })
    expect(overlay).toHaveStyle({ zIndex: '4', pointerEvents: 'none' })
    expect(selectionPlane).toHaveStyle({ zIndex: '5', pointerEvents: 'none' })
    expect(screen.getByTestId('flow-layer-card-global-underlay').parentElement).toBe(underlay)
    expect(screen.getByTestId('flow-layer-card-overlay-text')).toBeTruthy()
    expect(screen.getByTestId('flow-layer-card-underlay-text').parentElement).toBe(surfaceUnderlay)
    expect(screen.getByTestId('flow-layer-card-overlay-text').parentElement).toBe(surfaceOverlay)
    expect(screen.getByTestId('flow-layer-card-global-overlay').parentElement).toBe(overlay)
    expect(overlay).toHaveStyle({
      width: '1280px',
      height: '720px',
    })
  })

  it('keeps an Underlay visual inert while exposing its selected chrome above every plane', () => {
    const project = createFlowProject()
    const selection = selectFlowOverlay(project, 'h1', ['global-underlay'], 'global')
    renderPaper(project, selection)

    const visual = screen.getByTestId('flow-layer-card-global-underlay')
    const chrome = screen.getByTestId('flow-layer-selection-global-underlay')
    expect(visual).toHaveStyle({ pointerEvents: 'none' })
    expect(visual).not.toHaveAttribute('role')
    expect(visual.querySelector('[data-handle]')).toBeNull()
    expect(chrome.parentElement).toBe(screen.getByTestId('flow-authoring-selection-plane'))
    expect(chrome).toHaveAttribute('role', 'button')
    expect(chrome.querySelector('[data-handle]')).not.toBeNull()
  })

  it('reveals selected offscreen overlays and restores the document without changing authored frames/history', () => {
    const project = createFlowProject()
    project.globalLayerItems.find(entry => entry.item.layerItemId === 'global-overlay')!.item.frame = { mode: 'absolute', x: 1100, y: 700, width: 200, height: 80 }
    const before = structuredClone(project)
    const selection = selectFlowOverlay(project, 'h1', ['global-overlay'], 'global')
    const { onProjectChange } = renderPaper(project, selection)
    expect(screen.getByTestId('flow-layer-card-global-overlay')).toHaveStyle({ left: '1064px', top: '624px' })
    expect(screen.getByTestId('flow-workspace-scroll')).toHaveStyle({ transform: 'translate(-36px, -76px)' })
    expect(onProjectChange).not.toHaveBeenCalled()
    expect(project).toEqual(before)
    fireEvent.click(screen.getByRole('button', { name: '回到文档原位' }))
    expect(screen.getByTestId('flow-layer-card-global-overlay')).toHaveStyle({ left: '1100px', top: '700px' })
    expect(screen.getByTestId('flow-workspace-scroll')).toHaveStyle({ transform: 'translate(0px, 0px)' })
    expect(onProjectChange).not.toHaveBeenCalled()
  })

  it('keeps the original pointer gesture alive when selecting an overlay rerenders its chrome', () => {
    const project = createFlowProject()
    const overlay = project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-overlay',
    )
    if (!overlay) throw new Error('expected global overlay')
    overlay.item.frame = { mode: 'absolute', x: 300, y: 200, width: 200, height: 80 }
    const { onProjectChange, onSelectionChange } = renderPaper(project)
    const plane = screen.getByTestId('flow-authoring-layer-overlay')
    vi.spyOn(plane, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1280,
      bottom: 720,
      width: 1280,
      height: 720,
      toJSON: () => ({}),
    })
    const visual = screen.getByTestId('flow-layer-card-global-overlay')
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(visual, {
      setPointerCapture,
      hasPointerCapture: () => true,
      releasePointerCapture,
    })

    fireEvent.pointerDown(visual, {
      button: 0,
      pointerId: 7,
      clientX: 350,
      clientY: 240,
    })
    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('flow-layer-card-global-overlay')).toBe(visual)
    expect(screen.getByTestId('flow-layer-selection-global-overlay')).toBeTruthy()
    expect(setPointerCapture).toHaveBeenCalledWith(7)

    fireEvent.pointerMove(visual, {
      pointerId: 7,
      clientX: 370,
      clientY: 250,
    })
    fireEvent.pointerUp(visual, {
      pointerId: 7,
      clientX: 370,
      clientY: 250,
    })

    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(onProjectChange).toHaveBeenCalledTimes(1)
    const result = onProjectChange.mock.calls[0]?.[0]
    expect(result).toMatchObject({ ok: true, historyEntry: true })
    const moved = result?.nextDocument?.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-overlay',
    )
    expect(moved?.item.frame).toMatchObject({ x: 320, y: 210, width: 200, height: 80 })
  })

  it('scrolls paper-space visuals in every physical plane while viewport visuals stay fixed', () => {
    const project = createFlowProject()
    const underlay = project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-underlay',
    )!
    underlay.item.paperSpace = 'paper'
    underlay.item.frame = { mode: 'absolute', x: 10, y: 300, width: 200, height: 80 }
    const overlay = project.globalLayerItems.find(
      (entry) => entry.item.layerItemId === 'global-overlay',
    )!
    overlay.item.frame = { mode: 'absolute', x: 20, y: 340, width: 200, height: 80 }
    const surface = project.surfaces[0]
    if (!surface || surface.type !== 'flow') throw new Error('expected Flow surface')
    const surfacePaper = surface.surfaceLayerItems[0]!
    surfacePaper.item.paperSpace = 'paper'
    surfacePaper.item.frame = { mode: 'absolute', x: 30, y: 320, width: 200, height: 80 }
    renderPaper(project)

    const underlayCard = screen.getByTestId('flow-layer-card-global-underlay')
    const surfaceCard = screen.getByTestId('flow-layer-card-overlay-text')
    const overlayCard = screen.getByTestId('flow-layer-card-global-overlay')
    expect(underlayCard).toHaveStyle({ top: '300px' })
    expect(surfaceCard).toHaveStyle({ top: '320px' })
    expect(overlayCard).toHaveStyle({ top: '340px' })

    const scroll = screen.getByTestId('flow-workspace-scroll')
    Object.defineProperty(scroll, 'scrollTop', { value: 100, configurable: true })
    fireEvent.scroll(scroll)
    expect(underlayCard).toHaveStyle({ top: '200px' })
    expect(surfaceCard).toHaveStyle({ top: '220px' })
    expect(overlayCard).toHaveStyle({ top: '340px' })
  })

























  it('applies the shared conflict-free width projection to media figures', async () => {
    const project = createFlowProject()
    const flowSurface = project.surfaces.find((entry) => entry.id === 'flow')
    if (flowSurface && flowSurface.type === 'flow') {
      flowSurface.blocks.push({
        id: 'media-wide',
        type: 'media',
        assetId: 'asset-image',
        mediaKind: 'image',
        altText: '示意图',
        caption: { inlines: [{ type: 'text', text: '宽版图' }] },
        layout: 'wide',
      })
    }
    renderPaper(project)
    const widths = { readingWidth: 760, wideContentWidth: 1120 }
    const cases = [
      ['media-1', 'content-width'],
      ['media-wide', 'wide'],
    ] as const
    for (const [blockId, layout] of cases) {
      const projection = resolveFlowMediaLayoutProjection(layout, widths)
      await waitFor(() => expect(screen.getByTestId(`flow-block-${blockId}`).closest<HTMLElement>('figure')).toBeTruthy())
      const figure = screen.getByTestId(`flow-block-${blockId}`).closest<HTMLElement>('figure')!
      expect(figure).toHaveAttribute('data-flow-media-layout', layout)
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







  it('paints idle paragraph textAlign and lineSpacing on the paper block', () => {
    const project = createFlowProject()
    const surface = project.surfaces.find((entry) => entry.type === 'flow')
    if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
    surface.blocks = surface.blocks.map((block) => (
      block.id === 'p-body' && block.type === 'paragraph'
        ? { ...block, textAlign: 'center', lineSpacing: 8 }
        : block
    ))
    renderPaper(project)
    const paragraph = screen.getByTestId('flow-block-p-body')
    expect(paragraph).toHaveStyle({ textAlign: 'center', lineHeight: '2.1' })
  })

  it('renders media block with wrap left/right styling in edit paper', () => {
    const project = createFlowProject()
    const surface = project.surfaces.find((entry) => entry.type === 'flow')
    if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
    surface.blocks = [
      {
        id: 'media-wrap',
        type: 'media',
        assetId: 'asset-image',
        mediaKind: 'image',
        layout: 'content-width',
        wrap: 'left',
      },
      {
        id: 'comp-wrap',
        type: 'component',
        component: { packageId: 'test-comp', version: '1.0.0' },
        props: {},
        staticFallbackAssetId: 'asset-image',
        wrap: 'right',
      },
      ...surface.blocks,
    ]
    renderPaper(project)
    const blockEl = screen.getByTestId('flow-block-media-wrap')
    expect(blockEl).toHaveStyle({ float: 'left', width: '48%', margin: '0px 16px 8px 0px' })

    const compEl = screen.getByTestId('flow-block-comp-wrap')
    expect(compEl).toHaveStyle({ float: 'right', width: '48%', margin: '0px 0px 8px 16px' })
  })
})

// ---------------------------------------------------------------------------
// 源文模式守卫的生命周期：折叠光标不等于离开源文模式
// ---------------------------------------------------------------------------
const SOURCE_SELECTION_GUARD = 'Flow 源文选区暂不支持 AI 局部修改，请切回排版选择内容。'

/** The real product shell: props come from the single Store, intents go back through it. */
function FlowWorkspaceStoreHarness() {
  const session = useEditorStore(state => state.flowSession)
  const authoringSession = useEditorStore(state => state.courseAuthoringSession)
  const textEdit = useEditorStore(state => state.flowTextEdit)
  if (!session || !authoringSession) return null
  const props: ComponentProps<typeof ProductFlowWorkspace> = {
    view: buildFlowEditorView({ project: session.history.present, locationId: session.selection.locationId }),
    sessionToken: authoringSession.token,
    assets: session.history.present.assets,
    selection: session.selection,
    textEdit,
    commands: { run: (target, intent) => useEditorStore.getState().runFlowAuthoringIntent(target, intent) },
  }
  return createElement(ProductFlowWorkspace, props)
}

/** The scope-aware Flow validation a selection-scope chat send really runs. */
function selectionScopeSend() {
  const state = useEditorStore.getState()
  const session = state.flowSession!, authoringSession = state.courseAuthoringSession!
  const projectDocument = session.history.present
  return captureGenerationFixture({
    document: projectDocument,
    sessionToken: { ...authoringSession.token, revision: projectDocument.revision },
    workspace: { version: 1, projectId: projectDocument.id, normalizedPath: '/flow.h5lesson' },
    projection: projectEffectiveLayers({ project: projectDocument, locationId: session.selection.locationId }),
    selectedIds: [...authoringSession.itemIds],
    flowSelection: session.selection,
    scope: 'selection',
    instruction: '把这段改一下',
    purpose: 'local-edit',
  })
}

/** `null` means the send went out; a string is the message the teacher would see instead. */
function sendRefusal(): string | null {
  try { selectionScopeSend(); return null } catch (error) { return (error as Error).message }
}

describe('Flow source-mode guard lifetime', () => {
  beforeEach(() => {
    useEditorStore.getState().createNewFlowProject()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useEditorStore.getState().createNewProject()
  })
  function mountAndSelectSourceText() {
    render(createElement(FlowWorkspaceStoreHarness))
    fireEvent.click(screen.getByRole('button', { name: '源文' }))
    const source = EditorView.findFromDOM(screen.getByLabelText('正文源文编辑'))!
    act(() => { source.dispatch({ selection: { anchor: 1, head: 5 } }) })
    return source
  }

  it('keeps the source guard when the caret is collapsed inside source mode', () => {
    const source = mountAndSelectSourceText()
    expect(sendRefusal()).toBe(SOURCE_SELECTION_GUARD)

    act(() => { source.dispatch({ selection: { anchor: 3, head: 3 } }) })

    // A collapsed caret retires the target, not the mode: the source editor is still on screen.
    expect(screen.getByLabelText('正文源文编辑')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '排版' })).toBeInTheDocument()
    const collapsed = useEditorStore.getState().flowSession!.selection
    expect(collapsed.documentSelectionIssue).toBe(SOURCE_SELECTION_GUARD)
    expect(collapsed.focus).toBe('text')
    expect(collapsed.selectedBlockIds).toHaveLength(1)
    // The guard keeps the selection as the send target, so the chat panel cannot silently widen
    // the request to the page (CourseChatPanel.tsx:63 reads these item ids for its automatic scope).
    expect(useEditorStore.getState().courseAuthoringSession!.itemIds).toEqual([...collapsed.selectedBlockIds])
    expect(sendRefusal()).toBe(SOURCE_SELECTION_GUARD)
  })

  it('retires the source guard once the editor really returns to layout', () => {
    const source = mountAndSelectSourceText()
    act(() => { source.dispatch({ selection: { anchor: 3, head: 3 } }) })
    fireEvent.click(screen.getByRole('button', { name: '排版' }))

    expect(screen.queryByLabelText('正文源文编辑')).not.toBeInTheDocument()
    const returned = useEditorStore.getState().flowSession!.selection
    expect(returned.documentSelectionIssue).toBeUndefined()
    expect(returned).toMatchObject({ focus: 'idle', selectedBlockIds: [], textRange: null })
    expect(sendRefusal()).toBeNull()
  })

  it('retires the source guard when a Flow history undo bumps the generation and remounts the editor', () => {
    // 先在排版态做一次真实 Flow 正文编辑：撤销需要一条真实历史，而这次编辑必须发生在
    // 进入源文模式之前——否则 revision 变化会让当前编辑器发布 null 目标，守卫会被提前
    // 退休，就测不到「generation 递增导致重挂载」这条路径了。
    const opened = useEditorStore.getState().flowSession!
    const openedAuthoring = useEditorStore.getState().courseAuthoringSession!
    const blocks = structuredClone(flowSurfaceIn(opened.history.present, opened.selection.surfaceId).blocks)
    const paragraph = blocks.find(block => block.type === 'paragraph')
    if (paragraph?.type !== 'paragraph') throw new Error('expected paragraph')
    paragraph.content = { inlines: [{ type: 'text', text: '撤销前的一稿' }] }
    act(() => {
      const receipt = useEditorStore.getState().runFlowAuthoringIntent(
        captureFlowEditorAuthoringTarget({
          view: buildFlowEditorView({ project: opened.history.present, locationId: opened.selection.locationId }),
          sessionToken: openedAuthoring.token,
          target: { kind: 'surface' },
        }),
        { kind: 'replace-document-content', blocks, historyGroup: 'body-input' },
      )
      expect(receipt.ok, receipt.reason).toBe(true)
    })
    expect(useEditorStore.getState().flowSession!.history.past.length).toBe(opened.history.past.length + 1)

    const source = mountAndSelectSourceText()
    act(() => { source.dispatch({ selection: { anchor: 3, head: 3 } }) })
    expect(useEditorStore.getState().flowSession!.selection.documentSelectionIssue).toBe(SOURCE_SELECTION_GUARD)

    // 源文编辑器里的 Ctrl+Z 走的就是这条真实路径：document-history 撤销带上 sidecarDirection，
    // courseSessionAfterSurfaceHistory 因此把 token.generation 加一。
    const generation = useEditorStore.getState().courseAuthoringSession!.token.generation
    act(() => {
      const state = useEditorStore.getState(); const live = state.flowSession!
      state.runFlowAuthoringIntent(
        captureFlowEditorAuthoringTarget({
          view: buildFlowEditorView({ project: live.history.present, locationId: live.selection.locationId }),
          sessionToken: state.courseAuthoringSession!.token,
          target: { kind: 'surface' },
        }),
        { kind: 'document-history', direction: 'undo' },
      )
    })

    // 编辑器由 `key` 里的 generation 决定，generation 递增后 React 直接重建它；重建过程不会
    // 再调用 onContextualTargetChange（新实例的 contextualTargetRef 是空的），所以只有依赖
    // 数组里的 generation 能让退休副作用重跑。少了它，守卫就会留在一个已经不存在的源文
    // 视图上，之后每次选区发送都被这句「请切回排版」拒掉。
    expect(useEditorStore.getState().courseAuthoringSession!.token.generation).toBe(generation + 1)
    // 实测结论：重挂载后的编辑器回到排版模式（源文 DOM 消失，切换按钮重新显示「源文」），
    // 所以这里的守卫该退；如果哪天它带着 sourceDraft 重挂载回源文模式，守卫留在原处才是对的，
    // 那时这条断言会失败，必须连同上面的理由一起改写。
    expect(screen.queryByLabelText('正文源文编辑')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '源文' })).toBeInTheDocument()
    expect(useEditorStore.getState().flowSession!.selection.documentSelectionIssue).toBeUndefined()
    expect(sendRefusal()).toBeNull()
  })

  it('freezes a fresh precise layout selection made after returning from source mode', () => {
    const factory = vi.spyOn(editorSession, 'createLayoutEditor')
    const source = mountAndSelectSourceText()
    act(() => { source.dispatch({ selection: { anchor: 3, head: 3 } }) })
    fireEvent.click(screen.getByRole('button', { name: '排版' }))
    const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
    const doc = editor.view.state.doc
    let from = -1
    doc.descendants((node, pos) => { if (from < 0 && node.isText && (node.text ?? '').length > 2) from = pos })
    expect(from).toBeGreaterThan(0)
    act(() => { editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(doc, from + 1, from + 3))) })

    const selected = useEditorStore.getState().flowSession!.selection
    expect(selected.documentSelectionIssue).toBeUndefined()
    expect(selected.documentSelection).toMatchObject({ kind: 'text', anchor: { offset: 1 }, head: { offset: 3 } })
    expect(sendRefusal()).toBeNull()
    expect((selectionScopeSend().context as { flowTextEdit?: unknown }).flowTextEdit).toMatchObject({ tool: 'flow.content' })
  })
})
