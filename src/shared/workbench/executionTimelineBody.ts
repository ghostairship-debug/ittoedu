import type { ExecutionContent, ExecutionItem, ExecutionProjectionPlan } from './executionEvents'
import { ExecutionPlainTextWindow, readableExecutionText } from './executionDisplayText'
import { EXECUTION_TEXT_PAGE, type ExecutionTimelineBodyPage, type ExecutionTimelineBodyRequest, type ExecutionTimelineBodyWindow } from './executionTimelineWindow'

type TextRun = { kind: 'text'; chunks: string[]; length: number }
type BodyRun = TextRun | Extract<ExecutionContent, { kind: 'blob' }>
type Upsert = ExecutionProjectionPlan['upserts'][number]
function runs(content: readonly ExecutionContent[]): BodyRun[] {
  const result: BodyRun[] = []
  for (const part of content) {
    const previous = result.at(-1)
    if (part.kind === 'text') {
      if (previous?.kind === 'text') { previous.chunks.push(part.text); previous.length += part.text.length }
      else result.push({ kind: 'text', chunks: [part.text], length: part.text.length })
    } else result.push(part)
  }
  return result
}
function prefix(chunks: readonly string[], end: number): string {
  const result: string[] = []
  let remaining = end
  for (const chunk of chunks) { if (remaining <= 0) break; result.push(chunk.slice(0, remaining)); remaining -= chunk.length }
  return result.join('')
}
/** Current-item display owner. Canonical chunks remain complete; only a requested
 * display prefix and an unfinished plain token are cached, never growth versions. */
export class ExecutionTimelineBody {
  private item: ExecutionItem
  private runs: BodyRun[]
  private plain = new Map<number, ExecutionPlainTextWindow>()
  constructor(item: ExecutionItem) { this.item = item; this.runs = runs(item.content) }
  update(change: Upsert): void {
    this.item = change.item
    if (!change.contentChange) return
    const append = !change.contentChange.replace && change.contentChange.parts.every(part => part.kind === 'text')
    const last = this.runs.length - 1
    if (append && this.runs[last]?.kind === 'text') {
      const window = this.plain.get(last)
      if (window) for (const part of change.contentChange.parts) if (part.kind === 'text') window.append(part.text)
    } else this.plain.clear()
    this.runs = runs(this.item.content)
  }
  read(cursor: number, request: Pick<ExecutionTimelineBodyRequest, 'part' | 'offset' | 'maxChars' | 'complete'>): ExecutionTimelineBodyPage {
    const run = this.runs[request.part]
    if (!run || run.kind !== 'text') throw new RangeError('正文段不存在或需要按原 blob 引用读取')
    const offset = Math.max(0, Math.floor(request.offset ?? 0)), maxChars = Math.max(0, Math.floor(request.maxChars ?? EXECUTION_TEXT_PAGE))
    let text: string, total: number
    if (this.item.type === 'text') {
      total = run.length
      text = request.complete ? run.chunks.join('') : prefix(run.chunks, offset + maxChars).slice(offset)
    } else if (request.complete) {
      const safe = readableExecutionText(run.chunks.join(''))
      total = safe.length; text = safe
    } else {
      const end = offset + maxChars
      let window = this.plain.get(request.part)
      if (!window || window.limit < end) {
        const raw = run.chunks.join('')
        if (ExecutionPlainTextWindow.accepts(raw)) { window = new ExecutionPlainTextWindow(raw, end); this.plain.set(request.part, window) }
        else {
          const safe = readableExecutionText(raw)
          return { cursor, sequence: this.item.sequence, text: safe.slice(offset, end), offset, total: safe.length, hasMore: end < safe.length }
        }
      }
      const page = window.page()
      total = page.total; text = page.text.slice(offset, end)
    }
    return { cursor, sequence: this.item.sequence, text, offset: request.complete ? 0 : offset, total,
      hasMore: !request.complete && offset + text.length < total }
  }
  window(cursor: number): ExecutionTimelineBodyWindow {
    return { sequence: this.item.sequence, parts: this.runs.map((run, part) => {
      if (run.kind === 'blob') return run
      const { text, offset, total, hasMore } = this.read(cursor, { part })
      return { kind: 'text', part, text, offset, total, hasMore }
    }) }
  }
}
