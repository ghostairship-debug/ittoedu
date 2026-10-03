import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { locateCourseLayer } from '../../core/drivers/course/layerProperties'
import { readTarget } from '../../core/tools/ToolTargets'
import { findCompositionNode } from '../../shared/composition/content'
import type { DocumentSnapshot } from '../../shared/workbench/document'
import type { CompositionAuthoringSelection } from '../composition/WebCompositionAuthoringContent'
import { QuickBarLabel, QuickBarSeparator, SelectionQuickBar } from '../editing/quickbar/SelectionQuickBar'
import { visibleBounds, type QuickBarBounds, type QuickBarRect } from '../editing/quickbar/placeQuickBar'
import { ElementAiButton } from './elementCards/ElementAiCard'
import { captureCompositionSelection, workbenchSelection, type SelectionCapture } from './SelectionContextController'

export interface CompositionSelectionContextProps {
  documentId: string | null
  revision: number
  locationId: string | null
  stateId?: string | null
  selection: CompositionAuthoringSelection | null
  canvasRoot: HTMLElement | null
  enabled?: boolean
  /** Restore the existing canvas selection after navigation to a running element card. */
  onRestoreSelection?(selection: CompositionAuthoringSelection): void
}

function selectionLabel(snapshot: DocumentSnapshot, selected: CompositionAuthoringSelection): string {
  if (snapshot.model.kind !== 'course-v9') return '所选内容'
  const item = locateCourseLayer(snapshot.model.project, selected.layerItemId)?.item
  if (item?.kind !== 'composition') return '所选内容'
  const node = findCompositionNode(item.content.root, selected.nodeId)
  if (node?.kind === 'text') return '所选文字'
  if (node?.kind === 'native') return node.content.nativeType === 'image' ? '所选图片' : '所选原生内容'
  if (node?.kind === 'document') return '所选正文'
  if (node?.kind === 'runtime') return '所选互动区域'
  if (node?.kind === 'element') {
    if (node.tagName.toLowerCase() === 'img') return '所选图片'
    if (node.children.some(child => child.kind === 'text' && child.text.trim())) return '所选文字'
  }
  return '所选内容'
}

