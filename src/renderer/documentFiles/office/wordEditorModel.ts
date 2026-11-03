import { Fragment, Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import type { EditorState, Transaction } from 'prosemirror-state'
import { tableNodes } from 'prosemirror-tables'
import type { DocxParagraphStyle, DocxTextStyle, OfficeContentInspection, OfficeEditContent } from '../../../shared/workbench/officeFiles'

export type WordInspection = Extract<OfficeContentInspection, { format: 'docx' }>
export type WordEdit = Extract<OfficeEditContent, { format: 'docx' }>['edits'][number]
const flags = ['bold', 'italic', 'underline'] as const
const paragraphAttrs = { index: { default: 0 }, style: { default: {} }, editable: { default: true }, structureEditable: { default: true }, notice: { default: null } }
const readParagraphStyle = (element: HTMLElement) => ({ style: {
  ...(/^H[1-3]$/.test(element.tagName) ? { heading: `Heading${element.tagName.slice(1)}` } : {}),
  ...(['left', 'center', 'right', 'justify'].includes(element.style.textAlign) ? { alignment: element.style.textAlign === 'justify' ? 'both' : element.style.textAlign } : {}),
} })

/** A projection of an existing DOCX. It is never serialized as a new Office package. */
export const wordEditorSchema = new Schema({
  nodes: {
    doc: { content: 'block*' }, text: { group: 'inline' },
    paragraph: { group: 'block', content: 'text*', attrs: paragraphAttrs,
      parseDOM: ['p', 'div', 'h1', 'h2', 'h3'].map(tag => ({ tag, getAttrs: element => readParagraphStyle(element as HTMLElement) })),
      toDOM(node) {
        const style = node.attrs.style as DocxParagraphStyle, heading = style.heading
        const tag = heading === 'Title' || heading === 'Heading1' ? 'h1' : heading === 'Heading2' ? 'h2' : heading === 'Heading3' ? 'h3' : 'p'
        return [tag, { class: 'office-word-paragraph', role: 'textbox', 'aria-label': `第 ${node.attrs.index + 1} 段`, 'aria-multiline': 'true',
          'aria-readonly': node.attrs.editable === false ? 'true' : 'false', 'data-paragraph-index': node.attrs.index,
          ...(node.attrs.editable === false ? { contenteditable: 'false', title: node.attrs.notice ?? '原件结构保留' } : {}),
          style: `text-align:${style.alignment === 'both' ? 'justify' : style.alignment ?? 'left'}` }, 0]
      },
    },
    ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph+', cellAttributes: {} }),
    container: { group: 'block', content: 'paragraph*', isolating: true, attrs: { notice: { default: '' } },
      toDOM: node => ['section', { class: 'office-word-preserved' }, ['small', { contenteditable: 'false' }, node.attrs.notice], ['div', 0]] },
  },
  marks: {
    bold: { parseDOM: [{ tag: 'strong' }, { tag: 'b', getAttrs: element => (element as HTMLElement).style.fontWeight !== 'normal' && null }, { style: 'font-weight', getAttrs: value => /^(bold(er)?|[5-9]\d{2})$/.test(value as string) && null }], toDOM: () => ['strong', 0] },
    italic: { parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: value => (value as string).includes('underline') && null }], toDOM: () => ['u', 0] },
  },
})

