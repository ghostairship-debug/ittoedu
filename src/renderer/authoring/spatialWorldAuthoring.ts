import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_NODE_SIZE } from '../../shared/constants'
import { constrainTeacherControllerAuthoringFrame } from '../../shared/teacherControllerLayout'
import { isCourseTeacherControllerLayerItem } from '../../shared/teacherControllerConsistency'
import { formulaAstToAccessibleText } from '../../shared/formulaLinear'
import { applyTextRunStyle, remapTextRuns } from '../../shared/textRuns'
import type {
  NativeLayerItem,
} from '../../shared/courseProjectTypes'
import type {
  FormulaAstNode,
  TextOverflowMode,
  TextRun,
  TextRunStyle,
  WritingMode,
} from '../../shared/projectTypes'
import {
  clientToWorld,
  resizeWorldFrameFromHandle,
  stageResizeHandleWorldPoint,
  stageRotateHandleWorldPoint,
  stageSelectionOverlayGeometry,
  worldRectCenter,
  type StagePoint,
  type StageRect,
  type StageResizeHandleDirection,
  type StageSelectionOverlayGeometry,
  type StageViewportTransform,
} from './stageViewportTransform'
import {
  resolveV9SlideContentBlur,
  resolveV9SlideContentKeyDown,
  resolveV9SlideContentSelectionChange,
  type V9SlideContentEditAction,
  type V9SlideContentEditKind,
  type V9SlideContentEditSource,
  type V9SlideFormulaContentDraft,
  type V9SlideFormulaContentSnapshot,
  type V9SlideTextContentDraft,
  type V9SlideTextContentSnapshot,
} from './v9SlideContentEdit'
import {
  SPATIAL_REJECT_LOCKED,
  SPATIAL_REJECT_STALE_REVISION,
  SPATIAL_REJECT_WRONG_OWNER,
  SpatialCommandError,
  addSpatialWorldComponentLayer,
  addSpatialWorldFormulaLayer,
  addSpatialWorldImageLayer,
  addSpatialWorldRuntimeLayer,
  addSpatialWorldTextLayer,
  addSpatialWorldVideoLayer,
  buildSpatialEditorView,
  commitSpatialAuthoringHistory,
  commitSpatialProjectMutation,
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
  makeSpatialAuthoringTarget,
  panSpatialSessionCamera,
  selectSpatialLayers,
  setSpatialEditingScope,
  spatialAuthoringGeneration,
  spatialSurfaceIn,
  spatialWorldPointerDeltaToWorld,
  transformSpatialWorldLayersInSession,
  transformSpatialViewportLayersInSession,
  zoomSpatialSessionCamera,
  type AddSpatialWorldComponentLayerInput,
  type AddSpatialWorldImageLayerInput,
  type AddSpatialWorldLayerInput,
  type AddSpatialWorldRuntimeLayerInput,
  type AddSpatialWorldTextLayerInput,
  type AddSpatialWorldVideoLayerInput,
  type SpatialAuthoringSession,
  type SpatialAuthoringTarget,
  type SpatialCommandOptions,
  type SpatialCommandResult,
  type SpatialEditorWorldTransform,
  type SpatialSessionCamera,
} from '../course/spatialEditorCommands'
import {
  replaceSpatialSession,
} from '../course/spatialAuthoringHistory'
import {
  type SpatialEditorView,
} from '../course/spatialEditorView'
import {
  adaptV9SpatialEditorLayers,
  hitTestV9SpatialLayerItems,
  marqueeHitV9SpatialWorldLayerItems,
  type V9SpatialHitTarget,
} from '../phaser/v9SpatialHitAdapter'

const MARQUEE_MIN_SIZE = 3
const HANDLE_HIT_RADIUS = 10
const PAN_MIN_SIZE = 3

export const SPATIAL_CONTENT_REJECT_COMPOSING = 'composing'
export const SPATIAL_CONTENT_REJECT_STALE_GENERATION = 'stale-generation'
export const SPATIAL_CONTENT_REJECT_INVALID_TARGET = 'invalid-target'
export const SPATIAL_DEFERRED_OVERLAY_REASON = 'handed-to-R5-C'

export type SpatialWorldContentEditKind = V9SlideContentEditKind
export type SpatialWorldContentEditSource = V9SlideContentEditSource
export type SpatialWorldContentEditAction = V9SlideContentEditAction

export {
  resolveV9SlideContentKeyDown as resolveSpatialWorldContentKeyDown,
  resolveV9SlideContentBlur as resolveSpatialWorldContentBlur,
  resolveV9SlideContentSelectionChange as resolveSpatialWorldContentSelectionChange,
}

export type SpatialDeferredOverlayKind = 'camera-frame' | 'path' | 'relation'

export interface SpatialDeferredOverlayHit {
  readonly kind: 'unimplemented'
  readonly overlay: SpatialDeferredOverlayKind
  readonly reason: typeof SPATIAL_DEFERRED_OVERLAY_REASON
}

export interface SpatialWorldAuthoringPointer {
  readonly x: number
  readonly y: number
  /** Client CSS pixels. World/viewport conversion uses R5-A matrices. */
  readonly additive?: boolean
}

export interface SpatialWorldAuthoringHost {
  getSession(): SpatialAuthoringSession
  setSession(session: SpatialAuthoringSession): void
}

export interface SpatialWorldAuthoringResult {
  readonly worldTransform: StageViewportTransform
  readonly viewportTransform: StageViewportTransform
  readonly overlay: StageSelectionOverlayGeometry | null
  readonly viewportOverlay: StageSelectionOverlayGeometry | null
  readonly command?: SpatialCommandResult
  readonly preview?: readonly SpatialEditorWorldTransform[]
  readonly previewCamera?: SpatialSessionCamera
  readonly targets?: readonly SpatialAuthoringTarget[]
  readonly hit?: V9SpatialHitTarget | null
  readonly deferredOverlay?: SpatialDeferredOverlayHit | null
  readonly marquee?: StageRect | null
  readonly contentEdit?: BeginSpatialWorldContentEditResult
}

interface MoveGesture {
  readonly type: 'move'
  readonly startWorld: StagePoint
  readonly nodes: readonly SpatialEditorWorldTransform[]
}

interface ResizeGesture {
  readonly type: 'resize'
  readonly direction: StageResizeHandleDirection
  readonly startWorld: StagePoint
  readonly nodes: readonly SpatialEditorWorldTransform[]
}

interface RotateGesture {
  readonly type: 'rotate'
  readonly center: StagePoint
  readonly startAngle: number
  readonly nodes: readonly SpatialEditorWorldTransform[]
}

