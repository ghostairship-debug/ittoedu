import { constrainControllerDisplayFrame, controllerDisplayFrame, useControllerDisplayRevision } from '../../authoring/controllerDisplayBounds'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { requestObjectContextMenu } from '../../editing/commands/objectContextMenu'
import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_NODE_SIZE } from '../../../shared/constants'
import { createFlowViewportGeometry, flowViewportOverlayFrameAt, flowViewportOverlayPoint, projectFlowComponentControllerFrame, revealFlowSelectionPan, type FlowPoint } from '../../../shared/flowViewportGeometry'
import { flowParagraphAnchorAt, flowParagraphAnchoredFrame, type FlowParagraphBlockRect } from '../../../shared/flowParagraphAnchors'
import { DEFAULT_SLIDE_CANVAS } from '../../../shared/slideCanvas'
import { playbackControllerInsets, type PlaybackChromeInsets } from '../../../shared/playbackViewGeometry'
import { rotatedWorldRectAxisBounds } from '../../authoring/stageViewportTransform'
import type { LayerItem } from '../../../shared/courseProjectTypes'
import type { RuntimeAuthoringTargetUpdate } from '../../../shared/runtimeTypes'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import {
  captureFlowEditorAuthoringTarget,
  type DeepReadonly,
  type FlowEditorLayerView,
  type FlowEditorView,
} from '../../course/flowEditorView'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import type { FlowCurrentSessionCommandPort } from './useFlowTextAuthoringController'
import { isTeacherControllerLayerItem } from '../../../core/tools/globalLayers'
import { controllerGeometryItem } from '../../../player/teacherControllerComponentGeometry'
import {
  resizeWorldFrameFromHandle,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  type StageRect,
  type StageResizeHandleDirection,
} from '../../authoring/stageViewportTransform'
import { TeacherControllerAuthoringChrome } from '../TeacherControllerAuthoringChrome'
import { PublishedNativeContent } from '../PublishedNativeContent'
import { FlowPageRuntime } from './FlowPageRuntime'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../../player/surfaces/publishedComponentMount'

const FLOW_OVERLAY_HANDLE_RADIUS = 10
const FLOW_RUNTIME_DRAG_EDGE = 6

function isFlowPageRuntimeLayer(layer: FlowEditorLayerView): layer is FlowEditorLayerView & { item: DeepReadonly<Extract<LayerItem, { kind: 'runtime' }>> } {
  return layer.owner === 'surface' && layer.item.paperSpace === 'paper'
    && Boolean(layer.paragraphAnchor) && layer.effectiveVisible
    && layer.item.kind === 'runtime' && layer.item.runtime.enabled
    && layer.item.runtime.protocol === 'surface-runtime'
    && layer.item.runtime.runtimeApiVersion === 3
    && layer.item.runtime.renderMode === 'dom'
}

function persistedRuntimeGestureFrame(layer: FlowEditorLayerView, start: StageRect, next: StageRect): StageRect {
  if (!isFlowPageRuntimeLayer(layer)) return next
  // The visible Runtime may be much taller than its stored frame. Movement must
  // not commit observed content height; an explicit resize commits only its delta.
  return {
    ...next,
    width: Math.max(MIN_NODE_SIZE, layer.item.frame.width + next.width - start.width),
    height: Math.max(MIN_NODE_SIZE, layer.item.frame.height + next.height - start.height),
  }
}

function runtimeDragEdges(): ReactNode {
  return (['top', 'right', 'bottom', 'left'] as const).map(edge => (
    <div key={edge} data-runtime-drag-edge={edge} style={{
      position: 'absolute', pointerEvents: 'auto', cursor: 'move',
      ...(edge === 'top' || edge === 'bottom'
        ? { left: 0, right: 0, height: FLOW_RUNTIME_DRAG_EDGE, [edge]: 0 }
        : { top: 0, bottom: 0, width: FLOW_RUNTIME_DRAG_EDGE, [edge]: 0 }),
    }} />
  ))
}

export function resolveFlowOverlayAuthoredFrame(layer: FlowEditorLayerView, paperWidth: number, paragraphRects: readonly FlowParagraphBlockRect[], visibleAncestorIds: readonly string[] = []): StageRect {
  const frame = layer.item.frame
  if (layer.owner !== 'surface' || layer.item.paperSpace !== 'paper' || !layer.paragraphAnchor) return frame
  return flowParagraphAnchoredFrame(layer.paragraphAnchor, frame, paperWidth, paragraphRects, visibleAncestorIds) ?? frame
}

/** `null` means an anchored gesture has no reliable layout and must not commit. */
export function flowOverlayAnchorAfterDrag(layer: FlowEditorLayerView, frame: StageRect, paperWidth: number, paragraphRects: readonly FlowParagraphBlockRect[]) {
  return layer.owner === 'surface' && layer.item.paperSpace === 'paper' && layer.paragraphAnchor
    ? flowParagraphAnchorAt(frame, paperWidth, paragraphRects) : undefined
}

