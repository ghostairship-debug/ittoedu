import { buildPublishedFixture as buildPublishedCourseV2Payload } from '../fixtures/teacherController'
import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { addSpatialWorldTableLayer, replaceSpatialWorldTable, openSpatialAuthoringSession, undoSpatialAuthoring, setSpatialEditingScope } from '@/renderer/course/spatialEditorCommands'
import { duplicateSpatialLayers } from '@/renderer/course/spatialClipboardCommands'
import { insertFlowEditorBlock, duplicateFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { changeFlowTableStructure } from '@/renderer/course/flowTableContentOperations'
import { patchTableCellText } from '@/renderer/course/tableContentOperations'

import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { SpatialSurfaceHost } from '@/player/surfaces/spatial/SpatialSurfaceHost'
import { renderPublishedSpatialFrameSvg } from '@/player/surfaces/spatial/publishedSpatialStaticRendering'
import { collectPublishedPptxSpatialNotices } from '@/renderer/export/course/buildCoursePptx'
import type { FlowTableBlock } from '@/shared/courseProjectTypes'
import { flowBlockSchema } from '@/shared/courseProjectSchema'
import { tableNativeContentObjectSchema } from '@/shared/contracts/native-v1'
import { createTableNode } from '@/renderer/project/nativeNodeFactories'
import { mergeTableCells, splitTableCells, deleteTableRow, insertTableColumn, reorderTableRows } from '@/renderer/course/tableContentOperations'
import { rebuildTableItemIds } from '@/renderer/project/nativeNodeFactories'
import { buildNativeTableLayout } from '@/shared/nativeTableLayout'
import { paintPublishedNativeTable } from '@/player/surfaces/native/publishedNativeRendering'

it('merges nonempty Native cells once, preserves identities, rejects split regions and paints only anchors', () => {
  const node = createTableNode({ headerRowCount: 0 })
  const source = { rows: node.rows, columns: node.columns, headerRowCount: 0, style: node.style }
  const region = { rowIds: node.rows.slice(0, 2).map(row => row.id), columnIds: node.columns.slice(0, 2).map(column => column.id) }
  const merged = mergeTableCells(source, region)
  expect(merged.rows[0]!.cells[0]!.text).toBe([node.rows[0]!.cells[0]!.text, node.rows[0]!.cells[1]!.text, node.rows[1]!.cells[0]!.text, node.rows[1]!.cells[1]!.text].join('\n'))
  expect(() => deleteTableRow(merged, { rowId: region.rowIds[0]! })).toThrow()
  expect(() => insertTableColumn(merged, { referenceColumnId: region.columnIds[0]!, position: 'after' })).toThrow()
  expect(() => reorderTableRows(merged, { orderedRowIds: [node.rows[0]!.id, node.rows[2]!.id, node.rows[1]!.id] })).toThrow()
  expect(() => patchTableCellText(merged, { cellId: node.rows[1]!.cells[1]!.id, text: 'hidden' })).toThrow()
  const split = splitTableCells(merged, { rowId: region.rowIds[1]!, columnId: region.columnIds[1]! })
  expect(split.merges).toEqual([]); expect(split.rows[0]!.cells[0]!.text).toBe(merged.rows[0]!.cells[0]!.text)
  const copy = rebuildTableItemIds(merged)
  expect(copy.merges?.[0]?.rowIds).toEqual(copy.rows.slice(0, 2).map(row => row.id))
  expect(copy.merges?.[0]?.columnIds).toEqual(copy.columns.slice(0, 2).map(column => column.id))
  const layout = buildNativeTableLayout(merged)
  expect(layout.cells).toHaveLength(6)
  expect(layout.cells[0]).toMatchObject({ rowSpan: 2, columnSpan: 2, width: node.columns[0]!.width + node.columns[1]!.width, height: node.rows[0]!.height + node.rows[1]!.height })
  const host = document.createElement('div')
  paintPublishedNativeTable(host, { ...node, ...merged })
  expect(host.querySelectorAll('td')).toHaveLength(6)
  expect(host.querySelector('td')?.getAttribute('rowspan')).toBe('2')
})

it('preserves merged Flow rich text and produces real Word gridSpan/vMerge and matching HTML', () => {
  const original: FlowTableBlock = { id: 'merged-flow', type: 'table', columns: [{ id: 'a', header: { inlines: [{ type: 'text', text: '甲' }] }}, { id: 'b', header: { inlines: [{ type: 'text', text: '乙' }] }}], rows: [{ id: 'r1', cells: { a: { inlines: [{ type: 'text', text: '😀' }] }, b: { inlines: [{"type":"text","text":"强调","style":{"bold":true}}] }} }, { id: 'r2', cells: { a: { inlines: [{ type: 'text', text: '下方' }] }, b: { inlines: [{ type: 'text', text: '末格' }] }} }] }
  const merged = changeFlowTableStructure(original, { kind: 'merge', region: { rowIds: ['r1', 'r2'], columnIds: ['a', 'b'] } })
  expect(merged.rows[0]!.cells.a).toEqual({ inlines: [{ type: 'text', text: '😀\n' }, { type: 'text', text: '强调', style: { bold: true } }, { type: 'text', text: '\n下方\n末格' }] })
  expect(() => changeFlowTableStructure(merged, { kind: 'delete-row', id: 'r1' })).toThrow()
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces.find(surface => surface.type === 'flow')!
  if (surface.type !== 'flow') throw new Error('flow')
  surface.blocks.push(merged)
  const published = buildPublishedCourseV2Payload({ project, assetFiles: {}, components: {} })
  const flow = published.surfaces.find(surface => surface.type === 'flow')!
  if (flow.type !== 'flow') throw new Error('flow')
  const html = renderFlowPrintBodyHtml(buildFlowPrintPlan(flow))
  expect(html).toContain('rowspan="2" colspan="2"')
  const docx = buildFlowDocx(flow)
  const xml = strFromU8(unzipSync(docx.bytes)['word/document.xml']!)
  expect(xml).toContain('<w:gridSpan w:val="2"/>')
  expect(xml).toContain('<w:vMerge w:val="restart"/>')
  expect(xml).toContain('<w:vMerge w:val="continue"/>')
})

it('strictly accepts rectangular stable merge regions and rejects dangling, overlapping and hidden content', () => {
  const node = createTableNode()
  const table = { columns: node.columns, rows: node.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell, text: '' })) })), headerRowCount: 0, style: node.style }
  const merge = { rowIds: table.rows.slice(0, 2).map(row => row.id), columnIds: table.columns.slice(0, 2).map(column => column.id) }
  expect(tableNativeContentObjectSchema.safeParse(table).success).toBe(true)
  expect(tableNativeContentObjectSchema.safeParse({ ...table, merges: [merge] }).success).toBe(true)
  expect(tableNativeContentObjectSchema.safeParse({ ...table, merges: [merge, merge] }).success).toBe(false)
  expect(tableNativeContentObjectSchema.safeParse({ ...table, merges: [{ ...merge, rowIds: ['missing'] }] }).success).toBe(false)
  expect(tableNativeContentObjectSchema.safeParse({ ...table, merges: [{ ...merge, extra: true }] }).success).toBe(false)
  table.rows[1]!.cells[1]!.text = 'hidden'
  expect(tableNativeContentObjectSchema.safeParse({ ...table, merges: [merge] }).success).toBe(false)
  const flow: FlowTableBlock = { id: 'flow', type: 'table', columns: [{ id: 'a', header: { inlines: [{ type: 'text', text: 'A' }] }}, { id: 'b', header: { inlines: [{ type: 'text', text: 'B' }] }}], rows: [{ id: 'r', cells: { a: { inlines: [{ type: 'text', text: 'anchor' }] }, b: { inlines: [{ type: 'text', text: '' }] }} }], merges: [{ rowIds: ['r'], columnIds: ['a', 'b'] }] }
  expect(flowBlockSchema.safeParse(flow).success).toBe(true)
  expect(flowBlockSchema.safeParse({ ...flow, merges: [{ rowIds: ['r'], columnIds: ['b', 'a'] }] }).success).toBe(false)
})

