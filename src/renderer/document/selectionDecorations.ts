import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration as SourceDecoration, EditorView } from '@codemirror/view'
export interface SelectionRange { from: number; to: number }
export const pinnedSelectionKey = new PluginKey<DecorationSet>('pinned-selection')
export function pinnedSelectionPlugin() { return new Plugin({ key: pinnedSelectionKey,
  state: { init: () => DecorationSet.empty, apply(tr, previous) {
    const ranges: SelectionRange[] | undefined = tr.getMeta(pinnedSelectionKey)
    return ranges ? DecorationSet.create(tr.doc, ranges.filter(r => r.from < r.to && r.to <= tr.doc.content.size).map(r => Decoration.inline(r.from, r.to, { class: 'document-context-pin', 'data-context-pin': 'true' }))) : previous.map(tr.mapping, tr.doc)
  } }, props: { decorations: state => pinnedSelectionKey.getState(state) } }) }
export const sourcePinnedSelectionEffect = StateEffect.define<SelectionRange[]>()
export const sourcePinnedSelectionField = StateField.define({ create: () => SourceDecoration.none,
  update(value, tr) { value = value.map(tr.changes); for (const effect of tr.effects) if (effect.is(sourcePinnedSelectionEffect)) value = SourceDecoration.set(effect.value.filter(r => r.from < r.to && r.to <= tr.state.doc.length).map(r => SourceDecoration.mark({ class: 'document-context-pin' }).range(r.from, r.to)), true); return value },
  provide: field => EditorView.decorations.from(field) })
