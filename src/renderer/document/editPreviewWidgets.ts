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
export interface PreviewRange { editId: string; sequence?: number; from: number; to: number; value: string; cancel(): void; format?: PreviewFormat; blockNodes?: { from: number; to: number }[]; protectedFrom?: number; protectedTo?: number }
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
function renderedSelection(text: string, from: number, to: number, value: PreviewRange) {
  return text.slice(from, Math.min(to, value.from)) + value.value + text.slice(Math.max(from, value.to), to)
}

export function sourcePreviewRange(preview: DocumentEditPreview | undefined, map: MarkdownSourceMap): PreviewRange | null {
  const range = resolvedSourcePreviewRange(preview, map)
  return range?.sequence === -1 ? { ...range, protectedFrom: range.from, protectedTo: range.to, to: range.from, value: '正在准备正文…' } : range
}
function resolvedSourcePreviewRange(preview: DocumentEditPreview | undefined, map: MarkdownSourceMap): PreviewRange | null {
  if (!preview) return null
  const { target } = preview
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
  const target = preview.target
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

export const layoutPreviewKey = new PluginKey<PreviewRange | null>('g20-edit-preview')
const mapPreviewRange = (range: PreviewRange, map: (position: number, assoc: number) => number): PreviewRange => ({
  ...range, from: map(range.from, 1), to: map(range.to, -1),
  ...(range.protectedFrom === undefined ? {} : { protectedFrom: map(range.protectedFrom, 1) }),
  ...(range.protectedTo === undefined ? {} : { protectedTo: map(range.protectedTo, -1) }),
  ...(range.blockNodes ? { blockNodes: range.blockNodes.map(node => ({ from: map(node.from, 1), to: map(node.to, -1) })) } : {}),
})
/** Relocates the caret out of a temporary projection; it is not a teacher selection. */
export const previewCaretTransaction = 'g20-preview-caret'
export function layoutPreviewPlugin(blocked: () => void): Plugin<PreviewRange | null> {
  const widgets = new Map<HTMLElement, { editId: string; body: PreviewBodyWidget }>()
  return new Plugin<PreviewRange | null>({ key: layoutPreviewKey,
    state: { init: () => null, apply(tr, current) {
      if (tr.getMeta(layoutPreviewKey) !== undefined) return tr.getMeta(layoutPreviewKey)
      if (!current || !tr.docChanged) return current
      if (tr.getMeta('canonicalUpdate')) return null
      return mapPreviewRange(current, (position, assoc) => tr.mapping.map(position, assoc))
    } },
    filterTransaction(tr, state) {
      const current = layoutPreviewKey.getState(state)
      if (!current || !tr.docChanged || tr.getMeta('canonicalUpdate')) return true
      let conflict = false, range = current
      for (const mapping of tr.mapping.maps) {
        mapping.forEach((from, to) => { if (overlaps(from, to, range) || from === to && hiddenBlockPosition(from, range)) conflict = true })
        range = mapPreviewRange(range, (position, assoc) => mapping.map(position, assoc))
      }
      if (conflict) blocked()
      return !conflict
    },
    appendTransaction(_transactions, _old, state) {
      const current = layoutPreviewKey.getState(state)
      if (!current) {
        const previous = layoutPreviewKey.getState(_old)
        return previous?.blockNodes?.[0].from === state.selection.from && state.selection instanceof NodeSelection ? state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(state.selection.from + 1, state.doc.content.size)))).setMeta(previewCaretTransaction, true) : null
      }
      if (!state.selection.empty || !(inside(state.selection.from, current) || hiddenBlockPosition(state.selection.from, current))) return null
      if (current.blockNodes?.length) {
        const first = current.blockNodes[0].from, end = current.blockNodes.at(-1)!.to
        return state.tr.setSelection(end < state.doc.content.size ? TextSelection.near(state.doc.resolve(end), 1) : first > 0 ? TextSelection.near(state.doc.resolve(first), -1) : NodeSelection.create(state.doc, first)).setMeta(previewCaretTransaction, true)
      }
      return state.tr.setSelection(TextSelection.near(state.doc.resolve(current.protectedTo ?? current.to))).setMeta(previewCaretTransaction, true)
    },
    view: () => ({ update(view) { const current = layoutPreviewKey.getState(view.state); if (current) for (const widget of widgets.values()) if (widget.editId === current.editId) widget.body.update(current.value, current.cancel) }, destroy() { for (const widget of widgets.values()) widget.body.destroy(); widgets.clear() } }),
    props: {
      decorations(state) {
        const current = layoutPreviewKey.getState(state)
        if (!current) return null
        const decorations = [Decoration.widget(current.blockNodes?.[0].from ?? current.from, () => {
          const body = createPreviewBodyWidget(current.editId, current.value, current.format ?? 'text', current.cancel)
          widgets.set(body.element, { editId: current.editId, body }); return beginStatus(body.element, current)
        }, { side: -1, key: `${current.editId}:${current.format ?? 'text'}:${current.sequence === -1 ? 'begin' : 'body'}`, stopEvent: () => true, destroy(dom) { const owned = widgets.get(dom as HTMLElement); owned?.body.destroy(); widgets.delete(dom as HTMLElement) } })]
        if (current.blockNodes?.length) for (const node of current.blockNodes) decorations.push(Decoration.node(node.from, node.to, { class: 'document-generation-hidden', 'aria-hidden': 'true' }))
        else if (current.from < current.to) decorations.push(Decoration.inline(current.from, current.to, { class: 'document-generation-hidden', 'aria-hidden': 'true' }))
        return DecorationSet.create(state.doc, decorations)
      },
      handleKeyDown(view, event) {
        const current = layoutPreviewKey.getState(view.state)
        if (current && (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) { current.cancel(); return true }
        return false
      },
    },
  })
}
export function layoutPreviewClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  const preview = layoutPreviewKey.getState(view.state), { from, to } = view.state.selection
  if (!preview || preview.sequence === -1 || !overlaps(from, to, preview) || !event.clipboardData) return false
  event.preventDefault()
  if (!cut) event.clipboardData.setData('text/plain', (from < preview.from ? view.state.doc.textBetween(from, Math.min(to, preview.from), '\n') : '') + previewBody(preview.value, preview.format ?? 'text').text + (to > preview.to ? view.state.doc.textBetween(Math.max(from, preview.to), to, '\n') : ''))
  return true
}

