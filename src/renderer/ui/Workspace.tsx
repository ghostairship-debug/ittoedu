import {
  Hand,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Minus,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  ComponentAuthoringTextTarget,
  ComponentPackageData,
} from '../../shared/componentTypes'
import { getComponentPropValue } from '../../shared/componentProps'
import type {
  ExternalComponentNode,
  FormulaNode,
  SceneDocument,
  SceneNode,
  TextNode,
} from '../../shared/projectTypes'
import type { RuntimeAuthoringTarget } from '../../shared/runtimeTypes'
import {
  PLAYER_AUTHORING_MESSAGE_TYPES,
  PLAYER_AUTHORING_PROTOCOL_VERSION,
  isPlayerAuthoringSnapshotAck,
  parsePlayerAuthoringReadyMessage,
  playerAuthoringSnapshotBarrierForCommand,
  type PlayerAuthoringPatch,
  type PlayerAuthoringPatchCommand,
  type PlayerAuthoringHostMessage,
  type PlayerAuthoringSnapshotBarrier,
  type PlayerComponentAuthoringTargetsMessage,
  type PlayerRuntimeAuthoringTargetsMessage,
} from '../../shared/playerAuthoringProtocol'
import { createEditorGame, type EditorGameHandle } from '../phaser/createEditorGame'
import { onElementAnimationPreviewRequested } from '../phaser/elementAnimationPreviewBus'
import { hitTestV9SlideLayerItems } from '../phaser/v9SlideHitAdapter'
import {
  commitV9SlideContentEdit,
  updateV9SlideContentFormulaDraft,
} from '../authoring/v9SlideContentEdit'
import {
  createSlideWorkspaceAuthoringController,
  listSlideWorkspaceHitTargets,
  mergeSlidePreviewIntoNodes,
} from './workspaceSlideAuthoring'
import {
  buildSlidePreviewRebuildKey,
  sidecarFileIdsFrom,
} from './workspaceSlidePreviewRebuild'
import {
  selectActiveScene,
  selectEditingNodes,
  selectMediaAssetFiles,
  selectSelectedNode,
  selectSlideBackendKind,
  selectSlideAuthoringBackend,
  selectSlideAuthoringDocument,
  selectActiveCourseProjectDocument,
  selectActiveCourseLocationId,
  useEditorStore,
} from '../store/editorStore'
import { TextEditOverlay } from './TextEditOverlay'
import { CanvasPlainTextEditor } from './CanvasPlainTextEditor'
import { FormulaEditDialog } from './FormulaEditDialog'
import { PublishedFormulaPaint } from './PublishedFormulaPaint'
import { renderTextNodeCanvas } from '../../shared/textLayout'
import {
  ensureScenePresentation,
  materializeScene,
} from '../../shared/presentation'
import {
  clientToWorld,
  createStageViewportTransform,
  LOGICAL_STAGE_VIEWPORT,
  rotatedRectIntersectsStage,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  STAGE_VIEWPORT_HEIGHT,
  STAGE_VIEWPORT_WIDTH,
  type StageRect,
  type StageSelectionOverlayGeometry,
} from '../authoring/stageViewportTransform'
import { createV9TeacherControllerAuthoringController } from '../authoring/v9TeacherControllerAuthoring'
import {
  commitSpatialWorldContentEdit,
  createSpatialWorldAuthoringController,
  updateSpatialWorldContentFormulaDraft,
} from '../authoring/spatialWorldAuthoring'
import {
  buildSpatialEditorView,
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
  type SpatialSessionCamera,
} from '../course/spatialEditorView'
import { type SpatialEditorWorldTransform } from '../course/spatialEditorCommands'
import { fitSpatialSessionToHomeCamera } from '../course/spatialCameraCommands'
import { mountSpatialLocationTryRun } from './spatialLocationTryRun'
import { mountFlowLocationTryRun } from './flowLocationTryRun'
import {
  mountPublishedCourseAuthoring,
  mountPublishedCourseTryRun,
  attachPublishedCourseStageFit,
} from './coursePlayerTryRun'
import {
  beginSerializedSessionMount,
  enqueueSerial,
} from './serializedSessionMount'
import type { PublishedCourseSession } from '../../player/surfaces/publishedDynamicHosts'
import { FlowWorkspace } from './FlowWorkspace'
import { TeacherControllerAuthoringChrome } from './TeacherControllerAuthoringChrome'
import {
  findComponentPackageSource,
  mountPublishedComponent,
} from '../../player/surfaces/publishedComponentMount'
import { buildFlowEditorView } from '../course/flowEditorView'
import { courseLayerItemToSceneNode } from '../store/slideEditorProjection'
import { adaptV9SpatialEditorLayers, hitTestV9SpatialLayerItems } from '../phaser/v9SpatialHitAdapter'
import { resolveCourseSurfaceBackgroundColor } from '../../shared/courseProjectModel'
import type { CourseProjectDocument, LayerItem } from '../../shared/courseProjectTypes'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import { isTeacherControllerLayerItem } from '../course/globalLayerCommands'
import { runtimeTargetMatchesEditingContext } from '../authoring/runtimeAuthoringContext'
import {
  beginComponentTextEditSession,
  componentTextEditSessionMatchesContext,
  componentTextTargetMatchesSession,
  resolveComponentTextEdit,
  type ComponentTextEditContext,
  type ComponentTextEditSession,
} from '../authoring/componentTextEditSession'
import { isAuthoringCanvasInteractive } from '../authoring/authoringReadiness'
import {
  beginRuntimeTargetEditSession,
  runtimeTargetEditSessionMatchesContext,
  runtimeTargetMatchesEditSession,
  validateRuntimeTargetEditSession,
  type RuntimeTargetEditContext,
  type RuntimeTargetEditSession,
} from '../authoring/runtimeTargetEditSession'
import type { CourseRuntimeContentTextTarget } from '../runtime/runtimeContentTextAuthoringCommands'
import type { ImportedImageAsset } from '../project/assetManager'

interface WorkspaceProps {
  onAddImage(x?: number, y?: number): void
  onAddVideo(x?: number, y?: number): void
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
}

interface FormulaEditSession {
  projectId: string
  scope: 'scene' | 'global'
  sceneId: string
  stateId: string | null
  nodeId: string
}

interface WorkspaceRuntimeTextEditSession {
  readonly liveSession: Readonly<RuntimeTargetEditSession>
  readonly courseTarget: CourseRuntimeContentTextTarget
}

function nodesEqual(
  previous: SceneDocument['nodes'][number],
  next: SceneDocument['nodes'][number],
) {
  return JSON.stringify(previous) === JSON.stringify(next)
}

function withDirectionAwareTextAutoSize(
  node: SceneNode | undefined,
  patch: Partial<Pick<SceneNode, 'x' | 'y' | 'width' | 'height' | 'rotation'>>,
): typeof patch {
  if (node?.type !== 'text' || node.style.overflow !== 'auto-height') {
    return patch
  }
  const candidate = {
    ...node,
    ...patch,
  }
  const rendered = renderTextNodeCanvas(candidate, candidate.width)
  return {
    ...patch,
    width: rendered.width,
    height: rendered.height,
  }
}

function pointInsideRotatedBounds(
  point: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
  rotation: number,
): boolean {
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  const radians = -rotation * Math.PI / 180
  const dx = point.x - centerX
  const dy = point.y - centerY
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
  return Math.abs(localX) <= bounds.width / 2 &&
    Math.abs(localY) <= bounds.height / 2
}

function pointInsideSceneNode(
  point: { x: number; y: number },
  node: SceneNode,
): boolean {
  return node.visible && pointInsideRotatedBounds(point, node, node.rotation)
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

type RuntimePreviewFeedback = {
  kind: 'loading' | 'error'
  title: string
  message: string
} | null

function sanitizeRuntimeAuthoringTargets(
  update: PlayerRuntimeAuthoringTargetsMessage['update'],
  hostKey: string,
): ReadonlyArray<Readonly<RuntimeAuthoringTarget>> {
  if (
    (update.scope !== 'scene' && update.scope !== 'global') ||
    (update.scope === 'scene' &&
      (typeof update.sceneId !== 'string' || !update.sceneId.trim()))
  ) {
    return []
  }
  const sanitized: RuntimeAuthoringTarget[] = []
  for (const candidate of update.targets) {
    if (
      !candidate ||
      candidate.scope !== update.scope ||
      candidate.sceneId !== update.sceneId ||
      (candidate.kind !== 'text' && candidate.kind !== 'asset') ||
      (candidate.layer !== 'underlay' && candidate.layer !== 'overlay') ||
      (candidate.source !== 'registered' && candidate.source !== 'dom') ||
      typeof candidate.targetId !== 'string' ||
      !candidate.targetId ||
      candidate.targetId.length > 256 ||
      typeof candidate.nodeId !== 'string' ||
      !candidate.nodeId ||
      candidate.nodeId.length > 256 ||
      typeof candidate.key !== 'string' ||
      !candidate.key ||
      candidate.key.length > 256
    ) {
      continue
    }
    if (!candidate.bounds || typeof candidate.bounds !== 'object') continue
    const { x, y, width, height } = candidate.bounds
    if (![x, y, width, height].every(Number.isFinite)) continue
    const left = Math.max(0, x)
    const top = Math.max(0, y)
    const right = Math.min(STAGE_VIEWPORT_WIDTH, x + width)
    const bottom = Math.min(STAGE_VIEWPORT_HEIGHT, y + height)
    if (right <= left || bottom <= top) continue
    sanitized.push(Object.freeze({
      ...candidate,
      targetId: `${hostKey}:${candidate.nodeId}:${candidate.targetId}`,
      ...(typeof candidate.label === 'string'
        ? { label: candidate.label.slice(0, 120) }
        : { label: undefined }),
      bounds: Object.freeze({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      }),
    }))
  }
  return Object.freeze(sanitized)
}

function sanitizeComponentAuthoringTargets(
  update: PlayerComponentAuthoringTargetsMessage['update'],
  hostKey: string,
): ReadonlyArray<Readonly<ComponentAuthoringTextTarget>> {
  if (
    (update.scope !== 'scene' && update.scope !== 'global') ||
    typeof update.nodeId !== 'string' ||
    !update.nodeId ||
    update.nodeId.length > 256 ||
    (update.scope === 'scene' &&
      (typeof update.sceneId !== 'string' || !update.sceneId.trim()))
  ) {
    return []
  }
  const sanitized: ComponentAuthoringTextTarget[] = []
  for (const candidate of update.targets) {
    if (
      !candidate ||
      candidate.kind !== 'component-text' ||
      candidate.scope !== update.scope ||
      candidate.sceneId !== update.sceneId ||
      candidate.nodeId !== update.nodeId ||
      (candidate.source !== 'registered' && candidate.source !== 'dom') ||
      typeof candidate.targetId !== 'string' ||
      !candidate.targetId ||
      candidate.targetId.length > 256 ||
      typeof candidate.componentId !== 'string' ||
      !candidate.componentId ||
      candidate.componentId.length > 256 ||
      typeof candidate.key !== 'string' ||
      !candidate.key ||
      candidate.key.length > 256 ||
      typeof candidate.multiline !== 'boolean' ||
      !Number.isFinite(candidate.rotation)
    ) {
      continue
    }
    if (!candidate.bounds || typeof candidate.bounds !== 'object') continue
    const { x, y, width, height } = candidate.bounds
    if (
      ![x, y, width, height].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0
    ) {
      continue
    }
    if (!rotatedRectIntersectsStage(candidate.bounds, candidate.rotation)) {
      continue
    }
    const maxLength = candidate.maxLength
    sanitized.push(Object.freeze({
      ...candidate,
      targetId: `component:${hostKey}:${candidate.targetId}`,
      label: typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.slice(0, 120)
        : candidate.key.slice(0, 120),
      ...(
        maxLength === undefined ||
        (Number.isSafeInteger(maxLength) && maxLength > 0 && maxLength <= 1_000_000)
          ? { maxLength }
          : { maxLength: undefined }
      ),
      bounds: Object.freeze({
        x,
        y,
        width,
        height,
      }),
    }))
  }
  return Object.freeze(sanitized)
}

type CanvasAuthoringHit =
  | { kind: 'runtime'; target: Readonly<RuntimeAuthoringTarget> }
  | { kind: 'component'; target: Readonly<ComponentAuthoringTextTarget> }

function controllerGestureConsumed(
  overlay: StageSelectionOverlayGeometry | null | undefined,
  preview: unknown,
  target: unknown,
): boolean {
  return Boolean(overlay && (preview || target))
}

function TeacherControllerAuthoringOverlay({
  overlay,
}: {
  overlay: StageSelectionOverlayGeometry
}) {
  const box = overlay.selectionBox
  return (
    <div
      className="teacher-controller-overlay"
      data-testid="teacher-controller-overlay"
      aria-hidden="true"
    >
      <div
        className="teacher-controller-overlay__box"
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
        }}
      />
      {STAGE_RESIZE_HANDLE_DIRECTIONS.map((direction) => {
        const point = overlay.handles[direction]
        return (
          <div
            key={direction}
            className="teacher-controller-overlay__handle"
            data-handle={direction}
            style={{ left: point.x - 4, top: point.y - 4 }}
          />
        )
      })}
    </div>
  )
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

function spatialWorldItemCenter(item: LayerItem) {
  return {
    x: item.frame.x + item.frame.width / 2,
    y: item.frame.y + item.frame.height / 2,
  }
}

