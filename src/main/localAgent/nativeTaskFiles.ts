import { promises as fs } from 'node:fs'
import path from 'node:path'
import { generationCapabilityDirectory } from './capabilityWorkspace'

/** Supplying a task includes reading its own host-created inputs. This does not
 * grant shell/edit access, other directories, or a persistent native permission. */
export async function isTaskInputRead(tool: { kind?: unknown; rawInput?: any; locations?: any }, candidateRoot?: string): Promise<boolean> {
  if (!candidateRoot || tool.kind !== 'read') return false
  const raw = tool.rawInput
  if (raw && (typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).some(key => !['filepath', 'filePath', 'path', 'parentDir', 'offset', 'limit'].includes(key)))) return false
  const files = [...(Array.isArray(tool.locations) ? tool.locations.map((entry: any) => entry?.path) : []),
    ...[raw?.filepath, raw?.filePath, raw?.path].filter(value => value !== undefined)]
  if (!files.length || files.some(file => typeof file !== 'string' || !path.isAbsolute(file))) return false
  try {
    const roots = await Promise.all([candidateRoot, generationCapabilityDirectory(candidateRoot)].map(root => fs.realpath(root)))
    for (const file of files) {
      const resolved = await fs.realpath(file)
      if (!roots.some(root => { const relative = path.relative(root, resolved); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) })) return false
      if (!(await fs.stat(resolved)).isFile()) return false
    }
    return true
  } catch { return false }
}
