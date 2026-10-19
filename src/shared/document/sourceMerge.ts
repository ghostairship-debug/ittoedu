export interface SourceEdit { from: number; to: number; text: string }
export interface DocumentConflictHunk {
  id: string
  from: number
  to: number
  base: string
  local: string
  remote: string
  resolution: string | null
  contextBefore: string
  contextAfter: string
}
export interface DocumentSourceMerge { base: string; edits: SourceEdit[]; conflicts: DocumentConflictHunk[] }

export interface SequenceEdit<T> { from: number; to: number; text: T[] }

interface IndexedSequence<T> { length: number; at(index: number): T }
export interface SequenceRangeEdit { from: number; to: number; nextFrom: number; nextTo: number }

/** Keep exact Myers matches for ordinary edits; unresolved complex spans remain lossless replacements. */
function sequenceRangeEdits<T>(base: IndexedSequence<T>, next: IndexedSequence<T>): SequenceRangeEdit[] {
  const edits: SequenceRangeEdit[] = []
  const pending = [{ baseStart: 0, baseEnd: base.length, nextStart: 0, nextEnd: next.length }]
  // Preserve the first Myers search exactly. Only after distance 512 is exhausted do we
  // bound frontier expansion during anchor refinement. Unchanged text does not consume
  // that allowance: a long unchanged body must not hide independent small edits.
  // This limits precision for complex changes, never the accepted content or source size.
  let work = Infinity
  while (pending.length) {
    const { baseStart, baseEnd, nextStart, nextEnd } = pending.pop()!
    const baseLength = baseEnd - baseStart, nextLength = nextEnd - nextStart
    const trace: Map<number, number>[] = [], frontier = new Map<number, number>([[1, 0]])
    const maximum = Math.min(baseLength + nextLength, 512)
    let anchor: { from: number; nextFrom: number; length: number } | undefined
    let solved = false
    search: for (let distance = 0; distance <= maximum; distance++) {
      trace.push(new Map(frontier))
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        if (--work < 0) break search
        let x = diagonal === -distance || (diagonal !== distance && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
          ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1
        let y = x - diagonal
        const startX = x, startY = y
        while (x < baseLength && y < nextLength) {
          if (base.at(baseStart + x) !== next.at(nextStart + y)) break
          x++; y++
        }
        if (x - startX > (anchor?.length ?? 1) && startX > 0 && startY > 0
          && x < baseLength && y < nextLength) anchor = { from: startX, nextFrom: startY, length: x - startX }
        frontier.set(diagonal, x)
        if (x < baseLength || y < nextLength) continue
        const reversed: { kind: 'same' | 'insert' | 'delete'; length: number }[] = []
        for (let d = distance; d >= 0; d--) {
          const previous = trace[d]!, k = x - y
          const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1
          const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK
          const length = Math.min(x - previousX, y - previousY)
          if (length > 0) { reversed.push({ kind: 'same', length }); x -= length; y -= length }
          if (d === 0) break
          if (x === previousX) { reversed.push({ kind: 'insert', length: 1 }); y-- }
          else { reversed.push({ kind: 'delete', length: 1 }); x-- }
        }
        let offset = baseStart, nextOffset = nextStart, edit: SequenceRangeEdit | undefined
        for (const operation of reversed.reverse()) {
          if (operation.kind === 'same') {
            if (edit) { edits.push(edit); edit = undefined }
            offset += operation.length; nextOffset += operation.length
          }
          else {
            edit ??= { from: offset, to: offset, nextFrom: nextOffset, nextTo: nextOffset }
            if (operation.kind === 'delete') { offset++; edit.to = offset }
            else { nextOffset++; edit.nextTo = nextOffset }
          }
        }
        if (edit) edits.push(edit)
        solved = true
        break search
      }
    }
    if (solved) continue
    if (work === Infinity) work = 2 * 512 * 512
    if (anchor) {
      const end = anchor.from + anchor.length, nextSpanEnd = anchor.nextFrom + anchor.length
      // LIFO visits the left range first, preserving the old matching order without recursion.
      pending.push({ baseStart: baseStart + end, baseEnd, nextStart: nextStart + nextSpanEnd, nextEnd },
        { baseStart, baseEnd: baseStart + anchor.from, nextStart, nextEnd: nextStart + anchor.nextFrom })
      continue
    }
    let from = 0, to = baseLength, finish = nextLength
    while (from < to && from < finish && base.at(baseStart + from) === next.at(nextStart + from)) from++
    while (to > from && finish > from && base.at(baseStart + to - 1) === next.at(nextStart + finish - 1)) { to--; finish-- }
    if (from !== to || from !== finish) edits.push({ from: baseStart + from, to: baseStart + to, nextFrom: nextStart + from, nextTo: nextStart + finish })
  }
  return edits
}

/** Bounded Myers diff; exact unchanged anchors keep independently edited spans separate. */
export function sequenceSourceEditRanges<T>(base: ArrayLike<T>, next: ArrayLike<T>): SequenceRangeEdit[] {
  if (base === next) return []
  return sequenceRangeEdits({ length: base.length, at: index => base[index]! }, { length: next.length, at: index => next[index]! })
}

