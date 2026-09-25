import { AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, AlignHorizontalJustifyStart, Baseline, Bold, Highlighter, ImageIcon, Italic, PaintBucket, Pencil, Play, Repeat, Square, Underline, Unlock, VolumeX } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { isStrokeOnlyShapeType } from '../../shared/contracts/native-v1'
import { useCourseEditorActions } from '../documents/CourseEditorActionsContext'
import { planLayerOrder, type LayerOrderMove } from '../editing/quickbar/layerOrder'
import { rotatedBoundingBox, unionBoxes, visibleBounds, type QuickBarBounds, type QuickBarRect } from '../editing/quickbar/placeQuickBar'
import { QuickBarAiButton, QuickBarButton, QuickBarColorButton, QuickBarLabel, QuickBarMenu, QuickBarPopoverButton, QuickBarSeparator, SelectionQuickBar, type QuickBarMenuItem } from '../editing/quickbar/SelectionQuickBar'
import { usePointerGesture } from '../editing/quickbar/usePointerGesture'
import { selectEffectiveLayerProjection, useEditorStore } from '../store/editorStore'
import { usePropertiesContext } from '../ui/properties/PropertiesContextAdapter'
import type { PropertiesContext } from '../ui/properties/PropertiesContext'
import type { FlowPropertiesContext } from '../ui/properties/FlowPropertiesPanel'
import type { PropertiesItemView, PropertiesPatch } from '../ui/properties/SlideNativePropertiesPanel'
import { normalizePropertiesPatch, propertiesViewFromLayerItem } from '../ui/properties/propertiesItemView'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { captureCourseObjectSelection, matchesCourseObjectState, usePinnedSelection, workbenchSelection } from './SelectionContextController'
import './selectionContext.css'

type ObjectProperties = Extract<PropertiesContext, { kind: 'slide-native' | 'multi-selection' }>
/** One selected object, whichever surface owns it. */
interface SingleObject { view: PropertiesItemView; patch(patch: PropertiesPatch): void; replaceImage?: () => void; editText?: () => void; disabledReason: string | null }
type Box = QuickBarRect & { rotation?: number }

/** The Store selection and the document selection must identify the same objects. */
export function matchesObjectProperties(context: PropertiesContext, itemIds: readonly string[]): context is ObjectProperties {
  if (context.kind === 'slide-native') return itemIds.length === 1 && context.view.id === itemIds[0]
  if (context.kind !== 'multi-selection' || itemIds.length < 2 || context.items.length !== itemIds.length) return false
  const ids = new Set(context.items.map(item => item.id))
  return ids.size === itemIds.length && itemIds.every(id => ids.has(id))
}
/** A Flow paper object selected alone, as the properties context reports it. */
function matchesFlowOverlay(context: PropertiesContext, itemIds: readonly string[]): context is FlowPropertiesContext {
  return context.kind === 'flow-overlay' && itemIds.length === 1 && context.selection.selectedOverlayIds.length === 1 && context.selection.selectedOverlayIds[0] === itemIds[0]
}

const FONT_SIZE_MIN = 8, FONT_SIZE_MAX = 400
export function stepFontSize(size: number, direction: 1 | -1): number {
  const step = size < 24 ? 2 : size < 72 ? 4 : 8
  return Math.max(FONT_SIZE_MIN, Math.min(FONT_SIZE_MAX, Math.round(size) + direction * step))
}
const ALIGN_ORDER = ['left', 'center', 'right'] as const
const ALIGN_ICON = { left: <AlignLeft size={14} />, center: <AlignCenter size={14} />, right: <AlignRight size={14} /> }
const ALIGN_LABEL = { left: '左对齐', center: '居中', right: '右对齐' }

function run(action: () => unknown, onError: (message: string) => void) {
  try { action() } catch (error) { onError(error instanceof Error ? error.message : String(error)) }
}

