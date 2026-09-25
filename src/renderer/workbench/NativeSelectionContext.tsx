import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useCourseEditorChrome } from '../documents/CourseEditorChromeContext'
import { useEditorStore } from '../store/editorStore'
import { usePropertiesContext } from '../ui/properties/PropertiesContextAdapter'
import type { PropertiesContext } from '../ui/properties/PropertiesContext'
import { BufferedInput, PropertyDraftBoundary, RangeField } from '../ui/properties/PropertyControls'
import { proEditorRailController } from '../ui/proEditorRailController'
import { captureCourseObjectSelection, matchesCourseObjectState, usePinnedSelection, workbenchSelection, type SelectionCapture } from './SelectionContextController'
import './selectionContext.css'

type ObjectProperties = Extract<PropertiesContext, { kind: 'slide-native' | 'multi-selection' }>
type Box = { left: number; top: number; width: number; height: number; rotation?: number }
type Viewport = { left: number; top: number; right: number; bottom: number }

/** Place the whole control within its document canvas, including when neither vertical side fits. */
export function placeSelectionPopover(anchor: Box, viewport: Viewport, size: { width: number; height: number }, gap = 8) {
  const leftEdge = viewport.left + gap, topEdge = viewport.top + gap
  const rightEdge = viewport.right - gap, bottomEdge = viewport.bottom - gap
  const width = Math.min(size.width, Math.max(0, rightEdge - leftEdge))
  const height = Math.min(size.height, Math.max(0, bottomEdge - topEdge))
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, Math.max(low, high)))
  const alignX = () => clamp(anchor.left, leftEdge, rightEdge - width)
  const alignY = () => clamp(anchor.top, topEdge, bottomEdge - height)
  const below = anchor.top + anchor.height + gap, above = anchor.top - height - gap
  const right = anchor.left + anchor.width + gap, left = anchor.left - width - gap
  if (below + height <= bottomEdge) return { left: alignX(), top: below, maxWidth: width, maxHeight: height }
  if (above >= topEdge) return { left: alignX(), top: above, maxWidth: width, maxHeight: height }
  if (right + width <= rightEdge) return { left: right, top: alignY(), maxWidth: width, maxHeight: height }
  if (left >= leftEdge) return { left, top: alignY(), maxWidth: width, maxHeight: height }
  const preferBelow = bottomEdge - below >= anchor.top - gap - topEdge
  return { left: alignX(), top: clamp(preferBelow ? below : above, topEdge, bottomEdge - height), maxWidth: width, maxHeight: height }
}

/** The Store selection and the document selection must identify the same objects. */
export function matchesObjectProperties(context: PropertiesContext, itemIds: readonly string[]): context is ObjectProperties {
  if (context.kind === 'slide-native') return itemIds.length === 1 && context.view.id === itemIds[0] && !context.disabledReason
  if (context.kind !== 'multi-selection' || itemIds.length < 2 || context.items.length !== itemIds.length) return false
  const ids = new Set(context.items.map(item => item.id))
  return ids.size === itemIds.length && itemIds.every(id => ids.has(id))
}

