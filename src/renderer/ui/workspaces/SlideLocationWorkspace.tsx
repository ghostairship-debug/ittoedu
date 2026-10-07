import { Hand, Maximize2, Minus, MousePointer2, Play, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { resolveComponentBackground, isComponentVisibleAtSurface, type ComponentAuthorSpot, type ComponentEdit, type ComponentFrame, type CourseProjectV10 } from '../../../shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { SlideContentEdit } from '../../store/slices/slideAuthoringSlice'
import { NativeSelectionContext } from '../../workbench/NativeSelectionContext'
import { useContextMenu } from '../../editing/commands/CommandMenu'
import { OBJECT_EDIT_EVENT, requestObjectContextMenu } from '../../editing/commands/objectContextMenu'
import { componentPaintStyle } from '../../../player/components/componentPlacementStyle'
import { componentIsLocked } from '../../composition/crossSurfaceCommands'
import { componentDefinitionPresentation } from '../properties/componentDefinitionPresentation'
import { frameContainsPoint, frameToSpaceMatrix, invertMatrix, multiplyMatrices, transformPoint, type AffineMatrix, type GeometryPoint } from '../../../core/components/geometry'
import { AuthorSpotTransformGesture, FreeTransformGesture } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { componentFrameStyle, freeSurfaceTargets, freeTargetBounds, selectedFreeTargets, hitFreeObject, sameFreeTarget,
  type FreeObjectTarget, type FreeResizeHandle } from '../../componentPlatform/surfaces/slide'
import { createSlideWorkspaceAuthoringController, listSlideWorkspaceHitTargets, proposeSlideLineHandle, type SlideWorkspaceAuthoringResult } from '../workspaceSlideAuthoring'
import { createStageViewportTransform, clampStageViewportZoom, stageViewportPanRange } from '../../authoring/stageViewportTransform'
import { resolveNativeLinePoints, normalizeStraightLineAuthoring, normalizeElbowLineAuthoring } from '../../../shared/nativeLineGeometry'
import { snapLinePoint, collectLineSnapAxes } from '../../authoring/slideLineAuthoring'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { shapeDataSchema } from '../../../components/shape'
import { SlideLayerSelectionOverlay } from './SlideLayerSelectionOverlay'
import { useSlideNativeTextEditor } from './useSlideNativeTextEditor'
import { useWorkspaceMediaSource } from '../../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop, type WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../../lessonWorkspace/workspaceMediaDrag'
import type { ImportedImageAsset } from '../../project/assetManager'
import { authorSpotEdits, authorSpotGeometryEdits, authorSpotImageEdits } from '../../componentPlatform/surfaces/slide/authorSpots'
import { createTeacherControllerHudGeometry, teacherControllerReferenceSize, isGlobalTeacherController, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, type TeacherControllerDisplayPort } from '../../../shared/teacherControllerViewportGeometry'

export type SlideCanvasMode = 'edit' | 'run'
export type SlideLineDrawTool = 'line' | 'elbow-arrow' | null
export interface SlideLineDrawCommit {
  shapeType: 'line' | 'elbow-arrow'
  frame: { x: number; y: number; width: number; height: number }
  lineGeometry: NativeLineGeometry
}
export interface SlideWorkspaceSnapshot {
  project: CourseProjectV10 | null
  documentId: string | null
  surfaceId: string | null
  selectedInstanceIds: readonly string[]
  canvasMode: SlideCanvasMode
  contentEdit: SlideContentEdit | null
  drawTool: SlideLineDrawTool
  activation: number
  activeStateId: string | null
  assetUrls: Record<string, string>
  editingScope?: 'scene' | 'global'
}
export interface SlideWorkspacePorts {
  read(): SlideWorkspaceSnapshot
  capture(documentId?: string): CapturedCourseTarget
  commit(edits: ComponentEdit[], target: CapturedCourseTarget, group?: string): Promise<unknown>
  edit(edits: ComponentEdit[], group?: string): Promise<unknown>
  select(ids: readonly string[]): void
  selectSurface(id: string): void
  setCanvasMode(mode: SlideCanvasMode): void
  resetPlayback?(playing?: boolean): Promise<void>
  setDrawTool(tool: SlideLineDrawTool): void
  report(message: string): void
  paste(): void
  selectAll(): void
  beginTextEdit(id: string): SlideContentEdit | null
  beginSpotEdit?(spot: ComponentAuthorSpot, target?: CapturedCourseTarget): SlideContentEdit | null
  updateSpotDraft?(value: string, composing?: boolean): void
  authorSpots?(): readonly ComponentAuthorSpot[]
  subscribeAuthorSpots?(listener: () => void): () => void
  registerObservation?(surfaceId: string, binding: { readZoom(): number; setZoom(value: number): void; reset(): void }): () => void
  navigationChanged?(): void
  teacherController?: TeacherControllerDisplayPort
  updateDataDraft(data: unknown, composing?: boolean, height?: number): void
  setTextComposing?(active: boolean): void
  commitTextEdit(): Promise<void>
  cancelTextEdit(): void
  undo(): void
  redo(): void
  onElement(id: string, element: HTMLElement | null): void
  onTargetElement(id: string, element: HTMLElement | null): void
  addTextNode(x?: number, y?: number): void
  addFormulaNode(x?: number, y?: number): void
  addRectangleNode(x?: number, y?: number): void
  addShapeNode(type: string, x?: number, y?: number): void
  addTableNode(x?: number, y?: number): void
  addChartNode(type: 'bar' | 'line' | 'area' | 'pie' | 'donut', x?: number, y?: number): void
  addExternalComponentNode(id: string, x?: number, y?: number, presetId?: string): void
  drawShapeNode(input: SlideLineDrawCommit, target?: CapturedCourseTarget): void
}
export interface SlideLocationWorkspaceProps {
  snapshot: SlideWorkspaceSnapshot
  ports: SlideWorkspacePorts
  documentId?: string | null
  onAddImage(x?: number, y?: number): void
  onAddVideo(x?: number, y?: number): void
  onSelectImageAsset(): Promise<ImportedImageAsset | null>
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
}

/** One stable professional slot per instance; geometry is exclusively the authored affine frame. */
function SlideInstance({ id, project, surfaceId, preview, ports }: {
  id: string; project: CourseProjectV10; surfaceId: string; preview: Record<string, ComponentFrame>; ports: SlideWorkspacePorts
}) {
  const instance = project.instances[id]
  const bind = useCallback((element: HTMLDivElement | null) => ports.onElement(id, element), [id, ports.onElement])
  const bindTarget = useCallback((element: HTMLDivElement | null) => ports.onTargetElement(id, element), [id, ports.onTargetElement])
  if (!instance || project.definitions[instance.definitionId]?.role === 'behavior') return null
  return <div ref={bindTarget} data-component-instance={id} data-layer-item-id={id} data-controller-authoring-id={isGlobalTeacherController(project, id) ? id : undefined} hidden={!isComponentVisibleAtSurface(instance, surfaceId)}
    style={{ ...componentPaintStyle(instance, project.definitions[instance.definitionId]) as CSSProperties, ...componentFrameStyle(preview[id] ?? instance.frame), ...(isGlobalTeacherController(project, id) ? { pointerEvents: 'auto' } : {}) }}>
    <div ref={bind} data-component-render={id} style={{ width: '100%', height: '100%' }} />
    {instance.childIds?.map(child => <SlideInstance key={child} id={child} project={project} surfaceId={surfaceId} preview={preview} ports={ports} />)}
  </div>
}
const emptyPreview = (): SlideWorkspaceAuthoringResult => ({ preview: {}, guides: [], marquee: null })
const controls = '.canvas-mode-switch,.canvas-view-controls,.canvas-label,.live-scene-bar,.command-menu,.selection-quick-bar,.text-edit-overlay,.text-edit-toolbar,[data-component-professional-editor]'
const outsideStage = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(controls))
const spotKey = (spot: ComponentAuthorSpot) => `${spot.instanceId}:${spot.authorKey ?? spot.id}:${JSON.stringify(spot.scope ?? {})}`


