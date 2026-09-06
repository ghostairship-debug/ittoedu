import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { materialInputSchema, materialRecordV1Schema, type MaterialInput, type MaterialRecordV1 } from '../shared/materialContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../shared/workspaceIdentity'

/** One atomically written record is authoritative. Search is rebuilt from records on every read. */
export class MaterialRepository {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly userDataPath: string) {}

  private directory(workspace: WorkspaceIdentityV1): string {
    const key = createHash('sha256').update(workspaceIdentityKey(workspace)).digest('hex')
    return path.join(this.userDataPath, 'materials', 'v1', key)
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  import(workspace: WorkspaceIdentityV1, input: MaterialInput): Promise<MaterialRecordV1> {
    const record = materialRecordV1Schema.parse({
      ...materialInputSchema.parse(input), version: 1, id: randomUUID(), workspace, createdAt: Date.now(),
    })
    return this.serialized(async () => {
      const directory = this.directory(workspace)
      await fs.mkdir(directory, { recursive: true })
      const temporary = path.join(directory, `${record.id}.tmp`)
      try {
        await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx' })
        await fs.rename(temporary, path.join(directory, `${record.id}.json`))
      } catch (error) {
        await fs.rm(temporary, { force: true })
        throw error
      }
      return record
    })
  }

  search(workspace: WorkspaceIdentityV1, query = ''): Promise<MaterialRecordV1[]> {
    return this.serialized(async () => {
      const directory = this.directory(workspace)
      const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const result: MaterialRecordV1[] = []
      const needle = query.trim().toLocaleLowerCase()
      for (const name of names) {
        if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
        const record = materialRecordV1Schema.parse(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')))
        if (workspaceIdentityKey(record.workspace) !== workspaceIdentityKey(workspace) || `${record.id}.json` !== name) {
          throw new Error('材料记录的工程身份不匹配')
        }
        if (`${record.title}\n${record.text}\n${record.source.locator}`.toLocaleLowerCase().includes(needle)) result.push(record)
      }
      return result.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    })
  }

  async read(workspace: WorkspaceIdentityV1, id: string): Promise<MaterialRecordV1 | null> {
    z.uuid().parse(id)
    return (await this.search(workspace)).find((record) => record.id === id) ?? null
  }

  async delete(workspace: WorkspaceIdentityV1, id?: string): Promise<void> {
    if (id !== undefined) z.uuid().parse(id)
    return this.serialized(async () => {
      const directory = this.directory(workspace)
      // Only direct record files are removed; never recurse through user-provided paths.
      const names = id ? [`${id}.json`] : await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const name of names) {
        if (name.endsWith('.json') && z.uuid().safeParse(name.slice(0, -5)).success) {
          await fs.rm(path.join(directory, name), { force: true })
        }
      }
    })
  }
}
