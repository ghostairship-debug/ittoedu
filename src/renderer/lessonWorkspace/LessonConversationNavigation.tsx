import { useEffect, useRef, useState } from 'react'
import type { LessonConversation, LessonWorkspace } from '../../shared/lessonWorkspace'
import type { LessonDesktopRequest, LessonDesktopResult } from '../../shared/lessonDesktopContract'

export interface LessonConversationNavigationProps {
  lesson: LessonWorkspace
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
  const [pendingDelete, setPendingDelete] = useState<LessonConversation | 'lesson' | 'all' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(props); latest.current = props
  const lessonKey = `${props.lesson.identity.lessonId}/${props.lesson.identity.normalizedDirectory}`
  const activeKey = useRef(lessonKey); activeKey.current = lessonKey
  useEffect(() => { setQuery(''); setMatches(null); setPendingDelete(null); setError(null) }, [lessonKey])
  useEffect(() => {
    let live = true
    if (!query.trim()) { setMatches(null); return }
    const timer = setTimeout(() => {
      void props.operation({ operation: 'search-conversations', lesson: props.lesson.identity, query: query.trim() }).then(result => {
        if (live) setMatches(result.matches ?? [])
      }).catch(reason => { if (live) setError((reason as Error).message) })
    }, 150)
    return () => { live = false; clearTimeout(timer) }
  }, [query, lessonKey, props.operation, props.conversations])
  async function run(action: (current: LessonConversationNavigationProps) => Promise<void>) {
    if (busy) return
    const captured = latest.current
    setBusy(true); setError(null)
    try { await action(captured) } catch (reason) { if (activeKey.current === lessonKey) setError((reason as Error).message) }
    finally { setBusy(false) }
  }
  async function create(parent?: LessonConversation) {
    await run(async captured => {
      const result = await captured.operation(parent
        ? { operation: 'branch-conversation', lesson: captured.lesson.identity, conversationId: parent.conversationId }
        : { operation: 'create-conversation', lesson: captured.lesson.identity })
      if (!result.conversation) throw new Error('对话尚未创建')
      if (activeKey.current !== lessonKey) return
      captured.onRecordsChange([...captured.conversations, result.conversation])
      await captured.onSelect(result.conversation)
    })
  }
  async function remove() {
    if (!pendingDelete) return
    const scope = pendingDelete
    await run(async captured => {
      const result = await captured.operation(scope === 'all' ? { operation: 'delete-all-application-records' }
        : { operation: 'delete-conversation', lesson: captured.lesson.identity, ...(scope === 'lesson' ? {} : { conversationId: scope.conversationId }) })
      if (activeKey.current !== lessonKey) return
      const records = result.conversations ?? []
      captured.onRecordsChange(records)
      captured.onDeleted?.(captured.conversations.filter(record => !records.some(next => next.conversationId === record.conversationId)).map(record => record.conversationId))
      setPendingDelete(null); setMatches(null); setQuery('')
    })
  }
  const visible = matches === null ? props.conversations : props.conversations.filter(record => matches.some(match => match.conversationId === record.conversationId))
  return <section className="lesson-conversation-navigation" aria-label="课例对话导航">
    <div className="lesson-conversation-navigation-head"><label>搜索对话<input aria-label="搜索对话" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题和消息" /></label><button type="button" className="lesson-primary-action" disabled={busy} onClick={() => { void create() }}>新对话</button></div>
    {error && <p role="alert">{error}</p>}
    <ul>{visible.map(record => <li key={record.conversationId}>
      <button type="button" className="lesson-conversation-select" disabled={busy} aria-pressed={record.conversationId === props.currentId} onClick={() => { void run(current => current.onSelect(record)) }}>{record.title}</button>
      {record.parentConversationId && <small>讨论分支</small>}
      {matches?.find(match => match.conversationId === record.conversationId)?.excerpt && <small>{matches.find(match => match.conversationId === record.conversationId)!.excerpt}</small>}
      <details className="lesson-conversation-more"><summary aria-label={`${record.title}更多操作`}>···</summary><button type="button" disabled={busy} aria-label={`从${record.title}创建讨论分支`} onClick={() => { void create(record) }}>创建讨论分支</button><button type="button" disabled={busy} aria-label={`删除${record.title}的应用记录`} onClick={() => setPendingDelete(record)}>删除应用记录</button></details>
    </li>)}</ul>
    {query && matches?.length === 0 && <p>未找到匹配的对话</p>}
    <details className="lesson-conversation-records"><summary>管理对话记录</summary><button type="button" disabled={busy} onClick={() => setPendingDelete('lesson')}>删除本课例对话记录</button><button type="button" disabled={busy} onClick={() => setPendingDelete('all')}>删除全部应用对话记录</button></details>
    {pendingDelete && <div role="dialog" aria-label="确认删除对话记录">
      <p>{pendingDelete === 'all' ? '删除全部课例和独立工程的应用对话、任务与日志？' : pendingDelete === 'lesson' ? `删除“${props.lesson.manifest.title}”的全部对话、任务与日志？` : `删除“${pendingDelete.title}”的对话、任务与日志？`}</p>
      <p>运行中的任务将停止。课例文件、附件、工程和未保存恢复稿保留；外部 CLI 历史不受影响。</p>
      <button type="button" disabled={busy} onClick={() => setPendingDelete(null)}>取消</button>
      <button type="button" disabled={busy} onClick={() => { void remove() }}>确认删除记录</button>
    </div>}
  </section>
}
