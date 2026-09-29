import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export interface ChangeReviewCapture {
  schemaVersion: 1
  runId: string
  callId: string
  name: string
  path: string
  /** Deterministic empty text creation only; a generated archive has no predeclared byte identity. */
  expectedCreatedVersion?: string
  before: { kind: 'missing' } | { kind: 'file'; version: string; text: string; mode: number }
    | { kind: 'document'; documentId: string; epoch: string; revision: number }
    | { kind: 'unavailable'; reason: string }
  after?: { version: string; identity?: string; mode?: number; documentId?: string; epoch?: string; revision?: number }
}

/** One durable preparation per tool call. A crash after a write leaves an unverified capture, never a rollback grant. */
export class ChangeReviewStore {
  constructor(private readonly directory: string) {}

  preservationPath(): string { return path.join(this.directory, 'preserved', `${randomUUID()}.bak`) }

  private filename(runId: string, callId: string): string {
    if (!runId || !callId || runId.length > 512 || callId.length > 512) throw new Error('变更审阅编号无效')
    const digest = createHash('sha256').update(`${runId}\0${callId}`).digest('hex')
    return path.join(this.directory, `${digest}.json`)
  }

  async read(runId: string, callId: string): Promise<ChangeReviewCapture | null> {
    let bytes: string
    try { bytes = await fs.readFile(this.filename(runId, callId), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const value = JSON.parse(bytes) as ChangeReviewCapture
    if (value.schemaVersion !== 1 || value.runId !== runId || value.callId !== callId || !value.path || !value.before)
      throw new Error('变更审阅前稿损坏')
    return value
  }

  async save(value: ChangeReviewCapture): Promise<void> {
    const filename = this.filename(value.runId, value.callId)
    await fs.mkdir(this.directory, { recursive: true })
    const temporary = `${filename}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
  }
}
