import type { OpenProjectFileResult } from './ipcTypes'
import { z } from 'zod'
import { conversationOwnerSchema, lessonIdentitySchema, lessonDocumentRoleSchema, lessonRelativePathSchema, type LessonWorkspace, type LessonConversation, type LessonProject } from './lessonWorkspace'

const directory = z.string().min(1).max(32767)
/** F01：会话归属；缺省时按 lesson 字段（旧合同）处理。 */
const ownerRef = { owner: conversationOwnerSchema.optional(), lesson: lessonIdentitySchema.optional() }
export const lessonDesktopRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('choose-workspace'), create: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('choose-project-directory'), directory }).strict(),
  z.object({ operation: z.literal('create-file'), directory, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ operation: z.literal('recent-workspaces') }).strict(),
  z.object({ operation: z.literal('open-workspace'), directory }).strict(),
  z.object({ operation: z.literal('list-directory'), directory }).strict(),
  z.object({ operation: z.literal('open-project'), path: directory }).strict(),
  z.object({ operation: z.literal('open-external'), path: directory }).strict(),
  z.object({ operation: z.literal('create-lesson'), directory, name: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal('open-lesson'), directory: directory.optional(), asCopy: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('list-lessons'), directory }).strict(),
  z.object({ operation: z.literal('list-projects'), directory }).strict(),
  z.object({ operation: z.literal('create-project'), directory, name: z.string().trim().min(1).max(200), path: directory.optional() }).strict(),
  z.object({ operation: z.literal('remove-project'), directory, path: directory }).strict(),
  z.object({ operation: z.literal('search-conversations'), ...ownerRef, query: z.string().trim().min(1).max(500) }).strict()
    .refine(value => value.owner || value.lesson, '缺少会话归属'),
  z.object({ operation: z.literal('delete-all-application-records') }).strict(),
  z.object({ operation: z.literal('branch-conversation'), ...ownerRef, conversationId: z.uuid() }).strict()
    .refine(value => value.owner || value.lesson, '缺少会话归属'),
  z.object({ operation: z.literal('list-conversations'), ...ownerRef }).strict()
    .refine(value => value.owner || value.lesson, '缺少会话归属'),
  z.object({ operation: z.literal('delete-conversation'), ...ownerRef, conversationId: z.uuid().optional() }).strict()
    .refine(value => value.owner || value.lesson, '缺少会话归属'),
  z.object({ operation: z.literal('register-document'), lesson: lessonIdentitySchema, role: lessonDocumentRoleSchema, relativePath: lessonRelativePathSchema }).strict(),
  z.object({ operation: z.literal('create-conversation'), ...ownerRef, title: z.string().min(1).max(200).optional() }).strict()
    .refine(value => value.owner || value.lesson, '缺少会话归属'),
  z.object({ operation: z.literal('bind-project'), owner: conversationOwnerSchema.optional(), lesson: lessonIdentitySchema.optional(), conversationId: z.uuid(), projectId: z.string().min(1), projectPath: directory, saveAs: z.boolean() }).strict()
    .refine(value => value.owner || value.lesson, '缺少会话归属'),
])
export type LessonDesktopRequest = z.infer<typeof lessonDesktopRequestSchema>
export interface LessonDirectoryEntry { name: string; path: string; kind: 'directory' | 'file' }
export interface LessonDesktopResult {
  projectFile?: OpenProjectFileResult
  cancelled?: boolean
  directory?: string
  recent?: string[]
  entries?: LessonDirectoryEntry[]
  lesson?: LessonWorkspace
  lessons?: LessonWorkspace[]
  project?: LessonProject
  projects?: LessonProject[]
  conversation?: LessonConversation
  conversations?: LessonConversation[]
  matches?: { conversationId: string; excerpt: string }[]
  damaged?: string[]
  opened?: boolean
  openError?: string
}
