import { z } from 'zod'
import type { LocalAgentEvent, LocalAgentId } from '../../shared/localAgentContract'

export type AgentEventData = Pick<LocalAgentEvent, 'kind' | 'payload' | 'failure' | 'externalSessionId'>
const object = z.record(z.string(), z.json())
function record(value: unknown): Record<string, any> { return object.parse(value) }
const event = (kind: AgentEventData['kind'], payload: AgentEventData['payload']): AgentEventData => ({ kind, payload })
function failure(payload: AgentEventData['payload']): AgentEventData {
  const message = JSON.stringify(payload)
  return { ...event('failed', payload), failure: /429|rate.limit|FreeUsageLimit/i.test(message) ? 'rate-limited' : /401|unauth|not logged|authentication|token refresh|api.key/i.test(message) ? 'unauthenticated' : 'crash' }
}
/** Protocol-specific decoding. Unknown wire types fail closed instead of guessing terminal prose. */
export function decodeAgentEvent(adapter: LocalAgentId, input: unknown): AgentEventData[] {
  const wire = record(input)
  if (adapter === 'codex') {
    switch (wire.type) {
      case 'thread.started': return [{ ...event('session', {}), externalSessionId: z.string().min(1).parse(wire.thread_id) }]
      case 'turn.started': return []
      case 'turn.completed': return [event('usage', wire.usage ?? {}), event('completed', {})]
      case 'turn.failed': case 'error': return [failure(wire.error ?? wire.message ?? 'CLI error')]
      case 'item.started': case 'item.updated': case 'item.completed': {
        const item = record(wire.item)
        if (item.type === 'agent_message') return wire.type === 'item.completed' ? [event('text', { text: z.string().parse(item.text) })] : []
        if (item.type === 'reasoning' || item.type === 'todo_list') return []
        if (item.type === 'error') return [failure(item)]
        if (!['command_execution', 'file_change', 'mcp_tool_call', 'web_search', 'collab_tool_call'].includes(item.type)) throw new Error('Unsupported Codex item')
        const id = z.string().min(1).parse(item.id)
        return wire.type === 'item.updated' ? [] : [event(wire.type === 'item.started' ? 'tool-call' : 'tool-result', { id, ...item })]
      }
      default: throw new Error('Unsupported Codex event')
    }
  }
  if (adapter === 'claude') {
    switch (wire.type) {
      case 'system':
        if (wire.subtype === 'init') return [{ ...event('session', {}), externalSessionId: z.string().min(1).parse(wire.session_id) }]
        if (wire.subtype === 'api_retry') return [{ ...event('session', {
          status: 'api-retry', attempt: z.number().int().positive().parse(wire.attempt),
          maxRetries: z.number().int().nonnegative().parse(wire.max_retries),
          retryDelayMs: z.number().int().nonnegative().parse(wire.retry_delay_ms),
          errorStatus: z.number().int().nullable().parse(wire.error_status), error: z.string().parse(wire.error),
        }), externalSessionId: z.string().min(1).parse(wire.session_id) }]
        // CLI thinking-token progress is usage metadata, never assistant prose or a terminal marker.
        if (wire.subtype === 'thinking_tokens') return [event('usage', wire)]
        if (['status', 'compact_boundary', 'task_started', 'task_progress', 'task_notification'].includes(wire.subtype)) return []
        throw new Error(`Unsupported Claude system event: ${String(wire.subtype).slice(0, 100)}`)
      case 'assistant': return z.array(object).parse(wire.message?.content).flatMap(block => {
        if (block.type === 'text') return [event('text', { text: z.string().parse(block.text) })]
        if (block.type === 'thinking' || block.type === 'redacted_thinking') return []
        if (block.type === 'tool_use') return [event('tool-call', { id: z.string().parse(block.id), name: block.name ?? '', input: block.input ?? {} })]
        throw new Error('Unsupported Claude content block')
      })
      case 'user': return z.array(object).parse(wire.message?.content).flatMap(block => block.type === 'tool_result'
        ? [event('tool-result', { id: z.string().parse(block.tool_use_id), content: block.content ?? '' })] : [])
      case 'result': return wire.is_error
        ? [failure({ message: wire.result ?? wire.errors ?? 'CLI failed' })]
        : [event('usage', wire.usage ?? {}), event('completed', {})]
      case 'rate_limit_event': return []
      default: throw new Error('Unsupported Claude event')
    }
  }
  const externalSessionId = z.string().min(1).parse(wire.sessionID)
  let events: AgentEventData[]
  switch (wire.type) {
    case 'step_start': events = [event('session', {})]; break
    case 'text': events = [event('text', { text: z.string().parse(wire.part?.text) })]; break
    case 'reasoning': events = []; break
    case 'tool_use': {
      const part = record(wire.part)
      events = [event('tool-call', { id: z.string().parse(part.callID), name: part.tool, input: part.state?.input ?? {} }), event('tool-result', { id: part.callID, output: part.state?.output ?? part.state?.error ?? '' })]
      break
    }
    case 'step_finish': events = [event('usage', wire.part?.tokens ?? {}), ...(wire.part?.reason === 'stop' ? [event('completed', {})] : [])]; break
    case 'error': events = [failure(wire.error ?? {})]; break
    default: throw new Error('Unsupported OpenCode event')
  }
  return events.map(entry => ({ ...entry, externalSessionId }))
}