interface MarqueeGesture {
  readonly type: 'marquee'
  readonly startWorld: StagePoint
  readonly additive: boolean
}

interface PanGesture {
  readonly type: 'pan'
  readonly startClient: StagePoint
  readonly startCamera: SpatialSessionCamera
}

interface ViewportMoveGesture {
  readonly type: 'viewport-move'
  readonly startViewport: StagePoint
  readonly nodes: readonly SpatialEditorWorldTransform[]
}

interface ViewportResizeGesture {
  readonly type: 'viewport-resize'
  readonly direction: StageResizeHandleDirection
  readonly startViewport: StagePoint
  readonly nodes: readonly SpatialEditorWorldTransform[]
}

type SpatialWorldGesture =
  | MoveGesture
  | ResizeGesture
  | RotateGesture
  | MarqueeGesture
  | PanGesture
  | ViewportMoveGesture
  | ViewportResizeGesture

export function spatialWorldViewTransform(
  viewport: StageRect,
  sessionCamera: SpatialSessionCamera,
): StageViewportTransform {
  return createSpatialWorldViewTransform(viewport, sessionCamera)
}

export function spatialViewportOverlayTransform(viewport: StageRect): StageViewportTransform {
  return createSpatialViewportOverlayTransform(viewport)
}

export function pointerToSpatialWorld(
  pointer: StagePoint,
  viewport: StageRect,
  sessionCamera: SpatialSessionCamera,
): StagePoint {
  return clientToWorld(createSpatialWorldViewTransform(viewport, sessionCamera), pointer)
}

export function pointerToSpatialViewport(
  pointer: StagePoint,
  viewport: StageRect,
): StagePoint {
  return clientToWorld(createSpatialViewportOverlayTransform(viewport), pointer)
}

function editorView(session: SpatialAuthoringSession): SpatialEditorView {
  return buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
  })
}

function layerHits(session: SpatialAuthoringSession): V9SpatialHitTarget[] {
  return adaptV9SpatialEditorLayers(editorView(session).layers)
}

function authoringLayerHits(session: SpatialAuthoringSession): V9SpatialHitTarget[] {
  if (session.scope === 'global') return layerHits(session)
  return layerHits(session).filter((target) => target.nativeType !== 'teacher-controller')
}

function hitAtPointer(
  session: SpatialAuthoringSession,
  viewport: StageRect,
  pointer: StagePoint,
): V9SpatialHitTarget | null {
  return hitTestV9SpatialLayerItems(authoringLayerHits(session), {
    viewport: pointerToSpatialViewport(pointer, viewport),
    world: pointerToSpatialWorld(pointer, viewport, session.sessionCamera),
  })
}

/**
 * Camera frames may be reported after a world miss. Path/relation never claim
 * a hit here so they cannot steal world elements (R5-C).
 */
export function hitTestSpatialDeferredOverlays(
  session: SpatialAuthoringSession,
  viewport: StageRect,
  worldPoint: StagePoint,
): SpatialDeferredOverlayHit | null {
  if (!session.showCameraFrames) return null
  const view = editorView(session)
  for (const frame of view.camera.frames) {
    const width = viewport.width / frame.zoom
    const height = viewport.height / frame.zoom
    const rect = {
      x: frame.x - width / 2,
      y: frame.y - height / 2,
      width,
      height,
    }
    if (
      worldPoint.x >= rect.x &&
      worldPoint.x <= rect.x + rect.width &&
      worldPoint.y >= rect.y &&
      worldPoint.y <= rect.y + rect.height
    ) {
      return {
        kind: 'unimplemented',
        overlay: 'camera-frame',
        reason: SPATIAL_DEFERRED_OVERLAY_REASON,
      }
    }
  }
  return null
}

function worldFrames(session: SpatialAuthoringSession): Map<string, SpatialEditorWorldTransform> {
  const frames = new Map<string, SpatialEditorWorldTransform>()
  for (const layer of editorView(session).layers) {
    if (layer.coordinateSpace !== 'world') continue
    frames.set(layer.selectionId, {
      layerItemId: layer.selectionId,
      x: layer.item.frame.x,
      y: layer.item.frame.y,
      width: layer.item.frame.width,
      height: layer.item.frame.height,
      rotation: layer.item.rotation,
    })
  }
  return frames
}

function writableWorldTransforms(session: SpatialAuthoringSession): SpatialEditorWorldTransform[] {
  const frames = worldFrames(session)
  const hits = new Map(layerHits(session).map((target) => [target.layerItemId, target]))
  return session.selection.selectionIds.flatMap((id) => {
    const frame = frames.get(id)
    const hit = hits.get(id)
    if (!frame || !hit || hit.locked || !hit.writable || hit.source !== 'world') return []
    return [frame]
  })
}

function viewportFrames(session: SpatialAuthoringSession): Map<string, SpatialEditorWorldTransform> {
  const frames = new Map<string, SpatialEditorWorldTransform>()
  for (const layer of editorView(session).layers) {
    if (layer.coordinateSpace !== 'viewport' || layer.source !== 'global') continue
    frames.set(layer.selectionId, {
      layerItemId: layer.selectionId,
      x: layer.item.frame.x,
      y: layer.item.frame.y,
      width: layer.item.frame.width,
      height: layer.item.frame.height,
      rotation: layer.item.rotation,
    })
  }
  return frames
}

function writableViewportTransforms(session: SpatialAuthoringSession): SpatialEditorWorldTransform[] {
  const frames = viewportFrames(session)
  const hits = new Map(authoringLayerHits(session).map((target) => [target.layerItemId, target]))
  return session.selection.selectionIds.flatMap((id) => {
    const frame = frames.get(id)
    const hit = hits.get(id)
    if (!frame || !hit || hit.locked || !hit.writable || hit.coordinateSpace !== 'viewport') return []
    return [frame]
  })
}

