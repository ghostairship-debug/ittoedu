import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { commitCrop, cropGeometry, dragCropBox, type CropEdges, type CropHandle, type CropImage, type CropRect } from '../../../shared/imageCrop'
import { invertMatrix, transformPoint, type AffineMatrix } from '../../../core/components/geometry'
import './imageCrop.css'

const HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_LABEL: Record<CropHandle, string> = { nw: '左上', n: '上', ne: '右上', e: '右', se: '右下', s: '下', sw: '左下', w: '左' }

/**
 * Cropping an image on the canvas (M21): the whole source image shows faintly around the part kept; the handles move
 * the kept part's edges. 完成 (or Enter, or a press outside) makes it the image's new frame and crop in one step.
 */
export function ImageCropOverlay({ screen, sourceToClient, image, source, onCommit, onCancel }: {
  /** The image's frame on screen. */
  screen: { left: number; top: number; width: number; height: number }
  sourceToClient?: AffineMatrix
  image: CropImage & { frame: CropRect & { transform?: readonly number[] } }
  /** The image file, drawn whole behind the kept part (an outline when it is not loaded). */
  source: { bytes: Uint8Array | null; mimeType: string }
  onCommit(result: { frame: CropRect; crop: CropEdges }): void
  onCancel(): void
}) {
  const imageUrl = useMemo(() => source.bytes ? URL.createObjectURL(new Blob([source.bytes as BlobPart], { type: source.mimeType })) : null, [source.bytes, source.mimeType])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  const geometry = useMemo(() => cropGeometry(image), [image])
  const [box, setBox] = useState<CropRect>(geometry.shown)
  const matrix: AffineMatrix = sourceToClient ?? [screen.width / image.frame.width, 0, 0, screen.height / image.frame.height, screen.left, screen.top]
  const inverse = invertMatrix(matrix), scale = Math.hypot(matrix[0], matrix[1]), scaleY = Math.hypot(matrix[2], matrix[3])
  const localStyle = (rect: CropRect) => ({ left: rect.x, top: rect.y, width: rect.width, height: rect.height })
  const toScreen = (rect: CropRect) => {
    const points = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, { x: rect.x, y: rect.y + rect.height }, { x: rect.x + rect.width, y: rect.y + rect.height }].map(point => transformPoint(matrix, point))
    const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y))
    return { left, top, width: Math.max(...points.map(point => point.x)) - left, height: Math.max(...points.map(point => point.y)) - top }
  }
  const drag = useRef<{ handle: CropHandle; x: number; y: number; start: CropRect } | null>(null)
  const done = useRef(false)
  const latest = useRef({ box, onCommit, onCancel, image }); latest.current = { box, onCommit, onCancel, image }
  const commit = () => {
    if (done.current) return
    done.current = true
    latest.current.onCommit(commitCrop(latest.current.image, latest.current.box))
  }
  const cancel = () => {
    if (done.current) return
    done.current = true
    latest.current.onCancel()
  }
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel() }
      else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit() }
    }
    window.addEventListener('keydown', keys, true)
    return () => window.removeEventListener('keydown', keys, true)
  }, [])
  const start = (handle: CropHandle) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { handle, x: event.clientX, y: event.clientY, start: box }
  }
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    setBox(dragCropBox(current.start, current.handle, inverse[0] * dx + inverse[2] * dy, inverse[1] * dx + inverse[3] * dy, geometry.whole, 8 / Math.min(scale, scaleY)))
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const whole = localStyle(geometry.whole), kept = localStyle(box), keptScreen = toScreen(box)
  const flip = `scale(${image.flipX ? -1 : 1}, ${image.flipY ? -1 : 1})`
  const barBelow = keptScreen.top + keptScreen.height + 44 < window.innerHeight
  return createPortal(<div className="image-crop" role="dialog" aria-label="裁剪图片" onContextMenu={event => event.preventDefault()}>
    {/* A press outside the kept part finishes, as clicking away from a crop does. */}
    <div className="image-crop__backdrop" data-testid="image-crop-backdrop" onPointerDown={event => { event.preventDefault(); commit() }} />
    <div style={{ position: 'absolute', left: 0, top: 0, width: image.frame.width, height: image.frame.height, pointerEvents: 'none', transformOrigin: '0 0', transform: `matrix(${matrix.join(',')})` }}>
    {imageUrl
      ? <img className="image-crop__whole" src={imageUrl} alt="" draggable={false} style={{ ...whole, transform: flip }} />
      : <div className="image-crop__whole image-crop__whole--outline" style={whole} />}
    <div className="image-crop__clip" style={kept}>
      {imageUrl && <img className="image-crop__kept" src={imageUrl} alt="" draggable={false}
        style={{ left: whole.left - kept.left, top: whole.top - kept.top, width: whole.width, height: whole.height, transform: flip }} />}
    </div>
    <div className="image-crop__frame" data-testid="image-crop-box" style={kept}>
      {HANDLES.map(handle => <span key={handle} className={`image-crop__handle image-crop__handle--${handle}`} role="slider"
        aria-label={`裁剪${HANDLE_LABEL[handle]}边`} aria-valuenow={Math.round(handle.includes('w') || handle.includes('e') ? box.width : box.height)}
        style={{ boxSizing: 'border-box', width: 12 / scale, height: 12 / scaleY, marginLeft: -6 / scale, marginTop: -6 / scaleY, borderWidth: 2 / Math.max(scale, scaleY) }}
        data-handle={handle} onPointerDown={start(handle)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />)}
    </div>
    </div>
    <div className="image-crop__bar" role="toolbar" aria-label="裁剪" style={{ left: keptScreen.left, top: barBelow ? keptScreen.top + keptScreen.height + 8 : Math.max(4, keptScreen.top - 40) }}>
      <button type="button" onClick={commit}>完成</button>
      <button type="button" onClick={() => setBox(geometry.whole)}>显示整张图</button>
      <button type="button" onClick={cancel}>取消</button>
    </div>
  </div>, document.body)
}
