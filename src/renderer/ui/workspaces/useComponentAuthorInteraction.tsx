import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { ComponentAuthorSpot } from '../../../shared/contracts/component-platform/runtime'
import { componentIsLocked } from '../../../shared/contracts/component-platform/project'
import { frameContainsPoint, frameCorners, invertMatrix, transformPoint, type GeometryPoint } from '../../../core/components/geometry'
import { useCourseV10Runtime } from '../../components/CourseV10RuntimeView'
import { requestComponentAuthorHit, visibleComponentAuthorHit, type VisibleComponentAuthorHit } from '../../components/componentAuthorHit'
import { authorSpotEdits, authorSpotImageEdits } from '../../componentPlatform/surfaces/slide/authorSpots'
import { authorFieldIdentity, interactionSelectionIdentity, selectionMatchesSpot } from '../../documents/interactionSelection'
import { useEditorStore } from '../../store/editorStore'
import type { ImportedImageAsset } from '../../project/assetManager'
import { flowContentClientMatrix } from '../flow/flowParagraphLayout'
import { ProfessionalContentEditor } from './ProfessionalContentEditor'
import { AUTHOR_FIELD_ACTION_EVENT, requestObjectContextMenu, type AuthorFieldActionRequest } from '../../editing/commands/objectContextMenu'
import { nativeTextSpotFromElement } from '../../authoring/professionalContentFields'
import { authorSpotValue } from '../../../core/components/authoring/componentAuthorEdits'
import type { PlainTextSelectionIntent } from '../CanvasPlainTextEditor'

interface AuthorPointer { instanceId: string; mountGeneration?: number; localPoint: GeometryPoint; authorKey?: string; caretOffset?: number }
interface NativeFieldObservation { rootInstanceId?: string | null; editingContainerId?: string | null; activeStateId: string | null; contextKey?: string; documentId: string; epoch: string | undefined; spot: ComponentAuthorSpot; activate?: () => boolean; read?: () => ComponentAuthorSpot | undefined }
interface FieldCaretIntent { documentId: string; epoch?: string; surfaceId: string | null; rootInstanceId?: string | null; editingContainerId?: string | null; activeStateId: string | null; contextKey?: string; fieldIdentity: string; offset: number }
interface AuthorHit { spot?: ComponentAuthorSpot; object: boolean }