/** The same element card as Native content, anchored at the selected composition node's real viewport. */
export function CompositionSelectionContext({ documentId, revision, locationId, stateId, selection,
  canvasRoot, enabled = true, onRestoreSelection }: CompositionSelectionContextProps) {
  const [captured, setCaptured] = useState<SelectionCapture | null>(null)
  const [disabledReason, setDisabledReason] = useState<string | null>(null)
  const [geometry, setGeometry] = useState<{ anchor: QuickBarRect; bounds: QuickBarBounds } | null>(null)
  const published = useRef<SelectionCapture | null>(null)
  useSyncExternalStore(workbenchSelection.subscribe, workbenchSelection.readVersion)
  const manual = documentId ? workbenchSelection.getManual(documentId) : null
  const layerItemId = selection?.layerItemId, nodeId = selection?.nodeId

  useLayoutEffect(() => {
    if (!enabled || !canvasRoot || !onRestoreSelection || manual?.targets.length !== 1) return
    const target = manual.targets[0]!
    if (target.kind !== 'course-object' || !target.compositionNodeId || target.locationId !== locationId
      || target.stateId && target.stateId !== stateId
      || target.itemId === layerItemId && target.compositionNodeId === nodeId
      || published.current && JSON.stringify(published.current.targets) === JSON.stringify(manual.targets)
        && published.current.epoch === manual.epoch && published.current.revision === manual.revision) return
    let active = true, restored = false, nextFrame = 0
    const restore = () => {
      if (!active || restored || workbenchSelection.getManual(manual.documentId) !== manual) return
      const frame = [...canvasRoot.querySelectorAll<HTMLIFrameElement>('iframe[data-web-composition]')]
        .find(value => value.dataset.webComposition === target.itemId)
      const element = frame?.contentDocument && [...frame.contentDocument.querySelectorAll<HTMLElement>('[data-composition-node]')]
        .find(value => value.dataset.compositionNode === target.compositionNodeId)
      if (!element) return
      const rect = element.getBoundingClientRect()
      restored = true
      onRestoreSelection({ layerItemId: target.itemId, nodeId: target.compositionNodeId!,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
    }
    const loaded = () => { cancelAnimationFrame(nextFrame); nextFrame = requestAnimationFrame(restore) }
    restore()
    canvasRoot.addEventListener('load', loaded, true)
    const observer = new MutationObserver(restore)
    observer.observe(canvasRoot, { childList: true, subtree: true })
    return () => { active = false; observer.disconnect(); cancelAnimationFrame(nextFrame); canvasRoot.removeEventListener('load', loaded, true) }
  }, [enabled, canvasRoot, onRestoreSelection, manual, locationId, stateId, layerItemId, nodeId])

  useEffect(() => {
    if (!documentId || !locationId || !layerItemId || !nodeId || !enabled) {
      setCaptured(null)
      return
    }
    let active = true
    void workbenchSelection.observe(documentId, revision, snapshot => {
      const capture = captureCompositionSelection(snapshot, locationId, layerItemId, nodeId, stateId,
        selectionLabel(snapshot, { layerItemId, nodeId, bounds: selection!.bounds }))
      const current = readTarget(snapshot.model, capture.targets[0]!) as { locked?: boolean }
      published.current = capture
      setCaptured(capture)
      setDisabledReason(current.locked ? '所选内容已锁定，请先解锁。' : null)
      return capture
    }, () => active)
    return () => {
      active = false
      published.current = null
      const current = workbenchSelection.getManual(documentId)
      if (current?.targets.length === 1) {
        const target = current.targets[0]!
        if (target.kind === 'course-object' && target.locationId === locationId && target.itemId === layerItemId
          && target.compositionNodeId === nodeId) workbenchSelection.setManual(documentId, null)
      }
    }
  }, [documentId, revision, locationId, stateId, layerItemId, nodeId, enabled])

  useLayoutEffect(() => {
    if (!canvasRoot || !selection || !enabled) { setGeometry(null); return }
    const frame = [...canvasRoot.querySelectorAll<HTMLIFrameElement>('iframe[data-web-composition]')]
      .find(value => value.dataset.webComposition === selection.layerItemId)
    if (!frame) { setGeometry(null); return }
    const doc = frame.contentDocument
    const element = doc && [...doc.querySelectorAll<HTMLElement>('[data-composition-node]')]
      .find(value => value.dataset.compositionNode === selection.nodeId)
    const paint = () => {
      const viewport = frame.getBoundingClientRect()
      if (!frame.clientWidth || !frame.clientHeight || !viewport.width || !viewport.height) { setGeometry(null); return }
      const local = element?.getBoundingClientRect() ?? selection.bounds
      const x = 'x' in local ? local.x : 0, y = 'y' in local ? local.y : 0
      const scaleX = viewport.width / frame.clientWidth, scaleY = viewport.height / frame.clientHeight
      const next = { anchor: { left: viewport.left + x * scaleX, top: viewport.top + y * scaleY,
        width: local.width * scaleX, height: local.height * scaleY }, bounds: visibleBounds(canvasRoot) }
      setGeometry(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    paint()
    window.addEventListener('resize', paint); window.addEventListener('scroll', paint, true)
    doc?.addEventListener('scroll', paint, true)
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(paint)
    resized?.observe(canvasRoot); resized?.observe(frame); if (element) resized?.observe(element)
    const changed = new MutationObserver(paint)
    changed.observe(canvasRoot, { attributes: true, childList: true, subtree: true })
    if (doc?.documentElement) changed.observe(doc.documentElement, { attributes: true, childList: true, subtree: true, characterData: true })
    return () => {
      resized?.disconnect(); changed.disconnect()
      window.removeEventListener('resize', paint); window.removeEventListener('scroll', paint, true)
      doc?.removeEventListener('scroll', paint, true)
    }
  }, [canvasRoot, selection, revision, enabled])

  const target = captured?.targets[0]
  if (!enabled || !documentId || !locationId || !selection || !captured || target?.kind !== 'course-object'
    || target.itemId !== selection.layerItemId || target.compositionNodeId !== selection.nodeId
    || target.locationId !== locationId) return null
  const capture = async () => captureCompositionSelection(await workbenchSelection.prepare(documentId), locationId,
    selection.layerItemId, selection.nodeId, stateId, captured.label)
  return <SelectionQuickBar label="选中内容快捷工具" anchor={geometry?.anchor ?? null} bounds={geometry?.bounds ?? null}
    selectionKey={`${documentId}:${locationId}:${stateId ?? ''}:${selection.layerItemId}:${selection.nodeId}`}>
    <QuickBarLabel>{captured.label}</QuickBarLabel><QuickBarSeparator />
    <ElementAiButton documentId={documentId} target={target} label={captured.label} capture={capture} disabledReason={disabledReason} />
  </SelectionQuickBar>
}
