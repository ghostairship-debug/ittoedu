import { memo, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { executionDetailKeys, type ExecutionEventSearchPage, type ExecutionBlobRef, type ExecutionContent, type ExecutionItem, type ExecutionProjection } from '../../shared/workbench/executionEvents'
import { executionActivity, executionDocumentFacts, executionTimelineIndex, readableExecutionData } from './executionTimelineModel'
import './executionTimeline.css'
import type { ImageResultsDesktopAPI } from '../../shared/workbench/imageResultsDesktop'
import { ImageResultCard } from './ImageResultCard'
import type { ConversationMessage } from '../../shared/workbench/conversations'
import { captureRendererTiming, type RendererTimingStamp } from '../../shared/workbench/executionDesktop'

export interface ExecutionTimelineProps {
  projection: ExecutionProjection
  readBlob?(ref: ExecutionBlobRef): Promise<string>
  onLocateDocument?(documentId: string): void
  imageResults?: ImageResultsDesktopAPI
  searchEvents?(input: { query: string; after?: number; limit?: number }): Promise<ExecutionEventSearchPage>
  workspaceId?: string
  userMessages?: readonly ConversationMessage[]
  /** The assistant opens search from its conversation menu; standalone timelines own a local affordance. */
  historySearchOpen?: boolean
  onHistorySearchClose?(): void
  /** Observed after a frame opportunity with nonempty task content inside the visible history viewport. */
  onFirstVisible?(taskId: string, itemId: string, stamp: RendererTimingStamp): void
}
const PAGE_SIZE = 100, TEXT_PAGE = 12000
const titles: Record<ExecutionItem['type'], string> = {
  text: '回复', reasoning: '模型提供的思考', tool: '工具执行', edit: '编辑预览', image: '图片结果', build: '构建结果', usage: '本次用量',
  'document.commit': '文档修改', 'document.save': '文件保存', 'run.state': '任务状态', 'run.end': '任务结果',
}
const statusLabel = (status?: string) => ({
  queued: '等待中', running: '进行中', stopping: '正在停止', stopped: '已停止', partial: '部分完成', completed: '已完成',
  failed: '失败', interrupted: '已中断', pending: '等待中', executing: '执行中', returned: '已返回', committed: '已提交', rejected: '已拒绝',
  preparing: '准备中', ready: '已生成', unapplied: '未应用', unknown: '结果未知',
  waiting: '等待你选择', answered: '已回答', cancelled: '未回答', approval: '等待你批准', approved: '已允许', denied: '已拒绝',
}[status ?? ''] ?? status ?? '')

function TextContent({ text }: { text: string }) {
  const [limit, setLimit] = useState(TEXT_PAGE)
  const safe = useMemo(() => readableExecutionData(text), [text])
  return <><pre className="execution-timeline__content">{safe.slice(0, limit)}</pre>
    {safe.length > limit && <button type="button" onClick={() => setLimit(value => value + TEXT_PAGE)}>继续读取内容（剩余 {safe.length - limit} 字符）</button>}</>
}
function BlobContent({ content, readBlob }: { content: Extract<ExecutionContent, { kind: 'blob' }>; readBlob?: (ref: ExecutionBlobRef) => Promise<string> }) {
  const [text, setText] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(() => { ++generation.current; setText(null); setError(''); setBusy(false); return () => { ++generation.current } }, [content.ref.id])
  const load = async () => {
    if (!readBlob || busy || text !== null) return
    const ticket = generation.current
    setBusy(true); setError('')
    try { const value = await readBlob(content.ref); if (ticket === generation.current) setText(value) }
    catch { if (ticket === generation.current) setError('完整内容暂不可读取，可以重试。') }
    finally { if (ticket === generation.current) setBusy(false) }
  }
  if (text !== null) return <TextContent text={text} />
  return <div className="execution-timeline__blob">
    <button type="button" onClick={() => void load()} disabled={!readBlob || busy}>{busy ? '读取中…' : `读取完整内容（${content.ref.bytes} 字节）`}</button>
    {error && <span role="alert">{error}</span>}
  </div>
}
const ItemContent = memo(function ItemContent({ item, readBlob }: Pick<ExecutionTimelineProps, 'readBlob'> & { item: ExecutionItem }) {
  if (item.type === 'usage') {
    const usage = item.data.usage
    const parts = usage ? [usage.inputTokens === undefined ? '' : `输入 ${usage.inputTokens}`, usage.outputTokens === undefined ? '' : `输出 ${usage.outputTokens}`,
      usage.reasoningTokens === undefined ? '' : `思考 ${usage.reasoningTokens}`, usage.cachedInputTokens === undefined ? '' : `缓存输入 ${usage.cachedInputTokens}`,
      usage.totalTokens === undefined ? '' : `合计 ${usage.totalTokens}`].filter(Boolean) : []
    return <p>{parts.join(' · ') || '供应商未报告用量。'}</p>
  }
  const combined: ExecutionContent[] = []
  for (const content of item.content) {
    const previous = combined.at(-1)
    if (previous?.kind === 'text' && content.kind === 'text') previous.text += content.text
    else combined.push({ ...content })
  }
  return <>{combined.map((content, index) => content.kind === 'text' ? <TextContent text={content.text} key={index} />
    : <BlobContent key={content.ref.id} content={content} readBlob={readBlob} />)}</>
})
const detailLabels = { input: '参数', output: '工具输出', diff: '实际差异', error: '错误详情' } as const
/** Read-only record of an ask_user question. The live option card above the composer is the only place to answer. */
function QuestionRecord({ item, ended }: { item: ExecutionItem; ended: boolean }) {
  const question = item.data.question!, answer = item.data.answer
  const status = item.data.status === 'waiting' && ended ? '任务已结束，未回答' : statusLabel(item.data.status)
  return <article data-execution-item={`${item.runId}:${item.itemId}`} className="execution-timeline__card execution-timeline__card--question" aria-label="AI 提问">
    <header><strong>AI 提问</strong>{status && <span> · {status}</span>}</header>
    <p className="execution-timeline__question">{readableExecutionData(question.text)}</p>
    <ul className="execution-timeline__question-options" aria-label={question.multiple ? '选项（可多选）' : '选项'}>
      {question.options.map((option, index) => {
        const chosen = answer?.choices.includes(index) ?? false
        return <li key={index} data-chosen={chosen ? 'true' : 'false'}>{readableExecutionData(option.label)}
          {option.description && <small> · {readableExecutionData(option.description)}</small>}{chosen && <strong> · 你的选择</strong>}</li>
      })}
    </ul>
    {answer?.other && <p>你的补充：{readableExecutionData(answer.other)}</p>}
    {item.data.status === 'waiting' && !ended && <p className="execution-timeline__question-hint">请在输入框上方的选项卡中回答。</p>}
    {item.data.error && item.data.status !== 'answered' && <p>{readableExecutionData(item.data.error)}</p>}
  </article>
}
function TimelineItem({ item, projection, readBlob, onLocateDocument, imageResults, workspaceId, expanded, onExpanded }: ExecutionTimelineProps & {
  item: ExecutionItem; expanded: boolean; onExpanded(open: boolean): void;
}) {
  const source = item.source === 'external-mcp' ? '外部 MCP · 仅显示实际工具事实' : ''
  const facts = executionDocumentFacts(item, projection)
  const end = executionTimelineIndex(projection).ends.get(item.runId)
  if (item.type === 'tool' && item.source === 'builtin' && item.data.question) return <QuestionRecord item={item} ended={Boolean(end)} />
  const incompleteAfterEnd = Boolean(end && ['running', 'executing', 'pending', 'queued', 'stopping', 'waiting', 'approval'].includes(item.data.status ?? ''))
  const displayedStatus = item.type === 'run.state' && end ? statusLabel(end.data.status) : incompleteAfterEnd ? '任务已结束' : statusLabel(item.data.status)
  const operationItem = item.type === 'tool' || item.type === 'document.commit' || item.type === 'document.save'
  const application = ({ applied: '已应用', unchanged: '内容未变化', conflict: '应用冲突', denied: '未获应用授权', cancelled: '未应用（已取消）', failed: '应用失败' } as Record<string, string>)[facts.application ?? ''] ?? '未确认应用'
  const saving = ({ saved: '已保存', saving: '保存中', failed: '保存失败' } as Record<string, string>)[facts.save ?? ''] ?? '保存未确认'
  const heading = readableExecutionData((item.type === 'run.state' ? titles[item.type] : item.data.label) || (item.type === 'tool' ? item.data.toolName : undefined) || titles[item.type])
  const body = <>
    {item.type === 'image' && item.data.jobId && imageResults && workspaceId && projection.conversationId
      ? <ImageResultCard api={imageResults} owner={{ workspaceId, conversationId: projection.conversationId, runId: item.runId, jobId: item.data.jobId }} />
      : <ItemContent item={item} readBlob={readBlob} />}
    {operationItem && <dl className="execution-timeline__facts">
      {item.type === 'tool' && <><dt>工具执行</dt><dd>{['completed', 'returned'].includes(item.data.status ?? '') ? '已运行' : item.data.status === 'failed' ? '执行失败' : incompleteAfterEnd ? '结果未确认（任务已结束）' : statusLabel(item.data.status) || '状态未确认'}</dd></>}
      {item.type !== 'document.save' && <><dt>文档应用</dt><dd>{application}</dd></>}
      <dt>文件保存</dt><dd>{saving}</dd>
    </dl>}
    {facts.documentId && <p><button type="button" disabled={!onLocateDocument} onClick={() => onLocateDocument?.(facts.documentId!)}>
      定位文档{item.data.documentName ? `：${readableExecutionData(item.data.documentName)}` : ''}</button>{!onLocateDocument && <small> 当前视图未连接文档定位</small>}</p>}
    {item.data.approval && <p className="execution-timeline__approval">修改请求：{readableExecutionData(item.data.approval.summary)}
      {item.data.approval.documents.length ? ` · ${item.data.approval.documents.map(readableExecutionData).join('、')}` : ''} · {item.data.decision
        ? ({ allow: '你允许了这次修改', 'allow-all': '你允许了本任务的全部修改', deny: '你拒绝了这次修改' } as const)[item.data.decision]
        : end ? '任务已结束，未处理' : '等待你在输入框上方批准'}</p>}
    {item.data.targetLabel && <p>对象：{readableExecutionData(item.data.targetLabel)}</p>}
    {executionDetailKeys.map(field => {
      const text = item.data[field], ref = item.data[`${field}Ref`]
      if (text === undefined && !ref) return null
      return <section className="execution-timeline__detail" key={field} aria-label={detailLabels[field]}><h4>{detailLabels[field]} <small>敏感值已隐藏</small></h4>
        {ref ? <BlobContent key={ref.id} content={{ kind: 'blob', ref }} readBlob={readBlob} /> : <TextContent text={text!} />}
      </section>
    })}
    {item.parentItemId && <small>上游提供的子项{(() => { const parent = executionTimelineIndex(projection).items.get(JSON.stringify([item.runId, item.parentItemId])); return parent ? ` · ${readableExecutionData(parent.data.label || titles[parent.type])}` : '' })()}</small>}
  </>
  const isCollapsible = !['text', 'run.end', 'run.state'].includes(item.type)
  return <article data-execution-item={`${item.runId}:${item.itemId}`} className={`execution-timeline__card execution-timeline__card--${item.type.replace('.', '-')}`} aria-label={titles[item.type]}>
    {isCollapsible ? <details open={expanded} onToggle={event => { if (event.currentTarget.open !== expanded) onExpanded(event.currentTarget.open) }}>
      <summary><strong>{heading}</strong>{displayedStatus && <span> · {displayedStatus}</span>}</summary>
      {source && <small>{source}</small>}{item.data.toolName && <small>工具：{item.data.toolName}</small>}{expanded && body}
    </details> : <><header><strong>{heading}</strong>{displayedStatus && <span> · {displayedStatus}</span>}</header>{source && <small>{source}</small>}{body}</>}
  </article>
}

interface ReadingState { range: { start: number; end: number }; expanded: Set<string>; following: boolean; top: number }
function HistorySearch({ searchEvents, readBlob, onClose }: Pick<ExecutionTimelineProps, 'searchEvents' | 'readBlob'> & { onClose(): void }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState<ExecutionEventSearchPage | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const ticket = useRef(0)
  useEffect(() => () => { ticket.current++ }, [])
  if (!searchEvents) return null
  const search = async (after = 0) => {
    const current = ++ticket.current; setBusy(true); setError('')
    try { const result = await searchEvents({ query: query.trim(), after, limit: 20 }); if (current === ticket.current) setPage(result) }
    catch { if (current === ticket.current) setError('历史暂不可搜索，请重试。') }
    finally { if (current === ticket.current) setBusy(false) }
  }
  return <section className="execution-timeline__search" aria-label="搜索全部历史">
    <header><strong>搜索会话历史</strong><button type="button" onClick={onClose}>关闭搜索</button></header>
    <form onSubmit={event => { event.preventDefault(); void search() }}><input aria-label="历史关键词" value={query} maxLength={500} onChange={event => { ticket.current++; setBusy(false); setPage(null); setQuery(event.target.value) }} />
      <button type="submit" disabled={!query.trim() || busy}>{busy ? '搜索中…' : '搜索全部历史'}</button></form>
    {error && <p role="alert">{error}</p>}
    {page && <><p role="status">本页找到 {page.hits.length} 条历史事件{page.hasMore ? '，后面仍有记录可搜索' : '，已搜索到末尾'}。历史快照可能已被后续更新替换。</p>
      {page.hits.map(({ event, excerpt }) => <details key={event.eventId}><summary>{titles[event.type]} · 历史事件 {event.sequence} · {readableExecutionData(excerpt)}</summary>
        {(['text', ...executionDetailKeys] as const).map(field => { const ref = event.data[`${field}Ref`], text = event.data[field]; return ref ? <BlobContent key={field} content={{ kind: 'blob', ref }} readBlob={readBlob} /> : text !== undefined ? <TextContent key={field} text={text} /> : null })}
      </details>)}
      {page.hasMore && <button type="button" disabled={busy} onClick={() => void search(page.cursor)}>继续搜索更后记录</button>}
    </>}
  </section>
}
function TimelineBody({ projection, readBlob, onLocateDocument, imageResults, workspaceId, userMessages = [], searchEvents, historySearchOpen, onHistorySearchClose, onFirstVisible, readings }: ExecutionTimelineProps & { readings: Map<string, ReadingState> }) {
  const region = useRef<HTMLElement>(null), scroller = useRef<HTMLElement | null>(null)
  const observedTasks = useRef(new Set<string>())
  const visibilityFrames = useRef<{ first: number; second?: number } | null>(null)
  const visibleCandidates = useRef<ExecutionItem[]>([]), firstVisibleCallback = useRef(onFirstVisible)
  firstVisibleCallback.current = onFirstVisible
  const total = useRef(projection.items.length); total.current = projection.items.length
  const saved = readings.get(projection.conversationId)
  const follow = useRef(saved?.following ?? true), prepend = useRef<{ height: number; top: number } | null>(null)
  const anchor = useRef<{ key: string; offset: number } | null>(null)
  const [following, setFollowing] = useState(saved?.following ?? true)
  const [windowRange, setWindowRange] = useState(() => saved?.range ?? ({ start: Math.max(0, projection.items.length - PAGE_SIZE), end: projection.items.length }))
  const [expanded, setExpanded] = useState<Set<string>>(() => saved?.expanded ?? new Set())
  const [localSearchOpen, setLocalSearchOpen] = useState(false)
  const activity = useMemo(() => executionActivity(projection), [projection])
  const visibleEntries = useMemo(() => [
    ...projection.items.slice(windowRange.start, windowRange.end).map((item, order) => ({ kind: 'item' as const, item, time: item.time, order })),
    ...userMessages.map((message, order) => ({ kind: 'message' as const, message, time: message.createdAt, order })),
  ].sort((left, right) => left.time - right.time || (left.kind === right.kind ? left.order - right.order : left.kind === 'message' ? -1 : 1)),
  [projection.items, windowRange.start, windowRange.end, userMessages])
  const reading = useRef<ReadingState>({ range: windowRange, expanded, following, top: saved?.top ?? 0 })
  reading.current = { ...reading.current, range: windowRange, expanded, following }
  useEffect(() => () => { readings.set(projection.conversationId, reading.current) }, [readings, projection.conversationId])
  useEffect(() => { if (imageResults && workspaceId && projection.conversationId) void imageResults.list({ workspaceId, conversationId: projection.conversationId }).catch(() => {}) }, [imageResults, workspaceId, projection.conversationId])
  useEffect(() => {
    const node = region.current
    if (!node) return
    const host = node.closest<HTMLElement>('.execution-assistant__history') ?? node.parentElement
    scroller.current = host
    if (!host) return
    const observe = () => {
      reading.current.top = host.scrollTop
      follow.current = reading.current.range.end >= total.current && host.scrollHeight - host.scrollTop - host.clientHeight < 40
      setFollowing(follow.current)
      if (follow.current) { anchor.current = null; return }
      const top = host.getBoundingClientRect().top
      const first = [...node.querySelectorAll<HTMLElement>('[data-execution-item]')].find(item => item.getBoundingClientRect().bottom > top)
      anchor.current = first ? { key: first.dataset.executionItem!, offset: first.getBoundingClientRect().top - top } : null
    }
    if (follow.current) host.scrollTop = host.scrollHeight
    else host.scrollTop = saved?.top ?? 0
    host.addEventListener('scroll', observe, { passive: true })
    return () => { host.removeEventListener('scroll', observe); scroller.current = null }
  }, [])
  useLayoutEffect(() => {
    if (!follow.current) return
    setWindowRange(value => {
      const end = projection.items.length, size = PAGE_SIZE
      return value.end === end ? value : { start: Math.max(0, end - size), end }
    })
  }, [projection.cursor, projection.items.length, following])
  useLayoutEffect(() => {
    const host = scroller.current
    if (!host) return
    if (prepend.current) { host.scrollTop = prepend.current.top + host.scrollHeight - prepend.current.height; prepend.current = null; return }
    if (follow.current) { host.scrollTop = host.scrollHeight; return }
    if (anchor.current) {
      const key = anchor.current.key
      const node = [...region.current!.querySelectorAll<HTMLElement>('[data-execution-item]')].find(item => item.dataset.executionItem === key)
      if (node) host.scrollTop += node.getBoundingClientRect().top - host.getBoundingClientRect().top - anchor.current.offset
    }
  }, [projection.cursor, windowRange, expanded])
  useEffect(() => {
    visibleCandidates.current = visibleEntries.filter((entry): entry is Extract<typeof entry, { kind: 'item' }> => entry.kind === 'item')
      .map(entry => entry.item).filter(item => !observedTasks.current.has(item.taskId)
        && (item.type === 'text' || item.type === 'edit')
        && item.content.some(part => part.kind === 'text' && part.text.trim().length > 0))
    if (!firstVisibleCallback.current || !visibleCandidates.current.length || visibilityFrames.current) return
    const frames: { first: number; second?: number } = { first: 0 }
    frames.first = requestAnimationFrame(() => { frames.second = requestAnimationFrame(() => {
      visibilityFrames.current = null
      const host = scroller.current, parent = region.current
      if (!host || !parent) return
      const viewport = host.getBoundingClientRect()
      for (const item of visibleCandidates.current) {
        const card = [...parent.querySelectorAll<HTMLElement>('[data-execution-item]')]
          .find(node => node.dataset.executionItem === `${item.runId}:${item.itemId}`)
        if (!card) continue
        // A collapsed edit card has only its heading in the DOM. Measure rendered text,
        // not the card shell or a document.commit title, as the first visible content.
        const content = [...card.querySelectorAll<HTMLElement>('.execution-timeline__content')]
          .find(node => node.textContent?.trim())
        if (!content) continue
        const bounds = content.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
        if (observedTasks.current.has(item.taskId)) continue
        observedTasks.current.add(item.taskId)
        firstVisibleCallback.current?.(item.taskId, item.itemId, captureRendererTiming())
      }
    }) })
    visibilityFrames.current = frames
  }, [projection.cursor, visibleEntries, expanded, onFirstVisible])
  useEffect(() => () => {
    if (visibilityFrames.current) {
      cancelAnimationFrame(visibilityFrames.current.first)
      if (visibilityFrames.current.second !== undefined) cancelAnimationFrame(visibilityFrames.current.second)
    }
  }, [])
  const latest = () => {
    follow.current = true; setFollowing(true); anchor.current = null
    setWindowRange({ start: Math.max(0, projection.items.length - PAGE_SIZE), end: projection.items.length })
  }
  const earlier = () => {
    const host = scroller.current
    if (host) prepend.current = { height: host.scrollHeight, top: host.scrollTop }
    follow.current = false; setFollowing(false)
    setWindowRange(value => ({ end: value.start, start: Math.max(0, value.start - PAGE_SIZE) }))
  }
  return <section ref={region} className="execution-timeline" aria-label="任务过程" aria-busy={activity.busy}>
    {searchEvents && historySearchOpen === undefined && !localSearchOpen && <button type="button" className="execution-timeline__search-open" onClick={() => setLocalSearchOpen(true)}>搜索历史</button>}
    {searchEvents && (historySearchOpen ?? localSearchOpen) && <HistorySearch searchEvents={searchEvents} readBlob={readBlob} onClose={historySearchOpen === undefined ? () => setLocalSearchOpen(false) : onHistorySearchClose ?? (() => {})} />}
    {(activity.busy || activity.waitingRuns > 0) && <p className="execution-timeline__activity" role="status" aria-live="polite" aria-atomic="true">
      {[activity.activeRuns ? `${activity.activeRuns} 个任务进行中` : '', activity.waitingRuns ? `${activity.waitingRuns} 个任务等待你的选择` : '',
        activity.externalTools ? `${activity.externalTools} 个外部工具执行中` : ''].filter(Boolean).join(' · ')}
    </p>}
    {windowRange.start > 0 && <button type="button" className="execution-timeline__page" onClick={earlier}>读取更早记录（前面还有 {windowRange.start} 条）</button>}
    {projection.items.length === 0 && userMessages.length === 0 && <p className="execution-timeline__empty">这段会话还没有执行记录。</p>}
    {visibleEntries.map(entry => {
      if (entry.kind === 'message') return <article className="execution-assistant__user-message" aria-label="用户消息" key={entry.message.messageId}>
        <strong>你</strong><p>{entry.message.text}</p>
      </article>
      const item = entry.item
      const key = `${item.runId}:${item.itemId}`
      return <TimelineItem key={key} item={item} projection={projection} readBlob={readBlob} onLocateDocument={onLocateDocument} imageResults={imageResults} workspaceId={workspaceId} expanded={expanded.has(key)}
        onExpanded={open => setExpanded(value => { const next = new Set(value); if (open) next.add(key); else next.delete(key); return next })} />
    })}
    {windowRange.end < projection.items.length && <button type="button" onClick={() => { follow.current = false; setFollowing(false); setWindowRange(value => ({ start: value.end, end: Math.min(projection.items.length, value.end + PAGE_SIZE) })) }}>读取更后记录</button>}
    {!following && <button type="button" className="execution-timeline__latest" onClick={latest}>回到最新{projection.items.length > windowRange.end ? `（${projection.items.length - windowRange.end} 条新记录）` : ''}</button>}
  </section>
}
/** A read-only view. Pagination, expansion and scrolling never replay a tool or focus the composer. */
export function ExecutionTimeline(props: ExecutionTimelineProps) {
  const readings = useRef(new Map<string, ReadingState>())
  return <TimelineBody key={props.projection.conversationId} {...props} readings={readings.current} />
}
