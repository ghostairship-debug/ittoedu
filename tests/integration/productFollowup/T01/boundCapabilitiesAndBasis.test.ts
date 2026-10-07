// @vitest-environment jsdom
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TextSelection } from 'prosemirror-state'
import { afterEach, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData, createFormulaComponentData, type TextComponentData } from '../../../../src/components/text/data'
import { SelectionContextController, captureFlowSelection, selectionReference, type ContextualEditRequest } from '../../../../src/renderer/workbench/SelectionContextController'
import { SharedDocumentEditor } from '../../../../src/renderer/document/SharedDocumentEditor'
import * as editorSession from '../../../../src/renderer/document/editorSession'
import { projectFlowDocument } from '../../../../src/core/components/document/flowDocumentProjection'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../../../src/main/workbench/execution/EditSessionService'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'
import type { DocumentSnapshot } from '../../../../src/shared/workbench/document'
import { CHART_DEFINITION, createChartData, type ChartData } from '../../../../src/components/chart'
import { TABLE_DEFINITION } from '../../../../src/components/table/adapters'
import { createTableData, type TableData } from '../../../../src/components/table/data'
import { captureComponentOperation } from '../../../../src/core/drivers/courseV10Operations'

const roots: string[] = []
afterEach(async () => { cleanup(); vi.restoreAllMocks(); for (const directory of roots.splice(0)) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) })
const selection: ModelSelection = { model: 'controlled', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function finish(request: ModelRequest, content: string, tool?: { name: string; args: unknown } | Array<{ name: string; args: unknown }>): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = (tool ? Array.isArray(tool) ? tool : [tool] : []).map((value, index) => ({ id: `provider-${request.requestId}-${index}`, name: value.name, argumentsText: JSON.stringify(value.args) }))
  return { type: 'response.completed', requestId: request.requestId, sequence: 10, responseId: request.requestId, actualModel: 'controlled', nativeResponse: {},
    finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content,
      ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
function offered(request: ModelRequest, name: string) {
  const tool = request.tools?.find(value => value.name === name)
  expect(tool, `Actual model catalog must offer ${name}`).toBeTruthy()
  return tool!.name
}
function lastTool(request: ModelRequest): any {
  const message = request.messages.filter(value => value.role === 'tool').at(-1)
  expect(typeof message?.content).toBe('string')
  return JSON.parse(message!.content as string)
}
async function fixture(provider: ModelProvider, rich = true, basis = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-bound-basis-')); roots.push(directory)
  const host = new DocumentHostService(path.join(directory, 'documents')), project = createBlankCourseProjectV10('教师正文卡')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const data = createTextComponentData({ inlines: rich ? [
    { type: 'text', text: '原说明', link: { href: 'https://example.org/source' }, style: { bold: true } },
    createFormulaComponentData('kept-formula', 'x^2').formula,
  ] : [{ type: 'text', text: '简单原稿' }] })
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data }
  project.surfaces.push({ id: 'flow', kind: 'flow', title: '讲义', childIds: ['body'] })
  if (basis) {
    project.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
    project.definitions[CHART_DEFINITION.id] = CHART_DEFINITION
    const table = createTableData({ rows: 2, columns: 1 }); table.rows[0].cells[0].text = '2'; table.rows[1].cells[0].text = '5'
    const frame = { width: 300, height: 150, transform: [1, 0, 0, 1, 45, 70] as [number, number, number, number, number, number] }
    project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: table, frame }
    project.instances.chart = { id: 'chart', definitionId: CHART_DEFINITION.id, data: createChartData(), frame: { ...frame, transform: [1, 0, 0, 1, 390, 70] } }
    project.surfaces[0].childIds = ['table', 'chart']
  }
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'card.h5lesson')
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: host.agentFiles, edits: new EditSessionService(host.registry, host.tools), runs: new ExecutionRunStore(path.join(directory, 'runs')),
    events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  return { directory, host, project, snapshot, engine, data }
}

