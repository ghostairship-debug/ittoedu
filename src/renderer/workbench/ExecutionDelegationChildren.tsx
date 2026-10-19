import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExecutionDesktopAPI } from '../../shared/workbench/executionDesktop'
import type { ExecutionDelegationChildDetail, ExecutionDelegationChildIdentity, ExecutionDelegationChildView } from '../../shared/workbench/delegation'
import { foldExecutionEvents } from '../../shared/workbench/executionEvents'
import { ExecutionTimeline } from './ExecutionTimeline'
import { readableExecutionData } from './executionTimelineModel'
import './executionDelegationChildren.css'

const childKey = (child: Pick<ExecutionDelegationChildView, 'parentRunId' | 'jobId'>) => `${child.parentRunId}:${child.jobId}`
const statusLabel = (status: string) => ({ preparing: '准备中', queued: '等待中', running: '进行中', stopping: '正在停止',
  stopped: '已停止', cancelled: '已停止', ready: '候选已就绪', completed: '本轮已结束', partial: '部分完成',
  failed: '失败', interrupted: '已中断', unknown: '结果待确认', unconfigured: '尚未配置' } as Record<string, string>)[status] ?? status
type ChildSubmission = { action: 'message' | 'resume'; text: string; id: string }
export interface ExecutionDelegationInteraction {
  drafts: Record<string, string>
  busyChildren: ReadonlySet<string>
  pendingSubmissions: Map<string, ChildSubmission>
}
export const createExecutionDelegationInteraction = (): ExecutionDelegationInteraction => ({ drafts: {}, busyChildren: new Set(), pendingSubmissions: new Map() })

interface ChildDetailProps {
  api: ExecutionDesktopAPI
  identity: ExecutionDelegationChildIdentity
  view: ExecutionDelegationChildView
  pendingSubmissions: Map<string, ChildSubmission>
  draft: string
  busy: boolean
  onDraft(text: string): void
  onAcceptedDraft(text: string): void
  onBusy(busy: boolean): void
  onView(view: ExecutionDelegationChildView): void
  onClose(): void
}

