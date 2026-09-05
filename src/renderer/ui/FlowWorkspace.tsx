import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { FormulaAstNode, TextRun } from '../../shared/contracts/native-v1'
import type { AssetMeta } from '../../shared/contracts/media-v1'
import type { FlowBlock } from '../../shared/courseProjectTypes'
import {
  FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY,
  FLOW_MEDIA_INLINE_SIZE_REFERENCE,
  FLOW_MEDIA_QUERY_CONTAINER_TYPE,
  resolveFlowMediaLayoutProjection,
} from '../../shared/flowMediaLayout'
import {
  assertActiveFlowEditorView,
  captureFlowEditorAuthoringTarget,
  type FlowBlockView,
  type FlowEditorView,
} from '../course/flowEditorView'
import type { FlowEditorSelection } from '../course/flowEditorSlice'
import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTarget,
} from '../authoring/courseAuthoringSession'
import { STAGE_VIEWPORT_HEIGHT, STAGE_VIEWPORT_WIDTH } from '../authoring/stageViewportTransform'
import {
  buildFlowRichTextHtml,
  cellToRichText,
  clearFlowTextEditRangeStyle,
  deriveFlowSelectionFormat,
  extractFlowRichTextFromEditor,
  finishFlowTextComposition,
  FLOW_PAPER_TEXT_COLOR,
  flowFormulaBlockToAuthoringNode,
  logicalFlowSelectionOffsets,
  markFlowTextComposing,
  resolveFlowTextKeyDown,
  restoreFlowLogicalSelection,
  toggleFlowTextEditEmphasis,
  toggleFlowTextEditRunStyle,
  updateFlowTextDraft,
  updateFlowTextRange,
  type FlowFormulaDraft,
  type FlowTextEditSession,
} from '../authoring/flowTextEdit'
import { FormulaEditDialog } from './FormulaEditDialog'
import { PublishedFormulaPaint } from './PublishedFormulaPaint'
import {
  FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET,
  FlowBlockContextToolbar,
  type FlowBlockContextCommand,
} from './FlowBlockContextToolbar'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../player/surfaces/publishedComponentMount'
import type { ComponentPackageData } from '../../shared/componentTypes'
import {
  isFlowSelectionPreservingFocusTarget,
  useFlowTextAuthoringController,
  type FlowCurrentSessionCommandPort,
} from './flow/useFlowTextAuthoringController'
import { FlowOverlayAuthoringLayer } from './flow/FlowOverlayAuthoringLayer'

export interface FlowWorkspaceProps {
  readonly view: FlowEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly selection: FlowEditorSelection | null
  readonly textEdit: FlowTextEditSession | null
  readonly previewTextEdit?: FlowTextEditSession | null
  readonly commands: FlowCurrentSessionCommandPort
  readonly readOnly?: boolean
  readonly assetFiles?: Record<string, Uint8Array>
  readonly componentPackages?: Record<string, ComponentPackageData>
}

export function FlowInlineRichTextEditor({
  blockId,
  label,
  text,
  runs,
  preview,
  restyleToken,
  range,
  composing,
  onDraftChange,
  onRangeChange,
  onComposingChange,
  onCommit,
  onCancel,
  onKeyAction,
}: {
  readonly blockId: string
  readonly label: string
  readonly text: string
  readonly runs: readonly TextRun[]
  readonly preview?: { readonly text: string; readonly runs: readonly TextRun[] } | null
  readonly restyleToken: number
  readonly range: { start: number; end: number }
  readonly composing: boolean
  readonly onDraftChange: (
    text: string,
    runs: TextRun[],
    offsets: { start: number; end: number } | null,
  ) => void
  readonly onRangeChange: (offsets: { start: number; end: number }) => void
  readonly onComposingChange: (composing: boolean) => void
  readonly onCommit: () => void
  readonly onCancel: () => void
  readonly onKeyAction: (event: ReactKeyboardEvent<HTMLElement>) => void
}) {
  const editorRef = useRef<HTMLElement>(null)
  const initializedRef = useRef(false)
  const composingRef = useRef(composing)
  const finishedRef = useRef(false)
  const blurReadyRef = useRef(false)
  const lastRestyleRef = useRef(-1)
  const onRangeChangeRef = useRef(onRangeChange)
  composingRef.current = composing
  onRangeChangeRef.current = onRangeChange

  const read = (): { text: string; runs: TextRun[] } => editorRef.current
    ? extractFlowRichTextFromEditor(editorRef.current)
    : { text, runs: [...runs] }

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!initializedRef.current || lastRestyleRef.current !== restyleToken) {
      const html = buildFlowRichTextHtml(text, runs)
      editor.innerHTML = html || '<br data-flow-empty-placeholder="true">'
      lastRestyleRef.current = restyleToken
      initializedRef.current = true
      restoreFlowLogicalSelection(editor, range.start, range.end)
    }
    const timer = window.setTimeout(() => {
      if (finishedRef.current || !editor.isConnected) return
      editor.focus({ preventScroll: true })
      restoreFlowLogicalSelection(editor, range.start, range.end)
      blurReadyRef.current = true
    }, 0)
    return () => window.clearTimeout(timer)
  }, [restyleToken])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const ownerDocument = editor.ownerDocument
    const syncNativeRange = () => {
      if (composingRef.current || finishedRef.current) return
      const offsets = logicalFlowSelectionOffsets(editor)
      if (offsets) onRangeChangeRef.current(offsets)
    }
    ownerDocument.addEventListener('selectionchange', syncNativeRange)
    return () => ownerDocument.removeEventListener('selectionchange', syncNativeRange)
  }, [])

  return (
    <span style={{ display: 'block', position: 'relative' }}>
    <span
      ref={editorRef}
      className="flow-inline-editor"
      data-testid="flow-inline-editor"
      data-flow-inline-editor="true"
      data-flow-rich-text="true"
      data-flow-block-id={blockId}
      aria-label={label}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{
        outline: 'none',
        caretColor: '#1a1d24',
        display: 'block',
        width: '100%',
        minWidth: 0,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        minHeight: '1.4em',
        userSelect: 'text',
        WebkitUserSelect: 'text',
        cursor: 'text',
        color: FLOW_PAPER_TEXT_COLOR,
        opacity: preview ? 0 : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onInput={() => {
        const value = read()
        const offsets = editorRef.current ? logicalFlowSelectionOffsets(editorRef.current) : null
        onDraftChange(value.text, value.runs, offsets)
      }}
      onCompositionStart={() => {
        composingRef.current = true
        onComposingChange(true)
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        const value = read()
        const offsets = editorRef.current ? logicalFlowSelectionOffsets(editorRef.current) : null
        onDraftChange(value.text, value.runs, offsets)
        onComposingChange(false)
      }}
      onBlur={(event) => {
        if (isFlowSelectionPreservingFocusTarget(event.relatedTarget)) {
          return
        }
        if (!blurReadyRef.current) return
        onCommit()
      }}
      onKeyDown={(event) => {
        if (composingRef.current || event.nativeEvent.isComposing) return
        onKeyAction(event)
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          finishedRef.current = true
          onCancel()
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          finishedRef.current = true
          onCommit()
        }
      }}
    />
    {preview && <span aria-hidden="true" data-testid="flow-text-color-preview"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      dangerouslySetInnerHTML={{ __html: buildFlowRichTextHtml(preview.text, preview.runs) }} />}
    </span>
  )
}

