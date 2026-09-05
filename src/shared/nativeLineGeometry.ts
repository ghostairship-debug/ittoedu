import type { NativeLineGeometry } from './contracts/native-v1/types'

export interface LinePoint {
  x: number
  y: number
}

export const DEFAULT_STRAIGHT_LINE_GEOMETRY: NativeLineGeometry = {
  kind: 'straight',
  start: [0, 0.5],
  end: [1, 0.5],
}

export const DEFAULT_ELBOW_LINE_GEOMETRY: NativeLineGeometry = {
  kind: 'elbow',
  start: [0, 0.2],
  end: [1, 0.8],
  axis: 'horizontal',
  position: 0.55,
}

export function getDefaultLineGeometry(shapeType: 'line' | 'elbow-arrow'): NativeLineGeometry {
  return shapeType === 'line' ? DEFAULT_STRAIGHT_LINE_GEOMETRY : DEFAULT_ELBOW_LINE_GEOMETRY
}

export function resolveNativeLinePoints(
  geometry: Extract<NativeLineGeometry, { kind: 'straight' }>,
  width: number,
  height: number,
): [LinePoint, LinePoint]
export function resolveNativeLinePoints(
  geometry: Extract<NativeLineGeometry, { kind: 'elbow' }>,
  width: number,
  height: number,
): [LinePoint, LinePoint, LinePoint, LinePoint]
export function resolveNativeLinePoints(
  geometry: NativeLineGeometry,
  width: number,
  height: number,
): [LinePoint, LinePoint] | [LinePoint, LinePoint, LinePoint, LinePoint]
export function resolveNativeLinePoints(
  geometry: NativeLineGeometry | undefined | null,
  width: number,
  height: number,
  fallbackShapeType?: 'line' | 'elbow-arrow',
): [LinePoint, LinePoint] | [LinePoint, LinePoint, LinePoint, LinePoint]
export function resolveNativeLinePoints(
  geometry: NativeLineGeometry | undefined | null,
  width: number,
  height: number,
  fallbackShapeType: 'line' | 'elbow-arrow' = 'line',
): [LinePoint, LinePoint] | [LinePoint, LinePoint, LinePoint, LinePoint] {
  const actualGeom = geometry ?? getDefaultLineGeometry(fallbackShapeType)
  const w = Number.isFinite(width) ? width : 0
  const h = Number.isFinite(height) ? height : 0

  if (actualGeom.kind === 'straight') {
    return [
      { x: actualGeom.start[0] * w, y: actualGeom.start[1] * h },
      { x: actualGeom.end[0] * w, y: actualGeom.end[1] * h },
    ]
  }

  const startPoint: LinePoint = {
    x: actualGeom.start[0] * w,
    y: actualGeom.start[1] * h,
  }
  const endPoint: LinePoint = {
    x: actualGeom.end[0] * w,
    y: actualGeom.end[1] * h,
  }

  if (actualGeom.axis === 'horizontal') {
    const midX = actualGeom.position * w
    return [
      startPoint,
      { x: midX, y: startPoint.y },
      { x: midX, y: endPoint.y },
      endPoint,
    ]
  }

  const midY = actualGeom.position * h
  return [
    startPoint,
    { x: startPoint.x, y: midY },
    { x: endPoint.x, y: midY },
    endPoint,
  ]
}

export function lineHitWidth(borderWidth: number, viewportScale: number): number {
  const scale = Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
  const stroke = Number.isFinite(borderWidth) && borderWidth >= 0 ? borderWidth : 0
  return Math.max(12 / scale, stroke)
}

/** Minimum axis-aligned frame a drawn or handle-edited line may occupy. */
export const LINE_MIN_FRAME_SIZE = 16

export interface LineFrame {
  x: number
  y: number
  width: number
  height: number
}

export interface NormalizedLineAuthoring {
  frame: LineFrame
  lineGeometry: NativeLineGeometry
}

function unitPoint(point: LinePoint, left: number, top: number, width: number, height: number): [number, number] {
  return [
    Math.min(1, Math.max(0, (point.x - left) / width)),
    Math.min(1, Math.max(0, (point.y - top) / height)),
  ]
}

function lineAuthoringBounds(
  points: readonly LinePoint[],
  minimumSize: number,
): { left: number; top: number; width: number; height: number } {
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const width = Math.max(minimumSize, maxX - minX)
  const height = Math.max(minimumSize, maxY - minY)
  return {
    left: (minX + maxX) / 2 - width / 2,
    top: (minY + maxY) / 2 - height / 2,
    width,
    height,
  }
}

function degenerate(start: [number, number], end: [number, number]): boolean {
  return start[0] === end[0] && start[1] === end[1]
}

