import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { DocumentHostAPI } from '../../shared/workbench/desktop'
import './workspaceRecoveryPanel.css'

type RecoveryAPI = Pick<DocumentHostAPI, 'recoverable' | 'restore' | 'discardRecovery' | 'subscribe'>
type RecoveryItem = { snapshot: DocumentSnapshot; restored: boolean; error: string | null }

export interface WorkspaceRecoveryPanelProps {
  api: RecoveryAPI
  onRestored(documentId: string): Promise<void>
}

function nameOf(snapshot: DocumentSnapshot): string {
  if (snapshot.binding.kind === 'file') return snapshot.binding.path.split(/[\\/]/).pop() || snapshot.binding.path
  if (snapshot.model.kind === 'course-v9') return `${snapshot.model.project.title}.h5lesson`
  return snapshot.binding.suggestedName
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** Main's recovery journals are the only source of draft discovery and mutation. */
export function WorkspaceRecoveryPanel({ api, onRestored }: WorkspaceRecoveryPanelProps) {
  const [items, setItems] = useState<RecoveryItem[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [deferred, setDeferred] = useState(false)
  const inFlight = useRef<string | null>(null)
  const request = useRef(0)
  const operationGeneration = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++request.current
    const generation = operationGeneration.current
    try {
      const recoverable = await api.recoverable()
      if (ticket !== request.current || generation !== operationGeneration.current) return
      setItems(current => {
        // React may apply this updater after a restore/discard has completed.
        if (ticket !== request.current || generation !== operationGeneration.current) return current
        const retained = current.filter(item => item.restored || item.snapshot.documentId === inFlight.current)
        const byId = new Map(retained.map(item => [item.snapshot.documentId, item]))
        return [...recoverable.map(snapshot => byId.get(snapshot.documentId) ?? { snapshot, restored: false, error: null }),
          ...retained.filter(item => !recoverable.some(snapshot => snapshot.documentId === item.snapshot.documentId))]
      })
      setLoadError(null)
    } catch (error) {
      if (ticket === request.current && generation === operationGeneration.current) setLoadError(message(error, '恢复稿列表暂时无法读取'))
    }
  }, [api])

  useEffect(() => {
    void refresh()
    const unsubscribe = api.subscribe(event => {
      if (event.type === 'closed') void refresh()
    })
    return () => { request.current++; unsubscribe() }
  }, [api, refresh])

  const navigate = async (documentId: string) => {
    try {
      await onRestored(documentId)
      setItems(current => current.filter(item => item.snapshot.documentId !== documentId))
    } catch (error) {
      setItems(current => current.map(item => item.snapshot.documentId === documentId
        ? { ...item, restored: true, error: `恢复稿已打开，但暂时无法定位：${message(error, '请重试打开')}` } : item))
    }
  }

  const restore = async (documentId: string, alreadyRestored: boolean) => {
    if (inFlight.current) return
    inFlight.current = documentId; operationGeneration.current++; setBusy(documentId); setConfirming(null)
    try {
      if (!alreadyRestored) {
        await api.restore(documentId)
        operationGeneration.current++
        setItems(current => current.map(item => item.snapshot.documentId === documentId ? { ...item, restored: true, error: null } : item))
      }
      await navigate(documentId)
    } catch (error) {
      setItems(current => current.map(item => item.snapshot.documentId === documentId
        ? { ...item, error: `恢复失败：${message(error, '请稍后重试')}` } : item))
    } finally { operationGeneration.current++; inFlight.current = null; setBusy(null) }
  }

  const discard = async (documentId: string) => {
    if (inFlight.current) return
    inFlight.current = documentId; operationGeneration.current++; setBusy(documentId)
    try {
      await api.discardRecovery(documentId)
      operationGeneration.current++
      setItems(current => current.filter(item => item.snapshot.documentId !== documentId))
      setConfirming(null)
    } catch (error) {
      setItems(current => current.map(item => item.snapshot.documentId === documentId
        ? { ...item, error: `丢弃失败：${message(error, '请稍后重试')}` } : item))
      setConfirming(null)
    } finally { operationGeneration.current++; inFlight.current = null; setBusy(null) }
  }

  if (!items.length && !loadError) return null
  if (deferred) return <div className="workspace-recovery-trigger">
    <button type="button" aria-expanded="false" aria-controls="workspace-recovery-panel-details" onClick={() => setDeferred(false)}>
      恢复稿（{items.length}）{loadError ? ' · 列表读取失败' : ''}
    </button>
  </div>
  return <aside id="workspace-recovery-panel-details" className="workspace-recovery-panel" aria-label="未保存文档的恢复稿">
    <div className="workspace-recovery-panel__header">
      <div><h2>发现未保存的恢复稿</h2><p>恢复稿保存在本机；恢复后仍需保存到文件。原文件若已移动或删除，可将恢复内容另存。</p></div>
      <div className="workspace-recovery-panel__header-actions">
        <button type="button" onClick={() => void refresh()}>刷新列表</button>
        <button type="button" onClick={() => { setConfirming(null); setDeferred(true) }}>稍后处理</button>
      </div>
    </div>
    {loadError && <p role="alert">{loadError}。请重试读取。</p>}
    <ul>{items.map(item => {
      const id = item.snapshot.documentId, name = nameOf(item.snapshot)
      return <li key={id}>
        <div><strong>{name}</strong><span>{item.snapshot.model.kind === 'course-v9' ? '课件' : 'Markdown 文档'} · {item.restored ? '已恢复，等待打开' : '尚未恢复'}</span>
          {item.snapshot.binding.kind === 'file' && <small title={item.snapshot.binding.path}>{item.snapshot.binding.path}</small>}</div>
        {item.error && <p role="alert">{item.error}</p>}
        {confirming === id && !item.restored ? <div className="workspace-recovery-panel__confirm">
          <span>只丢弃这份恢复稿，用户文件不会删除。确认丢弃？</span>
          <button type="button" disabled={busy !== null} onClick={() => setConfirming(null)}>取消</button>
          <button type="button" disabled={busy !== null} onClick={() => void discard(id)}>确认丢弃恢复稿</button>
        </div> : <div className="workspace-recovery-panel__actions">
          <button type="button" disabled={busy !== null} onClick={() => void restore(id, item.restored)}>{item.restored ? '打开已恢复稿' : '恢复并打开'}</button>
          {!item.restored && <button type="button" disabled={busy !== null} onClick={() => setConfirming(id)}>丢弃恢复稿</button>}
        </div>}
      </li>
    })}</ul>
  </aside>
}
