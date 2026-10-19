import { SHAPE_DEFINITION } from '../../../../components/shape/authoring'
import { defaultShapeData, shapeDataSchema, type ShapeData, type ShapePath } from '../../../../components/shape/data'
import { WEB_DEFINITION } from '../../../../components/web/data'
import { documentColorChannels } from '../../../../shared/document/color'
import { jsonValueSchema, type ComponentDefinition, type ComponentFrame } from '../../../../shared/contracts/component-platform'
import type { HtmlAssemblyObject, HtmlObjectContent } from '../../../../core/contentApply/assembly/htmlAssembly'
import type { ContentApplyDiagnostic, ContentObjectDraft } from './types'

type ElementContent = Extract<HtmlObjectContent, { kind: 'element' }>
type Command = ShapePath['paths'][number]['commands'][number]
type Point = [number, number]
export type ProfessionalGraphicResult =
  | { kind: 'native'; draft: ContentObjectDraft; definition: ComponentDefinition; definitions?: ComponentDefinition[]; diagnostics?: ContentApplyDiagnostic[] }
  | { kind: 'web'; diagnostic: ContentApplyDiagnostic }

export const GROUP_DEFINITION: ComponentDefinition = { id: 'guoling.group', role: 'content', title: '编组', implementation: { kind: 'builtin', key: 'guoling.group' } }
const px = (value = ''): number | undefined => /^-?(?:\d*\.)?\d+(?:px)?$/.test(value.trim()) ? Number.parseFloat(value) : undefined
const frameOf = (object: HtmlAssemblyObject): ComponentFrame => ({ ...object.frame, transform: [...object.frame.transform] })
const preserved = (object: HtmlAssemblyObject, message: string): ProfessionalGraphicResult => ({ kind: 'web',
  diagnostic: { level: 'info', code: 'html-professional-preserved-web', sourcePath: object.sourcePath, message } })
const color = (value: string) => {
  const channels = documentColorChannels(value)
  return channels && { color: `rgb(${channels.red},${channels.green},${channels.blue})`, opacity: channels.alpha }
}

/** These properties need a DOM/CSS implementation rather than a plain author group. */
function paintReason(content: ElementContent): string | undefined {
  if (Object.keys(content.pseudoElements).length) return '伪元素仍由 Web 保留。'
  for (const name of ['background-image', 'box-shadow', 'filter', 'backdrop-filter', 'clip-path', 'mask-image', '-webkit-mask-image', 'border-image-source', 'animation-name']) {
    if (content.style[name] && content.style[name] !== 'none') return `${name} 仍由 Web 保留。`
  }
  if (parseFloat(content.style['outline-width'] ?? '0') > 0 && content.style['outline-style'] !== 'none') return '轮廓线仍由 Web 保留。'
  return undefined
}

function boxDraft(object: HtmlAssemblyObject, content: ElementContent): ContentObjectDraft | string {
  const style = content.style
  const fill = color(style['background-color'] || 'transparent')
  if (!fill) return '背景色尚无等价原生颜色。'
  if (style['background-clip'] && style['background-clip'] !== 'border-box') return '特殊背景裁切仍由 Web 保留。'
  const sides = ['top', 'right', 'bottom', 'left'].map(side => ({
    width: style[`border-${side}-style`] === 'none' ? 0 : px(style[`border-${side}-width`] || '0'),
    color: style[`border-${side}-color`] || style.color || '#000000', type: style[`border-${side}-style`] || 'none',
  }))
  const borderWidth = sides[0]!.width
  if (borderWidth === undefined || sides.some(side => side.width !== borderWidth)
    || borderWidth > 0 && sides.some(side => side.type !== 'solid' || side.color !== sides[0]!.color)) return '非统一实线边框仍由 Web 保留。'
  const border = color(sides[0]!.color)
  if (!border || borderWidth > 0 && border.opacity !== 1) return '透明边框的背景合成仍由 Web 保留。'
  const radii = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => style[`border-${corner}-radius`] || style['border-radius'] || '0px')
  const radius = px(radii[0])
  if (radius === undefined || radius < 0 || radii.some(value => px(value) !== radius)) return '非统一像素圆角仍由 Web 保留。'
  if (borderWidth > 0 && radius < borderWidth / 2) return '方角边框的尖角连接仍由 Web 保留。'
  const data = defaultShapeData(radius ? 'rounded-rectangle' : 'rectangle')
  data.style = { ...data.style, fillColor: fill.color, fillOpacity: fill.opacity, borderColor: border.color,
    borderOpacity: border.opacity, borderWidth, cornerRadius: radius }
  // CSS borders paint inside the measured border-box; the shared native renderer strokes a path centre.
  // Keep the authored frame and inset only that stroke's disposable path geometry.
  if (borderWidth > 0) {
    const width = object.frame.width, height = object.frame.height, inset = borderWidth / 2
    if (borderWidth >= Math.min(width, height)) return '边框覆盖整个内容盒，仍由 Web 保留。'
    data.pathGeometry = roundedBoxPath(inset, inset, width - borderWidth, height - borderWidth,
      Math.max(0, Math.min(radius, width / 2, height / 2) - inset), width, height)
  }
  const wrapper = Object.fromEntries(Object.entries(object.style).filter(([name]) =>
    !/^(?:background(?:-.+)?|border(?:-.+)?|padding(?:-.+)?|display|gap|row-gap|column-gap|align-items|align-content|justify-items|justify-content)$/.test(name)))
  return { definitionId: SHAPE_DEFINITION.id, data: jsonValueSchema.parse(shapeDataSchema.parse(data)), frame: frameOf(object), style: wrapper }
}

