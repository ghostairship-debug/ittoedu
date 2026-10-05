import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { buildComponentPptx } from '@/renderer/export/componentPlatform/pptx'
import { createTextComponentData } from '@/components/text/data'
import { createTableData } from '@/components/table/data'
import { createChartData } from '@/components/chart/data'
import { defaultShapeData } from '@/components/shape/data'
import { createInputData } from '@/components/input'
import type { ComponentInstance, CourseProjectV10, JsonValue, PublishedCourseV3 } from '@/shared/contracts/component-platform'

function professionalPage(): CourseProjectV10 {
  const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
  const instance = (id: string, key: string, data: unknown, x: number, y: number, width: number, height: number): ComponentInstance => ({
    id, definitionId: key, data: json(data), frame: { width, height, transform: [1, 0, 0, 1, x, y] },
  })
  const text = createTextComponentData({ inlines: [{ type: 'text', text: '专业对象 ', style: { bold: true } }, { type: 'text', text: '😀 可编辑' }] })
  let counter = 0
  const table = createTableData({ rows: 2, columns: 2, idFactory: () => String(++counter) })
  table.rows[0]!.cells[0]!.text = '合并标题'
  table.rows[1]!.cells[0]!.text = '保留数据'
  table.rows[1]!.cells[1]!.text = '42'
  table.merges = [{ rowIds: [table.rows[0]!.id], columnIds: table.columns.map(column => column.id) }]
  const shape = { ...defaultShapeData(), pathGeometry: { paths: [{ fill: true, stroke: true, commands: [
    { kind: 'move' as const, to: [0, 0] as [number, number] },
    { kind: 'line' as const, to: [1, 0] as [number, number] },
    { kind: 'line' as const, to: [0.5, 1] as [number, number] }, { kind: 'close' as const },
  ] }] } }
  const instances = Object.fromEntries([
    { ...instance('group', 'guoling.group', {}, 40, 30, 900, 620), childIds: ['text', 'table', 'chart', 'shape', 'input', 'custom'] },
    instance('text', 'guoling.text', text, 20, 15, 800, 60),
    instance('table', 'guoling.table', table, 20, 100, 350, 160),
    instance('chart', 'guoling.chart', createChartData(), 400, 100, 440, 300),
    instance('shape', 'guoling.shape', shape, 20, 320, 140, 120),
    instance('input', 'guoling.input', createInputData({ label: '填写观察结果', acceptedAnswers: ['SECRET_CORRECT_ANSWER'] }), 20, 480, 300, 100),
    { ...instance('custom', 'guoling.text', text, 380, 480, 350, 100), implementationOverride: { kind: 'source' as const, language: 'javascript' as const,
      source: 'export default { mount() { throw new Error("SOURCE_MUST_NOT_BE_EXECUTED") } }' } },
  ].map(value => [value.id, value]))
  const keys = ['guoling.group', 'guoling.text', 'guoling.table', 'guoling.chart', 'guoling.shape', 'guoling.input']
  return { schemaVersion: 10, id: 'pptx-professional', revision: 7, title: '专业输出代表页',
    definitions: Object.fromEntries(keys.map(key => [key, { id: key, role: 'content' as const, implementation: { kind: 'builtin' as const, key } }])),
    instances, surfaces: [{ id: 'page-1', title: '混合专业页', kind: 'slide', childIds: ['group'], designSize: { width: 1000, height: 700 } }],
    global: { underlay: [], overlay: [] }, assets: {} }
}

function parseXml(bytes: Uint8Array) {
  const dom = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml')
  expect(dom.getElementsByTagName('parsererror')).toHaveLength(0)
  return dom.documentElement
}