/** The same registered author field enters the same input owner on every workspace. */
export function useComponentAuthorInteraction({ root, documentId, surfaceId, enabled, selectImage, report, wholeInstanceEditor = true, contextKey }: {
  root: RefObject<HTMLElement | null>; documentId: string; surfaceId: string | null; enabled: boolean
  selectImage?(): Promise<ImportedImageAsset | null>; report(message: string): void
  /** A workspace with the native table/chart owner renders whole-instance drafts there. */
  wholeInstanceEditor?: boolean
  contextKey?: string
}) {
  const runtime = useCourseV10Runtime()
  const bridge = useEditorStore(state => state.courseBridge)
  const selection = useEditorStore(state => state.courseView.interactionSelection)
  const draft = useEditorStore(state => state.slideContentEdit)
  const [spots, setSpots] = useState<readonly ComponentAuthorSpot[]>(() => runtime.world.authorSpots())
  const latest = useRef({ runtime, documentId, surfaceId, enabled, selectImage, report, contextKey })
  latest.current = { runtime, documentId, surfaceId, enabled, selectImage, report, contextKey }
  const intent = useRef(0)
  const caret = useRef<GeometryPoint | undefined>(undefined)
  const fieldCaret = useRef<FieldCaretIntent | undefined>(undefined)
  const [realmSelection, setRealmSelection] = useState<{ instanceId: string; authorKey: string; value: PlainTextSelectionIntent } | null>(null)
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
        if (componentIsLocked(current.runtime.project, spot.instanceId)) continue
        const element = current.runtime.world.contentElement?.(spot.instanceId), matrix = element && flowContentClientMatrix(element)
        if (!element || !owner.contains(element) || !matrix) continue
        const points = frameCorners(spot.localBounds).map(point => transformPoint(matrix, point)), xs = points.map(point => point.x), ys = points.map(point => point.y)
        const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top
        if (width <= 0 || height <= 0 || left >= outer.right || top >= outer.bottom || left + width <= outer.left || top + height <= outer.top) continue
        shown.add(spot.id)
        let mark = marks.get(spot.id)
        if (!mark) { mark = owner.ownerDocument.createElement('div'); mark.className = 'author-field-affordance'; layer.append(mark); marks.set(spot.id, mark) }
        const active = hovered?.instanceId === spot.instanceId && hovered.authorKey === spot.authorKey
        mark.dataset.hovered = String(active); mark.dataset.authorAffordance = spot.kind
        Object.assign(mark.style, { left: `${left - outer.left}px`, top: `${top - outer.top}px`, width: `${width}px`, height: `${height}px` })
        mark.textContent = active ? spot.kind === 'text' ? '文字 · 点此编辑' : '图片 · 点此选中' : ''
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
  }, [enabled, root, runtime.world, documentId, surfaceId, contextKey])
  const native = nativeObservation.current
  const nativeView = bridge.read()
  const nativeSpot = native?.documentId === documentId && native.epoch === nativeView.snapshot?.epoch && native.contextKey === contextKey
    && native.rootInstanceId === nativeView.rootInstanceId && native.editingContainerId === nativeView.editingContainerId
    && native.activeStateId === nativeView.activeStateId
    ? native.read ? native.read() : native.spot : undefined
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
    if (!observed || observed.documentId !== latest.current.documentId || observed.epoch !== bridge.read().snapshot?.epoch || authorFieldIdentity(observed.spot.instanceId, observed.spot) !== authorFieldIdentity(spot.instanceId, spot)) return undefined
    const value = observed.read ? observed.read() : observed.spot
    return value && authorFieldIdentity(value.instanceId, value) === authorFieldIdentity(spot.instanceId, spot) ? value : undefined
  }
  const activate = useCallback(async (candidate: ComponentAuthorSpot, edit: boolean, point?: GeometryPoint, caretOffset?: number): Promise<boolean> => {
    const owner = latest.current, initial = bridge.read()
    if (!owner.enabled || initial.activeDocumentId !== owner.documentId || componentIsLocked(owner.runtime.project, candidate.instanceId)) return false
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
        if (previous.authorSpot && previous.target.documentId === owner.documentId && previous.target.epoch === epoch
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
  const selectPaintedObject = useCallback(async (instanceId: string, initial: ReturnType<typeof bridge.read>, ticket: number) => {
    const owner = latest.current
    await useEditorStore.getState().commitSlideContentEdit()
    const current = bridge.read()
    if (ticket !== intent.current || !latest.current.enabled || latest.current.contextKey !== owner.contextKey || current.activeDocumentId !== owner.documentId
      || current.snapshot?.epoch !== initial.snapshot?.epoch || current.surfaceId !== owner.surfaceId
      || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
      || current.activeStateId !== initial.activeStateId
      || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return false
    bridge.selectInstances(owner.documentId, [instanceId], owner.surfaceId)
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
  const beginRegisteredSpot = useCallback(async (instanceId: string, localPoint: GeometryPoint, generation?: number, authorKey?: string, caretOffset?: number) => {
    const owner = latest.current, initial = bridge.read(), ticket = ++intent.current
    const host = owner.runtime.world.contentElement?.(instanceId), matrix = host && flowContentClientMatrix(host)
    const clientPoint = matrix ? transformPoint(matrix, localPoint) : undefined
    const hit = await findSpot({ instanceId, localPoint, mountGeneration: generation, authorKey })
    const current = bridge.read()
    if (ticket !== intent.current || !latest.current.enabled || latest.current.contextKey !== owner.contextKey || current.activeDocumentId !== owner.documentId
      || current.snapshot?.epoch !== initial.snapshot?.epoch || current.surfaceId !== owner.surfaceId
      || current.rootInstanceId !== initial.rootInstanceId || current.editingContainerId !== initial.editingContainerId
      || current.activeStateId !== initial.activeStateId
      || interactionSelectionIdentity(current.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return true
    return hit.spot ? activate(hit.spot, hit.spot.kind === 'text', clientPoint, caretOffset)
      : hit.object ? selectPaintedObject(instanceId, initial, ticket) : false
  }, [activate, findSpot, bridge, selectPaintedObject])
  const replace = useCallback(async (spot: ComponentAuthorSpot) => {
    const owner = latest.current
    if (!owner.selectImage || !await activate(spot, false)) return false
    const captured = bridge.captureOwnedTarget(owner.documentId)
    try {
      authorSpotEdits(captured.editingProject, spot, spot.initialValue, captured.resources)
      const imported = await owner.selectImage()
      if (!imported) return true
      await bridge.editCaptured(bridge.capture(authorSpotImageEdits(captured.editingProject, spot, imported, captured.resources), captured))
      return true
    } catch (error) { owner.report(error instanceof Error ? error.message : String(error)); return false }
  }, [activate, bridge])
  useEffect(() => {
    const element = root.current
    if (!element || !enabled) return
    const pointer = (event: Event) => {
      const request = (event as CustomEvent<AuthorPointer>).detail
      if (!request || !latest.current.runtime.project.instances[request.instanceId]) return
      event.preventDefault(); event.stopPropagation()
      void beginRegisteredSpot(request.instanceId, request.localPoint, request.mountGeneration, request.authorKey, request.caretOffset)
    }
    const action = (event: Event) => {
      const request = (event as CustomEvent<AuthorFieldActionRequest>).detail, view = bridge.read()
      if (!request || view.activeDocumentId !== documentId || request.documentId !== documentId || request.epoch !== view.snapshot?.epoch
        || request.selectionIdentity !== interactionSelectionIdentity(view.interactionSelection)) return
      const observed = nativeObservation.current
      const nativeSpot = observed && fieldIsCurrent(interactionSelectionIdentity(view.interactionSelection))
        ? observed.read ? observed.read() : observed.spot : undefined
      const spot = latest.current.runtime.world.authorSpots().find(value => selectionMatchesSpot(view.interactionSelection, value))
        ?? (nativeSpot && selectionMatchesSpot(view.interactionSelection, nativeSpot) ? nativeSpot : undefined)
      if (!spot || request.action === 'replace-image' && (!latest.current.selectImage || spot.kind !== 'image')) return
      event.preventDefault()
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
  }, [root, enabled, documentId, surfaceId, bridge, beginRegisteredSpot, activate, replace, beginNative, fieldIsCurrent])
  const pointerFromElement = useCallback((event: React.PointerEvent<HTMLElement>, visible?: VisibleComponentAuthorHit): boolean => {
    const owner = latest.current, target = event.target instanceof Element ? event.target : null
    if (owner.enabled && event.button === 0) ++intent.current
    if (!owner.enabled || (event.button !== 0 && event.button !== 2) || !target || target.closest('[data-component-professional-editor],.selection-quick-bar,.text-edit-toolbar,input,textarea')) return false
    if (target.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true') return false
    const id = visible?.instanceId ?? target.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
    if (!id) return false
    const content = owner.runtime.world.contentElement?.(id), matrix = content && flowContentClientMatrix(content)
    if (!matrix) return false
    const inverse = invertMatrix(matrix), localPoint = transformPoint(inverse, { x: event.clientX, y: event.clientY })
    if (visible?.authorKey) {
      event.preventDefault(); event.stopPropagation()
      if (event.button === 0) void beginRegisteredSpot(id, localPoint, undefined, visible.authorKey)
      return true
    }
    const slot = target.closest<HTMLElement>('[data-document-path]'), rect = slot?.getBoundingClientRect()
    const topLeft = rect && transformPoint(inverse, { x: rect.left, y: rect.top }), bottomRight = rect && transformPoint(inverse, { x: rect.right, y: rect.bottom })
    const native = topLeft && bottomRight ? nativeTextSpotFromElement(owner.runtime.project, id, target, {
      width: Math.max(1, bottomRight.x - topLeft.x), height: Math.max(1, bottomRight.y - topLeft.y),
      transform: [1, 0, 0, 1, topLeft.x, topLeft.y],
    }) : undefined
    if (!native && !owner.runtime.world.authorSpots().some(spot => spot.instanceId === id && frameContainsPoint(spot.localBounds, localPoint))) return false
    event.preventDefault(); event.stopPropagation()
    if (event.button === 2) return true
    caret.current = { x: event.clientX, y: event.clientY }
    if (native) {
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
      void activate(native, true, caret.current)
    }
    else void beginRegisteredSpot(id, localPoint)
    return true
  }, [beginRegisteredSpot, activate, bridge])
  const authorBounds = () => {
    if (!selectedSpot) return null
    const content = runtime.world.contentElement?.(selectedSpot.instanceId), matrix = content && flowContentClientMatrix(content)
    if (!matrix) return null
    const points = frameCorners(selectedSpot.localBounds).map(point => transformPoint(matrix, point))
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
    if (!owner.enabled || !element || element.closest('[data-component-professional-editor],input,textarea')
      || element.closest('[contenteditable]')?.getAttribute('contenteditable') === 'true') return false
    const id = visible?.instanceId ?? element.closest<HTMLElement>('[data-component-instance]')?.dataset.componentInstance
    const host = id && owner.runtime.world.contentElement?.(id), matrix = host && flowContentClientMatrix(host)
    if (!id || !matrix || !owner.runtime.world.authorSpots().some(spot => spot.instanceId === id)) return false
    const point = { x: event.clientX, y: event.clientY }, localPoint = transformPoint(invertMatrix(matrix), point)
    const ticket = ++intent.current
    event.preventDefault(); event.stopPropagation()
    void findSpot({ instanceId: id, localPoint }).then(async hit => {
      const view = bridge.read()
      if (ticket !== intent.current || view.activeDocumentId !== owner.documentId || view.snapshot?.epoch !== initial.snapshot?.epoch
        || view.surfaceId !== owner.surfaceId || view.rootInstanceId !== initial.rootInstanceId
        || view.editingContainerId !== initial.editingContainerId || view.activeStateId !== initial.activeStateId
        || interactionSelectionIdentity(view.interactionSelection) !== interactionSelectionIdentity(initial.interactionSelection)) return
      const accepted = hit.spot ? await activate(hit.spot, false) : hit.object ? await selectPaintedObject(id, initial, ticket) : false
      if (!accepted) return
      const current = bridge.read()
      if (hit.spot ? selectionMatchesSpot(current.interactionSelection, hit.spot)
        : current.interactionSelection?.kind === 'objects' && current.interactionSelection.instanceIds.length === 1 && current.interactionSelection.instanceIds[0] === id)
        openContextMenu(point, id)
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
  const editor = ownedDraft ? <ProfessionalContentEditor project={runtime.project} draft={ownedDraft}
    selectionIntent={realmSelection?.instanceId === ownedDraft.instanceId && realmSelection.authorKey === ownedDraft.authorSpot?.authorKey ? realmSelection.value : undefined}
    target={() => ownedDraft.authorSpot ? runtime.world.contentElement?.(ownedDraft.instanceId) : runtime.world.targetElement?.(ownedDraft.instanceId)}
    update={(...args) => state().updateSlideDataDraft(...args)} updateSpot={(...args) => state().updateSlideSpotDraft(...args)}
    commit={() => state().commitSlideContentEdit()} commitInput={() => state().commitSlideContentInput()}
    cancel={() => state().cancelTextEdit()} undo={async () => { await state().undo() }} redo={async () => { await state().redo() }} report={report} clientPoint={caret.current} caretOffset={caretOffset} /> : null
  return { selectedSpot, authorBounds, activate, replace, beginNative, fieldIsCurrent, selectNativeField, beginRegisteredSpot, pointerFromElement, contextMenuFromElement, openContextMenu, editor }
}
