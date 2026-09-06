import { z } from 'zod'
import { workspaceIdentityV1Schema } from './workspaceIdentity'

export const localAgentIdSchema = z.enum(['codex', 'claude', 'opencode'])
export type LocalAgentId = z.infer<typeof localAgentIdSchema>
export const localAgentFailureSchema = z.enum(['missing', 'unauthenticated', 'rate-limited', 'unsupported-version', 'launch', 'protocol', 'output-limit', 'crash', 'storage', 'interrupted'])
export const localAgentEventSchema = z.object({
  version: z.literal(1), adapter: localAgentIdSchema, sessionId: z.uuid(),
  externalSessionId: z.string().min(1).max(200).optional(),
  sequence: z.number().int().positive(), time: z.number().int().nonnegative(),
  kind: z.enum(['session', 'text', 'tool-call', 'tool-result', 'usage', 'completed', 'failed', 'cancelled']),
  payload: z.json(), failure: localAgentFailureSchema.optional(),
}).strict().superRefine((event, ctx) => {
  if ((event.kind === 'failed') !== (event.failure !== undefined)) ctx.addIssue({ code: 'custom', message: 'failed requires a failure category' })
})
export type LocalAgentEvent = z.infer<typeof localAgentEventSchema>
export const localAgentRecordSchema = z.object({
  version: z.literal(1), id: z.uuid(), adapter: localAgentIdSchema, workspace: workspaceIdentityV1Schema,
  workingDirectoryId: z.uuid().optional(),
  externalSessionId: z.string().min(1).max(200).optional(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  events: z.array(localAgentEventSchema).max(20000),
}).strict()
export type LocalAgentRecord = z.infer<typeof localAgentRecordSchema>
export const localAgentProbeSchema = z.object({
  adapter: localAgentIdSchema, status: z.enum(['ready', 'missing', 'unauthenticated', 'unsupported-version', 'launch', 'unknown-auth']),
  version: z.string().max(100).optional(), message: z.string().max(1000),
}).strict()
export type LocalAgentProbe = z.infer<typeof localAgentProbeSchema>
const owner = { projectId: z.string().min(1).max(200), projectPath: z.string().min(1).max(32767) }
export const localAgentRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('probe'), adapter: localAgentIdSchema }).strict(),
  z.object({ operation: z.literal('start'), ...owner, adapter: localAgentIdSchema, prompt: z.string().min(1).max(100000) }).strict(),
  z.object({ operation: z.literal('resume'), ...owner, sessionId: z.uuid(), prompt: z.string().min(1).max(100000) }).strict(),
  z.object({ operation: z.literal('cancel'), ...owner, sessionId: z.uuid() }).strict(),
  z.object({ operation: z.literal('list'), ...owner }).strict(),
  z.object({ operation: z.literal('read'), ...owner, sessionId: z.uuid(), after: z.number().int().nonnegative().default(0) }).strict(),
  z.object({ operation: z.literal('delete'), ...owner, sessionId: z.uuid().optional() }).strict(),
])
export type LocalAgentRequest = z.infer<typeof localAgentRequestSchema>
export const localAgentResponseSchema = z.object({
  enabled: z.boolean(), probe: localAgentProbeSchema.optional(), sessionId: z.uuid().optional(),
  records: z.array(localAgentRecordSchema).optional(), damaged: z.array(z.string()).optional(),
}).strict()
export type LocalAgentResponse = z.infer<typeof localAgentResponseSchema>
export interface LocalAgentCliAdapterV1 {
  readonly id: LocalAgentId
  probe(): Promise<LocalAgentProbe>
  start(prompt: string, cwd: string): AsyncIterable<unknown>
  resume(externalSessionId: string, prompt: string, cwd: string): AsyncIterable<unknown>
  cancel(): Promise<void>
}
