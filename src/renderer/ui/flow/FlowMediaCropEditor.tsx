import { useEffect, useState } from 'react'
import type { FlowMediaBlock } from '../../../shared/contracts/course-project-v9/types'
import { flowMediaCropPatch, type FlowImageCrop } from '../../../shared/flowMediaCrop'
import { FlowPaperMedia } from './FlowPaperMedia'

type Edges = NonNullable<FlowImageCrop['crop']>
const EMPTY: Edges = { left: 0, top: 0, right: 0, bottom: 0 }
const EDGES: { key: keyof Edges; label: string }[] = [{ key: 'left', label: '左裁剪' }, { key: 'right', label: '右裁剪' }, { key: 'top', label: '上裁剪' }, { key: 'bottom', label: '下裁剪' }]

/** Holds only a local draft. The caller turns Confirm into one canonical block command. */
export function FlowMediaCropEditor({ block, url, onConfirm, onCancel }: { block: FlowMediaBlock; url?: string; onConfirm(patch: FlowImageCrop): void; onCancel(): void }) {
  const [draft, setDraft] = useState<FlowImageCrop>({ crop: block.crop ?? EMPTY, cropX: block.cropX ?? 0.5, cropY: block.cropY ?? 0.5 })
  useEffect(() => { setDraft({ crop: block.crop ?? EMPTY, cropX: block.cropX ?? 0.5, cropY: block.cropY ?? 0.5 }) }, [block.id, block.assetId, block.crop, block.cropX, block.cropY])
  if (block.mediaKind !== 'image') return null
  const edges = draft.crop ?? EMPTY
  const updateEdge = (key: keyof Edges, value: number) => setDraft(current => ({ ...current, crop: { ...(current.crop ?? EMPTY), [key]: value } }))
  return <div role="dialog" aria-label="裁剪正文图片" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onCancel() } }}>
    <FlowPaperMedia block={{ ...block, ...draft }} url={url} />
    {EDGES.map(({ key, label }) => <label key={key}>{label}<input type="range" min={0} max={Math.max(0, 0.98 - edges[key === 'left' ? 'right' : key === 'right' ? 'left' : key === 'top' ? 'bottom' : 'top'])} step={0.01} value={edges[key]} onChange={event => updateEdge(key, Number(event.currentTarget.value))} /></label>)}
    <button type="button" onClick={onCancel}>取消</button>
    <button type="button" onClick={() => onConfirm(flowMediaCropPatch(edges, draft.cropX, draft.cropY))}>确认裁剪</button>
  </div>
}
