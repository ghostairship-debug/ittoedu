import path from 'node:path'
import { strToU8 } from 'fflate'
import { children, descendants, NS, OfficePackage, replaceTextRange, textOf } from './officePackage'
import type { DocxBodyBlock, DocxParagraphStyle, DocxTextStyle, OfficeContentInspection, OfficeRequest } from '../../../shared/workbench/officeFiles'

export async function createDocx(request: OfficeRequest<'docx', 'create'>): Promise<Uint8Array> {
  const { Document: WordDocument, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = await import('docx')
  const headings = { title: HeadingLevel.TITLE, heading1: HeadingLevel.HEADING_1, heading2: HeadingLevel.HEADING_2, heading3: HeadingLevel.HEADING_3 }
  const blocks = request.blocks.map(block => block.type === 'paragraph'
    ? new Paragraph({
      heading: block.heading ? headings[block.heading] : undefined,
      children: (block.runs ?? [{ text: block.text ?? '' }]).map(run => new TextRun({ text: run.text, bold: run.bold, italics: run.italic, color: run.color })),
      spacing: { after: 160 },
    })
    : new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: block.rows.map(row => new TableRow({ children: row.map(text => new TableCell({ children: [new Paragraph(text)] })) })) }))
  return new Uint8Array(await Packer.toBuffer(new WordDocument({
    title: request.title, creator: '果铃',
    styles: { default: { document: { run: { font: 'Arial', size: 22 }, paragraph: { spacing: { line: 280 } } } } },
    sections: [{ children: blocks }],
  })))
}

function wordBody(pkg: OfficePackage): { main: string; body: Element } {
  const main = pkg.main()
  const body = descendants(pkg.xml(main), NS.word, 'body')[0]
  if (!body) throw new Error('该文件不是支持的 DOCX 正文')
  return { main, body }
}

function replace(container: Element, replacement: string, start = 0, length = textOf(container, NS.word).length) {
  if (descendants(container, NS.word, 'fldChar').length || descendants(container, NS.word, 'instrText').length || descendants(container, NS.word, 'fldSimple').length) {
    throw new Error('目标包含 Word 域；此文本操作不能替换自动计算的域内容')
  }
  if (/[\r\n\t]/.test(replacement)) throw new Error('换行请使用新增段落。')
  const texts = descendants(container, NS.word, 't')
  if (!texts.length) { replaceTextRange(container, NS.word, start, length, replacement); return }
  let offset = 0, inserted = false
  const end = start + length
  for (let index = 0; index < texts.length; index++) {
    const node = texts[index], original = node.textContent ?? '', finish = offset + original.length
    const overlaps = length > 0 ? finish > start && offset < end : !inserted && (finish > start || index === texts.length - 1)
    if (overlaps) {
      const prefix = original.slice(0, Math.max(0, start - offset)), suffix = original.slice(Math.max(0, end - offset))
      node.textContent = prefix + (inserted ? '' : replacement) + suffix
      node.setAttribute('xml:space', 'preserve'); inserted = true
    }
    offset = finish
  }
  if (!inserted) throw new Error('文本位置不存在。')
}

