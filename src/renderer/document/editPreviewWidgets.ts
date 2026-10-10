import { allocateTextSelectionReplacement } from '../../shared/document/textSelectionReplacement'
import { Plugin, PluginKey, TextSelection, NodeSelection } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorSelection, EditorState as SourceState, StateEffect, StateField } from '@codemirror/state'
import { Decoration as SourceDecoration, EditorView as SourceView, WidgetType } from '@codemirror/view'
import type { EditTarget } from '../../shared/workbench/editSession'
import { slotKey, type MarkdownSourceMap } from '../../shared/document/markdownSourceMap'
import { createPreviewBodyWidget, previewBody, type PreviewBodyWidget, type PreviewFormat } from './editPreviewBody'
import { editorPositionToPoint } from './documentAdapter'

export interface DocumentEditPreview { editId: string; sequence?: number; target: EditTarget; value: string; cancel(): void }
/** Flow's canonical instance address projects to the existing document slot, never a new author target. */
export function documentPreviewTarget(target: EditTarget): EditTarget {
  if (target.kind !== 'course-instance') return target
  if (target.from === undefined || target.to === undefined) return { kind: 'flow-block', surfaceId: target.surfaceId, blockId: target.instanceId, parentId: null }
  const field = target.fieldScope === 'flowLayout' ? 'caption' : target.dataPath?.at(-1)
  if (!['content', 'citation', 'caption', 'title', 'body'].includes(field ?? '')) return target
  return { kind: 'flow-range', surfaceId: target.surfaceId, blockId: target.instanceId, parentId: null,
    slot: { kind: 'field', field: field as 'content' | 'citation' | 'caption' | 'title' | 'body' }, from: target.from, to: target.to }
}
export interface PreviewRange { editId: string; partId?: number; separatorBefore?: string; sequence?: number; from: number; to: number; value: string; cancel(): void; format?: PreviewFormat; blockNodes?: { from: number; to: number }[]; protectedFrom?: number; protectedTo?: number }
const protectedRange = (value: PreviewRange) => ({ from: value.protectedFrom ?? value.from, to: value.protectedTo ?? value.to })
const overlaps = (from: number, to: number, value: PreviewRange) => {
  const target = protectedRange(value)
  return from === to ? from > target.from && from < target.to : from < target.to && to > target.from
}
const inside = (position: number, value: PreviewRange) => {
  const target = protectedRange(value)
  return position > target.from && position < target.to
}
const hiddenBlockPosition = (position: number, value: PreviewRange) => value.blockNodes?.some(node => position > node.from && position < node.to) ?? false
function beginStatus(element: HTMLElement, value: PreviewRange): HTMLElement {
  if (value.sequence === -1) {
    element.style.fontSize = '12px'; element.style.fontWeight = '400'; element.style.fontStyle = 'normal'
    element.setAttribute('role', 'status'); element.setAttribute('aria-label', '正在准备正文，原文尚未改变')
  }
  return element
}
export function sourcePreviewRange(preview: DocumentEditPreview | undefined, map: MarkdownSourceMap): PreviewRange | null {
  const range = resolvedSourcePreviewRange(preview, map)
  return range?.sequence === -1 ? { ...range, protectedFrom: range.from, protectedTo: range.to, to: range.from, value: '正在准备正文…' } : range
}
function resolvedSourcePreviewRange(preview: DocumentEditPreview | undefined, map: MarkdownSourceMap): PreviewRange | null {
  if (!preview) return null
  const target = documentPreviewTarget(preview.target)
  if (target.kind === 'text-selection') {
    if (target.fragments.length !== 1) return null
    return resolvedSourcePreviewRange({ ...preview, target: target.fragments[0].target }, map)
  }
  if (target.kind === 'markdown-range') return { ...preview, from: target.from, to: target.to }
  if (target.kind !== 'flow-range' && target.kind !== 'flow-block') return null
  const block = map.blocks.find(block => block.blockId === target.blockId)
  if (!block) return null
  const slot = block.slots.find(slot => slot.key === (target.kind === 'flow-range' ? slotKey(target.slot) : 'content'))
    ?? (target.kind === 'flow-block' ? block.slots.find(slot => slot.key === 'body') : undefined)
  if (!slot) return target.kind === 'flow-block' ? { ...preview, from: block.from, to: block.to } : null
  let offset = 0, from: number | undefined, to: number | undefined
  const start = target.kind === 'flow-range' ? target.from : 0, end = target.kind === 'flow-range' ? target.to : Infinity
  for (const unit of slot.units) {
    if (offset === start) from = unit.from
    offset += Array.from(unit.text).length
    if (offset === end) to = unit.to
  }
  if (start === offset) from = slot.units.at(-1)?.to
  if (end === start) to = from
  if (end === Infinity) to = slot.units.at(-1)?.to
  return from !== undefined && to !== undefined ? { ...preview, from, to } : null
}

