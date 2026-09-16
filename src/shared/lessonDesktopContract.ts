import type { OpenProjectFileResult } from './ipcTypes'
import { z } from 'zod'
import { lessonIdentitySchema, lessonDocumentRoleSchema, lessonRelativePathSchema, type LessonWorkspace, type LessonConversation } from './lessonWorkspace'

const directory = z.string().min(1).max(32767)
export const lessonDesktopRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('choose-workspace'), create: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('recent-workspaces') }).strict(),
  z.object({ operation: z.literal('open-workspace'), directory }).strict(),
  z.object({ operation: z.literal('list-directory'), directory }).strict(),
  z.object({ operation: z.literal('open-project'), path: directory }).strict(),
  z.object({ operation: z.literal('create-lesson'), directory, name: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal('open-lesson'), directory: directory.optional(), asCopy: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('list-lessons'), directory }).strict(),
  z.object({ operation: z.literal('search-conversations'), lesson: lessonIdentitySchema, query: z.string().trim().min(1).max(500) }).strict(),
  z.object({ operation: z.literal('delete-all-application-records') }).strict(),
  z.object({ operation: z.literal('branch-conversation'), lesson: lessonIdentitySchema, conversationId: z.uuid() }).strict(),
  z.object({ operation: z.literal('list-conversations'), lesson: lessonIdentitySchema }).strict(),
  z.object({ operation: z.literal('delete-conversation'), lesson: lessonIdentitySchema, conversationId: z.uuid().optional() }).strict(),
  z.object({ operation: z.literal('register-document'), lesson: lessonIdentitySchema, role: lessonDocumentRoleSchema, relativePath: lessonRelativePathSchema }).strict(),
  z.object({ operation: z.literal('create-conversation'), lesson: lessonIdentitySchema, title: z.string().min(1).max(200).optional() }).strict(),
  z.object({ operation: z.literal('bind-project'), lesson: lessonIdentitySchema, conversationId: z.uuid(), projectId: z.string().min(1), projectPath: directory, saveAs: z.boolean() }).strict(),
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
  conversation?: LessonConversation
  conversations?: LessonConversation[]
  matches?: { conversationId: string; excerpt: string }[]
  damaged?: string[]
}
