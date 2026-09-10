import type { LocalAgentEvent } from './localAgentContract'

/** Reconcile CLI deltas and final snapshots without duplicating text or inserting token breaks. */
export function localAgentText(events: readonly LocalAgentEvent[], options: { includeCandidates?: boolean } = {}): string {
  const messages = new Map<string, string>()
  for (const event of events) {
    if (event.kind !== 'text' || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue
    if (event.payload.phase === 'candidate' && !options.includeCandidates) continue
    const { text, messageId, delta } = event.payload
    if (typeof text !== 'string') continue
    const id = typeof messageId === 'string' ? messageId : `event:${event.sequence}`
    messages.set(id, delta === true ? (messages.get(id) ?? '') + text : text)
  }
  return [...messages.values()].join('\n')
}
