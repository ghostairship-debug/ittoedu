import { frameCorners, multiplyMatrices, type AffineMatrix, type GeometryPoint } from '../../../core/components/geometry'
import { freeSelectionBounds, type FreeObjectTarget, type FreeResizeHandle } from '../../componentPlatform/surfaces/slide'

export function slideSelectionChrome(targets: readonly FreeObjectTarget[], scale = 1) {
  if (!targets.length) return null
  const bounds = freeSelectionBounds(targets)!
  const corners = targets.length === 1 ? frameCorners(targets[0].frame, targets[0].parentToSurface) : [
    { x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top },
    { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom },
  ]
  const [nw, ne, se, sw] = corners
  const mid = (a: GeometryPoint, b: GeometryPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const n = mid(nw, ne), s = mid(sw, se), center = mid(n, s)
  const length = Math.hypot(n.x - center.x, n.y - center.y)
  const distance = 28 / scale
  const rotation = length ? { x: n.x + (n.x - center.x) / length * distance, y: n.y + (n.y - center.y) / length * distance } : { x: n.x, y: n.y - distance }
  return { corners, points: { nw, n, ne, e: mid(ne, se), se, s, sw, w: mid(nw, sw), rotate: rotation } }
}
/** Chrome only. All handles route through the workspace's single affine owner. */
export function SlideLayerSelectionOverlay({ targets, scale, surfaceToPointer, lineHandles }: { targets: readonly FreeObjectTarget[]; scale: number; surfaceToPointer?: AffineMatrix; lineHandles?: boolean }) {
  const overlay = slideSelectionChrome(surfaceToPointer ? targets.map(target => ({ ...target, parentToSurface: multiplyMatrices(surfaceToPointer, target.parentToSurface) })) : targets, surfaceToPointer ? 1 : scale)
  if (!overlay) return null
  const pixelScale = surfaceToPointer ? 1 : scale
  const size = 8 / pixelScale
  return <div className="teacher-controller-overlay" data-testid="slide-layer-selection-overlay" aria-hidden="true" style={{ position: surfaceToPointer ? 'fixed' : 'absolute', inset: 0, pointerEvents: 'none' }}>
    <svg width="100%" height="100%" style={{ overflow: 'visible', position: 'absolute' }}>
      <polygon points={overlay.corners.map(p => p.x + ',' + p.y).join(' ')} fill="none" stroke="#2563eb" strokeWidth={1 / pixelScale} />
      <line x1={overlay.points.n.x} y1={overlay.points.n.y} x2={overlay.points.rotate.x} y2={overlay.points.rotate.y} stroke="#2563eb" strokeWidth={1 / pixelScale} />
    </svg>
    {(Object.entries(overlay.points) as [FreeResizeHandle | 'rotate', GeometryPoint][]).filter(([direction]) => !lineHandles || direction === 'rotate').map(([direction, p]) => <div key={direction}
      className="teacher-controller-overlay__handle" data-handle={direction}
      style={{ position: surfaceToPointer ? 'fixed' : 'absolute', left: p.x - size / 2, top: p.y - size / 2, width: size, height: size,
        pointerEvents: 'auto', borderRadius: direction === 'rotate' ? '50%' : undefined }} />)}
  </div>
}