export function layoutPreviewRange(doc: PMNode, preview: DocumentEditPreview | undefined, map: MarkdownSourceMap): PreviewRange | null {
  if (!preview) return null
  const target = documentPreviewTarget(preview.target)
  if (target.kind === 'text-selection') {
    if (target.fragments.length !== 1) return null
    const value = layoutPreviewRange(doc, { ...preview, target: target.fragments[0].target }, map)
    return value ? { ...value, format: 'text' } : null
  }
  let from: number | undefined, to: number | undefined
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const point = editorPositionToPoint(doc, pos + 1)
    if (!point) return
    const units: { from: number; to: number; text: string }[] = []
    let at = pos + 1
    node.forEach(child => {
      for (const text of child.isText ? Array.from(child.text!) : ['\uFFFC']) {
        units.push({ from: at, to: at + (child.isText ? text.length : child.nodeSize), text }); at = units.at(-1)!.to
      }
    })
    if (target.kind === 'flow-range' || target.kind === 'flow-block') {
      if (point.blockId !== target.blockId) return
      if (target.kind === 'flow-range' && slotKey(point.slot) !== slotKey(target.slot)) return
      if (target.kind === 'flow-block' && slotKey(point.slot) !== 'content' && slotKey(point.slot) !== 'body') return
      const start = target.kind === 'flow-range' ? target.from : 0, end = target.kind === 'flow-range' ? target.to : units.length
      if (start > units.length || end > units.length) return
      from = units[start]?.from ?? at; to = end ? units[end - 1]?.to : pos + 1
    } else if (target.kind === 'markdown-range') {
      const block = map.blocks.find(block => block.blockId === point.blockId)
      const mapped = block?.slots.find(slot => slot.key === slotKey(point.slot))?.units
      if (!mapped || mapped.length !== units.length) return
      for (let i = 0; i < mapped.length; i++) {
        if (mapped[i].from === target.from) from = units[i].from
        if (mapped[i].to === target.to) to = units[i].to
      }
      // Source separators (including a final newline) have no ProseMirror glyph.
      // A range covering a complete block still covers all of its rendered text.
      if (target.from <= block!.from && target.to >= block!.to) {
        from ??= pos + 1
        to = at
      } else {
        if (target.from === block!.from) from ??= pos + 1
        if (target.to === block!.to) to = at
      }
    }
  })
  if (from === undefined || to === undefined || from > to) return null
  if (preview.sequence === -1) return { ...preview, from, to: from, protectedFrom: from, protectedTo: to, value: '正在准备正文…', format: 'text' }
  const blockNodes: { from: number; to: number }[] = []
  if (target.kind === 'markdown-range' && from < to) doc.forEach((node, position) => {
    const block = map.blocks.find(block => block.blockId === node.attrs.id)
    if (block && target.from <= block.from && target.to >= block.to && position + 1 >= from! && position + node.nodeSize - 1 <= to!) blockNodes.push({ from: position, to: position + node.nodeSize })
  })
  const isBlock = blockNodes.length > 0 && blockNodes[0].from + 1 === from && blockNodes.at(-1)!.to - 1 === to
  return { ...preview, from, to, format: target.kind === 'markdown-range' ? isBlock ? 'markdown-blocks' : 'markdown-inline' : 'text', ...(isBlock ? { blockNodes } : {}) }
}

