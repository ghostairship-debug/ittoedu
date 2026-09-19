import { z } from 'zod'

/** Host path comparison and persistence share this rule. Trailing slashes are not identity. */
export function normalizeWorkspacePath(value: string, platform: NodeJS.Platform = typeof process === 'undefined' ? 'win32' : process.platform): string {
  if (!value || value.includes('\0')) throw new Error('需要规范化的绝对工程路径')
  let normalized = value.replace(/\\/g, '/')
  // Drive paths must be lowercase to match workspaceIdentityV1Schema even when the
  // renderer bundle does not report process.platform === 'win32'.
  if (platform === 'win32' || /^[a-zA-Z]:/.test(normalized)) normalized = normalized.toLowerCase()
  if (normalized.length > 1 && normalized.endsWith('/') && !/^[a-z]:\/$/i.test(normalized) && normalized !== '/') {
    normalized = normalized.replace(/\/+$/, '')
    if (/^[a-z]:$/i.test(normalized)) normalized += '/'
  }
  return normalized
}

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
/** F01：工作空间/项目文件夹会话的 agent 作用域；与课例会话同一套 harness，仅身份种类不同。 */
export const directoryAgentWorkspaceSchema = z.object({ version: z.literal(1), kind: z.literal('directory'),
  normalizedDirectory: workspaceIdentityV1Schema.shape.normalizedPath, conversationId: z.uuid() }).strict()
export const conversationAgentWorkspaceSchema = z.discriminatedUnion('kind', [lessonAgentWorkspaceSchema, directoryAgentWorkspaceSchema])
export const aiWorkspaceIdentitySchema = z.union([workspaceIdentityV1Schema, conversationAgentWorkspaceSchema])
export type LessonAgentWorkspace = z.infer<typeof lessonAgentWorkspaceSchema>
export type DirectoryAgentWorkspace = z.infer<typeof directoryAgentWorkspaceSchema>
export type ConversationAgentWorkspace = z.infer<typeof conversationAgentWorkspaceSchema>
export type AiWorkspaceIdentity = z.infer<typeof aiWorkspaceIdentitySchema>
export function workspaceIdentityKey(identity: AiWorkspaceIdentity): string {
  const parsed = aiWorkspaceIdentitySchema.parse(identity)
  return 'kind' in parsed
    ? (parsed.kind === 'lesson'
        ? JSON.stringify(['lesson', parsed.lessonId, parsed.normalizedDirectory, parsed.conversationId])
        : JSON.stringify(['directory', parsed.normalizedDirectory, parsed.conversationId]))
    : JSON.stringify([parsed.version, parsed.projectId, parsed.normalizedPath])
}
