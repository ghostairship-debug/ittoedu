import type { LayerItem } from '../../shared/courseProjectTypes'
import type {
  SpatialCoordinateSpace,
  SpatialEditorLayerScope,
  SpatialEditorLayerView,
} from '../course/spatialEditorView'
import {
  adaptLayerItemHit,
  hitTestLayerItems,
  layerItemBounds,
  marqueeHitLayerItems,
  type LayerItemHitBounds,
  type LayerItemHitTarget,
} from './layerItemHitTest'
import type { StagePoint, StageRect } from '../authoring/stageViewportTransform'

/**
 * Geometry-only Spatial hit adapter. Reuses the neutral LayerItem hittability rules
 * (Native / Component / Runtime, pass-through, teacher-controller only on
 * viewport/global) and tags the R5-A coordinate space. Phaser is not required.
 */
export interface V9SpatialHitTarget extends LayerItemHitTarget {
  readonly coordinateSpace: SpatialCoordinateSpace
  readonly source: SpatialEditorLayerScope
}

export type { LayerItemHitBounds as V9SpatialHitBounds }

export function v9SpatialLayerItemBounds(item: LayerItem): LayerItemHitBounds {
  return layerItemBounds(item)
}

export function adaptV9SpatialLayerHit(layer: SpatialEditorLayerView): V9SpatialHitTarget {
  const slideScope = layer.coordinateSpace === 'viewport' ? 'global' : 'scene'
  const adapted = adaptLayerItemHit(
    layer.item as LayerItem,
    layer.effectiveVisible,
    slideScope,
  )
  return {
    ...adapted,
    coordinateSpace: layer.coordinateSpace,
    source: layer.source,
  }
}

export function adaptV9SpatialEditorLayers(
  layers: readonly SpatialEditorLayerView[],
): V9SpatialHitTarget[] {
  return layers.map(adaptV9SpatialLayerHit)
}

/**
 * Viewport/global first, then world (including page-shared surface items).
 * Camera frames / path / relation are not in this list and must not steal.
 */
export function hitTestV9SpatialLayerItems(
  targets: readonly V9SpatialHitTarget[],
  points: { readonly viewport: StagePoint; readonly world: StagePoint },
): V9SpatialHitTarget | null {
  const viewportHit = hitTestLayerItems(
    targets.filter((target) => target.coordinateSpace === 'viewport'),
    points.viewport,
  )
  if (viewportHit) return viewportHit as V9SpatialHitTarget
  const worldHit = hitTestLayerItems(
    targets.filter((target) => target.coordinateSpace === 'world'),
    points.world,
  )
  return (worldHit as V9SpatialHitTarget | null) ?? null
}

export function marqueeHitV9SpatialWorldLayerItems(
  targets: readonly V9SpatialHitTarget[],
  worldRect: StageRect,
): V9SpatialHitTarget[] {
  return marqueeHitLayerItems(
    targets.filter((target) => target.coordinateSpace === 'world'),
    worldRect,
  ) as V9SpatialHitTarget[]
}
