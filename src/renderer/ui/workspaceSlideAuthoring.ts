import type { LayerItem } from '../../shared/courseProjectTypes'
import { MIN_NODE_SIZE } from '../../shared/constants'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import {
  collectLineSnapAxes,
  dragLineHandleGeometry,
  lineHandleWorldPoints,
  snapLinePoint,
  type LineHandleKind,
  type LineSnapResult,
} from '../authoring/slideLineAuthoring'
import {
  clientToWorld,
  createStageViewportTransform,
  resizeWorldFrameFromHandle,
  resizeWorldFrameFromHandlePreservingAspect,
  stageResizeHandleWorldPoint,
  stageRotateHandleWorldPoint,
  stageSelectionOverlayGeometry,
  worldRectCenter,
  type StagePoint,
  type StageRect,
  type StageResizeHandleDirection,
  type StageSelectionOverlayGeometry,
  type StageViewportTransform,
  type StageViewportTransformOptions,
} from '../authoring/stageViewportTransform'
import {
  executeSlideAuthoringCommand,
  SLIDE_BACKEND_NOT_CANDIDATE,
} from '../store/slideBackendPort'
import {
  buildSlideEditorView,
  type SlideAuthoringTarget,
  type SlideAuthoringBackend,
  type SlideCommandResult,
} from '../course/slideAuthoringBackend'
import type { SlideEditorNodeTransform } from '../course/slideEditorCommands'
import { updateSlideShapeLineGeometry } from '../course/v9SlideContentCommands'
import {
  adaptV9SlideLayerItemHit,
  hitTestV9SlideLayerItems,
  marqueeHitV9SlideLayerItems,
  type V9SlideHitTarget,
} from '../phaser/v9SlideHitAdapter'
const MARQUEE_MIN_SIZE = 3
const HANDLE_HIT_RADIUS = 10

export type SlideWorkspaceBackendKind = 'slide-authoring' | 'unavailable'

export interface SlideAuthoringPointer {
  readonly x: number
  readonly y: number
  /** Client CSS pixels unless `space` is `'world'` (Phaser pointer.worldX/Y). */
  readonly space?: 'client' | 'world'
  readonly additive?: boolean
  /** Alt temporarily disables snapping for line gestures. */
  readonly altKey?: boolean
}

export type SlideWorkspaceAuthoringResult =
  | {
      readonly kind: 'unavailable'
      readonly reason: typeof SLIDE_BACKEND_NOT_CANDIDATE
    }
  | {
      readonly kind: 'slide-authoring'
      readonly command?: SlideCommandResult
      readonly preview?: readonly SlideEditorNodeTransform[]
      readonly overlay?: StageSelectionOverlayGeometry | null
      readonly targets?: readonly SlideAuthoringTarget[]
      readonly marquee?: StageRect | null
      readonly hit?: V9SlideHitTarget | null
      /** Live line handle drag paint; geometry follows the pointer without history. */
      readonly linePreview?: SlideLinePreview | null
      /** Active snap guide axes (world coordinates) for the current gesture. */
      readonly guides?: { readonly x?: number; readonly y?: number } | null
    }

export interface SlideLinePreview {
  readonly nodeId: string
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly lineGeometry: NativeLineGeometry
}

export interface SlideWorkspaceCommandPort {
  run(run: (backend: SlideAuthoringBackend) => SlideCommandResult): SlideCommandResult
  afterSelectLayers?(command: SlideCommandResult): void
}

export interface SlideWorkspaceAuthoringPorts {
  readonly getBackend: () => SlideAuthoringBackend | null
  readonly commandPort: SlideWorkspaceCommandPort
}

interface MoveGesture {
  readonly type: 'move'
  readonly startWorld: StagePoint
  readonly nodes: readonly SlideEditorNodeTransform[]
}

interface ResizeGesture {
  readonly type: 'resize'
  readonly direction: StageResizeHandleDirection
  readonly startWorld: StagePoint
  readonly nodes: readonly SlideEditorNodeTransform[]
}

interface RotateGesture {
  readonly type: 'rotate'
  readonly center: StagePoint
  readonly startAngle: number
  readonly nodes: readonly SlideEditorNodeTransform[]
}

