import { z } from 'zod'

export const localAgentRecordUsageSchema = z.object({
  version: z.literal(1),
  currentScopeBytes: z.number().int().nonnegative(),
  applicationBytes: z.number().int().nonnegative(),
  measuredAt: z.number().int().nonnegative(),
}).strict()

export type LocalAgentRecordUsage = z.infer<typeof localAgentRecordUsageSchema>
