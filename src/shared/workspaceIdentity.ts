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

export function workspaceIdentityKey(identity: WorkspaceIdentityV1): string {
  const parsed = workspaceIdentityV1Schema.parse(identity)
  return JSON.stringify([parsed.version, parsed.projectId, parsed.normalizedPath])
}
