import {
  constrainTeacherControllerAuthoringFrame,
  teacherControllerAuthoringRecoveryBounds,
  type TeacherControllerLayoutSource,
} from './teacherControllerLayout'

export interface FlowPoint { readonly x: number; readonly y: number }
export interface FlowSize { readonly width: number; readonly height: number }
export interface FlowRect extends FlowPoint, FlowSize {}

/** View-only controller projection shared by Flow overlay display and hit-testing. */
export function projectFlowControllerOverlayFrame(
  source: TeacherControllerLayoutSource,
  frame: FlowRect,
  rotation: number,
  viewport: FlowSize,
): FlowRect {
  return constrainTeacherControllerAuthoringFrame(source, frame, rotation, viewport)
}

/** Client-space recovery bounds for a controller projected into the overlay viewport. */
export function flowControllerOverlayRecoveryBounds(
  source: TeacherControllerLayoutSource,
  frame: FlowRect,
  rotation: number,
  viewport: FlowSize,
) {
  const projected = projectFlowControllerOverlayFrame(source, frame, rotation, viewport)
  return teacherControllerAuthoringRecoveryBounds(source, projected, rotation)
}

/** Minimum view-only translation to reveal a selection; oversized content stays at 1:1. */
export function revealFlowSelectionPan(bounds: FlowRect, viewport: FlowSize, current: FlowPoint, margin = 16): FlowPoint {
  const move = (start: number, size: number, available: number) => {
    const inset = Math.min(margin, Math.max(0, available / 2 - 1))
    const end = available - inset
    if (size <= end - inset) return start < inset ? inset - start : start + size > end ? end - start - size : 0
    return start > inset ? inset - start : start + size < end ? end - start - size : 0
  }
  return { x: current.x + move(bounds.x, bounds.width, viewport.width), y: current.y + move(bounds.y, bounds.height, viewport.height) }
}

/** D1: responsive layout uses CSS pixels; observation never changes layout size. */
export function createFlowViewportGeometry(input: {
  readonly viewportClientRect: FlowRect
  readonly layoutViewportSize: FlowSize
  readonly paperOriginLayout: FlowPoint
  readonly paperScrollLayout: FlowPoint
  readonly baseScale?: number
  readonly playbackZoom?: number
  readonly playbackPanClient?: FlowPoint
}) {
  const scale = (input.baseScale ?? 1) * (input.playbackZoom ?? 1)
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid Flow viewport scale')
  const pan = input.playbackPanClient ?? { x: 0, y: 0 }
  const origin = {
    x: input.viewportClientRect.x + pan.x,
    y: input.viewportClientRect.y + pan.y,
  }
  const paperToViewport = (point: FlowPoint): FlowPoint => ({
    x: input.paperOriginLayout.x + point.x - input.paperScrollLayout.x,
    y: input.paperOriginLayout.y + point.y - input.paperScrollLayout.y,
  })
  const viewportToPaper = (point: FlowPoint): FlowPoint => ({
    x: point.x - input.paperOriginLayout.x + input.paperScrollLayout.x,
    y: point.y - input.paperOriginLayout.y + input.paperScrollLayout.y,
  })
  const viewportToClient = (point: FlowPoint): FlowPoint => ({
    x: origin.x + scale * point.x,
    y: origin.y + scale * point.y,
  })
  const clientToViewport = (point: FlowPoint): FlowPoint => ({
    x: (point.x - origin.x) / scale,
    y: (point.y - origin.y) / scale,
  })
  const topLeft = clientToViewport(input.viewportClientRect)
  return {
    scale,
    layoutViewportSize: input.layoutViewportSize,
    clipClientRect: input.viewportClientRect,
    visibleViewportBounds: {
      ...topLeft,
      width: input.viewportClientRect.width / scale,
      height: input.viewportClientRect.height / scale,
    },
    paperToViewport,
    viewportToPaper,
    viewportToClient,
    clientToViewport,
    paperToClient: (point: FlowPoint) => viewportToClient(paperToViewport(point)),
    clientToPaper: (point: FlowPoint) => viewportToPaper(clientToViewport(point)),
  }
}

/** Measure before observation transforms, preserving the paper's unscrolled origin. */
export function measureFlowPaperOrigin(
  viewport: HTMLElement,
  scroll: HTMLElement,
  paper: HTMLElement,
  scale = 1,
  pan: FlowPoint = { x: 0, y: 0 },
): FlowPoint {
  const viewportRect = viewport.getBoundingClientRect()
  const paperRect = paper.getBoundingClientRect()
  if (viewportRect.width <= 0 || paperRect.width <= 0) return { x: 0, y: 0 }
  return {
    x: (paperRect.left - viewportRect.left - pan.x) / scale + scroll.scrollLeft,
    y: (paperRect.top - viewportRect.top - pan.y) / scale + scroll.scrollTop,
  }
}