function ObjectPropertiesCard({ context, onClose, onMore }: { context: ObjectProperties; onClose(): void; onMore(): void }) {
  if (context.kind === 'multi-selection') {
    const unlocked = context.items.filter(item => !item.locked).length
    return <aside className="native-selection-context__properties" aria-label="选中对象属性">
      <header><strong>已选 {context.items.length} 个对象</strong><button type="button" onClick={onClose}>收起属性</button></header>
      <div className="native-selection-context__property-actions" role="group" aria-label="多选对齐">
        {([['left', '左对齐'], ['center', '水平居中'], ['top', '顶对齐'], ['middle', '垂直居中']] as const).map(([mode, label]) =>
          <button key={mode} type="button" disabled={unlocked < 2} onClick={() => context.commands.align(mode)}>{label}</button>)}
      </div>
      <div className="native-selection-context__property-actions" role="group" aria-label="多选图层操作">
        <button type="button" onClick={() => context.commands.setVisible(true)}>全部显示</button>
        <button type="button" onClick={() => context.commands.setVisible(false)}>全部隐藏</button>
        {context.commands.duplicate && <button type="button" onClick={context.commands.duplicate}>复制所选</button>}
      </div>
      {context.unavailableReason && <p role="status">{context.unavailableReason}</p>}
      <button type="button" onClick={onMore}>更多属性</button>
    </aside>
  }
  const node = context.view
  const patch = context.commands.patch
  return <aside className="native-selection-context__properties" aria-label="选中对象属性">
    <header><strong>{node.name}</strong><button type="button" onClick={onClose}>收起属性</button></header>
    {node.locked ? <p role="status">对象已锁定，请在完整属性中解锁后编辑。</p> : <PropertyDraftBoundary bindingKey={context.draftBindingKey} onStale={() => context.onFeedback({ kind: 'error', message: '选择已改变，请重新输入属性。' })}>
      {node.type === 'text' && <div className="native-selection-context__property-actions" role="group" aria-label="文字属性">
        {context.contentEditingEnabled && <button type="button" onClick={() => context.commands.text.beginEdit('canvas')}>编辑文字</button>}
        <button type="button" aria-pressed={node.style.bold} onClick={() => patch({ style: { bold: !node.style.bold } })}>加粗</button>
        <button type="button" aria-pressed={node.style.italic} onClick={() => patch({ style: { italic: !node.style.italic } })}>斜体</button>
        <BufferedInput label="字号" type="number" min={8} max={400} value={node.style.fontSize} onCommit={value => patch({ style: { fontSize: Number(value) } })} />
      </div>}
      {(node.type === 'image' || node.type === 'video') && <div className="native-selection-context__property-actions" role="group" aria-label="媒体属性">
        <label>填充方式 <select aria-label="填充方式" value={node.fit} onChange={event => patch({ fit: event.target.value as typeof node.fit })}>
          <option value="contain">完整显示</option><option value="cover">填满</option><option value="stretch">拉伸</option>
        </select></label>
        {node.type === 'video' && <>
          <button type="button" aria-pressed={node.autoplay} onClick={() => patch({ autoplay: !node.autoplay })}>自动播放</button>
          <button type="button" aria-pressed={node.loop} onClick={() => patch({ loop: !node.loop })}>循环播放</button>
        </>}
      </div>}
      {node.type === 'image' && <details aria-label="图片裁剪">
        <summary>裁剪图片</summary>
        <RangeField label="左裁剪" value={node.crop.left * 100} min={0} max={(0.98 - node.crop.right) * 100} suffix="%" onChange={left => patch({ crop: { left: left / 100 } })} />
        <RangeField label="右裁剪" value={node.crop.right * 100} min={0} max={(0.98 - node.crop.left) * 100} suffix="%" onChange={right => patch({ crop: { right: right / 100 } })} />
        <RangeField label="上裁剪" value={node.crop.top * 100} min={0} max={(0.98 - node.crop.bottom) * 100} suffix="%" onChange={top => patch({ crop: { top: top / 100 } })} />
        <RangeField label="下裁剪" value={node.crop.bottom * 100} min={0} max={(0.98 - node.crop.top) * 100} suffix="%" onChange={bottom => patch({ crop: { bottom: bottom / 100 } })} />
        <button type="button" disabled={Object.values(node.crop).every(value => value === 0)} onClick={() => patch({ crop: { left: 0, right: 0, top: 0, bottom: 0 } })}>重置裁剪</button>
      </details>}
      <div className="native-selection-context__property-fields" role="group" aria-label="位置和尺寸">
        <BufferedInput label="X" type="number" value={Math.round(node.x)} onCommit={value => patch({ x: Number(value) })} />
        <BufferedInput label="Y" type="number" value={Math.round(node.y)} onCommit={value => patch({ y: Number(value) })} />
        <BufferedInput label="宽" type="number" min={1} value={Math.round(node.width)} onCommit={value => patch({ width: Number(value) })} />
        <BufferedInput label="高" type="number" min={1} value={Math.round(node.height)} onCommit={value => patch({ height: Number(value) })} />
      </div>
    </PropertyDraftBoundary>}
    <button type="button" onClick={onMore}>更多属性</button>
  </aside>
}
export function NativeSelectionContext({ documentId, revision, locationId, itemIds, stateId, sceneItemIds = [], enabled, bounds }: {
  documentId?: string | null; revision: number; locationId?: string | null; itemIds: readonly string[]; stateId?: string | null; sceneItemIds?: readonly string[]; enabled: boolean; bounds?(itemId: string): Box | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const chrome = useCourseEditorChrome()
  const [instruction, setInstruction] = useState(''), [error, setError] = useState('')
  const [target, setTarget] = useState<SelectionCapture | null>(null), [open, setOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const openMore = () => {
    chrome.setMode('deep')
    useEditorStore.getState().setActiveTab('properties')
    proEditorRailController.open('properties')
    setPropertiesOpen(false)
  }
  const context = usePropertiesContext({ onReplaceImage: openMore })
  useSyncExternalStore(workbenchSelection.subscribe, workbenchSelection.readVersion)
  const pinned = usePinnedSelection(documentId)
  const [boxes, setBoxes] = useState<Box[]>([])
  const [anchor, setAnchor] = useState<Box | null>(null)
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [panelSize, setPanelSize] = useState({ width: 340, height: 42 })
  const ids = JSON.stringify(itemIds), sceneIds = JSON.stringify(sceneItemIds)
  useEffect(() => { setPropertiesOpen(false) }, [documentId, locationId, ids, stateId])
  useEffect(() => {
    if (!documentId) return
    void workbenchSelection.observe(documentId, revision, snapshot => enabled && locationId && itemIds.length
      ? captureCourseObjectSelection(snapshot, locationId, itemIds, stateId) : null)
  }, [documentId, revision, locationId, ids, stateId, enabled])
  useLayoutEffect(() => {
    const root = host.current?.closest('main')
    if (!root) return
    const capture = target ?? pinned
    const selected = capture?.targets.flatMap(t => t.kind === 'course-object' && matchesCourseObjectState(t, locationId, stateId, sceneItemIds.includes(t.itemId)) ? [t.itemId] : []) ?? []
    const locate = (id: string) => {
      const explicit = bounds?.(id)
      const element = [...root.querySelectorAll<HTMLElement>('[data-layer-item-id]')].find(element => element.dataset.layerItemId === id)
      const rect = explicit ?? element?.getBoundingClientRect()
      return rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, rotation: explicit?.rotation } : null
    }
    const paint = () => {
      const rect = root.getBoundingClientRect()
      const nextViewport = { left: Math.max(0, rect.left), top: Math.max(0, rect.top),
        right: Math.min(window.innerWidth, rect.right), bottom: Math.min(window.innerHeight, rect.bottom) }
      setViewport(previous => JSON.stringify(previous) === JSON.stringify(nextViewport) ? previous : nextViewport)
      const panel = host.current?.getBoundingClientRect()
      if (panel && panel.width && panel.height) {
        const nextSize = { width: panel.width, height: panel.height }
        setPanelSize(previous => JSON.stringify(previous) === JSON.stringify(nextSize) ? previous : nextSize)
      }
      const next = selected.flatMap(id => { const rect = locate(id); return rect ? [rect] : [] })
      setBoxes(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      const first = itemIds.length ? locate(itemIds[0]!) : null
      setAnchor(previous => JSON.stringify(previous) === JSON.stringify(first) ? previous : first)
    }
    paint(); window.addEventListener('resize', paint); window.addEventListener('scroll', paint, true)
    const observer = new MutationObserver(paint); observer.observe(root, { childList: true, subtree: true })
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint)
    resized?.observe(root); if (host.current) resized?.observe(host.current)
    return () => { observer.disconnect(); resized?.disconnect(); window.removeEventListener('resize', paint); window.removeEventListener('scroll', paint, true) }
  }, [pinned, target, locationId, stateId, sceneIds, ids, bounds, propertiesOpen, open])
  const manual = documentId ? workbenchSelection.getManual(documentId) : null
  const propertiesAvailable = Boolean(enabled && manual?.revision === revision && chrome.documentId === documentId && matchesObjectProperties(context, itemIds))
  const controlsVisible = Boolean(manual || propertiesOpen && propertiesAvailable || open && target)
  const position = anchor && viewport ? { position: 'fixed' as const,
    ...placeSelectionPopover(anchor, viewport, panelSize) } : undefined
  const availableHeight = viewport ? Math.max(0, viewport.bottom - viewport.top - 16) : undefined
  if (!enabled) return null
  return <div className={`native-selection-context canvas-mode-switch${controlsVisible ? '' : ' native-selection-context--idle'}`} ref={host}
    style={{ ...position, maxHeight: availableHeight, maxWidth: viewport ? Math.max(0, viewport.right - viewport.left - 16) : undefined }}
    onPointerDown={event => event.stopPropagation()}
    // Phaser also listens for compatibility mouse events and touch events on window.
    // Keep controls above the canvas from selecting the object underneath them.
    onMouseDown={event => event.stopPropagation()}
    onMouseUp={event => event.stopPropagation()}
    onTouchStart={event => event.stopPropagation()}
    onTouchEnd={event => event.stopPropagation()}
    onTouchCancel={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { setOpen(false); setPropertiesOpen(false) } }}>
    {boxes.map((box, index) => <div key={index} aria-hidden="true" data-pinned-object="true" style={{ position: 'fixed', pointerEvents: 'none', left: box.left, top: box.top, width: box.width, height: box.height, border: '2px dashed #8b5cf6', transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }} />)}
    {manual && <div className="native-selection-context__toolbar" role="toolbar" aria-label="选中对象快捷工具">
      <span>{itemIds.length > 1 ? `已选 ${itemIds.length} 项` : '已选对象'}</span>
      {propertiesAvailable && <button type="button" aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen(value => !value)}>属性</button>}
      <button type="button" onClick={() => { if (!instruction && !target) setTarget(structuredClone(manual)); setOpen(true) }}>AI 修改选中内容</button>
    </div>}
    {propertiesOpen && propertiesAvailable && matchesObjectProperties(context, itemIds) && <ObjectPropertiesCard context={context} onClose={() => setPropertiesOpen(false)} onMore={openMore} />}
    {open && target && <form onSubmit={event => { event.preventDefault(); void workbenchSelection.request(target, instruction).then(() => { setInstruction(''); setTarget(null); setOpen(false); setError('') }).catch(reason => setError(reason.message)) }}>
      <span>{target.label} · 已固定</span>
      <textarea aria-label="选中对象的修改要求" value={instruction} onChange={event => setInstruction(event.target.value)} />
    {manual && <button type="button" onClick={() => setTarget(structuredClone(manual))}>改为当前选择</button>}
      <button type="button" onClick={() => { setTarget(null); setInstruction(''); setOpen(false) }}>取消引用</button>
      <button type="submit" disabled={!instruction.trim()}>交给创作助手</button>{error && <p role="alert">{error}</p>}
    </form>}
  </div>
}
