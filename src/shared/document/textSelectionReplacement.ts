import { documentSourceEdits } from './sourceMerge'

/** Allocate a replacement across already captured visible fragments; coordinates are UTF-16. */
export function allocateTextSelectionReplacement(fragments: readonly { text: string; separatorBefore?: string }[], next: string): {
  from: number; to: number; text: string
}[] {
  const base = fragments.map(fragment => (fragment.separatorBefore ?? '') + fragment.text).join('')
  const edits = documentSourceEdits(base, next)
  const boundary = (offset: number, affinity: 'left' | 'right' = 'right'): number => {
    if (offset === base.length) return next.length
    let delta = 0
    for (const edit of edits) {
      if (edit.from === edit.to && offset === edit.from && affinity === 'right') { delta += edit.text.length; continue }
      if (offset <= edit.from) break
      if (offset >= edit.to) { delta += edit.text.length - edit.to + edit.from; continue }
      const oldBefore = Array.from(base.slice(edit.from, offset)).length, oldSize = Array.from(base.slice(edit.from, edit.to)).length
      return edit.from + delta + Array.from(edit.text).slice(0, Math.round(Array.from(edit.text).length * oldBefore / oldSize)).join('').length
    }
    return offset + delta
  }
  let at = 0
  return fragments.map(fragment => {
    const separator = fragment.separatorBefore ?? '', separatorStart = boundary(at)
    at += separator.length
    let from = at === 0 ? 0 : boundary(at, separator ? 'left' : 'right')
    if (next.slice(separatorStart, from) !== separator) from = separatorStart
    at += fragment.text.length
    const to = boundary(at)
    return { from, to, text: next.slice(from, to) }
  })
}
