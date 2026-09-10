import type { DesktopAPI } from '../../../shared/ipcTypes'
import type { LocalAgentEvent, LocalAgentHostResult, LocalAgentId, LocalAgentRecord, LocalAgentRequest, LocalAgentResponse } from '../../../shared/localAgentContract'
import type { AiUserInput } from '../../../shared/localAgentInteraction'
import { MAX_GENERATION_TASK_DURATION_MS, readGenerationFailure, GenerationCandidatePreparationError, type GenerationCandidate, type GenerationCommitReceipt, type GenerationRequest } from '../../../shared/generationContract'
import type { createGenerationCandidateCoordinator } from './prepareGenerationCandidate'

export type GenerationPrepared = Awaited<ReturnType<ReturnType<typeof createGenerationCandidateCoordinator>['prepare']>>
type ApplyResult = ReturnType<ReturnType<typeof createGenerationCandidateCoordinator>['apply']>
export interface GenerationTaskView {
  busy: boolean
  phase: 'observing' | 'running' | 'checking' | 'awaiting-apply' | 'committing' | 'feeding-back' | 'completed' | 'failed' | 'cancelled'
  notice: string
  error?: string
  sessionId?: string
  request?: GenerationRequest
  record?: LocalAgentRecord
  events: LocalAgentEvent[]
  preview?: GenerationPrepared
  result?: LocalAgentHostResult
  receipt?: GenerationCommitReceipt
  canRetryFeedback?: boolean
}
interface Ports {
  api: Pick<DesktopAPI, 'localAgent'>
  owner: { projectId: string; projectPath: string }
  isCurrent(request: GenerationRequest): boolean
  captureNext(previous: GenerationRequest, receipt?: GenerationCommitReceipt): Promise<GenerationRequest>
  prepare(request: GenerationRequest, candidate: GenerationCandidate): Promise<GenerationPrepared>
  apply(previewId: string): ApplyResult
  beforeApply?(): Promise<void>
  discard(): void
  onView(view: GenerationTaskView): void
}
const explanation = (error: unknown) => error instanceof Error ? error.message : String(error)
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 250))
class HostResultFeedbackError extends Error {
  constructor(readonly cause: unknown) { super(`宿主结果反馈未保存：${explanation(cause)}`) }
}
class TaskDeadlineError extends Error {
  constructor() { super('本任务的20分钟执行期限已到，请补充要求并重新观察后继续；未应用候选已丢弃') }
}
type HostResultRequest = Extract<LocalAgentRequest, { operation: 'host-result' }>

