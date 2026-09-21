import { useEffect, useRef, useState } from 'react'
import { conversationOwnerKey, type ConversationOwner, type LessonConversation } from '../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../shared/lessonDesktopContract'
import { RecordManagement } from './RecordManagement'

export interface LessonConversationNavigationProps {
  owner: ConversationOwner
  /** 归属显示名：课例标题、工作空间或项目名称。 */
  ownerLabel?: string
  conversations: LessonConversation[]
  currentId?: string
  operation(request: LessonDesktopRequest): Promise<LessonDesktopResult>
  onSelect(conversation: LessonConversation): Promise<void>
  onRecordsChange(records: LessonConversation[]): void
  onDeleted?(ids: string[]): void
}
export function LessonConversationNavigation(props: LessonConversationNavigationProps) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ conversationId: string; excerpt: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(props); latest.current = props
  const scopeKey = conversationOwnerKey(props.owner)
  const activeKey = useRef(scopeKey); activeKey.current = scopeKey
  const isLessonOwner = props.owner.kind === 'lesson'
  useEffect(() => { setQuery(''); setMatches(null); setError(null) }, [scopeKey])
  useEffect(() => {
    let live = true
    if (!query.trim()) { setMatches(null); return }
    const timer = setTimeout(() => {
      void props.operation({ operation: 'search-conversations', owner: props.owner, query: query.trim() }).then(result => {
        if (live) setMatches(result.matches ?? [])
      }).catch(reason => { if (live) setError((reason as Error).message) })
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [query, scopeKey, props.operation, props.conversations])
  async function run(action: (current: LessonConversationNavigationProps) => Promise<void>) {
    if (busy) return
    const captured = latest.current
    setBusy(true); setError(null)
    try { await action(captured) } catch (reason) { if (activeKey.current === scopeKey) setError((reason as Error).message) }
    finally { setBusy(false) }
  }
  async function create(parent?: LessonConversation) {
    await run(async captured => {
      const result = await captured.operation(parent
        ? { operation: 'branch-conversation', owner: captured.owner, conversationId: parent.conversationId }
        : { operation: 'create-conversation', owner: captured.owner })
      if (!result.conversation) throw new Error('对话尚未创建')
      if (activeKey.current !== scopeKey) return
      captured.onRecordsChange([...captured.conversations, result.conversation])
      await captured.onSelect(result.conversation)
    })
  }
  const visible = matches === null ? props.conversations : props.conversations.filter(record => matches.some(match => match.conversationId === record.conversationId))
  const sectionLabel = isLessonOwner ? '课例对话导航' : props.owner.kind === 'workspace' ? '工作空间对话导航' : '项目对话导航'
  return <RecordManagement owner={props.owner} ownerLabel={props.ownerLabel} conversations={props.conversations} operation={props.operation} onRecordsChange={props.onRecordsChange} onDeleted={props.onDeleted}>
    {records => <section className="lesson-conversation-navigation" aria-label={sectionLabel}>
      <div className="lesson-conversation-navigation-head"><label>搜索对话<input aria-label="搜索对话" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题和消息" /></label><button type="button" className="lesson-primary-action" disabled={busy || records.busy} onClick={() => { void create() }}>新对话</button></div>
      {error && <p role="alert">{error}</p>}
      <ul>{visible.map(record => <li key={record.conversationId}>
        <button type="button" className="lesson-conversation-select" disabled={busy || records.busy} aria-pressed={record.conversationId === props.currentId} onClick={() => { void run(current => current.onSelect(record)) }}>{record.title}</button>
        {record.parentConversationId && <small>讨论分支</small>}
        {matches?.find(match => match.conversationId === record.conversationId)?.excerpt && <small>{matches.find(match => match.conversationId === record.conversationId)!.excerpt}</small>}
        <details className="lesson-conversation-more"><summary aria-label={`${record.title}更多操作`}>···</summary><button type="button" disabled={busy || records.busy} aria-label={`从${record.title}创建讨论分支`} onClick={() => { void create(record) }}>创建讨论分支</button><button type="button" disabled={busy || records.busy} aria-label={`删除${record.title}的应用记录`} onClick={() => records.requestDelete(record)}>删除应用记录</button></details>
      </li>)}</ul>
      {query && matches?.length === 0 && <p>未找到匹配的对话</p>}
      {records.management}
    </section>}
  </RecordManagement>
}
