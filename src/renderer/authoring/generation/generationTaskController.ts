import type { DesktopAPI } from '../../../shared/ipcTypes'
import type { LocalAgentEvent, LocalAgentHostResult, LocalAgentId, LocalAgentRecord } from '../../../shared/localAgentContract'
import type { AiUserInput } from '../../../shared/localAgentInteraction'
import type { GenerationCandidate, GenerationCommitReceipt, GenerationRequest } from '../../../shared/generationContract'
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
  constructor(error: unknown) { super(`宿主结果反馈未保存：${explanation(error)}`) }
}

/** Renderer coordinates product operations only; the native CLI decides each next edit. */
export class GenerationTaskController {
  private epoch = 0
  private view: GenerationTaskView = { busy: false, phase: 'completed', notice: '', events: [] }
  private decision?: (action: 'apply' | 'correct' | 'stop') => void
  private after = 0
  constructor(private readonly ports: Ports) {}
  get current() { return this.view }
  private update(patch: Partial<GenerationTaskView>) {
    this.view = { ...this.view, ...patch }
    this.ports.onView(this.view)
  }
  private requireCurrent(request: GenerationRequest, epoch: number) {
    if (epoch !== this.epoch || !this.ports.isCurrent(request)) throw new Error('stale：工程或任务已改变，未应用的修改已丢弃')
  }
  async start(request: GenerationRequest, adapter: LocalAgentId, resumeSessionId?: string) {
    if (this.view.busy) throw new Error('当前任务正在运行')
    const epoch = ++this.epoch
    this.after = 0
    this.ports.discard()
    this.update({ busy: true, phase: 'observing', notice: '已同步当前课件，正在连接 CLI', error: undefined,
      events: [], request, record: undefined, result: undefined, receipt: undefined, preview: undefined, sessionId: undefined })
    try { await this.drive(request, adapter, epoch, resumeSessionId) }
    catch (error) {
      if (epoch !== this.epoch) return
      this.ports.discard()
      if (this.view.sessionId) await this.ports.api.localAgent({ operation: 'cancel', ...this.ports.owner, sessionId: this.view.sessionId }).catch(() => {})
      if (epoch !== this.epoch) return
      this.update({ busy: false, phase: 'failed', preview: undefined, error: explanation(error), notice: this.view.receipt ? '本任务未全部完成；已提交的阶段保留' : '本任务未完成，课件未应用本轮候选' })
    }
  }
  private async drive(initial: GenerationRequest, adapter: LocalAgentId, epoch: number, resumeSessionId?: string) {
    let request = initial
    let continuation = false
    for (;;) {
      this.requireCurrent(request, epoch)
      const launch = await this.ports.api.localAgent(continuation
        ? { operation: 'continue', ...this.ports.owner, sessionId: this.view.sessionId!, request }
        : { operation: 'generate', ...this.ports.owner, adapter, request, ...(resumeSessionId ? { resumeSessionId } : {}) })
      if (!launch.sessionId) throw new Error('CLI 没有返回当前会话')
      if (epoch !== this.epoch) { await this.ports.api.localAgent({ operation: 'cancel', ...this.ports.owner, sessionId: launch.sessionId }); return }
      this.update({ phase: 'running', sessionId: launch.sessionId, request, events: [], preview: undefined, notice: continuation ? '已把实际结果交回同一 CLI，正在继续' : '正在回复…' })
      const events: LocalAgentEvent[] = []
      let record: LocalAgentRecord
      for (;;) {
        const response = await this.ports.api.localAgent({ operation: 'read', ...this.ports.owner, sessionId: launch.sessionId, after: this.after })
        if (epoch !== this.epoch) return
        if (response.fileStatus && response.fileStatus.status !== 'current') throw new Error(`stale：${response.fileStatus.message}`)
        record = response.records?.[0]!
        if (!record) throw new Error('会话记录不可用')
        for (const event of record.events) if (event.sequence > this.after) { events.push(event); this.after = event.sequence }
        this.update({ record, events: [...events] })
        if (record.status !== 'running' && record.events.length < 200) break
        if (record.events.length < 200) await pause()
      }
      if (record.status !== 'completed') {
        const terminal = [...events].reverse().find(event => event.kind === 'failed')
        const payload = terminal?.payload
        throw new Error(payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.message === 'string' ? payload.message : 'CLI 本轮未完成，请检查原生认证或重试')
      }
      const response = await this.ports.api.localAgent({ operation: 'candidate', ...this.ports.owner, sessionId: launch.sessionId })
      if (epoch !== this.epoch) return
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
        if (outcome.kind === 'candidate-format-error' || outcome.kind === 'candidate-rejected') throw new Error(outcome.finding)
        this.update({ phase: 'checking', notice: '正在检查修改内容和运行结果' })
        const prepared = await this.ports.prepare(request, outcome.candidate)
        this.requireCurrent(request, epoch)
        await this.remember({ requestId: request.requestId, candidateId: prepared.candidateId, status: 'checked', summary: prepared.summary,
          beforeRevision: prepared.beforeRevision, afterRevision: prepared.afterRevision })
        this.requireCurrent(request, epoch)
        if (request.applyPolicy !== 'auto') {
          this.update({ phase: 'awaiting-apply', notice: '检查通过，请查看效果后应用', preview: prepared })
          const action = await new Promise<'apply' | 'correct' | 'stop'>(resolve => { this.decision = resolve })
          this.decision = undefined
          this.requireCurrent(request, epoch)
          if (action !== 'apply') throw new Error(action === 'correct' ? '用户补充了要求，请结合下一轮输入重新准备候选' : '任务已停止')
        }
        this.update({ phase: 'committing', notice: '正在应用本阶段修改', preview: undefined })
        await this.ports.beforeApply?.()
        this.requireCurrent(request, epoch)
        const applied = this.ports.apply(prepared.previewId)
        if (applied.status === 'stale') throw new Error('stale：工程已改变，未应用候选')
        receipt = applied.receipt
        result = { requestId: request.requestId, candidateId: prepared.candidateId, status: applied.status, summary: prepared.summary,
          beforeRevision: receipt.beforeRevision, afterRevision: receipt.afterRevision }
      } catch (error) {
        // A cancelled turn must not discard a newer task's prepared candidate.
        if (epoch !== this.epoch) return
        if (error instanceof HostResultFeedbackError) throw error
        this.ports.discard()
        const fresh = this.ports.isCurrent(request) && !explanation(error).startsWith('stale：')
        result = { requestId: request.requestId, ...(outcome.kind === 'candidate' ? { candidateId: outcome.candidate.candidateId }
          : outcome.kind === 'candidate-rejected' ? { candidateId: outcome.candidateId } : {}),
          status: fresh ? 'rejected' : 'stale', summary: explanation(error).slice(0, 4000) }
        await this.remember(result)
        if (!fresh) throw error
      }
      if (receipt) {
        // The live receipt must survive a failed feedback write. Never retry the live commit.
        this.update({ receipt, result })
        await this.remember(result, receipt)
      }
      if (epoch !== this.epoch) return
      this.update({ phase: 'feeding-back', preview: undefined, notice: receipt ? '本阶段已应用；正在同步最新画面给 CLI' : '已将具体问题交回 CLI 修正', result })
      const next = await this.ports.captureNext(request, receipt)
      if (epoch !== this.epoch) return
      request = { ...next, expectedResult: 'auto' }
      continuation = true
    }
  }
  private async remember(result: LocalAgentHostResult, receipt?: GenerationCommitReceipt) {
    const epoch = this.epoch
    const request = { operation: 'host-result' as const, ...this.ports.owner, sessionId: this.view.sessionId!, result, ...(receipt ? { commitReceipt: receipt } : {}) }
    try { await this.ports.api.localAgent(request) }
    catch (error) {
      // Idempotent receipt storage is safe to retry after an uncertain IPC response.
      if (receipt) {
        try { await this.ports.api.localAgent(request) }
        catch (retryError) { throw new HostResultFeedbackError(retryError) }
      } else throw new HostResultFeedbackError(error)
    }
    if (epoch === this.epoch) this.update({ result })
  }
  applyPreview() { this.decision?.('apply') }
  async input(input: AiUserInput) {
    if (!this.view.busy || !this.view.sessionId) throw new Error('任务已经结束')
    const epoch = this.epoch, sessionId = this.view.sessionId
    const result = await this.ports.api.localAgent({ operation: 'input', ...this.ports.owner, sessionId, input })
    if (epoch !== this.epoch || sessionId !== this.view.sessionId) return result.inputDelivery
    if (!result.inputDelivery || result.inputDelivery.status === 'rejected') throw new Error(result.inputDelivery?.reason ?? 'CLI 没有接受输入')
    if (this.view.phase === 'awaiting-apply' && (input.kind === 'correct' || input.kind === 'supplement')) this.decision?.('correct')
    this.update({ notice: result.inputDelivery.status === 'queued' ? '输入已排队，将在下一原生回合消费' : 'CLI 已接收输入，正在继续' })
    return result.inputDelivery
  }
  async stop() {
    ++this.epoch
    this.ports.discard()
    this.decision?.('stop'); this.decision = undefined
    const id = this.view.sessionId
    this.update({ busy: false, phase: 'cancelled', preview: undefined, notice: this.view.receipt ? '已停止；已应用的阶段保留，可按顺序撤销' : '已停止；未应用候选已丢弃' })
    if (id) await this.ports.api.localAgent({ operation: 'cancel', ...this.ports.owner, sessionId: id })
  }
}
