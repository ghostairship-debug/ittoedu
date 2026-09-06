import type { NativePathCommand, NativeShapeContent } from './contracts/native-v1'
import { resolveNativeShapePath } from './nativeShapePath'

export function nativePathData(commands: NativePathCommand[], width: number, height: number): string {
  const point = ([x, y]: [number, number]) => `${x * width} ${y * height}`
  return commands.map(command => {
    switch (command.kind) {
      case 'move': return `M${point(command.to)}`
      case 'line': return `L${point(command.to)}`
      case 'quadratic': return `Q${point(command.control)} ${point(command.to)}`
      case 'cubic': return `C${point(command.control1)} ${point(command.control2)} ${point(command.to)}`
      case 'close': return 'Z'
    }
  }).join(' ')
}

let nextGradientId = 0
export function createNativePathSvg(dom: Document, data: NativeShapeContent, width: number, height: number): SVGSVGElement {
  const geometry = resolveNativeShapePath(data, width, height)
  if (!geometry) throw new Error('自由路径缺少正式几何')
  const ns = 'http://www.w3.org/2000/svg'
  const svg = dom.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  Object.assign(svg.style, { width: '100%', height: '100%', display: 'block', overflow: 'visible' })
  const style = data.style
  let fill = style.fillColor
  if (style.fillGradient) {
    const definition = dom.createElementNS(ns, 'linearGradient')
    const id = `native-path-gradient-${++nextGradientId}`
    definition.id = id
    definition.setAttribute('gradientUnits', 'userSpaceOnUse')
    const gradient = style.fillGradient
    for (const [key, value] of Object.entries({ x1: gradient.start[0] * width, y1: gradient.start[1] * height, x2: gradient.end[0] * width, y2: gradient.end[1] * height })) definition.setAttribute(key, String(value))
    for (const stop of gradient.stops) {
      const element = dom.createElementNS(ns, 'stop')
      element.setAttribute('offset', String(stop.offset))
      element.setAttribute('stop-color', stop.color)
      element.setAttribute('stop-opacity', String(stop.opacity))
      definition.appendChild(element)
    }
    const defs = dom.createElementNS(ns, 'defs')
    defs.appendChild(definition); svg.appendChild(defs)
    fill = `url(#${id})`
  }
  for (const path of geometry.paths) {
    const element = dom.createElementNS(ns, 'path')
    element.setAttribute('d', nativePathData(path.commands, width, height))
    element.setAttribute('fill', path.fill ? fill : 'none')
    element.setAttribute('fill-opacity', String(style.fillOpacity))
    element.setAttribute('fill-rule', 'nonzero')
    element.setAttribute('stroke', path.stroke && style.borderWidth > 0 ? style.borderColor : 'none')
    element.setAttribute('stroke-opacity', String(style.borderOpacity))
    element.setAttribute('stroke-width', String(style.borderWidth))
    element.setAttribute('stroke-linejoin', 'round')
    element.setAttribute('stroke-linecap', style.lineStyle === 'dotted' ? 'round' : 'butt')
    const strokeWidth = Math.max(1, style.borderWidth)
    if (style.lineStyle !== 'solid') element.setAttribute('stroke-dasharray', style.lineStyle === 'dotted' ? `${strokeWidth} ${Math.max(3, strokeWidth * 1.8)}` : `${Math.max(6, strokeWidth * 3)} ${Math.max(4, strokeWidth * 2)}`)
    svg.appendChild(element)
  }
  return svg
}
