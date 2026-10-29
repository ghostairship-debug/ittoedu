import {flowObjectDropPreviewPlugin,showFlowObjectDropPreview,type FlowObjectDropPreview} from './documentFlowObjectPreview'
import type {FlowObjectDrop} from '../../core/course/courseFlowObjectDrop'
import { bindMarkdownIdentities, type MarkdownProjection } from '../../shared/document/markdownIdentity'
import { editMarkdownSource, sameMarkdownContent } from '../../shared/document/markdownSourceEdit'
import { editorPositionToPoint } from './documentAdapter'
import { availableDocumentSourceMap, deferDocumentSource } from './deferredDocumentSource'
import type { ExecutionSelectionTarget } from '../../shared/workbench/executionDesktop'
import { workbenchSelection } from '../workbench/SelectionContextController'
import { cancelEditPreview, useEditPreviews } from '../workbench/EditPreviewProjection'
import { projectDocumentRanges } from '../../shared/document/textInteraction'
import { pinnedSelectionKey, pinnedSelectionPlugin, sourcePinnedSelectionEffect, sourcePinnedSelectionField } from './selectionDecorations'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useMemo, type ReactNode } from 'react'
import { Baseline, Bold, Highlighter, Italic, Underline, Link2, MoreHorizontal, Sigma, SlidersHorizontal, Table2, Superscript, Subscript, Code, Eraser } from 'lucide-react'
import { stepFontSize } from '../../shared/fontSizeStep'
import { LatexFormulaAuthoringEditor } from '../ui/LatexFormulaAuthoringEditor'
import { TextFormatControls } from '../editing/quickbar/TextFormatControls'
import { PaletteButton } from '../editing/color/PaletteButton'
import { FONT_FAMILY_OPTIONS } from '../../shared/fonts/fontFamilyCatalog'
import type { QuickBarBounds, QuickBarRect } from '../editing/quickbar/placeQuickBar'
import { QuickBarAiButton, QuickBarButton, QuickBarColorButton, QuickBarPopoverButton, QuickBarSeparator, SelectionQuickBar } from '../editing/quickbar/SelectionQuickBar'
import { usePointerGesture } from '../editing/quickbar/usePointerGesture'
import { CommandMenuItems, useContextMenu, type MenuCommand } from '../editing/commands/CommandMenu'
import { createPortal } from 'react-dom'
import { EditorState as SourceState, EditorSelection as SourceSelection, type Text as SourceText } from '@codemirror/state'
import { EditorView as SourceView, keymap as sourceKeymap, lineNumbers } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { foldGutter, foldEffect } from '@codemirror/language'
import { parseDocumentMarkdown, serializeDocumentMarkdown, type MarkdownDocument, type MarkdownOptions } from '../../shared/document/markdown'
import type { DocumentDiagnostic, DocumentSelection, DocumentContextSelection, DocumentPoint } from '../../shared/document/ports'
import { mapDocumentSelectionToSource, type MarkdownSourceMap } from '../../shared/document/markdownSourceMap'
import type { TextRunStyle } from '../../shared/contracts/native-v1/types'
import { buildFlowTextStyleCss } from '../../shared/flowRichText'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { createLayoutEditor, createDocumentDraftSession, DOCUMENT_OBJECT_CONTEXT_MENU_EVENT, type DocumentObjectContextMenuDetail, type DocumentOperation, type DocumentContentScope, type DocumentCommitResult, type DocumentInsertionSelection } from './editorSession'
import { documentBlockMenu, applyDocumentBlockCommand, createDocumentBlock, documentColumnSelection, DOCUMENT_BLOCK_KINDS, type DocumentBlockKind, type DocumentBlockCommand } from './documentBlockCommands'
import { DocumentBlockHandle, documentBlockDragId, DOCUMENT_BLOCK_DRAG_MIME } from './DocumentBlockHandle'
import { documentBlockDropTarget, type DocumentBlockDropTarget } from './documentBlockDrop'
import { documentFlowEditingPlugin } from './documentFlowEditing'
import { documentTableCommandLabels, type DocumentTableCommand } from './documentTableCommands'
import { changeDocumentTableFromEditorState, resolveDocumentTableEditorTarget } from './documentTableEditorPort'
import { restoreDocumentTableSelection, type PreviousDocumentTableSelection } from './documentTableSelectionRestore'
import { fromEditorBlock, fromEditorDocument, toEditorDocument,readEditorMath } from './documentAdapter'
import { documentEditorSchema } from './editorSchema'
import { NodeSelection, Selection, TextSelection, type EditorState } from 'prosemirror-state'
import { CellSelection } from 'prosemirror-tables'
import { toggleMark } from 'prosemirror-commands'
import { describeDocumentMath, parseDocumentMath } from '../../shared/document/math'
import { documentBlockChildren, type DocumentBlock } from '../../shared/document/content'
import { insertDocumentBlocks, documentInsertionBlockId, DocumentInsertionTargetError } from '../../shared/document/blockInsertion'
import { prepareProfessionalElement } from '../../core/course/professionalElementDefaults'
import { chartDataSchema } from '../../components/chart'
import type { DocumentClipboardResourcePort } from './documentClipboard'
import './sharedDocumentEditor.css'
import 'katex/dist/katex.min.css'
import { documentPreviewTarget, layoutPreviewClipboard, layoutPreviewKey, layoutPreviewPlugin, layoutPreviewRange, layoutPreviewRanges, sourcePreviewRanges, sourcePreviewEffect, sourcePreviewExtensions, sourcePreviewField, type DocumentEditPreview } from './editPreviewWidgets'

const FORMAT_FLAGS = ['bold', 'italic', 'underline', 'strike', 'emphasis'] as const

function findDocumentBlock(blocks: readonly DocumentBlock[], id: string): DocumentBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const children = documentBlockChildren(block)
    if (children) { const nested = findDocumentBlock(children, id); if (nested) return nested }
  }
  return null
}

function visibleEditorBounds(editor: HTMLElement): { left: number; right: number; top: number; bottom: number } {
  // The portal uses the visible viewport; short document content does not clip its toolbar.
  let left = 8, right = window.innerWidth - 8
  let top = 8, bottom = window.innerHeight - 8
  for (let parent = editor.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const style = getComputedStyle(parent)
    const rect = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, rect.left); right = Math.min(right, rect.right) }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, rect.top); bottom = Math.min(bottom, rect.bottom) }
  }
  return { left, right, top, bottom }
}

export type DocumentInlineStyleDefaults = (blockId: string, point?:DocumentPoint|null) => TextRunStyle | undefined
function inlineBlockId(state: EditorState, position: number): string {
  const point = state.doc.resolve(position)
  for (let depth = point.depth; depth > 0; depth--) {
    const id = point.node(depth).attrs.id
    if (typeof id === 'string') return id
  }
  return ''
}
/** Presentation only: defaults never become document marks, inlines or history. */
export function documentInlineDefaultDecorations(state: EditorState, defaults?: DocumentInlineStyleDefaults, ranges?: readonly { from: number; to: number }[]): DecorationSet {
  if (!defaults) return DecorationSet.empty
  const decorations: Decoration[] = []
  const visit = (node: import('prosemirror-model').Node, position: number) => {
    if (!node.isInline || node.type === documentEditorSchema.nodes.hard_break) return
    const base = defaults(inlineBlockId(state, position),editorPositionToPoint(state.doc,position))
    if (!base) return
    const own = node.marks.find(mark => mark.type === documentEditorSchema.marks.style)?.attrs.value ?? {}
    const style = node.type === documentEditorSchema.nodes.math
      ? { ...(base.fontSize === undefined ? {} : { fontSize: base.fontSize }), ...(base.color === undefined ? {} : { color: base.color }), ...own }
      : { ...base, ...own }
    const css = buildFlowTextStyleCss(style)
    if (css) decorations.push(Decoration.inline(position, position + node.nodeSize, { style: css, 'data-document-inline-defaults': 'true' }))
  }
  if (ranges) for (const range of ranges) state.doc.nodesBetween(range.from, range.to, visit)
  else state.doc.descendants(visit)
  return DecorationSet.create(state.doc, decorations)
}

const inlineDefaultsKey = new PluginKey<{ defaults?: DocumentInlineStyleDefaults; decorations: DecorationSet }>('document-inline-defaults')

/** Decorations follow PM's immutable document/mapping instead of being rebuilt for every caret. */
export function documentInlineDefaultsPlugin(readDefaults: () => DocumentInlineStyleDefaults | undefined): Plugin {
  return new Plugin({
    key: inlineDefaultsKey,
    state: {
      init: (_config, state) => ({ defaults: readDefaults(), decorations: documentInlineDefaultDecorations(state, readDefaults()) }),
      apply(transaction, previous, oldState, state) {
        const defaults = readDefaults()
        if (defaults !== previous.defaults || transaction.getMeta(inlineDefaultsKey)) {
          return { defaults, decorations: documentInlineDefaultDecorations(state, defaults) }
        }
        if (!transaction.docChanged) return previous
        const mapped = previous.decorations.map(transaction.mapping, state.doc)
        const start = oldState.doc.content.findDiffStart(state.doc.content)
        const end = oldState.doc.content.findDiffEnd(state.doc.content)
        if (start === null || !end || !defaults || !state.doc.content.size) return { defaults, decorations: mapped }
        const ranges: { from: number; to: number }[] = []
        const from = Math.min(start, state.doc.content.size)
        const to = Math.min(state.doc.content.size, Math.max(from + 1, end.b))
        state.doc.nodesBetween(from, to, (node, position) => {
          if (!node.isTextblock) return
          ranges.push({ from: position, to: position + node.nodeSize })
          return false
        })
        const removed = ranges.flatMap(range => mapped.find(range.from, range.to)
          .filter(decoration => decoration.from < range.to && decoration.to > range.from))
        const fresh = documentInlineDefaultDecorations(state, defaults, ranges)
        return { defaults, decorations: mapped.remove(removed).add(state.doc, fresh.find()) }
      },
    },
    props: { decorations: state => inlineDefaultsKey.getState(state)?.decorations ?? DecorationSet.empty },
  })
}
export function readDocumentFormatting(state: EditorState, defaults?: DocumentInlineStyleDefaults) {
  const samples: TextRunStyle[] = []
  const paragraphTypes = new Set<string>()
  for (const range of state.selection.ranges) state.doc.nodesBetween(range.$from.pos, range.$to.pos, node => {
    if (node.isTextblock) paragraphTypes.add(node.type === documentEditorSchema.nodes.heading ? String(node.attrs.data.level ?? 2)
      : node.type === documentEditorSchema.nodes.paragraph ? 'paragraph' : '')
  })
  const sample = (marks: typeof state.selection.$from.parent.marks, position: number) => samples.push({ ...defaults?.(inlineBlockId(state, position),editorPositionToPoint(state.doc,position)), ...marks.find(mark => mark.type === documentEditorSchema.marks.style)?.attrs.value })
  if (state.selection.empty) sample(state.storedMarks ?? state.selection.$from.marks(), state.selection.from)
  else for (const range of state.selection.ranges) state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, position) => { if (node.isInline && !node.isTextblock) sample(node.marks, position) })
  const values = <T,>(get: (style: TextRunStyle) => T): T | 'mixed' => {
    const first = get(samples[0] ?? {})
    return samples.some(style => get(style) !== first) ? 'mixed' : first
  }
  return { color: values(style => style.color), highlightColor: values(style => style.highlightColor), paragraphType: paragraphTypes.size === 1 ? [...paragraphTypes][0] : '', fontFamily: values(style => style.fontFamily), fontSize: values(style => style.fontSize),
    flags: Object.fromEntries(FORMAT_FLAGS.map(key => [key, values(style => Boolean(style[key]))])) as Record<typeof FORMAT_FLAGS[number], boolean | 'mixed'> }
}

export interface SharedDocumentEditorProps {
  active?: boolean
  toolbarHost?: HTMLElement | null
  toolbarScope?: string
  onCompleteEditing?(): void
  /** The caller's saved field shape; the full document editor remains the default. */
  contentScope?: DocumentContentScope
  hiddenBlockIds?:readonly string[]
  /** Host-owned whole-text defaults, resolved per formal block; explicit run false/null wins. */
  inlineStyleDefaults?: DocumentInlineStyleDefaults
  document: MarkdownDocument
  revision: string
  sourceDraft?: string
  /** Diagnostics retained with a rejected local draft when its workspace is restored. */
  sourceDiagnostics?: readonly DocumentDiagnostic[]
  /** Recoverable rendering issues do not prevent file editing, history or save. */
  projectionDiagnostics?: readonly DocumentDiagnostic[]
  sourceMap?: MarkdownSourceMap
  initialMode?: 'layout' | 'source'
  /** Main Flow owns semantic drafts; materialize source only at an actual source boundary. */
  deferLayoutSource?: boolean
  readOnly?: boolean
  blockMoveDisabledReason?(blockId: string): string | null
  objectLayout?: {
    read(id:string):{wrap:'none'|'left'|'right';widthPercent?:number}|null
    begin(id:string):Promise<(drop:FlowObjectDrop)=>Promise<void>>
  }
  renderTextActions?(selection: DocumentSelection | null): ReactNode
  renderInline?(instanceId: string, container: HTMLElement): (() => void) | void
  renderObject?(block: DocumentBlock, container: HTMLElement): (() => void) | void
  /** The callback may style the outer/children holders, never mount or replace their children. */
  renderGroup?(instanceId: string, wrapper: HTMLElement, contentDOM: HTMLElement): void
  /** The course owner creates ordinary columns in one canonical transaction. */
  onColumns?(instanceIds: readonly string[]): void | Promise<void>
  /** Current rendered grid/row layout, used only for collapsed boundary keys. */
  isMultiColumnLayout?(instanceId: string): boolean
  runtimeSpacers?: readonly { readonly blockId: string; readonly height: number }[]
  objectRevision?: unknown
  objectRevisionFor?(block:DocumentBlock):unknown
  objectChangedIds?(previousRevision: unknown): ReadonlySet<string>
  beforeProjectionMutation?():void
  afterProjectionMutation?():void
  /** Actual layout DOM lifetime; source/layout switches replace this root. */
  onLayoutMount?(element: HTMLElement | null): void
  clipboardContext?: unknown
  clipboardResourcePort?(context: unknown): DocumentClipboardResourcePort<unknown>
  target?: 'flow' | 'file'
  resolveImage?: MarkdownOptions['resolveImage']
  onChange(document: MarkdownDocument, operation: DocumentOperation): DocumentCommitResult
  /** Local editable content, before the caller's formal commit ACK. */
  onDocumentDraft?(document: MarkdownDocument, operation: DocumentOperation): void
  /** The input owner resolves any formal proposal before releasing its local raw input. */
  onDiscardDraft?(): boolean | void | Promise<boolean | void>
  /** Durably retain unapplied raw source, then return to the current formal document. */
  onPreserveDraft?(): Promise<boolean>
  onDraft(source: string, diagnostics: DocumentDiagnostic[]): void
  onCompositionChange?(composing: boolean, source: string): void
  onSelection?(selection: DocumentSelection | null): void
  onContextualTargetChange?(target: DocumentContextSelection | null): void
  onContextualCommand?(instruction: string, target: DocumentContextSelection): void | Promise<void>
  /** Owner actions on the selection quick bar, such as replacing or moving a Flow image. */
  renderQuickBarActions?(target: DocumentContextSelection): ReactNode
  /** The bar's "⋯" for the selection, after the AI entry. */
  renderQuickBarMenu?(target: DocumentContextSelection): ReactNode
  /**
   * The bar's AI entry for the selection when the host has its own (an element or text AI card, M15); undefined
   * keeps the default. `issue` is why the editor would refuse a request now (for example source errors).
   */
  renderAiButton?(target: DocumentContextSelection, issue: string | null): ReactNode | undefined
  /** The right-click menu of a document object (picture, chart, component), asked after the object is selected. */
  objectMenu?(blockId: string): readonly MenuCommand[]
  pinnedTargets?: readonly ExecutionSelectionTarget[]
  /** The host document identity for floating result cards; not an author field. */
  cardDocumentId?: string
  contextualCommandIssue?(target: DocumentContextSelection): string | null
  contextualCardSuppressed?: boolean
  editPreviews?: readonly DocumentEditPreview[]
  editPreview?: DocumentEditPreview
  onContextualDismiss?(target: DocumentContextSelection | null): void
  onUndo(): void
  onRedo(): void
}