/** Click the real editor AI form, then use its actual selection preparation owner. No tool handler is substituted. */
async function card(h: Awaited<ReturnType<typeof fixture>>, instruction: string) {
  const controller = new SelectionContextController(id => h.host.internalAPI.read(id))
  let requested: ContextualEditRequest | undefined, started: ReturnType<ExecutionEngine['start']> | undefined
  controller.onRequest(request => {
    requested = request
    started = h.engine.start({ conversationId: 'card', taskId: 'rewrite', instruction: request.instruction, selection,
      documents: [selectionReference(request.selection, true)], contentOutput: request.contentOutput, workspaceRoot: h.directory, permission: 'workspace' })
  })
  const factory = vi.spyOn(editorSession, 'createLayoutEditor')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 900, bottom: 700, width: 900, height: 700, x: 0, y: 0, toJSON() {} })
  const document = projectFlowDocument(h.project, 'flow')
  render(createElement(SharedDocumentEditor, { document, revision: String(h.snapshot.revision), initialMode: 'layout', target: 'project',
    onChange: () => true, onDraft() {}, onUndo() {}, onRedo() {}, onContextualCommand: async (text, target) => {
      const snapshot = await controller.prepare(h.snapshot.documentId)
      await controller.request(captureFlowSelection(snapshot, 'flow', target), text, true)
    } }))
  const editor = factory.mock.results.at(-1)!.value as ReturnType<typeof editorSession.createLayoutEditor>
  const paragraph = editor.view.state.doc.firstChild!
  act(() => { editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, 1, paragraph.nodeSize - 1))) })
  fireEvent.click(screen.getByRole('button', { name: 'AI 修改' }))
  fireEvent.change(screen.getByLabelText('AI 修改要求'), { target: { value: instruction } })
  await act(async () => { fireEvent.submit(screen.getByLabelText('AI 修改要求').closest('form')!) })
  expect(started).toBeTruthy()
  const result = await started!
  if (!requested?.contentOutput) await h.engine.wait(result.runId)
  expect(requested?.contentOutput, 'The real rich editor card must retain its bound content output').toBeTruthy()
  return { requested: requested!, started: result }
}

it('a simple card rewrite explicitly applies and finishes in one real tool-call response without another model round', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    turns++; yield finish(request, '', [{ name: offered(request, 'text.replace'), args: { content: '简单修订正文' } }, { name: offered(request, 'task.finish'), args: {} }])
  } }, false)
  const sent = await card(h, '将所选正文改写得简洁')
  const ended = await h.engine.wait(sent.started.runId)
  expect(ended.status).toBe('completed')
  expect(turns).toBe(1)
  expect(ended.tools.map(value => value.call.name)).toEqual(['text.replace', 'task.finish'])
  expect(ended.tools[0]).toMatchObject({ call: { name: 'text.replace', input: { content: '简单修订正文' } }, result: { kind: 'document-operation', result: { status: 'applied' } } })
  expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: { data: { content: { inlines: [{ type: 'text', text: '简单修订正文' }] } } } } } } })
})

it('ordinary assistant explanation from the actual bound card has no implicit body write', async () => {
  const h = await fixture({ async *stream(request) {
    yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '正在解释当前公式。' }
    yield finish(request, '平方公式的解释，仅供讨论，没有申请正文修改。')
  } })
  const sent = await card(h, '解释当前文字和公式，不修改正文。')
  const ended = await h.engine.wait(sent.started.runId)
  expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
  expect(ended.tools).toEqual([])
  expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ revision: 0, undoDepth: 0, model: { project: { instances: { body: { data: h.data } } } } })
})

it('the actual rich card reads teacher material in the same task, keeps dialogue out of the body, and applies explicit content without model-owned targets', async () => {
  let turns = 0, h!: Awaited<ReturnType<typeof fixture>>
  h = await fixture({ async *stream(request) {
    if (++turns === 1) {
      expect(JSON.stringify(request.messages)).toContain('https://example.org/source')
      yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '正在读取资料，不是正文。' }
      expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ undoDepth: 0 })
      yield finish(request, '读取资料', { name: offered(request, 'file.read'), args: { path: '资料.md' } }); return
    }
    if (turns === 2) {
      expect(JSON.stringify(lastTool(request))).toContain('资料中的定论：平方关系')
      expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ undoDepth: 0 })
      yield finish(request, '根据资料改写', { name: offered(request, 'text.replace'), args: { content: '<a href="https://example.org/source"><strong>平方关系说明</strong></a>\\(x^2\\)' } }); return
    }
    expect(lastTool(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    yield finish(request, '修改已应用。这句话是结果说明，不应再替换正文。')
  } })
  await fs.writeFile(path.join(h.directory, '资料.md'), '资料中的定论：平方关系')
  const sent = await card(h, '按资料.md改写所选文字，保留链接与公式。')
  const ended = await h.engine.wait(sent.started.runId)
  expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
  expect(ended.tools.map(value => value.call.name)).toEqual(['file.read', 'text.replace'])
  const current = await h.host.internalAPI.read(h.snapshot.documentId)
  expect(current.undoDepth).toBe(1)
  if (current.model.kind !== 'course-v10') throw new Error('V10 required')
  const inlines = (current.model.project.instances.body.data as TextComponentData).content.inlines
  expect(inlines).toContainEqual({ type: 'text', text: '平方关系说明', style: { bold: true }, link: { href: 'https://example.org/source' } })
  expect(inlines.find(value => value.type === 'math')?.formulaId).toBe('kept-formula')
  expect(inlines.some(value => value.type === 'text' && value.text.includes('结果说明'))).toBe(false)
})

