import { NativeSelectionContext } from '../../workbench/NativeSelectionContext'
import { useContextMenu, type MenuCommand } from '../../editing/commands/CommandMenu'
import { hiddenObjectCommands, hiddenObjectName } from '../../editing/commands/hiddenObjectCommands'
import { isTeacherController } from '../../../shared/teacherControllerRole'
import { OBJECT_EDIT_EVENT, requestObjectContextMenu } from '../../editing/commands/objectContextMenu'
import { QUICK_BAR_SELECTOR } from '../../editing/quickbar/usePointerGesture'
import { useControllerDisplayRevision } from '../../authoring/controllerDisplayBounds'

import { chartCanvasTextPort } from '../../authoring/chartCanvasTextBridge'
import { EditableChartView } from '../EditableChartView'
import { useAssetObjectUrls } from '../useAssetObjectUrls'
import { WebCompositionAuthoringContent, type CompositionAuthoringSelection } from '../../composition/WebCompositionAuthoringContent'
import type { CompositionContentEdit } from '../../../shared/composition/edit'
import { publishLayerItem } from '../../export/course/buildPublishedCourse'
import type { PublishedCompositionLayerItem } from '../../../shared/publishedCourseTypes'
import type { ChartTextDraft } from '../../authoring/chartTextDraft'
import { Hand, Maximize2, Minus, MousePointer2, Play, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceMediaSource } from '../../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop, type WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../../lessonWorkspace/workspaceMediaDrag'
import type { ComponentPackageData } from '../../../shared/componentTypes'

import type {
  CourseProjectDocument,
  LayerItem,
  NativeLayerItem,
} from '../../../shared/courseProjectTypes'
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
  logicalStageViewport,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  type StageSelectionOverlayGeometry,
} from '../../authoring/stageViewportTransform'
import { isTeacherControllerLayerItem } from '../../../core/tools/globalLayers'
import { courseSlideCanvas } from '../../../shared/slideCanvas'
import { workspaceTryRunHostProps } from '../../../shared/pageFrame'
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
import { authoringObservationCameraToken, authoringObservationDraftToken } from '../../authoring/generation/authoringObservation'
import { adaptV9SpatialEditorLayers, hitTestV9SpatialLayerItems } from '../../phaser/v9SpatialHitAdapter'
import { FormulaEditDialog } from '../FormulaEditDialog'
import { PublishedNativeContent } from '../PublishedNativeContent'
import { planNativeTextEdit } from '../../../core/tools/nativeText'
import type { EditSessionSnapshot } from '../../../shared/workbench/editSession'
import { cancelEditPreview, useEditPreview } from '../../workbench/EditPreviewProjection'
import {
} from '../coursePlayerTryRun'
import {
  beginSerializedSessionMount,
  enqueueSerial,
} from '../serializedSessionMount'
import { TeacherControllerAuthoringChrome } from '../TeacherControllerAuthoringChrome'
import { TextEditOverlay } from '../TextEditOverlay'
import {
  isSpatialGlobalCanvasRuntimeLayer,
  SpatialGlobalRuntimeAuthoring,
  SpatialGlobalRuntimeMountTarget,
  type SpatialRuntimeContentAuthoringPort,
} from './spatial/SpatialGlobalRuntimeAuthoring'

export type SpatialCanvasMode = 'edit' | 'run'

