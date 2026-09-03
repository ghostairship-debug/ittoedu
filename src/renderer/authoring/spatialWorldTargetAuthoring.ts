import { CANVAS_HEIGHT, CANVAS_WIDTH, MIN_NODE_SIZE } from '../../shared/constants'
import type { LayerItem } from '../../shared/courseProjectTypes'
import { isCourseTeacherControllerLayerItem } from '../../shared/teacherControllerConsistency'
import { constrainTeacherControllerAuthoringFrame } from '../../shared/teacherControllerLayout'
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
import type { CourseAuthoringTarget } from './courseAuthoringSession'
import type {
  SpatialAuthoringCommandPort,
  SpatialAuthoringReceipt,
} from './spatialAuthoringIntents'
import type { SpatialWorldContentEditSession } from './spatialWorldAuthoring'
import {
  createSpatialViewportOverlayTransform,
  createSpatialWorldViewTransform,
  spatialWorldPointerDeltaToWorld,
  type SpatialEditorWorldTransform,
  type SpatialSessionCamera,
} from '../course/spatialEditorCommands'
import type { SpatialEditorView } from '../course/spatialEditorView'
import {
  adaptV9SpatialEditorLayers,
  hitTestV9SpatialLayerItems,
  marqueeHitV9SpatialWorldLayerItems,
  type V9SpatialHitTarget,
} from '../phaser/v9SpatialHitAdapter'

const HANDLE_HIT_RADIUS = 10
const MARQUEE_MIN_SIZE = 3
const PAN_MIN_SIZE = 3

export interface SpatialWorldAuthoringSnapshot {
  readonly view: SpatialEditorView
  readonly selectionIds: readonly string[]
  readonly scope: 'global' | 'surface' | 'world'
  readonly contentEdit: SpatialWorldContentEditSession | null
  readonly worldTarget: CourseAuthoringTarget
  readonly layerTargets: ReadonlyMap<string, CourseAuthoringTarget>
}

export interface SpatialWorldTargetAuthoringPort {
  readSnapshot(): SpatialWorldAuthoringSnapshot
  readonly commands: SpatialAuthoringCommandPort
}

export interface SpatialWorldTargetAuthoringPointer {
  readonly x: number
  readonly y: number
  readonly additive?: boolean
}

export interface SpatialWorldTargetAuthoringResult {
  readonly worldTransform: StageViewportTransform
  readonly viewportTransform: StageViewportTransform
  readonly overlay: StageSelectionOverlayGeometry | null
  readonly viewportOverlay: StageSelectionOverlayGeometry | null
  readonly command?: SpatialAuthoringReceipt
  readonly preview?: readonly SpatialEditorWorldTransform[]
  readonly previewCamera?: SpatialSessionCamera
  readonly hit?: V9SpatialHitTarget | null
  readonly marquee?: StageRect | null
}

interface GestureCapture {
  readonly snapshot: SpatialWorldAuthoringSnapshot
  readonly expectedSelectionIds: readonly string[]
  readonly targets: readonly CourseAuthoringTarget[]
}

type SpatialTargetGesture =
  | (GestureCapture & {
      readonly type: 'move' | 'viewport-move'
      readonly start: StagePoint
      readonly nodes: readonly SpatialEditorWorldTransform[]
    })
  | (GestureCapture & {
      readonly type: 'resize' | 'viewport-resize'
      readonly direction: StageResizeHandleDirection
      readonly start: StagePoint
      readonly nodes: readonly SpatialEditorWorldTransform[]
    })
  | (GestureCapture & {
      readonly type: 'rotate'
      readonly center: StagePoint
      readonly startAngle: number
      readonly nodes: readonly SpatialEditorWorldTransform[]
    })
  | (GestureCapture & {
      readonly type: 'marquee'
      readonly start: StagePoint
      readonly additive: boolean
    })
  | (GestureCapture & {
      readonly type: 'pan'
      readonly start: StagePoint
      readonly startCamera: SpatialSessionCamera
    })

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function nextSelection(
  current: readonly string[],
  selected: readonly string[],
  additive: boolean,
): string[] {
  if (!additive) return [...new Set(selected)]
  const next = [...current]
  for (const id of selected) {
    const index = next.indexOf(id)
    if (index >= 0) next.splice(index, 1)
    else next.push(id)
  }
  return next
}

