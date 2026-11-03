import type PptxGenJS from 'pptxgenjs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { strToU8 } from 'fflate'
import { editAnimationTiming, editChartValue, inspectAnimations, inspectChart } from './pptxAdvanced'
import { children, descendants, NS, OfficePackage, replaceTextRange, textOf } from './officePackage'
import type { OfficeContentInspection, OfficeRequest, PptxObjectEdit, PptxObjectFrame, PptxObjectInspection, PptxTextStyle } from '../../../shared/workbench/officeFiles'

function isPptxConstructor(value: unknown): value is new () => PptxGenJS { return typeof value === 'function' }

export async function createPptx(request: OfficeRequest<'pptx', 'create'>): Promise<Uint8Array> {
  const constructor: unknown = (await import('pptxgenjs')).default
  if (!isPptxConstructor(constructor)) throw new TypeError('PowerPoint 生成库未提供可构造入口')
  const pptx = new constructor()
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = '果铃'; pptx.subject = request.title ?? ''; pptx.title = request.title ?? ''
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' }
  for (const content of request.slides) {
    const slide = pptx.addSlide()
    slide.background = { color: 'F6F8FC' }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, line: { transparency: 100 }, fill: { color: '2F5EA8' }, objectName: 'accent' })
    slide.addText(content.title, { x: 0.65, y: 0.6, w: 12, h: 1.15, fontSize: 30, bold: true, color: '183153', margin: 0, breakLine: false, fit: 'shrink', objectName: 'title' })
    if (content.body?.length) slide.addText(content.body.map(text => ({ text, options: { breakLine: true, bullet: { indent: 22 }, hanging: 4 } })), {
      x: 0.8, y: 2.05, w: 11.7, h: 4.7, fontSize: 22, color: '334155', paraSpaceAfter: 18, margin: 0, valign: 'top', fit: 'shrink', objectName: 'body',
    })
    if (content.notes) slide.addNotes(content.notes)
  }
  const result = await pptx.write({ outputType: 'uint8array' })
  if (!(result instanceof Uint8Array)) throw new Error('PPTX 生成器未返回字节')
  return result
}

function slideParts(pkg: OfficePackage): string[] {
  const main = pkg.main()
  const relationships = pkg.relationships(main)
  const presentation = pkg.xml(main)
  if (presentation.documentElement.namespaceURI !== NS.slide) throw new Error('该文件不是支持的 PPTX 演示文稿')
  return descendants(presentation, NS.slide, 'sldId').map(slide => {
    const part = relationships.get(slide.getAttributeNS(NS.officeRelationship, 'id') ?? '')
    if (!part) throw new Error('PPTX 幻灯片关系不存在')
    return part
  })
}

const EMU_PER_POINT = 12700
const shapeElements = new Set(['sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp'])
interface PptxObject {
  shapeId: string; name: string; node: Element; paragraphs: Element[]; groupPath: string[]
  kind: PptxObjectInspection['kind']
}

function objects(pkg: OfficePackage, part: string): PptxObject[] {
  const result: PptxObject[] = []
  const root = descendants(pkg.xml(part), NS.slide, 'spTree')[0]
  if (!root) return result
  const walk = (container: Element, groupPath: string[]) => {
    for (const node of children(container, NS.slide, '*')) {
      if (!shapeElements.has(node.localName)) continue
      const identity = descendants(node, NS.slide, 'cNvPr')[0]
      const shapeId = identity?.getAttribute('id') ?? ''
      const body = children(node, NS.slide, 'txBody')[0]
      const kind = node.localName === 'pic' ? 'picture' : node.localName === 'grpSp' ? 'group'
        : node.localName === 'graphicFrame' ? (descendants(node, NS.drawing, 'tbl').length ? 'table' : 'unsupported') : 'shape'
      result.push({ shapeId, name: identity?.getAttribute('name') ?? '', node, groupPath, kind,
        paragraphs: body ? children(body, NS.drawing, 'p') : [] })
      if (kind === 'group') walk(node, [...groupPath, shapeId])
    }
  }
  walk(root, [])
  return result
}