export const sourcePreviewEffect = StateEffect.define<PreviewRange | null>()
class SourcePreviewWidget extends WidgetType {
  constructor(readonly value: PreviewRange) { super() }
  eq(other: SourcePreviewWidget) { return other.value.editId === this.value.editId && other.value.value === this.value.value }
  toDOM() { return beginStatus(createPreviewBodyWidget(this.value.editId, this.value.value, 'source', this.value.cancel).element, this.value) }
  get lineBreaks() { return this.value.value.split('\n').length - 1 }
  ignoreEvent() { return true }
}
export const sourcePreviewField = StateField.define<PreviewRange | null>({
  create: () => null,
  update(current, tr) {
    for (const effect of tr.effects) if (effect.is(sourcePreviewEffect)) return effect.value
    return current && tr.docChanged ? mapPreviewRange(current, (position, assoc) => tr.changes.mapPos(position, assoc)) : current
  },
})
export function sourcePreviewExtensions(blocked: () => void) {
  const decorations = (state: SourceView['state']) => {
    const current = state.field(sourcePreviewField)
    return current && current.to <= state.doc.length ? SourceDecoration.set([(current.sequence === -1
      ? SourceDecoration.widget({ widget: new SourcePreviewWidget(current), side: -1 })
      : SourceDecoration.replace({ widget: new SourcePreviewWidget(current), inclusive: false })).range(current.from, current.to)]) : SourceDecoration.none
  }
  return [sourcePreviewField, SourceView.decorations.compute([sourcePreviewField], decorations),
    SourceView.atomicRanges.of(view => decorations(view.state)),
    SourceView.domEventHandlers({
      copy(event, view) { return copy(event, view, false) }, cut(event, view) { return copy(event, view, true) },
    }),
    SourceView.theme({ '.document-generation-preview': { whiteSpace: 'pre-wrap' } }),
    // Canonical synchronization carries an explicit clear effect; user operations do not.
    SourceView.inputHandler.of((_view, from, to) => {
      const current = _view.state.field(sourcePreviewField)
      if (current && overlaps(from, to, current)) { blocked(); return true }
      return false
    }),
    SourceView.domEventHandlers({ keydown(event, view) {
      const current = view.state.field(sourcePreviewField)
      if (current && (event.key === 'Escape' || (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z')) { event.preventDefault(); current.cancel(); return true }
      return false
    } }),
    // State transaction filters run before any caller's onDraft listener.
    sourcePreviewFilter(blocked),
  ]
  function copy(event: ClipboardEvent, view: SourceView, cut: boolean) {
    const current = view.state.field(sourcePreviewField), { from, to } = view.state.selection.main
    if (!current || current.sequence === -1 || !overlaps(from, to, current) || !event.clipboardData) return false
    event.preventDefault()
    if (cut) blocked()
    else event.clipboardData.setData('text/plain', renderedSelection(view.state.doc.toString(), from, to, current))
    return true
  }
}
function sourcePreviewFilter(blocked: () => void) {
  return SourceState.transactionFilter.of(tr => {
    const current = tr.startState.field(sourcePreviewField)
    if (!current || tr.effects.some(effect => effect.is(sourcePreviewEffect))) return tr
    let conflict = false
    tr.changes.iterChangedRanges((from, to) => { if (overlaps(from, to, current)) conflict = true })
    if (conflict) { blocked(); return [] }
    const mapped = mapPreviewRange(current, (position, assoc) => tr.changes.mapPos(position, assoc))
    const selection = tr.newSelection.main
    if (selection.empty && inside(selection.head, mapped)) return [tr, { selection: EditorSelection.cursor(mapped.protectedTo ?? mapped.to) }]
    return tr
  })
}
