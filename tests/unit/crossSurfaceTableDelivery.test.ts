import { expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { createBlankSpatialCourseProject } from '@/renderer/project/createSpatialCourseProject'
import { addSpatialWorldTableLayer, replaceSpatialWorldTable, openSpatialAuthoringSession, undoSpatialAuthoring, setSpatialEditingScope } from '@/renderer/course/spatialEditorCommands'
import { duplicateSpatialLayers } from '@/renderer/course/spatialClipboardCommands'
import { insertFlowEditorBlock, duplicateFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { changeFlowTableStructure } from '@/renderer/course/flowTableContentOperations'
import { patchTableCellText } from '@/renderer/course/tableContentOperations'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { SpatialSurfaceHost } from '@/player/surfaces/spatial/SpatialSurfaceHost'
import { renderPublishedSpatialFrameSvg } from '@/player/surfaces/spatial/publishedSpatialStaticRendering'
import { collectPublishedPptxSpatialNotices } from '@/renderer/export/course/buildCoursePptx'
import type { FlowTableBlock } from '@/shared/courseProjectTypes'

it('preserves rich cells through Flow structure edits, identity duplication, Published and editable DOCX', () => {
  const original: FlowTableBlock = { id: 'table', type: 'table', caption: '可编辑表格', columns: [{ id: 'a', header: '甲' }, { id: 'b', header: '乙' }], rows: [{ id: 'row', cells: { a: { text: '强调文字', runs: [{ start: 0, end: 2, style: { bold: true } }] }, b: '另一列' } }] }
  const changed = changeFlowTableStructure(changeFlowTableStructure(original, { kind: 'insert-row' }), { kind: 'move-column', id: 'b', direction: -1 })
  expect(changed.columns.map(column => column.id)).toEqual(['b', 'a'])
  expect(changed.rows[0]!.cells.a).toEqual(original.rows[0]!.cells.a)
  expect(original.rows).toHaveLength(1)
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces.find(surface => surface.type === 'flow')!
  surface.blocks.push({ id: 'section', type: 'section', title: '正文', collapsedByDefault: false, blocks: [] })
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