function paragraphText(paragraph: Element): string {
  return descendants(paragraph, NS.drawing, '*')
    .map(node => node.localName === 'br' ? '\n' : node.localName === 't' ? node.textContent ?? '' : '').join('')
}
function propertyContainer(object: PptxObject): Element | undefined {
  return children(object.node, NS.slide, object.kind === 'group' ? 'grpSpPr' : 'spPr')[0]
}
function transformOf(object: PptxObject): Element | undefined {
  if (object.node.localName === 'graphicFrame') return children(object.node, NS.slide, 'xfrm')[0]
  const properties = propertyContainer(object)
  return properties ? children(properties, NS.drawing, 'xfrm')[0] : undefined
}
function relationshipOfType(pkg: OfficePackage, part: string, type: string): string | undefined {
  const name = path.posix.join(path.posix.dirname(part), '_rels', `${path.posix.basename(part)}.rels`)
  if (!pkg.parts[name]) return undefined
  const relation = descendants(pkg.xml(name), NS.relationship, 'Relationship')
    .find(item => item.getAttribute('Type')?.endsWith(`/${type}`) && item.getAttribute('TargetMode') !== 'External')
  return relation ? pkg.relationships(part).get(relation.getAttribute('Id') ?? '') : undefined
}
/** A local geometry override starts from its inherited placeholder transform, not an empty rectangle. */
function effectiveTransform(pkg: OfficePackage, part: string, object: PptxObject): Element | undefined {
  const own = transformOf(object)
  if (own) return own
  let placeholder = descendants(object.node, NS.slide, 'ph')[0]
  if (!placeholder || object.kind === 'group') return undefined
  let source = part
  for (const relationType of ['slideLayout', 'slideMaster']) {
    const next = relationshipOfType(pkg, source, relationType)
    if (!next || !pkg.parts[next]) break
    const candidates = objects(pkg, next).filter(candidate => {
      const ph = descendants(candidate.node, NS.slide, 'ph')[0]
      if (!ph) return false
      return relationType === 'slideLayout' ? (ph.getAttribute('idx') || '0') === (placeholder.getAttribute('idx') || '0')
        : (ph.getAttribute('type') || 'obj') === (placeholder.getAttribute('type') || 'obj')
    })
    if (candidates.length !== 1) break
    const inherited = transformOf(candidates[0])
    if (inherited) return inherited
    placeholder = descendants(candidates[0].node, NS.slide, 'ph')[0]
    source = next
  }
  return undefined
}
function numericAttribute(node: Element | undefined, name: string, fallback = 0): number {
  const value = node?.getAttribute(name)
  return value === null || value === undefined || value === '' ? fallback : Number(value)
}
function frameOf(object: PptxObject, inherited?: Element): PptxObjectFrame | undefined {
  const transform = transformOf(object) ?? inherited
  if (!transform) return undefined
  const off = children(transform, NS.drawing, 'off')[0], ext = children(transform, NS.drawing, 'ext')[0]
  if (!off || !ext) return undefined
  const frame = { x: numericAttribute(off, 'x') / EMU_PER_POINT, y: numericAttribute(off, 'y') / EMU_PER_POINT,
    width: numericAttribute(ext, 'cx') / EMU_PER_POINT, height: numericAttribute(ext, 'cy') / EMU_PER_POINT,
    rotation: numericAttribute(transform, 'rot') / 60000 }
  return Object.values(frame).every(Number.isFinite) ? frame : undefined
}
function insertBeforeNames(parent: Element, node: Element, names: string[]): void {
  const next = Array.from(parent.childNodes).find(child => child.nodeType === 1 && names.includes((child as Element).localName))
  parent.insertBefore(node, next ?? null)
}
function ensureDrawing(parent: Element, name: string, before: string[] = []): Element {
  const existing = children(parent, NS.drawing, name)[0]
  if (existing) return existing
  const element = parent.ownerDocument.createElementNS(NS.drawing, `a:${name}`)
  insertBeforeNames(parent, element, before)
  return element
}
function setAttribute(node: Element, name: string, value: string | number): boolean {
  const next = String(value)
  if (node.getAttribute(name) === next) return false
  node.setAttribute(name, next); return true
}
function toEmu(value: number): number {
  const result = Math.round(value * EMU_PER_POINT)
  if (!Number.isSafeInteger(result)) throw new Error('PPT 坐标超出可精确保存的范围')
  return result
}
function editTransform(object: PptxObject, edit: Extract<PptxObjectEdit, { type: 'transform' }>, inherited?: Element): boolean {
  let transform = transformOf(object)
  if (!transform) {
    if (!inherited && (object.kind === 'group' || edit.x === undefined || edit.y === undefined || edit.width === undefined || edit.height === undefined))
      throw new Error('目标位置来自版式继承；请提供完整位置与尺寸后再修改')
    if (object.node.localName === 'graphicFrame') {
      transform = object.node.ownerDocument.createElementNS(NS.slide, 'p:xfrm')
      insertBeforeNames(object.node, transform, ['graphic', 'extLst'])
    } else {
      let properties = propertyContainer(object)
      if (!properties) {
        properties = object.node.ownerDocument.createElementNS(NS.slide, 'p:spPr')
        insertBeforeNames(object.node, properties, ['style', 'txBody', 'extLst'])
      }
      transform = ensureDrawing(properties, 'xfrm', ['prstGeom', 'custGeom', 'noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill', 'ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'])
    }
    if (inherited) {
      const copy = inherited.cloneNode(true) as Element
      transform.parentNode!.replaceChild(copy, transform); transform = copy
    }
  }
  const off = ensureDrawing(transform, 'off', ['ext', 'chOff', 'chExt'])
  const ext = ensureDrawing(transform, 'ext', ['chOff', 'chExt'])
  let changed = false
  for (const [key, target, attribute] of [['x', off, 'x'], ['y', off, 'y'], ['width', ext, 'cx'], ['height', ext, 'cy']] as const) {
    const value = edit[key]
    if (value !== undefined) {
      const emu = toEmu(value)
      if ((key === 'width' || key === 'height') && emu < 1) throw new Error('PPT 对象尺寸须大于零')
      changed = setAttribute(target, attribute, emu) || changed
    }
  }
  if (edit.rotation !== undefined) changed = setAttribute(transform, 'rot', Math.round(((edit.rotation % 360 + 360) % 360) * 60000)) || changed
  return changed
}

