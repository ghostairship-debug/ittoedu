import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { courseThemeStyleText } from '../../shared/contracts/design-v1/theme'
import { selectActiveCourseProjectDocument, useEditorStore } from '../store/editorStore'
import type { PublishedCompositionLayerItem } from '../../shared/publishedCourseTypes'
import { mountWebComposition, type CompositionBounds, type WebCompositionMountHandle } from '../../player/composition/mountWebComposition'
import type { PublishedComponentPackageSource } from '../../player/surfaces/publishedComponentMount'
import { createPublishedSurfaceRuntimeSession } from '../../player/surfaces/runtime/publishedSurfaceRuntimeMount'
import type { CompositionContentEdit } from '../../shared/composition/edit'
import { compositionDom, compositionGeometryIssue, compositionHasResize, compositionResize, compositionViewportGestureIssue } from './compositionLayout'
import { compositionDragPlan, compositionDrop, compositionCrossDrop, compositionFreeDrag, type CompositionPoint } from './compositionDrag'

export interface CompositionAuthoringSelection {
  layerItemId: string
  nodeId: string
  bounds: CompositionBounds
}

export interface WebCompositionAuthoringContentProps {
  layerItemId: string
  content: PublishedCompositionLayerItem['content']
  width: number
  height: number
  assetUrls: Readonly<Record<string, string>>
  projectId?: string
  components?: Readonly<Record<string, PublishedComponentPackageSource>>
  /** Document/surface identity, independent of revision and root geometry. */
  sessionKey?: string
  interactive?: boolean
  selectedNodeId?: string | null
  onSelection?(selection: CompositionAuthoringSelection): void
  /** Same canonical edit port in the canvas and focused content view. */
  onEdit?(edit: CompositionContentEdit): Promise<void>
  editingDisabled?: boolean
  onLayoutMount?(iframe: HTMLIFrameElement | null): void
  allowPixelOverride?: boolean
  /** Attach controls to the Player-owned mount; never create a parallel content instance. */
  existingHandle?: WebCompositionMountHandle
}

