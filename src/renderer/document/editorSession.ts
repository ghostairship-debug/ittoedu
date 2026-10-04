import type { MarkdownSourceMap } from '../../shared/document/markdownSourceMap'
import { Plugin, EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { baseKeymap, chainCommands, exitCode, splitBlock } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { type MarkdownDocument } from '../../shared/document/markdown'
import type { DocumentPoint, DocumentSelection } from '../../shared/document/ports'
import { toEditorDocument, fromEditorDocument, renewEditorIdentities, editorPositionToPoint } from './documentAdapter'
import { documentEditorSchema as schema } from './editorSchema'
import { CellSelection, tableEditing } from 'prosemirror-tables'
import { Slice } from 'prosemirror-model'
import type { DocumentBlock } from '../../shared/document/content'
import { prepareDocumentClipboard, type DocumentClipboardResourcePort } from './documentClipboard'
import { documentResourceReferences } from '../../shared/document/resources'
import { resolveFlowParagraphPresentation } from '../../shared/flowBodyPresentation'
import { flowFormulaBlockElement, flowInlineFormulaHtml } from '../../shared/document/render'
import { previewCaretTransaction } from './editPreviewWidgets'
import { createDocumentInputRuleResult, matchDocumentInputRule, type DocumentFormulaDraftRequest } from './documentInputRules'
import { MermaidCodeBlockView } from './mermaidCodeBlockView'

/** Sent from a document object (picture, chart, component) that was right-clicked, after selecting it (M21). */
export const DOCUMENT_OBJECT_CONTEXT_MENU_EVENT = 'document-object-context-menu'
export interface DocumentObjectContextMenuDetail { x: number; y: number; blockId: string }

export interface DocumentOperation { operationId: string; historyGroup: string; source: 'layout' | 'source'; preparedResources?: unknown }
export interface LayoutEditorOptions {
  document: MarkdownDocument; revision: string; sourceMap?: MarkdownSourceMap
  change(document: MarkdownDocument, operation: DocumentOperation): boolean | void
  stateChanged?(state: EditorState): void
  requestMathDraft?(draft: DocumentFormulaDraftRequest): void
  selection?(selection: DocumentSelection | null): void
  undo(): void; redo(): void
  diagnostic(message: string): void
  readOnly?: boolean
  presentation?: 'flow'
  /** View-only space after document blocks; it is absent from the ProseMirror document and history. */
  runtimeSpacers?: readonly { readonly blockId: string; readonly height: number }[]
  renderObject?(block: DocumentBlock, container: HTMLElement): (() => void) | void
  objectRevision?: unknown
  clipboardContext?: unknown
  clipboardResourcePort?(context: unknown): DocumentClipboardResourcePort<unknown>
  projectionPlugins?: Plugin[]
  projectionClipboard?(view: EditorView, event: ClipboardEvent, cut: boolean): boolean
}
export function createLayoutEditor(element: HTMLElement, initial: LayoutEditorOptions) {
  let options = initial
  let composing = false
  let group = crypto.randomUUID()
  let lastInput = 0
  let deferred: LayoutEditorOptions | null = null
  const editorId = crypto.randomUUID()
  let pendingCut: string | null = null
  let plainPastePending = false
  let plainPasteTimer: ReturnType<typeof setTimeout> | null = null
  const clearPlainPaste = () => { plainPastePending = false; if (plainPasteTimer) clearTimeout(plainPasteTimer); plainPasteTimer = null }
  const clipboardType = 'application/x-cw-document-slice'
  const boundary = () => { group = crypto.randomUUID(); lastInput = 0 }
  const view = new EditorView(element, {
    state: EditorState.create({ doc: toEditorDocument(initial.document.content), plugins: [...(initial.projectionPlugins ?? []), new Plugin({ view(view) { options.stateChanged?.(view.state); return { update(view) { options.stateChanged?.(view.state) } } } }), keymap({
      'Mod-z': () => { boundary(); options.undo(); return true },
      'Mod-Shift-z': () => { boundary(); options.redo(); return true },
      'Mod-y': () => { boundary(); options.redo(); return true },
      'Shift-Enter': chainCommands(exitCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true }),
      Enter: (state, dispatch, currentView) => {
        if (state.selection.$from.parent.type.name === 'slot') {
          if (state.selection.$from.parent.attrs.key.startsWith('item:')) {
            const tr = state.tr.deleteSelection()
            tr.split(tr.selection.from, 1, [{ type: schema.nodes.slot, attrs: { key: `item:${crypto.randomUUID()}` } }])
            boundary(); dispatch?.(tr); return true
          }
          dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()))
          return true
        }
        boundary(); return splitBlock(state, dispatch, currentView)
      },
    }), keymap(baseKeymap), tableEditing()] }),
    attributes: { role: 'textbox', 'aria-label': '正文编辑', 'aria-multiline': 'true' },
    editable: () => !options.readOnly,
    decorations: state => {
      const decorations: Decoration[] = []
      const spacers = options.presentation === 'flow'
        ? new Map(options.runtimeSpacers?.map(spacer => [spacer.blockId, spacer.height]) ?? []) : new Map<string, number>()
      state.doc.descendants((node, pos) => {
        const id = node.attrs.id as string | undefined
        if (!id) return
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-testid': `flow-block-${id}`, 'data-flow-block-id': id,
          'data-flow-layer-kind': 'document-block', ...(options.presentation === 'flow' ? { 'data-flow-body-block': node.attrs.data?.type ?? node.type.name } : {}) }))
        const height = spacers.get(id)
        if (!height || !Number.isFinite(height) || height <= 0) return
        decorations.push(Decoration.widget(pos + node.nodeSize, () => {
          const spacer = document.createElement('div')
          spacer.dataset.flowRuntimeSpacer = id
          spacer.contentEditable = 'false'
          spacer.setAttribute('aria-hidden', 'true')
          spacer.style.cssText = `display:block;height:${height}px;pointer-events:none;user-select:none;`
          return spacer
        }, { key: `flow-runtime-spacer:${id}:${height}`, side: 1, ignoreSelection: true, stopEvent: () => true }))
      })
      return DecorationSet.create(state.doc, decorations)
    },
    nodeViews: {
      object: (node, view, getPos) => objectView(node, false, view, getPos),
      compound: (node, view, getPos) => objectView(node, true, view, getPos),
      code_block: (node, current) => new MermaidCodeBlockView(node, current),
      ...(initial.presentation !== 'flow' ? { slot: (node: import('prosemirror-model').Node) => {
        const key = node.attrs.key as string, dom = document.createElement(key.startsWith('item:') ? 'li' : 'div')
        dom.dataset.documentSlot = key
        const slot = options.sourceMap?.blocks.flatMap(block => block.slots).find(slot => slot.key === key)
        if (slot?.depth) dom.style.marginLeft = `${slot.depth * 1.5}em`
        if (slot?.ordered !== undefined) dom.style.listStyleType = slot.ordered ? 'decimal' : 'disc'
        return { dom, contentDOM: dom }
      } } : {}),
      ...(initial.presentation === 'flow' ? {
        paragraph: (node: import('prosemirror-model').Node) => textView(node, 'p'),
        formula: (node: import('prosemirror-model').Node) => flowFormulaView(node),
        math: (node: import('prosemirror-model').Node) => flowInlineMathView(node),
        heading: (node: import('prosemirror-model').Node) => textView(node, `h${node.attrs.data.level}`),
        section: (node: import('prosemirror-model').Node) => {
          const dom = flowBlockElement(node, 'details') as HTMLDetailsElement
          dom.open = !node.attrs.data.collapsedByDefault
          return { dom, contentDOM: dom }
        },
        slot: (node: import('prosemirror-model').Node, current: EditorView, getPos: () => number | undefined) => {
          const pos = getPos(), parent = pos === undefined ? undefined : current.state.doc.resolve(pos).parent
          const type = parent?.attrs.data?.type, key = node.attrs.key as string
          const tag = key.startsWith('item:') ? 'li' : key === 'citation' ? 'cite' : key === 'caption' ? 'figcaption'
            : type === 'section' && key === 'title' ? 'summary' : type === 'callout' && key === 'title' ? 'strong' : type === 'quote' || type === 'callout' ? 'p' : 'div'
          const dom = document.createElement(tag); dom.dataset.documentSlot = key
          const contentDOM = richTextHost(); dom.append(contentDOM)
          return { dom, contentDOM }
        },
      } : {}),
    },
    handleDOMEvents: {
      compositionstart: () => { composing = true; return false },
      compositionend: () => { composing = false; queueMicrotask(() => { if (view.isDestroyed) return; publish(); if (deferred) { const next = deferred; deferred = null; update(next) } }); return false },
      blur: () => { boundary(); return false },
      keyup: (_view, event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) syncDomTextSelection()
        return false
      },
      copy: (_view, event) => clipboard(event, false),
      cut: (_view, event) => clipboard(event, true),
    },
    handleKeyDown: (_currentView, event) => {
      if (event.key === 'Enter') syncDomTextSelection()
      return false
    },
    handleTextInput: (currentView, from, to, text) => {
      if (options.readOnly) return false
      const match = matchDocumentInputRule(currentView.state, from, to, text, composing || currentView.composing)
      if (!match) return false
      try {
        const result = createDocumentInputRuleResult(currentView.state, match, () => crypto.randomUUID())
        boundary()
        currentView.dispatch(result.transaction)
        if (result.kind === 'formula-draft') options.requestMathDraft?.(result.draft)
      } catch (error) { options.diagnostic(error instanceof Error ? error.message : String(error)) }
      return true
    },
    handlePaste: (_view, event) => {
      boundary()
      if (plainPastePending) {
        clearPlainPaste()
        const text = event.clipboardData?.getData('text/plain') ?? ''
        event.preventDefault()
        if (text) view.pasteText(text, new Event('paste') as ClipboardEvent)
        return true
      }
      const data = event.clipboardData?.getData(clipboardType)
      if (!data) return false
      try {
        const payload = JSON.parse(data)
        const moved = payload.editorId === editorId && payload.cutToken && payload.cutToken === pendingCut
        if (moved) {
          const assets = new Map(options.document.resources.assets.map(asset => [asset.assetId, asset]))
          payload.resources.assets.forEach((asset: MarkdownDocument['resources']['assets'][number]) => assets.set(asset.assetId, asset))
          const components = new Map(options.document.resources.components.map(component => [`${component.packageId}@${component.version}`, component]))
          payload.resources.components.forEach((component: MarkdownDocument['resources']['components'][number]) => components.set(`${component.packageId}@${component.version}`, component))
          options = { ...options, document: { ...options.document, resources: { assets: [...assets.values()], components: [...components.values()] } } }
        }
        if ((payload.resources.assets.length || payload.resources.components.length) && options.clipboardResourcePort && payload.editorId !== editorId) {
          void pastePrepared(payload)
          return true
        }
        if ((payload.resources.assets.length || payload.resources.components.length) && payload.editorId !== editorId) throw new Error('此文档尚未连接跨文档素材接入口，请先导入引用素材再粘贴')
        if (payload.resources.assets.some((asset: { assetId: string }) => !options.document.resources.assets.some(current => current.assetId === asset.assetId)) || payload.resources.components.some((component: { packageId: string; version: string }) => !options.document.resources.components.some(current => current.packageId === component.packageId && current.version === component.version))) throw new Error('跨文档粘贴需要先接入对象引用的素材与组件资源')
        const slice = Slice.fromJSON(schema, payload.slice)
        pendingCut = null
        const doc = schema.nodes.doc.create(null, slice.content)
        const copied = renewEditorIdentities(doc, () => crypto.randomUUID(), !moved)
        view.dispatch(view.state.tr.replaceSelection(new Slice(copied.content, slice.openStart, slice.openEnd)).scrollIntoView())
      } catch (error) { options.diagnostic(error instanceof Error ? error.message : String(error)) }
      return true
    },
    dispatchTransaction(transaction: Transaction) {
      const applied = view.state.applyTransaction(transaction), state = applied.state
      view.updateState(state)
      if (transaction.docChanged && !composing) publish(transaction.getMeta('preparedResources'))
      else if (transaction.selectionSet && !transaction.docChanged) boundary()
      // Decoration refreshes and preview-owned caret relocation must not become
      // manual AI context. Inspect appended transactions too: applyTransaction
      // can replace an ordinary caret with a synthetic NodeSelection.
      if (!transaction.selectionSet || transaction.docChanged || applied.transactions.some(item => item.getMeta(previewCaretTransaction))) return
      const described = describeSelection(state)
      if (described !== undefined) options.selection?.(described)
    },
  })
  /** The document selection of `state`; undefined for a cell selection whose cells cannot be identified. */
  function describeSelection(state: EditorState): DocumentSelection | null | undefined {
    if (state.selection instanceof CellSelection) {
      const a = state.selection.$anchorCell.nodeAfter?.firstChild?.attrs.key as string | undefined
      const h = state.selection.$headCell.nodeAfter?.firstChild?.attrs.key as string | undefined
      if (!a?.startsWith('cell:') || !h?.startsWith('cell:')) return undefined
      const [rowId, columnId] = JSON.parse(a.slice(5)); const [headRow, headColumn] = JSON.parse(h.slice(5))
      let depth = state.selection.$anchorCell.depth
      while (depth > 0 && !state.selection.$anchorCell.node(depth).attrs.id) depth--
      return { revision: options.revision, kind: 'cells', tableId: state.selection.$anchorCell.node(depth).attrs.id, anchor: { rowId, columnId }, head: { rowId: headRow, columnId: headColumn } }
    }
    if (state.selection instanceof NodeSelection && state.selection.node.attrs.id) return { revision: options.revision, kind: 'object', blockId: state.selection.node.attrs.id }
    const anchor = editorPositionToPoint(state.doc, state.selection.anchor)
    const head = editorPositionToPoint(state.doc, state.selection.head)
    return anchor && head ? { revision: options.revision, kind: 'text', anchor, head } : null
  }
  async function pastePrepared(payload: { slice: unknown; resources: MarkdownDocument['resources']; context?: unknown }) {
    const targetState = view.state; const revision = options.revision
    let port: DocumentClipboardResourcePort<unknown> | undefined
    let prepared: Awaited<ReturnType<typeof prepareDocumentClipboard>> | undefined
    try {
      port = options.clipboardResourcePort!(payload.context)
      const slice = Slice.fromJSON(schema, payload.slice)
      const source = { content: fromEditorDocument(schema.nodes.doc.create(null, slice.content)), resources: payload.resources }
      prepared = await prepareDocumentClipboard(source, options.document.resources, port)
      if (view.isDestroyed || view.state !== targetState || options.revision !== revision) { await port.discard(prepared.prepared); return }
      const assets = new Map(options.document.resources.assets.map(asset => [asset.assetId, asset])); prepared.document.resources.assets.forEach(asset => assets.set(asset.assetId, asset))
      const components = new Map(options.document.resources.components.map(component => [`${component.packageId}@${component.version}`, component])); prepared.document.resources.components.forEach(component => components.set(`${component.packageId}@${component.version}`, component))
      options = { ...options, document: { ...options.document, resources: { assets: [...assets.values()], components: [...components.values()] } } }
      const fragment = toEditorDocument(prepared.document.content).content
      const transaction = view.state.tr.replaceSelection(new Slice(fragment, slice.openStart, slice.openEnd)).setMeta('preparedResources', { value: prepared.prepared, discard: () => port!.discard(prepared!.prepared) })
      view.dispatch(transaction)
    } catch (error) { if (prepared) await port?.discard(prepared.prepared); options.diagnostic(error instanceof Error ? error.message : String(error)) }
  }
  function objectView(node: import('prosemirror-model').Node, editableSlots: boolean, owner: EditorView, getPos: () => number | undefined) {
    const block = { ...node.attrs.data, id: node.attrs.id } as DocumentBlock
    const flow = options.presentation === 'flow'
    // Flow draws a divider as playback does: a real rule, not a label.
    const tag = block.type === 'list' ? block.ordered ? 'ol' : 'ul' : block.type === 'quote' ? 'blockquote' : flow && block.type === 'divider' ? 'hr' : flow && block.type === 'callout' ? 'aside' : flow && ['media', 'chart', 'component', 'course-component'].includes(block.type) ? 'figure' : 'section'
    const dom = flow ? flowBlockElement(node, tag) : document.createElement(tag)
    if (!flow) dom.className = `document-object document-${node.attrs.data.type}`
    dom.dataset.documentId = node.attrs.id
    let destroy: (() => void) | void
    if (options.renderObject && ['media', 'chart', 'component', 'course-component'].includes(block.type)) {
      const object = document.createElement('div'); object.contentEditable = 'false'; dom.append(object)
      // A click on the picture, chart or component itself (not its caption) selects the whole block, so its quick bar
      // opens as it does for objects on a page (M21). ProseMirror alone selects such a block only on Ctrl+click.
      const selectBlock = () => {
        const pos = getPos()
        if (pos === undefined) return false
        if (!(owner.state.selection instanceof NodeSelection && owner.state.selection.from === pos)) owner.dispatch(owner.state.tr.setSelection(NodeSelection.create(owner.state.doc, pos)))
        owner.focus()
        return true
      }
      object.addEventListener('mousedown', event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return
        event.preventDefault()
        selectBlock()
      })
      // A right-click selects the object the same way and asks the editor for its menu.
      object.addEventListener('contextmenu', event => {
        event.preventDefault()
        if (!selectBlock()) return
        dom.dispatchEvent(new CustomEvent<DocumentObjectContextMenuDetail>(DOCUMENT_OBJECT_CONTEXT_MENU_EVENT, { bubbles: true, detail: { x: event.clientX, y: event.clientY, blockId: node.attrs.id } }))
      })
      destroy = options.renderObject(block, object)
    } else if (!editableSlots && !(flow && block.type === 'divider')) dom.textContent = `${block.type} 对象`
    // ProseMirror owns every child of contentDOM. Keep editable captions separate
    // from the React media host so mounting the caption cannot remove the media.
    const ownsRenderedObject = Boolean(options.renderObject && ['media', 'chart', 'component', 'course-component'].includes(block.type))
    const contentDOM = editableSlots ? (flow || block.type === 'list') && !ownsRenderedObject ? dom : document.createElement('div') : undefined
    if (contentDOM && contentDOM !== dom) dom.append(contentDOM)
    return { dom, contentDOM, ignoreMutation: (mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }) => mutation.type !== 'selection' && (!contentDOM || !contentDOM.contains(mutation.target)), destroy: () => destroy?.() }
  }
  function flowBlockElement(node: import('prosemirror-model').Node, tag: string) {
    const dom = document.createElement(tag)
    dom.dataset.documentId = node.attrs.id; dom.dataset.flowBodyBlock = node.attrs.data.type
    const presentation = resolveFlowParagraphPresentation(node.attrs.data)
    if (['paragraph', 'heading', 'quote'].includes(node.attrs.data.type)) {
      dom.style.textAlign = presentation.textAlign; dom.style.lineHeight = String(presentation.lineHeight)
    }
    return dom
  }
  // Flow formulas use playback's renderer and frame (M19); a formula that does not parse shows its source.
  function flowFormulaView(node: import('prosemirror-model').Node) {
    const data = node.attrs.data
    let dom: HTMLElement
    try { dom = flowFormulaBlockElement(document, data) } catch { dom = document.createElement('div'); dom.textContent = data.latex }
    dom.classList.add('document-math'); dom.contentEditable = 'false'
    dom.dataset.documentId = node.attrs.id; dom.dataset.flowBodyBlock = 'formula'; dom.dataset.formulaId = data.formulaId
    return { dom }
  }
  function flowInlineMathView(node: import('prosemirror-model').Node) {
    const data = node.attrs.data
    const dom = document.createElement('span')
    dom.className = 'document-math'; dom.contentEditable = 'false'; dom.dataset.formulaId = data.formulaId
    try { dom.innerHTML = flowInlineFormulaHtml(data) } catch { dom.textContent = data.latex }
    return { dom }
  }
  function richTextHost() { const dom = document.createElement('span'); dom.dataset.flowIdleRichText = 'true'; return dom }
  function textView(node: import('prosemirror-model').Node, tag: string) {
    const dom = flowBlockElement(node, tag), contentDOM = richTextHost(); dom.append(contentDOM); return { dom, contentDOM }
  }
  function clipboard(event: ClipboardEvent, cut: boolean): boolean {
    if (options.projectionClipboard?.(view, event, cut)) return true
    if (!event.clipboardData || view.state.selection.empty) return false
    const slice = view.state.selection.content()
    const cutToken = cut ? crypto.randomUUID() : null
    pendingCut = cutToken
    const assets = new Set<string>(); const components = new Set<string>()
    slice.content.descendants(node => {
      const data = node.attrs.data
      if (data?.type === 'media' && data.assetId) assets.add(data.assetId)
      if (data?.type === 'component') { assets.add(data.staticFallbackAssetId); components.add(`${data.component.packageId}@${data.component.version}`) }
    })
    const resources = { assets: options.document.resources.assets.filter(asset => assets.has(asset.assetId)), components: options.document.resources.components.filter(component => components.has(`${component.packageId}@${component.version}`)) }
    let context: unknown
    try { context = typeof options.clipboardContext === 'function' ? options.clipboardContext(resources) : options.clipboardContext }
    catch (error) { event.preventDefault(); options.diagnostic(error instanceof Error ? error.message : String(error)); return true }
    event.clipboardData.setData(clipboardType, JSON.stringify({ editorId, cutToken, slice: slice.toJSON(), resources, context }))
    event.clipboardData.setData('text/plain', slice.content.textBetween(0, slice.content.size, '\n', node => node.attrs.data?.accessibleText ?? ''))
    event.preventDefault()
    if (cut) { boundary(); view.dispatch(view.state.tr.deleteSelection()) }
    return true
  }
  function publish(prepared?: { value: unknown; discard(): Promise<void> }) {
    try {
      const repaired = renewEditorIdentities(view.state.doc, () => crypto.randomUUID())
      if (!repaired.eq(view.state.doc)) {
        const { anchor, head } = view.state.selection
        const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, repaired.content)
        tr.setSelection(TextSelection.create(tr.doc, anchor, head))
        view.updateState(view.state.apply(tr))
      }
      const content = fromEditorDocument(view.state.doc)
      if (JSON.stringify(content) === JSON.stringify(options.document.content)) return
      const now = Date.now()
      if (now - lastInput > 800) boundary()
      lastInput = now
      const refs = documentResourceReferences(content.blocks)
      const document = { content, resources: {
        assets: options.document.resources.assets.filter(asset => refs.assets.includes(asset.assetId)),
        components: options.document.resources.components.filter(component => refs.components.some(ref => ref.packageId === component.packageId && ref.version === component.version)),
      } }
      options = { ...options, document }
      const result = options.change(document, { operationId: crypto.randomUUID(), historyGroup: group, source: 'layout', ...(prepared ? { preparedResources: prepared.value } : {}) })
      if (result === false) void prepared?.discard()
    } catch (error) { void prepared?.discard(); options.diagnostic(error instanceof Error ? error.message : String(error)) }
  }
  function syncDomTextSelection() {
    if (composing || view.composing || options.readOnly || view.isDestroyed || !view.hasFocus() ||
      view.state.selection instanceof CellSelection || view.state.selection instanceof NodeSelection) return
    const selection = view.dom.ownerDocument.getSelection()
    if (!selection?.anchorNode || !selection.focusNode || !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset)
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset)
    const current = view.state.selection
    if (current.anchor === anchor && current.head === head) return // Keep pending input marks.
    const $anchor = view.state.doc.resolve(anchor), $head = view.state.doc.resolve(head)
    if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
  }
  /**
   * A change from outside the editor replaces a block whose data changed, and a selection in it falls back to text.
   * The cells or the object that were selected are selected again while they are still there, so an element card's
   * own edit keeps its element selected (M15).
   */
  function reselect(kept: DocumentSelection | null | undefined) {
    if (!kept || kept.kind === 'text') return
    const identity = (value: DocumentSelection) => JSON.stringify({ ...value, revision: '' })
    const now = describeSelection(view.state)
    if (now && identity(now) === identity(kept)) return
    const { doc } = view.state, blockId = kept.kind === 'cells' ? kept.tableId : kept.blockId
    let at = -1
    doc.descendants((node, position) => { if (at < 0 && node.attrs.id === blockId) at = position; return at < 0 })
    const block = at < 0 ? null : doc.nodeAt(at)
    if (!block) return
    let selection: NodeSelection | CellSelection | null = null
    if (kept.kind === 'object') selection = NodeSelection.isSelectable(block) ? NodeSelection.create(doc, at) : null
    else {
      const cell = (point: { rowId: string; columnId: string }) => {
        const key = `cell:${JSON.stringify([point.rowId, point.columnId])}`
        let found = -1
        block.descendants((node, offset) => { if (found < 0 && node.type.spec.tableRole && node.firstChild?.attrs.key === key) found = at + 1 + offset; return found < 0 })
        return found
      }
      const anchor = cell(kept.anchor), head = cell(kept.head)
      selection = anchor >= 0 && head >= 0 ? CellSelection.create(doc, anchor, head) : null
    }
    if (selection) view.updateState(view.state.apply(view.state.tr.setSelection(selection)))
  }
  /** A closed top-level replacement is required when a changed node contains a table. */
  function tableReplacement(before: import('prosemirror-model').Node, after: import('prosemirror-model').Node) {
    let prefix = 0, suffix = 0, from = 0
    while (prefix < before.childCount && prefix < after.childCount && before.child(prefix).eq(after.child(prefix))) {
      from += before.child(prefix).nodeSize; prefix++
    }
    while (suffix < before.childCount - prefix && suffix < after.childCount - prefix &&
      before.child(before.childCount - suffix - 1).eq(after.child(after.childCount - suffix - 1))) suffix++
    const beforeEnd = before.content.size - Array.from({ length: suffix }, (_, i) => before.child(before.childCount - i - 1).nodeSize).reduce((a, b) => a + b, 0)
    const afterEnd = after.content.size - Array.from({ length: suffix }, (_, i) => after.child(after.childCount - i - 1).nodeSize).reduce((a, b) => a + b, 0)
    const hasTable = (node: import('prosemirror-model').Node) => {
      if (node.type.name === 'table_container') return true
      let found = false
      node.descendants(child => { if (child.type.name === 'table_container') { found = true; return false } })
      return found
    }
    const affected = (doc: import('prosemirror-model').Node) =>
      Array.from({ length: doc.childCount - prefix - suffix }, (_, i) => doc.child(prefix + i)).some(hasTable)
    return affected(before) || affected(after) ? { from, beforeEnd, afterEnd } : null
  }
  /** Resolve a logical document point after a closed replacement, including Unicode and math atoms. */
  function pointPosition(doc: import('prosemirror-model').Node, point: DocumentPoint): number | null {
    let blockAt = -1
    doc.descendants((node, at) => { if (blockAt < 0 && node.attrs.id === point.blockId) blockAt = at; return blockAt < 0 })
    const block = blockAt < 0 ? null : doc.nodeAt(blockAt)
    if (!block) return null
    const key = point.slot.kind === 'field' ? point.slot.field : point.slot.kind === 'item' ? `item:` + point.slot.itemId
      : point.slot.kind === 'header' ? `column:` + point.slot.columnId : `cell:` + JSON.stringify([point.slot.rowId, point.slot.columnId])
    let slotAt = blockAt, slot = block
    if (!(key === 'content' && block.isTextblock)) {
      slotAt = -1
      block.descendants((node, at) => { if (slotAt < 0 && node.type.name === 'slot' && node.attrs.key === key) { slotAt = blockAt + 1 + at; slot = node } return slotAt < 0 })
    }
    if (slotAt < 0 || !slot.isTextblock) return null
    let remaining = Math.max(0, point.offset), utf16 = 0
    slot.forEach(child => {
      if (remaining <= 0) return
      const width = child.isText ? Array.from(child.text ?? '').length : 1
      const count = Math.min(remaining, width)
      utf16 += child.isText ? Array.from(child.text ?? '').slice(0, count).join('').length : count
      remaining -= count
    })
    return slotAt + 1 + utf16
  }
  function restoreTextSelection(kept: DocumentSelection | null | undefined) {
    if (kept?.kind !== 'text') return
    const anchor = pointPosition(view.state.doc, kept.anchor), head = pointPosition(view.state.doc, kept.head)
    if (anchor === null || head === null) return
    view.updateState(view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head))))
  }
  function update(next: LayoutEditorOptions) {
    if (composing) { deferred = next; return }
    const changed = JSON.stringify(next.document.content) !== JSON.stringify(options.document.content)
    const refreshObjects = next.objectRevision !== options.objectRevision
    const refreshSpacers = JSON.stringify(next.runtimeSpacers) !== JSON.stringify(options.runtimeSpacers)
    options = next
    if (changed) {
      boundary()
      const kept = describeSelection(view.state)
      const document = toEditorDocument(next.document.content), from = view.state.doc.content.findDiffStart(document.content)
      const end = view.state.doc.content.findDiffEnd(document.content)
      if (from !== null && end) {
        const overlap = from - Math.min(end.a, end.b)
        const to = end.a + Math.max(0, overlap), nextTo = end.b + Math.max(0, overlap)
        const closed = tableReplacement(view.state.doc, document)
        const transaction = closed
          ? view.state.tr.replaceWith(closed.from, closed.beforeEnd, document.content.cut(closed.from, closed.afterEnd))
          : view.state.tr.replace(from, to, document.slice(from, nextTo))
        transaction.setMeta('canonicalUpdate', true)
        view.updateState(view.state.apply(transaction))
        if (closed) restoreTextSelection(kept)
        reselect(kept)
      }
    }
    if (refreshObjects) view.setProps({ nodeViews: { ...view.props.nodeViews, object: (node, current, getPos) => objectView(node, false, current, getPos), compound: (node, current, getPos) => objectView(node, true, current, getPos) } })
    if (refreshSpacers) view.setProps({ decorations: view.props.decorations })
  }
  return { view, update, boundary, syncDomTextSelection,
    requestPlainPaste: () => { clearPlainPaste(); plainPastePending = true; plainPasteTimer = setTimeout(clearPlainPaste, 3000); return clearPlainPaste },
    flush: () => { if (composing) return false; publish(); boundary(); return true }, destroy: () => { clearPlainPaste(); view.destroy() },
    /** Current selection at the current revision, for re-reporting it after a committed edit such as formatting. */
    readSelection: () => describeSelection(view.state) ?? null }
}
