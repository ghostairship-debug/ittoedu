import { z } from 'zod'

/** Owner 2026-09-24: the built-in AI is a general agent with four levels, frozen per task and enforced by Main. */
export const executionPermissionModes = ['full', 'workspace', 'ask', 'read-only'] as const
export const executionPermissionModeSchema = z.enum(executionPermissionModes)
export type ExecutionPermissionMode = z.infer<typeof executionPermissionModeSchema>
export const DEFAULT_PERMISSION_MODE: ExecutionPermissionMode = 'workspace'
export const permissionLabels: Record<ExecutionPermissionMode, string> = {
  full: '完全访问', workspace: '完全访问（工作空间）', ask: '修改前询问', 'read-only': '只读',
}
/** Compact text for the composer's bottom row; the menu and the accessible name use the full label. */
export const permissionShortLabels: Record<ExecutionPermissionMode, string> = { full: '完全访问', workspace: '工作空间', ask: '修改前询问', 'read-only': '只读' }
export const permissionDescriptions: Record<ExecutionPermissionMode, string> = {
  full: '可读写任意文件，修改不再询问',
  workspace: '工作空间内直接修改；工作空间外的修改先询问',
  ask: '每次修改前先询问你',
  'read-only': '只读取和回答，不做修改',
}

export const approvalDecisionSchema = z.enum(['allow', 'deny', 'allow-all'])
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>
/** What the approval card shows before a modification runs. Never contains credentials or raw binary. */
export const approvalViewSchema = z.object({
  summary: z.string().min(1).max(500),
  documents: z.array(z.string().max(2048)).max(20),
  reason: z.enum(['ask', 'outside-workspace']),
  preview: z.string().max(4000).optional(),
}).strict()
export type ApprovalView = z.infer<typeof approvalViewSchema>

/** Windows paths compare case-insensitively; both sides are absolute host paths. */
export function isInsideRoot(root: string, target: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
  const base = normalize(root), candidate = normalize(target)
  return candidate === base || candidate.startsWith(base + '/')
}
