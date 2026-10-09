import { documentTextSlots, normalizeDocumentText, type FlowInline } from './content'
import { parseDocumentMarkdown, serializeMarkdownInline } from './markdown'
import { unitsToRanges, type SlotMap } from './markdownSourceMap'
import { documentSourceEdits, type SourceEdit } from './sourceMerge'

export interface AggregateMarkdownFragment { from: number; to: number; separatorBefore?: string }
export interface AggregateMarkdownTextEdit {
  /** Source edits use original UTF-16 coordinates and ascending source order. */
  edits: SourceEdit[]
  afterSource: string
  /** Only replacement text is selected after ACK; an empty replacement leaves a caret. */
  selectedRanges: { from: number; to: number }[]
}
type Unit = SlotMap['units'][number]
type Piece = AggregateMarkdownFragment & { units: Unit[]; text: string; insert: string; separator: string; slot?: SlotMap; atoms: FlowInline[] }

/** Plan against the current parser projection. No identities, grants, writer or History live here. */
export function planAggregateMarkdownTextEdit(input: {
  source: string; fragments: readonly AggregateMarkdownFragment[]; replacement: string
}): AggregateMarkdownTextEdit {
  const { source, replacement } = input
  let serial = 0
  const parse = (value: string) => parseDocumentMarkdown(value, { target: 'file', createId: () => `aggregate-${++serial}` })
  const before = parse(source)
  if (before.status !== 'valid') throw new Error(before.diagnostics[0]?.message ?? '当前 Markdown 无法解析')
  // Inline wrapper coordinates come directly from the lexer, before the parser maps CRLF.
  const offsets: number[] = []
  for (let raw = 0; raw < source.length; raw++) { offsets.push(raw); if (source[raw] === '\r' && source[raw + 1] === '\n') raw++ }
  offsets.push(source.length)
  const slots = before.sourceMap.blocks.flatMap(block => block.slots.map(slot => {
    const content = documentTextSlots(before.document.content.blocks.find(value => value.id === block.blockId)!).find(value => value.key === slot.key)!.content
    return { slot, atoms: content.inlines.flatMap<FlowInline>(atom => atom.type === 'text' ? Array.from(atom.text, text => ({ ...atom, text })) : [atom]) }
  }))
  const allUnits = slots.flatMap(value => value.slot.units)
  const retainedSyntax = slots.flatMap(({ slot }) => (slot.retained ?? []).map(child => ({ from: offsets[child.from]!, to: offsets[child.to]! })))
  const atomForUnit = (unit: Unit) => { const owner = slots.find(value => value.slot.units.includes(unit))!; return owner.atoms[owner.slot.units.indexOf(unit)] }
  const wrappers = new Map<string, { from: number; to: number; units: Unit[]; kind: string; retained: { from: number; to: number }[] }>()
  for (const unit of allUnits) for (const wrapper of unit.wrappers ?? []) {
    const from = offsets[wrapper.from]!, to = offsets[wrapper.to]!, key = `${from}:${to}`
    const group = wrappers.get(key) ?? { from, to, units: [], kind: wrapper.kind,
      retained: (wrapper.retained ?? []).map(child => ({ from: offsets[child.from]!, to: offsets[child.to]! })) }
    group.units.push(unit); wrappers.set(key, group)
  }
  const pieces: Piece[] = input.fragments.map((fragment, index, fragments) => {
    if (fragment.from < 0 || fragment.to > source.length || fragment.from > fragment.to || index > 0 && fragment.from < fragments[index - 1].to)
      throw new Error('当前正文范围无效')
    const located = slots.find(({ slot }) => slot.units.some(unit => unit.from < fragment.to && unit.to > fragment.from))
      ?? (fragment.from === fragment.to ? slots.find(({ slot }) => slot.from !== undefined && slot.to !== undefined && fragment.from >= slot.from && fragment.to <= slot.to) : undefined)
    const units = located?.slot.units.filter(unit => unit.from >= fragment.from && unit.to <= fragment.to && !unit.barrier) ?? []
    if (fragment.from !== fragment.to && !units.length) throw new Error('当前所选正文没有可对应的源文字符')
    const code = fragment.from === fragment.to ? [...wrappers.values()].find(wrapper => wrapper.kind === 'codespan' && fragment.from > wrapper.from && fragment.from < wrapper.to) : undefined
    const contexts = units.length ? units : code ? [code.units[0]] : []
    return { ...fragment, units, atoms: contexts.map(unit => located!.atoms[located!.slot.units.indexOf(unit)]), slot: located?.slot,
      text: units.map(unit => unit.text).join(''), insert: '', separator: '' }
  })
  const base = pieces.map(piece => (piece.separatorBefore ?? '') + piece.text).join('')
  const changes = documentSourceEdits(base, replacement)
  const boundary = (offset: number, affinity: 'left' | 'right' = 'right'): number => {
    if (offset === base.length) return replacement.length
    let delta = 0
    for (const edit of changes) {
      if (edit.from === edit.to && offset === edit.from && affinity === 'right') { delta += edit.text.length; continue }
      if (offset <= edit.from) break
      if (offset >= edit.to) { delta += edit.text.length - edit.to + edit.from; continue }
      const oldBefore = Array.from(base.slice(edit.from, offset)).length, oldSize = Array.from(base.slice(edit.from, edit.to)).length
      return edit.from + delta + Array.from(edit.text).slice(0, Math.round(Array.from(edit.text).length * oldBefore / oldSize)).join('').length
    }
    return offset + delta
  }
  let cursor = 0
  for (const piece of pieces) {
    const separatorStart = boundary(cursor)
    cursor += (piece.separatorBefore ?? '').length
    const start = cursor === 0 ? 0 : boundary(cursor, piece.separatorBefore ? 'left' : 'right')
    piece.separator = replacement.slice(separatorStart, start)
    cursor += piece.text.length
    piece.insert = replacement.slice(start, boundary(cursor))
  }
  type Patch = SourceEdit & { selected?: true; selectedOffsets?: { from: number; to: number }[] }
  const patches: Patch[] = pieces.map(piece => ({ from: piece.from, to: piece.to,
    text: piece.atoms.every(atom => atom.type === 'text' && atom.code) && piece.atoms.length ? piece.insert
      : serializeMarkdownInline({ inlines: piece.insert ? [{ type: 'text', text: piece.insert }] : [] }), selected: true }))
  // Remove only wrappers whose complete visible content was selected and deleted in this plan.
  const deleted = (unit: Unit) => unit.barrier
    ? pieces.some((piece, index) => index > 0 && pieces[index - 1].to <= unit.from && unit.to <= piece.from && !piece.separator)
    : pieces.some(piece => piece.units.includes(unit) && !piece.insert)
  const empty = [...wrappers.values()].filter(wrapper => !wrapper.retained.length && wrapper.units.length && wrapper.units.every(deleted))
  for (const wrapper of empty.filter(value => !empty.some(outer => outer !== value && outer.from <= value.from && outer.to >= value.to))) {
    for (let index = patches.length - 1; index >= 0; index--) if (patches[index].from >= wrapper.from && patches[index].to <= wrapper.to) patches.splice(index, 1)
    patches.push({ from: wrapper.from, to: wrapper.to, text: serializeMarkdownInline({ inlines: [] }) })
  }
  const rewriteWrapper = (wrapper: { from: number; to: number; units: Unit[]; kind: string; retained: { from: number; to: number }[] }) => {
    const changed = pieces.filter(piece => piece.units.length ? piece.units.every(unit => wrapper.units.includes(unit))
      : piece.from > wrapper.from && piece.to < wrapper.to && piece.atoms.some(atom => atom.type === 'text' && atom.code))
    let index = 0, length = 0
    const atoms: FlowInline[] = []
    let markerPrefix = '\uE000'
    while (source.includes(markerPrefix) || replacement.includes(markerPrefix)) markerPrefix += '\uE000'
    const retained = wrapper.retained.map((child, index) => ({ ...child, marker: `${markerPrefix}${index}\uE001`,
      offset: wrapper.units.filter(unit => unit.to <= child.from).length }))
    const selectedOffsets: { from: number; to: number }[] = []
    const pending = changed.map(piece => ({ piece, offset: piece.units.length ? wrapper.units.indexOf(piece.units[0])
      : wrapper.units.findIndex(unit => unit.from >= piece.from) })).map(value => ({ ...value, offset: value.offset < 0 ? wrapper.units.length : value.offset }))
    while (index <= wrapper.units.length) {
      for (const child of retained.filter(value => value.offset === index)) {
        const context = atomForUnit(wrapper.units[Math.min(index, wrapper.units.length - 1)])
        atoms.push(context.type === 'text' ? { ...context, text: child.marker } : { type: 'text', text: child.marker })
        child.offset = -1
      }
      const entry = pending.find(value => value.offset === index)
      const piece = entry?.piece
      if (piece) {
        const context = piece.atoms[0]
        atoms.push(context?.type === 'text' ? { ...context, text: piece.insert } : { type: 'text', text: piece.insert, ...(context?.link ? { link: context.link } : {}) })
        selectedOffsets.push({ from: length, to: length + Array.from(piece.insert).length }); length += Array.from(piece.insert).length
        pending.splice(pending.indexOf(entry!), 1)
        index += piece.units.length
      } else { if (index === wrapper.units.length) break; const unit = wrapper.units[index++]; atoms.push(atomForUnit(unit)); length++ }
    }
    for (let index = patches.length - 1; index >= 0; index--) if (patches[index].from >= wrapper.from && patches[index].to <= wrapper.to) patches.splice(index, 1)
    let text = serializeMarkdownInline(normalizeDocumentText({ inlines: wrapper.kind === 'codespan'
      ? atoms.map(atom => atom.type === 'text' ? { type: 'text', text: atom.text, code: true } : atom) : atoms }))
    for (const child of retained) text = text.replace(child.marker, source.slice(child.from, child.to))
    patches.push({ from: wrapper.from, to: wrapper.to, text, selectedOffsets })
  }
  // A changed code delimiter belongs to its original serializer. Select only inserted
  // code characters after parsing; the unselected code prefix/suffix stay outside ACK.
  for (const wrapper of wrappers.values()) {
    if (wrapper.kind !== 'codespan' || empty.some(value => value.from <= wrapper.from && value.to >= wrapper.to)) continue
    if (pieces.some(piece => piece.insert !== piece.text && (piece.units.length ? piece.units.every(unit => wrapper.units.includes(unit))
      : piece.from > wrapper.from && piece.to < wrapper.to && piece.atoms.some(atom => atom.type === 'text' && atom.code)))) rewriteWrapper(wrapper)
  }
  // The file parser cannot represent an empty ordinary quote. Removing its selected
  // last prose retires only that now-empty block, not another authored source span.
  for (const blockMap of before.sourceMap.blocks) {
    const block = before.document.content.blocks.find(value => value.id === blockMap.blockId)!
    const units = blockMap.slots.flatMap(slot => slot.units)
    if (block.type !== 'quote' || !units.length || !units.every(deleted)
      || blockMap.slots.some(slot => slot.retained?.length)
      || [...wrappers.values()].some(wrapper => wrapper.retained.length && wrapper.from >= blockMap.from && wrapper.to <= blockMap.to)) continue
    for (let index = patches.length - 1; index >= 0; index--) if (patches[index].from >= blockMap.from && patches[index].to <= blockMap.to) patches.splice(index, 1)
    patches.push({ from: blockMap.from, to: blockMap.to, text: '' })
  }
  for (let index = 1; index < pieces.length; index++) {
    const previous = pieces[index - 1], piece = pieces[index]
    if (piece.separator === (piece.separatorBefore ?? '')) continue
    let from = previous.to, to = piece.from
    if (previous.slot !== piece.slot && previous.slot?.to !== undefined && piece.slot?.from !== undefined) {
      from = previous.slot.to; to = piece.slot.from
    } else for (const wrapper of wrappers.values()) {
      if (wrapper.from < from && wrapper.to <= to && wrapper.units.every(unit => unit.to <= previous.to)) from = Math.max(from, wrapper.to)
      if (wrapper.from >= from && wrapper.to > to && wrapper.units.every(unit => unit.from >= piece.from)) to = Math.min(to, wrapper.from)
    }
    if (patches.some(patch => !patch.text && patch.from <= from && patch.to >= to && patch.from !== patch.to)) continue
    if (from <= to) {
      const separator = serializeMarkdownInline({ inlines: piece.separator ? [{ type: 'text', text: piece.separator }] : [] })
      const retained = retainedSyntax.filter(child => child.from >= from && child.to <= to).sort((a, b) => a.from - b.from)
      let text = '', cursor = from, inserted = false
      for (const child of retained) {
        if (!inserted && /[\r\n]/.test(source.slice(cursor, child.from))) { text += separator; inserted = true }
        text += source.slice(child.from, child.to); cursor = child.to
      }
      if (!inserted) text += separator
      patches.push({ from, to, text, selected: true })
    }
    const surviving = [...wrappers.values()].filter(wrapper => !empty.some(value => value.from <= wrapper.from && value.to >= wrapper.to))
    const left = surviving.filter(wrapper => wrapper.units.at(-1)?.to === previous.to && wrapper.to <= piece.from).sort((a, b) => a.from - b.from)[0]
    const right = surviving.filter(wrapper => wrapper.units[0]?.from === piece.from && wrapper.from >= previous.to).sort((a, b) => b.to - a.to)[0]
    const context = (unit: Unit) => { const atom = atomForUnit(unit); return JSON.stringify(atom.type === 'text' ? { ...atom, text: '' } : atom) }
    const sameContext = left && right && left.kind === right.kind && ['strong', 'em', 'del'].includes(left.kind)
      && [...left.units, ...right.units].every(unit => context(unit) === context(left.units[0]))
      && source.slice(left.units.at(-1)!.to, left.to) === source.slice(right.from, right.units[0].from)
    // An original empty child still separates these wrappers. It is neither
    // selected prose nor a delimiter pair that can be retired during a join.
    const retainedBetween = retainedSyntax.some(child => child.from >= previous.to && child.to <= piece.from)
    if (sameContext && !retainedBetween) {
      const start = left.units.at(-1)!.to, end = right.units[0].from
      for (let index = patches.length - 1; index >= 0; index--) if (patches[index].from >= start && patches[index].to <= end) patches.splice(index, 1)
      patches.push({ from: start, to: end, text: serializeMarkdownInline({ inlines: piece.separator ? [{ type: 'text', text: piece.separator }] : [] }), selected: true })
    } else if (!retainedBetween) {
      // Joining original emphasis delimiters can turn them into visible punctuation.
      // Re-encode only these boundary wrappers, preserving their original inline semantics.
      for (const wrapper of [left, right]) if (wrapper && ['strong', 'em', 'del', 'codespan'].includes(wrapper.kind)) rewriteWrapper(wrapper)
    }
  }
  patches.sort((a, b) => a.from - b.from || a.to - b.to)
  let afterSource = '', at = 0
  const selected: { from: number; to: number; offsets?: { from: number; to: number }[] }[] = []
  for (const patch of patches) {
    if (patch.from < at) throw new Error('正文语法与所选范围无法对应')
    afterSource += source.slice(at, patch.from)
    const from = afterSource.length
    afterSource += patch.text; at = patch.to
    if (patch.selected && patch.text) selected.push({ from, to: afterSource.length })
    else if (patch.selectedOffsets?.length) selected.push({ from, to: afterSource.length, offsets: patch.selectedOffsets })
  }
  afterSource += source.slice(at)
  const after = parse(afterSource)
  if (after.status !== 'valid') throw new Error(after.diagnostics[0]?.message ?? '修改后的 Markdown 无法解析')
  const afterUnits = after.sourceMap.blocks.flatMap(block => block.slots.flatMap(slot => slot.units)).filter(unit => !unit.barrier)
  const chosen = new Set<Unit>()
  const carets: { from: number; to: number }[] = []
  for (const range of selected) {
    const contained = afterUnits.filter(unit => unit.from >= range.from && unit.to <= range.to)
    if (range.offsets) for (const offset of range.offsets) {
      contained.slice(offset.from, offset.to).forEach(unit => chosen.add(unit))
      if (offset.from === offset.to) {
        const caret = contained[offset.from]?.from ?? contained.at(-1)?.to ?? range.from
        carets.push({ from: caret, to: caret })
      }
    }
    else contained.forEach(unit => chosen.add(unit))
  }
  const units = afterUnits.filter(unit => chosen.has(unit))
  const selectedRanges = unitsToRanges(afterSource, units).map(({ from, to }) => ({ from, to }))
  if (!selectedRanges.length && carets.length) selectedRanges.push(carets[0])
  if (!selectedRanges.length) {
    const first = pieces[0]?.from ?? 0
    let caret = first
    for (const patch of patches) { if (patch.to <= first) caret += patch.text.length - (patch.to - patch.from); else if (patch.from < first) caret = patch.from; else break }
    caret = Math.max(0, Math.min(afterSource.length, caret)); selectedRanges.push({ from: caret, to: caret })
  }
  return { afterSource, edits: patches.map(({ from, to, text }) => ({ from, to, text })), selectedRanges }
}