function ChildDetail({ api, identity, view, pendingSubmissions, draft, busy, onDraft, onAcceptedDraft, onBusy, onView, onClose }: ChildDetailProps) {
  const [detail, setDetail] = useState<ExecutionDelegationChildDetail | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [artifact, setArtifact] = useState<{ name: string; byteLength: number; text: string | null } | null>(null)
  const [artifactBusy, setArtifactBusy] = useState(false)
  const refreshRef = useRef<() => void>(() => {})
  const onViewRef = useRef(onView); onViewRef.current = onView
  const scope = `${identity.workspaceId}:${identity.conversationId}:${identity.parentRunId}:${identity.jobId}`
  useEffect(() => {
    let disposed = false, reading = false, pending = false
    let current: ExecutionDelegationChildDetail | null = null
    const refresh = () => {
      pending = true
      if (reading || disposed || !api.delegationChild) return
      reading = true
      void (async () => {
        while (pending && !disposed) {
          pending = false
          const next = await api.delegationChild!(identity)
          if (disposed) return
          if (current && current.projection.conversationId === next.projection.conversationId && current.projection.cursor > next.projection.cursor)
            next.projection = current.projection
          current = next; setDetail(next); setLoading(false); setError(''); onViewRef.current(next.view)
        }
      })().catch(() => { if (!disposed) { setLoading(false); setError('子任务详情暂不可读取，请重试。') } })
        .finally(() => { reading = false; if (pending && !disposed) refresh() })
    }
    refreshRef.current = refresh
    const unsubscribe = api.subscribe(event => {
      if (event.runId !== (current?.view.childRunId ?? view.childRunId)) return
      if (current && event.conversationId === current.projection.conversationId && event.sequence === current.projection.cursor + 1) {
        current = { ...current, projection: foldExecutionEvents(current.projection, [event]) }; setDetail(current)
      } else if (!current || event.sequence > current.projection.cursor) refresh()
      if (['run.state', 'run.end', 'tool'].includes(event.type)) refresh()
    })
    refresh()
    return () => { disposed = true; unsubscribe(); refreshRef.current = () => {} }
  }, [api, scope, view.childRunId])

  const current = detail?.view ?? view
  const terminal = current.terminal || current.stopped
  const perform = async (action: 'stop' | 'message' | 'resume') => {
    if (busy) return
    const text = draft.trim()
    if (action !== 'stop' && !text) return
    onBusy(true); setError(''); setNotice('')
    try {
      let next: ExecutionDelegationChildView
      if (action === 'stop') next = await api.delegationStop!(identity)
      else {
        let submission = pendingSubmissions.get(scope)
        if (submission?.action !== action || submission.text !== text) {
          submission = { action, text, id: crypto.randomUUID() }; pendingSubmissions.set(scope, submission)
        }
        const input = { ...identity, text, submissionId: submission.id }
        next = action === 'message' ? await api.delegationMessage!(input) : await api.delegationResume!(input)
        if (pendingSubmissions.get(scope)?.id === submission.id) pendingSubmissions.delete(scope)
        onAcceptedDraft(text)
      }
      onView(next)
      if (childKey(next) === childKey(view)) refreshRef.current()
      setNotice(action === 'stop' ? '已提交这个子任务的停止请求。' : action === 'message' ? '已提交补充消息。' : '已沿这个子任务的记录继续。')
    } catch (failure) { setError(failure instanceof Error ? failure.message : '子任务操作没有提交，请重试。') }
    finally { onBusy(false) }
  }
  const readBlob = useMemo(() => detail ? (ref: Parameters<ExecutionDesktopAPI['blob']>[1]) => api.blob(detail.projection.conversationId, ref) : undefined,
    [api, detail?.projection.conversationId])
  const region = current.target?.region ?? current.frame
  const readArtifact = async (name: string) => {
    if (!api.delegationArtifact || artifactBusy) return
    setArtifactBusy(true); setError('')
    try { setArtifact(await api.delegationArtifact({ ...identity, name })) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '候选内容暂不可读取，请重试。') }
    finally { setArtifactBusy(false) }
  }
  return <section className="execution-delegation__detail" aria-label="子任务详情" aria-busy={loading}>
    <header><strong>{readableExecutionData(current.goal)}</strong><button type="button" onClick={onClose}>关闭子任务</button></header>
    <p role="status">{statusLabel(detail?.run?.status ?? current.status)}{current.role ? ` · ${readableExecutionData(current.role)}` : ''}</p>
    {current.target && <dl className="execution-delegation__target"><dt>目标</dt><dd>{readableExecutionData(current.target.project ? `${current.target.project} / ${current.target.path}` : current.target.path)}</dd>
      {region && <><dt>区域</dt><dd>宽 {region.width} × 高 {region.height} · 位置 {region.transform[4]}, {region.transform[5]}</dd></>}</dl>}
    {current.reason && <p className="execution-delegation__note">{readableExecutionData(current.reason)}</p>}
    {loading && <p>正在读取子任务…</p>}
    {error && <p role="alert">{readableExecutionData(error)} <button type="button" onClick={() => refreshRef.current()}>重读详情</button></p>}
    {detail?.run?.steering?.length ? <details className="execution-delegation__messages"><summary>补充与协作消息（{detail.run.steering.length}）</summary>
      {detail.run.steering.map(message => <article key={message.submissionId}><strong>{message.senderRunId ? '协作消息' : '你的补充'}</strong><p>{readableExecutionData(message.text)}</p></article>)}</details> : null}
    {detail && <div className="execution-assistant__history execution-delegation__timeline"><ExecutionTimeline projection={detail.projection} readBlob={readBlob} /></div>}
    <section aria-label="子任务候选" className="execution-delegation__candidates"><strong>候选成果</strong>
      {current.artifacts.length ? <><ul>{current.artifacts.map(artifact => <li key={artifact.name}>{artifact.name} <small>{artifact.byteLength} 字节</small>
        {api.delegationArtifact && <button type="button" disabled={artifactBusy} onClick={() => void readArtifact(artifact.name)}>查看候选：{artifact.name}</button>}</li>)}</ul>
        <p>候选已保留，正式内容的采用由父任务处理。</p></> : <p>{terminal ? '本轮没有可交付的候选文件。' : '候选生成后会显示在这里。'}</p>}
      {artifact && <section aria-label="候选内容"><header><strong>{artifact.name}</strong><button type="button" onClick={() => setArtifact(null)}>关闭候选</button></header>
        {artifact.text === null ? <p>这份文件不支持文本预览。</p> : <pre>{artifact.text}</pre>}</section>}
    </section>
    <form className="execution-delegation__composer" onSubmit={event => { event.preventDefault(); void perform(terminal ? 'resume' : 'message') }}>
      <label>{terminal ? '续接要求' : '补充消息'}<textarea aria-label={terminal ? '子任务续接要求' : '给子任务补充消息'} rows={2} disabled={busy} value={draft} onChange={event => { onDraft(event.target.value); setNotice('') }} /></label>
      <div><button type="submit" disabled={busy || !draft.trim() || (terminal ? !current.childRunId || !api.delegationResume : !api.delegationMessage)}>{terminal ? '继续这个子任务' : '发送给这个子任务'}</button>
        {!terminal && <button type="button" disabled={busy || !api.delegationStop} onClick={() => void perform('stop')}>停止这个子任务</button>}</div>
      {notice && <p role="status">{notice}</p>}
    </form>
  </section>
}

