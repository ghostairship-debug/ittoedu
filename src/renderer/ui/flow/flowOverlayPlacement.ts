import type { ComponentFrame } from '../../../shared/contracts/component-platform'
import { composeMatrices, invertMatrix } from '../../../core/components/geometry'
import { componentClientMatrix } from '../../../player/components/runtime/componentClientMatrix'

/** Freeze the current reading presentation in paper coordinates before changing carrier.
 * Local size plus its affine matrix retains internal layout/scale, unlike a client bounding box. */
export function flowFrameFromClientElement(element: HTMLElement | null | undefined, paper: HTMLElement | null | undefined): ComponentFrame | null {
  if (!element || !paper || !paper.contains(element)) return null
  const contentMatrix = componentClientMatrix(element), paperMatrix = componentClientMatrix(paper)
  if (!contentMatrix || !paperMatrix) return null
  // The chart's SVG keeps its authored design canvas while Flow fits that
  // canvas inside the reading viewport. Measuring only the host would resize
  // the chart's design canvas and change every label and plot on conversion.
  const runtimeRoot = element.matches('[data-component-runtime-root]') ? element : element.querySelector<HTMLElement>('[data-component-runtime-root]')
  const chart = runtimeRoot?.querySelector<SVGSVGElement>('svg[data-native-chart-id]')
  if (chart && chart.dataset.nativeChartId === runtimeRoot?.dataset.componentRuntimeRoot) {
    const canvas = chart.viewBox?.baseVal, matrix = chart.getScreenCTM?.()
    if (canvas?.width && canvas.height && matrix) return {
      width: canvas.width, height: canvas.height,
      transform: [...composeMatrices(invertMatrix(paperMatrix), [matrix.a, matrix.b, matrix.c, matrix.d,
        matrix.e + matrix.a * canvas.x + matrix.c * canvas.y, matrix.f + matrix.b * canvas.x + matrix.d * canvas.y])],
    }
  }
  const style = element.ownerDocument.defaultView!.getComputedStyle(element)
  const width = element.offsetWidth || Number.parseFloat(style.width), height = element.offsetHeight || Number.parseFloat(style.height)
  if (!(width > 0 && height > 0)) return null
  return { width, height, transform: [...composeMatrices(invertMatrix(paperMatrix), contentMatrix)] }
}
