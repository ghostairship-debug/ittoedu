import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import { useEditorStore } from '@/renderer/store/editorStore'
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
    { id: 'h1', type: 'heading', level: 1, text: '工业化让城市生活变得更好吗？' },
    {
      id: 'p-body',
      type: 'paragraph',
      text: '阅读任务',
      runs: [{ start: 0, end: 2, style: { bold: true } }],
    },
    {
      id: 'list-1',
      type: 'list',
      ordered: true,
      items: [{ id: 'item-1', text: '项目一' }],
    },
    {
      id: 'table-1',
      type: 'table',
      caption: '材料',
      columns: [{ id: 'column-a', header: '列 A' }],
      rows: [{ id: 'row-1', cells: { 'column-a': '单元格' } }],
    },
    {
      id: 'formula-1',
      type: 'formula',
      formulaId: 'formula-1',
      accessibleText: 'a + b',
      ast: {
        type: 'row',
        children: [
          { type: 'token', value: 'a' },
          { type: 'operator', value: '+' },
          { type: 'token', value: 'b' },
        ],
      },
    },
    {
      id: 'media-1',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '示意图',
      caption: '封面图',
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

function beginStoreFormulaDraft(input: {
  source: string
  valid: boolean
  ast?: FlowFormulaDraft['ast']
  accessibleText?: string
}) {
  useEditorStore.getState().createNewFlowProject()
  useEditorStore.getState().addFormulaNode()
  const session = useEditorStore.getState().flowSession
  const authoring = useEditorStore.getState().courseAuthoringSession
  if (!session || !authoring) throw new Error('expected Flow authoring session')
  const formula = flowSurfaceIn(
    session.history.present,
    session.selection.surfaceId,
  ).blocks.find((block) => block.type === 'formula')
  if (!formula || formula.type !== 'formula') throw new Error('expected Flow formula')
  const target = captureFlowEditorAuthoringTarget({
    view: buildFlowEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
    }),
    sessionToken: authoring.token,
    target: { kind: 'block', blockId: formula.id },
  })
  const begun = useEditorStore.getState().runFlowAuthoringIntent(target, {
    kind: 'begin-formula-edit',
  })
  if (!begun.ok || !begun.edit || begun.edit.kind !== 'formula') {
    throw new Error('expected Flow formula edit')
  }
  const original = begun.edit.draft as FlowFormulaDraft
  const draft = updateFlowTextDraft(begun.edit, {
    ...original,
    source: input.source,
    ast: input.ast ?? original.ast,
    accessibleText: input.accessibleText ?? original.accessibleText,
    valid: input.valid,
    hasSlots: false,
  })
  const updated = useEditorStore.getState().runFlowAuthoringIntent(target, {
    kind: 'update-text-edit',
    expectedEdit: begun.edit,
    edit: draft,
  })
  if (!updated.ok) throw new Error(updated.reason ?? 'expected formula draft update')
  return { formula, draft }
}