function hits(snapshot: SpatialWorldAuthoringSnapshot): V9SpatialHitTarget[] {
  const all = adaptV9SpatialEditorLayers(snapshot.view.layers)
  return snapshot.scope === 'global'
    ? all
    : all.filter((target) => target.nativeType !== 'teacher-controller')
}

function pointInWorld(
  point: StagePoint,
  viewport: StageRect,
  camera: SpatialSessionCamera,
): StagePoint {
  return clientToWorld(createSpatialWorldViewTransform(viewport, camera), point)
}

function pointInViewport(point: StagePoint, viewport: StageRect): StagePoint {
  return clientToWorld(createSpatialViewportOverlayTransform(viewport), point)
}

function hitAt(
  snapshot: SpatialWorldAuthoringSnapshot,
  viewport: StageRect,
  point: StagePoint,
): V9SpatialHitTarget | null {
  return hitTestV9SpatialLayerItems(hits(snapshot), {
    viewport: pointInViewport(point, viewport),
    world: pointInWorld(point, viewport, snapshot.view.sessionCamera),
  })
}

function transforms(
  snapshot: SpatialWorldAuthoringSnapshot,
  coordinateSpace: 'world' | 'viewport',
  selectionIds = snapshot.selectionIds,
): SpatialEditorWorldTransform[] {
  const byId = new Map(hits(snapshot).map((target) => [target.layerItemId, target]))
  return selectionIds.flatMap((id) => {
    const target = byId.get(id)
    if (
      !target
      || target.coordinateSpace !== coordinateSpace
      || target.locked
      || !target.writable
      || (coordinateSpace === 'world' && target.source !== 'world')
      || (coordinateSpace === 'viewport' && target.source !== 'global')
    ) return []
    return [{
      layerItemId: id,
      x: target.bounds.x,
      y: target.bounds.y,
      width: target.bounds.width,
      height: target.bounds.height,
      rotation: target.bounds.rotation,
    }]
  })
}

function targetsFor(
  snapshot: SpatialWorldAuthoringSnapshot,
  nodes: readonly SpatialEditorWorldTransform[],
): CourseAuthoringTarget[] | null {
  const result = nodes.map((node) => snapshot.layerTargets.get(node.layerItemId))
  return result.every((target): target is CourseAuthoringTarget => Boolean(target)) ? result : null
}

function overlayRects(
  snapshot: SpatialWorldAuthoringSnapshot,
  preview: readonly SpatialEditorWorldTransform[] | null,
  coordinateSpace: 'world' | 'viewport',
): StageRect[] {
  const previewById = new Map((preview ?? []).map((node) => [node.layerItemId, node]))
  const byId = new Map(hits(snapshot).map((target) => [target.layerItemId, target]))
  return snapshot.selectionIds.flatMap((id) => {
    const target = byId.get(id)
    if (!target || target.coordinateSpace !== coordinateSpace) return []
    const node = previewById.get(id)
    return [{
      x: node?.x ?? target.bounds.x,
      y: node?.y ?? target.bounds.y,
      width: node?.width ?? target.bounds.width,
      height: node?.height ?? target.bounds.height,
      rotation: node?.rotation ?? target.bounds.rotation,
    }]
  })
}

