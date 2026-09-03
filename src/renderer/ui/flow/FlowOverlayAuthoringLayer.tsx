import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_NODE_SIZE } from '../../../shared/constants'
import type { FormulaAstNode } from '../../../shared/contracts/native-v1'
import type { LayerItem } from '../../../shared/courseProjectTypes'
import { constrainTeacherControllerAuthoringFrame } from '../../../shared/teacherControllerLayout'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import {
  captureFlowEditorAuthoringTarget,
  type FlowEditorLayerView,
  type FlowEditorView,
} from '../../course/flowEditorView'
import type { FlowEditorSelection } from '../../course/flowEditorSlice'
import type {
  CourseAuthoringSessionToken,
  CourseAuthoringTarget,
} from '../../authoring/courseAuthoringSession'
import type { FlowCurrentSessionCommandPort } from './useFlowTextAuthoringController'
import { isTeacherControllerLayerItem } from '../../course/globalLayerCommands'
import {
  createStageViewportTransform,
  resizeWorldFrameFromHandle,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  STAGE_VIEWPORT_HEIGHT,
  STAGE_VIEWPORT_WIDTH,
  type StageRect,
  type StageResizeHandleDirection,
} from '../../authoring/stageViewportTransform'
import { TeacherControllerAuthoringChrome } from '../TeacherControllerAuthoringChrome'
import { PublishedFormulaPaint } from '../PublishedFormulaPaint'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../../player/surfaces/publishedComponentMount'

const FLOW_OVERLAY_HANDLE_RADIUS = 10

function overlayCardStyle(
  layer: FlowEditorLayerView,
  preview?: StageRect | null,
  paperScrollTop = 0,
): CSSProperties {
  const frame = preview ?? layer.item.frame
  const isController = isTeacherControllerLayerItem(layer.item)
  const isPaper = !isController && layer.item.paperSpace === 'paper'
  const top = isPaper ? frame.y - paperScrollTop : frame.y
  return {
    position: 'absolute',
    left: frame.x,
    top,
    width: frame.width,
    height: frame.height,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    zIndex: layer.stackOrder,
  }
}

function constrainFlowControllerOverlayFrame(
  layer: FlowEditorLayerView | undefined,
  frame: StageRect,
): StageRect {
  if (!layer || !isTeacherControllerLayerItem(layer.item)) return frame
  return constrainTeacherControllerAuthoringFrame(
    layer.item.content.data,
    frame,
    layer.item.rotation,
    { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
  )
}

function nativeOverlayMedia(item: LayerItem): {
  readonly kind: 'image' | 'video'
  readonly assetId: string
  readonly posterAssetId?: string
} | null {
  if (item.kind !== 'native') return null
  if (item.content.nativeType === 'image') {
    return { kind: 'image', assetId: item.content.data.assetId }
  }
  if (item.content.nativeType === 'video') {
    const posterAssetId = item.content.data.poster.assetId
    return {
      kind: 'video',
      assetId: item.content.data.assetId,
      ...(posterAssetId ? { posterAssetId } : {}),
    }
  }
  return null
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
  layer,
  componentPackages,
  assetUrls,
}: {
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
  }, [item.component.packageId, item.component.version, layer.selectionId, item.frame.width, item.frame.height, item.props, item.staticFallbackAssetId, componentPackages, assetUrls, pkg])

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
  layer: FlowEditorLayerView,
  assetUrls: Record<string, string>,
  componentPackages?: Record<string, ComponentPackageData>,
): ReactNode {
  if (layer.item.kind === 'component') {
    return (
      <FlowOverlayComponentContent
        layer={layer}
        componentPackages={componentPackages}
        assetUrls={assetUrls}
      />
    )
  }
  if (layer.item.kind === 'native' && layer.item.content.nativeType === 'formula') {
    const data = layer.item.content.data
    const frame = layer.item.frame
    return (
      <PublishedFormulaPaint
        formulaId={data.formulaId}
        accessibleText={data.accessibleText}
        ast={data.ast as FormulaAstNode}
        style={data.style}
        width={Math.max(1, frame.width)}
        height={Math.max(1, frame.height)}
        lockHeight
      />
    )
  }
  const media = nativeOverlayMedia(layer.item as LayerItem)
  if (!media) return layer.item.label || '浮层'
  const url = assetUrls[media.assetId]
  if (media.kind === 'image') {
    return (
      <img
        data-flow-overlay-media="image"
        data-flow-asset-id={media.assetId}
        alt=""
        {...(url ? { src: url } : {})}
        style={overlayMediaFillStyle()}
      />
    )
  }
  const posterUrl = media.posterAssetId ? assetUrls[media.posterAssetId] : undefined
  return (
    <video
      data-flow-overlay-media="video"
      data-flow-asset-id={media.assetId}
      {...(url ? { src: url } : {})}
      {...(posterUrl ? { poster: posterUrl } : {})}
      muted
      playsInline
      preload="metadata"
      style={overlayMediaFillStyle()}
    />
  )
}

