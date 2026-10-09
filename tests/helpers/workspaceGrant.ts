import type { ToolRunGrant } from '../../src/shared/workbench/tools'

/** Fixtures use the actual frozen grant; a missing root must never become ambient authority. */
export function requireWorkspaceRoot(access: ToolRunGrant['fileAccess']): string {
  if (!access?.workspaceRoot) throw new Error('Expected an authorized workspace root')
  return access.workspaceRoot
}
