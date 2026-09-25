import { parseDocumentMarkdown, serializeDocumentMarkdown, serializeMarkdownInline, type MarkdownDocument, type MarkdownOptions } from './markdown'
import { documentTextSlots, type DocumentBlock, type FlowInline, type FlowTextContent } from './content'
import type { MarkdownSourceMap, SlotMap } from './markdownSourceMap'
type Edit = { from: number; to: number; insert: string }
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)
function comparable(block: DocumentBlock): unknown {
  const result = structuredClone(block) as unknown as Record<string, any>; delete result.id
  if (block.type === 'list') result.items = block.items.map(item => item.content)
  if (block.type === 'table') { result.columns = block.columns.map(column => column.header); result.rows = block.rows.map(row => block.columns.map(column => row.cells[column.id])) }
  if (block.type === 'section') result.blocks = block.blocks.map(comparable)
  return JSON.parse(JSON.stringify(result, (key, value) => key === 'formulaId' ? undefined : value))
}
export const sameMarkdownContent = (a: MarkdownDocument, b: MarkdownDocument) => stable(a.content.blocks.map(comparable)) === stable(b.content.blocks.map(comparable))
function atoms(content: FlowTextContent): FlowInline[] { return content.inlines.flatMap<FlowInline>(inline => inline.type === 'text' ? Array.from(inline.text, text => ({ ...inline, text })) : [inline]) }
const meta = (atom: FlowInline | undefined) => atom?.type === 'text' ? stable({ ...atom, text: '' }) : ''
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
function blockSource(block: DocumentBlock, resources: MarkdownDocument['resources']) {
  return serializeDocumentMarkdown({ content: { blocks: [block] }, resources }, 'file')
    .replace(/^<!--cw:block [^\n]*-->\n/gm, '').replace(/<!--cw:(?:item|row|column) [^\n]*?-->/g, '').replace(/\n$/, '')
}
function apply(source: string, edits: Edit[]) { for (const edit of edits.sort((a, b) => b.from - a.from || b.to - a.to)) source = source.slice(0, edit.from) + edit.insert + source.slice(edit.to); return source }
/** Preserve every untouched source byte. A fallback is limited to the structurally changed blocks, never the whole file. */
export function editMarkdownSource(source: string, before: MarkdownDocument, after: MarkdownDocument, map: MarkdownSourceMap, options: MarkdownOptions): string {
  if (sameMarkdownContent(before, after)) return source
  const edits: Edit[] = [], oldBlocks = before.content.blocks, blocks = after.content.blocks
  let local = oldBlocks.length === blocks.length && oldBlocks.every((block, index) => block.id === blocks[index].id && block.type === blocks[index].type)
  if (local) for (let index = 0; index < blocks.length; index++) {
    const old = oldBlocks[index], next = blocks[index]
    if (stable(old) === stable(next)) continue
    const oldSlots = documentTextSlots(old), newSlots = documentTextSlots(next), blockMap = map.blocks.find(value => value.blockId === old.id)
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
  const valid = (candidate: string) => { const result = parseDocumentMarkdown(candidate, options); return result.status === 'valid' && sameMarkdownContent(result.document, after) }
  if (local) { const candidate = apply(source, edits); if (valid(candidate)) return candidate }
  let first = 0, oldLast = oldBlocks.length, newLast = blocks.length
  while (first < oldLast && first < newLast && stable(oldBlocks[first]) === stable(blocks[first])) first++
  while (oldLast > first && newLast > first && stable(oldBlocks[oldLast - 1]) === stable(blocks[newLast - 1])) { oldLast--; newLast-- }
  const start = map.blocks[first]?.from ?? source.length
  const end = oldLast > first ? map.blocks[oldLast - 1].to : start
  const body = blocks.slice(first, newLast).map(block => blockSource(block, after.resources)).join('\n\n')
  const insertion = oldLast === first && body ? (start === source.length && source && !source.endsWith('\n\n') ? '\n\n' : '') + body + (start < source.length ? '\n\n' : '') : body
  const candidate = source.slice(0, start) + insertion + source.slice(end)
  if (!valid(candidate)) throw new Error('这次正文结构无法完整对应源文，输入仍保留；请撤销该步后重试。')
  return candidate
}
