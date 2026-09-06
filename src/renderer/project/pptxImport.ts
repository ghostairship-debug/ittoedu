import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import type { LayerItem } from '../../shared/courseProjectTypes'
import type { ShapeType, ShapeNode, TextRun, TextRunStyle } from '../../shared/contracts/native-v1'
import { analyzeTextNodeLayout } from '../../shared/textLayout'
import { createImageNode, createShapeNode, createTextNode } from './nativeNodeFactories'
import { createImageAssetImport, readImageDimensions } from './assetManager'
import type { CourseImportedAsset } from './v9AssetAdapter'
import { pptxPageObjects, expandPptxGroup } from './pptxInheritance'
import { parsePptxTable } from './pptxTableImport'
import { parsePptxChart } from './pptxChartImport'
import { parsePptxEquation } from './pptxEquationImport'
import { parsePptxCustomGeometry, parsePptxGradient, parsePptxBraceGeometry, parsePptxRoundCallout, parsePptxRightArrow } from './pptxShapeImport'
import { parsePptxColorChanges, renderPptxColorChanges } from './pptxImageEffects'
import { openPptxPackage, PPTX_IMPORT_LIMITS, PptxImportError, pptxReject, pptxRelationshipId, xmlAll, xmlChildren, xmlFirst, type PptxPackage, type PptxImportIssue } from './pptxPackage'

