import { describe, expect, it } from 'vitest'
import { createTextComponentData } from '../../src/components/text/data'
import { courseProjectV11Schema } from '../../src/shared/contracts/component-platform/schema'
import { buildComponentReadingProjection } from '../../src/renderer/export/componentPlatform/document/reading'
import { componentReadingLayout, wordReadingLayout } from '../../src/renderer/export/componentPlatform/document/layout'

function fixture() {
  return courseProjectV11Schema.parse({ schemaVersion: 11, id: 'word-layout-regression', revision: 0, title: 'Layout',
    rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: Object.fromEntries(['container.flow', 'group', 'text'].map(key => [key,
      { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: {
      flow: { id: 'flow', definitionId: 'container.flow', data: {}, childIds: ['group'], container: { kind: 'flow' } },
      group: { id: 'group', definitionId: 'group', data: {}, childIds: ['a', 'b'], style: { display: 'grid', gridTemplateColumns: '1fr 1fr' } },
      a: { id: 'a', definitionId: 'text', data: createTextComponentData('A') },
      b: { id: 'b', definitionId: 'text', data: createTextComponentData('B') },
    } })
}
const allocate = (source: ReturnType<typeof fixture>) => componentReadingLayout(buildComponentReadingProjection(source, 'flow'), 600)

describe('Word consumes the supported Flow layout semantics', () => {
  it('retains numeric gridArea positions and fills the first available cell around definite items', () => {
    const source = fixture()
    source.instances.a!.style = { gridArea: '1 / 2 / 2 / 3' }
    let group = allocate(source).groups.get('group')!
    expect(group.captureReason).toBeUndefined()
    expect(group.rows[0]!.cells).toEqual([
      { id: 'a', column: 2, columnSpan: 1, rowSpan: 1 },
      { id: 'b', column: 0, columnSpan: 1, rowSpan: 1 },
    ])
    expect(group.rows).toHaveLength(1)
    // The definite item may be later in source order; it still reserves its cell first.
    source.instances.group!.childIds = ['b', 'a']
    group = allocate(source).groups.get('group')!
    expect(group.rows[0]!.cells.find(cell => cell.id === 'b')?.column).toBe(0)
  })

  it('preserves explicit and repeated implicit row heights as exact Word tracks', () => {
    const source = fixture()
    source.instances.group!.style = { display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: '80px 120px', gridAutoRows: '60px', gap: '10px 20px' }
    source.instances.group!.childIds!.push('c')
    source.instances.c = { id: 'c', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('C'))) }
    const group = allocate(source).groups.get('group')!
    expect(group.captureReason).toBeUndefined()
    expect(group.rows.filter(row => row.heightRule === 'exact').map(row => row.height)).toEqual([80, 120, 60])
    expect(group.rows.filter(row => !row.cells.length).map(row => row.height)).toEqual([10, 10])
    const word = wordReadingLayout(group, new Map([['a', '<w:p/>'], ['b', '<w:p/>'], ['c', '<w:p/>']]), source.instances.group!)
    expect(word).toContain('<w:trHeight w:val="1200" w:hRule="exact"/>')
    expect(word).toContain('<w:trHeight w:val="1800" w:hRule="exact"/>')
    expect(word).toContain('<w:trHeight w:val="900" w:hRule="exact"/>')
  })

  it('expands flexFlow and diagnoses wrapping rather than silently flattening it', () => {
    const source = fixture()
    source.instances.group!.style = { display: 'flex', flexFlow: 'column' }
    const column = allocate(source).groups.get('group')!
    expect(column.captureReason).toBeUndefined()
    expect(column.rows.filter(row => row.cells.length).map(row => row.cells[0]!.id)).toEqual(['a', 'b'])
    source.instances.group!.style.flexFlow = 'row wrap'
    expect(allocate(source).groups.get('group')!.captureReason).toContain('换行 Flex')
  })

  it('captures column flex with a constrained main axis while keeping a natural column native', () => {
    const source = fixture()
    source.instances.a!.style = { flex: 1 }
    source.instances.b!.style = { flex: 1 }
    source.instances.group!.style = { display: 'flex', flexDirection: 'column' }
    expect(allocate(source).groups.get('group')!.captureReason).toBeUndefined()
    source.instances.group!.style.height = 400
    expect(allocate(source).groups.get('group')!.captureReason).toContain('固定主轴高度')
    source.instances.group!.style = { display: 'flex', flexFlow: 'column-reverse', blockSize: 400 }
    expect(allocate(source).groups.get('group')!.captureReason).toContain('固定主轴高度')
    source.instances.group!.style = { display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }
    expect(allocate(source).groups.get('group')!.captureReason).toContain('剩余空间')
    source.instances.group!.style = { display: 'flex', flexDirection: 'column' }
    source.instances.a!.style = { width: 100, alignSelf: 'center' }
    expect(allocate(source).groups.get('group')!.captureReason).toContain('水平对齐或独立宽度')
    source.instances.a!.style = { width: '100%', alignSelf: 'center' }
    expect(allocate(source).groups.get('group')!.captureReason).toBeUndefined()
    source.instances.group!.style.alignItems = 'center'
    expect(allocate(source).groups.get('group')!.captureReason).toContain('水平对齐或独立宽度')
  })

  it('captures Grid item horizontal positioning and narrower content instead of pretending it fills the track', () => {
    const source = fixture()
    expect(allocate(source).groups.get('group')!.captureReason).toBeUndefined()
    for (const style of [{ width: 100 }, { width: 100, justifySelf: 'center' }, { width: 100, placeSelf: 'start center' }]) {
      source.instances.a!.style = JSON.parse(JSON.stringify(style))
      expect(allocate(source).groups.get('group')!.captureReason).toContain('水平对齐或独立宽度')
    }
    source.instances.a!.style = {}
    source.instances.group!.style!.justifyItems = 'center'
    expect(allocate(source).groups.get('group')!.captureReason).toContain('水平对齐或独立宽度')
    source.instances.group!.style!.justifyItems = 'stretch'
    source.instances.a!.style = { width: '100%' }
    expect(allocate(source).groups.get('group')!.captureReason).toBeUndefined()
  })

  it('uses zero basis for two-number flex and carries actual vertical alignment into Word cells', () => {
    const source = fixture()
    source.instances.group!.style = { display: 'flex', alignItems: 'center' }
    source.instances.a!.style = { flex: '1 1', width: 100 }
    source.instances.b!.style = { flex: '1 1', width: 200, alignSelf: 'flex-end' }
    const layout = allocate(source), group = layout.groups.get('group')!
    expect(group.captureReason).toBeUndefined()
    expect(layout.widths.get('a')).toBe(300)
    expect(layout.widths.get('b')).toBe(300)
    expect(group.rows[0]!.cells.map(cell => cell.verticalAlign)).toEqual(['center', 'bottom'])
    const word = wordReadingLayout(group, new Map([['a', '<w:p/>'], ['b', '<w:p/>']]), source.instances.group!)
    expect(word).toContain('<w:vAlign w:val="center"/>')
    expect(word).toContain('<w:vAlign w:val="bottom"/>')
  })

  it('accumulates uniform free transforms exactly once for native text consumers', () => {
    const source = fixture()
    source.instances.group!.style = {}
    source.instances.group!.frame = { width: 500, height: 300, transform: [1, 0, 0, 1, 0, 0] }
    source.instances.group!.childIds = ['inner']
    source.instances.inner = { id: 'inner', definitionId: 'group', data: {}, childIds: ['a'],
      frame: { width: 200, height: 100, transform: [2, 0, 0, 2, 0, 0] } }
    source.instances.a!.frame = { width: 100, height: 30, transform: [1.5, 0, 0, 1.5, 0, 0] }
    const result = allocate(source)
    expect(result.groups.get('group')!.captureReason).toBeUndefined()
    expect(result.groups.get('inner')!.captureReason).toBeUndefined()
    expect(result.scales.get('inner')).toBe(2)
    expect(result.scales.get('a')).toBe(3)
    expect(result.widths.get('a')).toBe(300)
    source.instances.a!.frame!.transform[3] = 1
    expect(allocate(source).groups.get('inner')!.captureReason).toBeDefined()
  })
})
