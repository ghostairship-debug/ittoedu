import { z } from 'zod'
import { workspaceIdentityV1Schema } from './workspaceIdentity'

const identity = z.string().trim().min(1).max(200)
export const aiTaskIdentityFields = { taskId: z.uuid(), epoch: z.number().int().nonnegative(), workspace: workspaceIdentityV1Schema }
const taskIdentity = aiTaskIdentityFields

export const aiQuestionSchema = z.object({
  ...taskIdentity, questionId: identity, turnId: identity,
  purpose: z.enum(['clarification', 'permission']).optional(),
  questions: z.array(z.object({ id: identity, title: z.string().min(1).max(1000), options: z.array(z.string().min(1).max(1000)).max(20), multiple: z.boolean() }).strict()).min(1).max(20),
}).strict()
const input = { version: z.literal(1), ...taskIdentity, inputId: z.uuid(), turnId: identity.nullable() }
export const aiUserInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...input, kind: z.literal('supplement'), text: z.string().trim().min(1).max(20000) }).strict(),
  z.object({ ...input, kind: z.literal('correct'), text: z.string().trim().min(1).max(20000) }).strict(),
  z.object({ ...input, kind: z.literal('answer'), questionId: identity, answers: z.array(z.object({ id: identity, values: z.array(z.string().max(4000)).min(1).max(20) }).strict()).min(1).max(20) }).strict(),
  z.object({ ...input, kind: z.literal('stop') }).strict(),
])
export type AiUserInput = z.infer<typeof aiUserInputSchema>
export const aiInputDeliverySchema = z.object({
  ...taskIdentity, inputId: z.uuid(), status: z.enum(['accepted', 'queued', 'consumed', 'rejected']),
  turnId: identity.nullable(), reason: z.string().max(1000).nullable(), questionId: identity.nullable().optional(),
}).strict()

