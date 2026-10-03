import PptxGenJS from 'pptxgenjs'
import { children, descendants, NS, OfficePackage, replaceTextRange, textOf } from './officePackage'
import type { OfficeContentInspection, OfficeRequest } from '../../../shared/workbench/officeFiles'

export async function createPptx(request: OfficeRequest<'pptx', 'create'>): Promise<Uint8Array> {
  const pptx = new PptxGenJS()
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

function shapes(pkg: OfficePackage, part: string): Array<{ name: string; node: Element; paragraphs: Element[] }> {
  // Text shapes can be nested inside groups. Do not flatten or regenerate the group.
  return descendants(pkg.xml(part), NS.slide, 'sp').map(node => ({
    name: descendants(node, NS.slide, 'cNvPr')[0]?.getAttribute('name') ?? '', node,
    paragraphs: descendants(node, NS.drawing, 'p'),
  }))
}

export function editPptx(pkg: OfficePackage, request: OfficeRequest<'pptx', 'edit'>) {
  const parts = slideParts(pkg)
  for (const edit of request.edits) {
    const part = parts[edit.slide]
    if (!part) throw new Error(`PPT 幻灯片不存在：${edit.slide}`)
    const targets = shapes(pkg, part).filter(shape => shape.name === edit.shape)
    if (targets.length !== 1) throw new Error(`PPT 文本形状须唯一：${edit.shape}（匹配 ${targets.length}）`)
    const shape = targets[0]
    let paragraphs = shape.paragraphs
    if (edit.paragraph !== undefined) {
      const paragraph = paragraphs[edit.paragraph]
      if (!paragraph) throw new Error(`PPT 段落不存在：${edit.paragraph}`)
      paragraphs = [paragraph]
    }
    if (!paragraphs.length) throw new Error('PPT 目标没有可编辑文本段落')
    const lines = edit.text.split(/\r?\n/)
    const body = descendants(shape.node, NS.slide, 'txBody')[0]
    if (lines.length > paragraphs.length && edit.paragraph !== undefined) throw new Error('段落局部修改不能增加段落；请修改整个文本形状')
    while (lines.length > paragraphs.length) {
      const paragraph = paragraphs[paragraphs.length - 1].cloneNode(true) as Element
      body.appendChild(paragraph); paragraphs.push(paragraph)
    }
    for (let index = 0; index < paragraphs.length; index++) {
      const paragraph = paragraphs[index]
      if (descendants(paragraph, NS.drawing, 'fld').length) throw new Error('目标含幻灯片自动域，不能用普通文本替换')
      replaceTextRange(paragraph, NS.drawing, 0, textOf(paragraph, NS.drawing).length, lines[index] ?? '')
      // Explicit line breaks would otherwise retain obsolete text layout after full paragraph replacement.
      for (const br of children(paragraph, NS.drawing, 'br')) paragraph.removeChild(br)
    }
    pkg.write(part)
  }
}

export function inspectPptx(pkg: OfficePackage): Extract<OfficeContentInspection, { format: 'pptx' }> {
  return { format: 'pptx', slides: slideParts(pkg).map((part, index) => ({ index, shapes: shapes(pkg, part).map(shape => ({
    name: shape.name, text: shape.paragraphs.map(paragraph => textOf(paragraph, NS.drawing)).join('\n'),
    paragraphs: shape.paragraphs.map(paragraph => textOf(paragraph, NS.drawing)),
  })) })) }
}
