// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { componentTextInteractionEdits } from '../../src/core/course/componentTextInteractionEdits'
import { componentDataEdits } from '../../src/core/course/componentDataEdits'
import { captureComponentOperation, applyComponentOperation, presentationComponentEdits } from '../../src/core/drivers/courseV10Operations'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { documentTextRanges, replaceDocumentText, inlineComponentIds, documentRangeAt } from '../../src/shared/document/textInteraction'
import { plainDocumentText, sliceDocumentText } from '../../src/shared/document/content'
import { createFlowDocumentResourcePort, prepareFlowDocumentResourceTransaction } from '../../src/renderer/document/flowDocumentResources'
import { prepareDocumentClipboard } from '../../src/renderer/document/documentClipboard'
import { emptyDocumentResources } from '../../src/shared/document/resources'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { TABLE_DEFINITION } from '../../src/components/table/adapters'
import { createTableData, parseTableData } from '../../src/components/table/data'
import { DOCUMENT_BLOCK_DEFINITION } from '../../src/components/document-block'
import { resolveComponentPresentation, owningContainer, type ComponentEdit, type CourseProjectV10 } from '../../src/shared/contracts/component-platform'

function course() {
  const project = createBlankCourseProjectV10('范围注释与行内填空')
  project.surfaces[0].kind = 'flow'; project.surfaces[0].childIds = ['body']
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData({ inlines: [{ type: 'text', text: '😀观察' }, { type: 'text', text: '电流方向', style: { bold: true } }, { type: 'math', formulaId: 'math', latex: 'I', accessibleText: 'I' }, { type: 'text', text: '，填写答案。', link: { href: 'https://example.com' } }] }))) }
  return project
}
const apply = (project: CourseProjectV10, edits: ComponentEdit[]) => applyComponentOperation(project, captureComponentOperation(project, edits))
const body = (project: CourseProjectV10) => textComponentDataSchema.parse(project.instances.body.data).content

it('commits range and inline ownership with body, maps edits and full deletion in History, saves and cold opens', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-range-'))
  const host = new DocumentHostService(path.join(directory, 'state'))
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project: course(), resources: { assets: {}, components: {} } }, 'range.glx')
  const read = async () => { const current = await host.internalAPI.read(snapshot.documentId); if (current.model.kind !== 'course-v10') throw new Error('Expected V10'); return { current, project: current.model.project } }
  const commit = async (edits: ComponentEdit[]) => { const { current, project } = await read(); const result = await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: randomUUID(), mutation: { type: 'command', command: captureComponentOperation(project, edits) } }); if (result.status !== 'applied') throw new Error(JSON.stringify(result)) }
  try {
    let { project } = await read()
    const note = componentTextInteractionEdits(project, { surfaceId: project.surfaces[0].id, instanceId: 'body', dataPath: ['content'], from: 3, to: 7 }, { kind: 'annotation', content: '电流从正极经过电路流向负极。' })
    await commit(note.edits)
    let state = await read(); expect(state.current.undoDepth).toBe(1); project = state.project
    const answer = componentTextInteractionEdits(project, { surfaceId: project.surfaces[0].id, instanceId: 'body', dataPath: ['content'], from: 9, to: 13 }, { kind: 'input', label: '电流方向', acceptedAnswers: ['正极到负极'] })
    await commit(answer.edits)
    project = (await read()).project
    expect(inlineComponentIds(body(project))).toEqual([answer.instanceId]); expect(owningContainer(project, answer.instanceId)).toEqual({ kind: 'instance', instanceId: 'body' })
    const next = replaceDocumentText(replaceDocumentText(body(project), 0, 0, { inlines: [{ type: 'text', text: '请' }] }), 5, 5, { inlines: [{ type: 'text', text: '实际' }] })
    await commit(componentDataEdits(project, { surfaceId: project.surfaces[0].id, instanceId: 'body' }, { kind: 'patch', data: { content: JSON.parse(JSON.stringify(next)) } }))
    project = (await read()).project
    const rangeId = note.target.kind === 'text-range' ? note.target.rangeId : ''
    expect(documentTextRanges(body(project)).get(rangeId)).toEqual({ from: 4, to: 10 })
    const selected = documentTextRanges(body(project)).get(rangeId)!
    const erased = replaceDocumentText(body(project), selected.from, selected.to, { inlines: [] })
    await commit(componentDataEdits(project, { surfaceId: project.surfaces[0].id, instanceId: 'body' }, { kind: 'patch', data: { content: JSON.parse(JSON.stringify(erased)) } }))
    state = await read(); expect(state.project.instances[note.instanceId]).toBeUndefined()
    await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: state.current.epoch, baseRevision: state.current.revision, actor: 'human', operationId: randomUUID(), mutation: { type: 'undo' } })
    project = (await read()).project
    expect(project.instances[note.instanceId]).toBeDefined(); expect(documentTextRanges(body(project)).get(rangeId)).toEqual(selected)
    const filename = path.join(directory, 'range.glx'); await host.internalAPI.save(snapshot.documentId, filename)
    await fs.mkdir('output/repair-flow-range/fixtures', { recursive: true }); await fs.copyFile(filename, 'output/repair-flow-range/fixtures/range-inline.glx')
    const cold = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
    expect(cold.model.kind).toBe('course-v10')
    if (cold.model.kind === 'course-v10') { expect(body(cold.model.project)).toEqual(body(project)); expect(cold.model.project.instances[note.instanceId].attachments?.[0].target).toEqual(note.target); expect(cold.model.project.instances[answer.instanceId]).toBeDefined() }
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})

