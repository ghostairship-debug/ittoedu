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
import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_NODE_SIZE } from '../../shared/constants'
import type { FormulaAstNode } from '../../shared/projectTypes'
import type { CourseProjectDocument, FlowBlock, LayerItem } from '../../shared/courseProjectTypes'
import { resolveCourseSurfaceBackgroundColor } from '../../shared/courseProjectModel'
import { constrainTeacherControllerAuthoringFrame } from '../../shared/teacherControllerLayout'
import type { FlowCommandResult } from '../course/flowEditorCommands'
import {
  executeFlowDelete,
  executeFlowEditorCommand,
} from '../course/flowEditorCommands'
import type { FlowBlockView, FlowEditorLayerView, FlowEditorView } from '../course/flowEditorView'
import {
  selectFlowEditorBlocks,
  selectFlowOverlay,
  type FlowEditorSelection,
} from '../course/flowEditorSlice'
import { transformFlowOverlayFrame, type FlowSharedAuthoringResult } from '../course/flowSharedAuthoringAdapters'
import { isTeacherControllerLayerItem } from '../course/globalLayerCommands'
import { selectMediaAssetFiles, useEditorStore } from '../store/editorStore'
import {
  createStageViewportTransform,
  resizeWorldFrameFromHandle,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  STAGE_VIEWPORT_HEIGHT,
  STAGE_VIEWPORT_WIDTH,
  type StageRect,
  type StageResizeHandleDirection,
} from '../authoring/stageViewportTransform'
import {
  applyFlowTextEditGesture,
  beginFlowFormulaEdit,
  beginFlowTextEdit,
  buildFlowRichTextHtml,
  cancelFlowTextEdit,
  cellToRichText,
  clearFlowTextEditRangeStyle,
  commitFlowFormulaAst,
  commitFlowTextEdit,
  deferFlowTextAction,
  extractFlowRichTextFromEditor,
  finishFlowTextComposition,
  FLOW_PAPER_TEXT_COLOR,
  FLOW_TEXT_REJECT_FORMULA_RUNS,
  flowFormulaBlockToAuthoringNode,
  formatFlowAuthoringBlock,
  formatFlowAuthoringTextStyle,
  logicalFlowSelectionOffsets,
  markFlowTextComposing,
  resolveFlowTextBlur,
  resolveFlowTextHistoryAction,
  resolveFlowTextKeyDown,
  restoreFlowLogicalSelection,
  toggleFlowTextEditEmphasis,
  toggleFlowTextEditRunStyle,
  updateFlowTextDraft,
  updateFlowTextRange,
  type FlowTextEditSession,
} from '../authoring/flowTextEdit'
import { FormulaEditDialog } from './FormulaEditDialog'
import { PublishedFormulaPaint } from './PublishedFormulaPaint'
import {
  FlowBlockContextToolbar,
  type FlowBlockContextCommand,
} from './FlowBlockContextToolbar'
import { TeacherControllerAuthoringChrome } from './TeacherControllerAuthoringChrome'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../player/surfaces/publishedComponentMount'
import type { ComponentPackageData } from '../../shared/componentTypes'

const FLOW_OVERLAY_HANDLE_RADIUS = 10

export interface FlowWorkspaceProps {
  readonly project: CourseProjectDocument
  readonly view: FlowEditorView
  readonly selection: FlowEditorSelection | null
  readonly onProjectChange?: (result: FlowCommandResult | FlowSharedAuthoringResult) => void
  readonly onSelectionChange?: (selection: FlowEditorSelection | null) => void
  readonly onTextEditChange?: (edit: FlowTextEditSession | null) => void
  readonly readOnly?: boolean
  /** Sidecar bytes for edit-mode previews. Production falls back to the editor store. */
  readonly assetFiles?: Record<string, Uint8Array>
  readonly componentPackages?: Record<string, ComponentPackageData>
}

export function FlowInlineRichTextEditor({
  blockId,
  label,
  text,
  runs,
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
  readonly runs: import('../../shared/projectTypes').TextRun[]
  readonly restyleToken: number
  readonly range: { start: number; end: number }
  readonly composing: boolean
  readonly onDraftChange: (
    text: string,
    runs: import('../../shared/projectTypes').TextRun[],
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

  const read = () => editorRef.current
    ? extractFlowRichTextFromEditor(editorRef.current)
    : { text, runs }

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
        if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('.flow-block-context-toolbar')) {
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
          finishedRef.current = true
          onCancel()
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          finishedRef.current = true
          onCommit()
        }
      }}
    />
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
        onCancel()
      } else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        onCommit()
      }
    },
  }
  if (multiline) {
    return <textarea {...shared} rows={4} />
  }
  return <input {...shared} />
}

