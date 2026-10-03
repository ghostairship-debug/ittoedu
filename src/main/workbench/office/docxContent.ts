import { Document as WordDocument, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { children, descendants, NS, OfficePackage, replaceTextRange, textOf } from './officePackage'
import type { OfficeContentInspection, OfficeRequest } from '../../../shared/workbench/officeFiles'

export async function createDocx(request: OfficeRequest<'docx', 'create'>): Promise<Uint8Array> {
  const headings = { title: HeadingLevel.TITLE, heading1: HeadingLevel.HEADING_1, heading2: HeadingLevel.HEADING_2, heading3: HeadingLevel.HEADING_3 }
  const blocks = request.blocks.map(block => block.type === 'paragraph'
    ? new Paragraph({
      heading: block.heading ? headings[block.heading] : undefined,
      children: (block.runs ?? [{ text: block.text ?? '' }]).map(run => new TextRun(run)),
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
  replaceTextRange(container, NS.word, start, length, replacement)
}

export function editDocx(pkg: OfficePackage, request: OfficeRequest<'docx', 'edit'>) {
  const { main, body } = wordBody(pkg)
  for (const edit of request.edits) {
    if (edit.type === 'paragraph') {
      const target = descendants(body, NS.word, 'p')[edit.index]
      if (!target) throw new Error(`Word 段落不存在：${edit.index}`)
      replace(target, edit.text)
    } else if (edit.type === 'tableCell') {
      const table = descendants(body, NS.word, 'tbl')[edit.table]
      const row = table && children(table, NS.word, 'tr')[edit.row]
      const cell = row && children(row, NS.word, 'tc')[edit.column]
      if (!cell) throw new Error(`Word 表格单元格不存在：${edit.table}/${edit.row}/${edit.column}`)
      const paragraphs = descendants(cell, NS.word, 'p')
      if (paragraphs.length !== 1) throw new Error('该单元格含多个段落；请按 inspect 返回的段落位置局部修改')
      replace(paragraphs[0], edit.text)
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
  return {
    format: 'docx',
    paragraphs: descendants(body, NS.word, 'p').map((paragraph, index) => ({ index, text: textOf(paragraph, NS.word) })),
    tables: descendants(body, NS.word, 'tbl').map(table => children(table, NS.word, 'tr').map(row => children(row, NS.word, 'tc').map(cell => textOf(cell, NS.word)))),
  }
}
