import type { SceneNode } from '../../shared/projectTypes'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { MIN_NODE_SIZE } from '../../shared/constants'
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
  SLIDE_BACKEND_NOT_CANDIDATE,
} from '../store/slideBackendPort'
import {
  selectSlideAuthoringBackend,
  useEditorStore,
} from '../store/editorStore'
import {
  buildSlideEditorView,
  type SlideAuthoringTarget,
  type SlideAuthoringBackend,
  type SlideCommandResult,
} from '../course/slideAuthoringBackend'
import type { SlideEditorNodeTransform } from '../course/slideEditorCommands'
import {
  adaptV9SlideLayerItemHit,
  hitTestV9SlideLayerItems,
  marqueeHitV9SlideLayerItems,
  type V9SlideHitTarget,
} from '../phaser/v9SlideHitAdapter'

const MARQUEE_MIN_SIZE = 3
const HANDLE_HIT_RADIUS = 10

export type SlideWorkspaceBackendKind = 'v8' | 'slide-authoring'

export interface SlideAuthoringPointer {
  readonly x: number
  readonly y: number
  /** Client CSS pixels unless `space` is `'world'` (Phaser pointer.worldX/Y). */
  readonly space?: 'client' | 'world'
  readonly additive?: boolean
}

export type SlideWorkspaceAuthoringResult =
  | {
      readonly kind: 'v8'
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

type SlideAuthoringGesture = MoveGesture | ResizeGesture | RotateGesture | MarqueeGesture

function v8Fallback(): SlideWorkspaceAuthoringResult {
  return { kind: 'v8', reason: SLIDE_BACKEND_NOT_CANDIDATE }
}

function readCandidate(): SlideAuthoringBackend | null {
  return selectSlideAuthoringBackend(useEditorStore.getState())
}

function runCandidate(
  run: (backend: SlideAuthoringBackend) => SlideCommandResult,
): SlideCommandResult {
  return useEditorStore.getState().runSlideCandidateCommand(run)
}

/** Canvas selectLayers only. Empty selection keeps the current tab (unlike activateScene / transform). */
function revealPropertiesAfterSelectLayers(command: SlideCommandResult): void {
  if (!command.ok) return
  const store = useEditorStore.getState()
  if (store.selectedNodeIds.length === 0) return
  store.setActiveTab('properties')
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
  const layer = view.layers.find((candidate) => candidate.selectionId === nodeId)
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

function hitHandle(
  backend: SlideAuthoringBackend,
  world: StagePoint,
): { kind: 'resize'; direction: StageResizeHandleDirection } | { kind: 'rotate' } | null {
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
 * Slide canvas hit / selection / transform kernel for the V9 candidate.
 * Default V8 (`selectSlideAuthoringBackend === null`) returns `{ kind: 'v8' }`
 * and never reports a successful command — Workspace must keep its existing path.
 */
export function createSlideWorkspaceAuthoringController() {
  let gesture: SlideAuthoringGesture | null = null
  let preview: SlideEditorNodeTransform[] | null = null

  const resolveKind = (): SlideWorkspaceBackendKind =>
    readCandidate() ? 'slide-authoring' : 'v8'

  const currentTargets = (): SlideAuthoringTarget[] => {
    const backend = readCandidate()
    return backend ? makeTargets(backend) : []
  }

  const overlayGeometry = (
    options: StageViewportTransformOptions,
  ): StageSelectionOverlayGeometry | null => {
    const backend = readCandidate()
    return backend ? overlayForSelection(backend, options, preview ?? undefined) : null
  }

  const selectFromLayerIds = (
    layerItemIds: readonly string[],
    options: StageViewportTransformOptions,
    additive = false,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    const command = runCandidate((candidate) =>
      candidate.selectLayers(layerItemIds, additive, {
        expectedRevision: candidate.getSnapshot().revision,
      }),
    )
    revealPropertiesAfterSelectLayers(command)
    gesture = null
    preview = null
    return v9Result(backend, options, { command })
  }

  const pointerDown = (
    pointer: SlideAuthoringPointer,
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    const world = pointerToWorld(pointer, options)
    const handle = hitHandle(backend, world)
    const writable = writableNativeTransforms(backend)

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

    const hit = hitTestV9SlideLayerItems(layerTargets(backend), world)
    if (hit) {
      const command = runCandidate((candidate) =>
        candidate.selectLayers([hit.layerItemId], pointer.additive === true, {
          expectedRevision: candidate.getSnapshot().revision,
        }),
      )
      revealPropertiesAfterSelectLayers(command)
      const nextWritable = writableNativeTransforms(backend)
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
      return v9Result(backend, options, { command, preview: preview ?? undefined, hit })
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
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    const world = pointerToWorld(pointer, options)
    if (!gesture) return v9Result(backend, options)

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
    const backend = readCandidate()
    if (!backend) return v8Fallback()
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
      const command = runCandidate((candidate) =>
        candidate.selectLayers(
          hits.map((hit) => hit.layerItemId),
          active.additive,
          { expectedRevision: candidate.getSnapshot().revision },
        ),
      )
      revealPropertiesAfterSelectLayers(command)
      preview = null
      return v9Result(backend, options, { command, marquee: null })
    }

    const next = active.type === 'move'
      ? previewMove(active, world)
      : active.type === 'resize'
        ? previewResize(active, world, backend)
        : previewRotate(active, world)
    preview = null
    const snapshot = backend.getSnapshot()
    const command = runCandidate((candidate) =>
      candidate.transformNativeLayers(
        { nodes: next },
        { expectedRevision: snapshot.revision },
      ),
    )
    return v9Result(backend, options, { command, preview: undefined })
  }

  /**
   * Direct transform of the current selection. Locked scene Native returns
   * `reason: 'locked'`. Used by tests and by R2-Z if a non-pointer path writes.
   */
  const transformSelection = (
    nodes: readonly SlideEditorNodeTransform[],
    options: StageViewportTransformOptions,
  ): SlideWorkspaceAuthoringResult => {
    const backend = readCandidate()
    if (!backend) return v8Fallback()
    const snapshot = backend.getSnapshot()
    const command = runCandidate((candidate) =>
      candidate.transformNativeLayers(
        { nodes },
        { expectedRevision: snapshot.revision },
      ),
    )
    return v9Result(backend, options, { command })
  }

  return {
    resolveKind,
    currentTargets,
    overlayGeometry,
    selectFromLayerIds,
    pointerDown,
    pointerMove,
    pointerUp,
    transformSelection,
    previewTransforms: () => preview,
  }
}

export function resolveSlideWorkspaceAuthoringKind(): SlideWorkspaceBackendKind {
  return readCandidate() ? 'slide-authoring' : 'v8'
}

export function listSlideWorkspaceHitTargets(): V9SlideHitTarget[] {
  const backend = readCandidate()
  return backend ? layerTargets(backend) : []
}

export function mergeSlidePreviewIntoNodes(
  nodes: readonly SceneNode[],
  preview: readonly SlideEditorNodeTransform[] | undefined,
): SceneNode[] {
  if (!preview || preview.length === 0) return []
  const byId = new Map(preview.map((item) => [item.nodeId, item]))
  const next: SceneNode[] = []
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

export { SLIDE_BACKEND_NOT_CANDIDATE }
