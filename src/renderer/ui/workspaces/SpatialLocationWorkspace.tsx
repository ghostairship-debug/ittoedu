import { Hand, Maximize2, Minus, MousePointer2, Play, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import type { ComponentEdit, ComponentFrame, ComponentSurface, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { SpatialSurfaceViewState, SpatialGraphSelection } from '../../store/slices/spatialAuthoringSlice'
import { componentSpatialCameraMatrix, panComponentSpatialCamera, zoomComponentSpatialCamera } from '../../../player/surfaces/spatial/componentSpatialAdapter'
import { spatialComponentCenter, spatialFramePose, spatialPathPoints, spatialSemanticVisible } from '../../../player/surfaces/spatial/componentPlatform/graph'
import { composeMatrices, frameCorners, invertMatrix, rotationMatrix, scaleMatrix, transformPoint, translationMatrix, type AffineMatrix, type GeometryPoint } from '../../../core/components/geometry'
import { FreeTransformGesture, type FreeResizeHandle, type FreeSnapGuide } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { freeSelectionBounds, freeSurfaceTargets, hitFreeObject, marqueeFreeTargets, sameFreeTarget, selectedFreeTargets, type FreeObjectTarget } from '../../componentPlatform/surfaces/slide/targets'
import { spatialWorldTargets } from '../../componentPlatform/surfaces/spatial/targets'
import { useContextMenu } from '../../editing/commands/CommandMenu'
import { hiddenObjectCommands } from '../../editing/commands/hiddenObjectCommands'
import { OBJECT_EDIT_EVENT, requestObjectContextMenu } from '../../editing/commands/objectContextMenu'
import { NativeSelectionContext } from '../../workbench/NativeSelectionContext'
import { useWorkspaceMediaSource } from '../../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop, type WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../../lessonWorkspace/workspaceMediaDrag'
import { useSlideNativeTextEditor } from './useSlideNativeTextEditor'
import { componentDefinitionPresentation } from '../properties/componentDefinitionPresentation'
import type { SlideContentEdit } from '../../store/slices/slideAuthoringSlice'
import { resolveComponentBackground } from '../../../shared/contracts/component-platform'

export interface SpatialLocationWorkspaceProps {
  documentId: string
  project: CourseProjectV10
  surface: ComponentSurface
  view: SpatialSurfaceViewState
  activeStateId?: string | null
  selectionIds: readonly string[]
  canvasMode: 'edit' | 'run'
  renderInstance(instanceId: string): ReactNode
  backgroundAssetUrl?: string | null
  backgroundPreviewColor?: string | null
  onViewportChange?(size: { width: number; height: number }): void
  captureTarget(): CapturedCourseTarget
  onEdits(edits: ComponentEdit[], captured?: CapturedCourseTarget): Promise<unknown>
  onSelect(ids: readonly string[]): void
  onCamera(camera: SpatialSurfaceViewState['camera']): void
  onActivateFrame(frameId: string | null): void
  onGraphSelect(selection: SpatialGraphSelection): void
  onCanvasModeChange(mode: 'edit' | 'run'): void
  onEditContent?(instanceId: string): void
  contentEdit?: SlideContentEdit | null
  contentEditor?: {
    read?(): SlideContentEdit | null
    begin(id: string): SlideContentEdit | null
    update(data: unknown, composing?: boolean, height?: number): void
    setComposing?(active: boolean): void
    commit(): Promise<void>
    cancel(): void
    undo(): void
    redo(): void
    report(message: string): void
  }
  onPaste?(): void
  onSelectAll?(): void
  onShowInstances?(instanceIds: readonly string[]): void
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
  activation?: number
}
const pointer = (event: { clientX: number; clientY: number }): GeometryPoint => ({ x: event.clientX, y: event.clientY })
const inputOwnsPointer = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,button,a,[contenteditable="true"],[data-component-professional-editor]'))
const handles: FreeResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
type PointerInput = Pick<ReactPointerEvent<Element>, 'pointerId' | 'button' | 'clientX' | 'clientY' | 'shiftKey' | 'altKey' | 'target' | 'preventDefault' | 'stopPropagation'>
function distance(point: GeometryPoint, a: GeometryPoint, b: GeometryPoint) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

/** Mature Spatial shell. Runtime DOM comes from the document's one U11 World. */
export function SpatialLocationWorkspace(props: SpatialLocationWorkspaceProps) {
  const latest = useRef(props); latest.current = props
  const root = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null)
  const menu = useContextMenu(), media = useWorkspaceMediaSource()
  const mediaRef = useRef(media); mediaRef.current = media
  const [size, setSize] = useState({ width: 800, height: 450 })
  const [preview, setPreview] = useState<Record<string, ComponentFrame>>({})
  const [guides, setGuides] = useState<FreeSnapGuide[]>([])
  const [marquee, setMarquee] = useState<{ start: GeometryPoint; end: GeometryPoint } | null>(null)
  const spacePan = useRef(false)
  const [error, setError] = useState<string | null>(null), [dragOver, setDragOver] = useState(false)
  const active = useRef<{ pointerId: number; last: GeometryPoint; marquee?: GeometryPoint; originalSelection?: readonly string[]; geometry?: FreeTransformGesture; targets: FreeObjectTarget[]; edits: ComponentEdit[]; captured: CapturedCourseTarget } | null>(null)
  const deferred = useRef<{ input: PointerInput; mode: 'drag' | 'resize' | 'rotate'; handle?: FreeResizeHandle;
    latest: PointerInput; ended: boolean; documentId: string; surfaceId: string; stateId: string | null; scope: SpatialSurfaceViewState['scope']; epoch: string } | null>(null)
  const resumePointer = useRef<(input: PointerInput, mode: 'drag' | 'resize' | 'rotate', handle?: FreeResizeHandle) => void>(() => {})
  const resumeMove = useRef<(input: PointerInput) => void>(() => {})
  const resumeFinish = useRef<(pointerId: number) => void>(() => {})
  const spatial = props.surface.spatial
  const worldTargets = spatialWorldTargets(props.project, props.surface.id)
  const allTargets = freeSurfaceTargets(props.project, props.surface.id)
  const globalIds = new Set([...props.project.global.underlay, ...props.project.global.overlay])
  const scopeTargets = props.view.scope === 'global' ? allTargets.filter(target => globalIds.has(target.ancestors[0] ?? target.instanceId)) : worldTargets
  const visibleTargets = scopeTargets.filter(target => props.project.instances[target.instanceId]?.visible !== false && target.ancestors.every(id => props.project.instances[id]?.visible !== false)
    && (props.view.scope === 'global' || spatialSemanticVisible(spatial, target.instanceId, props.view.camera.zoom)))
  const locked = (target: FreeObjectTarget) => props.project.instances[target.instanceId]?.locked || target.ancestors.some(id => props.project.instances[id]?.locked)
  const design = props.surface.designSize ?? { width: 1280, height: 720 }
  const overlayScale = Math.min(size.width / design.width, size.height / design.height)
  const hudMatrix = composeMatrices(translationMatrix((size.width - design.width * overlayScale) / 2, (size.height - design.height * overlayScale) / 2), scaleMatrix(overlayScale))
  const worldMatrix = componentSpatialCameraMatrix(props.view.camera, { x: 0, y: 0, ...size })
  const background = resolveComponentBackground(props.project, props.surface)
  const matrix = props.view.scope === 'global' ? hudMatrix : worldMatrix
  const clientMatrix = () => { const box = viewport.current!.getBoundingClientRect(); return composeMatrices(translationMatrix(box.left, box.top), matrix) }
  const at = (event: { clientX: number; clientY: number }) => transformPoint(invertMatrix(clientMatrix()), pointer(event))
  const editor = useSlideNativeTextEditor({ project: props.project, surfaceId: props.surface.id, edit: props.contentEdit ?? null,
    begin: id => props.contentEditor?.begin(id) ?? null, update: (data, composing, height) => props.contentEditor?.update(data, composing, height),
    setComposing: props.contentEditor?.setComposing ? active => props.contentEditor!.setComposing!(active) : undefined,
    commit: () => props.contentEditor?.commit() ?? Promise.resolve(), cancel: () => props.contentEditor?.cancel(),
    undo: () => props.contentEditor?.undo(), redo: () => props.contentEditor?.redo(), host: () => viewport.current,
    report: message => props.contentEditor?.report(message),
  }, props.documentId + ':' + props.surface.id + ':' + (props.activeStateId ?? ''))
  const resetPreview = () => {
    const current = latest.current
    for (const node of viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? []) {
      const frame = current.project.instances[node.dataset.componentInstance ?? '']?.frame
      if (frame) { node.style.transform = `matrix(${frame.transform.join(',')})`; node.style.width = `${frame.width}px`; node.style.height = `${frame.height}px` }
    }
    setPreview({})
    setGuides([])
  }
  useLayoutEffect(() => {
    const element = viewport.current!
    const resize = () => { const rect = element.getBoundingClientRect(), value = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }; setSize(value); latest.current.onViewportChange?.(value) }
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    return () => observer.disconnect()
  }, [props.documentId, props.surface.id])
  useEffect(() => { active.current = null; deferred.current = null; resetPreview(); setMarquee(null); setError(null) }, [props.documentId, props.surface.id, props.activeStateId, props.view.scope, props.canvasMode])
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !inputOwnsPointer(event.target)) { spacePan.current = true; event.preventDefault() } }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') spacePan.current = false }
    const blur = () => { spacePan.current = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  useEffect(() => {
    if (active.current?.geometry) {
      const values = freeSurfaceTargets(props.project, props.surface.id)
      if (!active.current.targets.every(target => { const value = values.find(value => value.instanceId === target.instanceId); return value && sameFreeTarget(target, value) })) { active.current = null; resetPreview() }
    }
  }, [props.project])
  useLayoutEffect(() => {
    for (const node of viewport.current?.querySelectorAll<HTMLElement>('[data-spatial-world] [data-component-instance]') ?? []) {
      const id = node.dataset.componentInstance ?? '', instance = props.project.instances[id]
      node.style.visibility = spatialSemanticVisible(spatial, id, props.view.camera.zoom) ? String(instance?.style?.visibility ?? '') : 'hidden'
    }
  }, [props.project, props.view.camera.zoom, props.renderInstance])
  useEffect(() => {
    const element = viewport.current!
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || inputOwnsPointer(event.target)) return
      event.preventDefault()
      const box = element.getBoundingClientRect(), camera = latest.current.view.camera
      latest.current.onCamera(zoomComponentSpatialCamera(camera, Math.max(0.01, camera.zoom + (event.deltaY > 0 ? -0.1 : 0.1)), pointer(event), { x: box.left, y: box.top, width: box.width, height: box.height }))
    }
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => {
    const element = root.current!
    const edit = (event: Event) => { const id = (event as CustomEvent<{ itemId: string }>).detail?.itemId; if (id && latest.current.canvasMode === 'edit') { const instance = latest.current.project.instances[id]; const kind = instance && componentDefinitionPresentation(latest.current.project.definitions[instance.definitionId]).builtinKey; if (kind === 'guoling.text' || kind === 'guoling.formula') latest.current.contentEditor?.begin(id); latest.current.onEditContent?.(id); event.preventDefault() } }
    element.addEventListener(OBJECT_EDIT_EVENT, edit); return () => element.removeEventListener(OBJECT_EDIT_EVENT, edit)
  }, [])
  const hidden = scopeTargets.filter(target => props.project.instances[target.instanceId]?.visible === false)
  const hiddenMenu = () => hiddenObjectCommands(hidden.map(target => ({ id: target.instanceId, name: props.project.instances[target.instanceId]?.name ?? target.instanceId })), ids => props.onShowInstances?.(ids))
  const graphAt = (point: GeometryPoint): SpatialGraphSelection => {
    if (props.view.scope === 'global') return null
    const threshold = 6 / props.view.camera.zoom
    for (const relation of [...(spatial?.relations ?? [])].reverse()) {
      const a = spatialComponentCenter(worldTargets, relation.sourceInstanceId), b = spatialComponentCenter(worldTargets, relation.targetInstanceId)
      if (a && b && distance(point, a, b) <= threshold) return { kind: 'relation', id: relation.id }
    }
    for (const path of [...(spatial?.paths ?? [])].reverse()) {
      const points = spatialPathPoints(spatial, path, worldTargets)
      if (points.some((value, index) => index > 0 && distance(point, points[index - 1]!, value) <= threshold)) return { kind: 'path', id: path.id }
    }
    return null
  }
  const begin = (event: PointerInput, mode: 'drag' | 'resize' | 'rotate' = 'drag', handle?: FreeResizeHandle) => {
    if (active.current || deferred.current || (event.button !== 0 && event.button !== 1) || inputOwnsPointer(event.target)) return
    const contentEdit = props.contentEditor?.read ? props.contentEditor.read() : props.contentEdit
    if (contentEdit) {
      if (contentEdit.composing || !props.contentEditor) return
      event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
      const input: PointerInput = { pointerId: event.pointerId, button: event.button, clientX: event.clientX, clientY: event.clientY,
        shiftKey: event.shiftKey, altKey: event.altKey, target: event.target, preventDefault() {}, stopPropagation() {} }
      const pending = { input, mode, handle, latest: input, ended: false, documentId: props.documentId, surfaceId: props.surface.id,
        stateId: props.activeStateId ?? null, scope: props.view.scope, epoch: contentEdit.target.epoch }
      deferred.current = pending
      const rejected = (failure: unknown) => {
        if (deferred.current !== pending) return
        deferred.current = null
        if (viewport.current?.hasPointerCapture(pending.input.pointerId)) viewport.current.releasePointerCapture(pending.input.pointerId)
        setError(failure instanceof Error ? failure.message : String(failure))
      }
      void props.contentEditor.commit().then(() => {
        if (deferred.current !== pending) return
        const current = latest.current
        if (current.documentId !== pending.documentId || current.surface.id !== pending.surfaceId || (current.activeStateId ?? null) !== pending.stateId
          || current.view.scope !== pending.scope || current.canvasMode !== 'edit' || current.captureTarget().epoch !== pending.epoch) { deferred.current = null; return }
        deferred.current = null
        resumePointer.current(pending.input, pending.mode, pending.handle)
        resumeMove.current(pending.latest)
        if (pending.ended) resumeFinish.current(pending.input.pointerId)
      }, rejected).catch(failure => {
        if (latest.current.documentId === pending.documentId && latest.current.surface.id === pending.surfaceId) setError(failure instanceof Error ? failure.message : String(failure))
      })
      return
    }
    if (props.canvasMode === 'run' && event.button !== 1 && !spacePan.current && event.target instanceof Element && event.target.closest('[data-component-instance]')) return
    const hit = props.canvasMode === 'run' || event.button === 1 || spacePan.current ? null : mode === 'drag' ? hitFreeObject(visibleTargets, at(event), event.altKey) : scopeTargets.find(target => props.selectionIds.includes(target.instanceId)) ?? null
    const pan = event.button === 1 || spacePan.current || (!hit && !event.shiftKey)
    if (!hit && !pan && props.canvasMode === 'edit') {
      event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
      const start = transformPoint(matrix, at(event))
      active.current = { pointerId: event.pointerId, last: pointer(event), marquee: start, originalSelection: props.selectionIds, targets: [], edits: [], captured: props.captureTarget() }
      setMarquee({ start, end: start }); return
    }
    if (!hit && props.canvasMode === 'edit') { const graph = graphAt(at(event)); if (graph) { props.onGraphSelect(graph); event.stopPropagation(); return } }
    if (hit) { props.onGraphSelect(null); if (mode === 'drag') props.onSelect(event.shiftKey ? props.selectionIds.includes(hit.instanceId) ? props.selectionIds.filter(id => id !== hit.instanceId) : [...props.selectionIds, hit.instanceId] : props.selectionIds.includes(hit.instanceId) ? props.selectionIds : [hit.instanceId]) }
    else if (!event.shiftKey && props.canvasMode === 'edit' && event.button !== 1 && !spacePan.current) props.onSelect([])
    const ids = mode !== 'drag' ? props.selectionIds : hit && event.shiftKey ? props.selectionIds.includes(hit.instanceId) ? props.selectionIds.filter(id => id !== hit.instanceId) : [...props.selectionIds, hit.instanceId] : hit && props.selectionIds.includes(hit.instanceId) ? props.selectionIds : hit ? [hit.instanceId] : []
    const targets = selectedFreeTargets(scopeTargets, ids).filter(target => !locked(target))
    if (hit && !targets.length || !hit && !pan) { event.stopPropagation(); return }
    event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
    active.current = { pointerId: event.pointerId, last: pointer(event), targets, captured: props.captureTarget(), edits: [], geometry: pan ? undefined : new FreeTransformGesture({ mode, handle, targets, pointer: pointer(event), surfaceToPointer: clientMatrix(), snapTargets: visibleTargets.filter(target => !ids.includes(target.instanceId) && !target.ancestors.some(id => ids.includes(id))) }) }
  }
  resumePointer.current = begin
  const move = (event: PointerInput) => {
    if (deferred.current?.input.pointerId === event.pointerId) { deferred.current.latest = { ...deferred.current.input, clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }; return }
    const gesture = active.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const next = pointer(event)
    if (gesture.marquee) { const end = transformPoint(matrix, at(event)); setMarquee({ start: gesture.marquee, end }); props.onSelect([...new Set([...(gesture.originalSelection ?? []), ...marqueeFreeTargets(visibleTargets.map(target => ({ ...target, parentToSurface: composeMatrices(matrix, target.parentToSurface) })), gesture.marquee, end)])]) }
    else if (!gesture.geometry) props.onCamera(panComponentSpatialCamera(latest.current.view.camera, { x: next.x - gesture.last.x, y: next.y - gesture.last.y }))
    else {
      const update = gesture.geometry.update(next, { shift: event.shiftKey, alt: event.altKey })
      gesture.edits = update.edits; setGuides(update.guides)
      const frames = Object.fromEntries(gesture.edits.flatMap(edit => edit.type === 'frame.set' && edit.frame ? [[edit.instanceId, edit.frame]] : []))
      setPreview(frames)
      for (const node of viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? []) {
        const frame = frames[node.dataset.componentInstance ?? '']
        if (frame) { node.style.transform = `matrix(${frame.transform.join(',')})`; node.style.width = `${frame.width}px`; node.style.height = `${frame.height}px` }
      }
    }
    gesture.last = next
  }
  resumeMove.current = move
  const finish = (event: Pick<ReactPointerEvent<HTMLDivElement>, 'pointerId'>, cancel = false) => {
    if (deferred.current?.input.pointerId === event.pointerId) {
      if (cancel && !deferred.current.ended) deferred.current = null
      else deferred.current.ended = true
      if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
      return
    }
    const gesture = active.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    active.current = null
    setMarquee(null)
    if (cancel && gesture.marquee) props.onSelect(gesture.originalSelection ?? [])
    if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
    if (!cancel && gesture.edits.length) void props.onEdits(gesture.edits, gesture.captured).catch(error => setError(String(error))).finally(resetPreview)
    else resetPreview()
  }
  resumeFinish.current = pointerId => finish({ pointerId })
  const selected = selectedFreeTargets(scopeTargets.map(target => preview[target.instanceId] ? { ...target, frame: preview[target.instanceId]! } : target), props.selectionIds)
  const bounds = freeSelectionBounds(selected)
  const corners = selected.length === 1 ? frameCorners(selected[0]!.frame, selected[0]!.parentToSurface) : bounds ? [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom }] : []
  const screenCorners = corners.map(point => transformPoint(matrix, point))
  const [nw, ne, se, sw] = screenCorners
  const mid = (a: GeometryPoint, b: GeometryPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const points = nw && ne && se && sw ? { nw, n: mid(nw, ne), ne, e: mid(ne, se), se, s: mid(sw, se), sw, w: mid(nw, sw) } : null
  const currentFrame = spatial?.frames.find(frame => frame.id === props.view.activeCameraFrameId)
  const zoom = (delta: number) => props.onCamera({ ...props.view.camera, zoom: Math.max(0.01, props.view.camera.zoom + delta) })
  return <main ref={root} className={`workspace workspace--${props.canvasMode} workspace--spatial`} data-testid="spatial-workspace">
    <NativeSelectionContext documentId={props.documentId} revision={props.project.revision} locationId={props.surface.id} itemIds={props.selectionIds} stateId={props.activeStateId} enabled={props.canvasMode === 'edit'} textEditing={Boolean(props.contentEdit)} />
    {menu.element}
    <div className="canvas-mode-switch" role="group" aria-label="画布模式">
      <button type="button" className={props.canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''} aria-pressed={props.canvasMode === 'edit'} onClick={() => props.onCanvasModeChange('edit')}><MousePointer2 size={13} />编辑状态</button>
      <button type="button" className={props.canvasMode === 'run' ? 'canvas-mode-switch__active' : ''} aria-pressed={props.canvasMode === 'run'} onClick={() => props.onCanvasModeChange('run')}><Play size={13} />当前位置试运行</button>
    </div>
    {props.canvasMode === 'edit' && <div className="canvas-view-controls" role="group" aria-label="画布视图">
      <button type="button" aria-label="缩小画布" onClick={() => zoom(-0.1)}><Minus size={14} /></button><output aria-label="画布缩放比例">{Math.round(props.view.camera.zoom * 100)}%</output>
      <button type="button" aria-label="放大画布" onClick={() => zoom(0.1)}><Plus size={14} /></button>
      <button type="button" aria-label="适合窗口" title="回到首页镜头" onClick={() => props.onActivateFrame(null)}><Maximize2 size={14} /></button><span title="Ctrl+滚轮缩放；拖动空白处平移画布"><Hand size={13} /></span>
    </div>}
    <div className={`canvas-label${props.view.scope === 'global' ? ' canvas-label--global' : ''}`}>{props.view.scope === 'global' ? `全局层 · ${globalIds.size} 个元素` : `${props.surface.title} · ${currentFrame?.title ?? '世界'}`}
      {hidden.length > 0 && <button type="button" className="canvas-label__hidden" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); menu.open({ x: box.left, y: box.bottom + 4 }, '隐藏的对象', hiddenMenu()) }}>隐藏 {hidden.length}</button>}
    </div>
    {error && <div role="alert" className="canvas-label">{error}</div>}
    <div ref={viewport} className="canvas-viewport" data-testid="spatial-world-stage" data-workspace-media-drop={dragOver || undefined}
      data-observation-source={props.canvasMode === 'edit' ? 'authoring' : undefined} data-observation-project-id={props.project.id} data-observation-revision={props.project.revision}
      data-observation-surface-id={props.surface.id} data-observation-location-id={currentFrame?.id ?? props.surface.id} data-observation-state-id={props.activeStateId ?? ''} data-observation-ready="true"
      data-observation-spatial-camera={JSON.stringify(props.view.camera)} style={{ overflow: 'hidden', touchAction: 'none', backgroundColor: props.backgroundPreviewColor ?? background.color,
        backgroundImage: props.backgroundAssetUrl ? `url(${JSON.stringify(props.backgroundAssetUrl)})` : undefined, backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit, backgroundPosition: 'center', backgroundRepeat: 'no-repeat', boxShadow: dragOver ? 'inset 0 0 0 3px #245b46' : undefined }}
      onPointerDownCapture={event => { if (!(event.target instanceof Element && event.target.closest('[data-handle]'))) begin(event) }} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}
      onDoubleClick={event => { if (props.canvasMode === 'edit' && !inputOwnsPointer(event.target)) { const hit = hitFreeObject(visibleTargets, at(event), true); if (hit) { props.onSelect([hit.instanceId]); editor.begin(hit.instanceId, at(event), pointer(event)); props.onEditContent?.(hit.instanceId) } } }}
      onContextMenu={event => {
        if (props.canvasMode !== 'edit' || inputOwnsPointer(event.target)) return
        event.preventDefault(); const place = pointer(event), hit = hitFreeObject(visibleTargets, at(event), true)
        if (hit) { const ids = props.selectionIds.includes(hit.instanceId) ? props.selectionIds : [hit.instanceId]; props.onSelect(ids); setTimeout(() => { if (root.current) requestObjectContextMenu(root.current, { ...place, itemIds: ids }) }, 0); return }
        menu.open(place, '画布操作', [
          { id: 'canvas.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'clipboard', run: () => props.onPaste?.(), disabledReason: props.onPaste ? null : '当前界面不支持此操作' },
          { id: 'canvas.select-all', label: '全选', shortcut: 'Ctrl+A', group: 'clipboard', run: () => props.onSelectAll?.() },
          { id: 'canvas.hidden', label: '找回隐藏的对象', group: 'view', run: () => menu.open(place, '隐藏的对象', hiddenMenu()), disabledReason: hidden.length ? null : '本页没有隐藏的对象' },
          { id: 'canvas.try-run', label: '当前位置试运行', group: 'view', run: () => props.onCanvasModeChange('run') },
        ])
      }}
      onDragOver={event => { if (props.onDropWorkspaceMedia && props.canvasMode === 'edit' && props.view.scope === 'world' && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false) }}
      onDrop={event => {
        if (!props.onDropWorkspaceMedia || !event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) return
        event.preventDefault(); setDragOver(false)
        if (props.canvasMode !== 'edit' || props.view.scope !== 'world') { setError('请切换到可编辑的无限画布世界层后拖入媒体'); return }
        const frozen = props.captureTarget(), point = at(event)
        void deliverWorkspaceMediaDrop(event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE), media, { surface: 'spatial', x: point.x, y: point.y },
          { captured: frozen, documentId: frozen.documentId, projectId: frozen.project.id, revision: frozen.project.revision, locationId: props.surface.id, surfaceId: props.surface.id, sessionGeneration: props.activation ?? 0 }, props.onDropWorkspaceMedia,
          () => mediaRef.current.directory === media.directory && mediaRef.current.files === media.files).then(result => setError(result.ok ? null : result.reason ?? '媒体未插入'))
      }}>
      <div data-spatial-hud-plane="underlay" style={{ position: 'absolute', left: 0, top: 0, width: design.width, height: design.height, transformOrigin: '0 0', transform: `matrix(${hudMatrix.join(',')})`, pointerEvents: props.view.scope === 'global' ? 'auto' : 'none' }}>{props.project.global.underlay.map(props.renderInstance)}</div>
      <div data-spatial-world="true" style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', transform: `matrix(${worldMatrix.join(',')})` }}>{props.surface.childIds.map(props.renderInstance)}</div>
      <div data-spatial-hud-plane="overlay" style={{ position: 'absolute', left: 0, top: 0, width: design.width, height: design.height, transformOrigin: '0 0', transform: `matrix(${hudMatrix.join(',')})`, pointerEvents: props.view.scope === 'global' || props.canvasMode === 'run' ? 'auto' : 'none' }}>{props.project.global.overlay.map(props.renderInstance)}</div>
      {props.canvasMode === 'edit' && <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', transform: `matrix(${matrix.join(',')})` }}>{editor.editor}</div>}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        {guides.map((guide, index) => {
          const inverse = invertMatrix(matrix), extent = [{ x: 0, y: 0 }, { x: size.width, y: 0 }, { x: size.width, y: size.height }, { x: 0, y: size.height }].map(point => transformPoint(inverse, point))
          const start = transformPoint(matrix, guide.axis === 'x' ? { x: guide.value, y: Math.min(...extent.map(point => point.y)) } : { x: Math.min(...extent.map(point => point.x)), y: guide.value })
          const end = transformPoint(matrix, guide.axis === 'x' ? { x: guide.value, y: Math.max(...extent.map(point => point.y)) } : { x: Math.max(...extent.map(point => point.x)), y: guide.value })
          return <line key={index} data-spatial-snap-guide={guide.axis} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#ff4d9d" />
        })}
        {marquee && (() => { const { start, end } = marquee; return <rect data-spatial-marquee="true" x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)} width={Math.abs(end.x - start.x)} height={Math.abs(end.y - start.y)} fill="#2563eb22" stroke="#2563eb" /> })()}
        <defs><marker id={`spatial-arrow-${props.surface.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#64748b" /></marker></defs>
        {(spatial?.relations ?? []).map(relation => {
          const a = spatialComponentCenter(worldTargets, relation.sourceInstanceId), b = spatialComponentCenter(worldTargets, relation.targetInstanceId); if (!a || !b) return null
          const start = transformPoint(worldMatrix, a), end = transformPoint(worldMatrix, b)
          return <g key={relation.id} data-spatial-relation-id={relation.id}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={props.view.graphSelection?.id === relation.id ? '#2563eb' : '#64748b'} strokeWidth={2} markerEnd={relation.kind !== 'line' ? `url(#spatial-arrow-${props.surface.id})` : undefined} markerStart={relation.kind === 'bidirectional' ? `url(#spatial-arrow-${props.surface.id})` : undefined} />{relation.label && <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6} fill="#334155">{relation.label}</text>}</g>
        })}
        {(spatial?.paths ?? []).map(path => <polyline key={path.id} data-spatial-path-id={path.id} points={spatialPathPoints(spatial, path, worldTargets).map(point => { const value = transformPoint(worldMatrix, point); return `${value.x},${value.y}` }).join(' ')} fill="none" stroke={props.view.graphSelection?.id === path.id ? '#2563eb' : path.style?.color ?? '#3388ff'} strokeWidth={path.style?.width ?? 2} strokeDasharray={path.style?.dash === 'dashed' ? '8 5' : path.style?.dash === 'dotted' ? '2 4' : undefined} />)}
        {props.canvasMode === 'edit' && props.view.showCameraFrames && spatial?.frames.map(frame => {
          const pose = spatialFramePose(frame, design, worldTargets), cameraBox = composeMatrices(translationMatrix(pose.x, pose.y), rotationMatrix((pose.rotation ?? 0) * Math.PI / 180), scaleMatrix(1 / pose.zoom), translationMatrix(-design.width / 2, -design.height / 2))
          const points = frameCorners({ width: design.width, height: design.height, transform: cameraBox }).map(point => transformPoint(worldMatrix, point))
          return <g key={frame.id} data-spatial-camera-frame={frame.id}><polygon points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={frame.id === props.view.activeCameraFrameId ? '#2563eb' : '#94a3b8'} strokeDasharray="7 5" /><text x={points[0]!.x + 4} y={points[0]!.y - 6}>{frame.title ?? frame.id}</text></g>
        })}
        {props.canvasMode === 'edit' && points && <><polygon points={screenCorners.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={1.5} />
          {!selected.some(locked) && handles.map(handle => <circle key={handle} data-handle={handle} cx={points[handle].x} cy={points[handle].y} r={5} fill="white" stroke="#2563eb" style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }} onPointerDown={event => { event.stopPropagation(); begin(event, 'resize', handle) }} />)}
          {!selected.some(locked) && <circle data-handle="rotate" cx={points.n.x} cy={points.n.y - 28} r={6} fill="white" stroke="#2563eb" style={{ pointerEvents: 'auto', cursor: 'grab' }} onPointerDown={event => { event.stopPropagation(); begin(event, 'rotate') }} />}
        </>}
      </svg>
    </div>
  </main>
}