it('partially copies annotated text and an inline child into its actual paragraph using the existing clone and resource transaction', async () => {
  let project = course(), surfaceId = project.surfaces[0].id
  const note = componentTextInteractionEdits(project, { surfaceId, instanceId: 'body', dataPath: ['content'], from: 3, to: 7 }, { kind: 'annotation', content: '注释' }); project = apply(project, note.edits)
  const answer = componentTextInteractionEdits(project, { surfaceId, instanceId: 'body', dataPath: ['content'], from: 7, to: 7 }, { kind: 'input', acceptedAnswers: ['答案'] }); project = apply(project, answer.edits)
  project.instances.destination = { id: 'destination', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('粘贴：'))) }; project.surfaces[0].childIds.push('destination')
  const target = { documentId: 'document', epoch: 'epoch', activation: 1, project, resources: { assets: {}, components: {} }, editingProject: project, activeStateId: null, surfaceId, instanceIds: [], instanceId: null }
  const port = createFlowDocumentResourcePort({ target, source: { documentId: 'document', project, resources: target.resources, roots: ['body'] } })
  const prepared = await prepareDocumentClipboard({ content: { blocks: [{ id: 'body', type: 'paragraph', content: sliceDocumentText(body(project), 3, 8) }] }, resources: emptyDocumentResources() }, emptyDocumentResources(), port)
  const fragment = prepared.document.content.blocks[0]; if (fragment.type !== 'paragraph') throw new Error('Expected paragraph')
  const blocks = projectFlowDocument(project, surfaceId).content.blocks
  const destination = blocks.find(block => block.id === 'destination'); if (destination?.type !== 'paragraph') throw new Error('Expected destination')
  destination.content.inlines.push(...fragment.content.inlines)
  const plan = prepareFlowDocumentResourceTransaction(target, surfaceId, blocks, [prepared.prepared]); project = apply(project, plan.edits)
  const data = textComponentDataSchema.parse(project.instances.destination.data), inlineId = inlineComponentIds(data.content)[0]
  expect(inlineId).not.toBe(answer.instanceId); expect(owningContainer(project, inlineId)).toEqual({ kind: 'instance', instanceId: 'destination' })
  const copiedNote = Object.values(project.instances).find(instance => instance.id !== note.instanceId && instance.attachments?.some(attachment => attachment.target.kind === 'text-range' && attachment.target.instanceId === 'destination'))!
  expect(copiedNote).toBeDefined()
  const reference = copiedNote.attachments![0].target; if (reference.kind !== 'text-range') throw new Error('Expected range')
  expect(documentTextRanges(data.content).has(reference.rangeId)).toBe(true); expect(reference.rangeId).not.toBe(note.target.kind === 'text-range' ? note.target.rangeId : '')
  expect(plainDocumentText(body(project))).toContain('电流方向')
})


