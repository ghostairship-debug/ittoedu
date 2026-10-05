import { describe, expect, it } from 'vitest'
import PptxGenJS from 'pptxgenjs'
import { strFromU8, unzipSync } from 'fflate'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { drawProfessional } from '../../src/renderer/export/componentPlatform/pptx/drawings'
import { officeFrame } from '../../src/renderer/export/componentPlatform/pptx/frame'

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
function xml(bytes: Uint8Array) {
  const dom = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  expect(dom.getElementsByTagName('parsererror')).toHaveLength(0)
  return dom
}

describe('formal rich table Office consumers', () => {
  it('writes actual rich Word cells and OMML plus editable PPTX headers, merged cells and caption', async () => {
    let id = 0
    const table = createTableData({ rows: 3, columns: 2, idFactory: () => String(++id) })
    table.columns[0]!.header = { inlines: [{ type: 'text', text: '表头甲', style: { bold: true, color: '#123456' } }] }
    table.columns[1]!.header = { inlines: [{ type: 'math', formulaId: 'header-math', latex: 'y^2', accessibleText: 'y平方' }] }
    const first = table.rows[0]!.cells[0]!
    const { text: _text, ...cell } = first
    table.rows[0]!.cells[0] = { ...cell, style: { fillColor: '#fde68a', fontSize: 20 }, content: { inlines: [
      { type: 'text', text: '粗体😀', style: { bold: true, fontSize: 24, color: '#ff0000' } },
      { type: 'text', text: '\n链接', style: { italic: true, underline: true }, link: { href: 'https://example.org/lesson' } },
      { type: 'math', formulaId: 'body-math', latex: '\\frac{x}{2}', accessibleText: 'x除以二' },
    ] } }
    table.rows[2]!.cells[0]!.text = '正文尾甲'
    table.rows[2]!.cells[1]!.text = '正文尾乙'
    table.merges = [{ rowIds: table.rows.slice(0, 2).map(row => row.id), columnIds: table.columns.map(column => column.id) }]
    table.caption = { inlines: [{ type: 'text', text: '题注', style: { italic: true } },
      { type: 'math', formulaId: 'caption-math', latex: 'z^3', accessibleText: 'z立方' }] }
    parseTableData(table)
    const document = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'rich-table', revision: 0, title: '富表格输出',
      definitions: { 'guoling.table': { id: 'guoling.table', role: 'content', implementation: { kind: 'builtin', key: 'guoling.table' } } },
      instances: { table: { id: 'table', definitionId: 'guoling.table', data: table, frame: { width: 640, height: 240, transform: [1, 0, 0, 1, 20, 30] } } },
      surfaces: [{ id: 'page', kind: 'flow', title: '富表格页', childIds: ['table'] }], global: { underlay: [], overlay: [] }, assets: {} })
    const before = structuredClone(document)
    const word = await buildComponentDocx(document, { surfaceId: 'page' })
    const wordFiles = unzipSync(word.bytes), body = xml(wordFiles['word/document.xml']!)
    const wordTable = body.getElementsByTagNameNS(w, 'tbl')[0]!
    const rows = Array.from(wordTable.getElementsByTagNameNS(w, 'tr'))
    expect(rows).toHaveLength(4)
    expect(rows[0]!.getElementsByTagNameNS(w, 'tblHeader')).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('表头甲')
    expect(rows[0]!.getElementsByTagNameNS(m, 'oMath')).toHaveLength(1)
    expect(rows[1]!.textContent).toContain('粗体😀')
    expect(rows[1]!.getElementsByTagNameNS(w, 'tc')).toHaveLength(1)
    expect(rows[1]!.getElementsByTagNameNS(w, 'gridSpan')[0]!.getAttributeNS(w, 'val')).toBe('2')
    expect(rows[1]!.getElementsByTagNameNS(w, 'vMerge')[0]!.getAttributeNS(w, 'val')).toBe('restart')
    expect(rows[2]!.getElementsByTagNameNS(w, 'vMerge')[0]!.getAttributeNS(w, 'val')).toBe('continue')
    expect(rows[2]!.getElementsByTagNameNS(w, 't')).toHaveLength(0)
    expect(rows[3]!.textContent).toContain('正文尾乙')
    const bold = Array.from(rows[1]!.getElementsByTagNameNS(w, 'r')).find(run => run.textContent === '粗体😀')!
    expect(bold.getElementsByTagNameNS(w, 'b')).toHaveLength(1)
    expect(bold.getElementsByTagNameNS(w, 'color')[0]!.getAttributeNS(w, 'val')).toBe('FF0000')
    expect(bold.getElementsByTagNameNS(w, 'sz')[0]!.getAttributeNS(w, 'val')).toBe('36')
    expect(rows[1]!.getElementsByTagNameNS(m, 'f')).toHaveLength(1)
    expect(rows[1]!.getElementsByTagNameNS(w, 'br')).toHaveLength(1)
    expect(rows[1]!.getElementsByTagNameNS(w, 'fldSimple')[0]!.getAttributeNS(w, 'instr')).toContain('https://example.org/lesson')
    const caption = Array.from(body.getElementsByTagNameNS(w, 'p')).find(p => p.textContent?.startsWith('题注'))!
    expect(caption.getElementsByTagNameNS(m, 'oMath')).toHaveLength(1)
    expect(body.documentElement.textContent).not.toContain('__guoling_word_output__')
    expect(Array.from(body.getElementsByTagNameNS(w, 't')).filter(t => t.textContent === '粗体😀')).toHaveLength(1)
    expect(word.fidelity).toBe('complete')

    const pptx = new PptxGenJS(), slide = pptx.addSlide(), instance = document.instances.table!
    const warnings = drawProfessional(slide, 'guoling.table', instance, officeFrame(instance.frame!, instance.frame!.transform), new Map())!
    const powerpoint = new Uint8Array(await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer)
    const pptFiles = unzipSync(powerpoint), presentation = xml(pptFiles['ppt/slides/slide1.xml']!)
    const pptTable = presentation.getElementsByTagNameNS(a, 'tbl')[0]!
    expect(pptTable.getElementsByTagNameNS(a, 'tr')).toHaveLength(4)
    expect(pptTable.textContent).toContain('表头甲')
    expect(pptTable.textContent).toContain('粗体😀')
    expect(pptTable.textContent).toContain('x除以二')
    expect(pptTable.textContent).toContain('正文尾乙')
    expect(presentation.documentElement.textContent).toContain('题注z立方')
    const rich = Array.from(pptTable.getElementsByTagNameNS(a, 'r')).find(run => run.textContent === '粗体😀')!
    expect(rich.getElementsByTagNameNS(a, 'rPr')[0]!.getAttribute('b')).toBe('1')
    expect(rich.getElementsByTagNameNS(a, 'srgbClr')[0]!.getAttribute('val')).toBe('FF0000')
    expect(Array.from(pptTable.getElementsByTagNameNS(a, 'tc')).some(tc => tc.getAttribute('gridSpan') === '2')).toBe(true)
    expect(warnings.some(message => message.includes('公式') && message.includes('替代说明文字'))).toBe(true)
    expect(document).toEqual(before)
  })
})
