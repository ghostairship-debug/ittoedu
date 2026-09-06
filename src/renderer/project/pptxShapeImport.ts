import { nativePathGeometrySchema, nativeLinearGradientSchema, nativeBraceGeometrySchema, type NativeBraceGeometry, type NativePathCommand, type NativePathGeometry, type NativeLinearGradient } from '../../shared/contracts/native-v1'
import { pptxReject, xmlChildren } from './pptxPackage'

const child = (node: Element, name: string) => xmlChildren(node).find(element => element.localName === name)
function number(node: Element, key: string, fallback?: number): number {
  const raw = node.getAttribute(key)
  if (raw === null && fallback !== undefined) return fallback
  if (raw === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return pptxReject('路径或渐变', `${key} 需要直接数值，不支持几何公式`)
  const value = Number(raw)
  if (!Number.isFinite(value)) return pptxReject('路径或渐变', `${key} 不是有限数值`)
  return value
}

export function parsePptxCustomGeometry(geometry: Element, flipX = false, flipY = false): NativePathGeometry {
  for (const element of xmlChildren(geometry)) {
    if (!['avLst', 'gdLst', 'ahLst', 'cxnLst', 'rect', 'pathLst'].includes(element.localName)) pptxReject('自由路径', `不支持 ${element.localName}`)
    if (['avLst', 'gdLst', 'ahLst'].includes(element.localName) && xmlChildren(element).length) pptxReject('自由路径公式', '当前只转换直接数值路径')
  }
  const list = child(geometry, 'pathLst')
  if (!list) return pptxReject('自由路径', '缺少路径列表')
  const paths = xmlChildren(list).map(path => {
    if (path.localName !== 'path') return pptxReject('自由路径', '路径列表包含未知元素')
    const width = number(path, 'w'), height = number(path, 'h')
    if (width <= 0 || height <= 0) return pptxReject('自由路径', '路径坐标范围必须为正')
    const fill = path.getAttribute('fill') ?? 'norm'
    if (!['norm', 'none'].includes(fill)) return pptxReject('自由路径填充', `不支持 ${fill}`)
    const point = (element: Element): [number, number] => {
      if (element.localName !== 'pt') return pptxReject('自由路径', '指令包含非坐标元素')
      const x = number(element, 'x') / width, y = number(element, 'y') / height
      return [flipX ? 1 - x : x, flipY ? 1 - y : y]
    }
    const commands = xmlChildren(path).map((command): NativePathCommand => {
      const points = xmlChildren(command).map(point)
      if (command.localName === 'moveTo' && points.length === 1) return { kind: 'move', to: points[0] }
      if (command.localName === 'lnTo' && points.length === 1) return { kind: 'line', to: points[0] }
      if (command.localName === 'quadBezTo' && points.length === 2) return { kind: 'quadratic', control: points[0], to: points[1] }
      if (command.localName === 'cubicBezTo' && points.length === 3) return { kind: 'cubic', control1: points[0], control2: points[1], to: points[2] }
      if (command.localName === 'close' && points.length === 0) return { kind: 'close' }
      return pptxReject('自由路径指令', `${command.localName} 未支持或坐标数量不正确`)
    })
    return { fill: fill === 'norm', stroke: !['0', 'false'].includes(path.getAttribute('stroke') ?? ''), commands }
  })
  const parsed = nativePathGeometrySchema.safeParse({ paths })
  if (!parsed.success) return pptxReject('自由路径', parsed.error.issues[0]?.message ?? '无效路径')
  return parsed.data
}

function presetAdjustments(preset: Element, defaults: Record<string, number>): Record<string, number> {
  const values = { ...defaults }
  const seen = new Set<string>()
  const adjustments = child(preset, 'avLst')
  for (const adjustment of adjustments ? xmlChildren(adjustments) : []) {
    const name = adjustment.getAttribute('name') ?? ''
    const formula = adjustment.getAttribute('fmla') ?? ''
    if (adjustment.localName !== 'gd' || !(name in defaults) || seen.has(name) || !/^val -?\d+$/.test(formula)) return pptxReject('形状参数', '只支持已知且唯一的直接数值调整')
    seen.add(name); values[name] = Number(formula.slice(4))
  }
  return values
}

export function parsePptxRightArrow(preset: Element, width: number, height: number): NativePathGeometry {
  const values = presetAdjustments(preset, { adj1: 50000, adj2: 50000 })
  const shaft = Math.max(0, Math.min(100000, values.adj1)) / 100000
  const head = Math.max(0, Math.min(width, Math.min(width, height) * values.adj2 / 100000)) / width
  const x = 1 - head, top = (1 - shaft) / 2, bottom = 1 - top
  const points: [number, number][] = [[0, top], [x, top], [x, 0], [1, 0.5], [x, 1], [x, bottom], [0, bottom]]
  return { paths: [{ fill: true, stroke: true, commands: [
    { kind: 'move', to: points[0] }, ...points.slice(1).map(to => ({ kind: 'line' as const, to })), { kind: 'close' },
  ] }] }
}

export function parsePptxBraceGeometry(preset: Element): NativeBraceGeometry {
  const values = presetAdjustments(preset, { adj1: 8333, adj2: 50000 })
  const parsed = nativeBraceGeometrySchema.safeParse({ curvatureRatio: Math.max(0, values.adj1) / 100000, midpoint: Math.max(0, Math.min(100000, values.adj2)) / 100000 })
  if (!parsed.success) return pptxReject('括号参数', '调整值超出支持范围')
  return parsed.data
}

/** Wedge round-rectangle uses the preset's explicit tail and radius equations.
 * Only these known adjustments are evaluated; arbitrary OOXML formulas are rejected. */
export function parsePptxRoundCallout(preset: Element, width: number, height: number): NativePathGeometry {
  const { adj1, adj2, adj3 } = presetAdjustments(preset, { adj1: -20833, adj2: 62500, adj3: 16667 })
  if (adj3 < 0 || adj3 > 50000) return pptxReject('标注圆角', '圆角调整超出支持范围')
  const dx = adj1 / 100000, dy = adj2 / 100000
  const tip: [number, number] = [width * (0.5 + dx), height * (0.5 + dy)]
  const radius = Math.min(width, height) * adj3 / 100000
  const k = 4 / 3 * Math.tan(Math.PI / 8)
  const x1 = width * (dx > 0 ? 7 : 2) / 12, x2 = width * (dx > 0 ? 10 : 5) / 12
  const y1 = height * (dy > 0 ? 7 : 2) / 12, y2 = height * (dy > 0 ? 10 : 5) / 12
  const side = Math.abs(dy) > Math.abs(dx) ? dy > 0 ? 'bottom' : 'top' : dx > 0 ? 'right' : 'left'
  const normalize = ([x, y]: [number, number]): [number, number] => [x / width, y / height]
  const commands: NativePathCommand[] = [{ kind: 'move', to: normalize([0, radius]) }]
  const line = (to: [number, number]) => commands.push({ kind: 'line', to: normalize(to) })
  const curve = (a: [number, number], b: [number, number], to: [number, number]) => commands.push({ kind: 'cubic', control1: normalize(a), control2: normalize(b), to: normalize(to) })
  curve([0, radius * (1 - k)], [radius * (1 - k), 0], [radius, 0])
  line([x1, 0]); if (side === 'top') line(tip); line([x2, 0]); line([width - radius, 0])
  curve([width - radius * (1 - k), 0], [width, radius * (1 - k)], [width, radius])
  line([width, y1]); if (side === 'right') line(tip); line([width, y2]); line([width, height - radius])
  curve([width, height - radius * (1 - k)], [width - radius * (1 - k), height], [width - radius, height])
  line([x2, height]); if (side === 'bottom') line(tip); line([x1, height]); line([radius, height])
  curve([radius * (1 - k), height], [0, height - radius * (1 - k)], [0, height - radius])
  line([0, y2]); if (side === 'left') line(tip); line([0, y1]); commands.push({ kind: 'close' })
  const parsed = nativePathGeometrySchema.safeParse({ paths: [{ fill: true, stroke: true, commands }] })
  if (!parsed.success) return pptxReject('标注几何', parsed.error.issues[0]?.message ?? '无效标注')
  return parsed.data
}

export function parsePptxGradient(gradient: Element, width: number, height: number, color: (node: Element | undefined, fallback: string) => string): { fillColor: string; fillOpacity: number; fillGradient?: NativeLinearGradient } {
  const list = child(gradient, 'gsLst')
  if (!list) return pptxReject('渐变', '缺少色标')
  const stops = xmlChildren(list).map(stop => {
    if (stop.localName !== 'gs') return pptxReject('渐变', '色标包含未知元素')
    const colorNode = xmlChildren(stop)[0]
    const alpha = colorNode && child(colorNode, 'alpha')
    return { offset: number(stop, 'pos') / 100000, color: color(stop, '#ffffff'), opacity: alpha ? number(alpha, 'val') / 100000 : 1 }
  })
  if (stops.length < 2) return pptxReject('渐变', '至少需要两个色标')
  const validated = nativeLinearGradientSchema.safeParse({ kind: 'linear', start: [0, 0], end: [1, 0], stops })
  if (!validated.success) return pptxReject('渐变', validated.error.issues[0]?.message ?? '无效色标')
  if (stops.every(stop => stop.color === stops[0].color && stop.opacity === stops[0].opacity)) return { fillColor: stops[0].color, fillOpacity: stops[0].opacity }
  if (gradient.getAttribute('rotWithShape') === '0' || gradient.getAttribute('rotWithShape') === 'false') return pptxReject('渐变', '不支持独立于形状旋转的渐变')
  if (gradient.getAttribute('flip') && gradient.getAttribute('flip') !== 'none') return pptxReject('渐变', '不支持平铺翻转')
  const tile = child(gradient, 'tileRect')
  if (tile && ['l', 't', 'r', 'b'].some(key => number(tile, key, 0) !== 0)) return pptxReject('渐变', '不支持非默认平铺范围')
  const linear = child(gradient, 'lin')
  if (!linear || child(gradient, 'path')) return pptxReject('渐变', '当前支持纯色等价或线性渐变')
  const angle = number(linear, 'ang', 0) / 60000 * Math.PI / 180
  const scaled = ['1', 'true'].includes(linear.getAttribute('scaled') ?? '')
  const dx = Math.cos(angle) * (scaled ? width : 1), dy = Math.sin(angle) * (scaled ? height : 1)
  const length = Math.hypot(dx, dy)
  const ux = dx / length, uy = dy / length
  const span = Math.abs(width * ux) + Math.abs(height * uy)
  const start: [number, number] = [(width / 2 - ux * span / 2) / width, (height / 2 - uy * span / 2) / height]
  const end: [number, number] = [(width / 2 + ux * span / 2) / width, (height / 2 + uy * span / 2) / height]
  return { fillColor: stops[0].color, fillOpacity: 1, fillGradient: nativeLinearGradientSchema.parse({ kind: 'linear', start, end, stops }) }
}
