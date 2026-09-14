import { z } from 'zod'
import { courseProjectDocumentSchema } from './courseProjectSchema'
import { authoringToolReceiptV1Schema } from './authoringToolContract'
import { dynamicBehaviorEvidenceSchema, dynamicButtonCheckSchema } from './dynamicBehaviorObservation'

const encodedFiles = z.record(z.string().min(1).max(500), z.string().max(24_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))
export const dynamicAdmissionPayloadSchema = z.object({
  project: courseProjectDocumentSchema,
  assetFiles: z.record(z.string().min(1).max(500), z.union([encodedFiles.valueType, z.instanceof(Uint8Array)])),
  /** Main-owned read-only resources, scoped to one isolated admission session. */
  assetResources: z.record(z.string(), z.object({ url: z.string().min(1), byteLength: z.number().int().nonnegative() }).strict()).optional(),
  componentFiles: z.record(z.string().min(1), encodedFiles),
  captureInstances: z.boolean().optional(),
  verificationMode: z.enum(['full-admission', 'public-props']).optional(),
  observeBehavior: z.boolean().optional(),
  buttonCheck: dynamicButtonCheckSchema.optional(),
  targets: z.array(z.object({ locationId: z.string().min(1), stateId: z.string().nullable().optional(), instanceIds: z.array(z.string().min(1)).min(1).max(1000) }).strict()).min(1).max(1000),
}).strict().superRefine((payload, context) => {
  if (payload.buttonCheck && (!payload.observeBehavior || payload.verificationMode === 'public-props'
    || payload.targets.filter(target => target.instanceIds.includes(payload.buttonCheck!.instanceId)).length !== 1)) {
    context.addIssue({ code: 'custom', path: ['buttonCheck'], message: '按钮检查必须绑定唯一候选目标、完整准入并启用真实行为观察' })
  }
})
export type DynamicAdmissionPayload = z.infer<typeof dynamicAdmissionPayloadSchema>
export const dynamicAdmissionRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('run'), id: z.uuid(), payload: dynamicAdmissionPayloadSchema }).strict(),
  z.object({ operation: z.literal('cancel'), id: z.uuid() }).strict(),
])
export type DynamicAdmissionRequest = z.infer<typeof dynamicAdmissionRequestSchema>
export const dynamicInstanceCaptureSchema = z.object({
  instanceId: z.string().min(1), locationId: z.string().min(1),
  width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096),
  dataUrl: z.string().max(24_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/),
}).strict()
export type DynamicInstanceCapture = z.infer<typeof dynamicInstanceCaptureSchema>
export const dynamicAdmissionResultSchema = z.object({ ok: z.boolean(), message: z.string().max(4000), processId: z.number().int().nonnegative().optional(), diagnostics: authoringToolReceiptV1Schema.shape.diagnostics.optional(), captures: z.array(dynamicInstanceCaptureSchema).max(1000).optional(), behaviorEvidence: dynamicBehaviorEvidenceSchema.optional() }).strict()
export type DynamicAdmissionResult = z.infer<typeof dynamicAdmissionResultSchema>
