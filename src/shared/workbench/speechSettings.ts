import { z } from 'zod'
import type { ModelConnectionSnapshot } from './modelProvider'

/** Explicit speech settings; a conversation or image role does not enable this route. */
export const speechGenerationSelectionSchema = z.object({
  connectionId: z.string().trim().min(1).max(512),
  model: z.string().trim().min(1).max(512),
  voice: z.string().trim().min(1).max(200),
  format: z.enum(['mp3', 'wav']),
  /** Explicitly declared by the configured compatible API; absent means unsupported. */
  supportsInstructions: z.boolean().optional(),
  supportsSpeed: z.boolean().optional(),
}).strict()
export type SpeechGenerationSelection = z.infer<typeof speechGenerationSelectionSchema>
/** Host-owned snapshot stored with the accepted task; contains no credential bytes. */
export interface SpeechSelectionSnapshot {
  selection?: SpeechGenerationSelection
  connection?: ModelConnectionSnapshot
  unavailableReason?: string
}