function FlowPlainStringEditor({
  blockId,
  label,
  value,
  multiline,
  onChange,
  onComposingChange,
  onCommit,
  onCancel,
}: {
  blockId: string
  label: string
  value: string
  multiline: boolean
  onChange: (value: string) => void
  onComposingChange: (composing: boolean) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const composingRef = useRef(false)
  const shared = {
    className: 'flow-inline-plain-editor',
    'data-testid': 'flow-inline-plain-editor',
    'data-flow-block-id': blockId,
    'aria-label': label,
    value,
    autoFocus: true,
    onPointerDown: (event: ReactPointerEvent<HTMLInputElement | HTMLTextAreaElement>) => event.stopPropagation(),
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(event.currentTarget.value)
    },
    onCompositionStart: () => {
      composingRef.current = true
      onComposingChange(true)
    },
    onCompositionEnd: () => {
      composingRef.current = false
      onComposingChange(false)
    },
    onBlur: () => {
      if (composingRef.current) return
      onCommit()
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composingRef.current || event.nativeEvent.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      } else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        event.stopPropagation()
        onCommit()
      }
    },
  }
  if (multiline) {
    return <textarea {...shared} rows={4} />
  }
  return <input {...shared} />
}

function createFlowAssetObjectUrls(
  assets: Readonly<Record<string, AssetMeta>>,
  files: Record<string, Uint8Array>,
): Record<string, string> {
  const urls: Record<string, string> = {}
  if (typeof URL.createObjectURL !== 'function') return urls
  for (const [assetId, bytes] of Object.entries(files)) {
    const meta = assets[assetId]
    urls[assetId] = URL.createObjectURL(
      new Blob([Uint8Array.from(bytes)], { type: meta?.mimeType ?? 'application/octet-stream' }),
    )
  }
  return urls
}

function renderFlowPaperMedia(
  block: Extract<FlowBlock, { type: 'media' }>,
  assetUrls: Record<string, string>,
): ReactNode {
  const url = assetUrls[block.assetId]
  if (block.mediaKind === 'image') {
    return (
      <img
        data-flow-asset-id={block.assetId}
        data-flow-media-kind="image"
        {...(url ? { src: url } : {})}
        alt={block.altText ?? ''}
        style={{ maxWidth: '100%', display: 'block' }}
      />
    )
  }
  if (block.mediaKind === 'video') {
    return (
      <video
        data-flow-asset-id={block.assetId}
        data-flow-media-kind="video"
        {...(url ? { src: url } : {})}
        aria-label={block.altText ?? ''}
        controls
        muted
        playsInline
        preload="metadata"
        style={{ maxWidth: '100%', display: 'block' }}
      />
    )
  }
  return (
    <div className="flow-media-placeholder" data-flow-media-kind="audio">
      音频占位符
    </div>
  )
}