/** Renderer coordinates product operations only; the native CLI decides each next edit. */
export class GenerationTaskController {
  private epoch = 0
  private view: GenerationTaskView = { busy: false, phase: 'completed', notice: '', events: [] }
  private decision?: (action: 'apply' | 'correct' | 'stop') => void
  private after = 0
  private startedAt = 0
  private deadlineAt = Infinity
  private pendingFeedback?: HostResultRequest
  private feedbackStopped = false
  private stageAbort = new AbortController()
  private sessionEpoch = 0
  private confirmedStages: Array<{ receipt: GenerationCommitReceipt; summary: string }> = []
  private currentOperation = '连接 CLI 并开始任务'
  private candidateSummary?: string
  constructor(private readonly ports: Ports) {}
  get current() { return this.view }
  private update(patch: Partial<GenerationTaskView>) {
    this.view = { ...this.view, ...patch }
    this.ports.onView(this.view)
  }
  private requireCurrent(request: GenerationRequest, epoch: number) {
    this.requireActive(epoch)
    if (epoch !== this.epoch || !this.ports.isCurrent(request)) throw new Error('stale：工程或任务已改变，未应用的修改已丢弃')
  }
  private requireActive(epoch: number) {
    if (epoch !== this.epoch) throw new Error('stale：任务已改变')
    if (Date.now() >= this.deadlineAt) throw new TaskDeadlineError()
  }
  private async stage<T>(operation: () => Promise<T>, epoch: number): Promise<T> {
    this.requireActive(epoch)
    let timer: ReturnType<typeof setTimeout> | undefined
    const signal = this.stageAbort.signal
    let onAbort: (() => void) | undefined
    try {
      const value = await Promise.race([operation(), new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('stale：任务已停止'))
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
        timer = setTimeout(() => { if (epoch === this.epoch) this.ports.discard(); reject(new TaskDeadlineError()) }, Math.max(0, this.deadlineAt - Date.now()))
      })])
      this.requireActive(epoch)
      return value
    } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort) }
  }
  private acceptRecord(response: LocalAgentResponse) {
    const record = response.records?.[0]
    if (!record) return
    if (record.task?.deadlineAt != null) this.deadlineAt = Math.min(this.deadlineAt, record.task.deadlineAt)
    this.update({ record })
  }
  private withBudget(request: GenerationRequest): GenerationRequest {
    if (request.execution) this.deadlineAt = Math.min(this.deadlineAt, request.execution.deadlineAt)
    return { ...request, execution: { version: 1, startedAt: this.startedAt, deadlineAt: this.deadlineAt } }
  }
  private cancelLateLaunch(sessionId: string, epoch: number) {
    // A resumed session may now belong to a newer task; never cancel that owner.
    if (this.view.sessionId === sessionId && this.sessionEpoch !== epoch) return
    void this.ports.api.localAgent({ operation: 'cancel', ...this.ports.owner, sessionId }).catch(() => {})
  }
  private deadlineNotice() {
    const stages = this.confirmedStages.map(({ receipt, summary }, index) =>
      `${index + 1}. ${receipt.status === 'committed' ? '已提交' : '已确认无需修改'}：${summary}`).join('；')
    const completed = this.confirmedStages.some(stage => stage.receipt.status === 'committed')
      ? `${stages}。此前合法提交已保留。`
      : `本任务零修改，没有已提交的修改。${stages ? `${stages}。` : ''}`
    const operation = this.currentOperation === '等待 CLI 的本阶段结果' && this.view.record?.task?.status === 'waiting-input'
      ? '等待回答 CLI 的当前问题' : this.currentOperation
    const unfinished = `${operation}${this.candidateSummary ? `（${this.candidateSummary}）` : ''}`
    const recovery = this.pendingFeedback
      ? '先重试保存实际结果的回执，只补记录、不重复应用；然后从当前课件重新观察，准备剩余操作。'
      : '从当前课件重新观察，再根据未完成操作准备新候选。'
    return `已完成：${completed}\n未完成：${unfinished}。\n恢复点：${recovery}未应用的旧候选已丢弃，不可直接应用。`
  }
  async start(request: GenerationRequest, adapter: LocalAgentId, resumeSessionId?: string) {
    if (this.view.busy) throw new Error('当前任务正在运行')
    if (this.pendingFeedback) throw new Error('请先重试保存已经应用的宿主结果，避免丢失真实回执')
    const epoch = ++this.epoch
    this.stageAbort.abort(); this.stageAbort = new AbortController()
    this.startedAt = request.execution?.startedAt ?? Date.now()
    this.deadlineAt = Math.min(request.execution?.deadlineAt ?? Infinity, this.startedAt + MAX_GENERATION_TASK_DURATION_MS)
    request = this.withBudget(request)
    this.feedbackStopped = false
    this.after = 0
    this.confirmedStages = []; this.currentOperation = '连接 CLI 并开始任务'; this.candidateSummary = undefined
    this.ports.discard()
    this.update({ busy: true, phase: 'observing', notice: '已同步当前课件，正在连接 CLI', error: undefined,
      events: [], request, record: undefined, result: undefined, receipt: undefined, preview: undefined, sessionId: undefined, canRetryFeedback: false })
    try { await this.drive(request, adapter, epoch, resumeSessionId) }
    catch (error) {
      if (epoch !== this.epoch) return
      this.ports.discard()
      if (this.view.sessionId && !this.pendingFeedback) {
        // Cancellation cleanup must not keep the failed UI busy beyond its task budget.
        void this.ports.api.localAgent({ operation: 'cancel', ...this.ports.owner, sessionId: this.view.sessionId }).catch(() => {})
      }
      if (epoch !== this.epoch) return
      // Main can reject at the shared deadline before this renderer's timer
      // callback runs; retain that absolute-time fact without matching text.
      const timedOut = Date.now() >= this.deadlineAt || error instanceof TaskDeadlineError
        || error instanceof HostResultFeedbackError && error.cause instanceof TaskDeadlineError
      this.update({ busy: false, phase: 'failed', preview: undefined, error: explanation(error), canRetryFeedback: Boolean(this.pendingFeedback),
        notice: timedOut ? this.deadlineNotice() : this.view.receipt ? '本任务未全部完成；已提交的阶段保留' : '本任务未完成，课件未应用本轮候选' })
    }
  }
  private async drive(initial: GenerationRequest, adapter: LocalAgentId, epoch: number, resumeSessionId?: string) {
    let request = initial
    let continuation = false
    for (;;) {
      this.candidateSummary = undefined
      this.currentOperation = continuation ? '将实际反馈交回 CLI 并继续处理' : '连接 CLI 并开始任务'
      this.requireCurrent(request, epoch)
      const launchDeadline = this.deadlineAt
      const launch = await this.stage(() => this.ports.api.localAgent(continuation
        ? { operation: 'continue', ...this.ports.owner, sessionId: this.view.sessionId!, request }
        : { operation: 'generate', ...this.ports.owner, adapter, request, ...(resumeSessionId ? { resumeSessionId } : {}) }).then(response => {
        if (response.sessionId && (epoch !== this.epoch || Date.now() >= launchDeadline)) this.cancelLateLaunch(response.sessionId, epoch)
        return response
      }), epoch)
      if (!launch.sessionId) throw new Error('CLI 没有返回当前会话')
      const sessionId = launch.sessionId
      if (epoch !== this.epoch) { this.cancelLateLaunch(sessionId, epoch); return }
      this.sessionEpoch = epoch
      this.currentOperation = '等待 CLI 的本阶段结果'
      this.update({ phase: 'running', sessionId: launch.sessionId, request, events: [], preview: undefined, notice: continuation ? '已把实际结果交回同一 CLI，正在继续' : '正在回复…' })
      const events: LocalAgentEvent[] = []
      let record: LocalAgentRecord
      for (;;) {
        const response = await this.stage(() => this.ports.api.localAgent({ operation: 'read', ...this.ports.owner, sessionId, after: this.after }), epoch)
        if (epoch !== this.epoch) return
        if (response.fileStatus && response.fileStatus.status !== 'current') throw new Error(`stale：${response.fileStatus.message}`)
        record = response.records?.[0]!
        if (!record) throw new Error('会话记录不可用')
        this.acceptRecord(response)
        this.requireActive(epoch)
        for (const event of record.events) if (event.sequence > this.after) { events.push(event); this.after = event.sequence }
        this.update({ record, events: [...events] })
        if (record.status !== 'running' && record.events.length < 200) break
        if (record.events.length < 200) await this.stage(pause, epoch)
      }
      if (record.status !== 'completed') {
        const terminal = [...events].reverse().find(event => event.kind === 'failed')
        const payload = terminal?.payload
        throw new Error(payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.message === 'string' ? payload.message : 'CLI 本轮未完成，请检查原生认证或重试')
      }
      this.currentOperation = '读取 CLI 的本阶段结果'
      const response = await this.stage(() => this.ports.api.localAgent({ operation: 'candidate', ...this.ports.owner, sessionId }), epoch)
      if (epoch !== this.epoch) return
      this.acceptRecord(response)
      const outcome = response.generationResult
      if (!outcome || outcome.requestId !== request.requestId) throw new Error('CLI 返回结果与当前请求不一致')
      if (outcome.kind === 'incomplete') {
        this.update({ busy: false, phase: 'failed', notice: outcome.finding, error: outcome.finding })
        return
      }
      if (outcome.kind === 'answer') {
        this.update({ busy: false, phase: 'completed', notice: this.view.receipt ? '本任务已应用修改，CLI 已收到实际结果' : request.intent === 'plan' ? '本轮已回复，尚未修改课件' : request.intent === 'discuss' ? '讨论完成，尚未修改课件' : '回复完成，本轮没有修改课件' })
        return
      }
      if (request.intent && request.intent !== 'edit') throw new Error('讨论和计划没有工程修改授权')
      let result: LocalAgentHostResult
      let receipt: GenerationCommitReceipt | undefined
      try {
        this.requireCurrent(request, epoch)
        if (outcome.kind === 'candidate-format-error' || outcome.kind === 'candidate-rejected') throw outcome.failure ? new GenerationCandidatePreparationError(outcome.failure) : new Error(outcome.finding)
        this.candidateSummary = outcome.candidate.summary
        this.currentOperation = '检查并准入当前候选'
        this.update({ phase: 'checking', notice: '正在检查修改内容和运行结果' })
        const prepared = await this.stage(() => this.ports.prepare(request, outcome.candidate), epoch)
        this.requireCurrent(request, epoch)
        this.currentOperation = '保存候选检查结果'
        await this.remember({ requestId: request.requestId, candidateId: prepared.candidateId, status: 'checked', summary: prepared.summary,
          beforeRevision: prepared.beforeRevision, afterRevision: prepared.afterRevision })
        this.requireCurrent(request, epoch)
        if (request.applyPolicy !== 'auto') {
          this.currentOperation = '等待确认并应用当前候选'
          this.update({ phase: 'awaiting-apply', notice: '检查通过，请查看效果后应用', preview: prepared })
          let action: 'apply' | 'correct' | 'stop'
          try { action = await this.stage(() => new Promise<'apply' | 'correct' | 'stop'>(resolve => { this.decision = resolve }), epoch) }
          finally { if (epoch === this.epoch) this.decision = undefined }
          this.requireCurrent(request, epoch)
          if (action !== 'apply') throw new Error(action === 'correct' ? '用户补充了要求，请结合下一轮输入重新准备候选' : '任务已停止')
        }
        this.currentOperation = '提交前核对当前工程'
        this.update({ phase: 'committing', notice: '正在应用本阶段修改', preview: undefined })
        if (this.ports.beforeApply) await this.stage(() => this.ports.beforeApply!(), epoch)
        this.requireCurrent(request, epoch)
        this.currentOperation = '应用当前候选'
        const applied = this.ports.apply(prepared.previewId)
        if (applied.status === 'stale') throw new Error('stale：工程已改变，未应用候选')
        receipt = applied.receipt
        // Capture only actual apply receipts before any fallible feedback await.
        // This is a task-local presentation of facts, not an additional history.
        this.confirmedStages.push({ receipt, summary: prepared.summary })
        result = { requestId: request.requestId, candidateId: prepared.candidateId, status: applied.status, summary: prepared.summary,
          beforeRevision: receipt.beforeRevision, afterRevision: receipt.afterRevision,
          ...(prepared.behaviorEvidence.some(evidence => evidence.semanticVerdict === 'requires-review')
            ? { afterCommit: { version: 1, action: 'observe', reason: '需要结合已采集的动态行为帧确认效果' } }
            : outcome.candidate.afterCommit ? { afterCommit: outcome.candidate.afterCommit } : {}) }
      } catch (error) {
        // A cancelled turn must not discard a newer task's prepared candidate.
        if (epoch !== this.epoch) return
        if (error instanceof HostResultFeedbackError || error instanceof TaskDeadlineError) throw error
        this.ports.discard()
        const fresh = this.ports.isCurrent(request) && !explanation(error).startsWith('stale：')
        const failure = readGenerationFailure(error)
        result = { requestId: request.requestId, ...(outcome.kind === 'candidate' ? { candidateId: outcome.candidate.candidateId }
          : outcome.kind === 'candidate-rejected' ? { candidateId: outcome.candidateId } : {}),
          status: fresh ? 'rejected' : 'stale', summary: explanation(error).slice(0, 4000),
          ...(failure ? { failure } : {}) }
        this.currentOperation = '保存当前候选的失败诊断'
        await this.remember(result)
        if (!fresh) throw error
      }
      if (receipt) {
        // The live receipt must survive a failed feedback write. Never retry the live commit.
        this.currentOperation = '保存已应用阶段的正式回执'
        this.update({ receipt, result, phase: 'feeding-back', notice: '本阶段已应用，正在保存实际结果' })
        await this.remember(result, receipt)
        if (epoch !== this.epoch) return
        if (result.afterCommit?.action === 'finish') {
          this.finishReceipt(result)
          return
        }
      }
      if (epoch !== this.epoch) return
      this.currentOperation = receipt ? '重新观察课件并核对本阶段效果' : '重新观察课件以修正失败候选'
      this.update({ phase: 'feeding-back', preview: undefined, notice: receipt ? '本阶段已应用；正在同步最新画面给 CLI' : '已将具体问题交回 CLI 修正', result })
      const next = await this.stage(() => this.ports.captureNext(request, receipt), epoch)
      if (epoch !== this.epoch) return
      request = this.withBudget({ ...next, expectedResult: 'auto' })
      continuation = true
    }
  }
  private async remember(result: LocalAgentHostResult, receipt?: GenerationCommitReceipt) {
    const epoch = this.epoch
    const request: HostResultRequest = { operation: 'host-result', ...this.ports.owner, sessionId: this.view.sessionId!, result, ...(receipt ? { commitReceipt: receipt } : {}) }
    if (receipt) this.pendingFeedback = structuredClone(request)
    let response: LocalAgentResponse
    try { response = await this.stage(() => this.ports.api.localAgent(request), epoch) }
    catch (error) {
      // Idempotent receipt storage is safe to retry after an uncertain IPC response.
      if (receipt && epoch === this.epoch && !(error instanceof TaskDeadlineError)) {
        try { response = await this.stage(() => this.ports.api.localAgent(request), epoch) }
        catch (retryError) { throw new HostResultFeedbackError(retryError) }
      } else throw new HostResultFeedbackError(error)
    }
    if (receipt && this.pendingFeedback?.sessionId === request.sessionId && this.pendingFeedback.result.requestId === request.result.requestId) this.pendingFeedback = undefined
    if (epoch === this.epoch) { this.acceptRecord(response); this.update({ result, canRetryFeedback: false }) }
  }
  private finishReceipt(result: LocalAgentHostResult) {
    const task = this.view.record?.task
    if (this.feedbackStopped || (task && task.status !== 'completed')) {
      this.update({ busy: false, phase: 'failed', preview: undefined, canRetryFeedback: false, notice: '实际结果已保存；已提交的阶段保留，请补充要求后继续' })
      return
    }
    this.update({ busy: false, phase: 'completed', preview: undefined, error: undefined, canRetryFeedback: false,
      notice: result.status === 'unchanged' ? '已确认当前内容满足要求，无需修改' : '修改已应用，实际结果已保存' })
  }
  /** Repairs only the known host receipt. It never reapplies a candidate or starts a native turn. */
  async retryFeedback() {
    if (this.view.busy) throw new Error('当前任务正在运行')
    const request = this.pendingFeedback
    if (!request?.commitReceipt) throw new Error('没有待保存的实际提交回执')
    const epoch = this.epoch
    this.update({ busy: true, phase: 'feeding-back', error: undefined, notice: '正在重试保存已应用的实际结果' })
    try {
      // Recording an already completed transaction remains valid after the execution deadline.
      const response = await this.ports.api.localAgent(structuredClone(request))
      if (this.pendingFeedback === request) this.pendingFeedback = undefined
      if (epoch !== this.epoch) {
        if (!this.pendingFeedback && this.view.sessionId === request.sessionId && this.view.receipt?.candidateId === request.commitReceipt.candidateId) this.update({ canRetryFeedback: false })
        return
      }
      this.acceptRecord(response)
      this.update({ result: request.result, receipt: request.commitReceipt, canRetryFeedback: false })
      if (request.result.afterCommit?.action === 'finish') this.finishReceipt(request.result)
      else this.update({ busy: false, phase: 'failed', notice: '实际结果已保存；已提交的阶段保留，请补充要求并重新观察后继续' })
    } catch (error) {
      if (epoch !== this.epoch) return
      this.update({ busy: false, phase: 'failed', canRetryFeedback: true, error: explanation(error), notice: '实际结果仍未保存；已提交的阶段保留，可再次重试' })
    }
  }
  applyPreview() { this.decision?.('apply') }
  async input(input: AiUserInput) {
    if (!this.view.busy || !this.view.sessionId) throw new Error('任务已经结束')
    const epoch = this.epoch, sessionId = this.view.sessionId
    const result = await this.stage(() => this.ports.api.localAgent({ operation: 'input', ...this.ports.owner, sessionId, input }), epoch)
    if (epoch !== this.epoch || sessionId !== this.view.sessionId) return result.inputDelivery
    if (!result.inputDelivery || result.inputDelivery.status === 'rejected') throw new Error(result.inputDelivery?.reason ?? 'CLI 没有接受输入')
    if (this.view.phase === 'awaiting-apply' && (input.kind === 'correct' || input.kind === 'supplement')) this.decision?.('correct')
    this.update({ notice: result.inputDelivery.status === 'queued' ? '输入已排队，将在下一原生回合消费' : 'CLI 已接收输入，正在继续' })
    return result.inputDelivery
  }
  async stop() {
    ++this.epoch
    this.stageAbort.abort()
    this.feedbackStopped = true
    this.ports.discard()
    this.decision?.('stop'); this.decision = undefined
    const id = this.view.sessionId
    this.update({ busy: false, phase: 'cancelled', preview: undefined, canRetryFeedback: Boolean(this.pendingFeedback), notice: this.view.receipt ? '已停止；已应用的阶段保留，可按顺序撤销' : '已停止；未应用候选已丢弃' })
    if (id) await this.ports.api.localAgent({ operation: 'cancel', ...this.ports.owner, sessionId: id })
  }
}
