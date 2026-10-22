import { useComponentAuthorInteraction } from './useComponentAuthorInteraction'
import { visibleComponentAuthorHit } from '../../components/componentAuthorHit'
import type { ImportedImageAsset } from '../../project/assetManager'
import type { TextRangeProjection } from '../../../shared/document/textInteraction'
import { Hand, Maximize2, Minus, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import type { ComponentEdit, ComponentFrame, ComponentSurface, CourseProjectV10 } from '../../../shared/contracts/component-platform'
import { isComponentVisibleAtSurface } from '../../../shared/contracts/component-platform'
import type { CapturedCourseTarget } from '../../documents/CourseV10DocumentBridge'
import type { SpatialSurfaceViewState, SpatialGraphSelection } from '../../store/slices/spatialAuthoringSlice'
import { componentSpatialCameraMatrix, panComponentSpatialCamera, zoomComponentSpatialCamera } from '../../../player/surfaces/spatial/componentSpatialAdapter'
import { spatialComponentCenter, spatialConnectionSegments, spatialConnectionTargets, spatialFramePose, spatialPathPoints, spatialPathTargetIds, spatialRelationLabelPosition, spatialSemanticVisible, type SpatialConnectionSegment, type SpatialGeometryTarget } from '../../../player/surfaces/spatial/componentPlatform/graph'
import { composeMatrices, frameCorners, IDENTITY_MATRIX, invertMatrix, multiplyMatrices, rotationMatrix, scaleMatrix, transformPoint, translationMatrix, type AffineMatrix, type GeometryPoint } from '../../../core/components/geometry'
import { FreeTransformGesture, type FreeResizeHandle, type FreeSnapGuide } from '../../componentPlatform/surfaces/slide/freeTransformGesture'
import { freeSelectionBounds, freeSurfaceTargets, hitFreeObject, marqueeFreeTargets, sameFreeTarget, selectedFreeTargets, type FreeObjectTarget } from '../../componentPlatform/surfaces/slide/targets'
import { spatialWorldTargets } from '../../componentPlatform/surfaces/spatial/targets'
import { useContextMenu } from '../../editing/commands/CommandMenu'
import { hiddenObjectCommands } from '../../editing/commands/hiddenObjectCommands'
import { OBJECT_EDIT_EVENT, requestObjectContextMenu } from '../../editing/commands/objectContextMenu'
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
import { SlideLayerSelectionOverlay } from './SlideLayerSelectionOverlay'
import { CourseNavigationControls } from './CourseNavigationControls'
import { EDITOR_PAGE_INSETS, fitPage } from '../../../shared/pageFrame'
import { MIXED_GLOBAL_GEOMETRY, mixedGlobalGeometryEdits, type MixedGlobalGeometryRequest } from './mixedGlobalGeometry'

export interface SpatialLocationWorkspaceProps {
  documentId: string
  project: CourseProjectV10
  surface: ComponentSurface
  view: SpatialSurfaceViewState
  activeStateId?: string | null
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
  onCamera(camera: SpatialSurfaceViewState['camera']): void
  onActivateFrame(frameId: string | null): void
  onGraphSelect(selection: SpatialGraphSelection): void
  onCanvasModeChange(mode: 'edit' | 'run'): void
  onResetPlayback?(playing: boolean): Promise<void>
  onEditContent?(instanceId: string): void
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
const inputOwnsPointer = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('input,textarea,select,button,a,[contenteditable="true"],[data-component-professional-editor]'))
const handles: FreeResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
type PointerInput = Pick<ReactPointerEvent<Element>, 'pointerId' | 'button' | 'clientX' | 'clientY' | 'shiftKey' | 'altKey' | 'preventDefault' | 'stopPropagation'> & { target: EventTarget | null; visibleInstanceId?: string | null }
type PointerFinish = Pick<PointerInput, 'pointerId'> & Partial<Pick<PointerInput, 'clientX' | 'clientY' | 'shiftKey' | 'altKey'>>
const frozenPointer = (event: PointerInput): PointerInput => ({ pointerId: event.pointerId, button: event.button,
  clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey, target: event.target,
  visibleInstanceId: event.visibleInstanceId, preventDefault() {}, stopPropagation() {} })
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
  const menu = useContextMenu(), media = useWorkspaceMediaSource()
  const mediaRef = useRef(media); mediaRef.current = media
  const [size, setSize] = useState({ width: 800, height: 450 })
  const [preview, setPreview] = useState<Record<string, ComponentFrame>>({})
  const [guides, setGuides] = useState<FreeSnapGuide[]>([])
  const [marquee, setMarquee] = useState<{ start: GeometryPoint; end: GeometryPoint } | null>(null)
  const spacePan = useRef(false)
  const [error, setError] = useState<string | null>(null), [dragOver, setDragOver] = useState(false)
  const [, refreshNavigation] = useState(0)
  useEffect(() => props.teacherController?.subscribe(() => refreshNavigation(value => value + 1)), [props.teacherController])
  useEffect(() => props.teacherController?.subscribePlacement?.(() => refreshNavigation(value => value + 1)), [props.teacherController])
  const active = useRef<{ pointerId: number; last: GeometryPoint; pan?: { pointer: GeometryPoint; camera: SpatialSurfaceViewState['camera']; scale: number };
    marquee?: GeometryPoint; originalSelection?: readonly string[]; geometry?: FreeTransformGesture; targets: FreeObjectTarget[]; edits: ComponentEdit[]; captured: CapturedCourseTarget } | null>(null)
  const pendingMove = useRef<PointerInput | null>(null), moveFrame = useRef<number | null>(null)
  const visiblePointer = useRef<{ input: PointerInput; latest: PointerInput; ended: boolean; context: string } | null>(null)
  const hitContext = () => JSON.stringify([latest.current.documentId, latest.current.surface.id, latest.current.activeStateId,
    latest.current.view.scope, latest.current.canvasMode, latest.current.activation])
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
    latest: PointerInput; ended: boolean; documentId: string; surfaceId: string; stateId: string | null; scope: SpatialSurfaceViewState['scope']; epoch: string } | null>(null)
  const resumePointer = useRef<(input: PointerInput, mode: 'drag' | 'resize' | 'rotate', handle?: FreeResizeHandle) => void>(() => {})
  const resumeMove = useRef<(input: PointerInput) => void>(() => {})
  const resumeFinish = useRef<(pointerId: number) => void>(() => {})
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
  const allControllerTargets = allTargets.filter(target => isViewportComponent(props.project, target.instanceId))
  const controllerTargets = allControllerTargets
    .filter(target => isComponentVisibleAtSurface(props.project.instances[target.instanceId], props.surface.id))
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
    undo: () => props.contentEditor?.undo(), redo: () => props.contentEditor?.redo(), host: () => viewport.current,
    report: message => props.contentEditor?.report(message),
    onSelectField: (spot, activate, read) => authorInteraction.selectNativeField(spot, activate, read),
  }, props.documentId + ':' + props.surface.id + ':' + (props.activeStateId ?? ''))
  const authorInteraction = useComponentAuthorInteraction({ root, documentId: props.documentId, surfaceId: props.surface.id,
    enabled: props.canvasMode === 'edit', contextKey: props.view.scope, selectImage: props.onSelectImageAsset, report: setError, wholeInstanceEditor: false })
  const resolveVisibleAt = (point: GeometryPoint) => visibleComponentAuthorHit(viewport.current, point, id =>
    [...(viewport.current?.querySelectorAll<HTMLElement>('[data-component-render]') ?? [])].find(element => element.dataset.componentRender === id))
  const visibleTarget = (input: { visibleInstanceId?: string | null; altKey?: boolean }) => {
    const leaf = viewportTargets.find(target => target.instanceId === input.visibleInstanceId)
    return leaf && (input.altKey || leaf.directSelection || !leaf.ancestors.length ? leaf
      : viewportTargets.find(target => target.instanceId === leaf.ancestors[0]) ?? leaf)
  }
  const beginNativePointer = (event: PointerInput): boolean => {
    if (props.canvasMode !== 'edit' || !props.contentEditor || spacePan.current || event.button !== 0
      || inputOwnsPointer(event.target) || event.target instanceof Element && event.target.closest('[data-handle],[data-controller-selection]')) return false
    const hit = viewportTargets.find(target => target.instanceId === event.visibleInstanceId)
    if (!hit) return false
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
  useEffect(() => { cancelPendingMove(); active.current = null; deferred.current = null; resetPreview(); setMarquee(null); setError(null) }, [props.documentId, props.surface.id, props.activeStateId, props.view.scope, props.canvasMode])
  useEffect(() => {
    const down = (event: KeyboardEvent) => { if (event.code === 'Space' && !inputOwnsPointer(event.target)) { spacePan.current = true; event.preventDefault() } }
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
    const teacherButton = props.canvasMode === 'edit' && event.target instanceof Element && event.target.closest('button')
      && isViewportComponent(props.project, event.target.closest('[data-component-instance]')?.getAttribute('data-component-instance') ?? '')
    if (active.current || deferred.current || (event.button !== 0 && event.button !== 1) || inputOwnsPointer(event.target) && !teacherButton) return
    const contentEdit = props.contentEditor?.read ? props.contentEditor.read() : props.contentEdit
    if (contentEdit) {
      if (contentEdit.composing || !props.contentEditor) return
      event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
      const input: PointerInput = { pointerId: event.pointerId, button: event.button, clientX: event.clientX, clientY: event.clientY,
        shiftKey: event.shiftKey, altKey: event.altKey, target: event.target, visibleInstanceId: event.visibleInstanceId, preventDefault() {}, stopPropagation() {} }
      const pending = { input, mode, handle, latest: input, ended: false, documentId: props.documentId, surfaceId: props.surface.id,
        stateId: props.activeStateId ?? null, scope: props.view.scope, epoch: contentEdit.target.epoch }
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
          || current.view.scope !== pending.scope || current.canvasMode !== 'edit' || current.captureTarget().epoch !== pending.epoch) { deferred.current = null; return }
        deferred.current = null
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
    const hudHandle = event.target instanceof Element && event.target.closest('[data-controller-selection]')
    const hit = props.canvasMode === 'run' || event.button === 1 || spacePan.current ? null
      : hudHandle ? controllerTargets.find(target => props.selectionIds.includes(target.instanceId)) ?? null
        : mode === 'drag' ? visibleTarget(event)
          : visibleTargets.find(target => props.selectionIds.includes(target.instanceId)) ?? null
    const pan = event.button === 1 || spacePan.current || (!hit && !event.shiftKey)
    if (!hit && !pan && props.canvasMode === 'edit') {
      event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
      const start = viewportPoint(event)
      active.current = { pointerId: event.pointerId, last: pointer(event), marquee: start, originalSelection: props.selectionIds, targets: [], edits: [], captured: props.captureTarget() }
      setMarquee({ start, end: start }); return
    }
    if (!hit && props.canvasMode === 'edit') { const graph = graphAt(at(event)); if (graph) { props.onGraphSelect(graph); event.stopPropagation(); return } }
    if (hit) { props.onGraphSelect(null); if (mode === 'drag') props.onSelect(event.shiftKey ? props.selectionIds.includes(hit.instanceId) ? props.selectionIds.filter(id => id !== hit.instanceId) : [...props.selectionIds, hit.instanceId] : props.selectionIds.includes(hit.instanceId) ? props.selectionIds : [hit.instanceId]) }
    else if (!event.shiftKey && props.canvasMode === 'edit' && event.button !== 1 && !spacePan.current) { props.onGraphSelect(null); props.onSelect([]) }
    const ids = mode !== 'drag' ? props.selectionIds : hit && event.shiftKey ? props.selectionIds.includes(hit.instanceId) ? props.selectionIds.filter(id => id !== hit.instanceId) : [...props.selectionIds, hit.instanceId] : hit && props.selectionIds.includes(hit.instanceId) ? props.selectionIds : hit ? [hit.instanceId] : []
    const targets = selectedFreeTargets(visibleTargets, ids).filter(target => !locked(target))
    if (hit && !targets.length || !hit && !pan) { event.stopPropagation(); return }
    event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
    gestureDisplay.current = { original: props.project, display: displayProject, viewport: controllerGeometry,
      offset: props.teacherController?.placement?.() ?? { x: 0, y: 0 } }
    active.current = { pointerId: event.pointerId, last: pointer(event), targets, captured: props.captureTarget(), edits: [],
      ...(pan ? { pan: { pointer: pointer(event), camera: { ...props.view.camera }, scale: renderScale } } : {}),
      geometry: pan ? undefined : new FreeTransformGesture({ mode, handle, targets: targets.map(viewportTarget), pointer: pointer(event), surfaceToPointer: controllerPointerMatrix(), snapTargets: viewportTargets.filter(target => !ids.includes(target.instanceId) && !target.ancestors.some(id => ids.includes(id))) }) }
  }
  resumePointer.current = begin
  const updateMove = (event: PointerInput) => {
    const gesture = active.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const next = pointer(event)
    if (gesture.marquee) { const end = viewportPoint(event); setMarquee({ start: gesture.marquee, end }); props.onSelect([...new Set([...(gesture.originalSelection ?? []), ...marqueeFreeTargets(viewportTargets, gesture.marquee, end)])]) }
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
    if (viewport.current?.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId)
    const frozen = gestureDisplay.current
    const edits = frozen ? restoreTeacherControllerFrameEdits(gesture.edits, frozen.original, frozen.display, frozen.viewport, frozen.offset, props.teacherController) : gesture.edits
    if (!cancel && edits.length) void props.onEdits(edits, gesture.captured).catch(error => setError(String(error))).finally(resetPreview)
    else resetPreview()
  }
  resumeFinish.current = pointerId => finish({ pointerId })
  const selectedTargets = selectedFreeTargets(scopeTargets.map(target => preview[target.instanceId] ? { ...target, frame: preview[target.instanceId]! } : target), props.selectionIds)
  const selected = selectedTargets.filter(target => !isViewportComponent(props.project, target.instanceId)).map(viewportTarget)
  const selectedControllers = selectedTargets.filter(target => isViewportComponent(props.project, target.instanceId))
  const bounds = freeSelectionBounds(selected)
  const corners = selected.length === 1 ? frameCorners(selected[0]!.frame, selected[0]!.parentToSurface) : bounds ? [{ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.top }, { x: bounds.right, y: bounds.bottom }, { x: bounds.left, y: bounds.bottom }] : []
  const screenCorners = corners
  const [nw, ne, se, sw] = screenCorners
  const mid = (a: GeometryPoint, b: GeometryPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const points = nw && ne && se && sw ? { nw, n: mid(nw, ne), ne, e: mid(ne, se), se, s: mid(sw, se), sw, w: mid(nw, sw) } : null
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
      bounds={id => { const element = [...(viewport.current?.querySelectorAll<HTMLElement>('[data-component-instance]') ?? [])].find(value => value.dataset.componentInstance === id); return element?.getBoundingClientRect() ?? null }} />
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
      data-observation-source={props.canvasMode === 'edit' ? 'authoring' : undefined} data-observation-project-id={props.project.id} data-observation-revision={props.project.revision}
      data-observation-surface-id={props.surface.id} data-observation-location-id={currentFrame?.id ?? props.surface.id} data-observation-state-id={props.activeStateId ?? ''} data-observation-ready="true"
      data-observation-spatial-camera={JSON.stringify(props.view.camera)} style={{ ...(props.canvasMode === 'run'
        ? { inset: 'auto', left: runFit.left, top: runFit.top, width: design.width * runFit.scale, height: design.height * runFit.scale }
        : { inset: 0 }), overflow: 'hidden', touchAction: 'none', isolation: 'isolate', boxShadow: dragOver ? 'inset 0 0 0 3px #245b46' : undefined }}
      onPointerDownCapture={event => {
        if (props.canvasMode === 'edit' && event.button === 0 && !spacePan.current && !(event.target instanceof Element && event.target.closest('[data-handle],[data-controller-selection],[data-component-professional-editor],input,textarea,[contenteditable="true"]'))) {
          event.preventDefault(); event.stopPropagation(); viewport.current!.setPointerCapture(event.pointerId)
          const input = frozenPointer(event), pending = { input, latest: input, ended: false, context: hitContext() }
          visiblePointer.current = pending
          void resolveVisibleAt(pointer(event)).then(hit => {
            if (visiblePointer.current !== pending || hitContext() !== pending.context) return
            visiblePointer.current = null; input.visibleInstanceId = hit?.instanceId ?? null
            if (beginNativePointer(input) || hit?.authorKey && authorInteraction.pointerFromElement(input as ReactPointerEvent<HTMLElement>, hit)) return
            resumePointer.current(input, 'drag'); resumeMove.current(pending.latest)
            if (pending.ended) resumeFinish.current(input.pointerId)
          }).catch(failure => { visiblePointer.current = null; setError(String(failure)) })
          return
        }
        if (event.target instanceof Element && event.target.closest('[data-controller-selection]')) {
        const handle = event.target.closest('[data-handle]')?.getAttribute('data-handle') as FreeResizeHandle | 'rotate' | null
        begin(event, handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'drag', handle === 'rotate' ? undefined : handle ?? undefined)
      } else if (!(event.target instanceof Element && event.target.closest('[data-handle]'))) begin(event) }} onPointerMove={event => {
        if (visiblePointer.current?.input.pointerId === event.pointerId) { visiblePointer.current.latest = frozenPointer(event); return }
        move(event)
      }} onPointerUp={event => {
        if (visiblePointer.current?.input.pointerId === event.pointerId) { visiblePointer.current.ended = true; visiblePointer.current.latest = frozenPointer(event); return }
        finish(event)
      }} onPointerCancel={event => { visiblePointer.current = null; finish(event, true) }} onLostPointerCapture={event => finish(event, true)}
      onDoubleClick={async event => { if (props.canvasMode === 'edit' && !inputOwnsPointer(event.target)) { const context = hitContext(), client = pointer(event), visible = await resolveVisibleAt(client); if (context !== hitContext()) return; const hit = viewportTargets.find(target => target.instanceId === visible?.instanceId); if (hit) { const original = visibleTargets.find(target => target.instanceId === hit.instanceId)!, point = transformPoint(invertMatrix(targetViewportMatrix(original)), viewportPoint(event)); props.onSelect([hit.instanceId]); if (!editor.begin(hit.instanceId, point, pointer(event))) props.onEditContent?.(hit.instanceId) } } }}
      onContextMenu={async event => {
        if (props.canvasMode !== 'edit' || inputOwnsPointer(event.target)) return
        event.preventDefault()
        const context = hitContext(), visible = await resolveVisibleAt(pointer(event))
        if (context !== hitContext()) return
        if (props.canvasMode === 'edit' && props.contentEditor && !inputOwnsPointer(event.target)) {
          const hit = viewportTargets.find(target => target.instanceId === visible?.instanceId), original = hit && visibleTargets.find(target => target.instanceId === hit.instanceId)
          const captured = hit && original && editor.capture(hit.instanceId,
            transformPoint(invertMatrix(targetViewportMatrix(original)), viewportPoint(event)), pointer(event), true)
          if (captured && hit) {
            event.preventDefault(); event.stopPropagation()
            const point = pointer(event)
            void authorInteraction.beginNative(hit.instanceId, captured, () => authorInteraction.openContextMenu(point, hit.instanceId))
            return
          }
        }
        if (authorInteraction.contextMenuFromElement(event, visible)) return
        if (props.canvasMode !== 'edit' || inputOwnsPointer(event.target)) return
        event.preventDefault(); const place = pointer(event), hit = viewportTargets.find(target => target.instanceId === visible?.instanceId)
        if (hit) { const ids = props.selectionIds.includes(hit.instanceId) ? props.selectionIds : [hit.instanceId]; props.onSelect(ids); setTimeout(() => { if (root.current) requestObjectContextMenu(root.current, { ...place, itemIds: ids }) }, 0); return }
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
      {props.canvasMode === 'edit' && <div data-controller-selection="true"><SlideLayerSelectionOverlay targets={selectedControllers.filter(target => !locked(target))} scale={1} surfaceToPointer={controllerPointerMatrix()} /></div>}
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
        {props.canvasMode === 'edit' && points && <><polygon points={screenCorners.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={1.5} />
          {!selected.some(locked) && handles.map(handle => <circle key={handle} data-handle={handle} cx={points[handle].x} cy={points[handle].y} r={5} fill="white" stroke="#2563eb" style={{ pointerEvents: 'auto', cursor: 'nwse-resize' }} onPointerDown={event => { event.stopPropagation(); begin(event, 'resize', handle) }} />)}
          {!selected.some(locked) && <circle data-handle="rotate" cx={points.n.x} cy={points.n.y - 28} r={6} fill="white" stroke="#2563eb" style={{ pointerEvents: 'auto', cursor: 'grab' }} onPointerDown={event => { event.stopPropagation(); begin(event, 'rotate') }} />}
        </>}
      </svg>
    </div>
  </main>
}
