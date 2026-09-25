import { DEFAULT_SLIDE_CANVAS, SLIDE_CANVAS_MAX, SLIDE_CANVAS_MIN, type SlideCanvasSize } from '../../shared/slideCanvas'

export const PUBLISHED_STAGE_SELECTOR = [
  '.slide-published-adapter',
  '.flow-surface-host',
  '.spatial-surface',
].join(', ')

function stageCanvas(stage: HTMLElement): SlideCanvasSize {
  const width = Number(stage.dataset.canvasWidth)
  const height = Number(stage.dataset.canvasHeight)
  if (
    Number.isInteger(width) && Number.isInteger(height)
    && width >= SLIDE_CANVAS_MIN && width <= SLIDE_CANVAS_MAX
    && height >= SLIDE_CANVAS_MIN && height <= SLIDE_CANVAS_MAX
  ) return { width, height }
  return { width: DEFAULT_SLIDE_CANVAS.width, height: DEFAULT_SLIDE_CANVAS.height }
}

/**
 * Letterbox each authored stage into its host. A stage declares its logical
 * size with `data-canvas-width` / `data-canvas-height`. Spatial keeps the
 * legacy design viewport when it does not declare one. Flow is responsive.
 */
export function fitPublishedCourseStage(container: HTMLElement): void {
  const hostWidth = container.clientWidth
  const hostHeight = container.clientHeight
  for (const stage of container.querySelectorAll<HTMLElement>(PUBLISHED_STAGE_SELECTOR)) {
    if (stage.classList.contains('flow-surface-host')) continue
    const canvas = stageCanvas(stage)
    const width = hostWidth > 1 ? hostWidth : canvas.width
    const height = hostHeight > 1 ? hostHeight : canvas.height
    const scale = Math.min(width / canvas.width, height / canvas.height)
    const left = (width - canvas.width * scale) / 2
    const top = (height - canvas.height * scale) / 2
    stage.style.position = 'absolute'
    stage.style.transformOrigin = '0 0'
    stage.style.transform = `scale(${scale})`
    stage.style.left = `${left}px`
    stage.style.top = `${top}px`
    stage.style.width = `${canvas.width}px`
    stage.style.height = `${canvas.height}px`
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
