import { z } from 'zod'
import { workspaceIdentityV1Schema, type ConversationAgentWorkspace } from './workspaceIdentity'

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
export const conversationOwnerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lesson'), lesson: lessonIdentitySchema }).strict(),
  z.object({ kind: z.literal('workspace'), workspaceRoot: workspaceIdentityV1Schema.shape.normalizedPath }).strict(),
  z.object({ kind: z.literal('project'), workspaceRoot: workspaceIdentityV1Schema.shape.normalizedPath,
    projectPath: workspaceIdentityV1Schema.shape.normalizedPath }).strict(),
])
export type ConversationOwner = z.infer<typeof conversationOwnerSchema>
/** 归一化会话归属：旧记录只有 lesson 字段，读取时按课例归属处理。 */
export function conversationOwnerOf(record: { owner?: ConversationOwner; lesson?: LessonIdentity }): ConversationOwner {
  return record.owner ?? { kind: 'lesson', lesson: lessonIdentitySchema.parse(record.lesson) }
}
export function conversationOwnerKey(owner: ConversationOwner): string {
  return owner.kind === 'lesson' ? `lesson:${owner.lesson.lessonId}:${owner.lesson.normalizedDirectory}`
    : owner.kind === 'workspace' ? `workspace:${owner.workspaceRoot}` : `project:${owner.workspaceRoot}:${owner.projectPath}`
}
export function conversationWorkingDirectory(owner: ConversationOwner): string {
  return owner.kind === 'lesson' ? owner.lesson.normalizedDirectory
    : owner.kind === 'workspace' ? owner.workspaceRoot : owner.projectPath
}
export function conversationOwnerMatchesAgentWorkspace(owner: ConversationOwner, workspace: ConversationAgentWorkspace): boolean {
  if (workspace.kind === 'lesson') {
    return owner.kind === 'lesson' && owner.lesson.lessonId === workspace.lessonId
      && owner.lesson.normalizedDirectory === workspace.normalizedDirectory
  }
  return owner.kind !== 'lesson' && conversationWorkingDirectory(owner) === workspace.normalizedDirectory
}
const locationId = z.string().trim().min(1).max(200)
export const frozenEditTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('directory'), directory: workspaceIdentityV1Schema.shape.normalizedPath }).strict(),
  z.object({ kind: z.literal('document'), path: workspaceIdentityV1Schema.shape.normalizedPath, version: z.string().min(1).max(200).optional() }).strict(),
  z.object({
    kind: z.literal('courseware'),
    projectId: z.string().min(1).max(200),
    path: workspaceIdentityV1Schema.shape.normalizedPath,
    revision: z.number().int().nonnegative(),
    epoch: z.number().int().nonnegative(),
    scope: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('page'), locationId }).strict(),
      z.object({ kind: z.literal('selection'), locationId, itemIds: z.array(locationId).min(1).max(1000) }).strict(),
      z.object({ kind: z.literal('course') }).strict(),
    ]),
  }).strict(),
])
export type FrozenEditTarget = z.infer<typeof frozenEditTargetSchema>
export function defaultFrozenEditTarget(owner: ConversationOwner): FrozenEditTarget {
  return { kind: 'directory', directory: conversationWorkingDirectory(owner) }
}
/** Per-send only. Never reuse a stored lastFrozenTarget as an invisible lock. */
export function resolveSendFrozenTarget(requested: FrozenEditTarget | undefined, owner: ConversationOwner): FrozenEditTarget {
  return requested ?? defaultFrozenEditTarget(owner)
}
export function assertFrozenTargetMatchesOwner(owner: ConversationOwner, target: FrozenEditTarget): void {
  if (target.kind === 'directory' && target.directory !== conversationWorkingDirectory(owner)) {
    throw new Error('冻结目标不属于当前会话目录')
  }
}
export const lessonConversationSchema = z.object({ schemaVersion: z.literal(1), conversationId: z.uuid(),
  owner: conversationOwnerSchema.optional(), lesson: lessonIdentitySchema.optional(),
  title: z.string().min(1).max(200), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  parentConversationId: z.uuid().optional(), projectTarget: workspaceIdentityV1Schema.optional(),
  lastFrozenTarget: frozenEditTargetSchema.optional(),
  sessionIds: z.array(z.uuid()).max(10000), epoch: z.number().int().nonnegative(),
}).strict().refine(value => new Set(value.sessionIds).size === value.sessionIds.length, '重复会话引用')
  .refine(value => value.owner !== undefined || value.lesson !== undefined, '会话缺少归属')
export type LessonConversation = z.infer<typeof lessonConversationSchema>
/** 项目：工作空间内用户指定或新建的真实文件夹（F01）。 */
export const lessonProjectSchema = z.object({ schemaVersion: z.literal(1), name: z.string().trim().min(1).max(200),
  normalizedPath: workspaceIdentityV1Schema.shape.normalizedPath, workspaceRoot: workspaceIdentityV1Schema.shape.normalizedPath,
  createdAt: z.number().int().nonnegative() }).strict()
export type LessonProject = z.infer<typeof lessonProjectSchema>