/** Type-specific common actions of one selected object; everything else stays in the editor. */
function ObjectActions({ view, patch, replaceImage, editText }: { view: PropertiesItemView; patch(patch: PropertiesPatch): void; replaceImage?: () => void; editText?: () => void }) {
  if (view.type === 'text') {
    const align = ALIGN_ORDER.includes(view.style.align) ? view.style.align : 'left'
    const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(align) + 1) % ALIGN_ORDER.length]!
    return <>
      {editText && <QuickBarButton label="编辑文字" icon={<Pencil size={14} />} onClick={editText} />}
      <QuickBarButton label="加粗" icon={<Bold size={14} />} pressed={view.style.bold} onClick={() => patch({ style: { bold: !view.style.bold } })} />
      <QuickBarButton label="斜体" icon={<Italic size={14} />} pressed={view.style.italic} onClick={() => patch({ style: { italic: !view.style.italic } })} />
      <QuickBarButton label="下划线" icon={<Underline size={14} />} pressed={view.style.underline} onClick={() => patch({ style: { underline: !view.style.underline } })} />
      <QuickBarButton label="减小字号" icon={<AArrowDown size={15} />} disabled={view.style.fontSize <= FONT_SIZE_MIN} onClick={() => patch({ style: { fontSize: stepFontSize(view.style.fontSize, -1) } })} />
      <QuickBarLabel>{Math.round(view.style.fontSize)}</QuickBarLabel>
      <QuickBarButton label="增大字号" icon={<AArrowUp size={15} />} disabled={view.style.fontSize >= FONT_SIZE_MAX} onClick={() => patch({ style: { fontSize: stepFontSize(view.style.fontSize, 1) } })} />
      <QuickBarColorButton label="文字颜色" icon={<Baseline size={14} />} value={view.style.color} onPick={color => { if (color) patch({ style: { color } }) }} />
      <QuickBarColorButton label="高亮" icon={<Highlighter size={14} />} variant="highlight" value={view.style.highlightColor} onPick={highlightColor => patch({ style: { highlightColor } })} />
      <QuickBarButton label={`${ALIGN_LABEL[align]}（点按切换为${ALIGN_LABEL[next]}）`} icon={ALIGN_ICON[align]} onClick={() => patch({ style: { align: next } })} />
    </>
  }
  if (view.type === 'formula') return <QuickBarColorButton label="公式颜色" icon={<Baseline size={14} />} value={view.style.color} onPick={color => { if (color) patch({ style: { color } }) }} />
  if (view.type === 'image') return replaceImage ? <QuickBarButton label="替换图片" text="替换" icon={<ImageIcon size={14} />} onClick={replaceImage} /> : null
  if (view.type === 'video') return <>
    <QuickBarButton label="自动播放" icon={<Play size={14} />} pressed={view.autoplay} onClick={() => patch({ autoplay: !view.autoplay })} />
    <QuickBarButton label="循环播放" icon={<Repeat size={14} />} pressed={view.loop} onClick={() => patch({ loop: !view.loop })} />
    <QuickBarButton label="静音" icon={<VolumeX size={14} />} pressed={view.muted} onClick={() => patch({ muted: !view.muted })} />
  </>
  if (view.type === 'shape') return <>
    {!isStrokeOnlyShapeType(view.shapeType) && <QuickBarColorButton label="填充颜色" icon={<PaintBucket size={14} />} value={view.style.fillColor} onPick={fillColor => { if (fillColor) patch({ style: { fillColor } }) }} />}
    <QuickBarColorButton label={isStrokeOnlyShapeType(view.shapeType) ? '线条颜色' : '边框颜色'} icon={<Square size={14} />} value={view.style.borderColor} onPick={borderColor => { if (borderColor) patch({ style: { borderColor } }) }} />
  </>
  return null
}

const MULTI_ALIGN = [['left', '左对齐'], ['center', '水平居中'], ['right', '右对齐'], ['top', '顶对齐'], ['middle', '垂直居中'], ['bottom', '底对齐']] as const

