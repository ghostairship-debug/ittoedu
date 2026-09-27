import { useEffect, useState } from 'react'

export interface HtmlImportDestination {
  locationId: string
  surfaceType: 'slide' | 'flow'
  label: string
  anchors?: readonly { blockId: string; label: string }[]
}

export function HtmlImportDialog({ sourceName, destinations, busy, error, onCancel, onImport }: {
  sourceName: string | null
  destinations: readonly HtmlImportDestination[]
  busy: boolean
  error: string | null
  onCancel(): void
  onImport(target: { locationId: string; anchorBlockId?: string }): void
}) {
  const [locationId, setLocationId] = useState(destinations[0]?.locationId ?? '')
  const [anchorBlockId, setAnchorBlockId] = useState('')
  const selected = destinations.find(target => target.locationId === locationId)
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [busy, onCancel])
  return <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!busy) onCancel() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="html-import-title" className="modal" onMouseDown={event => event.stopPropagation()} style={{ width: 'min(560px, 92vw)', padding: 24 }}>
      <h2 id="html-import-title">导入 HTML 页面</h2>
      <p>{sourceName ? `来源：${sourceName}` : '选择本地 HTML 文件，导入为可运行的互动页。'}</p>
      <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>目标页面
        <select aria-label="导入目标页面" value={locationId} disabled={busy} onChange={event => { setLocationId(event.target.value); setAnchorBlockId('') }}>
          {destinations.map(target => <option key={target.locationId} value={target.locationId}>
            {target.surfaceType === 'slide' ? '演示页' : '流式讲义'} · {target.label}
          </option>)}
        </select>
      </label>
      {selected?.surfaceType === 'flow' && <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>正文位置
        <select aria-label="HTML 正文位置" value={anchorBlockId} disabled={busy} onChange={event => setAnchorBlockId(event.target.value)}>
          <option value="">当前章节正文（自动）</option>
          {selected.anchors?.map(anchor => <option key={anchor.blockId} value={anchor.blockId}>在「{anchor.label}」之后</option>)}
        </select>
      </label>}
      {error && <p role="alert">{error}</p>}
      <div className="modal__actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</button>
        <button type="button" className="primary-button" disabled={busy || !selected} onClick={() => selected && onImport({ locationId: selected.locationId,
          ...(selected.surfaceType === 'flow' && anchorBlockId ? { anchorBlockId } : {}) })}>导入</button>
      </div>
    </section>
  </div>
}
