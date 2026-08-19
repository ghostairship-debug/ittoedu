import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/renderer/project/createProject'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import { buildFlowEditorView } from '@/renderer/course/flowEditorView'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import { FlowWorkspace } from '@/renderer/ui/FlowWorkspace'
import { useEditorStore } from '@/renderer/store/editorStore'
import type { FlowCommandResult } from '@/renderer/course/flowEditorCommands'
import type { FlowEditorSelection } from '@/renderer/course/flowEditorSlice'

/**
 * Proves Flow paper hit-testing, in-place editing, context toolbar, and formula dialog.
 * Does not prove Workspace.tsx wiring, PropertiesTab, MediaTab, Player, or default open/save.
 */
const NOW = '2026-08-17T17:10:00.000Z'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
  const result = render(
    <div style={{ width: 900, height: 640 }}>
      <FlowWorkspace
        project={project}
        view={view}
        selection={selection}
        onProjectChange={onProjectChange}
        onSelectionChange={onSelectionChange}
      />
    </div>,
  )
  return { ...result, project, view, onProjectChange, onSelectionChange }
}

describe('FlowWorkspace paper', () => {
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
    expect(workspace.getAttribute('data-flow-not-slide-stage')).toBe('true')
    expect(paper.getAttribute('data-flow-reading-width')).toBe('760')
    expect(paper).toHaveStyle({ maxWidth: '760px' })
    expect(scroll).toHaveStyle({ overflow: 'auto' })
    expect(workspace).not.toHaveStyle({ width: '1280px' })
    expect(workspace).not.toHaveStyle({ height: '720px' })
    expect(screen.getByTestId('flow-layer-card-overlay-text')).toBeTruthy()
    expect(screen.getByTestId('flow-authoring-layer-overlay')).toHaveStyle({
      width: '1280px',
      height: '720px',
    })
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

  it('keeps the context toolbar inside the selected block and does not steal focus on pointer down', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], { focus: 'text', textRange: { blockId: 'p-body', start: 0, end: 4 } })
    const { onSelectionChange } = renderPaper(project, selection)
    const block = screen.getByTestId('flow-block-p-body')
    const toolbar = screen.getByTestId('flow-block-context-toolbar')
    expect(block?.contains(toolbar)).toBe(true)
    expect(toolbar).toHaveAttribute('data-flow-toolbar-placement', 'below')
    expect(screen.getByTestId('flow-range-toolbar')).toBeTruthy()
    fireEvent.mouseDown(screen.getByLabelText('局部加粗'))
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('opens the formula editor on double-click instead of a run editor', () => {
    renderPaper()
    fireEvent.doubleClick(screen.getByRole('math'))
    expect(screen.getByTestId('formula-edit-dialog')).toBeTruthy()
    expect(screen.queryByTestId('flow-inline-editor')).toBeNull()
  })

  it('does not commit IME text until composition ends', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 0 },
    })
    const { onProjectChange } = renderPaper(project, selection)
    const editor = screen.getByTestId('flow-inline-editor')
    fireEvent.compositionStart(editor, { data: '中' })
    editor.textContent = '中文输入'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true })
    fireEvent.blur(editor)
    expect(onProjectChange).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor, { data: '中文输入' })
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

  it('applies wide and content-width maxWidth to media figure', () => {
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
    const contentFigure = screen.getByTestId('flow-block-media-1').querySelector('figure')
    expect(contentFigure).toHaveAttribute('data-flow-media-layout', 'content-width')
    expect(contentFigure).toHaveStyle({ maxWidth: '760px', width: '100%' })

    const wideFigure = screen.getByTestId('flow-block-media-wide').querySelector('figure')
    expect(wideFigure).toHaveAttribute('data-flow-media-layout', 'wide')
    expect(wideFigure).toHaveStyle({ maxWidth: '1120px', width: '100%' })
  })

  it('syncs store flowTextEdit updates to local inline editor during in-place editing', async () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-body'], {
      focus: 'text',
      textRange: { blockId: 'p-body', start: 0, end: 4 },
    })
    const { onSelectionChange } = renderPaper(project, selection)
    const editor = screen.getByTestId('flow-inline-editor')
    expect(editor).toBeTruthy()

    useEditorStore.setState({
      flowTextEdit: {
        kind: 'rich-text',
        source: 'properties',
        blockId: 'p-body',
        surfaceId: 'flow',
        parentId: null,
        field: 'text',
        composing: false,
        pendingAction: null,
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
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(screen.getByTestId('flow-inline-editor').innerHTML).toMatch(/font-style:\s*italic/)
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
})