interface MarqueeGesture {
  readonly type: 'marquee'
  readonly startWorld: StagePoint
  readonly additive: boolean
}

interface LineEndpointGesture {
  readonly type: 'line-endpoint'
  readonly nodeId: string
  readonly handle: LineHandleKind
  readonly shapeType: 'line' | 'elbow-arrow'
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly rotation: number
  readonly lineGeometry?: NativeLineGeometry
}

type SlideAuthoringGesture = MoveGesture | ResizeGesture | RotateGesture | MarqueeGesture | LineEndpointGesture

const UNAVAILABLE_RESULT: SlideWorkspaceAuthoringResult = {
  kind: 'unavailable',
  reason: SLIDE_BACKEND_NOT_CANDIDATE,
}

const MISSING_BACKEND_COMMAND: SlideCommandResult = {
  ok: false,
  reason: SLIDE_BACKEND_NOT_CANDIDATE,
  historyEntry: false,
}

function viewportTransform(
  options: StageViewportTransformOptions,
): StageViewportTransform {
  return createStageViewportTransform(options)
}

function pointerToWorld(
  pointer: SlideAuthoringPointer,
  options: StageViewportTransformOptions,
): StagePoint {
  if (pointer.space === 'world') return { x: pointer.x, y: pointer.y }
  return clientToWorld(viewportTransform(options), { x: pointer.x, y: pointer.y })
}

function layerTargets(backend: SlideAuthoringBackend): V9SlideHitTarget[] {
  const session = backend.getSession()
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  return view.layers.flatMap((layer) => {
    if (layer.source !== session.scope) return []
    return [adaptV9SlideLayerItemHit(
      layer.item as LayerItem,
      layer.effectiveVisible,
      session.scope,
    )]
  })
}

function nativeFrames(backend: SlideAuthoringBackend): Map<string, SlideEditorNodeTransform> {
  const session = backend.getSession()
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const frames = new Map<string, SlideEditorNodeTransform>()
  for (const layer of view.layers) {
    if (layer.source !== session.scope) continue
    if (layer.item.kind === 'native' && layer.item.content.nativeType === 'teacher-controller') continue
    if (
      layer.item.kind !== 'native' &&
      layer.item.kind !== 'component' &&
      layer.item.kind !== 'runtime'
    ) continue
    frames.set(layer.selectionId, {
      nodeId: layer.selectionId,
      x: layer.item.frame.x,
      y: layer.item.frame.y,
      width: layer.item.frame.width,
      height: layer.item.frame.height,
      rotation: layer.item.rotation,
    })
  }
  return frames
}

function writableNativeTransforms(
  backend: SlideAuthoringBackend,
): SlideEditorNodeTransform[] {
  const session = backend.getSession()
  const frames = nativeFrames(backend)
  const hits = new Map(layerTargets(backend).map((target) => [target.layerItemId, target]))
  return session.selection.selectionIds.flatMap((id) => {
    const frame = frames.get(id)
    const hit = hits.get(id)
    if (!frame || !hit || hit.locked || !hit.writable) return []
    return [frame]
  })
}

function makeTargets(backend: SlideAuthoringBackend): SlideAuthoringTarget[] {
  // Canvas selection/transform targets identify the whole layer item. Field-specific
  // content editors create their own targets, while Nodes/Properties project `item`.
  return backend.getSnapshot().selection.selectionIds.map((layerItemId) =>
    backend.makeTarget(layerItemId, 'item'),
  )
}

function overlayForSelection(
  backend: SlideAuthoringBackend,
  options: StageViewportTransformOptions,
  preview?: readonly SlideEditorNodeTransform[],
): StageSelectionOverlayGeometry | null {
  const session = backend.getSession()
  const previewById = new Map((preview ?? []).map((node) => [node.nodeId, node]))
  const hits = new Map(layerTargets(backend).map((target) => [target.layerItemId, target]))
  const items = session.selection.selectionIds.flatMap((id) => {
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
    const hit = hits.get(id)
    if (!hit) return []
    return [{
      x: hit.bounds.x,
      y: hit.bounds.y,
      width: hit.bounds.width,
      height: hit.bounds.height,
      rotation: hit.bounds.rotation,
    }]
  })
  return stageSelectionOverlayGeometry(viewportTransform(options), items)
}