function overlayLocalPoint(
  overlay: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const bounds = overlay.getBoundingClientRect()
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  return {
    x: (clientX - bounds.left) * (CANVAS_WIDTH / width),
    y: (clientY - bounds.top) * (CANVAS_HEIGHT / height),
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
}

export interface FlowOverlayAuthoringLayerProps {
  readonly view: FlowEditorView
  readonly sessionToken: CourseAuthoringSessionToken
  readonly selection: FlowEditorSelection | null
  readonly locationId: string
  readonly readOnly?: boolean
  readonly assetUrls: Record<string, string>
  readonly componentPackages?: Record<string, ComponentPackageData>
  readonly paperScrollTop: number
  readonly overlayViewportSize: { readonly width: number; readonly height: number }
  readonly children: ReactNode
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
  overlayViewportSize,
  children,
  onBeforeGesture,
  commands,
}: FlowOverlayAuthoringLayerProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayGestureRef = useRef<FlowOverlayGesture | null>(null)
  const [overlayPreview, setOverlayPreview] = useState<{ id: string; frame: StageRect } | null>(null)

  const overlayTransform = useMemo(() => createStageViewportTransform({
    viewport: {
      x: 0,
      y: 0,
      width: Math.max(1, overlayViewportSize.width),
      height: Math.max(1, overlayViewportSize.height),
    },
    zoom: 1,
  }), [overlayViewportSize.height, overlayViewportSize.width])

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

  const overlayFrameOf = (layer: FlowEditorLayerView): StageRect => {
    if (overlayPreview?.id === layer.selectionId) return overlayPreview.frame
    return {
      x: layer.item.frame.x,
      y: layer.item.frame.y,
      width: layer.item.frame.width,
      height: layer.item.frame.height,
    }
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
    const local = overlayLocalPoint(overlay, event.clientX, event.clientY)
    const startFrame = overlayFrameOf(layer)
    const handleEl = event.target instanceof HTMLElement
      ? event.target.closest('[data-handle]')
      : null
    const handleAttr = handleEl?.getAttribute('data-handle')
    const direction = (STAGE_RESIZE_HANDLE_DIRECTIONS as readonly string[]).includes(handleAttr ?? '')
      ? handleAttr as StageResizeHandleDirection
      : hitFlowOverlayResizeHandle(startFrame, local)
    overlayGestureRef.current = {
      type: direction ? 'resize' : 'move',
      layerItemId: layer.selectionId,
      ...(direction ? { direction } : {}),
      startLocal: local,
      startFrame,
      target,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    const overlay = overlayRef.current
    if (!gesture || !overlay) return
    const local = overlayLocalPoint(overlay, event.clientX, event.clientY)
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
    )
    setOverlayPreview({ id: gesture.layerItemId, frame: next })
  }

  const endOverlayGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = overlayGestureRef.current
    const overlay = overlayRef.current
    overlayGestureRef.current = null
    if (!gesture || !overlay) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const local = overlayLocalPoint(overlay, event.clientX, event.clientY)
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
    )
    setOverlayPreview(null)
    commands.run(gesture.target, { kind: 'transform-overlay-frame', frame: next })
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
    left: overlayTransform.stageRect.x,
    top: overlayTransform.stageRect.y,
    width: STAGE_VIEWPORT_WIDTH,
    height: STAGE_VIEWPORT_HEIGHT,
    transform: `scale(${overlayTransform.scale})`,
    transformOrigin: '0 0',
    zIndex,
    pointerEvents: 'none',
    overflow: 'hidden',
  })

  const renderOverlayVisual = (layer: FlowEditorLayerView) => {
    const preview = overlayPreview?.id === layer.selectionId ? overlayPreview.frame : null
    const controller = isTeacherControllerLayerItem(layer.item)
    const controllerGlobalAuthoring = controller && selection?.authoringScope === 'global'
    const controllerPagePreview = controller && !controllerGlobalAuthoring
    const selected = !controllerPagePreview
      && selection?.selectedOverlayIds.includes(layer.selectionId) === true
    const underlayVisual = layer.owner === 'global' && layer.globalPlane === 'underlay'
    const passThroughVisual = layer.item.hitPolicy === 'pass-through'
    const inertVisual = underlayVisual || passThroughVisual
    const interactive = !readOnly && !selected && !controllerPagePreview && !inertVisual
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
        data-controller-page-preview={controllerPagePreview || undefined}
        data-flow-global-plane={layer.globalPlane ?? undefined}
        data-flow-body-plane={layer.flowBodyPlane ?? undefined}
        aria-hidden={controllerPagePreview || inertVisual || undefined}
        aria-label={interactive ? layer.item.label || '浮层' : undefined}
        {...(inertVisual ? { inert: true } : {})}
        style={{
          ...overlayCardStyle(layer, preview, paperScrollTop),
          pointerEvents: interactive ? 'auto' : 'none',
        }}
        onPointerDown={interactive ? (event) => beginOverlayGesture(event, layer) : undefined}
        onPointerMove={readOnly ? undefined : moveOverlayGesture}
        onPointerUp={readOnly ? undefined : endOverlayGesture}
        onPointerCancel={readOnly ? undefined : cancelOverlayGesture}
      >
        {controller ? (
          <TeacherControllerAuthoringChrome
            item={layer.item as LayerItem}
            frame={overlayFrameOf(layer)}
            rotation={layer.item.rotation}
            canvas={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
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
        ) : (
          renderFlowOverlayCardContent(layer, assetUrls, componentPackages)
        )}
      </div>
    )
  }

  const renderSelectionChrome = (layer: FlowEditorLayerView) => {
    const controller = isTeacherControllerLayerItem(layer.item)
    const controllerPagePreview = controller && selection?.authoringScope !== 'global'
    const selected = !controllerPagePreview
      && selection?.selectedOverlayIds.includes(layer.selectionId) === true
    if (!selected) return null
    const editable = !readOnly && !layer.locked
    return (
      <div
        key={layer.selectionId}
        role={readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        className="flow-layer-selection-chrome flow-layer-card--selected"
        data-layer-item-id={layer.selectionId}
        data-testid={`flow-layer-selection-${layer.selectionId}`}
        aria-label={readOnly ? undefined : `${layer.item.label || '浮层'}选择框`}
        style={{
          ...overlayCardStyle(
            layer,
            overlayPreview?.id === layer.selectionId ? overlayPreview.frame : null,
            paperScrollTop,
          ),
          pointerEvents: readOnly ? 'none' : 'auto',
          background: 'transparent',
        }}
        onPointerDown={readOnly ? undefined : (event) => beginOverlayGesture(event, layer)}
        onPointerMove={readOnly ? undefined : moveOverlayGesture}
        onPointerUp={readOnly ? undefined : endOverlayGesture}
        onPointerCancel={readOnly ? undefined : cancelOverlayGesture}
      >
        {editable ? STAGE_RESIZE_HANDLE_DIRECTIONS.map((direction) => {
          const point = overlayHandlePoint(overlayFrameOf(layer), direction)
          const frame = overlayFrameOf(layer)
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
    </>
  )
}