function roundedBoxPath(x: number, y: number, width: number, height: number, radius: number, outerWidth: number, outerHeight: number): ShapePath {
  const point = (x: number, y: number): Point => [x / outerWidth, y / outerHeight]
  const right = x + width, bottom = y + height, r = Math.min(radius, width / 2, height / 2), k = 0.5522847498307936
  const commands: Command[] = [{ kind: 'move', to: point(x + r, y) }, { kind: 'line', to: point(right - r, y) }]
  const curve = (c1: Point, c2: Point, to: Point) => commands.push({ kind: 'cubic', control1: point(...c1), control2: point(...c2), to: point(...to) })
  if (r) curve([right - r + k * r, y], [right, y + r - k * r], [right, y + r])
  commands.push({ kind: 'line', to: point(right, bottom - r) })
  if (r) curve([right, bottom - r + k * r], [right - r + k * r, bottom], [right - r, bottom])
  commands.push({ kind: 'line', to: point(x + r, bottom) })
  if (r) curve([x + r - k * r, bottom], [x, bottom - r + k * r], [x, bottom - r])
  commands.push({ kind: 'line', to: point(x, y + r) })
  if (r) curve([x, y + r - k * r], [x + r - k * r, y], [x + r, y])
  commands.push({ kind: 'close' })
  return { paths: [{ fill: true, stroke: true, commands }] }
}

