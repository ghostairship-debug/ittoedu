import { useState } from 'react'
import { applyStyleRemix, previewStyleRemix, type StyleRemixPreview } from '../../authoring/productivity/styleRemix'
import type { ProductivityDialogProps } from './ProductivityDialog'

export function StyleRemixForm({ getContext, getAssetFiles, onCommit, onClose }: ProductivityDialogProps) {
  const [sceneId, setSceneId] = useState('')
  const [slots, setSlots] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<StyleRemixPreview | null>(null)
  const [message, setMessage] = useState('')
  const context = getContext()
  const scene = context.document.surfaces.flatMap(s => s.type === 'slide' ? s.scenes : []).find(s => s.id === sceneId)
  const texts = scene?.layerItems.filter(i => i.kind === 'native' && i.content.nativeType === 'text') ?? []
  const generate = () => {
    try { setPreview(previewStyleRemix(getContext(), sceneId, slots)); setMessage('') }
    catch (error) { setMessage(error instanceof Error ? error.message : '无法预览') }
  }
  const commit = () => {
    if (!preview) return
    const result = applyStyleRemix(getContext(), preview, getAssetFiles())
    if (!result.ok) { setMessage(result.reason); return }
    if (result.step && onCommit(result.step)) onClose()
    else setMessage('工程已变化，请重新预览')
  }
  return <div>
    <p>保留参考页的可编辑布局，逐项填写替换文字。保持原文本框大小；内容放不下时请缩短文字，或先扩大参考页文本框。确认后新增独立副本，可整体撤销。</p>
    <label>样板来源 <select aria-label="样板来源" value={sceneId} onChange={e => { setSceneId(e.target.value); setSlots({}); setPreview(null); setMessage('') }}>
      <option value="">选择参考页</option>
      {context.document.surfaces.flatMap(s => s.type === 'slide' ? s.scenes.map(scene => <option key={scene.id} value={scene.id}>{s.title} / {scene.name}</option>) : [])}
    </select></label>
    {texts.map(item => <label key={item.layerItemId} style={{ display: 'block', marginBlock: 12 }}>
      {item.label} · 原文：{item.kind === 'native' && item.content.nativeType === 'text' ? item.content.data.text : ''}
      <textarea aria-label={`替换槽位 ${item.label}`} rows={2} style={{ display: 'block', width: '100%' }} value={slots[item.layerItemId] ?? ''}
        onChange={e => { setSlots(previous => ({ ...previous, [item.layerItemId]: e.target.value })); setPreview(null) }} />
    </label>)}
    <button type="button" onClick={generate} disabled={!sceneId}>预览样板改写</button>
    {preview && <div><p>骨架来源：{preview.sourceLabel}</p>
      <ul>{preview.slots.map(slot => <li key={slot.id}><strong>{slot.label}</strong><div>{slot.original} → {slot.replacement || '（未填写）'}</div><small>{slot.capacity}</small>{slot.issue && <p role="status">{slot.issue}</p>}</li>)}</ul>
      {preview.issues.map((issue, index) => <p key={index} role="status">{issue}</p>)}
      <button type="button" onClick={commit} disabled={!!preview.issues.length || preview.slots.some(slot => !!slot.issue)}>确认新增改写页</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>
}