export function toWordEditorDocument(inspection: WordInspection): ProseMirrorNode {
  const paragraph = (index: number) => {
    const value = inspection.paragraphs.find(item => item.index === index)
    if (!value) throw new Error(`Word 段落投影不存在：${index}`)
    const runs = value.runs ?? [{ text: value.text, style: value.style ?? {} }]
    return wordEditorSchema.nodes.paragraph.create({ index, style: { heading: value.style?.heading, alignment: value.style?.alignment },
      editable: value.editable !== false, structureEditable: value.structureEditable === true, notice: value.notice ?? null },
    runs.filter(run => run.text.length).map(run => wordEditorSchema.text(run.text, flags.filter(flag => run.style[flag]).map(flag => wordEditorSchema.marks[flag].create()))))
  }
  const blocks = (inspection.body ?? inspection.paragraphs.map(item => ({ type: 'paragraph' as const, index: item.index }))).map(block => {
    if (block.type === 'paragraph') return paragraph(block.index)
    if (block.type === 'table' && block.simple) return wordEditorSchema.nodes.table.create(null, block.rows.map(row =>
      wordEditorSchema.nodes.table_row.create(null, row.map(cell => wordEditorSchema.nodes.table_cell.create(null, cell.map(paragraph))))))
    return wordEditorSchema.nodes.container.create({ notice: block.type === 'table' ? '复杂表格保留在原件中；下方显示可编辑文字。' : block.notice }, block.paragraphs.map(paragraph))
  })
  return wordEditorSchema.nodes.doc.create(null, blocks)
}

export function wordParagraphs(doc: ProseMirrorNode) {
  const result: Array<{ node: ProseMirrorNode; index: number; pos: number; from: number; to: number; parent: string }> = []
  doc.descendants((node, pos) => {
    if (node.type !== wordEditorSchema.nodes.paragraph) return true
    const point = doc.resolve(pos)
    result.push({ node, index: result.length, pos, from: pos + 1, to: pos + node.nodeSize - 1,
      parent: Array.from({ length: point.depth }, (_, depth) => point.index(depth)).join('/') })
    return false
  })
  return result
}
export function wordSelectedParagraphs(state: EditorState) {
  const paragraphs = wordParagraphs(state.doc)
  return paragraphs.filter(paragraph => state.selection.ranges.some(range => range.$from.pos <= paragraph.to && range.$to.pos >= paragraph.from))
}
export function wordFormatting(state: EditorState): DocxTextStyle {
  const samples: ProseMirrorNode[] = []
  if (!state.selection.empty) for (const range of state.selection.ranges) state.doc.nodesBetween(range.$from.pos, range.$to.pos, node => { if (node.isText) samples.push(node) })
  const marks = state.storedMarks ?? state.selection.$from.marks()
  return Object.fromEntries(flags.map(flag => [flag, samples.length ? samples.every(node => node.marks.some(mark => mark.type.name === flag)) : marks.some(mark => mark.type.name === flag)])) as DocxTextStyle
}
function inlineRuns(node: ProseMirrorNode | Fragment) {
  const runs: Array<{ text: string; style: DocxTextStyle }> = []
  node.forEach(child => {
    if (!child.isText) throw new Error('此次粘贴包含未支持的对象；请只粘贴正文、段落或文字格式。')
    if (/[\r\n\t]/.test(child.text ?? '')) throw new Error('制表结构尚未应用；请粘贴分段文字或在表格单元格内编辑。')
    runs.push({ text: child.text ?? '', style: Object.fromEntries(flags.map(flag => [flag, child.marks.some(mark => mark.type.name === flag)])) })
  })
  return runs
}
function replacementParagraphs(content: Fragment): Extract<WordEdit, { type: 'replaceRange' }>['paragraphs'] {
  if (!content.size || content.firstChild?.isInline) return [{ runs: inlineRuns(content) }]
  const result: Extract<WordEdit, { type: 'replaceRange' }>['paragraphs'] = []
  content.forEach(node => {
    if (node.type !== wordEditorSchema.nodes.paragraph) throw new Error('此次操作会改变原件表格或复杂对象的结构，尚未应用。')
    result.push({ runs: inlineRuns(node), style: node.attrs.style })
  })
  return result
}
function skeleton(node: ProseMirrorNode): unknown {
  if (node.type === wordEditorSchema.nodes.paragraph) return null
  const children: unknown[] = []; node.forEach(child => { if (child.type !== wordEditorSchema.nodes.paragraph) children.push(skeleton(child)) })
  return [node.type.name, node.attrs, children]
}

