import type { Token, Tokens } from 'marked'
import { decodeHTMLStrict } from 'entities'
import { documentTextSlots, type DocumentBlock } from './content'
import type { DocumentSelection, DocumentSlot, DocumentSourceRange } from './ports'

/** `barrier` marks a unit that carries syntax the visible text cannot reproduce: an edit
 * must never include it, so a selection that would have to is rejected instead. */
interface Unit { from: number; to: number; text: string; barrier?: true }
interface SlotMap { key: string; units: Unit[] }
/** `keys` keeps the block's own slot order, including slots this map could not locate, so a
 * selection across an unlocatable slot is still visible to the caller. */
export interface MarkdownBlockMap { blockId: string; from: number; to: number; keys: string[]; slots: SlotMap[]; table?: { rows: string[]; columns: string[] } }
export interface MarkdownSourceMap { blocks: MarkdownBlockMap[] }
interface Projection { text: string; positions: number[] }
/** The parser accepts this syntax, but its local source span cannot be proven; only this
 * failure may drop a slot. Any other error (a type error, a stack overflow, an unexpected
 * Error) is a mapping defect and must reach the caller instead of degrading to `unmapped`. */
class UnmappedSyntax extends Error {
  constructor(syntax: string) { super(syntax) }
}
const cut = (p: Projection, from: number, to = p.text.length): Projection => ({ text: p.text.slice(from, to), positions: p.positions.slice(from, to) })
/** Materializes index ranges of one projection, in the given order. */
function slice(p: Projection, ranges: readonly (readonly [number, number])[]): Projection {
  let text = ''; const positions: number[] = []
  for (const [from, to] of ranges) { text += p.text.slice(from, to); positions.push(...p.positions.slice(from, to)) }
  return { text, positions }
}
function omit(p: Projection, pattern: RegExp): Projection {
  const positions: number[] = []; let text = '', at = 0
  for (const m of p.text.matchAll(pattern)) { text += p.text.slice(at, m.index); positions.push(...p.positions.slice(at, m.index)); at = m.index! + m[0].length }
  return { text: text + p.text.slice(at), positions: positions.concat(p.positions.slice(at)) }
}
/** Removes syntax and reports the source span of every removal, in projection order. */
function omitSpans(p: Projection, pattern: RegExp): { projection: Projection; spans: { from: number; to: number }[] } {
  const positions: number[] = []; const spans: { from: number; to: number }[] = []; let text = '', at = 0
  for (const m of p.text.matchAll(pattern)) {
    text += p.text.slice(at, m.index); positions.push(...p.positions.slice(at, m.index))
    spans.push({ from: p.positions[m.index!]!, to: p.positions[m.index! + m[0].length - 1]! + 1 })
    at = m.index! + m[0].length
  }
  return { projection: { text: text + p.text.slice(at), positions: positions.concat(p.positions.slice(at)) }, spans }
}
function trim(p: Projection): Projection { const left = p.text.length - p.text.trimStart().length; return cut(p, left, p.text.trimEnd().length) }
function unit(p: Projection, from: number, to: number, text: string): Unit { return { from: p.positions[from]!, to: p.positions[to - 1]! + 1, text } }
function characters(p: Projection, decode: boolean): Unit[] {
  const result: Unit[] = []
  for (let i = 0; i < p.text.length;) {
    const entity = decode && /^&(?:#x[\da-f]+|#\d+|[a-z][\da-z]+);/i.exec(p.text.slice(i))
    if (entity && decodeHTMLStrict(entity[0]) !== entity[0]) {
      for (const c of decodeHTMLStrict(entity[0])) result.push(unit(p, i, i + entity[0].length, c))
      i += entity[0].length
    } else { const c = String.fromCodePoint(p.text.codePointAt(i)!); result.push(unit(p, i, i + c.length, c === '\n' ? ' ' : c)); i += c.length }
  }
  return result
}
function inlineUnits(p: Projection, lex: (source: string) => Token[]): Unit[] {
  const result: Unit[] = []; let offset = 0
  for (const token of lex(p.text)) {
    if (p.text.slice(offset, offset + token.raw.length) !== token.raw) throw new UnmappedSyntax('token span mismatch')
    const q = cut(p, offset, offset + token.raw.length), t = token as Tokens.Generic
    offset += token.raw.length
    switch (token.type) {
      case 'text': result.push(...characters(q, true)); break
      case 'escape': result.push(unit(q, 0, q.text.length, decodeHTMLStrict(t.text as string))); break
      case 'br': result.push(unit(q, 0, q.text.length, '\n')); break
      case 'strong': case 'em': case 'del': {
        const n = token.type === 'em' ? 1 : 2
        result.push(...inlineUnits(cut(q, n, q.text.length - n), lex)); break
      }
      case 'cwStyle': result.push(...inlineUnits(cut(q, 1, 1 + (t.text as string).length), lex)); break
      case 'link': {
        // A bare URL or `www` autolink has no markup to skip: marked emits it with the raw
        // equal to its own text, so re-lexing it would repeat itself forever.
        if (!q.text.startsWith('[') && !q.text.startsWith('<')) { result.push(...characters(q, true)); break }
        const children = (t.tokens as Token[]).map(child => child.raw).join('')
        const at = q.text.indexOf(children, 1)
        if (at < 1 || at + children.length > q.text.length) throw new UnmappedSyntax('link text')
        result.push(...inlineUnits(cut(q, at, at + children.length), lex)); break
      }
      case 'codespan': {
        const n = /^`+/.exec(q.text)![0].length
        let body = cut(q, n, q.text.length - n)
        if (body.text.startsWith(' ') && body.text.endsWith(' ') && /[^ ]/.test(body.text)) body = cut(body, 1, body.text.length - 1)
        const chars = characters(body, false)
        if (chars.map(c => c.text).join('') !== t.text) throw new UnmappedSyntax('code span mismatch')
        result.push(...chars); break
      }
      case 'cwMath': result.push(unit(q, 0, q.text.length, '\uFFFC')); break
      default: throw new UnmappedSyntax('unmapped inline')
    }
  }
  if (offset !== p.text.length) throw new UnmappedSyntax('incomplete inline map')
  return result
}
/** marked separates blocks with newlines and never counts them as text, but it leaves a
 * different number of them in each token's raw: a paragraph keeps the one that ends its own
 * last line (`"段落\n"`), while a heading followed by a blank line keeps that blank line too
 * (`"# a\n\n"`). Every trailing newline is block separation, so all of them are dropped.
 *
 * Spaces are not: a block's own leading and trailing spaces are visible text that the parsed
 * text also carries (`"  甲  \n"` parses to `"  甲  "`), so trimming whitespace here would make
 * the unit text disagree with the parsed text and silently drop an otherwise locatable slot. */
const blockBody = (p: Projection): Projection => cut(p, 0, p.text.replace(/\n+$/, '').length)
/** marked builds an item's text from its own raw: the marker and the first line's own
 * indentation are dropped, and every continuation line is cut at the same column. A line
 * indented less continues lazily and keeps its own leading spaces. Tabs are rejected
 * because marked expands them, which would move every following source offset.
 *
 * A continuation line cut at `column` leaves its indentation in a hole between two ranges, so
 * the break before it is reported as a barrier: rewriting that break on its own would leave the
 * spaces behind as visible text, and when they end up trailing the new text they become a hard
 * line break the item text never had. Lazy lines keep their own spaces inside the range, so no
 * hole exists and no barrier is needed. */
function listItemBody(raw: Projection): { projection: Projection; barriers: { from: number }[] } | null {
  if (raw.text.includes('\t')) return null
  const lines: Projection[] = []; let at = 0
  for (const line of raw.text.split('\n')) { lines.push(cut(raw, at, at + line.length)); at += line.length + 1 }
  if (lines.length > 1 && !lines.at(-1)!.text) lines.pop()
  const marker = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]*)/.exec(lines[0]!.text)
  if (!marker) return null
  const rest = cut(lines[0]!, marker[0].length)
  const indent = /^ */.exec(rest.text)![0].length
  const blank = !rest.text.trim()
  if (!blank && !marker[3]!.length) return null
  const column = blank ? marker[2]!.length + 1 : marker[0].length + (indent > 4 ? 1 : indent)
  const ranges: (readonly [number, number])[] = []; const barriers: { from: number }[] = []
  at = 0
  for (const [index, line] of lines.entries()) {
    const start = index === 0 ? (blank ? line.text.length : column) : !line.text.trim() ? Math.min(column, line.text.length) : /^ */.exec(line.text)![0].length >= column ? column : 0
    if (index > 0) {
      ranges.push([at - 1, at])
      if (start > 0) barriers.push({ from: raw.positions[at]! })
    }
    ranges.push([at + start, at + line.text.length])
    at += line.text.length + 1
  }
  return { projection: slice(raw, ranges), barriers }
}

/** Called by the parser with the exact token and the identities it allocated.
 * No text search is used to infer a block or a selected occurrence. */
export function mapMarkdownBlock(token: Token, block: DocumentBlock, offset: number, lex: (source: string) => Token[]): MarkdownBlockMap {
  const p: Projection = { text: token.raw, positions: Array.from({ length: token.raw.length }, (_, i) => offset + i) }
  const slots = documentTextSlots(block)
  const map: MarkdownBlockMap = { blockId: block.id, from: offset, to: offset + token.raw.trimEnd().length, keys: slots.map(slot => slot.key), slots: [] }
  const add = (key: string, source: Projection, barriers: readonly { from: number }[] = []) => {
    // A token can become a block that carries no such slot (an image-only paragraph becomes
    // a media block); it owns no text here, so there is nothing to map or to fail on.
    const slot = slots.find(slot => slot.key === key)
    if (!slot) return
    const expected = slot.content.inlines.map(i => i.type === 'text' ? i.text : '\uFFFC').join('')
    let units: Unit[]
    try { units = inlineUnits(source, lex) } catch (error) {
      // Syntax without a provable local map may drop its slot; a mapping defect must not.
      if (error instanceof UnmappedSyntax) return
      throw error
    }
    if (expected !== units.map(u => u.text).join('')) return
    for (const barrier of barriers) {
      // Replacing the break before a removed marker would leave that marker as visible text.
      const carried = units.filter(u => u.from < barrier.from).at(-1)
      if (carried) carried.barrier = true
    }
    map.slots.push({ key, units })
  }
  if (['paragraph', 'heading', 'text', 'blockquote'].includes(token.type)) {
    let body = blockBody(p)
    if (token.type === 'heading') {
      const prefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(body.text)
      body = prefix ? cut(body, prefix[0].length) : cut(body, 0, body.text.lastIndexOf('\n'))
      body = omit(body, /[ \t]+#+[ \t]*(?=\n?$)/g)
    }
    if (token.type === 'blockquote') {
      // marked removed a marker from every line after the first one, so no unit may span
      // the break that carries it: that unit would map to a newline the body does not have.
      // This branch must not trim: the barrier spans below are indices into this projection.
      const { projection, spans } = omitSpans(body, /^ {0,3}>[ \t]?/gm)
      add('content', projection, spans)
    } else add('content', body)
  } else if (token.type === 'list' && block.type === 'list') {
    let at = 0
    for (const [index, item] of (token as Tokens.List).items.entries()) {
      // ListItem.raw includes its own marker and indentation; each token is consumed once.
      while (p.text[at] === '\n') at++
      if (p.text.slice(at, at + item.raw.length) !== item.raw) break
      const body = listItemBody(cut(p, at, at + item.raw.length)); at += item.raw.length
      const id = block.items[index]?.id
      if (body && id !== undefined) add(`item:${id}`, omit(body.projection, /<!--cw:item\s+[\s\S]*?-->/g), body.barriers)
    }
  } else if (token.type === 'table' && block.type === 'table') {
    map.table = { rows: block.rows.map(row => row.id), columns: block.columns.map(column => column.id) }
    let at = 0
    const lines: Projection[] = []
    for (const line of p.text.split('\n')) { lines.push(cut(p, at, at + line.length)); at += line.length + 1 }
    const cells = (line: Projection): Projection[] => {
      line = trim(line); if (line.text.startsWith('|')) line = cut(line, 1)
      if (line.text.endsWith('|') && !line.text.endsWith('\\|')) line = cut(line, 0, line.text.length - 1)
      const values: Projection[] = []; let start = 0
      for (let i = 0; i < line.text.length; i++) { if (line.text[i] === '\\') { i++; continue }; if (line.text[i] === '|') { values.push(trim(cut(line, start, i))); start = i + 1 } }
      values.push(trim(cut(line, start))); return values
    }
    const headers = cells(lines[0]!)
    block.columns.forEach((c, i) => { if (headers[i]) add(`column:${c.id}`, trim(omit(headers[i]!, /<!--cw:column\s+[\s\S]*?-->/g))) })
    block.rows.forEach((r, row) => {
      const values = lines[row + 2] ? cells(lines[row + 2]!) : []
      block.columns.forEach((c, col) => { if (values[col]) add(`cell:${JSON.stringify([r.id, c.id])}`, omit(values[col]!, /<!--cw:row\s+[\s\S]*?-->/g)) })
    })
  }
  return map
}

export function slotKey(slot: DocumentSlot): string {
  switch (slot.kind) { case 'field': return slot.field; case 'item': return `item:${slot.itemId}`; case 'header': return `column:${slot.columnId}`; case 'cell': return `cell:${JSON.stringify([slot.rowId, slot.columnId])}` }
}
export type SelectionSourceResult = { status: 'mapped'; ranges: DocumentSourceRange[] } | { status: 'unmapped'; message: string }
function unitsToRanges(source: string, units: Unit[]): DocumentSourceRange[] {
  const ranges: DocumentSourceRange[] = []
  for (const u of units) {
    const last = ranges.at(-1)
    if (last && u.from <= last.to) { last.to = Math.max(last.to, u.to); last.before = source.slice(last.from, last.to) }
    else ranges.push({ from: u.from, to: u.to, before: source.slice(u.from, u.to) })
  }
  return ranges
}
export function mapDocumentSelectionToSource(source: string, map: MarkdownSourceMap, selection: DocumentSelection): SelectionSourceResult {
  const fail = (): SelectionSourceResult => ({ status: 'unmapped', message: '此选区暂时无法精确对应源文，请在源文模式选择要修改的内容。' })
  if (selection.kind === 'object') {
    const b = map.blocks.find(b => b.blockId === selection.blockId)
    return b ? { status: 'mapped', ranges: [{ from: b.from, to: b.to, before: source.slice(b.from, b.to) }] } : fail()
  }
  if (selection.kind === 'cells') {
    const block = map.blocks.find(b => b.blockId === selection.tableId), table = block?.table
    if (!table) return fail()
    const ar = table.rows.indexOf(selection.anchor.rowId), hr = table.rows.indexOf(selection.head.rowId)
    const ac = table.columns.indexOf(selection.anchor.columnId), hc = table.columns.indexOf(selection.head.columnId)
    if (Math.min(ar, hr, ac, hc) < 0) return fail()
    const units: Unit[] = []
    for (let r = Math.min(ar, hr); r <= Math.max(ar, hr); r++) for (let c = Math.min(ac, hc); c <= Math.max(ac, hc); c++) {
      const slot = block!.slots.find(slot => slot.key === slotKey({ kind: 'cell', rowId: table.rows[r]!, columnId: table.columns[c]! }))
      if (!slot?.units.length || slot.units.some(u => u.barrier)) return fail()
      units.push(...slot.units)
    }
    return { status: 'mapped', ranges: unitsToRanges(source, units) }
  }
  // Walk the document's own slot order, so a slot this map could not locate stays visible.
  const blocks = new Map(map.blocks.map(block => [block.blockId, block]))
  const order = map.blocks.flatMap(block => block.keys.map(key => ({ blockId: block.blockId, key })))
  const a = order.findIndex(s => s.blockId === selection.anchor.blockId && s.key === slotKey(selection.anchor.slot))
  const h = order.findIndex(s => s.blockId === selection.head.blockId && s.key === slotKey(selection.head.slot))
  if (a < 0 || h < 0) return fail()
  const forward = a < h || a === h && selection.anchor.offset <= selection.head.offset
  const start = forward ? selection.anchor : selection.head, end = forward ? selection.head : selection.anchor
  const low = Math.min(a, h), high = Math.max(a, h), units: Unit[] = []
  const firstBlock = map.blocks.findIndex(b => b.blockId === start.blockId), lastBlock = map.blocks.findIndex(b => b.blockId === end.blockId)
  // Intervening objects or unsupported slots must never silently disappear.
  if (firstBlock !== lastBlock) return fail()
  for (let i = low; i <= high; i++) {
    const entry = order[i]!, slot = blocks.get(entry.blockId)?.slots.find(s => s.key === entry.key)
    // Text between the selected slots that this map cannot locate may not be skipped over.
    if (!slot || !slot.units.length) return fail()
    const from = i === low ? start.offset : 0, to = i === high ? end.offset : slot.units.length
    if (from < 0 || to > slot.units.length || from > to) return fail()
    if (from > 0 && slot.units[from]?.from === slot.units[from - 1]?.from || to < slot.units.length && to > 0 && slot.units[to]?.from === slot.units[to - 1]?.from) return fail()
    const picked = slot.units.slice(from, to)
    // A unit carrying removed syntax (a quote marker) cannot be rewritten by an edit.
    if (picked.some(u => u.barrier)) return fail()
    units.push(...picked)
  }
  if (!units.length) return fail()
  return { status: 'mapped', ranges: unitsToRanges(source, units) }
}
