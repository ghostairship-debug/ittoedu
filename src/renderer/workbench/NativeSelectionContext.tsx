import { AArrowDown, AArrowUp, AlignCenter, AlignLeft, AlignRight, AlignHorizontalJustifyStart, Baseline, Bold, ChevronsDownUp, ChevronsUpDown, Crop, Eye, EyeOff, Film, Highlighter, ImageIcon, Lock, Italic, PaintBucket, Pencil, Play, Repeat, Scan, Sigma, Square, Type, Underline, Unlock, VolumeX } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { isStrokeOnlyShapeType } from '../../shared/contracts/native-v1'
import { useCourseEditorActions } from '../documents/CourseEditorActionsContext'
import { selectionObjectCommands } from '../composition/selection/selectionObjectCommands'
import { useContextMenu, type MenuCommand } from '../editing/commands/CommandMenu'
import { IMAGE_FIT_LABEL, multiObjectCommands, singleObjectCommands, type SingleObjectState } from '../editing/commands/objectCommands'
import { OBJECT_CONTEXT_MENU_EVENT, requestObjectEdit, type ObjectContextMenuRequest } from '../editing/commands/objectContextMenu'
import { ImageCropOverlay } from '../editing/crop/ImageCropOverlay'
import { ElementAiButton } from './elementCards/ElementAiCard'
import { rotatedBoundingBox, unionBoxes, visibleBounds, type QuickBarBounds, type QuickBarRect } from '../editing/quickbar/placeQuickBar'
import { QuickBarAiButton, QuickBarButton, QuickBarColorButton, QuickBarLabel, QuickBarMenu, QuickBarPopoverButton, QuickBarSeparator, SelectionQuickBar } from '../editing/quickbar/SelectionQuickBar'
import { usePointerGesture } from '../editing/quickbar/usePointerGesture'
import { usePropertiesContext } from '../ui/properties/PropertiesContextAdapter'
import type { PropertiesContext } from '../ui/properties/PropertiesContext'
import type { FlowPropertiesContext } from '../ui/properties/FlowPropertiesPanel'
import type { PropertiesItemView, PropertiesPatch } from '../ui/properties/SlideNativePropertiesPanel'
import { normalizePropertiesPatch, propertiesViewFromLayerItem } from '../ui/properties/propertiesItemView'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { captureCourseObjectSelection, matchesCourseObjectState, usePinnedSelection, workbenchSelection } from './SelectionContextController'
import { RuntimePageTextList } from './RuntimePageText'
import './selectionContext.css'

type ObjectProperties = Extract<PropertiesContext, { kind: 'slide-native' | 'multi-selection' }>
type GlobalProperties = Extract<PropertiesContext, { kind: 'course-global' }>
type GlobalObjectProperties = GlobalProperties & { readonly selected: NonNullable<GlobalProperties['selected']> }
/** One selected object, whichever surface owns it. */
interface SingleObject { view: PropertiesItemView; patch(patch: PropertiesPatch): void; replaceImage?: () => void; editText?: () => void; disabledReason: string | null; controller?: boolean }
type Box = QuickBarRect & { rotation?: number }

/** The Store selection and the document selection must identify the same objects. */
export function matchesObjectProperties(context: PropertiesContext, itemIds: readonly string[]): context is ObjectProperties {
  if (context.kind === 'slide-native') return itemIds.length === 1 && context.view.id === itemIds[0]
  if (context.kind !== 'multi-selection' || itemIds.length < 2 || context.items.length !== itemIds.length) return false
  const ids = new Set(context.items.map(item => item.id))
  return ids.size === itemIds.length && itemIds.every(id => ids.has(id))
}
/** A global-layer object (the teacher controller among them) selected alone. */
function matchesGlobalObject(context: PropertiesContext, itemIds: readonly string[]): context is GlobalObjectProperties {
  return context.kind === 'course-global' && context.mode === 'selected' && itemIds.length === 1 && context.selected?.view.id === itemIds[0]
}
/** A Flow paper object selected alone, as the properties context reports it. */
function matchesFlowOverlay(context: PropertiesContext, itemIds: readonly string[]): context is FlowPropertiesContext {
  return context.kind === 'flow-overlay' && itemIds.length === 1 && context.selection.selectedOverlayIds.length === 1 && context.selection.selectedOverlayIds[0] === itemIds[0]
}

