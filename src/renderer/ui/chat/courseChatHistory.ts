import type { GenerationRequest } from '../../../shared/generationContract'
import type { LocalAgentEvent, LocalAgentRecord } from '../../../shared/localAgentContract'

/** Resumed user turns own separate local records within the same native conversation. */
export function sameChatConversation(left: LocalAgentRecord, right: LocalAgentRecord): boolean {
  if (left.id === right.id) return true
  if (left.adapter !== right.adapter || !left.workingDirectoryId || left.workingDirectoryId !== right.workingDirectoryId) return false
  // Before open acknowledges the resumed native ID, the existing working-directory owner links the pending user input.
  return !left.externalSessionId || !right.externalSessionId || left.externalSessionId === right.externalSessionId
}
export function mergeChatEvents(previous: readonly LocalAgentEvent[], incoming: readonly LocalAgentEvent[]): LocalAgentEvent[] {
  const events = new Map(previous.map(event => [`${event.sessionId}:${event.sequence}`, event]))
  for (const event of incoming) events.set(`${event.sessionId}:${event.sequence}`, event)
  return [...events.values()].sort((a, b) => a.time - b.time || (a.sessionId === b.sessionId ? a.sequence - b.sequence : 0))
}
export function chatRecordTime(record: LocalAgentRecord): number {
  return record.generationRequest?.execution?.startedAt ?? record.events[0]?.time ?? 0
}
export function latestChatEditRequest(records: readonly LocalAgentRecord[], current: LocalAgentRecord | undefined): GenerationRequest | undefined {
  if (!current) return undefined
  return [...records].reverse().filter(record => sameChatConversation(record, current)
    && record.generationRequest && (record.generationRequest.intent ?? 'edit') === 'edit')
    .sort((a, b) => chatRecordTime(b) - chatRecordTime(a))[0]?.generationRequest
}