it('moves table/list slot attachments by authored identity and cleans replaced ranges and inline children once', () => {
  let project = course(), surfaceId = project.surfaces[0].id
  const table = createTableData({ rows: 2, columns: 1 })
  const {text: _text, ...cell} = table.rows[0].cells[0]
  table.rows[0].cells[0] = { ...cell, content: { inlines: [{ type: 'text', text: '甲甲甲' }] } }
  project.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: JSON.parse(JSON.stringify(table)) }
  project.instances.list = { id: 'list', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: { type: 'list', ordered: false, items: [{ id: 'first', content: { inlines: [{ type: 'text', text: '第一项' }] } }, { id: 'second', content: { inlines: [{ type: 'text', text: '第二项' }] } }] } }
  project.surfaces[0].childIds.push('table', 'list')
  const tablePath = ['rows','0','cells','0','content'], listPath = ['items','0','content']
  const note = componentTextInteractionEdits(project, { surfaceId, instanceId: 'table', dataPath: tablePath, from: 0, to: 1 }, { kind: 'annotation', content: '首字' }); project = apply(project, note.edits)
  const answer = componentTextInteractionEdits(project, { surfaceId, instanceId: 'table', dataPath: tablePath, from: 3, to: 3 }, { kind: 'input', acceptedAnswers: ['甲'] }); project = apply(project, answer.edits)
  const listNote = componentTextInteractionEdits(project, { surfaceId, instanceId: 'list', dataPath: listPath, from: 0, to: 2 }, { kind: 'annotation', content: '第一项注释' }); project = apply(project, listNote.edits)
  const reordered = parseTableData(project.instances.table.data); reordered.rows.reverse()
  project = apply(project, componentDataEdits(project, { surfaceId, instanceId: 'table' }, { kind: 'replace', data: JSON.parse(JSON.stringify(reordered)) }))
  expect(project.instances[note.instanceId].attachments?.[0].target).toMatchObject({ dataPath: ['rows','1','cells','0','content'] })
  expect(project.instances.table.childIds?.filter(id => id === answer.instanceId)).toHaveLength(1)
  const list = structuredClone(project.instances.list.data) as {items:Array<{id:string}>}; list.items.reverse()
  project = apply(project, componentDataEdits(project, { surfaceId, instanceId: 'list' }, { kind: 'replace', data: JSON.parse(JSON.stringify(list)) }))
  expect(project.instances[listNote.instanceId].attachments?.[0].target).toMatchObject({ dataPath: ['items','1','content'] })
  const replacement = componentTextInteractionEdits(project, { surfaceId, instanceId: 'table', dataPath: ['rows','1','cells','0','content'], from: 0, to: 1 }, { kind: 'input', acceptedAnswers: ['乙'] })
  project = apply(project, replacement.edits)
  expect(project.instances[note.instanceId].attachments?.[0].target).toMatchObject({ dataPath: ['rows','1','cells','0','content'] })
  const replaceAtom = componentTextInteractionEdits(project, { surfaceId, instanceId: 'table', dataPath: ['rows','1','cells','0','content'], from: 3, to: 4 }, { kind: 'input', acceptedAnswers: ['丙'] })
  expect(replaceAtom.edits.filter(edit => edit.type === 'instance.remove' && edit.instanceId === answer.instanceId)).toHaveLength(1)
  project = apply(project, replaceAtom.edits); expect(project.instances[answer.instanceId]).toBeUndefined()
  const clear = componentDataEdits(project, { surfaceId, instanceId: 'table' }, { kind: 'fields', fields: [{ path: ['rows','1','cells','0','content'], value: { inlines: [] } }] })
  expect(clear.filter(edit => edit.type === 'instance.remove' && edit.instanceId === replacement.instanceId)).toHaveLength(1)
  project = apply(project, clear)
  expect(project.instances[note.instanceId]).toBeUndefined(); expect(project.instances[replacement.instanceId]).toBeUndefined(); expect(project.instances[replaceAtom.instanceId]).toBeUndefined()
})


