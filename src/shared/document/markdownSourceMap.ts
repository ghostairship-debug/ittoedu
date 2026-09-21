import type { Token, Tokens } from 'marked'
import { decodeHTMLStrict } from 'entities'
import { documentTextSlots, type DocumentBlock } from './content'
import type { DocumentSelection, DocumentSlot, DocumentSourceRange } from './ports'

interface Unit { from: number; to: number; text: string }
interface SlotMap { key: string; units: Unit[] }
export interface MarkdownBlockMap { blockId: string; from: number; to: number; slots: SlotMap[]; table?: { rows: string[]; columns: string[] } }
export interface MarkdownSourceMap { blocks: MarkdownBlockMap[] }
interface Projection { text: string; positions: number[] }
const cut = (p: Projection, from: number, to = p.text.length): Projection => ({ text: p.text.slice(from, to), positions: p.positions.slice(from, to) })
function omit(p: Projection, pattern: RegExp): Projection {
  const positions: number[] = []; let text = '', at = 0
  for (const m of p.text.matchAll(pattern)) { text += p.text.slice(at, m.index); positions.push(...p.positions.slice(at, m.index)); at = m.index! + m[0].length }
  return { text: text + p.text.slice(at), positions: positions.concat(p.positions.slice(at)) }
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
    if (p.text.slice(offset, offset + token.raw.length) !== token.raw) throw new Error('token span mismatch')
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
        const children = (t.tokens as Token[]).map(child => child.raw).join('')
        const start = q.text.startsWith('[') || q.text.startsWith('<') ? 1 : 0
        if (q.text.slice(start, start + children.length) !== children) throw new Error('link span mismatch')
        result.push(...inlineUnits(cut(q, start, start + children.length), lex)); break
      }
      case 'codespan': {
        const n = /^`+/.exec(q.text)![0].length
        let body = cut(q, n, q.text.length - n)
        if (body.text.startsWith(' ') && body.text.endsWith(' ') && /[^ ]/.test(body.text)) body = cut(body, 1, body.text.length - 1)
        const chars = characters(body, false)
        if (chars.map(c => c.text).join('') !== t.text) throw new Error('code span mismatch')
        result.push(...chars); break
      }
      case 'cwMath': result.push(unit(q, 0, q.text.length, '\uFFFC')); break
      default: throw new Error('unmapped inline')
    }
  }
  if (offset !== p.text.length) throw new Error('incomplete inline map')
  return result
}

/** Called by the parser with the exact token and the identities it allocated.
 * No text search is used to infer a block or a selected occurrence. */
export function mapMarkdownBlock(token: Token, block: DocumentBlock, offset: number, lex: (source: string) => Token[]): MarkdownBlockMap {
  const p: Projection = { text: token.raw, positions: Array.from({ length: token.raw.length }, (_, i) => offset + i) }
  const map: MarkdownBlockMap = { blockId: block.id, from: offset, to: offset + token.raw.trimEnd().length, slots: [] }
  const slots = documentTextSlots(block)
  const add = (key: string, source: Projection) => {
    try {
      const expected = slots.find(slot => slot.key === key)?.content.inlines.map(i => i.type === 'text' ? i.text : '\uFFFC').join('')
      const units = inlineUnits(source, lex)
      if (expected === units.map(u => u.text).join('')) map.slots.push({ key, units })
    } catch { /* A valid document can use syntax without a provable local map. */ }
  }
  if (['paragraph', 'heading', 'text', 'blockquote'].includes(token.type)) {
    let body = p
    if (token.type === 'heading') {
      const prefix = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(body.text)
      body = prefix ? cut(body, prefix[0].length) : cut(body, 0, body.text.lastIndexOf('\n'))
      body = omit(body, /[ \t]+#+[ \t]*(?=\n?$)/g)
    }
    if (token.type === 'blockquote') body = omit(body, /^ {0,3}>[ \t]?/gm)
    add('content', trim(body))
  } else if (token.type === 'list' && block.type === 'list') {
    let at = 0
    for (const [index, item] of (token as Tokens.List).items.entries()) {
      // ListItem.raw includes its own marker and indentation; each token is consumed once.
      while (p.text[at] === '\n') at++
      if (p.text.slice(at, at + item.raw.length) !== item.raw) break
      let body = cut(p, at, at + item.raw.length); at += item.raw.length
      body = omit(body, /^ {0,3}(?:[-+*]|\d+[.)])[ \t]+/g)
      body = omit(body, /<!--cw:item\s+[\s\S]*?-->/g)
      add(`item:${block.items[index]!.id}`, trim(body))
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
      if (!slot?.units.length) return fail()
      units.push(...slot.units)
    }
    return { status: 'mapped', ranges: unitsToRanges(source, units) }
  }
  const slots = map.blocks.flatMap(b => b.slots.map(s => ({ ...s, blockId: b.blockId })))
  const a = slots.findIndex(s => s.blockId === selection.anchor.blockId && s.key === slotKey(selection.anchor.slot))
  const h = slots.findIndex(s => s.blockId === selection.head.blockId && s.key === slotKey(selection.head.slot))
  if (a < 0 || h < 0) return fail()
  const forward = a < h || a === h && selection.anchor.offset <= selection.head.offset
  const start = forward ? selection.anchor : selection.head, end = forward ? selection.head : selection.anchor
  const low = Math.min(a, h), high = Math.max(a, h), units: Unit[] = []
  const firstBlock = map.blocks.findIndex(b => b.blockId === start.blockId), lastBlock = map.blocks.findIndex(b => b.blockId === end.blockId)
  // Intervening objects or unsupported slots must never silently disappear.
  if (firstBlock !== lastBlock) return fail()
  for (let i = low; i <= high; i++) {
    const s = slots[i]!, from = i === low ? start.offset : 0, to = i === high ? end.offset : s.units.length
    if (from < 0 || to > s.units.length || from > to) return fail()
    if (from > 0 && s.units[from]?.from === s.units[from - 1]?.from || to < s.units.length && to > 0 && s.units[to]?.from === s.units[to - 1]?.from) return fail()
    units.push(...s.units.slice(from, to))
  }
  if (!units.length) return fail()
  return { status: 'mapped', ranges: unitsToRanges(source, units) }
}
