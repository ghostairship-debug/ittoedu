import { composeMatrices, frameToSpaceMatrix, invertMatrix, matrixAroundPoint, multiplyMatrices, rotationMatrix,
  scaleMatrix, transformPoint, translationMatrix, type AffineMatrix, type GeometryPoint } from '../../../../core/components/geometry'
import type { ComponentEdit } from '../../../../shared/contracts/component-platform/operations'
import type { ComponentFrame } from '../../../../shared/contracts/component-platform/frame'
import type { ComponentAuthorGeometry, ComponentAuthorGeometryObservation, ComponentAuthorSpot } from '../../../../shared/contracts/component-platform/runtime'
import { freeSelectionBounds, freeTargetBounds, type FreeBounds, type FreeObjectTarget } from './targets'

export type FreeResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export interface FreeSnapGuide { axis: 'x' | 'y'; value: number }
export interface FreeGestureStart {
  mode: 'drag' | 'resize' | 'rotate'
  targets: readonly FreeObjectTarget[]
  pointer: GeometryPoint
  /** Shared viewport/camera mapping, excluding object ancestors. */
  surfaceToPointer: AffineMatrix
  handle?: FreeResizeHandle
  /** Text and professional content boxes reflow; ordinary visual scaling keeps local dimensions. */
  resizeMode?: 'scale' | 'box'
  minimumBoxSize?: { width: number; height: number }
  snapTargets?: readonly FreeObjectTarget[]
  designSize?: { width: number; height: number }
  snapTolerance?: number
}
export interface FreeGestureUpdate { edits: ComponentEdit[]; guides: FreeSnapGuide[] }
const frameEdit = (target: FreeObjectTarget, transform: AffineMatrix): ComponentEdit => ({ type: 'frame.set', instanceId: target.instanceId,
  frame: { ...target.frame, transform: [...transform] } })

function handlePoints(handle: FreeResizeHandle, width: number, height: number) {
  const x = handle.includes('w') ? 0 : handle.includes('e') ? width : width / 2
  const y = handle.includes('n') ? 0 : handle.includes('s') ? height : height / 2
  return { moving: { x, y }, anchor: { x: width - x, y: height - y }, xAxis: /[we]/.test(handle), yAxis: /[ns]/.test(handle) }
}
function resizeFactors(handle: FreeResizeHandle, width: number, height: number, start: GeometryPoint, end: GeometryPoint, proportional: boolean) {
  const { moving, anchor, xAxis, yAxis } = handlePoints(handle, width, height)
  let x = xAxis ? 1 + (end.x - start.x) / (moving.x - anchor.x) : 1
  let y = yAxis ? 1 + (end.y - start.y) / (moving.y - anchor.y) : 1
  if (proportional) {
    const factor = xAxis && yAxis ? (Math.abs(x - 1) >= Math.abs(y - 1) ? x : y) : xAxis ? x : y
    x = factor; y = factor
  }
  // Crossing the fixed anchor is a reflection. Keep the invertible frame through the exact zero crossing.
  const nonzero = (value: number) => Math.abs(value) < 0.001 ? (value < 0 ? -0.001 : 0.001) : value
  return { x: nonzero(x), y: nonzero(y), anchor }
}
function nearestSnap(values: number[], axes: number[], tolerance: number): { delta: number; value: number } | null {
  let result: { delta: number; value: number } | null = null
  for (const value of values) for (const axis of axes) {
    const delta = axis - value
    if (Math.abs(delta) <= tolerance && (!result || Math.abs(delta) < Math.abs(result.delta))) result = { delta, value: axis }
  }
  return result
}