function wordElement(xml: Document, name: string, value?: string): Element {
  const node = xml.createElementNS(NS.word, `w:${name}`)
  if (value !== undefined) node.setAttributeNS(NS.word, 'w:val', value)
  return node
}
function property(container: Element, name: string): Element {
  let node = children(container, NS.word, name)[0]
  if (!node) {
    node = wordElement(container.ownerDocument, name)
    const before = container.localName === 'pPr' && name === 'rPr'
      ? children(container, NS.word, '*').find(value => ['sectPr', 'pPrChange'].includes(value.localName)) ?? null
      : container.firstChild
    container.insertBefore(node, before)
  }
  return node
}
function setProperty(container: Element, name: string, value: string) {
  let node = children(container, NS.word, name)[0]
  if (!node) {
    node = wordElement(container.ownerDocument, name)
    const before = container.localName === 'pPr'
      ? name === 'pStyle' ? container.firstChild
        : children(container, NS.word, '*').find(value => ['textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'].includes(value.localName)) ?? null
      : null
    container.insertBefore(node, before)
  }
  node.setAttributeNS(NS.word, 'w:val', value)
}
function valueOf(container: Element | undefined, name: string): string | undefined {
  const node = container && children(container, NS.word, name)[0]
  return node ? node.getAttributeNS(NS.word, 'val') ?? 'true' : undefined
}
function paragraphStyle(paragraph: Element): DocxParagraphStyle {
  const pPr = children(paragraph, NS.word, 'pPr')[0], runs = descendants(paragraph, NS.word, 'r')
  const style: DocxParagraphStyle = {}
  const heading = valueOf(pPr, 'pStyle'), alignment = valueOf(pPr, 'jc')
  if (heading && ['Normal', 'Title', 'Heading1', 'Heading2', 'Heading3'].includes(heading)) style.heading = heading as DocxParagraphStyle['heading']
  if (alignment && ['left', 'center', 'right', 'both'].includes(alignment)) style.alignment = alignment as DocxParagraphStyle['alignment']
  for (const [name, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
    const values = runs.map(run => valueOf(children(run, NS.word, 'rPr')[0], name)).filter(value => value !== undefined)
    if (values.length && values.length === runs.length && values.every(value => !['0', 'false', 'off', 'none'].includes(value!))) style[key] = true
  }
  return style
}
function applyParagraphStyle(paragraph: Element, style: DocxParagraphStyle) {
  const pPr = property(paragraph, 'pPr')
  if (style.heading !== undefined) setProperty(pPr, 'pStyle', style.heading)
  if (style.alignment !== undefined) setProperty(pPr, 'jc', style.alignment)
  for (const [name, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
    if (style[key] === undefined) continue
    const value = key === 'underline' ? style[key] ? 'single' : 'none' : style[key] ? '1' : '0'
    setProperty(property(pPr, 'rPr'), name, value)
    for (const run of descendants(paragraph, NS.word, 'r')) setProperty(property(run, 'rPr'), name, value)
  }
}
function ensureParagraphStyle(pkg: OfficePackage, heading: NonNullable<DocxParagraphStyle['heading']>) {
  const main = pkg.main(), relName = path.posix.join(path.posix.dirname(main), '_rels', path.posix.basename(main) + '.rels')
  if (!pkg.parts[relName]) pkg.setBinary(relName, strToU8(`<Relationships xmlns="${NS.relationship}"/>`))
  const rels = pkg.xml(relName), relations = descendants(rels, NS.relationship, 'Relationship')
  let relation = relations.find(value => value.getAttribute('Type')?.endsWith('/styles'))
  let part = relation ? pkg.relationships(main).get(relation.getAttribute('Id') ?? '') : undefined
  if (!part) {
    part = path.posix.join(path.posix.dirname(main), 'styles.xml')
    let index = 1
    while (pkg.parts[part]) part = path.posix.join(path.posix.dirname(main), `styles-guoling-${index++}.xml`)
    let id = 1; while (relations.some(value => value.getAttribute('Id') === `rId${id}`)) id++
    relation = rels.createElementNS(NS.relationship, 'Relationship'); relation.setAttribute('Id', `rId${id}`)
    relation.setAttribute('Type', `${NS.officeRelationship}/styles`); relation.setAttribute('Target', path.posix.relative(path.posix.dirname(main), part))
    rels.documentElement.appendChild(relation); pkg.write(relName)
    pkg.setBinary(part, strToU8(`<w:styles xmlns:w="${NS.word}"/>`))
    const types = pkg.xml('[Content_Types].xml'), type = types.createElementNS(types.documentElement.namespaceURI!, 'Override')
    type.setAttribute('PartName', '/' + part); type.setAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml')
    types.documentElement.appendChild(type); pkg.write('[Content_Types].xml')
  }
  const styles = pkg.xml(part)
  if (descendants(styles, NS.word, 'style').some(value => value.getAttributeNS(NS.word, 'styleId') === heading)) return
  if (heading !== 'Normal') ensureParagraphStyle(pkg, 'Normal')
  const style = wordElement(styles, 'style'); style.setAttributeNS(NS.word, 'w:type', 'paragraph'); style.setAttributeNS(NS.word, 'w:styleId', heading)
  style.appendChild(wordElement(styles, 'name', heading === 'Normal' ? 'Normal' : heading === 'Title' ? 'Title' : `heading ${heading.slice(-1)}`))
  if (heading !== 'Normal') { style.appendChild(wordElement(styles, 'basedOn', 'Normal')); style.appendChild(wordElement(styles, 'next', 'Normal')) }
  else style.setAttributeNS(NS.word, 'w:default', '1')
  style.appendChild(wordElement(styles, 'qFormat'))
  if (heading.startsWith('Heading')) {
    const properties = wordElement(styles, 'pPr'); properties.appendChild(wordElement(styles, 'keepNext')); properties.appendChild(wordElement(styles, 'outlineLvl', String(Number(heading.slice(-1)) - 1))); style.appendChild(properties)
  }
  const run = wordElement(styles, 'rPr')
  if (heading !== 'Normal') run.appendChild(wordElement(styles, 'b', '1'))
  run.appendChild(wordElement(styles, 'sz', heading === 'Title' ? '44' : heading === 'Heading1' ? '36' : heading === 'Heading2' ? '30' : heading === 'Heading3' ? '26' : '22'))
  style.appendChild(run); styles.documentElement.appendChild(style); pkg.write(part)
}
/** Change only the text range that differs so untouched runs keep their formatting. */
function replaceParagraph(paragraph: Element, text: string) {
  const original = textOf(paragraph, NS.word)
  if (original === text) return
  let start = 0, end = 0
  while (start < original.length && start < text.length && original[start] === text[start]) start++
  while (end < original.length - start && end < text.length - start && original[original.length - end - 1] === text[text.length - end - 1]) end++
  replace(paragraph, text.slice(start, text.length - end), start, original.length - start - end)
}
function editNotice(paragraph: Element): string | undefined {
  if (descendants(paragraph, NS.word, 'p').length) return '此段包含嵌套文本框，保留原结构；请定位文本框内的段落进行修改。'
  if (['fldChar', 'instrText', 'fldSimple'].some(name => descendants(paragraph, NS.word, name).length)) return '此段含自动域，保留原结构；请通过专业文件操作修改域或域外文本。'
  if (['ins', 'del', 'moveFrom', 'moveTo', 'br', 'tab'].some(name => descendants(paragraph, NS.word, name).length)) return '此段含修订或特殊换行结构，正文编辑视图暂只读；原结构仍保留。'
  return undefined
}

function runStyle(run: Element): DocxTextStyle {
  const properties = children(run, NS.word, 'rPr')[0], style: DocxTextStyle = {}
  for (const [name, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
    const value = valueOf(properties, name)
    if (value !== undefined) style[key] = !['0', 'false', 'off', 'none'].includes(value)
  }
  return style
}
function applyRunStyle(run: Element, style: DocxTextStyle) {
  for (const [name, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
    if (style[key] !== undefined) setProperty(property(run, 'rPr'), name, key === 'underline' ? style[key] ? 'single' : 'none' : style[key] ? '1' : '0')
  }
}
/** Inline edits may retain opaque siblings; paragraph removal must not remove them. */
function structureEditable(paragraph: Element): boolean {
  const parent = paragraph.parentNode as Element | null
  if (!parent || parent.namespaceURI !== NS.word || !['body', 'tc'].includes(parent.localName)) return false
  if (descendants(paragraph, NS.word, 'sectPr').length) return false
  return Array.from(paragraph.childNodes).every(node => node.nodeType !== 1 || (node as Element).namespaceURI === NS.word && (
    (node as Element).localName === 'pPr' || (node as Element).localName === 'r' && Array.from(node.childNodes).every(child => child.nodeType !== 1 ||
      (child as Element).namespaceURI === NS.word && ['rPr', 't'].includes((child as Element).localName))))
}
function setText(node: Element, text: string) { node.textContent = text; node.setAttribute('xml:space', 'preserve') }
function splitsCharacter(text: string, offset: number): boolean {
  return offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
}
function completeCharacters(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    if (/[\uD800-\uDBFF]/.test(text[index])) { if (!/[\uDC00-\uDFFF]/.test(text[++index] ?? '')) return false }
    else if (/[\uDC00-\uDFFF]/.test(text[index])) return false
  }
  return true
}
/** Split a run without reserializing its properties or duplicating opaque children. */
function splitRun(run: Element, offset: number): Element {
  const right = run.cloneNode(false) as Element
  const properties = children(run, NS.word, 'rPr')[0]
  if (properties) right.appendChild(properties.cloneNode(true))
  let at = 0
  for (const child of Array.from(run.childNodes)) {
    if (child === properties) continue
    if (child.nodeType === 1 && (child as Element).namespaceURI === NS.word && (child as Element).localName === 't') {
      const text = child.textContent ?? '', end = at + text.length
      if (at >= offset) right.appendChild(child)
      else if (end > offset) {
        const rest = child.cloneNode(true) as Element
        setText(child as Element, text.slice(0, offset - at)); setText(rest, text.slice(offset - at)); right.appendChild(rest)
      }
      at = end
    } else if (at > offset) right.appendChild(child)
  }
  run.parentNode!.insertBefore(right, run.nextSibling)
  return right
}
function splitRunsAt(paragraph: Element, offset: number) {
  let at = 0
  for (const run of descendants(paragraph, NS.word, 'r')) {
    const length = textOf(run, NS.word).length
    if (offset > at && offset < at + length) { splitRun(run, offset - at); return }
    at += length
  }
}
function insertionRun(paragraph: Element, offset: number): Element | undefined {
  let at = 0, previous: Element | undefined
  for (const run of descendants(paragraph, NS.word, 'r')) {
    const end = at + textOf(run, NS.word).length
    if (end >= offset && end > at) return run
    at = end; previous = run
  }
  return previous
}
type WordReplacement = Extract<OfficeRequest<'docx', 'edit'>['edits'][number], { type: 'replaceRange' }>
function styledRuns(paragraph: Element, runs: WordReplacement['paragraphs'][number]['runs'], template?: Element): Element[] {
  return runs.filter(run => run.text.length > 0).map(run => {
    if (/[\r\n\t]/.test(run.text)) throw new Error('换行请使用段落，制表结构请使用专业文件操作。')
    if (!completeCharacters(run.text)) throw new Error('文字范围必须保留完整的 Unicode 字符。')
    const element = wordElement(paragraph.ownerDocument, 'r'), properties = template && children(template, NS.word, 'rPr')[0]
    if (properties) element.appendChild(properties.cloneNode(true))
    applyRunStyle(element, run.style ?? {})
    const text = wordElement(paragraph.ownerDocument, 't'); setText(text, run.text); element.appendChild(text)
    return element
  })
}
function replaceInlineRange(paragraph: Element, from: number, to: number, runs: WordReplacement['paragraphs'][number]['runs']) {
  // PM's minimal diff uses UTF-16 offsets and may replace only the low
  // surrogate. Keep the completed character in one w:t before UTF-8 encoding.
  const original = textOf(paragraph, NS.word)
  runs = runs.map(run => ({ ...run }))
  if (!runs.length) runs.push({ text: '' })
  if (splitsCharacter(original, from)) { runs[0].text = original[from - 1] + runs[0].text; from-- }
  if (splitsCharacter(original, to)) { runs[runs.length - 1].text += original[to]; to++ }
  const template = insertionRun(paragraph, from)?.cloneNode(true) as Element | undefined
  splitRunsAt(paragraph, to); splitRunsAt(paragraph, from)
  let at = 0, anchor: Element | undefined
  for (const run of descendants(paragraph, NS.word, 'r')) {
    const length = textOf(run, NS.word).length
    if (!anchor && at >= from && length > 0) anchor = run
    if (at >= from && at + length <= to && length > 0) for (const text of descendants(run, NS.word, 't')) setText(text, '')
    at += length
  }
  const parent = anchor?.parentNode ?? paragraph
  for (const run of styledRuns(paragraph, runs, template)) parent.insertBefore(run, anchor ?? null)
}
function splitParagraph(paragraph: Element, offset: number): Element {
  const right = paragraph.cloneNode(false) as Element, properties = children(paragraph, NS.word, 'pPr')[0]
  if (properties) right.appendChild(properties.cloneNode(true))
  let at = 0
  for (const run of children(paragraph, NS.word, 'r')) {
    const length = textOf(run, NS.word).length
    if (at >= offset) right.appendChild(run)
    else if (at + length > offset) right.appendChild(splitRun(run, offset - at))
    at += length
  }
  return right
}
function replaceRange(body: Element, edit: WordReplacement) {
  const paragraphs = descendants(body, NS.word, 'p'), first = paragraphs[edit.start.paragraph], last = paragraphs[edit.end.paragraph]
  if (!first || !last || edit.start.paragraph > edit.end.paragraph || edit.start.paragraph === edit.end.paragraph && edit.start.offset > edit.end.offset) throw new Error('Word 文字范围不存在。')
  if (edit.start.offset > textOf(first, NS.word).length || edit.end.offset > textOf(last, NS.word).length) throw new Error('Word 文字位置已失效。')
  const selected = paragraphs.slice(edit.start.paragraph, edit.end.paragraph + 1)
  for (const paragraph of selected) if (editNotice(paragraph)) throw new Error(editNotice(paragraph))
  if (first === last && edit.paragraphs.length === 1) {
    replaceInlineRange(first, edit.start.offset, edit.end.offset, edit.paragraphs[0].runs)
    if (edit.paragraphs[0].style) applyParagraphStyle(first, edit.paragraphs[0].style)
    return
  }
  const parent = first.parentNode as Element
  if (splitsCharacter(textOf(first, NS.word), edit.start.offset) || splitsCharacter(textOf(last, NS.word), edit.end.offset)) throw new Error('段落边界不能拆开一个 Unicode 字符。')
  if (!selected.every(paragraph => paragraph.parentNode === parent && structureEditable(paragraph))) throw new Error('此范围跨越表格边界或含受保护对象；可修改段内文字，不能直接拆分或合并其结构。')
  const siblings = Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1)
  if (siblings.indexOf(last) - siblings.indexOf(first) !== selected.length - 1) throw new Error('段落之间含原件对象，不能跨对象合并正文。')
  const template = insertionRun(first, edit.start.offset)?.cloneNode(true) as Element | undefined
  const after = last.nextSibling, tail = splitParagraph(last, edit.end.offset)
  splitParagraph(first, edit.start.offset)
  for (const paragraph of selected.slice(1)) parent.removeChild(paragraph)
  for (const run of styledRuns(first, edit.paragraphs[0].runs, template)) first.appendChild(run)
  if (edit.paragraphs[0].style) applyParagraphStyle(first, edit.paragraphs[0].style)
  if (edit.paragraphs.length === 1) {
    for (const run of children(tail, NS.word, 'r')) first.appendChild(run)
    return
  }
  for (let index = 1; index < edit.paragraphs.length; index++) {
    const fragment = edit.paragraphs[index], paragraph = index === edit.paragraphs.length - 1 ? tail : first.cloneNode(false) as Element
    if (paragraph !== tail) { const properties = children(first, NS.word, 'pPr')[0]; if (properties) paragraph.appendChild(properties.cloneNode(true)) }
    const before = children(paragraph, NS.word, 'r')[0] ?? null
    for (const run of styledRuns(paragraph, fragment.runs, template)) paragraph.insertBefore(run, before)
    if (fragment.style) applyParagraphStyle(paragraph, fragment.style)
    parent.insertBefore(paragraph, after)
  }
}
function formatRange(paragraph: Element, from: number, to: number, style: DocxTextStyle) {
  if (from < 0 || to <= from || to > textOf(paragraph, NS.word).length) throw new Error('Word 文字格式范围不存在。')
  if (splitsCharacter(textOf(paragraph, NS.word), from) || splitsCharacter(textOf(paragraph, NS.word), to)) throw new Error('文字格式范围必须落在完整字符的边界。')
  if (editNotice(paragraph)) throw new Error(editNotice(paragraph))
  splitRunsAt(paragraph, to); splitRunsAt(paragraph, from)
  let at = 0
  for (const run of descendants(paragraph, NS.word, 'r')) {
    const length = textOf(run, NS.word).length
    if (length > 0 && at >= from && at + length <= to) applyRunStyle(run, style)
    at += length
  }
}

function inspectBody(body: Element, paragraphs: Element[], tables: Element[]): DocxBodyBlock[] {
  const indexes = (node: Element) => descendants(node, NS.word, 'p').map(paragraph => paragraphs.indexOf(paragraph))
  return Array.from(body.childNodes).flatMap((node): DocxBodyBlock[] => {
    if (node.nodeType !== 1) return []
    const element = node as Element
    if (element.namespaceURI === NS.word && element.localName === 'sectPr') return []
    if (element.namespaceURI === NS.word && element.localName === 'p' && !descendants(element, NS.word, 'p').length) return [{ type: 'paragraph', index: paragraphs.indexOf(element) }]
    if (element.namespaceURI === NS.word && element.localName === 'tbl') {
      const rows = children(element, NS.word, 'tr').map(row => children(row, NS.word, 'tc').map(indexes))
      const simple = rows.length > 0 && rows[0].length > 0 && rows.every(row => row.length === rows[0].length) &&
        !descendants(element, NS.word, 'tbl').length && !descendants(element, NS.word, 'vMerge').length &&
        descendants(element, NS.word, 'gridSpan').every(span => span.getAttributeNS(NS.word, 'val') === '1') &&
        descendants(element, NS.word, 'tc').every(cell => children(cell, NS.word, '*').every(child => ['tcPr', 'p'].includes(child.localName)) &&
          children(cell, NS.word, 'p').length > 0 && children(cell, NS.word, 'p').every(paragraph => !descendants(paragraph, NS.word, 'p').length)) &&
        rows.flat(2).length === indexes(element).length
      return [{ type: 'table', index: tables.indexOf(element), rows, paragraphs: indexes(element), simple }]
    }
    return [{ type: 'container', paragraphs: element.namespaceURI === NS.word && element.localName === 'p' ? [paragraphs.indexOf(element), ...indexes(element)] : indexes(element), notice: '复杂原件结构保留；可在下方修改受支持的文字。' }]
  })
}

export function editDocx(pkg: OfficePackage, request: OfficeRequest<'docx', 'edit'>) {
  const { main, body } = wordBody(pkg)
  for (const edit of request.edits) {
    if (edit.type === 'replaceRange') {
      for (const paragraph of edit.paragraphs) if (paragraph.style?.heading) ensureParagraphStyle(pkg, paragraph.style.heading)
      replaceRange(body, edit)
    } else if (edit.type === 'textStyle') {
      const target = descendants(body, NS.word, 'p')[edit.index]
      if (!target) throw new Error(`Word 段落不存在：${edit.index}`)
      formatRange(target, edit.from, edit.to, edit.style)
    } else if (edit.type === 'paragraph') {
      const target = descendants(body, NS.word, 'p')[edit.index]
      if (!target) throw new Error(`Word 段落不存在：${edit.index}`)
      if (editNotice(target)) throw new Error(editNotice(target))
      replaceParagraph(target, edit.text)
    } else if (edit.type === 'paragraphStyle') {
      const target = descendants(body, NS.word, 'p')[edit.index]
      if (!target) throw new Error(`Word 段落不存在：${edit.index}`)
      if (descendants(target, NS.word, 'p').length && ['bold', 'italic', 'underline'].some(key => edit.style[key as keyof DocxParagraphStyle] !== undefined)) {
        throw new Error('此段包含嵌套文本框；请定位文本框内的段落设置文字格式，避免扩大修改范围。')
      }
      if (edit.style.heading) ensureParagraphStyle(pkg, edit.style.heading)
      applyParagraphStyle(target, edit.style)
    } else if (edit.type === 'insertParagraph') {
      const target = edit.after < 0 ? undefined : descendants(body, NS.word, 'p')[edit.after]
      if (edit.after >= 0 && (!target || target.parentNode !== body)) throw new Error('新增段落目前仅支持正文段落；表格和嵌套内容请使用对应结构操作。')
      const paragraph = wordElement(body.ownerDocument, 'p')
      const previousProperties = target && children(target, NS.word, 'pPr')[0]
      if (previousProperties) {
        const clone = previousProperties.cloneNode(true) as Element
        for (const section of descendants(clone, NS.word, 'sectPr')) section.parentNode?.removeChild(section)
        paragraph.appendChild(clone)
      }
      replace(paragraph, edit.text)
      body.insertBefore(paragraph, target ? target.nextSibling : body.firstChild)
    } else if (edit.type === 'deleteParagraph') {
      const target = descendants(body, NS.word, 'p')[edit.index]
      if (!target || target.parentNode !== body) throw new Error('删除段落目前仅支持正文段落；不能删除表格中必需的段落。')
      if (['drawing', 'pict', 'object', 'sectPr', 'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'footnoteReference', 'endnoteReference', 'fldChar', 'instrText', 'fldSimple', 'ins', 'del', 'moveFrom', 'moveTo'].some(name => descendants(target, NS.word, name).length)) {
        throw new Error('此段含对象、范围标记或分节结构，不能用简单段落删除破坏关联；请先通过专业结构操作处理。')
      }
      body.removeChild(target)
      if (!children(body, NS.word, 'p').length) body.insertBefore(wordElement(body.ownerDocument, 'p'), children(body, NS.word, 'sectPr')[0] ?? null)
    } else if (edit.type === 'tableCell') {
      const table = descendants(body, NS.word, 'tbl')[edit.table]
      const row = table && children(table, NS.word, 'tr')[edit.row]
      const cell = row && children(row, NS.word, 'tc')[edit.column]
      if (!cell) throw new Error(`Word 表格单元格不存在：${edit.table}/${edit.row}/${edit.column}`)
      const paragraphs = descendants(cell, NS.word, 'p')
      if (paragraphs.length !== 1) throw new Error('该单元格含多个段落；请按 inspect 返回的段落位置局部修改')
      replaceParagraph(paragraphs[0], edit.text)
    } else {
      const matches = descendants(body, NS.word, 'p').flatMap(paragraph => {
        const text = textOf(paragraph, NS.word)
        const result: Array<{ paragraph: Element; index: number }> = []
        for (let index = text.indexOf(edit.oldText); index >= 0; index = text.indexOf(edit.oldText, index + edit.oldText.length)) result.push({ paragraph, index })
        return result
      })
      if (matches.length !== 1) throw new Error(`Word 替换目标须唯一，当前匹配 ${matches.length} 处；请使用段落位置`)
      replace(matches[0].paragraph, edit.text, matches[0].index, edit.oldText.length)
    }
  }
  pkg.write(main)
}

export function inspectDocx(pkg: OfficePackage): Extract<OfficeContentInspection, { format: 'docx' }> {
  const { body } = wordBody(pkg)
  const paragraphs = descendants(body, NS.word, 'p'), tables = descendants(body, NS.word, 'tbl')
  return {
    format: 'docx',
    paragraphs: paragraphs.map((paragraph, index) => {
      const notice = editNotice(paragraph)
      return { index, text: textOf(paragraph, NS.word), style: paragraphStyle(paragraph), editable: !notice, structureEditable: structureEditable(paragraph),
        runs: descendants(paragraph, NS.word, 'r').map(run => ({ text: textOf(run, NS.word), style: runStyle(run) })), ...(notice ? { notice } : {}) }
    }),
    tables: tables.map(table => children(table, NS.word, 'tr').map(row => children(row, NS.word, 'tc').map(cell => textOf(cell, NS.word)))),
    body: inspectBody(body, paragraphs, tables),
  }
}
