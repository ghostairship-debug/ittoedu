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

function coarseEdit(base: string, next: string): SourceEdit[] {
  let from = 0, to = base.length, end = next.length
  while (from < to && from < end && base[from] === next[from]) from++
  while (to > from && end > from && base[to - 1] === next[end - 1]) { to--; end-- }
  return from === to && from === end ? [] : [{ from, to, text: next.slice(from, end) }]
}

/** Myers source diff. UTF-16 offsets match the source editor, including surrogate pairs. */
export function documentSourceEdits(base: string, next: string): SourceEdit[] {
  if (base === next) return []
  const baseCharacters = Array.from(base), nextCharacters = Array.from(next)
  const trace: Map<number, number>[] = [], frontier = new Map<number, number>([[1, 0]])
  const maximum = Math.min(baseCharacters.length + nextCharacters.length, 512)
  for (let distance = 0; distance <= maximum; distance++) {
    trace.push(new Map(frontier))
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x = diagonal === -distance || (diagonal !== distance && (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1
      let y = x - diagonal
      while (x < baseCharacters.length && y < nextCharacters.length && baseCharacters[x] === nextCharacters[y]) { x++; y++ }
      frontier.set(diagonal, x)
      if (x < baseCharacters.length || y < nextCharacters.length) continue
      const reversed: { kind: 'same' | 'insert' | 'delete'; text: string }[] = []
      for (let d = distance; d >= 0; d--) {
        const previous = trace[d]!, k = x - y
        const previousK = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1
        const previousX = previous.get(previousK) ?? 0, previousY = previousX - previousK
        while (x > previousX && y > previousY) { reversed.push({ kind: 'same', text: baseCharacters[x - 1]! }); x--; y-- }
        if (d === 0) break
        if (x === previousX) { reversed.push({ kind: 'insert', text: nextCharacters[y - 1]! }); y-- }
        else { reversed.push({ kind: 'delete', text: baseCharacters[x - 1]! }); x-- }
      }
      const edits: SourceEdit[] = []
      let offset = 0, pending: SourceEdit | undefined
      for (const operation of reversed.reverse()) {
        if (operation.kind === 'same') { if (pending) { edits.push(pending); pending = undefined }; offset += operation.text.length }
        else {
          pending ??= { from: offset, to: offset, text: '' }
          if (operation.kind === 'delete') { offset += operation.text.length; pending.to = offset }
          else pending.text += operation.text
        }
      }
      if (pending) edits.push(pending)
      return edits
    }
  }
  // A large replacement remains a single explicit choice; never guess correspondence.
  return coarseEdit(base, next)
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