/** Pure transient geometry. Each update starts from the frozen pointer/frame; finish submits one batch. */
export class FreeTransformGesture {
  readonly targets: readonly FreeObjectTarget[]
  private readonly start: FreeGestureStart
  private readonly pointerToSurface: AffineMatrix
  private readonly initial: GeometryPoint
  private readonly bounds: FreeBounds
  constructor(start: FreeGestureStart) {
    if (!start.targets.length) throw new Error('请先选择自由对象')
    this.start = structuredClone(start)
    this.targets = this.start.targets
    this.pointerToSurface = invertMatrix(start.surfaceToPointer)
    this.initial = transformPoint(this.pointerToSurface, start.pointer)
    this.bounds = freeSelectionBounds(this.targets)!
    if (start.mode === 'resize' && !start.handle) throw new Error('缺少缩放手柄')
  }
  update(pointer: GeometryPoint, modifiers: { shift?: boolean; alt?: boolean } = {}): FreeGestureUpdate {
    const current = transformPoint(this.pointerToSurface, pointer), guides: FreeSnapGuide[] = []
    let surfaceOperation: AffineMatrix
    if (this.start.mode === 'drag') {
      let dx = current.x - this.initial.x, dy = current.y - this.initial.y
      const dragAxis = modifiers.shift ? (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y') : null
      if (dragAxis === 'x') dy = 0
      else if (dragAxis === 'y') dx = 0
      if (!modifiers.alt) {
        const boxes = (this.start.snapTargets ?? []).map(freeTargetBounds)
        const xs = boxes.flatMap(box => [box.left, (box.left + box.right) / 2, box.right])
        const ys = boxes.flatMap(box => [box.top, (box.top + box.bottom) / 2, box.bottom])
        if (this.start.designSize) { xs.push(0, this.start.designSize.width / 2, this.start.designSize.width); ys.push(0, this.start.designSize.height / 2, this.start.designSize.height) }
        const zoom = Math.hypot(this.start.surfaceToPointer[0], this.start.surfaceToPointer[1])
        const tolerance = (this.start.snapTolerance ?? 6) / zoom
        const x = nearestSnap([this.bounds.left + dx, (this.bounds.left + this.bounds.right) / 2 + dx, this.bounds.right + dx], xs, tolerance)
        const y = nearestSnap([this.bounds.top + dy, (this.bounds.top + this.bounds.bottom) / 2 + dy, this.bounds.bottom + dy], ys, tolerance)
        if (x && dragAxis !== 'y') { dx += x.delta; guides.push({ axis: 'x', value: x.value }) }
        if (y && dragAxis !== 'x') { dy += y.delta; guides.push({ axis: 'y', value: y.value }) }
      }
      surfaceOperation = translationMatrix(dx, dy)
    } else if (this.targets.length === 1) {
      const target = this.targets[0]!, frame = target.frame
      if (this.start.mode === 'resize') {
        const inverse = invertMatrix(frameToSpaceMatrix(frame, target.parentToSurface))
        const factors = resizeFactors(this.start.handle!, frame.width, frame.height, transformPoint(inverse, this.initial), transformPoint(inverse, current), Boolean(modifiers.shift || target.preserveAspectRatio))
        if (this.start.resizeMode === 'box') {
          const x = Math.max((this.start.minimumBoxSize?.width ?? 1) / frame.width, factors.x), y = Math.max((this.start.minimumBoxSize?.height ?? 1) / frame.height, factors.y)
          return { edits: [{ type: 'frame.set', instanceId: target.instanceId, frame: {
            width: frame.width * x, height: frame.height * y,
            transform: [...multiplyMatrices(frame.transform, translationMatrix(factors.anchor.x * (1 - x), factors.anchor.y * (1 - y)))],
          } }], guides }
        }
        return { edits: [frameEdit(target, multiplyMatrices(frame.transform, matrixAroundPoint(scaleMatrix(factors.x, factors.y), factors.anchor)))], guides }
      }
      const inverse = invertMatrix(target.parentToSurface)
      const center = transformPoint(frame.transform, { x: frame.width / 2, y: frame.height / 2 })
      const a = transformPoint(inverse, this.initial), b = transformPoint(inverse, current)
      let radians = Math.atan2(b.y - center.y, b.x - center.x) - Math.atan2(a.y - center.y, a.x - center.x)
      if (modifiers.shift) radians = Math.round(radians / (Math.PI / 12)) * Math.PI / 12
      return { edits: [frameEdit(target, multiplyMatrices(matrixAroundPoint(rotationMatrix(radians), center), frame.transform))], guides }
    } else if (this.start.mode === 'resize') {
      const factors = resizeFactors(this.start.handle!, this.bounds.width, this.bounds.height,
        { x: this.initial.x - this.bounds.left, y: this.initial.y - this.bounds.top },
        { x: current.x - this.bounds.left, y: current.y - this.bounds.top }, Boolean(modifiers.shift))
      surfaceOperation = matrixAroundPoint(scaleMatrix(factors.x, factors.y), { x: factors.anchor.x + this.bounds.left, y: factors.anchor.y + this.bounds.top })
    } else {
      const center = { x: (this.bounds.left + this.bounds.right) / 2, y: (this.bounds.top + this.bounds.bottom) / 2 }
      let radians = Math.atan2(current.y - center.y, current.x - center.x) - Math.atan2(this.initial.y - center.y, this.initial.x - center.x)
      if (modifiers.shift) radians = Math.round(radians / (Math.PI / 12)) * Math.PI / 12
      surfaceOperation = matrixAroundPoint(rotationMatrix(radians), center)
    }
    return { edits: this.targets.map(target => frameEdit(target, composeMatrices(invertMatrix(target.parentToSurface), surfaceOperation, target.parentToSurface, target.frame.transform))), guides }
  }
}

export const createFreeTransformGesture = (start: FreeGestureStart): FreeTransformGesture => new FreeTransformGesture(start)

/** Convert a frozen parent-local observation back to author increments, excluding every host/runtime matrix. */
export function authorSpotGeometryFromFrame(observation: ComponentAuthorGeometryObservation, next: ComponentFrame,
  mode: FreeGestureStart['mode'], kind: ComponentAuthorSpot['kind']): ComponentAuthorGeometry {
  const { frame: start, author, boxInsets } = observation
  const result: ComponentAuthorGeometry = {}
  const changed = (a: number, b: number) => Math.abs(a - b) > 0.000001
  if (changed(start.transform[4], next.transform[4])) result.translateX = (author.translateX ?? 0) + next.transform[4] - start.transform[4]
  if (changed(start.transform[5], next.transform[5])) result.translateY = (author.translateY ?? 0) + next.transform[5] - start.transform[5]
  if (mode === 'resize' && kind === 'text') {
    if (changed(start.width, next.width)) result.width = Math.max(1, next.width - boxInsets.width)
    if (changed(start.height, next.height)) result.height = Math.max(1, next.height - boxInsets.height)
  } else if (mode === 'resize') {
    const factor = (column: 0 | 2) => (next.transform[column] * start.transform[column] + next.transform[column + 1] * start.transform[column + 1])
      / (start.transform[column] ** 2 + start.transform[column + 1] ** 2)
    const x = factor(0), y = factor(2)
    if (changed(x, 1)) result.scaleX = (author.scaleX ?? 1) * x
    if (changed(y, 1)) result.scaleY = (author.scaleY ?? 1) * y
  } else if (mode === 'rotate') {
    const angle = Math.atan2(next.transform[1], next.transform[0]) - Math.atan2(start.transform[1], start.transform[0])
    if (changed(angle, 0)) result.rotation = (author.rotation ?? 0) + Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI
  }
  return result
}

/** Uses the existing gesture math but emits a local record patch, never a fake instance frame.set. */
export class LocalAuthorTransformGesture {
  readonly mode: FreeGestureStart['mode']
  private readonly kind: ComponentAuthorSpot['kind']
  private readonly observation: ComponentAuthorGeometryObservation
  private readonly gesture: FreeTransformGesture
  constructor(start: { geometry: ComponentAuthorGeometryObservation; kind: ComponentAuthorSpot['kind']; mode: FreeGestureStart['mode']; handle?: FreeResizeHandle;
    rootToSurface: AffineMatrix; surfaceToPointer: AffineMatrix; pointer: GeometryPoint }) {
    this.observation = structuredClone(start.geometry); this.mode = start.mode; this.kind = start.kind
    this.gesture = new FreeTransformGesture({ ...start, resizeMode: start.kind === 'text' ? 'box' : 'scale',
      minimumBoxSize: { width: this.observation.boxInsets.width + 1, height: this.observation.boxInsets.height + 1 },
      targets: [{ instanceId: 'transient-local-geometry', frame: this.observation.frame,
        parentToSurface: multiplyMatrices(start.rootToSurface, this.observation.parentToInstance),
        parent: { kind: 'surface', surfaceId: 'transient-local-geometry' }, ancestors: [], preserveAspectRatio: start.kind === 'image' }] })
  }
  update(pointer: GeometryPoint, modifiers: { shift?: boolean; alt?: boolean } = {}) {
    const update = this.gesture.update(pointer, modifiers), edit = update.edits[0]
    if (edit.type !== 'frame.set' || !edit.frame) throw new Error('内部手势没有返回局部几何')
    return { frame: edit.frame, geometry: authorSpotGeometryFromFrame(this.observation, edit.frame, this.mode, this.kind), guides: update.guides }
  }
}

export class AuthorSpotTransformGesture extends LocalAuthorTransformGesture {
  readonly spot: ComponentAuthorSpot
  constructor(start: { spot: ComponentAuthorSpot; mode: FreeGestureStart['mode']; handle?: FreeResizeHandle;
    instanceToSurface: AffineMatrix; surfaceToPointer: AffineMatrix; pointer: GeometryPoint }) {
    if (!start.spot.geometry) throw new Error('此对象尚未取得原父布局，不能保存屏幕测量框为作者位置')
    super({ ...start, geometry: start.spot.geometry, kind: start.spot.kind, rootToSurface: start.instanceToSurface })
    this.spot = structuredClone(start.spot)
  }
}