const FONT_SIZE_MIN = 8, FONT_SIZE_MAX = 400
/** Canvas selections draw a rotation handle about 25px above the frame; the bar stays clear of it. */
const ROTATION_HANDLE_CLEARANCE = 34
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

/** What an element's AI card calls it: the start of its text, else its name. */
function elementLabel(view: PropertiesItemView): string {
  const text = view.type === 'text' ? view.text.replace(/\s+/g, ' ').trim().slice(0, 16) : ''
  return text || view.name || '所选对象'
}

/** Type-specific common actions of one selected object; everything else stays in the editor. */
function ObjectActions({ view, patch, replaceImage, editText, extra = {} }: { view: PropertiesItemView; patch(patch: PropertiesPatch): void; replaceImage?: () => void; editText?: () => void; extra?: Pick<SingleObjectState, 'editFormula' | 'crop' | 'fit' | 'replaceVideo'> }) {
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
  if (view.type === 'formula') return <>
    {extra.editFormula && <QuickBarButton label="编辑公式" icon={<Sigma size={14} />} onClick={extra.editFormula} />}
    <QuickBarColorButton label="公式颜色" icon={<Baseline size={14} />} value={view.style.color} onPick={color => { if (color) patch({ style: { color } }) }} />
  </>
  if (view.type === 'image') {
    const { crop, fit } = extra
    return <>
      {replaceImage && <QuickBarButton label="替换图片" text="替换" icon={<ImageIcon size={14} />} onClick={replaceImage} />}
      {crop && <QuickBarButton label={crop.disabledReason ?? '裁剪'} text="裁剪" icon={<Crop size={14} />} disabled={Boolean(crop.disabledReason)} onClick={crop.run} />}
      {fit && <QuickBarPopoverButton label="显示方式" text={IMAGE_FIT_LABEL[fit.value].replace(/（.*）/, '')} icon={<Scan size={14} />} popoverLabel="显示方式" popupRole="menu">
        {close => <div className="selection-quick-bar__menu" role="menu" aria-label="显示方式">
          {(['contain', 'cover', 'stretch'] as const).map(mode => <button key={mode} type="button" role="menuitemradio" aria-checked={fit.value === mode}
            onMouseDown={event => event.preventDefault()} onClick={() => { close(); if (fit.value !== mode) fit.set(mode) }}>{IMAGE_FIT_LABEL[mode]}</button>)}
        </div>}
      </QuickBarPopoverButton>}
    </>
  }
  if (view.type === 'video') return <>
    {extra.replaceVideo && <QuickBarButton label="替换视频" text="替换" icon={<Film size={14} />} onClick={extra.replaceVideo} />}
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
const sortedIds = (ids: readonly string[]) => JSON.stringify([...ids].sort())

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
  // The image being cropped in place (M21); any change of selection ends it.
  const [cropping, setCropping] = useState<string | null>(null)
  const ids = JSON.stringify(itemIds), sceneIds = JSON.stringify(sceneItemIds)
  useLayoutEffect(() => { setRoot(marker.current?.closest('main') ?? null) }, [])
  // Right-click: the workspace selects what is under the pointer and asks for that selection's menu (M21).
  const contextMenu = useContextMenu()
  const menuRequestState = useRef<{ ids: string; items: MenuCommand[] }>({ ids: '[]', items: [] })
  useEffect(() => {
    if (!root) return
    const request = (event: Event) => {
      const detail = (event as CustomEvent<ObjectContextMenuRequest>).detail
      const current = menuRequestState.current
      if (!detail || sortedIds(detail.itemIds) !== current.ids || !current.items.length) return
      event.preventDefault()
      contextMenu.open({ x: detail.x, y: detail.y }, '对象操作', [...(detail.extra ?? []), ...current.items])
    }
    root.addEventListener(OBJECT_CONTEXT_MENU_EVENT, request)
    return () => root.removeEventListener(OBJECT_CONTEXT_MENU_EVENT, request)
  }, [root, contextMenu.open])
  useEffect(() => { setNotice(''); setCropping(null) }, [documentId, locationId, ids, stateId])
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
      // A teacher controller is anchored where it is shown (collapsed, kept in view), not at its stored full frame.
      const element = [...root.querySelectorAll<HTMLElement>('[data-controller-authoring-id]')].find(element => element.dataset.controllerAuthoringId === id)
        ?? [...root.querySelectorAll<HTMLElement>('[data-layer-item-id]')].find(element => element.dataset.layerItemId === id)
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
  const global = enabled && !overlay && matchesGlobalObject(context, itemIds) ? context : null
  const report = (message: string) => setNotice(message)
  let single: SingleObject | null = null
  if (selection?.kind === 'slide-native') single = { view: selection.view, disabledReason: selection.disabledReason,
    patch: value => run(() => selection.commands.patch(value), report),
    replaceImage: actions ? () => run(selection.commands.replaceImage, report) : undefined,
    editText: selection.contentEditingEnabled ? () => run(() => selection.commands.text.beginEdit('canvas'), report) : undefined }
  else if (global) single = { view: global.selected.view, disabledReason: global.disabledReason,
    patch: value => run(() => global.commands.patch(value), report),
    replaceImage: actions ? () => run(global.commands.replaceImage, report) : undefined,
    editText: global.selected.contentEditingEnabled && global.selected.view.type === 'text' ? () => run(() => global.commands.text.beginEdit('canvas'), report) : undefined,
    controller: Boolean(global.selected.controllerComponent) }
  else if (overlay) {
    const entry = overlay.view.overlayLayers.find(item => item.selectionId === itemIds[0])
    if (entry) {
      const view = propertiesViewFromLayerItem(entry.item as LayerItem)
      single = { view, disabledReason: null, patch: value => run(() => overlay.commands.patchOverlayProperties(normalizePropertiesPatch(view, value)), report),
        replaceImage: () => replacement.current?.click() }
    }
  }
  // Commands report a failure next to the bar instead of throwing into React.
  const guarded = (items: MenuCommand[]): MenuCommand[] => items.map(item => ({ ...item, run: () => run(item.run, report) }))
  // Capture when sending, so the request always names the objects selected now.
  const captureSelected = async () => {
    if (!documentId || !locationId) throw new Error('文档尚未就绪，请重新选择。')
    return captureCourseObjectSelection(await workbenchSelection.prepare(documentId), locationId, itemIds, stateId)
  }
  // One object has its own AI card (M15); several objects still go to the assistant as one request.
  const ai = single && documentId && locationId && itemIds.length === 1
    ? <ElementAiButton documentId={documentId} target={{ kind: 'course-object', locationId, itemId: itemIds[0]! }} label={elementLabel(single.view)} capture={captureSelected} />
    : <QuickBarAiButton targetLabel={itemIds.length > 1 ? `所选 ${itemIds.length} 个对象` : '所选对象'}
      onSubmit={async instruction => { await workbenchSelection.request(await captureSelected(), instruction) }} />
  let content: ReactNode = null
  // The selection's right-click menu: the whole list, from the same definitions as the bar's "⋯".
  let contextItems: MenuCommand[] = []
  if (single) {
    const node = single.view, patch = single.patch
    // Cropping and replacing a video are Slide-page tools for now (M21).
    const slidePage = selection?.kind === 'slide-native' && !selection.spatialMode
    const objectState: SingleObjectState = { locked: node.locked, visible: node.visible, disabledReason: single.disabledReason,
      setLocked: (locked: boolean) => patch({ locked }), setVisible: (visible: boolean) => patch({ visible }),
      // The main action matches the quick bar's button for the type: 编辑文字 for text, 编辑公式 for formulas, 替换图片 and
      // 裁剪 for images, 替换视频 for videos.
      editText: node.type === 'text' ? single.editText : undefined,
      // The canvas opens its formula editor on request, as a double-click does.
      editFormula: node.type === 'formula' && single.editText ? () => { if (!root || !requestObjectEdit(root, node.id)) report('公式编辑器现在打不开，请双击公式再试。') } : undefined,
      replaceImage: node.type === 'image' ? single.replaceImage : undefined,
      crop: node.type === 'image' && bounds && slidePage
        ? { run: () => setCropping(node.id), disabledReason: node.rotation ? '旋转的图片请先把旋转归零再裁剪' : null } : undefined,
      fit: node.type === 'image' ? { value: node.fit, set: fit => patch({ fit }) } : undefined,
      replaceVideo: node.type === 'video' && slidePage && actions?.replaceVideo ? () => actions.replaceVideo?.() : undefined,
    }
    const ports = selectionObjectCommands.portsFor(itemIds[0]!)
    const collapsed = node.type === 'external-component' && node.props.collapsible === true && node.props.defaultCollapsed === true
    const toggleCollapsed = () => { if (node.type === 'external-component') patch({ props: { ...node.props, collapsible: true, defaultCollapsed: !collapsed } }) }
    contextItems = guarded(single.controller && node.type === 'external-component' ? [
      // The teacher controller: how playback starts it, and hiding or locking it in place.
      { id: 'controller.toggle', label: collapsed ? '展开（播放时默认展开）' : '收起（播放时默认收起）', group: 'controller', run: toggleCollapsed,
        disabledReason: single.disabledReason ?? (node.locked ? '对象已锁定，请先解锁' : null) },
      node.visible ? { id: 'object.hide', label: '隐藏', group: 'state', run: () => patch({ visible: false }), disabledReason: single.disabledReason }
        : { id: 'object.show', label: '显示', group: 'state', run: () => patch({ visible: true }), disabledReason: single.disabledReason },
      node.locked ? { id: 'object.unlock', label: '解锁', group: 'state', run: () => patch({ locked: false }), disabledReason: single.disabledReason }
        : { id: 'object.lock', label: '锁定', group: 'state', run: () => patch({ locked: true }), disabledReason: single.disabledReason },
    ] : singleObjectCommands(objectState, ports, { primary: true }))
    if (single.disabledReason) content = <><span title={single.disabledReason}><QuickBarLabel>此处不可编辑</QuickBarLabel></span><QuickBarSeparator />{ai}</>
    // A hidden object stays selected until the selection moves on, so it can be shown again in place.
    else if (!node.visible) content = <><QuickBarLabel>已隐藏</QuickBarLabel><QuickBarButton label="显示" text="显示" icon={<Eye size={14} />} onClick={() => patch({ visible: true })} /><QuickBarSeparator />{ai}</>
    else if (node.locked) content = <><QuickBarLabel>已锁定</QuickBarLabel><QuickBarButton label="解锁" text="解锁" icon={<Unlock size={14} />} onClick={() => patch({ locked: false })} /><QuickBarSeparator />{ai}</>
    else if (single.controller && node.type === 'external-component') {
      content = <>
        <QuickBarLabel>教师控制台</QuickBarLabel>
        <QuickBarButton label={collapsed ? '展开（播放时默认展开）' : '收起（播放时默认收起）'} text={collapsed ? '展开' : '收起'}
          icon={collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          onClick={toggleCollapsed} />
        <QuickBarButton label="隐藏" text="隐藏" icon={<EyeOff size={14} />} onClick={() => patch({ visible: false })} />
        <QuickBarButton label="锁定" text="锁定" icon={<Lock size={14} />} onClick={() => patch({ locked: true })} />
        <QuickBarSeparator />{ai}
      </>
    }
    else {
      content = <>
        <ObjectActions view={node} patch={patch} replaceImage={single.replaceImage} editText={single.editText} extra={objectState} />
        {node.type === 'runtime' && <QuickBarPopoverButton label="页面文字" text="页面文字" icon={<Type size={14} />} popoverLabel="页面文字">
          {() => <RuntimePageTextList itemId={node.id} onError={report} />}
        </QuickBarPopoverButton>}
        {node.type !== 'table' && node.type !== 'chart' && node.type !== 'input' && node.type !== 'external-component' && <QuickBarSeparator />}
        {ai}<QuickBarMenu items={guarded(singleObjectCommands(objectState, ports))} />
      </>
    }
  } else if (selection?.kind === 'multi-selection') {
    const commands = selection.commands
    const unlocked = selection.items.filter(item => !item.locked).length
    const allHidden = selection.items.every(item => !item.visible)
    const show = () => run(() => commands.setVisible(true), report)
    const items = guarded(multiObjectCommands({
      count: selection.items.length, unlocked, allHidden, duplicate: commands.duplicate, remove: commands.remove,
      distribute: axis => commands.distribute(axis), setLocked: locked => commands.setLocked(locked), setVisible: visible => commands.setVisible(visible),
    }, selectionObjectCommands))
    const alignReason = selection.unavailableReason ?? (unlocked < 2 ? '至少需要 2 个未锁定对象' : null)
    contextItems = [...items, ...guarded(MULTI_ALIGN.map(([mode, label]): MenuCommand => ({
      id: `objects.align.${mode}`, label, group: 'align', run: () => commands.align(mode), disabledReason: alignReason,
    })))]
    content = <>
      <QuickBarLabel>已选 {selection.items.length} 项{allHidden ? '（已隐藏）' : ''}</QuickBarLabel>
      {allHidden ? <QuickBarButton label="全部显示" text="显示" icon={<Eye size={14} />} onClick={show} />
        : selection.unavailableReason ? <span title={selection.unavailableReason}><QuickBarLabel>部分操作不可用</QuickBarLabel></span>
        : <QuickBarPopoverButton label="对齐" icon={<AlignHorizontalJustifyStart size={14} />} disabled={unlocked < 2} popupRole="menu">
          {close => <div className="selection-quick-bar__menu" role="menu" aria-label="对齐">
            {MULTI_ALIGN.map(([mode, label]) => <button key={mode} type="button" role="menuitem" onMouseDown={event => event.preventDefault()}
              onClick={() => { close(); run(() => commands.align(mode), report) }}>{label}</button>)}
          </div>}
        </QuickBarPopoverButton>}
      <QuickBarSeparator />{ai}<QuickBarMenu items={items} />
    </>
  }
  menuRequestState.current = { ids: sortedIds(itemIds), items: contextItems }
  if (!enabled) return null
  // The in-place crop of the selected image, drawn over the canvas while it runs (M21).
  const cropView = cropping && single?.view.type === 'image' && single.view.id === cropping ? single.view : null
  const cropScreen = cropView ? bounds?.(cropView.id) ?? null : null
  const cropSource = cropView ? selectionObjectCommands.imageSource(cropView.assetId) : null
  const cropPatch = single?.patch
  const cropElement = cropView && cropScreen && cropSource && cropPatch ? <ImageCropOverlay screen={cropScreen}
    image={{ frame: { x: cropView.x, y: cropView.y, width: cropView.width, height: cropView.height }, crop: cropView.crop, fit: cropView.fit,
      cropX: cropView.cropX, cropY: cropView.cropY, flipX: cropView.flipX, flipY: cropView.flipY, source: { width: cropSource.width, height: cropSource.height } }}
    source={{ bytes: cropSource.bytes, mimeType: cropSource.mimeType }}
    onCommit={result => { setCropping(null); cropPatch({ x: result.frame.x, y: result.frame.y, width: result.frame.width, height: result.frame.height, crop: result.crop }) }}
    onCancel={() => setCropping(null)} /> : null
  return <span ref={marker} className="native-selection-context" aria-hidden="true">
    {overlay && <input ref={replacement} type="file" accept="image/*" hidden tabIndex={-1} aria-label="替换浮层图片文件" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (file) void file.arrayBuffer().then(bytes => overlay.commands.importReplacementMedia({ name: file.name, mimeType: file.type, bytes: new Uint8Array(bytes) }))
        .catch(() => report('图片读取失败'))
    }} />}
    {pinnedBoxes.map((box, index) => <span key={index} aria-hidden="true" data-pinned-object="true" className="native-selection-context__pinned"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }} />)}
    {content && <SelectionQuickBar label="选中对象快捷工具" anchor={anchor} bounds={view} suspended={gesture || textEditing || cropping !== null} selectionKey={`${documentId}:${locationId}:${stateId}:${ids}`} aboveOffset={ROTATION_HANDLE_CLEARANCE}>
      {content}
      {notice && <span role="alert" className="selection-quick-bar__notice" title={notice}>{notice}</span>}
    </SelectionQuickBar>}
    {contextMenu.element}
    {cropElement}
  </span>
}