export interface PptxSlideDraft { title: string; backgroundColor: string; items: LayerItem[]; sourcePage?: number; sharedKeys?: string[] }
export interface PptxImportDraft { slides: PptxSlideDraft[]; assets: CourseImportedAsset[]; notes: string[]; issues: PptxImportIssue[]; shared?: { key: string; items: LayerItem[] }[] }
const child = (node: Element, name: string) => xmlChildren(node).find(n => n.localName === name)
const flag = (node: Element | undefined, name: string) => ['1', 'true'].includes(node?.getAttribute(name) ?? '')
const numeric = (node: Element | undefined, attr: string, fallback?: number): number => {
  const raw = node?.getAttribute(attr)
  if (raw === null || raw === undefined) { if (fallback !== undefined) return fallback; return pptxReject('几何', `缺少 ${attr}`) }
  const value = Number(raw)
  if (!Number.isFinite(value)) return pptxReject('几何', `${attr} 不是有限数值`)
  return value
}
const shapeMap: Partial<Record<string, ShapeType>> = { rect: 'rectangle', flowChartProcess: 'rectangle', roundRect: 'rounded-rectangle', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', line: 'line', rightArrow: 'arrow-right', leftArrow: 'arrow-left', upArrow: 'arrow-up', downArrow: 'arrow-down', leftBrace: 'brace-left', rightBrace: 'brace-right' }

function lineStyle(line: Element | undefined, onSimplified?: () => void): ShapeNode['style']['lineStyle'] {
  const dash = line && xmlFirst(line, 'prstDash')?.getAttribute('val') || 'solid'
  if (!['solid', 'dash', 'sysDash', 'dot', 'sysDot'].includes(dash)) pptxReject('线条样式', '暂不支持此虚线组合')
  if (line && xmlChildren(line).some(n => !['solidFill', 'noFill', 'prstDash', 'headEnd', 'tailEnd', 'round', 'bevel', 'miter'].includes(n.localName))) pptxReject('线条样式', '不支持的线条设置')
  if (line && !child(line, 'noFill') && (dash === 'sysDash' || child(line, 'miter') || child(line, 'bevel'))) onSimplified?.()
  return dash === 'dot' || dash === 'sysDot' ? 'dotted' : dash === 'solid' ? 'solid' : 'dashed'
}

/** Stage editable content and report each omitted object or effect before any project write. */
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
  const imageOriginals = new Map<string, string>()
  const shared = new Map<string, LayerItem[]>()
  let objectCount = 0
  const report = (error: unknown, page: number, action: string) => {
    const details = error instanceof PptxImportError ? error.issues : [{ type: '解析失败', message: error instanceof Error ? error.message : '无法读取内容' }]
    issues.push(...details.map(issue => ({ ...issue, page, message: `${action}：${issue.message}` })))
  }
  for (const [index, ref] of slideRefs.entries()) {
    const page = index + 1
    try {
      const relationship = mainRels.find(r => r.id === pptxRelationshipId(ref))
      if (!relationship || relationship.external || !relationship.type.endsWith('/slide')) pptxReject('损坏关系', '页面关系无效')
      const path = relationship.target
      const slide = pkg.xml(path)
      const theme = themeColors(pkg, path)
      const color = (node: Element | undefined, fallback: string): string => {
        if (!node) return fallback
        const rgb = xmlFirst(node, 'srgbClr'), scheme = xmlFirst(node, 'schemeClr')
        const source = rgb ?? scheme
        if (!source) return pptxReject('颜色', '仅支持 RGB 或主题纯色')
        if (xmlChildren(source).some(n => !['alpha', 'lumMod', 'lumOff', 'tint', 'shade'].includes(n.localName))) pptxReject('颜色效果', '不支持颜色变换')
        const result = rgb?.getAttribute('val') ?? theme[scheme?.getAttribute('val') ?? '']
        if (!result || !/^[\da-f]{6}$/i.test(result)) return pptxReject('颜色', '无法解析主题色')
        let rgbValues = [0, 2, 4].map(offset => parseInt(result.slice(offset, offset + 2), 16))
        for (const effect of xmlChildren(source)) {
          const amount = numeric(effect, 'val', 100000) / 100000
          if (effect.localName === 'lumMod' || effect.localName === 'shade') rgbValues = rgbValues.map(v => v * amount)
          if (effect.localName === 'lumOff') rgbValues = rgbValues.map(v => v + 255 * amount)
          if (effect.localName === 'tint') rgbValues = rgbValues.map(v => v * amount + 255 * (1 - amount))
        }
        return `#${rgbValues.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
      }
      for (const name of ['timing', 'transition']) if (xmlAll(slide, name).length) issues.push({ page, type: name === 'timing' ? '动画' : '切换效果', message: '已省略效果，保留可解析的静态内容' })
      const tree = xmlFirst(slide, 'spTree')
      if (!tree) pptxReject('页面结构', '缺少对象树')
      const items: LayerItem[] = []
      const sharedKeys: string[] = []
      const failedDiagrams = new Set<string>()
      const diagramItems = new Map<string, LayerItem[]>()
      const diagramShared = new Map<string, string[]>()
      const sources = pptxPageObjects(pkg, path, error => report(error, page, '已跳过对象')).flatMap(source => {
        try { return expandPptxGroup(source) } catch (error) { report(error, page, '已跳过分组'); return [] }
      })
      for (const source of sources) {
        const { object } = source
        const rels = pkg.relationships(source.path)
        const sharedKey = source.sharedKey && `${source.sharedKey}:${JSON.stringify(theme)}`
        if (sharedKey && shared.has(sharedKey)) { sharedKeys.push(sharedKey); continue }
        if (['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(object.localName)) continue
        if (++objectCount > PPTX_IMPORT_LIMITS.objects) pptxReject('对象数量', '最多导入 2000 个对象')
        const itemStart = items.length
        const objectName = xmlFirst(object, 'cNvPr')?.getAttribute('name') || `对象 ${objectCount}`
        const reportStrokeSimplification = () => issues.push({ page, type: '边框样式', message: `“${objectName}”保留线宽及实线/虚线/点线类型；转角与虚线节奏按编辑器样式呈现` })
        try {
          if (object.localName === 'graphicFrame') {
            const item = parsePptxEquation(object, pkg, source.path, scale, origin, page, issues)
              ?? parsePptxChart(object, pkg, source.path, scale, origin, color, page, issues)
              ?? parsePptxTable(object, scale, origin, color, page, issues, pkg.files['ppt/tableStyles.xml'] ? pkg.xml('ppt/tableStyles.xml') : undefined)
            item.order = items.length
            items.push(item)
            if (sharedKey) { shared.set(sharedKey, items.splice(itemStart)); sharedKeys.push(sharedKey) }
            continue
          }
          for (const name of ['effectLst', 'effectDag', 'scene3d', 'sp3d', 'hlinkClick', 'hlinkMouseOver']) {
            const effects = xmlAll(object, name).filter(node => name !== 'effectLst' || xmlChildren(node).length)
            if (effects.length) {
              issues.push({ page, type: name.startsWith('hlink') ? '超链接' : '视觉效果', message: `“${objectName}”已省略${name.startsWith('hlink') ? '超链接' : '阴影或立体效果'}，保留静态内容` })
              for (const effect of effects) effect.remove()
            }
          }
          for (const name of ['AlternateContent', 'oleObj', 'videoFile', 'audioFile', 'pattFill']) if (xmlAll(object, name).length) pptxReject(name, '当前无法转换为可编辑对象')
          const customGeometry = xmlFirst(object, 'custGeom')
          for (const gradient of xmlAll(object, 'gradFill')) if (object.localName !== 'sp' || gradient.parentElement?.localName !== 'spPr') pptxReject('渐变', '当前仅支持形状填充渐变')
          if (customGeometry && object.localName !== 'sp') pptxReject('自由路径', '当前仅支持形状路径')
          if (!['sp', 'pic', 'cxnSp'].includes(object.localName)) pptxReject(object.localName, '不支持的页面对象')
          const transform = xmlFirst(object, 'xfrm')
          if (!transform) pptxReject('继承几何', '对象需要显式位置与尺寸')
          const presetGeometry = xmlFirst(object, 'prstGeom')?.getAttribute('prst')
          if (object.localName === 'cxnSp' || presetGeometry === 'line') {
            const node = parsePptxLine(object, transform, scale, origin, color, reportStrokeSimplification)
            if (xmlAll(object, 'stCxn').length || xmlAll(object, 'endCxn').length) issues.push({ page, type: '连接关系', message: `“${objectName}”保留线条位置，转换为独立可编辑线条` })
            items.push(sceneNodeToCourseLayerItem(node, items.length))
            if (sharedKey) { shared.set(sharedKey, items.splice(itemStart)); sharedKeys.push(sharedKey) }
            continue
          }
          const flipped = flag(transform, 'flipH') || flag(transform, 'flipV')
          if (flipped && !customGeometry && object.localName !== 'pic' && !['rect', 'roundRect', 'ellipse'].includes(presetGeometry ?? 'rect')) pptxReject('翻转形状', '当前可导入文字、图片和对称基础形状的翻转')
          const off = xmlFirst(transform, 'off'), ext = xmlFirst(transform, 'ext')
          const geometry = { x: numeric(off, 'x') * scale + origin.x, y: numeric(off, 'y') * scale + origin.y, width: numeric(ext, 'cx') * scale, height: numeric(ext, 'cy') * scale, rotation: numeric(transform, 'rot', 0) / 60000, visible: !flag(xmlFirst(object, 'cNvPr'), 'hidden'), ...(flipped ? { flipX: flag(transform, 'flipH'), flipY: flag(transform, 'flipV') } : {}) }
          if (geometry.width <= 0 || geometry.height <= 0) pptxReject('几何', '对象宽高必须大于零')
          const name = xmlFirst(object, 'cNvPr')?.getAttribute('name') || `对象 ${items.length + 1}`
          const push = (node: Parameters<typeof sceneNodeToCourseLayerItem>[0]) => items.push(sceneNodeToCourseLayerItem(node, items.length))
          if (object.localName === 'pic') {
            const mask = xmlFirst(object, 'prstGeom')?.getAttribute('prst')
            if (mask && mask !== 'rect') pptxReject('图片形状蒙版', '请先应用图片蒙版')
            const srcRect = xmlFirst(object, 'srcRect')
            const crop = { left: numeric(srcRect, 'l', 0) / 100000, top: numeric(srcRect, 't', 0) / 100000, right: numeric(srcRect, 'r', 0) / 100000, bottom: numeric(srcRect, 'b', 0) / 100000 }
            if (Object.values(crop).some(v => v < 0) || crop.left + crop.right >= 0.98 || crop.top + crop.bottom >= 0.98) pptxReject('裁剪图片', '裁剪范围需要图片后备')
            const blip = xmlFirst(object, 'blip')
            const changes = parsePptxColorChanges(blip, color)
            if (xmlFirst(object, 'tile')) pptxReject('平铺图片', '请先转换为普通图片')
            const imageRel = rels.find(r => r.id === (blip ? pptxRelationshipId(blip, 'embed') : ''))
            if (!imageRel || imageRel.external || !imageRel.type.endsWith('/image')) pptxReject('损坏关系', '图片关系缺失或类型错误')
            const extension = imageRel.target.split('.').pop()?.toLowerCase()
            const mimeType = extension === 'png' ? 'image/png' : ['jpg', 'jpeg'].includes(extension ?? '') ? 'image/jpeg' : undefined
            if (!mimeType) pptxReject('图片类型', '首批仅支持内嵌 PNG / JPEG')
            let asset = assetByPath.get(imageRel.target)
            if (!asset) {
              const data = pkg.files[imageRel.target]!
              if (!data) pptxReject('损坏关系', '图片文件缺失')
              const dimensions = await readImageDimensions(data, mimeType)
              if (dimensions.width * dimensions.height > 40_000_000) pptxReject('图片尺寸', '图片不能超过 4000 万像素')
              asset = createImageAssetImport({ name: imageRel.target.split('/').pop()!, mimeType, bytes: data }, { dimensions })
              assetByPath.set(imageRel.target, asset); assets.push(asset)
            }
            if (changes.length) {
              const original = asset
              const key = `${imageRel.target}:${JSON.stringify(changes)}`
              asset = assetByPath.get(key)
              if (!asset) {
                const transformed = await renderPptxColorChanges(original.bytes, original.meta.mimeType, changes)
                asset = createImageAssetImport({ name: `${original.meta.filename.replace(/\.[^.]+$/, '')}-颜色替换.png`, mimeType: 'image/png', bytes: transformed }, { dimensions: { width: original.meta.width!, height: original.meta.height! } })
                assetByPath.set(key, asset); assets.push(asset); imageOriginals.set(asset.meta.id, original.meta.id)
              }
            }
            push(createImageNode({ ...geometry, name, assetId: asset.meta.id, fit: 'stretch', crop }))
            if (sharedKey) { shared.set(sharedKey, items.splice(itemStart)); sharedKeys.push(sharedKey) }
            continue
          }
          const properties = child(object, 'spPr')
          if (!properties) pptxReject('形状', '缺少显式形状属性')
          const preset = xmlFirst(properties, 'prstGeom')?.getAttribute('prst') ?? 'rect'
          const pathGeometry = customGeometry ? parsePptxCustomGeometry(customGeometry, flag(transform, 'flipH'), flag(transform, 'flipV'))
            : preset === 'wedgeRoundRectCallout' ? parsePptxRoundCallout(xmlFirst(properties, 'prstGeom')!, geometry.width, geometry.height)
              : preset === 'rightArrow' && xmlAll(properties, 'gd').length ? parsePptxRightArrow(xmlFirst(properties, 'prstGeom')!, geometry.width, geometry.height) : undefined
          const braceGeometry = ['leftBrace', 'rightBrace'].includes(preset) ? parsePptxBraceGeometry(xmlFirst(properties, 'prstGeom')!) : undefined
          const adjustments = xmlAll(properties, 'gd')
          let cornerRadius: number | undefined
          if (preset === 'roundRect') {
            const adjustment = adjustments[0]
            const formula = adjustment?.getAttribute('fmla') ?? 'val 16667'
            if (adjustments.length > 1 || (adjustment && adjustment.getAttribute('name') !== 'adj') || !/^val -?\d+$/.test(formula)) pptxReject('自定义形状参数', '无法解析圆角调整')
            cornerRadius = Math.min(500, Math.min(geometry.width, geometry.height) * Math.max(0, Math.min(50000, Number(formula.slice(4)))) / 100000)
          } else if (adjustments.length && !braceGeometry && !pathGeometry) pptxReject('自定义形状参数', '当前不支持自定义几何调整')
          const shape = pathGeometry ? 'rectangle' : shapeMap[preset]
          if (!shape) pptxReject(preset, '不支持的预设形状')
          const fill = child(properties, 'solidFill'), line = child(properties, 'ln')
          const gradient = child(properties, 'gradFill')
          const gradientStyle = gradient ? parsePptxGradient(gradient, geometry.width, geometry.height, color) : undefined
          if (gradientStyle?.fillGradient && flipped) {
            for (const point of [gradientStyle.fillGradient.start, gradientStyle.fillGradient.end]) {
              if (flag(transform, 'flipH')) point[0] = 1 - point[0]
              if (flag(transform, 'flipV')) point[1] = 1 - point[1]
            }
          }
          const lineFill = line && child(line, 'solidFill')
          if (child(object, 'style') && ((!fill && !gradient && !child(properties, 'noFill')) || !line)) pptxReject('主题形状样式', '请为形状明确设置填充与线条')
          const strokeStyle = lineStyle(line, reportStrokeSimplification)
          for (const end of line ? [...xmlAll(line, 'headEnd'), ...xmlAll(line, 'tailEnd')] : []) if (end.getAttribute('type') && end.getAttribute('type') !== 'none') pptxReject('线端箭头', '当前不支持线端箭头')
          const opacity = (node: Element | undefined) => node ? numeric(xmlFirst(node, 'alpha'), 'val', 100000) / 100000 : 1
          if (fill || gradient || lineFill || !xmlFirst(object, 'txBody')) push(createShapeNode(shape, { ...geometry, name, ...(pathGeometry ? { pathGeometry } : {}), ...(braceGeometry ? { braceGeometry } : {}),
            style: { fillColor: color(fill, '#ffffff'), fillOpacity: fill ? opacity(fill) : 0,
              ...gradientStyle,
              borderColor: color(lineFill, '#000000'), borderOpacity: lineFill ? opacity(lineFill) : 0,
              borderWidth: numeric(line, 'w', 12700) * scale, lineStyle: strokeStyle, ...(cornerRadius !== undefined ? { cornerRadius } : {}) } }))
          const body = child(object, 'txBody')
          if (body) {
            const bodyProperties = child(body, 'bodyPr')
            if (numeric(bodyProperties, 'rot', 0) !== 0) pptxReject('文字旋转', '请转换为整个文本框的旋转')
            if (bodyProperties?.getAttribute('vert') && bodyProperties.getAttribute('vert') !== 'horz') pptxReject('文字方向', '仅支持水平文字')
            let text = ''; const runs: TextRun[] = []
            const paragraphs = xmlChildren(body).filter(n => n.localName === 'p')
            const alignments = new Set(paragraphs.map(p => {
              const align = child(p, 'pPr')?.getAttribute('algn') ?? 'l'
              // A single glyph has no inter-word gap to justify. Longer paragraphs
              // retain the explicit unsupported report instead of losing alignment.
              return align === 'just' && Array.from(xmlAll(p, 't').map(t => t.textContent ?? '').join('')).length <= 1 ? 'l' : align
            }))
            if (alignments.size > 1 || !['l', 'ctr', 'r'].includes([...alignments][0] ?? 'l')) pptxReject('段落对齐', '仅支持文本框内统一的左/中/右对齐')
            let baseStyle: TextRunStyle | undefined
            for (const [pIndex, paragraph] of paragraphs.entries()) {
              if (pIndex) text += '\n'
              const pPr = child(paragraph, 'pPr')
              const bullet = pPr && child(pPr, 'buChar'), numbering = pPr && child(pPr, 'buAutoNum')
              if (bullet) text += `${bullet.getAttribute('char') ?? '•'} `
              if (numbering) text += `${numeric(numbering, 'startAt', 1) + pIndex}. `
              for (const run of xmlChildren(paragraph)) {
                if (run.localName === 'br') { text += '\n'; continue }
                if (['pPr', 'endParaRPr'].includes(run.localName)) continue
                if (!['r', 'fld'].includes(run.localName)) pptxReject(run.localName, '不支持的文字内容')
                const properties = child(run, 'rPr') ?? xmlFirst(paragraph, 'defRPr')
                const sz = properties?.getAttribute('sz')
                if (!sz) pptxReject('继承字体', '文字必须显式设置字号')
                const fontSize = numeric(properties, 'sz') / 100 * 12700 * scale
                if (fontSize < 8 || fontSize > 400) pptxReject('字号', '适配后字号超出 8–400 px')
                const family = properties && (xmlFirst(properties, 'ea')?.getAttribute('typeface') || xmlFirst(properties, 'latin')?.getAttribute('typeface'))
                if (family?.startsWith('+')) pptxReject('主题字体', '请改用明确字体名称')
                const baseline = numeric(properties, 'baseline', 0) / 100000
                if (Math.abs(baseline) > 1 || (properties?.getAttribute('u') && !['none', 'sng'].includes(properties.getAttribute('u')!)) || (properties?.getAttribute('strike') && !['noStrike', 'sngStrike'].includes(properties.getAttribute('strike')!))) pptxReject('文字效果', '位移或复杂文字装饰超出当前可编辑范围')
                if (properties && numeric(xmlFirst(properties, 'alpha'), 'val', 100000) !== 100000) pptxReject('文字透明度', '仅支持不透明文字')
                const runStyle: TextRunStyle = { fontSize, ...(baseline ? { baseline } : {}), ...(family ? { fontFamily: family } : {}), color: color(properties && child(properties, 'solidFill'), '#000000'), bold: flag(properties, 'b'), italic: flag(properties, 'i'), underline: properties?.getAttribute('u') === 'sng', strike: properties?.getAttribute('strike') === 'sngStrike' }
                baseStyle ??= runStyle
                const value = xmlFirst(run, 't')?.textContent ?? ''
                if (value) runs.push({ start: Array.from(text).length, end: Array.from(text + value).length, style: runStyle })
                text += value
              }
            }
            if (text) {
              const node = createTextNode({ ...geometry, name: `${name} 文字`, text, runs, style: { ...baseStyle, align: [...alignments][0] === 'ctr' ? 'center' : [...alignments][0] === 'r' ? 'right' : 'left', verticalAlign: bodyProperties?.getAttribute('anchor') === 'ctr' ? 'middle' : bodyProperties?.getAttribute('anchor') === 'b' ? 'bottom' : 'top', padding: 0, overflow: 'fixed' } })
              // spAutoFit permits the source shape to grow with its text. Resolve
              // that geometry with the same layout used by editor/Player/export;
              // do not force fixed source frames (including tiny ones) to grow.
              if (bodyProperties && child(bodyProperties, 'spAutoFit')) {
                if (bodyProperties.getAttribute('wrap') === 'none') node.width = Math.max(node.width, Math.ceil(analyzeTextNodeLayout(node, 1_000_000).requiredWidth))
                node.height = Math.max(node.height, Math.ceil(analyzeTextNodeLayout(node).requiredHeight))
                if (node.width > geometry.width || node.height > geometry.height) issues.push({ page, type: '文字自动扩框', message: `“${objectName}”按源自动扩框设置及当前字体扩展文字框，保留完整正文；请复核相邻对象布局` })
              }
              if (source.atomicGroup) {
                const measured = analyzeTextNodeLayout(node)
                if (measured.overflowsWidth || measured.overflowsHeight) {
                  node.style.overflow = 'shrink'
                  const fitted = analyzeTextNodeLayout(node)
                  if (fitted.overflowsWidth || fitted.overflowsHeight) pptxReject('SmartArt 文字', '当前最小字号无法完整呈现图示文字')
                  issues.push({ page, type: 'SmartArt 文字排版', message: `“${objectName}”启用框内缩放，以当前字体完整呈现图示文字` })
                }
              }
              push(node)
            }
          }
          if (sharedKey) { shared.set(sharedKey, items.splice(itemStart)); sharedKeys.push(sharedKey) }
        } catch (error) {
          items.splice(itemStart)
          if (source.atomicGroup) failedDiagrams.add(source.atomicGroup)
          report(error, page, `已跳过“${objectName}”`)
        } finally {
          if (source.atomicGroup) {
            const previous = diagramItems.get(source.atomicGroup) ?? []
            diagramItems.set(source.atomicGroup, previous.concat(sharedKey ? shared.get(sharedKey) ?? [] : items.slice(itemStart)))
            if (sharedKey) diagramShared.set(source.atomicGroup, [...diagramShared.get(source.atomicGroup) ?? [], sharedKey])
          }
        }
      }
      for (const group of failedDiagrams) {
        const removed = new Set(diagramItems.get(group) ?? [])
        for (let i = items.length - 1; i >= 0; i--) if (removed.has(items[i])) items.splice(i, 1)
        for (const key of diagramShared.get(group) ?? []) { shared.delete(key); const index = sharedKeys.indexOf(key); if (index >= 0) sharedKeys.splice(index, 1) }
        issues.push({ page, type: 'SmartArt', message: '图示含未支持内容，已整体跳过，避免留下缺少节点或连接的图示' })
      }
      items.forEach((item, order) => { item.order = order })
      let backgroundColor = '#ffffff'
      try {
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
        backgroundColor = color(backgroundFill, '#ffffff')
      } catch (error) { report(error, page, '背景已替换为白色') }
      slides.push({ title: xmlFirst(slide, 'cSld')?.getAttribute('name') || `导入第 ${page} 页`, backgroundColor, items, sourcePage: page, sharedKeys })
    } catch (error) {
      if (error instanceof PptxImportError && error.issues.some(issue => issue.type === '对象数量')) throw error
      report(error, page, '已跳过页面')
    }
  }
  if (!slides.some(slide => slide.items.length || slide.sharedKeys?.some(key => shared.get(key)?.length))) throw new PptxImportError([...issues, { type: '无可导入内容', message: '没有可转换的对象，工程未写入；可在源软件转换对象或另存图片后补入。' }])
  // Reserve one common order interval below every scene; import metadata is not persisted.
  let order = 0
  for (const group of shared.values()) for (const item of group) item.order = order++
  for (const slide of slides) slide.items.forEach((item, i) => { item.order = order + i })
  const allItems = [...slides.flatMap(slide => slide.items), ...[...shared.values()].flat()]
  const usedAssets = new Set(allItems.flatMap(item => item.kind === 'native' && item.content.nativeType === 'image' ? [item.content.data.assetId] : []))
  for (const id of [...usedAssets]) { const original = imageOriginals.get(id); if (original) usedAssets.add(original) }
  return { slides, shared: [...shared].map(([key, items]) => ({ key, items })), assets: assets.filter(asset => usedAssets.has(asset.meta.id)), issues, notes: ['按原比例居中适配课程画布；字体由当前系统解析。', '文字与图形可分别编辑；母版/版式装饰在本演示表面的共享层修改，占位符正文只属于当前页。', '备注和文档属性不进入课程；未支持的复杂对象可在源软件另存图片后补入。'] }
}

function parsePptxLine(
  object: Element, transform: Element, scale: number, origin: { x: number; y: number },
  color: (node: Element | undefined, fallback: string) => string,
  reportStrokeSimplification: () => void,
): ShapeNode {
  const properties = child(object, 'spPr')
  const preset = properties && xmlFirst(properties, 'prstGeom')?.getAttribute('prst')
  const elbow = preset === 'bentConnector2' || preset === 'bentConnector3'
  if (!elbow && preset !== 'line' && preset !== 'straightConnector1') pptxReject('连接线类型', '当前支持直线和单折段连接线')
  const line = properties && child(properties, 'ln')
  if (!line) pptxReject('继承线条样式', '缺少明确线条样式')
  const fill = child(line, 'solidFill')
  if (!fill && !child(line, 'noFill')) pptxReject('继承线条颜色', '缺少明确线条颜色')
  const strokeStyle = lineStyle(line, reportStrokeSimplification)
  const arrow = (name: string): ShapeNode['style']['startArrow'] => {
    const value = child(line, name)?.getAttribute('type') ?? 'none'
    if (value === 'oval') return 'circle'
    if (['none', 'triangle', 'stealth', 'diamond'].includes(value)) return value as ShapeNode['style']['startArrow']
    return pptxReject('线端箭头', `暂不支持 ${value} 箭头`)
  }
  const off = xmlFirst(transform, 'off'), ext = xmlFirst(transform, 'ext')
  const rawWidth = numeric(ext, 'cx') * scale, rawHeight = numeric(ext, 'cy') * scale
  if (rawWidth < 0 || rawHeight < 0 || rawWidth + rawHeight === 0) pptxReject('线条几何', '线段必须有长度')
  const borderWidth = numeric(line, 'w', 12700) * scale
  const startArrow = arrow('headEnd'), endArrow = arrow('tailEnd')
  // Native painters clip to the item frame. Keep the source endpoints while
  // reserving enough room for strokes and the existing renderer's arrow heads.
  const padding = startArrow !== 'none' || endArrow !== 'none' ? Math.max(12, borderWidth * 4) : Math.max(2, borderWidth / 2 + 2)
  const width = rawWidth + padding * 2, height = rawHeight + padding * 2
  const start: [number, number] = [(padding + (flag(transform, 'flipH') ? rawWidth : 0)) / width, (padding + (flag(transform, 'flipV') ? rawHeight : 0)) / height]
  const end: [number, number] = [1 - start[0], 1 - start[1]]
  const adjustments = properties ? xmlAll(properties, 'gd') : []
  let position = preset === 'bentConnector2' ? 1 : 0.5
  if (adjustments.length) {
    const formula = adjustments[0]?.getAttribute('fmla') ?? ''
    if (!elbow || preset !== 'bentConnector3' || adjustments.length !== 1 || !/^val \d+$/.test(formula)) pptxReject('折线调整', '当前无法表达此折线调整')
    position = Number(formula.slice(4)) / 100000
    if (position < 0 || position > 1) pptxReject('折线调整', '折点超出对象范围')
  }
  if (flag(transform, 'flipH')) position = 1 - position
  position = (padding + position * rawWidth) / width
  return createShapeNode(elbow ? 'elbow-arrow' : 'line', {
    name: xmlFirst(object, 'cNvPr')?.getAttribute('name') || '导入线条',
    x: numeric(off, 'x') * scale + origin.x - padding,
    y: numeric(off, 'y') * scale + origin.y - padding,
    width, height, rotation: numeric(transform, 'rot', 0) / 60000,
    visible: !flag(xmlFirst(object, 'cNvPr'), 'hidden'),
    lineGeometry: elbow ? { kind: 'elbow', start, end, axis: 'horizontal', position } : { kind: 'straight', start, end },
    style: { fillOpacity: 0, borderColor: color(fill, '#000000'), borderOpacity: fill ? numeric(xmlFirst(fill, 'alpha'), 'val', 100000) / 100000 : 0,
      borderWidth, lineStyle: strokeStyle, startArrow, endArrow },
  })
}

function relatedPart(pkg: PptxPackage, path: string, kind: string): string | undefined { return pkg.relationships(path).find(r => !r.external && r.type.endsWith(`/${kind}`))?.target }
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
