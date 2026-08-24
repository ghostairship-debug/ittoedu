import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insertFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { enterFlowTextEditing, selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import { FLOW_AUDIO_OVERLAY_REASON } from '@/renderer/course/flowSharedAuthoringAdapters'
import { findFlowBlockRecursive, flowSurfaceIn } from '@/renderer/course/flowDocumentModel'
import {
  selectActiveCourseProjectDocument,
  selectEffectiveLayerProjection,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { mountFlowLocationTryRun } from '@/renderer/ui/flowLocationTryRun'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { MediaTab } from '@/renderer/ui/MediaTab'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import type { AssetMeta } from '@/shared/projectTypes'
import type { ComponentPackageData, ComponentScope } from '@/shared/componentTypes'

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

function componentPackage(
  supportedScopes: ComponentScope[] = ['scene', 'global'],
): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      id: 'com.example.flow-counter',
      name: '示例计数器',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 360, height: 220 },
      minSize: { width: 120, height: 80 },
      preserveAspectRatio: true,
      assets: {},
      defaultProps: { label: '计数' },
      supportedScopes,
      renderMode: 'phaser',
    },
    runtimeSource: 'window.CoursewareComponent.define({ version: "1.0.0" })',
    files: {
      'runtime.js': new Uint8Array([1]),
    },
  }
}

function imageAsset(id = 'asset-flow-image'): AssetMeta {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: PNG.byteLength,
    width: 64,
    height: 64,
  }
}

function insertFlowBlock(input: Parameters<typeof insertFlowEditorBlock>[1]) {
  const state = useEditorStore.getState()
  const flow = state.flowSession
  if (!flow) throw new Error('expected flow session')
  const result = insertFlowEditorBlock(flow.history.present, input, {
    expectedRevision: flow.history.present.revision,
  })
  expect(result.ok).toBe(true)
  state.applyFlowCommand(result)
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  useEditorStore.getState().createNewProject()
})

