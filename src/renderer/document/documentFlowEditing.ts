import { keymap } from 'prosemirror-keymap'
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from 'prosemirror-model'
import { Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { ReplaceStep } from 'prosemirror-transform'

export interface DocumentFlowEditingOptions {
  /** The canonical layout owner identifies row/grid groups whose items are columns. */
  isMultiColumnLayout?(groupId: string): boolean
}

const flowEditing = new PluginKey<DocumentFlowEditingOptions>('documentFlowEditing')

function layoutItemPath(point: ResolvedPos, options: DocumentFlowEditingOptions): { group: number; item: number | null }[] {
  const path: { group: number; item: number | null }[] = []
  for (let depth = 1; depth <= point.depth; depth++) {
    const node = point.node(depth)
    if (node.type.name === 'layout_group') path.push({ group: point.before(depth), item: options.isMultiColumnLayout?.(node.attrs.id) ? point.index(depth) : null })
  }
  return path
}

/** Delete selected content, while partially selected layout carriers keep their identities. */
function layoutRangeTransaction(state: EditorState, options: DocumentFlowEditingOptions, from = state.selection.from, to = state.selection.to): Transaction | undefined {
  if (!(state.selection instanceof TextSelection) || from === to) return undefined
  const selection = TextSelection.create(state.doc, from, to)
  if (selection.$from.sameParent(selection.$to)) return undefined
  const fromPath = layoutItemPath(selection.$from, options), toPath = layoutItemPath(selection.$to, options)
  if (fromPath.length === toPath.length && fromPath.every((entry, index) => entry.group === toPath[index].group && entry.item === toPath[index].item)) return undefined

  const ranges: { from: number; to: number }[] = []
  state.doc.nodesBetween(selection.from, selection.to, (node, position) => {
    const end = position + node.nodeSize
    if (selection.from <= position && end <= selection.to) {
      ranges.push({ from: position, to: end })
      return false
    }
    if (node.isTextblock) {
      const from = Math.max(selection.from, position + 1), to = Math.min(selection.to, end - 1)
      if (from < to) ranges.push({ from, to })
      return false
    }
    return true
  })
  // Each replacement stays inside its original carrier. A single open-range
  // replacement would join the endpoint columns and discard the second owner.
  const transaction = state.tr
  for (const range of ranges.reverse()) transaction.delete(range.from, range.to)
  transaction.setSelection(Selection.near(transaction.doc.resolve(transaction.mapping.map(selection.from)), 1))
  return transaction
}

/** All explicit range consumers start with the same carrier-preserving transaction. */
export function flowSelectionTransaction(state: EditorState): Transaction {
  const options = flowEditing.getState(state)
  return options && layoutRangeTransaction(state, options) || state.tr
}

/** A partial text selection does not own the column wrappers on either edge. */
export function flowSelectionSlice(state: EditorState, slice: Slice): Slice {
  if (!flowSelectionTransaction(state).docChanged) return slice
  const partial = new Set<string>()
  for (const point of [state.selection.$from, state.selection.$to]) for (let depth = 1; depth <= point.depth; depth++) {
    if (point.node(depth).type.name === 'layout_group') partial.add(point.node(depth).attrs.id)
  }
  const openDepth = (end: boolean) => {
    let removed = 0, depth = 0, node = end ? slice.content.lastChild : slice.content.firstChild
    const open = end ? slice.openEnd : slice.openStart
    while (node && depth++ < open) {
      if (node.type.name === 'layout_group' && partial.has(node.attrs.id)) removed++
      node = end ? node.lastChild : node.firstChild
    }
    return open - removed
  }
  const unwrap = (content: Fragment): Fragment => {
    const nodes: PMNode[] = []
    content.forEach(node => {
      const children = unwrap(node.content)
      if (node.type.name === 'layout_group' && partial.has(node.attrs.id)) children.forEach(child => nodes.push(child))
      else nodes.push(node.isLeaf ? node : node.copy(children))
    })
    return Fragment.from(nodes)
  }
  return new Slice(unwrap(slice.content), openDepth(false), openDepth(true))
}

/**
 * DOM text input (including native IME) can bypass selection.replace. Normalize
 * its actual inline replacement before applying/publishing it; compositionstart
 * itself never deletes anything. Structural commands prepare their selection
 * before building their PM steps instead of guessing a fitted slice afterwards.
 */
export function preserveFlowTextTransaction(state: EditorState, transaction: Transaction): Transaction {
  const options = flowEditing.getState(state), step = transaction.steps[0]
  if (!options || transaction.steps.length !== 1 || !(step instanceof ReplaceStep)) return transaction
  let inline = true
  step.slice.content.forEach(node => { if (!node.isInline) inline = false })
  if (!inline) return transaction
  const prepared = layoutRangeTransaction(state, options, step.from, step.to)
  if (!prepared) return transaction
  if (step.slice.size) prepared.replaceSelection(step.slice)
  // Metadata belongs to the original input (paste/resources/composition), not
  // to a new authoring operation. Keep it on the one normalized transaction.
  const metadata = Reflect.get(transaction, 'meta') as Record<string, unknown>
  for (const [key, value] of Object.entries(metadata)) prepared.setMeta(key, value)
  if (transaction.storedMarksSet) prepared.setStoredMarks(transaction.storedMarks)
  prepared.setTime(transaction.time)
  return transaction.scrolledIntoView ? prepared.scrollIntoView() : prepared
}

/** PM prepares a cross-parent composition by deleting its selection before input. */
export function isFlowCompositionPreparation(state: EditorState, transaction: Transaction): boolean {
  const step = transaction.steps[0]
  return transaction.steps.length === 1 && step instanceof ReplaceStep && step.slice.size === 0
    && step.from === state.selection.from && step.to === state.selection.to
    && transaction.getMeta('composition') === undefined && transaction.getMeta('uiEvent') === undefined
    && flowSelectionTransaction(state).docChanged
}

/** Run PM's ordinary structural command after the same safe range deletion. */
export function withFlowSelection(command: Command): Command {
  return (state, dispatch, view) => {
    const prepared = flowSelectionTransaction(state)
    if (!prepared.docChanged) return command(state, dispatch, view)
    if (!dispatch) return command(state.apply(prepared), undefined, view)
    return command(state.apply(prepared), next => {
      for (const step of next.steps) prepared.step(step)
      prepared.setSelection(Selection.fromJSON(prepared.doc, next.selection.toJSON()))
      if (next.storedMarksSet) prepared.setStoredMarks(next.storedMarks)
      dispatch(next.scrolledIntoView ? prepared.scrollIntoView() : prepared)
    }, view)
  }
}

function atLayoutItemBoundary(state: EditorState, direction: -1 | 1, options: DocumentFlowEditingOptions): boolean {
  const selection = state.selection
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const point = selection.$from
  if (!point.parent.isTextblock || (direction < 0 ? point.parentOffset !== 0 : point.parentOffset !== point.parent.content.size)) return false
  for (let depth = point.depth - 1; depth > 0; depth--) {
    // A paragraph inside a section may still join another paragraph inside
    // that section; only the edge of the layout's direct item is protected.
    if (direction < 0 ? point.index(depth + 1) !== 0 : point.indexAfter(depth + 1) !== point.node(depth + 1).childCount) return false
    const parent = point.node(depth)
    if (parent.type.name !== 'layout_group' || !options.isMultiColumnLayout?.(parent.attrs.id)) continue
    const index = point.index(depth)
    if (direction < 0 ? index > 0 : index + 1 < parent.childCount) return true
  }
  return false
}

/** Keep native Flow layout identities while using PM's ordinary editing elsewhere. */
export function documentFlowEditingPlugin(options: DocumentFlowEditingOptions = {}) {
  const remove = (direction: -1 | 1): Command => (state, dispatch, view) => {
    if (view && !view.editable) return false
    const transaction = layoutRangeTransaction(state, options)
    if (transaction) { dispatch?.(transaction.scrollIntoView()); return true }
    return atLayoutItemBoundary(state, direction, options)
  }
  const backward = remove(-1), forward = remove(1)
  const bindings = keymap({ Backspace: backward, Delete: forward, 'Mod-Backspace': backward, 'Mod-Delete': forward })
  return new Plugin({ key: flowEditing, state: { init: () => options, apply: (_transaction, current) => current }, props: bindings.props })
}
