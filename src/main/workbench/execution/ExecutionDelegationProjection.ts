import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import type { ExecutionEvent, ExecutionEventInput } from '../../../shared/workbench/executionEvents'

type Interaction = Pick<ExecutionEventInput['data'], 'toolName' | 'label' | 'question' | 'approval'>
type Reference = NonNullable<ExecutionEventInput['data']['delegationRef']>

/** A view of the original child's user interaction in its owner's existing timeline.
 * It cannot answer, approve, send messages, start runs or change either run's status. */
export class ExecutionDelegationProjection {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly open = new Map<string, Map<string, Interaction>>()
  constructor(private readonly options: {
    readRun(runId: string): Promise<ExecutionRunRecord | null>
    append(event: ExecutionEventInput): Promise<unknown>
    onError?(error: unknown): void
  }) {}

  enqueue(event: ExecutionEvent): void {
    if (event.source !== 'builtin' || event.data.delegationRef || !['tool', 'run.end'].includes(event.type)) return
    const previous = this.queues.get(event.runId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.project(event))
    this.queues.set(event.runId, next)
    void next.then(() => this.release(event.runId, next), error => {
      this.release(event.runId, next)
      this.options.onError?.(error)
    })
  }

  private release(runId: string, queued: Promise<void>): void {
    if (this.queues.get(runId) === queued) this.queues.delete(runId)
  }

  /** Called after the existing event producers have drained; no background owner survives shutdown. */
  async flush(): Promise<void> {
    while (this.queues.size) await Promise.allSettled([...this.queues.values()])
  }

  private async project(event: ExecutionEvent): Promise<void> {
    const watched = this.open.get(event.runId)
    if (event.type === 'run.end' && !watched?.size) return
    const prior = watched?.get(event.itemId)
    if (event.type === 'tool' && !event.data.question && !event.data.approval && !prior) return
    const child = await this.options.readRun(event.runId)
    if (!child?.delegatedBy) return
    if (event.type === 'run.end') {
      // A terminal child with an unanswered interaction closes only that card.
      // No parent run.state/run.end event is synthesized.
      for (const [callId, interaction] of watched!) await this.forward(child, event, callId, {
        ...interaction, status: 'cancelled', error: '子任务已结束，这项等待已关闭；原运行中的回答和决定仍然保留。',
      })
      this.open.delete(event.runId)
      return
    }
    const question = event.data.question ?? prior?.question, approval = event.data.approval ?? prior?.approval
    const interaction: Interaction = {
      toolName: event.data.toolName ?? prior?.toolName,
      label: event.data.label ?? prior?.label,
      ...(question ? { question } : {}), ...(approval ? { approval } : {}),
    }
    const pending = event.data.status === 'waiting' && !!interaction.question
      || event.data.status === 'approval' && !!interaction.approval
    if (pending) {
      const current = watched ?? new Map<string, Interaction>()
      current.set(event.itemId, interaction); this.open.set(event.runId, current)
    } else {
      watched?.delete(event.itemId)
      if (!watched?.size) this.open.delete(event.runId)
    }
    await this.forward(child, event, event.itemId, {
      ...interaction, status: event.data.status,
      ...(event.data.answer ? { answer: event.data.answer } : {}),
      ...(event.data.decision ? { decision: event.data.decision } : {}),
      ...(event.data.error ? { error: event.data.error } : {}),
    })
  }

  private async forward(child: ExecutionRunRecord, event: ExecutionEvent, callId: string, data: ExecutionEventInput['data']): Promise<void> {
    const reference: Reference = { runId: child.runId, callId, parentRunId: child.delegatedBy!.runId, jobId: child.delegatedBy!.jobId }
    const visited = new Set([child.runId])
    let current = child
    while (current.delegatedBy) {
      const parentId = current.delegatedBy.runId
      if (visited.has(parentId)) throw new Error('子任务来源引用形成循环，未投影到无关任务。')
      visited.add(parentId)
      const parent = await this.options.readRun(parentId)
      if (!parent) throw new Error('子任务的宿主父运行不存在，等待事项未投影到其他会话。')
      await this.options.append({
        eventId: `delegation:${event.eventId}:${parent.runId}:${callId}`,
        conversationId: parent.input.conversationId, taskId: parent.input.taskId, runId: parent.runId,
        itemId: `delegation:${child.runId}:${callId}`, time: event.time, source: 'builtin', type: 'tool', update: 'snapshot',
        data: { ...data, label: `子任务 · ${data.label ?? (data.question ? '等待你的回答' : '等待你的决定')}`,
          jobId: reference.jobId, delegationRef: reference },
      })
      current = parent
    }
  }
}
