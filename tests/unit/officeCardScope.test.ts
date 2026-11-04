import { describe, expect, it } from 'vitest'
import { bindOfficeCardEdit, validateOfficeCardPath } from '../../src/main/workbench/execution/officeCardScope'
import type { OfficeCardTarget } from '../../src/shared/workbench/fileContext'

const bind = (selection: NonNullable<OfficeCardTarget['selection']>) => ({
  path: 'workspace/selection.' + selection.format,
  bindingVersion: 1,
  fileVersion: 'office-draft:original',
  selection,
})

describe('Office AI card write scope', () => {
  it('allows native insertion inside the selected shape and rejects an insertion beside it', () => {
    const target = bind({ format: 'pptx', page: 0, part: 'ppt/slides/slide1.xml', shapeIds: ['1'] })
    const insert = (steps: { name: string; index: number }[]) => ({ name: 'office.deepEdit', input: { path: target.path, content: {
      format: 'pptx', target: { slide: 0, part: 'ppt/slides/slide1.xml', partVersion: 'a'.repeat(64), shapeId: '1' },
      edit: { path: steps, insert: 'after', xml: '<a:r><a:t>text</a:t></a:r>' },
    } } })
    expect(() => bindOfficeCardEdit(target, insert([{ name: 'p:txBody', index: 0 }]))).not.toThrow()
    expect(() => bindOfficeCardEdit(target, insert([]))).toThrow('选区外')
  })

  it('accepts a confined Word edit and rejects neighboring text', () => {
    const target = bind({ format: 'docx', start: { paragraph: 2, offset: 3 }, end: { paragraph: 2, offset: 8 } })
    const edit = (offset: number) => ({ name: 'office.edit', input: { path: target.path, content: { format: 'docx', edits: [{
      type: 'replaceRange', start: { paragraph: 2, offset }, end: { paragraph: 2, offset: 8 },
      paragraphs: [{ runs: [{ text: 'replacement' }] }],
    }] } } })
    expect(() => bindOfficeCardEdit(target, edit(3))).not.toThrow()
    expect(() => bindOfficeCardEdit(target, edit(2))).toThrow('选区')
    expect(() => validateOfficeCardPath(target, 'workspace/another.docx')).toThrow('文件')
  })

  it('confines Excel edits to selected cells on the selected sheet', () => {
    const target = bind({ format: 'xlsx', sheet: 'Data', range: 'AA2:AB3' })
    const edit = (sheet: string, cell: string) => ({ name: 'office.edit', input: {
      path: target.path, content: { format: 'xlsx', edits: [{ sheet, cell, value: 7 }] },
    } })
    expect(() => bindOfficeCardEdit(target, edit('Data', 'AB3'))).not.toThrow()
    expect(() => bindOfficeCardEdit(target, edit('Data', 'AC3'))).toThrow('选区')
    expect(() => bindOfficeCardEdit(target, edit('Other', 'AB3'))).toThrow('选区')
  })

  it('preserves PowerPoint text outside the captured substring', () => {
    const target = bind({ format: 'pptx', page: 1, part: 'ppt/slides/slide2.xml', shapeIds: ['5'],
      text: [{ paragraph: 0, run: 1, from: 7, to: 10, prefix: 'before ', suffix: ' after' }] })
    const edit = (text: string, shapeId = '5') => ({ name: 'office.edit', input: { path: target.path,
      content: { format: 'pptx', edits: [{ type: 'runText', slide: 1, part: 'ppt/slides/slide2.xml', partVersion: 'a'.repeat(64),
        shapeId, paragraph: 0, run: 1, text }] } } })
    expect(() => bindOfficeCardEdit(target, edit('before new after'))).not.toThrow()
    expect(() => bindOfficeCardEdit(target, edit('before new'))).toThrow('选区')
    expect(() => bindOfficeCardEdit(target, edit('before new after', '6'))).toThrow('选区')
  })

  it('can replace text spanning multiple PowerPoint runs without writing a neighboring run', () => {
    const target = bind({ format: 'pptx', page: 0, part: 'ppt/slides/slide1.xml', shapeIds: ['1'], text: [
      { paragraph: 0, run: 0, from: 2, to: 5, prefix: 'A ', suffix: '' },
      { paragraph: 0, run: 1, from: 0, to: 3, prefix: '', suffix: ' Z' },
    ] })
    const edit = (secondRun: number) => ({ name: 'office.edit', input: { path: target.path, content: { format: 'pptx', edits: [
      { type: 'runText', slide: 0, part: 'ppt/slides/slide1.xml', partVersion: 'a'.repeat(64), shapeId: '1', paragraph: 0, run: 0, text: 'A new' },
      { type: 'runText', slide: 0, part: 'ppt/slides/slide1.xml', partVersion: 'a'.repeat(64), shapeId: '1', paragraph: 0, run: secondRun, text: ' Z' },
    ] } } })
    expect(() => bindOfficeCardEdit(target, edit(1))).not.toThrow()
    expect(() => bindOfficeCardEdit(target, edit(2))).toThrow('选区')
  })
})
