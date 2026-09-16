import { expect, it } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createChartNode, createFormulaNode } from '@/renderer/project/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'
import { selectFlowEditorBlocks, selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import { createChartTextDraft } from '@/renderer/authoring/chartTextDraft'
import { beginFlowTextEdit, beginFlowTableFieldEdit, beginFlowFormulaEdit, beginFlowChartTextEdit, commitFlowTextEdit, formatFlowAuthoringTextStyle, markFlowTextComposing, updateFlowTextDraft, updateFlowChartTextDraft, FLOW_TEXT_REJECT_SHARED_DOCUMENT, type FlowFormulaDraft } from '@/renderer/authoring/flowTextEdit'

function fixture() {
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const chartItem = sceneNodeToCourseLayerItem(createChartNode({ id: 'chart' }), 0)
  if (chartItem.kind !== 'native' || chartItem.content.nativeType !== 'chart') throw new Error('chart fixture')
  project.surfaces = [{ id: 'flow', type: 'flow', title: '正文', layout: { readingWidth: 760, wideContentWidth: 1120 }, surfaceLayerItems: [{ item: sceneNodeToCourseLayerItem(createFormulaNode({ id: 'overlay' }), 0), visibility: { mode: 'all', locationIds: [] } }], blocks: [
    { id: 'heading', type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: '正文' }] } },
    { id: 'paragraph', type: 'paragraph', content: { inlines: [{ type: 'text', text: '春风' }] } },
    { id: 'formula', type: 'formula', formulaId: 'body-math', latex: 'x+1', accessibleText: 'x加一' },
    { id: 'chart', type: 'chart', chart: chartItem.content.data, height: 400 },
  ] }]
  project.locations = []; syncFlowCourseLocations(project, 'flow'); project.startLocationId = project.locations[0].id
  return courseProjectDocumentSchema.parse(project)
}

it('rejects retired body text and AST sessions without changing the project', () => {
  const project = fixture(), original = structuredClone(project)
  const selection = selectFlowEditorBlocks(project, project.startLocationId, ['paragraph'])
  expect(beginFlowTextEdit({ project, selection, blockId: 'paragraph' })).toEqual({ ok: false, reason: FLOW_TEXT_REJECT_SHARED_DOCUMENT })
  expect(beginFlowFormulaEdit({ project, selection, blockId: 'formula' }).ok).toBe(false)
  expect(beginFlowTableFieldEdit({ project, selection, blockId: 'paragraph', field: 'table-caption' }).ok).toBe(false)
  expect(project).toEqual(original)
})

it('formats canonical inline content through the shared Flow command', () => {
  const project = fixture(), selection = selectFlowEditorBlocks(project, project.startLocationId, ['paragraph'])
  const result = formatFlowAuthoringTextStyle({ document: project, selection, style: { bold: true, color: '#123456' }, range: { start: 0, end: 1 } })
  expect(result.ok).toBe(true)
  const surface = result.nextDocument!.surfaces[0]
  if (surface.type !== 'flow') throw new Error('flow fixture')
  const paragraph = surface.blocks[1]
  if (paragraph.type !== 'paragraph') throw new Error('paragraph fixture')
  expect(paragraph.content.inlines).toEqual([{ type: 'text', text: '春', style: { bold: true, color: '#123456' } }, { type: 'text', text: '风' }])
  expect('text' in paragraph).toBe(false)
})

it('retains Native overlay formula drafts, IME rejection, stale rejection and canonical commit', () => {
  const project = fixture(), selection = selectFlowOverlay(project, project.startLocationId, ['overlay'])
  const begun = beginFlowFormulaEdit({ project, selection, blockId: 'overlay' })
  if (!begun.ok) throw new Error(begun.reason)
  const draft: FlowFormulaDraft = { ast: { type: 'token', value: 'z' }, accessibleText: 'z', source: 'z', valid: true, hasSlots: false }
  const edit = updateFlowTextDraft(begun.edit, draft)
  expect(commitFlowTextEdit(project, selection, markFlowTextComposing(edit, true)).ok).toBe(false)
  expect(commitFlowTextEdit({ ...project, revision: project.revision + 1 }, selection, edit).ok).toBe(false)
  const result = commitFlowTextEdit(project, selection, edit)
  expect(result.ok).toBe(true)
  const layer = result.nextDocument!.surfaces[0].surfaceLayerItems[0].item
  if (layer.kind !== 'native' || layer.content.nativeType !== 'formula') throw new Error('overlay fixture')
  expect(layer.content.data.ast).toEqual(draft.ast)
  expect(result.nextEdit).toBeNull()
})

it('retains Flow chart text editing and rejects invalid chart drafts', () => {
  const project = fixture(), selection = selectFlowEditorBlocks(project, project.startLocationId, ['chart'])
  const begun = beginFlowChartTextEdit({ project, selection, blockId: 'chart', field: { kind: 'title' } })
  if (!begun.ok) throw new Error(begun.reason)
  const surface = project.surfaces[0]
  if (surface.type !== 'flow' || surface.blocks[3].type !== 'chart') throw new Error('chart fixture')
  const draft = createChartTextDraft(surface.blocks[3].chart, { kind: 'title' }, '新标题')
  expect(commitFlowTextEdit(project, selection, updateFlowChartTextDraft(begun.edit, { ...draft, error: '无效' }, false)).ok).toBe(false)
  const result = commitFlowTextEdit(project, selection, updateFlowChartTextDraft(begun.edit, draft, false))
  expect(result.ok).toBe(true)
  const next = result.nextDocument!.surfaces[0]
  if (next.type !== 'flow' || next.blocks[3].type !== 'chart') throw new Error('chart fixture')
  expect(next.blocks[3].chart.title).toBe('新标题')
})
