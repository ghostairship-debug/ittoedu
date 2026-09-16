import { z } from 'zod'
import { workspaceIdentityV1Schema } from './workspaceIdentity'

export const lessonRelativePathSchema = z.string().min(1).max(32767).refine(value =>
  !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && !/^[a-z]:/i.test(value)
  && value.split('/').every(part => part !== '' && part !== '.' && part !== '..'), '需要课例内相对路径')
export const lessonDocumentRoleSchema = z.enum(['teaching-brief', 'teaching-plan', 'presentation-brief', 'presentation-script'])
export const lessonIdentitySchema = z.object({ schemaVersion: z.literal(1), lessonId: z.uuid(),
  normalizedDirectory: workspaceIdentityV1Schema.shape.normalizedPath }).strict()
export const lessonManifestSchema = z.object({ schemaVersion: z.literal(1), lessonId: z.uuid(), title: z.string().trim().min(1).max(200),
  documents: z.partialRecord(lessonDocumentRoleSchema, lessonRelativePathSchema), coursePath: lessonRelativePathSchema.optional() }).strict()
export type LessonIdentity = z.infer<typeof lessonIdentitySchema>
export type LessonManifest = z.infer<typeof lessonManifestSchema>
export interface LessonWorkspace { identity: LessonIdentity; manifest: LessonManifest }
export function lessonIdentityKey(input: LessonIdentity): string {
  const value = lessonIdentitySchema.parse(input)
  return JSON.stringify([value.schemaVersion, value.lessonId, value.normalizedDirectory])
}
/** Conversation owns references only; task events, receipts and CLI handles stay in the harness. */
export const lessonConversationSchema = z.object({ schemaVersion: z.literal(1), conversationId: z.uuid(), lesson: lessonIdentitySchema,
  title: z.string().min(1).max(200), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  parentConversationId: z.uuid().optional(), projectTarget: workspaceIdentityV1Schema.optional(), sessionIds: z.array(z.uuid()).max(10000), epoch: z.number().int().nonnegative(),
}).strict().refine(value => new Set(value.sessionIds).size === value.sessionIds.length, '重复会话引用')
export type LessonConversation = z.infer<typeof lessonConversationSchema>