function constrainTeacherControllerViewportTransforms(
  session: SpatialAuthoringSession,
  nodes: readonly SpatialEditorWorldTransform[],
): SpatialEditorWorldTransform[] {
  const controllers = new Map(session.history.present.globalLayerItems.flatMap((entry) => (
    isCourseTeacherControllerLayerItem(entry.item)
      ? [[entry.item.layerItemId, entry.item] as const]
      : []
  )))
  return nodes.map((node) => {
    const item = controllers.get(node.layerItemId)
    if (!item) return node
    const frame = constrainTeacherControllerAuthoringFrame(
      item.content.data,
      node,
      node.rotation,
      { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    )
    return { ...node, ...frame }
  })
}

function makeTargets(session: SpatialAuthoringSession): SpatialAuthoringTarget[] {
  const hits = new Set(authoringLayerHits(session).map((target) => target.layerItemId))
  return session.selection.selectionIds.flatMap((layerItemId) => {
    if (!hits.has(layerItemId)) return []
    try {
      return [makeSpatialAuthoringTarget(session, layerItemId)]
    } catch {
      return []
    }
  })
}

function overlayItemsFromSelection(
  session: SpatialAuthoringSession,
  preview: readonly SpatialEditorWorldTransform[] | undefined,
  space: 'world' | 'viewport',
): StageRect[] {
  const previewById = new Map((preview ?? []).map((node) => [node.layerItemId, node]))
  const hits = new Map(authoringLayerHits(session).map((target) => [target.layerItemId, target]))
  return session.selection.selectionIds.flatMap((id) => {
    const hit = hits.get(id)
    if (!hit || hit.coordinateSpace !== space) return []
    const previewNode = previewById.get(id)
    if (previewNode) {
      return [{
        x: previewNode.x,
        y: previewNode.y,
        width: previewNode.width,
        height: previewNode.height,
        rotation: previewNode.rotation,
      }]
    }
    return [{
      x: hit.bounds.x,
      y: hit.bounds.y,
      width: hit.bounds.width,
      height: hit.bounds.height,
      rotation: hit.bounds.rotation,
    }]
  })
}

export function spatialWorldSelectionOverlay(
  viewport: StageRect,
  session: SpatialAuthoringSession,
  preview?: readonly SpatialEditorWorldTransform[],
): StageSelectionOverlayGeometry | null {
  return stageSelectionOverlayGeometry(
    createSpatialWorldViewTransform(viewport, session.sessionCamera),
    overlayItemsFromSelection(session, preview, 'world'),
  )
}

export function spatialViewportHudOverlay(
  viewport: StageRect,
  session: SpatialAuthoringSession,
  preview?: readonly SpatialEditorWorldTransform[],
): StageSelectionOverlayGeometry | null {
  return stageSelectionOverlayGeometry(
    createSpatialViewportOverlayTransform(viewport),
    overlayItemsFromSelection(session, preview, 'viewport'),
  )
}

function angleOf(point: StagePoint, center: StagePoint): number {
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI
}

function previewMove(
  gesture: MoveGesture,
  world: StagePoint,
): SpatialEditorWorldTransform[] {
  const dx = world.x - gesture.startWorld.x
  const dy = world.y - gesture.startWorld.y
  return gesture.nodes.map((node) => ({
    ...node,
    x: node.x + dx,
    y: node.y + dy,
  }))
}

function previewResize(
  gesture: ResizeGesture,
  world: StagePoint,
): SpatialEditorWorldTransform[] {
  if (gesture.nodes.length === 1) {
    const start = gesture.nodes[0]!
    const next = resizeWorldFrameFromHandle(start, gesture.direction, world, MIN_NODE_SIZE)
    return [{ ...start, ...next }]
  }
  const left = Math.min(...gesture.nodes.map((node) => node.x))
  const top = Math.min(...gesture.nodes.map((node) => node.y))
  const right = Math.max(...gesture.nodes.map((node) => node.x + node.width))
  const bottom = Math.max(...gesture.nodes.map((node) => node.y + node.height))
  const startBox = { x: left, y: top, width: right - left, height: bottom - top }
  const nextBox = resizeWorldFrameFromHandle(startBox, gesture.direction, world, MIN_NODE_SIZE)
  const scaleX = nextBox.width / startBox.width
  const scaleY = nextBox.height / startBox.height
  return gesture.nodes.map((node) => ({
    ...node,
    x: nextBox.x + (node.x - startBox.x) * scaleX,
    y: nextBox.y + (node.y - startBox.y) * scaleY,
    width: Math.max(MIN_NODE_SIZE, node.width * scaleX),
    height: Math.max(MIN_NODE_SIZE, node.height * scaleY),
  }))
}

function previewRotate(
  gesture: RotateGesture,
  world: StagePoint,
): SpatialEditorWorldTransform[] {
  const delta = angleOf(world, gesture.center) - gesture.startAngle
  const radians = delta * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return gesture.nodes.map((node) => {
    const center = worldRectCenter(node)
    const offsetX = center.x - gesture.center.x
    const offsetY = center.y - gesture.center.y
    const nextCenter = {
      x: gesture.center.x + offsetX * cosine - offsetY * sine,
      y: gesture.center.y + offsetX * sine + offsetY * cosine,
    }
    return {
      ...node,
      x: nextCenter.x - node.width / 2,
      y: nextCenter.y - node.height / 2,
      rotation: node.rotation + delta,
    }
  })
}

function hitHandle(
  session: SpatialAuthoringSession,
  world: StagePoint,
): { kind: 'resize'; direction: StageResizeHandleDirection } | { kind: 'rotate' } | null {
  const hits = new Map(layerHits(session).map((target) => [target.layerItemId, target]))
  const selected = session.selection.selectionIds.flatMap((id) => {
    const target = hits.get(id)
    if (!target || target.coordinateSpace !== 'world') return []
    return [target]
  })
  if (selected.length === 0 || selected.every((target) => target.locked)) return null
  const rotation = selected.length === 1 ? selected[0]!.bounds.rotation : 0
  const box = selected.length === 1
    ? {
        x: selected[0]!.bounds.x,
        y: selected[0]!.bounds.y,
        width: selected[0]!.bounds.width,
        height: selected[0]!.bounds.height,
      }
    : (() => {
        const left = Math.min(...selected.map((item) => item.bounds.x))
        const top = Math.min(...selected.map((item) => item.bounds.y))
        const right = Math.max(...selected.map((item) => item.bounds.x + item.bounds.width))
        const bottom = Math.max(...selected.map((item) => item.bounds.y + item.bounds.height))
        return { x: left, y: top, width: right - left, height: bottom - top }
      })()
  const rotatePoint = stageRotateHandleWorldPoint(box, rotation)
  if (Math.hypot(world.x - rotatePoint.x, world.y - rotatePoint.y) <= HANDLE_HIT_RADIUS) {
    return { kind: 'rotate' }
  }
  for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    const point = stageResizeHandleWorldPoint(box, direction, rotation)
    if (Math.hypot(world.x - point.x, world.y - point.y) <= HANDLE_HIT_RADIUS) {
      return { kind: 'resize', direction }
    }
  }
  return null
}

