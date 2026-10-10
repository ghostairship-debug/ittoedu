import { TEXT_DEFINITION } from '../../../../components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../../../components/text/data'
import { IMAGE_DEFINITION } from '../../../../components/image'
import { createImageData, imageDataSchema } from '../../../../components/image/data'
import { htmlDeclarations, readHtmlDocumentText, type DocumentHtmlNode } from '../../../../shared/document/htmlText'
import { normalizeDocumentColor } from '../../../../shared/document/color'
import { jsonValueSchema, type ComponentDefinition, type ComponentFrame } from '../../../../shared/contracts/component-platform'
import type { HtmlAssemblyObject, HtmlObjectContent } from '../../../../core/contentApply/assembly/htmlAssembly'
import type { ContentApplyDiagnostic, ContentObjectDraft } from './types'

export type ProfessionalHtmlResult =
  | { kind: 'native'; draft: ContentObjectDraft; definition: ComponentDefinition }
  | { kind: 'web'; diagnostic: ContentApplyDiagnostic }

const retained = (object: HtmlAssemblyObject, message: string): ProfessionalHtmlResult => ({ kind: 'web',
  diagnostic: { level: 'info', code: 'html-professional-preserved-web', message, sourcePath: object.sourcePath } })
const px = (value: string | undefined): number | undefined => {
  const match = /^(-?(?:\d*\.)?\d+)px$/.exec(value?.trim() ?? '')
  return match ? Number(match[1]) : undefined
}
const elements = (content: HtmlObjectContent): Extract<HtmlObjectContent, { kind: 'element' }>[] =>
  content.kind === 'element' ? [content, ...content.children.flatMap(elements)] : []
const css = (style: Readonly<Record<string, string>>) => Object.entries(style).map(([name, value]) => `${name}:${value}`).join(';')
const transparent = (value: string) => value === 'transparent' || /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(value)
const projected = (content: HtmlObjectContent): DocumentHtmlNode => content.kind !== 'element' ? { ...content }
  : { kind: 'element', tagName: content.tagName,
    attributes: { ...content.attributes, style: css(Object.fromEntries(Object.entries(content.style)
      .filter(([name, value]) => name !== 'background-color' || !transparent(value)))) }, children: content.children.map(projected) }