describe('FlowWorkspace paper', () => {
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

  it('commits a valid Store-owned formula once before root Workspace enters try-run', async () => {
    const ast = {
      type: 'row' as const,
      children: [
        { type: 'token' as const, value: 'y' },
        { type: 'operator' as const, value: '+' },
        { type: 'token' as const, value: '2' },
      ],
    }
    const { formula } = beginStoreFormulaDraft({
      source: 'y+2',
      valid: true,
      ast,
      accessibleText: 'y加2',
    })
    const historyBefore = useEditorStore.getState().flowSession!.history.past.length
    render(
      <Workspace
        onAddImage={() => undefined}
        onAddVideo={() => undefined}
        onSelectImageAsset={async () => null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '当前位置试运行' }))

    await waitFor(() => expect(useEditorStore.getState().canvasMode).toBe('run'))
    const after = useEditorStore.getState().flowSession!
    expect(after.history.past).toHaveLength(historyBefore + 1)
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
    expect(flowSurfaceIn(after.history.present, after.selection.surfaceId).blocks)
      .toContainEqual(expect.objectContaining({
        id: formula.id,
        type: 'formula',
        ast,
        accessibleText: 'y加2',
      }))
  })

  it('keeps an invalid formula edit intact and refuses root Workspace try-run', () => {
    const { draft } = beginStoreFormulaDraft({ source: '\\frac{x}', valid: false })
    const before = useEditorStore.getState()
    const beforeSession = before.flowSession!
    render(
      <Workspace
        onAddImage={() => undefined}
        onAddVideo={() => undefined}
        onSelectImageAsset={async () => null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '当前位置试运行' }))

    const after = useEditorStore.getState()
    expect(after.canvasMode).toBe('edit')
    expect(after.flowTextEdit).toBe(draft)
    expect(after.flowSession?.history.present).toBe(beforeSession.history.present)
    expect(after.flowSession?.history.past).toBe(beforeSession.history.past)
    expect(after.flowSession?.history.future).toBe(beforeSession.history.future)
    expect(after.errorMessage).toMatch(/公式|修复|占位符/)
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
    expect(source).toMatch(/shared\/contracts\/native-v1/)
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

  it('paints idle paragraph runs instead of plain text', () => {
    renderPaper()
    const rich = screen.getByTestId('flow-block-p-body').querySelector('[data-flow-rich-text="true"]')
    expect(rich?.textContent).toBe('阅读任务')
    expect(rich?.querySelector('[data-flow-idle-rich-text="true"]')?.innerHTML).toMatch(/font-weight:\s*700/)
    expect(screen.queryByTestId('flow-inline-editor')).toBeNull()
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
    expect([...workspace.children].slice(0, 6)).toEqual([
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

  it('selects a block on click and enters contenteditable on double-click, Enter, or a second text click', () => {
    const { onSelectionChange, rerender, project } = renderPaper()
    const paragraph = screen.getByTestId('flow-block-p-body')
    fireEvent.click(paragraph)
    expect(onSelectionChange).toHaveBeenCalled()
    const selected = onSelectionChange.mock.calls.at(-1)?.[0]
    expect(selected?.selectedBlockId).toBe('p-body')
    expect(selected?.focus).toBe('block')

    const view = buildFlowEditorView({ project, locationId: 'h1' })
    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={selected ?? null}
          onSelectionChange={onSelectionChange}
        />
      </div>,
    )
    fireEvent.keyDown(screen.getByTestId('flow-block-p-body'), { key: 'Enter' })
    const editing = onSelectionChange.mock.calls.at(-1)?.[0]
    expect(editing?.focus).toBe('text')
    expect(editing?.textRange?.blockId).toBe('p-body')
    expect(screen.getByTestId('flow-inline-editor')).toHaveAttribute('contenteditable', 'true')
    expect(screen.getByTestId('flow-inline-editor').tagName).toBe('SPAN')

    const viaGesture = selectFlowEditorBlocks(project, 'h1', ['p-body'])
    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={viaGesture}
          onSelectionChange={onSelectionChange}
        />
      </div>,
    )
    fireEvent.click(screen.getByTestId('flow-block-p-body').querySelector('[data-flow-rich-text="true"]')!)
    expect(onSelectionChange.mock.calls.at(-1)?.[0]?.focus).toBe('text')
    expect(screen.queryByTestId('formula-edit-dialog')).toBeNull()

    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={viaGesture}
          onSelectionChange={onSelectionChange}
        />
      </div>,
    )
    fireEvent.doubleClick(screen.getByTestId('flow-block-p-body'))
    expect(onSelectionChange.mock.calls.at(-1)?.[0]?.focus).toBe('text')
    const editor = screen.getByTestId('flow-inline-editor')
    expect(editor.tagName).toBe('SPAN')
    expect(editor).toHaveAttribute('contenteditable', 'true')
  })

  it('keeps a native range across rich-text runs without bubbling back to block selection', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 0 },
    })
    const { onSelectionChange, onTextEditChange } = renderPaper(project, selection)
    const editor = screen.getByTestId('flow-inline-editor')
    const firstStyledText = editor.querySelector('span')?.firstChild
    const trailingText = editor.lastChild
    expect(firstStyledText?.nodeType).toBe(Node.TEXT_NODE)
    expect(trailingText?.nodeType).toBe(Node.TEXT_NODE)

    const range = document.createRange()
    range.setStart(firstStyledText!, 1)
    range.setEnd(trailingText!, 1)
    const nativeSelection = window.getSelection()!
    nativeSelection.removeAllRanges()
    nativeSelection.addRange(range)
    expect(nativeSelection.toString()).toBe('读任')

    fireEvent(document, new Event('selectionchange'))
    expect(onTextEditChange.mock.calls.at(-1)?.[0]?.range).toEqual({ start: 1, end: 3 })

    fireEvent.pointerDown(editor, { button: 0 })
    fireEvent.click(editor)
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(window.getSelection()?.toString()).toBe('读任')
  })

  it('gives empty paragraph, heading, quote, list and table editors stable non-persisted geometry', () => {
    const project = createFlowProject()
    const surface = project.surfaces.find((entry) => entry.id === 'flow')
    if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
    surface.blocks = surface.blocks.map((block) => {
      if (block.id === 'h1' && block.type === 'heading') return { ...block, text: '' }
      if (block.id === 'p-body' && block.type === 'paragraph') {
        const next = { ...block, text: '', lineSpacing: 8 }
        delete next.runs
        return next
      }
      if (block.id === 'list-1' && block.type === 'list') {
        return {
          ...block,
          items: block.items.map((item) => {
            const next = { ...item, text: '' }
            delete next.runs
            return next
          }),
        }
      }
      if (block.id === 'table-1' && block.type === 'table') {
        return {
          ...block,
          rows: block.rows.map((row) => ({ ...row, cells: { ...row.cells, 'column-a': '' } })),
        }
      }
      return block
    })
    surface.blocks.splice(2, 0, { id: 'quote-empty', type: 'quote', text: '' })

    const cases = [
      { blockId: 'p-body' },
      { blockId: 'h1' },
      { blockId: 'quote-empty' },
      { blockId: 'list-1', listItemId: 'item-1' },
      { blockId: 'table-1', tableRowId: 'row-1', tableColumnId: 'column-a' },
    ] as const

    for (const target of cases) {
      const textRange = { ...target, start: 0, end: 0 }
      const selection = selectFlowEditorBlocks(project, 'h1', [target.blockId], {
        focus: 'text',
        textRange,
      })
      const rendered = renderPaper(project, selection)
      const editor = screen.getByTestId('flow-inline-editor')
      expect(editor.querySelector('br[data-flow-empty-placeholder="true"]')).toBeTruthy()
      expect(extractFlowRichTextFromEditor(editor)).toEqual({ text: '', runs: [] })
      expect(editor).toHaveStyle({
        display: 'block',
        width: '100%',
        minHeight: '1.4em',
        userSelect: 'text',
        cursor: 'text',
      })
      expect(editor.style.lineHeight).toBe('')
      if (target.blockId === 'p-body') {
        expect(editor.parentElement).toHaveStyle({ lineHeight: '2.1' })
      }

      editor.textContent = '首'
      fireEvent.input(editor)
      expect(rendered.onTextEditChange.mock.calls.at(-1)?.[0]?.draft).toMatchObject({ text: '首' })
      expect(editor).toHaveStyle({ display: 'block', width: '100%', minHeight: '1.4em' })
      rendered.unmount()
    }
  })

  it('keeps toolbar commands inside the selected text range event boundary', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], { focus: 'text', textRange: { blockId: 'p-body', start: 0, end: 4 } })
    const { onProjectChange, onSelectionChange, onTextEditChange } = renderPaper(project, selection)
    const block = screen.getByTestId('flow-block-p-body')
    const toolbar = screen.getByTestId('flow-block-context-toolbar')
    expect(block?.contains(toolbar)).toBe(true)
    expect(toolbar).toHaveAttribute('data-flow-toolbar-placement', 'below')
    expect(screen.getByTestId('flow-range-toolbar')).toBeTruthy()
    const bold = screen.getByLabelText('局部加粗')
    fireEvent.mouseDown(bold)
    fireEvent.click(bold)
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(onTextEditChange.mock.calls.at(-1)?.[0]).toMatchObject({
      range: { start: 0, end: 4 },
      draft: {
        text: '阅读任务',
        runs: [{ start: 0, end: 4, style: { bold: true } }],
      },
    })
    const editor = screen.getByTestId('flow-inline-editor')
    expect(editor).toBeInTheDocument()
    expect(screen.getByLabelText('局部加粗')).toHaveAttribute('aria-pressed', 'true')

    onProjectChange.mockClear()
    onSelectionChange.mockClear()
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })

    expect(onProjectChange).toHaveBeenCalledTimes(1)
    const committed = onProjectChange.mock.calls[0]?.[0]
    const surface = committed?.nextDocument?.surfaces.find((entry) => entry.id === 'flow')
    const paragraph = surface?.type === 'flow'
      ? surface.blocks.find((block) => block.id === 'p-body')
      : undefined
    expect(committed?.historyEntry).toBeTruthy()
    expect(paragraph).toMatchObject({
      type: 'paragraph',
      text: '阅读任务',
      runs: [{ start: 0, end: 4, style: { bold: true } }],
    })
    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange.mock.calls[0]?.[0]).toMatchObject({
      selectedBlockId: 'p-body',
      focus: 'block',
    })
    expect(screen.queryByTestId('flow-inline-editor')).toBeNull()
  })

  it('cancels rich inline editing once without bubbling Escape into block deselection', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 4 },
    })
    const { onProjectChange, onSelectionChange } = renderPaper(project, selection)

    fireEvent.keyDown(screen.getByTestId('flow-inline-editor'), { key: 'Escape' })

    expect(onProjectChange).not.toHaveBeenCalled()
    expect(onSelectionChange).toHaveBeenCalledTimes(1)
    expect(onSelectionChange.mock.calls[0]?.[0]).toMatchObject({
      selectedBlockId: 'p-body',
      focus: 'block',
    })
    expect(screen.queryByTestId('flow-inline-editor')).toBeNull()
  })

  it('isolates terminal commit and cancel keys for plain input and textarea editors', () => {
    const scenarios: Array<{
      block: FlowBlock
      nextValue: string
      commitKey: { key: string; ctrlKey?: boolean }
      readValue: (block: FlowBlock) => string | undefined
    }> = [
      {
        block: { id: 'code-terminal', type: 'code', code: 'const value = 1' },
        nextValue: 'const value = 2',
        commitKey: { key: 'Enter', ctrlKey: true },
        readValue: (block) => block.type === 'code' ? block.code : undefined,
      },
      {
        block: {
          id: 'section-terminal',
          type: 'section',
          title: '旧标题',
          collapsedByDefault: false,
          blocks: [],
        },
        nextValue: '新标题',
        commitKey: { key: 'Enter' },
        readValue: (block) => block.type === 'section' ? block.title : undefined,
      },
    ]

    for (const scenario of scenarios) {
      const project = createFlowProject()
      const flow = project.surfaces.find((surface) => surface.id === 'flow')
      if (!flow || flow.type !== 'flow') throw new Error('expected Flow surface')
      flow.blocks.push(scenario.block)
      syncFlowCourseLocations(project, 'flow')
      const selection = selectFlowEditorBlocks(project, 'h1', [scenario.block.id], {
        focus: 'text',
        textRange: { blockId: scenario.block.id, start: 0, end: 0 },
      })
      const committedRender = renderPaper(project, selection)
      const editor = screen.getByTestId('flow-inline-plain-editor')
      fireEvent.change(editor, { target: { value: scenario.nextValue } })
      committedRender.onProjectChange.mockClear()
      committedRender.onSelectionChange.mockClear()

      fireEvent.keyDown(editor, scenario.commitKey)

      expect(committedRender.onProjectChange).toHaveBeenCalledTimes(1)
      const result = committedRender.onProjectChange.mock.calls[0]?.[0]
      const nextFlow = result?.nextDocument?.surfaces.find((surface) => surface.id === 'flow')
      const nextBlock = nextFlow?.type === 'flow'
        ? nextFlow.blocks.find((block) => block.id === scenario.block.id)
        : undefined
      expect(result?.historyEntry).toBeTruthy()
      expect(nextBlock && scenario.readValue(nextBlock)).toBe(scenario.nextValue)
      expect(committedRender.onSelectionChange).toHaveBeenCalledTimes(1)
      expect(committedRender.onSelectionChange.mock.calls[0]?.[0]).toMatchObject({
        selectedBlockId: scenario.block.id,
        focus: 'block',
      })
      expect(screen.queryByTestId('flow-inline-plain-editor')).toBeNull()
      committedRender.unmount()

      const cancelledRender = renderPaper(project, selection)
      fireEvent.change(screen.getByTestId('flow-inline-plain-editor'), {
        target: { value: scenario.nextValue },
      })
      cancelledRender.onProjectChange.mockClear()
      cancelledRender.onSelectionChange.mockClear()

      fireEvent.keyDown(screen.getByTestId('flow-inline-plain-editor'), { key: 'Escape' })

      expect(cancelledRender.onProjectChange).not.toHaveBeenCalled()
      expect(cancelledRender.onSelectionChange).toHaveBeenCalledTimes(1)
      expect(cancelledRender.onSelectionChange.mock.calls[0]?.[0]).toMatchObject({
        selectedBlockId: scenario.block.id,
        focus: 'block',
      })
      expect(screen.queryByTestId('flow-inline-plain-editor')).toBeNull()
      cancelledRender.unmount()
    }
  })

  it('reserves the complete below-toolbar footprint before neighboring blocks', () => {
    const project = createFlowProject()
    const headingSelection = selectFlowEditorBlocks(project, 'h1', ['h1'])
    const headingRender = renderPaper(project, headingSelection)
    expect(screen.getByTestId('flow-block-context-toolbar'))
      .toHaveAttribute('data-flow-toolbar-placement', 'below')
    expect(screen.getByTestId('flow-block-h1')).toHaveStyle({ marginBottom: '72px' })
    expect(screen.getByTestId('flow-block-p-body')).toHaveStyle({ marginBottom: '12px' })
    headingRender.unmount()

    const wrappedProject = createFlowProject()
    const flow = wrappedProject.surfaces.find((surface) => surface.type === 'flow')
    const media = flow?.type === 'flow'
      ? flow.blocks.find((block) => block.id === 'media-1')
      : undefined
    if (!media || media.type !== 'media') throw new Error('expected Flow media fixture')
    media.wrap = 'left'
    const mediaSelection = selectFlowEditorBlocks(wrappedProject, 'h1', ['media-1'])
    renderPaper(wrappedProject, mediaSelection)
    expect(screen.getByTestId('flow-block-media-1')).toHaveStyle({ marginBottom: '68px' })
  })

  it('keeps the formula body target stable across selection rerender and opens on a second real click', () => {
    const { onProjectChange, onSelectionChange, onTextEditChange, project, rerender } = renderPaper()
    const explicitEntry = screen.getByRole('button', { name: '编辑公式' })
    expect(explicitEntry).toBeVisible()
    fireEvent.click(explicitEntry)
    expect(screen.getByTestId('formula-edit-dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭公式编辑' }))
    expect(screen.queryByTestId('formula-edit-dialog')).toBeNull()
    onSelectionChange.mockClear()
    onTextEditChange.mockClear()

    const formulaTarget = document.querySelector<HTMLElement>('[data-flow-formula-id="formula-1"]')
    if (!formulaTarget) throw new Error('expected formula body target')

    fireEvent.click(formulaTarget)
    const selected = onSelectionChange.mock.calls.at(-1)?.[0]
    expect(selected).toMatchObject({ selectedBlockId: 'formula-1', focus: 'block' })

    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={buildFlowEditorView({ project, locationId: 'h1' })}
          selection={selected ?? null}
          onProjectChange={onProjectChange}
          onSelectionChange={onSelectionChange}
          onTextEditChange={onTextEditChange}
        />
      </div>,
    )
    const rerenderedTarget = document.querySelector<HTMLElement>('[data-flow-formula-id="formula-1"]')
    expect(rerenderedTarget).toBe(formulaTarget)
    expect(screen.getByRole('math')).toHaveStyle({ pointerEvents: 'none' })

    fireEvent.click(rerenderedTarget!)
    expect(screen.getByTestId('formula-edit-dialog')).toBeTruthy()
    expect(onTextEditChange.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'formula',
      blockId: 'formula-1',
    })
    expect(screen.queryByTestId('flow-inline-editor')).toBeNull()

    onProjectChange.mockClear()
    fireEvent.change(screen.getByRole('textbox', { name: '公式内容（线性输入）' }), {
      target: { value: 'a-b' },
    })
    expect(onTextEditChange.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'formula',
      draft: {
        source: 'a-b',
        valid: true,
        ast: {
          type: 'row',
          children: [
            { type: 'token', value: 'a' },
            { type: 'operator', value: '-' },
            { type: 'token', value: 'b' },
          ],
        },
      },
    })
    expect(onProjectChange).not.toHaveBeenCalled()
    const applyFormula = screen.getByRole('button', { name: '应用公式' })
    expect(applyFormula).toBeEnabled()
    fireEvent.click(applyFormula)
    expect(onProjectChange).toHaveBeenCalledTimes(1)
    expect(onProjectChange.mock.calls[0]?.[0]).toMatchObject({ ok: true, historyEntry: true })
    expect(onTextEditChange.mock.calls.at(-1)?.[0]).toBeNull()
  })

  it('does not commit IME text until composition ends', async () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 0 },
    })
    const { onProjectChange } = renderPaper(project, selection)
    const editor = screen.getByTestId('flow-inline-editor')
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    fireEvent.compositionStart(editor, { data: '中' })
    editor.textContent = '中文输入'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.blur(editor)
    expect(onProjectChange).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor, { data: '中文输入' })
    expect(onProjectChange).toHaveBeenCalledTimes(1)
    expect(onProjectChange.mock.calls[0]?.[0]).toMatchObject({ ok: true, historyEntry: true })
  })

  it('commits range bold through the same apply-text command as the document model', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 4 },
    })
    const { onProjectChange } = renderPaper(project, selection)
    fireEvent.click(screen.getByLabelText('局部加粗'))
    fireEvent.blur(screen.getByTestId('flow-inline-editor'))
    const committed = onProjectChange.mock.calls.find((call) => call[0]?.historyEntry)
    if (committed) {
      const surface = committed[0]!.nextDocument!.surfaces.find((entry) => entry.id === 'flow')
      const paragraph = surface && surface.type === 'flow'
        ? surface.blocks.find((block) => block.id === 'p-body')
        : undefined
      expect(paragraph).toMatchObject({ type: 'paragraph', text: '阅读任务' })
    }
  })

  it('reorders a paragraph by dropping it on another block handle', () => {
    const { onProjectChange } = renderPaper()
    const dragHandle = screen.getByTestId('flow-block-drag-p-body')
    const targetBlock = screen.getByTestId('flow-block-h1')
    expect(targetBlock.getAttribute('data-flow-block-index')).toBe('0')
    expect(screen.getByTestId('flow-block-p-body').getAttribute('data-flow-block-index')).toBe('1')

    const dataStore: Record<string, string> = {}
    const dataTransfer = {
      setData: (key: string, value: string) => {
        dataStore[key] = value
      },
      getData: (key: string) => dataStore[key] || '',
      effectAllowed: 'none',
      dropEffect: 'none',
    }

    fireEvent.dragStart(dragHandle, { dataTransfer })
    expect(dataStore['text/flow-block-id']).toBe('p-body')

    fireEvent.dragOver(targetBlock, { dataTransfer })
    fireEvent.drop(targetBlock, { dataTransfer })

    expect(onProjectChange).toHaveBeenCalled()
    const result = onProjectChange.mock.calls[0]?.[0]
    expect(result?.ok).toBe(true)
    const surface = result?.nextDocument?.surfaces.find((entry) => entry.id === 'flow')
    if (surface && surface.type === 'flow') {
      const blockIds = surface.blocks.map((block) => block.id)
      expect(blockIds.indexOf('p-body')).toBe(0)
    }
  })

  it('applies the shared conflict-free width projection to media figures', () => {
    const project = createFlowProject()
    const flowSurface = project.surfaces.find((entry) => entry.id === 'flow')
    if (flowSurface && flowSurface.type === 'flow') {
      flowSurface.blocks.push({
        id: 'media-wide',
        type: 'media',
        assetId: 'asset-image',
        mediaKind: 'image',
        altText: '示意图',
        caption: '宽版图',
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
      const figure = screen.getByTestId(`flow-block-${blockId}`).querySelector<HTMLElement>('figure')!
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

  it('syncs controlled textEdit updates to local inline editor during in-place editing', async () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 4 },
    })
    const { rerender, view, onSelectionChange, onProjectChange, onTextEditChange } = renderPaper(project, selection)
    expect(screen.getByTestId('flow-inline-editor')).toBeTruthy()

    const textEdit: FlowTextEditSession = {
      kind: 'rich-text',
      source: 'properties',
      blockId: 'p-body',
      surfaceId: 'flow',
      parentId: null,
      field: 'text',
      composing: false,
      pendingAction: null,
      pendingStyle: {},
      revision: 1,
      original: { text: '阅读任务', runs: [{ start: 0, end: 2, style: { bold: true } }] },
      draft: {
        text: '阅读任务',
        runs: [
          { start: 0, end: 2, style: { bold: true } },
          { start: 0, end: 4, style: { italic: true } },
        ],
      },
      range: { start: 0, end: 4 },
    }
    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={selection}
          textEdit={textEdit}
          onProjectChange={onProjectChange}
          onSelectionChange={onSelectionChange}
          onTextEditChange={onTextEditChange}
        />
      </div>,
    )

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(screen.getByTestId('flow-inline-editor').innerHTML).toMatch(/font-style:\s*italic/)
  })

  it('adopts an external Flow edit clear without publishing the stale local draft back', async () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 4 },
    })
    const { rerender, view, onProjectChange, onSelectionChange, onTextEditChange } = renderPaper(project, selection)
    await waitFor(() => expect(screen.getByTestId('flow-inline-editor')).toBeTruthy())
    const mirroredEdit = onTextEditChange.mock.calls.at(-1)?.[0]
    expect(mirroredEdit).toBeTruthy()
    const publishesBeforeClear = onTextEditChange.mock.calls.length

    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={selection}
          textEdit={null}
          onProjectChange={onProjectChange}
          onSelectionChange={onSelectionChange}
          onTextEditChange={onTextEditChange}
        />
      </div>,
    )

    await waitFor(() => expect(screen.queryByTestId('flow-inline-editor')).toBeNull())
    expect(onTextEditChange).toHaveBeenCalledTimes(publishesBeforeClear)
  })

  it('drops a pending focusout commit after the parent has already finalized the Flow draft', async () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 4 },
    })
    const { rerender, view, onProjectChange, onSelectionChange, onTextEditChange } = renderPaper(project, selection)
    await waitFor(() => expect(screen.getByTestId('flow-inline-editor')).toBeTruthy())

    const editor = screen.getByTestId('flow-inline-editor')
    editor.textContent = '已经由保存事务封口的 Flow 草稿'
    fireEvent.input(editor)
    const mirroredEdit = onTextEditChange.mock.calls.at(-1)?.[0]
    expect(mirroredEdit).toBeTruthy()

    editor.ownerDocument.dispatchEvent(new FocusEvent('focusout', {
      bubbles: true,
      relatedTarget: document.body,
    }))
    rerender(
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          project={project}
          view={view}
          selection={selection}
          textEdit={null}
          onProjectChange={onProjectChange}
          onSelectionChange={onSelectionChange}
          onTextEditChange={onTextEditChange}
        />
      </div>,
    )

    await waitFor(() => expect(screen.queryByTestId('flow-inline-editor')).toBeNull())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onProjectChange).not.toHaveBeenCalled()
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
    const paragraph = screen.getByTestId('flow-block-p-body').querySelector('p')
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
        staticFallbackAssetId: '',
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
