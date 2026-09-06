import type { NativeLinearGradient, NativePathGeometry } from '../../shared/contracts/native-v1'

export function drawingMlPathGeometryXml(geometry: NativePathGeometry): string {
  const extent = 1_000_000
  const point = ([x, y]: [number, number]) => `<a:pt x="${Math.round(x * extent)}" y="${Math.round(y * extent)}"/>`
  const paths = geometry.paths.map(path => {
    const commands = path.commands.map(command => {
      const name = ({ move: 'moveTo', line: 'lnTo', quadratic: 'quadBezTo', cubic: 'cubicBezTo', close: 'close' } as const)[command.kind]
      const controls = command.kind === 'cubic' ? point(command.control1) + point(command.control2) : command.kind === 'quadratic' ? point(command.control) : ''
      return `<a:${name}>${controls}${'to' in command ? point(command.to) : ''}</a:${name}>`
    }).join('')
    return `<a:path w="${extent}" h="${extent}" fill="${path.fill ? 'norm' : 'none'}" stroke="${path.stroke ? '1' : '0'}" extrusionOk="0">${commands}</a:path>`
  }).join('')
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>${paths}</a:pathLst></a:custGeom>`
}

// DrawingML unscaled shading spans the projection of the frame. Preserve the
// Native gradient on that span, including interpolated colors at cropped ends.
export function drawingMlGradientStops(gradient: NativeLinearGradient, width: number, height: number) {
  const dx = (gradient.end[0] - gradient.start[0]) * width
  const dy = (gradient.end[1] - gradient.start[1]) * height
  const length = Math.hypot(dx, dy)
  const ux = dx / length, uy = dy / length
  const minimum = Math.min(0, width * ux) + Math.min(0, height * uy)
  const span = Math.abs(width * ux) + Math.abs(height * uy)
  const start = gradient.start[0] * width * ux + gradient.start[1] * height * uy
  const stops = gradient.stops.map(stop => ({ ...stop, offset: (start + stop.offset * length - minimum) / span }))
  const at = (offset: number) => {
    const after = stops.findIndex(stop => stop.offset > offset)
    if (after === 0) return { ...stops[0], offset }
    if (after < 0) return { ...stops.at(-1)!, offset }
    const left = stops[after - 1], right = stops[after]
    const ratio = (offset - left.offset) / (right.offset - left.offset)
    const channels = [1, 3, 5].map(index => {
      const a = Number.parseInt(left.color.slice(index, index + 2), 16)
      const b = Number.parseInt(right.color.slice(index, index + 2), 16)
      return Math.round(a + (b - a) * ratio).toString(16).padStart(2, '0')
    })
    return { offset, color: `#${channels.join('')}`, opacity: left.opacity + (right.opacity - left.opacity) * ratio }
  }
  const visibleStops = [
    ...(stops.some(stop => stop.offset < 0) && !stops.some(stop => stop.offset === 0) ? [at(0)] : []),
    ...stops.filter(stop => stop.offset >= 0 && stop.offset <= 1),
    ...(stops.some(stop => stop.offset > 1) && !stops.some(stop => stop.offset === 1) ? [at(1)] : []),
  ]
  return { angle: Math.round(((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360) * 60000), stops: visibleStops.length >= 2 ? visibleStops : [at(0), at(1)] }
}

export function drawingMlGradientFillXml(gradient: NativeLinearGradient, width: number, height: number, opacity: number): string {
  const { angle, stops } = drawingMlGradientStops(gradient, width, height)
  const list = stops.map(stop => `<a:gs pos="${Math.round(stop.offset * 100000)}"><a:srgbClr val="${stop.color.slice(1)}"><a:alpha val="${Math.round(stop.opacity * opacity * 100000)}"/></a:srgbClr></a:gs>`).join('')
  return `<a:gradFill rotWithShape="1"><a:gsLst>${list}</a:gsLst><a:lin ang="${angle}" scaled="0"/><a:tileRect/></a:gradFill>`
}
