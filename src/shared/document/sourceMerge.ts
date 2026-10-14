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

/** Bounded Myers diff; reuse an exact unchanged span found by the search to split large edits. */
export function sequenceSourceEdits<T>(baseCharacters: readonly T[], nextCharacters: readonly T[]): SequenceEdit<T>[] {
  if (baseCharacters === nextCharacters) return []
  // Recursive splits share the original arrays instead of copying unchanged content at every anchor.
  const visit = (baseStart: number, baseEnd: number, nextStart: number, nextEnd: number): SequenceEdit<T>[] => {
    const baseLength = baseEnd - baseStart, nextLength = nextEnd - nextStart
    const trace: Map<number, number>[] = [], frontier = new Map<number, number>([[1, 0]])
    const maximum = Math.min(baseLength + nextLength, 512)
    let anchor: { from: number; nextFrom: number; length: number } | undefined
    for (let distance = 0; distance <= maximum; distance++) {
      trace.push(new Map(frontier))
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        let x = diagonal === -distance || (diagonal !== distance && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
          ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1
        let y = x - diagonal
        const startX = x, startY = y
        while (x < baseLength && y < nextLength && baseCharacters[baseStart + x] === nextCharacters[nextStart + y]) { x++; y++ }
        if (x - startX > (anchor?.length ?? 1) && startX > 0 && startY > 0
          && x < baseLength && y < nextLength) anchor = { from: startX, nextFrom: startY, length: x - startX }
        frontier.set(diagonal, x)
        if (x < baseLength || y < nextLength) continue
        const reversed: ({ kind: 'same'; length: number } | { kind: 'insert' | 'delete'; text: T })[] = []
        for (let d = distance; d >= 0; d--) {
          const previous = trace[d]!, k = x - y
          const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1
          const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK
          const length = Math.min(x - previousX, y - previousY)
          if (length > 0) { reversed.push({ kind: 'same', length }); x -= length; y -= length }
          if (d === 0) break
          if (x === previousX) { reversed.push({ kind: 'insert', text: nextCharacters[nextStart + y - 1]! }); y-- }
          else { reversed.push({ kind: 'delete', text: baseCharacters[baseStart + x - 1]! }); x-- }
        }
        const edits: SequenceEdit<T>[] = []
        let offset = 0, pending: SequenceEdit<T> | undefined
        for (const operation of reversed.reverse()) {
          if (operation.kind === 'same') { if (pending) { edits.push(pending); pending = undefined }; offset += operation.length }
          else {
            pending ??= { from: offset, to: offset, text: [] }
            if (operation.kind === 'delete') { offset++; pending.to = offset }
            else pending.text.push(operation.text)
          }
        }
        if (pending) edits.push(pending)
        return edits
      }
    }
    if (anchor) {
      const end = anchor.from + anchor.length, nextSpanEnd = anchor.nextFrom + anchor.length
      // The exhausted search is no longer needed while its two subranges are visited.
      trace.length = 0; frontier.clear()
      return [
        ...visit(baseStart, baseStart + anchor.from, nextStart, nextStart + anchor.nextFrom),
        ...visit(baseStart + end, baseEnd, nextStart + nextSpanEnd, nextEnd).map(edit => ({ ...edit, from: edit.from + end, to: edit.to + end })),
      ]
    }
    let from = 0, to = baseLength, finish = nextLength
    while (from < to && from < finish && baseCharacters[baseStart + from] === nextCharacters[nextStart + from]) from++
    while (to > from && finish > from && baseCharacters[baseStart + to - 1] === nextCharacters[nextStart + finish - 1]) { to--; finish-- }
    return from === to && from === finish ? [] : [{ from, to, text: nextCharacters.slice(nextStart + from, nextStart + finish) }]
  }
  return visit(0, baseCharacters.length, 0, nextCharacters.length)
}

/** Diff Unicode scalars, returning UTF-16 offsets used by source editors. */
export function documentSourceEdits(base: string, next: string): SourceEdit[] {
  if (base === next) return []
  const characters = Array.from(base), offsets = [0]
  for (const character of characters) offsets.push(offsets.at(-1)! + character.length)
  return sequenceSourceEdits(characters, Array.from(next)).map(edit => ({ from: offsets[edit.from]!, to: offsets[edit.to]!, text: edit.text.join('') }))
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
