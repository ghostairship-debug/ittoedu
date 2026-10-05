import type { TextRun, TextRunStyle } from './contracts/native-v1'

export interface FlowRichTextSegment {
  readonly text: string
  readonly style: TextRunStyle
}

export function flowRichTextSegments(text: string, runs?: readonly TextRun[]): FlowRichTextSegment[] {
  if (!text) return []
  if (!runs?.length) return [{ text, style: {} }]
  const characters = Array.from(text)
  const styles = characters.map((): TextRunStyle => ({}))
  for (const run of runs) {
    const start = Math.max(0, Math.min(characters.length, run.start))
    const end = Math.max(start, Math.min(characters.length, run.end))
    for (let index = start; index < end; index += 1) {
      Object.assign(styles[index]!, run.style)
    }
  }
  const segments: FlowRichTextSegment[] = []
  let cursor = 0
  while (cursor < characters.length) {
    const style = { ...styles[cursor]! }
    let end = cursor + 1
    while (end < characters.length && sameRunStyle(style, styles[end]!)) end += 1
    segments.push({ text: characters.slice(cursor, end).join(''), style })
    cursor = end
  }
  return segments
}

function sameRunStyle(left: TextRunStyle, right: TextRunStyle): boolean {
  return left.fontFamily === right.fontFamily
    && left.fontSize === right.fontSize
    && left.bold === right.bold
    && left.italic === right.italic
    && left.underline === right.underline
    && left.strike === right.strike
    && left.emphasis === right.emphasis
    && left.color === right.color
    && left.highlightColor === right.highlightColor
}
