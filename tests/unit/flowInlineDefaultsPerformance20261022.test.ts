import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { createTableData } from '../../src/components/table/data'
import * as tableRender from '../../src/components/table/render'
import { createFlowInlineStyleDefaults, flowInlineStyleDefaults } from '../../src/renderer/ui/flow/flowInlineStyleDefaults'
import type { DocumentBlock } from '../../src/shared/document/content'
import type { DocumentPoint } from '../../src/shared/document/ports'

vi.mock('../../src/components/table/render', async importOriginal => {
  const actual = await importOriginal<typeof tableRender>()
  return { ...actual, layoutTable: vi.fn(actual.layoutTable) }
})

afterEach(() => vi.clearAllMocks())

function tableProject() {
  const data = createTableData({ rows: 2, columns: 2 })
  data.rows[0].cells[0].style = { fontSize: 31, bold: true, textColor: '#123456' }
  data.columns[0].header = { inlines: [{ type: 'text', text: 'Header' }] }
  const project = { revision: 1, definitions: { table: { implementation: { kind: 'builtin', key: 'guoling.table' } } },
    instances: { table: { id: 'table', definitionId: 'table', data } } } as unknown as CourseProjectV10
  const cell: DocumentPoint = { blockId: 'table', slot: { kind: 'cell', rowId: data.rows[0].id, columnId: data.columns[0].id }, offset: 0, affinity: 'after' }
  const header: DocumentPoint = { ...cell, slot: { kind: 'header', columnId: data.columns[0].id } }
  return { project, data, cell, header }
}

describe('Flow table defaults reuse the current formal table projection', () => {
  it('lays out once for repeated inline and header reads and does not expose cached mutable styles', () => {
    const { project, data, cell, header } = tableProject()
    const first = flowInlineStyleDefaults(project, 'table', cell)!
    expect(first).toMatchObject({ fontSize: 31, bold: true, color: '#123456' })
    first.fontSize = 99
    expect(flowInlineStyleDefaults(project, 'table', { ...cell, offset: 1 })).toMatchObject({ fontSize: 31 })
    expect(flowInlineStyleDefaults(project, 'table', header)).toMatchObject({ bold: true, fontSize: data.style.fontSize })
    expect(tableRender.layoutTable).toHaveBeenCalledTimes(1)
  })

  it('rebuilds for a changed formal revision or replacement table data instead of returning stale defaults', () => {
    const { project, data, cell } = tableProject()
    expect(flowInlineStyleDefaults(project, 'table', cell)?.fontSize).toBe(31)
    data.rows[0].cells[0].style = { fontSize: 36 }
    project.revision += 1
    expect(flowInlineStyleDefaults(project, 'table', cell)?.fontSize).toBe(36)
    const replacement = structuredClone(data)
    replacement.rows[0].cells[0].style = { fontSize: 42 }
    project.instances.table.data = replacement as any
    expect(flowInlineStyleDefaults(project, 'table', cell)?.fontSize).toBe(42)
    expect(tableRender.layoutTable).toHaveBeenCalledTimes(3)
  })

  it('keeps the callback and table lookup through text ACKs and fresh canonical project identities', () => {
    const { project, cell, header } = tableProject(), read = createFlowInlineStyleDefaults()
    const blocks = [{ id: 'table', type: 'table' }] as DocumentBlock[]
    const first = read(project, blocks), next = structuredClone(project)
    const data = next.instances.table.data as any
    data.columns[0].header = { inlines: [{ type: 'text', text: 'New header body' }] }
    data.columns[0].width += 20
    data.rows[0].height += 30
    Object.defineProperty(data.rows[0].cells[0], 'text', { enumerable: true, get() { throw new Error('default cache read authored body') } })
    next.revision += 1
    const second = read(next, blocks)
    expect(second).toBe(first)
    expect(second('table', cell)).toMatchObject({ fontSize: 31, bold: true })
    expect(second('table', header)).toMatchObject({ bold: true })
    expect(tableRender.layoutTable).toHaveBeenCalledTimes(1)
    second('table', cell)!.fontSize = 99
    expect(first('table', cell)?.fontSize).toBe(31)
  })

  it('updates real text appearance and table styles without changing earlier callback snapshots', () => {
    const { project, cell } = tableProject(), read = createFlowInlineStyleDefaults()
    project.definitions.text = { implementation: { kind: 'builtin', key: 'guoling.text' } } as any
    project.instances.text = { id: 'text', definitionId: 'text', data: { appearance: { fontSize: 20, bold: false }, content: { inlines: [] } } } as any
    const blocks = [{ id: 'table', type: 'table' }, { id: 'text', type: 'paragraph' }] as DocumentBlock[]
    const first = read(project, blocks), next = structuredClone(project)
    ;(next.instances.text.data as any).appearance.bold = true
    ;(next.instances.table.data as any).rows[0].cells[0].style.fontSize = 42
    const second = read(next, blocks)
    expect(second).not.toBe(first)
    expect(second('table', cell)?.fontSize).toBe(42)
    expect(second('text')?.bold).toBe(true)
    expect(first('table', cell)?.fontSize).toBe(31)
    expect(first('text')?.bold).toBe(false)
    next.instances.text.implementationOverride = { kind: 'source' } as any
    expect(read(next, blocks)('text')).toBeUndefined()
  })

  it('keeps header, row identity, and merged-cell defaults aligned with the visible table algorithm', () => {
    const { project, header } = tableProject(), read = createFlowInlineStyleDefaults(), data = project.instances.table.data as any
    const blocks = [{ id: 'table', type: 'table' }] as DocumentBlock[]
    const body: DocumentPoint = { ...header, slot: { kind: 'cell', rowId: data.rows[1].id, columnId: data.columns[1].id } }
    const first = read(project, blocks)
    expect(first('table', body)?.bold).toBe(false)
    const secondProject = structuredClone(project), next = secondProject.instances.table.data as any
    next.headerRowCount = 1
    next.rows.reverse()
    const second = read(secondProject, blocks)
    expect(second('table', body)?.bold).toBe(true)
    next.headerEnabled = false
    next.merges = [{ rowIds: [next.rows[0].id], columnIds: next.columns.map((column: any) => column.id) }]
    const third = read(secondProject, blocks)
    expect(third('table', header)).toBeUndefined()
    expect(third('table', body)).toBeUndefined()
    expect(second('table', header)?.bold).toBe(true)
    expect(second('table', body)?.bold).toBe(true)
  })
})
