import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ExecutionRunRecord } from '../../../shared/workbench/execution'

/** Engine checkpoint only. Document content/History and timeline events have their own canonical owners. */
export class ExecutionRunStore {
  private tail: Promise<unknown> = Promise.resolve()
  constructor(private readonly directory: string) {}
  private file(runId: string): string {
    if (!runId || runId.length > 512) throw new Error('运行编号无效')
    return path.join(this.directory, `${createHash('sha256').update(runId).digest('hex')}.json`)
  }
  save(record: ExecutionRunRecord): Promise<void> {
    const copy = structuredClone(record)
    const operation = this.tail.catch(() => undefined).then(async () => {
      const filename = this.file(copy.runId)
      await fs.mkdir(this.directory, { recursive: true })
      const temporary = `${filename}.${randomUUID()}.tmp`
      try {
        const file = await fs.open(temporary, 'wx')
        try { await file.writeFile(JSON.stringify(copy)); await file.sync() } finally { await file.close() }
        await fs.rename(temporary, filename)
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
    })
    this.tail = operation
    return operation
  }
  async read(runId: string): Promise<ExecutionRunRecord | null> {
    // A rejected write must not hide the previous complete checkpoint.
    await this.tail.catch(() => undefined)
    let bytes: string
    try { bytes = await fs.readFile(this.file(runId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const value = JSON.parse(bytes) as ExecutionRunRecord
    if (value.schemaVersion !== 1 || value.runId !== runId || !Number.isSafeInteger(value.version)
      || !Array.isArray(value.messages) || !Array.isArray(value.tools) || !Array.isArray(value.requests)) throw new Error('运行恢复记录无效')
    return value
  }
  async list(): Promise<ExecutionRunRecord[]> {
    await this.tail.catch(() => undefined)
    let names: string[]
    try { names = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    const values: ExecutionRunRecord[] = []
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
      const parsed = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8')) as ExecutionRunRecord
      if (path.basename(this.file(parsed.runId)) !== name) throw new Error('运行恢复记录身份不匹配')
      const value = await this.read(parsed.runId)
      if (value) values.push(value)
    }
    return values
  }
}