export interface SpatialLocationWorkspaceProps {
  readonly documentId?: string | null
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
  readonly project: CourseProjectDocument
  readonly runtimeContentAuthoring: SpatialRuntimeContentAuthoringPort
  readonly worldTarget: CourseAuthoringTarget
  readonly layerTargets: ReadonlyMap<string, CourseAuthoringTarget>
  /** Targets for property patches of whole items (M21: showing hidden objects again). */
  readonly layerItemTargets?: ReadonlyMap<string, CourseAuthoringTarget>
  readonly commands: SpatialAuthoringCommandPort
  readonly onCanvasModeChange: (mode: SpatialCanvasMode) => void
  readonly onMountTryRun: (container: HTMLElement) => Promise<PublishedCourseSession>
  readonly onDropWorkspaceMedia?: WorkspaceMediaDropHandler
  /** The keyboard's Ctrl+V and Ctrl+A, for the canvas right-click menu. */
  readonly onPaste?: () => void
  readonly onSelectAll?: () => void
  readonly onEditComposition?: (layerItemId: string) => void
  readonly onCompositionEdit?: (layerItemId: string, edit: CompositionContentEdit) => Promise<void>
  readonly onCompositionSelection?: (selection: CompositionAuthoringSelection) => void
  readonly selectedCompositionNode?: CompositionAuthoringSelection | null
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

function spatialLayerPaintKind(item: {
  readonly kind: LayerItem['kind']
  readonly content?: unknown
}): string {
  if (item.kind === 'component') return 'external-component'
  if (item.kind === 'runtime') return 'runtime'
  return item.kind === 'native' && item.content && typeof item.content === 'object' && 'nativeType' in item.content
    ? String(item.content.nativeType) : item.kind
}

function spatialNativePaint(
  item: LayerItem,
  assetUrls: Readonly<Record<string, string>>,
  size: { width: number; height: number },
) {
  return item.kind === 'native'
    ? <PublishedNativeContent item={item} assetUrls={assetUrls} size={size} />
    : item.label || item.kind
}
function spatialNativeTextPreview(item: LayerItem, preview: EditSessionSnapshot | null): LayerItem {
  if (!preview || preview.target.kind !== 'course-object' ||
    item.kind !== 'native' || item.content.nativeType !== 'text' ||
    item.layerItemId !== preview.target.itemId) return item
  const planned = planNativeTextEdit(item.content.data, { text: preview.value })
  return {
    ...item,
    content: { ...item.content, data: {
      ...item.content.data,
      text: preview.value,
      runs: planned.ok ? planned.data.runs : [],
    } },
  }
}
function SpatialComponentItemContent({
  projectId,
  layerItemId,
  item,
  componentPackages,
  assetUrls,
}: {
  projectId: string
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
      projectId,
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
  }, [item.component.packageId, item.component.version, layerItemId, item.frame.width, item.frame.height, item.props, item.staticFallbackAssetId, componentPackages, assetUrls, pkg, projectId])

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
  documentId,
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
  project,
  runtimeContentAuthoring,
  worldTarget,
  layerTargets,
  layerItemTargets,
  commands,
  onCanvasModeChange,
  onMountTryRun,
  onDropWorkspaceMedia,
  onPaste,
  onSelectAll,
  onEditComposition,
  onCompositionEdit,
  onCompositionSelection,
  selectedCompositionNode,
}: SpatialLocationWorkspaceProps) {
  const canvasMenu = useContextMenu()
  const selectionRef = useRef(selectionIds)
  selectionRef.current = selectionIds
  const mediaSource = useWorkspaceMediaSource()
  const mediaSourceRef = useRef(mediaSource)
  mediaSourceRef.current = mediaSource
  const workspaceRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const stageStackRef = useRef<HTMLDivElement>(null)
  const tryRunRef = useRef<HTMLDivElement>(null)
  const tryRunMountChainRef = useRef(Promise.resolve())
  const textProxyCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // The camera frame has the course canvas ratio, so a portrait course keeps a portrait camera (M19).
  const stageCanvas = courseSlideCanvas(project)
  const stageViewport = useMemo(() => logicalStageViewport(stageCanvas), [stageCanvas.width, stageCanvas.height])
  const hostRef = useRef<PublishedCourseSession | null>(null)
  const pointerActiveRef = useRef(false)
  const [compositionSelection, setCompositionSelection] = useState<{ layerItemId: string; nodeId: string } | null>(null)
  const [compositionPending, setCompositionPending] = useState(false)
  const activeCompositionNode = selectedCompositionNode === undefined ? compositionSelection : selectedCompositionNode
  const compositionSubmitting = useRef(false)
  const submitComposition = async (layerItemId: string, edit: CompositionContentEdit) => {
    if (!onCompositionEdit) throw new Error('当前组合内容不可编辑')
    if (compositionSubmitting.current) throw new Error('上一处修改正在保存，请稍后再操作。')
    compositionSubmitting.current = true; setCompositionPending(true)
    try { await onCompositionEdit(layerItemId, edit) }
    finally { compositionSubmitting.current = false; setCompositionPending(false) }
  }
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 450 })
  const [previewFrames, setPreviewFrames] = useState<readonly SpatialEditorWorldTransform[] | null>(null)
  const [previewCamera, setPreviewCamera] = useState<SpatialSessionCamera | null>(null)
  const [worldOverlay, setWorldOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const [hudOverlay, setHudOverlay] = useState<StageSelectionOverlayGeometry | null>(null)
  const [textCanvas, setTextCanvas] = useState<HTMLCanvasElement | null>(null)
  const [previewNotice, setPreviewNotice] = useState(false)
  const [mediaDragOver, setMediaDragOver] = useState(false)
  const [mediaDropError, setMediaDropError] = useState<string | null>(null)
  const editPreview = useEditPreview(documentId, project.revision)
  const activeTextPreview = canvasMode === 'edit' && documentId &&
    editPreview?.documentId === documentId && editPreview.status !== 'aborted' &&
    editPreview.sequence >= 0 && editPreview.target.kind === 'course-object' &&
    editPreview.target.locationId === view.locationId ? editPreview : null

  useEffect(() => { setPreviewNotice(false) }, [activeTextPreview?.editId])
  useEffect(() => {
    if (!activeTextPreview || activeTextPreview.status !== 'active') return
    const onUndo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return
      if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void cancelEditPreview(activeTextPreview)
    }
    window.addEventListener('keydown', onUndo, true)
    return () => window.removeEventListener('keydown', onUndo, true)
  }, [activeTextPreview])

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
  // Hidden objects of the current layer (and a hidden teacher controller, as on a slide) stay findable (M21): the
  // label counts them, and a menu shows them again.
  const hiddenLayers = canvasMode === 'edit' ? view.layers.filter((layer) => !layer.item.visible
    && (layer.source === scope || (scope !== 'global' && layer.source === 'global' && isTeacherController(layer.item)))) : []
  const hiddenMenu = (): MenuCommand[] => hiddenObjectCommands(
    hiddenLayers.map((layer) => ({ id: layer.selectionId, name: hiddenObjectName(layer.item) })),
    (ids) => {
      const targets = ids.map((id) => layerItemTargets?.get(id))
      if (!targets[0] || targets.some((target) => !target)) return
      // Layer patches apply to the selection: select the objects, then show them (they stay selected, in view).
      if (!commandsRef.current.run(worldTarget, { kind: 'select-layers', layerItemIds: [...ids], expectedContentEdit: contentEditRef.current }).ok) return
      commandsRef.current.run(targets[0], {
        kind: 'patch-layers',
        updates: targets.map((target) => ({ target: target!, patch: { visible: true } })),
        expectedSelectionIds: [...ids],
        expectedContentEdit: contentEditRef.current,
      })
    },
  )
  // The quick bar's and menus' 编辑公式 open the formula editor as a double-click does (M21).
  useEffect(() => {
    const root = workspaceRef.current
    if (!root || canvasMode !== 'edit') return
    const request = (event: Event) => {
      const itemId = (event as CustomEvent<{ itemId: string }>).detail?.itemId
      if (itemId && authoringRef.current.beginContentEdit(itemId)?.ok) event.preventDefault()
    }
    root.addEventListener(OBJECT_EDIT_EVENT, request)
    return () => root.removeEventListener(OBJECT_EDIT_EVENT, request)
  }, [canvasMode])

  const measureViewport = useCallback(() => {
    const node = viewportRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    setViewportSize(current => current.width === rect.width && current.height === rect.height
      ? current : { width: rect.width, height: rect.height })
  }, [])

  // The editor can change the available canvas area in the same React commit
  // as a file or panel switch. Fit the painted stage before the next pointer.
  useLayoutEffect(() => { measureViewport() })

  useLayoutEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const observer = new ResizeObserver(measureViewport)
    observer.observe(node)
    return () => observer.disconnect()
  }, [measureViewport])

  const readLogicalPointer = useCallback((clientX: number, clientY: number) => {
    // Hit testing must invert the stage that is actually painted. The live
    // viewport can resize before ResizeObserver commits the next fit scale.
    const painted = stageStackRef.current?.getBoundingClientRect()
    if (!painted || painted.width <= 0 || painted.height <= 0) return null
    return {
      x: (clientX - painted.left) * stageViewport.width / painted.width,
      y: (clientY - painted.top) * stageViewport.height / painted.height,
    }
  }, [stageViewport])

  const liveCamera = previewCamera ?? view.sessionCamera
  const stageTransform = useMemo(() => createStageViewportTransform({
    viewport: {
      x: 0,
      y: 0,
      width: Math.max(1, viewportSize.width),
      height: Math.max(1, viewportSize.height),
    },
    stage: stageViewport,
    zoom: 1,
  }), [viewportSize.height, viewportSize.width, stageViewport])
  const worldTransform = useMemo(() => createSpatialWorldViewTransform(
    stageViewport,
    liveCamera,
  ), [liveCamera, stageViewport])
  const hudTransform = useMemo(() => createSpatialViewportOverlayTransform(
    stageViewport,
  ), [stageViewport])

  const worldItems = view.layers.filter((layer) => layer.coordinateSpace === 'world')
  const hudItems = view.layers.filter((layer) => layer.coordinateSpace === 'viewport')
  const hudUnderlayItems = hudItems.filter((layer) => (
    layer.source === 'global' && layer.globalPlane === 'underlay'
  ))
  const hudOverlayItems = hudItems.filter((layer) => !(
    layer.source === 'global' && layer.globalPlane === 'underlay'
  ))
  const previewById = new Map((previewFrames ?? []).map((frame) => [frame.layerItemId, frame]))
  const controllerDisplayRevision = useControllerDisplayRevision()
  const targetIds = new Set(targets.map((target) => target.layerItemId))

  useEffect(() => {
    if (canvasMode !== 'edit') {
      setWorldOverlay(null)
      setHudOverlay(null)
      return
    }
    const authoring = authoringRef.current
    setWorldOverlay(authoring.overlayGeometry(stageViewport))
    setHudOverlay(authoring.viewportOverlayGeometry(stageViewport))
  }, [canvasMode, scope, view, selectionIds, controllerDisplayRevision, stageViewport])

  useEffect(() => {
    const container = tryRunRef.current
    if (!container) return
    if (canvasMode !== 'run') {
      const leftover = hostRef.current
      hostRef.current = null
      if (leftover) enqueueSerial(tryRunMountChainRef, () => leftover.destroy())
      return
    }
    return beginSerializedSessionMount(tryRunMountChainRef, () => onMountTryRun(container), {
      onReady: (mounted) => {
        hostRef.current = mounted
      },
      onCleanup: () => {
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

  const assetUrls = useAssetObjectUrls(assetFiles, assetMimeTypes)
  const compositionContents = useMemo(() => {
    const content = new Map<string, PublishedCompositionLayerItem['content']>()
    for (const layer of view.layers) {
      if (layer.item.kind !== 'composition') continue
      const published = publishLayerItem({ project, assetFiles, components: componentPackages }, layer.item as LayerItem)
      if (published.kind === 'composition') content.set(layer.selectionId, published.content)
    }
    return content
  }, [view.layers, project, assetFiles, componentPackages])
  const renderComposition = (layer: (typeof view.layers)[number], size: { width: number; height: number }) => {
    const content = compositionContents.get(layer.selectionId)
    const editable = canvasMode === 'edit' && scope === layer.source && !layer.locked
      && selectionIds.includes(layer.selectionId) && Boolean(onCompositionEdit)
    return content ? <WebCompositionAuthoringContent
      layerItemId={layer.selectionId} content={content} width={size.width} height={size.height}
      sessionKey={`${documentId ?? view.projectId}:${view.surfaceId}`}
      projectId={view.projectId} components={componentPackages} assetUrls={assetUrls} interactive={editable}
      selectedNodeId={editable && activeCompositionNode?.layerItemId === layer.selectionId ? activeCompositionNode.nodeId : null}
      onSelection={editable ? selected => { setCompositionSelection({ layerItemId: selected.layerItemId, nodeId: selected.nodeId }); onCompositionSelection?.(selected) } : undefined}
      onEdit={editable ? edit => submitComposition(layer.selectionId, edit) : undefined} editingDisabled={compositionPending}
    /> : null
  }

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
    setWorldOverlay(authoring.overlayGeometry(stageViewport))
    setHudOverlay(authoring.viewportOverlayGeometry(stageViewport))
  }

  const renderEditableChart = (
    layer: (typeof view.layers)[number],
    size: { width: number; height: number },
  ) => {
    if (layer.item.kind !== 'native' || layer.item.content.nativeType !== 'chart') return null
    const editable = scope === layer.source && !layer.item.locked
    return (
      <EditableChartView
        id={layer.selectionId}
        chart={structuredClone(layer.item.content.data) as import('../../../shared/contracts/native-v1').NativeChartContent}
        width={size.width}
        height={size.height}
        canvasTextPort={() => {
          const target = layerTargets.get(layer.selectionId)
          return target ? chartCanvasTextPort(target) : undefined
        }}
        textController={!editable ? undefined : {
          draft: contentEdit?.kind === 'chart-text' && contentEdit.target.layerItemId === layer.selectionId
            ? contentEdit.draft as ChartTextDraft
            : null,
          begin: (chartField, draft) => {
            const target = layerTargets.get(layer.selectionId)
            if (!target) return false
            const receipt = commands.run(target, {
              kind: 'begin-content-edit',
              chartField,
              source: 'canvas',
              expectedEdit: contentEditRef.current,
              expectedContentEdit: contentEditRef.current,
            })
            if (!receipt.ok || !receipt.edit) return false
            contentEditRef.current = receipt.edit
            const updated = commands.run(target, {
              kind: 'update-chart-content-edit',
              expectedEdit: receipt.edit,
              expectedContentEdit: receipt.edit,
              draft,
              composing: false,
            })
            if (updated.ok && updated.edit) contentEditRef.current = updated.edit
            return updated.ok
          },
          update: (draft, composing) => {
            const edit = contentEditRef.current
            if (!edit?.courseTarget || edit.kind !== 'chart-text') return
            const receipt = commands.run(edit.courseTarget, {
              kind: 'update-chart-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
              draft,
              composing,
            })
            if (receipt.ok && receipt.edit) contentEditRef.current = receipt.edit
          },
          commit: () => {
            const edit = contentEditRef.current
            if (!edit?.courseTarget || edit.kind !== 'chart-text') return
            const receipt = commands.run(edit.courseTarget, {
              kind: 'commit-chart-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
            })
            if (receipt.ok) contentEditRef.current = null
          },
          cancel: () => {
            const edit = contentEditRef.current
            if (!edit?.courseTarget || edit.kind !== 'chart-text') return
            const receipt = commands.run(edit.courseTarget, {
              kind: 'cancel-content-edit',
              expectedEdit: edit,
              expectedContentEdit: edit,
            })
            if (receipt.ok) contentEditRef.current = null
          },
        }}
        onCommit={!editable ? undefined : (chart) => {
          const target = layerTargets.get(layer.selectionId)
          if (!target) return '图表目标已失效'
          const receipt = commands.run(target, {
            kind: 'replace-chart',
            chart,
            expectedContentEdit: contentEdit,
          })
          return receipt.ok ? null : receipt.reason ?? '图表提交失败'
        }}
      />
    )
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
        width: stageViewport.width,
        height: stageViewport.height,
        transform: `scale(${hudTransform.scale})`,
        pointerEvents: 'none',
      }}
    >
      {items.map((layer) => {
        const globalRuntime = isSpatialGlobalCanvasRuntimeLayer(layer)
        if (
          layer.item.kind !== 'native'
          && layer.item.kind !== 'component'
          && layer.item.kind !== 'composition'
          && !globalRuntime
        ) return null
        if (layer.item.kind === 'composition' && !layer.effectiveVisible) return null
        const preview = previewById.get(layer.selectionId)
        const frame = preview ?? layer.item.frame
        const paintKind = spatialLayerPaintKind(layer.item)
        const controller = isTeacherControllerLayerItem(layer.item as LayerItem)
        const rotation = preview?.rotation ?? layer.item.rotation
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
              opacity: layer.item.opacity,
              background: 'transparent',
              overflow: controller ? 'visible' : 'hidden',
            }}
          >
            {globalRuntime ? (
              <SpatialGlobalRuntimeMountTarget itemId={layer.selectionId} />
            ) : controller ? (
              <TeacherControllerAuthoringChrome
                projectId={view.projectId} componentPackages={componentPackages} assetUrls={assetUrls}
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
            ) : layer.item.kind === 'composition' ? renderComposition(layer, size) : layer.item.kind === 'component' ? (
              <SpatialComponentItemContent
                projectId={view.projectId}
                layerItemId={layer.selectionId}
                item={layer.item as LayerItem}
                componentPackages={componentPackages}
                assetUrls={assetUrls}
              />
            ) : layer.item.kind === 'native' && layer.item.content.nativeType === 'chart' ? (
              renderEditableChart(layer, size)
            ) : (
              spatialNativePaint(spatialNativeTextPreview(layer.item as LayerItem, activeTextPreview), assetUrls, size)
            )}
          </div>
        )
      })}
    </div>
  )

  const readMediaDropPoint = (clientX: number, clientY: number) => {
    const stage = readLogicalPointer(clientX, clientY)
    if (!stage || stage.x < 0 || stage.y < 0 || stage.x > stageViewport.width || stage.y > stageViewport.height) return null
    return clientToWorld(createSpatialWorldViewTransform(stageViewport, view.sessionCamera), stage)
  }
  const dropWorkspaceMedia = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE) || !onDropWorkspaceMedia) return
    event.preventDefault(); event.stopPropagation(); setMediaDragOver(false)
    if (canvasMode !== 'edit' || scope !== 'world') { setMediaDropError('请切换到可编辑的无限画布世界层后拖入媒体'); return }
    const point = readMediaDropPoint(event.clientX, event.clientY)
    if (!point) { setMediaDropError('请将媒体拖到无限画布内容区域内'); return }
    const target = { documentId: documentId ?? null, projectId: view.projectId, revision: project.revision,
      locationId: view.locationId, surfaceId: view.surfaceId, sessionGeneration: worldTarget.sessionGeneration }
    const raw = event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE)
    void deliverWorkspaceMediaDrop(raw, mediaSource, { surface: 'spatial', x: point.x, y: point.y }, target, onDropWorkspaceMedia,
      () => mediaSourceRef.current.directory === mediaSource.directory && mediaSourceRef.current.files === mediaSource.files)
      .then(result => setMediaDropError(result.ok ? null : result.reason ?? '媒体未插入'))
  }

  const wheelZoom = useRef({ canvasMode, cameraZoom })
  wheelZoom.current = { canvasMode, cameraZoom }
  useEffect(() => {
    // React attaches wheel listeners as passive; Ctrl+wheel zoom must keep the window itself from zooming.
    const element = viewportRef.current
    if (!element) return
    const zoomByWheel = (event: WheelEvent) => {
      const { canvasMode, cameraZoom } = wheelZoom.current
      if (canvasMode !== 'edit' || (!event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      authoringRef.current.zoomSession(cameraZoom + (event.deltaY > 0 ? -0.1 : 0.1), stageViewport)
    }
    element.addEventListener('wheel', zoomByWheel, { passive: false })
    return () => element.removeEventListener('wheel', zoomByWheel)
  }, [stageViewport])

  return (
    <main
      ref={workspaceRef}
      className={`workspace workspace--${canvasMode} workspace--spatial`}
      data-testid="spatial-workspace"
    >
      <NativeSelectionContext documentId={documentId} revision={project.revision} locationId={view.locationId} itemIds={selectionIds} enabled={canvasMode === 'edit' && !(activeCompositionNode && selectionIds.includes(activeCompositionNode.layerItemId))} ownsDocumentSelection={!activeCompositionNode || !selectionIds.includes(activeCompositionNode.layerItemId)} textEditing={editingNode?.type === 'text' || formulaNode?.type === 'formula'} />
      {canvasMenu.element}
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
                stageViewport,
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
                stageViewport,
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
        {hiddenLayers.length > 0 && <button type="button" className="canvas-label__hidden"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            canvasMenu.open({ x: rect.left, y: rect.bottom + 4 }, '隐藏的对象', hiddenMenu())
          }}>{hiddenLayers.length} 个隐藏对象</button>}
      </div>
      {previewNotice && activeTextPreview && (
        <div role="status" className="canvas-label">正在生成文字；完成或停止后可编辑此对象。</div>
      )}
      {mediaDropError && <div role="alert" className="canvas-label">{mediaDropError}</div>}
      <div
        ref={viewportRef}
        className="canvas-viewport"
        data-testid="spatial-world-stage"
        data-workspace-media-drop={mediaDragOver || undefined}
        onDragOver={event => { if (onDropWorkspaceMedia && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setMediaDragOver(canvasMode === 'edit' && scope === 'world' && Boolean(readMediaDropPoint(event.clientX, event.clientY))) } }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMediaDragOver(false) }}
        onDrop={dropWorkspaceMedia}
        data-observation-source={canvasMode === 'edit' ? 'authoring' : undefined}
        data-observation-project-id={project.id}
        data-observation-revision={project.revision}
        data-observation-session-generation={worldTarget.sessionGeneration}
        data-observation-surface-id={view.surfaceId}
        data-observation-location-id={view.locationId}
        data-observation-state-id=""
        data-observation-ready="true"
        data-observation-draft-token={authoringObservationDraftToken(contentEdit)}
        data-observation-spatial-camera={authoringObservationCameraToken(liveCamera)}
        style={{
          backgroundColor: 'transparent',
          boxShadow: mediaDragOver ? 'inset 0 0 0 3px #245b46' : undefined,
        }}
        onPointerDown={(event) => {
          if (canvasMode !== 'edit' || event.button === 2) return
          if ((event.target as Element).closest('[data-composition-authoring]')) return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          const pointer = { ...stagePoint, additive: event.shiftKey }
          const world = clientToWorld(
            createSpatialWorldViewTransform(
              stageViewport,
              view.sessionCamera,
            ),
            pointer,
          )
          const hudPoint = clientToWorld(
            createSpatialViewportOverlayTransform(stageViewport),
            pointer,
          )
          const layerHit = hitTestV9SpatialLayerItems(
            adaptV9SpatialEditorLayers(view.layers).filter((target) => (
              true
            )),
            { viewport: hudPoint, world },
          )
          if (activeTextPreview?.target.kind === 'course-object' &&
            layerHit?.layerItemId === activeTextPreview.target.itemId) {
            setPreviewNotice(true)
            event.preventDefault()
            event.stopPropagation()
            return
          }
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
          // Keep chart text as the click target while its drag still bubbles to the world controller.
          const captureTarget = event.target instanceof Element && event.target.closest('[data-testid="editable-chart-view"]')
            ? event.target : event.currentTarget
          captureTarget.setPointerCapture(event.pointerId)
          const result = authoringRef.current.pointerDown(pointer, stageViewport)
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
          }, stageViewport)
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
            }, stageViewport)
          } else {
            authoringRef.current.pointerCancel(stageViewport)
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
          authoringRef.current.pointerCancel(stageViewport)
          setPreviewFrames(null)
          setPreviewCamera(null)
          syncOverlays()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onContextMenu={(event) => {
          // M21 right-click: the object under the pointer is selected as a click would and gets the selection's menu;
          // empty canvas gets the canvas menu.
          if (event.target instanceof Element && event.target.closest(`${QUICK_BAR_SELECTOR}, .command-menu`)) return
          event.preventDefault()
          if (canvasMode !== 'edit' || contentEdit || pointerActiveRef.current) return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          const world = clientToWorld(createSpatialWorldViewTransform(stageViewport, view.sessionCamera), stagePoint)
          const hudPoint = clientToWorld(createSpatialViewportOverlayTransform(stageViewport), stagePoint)
          const hit = hitTestV9SpatialLayerItems(adaptV9SpatialEditorLayers(view.layers), { viewport: hudPoint, world })
          const point = { x: event.clientX, y: event.clientY }, root = event.currentTarget.closest('main')
          if (hit) {
            if (!selectionRef.current.includes(hit.layerItemId)) {
              authoringRef.current.pointerDown({ ...stagePoint, additive: false }, stageViewport)
              authoringRef.current.pointerUp({ ...stagePoint, additive: false }, stageViewport)
              syncOverlays()
            }
            // The selection owner re-renders with the new selection first.
            if (root) window.setTimeout(() => { requestObjectContextMenu(root, { ...point, itemIds: selectionRef.current }) }, 0)
            return
          }
          const noPort = '当前界面不支持此操作'
          canvasMenu.open(point, '画布操作', [
            { id: 'canvas.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'clipboard', run: () => onPaste?.(), disabledReason: onPaste ? null : noPort },
            { id: 'canvas.select-all', label: '全选', shortcut: 'Ctrl+A', group: 'clipboard', run: () => onSelectAll?.(), disabledReason: onSelectAll ? null : noPort },
            { id: 'canvas.hidden', label: '找回隐藏的对象', group: 'view', run: () => canvasMenu.open(point, '隐藏的对象', hiddenMenu()),
              disabledReason: hiddenLayers.length ? null : '本页没有隐藏的对象' },
            { id: 'canvas.try-run', label: '当前位置试运行', group: 'view', run: () => onCanvasModeChange('run') },
          ])
        }}
        onDoubleClick={(event) => {
          if (canvasMode !== 'edit') return
          const stagePoint = readLogicalPointer(event.clientX, event.clientY)
          if (!stagePoint) return
          const compositionHit = hitTestV9SpatialLayerItems(adaptV9SpatialEditorLayers(view.layers), {
            world: clientToWorld(createSpatialWorldViewTransform(stageViewport, view.sessionCamera), stagePoint),
            viewport: clientToWorld(createSpatialViewportOverlayTransform(stageViewport), stagePoint),
          })
          const compositionLayer = compositionHit && view.layers.find(layer => layer.selectionId === compositionHit.layerItemId)
          if (compositionLayer?.item.kind === 'composition' && !compositionLayer.locked && compositionLayer.source === scope) {
            event.preventDefault(); onEditComposition?.(compositionLayer.selectionId); return
          }
          if (activeTextPreview?.target.kind === 'course-object') {
            const world = clientToWorld(createSpatialWorldViewTransform(
              stageViewport, view.sessionCamera,
            ), stagePoint)
            const viewport = clientToWorld(createSpatialViewportOverlayTransform(
              stageViewport,
            ), stagePoint)
            const hit = hitTestV9SpatialLayerItems(adaptV9SpatialEditorLayers(view.layers), {
              viewport, world,
            })
            if (hit?.layerItemId === activeTextPreview.target.itemId) {
              setPreviewNotice(true)
              event.preventDefault()
              return
            }
          }
          authoringRef.current.doubleClick(stagePoint, stageViewport)
        }}
      >
        <div
          ref={stageStackRef}
          className="canvas-stage-stack"
          data-testid="spatial-stage-stack"
          style={{
            left: stageTransform.stageRect.x,
            top: stageTransform.stageRect.y,
            width: stageViewport.width,
            height: stageViewport.height,
            transform: `scale(${stageTransform.scale})`,
            transition: 'none',
            backgroundColor: view.backgroundColor,
            backgroundImage: view.backgroundAssetId && assetUrls[view.backgroundAssetId]
              ? `url(${JSON.stringify(assetUrls[view.backgroundAssetId])})`
              : undefined,
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'cover',
          }}
        >
        {canvasMode === 'edit' && (
          <SpatialGlobalRuntimeAuthoring
            project={project}
            locationId={view.locationId}
            surfaceId={view.surfaceId}
            scope={scope}
            layers={view.layers}
            assetFiles={assetFiles}
            componentPackages={componentPackages}
            content={runtimeContentAuthoring}
          >
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
                const width = stageViewport.width / frame.zoom
                const height = stageViewport.height / frame.zoom
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
                if (layer.item.kind !== 'native' && layer.item.kind !== 'component' && layer.item.kind !== 'composition') return null
                // A hidden object is not drawn, as on a slide; it cannot be clicked either (M21).
                if (!layer.effectiveVisible) return null
                const preview = previewById.get(layer.selectionId)
                const frame = preview ?? layer.item.frame
                const paintKind = spatialLayerPaintKind(layer.item)
                const rotation = preview?.rotation ?? layer.item.rotation
                const size = {
                  width: preview?.width ?? frame.width,
                  height: preview?.height ?? frame.height,
                }

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
                      background: 'transparent',



                    }}
                  >
                    {layer.item.kind === 'composition' ? renderComposition(layer, size) : layer.item.kind === 'component' ? (
                      <SpatialComponentItemContent
                        projectId={view.projectId}
                        layerItemId={layer.selectionId}
                        item={layer.item as LayerItem}
                        componentPackages={componentPackages}
                        assetUrls={assetUrls}
                      />
                    ) : layer.item.kind === 'native' && layer.item.content.nativeType === 'chart' ? (
                      renderEditableChart(layer, size)
                    ) : (
                      spatialNativePaint(spatialNativeTextPreview(layer.item as LayerItem, activeTextPreview), assetUrls, size)
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
          </SpatialGlobalRuntimeAuthoring>
        )}
        </div>
        <div
          ref={tryRunRef}
          className="spatial-try-run-host"
          data-testid="spatial-try-run-host"
          data-page-backdrop="transparent"
          {...workspaceTryRunHostProps()}
          hidden={canvasMode !== 'run'}
        />
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
