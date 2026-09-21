import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { localAgentConfigurationSchema, localAgentIdSchema, type LocalAgentRecord, type LocalAgentConfiguration, type LocalAgentId } from '../../shared/localAgentContract'
import { localAgentRecordV2Schema, type LocalAgentRecordV2 } from '../../shared/localAgentTaskContract'
import { projectV2RecordToV1 } from '../../shared/localAgentProjection'
import { generationRequestSchema, type GenerationRequest } from '../../shared/generationContract'
import { aiObservationFileSchema } from '../../shared/localAgentTaskContract'
import { aiWorkspaceIdentitySchema, workspaceIdentityKey, type AiWorkspaceIdentity } from '../../shared/workspaceIdentity'
import { renamePreparedPath } from './preparedRename'
import {
  EXTERNAL_AI_NOTICE_VERSION,
  externalAiNoticeConfirmationSchema,
  externalAiNoticeStatusSchema,
  type ExternalAiNoticeStatus,
} from '../../shared/externalAiNotice'

const GENERATION_REQUEST_FILE = 'generation-request.json'
const EXTERNAL_AI_NOTICE_FILE = 'external-ai-notice.json'
/** The confirmed CLI is part of the confirmation key, never inferred: one record per
 * scope directory *and* adapter file. A teacher who confirmed Codex has not confirmed Claude. */
function externalAiNoticeFile(adapter: LocalAgentId | undefined): string {
  return adapter === undefined ? EXTERNAL_AI_NOTICE_FILE : `external-ai-notice.${adapter}.json`
}
const externalAiNoticeRecordSchema = z.object({
  schemaVersion: z.literal(1),
  noticeVersion: z.literal(EXTERNAL_AI_NOTICE_VERSION),
  scope: externalAiNoticeConfirmationSchema.shape.scope,
  adapter: localAgentIdSchema.optional(),
  confirmedAt: z.number().int().nonnegative(),
}).strict()

