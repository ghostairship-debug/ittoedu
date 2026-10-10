import type { ChangeSet } from '@codemirror/state'

export const editorText = (source: string): string => source.replace(/\r\n?|\n/g, '\n')

export function sourceOffset(source: string, editorOffset: number): number {
  let raw = 0, visible = 0
  while (raw < source.length && visible < editorOffset) {
    if (source[raw] === '\r' && source[raw + 1] === '\n') raw += 2
    else raw++
    visible++
  }
  return raw
}

function lineEnding(source: string, from: number, to: number): string {
  const replaced = /\r\n?|\n/.exec(source.slice(from, to))
  if (replaced) return replaced[0]
  const following = /\r\n?|\n/.exec(source.slice(from))
  if (following) return following[0]
  const preceding = [...source.slice(0, from).matchAll(/\r\n?|\n/g)].pop()
  return preceding?.[0] ?? '\n'
}

export function applyEditorChange(source: string, from: number, to: number, insert: string): string {
  const rawFrom = sourceOffset(source, from), rawTo = sourceOffset(source, to)
  const preserved = insert.replace(/\r\n?|\n/g, lineEnding(source, rawFrom, rawTo))
  return source.slice(0, rawFrom) + preserved + source.slice(rawTo)
}

export function applyEditorChanges(source: string, changes: ChangeSet): string {
  let result = '', cursor = 0
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const rawFrom = sourceOffset(source, from), rawTo = sourceOffset(source, to)
    result += source.slice(cursor, rawFrom) + inserted.toString().replace(/\r\n?|\n/g, lineEnding(source, rawFrom, rawTo))
    cursor = rawTo
  })
  return result + source.slice(cursor)
}

export function reconcileEditorText(source: string, current: string): string {
  const previous = editorText(source)
  if (current === previous) return source
  let from = 0, before = previous.length, after = current.length
  while (from < before && from < after && previous[from] === current[from]) from++
  while (before > from && after > from && previous[before - 1] === current[after - 1]) { before--; after-- }
  return applyEditorChange(source, from, before, current.slice(from, after))
}

export const editorOffset = (source: string, rawOffset: number): number => editorText(source.slice(0, rawOffset)).length
