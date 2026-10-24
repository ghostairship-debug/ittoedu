import { componentSurface, componentDefinitionBuiltinKey } from '../../../shared/contracts/component-platform/project'
import { componentSurfaces } from '../../../shared/contracts/component-platform/project'
import type { TextRangeProjection } from '../../../shared/document/textInteraction'
import { Hand, Maximize2, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { resolveComponentBackground, resolveComponentSurfaceBackground, resolveComponentPresentation, isComponentVisibleAtSurface, type ComponentAuthorGeometry, type ComponentAuthorSpot, type ComponentEdit, type ComponentFrame, type CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { ComponentBackgroundPaint } from '../../components/ComponentBackgroundPaint'
import type { ContainerEditorViewState } from '../../components/CourseV10RuntimeView'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { SlideContentEdit, SlideContentLayoutReady } from '../../store/slices/slideAuthoringSlice'
import { NativeSelectionContext } from '../../workbench/NativeSelectionContext'
import { useContextMenu } from '../../editing/commands/CommandMenu'
import { AUTHOR_FIELD_ACTION_EVENT, OBJECT_EDIT_EVENT, requestObjectContextMenu, requestObjectEdit, type AuthorFieldActionRequest } from '../../editing/commands/objectContextMenu'
import { componentPaintStyle } from '../../../player/components/componentPlacementStyle'
import { componentIsLocked } from '../../composition/crossSurfaceCommands'
import { componentDefinitionPresentation } from '../properties/componentDefinitionPresentation'
import { frameContainsPoint, frameCorners, frameToSpaceMatrix, invertMatrix, multiplyMatrices, transformPoint, type AffineMatrix, type GeometryPoint } from '../../../core/components/geometry'
import { AuthorSpotTransformGesture, FreeTransformGesture } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { componentFrameStyle, freeSurfaceTargets, freeTargetBounds, selectedFreeTargets, hitFreeObject, sameFreeTarget, freeTargetAtEditingLevel,
  type FreeObjectTarget, type FreeResizeHandle } from '../../componentPlatform/surfaces/slide'
import { createSlideWorkspaceAuthoringController, listSlideWorkspaceHitTargets, proposeSlideLineHandle, type SlideWorkspaceAuthoringResult } from '../workspaceSlideAuthoring'
import { createStageViewportTransform, clampStageViewportZoom, stageViewportPanRange } from '../../authoring/stageViewportTransform'
import { getDefaultLineGeometry, resolveNativeLinePoints, normalizeStraightLineAuthoring, normalizeElbowLineAuthoring } from '../../../shared/nativeLineGeometry'
import { visibleComponentAuthorHit } from '../../components/componentAuthorHit'
import { snapLinePoint, collectLineSnapAxes } from '../../authoring/slideLineAuthoring'
import type { NativeLineGeometry } from '../../../shared/contracts/native-v1/types'
import { shapeDataSchema } from '../../../components/shape'
import { SlideLayerSelectionOverlay, selectionHandleGesture } from './SlideLayerSelectionOverlay'
import { useSlideNativeTextEditor } from './useSlideNativeTextEditor'
import { useWorkspaceMediaSource } from '../../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop, type WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../../lessonWorkspace/workspaceMediaDrag'
import type { ImportedImageAsset } from '../../project/assetManager'
import { authorSpotEdits, authorSpotGeometryEdits, authorSpotImageEdits } from '../../componentPlatform/surfaces/slide/authorSpots'
import { createTeacherControllerHudGeometry, teacherControllerReferenceSize, isViewportComponent, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, type TeacherControllerDisplayPort } from '../../../shared/teacherControllerViewportGeometry'
import { CourseNavigationControls } from './CourseNavigationControls'
import { MIXED_GLOBAL_GEOMETRY, mixedGlobalGeometryEdits, type MixedGlobalGeometryRequest } from './mixedGlobalGeometry'
import { ImageSafeAreaGuides } from './ImageSafeAreaGuides'
import { authorFieldIdentity, interactionSelectionIdentity, selectionMatchesSpot, type CourseInteractionSelection } from '../../documents/interactionSelection'
import { editingLevelInstanceId } from '../../documents/containerEditingContext'
import type { ComponentAuthorPointerEventDetail } from '../../../shared/contracts/component-platform/runtime'
import { flowContentClientMatrix } from '../flow/flowParagraphLayout'

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
  epoch?: string
  rootInstanceId?: string | null
  editingContainerId?: string | null
  activeGroupId?: string | null
  surfaceId: string | null
  selectedInstanceIds: readonly string[]
  interactionSelection?: CourseInteractionSelection | null
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
  selectAuthorSpot?(spot: ComponentAuthorSpot): void
  selectSurface(id: string): void
  enterGroup?(id: string): void
  leaveGroup?(): void
  enterContainer?(id: string): void
  setCanvasMode(mode: SlideCanvasMode): void
  resetPlayback?(playing?: boolean): Promise<void>
  setDrawTool(tool: SlideLineDrawTool): void
  report(message: string): void
  paste(): void
  selectAll(): void
  beginTextEdit(id: string): SlideContentEdit | null
  beginSpotEdit?(spot: ComponentAuthorSpot, target?: CapturedCourseTarget): Promise<SlideContentEdit | null>
  updateSpotDraft?(value: string, composing?: boolean): void
  authorSpots?(): readonly ComponentAuthorSpot[]
  subscribeAuthorSpots?(listener: () => void): () => void
  previewAuthorSpot?(spotId: string, geometry: ComponentAuthorGeometry | null): boolean
  registerObservation?(surfaceId: string, binding: { readZoom(): number; setZoom(value: number): void; reset(): void }): () => void
  navigationChanged?(): void
  containerViewState?(containerId: string): ContainerEditorViewState
  renderContainer?(containerId: string, project: CourseProjectV10): ReactNode
  teacherController?: TeacherControllerDisplayPort
  updateDataDraft(data: unknown, composing?: boolean, height?: number, width?: number, rangeProjection?: TextRangeProjection[], historyGroup?: string, layoutReady?: SlideContentLayoutReady): void
  setTextComposing?(active: boolean): void
  commitTextEdit(): Promise<void>
  commitTextInput?(): Promise<void>
  cancelTextEdit(): void
  preserveTextEdit?(): Promise<boolean>
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
  addExternalComponentNode(id: string, x?: number, y?: number, presetId?: string, sourceInstanceId?: string): void
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
function SlideInstance({ id, project, surfaceId, preview, ports, renderRoots, clipCanvas, authorGuides = false }: {
  id: string; project: CourseProjectV10; surfaceId: string; preview: Record<string, ComponentFrame>; ports: SlideWorkspacePorts;
  renderRoots: Map<string, HTMLElement>; clipCanvas?: { width: number; height: number }; authorGuides?: boolean
}) {
  const instance = project.instances[id]
  const bound = useRef<HTMLElement | null>(null)
  const bind = useCallback((element: HTMLDivElement | null) => {
    if (element) renderRoots.set(id, element)
    else if (renderRoots.get(id) === bound.current) renderRoots.delete(id)
    bound.current = element; ports.onElement(id, element)
  }, [id, ports.onElement, renderRoots])
  const bindTarget = useCallback((element: HTMLDivElement | null) => ports.onTargetElement(id, element), [id, ports.onTargetElement])
  if (!instance || project.definitions[instance.definitionId]?.role === 'behavior') return null
  if (instance.container && ports.renderContainer) return <>{ports.renderContainer(id, preview[id]
    ? { ...project, instances: { ...project.instances, [id]: { ...instance, frame: preview[id] } } } : project)}</>
  const shownFrame = preview[id] ?? instance.frame, teacher = isViewportComponent(project, id)
  let pageClip: string | undefined
  if (clipCanvas && shownFrame && !teacher && shownFrame.transform[0] * shownFrame.transform[3] - shownFrame.transform[1] * shownFrame.transform[2] !== 0) {
    const inverse = invertMatrix(shownFrame.transform)
    pageClip = 'polygon(' + [{ x: 0, y: 0 }, { x: clipCanvas.width, y: 0 }, { x: clipCanvas.width, y: clipCanvas.height }, { x: 0, y: clipCanvas.height }]
      .map(point => { const local = transformPoint(inverse, point); return `${local.x}px ${local.y}px` }).join(',') + ')'
  }
  const teacherData = teacher && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : null
  const variants = teacherData?.sceneStyles, variant = variants && typeof variants === 'object' && !Array.isArray(variants) ? variants[surfaceId] : null
  const teacherEnabled = variant && typeof variant === 'object' && !Array.isArray(variant) && typeof variant.enabled === 'boolean' ? variant.enabled : teacherData?.enabled
  const authoredStyle = componentPaintStyle(instance, project.definitions[instance.definitionId]) as CSSProperties
  return <div ref={bindTarget} data-component-instance={id} data-layer-item-id={id} data-controller-authoring-id={isViewportComponent(project, id) ? id : undefined} hidden={!isComponentVisibleAtSurface(instance, surfaceId)}
    style={{ ...authoredStyle, ...componentFrameStyle(shownFrame),
      ...(pageClip ? { clipPath: pageClip } : {}), ...(teacher ? { pointerEvents: teacherEnabled === false ? 'none' : authoredStyle.pointerEvents ?? 'auto', display: teacherEnabled === false ? 'none' : undefined } : {}) }}>
    <div ref={bind} data-component-render={id} style={{ width: '100%', height: '100%' }} />
    {authorGuides && <ImageSafeAreaGuides instance={{ ...instance, frame: shownFrame }} project={project} />}
    {instance.childIds?.map(child => <SlideInstance key={child} id={child} project={project} surfaceId={surfaceId} preview={preview} ports={ports} renderRoots={renderRoots} authorGuides={authorGuides} />)}
  </div>
}
const emptyPreview = (): SlideWorkspaceAuthoringResult => ({ preview: {}, guides: [], marquee: null })
const controls = '.canvas-mode-switch,.canvas-view-controls,.canvas-label,.command-menu,.selection-quick-bar,.text-edit-overlay,.text-edit-toolbar,[data-component-professional-editor]'
const outsideStage = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(controls))
const spotKey = (spot: ComponentAuthorSpot) => `${spot.instanceId}:${spot.authorKey ?? spot.id}:${JSON.stringify(spot.scope ?? {})}`
const pointerContext = (view: SlideWorkspaceSnapshot) => JSON.stringify([view.documentId, view.epoch, view.project?.id,
  view.rootInstanceId ?? view.project?.entry?.rootInstanceId, view.editingContainerId ?? view.surfaceId, view.surfaceId,
  view.activeStateId, view.editingScope, view.canvasMode, view.activeGroupId])
interface SlideInputIntent { intent: number; context: string; selection: string; caretOffset?: number }


/** Original workspace chrome and event routes, with V10 replacing the former Phaser/V9 writer. */
export function SlideLocationWorkspace({ snapshot, ports, onAddImage, onAddVideo, onSelectImageAsset, onDropWorkspaceMedia }: SlideLocationWorkspaceProps) {
  const latest = useRef({ snapshot, ports }); latest.current = { snapshot, ports }
  const workspaceRef = useRef<HTMLElement>(null), stageViewportRef = useRef<HTMLDivElement>(null), stageRef = useRef<HTMLDivElement>(null)
  const renderRoots = useRef(new Map<string, HTMLElement>())
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 960, height: 640 })
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const viewRef = useRef(view); viewRef.current = view
  const [panning, setPanning] = useState(false), [mediaDragOver, setMediaDragOver] = useState(false)
  const [preview, setPreview] = useState(emptyPreview)
  const [drawPreview, setDrawPreview] = useState<{ start: GeometryPoint; end: GeometryPoint } | null>(null)
  const [linePreview, setLinePreview] = useState<{ instanceId: string; frame: ComponentFrame; geometry: NativeLineGeometry } | null>(null)
  useLayoutEffect(() => {
    if (!linePreview) return
    const slot = renderRoots.current.get(linePreview.instanceId)
    slot?.dispatchEvent(new CustomEvent('component-shape-line-preview', { detail: linePreview }))
    return () => { slot?.dispatchEvent(new CustomEvent('component-shape-line-preview', { detail: null })) }
  }, [linePreview])
  const [spots, setSpots] = useState<readonly ComponentAuthorSpot[]>(() => ports.authorSpots?.() ?? [])
  const [replacingSpot, setReplacingSpot] = useState<string | null>(null)
  const [hoveredSpot, setHoveredSpot] = useState<string | null>(null)
  const [internalPreview, setInternalPreview] = useState<ComponentFrame | null>(null)
  const internalGesture = useRef<{ pointerId: number; start: GeometryPoint; value: AuthorSpotTransformGesture; captured: CapturedCourseTarget;
    instanceToSurface: AffineMatrix; frame?: ComponentFrame; geometry?: ReturnType<AuthorSpotTransformGesture['update']>['geometry']; moved: boolean;
    preview?: SlideWorkspacePorts['previewAuthorSpot'] } | null>(null)
  const suppressSpotClick = useRef(false)
  const plainSpotPointer = useRef<{ id: number; ended: boolean; resolved: boolean; latest: { x: number; y: number; shiftKey: boolean; altKey: boolean } } | null>(null)
  const realmPointer = useRef<{ id: number; context: string; ended: boolean; latest: { x: number; y: number; shiftKey: boolean; altKey: boolean }; advance?: (end: boolean) => void } | null>(null)
  const inputIntent = useRef(0)
  const nativeField = useRef<{ spot: ComponentAuthorSpot; activate?: () => boolean; read?: () => ComponentAuthorSpot | undefined } | null>(null)
  const hoverHitSequence = useRef(0)
  const hoverFrame = useRef<number | null>(null), hoverBusy = useRef(false), hoverMounted = useRef(true)
  const hoverPending = useRef<{ point: GeometryPoint; sequence: number; intent: number; context: string; selection: string } | null>(null)
  const runHover = useRef<() => void>(() => {})
  const cancelHover = () => {
    ++hoverHitSequence.current; hoverPending.current = null
    if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current)
    hoverFrame.current = null
  }
  const scheduleHover = () => {
    if (hoverFrame.current === null) hoverFrame.current = requestAnimationFrame(() => { hoverFrame.current = null; runHover.current() })
  }
  useEffect(() => { hoverMounted.current = true; return () => { hoverMounted.current = false; cancelHover() } }, [])
  const [, refreshNavigation] = useState(0)
  useEffect(() => ports.teacherController?.subscribe(() => refreshNavigation(value => value + 1)), [ports.teacherController])
  useEffect(() => ports.teacherController?.subscribePlacement?.(() => refreshNavigation(value => value + 1)), [ports.teacherController])
  useEffect(() => {
    const update = () => { cancelHover(); setHoveredSpot(null); setSpots(ports.authorSpots?.() ?? []) }
    const stop = ports.subscribeAuthorSpots?.(update); update()
    return stop
  }, [ports.authorSpots, ports.subscribeAuthorSpots])
  const pointer = useRef<number | null>(null), space = useRef(false)
  const gestureContext = useRef<string | null>(null)
  const previewFrame = useRef<number | null>(null)
  const previewMove = useRef<{ pointerId: number; context: string | null; apply(): void } | null>(null)
  const cancelPreviewMove = () => {
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current)
    previewFrame.current = null; previewMove.current = null
  }
  const flushPreviewMove = () => {
    const pending = previewMove.current
    cancelPreviewMove()
    if (pending && pending.context === gestureContext.current && pending.context === pointerContext(latest.current.ports.read())) pending.apply()
  }
  const schedulePreviewMove = (pointerId: number, apply: () => void) => {
    previewMove.current = { pointerId, context: gestureContext.current, apply }
    if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(flushPreviewMove)
  }
  const deferredPointer = useRef<{ id: number; context: string; intent: number;
    start: { x: number; y: number; additive: boolean; altKey: boolean }; latest: { x: number; y: number; shiftKey: boolean; altKey: boolean }; ended: boolean } | null>(null)
  const pan = useRef<{ id: number; start: GeometryPoint; x: number; y: number } | null>(null)
  const draw = useRef<{ target: CapturedCourseTarget; start: GeometryPoint; type: 'line' | 'elbow-arrow' } | null>(null)
  const line = useRef<{ target: CapturedCourseTarget; initial: FreeObjectTarget; instanceId: string; handle: 'start' | 'end' | 'elbow'; matrix: AffineMatrix; frame: ComponentFrame; geometry: NativeLineGeometry } | null>(null)
  const mediaSource = useWorkspaceMediaSource(), mediaSourceRef = useRef(mediaSource); mediaSourceRef.current = mediaSource
  const canvasMenu = useContextMenu()
  const project = snapshot.project && snapshot.surfaceId && !snapshot.project.rootIds.includes(snapshot.surfaceId) && snapshot.editingScope !== 'global'
    ? { ...snapshot.project, global: { underlay: [], overlay: [] } } : snapshot.project
  const surface = project ? componentSurface(project, snapshot.surfaceId ?? '') : undefined
  const globalEditing = snapshot.canvasMode === 'edit' && snapshot.editingScope === 'global'
  const visitedSurfaces = useMemo(() => new Set<string>(), [snapshot.documentId, project?.id])
  useLayoutEffect(() => {
    if (surface?.kind === 'slide') visitedSurfaces.add(surface.id)
  }, [visitedSurfaces, surface?.id, surface?.kind])
  const canvas = surface?.designSize ?? { width: 1280, height: 720 }
  const stageTransform = useMemo(() => createStageViewportTransform({ viewport, stage: canvas, fit: 'page', zoom: view.zoom, pan: { x: view.x, y: view.y } }),
    [viewport, canvas.width, canvas.height, view])
  const stageTransformRef = useRef(stageTransform); stageTransformRef.current = stageTransform
  const scale = stageTransform.scale
  const hudGeometry = createTeacherControllerHudGeometry({ referenceSize: project ? teacherControllerReferenceSize(project) : canvas, viewportRect: viewport })
  const controllerGeometry = useRef({ viewport: hudGeometry, port: ports.teacherController })
  controllerGeometry.current = { viewport: hudGeometry, port: ports.teacherController }
  const displayProject = project && projectTeacherControllerInstances(project, hudGeometry, ports.teacherController)
  const viewportToStage: AffineMatrix = [1 / scale, 0, 0, 1 / scale, -stageTransform.stageRect.x / scale, -stageTransform.stageRect.y / scale]
  const stageFrame = (id: string, frame: ComponentFrame): ComponentFrame => project && isViewportComponent(project, id)
    ? { ...frame, transform: [...multiplyMatrices(viewportToStage, frame.transform)] as ComponentFrame['transform'] } : frame
  let stageDisplayProject = displayProject
  if (displayProject) {
    let instances = displayProject.instances
    for (const id of [...displayProject.global.underlay, ...displayProject.global.overlay]) {
      const instance = displayProject.instances[id]
      if (!instance?.frame || !isViewportComponent(displayProject, id)) continue
      if (instances === displayProject.instances) instances = { ...instances }
      instances[id] = { ...instance, frame: stageFrame(id, instance.frame) }
    }
    if (instances !== displayProject.instances) stageDisplayProject = { ...displayProject, instances }
  }
  const previewFrames = linePreview ? { ...preview.preview, [linePreview.instanceId]: linePreview.frame } : preview.preview
  const stagePreview = Object.fromEntries(Object.entries(previewFrames)
    .map(([id, frame]) => [id, stageFrame(id, frame)]))
  const hudGesture = useRef<{ pointerId: number; start: GeometryPoint; hadMove: boolean; value: FreeTransformGesture; edits: ComponentEdit[]; captured: CapturedCourseTarget } | null>(null)
  const gestureDisplay = useRef<{ original: CourseProjectV10; display: CourseProjectV10; geometry: typeof controllerGeometry.current; offset: { x: number; y: number } } | null>(null)
  const mapping = (): AffineMatrix => {
    const rect = stageRef.current?.getBoundingClientRect()
    return rect ? [rect.width / canvas.width, 0, 0, rect.height / canvas.height, rect.left, rect.top] : [scale, 0, 0, scale, 0, 0]
  }
  useEffect(() => {
    const request = (event: Event) => {
      const input = (event as CustomEvent<MixedGlobalGeometryRequest>).detail
      if (!input || input.edits || input.documentId !== snapshot.documentId || input.surfaceId !== snapshot.surfaceId || !workspaceRef.current?.isConnected) return
      input.edits = mixedGlobalGeometryEdits(input.project, input.instanceIds, input.intent,
        [scale, 0, 0, scale, stageTransform.stageRect.x, stageTransform.stageRect.y], hudGeometry, ports.teacherController)
    }
    window.addEventListener(MIXED_GLOBAL_GEOMETRY, request); return () => window.removeEventListener(MIXED_GLOBAL_GEOMETRY, request)
  }, [snapshot.documentId, snapshot.surfaceId, scale, stageTransform.stageRect.x, stageTransform.stageRect.y, viewport, ports.teacherController])
  const surfacePoint = (x: number, y: number) => transformPoint(invertMatrix(mapping()), { x, y })
  const state = () => {
    const current = latest.current.ports.read()
    return current.project && current.surfaceId && current.documentId
      ? { project: { ...current.project, global: current.project.rootIds.includes(current.surfaceId) || current.editingScope === 'global'
          ? { underlay: current.project.global.underlay.filter(id => !isViewportComponent(current.project!, id)), overlay: current.project.global.overlay.filter(id => !isViewportComponent(current.project!, id)) } : { underlay: [], overlay: [] } }, surfaceId: current.surfaceId, documentId: current.documentId, selectedInstanceIds: current.selectedInstanceIds,
          activeStateId: current.activeStateId, editingScope: current.editingScope, activeGroupId: current.activeGroupId } : null
  }
  const authoring = useRef<ReturnType<typeof createSlideWorkspaceAuthoringController> | null>(null)
  if (!authoring.current) authoring.current = createSlideWorkspaceAuthoringController({
    read: state, capture: () => {
      const original = latest.current.ports.read().project!, geometry = controllerGeometry.current
      gestureDisplay.current = { original, display: projectTeacherControllerInstances(original, geometry.viewport, geometry.port), geometry,
        offset: geometry.port?.placement?.() ?? { x: 0, y: 0 } }
      return latest.current.ports.capture()
    }, select: ids => latest.current.ports.select(ids),
    commit: (edits, target, group) => {
      const frozen = gestureDisplay.current
      return latest.current.ports.commit(frozen ? restoreTeacherControllerFrameEdits(edits, frozen.original, frozen.display,
        frozen.geometry.viewport, frozen.offset, frozen.geometry.port) : edits, target, group)
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
    cancelHover(); cancelPreviewMove(); gestureContext.current = null; setHoveredSpot(null)
    if (internalGesture.current) internalGesture.current.preview?.(internalGesture.current.value.spot.id, null)
    authoring.current?.cancelGesture(); realmPointer.current = null; plainSpotPointer.current = null; hudGesture.current = null; internalGesture.current = null; setInternalPreview(null); pointer.current = null; deferredPointer.current = null; pan.current = null; draw.current = null; line.current = null
    ++inputIntent.current; nativeField.current = null
    setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null); setPanning(false)
  }, [snapshot.documentId, snapshot.epoch, snapshot.rootInstanceId, snapshot.editingContainerId, snapshot.surfaceId, snapshot.activeStateId, snapshot.canvasMode, snapshot.editingScope, snapshot.activeGroupId])
  useLayoutEffect(() => {
    const saved = snapshot.surfaceId ? ports.containerViewState?.(snapshot.surfaceId) : undefined
    const context = JSON.stringify([snapshot.activeStateId, snapshot.canvasMode, snapshot.editingScope])
    setView(saved?.observationContext === context
      ? { zoom: saved.zoom ?? 1, x: saved.pan?.x ?? 0, y: saved.pan?.y ?? 0 } : { zoom: 1, x: 0, y: 0 })
    return () => {
      if (saved) { saved.zoom = viewRef.current.zoom; saved.pan = { x: viewRef.current.x, y: viewRef.current.y }; saved.observationContext = context }
    }
  }, [snapshot.documentId, snapshot.surfaceId, snapshot.activeStateId, snapshot.canvasMode, snapshot.editingScope, ports.containerViewState])
  useEffect(() => () => { cancelPreviewMove(); if (internalGesture.current) internalGesture.current.preview?.(internalGesture.current.value.spot.id, null) }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.type === 'keydown' && (pointer.current !== null || plainSpotPointer.current || realmPointer.current || pan.current || hudGesture.current || internalGesture.current)) event.preventDefault()
      if (event.code === 'Space' && !outsideStage(event.target) && !(event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]'))) {
        space.current = event.type === 'keydown'
        if (space.current) event.preventDefault()
      }
      if (event.key === 'Escape') { cancelPreviewMove(); realmPointer.current = null; plainSpotPointer.current = null; authoring.current?.cancelGesture(); gestureContext.current = null; if (pan.current) { pan.current = null; setPanning(false) } }
      if (event.key === 'Escape' && pointer.current !== null) {
        authoring.current?.cancelGesture(); pointer.current = null; deferredPointer.current = null; draw.current = null; line.current = null
        setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null)
      }
      if (event.key === 'Escape' && hudGesture.current) { hudGesture.current = null; setPreview(emptyPreview()) }
      if (event.key === 'Escape' && internalGesture.current) { internalGesture.current.preview?.(internalGesture.current.value.spot.id, null); internalGesture.current = null; setInternalPreview(null); suppressSpotClick.current = true }
      if (event.key === 'Escape' && event.type === 'keydown' && latest.current.snapshot.drawTool) latest.current.ports.setDrawTool(null)
    }
    const blur = () => {
      cancelPreviewMove(); space.current = false; pan.current = null; setPanning(false)
      plainSpotPointer.current = null; realmPointer.current = null; pointer.current = null; deferredPointer.current = null; hudGesture.current = null
      authoring.current?.cancelGesture(); setPreview(emptyPreview())
      if (internalGesture.current) internalGesture.current.preview?.(internalGesture.current.value.spot.id, null)
      internalGesture.current = null; setInternalPreview(null)
    }
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey); window.removeEventListener('blur', blur) }
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
    project: project ?? { schemaVersion: 11, id: '', revision: 0, title: '', definitions: {}, instances: {}, rootIds: [], global: { underlay: [], overlay: [] }, assets: {} },
    surfaceId: snapshot.surfaceId ?? '', edit: snapshot.contentEdit?.target.documentId === snapshot.documentId
      && snapshot.contentEdit.target.surfaceId === snapshot.surfaceId && snapshot.contentEdit.target.activeStateId === snapshot.activeStateId
      && snapshot.contentEdit.target.epoch === snapshot.epoch
      && (!globalEditing || listSlideWorkspaceHitTargets(state()).some(target => target.instanceId === snapshot.contentEdit!.instanceId)) ? snapshot.contentEdit : null,
    begin: ports.beginTextEdit, update: ports.updateDataDraft, updateSpot: ports.updateSpotDraft, setComposing: ports.setTextComposing, commit: ports.commitTextEdit, commitInput: ports.commitTextInput, cancel: ports.cancelTextEdit, preserve: ports.preserveTextEdit,
    readProject: () => latest.current.ports.read().project!,
    fieldIsCurrent: identity => {
      const current = latest.current.ports.read()
      return pointerContext(current) === pointerContext(latest.current.snapshot)
        && interactionSelectionIdentity(current.interactionSelection) === identity
    },
    undo: ports.undo, redo: ports.redo, host: () => stageRef.current, report: ports.report,
    onSelectField: (spot, activate, read) => {
      nativeField.current = { spot, activate, read }
      latest.current.ports.selectAuthorSpot?.(spot)
    },
  }, pointerContext(snapshot))
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
        if (spot && latest.current.ports.beginSpotEdit) {
          event.preventDefault()
          void latest.current.ports.beginSpotEdit(spot).catch(error => latest.current.ports.report(String(error)))
        }
      }
    }
    root.addEventListener(OBJECT_EDIT_EVENT, edit)
    return () => root.removeEventListener(OBJECT_EDIT_EVENT, edit)
  }, [Boolean(project)])
  const recoveredNativeField = nativeText.resolveSelection(snapshot.interactionSelection)
  const nativeObservation = (nativeField.current?.read ? nativeField.current.read() : nativeField.current?.spot) ?? recoveredNativeField?.spot
  const observedSpots = nativeObservation && selectionMatchesSpot(snapshot.interactionSelection, nativeObservation)
    ? [...spots.filter(spot => authorFieldIdentity(spot.instanceId, spot) !== authorFieldIdentity(nativeObservation.instanceId, nativeObservation)), nativeObservation] : spots
  const spotsByInstance = useMemo(() => {
    const grouped = new Map<string, ComponentAuthorSpot[]>()
    for (const spot of observedSpots) {
      const values = grouped.get(spot.instanceId)
      if (values) values.push(spot)
      else grouped.set(spot.instanceId, [spot])
    }
    return grouped
  }, [observedSpots])
  const spotTargets = listSlideWorkspaceHitTargets(state()).flatMap(target => (spotsByInstance.get(target.instanceId) ?? []).map(spot => ({
    spot, target, frame: { ...(spot.geometry?.frame ?? spot.localBounds), transform: [...frameToSpaceMatrix(spot.geometry?.frame ?? spot.localBounds,
      spot.geometry ? multiplyMatrices(frameToSpaceMatrix(target.frame, target.parentToSurface), spot.geometry.parentToInstance) : frameToSpaceMatrix(target.frame, target.parentToSurface))] as ComponentFrame['transform'] },
  })))
  const spotTargetsByOwner = new Map<string, typeof spotTargets>()
  for (const target of spotTargets) {
    const values = spotTargetsByOwner.get(target.spot.instanceId)
    if (values) values.push(target)
    else spotTargetsByOwner.set(target.spot.instanceId, [target])
  }
  const ownerSpotAt = (instanceId: string, at: GeometryPoint) => {
    const values = spotTargetsByOwner.get(instanceId) ?? []
    for (let index = values.length - 1; index >= 0; index--) if (frameContainsPoint(values[index]!.frame, at)) return values[index]
    return undefined
  }
  const selectedInternal = spotTargets.find(value => selectionMatchesSpot(snapshot.interactionSelection, value.spot))
  const snapLine = (at: GeometryPoint, disabled = false, exclude?: string) => snapLinePoint(at, collectLineSnapAxes(
    listSlideWorkspaceHitTargets(state()).map(target => {
      const bounds = freeTargetBounds(target)
      return { layerItemId: target.instanceId, bounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height, rotation: 0 },
        hittable: true, locked: componentIsLocked(project!, target.instanceId) }
    }), exclude, canvas), scale, disabled).point
  const resolveVisibleAt = (client: GeometryPoint) => visibleComponentAuthorHit(workspaceRef.current, client, id => renderRoots.current.get(id))
  const resolveSpotAt = async (at: GeometryPoint) => {
    const hit = await resolveVisibleAt(transformPoint(mapping(), at))
    if (!hit) return undefined
    return hit.authorKey ? latest.current.ports.authorSpots?.().find(spot => spot.instanceId === hit.instanceId && spot.authorKey === hit.authorKey)
      : hit.authorKey === undefined ? ownerSpotAt(hit.instanceId, at)?.spot : undefined
  }
  runHover.current = () => {
    const request = hoverPending.current
    hoverPending.current = null
    if (!request || !hoverMounted.current) return
    const geometry = stageTransformRef.current
    const isCurrent = () => {
      if (!hoverMounted.current || hoverHitSequence.current !== request.sequence || inputIntent.current !== request.intent
        || stageTransformRef.current !== geometry) return false
      const current = latest.current.ports.read()
      return current.canvasMode === 'edit' && pointerContext(current) === request.context
        && interactionSelectionIdentity(current.interactionSelection) === request.selection
    }
    if (!isCurrent() || pointer.current !== null || pan.current || hudGesture.current || internalGesture.current || plainSpotPointer.current) return
    const at = surfacePoint(request.point.x, request.point.y)
    if (hoverBusy.current) { hoverPending.current = request; return }
    hoverBusy.current = true
    void resolveSpotAt(at).then(spot => {
      if (isCurrent()) setHoveredSpot(spot?.id ?? null)
    }).catch(() => {}).finally(() => {
      hoverBusy.current = false
      if (hoverMounted.current && hoverPending.current) scheduleHover()
    })
  }
  const captureInputIntent = (): SlideInputIntent => {
    cancelHover()
    const current = latest.current.ports.read()
    return { intent: ++inputIntent.current, context: pointerContext(current), selection: interactionSelectionIdentity(current.interactionSelection) }
  }
  const sameInputContext = (pending: SlideInputIntent) => {
    const current = latest.current.ports.read()
    return pending.intent === inputIntent.current && pointerContext(current) === pending.context && current.canvasMode === 'edit'
      && interactionSelectionIdentity(current.interactionSelection) === pending.selection
  }
  const currentSpot = (candidate: ComponentAuthorSpot) => {
    if (!listSlideWorkspaceHitTargets(state()).some(target => target.instanceId === candidate.instanceId)) return undefined
    const identity = authorFieldIdentity(candidate.instanceId, candidate)
    const native = (nativeField.current?.read ? nativeField.current.read() : nativeField.current?.spot)
      ?? nativeText.resolveSelection(latest.current.ports.read().interactionSelection)?.read()
    if (native && authorFieldIdentity(native.instanceId, native) === identity) return native
    return latest.current.ports.authorSpots?.().find(spot => authorFieldIdentity(spot.instanceId, spot) === identity)
  }
  const updateInternalGesture = (point: GeometryPoint, modifiers: { shift?: boolean; alt?: boolean } = {}) => {
    const gesture = internalGesture.current
    if (!gesture) return
    gesture.moved ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) >= 3
    if (!gesture.moved) return
    const update = gesture.value.update(point, modifiers)
    gesture.frame = update.frame; gesture.geometry = update.geometry
    gesture.preview?.(gesture.value.spot.id, { ...gesture.value.spot.geometry!.author, ...update.geometry })
    setInternalPreview({ ...update.frame, transform: [...multiplyMatrices(multiplyMatrices(gesture.instanceToSurface,
      gesture.value.spot.geometry!.parentToInstance), update.frame.transform)] })
  }
  const finishInternalGesture = (point: GeometryPoint, modifiers: { shift?: boolean; alt?: boolean } = {}) => {
    updateInternalGesture(point, modifiers)
    const gesture = internalGesture.current
    if (!gesture) return
    internalGesture.current = null; setInternalPreview(null); suppressSpotClick.current = gesture.moved
    if (!gesture.moved || !gesture.geometry || !Object.keys(gesture.geometry).length) { gesture.preview?.(gesture.value.spot.id, null); return }
    try {
      const current = latest.current.ports.capture(gesture.captured.documentId)
      if (current.epoch !== gesture.captured.epoch || current.project.id !== gesture.captured.project.id) throw new Error('原文档会话已更换，本次手势已取消')
      const target: CapturedCourseTarget = { ...gesture.captured, project: current.project, resources: current.resources,
        editingProject: resolveComponentPresentation(current.project, gesture.captured.surfaceId, gesture.captured.activeStateId) }
      void latest.current.ports.commit(authorSpotGeometryEdits(target.editingProject, gesture.value.spot, gesture.geometry, gesture.captured.editingProject),
        target, crypto.randomUUID()).catch(error => latest.current.ports.report(String(error))).finally(() => gesture.preview?.(gesture.value.spot.id, null))
    } catch (error) { gesture.preview?.(gesture.value.spot.id, null); latest.current.ports.report(String(error)) }
  }
  const activateSpot = async (candidate: ComponentAuthorSpot, at: GeometryPoint, client: GeometryPoint, edit: boolean,
    captured?: CapturedCourseTarget, pending = captureInputIntent()): Promise<boolean> => {
    // A native field captures its cell/label before the current input can change layout.
    const native = edit && typeof candidate.initialValue !== 'string' ? nativeText.capture(candidate.instanceId, at, client) : null
    try {
      if (!sameInputContext(pending)) return false
      const owner = latest.current.ports, previous = owner.read().contentEdit
      if (previous?.composing) return false
      const view = owner.read()
      if (previous?.authorSpot && sameInputContext(pending) && previous.target.documentId === view.documentId
        && previous.target.epoch === view.epoch && previous.target.surfaceId === view.surfaceId && previous.target.activeStateId === view.activeStateId
        && authorFieldIdentity(previous.instanceId, previous.authorSpot) === authorFieldIdentity(candidate.instanceId, candidate)) return true
      if (previous) await owner.commitTextEdit()
      if (!sameInputContext(pending)) return false
      const spot = currentSpot(candidate), current = owner.read()
      if (!spot) throw new Error('最初选择的内容已不存在或地址已变化，当前输入已保留；请重新选择。')
      if (!current.project || componentIsLocked(current.project, spot.instanceId)) return false
      if (native) {
        if (!native()) throw new Error('最初选择的专业字段已变化，当前输入已保留；请重新选择。')
        return true
      }
      owner.selectAuthorSpot?.(spot)
      if (!edit || spot.kind === 'image') return true
      nativeText.placeCaret(spot.instanceId, client, pending.caretOffset === undefined ? undefined
        : Math.max(0, Math.min(typeof spot.initialValue === 'string' ? spot.initialValue.length : 0, pending.caretOffset)))
      return Boolean(await owner.beginSpotEdit?.(spot, captured))
    } catch (error) { latest.current.ports.report(error instanceof Error ? error.message : String(error)); return false }
  }
  const beginSpot = (spot: ComponentAuthorSpot, at: GeometryPoint, client: GeometryPoint, captured?: CapturedCourseTarget) =>
    spot.kind === 'text' ? activateSpot(spot, at, client, true, captured) : Promise.resolve(false)
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
  useEffect(() => {
    const root = workspaceRef.current
    if (!root || snapshot.canvasMode !== 'edit') return
    const authorPointer = (event: Event) => {
      const request = (event as CustomEvent<ComponentAuthorPointerEventDetail>).detail
      if (!request || !(event.target instanceof Node) || !root.contains(event.target)) return
      const current = latest.current.ports.read(), targets = listSlideWorkspaceHitTargets(state())
      const raw = targets.find(value => value.instanceId === request.instanceId)
      if (!current.project || current.canvasMode !== 'edit' || current.drawTool || !raw) return
      event.preventDefault(); event.stopPropagation()
      const content = renderRoots.current.get(request.instanceId), rendered = content && flowContentClientMatrix(content)
      const client = rendered ? transformPoint(rendered, request.localPoint)
        : transformPoint(mapping(), transformPoint(frameToSpaceMatrix(raw.frame, raw.parentToSurface), request.localPoint))
      const at = surfacePoint(client.x, client.y)
      const id = editingLevelInstanceId(current.project, current.surfaceId, request.instanceId, current.activeGroupId, request.altKey)
      if (!id) return
      const target = targets.find(value => value.instanceId === id)
      const candidate = id === request.instanceId && request.authorKey ? latest.current.ports.authorSpots?.().find(spot => spot.instanceId === id
        && spot.authorKey === request.authorKey && (request.mountGeneration === undefined || spot.mountGeneration === request.mountGeneration)) : undefined
      const builtin = componentDefinitionBuiltinKey(current.project.definitions[current.project.instances[id]?.definitionId])
      const wholeNative = ['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart'].includes(builtin ?? '')
      if (event.type === 'component-author-double-click') {
        if (componentIsLocked(current.project, id)) return
        if (builtin === 'guoling.group') { void latest.current.ports.enterGroup?.(id); return }
        if (current.project.instances[id]?.container) { void latest.current.ports.enterContainer?.(id); return }
        if (wholeNative) {
          latest.current.ports.select([id])
          if (nativeText.begin(id, at, client)) return
        }
        if (candidate) {
          const pending = { ...captureInputIntent(), caretOffset: request.caretOffset }
          void activateSpot(candidate, at, client, candidate.kind === 'text', undefined, pending).then(ok => {
            if (ok && candidate.kind === 'image') void replaceSpot(candidate)
          })
        } else {
          latest.current.ports.select([id])
          const context = pointerContext(current)
          window.setTimeout(() => {
            const current = latest.current.ports.read()
            if (pointerContext(current) === context && current.selectedInstanceIds.length === 1 && current.selectedInstanceIds[0] === id) requestObjectEdit(root, id)
          }, 0)
        }
        return
      }
      const phase = request.phase, pointerId = request.pointerId ?? 0
      const pending = realmPointer.current
      if (phase && phase !== 'start') {
        if (!pending || pending.id !== pointerId) return
        if (phase === 'cancel' || pending.context !== pointerContext(current)) {
          realmPointer.current = null; authoring.current?.cancelGesture(); setPreview(emptyPreview())
          if (internalGesture.current) internalGesture.current.preview?.(internalGesture.current.value.spot.id, null)
          internalGesture.current = null; setInternalPreview(null); return
        }
        pending.latest = { ...client, shiftKey: Boolean(request.shiftKey), altKey: Boolean(request.altKey) }
        pending.ended = phase === 'end'; pending.advance?.(pending.ended)
        return
      }
      if (current.contentEdit?.composing) return
      const start = { ...client, additive: Boolean(request.shiftKey || request.ctrlKey || request.metaKey), altKey: Boolean(request.altKey) }
      const next = { id: pointerId, context: pointerContext(current), ended: !phase,
        latest: { ...client, shiftKey: Boolean(request.shiftKey), altKey: Boolean(request.altKey) } } as NonNullable<typeof realmPointer.current>
      realmPointer.current = next
      const begin = () => {
        if (realmPointer.current !== next || pointerContext(latest.current.ports.read()) !== next.context) return
        if (request.button === 2) {
          realmPointer.current = null; authoring.current?.cancelGesture(); setPreview(emptyPreview())
          if (internalGesture.current) internalGesture.current.preview?.(internalGesture.current.value.spot.id, null)
          internalGesture.current = null; setInternalPreview(null)
          if (candidate && !wholeNative) latest.current.ports.selectAuthorSpot?.(candidate)
          else latest.current.ports.select([id])
          window.setTimeout(() => requestObjectContextMenu(root, { ...client, itemIds: [id],
            ...(candidate && !wholeNative ? { selectionIdentity: authorFieldIdentity(id, candidate) } : {}) }), 0)
          return
        }
        if (candidate && !wholeNative && !start.additive && !start.altKey && latest.current.ports.selectAuthorSpot) {
          latest.current.ports.selectAuthorSpot(candidate)
          if (candidate.geometry && !componentIsLocked(current.project!, id)) {
            internalGesture.current = { pointerId, start: client, moved: false, captured: latest.current.ports.capture(),
              instanceToSurface: frameToSpaceMatrix(raw.frame, raw.parentToSurface), preview: latest.current.ports.previewAuthorSpot,
              value: new AuthorSpotTransformGesture({ spot: candidate, mode: 'drag', instanceToSurface: frameToSpaceMatrix(raw.frame, raw.parentToSurface), surfaceToPointer: mapping(), pointer: client }) }
            next.advance = end => { if (end) finishInternalGesture(next.latest, { shift: next.latest.shiftKey, alt: next.latest.altKey }); else updateInternalGesture(next.latest, { shift: next.latest.shiftKey, alt: next.latest.altKey }); if (end) realmPointer.current = null }
          }
        } else if (target) {
          setPreview(authoring.current!.pointerDown(start, mapping(), undefined, { kind: 'object', instanceId: id, activeGroupId: current.activeGroupId ?? null }))
          next.advance = end => { if (end) { realmPointer.current = null; void authoring.current!.pointerUp(next.latest, mapping()).then(setPreview) } else setPreview(authoring.current!.pointerMove(next.latest, mapping())) }
        } else latest.current.ports.select([id])
        next.advance?.(next.ended)
      }
      if (current.contentEdit) void latest.current.ports.commitTextEdit().then(begin).catch(error => latest.current.ports.report(String(error)))
      else begin()
    }
    const fieldAction = (event: Event) => {
      const request = (event as CustomEvent<AuthorFieldActionRequest>).detail, current = latest.current.ports.read()
      if (!request || request.documentId !== current.documentId || request.epoch !== current.epoch
        || request.selectionIdentity !== interactionSelectionIdentity(current.interactionSelection)) return
      const observation = nativeField.current ?? nativeText.resolveSelection(current.interactionSelection)
      const native = observation?.read ? observation.read() : observation?.spot
      const spot = native && selectionMatchesSpot(current.interactionSelection, native) ? native
        : latest.current.ports.authorSpots?.().find(candidate => selectionMatchesSpot(current.interactionSelection, candidate))
      if (!spot || request.action === 'replace-image' && spot.kind !== 'image') return
      event.preventDefault()
      if (request.action === 'nudge') {
        const target = listSlideWorkspaceHitTargets(state()).find(value => value.instanceId === spot.instanceId)
        if (!spot.geometry || !target || componentIsLocked(current.project!, spot.instanceId)) {
          latest.current.ports.report('当前字段没有独立移动能力'); return
        }
        const value = new AuthorSpotTransformGesture({ spot, mode: 'drag', instanceToSurface: frameToSpaceMatrix(target.frame, target.parentToSurface),
          surfaceToPointer: [1, 0, 0, 1, 0, 0], pointer: { x: 0, y: 0 } }).update({ x: request.dx, y: request.dy })
        const captured = latest.current.ports.capture()
        void latest.current.ports.commit(authorSpotGeometryEdits(captured.editingProject, spot, value.geometry), captured, crypto.randomUUID())
          .catch(error => latest.current.ports.report(String(error)))
        return
      }
      if (native === spot && observation?.activate && request.action !== 'replace-image') {
        const activate = observation.activate, pending = captureInputIntent()
        void (async () => {
          if (current.contentEdit?.composing) return
          if (current.contentEdit) await latest.current.ports.commitTextEdit()
          if (sameInputContext(pending) && !activate()) latest.current.ports.report('最初选择的专业字段已变化，请重新选择。')
        })().catch(error => latest.current.ports.report(String(error)))
        return
      }
      const frame = spotTargets.find(value => authorFieldIdentity(value.spot.instanceId, value.spot) === authorFieldIdentity(spot.instanceId, spot))?.frame
      if (!frame) return
      const at = transformPoint(frame.transform, { x: frame.width / 2, y: frame.height / 2 })
      void activateSpot(spot, at, transformPoint(mapping(), at), request.action !== 'replace-image').then(ok => {
        const selected = ok && currentSpot(spot)
        if (selected && request.action === 'replace-image') void replaceSpot(selected)
      })
    }
    root.addEventListener('component-author-pointer', authorPointer)
    root.addEventListener('component-author-double-click', authorPointer)
    window.addEventListener(AUTHOR_FIELD_ACTION_EVENT, fieldAction)
    return () => {
      root.removeEventListener('component-author-pointer', authorPointer)
      root.removeEventListener('component-author-double-click', authorPointer)
      window.removeEventListener(AUTHOR_FIELD_ACTION_EVENT, fieldAction)
    }
  }, [Boolean(project), snapshot.documentId, snapshot.epoch, snapshot.rootInstanceId, snapshot.editingContainerId, snapshot.surfaceId, snapshot.activeStateId, snapshot.canvasMode, spots])
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
    } else if (item.startsWith('component:')) ports.addExternalComponentNode(item.slice(10), at.x, at.y, undefined,
      event.dataTransfer.getData('application/x-courseware-component-source') || undefined)
  }
  if (!project || !surface) return <main className="workspace" data-testid="slide-workspace-sessionless" role="alert"><p className="property-hint">请先打开或新建课件。</p></main>
  let effectiveProject = displayProject!
  let previewInstances = effectiveProject.instances
  for (const [id, frame] of Object.entries(previewFrames)) {
    const instance = effectiveProject.instances[id]
    if (!instance) continue
    if (previewInstances === effectiveProject.instances) previewInstances = { ...previewInstances }
    previewInstances[id] = { ...instance, frame }
  }
  if (previewInstances !== effectiveProject.instances) effectiveProject = { ...effectiveProject, instances: previewInstances }
  const targets = globalEditing ? listSlideWorkspaceHitTargets({ project: effectiveProject, surfaceId: surface.id,
    documentId: snapshot.documentId ?? '', selectedInstanceIds: snapshot.selectedInstanceIds, editingScope: 'global' }) : freeSurfaceTargets(effectiveProject, surface.id)
  const selected = selectedFreeTargets(targets, snapshot.selectedInstanceIds)
  const editableSelected = selected.filter(target => !componentIsLocked(project, target.instanceId))
  const selectedContent = selected.filter(target => !isViewportComponent(project, target.instanceId))
  const hudTargets = targets.filter(target => isViewportComponent(project, target.instanceId)
    && isComponentVisibleAtSurface(project.instances[target.instanceId], surface.id))
  const selectedHud = selected.filter(target => hudTargets.some(value => value.instanceId === target.instanceId))
  const viewportBounds = stageViewportRef.current?.getBoundingClientRect()
  const viewportScale = viewportBounds ? viewportBounds.width / viewport.width : 1
  const hudPointerMatrix: AffineMatrix = [viewportScale, 0, 0, viewportScale, viewportBounds?.left ?? 0, viewportBounds?.top ?? 0]
  const chromeMatrix: AffineMatrix = [scale * viewportScale, 0, 0, scale * viewportScale,
    (viewportBounds?.left ?? 0) + stageTransform.stageRect.x * viewportScale, (viewportBounds?.top ?? 0) + stageTransform.stageRect.y * viewportScale]
  const background = resolveComponentBackground(project, surface)
  let recoverableInstances = project.instances
  for (const id of Object.keys(project.instances)) {
    const instance = project.instances[id]
    if (instance.visible !== false) continue
    if (recoverableInstances === project.instances) recoverableInstances = { ...recoverableInstances }
    recoverableInstances[id] = { ...instance, visible: true }
  }
  const hidden = recoverableInstances === project.instances ? [] : listSlideWorkspaceHitTargets({ project: { ...project, instances: recoverableInstances }, surfaceId: surface.id, documentId: snapshot.documentId ?? '',
    selectedInstanceIds: snapshot.selectedInstanceIds, activeStateId: snapshot.activeStateId, editingScope: snapshot.editingScope })
    .filter(target => project.instances[target.instanceId]?.visible === false && target.ancestors.every(id => project.instances[id]?.visible !== false))
  const hiddenMenu = () => hidden.map(target => ({
    id: 'show.' + target.instanceId, label: project.instances[target.instanceId].name ?? project.definitions[project.instances[target.instanceId].definitionId]?.title ?? '对象',
    run: () => { void ports.edit([{ type: 'instance.patch', instanceId: target.instanceId, patch: { visible: true } }]).catch(error => ports.report(String(error))) },
  }))
  const selectedInstance = selected.length === 1 ? project.instances[selected[0].instanceId] : null
  const selectedBuiltinKey = selectedInstance && componentDefinitionPresentation(project.definitions[selectedInstance.definitionId]).builtinKey
  const selectedLine = editableSelected.length === 1 && selectedBuiltinKey === 'guoling.shape'
    ? shapeDataSchema.safeParse(selectedInstance!.data) : null
  const lineGeometry = selectedLine?.success && ['line', 'elbow-arrow'].includes(selectedLine.data.shapeType)
    ? linePreview?.geometry ?? selectedLine.data.lineGeometry ?? getDefaultLineGeometry(selectedLine.data.shapeType === 'elbow-arrow' ? 'elbow-arrow' : 'line') : null
  const linePoints = selectedLine?.success && lineGeometry && selected.length === 1
    ? resolveNativeLinePoints(lineGeometry, selected[0].frame.width, selected[0].frame.height).map(at => transformPoint(frameToSpaceMatrix(selected[0].frame, selected[0].parentToSurface), at)) : null
  const selectedFieldBounds = () => {
    if (!selectedInternal) return null
    const points = frameCorners(internalPreview ?? selectedInternal.frame).map(point => transformPoint(mapping(), point))
    const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y))
    return { left, top, width: Math.max(...points.map(point => point.x)) - left, height: Math.max(...points.map(point => point.y)) - top }
  }
  const preciseSelection = snapshot.interactionSelection?.kind === 'author-field'
  const canTransformSelection = !snapshot.contentEdit && selected.length > 0 && selected.length === editableSelected.length
  const canTransformField = !snapshot.contentEdit && Boolean(selectedInternal?.spot.geometry) && !componentIsLocked(project, selectedInternal?.spot.instanceId ?? '')
  const unframedSelection = !preciseSelection && snapshot.selectedInstanceIds.length === 1 && !selected.length
    ? workspaceRef.current?.querySelector<HTMLElement>(`[data-component-instance="${CSS.escape(snapshot.selectedInstanceIds[0])}"]`)?.getBoundingClientRect() : null
  const stop = (event: React.PointerEvent) => { event.preventDefault(); event.stopPropagation() }
  return <main ref={workspaceRef} className={'workspace workspace--' + snapshot.canvasMode} aria-label="画布"
    style={snapshot.drawTool ? { cursor: 'crosshair' } : undefined}
    onDragOver={event => {
      if (snapshot.canvasMode !== 'edit') return
      if (event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE) || event.dataTransfer.types.includes('application/x-courseware-element')) {
        event.preventDefault(); event.dataTransfer.dropEffect = 'copy'
        setMediaDragOver(Boolean(readDropPoint(event.clientX, event.clientY)))
      }
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMediaDragOver(false) }} onDrop={onDrop}
    onPointerDownCapture={event => {
      plainSpotPointer.current = null
      if (outsideStage(event.target) || snapshot.canvasMode !== 'edit') return
      if (event.button === 1 || (event.button === 0 && space.current)) {
        cancelPreviewMove(); gestureContext.current = pointerContext(latest.current.ports.read())
        stop(event); pan.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, x: view.x, y: view.y }
        setPanning(true); event.currentTarget.setPointerCapture(event.pointerId); return
      }
      if (event.button !== 0) return
      cancelPreviewMove(); gestureContext.current = pointerContext(latest.current.ports.read())
      const intended = captureInputIntent()
      if (!snapshot.contentEdit && !snapshot.drawTool) {
        const selectedHandle = event.target instanceof Element && event.target.closest('[data-internal-selection]')
        const outerHandle = !selectedHandle && event.target instanceof Element && event.target.closest('[data-handle]')
        const at = surfacePoint(event.clientX, event.clientY), client = { x: event.clientX, y: event.clientY }
        const hit = selectedHandle ? selectedInternal : undefined
        if (!selectedHandle && !outerHandle && !(event.target instanceof Element && event.target.closest('[data-line-handle],[data-controller-selection]'))) {
          stop(event); suppressSpotClick.current = true
          const start = { x: event.clientX, y: event.clientY, additive: event.shiftKey || event.ctrlKey || event.metaKey, altKey: event.altKey }
          const pending = { id: event.pointerId, ended: false, resolved: false,
            latest: { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey } }, owner = event.currentTarget
          plainSpotPointer.current = pending; owner.setPointerCapture(event.pointerId)
          void resolveVisibleAt(client).then(async visible => {
            if (plainSpotPointer.current !== pending || !sameInputContext(intended) || latest.current.ports.read().contentEdit) return
            pending.resolved = true
            const hud = visible && hudTargets.find(target => target.instanceId === visible.instanceId)
            if (hud) {
              plainSpotPointer.current = null
              ports.select([hud.instanceId])
              if (componentIsLocked(project, hud.instanceId)) return
              const captured = ports.capture(), geometry = controllerGeometry.current
              gestureDisplay.current = { original: project, display: displayProject!, geometry, offset: geometry.port?.placement?.() ?? { x: 0, y: 0 } }
              const value = new FreeTransformGesture({ mode: 'drag', targets: [hud], pointer: client, surfaceToPointer: hudPointerMatrix })
              if (pending.ended) {
                if (Math.hypot(pending.latest.x - client.x, pending.latest.y - client.y) >= 3) {
                  const frozen = gestureDisplay.current, edits = value.update(pending.latest, { shift: pending.latest.shiftKey, alt: pending.latest.altKey }).edits
                  if (edits.length) await ports.commit(restoreTeacherControllerFrameEdits(edits, frozen.original, frozen.display, frozen.geometry.viewport, frozen.offset, frozen.geometry.port), captured, crypto.randomUUID())
                }
              } else hudGesture.current = { pointerId: pending.id, start: client, hadMove: false, captured, edits: [], value }
              return
            }
            const targets = listSlideWorkspaceHitTargets(state()), leaf = visible && targets.find(value => value.instanceId === visible.instanceId)
            const spot = leaf && (visible?.authorKey ? latest.current.ports.authorSpots?.().find(value => value.instanceId === leaf.instanceId && value.authorKey === visible.authorKey) : visible?.authorKey === undefined ? ownerSpotAt(leaf.instanceId, at)?.spot : undefined)
            const target = leaf && freeTargetAtEditingLevel(targets, leaf.instanceId, latest.current.ports.read().activeGroupId, start.altKey)
            const levelId = visible && editingLevelInstanceId(project, surface.id, visible.instanceId, snapshot.activeGroupId, start.altKey)
            if (levelId && !target) { plainSpotPointer.current = null; ports.select([levelId]); return }
            const builtin = leaf && componentDefinitionBuiltinKey(project.definitions[project.instances[leaf.instanceId]?.definitionId])
            const wholeNative = builtin === 'guoling.text' || builtin === 'guoling.formula' || builtin === 'guoling.table' || builtin === 'guoling.chart'
            if (spot && !wholeNative && target?.instanceId === leaf?.instanceId && !start.additive && !start.altKey && ports.selectAuthorSpot) {
              ports.selectAuthorSpot?.(spot)
              if (spot.geometry && !componentIsLocked(project, spot.instanceId)) {
                const instanceToSurface = frameToSpaceMatrix(leaf!.frame, leaf!.parentToSurface), captured = ports.capture()
                internalGesture.current = { pointerId: pending.id, start: client, moved: false, captured, instanceToSurface, preview: ports.previewAuthorSpot,
                  value: new AuthorSpotTransformGesture({ spot, mode: 'drag', instanceToSurface, surfaceToPointer: mapping(), pointer: client }) }
                if (pending.ended) finishInternalGesture(pending.latest, { shift: pending.latest.shiftKey, alt: pending.latest.altKey })
                else updateInternalGesture(pending.latest, { shift: pending.latest.shiftKey, alt: pending.latest.altKey })
              }
              plainSpotPointer.current = null; return
            }
            // Apply grouping only after identifying the front leaf; a previous sibling selection never wins.
            plainSpotPointer.current = null; pointer.current = pending.ended ? null : pending.id
            setPreview(authoring.current!.pointerDown(start, mapping(), undefined, target ? { kind: 'object', instanceId: target.instanceId, activeGroupId: snapshot.activeGroupId ?? null } : { kind: 'blank', activeGroupId: snapshot.activeGroupId ?? null }))
            if (pending.ended) setPreview(await authoring.current!.pointerUp(pending.latest, mapping()))
            else setPreview(authoring.current!.pointerMove(pending.latest, mapping()))
          }).catch(error => { if (plainSpotPointer.current === pending) plainSpotPointer.current = null; ports.report(String(error)) })
          return
        }
        if (hit) {
          stop(event); suppressSpotClick.current = true
          if (componentIsLocked(project, hit.spot.instanceId)) return
          if (!hit.spot.geometry) return
          if (event.shiftKey || event.ctrlKey || event.metaKey) {
            pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
            setPreview(authoring.current!.pointerDown({ x: event.clientX, y: event.clientY, additive: true, altKey: event.altKey }, mapping()))
            suppressSpotClick.current = true; return
          }
          ports.selectAuthorSpot?.(hit.spot)
          event.currentTarget.setPointerCapture(event.pointerId)
          const handle = selectedHandle && event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | 'move' | null : null
          const instanceToSurface = frameToSpaceMatrix(hit.target.frame, hit.target.parentToSurface), captured = ports.capture()
          internalGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false, captured, instanceToSurface, preview: ports.previewAuthorSpot,
            value: new AuthorSpotTransformGesture({ spot: hit.spot, ...selectionHandleGesture(handle), instanceToSurface, surfaceToPointer: mapping(), pointer: { x: event.clientX, y: event.clientY } }) }
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
          const handle = event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | 'move' | null : null
          const captured = ports.capture(), geometry = controllerGeometry.current
          gestureDisplay.current = { original: project, display: displayProject!, geometry, offset: geometry.port?.placement?.() ?? { x: 0, y: 0 } }
          hudGesture.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, hadMove: false, captured, edits: [], value: new FreeTransformGesture({
            ...selectionHandleGesture(handle),
            targets, pointer: { x: event.clientX, y: event.clientY }, surfaceToPointer: hudPointerMatrix }) }
          return
        }
      }
      if (snapshot.contentEdit) {
        if (snapshot.contentEdit.composing || snapshot.drawTool) return
        stop(event); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
        const client = { x: event.clientX, y: event.clientY }, at = surfacePoint(client.x, client.y)
        const start = { ...client, additive: event.shiftKey || event.ctrlKey || event.metaKey, altKey: event.altKey }
        const pending = { id: event.pointerId, ...intended, start,
          latest: { ...client, shiftKey: event.shiftKey, altKey: event.altKey }, ended: false }
        deferredPointer.current = pending
        // Resolve the pressed object before the previous input settles; never repeat the screen hit afterwards.
        void resolveVisibleAt(client).then(async visible => {
          const original = latest.current.ports.read(), id = visible && original.project
            ? editingLevelInstanceId(original.project, original.surfaceId, visible.instanceId, original.activeGroupId, start.altKey) : null
          const candidate = id === visible?.instanceId && visible?.authorKey ? latest.current.ports.authorSpots?.().find(spot => spot.instanceId === id && spot.authorKey === visible.authorKey) : undefined
          if (deferredPointer.current !== pending || !sameInputContext(pending)) return
          const active = document.activeElement
          if (active instanceof HTMLElement && active.matches('input,textarea,[contenteditable="true"]')) active.blur()
          await ports.commitTextEdit()
          if (deferredPointer.current !== pending || !sameInputContext(pending) || latest.current.ports.read().contentEdit) return
          deferredPointer.current = null
          const builtin = id && componentDefinitionBuiltinKey(original.project!.definitions[original.project!.instances[id]?.definitionId])
          if (candidate && !['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart'].includes(builtin || '') && !start.additive && !start.altKey) {
            pointer.current = null; ports.selectAuthorSpot?.(candidate)
            const owner = listSlideWorkspaceHitTargets(state()).find(value => value.instanceId === id)
            if (candidate.geometry && owner && !componentIsLocked(original.project!, id!)) {
              const matrix = frameToSpaceMatrix(owner.frame, owner.parentToSurface)
              internalGesture.current = { pointerId: pending.id, start: client, moved: false, captured: ports.capture(), instanceToSurface: matrix, preview: ports.previewAuthorSpot,
                value: new AuthorSpotTransformGesture({ spot: candidate, mode: 'drag', instanceToSurface: matrix, surfaceToPointer: mapping(), pointer: client }) }
              if (pending.ended) finishInternalGesture(pending.latest, { shift: pending.latest.shiftKey, alt: pending.latest.altKey })
              else updateInternalGesture(pending.latest, { shift: pending.latest.shiftKey, alt: pending.latest.altKey })
            }
            return
          }
          const target = id && listSlideWorkspaceHitTargets(state()).find(value => value.instanceId === id)
          if (id && !target) { ports.select([id]); pointer.current = null; return }
          setPreview(authoring.current!.pointerDown(pending.start, mapping(), undefined, target
            ? { kind: 'object', instanceId: target.instanceId, activeGroupId: original.activeGroupId ?? null }
            : { kind: 'blank', activeGroupId: original.activeGroupId ?? null }))
          if (pending.ended) setPreview(await authoring.current!.pointerUp(pending.latest, mapping()))
          else setPreview(authoring.current!.pointerMove(pending.latest, mapping()))
        }).catch(error => { if (deferredPointer.current === pending) deferredPointer.current = null; pointer.current = null; ports.report(String(error)) })
        return
      }
      stop(event); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId)
      const at = surfacePoint(event.clientX, event.clientY)
      if (snapshot.drawTool) { const start = snapLine(at, event.altKey); draw.current = { start, type: snapshot.drawTool, target: ports.capture() }; setDrawPreview({ start, end: start }); return }
      const handle = event.target instanceof Element ? event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | 'move' | null : null
      const lineHandle = event.target instanceof Element ? event.target.closest('[data-line-handle]')?.getAttribute('data-line-handle') as 'start' | 'end' | 'elbow' | null : null
      if (lineHandle && selected.length === 1 && lineGeometry) {
        line.current = { target: ports.capture(), initial: selected[0], instanceId: selected[0].instanceId, handle: lineHandle,
          matrix: frameToSpaceMatrix(selected[0].frame, selected[0].parentToSurface), frame: selected[0].frame, geometry: lineGeometry }
        return
      }
      setPreview(authoring.current!.pointerDown({ x: event.clientX, y: event.clientY, additive: event.shiftKey || event.ctrlKey || event.metaKey, altKey: event.altKey }, mapping(), handle === 'move' ? undefined : handle ?? undefined))
    }}
    onPointerMoveCapture={event => {
      if (plainSpotPointer.current?.id === event.pointerId) {
        stop(event); plainSpotPointer.current.latest = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }
        const draft = latest.current.ports.read().contentEdit
        if (draft?.authorSpot) event.currentTarget.dispatchEvent(new CustomEvent('component-author-selection', { bubbles: true,
          detail: { instanceId: draft.instanceId, authorKey: draft.authorSpot.authorKey, point: { x: event.clientX, y: event.clientY } } }))
        return
      }
      if (internalGesture.current?.pointerId === event.pointerId) {
        stop(event); updateInternalGesture({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey }); return
      }
      if (hudGesture.current?.pointerId === event.pointerId) {
        stop(event); const gesture = hudGesture.current, point = { x: event.clientX, y: event.clientY }, modifiers = { shift: event.shiftKey, alt: event.altKey }
        gesture.hadMove ||= Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) >= 3
        if (!gesture.hadMove) return
        schedulePreviewMove(event.pointerId, () => {
          if (hudGesture.current !== gesture) return
          const update = gesture.value.update(point, modifiers)
          gesture.edits = update.edits; setPreview({ preview: Object.fromEntries(update.edits.flatMap(edit => edit.type === 'frame.set' && edit.frame ? [[edit.instanceId, edit.frame]] : [])), guides: [], marquee: null })
        }); return
      }
      if (pan.current?.id === event.pointerId) {
        stop(event); const p = pan.current, point = { x: event.clientX, y: event.clientY }
        schedulePreviewMove(event.pointerId, () => { if (pan.current === p) setView(current => ({ ...current, x: p.x + point.x - p.start.x, y: p.y + point.y - p.start.y })) }); return
      }
      if (pointer.current !== event.pointerId) {
        if (snapshot.canvasMode === 'edit') {
          const current = latest.current.ports.read()
          hoverPending.current = { point: { x: event.clientX, y: event.clientY }, sequence: ++hoverHitSequence.current,
            intent: inputIntent.current, context: pointerContext(current), selection: interactionSelectionIdentity(current.interactionSelection) }
          scheduleHover()
        }
        return
      }
      stop(event)
      if (deferredPointer.current?.id === event.pointerId) {
        deferredPointer.current.latest = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }; return
      }
      if (draw.current) { setDrawPreview({ start: draw.current.start, end: snapLine(surfacePoint(event.clientX, event.clientY), event.altKey) }); return }
      if (line.current) {
        const value = line.current, proposal = proposeSlideLineHandle(value.initial, value.geometry, value.handle, snapLine(surfacePoint(event.clientX, event.clientY), event.altKey, value.instanceId))
        if (proposal) setLinePreview({ instanceId: value.instanceId, ...proposal }); return
      }
      const pointerId = event.pointerId, point = { x: event.clientX, y: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey }
      schedulePreviewMove(pointerId, () => {
        if (pointer.current !== pointerId || deferredPointer.current || draw.current || line.current) return
        const next = authoring.current!.pointerMove(point, mapping())
        if (Object.keys(next.preview).length) suppressSpotClick.current = true
        setPreview(next)
      })
    }}
    onPointerUpCapture={event => {
      if (plainSpotPointer.current?.id === event.pointerId) {
        stop(event); const pending = plainSpotPointer.current; pending.ended = true
        pending.latest = { x: event.clientX, y: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey }
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (pending.resolved) plainSpotPointer.current = null
        return
      }
      if (internalGesture.current?.pointerId === event.pointerId) {
        stop(event); finishInternalGesture({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey })
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        return
      }
      if ((hudGesture.current?.pointerId === event.pointerId || pan.current?.id === event.pointerId || pointer.current === event.pointerId)
        && gestureContext.current !== pointerContext(latest.current.ports.read())) {
        stop(event); cancelPreviewMove(); authoring.current?.cancelGesture(); hudGesture.current = null; pan.current = null; pointer.current = null
        deferredPointer.current = null; draw.current = null; line.current = null; setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null); setPanning(false)
        event.currentTarget.releasePointerCapture(event.pointerId); return
      }
      if (hudGesture.current?.pointerId === event.pointerId) {
        stop(event); cancelPreviewMove(); const gesture = hudGesture.current, frozen = gestureDisplay.current; hudGesture.current = null
        if (gesture.hadMove || Math.hypot(event.clientX - gesture.start.x, event.clientY - gesture.start.y) >= 3)
          gesture.edits = gesture.value.update({ x: event.clientX, y: event.clientY }, { shift: event.shiftKey, alt: event.altKey }).edits
        event.currentTarget.releasePointerCapture(event.pointerId); setPreview(emptyPreview())
        if (gesture.edits.length && frozen) void ports.commit(restoreTeacherControllerFrameEdits(gesture.edits, frozen.original, frozen.display,
          frozen.geometry.viewport, frozen.offset, frozen.geometry.port), gesture.captured, crypto.randomUUID()).catch(error => ports.report(String(error)))
        return
      }
      if (pan.current?.id === event.pointerId) {
        stop(event); cancelPreviewMove(); const p = pan.current
        setView(current => ({ ...current, x: p.x + event.clientX - p.start.x, y: p.y + event.clientY - p.start.y }))
        pan.current = null; setPanning(false); event.currentTarget.releasePointerCapture(event.pointerId); return
      }
      if (pointer.current !== event.pointerId) return
      stop(event); flushPreviewMove(); pointer.current = null; event.currentTarget.releasePointerCapture(event.pointerId)
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
      if (previewMove.current?.pointerId === event.pointerId) cancelPreviewMove()
      if (pan.current?.id === event.pointerId) { pan.current = null; setPanning(false); return }
      if (plainSpotPointer.current?.id === event.pointerId) { plainSpotPointer.current = null; return }
      if (internalGesture.current?.pointerId === event.pointerId) { internalGesture.current.preview?.(internalGesture.current.value.spot.id, null); internalGesture.current = null; setInternalPreview(null); suppressSpotClick.current = true; return }
      if (hudGesture.current?.pointerId === event.pointerId) { hudGesture.current = null; setPreview(emptyPreview()); return }
      if (pointer.current !== event.pointerId) return
      pointer.current = null; deferredPointer.current = null; draw.current = null; line.current = null; authoring.current?.cancelGesture()
      setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null)
    }}
    onLostPointerCapture={event => {
      // Releasing after pointerup is normal; a capture stolen during a press cancels its preview.
      if (plainSpotPointer.current?.id === event.pointerId && plainSpotPointer.current.ended
        || deferredPointer.current?.id === event.pointerId && deferredPointer.current.ended) return
      if (plainSpotPointer.current?.id === event.pointerId) plainSpotPointer.current = null
      if (internalGesture.current?.pointerId === event.pointerId) {
        internalGesture.current.preview?.(internalGesture.current.value.spot.id, null); internalGesture.current = null; setInternalPreview(null)
      }
      if (hudGesture.current?.pointerId === event.pointerId) { hudGesture.current = null; setPreview(emptyPreview()) }
      if (pan.current?.id === event.pointerId) { pan.current = null; setPanning(false) }
      if (pointer.current !== event.pointerId) return
      cancelPreviewMove(); pointer.current = null; deferredPointer.current = null; draw.current = null; line.current = null
      authoring.current?.cancelGesture(); setPreview(emptyPreview()); setDrawPreview(null); setLinePreview(null)
    }}
    onContextMenu={async event => {
      if (outsideStage(event.target) || snapshot.canvasMode !== 'edit' || snapshot.contentEdit || snapshot.drawTool) return
      event.preventDefault()
      const point = { x: event.clientX, y: event.clientY }, root = event.currentTarget
      const pending = captureInputIntent(), visible = await resolveVisibleAt(point)
      if (!sameInputContext(pending)) return
      const hudHit = hudTargets.find(target => target.instanceId === visible?.instanceId)
      if (hudHit) {
        ports.select([hudHit.instanceId]); window.setTimeout(() => requestObjectContextMenu(root, { ...point, itemIds: [hudHit.instanceId] }), 0); return
      }
      const at = surfacePoint(point.x, point.y)
      const objectHit = visible ? { kind: 'object' as const, instanceId: visible.instanceId } : { kind: 'blank' as const }
      const candidate = visible?.authorKey ? latest.current.ports.authorSpots?.().find(spot => spot.instanceId === visible.instanceId && spot.authorKey === visible.authorKey) : visible?.authorKey === undefined && visible ? ownerSpotAt(visible.instanceId, at)?.spot : undefined
      if (candidate) {
        void Promise.resolve(candidate).then(spot => {
        if (!sameInputContext(pending)) return
        if (!spot) {
          if (objectHit.kind !== 'object' || !listSlideWorkspaceHitTargets(state()).some(target => target.instanceId === objectHit.instanceId)) return
          latest.current.ports.select([objectHit.instanceId])
          const objectIdentity = interactionSelectionIdentity({ kind: 'objects', instanceIds: [objectHit.instanceId] })
          window.setTimeout(() => {
            const current = latest.current.ports.read()
            if (inputIntent.current === pending.intent && pointerContext(current) === pending.context
              && interactionSelectionIdentity(current.interactionSelection) === objectIdentity)
              requestObjectContextMenu(root, { ...point, itemIds: [objectHit.instanceId] })
          }, 0)
          return
        }
        ports.selectAuthorSpot?.(spot)
        const locked = componentIsLocked(project, spot.instanceId)
        const selectionIdentity = authorFieldIdentity(spot.instanceId, spot)
        const menuIsCurrent = () => inputIntent.current === pending.intent && pointerContext(latest.current.ports.read()) === pending.context
          && interactionSelectionIdentity(latest.current.ports.read().interactionSelection) === selectionIdentity
        const extra = [{ id: 'spot.' + spot.id, label: spot.kind === 'image' ? '替换此处图片…' : spot.sourceRegion?.kind === 'implementation' ? '编辑此处源码片段' : '编辑此处文字',
          group: 'edit', disabledReason: locked ? '对象已锁定' : null,
          run: () => {
            if (!menuIsCurrent()) return
            const current = currentSpot(spot)
            if (!current) { ports.report('最初选择的字段已变化，请重新选择。'); return }
            if (current.kind === 'image') void replaceSpot(current)
            else void beginSpot(current, at, point)
          } }]
        window.setTimeout(() => { if (menuIsCurrent()) requestObjectContextMenu(root, { ...point, itemIds: [spot.instanceId], selectionIdentity, extra }) }, 0)
        }).catch(error => ports.report(String(error))); return
      }
      const hit = visible && listSlideWorkspaceHitTargets(state()).find(target => target.instanceId === visible.instanceId)
      if (hit) ports.select([hit.instanceId])
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
    onDoubleClickCapture={async event => {
      if (outsideStage(event.target) || snapshot.canvasMode !== 'edit' || snapshot.contentEdit?.composing || snapshot.drawTool) return
      event.preventDefault(); event.stopPropagation()
      const owner = event.currentTarget
      const pending = captureInputIntent()
      const at = surfacePoint(event.clientX, event.clientY), client = { x: event.clientX, y: event.clientY }
      const visible = await resolveVisibleAt(client)
      if (!sameInputContext(pending)) return
      if (latest.current.ports.read().contentEdit) {
        try { await latest.current.ports.commitTextEdit() }
        catch (error) { ports.report(String(error)); return }
        if (!sameInputContext(pending) || latest.current.ports.read().contentEdit) return
      }
      const id = visible && editingLevelInstanceId(project, surface.id, visible.instanceId, snapshot.activeGroupId)
      if (!id || componentIsLocked(project, id)) return
      const builtin = componentDefinitionBuiltinKey(project.definitions[project.instances[id]?.definitionId])
      if (builtin === 'guoling.group') { event.preventDefault(); event.stopPropagation(); void ports.enterGroup?.(id); return }
      if (project.instances[id]?.container) { event.preventDefault(); event.stopPropagation(); void ports.enterContainer?.(id); return }
      if (['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart'].includes(builtin ?? '')) {
        ports.select([id])
        if (nativeText.begin(id, at, client)) return
      }
      if (builtin === 'guoling.image') {
        ports.select([id])
        window.setTimeout(() => {
          const current = latest.current.ports.read()
          if (pointerContext(current) === pending.context && current.selectedInstanceIds.length === 1 && current.selectedInstanceIds[0] === id) requestObjectEdit(owner, id)
        }, 0)
        return
      }
      const candidate = visible?.authorKey ? latest.current.ports.authorSpots?.().find(spot => spot.instanceId === visible.instanceId && spot.authorKey === visible.authorKey) : visible?.authorKey === undefined && visible ? ownerSpotAt(visible.instanceId, at)?.spot : undefined
      if (candidate) {
        event.preventDefault(); event.stopPropagation()
        void Promise.resolve(candidate).then(async spot => {
        if (!spot || !sameInputContext(pending)) return
        if (spot.kind === 'image') {
          if (await activateSpot(spot, at, client, false, undefined, pending) && inputIntent.current === pending.intent
            && pointerContext(latest.current.ports.read()) === pending.context
            && interactionSelectionIdentity(latest.current.ports.read().interactionSelection) === authorFieldIdentity(spot.instanceId, spot)) {
            const current = currentSpot(spot)
            if (current) void replaceSpot(current)
          }
        } else await activateSpot(spot, at, client, true, undefined, pending)
        }).catch(error => ports.report(String(error)))
        return
      }
      const hit = listSlideWorkspaceHitTargets(state()).find(target => target.instanceId === visible?.instanceId)
      if (hit && nativeText.begin(hit.instanceId, at, { x: event.clientX, y: event.clientY })) {
        event.preventDefault(); event.stopPropagation()
      }
    }}>
    <NativeSelectionContext authorSpot={selectedInternal?.spot} authorBounds={selectedFieldBounds} documentId={snapshot.documentId} revision={project.revision} locationId={surface.id} itemIds={snapshot.selectedInstanceIds}
      stateId={snapshot.activeStateId} sceneItemIds={surface.childIds} enabled={snapshot.canvasMode === 'edit'} textEditing={Boolean(snapshot.contentEdit)}
      bounds={id => {
        if (snapshot.selectedInstanceIds.length === 1 && selectedInternal?.spot.instanceId === id) {
          const points = frameCorners(selectedInternal.frame).map(point => transformPoint(mapping(), point))
          const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y))
          return { left, top, width: Math.max(...points.map(point => point.x)) - left, height: Math.max(...points.map(point => point.y)) - top }
        }
        const target = targets.find(value => value.instanceId === id), rect = stageRef.current?.getBoundingClientRect()
        if (!target && unframedSelection) return unframedSelection
        if (!target || !rect) return null
        const bounds = freeTargetBounds(target)
        if (isViewportComponent(project, id)) return { left: (viewportBounds?.left ?? 0) + bounds.left * viewportScale,
          top: (viewportBounds?.top ?? 0) + bounds.top * viewportScale, width: bounds.width * viewportScale, height: bounds.height * viewportScale }
        return { left: rect.left + bounds.left * scale, top: rect.top + bounds.top * scale, width: bounds.width * scale, height: bounds.height * scale }
      }} />
    <CourseNavigationControls canvasMode={snapshot.canvasMode} onCanvasModeChange={ports.setCanvasMode}
      navigation={ports.teacherController} beforeNavigate={ports.commitTextEdit} resetPlayback={ports.resetPlayback} report={ports.report} />
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
          transform: 'scale(' + scale + ')', transition: 'none', visibility: 'visible', overflow: 'visible', isolation: 'isolate' }}>
        {!globalEditing && <ComponentBackgroundPaint background={project.rootIds.includes(surface.id) ? resolveComponentBackground(project) : undefined} resolveAsset={id => snapshot.assetUrls[id]} />}
        <div className="canvas-stage canvas-stage--authoring" data-testid="canvas-stage" style={{ position: 'absolute', inset: 0, visibility: 'visible', pointerEvents: 'auto' }}>
          {(project.rootIds.includes(surface.id) || snapshot.editingScope === 'global' ? project.global.underlay : []).map(id => <SlideInstance key={id} id={id} project={stageDisplayProject!} surfaceId={surface.id} preview={stagePreview} ports={ports} renderRoots={renderRoots.current} clipCanvas={canvas} authorGuides={snapshot.canvasMode === 'edit'} />)}
          {(project.rootIds.includes(surface.id) ? componentSurfaces(project) : [surface]).filter(value => value.kind === 'slide' && (value.id === surface.id || visitedSurfaces.has(value.id))).map(value => <div key={value.id} hidden={globalEditing || value.id !== surface.id} style={{ position: 'absolute', inset: 0, overflow: 'hidden', isolation: 'isolate' }}>
            <ComponentBackgroundPaint background={resolveComponentSurfaceBackground(project, value)} resolveAsset={id => snapshot.assetUrls[id]} />
            {value.childIds.map(id => <SlideInstance key={id} id={id} project={project} surfaceId={value.id} preview={stagePreview} ports={ports} renderRoots={renderRoots.current} authorGuides={snapshot.canvasMode === 'edit'} />)}
          </div>)}
          {(project.rootIds.includes(surface.id) || snapshot.editingScope === 'global' ? project.global.overlay : []).map(id => <SlideInstance key={id} id={id} project={stageDisplayProject!} surfaceId={surface.id} preview={stagePreview} ports={ports} renderRoots={renderRoots.current} clipCanvas={canvas} authorGuides={snapshot.canvasMode === 'edit'} />)}
        </div>
        {snapshot.canvasMode === 'edit' && <div data-slide-authoring-hit-plane="" style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'auto' }} />}
        {snapshot.canvasMode === 'edit' && !snapshot.contentEdit && <div className="canvas-authoring-targets" data-testid="runtime-authoring-targets" aria-label="画布可编辑内容" style={{ zIndex: 12 }}>
          {spotTargets.filter(({ spot }) => !componentIsLocked(project, spot.instanceId) && !selectionMatchesSpot(snapshot.interactionSelection, spot)
            && !(snapshot.interactionSelection?.kind === 'objects' && snapshot.interactionSelection.instanceIds.includes(spot.instanceId)
              && ['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart', 'guoling.image'].includes(componentDefinitionBuiltinKey(project.definitions[project.instances[spot.instanceId]?.definitionId]) ?? '')))
            .map(({ spot, frame }) => <button key={spot.id} type="button" className={'canvas-authoring-target canvas-authoring-target--' + (spot.kind === 'image' ? 'asset' : 'text') + (hoveredSpot === spot.id ? ' canvas-authoring-target--hovered' : '')}
            aria-label={spot.kind === 'image' ? '选择此处图片；双击或菜单替换' : '选择此处文字；双击编辑'} disabled={spot.id === replacingSpot}
            data-author-spot={spotKey(spot)} onFocus={() => setHoveredSpot(spot.id)} onBlur={() => setHoveredSpot(null)} onClick={() => {
              if (suppressSpotClick.current) { suppressSpotClick.current = false; return }
              const at = transformPoint(frame.transform, { x: frame.width / 2, y: frame.height / 2 })
              void activateSpot(spot, at, transformPoint(mapping(), at), false)
            }}
            style={{ ...componentFrameStyle(frame), zIndex: 12 }}><span className="canvas-authoring-target__badge" aria-hidden="true" style={{ visibility: hoveredSpot === spot.id ? 'visible' : 'hidden' }}>{spot.kind === 'image' ? '图片 · 点此选中' : '文字 · 双击编辑'}</span></button>)}
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
    </div>
    {snapshot.canvasMode === 'edit' && !preciseSelection && <><SlideLayerSelectionOverlay targets={selectedContent} scale={scale} surfaceToPointer={chromeMatrix} lineHandles={Boolean(linePoints)} movable={canTransformSelection} resizable={canTransformSelection} rotatable={canTransformSelection} />
      <div data-controller-selection="true"><SlideLayerSelectionOverlay targets={selectedHud} scale={viewportScale} surfaceToPointer={hudPointerMatrix} movable={canTransformSelection} resizable={canTransformSelection} rotatable={canTransformSelection} /></div></>}
    {snapshot.canvasMode === 'edit' && selectedInternal && <div data-internal-selection="true">
      <SlideLayerSelectionOverlay targets={[{ ...selectedInternal.target, frame: internalPreview ?? selectedInternal.frame,
        parentToSurface: [1, 0, 0, 1, 0, 0], ancestors: [], preserveAspectRatio: selectedInternal.spot.kind === 'image' }]} scale={scale} surfaceToPointer={chromeMatrix} movable={canTransformField} resizable={canTransformField} rotatable={canTransformField} />
    </div>}
    {snapshot.canvasMode === 'edit' && unframedSelection && <div data-selection-only="true" style={{ position: 'fixed', pointerEvents: 'none', border: '1px solid #2563eb', left: unframedSelection.left, top: unframedSelection.top, width: unframedSelection.width, height: unframedSelection.height }} />}
    {canvasMenu.element}
  </main>
}
