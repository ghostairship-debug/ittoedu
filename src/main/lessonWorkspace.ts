import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { lessonManifestSchema, lessonIdentitySchema, lessonDocumentRoleSchema, lessonRelativePathSchema, type LessonIdentity, type LessonManifest, type LessonWorkspace } from '../shared/lessonWorkspace'
import { withCopiedMaterialOwnership } from './lessonMaterials'
import { createWorkspaceIdentity } from './workspaceIdentity'

const manifestPath = (directory: string) => path.join(directory, '.courseware', 'lesson.json')
export class LessonWorkspaceService {
  private static readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly userData: string) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.userData), previous = LessonWorkspaceService.queues.get(key) ?? Promise.resolve()
    const result = previous.then(action, action); LessonWorkspaceService.queues.set(key, result.catch(() => {})); return result
  }
  private async identity(directory: string, lessonId: string): Promise<LessonIdentity> {
    return lessonIdentitySchema.parse({ schemaVersion: 1, lessonId,
      normalizedDirectory: createWorkspaceIdentity(lessonId, await fs.realpath(directory)).normalizedPath })
  }
  private async register(identity: LessonIdentity): Promise<LessonIdentity | undefined> {
    const root = path.join(this.userData, 'lesson-locations', 'v1')
    await fs.mkdir(root, { recursive: true })
    const destination = path.join(root, `${identity.lessonId}.json`)
    let previous: LessonIdentity | undefined
    try { previous = lessonIdentitySchema.parse(JSON.parse(await fs.readFile(destination, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (previous && previous.normalizedDirectory !== identity.normalizedDirectory) {
      const exists = await fs.stat(previous.normalizedDirectory).then(() => true, error => {
        if (error.code === 'ENOENT') return false; throw error
      })
      if (exists) throw new Error('LESSON_COPY_REQUIRED: 原课例仍存在，请作为副本打开')
    }
    await this.atomicWrite(destination, identity)
    return previous && previous.normalizedDirectory !== identity.normalizedDirectory ? previous : undefined
  }
  private async atomicWrite(destination: string, value: unknown): Promise<void> {
    const temporary = `${destination}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' }); await fs.rename(temporary, destination) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  create(parentDirectory: string, name: string): Promise<LessonWorkspace> {
    return this.serialize(async () => {
      if (!name.trim() || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name === '.' || name === '..' || /[. ]$/.test(name)) throw new Error('课例名称无效')
      const parent = await fs.realpath(parentDirectory), directory = path.join(parent, name)
      await fs.mkdir(directory) // Exclusive: never overwrite an existing teacher directory.
      const manifest = lessonManifestSchema.parse({ schemaVersion: 1, lessonId: randomUUID(), title: name, documents: {} })
      try {
        await fs.mkdir(path.dirname(manifestPath(directory)))
        await fs.writeFile(manifestPath(directory), JSON.stringify(manifest, null, 2), { flag: 'wx' })
        const identity = await this.identity(directory, manifest.lessonId)
        await this.register(identity)
        return { identity, manifest }
      } catch (error) {
        // Only remove our own marker and empty directories; never recurse through user files.
        await fs.rm(manifestPath(directory), { force: true }).catch(() => {})
        await fs.rmdir(path.dirname(manifestPath(directory))).catch(() => {})
        await fs.rmdir(directory).catch(() => {})
        throw error
      }
    })
  }
  open(directory: string, options: { asCopy?: boolean } = {}): Promise<LessonWorkspace & { previousIdentity?: LessonIdentity }> {
    return this.serialize(async () => {
      const realDirectory = await fs.realpath(directory)
      if (!(await fs.stat(realDirectory)).isDirectory()) throw new Error('请选择课例目录')
      const filename = manifestPath(realDirectory)
      let manifest: LessonManifest
      try { manifest = lessonManifestSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8'))) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        manifest = lessonManifestSchema.parse({ schemaVersion: 1, lessonId: randomUUID(), title: path.basename(realDirectory), documents: {} })
        await fs.mkdir(path.dirname(filename), { recursive: true })
        await fs.writeFile(filename, JSON.stringify(manifest, null, 2), { flag: 'wx' })
      }
      if (options.asCopy) {
        const registered = lessonIdentitySchema.parse(JSON.parse(await fs.readFile(path.join(this.userData, 'lesson-locations', 'v1', `${manifest.lessonId}.json`), 'utf8')))
        const candidateIdentity = await this.identity(realDirectory, manifest.lessonId)
        if (registered.normalizedDirectory === candidateIdentity.normalizedDirectory) throw new Error('不能把原课例作为自身副本打开')
        const originalManifest = await fs.readFile(filename)
        const statePath = path.join(realDirectory, '.courseware', 'authoring-state.json')
        const originalState = await fs.readFile(statePath).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
        const copiedManifest = { ...manifest, lessonId: randomUUID() }
        const identity = await this.identity(realDirectory, copiedManifest.lessonId)
        return withCopiedMaterialOwnership(realDirectory, manifest.lessonId, copiedManifest.lessonId, async () => {
          try {
            // The manifest commits last after all copied material ownership is ready.
            await fs.rm(statePath, { force: true })
            await this.atomicWrite(filename, copiedManifest)
            await this.register(identity)
            return { identity, manifest: copiedManifest }
          } catch (error) {
            const restore = async (destination: string, bytes: Uint8Array) => {
              const temporary = `${destination}.rollback-${randomUUID()}.pending`
              await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, destination)
            }
            const failures: unknown[] = [error]
            for (const [destination, bytes] of [[filename, originalManifest], ...(originalState ? [[statePath, originalState]] : [])] as [string, Uint8Array][]) {
              try { await restore(destination, bytes) } catch (rollbackError) { failures.push(rollbackError) }
            }
            await fs.rm(path.join(this.userData, 'lesson-locations', 'v1', identity.lessonId + '.json'), { force: true }).catch(rollbackError => failures.push(rollbackError))
            if (failures.length > 1) throw new AggregateError(failures, '课例副本身份提交失败，回滚未完整完成')
            throw error
          }
        })
      }
      const identity = await this.identity(realDirectory, manifest.lessonId)
      const previousIdentity = await this.register(identity)
      return { identity, manifest, ...(previousIdentity ? { previousIdentity } : {}) }
    })
  }
  async read(input: LessonIdentity): Promise<LessonWorkspace> {
    const identity = lessonIdentitySchema.parse(input)
    const actualIdentity = await this.identity(identity.normalizedDirectory, identity.lessonId)
    if (actualIdentity.normalizedDirectory !== identity.normalizedDirectory) throw new Error('课例真实目录已变化，请重新打开')
    const manifest = lessonManifestSchema.parse(JSON.parse(await fs.readFile(manifestPath(identity.normalizedDirectory), 'utf8')))
    if (manifest.lessonId !== identity.lessonId) throw new Error('课例身份已变化，请重新打开')
    return { identity: await this.identity(identity.normalizedDirectory, manifest.lessonId), manifest }
  }
  registerDocument(input: LessonIdentity, role: 'teaching-brief' | 'teaching-plan' | 'presentation-brief' | 'presentation-script', relativePath: string): Promise<LessonWorkspace> {
    return this.serialize(async () => {
      lessonDocumentRoleSchema.parse(role); lessonRelativePathSchema.parse(relativePath)
      const lesson = await this.read(input)
      const target = await fs.realpath(path.join(lesson.identity.normalizedDirectory, relativePath))
      const relative = path.relative(lesson.identity.normalizedDirectory, target)
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await fs.stat(target)).isFile()) throw new Error('文档不在课例真实目录内')
      const manifest = lessonManifestSchema.parse({ ...lesson.manifest, documents: { ...lesson.manifest.documents, [role]: relativePath } })
      await this.atomicWrite(manifestPath(lesson.identity.normalizedDirectory), manifest)
      return { ...lesson, manifest }
    })
  }
  bindProject(input: LessonIdentity, absolutePath: string): Promise<LessonWorkspace> {
    return this.serialize(async () => {
      const lesson = await this.read(input)
      const realFile = await fs.realpath(absolutePath)
      const relative = path.relative(await fs.realpath(lesson.identity.normalizedDirectory), realFile).replace(/\\/g, '/')
      if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return lesson
      const manifest = lessonManifestSchema.parse({ ...lesson.manifest, coursePath: relative })
      await this.atomicWrite(manifestPath(lesson.identity.normalizedDirectory), manifest)
      return { ...lesson, manifest }
    })
  }
  async list(workspaceDirectory: string): Promise<LessonWorkspace[]> {
    const workspace = await fs.realpath(workspaceDirectory)
    const root = path.join(this.userData, 'lesson-locations', 'v1')
    const names = await fs.readdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
    const result: LessonWorkspace[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const identity = lessonIdentitySchema.parse(JSON.parse(await fs.readFile(path.join(root, name), 'utf8')))
        const relative = path.relative(workspace, identity.normalizedDirectory)
        if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) result.push(await this.read(identity))
      } catch { /* One missing or damaged lesson does not hide its neighbours. */ }
    }
    return result
  }
}