export class LocalAgentRepository {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly userData: string) {}
  readConfiguration(adapter: LocalAgentId): Promise<LocalAgentConfiguration | undefined> {
    localAgentIdSchema.parse(adapter)
    return this.serialize(async () => {
      try {
        const value = JSON.parse(await fs.readFile(path.join(this.userData, 'local-agent', 'preferences', 'v1', `${adapter}.json`), 'utf8'))
        return z.object({ version: z.literal(1), configuration: localAgentConfigurationSchema }).strict().parse(value).configuration
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw new Error('无法读取已保存的 CLI 配置，请重新选择模型与强度')
      }
    })
  }
  writeConfiguration(adapter: LocalAgentId, input: LocalAgentConfiguration): Promise<void> {
    localAgentIdSchema.parse(adapter)
    const configuration = localAgentConfigurationSchema.parse(input)
    return this.serialize(async () => {
      const directory = path.join(this.userData, 'local-agent', 'preferences', 'v1')
      await fs.mkdir(directory, { recursive: true })
      const destination = path.join(directory, `${adapter}.json`), temporary = `${destination}.tmp`
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, configuration }), { mode: 0o600 })
        await renamePreparedPath(temporary, destination)
      } finally { await fs.rm(temporary, { force: true }) }
    })
  }
  directory(workspace: AiWorkspaceIdentity): string {
    return this.versionDirectory(workspace, 1)
  }
  v2Directory(workspace: AiWorkspaceIdentity): string {
    return this.versionDirectory(workspace, 2)
  }
  private versionDirectory(workspace: AiWorkspaceIdentity, version: 1 | 2): string {
    return path.join(this.userData, 'local-agent', `v${version === 2 ? 3 : version}`, createHash('sha256').update(workspaceIdentityKey(workspace)).digest('hex'))
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation, operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  storedBytes(scopes?: readonly AiWorkspaceIdentity[]): Promise<number> {
    const parsedScopes = scopes?.map(scope => aiWorkspaceIdentitySchema.parse(scope))
    return this.serialize(async () => {
      const root = path.resolve(this.userData, 'local-agent', 'v3')
      const targets = parsedScopes === undefined
        ? [root]
        : [...new Set(parsedScopes.map(scope => path.resolve(this.v2Directory(scope))))]
      let total = 0
      for (const target of targets) {
        if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Invalid local agent usage root')
        total += await this.pathBytes(target, root)
      }
      return total
    })
  }
  private async pathBytes(target: string, root: string): Promise<number> {
    const resolved = path.resolve(target)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('Local agent usage path escaped its root')
    let stat
    try { stat = await fs.lstat(resolved) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error }
    if (stat.isSymbolicLink()) return 0
    if (stat.isFile()) return stat.size
    if (!stat.isDirectory()) return 0
    let total = 0
    const names = await fs.readdir(resolved).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const name of names) total += await this.pathBytes(path.join(resolved, name), root)
    return total
  }
  readExternalAiNotice(scope: AiWorkspaceIdentity, adapter?: LocalAgentId): Promise<ExternalAiNoticeStatus> {
    const requested = workspaceIdentityKey(scope)
    const requestedAdapter = adapter === undefined ? undefined : localAgentIdSchema.parse(adapter)
    return this.serialize(async () => {
      try {
        const filename = path.join(this.v2Directory(scope), externalAiNoticeFile(requestedAdapter))
        const stat = await fs.stat(filename)
        if (stat.size > 64 * 1024) return externalAiNoticeStatusSchema.parse({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
        const confirmation = externalAiNoticeRecordSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
        if (workspaceIdentityKey(confirmation.scope) !== requested || confirmation.adapter !== requestedAdapter) {
          return externalAiNoticeStatusSchema.parse({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
        }
        return externalAiNoticeStatusSchema.parse({
          version: EXTERNAL_AI_NOTICE_VERSION,
          confirmed: true,
          confirmedAt: confirmation.confirmedAt,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof z.ZodError || error instanceof SyntaxError) {
          return externalAiNoticeStatusSchema.parse({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
        }
        throw error
      }
    })
  }
  confirmExternalAiNotice(scope: AiWorkspaceIdentity, adapter?: LocalAgentId): Promise<ExternalAiNoticeStatus> {
    const parsedScope = externalAiNoticeConfirmationSchema.shape.scope.parse(scope)
    const parsedAdapter = adapter === undefined ? undefined : localAgentIdSchema.parse(adapter)
    return this.serialize(async () => {
      const directory = this.v2Directory(parsedScope)
      await fs.mkdir(directory, { recursive: true })
      const destination = path.join(directory, externalAiNoticeFile(parsedAdapter))
      const temporary = `${destination}.tmp`
      const confirmedAt = Date.now()
      const confirmation = externalAiNoticeRecordSchema.parse({
        schemaVersion: 1,
        noticeVersion: EXTERNAL_AI_NOTICE_VERSION,
        scope: parsedScope,
        adapter: parsedAdapter,
        confirmedAt,
      })
      try {
        await fs.writeFile(temporary, JSON.stringify(confirmation), { mode: 0o600 })
        await renamePreparedPath(temporary, destination)
      } finally { await fs.rm(temporary, { force: true }) }
      return externalAiNoticeStatusSchema.parse({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: true, confirmedAt })
    })
  }
  async staging(workspace: AiWorkspaceIdentity, id: string, version: 1 | 2 = 2): Promise<string> {
    const directory = this.stagingPath(workspace, id, version)
    await fs.mkdir(directory, { recursive: true })
    return directory
  }
  stagingPath(workspace: AiWorkspaceIdentity, id: string, version: 1 | 2 = 2): string {
    z.uuid().parse(id)
    return path.join(this.versionDirectory(workspace, version), id, 'staging')
  }
  observationPath(workspace: AiWorkspaceIdentity, workingDirectoryId: string, observationId: string): string {
    z.uuid().parse(workingDirectoryId)
    z.uuid().parse(observationId)
    return path.join(this.v2Directory(workspace), workingDirectoryId, 'observations', observationId)
  }
  async writeObservation(workspace: AiWorkspaceIdentity, workingDirectoryId: string, observationId: string, relativePath: string, content: string | Uint8Array): Promise<void> {
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
  async readGenerationRequest(workspace: AiWorkspaceIdentity, workingDirectoryId: string, observationId: string | null): Promise<GenerationRequest | undefined> {
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
  writeDisplay(workspace: AiWorkspaceIdentity, id: string, display: { hostResult?: unknown; cleanupIssue?: string }): Promise<void> {
    z.uuid().parse(id)
    return this.serialize(async () => {
      const directory = this.v2Directory(workspace)
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(path.join(directory, `${id}.display.json`), JSON.stringify(display), { mode: 0o600 })
    })
  }
  private async readDisplay(workspace: AiWorkspaceIdentity, id: string): Promise<{ hostResult?: LocalAgentRecord['hostResult']; cleanupIssue?: string }> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.v2Directory(workspace), `${id}.display.json`), 'utf8')) as { hostResult?: LocalAgentRecord['hostResult']; cleanupIssue?: string }
    } catch { return {} }
  }
  write(input: LocalAgentRecordV2): Promise<void> {
    const record = localAgentRecordV2Schema.parse(input)
    return this.serialize(async () => {
      const directory = this.v2Directory(record.lessonWorkspace ?? record.workspace)
      await fs.mkdir(directory, { recursive: true })
      const temporary = path.join(directory, `${record.id}.tmp`)
      try {
        await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 })
        await renamePreparedPath(temporary, path.join(directory, `${record.id}.json`))
      } finally { await fs.rm(temporary, { force: true }) }
    })
  }
  list(workspace: AiWorkspaceIdentity): Promise<{ records: LocalAgentRecord[]; v2: LocalAgentRecordV2[]; damaged: string[] }> {
    return this.serialize(async () => this.readAll(workspace))
  }
  read(workspace: AiWorkspaceIdentity, id: string): Promise<{ records: LocalAgentRecord[]; v2: LocalAgentRecordV2[]; damaged: string[] }> {
    z.uuid().parse(id)
    return this.serialize(async () => this.readAll(workspace, id))
  }
  private async readAll(workspace: AiWorkspaceIdentity, requestedId?: string): Promise<{ records: LocalAgentRecord[]; v2: LocalAgentRecordV2[]; damaged: string[] }> {
    const root = path.join(this.userData, 'local-agent', 'v3')
    const folders = 'kind' in workspace ? [this.v2Directory(workspace)] : (await fs.readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })).filter(name => /^[a-f0-9]{64}$/.test(name)).map(name => path.join(root, name))
    const records: LocalAgentRecord[] = []
    const v2: LocalAgentRecordV2[] = []
    const damaged: string[] = []
    for (const directory of folders) {
    // Lesson requests already identify their storage directory. Project requests
    // also probe lesson directories, where project-bound conversation records live.
    // A page read never enumerates or parses unrelated record files.
    const names = requestedId ? [`${requestedId}.json`] : await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    for (const name of names) {
      if (name.endsWith('.damaged')) { damaged.push(name); continue }
      if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
      const id = name.slice(0, -5)
      const filename = path.join(directory, name)
      try {
        const stat = await fs.stat(filename).catch((error: NodeJS.ErrnoException) => { if (requestedId && error.code === 'ENOENT') return undefined; throw error })
        if (!stat) {
          if (await fs.stat(`${filename}.damaged`).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error })) damaged.push(`${name}.damaged`)
          continue
        }
        if (stat.size > 16 * 1024 * 1024) throw new Error('Oversized record')
        const record = localAgentRecordV2Schema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
        if (record.id !== id) throw new Error('Record mismatch')
        if (workspaceIdentityKey('kind' in workspace ? record.lessonWorkspace ?? record.workspace : record.workspace) !== workspaceIdentityKey(workspace)) continue
        const task = record.tasks.at(-1)
        const generationRequest = await this.readGenerationRequest(record.workspace, record.workingDirectoryId, task?.observationId ?? null)
        const display = await this.readDisplay(record.workspace, id)
        v2.push(record)
        records.push(projectV2RecordToV1(record, { generationRequest, hostResult: display.hostResult, cleanupIssue: display.cleanupIssue }))
      } catch {
        await fs.rename(filename, `${filename}.damaged`)
        damaged.push(name)
      }
    }
    }
    return { records, v2, damaged }
  }
  relocateLessonWorkspace(previous: Extract<AiWorkspaceIdentity, { kind: 'lesson' }>, next: Extract<AiWorkspaceIdentity, { kind: 'lesson' }>): Promise<void> {
    return this.serialize(async () => {
      if (previous.lessonId !== next.lessonId || previous.conversationId !== next.conversationId) throw new Error('移动不能改变课例或对话身份')
      const source = this.v2Directory(previous), destination = this.v2Directory(next)
      if (source === destination) return
      try { await fs.rename(source, destination) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
      const names = await fs.readdir(destination)
      for (const name of names) {
        if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
        const filename = path.join(destination, name)
        try {
          const record = localAgentRecordV2Schema.parse(JSON.parse(await fs.readFile(filename, 'utf8')))
          if ('kind' in record.workspace) {
            record.workspace = next
            record.tasks = record.tasks.map(task => ({ ...task, workspace: next }))
            record.observations = record.observations.map(observation => ({ ...observation, workspace: next }))
            record.events = record.events.map(event => ({ ...event, workspace: next,
              ...(event.kind === 'question' ? { question: { ...event.question, workspace: next } } : {}),
              ...(event.kind === 'input-delivery' ? { delivery: { ...event.delivery, workspace: next } } : {}),
            }))
          } else record.lessonWorkspace = next
          record.externalSessionId = null
          const temporary = `${filename}.tmp`
          await fs.writeFile(temporary, JSON.stringify(localAgentRecordV2Schema.parse(record)))
          await renamePreparedPath(temporary, filename)
        } catch { await fs.rename(filename, `${filename}.damaged`) }
      }
    })
  }
  listStoredWorkspaces(): Promise<AiWorkspaceIdentity[]> {
    return this.serialize(async () => {
      const root = path.join(this.userData, 'local-agent', 'v3')
      const scopes = new Map<string, AiWorkspaceIdentity>()
      const directories = await fs.readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      for (const directory of directories.filter(name => /^[a-f0-9]{64}$/.test(name))) {
        const folder = path.join(root, directory)
        if (!(await fs.lstat(folder)).isDirectory()) continue
        for (const name of await fs.readdir(folder)) {
          if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
          try {
            const record = localAgentRecordV2Schema.parse(JSON.parse(await fs.readFile(path.join(folder, name), 'utf8')))
            if (record.id !== name.slice(0, -5)) continue
            const owner = record.lessonWorkspace ?? record.workspace
            scopes.set(workspaceIdentityKey(owner), owner)
          } catch { /* Explicit all-record deletion handles isolated damaged records too. */ }
        }
      }
      return [...scopes.values()]
    })
  }
  /** All running owners must be stopped before this explicit application-record cleanup. */
  deleteAllStoredRecords(): Promise<void> {
    return this.serialize(async () => {
      const ownerRoot = path.resolve(this.userData), target = path.resolve(ownerRoot, 'local-agent', 'v3')
      if (!target.startsWith(ownerRoot + path.sep)) throw new Error('Invalid local agent record root')
      await fs.rm(target, { recursive: true, force: true })
    })
  }
  delete(workspace: AiWorkspaceIdentity, id?: string): Promise<void> {
    if (id) z.uuid().parse(id)
    return this.serialize(async () => {
      const records = (await this.readAll(workspace)).v2.filter(record => !id || record.id === id)
      for (const record of records) {
        await this.deleteVersion(this.v2Directory(record.lessonWorkspace ?? record.workspace), record.id)
        await fs.rm(path.join(this.v2Directory(record.workspace), `${record.id}.display.json`), { force: true })
        const remaining = (await this.readAll(record.workspace)).v2
        if (!remaining.some(value => value.workingDirectoryId === record.workingDirectoryId)) {
          const root = path.resolve(this.v2Directory(record.workspace)), target = path.resolve(root, record.workingDirectoryId)
          if (path.dirname(target) !== root) throw new Error('Invalid task staging root')
          await fs.rm(target, { recursive: true, force: true })
        }
      }
      if ('kind' in workspace) await this.deleteVersion(this.v2Directory(workspace), id)
    })
  }
  private async deleteVersion(directory: string, id?: string): Promise<void> {
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
  }
}
