import { afterEach, expect, it, vi } from 'vitest'
import { addPptxTextNode } from '../../src/renderer/export/pptxTextAndShape'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'
function canvasContext(): CanvasRenderingContext2D {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    measureText: vi.fn(() => ({ width: 20 })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

afterEach(() => { vi.restoreAllMocks() })
  it('rasterizes only visibly emphasized PPTX text nodes', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      canvasContext(),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/png;base64,AA==',
    )
    const slide = {
      addImage: vi.fn(),
      addText: vi.fn(),
    }
    const scale = { x: 13.333 / 1280, y: 7.5 / 720 }

    addPptxTextNode(
      slide as never,
      createTextNode({ text: '着重', style: { emphasis: true } }),
      scale,
    )
    addPptxTextNode(
      slide as never,
      createTextNode({ text: '普通', style: { emphasis: false } }),
      scale,
    )
    addPptxTextNode(
      slide as never,
      createTextNode({
        text: '显式取消',
        runs: [{ start: 0, end: 4, style: { emphasis: false } }],
        style: { emphasis: true },
      }),
      scale,
    )

    expect(slide.addImage).toHaveBeenCalledTimes(1)
    expect(slide.addText).toHaveBeenCalledTimes(2)
  })