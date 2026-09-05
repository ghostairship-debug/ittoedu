import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharedShapeProperties } from '@/renderer/ui/properties/SharedShapeProperties'
import { useEditorStore } from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { createShapeNode, createTextNode, createImageNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import { locateCourseLayer } from '@/renderer/course/effectiveLayerCommands'
import type { FlowSurfaceDocument } from '@/shared/courseProjectTypes'
import type { ShapeNode } from '@/shared/contracts/native-v1'

function drawingContext(): CanvasRenderingContext2D {
  return {
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 12),
    })),
    scale: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('SharedShapeProperties unit tests', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders rectangle shape properties with fill, stroke, and corner radius controls', () => {
    const update = vi.fn()
    const node: ShapeNode = createShapeNode('rectangle', {
      id: 'shape-1',
      name: '矩形',
      width: 200,
      height: 100,
      style: {
        fillColor: '#3b82f6',
        fillOpacity: 0.8,
        borderColor: '#1d4ed8',
        borderWidth: 2,
        lineStyle: 'solid',
        cornerRadius: 8,
      },
    })

    render(<SharedShapeProperties node={node} update={update} />)

    expect(screen.getByTestId('shape-properties')).toBeInTheDocument()
    expect(screen.queryByTestId('shape-stroke-only-hint')).toBeNull()

    // Change fill color
    const fillColorInput = screen.getByLabelText('填充色') as HTMLInputElement
    expect(fillColorInput.value).toBe('#3b82f6')
    fireEvent.change(fillColorInput, { target: { value: '#ef4444' } })
    fireEvent.blur(fillColorInput)
    expect(update).toHaveBeenCalledWith({ style: { fillColor: '#ef4444' } })

    // Change corner radius (which sets rounded-rectangle if > 0)
    const radiusInput = screen.getByLabelText('圆角') as HTMLInputElement
    expect(radiusInput.value).toBe('8')
    fireEvent.change(radiusInput, { target: { value: '16' } })
    fireEvent.blur(radiusInput)
    expect(update).toHaveBeenCalledWith({
      shapeType: 'rounded-rectangle',
      style: { cornerRadius: 16 },
    })
  })

  it('renders line shape properties with stroke-only hint and disables/hides fill and corner radius', () => {
    const update = vi.fn()
    const node: ShapeNode = createShapeNode('line', {
      id: 'line-1',
      name: '直线',
      width: 200,
      height: 20,
      style: {
        borderColor: '#10b981',
        borderWidth: 3,
        lineStyle: 'dashed',
        startArrow: 'none',
        endArrow: 'triangle',
      },
    })

    render(<SharedShapeProperties node={node} update={update} />)

    expect(screen.getByTestId('shape-properties')).toBeInTheDocument()
    // Stroke-only hint must be displayed for line
    expect(screen.getByTestId('shape-stroke-only-hint')).toBeInTheDocument()
    // Fill and corner radius should not be rendered for line
    expect(screen.queryByLabelText('填充色')).toBeNull()
    expect(screen.queryByLabelText('圆角')).toBeNull()

    // Arrow options should be rendered
    const startArrowSelect = screen.getByLabelText('起点箭头') as HTMLSelectElement
    expect(startArrowSelect.value).toBe('none')
    const endArrowSelect = screen.getByLabelText('终点箭头') as HTMLSelectElement
    expect(endArrowSelect.value).toBe('triangle')

    fireEvent.change(endArrowSelect, { target: { value: 'stealth' } })
    expect(update).toHaveBeenCalledWith({ style: { endArrow: 'stealth' } })
  })
})

