import { describe, expect, it } from 'vitest'
import { createFlowViewportGeometry, revealFlowSelectionPan } from '@/shared/flowViewportGeometry'

describe('Flow responsive document geometry', () => {
  it('reveals right/bottom content with minimum view translation and keeps oversized content at 1:1', () => {
    const pan = revealFlowSelectionPan({ x: 1150, y: 660, width: 200, height: 100 }, { width: 600, height: 450 }, { x: 0, y: 0 })
    expect(pan).toEqual({ x: -766, y: -326 })
    const geometry = createFlowViewportGeometry({ viewportClientRect: { x: 0, y: 0, width: 600, height: 450 },
      layoutViewportSize: { width: 600, height: 450 }, paperOriginLayout: { x: 24, y: 24 }, paperScrollLayout: { x: 0, y: 180 }, playbackPanClient: pan })
    expect(geometry.clientToViewport(geometry.viewportToClient({ x: 1150, y: 660 }))).toEqual({ x: 1150, y: 660 })
    expect(revealFlowSelectionPan({ x: 16, y: 16, width: 1200, height: 900 }, { width: 600, height: 450 }, pan)).toEqual(pan)
  })
  it.each([0.5, 1, 2])('round trips paper coordinates at zoom %s with scroll and pan applied once', zoom => {
    const geometry = createFlowViewportGeometry({
      viewportClientRect: { x: 45, y: 90, width: 847, height: 721 },
      layoutViewportSize: { width: 847, height: 721 },
      paperOriginLayout: { x: 116, y: 24 },
      paperScrollLayout: { x: 17, y: 420 },
      playbackZoom: zoom,
      playbackPanClient: { x: -38, y: 62 },
    })
    const point = { x: 80, y: 600 }
    expect(geometry.paperToViewport(point)).toEqual({ x: 179, y: 204 })
    expect(geometry.paperToClient(point)).toEqual({ x: 7 + zoom * 179, y: 152 + zoom * 204 })
    expect(geometry.clientToPaper(geometry.paperToClient(point))).toEqual(point)
    expect(geometry.clientToViewport(geometry.viewportToClient(point))).toEqual(point)
    expect(geometry.layoutViewportSize).toEqual({ width: 847, height: 721 })
    expect(geometry.clipClientRect.height).toBe(721)
  })

  it('does not letterbox portrait viewports or move viewport layers with paper scrolling', () => {
    const geometry = createFlowViewportGeometry({
      viewportClientRect: { x: 0, y: 0, width: 600, height: 900 },
      layoutViewportSize: { width: 600, height: 900 },
      paperOriginLayout: { x: 16, y: 24 },
      paperScrollLayout: { x: 0, y: 400 },
    })
    expect(geometry.viewportToClient({ x: 20, y: 0 })).toEqual({ x: 20, y: 0 })
    expect(geometry.paperToClient({ x: 20, y: 400 })).toEqual({ x: 36, y: 24 })
    expect(geometry.visibleViewportBounds).toEqual({ x: 0, y: 0, width: 600, height: 900 })
  })
})