function editorMarkdownOptions(owner: Pick<SharedDocumentEditorProps, 'target' | 'resolveImage'>): MarkdownOptions {
  return { createId: () => crypto.randomUUID(), target: owner.target, resolveImage: owner.resolveImage, recoverUnsupportedBlocks: owner.target === 'file' }
}
export interface DocumentObjectPointer { blockId: string; phase: 'start' | 'update' | 'end' | 'cancel'; pointerId: number; point: { x: number; y: number }; button?: number; modifiers?: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } }

export interface SharedDocumentEditorHandle {
  /** A managed component realm delegates its whole-block gesture to this same reading owner. */
  objectPointer(input: DocumentObjectPointer): void
  captureInsertionSelection(): DocumentInsertionSelection
  clearSelection(targets?: readonly ExecutionSelectionTarget[]): void
  focusAtClientPoint(point: { x: number; y: number }): boolean
  selectAtClientPoints(anchor: { x: number; y: number }, head: { x: number; y: number }): boolean
  /** Apply synchronous layout projection without treating its wrapper styles as author input. */
  paintProjection(paint: () => void): void
  /** Applies a future typing style at the actual PM caret; it creates no document transaction. */
  applyInlineStyle(style: TextRunStyle): boolean
  flush(): { ready: boolean; source: string; diagnostics: DocumentDiagnostic[] }
  /** Flush local input and wait for its actual commit ACK before save/history/navigation. */
  drain(): Promise<{ ready: boolean; source: string; diagnostics: DocumentDiagnostic[] }>
  /** After drain, the owner may retain this exact local draft and resume formal content. */
  canPreserveDraft(): boolean
  /** Prepare raw file source for its owner's formal ACK; layout diagnostics do not reject source repair. */
  drainSource(): Promise<{ ready: boolean; source: string; diagnostics: DocumentDiagnostic[] }>
  /** Uses the same explicit discard as the draft UI, including the caller's cleanup. */
  discardDraft(): Promise<void>
  /** Focus an existing last paragraph, or create one on an explicit end-of-document click. */
  focusEndParagraph(): boolean
  getContextualEditTarget(): DocumentContextSelection | null
  /** Focus a committed editable paragraph without authoring a transaction. */
  focusBlock(blockId: string): boolean
  /** Focus a named editable slot of a compound document object. */
  focusSlot(blockId: string, slotKey: string): boolean
  /** Select a document object (picture, table, component) as the user would by clicking it; no transaction. */
  selectBlock(blockId: string): boolean
}

