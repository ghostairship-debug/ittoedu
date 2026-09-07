import { z } from 'zod'
import type { LocalAgentEvent, LocalAgentId } from '../../shared/localAgentContract'

export type AgentEventData = Pick<LocalAgentEvent, 'kind' | 'payload' | 'failure' | 'externalSessionId'>
const object = z.record(z.string(), z.json())
function record(value: unknown): Record<string, any> { return object.parse(value) }
const event = (kind: AgentEventData['kind'], payload: AgentEventData['payload']): AgentEventData => ({ kind, payload })
export function createAgentEventDecoder(adapter: LocalAgentId) {
  let messageId = ''
  const claudeTextBlocks = new Map<string, number[]>()
  const activeTools = new Set<string>()
  return (input: unknown): AgentEventData[] => {
    const wire = record(input)
    if (adapter === 'claude' && wire.type === 'stream_event' && wire.event?.type === 'message_start') messageId = z.string().parse(wire.event.message.id)
    if (adapter === 'claude' && wire.type === 'stream_event' && wire.event?.type === 'content_block_start' && wire.event.content_block?.type === 'text') {
      const blocks = claudeTextBlocks.get(messageId) ?? []
      blocks.push(z.number().int().nonnegative().parse(wire.event.index))
      claudeTextBlocks.set(messageId, blocks)
    }
    if (adapter === 'claude' && wire.type === 'assistant') {
      // Claude emits completed content blocks separately and can omit thinking from
      // that array. Its array index is therefore not the native streaming index.
      const blocks = claudeTextBlocks.get(wire.message?.id)
      return decodeAgentEvent(adapter, wire).map(entry => {
        if (entry.kind !== 'text' || !blocks?.length) return entry
        return { ...entry, payload: { ...record(entry.payload), messageId: `${wire.message.id}:${blocks.shift()}` } }
      })
    }
    if (adapter === 'opencode' && wire.type === 'acp_update' && ['tool_call', 'tool_call_update'].includes(wire.update?.sessionUpdate)) {
      const update = wire.update
      const id = z.string().parse(update.toolCallId)
      const events: AgentEventData[] = []
      if (!activeTools.has(id)) { activeTools.add(id); events.push(event('tool-call', { id, name: update.title ?? '', input: update.rawInput ?? {} })) }
      if (update.status === 'completed' || update.status === 'failed') {
        activeTools.delete(id)
        events.push(event('tool-result', { id, output: update.content ?? update.rawOutput ?? '', status: update.status }))
      }
      return events.map(entry => ({ ...entry, externalSessionId: wire.sessionID }))
    }
    return decodeAgentEvent(adapter, { ...wire, ...(messageId ? { messageId } : {}) })
  }
}
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
      case 'agent_message_delta': return [event('text', { text: z.string().parse(wire.delta), messageId: z.string().parse(wire.itemId), delta: true })]
      case 'usage': return [event('usage', wire.usage ?? {})]
      case 'retry': return [event('session', { status: 'api-retry', message: wire.message, detail: wire.detail })]
      case 'turn.completed': return [event('usage', wire.usage ?? {}), event('completed', {})]
      case 'turn.failed': case 'error': return [failure(wire.error ?? wire.message ?? 'CLI error')]
      case 'item.started': case 'item.updated': case 'item.completed': {
        const item = record(wire.item)
        if (item.type === 'agent_message') return typeof item.text === 'string' ? [event('text', { text: item.text, ...(typeof item.id === 'string' ? { messageId: item.id } : {}) })] : []
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
      case 'stream_event': {
        const partial = record(wire.event)
        if (partial.type === 'content_block_delta' && partial.delta?.type === 'text_delta') return [event('text', { text: z.string().parse(partial.delta.text), messageId: `${wire.messageId}:${partial.index}`, delta: true })]
        if (['message_start', 'message_delta', 'message_stop', 'content_block_start', 'content_block_stop', 'content_block_delta'].includes(partial.type)) return []
        throw new Error('Unsupported Claude stream event')
      }
      case 'assistant': return z.array(object).parse(wire.message?.content).flatMap((block, index) => {
        if (block.type === 'text') return [event('text', { text: z.string().parse(block.text), ...(wire.message?.id ? { messageId: `${wire.message.id}:${index}` } : {}) })]
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
    case 'acp_session': events = [event('session', {})]; break
    case 'acp_permission_denied': events = [event('session', { status: 'permission-denied', message: `CLI 请求的额外访问未获授权：${wire.title}。请依据本轮引用继续，或补充所需材料。` })]; break
    case 'acp_update': {
      const update = record(wire.update)
      if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') events = [event('text', { text: z.string().parse(update.content.text), messageId: 'acp-message', delta: true })]
      else if (update.sessionUpdate === 'usage_update') events = [event('usage', update)]
      else if (['agent_thought_chunk', 'user_message_chunk', 'plan', 'available_commands_update', 'current_mode_update', 'config_option_update', 'session_info_update'].includes(update.sessionUpdate)) events = []
      else throw new Error(`Unsupported OpenCode update: ${String(update.sessionUpdate)}`)
      break
    }
    case 'acp_result': events = wire.stopReason === 'end_turn' ? [event('completed', {})] : [{ kind: 'failed', failure: 'interrupted', payload: { message: `CLI 本轮未完成：${String(wire.stopReason)}` } }]; break
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