it('keeps other formal body versions when a presentation state deletes its ranges and inline atom', () => {
  let project = course(), surfaceId = project.surfaces[0].id
  const note = componentTextInteractionEdits(project, { surfaceId, instanceId: 'body', dataPath: ['content'], from: 3, to: 7 }, { kind: 'annotation', content: '基态注释' }); project = apply(project, note.edits)
  const answer = componentTextInteractionEdits(project, { surfaceId, instanceId: 'body', dataPath: ['content'], from: 7, to: 7 }, { kind: 'input', acceptedAnswers: ['答案'] }); project = apply(project, answer.edits)
  project.surfaces[0].kind = 'slide'; project.surfaces[0].presentation = { states: [{ id: 'empty-state', title: '当前展示', overrides: {} }] }
  const old = body(project)
  const edits = componentDataEdits(project, { surfaceId, stateId: 'empty-state', instanceId: 'body' }, { kind: 'fields', fields: [{ path: ['content'], value: { inlines: [] } }] })
  const changed = apply(project, presentationComponentEdits(project, surfaceId, 'empty-state', edits))
  expect(changed.instances[answer.instanceId]).toBeDefined(); expect(changed.instances[note.instanceId]).toBeDefined()
  expect(body(changed)).toEqual(old); expect(body(resolveComponentPresentation(changed, surfaceId, 'empty-state'))).toEqual({ inlines: [] })
  project = changed
  const selection = { surfaceId, stateId: 'empty-state', instanceId: 'body', dataPath: ['content'] }
  const stateInput = componentTextInteractionEdits(project, { ...selection, from: 0, to: 0 }, { kind: 'input', acceptedAnswers: ['仅当前状态'] })
  project = apply(project, presentationComponentEdits(project, surfaceId, 'empty-state', stateInput.edits))
  const stateNote = componentTextInteractionEdits(project, { ...selection, from: 0, to: 1 }, { kind: 'annotation', content: '仅当前状态注释' })
  project = apply(project, presentationComponentEdits(project, surfaceId, 'empty-state', stateNote.edits))
  expect(project.instances[stateInput.instanceId].visible).toBe(false)
  expect(resolveComponentPresentation(project, surfaceId, 'empty-state').instances[stateInput.instanceId].visible).toBe(true)
  // Professional projection planners can start with the current effective project.
  const effective = resolveComponentPresentation(project, surfaceId, 'empty-state')
  const erase = componentDataEdits(effective, { surfaceId, instanceId: 'body' }, { kind: 'fields', fields: [{ path: ['content'], value: { inlines: [] } }] })
  project = apply(project, presentationComponentEdits(project, surfaceId, 'empty-state', erase))
  expect(project.instances[stateInput.instanceId]).toBeUndefined(); expect(project.instances[stateNote.instanceId]).toBeUndefined()
  expect(project.surfaces[0].presentation?.states[0].overrides[stateInput.instanceId]).toBeUndefined()
  expect(project.instances[answer.instanceId]).toBeDefined(); expect(project.instances[note.instanceId]).toBeDefined(); expect(body(project)).toEqual(old)
  project.definitions[DOCUMENT_BLOCK_DEFINITION.id] = DOCUMENT_BLOCK_DEFINITION
  project.instances.list = { id: 'list', definitionId: DOCUMENT_BLOCK_DEFINITION.id, data: { type: 'list', ordered: false, items: [{ id: 'first', content: { inlines: [{ type: 'text', text: '第一项' }] } }, { id: 'second', content: { inlines: [{ type: 'text', text: '第二项' }] } }] } }
  project.surfaces[0].childIds.push('list')
  const listNote = componentTextInteractionEdits(project, { surfaceId, instanceId: 'list', dataPath: ['items','0','content'], from: 0, to: 2 }, { kind: 'annotation', content: '基础第一项' }); project = apply(project, listNote.edits)
  const list = structuredClone(project.instances.list.data) as {items:Array<{id:string}>}; list.items.reverse()
  const reorder = componentDataEdits(project, { surfaceId, stateId: 'empty-state', instanceId: 'list' }, { kind: 'replace', data: JSON.parse(JSON.stringify(list)) })
  project = apply(project, presentationComponentEdits(project, surfaceId, 'empty-state', reorder))
  const reference = project.instances[listNote.instanceId].attachments![0].target
  if (reference.kind !== 'text-range') throw new Error('Expected text range')
  expect(reference.dataPath).toEqual(['items','1','content'])
  expect(documentRangeAt(project.instances.list.data, reference.dataPath, reference.rangeId)?.path).toEqual(['items','0','content'])
  expect(documentRangeAt(resolveComponentPresentation(project,surfaceId,'empty-state').instances.list.data, reference.dataPath, reference.rangeId)?.path).toEqual(['items','1','content'])
})
