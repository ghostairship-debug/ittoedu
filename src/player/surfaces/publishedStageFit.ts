import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'

export const PUBLISHED_STAGE_SELECTOR = [
  '.slide-published-adapter',
  '.flow-surface-host',
  '.spatial-surface',
].join(', ')

function measureHostSize(container: HTMLElement): { width: number; height: number } {
  const width = container.clientWidth
  const height = container.clientHeight
  return {
    width: width > 1 ? width : CANVAS_WIDTH,
    height: height > 1 ? height : CANVAS_HEIGHT,
  }
}

/**
 * Letterbox the authored 1280×720 stage into its host. Spatial HUD and
 * teacher controllers are authored in that canvas; sizing the host to the
 * window and keeping those frames would clip them.
 */
export function fitPublishedCourseStage(container: HTMLElement): void {
  const { width, height } = measureHostSize(container)
  const scale = Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT)
  const left = (width - CANVAS_WIDTH * scale) / 2
  const top = (height - CANVAS_HEIGHT * scale) / 2
  for (const stage of container.querySelectorAll<HTMLElement>(PUBLISHED_STAGE_SELECTOR)) {
    // Flow body and overlays share the responsive document's CSS-pixel layout.
    if (stage.classList.contains('flow-surface-host')) continue
    stage.style.position = 'absolute'
    stage.style.transformOrigin = '0 0'
    stage.style.transform = `scale(${scale})`
    stage.style.left = `${left}px`
    stage.style.top = `${top}px`
    stage.style.width = `${CANVAS_WIDTH}px`
    stage.style.height = `${CANVAS_HEIGHT}px`
    stage.dataset.stageFitScale = String(scale)
  }
}

export function attachPublishedCourseStageFit(container: HTMLElement): () => void {
  fitPublishedCourseStage(container)
  if (typeof ResizeObserver !== 'function') return () => undefined
  const observer = new ResizeObserver(() => fitPublishedCourseStage(container))
  observer.observe(container)
  return () => observer.disconnect()
}
