import { useEffect, useMemo, useRef, useState } from 'react'
import type { LessonWorkspace, LessonConversation } from '../../../shared/lessonWorkspace'
import { normalizeWorkspacePath, sameWorkspacePath, type ConversationAgentWorkspace } from '../../../shared/workspaceIdentity'
import type { LocalAgentEvent, LocalAgentId, LocalAgentRecord } from '../../../shared/localAgentContract'
import { localAgentCapabilitiesSchema } from '../../../shared/localAgentContract'
import { aiQuestionSchema, aiInputDeliverySchema } from '../../../shared/localAgentInteraction'
import { CourseChatPanel } from './CourseChatPanel'
import { CourseChatTranscript } from './CourseChatTranscript'
import { NativeAgentConfiguration } from './NativeAgentConfiguration'
import { ChatComposerMenus, useDirectoryMentions, type ChatComposerMenusHandle } from './ChatComposerMenus'
import { NativeAgentQuestion } from './NativeAgentQuestion'
import { readableChatError } from './readableChatStatus'
import { chatRecordTime, mergeChatEvents } from './courseChatHistory'
import { DocumentAiTaskController, type DocumentChatTarget } from '../../documentFiles/documentAiTaskController'
import { MAX_GENERATION_TASK_DURATION_MS } from '../../../shared/generationContract'
import { contextualTargetOf, describeContextualTarget, freezeDocumentEditTarget, type DocumentEditScope } from './documentContextTarget'
import type { ContextualEditTarget } from '../../../shared/document/ports'
import { useExternalAiNotice } from './useExternalAiNotice'