export function sequenceSourceEdits<T>(baseCharacters: readonly T[], nextCharacters: readonly T[]): SequenceEdit<T>[] {
  return sequenceSourceEditRanges(baseCharacters, nextCharacters)
    .map(edit => ({ from: edit.from, to: edit.to, text: nextCharacters.slice(edit.nextFrom, edit.nextTo) }))
}

function splitsSurrogate(source: string, offset: number) {
  return offset > 0 && source.charCodeAt(offset - 1) >= 0xD800 && source.charCodeAt(offset - 1) <= 0xDBFF
    && source.charCodeAt(offset) >= 0xDC00 && source.charCodeAt(offset) <= 0xDFFF
}

/** A receipt needs reversible source bytes, not a fine diff. It must not be used as range-mapping facts. */
export function documentSourceReplacement(base: string, next: string): SourceEdit | undefined {
  if (base === next) return
  let from = 0, to = base.length, finish = next.length
  while (from < to && from < finish && base[from] === next[from]) from++
  if (splitsSurrogate(base, from) || splitsSurrogate(next, from)) from--
  while (to > from && finish > from && base[to - 1] === next[finish - 1]) { to--; finish-- }
  if (splitsSurrogate(base, to) || splitsSurrogate(next, finish)) { to++; finish++ }
  return { from, to, text: next.slice(from, finish) }
}

/** Sparse surrogate positions avoid allocating one array entry for every source character. */
function scalarSequence(source: string): IndexedSequence<number> & { offset(index: number): number } {
  const pairs: number[] = []
  for (let offset = 0; offset < source.length; offset++) {
    const code = source.charCodeAt(offset)
    if (code >= 0xD800 && code <= 0xDBFF && splitsSurrogate(source, offset + 1)) {
      pairs.push(offset - pairs.length); offset++
    }
  }
  const offset = (index: number) => {
    let from = 0, to = pairs.length
    while (from < to) { const middle = (from + to) >>> 1; if (pairs[middle]! < index) from = middle + 1; else to = middle }
    return index + from
  }
  return { length: source.length - pairs.length, offset, at: pairs.length
    ? index => source.codePointAt(offset(index))! : index => source.charCodeAt(index) }
}

/** Diff Unicode scalars, returning UTF-16 offsets used by source editors. */
export function documentSourceEdits(base: string, next: string): SourceEdit[] {
  if (base === next) return []
  const before = scalarSequence(base), after = scalarSequence(next)
  return sequenceRangeEdits(before, after).map(edit => ({ from: before.offset(edit.from), to: before.offset(edit.to),
    text: next.slice(after.offset(edit.nextFrom), after.offset(edit.nextTo)) }))
}

function overlaps(a: SourceEdit, b: SourceEdit) {
  if (a.from === a.to) return a.from >= b.from && a.from <= b.to
  if (b.from === b.to) return b.from >= a.from && b.from <= a.to
  return a.from < b.to && b.from < a.to
}
function replace(source: string, edits: SourceEdit[], start = 0) {
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) source = source.slice(0, edit.from - start) + edit.text + source.slice(edit.to - start)
  return source
}
export function planDocumentSourceMerge(base: string, local: string, remote: string): DocumentSourceMerge {
  const remaining = [
    ...documentSourceEdits(base, local).map(edit => ({ ...edit, side: 'local' as const })),
    ...documentSourceEdits(base, remote).map(edit => ({ ...edit, side: 'remote' as const })),
  ]
  const plan: DocumentSourceMerge = { base, edits: [], conflicts: [] }
  while (remaining.length) {
    const group = [remaining.shift()!]
    for (let index = 0; index < remaining.length;) {
      if (group.some(edit => overlaps(edit, remaining[index]!))) { group.push(remaining.splice(index, 1)[0]!); index = 0 }
      else index++
    }
    const localEdits = group.filter(edit => edit.side === 'local'), remoteEdits = group.filter(edit => edit.side === 'remote')
    if (!localEdits.length || !remoteEdits.length) { plan.edits.push(...group); continue }
    const from = Math.min(...group.map(edit => edit.from)), to = Math.max(...group.map(edit => edit.to))
    const original = base.slice(from, to), localText = replace(original, localEdits, from), remoteText = replace(original, remoteEdits, from)
    if (localText === remoteText) plan.edits.push({ from, to, text: localText })
    else plan.conflicts.push({ id: `conflict-${from}-${to}`, from, to, base: original, local: localText, remote: remoteText, resolution: null, contextBefore: base.slice(Math.max(0, from - 40), from), contextAfter: base.slice(to, to + 40) })
  }
  plan.conflicts.sort((a, b) => a.from - b.from)
  return plan
}
export function mergedDocumentSource(plan: DocumentSourceMerge) {
  return replace(plan.base, [...plan.edits, ...plan.conflicts.map(hunk => ({ from: hunk.from, to: hunk.to, text: hunk.resolution ?? hunk.local }))])
}
