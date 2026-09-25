import type { LayerItem } from '../../shared/courseProjectTypes'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ColorInput } from '../ui/ColorInput'
import type { PropertiesContext } from '../ui/properties/PropertiesContext'
import type { PropertiesItemView, PropertiesPatch } from '../ui/properties/SlideNativePropertiesPanel'
import { usePropertiesContext } from '../ui/properties/PropertiesContextAdapter'
import { BufferedInput, PropertyDraftBoundary } from '../ui/properties/PropertyControls'
import { normalizePropertiesPatch, propertiesViewFromLayerItem } from '../ui/properties/propertiesItemView'
import { useCourseEditorChrome } from './CourseEditorChromeContext'
import './courseEditorChrome.css'

export interface CourseLightToolbarProps {
  documentId: string | null
  isCurrentDocument(id: string): boolean
  canUndo: boolean
  canRedo: boolean
  canUndoLatestAgent?: boolean
  undo(): void
  redo(): void
  undoLatestAgent?(): void
  save(): void
  onReplaceImage(): void
  onAddText(): void
  onAddImage(): void
  onAddVideo(): void
  onAddAudio(): void
  insertSurface: 'slide' | 'flow' | 'spatial' | null
  editingScope: 'scene' | 'global'
  spatialScope: 'world' | 'surface' | 'global' | null
  mode: 'edit' | 'run'
  reportError(message: string): void
}
export function CourseLightToolbar(props: CourseLightToolbarProps) {
  const chrome = useCourseEditorChrome()
  const context = usePropertiesContext({ onReplaceImage: props.onReplaceImage })
  const [insertOpen, setInsertOpen] = useState(false)
  const insertRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!insertOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !insertRef.current?.contains(event.target)) setInsertOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInsertOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [insertOpen])
  const invoke = (action: () => unknown) => {
    if (!props.documentId || chrome.documentId !== props.documentId || !props.isCurrentDocument(props.documentId)) {
      props.reportError('文档已切换，请在当前文件重新选择操作。'); return
    }
    action()
  }
  const unavailable = props.insertSurface === null
    ? '当前没有可编辑的课件位置。'
    : props.insertSurface === 'spatial' && props.spatialScope !== 'world'
      ? '请切换到无限画布世界层后插入对象。'
      : null
  const flowMediaUnavailable = props.insertSurface === 'flow' && props.editingScope === 'global'
    ? 'Flow 全局层不支持正文媒体；请切换到当前文档页。'
    : null
  const insert = (action: () => void) => {
    setInsertOpen(false)
    invoke(action)
  }
  const audioToDocument = props.insertSurface === 'flow'
  const undoLatestAgent = props.undoLatestAgent
  return <div className="course-light-tools" aria-label="课件常用工具">
    <div className="course-light-tools__row">
      <button type="button" onClick={() => invoke(props.save)}>保存</button>
      <button type="button" disabled={!props.canUndo || props.mode === 'run'} onClick={() => invoke(props.undo)}>撤销</button>
      <button type="button" disabled={!props.canRedo || props.mode === 'run'} onClick={() => invoke(props.redo)}>重做</button>
      {props.canUndoLatestAgent && undoLatestAgent && props.mode === 'edit' && <button type="button" onClick={() => invoke(undoLatestAgent)}>撤销最近 AI 修改</button>}
      {props.mode === 'edit' && <>
        <div className="course-light-tools__insert" ref={insertRef}>
          <button type="button" aria-expanded={insertOpen} aria-controls="course-light-insert-menu" onClick={() => setInsertOpen(open => !open)}>插入</button>
          {insertOpen && <div id="course-light-insert-menu" className="course-light-tools__insert-menu" aria-label="插入内容">
            <button type="button" aria-label="添加文字" disabled={Boolean(unavailable)} title={unavailable ?? undefined} onClick={() => insert(props.onAddText)}>
              <span>文字</span><small>{props.insertSurface === 'flow' ? '当前文档页的段落' : props.insertSurface === 'spatial' ? '世界文本' : '自由文本'}</small>
            </button>
            <button type="button" aria-label="添加图片" disabled={Boolean(unavailable || flowMediaUnavailable)} title={unavailable ?? flowMediaUnavailable ?? undefined} onClick={() => insert(props.onAddImage)}>
              <span>图片</span><small>{props.insertSurface === 'flow' ? '文中图片块' : '当前画布'}</small>
            </button>
            <button type="button" aria-label="添加视频" disabled={Boolean(unavailable || flowMediaUnavailable)} title={unavailable ?? flowMediaUnavailable ?? undefined} onClick={() => insert(props.onAddVideo)}>
              <span>视频</span><small>{props.insertSurface === 'flow' ? '文中视频块' : '当前画布'}</small>
            </button>
            <button type="button" aria-label={audioToDocument ? '插入音频到正文' : '导入音频到声音库'} disabled={props.insertSurface === null || Boolean(audioToDocument && flowMediaUnavailable)} title={flowMediaUnavailable ?? undefined} onClick={() => insert(props.onAddAudio)}>
              <span>音频</span><small>{audioToDocument ? '文中音频块' : '加入声音库供互动播放'}</small>
            </button>
            {unavailable && <p role="status">{unavailable}</p>}
            {flowMediaUnavailable && <p role="status">{flowMediaUnavailable}</p>}
          </div>}
        </div>
      </>}
      {chrome.workbench && <div className="course-light-tools__document-actions">
        {chrome.workbench.documentStatus}
        <button type="button" className="workbench-editor-focus" title="打开图层、完整属性、交互、组件和开发工具" onClick={() => chrome.setMode('deep')}>深度编辑</button>
      </div>}
    </div>
    <div hidden={props.mode !== 'edit'} className="course-light-tools__selection" aria-label="当前选择操作">
      <CourseSelectionTools context={context} invoke={invoke} onDeep={() => chrome.setMode('deep')} documentId={props.documentId ?? ''} onStale={() => invoke(() => props.reportError('选择已改变，未应用旧属性输入；请重新选择后编辑。'))} />
    </div>
  </div>
}