function replaceParagraphs(body: Element, paragraphs: Element[], text: string, singleParagraph: boolean): boolean {
  if (!paragraphs.length) throw new Error('PPT 目标没有可编辑文本段落')
  if (paragraphs.map(paragraphText).join('\n') === text.replace(/\r\n/g, '\n')) return false
  if (paragraphs.some(paragraph => descendants(paragraph, NS.drawing, 'fld').length)) throw new Error('目标含幻灯片自动域，不能用普通文本替换')
  const lines = text.split(/\r?\n/)
  if (lines.length > paragraphs.length && singleParagraph) throw new Error('段落局部修改不能增加段落；请修改整个文本形状')
  while (lines.length > paragraphs.length) {
    const paragraph = paragraphs[paragraphs.length - 1].cloneNode(true) as Element
    body.appendChild(paragraph); paragraphs.push(paragraph)
  }
  for (let index = 0; index < paragraphs.length; index++) {
    const paragraph = paragraphs[index]
    replaceTextRange(paragraph, NS.drawing, 0, textOf(paragraph, NS.drawing).length, lines[index] ?? '')
    for (const br of children(paragraph, NS.drawing, 'br')) paragraph.removeChild(br)
  }
  return true
}
function selectedParagraphs(object: PptxObject, index: number | undefined): Element[] {
  if (index === undefined) return [...object.paragraphs]
  const paragraph = object.paragraphs[index]
  if (!paragraph) throw new Error(`PPT 段落不存在：${index}`)
  return [paragraph]
}
const fillNames = ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']
function colorOf(properties: Element | undefined): string | null | undefined {
  if (!properties) return undefined
  if (children(properties, NS.drawing, 'noFill').length) return null
  const solid = children(properties, NS.drawing, 'solidFill')[0]
  return solid ? children(solid, NS.drawing, 'srgbClr')[0]?.getAttribute('val') ?? undefined : undefined
}
function setFill(properties: Element, color: string | null): boolean {
  const previous = colorOf(properties)
  if (previous !== undefined && (previous === null ? color === null : color !== null && previous.toUpperCase() === color.toUpperCase())) return false
  const oldSolid = children(properties, NS.drawing, 'solidFill')[0]
  const oldColor = oldSolid ? children(oldSolid, NS.drawing, '*')[0] : undefined
  const alpha = oldColor ? children(oldColor, NS.drawing, '*').filter(node => ['alpha', 'alphaMod', 'alphaOff'].includes(node.localName)) : []
  for (const child of children(properties, NS.drawing, '*')) if (fillNames.includes(child.localName)) properties.removeChild(child)
  const fill = properties.ownerDocument.createElementNS(NS.drawing, color === null ? 'a:noFill' : 'a:solidFill')
  if (color !== null) {
    const value = properties.ownerDocument.createElementNS(NS.drawing, 'a:srgbClr')
    value.setAttribute('val', color.toUpperCase())
    for (const transform of alpha) value.appendChild(transform.cloneNode(true))
    fill.appendChild(value)
  }
  insertBeforeNames(properties, fill, ['ln', 'effectLst', 'effectDag', 'highlight', 'uLnTx', 'uLn', 'uFillTx', 'uFill', 'latin', 'ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'scene3d', 'sp3d', 'extLst'])
  return true
}
function inspectTextStyle(properties: Element | undefined): Partial<PptxTextStyle> {
  if (!properties) return {}
  const style: Partial<PptxTextStyle> = {}
  for (const key of ['bold', 'italic'] as const) {
    const value = properties.getAttribute(key === 'bold' ? 'b' : 'i')
    if (value) style[key] = value === '1' || value === 'true'
  }
  if (properties.hasAttribute('u')) style.underline = properties.getAttribute('u') !== 'none'
  if (properties.hasAttribute('sz')) style.fontSize = numericAttribute(properties, 'sz') / 100
  const color = colorOf(properties)
  if (color) style.color = color
  const family = children(properties, NS.drawing, 'latin')[0]?.getAttribute('typeface')
  if (family) style.fontFamily = family
  return style
}
function applyTextStyle(properties: Element, style: PptxTextStyle): boolean {
  let changed = false
  if (style.bold !== undefined) changed = setAttribute(properties, 'b', style.bold ? '1' : '0') || changed
  if (style.italic !== undefined) changed = setAttribute(properties, 'i', style.italic ? '1' : '0') || changed
  if (style.underline !== undefined) changed = setAttribute(properties, 'u', style.underline ? 'sng' : 'none') || changed
  if (style.fontSize !== undefined) {
    const size = Math.round(style.fontSize * 100)
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('字号超出可精确保存的范围')
    changed = setAttribute(properties, 'sz', size) || changed
  }
  if (style.color !== undefined) changed = setFill(properties, style.color) || changed
  if (style.fontFamily !== undefined) for (const name of ['latin', 'ea', 'cs']) {
    const font = ensureDrawing(properties, name, name === 'latin' ? ['ea', 'cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'] : name === 'ea' ? ['cs', 'sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'] : ['sym', 'hlinkClick', 'hlinkMouseOver', 'rtl', 'extLst'])
    changed = setAttribute(font, 'typeface', style.fontFamily) || changed
  }
  return changed
}
function editTextStyle(object: PptxObject, edit: Extract<PptxObjectEdit, { type: 'textStyle' }>): boolean {
  if (edit.run !== undefined && edit.paragraph === undefined) throw new Error('修改文字run样式时须指定段落')
  const paragraphs = selectedParagraphs(object, edit.paragraph)
  if (!paragraphs.length) throw new Error('目标没有可编辑文字样式')
  let changed = false
  for (const paragraph of paragraphs) {
    if (descendants(paragraph, NS.drawing, 'fld').length) throw new Error('自动域样式不在当前可编辑范围内')
    const runs = children(paragraph, NS.drawing, 'r')
    if (edit.run !== undefined) {
      const run = runs[edit.run]
      if (!run) throw new Error(`PPT 文字run不存在：${edit.run}`)
      const properties = ensureDrawing(run, 'rPr', ['t'])
      changed = applyTextStyle(properties, edit.style) || changed
    } else {
      const paragraphProperties = ensureDrawing(paragraph, 'pPr', ['r', 'br', 'fld', 'endParaRPr'])
      const defaults = ensureDrawing(paragraphProperties, 'defRPr', ['extLst'])
      changed = applyTextStyle(defaults, edit.style) || changed
      for (const run of runs) changed = applyTextStyle(ensureDrawing(run, 'rPr', ['t']), edit.style) || changed
      const end = children(paragraph, NS.drawing, 'endParaRPr')[0]
      if (end) changed = applyTextStyle(end, edit.style) || changed
    }
  }
  return changed
}
function editLayer(object: PptxObject, position: Extract<PptxObjectEdit, { type: 'layer' }>['position']): boolean {
  const parent = object.node.parentNode as Element
  const siblings = children(parent, NS.slide, '*').filter(node => shapeElements.has(node.localName))
  const index = siblings.indexOf(object.node)
  if (index < 0) throw new Error('PPT 对象不在可排列的对象层内')
  if (position === 'front' && index !== siblings.length - 1) parent.insertBefore(object.node, siblings[siblings.length - 1].nextSibling)
  else if (position === 'back' && index !== 0) parent.insertBefore(object.node, siblings[0])
  else if (position === 'forward' && index < siblings.length - 1) parent.insertBefore(object.node, siblings[index + 1].nextSibling)
  else if (position === 'backward' && index > 0) parent.insertBefore(object.node, siblings[index - 1])
  else return false
  return true
}
function pictureFill(object: PptxObject): Element {
  if (object.kind !== 'picture') throw new Error('目标不是可编辑图片')
  const fill = children(object.node, NS.slide, 'blipFill')[0]
  if (!fill) throw new Error('图片没有受支持的图像关系')
  return fill
}
function cropOf(object: PptxObject): PptxObjectInspection['crop'] {
  if (object.kind !== 'picture') return undefined
  const crop = children(pictureFill(object), NS.drawing, 'srcRect')[0]
  return { left: numericAttribute(crop, 'l') / 1000, top: numericAttribute(crop, 't') / 1000,
    right: numericAttribute(crop, 'r') / 1000, bottom: numericAttribute(crop, 'b') / 1000 }
}
function editImage(pkg: OfficePackage, part: string, object: PptxObject, edit: Extract<PptxObjectEdit, { type: 'replaceImage' }>): boolean {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(edit.image.base64)) throw new Error('图片内容不是有效的Base64')
  const bytes = Uint8Array.from(Buffer.from(edit.image.base64, 'base64'))
  const mime = edit.image.contentType
  const valid = mime === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : Buffer.from(bytes.subarray(0, 6)).toString('ascii') === 'GIF87a' || Buffer.from(bytes.subarray(0, 6)).toString('ascii') === 'GIF89a'
  if (!valid) throw new Error('图片字节与声明格式不匹配')
  const fill = pictureFill(object), blip = children(fill, NS.drawing, 'blip')[0]
  if (!blip) throw new Error('图片没有受支持的blip关系')
  const previousId = blip.getAttributeNS(NS.officeRelationship, 'embed')
  const previousPart = previousId ? pkg.relationships(part).get(previousId) : undefined
  const previous = previousPart ? pkg.parts[previousPart] : undefined
  if (previous?.length === bytes.length && previous.every((value, index) => value === bytes[index])) return false
  const extension = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'gif'
  const digest = createHash('sha256').update(bytes).digest('hex')
  const imagePart = `ppt/media/guoling-${digest}.${extension}`
  pkg.setBinary(imagePart, bytes)
  const relationshipsPart = path.posix.join(path.posix.dirname(part), '_rels', `${path.posix.basename(part)}.rels`)
  if (!pkg.parts[relationshipsPart]) pkg.parts[relationshipsPart] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${NS.relationship}"/>`)
  const relationships = pkg.xml(relationshipsPart).documentElement
  const usedIds = new Set(descendants(relationships, NS.relationship, 'Relationship').map(item => item.getAttribute('Id')))
  let number = 1
  while (usedIds.has(`rId${number}`)) number++
  const id = `rId${number}`, relation = relationships.ownerDocument.createElementNS(NS.relationship, 'Relationship')
  relation.setAttribute('Id', id); relation.setAttribute('Type', `${NS.officeRelationship}/image`)
  relation.setAttribute('Target', path.posix.relative(path.posix.dirname(part), imagePart))
  relationships.appendChild(relation); pkg.write(relationshipsPart)
  blip.setAttributeNS(NS.officeRelationship, 'r:embed', id)
  blip.removeAttributeNS(NS.officeRelationship, 'link')
  const types = pkg.xml('[Content_Types].xml').documentElement
  const typeNamespace = 'http://schemas.openxmlformats.org/package/2006/content-types'
  if (!descendants(types, typeNamespace, 'Default').some(item => item.getAttribute('Extension')?.toLowerCase() === extension && item.getAttribute('ContentType') === mime)
    && !descendants(types, typeNamespace, 'Override').some(item => item.getAttribute('PartName') === `/${imagePart}` && item.getAttribute('ContentType') === mime)) {
    const entry = types.ownerDocument.createElementNS(typeNamespace, 'Override')
    entry.setAttribute('PartName', `/${imagePart}`); entry.setAttribute('ContentType', mime)
    types.appendChild(entry); pkg.write('[Content_Types].xml')
  }
  return true
}
function tableCells(object: PptxObject): Element[][] {
  if (object.kind !== 'table') throw new Error('目标不是可编辑表格')
  const table = descendants(object.node, NS.drawing, 'tbl')[0]
  return children(table, NS.drawing, 'tr').map(row => children(row, NS.drawing, 'tc'))
}

export function editPptx(pkg: OfficePackage, request: OfficeRequest<'pptx', 'edit'>) {
  const parts = slideParts(pkg)
  for (const edit of request.edits) {
    const part = parts[edit.slide]
    if (!part) throw new Error(`PPT 幻灯片不存在：${edit.slide}`)
    if (edit.part !== undefined && edit.part !== part) throw new Error('PPT 幻灯片位置已改变，请重新读取原件后修改')
    if (edit.partVersion !== undefined && edit.partVersion !== pkg.partVersion(part)) throw new Error('PPT 幻灯片内容已改变，请重新读取原件后修改')
    if (edit.type === 'animationTiming') { editAnimationTiming(pkg, part, edit); continue }
    const targets = objects(pkg, part).filter(object => edit.shapeId !== undefined ? object.shapeId === edit.shapeId : object.name === edit.shape)
    if (targets.length !== 1) throw new Error(`PPT 对象须唯一：${edit.shapeId ?? edit.shape}（匹配 ${targets.length}）`)
    const object = targets[0]
    if (edit.type === 'chartValue') { editChartValue(pkg, part, object.node, edit); continue }
    let changed = false
    if (edit.type === undefined || edit.type === 'text') {
      const body = children(object.node, NS.slide, 'txBody')[0]
      if (!body) throw new Error('PPT 目标没有可编辑文本段落')
      changed = replaceParagraphs(body, selectedParagraphs(object, edit.paragraph), edit.text, edit.paragraph !== undefined)
    } else if (edit.type === 'runText') {
      const paragraph = selectedParagraphs(object, edit.paragraph)[0]
      const run = children(paragraph, NS.drawing, 'r')[edit.run]
      if (!run) throw new Error(`PPT 文字run不存在：${edit.run}`)
      if (textOf(run, NS.drawing) !== edit.text) { replaceTextRange(run, NS.drawing, 0, textOf(run, NS.drawing).length, edit.text); changed = true }
    } else if (edit.type === 'transform') changed = editTransform(object, edit, effectiveTransform(pkg, part, object))
    else if (edit.type === 'textStyle') changed = editTextStyle(object, edit)
    else if (edit.type === 'shapeStyle') {
      if (object.kind !== 'shape') throw new Error('当前目标不支持形状填充/轮廓修改')
      const properties = propertyContainer(object)
      if (!properties) throw new Error('目标没有可编辑形状属性')
      if (edit.fill !== undefined) changed = setFill(properties, edit.fill) || changed
      if (edit.stroke !== undefined || edit.strokeWidth !== undefined) {
        const line = ensureDrawing(properties, 'ln', ['effectLst', 'effectDag', 'scene3d', 'sp3d', 'extLst'])
        if (edit.stroke !== undefined) changed = setFill(line, edit.stroke) || changed
        if (edit.strokeWidth !== undefined) changed = setAttribute(line, 'w', toEmu(edit.strokeWidth)) || changed
      }
    } else if (edit.type === 'layer') changed = editLayer(object, edit.position)
    else if (edit.type === 'replaceImage') changed = editImage(pkg, part, object, edit)
    else if (edit.type === 'imageCrop') {
      const crop = ensureDrawing(pictureFill(object), 'srcRect', ['tile', 'stretch'])
      for (const [key, attribute] of [['left', 'l'], ['top', 't'], ['right', 'r'], ['bottom', 'b']] as const) {
        const value = Math.round(edit[key] * 1000)
        if (!Number.isSafeInteger(value)) throw new Error('图片裁切比例超出可精确保存的范围')
        changed = setAttribute(crop, attribute, value) || changed
      }
    } else if (edit.type === 'tableCell') {
      const cell = tableCells(object)[edit.row]?.[edit.column]
      if (!cell) throw new Error(`PPT 表格单元格不存在：${edit.row}, ${edit.column}`)
      if (['hMerge', 'vMerge'].some(name => ['1', 'true'].includes(cell.getAttribute(name) ?? ''))) throw new Error('合并单元格请修改其左上角单元格')
      const body = children(cell, NS.drawing, 'txBody')[0]
      if (!body) throw new Error('表格单元格缺少文字结构')
      changed = replaceParagraphs(body, children(body, NS.drawing, 'p'), edit.text, false)
    }
    if (changed) pkg.write(part)
  }
}

export function inspectPptx(pkg: OfficePackage): Extract<OfficeContentInspection, { format: 'pptx' }> {
  const size = descendants(pkg.xml(pkg.main()), NS.slide, 'sldSz')[0]
  return { format: 'pptx', width: numericAttribute(size, 'cx') / EMU_PER_POINT, height: numericAttribute(size, 'cy') / EMU_PER_POINT,
    slides: slideParts(pkg).map((part, index) => ({ index, part, partVersion: pkg.partVersion(part), animations: inspectAnimations(pkg, part), shapes: objects(pkg, part).map(object => {
      const frame = frameOf(object, effectiveTransform(pkg, part, object)), properties = propertyContainer(object)
      const hasFields = object.paragraphs.some(paragraph => descendants(paragraph, NS.drawing, 'fld').length > 0)
      const editable: PptxObjectInspection['editable'] = ['layer']
      if (object.kind !== 'unsupported') editable.push('transform')
      if (object.paragraphs.length && !hasFields) editable.push('text', 'runText', 'textStyle')
      if (object.kind === 'shape' && properties) editable.push('shapeStyle')
      if (object.kind === 'picture') editable.push('replaceImage', 'imageCrop')
      if (object.kind === 'table') editable.push('tableCell')
      const runs = object.paragraphs.map(paragraph => children(paragraph, NS.drawing, 'r').map(run => ({ text: textOf(run, NS.drawing), style: inspectTextStyle(children(run, NS.drawing, 'rPr')[0]) })))
      return { shapeId: object.shapeId, name: object.name, kind: object.kind, groupPath: object.groupPath,
        text: object.paragraphs.map(paragraphText).join('\n'), paragraphs: object.paragraphs.map(paragraphText), frame, runs,
        textStyle: runs[0]?.[0]?.style, fill: colorOf(properties), stroke: colorOf(properties ? children(properties, NS.drawing, 'ln')[0] : undefined),
        crop: cropOf(object), cells: object.kind === 'table' ? tableCells(object).map(row => row.map(cell => descendants(cell, NS.drawing, 'p').map(paragraphText).join('\n'))) : undefined,
        chart: inspectChart(pkg, part, object.node), editable }
    }) })) }
}