function overlayCardStyle(
  layer: FlowEditorLayerView,
  preview?: StageRect | null,
  paperScrollTop = 0,
): CSSProperties {
  const frame = preview ?? layer.item.frame
  const isController = isTeacherControllerLayerItem(layer.item)
  const isPaper = !isController && layer.item.paperSpace === 'paper'
  const top = isPaper ? frame.y - paperScrollTop : frame.y
  return {
    position: 'absolute',
    left: frame.x,
    top,
    width: frame.width,
    height: frame.height,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
  }
}

function constrainFlowControllerOverlayFrame(
  layer: FlowEditorLayerView | undefined,
  frame: StageRect,
): StageRect {
  if (!layer || !isTeacherControllerLayerItem(layer.item)) return frame
  return constrainTeacherControllerAuthoringFrame(
    layer.item.content.data,
    frame,
    layer.item.rotation,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  )
}

function createFlowAssetObjectUrls(
  assets: CourseProjectDocument['assets'],
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

function nativeOverlayMedia(item: LayerItem): {
  readonly kind: 'image' | 'video'
  readonly assetId: string
  readonly posterAssetId?: string
} | null {
  if (item.kind !== 'native') return null
  if (item.content.nativeType === 'image') {
    return { kind: 'image', assetId: item.content.data.assetId }
  }
  if (item.content.nativeType === 'video') {
    const posterAssetId = item.content.data.poster.assetId
    return {
      kind: 'video',
      assetId: item.content.data.assetId,
      ...(posterAssetId ? { posterAssetId } : {}),
    }
  }
  return null
}

function overlayMediaFillStyle(): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    pointerEvents: 'none',
  }
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

function FlowOverlayComponentContent({
  layer,
  componentPackages,
  assetUrls,
}: {
  layer: FlowEditorLayerView
  componentPackages?: Record<string, ComponentPackageData>
  assetUrls: Record<string, string>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const item = layer.item as LayerItem
  if (item.kind !== 'component') return null
  const pkg = findComponentPackageSource(componentPackages, item.component.packageId, item.component.version)
  const fallbackUrl = item.staticFallbackAssetId ? assetUrls[item.staticFallbackAssetId] : undefined

  useEffect(() => {
    const el = containerRef.current
    if (!el || !pkg) return
    const handle = mountPublishedComponent(el, {
      container: el,
      componentId: item.component.packageId,
      version: item.component.version,
      instanceId: layer.selectionId,
      width: item.frame.width,
      height: item.frame.height,
      props: item.props,
      staticFallbackAssetId: item.staticFallbackAssetId,
      components: componentPackages,
      resolveAsset: (id) => assetUrls[id],
      mode: 'edit',
      interactive: false,
    })
    return () => handle.destroy()
  }, [item.component.packageId, item.component.version, layer.selectionId, item.frame.width, item.frame.height, item.props, item.staticFallbackAssetId, componentPackages, assetUrls, pkg])

  if (!pkg) {
    if (fallbackUrl) {
      return (
        <img
          src={fallbackUrl}
          data-flow-overlay-media="image"
          data-flow-asset-id={item.staticFallbackAssetId}
          alt={`${item.component.packageId} 后备`}
          style={overlayMediaFillStyle()}
        />
      )
    }
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(23, 32, 51, 0.88)',
          color: '#f8fafc',
          padding: 8,
          textAlign: 'center',
          fontSize: 12,
        }}
      >
        <strong>{item.component.packageId}</strong>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>v{item.component.version}</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    />
  )
}

