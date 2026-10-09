import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createChartData } from '../../src/components/chart/data'
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

it('exports CSS pixel sizes consistently for rich text, table cells and editable math and charts, with Word heading outlines', async () => {
  let id = 0
  const table = createTableData({ rows: 1, columns: 1, idFactory: () => String(++id) })
  table.rows[0]!.cells[0]!.style = { fontSize: 20 }
  const { text: _text, ...cell } = table.rows[0]!.cells[0]!
  table.rows[0]!.cells[0] = { ...cell, content: { inlines: [
    { type: 'text', text: '表格字号', style: { fontSize: 24, bold: true } },
    { type: 'math', formulaId: 'table-math', latex: 'x^2', accessibleText: 'x平方', style: { fontSize: 24 } },
  ] } }
  const chart = createChartData()
  chart.title = '阅读调查'; chart.series[0].name = '人数'
  chart.categories[0].label = '甲班'; chart.categories[1].label = '乙班'
  chart.series[0].points[0].value = 12; chart.series[0].points[1].value = 18
  const headings = Array.from({ length: 6 }, (_, index) => ({ id: `heading${index + 1}`, definitionId: 'guoling.document-block',
    data: { type: 'heading', level: index + 1, content: { inlines: [{ type: 'text', text: `标题${index + 1}`, style: { fontSize: 32 } }] } } }))
  const document = courseProjectV10Schema.parse({ schemaVersion: 10, id: 'docx-semantics', revision: 0, title: 'DOCX语义',
    definitions: Object.fromEntries(['text', 'formula', 'table', 'chart', 'document-block'].map(key => [`guoling.${key}`, { id: `guoling.${key}`, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: Object.fromEntries([
      ...headings,
      { id: 'text', definitionId: 'guoling.text', data: { appearance: { fontSize: 24 }, content: { inlines: [
        { type: 'text', text: '正文默认' },
        { type: 'text', text: '正文显式', style: { fontSize: 32, baseline: 0.25, italic: true } },
        { type: 'math', formulaId: 'inline-math', latex: 'y^2', accessibleText: 'y平方', style: { fontSize: 32 } },
      ] } } },
      { id: 'formula', definitionId: 'guoling.formula', data: { appearance: { fontSize: 16 }, formula: { type: 'math', formulaId: 'formula', latex: '\\frac{x}{2}', accessibleText: 'x除以二', style: { fontSize: 40, color: '#123456' } } } },
      { id: 'table', definitionId: 'guoling.table', data: table },
      { id: 'chart', definitionId: 'guoling.chart', data: chart },
    ].map(instance => [instance.id, instance])),
    surfaces: [{ id: 'flow', kind: 'flow', title: '可编辑Word', childIds: [...headings.map(h => h.id), 'text', 'formula', 'table', 'chart'] }],
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
  const chartNs = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
  const relationshipNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const relationshipId = body.getElementsByTagNameNS(chartNs, 'chart')[0]!.getAttributeNS(
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
  const relations = parse(files['word/_rels/document.xml.rels']!)
  const chartTarget = Array.from(relations.getElementsByTagNameNS(relationshipNs, 'Relationship'))
    .find(node => node.getAttribute('Id') === relationshipId)!.getAttribute('Target')!
  const chartXml = parse(files[`word/${chartTarget}`]!)
  const category = chartXml.getElementsByTagNameNS(chartNs, 'cat')[0]!
  expect(Array.from(category.getElementsByTagNameNS(chartNs, 'v')).map(node => node.textContent)).toEqual(['甲班', '乙班'])
  const values = chartXml.getElementsByTagNameNS(chartNs, 'numCache')[0]!
  expect(Array.from(values.getElementsByTagNameNS(chartNs, 'v')).map(node => Number(node.textContent))).toEqual([12, 18])
  expect(chartXml.getElementsByTagNameNS(chartNs, 'tx')[1]!.textContent).toContain('人数')
  const chartName = chartTarget.slice(chartTarget.lastIndexOf('/') + 1)
  const chartRelations = parse(files[`word/charts/_rels/${chartName}.rels`]!)
  const workbookTarget = chartRelations.getElementsByTagNameNS(relationshipNs, 'Relationship')[0]!.getAttribute('Target')!
  const workbook = unzipSync(files[`word/${workbookTarget.replace('../', '')}`]!)
  const sheet = parse(workbook['xl/worksheets/sheet1.xml']!)
  const cells = new Map(Array.from(sheet.getElementsByTagNameNS('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'c'))
    .map(node => [node.getAttribute('r'), node.textContent]))
  expect([...cells.entries()]).toEqual([['A1', '分类'], ['B1', '人数'], ['A2', '甲班'], ['B2', '12'], ['A3', '乙班'], ['B3', '18']])
  expect(result.fidelity).toBe('complete')
  expect(document).toEqual(before)
})