function v9Result(
  backend: SlideAuthoringBackend,
  options: StageViewportTransformOptions,
  extra: Omit<Extract<SlideWorkspaceAuthoringResult, { kind: 'slide-authoring' }>, 'kind' | 'overlay' | 'targets'> = {},
): SlideWorkspaceAuthoringResult {
  return {
    kind: 'slide-authoring',
    overlay: overlayForSelection(backend, options, extra.preview),
    targets: makeTargets(backend),
    ...extra,
  }
}

function angleOf(point: StagePoint, center: StagePoint): number {
  return Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI
}

function previewMove(
  gesture: MoveGesture,
  world: StagePoint,
): SlideEditorNodeTransform[] {
  const dx = world.x - gesture.startWorld.x
  const dy = world.y - gesture.startWorld.y
  return gesture.nodes.map((node) => ({
    ...node,
    x: node.x + dx,
    y: node.y + dy,
  }))
}

function nativeLayerLocksAspect(
  backend: SlideAuthoringBackend,
  nodeId: string,
): boolean {
  const session = backend.getSession()
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((item) => item.selectionId === nodeId)
  if (!layer || layer.item.kind !== 'native') return false
  if (layer.item.content.nativeType === 'image') {
    return layer.item.content.data.preserveAspectRatio
  }
  return layer.item.content.nativeType === 'video'
}

function previewResize(
  gesture: ResizeGesture,
  world: StagePoint,
  backend: SlideAuthoringBackend,
): SlideEditorNodeTransform[] {
  if (gesture.nodes.length === 1) {
    const start = gesture.nodes[0]!
    const resize = nativeLayerLocksAspect(backend, start.nodeId)
      ? resizeWorldFrameFromHandlePreservingAspect
      : resizeWorldFrameFromHandle
    const next = resize(
      start,
      gesture.direction,
      world,
      MIN_NODE_SIZE,
    )
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
): SlideEditorNodeTransform[] {
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

interface SelectedLineShape {
  readonly nodeId: string
  readonly shapeType: 'line' | 'elbow-arrow'
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  readonly rotation: number
  readonly lineGeometry?: NativeLineGeometry
}

function selectedLineShape(backend: SlideAuthoringBackend): SelectedLineShape | null {
  const session = backend.getSession()
  if (session.selection.selectionIds.length !== 1) return null
  const nodeId = session.selection.selectionIds[0]!
  const view = buildSlideEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
    stateId: session.selection.stateId,
  })
  const layer = view.layers.find((candidate) => (
    candidate.selectionId === nodeId && candidate.source === session.scope
  ))
  if (!layer || !layer.effectiveVisible || layer.item.locked) return null
  if (layer.item.kind !== 'native' || layer.item.content.nativeType !== 'shape') return null
  const data = layer.item.content.data as {
    shapeType?: unknown
    lineGeometry?: NativeLineGeometry
  }
  if (data.shapeType !== 'line' && data.shapeType !== 'elbow-arrow') return null
  return {
    nodeId,
    shapeType: data.shapeType,
    frame: { ...layer.item.frame },
    rotation: layer.item.rotation,
    lineGeometry: data.lineGeometry,
  }
}

function hitHandle(
  backend: SlideAuthoringBackend,
  world: StagePoint,
): { kind: 'resize'; direction: StageResizeHandleDirection } | { kind: 'rotate' } | { kind: 'line-endpoint'; line: SelectedLineShape; handle: LineHandleKind } | null {
  const line = selectedLineShape(backend)
  if (line) {
    const points = lineHandleWorldPoints(line.frame, line.rotation, line.lineGeometry, line.shapeType)
    for (const [handle, point] of [
      ['start', points.start],
      ['end', points.end],
      ...(points.elbow ? [['elbow', points.elbow] as const] : []),
    ] as Array<readonly [LineHandleKind, StagePoint]>) {
      if (Math.hypot(world.x - point.x, world.y - point.y) <= HANDLE_HIT_RADIUS) {
        return { kind: 'line-endpoint', line, handle }
      }
    }
  }
  const session = backend.getSession()
  const hits = new Map(layerTargets(backend).map((target) => [target.layerItemId, target]))
  const selected = session.selection.selectionIds.map((id) => hits.get(id)).filter(
    (target): target is V9SlideHitTarget => Boolean(target),
  )
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
  for (const direction of [
    'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w',
  ] as const) {
    const point = stageResizeHandleWorldPoint(box, direction, rotation)
    if (Math.hypot(world.x - point.x, world.y - point.y) <= HANDLE_HIT_RADIUS) {
      return { kind: 'resize', direction }
    }
  }
  return null
}

