import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'
import { executionContentOutputSchema } from '../../../shared/workbench/executionDesktop'

const writes = new Map<string, Promise<unknown>>()
const fileKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)

/** Engine checkpoints only; an unavailable record never becomes an empty replacement run. */
export class ExecutionRunStore {
  private readonly unavailable = new Map<string, string>()
  constructor(private readonly directory: string) {}
  get recoveryIssues(): string[] { return [...this.unavailable.values()] }
  private file(runId: string): string {
    if (!runId || runId.length > 512) throw new Error('运行编号无效')
    return path.join(this.directory, `${createHash('sha256').update(runId).digest('hex')}.json`)
  }
  private parse(bytes: string, filename: string, expected?: string): ExecutionRunRecord {
    const value = JSON.parse(bytes) as ExecutionRunRecord
    if (value.schemaVersion !== 1 || expected && value.runId !== expected || !Number.isSafeInteger(value.version)
      || !value.input || typeof value.input.conversationId !== 'string' || !Array.isArray(value.input.documents)
      || !Array.isArray(value.messages) || !Array.isArray(value.tools) || !Array.isArray(value.requests)
      || path.basename(this.file(value.runId)) !== path.basename(filename)) throw new Error('运行恢复记录无效')
    if (value.input.contentOutput) executionContentOutputSchema.parse(value.input.contentOutput)
    return value
  }
  save(record: ExecutionRunRecord): Promise<void> {
    const copy = structuredClone(record), filename = this.file(copy.runId), key = fileKey(filename)
    const operation = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      await fs.mkdir(this.directory, { recursive: true })
      const temporary = `${filename}.${randomUUID()}.tmp`
      try {
        const file = await fs.open(temporary, 'wx')
        try { await file.writeFile(JSON.stringify(copy)); await file.sync() } finally { await file.close() }
        await fs.rename(temporary, filename)
        this.unavailable.delete(filename)
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    })
    const tail = operation.catch(() => undefined)
    writes.set(key, tail)
    void tail.finally(() => { if (writes.get(key) === tail) writes.delete(key) })
    return operation
  }
  async read(runId: string): Promise<ExecutionRunRecord | null> {
    const filename = this.file(runId)
    await writes.get(fileKey(filename))
    try {
      const value = this.parse(await fs.readFile(filename, 'utf8'), filename, runId)
      this.unavailable.delete(filename)
      return value
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
      const message = `一份历史运行记录无法读取，原文件保留：${path.basename(filename)}`
      this.unavailable.set(filename, message)
      throw new Error(message, { cause })
    }
  }
  async list(): Promise<ExecutionRunRecord[]> {
    await Promise.all([...writes].filter(([name]) => fileKey(path.dirname(name)) === fileKey(this.directory)).map(([, promise]) => promise))
    let names: string[]
    try { names = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const values: ExecutionRunRecord[] = []
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const filename = path.join(this.directory, name)
      try {
        values.push(this.parse(await fs.readFile(filename, 'utf8'), filename))
        this.unavailable.delete(filename)
      } catch {
        this.unavailable.set(filename, `一份历史运行记录无法读取，原文件保留：${name}`)
      }
    }
    for (const filename of this.unavailable.keys()) if (!names.includes(path.basename(filename))) this.unavailable.delete(filename)
    return values
  }
  /** Only Main's explicit task-continuation links confer export ownership; ordinary conversation history does not. */
  async taskLineage(runId: string): Promise<string[]> {
    const first = await this.read(runId)
    if (!first) return [runId]
    const ids = [runId], seen = new Set(ids)
    let parent = first.taskContinuedFrom
    while (parent) {
      if (seen.has(parent)) throw new Error('任务续接链存在循环')
      const record = await this.read(parent)
      if (!record || record.input.conversationId !== first.input.conversationId
        || ['queued', 'running', 'stopping'].includes(record.status)) throw new Error('原任务归属无法核实，未覆盖旧导出')
      ids.push(parent); seen.add(parent); parent = record.taskContinuedFrom
    }
    return ids
  }
}
