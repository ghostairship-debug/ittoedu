import type { TextRun, TextRunStyle } from './contracts/native-v1/types'

function normalizeStyle(style: TextRunStyle): TextRunStyle {
  return {
    ...(style.baseline !== undefined ? { baseline: style.baseline } : {}),
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

export interface TextRunEdit {
  /** Unicode code-point offsets into the same baseline text. */
  readonly start: number
  readonly end: number
  readonly original: string
  readonly replacement: string
}

export interface TextRunReplacement {
  readonly original: string
  readonly replacement: string
  readonly contextBefore?: string
  readonly contextAfter?: string
}

export interface TextRunInputCapture {
  readonly previousText: string
  readonly selectionStartUtf16: number
  readonly selectionEndUtf16: number
  readonly inputType: string
}

export type TextRunInputEditResult = {
  readonly ok: true
  readonly edit: TextRunEdit
} | {
  readonly ok: false
  readonly reason: string
}

export type TextRunRemapResult = {
  readonly ok: true
  readonly text: string
  readonly runs: TextRun[]
  readonly edits: TextRunEdit[]
} | {
  readonly ok: false
  readonly code: 'ambiguous' | 'invalid-range' | 'stale-original' | 'overlap' | 'too-complex'
  readonly reason: string
  readonly sourceText: string
  readonly draftText: string
  readonly candidates?: readonly (readonly TextRunEdit[])[]
}

export class TextRunRemapError extends Error {
  constructor(readonly result: Extract<TextRunRemapResult, { ok: false }>) {
    super(result.reason)
    this.name = 'TextRunRemapError'
  }
}

interface GraphemeToken {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly utf16Start: number
  readonly utf16End: number
}

type DiffOperation =
  | { readonly kind: 'same'; readonly previous: GraphemeToken; readonly next: GraphemeToken }
  | { readonly kind: 'delete'; readonly previous: GraphemeToken }
  | { readonly kind: 'insert'; readonly next: GraphemeToken }

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function graphemeTokens(text: string): GraphemeToken[] {
  const result: GraphemeToken[] = []
  let codePointOffset = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    const length = Array.from(segment.segment).length
    result.push({
      text: segment.segment,
      start: codePointOffset,
      end: codePointOffset + length,
      utf16Start: segment.index,
      utf16End: segment.index + segment.segment.length,
    })
    codePointOffset += length
  }
  return result
}

function codePointOffsetAtUtf16Boundary(tokens: readonly GraphemeToken[], text: string, offset: number): number | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return undefined
  if (offset === 0) return 0
  if (offset === text.length) return tokens.at(-1)?.end ?? 0
  return tokens.find(token => token.utf16Start === offset)?.start
}

/**
 * Converts one browser textarea input transaction into an exact code-point
 * edit. The browser selection is captured before mutation; UTF-16 offsets are
 * accepted only when they coincide with grapheme boundaries.
 */