function hitViewportHandle(
  session: SpatialAuthoringSession,
  viewportPoint: StagePoint,
): { kind: 'resize'; direction: StageResizeHandleDirection } | null {
  const hits = new Map(authoringLayerHits(session).map((target) => [target.layerItemId, target]))
  const selected = session.selection.selectionIds.flatMap((id) => {
    const target = hits.get(id)
    if (!target || target.coordinateSpace !== 'viewport') return []
    return [target]
  })
  if (selected.length === 0 || selected.every((target) => target.locked)) return null
  const rotation = selected.length === 1 ? selected[0]!.bounds.rotation : 0
  const box = selected.length === 1
    ? {
        x: selected[0]!.bounds.x,
        y: selected[0]!.bounds.y,
        width: selected[0]!.bounds.width,
        height: selected[0]!.bounds.height,
      }
    : (() => {
        const left = Math.min(...selected.map((item) => item.bounds.x))
        const top = Math.min(...selected.map((item) => item.bounds.y))
        const right = Math.max(...selected.map((item) => item.bounds.x + item.bounds.width))
        const bottom = Math.max(...selected.map((item) => item.bounds.y + item.bounds.height))
        return { x: left, y: top, width: right - left, height: bottom - top }
      })()
  for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    const point = stageResizeHandleWorldPoint(box, direction, rotation)
    if (Math.hypot(viewportPoint.x - point.x, viewportPoint.y - point.y) <= HANDLE_HIT_RADIUS) {
      return { kind: 'resize', direction }
    }
  }
  return null
}

function marqueeRect(start: StagePoint, world: StagePoint) {
  return {
    x: Math.min(start.x, world.x),
    y: Math.min(start.y, world.y),
    width: Math.abs(world.x - start.x),
    height: Math.abs(world.y - start.y),
  }
}

function previewPanCamera(
  gesture: PanGesture,
  client: StagePoint,
): SpatialSessionCamera {
  const cssDelta = { x: client.x - gesture.startClient.x, y: client.y - gesture.startClient.y }
  const worldDelta = spatialWorldPointerDeltaToWorld(gesture.startCamera, cssDelta)
  return {
    x: gesture.startCamera.x - worldDelta.x,
    y: gesture.startCamera.y - worldDelta.y,
    zoom: gesture.startCamera.zoom,
  }
}

function applyCommand(
  host: SpatialWorldAuthoringHost,
  run: (session: SpatialAuthoringSession) => SpatialCommandResult,
): SpatialCommandResult {
  const result = run(host.getSession())
  if (result.nextSession) host.setSession(result.nextSession)
  return result
}

function isEditableTextOrFormula(hit: V9SpatialHitTarget): boolean {
  return hit.kind === 'native' &&
    (hit.nativeType === 'text' || hit.nativeType === 'formula') &&
    !hit.locked &&
    hit.writable
}

function ensureWorldScope(host: SpatialWorldAuthoringHost): SpatialCommandResult | undefined {
  const session = host.getSession()
  if (session.scope === 'world') return undefined
  return applyCommand(host, (current) => setSpatialEditingScope(current, 'world'))
}

function ensureGlobalScope(host: SpatialWorldAuthoringHost): SpatialCommandResult | undefined {
  const session = host.getSession()
  if (session.scope === 'global') return undefined
  return applyCommand(host, (current) => setSpatialEditingScope(current, 'global'))
}

function resultOf(
  host: SpatialWorldAuthoringHost,
  viewport: StageRect,
  extra: Partial<Omit<SpatialWorldAuthoringResult, 'worldTransform' | 'viewportTransform' | 'overlay' | 'viewportOverlay' | 'targets'>> = {},
): SpatialWorldAuthoringResult {
  const session = host.getSession()
  const preview = extra.preview
  const previewCamera = extra.previewCamera ?? session.sessionCamera
  const worldTransform = createSpatialWorldViewTransform(viewport, previewCamera)
  const viewportTransform = createSpatialViewportOverlayTransform(viewport)
  return {
    worldTransform,
    viewportTransform,
    overlay: stageSelectionOverlayGeometry(
      worldTransform,
      overlayItemsFromSelection(session, preview, 'world'),
    ),
    viewportOverlay: stageSelectionOverlayGeometry(
      viewportTransform,
      overlayItemsFromSelection(session, preview, 'viewport'),
    ),
    targets: makeTargets(session),
    ...extra,
  }
}

/**
 * Spatial world hit / selection / transform adapter. Session camera is the
 * view; viewport/global HUD uses the R2 overlay matrix and never sessionCamera.
 * Not wired to Workspace — R5-Z consumes this controller.
 */
