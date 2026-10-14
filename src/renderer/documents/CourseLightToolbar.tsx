import { MoreHorizontal, Save, SaveAll, Undo2, Redo2, Plus, SlidersHorizontal, MonitorPlay } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { usePropertiesContext } from '../ui/properties/PropertiesContextAdapter'
import { ExportMenu, type ExportFormat } from '../ui/ExportMenu'
import { CourseImportMenu } from '../ui/CourseImportMenu'
import type { SingleHtmlExportMode } from '../export/course/coursePackagePreflight'
import { CourseNavigationToolbarHost, useCourseEditorChrome, type CourseEditorMode } from './CourseEditorChromeContext'
import { useProEditorRailState } from '../ui/proEditorRailController'
import { ElementCardIndicator, type ElementCardNavigation } from '../workbench/elementCards/ElementCardIndicator'
import { FlowInsertMenu } from '../ui/flow/FlowInsertMenu'
import type { FlowInsertCommand } from '../ui/flow/flowInsertCommands'
import './courseEditorChrome.css'

export interface CourseLightToolbarProps {
  /** The same tools appear in both work positions; only their navigation slot differs. */
  toolbarMode?: CourseEditorMode
  documentId: string | null
  isCurrentDocument(id: string): boolean
  canUndo: boolean
  canRedo: boolean
  canUndoLatestAgent?: boolean
  undo(): void
  redo(): void
  undoLatestAgent?(): void
  save(): void
  saveAs(): void
  onReplaceImage(): void
  onAddText(): void
  onAddImage(): void
  onAddVideo(): void
  onAddAudio(): void
  onImportHtml?(): void
  onImportFlow?(): void
  onImportPptx?(): void
  /** Shapes and formulas inserted from the workbench (M21); omitted where they cannot go. */
  onAddShape?(shapeType: LightShapeType): void
  onAddFormula?(): void
  /** Flow page insertion is routed by destination and kind through one current-document port. */
  flowInsertMenu?: { readonly onInsert: (command: FlowInsertCommand) => void; readonly disabledReason?: string }
  insertSurface: 'slide' | 'flow' | 'spatial' | null
  editingScope: 'scene' | 'global'
  spatialScope: 'world' | 'surface' | 'global' | null
  mode: 'edit' | 'run'
  reportError(message: string): void
  /** Whole-course preview and export, the same actions as the editor toolbar (M21). */
  busy?: boolean
  hasFlowSurface?: boolean
  onPreview?(): void
  onExport?(format: ExportFormat, singleHtmlMode?: SingleHtmlExportMode): void
  onExportSettings?(): void
  onToggleProperties?(): void
  onOpenPageProperties?(): void
  /** Finds the elements of AI cards that are working or waiting (M15); shows the top bar's indicator. */
  elementCards?: ElementCardNavigation
}

const COMPACT_WIDTH = 500

export type LightShapeType = 'rectangle' | 'rounded-rectangle' | 'ellipse' | 'triangle' | 'line' | 'arrow-right'
/** The shapes a teacher reaches for most; the editor's element library has the rest. */
const LIGHT_SHAPES: ReadonlyArray<readonly [LightShapeType, string]> = [
  ['rectangle', '矩形'], ['rounded-rectangle', '圆角矩形'], ['ellipse', '椭圆'], ['triangle', '三角形'], ['line', '直线'], ['arrow-right', '箭头'],
]

/** Close a toolbar popover on an outside press or Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target)) close() }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown) }
  }, [open])
}

/**
 * Width changes determine density and wrapping; selection tools never add or remove a toolbar row.
 * Both modes host the same surface navigation controls. Explicit entry is the only route into the full editor.
 */