export function canChangeFlowOverlayPlacement(layer: FlowEditorLayerView): boolean {
  return layer.owner === 'surface' && layer.item.paperSpace === 'paper'
    && layer.item.kind !== 'runtime' && !isTeacherControllerLayerItem(layer.item)
}

function overlayCardStyle(
  layer: FlowEditorLayerView,
  preview: StageRect | null | undefined,
  resolved: StageRect,
  paperScrollTop: number,
  paperOrigin: FlowPoint,
  paperScrollLeft: number,
  viewPan: FlowPoint,
  viewportSize: { width: number; height: number; nativeChrome?: PlaybackChromeInsets },
  display = false,
  canvas: { width: number; height: number } = DEFAULT_SLIDE_CANVAS,
): CSSProperties {
  const raw = preview ?? resolved
  const authored = constrainFlowControllerOverlayFrame(layer, raw, viewportSize)
  const frame = display ? controllerDisplayFrame(layer.item as LayerItem, authored) : authored
  const isController = isTeacherControllerLayerItem(layer.item)
  const isPaper = !isController && layer.item.paperSpace === 'paper'
  const geometry = createFlowViewportGeometry({
    viewportClientRect: { x: 0, y: 0, width: 1, height: 1 },
    layoutViewportSize: { width: 1, height: 1 },
    paperOriginLayout: paperOrigin,
    paperScrollLayout: { x: paperScrollLeft, y: paperScrollTop },
    playbackPanClient: viewPan,
  })
  const point = isController ? frame : isPaper ? geometry.paperToClient(frame) : geometry.viewportToClient(flowViewportOverlayPoint(frame, canvas, viewportSize))
  return {
    position: 'absolute',
    left: point.x,
    top: point.y,
    width: frame.width,
    height: frame.height,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    zIndex: layer.stackOrder,
    transform: `rotate(${layer.item.rotation}deg)`,
  }
}

/** Screen-anchored overlays scale their position with the view (M19); paper overlays and the controller do not. */
function isViewportOverlay(layer: FlowEditorLayerView | undefined): boolean {
  return Boolean(layer) && !isTeacherControllerLayerItem(layer!.item) && layer!.item.paperSpace !== 'paper'
}

function constrainFlowControllerOverlayFrame(
  layer: FlowEditorLayerView | undefined,
  frame: StageRect,
  viewportSize: { width: number; height: number; nativeChrome?: PlaybackChromeInsets },
): StageRect {
  if (!layer || !isTeacherControllerLayerItem(layer.item)) return frame
  if (layer.item.kind === 'component') {
    const insets = playbackControllerInsets(viewportSize.nativeChrome ?? { right: 0, bottom: 0 })
    const projected = projectFlowComponentControllerFrame(frame, viewportSize, insets)
    return constrainControllerDisplayFrame(layer.item as LayerItem,
      { ...projected, x: frame.x, y: frame.y },
      { width: viewportSize.width - insets.right, height: viewportSize.height - insets.bottom })
  }
  return frame
}

function overlayMediaFillStyle(): CSSProperties {
  return {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    pointerEvents: 'none',
  }
}

function FlowOverlayComponentContent({
  projectId,
  layer,
  componentPackages,
  assetUrls,
}: {
  projectId: string
  layer: FlowEditorLayerView
  componentPackages?: Record<string, ComponentPackageData>
  assetUrls: Record<string, string>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const item = layer.item as LayerItem
  if (item.kind !== 'component') return null
  const pkg = findComponentPackageSource(componentPackages, item.component.packageId, item.component.version)
  const fallbackUrl = item.staticFallbackAssetId ? assetUrls[item.staticFallbackAssetId] : undefined

  useEffect(() => {
    const el = containerRef.current
    if (!el || !pkg) return
    const handle = mountPublishedComponent(el, {
      projectId,
      container: el,
      componentId: item.component.packageId,
      version: item.component.version,
      instanceId: layer.selectionId,
      width: item.frame.width,
      height: item.frame.height,
      props: item.props,
      staticFallbackAssetId: item.staticFallbackAssetId,
      components: componentPackages,
      resolveAsset: (id) => assetUrls[id],
      mode: 'edit',
      interactive: false,
    })
    return () => handle.destroy()
  }, [item.component.packageId, item.component.version, layer.selectionId, item.frame.width, item.frame.height, item.props, item.staticFallbackAssetId, componentPackages, assetUrls, pkg, projectId])

  if (!pkg) {
    if (fallbackUrl) {
      return (
        <img
          src={fallbackUrl}
          data-flow-overlay-media="image"
          data-flow-asset-id={item.staticFallbackAssetId}
          alt={`${item.component.packageId} 后备`}
          style={overlayMediaFillStyle()}
        />
      )
    }
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(23, 32, 51, 0.88)',
          color: '#f8fafc',
          padding: 8,
          textAlign: 'center',
          fontSize: 12,
        }}
      >
        <strong>{item.component.packageId}</strong>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>v{item.component.version}</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    />
  )
}

