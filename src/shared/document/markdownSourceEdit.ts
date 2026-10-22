import { parseDocumentMarkdown, serializeDocumentMarkdown, serializeMarkdownInline, type MarkdownDocument, type MarkdownOptions } from './markdown'
import { documentTextSlots, type DocumentBlock, type FlowInline, type FlowTextContent } from './content'
import type { MarkdownBlockMap, MarkdownSourceMap, SlotMap } from './markdownSourceMap'
type Edit = { from: number; to: number; insert: string }
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
function comparable(block: DocumentBlock): unknown {
  const result = structuredClone(block) as unknown as Record<string, any>
  if (block.type !== 'course-instance') delete result.id
  if (block.type === 'list') result.items = block.items.map(item => item.content)
  if (block.type === 'table') { result.columns = block.columns.map(column => column.header); result.rows = block.rows.map(row => block.columns.map(column => row.cells[column.id])) }
  if (block.type === 'section') result.blocks = block.blocks.map(comparable)
  if (block.type === 'course-instance' && block.blocks !== undefined) result.blocks = block.blocks.map(comparable)
  return JSON.parse(JSON.stringify(result, (key, value) => key === 'formulaId' ? undefined : value))
}
export const sameMarkdownContent = (a: MarkdownDocument, b: MarkdownDocument) => stable(a.content.blocks.map(comparable)) === stable(b.content.blocks.map(comparable))
function atoms(content: FlowTextContent): FlowInline[] { return content.inlines.flatMap<FlowInline>(inline => inline.type === 'text' ? Array.from(inline.text, text => ({ ...inline, text })) : [inline]) }
const meta = (atom: FlowInline | undefined) => atom?.type === 'text' ? stable({ ...atom, text: '' }) : ''
function structureWithoutText(block: DocumentBlock): string {
  const copy = structuredClone(block)
  for (const slot of documentTextSlots(copy)) slot.content.inlines = []
  return stable(copy)
}
function slotEdit(source: string, slot: SlotMap | undefined, before: FlowTextContent, after: FlowTextContent): Edit | null {
  if (!slot) return null
  const old = atoms(before), next = atoms(after), units = slot.units
  if (units.length !== old.length) return null
  let from = 0, oldEnd = old.length, newEnd = next.length
  while (from < oldEnd && from < newEnd && stable(old[from]) === stable(next[from])) from++
  while (oldEnd > from && newEnd > from && stable(old[oldEnd - 1]) === stable(next[newEnd - 1])) { oldEnd--; newEnd-- }
  if (from === oldEnd && from === newEnd) return null
  if (from > 0 && units[from]?.from === units[from - 1]?.from || oldEnd < units.length && oldEnd > 0 && units[oldEnd]?.from === units[oldEnd - 1]?.from) return null
  const start = units[from]?.from ?? units.at(-1)?.to ?? slot.from
  const end = oldEnd > from ? units[oldEnd - 1]?.to : start
  if (start === undefined || end === undefined) return null
  const inserted = next.slice(from, newEnd), removed = old.slice(from, oldEnd)
  const context = removed[0] ?? old[from - 1] ?? old[from]
  const inherited = context?.type === 'text' && removed.every(value => meta(value) === meta(context)) && inserted.every(value => meta(value) === meta(context))
  let insert = inherited && context.code ? inserted.map(value => value.type === 'text' ? value.text : '').join('')
    : serializeMarkdownInline({ inlines: inherited ? inserted.map(value => ({ type: 'text', text: value.type === 'text' ? value.text : '' })) : inserted })
  if (insert.includes('\n')) {
    const lineStart = source.lastIndexOf('\n', start - 1) + 1
    const prefix = source.slice(lineStart, start).match(/^( {0,3}>[ \t]?|[ \t]*(?:[-+*]|\d+[.)])[ \t]+)/)?.[0]
    if (prefix) insert = insert.replace(/\n/g, '\n' + (prefix.includes('>') ? prefix : ' '.repeat(prefix.length)))
  }
  return { from: start, to: end, insert }
}
function blockSource(block: DocumentBlock, resources: MarkdownDocument['resources'], map?: MarkdownSourceMap) {
  if(block.type==='list') {
    const slots=map?.blocks.find(value=>value.blockId===block.id)?.slots
    if(slots?.some(slot=>(slot.depth ?? 0)>0)) {
      let depth=0,ordered=block.ordered
      const ordinals = new Map<number, number>()
      const indents = new Map<number, string>([[0, '']])
      return block.items.map(item=>{const slot=slots.find(slot=>slot.key===`item:${item.id}`),previousDepth=depth;depth=slot?.depth ?? depth;ordered=slot?.ordered ?? ordered
        for(const level of ordinals.keys()) if(level>depth || depth>previousDepth && level>=depth) ordinals.delete(level)
        const ordinal=ordinals.get(depth) ?? slot?.ordinal ?? (depth===0 ? block.start ?? 1 : 1)
        if(ordered) ordinals.set(depth,ordinal+1); else ordinals.delete(depth)
        const marker=ordered ? `${ordinal}.`:'-',indent=indents.get(depth) ?? '  '.repeat(depth)
        indents.set(depth+1,indent+' '.repeat(marker.length+1))
        return `${indent}${marker} ${serializeMarkdownInline(item.content)}`}).join('\n')
    }
  }
  return serializeDocumentMarkdown({ content: { blocks: [block] }, resources }, 'file')
    .replace(/<!--cw:(?:item|row|column) [^\n]*?-->/g, '').replace(/\n$/, '')
}
function apply(source: string, edits: Edit[]) { for (const edit of edits.sort((a, b) => b.from - a.from || b.to - a.to)) source = source.slice(0, edit.from) + edit.insert + source.slice(edit.to); return source }
function rawSourceEdit(source: string, map: MarkdownBlockMap | undefined, before: DocumentBlock, after: DocumentBlock): Edit | null {
  if (!map?.rawSource || before.type !== 'code' || after.type !== 'code' || before.language !== after.language) return null
  let from = 0, oldEnd = before.code.length, newEnd = after.code.length
  while (from < oldEnd && from < newEnd && before.code[from] === after.code[from]) from++
  while (oldEnd > from && newEnd > from && before.code[oldEnd - 1] === after.code[newEnd - 1]) { oldEnd--; newEnd-- }
  const originalOffset = (normalized: number) => {
    let offset = map.from
    for (let n = 0; n < normalized; n++, offset++) if (source[offset] === '\r' && source[offset + 1] === '\n') offset++
    return offset
  }
  const newline = source.slice(map.from, map.to).match(/\r\n|\r|\n/)?.[0] ?? source.match(/\r\n|\r|\n/)?.[0] ?? '\n'
  return { from: originalOffset(from), to: originalOffset(oldEnd), insert: after.code.slice(from, newEnd).replace(/\r\n?|\n/g, newline) }
}
/** Preserve every untouched source byte. A fallback is limited to the structurally changed blocks, never the whole file. */
export function editMarkdownSource(source: string, before: MarkdownDocument, after: MarkdownDocument, map: MarkdownSourceMap, options: MarkdownOptions): string {
  if (sameMarkdownContent(before, after)) return source
  const edits: Edit[] = [], oldBlocks = before.content.blocks, blocks = after.content.blocks
  const spansById = new Map(map.blocks.map(span => [span.blockId, span]))
  const oldById = new Map(oldBlocks.map((block, index) => [block.id, { block, index, span: spansById.get(block.id) }]))
  const nextById = new Map(blocks.map(block => [block.id, block]))
  let local = oldBlocks.length === blocks.length && oldBlocks.every((block, index) => block.id === blocks[index].id && block.type === blocks[index].type)
  if (local) for (let index = 0; index < blocks.length; index++) {
    const old = oldBlocks[index], next = blocks[index]
    if (stable(old) === stable(next)) continue
    const oldSlots = documentTextSlots(old), newSlots = documentTextSlots(next), blockMap = map.blocks.find(value => value.blockId === old.id)
    const rawEdit = rawSourceEdit(source, blockMap, old, next)
    if (rawEdit) { edits.push(rawEdit); continue }
    // Slot patches cover text only. Keep simultaneous heading/metadata/child
    // changes on the structural path even when a raw repair changes its model.
    if (structureWithoutText(old) !== structureWithoutText(next)) { local = false; break }
    const patches: Edit[] = []
    if (oldSlots.length !== newSlots.length || !oldSlots.length) { local = false; break }
    for (const slot of oldSlots) {
      const updated = newSlots.find(value => value.key === slot.key)
      if (!updated) { local = false; break }
      if (stable(slot.content) === stable(updated.content)) continue
      const edit = slotEdit(source, blockMap?.slots.find(value => value.key === slot.key), slot.content, updated.content)
      if (!edit) { local = false; break }; patches.push(edit)
    }
    edits.push(...patches)
  }
  // Repairing a raw fragment can turn it into several rendered blocks. Its source
  // edit is authoritative; the old code projection is not the expected new model.
  const repairingSource = oldBlocks.some(old => {
    const next = nextById.get(old.id), span = oldById.get(old.id)?.span
    return span?.rawSource && next && stable(old) !== stable(next) && rawSourceEdit(source, span, old, next)
  })
  const valid = (candidate: string) => { const result = parseDocumentMarkdown(candidate, options); return result.status === 'valid' && (repairingSource || sameMarkdownContent(result.document, after)) }
  if (local) { const candidate = apply(source, edits); if (valid(candidate)) return candidate }
  let first = 0, oldLast = oldBlocks.length, newLast = blocks.length
  while (first < oldLast && first < newLast && stable(oldBlocks[first]) === stable(blocks[first])) first++
  while (oldLast > first && newLast > first && stable(oldBlocks[oldLast - 1]) === stable(blocks[newLast - 1])) { oldLast--; newLast-- }
  const start = map.blocks[first]?.from ?? source.length
  const end = oldLast > first ? map.blocks[oldLast - 1].to : start
  const newline = source.match(/\r\n|\r|\n/)?.[0] ?? '\n'
  const pieces = blocks.slice(first, newLast).map(block => {
    const prior = oldById.get(block.id), index = prior?.index ?? -1, old = prior?.block, span = prior?.span
    if (old && span && stable(old) === stable(block)) return { index, text: source.slice(span.from, span.to) }
    const rawEdit = old && rawSourceEdit(source, span, old, block)
    if (rawEdit && span) return { index, text: source.slice(span.from, rawEdit.from) + rawEdit.insert + source.slice(rawEdit.to, span.to) }
    const ending = span ? source.slice(span.from, span.to).match(/(?:\r\n|\r|\n)+$/)?.[0] ?? '' : newline
    return { index, text: blockSource(block, after.resources, map).replace(/\n/g, newline) + ending }
  })
  let body = ''
  pieces.forEach((piece, index) => {
    const previous = pieces[index - 1]
    if (previous) {
      if (previous.index >= 0 && piece.index === previous.index + 1) body += source.slice(map.blocks[previous.index].to, map.blocks[piece.index].from)
      else { const count = body.match(/(?:\r\n|\r|\n)+$/)?.[0].match(/\r\n|\r|\n/g)?.length ?? 0; body += newline.repeat(Math.max(0, 2 - count)) }
    }
    body += piece.text
  })
  let insertion = body
  if (oldLast === first && body) {
    const beforeCount = source.slice(0, start).match(/(?:\r\n|\r|\n)+$/)?.[0].match(/\r\n|\r|\n/g)?.length ?? 0
    if (start > 0) insertion = newline.repeat(Math.max(0, 2 - beforeCount)) + insertion
    if (start < source.length) { const count = insertion.match(/(?:\r\n|\r|\n)+$/)?.[0].match(/\r\n|\r|\n/g)?.length ?? 0; insertion += newline.repeat(Math.max(0, 2 - count)) }
  }
  const candidate = source.slice(0, start) + insertion + source.slice(end)
  if (!valid(candidate)) throw new Error('这次正文结构无法完整对应源文，输入仍保留；请撤销该步后重试。')
  return candidate
}
