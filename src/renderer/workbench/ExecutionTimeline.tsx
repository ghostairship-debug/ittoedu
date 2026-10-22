import { memo, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { executionDetailKeys, executionProjectionChange, executionProjectionToken, type ExecutionEventSearchPage, type ExecutionBlobRef, type ExecutionContent, type ExecutionItem, type ExecutionProjection } from '../../shared/workbench/executionEvents'
import { ExecutionTimelineReadModel, readableExecutionData, readableExecutionText } from './executionTimelineModel'
import type { ExecutionTimelineBodyPage, ExecutionTimelineBodyRequest, ExecutionTimelineBodyWindow, ExecutionTimelineGroupPage,
  ExecutionTimelineGroupRange, ExecutionTimelineItemFact, ExecutionTimelinePageRequest, ExecutionTimelineWindowControl, ExecutionTimelineWindowItem } from '../../shared/workbench/executionTimelineWindow'
import './executionTimeline.css'
import type { ImageResultsDesktopAPI } from '../../shared/workbench/imageResultsDesktop'
import { ImageResultCard } from './ImageResultCard'
import type { ConversationMessage } from '../../shared/workbench/conversations'
import { captureRendererTiming, type RendererTimingStamp } from '../../shared/workbench/executionDesktop'
import { ExecutionReplyContent, ReplyLink } from './ExecutionReplyContent'

export interface ExecutionTimelineProps {
  projection: ExecutionProjection
  readBlob?(ref: ExecutionBlobRef): Promise<string>
  onLocateDocument?(documentId: string): void
  onOpenSavedFile?(runId: string, itemId: string): void
  imageResults?: ImageResultsDesktopAPI
  searchEvents?(input: { query: string; after?: number; limit?: number }): Promise<ExecutionEventSearchPage>
  workspaceId?: string
  userMessages?: readonly ConversationMessage[]
  /** A fresh object requests the newest position after an explicit, confirmed submission. */
  latestRequest?: { conversationId: string; submissionId: string }
  /** The assistant opens search from its conversation menu; standalone timelines own a local affordance. */
  historySearchOpen?: boolean
  onHistorySearchClose?(): void
  /** Observed after a frame opportunity with nonempty task content inside the visible history viewport. */
  onFirstVisible?(taskId: string, itemId: string, stamp: RendererTimingStamp): void
  /** Existing view reading state may be held by the Assistant so its first host read restores the same range. */
  readingStates?: Map<string, ExecutionTimelineReadingState>
}
export interface ExecutionTimelineWindowProps extends Omit<ExecutionTimelineProps, 'projection'> { projection?: never; window: ExecutionTimelineWindowControl }
type DisplayItem = ExecutionItem | ExecutionTimelineWindowItem
type ReadBody = (input: ExecutionTimelineBodyRequest) => Promise<ExecutionTimelineBodyPage>
const NO_MESSAGES: readonly ConversationMessage[] = []
function sameDisplayItem(previous: DisplayItem, next: DisplayItem): boolean {
  if (previous === next) return true
  return 'body' in previous && 'body' in next && previous.runId === next.runId && previous.itemId === next.itemId
    && previous.sequence === next.sequence && previous.body.sequence === next.body.sequence && previous.type === next.type
    && previous.data.label === next.data.label && previous.data.status === next.data.status
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
  saved: '已保存', written: '已写入', generated: '已生成',
}[status ?? ''] ?? status ?? '')