function renderFlowOverlayCardContent(
  projectId: string,
  layer: FlowEditorLayerView,
  assetUrls: Record<string, string>,
  componentPackages?: Record<string, ComponentPackageData>,
): ReactNode {
  if (layer.item.kind === 'component') {
    return (
      <FlowOverlayComponentContent
        projectId={projectId}
        layer={layer}
        componentPackages={componentPackages}
        assetUrls={assetUrls}
      />
    )
  }
  if (layer.item.kind === 'native') {
    return <PublishedNativeContent item={layer.item as Extract<LayerItem, { kind: 'native' }>} assetUrls={assetUrls} />
  }
  return layer.item.label || '浮层'
}
function overlayLocalPoint(
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
  viewportSize: { width: number; height: number },
): { x: number; y: number } {
  const bounds = overlay.getBoundingClientRect()
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  return {
    x: (clientX - bounds.left) * (viewportSize.width / width),
    y: (clientY - bounds.top) * (viewportSize.height / height),
  }
}

function overlayHandlePoint(
  frame: StageRect,
  direction: StageResizeHandleDirection,
): { x: number; y: number } {
  const left = frame.x
  const top = frame.y
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  const midX = frame.x + frame.width / 2
  const midY = frame.y + frame.height / 2
  if (direction === 'nw') return { x: left, y: top }
  if (direction === 'n') return { x: midX, y: top }
  if (direction === 'ne') return { x: right, y: top }
  if (direction === 'e') return { x: right, y: midY }
  if (direction === 'se') return { x: right, y: bottom }
  if (direction === 's') return { x: midX, y: bottom }
  if (direction === 'sw') return { x: left, y: bottom }
  return { x: left, y: midY }
}

function hitFlowOverlayResizeHandle(
  frame: StageRect,
  local: { x: number; y: number },
): StageResizeHandleDirection | null {
  for (const direction of STAGE_RESIZE_HANDLE_DIRECTIONS) {
    const point = overlayHandlePoint(frame, direction)
    if (Math.hypot(local.x - point.x, local.y - point.y) <= FLOW_OVERLAY_HANDLE_RADIUS) {
      return direction
    }
  }
  return null
}

interface FlowOverlayGesture {
  readonly type: 'move' | 'resize'
  readonly layerItemId: string
  readonly direction?: StageResizeHandleDirection
  readonly startLocal: { x: number; y: number }
  readonly startFrame: StageRect
  readonly target: CourseAuthoringTarget
  /** Set once the pointer travels past the click slop; a plain click selects and writes nothing. */
  moved: boolean
}

const FLOW_OVERLAY_DRAG_SLOP = 3
const pastDragSlop = (gesture: FlowOverlayGesture, local: { x: number; y: number }) =>
  gesture.moved || Math.hypot(local.x - gesture.startLocal.x, local.y - gesture.startLocal.y) >= FLOW_OVERLAY_DRAG_SLOP

export interface FlowOverlayAuthoringLayerProps {
  readonly view: FlowEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly selection: FlowEditorSelection | null
  readonly locationId: string
  readonly readOnly?: boolean
  readonly assetUrls: Record<string, string>
  readonly componentPackages?: Record<string, ComponentPackageData>
  readonly paperScrollTop: number
  readonly paperWidth?: number
  readonly paragraphRects?: readonly FlowParagraphBlockRect[]
  /** Derived Runtime paper frames; the canonical layer frame remains unchanged. */
  readonly runtimeFrames?: Readonly<Record<string, StageRect>>
  readonly onRuntimeHeightChange?: (layerItemId: string, height: number) => void
  readonly onRuntimeTargetsChanged?: (layerItemId: string, update: Readonly<RuntimeAuthoringTargetUpdate>) => void
  readonly onBodyPlaneChange?: (layerItemId: string, plane: 'overlay' | 'underlay') => void
  readonly paperScrollLeft?: number
  readonly paperOrigin?: FlowPoint
  readonly overlayViewportSize: { readonly width: number; readonly height: number; readonly nativeChrome?: PlaybackChromeInsets }
  readonly viewPan?: FlowPoint
  readonly onViewPanChange?: (pan: FlowPoint) => void
  readonly children: ReactNode
  readonly onEditFormula?: (layerItemId: string) => void
  readonly onBeforeGesture?: () => boolean
  readonly commands: FlowCurrentSessionCommandPort
}