/**
 * Straight draw/handle commit geometry: two points in one coordinate space are
 * wrapped into an axis-aligned frame (min 16×16) plus 0–1 normalized geometry.
 * Returns null when the points collapse to a degenerate segment.
 */
export function normalizeStraightLineAuthoring(
  start: LinePoint,
  end: LinePoint,
  minimumSize = LINE_MIN_FRAME_SIZE,
): NormalizedLineAuthoring | null {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null
  const bounds = lineAuthoringBounds([start, end], minimumSize)
  const geometry: NativeLineGeometry = {
    kind: 'straight',
    start: unitPoint(start, bounds.left, bounds.top, bounds.width, bounds.height),
    end: unitPoint(end, bounds.left, bounds.top, bounds.width, bounds.height),
  }
  if (degenerate(geometry.start, geometry.end)) return null
  return {
    frame: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
    lineGeometry: geometry,
  }
}

/**
 * Elbow draw/handle commit geometry. `elbowCoordinate` is the absolute axis
 * coordinate of the middle segment (x for horizontal axis, y for vertical).
 */
export function normalizeElbowLineAuthoring(
  start: LinePoint,
  end: LinePoint,
  axis: 'horizontal' | 'vertical',
  elbowCoordinate: number,
  minimumSize = LINE_MIN_FRAME_SIZE,
): NormalizedLineAuthoring | null {
  if (![start.x, start.y, end.x, end.y, elbowCoordinate].every(Number.isFinite)) return null
  const midA: LinePoint = axis === 'horizontal'
    ? { x: elbowCoordinate, y: start.y }
    : { x: start.x, y: elbowCoordinate }
  const midB: LinePoint = axis === 'horizontal'
    ? { x: elbowCoordinate, y: end.y }
    : { x: end.x, y: elbowCoordinate }
  const bounds = lineAuthoringBounds([start, midA, midB, end], minimumSize)
  const geometry: NativeLineGeometry = {
    kind: 'elbow',
    start: unitPoint(start, bounds.left, bounds.top, bounds.width, bounds.height),
    end: unitPoint(end, bounds.left, bounds.top, bounds.width, bounds.height),
    axis,
    position: axis === 'horizontal'
      ? Math.min(1, Math.max(0, (elbowCoordinate - bounds.left) / bounds.width))
      : Math.min(1, Math.max(0, (elbowCoordinate - bounds.top) / bounds.height)),
  }
  if (degenerate(geometry.start, geometry.end)) return null
  return {
    frame: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height },
    lineGeometry: geometry,
  }
}

/** Shortest distance from `point` to the polyline through `points`. */
export function distanceToLinePoints(
  point: LinePoint,
  points: readonly LinePoint[],
): number {
  let best = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0,
        ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    best = Math.min(best, Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)))
  }
  return best
}

/**
 * Hit test for the stroke of a line/elbow polyline. `points` and `point` share
 * one coordinate space; the visual stroke width is never enlarged.
 */
export function lineStrokeHit(
  point: LinePoint,
  points: readonly LinePoint[],
  borderWidth: number,
  viewportScale: number,
): boolean {
  if (points.length < 2) return false
  return distanceToLinePoints(point, points) <= lineHitWidth(borderWidth, viewportScale) / 2
}

/**
 * Properties shape-type switch invariant: `line` keeps only straight geometry,
 * `elbow-arrow` keeps only elbow geometry (start/end preserved), other shapes
 * must not carry `lineGeometry` at all.
 */
export function convertLineGeometryForShapeType(
  geometry: NativeLineGeometry | undefined,
  shapeType: 'line' | 'elbow-arrow',
): NativeLineGeometry
export function convertLineGeometryForShapeType(
  geometry: NativeLineGeometry | undefined,
  shapeType: string,
): NativeLineGeometry | undefined
export function convertLineGeometryForShapeType(
  geometry: NativeLineGeometry | undefined,
  shapeType: string,
): NativeLineGeometry | undefined {
  if (shapeType !== 'line' && shapeType !== 'elbow-arrow') return undefined
  const start: [number, number] = geometry ? [...geometry.start] : [...DEFAULT_STRAIGHT_LINE_GEOMETRY.start] as [number, number]
  const end: [number, number] = geometry ? [...geometry.end] : [...DEFAULT_STRAIGHT_LINE_GEOMETRY.end] as [number, number]
  if (shapeType === 'line') return { kind: 'straight', start, end }
  const elbowDefaults = DEFAULT_ELBOW_LINE_GEOMETRY as Extract<NativeLineGeometry, { kind: 'elbow' }>
  return {
    kind: 'elbow',
    start,
    end,
    axis: geometry?.kind === 'elbow' ? geometry.axis : elbowDefaults.axis,
    position: geometry?.kind === 'elbow' ? geometry.position : elbowDefaults.position,
  }
}
