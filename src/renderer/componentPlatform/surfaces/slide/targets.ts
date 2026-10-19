import { frameContainsPoint, frameCorners, frameToSpaceMatrix, IDENTITY_MATRIX, multiplyMatrices, transformPoint, type AffineMatrix, type GeometryPoint } from '../../../../core/components/geometry'
import { lineStrokeHit, resolveNativeLinePoints } from '../../../../shared/nativeLineGeometry'
import { shapeDataSchema } from '../../../../components/shape/data'
import type { ComponentFrame } from '../../../../shared/contracts/component-platform/frame'
import { componentDefinitionBuiltinKey, owningContainer, type ComponentContainer, type CourseProjectV10 } from '../../../../shared/contracts/component-platform/project'

export interface FreeObjectTarget {
  instanceId: string
  frame: ComponentFrame
  parentToSurface: AffineMatrix
  parent: ComponentContainer
  ancestors: string[]
  preserveAspectRatio: boolean
  resizeMode?: 'scale' | 'box'
  directSelection?: boolean
  stroke?: { points: GeometryPoint[]; width: number }
}
export interface FreeBounds { left: number; top: number; right: number; bottom: number; width: number; height: number }

/** Derived from the one author tree. No measured DOM bounds become author frames. */
export function freeSurfaceTargets(project: CourseProjectV10, surfaceId: string): FreeObjectTarget[] {
  const result: FreeObjectTarget[] = []
  const visit = (ids: string[], parent: ComponentContainer, matrix: AffineMatrix, ancestors: string[]) => {
    for (const id of ids) {
      const instance = project.instances[id]
      if (!instance) continue
      const key = componentDefinitionBuiltinKey(project.definitions[instance.definitionId])
      const imageData = instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data) ? instance.data : null
      const shape = key === 'guoling.shape' ? shapeDataSchema.safeParse(instance.data) : null
      if (instance.frame) result.push({ instanceId: id, frame: instance.frame, parentToSurface: matrix, parent,
        ancestors, preserveAspectRatio: key === 'guoling.image' && imageData?.preserveAspectRatio !== false,
        ...(key === 'guoling.text' ? { resizeMode: 'box' as const, directSelection: true } : {}),
        ...(shape?.success && (shape.data.shapeType === 'line' || shape.data.shapeType === 'elbow-arrow') ? {
          stroke: { points: resolveNativeLinePoints(shape.data.lineGeometry, instance.frame.width, instance.frame.height, shape.data.shapeType), width: shape.data.style.borderWidth } } : {}) })
      visit(instance.childIds ?? [], { kind: 'instance', instanceId: id },
        instance.frame ? multiplyMatrices(matrix, instance.frame.transform) : matrix, [...ancestors, id])
    }
  }
  visit(project.global.underlay, { kind: 'global', plane: 'underlay' }, IDENTITY_MATRIX, [])
  const surface = project.surfaces.find(value => value.id === surfaceId)
  if (surface) visit(surface.childIds, { kind: 'surface', surfaceId }, IDENTITY_MATRIX, [])
  visit(project.global.overlay, { kind: 'global', plane: 'overlay' }, IDENTITY_MATRIX, [])
  return result
}

export function freeTargetBounds(target: FreeObjectTarget): FreeBounds {
  return pointsBounds(frameCorners(target.frame, target.parentToSurface))
}
export function pointsBounds(points: readonly GeometryPoint[]): FreeBounds {
  const left = Math.min(...points.map(value => value.x)), right = Math.max(...points.map(value => value.x))
  const top = Math.min(...points.map(value => value.y)), bottom = Math.max(...points.map(value => value.y))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}
export function freeSelectionBounds(targets: readonly FreeObjectTarget[]): FreeBounds | null {
  return targets.length ? pointsBounds(targets.flatMap(target => [...frameCorners(target.frame, target.parentToSurface)])) : null
}

/** Selecting a container excludes descendants so one gesture never transforms them twice. */
export function selectedFreeTargets(targets: readonly FreeObjectTarget[], ids: readonly string[]): FreeObjectTarget[] {
  const selected = new Set(ids)
  return targets.filter(target => selected.has(target.instanceId) && !target.ancestors.some(id => selected.has(id)))
}

/** Text remains directly editable inside a card; other children use explicit deep selection. */
export function hitFreeObject(targets: readonly FreeObjectTarget[], point: GeometryPoint, deep = false, surfaceToPointer: AffineMatrix = IDENTITY_MATRIX): FreeObjectTarget | null {
  for (const target of [...targets].reverse()) {
    const matrix = frameToSpaceMatrix(target.frame, target.parentToSurface)
    if (matrix[0] * matrix[3] - matrix[1] * matrix[2] === 0) continue
    if (target.stroke) {
      const screen = multiplyMatrices(surfaceToPointer, matrix), at = transformPoint(surfaceToPointer, point)
      const points = target.stroke.points
      const hit = points.slice(1).some((end, index) => {
        const start = points[index]!, dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy)
        if (!length) return false
        const nx = -dy / length, ny = dx / length
        const width = target.stroke!.width * Math.hypot(screen[0] * nx + screen[2] * ny, screen[1] * nx + screen[3] * ny)
        return lineStrokeHit(at, [transformPoint(screen, start), transformPoint(screen, end)], width, 1)
      })
      if (!hit) continue
    } else if (!frameContainsPoint(target.frame, point, target.parentToSurface)) continue
    if (deep || target.directSelection || !target.ancestors.length) return target
    return targets.find(value => value.instanceId === target.ancestors[0]) ?? target
  }
  return null
}

/** SAT intersection avoids selecting empty AABB corners beside a rotated object. */
export function marqueeFreeTargets(targets: readonly FreeObjectTarget[], start: GeometryPoint, end: GeometryPoint): string[] {
  const rect = [{ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y) },
    { x: Math.max(start.x, end.x), y: Math.min(start.y, end.y) },
    { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y) },
    { x: Math.min(start.x, end.x), y: Math.max(start.y, end.y) }]
  const intersects = (polygon: readonly GeometryPoint[]) => {
    const axes: GeometryPoint[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }]
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!
      axes.push({ x: a.y - b.y, y: b.x - a.x })
    }
    return axes.every(axis => {
      const a = polygon.map(p => p.x * axis.x + p.y * axis.y), b = rect.map(p => p.x * axis.x + p.y * axis.y)
      return Math.max(...a) >= Math.min(...b) && Math.max(...b) >= Math.min(...a)
    })
  }
  const ids = targets.filter(target => !target.ancestors.length && intersects(frameCorners(target.frame, target.parentToSurface))).map(target => target.instanceId)
  return ids
}

export function sameFreeTarget(a: FreeObjectTarget, b: FreeObjectTarget): boolean {
  return a.instanceId === b.instanceId && a.frame.width === b.frame.width && a.frame.height === b.frame.height
    && a.frame.transform.every((value, i) => value === b.frame.transform[i])
    && a.parentToSurface.every((value, i) => value === b.parentToSurface[i])
    && JSON.stringify(a.parent) === JSON.stringify(b.parent)
}

export function ownerOfSelection(project: CourseProjectV10, ids: readonly string[]): ComponentContainer | null {
  const owners = ids.map(id => owningContainer(project, id))
  const owner = owners[0]
  return owner && owners.every(value => JSON.stringify(value) === JSON.stringify(owner)) ? owner : null
}
