import { z } from 'zod'
import { conversationAgentWorkspaceSchema } from './workspaceIdentity'
import { lessonRelativePathSchema } from './lessonWorkspace'
import { localAgentIdSchema } from './localAgentContract'
import type { DocumentEditRange, DocumentFileVersion } from './document/ports'
const ref = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lesson'), lessonId: z.uuid(), lessonDirectory: z.string().min(1), relativePath: lessonRelativePathSchema }).strict(),
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(32767) }).strict(),
])
const version = z.object({ contentVersion: z.string().min(1), attachments: z.array(z.object({ relativePath: lessonRelativePathSchema, contentVersion: z.string().min(1) }).strict()) }).strict()
export const documentAiRangeSchema = z.object({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), before: z.string(), after: z.string() }).strict().refine(range => range.to >= range.from)
export const documentAiCandidateSchema = z.object({ edits: z.array(documentAiRangeSchema).min(1).max(1000) }).strict()
/** Full source is only a transport candidate; main derives the same canonical edit ranges. */
export const documentAiReplacementCandidateSchema = z.object({ replacementFile: z.literal('replacement.md') }).strict()
export const lessonDocumentAiRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('start'), workspace: conversationAgentWorkspaceSchema, ref, baseVersion: version, ranges: z.array(documentAiRangeSchema).min(1), epoch: z.number().int().nonnegative(), adapter: localAgentIdSchema, instruction: z.string().min(1).max(20000) }).strict(),
  z.object({ operation: z.literal('read'), workspace: conversationAgentWorkspaceSchema, taskId: z.uuid() }).strict(),
  z.object({ operation: z.literal('stop'), workspace: conversationAgentWorkspaceSchema, taskId: z.uuid() }).strict(),
])
export type LessonDocumentAiRequest = z.infer<typeof lessonDocumentAiRequestSchema>
export interface LessonDocumentAiResult {
  taskId: string; sessionId: string; status: 'running' | 'candidate' | 'stopped' | 'failed'; message: string
  apply?: { baseVersion: DocumentFileVersion; epoch: number; operationId: string; edits: DocumentEditRange[] }
}
export type LessonDocumentAiAPI = (request: LessonDocumentAiRequest) => Promise<LessonDocumentAiResult>
