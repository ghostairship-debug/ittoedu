import { localAgentEventSchema, localAgentRecordSchema, type LocalAgentEvent, type LocalAgentHostResult, type LocalAgentRecord } from './localAgentContract'
import { localAgentText } from './localAgentText'
import type { GenerationRequest } from './generationContract'
import type { AiHostResult, LocalAgentEventV2, LocalAgentRecordV2 } from './localAgentTaskContract'

export interface LocalAgentV1ProjectionInput {
  readonly generationRequest?: GenerationRequest
  readonly hostResult?: LocalAgentHostResult
  readonly cleanupIssue?: string
  readonly live?: boolean
}

function failureCategory(event: Extract<LocalAgentEventV2, { kind: 'turn-ended' }>): LocalAgentEvent['failure'] {
  if (event.status !== 'failed' || !event.failure) return undefined
  if (event.failure.category === 'limit') return 'output-limit'
  if (event.failure.category === 'storage') return 'storage'
  if (event.failure.category === 'service') return 'rate-limited'
  if (event.failure.category === 'capability') return 'unsupported-version'
  return event.failure.category === 'transport' ? 'launch' : 'protocol'
}

function projectEvent(record: LocalAgentRecordV2, event: LocalAgentEventV2, sequence: number): LocalAgentEvent | null {
  const base = {
    version: 1 as const, adapter: record.adapter, sessionId: record.id,
    ...(record.externalSessionId ? { externalSessionId: record.externalSessionId } : {}),
    sequence, time: event.time,
  }
  if (event.kind === 'text') {
    return localAgentEventSchema.parse({
      ...base, kind: 'text',
      payload: { text: event.text, messageId: `${event.runId}:${event.itemId}`, phase: event.phase, ...(event.operation === 'append' ? { delta: true } : {}) },
    })
  }
  if (event.kind === 'tool') {
    return localAgentEventSchema.parse({
      ...base, kind: event.status === 'running' ? 'tool-call' : 'tool-result',
      payload: { id: event.itemId, name: event.name, status: event.status, output: event.detail },
    })
  }
  if (event.kind === 'usage') {
    return localAgentEventSchema.parse({
      ...base, kind: 'usage',
      payload: { input_tokens: event.inputTokens, output_tokens: event.outputTokens, cached_input_tokens: event.cachedInputTokens },
    })
  }
  if (event.kind === 'turn-ended') {
    if (event.status === 'completed') return localAgentEventSchema.parse({ ...base, kind: 'completed', payload: {} })
    if (event.status === 'cancelled') return localAgentEventSchema.parse({ ...base, kind: 'cancelled', payload: {} })
    return localAgentEventSchema.parse({
      ...base, kind: 'failed', failure: failureCategory(event),
      payload: { message: event.failure?.message ?? 'CLI 运行未完成' },
    })
  }
  if (event.kind === 'question') {
    return localAgentEventSchema.parse({ ...base, kind: 'session', payload: { status: 'question', question: event.question } })
  }
  if (event.kind === 'input-delivery') {
    return localAgentEventSchema.parse({ ...base, kind: 'session', payload: { status: 'input-delivery', delivery: event.delivery } })
  }
  if (event.kind === 'configuration') {
    return localAgentEventSchema.parse({ ...base, kind: 'session', payload: { status: 'configuration', capabilities: event.capabilities } })
  }
  return null
}

export function projectAiHostResult(result: AiHostResult): LocalAgentHostResult {
  return {
    requestId: result.requestId, candidateId: result.candidateId, summary: result.summary,
    status: result.status === 'failed' ? 'rejected' : result.status,
    beforeRevision: result.beforeRevision, afterRevision: result.afterRevision,
  }
}

/** Read-only V1 display. Never persist or submit this object. */
export function projectV2RecordToV1(record: LocalAgentRecordV2, input: LocalAgentV1ProjectionInput = {}): LocalAgentRecord {
  const events: LocalAgentEvent[] = []
  if (record.externalSessionId) {
    events.push(localAgentEventSchema.parse({
      version: 1, adapter: record.adapter, sessionId: record.id, externalSessionId: record.externalSessionId,
      sequence: 1, time: record.events[0]?.time ?? 0, kind: 'session', payload: {},
    }))
  }
  for (const event of record.events) {
    // Old turns remain visible history without terminating the current display run.
    if (event.kind === 'turn-ended' && event !== record.events.at(-1)) {
      events.push(localAgentEventSchema.parse({ version: 1, adapter: record.adapter, sessionId: record.id,
        sequence: events.length + 1, time: event.time, kind: 'session', payload: { status: 'turn-ended', outcome: event.status, runId: event.runId } }))
      continue
    }
    const projected = projectEvent(record, event, events.length + 1)
    if (projected) events.push({ ...projected, sequence: events.length + 1 })
  }
  const task = record.tasks.at(-1)
  const terminal = [...events].reverse().find(event => ['completed', 'failed', 'cancelled'].includes(event.kind))
  const status = input.live ? 'running' as const
    : terminal?.kind === 'failed' || terminal?.kind === 'cancelled' || terminal?.kind === 'completed' ? terminal.kind
    : task && ['completed', 'failed', 'cancelled', 'partial'].includes(task.status) ? (task.status === 'partial' ? 'completed' : task.status)
    : 'running'
  const hostResult = input.hostResult ?? (record.hostResults.at(-1) ? projectAiHostResult(record.hostResults.at(-1)!) : undefined)
  return localAgentRecordSchema.parse({
    version: 1, id: record.id, adapter: record.adapter, workspace: record.workspace,
    workingDirectoryId: record.workingDirectoryId, status, events,
    ...(task ? { task: { taskId: task.taskId, epoch: task.epoch, intent: task.intent, applyPolicy: task.applyPolicy,
      status: task.status, turnId: record.events.at(-1)?.nativeTurnId ?? null,
      deadlineAt: task.execution?.deadlineAt ?? null, committedStages: task.committedResultIds.length } } : {}),
    ...(record.externalSessionId ? { externalSessionId: record.externalSessionId } : {}),
    ...(input.generationRequest ? { generationRequest: input.generationRequest, generationRequestId: input.generationRequest.requestId } : {}),
    ...(hostResult ? { hostResult } : {}),
    ...(input.cleanupIssue ? { cleanupIssue: input.cleanupIssue } : {}),
  })
}

export function projectedAgentText(record: LocalAgentRecordV2, input: LocalAgentV1ProjectionInput = {}): string {
  return localAgentText(projectV2RecordToV1(record, input).events)
}
