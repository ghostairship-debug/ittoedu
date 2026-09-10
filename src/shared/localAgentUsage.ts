import { z } from 'zod'
import type { LocalAgentEvent } from './localAgentContract'

const count = z.number().int().nonnegative().nullable()
export const localAgentTokenBreakdownSchema = z.object({
  inputTokens: count, outputTokens: count, cachedInputTokens: count,
  reasoningOutputTokens: count, cacheWriteInputTokens: count, totalTokens: count,
}).strict()

/** Native snapshots, not increments to sum. Unknown is distinct from zero. */
export const localAgentTokenUsageSchema = z.object({
  version: z.literal(1), source: z.enum(['codex-app-server', 'claude', 'opencode']),
  last: localAgentTokenBreakdownSchema.nullable(), total: localAgentTokenBreakdownSchema.nullable(),
}).strict()
export type LocalAgentTokenUsage = z.infer<typeof localAgentTokenUsageSchema>

export function latestLocalAgentTokenUsage(events: readonly LocalAgentEvent[]): LocalAgentTokenUsage | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.kind !== 'usage' || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue
    const parsed = localAgentTokenUsageSchema.safeParse(event.payload.tokenUsage)
    if (parsed.success) return parsed.data
  }
  return null
}