function ReplyCopyAction({ text, readText, version }: { text?: string; readText?(): Promise<string>; version?: number }) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => { setResult('idle') }, [text, version])
  const copy = async () => {
    setResult('idle')
    try { await navigator.clipboard.writeText(readText ? await readText() : text ?? ''); setResult('copied') }
    catch { setResult('failed') }
  }
  return <div className="execution-reply__actions">
    <button type="button" title="复制这段已收到的完整内容" onClick={() => void copy()}>复制内容</button>
    {result === 'copied' && <small role="status">已复制</small>}
    {result === 'failed' && <small role="alert">复制失败，请重试。</small>}
  </div>
}
function TextContent({ text, reply = false }: { text: string; reply?: boolean }) {
  const [limit, setLimit] = useState(TEXT_PAGE)
  const safe = useMemo(() => reply ? text : readableExecutionText(text), [text, reply])
  return <>{reply && safe.length > 0 && <ReplyCopyAction text={safe} />}
    {reply ? <ExecutionReplyContent text={safe.slice(0, limit)} /> : <pre className="execution-timeline__content">{safe.slice(0, limit)}</pre>}
    {safe.length > limit && <button type="button" onClick={() => setLimit(value => value + TEXT_PAGE)}>继续读取内容（剩余 {safe.length - limit} 字符）</button>}</>
}
function BlobContent({ content, readBlob, reply = false }: { content: Extract<ExecutionContent, { kind: 'blob' }>; readBlob?: (ref: ExecutionBlobRef) => Promise<string>; reply?: boolean }) {
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
  if (text !== null) return <TextContent text={text} reply={reply} />
  return <div className="execution-timeline__blob">
    <button type="button" onClick={() => void load()} disabled={!readBlob || busy}>{busy ? '读取中…' : `读取完整内容（${content.ref.bytes} 字节）`}</button>
    {error && <span role="alert">{error}</span>}
  </div>
}
function WindowTextContent({ item, part, readBody, snapshotVersion }: { item: DisplayItem; part: Extract<ExecutionTimelineBodyWindow['parts'][number], { kind: 'text' }>; readBody: ReadBody; snapshotVersion?: object }) {
  const [limit, setLimit] = useState(TEXT_PAGE), [loaded, setLoaded] = useState<ExecutionTimelineBodyPage | null>(null), [error, setError] = useState('')
  const ticket = useRef(0), sequence = useRef(item.sequence), snapshot = useRef(snapshotVersion), loadedSnapshot = useRef(snapshotVersion)
  sequence.current = item.sequence; snapshot.current = snapshotVersion
  useEffect(() => {
    const current = ++ticket.current
    setLoaded(null); setError('')
    if (limit <= TEXT_PAGE) return
    void readBody({ runId: item.runId, itemId: item.itemId, part: part.part, maxChars: limit }).then(page => {
      if (current === ticket.current && snapshot.current === snapshotVersion && page.sequence >= sequence.current) { loadedSnapshot.current = snapshotVersion; setLoaded(page) }
    }).catch(() => { if (current === ticket.current) setError('内容暂不可读取，可以重试。') })
    return () => { ++ticket.current }
  }, [item.runId, item.itemId, item.sequence, part.part, limit, readBody, snapshotVersion])
  const shown = loaded && loadedSnapshot.current === snapshotVersion && loaded.sequence >= item.sequence ? loaded : part
  const reply = item.type === 'text'
  return <>{reply && shown.total > 0 && <ReplyCopyAction version={item.sequence} readText={async () => {
    const page = await readBody({ runId: item.runId, itemId: item.itemId, part: part.part, complete: true })
    return page.text
  }} />}
    {reply ? <ExecutionReplyContent text={shown.text} /> : <pre className="execution-timeline__content">{shown.text}</pre>}
    {shown.hasMore && <button type="button" onClick={() => setLimit(value => value + TEXT_PAGE)}>继续读取内容（剩余 {shown.total - shown.offset - shown.text.length} 字符）</button>}
    {error && <p role="alert">{error}</p>}</>
}
function WindowBodyContent({ item, body, readBody, readBlob, snapshotVersion }: { item: DisplayItem; body: ExecutionTimelineBodyWindow; readBody: ReadBody; snapshotVersion?: object } & Pick<ExecutionTimelineProps, 'readBlob'>) {
  return <>{body.parts.map((part, index) => part.kind === 'text' ? <WindowTextContent key={part.part} item={item} part={part} readBody={readBody} snapshotVersion={snapshotVersion} />
    : <BlobContent key={`${index}:${part.ref.id}`} content={part} readBlob={readBlob} reply={item.type === 'text'} />)}</>
}
const ItemContent = memo(function ItemContent({ item, readBlob, readBody, snapshotVersion }: Pick<ExecutionTimelineProps, 'readBlob'> & { item: DisplayItem; readBody?: ReadBody; snapshotVersion?: object }) {
  if ('body' in item && readBody) return <WindowBodyContent item={item} body={item.body} readBody={readBody} readBlob={readBlob} snapshotVersion={snapshotVersion} />
  return null
})
const detailLabels = { input: '参数', output: '工具输出', diff: '实际差异', error: '错误详情' } as const
/** Read-only record of an ask_user question. The live option card above the composer is the only place to answer. */
function QuestionRecord({ item, ended }: { item: DisplayItem; ended: boolean }) {
  const question = item.data.question!, answer = item.data.answer
  const status = item.data.status === 'waiting' && ended ? '任务已结束，未回答' : statusLabel(item.data.status)
  return <article data-execution-item={`${item.runId}:${item.itemId}`} className="execution-timeline__card execution-timeline__card--question" aria-label={item.data.delegationRef ? '子任务提问' : 'AI 提问'}>
    <header><strong>{item.data.delegationRef ? '子任务提问' : 'AI 提问'}</strong>{status && <span> · {status}</span>}</header>
    <p className="execution-timeline__question">{readableExecutionData(question.text)}</p>
    <ul className="execution-timeline__question-options" aria-label={question.multiple ? '选项（可多选）' : '选项'}>
      {question.options.map((option, index) => {
        const chosen = answer?.choices.includes(index) ?? false
        return <li key={index} data-chosen={chosen ? 'true' : 'false'}>{readableExecutionData(option.label)}
          {option.description && <small> · {readableExecutionData(option.description)}</small>}{chosen && <strong> · 你的选择</strong>}</li>
      })}
    </ul>
    {answer?.other && <p>{answer.choices.length ? '你的补充' : '你的回答'}：{readableExecutionData(answer.other)}</p>}
    {item.data.status === 'waiting' && !ended && <p className="execution-timeline__question-hint">请在输入框上方的选项卡中回答。</p>}
    {item.data.error && item.data.status !== 'answered' && <p>{readableExecutionData(item.data.error)}</p>}
  </article>
}
const TimelineItemCard = memo(function TimelineItemCard({ item, conversationId, facts, ended, endStatus, parentLabel, runCommitSequence, readBlob, readBody, onLocateDocument, onOpenSavedFile, imageResults, workspaceId, expanded, onExpanded, snapshotVersion }: Omit<ExecutionTimelineProps, 'projection'> & {
  item: DisplayItem; expanded: boolean; onExpanded(open: boolean): void; conversationId: string; readBody?: ReadBody; snapshotVersion?: object
  facts: Pick<ExecutionTimelineItemFact, 'documentId' | 'application' | 'save'>; ended: boolean; endStatus?: string; parentLabel?: string; runCommitSequence?: number
}) {
  const source = item.source === 'external-mcp' ? '外部 MCP · 仅显示实际工具事实' : ''
  if (item.type === 'tool' && item.source === 'builtin' && item.data.question) return <QuestionRecord item={item} ended={ended} />
  const incompleteAfterEnd = Boolean(ended && ['running', 'executing', 'pending', 'queued', 'stopping', 'waiting', 'approval'].includes(item.data.status ?? ''))
  const displayedStatus = item.type === 'text' ? '' : ['run.state', 'run.end'].includes(item.type) && (endStatus ?? item.data.status) === 'completed' ? '本轮已结束'
    : item.type === 'run.state' && ended && !item.data.label ? statusLabel(endStatus) : incompleteAfterEnd ? '任务已结束' : statusLabel(item.data.status)
  const operationItem = item.type === 'tool' || item.type === 'document.commit' || item.type === 'document.save'
  const application = ({ applied: '已应用', unchanged: '内容未变化', conflict: '应用冲突', denied: '未获应用授权', cancelled: '未应用（已取消）', failed: '应用失败' } as Record<string, string>)[facts.application ?? ''] ?? '未确认应用'
  const saving = ({ saved: '已保存', saving: '保存中', failed: '保存失败' } as Record<string, string>)[facts.save ?? ''] ?? '保存未确认'
  const heading = readableExecutionData(item.data.label || (item.type === 'tool' ? item.data.toolName : undefined) || titles[item.type])
  const savedFile = item.type === 'tool' && item.source === 'builtin' && item.data.saveStatus === 'saved'
    && (item.data.toolName === 'file.write' || item.data.toolName === 'file.save')
  const body = <>
    {item.type === 'image' && item.data.jobId && imageResults && workspaceId && conversationId
      ? <ImageResultCard api={imageResults} refreshVersion={runCommitSequence}
        owner={{ workspaceId, conversationId, runId: item.runId, jobId: item.data.jobId }} />
      : <ItemContent item={item} readBlob={readBlob} readBody={readBody} snapshotVersion={snapshotVersion} />}
    {item.data.webSources?.length ? <ul aria-label="搜索来源">{item.data.webSources.map(source =>
      <li key={source.url}><ReplyLink href={source.url}>{source.title || source.url}</ReplyLink></li>)}</ul> : null}
    {operationItem && <dl className="execution-timeline__facts">
      {item.type === 'tool' && <><dt>工具执行</dt><dd>{['completed', 'returned'].includes(item.data.status ?? '') ? '已运行' : item.data.status === 'failed' ? '执行失败' : incompleteAfterEnd ? '结果未确认（任务已结束）' : statusLabel(item.data.status) || '状态未确认'}</dd></>}
      {(facts.application !== undefined || item.type === 'document.commit') && <><dt>文档应用</dt><dd>{application}</dd></>}
      {(facts.save !== undefined || item.type === 'document.save') && <><dt>文件保存</dt><dd>{saving}</dd></>}
    </dl>}
    {facts.documentId && <p><button type="button" disabled={!onLocateDocument} onClick={() => onLocateDocument?.(facts.documentId!)}>
      定位文档{item.data.documentName ? `：${readableExecutionData(item.data.documentName)}` : ''}</button>{!onLocateDocument && <small> 当前视图未连接文档定位</small>}</p>}
    {item.data.approval && <p className="execution-timeline__approval">修改请求：{readableExecutionData(item.data.approval.summary)}
      {item.data.approval.documents.length ? ` · ${item.data.approval.documents.map(readableExecutionData).join('、')}` : ''} · {item.data.decision
        ? item.data.decision === 'allow-all' && item.data.delegationRef ? '你允许了本子任务的全部修改'
          : ({ allow: '你允许了这次修改', 'allow-all': '你允许了本任务的全部修改', deny: '你拒绝了这次修改' } as const)[item.data.decision]
        : ended || item.data.status !== 'approval' ? '等待已关闭，未提交决定' : '等待你在输入框上方批准'}</p>}
    {item.data.targetLabel && <p>对象：{readableExecutionData(item.data.targetLabel)}</p>}
    {executionDetailKeys.map(field => {
      const text = item.data[field], ref = item.data[`${field}Ref`]
      if (text === undefined && !ref) return null
      return <section className="execution-timeline__detail" key={field} aria-label={detailLabels[field]}><h4>{detailLabels[field]} <small>敏感值已隐藏</small></h4>
        {ref ? <BlobContent key={ref.id} content={{ kind: 'blob', ref }} readBlob={readBlob} /> : <TextContent text={text!} />}
      </section>
    })}
    {item.parentItemId && <small>上游提供的子项{parentLabel ? ` · ${parentLabel}` : ''}</small>}
  </>
  const isCollapsible = item.type !== 'text'
  return <article data-execution-item={`${item.runId}:${item.itemId}`} className={`execution-timeline__card execution-timeline__card--${item.type.replace('.', '-')}`} aria-label={titles[item.type]}>
    {isCollapsible ? <details open={expanded} onToggle={event => { if (event.currentTarget.open !== expanded) onExpanded(event.currentTarget.open) }}>
      <summary><strong>{heading}</strong>{displayedStatus && <span> · {savedFile ? '已保存' : displayedStatus}</span>}</summary>
      {source && <small>{source}</small>}{item.data.toolName && <small>工具：{item.data.toolName}</small>}{expanded && body}
    </details> : <><header><strong>{heading}</strong>{displayedStatus && <span> · {displayedStatus}</span>}</header>{source && <small>{source}</small>}{body}</>}
    {savedFile && onOpenSavedFile && <button type="button" className="execution-timeline__file-result" title={item.data.documentName}
      onClick={() => onOpenSavedFile(item.runId, item.itemId)}><span>{item.data.documentName ? `打开文件：${readableExecutionData(item.data.documentName)}` : '打开文件'}</span></button>}
  </article>
}, (previous, next) =>
  sameDisplayItem(previous.item, next.item)
  && previous.expanded === next.expanded
  && previous.conversationId === next.conversationId
  && previous.facts.documentId === next.facts.documentId
  && previous.facts.application === next.facts.application
  && previous.facts.save === next.facts.save
  && previous.ended === next.ended
  && previous.endStatus === next.endStatus
  && previous.parentLabel === next.parentLabel
  && previous.runCommitSequence === next.runCommitSequence
  && previous.snapshotVersion === next.snapshotVersion
  && previous.readBody === next.readBody
  && previous.readBlob === next.readBlob
  && previous.onLocateDocument === next.onLocateDocument
  && previous.onOpenSavedFile === next.onOpenSavedFile
  && previous.imageResults === next.imageResults
  && previous.workspaceId === next.workspaceId)

