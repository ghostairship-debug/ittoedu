import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { deserialize, serialize } from 'node:v8'
import type { OfficeHistoryEntry, OfficeHistorySnapshot } from '../../shared/workbench/officeFiles'

export interface ArtifactHistoryChange { before: Uint8Array; after: Uint8Array; entry: OfficeHistoryEntry; historyGroup?: string }
export interface ArtifactHistorySequence {
  offset: number
  branchOffset: number
  past: readonly ArtifactHistoryChange[]
  future: readonly ArtifactHistoryChange[]
}
export interface ArtifactHistorySnapshot extends OfficeHistorySnapshot { headGroup?: string }
export interface ArtifactHistoryMetadata {
  actor: OfficeHistoryEntry['actor']; label: string; operationId?: string
  historyGroup?: string
  sequence?: ArtifactHistorySequence
}
export interface OfficeDraftRecovery {
  baseVersion: string
  original: Uint8Array
  bytes: Uint8Array
  offset: number
  branchOffset: number
  past: ArtifactHistoryChange[]
  future: ArtifactHistoryChange[]
}
type HistoryAction = 'push' | 'undo' | 'redo'
interface StoredEntry extends OfficeHistoryEntry { before: string; after: string; historyGroup?: string }
type PendingHistory = { token: string; before: string; after: string } & (
  { action: HistoryAction; entry: StoredEntry } | { action: 'sequence'; past: StoredEntry[]; future: StoredEntry[] })
