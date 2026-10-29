import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ComponentAuthorPointerEventDetail, ComponentAuthorSpot } from '../../../shared/contracts/component-platform/runtime'
import { componentIsLocked } from '../../../shared/contracts/component-platform/project'
import { frameContainsPoint, frameCorners, frameToSpaceMatrix, IDENTITY_MATRIX, invertMatrix, multiplyMatrices, transformPoint, type GeometryPoint } from '../../../core/components/geometry'
import { componentParentMatrix } from '../../../core/drivers/courseV10Operations'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
import { requestComponentAuthorHit, visibleComponentAuthorHit, type VisibleComponentAuthorHit } from '../../components/componentAuthorHit'
import { authorSpotEdits, authorSpotGeometryEdits, authorSpotImageEdits } from '../../componentPlatform/surfaces/slide/authorSpots'
import { AuthorSpotTransformGesture, type FreeResizeHandle } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import type { FreeObjectTarget } from '../../componentPlatform/surfaces/slide/targets'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import { authorFieldIdentity, interactionSelectionIdentity, selectionMatchesSpot } from '../../documents/interactionSelection'
import { selectActiveSlideContentEdit, useEditorStore } from '../../store/editorStore'
import type { ImportedImageAsset } from '../../project/assetManager'
import { flowContentClientMatrix } from '../flow/flowParagraphLayout'
import { ProfessionalContentEditor } from './ProfessionalContentEditor'
import { AUTHOR_FIELD_ACTION_EVENT, requestImageEdit, requestObjectContextMenu, type AuthorFieldActionRequest } from '../../editing/commands/objectContextMenu'
import { nativeTextClientRect, nativeTextSpotFromElement } from '../../authoring/professionalContentFields'
import { authorSpotValue } from '../../../core/components/authoring/componentAuthorEdits'
import type { PlainTextSelectionIntent } from '../CanvasPlainTextEditor'

type AuthorPointer = ComponentAuthorPointerEventDetail
interface NativeFieldObservation { rootInstanceId?: string | null; editingContainerId?: string | null; activeStateId: string | null; contextKey?: string; documentId: string; epoch: string | undefined; spot: ComponentAuthorSpot; activate?: () => boolean; read?: () => ComponentAuthorSpot | undefined }
interface FieldCaretIntent { documentId: string; epoch?: string; surfaceId: string | null; rootInstanceId?: string | null; editingContainerId?: string | null; activeStateId: string | null; contextKey?: string; fieldIdentity: string; offset: number }
interface AuthorHit { spot?: ComponentAuthorSpot; object: boolean }
interface AuthorPointerPoint extends GeometryPoint { shift?: boolean; alt?: boolean }
interface AuthorDragPointer {
  pointerId: number; start: GeometryPoint; latest: AuthorPointerPoint; released: boolean; cancelled: boolean; moved?: boolean
  owner?: HTMLElement; instanceId?: string; authorKey?: string; mountGeneration?: number
  gesture?: AuthorSpotTransformGesture; captured?: CapturedCourseTarget; contextKey?: string
  objectStarted?: boolean; request?: ComponentAuthorPointerEventDetail
}
export type ComponentAuthorObjectPointer = ComponentAuthorPointerEventDetail & { released?: boolean }
type AuthorElementPointer = React.PointerEvent<HTMLElement> & {
  released?: boolean; cancelled?: boolean
  finalPointer?: { clientX: number; clientY: number; shiftKey?: boolean; altKey?: boolean }
}

