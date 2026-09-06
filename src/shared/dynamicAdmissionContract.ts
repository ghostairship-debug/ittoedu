import { z } from 'zod'
import { courseProjectDocumentSchema } from './courseProjectSchema'
import { authoringToolReceiptV1Schema } from './authoringToolContract'

const encodedFiles = z.record(z.string().min(1).max(500), z.string().max(24_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))
export const dynamicAdmissionPayloadSchema = z.object({
  project: courseProjectDocumentSchema,
  assetFiles: encodedFiles,
  componentFiles: z.record(z.string().min(1), encodedFiles),
  targets: z.array(z.object({ locationId: z.string().min(1), stateId: z.string().nullable().optional(), instanceIds: z.array(z.string().min(1)).min(1).max(1000) }).strict()).min(1).max(1000),
}).strict()
export type DynamicAdmissionPayload = z.infer<typeof dynamicAdmissionPayloadSchema>
export const dynamicAdmissionRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('run'), id: z.uuid(), payload: dynamicAdmissionPayloadSchema }).strict(),
  z.object({ operation: z.literal('cancel'), id: z.uuid() }).strict(),
])
export type DynamicAdmissionRequest = z.infer<typeof dynamicAdmissionRequestSchema>
export const dynamicAdmissionResultSchema = z.object({ ok: z.boolean(), message: z.string().max(4000), processId: z.number().int().nonnegative().optional(), diagnostics: authoringToolReceiptV1Schema.shape.diagnostics.optional() }).strict()
export type DynamicAdmissionResult = z.infer<typeof dynamicAdmissionResultSchema>
