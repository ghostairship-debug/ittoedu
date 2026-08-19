import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { selectFlowEditorBlocks } from '@/renderer/course/flowEditorSlice'
import { createFormulaNode } from '@/renderer/project/createProject'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { useEditorStore } from '@/renderer/store/editorStore'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import type { FlowSurfaceDocument } from '@/shared/courseProjectTypes'

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
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('FlowFormulaBlockProperties', () => {
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

  it('mounts FormulaAuthoringEditor when formula block is selected and commits changes', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()
    store.addFormulaNode()

    const flow = useEditorStore.getState().flowSession
    expect(flow).not.toBeNull()
    if (!flow) return

    const doc = flow.history.present
    const flowSurface = doc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')
    expect(flowSurface).toBeDefined()
    if (!flowSurface) return

    const formulaBlock = flowSurface.blocks.find((b) => b.type === 'formula')
    expect(formulaBlock).toBeDefined()
    if (!formulaBlock) return

    const selection = selectFlowEditorBlocks(doc, flow.selection.locationId, [formulaBlock.id])
    useEditorStore.getState().applyFlowSelection(selection)

    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByTestId('flow-formula-properties')).toBeDefined()
    expect(screen.getByTestId('formula-authoring-editor')).toBeDefined()

    const input = screen.getByRole('textbox', { name: '公式内容（线性输入）' })
    fireEvent.change(input, { target: { value: 'a+b' } })

    const applyButton = screen.getByRole('button', { name: '应用公式' })
    fireEvent.click(applyButton)

    const updatedFlow = useEditorStore.getState().flowSession
    const updatedDoc = updatedFlow?.history.present
    const updatedSurface = updatedDoc?.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')
    const updatedBlock = updatedSurface?.blocks.find((b) => b.id === formulaBlock.id)

    expect(updatedBlock).toBeDefined()
    expect(updatedBlock?.type).toBe('formula')
    if (updatedBlock && updatedBlock.type === 'formula') {
      expect(updatedBlock.accessibleText).toContain('a')
      expect(updatedBlock.accessibleText).toContain('b')
    }

    expect(screen.queryByTestId('formula-edit-dialog')).toBeNull()
  })

  it('mounts FormulaAuthoringEditor when overlay formula is selected and commits changes', () => {
    const store = useEditorStore.getState()
    store.createNewFlowProject()

    const flow = useEditorStore.getState().flowSession
    expect(flow).not.toBeNull()
    if (!flow) return

    const doc = flow.history.present
    const flowSurface = doc.surfaces.find((s): s is FlowSurfaceDocument => s.type === 'flow')
    expect(flowSurface).toBeDefined()
    if (!flowSurface) return

    const formulaNode = createFormulaNode({
      id: 'overlay-formula-1',
      x: 100,
      y: 100,
      ast: { type: 'token', value: 'x' },
      accessibleText: 'x',
      formulaId: 'f-overlay-1',
      layer: 'overlay',
    })
    const layerItem = sceneNodeToCourseLayerItem(formulaNode)

    useEditorStore.setState((state) => {
      const activeFlow = state.flowSession!
      const currentDoc = activeFlow.history.present
      const updatedSurfaces = currentDoc.surfaces.map((s) => {
        if (s.id !== flowSurface.id) return s
        return {
          ...s,
          surfaceLayerItems: [
            ...(s.surfaceLayerItems ?? []),
            {
              item: layerItem,
              visibility: { mode: 'all' as const, locationIds: [] },
            },
          ],
        }
      })
      const nextDoc = {
        ...currentDoc,
        surfaces: updatedSurfaces,
      }
      return {
        flowSession: {
          ...activeFlow,
          history: {
            ...activeFlow.history,
            present: nextDoc,
          },
          selection: {
            ...activeFlow.selection,
            focus: 'overlay',
            selectedBlockId: null,
            selectedBlockIds: [],
            selectedOverlayIds: ['overlay-formula-1'],
          },
        },
      }
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    expect(screen.getByTestId('flow-formula-properties')).toBeDefined()
    expect(screen.getByTestId('formula-authoring-editor')).toBeDefined()

    const input = screen.getByRole('textbox', { name: '公式内容（线性输入）' })
    fireEvent.change(input, { target: { value: 'c+d' } })

    const applyButton = screen.getByRole('button', { name: '应用公式' })
    fireEvent.click(applyButton)

    const updatedDoc = useEditorStore.getState().flowSession?.history.present
    const updatedSurface = updatedDoc?.surfaces.find((s): s is FlowSurfaceDocument => s.id === flowSurface.id)
    const overlay = updatedSurface?.surfaceLayerItems?.find((item) => item.item.layerItemId === 'overlay-formula-1')
    expect(overlay).toBeDefined()
    if (overlay && overlay.item.kind === 'native' && overlay.item.content.nativeType === 'formula') {
      expect(overlay.item.content.data.accessibleText).toContain('c')
      expect(overlay.item.content.data.accessibleText).toContain('d')
    }
  })
})
