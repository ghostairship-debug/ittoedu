import { useEffect, useMemo, useRef, useState } from 'react'
import type { LocalAgentEvent, LocalAgentId, LocalAgentRecord } from '../../../shared/localAgentContract'
import { MAX_GENERATION_TASK_DURATION_MS, readGenerationFailure, type GenerationRequest } from '../../../shared/generationContract'
import type { MaterialRecordV1 } from '../../../shared/materialContract'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE } from '../../../shared/generationResult'
import { localAgentText } from '../../../shared/localAgentText'
import { latestLocalAgentTokenUsage } from '../../../shared/localAgentUsage'
import type { GenerationReferenceScope } from '../../authoring/generation/generationSnapshot'
import { GenerationTaskController, type GenerationTaskView } from '../../authoring/generation/generationTaskController'
import { selectActiveCourseProjectDocument, useEditorStore } from '../../store/editorStore'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { SafeChatMessage } from './SafeChatMessage'
import { NativeAgentQuestion } from './NativeAgentQuestion'
import { NativeAgentConfiguration } from './NativeAgentConfiguration'
import { GenerationCandidatePreview } from './GenerationCandidatePreview'
import { awaitCourseChatStage, createCourseChatObservation } from './courseChatObservation'
import { aiQuestionSchema, aiInputDeliverySchema } from '../../../shared/localAgentInteraction'
import './course-chat.css'

type Turn = { id: string; request: GenerationRequest; events: LocalAgentEvent[]; summary?: string }
type Preparation = { token: number; execution: NonNullable<GenerationRequest['execution']>; abort: AbortController }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const assistantText = (events: LocalAgentEvent[]) => {
  let text = localAgentText(events)
  for (const [open, close] of [[GENERATION_OPEN, GENERATION_CLOSE], [GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE]]) {
    for (let start = text.indexOf(open); start >= 0; start = text.indexOf(open)) {
      const end = text.indexOf(close, start + open.length)
      text = text.slice(0, start) + (end < 0 ? '' : text.slice(end + close.length))
    }
  }
  return text.trim()
}
const emptyView: GenerationTaskView = { busy: false, phase: 'completed', notice: '', events: [] }
const statusLabels = { observing: '正在同步', running: '运行中', 'waiting-input': '等待回答', checking: '正在检查',
  'awaiting-apply': '等待应用', committing: '正在应用', 'feeding-back': '正在核对',
  completed: '已完成', failed: '未完成', cancelled: '已停止', partial: '部分完成' }