/** Translate each PM step against its own before-document, keeping sequential OOXML indices exact. */
export function wordTransactionEdits(transaction: Transaction): WordEdit[] {
  const edits: WordEdit[] = []
  transaction.steps.forEach((step, stepIndex) => {
    const before = transaction.docs[stepIndex], after = transaction.docs[stepIndex + 1] ?? transaction.doc, data = step.toJSON()
    const oldParagraphs = wordParagraphs(before), newParagraphs = wordParagraphs(after)
    if (JSON.stringify(skeleton(before)) !== JSON.stringify(skeleton(after))) throw new Error('原件表格和复杂对象的结构尚未改变；可继续编辑其中的文字。')
    if (data.stepType === 'addMark' || data.stepType === 'removeMark') {
      const flag = data.mark?.type as typeof flags[number]
      if (!flags.includes(flag)) throw new Error('此文字格式尚未支持。')
      for (const paragraph of oldParagraphs) {
        const from = Math.max(data.from, paragraph.from), to = Math.min(data.to, paragraph.to)
        if (to <= from) continue
        if (!paragraph.node.attrs.editable) throw new Error(paragraph.node.attrs.notice ?? '此原件结构暂不可编辑。')
        edits.push({ type: 'textStyle', index: paragraph.index, from: from - paragraph.from, to: to - paragraph.from, style: { [flag]: data.stepType === 'addMark' } })
      }
      return
    }
    if (data.stepType === 'replaceAround' && oldParagraphs.length === newParagraphs.length && oldParagraphs.every((paragraph, index) => paragraph.node.content.eq(newParagraphs[index].node.content))) {
      for (const paragraph of oldParagraphs) {
        const previous = paragraph.node.attrs.style as DocxParagraphStyle, next = newParagraphs[paragraph.index].node.attrs.style as DocxParagraphStyle
        const style: DocxParagraphStyle = {}
        if (previous.heading !== next.heading) style.heading = next.heading ?? 'Normal'
        if (previous.alignment !== next.alignment) style.alignment = next.alignment ?? 'left'
        if (Object.keys(style).length) edits.push({ type: 'paragraphStyle', index: paragraph.index, style })
      }
      return
    }
    if (data.stepType !== 'replace') throw new Error('此次结构操作尚未支持，当前输入仍保留。')
    const paragraphs = replacementParagraphs(Fragment.fromJSON(wordEditorSchema, data.slice?.content ?? []))
    const candidates = (position: number) => oldParagraphs.filter(paragraph => position >= paragraph.pos && position <= paragraph.to + 1)
      .map(paragraph => ({ ...paragraph, offset: Math.max(0, Math.min(paragraph.node.content.size, position - paragraph.from)) }))
    let matched = false
    for (const start of candidates(data.from)) for (const end of candidates(data.to)) {
      if (matched || start.index > end.index || oldParagraphs.length - (end.index - start.index) + paragraphs.length - 1 !== newParagraphs.length) continue
      const texts = paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join(''))
      texts[0] = start.node.textContent.slice(0, start.offset) + texts[0]
      texts[texts.length - 1] += end.node.textContent.slice(end.offset)
      const expected = [...oldParagraphs.slice(0, start.index).map(paragraph => paragraph.node.textContent), ...texts, ...oldParagraphs.slice(end.index + 1).map(paragraph => paragraph.node.textContent)]
      if (!expected.every((text, index) => text === newParagraphs[index].node.textContent)) continue
      const selected = oldParagraphs.slice(start.index, end.index + 1)
      if (selected.some(paragraph => !paragraph.node.attrs.editable)) throw new Error('此范围包含只读的域、修订或复杂文字结构，尚未应用。')
      if ((start.index !== end.index || paragraphs.length > 1) && (start.parent !== end.parent || selected.some(paragraph => !paragraph.node.attrs.structureEditable))) throw new Error('此范围含受保护结构或跨越表格单元格；可修改段内文字，不能直接合并或拆分。')
      edits.push({ type: 'replaceRange', start: { paragraph: start.index, offset: start.offset }, end: { paragraph: end.index, offset: end.offset }, paragraphs })
      matched = true
    }
    if (!matched) throw new Error('此次编辑无法安全映射到原件段落，尚未应用。')
  })
  return edits
}
