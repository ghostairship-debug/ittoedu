import { useEffect, useState } from 'react'
import type { ChangeReviewEntry, ChangeReviewPage, ChangeRollbackResult } from '../../main/workbench/review/ExecutionChangeReviewService'

export interface ExecutionChangeReviewProps {
  runId: string
  loadPage(input: { runId: string; offset: number; limit: number }): Promise<ChangeReviewPage>
  rollback(input: { runId: string; entryId: string }): Promise<ChangeRollbackResult>
  onLocateDocument?(documentId: string): void
}

const statusLabel: Record<ChangeReviewEntry['status'], string> = {
  applied: '已应用', unchanged: '未改动', partial: '部分完成', reported: '已返回', failed: '执行失败', unknown: '结果未知',
}
const availabilityLabel: Record<ChangeReviewEntry['availability'], string> = {
  ready: '可安全回退', conflict: '当前内容已改变', 'no-before-snapshot': '缺少修改前稿',
  unverified: '缺少提交证据', external: '需在外部核对', unsupported: '不可自动回退',
}
const PAGE_SIZE = 50

/** Per-file receipt review. A button always submits one new rollback request; no bulk/workspace-wide undo exists. */
export function ExecutionChangeReview({ runId, loadPage, rollback, onLocateDocument }: ExecutionChangeReviewProps) {
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<ChangeReviewPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ChangeRollbackResult>>({})

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setPage(null)
    void loadPage({ runId, offset, limit: PAGE_SIZE }).then(value => { if (active) setPage(value) })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '变更审阅暂不可读取') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [runId, offset, loadPage])

  const revert = async (entry: ChangeReviewEntry) => {
    if (busyEntry || entry.availability !== 'ready') return
    setBusyEntry(entry.entryId)
    try {
      const result = await rollback({ runId, entryId: entry.entryId })
      setResults(previous => ({ ...previous, [entry.entryId]: result }))
      setPage(await loadPage({ runId, offset, limit: PAGE_SIZE }))
    } catch (reason) {
      setResults(previous => ({ ...previous, [entry.entryId]: { entryId: entry.entryId, status: 'unknown',
        message: reason instanceof Error ? reason.message : '回退结果未知，请重新核对文件' } }))
    } finally { setBusyEntry(null) }
  }

  const byId = new Map(page?.entries.map(entry => [entry.entryId, entry]) ?? [])
  return <section className="execution-change-review" aria-label="本次变更审阅">
    <h3>本次变更</h3>
    <p>按文件核对已返回的宿主回执。回退会逐项执行，并在提交前检查当前版本。</p>
    {loading && <p role="status">正在读取变更记录…</p>}
    {error && <p role="alert">{error}</p>}
    {page && <>
      <p>共 {page.total} 项；当前显示第 {offset + 1}–{offset + page.entries.length} 项。</p>
      {page.files.map(file => <section key={file.path} aria-label={`文件变更：${file.path}`}>
        <h4>{file.path}</h4>
        {file.entryIds.map(id => {
          const entry = byId.get(id)
          if (!entry) return null
          const outcome = results[id]
          return <article key={id} className="execution-timeline__card" data-review-entry={id}>
            <header><strong>{entry.name}</strong> · {statusLabel[entry.status]} · {availabilityLabel[entry.availability]}</header>
            {(entry.beforeVersion || entry.afterVersion) && <details><summary>版本与回执</summary>
              {entry.beforeVersion && <p>修改前版本：{entry.beforeVersion}</p>}
              {entry.afterVersion && <p>提交后版本：{entry.afterVersion}</p>}
            </details>}
            {entry.reason && <p>{entry.reason}</p>}
            {entry.documentId && onLocateDocument && <button type="button" onClick={() => onLocateDocument(entry.documentId!)}>定位文档</button>}
            {entry.preview && <details><summary>查看修改前后正文</summary>
              <h5>修改前</h5><pre>{entry.preview.before}</pre>
              <h5>当前提交结果</h5><pre>{entry.preview.after || '当前版本已改变，无法显示原提交后的正文。'}</pre>
              {entry.preview.truncated && <p>正文仅显示前 4,000 字符；完整修改前稿保留在本机回退记录中。</p>}
            </details>}
            {entry.availability === 'ready' && <button type="button" disabled={busyEntry !== null}
              onClick={() => void revert(entry)}>{busyEntry === id ? '正在核对并回退…' : '回退此项'}</button>}
            {outcome && <p role="status">{outcome.message}</p>}
          </article>
        })}
      </section>)}
      {!page.entries.length && <p>没有已返回的可审阅变更。</p>}
      <nav aria-label="变更分页">
        <button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
        <button type="button" disabled={page.nextOffset === undefined || loading} onClick={() => setOffset(page.nextOffset!)}>下一页</button>
      </nav>
    </>}
  </section>
}
