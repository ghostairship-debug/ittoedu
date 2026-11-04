import path from 'node:path'
import { officeContentSchemas } from '../../../core/tools/OfficeContentTools'
import type { OfficeCardTarget } from '../../../shared/workbench/fileContext'
import type { ModelToolCall } from '../../../shared/workbench/tools'

function coordinates(cell: string) {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/i.exec(cell)
  if (!match) return undefined
  let column = 0
  for (const letter of match[1]!.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
  return { column, row: Number(match[2]) }
}

function inRange(cell: string, range: string): boolean {
  const [first, last = first] = range.split(':')
  const start = coordinates(first ?? ''), end = coordinates(last ?? ''), target = coordinates(cell)
  return Boolean(start && end && target
    && target.column >= Math.min(start.column, end.column) && target.column <= Math.max(start.column, end.column)
    && target.row >= Math.min(start.row, end.row) && target.row <= Math.max(start.row, end.row))
}

export function validateOfficeCardPath(target: OfficeCardTarget, filename: string) {
  const expected = path.resolve(target.path), actual = path.resolve(filename)
  if (process.platform === 'win32' ? expected.toLowerCase() !== actual.toLowerCase() : expected !== actual)
    throw new Error('此编辑卡仅能操作打开时选中的文件。')
}

export function bindOfficeCardEdit(target: OfficeCardTarget, call: ModelToolCall): ModelToolCall {
  if (call.name === 'office.deepEdit') {
    const { content } = officeContentSchemas[call.name].parse(call.input)
    if ('packagePart' in content) throw new Error('此选区需要使用明确的对象目标，不能直接改整个原生部件。')
    const selection = target.selection
    const native = content.format === 'pptx' ? content.edit : 'native' in content ? content.native : undefined
    if (native?.insert && !native.path.length) throw new Error('该操作会在选区外插入同级对象。')
    if (selection?.format === 'pptx' && content.format === 'pptx' && !selection.text
      && content.target.part === selection.part
      && selection.shapeIds.includes(content.target.shapeId)) return call
    if (selection?.format === 'xlsx' && content.format === 'xlsx'
      && content.target.sheet === selection.sheet && inRange(content.target.cell, selection.range)) return call
    if (selection?.format === 'docx' && content.format === 'docx'
      && (content.target.kind === 'paragraph' || content.target.kind === 'run')
      && selection.wholeParagraphs?.includes(content.target.paragraph)) return call
    throw new Error('此底层修改无法限定在所选范围，请调整目标。')
  }
  const input = officeContentSchemas['office.edit'].parse(call.input)
  const { content } = input
  const { selection } = target
  if (!selection) throw new Error('当前引用没有可精确限定的选区。')
  let matches = false
  if (selection.format === 'docx' && content.format === 'docx') {
    const at = (a: typeof selection.start, b: typeof selection.start) => a.paragraph - b.paragraph || a.offset - b.offset
    matches = content.edits.every(edit => {
      if (edit.type === 'replaceRange') return content.edits.length === 1 && at(edit.start, edit.end) <= 0
        && at(edit.start, selection.start) >= 0 && at(edit.end, selection.end) <= 0
      return edit.type === 'textStyle' && at({ paragraph: edit.index, offset: edit.from }, selection.start) >= 0
        && at({ paragraph: edit.index, offset: edit.to }, selection.end) <= 0
    })
  } else if (selection.format === 'xlsx' && content.format === 'xlsx') {
    matches = content.edits.every(edit => 'cell' in edit && edit.sheet === selection.sheet && inRange(edit.cell, selection.range))
  } else if (selection.format === 'pptx' && content.format === 'pptx') {
    matches = content.edits.every(edit => {
      if (edit.part !== selection.part || !('shapeId' in edit)
        || !edit.shapeId || !selection.shapeIds.includes(edit.shapeId)) return false
      if (!selection.text) return true
      if (edit.type !== 'runText' && edit.type !== 'textStyle') return false
      const run = selection.text.find(value => value.paragraph === edit.paragraph && value.run === edit.run)
      if (!run) return false
      if (edit.type === 'textStyle') return !run.prefix && !run.suffix
      return edit.text.length >= run.prefix.length + run.suffix.length
        && edit.text.startsWith(run.prefix) && edit.text.endsWith(run.suffix)
    })
  }
  if (!matches) throw new Error('修改超出此卡片的选区，请缩小修改范围。')
  return call
}

export function officeCardProposal(target: OfficeCardTarget, call: ModelToolCall): string {
  const { content, onlySelection } = officeContentSchemas['office.edit'].parse(call.input)
  if (content.format === 'docx') return content.edits.map(edit => {
    if (edit.type !== 'replaceRange') return JSON.stringify(edit, null, 2)
    const replacement = edit.paragraphs.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n')
    const location = edit.start.paragraph === edit.end.paragraph ? `第 ${edit.start.paragraph + 1} 段` : `第 ${edit.start.paragraph + 1}–${edit.end.paragraph + 1} 段`
    return `${location}指定范围改为\n${replacement || '（删除文字）'}`
  }).join('\n\n')
  if (content.format === 'xlsx') return content.edits.map(edit => {
    if (!('cell' in edit)) return JSON.stringify(edit, null, 2)
    const value = typeof edit.value === 'object' ? edit.value?.formula ?? '（清空）' : String(edit.value)
    return `${edit.sheet}!${edit.cell} → ${value}`
  }).join('\n')
  const selection = (target.restrictToSelection || onlySelection) && target.selection?.format === 'pptx' ? target.selection : undefined
  return content.edits.map(edit => {
    if (edit.type !== 'runText' && edit.type !== 'text') return JSON.stringify(edit, null, 2)
    const span = edit.type === 'runText' && selection?.page === edit.slide && selection.shapeIds.includes(edit.shapeId)
      ? selection.text?.find(value => value.paragraph === edit.paragraph && value.run === edit.run) : undefined
    const replacement = span ? edit.text.slice(span.prefix.length, edit.text.length - span.suffix.length) : edit.text
    return `第 ${edit.slide + 1} 页 · 对象 ${edit.shapeId ?? edit.shape} 的文字改为\n${replacement || '（删除所选文字）'}`
  }).join('\n\n')
}