it('preserves rich cells through Flow structure edits, identity duplication, Published and editable DOCX', () => {
  const original: FlowTableBlock = { id: 'table', type: 'table', caption: { inlines: [{ type: 'text', text: '可编辑表格' }] }, columns: [{ id: 'a', header: { inlines: [{ type: 'text', text: '甲' }] }}, { id: 'b', header: { inlines: [{ type: 'text', text: '乙' }] }}], rows: [{ id: 'row', cells: { a: { inlines: [{"type":"text","text":"强调","style":{"bold":true}},{"type":"text","text":"文字"}] }, b: { inlines: [{ type: 'text', text: '另一列' }] }} }] }
  const changed = changeFlowTableStructure(changeFlowTableStructure(original, { kind: 'insert-row' }), { kind: 'move-column', id: 'b', direction: -1 })
  expect(changed.columns.map(column => column.id)).toEqual(['b', 'a'])
  expect(changed.rows[0]!.cells.a).toEqual(original.rows[0]!.cells.a)
  expect(original.rows).toHaveLength(1)
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces.find(surface => surface.type === 'flow')!
  surface.blocks.push({ id: 'section', type: 'section', title: { inlines: [{ type: 'text', text: '正文' }] }, collapsedByDefault: false, blocks: [] })
  const inserted = insertFlowEditorBlock(project, { surfaceId: surface.id, parentId: 'section', index: 0, block: changed })
  expect(inserted.ok).toBe(true)
  const copied = duplicateFlowEditorBlock(inserted.nextDocument!, { surfaceId: surface.id, parentId: 'section', blockId: changed.id })
  expect(copied.ok).toBe(true)
  const section = copied.nextDocument!.surfaces.find(surface => surface.type === 'flow')!.blocks.at(-1)!
  if (section.type !== 'section' || section.blocks[1]?.type !== 'table') throw new Error('missing copy')
  const copy = section.blocks[1]
  expect(copy.columns[0]!.id).not.toBe(changed.columns[0]!.id)
  expect(copy.rows[0]!.id).not.toBe(changed.rows[0]!.id)
  expect(copy.rows[0]!.cells[copy.columns[1]!.id]).toEqual(original.rows[0]!.cells.a)
  const payload = buildPublishedCourseV2Payload({ project: copied.nextDocument!, assetFiles: {}, components: {} })
  const print = renderFlowPrintBodyHtml(buildFlowPrintPlan(payload.surfaces.find(surface => surface.type === 'flow')!))
  const printDocument = new DOMParser().parseFromString(print, 'text/html')
  expect(printDocument.querySelector('table')?.textContent).toContain('强调文字')
  expect(print).toContain('<table>')
  const docx = unzipSync(buildFlowDocx(payload, surface.id).bytes)
  const xml = strFromU8(docx['word/document.xml']!)
  expect(xml).toContain('<w:tbl>')
  expect(xml).toContain('可编辑表格')
  expect(xml).toContain('强调')
})

