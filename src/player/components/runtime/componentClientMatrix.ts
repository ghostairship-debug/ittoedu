import { multiplyMatrices, transformPoint, type AffineMatrix } from '../../../core/components/geometry'

/** The serialized realm must bind dependencies in this factory's own lexical
 * scope. A bundled import alias need not equal the imported function's name. */
function createComponentClientMatrix(multiply: typeof multiplyMatrices, project: typeof transformPoint) {
  return function componentClientMatrix(element: HTMLElement): AffineMatrix | null {
    const view = element.ownerDocument.defaultView
    if (!view) return null
    const css = view.getComputedStyle(element), rect = element.getBoundingClientRect()
    const width = element.offsetWidth || Number.parseFloat(css.width), height = element.offsetHeight || Number.parseFloat(css.height)
    if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0)) return null
    let matrix: AffineMatrix = [1, 0, 0, 1, 0, 0]
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      const style = view.getComputedStyle(node), raw = style.transform
      if (raw && raw !== 'none') {
        const values = typeof view.DOMMatrixReadOnly === 'function' ? new view.DOMMatrixReadOnly(raw) : null
        const fallback = /^matrix\(([^)]+)\)$/.exec(raw)?.[1].split(',').map(Number)
        if (values && !values.is2D) return null
        const linear: AffineMatrix | null = values ? [values.a, values.b, values.c, values.d, 0, 0]
          : fallback?.length === 6 ? [fallback[0], fallback[1], fallback[2], fallback[3], 0, 0] : null
        if (linear) matrix = multiply(linear, matrix)
      }
    }
    if (Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12) return null
    const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }].map(point => project(matrix, point))
    return [matrix[0], matrix[1], matrix[2], matrix[3], rect.left - Math.min(...corners.map(point => point.x)), rect.top - Math.min(...corners.map(point => point.y))]
  }
}

/** Actual content local coordinates to client coordinates, including parent transforms. */
export const componentClientMatrix = createComponentClientMatrix(multiplyMatrices, transformPoint)

/** Same coordinate reader, with explicit dependencies for a separate realm. */
export function componentClientMatrixRealmSource(): string {
  return `(${createComponentClientMatrix.toString()})(${multiplyMatrices.toString()},${transformPoint.toString()})`
}