function FlowComponentBlockView({
  block,
  readingWidth,
  componentPackages,
  assetUrls,
}: {
  block: Extract<FlowBlock, { type: 'component' }>
  readingWidth: number
  componentPackages?: Record<string, ComponentPackageData>
  assetUrls: Record<string, string>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pkg = findComponentPackageSource(componentPackages, block.component.packageId, block.component.version)
  const fallbackUrl = block.staticFallbackAssetId ? assetUrls[block.staticFallbackAssetId] : undefined

  useEffect(() => {
    const el = containerRef.current
    if (!el || !pkg) return
    const handle = mountPublishedComponent(el, {
      container: el,
      componentId: block.component.packageId,
      version: block.component.version,
      instanceId: block.id,
      width: readingWidth,
      height: 320,
      props: block.props,
      staticFallbackAssetId: block.staticFallbackAssetId,
      components: componentPackages,
      resolveAsset: (id) => assetUrls[id],
      mode: 'edit',
      interactive: false,
    })
    return () => handle.destroy()
  }, [block.component.packageId, block.component.version, block.id, block.props, block.staticFallbackAssetId, componentPackages, assetUrls, readingWidth, pkg])

  if (!pkg) {
    return (
      <aside
        data-flow-component-package-id={block.component.packageId}
        data-flow-component-version={block.component.version}
      >
        {fallbackUrl ? (
          <img
            src={fallbackUrl}
            data-flow-static-fallback-asset-id={block.staticFallbackAssetId}
            alt={`${block.component.packageId} 后备`}
            style={{ maxWidth: '100%', display: 'block' }}
          />
        ) : null}
        <strong>互动组件：{block.component.packageId}</strong>
        <p>版本 {block.component.version}</p>
      </aside>
    )
  }

  return (
    <div
      ref={containerRef}
      data-flow-component-package-id={block.component.packageId}
      data-flow-component-version={block.component.version}
      style={{ width: '100%', minHeight: 320, position: 'relative' }}
    />
  )
}


function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('[data-flow-rich-text="true"]') ||
    target.closest('[data-flow-plain-text="true"]') ||
    target.closest('h1,h2,h3,h4,h5,h6,p,blockquote,li,td,th,code,pre,summary'),
  )
}

function isFormulaEditTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest('[data-flow-formula-edit-target="true"]'),
  )
}

function headingTag(level: 1 | 2 | 3 | 4 | 5 | 6): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  return (`h${level}`) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
}

function flowPaperBlockTypographyStyle(block: FlowBlock): CSSProperties | undefined {
  if (block.type !== 'heading' && block.type !== 'paragraph' && block.type !== 'quote') return undefined
  const style: CSSProperties = {}
  if (block.textAlign) style.textAlign = block.textAlign
  if (block.lineSpacing !== undefined) style.lineHeight = String(1.6 + block.lineSpacing / 16)
  return Object.keys(style).length > 0 ? style : undefined
}

function blockLabel(block: FlowBlock): string {
  if (block.type === 'heading') return '编辑标题文本'
  if (block.type === 'quote') return '编辑引用文本'
  if (block.type === 'list') return '编辑列表项文本'
  if (block.type === 'table') return '编辑表格单元格'
  if (block.type === 'code') return '编辑代码'
  if (block.type === 'callout') return '编辑提示正文'
  if (block.type === 'section') return '编辑分节标题'
  return '编辑段落文本'
}