it('edits, undoes, duplicates and plays Spatial tables with distinct child identities', async () => {
  const added = addSpatialWorldTableLayer(openSpatialAuthoringSession(createBlankSpatialCourseProject()), { id: 'world-table', x: -25, y: 100 })
  expect(added.ok).toBe(true)
  const session = added.nextSession!
  const item = session.history.present.surfaces.find(surface => surface.type === 'spatial-2d')!.world.layerItems.find(item => item.layerItemId === 'world-table')!
  if (item.kind !== 'native' || item.content.nativeType !== 'table') throw new Error('missing table')
  const table = patchTableCellText(item.content.data, { cellId: item.content.data.rows[0]!.cells[0]!.id, text: '世界表格新内容' })
  const edited = replaceSpatialWorldTable(session, item.layerItemId, table)
  expect(edited.ok).toBe(true)
  expect(edited.nextSession!.history.past.length).toBe(session.history.past.length + 1)
  expect(undoSpatialAuthoring(edited.nextSession!).nextSession!.history.present).toEqual(session.history.present)
  expect(replaceSpatialWorldTable(edited.nextSession!, item.layerItemId, table, { expectedRevision: session.history.present.revision }).ok).toBe(false)
  expect(addSpatialWorldTableLayer(setSpatialEditingScope(session, 'global').nextSession!).ok).toBe(false)
  const duplicate = duplicateSpatialLayers(edited.nextSession!, [item.layerItemId])
  expect(duplicate.ok).toBe(true)
  const copy = duplicate.nextSession!.history.present.surfaces.find(surface => surface.type === 'spatial-2d')!.world.layerItems.at(-1)!
  if (copy.kind !== 'native' || copy.content.nativeType !== 'table') throw new Error('missing copy')
  expect(copy.content.data.rows[0]!.cells[0]!.id).not.toBe(table.rows[0]!.cells[0]!.id)
  expect(copy.content.data.rows[0]!.cells[0]!.text).toBe('世界表格新内容')
  const payload = buildPublishedCourseV2Payload({ project: edited.nextSession!.history.present, assetFiles: {}, components: {} })
  const surface = payload.surfaces.find(surface => surface.type === 'spatial-2d')!
  const staticPage = renderPublishedSpatialFrameSvg(surface, undefined, () => undefined)
  const staticDocument = new DOMParser().parseFromString(staticPage.svg, 'image/svg+xml')
  expect(staticDocument.querySelector('parsererror')).toBeNull()
  expect(staticDocument.querySelector('[data-native-table-id="world-table"]')?.textContent).toContain('世界表格新内容')
  expect(collectPublishedPptxSpatialNotices(surface, () => undefined)).toContainEqual(expect.objectContaining({ layerItemId: 'world-table', severity: 'info' }))
  const host = SpatialSurfaceHost.fromPublishedCourse(payload, { width: 800, height: 450 })
  const container = document.createElement('div')
  try {
    await host.mount(container); await host.activate()
    expect(container.querySelector('[data-native-table-id="world-table"]')?.textContent).toContain('世界表格新内容')
  } finally { await host.destroy() }
})