export function createSpatialWorldAuthoringController(host: SpatialWorldAuthoringHost) {
  let gesture: SpatialWorldGesture | null = null
  let preview: SpatialEditorWorldTransform[] | null = null
  let previewCamera: SpatialSessionCamera | null = null

  const overlayGeometry = (viewport: StageRect) =>
    spatialWorldSelectionOverlay(viewport, host.getSession(), preview ?? undefined)

  const viewportOverlayGeometry = (viewport: StageRect) =>
    spatialViewportHudOverlay(viewport, host.getSession(), preview ?? undefined)

  const selectFromLayerIds = (
    layerItemIds: readonly string[],
    viewport: StageRect,
    additive = false,
  ): SpatialWorldAuthoringResult => {
    const command = applyCommand(host, (session) =>
      selectSpatialLayers(session, { layerItemIds, additive }, {
        expectedRevision: session.history.present.revision,
      }),
    )
    gesture = null
    preview = null
    previewCamera = null
    return resultOf(host, viewport, { command })
  }

  const pointerDown = (
    pointer: SpatialWorldAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldAuthoringResult => {
    const session = host.getSession()
    const client = { x: pointer.x, y: pointer.y }
    const world = pointerToSpatialWorld(client, viewport, session.sessionCamera)
    const viewportPoint = pointerToSpatialViewport(client, viewport)
    const viewportHandle = hitViewportHandle(session, viewportPoint)
    const viewportWritable = writableViewportTransforms(session)

    if (viewportHandle?.kind === 'resize' && viewportWritable.length > 0) {
      gesture = {
        type: 'viewport-resize',
        direction: viewportHandle.direction,
        startViewport: viewportPoint,
        nodes: viewportWritable,
      }
      preview = viewportWritable.map((node) => ({ ...node }))
      return resultOf(host, viewport, { preview })
    }

    const handle = hitHandle(session, world)
    const writable = writableWorldTransforms(session)

    if (handle?.kind === 'resize' && writable.length > 0) {
      gesture = { type: 'resize', direction: handle.direction, startWorld: world, nodes: writable }
      preview = writable.map((node) => ({ ...node }))
      return resultOf(host, viewport, { preview })
    }
    if (handle?.kind === 'rotate' && writable.length > 0) {
      const left = Math.min(...writable.map((node) => node.x))
      const top = Math.min(...writable.map((node) => node.y))
      const right = Math.max(...writable.map((node) => node.x + node.width))
      const bottom = Math.max(...writable.map((node) => node.y + node.height))
      const center = { x: (left + right) / 2, y: (top + bottom) / 2 }
      gesture = {
        type: 'rotate',
        center,
        startAngle: angleOf(world, center),
        nodes: writable,
      }
      preview = writable.map((node) => ({ ...node }))
      return resultOf(host, viewport, { preview })
    }

    const hit = hitAtPointer(session, viewport, client)
    const inertController =
      hit?.nativeType === 'teacher-controller' && host.getSession().scope !== 'global'
    if (hit?.coordinateSpace === 'viewport' && !inertController) {
      ensureGlobalScope(host)
      const command = applyCommand(host, (current) =>
        selectSpatialLayers(current, {
          layerItemIds: [hit.layerItemId],
          additive: pointer.additive === true,
        }, { expectedRevision: current.history.present.revision }),
      )
      const nextWritable = writableViewportTransforms(host.getSession())
      if (nextWritable.length > 0 && !hit.locked) {
        gesture = {
          type: 'viewport-move',
          startViewport: viewportPoint,
          nodes: nextWritable,
        }
        preview = nextWritable.map((node) => ({ ...node }))
      } else {
        gesture = null
        preview = null
      }
      return resultOf(host, viewport, { command, preview: preview ?? undefined, hit })
    }

    if (hit?.coordinateSpace === 'world' && hit.source === 'world') {
      ensureWorldScope(host)
      const command = applyCommand(host, (current) =>
        selectSpatialLayers(current, {
          layerItemIds: [hit.layerItemId],
          additive: pointer.additive === true,
        }, { expectedRevision: current.history.present.revision }),
      )
      const nextWritable = writableWorldTransforms(host.getSession())
      if (nextWritable.length > 0 && !hit.locked) {
        gesture = { type: 'move', startWorld: world, nodes: nextWritable }
        preview = nextWritable.map((node) => ({ ...node }))
      } else {
        gesture = null
        preview = null
      }
      return resultOf(host, viewport, { command, preview: preview ?? undefined, hit })
    }

    if (hit?.coordinateSpace === 'world') {
      gesture = null
      preview = null
      return resultOf(host, viewport, { hit })
    }

    const deferredOverlay = hitTestSpatialDeferredOverlays(session, viewport, world)
    if (pointer.additive === true) {
      gesture = { type: 'marquee', startWorld: world, additive: true }
      preview = null
      return resultOf(host, viewport, {
        marquee: marqueeRect(world, world),
        deferredOverlay,
      })
    }
    gesture = {
      type: 'pan',
      startClient: client,
      startCamera: session.sessionCamera,
    }
    preview = null
    previewCamera = session.sessionCamera
    return resultOf(host, viewport, {
      previewCamera,
      deferredOverlay,
      marquee: null,
    })
  }

  const pointerMove = (
    pointer: SpatialWorldAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldAuthoringResult => {
    const session = host.getSession()
    const client = { x: pointer.x, y: pointer.y }
    const world = pointerToSpatialWorld(
      client,
      viewport,
      previewCamera ?? session.sessionCamera,
    )
    const viewportPoint = pointerToSpatialViewport(client, viewport)
    if (!gesture) return resultOf(host, viewport)

    if (gesture.type === 'viewport-move') {
      preview = constrainTeacherControllerViewportTransforms(session, previewMove({
        type: 'move',
        startWorld: gesture.startViewport,
        nodes: gesture.nodes,
      }, viewportPoint))
      return resultOf(host, viewport, { preview })
    }
    if (gesture.type === 'viewport-resize') {
      preview = constrainTeacherControllerViewportTransforms(session, previewResize({
        type: 'resize',
        direction: gesture.direction,
        startWorld: gesture.startViewport,
        nodes: gesture.nodes,
      }, viewportPoint))
      return resultOf(host, viewport, { preview })
    }
    if (gesture.type === 'move') {
      preview = previewMove(gesture, world)
      return resultOf(host, viewport, { preview })
    }
    if (gesture.type === 'resize') {
      preview = previewResize(gesture, world)
      return resultOf(host, viewport, { preview })
    }
    if (gesture.type === 'rotate') {
      preview = previewRotate(gesture, world)
      return resultOf(host, viewport, { preview })
    }
    if (gesture.type === 'marquee') {
      return resultOf(host, viewport, { marquee: marqueeRect(gesture.startWorld, world) })
    }
    previewCamera = previewPanCamera(gesture, client)
    return resultOf(host, viewport, { previewCamera })
  }

  const pointerUp = (
    pointer: SpatialWorldAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldAuthoringResult => {
    const session = host.getSession()
    const client = { x: pointer.x, y: pointer.y }
    const world = pointerToSpatialWorld(client, viewport, session.sessionCamera)
    const active = gesture
    gesture = null

    if (!active) {
      preview = null
      previewCamera = null
      return resultOf(host, viewport)
    }

    if (active.type === 'marquee') {
      const rect = marqueeRect(active.startWorld, world)
      const moved = rect.width > MARQUEE_MIN_SIZE || rect.height > MARQUEE_MIN_SIZE
      const hits = moved ? marqueeHitV9SpatialWorldLayerItems(layerHits(session), rect) : []
      const command = applyCommand(host, (current) =>
        selectSpatialLayers(current, {
          layerItemIds: hits.filter((hit) => hit.source === 'world').map((hit) => hit.layerItemId),
          additive: active.additive,
        }, { expectedRevision: current.history.present.revision }),
      )
      preview = null
      return resultOf(host, viewport, { command, marquee: null })
    }

    if (active.type === 'pan') {
      const nextCamera = previewPanCamera(active, client)
      const dx = client.x - active.startClient.x
      const dy = client.y - active.startClient.y
      preview = null
      previewCamera = null
      if (Math.hypot(dx, dy) < PAN_MIN_SIZE) {
        const command = applyCommand(host, (current) =>
          selectSpatialLayers(current, { layerItemIds: [] }, {
            expectedRevision: current.history.present.revision,
          }),
        )
        return resultOf(host, viewport, { command, previewCamera: undefined })
      }
      const command = applyCommand(host, (current) =>
        panSpatialSessionCamera(current, {
          x: nextCamera.x - active.startCamera.x,
          y: nextCamera.y - active.startCamera.y,
        }),
      )
      return resultOf(host, viewport, { command, previewCamera: undefined })
    }

    if (active.type === 'viewport-move' || active.type === 'viewport-resize') {
      const viewportPoint = pointerToSpatialViewport(client, viewport)
      const rawNext = active.type === 'viewport-move'
        ? previewMove({
            type: 'move',
            startWorld: active.startViewport,
            nodes: active.nodes,
          }, viewportPoint)
        : previewResize({
            type: 'resize',
            direction: active.direction,
            startWorld: active.startViewport,
            nodes: active.nodes,
          }, viewportPoint)
      const next = constrainTeacherControllerViewportTransforms(session, rawNext)
      preview = null
      previewCamera = null
      const command = applyCommand(host, (current) =>
        transformSpatialViewportLayersInSession(current, { layers: next }, {
          expectedRevision: current.history.present.revision,
        }),
      )
      return resultOf(host, viewport, { command, preview: undefined })
    }

    const next = active.type === 'move'
      ? previewMove(active, world)
      : active.type === 'resize'
        ? previewResize(active, world)
        : previewRotate(active, world)
    preview = null
    previewCamera = null
    const command = applyCommand(host, (current) =>
      transformSpatialWorldLayersInSession(current, { layers: next }, {
        expectedRevision: current.history.present.revision,
      }),
    )
    return resultOf(host, viewport, { command, preview: undefined })
  }

  const pointerCancel = (
    _pointer: SpatialWorldAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldAuthoringResult => {
    gesture = null
    preview = null
    previewCamera = null
    return resultOf(host, viewport, { preview: undefined, previewCamera: undefined })
  }

  const doubleClick = (
    pointer: SpatialWorldAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldAuthoringResult => {
    const session = host.getSession()
    const client = { x: pointer.x, y: pointer.y }
    const world = pointerToSpatialWorld(client, viewport, session.sessionCamera)
    const hit = hitAtPointer(session, viewport, client)
    if (hit && isEditableTextOrFormula(hit) && hit.source === 'world') {
      ensureWorldScope(host)
      applyCommand(host, (current) =>
        selectSpatialLayers(current, { layerItemIds: [hit.layerItemId] }, {
          expectedRevision: current.history.present.revision,
        }),
      )
      const contentEdit = beginSpatialWorldContentEdit({
        session: host.getSession(),
        layerItemId: hit.layerItemId,
        source: 'canvas',
      })
      return resultOf(host, viewport, { hit, contentEdit })
    }
    return resultOf(host, viewport, {
      hit,
      deferredOverlay: hit ? null : hitTestSpatialDeferredOverlays(session, viewport, world),
      contentEdit: {
        ok: false,
        reason: SPATIAL_CONTENT_REJECT_INVALID_TARGET,
      },
    })
  }

  const transformSelection = (
    layers: readonly SpatialEditorWorldTransform[],
    viewport: StageRect,
  ): SpatialWorldAuthoringResult => {
    const command = applyCommand(host, (session) =>
      transformSpatialWorldLayersInSession(session, { layers }, {
        expectedRevision: session.history.present.revision,
      }),
    )
    return resultOf(host, viewport, { command })
  }

  const zoomSession = (zoom: number, viewport: StageRect): SpatialWorldAuthoringResult => {
    const command = applyCommand(host, (session) => zoomSpatialSessionCamera(session, zoom))
    return resultOf(host, viewport, { command })
  }

  const insertWorldText = (
    input: AddSpatialWorldTextLayerInput,
    viewport: StageRect,
    options: SpatialCommandOptions = {},
  ): SpatialWorldAuthoringResult => {
    ensureWorldScope(host)
    const command = applyCommand(host, (session) => addSpatialWorldTextLayer(session, input, options))
    return resultOf(host, viewport, { command })
  }

  const insertWorldImage = (
    input: AddSpatialWorldImageLayerInput,
    viewport: StageRect,
    options: SpatialCommandOptions = {},
  ): SpatialWorldAuthoringResult => {
    ensureWorldScope(host)
    const command = applyCommand(host, (session) => addSpatialWorldImageLayer(session, input, options))
    return resultOf(host, viewport, { command })
  }

  const insertWorldVideo = (
    input: AddSpatialWorldVideoLayerInput,
    viewport: StageRect,
    options: SpatialCommandOptions = {},
  ): SpatialWorldAuthoringResult => {
    ensureWorldScope(host)
    const command = applyCommand(host, (session) => addSpatialWorldVideoLayer(session, input, options))
    return resultOf(host, viewport, { command })
  }

  const insertWorldComponent = (
    input: AddSpatialWorldComponentLayerInput,
    viewport: StageRect,
    options: SpatialCommandOptions = {},
  ): SpatialWorldAuthoringResult => {
    ensureWorldScope(host)
    const command = applyCommand(host, (session) => addSpatialWorldComponentLayer(session, input, options))
    return resultOf(host, viewport, { command })
  }

  const insertWorldRuntime = (
    input: AddSpatialWorldRuntimeLayerInput,
    viewport: StageRect,
    options: SpatialCommandOptions = {},
  ): SpatialWorldAuthoringResult => {
    ensureWorldScope(host)
    const command = applyCommand(host, (session) => addSpatialWorldRuntimeLayer(session, input, options))
    return resultOf(host, viewport, { command })
  }

  const insertWorldFormula = (
    input: AddSpatialWorldLayerInput,
    viewport: StageRect,
    options: SpatialCommandOptions = {},
  ): SpatialWorldAuthoringResult => {
    ensureWorldScope(host)
    const command = applyCommand(host, (session) => addSpatialWorldFormulaLayer(session, input, options))
    return resultOf(host, viewport, { command })
  }

  return {
    overlayGeometry,
    viewportOverlayGeometry,
    worldTransform: (viewport: StageRect) =>
      createSpatialWorldViewTransform(viewport, host.getSession().sessionCamera),
    viewportTransform: (viewport: StageRect) => createSpatialViewportOverlayTransform(viewport),
    currentTargets: () => makeTargets(host.getSession()),
    selectFromLayerIds,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    doubleClick,
    transformSelection,
    zoomSession,
    insertWorldText,
    insertWorldFormula,
    insertWorldImage,
    insertWorldVideo,
    insertWorldComponent,
    insertWorldRuntime,
    previewTransforms: () => preview,
    previewSessionCamera: () => previewCamera,
  }
}

export function listSpatialWorldHitTargets(session: SpatialAuthoringSession): V9SpatialHitTarget[] {
  return authoringLayerHits(session)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export interface SpatialWorldContentEditSession {
  readonly kind: SpatialWorldContentEditKind
  readonly source: SpatialWorldContentEditSource
  readonly target: SpatialAuthoringTarget
  readonly composing: boolean
  readonly pendingAction: Exclude<SpatialWorldContentEditAction, 'ignore' | 'defer'> | null
  readonly original: V9SlideTextContentSnapshot | V9SlideFormulaContentSnapshot
  readonly draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft
}

export type BeginSpatialWorldContentEditResult = {
  readonly ok: true
  readonly edit: SpatialWorldContentEditSession
} | {
  readonly ok: false
  readonly reason: string
}

function freezeEdit(edit: SpatialWorldContentEditSession): SpatialWorldContentEditSession {
  return Object.freeze({
    ...edit,
    target: edit.target,
    original: Object.freeze(structuredClone(edit.original)),
    draft: Object.freeze(structuredClone(edit.draft)),
  })
}

function rejectSession(session: SpatialAuthoringSession, reason: string): SpatialCommandResult {
  return {
    ok: false,
    reason,
    nextSession: session,
    historyEntry: false,
    selection: session.selection,
  }
}

function succeedIdentity(session: SpatialAuthoringSession): SpatialCommandResult {
  return {
    ok: true,
    nextSession: session,
    historyEntry: false,
    selection: session.selection,
  }
}

function nativeItem(
  layer: { item: { kind: string; content?: { nativeType: string } } },
): layer is { item: NativeLayerItem } {
  return layer.item.kind === 'native'
}

function readContentSnapshot(
  item: NativeLayerItem,
): V9SlideTextContentSnapshot | V9SlideFormulaContentSnapshot {
  if (item.content.nativeType === 'text') {
    return {
      text: item.content.data.text,
      runs: structuredClone(item.content.data.runs),
      width: item.frame.width,
      height: item.frame.height,
      writingMode: item.content.data.style.writingMode,
      overflow: item.content.data.style.overflow,
    }
  }
  if (item.content.nativeType === 'formula') {
    return {
      ast: structuredClone(item.content.data.ast),
      accessibleText: item.content.data.accessibleText,
      formulaId: item.content.data.formulaId,
    }
  }
  throw new SpatialCommandError(SPATIAL_CONTENT_REJECT_INVALID_TARGET, '当前元素不是文字或公式')
}

function locateEditableWorldNative(
  session: SpatialAuthoringSession,
  layerItemId: string,
): { ok: true; item: NativeLayerItem } | { ok: false; reason: string } {
  if (session.scope !== 'world') {
    return { ok: false, reason: SPATIAL_REJECT_WRONG_OWNER }
  }
  const view = editorView(session)
  const layer = view.layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer) return { ok: false, reason: SPATIAL_CONTENT_REJECT_INVALID_TARGET }
  if (layer.source !== 'world' || layer.coordinateSpace !== 'world') {
    return { ok: false, reason: SPATIAL_REJECT_WRONG_OWNER }
  }
  if (!nativeItem(layer)) return { ok: false, reason: SPATIAL_CONTENT_REJECT_INVALID_TARGET }
  const item = layer.item as NativeLayerItem
  if (item.content.nativeType !== 'text' && item.content.nativeType !== 'formula') {
    return { ok: false, reason: SPATIAL_CONTENT_REJECT_INVALID_TARGET }
  }
  if (item.locked) return { ok: false, reason: SPATIAL_REJECT_LOCKED }
  return { ok: true, item }
}

export function beginSpatialWorldContentEdit(input: {
  readonly session: SpatialAuthoringSession
  readonly layerItemId: string
  readonly source?: SpatialWorldContentEditSource
}): BeginSpatialWorldContentEditResult {
  const located = locateEditableWorldNative(input.session, input.layerItemId)
  if (!located.ok) return located
  const kind: SpatialWorldContentEditKind = located.item.content.nativeType === 'formula'
    ? 'formula'
    : 'text'
  const original = readContentSnapshot(located.item)
  const draft: V9SlideTextContentDraft | V9SlideFormulaContentDraft = kind === 'text'
    ? {
        text: (original as V9SlideTextContentSnapshot).text,
        runs: structuredClone((original as V9SlideTextContentSnapshot).runs),
      }
    : {
        ast: structuredClone((original as V9SlideFormulaContentSnapshot).ast),
        accessibleText: (original as V9SlideFormulaContentSnapshot).accessibleText,
      }
  return {
    ok: true,
    edit: freezeEdit({
      kind,
      source: input.source ?? 'canvas',
      target: makeSpatialAuthoringTarget(input.session, input.layerItemId),
      composing: false,
      pendingAction: null,
      original,
      draft,
    }),
  }
}

export function updateSpatialWorldContentTextDraft(
  edit: SpatialWorldContentEditSession,
  draft: V9SlideTextContentDraft,
): SpatialWorldContentEditSession {
  if (edit.kind !== 'text') return edit
  const previous = edit.draft as V9SlideTextContentDraft
  const runs = draft.runs ?? remapTextRuns(previous.text, draft.text, previous.runs)
  return freezeEdit({
    ...edit,
    draft: {
      text: draft.text,
      runs,
      ...(draft.width !== undefined ? { width: draft.width } : {}),
      ...(draft.height !== undefined ? { height: draft.height } : {}),
    },
  })
}

export function updateSpatialWorldContentFormulaDraft(
  edit: SpatialWorldContentEditSession,
  draft: V9SlideFormulaContentDraft,
): SpatialWorldContentEditSession {
  if (edit.kind !== 'formula') return edit
  return freezeEdit({
    ...edit,
    draft: {
      ast: structuredClone(draft.ast),
      accessibleText: draft.accessibleText ?? formulaAstToAccessibleText(draft.ast),
    },
  })
}

export function applySpatialWorldContentEditRunStyle(
  edit: SpatialWorldContentEditSession,
  selectionStart: number,
  selectionEnd: number,
  patch: TextRunStyle,
): SpatialWorldContentEditSession {
  if (edit.kind !== 'text') return edit
  const draft = edit.draft as V9SlideTextContentDraft
  return freezeEdit({
    ...edit,
    draft: {
      ...draft,
      runs: applyTextRunStyle(draft.text, draft.runs, selectionStart, selectionEnd, patch),
    },
  })
}

export function markSpatialWorldContentComposing(
  edit: SpatialWorldContentEditSession,
  composing: boolean,
): SpatialWorldContentEditSession {
  if (edit.composing === composing) return edit
  return freezeEdit({
    ...edit,
    composing,
    pendingAction: composing ? edit.pendingAction : null,
  })
}

function textDraftChanged(
  original: V9SlideTextContentSnapshot,
  draft: V9SlideTextContentDraft,
): boolean {
  if (draft.text !== original.text) return true
  if (!sameJson(draft.runs, original.runs)) return true
  if (draft.width !== undefined && draft.width !== original.width) return true
  if (draft.height !== undefined && draft.height !== original.height) return true
  return false
}

function formulaDraftChanged(
  original: V9SlideFormulaContentSnapshot,
  draft: V9SlideFormulaContentDraft,
): boolean {
  const accessibleText = draft.accessibleText ?? formulaAstToAccessibleText(draft.ast)
  return !sameJson(draft.ast, original.ast) || accessibleText !== original.accessibleText
}

function rejectIfStaleEdit(
  session: SpatialAuthoringSession,
  edit: SpatialWorldContentEditSession,
  options: SpatialCommandOptions & { expectedGeneration?: number },
): SpatialCommandResult | null {
  const liveGeneration = spatialAuthoringGeneration(session.sessionId)
  const expectedGeneration = options.expectedGeneration ?? edit.target.generation
  if (
    expectedGeneration !== session.generation ||
    expectedGeneration !== liveGeneration ||
    edit.target.sessionId !== session.sessionId
  ) {
    return rejectSession(session, SPATIAL_CONTENT_REJECT_STALE_GENERATION)
  }
  if (
    (options.expectedRevision ?? edit.target.revision) !== session.history.present.revision
  ) {
    return rejectSession(session, SPATIAL_REJECT_STALE_REVISION)
  }
  return null
}

function writeWorldNativeContent(
  session: SpatialAuthoringSession,
  layerItemId: string,
  patch: Record<string, unknown>,
  frame?: { width?: number; height?: number },
  now?: string,
) {
  return commitSpatialProjectMutation(session.history.present, (draft) => {
    const surface = spatialSurfaceIn(draft, session.selection.surfaceId)
    const item = surface.world.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
    if (!item || item.kind !== 'native') {
      throw new SpatialCommandError(SPATIAL_CONTENT_REJECT_INVALID_TARGET, '所选元素已失效，请重新选择')
    }
    if (item.locked) {
      throw new SpatialCommandError(SPATIAL_REJECT_LOCKED, '当前元素已锁定')
    }
    const data = item.content.data as unknown as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      data[key] = structuredClone(value)
    }
    if (frame?.width !== undefined) item.frame.width = frame.width
    if (frame?.height !== undefined) item.frame.height = frame.height
  }, now)
}

export function commitSpatialWorldContentEdit(
  session: SpatialAuthoringSession,
  edit: SpatialWorldContentEditSession,
  options: SpatialCommandOptions & { expectedGeneration?: number } = {},
): SpatialCommandResult {
  if (edit.composing) return rejectSession(session, SPATIAL_CONTENT_REJECT_COMPOSING)
  const stale = rejectIfStaleEdit(session, edit, options)
  if (stale) return stale
  const located = locateEditableWorldNative(session, edit.target.layerItemId)
  if (!located.ok) return rejectSession(session, located.reason)
  if (located.item.content.nativeType !== edit.kind) {
    return rejectSession(session, SPATIAL_CONTENT_REJECT_INVALID_TARGET)
  }
  try {
    if (edit.kind === 'text') {
      const original = edit.original as V9SlideTextContentSnapshot
      const draft = edit.draft as V9SlideTextContentDraft
      if (!textDraftChanged(original, draft)) return succeedIdentity(session)
      const next = writeWorldNativeContent(session, edit.target.layerItemId, {
        text: draft.text,
        runs: draft.runs,
      }, { width: draft.width, height: draft.height }, options.now)
      const nextSession = replaceSpatialSession(session, {
        history: commitSpatialAuthoringHistory(session.history, next),
      })
      return {
        ok: true,
        nextSession,
        historyEntry: true,
        selection: nextSession.selection,
      }
    }
    const original = edit.original as V9SlideFormulaContentSnapshot
    const draft = edit.draft as V9SlideFormulaContentDraft
    if (!formulaDraftChanged(original, draft)) return succeedIdentity(session)
    const accessibleText = draft.accessibleText ?? formulaAstToAccessibleText(draft.ast)
    const next = writeWorldNativeContent(session, edit.target.layerItemId, {
      ast: draft.ast,
      accessibleText,
    }, undefined, options.now)
    const nextSession = replaceSpatialSession(session, {
      history: commitSpatialAuthoringHistory(session.history, next),
    })
    return {
      ok: true,
      nextSession,
      historyEntry: true,
      selection: nextSession.selection,
    }
  } catch (error) {
    if (error instanceof SpatialCommandError) return rejectSession(session, error.reason)
    if (error instanceof Error) return rejectSession(session, error.message)
    return rejectSession(session, '命令失败')
  }
}

export function commitSpatialWorldTextRunStyle(
  session: SpatialAuthoringSession,
  input: {
    readonly layerItemId: string
    readonly selectionStart: number
    readonly selectionEnd: number
    readonly patch: TextRunStyle
    readonly source?: SpatialWorldContentEditSource
  },
  options: SpatialCommandOptions = {},
): SpatialCommandResult {
  const begun = beginSpatialWorldContentEdit({
    session,
    layerItemId: input.layerItemId,
    source: input.source ?? 'properties',
  })
  if (!begun.ok) return rejectSession(session, begun.reason)
  const edited = applySpatialWorldContentEditRunStyle(
    begun.edit,
    input.selectionStart,
    input.selectionEnd,
    input.patch,
  )
  return commitSpatialWorldContentEdit(session, edited, options)
}

export function readSpatialWorldNativeContent(
  session: SpatialAuthoringSession,
  layerItemId: string,
): NativeLayerItem | null {
  const layer = editorView(session).layers.find((candidate) => candidate.selectionId === layerItemId)
  if (!layer || layer.item.kind !== 'native') return null
  return layer.item as NativeLayerItem
}

export type {
  FormulaAstNode,
  TextOverflowMode,
  TextRun,
  WritingMode,
  V9SlideTextContentDraft,
  V9SlideFormulaContentDraft,
}
