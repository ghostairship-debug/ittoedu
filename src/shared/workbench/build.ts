import { z } from 'zod'
import type { DocumentCommand, DocumentModel } from './document'
import type { DynamicAdmissionPayload, DynamicAdmissionResult } from '../dynamicAdmissionContract'
import { dynamicButtonCheckSchema } from '../dynamicBehaviorObservation'

const id = z.string().min(1).max(512), integer = z.number().int().nonnegative(), digest = z.string().regex(/^[a-f0-9]{64}$/)
export const buildTargetSchema = z.object({ documentId: id, projectId: id, epoch: id, baseRevision: integer, modelDigest: digest }).strict()
export type BuildTarget = z.infer<typeof buildTargetSchema>
export const buildReadSetEntrySchema = z.object({ documentId: id, epoch: id, revision: integer, digest }).strict()
export type BuildReadSetEntry = z.infer<typeof buildReadSetEntrySchema>
/** Host-generated call identity. Never part of the model build.create arguments. */
export const buildCreateTicketSchema = z.object({ operationId: id, requestDigest: digest }).strict()
export type BuildCreateTicket = z.infer<typeof buildCreateTicketSchema>
export type BuildCreateLookup = { status: 'created'; job: BuildJobSnapshot }
  | { status: 'unknown'; jobId: string; runId: string; target: BuildTarget }
/** maxDurationMs limits one build.check admission; idle model and image time is excluded. */
export interface BuildBudget { maxBytes: number; maxFiles: number; maxWrites: number; maxChecks: number; maxSameSourceChecks: number; maxDurationMs: number }
export interface BuildJobInput {
  runId: string
  target: BuildTarget
  readSet: readonly BuildReadSetEntry[]
  baseline: Extract<DocumentModel, { kind: 'course-v9' }>
  allowedOrigins: readonly string[]
  budget?: Partial<BuildBudget>
}
export interface BuildLogEntry { cursor: number; time: number; stage: 'scratch' | 'syntax' | 'closure' | 'admission' | 'cancel'; level: 'info' | 'error'; message: string; truncated?: boolean }
export interface BuildJobSnapshot {
  jobId: string; runId: string; target: BuildTarget; readSet: readonly BuildReadSetEntry[]
  sourceRevision: number; status: 'editing' | 'checking' | 'ready' | 'failed' | 'cancelled' | 'exhausted'
  /** Current or most recent check deadline; it is not the scratch job's expiry. */
  createdAt: number; deadline: number; writes: number; checks: number; artifactId?: string
}
/** Main-only resource closure; handing this out is not a document commit. */
export interface BuildImportArtifact {
  artifactId: string; jobId: string; runId: string; sourceRevision: number
  target: BuildTarget; readSet: readonly BuildReadSetEntry[]
  command: Extract<DocumentCommand, { type: 'course.replace' }>
  admission: DynamicAdmissionResult
  semanticVerdict: 'requires-review'
}
export interface BuildAdmissionPort { run(payload: DynamicAdmissionPayload, signal: AbortSignal): Promise<DynamicAdmissionResult> }
export const buildToolCallSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('list'), jobId: z.uuid() }).strict(),
  z.object({ type: z.literal('read'), jobId: z.uuid(), path: z.string().min(1).max(1024), offset: integer.default(0), limit: z.number().int().min(1).max(65536).default(16384), encoding: z.enum(['utf8', 'base64']).default('utf8') }).strict(),
  z.object({ type: z.literal('write'), jobId: z.uuid(), path: z.string().min(1).max(1024), content: z.string().max(24 * 1024 * 1024), encoding: z.enum(['utf8', 'base64']).default('utf8') }).strict(),
  z.object({ type: z.literal('syntax'), jobId: z.uuid(), path: z.string().min(1).max(1024), kind: z.enum(['component', 'runtime']) }).strict(),
  z.object({ type: z.literal('check'), jobId: z.uuid(), buttonCheck: dynamicButtonCheckSchema.optional() }).strict(),
  z.object({ type: z.literal('logs'), jobId: z.uuid(), after: integer.default(0), limit: z.number().int().min(1).max(5000).default(100) }).strict(),
  z.object({ type: z.literal('cancel'), jobId: z.uuid() }).strict(),
])
export type BuildToolCall = z.input<typeof buildToolCallSchema>
