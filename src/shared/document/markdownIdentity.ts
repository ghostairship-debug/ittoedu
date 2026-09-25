import type { MarkdownDocument } from './markdown'
import type { MarkdownSourceMap } from './markdownSourceMap'
export interface MarkdownProjection { source: string; document: MarkdownDocument; sourceMap: MarkdownSourceMap }
/** Position mapping, never a search for matching prose. A second identical paragraph retains its own identity. */
export function retainMarkdownIdentities(next: MarkdownProjection, previous: MarkdownProjection): void {
  let from = 0, oldEnd = previous.source.length, newEnd = next.source.length
  while (from < oldEnd && from < newEnd && previous.source[from] === next.source[from]) from++
  while (oldEnd > from && newEnd > from && previous.source[oldEnd - 1] === next.source[newEnd - 1]) { oldEnd--; newEnd-- }
  const delta = newEnd - oldEnd, identities = new Map<string, string>(), used = new Set<string>()
  const oldAt = (position: number) => position <= from ? position : position >= newEnd ? position - delta : null
  const maps = [...next.sourceMap.blocks].sort((a, b) => Number(a.from < newEnd && a.to > from) - Number(b.from < newEnd && b.to > from))
  for (const map of maps) {
    const block = next.document.content.blocks.find(value => value.id === map.blockId)!
    const old = previous.sourceMap.blocks.find(value => !used.has(value.blockId) && value.from === oldAt(map.from))
      ?? previous.sourceMap.blocks.find(value => !used.has(value.blockId) && value.from <= from && value.to >= oldEnd && map.from <= from && map.to >= newEnd)
    const prior = old && previous.document.content.blocks.find(value => value.id === old.blockId)
    if (!old || !prior || prior.type !== block.type) continue
    used.add(old.blockId); identities.set(block.id, old.blockId)
    if (block.type === 'list' && prior.type === 'list') {
      const taken = new Set<string>()
      for (const [index, item] of block.items.entries()) {
        const slot = map.slots.find(slot => slot.key === `item:${item.id}`)
        const oldSlot = old.slots.find(priorSlot => priorSlot.key.startsWith('item:') && !taken.has(priorSlot.key) && priorSlot.from !== undefined && priorSlot.from === oldAt(slot?.from ?? -1))
        const id = oldSlot?.key.slice(5) ?? (block.items.length === prior.items.length ? prior.items[index]?.id : undefined)
        if (id && !taken.has(`item:${id}`)) { identities.set(item.id, id); taken.add(`item:${id}`) }
      }
    }
    if (block.type === 'table' && prior.type === 'table') {
      if (block.columns.length === prior.columns.length) block.columns.forEach((column, index) => identities.set(column.id, prior.columns[index].id))
      if (block.rows.length === prior.rows.length) block.rows.forEach((row, index) => identities.set(row.id, prior.rows[index].id))
    }
  }
  const replace = (value: unknown): unknown => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(replace)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [identities.get(key) ?? key, (key === 'id' || key === 'formulaId') && typeof item === 'string' ? identities.get(item) ?? item : replace(item)]))
    return value
  }
  next.document.content = replace(next.document.content) as MarkdownDocument['content']
  const key = (value: string) => {
    if (value.startsWith('cell:')) return `cell:${JSON.stringify((JSON.parse(value.slice(5)) as string[]).map(id => identities.get(id) ?? id))}`
    return value.replace(/^(item:|column:)(.*)$/, (_match, prefix, id) => prefix + (identities.get(id) ?? id))
  }
  for (const map of next.sourceMap.blocks) {
    map.blockId = identities.get(map.blockId) ?? map.blockId
    map.keys = map.keys.map(key); for (const slot of map.slots) slot.key = key(slot.key)
    if (map.table) { map.table.columns = map.table.columns.map(id => identities.get(id) ?? id); map.table.rows = map.table.rows.map(id => identities.get(id) ?? id) }
  }
}

/** Bind the parser's positional map to the already accepted editor projection of the same body. */
export function bindMarkdownIdentities(parsed: MarkdownProjection, document: MarkdownDocument): void {
  const previous = { source: parsed.source, document, sourceMap: structuredClone(parsed.sourceMap) }
  previous.sourceMap.blocks.forEach((block, index) => { block.blockId = document.content.blocks[index]?.id ?? block.blockId })
  retainMarkdownIdentities(parsed, previous)
}
