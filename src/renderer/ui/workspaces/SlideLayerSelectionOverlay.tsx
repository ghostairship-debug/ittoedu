import { STAGE_RESIZE_HANDLE_DIRECTIONS, type StageSelectionOverlayGeometry } from '../../authoring/stageViewportTransform'

/** Chrome only; hit testing and transactions stay in the canonical Slide controller. */
export function SlideLayerSelectionOverlay({ overlay }: { overlay: StageSelectionOverlayGeometry }) {
  const box = overlay.selectionBox
  return <div className="teacher-controller-overlay" data-testid="slide-layer-selection-overlay" aria-hidden="true">
    <div className="teacher-controller-overlay__box" style={{
      left: box.x, top: box.y, width: box.width, height: box.height,
      transform: `rotate(${overlay.rotation}deg)`,
    }} />
    {STAGE_RESIZE_HANDLE_DIRECTIONS.map(direction => <div
      key={direction}
      className="teacher-controller-overlay__handle"
      data-handle={direction}
      style={{ left: overlay.handles[direction].x - 4, top: overlay.handles[direction].y - 4 }}
    />)}
    <div className="teacher-controller-overlay__handle" data-handle="rotate" style={{
      left: overlay.rotationHandle.x - 4, top: overlay.rotationHandle.y - 4, borderRadius: '50%',
    }} />
  </div>
}
