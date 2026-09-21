import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { localAgentCapabilitiesSchema, type LocalAgentEvent, type LocalAgentId, type LocalAgentRecord } from '../../../shared/localAgentContract'
import { DEFAULT_GENERATION_TASK_DURATION_MS, GENERATION_TASK_BUDGET_MINUTES, MAX_GENERATION_TASK_DURATION_MS, readGenerationFailure, type GenerationRequest } from '../../../shared/generationContract'
import type { MaterialRecordV1 } from '../../../shared/materialContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { DynamicBehaviorObservation } from '../../../shared/dynamicBehaviorObservation'
import { chatRecordTime, latestChatEditRequest, mergeChatEvents, sameChatConversation } from './courseChatHistory'
import { CourseChatTranscript } from './CourseChatTranscript'
import { readableActivity, readableChatError } from './readableChatStatus'
import { SafeChatMessage } from './SafeChatMessage'
import { latestLocalAgentTokenUsage } from '../../../shared/localAgentUsage'
import { resolveGenerationReferenceScope, type GenerationReferenceScope } from '../../authoring/generation/generationSnapshot'
import { GenerationTaskController, type GenerationTaskView } from '../../authoring/generation/generationTaskController'
import { selectActiveCourseProjectDocument, useEditorStore } from '../../store/editorStore'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView } from '../../course/flowEditorView'
import { NativeAgentQuestion } from './NativeAgentQuestion'
import { NativeAgentConfiguration } from './NativeAgentConfiguration'
import { ChatComposerMenus, useDirectoryMentions, type ChatComposerMenusHandle } from './ChatComposerMenus'
import { GenerationCandidatePreview } from './GenerationCandidatePreview'
import { awaitCourseChatStage, createCourseChatObservation, type CourseChatTarget } from './courseChatObservation'
import { aiQuestionSchema, aiInputDeliverySchema } from '../../../shared/localAgentInteraction'
import './course-chat.css'
import { CONTEXTUAL_COURSE_COMMAND, validateContextualCourseCommand, type ContextualCourseCommand } from './contextualCourseCommand'
import { useExternalAiNotice } from './useExternalAiNotice'
import { normalizeWorkspacePath } from '../../../shared/workspaceIdentity'

type Preparation = { token: number; execution: NonNullable<GenerationRequest['execution']>; abort: AbortController; target: CourseChatTarget; scope: GenerationReferenceScope }
const message = readableChatError
const emptyView: GenerationTaskView = { busy: false, phase: 'completed', notice: '', events: [] }
const statusLabels = { observing: '正在同步', running: '运行中', 'waiting-input': '等待回答', checking: '正在检查',
  'awaiting-apply': '等待应用', committing: '正在应用', 'feeding-back': '正在核对',
  completed: '已完成', failed: '未完成', cancelled: '已停止', partial: '部分完成' }
