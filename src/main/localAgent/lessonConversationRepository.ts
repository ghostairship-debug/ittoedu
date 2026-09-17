import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { conversationOwnerKey, conversationOwnerOf, conversationOwnerSchema, lessonConversationSchema, lessonIdentitySchema, type ConversationOwner, type LessonConversation, type LessonIdentity } from '../../shared/lessonWorkspace'
import { workspaceIdentityKey, type WorkspaceIdentityV1 } from '../../shared/workspaceIdentity'

/** Only conversation ownership and task references. Harness remains the sole task/receipt store. */
export class LessonConversationRepository {
  private static readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly userData: string) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.userData), previous = LessonConversationRepository.queues.get(key) ?? Promise.resolve()
    const result = previous.then(action, action); LessonConversationRepository.queues.set(key, result.catch(() => {})); return result
  }
  private parseOwner(owner: ConversationOwner): ConversationOwner {
    return conversationOwnerSchema.parse(owner)
  }
  private directory(owner: ConversationOwner): string {
    const parsed = this.parseOwner(owner)
    if (parsed.kind === 'lesson') return path.join(this.userData, 'lesson-conversations', 'v1', parsed.lesson.lessonId)
    const hash = createHash('sha256').update(parsed.kind === 'workspace' ? parsed.workspaceRoot : `${parsed.workspaceRoot}::${parsed.projectPath}`).digest('hex').slice(0, 24)
    return path.join(this.userData, parsed.kind === 'workspace' ? 'workspace-conversations' : 'project-conversations', 'v1', hash)
  }
  /** 归属根目录：课例为课例目录，工作空间/项目为其真实根，用于存在性与归属校验。 */
  ownerRootDirectory(owner: ConversationOwner): string {
    const parsed = this.parseOwner(owner)
    return parsed.kind === 'lesson' ? parsed.lesson.normalizedDirectory : parsed.kind === 'workspace' ? parsed.workspaceRoot : parsed.projectPath
  }
  private async write(record: LessonConversation): Promise<void> {
    lessonConversationSchema.parse(record)
    const owner = conversationOwnerOf(record)
    const directory = this.directory(owner)
    await fs.mkdir(directory, { recursive: true })
    const destination = path.join(directory, `${record.conversationId}.json`), temporary = `${destination}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify(record), { flag: 'wx' }); await fs.rename(temporary, destination) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  create(owner: ConversationOwner, title = '新对话', projectTarget?: WorkspaceIdentityV1): Promise<LessonConversation> {
    return this.serialize(async () => {
      const parsed = this.parseOwner(owner)
      const now = Date.now()
      const record = lessonConversationSchema.parse({ schemaVersion: 1, conversationId: randomUUID(), owner: parsed, title, createdAt: now, updatedAt: now,
        projectTarget, sessionIds: [], epoch: 0 })
      await this.write(record); return record
    })
  }
  branch(owner: ConversationOwner, conversationId: string): Promise<LessonConversation> {
    return this.serialize(async () => {
      const parsed = this.parseOwner(owner)
      const parent = await this.read(parsed, conversationId)
      const now = Date.now()
      const record = lessonConversationSchema.parse({ schemaVersion: 1, conversationId: randomUUID(), owner: parsed,
        title: `讨论分支：${parent.title}`.slice(0, 200), parentConversationId: parent.conversationId,
        createdAt: now, updatedAt: now, projectTarget: parent.projectTarget, sessionIds: [], epoch: 0 })
      await this.write(record)
      return record
    })
  }
  private async read(owner: ConversationOwner, conversationId: string): Promise<LessonConversation> {
    z.uuid().parse(conversationId)
    const parsed = this.parseOwner(owner)
    const record = lessonConversationSchema.parse(JSON.parse(await fs.readFile(path.join(this.directory(parsed), `${conversationId}.json`), 'utf8')))
    const recordOwner = conversationOwnerOf(record)
    if (record.conversationId !== conversationId || conversationOwnerKey(recordOwner) !== conversationOwnerKey(parsed)) throw new Error('对话不属于当前归属位置')
    return record
  }
  list(owner: ConversationOwner): Promise<{ records: LessonConversation[]; damaged: string[] }> {
    return this.serialize(async () => {
      const directory = this.directory(this.parseOwner(owner))
      const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      const records: LessonConversation[] = [], damaged: string[] = []
      for (const name of names) {
        if (name.endsWith('.damaged')) { damaged.push(name); continue }
        if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
        try { records.push(await this.read(owner, name.slice(0, -5))) }
        catch { await fs.rename(path.join(directory, name), path.join(directory, `${name}.damaged`)); damaged.push(name) }
      }
      return { records: records.sort((a, b) => a.createdAt - b.createdAt), damaged }
    })
  }
  attachSession(owner: ConversationOwner, conversationId: string, sessionId: string, expectedEpoch: number): Promise<LessonConversation> {
    return this.serialize(async () => {
      z.uuid().parse(sessionId)
      const record = await this.read(owner, conversationId)
      if (record.epoch !== expectedEpoch) throw new Error('对话目标已失效')
      if (!record.sessionIds.includes(sessionId)) record.sessionIds.push(sessionId)
      record.updatedAt = Date.now(); await this.write(record); return record
    })
  }
  bindFirstProject(owner: ConversationOwner, conversationId: string, projectTarget: WorkspaceIdentityV1): Promise<LessonConversation> {
    return this.serialize(async () => {
      const record = await this.read(owner, conversationId)
      if (record.projectTarget && workspaceIdentityKey(record.projectTarget) !== workspaceIdentityKey(projectTarget)) throw new Error('另存工程需要新对话')
      if (!record.projectTarget) { record.projectTarget = projectTarget; record.epoch++; record.updatedAt = Date.now(); await this.write(record) }
      return record
    })
  }
  listAll(): Promise<LessonConversation[]> {
    return this.serialize(async () => {
      const records: LessonConversation[] = []
      for (const leaf of ['lesson-conversations', 'workspace-conversations', 'project-conversations']) {
        const root = path.join(this.userData, leaf, 'v1')
        const directories = await fs.readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
        for (const directory of directories.filter(value => value !== 'v1')) {
          const folder = path.join(root, directory)
          if (!(await fs.lstat(folder)).isDirectory()) continue
          for (const name of await fs.readdir(folder)) {
            if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
            try { records.push(lessonConversationSchema.parse(JSON.parse(await fs.readFile(path.join(folder, name), 'utf8')))) } catch { /* Damaged records are removed only by the explicit all-records operation. */ }
          }
        }
      }
      return records
    })
  }
  clearAllRecords(): Promise<void> {
    return this.serialize(async () => {
      const ownerRoot = path.resolve(this.userData)
      for (const leaf of ['lesson-conversations', 'workspace-conversations', 'project-conversations']) {
        const target = path.resolve(ownerRoot, leaf, 'v1')
        if (!target.startsWith(ownerRoot + path.sep)) throw new Error('Invalid conversation record root')
        await fs.rm(target, { recursive: true, force: true })
      }
    })
  }
  /** Call only after workspace service confirms the old directory no longer exists. */
  relocate(previous: LessonIdentity, next: LessonIdentity): Promise<void> {
    return this.serialize(async () => {
      lessonIdentitySchema.parse(previous); lessonIdentitySchema.parse(next)
      if (previous.lessonId !== next.lessonId) throw new Error('移动课例不能更换身份')
      if (previous.normalizedDirectory === next.normalizedDirectory) return
      if (await fs.stat(previous.normalizedDirectory).then(() => true, (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false; throw error
      })) throw new Error('原课例仍存在，不能重关联副本')
      const owner: ConversationOwner = { kind: 'lesson', lesson: previous }
      const names = await fs.readdir(this.directory(owner)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      for (const name of names) {
        if (!name.endsWith('.json') || !z.uuid().safeParse(name.slice(0, -5)).success) continue
        const record = await this.read(owner, name.slice(0, -5))
        record.owner = { kind: 'lesson', lesson: next }
        record.lesson = undefined
        record.epoch++; record.updatedAt = Date.now()
        if (record.projectTarget) {
          const relative = path.relative(previous.normalizedDirectory, record.projectTarget.normalizedPath)
          if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
            record.projectTarget = { ...record.projectTarget, normalizedPath: path.join(next.normalizedDirectory, relative).replace(/\\/g, '/') }
          }
        }
        // Old project target/CLI handles must be re-observed by the harness; do not retarget them here.
        await this.write(record)
      }
    })
  }
  /** The callback must invalidate/cancel referenced harness sessions before any metadata is removed. */
  delete(owner: ConversationOwner, conversationId: string | undefined,
    stopSessions: (sessionIds: string[]) => Promise<void>): Promise<void> {
    return this.serialize(async () => {
      if (conversationId) z.uuid().parse(conversationId)
      const parsed = this.parseOwner(owner)
      const directory = this.directory(parsed)
      const names = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      for (const name of names) {
        const id = name.replace(/\.json(?:\.damaged)?$/, '')
        if (!z.uuid().safeParse(id).success || (conversationId && id !== conversationId)) continue
        if (name.endsWith('.json')) {
          const record = await this.read(parsed, id)
          record.epoch++; await this.write(record)
          await stopSessions(record.sessionIds)
        }
        await fs.rm(path.join(directory, name), { force: true })
      }
    })
  }
}
