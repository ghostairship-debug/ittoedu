import type { LayerItem } from '../../shared/courseProjectTypes'
import {
  pointInsideRotatedWorldRect,
  rotatedWorldRectAxisBounds,
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
}

function nativeTypeOf(item: LayerItem): string | null {
  return item.kind === 'native' ? item.content.nativeType : null
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
  }
}

export function hitTestLayerItems(
  targets: readonly LayerItemHitTarget[],
  worldPoint: StagePoint,
): LayerItemHitTarget | null {
  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index]
    if (!target?.hittable) continue
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