/** SVG's already parsed tree feeds the existing native path schema; unsupported commands stay SVG. */
function pathCommands(source: string): Command[] | undefined {
  const tokens = source.match(/[a-zA-Z]|[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi) ?? []
  if (source.replace(/[a-zA-Z]|[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?|[\s,]/gi, '')) return undefined
  const commands: Command[] = [], counts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6 }
  let at = 0, letter = '', current: Point = [0, 0], start: Point = [0, 0]
  while (at < tokens.length) {
    if (/^[a-z]$/i.test(tokens[at]!)) letter = tokens[at++]!
    const upper = letter.toUpperCase(), relative = letter !== upper
    if (upper === 'Z') { commands.push({ kind: 'close' }); current = [...start]; letter = ''; continue }
    const count = counts[upper]
    if (!count || at + count > tokens.length || tokens.slice(at, at + count).some(token => /^[a-z]$/i.test(token))) return undefined
    const values = tokens.slice(at, at += count).map(Number)
    if (values.some(value => !Number.isFinite(value))) return undefined
    const point = (offset: number): Point => [values[offset]! + (relative ? current[0] : 0), values[offset + 1]! + (relative ? current[1] : 0)]
    const to: Point = upper === 'H' ? [values[0]! + (relative ? current[0] : 0), current[1]]
      : upper === 'V' ? [current[0], values[0]! + (relative ? current[1] : 0)] : point(count - 2)
    if (upper === 'M') { commands.push({ kind: 'move', to }); start = [...to]; letter = relative ? 'l' : 'L' }
    else if (upper === 'Q') commands.push({ kind: 'quadratic', control: point(0), to })
    else if (upper === 'C') commands.push({ kind: 'cubic', control1: point(0), control2: point(2), to })
    else commands.push({ kind: 'line', to })
    current = to
  }
  return commands.length && commands[0]?.kind === 'move' ? commands : undefined
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
function svgMarkup(content: HtmlObjectContent, localIds: ReadonlySet<string>): string {
  if (content.kind !== 'element') return content.kind === 'comment' ? '' : escape(content.text)
  const localUrls = (value: string) => value.replace(/url\(["']?[^)]*#([^"')]+)["']?\)/g,
    (source, id: string) => localIds.has(id) ? `url(#${id})` : source)
  const attributes = { ...content.attributes, style: Object.entries(content.style).map(([key, value]) => `${key}:${localUrls(value)}`).join(';') }
  return `<${content.tagName}${Object.entries(attributes).map(([key, value]) => ` ${key}="${escape(value)}"`).join('')}>${content.children.map(child => svgMarkup(child, localIds)).join('')}</${content.tagName}>`
}

function svgDraft(object: HtmlAssemblyObject, root: ElementContent, supportCss: string, resourceBindings: Readonly<Record<string, string>>): ProfessionalGraphicResult {
  if (['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']
    .some(name => root.style[name] && px(root.style[name]) !== 0)) return preserved(object, 'SVG 含非零内边距或边框；保留其内容视口与 border-box 的原关系。')
  const viewBox = (root.attributes.viewBox || root.attributes.viewbox || `0 0 ${object.frame.width} ${object.frame.height}`).trim().split(/[\s,]+/).map(Number)
  if (viewBox.length !== 4 || viewBox.some(value => !Number.isFinite(value)) || viewBox[2]! <= 0 || viewBox[3]! <= 0) return preserved(object, 'SVG viewBox 无法对应正式几何；保留 Web。')
  const [x, y, width, height] = viewBox as [number, number, number, number]
  const aspect = root.attributes.preserveAspectRatio || 'xMidYMid meet'
  if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(aspect)) return preserved(object, 'SVG 视口对齐尚无等价映射；保留 Web。')
  let sx = object.frame.width / width, sy = object.frame.height / height, dx = -x * sx, dy = -y * sy
  if (aspect !== 'none') {
    const scale = /\bslice$/.test(aspect) ? Math.max(sx, sy) : Math.min(sx, sy)
    sx = sy = scale
    dx = -x * scale + (object.frame.width - width * scale) * (aspect.startsWith('xMin') ? 0 : aspect.startsWith('xMax') ? 1 : 0.5)
    dy = -y * scale + (object.frame.height - height * scale) * (aspect.includes('YMin') ? 0 : aspect.includes('YMax') ? 1 : 0.5)
  }
  const diagnostics: ContentApplyDiagnostic[] = []
  const definitionsOf = (content: HtmlObjectContent): ElementContent[] => content.kind !== 'element' ? []
    : ['defs', 'style'].includes(content.tagName) ? [content] : content.children.flatMap(definitionsOf)
  const definitions = root.children.flatMap(definitionsOf)
  // A use/paint server may reference a visible sibling rather than a node inside
  // defs. Keep those identity subtrees available as definitions without repainting them.
  const identityRoots = (content: HtmlObjectContent): ElementContent[] => content.kind !== 'element' || ['defs', 'style'].includes(content.tagName) ? []
    : content.attributes.id ? [content] : content.children.flatMap(identityRoots)
  const siblingDefinitions = root.children.flatMap(identityRoots)
  const idsOf = (content: HtmlObjectContent): string[] => content.kind !== 'element' ? []
    : [...(content.attributes.id ? [content.attributes.id] : []), ...content.children.flatMap(idsOf)]
  const localIds = new Set(idsOf(root)), markup = (content: HtmlObjectContent) => svgMarkup(content, localIds)
  const localWeb = (content: ElementContent, reason: string): ContentObjectDraft => {
    diagnostics.push({ level: 'info', code: 'html-svg-part-preserved-web', sourcePath: object.sourcePath,
      message: `SVG <${content.tagName}> ${reason}；其余可表达图元继续原生装配。` })
    const attributes: Record<string, string> = { ...root.attributes, xmlns: 'http://www.w3.org/2000/svg', width: '100%', height: '100%',
      viewBox: viewBox.join(' '), preserveAspectRatio: aspect, style: 'display:block;width:100%;height:100%;overflow:visible' }
    // External placement and group opacity already belong to the native parent.
    delete attributes.transform; delete attributes.opacity
    const open = `<svg${Object.entries(attributes).map(([name, value]) => ` ${name}="${escape(value)}"`).join('')}>`
    const html = `${open}${definitions.map(markup).join('')}${siblingDefinitions.length ? `<defs>${siblingDefinitions.map(markup).join('')}</defs>` : ''}${markup(content)}</svg>`
    return { definitionId: WEB_DEFINITION.id, data: { html, ...(supportCss ? { css: supportCss } : {}),
      ...(Object.keys(resourceBindings).length ? { resourceBindings: { ...resourceBindings } } : {}) },
      frame: { width: object.frame.width, height: object.frame.height, transform: [1, 0, 0, 1, 0, 0] } }
  }
  const convert = (content: ElementContent): ContentObjectDraft[] => {
    if (['title', 'desc', 'metadata', 'defs', 'style'].includes(content.tagName)) return []
    const style = content.style
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return []
    const effect = paintReason(content)
    if (effect) return [localWeb(content, effect)]
    if (style.transform && style.transform !== 'none' || content.attributes.transform) return [localWeb(content, '保留局部变换')]
    if (content.tagName === 'g') return [{ definitionId: GROUP_DEFINITION.id, data: {},
      frame: { width: object.frame.width, height: object.frame.height, transform: [1, 0, 0, 1, 0, 0] },
      style: { opacity: style.opacity || '1' }, children: content.children.flatMap(child => child.kind === 'element' ? convert(child) : []) }]
    const fillValue = style.fill || content.attributes.fill || '#000000', strokeValue = style.stroke || content.attributes.stroke || 'none'
    const fill = fillValue === 'none' ? { color: '#000000', opacity: 0 } : color(fillValue)
    const stroke = strokeValue === 'none' ? { color: '#000000', opacity: 0 } : color(strokeValue)
    const strokeWidth = px(style['stroke-width'] || content.attributes['stroke-width'] || '1')
    if (!fill || !stroke || strokeWidth === undefined || style['fill-rule'] === 'evenodd'
      || stroke.opacity > 0 && (style['stroke-linecap'] && style['stroke-linecap'] !== 'butt'
        || style['stroke-linejoin'] && !['miter', 'round'].includes(style['stroke-linejoin'])
        || style['stroke-dasharray'] && style['stroke-dasharray'] !== 'none'
        || style['vector-effect'] && style['vector-effect'] !== 'none')
      || ['clip-path', 'mask', 'filter', 'marker-start', 'marker-mid', 'marker-end'].some(name => [content.attributes[name], style[name]].some(value => value && value !== 'none'))) return [localWeb(content, '保留当前填充或描边语义')]
    const value = (name: string, fallback = 0) => px(style[name] && style[name] !== 'auto' ? style[name] : content.attributes[name] ?? String(fallback))
    let commands: Command[] | undefined, data = defaultShapeData(), bx = 0, by = 0, bw = 0, bh = 0
    if (content.tagName === 'rect') {
      bx = value('x')!; by = value('y')!; bw = value('width')!; bh = value('height')!
      const rx = value('rx', value('ry') || 0), ry = value('ry', rx || 0)
      if (rx === undefined || ry === undefined || rx !== ry) return [localWeb(content, '保留椭圆圆角')]
      if (stroke.opacity > 0 && rx === 0) return [localWeb(content, '保留方角描边连接')]
      data = defaultShapeData(rx ? 'rounded-rectangle' : 'rectangle'); data.style.cornerRadius = rx
    } else if (['circle', 'ellipse'].includes(content.tagName)) {
      const rx = value(content.tagName === 'circle' ? 'r' : 'rx')!, ry = value(content.tagName === 'circle' ? 'r' : 'ry')!
      bx = value('cx')! - rx; by = value('cy')! - ry; bw = rx * 2; bh = ry * 2; data = defaultShapeData('ellipse')
    } else {
      if (content.tagName === 'path') {
        const measured = style.d && /^path\((["'])([^\\]*)\1\)$/.exec(style.d)
        commands = pathCommands(measured ? measured[2]! : content.attributes.d || '')
      }
      else if (content.tagName === 'line') commands = [{ kind: 'move', to: [value('x1')!, value('y1')!] }, { kind: 'line', to: [value('x2')!, value('y2')!] }]
      else if (['polygon', 'polyline'].includes(content.tagName)) {
        const points = (content.attributes.points || '').trim().split(/[\s,]+/).map(Number)
        if (points.length >= 4 && points.length % 2 === 0 && points.every(Number.isFinite)) commands = points.flatMap((_, index) => index % 2 ? [] : [{ kind: index ? 'line' : 'move', to: [points[index]!, points[index + 1]!] } as Command])
        if (commands && content.tagName === 'polygon') commands.push({ kind: 'close' })
      }
      if (!commands) return [localWeb(content, '保留尚未映射的图元或路径命令')]
      // The shared native renderer uses round joins. Independent open segments have
      // no joins; sharp SVG polyline/polygon joins must retain their local SVG.
      let segments = 0
      const joined = commands.some(command => command.kind === 'move' ? (segments = 0, false)
        : command.kind === 'close' ? segments > 0 : ++segments > 1)
      if (stroke.opacity > 0 && joined && style['stroke-linejoin'] !== 'round') return [localWeb(content, '保留描边的尖角连接')]
      const points = commands.flatMap(command => [...('to' in command ? [command.to] : []), ...('control' in command ? [command.control] : []), ...('control1' in command ? [command.control1, command.control2] : [])])
      bx = Math.min(...points.map(point => point[0])); by = Math.min(...points.map(point => point[1]))
      bw = Math.max(0.001, Math.max(...points.map(point => point[0])) - bx); bh = Math.max(0.001, Math.max(...points.map(point => point[1])) - by)
      const normalized = (point: Point): Point => [(point[0] - bx) / bw, (point[1] - by) / bh]
      data.pathGeometry = { paths: [{ fill: fill.opacity > 0, stroke: stroke.opacity > 0, commands: commands.map(command => ({ ...command,
        ...('to' in command ? { to: normalized(command.to) } : {}), ...('control' in command ? { control: normalized(command.control) } : {}),
        ...('control1' in command ? { control1: normalized(command.control1), control2: normalized(command.control2) } : {}) })) }] }
    }
    if (![bx, by, bw, bh].every(Number.isFinite) || bw <= 0 || bh <= 0) return [localWeb(content, '保留无法直接对应的长度')]
    data.style = { ...data.style, fillColor: fill.color, fillOpacity: fill.opacity * Number(style['fill-opacity'] || content.attributes['fill-opacity'] || 1),
      borderColor: stroke.color, borderOpacity: stroke.opacity * Number(style['stroke-opacity'] || content.attributes['stroke-opacity'] || 1), borderWidth: stroke.opacity ? strokeWidth : 0 }
    return [{ definitionId: SHAPE_DEFINITION.id, data: jsonValueSchema.parse(shapeDataSchema.parse(data)),
      frame: { width: bw, height: bh, transform: [sx, 0, 0, sy, bx * sx + dx, by * sy + dy] }, style: { opacity: style.opacity || '1' } }]
  }
  const children = root.children.flatMap(child => child.kind === 'element' ? convert(child) : [])
  return { kind: 'native', definition: GROUP_DEFINITION, definitions: [SHAPE_DEFINITION, WEB_DEFINITION], diagnostics,
    draft: { definitionId: GROUP_DEFINITION.id, data: {}, frame: frameOf(object), style: { ...object.style }, children } }
}

/** Ordinary measured containers keep their author children; their host owns all placement. */
export function professionalGraphicDraft(object: HtmlAssemblyObject, supportCss = '', resourceBindings: Readonly<Record<string, string>> = {}): ProfessionalGraphicResult | undefined {
  if (!['group', 'svg', 'web'].includes(object.kind)) return undefined
  if (object.retainedSource || object.program) return undefined
  if (object.content?.kind !== 'element') return preserved(object, '对象缺少完整元素；保留 Web。')
  if (object.decorations.length || object.sourceRegions.length || Object.keys(object.pseudoElements).length) return preserved(object, '对象含尚未分离的装饰、伪元素或源码区域；保留 Web。')
  const content = object.content, reason = paintReason(content)
  if (reason) return preserved(object, reason)
  if (object.kind === 'svg') return svgDraft(object, content, supportCss, resourceBindings)
  if (object.kind === 'group') {
    const box = boxDraft(object, { ...content, style: object.style })
    if (typeof box === 'string') return preserved(object, box)
    const data = shapeDataSchema.parse(box.data)
    // A CSS border on the group host shifts absolute children by its width. Paint it
    // as an ordinary native child so measured parent-local coordinates remain exact.
    const children = data.style.fillOpacity > 0 || data.style.borderWidth > 0 ? [{ ...box,
      frame: { width: object.frame.width, height: object.frame.height, transform: [1, 0, 0, 1, 0, 0] as ComponentFrame['transform'] }, style: {} }] : []
    const style = { ...box.style }
    for (const [name, value] of Object.entries(object.style)) if (/^border-(?:radius|(?:top|bottom)-(?:left|right)-radius)$/.test(name)) style[name] = value
    return { kind: 'native', definition: GROUP_DEFINITION, definitions: children.length ? [SHAPE_DEFINITION] : [],
      draft: { definitionId: GROUP_DEFINITION.id, data: {}, frame: frameOf(object), style, ...(children.length ? { children } : {}) } }
  }
  if (!['div', 'span', 'section', 'aside', 'header', 'footer', 'main', 'article', 'figure', 'i', 'b'].includes(content.tagName)
    || object.children.length || content.children.some(child => child.kind === 'element' || child.kind === 'text' && child.text.trim())) return undefined
  const draft = boxDraft(object, content)
  return typeof draft === 'string' ? preserved(object, draft) : { kind: 'native', definition: SHAPE_DEFINITION, draft }
}