it('a card query with a real read tool returns progress and explanation without any body transaction', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) { yield finish(request, '查看资料', { name: offered(request, 'file.read'), args: { path: '资料.md' } }); return }
    expect(JSON.stringify(lastTool(request))).toContain('只做解释')
    yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '已经读取，正在解释。' }
    yield finish(request, '这是查询结果与公式解释，正文没有改动。')
  } })
  await fs.writeFile(path.join(h.directory, '资料.md'), '只做解释')
  const sent = await card(h, '读资料.md，解释当前公式；不要修改正文。')
  const ended = await h.engine.wait(sent.started.runId)
  expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
  expect(ended.tools.map(value => value.call.name)).toEqual(['file.read'])
  expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ revision: 0, undoDepth: 0, model: { project: { instances: { body: { data: h.data } } } } })
})

it('a failed bound application returns current facts and is repaired in the same task without replaying the rejected content', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) { yield finish(request, '', [
      { name: offered(request, 'text.replace'), args: { content: '<table><tr><td>此正文无法承载表格</td></tr></table>' } },
      { name: offered(request, 'task.finish'), args: {} },
    ]); return }
    if (turns === 2) {
      expect(lastTool(request).kind).toBe('error')
      expect(JSON.stringify(request.messages)).toContain('https://example.org/source')
      yield finish(request, '', [
        { name: offered(request, 'text.replace'), args: { content: '<a href="https://example.org/source"><strong>修正后的说明</strong></a>\\(x^2\\)' } },
        { name: offered(request, 'task.finish'), args: {} },
      ]); return
    }
    yield finish(request, '已修正并应用。')
  } })
  const sent = await card(h, '改写正文；如果目标不支持返回的内容，请在本任务内修正。')
  const ended = await h.engine.wait(sent.started.runId)
  expect(ended.status).toBe('completed')
  expect(ended.tools.filter(value => value.result?.kind === 'document-operation')).toHaveLength(1)
  expect(ended.tools.filter(value => value.result?.kind === 'error')).toHaveLength(2)
  expect(turns).toBe(2)
  expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ undoDepth: 1 })
})

