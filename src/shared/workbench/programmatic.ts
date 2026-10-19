import { z } from 'zod'
import type { ModelToolCall, ToolResult } from './tools'

export const programmaticExecuteInputSchema = z.object({ code: z.string().min(1) }).strict()
export const programmaticReadInputSchema = z.object({
  runId: z.string().min(1).optional(),
  callId: z.string().min(1),
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
}).strict()
export type ProgrammaticExecuteInput = z.infer<typeof programmaticExecuteInputSchema>
export type ProgrammaticReadInput = z.infer<typeof programmaticReadInputSchema>

/** These references address the existing Engine journal, not a second result store. */
export interface ProgrammaticResultReference { runId: string; callId: string }
export interface ProgrammaticChildReceipt {
  callId: string
  name: string
  status: 'completed' | 'failed' | 'cancelled' | 'unknown'
  read: ProgrammaticResultReference
}
export interface ProgrammaticFailure {
  callId: string
  name: string
  code: string
  message: string
}
export interface ProgrammaticReceipt {
  status: 'completed' | 'partial' | 'failed' | 'cancelled'
  /** Only an explicit script return is included. Child results remain in the journal. */
  value?: unknown
  atomic: false
  read: ProgrammaticResultReference
  children: ProgrammaticChildReceipt[]
  failures: ProgrammaticFailure[]
  error?: string
}
export interface ProgrammaticJournalEntry {
  callId: string
  call: ModelToolCall
  result?: ToolResult
}
