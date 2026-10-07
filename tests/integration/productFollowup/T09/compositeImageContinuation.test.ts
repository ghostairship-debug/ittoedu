// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../../../src/components/text/adapters'
import { createTextComponentData } from '../../../../src/components/text/data'
import { TABLE_DEFINITION } from '../../../../src/components/table/adapters'
import { createTableData, type TableData } from '../../../../src/components/table/data'
import { CHART_DEFINITION, createChartData, type ChartData } from '../../../../src/components/chart'
import { captureComponentOperation } from '../../../../src/core/drivers/courseV10Operations'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { ImageGenerationService } from '../../../../src/main/workbench/images/ImageGenerationService'
import { imageProvenance } from '../../../../src/main/workbench/images/imageRoute'
import type { ImageModelSelection } from '../../../../src/shared/workbench/images'
import type { ExecutionStart } from '../../../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

function complete(request: ModelRequest, tool?: { name: string; args: unknown }, content = ''): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = tool ? [{ id: `provider-${request.requestId}`, name: tool.name, argumentsText: JSON.stringify(tool.args) }] : []
  return { type: 'response.completed', requestId: request.requestId, sequence: 10, responseId: request.requestId, actualModel: 'controlled', nativeResponse: {},
    finishReason: tool ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content,
      ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
function name(request: ModelRequest, value: string) {
  const actual = request.tools?.find(tool => tool.name === value)
  expect(actual, `The actual provider catalog must offer ${value}`).toBeTruthy()
  return actual!.name
}
function toolData(request: ModelRequest): any {
  const message = request.messages.filter(value => value.role === 'tool').at(-1)
  expect(message?.content).toBeTypeOf('string')
  const result = JSON.parse(message!.content as string)
  expect(result.kind).not.toBe('error')
  return result.kind === 'read' ? result.data : result
}
function fixedReferences(request: ModelRequest): Array<{ writable: Array<{ kind: string; target: string }>; target: string }> {
  const message = request.messages.find(value => value.role === 'system' && typeof value.content === 'string' && value.content.startsWith('本次固定文档与权限'))
  expect(message).toBeTruthy()
  return JSON.parse((message!.content as string).slice((message!.content as string).indexOf('：') + 1))
}
const textSelection: ModelSelection = { model: 'controlled', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
const imageSelection: ImageModelSelection = { imageModel: 'controlled-image', connection: { ...textSelection.connection,
  provider: 'openai', baseURL: 'https://controlled.invalid/v1', imageProtocol: 'openai-images' } }

it('a table-based chart edit and new explanation survive interrupted embedding; the same task reuses its real image receipt and only finishes the missing insertion', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-composite-image-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const project = createBlankCourseProjectV10('组合任务')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.definitions[TABLE_DEFINITION.id] = TABLE_DEFINITION
  project.definitions[CHART_DEFINITION.id] = CHART_DEFINITION
  const table = createTableData({ rows: 2, columns: 1 }); table.rows[0].cells[0].text = '2'; table.rows[1].cells[0].text = '5'
  const frame = { width: 300, height: 160, transform: [1, 0, 0, 1, 40, 70] as [number, number, number, number, number, number] }
  project.instances.table = { id: 'table', definitionId: TABLE_DEFINITION.id, data: table, frame }
  project.instances.chart = { id: 'chart', definitionId: CHART_DEFINITION.id, data: createChartData(), frame: { ...frame, transform: [1, 0, 0, 1, 400, 70] } }
  project.instances.existing = { id: 'existing', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('原有说明') }
  project.surfaces[0].childIds = ['table', 'chart']
  project.surfaces.push({ id: 'flow', kind: 'flow', title: '任务说明', childIds: ['existing'] })
  const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'composite.h5lesson')
  const bytes = await sharp({ create: { width: 12, height: 9, channels: 4, background: '#2d7ab8' } }).png().toBuffer()
  let generated = 0
  // This replaces only the external image provider. Job persistence, decoded bytes and Gateway/Session are real.
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider: { async generate(request, references) {
    generated++
    return { status: 'completed', images: [{ bytes, mimeType: 'image/png', filename: '受控图片.png' }], provenance: imageProvenance(request, references) }
  } } })
  host.tools.configureHostServices({ images: { selection: () => imageSelection, run: images.start.bind(images), read: images.read.bind(images), stop: images.stop.bind(images),
    readResource: images.readResource.bind(images), readReadyResourceFromJob: images.readReadyResourceFromJob.bind(images) } })
  let waiting!: () => void, release!: () => void
  const embeddingPending = new Promise<void>(resolve => { waiting = resolve }), gate = new Promise<void>(resolve => { release = resolve })
  let mode: 'initial' | 'continue' | 'regenerate' = 'initial', step = 0, surfaceTarget = '', tablePath = '', chartPath = '', flowPath = '', flowSource = '', job = '', resource = ''
  let values: number[] = [], imageReady = false, continuedOnce = false
  const provider: ModelProvider = { async *stream(request, options) {
    step++
    const surface = fixedReferences(request)[0].writable.find(value => value.kind === 'course-surface')!
    surfaceTarget = surface.target
    if (mode === 'regenerate') {
      if (step === 1) { yield complete(request, { name: name(request, 'image.generate'), args: { target: surfaceTarget, prompt: '教师明确要求重新生成一张新图', output: { format: 'png' } } }); return }
      const result = toolData(request)
      job = result.job
      if (result.status !== 'ready') { yield complete(request, { name: name(request, 'image.status'), args: { job } }); return }
      yield complete(request, undefined, '新图片已生成，尚未嵌入。'); return
    }
    if (mode === 'continue') {
      if (step === 1) {
        const announcement = request.messages.find(value => value.role === 'system' && typeof value.content === 'string' && value.content.startsWith('以下旧运行图片经宿主核验'))
        expect(announcement, 'An already ready image must be reissued by the software, never regenerated by the model').toBeTruthy()
        const metadata = JSON.parse((announcement!.content as string).slice((announcement!.content as string).indexOf('：') + 1))
        expect(metadata.ready).toHaveLength(1)
        resource = metadata.ready[0].resource
        yield complete(request, { name: name(request, 'read'), args: { target: surfaceTarget } }); return
      }
      if (step === 2) {
        const observed = toolData(request)
        if (typeof observed.target === 'string') surfaceTarget = observed.target
        continuedOnce = true
        yield complete(request, { name: name(request, 'media.insert'), args: { target: surfaceTarget, resource } }); return
      }
      expect(toolData(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
      yield complete(request, undefined, '已继续嵌入原图片，原图表与说明没有重做。'); return
    }
    if (step === 1) { yield complete(request, { name: name(request, 'project.list'), args: {} }); return }
    if (step === 2) {
      const files = toolData(request).files as Array<{ path: string }>
      tablePath = files.find(value => /表格.*\.data\.json$/.test(value.path))!.path
      chartPath = files.find(value => /图表.*\.data\.json$/.test(value.path))!.path
      flowPath = files.find(value => /任务说明.*\.md$/.test(value.path))!.path
      yield complete(request, { name: name(request, 'project.read'), args: { path: tablePath } }); return
    }
    if (step === 3) {
      const observed = JSON.parse(toolData(request).content) as TableData
      values = observed.rows.map(row => Number(row.cells[0].text))
      yield complete(request, { name: name(request, 'project.read'), args: { path: chartPath } }); return
    }
    if (step === 4) {
      const chart = JSON.parse(toolData(request).content) as ChartData
      const data = { ...chart, series: chart.series.map(series => ({ ...series, points: series.points.map((point, index) => ({ ...point, value: values[index] })) })) }
      yield complete(request, { name: name(request, 'object.update'), args: { path: chartPath, properties: { data } } }); return
    }
    if (step === 5) { expect(toolData(request)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } }); yield complete(request, { name: name(request, 'project.read'), args: { path: flowPath } }); return }
    if (step === 6) {
      flowSource = toolData(request).content
      yield complete(request, { name: name(request, 'project.apply'), args: { path: flowPath, content: `${flowSource}\n\n新增说明：数据 ${values.join(' 和 ')} 已体现在图表中。\n` } }); return
    }
    if (step === 7) { expect(toolData(request)).toMatchObject({ commit: 'committed' }); yield complete(request, { name: name(request, 'image.generate'), args: { target: surfaceTarget, prompt: '为这段数据说明生成一张教学图片', output: { format: 'png' } } }); return }
    const result = toolData(request)
    job = result.job
    if (result.status !== 'ready') { yield complete(request, { name: name(request, 'image.status'), args: { job } }); return }
    expect(result.resources).toHaveLength(1)
    imageReady = true
    waiting()
    options?.signal?.addEventListener('abort', release, { once: true })
    await gate
    yield complete(request, undefined, '图片已生成，嵌入尚未提交。')
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
  const input: ExecutionStart = { conversationId: 'composite', taskId: 'combined-task', instruction: '读取表格，更新现有图表，新增一段说明，生成图片并嵌入当前演示页面。', selection: textSelection,
    documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }, { kind: 'course-surface', surfaceId: project.surfaces[0].id }] }], workspaceRoot: directory, permission: 'workspace' }
  let activeRunId: string | undefined
  try {
    const started = await engine.start(input), ending = engine.wait(started.runId)
    activeRunId = started.runId
    await Promise.race([embeddingPending, ending.then(result => { throw new Error(`Did not reach generated image before embedding: ${result.failure?.message ?? result.status}`) })])
    expect(imageReady).toBe(true)
    expect(generated).toBe(1)
    const generatedJob = await images.read(job)
    expect(generatedJob.resources).toHaveLength(1)
    await engine.stop(started.runId)
    const stopped = await ending
    expect(['stopped', 'partial']).toContain(stopped.status)
    const before = await host.internalAPI.read(initial.documentId)
    if (before.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(before.undoDepth).toBe(2)
    expect((before.model.project.instances.chart.data as ChartData).series[0].points.map(value => value.value)).toEqual([2, 5])
    const flowIds = before.model.project.surfaces.find(value => value.id === 'flow')!.childIds
    expect(flowIds).toHaveLength(2)
    expect(Object.values(before.model.project.instances).filter(value => value.definitionId === 'guoling.image')).toHaveLength(0)
    const moved = { ...before.model.project.instances.table.frame!, transform: [1, 0, 0, 1, 87, 91] as [number, number, number, number, number, number] }
    expect(await host.internalAPI.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, actor: 'human', operationId: 'layout-between-runs',
      mutation: { type: 'command', command: captureComponentOperation(before.model.project, [{ type: 'frame.set', instanceId: 'table', frame: moved }]) } })).toMatchObject({ status: 'applied' })
    mode = 'continue'; step = 0
    const resumed = await engine.start(input, { runId: stopped.runId, facts: '', sameTask: true })
    activeRunId = resumed.runId
    const completed = await engine.wait(resumed.runId)
    expect(completed.status).toBe('completed')
    expect(continuedOnce).toBe(true)
    expect(completed.tools.map(value => value.call.name)).toEqual(['read', 'media.insert'])
    expect(generated).toBe(1)
    const current = await host.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    expect(current.undoDepth).toBe(4)
    expect(current.model.project.instances.table.frame).toEqual(moved)
    expect(current.model.project.instances.chart).toEqual(before.model.project.instances.chart)
    expect(current.model.project.surfaces.find(value => value.id === 'flow')!.childIds).toEqual(flowIds)
    const inserted = Object.values(current.model.project.instances).filter(value => value.definitionId === 'guoling.image')
    expect(inserted).toHaveLength(1)
    const filename = path.join(directory, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold')).internalAPI.open(filename)
    expect(reopened).toMatchObject({ model: { kind: 'course-v10', project: { instances: { [inserted[0].id]: inserted[0], table: { frame: moved }, chart: { data: current.model.project.instances.chart.data } } } } })
    if (reopened.model.kind !== 'course-v10') throw new Error('V10 required')
    const imageData = inserted[0].data as { assetId: string }
    const decoded = await sharp(reopened.model.resources.assets[imageData.assetId]).metadata()
    expect(decoded).toMatchObject({ width: 12, height: 9 })
    expect(await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, actor: 'human', operationId: 'undo-embed', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    expect(generated).toBe(1)
    expect((await images.read(generatedJob.jobId)).resources).toEqual(generatedJob.resources)
    // Undo removes author embedding; it cannot undo the external provider's generation or invent a refunded charge.
    mode = 'regenerate'; step = 0
    const fresh = await engine.start({ ...input, taskId: 'explicit-regeneration', instruction: '请明确重新生成一张新图片；暂时不嵌入。' })
    activeRunId = fresh.runId
    const regenerated = await engine.wait(fresh.runId)
    expect(regenerated.tools.filter(value => value.call.name === 'image.generate')).toHaveLength(1)
    expect(regenerated.tools.some(value => value.call.name === 'media.insert')).toBe(false)
    expect(generated).toBe(2)
    const jobs = await images.list()
    expect(jobs.map(value => value.jobId)).toHaveLength(2)
    expect(jobs.find(value => value.jobId !== generatedJob.jobId)).toMatchObject({ resources: [expect.objectContaining({ width: 12, height: 9 })] })
    // Existing chart update is proven here. New chart creation/type conversion has no current public consumer in this cut.
  } finally {
    release()
    if (activeRunId) { await engine.stop(activeRunId); await engine.wait(activeRunId) }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})
