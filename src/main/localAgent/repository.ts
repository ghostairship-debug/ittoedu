import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { localAgentRecordSchema, type LocalAgentRecord } from '../../shared/localAgentContract'
import { localAgentRecordV2Schema, parseLocalAgentLegacyRecord, type LocalAgentRecordV2 } from '../../shared/localAgentTaskContract'
import { projectV2RecordToV1 } from '../../shared/localAgentProjection'
import { generationRequestSchema, type GenerationRequest } from '../../shared/generationContract'
import { aiObservationFileSchema } from '../../shared/localAgentTaskContract'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'

const GENERATION_REQUEST_FILE = 'generation-request.json'

export class LocalAgentRepository {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly userData: string) {}
  directory(workspace: WorkspaceIdentityV1): string {
    return this.versionDirectory(workspace, 1)
  }
  v2Directory(workspace: WorkspaceIdentityV1): string {
    return this.versionDirectory(workspace, 2)
  }
  private versionDirectory(workspace: WorkspaceIdentityV1, version: 1 | 2): string {
    return path.join(this.userData, 'local-agent', `v${version}`, createHash('sha256').update(workspaceIdentityKey(workspace)).digest('hex'))
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation, operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  async staging(workspace: WorkspaceIdentityV1, id: string, version: 1 | 2 = 2): Promise<string> {
    const directory = this.stagingPath(workspace, id, version)
    await fs.mkdir(directory, { recursive: true })
    return directory
  }
  stagingPath(workspace: WorkspaceIdentityV1, id: string, version: 1 | 2 = 2): string {
    z.uuid().parse(id)
    return path.join(this.versionDirectory(workspace, version), id, 'staging')
  }
  observationPath(workspace: WorkspaceIdentityV1, workingDirectoryId: string, observationId: string): string {
    z.uuid().parse(workingDirectoryId)
    z.uuid().parse(observationId)
    return path.join(this.v2Directory(workspace), workingDirectoryId, 'observations', observationId)
  }
  async writeObservation(workspace: WorkspaceIdentityV1, workingDirectoryId: string, observationId: string, relativePath: string, content: string | Uint8Array): Promise<void> {
    aiObservationFileSchema.shape.relativePath.parse(relativePath)
    return this.serialize(async () => {
      const root = path.resolve(this.observationPath(workspace, workingDirectoryId, observationId))
      const target = path.resolve(root, relativePath)
      if (!target.startsWith(root + path.sep)) throw new Error('Observation path escaped its root')
      await fs.mkdir(path.dirname(target), { recursive: true })
      if (!(await fs.realpath(path.dirname(target))).startsWith((await fs.realpath(root)) + path.sep) && await fs.realpath(path.dirname(target)) !== await fs.realpath(root)) throw new Error('Observation parent escaped its root')
      await fs.writeFile(target, content, { mode: 0o600, flag: 'wx' })
    })
  }
  async readGenerationRequest(workspace: WorkspaceIdentityV1, workingDirectoryId: string, observationId: string | null): Promise<GenerationRequest | undefined> {
    if (!observationId) return undefined
    const root = path.resolve(this.observationPath(workspace, workingDirectoryId, observationId))
    const target = path.resolve(root, GENERATION_REQUEST_FILE)
    if (path.dirname(target) !== root) return undefined
    try {
      return generationRequestSchema.parse(JSON.parse(await fs.readFile(target, 'utf8')))
    } catch {
      return undefined
    }
  }
  async isLegacy(workspace: WorkspaceIdentityV1, id: string): Promise<boolean> {
    z.uuid().parse(id)
    return this.serialize(async () => {
      try {
        await fs.stat(path.join(this.directory(workspace), `${id}.json`))
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    })
  }
  writeDisplay(workspace: WorkspaceIdentityV1, id: string, display: { hostResult?: unknown; cleanupIssue?: string }): Promise<void> {
    z.uuid().parse(id)
    return this.serialize(async () => {
      const directory = this.v2Directory(workspace)
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, `${id}.display.json`), JSON.stringify(display), { mode: 0o600 })
    })
  }
  private async readDisplay(workspace: WorkspaceIdentityV1, id: string): Promise<{ hostResult?: LocalAgentRecord['hostResult']; cleanupIssue?: string }> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.v2Directory(workspace), `${id}.display.json`), 'utf8')) as { hostResult?: LocalAgentRecord['hostResult']; cleanupIssue?: string }
    } catch { return {} }
  }
  write(input: LocalAgentRecordV2): Promise<void> {
    const record = localAgentRecordV2Schema.parse(input)
    return this.serialize(async () => {
      const exists = await fs.stat(path.join(this.directory(record.workspace), `${record.id}.json`)).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      })
      if (exists) throw new Error('Cannot write V2 over an existing V1 session identity')
      const directory = this.v2Directory(record.workspace)
      await fs.mkdir(directory, { recursive: true })
      const temporary = path.join(directory, `${record.id}.tmp`)
      try {
        await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
        await fs.rename(temporary, path.join(directory, `${record.id}.json`))
      } finally { await fs.rm(temporary, { force: true }) }
    })
  }
  list(workspace: WorkspaceIdentityV1): Promise<{ records: LocalAgentRecord[]; v2: LocalAgentRecordV2[]; damaged: string[] }> {
    return this.serialize(async () => this.readAll(workspace))
  }
  private async readAll(workspace: WorkspaceIdentityV1): Promise<{ records: LocalAgentRecord[]; v2: LocalAgentRecordV2[]; damaged: string[] }> {
    const v1Names = await fs.readdir(this.directory(workspace)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    const v2Names = await fs.readdir(this.v2Directory(workspace)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    const records: LocalAgentRecord[] = []
    const v2: LocalAgentRecordV2[] = []
    const damaged: string[] = []
    const v1Ids = new Set<string>()
    for (const name of v1Names) {
      if (name.endsWith('.damaged')) { damaged.push(name); continue }
      if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
      const id = name.slice(0, -5)
      v1Ids.add(id)
      const filename = path.join(this.directory(workspace), name)
      try {
        if ((await fs.stat(filename)).size > 16 * 1024 * 1024) throw new Error('Oversized record')
        const record = parseLocalAgentLegacyRecord(JSON.parse(await fs.readFile(filename, 'utf8')))
        if (record.id !== id || workspaceIdentityKey(record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('Workspace mismatch')
        records.push(record)
      } catch {
        await fs.rename(filename, `${filename}.damaged`)
        damaged.push(name)
      }
    }
    for (const name of v2Names) {
      if (name.endsWith('.damaged')) { damaged.push(name); continue }
      if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
      const id = name.slice(0, -5)
      const filename = path.join(this.v2Directory(workspace), name)
      if (v1Ids.has(id)) {
        await fs.rename(filename, `${filename}.damaged`)
        damaged.push(name)
        continue
      }
      try {
        if ((await fs.stat(filename)).size > 16 * 1024 * 1024) throw new Error('Oversized record')
        const record = localAgentRecordV2Schema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
        if (record.id !== id || workspaceIdentityKey(record.workspace) !== workspaceIdentityKey(workspace)) throw new Error('Workspace mismatch')
        const task = record.tasks.at(-1)
        const generationRequest = await this.readGenerationRequest(workspace, record.workingDirectoryId, task?.observationId ?? null)
        const display = await this.readDisplay(workspace, id)
        v2.push(record)
        records.push(projectV2RecordToV1(record, { generationRequest, hostResult: display.hostResult, cleanupIssue: display.cleanupIssue }))
      } catch {
        await fs.rename(filename, `${filename}.damaged`)
        damaged.push(name)
      }
    }
    return { records, v2, damaged }
  }
  delete(workspace: WorkspaceIdentityV1, id?: string): Promise<void> {
    if (id) z.uuid().parse(id)
    return this.serialize(async () => {
      await this.deleteVersion(this.directory(workspace), 1, id)
      await this.deleteVersion(this.v2Directory(workspace), 2, id)
    })
  }
  private async deleteVersion(directory: string, version: 1 | 2, id?: string): Promise<void> {
    const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    for (const name of names) {
      if (name.endsWith('.display.json')) {
        const recordId = name.slice(0, -'.display.json'.length)
        if (id && recordId !== id) continue
        const target = path.resolve(directory, name)
        if (path.dirname(target) !== path.resolve(directory)) throw new Error('Invalid local record path')
        await fs.rm(target, { force: true })
        continue
      }
      if (!name.endsWith('.json') && !name.endsWith('.json.damaged')) continue
      const recordId = name.replace(/\.json(?:\.damaged)?$/, '')
      if (!z.uuid().safeParse(recordId).success || (id && recordId !== id)) continue
      const target = path.resolve(directory, name)
      if (path.dirname(target) !== path.resolve(directory)) throw new Error('Invalid local record path')
      await fs.rm(target, { recursive: true, force: true })
    }
    const remaining = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    const referenced = new Set<string>()
    let damaged = false
    for (const name of remaining) {
      if (name.endsWith('.damaged') || name.endsWith('.display.json')) { damaged = name.endsWith('.damaged') ? true : damaged; continue }
      if (!name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))
        if (version === 1) referenced.add(localAgentRecordSchema.parse(raw).workingDirectoryId ?? localAgentRecordSchema.parse(raw).id)
        else referenced.add(localAgentRecordV2Schema.parse(raw).workingDirectoryId)
      } catch { damaged = true }
    }
    if (!damaged) for (const name of remaining) {
      if (!z.uuid().safeParse(name).success || referenced.has(name)) continue
      const target = path.resolve(directory, name)
      if (path.dirname(target) !== path.resolve(directory)) throw new Error('Invalid CLI directory')
      await fs.rm(target, { recursive: true, force: true })
    }
  }
}
