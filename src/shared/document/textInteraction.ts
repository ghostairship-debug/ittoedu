import { documentTextContentSchema, documentTextLength, normalizeDocumentText, sliceDocumentText, type DocumentContent, documentTextSlots, walkDocument, type FlowInline, type FlowTextContent } from './content'
import { planTextRunRemap, type TextRunEdit } from '../textRuns'

/** A formula or a component occupies one logical position, independent of its rendered label. */
export const documentSemanticText = (content: FlowTextContent): string => content.inlines.map(inline => inline.type === 'text' ? inline.text : '\uFFFC').join('')
export const inlineComponentIds = (content: FlowTextContent): string[] => [...new Set(content.inlines.flatMap(inline => inline.type === 'component' ? [inline.instanceId] : []))]
export const hasDocumentInlineComponents = (content: FlowTextContent): boolean => inlineComponentIds(content).length > 0
export function documentTextAt(data: unknown, path: readonly string[]): FlowTextContent | undefined {
  let value: any = data
  for (const key of path) value = value?.[key]
  const parsed = documentTextContentSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
export function documentTextRanges(content: FlowTextContent): Map<string, { from: number; to: number }> {
  const ranges = new Map<string, { from: number; to: number }>(); let offset = 0
  for (const inline of content.inlines) {
    const end = offset + (inline.type === 'text' ? Array.from(inline.text).length : 1)
    for (const id of inline.rangeIds ?? []) {
      const range = ranges.get(id)
      if (range) range.to = end
      else ranges.set(id, { from: offset, to: end })
    }
    offset = end
  }
  return ranges
}
export function markDocumentRange(content: FlowTextContent, from: number, to: number, rangeId: string): FlowTextContent {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > documentTextLength(content) || to <= from) throw new RangeError('请选中同一正文范围内的文字')
  return normalizeDocumentText({ inlines: [...sliceDocumentText(content, 0, from).inlines,
    ...sliceDocumentText(content, from, to).inlines.map(inline => ({ ...inline, rangeIds: [...new Set([...(inline.rangeIds ?? []), rangeId])] })),
    ...sliceDocumentText(content, to, documentTextLength(content)).inlines] })
}
/** One owner maps exact replacements and whole-source changes; projection marks are observations of this same range. */
export interface DocumentRangePosition { id: string; from: number; to: number }
export interface TextRangeProjection { path: string[]; ranges: DocumentRangePosition[] }
export interface DocumentRangeProjection { blockId: string; slotKey: string; ranges: DocumentRangePosition[] }
export const projectTextRangePositions = (content: FlowTextContent): DocumentRangePosition[] => [...documentTextRanges(content)].map(([id, range]) => ({ id, ...range }))
export const projectDataTextRanges = (data: unknown): TextRangeProjection[] => allDocumentTextSlots(data).map(slot => ({ path: slot.path, ranges: projectTextRangePositions(slot.content) }))
export function projectDocumentRanges(document: DocumentContent): DocumentRangeProjection[] {
  const result: DocumentRangeProjection[] = []
  walkDocument(document.blocks, block => documentTextSlots(block).forEach(slot => result.push({ blockId: block.id, slotKey: slot.key, ranges: projectTextRangePositions(slot.content) })))
  return result
}
export function remapDocumentRanges(before: FlowTextContent, next: FlowTextContent, exactEdits?: readonly TextRunEdit[], projection?: readonly DocumentRangePosition[]): FlowTextContent {
  const ranges = documentTextRanges(before)
  if (projection) {
    let result = normalizeDocumentText({ inlines: next.inlines.map(inline => { const copy = structuredClone(inline); delete copy.rangeIds; return copy }) })
    for (const range of projection) result = markDocumentRange(result, range.from, range.to, range.id)
    return result
  }
  if (!ranges.size) return normalizeDocumentText(next)
  const plan = exactEdits ? { ok: true as const, edits: exactEdits } : planTextRunRemap(documentSemanticText(before), documentSemanticText(next), [])
  if (!plan.ok) throw new Error(plan.reason)
  const oldIds = new Set(ranges.keys())
  let result = normalizeDocumentText({ inlines: next.inlines.map(inline => {
    const copy = structuredClone(inline), ids = copy.rangeIds?.filter(id => !oldIds.has(id))
    if (ids?.length) copy.rangeIds = ids; else delete copy.rangeIds
    return copy
  }) })
  const authored = documentTextRanges(next)
  for (const [id, range] of ranges) {
    const mapped = !exactEdits && authored.get(id)
    if (mapped) { result = markDocumentRange(result, mapped.from, mapped.to, id); continue }
    let from = range.from, to = range.to, shift = 0
    for (const edit of [...plan.edits].sort((a, b) => a.start - b.start)) {
      const start = edit.start + shift, end = edit.end + shift, size = Array.from(edit.replacement).length, delta = size - (end - start)
      const map = (at: number, startBoundary: boolean) => at < start ? at : at > end ? at + delta
        : start === end ? at + (startBoundary ? size : 0)
        : at === end ? start + size : at === start ? start : start + (startBoundary ? 0 : size)
      from = map(from, true); to = map(to, false); shift += delta
    }
    if (to > from) result = markDocumentRange(result, from, to, id)
  }
  return result
}
export function replaceDocumentText(content: FlowTextContent, from: number, to: number, replacement: FlowTextContent): FlowTextContent {
  const length = documentTextLength(content)
  if (from < 0 || to < from || to > length || !Number.isInteger(from) || !Number.isInteger(to)) throw new RangeError('文字范围超出正文')
  const next = normalizeDocumentText({ inlines: [...sliceDocumentText(content, 0, from).inlines, ...replacement.inlines, ...sliceDocumentText(content, to, length).inlines] })
  return remapDocumentRanges(content, next, [{ start: from, end: to, original: documentSemanticText(sliceDocumentText(content, from, to)), replacement: documentSemanticText(replacement) }])
}
/** Every professional text slot uses the same mapping, including nested table cells and source/data edits. */
export function remapDocumentData(before: unknown, next: unknown, facts?: { textEdits?: readonly { path: string[]; edits: readonly TextRunEdit[] }[]; rangeProjection?: readonly TextRangeProjection[] }, path: string[] = []): unknown {
  const oldText = documentTextContentSchema.safeParse(before), newText = documentTextContentSchema.safeParse(next)
  if (oldText.success && newText.success) return remapDocumentRanges(oldText.data, newText.data, facts?.textEdits?.find(field => JSON.stringify(field.path) === JSON.stringify(path))?.edits, facts?.rangeProjection?.find(field => JSON.stringify(field.path) === JSON.stringify(path))?.ranges)
  if (!next || typeof next !== 'object') return next
  if (Array.isArray(next)) return next.map((value, index) => {
    const previous = Array.isArray(before) ? value && typeof value === 'object' && 'id' in value ? before.find(item => item && typeof item === 'object' && item.id === value.id) : before[index] : undefined
    return remapDocumentData(previous, value, facts, [...path, String(index)])
  })
  return Object.fromEntries(Object.entries(next).map(([key, value]) => [key, remapDocumentData(before && typeof before === 'object' ? (before as any)[key] : undefined, value, facts, [...path, key])]))
}
export function allDocumentTextSlots(data: unknown, path: string[] = []): Array<{ path: string[]; content: FlowTextContent }> {
  const text = documentTextContentSchema.safeParse(data)
  if (text.success) return [{ path, content: text.data }]
  if (!data || typeof data !== 'object') return []
  return Object.entries(data).flatMap(([key, value]) => allDocumentTextSlots(value, [...path, key]))
}
export function documentRangeElements(root: HTMLElement | undefined, rangeId: string, dataPath?: readonly string[]): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>('[data-document-range],[data-document-ranges]')].filter(element => (!dataPath || element.closest<HTMLElement>('[data-document-path]')?.dataset.documentPath === JSON.stringify(dataPath)) && (element.dataset.documentRange === rangeId || (() => { try { return JSON.parse(element.dataset.documentRanges ?? '[]').includes(rangeId) } catch { return false } })())) : []
}

