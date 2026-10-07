/**
 * Legacy stage size. Spatial's design viewport and the pre-M19 slide fallback
 * still use it. It is not the current Slide canvas.
 */
export const STAGE_VIEWPORT_WIDTH = 1280
export const STAGE_VIEWPORT_HEIGHT = 720

import { fitPage, NO_PAGE_INSETS } from './pageFrame'
import { invertMatrix, transformPoint, type AffineMatrix, type GeometryPoint } from '../core/components/geometry'

/** One design-to-host mapping. Content and HUD may each have a different host rect. */
export function createStageGeometry(referenceSize: { width: number; height: number },
  viewportRect: { x: number; y: number; width: number; height: number }) {
  const fit = fitPage(viewportRect, referenceSize, NO_PAGE_INSETS, 'contain')
  const authorToViewport: AffineMatrix = [fit.scale, 0, 0, fit.scale, viewportRect.x + fit.left, viewportRect.y + fit.top]
  const viewportToAuthor = invertMatrix(authorToViewport)
  const origin = transformPoint(viewportToAuthor, viewportRect)
  return {
    referenceSize, viewportRect, scale: fit.scale, authorToViewport, viewportToAuthor,
    clipRect: viewportRect,
    visibleAuthorRect: { ...origin, width: viewportRect.width / fit.scale, height: viewportRect.height / fit.scale },
    toViewport: (point: GeometryPoint) => transformPoint(authorToViewport, point),
    toAuthor: (point: GeometryPoint) => transformPoint(viewportToAuthor, point),
  }
}