/** A semantic aggregate keeps each source/physical fragment distinct; gaps remain editable. */
export function layoutPreviewRanges(doc: PMNode, preview: DocumentEditPreview, map: MarkdownSourceMap): PreviewRange[] {
  if (preview.target.kind !== 'text-selection') { const value = layoutPreviewRange(doc, preview, map); return value ? [value] : [] }
  const pieces = preview.target.fragments.map((fragment, partId) => {
    const range = layoutPreviewRange(doc, { ...preview, sequence: 0, target: fragment.target }, map)
    return range ? { ...range, partId, separatorBefore: fragment.separatorBefore } : null
  })
  if (pieces.some(piece => !piece)) return []
  const allocated = allocateTextSelectionReplacement(pieces.map((piece, index) => ({ text: doc.textBetween(piece!.from, piece!.to, '\n', node => node.type.name === 'hard_break' ? '\n' : '\uFFFC'), separatorBefore: preview.target.kind === 'text-selection' ? preview.target.fragments[index].separatorBefore : undefined })), preview.value)
  return pieces.map((piece, index) => ({ ...piece!, format: 'text', sequence: preview.sequence, value: preview.sequence === -1 ? '正在准备正文…' : allocated[index].text,
    ...(preview.sequence === -1 ? { protectedFrom: piece!.from, protectedTo: piece!.to, to: piece!.from } : {}) }))
}
export function sourcePreviewRanges(preview: DocumentEditPreview, map: MarkdownSourceMap, source: string, doc?: PMNode): PreviewRange[] {
  if (preview.target.kind !== 'text-selection') { const value = sourcePreviewRange(preview, map); return value ? [value] : [] }
  const pieces = preview.target.fragments.map((fragment, partId) => {
    const range = resolvedSourcePreviewRange({ ...preview, sequence: 0, target: fragment.target }, map)
    return range ? { ...range, partId, separatorBefore: fragment.separatorBefore } : null
  })
  if (pieces.some(piece => !piece)) return []
  const logical = doc ? layoutPreviewRanges(doc, { ...preview, sequence: 0 }, map) : null
  const allocated = allocateTextSelectionReplacement(pieces.map((piece, index) => ({ text: source.slice(piece!.from, piece!.to), separatorBefore: preview.target.kind === 'text-selection' ? preview.target.fragments[index].separatorBefore : undefined })), preview.value)
  return pieces.map((piece, index) => ({ ...piece!, sequence: preview.sequence, value: preview.sequence === -1 ? '正在准备正文…' : logical?.[index]?.value ?? allocated[index].text,
    ...(preview.sequence === -1 ? { protectedFrom: piece!.from, protectedTo: piece!.to, to: piece!.from } : {}) }))
}
const widgetKey = (range: PreviewRange) => `${range.editId}:${range.partId ?? ''}`

