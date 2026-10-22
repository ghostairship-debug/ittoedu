import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaFileEditor } from '../../src/renderer/documentFiles/media/MediaFileEditor'
import type { FileArtifactBinding, MediaFileOperation, MediaFileSnapshot } from '../../src/shared/workbench/mediaFiles'

vi.mock('../../src/renderer/documentFiles/media/PdfPagePreview', () => ({ PdfPagePreview: () => null }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps coalesced ink samples and appends only newly drawn points once per frame before one draft operation', async () => {
  const frames = new Map<number, FrameRequestCallback>(); let frame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:ink' }; static revokeObjectURL() {} })
  const snapshot: MediaFileSnapshot = { binding: { path: 'D:/picture.png', fileVersion: '1', bindingVersion: 1 },
    content: { kind: 'image', bytes: new Uint8Array([1]), mimeType: 'image/png', width: 100, height: 100, editable: true } }
  const preview = vi.fn(async (_binding: FileArtifactBinding, _operations: readonly MediaFileOperation[]) => snapshot)
  render(<MediaFileEditor snapshot={snapshot} port={{ preview, save: async () => snapshot, reload: async () => snapshot }} />)
  fireEvent.click(screen.getByRole('button', { name: '画笔' }))
  const svg = screen.getByLabelText('拖动选择编辑区域') as unknown as SVGSVGElement
  const points: Array<{ x: number; y: number }> = []
  const appendItem = vi.fn((point: { x: number; y: number }) => { points.push({ ...point }); return point })
  const clear = vi.fn(() => { points.length = 0 })
  Object.defineProperties(svg.querySelector('polyline')!, { points: { value: { appendItem, clear } } })
  Object.defineProperties(svg, { createSVGPoint: { value: () => ({ x: 0, y: 0 }) },
    setPointerCapture: { value: vi.fn() }, releasePointerCapture: { value: vi.fn() } })
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect)
  const pointer = (type: string, x: number, coalesced?: number[]) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: x })
    Object.defineProperties(event, { pointerId: { value: 1 },
      getCoalescedEvents: { value: () => coalesced?.map(value => ({ clientX: value, clientY: value })) ?? [] } })
    fireEvent(svg, event)
  }
  const tick = () => act(() => { const ready = [...frames.values()]; frames.clear(); ready.forEach(callback => callback(0)) })
  pointer('pointerdown', 0)
  pointer('pointermove', 20, [10, 20]); pointer('pointermove', 30)
  expect(frames.size).toBe(1); expect(appendItem).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled()
  tick(); expect(points.map(point => point.x)).toEqual([0, 0.1, 0.2, 0.3])
  pointer('pointermove', 40); tick()
  expect(appendItem).toHaveBeenCalledTimes(5)
  await act(async () => { pointer('pointerup', 50) })
  expect(preview).toHaveBeenCalledTimes(1)
  expect(preview.mock.calls[0]![1]).toEqual([{ type: 'image.ink',
    points: [0, 0.1, 0.2, 0.3, 0.4, 0.5].map(value => ({ x: value, y: value })), color: '#e14747', strokeWidth: 0.006 }])
  expect(frames.size).toBe(0); expect(points).toHaveLength(0)
})