export function captureTextRunInputEdit(
  capture: TextRunInputCapture,
  nextText: string,
): TextRunInputEditResult {
  const previousTokens = graphemeTokens(capture.previousText)
  const previous = Array.from(capture.previousText)
  const next = Array.from(nextText)
  let start = codePointOffsetAtUtf16Boundary(previousTokens, capture.previousText, capture.selectionStartUtf16)
  let end = codePointOffsetAtUtf16Boundary(previousTokens, capture.previousText, capture.selectionEndUtf16)
  if (start === undefined || end === undefined || end < start) {
    return { ok: false, reason: '浏览器选区不在完整字素边界上' }
  }

  const capturedStart = start
  const capturedEnd = end
  const collapsed = start === end
  const backwardDelete = capture.inputType.startsWith('delete') && capture.inputType.includes('Backward')
  const forwardDelete = capture.inputType.startsWith('delete') && capture.inputType.includes('Forward')
  if (collapsed && capture.inputType === 'deleteContentBackward') {
    const previousToken = [...previousTokens].reverse().find(token => token.end <= capturedStart)
    if (previousToken) start = previousToken.start
  } else if (collapsed && capture.inputType === 'deleteContentForward') {
    const nextToken = previousTokens.find(token => token.start >= capturedEnd)
    if (nextToken) end = nextToken.end
  }

  const directPrefix = previous.slice(0, start)
  const directSuffix = previous.slice(end)
  const prefixMatches = directPrefix.every((character, index) => next[index] === character)
  const suffixStart = next.length - directSuffix.length
  const suffixMatches = suffixStart >= directPrefix.length
    && directSuffix.every((character, index) => next[suffixStart + index] === character)
  if (prefixMatches && suffixMatches) {
    return {
      ok: true,
      edit: {
        start,
        end,
        original: previous.slice(start, end).join(''),
        replacement: next.slice(start, suffixStart).join(''),
      },
    }
  }

  // Word/line deletion can report a collapsed caret rather than the deleted
  // browser range. The length delta plus direction still anchors one side.
  if (collapsed && next.length < previous.length && (backwardDelete || forwardDelete)) {
    const removedLength = previous.length - next.length
    const expandedStart = backwardDelete ? capturedStart - removedLength : capturedStart
    const expandedEnd = forwardDelete ? capturedEnd + removedLength : capturedEnd
    if (expandedStart >= 0 && expandedEnd <= previous.length) {
      const prefix = previous.slice(0, expandedStart)
      const suffix = previous.slice(expandedEnd)
      if (next.join('') === [...prefix, ...suffix].join('')) {
        return {
          ok: true,
          edit: {
            start: expandedStart,
            end: expandedEnd,
            original: previous.slice(expandedStart, expandedEnd).join(''),
            replacement: '',
          },
        }
      }
    }
  }
  if (collapsed && (capture.inputType === 'historyUndo' || capture.inputType === 'historyRedo')) {
    const previousBoundaries = [0, ...previousTokens.map(token => token.end)]
    const nextBoundaries = new Set([0, ...graphemeTokens(nextText).map(token => token.end)])
    const candidates: { edit: TextRunEdit; anchorDistance: number; changedLength: number }[] = []
    for (const candidateStart of previousBoundaries) {
      if (!previous.slice(0, candidateStart).every((character, index) => next[index] === character)) continue
      for (const candidateEnd of previousBoundaries) {
        if (candidateEnd < candidateStart) continue
        const suffixLength = previous.length - candidateEnd
        const replacementEnd = next.length - suffixLength
        if (replacementEnd < candidateStart || !nextBoundaries.has(replacementEnd)) continue
        if (!previous.slice(candidateEnd).every((character, index) => next[replacementEnd + index] === character)) continue
        const edit = {
          start: candidateStart,
          end: candidateEnd,
          original: previous.slice(candidateStart, candidateEnd).join(''),
          replacement: next.slice(candidateStart, replacementEnd).join(''),
        }
        if (edit.original === edit.replacement) continue
        const anchorDistance = next.length <= previous.length
          ? Math.abs(candidateEnd - capturedStart)
          : Math.abs(candidateStart - capturedStart)
        candidates.push({ edit, anchorDistance, changedLength: candidateEnd - candidateStart + replacementEnd - candidateStart })
      }
    }
    candidates.sort((left, right) => left.anchorDistance - right.anchorDistance || left.changedLength - right.changedLength || left.edit.start - right.edit.start)
    if (candidates[0]) return { ok: true, edit: candidates[0].edit }
  }
  return { ok: false, reason: `无法把 ${capture.inputType || 'input'} 还原为捕获选区上的单次编辑` }
}