function renderFlowOverlayCardContent(
  layer: FlowEditorLayerView,
  assetUrls: Record<string, string>,
  componentPackages?: Record<string, ComponentPackageData>,
): ReactNode {
  if (layer.item.kind === 'component') {
    return (
      <FlowOverlayComponentContent
        layer={layer}
        componentPackages={componentPackages}
        assetUrls={assetUrls}
      />
    )
  }
  if (layer.item.kind === 'native' && layer.item.content.nativeType === 'formula') {
    const data = layer.item.content.data
    const frame = layer.item.frame
    return (
      <PublishedFormulaPaint
        formulaId={data.formulaId}
        accessibleText={data.accessibleText}
        ast={data.ast as FormulaAstNode}
        style={data.style}
        width={Math.max(1, frame.width)}
        height={Math.max(1, frame.height)}
        lockHeight
      />
    )
  }
  const media = nativeOverlayMedia(layer.item as LayerItem)
  if (!media) return layer.item.label || '浮层'
  const url = assetUrls[media.assetId]
  if (media.kind === 'image') {
    return (
      <img
        data-flow-overlay-media="image"
        data-flow-asset-id={media.assetId}
        alt=""
        {...(url ? { src: url } : {})}
        style={overlayMediaFillStyle()}
      />
    )
  }
  const posterUrl = media.posterAssetId ? assetUrls[media.posterAssetId] : undefined
  return (
    <video
      data-flow-overlay-media="video"
      data-flow-asset-id={media.assetId}
      {...(url ? { src: url } : {})}
      {...(posterUrl ? { poster: posterUrl } : {})}
      muted
      playsInline
      preload="metadata"
      style={overlayMediaFillStyle()}
    />
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

function overlayLocalPoint(
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const bounds = overlay.getBoundingClientRect()
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  return {
    x: (clientX - bounds.left) * (CANVAS_WIDTH / width),
    y: (clientY - bounds.top) * (CANVAS_HEIGHT / height),
  }
}

function hitFlowOverlayResizeHandle(
  frame: StageRect,
  local: { x: number; y: number },
): StageResizeHandleDirection | null {
  for (const direction of STAGE_RESIZE_HANDLE_DIRECTIONS) {
    const point = overlayHandlePoint(frame, direction)
    if (Math.hypot(local.x - point.x, local.y - point.y) <= FLOW_OVERLAY_HANDLE_RADIUS) {
      return direction
    }
  }
  return null
}

function overlayHandlePoint(
  frame: StageRect,
  direction: StageResizeHandleDirection,
): { x: number; y: number } {
  const left = frame.x
  const top = frame.y
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  const midX = frame.x + frame.width / 2
  const midY = frame.y + frame.height / 2
  if (direction === 'nw') return { x: left, y: top }
  if (direction === 'n') return { x: midX, y: top }
  if (direction === 'ne') return { x: right, y: top }
  if (direction === 'e') return { x: right, y: midY }
  if (direction === 'se') return { x: right, y: bottom }
  if (direction === 's') return { x: midX, y: bottom }
  if (direction === 'sw') return { x: left, y: bottom }
  return { x: left, y: midY }
}

interface FlowOverlayGesture {
  readonly type: 'move' | 'resize'
  readonly layerItemId: string
  readonly direction?: StageResizeHandleDirection
  readonly startLocal: { x: number; y: number }
  readonly startFrame: StageRect
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
  project,
  view,
  selection,
  onProjectChange,
  onSelectionChange,
  onTextEditChange,
  readOnly = false,
  assetFiles,
  componentPackages: propComponentPackages,
}: FlowWorkspaceProps) {
  const paperRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const workspaceMeasureRef = useRef<HTMLDivElement>(null)
  const editRef = useRef<FlowTextEditSession | null>(null)
  const [edit, setEdit] = useState<FlowTextEditSession | null>(null)
  const [restyleToken, setRestyleToken] = useState(0)
  const [toolbarPlacement, setToolbarPlacement] = useState<'top' | 'below'>('below')
  const [formulaBlockId, setFormulaBlockId] = useState<string | null>(null)
  const toolbarSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayGestureRef = useRef<FlowOverlayGesture | null>(null)
  const [overlayPreview, setOverlayPreview] = useState<{ id: string; frame: StageRect } | null>(null)
  const [paperScrollTop, setPaperScrollTop] = useState(0)
  const [overlayViewportSize, setOverlayViewportSize] = useState({
    width: STAGE_VIEWPORT_WIDTH,
    height: STAGE_VIEWPORT_HEIGHT,
  })
  const storeAssetFiles = useEditorStore(selectMediaAssetFiles)
  const storeComponentPackages = useEditorStore((state) => state.componentPackages)
  const storeEdit = useEditorStore((state) => state.flowTextEdit)
  const componentPackages = propComponentPackages ?? storeComponentPackages
  const sidecarFiles = assetFiles ?? storeAssetFiles
  const assetUrls = useMemo(
    () => createFlowAssetObjectUrls(project.assets, sidecarFiles),
    [project.assets, sidecarFiles],
  )

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

  const overlayTransform = useMemo(() => createStageViewportTransform({
    viewport: {
      x: 0,
      y: 0,
      width: Math.max(1, overlayViewportSize.width),
      height: Math.max(1, overlayViewportSize.height),
    },
    zoom: 1,
  }), [overlayViewportSize.height, overlayViewportSize.width])

  const setEditState = (next: FlowTextEditSession | null) => {
    editRef.current = next
    setEdit(next)
    onTextEditChange?.(next)
  }

  useEffect(() => {
    if (!storeEdit) return
    const local = editRef.current
    if (!local) return
    if (storeEdit.blockId !== local.blockId) return
    if (local.composing || storeEdit.composing) return

    const rangeEqual =
      local.range.start === storeEdit.range.start &&
      local.range.end === storeEdit.range.end

    const draftEqual = (() => {
      const ld = local.draft as any
      const sd = storeEdit.draft as any
      if (local.kind !== storeEdit.kind) return false
      if (local.kind === 'rich-text') {
        if (ld?.text !== sd?.text) return false
        const lRuns = ld?.runs ?? []
        const sRuns = sd?.runs ?? []
        if (lRuns.length !== sRuns.length) return false
        return JSON.stringify(lRuns) === JSON.stringify(sRuns)
      }
      if (local.kind === 'plain-string') {
        return ld?.text === sd?.text
      }
      if (local.kind === 'formula') {
        return (
          ld?.accessibleText === sd?.accessibleText &&
          JSON.stringify(ld?.ast) === JSON.stringify(sd?.ast)
        )
      }
      return false
    })()

    if (rangeEqual && draftEqual) return

    setEditState(storeEdit)
    setRestyleToken((n) => n + 1)
  }, [storeEdit])

  useEffect(() => {
    if (readOnly) return
    if (selection?.focus === 'text' && selection.selectedBlockId) {
      if (editRef.current?.blockId === selection.selectedBlockId) return
      const begun = beginFlowTextEdit({
        project,
        selection,
        blockId: selection.selectedBlockId,
        range: selection.textRange ?? {
          blockId: selection.selectedBlockId,
          start: 0,
          end: 0,
        },
      })
      if (!begun.ok) return
      setEditState(begun.edit)
      setRestyleToken((token) => token + 1)
    }
  }, [
    project,
    readOnly,
    selection,
  ])

  useEffect(() => {
    if (!edit || !scrollRef.current) return
    const block = scrollRef.current.querySelector(`[data-flow-block-id="${edit.blockId}"]`)
    if (!(block instanceof HTMLElement) || !scrollRef.current) return
    const update = () => {
      const scrollRect = scrollRef.current!.getBoundingClientRect()
      const blockRect = block.getBoundingClientRect()
      const hasLayout = scrollRect.height > 0 && blockRect.height > 0
      setToolbarPlacement(hasLayout && scrollRect.bottom - blockRect.bottom < 48 ? 'top' : 'below')
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

  const emitProject = (result: FlowCommandResult | FlowSharedAuthoringResult) => {
    if (result.ok && result.nextDocument) onProjectChange?.(result)
  }

  const emitSelection = (next: FlowEditorSelection | null) => {
    onSelectionChange?.(next)
  }

  const locationId = selection?.locationId ?? view.locationId

  const commitCurrent = (keepSelected = true) => {
    const current = editRef.current
    if (!current || !selection) {
      setEditState(null)
      return
    }
    const action = resolveFlowTextBlur({ composing: current.composing, blurReady: true })
    if (action === 'defer') {
      setEditState(deferFlowTextAction(current, 'commit'))
      return
    }
    const result = commitFlowTextEdit(project, selection, current, {
      expectedRevision: project.revision,
    })
    setEditState(null)
    emitProject(result)
    if (keepSelected && selection.selectedBlockId) {
      emitSelection(selectFlowEditorBlocks(result.nextDocument ?? project, locationId, [current.blockId]))
    } else if (!keepSelected) {
      emitSelection(null)
    }
  }

  const flushOpenTextEdit = () => {
    const current = editRef.current
    if (!current) return
    if (current.composing) {
      setEditState(deferFlowTextAction(current, 'commit'))
      return
    }
    const result = commitFlowTextEdit(
      project,
      selection ?? selectFlowEditorBlocks(project, locationId, [current.blockId]),
      current,
      { expectedRevision: project.revision },
    )
    setEditState(null)
    emitProject(result)
  }

  useEffect(() => {
    if (readOnly) return
    if (editRef.current && selection?.focus !== 'text') {
      flushOpenTextEdit()
    }
  }, [project, readOnly, selection])

  const cancelCurrent = () => {
    const current = editRef.current
    if (!current || !selection) {
      setEditState(null)
      return
    }
    cancelFlowTextEdit(project, selection, current)
    setEditState(null)
    emitSelection(selectFlowEditorBlocks(project, locationId, [current.blockId]))
  }

  const enterText = (
    blockId: string,
    gesture: 'double-click' | 'enter' | 'click-text',
    extra?: { offset?: number; listItemId?: string; tableRowId?: string; tableColumnId?: string },
  ) => {
    if (readOnly || selection?.authoringScope === 'global') return
    const currentSelection = selection ?? selectFlowEditorBlocks(project, locationId, [blockId])
    const begun = applyFlowTextEditGesture({
      project,
      selection: currentSelection,
      blockId,
      gesture,
      locationId,
      offset: extra?.offset,
      listItemId: extra?.listItemId,
      tableRowId: extra?.tableRowId,
      tableColumnId: extra?.tableColumnId,
    })
    if (!begun.ok) {
      if (begun.reason === FLOW_TEXT_REJECT_FORMULA_RUNS) {
        openFormula(blockId)
      }
      return
    }
    emitSelection(begun.selection)
    setEditState(begun.edit)
    setRestyleToken((token) => token + 1)
  }

  const openFormula = (blockId: string) => {
    if (readOnly || selection?.authoringScope === 'global') return
    if (editRef.current?.kind === 'formula' && editRef.current.blockId === blockId) {
      setFormulaBlockId(blockId)
      return
    }
    const currentSelection = selection ?? selectFlowEditorBlocks(project, locationId, [blockId])
    const begun = beginFlowFormulaEdit({
      project,
      selection: currentSelection,
      blockId,
    })
    if (!begun.ok) return
    emitSelection(begun.selection)
    setEditState(begun.edit)
    setFormulaBlockId(blockId)
  }

  const selectBlock = (blockId: string, event: ReactMouseEvent<HTMLElement>) => {
    if (readOnly) return
    event.stopPropagation()
    if (selection?.authoringScope === 'global') return
    if (editRef.current && editRef.current.blockId !== blockId) {
      commitCurrent(false)
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
    if (ids.length === 0) {
      emitSelection(null)
      return
    }
    emitSelection(selectFlowEditorBlocks(project, locationId, ids))
  }

  const handlePaperClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return
    if (editRef.current) commitCurrent(false)
    else emitSelection(null)
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
      emitSelection(null)
      return
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!selection) return
      event.preventDefault()
      emitProject(executeFlowDelete(project, selection))
      emitSelection(null)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const order = view.blocks.map((entry) => entry.blockId)
      const index = order.indexOf(blockId)
      const nextIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
      const nextId = order[nextIndex]
      if (nextId) emitSelection(selectFlowEditorBlocks(project, locationId, [nextId]))
    }
  }

  const handleHistoryKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = editRef.current
    if (!current) return
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key.toLowerCase() !== 'z' && event.key.toLowerCase() !== 'y') return
    const action = event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)
      ? 'redo' as const
      : 'undo' as const
    const resolved = resolveFlowTextHistoryAction({
      composing: current.composing,
      draftDirty: JSON.stringify(current.original) !== JSON.stringify(current.draft),
      action,
    })
    if (resolved === 'ignore' && current.composing) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (resolved === 'cancel') {
      event.preventDefault()
      event.stopPropagation()
      cancelCurrent()
    }
  }

  const applyToolbarCommand = (command: FlowBlockContextCommand) => {
    if (!selection) return
    const current = editRef.current
    const captured = toolbarSelectionRef.current
    toolbarSelectionRef.current = null
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
          setEditState(toggleFlowTextEditRunStyle(live, key, live.range))
          setRestyleToken((token) => token + 1)
          return
        }
      }
      const style = command.type === 'range-style'
        ? command.style
        : command.type === 'range-color'
          ? { color: command.color }
          : { highlightColor: command.color }
      const result = formatFlowAuthoringTextStyle({
        document: project,
        selection,
        style,
        edit: live,
        range: live?.range,
        expectedRevision: project.revision,
      })
      if (result.nextEdit) {
        setEditState(result.nextEdit)
        setRestyleToken((token) => token + 1)
      }
      emitProject(result)
      return
    }
    if (command.type === 'range-emphasis' && live) {
      setEditState(toggleFlowTextEditEmphasis(live, live.range))
      setRestyleToken((token) => token + 1)
      return
    }
    if (command.type === 'range-clear' && live) {
      setEditState(clearFlowTextEditRangeStyle(live, live.range))
      setRestyleToken((token) => token + 1)
      return
    }
    if (command.type === 'heading-level') {
      emitProject(formatFlowAuthoringBlock(project, selection, { kind: 'heading-level', level: command.level }))
      return
    }
    if (command.type === 'convert-heading') {
      emitProject(formatFlowAuthoringBlock(project, selection, { kind: 'convert-heading', level: command.level }))
      return
    }
    if (command.type === 'convert-paragraph') {
      emitProject(formatFlowAuthoringBlock(project, selection, { kind: 'convert-paragraph' }))
      return
    }
    if (command.type === 'list-ordered') {
      emitProject(formatFlowAuthoringBlock(project, selection, { kind: 'list-ordered', ordered: command.ordered }))
      return
    }
    if (command.type === 'indent' || command.type === 'outdent') {
      emitProject(executeFlowEditorCommand(project, selection, { name: command.type }))
      return
    }
    if (command.type === 'move') {
      const blockView = view.blocks.find((entry) => entry.blockId === selection.selectedBlockId)
      if (!blockView) return
      const nextIndex = command.direction === 'up' ? blockView.index - 1 : blockView.index + 1
      if (nextIndex < 0) return
      emitProject(executeFlowEditorCommand(project, selection, {
        name: 'move',
        destination: { parentId: blockView.parentId, index: nextIndex },
      }))
      return
    }
    if (command.type === 'delete') {
      const blockSelection = selection.focus === 'text'
        ? selectFlowEditorBlocks(project, locationId, selection.selectedBlockIds)
        : selection
      emitProject(executeFlowEditorCommand(project, blockSelection, { name: 'delete' }))
      setEditState(null)
      emitSelection(null)
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

  const childrenByParent = new Map<string | null, FlowBlockView[]>()
  for (const blockView of view.blocks) {
    const siblings = childrenByParent.get(blockView.parentId)
    if (siblings) siblings.push(blockView)
    else childrenByParent.set(blockView.parentId, [blockView])
  }

  const renderBlock = (blockView: FlowBlockView): ReactNode => {
    const block = blockView.block as FlowBlock
    const selected = selection?.selectedBlockIds.includes(blockView.blockId) ?? false
    const editingThis = edit?.blockId === blockView.blockId
    const showToolbar = selected && !readOnly
    const formulaEditingAvailable = !readOnly && selection?.authoringScope !== 'global'
    const richDraft = edit?.kind === 'rich-text' && editingThis
      ? edit.draft as { text: string; runs: import('../../shared/projectTypes').TextRun[] }
      : null
    const plainDraft = edit?.kind === 'plain-string' && editingThis
      ? (edit.draft as { text: string }).text
      : null

    const isWrapLeft = (block.type === 'media' || block.type === 'component') && block.wrap === 'left'
    const isWrapRight = (block.type === 'media' || block.type === 'component') && block.wrap === 'right'

    const frameStyle: CSSProperties = {
      position: 'relative' as const,
      outline: selected ? '2px solid #5b9cff' : undefined,
      boxShadow: selected ? 'inset 4px 0 0 #5b9cff' : undefined,
      padding: '12px 16px',
      margin: '0 0 12px',
      ...(isWrapLeft
        ? { float: 'left', width: '48%', margin: '0 16px 8px 0' }
        : isWrapRight
          ? { float: 'right', width: '48%', margin: '0 0 8px 16px' }
          : {}),
    }

    const frameProps = {
      'data-testid': `flow-block-${blockView.blockId}`,
      'data-flow-block-id': blockView.blockId,
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
        emitProject(executeFlowEditorCommand(project, selectFlowEditorBlocks(project, locationId, [sourceId]), {
          name: 'move',
          destination: { parentId: blockView.parentId, index: blockView.index, surfaceId: view.surfaceId },
        }))
      },
      style: frameStyle,
    }

    const richEditor = (label: string, text: string, runs: import('../../shared/projectTypes').TextRun[]) => (
      <FlowInlineRichTextEditor
          blockId={blockView.blockId}
          label={label}
          text={richDraft?.text ?? text}
          runs={richDraft?.runs ?? runs}
          restyleToken={restyleToken}
          range={edit?.range ?? { start: 0, end: 0 }}
          composing={edit?.composing ?? false}
          onDraftChange={(nextText, nextRuns, offsets) => {
            const current = editRef.current
            if (!current) return
            let next = updateFlowTextDraft(current, { text: nextText, runs: nextRuns })
            if (offsets) next = updateFlowTextRange(next, offsets)
            setEditState(next)
          }}
          onRangeChange={(offsets) => {
            const current = editRef.current
            if (!current) return
            if (current.range.start === offsets.start && current.range.end === offsets.end) return
            setEditState(updateFlowTextRange(current, offsets))
          }}
          onComposingChange={(composing) => {
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
          }}
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

    const idleRichText = (text: string, runs: readonly import('../../shared/projectTypes').TextRun[] = []) => (
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
        const surface = project.surfaces.find((entry) => entry.id === view.surfaceId)
        const wide = surface?.type === 'flow' ? surface.layout.wideContentWidth : view.layout.readingWidth
        const maxWidth = block.layout === 'wide'
          ? wide
          : block.layout === 'full-width'
            ? '100%'
            : view.layout.readingWidth
        body = (
          <figure
            data-flow-media-layout={block.layout}
            {...(selected ? { 'data-flow-media-selected': 'true' } : {})}
            style={{
              width: '100%',
              maxWidth,
              marginInline: 'auto',
            }}
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
                    onComposingChange={(composing) => {
                      const current = editRef.current
                      if (!current) return
                      setEditState(markFlowTextComposing(current, composing))
                    }}
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
                    onComposingChange={(composing) => {
                      const current = editRef.current
                      if (!current) return
                      setEditState(markFlowTextComposing(current, composing))
                    }}
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
                      onComposingChange={(composing) => {
                        const current = editRef.current
                        if (!current) return
                        setEditState(markFlowTextComposing(current, composing))
                      }}
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
        {!readOnly && !editingThis ? (
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
            }}
          />
        ) : null}
        {showToolbar ? (
          <FlowBlockContextToolbar
            block={block}
            edit={editingThis ? edit : null}
            placement={editingThis ? toolbarPlacement : 'below'}
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
  const overlayLayers = view.overlayLayers.filter((layer) => layer.effectiveVisible)
  const overlayScenes = project.locations.map((entry) => ({
    id: entry.id,
    name: entry.label,
  }))

  const overlayFrameOf = (layer: FlowEditorLayerView): StageRect => {
    if (overlayPreview?.id === layer.selectionId) return overlayPreview.frame
    return {
      x: layer.item.frame.x,
      y: layer.item.frame.y,
      width: layer.item.frame.width,
      height: layer.item.frame.height,
    }
  }

  const beginOverlayGesture = (
    event: ReactPointerEvent<HTMLElement>,
    layer: FlowEditorLayerView,
  ) => {
    if (readOnly || event.button !== 0 || layer.item.locked) {
      if (!readOnly) {
        if (editRef.current) commitCurrent(false)
        emitSelection(selectFlowOverlay(
          project,
          locationId,
          [layer.selectionId],
          layer.source === 'global' ? 'global' : 'page',
        ))
      }
      return
    }
    const overlay = overlayRef.current
    if (!overlay) return
    event.preventDefault()
    event.stopPropagation()
    if (editRef.current) commitCurrent(false)
    emitSelection(selectFlowOverlay(
      project,
      locationId,
      [layer.selectionId],
      layer.source === 'global' ? 'global' : 'page',
    ))
    const local = overlayLocalPoint(overlay, event.clientX, event.clientY)
    const startFrame = overlayFrameOf(layer)
    const handleEl = event.target instanceof HTMLElement
      ? event.target.closest('[data-handle]')
      : null
    const handleAttr = handleEl?.getAttribute('data-handle')
    const direction = (STAGE_RESIZE_HANDLE_DIRECTIONS as readonly string[]).includes(handleAttr ?? '')
      ? handleAttr as StageResizeHandleDirection
      : hitFlowOverlayResizeHandle(startFrame, local)
    overlayGestureRef.current = {
      type: direction ? 'resize' : 'move',
      layerItemId: layer.selectionId,
      ...(direction ? { direction } : {}),
      startLocal: local,
      startFrame,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    const overlay = overlayRef.current
    if (!gesture || !overlay) return
    const local = overlayLocalPoint(overlay, event.clientX, event.clientY)
    const rawNext = gesture.type === 'resize' && gesture.direction
      ? resizeWorldFrameFromHandle(
          gesture.startFrame,
          gesture.direction,
          local,
          MIN_NODE_SIZE,
        )
      : {
          x: gesture.startFrame.x + (local.x - gesture.startLocal.x),
          y: gesture.startFrame.y + (local.y - gesture.startLocal.y),
          width: gesture.startFrame.width,
          height: gesture.startFrame.height,
        }
    const next = constrainFlowControllerOverlayFrame(
      view.overlayLayers.find((layer) => layer.selectionId === gesture.layerItemId),
      rawNext,
    )
    setOverlayPreview({ id: gesture.layerItemId, frame: next })
  }

  const endOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    const overlay = overlayRef.current
    overlayGestureRef.current = null
    if (!gesture || !overlay) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const local = overlayLocalPoint(overlay, event.clientX, event.clientY)
    const rawNext = gesture.type === 'resize' && gesture.direction
      ? resizeWorldFrameFromHandle(
          gesture.startFrame,
          gesture.direction,
          local,
          MIN_NODE_SIZE,
        )
      : {
          x: gesture.startFrame.x + (local.x - gesture.startLocal.x),
          y: gesture.startFrame.y + (local.y - gesture.startLocal.y),
          width: gesture.startFrame.width,
          height: gesture.startFrame.height,
        }
    const next = constrainFlowControllerOverlayFrame(
      view.overlayLayers.find((layer) => layer.selectionId === gesture.layerItemId),
      rawNext,
    )
    setOverlayPreview(null)
    const selected = selectFlowOverlay(
      project,
      locationId,
      [gesture.layerItemId],
      view.overlayLayers.find((layer) => layer.selectionId === gesture.layerItemId)?.source === 'global'
        ? 'global'
        : 'page',
    )
    emitProject(transformFlowOverlayFrame(project, selected, next, {
      expectedRevision: project.revision,
    }))
  }

  const cancelOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    overlayGestureRef.current = null
    setOverlayPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!gesture) return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <div
      ref={workspaceMeasureRef}
      className="flow-workspace"
      data-testid="flow-workspace"
      data-flow-not-slide-stage="true"
      onKeyDown={handleHistoryKey}
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        minHeight: 320,
        overflow: 'hidden',
        background: '#eef1f6',
      }}
    >
      <div
        ref={scrollRef}
        className="flow-workspace__scroll"
        data-testid="flow-workspace-scroll"
        onScroll={(e) => {
          setPaperScrollTop(e.currentTarget.scrollTop)
        }}
        style={{
          flex: 1,
          overflow: 'auto',
          height: '100%',
          padding: '24px 16px 48px',
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
            background: resolveCourseSurfaceBackgroundColor(
              (() => {
                const surface = project.surfaces.find((candidate) => candidate.id === view.surfaceId)
                return surface?.type === 'flow' ? surface.backgroundColor : undefined
              })(),
            ),
            color: FLOW_PAPER_TEXT_COLOR,
            boxShadow: '0 8px 32px rgba(15, 23, 42, 0.08)',
          }}
        >
          {rootBlocks.map((blockView) => renderBlock(blockView))}
          <div style={{ clear: 'both' }} aria-hidden="true" />
        </article>
      </div>
      {overlayLayers.length > 0 ? (
        <div
          ref={overlayRef}
          className="flow-authoring-layer-overlay"
          data-testid="flow-authoring-layer-overlay"
          style={{
            position: 'absolute',
            left: overlayTransform.stageRect.x,
            top: overlayTransform.stageRect.y,
            width: STAGE_VIEWPORT_WIDTH,
            height: STAGE_VIEWPORT_HEIGHT,
            transform: `scale(${overlayTransform.scale})`,
            transformOrigin: '0 0',
            zIndex: 4,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
        >
          {overlayLayers.map((layer) => {
            const preview = overlayPreview?.id === layer.selectionId ? overlayPreview.frame : null
            const controller = isTeacherControllerLayerItem(layer.item)
            const controllerGlobalAuthoring = controller && selection?.authoringScope === 'global'
            const controllerPagePreview = controller && !controllerGlobalAuthoring
            const selected = !controllerPagePreview &&
              selection?.selectedOverlayIds.includes(layer.selectionId) === true
            return (
              <div
                key={layer.selectionId}
                role={controllerPagePreview ? undefined : 'button'}
                tabIndex={controllerPagePreview ? undefined : readOnly ? -1 : 0}
                className={`flow-layer-card${selected ? ' flow-layer-card--selected' : ''}${controller ? ' flow-layer-card--controller' : ''}`}
                data-layer-item-id={layer.selectionId}
                data-testid={`flow-layer-card-${layer.selectionId}`}
                data-controller-page-preview={controllerPagePreview || undefined}
                aria-hidden={controllerPagePreview || undefined}
                aria-label={controllerPagePreview ? undefined : layer.item.label || '浮层'}
                style={{
                  ...overlayCardStyle(layer, preview, paperScrollTop),
                  ...(controllerPagePreview ? { pointerEvents: 'none' } : {}),
                }}
                onPointerDown={controllerPagePreview ? undefined : (event) => beginOverlayGesture(event, layer)}
                onPointerMove={controllerPagePreview ? undefined : moveOverlayGesture}
                onPointerUp={controllerPagePreview ? undefined : endOverlayGesture}
                onPointerCancel={controllerPagePreview ? undefined : cancelOverlayGesture}
              >
                {controller ? (
                  <TeacherControllerAuthoringChrome
                    item={layer.item as LayerItem}
                    frame={overlayFrameOf(layer)}
                    rotation={layer.item.rotation}
                    canvas={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                    getRenderedStageBounds={() => {
                      const bounds = overlayRef.current?.getBoundingClientRect()
                      return {
                        width: Math.max(1, bounds?.width || CANVAS_WIDTH),
                        height: Math.max(1, bounds?.height || CANVAS_HEIGHT),
                      }
                    }}
                    scenes={overlayScenes}
                    currentSceneId={locationId}
                  />
                ) : (
                  renderFlowOverlayCardContent(layer, assetUrls, componentPackages)
                )}
                {selected && !readOnly && !layer.item.locked && !controllerPagePreview ? (
                  STAGE_RESIZE_HANDLE_DIRECTIONS.map((direction) => {
                    const point = overlayHandlePoint(overlayFrameOf(layer), direction)
                    const frame = overlayFrameOf(layer)
                    return (
                      <div
                        key={direction}
                        className="flow-layer-card__handle"
                        data-handle={direction}
                        data-testid={`flow-overlay-handle-${layer.selectionId}-${direction}`}
                        style={{
                          position: 'absolute',
                          left: point.x - frame.x - 4,
                          top: point.y - frame.y - 4,
                          width: 8,
                          height: 8,
                          pointerEvents: 'auto',
                        }}
                      />
                    )
                  })
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {formulaNode ? (
        <FormulaEditDialog
          node={formulaNode}
          onCancel={() => {
            setFormulaBlockId(null)
            cancelCurrent()
          }}
          onCommit={(ast, accessibleText) => {
            if (!selection) return
            const result = commitFlowFormulaAst(project, selection, ast, accessibleText, {
              expectedRevision: project.revision,
            })
            setFormulaBlockId(null)
            setEditState(null)
            emitProject(result)
            emitSelection(selectFlowEditorBlocks(result.nextDocument ?? project, locationId, [formulaNode.id]))
          }}
        />
      ) : null}
    </div>
  )
}
