import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placeQuickBar, type QuickBarBounds, type QuickBarRect } from '../quickbar/placeQuickBar'
import type { PropertiesImageView, PropertiesPatch } from '../../ui/properties/SlideNativePropertiesPanel'
import './imageEditPanel.css'

/** One control gesture makes one existing owner command; local input is not a second document draft. */
function ImageNumber({ label, value, min, max, onCommit }: { label: string; value: number; min: number; max: number; onCommit(value: number): void }) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100))
  const focused = useRef(false)
  useLayoutEffect(() => { if (!focused.current) setDraft(String(Math.round(value * 100) / 100)) }, [value])
  const commit = () => {
    const number = Number(draft)
    if (draft.trim() && Number.isFinite(number)) {
      const next = Math.max(min, Math.min(max, number))
      setDraft(String(next)); if (next !== value) onCommit(next)
    } else setDraft(String(value))
  }
  return <label>{label}<input type="number" aria-label={label} min={min} max={max} value={draft}
    onFocus={() => { focused.current = true }} onChange={event => setDraft(event.target.value)}
    onBlur={() => { focused.current = false; commit() }} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
    }} /></label>
}

/** Reuses native picture properties. Exact source fields can expose their supported subset. */
export function ImageEditControls({ image, patch, replace, crop, cropDisabledReason, close, children, canRotate = true }: {
  image?: PropertiesImageView; patch?(patch: PropertiesPatch): void; replace?(): void
  crop?(): void; cropDisabledReason?: string | null; close(): void; children?: ReactNode
  canRotate?: boolean
}) {
  return <>
    <div className="image-edit-panel__heading"><strong>编辑图片</strong><button type="button" onClick={close}>完成</button></div>
    <div className="image-edit-panel__buttons">
      {replace && <button type="button" onClick={replace}>替换图片</button>}
      {crop && <button type="button" disabled={Boolean(cropDisabledReason)} title={cropDisabledReason ?? undefined} onClick={crop}>裁剪</button>}
      {image && patch && <>
        {canRotate && <button type="button" onClick={() => patch({ rotation: image.rotation - 90 })}>向左旋转90°</button>}
        {canRotate && <button type="button" onClick={() => patch({ rotation: image.rotation + 90 })}>向右旋转90°</button>}
        <button type="button" aria-pressed={image.flipX} onClick={() => patch({ flipX: !image.flipX })}>水平翻转</button>
        <button type="button" aria-pressed={image.flipY} onClick={() => patch({ flipY: !image.flipY })}>垂直翻转</button>
      </>}
    </div>
    {image && patch && <>
      <label>显示方式<select aria-label="图片显示方式" value={image.fit} onChange={event => patch({ fit: event.target.value as PropertiesImageView['fit'] })}>
        <option value="contain">完整显示</option><option value="cover">填充</option><option value="stretch">拉伸</option>
      </select></label>
      <details><summary>调整</summary>
        {image.filters && (['brightness', 'contrast', 'saturation'] as const).map((key, index) => <ImageNumber key={key}
          label={['亮度（%）', '对比度（%）', '饱和度（%）'][index]!} value={image.filters![key] * 100} min={0} max={300}
          onCommit={value => patch({ filters: { [key]: value / 100 } })} />)}
        <ImageNumber label="不透明度（%）" value={image.opacity * 100} min={0} max={100} onCommit={value => patch({ opacity: value / 100 })} />
        <ImageNumber label="圆角（px）" value={image.cornerRadius} min={0} max={image.width && image.height ? Math.min(image.width, image.height) / 2 : Math.max(200, image.cornerRadius)} onCommit={cornerRadius => patch({ cornerRadius })} />
      </details>
    </>}
    {children}
  </>
}

export function ImageEditPanel({ anchor, bounds, children, close }: {
  anchor: QuickBarRect | null; bounds: QuickBarBounds | null; children: ReactNode; close(): void
}) {
  const element = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: anchor?.left ?? 8, top: anchor?.top ?? 8 })
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    node.focus()
    return () => { if (previous?.isConnected && (node.contains(document.activeElement) || document.activeElement === document.body)) previous.focus() }
  }, [])
  useLayoutEffect(() => {
    const node = element.current
    if (!node || !anchor || !bounds) return
    const place = () => {
      const width = node.offsetWidth, height = node.offsetHeight, gap = 8
      const top = Math.max(bounds.top + gap, Math.min(anchor.top, bounds.bottom - height - gap))
      // Keep the canvas picture visible when there is room beside it, including expanded adjustments.
      if (anchor.left + anchor.width + gap + width <= bounds.right - gap) setPosition({ left: anchor.left + anchor.width + gap, top })
      else if (anchor.left - gap - width >= bounds.left + gap) setPosition({ left: anchor.left - gap - width, top })
      else setPosition(placeQuickBar(anchor, bounds, { width, height }))
    }
    place()
    const resize = new ResizeObserver(place); resize.observe(node)
    return () => resize.disconnect()
  }, [anchor, bounds])
  return createPortal(<div ref={element} role="dialog" aria-label="图片简易编辑" tabIndex={-1} data-component-professional-editor=""
    className="image-edit-panel" style={{ left: position.left, top: position.top }} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close() } }}>
    {children}
  </div>, document.body)
}
