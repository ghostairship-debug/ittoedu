import { useMemo, useRef, useState } from 'react'
import { applyStyleRemix, previewStyleRemix, type StyleRemixPreview } from '../../authoring/productivity/styleRemix'
import type { ProductivityDialogProps } from './ProductivityDialog'

export function StyleRemixForm({ getContext, getAssetFiles, onCommit, onClose, onBusyChange }: ProductivityDialogProps & { onBusyChange?(busy: boolean): void }) {
  const [surfaceId, setSurfaceId] = useState('')
  const [slots, setSlots] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<StyleRemixPreview | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const committing = useRef(false)
  const context = getContext()
  const { source, sourceIssue } = useMemo(() => {
    if (!surfaceId) return { source: null, sourceIssue: '' }
    try { return { source: previewStyleRemix(context, surfaceId, {}), sourceIssue: '' } }
    catch (error) { return { source: null, sourceIssue: error instanceof Error ? error.message : '无法读取参考页' } }
  }, [context.document, context.target, surfaceId])
  const generate = () => {
    try { setPreview(previewStyleRemix(getContext(), surfaceId, slots, { measure: true })); setMessage('') }
    catch (error) { setMessage(error instanceof Error ? error.message : '无法预览') }
  }
  const commit = async () => {
    if (!preview || committing.current) return
    const result = applyStyleRemix(getContext(), preview, getAssetFiles())
    if (!result.ok) { setMessage(result.reason); return }
    if (!result.step) { setMessage('没有可替换的文字槽位'); return }
    committing.current = true
    setBusy(true)
    onBusyChange?.(true)
    setMessage('')
    try { if (await onCommit(result.step)) onClose(); else setMessage('未能提交，请重新预览后重试') }
    catch (error) { setMessage(error instanceof Error ? error.message : '未能提交') }
    finally { committing.current = false; setBusy(false); onBusyChange?.(false) }
  }
  return <div>
    <p>保留参考页的可编辑布局，逐项填写替换文字。保持原文本框大小；副本创建后可继续调整文本框或文字。确认后新增独立副本，可整体撤销。</p>
    <label>样板来源 <select aria-label="样板来源" value={surfaceId} disabled={busy} onChange={e => { setSurfaceId(e.target.value); setSlots({}); setPreview(null); setMessage('') }}>
      <option value="">选择参考页</option>
      {context.document.surfaces.filter(surface => surface.kind === 'slide').map(surface => <option key={surface.id} value={surface.id}>{surface.title}</option>)}
    </select></label>
    {source?.slots.map(slot => <label key={slot.id} style={{ display: 'block', marginBlock: 12 }}>
      {slot.label} · 原文：{slot.original}
      <textarea aria-label={`替换槽位 ${slot.label}`} rows={2} style={{ display: 'block', width: '100%' }} value={slots[slot.id] ?? ''} disabled={busy}
        onChange={e => { setSlots(previous => ({ ...previous, [slot.id]: e.target.value })); setPreview(null); setMessage('') }} />
    </label>)}
    {sourceIssue && <p role="status">{sourceIssue}</p>}
    <button type="button" onClick={generate} disabled={busy || !source}>预览样板改写</button>
    {preview && <div><p>骨架来源：{preview.sourceLabel}</p>
      <ul>{preview.slots.map(slot => <li key={slot.id}><strong>{slot.label}</strong><div>{slot.original} → {slot.replacement || '（未填写）'}</div><small>{slot.capacity}</small>{slot.issue && <p role="status">{slot.issue}</p>}{slot.warning && <p role="status">{slot.warning}</p>}</li>)}</ul>
      {preview.issues.map((issue, index) => <p key={index} role="status">{issue}</p>)}
      <button type="button" onClick={commit} disabled={busy || !!sourceIssue || !preview.slots.length || preview.slots.some(slot => !!slot.issue)}>确认新增改写页</button>
    </div>}
    {message && <p role="status">{message}</p>}
  </div>
}
