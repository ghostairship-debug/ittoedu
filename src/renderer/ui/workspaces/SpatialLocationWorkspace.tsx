import { useComponentAuthorInteraction, type ComponentAuthorObjectPointer } from './useComponentAuthorInteraction'
import { visibleComponentAuthorHit } from '../../components/componentAuthorHit'
import type { ImportedImageAsset } from '../../project/assetManager'
import type { TextRangeProjection } from '../../../shared/document/textInteraction'
import { Hand, Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import type { ComponentEdit, ComponentFrame, ComponentSurface, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { componentDefinitionBuiltinKey, componentIsLocked } from '../../../shared/contracts/component-platform/project'
import { editingLevelInstanceId, resolveGroupSelectionIntent, type GroupSelectionIntent } from '../../documents/containerEditingContext'
import { isComponentVisibleAtSurface } from '../../../shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { SpatialSurfaceViewState, SpatialGraphSelection } from '../../store/slices/spatialAuthoringSlice'
import { componentSpatialCameraMatrix, panComponentSpatialCamera, zoomComponentSpatialCamera } from '../../../player/surfaces/spatial/componentSpatialAdapter'
import { spatialComponentCenter, spatialConnectionSegments, spatialConnectionTargets, spatialFramePose, spatialPathPoints, spatialPathTargetIds, spatialRelationLabelPosition, spatialSemanticVisible, type SpatialConnectionSegment, type SpatialGeometryTarget } from '../../../player/surfaces/spatial/componentPlatform/graph'
import { composeMatrices, frameCorners, IDENTITY_MATRIX, invertMatrix, multiplyMatrices, rotationMatrix, scaleMatrix, transformPoint, translationMatrix, type AffineMatrix, type GeometryPoint } from '../../../core/components/geometry'
import { FreeTransformGesture, type FreeResizeHandle, type FreeSnapGuide } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { freeSurfaceTargets, freeTargetAtEditingLevel, marqueeFreeTargets, sameFreeTarget, selectedFreeTargets, type FreeObjectTarget } from '../../componentPlatform/surfaces/slide/targets'
import { spatialWorldTargets } from '../../componentPlatform/surfaces/spatial/targets'
import { useContextMenu } from '../../editing/commands/CommandMenu'
import { hiddenObjectCommands } from '../../editing/commands/hiddenObjectCommands'
import { OBJECT_EDIT_EVENT, requestImageEdit, requestObjectContextMenu } from '../../editing/commands/objectContextMenu'
import { NativeSelectionContext } from '../../workbench/NativeSelectionContext'
import { useWorkspaceMediaSource } from '../../lessonWorkspace/workspaceMediaSourceContext'
import { deliverWorkspaceMediaDrop, type WorkspaceMediaDropHandler } from '../../lessonWorkspace/workspaceMediaDrop'
import { WORKSPACE_MEDIA_DRAG_TYPE } from '../../lessonWorkspace/workspaceMediaDrag'
import { useSlideNativeTextEditor } from './useSlideNativeTextEditor'
import { componentDefinitionPresentation } from '../properties/componentDefinitionPresentation'
import type { SlideContentEdit, SlideContentLayoutReady } from '../../store/slices/slideAuthoringSlice'
import { resolveComponentBackground, resolveComponentSurfaceBackground } from '../../../shared/contracts/component-platform'
import { mergeComponentBackground } from '../../../shared/componentBackgroundPaint'
import { ComponentBackgroundPaint } from '../../components/ComponentBackgroundPaint'
import { createTeacherControllerHudGeometry, teacherControllerReferenceSize, isViewportComponent, projectTeacherControllerInstances, restoreTeacherControllerFrameEdits, type TeacherControllerDisplayPort, type TeacherControllerHudGeometry } from '../../../shared/teacherControllerViewportGeometry'
import { selectionHandleGesture, SlideLayerSelectionOverlay } from './SlideLayerSelectionOverlay'
import { CourseNavigationControls } from './CourseNavigationControls'
import { EDITOR_PAGE_INSETS, fitPage } from '../../../shared/pageFrame'
import { MIXED_GLOBAL_GEOMETRY, mixedGlobalGeometryEdits, type MixedGlobalGeometryRequest } from './mixedGlobalGeometry'

export interface SpatialLocationWorkspaceProps {
  documentId: string
  project: CourseProjectV10
  surface: ComponentSurface
  view: SpatialSurfaceViewState
  activeStateId?: string | null
  activeGroupId?: string | null
  selectionIds: readonly string[]
  canvasMode: 'edit' | 'run'
  renderInstance(instanceId: string, displayProjection?: CourseProjectV10): ReactNode
  teacherController?: TeacherControllerDisplayPort
  resolveBackgroundAsset?(id: string): string | undefined
  backgroundPreviewColor?: string | null
  onViewportChange?(size: { width: number; height: number }): void
  captureTarget(): CapturedCourseTarget
  onEdits(edits: ComponentEdit[], captured?: CapturedCourseTarget): Promise<unknown>
  onSelect(ids: readonly string[]): void
  onSelectCanvas?(ids: readonly string[], groupId: string | null, authorKey?: string): void
  onCamera(camera: SpatialSurfaceViewState['camera']): void
  onActivateFrame(frameId: string | null): void
  onGraphSelect(selection: SpatialGraphSelection): void
  onCanvasModeChange(mode: 'edit' | 'run'): void
  onResetPlayback?(playing: boolean): Promise<void>
  onEditContent?(instanceId: string): void
  onEnterGroup?(instanceId: string): void
  onEnterContainer?(instanceId: string): void
  contentEdit?: SlideContentEdit | null
  contentEditor?: {
    read?(): SlideContentEdit | null
    readProject?(): CourseProjectV10
    begin(id: string): SlideContentEdit | null
    update(data: unknown, composing?: boolean, height?: number, width?: number, rangeProjection?: TextRangeProjection[], historyGroup?: string, layoutReady?: SlideContentLayoutReady): void
    setComposing?(active: boolean): void
    commitInput?(): Promise<void>
    commit(): Promise<void>
    cancel(): void
    preserve?(): Promise<boolean>
    undo(): void
    redo(): void
    report(message: string): void
  }
  onPaste?(): void
  onSelectAll?(): void
  onShowInstances?(instanceIds: readonly string[]): void
  onSelectImageAsset?(): Promise<ImportedImageAsset | null>
  onDropWorkspaceMedia?: WorkspaceMediaDropHandler
  activation?: number
}
const pointer = (event: { clientX: number; clientY: number }): GeometryPoint => ({ x: event.clientX, y: event.clientY })
// Only the current author input owns canvas pointer gestures. Runtime controls are
// ordinary selectable objects while authoring, including input/button/link DOM.
const inputOwnsPointer = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('[data-component-professional-editor],.canvas-plain-text-editor,.selection-quick-bar,.text-edit-toolbar,.shared-document-toolbar'))
const keyboardInput = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'))
type PointerInput = Pick<ReactPointerEvent<Element>, 'pointerId' | 'button' | 'clientX' | 'clientY' | 'shiftKey' | 'altKey' | 'preventDefault' | 'stopPropagation'> & {
  target: EventTarget | null; visibleInstanceId?: string | null; authorKey?: string | null; released?: boolean; ctrlKey?: boolean; metaKey?: boolean
  finalPointer?: { clientX: number; clientY: number; shiftKey?: boolean; altKey?: boolean }
}
type PointerFinish = Pick<PointerInput, 'pointerId'> & Partial<Pick<PointerInput, 'clientX' | 'clientY' | 'shiftKey' | 'altKey'>>
const frozenPointer = (event: PointerInput): PointerInput => ({ pointerId: event.pointerId, button: event.button,
  clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey, target: event.target,
  visibleInstanceId: event.visibleInstanceId, authorKey: event.authorKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, released: event.released, finalPointer: event.finalPointer, preventDefault() {}, stopPropagation() {} })
function distance(point: GeometryPoint, a: GeometryPoint, b: GeometryPoint) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function RelationLabel({ text, segments, targets, matrix, interactive }: { text: string; segments: readonly SpatialConnectionSegment[]; targets: readonly SpatialGeometryTarget[]; matrix: AffineMatrix; interactive: boolean }) {
  const element = useRef<SVGTextElement>(null), [size, setSize] = useState({ width: 0, height: 14 })
  useLayoutEffect(() => { const bounds = element.current?.getBBox(); if (bounds) setSize({ width: bounds.width, height: bounds.height }) }, [text])
  const position = spatialRelationLabelPosition(segments, targets, matrix, size)
  return position && <text ref={element} x={position.x} y={position.y} fontSize={14} textAnchor="middle" dominantBaseline="central" fill="#334155"
    stroke="#fff" strokeWidth={6} paintOrder="stroke" strokeLinejoin="round" style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: interactive ? 'pointer' : undefined }}>{text}</text>
}

