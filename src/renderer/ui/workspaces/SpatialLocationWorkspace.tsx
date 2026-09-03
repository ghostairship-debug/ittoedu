import { Hand, Maximize2, Minus, MousePointer2, Play, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import type { NativeRenderInput } from '../../../shared/contracts/native-v1'
import type { LayerItem, NativeLayerItem } from '../../../shared/courseProjectTypes'
import { materializeNativeLayerItem } from '../../../shared/courseProjectSchema'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../../shared/constants'
import { renderTextNodeCanvas } from '../../../shared/textLayout'
import type { CourseAuthoringTarget } from '../../authoring/courseAuthoringSession'
import type { SpatialAuthoringCommandPort } from '../../authoring/spatialAuthoringIntents'
import type { SpatialWorldContentEditSession } from '../../authoring/spatialWorldAuthoring'
import {
  createSpatialWorldTargetAuthoringController,
  type SpatialWorldAuthoringSnapshot,
} from '../../authoring/spatialWorldTargetAuthoring'
import {
  clientToWorld,
  createStageViewportTransform,
  LOGICAL_STAGE_VIEWPORT,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  STAGE_VIEWPORT_HEIGHT,
  STAGE_VIEWPORT_WIDTH,
  type StageRect,
  type StageSelectionOverlayGeometry,
} from '../../authoring/stageViewportTransform'
import { isTeacherControllerLayerItem } from '../../course/globalLayerCommands'
import type { SpatialEditorWorldTransform } from '../../course/spatialEditorCommands'
import {
  assertActiveSpatialEditorView,
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
  spatialNativeLayerItem,
  type SpatialEditorGraphSelection,
  type SpatialEditorStableTarget,
  type SpatialEditorView,
  type SpatialSessionCamera,
} from '../../course/spatialEditorView'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../../player/surfaces/publishedComponentMount'
import type { PublishedCourseSession } from '../../../player/surfaces/publishedDynamicHosts'
import { adaptV9SpatialEditorLayers, hitTestV9SpatialLayerItems } from '../../phaser/v9SpatialHitAdapter'
import { FormulaEditDialog } from '../FormulaEditDialog'
import { PublishedFormulaPaint } from '../PublishedFormulaPaint'
import {
  attachPublishedCourseStageFit,
} from '../coursePlayerTryRun'
import {
  beginSerializedSessionMount,
  enqueueSerial,
} from '../serializedSessionMount'
import { TeacherControllerAuthoringChrome } from '../TeacherControllerAuthoringChrome'
import { TextEditOverlay } from '../TextEditOverlay'

export type SpatialCanvasMode = 'edit' | 'run'

export interface SpatialLocationWorkspaceProps {
  readonly view: SpatialEditorView
  readonly showCameraFrames: boolean
  readonly targets: readonly SpatialEditorStableTarget[]
  readonly selectionIds: readonly string[]
  readonly graphSelection: SpatialEditorGraphSelection | null
  readonly canvasMode: SpatialCanvasMode
  readonly scope: 'global' | 'surface' | 'world'
  readonly contentEdit: SpatialWorldContentEditSession | null
  readonly assetFiles: Record<string, Uint8Array>
  readonly assetMimeTypes: Readonly<Record<string, string>>
  readonly componentPackages: Record<string, ComponentPackageData>
  readonly worldTarget: CourseAuthoringTarget
  readonly layerTargets: ReadonlyMap<string, CourseAuthoringTarget>
  readonly commands: SpatialAuthoringCommandPort
  readonly onCanvasModeChange: (mode: SpatialCanvasMode) => void
  readonly onMountTryRun: (container: HTMLElement) => Promise<PublishedCourseSession>
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = dx * dx + dy * dy
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

function spatialWorldItemCenter(item: {
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}) {
  return {
    x: item.frame.x + item.frame.width / 2,
    y: item.frame.y + item.frame.height / 2,
  }
}

function hitSpatialGraphAtWorld(
  view: SpatialEditorView,
  world: { x: number; y: number },
  threshold: number,
): SpatialEditorGraphSelection | null {
  const items = new Map(
    view.layers
      .filter((layer) => layer.source === 'world')
      .map((layer) => [layer.selectionId, layer.item]),
  )
  for (const relationView of [...view.worldGraph.relations].reverse()) {
    const relation = relationView.relation
    const source = items.get(relation.sourceLayerItemId)
    const target = items.get(relation.targetLayerItemId)
    if (!source || !target) continue
    if (distanceToSegment(world, spatialWorldItemCenter(source), spatialWorldItemCenter(target)) <= threshold) {
      return { kind: 'relation', id: relationView.relationId }
    }
  }
  for (const pathView of [...view.worldGraph.paths].reverse()) {
    const points = pathView.path.layerItemIds.flatMap((id) => {
      const item = items.get(id)
      return item ? [spatialWorldItemCenter(item)] : []
    })
    for (let index = 1; index < points.length; index += 1) {
      if (distanceToSegment(world, points[index - 1]!, points[index]!) <= threshold) {
        return { kind: 'path', id: pathView.pathId }
      }
    }
  }
  return null
}

const SPATIAL_MEDIA_FILL = {
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'contain' as const,
  pointerEvents: 'none' as const,
}

function spatialAuthoringMedia(
  native: NativeRenderInput,
  assetUrls: Readonly<Record<string, string>>,
) {
  if (native.type === 'image') {
    const src = assetUrls[native.assetId]
    return src
      ? <img src={src} alt="" draggable={false} style={SPATIAL_MEDIA_FILL} />
      : (native.name || native.type)
  }
  if (native.type === 'video') {
    const src = assetUrls[native.assetId]
    const poster = native.poster.mode === 'image' && native.poster.assetId
      ? assetUrls[native.poster.assetId]
      : undefined
    if (src) {
      return (
        <video
          src={src}
          poster={poster}
          muted
          playsInline
          preload="metadata"
          draggable={false}
          style={SPATIAL_MEDIA_FILL}
        />
      )
    }
    if (poster) {
      return <img src={poster} alt="" draggable={false} style={SPATIAL_MEDIA_FILL} />
    }
    return native.name || native.type
  }
  return null
}

function spatialLayerPaintKind(item: {
  readonly kind: LayerItem['kind']
  readonly content?: { readonly nativeType: string }
}): string {
  if (item.kind === 'component') return 'external-component'
  if (item.kind === 'runtime') return 'runtime'
  return item.content?.nativeType ?? item.kind
}

function asSpatialNativeLayer(item: LayerItem): NativeLayerItem | null {
  return item.kind === 'native' ? item : null
}

function spatialNativePaint(
  item: LayerItem,
  assetUrls: Readonly<Record<string, string>>,
  size: { width: number; height: number },
) {
  const nativeItem = asSpatialNativeLayer(item)
  if (!nativeItem) return item.label || item.kind
  const native = materializeNativeLayerItem(nativeItem)
  if (native.type === 'formula') {
    return (
      <PublishedFormulaPaint
        formulaId={native.formulaId}
        accessibleText={native.accessibleText}
        ast={native.ast}
        style={native.style}
        width={Math.max(1, size.width)}
        height={Math.max(1, size.height)}
        lockHeight
      />
    )
  }
  if (native.type === 'text') return native.text
  return spatialAuthoringMedia(native, assetUrls) ?? (native.name || native.type)
}

function spatialNativeWorldBoxStyle(item: LayerItem): {
  background: string
  color: string
  fontSize: number
  fontFamily?: string
} {
  const nativeItem = asSpatialNativeLayer(item)
  if (!nativeItem) {
    return { background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 14 }
  }
  const native = materializeNativeLayerItem(nativeItem)
  if (native.type === 'shape') {
    return { background: native.style.fillColor, color: '#e2e8f0', fontSize: 14 }
  }
  if (native.type === 'text') {
    return {
      background: 'transparent',
      color: native.style.color,
      fontSize: native.style.fontSize,
      fontFamily: native.style.fontFamily,
    }
  }
  return { background: 'rgba(255,255,255,0.04)', color: '#e2e8f0', fontSize: 14 }
}

function SpatialComponentItemContent({
  layerItemId,
  item,
  componentPackages,
  assetUrls,
}: {
  layerItemId: string
  item: LayerItem
  componentPackages: Record<string, ComponentPackageData>
  assetUrls: Record<string, string>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
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
      instanceId: layerItemId,
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
  }, [item.component.packageId, item.component.version, layerItemId, item.frame.width, item.frame.height, item.props, item.staticFallbackAssetId, componentPackages, assetUrls, pkg])

  if (!pkg) {
    if (fallbackUrl) {
      return (
        <img
          src={fallbackUrl}
          alt={`${item.component.packageId} 后备`}
          draggable={false}
          style={SPATIAL_MEDIA_FILL}
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
          padding: 4,
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

function SpatialSelectionOverlay({
  overlay,
  locked,
}: {
  overlay: StageSelectionOverlayGeometry
  locked?: boolean
}) {
  const box = overlay.selectionBox
  return (
    <div className="spatial-selection-overlay" data-testid="spatial-selection-overlay" aria-hidden="true">
      <div
        className={`spatial-selection-overlay__box${locked ? ' spatial-selection-overlay__box--locked' : ''}`}
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          transform: `rotate(${overlay.rotation}deg)`,
          transformOrigin: 'center center',
        }}
      />
      {STAGE_RESIZE_HANDLE_DIRECTIONS.map((direction) => {
        const point = overlay.handles[direction]
        return (
          <div
            key={direction}
            className={`spatial-selection-overlay__handle${locked ? ' spatial-selection-overlay__handle--locked' : ''}`}
            data-handle={direction}
            style={{ left: point.x - 5.5, top: point.y - 5.5 }}
          />
        )
      })}
      <div
        className="spatial-selection-overlay__rotate"
        data-handle="rotate"
        style={{
          left: overlay.rotationHandle.x - 5.5,
          top: overlay.rotationHandle.y - 5.5,
        }}
      />
    </div>
  )
}

export function SpatialLocationWorkspace({
  view,
  showCameraFrames,
  targets,
  selectionIds,
  graphSelection,
  canvasMode,
  scope,
  contentEdit,
  assetFiles,
  assetMimeTypes,
  componentPackages,
  worldTarget,
  layerTargets,
  commands,
  onCanvasModeChange,
  onMountTryRun,
}: SpatialLocationWorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageStackRef = useRef<HTMLDivElement>(null)
  const tryRunRef = useRef<HTMLDivElement>(null)
  const tryRunMountChainRef = useRef(Promise.resolve())
  const tryRunFitRef = useRef<(() => void) | null>(null)
  const textProxyCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<PublishedCourseSession | null>(null)
  const pointerActiveRef = useRef(false)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 450 })
  const [previewFrames, setPreviewFrames] = useState<readonly SpatialEditorWorldTransform[] | null>(null)
  const [previewCamera, setPreviewCamera] = useState<SpatialSessionCamera | null>(null)
  const [worldOverlay, setWorldOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const [hudOverlay, setHudOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const [textCanvas, setTextCanvas] = useState<HTMLCanvasElement | null>(null)

  const snapshot: SpatialWorldAuthoringSnapshot = {
    view,
    selectionIds,
    scope,
    contentEdit,
    worldTarget,
    layerTargets,
  }
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const commandsRef = useRef(commands)
  commandsRef.current = commands
  const contentEditRef = useRef(contentEdit)
  contentEditRef.current = contentEdit
  const authoringRef = useRef(createSpatialWorldTargetAuthoringController({
    readSnapshot: () => snapshotRef.current,
    commands: { run: (target, intent) => commandsRef.current.run(target, intent) },
  }))

  useLayoutEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const update = () => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setViewportSize({ width: rect.width, height: rect.height })
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const readHoleClientRect = useCallback((): StageRect | null => {
    const node = viewportRef.current
    if (!node) return null
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const readLogicalPointer = useCallback((clientX: number, clientY: number) => {
    const hole = readHoleClientRect()
    if (!hole) return null
    const point = clientToWorld(createStageViewportTransform({ viewport: hole, zoom: 1 }), {
      x: clientX,
      y: clientY,
    })
    return { x: point.x, y: point.y }
  }, [readHoleClientRect])

  const liveCamera = previewCamera ?? view.sessionCamera
  const stageTransform = useMemo(() => createStageViewportTransform({
    viewport: {
      x: 0,
      y: 0,
      width: Math.max(1, viewportSize.width),
      height: Math.max(1, viewportSize.height),
    },
    zoom: 1,
  }), [viewportSize.height, viewportSize.width])
  const worldTransform = useMemo(() => createSpatialWorldViewTransform(
    LOGICAL_STAGE_VIEWPORT,
    liveCamera,
  ), [liveCamera])
  const hudTransform = useMemo(() => createSpatialViewportOverlayTransform(
    LOGICAL_STAGE_VIEWPORT,
  ), [])

  const worldItems = view.layers.filter((layer) => layer.coordinateSpace === 'world')
  const hudItems = view.layers.filter((layer) => layer.coordinateSpace === 'viewport')
  const hudUnderlayItems = hudItems.filter((layer) => (
    layer.source === 'global' && layer.globalPlane === 'underlay'
  ))
  const hudOverlayItems = hudItems.filter((layer) => !(
    layer.source === 'global' && layer.globalPlane === 'underlay'
  ))
  const previewById = new Map((previewFrames ?? []).map((frame) => [frame.layerItemId, frame]))
  const targetIds = new Set(targets.map((target) => target.layerItemId))

  useEffect(() => {
    if (canvasMode !== 'edit') {
      setWorldOverlay(null)
      setHudOverlay(null)
      return
    }
    const authoring = authoringRef.current
    setWorldOverlay(authoring.overlayGeometry(LOGICAL_STAGE_VIEWPORT))
    setHudOverlay(authoring.viewportOverlayGeometry(LOGICAL_STAGE_VIEWPORT))
  }, [canvasMode, scope, view, selectionIds])

  useEffect(() => {
    const container = tryRunRef.current
    if (!container) return
    if (canvasMode !== 'run') {
      tryRunFitRef.current?.()
      tryRunFitRef.current = null
      const leftover = hostRef.current
      hostRef.current = null
      if (leftover) enqueueSerial(tryRunMountChainRef, () => leftover.destroy())
      return
    }
    return beginSerializedSessionMount(tryRunMountChainRef, () => onMountTryRun(container), {
      onReady: (mounted) => {
        hostRef.current = mounted
        tryRunFitRef.current?.()
        tryRunFitRef.current = attachPublishedCourseStageFit(container)
      },
      onCleanup: () => {
        tryRunFitRef.current?.()
        tryRunFitRef.current = null
        hostRef.current = null
      },
    })
  }, [canvasMode, onMountTryRun, view])

  useEffect(() => () => {
    enqueueSerial(tryRunMountChainRef, async () => {
      await hostRef.current?.destroy()
      hostRef.current = null
    })
  }, [])

  const assetUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    for (const [assetId, bytes] of Object.entries(assetFiles)) {
      urls[assetId] = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: assetMimeTypes[assetId] ?? 'application/octet-stream' }),
      )
    }
    return urls
  }, [assetFiles, assetMimeTypes])

  useEffect(() => () => {
    for (const url of Object.values(assetUrls)) URL.revokeObjectURL(url)
  }, [assetUrls])

  assertActiveSpatialEditorView(view)

  const editingTextNodeId = contentEdit?.kind === 'text' ? contentEdit.target.layerItemId : null
  const editingNative = editingTextNodeId
    ? spatialNativeLayerItem(view, editingTextNodeId, 'text')
    : null
  const editingNode = editingNative
    ? materializeNativeLayerItem(editingNative as NativeLayerItem)
    : null
  const formulaNative = contentEdit?.kind === 'formula'
    ? spatialNativeLayerItem(view, contentEdit.target.layerItemId, 'formula')
    : null
  const formulaNode = formulaNative
    ? materializeNativeLayerItem(formulaNative as NativeLayerItem)
    : null
  const selectedLocked = selectionIds.some((selectionId) => (
    targetIds.has(selectionId)
    && view.layers.find((layer) => layer.selectionId === selectionId)?.locked
  ))
  const worldLayerById = new Map(
    view.layers
      .filter((layer) => layer.source === 'world')
      .map((layer) => [layer.selectionId, layer.item]),
  )
  const cameraZoom = view.sessionCamera.zoom

  const syncOverlays = () => {
    const authoring = authoringRef.current
    setWorldOverlay(authoring.overlayGeometry(LOGICAL_STAGE_VIEWPORT))
    setHudOverlay(authoring.viewportOverlayGeometry(LOGICAL_STAGE_VIEWPORT))
  }

  const renderHudLayer = (
    items: typeof hudItems,
    plane: 'underlay' | 'overlay',
  ) => (
    <div
      className={`spatial-hud-layer spatial-global-${plane}-layer`}
      data-testid={plane === 'overlay' ? 'spatial-hud-layer' : 'spatial-global-underlay-layer'}
      data-global-plane={plane}
      style={{
        left: hudTransform.stageRect.x,
        top: hudTransform.stageRect.y,
        width: STAGE_VIEWPORT_WIDTH,
        height: STAGE_VIEWPORT_HEIGHT,
        transform: `scale(${hudTransform.scale})`,
        pointerEvents: 'none',
      }}
    >
      {items.map((layer) => {
        if (layer.item.kind !== 'native' && layer.item.kind !== 'component') return null
        const preview = previewById.get(layer.selectionId)
        const frame = preview ?? layer.item.frame
        const paintKind = spatialLayerPaintKind(layer.item)
        const controller = isTeacherControllerLayerItem(layer.item as LayerItem)
        const rotation = preview?.rotation ?? layer.item.rotation
        const nativeItem = asSpatialNativeLayer(layer.item as LayerItem)
        const native = nativeItem && !controller ? materializeNativeLayerItem(nativeItem) : null
        const media = native ? spatialAuthoringMedia(native, assetUrls) : null
        const size = {
          width: preview?.width ?? frame.width,
          height: preview?.height ?? frame.height,
        }
        return (
          <div
            key={layer.selectionId}
            className={`spatial-world-item spatial-world-item--${paintKind}`}
            data-hud-id={layer.selectionId}
            data-layer-item-id={layer.selectionId}
            data-global-plane={layer.globalPlane ?? undefined}
            style={{
              left: preview?.x ?? frame.x,
              top: preview?.y ?? frame.y,
              width: size.width,
              height: size.height,
              zIndex: layer.stackOrder,
              transform: !controller && rotation ? `rotate(${rotation}deg)` : undefined,
              background: controller
                ? 'transparent'
                : media
                  ? 'rgba(255,255,255,0.04)'
                  : 'rgba(23,32,51,0.88)',
              color: '#f8fafc',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              overflow: 'hidden',
            }}
          >
            {controller ? (
              <TeacherControllerAuthoringChrome
                item={layer.item as LayerItem}
                frame={{
                  x: preview?.x ?? frame.x,
                  y: preview?.y ?? frame.y,
                  width: size.width,
                  height: size.height,
                }}
                rotation={rotation}
                canvas={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
                getRenderedStageBounds={() => {
                  const bounds = stageStackRef.current?.getBoundingClientRect()
                  return {
                    width: Math.max(1, bounds?.width || CANVAS_WIDTH),
                    height: Math.max(1, bounds?.height || CANVAS_HEIGHT),
                  }
                }}
                scenes={view.navigationLocations.map((location) => ({
                  id: location.locationId,
                  name: location.label,
                }))}
                currentSceneId={view.activeLocation.locationId}
              />
            ) : layer.item.kind === 'component' ? (
              <SpatialComponentItemContent
                layerItemId={layer.selectionId}
                item={layer.item as LayerItem}
                componentPackages={componentPackages}
                assetUrls={assetUrls}
              />
            ) : (
              spatialNativePaint(layer.item as LayerItem, assetUrls, size)
            )}
          </div>
        )
      })}
    </div>
  )

  return (
    <main
      ref={workspaceRef}
      className={`workspace workspace--${canvasMode} workspace--spatial`}
      data-testid="spatial-workspace"
    >
      <div className="canvas-mode-switch" role="group" aria-label="画布模式">
        <button
          type="button"
          className={canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'edit'}
          onClick={() => onCanvasModeChange('edit')}
        >
          <MousePointer2 size={13} />编辑状态
        </button>
        <button
          type="button"
          className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'run'}
          onClick={() => onCanvasModeChange('run')}
        >
          <Play size={13} />当前位置试运行
        </button>
      </div>
      {canvasMode === 'edit' && (
        <div className="canvas-view-controls" role="group" aria-label="画布视图">
          <button
            type="button"
            aria-label="缩小画布"
            onClick={() => {
              authoringRef.current.zoomSession(
                cameraZoom - 0.1,
                LOGICAL_STAGE_VIEWPORT,
              )
            }}
          >
            <Minus size={14} />
          </button>
          <output aria-label="画布缩放比例">{Math.round(liveCamera.zoom * 100)}%</output>
          <button
            type="button"
            aria-label="放大画布"
            onClick={() => {
              authoringRef.current.zoomSession(
                cameraZoom + 0.1,
                LOGICAL_STAGE_VIEWPORT,
              )
            }}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            aria-label="适合窗口"
            title="回到首页镜头"
            onClick={() => {
              commands.run(worldTarget, {
                kind: 'fit-home-camera',
                expectedCamera: view.sessionCamera,
                expectedContentEdit: contentEdit,
              })
            }}
          >
            <Maximize2 size={14} />
          </button>
          <span title="Ctrl+滚轮缩放；拖动空白处平移画布">
            <Hand size={13} />
          </span>
        </div>
      )}
      <div className={`canvas-label${scope === 'global' ? ' canvas-label--global' : ''}`}>
        {scope === 'global'
          ? `全局层 · ${hudItems.length} 个元素`
          : `${view.surfaceTitle} · ${view.camera.activeFrame.name}`}
      </div>
      <div
        ref={viewportRef}
        className="canvas-viewport"
        data-testid="spatial-world-stage"
        style={{
          backgroundColor: 'transparent',
        }}
        onWheel={(event) => {
          if (canvasMode !== 'edit' || (!event.ctrlKey && !event.metaKey)) return
          event.preventDefault()
          authoringRef.current.zoomSession(
            cameraZoom + (event.deltaY > 0 ? -0.1 : 0.1),
            LOGICAL_STAGE_VIEWPORT,
          )
        }}
        onPointerDown={(event) => {
          if (canvasMode !== 'edit' || event.button === 2) return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          const pointer = { ...stagePoint, additive: event.shiftKey }
          const world = clientToWorld(
            createSpatialWorldViewTransform(
              LOGICAL_STAGE_VIEWPORT,
              view.sessionCamera,
            ),
            pointer,
          )
          const hudPoint = clientToWorld(
            createSpatialViewportOverlayTransform(LOGICAL_STAGE_VIEWPORT),
            pointer,
          )
          const layerHit = hitTestV9SpatialLayerItems(
            adaptV9SpatialEditorLayers(view.layers).filter((target) => (
              scope === 'global' || target.nativeType !== 'teacher-controller'
            )),
            { viewport: hudPoint, world },
          )
          if (!layerHit) {
            const graph = hitSpatialGraphAtWorld(view, world, 8 / cameraZoom)
            if (graph) {
              commands.run(worldTarget, {
                kind: 'set-graph-selection',
                selection: graph,
                expectedSelection: graphSelection,
                expectedContentEdit: contentEdit,
              })
              setWorldOverlay(null)
              return
            }
          }
          pointerActiveRef.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          const result = authoringRef.current.pointerDown(pointer, LOGICAL_STAGE_VIEWPORT)
          setPreviewFrames(result.preview ?? null)
          setPreviewCamera(result.previewCamera ?? null)
          syncOverlays()
        }}
        onPointerMove={(event) => {
          if (!pointerActiveRef.current || canvasMode !== 'edit') return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          const result = authoringRef.current.pointerMove({
            ...stagePoint,
            additive: event.shiftKey,
          }, LOGICAL_STAGE_VIEWPORT)
          setPreviewFrames(result.preview ?? null)
          setPreviewCamera(result.previewCamera ?? null)
          syncOverlays()
        }}
        onPointerUp={(event) => {
          if (!pointerActiveRef.current) return
          pointerActiveRef.current = false
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (stagePoint) {
            authoringRef.current.pointerUp({
              ...stagePoint,
              additive: event.shiftKey,
            }, LOGICAL_STAGE_VIEWPORT)
          } else {
            authoringRef.current.pointerCancel(LOGICAL_STAGE_VIEWPORT)
          }
          setPreviewFrames(null)
          setPreviewCamera(null)
          syncOverlays()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={(event) => {
          if (!pointerActiveRef.current) return
          pointerActiveRef.current = false
          authoringRef.current.pointerCancel(LOGICAL_STAGE_VIEWPORT)
          setPreviewFrames(null)
          setPreviewCamera(null)
          syncOverlays()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onDoubleClick={(event) => {
          if (canvasMode !== 'edit') return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          authoringRef.current.doubleClick(stagePoint, LOGICAL_STAGE_VIEWPORT)
        }}
      >
        <div
          ref={stageStackRef}
          className="canvas-stage-stack"
          data-testid="spatial-stage-stack"
          style={{
            left: stageTransform.stageRect.x,
            top: stageTransform.stageRect.y,
            width: STAGE_VIEWPORT_WIDTH,
            height: STAGE_VIEWPORT_HEIGHT,
            transform: `scale(${stageTransform.scale})`,
            transition: 'none',
            backgroundColor: view.backgroundColor,
          }}
        >
        {canvasMode === 'edit' && (
          <>
            {renderHudLayer(hudUnderlayItems, 'underlay')}
            <div
              className="spatial-world-layer"
              data-testid="spatial-world-layer"
              style={{
                left: worldTransform.stageRect.x,
                top: worldTransform.stageRect.y,
                transform: `scale(${worldTransform.scale})`,
              }}
            >
              <canvas
                ref={(node) => {
                  textProxyCanvasRef.current = node
                  setTextCanvas(node)
                }}
                width={1280}
                height={720}
                data-testid="spatial-text-proxy-canvas"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 1280,
                  height: 720,
                  opacity: 0,
                  pointerEvents: 'none',
                }}
              />
              {showCameraFrames && view.camera.frames.map((frame) => {
                const width = STAGE_VIEWPORT_WIDTH / frame.zoom
                const height = STAGE_VIEWPORT_HEIGHT / frame.zoom
                return (
                  <div
                    key={frame.id}
                    data-frame-id={frame.id}
                    className={`spatial-camera-frame${frame.id === view.camera.activeFrameId ? ' spatial-camera-frame--active' : ''}`}
                    style={{
                      left: frame.x - width / 2,
                      top: frame.y - height / 2,
                      width,
                      height,
                    }}
                  />
                )
              })}
              <svg className="spatial-graph-svg" aria-hidden="true">
                {view.worldGraph.paths.map((pathView) => {
                  const path = pathView.path
                  const points = path.layerItemIds.flatMap((id) => {
                    const item = worldLayerById.get(id)
                    if (!item) return []
                    const center = spatialWorldItemCenter(item)
                    return [`${center.x},${center.y}`]
                  })
                  return (
                    <polyline
                      key={pathView.pathId}
                      data-path-id={pathView.pathId}
                      points={points.join(' ')}
                      fill="none"
                      stroke={path.style?.color ?? '#3388ff'}
                      strokeWidth={path.style?.width ?? 2}
                      strokeDasharray={path.style?.dash === 'dashed' ? '8 6' : path.style?.dash === 'dotted' ? '2 6' : undefined}
                    />
                  )
                })}
                {view.worldGraph.relations.map((relationView) => {
                  const relation = relationView.relation
                  const source = worldLayerById.get(relation.sourceLayerItemId)
                  const target = worldLayerById.get(relation.targetLayerItemId)
                  if (!source || !target) return null
                  const from = spatialWorldItemCenter(source)
                  const to = spatialWorldItemCenter(target)
                  return (
                    <line
                      key={relationView.relationId}
                      data-relation-id={relationView.relationId}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="#94a3b8"
                      strokeWidth={2}
                    />
                  )
                })}
              </svg>
              {worldItems.map((layer) => {
                if (layer.item.kind !== 'native' && layer.item.kind !== 'component') return null
                const preview = previewById.get(layer.selectionId)
                const frame = preview ?? layer.item.frame
                const paintKind = spatialLayerPaintKind(layer.item)
                const rotation = preview?.rotation ?? layer.item.rotation
                const size = {
                  width: preview?.width ?? frame.width,
                  height: preview?.height ?? frame.height,
                }
                const box = spatialNativeWorldBoxStyle(layer.item as LayerItem)
                return (
                  <div
                    key={layer.selectionId}
                    className={`spatial-world-item spatial-world-item--${paintKind}`}
                    data-layer-id={layer.selectionId}
                    data-layer-item-id={layer.selectionId}
                    style={{
                      left: preview?.x ?? frame.x,
                      top: preview?.y ?? frame.y,
                      width: size.width,
                      height: size.height,
                      zIndex: layer.stackOrder,
                      transform: rotation ? `rotate(${rotation}deg)` : undefined,
                      opacity: layer.item.opacity,
                      background: box.background,
                      color: box.color,
                      fontSize: box.fontSize,
                      fontFamily: box.fontFamily,
                    }}
                  >
                    {layer.item.kind === 'component' ? (
                      <SpatialComponentItemContent
                        layerItemId={layer.selectionId}
                        item={layer.item as LayerItem}
                        componentPackages={componentPackages}
                        assetUrls={assetUrls}
                      />
                    ) : (
                      spatialNativePaint(layer.item as LayerItem, assetUrls, size)
                    )}
                  </div>
                )
              })}
            </div>
            {renderHudLayer(hudOverlayItems, 'overlay')}
            {worldOverlay && scope !== 'global' ? (
              <SpatialSelectionOverlay overlay={worldOverlay} locked={selectedLocked} />
            ) : null}
            {hudOverlay ? (
              <SpatialSelectionOverlay overlay={hudOverlay} locked={selectedLocked} />
            ) : null}
          </>
        )}
        <div
          ref={tryRunRef}
          className="spatial-try-run-host"
          data-testid="spatial-try-run-host"
          hidden={canvasMode !== 'run'}
        />
        </div>
      </div>
      {canvasMode === 'edit' && formulaNode?.type === 'formula' && (
        <FormulaEditDialog
          key={contentEdit?.courseTarget?.authoringAddress ?? formulaNode.id}
          node={formulaNode}
          onCancel={() => {
            const edit = contentEditRef.current
            if (!edit?.courseTarget) return
            const receipt = commandsRef.current.run(edit.courseTarget, {
              kind: 'cancel-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
            })
            if (receipt.ok) contentEditRef.current = null
          }}
          onCommit={(ast, accessibleText) => {
            const edit = contentEditRef.current
            if (!edit?.courseTarget || edit.kind !== 'formula') return
            const receipt = commandsRef.current.run(edit.courseTarget, {
              kind: 'commit-formula-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
              ast,
              accessibleText,
            })
            if (receipt.ok) contentEditRef.current = null
          }}
        />
      )}
      {canvasMode === 'edit' && editingNode?.type === 'text' && textCanvas && workspaceRef.current && (
        <TextEditOverlay
          key={contentEdit?.courseTarget?.authoringAddress ?? editingNode.id}
          node={editingNode}
          workspace={workspaceRef.current}
          canvas={textCanvas}
          onCompositionChange={(composing) => {
            const edit = contentEdit
            if (!edit?.courseTarget || edit.kind !== 'text') return
            const receipt = commandsRef.current.run(edit.courseTarget, {
              kind: 'set-content-edit-composing',
              expectedEdit: edit,
              expectedContentEdit: edit,
              composing,
            })
            if (receipt.ok && receipt.edit) contentEditRef.current = receipt.edit
          }}
          onPreview={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            const edit = contentEditRef.current
            if (!edit?.courseTarget || edit.kind !== 'text') return
            const receipt = commandsRef.current.run(edit.courseTarget, {
              kind: 'update-text-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
              text,
              runs,
              width: rendered?.width ?? editingNode.width,
              height: rendered?.height ?? editingNode.height,
            })
            if (receipt.ok && receipt.edit) contentEditRef.current = receipt.edit
          }}
          onCommit={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            const edit = contentEditRef.current
            if (!edit?.courseTarget || edit.kind !== 'text') return
            const receipt = commandsRef.current.run(edit.courseTarget, {
              kind: 'commit-text-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
              text,
              runs,
              width: rendered?.width ?? editingNode.width,
              height: rendered?.height ?? editingNode.height,
            })
            if (receipt.ok) contentEditRef.current = null
          }}
          onCancel={() => {
            const edit = contentEditRef.current
            if (!edit?.courseTarget) return
            const receipt = commandsRef.current.run(edit.courseTarget, {
              kind: 'cancel-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
            })
            if (receipt.ok) contentEditRef.current = null
          }}
        />
      )}
    </main>
  )
}
