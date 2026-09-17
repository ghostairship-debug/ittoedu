import { z } from 'zod'
const position = z.object({ locationId: z.string().nullable(), stateId: z.string().nullable() }).strict()
export const generationExecutionEvidenceSchema = z.array(z.object({
  source: z.literal('published-player'), ruleId: z.string(), runId: z.number().int(), chainId: z.number().int(),
  parentRunId: z.number().int().optional(), status: z.enum(['checked', 'skipped', 'failed']),
  runStatus: z.enum(['running', 'completed', 'navigation-terminal', 'cancelled', 'failed', 'skipped']),
  start: position, end: position, reason: z.string().optional(),
}).strict())
export type GenerationExecutionEvidence = z.infer<typeof generationExecutionEvidenceSchema>