export function resolveChatIntent(text: string, selected: 'discuss' | 'plan' | 'edit') {
  if (/先[^。\n]{0,18}(?:计划|方案)|只(?:做|写|出)(?:计划|方案)/.test(text)) return 'plan'
  if (/只(?:和我)?讨论|先(?:和我)?讨论/.test(text)) return 'discuss'
  if (/先别(?:修改|改动|动手)|不要(?:做任何动作|修改|改动|动手)|不(?:修改|改)课件/.test(text)) return selected === 'plan' ? 'plan' : 'discuss'
  // A user can explicitly defer an edit until after they answer a question. This
  // is a request-level decision only; model punctuation never changes the intent.
  if (selected === 'edit' && /先(?:问|询问)(?:我|用户)?[^\n]{0,48}(?:等(?:我|用户)?(?:回答|回复|答复)|(?:我|用户)?(?:回答|回复|答复)后)[^\n]{0,24}(?:再)?(?:修改|改动|动手)/.test(text)) return 'discuss'
  return selected
}
function nativeActivity(event: LocalAgentEvent): string | null {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : null
  if (event.kind === 'tool-call') return `CLI 正在使用：${String(payload?.name ?? payload?.toolName ?? payload?.tool ?? '原生工具').slice(0, 120)}`
  if (event.kind === 'tool-result') return payload?.isError ? 'CLI 工具执行失败，正在处理' : 'CLI 工具已返回结果'
  if (event.kind === 'failed') return typeof payload?.message === 'string' ? payload.message : 'CLI 本轮未完成'
  if (event.kind === 'session' && payload?.status === 'input-delivery') {
    const delivery = aiInputDeliverySchema.safeParse(payload.delivery)
    if (delivery.success) return ({ accepted: '输入已接收', queued: '输入已排队，等待下一回合', consumed: '输入已消费', rejected: '输入未接收' })[delivery.data.status]
  }
  return null
}
export function CourseChatPanel({ projectId, projectPath, onClose }: { projectId: string; projectPath: string | null; onClose(): void }) {
  const [adapter, setAdapter] = useState<LocalAgentId>('codex'), [scope, setScope] = useState<GenerationReferenceScope>('page')
  const [intent, setIntent] = useState<'discuss' | 'plan' | 'edit'>('edit'), [applyPolicy, setApplyPolicy] = useState<'auto' | 'preview'>('auto')
  const [inputKind, setInputKind] = useState<'supplement' | 'correct'>('supplement'), [wholeCourse, setWholeCourse] = useState(false)
  const [teachingPlan, setTeachingPlan] = useState(''), [presentationScript, setPresentationScript] = useState('')
  const [planConfirmed, setPlanConfirmed] = useState(false), [scriptConfirmed, setScriptConfirmed] = useState(false)
  const [visibleEvents, setVisibleEvents] = useState(100), [instruction, setInstruction] = useState('')
  const [sessions, setSessions] = useState<LocalAgentRecord[]>([]), [sessionId, setSessionId] = useState('')
  const [turns, setTurns] = useState<Turn[]>([]), [events, setEvents] = useState<LocalAgentEvent[]>([])
  const [materials, setMaterials] = useState<MaterialRecordV1[]>([]), [materialIds, setMaterialIds] = useState<string[]>([])
  const [view, setView] = useState<GenerationTaskView>(emptyView), [preparing, setPreparing] = useState(false)
  const [preparationExecution, setPreparationExecution] = useState<GenerationRequest['execution']>()
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [applied, setApplied] = useState<Pick<GenerationTaskView, 'receipt' | 'result' | 'sessionId'> | null>(null)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0), scroll = useRef<HTMLDivElement | null>(null), followReply = useRef(true)
  const preparation = useRef<Preparation | null>(null)
  const activeRequest = useRef<string | undefined>(undefined), behaviorEvidence = useRef<DynamicBehaviorObservation[]>([])
  const currentDocument = useEditorStore(selectActiveCourseProjectDocument), authoringSession = useEditorStore(state => state.courseAuthoringSession)
  const revision = currentDocument?.revision, busy = view.busy || preparing, api = window.desktopAPI
  const owner = useMemo(() => ({ projectId, projectPath: projectPath ?? '' }), [projectId, projectPath])
  const [resources, setResources] = useState<{ owner: typeof owner; api: typeof api;
    bridge: ReturnType<typeof createCourseChatObservation>; controller: GenerationTaskController } | null>(null)
  const currentResources = resources?.owner === owner && resources.api === api ? resources : null
  const bridge = currentResources?.bridge ?? null, controller = currentResources?.controller ?? null
  useEffect(() => {
    if (!projectPath || !api) { setResources(null); return }
    let live = true
    // Create and dispose both owners in the same effect lifetime. StrictMode's
    // setup/cleanup/setup must never reuse a terminally disposed observation.
    const bridge = createCourseChatObservation(api, owner)
    const controller = new GenerationTaskController({ api, owner,
      isCurrent: request => bridge.isCurrent(request), captureNext: (request, receipt) => bridge.captureNext(request, receipt, behaviorEvidence.current),
      async prepare(request, candidate) {
        try {
          const prepared = await useEditorStore.getState().prepareGenerationCandidate(request, candidate)
          if (live && activeRequest.current === request.requestId) behaviorEvidence.current = prepared.behaviorEvidence
          return prepared
        } catch (error) {
          if (live && activeRequest.current === request.requestId) behaviorEvidence.current = readGenerationFailure(error)?.behaviorEvidence ?? []
          throw error
        }
      },
      apply: id => useEditorStore.getState().applyGenerationCandidate(id), beforeApply: () => bridge.fileCurrent(),
      discard: () => useEditorStore.getState().discardGenerationCandidate(),
      onView(next) {
        if (!live) return
        if (next.request?.requestId !== activeRequest.current) { activeRequest.current = next.request?.requestId; behaviorEvidence.current = [] }
        setView(next); setEvents(next.events); setNotice(next.notice); setError(next.error ?? '')
        if (next.sessionId) setSessionId(next.sessionId)
        if (next.record) setSessions(prior => [...prior.filter(item => item.id !== next.record!.id), { ...next.record!, events: [] }])
        if (next.request) setTurns(prior => [...prior.filter(item => item.id !== next.request!.requestId), { id: next.request!.requestId, request: next.request!, events: next.events, summary: next.result?.summary }])
        if (next.receipt?.status === 'committed') setApplied({ receipt: next.receipt, result: next.result, sessionId: next.sessionId })
      },
    })
    setResources({ owner, api, bridge, controller })
    void api.localAgent({ operation: 'list', ...owner }).then(result => { if (live) setSessions(result.records ?? []) }).catch(reason => { if (live) setError(message(reason)) })
    void api.materials({ operation: 'search', ...owner, query: '' }).then(result => { if (live) setMaterials(result) }).catch(reason => { if (live) setError(message(reason)) })
    return () => {
      live = false; generation.current++
      preparation.current?.abort.abort(); preparation.current = null
      bridge.dispose(); void controller.stop().catch(() => {})
    }
  }, [owner, api, projectPath])
  useEffect(() => { if (!busy) return; const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [busy])
  useEffect(() => { if (followReply.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [events, turns, busy])
  useEffect(() => { if (view.preview && revision !== view.preview.beforeRevision) void stop('工程已改变，未应用候选已丢弃') }, [revision, view.preview])
  const referenceName = useMemo(() => {
    if (!currentDocument || !authoringSession) return '当前引用不可用'
    const bound = view.busy ? view.request : undefined
    const context = bound?.context
    const referenceScope = context && typeof context === 'object' && !Array.isArray(context) ? context.reference : wholeCourse ? 'course' : scope
    if (referenceScope === 'course') return `${currentDocument.title} · ${currentDocument.locations.length}个位置`
    const location = currentDocument.locations.find(item => item.id === (bound?.observation?.locationId ?? authoringSession.token.locationId))
    if (!location) return '当前引用不可用'
    const selected = new Set(bound ? bound.destinations.flatMap(destination => destination.kind === 'update' ? [destination.target.itemId] : []) : authoringSession.itemIds)
    const projection = projectEffectiveLayers({ project: currentDocument, locationId: location.id })
    const names = projection.unifiedRows.filter(row => selected.has(row.id)).map(row => row.item.label)
    if (projection.surfaceType === 'flow') names.push(...buildFlowEditorView({ project: currentDocument, locationId: location.id }).blocks.filter(block => selected.has(block.blockId)).map(block => block.label))
    return referenceScope === 'page' ? location.label : `${location.label} · ${names.length ? names.join('、') : '未选择对象'}`
  }, [currentDocument, authoringSession, wholeCourse, scope, view.busy, view.request])
  function beginPreparation(): Preparation {
    preparation.current?.abort.abort()
    bridge?.invalidate()
    const token = ++generation.current, startedAt = Date.now()
    const execution = { version: 1 as const, startedAt, deadlineAt: startedAt + MAX_GENERATION_TASK_DURATION_MS }
    const current = { token, execution, abort: new AbortController() }
    preparation.current = current
    setPreparing(true); setPreparationExecution(execution); setNow(startedAt); setError('')
    return current
  }
  async function prepareStage<T>(current: Preparation, operation: () => Promise<T>): Promise<T> {
    if (current.token !== generation.current) throw new Error('stale：任务已停止或重新开始')
    const result = await awaitCourseChatStage(operation, current.execution, current.abort.signal)
    if (current.token !== generation.current) throw new Error('stale：任务已停止或重新开始')
    return result
  }
  function finishPreparation(current: Preparation) {
    if (preparation.current !== current) return
    preparation.current = null
    current.abort.abort()
    setPreparing(false); setPreparationExecution(undefined)
  }
  async function stop(reason?: string) {
    const token = ++generation.current
    preparation.current?.abort.abort(); preparation.current = null
    bridge?.invalidate()
    setPreparing(false); setPreparationExecution(undefined)
    setNotice(reason ?? '已停止；准备中的结果和未应用候选已丢弃')
    try { await controller?.stop(); if (token === generation.current && reason) setNotice(reason) }
    catch (cause) { if (token === generation.current) setError(message(cause)) }
  }
  async function confirmedResume(id?: string): Promise<string | undefined> {
    if (!id || !api) return undefined
    const record = (await api.localAgent({ operation: 'read', ...owner, sessionId: id, after: 0 })).records?.[0]
    // Historical V1 entries use Main's read-only excerpt path; a new native record
    // may resume only an identity actually confirmed before Stop/failure.
    return record && (record.externalSessionId || !record.task) ? id : undefined
  }
  async function send() {
    if (!api || !bridge || !controller || !projectPath || !instruction.trim()) return
    if (preparation.current) return
    if (view.busy) {
      const task = controller.current.record?.task, request = controller.current.request
      if (!task || !request) { setError('CLI 正在建立任务，请稍后发送补充'); return }
      const nextIntent = resolveChatIntent(instruction, intent)
      if (!bridge.isCurrent(request) || nextIntent !== (request.intent ?? 'edit')) {
        const current = beginPreparation(), resumeId = controller.current.sessionId
        setNotice('已丢弃旧候选，正在按当前内容和选择重新同步')
        try {
          await prepareStage(current, () => controller.stop())
          setNotice('已丢弃旧候选，正在按当前内容和选择重新同步')
          const fresh = await prepareStage(current, () => bridge.refreshFromUser(instruction.trim(), nextIntent, current.execution))
          const resumable = await prepareStage(current, () => confirmedResume(resumeId))
          setInstruction(''); finishPreparation(current)
          await controller.start(fresh, adapter, resumable)
        } catch (cause) {
          if (current.token === generation.current) {
            if (preparation.current === current) setNotice('本次准备未完成，请调整后重新发送')
            bridge.invalidate(); setError(message(cause))
          }
        } finally { finishPreparation(current) }
        return
      }
      const token = generation.current, text = instruction.trim()
      try {
        await controller.input({ version: 1, kind: inputKind, inputId: crypto.randomUUID(), taskId: task.taskId, epoch: task.epoch, workspace: request.workspace, turnId: task.turnId, text })
        if (token === generation.current) { bridge.rememberUserInput(text); setInstruction('') }
      }
      catch (cause) { if (token === generation.current) setError(message(cause)) }
      return
    }
    if (preparing) return
    // A manual edit can end the old turn before the user's correction arrives.
    // Only that unresolved stale task keeps its goal; ordinary idle sends start fresh.
    const continueStaleTask = view.phase === 'failed' && view.sessionId === sessionId && !!view.request
      && !view.receipt && view.error?.startsWith('stale：') && !bridge.isCurrent(view.request)
    const nextInstruction = continueStaleTask ? bridge.instructionWithUserInput(instruction.trim()) : instruction.trim()
    const current = beginPreparation()
    setNotice('正在同步当前画面、草稿和引用')
    try {
      const workspace = (await prepareStage(current, () => api.localAgent({ operation: 'workspace', ...owner }))).workspace
      if (!workspace) throw new Error('当前构建未启用 CLI 创作')
      const materialResults = await prepareStage(current, () => Promise.all(materialIds.map(id => api.materials({ operation: 'read', ...owner, id }))))
      const selectedMaterials = materialResults.map(records => { if (!records[0]) throw new Error('引用材料已删除，请重新选择'); return records[0] })
      const catalog = await prepareStage(current, () => api.loadComponentCatalog()), requestedIntent = resolveChatIntent(instruction, intent)
      if (requestedIntent === 'edit' && wholeCourse && (!planConfirmed || !scriptConfirmed || !teachingPlan.trim() || !presentationScript.trim())) throw new Error('整课生成前，请分别审阅并确认当前教学策划和呈现脚本')
      const request = await prepareStage(current, () => bridge.capture({ workspace, execution: current.execution,
        scope: wholeCourse ? 'course' : scope, instruction: nextInstruction, intent: requestedIntent, applyPolicy,
        purpose: wholeCourse ? 'whole-course' : scope === 'selection' ? 'local-edit' : 'single-page', expectedResult: wholeCourse && requestedIntent === 'edit' ? 'candidate' : 'auto',
        confirmedDocuments: wholeCourse ? { teachingPlan, presentationScript } : undefined, materials: selectedMaterials, catalogPackages: catalog.packages }))
      const resumable = await prepareStage(current, () => confirmedResume(sessionId))
      setInstruction(''); finishPreparation(current)
      await controller.start(request, adapter, resumable)
    } catch (cause) {
      if (current.token === generation.current) {
        if (preparation.current === current) setNotice('本次准备未完成，请调整后重新发送')
        bridge.invalidate(); setError(message(cause))
      }
    } finally { finishPreparation(current) }
  }
  async function selectSession(id: string) {
    const token = ++generation.current
    preparation.current?.abort.abort(); preparation.current = null; bridge?.invalidate()
    setPreparing(false); setPreparationExecution(undefined)
    setView(emptyView); setEvents([]); setTurns([]); setSessionId(id); setError(''); setNotice('')
    const record = sessions.find(value => value.id === id)
    if (!record) return
    setAdapter(record.adapter)
    if (record.generationRequest) setTurns([{ id: record.generationRequest.requestId, request: record.generationRequest, events: [], summary: record.hostResult?.summary }])
    try {
      let after = 0; const replay: LocalAgentEvent[] = []
      for (;;) {
        const response = await api!.localAgent({ operation: 'read', ...owner, sessionId: id, after })
        if (token !== generation.current) return
        const page = response.records?.[0]?.events ?? []
        replay.push(...page.filter(event => event.sequence > after)); after = replay.at(-1)?.sequence ?? after
        setEvents([...replay]); if (page.length < 200) break
      }
    } catch (cause) { setError(message(cause)) }
  }
  const configurationSequence = [...events].reverse().find(event => event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')?.sequence ?? 0
  const answered = new Set(events.flatMap(event => {
    const payload = event.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.status !== 'input-delivery') return []
    const parsed = aiInputDeliverySchema.safeParse(payload.delivery)
    return parsed.success && parsed.data.status !== 'rejected' ? [parsed.data.questionId] : []
  }))
  const questions = [...new Map((view.busy ? events : []).flatMap(event => {
    const payload = event.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.status !== 'question') return []
    const parsed = aiQuestionSchema.safeParse(payload.question)
    return parsed.success && !answered.has(parsed.data.questionId) ? [[parsed.data.questionId, parsed.data] as const] : []
  })).values()]
  const activities = events.flatMap(event => { const text = nativeActivity(event); return text ? [{ id: event.sequence, text }] : [] }).slice(-8)
  const taskDeadline = Math.min(view.record?.task?.deadlineAt ?? Infinity, view.request?.execution?.deadlineAt ?? Infinity)
  const deadline = preparationExecution?.deadlineAt ?? taskDeadline
  const remaining = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 60000)) : null
  const tokenUsage = latestLocalAgentTokenUsage(events)
  const tokenCount = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString()
  return <aside className="course-chat" aria-label="CLI 创作助手" data-flow-selection-preserving-target="true">
    <header><strong>创作助手 · 内部试用</strong><button onClick={onClose}>关闭</button></header>
    {!projectPath ? <p>请先保存工程，再开始对话。</p> : <>
      <div className="chat-controls"><label>CLI<select aria-label="CLI" value={adapter} disabled={busy || !!sessionId} onChange={event => setAdapter(event.target.value as LocalAgentId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option></select></label>
        <label>会话<select aria-label="会话" value={sessionId} disabled={busy} onChange={event => void selectSession(event.target.value)}><option value="">新对话</option>{sessions.map(record => <option key={record.id} value={record.id}>{record.adapter} · {record.id.slice(0, 8)} · {statusLabels[record.task?.status ?? record.status]}</option>)}{sessionId && !sessions.some(record => record.id === sessionId) && <option value={sessionId}>当前对话</option>}</select></label></div>
      <NativeAgentConfiguration key={adapter} adapter={adapter} projectId={projectId} projectPath={projectPath} configurationSequence={configurationSequence} />
      <div className="chat-scroll" ref={scroll} onScroll={event => { const element = event.currentTarget; followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60 }}>
        {turns.map(turn => <details key={turn.id}><summary>你：{turn.request.instruction.slice(0, 60)}</summary><p>{turn.request.instruction}</p>{turn.id !== view.request?.requestId && <SafeChatMessage text={assistantText(turn.events)} />}{turn.summary && <p>{turn.summary}</p>}</details>)}
        {assistantText(events) && <SafeChatMessage text={assistantText(events)} />}
        {questions.map(question => <NativeAgentQuestion key={question.questionId} question={question} onAnswer={async input => { if (!controller) throw new Error('当前任务已关闭'); await controller.input(input) }} />)}
        {!!activities.length && <ol aria-label="任务活动" className="chat-activity">{activities.map(item => <li key={item.id}>{item.text}</li>)}</ol>}
        <p role="status">{notice}{busy && remaining !== null ? ` · 本任务剩余约 ${remaining} 分钟` : ''}</p>{error && <p role="alert">{error}</p>}
        {view.canRetryFeedback && <button onClick={() => void controller?.retryFeedback().catch(cause => setError(message(cause)))}>重试保存回执</button>}
        {tokenUsage && <small aria-label="原生用量">本次输入 {tokenCount(tokenUsage.last?.inputTokens)} / 输出 {tokenCount(tokenUsage.last?.outputTokens)} token；原生累计输入 {tokenCount(tokenUsage.total?.inputTokens)} / 输出 {tokenCount(tokenUsage.total?.outputTokens)}，缓存输入 {tokenCount(tokenUsage.total?.cachedInputTokens)}，推理输出 {tokenCount(tokenUsage.total?.reasoningOutputTokens)}</small>}
        {view.preview && view.request && <section aria-label="候选变更预览"><h3>{view.preview.summary}</h3><GenerationCandidatePreview prepared={view.preview} request={view.request} />
          <ul>{view.preview.plannedEffects.map((effect, index) => <li key={index}>{effect.operation} · {effect.id}</li>)}</ul>
          <button disabled={preparing || revision !== view.preview.beforeRevision || now >= taskDeadline} onClick={() => controller?.applyPreview()}>应用候选</button><small>也可以在输入框纠正要求，或停止以丢弃候选。</small>
          <details><summary>字段与共享影响详情</summary><dl>{view.preview.changes.map(change => <div key={change.path}><dt>{change.path}</dt><dd>原：{change.before}</dd><dd>新：{change.after}</dd></div>)}</dl>{view.preview.omitted > 0 && <p>另有 {view.preview.omitted} 项变更。</p>}</details></section>}
        {applied?.receipt && <button disabled={busy || revision !== applied.receipt.afterRevision} title="已有后续修改时，请使用编辑器正常撤销顺序" onClick={() => {
          useEditorStore.getState().undo()
          if (applied.result && applied.sessionId) void api!.localAgent({ operation: 'host-result', ...owner, sessionId: applied.sessionId, result: { ...applied.result, status: 'undone', afterRevision: selectActiveCourseProjectDocument(useEditorStore.getState())?.revision } }).catch(cause => setError(message(cause)))
          setApplied(null); setNotice('已撤销最近一次 AI 提交')
        }}>撤销最近一次 AI 修改</button>}
        <details><summary>诊断详情（{events.length} 个原生事件）</summary>{events.length > visibleEvents && <button onClick={() => setVisibleEvents(value => value + 100)}>显示更早的事件</button>}<ol>{events.slice(-visibleEvents).map(event => <li key={event.sequence}>#{event.sequence} {event.kind}<pre>{JSON.stringify(event.payload, null, 2)}</pre></li>)}</ol></details>
      </div>
      <form onSubmit={event => { event.preventDefault(); void send() }}>
        <div className="chat-controls"><label>意图<select aria-label="意图" disabled={busy} value={intent} onChange={event => setIntent(event.target.value as typeof intent)}><option value="discuss">讨论</option><option value="plan">计划</option><option value="edit">编辑</option></select></label>
          {intent === 'edit' && <label>应用方式<select aria-label="应用方式" disabled={busy} value={applyPolicy} onChange={event => setApplyPolicy(event.target.value as typeof applyPolicy)}><option value="auto">自动应用</option><option value="preview">先看预览</option></select></label>}</div>
        <label>本轮引用<select aria-label="本轮引用" value={scope} disabled={busy || wholeCourse} onChange={event => setScope(event.target.value as GenerationReferenceScope)}><option value="page">当前页</option><option value="selection">当前选择</option><option value="course">整课内容</option></select></label>
        <small aria-label="本轮引用摘要">{referenceName} · {preparing ? '正在同步' : busy ? view.request && bridge && !bridge.isCurrent(view.request) ? '课件已变化，补充时重新同步原目标' : '本任务已捕获，应用后重新同步' : '发送时同步当前画面与内存草稿'}</small>
        <small>{intent === 'edit' ? '修改范围受本轮引用约束；原生 CLI 文件和工具权限由其授权设置决定。' : '本轮只讨论或制定计划，不应用课件修改。'}</small>
        <details><summary>从已确认文档生成整课</summary><label><input type="checkbox" disabled={busy} checked={wholeCourse} onChange={event => setWholeCourse(event.target.checked)} />生成包含多个片段的完整课件</label>
          {wholeCourse && <><label>教学策划 Markdown<textarea value={teachingPlan} disabled={busy} onChange={event => { setTeachingPlan(event.target.value); setPlanConfirmed(false) }} /></label><label><input type="checkbox" disabled={busy || !teachingPlan.trim()} checked={planConfirmed} onChange={event => setPlanConfirmed(event.target.checked)} />已审阅并确认当前教学策划</label>
            <label>呈现脚本 Markdown<textarea value={presentationScript} disabled={busy} onChange={event => { setPresentationScript(event.target.value); setScriptConfirmed(false) }} /></label><label><input type="checkbox" disabled={busy || !presentationScript.trim()} checked={scriptConfirmed} onChange={event => setScriptConfirmed(event.target.checked)} />已审阅并确认当前呈现脚本</label><small>整课生成会引用整课内容；编辑文档后须重新确认。</small></>}
        </details>
        {!!materials.length && <details><summary>引用教学材料（{materialIds.length}）</summary>{materials.map(material => <label key={material.id}><input type="checkbox" checked={materialIds.includes(material.id)} disabled={busy} onChange={event => setMaterialIds(prior => event.target.checked ? [...prior, material.id] : prior.filter(id => id !== material.id))} />{material.title}</label>)}</details>}
        <textarea aria-label="发送给创作助手" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={busy ? '补充或纠正当前任务…' : '描述要讲解的内容或需要修改的地方…'} rows={3} />
        {view.busy && <label>输入用途<select aria-label="输入用途" value={inputKind} onChange={event => setInputKind(event.target.value as typeof inputKind)}><option value="supplement">补充要求</option><option value="correct">纠正方向</option></select></label>}
        <button type="submit" disabled={preparing || !instruction.trim()}>{view.busy ? '发送输入' : '发送'}</button> <button type="button" disabled={!busy} onClick={() => void stop()}>停止</button>
      </form>
    </>}
  </aside>
}

export function CourseChatEntry() {
  const [enabled, setEnabled] = useState(false); const [open, setOpen] = useState(false)
  const projectId = useEditorStore(state => selectActiveCourseProjectDocument(state)?.id ?? '')
  const projectPath = useEditorStore(state => state.projectPath)
  useEffect(() => { let live = true; void window.desktopAPI?.localAgent({ operation: 'probe', adapter: 'codex' }).then(result => { if (live) setEnabled(result.enabled) }).catch(() => {}); return () => { live = false } }, [])
  if (!enabled) return null
  return <>{open ? <CourseChatPanel key={`${projectId}:${projectPath}`} projectId={projectId} projectPath={projectPath} onClose={() => setOpen(false)} /> : <button className="course-chat-launch" onClick={() => setOpen(true)}>创作助手</button>}</>
}