function sameRuns(left: readonly TextRun[], right: readonly TextRun[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function uniformStyle(styles: readonly TextRunStyle[]): TextRunStyle | undefined {
  if (!styles.length) return undefined
  const first = styles[0]!
  return styles.every(style => sameStyle(first, style)) ? first : undefined
}

function inheritedReplacementStyle(
  previousStyles: readonly TextRunStyle[],
  start: number,
  end: number,
): TextRunStyle | undefined {
  if (end > start) return uniformStyle(previousStyles.slice(start, end))
  const before = start > 0 ? previousStyles[start - 1] : undefined
  const after = start < previousStyles.length ? previousStyles[start] : undefined
  if (before && after) return sameStyle(before, after) ? before : undefined
  return before ?? after
}

function failure(
  code: Extract<TextRunRemapResult, { ok: false }>['code'],
  reason: string,
  sourceText: string,
  draftText: string,
  candidates?: readonly (readonly TextRunEdit[])[],
): TextRunRemapResult {
  return { ok: false, code, reason, sourceText, draftText, ...(candidates ? { candidates } : {}) }
}

/**
 * Applies exact, non-overlapping Unicode-code-point edits against one baseline.
 * Every range must end on a grapheme boundary and carry its expected source,
 * so stale selections and UTF-16/code-point mix-ups fail without a partial edit.
 */
export function applyTextRunEdits(
  previousText: string,
  runs: TextRun[],
  edits: readonly TextRunEdit[],
): TextRunRemapResult {
  const previous = Array.from(previousText)
  const boundaries = new Set([0, ...graphemeTokens(previousText).map(token => token.end)])
  const ordered = edits.map(edit => ({ ...edit })).sort((left, right) => left.start - right.start || left.end - right.end)
  for (let index = 0; index < ordered.length; index += 1) {
    const edit = ordered[index]!
    if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)
      || edit.start < 0 || edit.end < edit.start || edit.end > previous.length
      || !boundaries.has(edit.start) || !boundaries.has(edit.end)) {
      return failure('invalid-range', `文字编辑范围 ${edit.start}..${edit.end} 不是有效的字素边界`, previousText, previousText)
    }
    if (previous.slice(edit.start, edit.end).join('') !== edit.original) {
      return failure('stale-original', `文字编辑范围 ${edit.start}..${edit.end} 的原文已变化`, previousText, previousText)
    }
    const previousEdit = index > 0 ? ordered[index - 1] : undefined
    if (previousEdit && (edit.start < previousEdit.end
      || (edit.start === edit.end && previousEdit.start === previousEdit.end && edit.start === previousEdit.start))) {
      return failure('overlap', `文字编辑范围 ${edit.start}..${edit.end} 与前一范围重叠`, previousText, previousText)
    }
  }

  const previousStyles = stylesByCharacter(previous.length, runs)
  const nextCharacters: string[] = []
  const nextStyles: TextRunStyle[] = []
  let cursor = 0
  for (const edit of ordered) {
    nextCharacters.push(...previous.slice(cursor, edit.start))
    nextStyles.push(...previousStyles.slice(cursor, edit.start))
    const replacement = Array.from(edit.replacement)
    nextCharacters.push(...replacement)
    const inherited = inheritedReplacementStyle(previousStyles, edit.start, edit.end)
    nextStyles.push(...replacement.map(() => inherited ? normalizeStyle(inherited) : {}))
    cursor = edit.end
  }
  nextCharacters.push(...previous.slice(cursor))
  nextStyles.push(...previousStyles.slice(cursor))
  const text = nextCharacters.join('')
  return { ok: true, text, runs: runsFromCharacterStyles(nextStyles), edits: ordered }
}

function myersOperations(
  previous: readonly GraphemeToken[],
  next: readonly GraphemeToken[],
  preferInsertOnTie: boolean,
): DiffOperation[] | null {
  const trace: Map<number, number>[] = []
  const frontier = new Map<number, number>([[1, 0]])
  const maximum = Math.min(previous.length + next.length, 512)
  const chooseInsert = (distance: number, diagonal: number, source: ReadonlyMap<number, number>) =>
    diagonal === -distance
    || (diagonal !== distance && (preferInsertOnTie
      ? (source.get(diagonal - 1) ?? -1) <= (source.get(diagonal + 1) ?? -1)
      : (source.get(diagonal - 1) ?? -1) < (source.get(diagonal + 1) ?? -1)))

  for (let distance = 0; distance <= maximum; distance += 1) {
    trace.push(new Map(frontier))
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x = chooseInsert(distance, diagonal, frontier)
        ? frontier.get(diagonal + 1) ?? 0
        : (frontier.get(diagonal - 1) ?? 0) + 1
      let y = x - diagonal
      while (x < previous.length && y < next.length && previous[x]!.text === next[y]!.text) {
        x += 1
        y += 1
      }
      frontier.set(diagonal, x)
      if (x < previous.length || y < next.length) continue

      const reversed: DiffOperation[] = []
      for (let currentDistance = distance; currentDistance >= 0; currentDistance -= 1) {
        const source = trace[currentDistance]!
        const currentDiagonal = x - y
        const previousDiagonal = chooseInsert(currentDistance, currentDiagonal, source)
          ? currentDiagonal + 1
          : currentDiagonal - 1
        const previousX = source.get(previousDiagonal) ?? 0
        const previousY = previousX - previousDiagonal
        while (x > previousX && y > previousY) {
          reversed.push({ kind: 'same', previous: previous[x - 1]!, next: next[y - 1]! })
          x -= 1
          y -= 1
        }
        if (currentDistance === 0) break
        if (x === previousX) {
          reversed.push({ kind: 'insert', next: next[y - 1]! })
          y -= 1
        } else {
          reversed.push({ kind: 'delete', previous: previous[x - 1]! })
          x -= 1
        }
      }
      return reversed.reverse()
    }
  }
  return null
}

