import type { TextRun, TextRunStyle } from './contracts/native-v1/types'

function normalizeStyle(style: TextRunStyle): TextRunStyle {
  return {
    ...(style.color !== undefined ? { color: style.color } : {}),
    ...(style.bold !== undefined ? { bold: style.bold } : {}),
    ...(style.italic !== undefined ? { italic: style.italic } : {}),
    ...(style.underline !== undefined ? { underline: style.underline } : {}),
    ...(style.strike !== undefined ? { strike: style.strike } : {}),
    ...(style.emphasis !== undefined ? { emphasis: style.emphasis } : {}),
    ...(style.highlightColor !== undefined
      ? { highlightColor: style.highlightColor }
      : {}),
    ...(style.fontFamily !== undefined ? { fontFamily: style.fontFamily } : {}),
    ...(style.fontSize !== undefined ? { fontSize: style.fontSize } : {}),
  }
}

function sameStyle(left: TextRunStyle, right: TextRunStyle): boolean {
  return JSON.stringify(normalizeStyle(left)) === JSON.stringify(normalizeStyle(right))
}

function hasStyle(style: TextRunStyle): boolean {
  return Object.keys(normalizeStyle(style)).length > 0
}

function stylesByCharacter(
  characterCount: number,
  runs: TextRun[],
): TextRunStyle[] {
  const styles = Array.from(
    { length: characterCount },
    (): TextRunStyle => ({}),
  )
  for (const run of runs) {
    const start = Math.max(0, Math.min(characterCount, run.start))
    const end = Math.max(start, Math.min(characterCount, run.end))
    for (let index = start; index < end; index += 1) {
      Object.assign(styles[index], run.style)
    }
  }
  return styles.map(normalizeStyle)
}

function runsFromCharacterStyles(styles: TextRunStyle[]): TextRun[] {
  const result: TextRun[] = []
  let start = 0
  while (start < styles.length) {
    const style = normalizeStyle(styles[start])
    let end = start + 1
    while (end < styles.length && sameStyle(style, styles[end])) end += 1
    if (hasStyle(style)) result.push({ start, end, style })
    start = end
  }
  return result
}

/**
 * Toggles emphasis on a Unicode-code-point range while preserving all other
 * rich-text overrides. An override equal to the node default is removed so
 * runs continue to encode differences instead of a duplicated base style.
 */
/**
 * Toggles a boolean run override against the node default. A value equal to
 * the default is omitted so runs stay sparse.
 */
export function toggleTextRunBoolean(
  text: string,
  runs: TextRun[],
  selectionStart: number,
  selectionEnd: number,
  key: 'bold' | 'italic' | 'underline' | 'strike',
  baseValue: boolean,
): TextRun[] {
  const characterCount = Array.from(text).length
  const start = Math.max(0, Math.min(characterCount, Math.floor(selectionStart)))
  const end = Math.max(start, Math.min(characterCount, Math.floor(selectionEnd)))
  if (end <= start) return structuredClone(runs)

  const styles = stylesByCharacter(characterCount, runs)
  const allOn = styles
    .slice(start, end)
    .every((style) => style[key] ?? baseValue)
  const nextValue = !allOn
  for (let index = start; index < end; index += 1) {
    if (nextValue === baseValue) delete styles[index][key]
    else styles[index][key] = nextValue
  }
  return runsFromCharacterStyles(styles)
}

export function toggleTextRunEmphasis(
  text: string,
  runs: TextRun[],
  selectionStart: number,
  selectionEnd: number,
  baseEmphasis: boolean,
): TextRun[] {
  const characterCount = Array.from(text).length
  const start = Math.max(0, Math.min(characterCount, Math.floor(selectionStart)))
  const end = Math.max(start, Math.min(characterCount, Math.floor(selectionEnd)))
  if (end <= start) return structuredClone(runs)

  const styles = stylesByCharacter(characterCount, runs)
  const allEmphasized = styles
    .slice(start, end)
    .every((style) => style.emphasis ?? baseEmphasis)
  const nextEmphasis = !allEmphasized
  for (let index = start; index < end; index += 1) {
    if (nextEmphasis === baseEmphasis) delete styles[index].emphasis
    else styles[index].emphasis = nextEmphasis
  }
  return runsFromCharacterStyles(styles)
}

/**
 * Applies style fields to a Unicode-code-point range only. An empty selection
 * is a no-op so callers cannot accidentally format the whole string.
 */
export function applyTextRunStyle(
  text: string,
  runs: TextRun[],
  selectionStart: number,
  selectionEnd: number,
  patch: TextRunStyle,
): TextRun[] {
  const characterCount = Array.from(text).length
  const start = Math.max(0, Math.min(characterCount, Math.floor(selectionStart)))
  const end = Math.max(start, Math.min(characterCount, Math.floor(selectionEnd)))
  if (end <= start) return structuredClone(runs)

  const applied = normalizeStyle(patch)
  if (!hasStyle(applied)) return structuredClone(runs)

  const styles = stylesByCharacter(characterCount, runs)
  for (let index = start; index < end; index += 1) {
    Object.assign(styles[index], applied)
  }
  return runsFromCharacterStyles(styles)
}

/**
 * Keeps rich-text styles attached to unchanged Unicode characters after a
 * plain-text edit. A single replacement region is inferred from the longest
 * common prefix and suffix; inserted text inherits a surrounding style only
 * when that inheritance is unambiguous.
 */
export function remapTextRuns(
  previousText: string,
  nextText: string,
  runs: TextRun[],
): TextRun[] {
  if (previousText === nextText) return structuredClone(runs)

  const previous = Array.from(previousText)
  const next = Array.from(nextText)
  const previousStyles = stylesByCharacter(previous.length, runs)

  let prefix = 0
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  ) {
    prefix += 1
  }

  let suffix = 0
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1
  }

  const nextStyles = next.map<TextRunStyle>(() => ({}))
  for (let index = 0; index < prefix; index += 1) {
    nextStyles[index] = previousStyles[index]
  }
  for (let offset = 0; offset < suffix; offset += 1) {
    nextStyles[next.length - suffix + offset] =
      previousStyles[previous.length - suffix + offset]
  }

  const changedStart = prefix
  const changedEnd = next.length - suffix
  if (changedEnd > changedStart) {
    const before = prefix > 0 ? previousStyles[prefix - 1] : undefined
    const afterIndex = previous.length - suffix
    const after = afterIndex < previous.length ? previousStyles[afterIndex] : undefined
    const inherited = before && after
      ? (sameStyle(before, after) ? before : undefined)
      : (before ?? after)
    if (inherited && hasStyle(inherited)) {
      for (let index = changedStart; index < changedEnd; index += 1) {
        nextStyles[index] = inherited
      }
    }
  }

  return runsFromCharacterStyles(nextStyles)
}
