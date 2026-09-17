import type { LocalAgentEvent } from './localAgentContract'
import { GENERATION_OPEN, GENERATION_CLOSE, GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE } from './generationResult'

type Phase = 'body' | 'public-summary' | 'plan' | 'progress' | 'final' | 'candidate'
export interface LocalAgentMessage {
  id: string
  sequence: number
  time: number
  role: 'user' | 'assistant'
  phase: Phase
  text: string
  purpose?: string
}

export function readableLocalAgentError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? '')
  if (!text) return ''
  if (/output-limit/i.test(text)) return '原生工具返回内容超过接收限额，本次未完成。已提交的修改会保留；详细限额记录已保存，可继续当前任务。'
  if (/stale|工程.*改变|目标.*失效/i.test(text)) return '课件或任务已变化，本次未应用的修改已丢弃。请核对当前内容，再发送要求或明确继续。'
  if (/unauthenticated|401|认证|未登录|token.*expired/i.test(text)) return '创作助手的登录已失效。请重新登录所选 CLI 后继续；本次未提交的修改没有应用。'
  if (/503|service.unavailable|no active.*accounts/i.test(text)) return '当前服务暂时不可用。请稍后重试或继续；已应用的修改会保留。'
  if (/rate.limit|429|额度|限流/i.test(text)) return '当前服务暂时限制了请求。请稍后继续；已应用的修改会保留。'
  if (/timeout|timed.out|超时|截止|期限|预算已到/i.test(text)) return '本次处理超时，尚未完成。已应用的修改会保留；可以核对结果后继续。'
  if (/decode|image|图片|资源|素材/i.test(text)) return '本次图片或素材处理未完成。请检查素材是否可读取，或继续让助手尝试其他方法。'
  if (/connect|ECONN|transport|连接|启动失败/i.test(text)) return '与创作助手的连接中断，尚未确认完成。请检查所选 CLI 后重试或继续。'
  if (/permission|denied|授权|拒绝授权/i.test(text)) return '所需操作未获授权，本次处理无法继续。请核对授权要求后重试。'
  if (/连续两轮没有进展/.test(text)) return '连续两轮没有进展，已停止本次处理。请补充要求或明确继续；已应用的修改会保留。'
  // Preserve actionable product validation messages, while keeping protocol IDs/stacks in the local log.
  if (/[\u4e00-\u9fff]/.test(text) && !/[{}]|\b(?:Error|requestId|revision|candidateId|ENOENT)\b|\bat .+\(/.test(text)) return text
  return '本次处理未完成，原因尚未确定。请重试或询问助手当前状态；详细记录已保存在本地。'
}

/** Recognize only our transport envelopes; teachers can still discuss JSON and code. */
function envelope(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  return (item.version === 1 && (item.kind === 'reply' || item.kind === 'edit' || typeof item.candidateId === 'string'))
    || (item.version === 2 && Array.isArray(item.steps) && typeof item.summary === 'string') ? item : null
}
function explanation(source: string): string {
  try {
    const item = JSON.parse(source) as Record<string, unknown>
    const candidate = item.candidate && typeof item.candidate === 'object' ? item.candidate as Record<string, unknown> : item
    return typeof candidate.summary === 'string' ? candidate.summary : item.kind === 'reply'
      ? typeof item.reply === 'string' ? item.reply : typeof item.text === 'string' ? item.text : '' : ''
  } catch { return '' }
}

/** The same public text boundary is used by chat and first-visible timing. */
export function visibleLocalAgentText(text: string): string {
  for (const [open, close] of [[GENERATION_OPEN, GENERATION_CLOSE], [GENERATION_RESULT_OPEN, GENERATION_RESULT_CLOSE]]) {
    let start = text.indexOf(open!)
    while (start >= 0) {
      const end = text.indexOf(close!, start + open!.length)
      const summary = end < 0 ? '' : explanation(text.slice(start + open!.length, end))
      text = text.slice(0, start) + summary + (end < 0 ? '' : text.slice(end + close!.length))
      start = text.indexOf(open!, start + summary.length)
    }
    // A streamed delimiter can end at any character; withhold that protocol prefix.
    for (let length = Math.min(text.length, open!.length - 1); length > 1; length--) {
      if (text.endsWith(open!.slice(0, length))) { text = text.slice(0, -length); break }
    }
  }
  const trimmed = text.trim()
  try { if (envelope(JSON.parse(trimmed))) return explanation(trimmed) } catch { /* Ordinary prose and plain JSON stay readable. */ }
  return trimmed
}

/** Identity, not equal text, decides duplication. Keep independent messages and their first position. */
export function localAgentMessages(events: readonly LocalAgentEvent[], options: { includeCandidates?: boolean; raw?: boolean } = {}): LocalAgentMessage[] {
  const messages = new Map<string, LocalAgentMessage>()
  const seen = new Set<string>()
  for (const event of events) {
    if (!['text', 'user-message'].includes(event.kind) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue
    const eventIdentity = `${event.sessionId}:${event.sequence}`
    if (seen.has(eventIdentity)) continue
    seen.add(eventIdentity)
    const { text, messageId, delta, phase, purpose } = event.payload
    if (typeof text !== 'string') continue
    const id = `${event.sessionId}:${typeof messageId === 'string' ? messageId : `event:${event.sequence}`}`
    const prior = messages.get(id)
    messages.set(id, { id, sequence: prior?.sequence ?? event.sequence, time: prior?.time ?? event.time, role: event.kind === 'user-message' ? 'user' : 'assistant',
      phase: typeof phase === 'string' && ['body', 'public-summary', 'plan', 'progress', 'final', 'candidate'].includes(phase) ? phase as Phase : prior?.phase ?? 'body',
      text: delta === true ? (prior?.text ?? '') + text : text,
      ...(typeof purpose === 'string' ? { purpose } : {}) })
  }
  return [...messages.values()].flatMap(message => {
    if (options.raw) return message.phase === 'candidate' && !options.includeCandidates ? [] : [message]
    if (message.role === 'user') return [message]
    const text = /^(?:API Error:|Error:|Error\s+\d{3})/.test(message.text.trim()) ? readableLocalAgentError(message.text) : message.phase === 'candidate' && !message.text.includes(GENERATION_OPEN)
      ? explanation(message.text) : visibleLocalAgentText(message.text)
    const candidate = message.phase === 'candidate' || message.text.includes(GENERATION_OPEN)
      || (() => { try { const item = envelope(JSON.parse(message.text)); return !!item && item.kind !== 'reply' } catch { return false } })()
    return text ? [{ ...message, text, phase: candidate ? 'candidate' as const : message.phase }] : []
  })
}

/** Raw assistant channel for the existing result parser. Display must use localAgentMessages. */
export function localAgentText(events: readonly LocalAgentEvent[], options: { includeCandidates?: boolean } = {}): string {
  return localAgentMessages(events, { ...options, raw: true }).filter(message => message.role === 'assistant').map(message => message.text).join('\n')
}
