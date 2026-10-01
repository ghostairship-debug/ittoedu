import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ExecutionTimingMark } from './ExecutionEventStore'

const stable = (value: unknown): string => value && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
  : JSON.stringify(value)
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const stamp = async (filename: string) => {
  try { const stat = await fs.stat(filename); return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error }
}
interface Loaded { stamp: string; marks: Map<string, ExecutionTimingMark>; torn: boolean }

/** Existing task timing owner, with additive append-only diagnostics. The v1 file is never rewritten. */
export class TimingTrace {
  private readonly cache = new Map<string, Loaded>()
  private remember(filename: string, state: Loaded): Loaded {
    this.cache.delete(filename); this.cache.set(filename, state)
    while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value!)
    return state
  }
  private async load(filename: string, conversationId: string, taskId: string): Promise<Loaded> {
    const nextStamp = `${await stamp(filename)}|${await stamp(filename + '.ndjson')}`
    const prior = this.cache.get(filename)
    if (prior?.stamp === nextStamp) return this.remember(filename, prior)
    const marks = new Map<string, ExecutionTimingMark>()
    const add = (mark: ExecutionTimingMark) => {
      if (!mark?.markId || mark.taskId !== taskId || mark.conversationId !== conversationId) throw new Error('计时来源不匹配，原文件保留')
      const old = marks.get(mark.markId)
      if (old && stable(old) !== stable(mark)) throw new Error('计时身份冲突，原文件保留')
      marks.set(mark.markId, mark)
    }
    try {
      const legacy = JSON.parse(await fs.readFile(filename, 'utf8'))
      if (legacy.version !== 1 || legacy.conversationId !== conversationId || legacy.taskId !== taskId || !Array.isArray(legacy.marks)) throw new Error('旧计时记录无效')
      for (const mark of legacy.marks) add(mark)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    let raw = ''
    try { raw = await fs.readFile(filename + '.ndjson', 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const end = raw.lastIndexOf('\n') + 1
    for (const line of raw.slice(0, end).split('\n').filter(Boolean)) {
      const record = JSON.parse(line) as { payload: string; sha256: string }
      if (typeof record.payload !== 'string' || digest(record.payload) !== record.sha256) throw new Error('计时追加记录损坏，原文件保留')
      add(JSON.parse(record.payload))
    }
    return this.remember(filename, { stamp: nextStamp, marks, torn: end !== raw.length })
  }
  async read(filename: string, conversationId: string, taskId: string): Promise<ExecutionTimingMark[]> {
    return [...(await this.load(filename, conversationId, taskId)).marks.values()]
  }
  async append(filename: string, mark: ExecutionTimingMark): Promise<void> {
    const state = await this.load(filename, mark.conversationId, mark.taskId)
    const existing = state.marks.get(mark.markId)
    if (existing) {
      if (stable(existing) !== stable(mark)) throw new Error('计时标记身份冲突')
      return
    }
    if (state.torn) throw new Error('上次计时写入末尾不完整，原日志保留；未把不完整标记视为事实')
    const payload = JSON.stringify(mark), line = JSON.stringify({ payload, sha256: digest(payload) }) + '\n'
    await fs.mkdir(path.dirname(filename), { recursive: true })
    try {
      const handle = await fs.open(filename + '.ndjson', 'a')
      try { await handle.writeFile(line); await handle.sync() } finally { await handle.close() }
      state.marks.set(mark.markId, structuredClone(mark))
      state.stamp = `${await stamp(filename)}|${await stamp(filename + '.ndjson')}`
    } catch (error) { this.cache.delete(filename); throw error }
  }
}