function selectionBox(nodes: readonly SpatialEditorWorldTransform[]): StageRect | null {
  if (nodes.length === 0) return null
  if (nodes.length === 1) {
    const node = nodes[0]!
    return { x: node.x, y: node.y, width: node.width, height: node.height }
  }
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const bottom = Math.max(...nodes.map((node) => node.y + node.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function hitHandle(
  nodes: readonly SpatialEditorWorldTransform[],
  point: StagePoint,
  allowRotate: boolean,
): { readonly kind: 'resize'; readonly direction: StageResizeHandleDirection } | { readonly kind: 'rotate' } | null {
  const box = selectionBox(nodes)
  if (!box) return null
  const rotation = nodes.length === 1 ? nodes[0]!.rotation : 0
  if (allowRotate) {
    const rotate = stageRotateHandleWorldPoint(box, rotation)
    if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= HANDLE_HIT_RADIUS) {
      return { kind: 'rotate' }
    }
  }
  for (const direction of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    const handle = stageResizeHandleWorldPoint(box, direction, rotation)
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= HANDLE_HIT_RADIUS) {
      return { kind: 'resize', direction }
    }
  }
  return null
}

function previewMove(
  nodes: readonly SpatialEditorWorldTransform[],
  start: StagePoint,
  point: StagePoint,
): SpatialEditorWorldTransform[] {
  const dx = point.x - start.x
  const dy = point.y - start.y
  return nodes.map((node) => ({ ...node, x: node.x + dx, y: node.y + dy }))
}

function previewResize(
  nodes: readonly SpatialEditorWorldTransform[],
  direction: StageResizeHandleDirection,
  point: StagePoint,
): SpatialEditorWorldTransform[] {
  if (nodes.length === 1) {
    const node = nodes[0]!
    return [{ ...node, ...resizeWorldFrameFromHandle(node, direction, point, MIN_NODE_SIZE) }]
  }
  const box = selectionBox(nodes)!
  const next = resizeWorldFrameFromHandle(box, direction, point, MIN_NODE_SIZE)
  const scaleX = next.width / box.width
  const scaleY = next.height / box.height
  return nodes.map((node) => ({
    ...node,
    x: next.x + (node.x - box.x) * scaleX,
    y: next.y + (node.y - box.y) * scaleY,
    width: Math.max(MIN_NODE_SIZE, node.width * scaleX),
    height: Math.max(MIN_NODE_SIZE, node.height * scaleY),
  }))
}

function previewRotate(
  nodes: readonly SpatialEditorWorldTransform[],
  center: StagePoint,
  startAngle: number,
  point: StagePoint,
): SpatialEditorWorldTransform[] {
  const delta = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI - startAngle
  const radians = delta * Math.PI / 180
  return nodes.map((node) => {
    const nodeCenter = worldRectCenter(node)
    const x = nodeCenter.x - center.x
    const y = nodeCenter.y - center.y
    const nextCenter = {
      x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
      y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
    }
    return {
      ...node,
      x: nextCenter.x - node.width / 2,
      y: nextCenter.y - node.height / 2,
      rotation: node.rotation + delta,
    }
  })
}

function constrainViewportControllers(
  snapshot: SpatialWorldAuthoringSnapshot,
  nodes: readonly SpatialEditorWorldTransform[],
): SpatialEditorWorldTransform[] {
  const items = new Map(snapshot.view.layers.map((layer) => [layer.selectionId, layer.item as LayerItem]))
  return nodes.map((node) => {
    const item = items.get(node.layerItemId)
    if (!item || !isCourseTeacherControllerLayerItem(item)) return node
    const frame = constrainTeacherControllerAuthoringFrame(
      item.content.data,
      node,
      node.rotation,
      { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    )
    return { ...node, ...frame }
  })
}

function marqueeRect(start: StagePoint, point: StagePoint): StageRect {
  return {
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    width: Math.abs(point.x - start.x),
    height: Math.abs(point.y - start.y),
  }
}

function panPreview(
  start: StagePoint,
  point: StagePoint,
  camera: SpatialSessionCamera,
): SpatialSessionCamera {
  const delta = spatialWorldPointerDeltaToWorld(camera, { x: point.x - start.x, y: point.y - start.y })
  return { x: camera.x - delta.x, y: camera.y - delta.y, zoom: camera.zoom }
}

function isEditable(hit: V9SpatialHitTarget): boolean {
  return hit.kind === 'native'
    && (hit.nativeType === 'text' || hit.nativeType === 'formula')
    && hit.source === 'world'
    && !hit.locked
    && hit.writable
}

export function createSpatialWorldTargetAuthoringController(port: SpatialWorldTargetAuthoringPort) {
  let gesture: SpatialTargetGesture | null = null
  let preview: SpatialEditorWorldTransform[] | null = null
  let previewCamera: SpatialSessionCamera | null = null

  const result = (
    viewport: StageRect,
    extra: Partial<SpatialWorldTargetAuthoringResult> = {},
  ): SpatialWorldTargetAuthoringResult => {
    const snapshot = port.readSnapshot()
    const camera = extra.previewCamera ?? previewCamera ?? snapshot.view.sessionCamera
    const worldTransform = createSpatialWorldViewTransform(viewport, camera)
    const viewportTransform = createSpatialViewportOverlayTransform(viewport)
    return {
      worldTransform,
      viewportTransform,
      overlay: stageSelectionOverlayGeometry(worldTransform, overlayRects(snapshot, preview, 'world')),
      viewportOverlay: stageSelectionOverlayGeometry(viewportTransform, overlayRects(snapshot, preview, 'viewport')),
      ...(preview ? { preview } : {}),
      ...(previewCamera ? { previewCamera } : {}),
      ...extra,
    }
  }

  const selectionCommand = (
    snapshot: SpatialWorldAuthoringSnapshot,
    target: CourseAuthoringTarget,
    ids: readonly string[],
    additive: boolean,
    scope: 'global' | 'surface' | 'world',
  ) => port.commands.run(target, {
    kind: 'select-layers',
    layerItemIds: ids,
    additive,
    scope,
    expectedContentEdit: snapshot.contentEdit,
  })

  const pointerDown = (
    pointer: SpatialWorldTargetAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldTargetAuthoringResult => {
    const snapshot = port.readSnapshot()
    const client = { x: pointer.x, y: pointer.y }
    const world = pointInWorld(client, viewport, snapshot.view.sessionCamera)
    const viewportPoint = pointInViewport(client, viewport)
    const viewportNodes = transforms(snapshot, 'viewport')
    const viewportHandle = hitHandle(viewportNodes, viewportPoint, false)
    if (viewportHandle?.kind === 'resize') {
      const targetList = targetsFor(snapshot, viewportNodes)
      if (targetList) {
        gesture = {
          type: 'viewport-resize',
          direction: viewportHandle.direction,
          start: viewportPoint,
          nodes: viewportNodes,
          snapshot,
          expectedSelectionIds: [...snapshot.selectionIds],
          targets: targetList,
        }
        preview = viewportNodes.map((node) => ({ ...node }))
        return result(viewport)
      }
    }

    const worldNodes = transforms(snapshot, 'world')
    const worldHandle = hitHandle(worldNodes, world, true)
    if (worldHandle && worldNodes.length > 0) {
      const targetList = targetsFor(snapshot, worldNodes)
      if (targetList) {
        const box = selectionBox(worldNodes)!
        gesture = worldHandle.kind === 'rotate'
          ? {
              type: 'rotate',
              center: worldRectCenter(box),
              startAngle: Math.atan2(world.y - worldRectCenter(box).y, world.x - worldRectCenter(box).x) * 180 / Math.PI,
              nodes: worldNodes,
              snapshot,
              expectedSelectionIds: [...snapshot.selectionIds],
              targets: targetList,
            }
          : {
              type: 'resize',
              direction: worldHandle.direction,
              start: world,
              nodes: worldNodes,
              snapshot,
              expectedSelectionIds: [...snapshot.selectionIds],
              targets: targetList,
            }
        preview = worldNodes.map((node) => ({ ...node }))
        return result(viewport)
      }
    }

    const hit = hitAt(snapshot, viewport, client)
    if (hit?.coordinateSpace === 'viewport') {
      const target = snapshot.layerTargets.get(hit.layerItemId)
      if (!target) return result(viewport, { hit })
      const command = selectionCommand(snapshot, target, [hit.layerItemId], pointer.additive === true, 'global')
      const selectedIds = nextSelection(snapshot.selectionIds, [hit.layerItemId], pointer.additive === true)
      if (!command.ok || command.historyEntry) return result(viewport, { hit, command })
      const nodes = transforms(snapshot, 'viewport', selectedIds)
      const targetList = targetsFor(snapshot, nodes)
      if (!hit.locked && targetList?.length) {
        gesture = {
          type: 'viewport-move',
          start: viewportPoint,
          nodes,
          snapshot,
          expectedSelectionIds: selectedIds,
          targets: targetList,
        }
        preview = nodes.map((node) => ({ ...node }))
      }
      return result(viewport, { hit, command })
    }
    if (hit?.coordinateSpace === 'world' && hit.source === 'world') {
      const target = snapshot.layerTargets.get(hit.layerItemId)
      if (!target) return result(viewport, { hit })
      const command = selectionCommand(snapshot, target, [hit.layerItemId], pointer.additive === true, 'world')
      const selectedIds = nextSelection(snapshot.selectionIds, [hit.layerItemId], pointer.additive === true)
      if (!command.ok || command.historyEntry) return result(viewport, { hit, command })
      const nodes = transforms(snapshot, 'world', selectedIds)
      const targetList = targetsFor(snapshot, nodes)
      if (!hit.locked && targetList?.length) {
        gesture = {
          type: 'move',
          start: world,
          nodes,
          snapshot,
          expectedSelectionIds: selectedIds,
          targets: targetList,
        }
        preview = nodes.map((node) => ({ ...node }))
      }
      return result(viewport, { hit, command })
    }
    if (hit?.coordinateSpace === 'world') return result(viewport, { hit })

    if (pointer.additive) {
      gesture = {
        type: 'marquee',
        start: world,
        additive: true,
        snapshot,
        expectedSelectionIds: [...snapshot.selectionIds],
        targets: [],
      }
      return result(viewport, { marquee: marqueeRect(world, world) })
    }
    gesture = {
      type: 'pan',
      start: client,
      startCamera: snapshot.view.sessionCamera,
      snapshot,
      expectedSelectionIds: [...snapshot.selectionIds],
      targets: [],
    }
    preview = null
    previewCamera = snapshot.view.sessionCamera
    return result(viewport)
  }

  const pointerMove = (
    pointer: SpatialWorldTargetAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldTargetAuthoringResult => {
    if (!gesture) return result(viewport)
    const client = { x: pointer.x, y: pointer.y }
    if (gesture.type === 'pan') {
      previewCamera = panPreview(gesture.start, client, gesture.startCamera)
      return result(viewport)
    }
    const point = gesture.type === 'viewport-move' || gesture.type === 'viewport-resize'
      ? pointInViewport(client, viewport)
      : pointInWorld(client, viewport, gesture.snapshot.view.sessionCamera)
    if (gesture.type === 'marquee') {
      return result(viewport, { marquee: marqueeRect(gesture.start, point) })
    }
    if (gesture.type === 'move' || gesture.type === 'viewport-move') {
      preview = previewMove(gesture.nodes, gesture.start, point)
    } else if (gesture.type === 'resize' || gesture.type === 'viewport-resize') {
      preview = previewResize(gesture.nodes, gesture.direction, point)
    } else if (gesture.type === 'rotate') {
      preview = previewRotate(gesture.nodes, gesture.center, gesture.startAngle, point)
    }
    if (gesture.type === 'viewport-move' || gesture.type === 'viewport-resize') {
      if (preview) preview = constrainViewportControllers(gesture.snapshot, preview)
    }
    return result(viewport)
  }

  const pointerUp = (
    pointer: SpatialWorldTargetAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldTargetAuthoringResult => {
    const active = gesture
    gesture = null
    if (!active) return result(viewport)
    const client = { x: pointer.x, y: pointer.y }
    let command: SpatialAuthoringReceipt | undefined
    if (active.type === 'marquee') {
      const world = pointInWorld(client, viewport, active.snapshot.view.sessionCamera)
      const rect = marqueeRect(active.start, world)
      const moved = rect.width > MARQUEE_MIN_SIZE || rect.height > MARQUEE_MIN_SIZE
      const selected = moved
        ? marqueeHitV9SpatialWorldLayerItems(hits(active.snapshot), rect)
            .filter((hit) => hit.source === 'world')
            .map((hit) => hit.layerItemId)
        : []
      command = selectionCommand(active.snapshot, active.snapshot.worldTarget, selected, active.additive, 'world')
    } else if (active.type === 'pan') {
      const dx = client.x - active.start.x
      const dy = client.y - active.start.y
      if (Math.hypot(dx, dy) < PAN_MIN_SIZE) {
        command = selectionCommand(active.snapshot, active.snapshot.worldTarget, [], false, active.snapshot.scope)
      } else {
        const camera = panPreview(active.start, client, active.startCamera)
        command = port.commands.run(active.snapshot.worldTarget, {
          kind: 'pan-session-camera',
          delta: { x: camera.x - active.startCamera.x, y: camera.y - active.startCamera.y },
          expectedCamera: active.startCamera,
          expectedContentEdit: active.snapshot.contentEdit,
        })
      }
    } else {
      const point = active.type === 'viewport-move' || active.type === 'viewport-resize'
        ? pointInViewport(client, viewport)
        : pointInWorld(client, viewport, active.snapshot.view.sessionCamera)
      let next: SpatialEditorWorldTransform[]
      if (active.type === 'move' || active.type === 'viewport-move') {
        next = previewMove(active.nodes, active.start, point)
      } else if (active.type === 'resize' || active.type === 'viewport-resize') {
        next = previewResize(active.nodes, active.direction, point)
      } else if ('center' in active) {
        next = previewRotate(active.nodes, active.center, active.startAngle, point)
      } else {
        return result(viewport)
      }
      const coordinateSpace = active.type.startsWith('viewport') ? 'viewport' : 'world'
      if (coordinateSpace === 'viewport') next = constrainViewportControllers(active.snapshot, next)
      command = port.commands.run(active.targets[0]!, {
        kind: 'transform-layers',
        coordinateSpace,
        layers: next,
        expectedSelectionIds: active.expectedSelectionIds,
        expectedCamera: active.snapshot.view.sessionCamera,
        targets: active.targets,
        expectedContentEdit: active.snapshot.contentEdit,
      })
    }
    preview = null
    previewCamera = null
    return result(viewport, { ...(command ? { command } : {}) })
  }

  const pointerCancel = (viewport: StageRect): SpatialWorldTargetAuthoringResult => {
    gesture = null
    preview = null
    previewCamera = null
    return result(viewport)
  }

  const doubleClick = (
    pointer: SpatialWorldTargetAuthoringPointer,
    viewport: StageRect,
  ): SpatialWorldTargetAuthoringResult => {
    const snapshot = port.readSnapshot()
    const hit = hitAt(snapshot, viewport, pointer)
    const target = hit ? snapshot.layerTargets.get(hit.layerItemId) : null
    const command = hit && target && isEditable(hit)
      ? port.commands.run(target, {
          kind: 'begin-content-edit',
          source: 'canvas',
          expectedEdit: snapshot.contentEdit,
          expectedContentEdit: snapshot.contentEdit,
        })
      : undefined
    return result(viewport, { hit, ...(command ? { command } : {}) })
  }

  const zoomSession = (zoom: number, viewport: StageRect): SpatialWorldTargetAuthoringResult => {
    const snapshot = port.readSnapshot()
    const command = port.commands.run(snapshot.worldTarget, {
      kind: 'zoom-session-camera',
      zoom,
      expectedCamera: snapshot.view.sessionCamera,
      expectedContentEdit: snapshot.contentEdit,
    })
    return result(viewport, { command })
  }

  return {
    overlayGeometry: (viewport: StageRect) => result(viewport).overlay,
    viewportOverlayGeometry: (viewport: StageRect) => result(viewport).viewportOverlay,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    doubleClick,
    zoomSession,
  }
}