/** Authoring uses the same DOM and Runtime host as playback; geometry only resizes its viewport. */
export function WebCompositionAuthoringContent(props: WebCompositionAuthoringContentProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mountRef = useRef<WebCompositionMountHandle | null>(null)
  const current = useRef(props)
  current.current = props
  const applied = useRef<{ content: typeof props.content; assetUrls: typeof props.assetUrls } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bounds, setBounds] = useState<CompositionBounds | null>(null)
  const [dragPreview, setDragPreview] = useState<CompositionBounds | null>(null)
  const [dropMarker, setDropMarker] = useState<CompositionBounds | null>(null)
  const [gestureIssue, setGestureIssue] = useState<string | null>(null)
  const [gestureError, setGestureError] = useState<string | null>(null)
  const [canDrag, setCanDrag] = useState(false)
  const [canResize, setCanResize] = useState(false)
  const [pixelOverride, setPixelOverride] = useState(false)
  const gesture = useRef<{ content: typeof props.content; cancel(): void } | null>(null)
  // The editing view shows the course theme as playback does; a theme change mounts the content again.
  const designTokens = useEditorStore(state => selectActiveCourseProjectDocument(state)?.designTokens)
  const courseTheme = useEditorStore(state => selectActiveCourseProjectDocument(state)?.theme)
  const theme = useMemo(() => designTokens ? courseThemeStyleText({ designTokens, theme: courseTheme }, id => current.current.assetUrls[id]) : undefined,
    [designTokens, courseTheme])

  const startDrag = (event: PointerEvent, nodeId: string, resize: boolean, inside: boolean) => {
    const input = current.current, handle = mountRef.current
    if (!handle || !input.onEdit || input.editingDisabled || event.button !== 0 || gesture.current) return
    const frame = handle.element, doc = frame.contentDocument
    if (!doc) return
    const viewportIssue = compositionViewportGestureIssue(frame)
    if (viewportIssue) { setGestureIssue(viewportIssue); return }
    const element = compositionDom(doc, nodeId), { plan, issue } = compositionDragPlan(input.content.root, nodeId, handle.observeLayout)
    if (resize ? !element || !compositionHasResize(element) || Boolean(compositionGeometryIssue(element)) : !plan) {
      setGestureIssue(issue ?? '此布局请通过属性调整尺寸。'); return
    }
    const usePixels = input.allowPixelOverride ?? pixelOverride
    event.preventDefault(); event.stopPropagation()
    setGestureError(null)
    const point = (mouse: PointerEvent, inner: boolean): CompositionPoint => {
      if (inner) return { x: mouse.clientX, y: mouse.clientY }
      const rect = frame.getBoundingClientRect()
      return { x: (mouse.clientX - rect.x) * frame.clientWidth / rect.width,
        y: (mouse.clientY - rect.y) * frame.clientHeight / rect.height }
    }
    const initial = point(event, inside)
    let edit: CompositionContentEdit | null = null, moved = false
    const owner = event.target as Element
    const update = (mouse: PointerEvent, inner: boolean) => {
      if (mouse.pointerId !== event.pointerId) return
      const viewportIssue = compositionViewportGestureIssue(frame)
      if (viewportIssue) { edit = null; setGestureIssue(viewportIssue); cancel(); return }
      const next = point(mouse, inner), delta = { x: next.x - initial.x, y: next.y - initial.y }
      if (Math.hypot(delta.x, delta.y) < 3 && !moved) return
      moved = true
      try {
        if (resize && element) {
          const preview = compositionResize(element, nodeId, delta, usePixels)
          edit = preview.edit; setDragPreview(preview.bounds); setGestureIssue(null)
        } else if (plan) {
          const bounds = { ...plan.layout.bounds, x: plan.layout.bounds.x + delta.x, y: plan.layout.bounds.y + delta.y }
          const cross = compositionCrossDrop(plan, next, doc, bounds)
          if (cross) { edit = cross.edit; setDropMarker(cross.marker); setDragPreview(bounds) }
          else if (plan.mode === 'free') {
            const preview = compositionFreeDrag(plan, delta, false, element, usePixels)
            edit = preview.edit; setDragPreview(preview.bounds); setDropMarker(null)
          } else {
            const drop = compositionDrop(plan, next)
            edit = drop?.edit ?? null; setDropMarker(drop?.marker ?? null); setDragPreview(bounds)
          }
          setGestureIssue(null)
        }
      } catch (cause) {
        edit = null; setDropMarker(null); setDragPreview(null)
        setGestureIssue(cause instanceof Error ? cause.message : '请通过布局属性调整。')
      }
      mouse.preventDefault()
    }
    const innerMove = (mouse: PointerEvent) => update(mouse, true)
    const outerMove = (mouse: PointerEvent) => update(mouse, false)
    const key = (keyboard: KeyboardEvent) => { if (keyboard.key === 'Escape') { keyboard.preventDefault(); cancel() } }
    const cancel = () => {
      doc.removeEventListener('pointermove', innerMove, true); doc.removeEventListener('pointerup', finish, true)
      doc.removeEventListener('pointercancel', cancel, true); doc.removeEventListener('keydown', key, true)
      window.removeEventListener('pointermove', outerMove, true); window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('keydown', key, true)
      try { if (owner.hasPointerCapture(event.pointerId)) owner.releasePointerCapture(event.pointerId) } catch { /* The target can have been removed by a concurrent edit. */ }
      gesture.current = null; setDragPreview(null); setDropMarker(null)
    }
    const finish = (mouse: PointerEvent) => {
      if (mouse.pointerId !== event.pointerId) return
      const content = input.content
      cancel()
      const viewportIssue = compositionViewportGestureIssue(frame)
      if (viewportIssue) { setGestureIssue(viewportIssue); return }
      if (!moved || !edit || current.current.content !== content || current.current.editingDisabled) return
      void current.current.onEdit?.(edit).catch(cause => setGestureError(cause instanceof Error ? cause.message : '拖动修改未完成'))
    }
    gesture.current = { content: input.content, cancel }
    try { owner.setPointerCapture(event.pointerId) } catch { /* Cross-frame window listeners retain the same gesture. */ }
    doc.addEventListener('pointermove', innerMove, true); doc.addEventListener('pointerup', finish, true)
    doc.addEventListener('pointercancel', cancel, true); doc.addEventListener('keydown', key, true)
    window.addEventListener('pointermove', outerMove, true); window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', cancel, true); window.addEventListener('keydown', key, true)
  }
  const start = useRef(startDrag); start.current = startDrag

  useLayoutEffect(() => {
    const parent = containerRef.current
    if (!parent) return
    let active = true
    const input = current.current
    if (input.existingHandle) {
      const handle = input.existingHandle
      mountRef.current = handle
      void handle.ready.then(() => { if (active) current.current.onLayoutMount?.(handle.element) }, cause => { if (active) setError(String(cause)) })
      return () => { active = false; gesture.current?.cancel(); mountRef.current = null; current.current.onLayoutMount?.(null) }
    }
    const session = createPublishedSurfaceRuntimeSession()
    setError(null)
    const handle = mountWebComposition(parent, {
      instanceId: input.layerItemId,
      content: input.content,
      width: input.width,
      height: input.height,
      projectId: input.projectId,
      components: input.components,
      mode: 'authoring',
      ...(theme ? { theme } : {}),
      session,
      resolveAsset: id => current.current.assetUrls[id],
      onSelection: selection => current.current.onSelection?.(selection),
      reportError: cause => { if (active) setError(cause.message) },
    })
    mountRef.current = handle
    applied.current = { content: input.content, assetUrls: input.assetUrls }
    void handle.ready.then(() => { if (active) current.current.onLayoutMount?.(handle.element) }, cause => { if (active) setError(String(cause)) })
    return () => {
      active = false
      mountRef.current = null
      applied.current = null
      current.current.onLayoutMount?.(null)
      handle.destroy()
      session.destroy()
    }
  }, [props.layerItemId, props.sessionKey, props.existingHandle, theme])

  useLayoutEffect(() => { if (!props.existingHandle) mountRef.current?.resize(props.width, props.height) }, [props.width, props.height, props.existingHandle])
  useEffect(() => {
    if (gesture.current && (gesture.current.content !== props.content || props.editingDisabled)) gesture.current.cancel()
  }, [props.content, props.editingDisabled])
  useEffect(() => {
    const handle = mountRef.current
    if (!handle || !props.onEdit) return
    let live = true, doc: Document | null = null
    const down = (event: PointerEvent) => {
      const element = (event.target as Element | null)?.closest?.('[data-composition-node]')
      const id = element?.getAttribute('data-composition-node')
      if (id) {
        if (current.current.existingHandle) { const bounds = handle.measure(id); if (bounds) current.current.onSelection?.({ layerItemId: current.current.layerItemId, nodeId: id, bounds }) }
        start.current(event, id, false, true)
      }
    }
    void handle.ready.then(() => {
      if (!live) return
      doc = handle.element.contentDocument; doc?.addEventListener('pointerdown', down, true)
    }).catch(() => undefined)
    return () => { live = false; gesture.current?.cancel(); doc?.removeEventListener('pointerdown', down, true) }
  }, [Boolean(props.onEdit), props.layerItemId, props.sessionKey, props.existingHandle])
  useEffect(() => {
    const handle = mountRef.current
    if (props.existingHandle || !handle || (applied.current?.content === props.content && applied.current.assetUrls === props.assetUrls)) return
    let active = true
    applied.current = { content: props.content, assetUrls: props.assetUrls }
    void handle.update(props.content).then(() => { if (active) setError(null) }, cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [props.content, props.assetUrls, props.existingHandle])
  useEffect(() => {
    const handle = mountRef.current
    const nodeId = props.selectedNodeId
    setBounds(null)
    setCanDrag(false); setCanResize(false); setGestureIssue(null)
    if (!handle || !nodeId) return
    let active = true
    let frame = 0
    void handle.waitForObservationReady().then(() => {
      if (!active) return
      frame = requestAnimationFrame(() => {
        if (!active) return
        setBounds(handle.measure(nodeId))
        if (current.current.onEdit) {
          const result = compositionDragPlan(current.current.content.root, nodeId, handle.observeLayout)
          const viewportIssue = compositionViewportGestureIssue(handle.element)
          setCanDrag(Boolean(result.plan) && !viewportIssue); setGestureIssue(viewportIssue ?? result.issue ?? null)
          const element = compositionDom(handle.element.contentDocument, nodeId)
          setCanResize(Boolean(element && !viewportIssue && compositionHasResize(element) && !compositionGeometryIssue(element)))
        }
      })
    }).catch(() => undefined)
    return () => { active = false; cancelAnimationFrame(frame) }
  }, [props.selectedNodeId, props.content, props.width, props.height, props.layerItemId, props.sessionKey, props.existingHandle])

  return <div data-composition-authoring={props.layerItemId}
    style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: props.existingHandle || props.interactive === false ? 'none' : 'auto' }}>
    <div ref={containerRef} style={props.existingHandle ? { width: 0, height: 0 } : { width: '100%', height: '100%', overflow: 'hidden' }} />
    {bounds && <div data-composition-selection={props.selectedNodeId ?? undefined}
      style={{ position: 'absolute', left: (dragPreview ?? bounds).x, top: (dragPreview ?? bounds).y,
        width: (dragPreview ?? bounds).width, height: (dragPreview ?? bounds).height, outline: '2px solid #2563eb', pointerEvents: 'none' }}>
      {props.onEdit && <button type="button" aria-label="拖动内容" disabled={!canDrag || props.editingDisabled}
        onPointerDown={event => start.current(event.nativeEvent, props.selectedNodeId!, false, false)}
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'auto', cursor: 'move', touchAction: 'none', background: '#2563eb', color: '#fff', border: 0, fontSize: 12 }}>拖动</button>}
      {props.onEdit && canResize && <button type="button" aria-label="缩放内容" disabled={props.editingDisabled}
        onPointerDown={event => start.current(event.nativeEvent, props.selectedNodeId!, true, false)}
        style={{ position: 'absolute', right: -5, bottom: -5, width: 12, height: 12, padding: 0, border: '1px solid white', background: '#2563eb', cursor: 'nwse-resize', pointerEvents: 'auto', touchAction: 'none' }} />}
    </div>}
    {dropMarker && <div aria-hidden="true" style={{ position: 'absolute', left: dropMarker.x, top: dropMarker.y,
      width: dropMarker.width, height: dropMarker.height, background: '#db2777', pointerEvents: 'none' }} />}
    {props.onEdit && props.allowPixelOverride === undefined && <label style={{ position: 'absolute', right: 4, top: 4, padding: 4, pointerEvents: 'auto', background: '#ffffffee', fontSize: 12 }}>
      <input type="checkbox" aria-label="手势使用像素覆盖" checked={pixelOverride} onChange={event => setPixelOverride(event.target.checked)} />手势使用像素覆盖
    </label>}
    {gestureIssue && props.onEdit && <div role="status" style={{ position: 'absolute', bottom: 0, left: 0, maxWidth: '100%', padding: 6, background: '#fff7ed', color: '#9a3412', fontSize: 12 }}>{gestureIssue}</div>}
    {gestureError && <div role="alert" style={{ position: 'absolute', bottom: 0, padding: 8, background: '#fff7ed', color: '#9a3412' }}>{gestureError}</div>}
    {error && <div role="alert" style={{ position: 'absolute', inset: 0, padding: 8, background: '#fff7ed', color: '#9a3412', overflow: 'auto' }}>{error}</div>}
  </div>
}