function editsFromOperations(operations: readonly DiffOperation[]): TextRunEdit[] {
  const edits: TextRunEdit[] = []
  let pending: TextRunEdit | undefined
  let previousOffset = 0
  const flush = () => {
    if (pending) edits.push(pending)
    pending = undefined
  }
  for (const operation of operations) {
    if (operation.kind === 'same') {
      flush()
      previousOffset = operation.previous.end
      continue
    }
    pending ??= { start: previousOffset, end: previousOffset, original: '', replacement: '' }
    if (operation.kind === 'delete') {
      pending = {
        ...pending,
        end: operation.previous.end,
        original: pending.original + operation.previous.text,
      }
      previousOffset = operation.previous.end
    } else {
      pending = { ...pending, replacement: pending.replacement + operation.next.text }
    }
  }
  flush()
  return edits
}

function ambiguousMatchReason(
  previous: readonly GraphemeToken[],
  next: readonly GraphemeToken[],
  runs: readonly TextRun[],
): string | undefined {
  const cells = (previous.length + 1) * (next.length + 1)
  if (cells > 1_000_000) return undefined
  const Matrix = Math.max(previous.length, next.length) <= 65_535 ? Uint16Array : Uint32Array
  const prefix = new Matrix(cells)
  const suffix = new Matrix(cells)
  const width = next.length + 1
  const at = (row: number, column: number) => row * width + column
  for (let row = 1; row <= previous.length; row += 1) {
    for (let column = 1; column <= next.length; column += 1) {
      prefix[at(row, column)] = previous[row - 1]!.text === next[column - 1]!.text
        ? prefix[at(row - 1, column - 1)]! + 1
        : Math.max(prefix[at(row - 1, column)]!, prefix[at(row, column - 1)]!)
    }
  }
  for (let row = previous.length - 1; row >= 0; row -= 1) {
    for (let column = next.length - 1; column >= 0; column -= 1) {
      suffix[at(row, column)] = previous[row]!.text === next[column]!.text
        ? suffix[at(row + 1, column + 1)]! + 1
        : Math.max(suffix[at(row + 1, column)]!, suffix[at(row, column + 1)]!)
    }
  }
  const longest = prefix[at(previous.length, next.length)]!
  const previousStyles = stylesByCharacter(previous.at(-1)?.end ?? 0, [...runs])
  for (let nextIndex = 0; nextIndex < next.length; nextIndex += 1) {
    const origins: GraphemeToken[] = []
    for (let previousIndex = 0; previousIndex < previous.length; previousIndex += 1) {
      if (previous[previousIndex]!.text !== next[nextIndex]!.text) continue
      if (prefix[at(previousIndex, nextIndex)]! + 1 + suffix[at(previousIndex + 1, nextIndex + 1)]! === longest) {
        origins.push(previous[previousIndex]!)
      }
    }
    const styles = new Set(origins.map(origin => JSON.stringify(previousStyles.slice(origin.start, origin.end).map(normalizeStyle))))
    if (styles.size > 1) {
      return `目标字素 ${nextIndex} 可对应原文码点 ${origins.map(origin => origin.start).join('、')}，且格式不同`
    }
  }
  return undefined
}

/**
 * Infers all separated edits from whole-text input. Two opposite Myers tie
 * choices are evaluated; if repeated text permits style-changing mappings,
 * the caller gets an explicit ambiguity and both source/draft remain intact.
 */
