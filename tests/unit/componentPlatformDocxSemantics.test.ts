import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createTableData } from '../../src/components/table/data'
import { courseProjectV10Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const parse = (bytes: Uint8Array) => {
  const xml = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  expect(xml.getElementsByTagName('parsererror')).toHaveLength(0)
  return xml
}

it('exports CSS pixel sizes consistently for rich text, table cells and editable math, with Word heading outlines', async () => {
  let id = 0
  const table = createTableData({ rows: 1, columns: 1, idFactory: () => String(++id) })
  table.rows[0]!.cells[0]!.style = { fontSize: 20 }
  const { text: _text, ...cell } = table.rows[0]!.cells[0]!
  table.rows[0]!.cells[0] = { ...cell, content: { inlines: [
    { type: 'text', text: '表格字号', style: { fontSize: 24, bold: true } },
    { type: 'math', formulaId: 'table-math', latex: 'x^2', accessibleText: 'x平方', style: { fontSize: 24 } },
  ] } }
  const headings = Array.from({ length: 6 }, (_, index) => ({ id: `heading${index + 1}`, definitionId: 'guoling.document-block',
    data: { type: 'heading', level: index + 1, content: { inlines: [{ type: 'text', text: `标题${index + 1}`, style: { fontSize: 32 } }] } } }))
  const document = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'docx-semantics', revision: 0, title: 'DOCX语义',
    definitions: Object.fromEntries(['text', 'formula', 'table', 'document-block'].map(key => [`guoling.${key}`, { id: `guoling.${key}`, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: Object.fromEntries([
      ...headings,
      { id: 'text', definitionId: 'guoling.text', data: { appearance: { fontSize: 24 }, content: { inlines: [
        { type: 'text', text: '正文默认' },
        { type: 'text', text: '正文显式', style: { fontSize: 32, baseline: 0.25, italic: true } },
        { type: 'math', formulaId: 'inline-math', latex: 'y^2', accessibleText: 'y平方', style: { fontSize: 32 } },
      ] } } },
      { id: 'formula', definitionId: 'guoling.formula', data: { appearance: { fontSize: 16 }, formula: { type: 'math', formulaId: 'formula', latex: '\\frac{x}{2}', accessibleText: 'x除以二', style: { fontSize: 40, color: '#123456' } } } },
      { id: 'table', definitionId: 'guoling.table', data: table },
    ].map(instance => [instance.id, instance])),
    surfaces: [{ id: 'flow', kind: 'flow', title: '可编辑Word', childIds: [...headings.map(h => h.id), 'text', 'formula', 'table'] }],
    global: { underlay: [], overlay: [] }, assets: {} })
  const before = structuredClone(document)
  const result = await buildComponentDocx(document, { surfaceId: 'flow' })
  const files = unzipSync(result.bytes), body = parse(files['word/document.xml']!), styles = parse(files['word/styles.xml']!)
  const run = (text: string) => Array.from(body.getElementsByTagNameNS(w, 'r')).find(node => node.textContent === text)!
  const fontSize = (node: Element) => node.getElementsByTagNameNS(w, 'sz')[0]!.getAttributeNS(w, 'val')
  expect(fontSize(run('正文默认'))).toBe('36') // 24px = 18pt = 36 half-points.
  expect(fontSize(run('正文显式'))).toBe('48')
  expect(run('正文显式').getElementsByTagNameNS(w, 'position')[0]!.getAttributeNS(w, 'val')).toBe('12')
  expect(fontSize(run('表格字号'))).toBe('36')
  const formulaRuns = Array.from(body.getElementsByTagNameNS(m, 'r'))
  expect(formulaRuns.some(node => node.getElementsByTagNameNS(w, 'sz')[0]?.getAttributeNS(w, 'val') === '48')).toBe(true)
  expect(formulaRuns.some(node => node.getElementsByTagNameNS(w, 'sz')[0]?.getAttributeNS(w, 'val') === '36')).toBe(true)
  expect(body.getElementsByTagNameNS(w, 'tbl')).toHaveLength(1)
  expect(body.getElementsByTagNameNS(m, 'f')).toHaveLength(1)
  const fraction = body.getElementsByTagNameNS(m, 'f')[0]!
  expect(fraction.getElementsByTagNameNS(w, 'sz')[0]!.getAttributeNS(w, 'val')).toBe('60')
  expect(fraction.getElementsByTagNameNS(w, 'color')[0]!.getAttributeNS(w, 'val')).toBe('123456')
  for (let level = 1; level <= 6; level++) {
    const paragraph = Array.from(body.getElementsByTagNameNS(w, 'p')).find(node => node.textContent === `标题${level}`)!
    expect(paragraph.getElementsByTagNameNS(w, 'pStyle')[0]!.getAttributeNS(w, 'val')).toBe(`Heading${level}`)
    const style = Array.from(styles.getElementsByTagNameNS(w, 'style')).find(node => node.getAttributeNS(w, 'styleId') === `Heading${level}`)!
    expect(style.getElementsByTagNameNS(w, 'outlineLvl')[0]?.getAttributeNS(w, 'val')).toBe(String(level - 1))
  }
  expect(result.fidelity).toBe('complete')
  expect(document).toEqual(before)
})
