import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HostToolServices } from '../../../core/tools/HostToolServices'
import { isInsideRoot } from '../../../shared/workbench/executionPermission'
import type { ToolRunGrant } from '../../../shared/workbench/tools'
import type { DocumentHostService } from '../DocumentHostService'
import { parseWebComposition } from '../htmlImport/parseWebComposition'

const IMAGE_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }

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

/** Main-side ports of the project file tools: the HTML importer parser, workspace images and course opening. */
export function createProjectFileServices(host: Pick<DocumentHostService, 'open'>): NonNullable<HostToolServices['projectFiles']> {
  return {
    parsePage: parseWebComposition,
    async readFile({ path: requested, fileAccess }) {
      const { filename } = await permittedPath(requested, fileAccess)
      const mimeType = IMAGE_TYPES[path.extname(filename).toLowerCase()]
      if (!mimeType) throw new Error('只能复制 svg、png、jpg、webp 或 gif 图片')
      return { bytes: new Uint8Array(await fs.readFile(filename)), mimeType, filename: path.basename(filename) }
    },
    async openProject({ path: requested, fileAccess }) {
      if (!/\.h5lesson$/i.test(requested)) throw new Error('只能按路径打开 .h5lesson 课件')
      const { filename, inside } = await permittedPath(requested, fileAccess)
      const snapshot = await host.open(filename)
      if (snapshot.model.kind !== 'course-v9') throw new Error('该文件不是课件工程')
      return { documentId: snapshot.documentId, writable: fileAccess!.permission !== 'read-only' && (fileAccess!.permission === 'full' || inside) }
    },
  }
}
