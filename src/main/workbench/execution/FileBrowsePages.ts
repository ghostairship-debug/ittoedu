import { randomUUID, createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

type Entry = { name: string; kind: 'folder' | 'file' | 'unsupported' }
type Position = { directory: string; offset: number; digest?: string }
interface Cursor { runId: string; root: string; query?: string; queue: Position[]; createdAt: number;
  excludedCount: number; failedCount: number; scannedEntries: number }
const digest = (entries: Entry[]) => createHash('sha256').update(JSON.stringify(entries)).digest('hex')
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'output', '.next', '.cache'])

/** A cursor is an observation position, never file authority. Every directory is revalidated by the caller. */
export class FileBrowsePages {
  private readonly cursors = new Map<string, Cursor>()
  private start(runId: string, root: string, query: string | undefined, cursor?: string): Cursor {
    if (!cursor) return { runId, root, query, queue: [{ directory: root, offset: 0 }], createdAt: Date.now(),
      excludedCount: 0, failedCount: 0, scannedEntries: 0 }
    const saved = this.cursors.get(cursor)
    if (!saved || saved.runId !== runId || saved.root !== root || saved.query !== query || Date.now() - saved.createdAt > 900_000)
      throw new Error('目录分页已失效或不属于本次查询，请从首页重新读取')
    return structuredClone(saved)
  }
  private remember(value: Cursor): string {
    const id = randomUUID()
    while (this.cursors.size >= 128) this.cursors.delete(this.cursors.keys().next().value!)
    this.cursors.set(id, structuredClone(value))
    return id
  }
  private async entries(directory: string): Promise<Entry[]> {
    return (await fs.readdir(directory, { withFileTypes: true })).map(entry => ({ name: entry.name,
      kind: (entry.isSymbolicLink() ? 'unsupported' : entry.isDirectory() ? 'folder' : entry.isFile() ? 'file' : 'unsupported') as Entry['kind'] }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name))
  }
  async list(runId: string, directory: string, limit: number, cursor?: string) {
    const state = this.start(runId, directory, undefined, cursor), position = state.queue[0]!
    const entries = await this.entries(directory), current = digest(entries)
    if (position.digest && position.digest !== current) throw new Error('目录内容已改变，不能拼接不同版本，请从首页重新读取')
    const end = Math.min(position.offset + limit, entries.length), result = entries.slice(position.offset, end)
    const truncated = end < entries.length
    state.queue = [{ directory, digest: current, offset: end }]
    return { entries: result, offset: position.offset, total: entries.length, truncated,
      excludedCount: result.filter(entry => entry.kind === 'unsupported').length, unscannedEntries: entries.length - end,
      ...(truncated ? { nextCursor: this.remember(state) } : {}) }
  }
  async search(runId: string, directory: string, query: string, limit: number,
    verify: (directory: string) => Promise<string>, cursor?: string) {
    const state = this.start(runId, directory, query, cursor), matches: string[] = []
    const excluded: Array<{ path: string; reason: string }> = [], failed: Array<{ path: string; reason: string }> = []
    let scanned = 0
    while (state.queue.length && matches.length < limit && scanned < 2000) {
      const position = state.queue[0]!, actual = await verify(position.directory)
      if (actual !== position.directory) throw new Error('搜索中的目录位置已改变，请重新搜索')
      let entries: Entry[]
      try { entries = await this.entries(actual) }
      catch (error) {
        state.failedCount++
        if (failed.length < 20) failed.push({ path: actual, reason: error instanceof Error ? error.message : String(error) })
        state.queue.shift(); continue
      }
      const current = digest(entries)
      if (position.digest && position.digest !== current) throw new Error('搜索目录内容已改变，请从首页重新搜索')
      position.digest = current
      while (position.offset < entries.length && matches.length < limit && scanned < 2000) {
        const entry = entries[position.offset++]!, candidate = path.join(actual, entry.name)
        scanned++
        state.scannedEntries++
        if (entry.kind === 'unsupported' || entry.kind === 'folder' && ignoredDirectories.has(entry.name.toLowerCase())) {
          state.excludedCount++
          if (excluded.length < 20) excluded.push({ path: candidate, reason: entry.kind === 'unsupported' ? '符号链接或不支持的目录项' : '默认排除目录' })
          continue
        }
        if (entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.push(candidate)
        if (entry.kind === 'folder') state.queue.push({ directory: candidate, offset: 0 })
      }
      if (position.offset === entries.length) state.queue.shift()
    }
    if (state.queue.length > 10_000) throw new Error('搜索待查目录过多，请指定更小的目录；没有返回完整搜索的结论')
    const truncated = state.queue.length > 0
    return { matches, scanned, scannedEntries: state.scannedEntries, excludedCount: state.excludedCount,
      failedCount: state.failedCount, excluded, failed, truncated,
      ...(truncated ? { nextCursor: this.remember(state) } : {}) }
  }
}
