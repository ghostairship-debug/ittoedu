import { useEffect, useState } from 'react'
import type { ComponentInstance } from '../../../shared/contracts/component-platform/project'
import type { ImageData } from '../../../components/image/data'
import { clampCrop, cropGeometry } from '../../../shared/imageCrop'

export type FlowImageCropPatch = Pick<ImageData, 'crop' | 'cropX' | 'cropY'>
const EDGES = [{ key: 'left', label: '左裁剪' }, { key: 'right', label: '右裁剪' }, { key: 'top', label: '上裁剪' }, { key: 'bottom', label: '下裁剪' }] as const

/** Only the crop draft lives here; Confirm is committed by the captured instance's owner. */
export function FlowMediaCropEditor({ instance, imageData, url, onConfirm, onCancel }: {
  instance: ComponentInstance; imageData: ImageData; url?: string
  onConfirm(patch: FlowImageCropPatch): void | Promise<void>; onCancel(): void
}) {
  const [draft, setDraft] = useState<FlowImageCropPatch>({ crop: imageData.crop, cropX: imageData.cropX, cropY: imageData.cropY })
  const [natural, setNatural] = useState({ width: 1, height: 1 })
  const [confirming, setConfirming] = useState(false), [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft({ crop: imageData.crop, cropX: imageData.cropX, cropY: imageData.cropY }) },
    [instance.id, imageData.assetId, imageData.crop, imageData.cropX, imageData.cropY])
  const width = instance.frame?.width ?? 480, height = instance.frame?.height ?? width * natural.height / natural.width
  const geometry = cropGeometry({ ...imageData, ...draft, frame: { width, height }, source: natural }).whole
  const filters = imageData.filters
  const confirm = async () => {
    if (confirming) return
    setConfirming(true); setError(null)
    try { await onConfirm({ ...draft, crop: clampCrop(draft.crop) }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setConfirming(false) }
  }
  return <div role="dialog" aria-label="裁剪正文图片" onKeyDown={event => { if (event.key === 'Escape' && !confirming) { event.stopPropagation(); onCancel() } }}>
    <div style={{ width: '100%', aspectRatio: `${width}/${height}`, overflow: 'hidden', position: 'relative', borderRadius: imageData.cornerRadius,
      filter: `brightness(${filters.brightness}) contrast(${filters.contrast}) saturate(${filters.saturation}) grayscale(${filters.grayscale}) blur(${filters.blur}px)` }}>
      <img src={url} alt={imageData.alt} draggable={false} onLoad={event => setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={{ position: 'absolute', maxWidth: 'none', left: `${geometry.x / width * 100}%`, top: `${geometry.y / height * 100}%`, width: `${geometry.width / width * 100}%`, height: `${geometry.height / height * 100}%`,
          transformOrigin: '0 0', transform: `translate(${imageData.flipX ? '100%' : '0'}, ${imageData.flipY ? '100%' : '0'}) scale(${imageData.flipX ? -1 : 1}, ${imageData.flipY ? -1 : 1})` }} />
    </div>
    {EDGES.map(({ key, label }) => <label key={key}>{label}<input aria-label={label} type="range" min={0} disabled={confirming}
      max={Math.max(0, 0.98 - draft.crop[key === 'left' ? 'right' : key === 'right' ? 'left' : key === 'top' ? 'bottom' : 'top'])}
      step={0.01} value={draft.crop[key]} onChange={event => { const value = Number(event.currentTarget.value); setDraft(current => ({ ...current, crop: { ...current.crop, [key]: value } })) }} /></label>)}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={confirming} onClick={onCancel}>取消</button>
    <button type="button" disabled={confirming} onClick={() => { void confirm() }}>确认裁剪</button>
  </div>
}
