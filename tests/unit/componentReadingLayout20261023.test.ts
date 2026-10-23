import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createTextComponentData } from '../../src/components/text/data'
import { createTableData } from '../../src/components/table/data'
import { createChartData } from '../../src/components/chart/data'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentReadingProjection } from '../../src/renderer/export/componentPlatform/document/reading'
import { componentReadingLayout } from '../../src/renderer/export/componentPlatform/document/layout'
import { buildComponentDocx } from '../../src/renderer/export/componentPlatform/document'
import { buildComponentPrintHtml } from '../../src/renderer/export/componentPlatform/print'
import { resolveFlowDocxPageBox } from '../../src/renderer/export/flowPageBox'

function sample() {
  return courseProjectV11Schema.parse({ schemaVersion: 11, id: 'layout-output', revision: 0, title: '分栏输出',
    rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: Object.fromEntries(['container.flow', 'group', 'text', 'table', 'chart'].map(key => [key,
      { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['columns'], container: { kind: 'flow' } },
      columns: { id: 'columns', definitionId: 'group', data: {}, style: { display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 22, padding: 18, border: '1px solid #2563eb' }, childIds: ['left', 'right'] },
      left: { id: 'left', definitionId: 'group', data: {}, style: { display: 'flex', flexDirection: 'column', gap: 14 }, childIds: ['text', 'table'] },
      right: { id: 'right', definitionId: 'group', data: {}, style: { display: 'flex', flexDirection: 'column', gap: 14 }, childIds: ['chart'] },
      text: { id: 'text', definitionId: 'text', data: createTextComponentData('左栏原生正文') },
      table: { id: 'table', definitionId: 'table', data: createTableData({ rows: 1, columns: 2 }) },
      chart: { id: 'chart', definitionId: 'chart', data: createChartData() },
    } })
}

describe('static reading layout retains ordinary author groups', () => {
  it('preserves hierarchy, unequal column allocation, padding and native professional Word children', async () => {
    const source = sample(), before = structuredClone(source)
    const reading = buildComponentReadingProjection(source, 'flow')
    expect(reading.blocks.map(block => [block.instance.id, block.parentId])).toEqual([
      ['columns', undefined], ['left', 'columns'], ['text', 'left'], ['table', 'left'], ['right', 'columns'], ['chart', 'right'],
    ])
    const width = resolveFlowDocxPageBox('A4', 'portrait').maxContentWidthPx
    const layout = componentReadingLayout(reading, width)
    expect(layout.widths.get('text')).toBeCloseTo((width - 38 - 22) * 0.55)
    expect(layout.widths.get('chart')).toBeCloseTo((width - 38 - 22) * 0.45)
    const capture = vi.fn()
    const output = await buildComponentDocx(source, { surfaceId: 'flow', captureInstance: capture })
    expect(capture).not.toHaveBeenCalled()
    const files = unzipSync(output.bytes), word = strFromU8(files['word/document.xml']!)
    const xml = new DOMParser().parseFromString(word, 'application/xml')
    expect(xml.querySelector('parsererror')).toBeNull()
    expect(xml.getElementsByTagNameNS('*', 'tbl').length).toBeGreaterThan(3)
    expect(word).toContain('左栏原生正文')
    expect(word).not.toContain('__guoling_word_output__')
    expect(files['word/charts/componentChart1.xml']).toBeDefined()
    const chartXml = strFromU8(files['word/charts/componentChart1.xml']!)
    expect(chartXml).toContain('<c:showCatName val="0"/>')
    expect(chartXml).toContain('<c:showSerName val="0"/>')
    expect(chartXml).toContain('sz="1500"')
    expect(files['word/embeddings/componentChart1.xlsx']).toBeDefined()
    expect(output.diagnostics.filter(item => item.code === 'word-layout-capture')).toEqual([])
    const print = new DOMParser().parseFromString((await buildComponentPrintHtml(source, { surfaceId: 'flow' })).html, 'text/html')
    expect(print.querySelector('[data-component-output="columns"] [data-component-output="left"] [data-component-output="table"]')).not.toBeNull()
    expect(print.querySelector('[data-component-output="columns"] [style*="grid-template-columns"]')).not.toBeNull()
    expect(Number(print.querySelector('[data-component-output="chart"] svg')?.getAttribute('width'))).toBeCloseTo(layout.widths.get('chart')!, 0)
    expect((print.querySelector('[data-component-output="chart"] svg') as SVGElement).style.height).toBe('auto')
    expect(source).toEqual(before)
  })

  it('keeps non-overlapping framed geometry native and captures only a complex overlapping local group', async () => {
    const source = sample()
    source.instances.columns!.style = { border: '1px solid #2563eb' }
    source.instances.columns!.frame = { width: 500, height: 200, transform: [1, 0, 0, 1, 0, 0] }
    source.instances.columns!.childIds = ['text', 'chart']
    source.instances.text!.frame = { width: 220, height: 100, transform: [1, 0, 0, 1, 0, 0] }
    source.instances.chart!.frame = { width: 220, height: 150, transform: [1, 0, 0, 1, 260, 0] }
    let projection = buildComponentReadingProjection(source, 'flow')
    expect(componentReadingLayout(projection, 600).groups.get('columns')?.captureReason).toBeUndefined()
    expect((await buildComponentDocx(source, { surfaceId: 'flow' })).diagnostics.some(item => item.code === 'word-layout-capture')).toBe(false)
    source.instances.chart!.frame!.transform[4] = 100
    projection = buildComponentReadingProjection(source, 'flow')
    expect(componentReadingLayout(projection, 600).groups.get('columns')?.captureReason).toContain('重叠')
    const output = await buildComponentDocx(source, { surfaceId: 'flow' })
    expect(output.diagnostics.map(item => item.code)).toContain('capture-missing')
    const word = strFromU8(unzipSync(output.bytes)['word/document.xml']!)
    expect(word).not.toContain('左栏原生正文')
    const print = new DOMParser().parseFromString((await buildComponentPrintHtml(source, { surfaceId: 'flow' })).html, 'text/html')
    expect((print.querySelector('[data-component-output="chart"]') as HTMLElement).style.transform).toBe('matrix(1,0,0,1,100,0)')
  })

  it('diagnoses a legal implicit Grid column locally instead of hanging the whole DOCX export', async () => {
    const source = sample()
    source.instances.right!.style = { ...source.instances.right!.style, gridColumn: '3' }
    const result = await buildComponentDocx(source, { surfaceId: 'flow' })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'columns', code: 'word-layout-capture', message: expect.stringContaining('隐式列') }))
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ instanceId: 'columns', code: 'capture-missing' }))
    expect(new DOMParser().parseFromString(strFromU8(unzipSync(result.bytes)['word/document.xml']!), 'application/xml').querySelector('parsererror')).toBeNull()
  })

  it('maps separate native Grid start/end lines to editable Word column and row spans', async () => {
    const source = sample()
    source.instances.left!.style = { ...source.instances.left!.style, gridColumnStart: 1, gridColumnEnd: 3, gridRowStart: 1, gridRowEnd: 3 }
    const projection = buildComponentReadingProjection(source, 'flow'), plan = componentReadingLayout(projection, 600)
    expect(plan.groups.get('columns')?.rows[0]?.cells[0]).toEqual({ id: 'left', column: 0, columnSpan: 3, rowSpan: 3 })
    expect(plan.widths.get('left')).toBe(562)
    const result = await buildComponentDocx(source, { surfaceId: 'flow' })
    const word = strFromU8(unzipSync(result.bytes)['word/document.xml']!)
    expect(word).toContain('<w:gridSpan w:val="3"/>')
    expect(word).toContain('<w:vMerge w:val="restart"/>')
    expect(result.diagnostics.some(item => item.code === 'word-layout-capture')).toBe(false)
    source.instances.left!.style = { display: 'flex', flexDirection: 'column', gridColumnEnd: 3, gridRowEnd: 2 }
    const endOnly = componentReadingLayout(buildComponentReadingProjection(source, 'flow'), 600)
    expect(endOnly.groups.get('columns')?.rows[0]?.cells[0]).toEqual({ id: 'left', column: 2, columnSpan: 1, rowSpan: 1 })
    expect(endOnly.widths.get('left')).toBeCloseTo(243)
  })

  it('keeps a floating group and its nested layout as one diagnosed region without crashing or duplicating descendants', async () => {
    const source = sample()
    source.instances.columns!.flowPlacement = { space: 'paper', plane: 'overlay' }
    source.instances.columns!.frame = { width: 500, height: 350, transform: [1, 0, 0, 1, 20, 40] }
    const result = await buildComponentDocx(source, { surfaceId: 'flow' })
    expect(result.diagnostics.filter(item => item.code === 'word-layout-capture').map(item => item.instanceId)).toEqual(['columns'])
    expect(result.diagnostics.filter(item => item.code === 'capture-missing').map(item => item.instanceId)).toEqual(['columns'])
    const word = strFromU8(unzipSync(result.bytes)['word/document.xml']!)
    expect(new DOMParser().parseFromString(word, 'application/xml').querySelector('parsererror')).toBeNull()
    expect(word).not.toContain('左栏原生正文')
    expect(Object.keys(unzipSync(result.bytes)).some(path => path.startsWith('word/charts/'))).toBe(false)
    const local = sample()
    local.instances.right!.flowPlacement = { space: 'paper', plane: 'overlay' }
    local.instances.right!.frame = { width: 250, height: 200, transform: [1, 0, 0, 1, 280, 80] }
    const localResult = await buildComponentDocx(local, { surfaceId: 'flow' })
    expect(localResult.diagnostics.filter(item => item.code === 'word-layout-capture').map(item => item.instanceId)).toEqual(['right'])
    expect(localResult.diagnostics.filter(item => item.code === 'capture-missing').map(item => item.instanceId)).toEqual(['right'])
    const localWord = strFromU8(unzipSync(localResult.bytes)['word/document.xml']!)
    expect(localWord).toContain('左栏原生正文')
    expect(new DOMParser().parseFromString(localWord, 'application/xml').querySelector('parsererror')).toBeNull()
  })
})