/** Projection owns DOM slots; the existing host owns child mounts and run lifetimes. */
export function mountDocumentInlineComponents(root: HTMLElement, port: { mount(instanceId: string, root: HTMLElement): () => void } | undefined): () => void {
  const releases: Array<() => void> = []
  if (port) for (const slot of root.querySelectorAll<HTMLElement>('[data-inline-instance]')) {
    const id = slot.dataset.inlineInstance!
    slot.replaceChildren(); releases.push(port.mount(id, slot))
  }
  return () => releases.reverse().forEach(release => release())
}

/** Software has the actual captured replacement interval; no second diff infers that intent. */
export function documentReplacementEdits(before: FlowTextContent, next: FlowTextContent, from: number, to: number): TextRunEdit[] {
  const replacementSize = documentTextLength(next) - (documentTextLength(before) - (to - from))
  return [{ start: from, end: to, original: documentSemanticText(sliceDocumentText(before, from, to)), replacement: documentSemanticText(sliceDocumentText(next, from, from + replacementSize)) }]
}


/** Concrete author bodies: base plus authored presentation data overrides. */
export function documentComponentDataVersions(project: import('../contracts/component-platform').CourseProjectV10, instanceId: string,
  replacement?: { surfaceId: string | null; stateId?: string | null; data: import('../contracts/component-platform').JsonValue }): import('../contracts/component-platform').JsonValue[] {
  const instance = project.instances[instanceId]
  if (!instance) return []
  const versions = [replacement && !replacement.stateId ? replacement.data : instance.data]
  for (const surface of project.surfaces) for (const state of surface.presentation?.states ?? []) {
    const data = replacement?.stateId === state.id && replacement.surfaceId === surface.id ? replacement.data : state.overrides[instanceId]?.data
    if (data !== undefined) versions.push(data)
  }
  return versions
}
export function documentInlineChildIds(project: import('../contracts/component-platform').CourseProjectV10, instanceId: string): string[] {
  return [...new Set(documentComponentDataVersions(project, instanceId).flatMap(data => allDocumentTextSlots(data).flatMap(slot => inlineComponentIds(slot.content))))]
}
/** A stable authored range follows its real professional slot when an effective list/table is reordered. */
export function documentRangeAt(data: unknown, dataPath: readonly string[], rangeId: string): { path: string[]; content: FlowTextContent } | undefined {
  const content = documentTextAt(data, dataPath)
  if (content && documentTextRanges(content).has(rangeId)) return { path: [...dataPath], content }
  const slots = allDocumentTextSlots(data).filter(slot => documentTextRanges(slot.content).has(rangeId))
  return slots.length === 1 ? slots[0] : undefined
}