export function CourseLightToolbar(props: CourseLightToolbarProps) {
  const toolbarMode = props.toolbarMode ?? 'light'
  const insertMenuId = `course-${toolbarMode}-insert-menu`
  const chrome = useCourseEditorChrome()
  const { activePanel } = useProEditorRailState()
  const context = usePropertiesContext({ onReplaceImage: props.onReplaceImage })
  const [insertOpen, setInsertOpen] = useState(false), [moreOpen, setMoreOpen] = useState(false)
  const insertRef = useRef<HTMLDivElement>(null), moreRef = useRef<HTMLDivElement>(null), toolbarRef = useRef<HTMLDivElement>(null)
  // Only very narrow widths put optional commands into more; ordinary widths retain them visibly.
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const element = toolbarRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setCompact(element.clientWidth > 0 && element.clientWidth < COMPACT_WIDTH))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useDismiss(insertOpen, insertRef, () => setInsertOpen(false))
  useDismiss(moreOpen, moreRef, () => setMoreOpen(false))
  const invoke = (action: () => unknown) => {
    if (!props.documentId || chrome.documentId !== props.documentId || !props.isCurrentDocument(props.documentId)) {
      props.reportError('文档已切换，请在当前文件重新选择操作。'); return
    }
    action()
  }
  const editing = props.mode === 'edit'
  const unavailable = props.insertSurface === null
    ? '当前没有可编辑的位置。'
    : props.insertSurface === 'spatial' && props.spatialScope !== 'world'
      ? '请切换到无限画布世界层后插入对象。'
      : null
  const flowMediaUnavailable = props.insertSurface === 'flow' && props.editingScope === 'global'
    ? 'Flow 全局层不支持正文媒体；请切换到当前文档页。'
    : null
  const insert = (action: () => void) => { setInsertOpen(false); invoke(action) }
  const more = (action: () => void) => { setMoreOpen(false); invoke(action) }
  const audioToDocument = props.insertSurface === 'flow'
  const flowInsertMenu = props.insertSurface === 'flow' && props.editingScope === 'scene' ? props.flowInsertMenu : undefined
  const undoLatestAgent = props.undoLatestAgent
  const fitWorld = context.kind === 'spatial-page' || context.kind === 'spatial-graph' ? context.commands.fitWorldContent : null
  const overflow: ReactNode[] = [
    ...(compact ? [
      <button key="save-as" type="button" role="menuitem" disabled={props.busy} onClick={() => more(props.saveAs)}>另存为</button>,
      <button key="redo" type="button" role="menuitem" disabled={props.busy || !props.canRedo || !editing} onClick={() => more(props.redo)}>重做</button>,
      ...(props.onPreview ? [<button key="preview" type="button" role="menuitem" disabled={props.busy} onClick={() => { if (props.onPreview) more(props.onPreview) }}>整课预览</button>] : []),
    ] : []),
    <button key="agent" type="button" role="menuitem" disabled={props.busy || !props.canUndoLatestAgent || !undoLatestAgent || !editing} onClick={() => { if (undoLatestAgent) more(undoLatestAgent) }}>撤销最近 AI 修改</button>,
    ...(fitWorld ? [
      <button key="fit-visible" type="button" role="menuitem" onClick={() => more(() => fitWorld('visible'))}>适配可见内容</button>,
      <button key="fit-all" type="button" role="menuitem" onClick={() => more(() => fitWorld('all'))}>适配全部内容</button>,
    ] : []),
  ]
  return <div ref={toolbarRef} className="course-light-tools" data-compact={compact} data-toolbar-mode={toolbarMode} aria-label="常用工具">
    <div className="course-light-tools__row">
      <button type="button" aria-label="保存" title="保存（Ctrl+S）" disabled={props.busy} onClick={() => invoke(props.save)}><Save size={17} /></button>
      {!compact && <button type="button" aria-label="另存为" title="另存为" disabled={props.busy} onClick={() => invoke(props.saveAs)}><SaveAll size={17} /></button>}
      <button type="button" aria-label="撤销" title="撤销（Ctrl+Z）" disabled={props.busy || !props.canUndo || !editing} onClick={() => invoke(props.undo)}><Undo2 size={17} /></button>
      {!compact && <button type="button" aria-label="重做" title="重做（Ctrl+Y）" disabled={props.busy || !props.canRedo || !editing} onClick={() => invoke(props.redo)}><Redo2 size={17} /></button>}
      <div className="course-light-tools__insert" ref={insertRef}>
        <button type="button" aria-label="插入" aria-expanded={insertOpen} aria-controls={insertMenuId} disabled={props.busy || !editing} title={editing ? '插入' : '运行状态下不能插入内容'} onClick={() => setInsertOpen(open => !open)}><Plus size={18} /></button>
        {insertOpen && editing && <div id={insertMenuId} className="course-light-tools__insert-menu" aria-label="插入内容">
          {flowInsertMenu ? <FlowInsertMenu disabled={Boolean(flowInsertMenu.disabledReason)} onInsert={command => insert(() => flowInsertMenu.onInsert(command))} /> : <>
          <button type="button" aria-label="添加文字" disabled={Boolean(unavailable)} title={unavailable ?? undefined} onClick={() => insert(props.onAddText)}>
            <span>文字</span><small>{props.insertSurface === 'flow' ? '当前文档页的段落' : props.insertSurface === 'spatial' ? '世界文本' : '自由文本'}</small>
          </button>
          <button type="button" aria-label="添加图片" disabled={Boolean(unavailable || flowMediaUnavailable)} title={unavailable ?? flowMediaUnavailable ?? undefined} onClick={() => insert(props.onAddImage)}>
            <span>图片</span><small>{props.insertSurface === 'flow' ? '文中图片块' : '当前画布'}</small>
          </button>
          <button type="button" aria-label="添加视频" disabled={Boolean(unavailable || flowMediaUnavailable)} title={unavailable ?? flowMediaUnavailable ?? undefined} onClick={() => insert(props.onAddVideo)}>
            <span>视频</span><small>{props.insertSurface === 'flow' ? '文中视频块' : '当前画布'}</small>
          </button>
          <button type="button" aria-label={audioToDocument ? '插入音频到正文' : props.insertSurface === 'slide' ? '放置音频' : '导入音频到声音库'} disabled={props.insertSurface === null || Boolean(audioToDocument && flowMediaUnavailable)} title={flowMediaUnavailable ?? undefined} onClick={() => insert(props.onAddAudio)}>
            <span>音频</span><small>{audioToDocument ? '文中音频块' : props.insertSurface === 'slide' ? '放置点击播放按钮' : '加入声音库供互动播放'}</small>
          </button>
          {props.onAddFormula && <button type="button" aria-label="插入公式" disabled={Boolean(unavailable || flowMediaUnavailable)} title={unavailable ?? flowMediaUnavailable ?? undefined} onClick={() => { const add = props.onAddFormula; if (add) insert(add) }}>
            <span>公式</span><small>{props.insertSurface === 'flow' ? '文中公式块' : '可编辑的数学公式'}</small>
          </button>}
          {props.onAddShape && <div className="course-light-tools__insert-shapes" role="group" aria-label="形状">
            <span>形状{props.insertSurface === 'flow' ? '（页面浮层）' : ''}</span>
            {LIGHT_SHAPES.map(([shape, label]) => <button key={shape} type="button" aria-label={`插入${label}`} disabled={Boolean(unavailable)} title={unavailable ?? undefined}
              onClick={() => { const add = props.onAddShape; if (add) insert(() => add(shape)) }}>{label}</button>)}
          </div>}
          {unavailable && <p role="status">{unavailable}</p>}
          {flowMediaUnavailable && <p role="status">{flowMediaUnavailable}</p>}
          </>}
          {props.onImportHtml && (props.insertSurface === 'slide' || props.insertSurface === 'flow') && <button type="button" aria-label="导入 HTML 页面" disabled={Boolean(unavailable || flowMediaUnavailable)} title={unavailable ?? flowMediaUnavailable ?? undefined}
            onClick={() => insert(props.onImportHtml!)}><span>HTML 页面…</span><small>导入到指定演示页或流式布局</small></button>}
          {flowInsertMenu?.disabledReason && <p role="status">{flowInsertMenu.disabledReason}</p>}
        </div>}
      </div>
      <div className="course-light-tools__document-actions">
        {editing && props.onToggleProperties && <button type="button" aria-expanded={activePanel === 'properties'} aria-controls="embedded-editor-properties"
          aria-label="属性" title="属性" onClick={() => invoke(props.onToggleProperties!)}><SlidersHorizontal size={17} /></button>}
        {editing && props.onOpenPageProperties && <button type="button" aria-label="页面属性" title="页面属性"
          onClick={() => invoke(props.onOpenPageProperties!)}>页面属性</button>}
        {props.elementCards && <ElementCardIndicator documentId={props.documentId} navigation={props.elementCards} />}
        {chrome.workbench && <span className="course-light-tools__status">{chrome.workbench.documentStatus}</span>}
        <CourseNavigationToolbarHost mode={toolbarMode} />
        {!compact && props.onPreview && <button type="button" aria-label="整课预览" title="整课预览" disabled={props.busy} onClick={() => { if (props.onPreview) invoke(props.onPreview) }}><MonitorPlay size={18} /></button>}
        <div className="course-transfer-actions" role="group" aria-label="导入与导出">
        <CourseImportMenu busy={props.busy} onFlow={props.onImportFlow} onPptx={props.onImportPptx} onHtml={props.onImportHtml} />
        {props.onExport && <ExportMenu variant={toolbarMode === 'deep' ? 'toolbar' : 'light'} busy={props.busy ?? false} hasFlowSurface={props.hasFlowSurface ?? false}
          onExportSettings={props.onExportSettings ? () => invoke(props.onExportSettings!) : undefined}
          onExport={(format, mode) => invoke(() => { if (mode) props.onExport?.(format, mode); else props.onExport?.(format) })} />}
        </div>
        <div className="course-light-tools__more" ref={moreRef}>
          <button type="button" aria-label="更多工具" title="更多工具" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(open => !open)}><MoreHorizontal size={15} /></button>
          {moreOpen && <div className="course-light-tools__more-menu" role="menu" aria-label="更多工具">{overflow}</div>}
        </div>
        {chrome.workbench && toolbarMode === 'light' && <button type="button" aria-label="在编辑器中打开" className="workbench-editor-focus" title="在编辑器中打开：图层、完整属性、交互、组件和开发工具" onClick={() => chrome.setMode('deep')}>在编辑器中打开</button>}
      </div>
    </div>
  </div>
}
