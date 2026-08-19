import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insertFlowEditorBlock, updateFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { findFlowBlockRecursive, flowSurfaceIn } from '@/renderer/course/flowDocumentModel'
import { readFlowSharedOwnership } from '@/renderer/course/flowSharedAuthoringAdapters'
import { listFlowCourseTreePages } from '@/renderer/course/flowEditorView'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import {
  selectActiveCourseProjectDocument,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { MediaTab } from '@/renderer/ui/MediaTab'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import { TopToolbar } from '@/renderer/ui/TopToolbar'
import type { AssetMeta } from '@/shared/projectTypes'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function flowDocument() {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected course document')
  return document
}

function flowSurface() {
  const surface = flowDocument().surfaces.find((candidate) => candidate.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
  return surface
}

function imageAsset(): AssetMeta {
  return {
    id: 'asset-flow-image',
    filename: 'cover.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/cover.png',
    byteLength: PNG.byteLength,
    width: 64,
    height: 64,
  }
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.getState().createNewProject()
})

describe('Flow product shell wiring', () => {
  it('keeps default new project on Slide and adds a visible blank Flow entry without removing Spatial', () => {
    expect(flowDocument().surfaces[0]?.type).toBe('slide')
    expect(useEditorStore.getState().flowSession).toBeNull()
    expect(useEditorStore.getState().spatialSession).toBeNull()

    render(
      <TopToolbar
        busy={false}
        onNew={() => useEditorStore.getState().createNewProject()}
        onNewSpatial={() => useEditorStore.getState().createNewSpatialProject()}
        onNewFlow={() => useEditorStore.getState().createNewFlowProject()}
        onOpen={() => undefined}
        recentProjects={[]}
        onOpenRecent={() => undefined}
        onSave={() => undefined}
        healthSummary={{ error: 0, warning: 0, info: 0, total: 0, canExport: true }}
        onOpenHealth={() => undefined}
        onPreview={() => undefined}
        onExport={() => undefined}
      />,
    )
    expect(screen.getByTestId('new-spatial-project')).toBeTruthy()
    fireEvent.click(screen.getByTestId('new-flow-project'))
    expect(flowDocument().surfaces[0]?.type).toBe('flow')
    expect(useEditorStore.getState().flowSession).not.toBeNull()
    expect(useEditorStore.getState().spatialSession).toBeNull()
    expect(flowDocument().schemaVersion).toBe(9)
  })

  it('shows course tree pages and headings, hides paragraphs, cameras, and slide add-scene', () => {
    useEditorStore.getState().createNewFlowProject()
    const startRevision = flowDocument().revision
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    const surface = flowSurface()
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected blank paragraph')
    const found = findFlowBlockRecursive(surface.blocks, paragraph.id)
    useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(flow.history.present, {
      surfaceId: surface.id,
      blockId: paragraph.id,
      parentId: found?.parentId ?? null,
    }, { text: '第二段不应出现在课程树' }, { expectedRevision: flow.history.present.revision }))

    render(<ScenePanel />)
    expect(screen.getByText('课程结构')).toBeTruthy()
    expect(screen.getByText('全局层（全课）')).toBeTruthy()
    const addPrimary = screen.getByTestId('add-content-primary')
    expect(addPrimary).toBeTruthy()
    expect(addPrimary.getAttribute('data-alias-testid')).toBe('add-flow-page')
    expect(screen.queryByTestId('add-scene')).toBeNull()
    expect(screen.queryByText('本页镜头')).toBeNull()
    expect(screen.queryByTestId('add-spatial-camera')).toBeNull()
    expect(screen.getByText('无标题')).toBeTruthy()
    expect(screen.queryByText('第二段不应出现在课程树')).toBeNull()

    const pages = listFlowCourseTreePages(flowDocument())
    const heading = pages[0]?.headings[0]
    expect(heading).toBeTruthy()
    const beforeSelect = flowDocument().revision
    fireEvent.click(screen.getByTestId(`flow-heading-${heading!.locationId}`))
    expect(flowDocument().revision).toBe(beforeSelect)
    expect(startRevision).toBeLessThan(flowDocument().revision + 1)
  })

  it('writes one history revision for paper commands and formats text without a body textarea', () => {
    useEditorStore.getState().createNewFlowProject()
    const startRevision = flowDocument().revision
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-text'))
    expect(useEditorStore.getState().errorMessage).toBeNull()
    expect(flowDocument().revision).toBe(startRevision + 1)
    const createdId = useEditorStore.getState().flowSession?.selection.selectedBlockId
    expect(createdId).toBeTruthy()
    const created = findFlowBlockRecursive(flowSurface().blocks, createdId!)
    expect(created?.block.type).toBe('paragraph')

    const heading = flowSurface().blocks.find((block) => block.type === 'heading')
    expect(heading && heading.type === 'heading').toBe(true)
    const flow = useEditorStore.getState().flowSession
    if (!flow || !heading) throw new Error('expected flow heading')
    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [heading.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.queryByLabelText('文字内容')).toBeNull()
    expect(screen.queryByText('文字内容')).toBeNull()
    fireEvent.click(screen.getByTestId('flow-format-bold'))
    const formatted = flowSurface().blocks.find((block) => block.type === 'heading')
    expect(formatted && formatted.type === 'heading' ? formatted.runs?.some((run) => run.style?.bold) : false).toBe(true)
  })

  it('inserts MediaTab images as document blocks and round-trips a V9 archive', () => {
    useEditorStore.getState().createNewFlowProject()
    const asset = imageAsset()
    useEditorStore.getState().importAsset(asset, PNG)
    render(<MediaTab onImportAudio={() => undefined} onImportVideo={() => undefined} />)
    fireEvent.click(screen.getByTestId(`insert-flow-media-${asset.id}`))
    expect(useEditorStore.getState().errorMessage).toBeNull()
    const mediaBlock = flowSurface().blocks.find((block) => block.type === 'media')
    expect(mediaBlock && mediaBlock.type === 'media' ? mediaBlock.assetId : null).toBe(asset.id)

    cleanup()
    render(<NodesTab />)
    expect(screen.queryByTestId(`node-item-${asset.id}`)).toBeNull()
    expect(screen.queryByText('cover.png')).toBeNull()

    const bytes = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(bytes).toBeTruthy()
    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().flowSession).toBeNull()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(bytes!)).toBe(true)
    expect(flowDocument().schemaVersion).toBe(9)
    expect(flowDocument().surfaces[0]?.type).toBe('flow')
    expect(flowSurface().blocks.some((block) => block.type === 'media')).toBe(true)
  })

  it('does not undo structure while IME is composing', () => {
    useEditorStore.getState().createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    useEditorStore.getState().applyFlowCommand(insertFlowEditorBlock(flow.history.present, {
      surfaceId: flow.selection.surfaceId,
      parentId: null,
      index: flowSurfaceIn(flow.history.present, flow.selection.surfaceId).blocks.length,
      block: { type: 'paragraph', text: '已提交段落' },
    }, { expectedRevision: flow.history.present.revision }))
    const afterInsert = flowDocument().revision
    useEditorStore.setState({
      flowTextEdit: {
        kind: 'rich-text',
        source: 'paper',
        blockId: flow.selection.selectedBlockId ?? 'heading',
        surfaceId: flow.selection.surfaceId,
        parentId: null,
        field: 'text',
        composing: true,
        pendingAction: null,
        revision: afterInsert,
        original: { text: '无标题', runs: [] },
        draft: { text: '无标题', runs: [] },
        range: { start: 0, end: 0 },
      },
    })
    useEditorStore.getState().undo()
    expect(flowDocument().revision).toBe(afterInsert)
    expect(flowSurface().blocks.some((block) => (
      block.type === 'paragraph' && block.text === '已提交段落'
    ))).toBe(true)
  })

  it('converts a paragraph to heading level 2 via block type select and updates course tree', () => {
    useEditorStore.getState().createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    const surface = flowSurface()
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected blank paragraph')

    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [paragraph.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const blockTypeContainer = screen.getByTestId('flow-block-type')
    const select = blockTypeContainer.querySelector('select')
    if (!select) throw new Error('expected select inside flow-block-type')
    fireEvent.change(select, { target: { value: '2' } })

    const updated = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)
    expect(updated?.block.type).toBe('heading')
    expect(updated?.block.type === 'heading' && updated.block.level).toBe(2)

    const pages = listFlowCourseTreePages(flowDocument())
    expect(pages.some((page) => page.headings.some((h) => h.locationId === paragraph.id))).toBe(true)
  })

  it('reads text color from runs in flow block properties', () => {
    useEditorStore.getState().createNewFlowProject()
    const heading = flowSurface().blocks.find((block) => block.type === 'heading')
    expect(heading && heading.type === 'heading').toBe(true)
    const flow = useEditorStore.getState().flowSession
    if (!flow || !heading) throw new Error('expected flow heading')
    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [heading.id]),
      },
    })

    useEditorStore.getState().formatFlowTextStyle({ color: '#dc2626' })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const colorInput = screen.getByLabelText('文字颜色') as HTMLInputElement
    expect(colorInput.value).toBe('#dc2626')
  })

  it('converts paragraph to quote block via block type dropdown in properties tab', () => {
    useEditorStore.getState().createNewFlowProject()
    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    expect(paragraph && paragraph.type === 'paragraph').toBe(true)
    const flow = useEditorStore.getState().flowSession
    if (!flow || !paragraph) throw new Error('expected flow paragraph')
    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [paragraph.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const blockTypeContainer = screen.getByTestId('flow-block-type')
    const select = blockTypeContainer.querySelector('select')
    if (!select) throw new Error('expected select inside flow-block-type')
    fireEvent.change(select, { target: { value: 'quote' } })

    const updated = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)
    expect(updated?.block.type).toBe('quote')
  })

  it('converts media block to viewport-overlay when clicking to-overlay button', () => {
    useEditorStore.getState().createNewFlowProject()
    const asset = imageAsset()
    useEditorStore.getState().importAsset(asset, PNG)
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    useEditorStore.getState().applyFlowCommand(insertFlowEditorBlock(flow.history.present, {
      surfaceId: flow.selection.surfaceId,
      parentId: null,
      index: flowSurfaceIn(flow.history.present, flow.selection.surfaceId).blocks.length,
      block: { type: 'media', mediaKind: 'image', assetId: asset.id, layout: 'content-width' },
    }, { expectedRevision: flow.history.present.revision }))

    const mediaBlock = flowSurface().blocks.find((block) => block.type === 'media')
    if (!mediaBlock) throw new Error('expected media block')
    const activeFlow = useEditorStore.getState().flowSession!
    useEditorStore.setState({
      flowSession: {
        ...activeFlow,
        selection: selectFlowEditorBlocks(activeFlow.history.present, activeFlow.selection.locationId, [mediaBlock.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const toOverlayButton = screen.getByTestId('flow-block-to-overlay')
    fireEvent.click(toOverlayButton)

    const updatedFlow = useEditorStore.getState().flowSession!
    const overlayId = updatedFlow.selection.selectedOverlayIds[0]
    expect(overlayId).toBeDefined()
    expect(readFlowSharedOwnership(updatedFlow.history.present, overlayId!)).toBe('viewport-overlay')
  })
})