function referenceLabel(document: CourseProjectDocument | null | undefined, locationId: string | undefined, selectedIds: readonly string[], scope: GenerationReferenceScope) {
  if (!document) return '当前引用不可用'
  if (scope === 'course') return `${document.title} · ${document.locations.length}个位置`
  const location = document.locations.find(item => item.id === locationId)
  if (!location) return '当前引用不可用'
  if (scope === 'page') return location.label
  const selected = new Set(selectedIds), projection = projectEffectiveLayers({ project: document, locationId: location.id })
  const names = projection.unifiedRows.filter(row => selected.has(row.id)).map(row => row.item.label)
  if (projection.surfaceType === 'flow') names.push(...buildFlowEditorView({ project: document, locationId: location.id }).blocks.filter(block => selected.has(block.blockId)).map(block => block.label))
  return `${location.label} · ${names.length ? names.join('、') : '未选择对象'}`
}
export function isChatStatusInquiry(text: string): boolean { return /^(?:请问|告诉我)?(?:为什么(?:停止了?|停了|失败了?)|现在(?:怎么样了?|什么情况|进展如何)|当前(?:状态|进度)|怎么(?:停了|失败了)|是否(?:完成|成功)|完成了吗)[？?。！!\s]*$/.test(text.trim()) }
export function resolveChatIntent(text: string, selected: 'discuss' | 'plan' | 'edit') {
  if (isChatStatusInquiry(text)) return 'discuss'
  // Require a planning directive; a quoted earlier action followed by “方案”
  // can describe a rejected approach inside an otherwise explicit edit request.
  if (/先(?:给我|为我|帮我)?(?:做|写|出|给出|制定|整理|更新)?(?:一(?:个|份|下))?(?:计划|方案)|只(?:做|写|出)(?:计划|方案)/.test(text)) return 'plan'
  if (/只(?:和我)?讨论|先(?:和我)?讨论/.test(text)) return 'discuss'
  if (/先别(?:修改|改动|动手)|不要(?:做任何动作|修改|改动|动手)|不(?:修改|改)课件/.test(text)) return selected === 'plan' ? 'plan' : 'discuss'
  // A user can explicitly defer an edit until after they answer a question. This
  // is a request-level decision only; model punctuation never changes the intent.
  if (selected === 'edit' && /先(?:问|询问)(?:我|用户)?[^\n]{0,48}(?:等(?:我|用户)?(?:回答|回复|答复)|(?:我|用户)?(?:回答|回复|答复)后)[^\n]{0,24}(?:再)?(?:修改|改动|动手)/.test(text)) return 'discuss'
  return selected
}
export function CourseChatPanel({ projectId, projectPath, onClose, lessonWorkspace, embedded = false, initialHistory = [] }: { projectId: string; projectPath: string | null; onClose(): void; lessonWorkspace?: import('../../../shared/workspaceIdentity').LessonAgentWorkspace; embedded?: boolean; initialHistory?: LocalAgentEvent[] }) {
  const currentDocument = useEditorStore(selectActiveCourseProjectDocument), authoringSession = useEditorStore(state => state.courseAuthoringSession)
  // A manual scope belongs to this workspace, not to a particular selection.
  // Clearing/changing selection must not silently widen an explicit selection scope.
  const referenceIdentity = JSON.stringify([projectId, projectPath])
  const automaticScope: GenerationReferenceScope = authoringSession?.itemIds.length ? 'selection' : 'page'
  const [reference, setReference] = useState<{ identity: string; scope: GenerationReferenceScope; explicit?: boolean }>({ identity: referenceIdentity, scope: automaticScope })
  const scopeExplicit = reference.identity === referenceIdentity && reference.explicit
  const scope = scopeExplicit ? reference.scope : automaticScope
  if (reference.identity !== referenceIdentity) setReference({ identity: referenceIdentity, scope: automaticScope })
  const [adapter, setAdapter] = useState<LocalAgentId>('codex')
  const [configurationSaving, setConfigurationSaving] = useState(false)
  const configurationSavingRef = useRef(false)
  const onConfigurationSaving = useCallback((saving: boolean) => {
    configurationSavingRef.current = saving
    setConfigurationSaving(saving)
  }, [])
  const [intent, setIntent] = useState<'discuss' | 'plan' | 'edit'>('edit'), [applyPolicy, setApplyPolicy] = useState<'auto' | 'preview'>('auto')
  const [inputKind, setInputKind] = useState<'supplement' | 'correct'>('correct'), [wholeCourse, setWholeCourse] = useState(false)
  // 「当前编辑目标」是一个可点开的提示：点它就展开「其它目标」那层 details（设计说明 §5.1）。
  // details 因此受控，onToggle 把用户直接点 summary 的情况同步回来，两个入口不会失配。
  const [targetMoreOpen, setTargetMoreOpen] = useState(false)
  const [budgetMinutes, setBudgetMinutes] = useState(DEFAULT_GENERATION_TASK_DURATION_MS / 60000)
  const [extendingBudget, setExtendingBudget] = useState(false)
  const [teachingPlan, setTeachingPlan] = useState(''), [presentationScript, setPresentationScript] = useState('')
  const [planConfirmed, setPlanConfirmed] = useState(false), [scriptConfirmed, setScriptConfirmed] = useState(false)
  const [instruction, setInstruction] = useState('')
  const instructionRef = useRef(instruction); instructionRef.current = instruction
  const composerMenus = useRef<ChatComposerMenusHandle>(null)
  const mentionDirectory = projectPath ? projectPath.replace(/[\\/][^\\/]+$/, '') : null
  const mentions = useDirectoryMentions(mentionDirectory)
  const resolvedReference = useMemo(() => {
    try { return { scope: resolveGenerationReferenceScope({ instruction, scope: wholeCourse ? 'course' : scope, scopeExplicit }), error: '' } }
    catch (cause) { return { scope, error: message(cause) } }
  }, [instruction, scope, wholeCourse, scopeExplicit])
  const [sessions, setSessions] = useState<LocalAgentRecord[]>([]), [sessionId, setSessionId] = useState('')
  const [events, setEvents] = useState<LocalAgentEvent[]>(initialHistory)
  const [legacyInstruction, setLegacyInstruction] = useState('')
  const conversationRecord = useRef<LocalAgentRecord | null>(null)
  const [materials, setMaterials] = useState<MaterialRecordV1[]>([]), [materialIds, setMaterialIds] = useState<string[]>([])
  const [view, setView] = useState<GenerationTaskView>(emptyView), [preparing, setPreparing] = useState(false)
  const [preparationExecution, setPreparationExecution] = useState<GenerationRequest['execution']>()
  const [frozenReference, setFrozenReference] = useState<{ scope: GenerationReferenceScope; name: string } | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [applied, setApplied] = useState<Pick<GenerationTaskView, 'receipt' | 'result' | 'sessionId'> | null>(null)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0), scroll = useRef<HTMLDivElement | null>(null), followReply = useRef(true)
  const preparation = useRef<Preparation | null>(null)
  const activeRequest = useRef<string | undefined>(undefined), behaviorEvidence = useRef<DynamicBehaviorObservation[]>([])
  const revision = currentDocument?.revision, busy = view.busy || preparing
  const api = useMemo(() => {
    const desktop = window.desktopAPI
    if (!desktop || !lessonWorkspace) return desktop
    return { ...desktop, localAgent: (request: import('../../../shared/localAgentContract').LocalAgentRequest) => {
      if (request.operation === 'list') return desktop.localAgent({ operation: 'lesson-list', workspace: lessonWorkspace })
      if (request.operation === 'read') return desktop.localAgent({ operation: 'lesson-read', workspace: lessonWorkspace, sessionId: request.sessionId, after: request.after })
      if (request.operation === 'delete') return desktop.localAgent({ operation: 'lesson-delete', workspace: lessonWorkspace, sessionId: request.sessionId })
      return desktop.localAgent('projectId' in request && request.operation !== 'capabilities' && request.operation !== 'configure' ? { ...request, lessonWorkspace } : request)
    } }
  }, [lessonWorkspace])
  const owner = useMemo(() => ({ projectId, projectPath: projectPath ?? '' }), [projectId, projectPath])
  const externalNotice = useExternalAiNotice(api)
  useEffect(() => () => externalNotice.cancel(), [projectId, projectPath, externalNotice.cancel])
  // The pre-send explanation is read from Main with the same lesson scope the send
  // uses, so it can never describe a payload other than the one actually attached.
  const confirmExternalRequest = (request: GenerationRequest) => externalNotice.ensure({ scope: request.workspace, adapter,
    referencesScope: { kind: 'generation', ...(lessonWorkspace ? { lessonWorkspace } : {}), request } })
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
      isCurrent: request => bridge.isCurrent(request), currentReason: request => bridge.currentReason(request),
      captureNext: (request, receipt) => bridge.captureNext(request, receipt, behaviorEvidence.current),
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
        setView(next); setNotice(next.notice); setError(next.error ?? '')
        if (next.events.length) {
          const same = !next.record || !conversationRecord.current || sameChatConversation(conversationRecord.current, next.record)
          if (next.record) conversationRecord.current = next.record
          setEvents(prior => mergeChatEvents(same ? prior : [], next.events))
        }
        if (next.request) setLegacyInstruction(next.request.instruction)
        if (next.sessionId) setSessionId(next.sessionId)
        if (next.record) setSessions(prior => [...prior.filter(item => item.id !== next.record!.id), { ...next.record!, events: [] }])
        if (next.receipt?.status === 'committed') setApplied({ receipt: next.receipt, result: next.result, sessionId: next.sessionId })
      },
    })
    setResources({ owner, api, bridge, controller })
    void api.localAgent({ operation: 'list', ...owner }).then(result => { if (live) setSessions(result.records ?? []) }).catch(reason => { if (live) setError(message(reason)) })
    if (lessonWorkspace) { setMaterials([]); setMaterialIds([]) }
    else void api.materials({ operation: 'search', ...owner, query: '' }).then(result => { if (live) setMaterials(result) }).catch(reason => { if (live) setError(message(reason)) })
    return () => {
      live = false; generation.current++
      preparation.current?.abort.abort(); preparation.current = null
      bridge.dispose(); void controller.stop().catch(() => {})
    }
  }, [owner, api, projectPath])
  useEffect(() => {
    if (!api || !currentResources || busy || view.canRetryFeedback || !view.sessionId || (view.phase !== 'failed' && view.phase !== 'cancelled')) return
    const id = view.sessionId, token = generation.current, task = view.record?.task
    let live = true, remaining = 20, timer: ReturnType<typeof setTimeout> | undefined
    // Failure/Stop releases the form before Main finishes cancelling. Refresh
    // the session row from Main without replacing the controller's diagnosis.
    async function refresh() {
      try {
        const result = await api!.localAgent({ operation: 'read', ...owner, sessionId: id, after: view.events.at(-1)?.sequence ?? 0 })
        if (!live || token !== generation.current) return
        const record = result.records?.find(value => value.id === id)
        if (!record) return
        if (task) {
          const currentTask = record.task
          // Main stopAiTask advances the epoch once and preserves prior commits
          // as partial. That terminal receipt still belongs to this task.
          const stoppedEpoch = currentTask?.epoch === task.epoch + 1
            && (currentTask.status === 'cancelled' || currentTask.status === 'partial')
          if (currentTask?.taskId !== task.taskId || currentTask.epoch !== task.epoch && !stoppedEpoch) return
        }
        setSessions(prior => [...prior.filter(item => item.id !== id), { ...record, events: [] }])
        if (['completed', 'failed', 'cancelled', 'partial'].includes(record.task?.status ?? record.status)) return
      } catch { /* Keep the original task diagnostic when status readback is unavailable. */ }
      if (live && token === generation.current && --remaining > 0) timer = setTimeout(() => void refresh(), 500)
    }
    void refresh()
    return () => { live = false; clearTimeout(timer) }
  }, [api, owner, currentResources, busy, view])
  useEffect(() => { if (!busy) return; const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [busy])
  useEffect(() => { if (followReply.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight }, [events, busy])
  useEffect(() => { if (view.preview && revision !== view.preview.beforeRevision) void stop('工程已改变，未应用候选已丢弃') }, [revision, view.preview])
  const referenceName = useMemo(() => referenceLabel(currentDocument, authoringSession?.token.locationId,
    authoringSession?.itemIds ?? [], resolvedReference.scope), [currentDocument, authoringSession, resolvedReference.scope])
  function beginPreparation(fromCard = false): Preparation | null {
    if (!fromCard && resolvedReference.error) { setError(resolvedReference.error); return null }
    const token = ++generation.current, startedAt = Date.now()
    const execution = { version: 1 as const, startedAt, deadlineAt: startedAt + budgetMinutes * 60000 }
    preparation.current?.abort.abort()
    bridge?.invalidate()
    let target: CourseChatTarget
    try {
      if (!bridge) throw new Error('当前任务已关闭')
      target = bridge.freezeTarget()
    } catch (cause) { setError(message(cause)); return null }
    const current = { token, execution, abort: new AbortController(), target, scope: fromCard ? 'selection' as const : resolvedReference.scope }
    preparation.current = current
    setFrozenReference({ scope: current.scope, name: referenceLabel(selectActiveCourseProjectDocument(useEditorStore.getState()), target.locationId, target.selectedIds, current.scope) })
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
    externalNotice.cancel()
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
    return record && !('kind' in record.workspace) && (record.externalSessionId || !record.task) ? id : undefined
  }
  async function extendBudget() {
    const task = controller?.current.record?.task, request = controller?.current.request
    if (!controller || !task || !request || extendingBudget) return
    const token = generation.current
    setExtendingBudget(true)
    try {
      await controller.input({ version: 1, kind: 'extend-budget', minutes: 20, inputId: crypto.randomUUID(),
        taskId: task.taskId, epoch: task.epoch, workspace: request.workspace, turnId: task.turnId }, { preservePreview: true })
      if (token === generation.current) setNotice('本次任务预算已增加 20 分钟')
    } catch (cause) { if (token === generation.current) setError(message(cause)) }
    finally { setExtendingBudget(false) }
  }
  useEffect(() => {
    const receive = (event: Event) => {
      const request = event as CustomEvent<ContextualCourseCommand>
      if (request.defaultPrevented || request.detail.projectId !== projectId) return
      request.preventDefault()
      const command = request.detail, token = useEditorStore.getState().courseAuthoringSession?.token
      if (JSON.stringify(token) !== JSON.stringify(command.sessionToken)) { command.error = '当前内容或选区已改变，请重新选择。'; return }
      if (!api || !bridge || !controller || !projectPath) { command.error = '请先保存课件并连接创作助手。'; return }
      if (busy || preparing || configurationSavingRef.current || preparation.current) { command.error = '创作助手正在处理任务，请稍后发送。'; return }
      try { validateContextualCourseCommand(command, useEditorStore.getState().flowSession?.selection) }
      catch (error) { command.error = error instanceof Error ? error.message : String(error); return }
      setInstruction(command.instruction)
      void send(command.instruction, true)
    }
    window.addEventListener(CONTEXTUAL_COURSE_COMMAND, receive)
    return () => window.removeEventListener(CONTEXTUAL_COURSE_COMMAND, receive)
  })
  async function send(messageOverride?: string, fromCard = false) {
    const instruction = messageOverride ?? instructionRef.current
    const isWholeCourse = wholeCourse && !fromCard
    if (configurationSavingRef.current) return
    if (!api || !bridge || !controller || !projectPath || !instruction.trim()) return
    if (preparation.current) return
    if (view.busy) {
      const task = controller.current.record?.task, request = controller.current.request
      if (!task || !request) { setError('CLI 正在建立任务，请稍后发送补充'); return }
      if (isChatStatusInquiry(instruction)) {
        const token = generation.current
        try {
          if (!await confirmExternalRequest(request) || token !== generation.current) return
          await controller.input({ version: 1, kind: 'supplement', inputId: crypto.randomUUID(), taskId: task.taskId, epoch: task.epoch,
            workspace: request.workspace, turnId: task.turnId, text: instruction.trim() }, { preservePreview: true })
          if (token === generation.current) {
            setInstruction('')
            setNotice(`当前状态：${statusLabels[view.phase] ?? '处理中'}。${view.receipt?.status === 'committed' ? '已应用的修改保留。' : '本阶段尚未确认应用。'}询问已记录，助手会在可接收输入时答复。`)
          }
        } catch (cause) { if (token === generation.current) setError(message(cause)) }
        return
      }
      const nextIntent = resolveChatIntent(instruction, intent)
      if (!bridge.isCurrent(request) || nextIntent !== (request.intent ?? 'edit')) {
        const current = beginPreparation(), resumeId = controller.current.sessionId
        if (!current) return
        setNotice('已丢弃旧候选，正在按当前内容和选择重新同步')
        try {
          await prepareStage(current, () => controller.stop())
          setNotice('已丢弃旧候选，正在按当前内容和选择重新同步')
          const fresh = await prepareStage(current, () => bridge.refreshFromUser(instruction.trim(), nextIntent, current.execution, current.target, current.scope))
          const resumable = await prepareStage(current, () => confirmedResume(resumeId))
          if (!await prepareStage(current, () => confirmExternalRequest(fresh))) return
          setInstruction(''); finishPreparation(current)
          await controller.start(fresh, adapter, resumable, instruction.trim())
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
        if (!await confirmExternalRequest(request) || token !== generation.current) return
        await controller.input({ version: 1, kind: inputKind, inputId: crypto.randomUUID(), taskId: task.taskId, epoch: task.epoch, workspace: request.workspace, turnId: task.turnId, text })
        if (token === generation.current) { bridge.rememberUserInput(text); setInstruction('') }
      }
      catch (cause) { if (token === generation.current) setError(message(cause)) }
      return
    }
    if (preparing) return
    // A manual edit can end the old turn before the user's correction arrives.
    // Only that unresolved stale task keeps its goal; ordinary idle sends start fresh.
    const requestedIntent = resolveChatIntent(instruction, fromCard ? 'edit' : intent)
    const continueStaleTask = !fromCard && requestedIntent === 'edit' && view.phase === 'failed' && view.sessionId === sessionId && !!view.request
      && !view.receipt && view.error?.startsWith('stale：') && !bridge.isCurrent(view.request)
    const explicitlyContinuing = !fromCard && /^(?:请)?继续(?:吧|执行|处理|修改|完成|上次任务|之前的任务)?[。！!\s]*$/.test(instruction.trim())
    const selectedRecord = sessions.find(record => record.id === sessionId)
    const latestRequest = view.request ?? selectedRecord?.generationRequest
    const recoveryRequest = explicitlyContinuing ? latestRequest && isChatStatusInquiry(latestRequest.instruction)
      ? latestChatEditRequest(sessions, selectedRecord) : latestRequest : undefined
    if (explicitlyContinuing && latestRequest && isChatStatusInquiry(latestRequest.instruction) && !recoveryRequest) {
      setError('旧记录没有可恢复的原编辑目标，请重新说明要继续的任务。'); return
    }
    const nextInstruction = continueStaleTask ? bridge.instructionWithUserInput(instruction.trim()) : instruction.trim()
    const current = beginPreparation(fromCard)
    if (!current) return
    setNotice('正在同步当前画面、草稿和引用')
    try {
      if (recoveryRequest) {
        const recovered = await prepareStage(current, () => bridge.captureRecovery(recoveryRequest, instruction.trim(), current.execution))
        const recoveredScope = (recovered.context as { reference?: GenerationReferenceScope }).reference ?? current.scope
        const locationId = recovered.observation?.locationId ?? current.target.locationId
        setFrozenReference({ scope: recoveredScope, name: referenceLabel(selectActiveCourseProjectDocument(useEditorStore.getState()), locationId, [], recoveredScope) })
        const resumable = await prepareStage(current, () => confirmedResume(sessionId))
        if (!await prepareStage(current, () => confirmExternalRequest(recovered))) return
        setInstruction(''); finishPreparation(current)
        await controller.start(recovered, adapter, resumable, instruction.trim())
        return
      }
      const workspace = (await prepareStage(current, () => api.localAgent({ operation: 'workspace', ...owner }))).workspace
      if (!workspace) throw new Error('当前构建未启用 CLI 创作')
      const materialResults = await prepareStage(current, () => Promise.all(materialIds.map(id => api.materials({ operation: 'read', ...owner, id }))))
      const selectedMaterials = materialResults.map(records => { if (!records[0]) throw new Error('引用材料已删除，请重新选择'); return records[0] })
      const catalog = await prepareStage(current, () => api.loadComponentCatalog())
      let confirmedDocuments = isWholeCourse ? { teachingPlan, presentationScript } : undefined
      if (isWholeCourse && lessonWorkspace) {
        const prepared = await prepareStage(current, () => api.localAgent({ operation: 'lesson-prepare-generation', workspace: lessonWorkspace }))
        if (!prepared.lessonGeneration) throw new Error('当前策划或脚本尚未准备完成，请先审阅当前制品后再继续')
        confirmedDocuments = prepared.lessonGeneration.confirmedDocuments
      } else if (requestedIntent === 'edit' && isWholeCourse && (!planConfirmed || !scriptConfirmed || !teachingPlan.trim() || !presentationScript.trim())) throw new Error('整课生成前，请分别审阅并确认当前教学策划和呈现脚本')
      const request = await prepareStage(current, () => bridge.capture({ workspace, execution: current.execution,
        target: current.target, scope: current.scope, instruction: nextInstruction, intent: requestedIntent, applyPolicy,
        purpose: isWholeCourse ? 'whole-course' : current.scope === 'selection' ? 'local-edit' : 'single-page', expectedResult: isWholeCourse && requestedIntent === 'edit' ? 'candidate' : 'auto',
        confirmedDocuments, materials: selectedMaterials, catalogPackages: catalog.packages }))
      const resumable = await prepareStage(current, () => confirmedResume(sessionId))
      if (!await prepareStage(current, () => confirmExternalRequest(request))) return
      setInstruction(''); finishPreparation(current)
      await controller.start(request, adapter, resumable, instruction.trim())
    } catch (cause) {
      if (current.token === generation.current) {
        if (preparation.current === current) setNotice('本次准备未完成，请调整后重新发送')
        bridge.invalidate(); setError(message(cause))
      }
    } finally { finishPreparation(current) }
  }
  async function selectSession(id: string) {
    externalNotice.cancel()
    const token = ++generation.current
    preparation.current?.abort.abort(); preparation.current = null; bridge?.invalidate()
    setPreparing(false); setPreparationExecution(undefined)
    setView(emptyView); setEvents([]); setLegacyInstruction(''); setSessionId(id); setError(''); setNotice('')
    const record = sessions.find(value => value.id === id)
    conversationRecord.current = record ?? null
    if (!record) return
    setAdapter(record.adapter)
    if (record.generationRequest) setLegacyInstruction(record.generationRequest.instruction)
    setNotice(record.hostResult?.status === 'committed' ? '已应用课件修改' : record.hostResult?.status === 'unchanged' ? '已核对，无需修改课件' : statusLabels[record.task?.status ?? record.status] ?? '')
    try {
      let replay: LocalAgentEvent[] = []
      const chain = sessions.filter(value => sameChatConversation(value, record)).sort((a, b) => chatRecordTime(a) - chatRecordTime(b))
      for (const entry of chain) {
        let after = 0
        for (;;) {
          const response = await api!.localAgent({ operation: 'read', ...owner, sessionId: entry.id, after })
          if (token !== generation.current) return
          const page = response.records?.[0]?.events ?? []
          const next = page.filter(event => event.sequence > after)
          replay = mergeChatEvents(replay, next); after = next.at(-1)?.sequence ?? after
          setEvents([...replay]); if (page.length < 200) break
          if (!next.length) throw new Error('历史消息读取未前进，请重新打开对话。')
        }
      }
    } catch (cause) { setError(message(cause)) }
  }
  const configurationEvent = [...events].reverse().find(event => event.adapter === adapter && event.kind === 'session' && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) && event.payload.status === 'configuration')
  const configurationSequence = configurationEvent?.sequence ?? 0
  const confirmedCapabilities = localAgentCapabilitiesSchema.safeParse(configurationEvent?.payload && typeof configurationEvent.payload === 'object' && !Array.isArray(configurationEvent.payload) ? configurationEvent.payload.capabilities : undefined)
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
  const activities = (view.busy ? events : []).flatMap(event => { const text = readableActivity(event); return text ? [{ id: event.sequence, text }] : [] })
    .filter((activity, index, all) => activity.text !== all[index + 1]?.text).slice(-3)
  const taskDeadline = view.record?.task?.deadlineAt ?? view.request?.execution?.deadlineAt ?? Infinity
  const deadline = preparationExecution?.deadlineAt ?? taskDeadline
  const remaining = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 60000)) : null
  const taskStartedAt = view.record?.task?.startedAt ?? view.request?.execution?.startedAt
  const canExtendBudget = view.phase === 'running' && remaining !== null && remaining > 0 && taskStartedAt !== undefined
    && taskDeadline + 20 * 60000 <= taskStartedAt + MAX_GENERATION_TASK_DURATION_MS
  const tokenUsage = latestLocalAgentTokenUsage(events)
  const selectedConversation = sessions.find(record => record.id === sessionId)
  const legacyRequests = selectedConversation ? sessions.filter(record => sameChatConversation(record, selectedConversation))
    .flatMap(record => record.generationRequest ? [{ sessionId: record.id, text: record.generationRequest.instruction, time: chatRecordTime(record) }] : []) : []
  const actualResult = view.result ?? sessions.find(record => record.id === sessionId)?.hostResult
  const actualResultIsPrevious = actualResult && view.request && actualResult.requestId !== view.request.requestId
  const actualResultLabel = actualResult ? ({ checked: '已准备好，等待应用', committed: '已应用课件修改', unchanged: '已核对，无需修改',
    rejected: '本阶段未应用', stale: '本阶段目标已变化，未应用', undone: '已撤销本次修改' })[actualResult.status] : ''
  const tokenCount = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString()
  return <aside className={`course-chat${embedded ? ' course-chat--embedded' : ''}`} aria-label="CLI 创作助手" data-flow-selection-preserving-target="true">
    <header><strong>创作助手</strong>{!embedded && <button onClick={onClose}>关闭</button>}</header>
    {!projectPath ? <p>请先保存工程，再开始对话。</p> : <>
      <div className="chat-controls"><label>CLI<select aria-label="CLI" value={adapter} disabled={busy || !!sessionId} onChange={event => setAdapter(event.target.value as LocalAgentId)}><option value="codex">Codex</option><option value="claude">Claude</option><option value="opencode">OpenCode</option></select></label>
        <label>会话<select aria-label="会话" value={sessionId} disabled={busy} onChange={event => void selectSession(event.target.value)}><option value="">新对话</option>{sessions.map((record, index) => <option key={record.id} value={record.id}>{record.adapter} · 对话 {index + 1} · {statusLabels[record.task?.status ?? record.status]}</option>)}{sessionId && !sessions.some(record => record.id === sessionId) && <option value={sessionId}>当前对话</option>}</select></label></div>
      {externalNotice.dialog}
      <button type="button" onClick={() => externalNotice.review({ scope: { version: 1, projectId, normalizedPath: normalizeWorkspacePath(projectPath) }, adapter,
        ...(view.request ? { referencesScope: { kind: 'generation' as const, ...(lessonWorkspace ? { lessonWorkspace } : {}), request: view.request } } : {}) })}>外部处理说明</button>
      <NativeAgentConfiguration key={adapter} adapter={adapter} projectId={projectId} projectPath={projectPath} configurationSequence={configurationSequence} onSavingChange={onConfigurationSaving} taskConfiguration={confirmedCapabilities.success ? confirmedCapabilities.data.current : undefined} />
      <div className="chat-scroll" ref={scroll} onScroll={event => { const element = event.currentTarget; followReply.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60 }}>
        <CourseChatTranscript events={events} legacyInstruction={legacyInstruction} legacyRequests={legacyRequests} />
        {actualResult && <section aria-label="实际应用结果"><strong>{actualResultIsPrevious ? '此前结果 · ' : ''}{actualResultLabel}</strong><SafeChatMessage text={['rejected', 'stale'].includes(actualResult.status) ? readableChatError(actualResult.summary) : actualResult.summary} /></section>}
        {questions.map(question => <NativeAgentQuestion key={question.questionId} question={question} onAnswer={async input => {
          const request = controller?.current.request, token = generation.current
          if (!controller || !request) throw new Error('当前任务已关闭')
          if (!await confirmExternalRequest(request) || token !== generation.current) return
          await controller.input(input)
        }} />)}
        {!!activities.length && <ol aria-label="任务活动" className="chat-activity">{activities.map(item => <li key={item.id}>{item.text}</li>)}</ol>}
        <p role="status">{notice}{busy && remaining !== null ? ` · 本任务剩余约 ${remaining} 分钟` : ''}</p>{error && <p role="alert">{readableChatError(error)}</p>}
        {canExtendBudget && <button type="button" disabled={extendingBudget} onClick={() => void extendBudget()}>{extendingBudget ? '正在延长预算…' : '增加20分钟'}</button>}
        {view.canRetryFeedback && <button onClick={() => void controller?.retryFeedback().catch(cause => setError(message(cause)))}>重试保存结果</button>}
        {tokenUsage && <details className="chat-usage"><summary>用量</summary><small aria-label="原生用量">本次输入 {tokenCount(tokenUsage.last?.inputTokens)} / 输出 {tokenCount(tokenUsage.last?.outputTokens)} token；原生累计输入 {tokenCount(tokenUsage.total?.inputTokens)} / 输出 {tokenCount(tokenUsage.total?.outputTokens)}，缓存输入 {tokenCount(tokenUsage.total?.cachedInputTokens)}，推理输出 {tokenCount(tokenUsage.total?.reasoningOutputTokens)}</small></details>}
        {view.preview && view.request && <section aria-label="候选变更预览"><h3>{view.preview.summary}</h3><GenerationCandidatePreview prepared={view.preview} request={view.request} />
          <button disabled={preparing || revision !== view.preview.beforeRevision || now >= taskDeadline} onClick={() => controller?.applyPreview()}>应用候选</button><small>也可以在输入框纠正要求，或停止以丢弃候选。</small></section>}
        {applied?.receipt && <button disabled={busy || revision !== applied.receipt.afterRevision} title="已有后续修改时，请使用编辑器正常撤销顺序" onClick={() => {
          useEditorStore.getState().undo()
          if (applied.result && applied.sessionId) void api!.localAgent({ operation: 'host-result', ...owner, sessionId: applied.sessionId, result: { ...applied.result, status: 'undone', afterRevision: selectActiveCourseProjectDocument(useEditorStore.getState())?.revision } }).catch(cause => setError(message(cause)))
          setApplied(null); setNotice('已撤销最近一次 AI 提交')
        }}>撤销最近一次 AI 修改</button>}
      </div>
      <form onSubmit={event => { event.preventDefault(); void send() }}>
        <details className="chat-task-settings"><summary>任务设置 · {intent === 'edit' ? '编辑' : intent === 'plan' ? '计划' : '讨论'} · {busy && frozenReference ? frozenReference.name : referenceName}{!busy ? ` · ${budgetMinutes} 分钟` : ''}</summary>
        {!busy && <label className="chat-budget">本次时间预算<select aria-label="本次时间预算" value={budgetMinutes} onChange={event => setBudgetMinutes(Number(event.target.value))}>{GENERATION_TASK_BUDGET_MINUTES.map(minutes => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}</select><small>复杂任务可增加预算；到期会停止，已应用的修改保留。</small></label>}
        <div className="chat-controls"><label>意图<select aria-label="意图" disabled={busy} value={intent} onChange={event => setIntent(event.target.value as typeof intent)}><option value="discuss">讨论</option><option value="plan">计划</option><option value="edit">编辑</option></select></label>
          {intent === 'edit' && <label>应用方式<select aria-label="应用方式" disabled={busy} value={applyPolicy} onChange={event => setApplyPolicy(event.target.value as typeof applyPolicy)}><option value="auto">自动应用</option><option value="preview">先看预览</option></select></label>}</div>
        <div className="chat-auto-target">
          <button type="button" aria-label="当前编辑目标" disabled={busy}
            aria-expanded={targetMoreOpen} aria-controls="chat-target-more"
            onClick={() => setTargetMoreOpen(open => !open)}>
            {busy && frozenReference ? frozenReference.name : referenceName}
          </button>
          <small aria-label="本轮引用摘要">{busy && frozenReference ? frozenReference.name : referenceName}</small>
          <details id="chat-target-more" className="chat-target-more" open={targetMoreOpen}
            onToggle={event => setTargetMoreOpen((event.currentTarget as HTMLDetailsElement).open)}><summary>其它目标</summary>
            <select aria-label="本轮引用" value={busy && frozenReference ? frozenReference.scope : resolvedReference.scope} disabled={busy || wholeCourse} onChange={event => setReference({ identity: referenceIdentity, scope: event.target.value as GenerationReferenceScope, explicit: true })}>
              <option value="page">当前页</option>
              <option value="selection">当前选择</option>
              <option value="course">整份课件</option>
            </select>
          </details>
        </div>
        {resolvedReference.error && <p role="alert">{resolvedReference.error}</p>}
        <details><summary>先审当前制品再继续</summary><label><input type="checkbox" aria-label="用户明确要求先看当前策划/脚本后再生成" disabled={busy} checked={wholeCourse} onChange={event => setWholeCourse(event.target.checked)} />用户明确要求先看当前策划/脚本后再生成</label>
          {wholeCourse && lessonWorkspace && <p>仅在你要求先审真实制品时暂停；不会默认生成四份阶段文稿。</p>}
          {wholeCourse && !lessonWorkspace && <><label>当前策划 Markdown<textarea aria-label="当前策划 Markdown" value={teachingPlan} disabled={busy} onChange={event => { setTeachingPlan(event.target.value); setPlanConfirmed(false) }} /></label><label><input type="checkbox" aria-label="已审阅当前策划" disabled={busy || !teachingPlan.trim()} checked={planConfirmed} onChange={event => setPlanConfirmed(event.target.checked)} />已审阅当前策划</label>
            <label>当前脚本 Markdown<textarea aria-label="当前脚本 Markdown" value={presentationScript} disabled={busy} onChange={event => { setPresentationScript(event.target.value); setScriptConfirmed(false) }} /></label><label><input type="checkbox" aria-label="已审阅当前脚本" disabled={busy || !presentationScript.trim()} checked={scriptConfirmed} onChange={event => setScriptConfirmed(event.target.checked)} />已审阅当前脚本</label></>}
        </details>
        {!!materials.length && <details><summary>引用教学材料（{materialIds.length}）</summary>{materials.map(material => <label key={material.id}><input type="checkbox" checked={materialIds.includes(material.id)} disabled={busy} onChange={event => setMaterialIds(prior => event.target.checked ? [...prior, material.id] : prior.filter(id => id !== material.id))} />{material.title}</label>)}</details>}
        </details>
        <ChatComposerMenus ref={composerMenus} value={instruction} onChange={setInstruction}
          commands={[
            { id: 'discuss', label: '讨论', run: () => setIntent('discuss') },
            { id: 'plan', label: '计划', run: () => setIntent('plan') },
            { id: 'edit', label: '编辑', run: () => setIntent('edit') },
            { id: 'stop', label: '停止当前任务', run: () => { void stop() } },
          ]}
          mentions={mentions} />
        <textarea aria-label="发送给创作助手" value={instruction} onChange={event => setInstruction(event.target.value)} onKeyDown={event => composerMenus.current?.handleKeyDown(event)} placeholder={busy ? '补充或纠正当前任务…' : '描述要讲解的内容或需要修改的地方…'} rows={3} />
        {view.busy && <label>输入用途<select aria-label="输入用途" value={inputKind} onChange={event => setInputKind(event.target.value as typeof inputKind)}><option value="correct">立即引导</option><option value="supplement">下一回合补充</option></select><small>{inputKind === 'correct' ? '现在发送；需要时会中断当前回合，带着新要求继续。' : '等待当前回合结束后处理，本次总预算不变。'}</small></label>}
        <button type="submit" disabled={preparing || configurationSaving || !instruction.trim()}>{configurationSaving ? '正在保存配置…' : view.busy ? '发送输入' : '发送'}</button> <button type="button" disabled={!busy} onClick={() => void stop()}>停止</button>
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