it('a complex bound task continues after its first successful write when the actual tool response does not request task.finish', async () => {
  let turns = 0
  const h = await fixture({ async *stream(request) {
    if (++turns === 1) { yield finish(request, '先修改正文，任务还有读取资料。', { name: offered(request, 'text.replace'), args: { content: '已经正式修改的正文' } }); return }
    if (turns === 2) {
      expect(lastTool(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      yield finish(request, '继续读取资料', { name: offered(request, 'file.read'), args: { path: '资料.md' } }); return
    }
    expect(JSON.stringify(lastTool(request))).toContain('继续任务的依据')
    yield finish(request, '已完成后续读取与说明。')
  } }, false)
  await fs.writeFile(path.join(h.directory, '资料.md'), '继续任务的依据')
  const sent = await card(h, '先改写所选正文，再读资料.md解释下一步。')
  const ended = await h.engine.wait(sent.started.runId)
  expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
  expect(turns).toBe(3)
  expect(ended.tools.map(value => value.call.name)).toEqual(['text.replace', 'file.read'])
  expect(await h.host.internalAPI.read(h.snapshot.documentId)).toMatchObject({ undoDepth: 1, model: { project: { instances: { body: { data: { content: { inlines: [{ type: 'text', text: '已经正式修改的正文' }] } } } } } } })
})

it.each(['table-data', 'unrelated-layout'] as const)('a chart derived from an actual table read handles intervening %s on the correct basis', async change => {
  let release!: () => void, reached!: () => void
  const delayed = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { reached = resolve })
  let tablePath = '', chartPath = '', values: number[] = [], chart!: ChartData, turns = 0, h!: Awaited<ReturnType<typeof fixture>>
  const derive = () => ({ ...chart, series: chart.series.map(series => ({ ...series, points: series.points.map((point, index) => ({ ...point, value: values[index] })) })) })
  h = await fixture({ async *stream(request) {
    turns++
    if (turns === 1) { yield finish(request, '', { name: offered(request, 'project.list'), args: {} }); return }
    if (turns === 2) {
      const files = lastTool(request).data.files as Array<{ path: string }>
      tablePath = files.find(value => /表格.*\.data\.json$/.test(value.path))!.path
      chartPath = files.find(value => /图表.*\.data\.json$/.test(value.path))!.path
      yield finish(request, '', { name: offered(request, 'project.read'), args: { path: tablePath } }); return
    }
    if (turns === 3) {
      const table = JSON.parse(lastTool(request).data.content) as TableData
      values = table.rows.map(row => Number(row.cells[0].text))
      yield finish(request, '', { name: offered(request, 'project.read'), args: { path: chartPath } }); return
    }
    if (turns === 4) {
      chart = JSON.parse(lastTool(request).data.content)
      reached(); await delayed
      yield finish(request, '依据已读取表格更新图表', { name: offered(request, 'object.update'), args: { path: chartPath, properties: { data: derive() } } }); return
    }
    if (turns === 5 && change === 'table-data') {
      const failed = lastTool(request)
      expect(failed).toMatchObject({ kind: 'error', code: 'read-basis-changed' })
      expect(failed.data.current).toContainEqual(expect.objectContaining({ exists: true, value: expect.objectContaining({
        rows: [expect.objectContaining({ cells: [expect.objectContaining({ text: '9' })] }), expect.objectContaining({ cells: [expect.objectContaining({ text: '5' })] })],
      }) }))
      const current = await h.host.internalAPI.read(h.snapshot.documentId)
      expect(current).toMatchObject({ model: { project: { instances: { chart: { data: h.project.instances.chart.data } } } } })
      yield finish(request, '重新读取当前表格', { name: offered(request, 'project.read'), args: { path: tablePath } }); return
    }
    if (turns === 6 && change === 'table-data') {
      const table = JSON.parse(lastTool(request).data.content) as TableData
      values = table.rows.map(row => Number(row.cells[0].text))
      yield finish(request, '', { name: offered(request, 'object.update'), args: { path: chartPath, properties: { data: derive() } } }); return
    }
    expect(lastTool(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    yield finish(request, '图表已按当前数据更新。')
  } }, false, true)
  const started = await h.engine.start({ conversationId: 'basis', taskId: 'table-to-chart', instruction: '读取当前表格，根据数值更新旁边已有图表。', selection,
    documents: [{ documentId: h.snapshot.documentId, writable: [{ kind: 'document' }] }], workspaceRoot: h.directory, permission: 'workspace' })
  const ending = h.engine.wait(started.runId)
  try {
    await Promise.race([ready, ending.then(result => { throw new Error(`The provider never reached the pending table-based edit: ${result.failure?.message ?? result.status}`) })])
  const before = await h.host.internalAPI.read(h.snapshot.documentId)
  if (before.model.kind !== 'course-v10') throw new Error('V10 required')
  const moved = { ...before.model.project.instances.table.frame!, transform: [1, 0, 0, 1, 77, 93] as [number, number, number, number, number, number] }
  const edit = change === 'table-data'
    ? { type: 'data.set' as const, instanceId: 'table', path: ['rows', '0', 'cells', '0', 'text'], value: '9' }
    : { type: 'frame.set' as const, instanceId: 'table', frame: moved }
  expect(await h.host.internalAPI.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, actor: 'human', operationId: 'teacher-change',
    mutation: { type: 'command', command: captureComponentOperation(before.model.project, [edit]) } })).toMatchObject({ status: 'applied' })
  release()
  const ended = await ending
  expect(ended.status).toBe('completed')
  const current = await h.host.internalAPI.read(h.snapshot.documentId)
  if (current.model.kind !== 'course-v10') throw new Error('V10 required')
  expect((current.model.project.instances.chart.data as ChartData).series[0].points.map(point => point.value)).toEqual(change === 'table-data' ? [9, 5] : [2, 5])
  expect(current.undoDepth).toBe(2)
  if (change === 'unrelated-layout') expect(current.model.project.instances.table.frame).toEqual(moved)
  } finally { release(); await h.engine.stop(started.runId); await ending }
})