/** Original workspace chrome and event routes, with V10 replacing the former Phaser/V9 writer. */
export function SlideLocationWorkspace({ snapshot, ports, onAddImage, onAddVideo, onSelectImageAsset, onDropWorkspaceMedia }: SlideLocationWorkspaceProps) {
  const latest = useRef({ snapshot, ports }); latest.current = { snapshot, ports }
  const workspaceRef = useRef<HTMLElement>(null), stageViewportRef = useRef<HTMLDivElement>(null), stageRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 960, height: 640 })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const viewRef = useRef(view); viewRef.current = view
  const [panning, setPanning] = useState(false), [mediaDragOver, setMediaDragOver] = useState(false)
  const [preview, setPreview] = useState(emptyPreview)
  const [drawPreview, setDrawPreview] = useState<{ start: GeometryPoint; end: GeometryPoint } | null>(null)
  const [linePreview, setLinePreview] = useState<{ instanceId: string; frame: ComponentFrame; geometry: NativeLineGeometry } | null>(null)
  const [spots, setSpots] = useState<readonly ComponentAuthorSpot[]>(() => ports.authorSpots?.() ?? [])
  const [replacingSpot, setReplacingSpot] = useState<string | null>(null)
  const [hoveredSpot, setHoveredSpot] = useState<string | null>(null)
  const [selectedSpotKey, setSelectedSpotKey] = useState<string | null>(null)
  const [internalPreview, setInternalPreview] = useState<ComponentFrame | null>(null)
  const internalGesture = useRef<{ pointerId: number; start: GeometryPoint; value: AuthorSpotTransformGesture; captured: CapturedCourseTarget;
    instanceToSurface: AffineMatrix; frame?: ComponentFrame; geometry?: ReturnType<AuthorSpotTransformGesture['update']>['geometry']; moved: boolean } | null>(null)
  const suppressSpotClick = useRef(false)
  const [liveScene, setLiveScene] = useState(false), [resettingScene, setResettingScene] = useState(false)
  const [, refreshNavigation] = useState(0)
  useEffect(() => ports.teacherController?.subscribe(() => refreshNavigation(value => value + 1)), [ports.teacherController])
  useEffect(() => { setLiveScene(false) }, [snapshot.documentId])
  useEffect(() => { if (snapshot.canvasMode === 'run') setLiveScene(true) }, [snapshot.canvasMode, snapshot.documentId])
  const resetScene = async (playing: boolean) => {
    if (!ports.resetPlayback) return
    const documentId = snapshot.documentId
    setResettingScene(true)
    try {
      await ports.resetPlayback(playing)
      if (latest.current.ports.read().documentId !== documentId) return
      ports.setCanvasMode(playing ? 'run' : 'edit')
      setLiveScene(playing)
    } catch (error) { ports.report(error instanceof Error ? error.message : String(error)) }
    finally { setResettingScene(false) }
  }
  useEffect(() => {
    const update = () => setSpots(ports.authorSpots?.() ?? [])
    const stop = ports.subscribeAuthorSpots?.(update); update()
    return stop
  }, [ports.authorSpots, ports.subscribeAuthorSpots])
  const pointer = useRef<number | null>(null), space = useRef(false)
  const deferredPointer = useRef<{ id: number; documentId: string | null; surfaceId: string | null; stateId: string | null;
    start: { x: number; y: number; additive: boolean; altKey: boolean }; latest: { x: number; y: number; shiftKey: boolean; altKey: boolean }; ended: boolean } | null>(null)
  const pan = useRef<{ id: number; start: GeometryPoint; x: number; y: number } | null>(null)
  const draw = useRef<{ target: CapturedCourseTarget; start: GeometryPoint; type: 'line' | 'elbow-arrow' } | null>(null)
  const line = useRef<{ target: CapturedCourseTarget; initial: FreeObjectTarget; instanceId: string; handle: 'start' | 'end' | 'elbow'; matrix: AffineMatrix; frame: ComponentFrame; geometry: NativeLineGeometry } | null>(null)
  const mediaSource = useWorkspaceMediaSource(), mediaSourceRef = useRef(mediaSource); mediaSourceRef.current = mediaSource
  const canvasMenu = useContextMenu()
  const project = snapshot.project
  const surface = project?.surfaces.find(value => value.id === snapshot.surfaceId)
  const visitedSurfaces = useMemo(() => new Set<string>(), [snapshot.documentId, project?.id])
  useLayoutEffect(() => {
    if (surface?.kind === 'slide') visitedSurfaces.add(surface.id)
  }, [visitedSurfaces, surface?.id, surface?.kind])
  const canvas = surface?.designSize ?? { width: 960, height: 640 }
  const stageTransform = useMemo(() => createStageViewportTransform({ viewport, stage: canvas, fit: 'page', zoom: view.zoom, pan: { x: view.x, y: view.y } }),
    [viewport, canvas.width, canvas.height, view])
  const scale = stageTransform.scale
  const hudGeometry = createTeacherControllerHudGeometry({ referenceSize: project ? teacherControllerReferenceSize(project) : canvas, viewportRect: viewport })
  const controllerGeometry = useRef({ viewport: hudGeometry, port: ports.teacherController })
  controllerGeometry.current = { viewport: hudGeometry, port: ports.teacherController }
  const displayProject = project && projectTeacherControllerInstances(project, hudGeometry, undefined, ports.teacherController)
  const hudGesture = useRef<{ pointerId: number; value: FreeTransformGesture; edits: ComponentEdit[]; captured: CapturedCourseTarget } | null>(null)
  const gestureDisplay = useRef<{ original: CourseProjectV10; display: CourseProjectV10; geometry: typeof controllerGeometry.current; offset: { x: number; y: number } } | null>(null)
  const mapping = (): AffineMatrix => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ? [rect.width / canvas.width, 0, 0, rect.height / canvas.height, rect.left, rect.top] : [scale, 0, 0, scale, 0, 0]
  }
  const surfacePoint = (x: number, y: number) => transformPoint(invertMatrix(mapping()), { x, y })
  const state = () => {
    const current = latest.current.ports.read()
    return current.project && current.surfaceId && current.documentId
      ? { project: { ...current.project, global: { underlay: current.project.global.underlay.filter(id => !isGlobalTeacherController(current.project!, id)), overlay: current.project.global.overlay.filter(id => !isGlobalTeacherController(current.project!, id)) } }, surfaceId: current.surfaceId, documentId: current.documentId, selectedInstanceIds: current.selectedInstanceIds,
          activeStateId: current.activeStateId, editingScope: current.editingScope } : null
  }
  const authoring = useRef<ReturnType<typeof createSlideWorkspaceAuthoringController> | null>(null)
  if (!authoring.current) authoring.current = createSlideWorkspaceAuthoringController({
    read: state, capture: () => {
      const original = latest.current.ports.read().project!, geometry = controllerGeometry.current
      gestureDisplay.current = { original, display: projectTeacherControllerInstances(original, geometry.viewport, undefined, geometry.port), geometry,
        offset: geometry.port?.placement?.() ?? { x: 0, y: 0 } }
      return latest.current.ports.capture()
    }, select: ids => latest.current.ports.select(ids),
    commit: (edits, target, group) => {
      const frozen = gestureDisplay.current
      return latest.current.ports.commit(frozen ? restoreTeacherControllerFrameEdits(edits, frozen.original, frozen.display,
        frozen.geometry.viewport, undefined, frozen.offset, frozen.geometry.port) : edits, target, group)
    }, report: message => latest.current.ports.report(message),
  })
  useLayoutEffect(() => {
    const element = stageViewportRef.current
    if (!element) return
    const update = () => setViewport({ x: 0, y: 0, width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) })
    update()
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [Boolean(project)])
  useEffect(() => {
    authoring.current?.cancelGesture(); hudGesture.current = null; internalGesture.current = null; setInternalPreview(null); setSelectedSpotKey(null); pointer.current = null; deferredPointer.current = null; pan.current = null; draw.current = null; line.current = null
    setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null); setPanning(false)
    setView({ zoom: 1, x: 0, y: 0 })
  }, [snapshot.documentId, snapshot.surfaceId, snapshot.activeStateId, snapshot.canvasMode, snapshot.editingScope])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !outsideStage(event.target) && !(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]'))) {
        space.current = event.type === 'keydown'
        if (space.current) event.preventDefault()
      }
      if (event.key === 'Escape' && pointer.current !== null) {
        authoring.current?.cancelGesture(); pointer.current = null; deferredPointer.current = null; draw.current = null; line.current = null
        setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null)
      }
      if (event.key === 'Escape' && hudGesture.current) { hudGesture.current = null; setPreview(emptyPreview()) }
      if (event.key === 'Escape' && internalGesture.current) { internalGesture.current = null; setInternalPreview(null); suppressSpotClick.current = true }
    }
    const blur = () => { space.current = false; pan.current = null; setPanning(false) }
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKey); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', blur) }
  }, [])
  // Retain the mature viewport rule: a fitting axis recentres; a zoomed axis stays within reach.
  const viewWithinReach = useCallback((current: typeof view) => {
    const range = stageViewportPanRange(createStageViewportTransform({ viewport, stage: canvas, fit: 'page', zoom: current.zoom, pan: current }))
    const x = range.x ? Math.max(range.x.min, Math.min(range.x.max, current.x)) : 0
    const y = range.y ? Math.max(range.y.min, Math.min(range.y.max, current.y)) : 0
    return x === current.x && y === current.y ? current : { ...current, x, y }
  }, [viewport, canvas.width, canvas.height])
  const setZoom = useCallback((zoom: number) => setView(current => viewWithinReach({ ...current, zoom: clampStageViewportZoom(zoom) })), [viewWithinReach])
  useEffect(() => { setView(viewWithinReach) }, [viewWithinReach])
  const resetView = useCallback(() => setView({ zoom: 1, x: 0, y: 0 }), [])
  useLayoutEffect(() => {
    if (!snapshot.surfaceId) return
    return ports.registerObservation?.(snapshot.surfaceId, { readZoom: () => viewRef.current.zoom, setZoom, reset: resetView })
  }, [ports.registerObservation, snapshot.surfaceId, setZoom, resetView])
  useEffect(() => { ports.navigationChanged?.() }, [view.zoom, ports.navigationChanged])
  const wheel = useRef({ view, stageTransform, mode: snapshot.canvasMode }); wheel.current = { view, stageTransform, mode: snapshot.canvasMode }
  useEffect(() => {
    const element = workspaceRef.current
    if (!element) return
    const zoomByWheel = (event: WheelEvent) => {
      const current = wheel.current
      if (current.mode !== 'edit' || outsideStage(event.target)) return
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); setZoom(current.view.zoom + (event.deltaY < 0 ? 0.1 : -0.1)); return }
      const range = stageViewportPanRange(current.stageTransform)
      const sideways = event.shiftKey && !event.deltaX, dx = sideways ? event.deltaY : event.deltaX, dy = sideways ? 0 : event.deltaY
      const x = range.x && dx ? Math.max(range.x.min, Math.min(range.x.max, current.view.x - dx)) : current.view.x
      const y = range.y && dy ? Math.max(range.y.min, Math.min(range.y.max, current.view.y - dy)) : current.view.y
      if (x === current.view.x && y === current.view.y) return
      event.preventDefault(); setView(previous => ({ ...previous, x, y }))
    }
    element.addEventListener('wheel', zoomByWheel, { passive: false })
    return () => element.removeEventListener('wheel', zoomByWheel)
  }, [Boolean(project), setZoom])
  const nativeText = useSlideNativeTextEditor({
    project: project ?? { schemaVersion: 10, id: '', revision: 0, title: '', definitions: {}, instances: {}, surfaces: [], global: { underlay: [], overlay: [] }, assets: {} },
    surfaceId: snapshot.surfaceId ?? '', edit: snapshot.contentEdit?.target.documentId === snapshot.documentId ? snapshot.contentEdit : null,
    begin: ports.beginTextEdit, update: ports.updateDataDraft, updateSpot: ports.updateSpotDraft, setComposing: ports.setTextComposing, commit: ports.commitTextEdit, cancel: ports.cancelTextEdit,
    undo: ports.undo, redo: ports.redo, host: () => stageRef.current, report: ports.report,
  }, snapshot.documentId + ':' + snapshot.surfaceId + ':' + snapshot.activeStateId)
  useEffect(() => {
    const root = workspaceRef.current
    if (!root) return
    const edit = (event: Event) => {
      const id = (event as CustomEvent<{ itemId: string }>).detail.itemId, current = latest.current.ports.read()
      if (current.canvasMode !== 'edit' || !current.project?.instances[id]) return
      const instance = current.project.instances[id], kind = componentDefinitionPresentation(current.project.definitions[instance.definitionId]).builtinKey
      if (kind === 'guoling.text' || kind === 'guoling.formula') {
        if (latest.current.ports.beginTextEdit(id)) event.preventDefault()
      } else {
        const spot = latest.current.ports.authorSpots?.().find(value => value.instanceId === id && value.kind === 'text' && typeof value.initialValue === 'string')
        if (spot && latest.current.ports.beginSpotEdit?.(spot)) event.preventDefault()
      }
    }
    root.addEventListener(OBJECT_EDIT_EVENT, edit)
    return () => root.removeEventListener(OBJECT_EDIT_EVENT, edit)
  }, [Boolean(project)])
  const spotTargets = listSlideWorkspaceHitTargets(state()).flatMap(target => spots.filter(spot => spot.instanceId === target.instanceId).map(spot => ({
    spot, target, frame: { ...(spot.geometry?.frame ?? spot.localBounds), transform: [...frameToSpaceMatrix(spot.geometry?.frame ?? spot.localBounds,
      spot.geometry ? multiplyMatrices(frameToSpaceMatrix(target.frame, target.parentToSurface), spot.geometry.parentToInstance) : frameToSpaceMatrix(target.frame, target.parentToSurface))] as ComponentFrame['transform'] },
  })))
  const selectedInternal = spotTargets.find(value => spotKey(value.spot) === selectedSpotKey)
  const snapLine = (at: GeometryPoint, disabled = false, exclude?: string) => snapLinePoint(at, collectLineSnapAxes(
    listSlideWorkspaceHitTargets(state()).map(target => {
      const bounds = freeTargetBounds(target)
      return { layerItemId: target.instanceId, bounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, rotation: 0 },
        hittable: true, locked: componentIsLocked(project!, target.instanceId) }
    }), exclude, canvas), scale, disabled).point
  const spotAt = (at: GeometryPoint) => [...spotTargets].reverse().find(value => frameContainsPoint(value.frame, at))?.spot
  const beginSpot = (spot: ComponentAuthorSpot, at: GeometryPoint, client: GeometryPoint, captured?: CapturedCourseTarget): boolean => {
    if (spot.kind !== 'text') return false
    const opened = typeof spot.initialValue === 'string' ? Boolean(ports.beginSpotEdit?.(spot, captured)) : nativeText.begin(spot.instanceId, at, client)
    if (opened) ports.select([spot.instanceId])
    return opened
  }
  const replaceSpot = async (spot: ComponentAuthorSpot, target = ports.capture()) => {
    if (componentIsLocked(target.editingProject, spot.instanceId)) return
    try {
      // Capture the registered address and document before opening the asynchronous picker.
      authorSpotEdits(target.editingProject, spot, spot.initialValue, target.resources)
      setReplacingSpot(spot.id)
      const imported = await onSelectImageAsset()
      if (!imported) return
      await ports.commit(authorSpotImageEdits(target.editingProject, spot, imported, target.resources), target, crypto.randomUUID())
      if (spot.sourceRegion?.kind === 'implementation' || spot.sourceRegion?.encoding)
        ports.report('图片地址已写入并重新加载组件内容，程序内部运行现场可能重置。')
    } catch (error) { ports.report(error instanceof Error ? error.message : String(error)) }
    finally { setReplacingSpot(null) }
  }
  const readDropPoint = (x: number, y: number) => {
    if (!stageRef.current) return null
    const point = surfacePoint(x, y)
    return point.x >= 0 && point.x <= canvas.width && point.y >= 0 && point.y <= canvas.height ? point : null
  }
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault(); setMediaDragOver(false)
    if (snapshot.canvasMode !== 'edit' || !project || !surface) return
    const at = readDropPoint(event.clientX, event.clientY)
    if (!at) { ports.report('请将媒体拖到画布内'); return }
    if (event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE) && onDropWorkspaceMedia) {
      const source = mediaSource
      void deliverWorkspaceMediaDrop(event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE), source, { surface: 'slide', ...at },
        { documentId: snapshot.documentId, projectId: project.id, revision: project.revision, locationId: surface.id, surfaceId: surface.id, sessionGeneration: snapshot.activation,
          captured: ports.capture(snapshot.documentId ?? undefined) },
        onDropWorkspaceMedia, () => mediaSourceRef.current.directory === source.directory && mediaSourceRef.current.files === source.files)
        .then(result => { if (!result.ok) ports.report(result.reason ?? '媒体未插入') })
      return
    }
    // The mature palette's drag MIME is retained.
    const item = event.dataTransfer.getData('application/x-courseware-element')
    if (item === 'text') ports.addTextNode(at.x, at.y)
    else if (item === 'formula') ports.addFormulaNode(at.x, at.y)
    else if (item === 'rectangle') ports.addRectangleNode(at.x, at.y)
    else if (item === 'table') ports.addTableNode(at.x, at.y)
    else if (item.startsWith('chart:')) ports.addChartNode(item.slice(6) as Parameters<typeof ports.addChartNode>[0], at.x, at.y)
    else if (item.startsWith('shape:')) ports.addShapeNode(item.slice(6), at.x, at.y)
    else if (item === 'image') onAddImage(at.x, at.y)
    else if (item === 'video') onAddVideo(at.x, at.y)
    else if (item.startsWith('component-preset:')) {
      const [packageId, presetId] = item.slice(17).split(':', 2)
      if (packageId && presetId) ports.addExternalComponentNode(decodeURIComponent(packageId), at.x, at.y, decodeURIComponent(presetId))
    } else if (item.startsWith('component:')) ports.addExternalComponentNode(item.slice(10), at.x, at.y)
  }
  if (!project || !surface) return <main className="workspace" data-testid="slide-workspace-sessionless" role="alert"><p className="property-hint">请先打开或新建课件。</p></main>
  const effectiveProject = { ...displayProject!, instances: Object.fromEntries(Object.entries(displayProject!.instances).map(([id, instance]) =>
    [id, linePreview?.instanceId === id ? { ...instance, frame: linePreview.frame } : preview.preview[id] ? { ...instance, frame: preview.preview[id] } : instance])) }
  const targets = freeSurfaceTargets(effectiveProject, surface.id), selected = selectedFreeTargets(targets, snapshot.selectedInstanceIds)
  const editableSelected = selected.filter(target => !componentIsLocked(project, target.instanceId))
  const selectedContent = editableSelected.filter(target => !isGlobalTeacherController(project, target.instanceId))
  const hudTargets = targets.filter(target => isGlobalTeacherController(project, target.instanceId)
    && isComponentVisibleAtSurface(project.instances[target.instanceId], surface.id))
  const selectedHud = editableSelected.filter(target => hudTargets.some(value => value.instanceId === target.instanceId))
  const viewportBounds = stageViewportRef.current?.getBoundingClientRect()
  const viewportScale = viewportBounds ? viewportBounds.width / viewport.width : 1
  const hudPointerMatrix: AffineMatrix = [viewportScale, 0, 0, viewportScale, viewportBounds?.left ?? 0, viewportBounds?.top ?? 0]
  const chromeMatrix: AffineMatrix = [scale * viewportScale, 0, 0, scale * viewportScale,
    (viewportBounds?.left ?? 0) + stageTransform.stageRect.x * viewportScale, (viewportBounds?.top ?? 0) + stageTransform.stageRect.y * viewportScale]
  const background = resolveComponentBackground(project, surface)
  const backgroundUrl = background.assetId ? snapshot.assetUrls[background.assetId] : undefined
  const hidden = freeSurfaceTargets(project, surface.id).filter(target => project.instances[target.instanceId]?.visible === false)
  const hiddenMenu = () => hidden.map(target => ({
    id: 'show.' + target.instanceId, label: project.instances[target.instanceId].name ?? project.definitions[project.instances[target.instanceId].definitionId]?.title ?? '对象',
    run: () => { void ports.edit([{ type: 'instance.patch', instanceId: target.instanceId, patch: { visible: true } }]).catch(error => ports.report(String(error))) },
  }))
  const selectedInstance = selected.length === 1 ? project.instances[selected[0].instanceId] : null
  const selectedImplementation = selectedInstance && (selectedInstance.implementationOverride ?? project.definitions[selectedInstance.definitionId]?.implementation)
  const selectedLine = editableSelected.length === 1 && selectedImplementation?.kind === 'builtin' && selectedImplementation.key === 'guoling.shape'
    ? shapeDataSchema.safeParse(selectedInstance!.data) : null
  const lineGeometry = selectedLine?.success ? linePreview?.geometry ?? selectedLine.data.lineGeometry : null
  const linePoints = selectedLine?.success && lineGeometry && selected.length === 1
    ? resolveNativeLinePoints(lineGeometry, selected[0].frame.width, selected[0].frame.height).map(at => transformPoint(frameToSpaceMatrix(selected[0].frame, selected[0].parentToSurface), at)) : null
  const stop = (event: React.PointerEvent) => { event.preventDefault(); event.stopPropagation() }
  return <main ref={workspaceRef} className={'workspace workspace--' + snapshot.canvasMode + (liveScene ? ' workspace--live' : '')} aria-label="画布"
    style={snapshot.drawTool ? { cursor: 'crosshair' } : undefined}
    onDragOver={event => {
      if (snapshot.canvasMode !== 'edit') return
      if (event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE) || event.dataTransfer.types.includes('application/x-courseware-element')) {
        event.preventDefault(); event.dataTransfer.dropEffect = 'copy'
        setMediaDragOver(Boolean(readDropPoint(event.clientX, event.clientY)))
      }
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMediaDragOver(false) }} onDrop={onDrop}
    onPointerDownCapture={event => {
      if (outsideStage(event.target) || snapshot.canvasMode !== 'edit') return
      if (event.button === 1 || (event.button === 0 && space.current)) {
        stop(event); pan.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, x: view.x, y: view.y }
        setPanning(true); event.currentTarget.setPointerCapture(event.pointerId); return
      }
      if (event.button !== 0) return
      if (!snapshot.contentEdit && !snapshot.drawTool) {
        const selectedHandle = event.target instanceof Element && event.target.closest('[data-internal-selection]')
        const at = surfacePoint(event.clientX, event.clientY)
        const hit = selectedHandle ? selectedInternal : [...spotTargets].reverse().find(value => value.spot.geometry && frameContainsPoint(value.frame, at))
        if (hit?.spot.geometry && hit.spot.authorKey && hit.spot.binding) {
          stop(event); suppressSpotClick.current = false
          if (componentIsLocked(project, hit.spot.instanceId)) return
          setSelectedSpotKey(spotKey(hit.spot)); ports.select([hit.spot.instanceId]); event.currentTarget.setPointerCapture(event.pointerId)
          const handle = selectedHandle && event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | null : null
          const instanceToSurface = frameToSpaceMatrix(hit.target.frame, hit.target.parentToSurface), captured = ports.capture()
          internalGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false, captured, instanceToSurface,
            value: new AuthorSpotTransformGesture({ spot: hit.spot, mode: handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'drag',
              handle: handle === 'rotate' ? undefined : handle ?? undefined, instanceToSurface, surfaceToPointer: mapping(), pointer: { x: event.clientX, y: event.clientY } }) }
          return
        }
      }
      if (!snapshot.contentEdit && !snapshot.drawTool) {
        const atHud = transformPoint(invertMatrix(hudPointerMatrix), { x: event.clientX, y: event.clientY })
        const inHudHandle = event.target instanceof Element && event.target.closest('[data-controller-selection]')
        const hit = hitFreeObject(hudTargets, atHud)
        if (hit || inHudHandle) {
          const ids = inHudHandle ? selectedHud.map(target => target.instanceId) : hit ? [hit.instanceId] : []
          const targets = selectedFreeTargets(hudTargets, ids).filter(target => !componentIsLocked(project, target.instanceId))
          if (!targets.length) { stop(event); return }
          stop(event); ports.select(ids); event.currentTarget.setPointerCapture(event.pointerId)
          const handle = event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | null : null
          const captured = ports.capture(), geometry = controllerGeometry.current
          gestureDisplay.current = { original: project, display: displayProject!, geometry, offset: geometry.port?.placement?.() ?? { x: 0, y: 0 } }
          hudGesture.current = { pointerId: event.pointerId, captured, edits: [], value: new FreeTransformGesture({
            mode: handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'drag', handle: handle === 'rotate' ? undefined : handle ?? undefined,
            targets, pointer: { x: event.clientX, y: event.clientY }, surfaceToPointer: hudPointerMatrix }) }
          return
        }
      }
      if (snapshot.contentEdit) {
        if (snapshot.contentEdit.composing || snapshot.drawTool) return
        stop(event); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
        const pending = { id: event.pointerId, documentId: snapshot.documentId, surfaceId: snapshot.surfaceId, stateId: snapshot.activeStateId,
          start: { x: event.clientX, y: event.clientY, additive: event.shiftKey || event.ctrlKey || event.metaKey, altKey: event.altKey },
          latest: { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }, ended: false }
        deferredPointer.current = pending
        const active = document.activeElement
        if (active instanceof HTMLElement && active.matches('input,textarea,[contenteditable="true"]')) active.blur()
        void ports.commitTextEdit().then(async () => {
          if (deferredPointer.current !== pending) return
          deferredPointer.current = null
          const current = latest.current.ports.read()
          if (current.documentId !== pending.documentId || current.surfaceId !== pending.surfaceId || current.activeStateId !== pending.stateId || current.contentEdit) return
          setPreview(authoring.current!.pointerDown(pending.start, mapping()))
          if (pending.ended) setPreview(await authoring.current!.pointerUp(pending.latest, mapping()))
          else setPreview(authoring.current!.pointerMove(pending.latest, mapping()))
        }).catch(error => {
          if (deferredPointer.current === pending) deferredPointer.current = null
          pointer.current = null
          ports.report(error instanceof Error ? error.message : String(error))
        })
        return
      }
      stop(event); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
      const at = surfacePoint(event.clientX, event.clientY)
      if (snapshot.drawTool) { const start = snapLine(at, event.altKey); draw.current = { start, type: snapshot.drawTool, target: ports.capture() }; setDrawPreview({ start, end: start }); return }
      const handle = event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | null : null
      const lineHandle = event.target instanceof Element ? event.target.closest('[data-line-handle]')?.getAttribute('data-line-handle') as 'start' | 'end' | 'elbow' | null : null
      if (lineHandle && selected.length === 1 && lineGeometry) {
        line.current = { target: ports.capture(), initial: selected[0], instanceId: selected[0].instanceId, handle: lineHandle,
          matrix: frameToSpaceMatrix(selected[0].frame, selected[0].parentToSurface), frame: selected[0].frame, geometry: lineGeometry }
        return
      }
      setPreview(authoring.current!.pointerDown({ x: event.clientX, y: event.clientY, additive: event.shiftKey || event.ctrlKey || event.metaKey, altKey: event.altKey }, mapping(), handle ?? undefined))
    }}
    onPointerMoveCapture={event => {
      if (internalGesture.current?.pointerId === event.pointerId) {
        stop(event); const gesture = internalGesture.current, update = gesture.value.update({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey })
        gesture.frame = update.frame; gesture.geometry = update.geometry
        gesture.moved ||= Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) >= 2
        setInternalPreview({ ...update.frame, transform: [...multiplyMatrices(multiplyMatrices(gesture.instanceToSurface, gesture.value.spot.geometry!.parentToInstance), update.frame.transform)] }); return
      }
      if (hudGesture.current?.pointerId === event.pointerId) {
        stop(event); const gesture = hudGesture.current, update = gesture.value.update({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey })
        gesture.edits = update.edits; setPreview({ preview: Object.fromEntries(update.edits.flatMap(edit => edit.type === 'frame.set' && edit.frame ? [[edit.instanceId, edit.frame]] : [])), guides: [], marquee: null }); return
      }
      if (pan.current?.id === event.pointerId) { stop(event); const p = pan.current; setView(current => ({ ...current, x: p.x + event.clientX - p.start.x, y: p.y + event.clientY - p.start.y })); return }
      if (pointer.current !== event.pointerId) {
        if (snapshot.canvasMode === 'edit') setHoveredSpot(spotAt(surfacePoint(event.clientX, event.clientY))?.id ?? null)
        return
      }
      stop(event)
      if (deferredPointer.current?.id === event.pointerId) {
        deferredPointer.current.latest = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }; return
      }
      const at = surfacePoint(event.clientX, event.clientY)
      if (draw.current) { setDrawPreview({ start: draw.current.start, end: snapLine(at, event.altKey) }); return }
      if (line.current) {
        const value = line.current, proposal = proposeSlideLineHandle(value.initial, value.geometry, value.handle, snapLine(at, event.altKey, value.instanceId))
        if (proposal) setLinePreview({ instanceId: value.instanceId, ...proposal }); return
      }
      setPreview(authoring.current!.pointerMove({ x: event.clientX, y: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey }, mapping()))
    }}
    onPointerUpCapture={event => {
      if (internalGesture.current?.pointerId === event.pointerId) {
        stop(event); const gesture = internalGesture.current; internalGesture.current = null; setInternalPreview(null)
        event.currentTarget.releasePointerCapture(event.pointerId); suppressSpotClick.current = gesture.moved
        if (gesture.moved && gesture.geometry && Object.keys(gesture.geometry).length) {
          try { void ports.commit(authorSpotGeometryEdits(gesture.captured.editingProject, gesture.value.spot, gesture.geometry),
            gesture.captured, crypto.randomUUID()).catch(error => ports.report(String(error))) }
          catch (error) { ports.report(String(error)) }
        }
        return
      }
      if (hudGesture.current?.pointerId === event.pointerId) {
        stop(event); const gesture = hudGesture.current, frozen = gestureDisplay.current; hudGesture.current = null
        event.currentTarget.releasePointerCapture(event.pointerId); setPreview(emptyPreview())
        if (gesture.edits.length && frozen) void ports.commit(restoreTeacherControllerFrameEdits(gesture.edits, frozen.original, frozen.display,
          frozen.geometry.viewport, undefined, frozen.offset, frozen.geometry.port), gesture.captured, crypto.randomUUID()).catch(error => ports.report(String(error)))
        return
      }
      if (pan.current?.id === event.pointerId) { stop(event); pan.current = null; setPanning(false); event.currentTarget.releasePointerCapture(event.pointerId); return }
      if (pointer.current !== event.pointerId) return
      stop(event); pointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId)
      if (deferredPointer.current?.id === event.pointerId) {
        deferredPointer.current.latest = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }
        deferredPointer.current.ended = true; return
      }
      if (draw.current) {
        const current = draw.current, at = snapLine(surfacePoint(event.clientX, event.clientY), event.altKey); draw.current = null; setDrawPreview(null)
        if (Math.hypot(at.x - current.start.x, at.y - current.start.y) < 3 / scale) return
        const proposal = current.type === 'line' ? normalizeStraightLineAuthoring(current.start, at)
          : normalizeElbowLineAuthoring(current.start, at, 'horizontal', (current.start.x + at.x) / 2)
        if (proposal) ports.drawShapeNode({ shapeType: current.type, ...proposal }, current.target)
        ports.setDrawTool(null); return
      }
      if (line.current) {
        const current = line.current, now = state()
        line.current = null; setLinePreview(null)
        const actual = listSlideWorkspaceHitTargets(now).find(value => value.instanceId === current.instanceId)
        if (!now || now.documentId !== current.target.documentId || now.surfaceId !== current.target.surfaceId || now.activeStateId !== current.target.activeStateId
          || !actual || !sameFreeTarget(current.initial, actual) || componentIsLocked(now.project, current.instanceId)) {
          ports.report('对象位置或编辑目标已变化，本次端点拖动已取消'); return
        }
        const proposal = proposeSlideLineHandle(current.initial, current.geometry, current.handle,
          snapLine(surfacePoint(event.clientX, event.clientY), event.altKey, current.instanceId))
        if (proposal && (JSON.stringify(proposal.geometry) !== JSON.stringify(current.geometry) || JSON.stringify(proposal.frame) !== JSON.stringify(current.frame)))
          void ports.commit([{ type: 'frame.set', instanceId: current.instanceId, frame: proposal.frame },
            { type: 'data.set', instanceId: current.instanceId, path: ['lineGeometry'], value: proposal.geometry }], current.target, crypto.randomUUID())
            .catch(error => ports.report(String(error)))
        return
      }
      void authoring.current!.pointerUp({ x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }, mapping()).then(setPreview)
      // Remove the transient preview immediately; ACK projection owns subsequent values.
      setPreview(emptyPreview())
    }}
    onPointerCancelCapture={event => {
      if (internalGesture.current?.pointerId === event.pointerId) { internalGesture.current = null; setInternalPreview(null); suppressSpotClick.current = true; return }
      if (hudGesture.current?.pointerId === event.pointerId) { hudGesture.current = null; setPreview(emptyPreview()); return }
      if (pointer.current !== event.pointerId) return
      pointer.current = null; deferredPointer.current = null; draw.current = null; line.current = null; authoring.current?.cancelGesture()
      setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null)
    }}
    onContextMenu={event => {
      if (outsideStage(event.target) || snapshot.canvasMode !== 'edit' || snapshot.contentEdit || snapshot.drawTool) return
      event.preventDefault()
      const point = { x: event.clientX, y: event.clientY }, root = event.currentTarget
      const hudHit = hitFreeObject(hudTargets, transformPoint(invertMatrix(hudPointerMatrix), point))
      if (hudHit) {
        ports.select([hudHit.instanceId]); window.setTimeout(() => requestObjectContextMenu(root, { ...point, itemIds: [hudHit.instanceId] }), 0); return
      }
      const at = surfacePoint(point.x, point.y), spot = spotAt(at), captured = ports.capture()
      if (spot) {
        ports.select([spot.instanceId])
        const locked = componentIsLocked(project, spot.instanceId)
        const extra = [{ id: 'spot.' + spot.id, label: spot.kind === 'image' ? '替换此处图片…' : spot.sourceRegion?.kind === 'implementation' ? '编辑此处源码片段' : '编辑此处文字',
          group: 'edit', disabledReason: locked ? '对象已锁定' : null,
          run: () => { if (spot.kind === 'image') void replaceSpot(spot, captured); else beginSpot(spot, at, point, captured) } }]
        window.setTimeout(() => requestObjectContextMenu(root, { ...point, itemIds: [spot.instanceId], extra }), 0); return
      }
      const hit = authoring.current!.contextTarget(point, mapping())
      if (hit) { window.setTimeout(() => requestObjectContextMenu(root, { ...point, itemIds: ports.read().selectedInstanceIds }), 0); return }
      ports.select([])
      canvasMenu.open(point, '画布操作', [
        { id: 'canvas.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'clipboard', run: ports.paste },
        { id: 'canvas.select-all', label: '全选', shortcut: 'Ctrl+A', group: 'clipboard', run: ports.selectAll },
        { id: 'canvas.insert-text', label: '在此插入文字', group: 'insert', run: () => ports.addTextNode(at.x, at.y) },
        { id: 'canvas.insert-image', label: '在此插入图片…', group: 'insert', run: () => onAddImage(at.x, at.y) },
        { id: 'canvas.insert-video', label: '在此插入视频…', group: 'insert', run: () => onAddVideo(at.x, at.y) },
        { id: 'canvas.insert-rectangle', label: '在此插入矩形', group: 'insert', run: () => ports.addRectangleNode(at.x, at.y) },
        { id: 'canvas.insert-formula', label: '在此插入公式', group: 'insert', run: () => ports.addFormulaNode(at.x, at.y) },
        { id: 'canvas.hidden', label: '找回隐藏的对象', group: 'view', run: () => canvasMenu.open(point, '隐藏的对象', hiddenMenu()), disabledReason: hidden.length ? null : '本页没有隐藏的对象' },
        { id: 'canvas.try-run', label: '当前位置试运行', group: 'view', run: () => ports.setCanvasMode('run') },
      ])
    }}
    onDoubleClickCapture={event => {
      if (outsideStage(event.target) || snapshot.canvasMode !== 'edit' || snapshot.contentEdit || snapshot.drawTool) return
      const at = surfacePoint(event.clientX, event.clientY), client = { x: event.clientX, y: event.clientY }, spot = spotAt(at)
      if (spot && (spot.kind === 'image' || beginSpot(spot, at, client))) {
        event.preventDefault(); event.stopPropagation()
        if (spot.kind === 'image') void replaceSpot(spot)
        return
      }
      const hit = hitFreeObject(listSlideWorkspaceHitTargets(state()), at, true)
      if (hit && nativeText.begin(hit.instanceId, at, { x: event.clientX, y: event.clientY })) {
        event.preventDefault(); event.stopPropagation(); ports.select([hit.instanceId])
      }
    }}>
    <NativeSelectionContext documentId={snapshot.documentId} revision={project.revision} locationId={surface.id} itemIds={snapshot.selectedInstanceIds}
      stateId={snapshot.activeStateId} sceneItemIds={surface.childIds} enabled={snapshot.canvasMode === 'edit'} textEditing={Boolean(snapshot.contentEdit)}
      bounds={id => {
        const target = targets.find(value => value.instanceId === id), rect = stageRef.current?.getBoundingClientRect()
        if (!target || !rect) return null
        const bounds = freeTargetBounds(target)
        if (isGlobalTeacherController(project, id)) return { left: (viewportBounds?.left ?? 0) + bounds.left * viewportScale,
          top: (viewportBounds?.top ?? 0) + bounds.top * viewportScale, width: bounds.width * viewportScale, height: bounds.height * viewportScale }
        return { left: rect.left + bounds.left * scale, top: rect.top + bounds.top * scale, width: bounds.width * scale, height: bounds.height * scale }
      }} />
    <div className="canvas-mode-switch" role="group" aria-label="画布模式">
      <button type="button" className={snapshot.canvasMode === 'edit' ? 'canvas-mode-switch__active' : ''} aria-pressed={snapshot.canvasMode === 'edit'} onClick={() => ports.setCanvasMode('edit')}><MousePointer2 size={13} />编辑状态</button>
      <button type="button" className={snapshot.canvasMode === 'run' ? 'canvas-mode-switch__active' : ''} aria-pressed={snapshot.canvasMode === 'run'} onClick={() => ports.setCanvasMode('run')}><Play size={13} />当前位置试运行</button>
      {snapshot.canvasMode === 'run' && <div role="group" aria-label="试运行翻页" data-testid="course-try-run-chrome" style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
        <button type="button" data-testid="course-try-run-previous" disabled={!ports.teacherController?.execute || ports.teacherController.canExecute?.({ type: 'scene.previous' }) === false}
          onClick={() => { void ports.teacherController?.execute?.({ type: 'scene.previous' }).then(accepted => { if (!accepted) ports.report('当前不能切换到上一页') }).catch(error => ports.report(String(error))) }}>上一页</button>
        <button type="button" data-testid="course-try-run-next" disabled={!ports.teacherController?.execute || ports.teacherController.canExecute?.({ type: 'scene.next' }) === false}
          onClick={() => { void ports.teacherController?.execute?.({ type: 'scene.next' }).then(accepted => { if (!accepted) ports.report('当前不能切换到下一页') }).catch(error => ports.report(String(error))) }}>下一页</button>
        {ports.resetPlayback && <button type="button" disabled={resettingScene} onClick={() => { void resetScene(true) }}>从初始状态重播</button>}
      </div>}
    </div>
    {snapshot.canvasMode === 'edit' && liveScene && <div className="live-scene-bar" role="region" aria-label="运行现场" data-testid="live-scene-bar">
      <strong>运行现场</strong><span className="live-scene-bar__message" role="status">{resettingScene ? '正在恢复初始编辑画面…' : '宿主互动与媒体已暂停；自定义脚本可能继续运行。源码修改会重新加载组件。'}</span>
      <button type="button" disabled={resettingScene} onClick={() => ports.setCanvasMode('run')}><Play size={13} />继续运行</button>
      {ports.resetPlayback && <button type="button" disabled={resettingScene} onClick={() => { void resetScene(false) }}>回到编辑画面</button>}
    </div>}
    {snapshot.canvasMode === 'edit' && <div className="canvas-view-controls" role="group" aria-label="画布视图">
      <button type="button" aria-label="缩小画布" onClick={() => setZoom(view.zoom - 0.1)}><Minus size={14} /></button>
      <output aria-label="画布缩放比例">{Math.round(view.zoom * 100)}%</output>
      <button type="button" aria-label="放大画布" onClick={() => setZoom(view.zoom + 0.1)}><Plus size={14} /></button>
      <button type="button" aria-label="适合窗口" title="重置缩放与平移" onClick={resetView}><Maximize2 size={14} /></button>
      <span title="Ctrl+滚轮缩放；按住空格或鼠标中键拖动画布"><Hand size={13} /></span>
    </div>}
    <div className={'canvas-label' + (snapshot.editingScope === 'global' ? ' canvas-label--global' : '')}>{canvas.width} × {canvas.height} · {snapshot.editingScope === 'global'
      ? `全局层 · ${project.global.underlay.length + project.global.overlay.length} 个元素`
      : `${surface.title} · ${snapshot.activeStateId ? surface.presentation?.states.find(value => value.id === snapshot.activeStateId)?.title ?? '状态' : '母版'}`}
      {snapshot.canvasMode === 'edit' && hidden.length > 0 && <button type="button" className="canvas-label__hidden" onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect(); canvasMenu.open({ x: rect.left, y: rect.bottom + 4 }, '隐藏的对象', hiddenMenu())
      }}>{hidden.length} 个隐藏对象</button>}
    </div>
    <div ref={stageViewportRef} className="canvas-viewport" data-workspace-media-drop={mediaDragOver || undefined}
      style={mediaDragOver ? { boxShadow: 'inset 0 0 0 3px #245b46' } : undefined}
      data-observation-source={snapshot.canvasMode === 'edit' ? 'authoring' : undefined} data-observation-project-id={project.id}
      data-observation-revision={project.revision} data-observation-surface-id={surface.id} data-observation-location-id={surface.id}
      data-observation-state-id={snapshot.activeStateId ?? ''} data-observation-ready="true">
      <div ref={stageRef} className="canvas-stage-stack" data-panning={panning || undefined}
        style={{ left: stageTransform.stageRect.x, top: stageTransform.stageRect.y, width: canvas.width, height: canvas.height,
          transform: 'scale(' + scale + ')', transition: 'none', visibility: 'visible', backgroundColor: background.color,
          backgroundImage: backgroundUrl ? 'url(' + JSON.stringify(backgroundUrl) + ')' : undefined, backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center', backgroundSize: background.fit === 'fill' ? '100% 100%' : background.fit }}>
        <div className="canvas-stage canvas-stage--authoring" data-testid="canvas-stage" style={{ position: 'absolute', inset: 0, visibility: 'visible', pointerEvents: 'auto' }}>
          {project.global.underlay.filter(id => !isGlobalTeacherController(project, id)).map(id => <SlideInstance key={id} id={id} project={project} surfaceId={surface.id} preview={linePreview ? { ...preview.preview, [linePreview.instanceId]: linePreview.frame } : preview.preview} ports={ports} />)}
          {project.surfaces.filter(value => value.kind === 'slide' && (value.id === surface.id || visitedSurfaces.has(value.id))).map(value => <div key={value.id} hidden={value.id !== surface.id} style={{ position: 'absolute', inset: 0 }}>
            {value.childIds.map(id => <SlideInstance key={id} id={id} project={project} surfaceId={value.id} preview={linePreview ? { ...preview.preview, [linePreview.instanceId]: linePreview.frame } : preview.preview} ports={ports} />)}
          </div>)}
          {project.global.overlay.filter(id => !isGlobalTeacherController(project, id)).map(id => <SlideInstance key={id} id={id} project={project} surfaceId={surface.id} preview={linePreview ? { ...preview.preview, [linePreview.instanceId]: linePreview.frame } : preview.preview} ports={ports} />)}
        </div>
        {snapshot.canvasMode === 'edit' && <div data-slide-authoring-hit-plane="" style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'auto' }} />}
        {snapshot.canvasMode === 'edit' && !snapshot.contentEdit && <div className="canvas-authoring-targets" data-testid="runtime-authoring-targets" aria-label="画布可编辑内容" style={{ zIndex: 12 }}>
          {spotTargets.map(({ spot, frame }) => <button key={spot.id} type="button" className={'canvas-authoring-target canvas-authoring-target--' + (spot.kind === 'image' ? 'asset' : 'text') + (hoveredSpot === spot.id ? ' canvas-authoring-target--hovered' : '')}
            aria-label={spot.kind === 'image' ? '双击替换此处图片' : '双击编辑此处文字'} disabled={spot.id === replacingSpot}
            data-author-spot={spotKey(spot)} onFocus={() => setHoveredSpot(spot.id)} onBlur={() => setHoveredSpot(null)} onClick={() => {
              if (suppressSpotClick.current) { suppressSpotClick.current = false; return }
              const at = transformPoint(frame.transform, { x: frame.width / 2, y: frame.height / 2 })
              if (spot.kind === 'image') void replaceSpot(spot); else beginSpot(spot, at, transformPoint(mapping(), at))
            }}
            style={{ ...componentFrameStyle(frame), zIndex: 12 }}><span className="canvas-authoring-target__badge" aria-hidden="true">{spot.kind === 'image' ? '替图' : 'T'}</span></button>)}
        </div>}
        {snapshot.canvasMode === 'edit' && nativeText.editor}
        {(preview.guides.length > 0 || preview.marquee || drawPreview || linePoints) && snapshot.canvasMode === 'edit' && <svg className="canvas-line-overlay" data-testid="canvas-line-overlay"
          width={canvas.width} height={canvas.height} viewBox={'0 0 ' + canvas.width + ' ' + canvas.height}
          style={{ position: 'absolute', left: 0, top: 0, zIndex: 13, pointerEvents: 'none', overflow: 'visible' }}>
          {preview.guides.map((guide, index) => <line key={index} x1={guide.axis === 'x' ? guide.value : 0} y1={guide.axis === 'y' ? guide.value : 0}
            x2={guide.axis === 'x' ? guide.value : canvas.width} y2={guide.axis === 'y' ? guide.value : canvas.height} stroke="#ff4d9d" strokeWidth={1 / scale} />)}
          {preview.marquee && <rect x={Math.min(preview.marquee.start.x, preview.marquee.end.x)} y={Math.min(preview.marquee.start.y, preview.marquee.end.y)}
            width={Math.abs(preview.marquee.end.x - preview.marquee.start.x)} height={Math.abs(preview.marquee.end.y - preview.marquee.start.y)} fill="#2563eb22" stroke="#2563eb" strokeWidth={1 / scale} />}
          {drawPreview && <line x1={drawPreview.start.x} y1={drawPreview.start.y} x2={drawPreview.end.x} y2={drawPreview.end.y} stroke="#3b82f6" strokeWidth={2 / scale} strokeDasharray="6 4" />}
          {linePoints && <><polyline points={linePoints.map(p => p.x + ',' + p.y).join(' ')} fill="none" stroke="#2563eb" strokeWidth={1 / scale} />
            {linePoints.map((at, index) => (index === 0 || index === linePoints.length - 1 || linePoints.length === 4 && index === 1) &&
              <circle key={index} data-line-handle={index === 0 ? 'start' : index === linePoints.length - 1 ? 'end' : 'elbow'}
                cx={at.x} cy={at.y} r={5 / scale} fill="#fff" stroke="#2563eb" style={{ pointerEvents: 'auto' }} />)}</>}
        </svg>}
      </div>
      <div data-controller-hud="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 14 }}>
        {[...project.global.underlay, ...project.global.overlay].filter(id => isGlobalTeacherController(project, id)).map(id =>
          <SlideInstance key={id} id={id} project={displayProject!} surfaceId={surface.id} preview={preview.preview} ports={ports} />)}
      </div>
    </div>
    {snapshot.canvasMode === 'edit' && !snapshot.contentEdit && <><SlideLayerSelectionOverlay targets={selectedContent} scale={scale} surfaceToPointer={chromeMatrix} lineHandles={Boolean(linePoints)} />
      <div data-controller-selection="true"><SlideLayerSelectionOverlay targets={selectedHud} scale={viewportScale} surfaceToPointer={hudPointerMatrix} /></div></>}
    {snapshot.canvasMode === 'edit' && !snapshot.contentEdit && selectedInternal?.spot.geometry && <div data-internal-selection="true">
      <SlideLayerSelectionOverlay targets={[{ ...selectedInternal.target, frame: internalPreview ?? selectedInternal.frame,
        parentToSurface: [1, 0, 0, 1, 0, 0], ancestors: [], preserveAspectRatio: selectedInternal.spot.kind === 'image' }]} scale={scale} surfaceToPointer={chromeMatrix} />
    </div>}
    {canvasMenu.element}
  </main>
}
