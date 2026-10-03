import type { DiscoveredReasoningEffort } from './executionSettingsDesktop'
import { z } from 'zod'

export type ModelReasoningFormat = 'deepseek-thinking' | 'thinking-effort' | 'reasoning-effort' | 'reasoning-object'
  | 'anthropic-effort' | 'anthropic-budget' | 'thinking-toggle' | 'enable-thinking' | 'unknown'
export interface ModelKnowledgeEntry {
  id: string
  provider?: string
  name?: string
  contextWindow?: number
  outputLimit?: number
  inputModalities?: string[]
  outputModalities?: string[]
  reasoning?: {
    kind: 'effort' | 'toggle' | 'budget' | 'fixed'
    efforts?: DiscoveredReasoningEffort[]
    format?: ModelReasoningFormat
  }
}

/** A provider-qualified reference wins over another provider's request ID with the same spelling. */
export function findModelKnowledgeReference(entries: readonly ModelKnowledgeEntry[], reference?: string): ModelKnowledgeEntry | undefined {
  if (!reference) return undefined
  const key = reference.toLowerCase()
  return entries.find(entry => `${entry.provider}/${entry.id}`.toLowerCase() === key)
    ?? entries.find(entry => entry.id.toLowerCase() === key)
}

export const modelKnowledgeEntrySchema = z.object({
  id: z.string().min(1), provider: z.string().optional(), name: z.string().optional(),
  contextWindow: z.number().int().positive().optional(), outputLimit: z.number().int().positive().optional(),
  inputModalities: z.array(z.string()).optional(), outputModalities: z.array(z.string()).optional(),
  reasoning: z.object({ kind: z.enum(['effort', 'toggle', 'budget', 'fixed']),
    efforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])).optional(),
    format: z.enum(['deepseek-thinking', 'thinking-effort', 'reasoning-effort', 'reasoning-object',
      'anthropic-effort', 'anthropic-budget', 'thinking-toggle', 'enable-thinking', 'unknown']).optional(),
  }).strict().optional(),
}).strict()