export function FlowWorkspace({
  view,
  sessionToken,
  assets,
  selection,
  textEdit,
  previewTextEdit,
  commands,
  readOnly = false,
  assetFiles = {},
  componentPackages = {},
}: FlowWorkspaceProps) {
  assertActiveFlowEditorView(view)
  const paperRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const workspaceMeasureRef = useRef<HTMLDivElement>(null)
  const blockDragTargetRef = useRef<{
    readonly target: CourseAuthoringTarget
    readonly expectedEdit: FlowTextEditSession | null
  } | null>(null)
  const [toolbarPlacement, setToolbarPlacement] = useState<'top' | 'below'>('below')
  const toolbarSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const [paperScrollTop, setPaperScrollTop] = useState(0)
  const [overlayViewportSize, setOverlayViewportSize] = useState({
    width: STAGE_VIEWPORT_WIDTH,
    height: STAGE_VIEWPORT_HEIGHT,
  })
  const locationId = selection?.locationId ?? view.locationId
  const sidecarFiles = assetFiles
  const assetUrls = useMemo(
    () => createFlowAssetObjectUrls(assets, sidecarFiles),
    [assets, sidecarFiles],
  )

  const {
    edit,
    editRef,
    restyleToken,
    restyleRange,
    formulaBlockId,
    setFormulaBlockId,
    bumpRestyle,
    adoptEditReceipt,
    setEditState,
    commitCurrent,
    cancelCurrent,
    enterText,
    openFormula,
    updateFormulaDraft,
    setFormulaComposing,
    commitFormula,
    handleHistoryKey,
  } = useFlowTextAuthoringController({
    view,
    sessionToken,
    selection,
    readOnly,
    textEdit,
    workspaceRef: workspaceMeasureRef,
    commands,
  })

  useEffect(() => () => {
    if (typeof URL.revokeObjectURL !== 'function') return
    for (const url of Object.values(assetUrls)) URL.revokeObjectURL(url)
  }, [assetUrls])

  useLayoutEffect(() => {
    const node = workspaceMeasureRef.current
    if (!node) return
    const update = () => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setOverlayViewportSize({ width: rect.width, height: rect.height })
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!edit || !scrollRef.current) return
    const block = scrollRef.current.querySelector(`[data-flow-block-id="${edit.blockId}"]`)
    if (!(block instanceof HTMLElement) || !scrollRef.current) return
    const update = () => {
      const scrollRect = scrollRef.current!.getBoundingClientRect()
      const blockRect = block.getBoundingClientRect()
      const hasLayout = scrollRect.height > 0 && blockRect.height > 0
      setToolbarPlacement(
        hasLayout && scrollRect.bottom - blockRect.bottom < FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET
          ? 'top'
          : 'below',
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scrollRef.current)
    scrollRef.current.addEventListener('scroll', update)
    return () => {
      observer.disconnect()
      scrollRef.current?.removeEventListener('scroll', update)
    }
  }, [edit?.blockId])

  useLayoutEffect(() => {
    const blockId = selection?.selectedBlockId
    if (!blockId || !scrollRef.current) return
    const block = scrollRef.current.querySelector(`[data-flow-block-id="${blockId}"]`)
    if (!(block instanceof HTMLElement) || typeof block.scrollIntoView !== 'function') return
    block.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selection?.selectedBlockId])

  const targetForBlock = (blockId: string): CourseAuthoringTarget => (
    captureFlowEditorAuthoringTarget({
      view,
      sessionToken,
      target: { kind: 'block', blockId },
    })
  )

  const selectBlock = (blockId: string, event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly) return
    event.stopPropagation()
    if (selection?.authoringScope === 'global') return
    if (editRef.current && editRef.current.blockId !== blockId) {
      commitCurrent(false, blockId)
      return
    }
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      selection?.focus === 'block' &&
      selection.selectedBlockId === blockId &&
      isFormulaEditTarget(event.target)
    ) {
      openFormula(blockId)
      return
    }
    if (
      selection?.focus === 'block' &&
      selection.selectedBlockId === blockId &&
      isTextTarget(event.target)
    ) {
      enterText(blockId, 'click-text')
      return
    }
    const ids = (() => {
      if (event.ctrlKey || event.metaKey) {
        const current = selection?.selectedBlockIds ?? []
        return current.includes(blockId)
          ? current.filter((id) => id !== blockId)
          : [...current, blockId]
      }
      if (event.shiftKey && selection?.selectedBlockId) {
        const order = view.blocks.map((entry) => entry.blockId)
        const from = order.indexOf(selection.selectedBlockId)
        const to = order.indexOf(blockId)
        if (from >= 0 && to >= 0) {
          return order.slice(Math.min(from, to), Math.max(from, to) + 1)
        }
      }
      return [blockId]
    })()
    if (ids.length === 0) return
    commands.run(targetForBlock(blockId), { kind: 'select-blocks', blockIds: ids })
  }

  const handlePaperClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (editRef.current) commitCurrent(false)
  }

  const handleBlockKeyDown = (blockId: string, event: ReactKeyboardEvent<HTMLElement>) => {
    if (readOnly || selection?.authoringScope === 'global') return
    if (editRef.current) return
    if (event.key === 'Enter') {
      event.preventDefault()
      enterText(blockId, 'enter')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selection) return
      event.preventDefault()
      event.stopPropagation()
      commands.run(targetForBlock(blockId), {
        kind: 'delete-blocks',
        blockIds: selection.selectedBlockIds,
        direction: event.key === 'Backspace' ? 'backward' : 'forward',
      })
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const order = view.blocks.map((entry) => entry.blockId)
      const index = order.indexOf(blockId)
      const nextIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
      const nextId = order[nextIndex]
      if (nextId) {
        commands.run(targetForBlock(nextId), { kind: 'select-blocks', blockIds: [nextId] })
      }
    }
  }

  const applyToolbarCommand = (command: FlowBlockContextCommand) => {
    const blockId = selection?.selectedBlockId
    if (!selection || !blockId) return
    const target = targetForBlock(blockId)
    const current = editRef.current
    const captured = toolbarSelectionRef.current
    // Native controls can emit a second commit while React replaces or blurs
    // them (the number input does this after Enter). Keep the pointer-captured
    // editor range for the whole toolbar interaction so that follow-up event
    // cannot silently turn a real range operation into a caret operation. The
    // next toolbar pointer-down always replaces this value with the live DOM
    // selection.
    if (current && captured) setEditState(updateFlowTextRange(current, captured))
    const live = editRef.current

    if (command.type === 'range-style' || command.type === 'range-color' || command.type === 'range-highlight') {
      if (live && command.type === 'range-style') {
        const key = command.style.bold !== undefined
          ? 'bold' as const
          : command.style.italic !== undefined
            ? 'italic' as const
            : command.style.underline !== undefined
              ? 'underline' as const
              : command.style.strike !== undefined
                ? 'strike' as const
                : null
        if (key) {
          const next = toggleFlowTextEditRunStyle(live, key, live.range)
          setEditState(next)
          bumpRestyle(next.range)
          return
        }
      }
      const style = command.type === 'range-style'
        ? command.style
        : command.type === 'range-color'
          ? { color: command.color }
          : { highlightColor: command.color }
      const receipt = commands.run(target, {
        kind: 'format-text-style',
        style,
        expectedEdit: live,
      })
      if (receipt.ok && receipt.edit) {
        // The command port writes the Store synchronously, but the hook's
        // prop/effect mirror is updated after this browser event. Adopt the
        // receipt now so a native change/blur/click sequence cannot apply its
        // next style to the preceding draft and discard earlier formatting.
        adoptEditReceipt(receipt.edit)
        bumpRestyle(receipt.edit.range)
      }
      return
    }
    if (command.type === 'range-emphasis' && live) {
      const next = toggleFlowTextEditEmphasis(live, live.range)
      setEditState(next)
      bumpRestyle(next.range)
      return
    }
    if (command.type === 'range-clear' && live) {
      const next = clearFlowTextEditRangeStyle(live, live.range)
      setEditState(next)
      bumpRestyle(next.range)
      return
    }
    if (command.type === 'heading-level') {
      commands.run(target, {
        kind: 'format-block',
        spec: { kind: 'heading-level', level: command.level },
        expectedEdit: live,
      })
      return
    }
    if (command.type === 'convert-heading') {
      commands.run(target, {
        kind: 'format-block',
        spec: { kind: 'convert-heading', level: command.level },
        expectedEdit: live,
      })
      return
    }
    if (command.type === 'convert-paragraph') {
      commands.run(target, {
        kind: 'format-block',
        spec: { kind: 'convert-paragraph' },
        expectedEdit: live,
      })
      return
    }
    if (command.type === 'list-ordered') {
      commands.run(target, {
        kind: 'format-block',
        spec: { kind: 'list-ordered', ordered: command.ordered },
        expectedEdit: live,
      })
      return
    }
    if (command.type === 'indent' || command.type === 'outdent') {
      commands.run(target, {
        kind: 'execute-editor-command',
        blockIds: selection.selectedBlockIds,
        command: { name: command.type },
        expectedEdit: live,
      })
      return
    }
    if (command.type === 'move') {
      commands.run(target, {
        kind: 'move-block',
        direction: command.direction,
        expectedEdit: live,
      })
      return
    }
    if (command.type === 'delete') {
      commands.run(target, {
        kind: 'delete-blocks',
        blockIds: selection.selectedBlockIds,
        expectedEdit: live,
      })
    }
  }

  const formulaBlock = formulaBlockId
    ? view.blocks.find((entry) => entry.blockId === formulaBlockId)?.block
    : undefined
  const formulaNode = formulaBlock?.type === 'formula'
    ? flowFormulaBlockToAuthoringNode({
        id: formulaBlock.id,
        formulaId: formulaBlock.formulaId,
        accessibleText: formulaBlock.accessibleText,
        ast: formulaBlock.ast as FormulaAstNode,
      })
    : null
  const formulaDraft = edit?.kind === 'formula' && edit.blockId === formulaBlockId
    ? edit.draft as FlowFormulaDraft
    : null

  const childrenByParent = new Map<string | null, FlowBlockView[]>()
  for (const blockView of view.blocks) {
    const siblings = childrenByParent.get(blockView.parentId)
    if (siblings) siblings.push(blockView)
    else childrenByParent.set(blockView.parentId, [blockView])
  }
  const flowMediaWidths = {
    readingWidth: view.layout.readingWidth,
    wideContentWidth: view.layout.wideContentWidth,
  }

  const renderBlock = (blockView: FlowBlockView): ReactNode => {
    const block = blockView.block as FlowBlock
    const selected = selection?.selectedBlockIds.includes(blockView.blockId) ?? false
    const editingThis = edit?.blockId === blockView.blockId
    const showToolbar = selected && !readOnly
    const formulaEditingAvailable = !readOnly && selection?.authoringScope !== 'global'
    const richDraft = edit?.kind === 'rich-text' && editingThis
      ? edit.draft as { text: string; runs: TextRun[] }
      : null
    const selectionFormat = deriveFlowSelectionFormat({
      block,
      edit: editingThis ? edit : null,
    })
    const plainDraft = edit?.kind === 'plain-string' && editingThis
      ? (edit.draft as { text: string }).text
      : null
    const mediaProjection = block.type === 'media'
      ? resolveFlowMediaLayoutProjection(block.layout, flowMediaWidths)
      : null

    const isWrapLeft = (block.type === 'media' || block.type === 'component') && block.wrap === 'left'
    const isWrapRight = (block.type === 'media' || block.type === 'component') && block.wrap === 'right'
    const effectiveToolbarPlacement = editingThis ? toolbarPlacement : 'below'
    const baseMarginBottom = isWrapLeft || isWrapRight ? 8 : 12
    const toolbarMarginReserve = showToolbar && effectiveToolbarPlacement === 'below'
      ? FLOW_BLOCK_CONTEXT_TOOLBAR_BELOW_OFFSET
      : 0

    const frameStyle: CSSProperties = {
      position: 'relative' as const,
      outline: selected ? '2px solid #5b9cff' : undefined,
      boxShadow: selected ? 'inset 4px 0 0 #5b9cff' : undefined,
      padding: '12px 16px',
      margin: '0 0 12px',
      ...(isWrapLeft
        ? {
            float: 'left',
            width: mediaProjection?.wrappedOuterInlineSize ?? '48%',
            margin: '0 16px 8px 0',
          }
        : isWrapRight
          ? {
              float: 'right',
              width: mediaProjection?.wrappedOuterInlineSize ?? '48%',
              margin: '0 0 8px 16px',
            }
          : {}),
      marginBottom: baseMarginBottom + toolbarMarginReserve,
    }

    const frameProps = {
      'data-testid': `flow-block-${blockView.blockId}`,
      'data-flow-block-id': blockView.blockId,
      'data-flow-location-id': blockView.locationId ?? '',
      'data-flow-parent-id': blockView.parentId ?? '',
      'data-flow-block-index': blockView.index,
      'data-flow-block-parent': blockView.parentId ?? '',
      'data-flow-authoring-address': blockView.authoringAddress,
      'data-flow-layer-kind': 'document-block',
      className: `flow-block flow-block-${block.type}${selected ? ' flow-block--selected' : ''}`,
      'aria-selected': selected,
      tabIndex: selected && !editingThis ? 0 : -1,
      onClick: readOnly ? undefined : (event: ReactMouseEvent<HTMLElement>) => selectBlock(blockView.blockId, event),
      onDoubleClick: readOnly ? undefined : (event: ReactMouseEvent<HTMLElement>) => {
        event.stopPropagation()
        if (block.type === 'formula') {
          openFormula(blockView.blockId)
          return
        }
        if (block.type === 'list') {
          const itemId = event.currentTarget.getAttribute('data-flow-active-item') ??
            (event.target instanceof HTMLElement
              ? event.target.closest('li')?.getAttribute('data-flow-list-item-id')
              : null)
          enterText(blockView.blockId, 'double-click', { listItemId: itemId ?? block.items[0]?.id })
          return
        }
        if (block.type === 'table') {
          const cell = event.target instanceof HTMLElement ? event.target.closest('td,th') : null
          enterText(blockView.blockId, 'double-click', {
            tableRowId: cell?.getAttribute('data-flow-row-id') ?? block.rows[0]?.id,
            tableColumnId: cell?.getAttribute('data-flow-column-id') ?? block.columns[0]?.id,
          })
          return
        }
        enterText(blockView.blockId, 'double-click')
      },
      onKeyDown: readOnly ? undefined : (event: ReactKeyboardEvent<HTMLElement>) => {
        handleBlockKeyDown(blockView.blockId, event)
      },
      onDragOver: readOnly ? undefined : (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
      },
      onDrop: readOnly ? undefined : (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault()
        const sourceId = event.dataTransfer.getData('text/flow-block-id')
        if (!sourceId || sourceId === blockView.blockId) return
        const drag = blockDragTargetRef.current
        blockDragTargetRef.current = null
        if (!drag || drag.target.itemId !== sourceId) return
        commands.run(drag.target, {
          kind: 'execute-editor-command',
          blockIds: [sourceId],
          expectedEdit: drag.expectedEdit,
          command: {
            name: 'move',
            destination: {
              parentId: blockView.parentId,
              index: blockView.index,
              surfaceId: view.surfaceId,
            },
          },
        })
      },
      style: frameStyle,
    }

    const handleComposingChange = (composing: boolean) => {
      const current = editRef.current
      if (!current) return
      if (composing) {
        setEditState(markFlowTextComposing(current, true))
        return
      }
      const finished = finishFlowTextComposition(current)
      setEditState(finished.edit)
      if (finished.action === 'commit') commitCurrent(true)
      else if (finished.action === 'cancel') cancelCurrent()
    }

    const richEditor = (label: string, text: string, runs: readonly TextRun[]) => (
      <FlowInlineRichTextEditor
          blockId={blockView.blockId}
          label={label}
          text={richDraft?.text ?? text}
          runs={richDraft?.runs ?? runs}
          preview={previewTextEdit?.blockId === blockView.blockId && previewTextEdit.kind === 'rich-text'
            ? previewTextEdit.draft as { text: string; runs: TextRun[] } : null}
          restyleToken={restyleToken}
          range={restyleRange ?? edit?.range ?? { start: 0, end: 0 }}
          composing={edit?.composing ?? false}
          onDraftChange={(nextText, nextRuns, offsets) => {
            const current = editRef.current
            if (!current) return
            let next = updateFlowTextDraft(current, { text: nextText, runs: nextRuns })
            if (offsets) next = updateFlowTextRange(next, offsets, { preservePendingStyle: true })
            setEditState(next)
            if (Object.keys(next.pendingStyle).length > 0 && !current.composing) {
              bumpRestyle(next.range)
            }
          }}
          onRangeChange={(offsets) => {
            const current = editRef.current
            if (!current) return
            if (current.range.start === offsets.start && current.range.end === offsets.end) return
            setEditState(updateFlowTextRange(current, offsets))
          }}
          onComposingChange={handleComposingChange}
          onCommit={() => commitCurrent(true)}
          onCancel={cancelCurrent}
          onKeyAction={(event) => {
            const current = editRef.current
            if (!current) return
            resolveFlowTextKeyDown({
              kind: current.kind,
              composing: current.composing,
              isComposingEvent: event.nativeEvent.isComposing,
              key: event.key,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
            })
          }}
        />
    )

    const idleRichText = (text: string, runs: readonly TextRun[] = []) => (
      <span
        data-flow-idle-rich-text="true"
        dangerouslySetInnerHTML={{ __html: buildFlowRichTextHtml(text, runs) }}
      />
    )

    let body: ReactNode = null
    switch (block.type) {
      case 'heading': {
        const Tag = headingTag(block.level)
        body = (
          <Tag data-flow-rich-text="true" style={flowPaperBlockTypographyStyle(block)}>
            {editingThis && edit?.kind === 'rich-text'
              ? richEditor(blockLabel(block), block.text, block.runs ?? [])
              : idleRichText(block.text, block.runs ?? [])}
          </Tag>
        )
        break
      }
      case 'paragraph':
        body = (
          <p data-flow-rich-text="true" style={flowPaperBlockTypographyStyle(block)}>
            {editingThis && edit?.kind === 'rich-text'
              ? richEditor(blockLabel(block), block.text, block.runs ?? [])
              : idleRichText(block.text, block.runs ?? [])}
          </p>
        )
        break
      case 'quote':
        body = (
          <blockquote data-flow-rich-text="true" style={flowPaperBlockTypographyStyle(block)}>
            {editingThis && edit?.kind === 'rich-text'
              ? richEditor(blockLabel(block), block.text, block.runs ?? [])
              : <p>{idleRichText(block.text, block.runs ?? [])}</p>}
            {block.citation ? <cite>{block.citation}</cite> : null}
          </blockquote>
        )
        break
      case 'list': {
        const items = block.items.map((item) => {
          const editingItem = editingThis && edit?.listItemId === item.id
          return (
            <li
              key={item.id}
              data-flow-list-item-id={item.id}
              data-flow-rich-text="true"
              onDoubleClick={readOnly ? undefined : (event) => {
                event.stopPropagation()
                enterText(blockView.blockId, 'double-click', { listItemId: item.id })
              }}
            >
              {editingItem && edit?.kind === 'rich-text'
                ? richEditor(blockLabel(block), item.text, item.runs ?? [])
                : idleRichText(item.text, item.runs ?? [])}
            </li>
          )
        })
        body = block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
        break
      }
      case 'divider':
        body = <hr />
        break
      case 'media': {
        const projection = mediaProjection!
        const wrapped = isWrapLeft || isWrapRight
        body = (
          <figure
            className={`flow-block-media ${projection.className}`}
            data-flow-media-layout={block.layout}
            data-flow-media-width-tier={projection.tier}
            data-flow-media-inline-size={wrapped
              ? projection.wrappedInnerInlineSize
              : projection.inlineSize}
            {...(selected ? { 'data-flow-media-selected': 'true' } : {})}
            style={wrapped
              ? {
                  width: '100%',
                  maxWidth: '100%',
                  inlineSize: projection.wrappedInnerInlineSize,
                  maxInlineSize: '100%',
                  marginInline: 'auto',
                }
              : {
                  [FLOW_MEDIA_INLINE_SIZE_CUSTOM_PROPERTY]: projection.inlineSize,
                  width: FLOW_MEDIA_INLINE_SIZE_REFERENCE,
                  maxWidth: FLOW_MEDIA_INLINE_SIZE_REFERENCE,
                  position: 'relative',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  inlineSize: FLOW_MEDIA_INLINE_SIZE_REFERENCE,
                  maxInlineSize: FLOW_MEDIA_INLINE_SIZE_REFERENCE,
                  marginInline: 0,
                } as CSSProperties}
          >
            {renderFlowPaperMedia(block, assetUrls)}
            {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          </figure>
        )
        break
      }
      case 'table':
        body = (
          <table>
            {block.caption ? <caption>{block.caption}</caption> : null}
            <thead>
              <tr>
                {block.columns.map((column) => (
                  <th key={column.id} data-flow-column-id={column.id}>{column.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.id} data-flow-row-id={row.id}>
                  {block.columns.map((column) => {
                    const rich = cellToRichText(row.cells[column.id])
                    const editingCell = editingThis &&
                      edit?.tableRowId === row.id &&
                      edit.tableColumnId === column.id
                    return (
                      <td
                        key={column.id}
                        data-flow-column-id={column.id}
                        data-flow-row-id={row.id}
                        data-flow-rich-text="true"
                        onDoubleClick={readOnly ? undefined : (event) => {
                          event.stopPropagation()
                          enterText(blockView.blockId, 'double-click', {
                            tableRowId: row.id,
                            tableColumnId: column.id,
                          })
                        }}
                      >
                        {editingCell && edit?.kind === 'rich-text'
                          ? richEditor(blockLabel(block), rich.text, rich.runs ?? [])
                          : idleRichText(rich.text, rich.runs ?? [])}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )
        break
      case 'formula':
        body = (
          <div
            data-flow-formula-id={block.formulaId}
            data-flow-formula-edit-target="true"
            data-testid={`flow-formula-edit-target-${block.id}`}
            style={{
              position: 'relative',
              minHeight: 96,
              cursor: formulaEditingAvailable ? 'pointer' : undefined,
            }}
          >
            <PublishedFormulaPaint
              formulaId={block.formulaId}
              accessibleText={block.accessibleText}
              ast={block.ast as FormulaAstNode}
              style={{ fontSize: 32, color: '#1f2937', align: 'left' }}
              width={Math.max(160, view.layout.readingWidth)}
              height={96}
              pointerEvents={formulaEditingAvailable ? 'none' : 'auto'}
            />
            {formulaEditingAvailable ? (
              <button
                type="button"
                aria-label="编辑公式"
                data-testid={`flow-formula-edit-${block.id}`}
                title="打开公式编辑器"
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  padding: '4px 10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  background: '#ffffff',
                  color: '#334155',
                  cursor: 'pointer',
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  openFormula(blockView.blockId)
                }}
              >
                编辑公式
              </button>
            ) : null}
          </div>
        )
        break
      case 'code':
        body = (
          <pre data-flow-plain-text="true">
            {editingThis && edit?.field === 'code'
              ? (
                  <FlowPlainStringEditor
                    blockId={blockView.blockId}
                    label={blockLabel(block)}
                    value={plainDraft ?? block.code}
                    multiline
                    onChange={(value) => {
                      const current = editRef.current
                      if (!current) return
                      setEditState(updateFlowTextDraft(current, { text: value }))
                    }}
                    onComposingChange={handleComposingChange}
                    onCommit={() => commitCurrent(true)}
                    onCancel={cancelCurrent}
                  />
                )
              : <code {...(block.language ? { 'data-flow-language': block.language } : {})}>{block.code}</code>}
          </pre>
        )
        break
      case 'callout':
        body = (
          <aside data-flow-tone={block.tone} data-flow-plain-text="true">
            {block.title ? <strong>{block.title}</strong> : null}
            {editingThis && edit?.field === 'body'
              ? (
                  <FlowPlainStringEditor
                    blockId={blockView.blockId}
                    label={blockLabel(block)}
                    value={plainDraft ?? block.body}
                    multiline
                    onChange={(value) => {
                      const current = editRef.current
                      if (!current) return
                      setEditState(updateFlowTextDraft(current, { text: value }))
                    }}
                    onComposingChange={handleComposingChange}
                    onCommit={() => commitCurrent(true)}
                    onCancel={cancelCurrent}
                  />
                )
              : <p>{block.body}</p>}
          </aside>
        )
        break
      case 'section':
        body = (
          <details open={!block.collapsedByDefault}>
            <summary data-flow-plain-text="true">
              {editingThis && edit?.field === 'title'
                ? (
                    <FlowPlainStringEditor
                      blockId={blockView.blockId}
                      label={blockLabel(block)}
                      value={plainDraft ?? block.title}
                      multiline={false}
                      onChange={(value) => {
                        const current = editRef.current
                        if (!current) return
                        setEditState(updateFlowTextDraft(current, { text: value }))
                      }}
                      onComposingChange={handleComposingChange}
                      onCommit={() => commitCurrent(true)}
                      onCancel={cancelCurrent}
                    />
                  )
                : block.title}
            </summary>
            <div className="flow-section-content">
              {(childrenByParent.get(block.id) ?? []).map((child) => renderBlock(child))}
            </div>
          </details>
        )
        break
      case 'component': {
        body = (
          <div>
            <FlowComponentBlockView
              block={block}
              readingWidth={view.layout.readingWidth}
              componentPackages={componentPackages}
              assetUrls={assetUrls}
            />
          </div>
        )
        break
      }
    }

    return (
      <div key={blockView.blockId} {...frameProps}>
        {!readOnly && !edit ? (
          <button
            type="button"
            className="flow-block-drag-handle"
            data-testid={`flow-block-drag-${blockView.blockId}`}
            draggable
            aria-label="拖动排序"
            style={{
              position: 'absolute',
              left: 2,
              top: 12,
              width: 12,
              height: 20,
              cursor: 'grab',
              opacity: 0.4,
              padding: 0,
              border: 'none',
              background: 'transparent',
            }}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/flow-block-id', blockView.blockId)
              event.dataTransfer.effectAllowed = 'move'
              blockDragTargetRef.current = {
                target: targetForBlock(blockView.blockId),
                expectedEdit: editRef.current,
              }
            }}
          />
        ) : null}
        {showToolbar ? (
          <FlowBlockContextToolbar
            block={block}
            selectionFormat={selectionFormat}
            placement={effectiveToolbarPlacement}
            onPreserveSelection={() => {
              const editor = scrollRef.current?.querySelector('[data-testid="flow-inline-editor"]')
              if (editor instanceof HTMLElement) {
                toolbarSelectionRef.current = logicalFlowSelectionOffsets(editor)
              }
            }}
            onCommand={applyToolbarCommand}
          />
        ) : null}
        {body}
      </div>
    )
  }

  const rootBlocks = childrenByParent.get(null) ?? []
  const surfaceBackground = view.backgroundColor
  const backgroundImageUrl = view.backgroundAssetId ? assetUrls[view.backgroundAssetId] : undefined

  return (
    <div
      ref={workspaceMeasureRef}
      className="flow-workspace"
      data-testid="flow-workspace"
      data-flow-not-slide-stage="true"
      data-flow-project-id={view.projectId}
      data-flow-location-id={view.locationId}
      data-flow-surface-id={view.surfaceId}
      data-flow-active-block-id={view.activeBlockId}
      onKeyDown={handleHistoryKey}
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        minHeight: 320,
        overflow: 'hidden',
        isolation: 'isolate',
        backgroundColor: surfaceBackground,
        backgroundImage: backgroundImageUrl ? `url(${JSON.stringify(backgroundImageUrl)})` : undefined,
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover',
      }}
    >
      <FlowOverlayAuthoringLayer
        view={view}
        sessionToken={sessionToken}
        selection={selection}
        locationId={locationId}
        readOnly={readOnly}
        assetUrls={assetUrls}
        componentPackages={componentPackages}
        paperScrollTop={paperScrollTop}
        overlayViewportSize={overlayViewportSize}
        onBeforeGesture={() => {
          if (!editRef.current) return true
          commitCurrent(false)
          return false
        }}
        commands={commands}
      >
        <div
          ref={scrollRef}
          className="flow-workspace__scroll flow-media-query-root"
          data-testid="flow-workspace-scroll"
          data-flow-media-query-root="true"
          onScroll={(e) => {
            setPaperScrollTop(e.currentTarget.scrollTop)
          }}
          style={{
            flex: 1,
            position: 'relative',
            zIndex: 2,
            overflow: 'auto',
            height: '100%',
            padding: '24px 16px 48px',
            containerType: FLOW_MEDIA_QUERY_CONTAINER_TYPE,
            containerName: 'flow-media-root',
          }}
        >
          <article
            ref={paperRef}
            className="flow-paper"
            data-testid="flow-paper"
            data-flow-reading-width={view.layout.readingWidth}
            onClick={handlePaperClick}
            style={{
              width: '100%',
              maxWidth: view.layout.readingWidth,
              minHeight: '100%',
              margin: '0 auto',
              padding: '28px 36px 64px',
              background: 'transparent',
              color: FLOW_PAPER_TEXT_COLOR,
              boxShadow: '0 8px 32px rgba(15, 23, 42, 0.08)',
            }}
          >
            {rootBlocks.map((blockView) => renderBlock(blockView))}
            <div style={{ clear: 'both' }} aria-hidden="true" />
          </article>
        </div>
      </FlowOverlayAuthoringLayer>
      {formulaNode && formulaDraft ? (
        <FormulaEditDialog
          node={formulaNode}
          draftSource={formulaDraft.source}
          onDraftChange={updateFormulaDraft}
          onCompositionChange={setFormulaComposing}
          onCancel={() => {
            setFormulaBlockId(null)
            cancelCurrent()
          }}
          onCommit={(ast, accessibleText) => {
            commitFormula(ast, accessibleText)
          }}
        />
      ) : null}
    </div>
  )
}