export function CourseSelectionTools({ context, invoke, onDeep, documentId, onStale }: {
  context: PropertiesContext; invoke(action: () => unknown): void; onDeep(): void; documentId: string; onStale(): void
}) {
  const replacement = useRef<HTMLInputElement>(null)
  let tools: ReactNode = null
  let binding = documentId
  if (context.kind === 'slide-native') {
    binding += ':' + context.draftBindingKey
    tools = context.disabledReason ? <p role="status">{context.disabledReason}</p> : <>
      <NativeTools node={context.view} patch={patch => invoke(() => context.commands.patch(patch))}
        replaceImage={() => invoke(context.commands.replaceImage)}
        editText={context.contentEditingEnabled ? () => invoke(() => context.commands.text.beginEdit('canvas')) : undefined} onDeep={onDeep} />
      {!context.contentEditingEnabled && context.view.type === 'text' && <p role="status">此对象当前仅开放样式和位置；文字内容请从深度编辑查看支持范围。</p>}
    </>
  } else if (context.kind === 'multi-selection') {
    tools = <><strong>已选 {context.items.length} 项</strong>
      {context.unavailableReason ? <p role="status">{context.unavailableReason}</p> : <>
        {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((mode, index) => <button type="button" key={mode} disabled={context.items.filter(item => !item.locked).length < 2} onClick={() => invoke(() => context.commands.align(mode))}>{['左对齐', '水平居中', '右对齐', '顶对齐', '垂直居中', '底对齐'][index]}</button>)}
        {context.commands.duplicate && <button type="button" onClick={() => invoke(context.commands.duplicate!)}>复制所选</button>}
        {context.items.some(item => item.locked) && <span role="status">锁定对象保持原位。</span>}
      </>}
    </>
  } else if (context.kind === 'flow-overlay') {
    binding += ':' + context.draftBindingKey
    const entry = context.view.overlayLayers.find(item => item.selectionId === context.selection.selectedOverlayIds.at(-1))
    if (entry) {
      const node = propertiesViewFromLayerItem(entry.item as LayerItem)
      tools = <NativeTools node={node} patch={patch => invoke(() => context.commands.patchOverlayProperties(normalizePropertiesPatch(node, patch)))} replaceImage={() => replacement.current?.click()} onDeep={onDeep} />
    }
  } else if (context.kind === 'flow-block') {
    binding += ':' + context.draftBindingKey
    const block = context.view.blocks.find(entry => entry.blockId === context.selection.selectedBlockId)?.block
    if (block?.type === 'media') tools = <><span>所选{block.mediaKind === 'image' ? '图片' : '媒体'}</span>
      <label className="course-light-tools__file">替换{block.mediaKind === 'image' ? '图片' : '媒体'}<input type="file" accept={block.mediaKind === 'image' ? 'image/*' : undefined} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''
        if (file) void file.arrayBuffer().then(bytes => invoke(() => context.commands.importReplacementMedia({ name: file.name, mimeType: file.type, bytes: new Uint8Array(bytes) }))).catch(() => invoke(() => context.commands.reportError('媒体文件读取失败')))
      }} /></label>
      <button type="button" onClick={() => invoke(() => context.commands.moveSelectedBlock('up'))}>上移</button>
      <button type="button" onClick={() => invoke(() => context.commands.moveSelectedBlock('down'))}>下移</button>
    </>
    else if (block && ['paragraph', 'heading', 'quote', 'list'].includes(block.type)) tools = <>
      <span>在正文中直接输入和选择文字</span>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => invoke(() => context.commands.formatTextStyle({ bold: true }))}>加粗</button>
      <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => invoke(() => context.commands.formatTextStyle({ italic: true }))}>斜体</button>
      <button type="button" onClick={() => invoke(() => context.commands.formatBlock({ kind: 'convert-heading', level: 2 }))}>二级标题</button>
      <button type="button" onClick={() => invoke(() => context.commands.formatBlock({ kind: 'convert-paragraph' }))}>正文</button>
    </>
    else if (block) tools = <><span>当前{block.type === 'table' ? '表格' : block.type === 'chart' ? '图表' : '对象'}可在正文选择；详细属性在深度编辑。</span><button type="button" onClick={onDeep}>详细属性</button></>
  } else if (context.kind === 'spatial-page' || context.kind === 'spatial-graph') {
    tools = <><span>拖动空白处平移，滚轮缩放；选择对象可修改公开属性。</span><button type="button" onClick={() => invoke(context.commands.fitWorldContent)}>查看全部对象</button></>
  } else if (context.kind === 'stale-target') tools = <p role="status">{context.reason}</p>
  return <PropertyDraftBoundary bindingKey={binding} onStale={onStale}>{tools}
    {context.kind === 'flow-overlay' && <input ref={replacement} type="file" accept="image/*" hidden aria-label="替换浮层图片文件" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (file) void file.arrayBuffer().then(bytes => invoke(() => context.commands.importReplacementMedia({ name: file.name, mimeType: file.type, bytes: new Uint8Array(bytes) }))).catch(() => invoke(() => context.commands.reportError('图片读取失败')))
    }} />}
  </PropertyDraftBoundary>
}
function NativeTools({ node, patch, replaceImage, editText, onDeep }: {
  node: PropertiesItemView; patch(patch: PropertiesPatch): void; replaceImage?: () => void; editText?: () => void; onDeep(): void
}) {
  if (node.locked) return <p role="status">“{node.name}”已锁定；在深度编辑的图层面板解锁后可修改。<button type="button" onClick={onDeep}>打开图层</button></p>
  return <><strong>{node.name}</strong>
    {node.type === 'text' && <>
      {editText && <button type="button" onClick={editText}>编辑文字</button>}
      <BufferedInput label="字号" type="number" min={8} max={400} value={node.style.fontSize} onCommit={value => patch({ style: { fontSize: Number(value) } })} />
      <button type="button" aria-pressed={node.style.bold} onMouseDown={event => event.preventDefault()} onClick={() => patch({ style: { bold: !node.style.bold } })}>加粗</button>
      <button type="button" aria-pressed={node.style.italic} onMouseDown={event => event.preventDefault()} onClick={() => patch({ style: { italic: !node.style.italic } })}>斜体</button>
      <ColorInput id="light-text-color" label="文字颜色" value={node.style.color} onChange={color => patch({ style: { color } })} />
    </>}
    {node.type === 'image' && replaceImage && <button type="button" onClick={replaceImage}>替换图片</button>}
    <BufferedInput label="X" type="number" value={Math.round(node.x)} onCommit={value => patch({ x: Number(value) })} />
    <BufferedInput label="Y" type="number" value={Math.round(node.y)} onCommit={value => patch({ y: Number(value) })} />
    <BufferedInput label="宽" type="number" min={1} value={Math.round(node.width)} onCommit={value => patch({ width: Number(value) })} />
    <BufferedInput label="高" type="number" min={1} value={Math.round(node.height)} onCommit={value => patch({ height: Number(value) })} />
    {!['text', 'image', 'shape'].includes(node.type) && <><span>位置和尺寸可直接编辑；结构与参数使用深度编辑。</span><button type="button" onClick={onDeep}>详细属性</button></>}
  </>
}