export function FlowOverlayAuthoringLayer({
  view,
  sessionToken,
  selection,
  locationId,
  readOnly = false,
  assetUrls,
  componentPackages,
  paperScrollTop,
  paperWidth = 0,
  paragraphRects = [],
  runtimeFrames = {},
  onRuntimeHeightChange,
  onRuntimeTargetsChanged,
  onBodyPlaneChange,
  paperScrollLeft = 0,
  paperOrigin = { x: 0, y: 0 },
  overlayViewportSize,
  viewPan = { x: 0, y: 0 },
  onViewPanChange,
  children,
  onBeforeGesture,
  onEditFormula,
  commands,
}: FlowOverlayAuthoringLayerProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayGestureRef = useRef<FlowOverlayGesture | null>(null)
  const [overlayPreview, setOverlayPreview] = useState<{ id: string; frame: StageRect } | null>(null)

  const geometry = createFlowViewportGeometry({
    viewportClientRect: { x: 0, y: 0, ...overlayViewportSize },
    layoutViewportSize: overlayViewportSize,
    paperOriginLayout: paperOrigin,
    paperScrollLayout: { x: paperScrollLeft, y: paperScrollTop },
    playbackPanClient: viewPan,
  })
  const canvas = view.canvas ?? DEFAULT_SLIDE_CANVAS
  const authoredFrameOf = (layer: FlowEditorLayerView): StageRect => {
    if (isFlowPageRuntimeLayer(layer) && runtimeFrames[layer.selectionId]) return runtimeFrames[layer.selectionId]
    const ancestors: string[] = []
    let block = view.blocks.find(entry => entry.blockId === layer.paragraphAnchor?.blockId)
    while (block?.parentId) {
      ancestors.push(block.parentId)
      block = view.blocks.find(entry => entry.blockId === block?.parentId)
    }
    return resolveFlowOverlayAuthoredFrame(layer, paperWidth, paragraphRects, ancestors)
  }
  const localForLayer = (overlay: HTMLElement, event: ReactPointerEvent<HTMLElement>, layer?: FlowEditorLayerView) => {
    const point = overlayLocalPoint(overlay, event.clientX, event.clientY, overlayViewportSize)
    if (layer && isTeacherControllerLayerItem(layer.item)) return point
    return layer?.item.paperSpace === 'paper' ? geometry.clientToPaper(point) : geometry.clientToViewport(point)
  }

  const revealSelection = () => {
    if (overlayGestureRef.current) return
    // Screen-anchored overlays always stay inside the view; only paper overlays can scroll out of it.
    const bounds = view.overlayLayers.filter(layer => layer.effectiveVisible && !isTeacherControllerLayerItem(layer.item)
      && layer.item.paperSpace === 'paper' && selection?.selectedOverlayIds.includes(layer.selectionId)).map(layer => {
      const rect = rotatedWorldRectAxisBounds(authoredFrameOf(layer), layer.item.rotation)
      const origin = { x: rect.left, y: rect.top }
      const point = layer.item.paperSpace === 'paper' ? geometry.paperToClient(origin)
        : geometry.viewportToClient(flowViewportOverlayPoint({ ...origin, width: rect.width, height: rect.height }, canvas, overlayViewportSize))
      return { ...rect, ...point }
    })
    if (!bounds.length) return
    const x = Math.min(...bounds.map(rect => rect.x)), y = Math.min(...bounds.map(rect => rect.y))
    onViewPanChange?.(revealFlowSelectionPan({ x, y,
      width: Math.max(...bounds.map(rect => rect.x + rect.width)) - x,
      height: Math.max(...bounds.map(rect => rect.y + rect.height)) - y }, overlayViewportSize, viewPan))
  }
  const selectedOverlayKey = selection?.selectedOverlayIds.join('\u0000') ?? ''
  // Only overlays on the paper can scroll out of view, so only they offer a way back.
  const selectedPaperOverlay = view.overlayLayers.some(layer => selection?.selectedOverlayIds.includes(layer.selectionId) === true
    && !isTeacherControllerLayerItem(layer.item) && layer.item.paperSpace === 'paper')
  useLayoutEffect(revealSelection, [selectedOverlayKey, view.projectId, view.surfaceId, overlayViewportSize.width, overlayViewportSize.height])

  const overlayLayers = view.overlayLayers.filter((layer) => layer.effectiveVisible)
  const globalUnderlayLayers = overlayLayers.filter((layer) => (
    layer.owner === 'global' && layer.globalPlane === 'underlay'
  ))
  const surfaceUnderlayLayers = overlayLayers.filter((layer) => (
    layer.owner === 'surface' && layer.flowBodyPlane === 'underlay'
  ))
  const surfaceOverlayLayers = overlayLayers.filter((layer) => (
    layer.owner === 'surface' && layer.flowBodyPlane !== 'underlay'
  ))
  const globalOverlayLayers = overlayLayers.filter((layer) => (
    layer.owner === 'global' && layer.globalPlane !== 'underlay'
  ))
  const overlayScenes = view.navigationLocations.map((entry) => ({
    id: entry.locationId,
    name: entry.label,
  }))

  useControllerDisplayRevision()
  const overlayFrameOf = (layer: FlowEditorLayerView): StageRect => {
    const raw = overlayPreview?.id === layer.selectionId
      ? overlayPreview.frame
      : {
          ...authoredFrameOf(layer),
        }
    return constrainFlowControllerOverlayFrame(layer, raw, overlayViewportSize)
  }

  const selectOverlay = (layer: FlowEditorLayerView) => {
    const target = captureFlowEditorAuthoringTarget({
      view,
      sessionToken,
      target: { kind: 'overlay', layerItemId: layer.selectionId },
    })
    const receipt = commands.run(target, {
      kind: 'select-overlay',
      layerItemIds: [layer.selectionId],
    })
    return receipt.ok ? target : null
  }

  // M21 right-click: select the object as a press would, then ask the selection owner for that selection's menu.
  const openOverlayMenu = (event: ReactMouseEvent<HTMLElement>, layer: FlowEditorLayerView) => {
    event.preventDefault()
    event.stopPropagation()
    if (readOnly) return
    const current = selection?.selectedOverlayIds ?? []
    const selected = current.includes(layer.selectionId)
    if (!selected && (onBeforeGesture?.() === false || !selectOverlay(layer))) return
    const root = event.currentTarget.closest('main'), point = { x: event.clientX, y: event.clientY }
    const itemIds = selected ? [...current] : [layer.selectionId]
    if (root) window.setTimeout(() => { requestObjectContextMenu(root, { ...point, itemIds }) }, 0)
  }

  const beginOverlayGesture = (
    event: ReactPointerEvent<HTMLElement>,
    layer: FlowEditorLayerView,
  ) => {
    if (readOnly || event.button !== 0 || layer.locked) {
      if (!readOnly) {
        if (onBeforeGesture?.() === false) return
        selectOverlay(layer)
      }
      return
    }
    const overlay = overlayRef.current
    if (!overlay) return
    event.preventDefault()
    event.stopPropagation()
    if (onBeforeGesture?.() === false) return
    const target = selectOverlay(layer)
    if (!target) return
    const local = localForLayer(overlay, event, layer)
    const authoredFrame = overlayFrameOf(layer)
    // A screen-anchored overlay is dragged where it is shown, then written back to the canvas.
    const projectedFrame = isViewportOverlay(layer) ? { ...authoredFrame, ...flowViewportOverlayPoint(authoredFrame, canvas, overlayViewportSize) } : authoredFrame
    const componentController = layer.item.kind === 'component' && isTeacherControllerLayerItem(layer.item)
    const startFrame = componentController ? { ...projectedFrame, width: layer.item.frame.width, height: layer.item.frame.height } : projectedFrame
    const handleEl = event.target instanceof HTMLElement
      ? event.target.closest('[data-handle]')
      : null
    const handleAttr = handleEl?.getAttribute('data-handle')
    const direction = (STAGE_RESIZE_HANDLE_DIRECTIONS as readonly string[]).includes(handleAttr ?? '')
      ? handleAttr as StageResizeHandleDirection
      : isFlowPageRuntimeLayer(layer) ? null : hitFlowOverlayResizeHandle(startFrame, local)
    overlayGestureRef.current = {
      type: direction ? 'resize' : 'move',
      layerItemId: layer.selectionId,
      ...(direction ? { direction } : {}),
      startLocal: local,
      startFrame,
      target,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    const overlay = overlayRef.current
    if (!gesture || !overlay) return
    const local = localForLayer(overlay, event, view.overlayLayers.find(layer => layer.selectionId === gesture.layerItemId))
    if (!pastDragSlop(gesture, local)) return
    gesture.moved = true
    const rawNext = gesture.type === 'resize' && gesture.direction
      ? resizeWorldFrameFromHandle(
          gesture.startFrame,
          gesture.direction,
          local,
          MIN_NODE_SIZE,
        )
      : {
          x: gesture.startFrame.x + (local.x - gesture.startLocal.x),
          y: gesture.startFrame.y + (local.y - gesture.startLocal.y),
          width: gesture.startFrame.width,
          height: gesture.startFrame.height,
        }
    const next = constrainFlowControllerOverlayFrame(
      view.overlayLayers.find((layer) => layer.selectionId === gesture.layerItemId),
      rawNext,
      overlayViewportSize,
    )
    const layer = view.overlayLayers.find(layer => layer.selectionId === gesture.layerItemId)
    const persisted = layer?.item.kind === 'component' && isTeacherControllerLayerItem(layer.item) ? { ...next, width: rawNext.width, height: rawNext.height }
      : isViewportOverlay(layer) ? flowViewportOverlayFrameAt(next, canvas, overlayViewportSize) : next
    setOverlayPreview({ id: gesture.layerItemId, frame: persisted })
  }

  const endOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    const overlay = overlayRef.current
    overlayGestureRef.current = null
    if (!gesture || !overlay) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const local = localForLayer(overlay, event, view.overlayLayers.find(layer => layer.selectionId === gesture.layerItemId))
    if (!pastDragSlop(gesture, local)) { setOverlayPreview(null); return }
    const rawNext = gesture.type === 'resize' && gesture.direction
      ? resizeWorldFrameFromHandle(
          gesture.startFrame,
          gesture.direction,
          local,
          MIN_NODE_SIZE,
        )
      : {
          x: gesture.startFrame.x + (local.x - gesture.startLocal.x),
          y: gesture.startFrame.y + (local.y - gesture.startLocal.y),
          width: gesture.startFrame.width,
          height: gesture.startFrame.height,
        }
    const next = constrainFlowControllerOverlayFrame(
      view.overlayLayers.find((layer) => layer.selectionId === gesture.layerItemId),
      rawNext,
      overlayViewportSize,
    )
    setOverlayPreview(null)
    const layer = view.overlayLayers.find(layer => layer.selectionId === gesture.layerItemId)
    const projected = layer?.item.kind === 'component' && isTeacherControllerLayerItem(layer.item) ? { ...next, width: rawNext.width, height: rawNext.height }
      : isViewportOverlay(layer) ? flowViewportOverlayFrameAt(next, canvas, overlayViewportSize) : next
    const persisted = layer ? persistedRuntimeGestureFrame(layer, gesture.startFrame, projected) : projected
    const anchor = layer ? flowOverlayAnchorAfterDrag(layer, persisted, paperWidth, paragraphRects) : undefined
    if (anchor === null) return
    const intent = { kind: 'transform-overlay-frame', frame: persisted, ...(anchor ? { paragraphAnchor: anchor } : {}) } as const
    commands.run(gesture.target, intent)
  }

  const setSelectedPlacement = (layer: FlowEditorLayerView, follow: boolean) => {
    if (readOnly || layer.locked || !canChangeFlowOverlayPlacement(layer)) return
    const frame = overlayFrameOf(layer)
    const anchor = follow ? flowParagraphAnchorAt(frame, paperWidth, paragraphRects) : null
    if (follow && !anchor) return
    const target = captureFlowEditorAuthoringTarget({ view, sessionToken, target: { kind: 'overlay', layerItemId: layer.selectionId } })
    const intent = { kind: 'transform-overlay-frame', frame, paragraphAnchor: anchor } as const
    commands.run(target, intent)
  }

  const cancelOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    overlayGestureRef.current = null
    setOverlayPreview(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!gesture) return
    event.preventDefault()
    event.stopPropagation()
  }

  const overlayPlaneStyle = (zIndex: number): CSSProperties => ({
    position: 'absolute',
    left: 0,
    top: 0,
    width: overlayViewportSize.width,
    height: overlayViewportSize.height,
    transformOrigin: '0 0',
    zIndex,
    pointerEvents: 'none',
    overflow: 'hidden',
  })

  const renderOverlayVisual = (layer: FlowEditorLayerView) => {
    const preview = overlayPreview?.id === layer.selectionId ? overlayPreview.frame : null
    const controller = isTeacherControllerLayerItem(layer.item)
    // The teacher controller is selected and dragged in place on the page too, as in Slide (M19).
    const selected = selection?.selectedOverlayIds.includes(layer.selectionId) === true
    const underlayVisual = layer.owner === 'global' && layer.globalPlane === 'underlay'
    const passThroughVisual = layer.item.hitPolicy === 'pass-through'
    const inertVisual = underlayVisual || passThroughVisual
    const pageRuntime = isFlowPageRuntimeLayer(layer)
    const interactive = !readOnly && !selected && !inertVisual && !pageRuntime
    const runtimeEdgeActive = pageRuntime && !readOnly && !layer.locked && !inertVisual
    return (
      <div
        key={layer.selectionId}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        className={`flow-layer-card${controller ? ' flow-layer-card--controller' : ''}`}
        data-layer-item-id={layer.selectionId}
        data-testid={`flow-layer-card-${layer.selectionId}`}
        data-flow-overlay-owner={layer.owner}
        data-flow-overlay-owner-key={layer.ownerKey}
        data-flow-overlay-order={layer.stackOrder}
        data-flow-overlay-locked={layer.locked ? 'true' : 'false'}
        data-flow-overlay-visible={layer.effectiveVisible ? 'true' : 'false'}
        data-flow-global-plane={layer.globalPlane ?? undefined}
        data-flow-body-plane={layer.flowBodyPlane ?? undefined}
        aria-hidden={inertVisual || undefined}
        aria-label={interactive ? layer.item.label || '浮层' : undefined}
        {...(inertVisual ? { inert: true } : {})}
        style={{
          ...overlayCardStyle(
            layer,
            preview,
            authoredFrameOf(layer),
            paperScrollTop,
            paperOrigin,
            paperScrollLeft,
            viewPan,
            overlayViewportSize,
            false,
            canvas,
          ),
          opacity: layer.item.opacity,
          ...(controller ? (() => { const base = overlayFrameOf(layer), visible = controllerDisplayFrame(layer.item as LayerItem, base); return { clipPath: `inset(${visible.y-base.y}px ${base.width-(visible.x-base.x)-visible.width}px ${base.height-(visible.y-base.y)-visible.height}px ${visible.x-base.x}px)` } })() : {}),
          pointerEvents: pageRuntime && !inertVisual ? 'auto' : interactive ? 'auto' : 'none',
        }}
        onPointerDown={runtimeEdgeActive
          ? event => { if ((event.target as HTMLElement).closest('[data-runtime-drag-edge]')) beginOverlayGesture(event, layer) }
          : interactive ? event => beginOverlayGesture(event, layer) : undefined}
        onContextMenu={(interactive || (pageRuntime && !readOnly && !inertVisual)) ? event => openOverlayMenu(event, layer) : undefined}
        onDoubleClick={!readOnly && layer.item.kind === 'native' && layer.item.content.nativeType === 'formula' ? event => { event.stopPropagation(); onEditFormula?.(layer.selectionId) } : undefined}
        onPointerMove={readOnly ? undefined : moveOverlayGesture}
        onPointerUp={readOnly ? undefined : endOverlayGesture}
        onPointerCancel={readOnly ? undefined : cancelOverlayGesture}
      >
        {controller ? (
          <TeacherControllerAuthoringChrome
            projectId={view.projectId} componentPackages={componentPackages} assetUrls={assetUrls}
            flowViewport
            item={layer.item as LayerItem}
            frame={overlayFrameOf(layer)}
            rotation={layer.item.rotation}
            canvas={overlayViewportSize}
            getRenderedStageBounds={() => {
              const bounds = overlayRef.current?.getBoundingClientRect()
              return {
                width: Math.max(1, bounds?.width || CANVAS_WIDTH),
                height: Math.max(1, bounds?.height || CANVAS_HEIGHT),
              }
            }}
            scenes={overlayScenes}
            currentSceneId={locationId}
          />
        ) : pageRuntime ? (
          <FlowPageRuntime
            item={layer.item}
            surfaceId={view.surfaceId}
            ownerKey={`${view.projectId}:${view.surfaceId}:${sessionToken.generation}`}
            width={authoredFrameOf(layer).width}
            height={authoredFrameOf(layer).height}
            assetUrls={assetUrls}
            onHeightChange={height => onRuntimeHeightChange?.(layer.selectionId, height)}
            onTargetsChanged={update => onRuntimeTargetsChanged?.(layer.selectionId, update)}
          />
        ) : renderFlowOverlayCardContent(view.projectId, layer, assetUrls, componentPackages)}
        {runtimeEdgeActive && runtimeDragEdges()}
      </div>
    )
  }

  const renderSelectionChrome = (layer: FlowEditorLayerView) => {
    const previewFrame = overlayPreview?.id === layer.selectionId ? overlayPreview.frame : null
    const previewAnchor = previewFrame && layer.paragraphAnchor ? flowParagraphAnchorAt(previewFrame, paperWidth, paragraphRects) : null
    const shownAnchor = previewAnchor ?? layer.paragraphAnchor
    const selected = selection?.selectedOverlayIds.includes(layer.selectionId) === true
    if (!selected) return null
    const editable = !readOnly && !layer.locked
    const pageRuntime = isFlowPageRuntimeLayer(layer)
    return (
      <div
        key={layer.selectionId}
        role={readOnly || pageRuntime ? undefined : 'button'}
        tabIndex={readOnly || pageRuntime ? undefined : 0}
        className="flow-layer-selection-chrome flow-layer-card--selected"
        data-layer-item-id={layer.selectionId}
        data-testid={`flow-layer-selection-${layer.selectionId}`}
        aria-label={readOnly ? undefined : `${layer.item.label || '浮层'}选择框`}
        style={{
          ...overlayCardStyle(
            layer,
            overlayPreview?.id === layer.selectionId ? overlayPreview.frame : null,
            authoredFrameOf(layer),
            paperScrollTop,
            paperOrigin,
            paperScrollLeft,
            viewPan,
            overlayViewportSize,
            true,
            canvas,
          ),
          pointerEvents: readOnly || pageRuntime ? 'none' : 'auto',
          background: 'transparent',
        }}
        onPointerDown={readOnly ? undefined : pageRuntime
          ? event => { if ((event.target as HTMLElement).closest('[data-runtime-drag-edge], [data-handle]')) beginOverlayGesture(event, layer) }
          : event => beginOverlayGesture(event, layer)}
        onContextMenu={readOnly ? undefined : (event) => openOverlayMenu(event, layer)}
        onDoubleClick={!readOnly && layer.item.kind === 'native' && layer.item.content.nativeType === 'formula' ? event => { event.stopPropagation(); onEditFormula?.(layer.selectionId) } : undefined}
        onPointerMove={readOnly ? undefined : moveOverlayGesture}
        onPointerUp={readOnly ? undefined : endOverlayGesture}
        onPointerCancel={readOnly ? undefined : cancelOverlayGesture}
      >
        {editable && canChangeFlowOverlayPlacement(layer) ? <div className="flow-layer-placement-controls" data-flow-placement-controls={layer.selectionId}
          style={{ position: 'absolute', left: 0, top: -30, display: 'flex', gap: 4, whiteSpace: 'nowrap', pointerEvents: 'auto', zIndex: 1 }}
          onPointerDown={event => event.stopPropagation()}>
          <button type="button" disabled={Boolean(layer.paragraphAnchor)} onClick={event => { event.stopPropagation(); setSelectedPlacement(layer, true) }}>随文字移动</button>
          <button type="button" disabled={!layer.paragraphAnchor} onClick={event => { event.stopPropagation(); setSelectedPlacement(layer, false) }}>固定在纸面</button>
          {onBodyPlaneChange && <>
            <button type="button" disabled={layer.flowBodyPlane !== 'underlay'} onClick={event => { event.stopPropagation(); onBodyPlaneChange(layer.selectionId, 'overlay') }}>正文上方</button>
            <button type="button" disabled={layer.flowBodyPlane === 'underlay'} onClick={event => { event.stopPropagation(); onBodyPlaneChange(layer.selectionId, 'underlay') }}>正文下方</button>
          </>}
        </div> : null}
        {selected && shownAnchor && <span data-flow-anchor-block-id={shownAnchor.blockId}
          style={{ position: 'absolute', left: 0, top: -16, fontSize: 11, pointerEvents: 'none', background: '#2563eb', color: '#fff' }}>挂靠：{shownAnchor.blockId}</span>}
        {editable && pageRuntime && runtimeDragEdges()}
        {editable ? STAGE_RESIZE_HANDLE_DIRECTIONS.map((direction) => {
          const frame = controllerDisplayFrame(layer.item as LayerItem, overlayFrameOf(layer))
          const point = overlayHandlePoint(frame, direction)
          return (
            <div
              key={direction}
              className="flow-layer-card__handle"
              data-handle={direction}
              data-testid={`flow-overlay-handle-${layer.selectionId}-${direction}`}
              style={{
                position: 'absolute',
                left: point.x - frame.x - 4,
                top: point.y - frame.y - 4,
                width: 8,
                height: 8,
                pointerEvents: 'auto',
              }}
            />
          )
        }) : null}
      </div>
    )
  }

  return (
    <>
      <div
        className="flow-authoring-layer-plane flow-authoring-layer-plane--global-underlay"
        data-flow-layer-plane="global-underlay"
        data-testid="flow-authoring-global-underlay"
        style={overlayPlaneStyle(0)}
      >
        {globalUnderlayLayers.map(renderOverlayVisual)}
      </div>
      <div
        className="flow-authoring-layer-plane flow-authoring-layer-plane--surface-underlay"
        data-flow-layer-plane="surface-underlay"
        data-testid="flow-authoring-surface-underlay"
        style={overlayPlaneStyle(1)}
      >
        {surfaceUnderlayLayers.map(renderOverlayVisual)}
      </div>
      {children}
      <div
        className="flow-authoring-layer-plane flow-authoring-layer-plane--surface-overlay"
        data-flow-layer-plane="surface-overlay"
        data-testid="flow-authoring-surface-overlay"
        style={overlayPlaneStyle(3)}
      >
        {surfaceOverlayLayers.map(renderOverlayVisual)}
      </div>
      <div
        ref={overlayRef}
        className="flow-authoring-layer-plane flow-authoring-layer-plane--global-overlay flow-authoring-layer-overlay"
        data-flow-layer-plane="global-overlay"
        data-testid="flow-authoring-layer-overlay"
        style={overlayPlaneStyle(4)}
      >
        {globalOverlayLayers.map(renderOverlayVisual)}
      </div>
      <div
        className="flow-authoring-selection-plane"
        data-testid="flow-authoring-selection-plane"
        style={overlayPlaneStyle(5)}
      >
        {overlayLayers.map(renderSelectionChrome)}
      </div>
      {(selectedPaperOverlay || viewPan.x !== 0 || viewPan.y !== 0) && <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 6, display: 'flex', gap: 6 }}>
        {selectedPaperOverlay && <button type="button" className="secondary-button" onClick={revealSelection}>定位选中内容</button>}
        {(viewPan.x !== 0 || viewPan.y !== 0) && <button type="button" className="secondary-button" onClick={() => onViewPanChange?.({ x: 0, y: 0 })}>回到文档原位</button>}
      </div>}
    </>
  )
}
