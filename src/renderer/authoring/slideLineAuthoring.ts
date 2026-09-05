import {
  getDefaultLineGeometry,
  normalizeElbowLineAuthoring,
  normalizeStraightLineAuthoring,
  resolveNativeLinePoints,
  LINE_MIN_FRAME_SIZE,
  type LineFrame,
  type LinePoint,
  type NormalizedLineAuthoring,
} from '../../shared/nativeLineGeometry'
import type { NativeLineGeometry } from '../../shared/contracts/native-v1/types'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import { rotateWorldPoint, type StagePoint, type StageRect } from './stageViewportTransform'

/** Screen-space snap threshold in CSS px; converted with the stage scale. */
export const LINE_SNAP_SCREEN_PX = 8

export interface LineSnapAxes {
  readonly xs: readonly number[]
  readonly ys: readonly number[]
}

export interface LineSnapResult {
  readonly point: StagePoint
  readonly guideX?: number
  readonly guideY?: number
}

/**
 * Collects the snap axes for line drawing and line handle drags: stage edges
 * and center lines plus the axis bounds (edges and centers) of other visible,
 * unlocked layer items.
 */
export function collectLineSnapAxes(
  targets: readonly {
    readonly layerItemId: string
    readonly bounds: StageRect & { readonly rotation: number }
    readonly hittable: boolean
    readonly locked: boolean
  }[],
  excludeLayerItemId?: string,
): LineSnapAxes {
  const xs: number[] = [0, CANVAS_WIDTH / 2, CANVAS_WIDTH]
  const ys: number[] = [0, CANVAS_HEIGHT / 2, CANVAS_HEIGHT]
  for (const target of targets) {
    if (target.layerItemId === excludeLayerItemId) continue
    if (!target.hittable || target.locked) continue
    const { x, y, width, height } = target.bounds
    xs.push(x, x + width / 2, x + width)
    ys.push(y, y + height / 2, y + height)
  }
  return { xs, ys }
}

/**
 * Snaps each axis independently to the nearest candidate within
 * `LINE_SNAP_SCREEN_PX / viewportScale` world units. `disabled` (Alt) bypasses.
 */
export function snapLinePoint(
  world: StagePoint,
  axes: LineSnapAxes,
  viewportScale: number,
  disabled = false,
): LineSnapResult {
  if (disabled) return { point: world }
  const scale = Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1
  const threshold = LINE_SNAP_SCREEN_PX / scale
  let bestX: { distance: number; value: number } | null = null
  for (const candidate of axes.xs) {
    const distance = Math.abs(candidate - world.x)
    if (distance <= threshold && (!bestX || distance < bestX.distance)) {
      bestX = { distance, value: candidate }
    }
  }
  let bestY: { distance: number; value: number } | null = null
  for (const candidate of axes.ys) {
    const distance = Math.abs(candidate - world.y)
    if (distance <= threshold && (!bestY || distance < bestY.distance)) {
      bestY = { distance, value: candidate }
    }
  }
  return {
    point: {
      x: bestX?.value ?? world.x,
      y: bestY?.value ?? world.y,
    },
    guideX: bestX?.value,
    guideY: bestY?.value,
  }
}

/** Commit geometry for a fresh straight/elbow draw from two world points. */
export function drawLineAuthoringGeometry(
  shapeType: 'line' | 'elbow-arrow',
  startWorld: StagePoint,
  endWorld: StagePoint,
): NormalizedLineAuthoring | null {
  if (shapeType === 'line') {
    return normalizeStraightLineAuthoring(startWorld, endWorld)
  }
  return normalizeElbowLineAuthoring(startWorld, endWorld, 'horizontal',
    (startWorld.x + endWorld.x) / 2)
}

export type LineHandleKind = 'start' | 'end' | 'elbow'

export interface LineHandleDragInput {
  readonly shapeType: 'line' | 'elbow-arrow'
  readonly frame: LineFrame
  readonly rotation: number
  /** Stored geometry; undefined resolves to the legacy default without materializing. */
  readonly lineGeometry?: NativeLineGeometry
  readonly handle: LineHandleKind
  /** New world-space position of the dragged handle (already snapped). */
  readonly world: StagePoint
}

/**
 * World-space handle positions for the current selection overlay and the
 * proximity hit test. `elbow` is present only for elbow geometry.
 */
export function lineHandleWorldPoints(
  frame: LineFrame,
  rotation: number,
  lineGeometry: NativeLineGeometry | undefined,
  shapeType: 'line' | 'elbow-arrow',
): { start: StagePoint; end: StagePoint; elbow?: StagePoint } {
  const geometry = lineGeometry ?? getDefaultLineGeometry(shapeType)
  const local = resolveNativeLinePoints(geometry, frame.width, frame.height)
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  const toWorld = (point: LinePoint): StagePoint => rotateWorldPoint(
    { x: frame.x + point.x, y: frame.y + point.y },
    center,
    rotation,
  )
  return {
    start: toWorld(local[0]!),
    end: toWorld(local.at(-1)!),
    ...(geometry.kind === 'elbow' ? { elbow: toWorld(local[1]!) } : {}),
  }
}

/**
 * Recomputes frame + normalized geometry for one handle drag. Rotation is
 * preserved: all math happens in the unrotated frame space, then the new
 * axis-aligned bbox center is rotated back into world space.
 * Returns null for a degenerate result (caller must not commit).
 */
export function dragLineHandleGeometry(input: LineHandleDragInput): NormalizedLineAuthoring | null {
  const { frame, rotation, shapeType } = input
  const geometry = input.lineGeometry ?? getDefaultLineGeometry(shapeType)
  const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  const local = resolveNativeLinePoints(geometry, frame.width, frame.height)
  // Unrotated stage coordinates of every polyline point.
  const absolute = local.map((point) => ({
    x: frame.x + point.x,
    y: frame.y + point.y,
  }))
  const target = rotateWorldPoint(input.world, center, -rotation)

  if (input.handle === 'elbow') {
    if (geometry.kind !== 'elbow') return null
    const coordinate = geometry.axis === 'horizontal' ? target.x : target.y
    const normalized = normalizeElbowLineAuthoring(
      absolute[0]!,
      absolute.at(-1)!,
      geometry.axis,
      coordinate,
    )
    return normalized ? rotateNormalizedFrame(normalized, center, rotation) : null
  }

  const start = input.handle === 'start' ? target : absolute[0]!
  const end = input.handle === 'end' ? target : absolute.at(-1)!
  const normalized = geometry.kind === 'elbow'
    ? (() => {
        const positionCoordinate = geometry.axis === 'horizontal'
          ? frame.x + geometry.position * frame.width
          : frame.y + geometry.position * frame.height
        return normalizeElbowLineAuthoring(start, end, geometry.axis, positionCoordinate)
      })()
    : normalizeStraightLineAuthoring(start, end)
  return normalized ? rotateNormalizedFrame(normalized, center, rotation) : null
}

function rotateNormalizedFrame(
  authored: NormalizedLineAuthoring,
  center: StagePoint,
  rotation: number,
): NormalizedLineAuthoring {
  if (rotation === 0) return authored
  const localCenter = {
    x: authored.frame.x + authored.frame.width / 2,
    y: authored.frame.y + authored.frame.height / 2,
  }
  const worldCenter = rotateWorldPoint(localCenter, center, rotation)
  return {
    frame: {
      x: worldCenter.x - authored.frame.width / 2,
      y: worldCenter.y - authored.frame.height / 2,
      width: authored.frame.width,
      height: authored.frame.height,
    },
    lineGeometry: authored.lineGeometry,
  }
}

export { LINE_MIN_FRAME_SIZE }
