import { Plugin, EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import { baseKeymap, chainCommands, exitCode, splitBlock } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { type MarkdownDocument } from '../../shared/document/markdown'
import type { DocumentSelection } from '../../shared/document/ports'
import { toEditorDocument, fromEditorDocument, renewEditorIdentities, editorPositionToPoint } from './documentAdapter'
import { documentEditorSchema as schema } from './editorSchema'
import { CellSelection, tableEditing } from 'prosemirror-tables'
import { Slice } from 'prosemirror-model'
import type { DocumentBlock } from '../../shared/document/content'
import { prepareDocumentClipboard, type DocumentClipboardResourcePort } from './documentClipboard'
import { documentResourceReferences } from '../../shared/document/resources'
import { resolveFlowParagraphPresentation } from '../../shared/flowBodyPresentation'

export interface DocumentOperation { operationId: string; historyGroup: string; source: 'layout' | 'source'; preparedResources?: unknown }
export interface LayoutEditorOptions {
  document: MarkdownDocument; revision: string
  change(document: MarkdownDocument, operation: DocumentOperation): boolean | void
  stateChanged?(state: EditorState): void
  selection?(selection: DocumentSelection | null): void
  undo(): void; redo(): void
  diagnostic(message: string): void
  readOnly?: boolean
  presentation?: 'flow'
  renderObject?(block: DocumentBlock, container: HTMLElement): (() => void) | void
  objectRevision?: unknown
  clipboardContext?: unknown
  clipboardResourcePort?(context: unknown): DocumentClipboardResourcePort<unknown>
}
export function createLayoutEditor(element: HTMLElement, initial: LayoutEditorOptions) {
  let options = initial
  let composing = false
  let group = crypto.randomUUID()
  let lastInput = 0
  let deferred: LayoutEditorOptions | null = null
  const editorId = crypto.randomUUID()
  let pendingCut: string | null = null
  const clipboardType = 'application/x-cw-document-slice'
  const boundary = () => { group = crypto.randomUUID(); lastInput = 0 }
  const view = new EditorView(element, {
    state: EditorState.create({ doc: toEditorDocument(initial.document.content), plugins: [new Plugin({ view(view) { options.stateChanged?.(view.state); return { update(view) { options.stateChanged?.(view.state) } } } }), keymap({
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
    attributes: { role: 'textbox', 'aria-label': '正文排版编辑', 'aria-multiline': 'true' },
    editable: () => !options.readOnly,
    decorations: state => {
      const decorations: Decoration[] = []
      state.doc.descendants((node, pos) => { if (node.attrs.id) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-testid': `flow-block-${node.attrs.id}`, 'data-flow-block-id': node.attrs.id, 'data-flow-layer-kind': 'document-block', ...(options.presentation === 'flow' ? { 'data-flow-body-block': node.attrs.data?.type ?? node.type.name } : {}) })) })
      return DecorationSet.create(state.doc, decorations)
    },
    nodeViews: {
      object: node => objectView(node, false),
      compound: node => objectView(node, true),
      ...(initial.presentation === 'flow' ? {
        paragraph: (node: import('prosemirror-model').Node) => textView(node, 'p'),
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
      copy: (_view, event) => clipboard(event, false),
      cut: (_view, event) => clipboard(event, true),
    },
    handlePaste: (_view, event) => {
      boundary()
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
      const state = view.state.apply(transaction)
      view.updateState(state)
      if (transaction.docChanged && !composing) publish(transaction.getMeta('preparedResources'))
      else if (transaction.selectionSet && !transaction.docChanged) boundary()
      const anchor = editorPositionToPoint(state.doc, state.selection.anchor)
      const head = editorPositionToPoint(state.doc, state.selection.head)
      if (state.selection instanceof CellSelection) {
        const a = state.selection.$anchorCell.nodeAfter?.firstChild?.attrs.key as string | undefined
        const h = state.selection.$headCell.nodeAfter?.firstChild?.attrs.key as string | undefined
        if (a?.startsWith('cell:') && h?.startsWith('cell:')) {
          const [rowId, columnId] = JSON.parse(a.slice(5)); const [headRow, headColumn] = JSON.parse(h.slice(5))
          let depth = state.selection.$anchorCell.depth
          while (depth > 0 && !state.selection.$anchorCell.node(depth).attrs.id) depth--
          options.selection?.({ revision: options.revision, kind: 'cells', tableId: state.selection.$anchorCell.node(depth).attrs.id, anchor: { rowId, columnId }, head: { rowId: headRow, columnId: headColumn } })
        }
      } else if (!transaction.docChanged) {
        if (state.selection instanceof NodeSelection && state.selection.node.attrs.id) options.selection?.({ revision: options.revision, kind: 'object', blockId: state.selection.node.attrs.id })
        else options.selection?.(anchor && head ? { revision: options.revision, kind: 'text', anchor, head } : null)
      }
    },
  })
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
  function objectView(node: import('prosemirror-model').Node, editableSlots: boolean) {
    const block = { ...node.attrs.data, id: node.attrs.id } as DocumentBlock
    const flow = options.presentation === 'flow'
    const tag = block.type === 'list' ? block.ordered ? 'ol' : 'ul' : block.type === 'quote' ? 'blockquote' : flow && block.type === 'callout' ? 'aside' : flow && ['media', 'chart', 'component'].includes(block.type) ? 'figure' : 'section'
    const dom = flow ? flowBlockElement(node, tag) : document.createElement(tag)
    if (!flow) dom.className = `document-object document-${node.attrs.data.type}`
    dom.dataset.documentId = node.attrs.id
    let destroy: (() => void) | void
    if (options.renderObject && ['media', 'chart', 'component'].includes(block.type)) {
      const object = document.createElement('div'); object.contentEditable = 'false'; dom.append(object)
      destroy = options.renderObject(block, object)
    } else if (!editableSlots) dom.textContent = `${block.type} 对象`
    // ProseMirror owns every child of contentDOM. Keep editable captions separate
    // from the React media host so mounting the caption cannot remove the media.
    const ownsRenderedObject = Boolean(options.renderObject && ['media', 'chart', 'component'].includes(block.type))
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
  function richTextHost() { const dom = document.createElement('span'); dom.dataset.flowIdleRichText = 'true'; return dom }
  function textView(node: import('prosemirror-model').Node, tag: string) {
    const dom = flowBlockElement(node, tag), contentDOM = richTextHost(); dom.append(contentDOM); return { dom, contentDOM }
  }
  function clipboard(event: ClipboardEvent, cut: boolean): boolean {
    if (!event.clipboardData || view.state.selection.empty) return false
    const slice = view.state.selection.content()
    const cutToken = cut ? crypto.randomUUID() : null
    pendingCut = cutToken
    const assets = new Set<string>(); const components = new Set<string>()
    slice.content.descendants(node => {
      const data = node.attrs.data
      if (data?.type === 'media') assets.add(data.assetId)
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
    if (composing || options.readOnly || view.isDestroyed || !view.hasFocus() || view.state.selection instanceof CellSelection) return
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
  function update(next: LayoutEditorOptions) {
    if (composing) { deferred = next; return }
    const changed = JSON.stringify(next.document.content) !== JSON.stringify(options.document.content)
    const refreshObjects = next.objectRevision !== options.objectRevision
    options = next
    if (changed) { boundary(); view.updateState(EditorState.create({ doc: toEditorDocument(next.document.content), plugins: view.state.plugins })) }
    if (refreshObjects) view.setProps({ nodeViews: { ...view.props.nodeViews, object: node => objectView(node, false), compound: node => objectView(node, true) } })
  }
  return { view, update, boundary, syncDomTextSelection, flush: () => { if (composing) return false; publish(); boundary(); return true }, destroy: () => view.destroy() }
}
