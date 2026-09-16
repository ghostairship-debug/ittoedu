import { z } from 'zod'

/** Shared by local materials and AI sessions; never persisted in a course. */
export const workspaceIdentityV1Schema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1).max(200),
  normalizedPath: z.string().min(1).max(32_767).refine(
    (value) => !value.includes('\0') && !value.includes('\\') &&
      (/^[a-z]:\//.test(value) || value.startsWith('/')) &&
      (!/^[a-z]:\//.test(value) && !value.startsWith('//') || value === value.toLowerCase()) &&
      !value.includes('//', value.startsWith('//') ? 2 : 0) &&
      !value.split('/').some((part) => part === '.' || part === '..'),
    '需要规范化的绝对工程路径',
  ),
}).strict()

export type WorkspaceIdentityV1 = z.infer<typeof workspaceIdentityV1Schema>

export const lessonAgentWorkspaceSchema = z.object({ version: z.literal(1), kind: z.literal('lesson'), lessonId: z.uuid(),
  normalizedDirectory: workspaceIdentityV1Schema.shape.normalizedPath, conversationId: z.uuid() }).strict()
export const aiWorkspaceIdentitySchema = z.union([workspaceIdentityV1Schema, lessonAgentWorkspaceSchema])
export type LessonAgentWorkspace = z.infer<typeof lessonAgentWorkspaceSchema>
export type AiWorkspaceIdentity = z.infer<typeof aiWorkspaceIdentitySchema>
export function workspaceIdentityKey(identity: AiWorkspaceIdentity): string {
  const parsed = aiWorkspaceIdentitySchema.parse(identity)
  return 'kind' in parsed ? JSON.stringify(['lesson', parsed.lessonId, parsed.normalizedDirectory, parsed.conversationId])
    : JSON.stringify([parsed.version, parsed.projectId, parsed.normalizedPath])
}
