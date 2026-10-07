import type { MarkdownDocument } from './markdown'
import type { MarkdownSourceMap } from './markdownSourceMap'
export interface MarkdownProjection { source: string; document: MarkdownDocument; sourceMap: MarkdownSourceMap }
/** Software metadata is not authored text. Compare the same visible source when a caller omits it. */
function identityView(projection: MarkdownProjection): MarkdownProjection {
  const removed = [...projection.source.matchAll(/<!--cw:(?:block|item|row|column)\s+[\s\S]*?-->(?:\r?\n)?/g)]
  if (!removed.length) return projection
  const position = (offset: number) => offset - removed.reduce((total, match) =>
    total + Math.max(0, Math.min(offset - match.index!, match[0].length)), 0)
  return { ...projection, source: projection.source.replace(/<!--cw:(?:block|item|row|column)\s+[\s\S]*?-->(?:\r?\n)?/g, ''),
    sourceMap: { blocks: projection.sourceMap.blocks.map(block => ({ ...block, from: position(block.from), to: position(block.to),
      slots: block.slots.map(slot => ({ ...slot, ...(slot.from !== undefined ? { from: position(slot.from) } : {}),
        ...(slot.to !== undefined ? { to: position(slot.to) } : {}), units: slot.units.map(unit => ({ ...unit, from: position(unit.from), to: position(unit.to) })) })) })) } }
}
/** Position mapping, never a search for matching prose. A second identical paragraph retains its own identity. */
export function retainMarkdownIdentities(next: MarkdownProjection, previous: MarkdownProjection): void {
  const nextView = identityView(next), oldView = identityView(previous)
  let from = 0, oldEnd = previous.source.length, newEnd = next.source.length
  oldEnd = oldView.source.length; newEnd = nextView.source.length
  while (from < oldEnd && from < newEnd && oldView.source[from] === nextView.source[from]) from++
  while (oldEnd > from && newEnd > from && oldView.source[oldEnd - 1] === nextView.source[newEnd - 1]) { oldEnd--; newEnd-- }
  const delta = newEnd - oldEnd, identities = new Map<string, string>(), used = new Set<string>()
  const oldAt = (position: number) => position <= from ? position : position >= newEnd ? position - delta : null
  // Existing explicit identities remain authoritative, including reordered opaque objects.
  const explicit = new Set(next.document.content.blocks.flatMap(block => previous.document.content.blocks.some(old => old.id === block.id) ? [block.id] : []))
  const maps = [...nextView.sourceMap.blocks].sort((a, b) => Number(!explicit.has(a.blockId)) - Number(!explicit.has(b.blockId))
    || Number(a.from < newEnd && a.to > from) - Number(b.from < newEnd && b.to > from))
  for (const map of maps) {
    const block = next.document.content.blocks.find(value => value.id === map.blockId)!
    const old = oldView.sourceMap.blocks.find(value => !used.has(value.blockId) && explicit.has(map.blockId) && value.blockId === map.blockId)
      ?? oldView.sourceMap.blocks.find(value => !used.has(value.blockId) && !explicit.has(value.blockId) && value.from === oldAt(map.from))
      ?? oldView.sourceMap.blocks.find(value => !used.has(value.blockId) && !explicit.has(value.blockId) && value.from <= from && value.to >= oldEnd && map.from <= from && map.to >= newEnd)
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
    // Formula identity is receiver bookkeeping too. Keep its order within an aligned slot, never match its prose.
    const slots = (value: MarkdownDocument['content']['blocks'][number]) => {
      if ('content' in value) return [{ key: 'content', content: value.content }]
      if (value.type === 'list') return value.items.map(item => ({ key: `item:${item.id}`, content: item.content }))
      if (value.type === 'table') return [...value.columns.map(column => ({ key: `column:${column.id}`, content: column.header })),
        ...value.rows.flatMap(row => value.columns.map(column => ({ key: `cell:${JSON.stringify([row.id, column.id])}`, content: row.cells[column.id]! })))]
      return []
    }
    if (block.type === 'formula' && prior.type === 'formula') identities.set(block.formulaId, prior.formulaId)
    const priorSlots = slots(prior)
    for (const [index, slot] of slots(block).entries()) {
      const oldSlot = priorSlots[index]
      const math = slot.content.inlines.filter(atom => atom.type === 'math'), oldMath = oldSlot?.content.inlines.filter(atom => atom.type === 'math') ?? []
      const explicitMath = new Set(math.flatMap(atom => oldMath.some(old => old.formulaId === atom.formulaId) ? [atom.formulaId] : []))
      if (math.length === oldMath.length) math.forEach((atom, index) => {
        if (!explicitMath.has(atom.formulaId) && !explicitMath.has(oldMath[index]!.formulaId)) identities.set(atom.formulaId, oldMath[index]!.formulaId)
      })
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
