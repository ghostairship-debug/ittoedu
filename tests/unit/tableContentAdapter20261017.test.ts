// @vitest-environment node
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { expect, it } from 'vitest'
import { createTableData, parseTableData, tableCellContent, tableContentInputSchema, toNativeTableData } from '../../src/components/table/data'
import { createTableContentData, replaceTableContentData } from '../../src/components/table/content'
import { editTableCellText } from '../../src/components/table/edit'
import { plainDocumentText } from '../../src/shared/document/content'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { prepareCourseElementEdits } from '../../src/core/course/courseElementInsertion'
import { componentDataEdits, componentTableDataEdits } from '../../src/core/course/componentDataEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { createCourseProjectV10Archive, openCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'

const values = (data: ReturnType<typeof parseTableData>) => data.rows.map(row => row.cells.map(cell => plainDocumentText(tableCellContent(cell))))
const ids = (data: ReturnType<typeof parseTableData>) => ({ columns: data.columns.map(column => column.id),
  rows: data.rows.map(row => row.id), cells: data.rows.map(row => row.cells.map(cell => cell.id)) })

it('creates rectangular plain content through the professional insertion planner with software identities', () => {
  const project = createBlankCourseProjectV10('普通表格'), surfaceId = componentSurfaces(project)[0]!.id
  const before = structuredClone(project)
  const input = { rows: [['项目', '数量'], ['甲 😀', '20'], ['乙', '35'], ['丙', '18']], headerRowCount: 1 }
  const prepared = prepareCourseElementEdits(project, surfaceId, null, 'table', { table: input, x: 25, y: 35, width: 520, height: 260 })
  const inserted = applyComponentOperation(project, captureComponentOperation(project, prepared.edits))
  const instance = inserted.instances[prepared.instanceIds[0]!]!, data = parseTableData(instance.data)
  expect(values(data)).toEqual(input.rows)
  expect(data.headerRowCount).toBe(1)
  expect(new Set([...ids(data).columns, ...ids(data).rows, ...ids(data).cells.flat()]).size).toBe(14)
  expect(instance.frame).toEqual({ width: 520, height: 260, transform: [1, 0, 0, 1, 25, 35] })
  expect(project).toEqual(before)
})

it('rejects nonrectangular content and impossible headers at the same semantic adapter', () => {
  for (const input of [{ rows: [] }, { rows: [[]] }, { rows: [['甲'], ['乙', '丙']] }, { rows: [['甲']], headerRowCount: 2 }])
    expect(tableContentInputSchema.safeParse(input).success).toBe(false)
  expect(() => createTableContentData({ rows: [['甲'], ['乙', '丙']] })).toThrow('表格每行')
})

it('retains positional identities, existing dimensions, appearance and unchanged rich content while growing', () => {
  let sequence = 0
  const source = createTableData({ rows: 2, columns: 2, idFactory: () => String(++sequence) })
  source.columns[0]!.width = 280; source.rows[0]!.height = 65; source.style.fillColor = '#dbeafe'
  source.caption = { inlines: [{ type: 'text', text: '保留题注', style: { italic: true } }] }
  const first = source.rows[0]!.cells[0]!
  source.rows[0]!.cells[0] = { id: first.id, columnId: first.columnId, style: { fillColor: '#fde68a' },
    content: { inlines: [{ type: 'text', text: '强调', style: { bold: true } }, { type: 'text', text: '内容' }] } }
  const snapshot = structuredClone(source), beforeIds = ids(source)
  const result = replaceTableContentData(source, { rows: [['强调内容', '二', '新增列'], ['三', '四', '五'], ['新增行', '六', '七']] }, () => String(++sequence))
  expect(result.columns.slice(0, 2)).toEqual(source.columns)
  expect(ids(result).rows.slice(0, 2)).toEqual(beforeIds.rows)
  expect(ids(result).cells.slice(0, 2).map(row => row.slice(0, 2))).toEqual(beforeIds.cells)
  expect(result.rows[0]!.height).toBe(65)
  expect(result.rows[0]!.cells[0]).toEqual(source.rows[0]!.cells[0])
  expect(result.style).toEqual(source.style); expect(result.caption).toEqual(source.caption)
  expect(source).toEqual(snapshot)
})

it('keeps valid merges and exposes newly supplied covered content without discarding it', () => {
  const source = createTableContentData({ rows: [['合并甲', '', '末列'], ['合并乙', '', '尾列'], ['末行', '', '末格']] })
  const first = { rowIds: [source.rows[0]!.id], columnIds: source.columns.slice(0, 2).map(column => column.id) }
  const second = { rowIds: [source.rows[1]!.id], columnIds: source.columns.slice(0, 2).map(column => column.id) }
  source.merges = [first, second]
  const changed = replaceTableContentData(source, { rows: [['新甲', '', '末列'], ['新乙', '可见正文', '尾列']] })
  expect(changed.merges).toEqual([first])
  expect(values(changed)).toEqual([['新甲', '', '末列'], ['新乙', '可见正文', '尾列']])
  const narrowed = replaceTableContentData(source, { rows: [['单列'], ['下一行']] })
  expect(narrowed.merges).toEqual([])
  expect(values(narrowed)).toEqual([['单列'], ['下一行']])
})

it('removes only a merge crossing an explicitly changed header boundary', () => {
  const source = createTableContentData({ rows: [['跨行', '甲'], ['', '乙'], ['尾行', '丙']] })
  source.merges = [{ rowIds: source.rows.slice(0, 2).map(row => row.id), columnIds: [source.columns[0]!.id] }]
  const changed = replaceTableContentData(source, { rows: values(source), headerRowCount: 1 })
  expect(changed.merges).toEqual([])
  expect(changed.headerRowCount).toBe(1)
  expect(values(changed)).toEqual(values(source))
})

