import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type { LayerItem } from '../../shared/courseProjectTypes'
import type { ShapeType, TextRun, TextRunStyle } from '../../shared/contracts/native-v1'
import { createImageNode, createShapeNode, createTextNode } from './nativeNodeFactories'
import { createImageAssetImport, readImageDimensions } from './assetManager'
import type { CourseImportedAsset } from './v9AssetAdapter'
import { openPptxPackage, validatePptxRelationships, PPTX_IMPORT_LIMITS, PptxImportError, pptxReject, pptxRelationshipId, xmlAll, xmlChildren, xmlFirst, type PptxPackage, type PptxImportIssue } from './pptxPackage'

export interface PptxSlideDraft { title: string; backgroundColor: string; items: LayerItem[] }
export interface PptxImportDraft { slides: PptxSlideDraft[]; assets: CourseImportedAsset[]; notes: string[] }
const child = (node: Element, name: string) => xmlChildren(node).find(n => n.localName === name)
const flag = (node: Element | undefined, name: string) => ['1', 'true'].includes(node?.getAttribute(name) ?? '')
const numeric = (node: Element | undefined, attr: string, fallback?: number): number => {
  const raw = node?.getAttribute(attr)
  if (raw === null || raw === undefined) { if (fallback !== undefined) return fallback; return pptxReject('几何', `缺少 ${attr}`) }
  const value = Number(raw)
  if (!Number.isFinite(value)) return pptxReject('几何', `${attr} 不是有限数值`)
  return value
}
const shapeMap: Partial<Record<string, ShapeType>> = { rect: 'rectangle', roundRect: 'rounded-rectangle', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', line: 'line', rightArrow: 'arrow-right', leftArrow: 'arrow-left', upArrow: 'arrow-up', downArrow: 'arrow-down' }

/** Import a declared flat subset. All objects are checked before any project write. */
export async function parsePptxImport(bytes: Uint8Array): Promise<PptxImportDraft> {
  const pkg = openPptxPackage(bytes)
  const main = pkg.xml('ppt/presentation.xml')
  const size = xmlFirst(main, 'sldSz')
  const width = numeric(size, 'cx'), height = numeric(size, 'cy')
  if (width <= 0 || height <= 0) pptxReject('页面尺寸', '页面宽高必须大于零')
  const scale = Math.min(CANVAS_WIDTH / width, CANVAS_HEIGHT / height)
  const origin = { x: (CANVAS_WIDTH - width * scale) / 2, y: (CANVAS_HEIGHT - height * scale) / 2 }
  const slideRefs = xmlAll(main, 'sldId')
  if (!slideRefs.length || slideRefs.length > PPTX_IMPORT_LIMITS.slides) pptxReject('页数', '仅支持 1–100 页')
  const mainRels = pkg.relationships('ppt/presentation.xml')
  const issues: PptxImportIssue[] = []
  const slides: PptxSlideDraft[] = [], assets: CourseImportedAsset[] = []
  const assetByPath = new Map<string, CourseImportedAsset>()
  let objectCount = 0
  for (const [index, ref] of slideRefs.entries()) {
    const page = index + 1
    try {
      const relationship = mainRels.find(r => r.id === pptxRelationshipId(ref))
      if (!relationship || relationship.external || !relationship.type.endsWith('/slide')) pptxReject('损坏关系', '页面关系无效')
      const path = relationship.target
      const slide = pkg.xml(path), rels = pkg.relationships(path)
      if (rels.some(r => r.external)) pptxReject('外部对象', '请先把链接媒体或超链接转换为普通内嵌内容')
      const theme = themeColors(pkg, path)
      const color = (node: Element | undefined, fallback: string): string => {
        if (!node) return fallback
        const rgb = xmlFirst(node, 'srgbClr'), scheme = xmlFirst(node, 'schemeClr')
        const source = rgb ?? scheme
        if (!source) return pptxReject('颜色', '仅支持 RGB 或主题纯色')
        if (xmlChildren(source).some(n => n.localName !== 'alpha')) pptxReject('颜色效果', '不支持颜色变换')
        const result = rgb?.getAttribute('val') ?? theme[scheme?.getAttribute('val') ?? '']
        if (!result || !/^[\da-f]{6}$/i.test(result)) return pptxReject('颜色', '无法解析主题色')
        return `#${result}`
      }
      const forbidden = ['timing', 'transition', 'AlternateContent', 'graphicFrame', 'grpSp', 'cxnSp', 'oleObj', 'videoFile', 'audioFile', 'custGeom', 'gradFill', 'pattFill', 'effectDag', 'scene3d', 'sp3d', 'hlinkClick', 'hlinkMouseOver']
      for (const name of forbidden) if (xmlAll(slide, name).length) pptxReject(name, '当前受限导入不支持此对象或效果')
      for (const effect of xmlAll(slide, 'effectLst')) if (xmlChildren(effect).length) pptxReject('阴影/效果', '请移除效果后再导入')
      rejectInheritedObjects(pkg, path)
      const tree = xmlFirst(slide, 'spTree')
      if (!tree) pptxReject('页面结构', '缺少对象树')
      const items: LayerItem[] = []
      for (const object of xmlChildren(tree)) {
        if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(object.localName)) continue
        if (++objectCount > PPTX_IMPORT_LIMITS.objects) pptxReject('对象数量', '最多导入 2000 个对象')
        if (!['sp', 'pic'].includes(object.localName)) pptxReject(object.localName, '不支持的页面对象')
        if (xmlFirst(object, 'ph')) pptxReject('占位符', '请先转换为普通文本框或形状')
        const transform = xmlFirst(object, 'xfrm')
        if (!transform) pptxReject('继承几何', '对象需要显式位置与尺寸')
        if (flag(transform, 'flipH') || flag(transform, 'flipV')) pptxReject('翻转', '当前不支持翻转对象')
        const off = xmlFirst(transform, 'off'), ext = xmlFirst(transform, 'ext')
        const geometry = { x: numeric(off, 'x') * scale + origin.x, y: numeric(off, 'y') * scale + origin.y, width: numeric(ext, 'cx') * scale, height: numeric(ext, 'cy') * scale, rotation: numeric(transform, 'rot', 0) / 60000, visible: !flag(xmlFirst(object, 'cNvPr'), 'hidden') }
        if (geometry.width <= 0 || geometry.height <= 0) pptxReject('几何', '对象宽高必须大于零')
        const name = xmlFirst(object, 'cNvPr')?.getAttribute('name') || `对象 ${items.length + 1}`
        const push = (node: Parameters<typeof sceneNodeToCourseLayerItem>[0]) => items.push(sceneNodeToCourseLayerItem(node, items.length))
        if (object.localName === 'pic') {
          const mask = xmlFirst(object, 'prstGeom')?.getAttribute('prst')
          if (mask && mask !== 'rect') pptxReject('图片形状蒙版', '请先应用图片蒙版')
          if (xmlAll(object, 'srcRect').some(n => Array.from(n.attributes).some(a => Number(a.value) !== 0))) pptxReject('裁剪图片', '请先应用图片裁剪')
          const blip = xmlFirst(object, 'blip')
          if (blip && xmlChildren(blip).length) pptxReject('图片效果', '请先把图片效果应用到图片文件')
          if (xmlFirst(object, 'tile')) pptxReject('平铺图片', '请先转换为普通图片')
          const imageRel = rels.find(r => r.id === (blip ? pptxRelationshipId(blip, 'embed') : ''))
          if (!imageRel || imageRel.external || !imageRel.type.endsWith('/image')) pptxReject('损坏关系', '图片关系缺失或类型错误')
          const extension = imageRel.target.split('.').pop()?.toLowerCase()
          const mimeType = extension === 'png' ? 'image/png' : ['jpg', 'jpeg'].includes(extension ?? '') ? 'image/jpeg' : undefined
          if (!mimeType) pptxReject('图片类型', '首批仅支持内嵌 PNG / JPEG')
          let asset = assetByPath.get(imageRel.target)
          if (!asset) {
            const data = pkg.files[imageRel.target]!
            const dimensions = await readImageDimensions(data, mimeType)
            if (dimensions.width * dimensions.height > 40_000_000) pptxReject('图片尺寸', '图片不能超过 4000 万像素')
            asset = createImageAssetImport({ name: imageRel.target.split('/').pop()!, mimeType, bytes: data }, { dimensions })
            assetByPath.set(imageRel.target, asset); assets.push(asset)
          }
          push(createImageNode({ ...geometry, name, assetId: asset.meta.id, fit: 'stretch' }))
          continue
        }
        const properties = child(object, 'spPr')
        if (!properties) pptxReject('形状', '缺少显式形状属性')
        const preset = xmlFirst(properties, 'prstGeom')?.getAttribute('prst') ?? 'rect'
        if (xmlAll(properties, 'gd').length) pptxReject('自定义形状参数', '当前不支持自定义几何调整')
        const shape = shapeMap[preset]
        if (!shape) pptxReject(preset, '不支持的预设形状')
        const fill = child(properties, 'solidFill'), line = child(properties, 'ln')
        const lineFill = line && child(line, 'solidFill')
        if (child(object, 'style') && ((!fill && !child(properties, 'noFill')) || !line)) pptxReject('主题形状样式', '请为形状明确设置填充与线条')
        const dash = line && xmlFirst(line, 'prstDash')?.getAttribute('val')
        if (dash && !['solid', 'dash', 'dot'].includes(dash)) pptxReject('线条样式', '仅支持实线、虚线和点线')
        if (line && xmlChildren(line).some(n => !['solidFill', 'noFill', 'prstDash', 'headEnd', 'tailEnd', 'round'].includes(n.localName))) pptxReject('线条样式', '不支持的线条设置')
        for (const end of line ? [...xmlAll(line, 'headEnd'), ...xmlAll(line, 'tailEnd')] : []) if (end.getAttribute('type') && end.getAttribute('type') !== 'none') pptxReject('线端箭头', '当前不支持线端箭头')
        const opacity = (node: Element | undefined) => node ? numeric(xmlFirst(node, 'alpha'), 'val', 100000) / 100000 : 1
        if (fill || lineFill || !xmlFirst(object, 'txBody')) push(createShapeNode(shape, { ...geometry, name,
          style: { fillColor: color(fill, '#ffffff'), fillOpacity: fill ? opacity(fill) : 0,
            borderColor: color(lineFill, '#000000'), borderOpacity: lineFill ? opacity(lineFill) : 0,
            borderWidth: numeric(line, 'w', 12700) * scale, lineStyle: dash === 'dash' ? 'dashed' : dash === 'dot' ? 'dotted' : 'solid' } }))
        const body = child(object, 'txBody')
        if (body) {
          const bodyProperties = child(body, 'bodyPr')
          if (numeric(bodyProperties, 'rot', 0) !== 0) pptxReject('文字旋转', '请转换为整个文本框的旋转')
          if (bodyProperties?.getAttribute('vert') && bodyProperties.getAttribute('vert') !== 'horz') pptxReject('文字方向', '仅支持水平文字')
          if (xmlAll(body, 'buChar').length || xmlAll(body, 'buAutoNum').length || xmlAll(body, 'fld').length) pptxReject('项目符号/字段', '请转换为普通文字')
          let text = ''; const runs: TextRun[] = []
          const paragraphs = xmlChildren(body).filter(n => n.localName === 'p')
          const alignments = new Set(paragraphs.map(p => child(p, 'pPr')?.getAttribute('algn') ?? 'l'))
          if (alignments.size > 1 || !['l', 'ctr', 'r'].includes([...alignments][0] ?? 'l')) pptxReject('段落对齐', '仅支持文本框内统一的左/中/右对齐')
          let baseStyle: TextRunStyle | undefined
          for (const [pIndex, paragraph] of paragraphs.entries()) {
            if (pIndex) text += '\n'
            for (const run of xmlChildren(paragraph)) {
              if (run.localName === 'br') { text += '\n'; continue }
              if (['pPr', 'endParaRPr'].includes(run.localName)) continue
              if (run.localName !== 'r') pptxReject(run.localName, '不支持的文字内容')
              const properties = child(run, 'rPr') ?? xmlFirst(paragraph, 'defRPr')
              const sz = properties?.getAttribute('sz')
              if (!sz) pptxReject('继承字体', '文字必须显式设置字号')
              const fontSize = numeric(properties, 'sz') / 100 * 12700 * scale
              if (fontSize < 8 || fontSize > 400) pptxReject('字号', '适配后字号超出 8–400 px')
              const family = properties && (xmlFirst(properties, 'ea')?.getAttribute('typeface') || xmlFirst(properties, 'latin')?.getAttribute('typeface'))
              if (family?.startsWith('+')) pptxReject('主题字体', '请改用明确字体名称')
              if (numeric(properties, 'baseline', 0) !== 0 || (properties?.getAttribute('u') && !['none', 'sng'].includes(properties.getAttribute('u')!)) || (properties?.getAttribute('strike') && !['noStrike', 'sngStrike'].includes(properties.getAttribute('strike')!))) pptxReject('文字效果', '请把上下标或复杂文字装饰转换为普通内容')
              if (properties && numeric(xmlFirst(properties, 'alpha'), 'val', 100000) !== 100000) pptxReject('文字透明度', '仅支持不透明文字')
              const runStyle: TextRunStyle = { fontSize, ...(family ? { fontFamily: family } : {}), color: color(properties && child(properties, 'solidFill'), '#000000'), bold: flag(properties, 'b'), italic: flag(properties, 'i'), underline: properties?.getAttribute('u') === 'sng', strike: properties?.getAttribute('strike') === 'sngStrike' }
              baseStyle ??= runStyle
              const value = xmlFirst(run, 't')?.textContent ?? ''
              if (value) runs.push({ start: Array.from(text).length, end: Array.from(text + value).length, style: runStyle })
              text += value
            }
          }
          if (text) push(createTextNode({ ...geometry, name: `${name} 文字`, text, runs, style: { ...baseStyle, align: [...alignments][0] === 'ctr' ? 'center' : [...alignments][0] === 'r' ? 'right' : 'left', verticalAlign: bodyProperties?.getAttribute('anchor') === 'ctr' ? 'middle' : bodyProperties?.getAttribute('anchor') === 'b' ? 'bottom' : 'top', padding: 0, overflow: 'fixed' } }))
        }
      }
      const backgroundPart = inheritedBackground(pkg, path)
      const background = backgroundPart && xmlFirst(backgroundPart, 'bgPr')
      let backgroundFill = background && child(background, 'solidFill')
      const backgroundRef = backgroundPart && xmlFirst(backgroundPart, 'bgRef')
      if (backgroundRef) {
        const themeDoc = themeDocument(pkg, path)
        const styles = themeDoc && xmlFirst(themeDoc, 'bgFillStyleLst')
        const style = styles && xmlChildren(styles)[numeric(backgroundRef, 'idx') - 1001]
        if (!style || style.localName !== 'solidFill') pptxReject('背景', '仅支持纯色主题背景')
        const placeholder = xmlFirst(style, 'schemeClr')
        if (placeholder?.getAttribute('val') === 'phClr') {
          if (xmlChildren(placeholder).length) pptxReject('背景效果', '不支持主题背景颜色变换')
          backgroundFill = backgroundRef
        } else backgroundFill = style
      }
      if (backgroundPart && !backgroundFill) pptxReject('背景', '仅支持纯色背景')
      if (backgroundFill && numeric(xmlFirst(backgroundFill, 'alpha'), 'val', 100000) !== 100000) pptxReject('背景透明度', '仅支持不透明背景')
      slides.push({ title: xmlFirst(slide, 'cSld')?.getAttribute('name') || `导入第 ${page} 页`, backgroundColor: color(backgroundFill, '#ffffff'), items })
    } catch (error) {
      if (error instanceof PptxImportError) issues.push(...error.issues.map(issue => ({ ...issue, page })))
      else issues.push({ page, type: '解析失败', message: error instanceof Error ? error.message : '无法读取页面' })
    }
  }
  if (issues.length) throw new PptxImportError(issues)
  validatePptxRelationships(pkg)
  return { slides, assets, notes: ['按原比例居中适配课程画布；字体由当前系统解析。', '文字转为可编辑文本框，形状与文字分开编辑；文本框内边距归零，保持对象框与字号。', '仅导入页面内容；备注、文档属性和母版占位符不进入课程。'] }
}

