import type { StagePoint } from '../authoring/stageViewportTransform'

export {
  adaptLayerItemHit as adaptV9SlideLayerItemHit,
  hitTestLayerItems as hitTestV9SlideLayerItems,
  layerItemBounds as v9SlideLayerItemBounds,
  layerItemIsHittable as v9SlideLayerItemIsHittable,
  marqueeHitLayerItems as marqueeHitV9SlideLayerItems,
  type LayerItemHitBounds as V9SlideHitBounds,
  type LayerItemHitTarget as V9SlideHitTarget,
} from './layerItemHitTest'

/**
 * Phaser 1280×720 logical space is Project world space. CSS zoom/pan lives on
 * the Workspace stage stack, so pointer.worldX/worldY are already world coords.
 */
export function editorPhaserPointerToWorld(pointer: {
  readonly worldX: number
  readonly worldY: number
}): StagePoint {
  return { x: pointer.worldX, y: pointer.worldY }
}