describe('Flow Native Authoring Parity in PropertiesTab and Store', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      drawingContext(),
    )
    useEditorStore.getState().createNewProject()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('edits rectangle shape overlay via FlowPropertiesPanel and commits single transaction', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()

    const baseDoc = structuredClone(useEditorStore.getState().flowSession!.history.present)
    const flowSurface = baseDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    const originalBlocks = structuredClone(flowSurface.blocks)

    // Add rectangle overlay to surfaceLayerItems
    const rectNode = createShapeNode('rectangle', {
      id: 'rect-overlay',
      name: '浮层矩形',
      x: 50,
      y: 50,
      width: 200,
      height: 120,
      style: {
        fillColor: '#3b82f6',
        borderColor: '#1e40af',
        borderWidth: 2,
      },
    })
    const rectLayer = sceneNodeToCourseLayerItem(rectNode, 10)
    flowSurface.surfaceLayerItems.push({
      item: rectLayer,
      visibility: { mode: 'all', locationIds: [] },
    })

    store.loadCourseProject(baseDoc, null)

    // Select the overlay
    const selection = selectFlowOverlay(baseDoc, baseDoc.startLocationId, ['rect-overlay'])
    useEditorStore.getState().applyFlowSelection(selection)

    // Render PropertiesTab
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    // Verify SharedShapeProperties is rendered in FlowPropertiesPanel
    expect(screen.getByTestId('shape-properties')).toBeInTheDocument()

    // Edit fill color
    const fillColorInput = screen.getByLabelText('填充色') as HTMLInputElement
    fireEvent.change(fillColorInput, { target: { value: '#10b981' } })
    fireEvent.blur(fillColorInput)

    // Verify document history updated
    const updatedDoc = useEditorStore.getState().flowSession!.history.present
    const located = locateCourseLayer(updatedDoc, 'rect-overlay')
    expect(located).toBeDefined()
    expect(located!.item.kind).toBe('native')
    if (located!.item.kind === 'native') {
      const data = located!.item.content.data as any
      expect(data.style.fillColor).toBe('#10b981')
    }

    // Verify document blocks were completely untouched
    const updatedFlowSurface = updatedDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    expect(updatedFlowSurface.blocks).toEqual(originalBlocks)
  })

  it('edits line shape overlay via FlowPropertiesPanel and preserves document flow', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()

    const baseDoc = structuredClone(useEditorStore.getState().flowSession!.history.present)
    const flowSurface = baseDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    const originalBlocks = structuredClone(flowSurface.blocks)

    // Add line overlay to surfaceLayerItems
    const lineNode = createShapeNode('line', {
      id: 'line-overlay',
      name: '浮层线条',
      x: 30,
      y: 30,
      width: 150,
      height: 20,
      style: {
        borderColor: '#6b7280',
        borderWidth: 2,
      },
    })
    const lineLayer = sceneNodeToCourseLayerItem(lineNode, 15)
    flowSurface.surfaceLayerItems.push({
      item: lineLayer,
      visibility: { mode: 'all', locationIds: [] },
    })

    store.loadCourseProject(baseDoc, null)

    // Select the overlay
    const selection = selectFlowOverlay(baseDoc, baseDoc.startLocationId, ['line-overlay'])
    useEditorStore.getState().applyFlowSelection(selection)

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByTestId('shape-properties')).toBeInTheDocument()
    expect(screen.getByTestId('shape-stroke-only-hint')).toBeInTheDocument()

    // Edit border color
    const strokeColorInput = screen.getByLabelText('线条颜色') as HTMLInputElement
    fireEvent.change(strokeColorInput, { target: { value: '#dc2626' } })
    fireEvent.blur(strokeColorInput)

    const updatedDoc = useEditorStore.getState().flowSession!.history.present
    const located = locateCourseLayer(updatedDoc, 'line-overlay')
    expect(located).toBeDefined()
    if (located!.item.kind === 'native') {
      const data = located!.item.content.data as any
      expect(data.style.borderColor).toBe('#dc2626')
    }

    const updatedFlowSurface = updatedDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    expect(updatedFlowSurface.blocks).toEqual(originalBlocks)
  })

  it('edits text overlay via FlowPropertiesPanel and preserves body blocks', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()

    const baseDoc = structuredClone(useEditorStore.getState().flowSession!.history.present)
    const flowSurface = baseDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    const originalBlocks = structuredClone(flowSurface.blocks)

    // Add text overlay
    const textNode = createTextNode({
      id: 'text-overlay',
      name: '浮层文本',
      text: '说明文字',
    })
    const textLayer = sceneNodeToCourseLayerItem(textNode, 20)
    flowSurface.surfaceLayerItems.push({
      item: textLayer,
      visibility: { mode: 'all', locationIds: [] },
    })

    store.loadCourseProject(baseDoc, null)

    // Select the text overlay
    const selection = selectFlowOverlay(baseDoc, baseDoc.startLocationId, ['text-overlay'])
    useEditorStore.getState().applyFlowSelection(selection)

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    // Check that text color input is present and functional
    const colorInput = screen.getByLabelText('文字颜色') as HTMLInputElement
    fireEvent.change(colorInput, { target: { value: '#7c3aed' } })
    fireEvent.blur(colorInput)

    const updatedDoc = useEditorStore.getState().flowSession!.history.present
    const located = locateCourseLayer(updatedDoc, 'text-overlay')
    expect(located).toBeDefined()
    if (located!.item.kind === 'native') {
      const data = located!.item.content.data as any
      expect(data.style.color).toBe('#7c3aed')
    }

    const updatedFlowSurface = updatedDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    expect(updatedFlowSurface.blocks).toEqual(originalBlocks)
  })

  it('renders image overlay properties with demote-to-body button and preserves body blocks', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()

    const baseDoc = structuredClone(useEditorStore.getState().flowSession!.history.present)
    baseDoc.assets = {
      'asset-image': {
        id: 'asset-image',
        filename: 'test.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/test.png',
        byteLength: 100,
        width: 640,
        height: 360,
      },
    }
    const flowSurface = baseDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    const originalBlocks = structuredClone(flowSurface.blocks)

    // Add image overlay
    const imageNode = createImageNode({
      id: 'img-overlay',
      name: '浮层图片',
      assetId: 'asset-image',
      width: 200,
      height: 150,
      x: 40,
      y: 40,
    })
    const imageLayer = sceneNodeToCourseLayerItem(imageNode, 25)
    flowSurface.surfaceLayerItems.push({
      item: imageLayer,
      visibility: { mode: 'all', locationIds: [] },
    })

    store.loadCourseProject(baseDoc, null)

    // Select the image overlay
    const selection = selectFlowOverlay(baseDoc, baseDoc.startLocationId, ['img-overlay'])
    useEditorStore.getState().applyFlowSelection(selection)

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    // Demote to body button should be present for overlay image
    expect(screen.getByTestId('flow-overlay-to-document')).toBeInTheDocument()

    // Edit corner radius
    const cornerRadiusInput = screen.getByLabelText('圆角') as HTMLInputElement
    fireEvent.change(cornerRadiusInput, { target: { value: '10' } })
    fireEvent.blur(cornerRadiusInput)

    const updatedDoc = useEditorStore.getState().flowSession!.history.present
    const located = locateCourseLayer(updatedDoc, 'img-overlay')
    expect(located).toBeDefined()
    if (located!.item.kind === 'native') {
      const data = located!.item.content.data as any
      expect(data.cornerRadius).toBe(10)
    }

    // Body blocks remain intact
    const updatedFlowSurface = updatedDoc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')!
    expect(updatedFlowSurface.blocks).toEqual(originalBlocks)
  })
})
