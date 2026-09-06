import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { localAgentRecordSchema, type LocalAgentRecord } from '../../shared/localAgentContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'

/** Version 1 has no predecessor. Unknown versions are quarantined, never silently coerced. */
export class LocalAgentRepository {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly userData: string) {}
  directory(workspace: WorkspaceIdentityV1): string {
    return path.join(this.userData, 'local-agent', 'v1', createHash('sha256').update(workspaceIdentityKey(workspace)).digest('hex'))
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation, operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  async staging(workspace: WorkspaceIdentityV1, id: string): Promise<string> {
    z.uuid().parse(id)
    const directory = path.join(this.directory(workspace), id, 'staging')
    await fs.mkdir(directory, { recursive: true })
    return directory
  }
  write(input: LocalAgentRecord): Promise<void> {
    const record = localAgentRecordSchema.parse(input)
    return this.serialize(async () => {
      const directory = this.directory(record.workspace)
      await fs.mkdir(directory, { recursive: true })
      const temporary = path.join(directory, `${record.id}.tmp`)
      try {
        await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
        await fs.rename(temporary, path.join(directory, `${record.id}.json`))
      } finally { await fs.rm(temporary, { force: true }) }
    })
  }
  list(workspace: WorkspaceIdentityV1): Promise<{ records: LocalAgentRecord[]; damaged: string[] }> {
    return this.serialize(async () => {
      const directory = this.directory(workspace)
      const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      const records: LocalAgentRecord[] = []; const damaged: string[] = []
      for (const name of names) {
        if (name.endsWith('.damaged')) { damaged.push(name); continue }
        if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
        const filename = path.join(directory, name)
        try {
          if ((await fs.stat(filename)).size > 16 * 1024 * 1024) throw new Error('Oversized record')
          const record = localAgentRecordSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
          if (record.id !== name.slice(0, -5) || workspaceIdentityKey(record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('Workspace mismatch')
          let sequence = 0
          for (const event of record.events) {
            if (event.sequence !== ++sequence || event.sessionId !== record.id || event.adapter !== record.adapter) throw new Error('Event identity mismatch')
          }
          const terminals = record.events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.kind))
          if (record.status === 'running' ? terminals.length !== 0 : terminals.length !== 1 || record.events.at(-1)?.kind !== record.status) throw new Error('Terminal state mismatch')
          records.push(record)
        } catch {
          await fs.rename(filename, `${filename}.damaged`)
          damaged.push(name)
        }
      }
      return { records, damaged }
    })
  }
  delete(workspace: WorkspaceIdentityV1, id?: string): Promise<void> {
    if (id) z.uuid().parse(id)
    return this.serialize(async () => {
      const directory = this.directory(workspace)
      const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      for (const name of names) {
        if (!name.endsWith('.json') && !name.endsWith('.json.damaged')) continue
        const recordId = name.replace(/\.json(?:\.damaged)?$/, '')
        if (!z.uuid().safeParse(recordId).success || (id && recordId !== id)) continue
        // The UUID-only child is resolved below the application-owned workspace directory.
        const target = path.resolve(directory, name)
        if (path.dirname(target) !== path.resolve(directory)) throw new Error('Invalid local record path')
        await fs.rm(target, { recursive: true, force: true })
      }
      // Resumed runs share their original CLI directory. Keep it until the last record is deleted.
      const remaining = await fs.readdir(directory)
      const referenced = new Set<string>()
      let damaged = false
      for (const name of remaining) {
        if (name.endsWith('.damaged')) { damaged = true; continue }
        if (!name.endsWith('.json')) continue
        try {
          const record = localAgentRecordSchema.parse(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')))
          referenced.add(record.workingDirectoryId ?? record.id)
        } catch { damaged = true }
      }
      if (!damaged) for (const name of remaining) {
        if (!z.uuid().safeParse(name).success || referenced.has(name)) continue
        const target = path.resolve(directory, name)
        if (path.dirname(target) !== path.resolve(directory)) throw new Error('Invalid CLI directory')
        await fs.rm(target, { recursive: true, force: true })
      }
    })
  }
}
