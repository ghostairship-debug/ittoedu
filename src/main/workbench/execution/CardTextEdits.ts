import { documentTextLength, normalizeDocumentText, sliceDocumentText, type FlowTextContent } from '../../../shared/document/content'
import { mapMarkdownRange } from '../../../core/tools/ToolTargets'
import { sameFieldValue } from '../../../core/drivers/course/elementFields'

type Span = { from: number; to: number }
export interface TextCodec<T> { length(value: T): number; slice(value: T, from: number, to: number): T; join(values: T[]): T; equal(a: T, b: T): boolean }
export const sourceTextCodec: TextCodec<string> = {
  length: value => value.length, slice: (value, from, to) => value.slice(from, to), join: values => values.join(''), equal: (a, b) => a === b,
}
export const flowTextCodec: TextCodec<FlowTextContent> = {
  length: documentTextLength, slice: sliceDocumentText,
  join: values => normalizeDocumentText({ inlines: values.flatMap(value => value.inlines) }), equal: sameFieldValue,
}
export interface PeerTextOperation { id: string; direction: 'apply' | 'undo' | 'redo' }
interface Blocker extends Span { phase: 'applied' | 'undone' }
interface Edit<T> extends Span { before: T; after: T; valid: boolean; blockers?: Map<string, Blocker> }

