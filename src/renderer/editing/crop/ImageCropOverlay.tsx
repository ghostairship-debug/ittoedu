import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { commitCrop, cropGeometry, dragCropBox, type CropEdges, type CropHandle, type CropImage, type CropRect } from './imageCrop'
import './imageCrop.css'

const HANDLES: readonly CropHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const HANDLE_LABEL: Record<CropHandle, string> = { nw: '左上', n: '上', ne: '右上', e: '右', se: '右下', s: '下', sw: '左下', w: '左' }

/**
 * Cropping an image on the canvas (M21): the whole source image shows faintly around the part kept; the handles move
 * the kept part's edges. 完成 (or Enter, or a press outside) makes it the image's new frame and crop in one step.
 */
export function ImageCropOverlay({ screen, image, source, onCommit, onCancel }: {
  /** The image's frame on screen. */
  screen: { left: number; top: number; width: number; height: number }
  image: CropImage & { frame: CropRect }
  /** The image file, drawn whole behind the kept part (an outline when it is not loaded). */
  source: { bytes: Uint8Array | null; mimeType: string }
  onCommit(result: { frame: CropRect; crop: CropEdges }): void
  onCancel(): void
}) {
  const imageUrl = useMemo(() => source.bytes ? URL.createObjectURL(new Blob([source.bytes as BlobPart], { type: source.mimeType })) : null, [source.bytes, source.mimeType])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  const geometry = useMemo(() => cropGeometry(image), [image])
  const [box, setBox] = useState<CropRect>(geometry.shown)
  const scale = screen.width / Math.max(1, image.frame.width)
  const toScreen = (rect: CropRect) => ({ left: screen.left + rect.x * scale, top: screen.top + rect.y * scale, width: rect.width * scale, height: rect.height * scale })
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
    setBox(dragCropBox(current.start, current.handle, (event.clientX - current.x) / scale, (event.clientY - current.y) / scale, geometry.whole, 8 / scale))
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const whole = toScreen(geometry.whole), kept = toScreen(box)
  const flip = `scale(${image.flipX ? -1 : 1}, ${image.flipY ? -1 : 1})`
  const barBelow = kept.top + kept.height + 44 < window.innerHeight
  return createPortal(<div className="image-crop" role="dialog" aria-label="裁剪图片" onContextMenu={event => event.preventDefault()}>
    {/* A press outside the kept part finishes, as clicking away from a crop does. */}
    <div className="image-crop__backdrop" data-testid="image-crop-backdrop" onPointerDown={event => { event.preventDefault(); commit() }} />
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
        data-handle={handle} onPointerDown={start(handle)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />)}
    </div>
    <div className="image-crop__bar" role="toolbar" aria-label="裁剪" style={{ left: kept.left, top: barBelow ? kept.top + kept.height + 8 : Math.max(4, kept.top - 40) }}>
      <button type="button" onClick={commit}>完成</button>
      <button type="button" onClick={() => setBox(geometry.whole)}>显示整张图</button>
      <button type="button" onClick={cancel}>取消</button>
    </div>
  </div>, document.body)
}