export function ExecutionDelegationChildren({ api, workspaceId, conversationId, interaction: suppliedInteraction, onInteraction }: {
  api: ExecutionDesktopAPI; workspaceId: string; conversationId: string
  interaction?: ExecutionDelegationInteraction
  onInteraction?(update: (value: ExecutionDelegationInteraction) => ExecutionDelegationInteraction): void
}) {
  const [children, setChildren] = useState<ExecutionDelegationChildView[]>([]), [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [localInteraction, setLocalInteraction] = useState(createExecutionDelegationInteraction)
  const { drafts, busyChildren, pendingSubmissions } = suppliedInteraction ?? localInteraction
  const updateInteraction = onInteraction ?? setLocalInteraction
  const childrenRef = useRef(children); childrenRef.current = children
  const refreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!api.delegationChildren || !api.delegationChild) return
    let disposed = false, reading = false, pending = false
    const refresh = () => {
      pending = true
      if (reading || disposed) return
      reading = true
      void (async () => {
        while (pending && !disposed) {
          pending = false
          const next = await api.delegationChildren!({ workspaceId, conversationId })
          if (!disposed) { setChildren(next); childrenRef.current = next; setError('') }
        }
      })().catch(() => { if (!disposed) setError('子任务列表暂不可读取。') })
        .finally(() => { reading = false; if (pending && !disposed) refresh() })
    }
    refreshRef.current = refresh
    const unsubscribe = api.subscribe(event => {
      const child = childrenRef.current.some(value => value.childRunId === event.runId)
      if (child && ['run.state', 'run.end'].includes(event.type)
        || event.conversationId === conversationId && (event.type === 'run.end' || event.type === 'tool' && /^(delegate\.|job\.)/.test(event.data.toolName ?? ''))) refresh()
    })
    refresh()
    return () => { disposed = true; unsubscribe(); refreshRef.current = () => {} }
  }, [api, workspaceId, conversationId])
  const updateView = useCallback((view: ExecutionDelegationChildView, previousKey: string) => {
    setChildren(values => values.some(value => childKey(value) === childKey(view))
      ? values.map(value => childKey(value) === childKey(view) ? view : value) : [...values, view])
    setSelected(value => value === previousKey ? childKey(view) : value)
  }, [])
  if (!api.delegationChildren || !api.delegationChild || !children.length && !error) return null
  const current = children.find(child => childKey(child) === selected)
  return <section className="execution-delegation" aria-label="原生子任务">
    <header><strong>子任务</strong><small>{children.length} 个</small></header>
    {error && <p role="alert">{error} <button type="button" onClick={() => refreshRef.current()}>重读子任务</button></p>}
    <ul className="execution-delegation__list">{children.map(child => <li key={childKey(child)}><button type="button" aria-expanded={selected === childKey(child)} onClick={() => setSelected(value => value === childKey(child) ? null : childKey(child))}>
      <span>{readableExecutionData(child.goal)}</span><small>{statusLabel(child.status)}{child.artifacts.length ? ` · ${child.artifacts.length} 份候选` : ''}</small></button></li>)}</ul>
    {current && <ChildDetail key={childKey(current)} api={api} identity={{ workspaceId, conversationId, parentRunId: current.parentRunId, jobId: current.jobId }} view={current}
      pendingSubmissions={pendingSubmissions}
      draft={drafts[childKey(current)] ?? ''} busy={busyChildren.has(childKey(current))}
      onDraft={text => updateInteraction(value => ({ ...value, drafts: { ...value.drafts, [childKey(current)]: text } }))}
      onAcceptedDraft={text => updateInteraction(value => value.drafts[childKey(current)]?.trim() === text
        ? { ...value, drafts: { ...value.drafts, [childKey(current)]: '' } } : value)}
      onBusy={busy => updateInteraction(value => { const next = new Set(value.busyChildren); if (busy) next.add(childKey(current)); else next.delete(childKey(current)); return { ...value, busyChildren: next } })}
      onView={view => updateView(view, childKey(current))} onClose={() => setSelected(null)} />}
  </section>
}
