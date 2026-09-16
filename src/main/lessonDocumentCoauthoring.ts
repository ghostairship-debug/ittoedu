import type { DocumentEditRange } from '../shared/document/ports'
import { documentSourceEdits } from '../shared/document/sourceMerge'

/** Source ranges use JavaScript UTF-16 offsets, as source editors do. */
export function applyDocumentRanges(base: string, current: string, edits: DocumentEditRange[]) {
  const applied: DocumentEditRange[] = [], conflicts: DocumentEditRange[] = []
  let source = current
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  let end = -1
  let priorFrom = -1
  const located: DocumentEditRange[] = []
  const teacherChanges = documentSourceEdits(base, current)
  for (const edit of sorted) {
    if (!Number.isInteger(edit.from) || !Number.isInteger(edit.to) || edit.from < 0 || edit.to < edit.from || edit.to > base.length || edit.from < end || edit.from === priorFrom || base.slice(edit.from, edit.to) !== edit.before) {
      conflicts.push(edit); continue
    }
    end = edit.to
    priorFrom = edit.from
    let from = edit.from
    if (base !== current) {
      const overlaps = teacherChanges.some(change => edit.from === edit.to
        ? change.from <= edit.from && change.to >= edit.from
        : change.from === change.to ? change.from > edit.from && change.from < edit.to : change.from < edit.to && change.to > edit.from)
      if (overlaps) {
        conflicts.push(edit); continue
      }
      from += teacherChanges.filter(change => change.to <= edit.from).reduce((shift, change) => shift + change.text.length - (change.to - change.from), 0)
      if (current.slice(from, from + edit.before.length) !== edit.before) { conflicts.push(edit); continue }
    }
    located.push({ ...edit, from, to: from + edit.before.length })
  }
  for (const edit of located.sort((a, b) => b.from - a.from)) source = source.slice(0, edit.from) + edit.after + source.slice(edit.to)
  let shift = 0
  for (const edit of located.sort((a, b) => a.from - b.from)) {
    applied.push({ ...edit, from: edit.from + shift, to: edit.from + shift + edit.after.length })
    shift += edit.after.length - edit.before.length
  }
  return { source, applied, conflicts }
}

export function revertDocumentRanges(savedSource: string, current: string, applied: DocumentEditRange[]) {
  const inverses = applied.map(edit => ({ from: edit.from, to: edit.to, before: edit.after, after: edit.before }))
  return applyDocumentRanges(savedSource, current, inverses)
}
