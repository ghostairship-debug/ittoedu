import { useEffect, useMemo, useRef, useState } from 'react'
import type { LessonWorkspace, LessonConversation } from '../../../shared/lessonWorkspace'
import { normalizeWorkspacePath, type ConversationAgentWorkspace } from '../../../shared/workspaceIdentity'
import type { LocalAgentEvent, LocalAgentId, LocalAgentRecord } from '../../../shared/localAgentContract'
import { aiQuestionSchema, aiInputDeliverySchema } from '../../../shared/localAgentInteraction'
import { CourseChatPanel } from './CourseChatPanel'
import { CourseChatTranscript } from './CourseChatTranscript'
import { NativeAgentConfiguration } from './NativeAgentConfiguration'
import { ChatComposerMenus, useDirectoryMentions } from './ChatComposerMenus'
import { NativeAgentQuestion } from './NativeAgentQuestion'
import { readableChatError } from './readableChatStatus'
import { chatRecordTime, mergeChatEvents } from './courseChatHistory'
import { DocumentAiTaskController, type DocumentChatTarget } from '../../documentFiles/documentAiTaskController'
import { MAX_GENERATION_TASK_DURATION_MS } from '../../../shared/generationContract'

export function LessonConversationChat({ lesson, conversation, projectId, projectPath, documentTarget }: {
  lesson: LessonWorkspace; conversation: LessonConversation; projectId: string; projectPath: string | null
  documentTarget?: DocumentChatTarget
}) {
  const workspace = useMemo(() => ({ version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId,
    normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId }), [lesson.identity.lessonId, lesson.identity.normalizedDirectory, conversation.conversationId])
  const bound = !!projectPath && conversation.projectTarget?.projectId === projectId && conversation.projectTarget.normalizedPath.replace(/\\/g, '/').toLowerCase() === projectPath.replace(/\\/g, '/').toLowerCase()
  return <LessonDiscussion key={JSON.stringify(workspace)} workspace={workspace} projectId={projectId} projectPath={bound ? projectPath : null} documentTarget={documentTarget} />
}
/** 工作空间/项目文件夹的普通讨论会话：同一套讨论界面，不带课例文档编辑入口。 */
export function DirectoryConversationChat({ root, conversation, documentTarget, projectId = '', projectPath = null }: {
  root: string; conversation: LessonConversation; documentTarget?: DocumentChatTarget; projectId?: string; projectPath?: string | null
}) {
  const workspace = useMemo(() => ({ version: 1 as const, kind: 'directory' as const,
    normalizedDirectory: normalizeWorkspacePath(root), conversationId: conversation.conversationId }), [root, conversation.conversationId])
  const bound = !!projectPath && conversation.projectTarget?.projectId === projectId
    && conversation.projectTarget.normalizedPath.replace(/\\/g, '/').toLowerCase() === projectPath.replace(/\\/g, '/').toLowerCase()
  return <LessonDiscussion key={JSON.stringify(workspace)} workspace={workspace} projectId={bound ? projectId : ''} projectPath={bound ? projectPath : null} documentTarget={documentTarget} />
}
function LessonDiscussion({ workspace, projectId, projectPath, documentTarget }: { workspace: ConversationAgentWorkspace; projectId: string; projectPath: string | null; documentTarget?: DocumentChatTarget }) {
  const mentions = useDirectoryMentions(workspace.normalizedDirectory)
  const [adapter, setAdapter] = useState<LocalAgentId>('codex')
  const [inputKind, setInputKind] = useState<'correct' | 'supplement'>('correct')
  const [deliveryNotice, setDeliveryNotice] = useState('')
  const [extendingBudget, setExtendingBudget] = useState(false)
  const draftKey = `lesson-chat-draft:${JSON.stringify(workspace)}`
  const [instruction, setInstruction] = useState(() => { try { return localStorage.getItem(draftKey) ?? '' } catch { return '' } }), [error, setError] = useState('')
  const [pinnedDocument, setPinnedDocument] = useState<DocumentChatTarget>(), [documentStatus, setDocumentStatus] = useState('')
  const documentTask = useRef<DocumentAiTaskController | null>(null)
  const documentTaskGeneration = useRef(0), documentSession = useRef<string | undefined>(undefined)
  useEffect(() => { try { if (instruction) localStorage.setItem(draftKey, instruction); else localStorage.removeItem(draftKey) } catch {} }, [draftKey, instruction])
  useEffect(() => () => { documentTaskGeneration.current++; void documentTask.current?.stop().catch(() => {}) }, [])
  const [events, setEvents] = useState<LocalAgentEvent[]>([]), [records, setRecords] = useState<LocalAgentRecord[]>([])
  const [sending, setSending] = useState(false), [configurationSaving, setConfigurationSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const pending = useRef<string | undefined>(undefined), generation = useRef(0)
  const api = window.desktopAPI
  const running = records.filter(record => 'kind' in record.workspace && record.status === 'running').sort((a, b) => chatRecordTime(b) - chatRecordTime(a))[0]
  const canExtend = !!running?.task?.deadlineAt && !!running.task.startedAt && running.task.deadlineAt > Date.now()
    && running.task.deadlineAt + 20 * 60000 <= running.task.startedAt + MAX_GENERATION_TASK_DURATION_MS
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout> | undefined
    const token = ++generation.current
    const cache = new Map<string, { events: LocalAgentEvent[]; status: string }>()
    async function refresh() {
      try {
        if (!api) return
        const result = await api.localAgent({ operation: 'lesson-list', workspace })
        if (!live) return
        const next = result.records ?? []
        if (result.damaged?.length) setError('部分对话记录不可用，其他记录仍可继续。')
        const history: LocalAgentEvent[] = []
        for (const record of next) {
          const cached = cache.get(record.id)
          const status = JSON.stringify([record.status, record.task, record.hostResult])
          if (cached && cached.status === status && record.status !== 'running') { history.push(...cached.events); record.events = cached.events; continue }
          let collected = cached?.events ?? []
          let after = collected.reduce((max, event) => Math.max(max, event.sequence), 0)
          for (;;) {
            const page = await api.localAgent({ operation: 'lesson-read', workspace, sessionId: record.id, after })
            if (!live || token !== generation.current) return
            const items = page.records?.[0]?.events ?? []
            const incoming = items.filter(event => event.sequence > after)
            collected = mergeChatEvents(collected, incoming)
            if (items.length < 200) break
            if (!incoming.length) throw new Error('对话记录读取未前进')
            after = Math.max(...incoming.map(event => event.sequence))
          }
          cache.set(record.id, { events: collected, status }); record.events = collected; history.push(...collected)
        }
        if (live) {
          for (const id of cache.keys()) if (!next.some(record => record.id === id)) cache.delete(id)
          if (pending.current && next.some(record => record.id === pending.current)) pending.current = undefined
          setRecords(next); setEvents(mergeChatEvents([], history)); setLoaded(true)
        }
      } catch (cause) { if (live) setError(readableChatError(cause)) }
      finally { if (live) timer = setTimeout(() => void refresh(), 1000) }
    }
    void refresh()
    return () => { live = false; generation.current++; if (timer) clearTimeout(timer) }
  }, [api, workspace])
  async function send() {
    if (!api || !instruction.trim() || sending || configurationSaving) return
    const token = generation.current, prompt = instruction.trim()
    setSending(true); setError('')
    try {
      if (pinnedDocument && !running) {
        if (!api.lessonDocumentAi) throw new Error('文档修改入口未连接')
        const documentToken = ++documentTaskGeneration.current
        const controller = new DocumentAiTaskController(api.lessonDocumentAi, workspace, message => {
          if (documentTaskGeneration.current === documentToken) setDocumentStatus(message)
        })
        documentTask.current = controller
        documentSession.current = undefined
        const sessionId = await controller.start(pinnedDocument, adapter, prompt)
        if (documentTaskGeneration.current === documentToken) { documentSession.current = sessionId; pending.current = sessionId }
      } else if (running?.task) {
        const result = await api.localAgent({ operation: 'lesson-input', workspace, sessionId: running.id,
          input: { version: 1, kind: inputKind, inputId: crypto.randomUUID(), taskId: running.task.taskId, epoch: running.task.epoch, workspace: running.workspace, turnId: running.task.turnId, text: prompt } })
        if (!result.inputDelivery || result.inputDelivery.status === 'rejected') throw new Error(result.inputDelivery?.reason ?? 'CLI 没有接受输入')
        if (token === generation.current) setDeliveryNotice(result.inputDelivery.reason ?? (result.inputDelivery.status === 'queued' ? '已接收，将在下一回合处理。' : '已送达当前任务。'))
      }
      else {
        const prior = records.filter(record => record.adapter === adapter).sort((a, b) => chatRecordTime(b) - chatRecordTime(a))[0]
        const frozenTarget = { kind: 'directory' as const, directory: normalizeWorkspacePath(workspace.normalizedDirectory) }
        const result = await api.localAgent(prior?.externalSessionId
          ? { operation: 'lesson-resume', workspace, sessionId: prior.id, prompt, frozenTarget }
          : { operation: 'lesson-start', workspace, adapter, prompt, intent: 'discuss', frozenTarget })
        if (!result.sessionId) throw new Error('CLI 尚未建立任务，请重试')
        pending.current = result.sessionId
      }
      if (token === generation.current) setInstruction(current => current.trim() === prompt ? '' : current)
    } catch (cause) { if (token === generation.current) setError(readableChatError(cause)) }
    finally { if (token === generation.current) setSending(false) }
  }
  const answered = new Set(events.flatMap(event => {
    const payload = event.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.status !== 'input-delivery') return []
    const parsed = aiInputDeliverySchema.safeParse(payload.delivery)
    return parsed.success && parsed.data.status !== 'rejected' ? [parsed.data.questionId] : []
  }))
  const questions = events.filter(event => event.sessionId === running?.id).flatMap(event => {
    const payload = event.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.status !== 'question') return []
    const parsed = aiQuestionSchema.safeParse(payload.question)
    return parsed.success && !answered.has(parsed.data.questionId) ? [parsed.data] : []
  })
  if (projectPath && loaded && !running && !pending.current && !sending && !instruction && !documentTarget && !pinnedDocument && !documentStatus) {
    return <CourseChatPanel embedded projectId={projectId} projectPath={projectPath} lessonWorkspace={workspace.kind === 'lesson' ? workspace : undefined} initialHistory={events} onClose={() => {}} />
  }
  return <aside className="course-chat course-chat--embedded" aria-label="课例创作助手">
    <header><strong>创作助手</strong></header>
    {documentTarget && <button disabled={!!running || sending} onClick={() => setPinnedDocument(documentTarget)}>编辑当前文档</button>}
    {pinnedDocument && <div role="status">本次修改文档：{pinnedDocument.name}（全文）<button disabled={!!running || sending} onClick={() => {
      documentTaskGeneration.current++; documentTask.current = null; documentSession.current = undefined
      setPinnedDocument(undefined); setDocumentStatus('')
    }}>移除文档引用</button></div>}
    {documentStatus && <p role="status">{documentStatus}</p>}
    <div className="chat-scroll"><CourseChatTranscript events={events} />
      {!events.length && <div className="chat-empty"><strong>从这里开始讨论</strong><p>说明教学主题，或打开右侧文档，选择“编辑当前文档”。</p></div>}
      {questions.map(question => <NativeAgentQuestion key={question.questionId} question={question} onAnswer={async input => {
        if (!api || !running) throw new Error('当前任务已结束')
        const result = await api.localAgent({ operation: 'lesson-input', workspace, sessionId: running.id, input })
        if (!result.inputDelivery || result.inputDelivery.status === 'rejected') throw new Error(result.inputDelivery?.reason ?? 'CLI 没有接受回答')
      }} />)}
      {error && <p role="alert">{error}</p>}
      {!!running && deliveryNotice && <p role="status">{deliveryNotice}</p>}
    </div>
    {!!running && <label>输入用途<select aria-label="输入用途" value={inputKind} onChange={event => setInputKind(event.target.value as typeof inputKind)}><option value="correct">立即引导</option><option value="supplement">下一回合补充</option></select></label>}
    {canExtend && <button disabled={extendingBudget} onClick={async () => {
      if (!api || !running?.task) return
      const token = generation.current
      setExtendingBudget(true)
      try {
        const result = await api.localAgent({ operation: 'lesson-input', workspace, sessionId: running.id, input: {
          version: 1, kind: 'extend-budget', minutes: 20, taskId: running.task.taskId, epoch: running.task.epoch,
          inputId: crypto.randomUUID(), turnId: running.task.turnId, workspace: running.workspace,
        } })
        if (!result.inputDelivery || result.inputDelivery.status === 'rejected') throw new Error(result.inputDelivery?.reason ?? '未能延长本次预算')
        if (token === generation.current) {
          setDeliveryNotice('本次任务预算已增加 20 分钟')
          const deadlineAt = result.inputDelivery.deadlineAt
          if (deadlineAt) setRecords(current => current.map(record => record.id === running.id && record.task
            ? { ...record, task: { ...record.task, deadlineAt } } : record))
        }
      } catch (cause) { if (token === generation.current) setError(readableChatError(cause)) }
      finally { if (token === generation.current) setExtendingBudget(false) }
    }}>{extendingBudget ? '正在延长预算…' : '增加20分钟'}</button>}
    <div className="chat-composer-controls">
      <label className="chat-cli-picker">CLI <select aria-label="CLI" value={adapter} disabled={!!running || sending} onChange={event => setAdapter(event.target.value as LocalAgentId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option></select></label>
      <NativeAgentConfiguration adapter={adapter} configurationSequence={0} onSavingChange={setConfigurationSaving} />
    </div>
    <ChatComposerMenus value={instruction} onChange={setInstruction}
      commands={[{ id: 'stop', label: '停止当前任务', run: () => {
        const sessionId = running?.id ?? pending.current
        if (sessionId) void api?.localAgent({ operation: 'lesson-cancel', workspace, sessionId })
      } }]}
      mentions={mentions} />
    <textarea aria-label="给创作助手的消息" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="说明教学主题，或一起讨论当前文档…" />
    <div className="chat-send-actions"><button disabled={!loaded || sending || !!pending.current || configurationSaving || !instruction.trim()} onClick={() => void send()}>{running ? '发送输入' : '发送'}</button>
      {(running || pending.current || sending) && <button onClick={() => {
        const sessionId = running?.id ?? pending.current, documentToken = documentTaskGeneration.current
        if (!sessionId || sessionId === documentSession.current) void documentTask.current?.stop().catch(cause => {
          if (documentTaskGeneration.current === documentToken) setError(readableChatError(cause))
        })
        if (sessionId) void api?.localAgent({ operation: 'lesson-cancel', workspace, sessionId }).catch(cause => setError(readableChatError(cause)))
      }}>停止</button>}</div>
  </aside>
}
