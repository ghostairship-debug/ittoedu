import { Fragment, type ReactNode } from 'react'
import { localAgentMessages } from '../../../shared/localAgentText'
import type { LocalAgentEvent } from '../../../shared/localAgentContract'
import { aiInputDeliverySchema } from '../../../shared/localAgentInteraction'
import { SafeChatMessage } from './SafeChatMessage'

type LegacyRequest = { sessionId: string; text: string; time: number }

/** 原生回合的收尾事件：正文到此定稿（localAgentProjection.ts:52-58 把 turn-ended 投成这三种）。 */
const TURN_ENDED_KINDS: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled'])

/**
 * Whether an event ends the turn that owns the text stream it belongs to.
 *
 * A turn that is not the record's last native event is projected as a plain `session` event
 * carrying `status: 'turn-ended'` instead (localAgentProjection.ts:94-101 keeps old turns as
 * history without terminating the current display run). Those still end their own turn, so
 * they must settle it here too: otherwise the backward scan walks straight past the end of a
 * finished turn, finds an older delta and reports that message as still appending, leaving
 * aria-busy stuck on until some later turn happens to end.
 */
function isTurnEnded(event: LocalAgentEvent): boolean {
  if (TURN_ENDED_KINDS.has(event.kind)) return true
  if (event.kind !== 'session') return false
  const payload = event.payload
  return !!payload && typeof payload === 'object' && !Array.isArray(payload) && payload.status === 'turn-ended'
}

/**
 * Identity of the assistant message that is still receiving appended text, or null once every
 * stream has settled.
 *
 * 不能只看最后一个事件：正文流式期间 tool-call／tool-result／usage／input-delivery 会与文本
 * 分片交错，最后一个事件往往不是 text，只看它会让 aria-busy 中途回落到 false，后续分片就在
 * 「非 busy」状态下进入区域，既不延后播报也不再受 busy 保护。因此这里从末尾向前找每个会话
 * 最近一次正文事件：遇到分片说明该会话仍在追加；遇到整条替换快照或收尾事件说明该会话已定稿，
 * 记下后继续找其他会话。非正文事件不改变任何会话的追加状态。
 */
function appendingMessageId(events: readonly LocalAgentEvent[]): string | null {
  const settled = new Set<string>()
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (isTurnEnded(event)) {
      settled.add(event.sessionId)
      continue
    }
    if (event.kind !== 'text' || settled.has(event.sessionId)) continue
    const payload = event.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    if (payload.delta !== true) {
      settled.add(event.sessionId)
      continue
    }
    return typeof payload.messageId === 'string' ? `${event.sessionId}:${payload.messageId}` : null
  }
  return null
}

/**
 * A read-only view of the persisted event stream; no synthetic user turns.
 *
 * Announcement policy of the transcript live region (role="log"):
 * - Only newly added message nodes are announced (`aria-relevant="additions"`,
 *   `aria-atomic="false"`): text that grows inside an existing message is an in-place mutation,
 *   so a settled message is never read out again.
 * - While an assistant message is still receiving appended chunks the region is `aria-busy`,
 *   which defers announcements until that message settles. Neither per-token nor unbounded
 *   per-chunk announcements can happen. Interleaved tool/usage/session events do not clear it:
 *   only that message's own replace snapshot or a turn-ended event does.
 * - The region is not focusable and never calls focus(), so an arriving message cannot steal
 *   focus from the composer.
 */
export function CourseChatTranscript({ events, legacyInstruction, legacyRequests = [] }: {
  events: readonly LocalAgentEvent[]; legacyInstruction?: string; legacyRequests?: readonly LegacyRequest[]
}) {
  const messages = localAgentMessages(events)
  const inputMessageIds = new Map(messages.filter(message => message.role === 'user').map(message => [
    `${message.id.split(':')[0]}:${message.id.slice(message.id.lastIndexOf(':') + 1)}`, message.id,
  ]))
  const deliveries = new Map<string, { sequence: number; text: string }>()
  for (const event of events) {
    const payload = event.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.status !== 'input-delivery') continue
    const parsed = aiInputDeliverySchema.safeParse(payload.delivery)
    if (!parsed.success) continue
    const key = inputMessageIds.get(`${event.sessionId}:${parsed.data.inputId}`)
    if (!key) continue
    if ((deliveries.get(key)?.sequence ?? -1) >= event.sequence) continue
    const delivery = parsed.data
    const text = delivery.status === 'consumed' ? '已送达后续回合' : delivery.status === 'accepted' ? '已送达当前回合'
      : delivery.status === 'queued' ? delivery.reason ?? '已接收，等待下一回合处理' : delivery.reason ?? '未送达，请重新发送'
    deliveries.set(key, { sequence: event.sequence, text })
  }
  const entries: { id: string; time: number; node: ReactNode }[] = messages.map(message => ({ id: message.id, time: message.time,
    node: message.role === 'user'
      ? <section className="chat-user-message" data-message-id={message.id} aria-label="用户消息"><small>{message.purpose === 'correct' ? '你 · 纠正' : message.purpose === 'supplement' ? '你 · 补充' : message.purpose === 'answer' ? '你 · 回答' : '你'}</small><SafeChatMessage text={message.text} />{deliveries.has(message.id) && <small className="chat-input-delivery">{deliveries.get(message.id)!.text}</small>}</section>
      : ['progress', 'public-summary', 'plan'].includes(message.phase)
        ? <details className="chat-progress" data-message-id={message.id} open><summary>{message.phase === 'public-summary' ? '公开思考摘要' : '执行说明'}</summary><SafeChatMessage text={message.text} /></details>
        : <section className="chat-reply" data-message-id={message.id} aria-label={message.phase === 'candidate' ? '待应用说明' : message.phase === 'final' ? '回复摘要' : '助手消息'}><small>{message.phase === 'candidate' ? '待应用说明 · 以实际应用结果为准' : message.phase === 'final' ? '回复摘要' : '助手'}</small><SafeChatMessage text={message.text} /></section>,
  }))
  const legacy = legacyRequests.length ? legacyRequests : legacyInstruction && !messages.some(message => message.role === 'user')
    ? [{ sessionId: 'legacy', text: legacyInstruction, time: 0 }] : []
  for (const request of legacy) if (!messages.some(message => message.role === 'user' && message.id.startsWith(`${request.sessionId}:`))) {
    entries.push({ id: `legacy:${request.sessionId}`, time: request.time - 1, node: <section className="chat-user-message" aria-label="历史任务要求"><small>历史任务要求</small><SafeChatMessage text={request.text} /></section> })
  }
  entries.sort((a, b) => a.time - b.time)
  const appending = appendingMessageId(events)
  const streaming = appending !== null && entries.some(entry => entry.id === appending)
  return <div className="chat-transcript" role="log" aria-label="对话记录" aria-live="polite" aria-relevant="additions"
    aria-atomic="false" aria-busy={streaming}>{entries.map(entry => <Fragment key={entry.id}>{entry.node}</Fragment>)}</div>
}