/** Mature Spatial shell. Runtime DOM comes from the document's one U11 World. */
export function SpatialLocationWorkspace(props: SpatialLocationWorkspaceProps) {
  const latest = useRef(props); latest.current = props
  const root = useRef<HTMLElement>(null), viewport = useRef<HTMLDivElement>(null)
  const capturePointer = (event: PointerInput) => {
    if (!event.released && !viewport.current!.hasPointerCapture(event.pointerId)) viewport.current!.setPointerCapture(event.pointerId)
  }
  const menu = useContextMenu(), media = useWorkspaceMediaSource()
  const mediaRef = useRef(media); mediaRef.current = media
  const [size, setSize] = useState({ width: 800, height: 450 })
  const [preview, setPreview] = useState<Record<string, ComponentFrame>>({})
  const [guides, setGuides] = useState<FreeSnapGuide[]>([])
  const [marquee, setMarquee] = useState<{ start: GeometryPoint; end: GeometryPoint } | null>(null)
  const [hoverId,setHoverId]=useState<string|null>(null)
  const hoverSeq=useRef(0),hoverBusy=useRef(false)
  const hoverPoint=useRef<{point:GeometryPoint;deep:boolean;additive:boolean}|null>(null)
  const hoverPending=useRef<typeof hoverPoint.current>(null)
  const hoverRunner=useRef<()=>void>(()=>{})
  const baseContext=JSON.stringify([props.documentId,props.surface.id,props.activeStateId,props.view.scope,props.canvasMode])
  const previousBaseContext=useRef(baseContext)
  const spacePan = useRef(false)
  const pressSelection = useRef<{ids: readonly string[]; groupId: string | null} | null>(null)
  const firstClickSelection = useRef<typeof pressSelection.current>(null)
  const [error, setError] = useState<string | null>(null), [dragOver, setDragOver] = useState(false)
  const [, refreshNavigation] = useState(0)
  useEffect(() => props.teacherController?.subscribe(() => refreshNavigation(value => value + 1)), [props.teacherController])
  useEffect(() => props.teacherController?.subscribePlacement?.(() => refreshNavigation(value => value + 1)), [props.teacherController])
  const active = useRef<{ pointerId: number; start: GeometryPoint; moved: boolean; last: GeometryPoint; pan?: { pointer: GeometryPoint; camera: SpatialSurfaceViewState['camera']; scale: number };
    marquee?: GeometryPoint; originalSelection?: readonly string[]; click?: GroupSelectionIntent; authorKey?: string; geometry?: FreeTransformGesture; targets: FreeObjectTarget[]; edits: ComponentEdit[]; captured: CapturedCourseTarget } | null>(null)
  const pendingMove = useRef<PointerInput | null>(null), moveFrame = useRef<number | null>(null)
  const visiblePointer = useRef<{ input: PointerInput; latest: PointerInput; ended: boolean; context: string } | null>(null)
  const hitContext = () => JSON.stringify([latest.current.documentId, latest.current.surface.id, latest.current.activeStateId,
    latest.current.view.scope, latest.current.canvasMode, latest.current.activation, latest.current.activeGroupId])
  const applyMove = useRef<(input: PointerInput) => void>(() => {})
  const cancelPendingMove = () => {
    if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current)
    moveFrame.current = null; pendingMove.current = null
  }
  const flushPendingMove = (final?: PointerInput) => {
    const input = final ?? pendingMove.current
    cancelPendingMove()
    if (input) applyMove.current(input)
  }
  useEffect(() => () => cancelPendingMove(), [])
  const deferred = useRef<{ input: PointerInput; mode: 'drag' | 'resize' | 'rotate'; handle?: FreeResizeHandle;
    latest: PointerInput; ended: boolean; documentId: string; surfaceId: string; stateId: string | null; groupId: string | null; scope: SpatialSurfaceViewState['scope']; epoch: string } | null>(null)
  const resumePointer = useRef<(input: PointerInput, mode: 'drag' | 'resize' | 'rotate', handle?: FreeResizeHandle) => void>(() => {})
  const resumeMove = useRef<(input: PointerInput) => void>(() => {})
  const resumeFinish = useRef<(pointerId: number) => void>(() => {})
  const finishPointer = useRef<(pointerId: number) => void>(() => {})
  const realmPointer = useRef<(detail: ComponentAuthorObjectPointer, clientPoint: GeometryPoint) => void>(() => {})
  const objectDoubleClick = useRef<(instanceId: string, clientPoint: GeometryPoint, target?: EventTarget | null) => void>(() => {})
  const spatial = props.surface.spatial
  const worldTargets = spatialWorldTargets(props.project, props.surface.id)
  const design = props.surface.designSize ?? { width: 1280, height: 720 }
  const [available, setAvailable] = useState({ width: 800, height: 500 })
  useLayoutEffect(() => {
    const element = root.current!
    const resize = () => setAvailable({ width: element.clientWidth || 800, height: element.clientHeight || 500 })
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    return () => observer.disconnect()
  }, [])
  const runFit = fitPage(available, design, EDITOR_PAGE_INSETS, 'contain')
  // Camera poses are authored in design units in both modes. Editing exposes the surrounding world instead
  // of clipping it to the camera frame, but it must keep the same base fit as Slides and playback.
  const renderScale = runFit.scale
  const renderScaleRef = useRef(renderScale); renderScaleRef.current = renderScale
  const overlayScale = renderScale
  const cameraViewport = props.canvasMode === 'edit'
    ? { x: runFit.left, y: runFit.top, width: design.width * renderScale, height: design.height * renderScale }
    : { x: 0, y: 0, ...size }
  const cameraViewportRef = useRef(cameraViewport); cameraViewportRef.current = cameraViewport
  const hudMatrix = composeMatrices(translationMatrix(cameraViewport.x + (cameraViewport.width - design.width * overlayScale) / 2,
    cameraViewport.y + (cameraViewport.height - design.height * overlayScale) / 2), scaleMatrix(overlayScale))
  const worldMatrix = componentSpatialCameraMatrix({ ...props.view.camera, zoom: props.view.camera.zoom * renderScale }, cameraViewport)
  const controllerGeometry = createTeacherControllerHudGeometry({ referenceSize: teacherControllerReferenceSize(props.project), viewportRect: { x: 0, y: 0, ...size } })
  const displayProject = projectTeacherControllerInstances(props.project, controllerGeometry, props.teacherController)
  // Controller gestures use viewport frames; their DOM remains inside the shared HUD plane.
  const controllerToHud = invertMatrix(hudMatrix)
  const renderedFrame = (id: string, frame: ComponentFrame): ComponentFrame => isViewportComponent(props.project, id)
    ? { ...frame, transform: [...multiplyMatrices(controllerToHud, frame.transform)] as ComponentFrame['transform'] } : frame
  const hudDisplayProject = { ...displayProject, instances: Object.fromEntries(Object.entries(displayProject.instances).map(([id, instance]) =>
    [id, isViewportComponent(props.project, id) && instance.frame ? { ...instance, frame: renderedFrame(id, instance.frame) } : instance])) }
  useEffect(() => {
    const request = (event: Event) => {
      const input = (event as CustomEvent<MixedGlobalGeometryRequest>).detail
      if (!input || input.edits || input.documentId !== props.documentId || input.surfaceId !== props.surface.id || !root.current?.isConnected) return
      input.edits = mixedGlobalGeometryEdits(input.project, input.instanceIds, input.intent, hudMatrix, controllerGeometry, props.teacherController)
    }
    window.addEventListener(MIXED_GLOBAL_GEOMETRY, request); return () => window.removeEventListener(MIXED_GLOBAL_GEOMETRY, request)
  }, [props.documentId, props.surface.id, props.teacherController, size, renderScale, cameraViewport.x, cameraViewport.y])
  const latestDisplay = useRef(hudDisplayProject); latestDisplay.current = hudDisplayProject
  const globalIds = new Set([...props.project.global.underlay, ...props.project.global.overlay])
  const globalEditing = props.canvasMode === 'edit' && props.view.scope === 'global'
  const showGlobals = props.project.rootIds.includes(props.surface.id) || props.view.scope === 'global'
  const allTargets = freeSurfaceTargets(displayProject, props.surface.id)
    .filter(target => showGlobals || !globalIds.has(target.ancestors[0] ?? target.instanceId))
  const isGlobalTarget = (target: FreeObjectTarget) => globalIds.has(target.ancestors[0] ?? target.instanceId)
  const scopeTargets = props.view.scope === 'global' ? allTargets.filter(isGlobalTarget) : allTargets
  const visibleTargets = scopeTargets.filter(target => isComponentVisibleAtSurface(props.project.instances[target.instanceId], props.surface.id)
    && target.ancestors.every(id => isComponentVisibleAtSurface(props.project.instances[id], props.surface.id))
    && (isGlobalTarget(target)
      || [...target.ancestors, target.instanceId].every(id => spatialSemanticVisible(spatial, id, props.view.camera.zoom))))
  const visibleWorldTargets = worldTargets.filter(target => [...target.ancestors, target.instanceId].every(id =>
    isComponentVisibleAtSurface(props.project.instances[id], props.surface.id) && spatialSemanticVisible(spatial, id, props.view.camera.zoom)))
  const locked = (target: FreeObjectTarget) => props.project.instances[target.instanceId]?.locked || target.ancestors.some(id => props.project.instances[id]?.locked)
  const gestureDisplay = useRef<{ original: CourseProjectV10; display: CourseProjectV10; viewport: TeacherControllerHudGeometry; offset: { x: number; y: number } } | null>(null)
  const background = resolveComponentSurfaceBackground(props.project, props.surface)
  const matrix = props.view.scope === 'global' ? hudMatrix : worldMatrix
  const clientMatrix = () => { const box = viewport.current!.getBoundingClientRect(); return composeMatrices(translationMatrix(box.left, box.top), matrix) }
  const controllerPointerMatrix = (): AffineMatrix => { const box = viewport.current?.getBoundingClientRect(); return [1, 0, 0, 1, box?.left ?? 0, box?.top ?? 0] }
  const viewportPoint = (event: { clientX: number; clientY: number }) => transformPoint(invertMatrix(controllerPointerMatrix()), pointer(event))
  const targetViewportMatrix = (target: FreeObjectTarget): AffineMatrix => isViewportComponent(props.project, target.ancestors[0] ?? target.instanceId)
    ? IDENTITY_MATRIX : isGlobalTarget(target) ? hudMatrix : worldMatrix
  const viewportTarget = (target: FreeObjectTarget): FreeObjectTarget => ({ ...target, parentToSurface: multiplyMatrices(targetViewportMatrix(target), target.parentToSurface) })
  const viewportTargets = visibleTargets.map(viewportTarget)
  const at = (event: { clientX: number; clientY: number }) => transformPoint(invertMatrix(clientMatrix()), pointer(event))
  const editor = useSlideNativeTextEditor({ project: props.project, surfaceId: props.surface.id,
    edit: props.contentEdit?.source === 'canvas' && !props.contentEdit.authorSpot && (!globalEditing || scopeTargets.some(target => target.instanceId === props.contentEdit!.instanceId)) ? props.contentEdit : null,
    readProject: props.contentEditor?.readProject,
    fieldIsCurrent: identity => authorInteraction.fieldIsCurrent(identity),
    begin: id => props.contentEditor?.begin(id) ?? null, update: (data, composing, height, width, rangeProjection, historyGroup, layoutReady) => props.contentEditor?.update(data, composing, height, width, rangeProjection, historyGroup, layoutReady),
    commitInput: props.contentEditor?.commitInput,
    setComposing: props.contentEditor?.setComposing ? active => props.contentEditor!.setComposing!(active) : undefined,
    commit: () => props.contentEditor?.commit() ?? Promise.resolve(), cancel: () => props.contentEditor?.cancel(),
    preserve: props.contentEditor?.preserve,
    undo: () => props.contentEditor?.undo(), redo: () => props.contentEditor?.redo(), host: () => viewport.current,
    report: message => props.contentEditor?.report(message),
    onSelectField: (spot, activate, read) => authorInteraction.selectNativeField(spot, activate, read),
  }, props.documentId + ':' + props.surface.id + ':' + (props.activeStateId ?? ''))
  const authorInteraction = useComponentAuthorInteraction({ root, documentId: props.documentId, surfaceId: props.surface.id,
    enabled: props.canvasMode === 'edit', contextKey: `${props.view.scope}:${props.activeGroupId ?? ''}`, selectImage: props.onSelectImageAsset, report: setError, wholeInstanceEditor: false, workspaceOwnsObjectSelection: true,
    onObjectPointer: (detail, clientPoint) => realmPointer.current(detail, clientPoint),
    resolveObjectTarget: id => resolveGroupSelectionIntent(latest.current.project, latest.current.surface.id, id, latest.current.selectionIds, latest.current.activeGroupId)?.pressId ?? null,
    onObjectDoubleClick: (id, clientPoint) => objectDoubleClick.current(id, clientPoint) })
  const resolveVisibleAt = (point: GeometryPoint) => visibleComponentAuthorHit(viewport.current, point, id =>
    [...(viewport.current?.querySelectorAll<HTMLElement>('[data-component-render]') ?? [])].find(element => element.dataset.componentRender === id))
  const selectionIntent = (input: { visibleInstanceId?: string | null; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => input.visibleInstanceId
    ? resolveGroupSelectionIntent(latest.current.project, latest.current.surface.id, input.visibleInstanceId, latest.current.selectionIds,
      latest.current.activeGroupId, Boolean(input.altKey || input.ctrlKey || input.metaKey), Boolean(input.shiftKey)) : null
  const selectCanvas = (ids: readonly string[], groupId: string | null, authorKey?: string) => {
    if (props.onSelectCanvas) props.onSelectCanvas(ids, groupId, authorKey); else props.onSelect(ids)
  }
  const visibleTarget = (input: Parameters<typeof selectionIntent>[0]) => {
    const intent=selectionIntent(input); return intent ? viewportTargets.find(target=>target.instanceId===intent.pressId) ?? null : null
  }
  const visibleInstance = (input: Parameters<typeof selectionIntent>[0]) => selectionIntent(input)?.pressId ?? null
  const clearHover=()=>{++hoverSeq.current;hoverPending.current=null;hoverPoint.current=null;setHoverId(null)}
  const queueHover=(point:GeometryPoint,deep=false,additive=false)=>{
    if(active.current || deferred.current || props.canvasMode!=='edit' || props.contentEdit)return
    ++hoverSeq.current;hoverPoint.current={point,deep,additive};hoverPending.current=hoverPoint.current;hoverRunner.current()
  }
  hoverRunner.current=()=>{
    if(hoverBusy.current || !hoverPending.current)return
    const pending=hoverPending.current,ticket=hoverSeq.current;hoverPending.current=null;hoverBusy.current=true
    void resolveVisibleAt(pending.point).then(hit=>{
      if(ticket!==hoverSeq.current)return
      const current=latest.current
      const next=hit&&resolveGroupSelectionIntent(current.project,current.surface.id,hit.instanceId,current.selectionIds,current.activeGroupId,pending.deep,pending.additive)
      setHoverId(next?.clickId ?? null)
    }).catch(()=>{}).finally(()=>{hoverBusy.current=false;if(hoverPending.current)hoverRunner.current()})
  }
  const beginNativeEdit = (event: PointerInput): boolean => {
    if (props.canvasMode !== 'edit' || !props.contentEditor || spacePan.current || event.button !== 0
      || inputOwnsPointer(event.target) || event.target instanceof Element && event.target.closest('[data-handle],[data-controller-selection]')) return false
    const hit = viewportTargets.find(target => target.instanceId === event.visibleInstanceId)
    if (!hit || locked(hit)) return false
    const instance = props.project.instances[hit.instanceId], implementation = instance && (instance.implementationOverride ?? props.project.definitions[instance.definitionId]?.implementation)
    if (implementation?.kind !== 'builtin' || !['guoling.text', 'guoling.formula', 'guoling.table', 'guoling.chart'].includes(implementation.key)) return false
    const original = visibleTargets.find(target => target.instanceId === hit.instanceId)
    if (!original) return false
    const localPoint = transformPoint(invertMatrix(targetViewportMatrix(original)), viewportPoint(event))
    const captured = editor.capture(hit.instanceId, localPoint, pointer(event))
    if (!captured) return false
    event.preventDefault(); event.stopPropagation()
    void authorInteraction.beginNative(hit.instanceId, captured)
    return true
  }
  objectDoubleClick.current = (instanceId, clientPoint, target = viewport.current) => {
    const context = hitContext(), id = visibleInstance({ visibleInstanceId: instanceId })
    if (!id) return
    const input = frozenPointer({ pointerId: 0, button: 0, clientX: clientPoint.x, clientY: clientPoint.y,
      shiftKey: false, altKey: false, target, visibleInstanceId: instanceId, released: true, preventDefault() {}, stopPropagation() {} })
    if (!componentIsLocked(props.project, id) && componentDefinitionBuiltinKey(props.project.definitions[props.project.instances[id]?.definitionId]) === 'guoling.image') {
      props.onSelect([id])
      const captured = props.captureTarget()
      requestImageEdit({ documentId: captured.documentId, epoch: captured.epoch, itemId: id })
      return
    }
    if (!componentIsLocked(props.project, id) && id === instanceId && beginNativeEdit(input)) return
    void (async () => {
      const contentEdit = props.contentEditor?.read ? props.contentEditor.read() : props.contentEdit
      if (contentEdit?.composing) return
      if (contentEdit) await props.contentEditor?.commit()
      if (context !== hitContext() || !latest.current.project.instances[id]) return
      latest.current.onSelect([id])
      if (componentIsLocked(latest.current.project, id)) return
      const instance = latest.current.project.instances[id]
      if (instance.container) latest.current.onEnterContainer?.(id)
      else if (componentDefinitionBuiltinKey(latest.current.project.definitions[instance.definitionId]) === 'guoling.group') latest.current.onEnterGroup?.(id)
      else latest.current.onEditContent?.(id)
    })().catch(failure => setError(failure instanceof Error ? failure.message : String(failure)))
  }
  const resetPreview = () => {
    for (const node of viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? []) {
      const frame = latestDisplay.current.instances[node.dataset.componentInstance ?? '']?.frame
      if (frame) { node.style.transform = `matrix(${frame.transform.join(',')})`; node.style.width = `${frame.width}px`; node.style.height = `${frame.height}px` }
    }
    setPreview({})
    setGuides([])
  }
  useLayoutEffect(() => {
    const element = viewport.current!
    const resize = () => { const rect = element.getBoundingClientRect(), value = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }; setSize(value); latest.current.onViewportChange?.(value) }
    const observer = new ResizeObserver(resize); observer.observe(element); resize()
    return () => observer.disconnect()
  }, [props.documentId, props.surface.id])
  useEffect(() => {
    const sameBase=previousBaseContext.current===baseContext;previousBaseContext.current=baseContext
    clearHover()
    if(sameBase && active.current && (active.current.captured.activeGroupId ?? null)===(props.activeGroupId ?? null))return
    cancelPendingMove();active.current=null;deferred.current=null;visiblePointer.current=null;resetPreview();setMarquee(null);setError(null)
  }, [props.documentId, props.surface.id, props.activeStateId, props.activeGroupId, props.view.scope, props.canvasMode])
  useEffect(()=>{
    const modifiers=(event:KeyboardEvent)=>{if(['Control','Meta','Alt','Shift'].includes(event.key)&&hoverPoint.current){++hoverSeq.current;hoverPending.current={...hoverPoint.current,deep:event.ctrlKey||event.metaKey||event.altKey,additive:event.shiftKey};hoverRunner.current()}}
    window.addEventListener('keydown',modifiers);window.addEventListener('keyup',modifiers)
    return()=>{++hoverSeq.current;hoverPending.current=null;window.removeEventListener('keydown',modifiers);window.removeEventListener('keyup',modifiers)}
  }, [])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !inputOwnsPointer(event.target) && !keyboardInput(event.target)) { spacePan.current = true; event.preventDefault() }
      if (event.key === 'Escape' && (visiblePointer.current || deferred.current || active.current)) {
        event.preventDefault(); event.stopPropagation()
        const pointerId = visiblePointer.current?.input.pointerId ?? deferred.current?.input.pointerId ?? active.current?.pointerId
        visiblePointer.current = null
        if (pointerId !== undefined) finishPointer.current(pointerId)
      }
    }
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') spacePan.current = false }
    const blur = () => { spacePan.current = false }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  useEffect(() => {
    if (active.current?.geometry) {
      const values = scopeTargets
      if (!active.current.targets.every(target => { const value = values.find(value => value.instanceId === target.instanceId); return value && sameFreeTarget(target, value) })) { cancelPendingMove(); active.current = null; resetPreview() }
    }
  }, [props.project])
  useLayoutEffect(() => {
    for (const node of viewport.current?.querySelectorAll<HTMLElement>('[data-spatial-world] [data-component-instance]') ?? []) {
      const id = node.dataset.componentInstance ?? '', instance = props.project.instances[id]
      node.style.visibility = spatialSemanticVisible(spatial, id, props.view.camera.zoom) ? String(instance?.style?.visibility ?? '') : 'hidden'
    }
  }, [props.project, props.view.camera.zoom, props.renderInstance])
  useEffect(() => {
    const element = viewport.current!
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || inputOwnsPointer(event.target)) return
      event.preventDefault()
      const box = element.getBoundingClientRect(), camera = latest.current.view.camera
      const fit = renderScaleRef.current
      const currentViewport = cameraViewportRef.current
      const next = zoomComponentSpatialCamera({ ...camera, zoom: camera.zoom * fit }, Math.max(0.01, camera.zoom + (event.deltaY > 0 ? -0.1 : 0.1)) * fit, pointer(event),
        { ...currentViewport, x: box.left + currentViewport.x, y: box.top + currentViewport.y })
      latest.current.onCamera({ ...next, zoom: next.zoom / fit })
    }
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel)
  }, [])
  useEffect(() => {
    const element = root.current!
    const edit = (event: Event) => { const id = (event as CustomEvent<{ itemId: string }>).detail?.itemId; if (id && latest.current.canvasMode === 'edit') { const instance = latest.current.project.instances[id]; const kind = instance && componentDefinitionPresentation(latest.current.project.definitions[instance.definitionId]).builtinKey; if (kind === 'guoling.text' || kind === 'guoling.formula') latest.current.contentEditor?.begin(id); latest.current.onEditContent?.(id); event.preventDefault() } }
    element.addEventListener(OBJECT_EDIT_EVENT, edit); return () => element.removeEventListener(OBJECT_EDIT_EVENT, edit)
  }, [])
  const hidden = scopeTargets.filter(target => props.project.instances[target.instanceId]?.visible === false
    && isComponentVisibleAtSurface({ ...props.project.instances[target.instanceId], visible: true }, props.surface.id)
    && target.ancestors.every(id => isComponentVisibleAtSurface(props.project.instances[id], props.surface.id)))
  const hiddenMenu = () => hiddenObjectCommands(hidden.map(target => ({ id: target.instanceId, name: props.project.instances[target.instanceId]?.name ?? target.instanceId })), ids => props.onShowInstances?.(ids))
  const graphAt = (point: GeometryPoint): SpatialGraphSelection => {
    if (props.view.scope === 'global') return null
    const threshold = 6 / (props.view.camera.zoom * renderScale)
    for (const relation of [...(spatial?.relations ?? [])].reverse()) {
      const a = spatialComponentCenter(visibleWorldTargets, relation.sourceInstanceId), b = spatialComponentCenter(visibleWorldTargets, relation.targetInstanceId)
      const obstacles = spatialConnectionTargets(visibleWorldTargets, [relation.sourceInstanceId, relation.targetInstanceId])
      if (a && b && spatialConnectionSegments([a, b], obstacles).some(segment => distance(point, segment.start, segment.end) <= threshold)) return { kind: 'relation', id: relation.id }
    }
    for (const path of [...(spatial?.paths ?? [])].reverse()) {
      const points = spatialPathPoints(spatial, path, visibleWorldTargets)
      if (spatialConnectionSegments(points, spatialConnectionTargets(visibleWorldTargets, spatialPathTargetIds(spatial, path))).some(segment => distance(point, segment.start, segment.end) <= threshold)) return { kind: 'path', id: path.id }
    }
    return null
  }
  const begin = (event: PointerInput, mode: 'drag' | 'resize' | 'rotate' = 'drag', handle?: FreeResizeHandle) => {
    if (active.current || deferred.current || (event.button !== 0 && event.button !== 1) || inputOwnsPointer(event.target)) return
    const contentEdit = props.contentEditor?.read ? props.contentEditor.read() : props.contentEdit
    if (contentEdit) {
      if (contentEdit.composing || !props.contentEditor) return
      event.preventDefault(); event.stopPropagation(); capturePointer(event)
      const input: PointerInput = { pointerId: event.pointerId, button: event.button, clientX: event.clientX, clientY: event.clientY,
        shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey:event.ctrlKey,metaKey:event.metaKey,authorKey:event.authorKey,target: event.target, visibleInstanceId: event.visibleInstanceId, released: event.released, preventDefault() {}, stopPropagation() {} }
      const pending = { input, mode, handle, latest: input, ended: false, documentId: props.documentId, surfaceId: props.surface.id,
        stateId: props.activeStateId ?? null, groupId: props.activeGroupId ?? null, scope: props.view.scope, epoch: contentEdit.target.epoch }
      deferred.current = pending
      const rejected = (failure: unknown) => {
        if (deferred.current !== pending) return
        deferred.current = null
        if (viewport.current?.hasPointerCapture(pending.input.pointerId)) viewport.current.releasePointerCapture(pending.input.pointerId)
        setError(failure instanceof Error ? failure.message : String(failure))
      }
      void props.contentEditor.commit().then(() => {
        if (deferred.current !== pending) return
        const current = latest.current
        if (current.documentId !== pending.documentId || current.surface.id !== pending.surfaceId || (current.activeStateId ?? null) !== pending.stateId
          || (current.activeGroupId ?? null) !== pending.groupId || current.view.scope !== pending.scope || current.canvasMode !== 'edit' || current.captureTarget().epoch !== pending.epoch) { deferred.current = null; return }
        deferred.current = null
        pending.input.released = pending.ended || pending.input.released
        resumePointer.current(pending.input, pending.mode, pending.handle)
        resumeMove.current(pending.latest)
        if (pending.ended) resumeFinish.current(pending.input.pointerId)
      }, rejected).catch(failure => {
        if (latest.current.documentId === pending.documentId && latest.current.surface.id === pending.surfaceId) setError(failure instanceof Error ? failure.message : String(failure))
      })
      return
    }
    if (props.canvasMode === 'run' && event.button !== 1 && !spacePan.current && event.target instanceof Element && event.target.closest('[data-component-instance]')) return
    const graphElement = event.target instanceof Element && event.target.closest('[data-spatial-relation-id],[data-spatial-path-id]')
    if (props.canvasMode === 'edit' && props.view.scope === 'world' && event.button === 0 && !spacePan.current && graphElement) {
      const relationId = graphElement.getAttribute('data-spatial-relation-id'), pathId = graphElement.getAttribute('data-spatial-path-id')
      props.onGraphSelect(relationId ? { kind: 'relation', id: relationId } : { kind: 'path', id: pathId! })
      event.preventDefault(); event.stopPropagation(); return
    }
    const selectionHandle = event.target instanceof Element && event.target.closest('[data-controller-selection],[data-spatial-object-selection]')
    const click = !selectionHandle && mode === 'drag' && !event.shiftKey ? selectionIntent(event) ?? undefined : undefined
    const hit = props.canvasMode === 'run' || event.button === 1 || spacePan.current ? null
      : selectionHandle ? visibleTargets.find(target => props.selectionIds.includes(target.instanceId)) ?? null
        : mode === 'drag' ? visibleTarget(event)
          : visibleTargets.find(target => props.selectionIds.includes(target.instanceId)) ?? null
    const selectedId = props.canvasMode === 'edit' && mode === 'drag' && event.button === 0 && !spacePan.current && !selectionHandle ? visibleInstance(event) : null
    if (selectedId && !hit) {
      props.onGraphSelect(null)
      props.onSelect(event.shiftKey ? props.selectionIds.includes(selectedId) ? props.selectionIds.filter(id => id !== selectedId) : [...props.selectionIds, selectedId] : [selectedId])
      event.preventDefault(); event.stopPropagation(); return
    }
    const pan = event.button === 1 || spacePan.current || (!hit && !event.shiftKey)
    if (!hit && !pan && props.canvasMode === 'edit') {
      event.preventDefault(); event.stopPropagation(); capturePointer(event)
      const start = viewportPoint(event)
      active.current = { pointerId: event.pointerId, start: pointer(event), moved: false, last: pointer(event), marquee: start, originalSelection: props.selectionIds, targets: [], edits: [], captured: props.captureTarget() }
      setMarquee({ start, end: start }); return
    }
    if (!hit && props.canvasMode === 'edit') { const graph = graphAt(at(event)); if (graph) { props.onGraphSelect(graph); event.stopPropagation(); return } }
    if (hit) {
      props.onGraphSelect(null)
      if(mode==='drag') {
        const ids=event.shiftKey ? props.selectionIds.includes(hit.instanceId)?props.selectionIds.filter(id=>id!==hit.instanceId):[...props.selectionIds,hit.instanceId] : props.selectionIds.includes(hit.instanceId)?props.selectionIds:[hit.instanceId]
        const next=selectionIntent(event)
        if(next?.pressId===next?.clickId)selectCanvas(ids,next?.groupId ?? null)
        else props.onSelect(ids)
      }
    }
    else if (!event.shiftKey && props.canvasMode === 'edit' && event.button !== 1 && !spacePan.current) { props.onGraphSelect(null); selectCanvas([],null) }
    const ids = mode !== 'drag' ? props.selectionIds : hit && event.shiftKey ? props.selectionIds.includes(hit.instanceId) ? props.selectionIds.filter(id => id !== hit.instanceId) : [...props.selectionIds, hit.instanceId] : hit && props.selectionIds.includes(hit.instanceId) ? props.selectionIds : hit ? [hit.instanceId] : []
    const targets = selectedFreeTargets(visibleTargets, ids).filter(target => !locked(target))
    if (hit && !targets.length || !hit && !pan) { event.stopPropagation(); return }
    event.preventDefault(); event.stopPropagation(); capturePointer(event)
    gestureDisplay.current = { original: props.project, display: displayProject, viewport: controllerGeometry,
      offset: props.teacherController?.placement?.() ?? { x: 0, y: 0 } }
    active.current = { pointerId: event.pointerId, start: pointer(event), moved: false, last: pointer(event), targets, captured: props.captureTarget(), edits: [], click, authorKey:event.authorKey ?? undefined,
      ...(pan ? { pan: { pointer: pointer(event), camera: { ...props.view.camera }, scale: renderScale } } : {}),
      geometry: pan ? undefined : new FreeTransformGesture({ mode, handle, targets: targets.map(viewportTarget), pointer: pointer(event), surfaceToPointer: controllerPointerMatrix(), snapTargets: viewportTargets.filter(target => !ids.includes(target.instanceId) && !target.ancestors.some(id => ids.includes(id))) }) }
  }
  resumePointer.current = begin
  const updateMove = (event: PointerInput) => {
    const gesture = active.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const next = pointer(event)
    if (!gesture.moved && Math.hypot(next.x - gesture.start.x, next.y - gesture.start.y) < 3) { gesture.last = next; return }
    gesture.moved = true
    if (gesture.marquee) { const end = viewportPoint(event); setMarquee({ start: gesture.marquee, end }); props.onSelect([...new Set([...(gesture.originalSelection ?? []), ...marqueeFreeTargets(viewportTargets, gesture.marquee, end, props.activeGroupId)])]) }
    else if (gesture.pan) props.onCamera(panComponentSpatialCamera(gesture.pan.camera,
      { x: (next.x - gesture.pan.pointer.x) / gesture.pan.scale, y: (next.y - gesture.pan.pointer.y) / gesture.pan.scale }))
    else if (gesture.geometry) {
      const update = gesture.geometry.update(next, { shift: event.shiftKey, alt: event.altKey })
      gesture.edits = update.edits; setGuides(update.guides)
      const frames = Object.fromEntries(gesture.edits.flatMap(edit => edit.type === 'frame.set' && edit.frame ? [[edit.instanceId, edit.frame]] : []))
      setPreview(frames)
      for (const node of viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? []) {
        const id = node.dataset.componentInstance ?? '', sourceFrame = frames[id]
        const frame = sourceFrame && renderedFrame(id, sourceFrame)
        if (frame) { node.style.transform = `matrix(${frame.transform.join(',')})`; node.style.width = `${frame.width}px`; node.style.height = `${frame.height}px` }
      }
    }
    gesture.last = next
  }
  applyMove.current = updateMove
  const move = (event: PointerInput) => {
    if (deferred.current?.input.pointerId === event.pointerId) { deferred.current.latest = frozenPointer(event); return }
    if (active.current?.pointerId !== event.pointerId) return
    pendingMove.current = frozenPointer(event)
    if (moveFrame.current === null) moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null
      const input = pendingMove.current; pendingMove.current = null
      if (input) applyMove.current(input)
    })
  }
  resumeMove.current = move
  const finish = (event: PointerFinish, cancel = false) => {
    if (deferred.current?.input.pointerId === event.pointerId) {
      if (!cancel && typeof event.clientX === 'number' && typeof event.clientY === 'number') deferred.current.latest = {
        ...deferred.current.latest, clientX: event.clientX, clientY: event.clientY,
        shiftKey: event.shiftKey ?? deferred.current.latest.shiftKey, altKey: event.altKey ?? deferred.current.latest.altKey }
      if (cancel && !deferred.current.ended) deferred.current = null
      else deferred.current.ended = true
      if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
      return
    }
    let gesture = active.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (cancel) cancelPendingMove()
    else {
      const final = typeof event.clientX === 'number' && typeof event.clientY === 'number'
        && (pendingMove.current || gesture.edits.length || event.clientX !== gesture.last.x || event.clientY !== gesture.last.y)
        ? { pointerId: event.pointerId, button: 0, clientX: event.clientX, clientY: event.clientY,
          shiftKey: event.shiftKey ?? pendingMove.current?.shiftKey ?? false, altKey: event.altKey ?? pendingMove.current?.altKey ?? false,
          target: viewport.current, preventDefault() {}, stopPropagation() {} } : undefined
      flushPendingMove(final)
      gesture = active.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
    }
    active.current = null
    setMarquee(null)
    if (cancel && gesture.marquee) props.onSelect(gesture.originalSelection ?? [])
    if (cancel && gesture.pan) props.onCamera(gesture.pan.camera)
    if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
    const frozen = gestureDisplay.current
    const edits = (frozen ? restoreTeacherControllerFrameEdits(gesture.edits, frozen.original, frozen.display, frozen.viewport, frozen.offset, props.teacherController) : gesture.edits)
      .filter(edit => edit.type !== 'frame.set' || !edit.frame || (() => {
        const original = frozen?.original.instances[edit.instanceId]?.frame ?? gesture.targets.find(target => target.instanceId === edit.instanceId)?.frame
        return !original || original.width !== edit.frame.width || original.height !== edit.frame.height
          || original.transform.some((value, index) => Math.abs(value - edit.frame!.transform[index]) > .000001)
      })())
    if (!cancel && !gesture.moved && gesture.click) selectCanvas([gesture.click.clickId],gesture.click.groupId,gesture.authorKey)
    if (!cancel && edits.length) void props.onEdits(edits, gesture.captured).catch(error => setError(String(error))).finally(resetPreview)
    else resetPreview()
  }
  resumeFinish.current = pointerId => finish({ pointerId })
  finishPointer.current = pointerId => {
    // Escape cancels a deferred gesture even if the button was already released.
    if (deferred.current?.input.pointerId === pointerId) deferred.current = null
    finish({ pointerId }, true)
    if (viewport.current?.hasPointerCapture(pointerId)) viewport.current.releasePointerCapture(pointerId)
  }
  realmPointer.current = (detail, clientPoint) => {
    if (props.canvasMode !== 'edit' || typeof detail.pointerId !== 'number') return
    const input: PointerInput = { pointerId: detail.pointerId, button: detail.button ?? 0, clientX: clientPoint.x, clientY: clientPoint.y,
      shiftKey: Boolean(detail.shiftKey), altKey: Boolean(detail.altKey), ctrlKey:detail.ctrlKey,metaKey:detail.metaKey,authorKey:detail.authorKey,target: viewport.current, visibleInstanceId: detail.instanceId, released: detail.released,
      preventDefault() {}, stopPropagation() {} }
    if (detail.phase === 'start') { firstClickSelection.current = {ids:[...props.selectionIds],groupId:props.activeGroupId ?? null}; begin(input) }
    else if (detail.phase === 'update') move(input)
    else if (detail.phase === 'end') finish(input)
    else if (detail.phase === 'cancel') finishPointer.current(input.pointerId)
  }
  const selectedTargets = selectedFreeTargets(scopeTargets.map(target => preview[target.instanceId] ? { ...target, frame: preview[target.instanceId]! } : target), props.selectionIds)
  const selected = selectedTargets.filter(target => !isViewportComponent(props.project, target.instanceId)).map(viewportTarget)
  const selectedControllers = selectedTargets.filter(target => isViewportComponent(props.project, target.instanceId))
  const objectSelectionPhase = !props.contentEdit
  const selectedTransformable = objectSelectionPhase && selected.length > 0 && selected.every(target => !componentIsLocked(props.project, target.instanceId))
  const controllerTransformable = objectSelectionPhase && selectedControllers.length > 0 && selectedControllers.every(target => !componentIsLocked(props.project, target.instanceId))
  const authorTransformable = objectSelectionPhase && Boolean(authorInteraction.authorTarget)
    && !componentIsLocked(props.project, authorInteraction.selectedSpot?.instanceId ?? authorInteraction.authorTarget?.instanceId ?? '')
  const authorBounds = authorInteraction.selectedSpot && !authorInteraction.authorTarget ? authorInteraction.authorBounds() : null
  const instanceBounds = (id: string) => [...(viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? [])]
    .find(element => element.dataset.componentInstance === id)?.getBoundingClientRect() ?? null
  const framelessBounds = authorInteraction.selectedSpot ? [] : props.selectionIds.filter(id => !scopeTargets.some(target => target.instanceId === id))
    .flatMap(id => { const bounds = instanceBounds(id); return bounds && bounds.width > 0 && bounds.height > 0 ? [{ id, bounds }] : [] })
  const editTarget = props.contentEdit && scopeTargets.find(target => target.instanceId === props.contentEdit!.instanceId)
  const editorMatrix = editTarget && isGlobalTarget(editTarget) ? hudMatrix : matrix
  const currentFrame = spatial?.frames.find(frame => frame.id === props.view.activeCameraFrameId)
  const cameraFrameCorners = (pose: SpatialSurfaceViewState['camera']) => {
    const cameraBox = composeMatrices(translationMatrix(pose.x, pose.y), rotationMatrix((pose.rotation ?? 0) * Math.PI / 180),
      scaleMatrix(1 / pose.zoom), translationMatrix(-design.width / 2, -design.height / 2))
    return frameCorners({ width: design.width, height: design.height, transform: cameraBox }).map(point => transformPoint(worldMatrix, point))
  }
  const zoom = (delta: number) => props.onCamera({ ...props.view.camera, zoom: Math.max(0.01, props.view.camera.zoom + delta) })
  return <main ref={root} className={`workspace workspace--${props.canvasMode} workspace--spatial`} data-testid="spatial-workspace">
    <NativeSelectionContext documentId={props.documentId} revision={props.project.revision} locationId={props.surface.id} itemIds={props.selectionIds} stateId={props.activeStateId} enabled={props.canvasMode === 'edit'} textEditing={Boolean(props.contentEdit)} authorSpot={authorInteraction.selectedSpot} authorBounds={authorInteraction.authorBounds}
      bounds={instanceBounds} />
    {menu.element}
    {authorInteraction.editor}
    <CourseNavigationControls canvasMode={props.canvasMode} onCanvasModeChange={props.onCanvasModeChange}
      runTitle="从起始镜头试运行"
      navigation={props.teacherController} beforeNavigate={props.contentEditor?.commit} resetPlayback={props.onResetPlayback} report={setError} />
    {props.canvasMode === 'edit' && <div className="canvas-view-controls" role="group" aria-label="画布视图">
      <button type="button" aria-label="缩小画布" onClick={() => zoom(-0.1)}><Minus size={14} /></button><output aria-label="画布缩放比例">{Math.round(props.view.camera.zoom * 100)}%</output>
      <button type="button" aria-label="放大画布" onClick={() => zoom(0.1)}><Plus size={14} /></button>
      <button type="button" aria-label="恢复自由视图" title="恢复自由视图" onClick={() => props.onActivateFrame(null)}><Maximize2 size={14} /></button><span title="Ctrl+滚轮缩放；拖动空白处平移画布"><Hand size={13} /></span>
    </div>}
    <div className={`canvas-label${props.view.scope === 'global' ? ' canvas-label--global' : ''}`}>{props.view.scope === 'global' ? `全局层 · ${globalIds.size} 个元素` : `${props.surface.title} · ${currentFrame?.title ?? '自由视图'}`}
      {hidden.length > 0 && <button type="button" className="canvas-label__hidden" onClick={event => { const box = event.currentTarget.getBoundingClientRect(); menu.open({ x: box.left, y: box.bottom + 4 }, '隐藏的对象', hiddenMenu()) }}>隐藏 {hidden.length}</button>}
    </div>
    {error && <div role="alert" className="canvas-label">{error}</div>}
    <div ref={viewport} className="canvas-viewport" data-testid="spatial-world-stage" data-workspace-media-drop={dragOver || undefined}
      data-author-selection-ids={JSON.stringify(props.selectionIds)} data-author-group={props.activeGroupId ?? ''}
      data-observation-source={props.canvasMode === 'edit' ? 'authoring' : undefined} data-observation-project-id={props.project.id} data-observation-revision={props.project.revision}
      data-observation-surface-id={props.surface.id} data-observation-location-id={currentFrame?.id ?? props.surface.id} data-observation-state-id={props.activeStateId ?? ''} data-observation-ready="true"
      data-observation-spatial-camera={JSON.stringify(props.view.camera)} style={{ ...(props.canvasMode === 'run'
        ? { inset: 'auto', left: runFit.left, top: runFit.top, width: design.width * runFit.scale, height: design.height * runFit.scale }
        : { inset: 0 }), overflow: 'hidden', touchAction: 'none', isolation: 'isolate', boxShadow: dragOver ? 'inset 0 0 0 3px #245b46' : undefined }}
      onPointerDownCapture={event => {
        clearHover()
        pressSelection.current={ids:[...props.selectionIds],groupId:props.activeGroupId ?? null}
        if (props.canvasMode === 'edit' && event.target instanceof Element && event.target.closest('[data-author-selection]')) {
          const handle = event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | 'move' | null
          const gesture = selectionHandleGesture(handle)
          authorInteraction.beginTransform(event, gesture.mode, gesture.handle)
          return
        }
        if (props.canvasMode === 'edit' && event.button === 0 && !spacePan.current && !inputOwnsPointer(event.target) && !(event.target instanceof Element && event.target.closest('[data-handle],[data-controller-selection],[data-spatial-object-selection]'))) {
          event.preventDefault(); event.stopPropagation(); capturePointer(event)
          const input = frozenPointer(event), pending = { input, latest: input, ended: false, context: hitContext() }
          visiblePointer.current = pending
          void resolveVisibleAt(pointer(event)).then(hit => {
            if (visiblePointer.current !== pending || hitContext() !== pending.context) return
            visiblePointer.current = null; input.visibleInstanceId = hit?.instanceId ?? null; input.authorKey = hit?.authorKey; input.released = pending.ended
            input.finalPointer = { clientX: pending.latest.clientX, clientY: pending.latest.clientY, shiftKey: pending.latest.shiftKey, altKey: pending.latest.altKey }
            if (hit?.authorKey && visibleInstance(input) === hit.instanceId && authorInteraction.pointerFromElement(input as ReactPointerEvent<HTMLElement>, hit)) return
            resumePointer.current(input, 'drag'); resumeMove.current(pending.latest)
            if (pending.ended) resumeFinish.current(input.pointerId)
          }).catch(failure => { visiblePointer.current = null; setError(String(failure)) })
          return
        }
        if (event.target instanceof Element && event.target.closest('[data-controller-selection],[data-spatial-object-selection]')) {
        const handle = event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | 'move' | null
        const gesture = selectionHandleGesture(handle)
        begin(event, gesture.mode, gesture.handle)
      } else if (!(event.target instanceof Element && event.target.closest('[data-handle]'))) begin(event) }} onPointerMove={event => {
        if (visiblePointer.current?.input.pointerId === event.pointerId) { visiblePointer.current.latest = frozenPointer(event); return }
        if(!active.current && !deferred.current)queueHover(pointer(event),event.ctrlKey||event.metaKey||event.altKey,event.shiftKey)
        move(event)
      }} onPointerLeave={clearHover} onPointerUp={event => {
        if (visiblePointer.current?.input.pointerId === event.pointerId) { visiblePointer.current.ended = true; visiblePointer.current.latest = frozenPointer(event); return }
        finish(event)
      }} onPointerCancel={event => { visiblePointer.current = null; finishPointer.current(event.pointerId) }} onLostPointerCapture={event => {
        if (visiblePointer.current?.input.pointerId === event.pointerId) { if (!visiblePointer.current.ended) visiblePointer.current = null; return }
        finish(event, true)
      }}
      onClickCapture={event => { if(event.detail===1)firstClickSelection.current=pressSelection.current; if (props.canvasMode === 'edit' && !inputOwnsPointer(event.target) && event.target instanceof Element && event.target.closest('[data-component-instance]')) { event.preventDefault(); event.stopPropagation() } }}
      onDoubleClickCapture={async event => {
        if (props.canvasMode !== 'edit' || inputOwnsPointer(event.target)) return
        event.preventDefault(); event.stopPropagation()
        const context = hitContext(), client = pointer(event), visible = await resolveVisibleAt(client)
        if (context !== hitContext()) return
        const first = visible && firstClickSelection.current && resolveGroupSelectionIntent(props.project,props.surface.id,visible.instanceId,firstClickSelection.current.ids,firstClickSelection.current.groupId)
        firstClickSelection.current=null
        if(first && first.pressId!==visible!.instanceId){selectCanvas([visible!.instanceId],first.groupId ?? first.pressId,visible!.authorKey ?? undefined);return}
        const input = frozenPointer({ pointerId: 0, button: event.button, clientX: event.clientX, clientY: event.clientY,
          shiftKey: event.shiftKey, altKey: event.altKey, target: event.target, visibleInstanceId: visible?.instanceId, released: true,
          preventDefault() {}, stopPropagation() {} })
        if (visibleInstance(input) === visible?.instanceId && visible?.authorKey && authorInteraction.doubleClickFromElement(event, visible)) return
        if (visible) objectDoubleClick.current(visible.instanceId, client, event.target)
      }}
      onContextMenu={async event => {
        if (props.canvasMode !== 'edit' || inputOwnsPointer(event.target)) return
        event.preventDefault()
        const context = hitContext(), visible = await resolveVisibleAt(pointer(event))
        if (context !== hitContext()) return
        const selectedId = visibleInstance({ visibleInstanceId: visible?.instanceId })
        if (selectedId === visible?.instanceId && props.canvasMode === 'edit' && props.contentEditor && !inputOwnsPointer(event.target)) {
          const hit = viewportTargets.find(target => target.instanceId === visible?.instanceId), original = hit && visibleTargets.find(target => target.instanceId === hit.instanceId)
          const captured = hit && original && !locked(hit) && editor.capture(hit.instanceId,
            transformPoint(invertMatrix(targetViewportMatrix(original)), viewportPoint(event)), pointer(event), true)
          if (captured && hit) {
            event.preventDefault(); event.stopPropagation()
            const point = pointer(event)
            void authorInteraction.beginNative(hit.instanceId, captured, () => authorInteraction.openContextMenu(point, hit.instanceId))
            return
          }
        }
        if (selectedId === visible?.instanceId && authorInteraction.contextMenuFromElement(event, visible)) return
        if (props.canvasMode !== 'edit' || inputOwnsPointer(event.target)) return
        event.preventDefault(); const place = pointer(event)
        if (selectedId) { const ids = props.selectionIds.includes(selectedId) ? props.selectionIds : [selectedId]; props.onSelect(ids); setTimeout(() => { if (root.current) requestObjectContextMenu(root.current, { ...place, itemIds: ids }) }, 0); return }
        menu.open(place, '画布操作', [
          { id: 'canvas.paste', label: '粘贴', shortcut: 'Ctrl+V', group: 'clipboard', run: () => props.onPaste?.(), disabledReason: props.onPaste ? null : '当前界面不支持此操作' },
          { id: 'canvas.select-all', label: '全选', shortcut: 'Ctrl+A', group: 'clipboard', run: () => props.onSelectAll?.() },
          { id: 'canvas.hidden', label: '找回隐藏的对象', group: 'view', run: () => menu.open(place, '隐藏的对象', hiddenMenu()), disabledReason: hidden.length ? null : '本页没有隐藏的对象' },
          { id: 'canvas.try-run', label: '从起始镜头试运行', group: 'view', run: () => props.onCanvasModeChange('run') },
        ])
      }}
      onDragOver={event => { if (props.onDropWorkspaceMedia && props.canvasMode === 'edit' && props.view.scope === 'world' && event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false) }}
      onDrop={event => {
        if (!props.onDropWorkspaceMedia || !event.dataTransfer.types.includes(WORKSPACE_MEDIA_DRAG_TYPE)) return
        event.preventDefault(); setDragOver(false)
        if (props.canvasMode !== 'edit' || props.view.scope !== 'world') { setError('请切换到可编辑的无限画布世界层后拖入媒体'); return }
        const frozen = props.captureTarget(), point = at(event)
        void deliverWorkspaceMediaDrop(event.dataTransfer.getData(WORKSPACE_MEDIA_DRAG_TYPE), media, { surface: 'spatial', x: point.x, y: point.y },
          { captured: frozen, documentId: frozen.documentId, projectId: frozen.project.id, revision: frozen.project.revision, locationId: props.surface.id, surfaceId: props.surface.id, sessionGeneration: props.activation ?? 0 }, props.onDropWorkspaceMedia,
          () => mediaRef.current.directory === media.directory && mediaRef.current.files === media.files).then(result => setError(result.ok ? null : result.reason ?? '媒体未插入'))
      }}>
      <ComponentBackgroundPaint background={props.project.rootIds.includes(props.surface.id) ? resolveComponentBackground(props.project) : undefined} resolveAsset={id => props.resolveBackgroundAsset?.(id)} />
      <div data-spatial-hud-plane="underlay" style={{ position: 'absolute', left: 0, top: 0, width: design.width, height: design.height, transformOrigin: '0 0', transform: `matrix(${hudMatrix.join(',')})`, pointerEvents: props.view.scope === 'global' ? 'auto' : 'none' }}>{showGlobals && props.project.global.underlay.map(id => props.renderInstance(id, hudDisplayProject))}</div>
      {!globalEditing && <div data-surface-background={props.surface.id} style={{ position: 'absolute', inset: 0, isolation: 'isolate', pointerEvents: 'none' }}><ComponentBackgroundPaint background={props.backgroundPreviewColor == null ? background : mergeComponentBackground(background, { color: props.backgroundPreviewColor })} resolveAsset={id => props.resolveBackgroundAsset?.(id)} /></div>}
      <div data-spatial-world="true" hidden={globalEditing} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', transform: `matrix(${worldMatrix.join(',')})` }}>{props.surface.childIds.map(id => props.renderInstance(id))}
      </div>
      <svg data-spatial-graph-layer="true" width="100%" height="100%" style={{ display: globalEditing ? 'none' : undefined, position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        <defs><marker id={`spatial-arrow-${props.surface.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#64748b" /></marker></defs>
        {(spatial?.paths ?? []).map(path => <path key={path.id} data-spatial-path-id={path.id}
          d={spatialConnectionSegments(spatialPathPoints(spatial, path, visibleWorldTargets), spatialConnectionTargets(visibleWorldTargets, spatialPathTargetIds(spatial, path))).map(segment => { const start = transformPoint(worldMatrix, segment.start), end = transformPoint(worldMatrix, segment.end); return `M${start.x},${start.y}L${end.x},${end.y}` }).join(' ')}
          fill="none" stroke={props.view.graphSelection?.id === path.id ? '#2563eb' : path.style?.color ?? '#3388ff'} strokeWidth={path.style?.width ?? 2} strokeDasharray={path.style?.dash === 'dashed' ? '8 5' : path.style?.dash === 'dotted' ? '2 4' : undefined}
          style={{ pointerEvents: props.canvasMode === 'edit' && props.view.scope === 'world' ? 'stroke' : 'none', cursor: 'pointer' }}><title>巡游路径：{path.title ?? path.id}，点击编辑</title></path>)}
        {(spatial?.relations ?? []).map(relation => {
          const a = spatialComponentCenter(visibleWorldTargets, relation.sourceInstanceId), b = spatialComponentCenter(visibleWorldTargets, relation.targetInstanceId); if (!a || !b) return null
          const obstacles = spatialConnectionTargets(visibleWorldTargets, [relation.sourceInstanceId, relation.targetInstanceId]), segments = spatialConnectionSegments([a, b], obstacles)
          return <g key={relation.id} data-spatial-relation-id={relation.id}>
            <title>关系：{relation.label || '连线'}，点击线或标签编辑</title>
            {segments.map((segment, index) => { const start = transformPoint(worldMatrix, segment.start), end = transformPoint(worldMatrix, segment.end)
              return <line key={index} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={props.view.graphSelection?.id === relation.id ? '#2563eb' : '#64748b'} strokeWidth={2}
                markerEnd={index === segments.length - 1 && relation.kind !== 'line' ? `url(#spatial-arrow-${props.surface.id})` : undefined}
                markerStart={index === 0 && relation.kind === 'bidirectional' ? `url(#spatial-arrow-${props.surface.id})` : undefined}
                style={{ pointerEvents: props.canvasMode === 'edit' && props.view.scope === 'world' ? 'stroke' : 'none', cursor: 'pointer' }} /> })}
            {relation.label && segments.length > 0 && <RelationLabel text={relation.label} segments={segments} targets={obstacles} matrix={worldMatrix} interactive={props.canvasMode === 'edit' && props.view.scope === 'world'} />}
          </g>
        })}
      </svg>
      {/* The plane never captures empty-space input; InstanceView owns each actual HUD hit surface. */}
      <div data-spatial-hud-plane="overlay" style={{ position: 'absolute', left: 0, top: 0, width: design.width, height: design.height, transformOrigin: '0 0', transform: `matrix(${hudMatrix.join(',')})`, pointerEvents: 'none' }}>{showGlobals && props.project.global.overlay.map(id => props.renderInstance(id, hudDisplayProject))}</div>
      {props.canvasMode==='edit' && props.activeGroupId && !props.selectionIds.includes(props.activeGroupId) && <div data-group-context={props.activeGroupId} style={{position:'absolute',inset:0,opacity:.35,pointerEvents:'none'}}>
        <SlideLayerSelectionOverlay targets={viewportTargets.filter(t=>t.instanceId===props.activeGroupId)} scale={1} surfaceToPointer={controllerPointerMatrix()} movable={false} resizable={false} rotatable={false}/>
      </div>}
      {props.canvasMode==='edit' && hoverId && <div data-next-click-target={hoverId} style={{position:'absolute',inset:0,opacity:.6,pointerEvents:'none'}}>
        <SlideLayerSelectionOverlay targets={viewportTargets.filter(t=>t.instanceId===hoverId)} scale={1} surfaceToPointer={controllerPointerMatrix()} movable={false} resizable={false} rotatable={false}/>
      </div>}
      {props.canvasMode === 'edit' && !authorInteraction.selectedSpot && <div data-controller-selection="true"><SlideLayerSelectionOverlay targets={selectedControllers} scale={1} surfaceToPointer={controllerPointerMatrix()} movable={controllerTransformable} resizable={controllerTransformable} rotatable={controllerTransformable} /></div>}
      {props.canvasMode === 'edit' && !authorInteraction.selectedSpot && <div data-spatial-object-selection="true" data-spatial-selection="true"><SlideLayerSelectionOverlay targets={selected} scale={1} surfaceToPointer={controllerPointerMatrix()} movable={selectedTransformable} resizable={selectedTransformable} rotatable={selectedTransformable} /></div>}
      {props.canvasMode === 'edit' && framelessBounds.map(({ id, bounds }) => <div key={id} data-spatial-selection="true" data-spatial-frameless-selection={id} aria-hidden="true"
        style={{ position: 'fixed', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, border: '1px solid #2563eb', pointerEvents: 'none' }} />)}
      {props.canvasMode === 'edit' && authorInteraction.authorTarget && <div data-author-selection="true"><SlideLayerSelectionOverlay targets={[authorInteraction.authorTarget]} scale={1} surfaceToPointer={IDENTITY_MATRIX}
        movable={authorTransformable} resizable={authorTransformable} rotatable={authorTransformable} /></div>}
      {props.canvasMode === 'edit' && authorBounds && <div data-author-selection="true" aria-hidden="true" style={{ position: 'fixed', left: authorBounds.left, top: authorBounds.top,
        width: authorBounds.width, height: authorBounds.height, border: '1px solid #2563eb', pointerEvents: 'none' }} />}
      {props.canvasMode === 'edit' && <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', transform: `matrix(${editorMatrix.join(',')})` }}>{editor.editor}</div>}
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        {guides.map((guide, index) => {
          const start = guide.axis === 'x' ? { x: guide.value, y: 0 } : { x: 0, y: guide.value }
          const end = guide.axis === 'x' ? { x: guide.value, y: size.height } : { x: size.width, y: guide.value }
          return <line key={index} data-spatial-snap-guide={guide.axis} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#ff4d9d" />
        })}
        {marquee && (() => { const { start, end } = marquee; return <rect data-spatial-marquee="true" x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)} width={Math.abs(end.x - start.x)} height={Math.abs(end.y - start.y)} fill="#2563eb22" stroke="#2563eb" /> })()}
        {props.canvasMode === 'edit' && !globalEditing && (() => {
          const points = cameraFrameCorners(props.view.camera)
          return <g data-spatial-camera-preview="true" aria-label="当前镜头示意框"><polygon points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#ac7b35" strokeWidth={1.5} strokeDasharray="10 6" />
            <text x={points[0]!.x + 8} y={points[0]!.y + 18} fill="#8c622c" fontSize={12}>当前镜头 · 添加后固定</text></g>
        })()}
        {props.canvasMode === 'edit' && !globalEditing && props.view.showCameraFrames && spatial?.frames.map(frame => {
          const points = cameraFrameCorners(spatialFramePose(frame, design, worldTargets))
          return <g key={frame.id} data-spatial-camera-frame={frame.id}><polygon points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={frame.id === props.view.activeCameraFrameId ? '#2563eb' : '#94a3b8'} strokeDasharray="7 5" /><text x={points[0]!.x + 4} y={points[0]!.y - 6}>{frame.title ?? frame.id}</text></g>
        })}
      </svg>
    </div>
  </main>
}