function relatedPart(pkg: PptxPackage, path: string, kind: string): string | undefined { return pkg.relationships(path).find(r => !r.external && r.type.endsWith(`/${kind}`))?.target }
function rejectInheritedObjects(pkg: PptxPackage, path: string): void {
  const layout = relatedPart(pkg, path, 'slideLayout'), master = layout && relatedPart(pkg, layout, 'slideMaster')
  for (const part of [layout, master].filter((p): p is string => !!p)) {
    const doc = pkg.xml(part)
    const tree = xmlFirst(doc, 'spTree')
    if (tree && xmlChildren(tree).some(n => !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(n.localName) && !xmlFirst(n, 'ph'))) pptxReject('母版/版式对象', '请把母版或版式中的可见对象转换到页面')
  }
}
function inheritedBackground(pkg: PptxPackage, path: string): Element | undefined {
  const layout = relatedPart(pkg, path, 'slideLayout'), master = layout && relatedPart(pkg, layout, 'slideMaster')
  for (const part of [path, layout, master]) { if (part) { const bg = xmlFirst(pkg.xml(part), 'bg'); if (bg) return bg } }
  return undefined
}
function themeDocument(pkg: PptxPackage, path: string): Document | undefined {
  const layout = relatedPart(pkg, path, 'slideLayout'), master = layout && relatedPart(pkg, layout, 'slideMaster')
  const theme = (master && relatedPart(pkg, master, 'theme')) || relatedPart(pkg, 'ppt/presentation.xml', 'theme')
  return theme ? pkg.xml(theme) : undefined
}
function themeColors(pkg: PptxPackage, path: string): Record<string, string> {
  const layout = relatedPart(pkg, path, 'slideLayout'), master = layout && relatedPart(pkg, layout, 'slideMaster')
  const theme = themeDocument(pkg, path)
  const colors: Record<string, string> = {}
  const scheme = theme && xmlFirst(theme, 'clrScheme')
  if (scheme) for (const entry of xmlChildren(scheme)) { const value = xmlFirst(entry, 'srgbClr')?.getAttribute('val') ?? xmlFirst(entry, 'sysClr')?.getAttribute('lastClr'); if (value) colors[entry.localName] = value }
  const map = master && xmlFirst(pkg.xml(master), 'clrMap')
  if (map) for (const attr of Array.from(map.attributes)) if (colors[attr.value]) colors[attr.name] = colors[attr.value]!
  return colors
}