function marqueeRect(start: StagePoint, world: StagePoint): StageRect {
  const x = Math.min(start.x, world.x)
  const y = Math.min(start.y, world.y)
  return {
    x,
    y,
    width: Math.abs(world.x - start.x),
    height: Math.abs(world.y - start.y),
  }
}

/**
 * Slide canvas hit / selection / transform kernel.
 * Callers inject the live V9 backend and command port; there is no Store or V8 path.
 * Each controller receives its own live ports without importing Store.
 */
export function createSlideWorkspaceAuthoringController(
  ports: SlideWorkspaceAuthoringPorts,
) {
  let gesture: SlideAuthoringGesture | null = null
  let preview: SlideEditorNodeTransform[] | null = null
  let linePreview: SlideLinePreview | null = null
  let lineGuides: { readonly x?: number; readonly y?: number } | null = null

  const readBackend = (): SlideAuthoringBackend | null => ports.getBackend()

  const runCommand = (
    run: (backend: SlideAuthoringBackend) => SlideCommandResult,
  ): SlideCommandResult => {
    const backend = readBackend()
    if (!backend) return MISSING_BACKEND_COMMAND
    return ports.commandPort.run((current) => run(current))
  }

  const resolveKind = (): SlideWorkspaceBackendKind =>
    readBackend() ? 'slide-authoring' : 'unavailable'

  const currentTargets = (): SlideAuthoringTarget[] => {
    const backend = readBackend()
    return backend ? makeTargets(backend) : []
  }

  const overlayGeometry = (
    options: StageViewportTransformOptions,
  ): StageSelectionOverlayGeometry | null => {
    const backend = readBackend()
    return backend ? overlayForSelection(backend, options, preview ?? undefined) : null
  }

  const clearLineDrag = (): void => {
    linePreview = null
    lineGuides = null
  }

  /**
   * Shared line handle math: the pointer is snapped (unless Alt) against stage
   * edges, center lines and other visible unlocked layers, then frame and
   * normalized geometry are recomputed. Degenerate results keep the last
   * valid preview and must never be committed.
   */
  const computeLineDrag = (
    active: LineEndpointGesture,
    pointer: SlideAuthoringPointer,
    options: StageViewportTransformOptions,
    backend: SlideAuthoringBackend,
  ): { authored: SlideLinePreview | null; snap: LineSnapResult } => {
    const world = pointerToWorld(pointer, options)
    const scale = viewportTransform(options).scale
    const snap = snapLinePoint(
      world,
      collectLineSnapAxes(layerTargets(backend), active.nodeId),
      scale,
      pointer.altKey === true,
    )
    const authored = dragLineHandleGeometry({
      shapeType: active.shapeType,
      frame: active.frame,
      rotation: active.rotation,
      lineGeometry: active.lineGeometry,
      handle: active.handle,
      world: snap.point,
    })
    return {
      authored: authored
        ? { nodeId: active.nodeId, frame: authored.frame, lineGeometry: authored.lineGeometry }
        : null,
      snap,
    }
  }

  const selectFromLayerIds = (
    layerItemIds: readonly string[],
    options: StageViewportTransformOptions,
    additive = false,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readBackend()
    if (!backend) return UNAVAILABLE_RESULT
    const command = runCommand((current) =>
      current.selectLayers(layerItemIds, additive, {
        expectedRevision: current.getSnapshot().revision,
      }),
    )
    ports.commandPort.afterSelectLayers?.(command)
    gesture = null
    preview = null
    clearLineDrag()
    const next = readBackend() ?? backend
    return v9Result(next, options, { command })
  }

  const pointerDown = (
    pointer: SlideAuthoringPointer,
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readBackend()
    if (!backend) return UNAVAILABLE_RESULT
    const world = pointerToWorld(pointer, options)
    const handle = hitHandle(backend, world)
    const writable = writableNativeTransforms(backend)

    if (handle?.kind === 'line-endpoint') {
      gesture = {
        type: 'line-endpoint',
        nodeId: handle.line.nodeId,
        handle: handle.handle,
        shapeType: handle.line.shapeType,
        frame: handle.line.frame,
        rotation: handle.line.rotation,
        lineGeometry: handle.line.lineGeometry,
      }
      preview = null
      clearLineDrag()
      return v9Result(backend, options, { linePreview: null, guides: null })
    }
    if (handle?.kind === 'resize' && writable.length > 0) {
      gesture = {
        type: 'resize',
        direction: handle.direction,
        startWorld: world,
        nodes: writable,
      }
      preview = writable.map((node) => ({ ...node }))
      return v9Result(backend, options, { preview })
    }
    if (handle?.kind === 'rotate' && writable.length > 0) {
      const left = Math.min(...writable.map((node) => node.x))
      const top = Math.min(...writable.map((node) => node.y))
      const right = Math.max(...writable.map((node) => node.x + node.width))
      const bottom = Math.max(...writable.map((node) => node.y + node.height))
      const center = {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
      }
      gesture = {
        type: 'rotate',
        center,
        startAngle: angleOf(world, center),
        nodes: writable,
      }
      preview = writable.map((node) => ({ ...node }))
      return v9Result(backend, options, { preview })
    }

    const hit = hitTestV9SlideLayerItems(
      layerTargets(backend),
      world,
      viewportTransform(options).scale,
    )
    if (hit) {
      const command = runCommand((current) =>
        current.selectLayers([hit.layerItemId], pointer.additive === true, {
          expectedRevision: current.getSnapshot().revision,
        }),
      )
      ports.commandPort.afterSelectLayers?.(command)
      const live = readBackend() ?? backend
      const nextWritable = writableNativeTransforms(live)
      if (nextWritable.length > 0 && !hit.locked) {
        gesture = {
          type: 'move',
          startWorld: world,
          nodes: nextWritable,
        }
        preview = nextWritable.map((node) => ({ ...node }))
      } else {
        gesture = null
        preview = null
      }
      return v9Result(live, options, { command, preview: preview ?? undefined, hit })
    }

    gesture = {
      type: 'marquee',
      startWorld: world,
      additive: pointer.additive === true,
    }
    preview = null
    return v9Result(backend, options, { marquee: marqueeRect(world, world) })
  }

  const pointerMove = (
    pointer: SlideAuthoringPointer,
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readBackend()
    if (!backend) return UNAVAILABLE_RESULT
    const world = pointerToWorld(pointer, options)
    if (!gesture) return v9Result(backend, options)

    if (gesture.type === 'line-endpoint') {
      const { authored, snap } = computeLineDrag(gesture, pointer, options, backend)
      if (authored) linePreview = authored
      lineGuides = snap.guideX !== undefined || snap.guideY !== undefined
        ? { x: snap.guideX, y: snap.guideY }
        : null
      return v9Result(backend, options, { linePreview, guides: lineGuides })
    }
    if (gesture.type === 'move') {
      preview = previewMove(gesture, world)
      return v9Result(backend, options, { preview })
    }
    if (gesture.type === 'resize') {
      preview = previewResize(gesture, world, backend)
      return v9Result(backend, options, { preview })
    }
    if (gesture.type === 'rotate') {
      preview = previewRotate(gesture, world)
      return v9Result(backend, options, { preview })
    }
    return v9Result(backend, options, { marquee: marqueeRect(gesture.startWorld, world) })
  }

  const pointerUp = (
    pointer: SlideAuthoringPointer,
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readBackend()
    if (!backend) return UNAVAILABLE_RESULT
    const world = pointerToWorld(pointer, options)
    const active = gesture
    gesture = null

    if (!active) {
      preview = null
      return v9Result(backend, options)
    }

    if (active.type === 'marquee') {
      const rect = marqueeRect(active.startWorld, world)
      const moved = rect.width > MARQUEE_MIN_SIZE || rect.height > MARQUEE_MIN_SIZE
      const hits = moved
        ? marqueeHitV9SlideLayerItems(layerTargets(backend), rect)
        : []
      const command = runCommand((current) =>
        current.selectLayers(
          hits.map((item) => item.layerItemId),
          active.additive,
          { expectedRevision: current.getSnapshot().revision },
        ),
      )
      ports.commandPort.afterSelectLayers?.(command)
      preview = null
      return v9Result(readBackend() ?? backend, options, { command, marquee: null })
    }

    if (active.type === 'line-endpoint') {
      const { authored } = computeLineDrag(active, pointer, options, backend)
      clearLineDrag()
      preview = null
      if (!authored) {
        // Degenerate geometry (collapsed endpoints) is rejected: zero history.
        return v9Result(backend, options, { linePreview: null, guides: null })
      }
      const snapshot = backend.getSnapshot()
      const command = runCommand((current) =>
        updateSlideShapeLineGeometry(current.getSession(), active.nodeId, {
          frame: authored.frame,
          lineGeometry: authored.lineGeometry,
        }, { expectedRevision: snapshot.revision }),
      )
      return v9Result(readBackend() ?? backend, options, {
        command,
        linePreview: null,
        guides: null,
      })
    }

    const next = active.type === 'move'
      ? previewMove(active, world)
      : active.type === 'resize'
        ? previewResize(active, world, backend)
        : previewRotate(active, world)
    preview = null
    const snapshot = backend.getSnapshot()
    const command = runCommand((current) =>
      current.transformNativeLayers(
        { nodes: next },
        { expectedRevision: snapshot.revision },
      ),
    )
    return v9Result(readBackend() ?? backend, options, { command, preview: undefined })
  }

  /**
   * Direct transform of the current selection. Locked scene Native returns
   * `reason: 'locked'`. Used by tests and by R2-Z if a non-pointer path writes.
   */
  const transformSelection = (
    nodes: readonly SlideEditorNodeTransform[],
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readBackend()
    if (!backend) return UNAVAILABLE_RESULT
    const snapshot = backend.getSnapshot()
    const command = runCommand((current) =>
      current.transformNativeLayers(
        { nodes },
        { expectedRevision: snapshot.revision },
      ),
    )
    return v9Result(readBackend() ?? backend, options, { command })
  }

  /**
   * Drops any in-flight gesture without committing (Esc / pointercancel /
   * surface switch). Never writes history.
   */
  const cancelGesture = (
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    gesture = null
    preview = null
    clearLineDrag()
    const backend = readBackend()
    if (!backend) return UNAVAILABLE_RESULT
    return v9Result(backend, options, { linePreview: null, guides: null })
  }

  return {
    resolveKind,
    currentTargets,
    overlayGeometry,
    selectFromLayerIds,
    pointerDown,
    pointerMove,
    pointerUp,
    cancelGesture,
    transformSelection,
    previewTransforms: () => preview,
    lineDragPreview: () => linePreview,
    hitTargets: () => {
      const backend = readBackend()
      return backend ? layerTargets(backend) : []
    },
  }
}

export function resolveSlideWorkspaceAuthoringKind(
  backend?: SlideAuthoringBackend | null,
): SlideWorkspaceBackendKind {
  return backend ? 'slide-authoring' : 'unavailable'
}

export function listSlideWorkspaceHitTargets(
  backend: SlideAuthoringBackend | null,
): V9SlideHitTarget[] {
  return backend ? layerTargets(backend) : []
}

export function mergeSlidePreviewIntoNodes<T extends {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation: number
}>(
  nodes: readonly T[],
  preview: readonly SlideEditorNodeTransform[] | undefined,
): T[] {
  if (!preview || preview.length === 0) return []
  const byId = new Map(preview.map((item) => [item.nodeId, item]))
  const next: T[] = []
  for (const node of nodes) {
    const transform = byId.get(node.id)
    if (!transform) continue
    next.push({
      ...node,
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      rotation: transform.rotation,
    })
  }
  return next
}

export { executeSlideAuthoringCommand, SLIDE_BACKEND_NOT_CANDIDATE }