export function LessonConversationChat({ lesson, conversation, projectId, projectPath, documentTarget }: {
  lesson: LessonWorkspace; conversation: LessonConversation; projectId: string; projectPath: string | null
  documentTarget?: DocumentChatTarget
}) {
  const workspace = useMemo(() => ({ version: 1 as const, kind: 'lesson' as const, lessonId: lesson.identity.lessonId,
    normalizedDirectory: lesson.identity.normalizedDirectory, conversationId: conversation.conversationId }), [lesson.identity.lessonId, lesson.identity.normalizedDirectory, conversation.conversationId])
  const bound = !!projectPath && conversation.projectTarget?.projectId === projectId && sameWorkspacePath(conversation.projectTarget.normalizedPath, projectPath)
  return <LessonDiscussion key={JSON.stringify(workspace)} workspace={workspace} projectId={projectId} projectPath={bound ? projectPath : null} documentTarget={documentTarget} />
}
/** 工作空间/项目文件夹的普通讨论会话：同一套讨论界面，不带课例文档编辑入口。 */
export function DirectoryConversationChat({ root, conversation, documentTarget, projectId = '', projectPath = null }: {
  root: string; conversation: LessonConversation; documentTarget?: DocumentChatTarget; projectId?: string; projectPath?: string | null
}) {
  const workspace = useMemo(() => ({ version: 1 as const, kind: 'directory' as const,
    normalizedDirectory: normalizeWorkspacePath(root), conversationId: conversation.conversationId }), [root, conversation.conversationId])
  const bound = !!projectPath && conversation.projectTarget?.projectId === projectId
    && sameWorkspacePath(conversation.projectTarget.normalizedPath, projectPath)
  return <LessonDiscussion key={JSON.stringify(workspace)} workspace={workspace} projectId={bound ? projectId : ''} projectPath={bound ? projectPath : null} documentTarget={documentTarget} />
}
function LessonDiscussion({ workspace, projectId, projectPath, documentTarget }: { workspace: ConversationAgentWorkspace; projectId: string; projectPath: string | null; documentTarget?: DocumentChatTarget }) {
  const mentions = useDirectoryMentions(workspace.normalizedDirectory)
  const composerMenus = useRef<ChatComposerMenusHandle>(null)
  const [adapter, setAdapter] = useState<LocalAgentId>('codex')
  const [inputKind, setInputKind] = useState<'correct' | 'supplement'>('correct')
  const [deliveryNotice, setDeliveryNotice] = useState('')
  const [extendingBudget, setExtendingBudget] = useState(false)
  const draftKey = `lesson-chat-draft:${JSON.stringify(workspace)}`
  const [instruction, setInstruction] = useState(() => { try { return localStorage.getItem(draftKey) ?? '' } catch { return '' } }), [error, setError] = useState('')
  const [pinnedDocument, setPinnedDocument] = useState<DocumentChatTarget>(), [documentScope, setDocumentScope] = useState<DocumentEditScope>(), [documentStatus, setDocumentStatus] = useState('')
  const automaticDocument = !pinnedDocument && contextualTargetOf(documentTarget) ? documentTarget : undefined
  const documentTask = useRef<DocumentAiTaskController | null>(null)
  const documentTaskGeneration = useRef(0), documentSession = useRef<string | undefined>(undefined)
  useEffect(() => { try { if (instruction) localStorage.setItem(draftKey, instruction); else localStorage.removeItem(draftKey) } catch {} }, [draftKey, instruction])
  useEffect(() => () => { documentTaskGeneration.current++; void documentTask.current?.stop().catch(() => {}) }, [])
  // A target's getEditor callback is intentionally a live lookup and may return
  // a fresh handle on every render. Compare the stable document label here; the
  // controller performs the final ref/version check at send time.
  const documentTargetChanged = Boolean(pinnedDocument && documentTarget && pinnedDocument.getEditor()?.session !== documentTarget.getEditor()?.session)
  useEffect(() => {
    if (documentTargetChanged) setDocumentStatus('文档目标已切换，原冻结目标已失效，请重新选择。')
  }, [documentTargetChanged])
  const [events, setEvents] = useState<LocalAgentEvent[]>([]), [records, setRecords] = useState<LocalAgentRecord[]>([])
  const [configurationSession, setConfigurationSession] = useState<{ adapter: LocalAgentId; id: string | null }>()
  const [sending, setSending] = useState(false), [configurationSaving, setConfigurationSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const pending = useRef<string | undefined>(undefined), generation = useRef(0), sendGeneration = useRef(0)
  const api = window.desktopAPI
  const externalNotice = useExternalAiNotice(api)
  // Main computes the reference list from the same final request the send uses.
  // The renderer only contributes facts that list does not cover (message @refs).
  const noticeInput = (prompt: string, target: LocalAgentId, extra: readonly string[] = []) => ({ scope: workspace, adapter: target,
    referencesScope: { kind: 'conversation' as const, workspace, prompt: prompt.trim() || '（本轮没有新的教师消息）' },
    additionalReferences: [...mentions.filter(item => prompt.includes(`@${item.path}`)).map(item => `消息引用：${item.path}`), ...extra] })
  const running = records.filter(record => 'kind' in record.workspace && record.status === 'running').sort((a, b) => chatRecordTime(b) - chatRecordTime(a))[0]
  const latestSession = records.filter(record => record.adapter === adapter)
    .sort((a, b) => (b.task?.startedAt ?? chatRecordTime(b)) - (a.task?.startedAt ?? chatRecordTime(a)))[0]
  // A resumed turn has its own local native-session record. While a new start
  // is unresolved (or failed before returning an ID), never borrow an older confirmation.
  const awaitingSessionHistory = configurationSession?.adapter === adapter && !records.some(record => record.id === configurationSession.id)
  const configurationSessionId = awaitingSessionHistory ? configurationSession.id : latestSession?.id
  const configurationEvent = [...events].reverse().find(event => event.sessionId === configurationSessionId && event.adapter === adapter && event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
  const confirmedCapabilities = localAgentCapabilitiesSchema.safeParse(configurationEvent?.payload && typeof configurationEvent.payload === 'object' && !Array.isArray(configurationEvent.payload) ? configurationEvent.payload.capabilities : undefined)
  const documentTargetReady = !pinnedDocument || (!!documentScope && !documentTargetChanged)
  const canExtend = !!running?.task?.deadlineAt && !!running.task.startedAt && running.task.deadlineAt > Date.now()
    && running.task.deadlineAt + 20 * 60000 <= running.task.startedAt + MAX_GENERATION_TASK_DURATION_MS
  useEffect(() => documentTarget?.subscribeCommands?.((prompt, target) => {
    if (!loaded || running || sending || pending.current || configurationSaving) throw new Error('创作助手正在处理任务，请稍后发送。')
    setPinnedDocument(documentTarget); setDocumentScope('selection')
    setInstruction(prompt)
    void send({ document: documentTarget, prompt, target })
  }), [documentTarget, loaded, running, sending, configurationSaving])
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
  async function send(command?: { document: DocumentChatTarget; prompt: string; target: ContextualEditTarget }) {
    const prompt = command?.prompt.trim() ?? instruction.trim()
    if (!api || !prompt || sending || configurationSaving) return
    const token = generation.current
    const sendToken = ++sendGeneration.current
    const isCurrentSend = () => token === generation.current && sendToken === sendGeneration.current
    const editingDocument = command?.document ?? pinnedDocument ?? automaticDocument
    const editingScope = command ? 'selection' : pinnedDocument ? documentScope : automaticDocument ? 'selection' : undefined
    setSending(true); setError('')
    try {
      if (editingDocument && !running) {
        const documentToken = ++documentTaskGeneration.current
        if (!editingScope || documentTargetChanged) throw new Error(documentTargetChanged ? '文档目标已变化，请重新选择后再发送' : '请先选择“当前选区”或“全文”')
        const frozen = command?.target ?? freezeDocumentEditTarget(editingDocument, editingScope)
        if (!api.lessonDocumentAi) throw new Error('文档修改入口未连接')
        if (!await externalNotice.ensure(noticeInput(prompt, adapter, [`文档：${editingDocument.name}（全文作为上下文；允许修改：${frozen.label}）`]))) return
        if (!isCurrentSend() || documentTaskGeneration.current !== documentToken) return
        await documentTask.current?.stop()
        if (!isCurrentSend() || documentTaskGeneration.current !== documentToken) return
        const controller = new DocumentAiTaskController(api.lessonDocumentAi, workspace, (message, state) => {
          if (documentTaskGeneration.current !== documentToken) return
          if (state && state !== 'running') { if (pending.current === documentSession.current) pending.current = undefined; documentSession.current = undefined }
          setDocumentStatus(message)
        })
        documentTask.current = controller
        documentSession.current = undefined
        setConfigurationSession({ adapter, id: null })
        const sessionId = await controller.start({ ...editingDocument, applyPolicy: 'preview' }, adapter, prompt, undefined, frozen)
        if (documentTaskGeneration.current === documentToken) { documentSession.current = sessionId; pending.current = sessionId; setConfigurationSession({ adapter, id: sessionId ?? null }) }
      } else if (running?.task) {
        if (!await externalNotice.ensure(noticeInput(prompt, running.adapter)) || !isCurrentSend()) return
        const result = await api.localAgent({ operation: 'lesson-input', workspace, sessionId: running.id,
          input: { version: 1, kind: inputKind, inputId: crypto.randomUUID(), taskId: running.task.taskId, epoch: running.task.epoch, workspace: running.workspace, turnId: running.task.turnId, text: prompt } })
        if (!result.inputDelivery || result.inputDelivery.status === 'rejected') throw new Error(result.inputDelivery?.reason ?? 'CLI 没有接受输入')
        if (isCurrentSend()) setDeliveryNotice(result.inputDelivery.reason ?? (result.inputDelivery.status === 'queued' ? '已接收，将在下一回合处理。' : '已送达当前任务。'))
      }
      else {
        const prior = records.filter(record => record.adapter === adapter).sort((a, b) => chatRecordTime(b) - chatRecordTime(a))[0]
        const frozenTarget = { kind: 'directory' as const, directory: normalizeWorkspacePath(workspace.normalizedDirectory) }
        if (!await externalNotice.ensure(noticeInput(prompt, adapter)) || !isCurrentSend()) return
        setConfigurationSession({ adapter, id: null })
        const result = await api.localAgent(prior?.externalSessionId
          ? { operation: 'lesson-resume', workspace, sessionId: prior.id, prompt, frozenTarget }
          : { operation: 'lesson-start', workspace, adapter, prompt, intent: 'discuss', frozenTarget })
        if (!result.sessionId) throw new Error('CLI 尚未建立任务，请重试')
        if (!isCurrentSend()) { await api.localAgent({ operation: 'lesson-cancel', workspace, sessionId: result.sessionId }); return }
        pending.current = result.sessionId
        setConfigurationSession({ adapter, id: result.sessionId })
      }
      if (isCurrentSend()) setInstruction(current => current.trim() === prompt ? '' : current)
    } catch (cause) {
      if (isCurrentSend()) {
        const causeMessage = cause && typeof cause === 'object' && 'message' in cause ? String((cause as { message?: unknown }).message ?? '') : ''
        const direct = /选区|目标|文档|范围|保存期间|内容已改变/.test(causeMessage) ? causeMessage : null
        setError(direct ?? readableChatError(cause))
      }
    }
    finally { if (isCurrentSend()) setSending(false) }
  }
  function stopCurrentTask() {
    externalNotice.cancel()
    sendGeneration.current++; documentTaskGeneration.current++
    const sessionId = running?.id ?? pending.current, documentId = documentSession.current
    pending.current = undefined; documentSession.current = undefined
    setSending(false)
    if (!sessionId || sessionId === documentId) {
      void documentTask.current?.stop().catch(cause => setError(readableChatError(cause)))
      setDocumentStatus(documentTask.current ? '文档修改已停止，未应用的建议已丢弃。' : '')
    }
    if (sessionId && sessionId !== documentId) void api?.localAgent({ operation: 'lesson-cancel', workspace, sessionId }).catch(cause => setError(readableChatError(cause)))
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
    {externalNotice.dialog}
    <header><strong>创作助手</strong></header>
    {automaticDocument && <p role="status">本次修改：{automaticDocument.name} · {describeContextualTarget(automaticDocument).label}</p>}
    {documentTarget && <button disabled={!!running || sending} onClick={() => {
      setPinnedDocument(documentTarget); setDocumentScope(describeContextualTarget(documentTarget).hasSelection ? 'selection' : undefined); setDocumentStatus('')
    }}>编辑当前文档</button>}
    {pinnedDocument && <div role="status" aria-label="当前文档编辑目标">
      <strong>本次修改文档：{pinnedDocument.name}</strong>
      {documentScope ? (() => {
        try { const frozen = freezeDocumentEditTarget(pinnedDocument, documentScope); return <span>（{frozen.label}）</span> }
        catch { return <span>（目标已失效）</span> }
      })() : <span>（尚未选择范围）</span>}
      {!documentScope && !documentTargetChanged && <div><p>请选择本次修改范围：</p><button type="button" disabled={!!running || sending} onClick={() => setDocumentScope('document')}>选择全文</button>{Boolean(contextualTargetOf(pinnedDocument)) && <button type="button" disabled={!!running || sending} onClick={() => setDocumentScope('selection')}>选择当前选区</button>}</div>}
      {documentScope && <button type="button" disabled={!!running || sending} onClick={() => setDocumentScope(undefined)}>切换范围</button>}
      {documentTargetChanged && <p>当前文档已切换，请移除旧目标后重新选择。</p>}
      <button disabled={!!running || sending} onClick={() => {
        void documentTask.current?.stop().catch(cause => setError(readableChatError(cause)))
        documentTaskGeneration.current++; documentTask.current = null; documentSession.current = undefined
        setPinnedDocument(undefined); setDocumentScope(undefined); setDocumentStatus('')
      }}>移除文档引用</button></div>}
    {documentStatus && <p role="status">{documentStatus}</p>}
    <div className="chat-scroll"><CourseChatTranscript events={events} />
      {!events.length && <div className="chat-empty"><strong>从这里开始讨论</strong><p>说明教学主题，或打开右侧文档，选择“编辑当前文档”。</p></div>}
      {questions.map(question => <NativeAgentQuestion key={question.questionId} question={question} onAnswer={async input => {
        if (!api || !running) throw new Error('当前任务已结束')
        const token = generation.current
        if (!await externalNotice.ensure(noticeInput('', running.adapter)) || token !== generation.current) return
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
      <NativeAgentConfiguration adapter={adapter} configurationSequence={configurationEvent?.time ?? 0} onSavingChange={setConfigurationSaving} taskConfiguration={confirmedCapabilities.success ? confirmedCapabilities.data.current : undefined} />
      <button type="button" onClick={() => externalNotice.review(noticeInput(instruction, adapter))}>外部处理说明</button>
    </div>
    <ChatComposerMenus ref={composerMenus} value={instruction} onChange={setInstruction}
      commands={[{ id: 'stop', label: '停止当前任务', run: stopCurrentTask }]}
      mentions={mentions} />
    <textarea aria-label="给创作助手的消息" value={instruction} onChange={event => setInstruction(event.target.value)} onKeyDown={event => composerMenus.current?.handleKeyDown(event)} placeholder="说明教学主题，或一起讨论当前文档…" />
    <div className="chat-send-actions"><button disabled={!loaded || sending || !!pending.current || configurationSaving || !instruction.trim() || !documentTargetReady} onClick={() => void send()}>{running ? '发送输入' : '发送'}</button>
      {(running || pending.current || sending) && <button onClick={stopCurrentTask}>停止</button>}</div>
  </aside>
}