export function NativeSelectionContext({ documentId, revision, locationId, itemIds, stateId, sceneItemIds = [], enabled, bounds, textEditing = false, ownsDocumentSelection = true }: {
  documentId?: string | null; revision: number; locationId?: string | null; itemIds: readonly string[]; stateId?: string | null; sceneItemIds?: readonly string[]; enabled: boolean
  bounds?(itemId: string): Box | null
  /** The text editing toolbar owns the selection while its text is edited. */
  textEditing?: boolean
  /** Whether this control reports the document's current selection; Flow's text selection reports its own. */
  ownsDocumentSelection?: boolean
}) {
  const marker = useRef<HTMLSpanElement>(null)
  const replacement = useRef<HTMLInputElement>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const actions = useCourseEditorActions()
  const context = usePropertiesContext({ onReplaceImage: () => actions?.replaceImage() })
  useSyncExternalStore(workbenchSelection.subscribe, workbenchSelection.readVersion)
  const pinned = usePinnedSelection(documentId)
  const gesture = usePointerGesture(root)
  const [pinnedBoxes, setPinnedBoxes] = useState<Box[]>([])
  const [anchor, setAnchor] = useState<QuickBarRect | null>(null)
  const [view, setView] = useState<QuickBarBounds | null>(null)
  const [notice, setNotice] = useState('')
  const ids = JSON.stringify(itemIds), sceneIds = JSON.stringify(sceneItemIds)
  useLayoutEffect(() => { setRoot(marker.current?.closest('main') ?? null) }, [])
  useEffect(() => { setNotice('') }, [documentId, locationId, ids, stateId])
  useEffect(() => {
    if (!documentId || !ownsDocumentSelection) return
    void workbenchSelection.observe(documentId, revision, snapshot => enabled && locationId && itemIds.length
      ? captureCourseObjectSelection(snapshot, locationId, itemIds, stateId) : null)
  }, [documentId, revision, locationId, ids, stateId, enabled, ownsDocumentSelection])
  useLayoutEffect(() => {
    if (!root) return
    const selectedPinned = pinned?.targets.flatMap(t => t.kind === 'course-object' && matchesCourseObjectState(t, locationId, stateId, sceneItemIds.includes(t.itemId)) ? [t.itemId] : []) ?? []
    const locate = (id: string): Box | null => {
      const explicit = bounds?.(id)
      if (explicit) return explicit
      const element = [...root.querySelectorAll<HTMLElement>('[data-layer-item-id]')].find(element => element.dataset.layerItemId === id)
      const rect = element?.getBoundingClientRect()
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null
    }
    const paint = () => {
      const nextView = visibleBounds(root)
      setView(previous => JSON.stringify(previous) === JSON.stringify(nextView) ? previous : nextView)
      const nextPinned = selectedPinned.flatMap(id => { const box = locate(id); return box ? [box] : [] })
      setPinnedBoxes(previous => JSON.stringify(previous) === JSON.stringify(nextPinned) ? previous : nextPinned)
      const nextAnchor = unionBoxes(itemIds.flatMap(id => { const box = locate(id); return box ? [rotatedBoundingBox(box)] : [] }))
      setAnchor(previous => JSON.stringify(previous) === JSON.stringify(nextAnchor) ? previous : nextAnchor)
    }
    paint(); window.addEventListener('resize', paint); window.addEventListener('scroll', paint, true)
    const observer = new MutationObserver(paint); observer.observe(root, { childList: true, subtree: true })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint)
    resized?.observe(root)
    return () => { observer.disconnect(); resized?.disconnect(); window.removeEventListener('resize', paint); window.removeEventListener('scroll', paint, true) }
  }, [root, pinned, locationId, stateId, sceneIds, ids, bounds])
  const selection = enabled && itemIds.length && matchesObjectProperties(context, itemIds) ? context : null
  const overlay = enabled && matchesFlowOverlay(context, itemIds) ? context : null
  const report = (message: string) => setNotice(message)
  let single: SingleObject | null = null
  if (selection?.kind === 'slide-native') single = { view: selection.view, disabledReason: selection.disabledReason,
    patch: value => run(() => selection.commands.patch(value), report),
    replaceImage: actions ? () => run(selection.commands.replaceImage, report) : undefined,
    editText: selection.contentEditingEnabled ? () => run(() => selection.commands.text.beginEdit('canvas'), report) : undefined }
  else if (overlay) {
    const entry = overlay.view.overlayLayers.find(item => item.selectionId === itemIds[0])
    if (entry) {
      const view = propertiesViewFromLayerItem(entry.item as LayerItem)
      single = { view, disabledReason: null, patch: value => run(() => overlay.commands.patchOverlayProperties(normalizePropertiesPatch(view, value)), report),
        replaceImage: () => replacement.current?.click() }
    }
  }
  const store = () => useEditorStore.getState()
  const reorder = (move: LayerOrderMove) => run(() => {
    const projection = selectEffectiveLayerProjection(store())
    const order = projection && itemIds.length === 1 ? planLayerOrder(projection.unifiedRows, itemIds[0]!, move) : null
    if (order) store().reorderNodes(order)
  }, report)
  const layerRows = single ? selectEffectiveLayerProjection(store())?.unifiedRows ?? [] : []
  const canMove = (move: LayerOrderMove) => itemIds.length === 1 && Boolean(planLayerOrder(layerRows, itemIds[0]!, move))
  // Capture when sending, so the request always names the objects selected now.
  const ai = <QuickBarAiButton targetLabel={itemIds.length > 1 ? `所选 ${itemIds.length} 个对象` : single ? `“${single.view.name}”` : '所选对象'}
    onSubmit={async instruction => {
      if (!documentId || !locationId) throw new Error('文档尚未就绪，请重新选择。')
      const snapshot = await workbenchSelection.prepare(documentId)
      await workbenchSelection.request(captureCourseObjectSelection(snapshot, locationId, itemIds, stateId), instruction)
    }} />
  let content: ReactNode = null
  if (single) {
    const node = single.view, patch = single.patch
    if (single.disabledReason) content = <><span title={single.disabledReason}><QuickBarLabel>此处不可编辑</QuickBarLabel></span><QuickBarSeparator />{ai}</>
    else if (node.locked) content = <><QuickBarLabel>已锁定</QuickBarLabel><QuickBarButton label="解锁" text="解锁" icon={<Unlock size={14} />} onClick={() => patch({ locked: false })} /><QuickBarSeparator />{ai}</>
    else {
      const items: QuickBarMenuItem[] = [
        { label: '复制', group: 'edit', onSelect: () => run(() => store().duplicateSelectedNodes(), report) },
        { label: '删除', group: 'edit', danger: true, onSelect: () => run(() => store().deleteSelectedNodes(), report) },
        { label: '上移一层', group: 'order', disabled: !canMove('forward'), onSelect: () => reorder('forward') },
        { label: '下移一层', group: 'order', disabled: !canMove('backward'), onSelect: () => reorder('backward') },
        { label: '置于顶层', group: 'order', disabled: !canMove('front'), onSelect: () => reorder('front') },
        { label: '置于底层', group: 'order', disabled: !canMove('back'), onSelect: () => reorder('back') },
        { label: '锁定', group: 'state', onSelect: () => patch({ locked: true }) },
        { label: '隐藏', group: 'state', onSelect: () => patch({ visible: false }) },
      ]
      content = <>
        <ObjectActions view={node} patch={patch} replaceImage={single.replaceImage} editText={single.editText} />
        {node.type !== 'table' && node.type !== 'chart' && node.type !== 'input' && node.type !== 'external-component' && node.type !== 'runtime' && <QuickBarSeparator />}
        {ai}<QuickBarMenu items={items} />
      </>
    }
  } else if (selection?.kind === 'multi-selection') {
    const commands = selection.commands
    const unlocked = selection.items.filter(item => !item.locked).length
    const items: QuickBarMenuItem[] = [
      ...(commands.duplicate ? [{ label: '复制所选', group: 'edit', onSelect: () => run(commands.duplicate!, report) }] : []),
      ...(commands.remove ? [{ label: '删除所选', group: 'edit', danger: true, onSelect: () => run(commands.remove!, report) }] : []),
      { label: '横向等距分布', group: 'layout', disabled: unlocked < 3, onSelect: () => run(() => commands.distribute('horizontal'), report) },
      { label: '纵向等距分布', group: 'layout', disabled: unlocked < 3, onSelect: () => run(() => commands.distribute('vertical'), report) },
      { label: '全部锁定', group: 'state', onSelect: () => run(() => commands.setLocked(true), report) },
      { label: '全部解锁', group: 'state', onSelect: () => run(() => commands.setLocked(false), report) },
      { label: '全部隐藏', group: 'state', onSelect: () => run(() => commands.setVisible(false), report) },
    ]
    content = <>
      <QuickBarLabel>已选 {selection.items.length} 项</QuickBarLabel>
      {selection.unavailableReason ? <span title={selection.unavailableReason}><QuickBarLabel>部分操作不可用</QuickBarLabel></span>
        : <QuickBarPopoverButton label="对齐" icon={<AlignHorizontalJustifyStart size={14} />} disabled={unlocked < 2} popupRole="menu">
          {close => <div className="selection-quick-bar__menu" role="menu" aria-label="对齐">
            {MULTI_ALIGN.map(([mode, label]) => <button key={mode} type="button" role="menuitem" onMouseDown={event => event.preventDefault()}
              onClick={() => { close(); run(() => commands.align(mode), report) }}>{label}</button>)}
          </div>}
        </QuickBarPopoverButton>}
      <QuickBarSeparator />{ai}<QuickBarMenu items={items} />
    </>
  }
  if (!enabled) return null
  return <span ref={marker} className="native-selection-context" aria-hidden="true">
    {overlay && <input ref={replacement} type="file" accept="image/*" hidden tabIndex={-1} aria-label="替换浮层图片文件" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (file) void file.arrayBuffer().then(bytes => overlay.commands.importReplacementMedia({ name: file.name, mimeType: file.type, bytes: new Uint8Array(bytes) }))
        .catch(() => report('图片读取失败'))
    }} />}
    {pinnedBoxes.map((box, index) => <span key={index} aria-hidden="true" data-pinned-object="true" className="native-selection-context__pinned"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }} />)}
    {content && <SelectionQuickBar label="选中对象快捷工具" anchor={anchor} bounds={view} suspended={gesture || textEditing} selectionKey={`${documentId}:${locationId}:${stateId}:${ids}`}>
      {content}
      {notice && <span role="alert" className="selection-quick-bar__notice" title={notice}>{notice}</span>}
    </SelectionQuickBar>}
  </span>
}