/** Family commas inside quotes are names, and font-family matching is case insensitive. */
function fontFamilies(value: string): string[] {
  const families: string[] = []
  let part = '', quote = '', escaped = false
  const push = () => {
    let family = part.trim()
    if (family.length >= 2 && (family[0] === '"' || family[0] === "'") && family.at(-1) === family[0]) {
      family = family.slice(1, -1)
    } else family = family.replace(/\s+/g, ' ')
    families.push(family.replace(/\\(["'\\])/g, '$1').toLowerCase())
    part = ''
  }
  for (const character of value) {
    if (escaped) { part += character; escaped = false; continue }
    if (character === '\\') { part += character; escaped = true; continue }
    if (quote) { part += character; if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") { part += character; quote = character }
    else if (character === ',') push()
    else part += character
  }
  push()
  return families.filter(Boolean)
}

/** supportCss is the browser CSSOM serialization: retain only actual top-level font-face rules. */
function fontFaceFamilies(supportCss: string): Set<string> {
  const families = new Set<string>()
  let quote = '', escaped = false, depth = 0, ruleStart = 0, bodyStart = 0, fontFace = false
  for (let index = 0; index < supportCss.length; index++) {
    const character = supportCss[index]!
    if (escaped) { escaped = false; continue }
    if (character === '\\') { escaped = true; continue }
    if (quote) { if (character === quote) quote = ''; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '{') {
      if (depth === 0) {
        fontFace = /^@font-face\s*$/i.test(supportCss.slice(ruleStart, index).trim())
        bodyStart = index + 1
      }
      depth++
    } else if (character === '}' && depth > 0) {
      depth--
      if (depth === 0) {
        if (fontFace) for (const [name, value] of htmlDeclarations(supportCss.slice(bodyStart, index))) {
          if (name === 'font-family') fontFamilies(value).forEach(family => families.add(family))
        }
        ruleStart = index + 1
      }
    }
  }
  return families
}

function textReason(content: Extract<HtmlObjectContent, { kind: 'element' }>): string | undefined {
  const root = content.style
  if (root.display && ['flex', 'inline-flex', 'grid', 'inline-grid'].includes(root.display)) return '文字使用内部 flex/grid 排版；保留 Web 的实际内部布局。'
  const fontSize = px(root['font-size'])
  if (fontSize === undefined || fontSize < 8 || fontSize > 400) return '文字字号没有可直接对应的实际 px 值；保留原 HTML 外观。'
  if (!root['font-family'] || !root.color) return '文字缺少实际测量的字体或颜色；保留原 HTML。'
  if (root['letter-spacing'] && root['letter-spacing'] !== 'normal' && px(root['letter-spacing']) === undefined) return '字距缺少可直接对应的实际 px 值；保留原 HTML。'
  const line = root['line-height']
  if (!line) return '文字缺少实际行高；保留 Web。'
  if (!(line === 'normal' || px(line) !== undefined && px(line)! > 0 || /^\d+(?:\.\d+)?$/.test(line) && Number(line) > 0)) return `行高 ${line} 无法原样映射；保留 Web。`
  if (!['left', 'center', 'right', 'start', 'end'].includes(root['text-align'] || 'start')
    || root.direction && root.direction !== 'ltr') return '当前文字方向或两端对齐没有等价专业字段；保留 Web。'
  const commonTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption', 'div', 'span', 'a', 'b', 'strong', 'i', 'em', 'cite', 'var', 'dfn', 'u', 'ins', 's', 'del', 'strike', 'mark', 'sup', 'sub', 'code', 'kbd', 'samp', 'tt', 'br'])
  for (const node of elements(content)) {
    const style = node.style
    if (style['background-image'] && style['background-image'] !== 'none') return '文字包含 CSS 图像资源；保留 Web 的现有资源绑定。'
    if (style['animation-name'] && style['animation-name'] !== 'none') return '文字使用 CSS 动画实现；保留 Web 的实现和样式闭包。'
    if (node !== content && style.opacity && style.opacity !== '1') return '范围透明度没有等价专业字段；保留 Web。'
    if (!commonTags.has(node.tagName) || Object.keys(node.pseudoElements).length) return `文字中的 <${node.tagName}> 或伪元素尚无等价专业表达；保留 Web。`
    if (node.attributes.title || node.attributes['data-style']) return '文字包含额外提示或作者样式数据；保留原 HTML，未吞掉这些属性。'
    if (node.tagName === 'a' && node.attributes.href && !/^(?:https?:|mailto:|#)/i.test(node.attributes.href)) return '该链接协议没有专业文本运行消费；保留原链接。'
    const size = style['font-size'] ? px(style['font-size']) : undefined
    if (style['font-size'] && (size === undefined || size < 8 || size > 400)) return '文字范围字号超出当前专业范围；保留 Web。'
    if (style['font-weight'] && !['normal', 'bold', '400', '700'].includes(style['font-weight'])) return `字重 ${style['font-weight']} 不等同专业普通/粗体；保留 Web。`
    if (style['font-style'] && !['normal', 'italic'].includes(style['font-style'])) return '斜体角度无法原样对应；保留 Web。'
    if (style['text-transform'] && style['text-transform'] !== 'none') return '文字大小写变换无法原样对应；保留 Web。'
    if (style['white-space'] && style['white-space'] !== 'normal') return `white-space:${style['white-space']} 未使用普通 HTML 空白规则；保留 Web。`
    if (style['writing-mode'] && style['writing-mode'] !== 'horizontal-tb') return '该书写方向尚未由导入专业映射消费；保留 Web。'
    if (style.color && normalizeDocumentColor(style.color) === undefined) return '范围文字颜色没有当前专业正文的等价表达；保留 Web。'
    if (node !== content && style['letter-spacing'] && style['letter-spacing'] !== root['letter-spacing']) return '局部字距没有等价范围字段；保留 Web。'
    if (node !== content && style['background-color'] && normalizeDocumentColor(style['background-color']) === undefined) return '局部背景颜色没有当前专业高亮的等价表达；保留 Web。'
    if (node !== content && style['line-height'] && style['line-height'] !== line) return '局部行高没有等价范围字段；保留 Web。'
    if (node.tagName === 'strong' || node.tagName === 'b') {
      if (style['font-weight'] && !['bold', '700'].includes(style['font-weight'])) return '粗体标签的 CSS 覆盖不能由现有富文本标签规则保真；保留 Web。'
    }
    if (node.tagName === 'em' || node.tagName === 'i') {
      if (style['font-style'] && style['font-style'] !== 'italic') return '斜体标签的 CSS 覆盖不能由现有富文本标签规则保真；保留 Web。'
    }
    for (const name of ['text-shadow', 'text-indent', 'text-overflow']) {
      const value = style[name]
      if (value && !['none', '0px', 'clip'].includes(value)) return `${name}:${value} 尚无等价专业表达；保留 Web。`
    }
    if (style['text-decoration-style'] && style['text-decoration-style'] !== 'solid') return '特殊文字装饰线尚无等价专业表达；保留 Web。'
    for (const name of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']) {
      if (style[name] && px(style[name]) !== 0) return '文字含非零内边距或边框；保留其原 HTML 盒模型。'
    }
  }
  return undefined
}

/** Converts only an already measured, independent object. Identity/resource admission/history stay with the host. */
export function professionalHtmlDraft(object: HtmlAssemblyObject, resourceBindings: Readonly<Record<string, string>>,
  createFormulaId: () => string, supportCss = ''): ProfessionalHtmlResult | undefined {
  if (object.kind !== 'text' && object.kind !== 'image') return undefined
  if (!object.content || object.content.kind !== 'element') return retained(object, '对象缺少可保真的完整元素内容；保留 Web。')
  if (object.children.length || object.decorations.length || object.sourceRegions.length || Object.keys(object.pseudoElements).length) {
    return retained(object, '对象含编组、装饰或待修源码区域；保留完整 Web 内容。')
  }
  const content = object.content
  const frame: ComponentFrame = { width: object.frame.width, height: object.frame.height, transform: [...object.frame.transform] }
  const style = structuredClone(object.style)
  if (object.kind === 'text') {
    const customFaces = fontFaceFamilies(supportCss)
    const usedFace = elements(content).flatMap(node => fontFamilies(node.style['font-family'] || '')).find(family => customFaces.has(family))
    if (usedFace) return retained(object, `文字实际引用 @font-face 字体 ${usedFace}，专业运行端尚未消费该字体闭包；保留 Web。`)
    const reason = textReason(content)
    if (reason) return retained(object, reason)
    let warning: string | undefined
    const inlines = readHtmlDocumentText([projected(content)], { createFormulaId, normalWhitespace: true,
      warn: (_code, message) => { warning ??= message }, onMedia: () => { warning ??= '文字包含独立媒体，不能并入专业文字。' } })
    if (warning) return retained(object, warning)
    const measured = content.style, fontSize = px(measured['font-size'])!
    const align = measured['text-align'] === 'end' ? 'right' : measured['text-align'] === 'center' ? 'center' : measured['text-align'] === 'right' ? 'right' : 'left'
    const lineHeight = measured['line-height'] === 'normal' ? 'normal' : px(measured['line-height']) === undefined ? Number(measured['line-height']) : px(measured['line-height'])! / fontSize
    const data = textComponentDataSchema.parse({ ...createTextComponentData(inlines),
      appearance: { fontFamily: measured['font-family'], fontSize, color: measured.color, align, lineHeight,
        letterSpacing: measured['letter-spacing'] === 'normal' || !measured['letter-spacing'] ? 0 : px(measured['letter-spacing']),
        bold: ['700', 'bold'].includes(measured['font-weight'] || ''), italic: measured['font-style'] === 'italic' },
      sizing: { mode: 'fixed', minHeight: 0, overflow: 'visible' } })
    return { kind: 'native', definition: TEXT_DEFINITION, draft: { definitionId: TEXT_DEFINITION.id,
      data: jsonValueSchema.parse(data), frame, style } }
  }
  if (content.tagName !== 'img' || content.attributes.srcset || content.attributes.sizes) return retained(object, 'picture/srcset 的响应式候选集尚无等价图片字段；保留原 Web。')
  for (const name of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'padding', 'border-width']) {
    const value = content.style[name]
    if (value && value.trim().split(/\s+/).some(length => length !== '0' && px(length) !== 0)) {
      return retained(object, `图片 ${name}:${value} 会改变实测 border-box 与专业图片内容盒的关系；保留 Web 盒模型。`)
    }
  }
  if (content.style['background-image'] && content.style['background-image'] !== 'none'
    || content.style['animation-name'] && content.style['animation-name'] !== 'none') return retained(object, '图片含附加 CSS 图像或动画闭包；保留 Web 的资源与实现。')
  const assetId = resourceBindings[content.attributes.src || '']
  if (!assetId) return retained(object, '该图片尚无已接纳资源绑定；保留源引用与现有诊断。')
  const fit = content.style['object-fit'] || 'fill'
  if (!['fill', 'contain', 'cover'].includes(fit)) return retained(object, `object-fit:${fit} 尚无等价专业图片字段；保留 Web。`)
  const position = (content.style['object-position'] || '50% 50%').trim().split(/\s+/)
  if (position.length !== 2 || position.some(value => !/^\d+(?:\.\d+)?%$/.test(value) || Number.parseFloat(value) > 100)) return retained(object, '图片像素/外扩位置尚无等价专业裁切锚点；保留 Web。')
  const radius = content.style['border-radius'] || '0px'
  const cornerRadius = px(radius)
  if (cornerRadius === undefined || cornerRadius < 0) return retained(object, '图片非统一像素圆角尚无等价专业字段；保留 Web。')
  const data = imageDataSchema.parse({ ...createImageData(assetId, content.attributes.alt || ''),
    fit: fit === 'fill' ? 'stretch' : fit, cropX: Number.parseFloat(position[0]!) / 100,
    cropY: Number.parseFloat(position[1]!) / 100, cornerRadius })
  return { kind: 'native', definition: IMAGE_DEFINITION, draft: { definitionId: IMAGE_DEFINITION.id,
    data: jsonValueSchema.parse(data), frame, style } }
}
