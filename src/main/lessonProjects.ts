import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { lessonProjectSchema, type LessonProject } from '../shared/lessonWorkspace'
import { normalizeWorkspacePath, workspaceIdentityV1Schema } from '../shared/workspaceIdentity'

const storeSchema = z.object({ version: z.literal(1), items: z.array(lessonProjectSchema).max(500) }).strict()

/** 项目：工作空间内用户指定或新建的真实文件夹注册表（仅登记，不限制文件访问）。 */
export class LessonProjectRegistry {
  private static readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly userData: string) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.userData), previous = LessonProjectRegistry.queues.get(key) ?? Promise.resolve()
    const result = previous.then(action, action); LessonProjectRegistry.queues.set(key, result.catch(() => {})); return result
  }
  private storeFile() { return path.join(this.userData, 'lesson-projects-v1.json') }
  private async readAll(): Promise<LessonProject[]> {
    try { return storeSchema.parse(JSON.parse(await fs.readFile(this.storeFile(), 'utf8'))).items }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  private async writeAll(items: LessonProject[]): Promise<void> {
    const destination = this.storeFile(), temporary = `${destination}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify({ version: 1, items } satisfies z.infer<typeof storeSchema>), { flag: 'wx' }); await fs.rename(temporary, destination) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  normalizePath(value: string): string {
    return normalizeWorkspacePath(value)
  }
  /** 规范化并校验路径落在工作空间根内。 */
  resolveInside(workspaceRoot: string, target: string): string {
    const root = this.normalizePath(workspaceRoot).replace(/\/$/, '')
    const normalized = this.normalizePath(target).replace(/\/$/, '')
    if (normalized === root || normalized.startsWith(`${root}/`)) return normalized
    throw new Error('项目必须位于当前工作空间内')
  }
  list(workspaceRoot: string): Promise<LessonProject[]> {
    return this.serialize(async () => {
      const root = this.normalizePath(workspaceRoot)
      return (await this.readAll()).filter(item => item.workspaceRoot === root)
    })
  }
  /** 新建文件夹项目，或把已有文件夹指定为项目；同名同路径不重复登记。 */
  async designate(workspaceRoot: string, name: string, existingPath?: string): Promise<LessonProject> {
    return this.serialize(async () => {
      const root = this.normalizePath(workspaceRoot)
      const rootReal = await fs.realpath(workspaceRoot)
      let folder: string
      if (existingPath) {
        folder = await fs.realpath(existingPath)
        if (!(await fs.stat(folder)).isDirectory()) throw new Error('请选择文件夹作为项目')
      } else {
        folder = path.join(rootReal, name)
        try { await fs.mkdir(folder) } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('已存在同名文件夹，请直接指定该项目或换一个名称')
          throw error
        }
      }
      const normalizedPath = this.resolveInside(root, folder)
      const items = await this.readAll()
      const existing = items.find(item => item.workspaceRoot === root && item.normalizedPath === normalizedPath)
      if (existing) return existing
      const project = lessonProjectSchema.parse({ schemaVersion: 1, name: name.trim(),
        normalizedPath: workspaceIdentityV1Schema.parse({ version: 1, projectId: 'lesson-project', normalizedPath }).normalizedPath,
        workspaceRoot: workspaceIdentityV1Schema.parse({ version: 1, projectId: 'lesson-project', normalizedPath: root }).normalizedPath,
        createdAt: Date.now() })
      await this.writeAll([...items, project])
      return project
    })
  }
  /** 仅从注册表移除；真实文件夹与其中的文件、会话保持不变。 */
  async remove(workspaceRoot: string, target: string): Promise<LessonProject[]> {
    return this.serialize(async () => {
      const root = this.normalizePath(workspaceRoot)
      const normalizedPath = this.resolveInside(root, target)
      const items = (await this.readAll()).filter(item => !(item.workspaceRoot === root && item.normalizedPath === normalizedPath))
      await this.writeAll(items)
      return items.filter(item => item.workspaceRoot === root)
    })
  }
}