/** The same registered author field enters the same input owner on every workspace. */
export function useComponentAuthorInteraction({ root, documentId, surfaceId, enabled, selectImage, report, wholeInstanceEditor = true, contextKey, onObjectPointer, resolveObjectTarget, onObjectDoubleClick, workspaceOwnsObjectSelection = false }: {
  root: RefObject<HTMLElement | null>; documentId: string; surfaceId: string | null; enabled: boolean
  selectImage?(): Promise<ImportedImageAsset | null>; report(message: string): void
  /** A workspace with the native table/chart owner renders whole-instance drafts there. */
  wholeInstanceEditor?: boolean
  contextKey?: string
  /** The workspace retains its existing whole-object/reading-order gesture owner. */
  onObjectPointer?(detail: ComponentAuthorObjectPointer, clientPoint: GeometryPoint): void
  resolveObjectTarget?(instanceId: string): string | null
  onObjectDoubleClick?(instanceId: string, clientPoint: GeometryPoint): void
  /** Free-canvas workspaces decide first-group/second-member selection at pointer release. */
  workspaceOwnsObjectSelection?: boolean
}) {
  const runtime = useCourseV10Runtime()
  const bridge = useEditorStore(state => state.courseBridge)
  const selection = useEditorStore(state => state.courseView.interactionSelection)
  const draft = useEditorStore(selectActiveSlideContentEdit)
  const [spots, setSpots] = useState<readonly ComponentAuthorSpot[]>(() => runtime.world.authorSpots())
  const latest = useRef({ runtime, documentId, surfaceId, enabled, selectImage, report, contextKey, onObjectPointer, resolveObjectTarget, onObjectDoubleClick, workspaceOwnsObjectSelection })
  latest.current = { runtime, documentId, surfaceId, enabled, selectImage, report, contextKey, onObjectPointer, resolveObjectTarget, onObjectDoubleClick, workspaceOwnsObjectSelection }
  const intent = useRef(0)
  const caret = useRef<GeometryPoint | undefined>(undefined)
  const fieldCaret = useRef<FieldCaretIntent | undefined>(undefined)
  const [realmSelection, setRealmSelection] = useState<{ instanceId: string; authorKey?: string; value: PlainTextSelectionIntent } | null>(null)
  const authorPointer = useRef<AuthorDragPointer | null>(null)
  const [transformPreview, setTransformPreview] = useState<{ spotId: string; frame: FreeObjectTarget['frame'] } | null>(null)
  const nativeObservation = useRef<NativeFieldObservation | undefined>(undefined)
  useEffect(() => {
    const update = () => setSpots(runtime.world.authorSpots())
    const stop = runtime.world.subscribeAuthorSpots(update)
    update()
    return stop
  }, [runtime.world])
  useEffect(() => { nativeObservation.current = undefined; fieldCaret.current = undefined; setRealmSelection(null); return () => { ++intent.current } }, [documentId, surfaceId, contextKey])
  useEffect(() => { if (!enabled) fieldCaret.current = undefined; return () => { ++intent.current } }, [enabled])
  // Disposable view hints consume the registered fields and the existing layout;
  // they own neither author identities nor input/drag operations.
  useEffect(() => {
    const owner = root.current
    if (!owner || !enabled) return
    const layer = owner.ownerDocument.createElement('div')
    layer.className = 'author-field-affordances'; layer.setAttribute('aria-hidden', 'true'); owner.append(layer)
    let hovered: { instanceId: string; authorKey?: string } | undefined, scheduled = 0
    const marks = new Map<string, HTMLDivElement>()
    const draw = () => {
      scheduled = 0
      const outer = owner.getBoundingClientRect(), shown = new Set<string>(), current = latest.current
      for (const spot of current.runtime.world.authorSpots()) {
        if (current.resolveObjectTarget && current.resolveObjectTarget(spot.instanceId) !== spot.instanceId) continue
        const element = current.runtime.world.contentElement?.(spot.instanceId), matrix = element && flowContentClientMatrix(element)
        if (!element || !owner.contains(element) || !matrix) continue
        const points = frameCorners(spot.localBounds).map(point => transformPoint(matrix, point)), xs = points.map(point => point.x), ys = points.map(point => point.y)
        const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top
        if (width <= 0 || height <= 0 || left >= outer.right || top >= outer.bottom || left + width <= outer.left || top + height <= outer.top) continue
        shown.add(spot.id)
        let mark = marks.get(spot.id)
        if (!mark) { mark = owner.ownerDocument.createElement('div'); mark.className = 'author-field-affordance'; layer.append(mark); marks.set(spot.id, mark) }
        const active = hovered?.instanceId === spot.instanceId && hovered.authorKey === spot.authorKey
        const selected = selectionMatchesSpot(bridge.read().interactionSelection, spot)
        mark.dataset.hovered = String(active || selected); mark.dataset.selected = String(selected); mark.dataset.authorAffordance = spot.kind
        Object.assign(mark.style, { left: `${left - outer.left}px`, top: `${top - outer.top}px`, width: `${width}px`, height: `${height}px` })
      }
      for (const [id, mark] of marks) if (!shown.has(id)) { mark.remove(); marks.delete(id) }
    }
    const schedule = () => { if (!scheduled) scheduled = requestAnimationFrame(draw) }
    const hover = (event: Event) => { const value = (event as CustomEvent<{ instanceId: string; authorKey?: string }>).detail; hovered = value; schedule() }
    const leave = () => { hovered = undefined; schedule() }
    const stop = runtime.world.subscribeAuthorSpots(schedule)
    owner.addEventListener('component-author-hover', hover); owner.addEventListener('pointerleave', leave)
    owner.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); draw()
    return () => { stop(); if (scheduled) cancelAnimationFrame(scheduled); layer.remove(); owner.removeEventListener('component-author-hover', hover); owner.removeEventListener('pointerleave', leave); owner.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule) }
  }, [enabled, root, runtime.world, documentId, surfaceId, contextKey, selection, bridge])
  const nativeSpotAtAddress = (instanceId: string, dataPath?: string[]) => {
    if (!dataPath) return undefined
    const currentRuntime = latest.current.runtime
    const content = currentRuntime.world.contentElement?.(instanceId), matrix = content && flowContentClientMatrix(content)
    if (!content || !matrix) return undefined
    const path = JSON.stringify(dataPath)
    const element = [content, ...content.querySelectorAll<HTMLElement>('[data-document-path]')].find(candidate =>
      candidate.dataset.documentPath === path && candidate.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance === instanceId)
    const rect = element && nativeTextClientRect(element)
    if (!element || !rect) return undefined
    const inverse = invertMatrix(matrix), a = transformPoint(inverse, { x: rect.left, y: rect.top }), b = transformPoint(inverse, { x: rect.right, y: rect.bottom })
    return nativeTextSpotFromElement(currentRuntime.project, instanceId, element, { width: Math.max(1, b.x - a.x), height: Math.max(1, b.y - a.y), transform: [1, 0, 0, 1, a.x, a.y] })
  }
  const native = nativeObservation.current
  const nativeView = bridge.read()
  const nativeSpot = native?.documentId === documentId && native.epoch === nativeView.snapshot?.epoch && native.contextKey === contextKey
    && native.rootInstanceId === nativeView.rootInstanceId && native.editingContainerId === nativeView.editingContainerId
    && native.activeStateId === nativeView.activeStateId
    ? native.read ? native.read() : native.spot
    : selection?.kind === 'author-field' ? nativeSpotAtAddress(selection.instanceId, selection.field.dataPath) : undefined
  const selectedSpot = spots.find(spot => selectionMatchesSpot(selection, spot))
    ?? (nativeSpot && selectionMatchesSpot(selection, nativeSpot) ? nativeSpot : undefined)
  useEffect(() => {
    const current = bridge.read(), observed = nativeObservation.current
    if (nativeSpot && observed && current.activeDocumentId === documentId && current.snapshot?.epoch === observed.epoch
      && selectionMatchesSpot(current.interactionSelection, nativeSpot)) {
      observed.spot = nativeSpot
      bridge.selectAuthorSpot(documentId, nativeSpot, surfaceId)
    }
  }, [bridge, documentId, surfaceId, runtime.project, selection])
  const currentSpot = (spot: ComponentAuthorSpot) => {
    const registered = latest.current.runtime.world.authorSpots().find(value => value.instanceId === spot.instanceId
      && authorFieldIdentity(value.instanceId, value) === authorFieldIdentity(spot.instanceId, spot))
    if (registered) return registered
    const observed = nativeObservation.current
    if (!observed || authorFieldIdentity(observed.spot.instanceId, observed.spot) !== authorFieldIdentity(spot.instanceId, spot)) {
      const value = nativeSpotAtAddress(spot.instanceId, spot.dataPath)
      return value && authorFieldIdentity(value.instanceId, value) === authorFieldIdentity(spot.instanceId, spot) ? value : undefined
    }
    if (observed.documentId !== latest.current.documentId || observed.epoch !== bridge.read().snapshot?.epoch) return undefined
    const value = observed.read ? observed.read() : observed.spot
    return value && authorFieldIdentity(value.instanceId, value) === authorFieldIdentity(spot.instanceId, spot) ? value : undefined
  }
  const activate = useCallback(async (candidate: ComponentAuthorSpot, edit: boolean, point?: GeometryPoint, caretOffset?: number): Promise<boolean> => {
    const owner = latest.current, initial = bridge.read()
    if (!owner.enabled || initial.activeDocumentId !== owner.documentId || edit && componentIsLocked(owner.runtime.project, candidate.instanceId)) return false
    const ticket = ++intent.current, epoch = initial.snapshot?.epoch, rootId = initial.rootInstanceId, containerId = initial.editingContainerId
    const sameContext = () => {
      const current = bridge.read()
      return ticket === intent.current && latest.current.enabled && latest.current.contextKey === owner.contextKey && current.activeDocumentId === owner.documentId
        && current.snapshot?.epoch === epoch && current.surfaceId === owner.surfaceId
        && current.rootInstanceId === rootId && current.editingContainerId === containerId && current.activeStateId === initial.activeStateId
        && interactionSelectionIdentity(current.interactionSelection) === interactionSelectionIdentity(initial.interactionSelection)
    }
    try {
      if (point && (await visibleComponentAuthorHit(root.current, point, id => owner.runtime.world.contentElement?.(id)))?.instanceId !== candidate.instanceId) return false
      if (!sameContext()) return false
      const state = useEditorStore.getState(), previous = state.slideContentEdit
      if (previous) {
        if (edit && previous.authorSpot && previous.target.documentId === owner.documentId && previous.target.epoch === epoch
          && previous.target.surfaceId === owner.surfaceId && previous.target.rootInstanceId === rootId
          && previous.target.editingContainerId === containerId && previous.target.activeStateId === initial.activeStateId
          && authorFieldIdentity(previous.instanceId, previous.authorSpot) === authorFieldIdentity(candidate.instanceId, candidate)) return true
        await state.commitSlideContentEdit()
      }
      if (!sameContext()) return false
      // Re-resolve the captured author address after ACK, never the old screen coordinate.
      const spot = currentSpot(candidate)
      if (!spot) throw new Error('最初选择的内容已更新，请重新选择。当前输入已保留。')
      bridge.selectAuthorSpot(owner.documentId, spot, owner.surfaceId)
      if (point) caret.current = point
      fieldCaret.current = edit && spot.kind === 'text' && typeof caretOffset === 'number' && Number.isSafeInteger(caretOffset) && caretOffset >= 0
        ? { documentId: owner.documentId, epoch, surfaceId: owner.surfaceId, rootInstanceId: rootId, editingContainerId: containerId,
          activeStateId: initial.activeStateId, contextKey: owner.contextKey, fieldIdentity: authorFieldIdentity(spot.instanceId, spot), offset: caretOffset }
        : undefined
      if (edit && spot.kind === 'image' && epoch) requestImageEdit({ documentId: owner.documentId, epoch, itemId: spot.instanceId, selectionIdentity: authorFieldIdentity(spot.instanceId, spot) })
      if (!edit || spot.kind === 'image') return true
      const captured = bridge.captureOwnedTarget(owner.documentId)
      return Boolean(await state.beginSlideSpotEdit(spot, captured, () => currentSpot(spot)))
    } catch (error) { owner.report(error instanceof Error ? error.message : String(error)); return false }
  }, [bridge])
  const selectNativeField = useCallback((spot: ComponentAuthorSpot, activate?: () => boolean, read?: () => ComponentAuthorSpot | undefined) => {
    const owner = latest.current
    const current = bridge.read()
    nativeObservation.current = { documentId: owner.documentId, epoch: current.snapshot?.epoch, contextKey: owner.contextKey,
      rootInstanceId: current.rootInstanceId, editingContainerId: current.editingContainerId, activeStateId: current.activeStateId, spot, activate, read }
    bridge.selectAuthorSpot(owner.documentId, spot, owner.surfaceId)
  }, [bridge])
  const fieldIsCurrent = useCallback((identity: string) => {
    const observed = nativeObservation.current, current = bridge.read(), owner = latest.current
    return Boolean(observed && owner.enabled && owner.contextKey === observed.contextKey && current.activeDocumentId === owner.documentId
      && current.snapshot?.epoch === observed.epoch && current.surfaceId === owner.surfaceId
      && current.rootInstanceId === observed.rootInstanceId && current.editingContainerId === observed.editingContainerId
      && current.activeStateId === observed.activeStateId && interactionSelectionIdentity(current.interactionSelection) === identity
      && (!observed.read || observed.read()))
  }, [bridge])
  const beginNative = useCallback(async (instanceId: string, capturedBegin: () => boolean, onActivated?: () => void): Promise<boolean> => {
    const owner = latest.current, initial = bridge.read(), ticket = ++intent.current
    if (!owner.enabled || initial.activeDocumentId !== owner.documentId) return false
    try {
      await useEditorStore.getState().commitSlideContentEdit()
      const current = bridge.read()
      if (ticket !== intent.current || !latest.current.enabled || latest.current.contextKey !== owner.contextKey || current.activeDocumentId !== owner.documentId
        || current.snapshot?.epoch !== initial.snapshot?.epoch || current.surfaceId !== owner.surfaceId
        || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
        || current.activeStateId !== initial.activeStateId
      || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return false
      const observation = nativeObservation.current
      if (!capturedBegin()) { owner.report('最初选择的内容已更新，请重新选择。'); return false }
      // Native cell/label activation publishes its exact field. Whole text/formula
      // activation keeps the owning object, only after the original target exists.
      if (nativeObservation.current === observation) bridge.selectInstances(owner.documentId, [instanceId], owner.surfaceId)
      onActivated?.()
      return true
    } catch (error) { owner.report(error instanceof Error ? error.message : String(error)); return false }
  }, [bridge])
  const releasePointer = (pointer: AuthorDragPointer) => {
    try {
      if (pointer.owner?.hasPointerCapture?.(pointer.pointerId)) pointer.owner.releasePointerCapture(pointer.pointerId)
    } catch { /* A pointer already released by its realm has no remaining host capture. */ }
  }
  const cancelAuthorPointer = useCallback(() => {
    const pointer = authorPointer.current
    if (!pointer) return
    authorPointer.current = null; pointer.cancelled = true; ++intent.current
    if (pointer.objectStarted && pointer.request)
      latest.current.onObjectPointer?.({ ...pointer.request, phase: 'cancel', released: pointer.released }, pointer.latest)
    if (pointer.gesture) latest.current.runtime.previewAuthorSpot?.(pointer.gesture.spot.id, null)
    setTransformPreview(null); releasePointer(pointer)
  }, [])
  const pointerIsCurrent = (pointer: AuthorDragPointer) => {
    const captured = pointer.captured, current = bridge.read(), owner = latest.current
    return Boolean(!pointer.cancelled && owner.enabled && captured && pointer.contextKey === owner.contextKey
      && current.activeDocumentId === captured.documentId && current.snapshot?.epoch === captured.epoch
      && current.surfaceId === captured.surfaceId && current.rootInstanceId === captured.rootInstanceId
      && current.editingContainerId === captured.editingContainerId && current.activeStateId === captured.activeStateId
      && pointer.gesture && selectionMatchesSpot(current.interactionSelection, pointer.gesture.spot)
      && !componentIsLocked(owner.runtime.project, pointer.gesture.spot.instanceId))
  }
  const updateAuthorPointer = useCallback((pointer: AuthorDragPointer, point: AuthorPointerPoint) => {
    pointer.latest = point
    pointer.moved ||= Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) >= 3
    if (pointer.objectStarted && pointer.request) {
      latest.current.onObjectPointer?.({ ...pointer.request, phase: 'update', shiftKey: point.shift, altKey: point.alt }, point); return
    }
    if (!pointer.gesture || !pointer.moved) return
    if (!pointerIsCurrent(pointer)) { cancelAuthorPointer(); return }
    const update = pointer.gesture.update(point, point)
    latest.current.runtime.previewAuthorSpot?.(pointer.gesture.spot.id, update.geometry)
    setTransformPreview({ spotId: pointer.gesture.spot.id, frame: update.frame })
  }, [bridge, cancelAuthorPointer])
  const finishAuthorPointer = useCallback(async (pointer: AuthorDragPointer, point: AuthorPointerPoint) => {
    pointer.latest = point; pointer.released = true; releasePointer(pointer)
    pointer.moved ||= Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) >= 3
    if (pointer.objectStarted && pointer.request) {
      authorPointer.current = null
      latest.current.onObjectPointer?.({ ...pointer.request, phase: 'end', released: true, shiftKey: point.shift, altKey: point.alt }, point); return
    }
    // Paint hit and input ACK can finish after pointerup. Keep their final point,
    // and complete the same frozen address once the gesture has been prepared.
    if (!pointer.gesture || authorPointer.current !== pointer) return
    authorPointer.current = null; setTransformPreview(null)
    const owner = latest.current, spot = pointer.gesture.spot
    try {
      if (!pointerIsCurrent(pointer) || !pointer.moved) return
      const { geometry } = pointer.gesture.update(point, point)
      if (!Object.keys(geometry).length) return
      const captured = pointer.captured!, current = bridge.captureOwnedTarget(captured.documentId)
      const target = { ...captured, project: current.project, editingProject: current.editingProject, resources: current.resources }
      const edits = authorSpotGeometryEdits(target.editingProject, spot, geometry, captured.editingProject)
      if (edits.length) await bridge.editCaptured(bridge.capture(edits, target), crypto.randomUUID())
    } catch (error) { owner.report(error instanceof Error ? error.message : String(error)) }
    finally { owner.runtime.previewAuthorSpot?.(spot.id, null) }
  }, [bridge])
  const prepareAuthorPointer = useCallback(async (pointer: AuthorDragPointer, candidate: ComponentAuthorSpot) => {
    if (authorPointer.current !== pointer || pointer.cancelled) return
    if (!await activate(candidate, false, pointer.start)) {
      if (authorPointer.current === pointer) { authorPointer.current = null; releasePointer(pointer) }
      return
    }
    if (authorPointer.current !== pointer || pointer.cancelled) return
    const spot = currentSpot(candidate), owner = latest.current
    const content = spot && owner.runtime.world.contentElement?.(spot.instanceId), instanceToSurface = content && flowContentClientMatrix(content)
    if (!spot?.geometry || !instanceToSurface || componentIsLocked(owner.runtime.project, spot.instanceId)) {
      authorPointer.current = null; releasePointer(pointer); return
    }
    pointer.captured = bridge.captureOwnedTarget(owner.documentId); pointer.contextKey = owner.contextKey
    pointer.gesture = new AuthorSpotTransformGesture({ spot, mode: 'drag', instanceToSurface, surfaceToPointer: IDENTITY_MATRIX, pointer: pointer.start })
    if (pointer.released) await finishAuthorPointer(pointer, pointer.latest)
    else updateAuthorPointer(pointer, pointer.latest)
  }, [activate, bridge, finishAuthorPointer, updateAuthorPointer])
  const newElementPointer = (event: AuthorElementPointer): AuthorDragPointer => {
    cancelAuthorPointer()
    const final = event.finalPointer
    const pointer: AuthorDragPointer = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY },
      latest: { x: final?.clientX ?? event.clientX, y: final?.clientY ?? event.clientY,
        shift: final?.shiftKey ?? event.shiftKey, alt: final?.altKey ?? event.altKey },
      released: Boolean(event.released), cancelled: Boolean(event.cancelled), owner: event.currentTarget ?? root.current ?? undefined }
    authorPointer.current = pointer
    // Frozen events supplied after an asynchronous visible-hit must never try
    // to capture an already finished pointer.
    if (!pointer.released && !pointer.cancelled) {
      try { pointer.owner?.setPointerCapture?.(pointer.pointerId) } catch { /* The pending window record remains authoritative. */ }
    }
    return pointer
  }
  const beginTransform = useCallback((event: AuthorElementPointer, mode: 'drag' | 'resize' | 'rotate', handle?: FreeResizeHandle): boolean => {
    const owner = latest.current, current = bridge.read()
    const spot = owner.runtime.world.authorSpots().find(value => selectionMatchesSpot(current.interactionSelection, value))
    if (!owner.enabled || event.button !== 0 || !spot?.geometry || componentIsLocked(owner.runtime.project, spot.instanceId) || mode === 'resize' && !handle) return false
    event.preventDefault(); event.stopPropagation()
    const pointer = newElementPointer(event)
    void (async () => {
      if (pointer.cancelled || !await activate(spot, false) || authorPointer.current !== pointer) return
      const value = currentSpot(spot), content = value && latest.current.runtime.world.contentElement?.(value.instanceId)
      const instanceToSurface = content && flowContentClientMatrix(content)
      if (!value?.geometry || !instanceToSurface) { cancelAuthorPointer(); return }
      pointer.captured = bridge.captureOwnedTarget(owner.documentId); pointer.contextKey = owner.contextKey
      pointer.gesture = new AuthorSpotTransformGesture({ spot: value, mode, handle, instanceToSurface, surfaceToPointer: IDENTITY_MATRIX, pointer: pointer.start })
      if (pointer.released) await finishAuthorPointer(pointer, pointer.latest)
      else updateAuthorPointer(pointer, pointer.latest)
    })().catch(error => { cancelAuthorPointer(); owner.report(error instanceof Error ? error.message : String(error)) })
    return true
  }, [activate, bridge, cancelAuthorPointer, finishAuthorPointer, updateAuthorPointer])
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const pointer = authorPointer.current
      if (!pointer || pointer.released || pointer.pointerId !== event.pointerId) return
      updateAuthorPointer(pointer, { x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey })
    }
    const end = (event: PointerEvent) => {
      const pointer = authorPointer.current
      if (pointer?.pointerId === event.pointerId && !pointer.released)
        void finishAuthorPointer(pointer, { x: event.clientX, y: event.clientY, shift: event.shiftKey, alt: event.altKey })
    }
    const cancel = (event: PointerEvent) => {
      const pointer = authorPointer.current
      if (pointer?.pointerId === event.pointerId && (event.type !== 'lostpointercapture' || !pointer.released)) cancelAuthorPointer()
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelAuthorPointer() }
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', cancel, true); window.addEventListener('lostpointercapture', cancel, true); window.addEventListener('keydown', escape, true)
    return () => {
      cancelAuthorPointer()
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', end, true)
      window.removeEventListener('pointercancel', cancel, true); window.removeEventListener('lostpointercapture', cancel, true); window.removeEventListener('keydown', escape, true)
    }
  }, [enabled, documentId, surfaceId, contextKey, cancelAuthorPointer, finishAuthorPointer, updateAuthorPointer])
  const selectPaintedObject = useCallback(async (instanceId: string, initial: ReturnType<typeof bridge.read>, ticket: number) => {
    const owner = latest.current, objectId = owner.resolveObjectTarget ? owner.resolveObjectTarget(instanceId) : instanceId
    if (!objectId) return false
    await useEditorStore.getState().commitSlideContentEdit()
    const current = bridge.read()
    if (ticket !== intent.current || !latest.current.enabled || latest.current.contextKey !== owner.contextKey || current.activeDocumentId !== owner.documentId
      || current.snapshot?.epoch !== initial.snapshot?.epoch || current.surfaceId !== owner.surfaceId
      || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
      || current.activeStateId !== initial.activeStateId
      || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return false
    bridge.selectInstances(owner.documentId, [objectId], owner.surfaceId)
    return true
  }, [bridge])
  const findSpot = useCallback(async (request: AuthorPointer): Promise<AuthorHit> => {
    const owner = latest.current
    const content = owner.runtime.world.contentElement?.(request.instanceId), matrix = content && flowContentClientMatrix(content)
    if (matrix) {
      const visible = await visibleComponentAuthorHit(root.current, transformPoint(matrix, request.localPoint), id => owner.runtime.world.contentElement?.(id))
      if (visible?.instanceId !== request.instanceId) return { object: false }
      if (visible.authorKey === null) return { object: true }
      if (visible.authorKey !== undefined) request = { ...request, authorKey: visible.authorKey ?? undefined }
    }
    const candidates = [...owner.runtime.world.authorSpots()].reverse().filter(spot => spot.instanceId === request.instanceId
      && (request.mountGeneration === undefined || spot.mountGeneration === request.mountGeneration))
    if (request.authorKey) return { spot: candidates.find(spot => spot.authorKey === request.authorKey), object: false }
    const host = owner.runtime.world.contentElement?.(request.instanceId)
    const hit = await requestComponentAuthorHit(host ?? null, request.localPoint)
    if (hit) return { spot: hit.authorKey ? candidates.find(spot => spot.authorKey === hit.authorKey) : undefined,
      object: hit.painted && !hit.authorKey }
    const spot = candidates.find(spot => frameContainsPoint(spot.localBounds, request.localPoint))
    return { spot, object: !spot }
  }, [])
  const replace = useCallback(async (spot: ComponentAuthorSpot) => {
    const owner = latest.current
    if (componentIsLocked(owner.runtime.project, spot.instanceId)) return false
    if (!owner.selectImage || !await activate(spot, false)) return false
    const captured = bridge.captureOwnedTarget(owner.documentId)
    if (componentIsLocked(captured.editingProject, spot.instanceId)) return false
    try {
      authorSpotEdits(captured.editingProject, spot, spot.initialValue, captured.resources)
      const imported = await owner.selectImage()
      if (!imported) return true
      await bridge.editCaptured(bridge.capture(authorSpotImageEdits(captured.editingProject, spot, imported, captured.resources), captured))
      return true
    } catch (error) { owner.report(error instanceof Error ? error.message : String(error)); return false }
  }, [activate, bridge])
  const beginRegisteredSpot = useCallback(async (instanceId: string, localPoint: GeometryPoint, generation?: number, authorKey?: string, caretOffset?: number, edit = false) => {
    const owner = latest.current, initial = bridge.read(), ticket = ++intent.current
    if (edit) setRealmSelection(null)
    const host = owner.runtime.world.contentElement?.(instanceId), matrix = host && flowContentClientMatrix(host)
    const clientPoint = matrix ? transformPoint(matrix, localPoint) : undefined
    const resolvedId = owner.resolveObjectTarget ? owner.resolveObjectTarget(instanceId) : instanceId
    if (!resolvedId) return false
    const hit: AuthorHit = resolvedId === instanceId ? await findSpot({ instanceId, localPoint, mountGeneration: generation, authorKey }) : { object: true }
    const current = bridge.read()
    if (ticket !== intent.current || !latest.current.enabled || latest.current.contextKey !== owner.contextKey || current.activeDocumentId !== owner.documentId
      || current.snapshot?.epoch !== initial.snapshot?.epoch || current.surfaceId !== owner.surfaceId
      || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
      || current.activeStateId !== initial.activeStateId
      || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return true
    const objectId = owner.resolveObjectTarget ? owner.resolveObjectTarget(instanceId) : instanceId
    if (!objectId) return false
    if (objectId !== instanceId || hit.object) {
      const accepted = await selectPaintedObject(instanceId, initial, ticket)
      if (accepted && edit && clientPoint) latest.current.onObjectDoubleClick?.(instanceId, clientPoint)
      return accepted
    }
    if (edit && hit.spot?.kind === 'image') return activate(hit.spot, true, clientPoint)
    return hit.spot ? activate(hit.spot, edit, clientPoint, caretOffset) : false
  }, [activate, findSpot, bridge, replace, selectPaintedObject])
  const nudge = useCallback(async (spot: ComponentAuthorSpot, dx: number, dy: number) => {
    const owner = latest.current
    if (componentIsLocked(owner.runtime.project, spot.instanceId)) { owner.report('当前对象已锁定，不能移动。'); return }
    if (!spot.geometry) { owner.report('当前内部字段没有独立作者位置，不能移动。'); return }
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx === 0 && dy === 0) return
    if (!await activate(spot, false)) return
    try {
      const value = currentSpot(spot), captured = bridge.captureOwnedTarget(owner.documentId)
      const frame = captured.editingProject.instances[spot.instanceId]?.frame
      if (!value?.geometry || !frame) { owner.report('当前字段尚未取得所属自由对象的位置，不能微移。'); return }
      // Keyboard arrows retain the surface/world units used for whole objects.
      const instanceToSurface = frameToSpaceMatrix(frame, componentParentMatrix(captured.editingProject, spot.instanceId))
      const gesture = new AuthorSpotTransformGesture({ spot: value, mode: 'drag', instanceToSurface, surfaceToPointer: IDENTITY_MATRIX, pointer: { x: 0, y: 0 } })
      const { geometry } = gesture.update({ x: dx, y: dy })
      const edits = authorSpotGeometryEdits(captured.editingProject, value, geometry)
      if (edits.length) await bridge.editCaptured(bridge.capture(edits, captured), crypto.randomUUID())
    } catch (error) { owner.report(error instanceof Error ? error.message : String(error)) }
  }, [activate, bridge])
  useEffect(() => {
    const element = root.current
    if (!element || !enabled) return
    const pointer = (event: Event) => {
      const request = (event as CustomEvent<AuthorPointer>).detail
      if (!request || !latest.current.runtime.project.instances[request.instanceId]) return
      event.preventDefault(); event.stopPropagation()
      const host = latest.current.runtime.world.contentElement?.(request.instanceId), matrix = host && flowContentClientMatrix(host)
      const point = matrix && transformPoint(matrix, request.localPoint)
      if (event.type === 'component-author-double-click') {
        cancelAuthorPointer()
        void beginRegisteredSpot(request.instanceId, request.localPoint, request.mountGeneration, request.authorKey, request.caretOffset, true)
        return
      }
      // Old producers have no gesture phases. They can select, never open input
      // or infer a drag from a second unrelated pointer message.
      if (!request.phase) {
        void beginRegisteredSpot(request.instanceId, request.localPoint, request.mountGeneration, request.authorKey).then(accepted => {
          const objectId = latest.current.resolveObjectTarget ? latest.current.resolveObjectTarget(request.instanceId) : request.instanceId
          if (accepted && request.button === 2 && point && objectId) openContextMenu(point, objectId)
        })
        return
      }
      if (request.phase !== 'start') {
        const pending = authorPointer.current
        if (!pending || pending.instanceId !== request.instanceId || pending.pointerId !== (request.pointerId ?? 0)) return
        // Preserve the start address even when crossing a sibling field in the iframe.
        pending.request = { ...request, authorKey: pending.authorKey, mountGeneration: pending.mountGeneration }
        if (request.phase === 'cancel') { cancelAuthorPointer(); return }
        if (!point || pending.released) return
        const next = { ...point, shift: request.shiftKey, alt: request.altKey }
        if (request.phase === 'end') void finishAuthorPointer(pending, next)
        else updateAuthorPointer(pending, next)
        return
      }
      if (!point || request.button !== undefined && request.button !== 0) return
      cancelAuthorPointer()
      const owner = latest.current, initial = bridge.read(), ticket = ++intent.current
      const pending: AuthorDragPointer = { pointerId: request.pointerId ?? 0, instanceId: request.instanceId,
        authorKey: request.authorKey, mountGeneration: request.mountGeneration,
        start: point, latest: { ...point, shift: request.shiftKey, alt: request.altKey }, released: false, cancelled: false, request }
      authorPointer.current = pending
      const objectId = owner.resolveObjectTarget ? owner.resolveObjectTarget(request.instanceId) : request.instanceId
      if (!objectId) { cancelAuthorPointer(); return }
      void (objectId === request.instanceId ? findSpot(request) : Promise.resolve<AuthorHit>({ object: true })).then(async hit => {
        const current = bridge.read()
        if (authorPointer.current !== pending || pending.cancelled || ticket !== intent.current
          || current.activeDocumentId !== owner.documentId || current.snapshot?.epoch !== initial.snapshot?.epoch
          || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
          || current.activeStateId !== initial.activeStateId || current.surfaceId !== owner.surfaceId
          || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return
        if (hit.spot) await prepareAuthorPointer(pending, hit.spot)
        else {
          const accepted = hit.object && (owner.workspaceOwnsObjectSelection && owner.onObjectPointer ? true : await selectPaintedObject(request.instanceId, initial, ticket))
          if (authorPointer.current !== pending || pending.cancelled) return
          if (accepted && latest.current.onObjectPointer) {
            pending.objectStarted = true
            latest.current.onObjectPointer({ ...request, phase: 'start', released: pending.released }, pending.start)
            if (pending.released) await finishAuthorPointer(pending, pending.latest)
            else if (pending.latest.x !== pending.start.x || pending.latest.y !== pending.start.y) updateAuthorPointer(pending, pending.latest)
          } else authorPointer.current = null
        }
      }).catch(error => { if (authorPointer.current === pending) cancelAuthorPointer(); owner.report(error instanceof Error ? error.message : String(error)) })
    }
    const action = (event: Event) => {
      const request = (event as CustomEvent<AuthorFieldActionRequest>).detail, view = bridge.read()
      if (!request || view.activeDocumentId !== documentId || request.documentId !== documentId || request.epoch !== view.snapshot?.epoch
        || request.selectionIdentity !== interactionSelectionIdentity(view.interactionSelection)) return
      const observed = nativeObservation.current
      const nativeSpot = observed && fieldIsCurrent(interactionSelectionIdentity(view.interactionSelection))
        ? observed.read ? observed.read() : observed.spot : undefined
      const recovered = view.interactionSelection?.kind === 'author-field'
        ? nativeSpotAtAddress(view.interactionSelection.instanceId, view.interactionSelection.field.dataPath) : undefined
      const spot = latest.current.runtime.world.authorSpots().find(value => selectionMatchesSpot(view.interactionSelection, value))
        ?? (nativeSpot && selectionMatchesSpot(view.interactionSelection, nativeSpot) ? nativeSpot : undefined)
        ?? (recovered && selectionMatchesSpot(view.interactionSelection, recovered) ? recovered : undefined)
      if (!spot || request.action === 'replace-image' && (!latest.current.selectImage || spot.kind !== 'image')) return
      event.preventDefault()
      if (request.action === 'nudge') { void nudge(spot, request.dx, request.dy); return }
      if (request.action === 'edit' && !useEditorStore.getState().slideContentEdit) setRealmSelection(null)
      void (request.action === 'replace-image' ? replace(spot)
        : observed?.activate && nativeSpot === spot ? beginNative(spot.instanceId, observed.activate) : activate(spot, true))
    }
    const selectText = (event: Event) => {
      const value = (event as CustomEvent<{ instanceId: string; authorKey: string; anchor: number; focus: number; word?: boolean }>).detail
      if (!value || !latest.current.runtime.project.instances[value.instanceId] || typeof value.authorKey !== 'string') return
      setRealmSelection({ instanceId: value.instanceId, authorKey: value.authorKey, value: { anchor: value.anchor, focus: value.focus, word: value.word } })
    }
    element.addEventListener('component-author-pointer', pointer)
    element.addEventListener('component-author-double-click', pointer)
    element.addEventListener('component-author-selection', selectText)
    window.addEventListener(AUTHOR_FIELD_ACTION_EVENT, action)
    return () => {
      element.removeEventListener('component-author-pointer', pointer)
      element.removeEventListener('component-author-double-click', pointer)
      element.removeEventListener('component-author-selection', selectText)
      window.removeEventListener(AUTHOR_FIELD_ACTION_EVENT, action)
    }
  }, [root, enabled, documentId, surfaceId, bridge, beginRegisteredSpot, activate, replace, beginNative, fieldIsCurrent,
    cancelAuthorPointer, findSpot, finishAuthorPointer, nudge, prepareAuthorPointer, selectPaintedObject, updateAuthorPointer])
  const elementField = (event: React.MouseEvent<HTMLElement>, visible?: VisibleComponentAuthorHit) => {
    const owner = latest.current, target = event.target instanceof Element ? event.target : null
    if (!owner.enabled || !target || target.closest('[data-component-professional-editor],.selection-quick-bar,.text-edit-toolbar')) return undefined
    if (target.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true') return undefined
    const id = visible?.instanceId ?? target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
    if (!id || visible?.authorKey === null) return undefined
    const instance = owner.runtime.project.instances[id]
    if (!instance) return undefined
    const implementation = instance.implementationOverride ?? owner.runtime.project.definitions[instance.definitionId]?.implementation
    const key = implementation?.kind === 'builtin' ? implementation.key : undefined
    // These whole native boxes keep the workspace's one object selection/drag
    // and explicit double-click owner, rather than becoming a second field draft.
    if (key && ['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart', 'guoling.image'].includes(key)) return undefined
    const content = owner.runtime.world.contentElement?.(id), matrix = content && flowContentClientMatrix(content)
    if (!matrix) return undefined
    const inverse = invertMatrix(matrix), point = { x: event.clientX, y: event.clientY }, localPoint = transformPoint(inverse, point)
    const slot = target.closest<HTMLElement>('[data-document-path]'), rect = slot && nativeTextClientRect(slot)
    const topLeft = rect && transformPoint(inverse, { x: rect.left, y: rect.top }), bottomRight = rect && transformPoint(inverse, { x: rect.right, y: rect.bottom })
    const native = !visible?.authorKey && topLeft && bottomRight ? nativeTextSpotFromElement(owner.runtime.project, id, target, {
      width: Math.max(1, bottomRight.x - topLeft.x), height: Math.max(1, bottomRight.y - topLeft.y), transform: [1, 0, 0, 1, topLeft.x, topLeft.y],
    }) : undefined
    if (!native && !owner.runtime.world.authorSpots().some(spot => spot.instanceId === id
      && (visible?.authorKey ? spot.authorKey === visible.authorKey : frameContainsPoint(spot.localBounds, localPoint)))) return undefined
    return { owner, id, target, slot, native, point, localPoint }
  }
  const observeNativeElement = (field: NonNullable<ReturnType<typeof elementField>>) => {
    const { owner, id, target, slot, native } = field
    if (!native) return
    const originalPath = slot?.dataset.documentPath, cellId = slot?.closest<HTMLElement>('[data-table-cell-id]')?.dataset.tableCellId
    const currentView = bridge.read()
    nativeObservation.current = { documentId: owner.documentId, epoch: currentView.snapshot?.epoch, contextKey: owner.contextKey,
      rootInstanceId: currentView.rootInstanceId, editingContainerId: currentView.editingContainerId, activeStateId: currentView.activeStateId, spot: native, read: () => {
        if (!target.isConnected || target.closest('[data-document-path]') !== slot || slot?.dataset.documentPath !== originalPath
          || slot?.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance !== id) return undefined
        const current = latest.current.runtime.project
        if (cellId) {
          const value = authorSpotValue(current.instances[id]?.data, native.dataPath!.slice(0, -1))
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.id !== cellId) return undefined
        }
        return nativeTextSpotFromElement(current, id, target, native.localBounds)
      } }
  }
  const pointerFromElement = useCallback((event: AuthorElementPointer, visible?: VisibleComponentAuthorHit): boolean => {
    if (event.cancelled || event.button !== 0 && event.button !== 2) return false
    const field = elementField(event, visible)
    if (!field) return false
    const objectId = field.owner.resolveObjectTarget ? field.owner.resolveObjectTarget(field.id) : field.id
    if (objectId !== field.id) return false
    event.preventDefault(); event.stopPropagation()
    // Right down only reserves the field; the context-menu event selects it.
    if (event.button === 2) return true
    const { owner, id, native, localPoint } = field
    const pointer = newElementPointer(event), initial = bridge.read(), ticket = ++intent.current
    if (native) {
      observeNativeElement(field)
      void prepareAuthorPointer(pointer, native)
    } else void findSpot({ instanceId: id, localPoint, authorKey: visible?.authorKey ?? undefined }).then(async hit => {
      const current = bridge.read()
      if (authorPointer.current !== pointer || pointer.cancelled || ticket !== intent.current
        || current.activeDocumentId !== owner.documentId || current.snapshot?.epoch !== initial.snapshot?.epoch
        || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
        || current.activeStateId !== initial.activeStateId || current.surfaceId !== owner.surfaceId
        || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return
      if (hit.spot) await prepareAuthorPointer(pointer, hit.spot)
      else { if (hit.object) await selectPaintedObject(id, initial, ticket); if (authorPointer.current === pointer) authorPointer.current = null; releasePointer(pointer) }
    }).catch(error => { if (authorPointer.current === pointer) cancelAuthorPointer(); owner.report(error instanceof Error ? error.message : String(error)) })
    return true
  }, [bridge, cancelAuthorPointer, findSpot, prepareAuthorPointer, selectPaintedObject])
  const doubleClickFromElement = useCallback((event: React.MouseEvent<HTMLElement>, visible?: VisibleComponentAuthorHit): boolean => {
    if (event.button !== 0) return false
    const field = elementField(event, visible)
    if (!field) return false
    event.preventDefault(); event.stopPropagation(); cancelAuthorPointer(); setRealmSelection(null)
    const objectId = field.owner.resolveObjectTarget ? field.owner.resolveObjectTarget(field.id) : field.id
    if (!objectId) return true
    if (objectId !== field.id) {
      void beginRegisteredSpot(field.id, field.localPoint, undefined, visible?.authorKey ?? undefined, undefined, true)
      return true
    }
    if (field.native) { observeNativeElement(field); void activate(field.native, true, field.point) }
    else void beginRegisteredSpot(field.id, field.localPoint, undefined, visible?.authorKey ?? undefined, undefined, true)
    return true
  }, [activate, beginRegisteredSpot, cancelAuthorPointer])
  const selectedContent = selectedSpot && runtime.world.contentElement?.(selectedSpot.instanceId)
  const selectedMatrix = selectedContent && flowContentClientMatrix(selectedContent)
  const authorTarget: FreeObjectTarget | null = selectedSpot?.geometry && selectedMatrix ? {
    instanceId: selectedSpot.instanceId, frame: transformPreview?.spotId === selectedSpot.id ? transformPreview.frame : selectedSpot.geometry.frame,
    parentToSurface: multiplyMatrices(selectedMatrix, selectedSpot.geometry.parentToInstance),
    parent: { kind: 'surface', surfaceId: surfaceId ?? selectedSpot.instanceId }, ancestors: [], preserveAspectRatio: selectedSpot.kind === 'image',
    ...(selectedSpot.kind === 'text' ? { resizeMode: 'box' as const } : {}),
  } : null
  const authorBounds = () => {
    if (!selectedSpot) return null
    const content = runtime.world.contentElement?.(selectedSpot.instanceId), matrix = content && flowContentClientMatrix(content)
    if (!matrix) return null
    const points = authorTarget ? frameCorners(authorTarget.frame, authorTarget.parentToSurface)
      : frameCorners(selectedSpot.localBounds).map(point => transformPoint(matrix, point))
    const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y))
    return { left, top, width: Math.max(...points.map(point => point.x)) - left, height: Math.max(...points.map(point => point.y)) - top }
  }
  const openContextMenu = useCallback((point: GeometryPoint, instanceId: string) => {
    const captured = bridge.read(), identity = interactionSelectionIdentity(captured.interactionSelection)
    const field = captured.interactionSelection?.kind === 'author-field'
    setTimeout(() => {
      const current = bridge.read()
      if (!root.current?.isConnected || current.activeDocumentId !== captured.activeDocumentId
        || current.snapshot?.epoch !== captured.snapshot?.epoch || current.rootInstanceId !== captured.rootInstanceId
        || current.editingContainerId !== captured.editingContainerId || current.surfaceId !== captured.surfaceId
        || current.activeStateId !== captured.activeStateId || interactionSelectionIdentity(current.interactionSelection) !== identity) return
      requestObjectContextMenu(root.current.closest('main') ?? root.current, { ...point, itemIds: [instanceId], ...(field ? { selectionIdentity: identity } : {}) })
    }, 0)
  }, [bridge, root])
  const contextMenuFromElement = useCallback((event: React.MouseEvent<HTMLElement>, visible?: VisibleComponentAuthorHit | null): boolean => {
    if (visible === null) return false
    const owner = latest.current, initial = bridge.read(), element = event.target instanceof Element ? event.target : null
    if (!owner.enabled || !element || element.closest('[data-component-professional-editor]')
      || element.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true') return false
    const id = visible?.instanceId ?? element.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
    const host = id && owner.runtime.world.contentElement?.(id), matrix = host && flowContentClientMatrix(host)
    if (!id || !matrix || !owner.runtime.world.authorSpots().some(spot => spot.instanceId === id)) return false
    const objectId = owner.resolveObjectTarget ? owner.resolveObjectTarget(id) : id
    if (!objectId) return false
    const point = { x: event.clientX, y: event.clientY }, localPoint = transformPoint(invertMatrix(matrix), point)
    const ticket = ++intent.current
    event.preventDefault(); event.stopPropagation()
    void (objectId === id ? findSpot({ instanceId: id, localPoint }) : Promise.resolve<AuthorHit>({ object: true })).then(async hit => {
      const view = bridge.read()
      if (ticket !== intent.current || view.activeDocumentId !== owner.documentId || view.snapshot?.epoch !== initial.snapshot?.epoch
        || view.surfaceId !== owner.surfaceId || view.rootInstanceId !== initial.rootInstanceId
        || view.editingContainerId !== initial.editingContainerId || view.activeStateId !== initial.activeStateId
        || interactionSelectionIdentity(view.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return
      const accepted = hit.spot ? await activate(hit.spot, false) : hit.object ? await selectPaintedObject(id, initial, ticket) : false
      if (!accepted) return
      const current = bridge.read()
      if (hit.spot ? selectionMatchesSpot(current.interactionSelection, hit.spot)
        : current.interactionSelection?.kind === 'objects' && current.interactionSelection.instanceIds.length === 1 && current.interactionSelection.instanceIds[0] === objectId)
        openContextMenu(point, objectId)
    }).catch(error => owner.report(error instanceof Error ? error.message : String(error)))
    return true
  }, [activate, bridge, findSpot, openContextMenu, selectPaintedObject])
  const view = bridge.read()
  const ownedDraft = enabled && draft?.source === 'canvas' && draft.target.documentId === documentId && draft.target.epoch === view.snapshot?.epoch
    && draft.target.surfaceId === surfaceId && draft.target.activeStateId === view.activeStateId
    && (wholeInstanceEditor || draft.authorSpot) ? draft : null
  const pendingCaret = fieldCaret.current
  const caretOffset = ownedDraft?.authorSpot && pendingCaret?.documentId === documentId && pendingCaret.epoch === view.snapshot?.epoch
    && pendingCaret.surfaceId === surfaceId && pendingCaret.contextKey === contextKey
    && pendingCaret.rootInstanceId === view.rootInstanceId && pendingCaret.rootInstanceId === ownedDraft.target.rootInstanceId
    && pendingCaret.editingContainerId === view.editingContainerId && pendingCaret.editingContainerId === ownedDraft.target.editingContainerId
    && pendingCaret.activeStateId === view.activeStateId
    && pendingCaret.fieldIdentity === authorFieldIdentity(ownedDraft.instanceId, ownedDraft.authorSpot)
    ? Math.min(pendingCaret.offset, (ownedDraft.spotText ?? '').length) : undefined
  const state = () => useEditorStore.getState()
  const editor = ownedDraft ? <ProfessionalContentEditor project={runtime.project} draft={ownedDraft} floatingToolbar
    selectionIntent={realmSelection?.instanceId === ownedDraft.instanceId && realmSelection.authorKey === ownedDraft.authorSpot?.authorKey ? realmSelection.value : undefined}
    target={() => ownedDraft.authorSpot ? runtime.world.contentElement?.(ownedDraft.instanceId) : runtime.world.targetElement?.(ownedDraft.instanceId)}
    update={(...args) => state().updateSlideDataDraft(...args)} updateSpot={(...args) => state().updateSlideSpotDraft(...args)}
    commit={() => state().commitSlideContentEdit()} commitInput={() => state().commitSlideContentInput()}
    cancel={() => state().cancelTextEdit()} preserve={() => state().retainTextEdit()} undo={async () => { await state().undo() }} redo={async () => { await state().redo() }} report={report} clientPoint={caret.current} caretOffset={caretOffset} /> : null
  return { selectedSpot, authorBounds, authorTarget, activate, replace, beginNative, beginTransform, fieldIsCurrent, selectNativeField,
    beginRegisteredSpot, pointerFromElement, doubleClickFromElement, contextMenuFromElement, openContextMenu, editor }
}
