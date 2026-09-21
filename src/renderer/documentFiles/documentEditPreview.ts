import type { DocumentEditRange } from '../../shared/document/ports'

/** Show complete affected lines, including unchanged text between diff hunks. */
export function documentEditPreviews(source: string, edits: DocumentEditRange[]) {
  const groups: { from: number; to: number; edits: DocumentEditRange[] }[] = []
  for (const edit of [...edits].sort((a, b) => a.from - b.from)) {
    if (source.slice(edit.from, edit.to) !== edit.before) throw new Error('预览基准与改动不一致。')
    const from = source.slice(0, edit.from).lastIndexOf('\n') + 1
    const nextLine = source.indexOf('\n', edit.to)
    const to = nextLine < 0 ? source.length : nextLine
    const last = groups.at(-1)
    if (last && from <= last.to) { last.to = Math.max(last.to, to); last.edits.push(edit) }
    else groups.push({ from, to, edits: [edit] })
  }
  return groups.map(group => {
    const before = source.slice(group.from, group.to)
    let after = before
    for (const edit of [...group.edits].reverse()) after = after.slice(0, edit.from - group.from) + edit.after + after.slice(edit.to - group.from)
    return { before, after }
  })
}
