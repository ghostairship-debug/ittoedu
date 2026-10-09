import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

type Entry = { name: string; kind: 'folder' | 'file' | 'unsupported' }
type DirectoryPosition = { directory: string; offset: number; digest?: string }
type FilePosition = { filename: string; offset: number; line: number; lineStart: number; version?: string }
interface Cursor {
  runId: string; root: string; query: string; queue: DirectoryPosition[]; file?: FilePosition
  observed: Record<string, string>; scannedFiles: number; excludedCount: number; failedCount: number; createdAt: number
}
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'output', '.next', '.cache'])
const digest = (entries: Entry[]) => createHash('sha256').update(JSON.stringify(entries)).digest('hex')
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** Bounded literal text search with source versions and a position inside the current file. */
export class FileGrepPages {
  private readonly cursors = new Map<string, Cursor>()
  releaseRun(runId: string): void { for (const [id, value] of this.cursors) if (value.runId === runId) this.cursors.delete(id) }
  private begin(runId: string, root: string, query: string, kind: 'file' | 'directory', cursor?: string): Cursor {
    if (!cursor) return { runId, root, query, queue: kind === 'directory' ? [{ directory: root, offset: 0 }] : [],
      ...(kind === 'file' ? { file: { filename: root, offset: 0, line: 1, lineStart: 0 } } : {}), observed: {}, scannedFiles: 0,
      excludedCount: 0, failedCount: 0, createdAt: Date.now() }
    const saved = this.cursors.get(cursor)
    if (!saved || saved.runId !== runId || !samePath(saved.root, root) || saved.query !== query)
      throw new Error('正文搜索游标已失效或不属于本次查询，请重新搜索')
    return structuredClone(saved)
  }
  private remember(state: Cursor): string {
    const id = randomUUID()
    this.cursors.set(id, structuredClone(state))
    return id
  }
  private async entries(directory: string): Promise<Entry[]> {
    return (await fs.readdir(directory, { withFileTypes: true })).map(item => ({ name: item.name,
      kind: (item.isSymbolicLink() ? 'unsupported' : item.isDirectory() ? 'folder' : item.isFile() ? 'file' : 'unsupported') as Entry['kind'] }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name))
  }
  async search(input: { runId: string; root: string; kind: 'file' | 'directory'; query: string; limit: number; cursor?: string;
    verifyDirectory: (directory: string) => Promise<string>;
    readFile: (filename: string) => Promise<{ source: string; version: string }> }) {
    const state = this.begin(input.runId, input.root, input.query, input.kind, input.cursor)
    const matches: Array<{ path: string; line: number; column: number; excerpt: string; version: string }> = []
    const excluded: Array<{ path: string; reason: string }> = [], failed: Array<{ path: string; reason: string }> = []
    // A resumed page must not silently join a different directory snapshot.
    for (const [directory, previous] of Object.entries(state.observed)) {
      const actual = await input.verifyDirectory(directory)
      if (!samePath(actual, directory) || digest(await this.entries(actual)) !== previous)
        throw new Error('搜索目录内容已改变，请从首页重新搜索')
    }
    let filesThisCall = 0, entriesThisCall = 0
    while (matches.length < input.limit && filesThisCall < 100 && entriesThisCall < 2_000 && (state.file || state.queue.length)) {
      if (state.file) {
        const position = state.file
        let file: { source: string; version: string }
        try { file = await input.readFile(position.filename) }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          if (/二进制|UTF-8|相应的文档|果铃工程|超过 16 MiB/.test(reason)) {
            state.excludedCount++
            if (excluded.length < 20) excluded.push({ path: position.filename, reason })
          } else {
            state.failedCount++
            if (failed.length < 20) failed.push({ path: position.filename, reason })
          }
          state.file = undefined; filesThisCall++; continue
        }
        if (position.version && position.version !== file.version) throw new Error('搜索中的文件版本已改变，请重新搜索')
        position.version = file.version
        while (matches.length < input.limit) {
          const index = file.source.indexOf(input.query, position.offset)
          if (index < 0) break
          for (let i = position.offset; i < index; i++) if (file.source.charCodeAt(i) === 10) {
            position.line++; position.lineStart = i + 1
          }
          const lineStart = position.lineStart
          const lineEnd = file.source.indexOf('\n', index)
          matches.push({ path: position.filename, line: position.line, column: index - lineStart + 1,
            excerpt: file.source.slice(lineStart, lineEnd < 0 ? Math.min(file.source.length, lineStart + 240) : Math.min(lineEnd, lineStart + 240)),
            version: file.version })
          const next = index + Math.max(1, input.query.length)
          for (let i = index; i < next; i++) if (file.source.charCodeAt(i) === 10) {
            position.line++; position.lineStart = i + 1
          }
          position.offset = next
        }
        if (matches.length >= input.limit) break
        state.file = undefined; state.scannedFiles++; filesThisCall++
        continue
      }
      const position = state.queue[0]!
      let actual: string, entries: Entry[]
      try {
        actual = await input.verifyDirectory(position.directory)
        if (!samePath(actual, position.directory)) throw new Error('目录位置已改变')
        entries = await this.entries(actual)
      } catch (error) {
        state.failedCount++
        if (failed.length < 20) failed.push({ path: position.directory, reason: error instanceof Error ? error.message : String(error) })
        state.queue.shift(); continue
      }
      const current = digest(entries)
      if (position.digest && position.digest !== current) throw new Error('搜索目录内容已改变，请从首页重新搜索')
      position.digest = current; state.observed[actual] = current
      if (position.offset >= entries.length) { state.queue.shift(); continue }
      const entry = entries[position.offset++]!, filename = path.join(actual, entry.name)
      entriesThisCall++
      if (entry.kind === 'unsupported' || entry.kind === 'folder' && ignoredDirectories.has(entry.name.toLowerCase())) {
        state.excludedCount++
        if (excluded.length < 20) excluded.push({ path: filename, reason: entry.kind === 'unsupported' ? '符号链接或不支持的目录项' : '默认排除目录' })
      } else if (entry.kind === 'folder') state.queue.push({ directory: filename, offset: 0 })
      else state.file = { filename, offset: 0, line: 1, lineStart: 0 }
    }
    const truncated = !!state.file || state.queue.length > 0
    return { matches, scannedFiles: state.scannedFiles, excludedCount: state.excludedCount, failedCount: state.failedCount,
      excluded, failed, truncated, ...(truncated ? { nextCursor: this.remember(state) } : {}) }
  }
}
