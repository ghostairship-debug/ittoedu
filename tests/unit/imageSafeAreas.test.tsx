import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import { imageNodeSchema } from '../../src/shared/contracts/native-v1'
import { createImageNode } from '../../src/renderer/project/nativeNodeFactories'
import { selectActiveScene, useEditorStore,
  selectActiveCourseProjectDocument,
  selectSelectedNodeId,
  selectSlideSceneList,
} from '../../src/renderer/store/editorStore'
import { PropertiesTab } from '../../src/renderer/ui/PropertiesTab'

afterEach(cleanup)

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

function addImage(): string {
  const store = useEditorStore.getState()
  store.addImageNode({
    id: 'asset-image',
    filename: 'image.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/image.png',
    byteLength: 4,
    width: 320,
    height: 180,
  }, new Uint8Array([1, 2, 3, 4]))
  return selectSelectedNodeId(useEditorStore.getState())!
}

describe('image safe-area metadata', () => {
  it('defaults native image input to an empty safe-area list and rejects overflow', () => {
    const image = createImageNode({ assetId: 'image' })
    const legacy = structuredClone(image) as unknown as Record<string, unknown>
    delete legacy.safeAreas
    expect(imageNodeSchema.parse(legacy)).toMatchObject({ safeAreas: [] })

    image.safeAreas = [{
      id: 'subject',
      label: '人物主体',
      x: 0.7,
      y: 0.1,
      width: 0.5,
      height: 0.8,
    }]
    expect(imageNodeSchema.safeParse(image)).toMatchObject({ success: false })
  })

  it('adds, edits, removes, and undoes a stable safe area from image properties', () => {
    const nodeId = addImage()
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '添加安全区' }))
    let node = selectActiveScene(useEditorStore.getState()).nodes.find(
      ({ id }) => id === nodeId,
    )
    expect(node?.type).toBe('image')
    if (node?.type !== 'image') throw new Error('Expected image node')
    expect(node.safeAreas).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^safe_area_/),
      label: '安全区 1',
      x: 0.1,
      width: 0.8,
    })])

    const left = screen.getByRole('slider', { name: '左侧位置' })
    fireEvent.change(left, { target: { value: '15' } })
    fireEvent.pointerUp(left)
    node = selectActiveScene(useEditorStore.getState()).nodes.find(
      ({ id }) => id === nodeId,
    )
    if (node?.type !== 'image') throw new Error('Expected image node')
    expect(node.safeAreas?.[0]!.x).toBe(0.15)

    act(() => { useEditorStore.getState().undo() })
    node = selectActiveScene(useEditorStore.getState()).nodes.find(
      ({ id }) => id === nodeId,
    )
    if (node?.type !== 'image') throw new Error('Expected image node')
    expect(node.safeAreas?.[0]!.x).toBe(0.1)

    fireEvent.click(screen.getByRole('button', { name: '删除安全区 安全区 1' }))
    node = selectActiveScene(useEditorStore.getState()).nodes.find(
      ({ id }) => id === nodeId,
    )
    if (node?.type !== 'image') throw new Error('Expected image node')
    expect(node.safeAreas).toEqual([])
  })

  it('does not let the editor exceed the 16-area schema limit', () => {
    const nodeId = addImage()
    useEditorStore.getState().updateNode(nodeId, {
      safeAreas: Array.from({ length: 16 }, (_, index) => ({
        id: `safe_area_${index}`,
        label: `安全区 ${index + 1}`,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
    })
    render(<PropertiesTab onReplaceImage={vi.fn()} />)

    const add = screen.getByRole('button', { name: '添加安全区' })
    expect(add).toBeDisabled()
    fireEvent.click(add)
    const node = selectActiveScene(useEditorStore.getState()).nodes.find(
      ({ id }) => id === nodeId,
    )
    expect(node?.type === 'image' ? node.safeAreas : []).toHaveLength(16)
    expect(courseProjectDocumentSchema.safeParse(selectActiveCourseProjectDocument(useEditorStore.getState())!).success)
      .toBe(true)
  })
})