export interface ExecutionTimelineReadingState {
  range: { start: number; end: number }; expanded: Set<string>; following: boolean; top: number
  anchorKey?: string; groups?: Record<string, ExecutionTimelineGroupRange>
}
type ReadingState = ExecutionTimelineReadingState
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
        {(['text', ...executionDetailKeys] as const).map(field => { const ref = event.data[`${field}Ref`], text = event.data[field], reply = field === 'text' && event.type === 'text'; return ref ? <BlobContent key={field} content={{ kind: 'blob', ref }} readBlob={readBlob} reply={reply} /> : text !== undefined ? <TextContent key={field} text={text} reply={reply} /> : null })}
      </details>)}
      {page.hasMore && <button type="button" disabled={busy} onClick={() => void search(page.cursor)}>继续搜索更后记录</button>}
    </>}
  </section>
}
/** Adapt a complete local projection to the same explicit windows used by the host. */
function LocalTimeline({ projection, userMessages = NO_MESSAGES, readings, ...props }: ExecutionTimelineProps & { readings: Map<string, ReadingState> }) {
  const state = useRef<{ reader: ExecutionTimelineReadModel; token: object; messages: readonly ConversationMessage[]; snapshotVersion: object } | null>(null)
  const token = executionProjectionToken(projection)
  if (!state.current) state.current = { reader: new ExecutionTimelineReadModel(projection, userMessages), token, messages: userMessages, snapshotVersion: {} }
  else {
    // Public full snapshots may replace content without an event sequence change. Only a
    // real fold generation proves the per-item versions used by host window consumers.
    const plan = executionProjectionChange(projection)
    if (userMessages !== state.current.messages || token !== state.current.token && plan?.baseToken !== state.current.token) state.current.snapshotVersion = {}
    state.current.reader.update(projection, userMessages); state.current.token = token; state.current.messages = userMessages
  }
  const model = state.current.reader, saved = readings.get(projection.conversationId)
  const [request, setRequest] = useState<ExecutionTimelinePageRequest>(() => saved && !saved.following
    ? { start: saved.range.start, limit: PAGE_SIZE, anchorKey: saved.anchorKey, groups: saved.groups } : {})
  const callbacks = useMemo(() => ({
    readPage: async (input: ExecutionTimelinePageRequest) => { setRequest(input); return model.entryPage(input) },
    readGroup: async (input: Parameters<ExecutionTimelineWindowControl['readGroup']>[0]) => {
      setRequest(value => ({ ...value, groups: { ...value.groups, [input.key]: input } }))
      return model.groupPage(input)
    },
    readBody: async (input: ExecutionTimelineBodyRequest) => model.readBody(input),
  }), [model])
  const page = model.entryPage(request)
  return <ControlledTimeline {...props} window={{ page, ...callbacks }} readings={readings} snapshotVersion={state.current.snapshotVersion} />
}

