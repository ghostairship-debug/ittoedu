import { useEffect, useState } from 'react'
import './material-library.css'
import type { MaterialRecordV1, MaterialRequest } from '../../shared/materialContract'

export function MaterialLibraryDialog({ projectId, projectPath, onClose, onInsert }: {
  projectId: string; projectPath: string | null; onClose(): void; onInsert(material: MaterialRecordV1): Promise<void>
}) {
  const [records, setRecords] = useState<MaterialRecordV1[]>([])
  const [query, setQuery] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<MaterialRecordV1 | null>(null)
  const call = (request: MaterialRequest) => {
    if (!window.desktopAPI?.materials) throw new Error('本地材料需要桌面应用，请保存工程后使用。')
    return window.desktopAPI.materials(request)
  }
  useEffect(() => {
    let active = true
    setRecords([]); setSelected(null); setError('')
    if (projectPath) {
      Promise.resolve().then(() => call({ operation: 'search', projectId, projectPath, query }))
        .then(result => { if (active) setRecords(result) })
        .catch(reason => { if (active) setError(String(reason instanceof Error ? reason.message : reason)) })
    }
    return () => { active = false }
  }, [projectId, projectPath, query])
  async function operate(operation: MaterialRequest) {
    setBusy(true); setError('')
    try {
      const result = await call(operation)
      if (operation.operation === 'locate') setSelected(result[0] ?? null)
      else {
        setRecords(await call({ operation: 'search', projectId, projectPath: projectPath!, query }))
        if (operation.operation === 'delete' || operation.operation === 'clear') setSelected(null)
        if (operation.operation === 'import-text') { setText(''); setTitle(''); setSource('') }
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const workspace = { projectId, projectPath: projectPath ?? '' }
  return <div className="modal-backdrop" role="presentation">
    <section className="modal material-library" role="dialog" aria-modal="true" aria-label="教学材料库" style={{ width: 840, maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2>教学材料库</h2><button onClick={onClose} type="button">关闭</button></header>
      <p>材料保存在本机，按工程文件隔离。另存为后使用独立材料库。</p>
      {!projectPath ? <p role="status">请先保存工程，再导入教学材料。</p> : <>
        <fieldset disabled={busy} style={{ display: 'grid', gap: 10, border: 0, padding: 0 }}>
          <legend>添加材料</legend>
          <label>标题<input value={title} onChange={event => setTitle(event.target.value)} maxLength={300} /></label>
          <label>来源定位<input value={source} onChange={event => setSource(event.target.value)} placeholder="例如：教材第 12 页" maxLength={4096} /></label>
          <label>材料正文<textarea value={text} onChange={event => setText(event.target.value)} rows={4} style={{ width: '100%' }} /></label>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" disabled={!title.trim() || !text.trim() || !source.trim()} onClick={() => void operate({ ...workspace, operation: 'import-text', input: { title, text, source: { kind: 'text', locator: source } } })}>保存文本材料</button>
            <button type="button" onClick={() => void operate({ ...workspace, operation: 'import-file' })}>从文件导入（TXT / MD / CSV）</button>
          </div>
        </fieldset>
        <hr />
        <label>搜索标题、正文或来源<input value={query} onChange={event => setQuery(event.target.value)} /></label>
        <p>{records.length} 条材料</p>
        <ul style={{ paddingLeft: 20 }}>{records.map(record => <li key={record.id} style={{ marginBottom: 16 }}>
          <strong>{record.title}</strong><p style={{ margin: '4px 0' }}>{record.source.locator}</p>
          <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>{record.text.slice(0, 180)}{record.text.length > 180 ? '…' : ''}</p>
          <button disabled={busy} type="button" onClick={() => void operate({ ...workspace, operation: 'locate', id: record.id })}>查看原文{record.source.kind === 'file' ? '与文件位置' : ''}</button>{' '}
          <button disabled={busy} type="button" onClick={() => {
            setBusy(true); setError('')
            void onInsert(record).then(onClose).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(false))
          }}>插入正文与来源</button>{' '}
          <button disabled={busy} type="button" onClick={() => void operate({ ...workspace, operation: 'delete', id: record.id })}>删除材料</button>
        </li>)}</ul>
        {records.length > 0 && <button disabled={busy} type="button" onClick={() => void operate({ ...workspace, operation: 'clear' })}>清空当前工程材料</button>}
        {selected && <article><h3>{selected.title}</h3><p>{selected.source.locator}</p><pre style={{ whiteSpace: 'pre-wrap' }}>{selected.text}</pre></article>}
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
  </div>
}
