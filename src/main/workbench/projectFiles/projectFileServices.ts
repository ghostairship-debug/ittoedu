import { isNativeProjectFilename } from '../../../shared/nativeProjectFile'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HostToolServices } from '../../../core/tools/HostToolServices'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { ToolRunGrant } from '../../../shared/workbench/tools'
import type { DocumentHostService } from '../DocumentHostService'

/** The task's frozen file access decides what a path may name, as for the file tools. */
async function permittedPath(requested: string, fileAccess: ToolRunGrant['fileAccess']): Promise<{ filename: string; inside: boolean }> {
  const root = fileAccess?.workspaceRoot
  if (!fileAccess || !root) throw new Error('按路径使用文件需要本任务的工作空间')
  const realRoot = await fs.realpath(root)
  const filename = await fs.realpath(path.resolve(root, requested))
  const inside = isInsideRoot(realRoot, filename)
  if (fileAccess.permission !== 'full' && !inside) throw new Error('只能使用工作空间内的文件')
  return { filename, inside }
}

/** Opens existing formal projects by an authorized workspace path. */
export function createProjectFileServices(host: Pick<DocumentHostService, 'open'>): NonNullable<HostToolServices['projectFiles']> {
  return {
    async openProject({ path: requested, fileAccess }) {
      if (!isNativeProjectFilename(requested)) throw new Error('只能按路径打开 .glx 课件')
      const { filename, inside } = await permittedPath(requested, fileAccess)
      const snapshot = await host.open(filename)
      if (snapshot.model.kind !== 'course-v10') throw new Error('该文件不是 Project V10 课件工程')
      return { documentId: snapshot.documentId, writable: fileAccess!.permission !== 'read-only' && (fileAccess!.permission === 'full' || inside) }
    },
  }
}