/** Only known committed edits can move an inverse. Equal text elsewhere is never an identity. */
export class CardTextEdits<T> {
  private edits: Edit<T>[] = []
  range: Span | null
  content: T
  undone = false
  constructor(private readonly codec: TextCodec<T>, initial: T, range: Span) {
    this.range = { ...range }; this.content = codec.slice(initial, range.from, range.to)
  }
  private delta(before: T, after: T): Span & { inserted: number } {
    const c = this.codec, a = c.length(before), b = c.length(after)
    // Prefix/suffix equality is monotone, including rich-text styles and atomic inlines.
    let low = 0, high = Math.min(a, b)
    while (low < high) { const mid = Math.ceil((low + high) / 2)
      if (c.equal(c.slice(before, 0, mid), c.slice(after, 0, mid))) low = mid; else high = mid - 1 }
    const from = low; low = 0; high = Math.min(a, b) - from
    while (low < high) { const mid = Math.ceil((low + high) / 2)
      if (c.equal(c.slice(before, a - mid, a), c.slice(after, b - mid, b))) low = mid; else high = mid - 1 }
    return { from, to: a - low, inserted: b - low - from }
  }
  advance(before: T, after: T, own: boolean, inverse = false, exact?: Span & { inserted: number }, peer?: PeerTextOperation): void {
    const c = this.codec
    if (c.equal(before, after)) return
    if (!own && !inverse && !exact && !peer && !this.edits.some(e => e.blockers?.size) && c === sourceTextCodec as unknown) {
      const a = before as string, b = after as string
      const move = (span: Span): Span | null => {
        try { return mapMarkdownRange(a, b, { kind: 'markdown-range', ...span }) } catch { return null }
      }
      if (this.range) {
        const previous = this.range, mapped = move(previous), d = this.delta(before, after)
        // Editing another part of a broad selected paragraph may change its display
        // range without touching any owned inverse. Evaluate each inverse separately.
        this.range = mapped ?? (previous.from <= d.from && d.to <= previous.to
          ? { from: previous.from, to: previous.to + d.inserted - (d.to - d.from) } : null)
      }
      if (this.range) this.content = c.slice(after, this.range.from, this.range.to)
      for (const edit of this.edits) {
        const moved = move(edit)
        if (moved) { edit.from = moved.from; edit.to = moved.to } else edit.valid = false
      }
      return
    }
    const d = exact ?? this.delta(before, after), shift = d.inserted - (d.to - d.from)
    if (this.range) {
      const r = this.range
      if (d.to <= r.from && d.from < r.from) this.range = { from: r.from + shift, to: r.to + shift }
      else if (d.from >= r.to && d.from > r.from) { /* after the range */ }
      else if (r.from <= d.from && d.to <= r.to) this.range = { from: r.from, to: r.to + shift }
      else this.range = null
      if (this.range) this.content = c.slice(after, this.range.from, this.range.to)
    }
    if (inverse) return
    const touches = (e: Span) => !(d.to <= e.from && (d.from < e.from || !own && d.from === d.to && d.from === e.from) || d.from >= e.to && d.from > e.from)
    const overlap = this.edits.filter(touches)
    if (!own) {
      for (const e of this.edits) {
        const phase = peer?.direction === 'undo' ? 'undone' : 'applied'
        const blocker = peer && e.blockers?.get(peer.id)
        if (blocker) {
          // An explicit inverse restores the position preceding this peer's edits.
          // Repeated writes in that run never move this suspended position twice.
          if (blocker.phase !== phase) e.blockers!.delete(peer!.id)
          else { blocker.from = Math.min(blocker.from, d.from); blocker.to = Math.max(blocker.to, d.to, d.from + d.inserted) }
          continue
        }
        const covered = [e, ...e.blockers?.values() ?? []]
        if (covered.some(touches)) {
          if (peer) {
            e.blockers ??= new Map()
            e.blockers.set(peer.id, { phase, from: Math.min(d.from, ...covered.map(span => span.from)),
              to: Math.max(d.to, d.from + d.inserted, ...covered.map(span => span.to)) })
          } else e.valid = false
        } else {
          if (d.to <= e.from) { e.from += shift; e.to += shift }
          for (const value of e.blockers?.values() ?? []) if (d.to <= value.from) { value.from += shift; value.to += shift }
        }
      }
      return
    }
    // Merge only this task's inverses that the new owned operation actually touches.
    const left = Math.min(d.from, ...overlap.map(e => e.from)), right = Math.max(d.to, ...overlap.map(e => e.to))
    let original = c.slice(before, left, right)
    for (const e of [...overlap].sort((a, b) => b.from - a.from)) {
      original = c.join([c.slice(original, 0, e.from - left), e.before,
        c.slice(original, e.to - left, c.length(original))])
    }
    this.edits = this.edits.filter(e => !overlap.includes(e))
    for (const e of this.edits) if (d.to <= e.from) { e.from += shift; e.to += shift }
    const next = { from: left, to: right + shift, before: original,
      after: c.slice(after, left, right + shift), valid: overlap.every(e => e.valid && !e.blockers?.size) }
    if (!c.equal(next.before, next.after)) this.edits.push(next)
    this.edits.sort((a, b) => a.from - b.from)
  }
  get changed(): boolean { return this.edits.length > 0 }
  get traceable(): boolean { return this.edits.every(e => e.valid && !e.blockers?.size) }
  releaseUnchangedPeer(id: string): void {
    for (const edit of this.edits) if (edit.blockers?.get(id)?.phase === 'applied') edit.blockers.delete(id)
  }
  invalidate(): void { this.range = null; for (const edit of this.edits) edit.valid = false }
  prepare(current: T, direction: 'undo' | 'redo'): { value: T; accept(): void } | null {
    if (!this.traceable || !this.changed || (direction === 'undo') === this.undone) return null
    const c = this.codec, undo = direction === 'undo'
    if (this.edits.some(e => !c.equal(c.slice(current, e.from, e.to), undo ? e.after : e.before))) return null
    let value = current
    for (const e of [...this.edits].reverse()) value = c.join([c.slice(value, 0, e.from), undo ? e.before : e.after, c.slice(value, e.to, c.length(value))])
    return { value, accept: () => {
      let shift = 0
      for (const e of this.edits) {
        const size = c.length(undo ? e.before : e.after), oldSize = e.to - e.from
        e.from += shift; e.to = e.from + size; shift += size - oldSize
      }
      this.undone = undo
    } }
  }
}