function hitSpatialGraphAtWorld(
  session: { history: { present: CourseProjectDocument }; selection: { surfaceId: string } },
  world: { x: number; y: number },
  threshold: number,
) {
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId && candidate.type === 'spatial-2d',
  )
  if (!surface || surface.type !== 'spatial-2d') return null
  const items = new Map(surface.world.layerItems.map((item) => [item.layerItemId, item]))
  for (const relation of [...(surface.world.relations ?? [])].reverse()) {
    const source = items.get(relation.sourceLayerItemId)
    const target = items.get(relation.targetLayerItemId)
    if (!source || !target) continue
    if (distanceToSegment(world, spatialWorldItemCenter(source), spatialWorldItemCenter(target)) <= threshold) {
      return { kind: 'relation' as const, id: relation.id }
    }
  }
  for (const path of [...(surface.world.paths ?? [])].reverse()) {
    const points = path.layerItemIds.flatMap((id) => {
      const item = items.get(id)
      return item ? [spatialWorldItemCenter(item)] : []
    })
    for (let index = 1; index < points.length; index += 1) {
      if (distanceToSegment(world, points[index - 1]!, points[index]!) <= threshold) {
        return { kind: 'path' as const, id: path.id }
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
  node: SceneNode,
  assetUrls: Readonly<Record<string, string>>,
) {
  if (node.type === 'image') {
    const src = assetUrls[node.assetId]
    return src
      ? <img src={src} alt="" draggable={false} style={SPATIAL_MEDIA_FILL} />
      : (node.name || node.type)
  }
  if (node.type === 'video') {
    const src = assetUrls[node.assetId]
    const poster = node.poster.mode === 'image' && node.poster.assetId
      ? assetUrls[node.poster.assetId]
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
    return node.name || node.type
  }
  return null
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

function SpatialLocationWorkspace({
  onAddImage,
  onAddVideo,
}: WorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageStackRef = useRef<HTMLDivElement>(null)
  const tryRunRef = useRef<HTMLDivElement>(null)
  const tryRunMountChainRef = useRef(Promise.resolve())
  const tryRunFitRef = useRef<(() => void) | null>(null)
  const textProxyCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const hostRef = useRef<PublishedCourseSession | null>(null)
  const pointerActiveRef = useRef(false)
  const session = useEditorStore((state) => state.spatialSession)
  const canvasMode = useEditorStore((state) => state.canvasMode)
  const editingScope = useEditorStore((state) => state.editingScope)
  const selectedNode = useEditorStore(selectSelectedNode)
  const editingTextNodeId = useEditorStore((state) => state.editingTextNodeId)
  const spatialContentEdit = useEditorStore((state) => state.spatialContentEdit)
  const playbackPathId = useEditorStore((state) => state.spatialPlaybackPathId)
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore((state) => state.componentPackages)
  const setCanvasMode = useEditorStore((state) => state.setCanvasMode)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 450 })
  const [previewFrames, setPreviewFrames] = useState<readonly SpatialEditorWorldTransform[] | null>(null)
  const [previewCamera, setPreviewCamera] = useState<SpatialSessionCamera | null>(null)
  const [worldOverlay, setWorldOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const [hudOverlay, setHudOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const [textCanvas, setTextCanvas] = useState<HTMLCanvasElement | null>(null)

  const authoringRef = useRef(createSpatialWorldAuthoringController({
    getSession: () => {
      const current = useEditorStore.getState().spatialSession
      if (!current) throw new Error('not-spatial-session')
      return current
    },
    setSession: (next) => {
      const previous = useEditorStore.getState().spatialSession
      useEditorStore.getState().applySpatialAuthoringSession(next, {
        historyEntry: Boolean(
          previous && next.history.present.revision !== previous.history.present.revision,
        ),
      })
    },
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

  const liveCamera = previewCamera ?? session?.sessionCamera ?? { x: 0, y: 0, zoom: 1 }
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

  const view = session
    ? buildSpatialEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
    })
    : null
  const surface = session?.history.present.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId && candidate.type === 'spatial-2d',
  )
  const worldItems = view?.layers.filter((layer) => layer.coordinateSpace === 'world') ?? []
  const hudItems = view?.layers.filter((layer) => layer.coordinateSpace === 'viewport') ?? []
  const previewById = new Map((previewFrames ?? []).map((frame) => [frame.layerItemId, frame]))

  useEffect(() => {
    if (!session || canvasMode !== 'edit') {
      setWorldOverlay(null)
      setHudOverlay(null)
      return
    }
    const authoring = authoringRef.current
    setWorldOverlay(authoring.overlayGeometry(LOGICAL_STAGE_VIEWPORT))
    setHudOverlay(authoring.viewportOverlayGeometry(LOGICAL_STAGE_VIEWPORT))
  }, [canvasMode, editingScope, selectedNode, session, session?.selection.selectionIds, session?.sessionCamera, session?.history.present.revision])

  useEffect(() => {
    const container = tryRunRef.current
    if (!session || !container) return
    if (canvasMode !== 'run') {
      tryRunFitRef.current?.()
      tryRunFitRef.current = null
      const leftover = hostRef.current
      hostRef.current = null
      if (leftover) enqueueSerial(tryRunMountChainRef, () => leftover.destroy())
      return
    }
    return beginSerializedSessionMount(tryRunMountChainRef, () => mountPublishedCourseTryRun({
      container,
      project: session.history.present,
      assetFiles: sidecarFiles,
      components: componentPackages,
      locationId: session.selection.locationId,
      playbackPathId,
    }), {
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
  }, [canvasMode, componentPackages, playbackPathId, session, sidecarFiles])

  useEffect(() => () => {
    enqueueSerial(tryRunMountChainRef, async () => {
      await hostRef.current?.destroy()
      hostRef.current = null
    })
  }, [])

  const assetUrls = useMemo(() => {
    const urls: Record<string, string> = {}
    if (!session) return urls
    for (const [assetId, bytes] of Object.entries(sidecarFiles)) {
      const meta = session.history.present.assets[assetId]
      urls[assetId] = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: meta?.mimeType ?? 'application/octet-stream' }),
      )
    }
    return urls
  }, [session, sidecarFiles])

  useEffect(() => () => {
    for (const url of Object.values(assetUrls)) URL.revokeObjectURL(url)
  }, [assetUrls])

  if (!session || !view || !surface || surface.type !== 'spatial-2d') return null

  const editingNode = editingTextNodeId
    ? selectEditingNodes(useEditorStore.getState()).find((node) => node.id === editingTextNodeId)
    : null
  const formulaNode = spatialContentEdit?.kind === 'formula'
    ? selectEditingNodes(useEditorStore.getState()).find((node) => node.id === spatialContentEdit.target.layerItemId)
    : null
  const selectedLocked = Boolean(selectedNode?.locked)

  const syncOverlays = () => {
    const authoring = authoringRef.current
    setWorldOverlay(authoring.overlayGeometry(LOGICAL_STAGE_VIEWPORT))
    setHudOverlay(authoring.viewportOverlayGeometry(LOGICAL_STAGE_VIEWPORT))
  }

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
          onClick={() => setCanvasMode('edit')}
        >
          <MousePointer2 size={13} />编辑状态
        </button>
        <button
          type="button"
          className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'run'}
          onClick={() => setCanvasMode('run')}
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
                session.sessionCamera.zoom - 0.1,
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
                session.sessionCamera.zoom + 0.1,
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
            onClick={() => useEditorStore.getState().runSpatialCommand((current) => fitSpatialSessionToHomeCamera(current))}
          >
            <Maximize2 size={14} />
          </button>
          <span title="Ctrl+滚轮缩放；拖动空白处平移画布">
            <Hand size={13} />
          </span>
        </div>
      )}
      <div className={`canvas-label${editingScope === 'global' ? ' canvas-label--global' : ''}`}>
        {editingScope === 'global'
          ? `全局层 · ${hudItems.length} 个元素`
          : `${view.surfaceTitle} · ${view.camera.frames.find((frame) => frame.id === view.camera.activeFrameId)?.name ?? '镜头'}`}
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
            session.sessionCamera.zoom + (event.deltaY > 0 ? -0.1 : 0.1),
            LOGICAL_STAGE_VIEWPORT,
          )
        }}
        onPointerDown={(event) => {
          if (canvasMode !== 'edit' || event.button === 2) return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          const pointer = { ...stagePoint, additive: event.shiftKey }
          const world = clientToWorld(
            createSpatialWorldViewTransform(LOGICAL_STAGE_VIEWPORT, session.sessionCamera),
            pointer,
          )
          const hudPoint = clientToWorld(
            createSpatialViewportOverlayTransform(LOGICAL_STAGE_VIEWPORT),
            pointer,
          )
          const layerHit = hitTestV9SpatialLayerItems(
            adaptV9SpatialEditorLayers(view.layers).filter((target) => (
              editingScope === 'global' || target.nativeType !== 'teacher-controller'
            )),
            { viewport: hudPoint, world },
          )
          if (!layerHit) {
            const graph = hitSpatialGraphAtWorld(session, world, 8 / session.sessionCamera.zoom)
            if (graph) {
              useEditorStore.getState().setSpatialGraphSelection(graph)
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
            authoringRef.current.pointerCancel({ x: 0, y: 0 }, LOGICAL_STAGE_VIEWPORT)
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
          const stagePoint = readLogicalPointer(event.clientX, event.clientY) ?? { x: 0, y: 0 }
          authoringRef.current.pointerCancel(stagePoint, LOGICAL_STAGE_VIEWPORT)
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
          const result = authoringRef.current.doubleClick(stagePoint, LOGICAL_STAGE_VIEWPORT)
          if (result.contentEdit?.ok && result.hit) {
            useEditorStore.getState().beginTextEdit(result.hit.layerItemId, 'canvas')
          }
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
            backgroundColor: resolveCourseSurfaceBackgroundColor(surface.backgroundColor),
          }}
        >
        {canvasMode === 'edit' && (
          <>
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
              {session.showCameraFrames && view.camera.frames.map((frame) => {
                const width = STAGE_VIEWPORT_WIDTH / frame.zoom
                const height = STAGE_VIEWPORT_HEIGHT / frame.zoom
                return (
                  <div
                    key={frame.id}
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
                {(surface.world.paths ?? []).map((path) => {
                  const points = path.layerItemIds.flatMap((id) => {
                    const item = surface.world.layerItems.find((candidate) => candidate.layerItemId === id)
                    if (!item) return []
                    const center = spatialWorldItemCenter(item)
                    return [`${center.x},${center.y}`]
                  })
                  return (
                    <polyline
                      key={path.id}
                      points={points.join(' ')}
                      fill="none"
                      stroke={path.style?.color ?? '#3388ff'}
                      strokeWidth={path.style?.width ?? 2}
                      strokeDasharray={path.style?.dash === 'dashed' ? '8 6' : path.style?.dash === 'dotted' ? '2 6' : undefined}
                    />
                  )
                })}
                {(surface.world.relations ?? []).map((relation) => {
                  const source = surface.world.layerItems.find((item) => item.layerItemId === relation.sourceLayerItemId)
                  const target = surface.world.layerItems.find((item) => item.layerItemId === relation.targetLayerItemId)
                  if (!source || !target) return null
                  const from = spatialWorldItemCenter(source)
                  const to = spatialWorldItemCenter(target)
                  return (
                    <line
                      key={relation.id}
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
                const preview = previewById.get(layer.selectionId)
                const frame = preview ?? layer.item.frame
                const node = courseLayerItemToSceneNode(layer.item as LayerItem)
                if (!node) return null
                const rotation = preview?.rotation ?? layer.item.rotation
                return (
                  <div
                    key={layer.selectionId}
                    className={`spatial-world-item spatial-world-item--${node.type}`}
                    data-layer-id={layer.selectionId}
                    style={{
                      left: preview?.x ?? frame.x,
                      top: preview?.y ?? frame.y,
                      width: preview?.width ?? frame.width,
                      height: preview?.height ?? frame.height,
                      transform: rotation ? `rotate(${rotation}deg)` : undefined,
                      opacity: layer.item.opacity,
                      background: node.type === 'shape'
                        ? node.style.fillColor
                        : node.type === 'text'
                          ? 'transparent'
                          : 'rgba(255,255,255,0.04)',
                      color: node.type === 'text' ? node.style.color : '#e2e8f0',
                      fontSize: node.type === 'text' ? node.style.fontSize : 14,
                      fontFamily: node.type === 'text' ? node.style.fontFamily : undefined,
                    }}
                  >
                    {layer.item.kind === 'component' ? (
                      <SpatialComponentItemContent
                        layerItemId={layer.selectionId}
                        item={layer.item as LayerItem}
                        componentPackages={componentPackages}
                        assetUrls={assetUrls}
                      />
                    ) : node.type === 'text' ? node.text
                      : node.type === 'formula' ? (
                        <PublishedFormulaPaint
                          formulaId={node.formulaId}
                          accessibleText={node.accessibleText}
                          ast={node.ast}
                          style={node.style}
                          width={Math.max(1, preview?.width ?? frame.width)}
                          height={Math.max(1, preview?.height ?? frame.height)}
                          lockHeight
                        />
                      )
                      : spatialAuthoringMedia(node, assetUrls)
                        ?? (node.type === 'external-component' ? node.name || '组件' : node.name || node.type)}
                  </div>
                )
              })}
            </div>
            <div
              className="spatial-hud-layer"
              data-testid="spatial-hud-layer"
              style={{
                left: hudTransform.stageRect.x,
                top: hudTransform.stageRect.y,
                width: STAGE_VIEWPORT_WIDTH,
                height: STAGE_VIEWPORT_HEIGHT,
                transform: `scale(${hudTransform.scale})`,
                pointerEvents: 'none',
              }}
            >
              {hudItems.map((layer) => {
                const preview = previewById.get(layer.selectionId)
                const frame = preview ?? layer.item.frame
                const node = courseLayerItemToSceneNode(layer.item as LayerItem)
                if (!node) return null
                const controller = isTeacherControllerLayerItem(layer.item as LayerItem)
                const rotation = preview?.rotation ?? layer.item.rotation
                const media = controller ? null : spatialAuthoringMedia(node, assetUrls)
                return (
                  <div
                    key={layer.selectionId}
                    className={`spatial-world-item spatial-world-item--${node.type}`}
                    data-hud-id={layer.selectionId}
                    style={{
                      left: preview?.x ?? frame.x,
                      top: preview?.y ?? frame.y,
                      width: preview?.width ?? frame.width,
                      height: preview?.height ?? frame.height,
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
                          width: preview?.width ?? frame.width,
                          height: preview?.height ?? frame.height,
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
                        scenes={session.history.present.locations.map((location) => ({
                          id: location.id,
                          name: location.label,
                        }))}
                        currentSceneId={session.selection.locationId}
                      />
                    ) : layer.item.kind === 'component' ? (
                      <SpatialComponentItemContent
                        layerItemId={layer.selectionId}
                        item={layer.item as LayerItem}
                        componentPackages={componentPackages}
                        assetUrls={assetUrls}
                      />
                    ) : node.type === 'formula' ? (
                      <PublishedFormulaPaint
                        formulaId={node.formulaId}
                        accessibleText={node.accessibleText}
                        ast={node.ast}
                        style={node.style}
                        width={Math.max(1, preview?.width ?? frame.width)}
                        height={Math.max(1, preview?.height ?? frame.height)}
                        lockHeight
                      />
                    ) : (
                      media ?? (node.name || node.type)
                    )}
                  </div>
                )
              })}
            </div>
            {worldOverlay && editingScope !== 'global' ? (
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
          key={formulaNode.id}
          node={formulaNode}
          onCancel={() => useEditorStore.getState().cancelTextEdit()}
          onCommit={(ast, accessibleText) => {
            const store = useEditorStore.getState()
            if (store.spatialContentEdit?.kind === 'formula') {
              const edited = updateSpatialWorldContentFormulaDraft(store.spatialContentEdit, {
                ast,
                accessibleText,
              })
              store.runSpatialCommand(
                (current) => commitSpatialWorldContentEdit(current, edited),
                { clearContentEdit: true },
              )
              return
            }
            store.updateNode(formulaNode.id, { ast, accessibleText })
          }}
        />
      )}
      {canvasMode === 'edit' && editingNode?.type === 'text' && textCanvas && workspaceRef.current && (
        <TextEditOverlay
          key={editingNode.id}
          node={editingNode}
          workspace={workspaceRef.current}
          canvas={textCanvas}
          onPreview={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            useEditorStore.getState().updateTextEditDraft(
              editingNode.id,
              text,
              runs,
              rendered?.height ?? editingNode.height,
              rendered?.width ?? editingNode.width,
            )
          }}
          onCommit={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            const store = useEditorStore.getState()
            store.updateTextEditDraft(
              editingNode.id,
              text,
              runs,
              rendered?.height ?? editingNode.height,
              rendered?.width ?? editingNode.width,
            )
            store.commitTextEdit()
          }}
          onCancel={() => useEditorStore.getState().cancelTextEdit()}
        />
      )}
    </main>
  )
}

function FlowLocationWorkspace(_props: WorkspaceProps) {
  const tryRunRef = useRef<HTMLDivElement>(null)
  const tryRunMountChainRef = useRef(Promise.resolve())
  const hostRef = useRef<PublishedCourseSession | null>(null)
  const tryRunFitRef = useRef<(() => void) | null>(null)
  const session = useEditorStore((state) => state.flowSession)
  const canvasMode = useEditorStore((state) => state.canvasMode)
  const editingScope = useEditorStore((state) => state.editingScope)
  const sidecarFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore((state) => state.componentPackages)
  const setCanvasMode = useEditorStore((state) => state.setCanvasMode)
  const view = session
    ? buildFlowEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
    })
    : null

  useEffect(() => {
    const container = tryRunRef.current
    if (!session || !container) return
    if (canvasMode !== 'run') {
      tryRunFitRef.current?.()
      tryRunFitRef.current = null
      const leftover = hostRef.current
      hostRef.current = null
      if (leftover) enqueueSerial(tryRunMountChainRef, () => leftover.destroy())
      return
    }
    return beginSerializedSessionMount(tryRunMountChainRef, () => mountPublishedCourseTryRun({
      container,
      project: session.history.present,
      assetFiles: sidecarFiles,
      components: componentPackages,
      locationId: session.selection.locationId,
    }), {
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
  }, [canvasMode, componentPackages, session, sidecarFiles])

  useEffect(() => () => {
    enqueueSerial(tryRunMountChainRef, async () => {
      await hostRef.current?.destroy()
      hostRef.current = null
    })
  }, [])

  if (!session || !view) return null

  return (
    <main
      className={`workspace workspace--${canvasMode} workspace--flow`}
      data-testid="flow-workspace-shell"
      data-flow-not-slide-stage="true"
    >
      <div className="canvas-mode-switch" role="group" aria-label="画布模式">
        <button
          type="button"
          className={canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'edit'}
          onClick={() => setCanvasMode('edit')}
        >
          <MousePointer2 size={13} />编辑状态
        </button>
        <button
          type="button"
          className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'run'}
          onClick={() => setCanvasMode('run')}
        >
          <Play size={13} />当前位置试运行
        </button>
      </div>
      <div className={`canvas-label${editingScope === 'global' ? ' canvas-label--global' : ''}`}>
        {editingScope === 'global' ? '全局层 · 视口浮层' : view.surfaceTitle}
      </div>
      <div className="canvas-viewport">
        {canvasMode === 'edit' ? (
          <FlowWorkspace
            project={session.history.present}
            view={view}
            selection={session.selection}
            onProjectChange={(result) => {
              useEditorStore.getState().applyFlowCommand(result)
            }}
            onDeleteRequest={(request) => (
              useEditorStore.getState().deleteFlowSelection(request)
            )}
            onSelectionChange={(next) => {
              useEditorStore.getState().applyFlowSelection(next)
            }}
            onTextEditChange={(edit) => {
              useEditorStore.getState().setFlowTextEdit(edit)
            }}
          />
        ) : null}
        <div
          ref={tryRunRef}
          className="flow-try-run-host"
          data-testid="flow-try-run-host"
          hidden={canvasMode !== 'run'}
        />
      </div>
    </main>
  )
}

export function Workspace({
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
}: WorkspaceProps) {
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const flowSession = useEditorStore((state) => state.flowSession)
  // Do not key these hosts by locationId/generation. R6-Z did, and every tree
  // click (including the current page) remounted Phaser and the visual host,
  // flashing the startup overlay in edit mode.
  // Surface kind already switches the component type; same-surface scene
  // changes go through activateScene / host subscriptions.
  if (spatialSession) {
    return (
      <SpatialLocationWorkspace
        onAddImage={onAddImage}
        onAddVideo={onAddVideo}
        onSelectImageAsset={onSelectImageAsset}
      />
    )
  }
  if (flowSession) {
    return (
      <FlowLocationWorkspace
        onAddImage={onAddImage}
        onAddVideo={onAddVideo}
        onSelectImageAsset={onSelectImageAsset}
      />
    )
  }
  return (
    <SlideLocationWorkspace
      onAddImage={onAddImage}
      onAddVideo={onAddVideo}
      onSelectImageAsset={onSelectImageAsset}
    />
  )
}

function SlideLocationWorkspace({
  onAddImage,
  onAddVideo,
  onSelectImageAsset,
}: WorkspaceProps) {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const stageViewportRef = useRef<HTMLDivElement>(null)
  const gameHostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<EditorGameHandle | null>(null)
  const publishedAuthoringHostRef = useRef<HTMLDivElement>(null)
  const publishedAuthoringSessionRef = useRef<PublishedCourseSession | null>(null)
  const publishedAuthoringMountChainRef = useRef(Promise.resolve())
  const publishedAuthoringInitRef = useRef<{
    token: string
    initialSceneId: string
    initialStateId: string | null
    editingScope: 'scene' | 'global'
  } | null>(null)
  const previousSceneRef = useRef<SceneDocument | null>(null)
  const previousComponentPackagesRef = useRef<
    Record<string, ComponentPackageData> | null
  >(null)
  const authoringReadyRef = useRef(false)
  const authoringRevisionRef = useRef(0)
  const authoringSnapshotBarrierRef =
    useRef<PlayerAuthoringSnapshotBarrier | null>(null)
  const lastAuthoringTargetsRevisionRef = useRef(-1)
  const pendingAuthoringNodesRef = useRef(new Map<string, {
    scope: 'scene' | 'global'
    node: SceneNode
  }>())
  const authoringFrameRef = useRef<number | null>(null)
  const runtimeTargetsByHostRef = useRef(new Map<
    string,
    ReadonlyArray<Readonly<RuntimeAuthoringTarget>>
  >())
  const componentTargetsByHostRef = useRef(new Map<
    string,
    ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>
  >())
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [previewFeedback, setPreviewFeedback] = useState<RuntimePreviewFeedback>(null)
  const [previewRetryRevision, setPreviewRetryRevision] = useState(0)
  const [acknowledgedPreviewGeneration, setAcknowledgedPreviewGeneration] =
    useState<object | null>(null)
  const [runtimeTargets, setRuntimeTargets] =
    useState<ReadonlyArray<Readonly<RuntimeAuthoringTarget>>>([])
  const [componentTargets, setComponentTargets] =
    useState<ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>>([])
  const [activeRuntimeTextSession, setActiveRuntimeTextSession] =
    useState<Readonly<WorkspaceRuntimeTextEditSession> | null>(null)
  const [activeComponentTextSession, setActiveComponentTextSession] =
    useState<Readonly<ComponentTextEditSession> | null>(null)
  const [activeFormulaEditSession, setActiveFormulaEditSession] =
    useState<Readonly<FormulaEditSession> | null>(null)
  const [replacingRuntimeAssetTargetId, setReplacingRuntimeAssetTargetId] =
    useState<string | null>(null)
  const [hoveredAuthoringTargetId, setHoveredAuthoringTargetId] =
    useState<string | null>(null)
  const [stageViewportSize, setStageViewportSize] = useState({
    width: STAGE_VIEWPORT_WIDTH,
    height: STAGE_VIEWPORT_HEIGHT,
  })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const spacePressedRef = useRef(false)
  const slideAuthoringRef = useRef(createSlideWorkspaceAuthoringController())
  const controllerAuthoringRef = useRef(createV9TeacherControllerAuthoringController())
  const candidatePointerActiveRef = useRef(false)
  const controllerPointerActiveRef = useRef(false)
  const courseTryRunRef = useRef<HTMLDivElement>(null)
  const courseTryRunSessionRef = useRef<PublishedCourseSession | null>(null)
  const courseTryRunFitRef = useRef<(() => void) | null>(null)
  const courseTryRunMountChainRef = useRef(Promise.resolve())
  const [tryRunFeedback, setTryRunFeedback] = useState<RuntimePreviewFeedback>(null)
  const [tryRunEpoch, setTryRunEpoch] = useState(0)
  const [controllerOverlay, setControllerOverlay] =
    useState<StageSelectionOverlayGeometry | null>(null)
  const slideBackendKind = useEditorStore(selectSlideBackendKind)
  const candidateDocument = useEditorStore(selectSlideAuthoringDocument)
  const candidateSidecar = useEditorStore((state) => state.slideCandidateSidecar)
  const panRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    originX: number
    originY: number
  } | null>(null)

  const scene = useEditorStore(selectActiveScene)
  const editingScope = useEditorStore((state) => state.editingScope)
  const canvasMode = useEditorStore((state) => state.canvasMode)
  const courseDocument = useEditorStore(selectActiveCourseProjectDocument)
  const courseLocationId = useEditorStore(selectActiveCourseLocationId)
  const courseSidecarFiles = useEditorStore(selectMediaAssetFiles)
  const componentPackages = useEditorStore(
    (state) => state.componentPackages,
  )
  const useCoursePlayerTryRun = Boolean(courseDocument && canvasMode === 'run')
  const usePublishedAuthoring = Boolean(courseDocument && canvasMode === 'edit')
  const tryRunMountKey = useMemo(() => {
    if (!courseDocument) return null
    return JSON.stringify({
      id: courseDocument.id,
      revision: courseDocument.revision,
      sidecar: Object.keys(courseSidecarFiles).sort(),
      packages: Object.keys(componentPackages).sort(),
    })
  }, [componentPackages, courseDocument, courseSidecarFiles])
  const activePresentationStateId = useEditorStore(
    (state) => state.activePresentationStateId,
  )
  const editingNodes = useEditorStore(selectEditingNodes)
  const v8GlobalLayer = useEditorStore(
    (state) => state.project.globalLayer,
  )
  const globalLayer = useMemo(() => {
    if (!courseDocument) return v8GlobalLayer
    return courseDocument.globalLayerItems.flatMap((entry) => {
      const node = courseLayerItemToSceneNode(entry.item)
      return node
        ? [{
            node,
            layer: 'overlay' as const,
            // Global-scope authoring intentionally lists every stored item.
            // Published V2 remains the authority for location applicability.
            visibility: { mode: 'all' as const, sceneIds: [] },
          }]
        : []
    })
  }, [courseDocument, v8GlobalLayer])
  const selectedNode = useEditorStore(selectSelectedNode)
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const editingTextNodeId = useEditorStore(
    (state) => state.editingTextNodeId,
  )
  const project = useEditorStore((state) => state.project)
  const assetFiles = useEditorStore((state) => state.assetFiles)
  const setCanvasMode = useEditorStore((state) => state.setCanvasMode)
  const readCandidateViewport = useCallback(() => {
    const viewport = stageViewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      viewport: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      zoom: view.zoom,
      pan: { x: view.x, y: view.y },
    }
  }, [view.x, view.y, view.zoom])

  useEffect(() => {
    if (
      slideBackendKind !== 'slide-authoring' ||
      canvasMode !== 'edit' ||
      editingScope !== 'global'
    ) {
      setControllerOverlay(null)
      return
    }
    if (controllerPointerActiveRef.current) return
    const viewport = readCandidateViewport()
    if (!viewport) return
    if (selectedNode?.type === 'teacher-controller') {
      setControllerOverlay(controllerAuthoringRef.current.overlayGeometry(viewport))
      return
    }
    setControllerOverlay(null)
  }, [
    canvasMode,
    candidateDocument,
    editingScope,
    readCandidateViewport,
    selectedNode,
    slideBackendKind,
  ])

  const stageTransform = useMemo(() => createStageViewportTransform({
    viewport: {
      x: 0,
      y: 0,
      width: stageViewportSize.width,
      height: stageViewportSize.height,
    },
    zoom: view.zoom,
    pan: { x: view.x, y: view.y },
  }), [stageViewportSize.height, stageViewportSize.width, view.x, view.y, view.zoom])
  const previewRebuildKey = useMemo(
    () => {
      const activeCandidateLocation = candidateDocument?.locations.find((location) => (
        location.id === courseLocationId && location.kind === 'slide-scene'
      ))
      const activeCandidateSurface = activeCandidateLocation
        ? candidateDocument?.surfaces.find((surface) => (
            surface.id === activeCandidateLocation.surfaceId && surface.type === 'slide'
          ))
        : undefined
      const activeCandidateScene = activeCandidateLocation?.kind === 'slide-scene'
        && activeCandidateSurface?.type === 'slide'
        ? activeCandidateSurface.scenes.find((candidate) => (
            candidate.id === activeCandidateLocation.sceneId
          ))
        : undefined
      return buildSlidePreviewRebuildKey({
        canvasMode,
        editingScope,
        activePresentationStateId,
        scene,
        scenes: project.scenes,
        globalLayer: project.globalLayer,
        globalRuntime: project.globalRuntime ?? null,
        assets: project.assets,
        candidateGlobals: candidateDocument?.globalLayerItems ?? null,
        candidateLocalItems: activeCandidateSurface?.type === 'slide' && activeCandidateScene
          ? [
              ...activeCandidateScene.layerItems.map((item) => ({
                owner: 'scene' as const,
                item,
              })),
              ...activeCandidateSurface.surfaceLayerItems.map((entry) => ({
                owner: 'surface' as const,
                item: entry.item,
                visibility: entry.visibility,
              })),
            ]
          : null,
        candidateAssets: candidateDocument?.assets ?? null,
        sidecarFileIds: sidecarFileIdsFrom(candidateSidecar?.files, assetFiles),
        componentPackages,
      })
    },
    [
      activePresentationStateId,
      assetFiles,
      candidateDocument,
      candidateSidecar,
      canvasMode,
      componentPackages,
      courseLocationId,
      editingScope,
      project,
      scene,
    ],
  )
  const previewGeneration = useMemo<object>(() => ({}), [
    canvasMode,
    previewRebuildKey,
    previewRetryRevision,
  ])
  const authoringCanvasInteractive = isAuthoringCanvasInteractive({
    canvasMode,
    playerReady: authoringReadyRef.current,
    snapshotPending: authoringSnapshotBarrierRef.current !== null,
    hasPreviewFeedback: previewFeedback !== null,
    generationCurrent: acknowledgedPreviewGeneration === previewGeneration,
  })

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isEditableKeyboardTarget(event.target)) {
        spacePressedRef.current = true
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false
    }
    const onBlur = () => {
      spacePressedRef.current = false
      panRef.current = null
      setPanning(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const setZoom = useCallback((zoom: number) => {
    setView((current) => ({
      ...current,
      zoom: Math.max(0.5, Math.min(2, Math.round(zoom * 20) / 20)),
    }))
  }, [])

  const resetView = useCallback(() => {
    setView({ zoom: 1, x: 0, y: 0 })
  }, [])

  useLayoutEffect(() => {
    const viewport = stageViewportRef.current
    if (!viewport) return
    const update = () => {
      const rect = viewport.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      setStageViewportSize((current) => (
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      ))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const failPublishedAuthoring = useCallback((token: string, message: string) => {
    if (publishedAuthoringInitRef.current?.token !== token) return
    publishedAuthoringInitRef.current = null
    authoringReadyRef.current = false
    authoringSnapshotBarrierRef.current = null
    setAcknowledgedPreviewGeneration(null)
    if (authoringFrameRef.current !== null) {
      window.cancelAnimationFrame(authoringFrameRef.current)
      authoringFrameRef.current = null
    }
    pendingAuthoringNodesRef.current.clear()
    runtimeTargetsByHostRef.current.clear()
    componentTargetsByHostRef.current.clear()
    lastAuthoringTargetsRevisionRef.current = -1
    setRuntimeTargets([])
    setComponentTargets([])
    setActiveRuntimeTextSession(null)
    setActiveComponentTextSession(null)
    setHoveredAuthoringTargetId(null)
    setReplacingRuntimeAssetTargetId(null)
    setPreviewFeedback({
      kind: 'error',
      title: '统一画布启动失败',
      message,
    })
  }, [])

  const retryRuntimePreview = useCallback(() => {
    setPreviewFeedback({
      kind: 'loading',
      title: '正在重新准备画布',
      message: '正在重新创建 Published 编辑宿主…',
    })
    setPreviewRetryRevision((revision) => revision + 1)
  }, [])

  const postAuthoringPatch = useCallback((patch: PlayerAuthoringPatch) => {
    const init = publishedAuthoringInitRef.current
    const session = publishedAuthoringSessionRef.current
    if (
      !init ||
      !session ||
      !authoringReadyRef.current
    ) {
      if (init && authoringSnapshotBarrierRef.current) {
        failPublishedAuthoring(
          init.token,
          '编辑画布在初始同步期间失去连接。请重新载入画布。',
        )
      }
      return null
    }
    const editorState = useEditorStore.getState()
    const currentScene = selectActiveScene(editorState)
    authoringRevisionRef.current += 1
    const command: PlayerAuthoringPatchCommand = {
      type: PLAYER_AUTHORING_MESSAGE_TYPES.patch,
      protocolVersion: PLAYER_AUTHORING_PROTOCOL_VERSION,
      sessionId: init.token,
      requestId: crypto.randomUUID(),
      revision: authoringRevisionRef.current,
      context: {
        sceneId: currentScene.id,
        stateId: editorState.activePresentationStateId,
      },
      patch,
    }
    try {
      void session.applyAuthoringCommand(command).catch((error) => {
        failPublishedAuthoring(
          command.sessionId,
          error instanceof Error
            ? `编辑画布更新失败：${error.message}`
            : '编辑画布更新失败。',
        )
      })
    } catch {
      if (authoringSnapshotBarrierRef.current) {
        failPublishedAuthoring(
          init.token,
          '编辑画布在初始同步期间无法继续发送更新。请重新载入画布。',
        )
      }
      return null
    }
    // Property-panel edits may arrive while the initial snapshot is still
    // applying. Move the gate forward so an older snapshot ACK cannot expose
    // a canvas that is still catching up with the editor store.
    if (authoringSnapshotBarrierRef.current) {
      authoringSnapshotBarrierRef.current =
        playerAuthoringSnapshotBarrierForCommand(command)
    }
    return command
  }, [failPublishedAuthoring])

  useEffect(() => onElementAnimationPreviewRequested(({ action, delayMs }) => {
    const store = useEditorStore.getState()
    const currentNode = selectEditingNodes(store).find(
      (node) => node.id === action.nodeId,
    )
    if (!currentNode) {
      store.setStatus('动画预览目标已失效，请重新选择')
      return
    }
    const posted = postAuthoringPatch({
      kind: 'preview-node-motion',
      target: {
        kind: 'native-node',
        scope: store.editingScope,
        nodeId: currentNode.id,
      },
      action,
      delayMs,
    })
    if (!posted) {
      store.setStatus('编辑画布尚未就绪，请稍后重试动画预览')
    }
  }), [postAuthoringPatch])

  const flushAuthoringNodePatches = useCallback(() => {
    authoringFrameRef.current = null
    const pending = [...pendingAuthoringNodesRef.current.values()]
    pendingAuthoringNodesRef.current.clear()
    for (const { scope, node } of pending) {
      postAuthoringPatch({
        kind: 'native-node',
        target: {
          kind: 'native-node',
          scope,
          nodeId: node.id,
        },
        node,
      })
    }
  }, [postAuthoringPatch])

  const queueAuthoringNodePatch = useCallback((
    scope: 'scene' | 'global',
    node: SceneNode,
  ) => {
    pendingAuthoringNodesRef.current.set(
      `${scope}:${node.id}`,
      { scope, node: structuredClone(node) },
    )
    if (authoringFrameRef.current !== null) return
    authoringFrameRef.current = window.requestAnimationFrame(
      flushAuthoringNodePatches,
    )
  }, [flushAuthoringNodePatches])

  const paintSlideTransformPreview = useCallback((
    preview: Parameters<typeof mergeSlidePreviewIntoNodes>[1],
  ) => {
    const store = useEditorStore.getState()
    const painted = mergeSlidePreviewIntoNodes(selectEditingNodes(store), preview)
    const handle = gameRef.current
    for (const node of painted) {
      const current = selectEditingNodes(store).find((item) => item.id === node.id)
      const normalized = {
        ...node,
        ...withDirectionAwareTextAutoSize(current, {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          rotation: node.rotation,
        }),
      } as SceneNode
      handle?.bridge.applyNode(normalized)
      queueAuthoringNodePatch(store.editingScope, normalized)
    }
  }, [queueAuthoringNodePatch])

  const syncCommittedTextNode = useCallback((nodeId: string) => {
    const node = selectEditingNodes(useEditorStore.getState()).find((item) => item.id === nodeId)
    if (node) {
      gameRef.current?.bridge.applyNode(node)
      queueAuthoringNodePatch(useEditorStore.getState().editingScope, node)
    }
    gameRef.current?.bridge.setTextEditing(null)
  }, [queueAuthoringNodePatch])

  const syncCompleteAuthoringSnapshot = useCallback(() => {
    const editorState = useEditorStore.getState()
    const currentScene = selectActiveScene(editorState)
    const materialized = materializeScene(
      currentScene,
      editorState.activePresentationStateId,
    )
    const localNodes = selectSlideAuthoringBackend(editorState)?.getSnapshot().scope === 'surface'
      ? selectEditingNodes(editorState)
      : materialized.nodes
    if (authoringFrameRef.current !== null) {
      window.cancelAnimationFrame(authoringFrameRef.current)
      authoringFrameRef.current = null
    }
    pendingAuthoringNodesRef.current.clear()
    const currentCourse = selectActiveCourseProjectDocument(editorState)
    const globalItems = currentCourse
      ? currentCourse.globalLayerItems.flatMap((entry) => {
          const node = courseLayerItemToSceneNode(entry.item)
          return node ? [{ node }] : []
        })
      : editorState.project.globalLayer
    const patches: PlayerAuthoringPatch[] = [
      ...localNodes.map((node): PlayerAuthoringPatch => ({
        kind: 'native-node',
        target: { kind: 'native-node', scope: 'scene', nodeId: node.id },
        node,
      })),
      ...globalItems.map((item): PlayerAuthoringPatch => ({
        kind: 'native-node',
        target: {
          kind: 'native-node',
          scope: 'global',
          nodeId: item.node.id,
        },
        node: item.node,
      })),
      {
        kind: 'scene-background',
        target: { kind: 'scene-background', scope: 'scene' },
        backgroundColor: materialized.backgroundColor,
        backgroundAssetId: materialized.backgroundAssetId ?? null,
      },
      {
        kind: 'scene-order',
        target: { kind: 'scene-order', scope: 'scene' },
        nodeIds: localNodes.map((node) => node.id),
      },
    ]
    let lastCommand: PlayerAuthoringPatchCommand | null = null
    for (const patch of patches) {
      lastCommand = postAuthoringPatch(patch)
      if (!lastCommand) return null
    }
    return lastCommand
  }, [postAuthoringPatch])

  useEffect(() => () => {
    if (authoringFrameRef.current !== null) {
      window.cancelAnimationFrame(authoringFrameRef.current)
      authoringFrameRef.current = null
    }
    pendingAuthoringNodesRef.current.clear()
  }, [])

  const handlePublishedAuthoringMessage = useCallback((
    message: PlayerAuthoringHostMessage,
  ) => {
    const init = publishedAuthoringInitRef.current
    if (!init || message.sessionId !== init.token) return
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.ready) {
      if (authoringReadyRef.current) return
      const parsed = parsePlayerAuthoringReadyMessage(message)
      if (!parsed.ok) {
        failPublishedAuthoring(
          init.token,
          `编辑画布握手无效：${parsed.message}。请重新载入画布。`,
        )
        return
      }
      if (
        parsed.ready.context.sceneId !== init.initialSceneId ||
        parsed.ready.context.stateId !== init.initialStateId
      ) {
        failPublishedAuthoring(
          init.token,
          '编辑画布返回了不一致的场景或状态。请重新载入画布。',
        )
        return
      }
      authoringReadyRef.current = true
      setPreviewFeedback({
        kind: 'loading',
        title: '正在同步编辑画布',
        message: 'Published 宿主已启动，正在应用当前画面的完整快照…',
      })
      const lastCommand = syncCompleteAuthoringSnapshot()
      if (!lastCommand) {
        failPublishedAuthoring(
          init.token,
          '当前画面的完整快照未能发送。请重新载入画布。',
        )
        return
      }
      authoringSnapshotBarrierRef.current =
        playerAuthoringSnapshotBarrierForCommand(lastCommand)
      return
    }
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.ack) {
      const barrier = authoringSnapshotBarrierRef.current
      if (!barrier || !isPlayerAuthoringSnapshotAck(message, barrier)) return
      if (pendingAuthoringNodesRef.current.size > 0) {
        if (authoringFrameRef.current !== null) {
          window.cancelAnimationFrame(authoringFrameRef.current)
        }
        flushAuthoringNodePatches()
        return
      }
      authoringSnapshotBarrierRef.current = null
      setAcknowledgedPreviewGeneration(previewGeneration)
      setPreviewFeedback(null)
      return
    }
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.runtimeTargets) {
      if (message.revision <= lastAuthoringTargetsRevisionRef.current) return
      lastAuthoringTargetsRevisionRef.current = message.revision
      const hostKey = `${message.update.scope}:${message.update.sceneId ?? ''}`
      runtimeTargetsByHostRef.current.set(
        hostKey,
        sanitizeRuntimeAuthoringTargets(message.update, hostKey),
      )
      setRuntimeTargets([...runtimeTargetsByHostRef.current.values()].flat())
      return
    }
    if (message.type === PLAYER_AUTHORING_MESSAGE_TYPES.componentTargets) {
      if (message.revision <= lastAuthoringTargetsRevisionRef.current) return
      lastAuthoringTargetsRevisionRef.current = message.revision
      const hostKey = [
        message.update.scope,
        message.update.sceneId ?? '',
        message.update.nodeId,
      ].join(':')
      componentTargetsByHostRef.current.set(
        hostKey,
        sanitizeComponentAuthoringTargets(message.update, hostKey),
      )
      setComponentTargets([...componentTargetsByHostRef.current.values()].flat())
      return
    }
    if (message.type !== PLAYER_AUTHORING_MESSAGE_TYPES.error) return
    if (authoringSnapshotBarrierRef.current) {
      failPublishedAuthoring(
        init.token,
        `初始画面同步失败：${message.message}。请重新载入画布。`,
      )
      return
    }
    useEditorStore.getState().setStatus(`画布同步未应用：${message.message}`)
  }, [
    failPublishedAuthoring,
    flushAuthoringNodePatches,
    previewGeneration,
    syncCompleteAuthoringSnapshot,
  ])

  useEffect(() => {
    const container = publishedAuthoringHostRef.current
    if (!usePublishedAuthoring || !container) {
      const leftover = publishedAuthoringSessionRef.current
      publishedAuthoringSessionRef.current = null
      publishedAuthoringInitRef.current = null
      if (leftover) {
        enqueueSerial(publishedAuthoringMountChainRef, () => leftover.destroy())
      }
      return
    }

    const editorState = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(editorState)
    const locationId = selectActiveCourseLocationId(editorState)
    if (!document || !locationId) {
      setPreviewFeedback({
        kind: 'error',
        title: '统一画布创建失败',
        message: '当前 Slide 场景没有可用的 V9 Published 位置。',
      })
      return
    }
    authoringReadyRef.current = false
    authoringRevisionRef.current = 0
    authoringSnapshotBarrierRef.current = null
    lastAuthoringTargetsRevisionRef.current = -1
    runtimeTargetsByHostRef.current.clear()
    componentTargetsByHostRef.current.clear()
    setRuntimeTargets([])
    setComponentTargets([])
    setAcknowledgedPreviewGeneration(null)
    setPreviewFeedback({
      kind: 'loading',
      title: '正在准备编辑画布',
      message: '正在挂载 Published V2 编辑宿主…',
    })
    const token = crypto.randomUUID()
    const activeScene = selectActiveScene(editorState)
    const authoringScope = selectSlideAuthoringBackend(editorState)?.getSnapshot().scope
      ?? editorState.editingScope
    publishedAuthoringInitRef.current = {
      token,
      initialSceneId: activeScene.id,
      initialStateId: editorState.activePresentationStateId,
      editingScope: editorState.editingScope,
    }

    return beginSerializedSessionMount(
      publishedAuthoringMountChainRef,
      () => mountPublishedCourseAuthoring({
        container,
        project: document,
        assetFiles: selectMediaAssetFiles(editorState),
        components: editorState.componentPackages,
        locationId,
        sessionId: token,
        scope: authoringScope,
        stateId: editorState.activePresentationStateId,
        onSessionCreated: (session) => {
          if (publishedAuthoringInitRef.current?.token === token) {
            publishedAuthoringSessionRef.current = session
          }
        },
        onMessage: handlePublishedAuthoringMessage,
      }),
      {
        onReady: (session) => {
          if (publishedAuthoringInitRef.current?.token !== token) return
          publishedAuthoringSessionRef.current = session
          container.dataset.coursePlayerReady = 'true'
        },
        onError: (error) => {
          console.error('Published 编辑宿主启动失败', error)
          failPublishedAuthoring(
            token,
            error instanceof Error ? error.message : 'Published 编辑宿主未能完成启动。',
          )
        },
        onCleanup: () => {
          container.dataset.coursePlayerReady = 'false'
          if (publishedAuthoringInitRef.current?.token === token) {
            publishedAuthoringInitRef.current = null
          }
          publishedAuthoringSessionRef.current = null
          authoringReadyRef.current = false
          authoringSnapshotBarrierRef.current = null
          runtimeTargetsByHostRef.current.clear()
          componentTargetsByHostRef.current.clear()
          setRuntimeTargets([])
          setComponentTargets([])
          setAcknowledgedPreviewGeneration(null)
        },
      },
    )
  }, [
    failPublishedAuthoring,
    handlePublishedAuthoringMessage,
    previewGeneration,
    usePublishedAuthoring,
  ])

  useEffect(() => {
    const container = courseTryRunRef.current
    if (!useCoursePlayerTryRun || !courseDocument || !container || !tryRunMountKey) {
      courseTryRunFitRef.current?.()
      courseTryRunFitRef.current = null
      const leftover = courseTryRunSessionRef.current
      courseTryRunSessionRef.current = null
      if (leftover) {
        enqueueSerial(courseTryRunMountChainRef, () => leftover.destroy())
      }
      setTryRunFeedback(null)
      return
    }
    setTryRunFeedback({
      kind: 'loading',
      title: '正在准备当前位置试运行',
      message: '正在载入 CoursePlayer…',
    })
    const state = useEditorStore.getState()
    const document = selectActiveCourseProjectDocument(state)
    const locationId = selectActiveCourseLocationId(state)
    if (!document) {
      setTryRunFeedback(null)
      return
    }
    return beginSerializedSessionMount(courseTryRunMountChainRef, () => mountPublishedCourseTryRun({
      container,
      project: document,
      assetFiles: selectMediaAssetFiles(state),
      components: state.componentPackages,
      locationId,
      initialPresentationStateId: locationId
        ? state.activePresentationStateId
        : null,
    }), {
      onReady: (session) => {
        courseTryRunFitRef.current?.()
        courseTryRunFitRef.current = attachPublishedCourseStageFit(container)
        courseTryRunSessionRef.current = session
        container.dataset.coursePlayerReady = 'true'
        setTryRunFeedback(null)
        setTryRunEpoch((current) => current + 1)
      },
      onError: (error) => {
        console.error('CoursePlayer 试运行启动失败', error)
        setTryRunFeedback({
          kind: 'error',
          title: '当前位置试运行启动失败',
          message: error instanceof Error ? error.message : '播放器未能完成启动。请重试。',
        })
      },
      onCleanup: () => {
        container.dataset.coursePlayerReady = 'false'
        courseTryRunFitRef.current?.()
        courseTryRunFitRef.current = null
        courseTryRunSessionRef.current = null
      },
    })
  }, [tryRunMountKey, useCoursePlayerTryRun])

  useEffect(() => {
    const session = courseTryRunSessionRef.current
    if (!useCoursePlayerTryRun || !session || !courseLocationId) return
    void session.goToLocation(courseLocationId).catch((error) => {
      console.error('CoursePlayer 试运行跳转失败', error)
    })
  }, [courseLocationId, tryRunEpoch, useCoursePlayerTryRun])

  const document = useMemo<SceneDocument>(() => {
    if (editingScope === 'scene') {
      return materializeScene(scene, activePresentationStateId)
    }
    const layerOrder = { underlay: 0, overlay: 1 } as const
    return {
      id: '__editor_global_layer__',
      name: '全局层',
      backgroundColor: scene.backgroundColor,
      backgroundAssetId: scene.backgroundAssetId,
      interactions: [],
      nodes: [...globalLayer]
        .sort((left, right) => layerOrder[left.layer] - layerOrder[right.layer])
        .map((item) => item.node),
    }
  }, [activePresentationStateId, editingScope, globalLayer, scene])

  const editingNode = useMemo(
    () =>
      editingTextNodeId
        ? (document.nodes.find(
            (node) => node.id === editingTextNodeId && node.type === 'text',
          ) as TextNode | undefined)
        : undefined,
    [document.nodes, editingTextNodeId],
  )
  const editingFormulaNode = useMemo<FormulaNode | undefined>(() => {
    const session = activeFormulaEditSession
    if (
      !session ||
      canvasMode !== 'edit' ||
      session.projectId !== project.id ||
      session.scope !== editingScope ||
      session.sceneId !== scene.id ||
      session.stateId !== activePresentationStateId
    ) {
      return undefined
    }
    return document.nodes.find((node): node is FormulaNode => (
      node.id === session.nodeId && node.type === 'formula'
    ))
  }, [
    activeFormulaEditSession,
    activePresentationStateId,
    canvasMode,
    document.nodes,
    editingScope,
    project.id,
    scene.id,
  ])

  useEffect(() => {
    if (activeFormulaEditSession && !editingFormulaNode) {
      setActiveFormulaEditSession(null)
    }
  }, [activeFormulaEditSession, editingFormulaNode])
  const visibleRuntimeTargets = useMemo(
    () => runtimeTargets.filter((target) => (
      (target.kind === 'text' || target.kind === 'asset') &&
      runtimeTargetMatchesEditingContext(target, editingScope, scene.id)
    )),
    [editingScope, runtimeTargets, scene.id],
  )
  const visibleComponentTargets = useMemo(
    () => componentTargets.filter((target) => {
      if (target.scope !== editingScope) return false
      if (target.scope === 'scene' && target.sceneId !== scene.id) return false
      return document.nodes.some((node) => (
        node.id === target.nodeId &&
        node.type === 'external-component' &&
        node.visible &&
        !node.locked
      ))
    }),
    [componentTargets, document.nodes, editingScope, scene.id],
  )
  const activeComponentTextTarget = useMemo(() => {
    if (
      !activeComponentTextSession ||
      !componentTextEditSessionMatchesContext(activeComponentTextSession, {
        projectId: project.id,
        scope: editingScope,
        sceneId: scene.id,
        stateId: activePresentationStateId,
      })
    ) {
      return undefined
    }
    return visibleComponentTargets.find((target) => (
      componentTextTargetMatchesSession(target, activeComponentTextSession)
    ))
  }, [
    activeComponentTextSession,
    activePresentationStateId,
    editingScope,
    project.id,
    scene.id,
    visibleComponentTargets,
  ])
  const componentEditingNode = useMemo(
    () => activeComponentTextSession && activeComponentTextTarget
      ? document.nodes.find(
          (node): node is ExternalComponentNode => (
            node.id === activeComponentTextSession.nodeId &&
            node.type === 'external-component' &&
            node.component.packageId === activeComponentTextSession.componentId &&
            node.component.version === activeComponentTextSession.componentVersion
          ),
        )
      : undefined,
    [activeComponentTextSession, activeComponentTextTarget, document.nodes],
  )
  const componentEditingValue = activeComponentTextSession?.initialValue ?? ''
  const activeRuntimeTextTarget = useMemo(() => {
    if (
      !activeRuntimeTextSession ||
      activeRuntimeTextSession.liveSession.kind !== 'text' ||
      !runtimeTargetEditSessionMatchesContext(activeRuntimeTextSession.liveSession, {
        projectId: project.id,
        scope: editingScope,
        sceneId: scene.id,
      })
    ) {
      return undefined
    }
    return visibleRuntimeTargets.find((target) => (
      runtimeTargetMatchesEditSession(target, activeRuntimeTextSession.liveSession)
    ))
  }, [
    activeRuntimeTextSession,
    editingScope,
    project.id,
    scene.id,
    visibleRuntimeTargets,
  ])
  const activeRuntimeTextValue = activeRuntimeTextSession?.courseTarget.initialValue ?? ''

  useEffect(() => {
    if (
      canvasMode !== 'edit' ||
      !activeRuntimeTextSession ||
      !activeRuntimeTextTarget
    ) {
      setActiveRuntimeTextSession(null)
    }
  }, [activeRuntimeTextSession, activeRuntimeTextTarget, canvasMode])

  useEffect(() => {
    if (
      canvasMode !== 'edit' ||
      !activeComponentTextSession ||
      !activeComponentTextTarget
    ) {
      setActiveComponentTextSession(null)
    }
  }, [activeComponentTextSession, activeComponentTextTarget, canvasMode])

  const currentComponentTextEditContext = useCallback(
    (): ComponentTextEditContext => {
      const store = useEditorStore.getState()
      const nodes = selectEditingNodes(store)
      const visibleComponentNodeIds = new Set(nodes.flatMap((node) => (
        node.type === 'external-component' && node.visible && !node.locked
          ? [node.id]
          : []
      )))
      return {
        projectId: store.project.id,
        scope: store.editingScope,
        sceneId: store.activeSceneId,
        stateId: store.activePresentationStateId,
        nodes,
        componentPackages: store.componentPackages,
        // Read the synchronous host registry rather than React render state so
        // a blur racing with target cleanup can never commit a retired target.
        targets: [...componentTargetsByHostRef.current.values()]
          .flat()
          .filter((target) => (
            target.scope === store.editingScope &&
            (target.scope === 'global' ||
              target.sceneId === store.activeSceneId) &&
            visibleComponentNodeIds.has(target.nodeId)
          )),
      }
    },
    [],
  )

  const currentRuntimeTargetEditContext = useCallback(
    (): RuntimeTargetEditContext => {
      const store = useEditorStore.getState()
      return {
        projectId: store.project.id,
        scope: store.editingScope,
        sceneId: store.activeSceneId,
        stateId: store.activePresentationStateId,
        // Read the synchronous host registry so a commit racing with target
        // cleanup cannot write into a replacement Runtime that happens to use
        // the same content or asset key.
        targets: [...runtimeTargetsByHostRef.current.values()]
          .flat()
          .filter((target) => (
            (target.kind === 'text' || target.kind === 'asset') &&
            runtimeTargetMatchesEditingContext(
              target,
              store.editingScope,
              store.activeSceneId,
            )
          )),
      }
    },
    [],
  )

  const beginComponentTextEdit = useCallback((
    target: Readonly<ComponentAuthoringTextTarget>,
  ) => {
    useEditorStore.getState().commitTextEdit()
    const store = useEditorStore.getState()
    const result = beginComponentTextEditSession(
      target,
      currentComponentTextEditContext(),
    )
    if (!result.ok) {
      store.setStatus(
        result.reason === 'context-changed'
          ? '组件文字编辑上下文已切换，请重新选择'
          : '组件文字目标已失效，请重新选择',
      )
      setActiveComponentTextSession(null)
      return
    }
    store.selectNode(result.session.nodeId)
    setActiveRuntimeTextSession(null)
    setActiveComponentTextSession(result.session)
  }, [currentComponentTextEditContext])

  const commitComponentText = useCallback((
    session: Readonly<ComponentTextEditSession>,
    value: string,
  ) => {
    const store = useEditorStore.getState()
    const result = resolveComponentTextEdit(
      session,
      value,
      currentComponentTextEditContext(),
    )
    if (!result.ok) {
      store.setStatus(
        result.reason === 'context-changed'
          ? '组件文字编辑上下文已切换，未写入修改'
          : '组件文字目标已失效，未写入修改',
      )
      setActiveComponentTextSession(null)
      return
    }
    store.updateNode(result.nodeId, {
      props: result.props,
    })
    const updatedNode = selectEditingNodes(useEditorStore.getState()).find(
      (node): node is ExternalComponentNode => (
        node.id === result.nodeId && node.type === 'external-component'
      ),
    )
    if (
      !updatedNode
      || updatedNode.locked
      || getComponentPropValue(updatedNode.props, session.key) !== value
    ) {
      store.setStatus(
        updatedNode?.locked
          ? '组件已锁定，未写入文字修改'
          : '组件文字未写入，请重新选择后重试',
      )
      setActiveComponentTextSession(null)
      return
    }
    queueAuthoringNodePatch(session.scope, updatedNode)
    store.setStatus(
      session.stateId === null || session.scope === 'global'
        ? '已更新组件文字'
        : '已更新当前演示状态中的组件文字',
    )
    setActiveComponentTextSession(null)
  }, [currentComponentTextEditContext, queueAuthoringNodePatch])

  const beginRuntimeTextEdit = useCallback((
    target: Readonly<RuntimeAuthoringTarget>,
  ) => {
    if (target.kind !== 'text') return
    const store = useEditorStore.getState()
    store.commitTextEdit()
    const result = beginRuntimeTargetEditSession(
      target,
      currentRuntimeTargetEditContext(),
    )
    if (!result.ok) {
      store.setStatus(
        result.reason === 'context-changed'
          ? '运行时文字编辑上下文已切换，请重新选择'
          : '运行时文字目标已失效，请重新选择',
      )
      setActiveRuntimeTextSession(null)
      return
    }
    const courseTarget = store.captureRuntimeContentTextTarget(result.session)
    if (!courseTarget) {
      store.setStatus('运行时文字目标没有可提交的 V9 作者地址，或当前 Runtime 已锁定')
      setActiveRuntimeTextSession(null)
      return
    }
    setActiveComponentTextSession(null)
    setActiveRuntimeTextSession(Object.freeze({
      liveSession: result.session,
      courseTarget,
    }))
  }, [currentRuntimeTargetEditContext])

  const commitRuntimeText = useCallback((
    session: Readonly<WorkspaceRuntimeTextEditSession>,
    value: string,
  ) => {
    const store = useEditorStore.getState()
    const result = validateRuntimeTargetEditSession(
      session.liveSession,
      currentRuntimeTargetEditContext(),
    )
    if (!result.ok) {
      store.setStatus(
        result.reason === 'context-changed'
          ? '运行时文字编辑上下文已切换，未写入修改'
          : '运行时文字目标已失效，未写入修改',
      )
      setActiveRuntimeTextSession(null)
      return
    }
    const committed = store.updateRuntimeContentTextAtTarget(
      session.courseTarget,
      value,
    )
    if (!committed.ok) {
      store.setStatus(`${committed.reason} 未写入修改`)
    } else if (committed.status === 'unchanged') {
      store.setStatus('运行时文字没有变化')
    } else if (session.courseTarget.courseTarget.owner === 'global') {
      store.setStatus('已更新全局运行时文字；此内容由整课共享')
    } else {
      store.setStatus('已更新运行时文字；此内容由当前场景的所有状态共享')
    }
    if (committed.ok && committed.status === 'updated') {
      const target = session.courseTarget.courseTarget
      postAuthoringPatch({
        kind: 'runtime-content',
        target: {
          kind: 'runtime-content',
          scope: target.owner === 'global' ? 'global' : 'scene',
          nodeId: target.itemId,
          key: session.courseTarget.contentKey,
        },
        value,
      })
    }
    setActiveRuntimeTextSession(null)
  }, [currentRuntimeTargetEditContext, postAuthoringPatch])

  const replaceRuntimeAsset = useCallback(async (
    target: Readonly<RuntimeAuthoringTarget>,
  ) => {
    if (target.kind !== 'asset' || replacingRuntimeAssetTargetId) return
    const store = useEditorStore.getState()
    const started = beginRuntimeTargetEditSession(
      target,
      currentRuntimeTargetEditContext(),
    )
    if (!started.ok) {
      store.setStatus(
        started.reason === 'context-changed'
          ? '运行时图片编辑上下文已切换，请重新选择'
          : '运行时图片目标已失效，请重新选择',
      )
      return
    }
    const session = started.session
    const courseTarget = store.captureRuntimeAssetReplacementTarget(session)
    if (!courseTarget) {
      store.setStatus('运行时图片目标没有可提交的 V9 作者地址，请重新选择')
      return
    }
    setReplacingRuntimeAssetTargetId(session.targetId)
    try {
      const imported = await onSelectImageAsset()
      if (!imported) return
      const latestState = useEditorStore.getState()
      const result = validateRuntimeTargetEditSession(
        session,
        currentRuntimeTargetEditContext(),
      )
      if (!result.ok) {
        latestState.setStatus(
          result.reason === 'context-changed'
            ? '运行时图片编辑上下文已切换，未写入修改'
            : '运行时图片目标已失效，未写入修改',
        )
        return
      }
      const committed = latestState.replaceRuntimeAssetAtTarget(
        courseTarget,
        imported.meta,
        imported.bytes,
      )
      if (!committed.ok) {
        latestState.setStatus(`${committed.reason} 未写入修改`)
        return
      }
      if (committed.status === 'unchanged') {
        latestState.setStatus('运行时图片未改变')
        return
      }
      latestState.setStatus(
        courseTarget.courseTarget.owner === 'global'
          ? '已替换全局运行时图片；此素材由整课共享'
          : '已替换运行时图片；此素材由当前场景的所有状态共享',
      )
    } finally {
      setReplacingRuntimeAssetTargetId(null)
    }
  }, [
    currentRuntimeTargetEditContext,
    onSelectImageAsset,
    replacingRuntimeAssetTargetId,
  ])

  const canvasAuthoringHitAtClientPoint = useCallback((
    clientX: number,
    clientY: number,
  ): CanvasAuthoringHit | null => {
    const viewport = stageViewportRef.current
    if (!viewport || !authoringCanvasInteractive) return null
    const rect = viewport.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const transform = createStageViewportTransform({
      viewport: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      zoom: view.zoom,
      pan: { x: view.x, y: view.y },
    })
    const point = clientToWorld(transform, { x: clientX, y: clientY })
    const ordered = [...visibleRuntimeTargets].sort((left, right) => (
      (left.layer === 'overlay' ? 1 : 0) -
      (right.layer === 'overlay' ? 1 : 0)
    ))
    const runtimeTarget = ordered.reverse().find((candidate) => (
      point.x >= candidate.bounds.x &&
      point.x <= candidate.bounds.x + candidate.bounds.width &&
      point.y >= candidate.bounds.y &&
      point.y <= candidate.bounds.y + candidate.bounds.height
    )) ?? null
    if (runtimeTarget?.layer === 'overlay') {
      return { kind: 'runtime', target: runtimeTarget }
    }
    const componentTarget = [...visibleComponentTargets].reverse().find(
      (candidate) => pointInsideRotatedBounds(
        point,
        candidate.bounds,
        candidate.rotation,
      ),
    )
    if (componentTarget) {
      return { kind: 'component', target: componentTarget }
    }
    if (
      runtimeTarget?.layer === 'underlay' &&
      document.nodes.some((node) => pointInsideSceneNode(point, node))
    ) {
      return null
    }
    return runtimeTarget ? { kind: 'runtime', target: runtimeTarget } : null
  }, [
    authoringCanvasInteractive,
    document.nodes,
    visibleRuntimeTargets,
    view.x,
    view.y,
    view.zoom,
    visibleComponentTargets,
  ])

  useLayoutEffect(() => {
    const host = gameHostRef.current
    if (!host) return
    const handle = createEditorGame(host, {
      fixedLogicalSize: true,
    })
    gameRef.current = handle
    const findCanvas = () => {
      const element = host.querySelector('canvas')
      if (element) setCanvas(element)
    }
    findCanvas()
    const observer = new MutationObserver(findCanvas)
    observer.observe(host, { childList: true })

    const unsubscribers = [
      handle.bridge.onNodeSelected(({ nodeIds, additive }) => {
        const store = useEditorStore.getState()
        if (!additive) {
          store.selectNodes(nodeIds)
          return
        }
        const merged = new Set(store.selectedNodeIds)
        for (const nodeId of nodeIds) {
          if (merged.has(nodeId)) merged.delete(nodeId)
          else merged.add(nodeId)
        }
        store.selectNodes([...merged])
      }),
      handle.bridge.onNodesTransformPreview(({ nodes }) => {
        const store = useEditorStore.getState()
        if (store.canvasMode !== 'edit') return
        const currentById = new Map(
          selectEditingNodes(store).map((node) => [node.id, node]),
        )
        for (const { nodeId, ...patch } of nodes) {
          const current = currentById.get(nodeId)
          if (!current) continue
          const normalizedPatch = withDirectionAwareTextAutoSize(
            current,
            patch,
          )
          queueAuthoringNodePatch(
            store.editingScope,
            { ...current, ...normalizedPatch } as SceneNode,
          )
        }
      }),
      handle.bridge.onNodeMoveEnd(({ nodeId, x, y }) => {
        if (selectSlideAuthoringBackend(useEditorStore.getState())) return
        useEditorStore.getState().updateNode(nodeId, { x, y })
      }),
      handle.bridge.onNodesMoveEnd(({ nodes }) => {
        if (selectSlideAuthoringBackend(useEditorStore.getState())) return
        useEditorStore.getState().updateNodes(
          nodes.map(({ nodeId, x, y }) => ({ nodeId, patch: { x, y } })),
        )
      }),
      handle.bridge.onNodeResizeEnd(({ nodeId, x, y, width, height }) => {
        const store = useEditorStore.getState()
        if (selectSlideAuthoringBackend(store)) return
        const node = selectEditingNodes(store).find(
          (item) => item.id === nodeId,
        )
        store.updateNode(
          nodeId,
          withDirectionAwareTextAutoSize(
            node,
            { x, y, width, height },
          ),
        )
      }),
      handle.bridge.onNodeRotateEnd(({ nodeId, rotation }) => {
        if (selectSlideAuthoringBackend(useEditorStore.getState())) return
        useEditorStore.getState().updateNode(nodeId, { rotation })
      }),
      handle.bridge.onNodesTransformEnd(({ nodes }) => {
        const store = useEditorStore.getState()
        if (selectSlideAuthoringBackend(store)) return
        const currentById = new Map(
          selectEditingNodes(store).map((node) => [node.id, node]),
        )
        store.updateNodes(
          nodes.map(({ nodeId, ...patch }) => ({
            nodeId,
            patch: withDirectionAwareTextAutoSize(
              currentById.get(nodeId),
              patch,
            ),
          })),
        )
      }),
      handle.bridge.onTextDoubleClick((nodeId) => {
        setActiveFormulaEditSession(null)
        setActiveComponentTextSession(null)
        setActiveRuntimeTextSession(null)
        useEditorStore.getState().selectNode(nodeId)
        useEditorStore.getState().beginTextEdit(nodeId, 'canvas')
      }),
      handle.bridge.onFormulaDoubleClick((nodeId) => {
        const store = useEditorStore.getState()
        const node = selectEditingNodes(store).find((item) => item.id === nodeId)
        if (node?.type !== 'formula' || store.canvasMode !== 'edit') return
        if (store.editingTextNodeId) {
          store.cancelTextEdit()
          handle.bridge.setTextEditing(null)
        }
        setActiveComponentTextSession(null)
        setActiveRuntimeTextSession(null)
        store.selectNode(nodeId)
        setActiveFormulaEditSession({
          projectId: store.project.id,
          scope: store.editingScope,
          sceneId: store.activeSceneId,
          stateId: store.activePresentationStateId,
          nodeId,
        })
      }),
    ]

    return () => {
      observer.disconnect()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      handle.destroy()
      gameRef.current = null
      setCanvas(null)
    }
  }, [queueAuthoringNodePatch])

  useLayoutEffect(() => {
    // Scale.NONE deliberately leaves sizing to the unified stage, but Phaser
    // then does not observe ancestor CSS transforms. Refresh its cached canvas
    // bounds after every zoom/pan commit so pointer coordinates stay in the
    // same 1280×720 space as the Player and authoring targets.
    gameRef.current?.game.scale.refresh()
  }, [
    stageTransform.scale,
    stageTransform.stageRect.x,
    stageTransform.stageRect.y,
  ])

  useEffect(() => {
    const handle = gameRef.current
    if (!handle) return
    const previous = previousSceneRef.current
    const componentsChanged =
      previousComponentPackagesRef.current !== componentPackages
    const editingId = useEditorStore.getState().editingTextNodeId

    if (
      previous &&
      previous.id === document.id &&
      !componentsChanged &&
      editingId
    ) {
      const previousIds = previous.nodes.map((node) => node.id).join('|')
      const nextIds = document.nodes.map((node) => node.id).join('|')
      const othersDirty =
        previousIds !== nextIds
        || previous.backgroundColor !== document.backgroundColor
        || previous.backgroundAssetId !== document.backgroundAssetId
        || document.nodes.some((node) => {
          if (node.id === editingId) return false
          const before = previous.nodes.find((item) => item.id === node.id)
          return !before || !nodesEqual(before, node)
        })
      if (!othersDirty) return
    }

    if (
      !previous ||
      previous.id !== document.id ||
      componentsChanged
    ) {
      handle.bridge.loadScene(document, componentPackages)
    } else {
      const previousById = new Map(previous.nodes.map((node) => [node.id, node]))
      const nextById = new Map(document.nodes.map((node) => [node.id, node]))
      previous.nodes.forEach((node) => {
        if (!nextById.has(node.id)) handle.bridge.removeNode(node.id)
      })
      document.nodes.forEach((node) => {
        const before = previousById.get(node.id)
        if (!before) handle.bridge.addNode(node)
        else if (!nodesEqual(before, node) && node.id !== editingId) {
          handle.bridge.applyNode(node)
        }
      })
      const previousIds = previous.nodes.map((node) => node.id).join('|')
      const nextIds = document.nodes.map((node) => node.id).join('|')
      if (previousIds !== nextIds) {
        handle.bridge.reorderNodes(document.nodes.map((node) => node.id))
      }
    }
    if (canvasMode === 'edit' && authoringReadyRef.current) {
      const previousById = new Map(
        previous?.nodes.map((node) => [node.id, node]) ?? [],
      )
      for (const node of document.nodes) {
        if (node.id === editingId) continue
        const before = previousById.get(node.id)
        if (!before || !nodesEqual(before, node)) {
          queueAuthoringNodePatch(editingScope, node)
        }
      }
      if (editingScope === 'scene') {
        if (
          !previous ||
          previous.backgroundColor !== document.backgroundColor ||
          previous.backgroundAssetId !== document.backgroundAssetId
        ) {
          postAuthoringPatch({
            kind: 'scene-background',
            target: { kind: 'scene-background', scope: 'scene' },
            backgroundColor: document.backgroundColor,
            backgroundAssetId: document.backgroundAssetId ?? null,
          })
        }
        const previousOrder = previous?.nodes.map((node) => node.id).join('|')
        const nextOrder = document.nodes.map((node) => node.id).join('|')
        if (previousOrder !== nextOrder) {
          postAuthoringPatch({
            kind: 'scene-order',
            target: { kind: 'scene-order', scope: 'scene' },
            nodeIds: document.nodes.map((node) => node.id),
          })
        }
      }
    }
    previousSceneRef.current = structuredClone(document)
    previousComponentPackagesRef.current = componentPackages
    if (editingId && previous) {
      const oldNode = previous.nodes.find((node) => node.id === editingId)
      if (oldNode) {
        const index = previousSceneRef.current.nodes.findIndex((node) => node.id === editingId)
        if (index >= 0) {
          previousSceneRef.current.nodes[index] = structuredClone(oldNode)
        }
      }
    }
  }, [
    canvasMode,
    componentPackages,
    document,
    editingScope,
    postAuthoringPatch,
    queueAuthoringNodePatch,
  ])

  useEffect(() => {
    gameRef.current?.bridge.selectNodes(selectedNodeIds)
  }, [selectedNodeIds])

  useEffect(() => {
    gameRef.current?.bridge.setTextEditing(editingTextNodeId)
    if (!editingTextNodeId && selectedNode?.type === 'text') {
      gameRef.current?.bridge.applyNode(selectedNode)
    }
  }, [editingTextNodeId, selectedNode])

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (canvasMode !== 'edit') return
    const value = event.dataTransfer.getData(
      'application/x-courseware-element',
    )
    const viewport = stageViewportRef.current
    if (!value || !viewport) return
    const viewportRect = viewport.getBoundingClientRect()
    if (viewportRect.width <= 0 || viewportRect.height <= 0) return
    const transform = createStageViewportTransform({
      viewport: {
        x: viewportRect.left,
        y: viewportRect.top,
        width: viewportRect.width,
        height: viewportRect.height,
      },
      zoom: view.zoom,
      pan: { x: view.x, y: view.y },
    })
    const rect = transform.stageRect
    if (
      event.clientX < rect.x ||
      event.clientX > rect.x + rect.width ||
      event.clientY < rect.y ||
      event.clientY > rect.y + rect.height
    ) {
      return
    }
    const { x, y } = clientToWorld(transform, {
      x: event.clientX,
      y: event.clientY,
    })
    const store = useEditorStore.getState()
    if (value === 'text') store.addTextNode(x, y)
    else if (value === 'formula') store.addFormulaNode(x, y)
    else if (value === 'rectangle') store.addRectangleNode(x, y)
    else if (value.startsWith('shape:')) {
      store.addShapeNode(value.slice('shape:'.length) as Parameters<typeof store.addShapeNode>[0], x, y)
    }
    else if (value === 'image') onAddImage(x, y)
    else if (value === 'video') onAddVideo(x, y)
    else if (value.startsWith('component-preset:')) {
      const [encodedPackageId, encodedPresetId] = value
        .slice('component-preset:'.length)
        .split(':', 2)
      if (encodedPackageId && encodedPresetId) {
        store.addExternalComponentNode(
          decodeURIComponent(encodedPackageId),
          x,
          y,
          decodeURIComponent(encodedPresetId),
        )
      }
    }
    else if (value.startsWith('component:')) {
      store.addExternalComponentNode(value.slice('component:'.length), x, y)
    }
  }

  return (
    <main
      ref={workspaceRef}
      className={`workspace workspace--${canvasMode}`}
      aria-label="课件画布"
      onDragOver={(event) => {
        if (canvasMode !== 'edit') return
        if (
          event.dataTransfer.types.includes(
            'application/x-courseware-element',
          )
        ) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={onDrop}
      onWheel={(event) => {
        if (canvasMode !== 'edit' || (!event.ctrlKey && !event.metaKey)) return
        event.preventDefault()
        setZoom(view.zoom + (event.deltaY < 0 ? 0.1 : -0.1))
      }}
      onPointerDownCapture={(event) => {
        if (
          canvasMode === 'edit' &&
          (event.button === 1 || (event.button === 0 && spacePressedRef.current))
        ) {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          panRef.current = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            originX: view.x,
            originY: view.y,
          }
          setPanning(true)
          return
        }
        if (
          slideBackendKind !== 'slide-authoring' ||
          canvasMode !== 'edit' ||
          event.button !== 0
        ) return
        if (
          event.target instanceof Element &&
          event.target.closest(
            '.canvas-plain-text-editor, .text-edit-overlay, .text-edit-toolbar, .formula-edit-dialog, .canvas-mode-switch, .canvas-view-controls',
          )
        ) return
        const store = useEditorStore.getState()
        if (store.editingTextNodeId || store.v9ContentEdit) {
          event.preventDefault()
          event.stopPropagation()
          const editingId = store.editingTextNodeId
          if (editingId) {
            store.commitTextEdit()
            syncCommittedTextNode(editingId)
          }
          return
        }
        const viewport = readCandidateViewport()
        if (!viewport) return
        if (store.editingScope === 'global') {
          const controllerResult = controllerAuthoringRef.current.pointerDown({
            x: event.clientX,
            y: event.clientY,
          }, viewport)
          if (
            controllerResult.kind !== 'v8' &&
            controllerGestureConsumed(
              controllerResult.overlay,
              controllerResult.preview,
              controllerResult.target,
            )
          ) {
            controllerPointerActiveRef.current = true
            if (controllerResult.target) {
              store.selectNode(controllerResult.target.layerItemId)
            }
            setControllerOverlay(controllerResult.overlay)
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
            event.stopPropagation()
            return
          }
        }
        const result = slideAuthoringRef.current.pointerDown({
          x: event.clientX,
          y: event.clientY,
          additive: event.shiftKey || event.ctrlKey || event.metaKey,
        }, viewport)
        if (result.kind === 'v8') return
        candidatePointerActiveRef.current = true
        paintSlideTransformPreview(result.preview)
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerMoveCapture={(event) => {
        const pan = panRef.current
        if (!pan || pan.pointerId !== event.pointerId) {
          if (
            slideBackendKind === 'slide-authoring' &&
            controllerPointerActiveRef.current
          ) {
            const viewport = readCandidateViewport()
            if (viewport) {
              const controllerResult = controllerAuthoringRef.current.pointerMove({
                x: event.clientX,
                y: event.clientY,
              }, viewport)
              if (controllerResult.kind !== 'v8') {
                setControllerOverlay(controllerResult.overlay)
              }
              event.preventDefault()
              event.stopPropagation()
              return
            }
          }
          if (
            slideBackendKind === 'slide-authoring' &&
            candidatePointerActiveRef.current
          ) {
            const viewport = readCandidateViewport()
            if (viewport) {
              const moved = slideAuthoringRef.current.pointerMove({
                x: event.clientX,
                y: event.clientY,
              }, viewport)
              if (moved.kind !== 'v8') paintSlideTransformPreview(moved.preview)
              event.preventDefault()
              event.stopPropagation()
              return
            }
          }
          const hit = canvasAuthoringHitAtClientPoint(event.clientX, event.clientY)
          setHoveredAuthoringTargetId((current) => (
            current === hit?.target.targetId
              ? current
              : hit?.target.targetId ?? null
          ))
          return
        }
        event.preventDefault()
        event.stopPropagation()
        setView((current) => ({
          ...current,
          x: pan.originX + event.clientX - pan.clientX,
          y: pan.originY + event.clientY - pan.clientY,
        }))
      }}
      onPointerUpCapture={(event) => {
        if (
          slideBackendKind === 'slide-authoring' &&
          controllerPointerActiveRef.current
        ) {
          const viewport = readCandidateViewport()
          if (viewport) {
            const controllerResult = useEditorStore.getState().editingScope === 'global'
              ? controllerAuthoringRef.current.pointerUp({
                  x: event.clientX,
                  y: event.clientY,
                }, viewport)
              : controllerAuthoringRef.current.pointerCancel({
                  x: event.clientX,
                  y: event.clientY,
                }, viewport)
            if (controllerResult.kind !== 'v8') {
              setControllerOverlay(
                useEditorStore.getState().editingScope === 'global'
                  ? controllerResult.overlay
                  : null,
              )
            }
          }
          controllerPointerActiveRef.current = false
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          slideBackendKind === 'slide-authoring' &&
          candidatePointerActiveRef.current
        ) {
          const viewport = readCandidateViewport()
          if (viewport) {
            const raised = slideAuthoringRef.current.pointerUp({
              x: event.clientX,
              y: event.clientY,
            }, viewport)
            if (raised.kind !== 'v8') paintSlideTransformPreview(raised.preview)
          }
          candidatePointerActiveRef.current = false
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (panRef.current?.pointerId !== event.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        panRef.current = null
        setPanning(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      }}
      onPointerCancelCapture={(event) => {
        if (
          slideBackendKind === 'slide-authoring' &&
          controllerPointerActiveRef.current
        ) {
          const viewport = readCandidateViewport()
          if (viewport) {
            controllerAuthoringRef.current.pointerCancel({
              x: event.clientX,
              y: event.clientY,
            }, viewport)
          }
          controllerPointerActiveRef.current = false
          setControllerOverlay(null)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (panRef.current?.pointerId === event.pointerId) {
          panRef.current = null
          setPanning(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }
      }}
      onPointerLeave={() => setHoveredAuthoringTargetId(null)}
      onDoubleClickCapture={(event) => {
        if (
          !authoringCanvasInteractive ||
          (event.target instanceof Element &&
            event.target.closest(
              '.canvas-plain-text-editor, .text-edit-overlay, .text-edit-toolbar, .formula-edit-dialog',
            ))
        ) {
          return
        }
        if (slideBackendKind === 'slide-authoring') {
          const viewport = readCandidateViewport()
          if (!viewport) return
          const world = clientToWorld(createStageViewportTransform(viewport), {
            x: event.clientX,
            y: event.clientY,
          })
          const layerHit = hitTestV9SlideLayerItems(
            listSlideWorkspaceHitTargets(),
            world,
          )
          if (layerHit) {
            const selected = selectEditingNodes(useEditorStore.getState()).find(
              (node) => node.id === layerHit.layerItemId,
            )
            if (selected?.type === 'text' || selected?.type === 'formula') {
              event.preventDefault()
              event.stopPropagation()
              const store = useEditorStore.getState()
              store.selectNode(layerHit.layerItemId)
              useEditorStore.getState().beginTextEdit(layerHit.layerItemId, 'canvas')
              if (selected.type === 'formula') {
                setActiveFormulaEditSession({
                  projectId: store.project.id,
                  scope: store.editingScope,
                  sceneId: store.slideCandidateSnapshot?.sceneId ?? store.activeSceneId,
                  stateId: store.slideCandidateSnapshot?.stateId ?? store.activePresentationStateId,
                  nodeId: layerHit.layerItemId,
                })
              }
              return
            }
          }
        }
        const hit = canvasAuthoringHitAtClientPoint(event.clientX, event.clientY)
        if (!hit) return
        event.preventDefault()
        event.stopPropagation()
        if (hit.kind === 'component') {
          beginComponentTextEdit(hit.target)
        } else if (hit.target.kind === 'text') {
          beginRuntimeTextEdit(hit.target)
        } else {
          void replaceRuntimeAsset(hit.target)
        }
      }}
    >
      <div className="canvas-mode-switch" role="group" aria-label="画布模式">
        <button
          type="button"
          className={canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'edit'}
          onClick={() => setCanvasMode('edit')}
        >
          <MousePointer2 size={13} />编辑状态
        </button>
        <button
          type="button"
          className={canvasMode === 'run' ? 'canvas-mode-switch__active' : ''}
          aria-pressed={canvasMode === 'run'}
          onClick={() => setCanvasMode('run')}
        >
          <Play size={13} />当前位置试运行
        </button>
        {useCoursePlayerTryRun ? (
          <div
            role="group"
            aria-label="试运行翻页"
            data-testid="course-try-run-chrome"
            style={{ display: 'flex', gap: 6, marginLeft: 8 }}
          >
            <button
              type="button"
              data-testid="course-try-run-previous"
              onClick={() => void courseTryRunSessionRef.current?.previous()}
            >
              上一页
            </button>
            <button
              type="button"
              data-testid="course-try-run-next"
              onClick={() => void courseTryRunSessionRef.current?.next()}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
      {canvasMode === 'edit' && (
        <div className="canvas-view-controls" role="group" aria-label="画布视图">
          <button type="button" aria-label="缩小画布" onClick={() => setZoom(view.zoom - 0.1)}>
            <Minus size={14} />
          </button>
          <output aria-label="画布缩放比例">{Math.round(view.zoom * 100)}%</output>
          <button type="button" aria-label="放大画布" onClick={() => setZoom(view.zoom + 0.1)}>
            <Plus size={14} />
          </button>
          <button type="button" aria-label="适合窗口" title="重置缩放与平移" onClick={resetView}>
            <Maximize2 size={14} />
          </button>
          <span title="Ctrl+滚轮缩放；按住空格或鼠标中键拖动画布">
            <Hand size={13} />
          </span>
        </div>
      )}
      <div className={`canvas-label${editingScope === 'global' ? ' canvas-label--global' : ''}`}>
        1280 × 720 · {editingScope === 'global'
          ? `全局层 · ${editingNodes.length} 个元素`
          : `${scene.name} · ${activePresentationStateId === null
            ? '基础'
            : ensureScenePresentation(scene).states.find((state) => state.id === activePresentationStateId)?.name ?? '状态'}`}
      </div>
      <div ref={stageViewportRef} className="canvas-viewport">
        <div
          className="canvas-stage-stack"
          data-panning={panning || undefined}
          style={{
            left: stageTransform.stageRect.x,
            top: stageTransform.stageRect.y,
            width: STAGE_VIEWPORT_WIDTH,
            height: STAGE_VIEWPORT_HEIGHT,
            transform: `scale(${stageTransform.scale})`,
            // Geometry must change atomically: the Player, Phaser hit proxies and
            // authoring targets all consume this transform in the same frame.
            transition: 'none',
          }}
        >
          {usePublishedAuthoring && (
            <div
              ref={publishedAuthoringHostRef}
              className="runtime-preview-frame published-authoring-host"
              data-testid="published-authoring-host"
              title="统一编辑画布"
              inert
              aria-hidden="true"
            />
          )}
          <div
            ref={gameHostRef}
            className="canvas-stage canvas-stage--authoring"
            data-testid="canvas-stage"
            aria-hidden={canvasMode === 'run'}
            style={useCoursePlayerTryRun ? { pointerEvents: 'none' } : undefined}
          />
          {authoringCanvasInteractive && (
            visibleRuntimeTargets.length > 0 ||
            visibleComponentTargets.length > 0 ||
            activeRuntimeTextTarget ||
            activeComponentTextTarget
          ) && (
            <div
              className="canvas-authoring-targets"
              data-testid="runtime-authoring-targets"
              aria-label="画布可编辑内容"
            >
              {visibleRuntimeTargets.map((target) => (
                <button
                  key={target.targetId}
                  type="button"
                  className={`canvas-authoring-target canvas-authoring-target--${target.kind}${
                    hoveredAuthoringTargetId === target.targetId
                      ? ' canvas-authoring-target--hovered'
                      : ''
                  }`}
                  aria-label={`${target.label ?? target.key}，双击${target.kind === 'text' ? '编辑文字' : '替换图片'}`}
                  title={`双击${target.kind === 'text' ? '编辑文字' : '替换图片'}：${target.label ?? target.key}`}
                  disabled={replacingRuntimeAssetTargetId === target.targetId}
                  style={{
                    left: target.bounds.x,
                    top: target.bounds.y,
                    width: target.bounds.width,
                    height: target.bounds.height,
                    zIndex: target.layer === 'overlay' ? 2 : 1,
                  }}
                  onFocus={() => setHoveredAuthoringTargetId(target.targetId)}
                  onBlur={() => setHoveredAuthoringTargetId(null)}
                  onClick={() => {
                    if (target.kind === 'text') {
                      beginRuntimeTextEdit(target)
                    } else {
                      setActiveComponentTextSession(null)
                      void replaceRuntimeAsset(target)
                    }
                  }}
                >
                  <span className="canvas-authoring-target__badge" aria-hidden="true">
                    {target.kind === 'asset'
                      ? <ImagePlus size={14} />
                      : 'T'}
                    <span>{target.label ?? target.key}</span>
                  </span>
                </button>
              ))}
              {activeRuntimeTextSession && activeRuntimeTextTarget?.kind === 'text' && (
                <CanvasPlainTextEditor
                  key={activeRuntimeTextTarget.targetId}
                  bounds={activeRuntimeTextTarget.bounds}
                  label={activeRuntimeTextTarget.label ?? activeRuntimeTextTarget.key}
                  value={activeRuntimeTextValue}
                  multiline={activeRuntimeTextTarget.multiline}
                  maxLength={activeRuntimeTextTarget.maxLength}
                  onCommit={(value) => commitRuntimeText(activeRuntimeTextSession, value)}
                  onCancel={() => setActiveRuntimeTextSession(null)}
                />
              )}
              {visibleComponentTargets.map((target) => (
                <button
                  key={target.targetId}
                  type="button"
                  className={`canvas-authoring-target canvas-authoring-target--component-text${
                    hoveredAuthoringTargetId === target.targetId
                      ? ' canvas-authoring-target--hovered'
                      : ''
                  }`}
                  aria-label={`${target.label}，双击编辑组件文字`}
                  title={`双击编辑组件文字：${target.label}`}
                  style={{
                    left: target.bounds.x,
                    top: target.bounds.y,
                    width: target.bounds.width,
                    height: target.bounds.height,
                    zIndex: 3,
                    transform: `rotate(${target.rotation}deg)`,
                  }}
                  onFocus={() => setHoveredAuthoringTargetId(target.targetId)}
                  onBlur={() => setHoveredAuthoringTargetId(null)}
                  onClick={() => beginComponentTextEdit(target)}
                >
                  <span className="canvas-authoring-target__badge" aria-hidden="true">
                    T<span>{target.label}</span>
                  </span>
                </button>
              ))}
              {activeComponentTextSession && activeComponentTextTarget && componentEditingNode && (
                <CanvasPlainTextEditor
                  key={activeComponentTextTarget.targetId}
                  bounds={activeComponentTextTarget.bounds}
                  label={activeComponentTextTarget.label}
                  value={componentEditingValue}
                  multiline={activeComponentTextTarget.multiline}
                  maxLength={activeComponentTextTarget.maxLength}
                  rotation={activeComponentTextTarget.rotation}
                  onCommit={(value) => commitComponentText(
                    activeComponentTextSession,
                    value,
                  )}
                  onCancel={() => setActiveComponentTextSession(null)}
                />
              )}
            </div>
          )}
          {previewFeedback && !useCoursePlayerTryRun && (
            <div
              className={`runtime-preview-loading runtime-preview-loading--${previewFeedback.kind}`}
              role={previewFeedback.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              <div className="runtime-preview-loading__panel">
                {previewFeedback.kind === 'loading' && (
                  <LoaderCircle
                    className="runtime-preview-loading__spinner"
                    size={24}
                    aria-hidden="true"
                  />
                )}
                <strong>{previewFeedback.title}</strong>
                <span>{previewFeedback.message}</span>
                {previewFeedback.kind === 'error' && (
                  <button type="button" onClick={retryRuntimePreview}>
                    <RotateCcw size={14} aria-hidden="true" />重新载入画布
                  </button>
                )}
              </div>
            </div>
          )}
          {!previewFeedback && !useCoursePlayerTryRun && !usePublishedAuthoring && (
            <div className="runtime-preview-loading" role="status" aria-live="polite">
              <div className="runtime-preview-loading__panel">
                <LoaderCircle
                  className="runtime-preview-loading__spinner"
                  size={24}
                  aria-hidden="true"
                />
                <strong>正在准备统一画布</strong>
              </div>
            </div>
          )}
        </div>
        <div
          ref={courseTryRunRef}
          className="course-try-run-host"
          data-testid="course-try-run-host"
          hidden={!useCoursePlayerTryRun}
        />
        {tryRunFeedback && useCoursePlayerTryRun ? (
          <div
            className={`runtime-preview-loading runtime-preview-loading--${tryRunFeedback.kind} course-try-run-feedback`}
            role={tryRunFeedback.kind === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <div className="runtime-preview-loading__panel">
              {tryRunFeedback.kind === 'loading' && (
                <LoaderCircle
                  className="runtime-preview-loading__spinner"
                  size={24}
                  aria-hidden="true"
                />
              )}
              <strong>{tryRunFeedback.title}</strong>
              <span>{tryRunFeedback.message}</span>
            </div>
          </div>
        ) : null}
      </div>
      {canvasMode === 'edit' && editingScope === 'global' && controllerOverlay ? (
        <TeacherControllerAuthoringOverlay overlay={controllerOverlay} />
      ) : null}
      {canvasMode === 'edit' && editingFormulaNode && (
        <FormulaEditDialog
          key={`${editingFormulaNode.id}:${activePresentationStateId ?? 'base'}`}
          node={editingFormulaNode}
          onCancel={() => setActiveFormulaEditSession(null)}
          onCommit={(ast, accessibleText) => {
            const store = useEditorStore.getState()
            const backend = selectSlideAuthoringBackend(store)
            if (backend && store.v9ContentEdit?.kind === 'formula') {
              const edited = updateV9SlideContentFormulaDraft(store.v9ContentEdit, {
                ast,
                accessibleText,
              })
              store.applySlideCandidateCommand(
                (session) => commitV9SlideContentEdit(session, edited),
                { clearContentEdit: true },
              )
              setActiveFormulaEditSession(null)
              return
            }
            store.updateNode(editingFormulaNode.id, {
              ast,
              accessibleText,
            })
            setActiveFormulaEditSession(null)
          }}
        />
      )}
      {canvasMode === 'edit' && editingNode && workspaceRef.current && (gameHostRef.current || canvas) && (
        <TextEditOverlay
          key={editingNode.id}
          node={editingNode}
          workspace={workspaceRef.current}
          canvas={gameHostRef.current ?? canvas!}
          onPreview={(text, runs) => {
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            useEditorStore
              .getState()
              .updateTextEditDraft(
                editingNode.id,
                text,
                runs,
                rendered?.height ?? editingNode.height,
                rendered?.width ?? editingNode.width,
              )
          }}
          onCommit={(text, runs) => {
            const store = useEditorStore.getState()
            const draftNode = { ...editingNode, text, runs }
            const rendered = editingNode.style.overflow === 'auto-height'
              ? renderTextNodeCanvas(draftNode)
              : null
            store.updateTextEditDraft(
              editingNode.id,
              text,
              runs,
              rendered?.height ?? editingNode.height,
              rendered?.width ?? editingNode.width,
            )
            store.commitTextEdit()
            syncCommittedTextNode(editingNode.id)
          }}
          onCancel={() => {
            useEditorStore.getState().cancelTextEdit()
            syncCommittedTextNode(editingNode.id)
          }}
        />
      )}
    </main>
  )
}

export { mountSpatialLocationTryRun, mountFlowLocationTryRun }
