import { z } from 'zod'
import { aiWorkspaceIdentitySchema } from './workspaceIdentity'

/** Bump only when the user-facing external processing explanation changes materially. */
export const EXTERNAL_AI_NOTICE_VERSION = 1 as const

export const externalAiNoticeConfirmationSchema = z.object({
  schemaVersion: z.literal(1),
  noticeVersion: z.literal(EXTERNAL_AI_NOTICE_VERSION),
  scope: aiWorkspaceIdentitySchema,
  confirmedAt: z.number().int().nonnegative(),
}).strict()
export type ExternalAiNoticeConfirmation = z.infer<typeof externalAiNoticeConfirmationSchema>

export const externalAiNoticeStatusSchema = z.discriminatedUnion('confirmed', [
  z.object({ version: z.literal(EXTERNAL_AI_NOTICE_VERSION), confirmed: z.literal(false) }).strict(),
  z.object({
    version: z.literal(EXTERNAL_AI_NOTICE_VERSION),
    confirmed: z.literal(true),
    confirmedAt: z.number().int().nonnegative(),
  }).strict(),
])
export type ExternalAiNoticeStatus = z.infer<typeof externalAiNoticeStatusSchema>