function useLayoutVersion(values: readonly unknown[]): object {
  const current = useRef<{ values: readonly unknown[]; version: object } | null>(null)
  if (!current.current || current.current.values.length !== values.length || values.some((value, index) => value !== current.current!.values[index])) {
    current.current = { values, version: {} }
  }
  return current.current.version
}
function ControlledTimeline({ window: control, readBlob, onLocateDocument, onOpenSavedFile, imageResults, workspaceId, latestRequest,
  searchEvents, historySearchOpen, onHistorySearchClose, onFirstVisible, readings, snapshotVersion }: ExecutionTimelineWindowProps & { readings: Map<string, ReadingState>; snapshotVersion?: object }) {
  const page = control.page
  const groupEpoch = useMemo(() => ({}), [snapshotVersion, page.userHistoryRevision, page.userHistoryOffset])
  const currentGroupEpoch = useRef(groupEpoch); currentGroupEpoch.current = groupEpoch
  const [groupPages, setGroupPages] = useState<Map<string, { page: ExecutionTimelineGroupPage; epoch: object }>>(() => new Map())
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const saved = readings.get(page.conversationId)
  const [expanded, setExpanded] = useState<Set<string>>(() => saved?.expanded ?? new Set()), [following, setFollowing] = useState(saved?.following ?? true)
  const [localSearchOpen, setLocalSearchOpen] = useState(false)
  const region = useRef<HTMLElement>(null), scroller = useRef<HTMLElement | null>(null), follow = useRef(saved?.following ?? true)
  const probeVisibility = useRef<() => void>(() => {})
  const cursor = useRef(page.cursor), ticket = useRef(0), anchor = useRef<{ key: string; offset: number } | null>(null)
  const snapshot = useRef(snapshotVersion)
  if (snapshot.current !== snapshotVersion) cursor.current = page.cursor
  snapshot.current = snapshotVersion
  const prepend = useRef<{ height: number; top: number } | null>(null), top = useRef(saved?.top ?? 0), latestSeen = useRef<typeof latestRequest>(undefined)
  const pageRef = useRef(page), expandedRef = useRef(expanded), followingRef = useRef(following)
  const groupRanges = useRef<Record<string, ExecutionTimelineGroupRange>>({})
  pageRef.current = page; expandedRef.current = expanded; followingRef.current = following
  cursor.current = Math.max(cursor.current, page.cursor)
  useEffect(() => {
    const keys = new Set(page.entries.filter(entry => entry.kind === 'tools').map(entry => entry.key))
    setGroupPages(value => {
      const retained = new Map([...value].filter(([key, group]) => keys.has(key) && group.page.cursor === page.cursor && group.epoch === groupEpoch))
      return retained.size === value.size ? value : retained
    })
  }, [page, groupEpoch])
  useEffect(() => { ++ticket.current; setBusy(false); setError('') }, [groupEpoch])
  useEffect(() => () => { ++ticket.current; readings.set(pageRef.current.conversationId, {
    range: { start: pageRef.current.start, end: pageRef.current.end }, expanded: expandedRef.current, following: followingRef.current, top: top.current,
    anchorKey: pageRef.current.anchorKey, groups: groupRanges.current,
  }) }, [readings])
  const visibleEntries = useMemo(() => page.entries.map(entry => {
    const cached = entry.kind === 'tools' ? groupPages.get(entry.key) : undefined
    return cached?.page.cursor === page.cursor && cached.epoch === groupEpoch ? cached.page : entry
  }), [page, groupPages, groupEpoch])
  groupRanges.current = Object.fromEntries(visibleEntries.filter((entry): entry is ExecutionTimelineGroupPage => entry.kind === 'tools')
    .map(entry => [entry.key, { itemStart: entry.itemStart, itemLimit: PAGE_SIZE, fileStart: entry.fileStart, fileLimit: PAGE_SIZE }]))
  const facts = useMemo(() => new Map([...page.itemFacts, ...visibleEntries.flatMap(entry => entry.kind === 'tools' ? entry.itemFacts : [])]
    .map(fact => [JSON.stringify([fact.runId, fact.itemId]), fact])), [page.itemFacts, visibleEntries])
  const activityText = page.end === page.total && (page.activity.busy || page.activity.waitingRuns > 0)
    ? `${page.status} · ${[page.activity.activeRuns ? `${page.activity.activeRuns} 个任务进行中` : '', page.activity.waitingRuns ? `${page.activity.waitingRuns} 个任务等待你的选择` : '',
      page.activity.externalTools ? `${page.activity.externalTools} 个外部工具执行中` : ''].filter(Boolean).join(' · ')}` : ''
  // Window producers stamp every changed item with its durable event sequence. Full
  // public snapshots additionally carry a local epoch, since they need not use it.
  // Compare only mounted content/facts and rendered page controls, never the cursor.
  const layoutValues: unknown[] = [snapshotVersion, page.start, page.end, page.total, following, error, activityText,
    historySearchOpen ?? localSearchOpen, Boolean(onOpenSavedFile), Boolean(onLocateDocument), imageResults, workspaceId]
  const itemLayout = (item: ExecutionTimelineWindowItem) => {
    const fact = facts.get(JSON.stringify([item.runId, item.itemId]))!
    layoutValues.push(item.runId, item.itemId, item.sequence, item.body.sequence, item.type, item.data.label, item.data.status,
      expanded.has(`${item.runId}:${item.itemId}`), fact.documentId, fact.application, fact.save, fact.ended, fact.endStatus,
      fact.parent?.type, fact.parent?.label, fact.runCommitSequence)
  }
  for (const entry of visibleEntries) {
    if (entry.kind === 'message') layoutValues.push('message', entry.message.messageId, entry.message.text)
    else if (entry.kind === 'item') itemLayout(entry.item)
    else {
      const open = expanded.has(entry.key)
      layoutValues.push('tools', entry.key, entry.summary, entry.source, open)
      if (open) { layoutValues.push(entry.itemStart, entry.itemEnd, entry.itemCount); entry.items.forEach(itemLayout) }
      if (onOpenSavedFile) {
        layoutValues.push(entry.fileStart, entry.fileEnd, entry.fileCount)
        for (const item of entry.files) layoutValues.push(item.runId, item.itemId, item.data.documentName)
      }
    }
  }
  const layoutVersion = useLayoutVersion(layoutValues)
  const requestPage = async (input: Parameters<ExecutionTimelineWindowControl['readPage']>[0]) => {
    const current = ++ticket.current; setBusy(true); setError('')
    try {
      const next = await control.readPage(input)
      if (current === ticket.current && next.cursor >= cursor.current) cursor.current = next.cursor
    } catch { if (current === ticket.current) setError('历史暂不可读取，可以重试。') }
    finally { if (current === ticket.current) setBusy(false) }
  }
  const requestGroup = async (group: ExecutionTimelineGroupPage, files = false, earlier = false) => {
    const current = ++ticket.current, requestedEpoch = groupEpoch; setBusy(true); setError('')
    try {
      const next = await control.readGroup({ key: group.key,
        itemStart: files ? group.itemStart : earlier ? Math.max(0, group.itemStart - PAGE_SIZE) : group.itemEnd, itemLimit: PAGE_SIZE,
        fileStart: files ? earlier ? Math.max(0, group.fileStart - PAGE_SIZE) : group.fileEnd : group.fileStart, fileLimit: PAGE_SIZE })
      if (current === ticket.current && currentGroupEpoch.current === requestedEpoch && next.cursor >= cursor.current) {
        setGroupPages(value => new Map(value).set(next.key, { page: next, epoch: requestedEpoch }))
      }
    } catch { if (current === ticket.current) setError('工具组暂不可读取，可以重试。') }
    finally { if (current === ticket.current) setBusy(false) }
  }
  const toggle = (key: string, open: boolean) => setExpanded(value => { const next = new Set(value); if (open) next.add(key); else next.delete(key); return next })
  useEffect(() => {
    const node = region.current, host = node?.closest<HTMLElement>('.execution-assistant__history') ?? node?.parentElement
    scroller.current = host ?? null
    if (!node || !host) return
    const observe = () => {
      top.current = host.scrollTop
      follow.current = pageRef.current.end >= pageRef.current.total && host.scrollHeight - host.scrollTop - host.clientHeight < 40
      setFollowing(follow.current)
      probeVisibility.current()
      if (follow.current) { anchor.current = null; return }
      const bounds = host.getBoundingClientRect()
      const first = [...node.querySelectorAll<HTMLElement>('[data-execution-item]')].find(item => item.getBoundingClientRect().bottom > bounds.top)
      anchor.current = first ? { key: first.dataset.executionItem!, offset: first.getBoundingClientRect().top - bounds.top } : null
    }
    host.scrollTop = follow.current ? host.scrollHeight : saved?.top ?? 0
    host.addEventListener('scroll', observe, { passive: true })
    return () => { host.removeEventListener('scroll', observe); scroller.current = null }
  }, [])
  useLayoutEffect(() => {
    const host = scroller.current
    if (!host) return
    if (prepend.current) { host.scrollTop = prepend.current.top + host.scrollHeight - prepend.current.height; prepend.current = null }
    else if (follow.current) host.scrollTop = host.scrollHeight
    else if (anchor.current) {
      const node = [...region.current!.querySelectorAll<HTMLElement>('[data-execution-item]')].find(node => node.dataset.executionItem === anchor.current!.key)
      if (node) host.scrollTop += node.getBoundingClientRect().top - host.getBoundingClientRect().top - anchor.current.offset
    }
  }, [layoutVersion])
  const latest = () => { follow.current = true; setFollowing(true); anchor.current = null; void requestPage({}) }
  useLayoutEffect(() => {
    if (!latestRequest || latestRequest === latestSeen.current || latestRequest.conversationId !== page.conversationId) return
    latestSeen.current = latestRequest; latest()
  }, [latestRequest, page.conversationId])
  useEffect(() => { if (imageResults && workspaceId) void imageResults.list({ workspaceId, conversationId: page.conversationId }).catch(() => {}) }, [imageResults, workspaceId, page.conversationId])
  const observed = useRef(new Set<string>())
  const firstVisibleCallback = useRef(onFirstVisible); firstVisibleCallback.current = onFirstVisible
  useEffect(() => {
    if (!firstVisibleCallback.current) { probeVisibility.current = () => {}; return }
    const candidates = visibleEntries.flatMap(entry => entry.kind === 'item' ? [entry.item] : entry.kind === 'tools' && expanded.has(entry.key) ? entry.items : [])
      .filter(item => !observed.current.has(item.taskId) && (item.type === 'text' || item.type === 'edit') && item.body.parts.some(part => part.kind === 'text' && part.text.trim()))
    let frames: { first: number; second?: number } | undefined
    const schedule = () => {
      if (frames || !candidates.some(item => !observed.current.has(item.taskId))) return
      const pending = { first: 0, second: undefined as number | undefined }; frames = pending
      pending.first = requestAnimationFrame(() => { pending.second = requestAnimationFrame(() => {
        frames = undefined
        const host = scroller.current, parent = region.current
        if (!host || !parent) return
        const viewport = host.getBoundingClientRect(), cards = new Map([...parent.querySelectorAll<HTMLElement>('.execution-timeline__card[data-execution-item]')].map(node => [node.dataset.executionItem, node]))
        for (const item of candidates) {
          if (observed.current.has(item.taskId)) continue
          const content = [...cards.get(`${item.runId}:${item.itemId}`)?.querySelectorAll<HTMLElement>('.execution-timeline__content') ?? []].find(node => node.textContent?.trim())
          if (!content) continue
          const bounds = content.getBoundingClientRect()
          if (bounds.width <= 0 || bounds.height <= 0 || bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
          observed.current.add(item.taskId); firstVisibleCallback.current?.(item.taskId, item.itemId, captureRendererTiming())
        }
      }) })
    }
    probeVisibility.current = schedule; schedule()
    return () => {
      probeVisibility.current = () => {}
      if (frames) { cancelAnimationFrame(frames.first); if (frames.second !== undefined) cancelAnimationFrame(frames.second) }
    }
  }, [layoutVersion, Boolean(onFirstVisible)])
  const card = (item: ExecutionTimelineWindowItem) => {
    const key = `${item.runId}:${item.itemId}`, fact = facts.get(JSON.stringify([item.runId, item.itemId]))!
    return <TimelineItemCard key={key} item={item} conversationId={page.conversationId} facts={fact} ended={fact.ended} endStatus={fact.endStatus}
      parentLabel={fact.parent ? readableExecutionData(fact.parent.label || titles[fact.parent.type]) : undefined} runCommitSequence={fact.runCommitSequence}
      readBlob={readBlob} readBody={control.readBody} onLocateDocument={onLocateDocument} onOpenSavedFile={onOpenSavedFile}
      imageResults={imageResults} workspaceId={workspaceId} expanded={expanded.has(key)} onExpanded={open => toggle(key, open)} snapshotVersion={snapshotVersion} />
  }
  return <section ref={region} className="execution-timeline" aria-label="任务过程" aria-busy={page.activity.busy || busy || control.busy}>
    {searchEvents && historySearchOpen === undefined && !localSearchOpen && <button type="button" onClick={() => setLocalSearchOpen(true)}>搜索历史</button>}
    {searchEvents && (historySearchOpen ?? localSearchOpen) && <HistorySearch searchEvents={searchEvents} readBlob={readBlob} onClose={historySearchOpen === undefined ? () => setLocalSearchOpen(false) : onHistorySearchClose ?? (() => {})} />}
    {error && <p role="alert">{error}</p>}
    {page.start > 0 && <button type="button" disabled={busy} onClick={() => {
      const host = scroller.current; if (host) prepend.current = { height: host.scrollHeight, top: host.scrollTop }
      follow.current = false; setFollowing(false); void requestPage({ start: Math.max(0, page.start - PAGE_SIZE), limit: PAGE_SIZE })
    }}>读取更早记录（前面还有 {page.start} 条）</button>}
    {page.total === 0 && <p className="execution-timeline__empty">这段会话还没有执行记录。</p>}
    {visibleEntries.map(entry => {
      if (entry.kind === 'message') return <article className="execution-assistant__user-message" aria-label="用户消息" key={entry.message.messageId}><strong>你</strong><p>{entry.message.text}</p></article>
      if (entry.kind === 'item') return card(entry.item)
      return <article key={entry.key} className="execution-timeline__tool-group" data-execution-item={`${entry.runId}:${entry.firstItemId}`} aria-label="工具组">
        <details open={expanded.has(entry.key)} onToggle={event => { if (event.currentTarget.open !== expanded.has(entry.key)) toggle(entry.key, event.currentTarget.open) }}>
          <summary>{entry.summary}{entry.source === 'external-mcp' && <small>外部 MCP</small>}</summary>
          {expanded.has(entry.key) && <div className="execution-timeline__group-details">{entry.items.map(card)}
            {entry.itemStart > 0 && <button type="button" disabled={busy} onClick={() => void requestGroup(entry, false, true)}>读取组内更早记录</button>}
            {entry.itemEnd < entry.itemCount && <button type="button" disabled={busy} onClick={() => void requestGroup(entry)}>读取组内后续记录（剩余 {entry.itemCount - entry.itemEnd} 条）</button>}
          </div>}
        </details>
        {entry.files.length > 0 && onOpenSavedFile && <div className="execution-timeline__group-files">{entry.files.map(item => <button type="button" key={item.itemId} onClick={() => onOpenSavedFile(item.runId, item.itemId)}>打开文件：{item.data.documentName || '已保存文件'}</button>)}
          {entry.fileStart > 0 && <button type="button" disabled={busy} onClick={() => void requestGroup(entry, true, true)}>读取更早已保存文件</button>}
          {entry.fileEnd < entry.fileCount && <button type="button" disabled={busy} onClick={() => void requestGroup(entry, true)}>读取后续已保存文件（剩余 {entry.fileCount - entry.fileEnd} 个）</button>}
        </div>}
      </article>
    })}
    {activityText && <p className="execution-timeline__activity" role="status" aria-live="polite" aria-atomic="true">{activityText}</p>}
    {page.end < page.total && <button type="button" disabled={busy} onClick={() => { follow.current = false; setFollowing(false); void requestPage({ start: page.end, limit: PAGE_SIZE }) }}>读取更后记录</button>}
    {!following && <button type="button" className="execution-timeline__latest" onClick={latest}>回到最新{page.total > page.end ? `（${page.total - page.end} 条新记录）` : ''}</button>}
  </section>
}

/** A read-only view. Pagination, expansion and scrolling never replay a tool or focus the composer. */
export function ExecutionTimeline(props: ExecutionTimelineProps | ExecutionTimelineWindowProps) {
  const readings = useRef(new Map<string, ReadingState>())
  const readingStates = props.readingStates ?? readings.current
  const searchEvents = useMemo<ExecutionTimelineProps['searchEvents']>(() => props.searchEvents ? async input => {
    const page = await props.searchEvents!(input)
    return { ...page, hits: page.hits.filter(hit => hit.event.type !== 'usage') }
  } : undefined, [props.searchEvents])
  if ('window' in props) return <ControlledTimeline key={props.window.page.conversationId} {...props} searchEvents={searchEvents} readings={readingStates} />
  const projection = props.projection
  return <LocalTimeline key={projection.conversationId} {...props} projection={projection} searchEvents={searchEvents} readings={readingStates} />
}