export function planTextRunRemap(
  previousText: string,
  nextText: string,
  runs: TextRun[],
): TextRunRemapResult {
  if (previousText === nextText) {
    return { ok: true, text: nextText, runs: structuredClone(runs), edits: [] }
  }
  const previous = graphemeTokens(previousText)
  const next = graphemeTokens(nextText)
  const left = myersOperations(previous, next, false)
  const right = myersOperations(previous, next, true)
  if (!left || !right) {
    return failure('too-complex', '文字差异过大，无法可靠保留局部格式；请提供精确原文与上下文', previousText, nextText)
  }
  const leftEdits = editsFromOperations(left)
  const rightEdits = editsFromOperations(right)
  const ambiguityCells = (previous.length + 1) * (next.length + 1)
  const hasEffectiveRunStyle = runs.some(run => run.end > run.start && hasStyle(run.style))
  if (ambiguityCells > 1_000_000 && hasEffectiveRunStyle) {
    return failure(
      'too-complex',
      '文字重复映射超过安全判定范围，无法证明局部格式归属唯一；请提供精确原文与上下文',
      previousText,
      nextText,
      [leftEdits, rightEdits],
    )
  }
  const ambiguity = ambiguousMatchReason(previous, next, runs)
  if (ambiguity) {
    return failure(
      'ambiguous',
      `重复文字存在多个合法格式映射（${ambiguity}）；请提供唯一原文/上下文或当前选区`,
      previousText,
      nextText,
      [leftEdits, rightEdits],
    )
  }
  const leftResult = applyTextRunEdits(previousText, runs, leftEdits)
  const rightResult = applyTextRunEdits(previousText, runs, rightEdits)
  if (!leftResult.ok) return { ...leftResult, draftText: nextText }
  if (!rightResult.ok) return { ...rightResult, draftText: nextText }
  if (!sameRuns(leftResult.runs, rightResult.runs)) {
    return failure(
      'ambiguous',
      '重复文字存在多个合法格式映射；请提供唯一原文/上下文或当前选区',
      previousText,
      nextText,
      [leftEdits, rightEdits],
    )
  }
  return { ...leftResult, text: nextText }
}

/** Locate each requested original exactly once before applying any edit. */
export function locateTextRunReplacements(
  previousText: string,
  runs: TextRun[],
  replacements: readonly TextRunReplacement[],
): TextRunRemapResult {
  const edits: TextRunEdit[] = []
  for (let replacementIndex = 0; replacementIndex < replacements.length; replacementIndex += 1) {
    const replacement = replacements[replacementIndex]!
    if (!replacement.original) {
      return failure('invalid-range', `第 ${replacementIndex + 1} 处替换的原文不能为空`, previousText, previousText)
    }
    const matches: number[] = []
    for (let index = previousText.indexOf(replacement.original); index >= 0; index = previousText.indexOf(replacement.original, index + 1)) {
      const beforeMatches = replacement.contextBefore === undefined
        || previousText.slice(Math.max(0, index - replacement.contextBefore.length), index) === replacement.contextBefore
      const end = index + replacement.original.length
      const afterMatches = replacement.contextAfter === undefined
        || previousText.slice(end, end + replacement.contextAfter.length) === replacement.contextAfter
      if (beforeMatches && afterMatches) matches.push(index)
    }
    if (matches.length !== 1) {
      return failure(
        matches.length ? 'ambiguous' : 'stale-original',
        matches.length
          ? `第 ${replacementIndex + 1} 处原文匹配到 ${matches.length} 处；请补充唯一上下文`
          : `第 ${replacementIndex + 1} 处原文或上下文已变化`,
        previousText,
        previousText,
      )
    }
    const utf16Start = matches[0]!
    const start = Array.from(previousText.slice(0, utf16Start)).length
    const end = start + Array.from(replacement.original).length
    edits.push({ start, end, original: replacement.original, replacement: replacement.replacement })
  }
  return applyTextRunEdits(previousText, runs, edits)
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
 * Compatibility convenience for callers whose control flow already rejects
 * thrown edits. New interactive callers should inspect planTextRunRemap so an
 * ambiguous whole-text update can keep its source and draft explicitly.
 */
export function remapTextRuns(
  previousText: string,
  nextText: string,
  runs: TextRun[],
): TextRun[] {
  const result = planTextRunRemap(previousText, nextText, runs)
  if (!result.ok) throw new TextRunRemapError(result)
  return result.runs
}
