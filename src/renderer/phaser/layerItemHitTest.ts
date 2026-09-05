import type { LayerItem } from '../../shared/courseProjectTypes'
import {
  lineStrokeHit,
  resolveNativeLinePoints,
  type LinePoint,
} from '../../shared/nativeLineGeometry'
import {
  pointInsideRotatedWorldRect,
  rotateWorldPoint,
  rotatedWorldRectAxisBounds,
  worldRectCenter,
  type StagePoint,
  type StageRect,
} from '../authoring/stageViewportTransform'

/** Geometry-only bounds shared by Surface-specific LayerItem hit adapters. */
export interface LayerItemHitBounds {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/**
 * Stroke hit payload for `line` / `elbow-arrow` shapes: local-frame polyline
 * points plus the saved visual border width. The hit width is derived per
 * pointer event (`max(12/viewportScale, borderWidth)`); the visual stroke is
 * never enlarged.
 */
export interface LayerItemLineStroke {
  readonly points: readonly LinePoint[]
  readonly borderWidth: number
}

/**
 * Surface-neutral LayerItem hit target. Surface adapters may enrich this with
 * coordinate space, source and pointer-conversion policy.
 */
export interface LayerItemHitTarget {
  readonly layerItemId: string
  readonly kind: LayerItem['kind']
  readonly nativeType: string | null
  readonly bounds: LayerItemHitBounds
  readonly hittable: boolean
  readonly locked: boolean
  readonly writable: boolean
  readonly lineStroke?: LayerItemLineStroke
}

function nativeTypeOf(item: LayerItem): string | null {
  return item.kind === 'native' ? item.content.nativeType : null
}

function lineStrokeOf(item: LayerItem): LayerItemLineStroke | undefined {
  if (item.kind !== 'native' || item.content.nativeType !== 'shape') return undefined
  const data = item.content.data as {
    shapeType?: unknown
    lineGeometry?: Parameters<typeof resolveNativeLinePoints>[0]
    style?: { borderWidth?: unknown }
  }
  if (data.shapeType !== 'line' && data.shapeType !== 'elbow-arrow') return undefined
  const borderWidth = typeof data.style?.borderWidth === 'number' ? data.style.borderWidth : 0
  return {
    points: resolveNativeLinePoints(
      data.lineGeometry,
      item.frame.width,
      item.frame.height,
      data.shapeType,
    ),
    borderWidth,
  }
}

export function layerItemBounds(item: LayerItem): LayerItemHitBounds {
  return {
    x: item.frame.x,
    y: item.frame.y,
    width: item.frame.width,
    height: item.frame.height,
    rotation: item.rotation,
  }
}

export function layerItemIsHittable(
  item: LayerItem,
  effectiveVisible = item.visible,
  scope: 'scene' | 'surface' | 'global' = 'scene',
): boolean {
  if (!effectiveVisible) return false
  if (item.hitPolicy === 'pass-through') return false
  if (
    item.kind === 'native' &&
    item.content.nativeType === 'teacher-controller' &&
    scope !== 'global'
  ) {
    return false
  }
  return item.kind === 'native' ||
    item.kind === 'component' ||
    item.kind === 'runtime'
}

export function adaptLayerItemHit(
  item: LayerItem,
  effectiveVisible = item.visible,
  scope: 'scene' | 'surface' | 'global' = 'scene',
): LayerItemHitTarget {
  const bounds = layerItemBounds(item)
  const hittable = layerItemIsHittable(item, effectiveVisible, scope)
  return {
    layerItemId: item.layerItemId,
    kind: item.kind,
    nativeType: nativeTypeOf(item),
    bounds,
    hittable,
    locked: item.locked,
    writable: hittable && !item.locked,
    ...(lineStrokeOf(item) ? { lineStroke: lineStrokeOf(item) } : {}),
  }
}

export function hitTestLayerItems(
  targets: readonly LayerItemHitTarget[],
  worldPoint: StagePoint,
  viewportScale = 1,
): LayerItemHitTarget | null {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]
    if (!target?.hittable) continue
    if (target.lineStroke) {
      // Thin lines own an independent stroke hit zone; the frame bbox must not
      // swallow pointer events far away from the visible stroke.
      const center = worldRectCenter(target.bounds)
      const local = rotateWorldPoint(worldPoint, center, -target.bounds.rotation)
      const relative = { x: local.x - target.bounds.x, y: local.y - target.bounds.y }
      if (lineStrokeHit(
        relative,
        target.lineStroke.points,
        target.lineStroke.borderWidth,
        viewportScale,
      )) {
        return target
      }
      continue
    }
    if (pointInsideRotatedWorldRect(worldPoint, target.bounds, target.bounds.rotation)) {
      return target
    }
  }
  return null
}

export function marqueeHitLayerItems(
  targets: readonly LayerItemHitTarget[],
  worldRect: StageRect,
): LayerItemHitTarget[] {
  const marquee = {
    left: Math.min(worldRect.x, worldRect.x + worldRect.width),
    right: Math.max(worldRect.x, worldRect.x + worldRect.width),
    top: Math.min(worldRect.y, worldRect.y + worldRect.height),
    bottom: Math.max(worldRect.y, worldRect.y + worldRect.height),
  }
  return targets.filter((target) => {
    if (!target.hittable) return false
    const bounds = rotatedWorldRectAxisBounds(target.bounds, target.bounds.rotation)
    return bounds.left <= marquee.right &&
      bounds.right >= marquee.left &&
      bounds.top <= marquee.bottom &&
      bounds.bottom >= marquee.top
  })
}
