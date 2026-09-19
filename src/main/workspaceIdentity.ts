import path from 'node:path'
import { normalizeWorkspacePath, workspaceIdentityV1Schema, type WorkspaceIdentityV1 } from '../shared/workspaceIdentity'

/** Resolve using the host's path rules, preserving case on case-sensitive hosts. */
export function createWorkspaceIdentity(
  projectId: string,
  projectPath: string,
  platform: NodeJS.Platform = process.platform,
): WorkspaceIdentityV1 {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (!paths.isAbsolute(projectPath) || projectPath.includes('\0')) {
    throw new Error('请先保存工程，材料需要绝对工程路径')
  }
  const normalizedPath = normalizeWorkspacePath(paths.normalize(projectPath), platform)
  return workspaceIdentityV1Schema.parse({ version: 1, projectId, normalizedPath })
}