/** The caller owns persistence and undo; neither editor installs a history extension. */
export const SharedDocumentEditor = forwardRef<SharedDocumentEditorHandle, SharedDocumentEditorProps>(function SharedDocumentEditor(props, ref) {
  const latest = useRef(props); latest.current = props
  const [inputActive, setInputActive] = useState(props.target !== 'flow' || Boolean(props.contentScope && props.contentScope !== 'document'))
  const flowObjectSelection = props.target === 'flow' && (!props.contentScope || props.contentScope === 'document')
  const inputGeneration = useRef(0)
  const bodyDrag = useRef<{ pointerId: number; blockId: string; start: { x: number; y: number }; moved: boolean; capture: HTMLElement | null; ready: boolean; latest: { x: number; y: number }; ended: boolean; canceled: boolean } | null>(null)
  const flowDrag=useRef<{sourceId:string;rects:Map<string,DOMRect>;widthPercent?:number;height:number;commit:Promise<((drop:FlowObjectDrop)=>Promise<void>)|null>;preview:FlowObjectDropPreview|null}|null>(null)
  const objectPreviewPlugin=useMemo(()=>flowObjectDropPreviewPlugin(),[])
  const documentScope = (props.contentScope ?? 'document') === 'document'
  const [format, setFormat] = useState<ReturnType<typeof readDocumentFormatting>>({ color: undefined, highlightColor: undefined, paragraphType: '', fontFamily: undefined, fontSize: undefined, flags: { bold: false, italic: false, underline: false, strike: false, emphasis: false } })
  const [mode, setMode] = useState<'layout' | 'source'>(documentScope ? props.initialMode ?? (props.sourceDraft === undefined ? 'layout' : 'source') : 'layout')
  const [diagnostics, setDiagnostics] = useState<DocumentDiagnostic[]>(() => [...(props.sourceDiagnostics ?? props.projectionDiagnostics ?? [])])
  const diagnosticsRef = useRef<DocumentDiagnostic[]>([...(props.sourceDiagnostics ?? props.projectionDiagnostics ?? [])])
  const restoredDiagnostics = useRef(Boolean(props.sourceDiagnostics?.length))
  function reportDiagnostics(issues: DocumentDiagnostic[]) { diagnosticsRef.current = issues; setDiagnostics(issues) }
  const [mathDraft, setMathDraft] = useState<{ latex: string; accessibleText: string; display: boolean; formulaId: string; from: number; to: number; existing?: boolean } | null>(null)
  const mathTarget=useRef<ReturnType<ReturnType<typeof createLayoutEditor>['trackSelection']>|null>(null)
  const linkTarget=useRef<ReturnType<ReturnType<typeof createLayoutEditor>['trackSelection']>|null>(null)
  const [semanticSelection, setSemanticSelection] = useState<DocumentSelection | null>(null)
  const [activeBlock, setActiveBlock] = useState<{ id: string; rect: { left: number; top: number; height: number } } | null>(null)
  const interactionFocused = useRef(false), draggingBlock = useRef(false)
  const focusGeneration = useRef(0)
  const outsidePointerFrame = useRef<number | null>(null)
  const draggedBlockId = useRef<string | null>(null)
  const draggedBlockContent = useRef<ReturnType<typeof fromEditorDocument> | null>(null)
  const blockDragHandlers = useRef<{ over(event: DragEvent): void; drop(event: DragEvent): void } | null>(null)
  const [blockDrop, setBlockDrop] = useState<DocumentBlockDropTarget | null>(null)
  const formattingMenu = useContextMenu()
  const [linkDraft, setLinkDraft] = useState<string | null>(null)
  const [contextualTarget, setContextualTarget] = useState<DocumentContextSelection | null>(null)
  /** Each newly published target; the quick bar closes its popovers when it changes. */
  const [targetGeneration, setTargetGeneration] = useState(0)
  const [dismissedGeneration, setDismissedGeneration] = useState(-1)
  const [quickBarPlace, setQuickBarPlace] = useState<{ anchor: QuickBarRect; bounds: QuickBarBounds } | null>(null)
  const [contextualInstruction, setContextualInstruction] = useState('')
  const instructionRef = useRef(''); instructionRef.current = contextualInstruction
  const manualTarget = useRef<DocumentContextSelection | null>(null)
  const [localPin, setLocalPin] = useState<{mode: 'layout' | 'source'; from: number; to: number; revision: string} | null>(null)
  const [commandError, setCommandError] = useState('')
  const [insertionFallback, setInsertionFallback] = useState<{ blockId: string; kind: DocumentBlockKind | 'chart'; message: string } | null>(null)
  const editorRoot = useRef<HTMLDivElement | null>(null)
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null)
  const attachRoot = useCallback((element: HTMLDivElement | null) => { editorRoot.current = element; setRootElement(element) }, [])
  // A right-clicked object is selected first; its owner builds the menu for the new selection on the next turn.
  const objectMenu = useContextMenu()
  const slashReturn=useRef<ReturnType<ReturnType<typeof createLayoutEditor>['trackSelection']>|null>(null)
  useEffect(()=>{if(!objectMenu.isOpen){slashReturn.current?.release();slashReturn.current=null}},[objectMenu.isOpen])
  useEffect(()=>{
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape' || !slashReturn.current)return
      const kept=slashReturn.current;slashReturn.current=null
      queueMicrotask(()=>{const editor=layout.current;if(editor && !editor.view.isDestroyed){const selected=kept.resolve();if(selected)editor.view.dispatch(editor.view.state.tr.setSelection(selected));editor.view.focus()};kept.release()})
    }
    window.addEventListener('keydown',escape,true);return()=>{window.removeEventListener('keydown',escape,true);slashReturn.current?.release()}
  },[])
  const openObjectMenu = objectMenu.open
  useEffect(() => {
    if (!rootElement) return
    const request = (event: Event) => {
      const detail = (event as CustomEvent<DocumentObjectContextMenuDetail>).detail
      if (!detail || latest.current.active === false || latest.current.readOnly) return
      window.setTimeout(() => {
        if (latest.current.active === false) return
        const items = latest.current.objectMenu?.(detail.blockId) ?? []
        if (items.length) openObjectMenu({ x: detail.x, y: detail.y }, '对象操作', items)
      }, 0)
    }
    rootElement.addEventListener(DOCUMENT_OBJECT_CONTEXT_MENU_EVENT, request)
    return () => rootElement.removeEventListener(DOCUMENT_OBJECT_CONTEXT_MENU_EVENT, request)
  }, [rootElement, openObjectMenu])
  const pointerGesture = usePointerGesture(rootElement)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const deferredLayoutSource = Boolean(props.deferLayoutSource && documentScope && props.target === 'flow')
  const suppliedProjection = useMemo<MarkdownProjection>(() => {
    if (props.deferLayoutSource && documentScope && props.target === 'flow' && props.sourceDraft === undefined)
      return deferDocumentSource(props.document, { createId: () => crypto.randomUUID(), target: 'flow', resolveImage: props.resolveImage })
    const source = props.sourceDraft ?? serializeDocumentMarkdown(props.document, props.target)
    if (!documentScope) return { source, document: props.document, sourceMap: { blocks: [] } }
    if (props.sourceMap) return { source, document: props.document, sourceMap: props.sourceMap }
    const result = parseDocumentMarkdown(source, editorMarkdownOptions(props))
    if (result.status === 'valid') {
      if (sameMarkdownContent(result.document, props.document)) { bindMarkdownIdentities(result, props.document); return result }
      if (props.target === 'file') return result
    }
    return { source, document: props.document, sourceMap: { blocks: [] } }
  }, [props.sourceMap, props.sourceDraft, props.document, props.target, props.revision, props.deferLayoutSource, documentScope])
  const draft = useRef(deferredLayoutSource && props.sourceDraft === undefined ? '' : suppliedProjection.source)
  const draftSession = useRef(createDocumentDraftSession(props.document)).current
  const draftOwner = useRef<SharedDocumentEditorProps | null>(null)
  const sourceInvalid = useRef(false)
  const latestOperation = useRef<string | null>(null)
  const layoutHost = useRef<HTMLDivElement>(null)
  const sourceHost = useRef<HTMLDivElement>(null)
  const layout = useRef<ReturnType<typeof createLayoutEditor> | null>(null)
  const source = useRef<SourceView | null>(null)
  const sourceText = useRef<{ document: SourceText; value: string } | null>(null)
  const acceptedSourceText = useRef<{ document: SourceText; valid: boolean } | null>(null)
  const sourceComposing = useRef(false)
  const syncingSource = useRef(false)
  const layoutSelection = useRef<ReturnType<Selection['toJSON']> | null>(null)
  const sourceSelection = useRef<{ anchor: number; head: number } | null>(null)
  const focusAfterSwitch = useRef(false)
  const sourceGroup = useRef({ id: crypto.randomUUID(), time: 0 })
  const contextualTargetRef = useRef<DocumentContextSelection | null>(null)
  const projection = useRef(suppliedProjection), receivedProjection = useRef(suppliedProjection)
  if (receivedProjection.current !== suppliedProjection) {
    if (!draftSession.retained && !sourceInvalid.current && !restoredDiagnostics.current) { projection.current = suppliedProjection; draftSession.receive(suppliedProjection.document) }
    receivedProjection.current = suppliedProjection
  }
  const fallbackMap = availableDocumentSourceMap(projection.current)
  const mapRef = useRef(fallbackMap); mapRef.current = fallbackMap
  const restoreSourceSelection = useRef(false)
  function materializeSource(withMap = false): string {
    const text = projection.current.source
    draft.current = text
    if (withMap) mapRef.current = projection.current.sourceMap
    return text
  }
  function sourceMapForTargets(targets: readonly ExecutionSelectionTarget[]) {
    if (deferredLayoutSource && mode === 'layout' && targets.some(target => target.kind === 'markdown-range'
      || target.kind === 'text-selection' && target.fragments.some(fragment => fragment.target.kind === 'markdown-range'))) materializeSource(true)
    return mapRef.current
  }
  /** Screen box of the current target: its pinned range when a draft holds it, otherwise the live selection. */
  function targetRect(): QuickBarRect | null {
    const pin = localPin && localPin.mode === mode && localPin.revision === latest.current.revision ? localPin : null
    if (mode === 'layout' && layout.current) {
      const view = layout.current.view, selection = view.state.selection
      const from = pin?.from ?? selection.from, to = pin?.to ?? selection.to
      const node = contextualTargetRef.current?.selection?.kind === 'object' ? view.nodeDOM(from) : null
      if (node instanceof HTMLElement) { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
      const start = view.coordsAtPos(from), end = view.coordsAtPos(to)
      return { left: Math.min(start.left, end.left), top: start.top, width: Math.max(1, Math.abs(end.right - start.left)), height: Math.max(1, end.bottom - start.top) }
    }
    if (mode === 'source' && source.current) {
      const selection = source.current.state.selection.main
      const start = source.current.coordsAtPos(pin?.from ?? selection.from), end = source.current.coordsAtPos(pin?.to ?? selection.to)
      if (!start || !end) return null
      return { left: Math.min(start.left, end.left), top: start.top, width: Math.max(1, Math.abs(end.right - start.left)), height: Math.max(1, end.bottom - start.top) }
    }
    return null
  }
  useEffect(() => {
    if (!documentScope || !contextualTarget) { setQuickBarPlace(null); return }
    const position = () => {
      const editor = editorRoot.current
      if (!editor) return
      const bounds = visibleEditorBounds(editor)
      if (bounds.right - bounds.left < 1 || bounds.bottom - bounds.top < 1) { setQuickBarPlace(null); return }
      let anchor: QuickBarRect | null = null
      try { anchor = targetRect() } catch { /* Detached text during owner replacement has no screen position. */ }
      const next = { anchor: anchor ?? { left: bounds.left, top: bounds.top, width: 1, height: 1 }, bounds }
      setQuickBarPlace(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    position()
    window.addEventListener('scroll', position, true); window.addEventListener('resize', position)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(position)
    for (let parent: HTMLElement | null = editorRoot.current; parent && parent !== document.body; parent = parent.parentElement) {
      observer?.observe(parent)
      mutation?.observe(parent, { attributes: true, attributeFilter: ['style', 'class'] })
    }
    return () => { window.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); observer?.disconnect(); mutation?.disconnect() }
  }, [documentScope, contextualTarget, mode, localPin])
  const fail = (message: string) => reportDiagnostics([{ message, offset: 0, endOffset: 0, line: 1, column: 1 }])
  const previewBlocked = () => setCommandError('正在生成的范围暂时只读。请先停止生成，再编辑这一处。')
  const pinPlugin = useMemo(() => pinnedSelectionPlugin(), [])
  const flowEditingPlugin = useMemo(() => documentFlowEditingPlugin({ isMultiColumnLayout: id => latest.current.isMultiColumnLayout?.(id) ?? false }), [])
  const previewPlugin = useMemo(() => layoutPreviewPlugin(previewBlocked), [])
  const inlineDefaultsPlugin = useMemo(() => documentInlineDefaultsPlugin(() => latest.current.inlineStyleDefaults), [])
  function publishContextualTarget(target: DocumentContextSelection | null) {
    manualTarget.current = target
    latest.current.onContextualTargetChange?.(target)
    if (instructionRef.current.trim() && contextualTargetRef.current) return
    if (target) {
      const selected = mode === 'layout' ? layout.current?.view.state.selection : source.current?.state.selection.main
      const nextPin = selected && selected.from < selected.to ? { mode, from: selected.from, to: selected.to, revision: target.revision } : null
      setLocalPin(previous => JSON.stringify(previous) === JSON.stringify(nextPin) ? previous : nextPin)
    } else setLocalPin(null)
    contextualTargetRef.current = target
    setContextualTarget(target)
    setTargetGeneration(value => value + 1)
  }
  function publishLayoutSelection(selection: DocumentSelection | null, notifyOwner = true) {
    if (latest.current.active === false) return
    setSemanticSelection(previous => JSON.stringify(previous) === JSON.stringify(selection) ? previous : selection)
    if (notifyOwner) latest.current.onSelection?.(selection)
    if (!selection) { publishContextualTarget(null); return }
    if (selection.kind === 'text' && JSON.stringify(selection.anchor.slot) === JSON.stringify(selection.head.slot) && selection.anchor.blockId === selection.head.blockId && selection.anchor.offset === selection.head.offset) {
      const table = layout.current && resolveDocumentTableEditorTarget(layout.current.view.state)
      if (table) publishContextualTarget({ selection, ...(deferredLayoutSource ? {} : { ranges: null, source: draft.current }), revision: latest.current.revision, mode: 'layout',
        label: '表格', message: '请选择表格中的文字后再交给 AI 修改' })
      else if (latest.current.target === 'flow' && layout.current?.isInputActive()) publishContextualTarget({ selection, revision: latest.current.revision, mode: 'layout', label: '输入位置' })
      else publishContextualTarget(null)
      return
    }
    const mapped = deferredLayoutSource ? null : mapDocumentSelectionToSource(draft.current, mapRef.current, selection)
    const blockId = selection.kind === 'cells' ? selection.tableId : selection.kind === 'object' ? selection.blockId : selection.head.blockId
    const block = findDocumentBlock(latest.current.document.content.blocks, blockId)
    const labels: Record<string, string> = { paragraph: '段落', heading: '标题', quote: '引用', list: '列表项', table: '单元格', formula: '公式', media: '媒体', chart: '图表', component: '互动组件', 'course-instance': '组件', divider: '分隔线' }
    publishContextualTarget({ selection, ...(mapped ? { source: draft.current, ranges: mapped.status === 'mapped' ? mapped.ranges : null } : {}), revision: latest.current.revision, mode: 'layout',
      label: selection.kind === 'cells' ? '所选单元格' : selection.kind === 'text' && selection.anchor.blockId !== selection.head.blockId ? '所选内容' : labels[block?.type ?? ''] ?? '所选对象',
      ...(mapped?.status === 'unmapped' ? { message: mapped.message } : {}) })
  }
  function publishSourceSelection(view: SourceView) {
    if (sourceComposing.current) { publishContextualTarget(null); return }
    const ranges = view.state.selection.ranges.filter(range => !range.empty).map(range => ({ from: range.from, to: range.to, before: draft.current.slice(range.from, range.to) }))
    if (!ranges.length) { publishContextualTarget(null); return }
    publishContextualTarget({ selection: null, ranges, revision: latest.current.revision, mode: 'source', source: draft.current, label: '所选源文' })
  }
  function readSourceText(document: SourceText): string {
    if (sourceText.current?.document !== document) sourceText.current = { document, value: document.toString() }
    return sourceText.current.value
  }
  function acceptSourceDocument(document: SourceText) {
    if (acceptedSourceText.current?.document === document) return acceptedSourceText.current.valid
    const valid = acceptSource(readSourceText(document))
    acceptedSourceText.current = { document, valid }
    return valid
  }
  function acceptSource(text: string) {
    draft.current = text
    const current = draftSession.retained || sourceInvalid.current ? draftOwner.current ?? latest.current : latest.current
    draftOwner.current = current
    restoredDiagnostics.current = false
    const result = parseDocumentMarkdown(text, { ...editorMarkdownOptions(current), previous: projection.current })
    sourceInvalid.current = result.status !== 'valid'
    reportDiagnostics(result.diagnostics)
    current.onDraft(text, result.diagnostics)
    if (result.status === 'valid') {
      projection.current = result; mapRef.current = result.sourceMap
      if (Date.now() - sourceGroup.current.time > 800) sourceGroup.current.id = crypto.randomUUID()
      sourceGroup.current.time = Date.now()
      const operation: DocumentOperation = { operationId: crypto.randomUUID(), historyGroup: sourceGroup.current.id, source: 'source' }
      current.onDocumentDraft?.(result.document, operation)
      const accepted = draftSession.publish(result.document, operation, (document, operation) => commit(document, operation, current))
      if (accepted instanceof Promise) void accepted.catch(fail)
      if (accepted === false) return false
    }
    return result.status === 'valid'
  }
  function updateActiveBlock(state: EditorState) {
    if (latest.current.active === false || latest.current.contextualCardSuppressed || !interactionFocused.current || !documentScope || mode !== 'layout' || !(state.selection instanceof NodeSelection) && (!state.selection.empty || !(state.selection instanceof TextSelection))) { setActiveBlock(null); return }
    const point = editorPositionToPoint(state.doc, state.selection.head)
    const id = state.selection instanceof NodeSelection ? state.selection.node.attrs.id : point?.blockId
    let blockPosition: number | null = state.selection instanceof NodeSelection ? state.selection.from : null
    for (let depth = state.selection.$head.depth; depth > 0; depth--) {
      if (state.selection.$head.node(depth).attrs.id === id) { blockPosition = state.selection.$head.before(depth); break }
    }
    const node = blockPosition === null ? null : layout.current?.view.nodeDOM(blockPosition)
    const element = node instanceof HTMLElement ? node : null
    if (!id || !element) { setActiveBlock(null); return }
    const rect = element.getBoundingClientRect()
    const bounds = visibleEditorBounds(element)
    if (rect.width <= 0 || rect.height <= 0 || rect.top < bounds.top || rect.top >= bounds.bottom) { setActiveBlock(null); return }
    const next = { id, rect: { left: rect.left, top: rect.top, height: rect.height } }
    setActiveBlock(previous => previous && previous.id === next.id && previous.rect.left === next.rect.left && previous.rect.top === next.rect.top && previous.rect.height === next.rect.height ? previous : next)
  }
  useEffect(() => {
    const reposition = () => { const state = layout.current?.view.state; if (state) updateActiveBlock(state) }
    const blur = () => { interactionFocused.current = false; setActiveBlock(null); setBlockDrop(null) }
    const focus = () => { interactionFocused.current = Boolean(layout.current?.view.hasFocus()); reposition() }
    window.addEventListener('scroll', reposition, true); window.addEventListener('resize', reposition)
    window.addEventListener('blur', blur); window.addEventListener('focus', focus)
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus) }
  }, [mode])
  useEffect(() => {
    const outsidePointer = () => {
      if (outsidePointerFrame.current !== null) cancelAnimationFrame(outsidePointerFrame.current)
      if (!interactionFocused.current) return
      outsidePointerFrame.current = requestAnimationFrame(() => {
        outsidePointerFrame.current = null
        if (!draggingBlock.current) {
          interactionFocused.current = false; setActiveBlock(null)
          const editor = layout.current, generation = inputGeneration.current
          if (latest.current.target === 'flow' && editor?.isInputActive()) void editor.drain().then(ready => {
            if (ready && layout.current === editor && generation === inputGeneration.current) editor.setInputActive(false)
          })
        }
      })
    }
    // A focused menu can be removed by an outside press without firing blur.
    // The React capture handler below cancels this for the editor and all its portals.
    window.document.addEventListener('pointerdown', outsidePointer, true)
    return () => {
      window.document.removeEventListener('pointerdown', outsidePointer, true)
      if (outsidePointerFrame.current !== null) cancelAnimationFrame(outsidePointerFrame.current)
    }
  }, [])
  useEffect(() => {
    if (props.active === false) { setActiveBlock(null); objectMenu.close(); return }
    if (layout.current) updateActiveBlock(layout.current.view.state)
  }, [props.active, props.contextualCardSuppressed])
  function applyDocumentContent(content: ReturnType<typeof fromEditorDocument>, tableSelection?: PreviousDocumentTableSelection) {
    const editor = layout.current
    if (!editor || latest.current.readOnly) return
    const view = editor.view
    try {
      const replacement = toEditorDocument(content)
      if (view.state.doc.eq(replacement)) return
      const previousIds=new Set<string>();view.state.doc.descendants(node=>{if(node.attrs.id)previousIds.add(node.attrs.id)})
      let inserted:string|undefined
      replacement.descendants(node=>{if(!inserted && node.attrs.id && !previousIds.has(node.attrs.id) && node.type.name!=='section')inserted=node.attrs.id})
      const selected = inserted ?? (view.state.selection instanceof NodeSelection ? view.state.selection.node.attrs.id : activeBlock?.id)
      if (inserted) editor.setInputActive(true)
      editor.boundary()
      const transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, replacement.content)
      if (tableSelection) restoreDocumentTableSelection(transaction, tableSelection, content)
      else if (selected) {
        let at = -1
        transaction.doc.descendants((node, position) => { if (at < 0 && node.attrs.id === selected) at = position; return at < 0 })
        if (at >= 0) transaction.setSelection(view.state.selection instanceof NodeSelection && NodeSelection.isSelectable(transaction.doc.nodeAt(at)!) ? NodeSelection.create(transaction.doc, at) : Selection.near(transaction.doc.resolve(Math.min(at + 1, transaction.doc.content.size))))
      }
      view.dispatch(transaction.scrollIntoView())
      view.focus()
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  function activeBlockMenu(blockId: string) {
    const editor = layout.current
    if (!editor || latest.current.readOnly) return []
    return documentBlockMenu({ content: fromEditorDocument(editor.view.state.doc),
      readContent: () => fromEditorDocument(editor.view.state.doc), blockId, apply: applyDocumentContent, onError: fail,
      duplicate: latest.current.clipboardResourcePort ? id => { void editor.duplicateBlock(id) } : undefined,
      columns: latest.current.onColumns ? createColumns : undefined,
      ai: latest.current.onContextualCommand ? id => {
        let at = -1
        editor.view.state.doc.descendants((node, position) => { if (at < 0 && node.attrs.id === id) at = position; return at < 0 })
        if (at < 0 || !NodeSelection.isSelectable(editor.view.state.doc.nodeAt(at)!)) { fail('段落已变化，请重新选择'); return }
        editor.view.dispatch(editor.view.state.tr.setSelection(NodeSelection.create(editor.view.state.doc, at)).scrollIntoView())
        editor.view.focus()
      } : undefined,
      disabledReason: previewSelection() ? '正在生成的范围暂时只读' : latest.current.blockMoveDisabledReason?.(blockId) ?? null })
  }
  function createColumns(instanceIds: readonly string[]) {
    try { void Promise.resolve(latest.current.onColumns?.(instanceIds)).catch(fail) }
    catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  function clipboardMenu(): MenuCommand[] {
    const editor = layout.current
    if (!editor || latest.current.readOnly) return []
    const hasSelection = !editor.view.state.selection.empty
    const bridge = window.desktopAPI?.editorClipboard
    const run = async (command: 'copy' | 'cut' | 'paste' | 'paste-plain') => {
      const current = layout.current
      if (!current || !bridge) { fail('当前环境无法使用系统剪贴板'); return }
      current.syncDomTextSelection()
      if (command !== 'copy') current.boundary()
      current.view.focus()
      const cancelPlain = command === 'paste-plain' ? current.requestPlainPaste() : null
      try { await bridge(command) }
      catch (error) { cancelPlain?.(); fail(error instanceof Error ? error.message : String(error)) }
    }
    const unavailable = bridge ? undefined : '当前环境无法使用系统剪贴板'
    return ([['cut', '剪切'], ['copy', '复制'], ['paste', '粘贴'], ['paste-plain', '粘贴为纯文本']] as const).map(([id, label]) => ({
      id: `clipboard-${id}`, label, group: '剪贴板',
      disabledReason: id !== 'copy' && previewSelection() ? '正在生成的范围暂时只读' : unavailable ??
        ((id === 'cut' || id === 'copy') && !hasSelection ? '请先选择文字或对象' : undefined),
      run: () => { void run(id) },
    }))
  }
  function activeTableMenu(): MenuCommand[] {
    const editor = layout.current
    if (!editor || latest.current.readOnly) return []
    const state = editor.view.state, target = resolveDocumentTableEditorTarget(state)
    if (!target) return []
    const content = fromEditorDocument(state.doc)
    const table = findDocumentBlock(content.blocks, target.tableId)
    if (table?.type !== 'table') return []
    const row = target.anchor?.kind === 'cell' ? target.anchor.cell.rowId : null
    const column = target.anchor?.kind === 'cell' ? target.anchor.cell.columnId : target.anchor?.kind === 'header' ? target.anchor.columnId : null
    const run = (command: DocumentTableCommand | 'toggle-header' | 'delete-table') => {
      const current = layout.current
      if (!current) return
      try {
        if (command === 'delete-table') {
          const content = fromEditorDocument(current.view.state.doc)
          applyDocumentContent(applyDocumentBlockCommand(content, { action: 'delete', blockId: target.tableId }))
        } else {
          const state = current.view.state
          const selected = resolveDocumentTableEditorTarget(state)
          if (!selected || selected.tableId !== target.tableId) throw new Error('表格选区已变化，请重新选择')
          const previousTable = findDocumentBlock(fromEditorDocument(state.doc).blocks, target.tableId)
          if (previousTable?.type !== 'table') throw new Error('表格已变化，请重新选择')
          const next = changeDocumentTableFromEditorState(state, command, () => crypto.randomUUID())
          applyDocumentContent(next, { ...selected, previousTable, wasCellSelection: state.selection instanceof CellSelection })
        }
      } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    }
    const disabled = (command: DocumentTableCommand): string | undefined => {
      if (!target.anchor || !column) return '请先选择单元格'
      if (command === 'insert-column-left' || command === 'insert-column-right') return undefined
      if (command === 'delete-column') return table.columns.length <= 1 ? '至少保留一列' : undefined
      if (!row) return '请选择表格数据行'
      if (command === 'delete-row') return table.rows.length <= 1 ? '至少保留一行' : undefined
      if (command === 'merge-cells') return target.head?.kind !== 'cell' ||
        target.head.cell.rowId === row && target.head.cell.columnId === column ? '请选择多个单元格' : undefined
      if (command === 'split-cell') return table.merges?.some(merge => merge.rowIds.includes(row) && merge.columnIds.includes(column)) ? undefined : '当前单元格未合并'
      return undefined
    }
    const items = (Object.keys(documentTableCommandLabels) as DocumentTableCommand[]).map(command => ({
      id: `table-${command}`, label: documentTableCommandLabels[command], group: '表格',
      disabledReason: previewSelection() ? '正在生成的范围暂时只读' : disabled(command), run: () => run(command),
    }))
    return [...items, { id: 'table-toggle-header', label: table.headerEnabled === false ? '开启表头' : '关闭表头', group: '表格',
      disabledReason: previewSelection() ? '正在生成的范围暂时只读' : null, run: () => run('toggle-header') },
    { id: 'table-delete', label: '删除表格', group: '表格', danger: true,
      disabledReason: previewSelection() ? '正在生成的范围暂时只读' : null, run: () => run('delete-table') }]
  }
  const options = () => ({ draftSession, contentScope: latest.current.contentScope,hiddenBlockIds:latest.current.hiddenBlockIds, presentation: latest.current.target === 'flow' ? 'flow' as const : undefined, stateChanged: (state: EditorState) => { const next = readDocumentFormatting(state, latest.current.inlineStyleDefaults); setFormat(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next); updateActiveBlock(state) }, requestMathDraft: (request: { from: number; to: number; display: true; latex: ''; formulaId: string }) => {const editor=layout.current;if(editor){mathTarget.current?.release();mathTarget.current=editor.trackSelection(TextSelection.create(editor.view.state.doc,request.from,request.to))}setMathDraft({ ...request, accessibleText: '' })}, document: projection.current.document, sourceMap: mapRef.current, revision: latest.current.revision,
    projectionPlugins: [...(latest.current.target === 'flow' ? [flowEditingPlugin,objectPreviewPlugin] : []), previewPlugin, pinPlugin, inlineDefaultsPlugin], projectionClipboard: (view: Parameters<typeof layoutPreviewClipboard>[0], event: ClipboardEvent, cut: boolean) => {
      const handled = layoutPreviewClipboard(view, event, cut)
      if (handled && cut) previewBlocked()
      return handled
    },
    formatShortcut: (flag: 'bold' | 'italic' | 'underline') => {
      if (latest.current.active === false || latest.current.readOnly || latest.current.contentScope === 'formula') return false
      toggleStyle(flag); return true
    },
    inputChanged: setInputActive, blockMoveDisabledReason: latest.current.blockMoveDisabledReason, readOnly: latest.current.readOnly, renderInline: latest.current.renderInline, renderObject: latest.current.renderObject, renderGroup: latest.current.renderGroup, objectRevision: latest.current.objectRevision,objectRevisionFor:latest.current.objectRevisionFor, objectChangedIds:latest.current.objectChangedIds,
    beforeProjectionMutation:latest.current.beforeProjectionMutation,afterProjectionMutation:latest.current.afterProjectionMutation,
    runtimeSpacers: latest.current.runtimeSpacers,
    clipboardContext: latest.current.clipboardContext, clipboardResourcePort: latest.current.clipboardResourcePort,
    change: (document: MarkdownDocument, operation: DocumentOperation) => {
      const owner = draftSession.retained ? draftOwner.current ?? latest.current : latest.current
      draftOwner.current = owner
      if (deferredLayoutSource) {
        projection.current = deferDocumentSource(document, { createId: () => crypto.randomUUID(), target: 'flow', resolveImage: owner.resolveImage })
        mapRef.current = availableDocumentSourceMap(projection.current)
        reportDiagnostics([]); owner.onDocumentDraft?.(document, operation)
        return commit(document, operation, owner)
      }
      const current = projection.current
      const text = documentScope && owner.target === 'file' ? editMarkdownSource(draft.current, current.document, document, current.sourceMap,
        editorMarkdownOptions(owner)) : serializeDocumentMarkdown(document, owner.target)
      let nextDocument = document, issues: DocumentDiagnostic[] = []
      if (documentScope) {
        const parsed = parseDocumentMarkdown(text, { ...editorMarkdownOptions(owner), previous: current })
        if (parsed.status !== 'valid') throw new Error('修改无法完整对应源文，原输入仍保留。')
        if (sameMarkdownContent(parsed.document, document)) bindMarkdownIdentities(parsed, document)
        nextDocument = parsed.document; issues = parsed.diagnostics
        projection.current = parsed; mapRef.current = parsed.sourceMap
      } else projection.current = { source: text, document, sourceMap: { blocks: [] } }
      draft.current = text; sourceInvalid.current = false; reportDiagnostics(issues); owner.onDraft(text, issues); owner.onDocumentDraft?.(nextDocument, operation)
      draftSession.receive(nextDocument)
      return commit(nextDocument, operation, owner)
    },
    selection: (selection: DocumentSelection | null, passiveDomSelection?: boolean) => {
      if (passiveDomSelection && latest.current.contextualCardSuppressed) return
      publishLayoutSelection(selection)
    },
    undo: (draftSession.retained ? draftOwner.current ?? latest.current : latest.current).onUndo,
    redo: (draftSession.retained ? draftOwner.current ?? latest.current : latest.current).onRedo, diagnostic: fail,
  })
  function commit(document: MarkdownDocument, operation: DocumentOperation, owner: SharedDocumentEditorProps): DocumentCommitResult {
    latestOperation.current = operation.operationId
    try {
      const result = owner.onChange(document, { ...operation, rangeProjection: operation.rangeProjection ?? projectDocumentRanges(document.content) })
      if (result instanceof Promise) return result.then(accepted => {
        if (accepted === false && latestOperation.current === operation.operationId) rejectCommit('正文未能提交，请修正后重试或丢弃草稿', owner.onDraft)
        return accepted
      }, failure => { if (latestOperation.current === operation.operationId) rejectCommit(failure instanceof Error ? failure.message : String(failure), owner.onDraft); return false })
      if (result === false) rejectCommit('正文未能提交，请修正后重试或丢弃草稿', owner.onDraft)
      return result
    } catch (error) { rejectCommit(error instanceof Error ? error.message : String(error), owner.onDraft); return false }
  }
  function rejectCommit(message: string, notify = latest.current.onDraft) {
    const issues = [{ message, offset: 0, endOffset: 0, line: 1, column: 1 }]
    reportDiagnostics(issues); notify(deferredLayoutSource ? materializeSource() : draft.current, issues)
  }
  useEffect(() => {
    if (mode === 'layout' && layoutHost.current) {
      const editor = createLayoutEditor(layoutHost.current, options()); layout.current = editor
      const reportLayoutMount = latest.current.onLayoutMount
      reportLayoutMount?.(editor.view.dom)
      if (restoreSourceSelection.current && sourceSelection.current) {
        restoreSourceSelection.current = false
        const selected = sourceSelection.current
        const range = layoutPreviewRange(editor.view.state.doc, { editId: 'mode-selection', target: { kind: 'markdown-range', from: Math.min(selected.anchor, selected.head), to: Math.max(selected.anchor, selected.head) }, value: '', cancel() {} }, mapRef.current)
        if (range) editor.view.updateState(editor.view.state.apply(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, selected.anchor <= selected.head ? range.from : range.to, selected.anchor <= selected.head ? range.to : range.from))))
      } else if (layoutSelection.current) {
        try { editor.view.updateState(editor.view.state.apply(editor.view.state.tr.setSelection(Selection.fromJSON(editor.view.state.doc, layoutSelection.current)))) } catch { /* The owner may have replaced the selected block. */ }
      }
      setInputActive(editor.isInputActive())
      if (focusAfterSwitch.current) { editor.setInputActive(true); editor.view.focus(); focusAfterSwitch.current = false }
      queueMicrotask(() => { if (layout.current === editor) updateActiveBlock(editor.view.state) })
      return () => { reportLayoutMount?.(null); setActiveBlock(null); layoutSelection.current = editor.view.state.selection.toJSON(); editor.destroy(); if (layout.current === editor) layout.current = null }
    }
    if (mode === 'source' && sourceHost.current) {
      const materializedLayout = deferredLayoutSource && !sourceInvalid.current && !restoredDiagnostics.current
      if (materializedLayout) materializeSource(true)
      source.current = new SourceView({ parent: sourceHost.current, state: SourceState.create({ doc: draft.current, extensions: [SourceState.allowMultipleSelections.of(true), sourcePinnedSelectionField, ...sourcePreviewExtensions(previewBlocked), markdown(), lineNumbers(), foldGutter(), SourceView.lineWrapping, SourceState.readOnly.of(Boolean(latest.current.readOnly)),
        SourceView.contentAttributes.of({ 'aria-label': '正文源文编辑' }),
        sourceKeymap.of([{ key: 'Mod-z', run: () => { void navigateHistory('undo'); return true } }, { key: 'Mod-Shift-z', run: () => { void navigateHistory('redo'); return true } }, { key: 'Mod-y', run: () => { void navigateHistory('redo'); return true } }]),
        SourceView.domEventHandlers({ compositionstart: () => { sourceComposing.current = true }, compositionend: (_event, view) => {
          sourceComposing.current = false
          draft.current = readSourceText(view.state.doc)
          queueMicrotask(() => { if (source.current === view) { acceptSourceDocument(view.state.doc); publishSourceSelection(view) } })
        } }),
        SourceView.updateListener.of(update => {
          if (update.docChanged && !syncingSource.current && !sourceComposing.current) acceptSourceDocument(update.state.doc)
          if (update.selectionSet && !syncingSource.current) publishSourceSelection(update.view)
        }),
      ] }) })
      const editor = source.current
      if (sourceSelection.current) editor.dispatch({ selection: { anchor: Math.min(editor.state.doc.length, sourceSelection.current.anchor), head: Math.min(editor.state.doc.length, sourceSelection.current.head) }, effects: SourceView.scrollIntoView(Math.min(editor.state.doc.length, sourceSelection.current.anchor)) })
      const folds = [...draft.current.matchAll(/^```cw-object-v1\s*\n[\s\S]*?^```/gm)].map(match => foldEffect.of({ from: match.index! + match[0].indexOf('\n'), to: match.index! + match[0].length - 3 }))
      if (folds.length) source.current.dispatch({ effects: folds })
      publishSourceSelection(editor)
      if (!draftSession.rejected && !materializedLayout) {
        const parsed = parseDocumentMarkdown(draft.current, editorMarkdownOptions(latest.current))
        sourceInvalid.current = parsed.status !== 'valid'
        if (!restoredDiagnostics.current) reportDiagnostics(parsed.diagnostics)
      }
      if (focusAfterSwitch.current) { editor.focus(); focusAfterSwitch.current = false }
      return () => { sourceSelection.current = { anchor: editor.state.selection.main.anchor, head: editor.state.selection.main.head }; editor.destroy(); if (source.current === editor) source.current = null; sourceComposing.current = false; sourceText.current = null; acceptedSourceText.current = null }
    }
  }, [mode])
  useEffect(() => { layout.current?.update(options()) }, [props.document, props.revision, props.objectRevision, props.runtimeSpacers, props.readOnly])
  useEffect(() => {
    const editor = layout.current
    if (!editor) return
    editor.view.dispatch(editor.view.state.tr.setMeta(inlineDefaultsKey, true))
    setFormat(readDocumentFormatting(editor.view.state, props.inlineStyleDefaults))
  }, [props.inlineStyleDefaults, mode])
  useEffect(() => {
    if (sourceComposing.current || draftSession.retained || (!isFileSource() && (sourceInvalid.current || restoredDiagnostics.current))) return
    if (deferredLayoutSource && props.sourceDraft === undefined && mode === 'layout') return
    const previousDraft = draft.current
    const text = deferredLayoutSource && props.sourceDraft === undefined ? materializeSource(true) : props.sourceDraft ?? serializeDocumentMarkdown(props.document, props.target)
    if (text === previousDraft) return
    draft.current = text
    if (source.current) {
      syncingSource.current = true
      const previous = readSourceText(source.current.state.doc)
      let from = 0, before = previous.length, after = text.length
      while (from < before && from < after && previous[from] === text[from]) from++
      while (before > from && after > from && previous[before - 1] === text[after - 1]) { before--; after-- }
      source.current.dispatch({ changes: { from, to: before, insert: text.slice(from, after) }, effects: sourcePreviewEffect.of(null) })
      syncingSource.current = false
    }
    const parsed = deferredLayoutSource && props.sourceDraft === undefined ? { status: 'valid' as const, document: projection.current.document, sourceMap: projection.current.sourceMap, diagnostics: [] }
      : documentScope ? parseDocumentMarkdown(text, editorMarkdownOptions(props)) : null
    sourceInvalid.current = parsed !== null && parsed.status !== 'valid'
    restoredDiagnostics.current = false
    if (parsed?.status === 'valid') {
      projection.current = suppliedProjection; mapRef.current = suppliedProjection.sourceMap
      draftSession.receive(suppliedProjection.document)
    }
    reportDiagnostics(parsed?.diagnostics ?? [])
  }, [props.revision, props.sourceDraft, documentScope, deferredLayoutSource])
  const hostPreviews = useEditPreviews(props.editPreviews || props.editPreview ? undefined : props.cardDocumentId, Number.isSafeInteger(Number(props.revision)) ? Number(props.revision) : undefined)
  const allPreviews = useMemo(() => props.editPreviews ?? (props.editPreview ? [props.editPreview] : hostPreviews.map(preview => ({ editId: preview.editId,
    sequence: preview.sequence, target: preview.target, value: preview.value, cancel: () => { void cancelEditPreview(preview).catch(error => fail(String(error))) } }))), [props.editPreviews, props.editPreview, hostPreviews])
  function previewSelection() {
    const view = layout.current?.view
    const values = mode === 'layout' && view ? layoutPreviewKey.getState(view.state) ?? [] : source.current?.state.field(sourcePreviewField, false) ?? []
    const selected = mode === 'layout' && view ? view.state.selection : source.current?.state.selection.main
    return Boolean(selected && values.some(value => selected.from === selected.to ? selected.from > value.from && selected.from < value.to : selected.from < value.to && selected.to > value.from))
  }
  useEffect(() => {
    if (layout.current) {
      const view = layout.current.view
      sourceMapForTargets(allPreviews.map(preview => preview.target))
      view.dispatch(view.state.tr.setMeta(layoutPreviewKey, allPreviews.flatMap(preview => layoutPreviewRanges(view.state.doc, preview, mapRef.current))))
    }
    if (source.current) source.current.dispatch({ effects: sourcePreviewEffect.of(allPreviews.flatMap(preview => sourcePreviewRanges(preview, mapRef.current, draft.current, toEditorDocument(projection.current.document.content)))) })
  }, [mode, allPreviews, props.revision, props.document])
  useEffect(() => {
    // A current field owns selection; a late body revision must not republish its retained PM target.
    // Real text clicks and transactions still report through publishLayoutSelection.
    if (latest.current.contextualCardSuppressed) return
    if(mode==='layout' && layout.current && latest.current.active!==false){const selection=layout.current.readSelection();latest.current.onSelection?.(selection ? {...selection,revision:props.revision}:null)}
    const current = contextualTargetRef.current
    if (!current || current.revision === props.revision) return
    // A committed edit such as formatting keeps the same selection: report it again at the new revision so the
    // quick bar stays. A pending AI draft still keeps its old target (publishContextualTarget).
    if (mode === 'layout' && layout.current) { const selection = layout.current.readSelection(); if (selection) { publishLayoutSelection(selection, false); return } }
    else if (mode === 'source' && source.current) { publishSourceSelection(source.current); return }
    publishContextualTarget(null)
  }, [props.revision])
  function clearDocumentSelection(targets?: readonly ExecutionSelectionTarget[]) {
    const raw = source.current
    if (raw && targets) {
      const removed = targets.flatMap(target => target.kind === 'course-surface' ? [] : sourcePreviewRanges({ editId: 'remove-selection', target, value: '', cancel() {} }, mapRef.current, draft.current, toEditorDocument(projection.current.document.content)))
      const retained = raw.state.selection.ranges.filter(selected => !removed.some(value => selected.from < value.to && selected.to > value.from))
      if (retained.length === raw.state.selection.ranges.length) return
      raw.dispatch({ selection: retained.length ? SourceSelection.create(retained) : SourceSelection.cursor(raw.state.selection.main.head) })
      return
    }
    const view = layout.current?.view
    if (view) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(view.state.selection.head))))
    if (raw) raw.dispatch({ selection: { anchor: raw.state.selection.main.head } })
    publishContextualTarget(null)
  }
  useEffect(() => {
    if (!props.cardDocumentId || props.active === false) return
    const range = (target: ExecutionSelectionTarget) => {
      if (target.kind === 'course-surface') return null
      sourceMapForTargets([target])
      const projected = documentPreviewTarget(target)
      const preview = { editId: 'card-result', target: projected, value: '', cancel() {} }
      const pieces = mode === 'layout' && layout.current ? layoutPreviewRanges(layout.current.view.state.doc, preview, mapRef.current) : sourcePreviewRanges(preview, mapRef.current, draft.current, toEditorDocument(projection.current.document.content))
      return pieces.length ? { from: Math.min(...pieces.map(piece => piece.from)), to: Math.max(...pieces.map(piece => piece.to)), pieces } : null
    }
    const clear = workbenchSelection.registerSelectionClearer(props.cardDocumentId, clearDocumentSelection)
    const unregister = workbenchSelection.registerTargetView(props.cardDocumentId, {
      root: () => mode === 'layout' ? layout.current?.view.dom ?? null : source.current?.dom ?? null,
      rect: target => {
        try {
          const bounds = range(target); if (!bounds) return null
          if (mode === 'layout' && layout.current) {
            const from = layout.current.view.coordsAtPos(bounds.from), to = layout.current.view.coordsAtPos(bounds.to)
            return new DOMRect(Math.min(from.left, to.left), Math.min(from.top, to.top), Math.max(1, Math.max(from.right, to.right) - Math.min(from.left, to.left)), Math.max(from.bottom, to.bottom) - Math.min(from.top, to.top))
          }
          const from = source.current?.coordsAtPos(bounds.from), to = source.current?.coordsAtPos(bounds.to)
          return from && to ? new DOMRect(Math.min(from.left, to.left), Math.min(from.top, to.top), Math.max(1, Math.max(from.right, to.right) - Math.min(from.left, to.left)), Math.max(from.bottom, to.bottom) - Math.min(from.top, to.top)) : null
        } catch { return null }
      },
      select: target => {
        const bounds = range(target); if (!bounds) return false
        if (mode === 'layout' && layout.current) {
          if (latest.current.target === 'flow') { ++inputGeneration.current; layout.current.setInputActive(false) }
          const view = layout.current.view, pieces = [...bounds.pieces].sort((a,b) => a.from-b.from)
          if (pieces.some((piece,index) => index > 0 && view.state.doc.textBetween(pieces[index-1].to,piece.from,'\n','\uFFFC').trim())) throw new Error('这些结果位于多个文字区域，请在源码视图中选择。')
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bounds.from, bounds.to)).scrollIntoView()); view.focus(); return true
        }
        if (source.current) { source.current.dispatch({ selection: SourceSelection.create(bounds.pieces.map(piece => SourceSelection.range(piece.from,piece.to))), scrollIntoView: true }); source.current.focus(); return true }
        return false
      },
    })
    return () => { clear(); unregister() }
  }, [props.cardDocumentId, props.active, mode])
  useEffect(() => {
    const pins = (props.pinnedTargets ?? []).filter(target => target.kind !== 'course-object' && target.kind !== 'course-surface').map(target => ({ editId: 'pinned-selection', target, value: '', cancel() {} }))
    sourceMapForTargets(pins.map(pin => pin.target))
    if (layout.current) {
      const view = layout.current.view
      view.dispatch(view.state.tr.setMeta(pinnedSelectionKey, [...pins.flatMap(pin => layoutPreviewRanges(view.state.doc, pin, mapRef.current)), ...(localPin?.mode === 'layout' && localPin.revision === props.revision ? [localPin] : [])]))
    }
    if (source.current) source.current.dispatch({ effects: sourcePinnedSelectionEffect.of([...pins.flatMap(pin => sourcePreviewRanges(pin, mapRef.current, draft.current, toEditorDocument(projection.current.document.content))), ...(localPin?.mode === 'source' && localPin.revision === props.revision ? [localPin] : [])]) })
  }, [mode, props.pinnedTargets, props.revision, fallbackMap, localPin])
  useImperativeHandle(ref, () => ({
    objectPointer: acceptObjectPointer,
    captureInsertionSelection: () => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.readOnly || sourceComposing.current || editor.view.composing) throw new Error('请在正文中选择插入位置并完成当前输入')
      return editor.captureInsertionSelection()
    },
    clearSelection: clearDocumentSelection,
    focusAtClientPoint: point => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.active === false || latest.current.readOnly || editor.view.composing) return false
      try {
        const hit = editor.view.posAtCoords({ left: point.x, top: point.y })
        if (!hit) return false
        ++inputGeneration.current
        editor.setInputActive(true)
        editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.near(editor.view.state.doc.resolve(hit.pos))))
        editor.view.focus()
        return true
      } catch { return false }
    },
    selectAtClientPoints: (anchor, head) => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.active === false || latest.current.readOnly || editor.view.composing) return false
      const view = editor.view
      try {
        const from = view.posAtCoords({ left: anchor.x, top: anchor.y }), to = view.posAtCoords({ left: head.x, top: head.y })
        if (!from || !to) return false
        ++inputGeneration.current
        editor.setInputActive(true)
        view.dispatch(view.state.tr.setSelection(TextSelection.between(view.state.doc.resolve(from.pos), view.state.doc.resolve(to.pos))))
        view.focus(); return true
      } catch { return false }
    },
    paintProjection: paint => { layout.current?.paintProjection(paint) },
    applyInlineStyle: patch => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.readOnly || editor.view.composing || !editor.view.state.selection.empty) return false
      style(patch)
      return true
    },
    flush: () => {
      const ready = !sourceComposing.current && !sourceInvalid.current && !restoredDiagnostics.current && (layout.current?.flush() ?? !draftSession.rejected)
      return { ready, source: deferredLayoutSource && mode === 'layout' && !sourceComposing.current && !layout.current?.view.composing ? materializeSource() : draft.current, diagnostics: diagnosticsRef.current }
    },
    drain, drainSource, canPreserveDraft: () => !sourceComposing.current && !source.current?.composing && !layout.current?.view.composing
      && (sourceInvalid.current || restoredDiagnostics.current || draftSession.rejected), discardDraft: discardLocalDraft,
    getContextualEditTarget: () => contextualTargetRef.current,
    focusEndParagraph: () => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.readOnly || editor.view.composing) return false
      ++inputGeneration.current
      editor.setInputActive(true)
      const view = editor.view, transaction = view.state.tr
      if (view.state.doc.lastChild?.type !== documentEditorSchema.nodes.paragraph) {
        editor.boundary()
        transaction.insert(view.state.doc.content.size, documentEditorSchema.nodes.paragraph.create({ id: crypto.randomUUID(), data: { type: 'paragraph' } }))
      }
      transaction.setSelection(TextSelection.create(transaction.doc, transaction.doc.content.size - 1))
      view.dispatch(transaction.scrollIntoView())
      view.focus()
      return true
    },
    focusBlock: (blockId) => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.readOnly) return false
      let position: number | null = null
      editor.view.state.doc.descendants((node, offset) => {
        if (node.attrs.id === blockId) {
          if(node.isTextblock)position=offset+1
          else node.descendants((child,at)=>{if(position===null && child.isTextblock)position=offset+1+at+1;return position===null})
          return false
        }
        return true
      })
      if (position === null) return false
      ++inputGeneration.current
      editor.setInputActive(true)
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position)).scrollIntoView())
      editor.view.focus()
      return true
    },
    focusSlot: (blockId, slotKey) => {
      const editor = layout.current
      if (!editor || mode !== 'layout' || latest.current.readOnly) return false
      let position: number | null = null
      editor.view.state.doc.descendants((node, offset) => {
        if (node.attrs.id !== blockId || node.type.name !== 'compound') return true
        node.descendants((child, localOffset) => {
          if (position !== null) return false
          if (child.type.name === 'slot' && child.attrs.key === slotKey) { position = offset + localOffset + 2; return false }
          return true
        })
        return false
      })
      if (position === null) return false
      ++inputGeneration.current
      editor.setInputActive(true)
      editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, position)).scrollIntoView())
      editor.view.focus()
      return true
    },
    selectBlock: (blockId) => {
      const editor = layout.current
      if (!editor || mode !== 'layout') return false
      ++inputGeneration.current
      return editor.selectBlock(blockId)
    },
  }), [diagnostics, mode])
  async function drain() {
    if (sourceComposing.current || source.current?.composing) return { ready: false, source: draft.current, diagnostics: diagnosticsRef.current }
    const ready = layout.current ? await layout.current.drain() : await draftSession.drain()
    return { ready: ready && !sourceInvalid.current && !restoredDiagnostics.current,
      source: deferredLayoutSource && mode === 'layout' ? materializeSource() : draft.current, diagnostics: diagnosticsRef.current }
  }
  function isFileSource() { return latest.current.target === 'file' && mode === 'source' }
  async function drainSource() {
    if (!isFileSource()) return drain()
    if (sourceComposing.current || source.current?.composing) return { ready: false, source: draft.current, diagnostics: diagnosticsRef.current }
    const ready = await draftSession.drain()
    return { ready: ready && !sourceComposing.current && !source.current?.composing, source: draft.current, diagnostics: diagnosticsRef.current }
  }
  async function navigateHistory(direction: 'undo' | 'redo') {
    const owner = draftSession.retained ? draftOwner.current ?? latest.current : latest.current
    if (!(await drain()).ready) return
    try { await (direction === 'undo' ? owner.onUndo() : owner.onRedo()) }
    catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  async function discardLocalDraft() {
    if (sourceComposing.current || source.current?.composing || layout.current?.view.composing) return
    const owner = draftOwner.current ?? latest.current, raw = draft.current, formal = latest.current.document
    await draftSession.drain()
    if (await owner.onDiscardDraft?.() === false) return
    if (draft.current !== raw || latest.current.document !== formal) return
    if (!await draftSession.discard(latest.current.document)) return
    resetLocalDraft()
  }
  async function preserveLocalDraft() {
    if (sourceComposing.current || source.current?.composing || layout.current?.view.composing) return
    const owner = draftOwner.current ?? latest.current, raw = draft.current, formal = latest.current.document
    await draftSession.drain()
    // The owner also owns prepared resources: it must decline this exit while
    // their raw bytes have not been durably preserved. Never discard a batch to
    // make an unrelated editor appear ready.
    if (!await owner.onPreserveDraft?.()) return
    if (draft.current !== raw || latest.current.document !== formal) return
    if (!await draftSession.discard(latest.current.document)) return
    resetLocalDraft()
  }
  function resetLocalDraft() {
    draftOwner.current = null; restoredDiagnostics.current = false; latestOperation.current = null
    const current = latest.current, text = current.target === 'file' && current.sourceDraft !== undefined ? current.sourceDraft : serializeDocumentMarkdown(current.document, current.target)
    const parsed = documentScope ? parseDocumentMarkdown(text, editorMarkdownOptions(current)) : null
    sourceInvalid.current = parsed !== null && parsed.status !== 'valid'
    if (parsed?.status === 'valid') { bindMarkdownIdentities(parsed, current.document); projection.current = parsed }
    else projection.current = { source: text, document: current.document, sourceMap: { blocks: [] } }
    mapRef.current = projection.current.sourceMap; draft.current = text
    reportDiagnostics(parsed?.diagnostics ?? []); latest.current.onDraft(draft.current, parsed?.diagnostics ?? [])
    layout.current?.update(options())
    setMode(sourceInvalid.current ? 'source' : 'layout')
  }
  function switchMode() {
    publishContextualTarget(null)
    if (mode === 'layout') {
      if (!layout.current?.flush()) return
      if (deferredLayoutSource) materializeSource(true)
      const state = layout.current.view.state, anchor = editorPositionToPoint(state.doc, state.selection.anchor), head = editorPositionToPoint(state.doc, state.selection.head)
      if (anchor && head) {
        const mapped = mapDocumentSelectionToSource(draft.current, mapRef.current, { kind: 'text', revision: latest.current.revision, anchor, head })
        if (mapped.status === 'mapped' && mapped.ranges.length) { const from = mapped.ranges[0].from, to = mapped.ranges.at(-1)!.to; sourceSelection.current = state.selection.anchor <= state.selection.head ? { anchor: from, head: to } : { anchor: to, head: from } }
      }
      focusAfterSwitch.current = true; setMode('source')
    }
    else if (!sourceComposing.current) {
      // When blocked by diagnostics, still offer feedback so the button never feels dead.
      if (diagnostics.length && (latest.current.target !== 'file' || sourceInvalid.current || restoredDiagnostics.current || draftSession.rejected)) {
        setCommandError(`源文中有 ${diagnostics.length} 处问题（第 ${diagnostics[0].line} 行起），先修正或丢弃待修草稿再切回正文。`)
        return
      }
      setCommandError('')
      restoreSourceSelection.current = true; sourceSelection.current = source.current ? { anchor: source.current.state.selection.main.anchor, head: source.current.state.selection.main.head } : sourceSelection.current; focusAfterSwitch.current = true; setMode('layout')
    }
  }
  function locateDiagnostic(diagnostic: DocumentDiagnostic) {
    if (sourceComposing.current || layout.current && !layout.current.flush()) return
    const anchor = Math.min(draft.current.length, diagnostic.offset), head = Math.min(draft.current.length, Math.max(diagnostic.offset, diagnostic.endOffset))
    sourceSelection.current = { anchor, head }; publishContextualTarget(null)
    if (source.current) { source.current.dispatch({ selection: { anchor, head }, effects: SourceView.scrollIntoView(anchor) }); source.current.focus() }
    else { focusAfterSwitch.current = true; setMode('source') }
  }
  function style(patch: TextRunStyle | ((effective: TextRunStyle) => TextRunStyle)) {
    const editor = layout.current
    if (!editor) return
    editor.syncDomTextSelection()
    editor.boundary()
    const { state } = editor.view
    const type = documentEditorSchema.marks.style
    const tr = state.tr
    // Under host defaults, explicit null means "no highlight", rather than inheriting the host color.
    const merged = (current: TextRunStyle, position: number) => {
      const base = latest.current.inlineStyleDefaults?.(inlineBlockId(state, position),editorPositionToPoint(state.doc,position)) ?? {}
      const inheritedSize = base.fontSize ?? (() => { const dom = editor.view.domAtPos(position); const element = dom.node instanceof Element ? dom.node : dom.node.parentElement; return element ? Number.parseFloat(getComputedStyle(element).fontSize) || 16 : 16 })()
      const change = typeof patch === 'function' ? patch({ ...base, fontSize: inheritedSize, ...current }) : patch
      return Object.fromEntries(Object.entries({ ...current, ...change }).filter(([key, value]) => value !== undefined && (value !== null || key === 'highlightColor' && latest.current.inlineStyleDefaults !== undefined))) as TextRunStyle
    }
    if (state.selection.empty) {
      const current = (state.storedMarks ?? state.selection.$from.marks()).find(mark => mark.type === type)?.attrs.value ?? {}
      tr.addStoredMark(type.create({ value: merged(current, state.selection.from) }))
    } else for (const range of state.selection.ranges) state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!node.isInline) return
      const current = node.marks.find(mark => mark.type === type)?.attrs.value ?? {}
      tr.addMark(Math.max(range.$from.pos, pos), Math.min(range.$to.pos, pos + node.nodeSize), type.create({ value: merged(current, pos) }))
    })
    editor.view.dispatch(tr)
    editor.view.focus()
  }
  function toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strike' | 'emphasis') {
    layout.current?.syncDomTextSelection()
    const state = layout.current?.view.state
    if (!state) return
    style({ [key]: readDocumentFormatting(state, latest.current.inlineStyleDefaults).flags[key] !== true })
  }
  function clearFormatting() {
    const editor = layout.current
    if (!editor) return
    editor.syncDomTextSelection()
    editor.boundary()
    const state = editor.view.state, transaction = state.tr
    for (const type of [documentEditorSchema.marks.style, documentEditorSchema.marks.code, documentEditorSchema.marks.link]) {
      if (state.selection.empty) transaction.removeStoredMark(type)
      else for (const range of state.selection.ranges) transaction.removeMark(range.$from.pos, range.$to.pos, type)
    }
    editor.view.dispatch(transaction)
    editor.view.focus()
  }
  function applyParagraphType(value: string) {
    const editor = layout.current
    if (!editor) return
    editor.syncDomTextSelection()
    const type = value === 'paragraph' ? 'paragraph' : 'heading'
    const nodeType = documentEditorSchema.nodes[type]
    const { state } = editor.view, transaction = state.tr
    for (const position of paragraphTypePositions(state, type)) {
      const node = state.doc.nodeAt(position)!
      const content=fromEditorDocument(documentEditorSchema.nodes.doc.create(null,node))
      const converted=applyDocumentBlockCommand(content,{action:'convert',blockId:node.attrs.id,kind:type}).blocks[0]!
      const {id:_id,...data}=converted
      const attrs = { ...node.attrs, data: {...data,...(type==='heading' ? {level:Number(value)}:{})} }
      if (!node.hasMarkup(nodeType, attrs)) transaction.setNodeMarkup(position, nodeType, attrs)
    }
    if (transaction.docChanged) { editor.boundary(); editor.view.dispatch(transaction.scrollIntoView()) }
    editor.view.focus()
  }
  function paragraphTypePositions(state: EditorState, type: 'paragraph' | 'heading'): number[] {
    const positions = new Set<number>(), nodeType = documentEditorSchema.nodes[type]
    for (const range of state.selection.ranges) state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, position) => {
      if (!node.isTextblock || !node.attrs.id) return
      const point = state.doc.resolve(position), index = point.index()
      if (node.type === nodeType || point.parent.canReplaceWith(index, index + 1, nodeType)) positions.add(position)
    })
    return [...positions]
  }
  function dismissContextualTarget() {
    const current = contextualTargetRef.current
    instructionRef.current = ''; setContextualInstruction('')
    publishContextualTarget(null)
    latest.current.onContextualDismiss?.(current)
  }
  /** Hand the instruction over for the held target; a rejection keeps the draft in the quick bar form. */
  async function sendContextualInstruction(instruction: string) {
    const target = contextualTargetRef.current
    if (!target || !latest.current.onContextualCommand) throw new Error('请重新选择要修改的内容。')
    const issue = contextualIssue(target)
    if (issue) throw new Error(issue)
    if (diagnostics.length && latest.current.target !== 'file' && !isFileSource()) throw new Error('源文尚有错误，请先修正或丢弃待修草稿。')
    await latest.current.onContextualCommand(instruction, target)
    instructionRef.current = ''; setContextualInstruction(''); setCommandError('')
  }
  /** Move a held draft to the latest selection, keeping its text. */
  function rebindToCurrentSelection() {
    const next = manualTarget.current, draftText = instructionRef.current
    instructionRef.current = ''
    publishContextualTarget(next)
    instructionRef.current = draftText
  }
  function contextualIssue(target: DocumentContextSelection) {
    if (target.revision !== props.revision) return '选中的内容已改变，请改为当前选择；原指令仍保留。'
    return props.contextualCommandIssue ? props.contextualCommandIssue(target) : props.target==='flow' && target.mode==='layout' && target.selection ? null:target.ranges?.length ? null : target.message ?? '请重新选择要修改的内容。'
  }
  function openMath() {
    const editor = layout.current
    if (!editor) return
    const { selection } = editor.view.state
    mathTarget.current?.release();mathTarget.current=editor.trackSelection()
    if (props.contentScope === 'formula') {
      editor.view.state.doc.descendants((node, from) => {
        if (node.type.name !== 'formula') return true
        const data = node.attrs.data
        setMathDraft({ latex: data.latex, accessibleText: data.accessibleText ?? '', display: true, formulaId: data.formulaId, from, to: from + node.nodeSize,existing:true })
        return false
      })
      return
    }
    const node = selection instanceof NodeSelection ? selection.node : null
    const data = node?.type.name === 'math' || node?.type.name === 'formula' ? node.attrs.data : null
    setMathDraft({ latex: data?.latex ?? 'x^2', accessibleText: data?.accessibleText ?? '', display: documentScope && node?.type.name === 'formula', formulaId: data?.formulaId ?? crypto.randomUUID(), from: selection.from, to: selection.to,existing:Boolean(data) })
  }
  function openLink() {
    const editor = layout.current
    if (!editor) return
    const { state } = editor.view
    let selected = state.selection
    const mark = selected.$from.marks().find(value => value.type === documentEditorSchema.marks.link)
    if (mark && selected.empty) {
      const parent = selected.$from.parent, base = selected.$from.start()
      let from = selected.from, to = selected.to
      parent.forEach((node, position) => {
        if (node.marks.some(value => value.eq(mark)) && base + position <= selected.from && base + position + node.nodeSize >= selected.from) {
          from = base + position; to = base + position + node.nodeSize
        }
      })
      while (from > base && state.doc.resolve(from).nodeBefore?.marks.some(value => value.eq(mark))) from -= state.doc.resolve(from).nodeBefore!.nodeSize
      while (to < selected.$from.end() && state.doc.resolve(to).nodeAfter?.marks.some(value => value.eq(mark))) to += state.doc.resolve(to).nodeAfter!.nodeSize
      selected = TextSelection.create(state.doc, from, to)
    }
    linkTarget.current?.release(); linkTarget.current = editor.trackSelection(selected)
    setLinkDraft(mark?.attrs.href ?? '')
  }
  function applyMath(latex = mathDraft?.latex, accessibleText = mathDraft?.accessibleText) {
    const editor = layout.current
    if (!editor || !mathDraft || latex === undefined) return
    try {
      const parsedMath = parseDocumentMath(latex)
      const tracked=mathTarget.current?.resolve()
      let from=tracked?.from ?? mathDraft.from,to=tracked?.to ?? mathDraft.to
      if(mathDraft.existing) {
        let found=false
        editor.view.state.doc.descendants((node,at)=>{if(node.attrs.data?.formulaId===mathDraft.formulaId){from=at;to=at+node.nodeSize;found=true;return false}return !found})
        if(!found)throw new Error('要修改的公式已被删除，原输入仍保留。')
      }
      const current = editor.view.state.doc.nodeAt(from)
      const effective=current?.type.name==='math' ? readEditorMath(current):current?.attrs.data
      const data = { type: 'math', formulaId: mathDraft.formulaId, latex, accessibleText: accessibleText || describeDocumentMath(parsedMath),
        ...(effective?.style ? { style: effective.style } : {}) }
      const marks=current?.type.name==='math' ? current.marks:current?.type.name==='formula' && effective?.style ? [documentEditorSchema.marks.style.create({value:effective.style})]:editor.view.state.selection.$from.marks()
      let node = mathDraft.display ? documentEditorSchema.nodes.formula.create({ id: current?.type.name === 'formula' ? current.attrs.id : crypto.randomUUID(), data: { ...data, type: 'formula' } }) : documentEditorSchema.nodes.math.create({ data },null,marks)
      if (!mathDraft.display && current?.type.name === 'formula') node = documentEditorSchema.nodes.paragraph.create({ id: current.attrs.id, data: { type: 'paragraph' } }, node)
      editor.boundary()
      editor.view.dispatch(editor.view.state.tr.replaceRangeWith(from, to, node))
      mathTarget.current?.release();mathTarget.current=null
      setMathDraft(null); editor.view.focus()
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  const discardButton = diagnostics.length > 0 && (props.target !== 'file' || draftSession.rejected || restoredDiagnostics.current) && <button type="button" onClick={() => { void discardLocalDraft().catch(error => fail(error instanceof Error ? error.message : String(error))) }}>丢弃待修草稿</button>
  const preserveButton = diagnostics.length > 0 && props.onPreserveDraft && <button type="button" onClick={() => { void preserveLocalDraft().catch(error => fail(error instanceof Error ? error.message : String(error))) }}>保留原稿并继续编辑</button>
  function insertAtSelection(kind: DocumentBlockKind | 'chart', afterBlockId?: string) {
    const editor = layout.current
    if (!editor || latest.current.readOnly) return
    editor.syncDomTextSelection()
    const content = fromEditorDocument(editor.view.state.doc)
    const selection = afterBlockId ? { revision: latest.current.revision, kind: 'object' as const, blockId: afterBlockId } : editor.readSelection()
    try {
      const professional = kind === 'chart' ? prepareProfessionalElement('chart') : null
      const block: DocumentBlock = professional ? { id: crypto.randomUUID(), type: 'chart', chart: chartDataSchema.parse(professional.data), height: professional.height } : createDocumentBlock(kind as DocumentBlockKind)
      applyDocumentContent(insertDocumentBlocks(content, selection, [block]))
      setInsertionFallback(null)
    } catch (error) {
      if (error instanceof DocumentInsertionTargetError && selection) {
        try { setInsertionFallback({ blockId: documentInsertionBlockId(content, selection), kind, message: error.message }); return } catch { /* The original block may have disappeared. */ }
      }
      fail(error instanceof Error ? error.message : String(error))
    }
  }
  function insertTable() { insertAtSelection('table') }
  function selectionInsertionMenu(): MenuCommand[] {
    return [...DOCUMENT_BLOCK_KINDS, { kind: 'chart' as const, label: '图表' }].map(({ kind, label }) => ({
      id: `insert-at-${kind}`, label: `插入${label}`, group: '插入', run: () => insertAtSelection(kind),
      disabledReason: previewSelection() ? '正在生成的范围暂时只读' : undefined,
    }))
  }
  function patchBlockProperties(blockId: string, patch: Record<string, unknown>) {
    const editor = layout.current
    if (!editor || latest.current.readOnly) return
    let position: number | null = null
    editor.view.state.doc.descendants((node, at) => { if (node.attrs.id === blockId) { position = at; return false } return true })
    if (position === null) return
    const node = editor.view.state.doc.nodeAt(position)!
    editor.boundary()
    editor.view.dispatch(editor.view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, data: { ...node.attrs.data, ...patch } }))
  }
  const modeControls = <>
    <div className="shared-document-modes" role="group" aria-label="文档视图">
      <button type="button" aria-pressed={mode === 'layout'} onMouseDown={event => event.preventDefault()} onClick={() => { if (mode !== 'layout') switchMode() }}>正文</button>
      <button type="button" aria-pressed={mode === 'source'} onMouseDown={event => event.preventDefault()} onClick={() => { if (mode !== 'source') switchMode() }}>源码</button>
    </div>
    {mode === 'source' && diagnostics.length > 0 && commandError
      ? <div role="alert" className="shared-document-more__mode-notice">{commandError}</div>
      : null}
  </>
  const toolbar = <div ref={toolbarRef} tabIndex={-1} className="shared-document-toolbar" onPointerDownCapture={() => layout.current?.syncDomTextSelection()} role={props.toolbarHost?.closest('[role="toolbar"]') ? undefined : 'toolbar'} aria-label={props.toolbarHost?.closest('[role="toolbar"]') ? undefined : '正文工具'}>
      {documentScope && modeControls}
      {mode === 'layout' && props.contentScope === 'formula' && <button type="button" onMouseDown={event => event.preventDefault()} onClick={openMath}>编辑公式</button>}
      {mode === 'layout' && props.contentScope !== 'formula' && !flowObjectSelection && <>
        {!documentScope && props.toolbarHost ? <TextFormatControls value={{ fontFamily: format.fontFamily, fontSize: format.fontSize, color: format.color, highlightColor: format.highlightColor, ...format.flags }} onStyle={style} onToggle={toggleStyle}
          onStep={direction => style(effective => ({ fontSize: stepFontSize(effective.fontSize ?? 16, direction) }))}
          scope={<>{props.toolbarScope && `${props.toolbarScope} · `}{(semanticSelection?.kind === 'cells' ? '所选单元格' : semanticSelection?.kind === 'text' && (semanticSelection.anchor.blockId !== semanticSelection.head.blockId || semanticSelection.anchor.offset !== semanticSelection.head.offset || JSON.stringify(semanticSelection.anchor.slot) !== JSON.stringify(semanticSelection.head.slot)) ? '所选文字' : '输入位置')}</>} /> : <>
        {([['bold', '粗体'], ['italic', '斜体'], ['underline', '下划线']] as const).map(([key, label]) => <button key={key} type="button" onMouseDown={event => event.preventDefault()} aria-label={label} title={label} aria-pressed={format.flags[key]} onClick={() => toggleStyle(key)}>{key === 'bold' ? <Bold size={16} /> : key === 'italic' ? <Italic size={16} /> : <Underline size={16} />}</button>)}
        <label><input aria-label="字号" type="number" min="8" max="400" value={format.fontSize === 'mixed' ? '' : format.fontSize ?? ''} placeholder={format.fontSize === 'mixed' ? '混合' : '默认'} onChange={event => { const value = Number(event.target.value); if (value >= 8 && value <= 400) style({ fontSize: value }) }} /></label>
        <label><select aria-label="字体" value={format.fontFamily === 'mixed' ? '__mixed' : format.fontFamily ?? ''} onChange={event => { if (event.target.value && event.target.value !== '__mixed') style({ fontFamily: event.target.value }) }}><option value="">默认字体</option>{format.fontFamily === 'mixed' && <option value="__mixed">混合字体</option>}{format.fontFamily && format.fontFamily !== 'mixed' && !FONT_FAMILY_OPTIONS.some(option => option.family === format.fontFamily) && <option value={format.fontFamily}>{format.fontFamily}</option>}{FONT_FAMILY_OPTIONS.map(option => <option key={option.family} value={option.family}>{option.label}</option>)}</select></label>
        <PaletteButton label="文字颜色" text="颜色" onPick={color => { if (color) style({ color }) }} />
        <PaletteButton label="高亮颜色" text="高亮" variant="highlight" onPick={highlightColor => style({ highlightColor })} />
        </>}
        <button type="button" aria-label="链接" title="链接" onMouseDown={event => event.preventDefault()} onClick={openLink}><Link2 size={16} /></button>
        <button type="button" aria-label="公式" title="公式" onMouseDown={event => event.preventDefault()} onClick={openMath}><Sigma size={16} /></button>
        {documentScope && <button type="button" aria-label="插入表格" title="插入表格" onMouseDown={event => event.preventDefault()} onClick={insertTable}><Table2 size={16} aria-hidden="true" /></button>}
        {!documentScope && <button type="button" aria-label="清除文字格式" title="清除文字格式" onMouseDown={event => event.preventDefault()} onClick={clearFormatting}><Eraser size={16} /></button>}
        {documentScope && <select aria-label="段落类型" value={format.paragraphType} onChange={event => applyParagraphType(event.target.value)}><option value="" disabled>段落类型</option><option value="paragraph">正文</option>{[1,2,3,4,5,6].map(level => <option key={level} value={level}>标题 {level}</option>)}</select>}
        <button type="button" aria-label="更多文字格式" title="更多文字格式" aria-haspopup="menu" aria-expanded={formattingMenu.isOpen} onMouseDown={event => event.preventDefault()} onClick={event => {
          if (formattingMenu.isOpen) { formattingMenu.close(); return }
          const rect = event.currentTarget.getBoundingClientRect()
          formattingMenu.open({ x: rect.left, y: rect.bottom }, '更多文字格式', [
            { id: 'strike', label: '删除线', run: () => toggleStyle('strike') },
            { id: 'emphasis', label: '着重号', run: () => toggleStyle('emphasis') },
            { id: 'superscript', label: '上标', run: () => style({ baseline: 0.35 }) },
            { id: 'subscript', label: '下标', run: () => style({ baseline: -0.25 }) },
            { id: 'smaller', label: '减小字号', run: () => style(effective => ({ fontSize: stepFontSize(effective.fontSize ?? 16, -1) })) },
            { id: 'larger', label: '增大字号', run: () => style(effective => ({ fontSize: stepFontSize(effective.fontSize ?? 16, 1) })) },
            { id: 'clear', label: '清除文字格式', run: clearFormatting },
          ])
        }}><MoreHorizontal size={16} /></button>
      </>}
      {flowObjectSelection && mode === 'layout' && <button type="button" aria-label="插入表格" title="插入表格" onMouseDown={event => event.preventDefault()} onClick={insertTable}><Table2 size={16} aria-hidden="true" /></button>}
      {mode === 'layout' && !props.readOnly && props.renderTextActions?.(semanticSelection)}
      {props.onCompleteEditing && <QuickBarButton label="完成编辑" text="完成编辑" onClick={props.onCompleteEditing} />}
      {preserveButton}{discardButton}
    </div>
  const editorForms = <>
    {linkDraft !== null && <form className="shared-document-form" aria-label="链接编辑" onSubmit={event => {
      event.preventDefault(); const editor = layout.current; if (!editor) return
      if (linkDraft && !/^(https?:|mailto:|#|\.\/|\.\.\/)/i.test(linkDraft)) { fail('请输入 https、mailto 或文档内相对链接'); return }
      editor.boundary(); const state = editor.view.state,selection=linkTarget.current?.resolve() ?? state.selection
      if (!linkDraft) editor.view.dispatch(state.tr.removeMark(selection.from, selection.to, documentEditorSchema.marks.link))
      else if (selection.empty) editor.view.dispatch(state.tr.insertText(linkDraft,selection.from,selection.to).addMark(selection.from, selection.from + linkDraft.length, documentEditorSchema.marks.link.create({ href: linkDraft })))
      else editor.view.dispatch(state.tr.addMark(selection.from, selection.to, documentEditorSchema.marks.link.create({ href: linkDraft })))
      linkTarget.current?.release();linkTarget.current=null
      setLinkDraft(null); editor.view.focus()
    }}><label>链接地址<input aria-label="链接地址" value={linkDraft} onChange={event => setLinkDraft(event.target.value)} /></label><button type="submit">应用链接</button><button type="button" onClick={() => setLinkDraft(null)}>取消</button></form>}
    {mathDraft && <div className="shared-document-form shared-document-form--formula" aria-label="公式编辑">
      <LatexFormulaAuthoringEditor id={mathDraft.formulaId} latex={mathDraft.latex} accessibleText={mathDraft.accessibleText} autoFocus onCommit={applyMath} onCancel={() => setMathDraft(null)} />
      <label>朗读说明<input value={mathDraft.accessibleText} onChange={event => setMathDraft({ ...mathDraft, accessibleText: event.target.value })} /></label>
      {documentScope && <label><input type="checkbox" checked={mathDraft.display} onChange={event => setMathDraft({ ...mathDraft, display: event.target.checked })} />独立公式</label>}
    </div>}
  </>
  const quickBarIssue = contextualTarget ? contextualIssue(contextualTarget) ?? (diagnostics.length && props.target !== 'file' && !isFileSource() ? '源文尚有错误，请先修正或丢弃待修草稿。' : null) : null
  // As on the objects' quick bar, an open popover closes when something else is selected, not when the same selection
  // is reported again at a new revision (after an element card's own edit, M15).
  const selectionKey = contextualTarget ? JSON.stringify(contextualTarget.selection
    ? { ...contextualTarget.selection, revision: undefined }
    : { mode: contextualTarget.mode, ranges: contextualTarget.ranges?.map(range => [range.from, range.to]) }) : ''
  const hostAiButton = contextualTarget ? props.renderAiButton?.(contextualTarget, quickBarIssue) : undefined
  const tableTools = contextualTarget && mode === 'layout' ? activeTableMenu() : []
  const textSelection = contextualTarget?.selection?.kind === 'text' ? contextualTarget.selection : null
  const selectedNode = layout.current?.view.state.selection
  const textObjectTools = selectedNode instanceof NodeSelection && (selectedNode.node.isTextblock || ['compound', 'layout_group', 'section'].includes(selectedNode.node.type.name))
  const textTools = !!(contextualTarget && mode === 'layout' && (textSelection || textObjectTools))
  const cellTextTools = !!(contextualTarget && mode === 'layout' && contextualTarget.selection?.kind === 'cells')
  const paragraphTypeTools = !!(textTools && layout.current && paragraphTypePositions(layout.current.view.state, 'paragraph').length)
  const propertyId = contextualTarget?.selection?.kind === 'cells' ? contextualTarget.selection.tableId
    : contextualTarget?.selection?.kind === 'object' ? contextualTarget.selection.blockId : textSelection?.head.blockId
  const propertyBlock = props.target === 'file' && propertyId && layout.current ? (() => {
    const state = layout.current!.view.state
    let node: import('prosemirror-model').Node | null = null
    for (let depth = state.selection.$head.depth; depth > 0; depth--) {
      const candidate = state.selection.$head.node(depth)
      if (candidate.attrs.id === propertyId) { node = candidate; break }
    }
    if (!node) state.doc.descendants(candidate => { if (candidate.attrs.id === propertyId) { node = candidate; return false } return node === null })
    return node ? fromEditorBlock(node) : null
  })() : null
  // Component text/formula already has the full toolbar; document selections also need contextual actions.
  const quickBar = props.active !== false && documentScope && contextualTarget && !props.readOnly && !props.contextualCardSuppressed && quickBarPlace
    && <SelectionQuickBar anchor={quickBarPlace.anchor} bounds={quickBarPlace.bounds} label="选中内容快捷工具" selectionKey={selectionKey}
      suspended={pointerGesture || dismissedGeneration === targetGeneration}>
      {(textTools || cellTextTools) && <>
        {flowObjectSelection ? <TextFormatControls value={{ fontFamily: format.fontFamily, fontSize: format.fontSize, color: format.color, highlightColor: format.highlightColor, ...format.flags }} onStyle={style} onToggle={toggleStyle}
          onStep={direction => style(effective => ({ fontSize: stepFontSize(effective.fontSize ?? 16, direction) }))}
          scope={semanticSelection?.kind === 'object' ? '全文' : semanticSelection?.kind === 'cells' ? '所选单元格' : semanticSelection?.kind === 'text' && semanticSelection.anchor.blockId === semanticSelection.head.blockId && semanticSelection.anchor.offset === semanticSelection.head.offset && JSON.stringify(semanticSelection.anchor.slot) === JSON.stringify(semanticSelection.head.slot) ? '输入位置' : '所选文字'} /> : <>
          <QuickBarButton label="当前选区加粗" icon={<Bold size={14} />} pressed={format.flags.bold} onClick={() => toggleStyle('bold')} />
          <QuickBarButton label="当前选区斜体" icon={<Italic size={14} />} pressed={format.flags.italic} onClick={() => toggleStyle('italic')} />
          <QuickBarButton label="当前选区下划线" icon={<Underline size={14} />} pressed={format.flags.underline} onClick={() => toggleStyle('underline')} />
          <QuickBarColorButton label="当前选区文字颜色" icon={<Baseline size={14} />} value={format.color} onPick={color => { if (color) style({ color }) }} />
          <QuickBarColorButton label="当前选区高亮" icon={<Highlighter size={14} />} value={format.highlightColor} variant="highlight" onPick={highlightColor => style({ highlightColor })} />
        </>}
        {textTools && <>
        <QuickBarButton label="当前选区链接" icon={<Link2 size={14} />} onClick={openLink} />
        <QuickBarButton label="当前选区公式" icon={<Sigma size={14} />} onClick={openMath} />
         {documentScope && paragraphTypeTools && <QuickBarPopoverButton label="当前段落类型" text={format.paragraphType === 'paragraph' ? '正文' : /^[1-6]$/.test(format.paragraphType ?? '') ? `标题 ${format.paragraphType}` : '段落'} popupRole="menu">
          {close => <div className="selection-quick-bar__menu" role="menu" aria-label="当前段落类型">
            {[['paragraph', '正文'], ...[1, 2, 3, 4, 5, 6].map(level => [String(level), `标题 ${level}`])].map(([value, label]) => <button key={value} type="button" role="menuitem"
              onMouseDown={event => event.preventDefault()} onClick={() => { close(); applyParagraphType(value!) }}>{label}</button>)}
          </div>}
        </QuickBarPopoverButton>}
        <QuickBarPopoverButton label="更多文字格式" icon={<MoreHorizontal size={15} />} popupRole="menu">
          {close => <div className="selection-quick-bar__menu" role="menu" aria-label="更多文字格式">
            {([['strike', '删除线'], ['emphasis', '着重号']] as const).map(([key, label]) =>
              <button key={key} type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => { close(); toggleStyle(key) }}>{label}</button>)}
            <button type="button" aria-label="上标" title="上标" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => { close(); style({ baseline: 0.35 }) }}><Superscript size={16} /></button>
            <button type="button" aria-label="下标" title="下标" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => { close(); style({ baseline: -0.25 }) }}><Subscript size={16} /></button>
            <button type="button" aria-label="行内代码" title="行内代码" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => { const editor = layout.current; close(); if (editor) { editor.boundary(); toggleMark(documentEditorSchema.marks.code)(editor.view.state, editor.view.dispatch) } }}><Code size={16} /></button>
            {!flowObjectSelection && <>
              <label><input aria-label="选区字号" type="number" min="8" max="400" value={format.fontSize === 'mixed' ? '' : format.fontSize ?? ''} placeholder={format.fontSize === 'mixed' ? '混合' : '默认'}
                onChange={event => { const value = Number(event.target.value); if (value >= 8 && value <= 400) style({ fontSize: value }) }} /></label>
              <label><select aria-label="选区字体" value={format.fontFamily === 'mixed' ? '__mixed' : format.fontFamily ?? ''}
                onChange={event => { if (event.target.value && event.target.value !== '__mixed') { close(); style({ fontFamily: event.target.value }) } }}>
                <option value="">默认字体</option>{format.fontFamily === 'mixed' && <option value="__mixed">混合字体</option>}
                {FONT_FAMILY_OPTIONS.map(option => <option key={option.family} value={option.family}>{option.label}</option>)}
              </select></label>
            </>}
            <button type="button" aria-label="清除文字格式" title="清除文字格式" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => { close(); clearFormatting() }}><Eraser size={16} /></button>
          </div>}
        </QuickBarPopoverButton>
        </>}
        <QuickBarSeparator />
      </>}
      {flowObjectSelection && inputActive && <QuickBarButton label="完成编辑" text="完成编辑" onClick={() => { void completeFlowInput() }} />}
      {tableTools.length > 0 && <QuickBarPopoverButton label="表格操作" text="表格操作" popupRole="menu">
        {close => <div className="selection-quick-bar__menu" role="menu" aria-label="表格操作">
          <CommandMenuItems items={tableTools} onRun={command => { close(); command.run() }} />
        </div>}
      </QuickBarPopoverButton>}
      {props.renderQuickBarActions?.(contextualTarget)}
      {props.onColumns && mode === 'layout' && !props.readOnly && <QuickBarButton label="所选段落分为两列" text="分栏"
        disabled={Boolean(previewSelection()) || !documentColumnSelection(props.document.content, contextualTarget.selection)}
        onClick={() => {
          const content = layout.current && fromEditorDocument(layout.current.view.state.doc)
          const ids = content && documentColumnSelection(content, contextualTarget.selection)
          if (ids) createColumns(ids)
        }} />}
      {props.target === 'file' && propertyBlock && ['paragraph', 'heading', 'quote', 'table', 'formula', 'media'].includes(propertyBlock.type) && <QuickBarPopoverButton label="属性" icon={<SlidersHorizontal size={16} />} popoverLabel="当前文档块属性">
        {() => <div className="shared-document-block-properties" data-document-block-id={propertyBlock.id}>
          {(propertyBlock.type === 'paragraph' || propertyBlock.type === 'heading' || propertyBlock.type === 'quote') && <>
            <label>对齐<select aria-label="段落对齐" value={propertyBlock.textAlign ?? 'left'} onChange={event => patchBlockProperties(propertyBlock.id, { textAlign: event.target.value })}>
              <option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option>
            </select></label>
            <label>行距<input aria-label="段落行距" type="number" min="0" max="200" step="0.1" value={propertyBlock.lineSpacing ?? 1.7} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= 0 && value <= 200) patchBlockProperties(propertyBlock.id, { lineSpacing: value }) }} /></label>
          </>}
          {propertyBlock.type === 'table' && <label><input type="checkbox" aria-label="表格标题行" checked={propertyBlock.headerEnabled !== false} onChange={() => activeTableMenu().find(command => command.id === 'table-toggle-header')?.run()} />标题行</label>}
          {propertyBlock.type === 'formula' && <button type="button" onClick={openMath}>编辑公式</button>}
          {propertyBlock.type === 'media' && <label>布局<select aria-label="媒体布局" value={propertyBlock.layout} onChange={event => patchBlockProperties(propertyBlock.id, { layout: event.target.value })}><option value="content-width">正文宽度</option><option value="wide">宽幅</option><option value="full-width">满宽</option></select></label>}
        </div>}
      </QuickBarPopoverButton>}
      {hostAiButton !== undefined ? hostAiButton : props.onContextualCommand && <QuickBarAiButton targetLabel={contextualTarget.label} disabledReason={quickBarIssue}
        instruction={contextualInstruction} onInstructionChange={value => { instructionRef.current = value; setContextualInstruction(value) }}
        onSubmit={sendContextualInstruction} onCancel={dismissContextualTarget}
        footer={manualTarget.current && manualTarget.current !== contextualTarget ? <button type="button" onClick={rebindToCurrentSelection}>改为当前选择</button> : null} />}
      {props.renderQuickBarMenu?.(contextualTarget)}
      {commandError && <span role="alert" className="selection-quick-bar__notice" title={commandError}>{commandError}</span>}
    </SelectionQuickBar>
  async function completeFlowInput() {
    const editor = layout.current
    if (!flowObjectSelection || !editor?.isInputActive() || editor.view.composing) return
    const point = editorPositionToPoint(editor.view.state.doc, editor.view.state.selection.head)
    const generation = inputGeneration.current
    if (!point || !(await editor.drain()) || layout.current !== editor || generation !== inputGeneration.current || !editor.isInputActive()) return
    editor.selectBlock(point.blockId)
  }
  function startFlowObjectDrag(id:string) {
    const editor=layout.current,owner=latest.current.objectLayout,info=owner?.read(id)
    if(!editor||!owner||!info){flowDrag.current=null;return}
    const nodes=[...editor.view.dom.querySelectorAll<HTMLElement>('[data-flow-block-id]')]
    const source=nodes.find(node=>node.dataset.flowBlockId===id),rect=source?.getBoundingClientRect()
    if(!source||!rect)return
    const scale=source.offsetWidth>0?rect.width/source.offsetWidth:1
    flowDrag.current={sourceId:id,rects:new Map(nodes.map(node=>[node.dataset.flowBlockId!,node.getBoundingClientRect()])),widthPercent:info.widthPercent,
      height:rect.height/Math.max(.001,scale),commit:owner.begin(id).catch(error=>{fail(String(error));return null}),preview:null}
  }
  function clearFlowObjectPreview(){if(layout.current)showFlowObjectDropPreview(layout.current.view,null)}
  function previewFlowObjectDrop(sourceId:string,target:DocumentBlockDropTarget|null,point:{x:number;y:number}):DocumentBlockDropTarget|null {
    const drag=flowDrag.current,editor=layout.current
    if(!drag||drag.sourceId!==sourceId||!editor||!target)return target
    const element=editor.view.dom.querySelector<HTMLElement>('[data-flow-block-id="'+CSS.escape(target.targetId)+'"]'),bounds=drag.rects.get(target.targetId)
    let wrap:'none'|'left'|'right'='none',side=target.side
    if(element&&bounds&&element.matches('p,h1,h2,h3,h4,h5,h6,blockquote')&&point.y>=bounds.top-12&&point.y<=bounds.bottom+12){
      const relative=(point.x-bounds.left)/Math.max(1,bounds.width)
      if(relative<.32)wrap='left';else if(relative>.68)wrap='right'
      if(wrap!=='none')side='before'
    }
    const widthPercent=drag.widthPercent??(wrap==='none'?100:48)
    // A narrow lane uses the same standalone-row rule as the final projection.
    const laneWidth=(bounds?.width??target.width)/(element?.offsetWidth&&bounds?bounds.width/element.offsetWidth:1)
    if(wrap!=='none'&&laneWidth*(1-widthPercent/100)-20<160)wrap='none'
    const preview:FlowObjectDropPreview={sourceId,targetId:target.targetId,side,wrap,widthPercent:wrap==='none'&&drag.widthPercent===undefined?100:widthPercent,height:drag.height}
    drag.preview=preview;showFlowObjectDropPreview(editor.view,preview)
    return {...target,side}
  }
  function commitFlowObjectDrop(drag:NonNullable<typeof flowDrag.current>,preview:FlowObjectDropPreview):void {
    void drag.commit.then(async commit=>{if(commit)await commit({sourceId:drag.sourceId,targetId:preview.targetId,side:preview.side,wrap:preview.wrap,...(drag.widthPercent===undefined?{}:{widthPercent:drag.widthPercent})})}).catch(error=>fail(String(error)))
  }
  function beginBodyDrag(event: React.PointerEvent<HTMLDivElement>) {
    const editor = layout.current, target = event.target instanceof Element ? event.target : null
    if (!flowObjectSelection || mode !== 'layout' || props.active === false || props.readOnly || !editor || event.button !== 0
      || !target || !editor.view.dom.contains(target) || target.closest('[data-component-professional-editor]')) return
    const blockElement = target.closest<HTMLElement>('[data-flow-block-id]')
    const blockId = blockElement?.dataset.flowBlockId
    if (editor.isInputActive()) {
      if (!blockId || !target.closest('[data-component-render],[data-component-runtime-root],[data-component-instance]') || !latest.current.objectLayout?.read(blockId)) return
      event.preventDefault(); event.stopPropagation()
      acceptObjectPointer({ blockId, phase: 'start', pointerId: event.pointerId, point: { x: event.clientX, y: event.clientY }, button: event.button, modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey } })
      if (bodyDrag.current && blockElement) { bodyDrag.current.capture = latest.current.objectLayout?.read(blockId)?editor.view.dom:blockElement; bodyDrag.current.capture.setPointerCapture?.(event.pointerId) }
      return
    }
    if (!blockId || !editor.selectBlock(blockId)) return
    ++inputGeneration.current
    event.preventDefault(); event.stopPropagation()
    if (event.ctrlKey || event.metaKey || event.shiftKey || previewSelection() || props.blockMoveDisabledReason?.(blockId)) return
    // Capture the selected block itself, so click/double-click stays inside this PM.
    startFlowObjectDrag(blockId)
    const capture = flowDrag.current?editor.view.dom:blockElement!
    capture.setPointerCapture?.(event.pointerId)
    bodyDrag.current = { pointerId: event.pointerId, blockId, start: { x: event.clientX, y: event.clientY }, latest: { x: event.clientX, y: event.clientY }, moved: false, capture, ready: true, ended: false, canceled: false }
    draggedBlockContent.current = fromEditorDocument(editor.view.state.doc)
  }
  function updateBodyPointer(pointerId: number, point: { x: number; y: number }) {
    const drag = bodyDrag.current
    if (!drag || drag.pointerId !== pointerId) return
    drag.latest = point
    if (!drag.ready || drag.canceled || !drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 3) return
    drag.moved = true; draggingBlock.current = true
    const target=resolveBlockDrop(drag.blockId,point)
    setBlockDrop(previewFlowObjectDrop(drag.blockId,target,point))
  }
  function moveBodyDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (bodyDrag.current?.pointerId !== event.pointerId) return
    event.preventDefault(); event.stopPropagation()
    updateBodyPointer(event.pointerId, { x: event.clientX, y: event.clientY })
  }
  function finishBodyPointer(pointerId: number, point: { x: number; y: number }, cancel: boolean) {
    const drag = bodyDrag.current
    if (!drag || drag.pointerId !== pointerId) return
    drag.ended = true; drag.canceled ||= cancel; drag.latest = point
    if (!drag.ready) return
    if (!drag.canceled) updateBodyPointer(pointerId, point)
    const destination = !drag.canceled && drag.moved ? resolveBlockDrop(drag.blockId, point) : null
    const flow=flowDrag.current,flowPreview=flow?.preview
    clearFlowObjectPreview();flowDrag.current=null
    bodyDrag.current = null; draggingBlock.current = false; draggedBlockContent.current = null; setBlockDrop(null)
    if (drag.capture?.hasPointerCapture?.(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId)
    if (!destination || !layout.current) return
    if(flow&&flowPreview&&!drag.canceled){commitFlowObjectDrop(flow,flowPreview);return}
    try {
      const content = fromEditorDocument(layout.current.view.state.doc)
      applyDocumentContent(applyDocumentBlockCommand(content, { action: 'move', blockId: drag.blockId, targetId: destination.targetId, side: destination.side }))
      layout.current.selectBlock(drag.blockId)
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  function finishBodyDrag(event?: React.PointerEvent<HTMLDivElement>, cancel = false) {
    const drag = bodyDrag.current
    if (drag) finishBodyPointer(event?.pointerId ?? drag.pointerId, event ? { x: event.clientX, y: event.clientY } : drag.latest, cancel)
  }
  function acceptObjectPointer(input: DocumentObjectPointer) {
    const editor = layout.current
    if (!flowObjectSelection || mode !== 'layout' || props.active === false || props.readOnly || !editor) return
    if (input.phase !== 'start') {
      if (input.phase === 'update') updateBodyPointer(input.pointerId, input.point)
      else finishBodyPointer(input.pointerId, input.point, input.phase === 'cancel')
      return
    }
    if (input.button && input.button !== 0) return
    finishBodyDrag(undefined, true)
    ++inputGeneration.current
    const drag = { pointerId: input.pointerId, blockId: input.blockId, start: input.point, latest: input.point, moved: false, capture: null, ready: false, ended: false, canceled: false }
    bodyDrag.current = drag
    const activate = (ready: boolean) => {
      if (bodyDrag.current !== drag || layout.current !== editor) return
      if (!ready || drag.canceled || !editor.selectBlock(input.blockId)) { bodyDrag.current = null; return }
      drag.ready = true
      startFlowObjectDrag(input.blockId)
      draggedBlockContent.current = fromEditorDocument(editor.view.state.doc)
      if (input.modifiers?.ctrl || input.modifiers?.meta || input.modifiers?.shift || previewSelection() || props.blockMoveDisabledReason?.(input.blockId)) { bodyDrag.current = null; return }
      updateBodyPointer(drag.pointerId, drag.latest)
      if (drag.ended) finishBodyPointer(drag.pointerId, drag.latest, false)
    }
    if (editor.isInputActive()) void editor.drain().then(activate)
    else activate(true)
  }
  function enterBodyInput(event: React.MouseEvent<HTMLDivElement>) {
    const editor = layout.current, target = event.target instanceof Element ? event.target : null
    if (!flowObjectSelection || mode !== 'layout' || props.active === false || props.readOnly || !editor || editor.isInputActive() || !target || !editor.view.dom.contains(target) || target.closest('[data-component-render]')) return
    event.preventDefault(); event.stopPropagation(); finishBodyDrag(undefined, true)
    ++inputGeneration.current
    const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
    let position = hit?.pos
    if (position === undefined) {
      const selected = editor.view.state.selection
      if (selected instanceof NodeSelection) position = selected.from + 1
    }
    if (position === undefined) return
    const selection = TextSelection.near(editor.view.state.doc.resolve(position))
    if (!(selection instanceof TextSelection)) return
    editor.setInputActive(true)
    editor.view.dispatch(editor.view.state.tr.setSelection(selection))
    editor.view.focus()
  }
  function resolveBlockDrop(sourceId: string, point: { x: number; y: number }) {
    const view = layout.current?.view
    if (!view || props.readOnly || mode !== 'layout') return null
    const paper = view.dom.closest('.flow-paper') ?? view.dom
    if (point.y < paper.getBoundingClientRect().top) return null
    return documentBlockDropTarget(draggedBlockContent.current ?? fromEditorDocument(view.state.doc), view.dom, sourceId, point,flowDrag.current?.sourceId===sourceId?flowDrag.current.rects:undefined)
  }
  type BlockDragEvent = Pick<DragEvent, 'dataTransfer' | 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>
  function overBlock(event: BlockDragEvent) {
    if (props.active === false || !documentScope || !event.dataTransfer?.types.includes(DOCUMENT_BLOCK_DRAG_MIME)) return
    event.preventDefault(); event.stopPropagation()
    if (props.readOnly || mode !== 'layout') return
    event.dataTransfer.dropEffect = 'move'
    // Chromium protects transfer data until drop; retain the source at dragstart.
    const sourceId = draggedBlockId.current
    const point={x:event.clientX,y:event.clientY}
    const next = sourceId ? previewFlowObjectDrop(sourceId,resolveBlockDrop(sourceId,point),point) : null
    setBlockDrop(previous => previous && next && previous.targetId === next.targetId && previous.side === next.side
      && previous.left === next.left && previous.top === next.top && previous.width === next.width ? previous : next)
  }
  function dropBlock(event: BlockDragEvent) {
    if (props.active === false || !documentScope || !event.dataTransfer?.types.includes(DOCUMENT_BLOCK_DRAG_MIME)) return
    event.preventDefault(); event.stopPropagation()
    const flow=flowDrag.current,flowPreview=flow?.preview
    clearFlowObjectPreview();flowDrag.current=null
    setBlockDrop(null); draggingBlock.current = false; draggedBlockId.current = null; draggedBlockContent.current = null
    if (props.readOnly || mode !== 'layout') return
    const sourceId = documentBlockDragId(event.dataTransfer)
    const target = sourceId ? resolveBlockDrop(sourceId, { x: event.clientX, y: event.clientY }) : null
    if (!sourceId || !target || !layout.current) return
    if(flow&&flowPreview){commitFlowObjectDrop(flow,flowPreview);return}
    try {
      const content = fromEditorDocument(layout.current.view.state.doc)
      applyDocumentContent(applyDocumentBlockCommand(content, { action: 'move', blockId: sourceId, targetId: target.targetId, side: target.side }))
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }
  blockDragHandlers.current = { over: overBlock, drop: dropBlock }
  useEffect(() => {
    // Flow's blank paper extends beyond the PM root. Route it to the same paragraph owner.
    const paper = editorRoot.current?.closest('.flow-paper')
    if (!paper) return
    const over = (event: Event) => blockDragHandlers.current?.over(event as DragEvent)
    const drop = (event: Event) => blockDragHandlers.current?.drop(event as DragEvent)
    paper.addEventListener('dragover', over, true); paper.addEventListener('drop', drop, true)
    return () => { paper.removeEventListener('dragover', over, true); paper.removeEventListener('drop', drop, true) }
  }, [mode])
  return <div ref={attachRoot} inert={props.active === false} data-document-selection-active={props.contextualCardSuppressed ? 'false' : 'true'}
    onPointerDownCapture={event => {
      ++inputGeneration.current
      beginBodyDrag(event)
      if (outsidePointerFrame.current !== null) { cancelAnimationFrame(outsidePointerFrame.current); outsidePointerFrame.current = null }
    }}
    onPointerMoveCapture={moveBodyDrag}
    onPointerUpCapture={event => finishBodyDrag(event)}
    onPointerCancelCapture={event => finishBodyDrag(event, true)}
    onLostPointerCapture={event => finishBodyDrag(event, true)}
    onDoubleClickCapture={enterBodyInput}
    onClickCapture={event => { const editor = layout.current; if (flowObjectSelection && event.target instanceof Element && editor?.view.dom.contains(event.target) && (!editor.isInputActive() || event.target.closest('[data-component-render]')) && !event.target.closest('[data-component-professional-editor]')) { event.preventDefault(); event.stopPropagation() } }}
    onFocusCapture={() => { ++focusGeneration.current; interactionFocused.current = true; if (layout.current) updateActiveBlock(layout.current.view.state) }}
    onBlurCapture={() => {
      const generation = ++focusGeneration.current
      // Keep the handle mounted while the browser transfers focus to it or an owned portal.
      // Flow publishes its selection synchronously on blur, before the next focus event.
      requestAnimationFrame(() => {
        if (generation !== focusGeneration.current || draggingBlock.current) return
        interactionFocused.current = false; setActiveBlock(null)
      })
    }}
    onDragOverCapture={overBlock}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setBlockDrop(null) }}
    onDragEndCapture={() => { clearFlowObjectPreview();flowDrag.current=null;draggingBlock.current = false; draggedBlockId.current = null; draggedBlockContent.current = null; setBlockDrop(null); if (layout.current) updateActiveBlock(layout.current.view.state) }}
    onDropCapture={dropBlock}
    onContextMenu={event => {
      if (props.active === false || props.readOnly || mode !== 'layout') return
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-flow-block-id]')
      const id = target?.dataset.flowBlockId
      if (!id || !layout.current) return
      layout.current.syncDomTextSelection()
      const block = findDocumentBlock(fromEditorDocument(layout.current.view.state.doc).blocks, id)
      if (!block) return
      if (block.type === 'table') {
        event.preventDefault()
        const view = layout.current.view, selected = resolveDocumentTableEditorTarget(view.state)
        if (selected?.tableId !== id) {
          const hit = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (hit) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))))
        }
        openObjectMenu({ x: event.clientX, y: event.clientY }, '表格操作', [...activeTableMenu(), ...clipboardMenu()])
        return
      }
      if (['media', 'chart', 'component', 'course-component', 'course-instance', 'formula'].includes(block.type)) return
      event.preventDefault()
      openObjectMenu({ x: event.clientX, y: event.clientY }, documentScope ? '段落操作' : '文字操作', [...(documentScope ? activeBlockMenu(id) : []), ...clipboardMenu()])
    }}
    className={`shared-document-editor${props.target === 'flow' ? ' shared-document-editor--flow' : props.target === 'file' && documentScope ? ' shared-document-editor--file' : ''}`} onKeyDown={event => {
    if (props.active === false) return
    if (event.key === 'Escape' && flowDrag.current && !bodyDrag.current){event.preventDefault();event.stopPropagation();clearFlowObjectPreview();flowDrag.current=null;setBlockDrop(null);return}
    if (flowObjectSelection && event.key === 'Escape' && bodyDrag.current) { event.preventDefault(); event.stopPropagation(); finishBodyDrag(undefined, true); return }
    if (flowObjectSelection && (event.key === 'Escape' || event.key === 'Enter' && (event.ctrlKey || event.metaKey)) && layout.current?.isInputActive() && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); void completeFlowInput(); return }
    if (documentScope && event.key === 'Escape' && contextualTarget) { event.preventDefault(); setDismissedGeneration(targetGeneration) }
    if (documentScope && event.key === '/' && mode === 'layout' && !event.nativeEvent.isComposing && !props.readOnly && activeBlock && layout.current) {
      const selection = layout.current.view.state.selection
      if (selection.empty && selection.$from.parent.type === documentEditorSchema.nodes.paragraph && selection.$from.parent.content.size === 0) {
        event.preventDefault()
        slashReturn.current?.release();slashReturn.current=layout.current.trackSelection()
        openObjectMenu({ x: activeBlock.rect.left, y: activeBlock.rect.top + activeBlock.rect.height }, '插入段落',
          selectionInsertionMenu())
      }
    }
  }} onCompositionStartCapture={() => props.onCompositionChange?.(true, deferredLayoutSource && mode === 'layout' ? materializeSource() : draft.current)} onCompositionEndCapture={() => {
    // Capture runs before PM/CM schedule their terminal publication on the target.
    queueMicrotask(() => queueMicrotask(() => props.onCompositionChange?.(false, deferredLayoutSource && mode === 'layout' ? materializeSource() : draft.current)))
  }}>
     {props.active !== false && !props.readOnly && (props.toolbarHost ? createPortal(<>{toolbar}{editorForms}</>, props.toolbarHost) : <>{toolbar}{editorForms}</>)}
     {quickBar}
     {props.active !== false && objectMenu.element}
     {props.active !== false && formattingMenu.element}
     {props.active !== false && insertionFallback && <div role="alert" className="shared-document-more__mode-notice">{insertionFallback.message}
       <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertAtSelection(insertionFallback.kind, insertionFallback.blockId)}>在所在块下方插入</button>
       <button type="button" onClick={() => setInsertionFallback(null)}>取消</button>
     </div>}
     {props.active !== false && blockDrop && !flowDrag.current?.preview && createPortal(<div className="document-block-drop-indicator" style={{ left: blockDrop.left, top: blockDrop.top, width: blockDrop.width }} />, window.document.body)}
      {props.active !== false && documentScope && mode === 'layout' && !props.readOnly && activeBlock && <DocumentBlockHandle blockId={activeBlock.id} rect={activeBlock.rect} commands={activeBlockMenu(activeBlock.id)} disabledReason={previewSelection() ? '正在生成的范围暂时只读' : props.blockMoveDisabledReason?.(activeBlock.id) ?? null} onDragStart={id => { startFlowObjectDrag(id);draggingBlock.current = true; draggedBlockId.current = id; if (layout.current) draggedBlockContent.current = fromEditorDocument(layout.current.view.state.doc) }} />}
     {props.active !== false && allPreviews.length > 0 && <div className="document-generation-status" role="status">{allPreviews.length} 处正文正在生成，生成部分尚未保存。{allPreviews.map((preview, index) => <button key={preview.editId} type="button" aria-label={`停止生成第 ${index + 1} 处`} onClick={preview.cancel}>停止生成 {index + 1}</button>)}{commandError && <span role="alert">{commandError}</span>}</div>}
    {diagnostics.length > 0 && <ul role="alert" aria-label="源文问题">{diagnostics.map((diagnostic, index) => <li key={index}><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => locateDiagnostic(diagnostic)}>第 {diagnostic.line} 行，第 {diagnostic.column} 列：{diagnostic.message}</button></li>)}</ul>}
     {mode === 'layout' ? <div ref={layoutHost} /> : <div ref={sourceHost} />}
  </div>
})