interface HistoryRecord {
  version: 1; path: string; head: string; past: StoredEntry[]; future: StoredEntry[]
  pending?: PendingHistory
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
  async persistOfficeDraft(filename: string, draft: OfficeDraftRecovery): Promise<void> {
    await this.atomic(this.filename(filename) + '.office-draft', serialize({ version: 1, path: filename, ...draft }))
  }
  async readOfficeDraft(filename: string): Promise<OfficeDraftRecovery | undefined> {
    try {
      const record = deserialize(await fs.readFile(this.filename(filename) + '.office-draft')) as OfficeDraftRecovery & { version: number; path: string }
      if (record.version !== 1 || canonical(record.path) !== canonical(filename)
        || typeof record.baseVersion !== 'string' || !(record.original instanceof Uint8Array) || !(record.bytes instanceof Uint8Array)
        || !Number.isSafeInteger(record.offset) || !Number.isSafeInteger(record.branchOffset)
        || !Array.isArray(record.past) || !Array.isArray(record.future)) throw new Error('Office 恢复稿格式无效')
      const { baseVersion, original, bytes, offset, branchOffset, past, future } = record
      return { baseVersion, original, bytes, offset, branchOffset, past, future }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  async removeOfficeDraft(filename: string): Promise<void> {
    await fs.rm(this.filename(filename) + '.office-draft', { force: true })
  }
  /** A vacant filesystem destination can still belong to an unsaved prior draft. */
  async assertNoOfficeDraftAt(destination: string, directory: boolean): Promise<void> {
    let names: string[]
    try { names = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of names.filter(value => /^[a-f0-9]{64}\.json\.office-draft$/.test(value))) {
      const value = deserialize(await fs.readFile(path.join(this.directory, name))) as { path?: unknown }
      if (typeof value?.path !== 'string' || !path.isAbsolute(value.path)) throw new Error('Office 恢复稿路径记录损坏；已保留恢复稿')
      const relative = path.relative(canonical(destination), canonical(value.path))
      if (relative === '' || directory && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        throw new Error(`目标位置存在尚未处理的 Office 恢复稿，文件未移动：${value.path}`)
    }
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
      && (entry.historyGroup === undefined || entry.actor === 'ai' && typeof entry.historyGroup === 'string')
    if (record.version !== 1 || typeof record.path !== 'string' || canonical(record.path) !== canonical(filename)
      || !validHash(record.head) || !Array.isArray(record.past) || !Array.isArray(record.future)
      || !record.past.every(entryValid) || !record.future.every(entryValid)
      || record.pending && (typeof record.pending.token !== 'string' || (record.pending.action === 'sequence'
        ? !Array.isArray(record.pending.past) || !Array.isArray(record.pending.future)
          || !record.pending.past.every(entryValid) || !record.pending.future.every(entryValid)
        : !['push', 'undo', 'redo'].includes(record.pending.action) || !entryValid(record.pending.entry))
        || !validHash(record.pending.before) || !validHash(record.pending.after))) throw new Error('文件历史记录无效；已保留原始历史')
    return record
  }
  private finish(record: HistoryRecord): HistoryRecord {
    const pending = record.pending
    if (!pending) return record
    if (pending.action === 'sequence') { record.past = pending.past; record.future = pending.future }
    else if (pending.action === 'push') { record.past.push(pending.entry); record.future = [] }
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
  private moveCursor(record: HistoryRecord, offset: number): void {
    const source = offset < 0 ? record.past : record.future, destination = offset < 0 ? record.future : record.past
    for (let index = 0; index < Math.abs(offset); index++) {
      const entry = source.pop()
      if (!entry) throw new Error(offset < 0 ? '没有可撤销的文件修改' : '没有可重做的文件修改')
      destination.push(entry)
      record.head = offset < 0 ? entry.before : entry.after
    }
  }
  async snapshot(filename: string, bytes: Uint8Array, offset = 0): Promise<ArtifactHistorySnapshot> {
    const record = await this.read(filename, bytes)
    if (record.head !== digest(bytes)) return { undoDepth: 0, redoDepth: 0, entries: [], notice: '文件已在外部修改，旧撤销链已保留；新的修改会建立当前版本的历史。' }
    this.moveCursor(record, offset)
    const headGroup = record.past.at(-1)?.historyGroup
    return { undoDepth: record.past.length, redoDepth: record.future.length,
      entries: record.past.map(({ id, actor, label, at }) => ({ id, actor, label, at })), ...(headGroup ? { headGroup } : {}) }
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
    if (metadata.sequence) {
      const { offset, branchOffset, past, future } = metadata.sequence
      const candidate = { ...record, past: [...record.past], future: [...record.future] }
      this.moveCursor(candidate, offset)
      if (past.length || future.length) {
        let head = candidate.head
        if (offset === 0) await this.put(before)
        const persist = async ({ before, after, entry, historyGroup }: ArtifactHistoryChange) => {
          if (digest(before) !== head) throw new Error('草稿历史链与保存版本不一致')
          const afterHash = await this.put(after)
          const result = { ...entry, before: head, after: afterHash, ...(historyGroup ? { historyGroup } : {}) }
          head = afterHash
          return result
        }
        for (const change of past) candidate.past.push(await persist(change))
        candidate.head = head
        // The draft can have moved back past its branch point. Redo first
        // follows the saved prefix to that point, then the edited draft branch.
        const distance = future.length ? branchOffset - offset : 0
        if (distance < 0 || distance > candidate.future.length || distance && past.length)
          throw new Error('草稿重做分支与保存版本不一致')
        const prefix = distance ? candidate.future.slice(-distance) : []
        head = prefix[0]?.after ?? head
        const stagedFuture: StoredEntry[] = []
        for (const change of [...future].reverse()) stagedFuture.unshift(await persist(change))
        candidate.future = [...stagedFuture, ...prefix]
      }
      if (candidate.head !== afterHash) throw new Error('草稿历史最终版本与保存内容不一致')
      const token = randomUUID()
      record.pending = { token, action: 'sequence', before: beforeHash, after: afterHash, past: candidate.past, future: candidate.future }
      await this.write(record)
      return token
    }
    await this.put(before); await this.put(after)
    const historyGroup = metadata.actor === 'ai' ? metadata.historyGroup : undefined
    const previous = record.past.at(-1)
    const token = randomUUID()
    if (historyGroup && previous?.historyGroup === historyGroup && !record.future.length) {
      const past = [...record.past.slice(0, -1), { ...previous, after: afterHash }]
      record.pending = { token, action: 'sequence', before: beforeHash, after: afterHash, past, future: [] }
      await this.write(record)
      return token
    }
    const entry: StoredEntry = { id: metadata.operationId ?? randomUUID(), actor: metadata.actor, label: metadata.label,
      at: new Date().toISOString(), before: beforeHash, after: afterHash, ...(historyGroup ? { historyGroup } : {}) }
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
  async readAtOffset(filename: string, current: Uint8Array, offset: number): Promise<Uint8Array> {
    const record = await this.read(filename, current)
    if (record.head !== digest(current)) throw new Error('文件已在外部修改，不能使用旧历史')
    this.moveCursor(record, offset)
    if (offset === 0) return current
    const bytes = await fs.readFile(this.blob(record.head))
    if (digest(bytes) !== record.head) throw new Error('文件历史快照损坏；原件未修改')
    return Uint8Array.from(bytes)
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
    let record: HistoryRecord | undefined
    try { record = this.validate(JSON.parse(await fs.readFile(this.filename(before), 'utf8')), before) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const draft = await this.readOfficeDraft(before)
    if (!record && !draft) return
    // A vacant user-file path can still have history from an earlier occupant.
    // Preserve that record before replacing the path's active history, including
    // on a retry after publication of the destination but before source removal.
    const preserveDestination = async (destination: string) => {
      let previous: Uint8Array | undefined
      try { previous = await fs.readFile(destination) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (previous) await this.atomic(`${destination}.branch-${randomUUID()}`, previous)
    }
    if (record) {
      await preserveDestination(this.filename(after))
      await this.write({ ...record, path: after })
    }
    if (draft) {
      const destination = this.filename(after) + '.office-draft'
      const intended = serialize({ version: 1, path: after, ...draft })
      let previous: Buffer | undefined
      try { previous = await fs.readFile(destination) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (previous && !previous.equals(intended)) throw new Error('目标 Office 恢复稿已存在或在移动后改变；两份恢复稿均已保留')
      if (!previous) await this.atomic(destination, intended)
    }
    // Keep both source records until every destination record is durable.
    if (record) await fs.rm(this.filename(before), { force: true })
    if (draft) await this.removeOfficeDraft(before)
  }
  /** Relocations also cover documents not opened since the last application restart. */
  async relocateMatching(destinationFor: (filename: string) => string | null | undefined): Promise<void> {
    let entries: string[]
    try { entries = await fs.readdir(this.directory) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    const paths = new Set<string>()
    for (const name of entries.filter(name => /^[a-f0-9]{64}\.json(?:\.office-draft)?$/.test(name))) {
      const bytes = await fs.readFile(path.join(this.directory, name))
      const value: unknown = name.endsWith('.office-draft') ? deserialize(bytes) : JSON.parse(bytes.toString('utf8'))
      if (!value || typeof value !== 'object' || typeof (value as HistoryRecord).path !== 'string') throw new Error('文件历史路径记录损坏；已保留历史')
      paths.add((value as HistoryRecord).path)
    }
    for (const before of paths) {
      const after = destinationFor(before)
      if (after) await this.relocate(before, after)
    }
  }
}
