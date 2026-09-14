import { Fragment, type ReactNode } from 'react'
import { localAgentMessages } from '../../../shared/localAgentText'
import type { LocalAgentEvent } from '../../../shared/localAgentContract'
import { SafeChatMessage } from './SafeChatMessage'

type LegacyRequest = { sessionId: string; text: string; time: number }
/** A read-only view of the persisted event stream; no synthetic user turns. */
export function CourseChatTranscript({ events, legacyInstruction, legacyRequests = [] }: {
  events: readonly LocalAgentEvent[]; legacyInstruction?: string; legacyRequests?: readonly LegacyRequest[]
}) {
  const messages = localAgentMessages(events)
  const entries: { id: string; time: number; node: ReactNode }[] = messages.map(message => ({ id: message.id, time: message.time,
    node: message.role === 'user'
      ? <section className="chat-user-message" data-message-id={message.id} aria-label="用户消息"><small>{message.purpose === 'correct' ? '你 · 纠正' : message.purpose === 'supplement' ? '你 · 补充' : message.purpose === 'answer' ? '你 · 回答' : '你'}</small><SafeChatMessage text={message.text} /></section>
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
  return <div className="chat-transcript" aria-label="对话记录">{entries.map(entry => <Fragment key={entry.id}>{entry.node}</Fragment>)}</div>
}