describe('L23a current component PPTX consumer', () => {
  it('writes editable rich text, merged table, chart workbook and shape path while diagnosing uncaptured source locally', async () => {
    const project = professionalPage(), before = structuredClone(project)
    const authorResult = await buildComponentPptx(project)
    expect(authorResult.status).toBe('partial')
    expect(authorResult.slideCount).toBe(1)
    expect(authorResult.bytes.length).toBeGreaterThan(0)
    expect(authorResult.diagnostics.filter(item => item.severity === 'error').map(item => item.instanceId)).toEqual(['custom'])
    expect(project).toEqual(before)

    // P0 is the same professional input, without author revision or resource paths.
    const { revision: _revision, ...withoutRevision } = project
    const published: PublishedCourseV3 = { ...withoutRevision, schemaVersion: 3, assets: {} }
    const result = await buildComponentPptx(published)
    expect(result.slideCount).toBe(1)
    expect(result.status).toBe('partial')
    const files = unzipSync(result.bytes)
    const slide = parseXml(files['ppt/slides/slide1.xml']!)
    expect(slide.getElementsByTagNameNS('*', 'tbl')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS('*', 'chart')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS('*', 'custGeom')).toHaveLength(1)
    expect(slide.getElementsByTagNameNS('*', 'pic')).toHaveLength(0)
    const cells = [...slide.getElementsByTagNameNS('*', 'tc')]
    expect(cells.some(cell => cell.getAttribute('gridSpan') === '2')).toBe(true)
    expect(slide.textContent).toContain('合并标题')
    expect(slide.textContent).toContain('保留数据')
    expect(slide.textContent).toContain('😀 可编辑')
    expect(slide.textContent).toContain('填写观察结果')
    expect(slide.textContent).not.toContain('SECRET_CORRECT_ANSWER')
    const titleShape = [...slide.getElementsByTagNameNS('*', 'sp')].find(shape => shape.textContent?.includes('专业对象'))!
    const offset = titleShape.getElementsByTagNameNS('*', 'off')[0]!
    expect(Number(offset.getAttribute('x'))).toBe(20 * 9525)
    expect(Number(offset.getAttribute('y'))).toBe(15 * 9525)
    const group = titleShape.parentElement!
    expect(group.localName).toBe('grpSp')
    const groupOffset = group.getElementsByTagNameNS('*', 'off')[0]!
    expect(Number(groupOffset.getAttribute('x'))).toBe(40 * 9525)
    expect(Number(groupOffset.getAttribute('y'))).toBe(30 * 9525)
    expect([...titleShape.getElementsByTagNameNS('*', 'rPr')].some(run => run.getAttribute('b') === '1')).toBe(true)
    const chartRelationshipId = slide.getElementsByTagNameNS('*', 'chart')[0]!
      .getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    const relationships = parseXml(files['ppt/slides/_rels/slide1.xml.rels']!)
    const chartTarget = [...relationships.getElementsByTagNameNS('*', 'Relationship')]
      .find(relationship => relationship.getAttribute('Id') === chartRelationshipId)!.getAttribute('Target')!
    const chartPath = chartTarget.startsWith('/') ? chartTarget.slice(1) : posix.normalize(posix.join('ppt/slides', chartTarget))
    expect(files[chartPath]).toBeDefined()
    const chart = parseXml(files[chartPath]!)
    expect(chart.getElementsByTagNameNS('*', 'barChart')).toHaveLength(1)
    expect(chart.textContent).toContain('系列一')
    expect(chart.textContent).toContain('甲')
    expect(chart.textContent).toContain('20')
    expect(chart.textContent).toContain('35')
    const workbookName = Object.keys(files).find(name => /^ppt\/embeddings\/.+\.xlsx$/.test(name))!
    expect(workbookName).toBeTruthy()
    const workbook = unzipSync(files[workbookName]!)
    const sheet = parseXml(workbook['xl/worksheets/sheet1.xml']!)
    const values = [...sheet.getElementsByTagNameNS('*', 'v')].map(node => node.textContent)
    expect(values).toContain('20'); expect(values).toContain('35')
    expect(result.diagnostics.some(item => item.instanceId === 'input' && item.code === 'format-difference')).toBe(true)
    expect(result.diagnostics.some(item => item.instanceId === 'custom' && item.code === 'instance-unsupported')).toBe(true)
    const output = resolve('output/component-platform-l23a')
    mkdirSync(output, { recursive: true })
    writeFileSync(resolve(output, 'representative.pptx'), result.bytes)
    writeFileSync(resolve(output, 'representative-report.json'), JSON.stringify({ status: result.status, slideCount: result.slideCount,
      pages: result.pages, diagnostics: result.diagnostics, proof: ['editable rich text', 'merged table', 'chart + embedded workbook', 'custom shape geometry', 'source unsupported locally'] }, null, 2))
  })
})