const ranges = (value: PreviewRange | readonly PreviewRange[] | null | undefined): readonly PreviewRange[] => !value ? [] : Array.isArray(value) ? value : [value as PreviewRange]
export const layoutPreviewKey = new PluginKey<readonly PreviewRange[]>('g20-edit-preview')
const mapPreviewRange = (range: PreviewRange, map: (position: number, assoc: number) => number): PreviewRange => ({
  ...range, from: map(range.from, 1), to: map(range.to, -1),
  ...(range.protectedFrom === undefined ? {} : { protectedFrom: map(range.protectedFrom, 1) }),
  ...(range.protectedTo === undefined ? {} : { protectedTo: map(range.protectedTo, -1) }),
  ...(range.blockNodes ? { blockNodes: range.blockNodes.map(node => ({ from: map(node.from, 1), to: map(node.to, -1) })) } : {}),
})
export const previewCaretTransaction = 'g20-preview-caret'
const selectedPreview = (values: readonly PreviewRange[], from: number, to: number) => values.find(value => overlaps(from, to, value) || inside(from, value) || hiddenBlockPosition(from, value))
export function layoutPreviewPlugin(blocked: () => void): Plugin<readonly PreviewRange[]> {
  const widgets = new Map<HTMLElement, { key: string; body: PreviewBodyWidget }>()
  return new Plugin<readonly PreviewRange[]>({ key: layoutPreviewKey,
    state: { init: () => [], apply(tr, current) {
      if (tr.getMeta(layoutPreviewKey) !== undefined) return ranges(tr.getMeta(layoutPreviewKey))
      return tr.docChanged ? current.map(value => mapPreviewRange(value, (position, assoc) => tr.mapping.map(position, assoc))) : current
    } },
    filterTransaction(tr, state) {
      if (!tr.docChanged || tr.getMeta('canonicalUpdate')) return true
      let conflict = false, current = layoutPreviewKey.getState(state) ?? []
      for (const mapping of tr.mapping.maps) {
        mapping.forEach((from, to) => { if (current.some(value => overlaps(from, to, value) || from === to && hiddenBlockPosition(from, value))) conflict = true })
        current = current.map(value => mapPreviewRange(value, (position, assoc) => mapping.map(position, assoc)))
      }
      if (conflict) blocked()
      return !conflict
    },
    appendTransaction(_transactions, _old, state) {
      const current = layoutPreviewKey.getState(state) ?? []
      if (!current.length) {
        const previous = layoutPreviewKey.getState(_old) ?? []
        return previous.some(value => value.blockNodes?.[0].from === state.selection.from) && state.selection instanceof NodeSelection
          ? state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(state.selection.from + 1, state.doc.content.size)))).setMeta(previewCaretTransaction, true) : null
      }
      const value = current.find(value => inside(state.selection.from, value) || hiddenBlockPosition(state.selection.from, value))
      if (!state.selection.empty || !value) return null
      if (value.blockNodes?.length) {
        const first = value.blockNodes[0].from, end = value.blockNodes.at(-1)!.to
        return state.tr.setSelection(end < state.doc.content.size ? TextSelection.near(state.doc.resolve(end), 1) : first > 0 ? TextSelection.near(state.doc.resolve(first), -1) : NodeSelection.create(state.doc, first)).setMeta(previewCaretTransaction, true)
      }
      return state.tr.setSelection(TextSelection.near(state.doc.resolve(value.protectedTo ?? value.to))).setMeta(previewCaretTransaction, true)
    },
    view: () => ({ update(view) { for (const current of layoutPreviewKey.getState(view.state) ?? []) for (const widget of widgets.values()) if (widget.key === widgetKey(current)) widget.body.update(current.value, current.cancel) }, destroy() { for (const widget of widgets.values()) widget.body.destroy(); widgets.clear() } }),
    props: {
      decorations(state) {
        const current = layoutPreviewKey.getState(state) ?? []
        if (!current.length) return null
        const decorations = current.flatMap(value => {
          const decorations = [Decoration.widget(value.blockNodes?.[0].from ?? value.from, () => {
            const body = createPreviewBodyWidget(value.editId, value.value, value.format ?? 'text', value.cancel)
            widgets.set(body.element, { key: widgetKey(value), body }); return beginStatus(body.element, value)
          }, { side: -1, key: `${widgetKey(value)}:${value.format ?? 'text'}:${value.sequence === -1 ? 'begin' : 'body'}`, stopEvent: () => true, destroy(dom) { const owned = widgets.get(dom as HTMLElement); owned?.body.destroy(); widgets.delete(dom as HTMLElement) } })]
          if (value.blockNodes?.length) for (const node of value.blockNodes) decorations.push(Decoration.node(node.from, node.to, { class: 'document-generation-hidden', 'aria-hidden': 'true' }))
          else if (value.from < value.to) decorations.push(Decoration.inline(value.from, value.to, { class: 'document-generation-hidden', 'aria-hidden': 'true' }))
          return decorations
        })
        return DecorationSet.create(state.doc, decorations)
      },
      handleKeyDown(view, event) {
        const current = selectedPreview(layoutPreviewKey.getState(view.state) ?? [], view.state.selection.from, view.state.selection.to)
        if (current && (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) { current.cancel(); return true }
        return false
      },
    },
  })
}
export function layoutPreviewClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const values = (layoutPreviewKey.getState(view.state) ?? []).filter(value => value.sequence !== -1 && overlaps(view.state.selection.from, view.state.selection.to, value)).sort((a, b) => a.from - b.from)
  const { from, to } = view.state.selection
  if (!values.length || !event.clipboardData) return false
  event.preventDefault()
  if (!cut) {
    let at = from, text = ''
    for (const value of values) { text += view.state.doc.textBetween(at, Math.min(to, value.from), '\n') + previewBody(value.value, value.format ?? 'text').text; at = Math.max(at, value.to) }
    text += view.state.doc.textBetween(Math.min(at, to), to, '\n'); event.clipboardData.setData('text/plain', text)
  }
  return true
}
export const sourcePreviewEffect = StateEffect.define<PreviewRange | readonly PreviewRange[] | null>()
class SourcePreviewWidget extends WidgetType {
  constructor(readonly value: PreviewRange) { super() }
  eq(other: SourcePreviewWidget) { return widgetKey(other.value) === widgetKey(this.value) && other.value.value === this.value.value }
  toDOM() { return beginStatus(createPreviewBodyWidget(this.value.editId, this.value.value, 'source', this.value.cancel).element, this.value) }
  get lineBreaks() { return this.value.value.split('\n').length - 1 }
  ignoreEvent() { return true }
}
export const sourcePreviewField = StateField.define<readonly PreviewRange[]>({
  create: () => [],
  update(current, tr) {
    for (const effect of tr.effects) if (effect.is(sourcePreviewEffect)) return ranges(effect.value)
    return tr.docChanged ? current.map(value => mapPreviewRange(value, (position, assoc) => tr.changes.mapPos(position, assoc))) : current
  },
})
export function sourcePreviewExtensions(blocked: () => void) {
  const decorations = (state: SourceView['state']) => SourceDecoration.set(state.field(sourcePreviewField).filter(value => value.to <= state.doc.length).map(value => (value.sequence === -1
    ? SourceDecoration.widget({ widget: new SourcePreviewWidget(value), side: -1 })
    : SourceDecoration.replace({ widget: new SourcePreviewWidget(value), inclusive: false })).range(value.from, value.to)), true)
  return [sourcePreviewField, SourceView.decorations.compute([sourcePreviewField], decorations), SourceView.atomicRanges.of(view => decorations(view.state)),
    SourceView.domEventHandlers({ copy(event, view) { return copy(event, view, false) }, cut(event, view) { return copy(event, view, true) } }),
    SourceView.theme({ '.document-generation-preview': { whiteSpace: 'pre-wrap' } }),
    SourceView.inputHandler.of((view, from, to) => { if (view.state.field(sourcePreviewField).some(value => overlaps(from, to, value))) { blocked(); return true } return false }),
    SourceView.domEventHandlers({ keydown(event, view) {
      const current = selectedPreview(view.state.field(sourcePreviewField), view.state.selection.main.from, view.state.selection.main.to)
      if (current && (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) { event.preventDefault(); current.cancel(); return true }
      return false
    } }), sourcePreviewFilter(blocked),
  ]
  function copy(event: ClipboardEvent, view: SourceView, cut: boolean) {
    const previews = view.state.field(sourcePreviewField).filter(value => value.sequence !== -1).sort((a, b) => a.from - b.from)
    const selections = view.state.selection.ranges.filter(range => !range.empty).map(range => ({
      from: range.from, to: range.to, previews: previews.filter(value => overlaps(range.from, range.to, value)),
      wholePreview: previews.find(value => value.from === range.from && value.to === range.to),
    }))
    if (!selections.some(range => range.previews.length) || !event.clipboardData) return false
    event.preventDefault()
    if (cut) blocked()
    else {
      let text = ''
      for (let index = 0; index < selections.length; index++) {
        const { from, to, previews: values, wholePreview } = selections[index]
        if (index) {
          const previous = selections[index - 1].wholePreview
          // Preserve an aggregate's semantic boundary only when both complete adjacent parts are selected.
          text += previous && wholePreview && previous.editId === wholePreview.editId && previous.partId !== undefined && wholePreview.partId === previous.partId + 1
            ? wholePreview.separatorBefore ?? '' : view.state.lineBreak
        }
        let at = from
        for (const value of values) { text += view.state.sliceDoc(at, Math.min(to, value.from)) + value.value; at = Math.max(at, value.to) }
        text += view.state.sliceDoc(Math.min(at, to), to)
      }
      event.clipboardData.setData('text/plain', text)
    }
    return true
  }
}
function sourcePreviewFilter(blocked: () => void) {
  return SourceState.transactionFilter.of(tr => {
    const current = tr.startState.field(sourcePreviewField)
    if (!current.length || tr.effects.some(effect => effect.is(sourcePreviewEffect))) return tr
    let conflict = false
    tr.changes.iterChangedRanges((from, to) => { if (current.some(value => overlaps(from, to, value))) conflict = true })
    if (conflict) { blocked(); return [] }
    const selection = tr.newSelection.main
    const mapped = current.map(value => mapPreviewRange(value, (position, assoc) => tr.changes.mapPos(position, assoc))).find(value => inside(selection.head, value))
    return selection.empty && mapped ? [tr, { selection: EditorSelection.cursor(mapped.protectedTo ?? mapped.to) }] : tr
  })
}
