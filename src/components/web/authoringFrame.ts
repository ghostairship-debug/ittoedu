type AuthoringFrameMatrix = [number, number, number, number, number, number]

/** Portable facts used by both accessible and message-owned document carriers.
 * Callers serializing a realm pass this factory explicitly with their adapter. */
export function createAuthoringFrameGeometry() {
  type Matrix = AuthoringFrameMatrix
  const multiply = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]
  const transformRect = (rect: { x: number; y: number; width: number; height: number }, matrix: Matrix) => {
    const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(([x, y]) => ({ x: matrix[0] * x! + matrix[2] * y! + matrix[4], y: matrix[1] * x! + matrix[3] * y! + matrix[5] }))
    const xs = corners.map(value => value.x), ys = corners.map(value => value.y)
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  const frameMatrix = (frame: HTMLIFrameElement, childSize?: { width: number; height: number }): Matrix | undefined => {
    const view = frame.ownerDocument.defaultView, rect = frame.getBoundingClientRect()
    if (!view || !rect.width || !rect.height) return
    const css = view.getComputedStyle(frame), number = (value: string) => parseFloat(value) || 0
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') return
    const paddingX = number(css.paddingLeft) + number(css.paddingRight), paddingY = number(css.paddingTop) + number(css.paddingBottom)
    const borderX = number(css.borderLeftWidth) + number(css.borderRightWidth), borderY = number(css.borderTopWidth) + number(css.borderBottomWidth)
    // Computed CSS dimensions retain fractions; offset dimensions are a fallback
    // for non-layout consumers rather than a source of frame scale.
    const cssWidth = parseFloat(css.width), cssHeight = parseFloat(css.height)
    const MatrixClass = (view as Window & { DOMMatrix?: typeof DOMMatrix }).DOMMatrix
    const width = !MatrixClass && frame.offsetWidth || (Number.isFinite(cssWidth) ? cssWidth + (css.boxSizing === 'border-box' ? 0 : paddingX + borderX) : frame.offsetWidth || frame.clientWidth || rect.width)
    const height = !MatrixClass && frame.offsetHeight || (Number.isFinite(cssHeight) ? cssHeight + (css.boxSizing === 'border-box' ? 0 : paddingY + borderY) : frame.offsetHeight || frame.clientHeight || rect.height)
    if (!(width > 0 && height > 0)) return
    let linear: Matrix = [1, 0, 0, 1, 0, 0]
    if (MatrixClass) {
      for (let node: Element | null = frame; node; node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null) {
        const style = view.getComputedStyle(node)
        if (style.display === 'none' || style.opacity !== '' && Number(style.opacity) === 0) return
        const transform = new MatrixClass(style.transform === 'none' || !style.transform ? undefined : style.transform)
        if (!transform.is2D) return
        const rotate = style.rotate && style.rotate !== 'none' ? /^(?:z\s+)?(-?[\d.]+)(deg|rad|turn)$/.exec(style.rotate) : undefined
        if (style.rotate && style.rotate !== 'none' && !rotate) return
        const angle = rotate ? Number(rotate[1]) * (rotate[2] === 'deg' ? Math.PI / 180 : rotate[2] === 'turn' ? Math.PI * 2 : 1) : 0
        const scale = style.scale && style.scale !== 'none' ? style.scale.split(/\s+/).map(Number) : [1, 1]
        if (scale.some(value => !Number.isFinite(value)) || scale.length > 2) return
        const zoom = number(style.zoom) || 1, x = scale[0]! * zoom, y = (scale[1] ?? scale[0])! * zoom
        linear = multiply(multiply([Math.cos(angle) * x, Math.sin(angle) * x, -Math.sin(angle) * y, Math.cos(angle) * y, 0, 0],
          [transform.a, transform.b, transform.c, transform.d, 0, 0]), linear)
      }
    } else linear = [rect.width / width, 0, 0, rect.height / height, 0, 0]
    const bounds = transformRect({ x: 0, y: 0, width, height }, linear)
    linear[4] = rect.left - bounds.x; linear[5] = rect.top - bounds.y
    const contentWidth = Math.max(0, width - borderX - paddingX), contentHeight = Math.max(0, height - borderY - paddingY)
    if (!(contentWidth > 0 && contentHeight > 0)) return
    if (childSize && !(childSize.width > 0 && childSize.height > 0)) return
    return multiply(linear, [childSize ? contentWidth / childSize.width : 1, 0, 0, childSize ? contentHeight / childSize.height : 1,
      (MatrixClass ? number(css.borderLeftWidth) : frame.clientLeft) + number(css.paddingLeft),
      (MatrixClass ? number(css.borderTopWidth) : frame.clientTop) + number(css.paddingTop)])
  }
  const transformTextStyle = (style: Record<string, string | undefined> | undefined, matrix: Matrix) => {
    if (!style) return undefined
    const parts = /^matrix\(([^)]+)\)$/.exec(style.transform ?? '')?.[1]?.split(',').map(Number)
    const local: Matrix = parts?.length === 6 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!, parts[2]!, parts[3]!, 0, 0] : [1, 0, 0, 1, 0, 0]
    const combined = multiply([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0], local)
    return { ...style, transform: `matrix(${combined.join(',')})`, 'transform-origin': '0 0' }
  }
  return { frameMatrix, transformTextStyle, multiply, transformRect }
}
