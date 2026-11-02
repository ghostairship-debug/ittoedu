import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { OfficeHistoryEntry, OfficeHistorySnapshot } from '../../shared/workbench/officeFiles'

export interface ArtifactHistoryMetadata { actor: OfficeHistoryEntry['actor']; label: string; operationId?: string }
type HistoryAction = 'push' | 'undo' | 'redo'
interface StoredEntry extends OfficeHistoryEntry { before: string; after: string }
interface HistoryRecord {
  version: 1; path: string; head: string; past: StoredEntry[]; future: StoredEntry[]
  pending?: { token: string; action: HistoryAction; entry: StoredEntry; before: string; after: string }
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const canonical = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

/** Journals the existing binary file owner's accepted writes; it never writes user files. */
export class FileArtifactHistory {
  constructor(private readonly directory: string) {}
  private filename(filename: string): string {
    return path.join(this.directory, `${createHash('sha256').update(canonical(filename)).digest('hex')}.json`)
  }
  private blob(hash: string): string {
    if (!validHash(hash)) throw new Error('文件历史的内容身份无效')
    return path.join(this.directory, 'content', `${hash}.bin`)
  }
  private async atomic(filename: string, bytes: string | Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(filename), { recursive: true })
    const temporary = `${filename}.${randomUUID()}.tmp`
    try {
      const handle = await fs.open(temporary, 'wx')
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      await fs.rename(temporary, filename)
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  private async write(record: HistoryRecord): Promise<void> {
    await this.atomic(this.filename(record.path), JSON.stringify(record))
  }
  private async put(bytes: Uint8Array): Promise<string> {
    const hash = digest(bytes), filename = this.blob(hash)
    try {
      const present = await fs.readFile(filename)
      if (digest(present) !== hash) throw new Error('文件历史快照损坏；原件未修改')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await this.atomic(filename, bytes)
    }
    return hash
  }
  private validate(value: unknown, filename: string): HistoryRecord {
    if (!value || typeof value !== 'object') throw new Error('文件历史记录不可读；已保留原始历史')
    const record = value as HistoryRecord
    const entryValid = (entry: StoredEntry) => entry && typeof entry.id === 'string' && typeof entry.label === 'string'
      && typeof entry.at === 'string' && ['human', 'ai'].includes(entry.actor) && validHash(entry.before) && validHash(entry.after)
    if (record.version !== 1 || typeof record.path !== 'string' || canonical(record.path) !== canonical(filename)
      || !validHash(record.head) || !Array.isArray(record.past) || !Array.isArray(record.future)
      || !record.past.every(entryValid) || !record.future.every(entryValid)
      || record.pending && (typeof record.pending.token !== 'string' || !['push', 'undo', 'redo'].includes(record.pending.action) || !entryValid(record.pending.entry)
        || !validHash(record.pending.before) || !validHash(record.pending.after))) throw new Error('文件历史记录无效；已保留原始历史')
    return record
  }
  private finish(record: HistoryRecord): HistoryRecord {
    const pending = record.pending
    if (!pending) return record
    if (pending.action === 'push') { record.past.push(pending.entry); record.future = [] }
    else if (pending.action === 'undo') {
      if (record.past.at(-1)?.id !== pending.entry.id) throw new Error('撤销历史头已改变')
      record.past.pop(); record.future.push(pending.entry)
    } else {
      if (record.future.at(-1)?.id !== pending.entry.id) throw new Error('重做历史头已改变')
      record.future.pop(); record.past.push(pending.entry)
    }
    record.head = pending.after; delete record.pending
    return record
  }
  private async read(filename: string, bytes: Uint8Array): Promise<HistoryRecord> {
    let record: HistoryRecord
    try { record = this.validate(JSON.parse(await fs.readFile(this.filename(filename), 'utf8')), filename) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { version: 1, path: filename, head: digest(bytes), past: [], future: [] }
    }
    if (record.pending) {
      const actual = digest(bytes)
      if (actual === record.pending.after) { this.finish(record); await this.write(record) }
      else if (actual === record.pending.before) { delete record.pending; await this.write(record) }
      else throw new Error('上次文件修改结果与磁盘不一致；请保留原件并核对，不能自动重放或撤销')
    }
    return record
  }
  async snapshot(filename: string, bytes: Uint8Array): Promise<OfficeHistorySnapshot> {
    const record = await this.read(filename, bytes)
    if (record.head !== digest(bytes)) return { undoDepth: 0, redoDepth: 0, entries: [], notice: '文件已在外部修改，旧撤销链已保留；新的修改会建立当前版本的历史。' }
    return { undoDepth: record.past.length, redoDepth: record.future.length,
      entries: record.past.map(({ id, actor, label, at }) => ({ id, actor, label, at })) }
  }
  async prepareWrite(filename: string, before: Uint8Array, after: Uint8Array, metadata: ArtifactHistoryMetadata): Promise<string | undefined> {
    let record = await this.read(filename, before)
    const beforeHash = digest(before), afterHash = digest(after)
    if (record.head !== beforeHash) {
      // An external edit starts a new branch; retain the old record and all its content snapshots.
      await this.atomic(`${this.filename(filename)}.branch-${randomUUID()}`, JSON.stringify(record))
      record = { version: 1, path: filename, head: beforeHash, past: [], future: [] }
    }
    if (beforeHash === afterHash) return
    await this.put(before); await this.put(after)
    const entry: StoredEntry = { id: metadata.operationId ?? randomUUID(), actor: metadata.actor, label: metadata.label,
      at: new Date().toISOString(), before: beforeHash, after: afterHash }
    const token = randomUUID()
    record.pending = { token, action: 'push', entry, before: beforeHash, after: afterHash }
    await this.write(record)
    return token
  }
  async prepareMove(filename: string, current: Uint8Array, action: 'undo' | 'redo'): Promise<{ bytes: Uint8Array; token: string }> {
    const record = await this.read(filename, current), actual = digest(current)
    if (record.head !== actual) throw new Error('文件已在外部修改，不能用旧历史覆盖；请重新读取当前版本')
    const entry = (action === 'undo' ? record.past : record.future).at(-1)
    if (!entry) throw new Error(action === 'undo' ? '没有可撤销的文件修改' : '没有可重做的文件修改')
    const hash = action === 'undo' ? entry.before : entry.after
    const bytes = await fs.readFile(this.blob(hash))
    if (digest(bytes) !== hash) throw new Error('文件历史快照损坏；原件未修改')
    const token = randomUUID()
    record.pending = { token, action, entry, before: actual, after: hash }
    await this.write(record)
    return { bytes: Uint8Array.from(bytes), token }
  }
  /** The physical owner calls this only after a known pre-publication failure. */
  async cancelPrepared(filename: string, token: string | undefined): Promise<void> {
    if (!token) return
    const record = this.validate(JSON.parse(await fs.readFile(this.filename(filename), 'utf8')), filename)
    if (record.pending?.token !== token) return
    delete record.pending
    await this.write(record)
  }
  async confirm(filename: string, bytes: Uint8Array): Promise<void> {
    const record = await this.read(filename, bytes)
    if (record.head !== digest(bytes)) throw new Error('文件历史提交未确认，请重新读取原件')
  }
  async relocate(before: string, after: string): Promise<void> {
    if (canonical(before) === canonical(after)) return
    let record: HistoryRecord
    try { record = this.validate(JSON.parse(await fs.readFile(this.filename(before), 'utf8')), before) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    // A vacant user-file path can still have history from an earlier occupant.
    // Preserve that record before replacing the path's active history, including
    // on a retry after publication of the destination but before source removal.
    const destination = this.filename(after)
    let previous: Uint8Array | undefined
    try { previous = await fs.readFile(destination) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (previous) await this.atomic(`${destination}.branch-${randomUUID()}`, previous)
    record.path = after
    await this.write(record)
    await fs.rm(this.filename(before), { force: true })
  }
  /** Relocations also cover documents not opened since the last application restart. */
  async relocateMatching(destinationFor: (filename: string) => string | null | undefined): Promise<void> {
    let entries: string[]
    try { entries = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of entries.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const value: unknown = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'))
      if (!value || typeof value !== 'object' || typeof (value as HistoryRecord).path !== 'string') throw new Error('文件历史路径记录损坏；已保留历史')
      const before = (value as HistoryRecord).path, after = destinationFor(before)
      if (after) await this.relocate(before, after)
    }
  }
}