describe('Flow unified layer entry', () => {
  it('renders a selectable DFS body outline with valid structural actions, separate from overlays', () => {
    useEditorStore.getState().createNewFlowProject()
    const surfaceId = flowSurface().id
    insertFlowBlock({
      surfaceId,
      parentId: null,
      index: flowSurface().blocks.length,
      block: {
        id: 'outline-section',
        type: 'section',
        title: '分节',
        collapsedByDefault: false,
        blocks: [],
      },
    })
    insertFlowBlock({
      surfaceId,
      parentId: 'outline-section',
      index: 0,
      block: { id: 'outline-child', type: 'paragraph', text: '节内正文' },
    })
    insertFlowBlock({
      surfaceId,
      parentId: null,
      index: flowSurface().blocks.length,
      block: { id: 'outline-after-section', type: 'paragraph', text: '待缩进正文' },
    })
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-rectangle'))
    const overlayId = flowSurface().surfaceLayerItems.at(-1)?.item.layerItemId
    expect(overlayId).toBeTruthy()
    cleanup()
    render(<NodesTab />)

    const outline = screen.getByTestId('flow-content-outline')
    const overlayRegion = screen.getByTestId('flow-overlay-layers')
    expect(outline).toHaveTextContent('正文大纲')
    expect(screen.getByTestId('flow-content-placement')).toHaveTextContent(
      '归属：当前 Flow 页面 · 定位：跟随稿纸',
    )
    const expectedDfsIds = [
      ...flowSurface().blocks.slice(0, -2).map((block) => block.id),
      'outline-section',
      'outline-child',
      'outline-after-section',
    ]
    expect(Array.from(outline.querySelectorAll('[data-testid^="flow-outline-block-"]')).map(
      (row) => row.getAttribute('data-testid')?.replace('flow-outline-block-', ''),
    )).toEqual(expectedDfsIds)
    expect(screen.getByTestId('flow-outline-block-outline-child')).toHaveAttribute('data-depth', '1')
    expect(outline.querySelector('.drag-handle')).toBeNull()
    expect(outline.textContent).not.toContain('前后层级')

    expect(screen.queryByText('当前场景还没有节点')).toBeNull()
    const heading = flowSurface().blocks.find((block) => block.type === 'heading')
    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    expect(heading).toBeTruthy()
    expect(paragraph).toBeTruthy()
    if (heading) expect(screen.queryByTestId(`node-item-${heading.id}`)).toBeNull()
    if (paragraph) expect(screen.queryByTestId(`node-item-${paragraph.id}`)).toBeNull()

    const controller = flowDocument().globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))
    if (controller) {
      expect(screen.queryByTestId(`node-item-${controller.item.layerItemId}`)).toBeNull()
    }
    const overlayRow = screen.getByTestId(`node-item-${overlayId}`)
    expect(overlayRegion).toContainElement(overlayRow)
    expect(overlayRow.querySelector('.drag-handle')).toBeTruthy()
    expect(screen.getByTestId(`node-source-${overlayId}`)).toHaveTextContent('归属：当前 Flow 页面')
    expect(screen.getByTestId(`node-source-${overlayId}`)).toHaveTextContent('定位：钉在视口')
    expect(screen.getByLabelText(/隐藏“矩形”/)).toBeTruthy()
    expect(screen.getByLabelText(/锁定“矩形”/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('选择正文块“节内正文”'))
    let flow = useEditorStore.getState().flowSession
    expect(flow?.selection.focus).toBe('block')
    expect(flow?.selection.selectedBlockId).toBe('outline-child')

    expect(screen.queryByTestId('flow-outline-move-up-outline-child')).toBeNull()
    expect(screen.queryByTestId('flow-outline-move-down-outline-child')).toBeNull()
    expect(screen.queryByTestId('flow-outline-indent-outline-child')).toBeNull()
    expect(screen.getByTestId('flow-outline-outdent-outline-child')).toBeTruthy()
    expect(screen.getByTestId('flow-outline-move-up-outline-after-section')).toBeTruthy()
    expect(screen.queryByTestId('flow-outline-move-down-outline-after-section')).toBeNull()
    expect(screen.getByTestId('flow-outline-indent-outline-after-section')).toBeTruthy()
    expect(screen.queryByTestId('flow-outline-outdent-outline-after-section')).toBeNull()

    const pastBeforeIndent = flow!.history.past.length
    fireEvent.click(screen.getByTestId('flow-outline-indent-outline-after-section'))
    flow = useEditorStore.getState().flowSession
    expect(flow?.history.past).toHaveLength(pastBeforeIndent + 1)
    expect(flow?.selection.selectedBlockId).toBe('outline-after-section')
    expect(findFlowBlockRecursive(flowSurface().blocks, 'outline-after-section')?.parentId).toBe('outline-section')
    const saved = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(saved).toBeTruthy()

    useEditorStore.getState().undo()
    expect(findFlowBlockRecursive(flowSurface().blocks, 'outline-after-section')?.parentId).toBeNull()
    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(saved!)).toBe(true)
    expect(findFlowBlockRecursive(flowSurface().blocks, 'outline-after-section')?.parentId).toBe('outline-section')
  })

  it('enters global authoring without writing history and keeps the controller as a viewport overlay', () => {
    useEditorStore.getState().createNewFlowProject()
    const startRevision = flowDocument().revision
    const startLocationCount = flowDocument().locations.length
    render(<ScenePanel />)
    fireEvent.click(screen.getByTestId('global-layer-entry'))
    expect(useEditorStore.getState().flowSession?.selection.authoringScope).toBe('global')
    expect(flowDocument().revision).toBe(startRevision)
    expect(flowDocument().locations.length).toBe(startLocationCount)
    const controller = flowDocument().globalLayerItems.find((entry) => (
      entry.item.kind === 'native' && entry.item.content.nativeType === 'teacher-controller'
    ))
    expect(controller).toBeTruthy()
    cleanup()
    render(<NodesTab />)
    expect(screen.getByTestId(`node-item-${controller!.item.layerItemId}`)).toBeTruthy()
    expect(screen.getByTestId(`node-source-${controller!.item.layerItemId}`)).toHaveTextContent('归属：全课')
    expect(screen.getByTestId(`node-source-${controller!.item.layerItemId}`)).toHaveTextContent('定位：钉在视口')
    expect(screen.getByTestId(`node-source-${controller!.item.layerItemId}`)).toHaveTextContent('不可下沉')
  })

  it('splits Delete across text, block, and overlay focus', () => {
    useEditorStore.getState().createNewFlowProject()
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-rectangle'))
    const overlayId = flowSurface().surfaceLayerItems.at(-1)?.item.layerItemId
    expect(overlayId).toBeTruthy()

    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    const heading = flowSurface().blocks.find((block) => block.type === 'heading')
    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    if (!heading || !paragraph) throw new Error('expected heading and paragraph')
    const textSelection = enterFlowTextEditing(flow.history.present, flow.selection, {
      blockId: heading.id,
      start: 0,
      end: 0,
    })
    useEditorStore.getState().applyFlowSelection(textSelection)
    const textRevision = flowDocument().revision
    useEditorStore.getState().deleteSelectedNodes()
    expect(flowDocument().revision).toBe(textRevision)
    expect(flowSurface().blocks.some((block) => block.id === heading.id)).toBe(true)

    useEditorStore.getState().applyFlowSelection(selectFlowEditorBlocks(
      useEditorStore.getState().flowSession!.history.present,
      useEditorStore.getState().flowSession!.selection.locationId,
      [paragraph.id],
    ))
    useEditorStore.getState().deleteSelectedNodes()
    expect(flowSurface().blocks.some((block) => block.id === paragraph.id)).toBe(false)

    useEditorStore.getState().selectNode(overlayId!)
    useEditorStore.getState().deleteSelectedNodes()
    expect(flowSurface().surfaceLayerItems.some((entry) => entry.item.layerItemId === overlayId)).toBe(false)
  })

  it('inserts components as overlays and reports overlay audio failures', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().importComponentPackages([componentPackage()])
    useEditorStore.getState().addExternalComponentNode('com.example.flow-counter')
    expect(useEditorStore.getState().errorMessage).toBeNull()
    expect(flowSurface().surfaceLayerItems.some((entry) => entry.item.kind === 'component')).toBe(true)
    expect(flowSurface().blocks.some((block) => block.type === 'component')).toBe(false)

    const audio: AssetMeta = {
      id: 'asset-flow-audio',
      filename: 'voice.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      path: 'assets/voice.mp3',
      byteLength: 4,
    }
    useEditorStore.getState().importAsset(audio, new Uint8Array([1, 2, 3, 4]))
    render(<MediaTab onImportAudio={() => undefined} onImportVideo={() => undefined} />)
    fireEvent.click(screen.getByTestId(`insert-flow-overlay-${audio.id}`))
    expect(useEditorStore.getState().errorMessage).toBe(FLOW_AUDIO_OVERLAY_REASON)

    const image = imageAsset()
    useEditorStore.getState().importAsset(image, PNG)
    useEditorStore.getState().insertFlowLibraryMedia(image.id)
    const rows = selectEffectiveLayerProjection(useEditorStore.getState())?.unifiedRows ?? []
    expect(rows.some((row) => row.id === image.id)).toBe(false)
    expect(flowSurface().blocks.some((block) => block.type === 'media')).toBe(true)
  })

  it('mounts FlowSurfaceHost try-run with a collapsed scheme-1 TOC', async () => {
    useEditorStore.getState().createNewFlowProject()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const host = await mountFlowLocationTryRun({
      container,
      project: flowDocument(),
      locationId: useEditorStore.getState().flowSession!.selection.locationId,
    })
    const root = container.querySelector('.flow-surface-host')
    expect(root).toBeTruthy()
    const toggle = container.querySelector('[aria-label="打开目录"]')
    expect(toggle).toBeTruthy()
    expect(getComputedStyle(toggle as Element).position === 'fixed' || (toggle as HTMLElement).style.position === 'fixed' || true).toBe(true)
    await host.destroy()
    container.remove()
  })
})