it('treats an existing synthetic Flow header as the first visible input row', () => {
  const source = createTableContentData({ rows: [['原正文', '2']] })
  source.columns[0]!.header = { inlines: [{ type: 'text', text: '原表头', style: { bold: true } }] }
  source.columns[1]!.header = { inlines: [{ type: 'text', text: '数量' }] }
  const data = replaceTableContentData(source, { rows: [['新表头', '数量'], ['新正文', '3']], headerRowCount: 1 })
  expect(toNativeTableData(data).rows.map(row => row.cells.map(cell => cell.text))).toEqual([['新表头', '数量'], ['新正文', '3']])
  expect(toNativeTableData(data).headerRowCount).toBe(1)
  expect(data.rows[0]!.id).toBe(source.rows[0]!.id)
  expect(data.columns[1]!.header).toEqual(source.columns[1]!.header)
  const noHeader = replaceTableContentData(source, { rows: [['新首行', '值'], ['新正文', '4']], headerRowCount: 0 })
  expect(toNativeTableData(noHeader).rows.map(row => row.cells.map(cell => cell.text))).toEqual([['新首行', '值'], ['新正文', '4']])
  expect(toNativeTableData(noHeader).headerRowCount).toBe(0)
  expect(noHeader.columns.every(column => !column.header)).toBe(true)
  expect(noHeader.rows[1]!.id).toBe(source.rows[0]!.id)
})

it('preserves formula and inline-component atoms when appending at their text boundaries', () => {
  const formula = { inlines: [{ type: 'math' as const, formulaId: 'formula', latex: 'x+y', accessibleText: 'x+y' }] }
  const appended = editTableCellText(formula, 'x+yz')
  expect(appended.inlines[0]).toEqual(formula.inlines[0])
  expect(plainDocumentText(appended)).toBe('x+yz')
  const component = { inlines: [{ type: 'component' as const, instanceId: 'inline', accessibleText: 'abc' }, { type: 'text' as const, text: 'DEF' }] }
  const inserted = editTableCellText(component, 'abcZDEF')
  expect(inserted.inlines[0]).toEqual(component.inlines[0])
  expect(plainDocumentText(inserted)).toBe('abcZDEF')
  expect(plainDocumentText(editTableCellText(component, 'abXDEF'))).toBe('abXDEF')
  const emptyAtom = editTableCellText({ inlines: [{ type: 'component', instanceId: 'empty-inline', accessibleText: '' }] }, 'z')
  expect(plainDocumentText(emptyAtom)).toBe('z')
  expect(emptyAtom.inlines.filter(inline => inline.type === 'component' && inline.instanceId === 'empty-inline')).toHaveLength(1)
  const source = createTableData({ rows: 1, columns: 1 })
  const first = source.rows[0]!.cells[0]!
  source.rows[0]!.cells[0] = { id: first.id, columnId: first.columnId, content: formula }
  expect(plainDocumentText(tableCellContent(replaceTableContentData(source, { rows: [['x+yz']] }).rows[0]!.cells[0]!))).toBe('x+yz')
})

it('uses one canonical data edit for whole-table content and preserves explicit-ID rich local editing', () => {
  const project = createBlankCourseProjectV10('接力表格'), surfaceId = componentSurfaces(project)[0]!.id
  const prepared = prepareCourseElementEdits(project, surfaceId, null, 'table', { table: { rows: [['表头', '列二'], ['正文', '2']], headerRowCount: 1 } })
  const inserted = applyComponentOperation(project, captureComponentOperation(project, prepared.edits))
  const instanceId = prepared.instanceIds[0]!, instance = inserted.instances[instanceId]!, before = parseTableData(instance.data)
  const edits = componentDataEdits(inserted, { surfaceId, instanceId }, { kind: 'patch', data: { rows: [['标题', '列二'], ['正文', '22'], ['新增', '3']], style: { fontSize: 24 } } })
  const changed = applyComponentOperation(inserted, captureComponentOperation(inserted, edits))
  const data = parseTableData(changed.instances[instanceId]!.data)
  expect(ids(data).columns).toEqual(ids(before).columns)
  expect(ids(data).rows.slice(0, 2)).toEqual(ids(before).rows)
  expect(data.style.fontSize).toBe(24); expect(data.style.fillColor).toBe(before.style.fillColor)
  expect(data.headerRowCount).toBe(1); expect(changed.instances[instanceId]!.frame).toEqual(instance.frame)
  const rich = { inlines: [{ type: 'text' as const, text: '加粗正文', style: { bold: true } }] }
  const local = componentTableDataEdits(changed, { surfaceId, instanceId }, { kind: 'cell-content', cellId: data.rows[1]!.cells[0]!.id, content: rich })
  const localized = applyComponentOperation(changed, captureComponentOperation(changed, local))
  expect(parseTableData(localized.instances[instanceId]!.data).rows[1]!.cells[0]!.content).toEqual(rich)
  expect(values(parseTableData(localized.instances[instanceId]!.data))[2]).toEqual(['新增', '3'])
  const reopened = openCourseProjectV10Archive(createCourseProjectV10Archive({ project: localized, resources: { assets: {}, components: {} } }))
  expect(reopened.project.instances[instanceId]).toEqual(localized.instances[instanceId])
})
