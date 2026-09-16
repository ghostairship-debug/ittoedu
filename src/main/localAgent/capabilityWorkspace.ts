import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import generatedCapabilities from '../../shared/generated/courseAgentCapabilities.json'
import { generationResourceFileSchema } from '../../shared/generationContract'
import { renamePreparedPath } from './preparedRename'
import { courseAgentCapabilityDiskIndex } from '../../shared/courseAgentCapabilities'

/** Capability references survive turns, but remain inside this conversation's
 * application-owned staging directory and follow its existing deletion owner. */
export function generationCapabilityDirectory(candidateRoot: string, semanticVersion = generatedCapabilities.semanticVersion): string {
  if (!/^[a-f0-9]{64}$/.test(semanticVersion)) throw new Error('能力语义版本无效')
  return path.resolve(candidateRoot, '..', '..', 'capabilities', semanticVersion)
}

const preparing = new Map<string, Promise<void>>()
const files: Record<string, string> = { ...generatedCapabilities.files, 'discovery-data.json': courseAgentCapabilityDiskIndex(generatedCapabilities as import('../../shared/courseAgentCapabilities').CourseAgentCapabilityData) }

async function assertCache(directory: string): Promise<void> {
  if (await fs.realpath(directory) !== directory) throw new Error('能力目录不能包含链接')
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(directory, ...relative.split('/'))
    if (await fs.realpath(target) !== target || await fs.readFile(target, 'utf8') !== content) throw new Error(`能力资料与当前语义版本不一致：${relative}`)
  }
}

/** One generated source, immutable per semantic version. No candidate or project
 * resources are retained here, and no cache is shared across workspaces. */
export async function ensureGenerationCapabilityWorkspace(candidateRoot: string): Promise<string> {
  const directory = generationCapabilityDirectory(candidateRoot)
  let work = preparing.get(directory)
  if (!work) {
    work = (async () => {
      const parent = path.dirname(directory)
      await fs.mkdir(parent, { recursive: true })
      if (await fs.realpath(parent) !== parent) throw new Error('能力父目录不能包含链接')
      let exists = false
      try { await fs.stat(directory); exists = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (exists) { await assertCache(directory); return }
      const temporary = path.join(parent, `.${generatedCapabilities.semanticVersion}.${randomUUID()}.tmp`)
      await fs.mkdir(temporary)
      try {
        for (const [relative, content] of Object.entries(files)) {
          generationResourceFileSchema.shape.path.parse(relative)
          const target = path.join(temporary, ...relative.split('/'))
          await fs.mkdir(path.dirname(target), { recursive: true })
          if (await fs.realpath(path.dirname(target)) !== path.dirname(target)) throw new Error('能力资源目录不能包含链接')
          await fs.writeFile(target, content, { flag: 'wx', mode: 0o600 })
        }
        // Only an entirely written, realpath-closed capability tree may be
        // published. A concurrent completed tree is acceptable only when its
        // immutable semantic contents are exactly the same.
        await assertCache(temporary)
        await renamePreparedPath(temporary, directory, async () => {
          try { await fs.stat(directory) }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
            throw error
          }
          await assertCache(directory)
          return false
        })
      } finally {
        // The computed temporary path is a direct child of the verified parent.
        if (path.dirname(temporary) !== parent) throw new Error('能力暂存目录越界')
        await fs.rm(temporary, { recursive: true, force: true })
      }
    })()
    preparing.set(directory, work)
    void work.finally(() => { if (preparing.get(directory) === work) preparing.delete(directory) }).catch(() => {})
  }
  await work
  return directory
}
