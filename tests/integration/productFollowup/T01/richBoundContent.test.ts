// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { prepareExecutionContentOutput, readEditableTargetContent } from '../../../../src/core/tools/ToolTargets'
import { TEXT_DEFINITION , textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData, createFormulaComponentData, textComponentDataSchema } from '../../../../src/components/text/data'
import { documentTextLength } from '../../../../src/shared/document/content'
import { ExecutionEngine } from '../../../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../../../src/main/workbench/execution/ExecutionEventStore'
import { EditSessionService } from '../../../../src/main/workbench/execution/EditSessionService'
import type { ModelEvent, ModelProvider, ModelSelection } from '../../../../src/shared/workbench/modelProvider'

it('a software-bound V10 rich selection preserves unselected links marks geometry and unchanged formula identity in one History', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t01-rich-'))
  const host = new DocumentHostService(path.join(directory, 'recovery'))
  try {
    const project = createBlankCourseProjectV10('内容请求')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const original = createTextComponentData({ inlines: [
      { type: 'text', text: '保留', style: { italic: true }, link: { href: './前文.html' } },
      { type: 'text', text: '旧', style: { bold: true }, link: { href: 'https://example.org/old' } },
      createFormulaComponentData('old-formula', 'x^2').formula,
      { type: 'text', text: '尾段', style: { color: '#123456' }, link: { href: 'tel:+8612345678' } },
    ] })
    const frame = { width: 330, height: 100, transform: [1, 0, 0, 1, 41, 63] as [number, number, number, number, number, number] }
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', original).value, frame, style: { opacity: .8 } }
    project.surfaces[0].childIds = ['text']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'rich.h5lesson')
    const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'text', dataPath: ['content'], from: 2, to: 4 }
    const content = readEditableTargetContent(initial.model, target)
    expect(content.format).toBe('html')
    expect(content.text).toContain('https://example.org/old')
    expect(content.text).not.toContain('old-formula')
    expect(content.text).not.toContain('保留')
    const replacement = '<a href="https://example.org/new"><strong>新</strong></a>\\(x^2\\)与\\(y\\)'
    let requests = 0
    const provider: ModelProvider = { async *stream(request): AsyncGenerator<ModelEvent> {
      requests++
      if (requests > 1) {
        yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'fixture-final', actualModel: 'fixture',
          finishReason: 'stop', toolCalls: [], nativeResponse: {}, assistant: { role: 'assistant', content: '已处理所选正文。' } }; return
      }
      const write = request.tools?.find(value => value.name === 'text.replace')
      const finish = request.tools?.find(value => value.name === 'task.finish')
      expect(write).toBeTruthy()
      expect(finish).toBeUndefined()
      expect(JSON.stringify(request.messages)).toContain('https://example.org/old')
      yield { type: 'text.delta', requestId: request.requestId, sequence: 1, text: '<strong>尚未完成' }
      expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ revision: 0, undoDepth: 0, model: { project: { instances: { text: { data: original } } } } })
      const argumentsText = JSON.stringify({ content: replacement })
      yield { type: 'response.completed', requestId: request.requestId, sequence: 2, responseId: 'fixture', actualModel: 'fixture',
        finishReason: 'tool_calls', toolCalls: [{ id: 'content-result', name: write!.name, argumentsText }], assistant: { role: 'assistant', content: '',
          tool_calls: [{ id: 'content-result', type: 'function', function: { name: write!.name, arguments: argumentsText } }] }, nativeResponse: {} }
    } }
    const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, edits: new EditSessionService(host.registry, host.tools),
      runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
    const started = await engine.start({ conversationId: 'rich', taskId: 'rewrite', instruction: '改写所选内容并保留公式和链接', selection,
      documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: { kind: 'content', documentId: initial.documentId, target } })
    const ended = await engine.wait(started.runId)
    expect(ended.status).toBe('completed')
    expect(ended.tools.map(value => value.call.name)).toEqual(['text.replace'])
    expect(ended.tools[0]).toMatchObject({ call: { name: 'text.replace', input: { content: replacement } }, result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(requests).toBe(2)
    const current = await host.internalAPI.read(initial.documentId)
    expect(current.undoDepth).toBe(1)
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    const instance = current.model.project.instances.text
    expect(instance.frame).toEqual(frame)
    expect(instance.style).toEqual(project.instances.text.style)
    const inlines = textComponentDataSchema.parse(instance.data).content.inlines
    expect(inlines[0]).toEqual(original.content.inlines[0])
    expect(inlines.at(-1)).toEqual(original.content.inlines.at(-1))
    expect(inlines).toContainEqual({ type: 'text', text: '新', style: { bold: true }, link: { href: 'https://example.org/new' } })
    const formulas = inlines.filter(value => value.type === 'math')
    expect(formulas.find(value => value.latex === 'x^2')?.formulaId).toBe('old-formula')
    expect(formulas.find(value => value.latex === 'y')?.formulaId).toBeTruthy()
    expect(formulas.find(value => value.latex === 'y')?.formulaId).not.toBe('old-formula')
    expect(await host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
      actor: 'human', operationId: 'undo', mutation: { type: 'undo' } })).toMatchObject({ status: 'applied' })
    expect(await host.internalAPI.read(initial.documentId)).toMatchObject({ model: { project: { instances: { text: { data: original } } } } })
  } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})

it('offline replays the first actual live rich tool input through the formal writer save and cold reopen without losing formula identity', async () => {
  const captured = JSON.parse(await fs.readFile(new URL('./fixtures/live-first-tool-rich.json', import.meta.url), 'utf8')) as {
    evidenceLayer: string; call: { name: string; input: { content: string; format: 'html' } }
  }
  expect(captured.call.name).toBe('text.replace')
  expect(captured.call.input.content).toContain('\\\\(x^2\\\\)')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t01-captured-rich-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  const runId = 'offline-captured-rich'
  try {
    const project = createBlankCourseProjectV10('原失败输入离线回放')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const original = createTextComponentData({ inlines: [
      { type: 'text', text: '正方形面积', link: { href: 'https://example.org/area' }, style: { bold: true } },
      { type: 'text', text: '：待按教师材料解释。' }, createFormulaComponentData('kept-area-formula', 'x^2').formula,
    ] })
    const bodyFrame = { width: 360, height: 120, transform: [1, 0, 0, 1, 41, 63] as [number, number, number, number, number, number] }
    const literalCode = '\\\\(x^2\\\\)', ordinary = 'C:\\课程\\素材'
    const guard = createTextComponentData({ inlines: [{ type: 'text', text: '旧样例：' }, { type: 'text', text: literalCode, code: true },
      { type: 'text', text: '；' }, createFormulaComponentData('kept-fraction', '\\frac{1}{2}').formula, { type: 'text', text: `；${ordinary}` }] })
    project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', original).value, frame: bodyFrame, style: { opacity: .9 } }
    project.instances.guard = { id: 'guard', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', guard).value }
    project.instances.untouched = { id: 'untouched', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', createTextComponentData('未选正文保持原样')).value,
      frame: { width: 280, height: 90, transform: [1, 0, 0, 1, 83, 147] } }
    project.surfaces = [{ id: 'flow', kind: 'flow', title: '讲义', childIds: ['body', 'guard', 'untouched'] }]
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'captured.h5lesson')
    const bodyTarget = { kind: 'course-instance' as const, surfaceId: 'flow', instanceId: 'body', dataPath: ['content'], from: 0, to: documentTextLength(original.content) }
    const guardTarget = { ...bodyTarget, instanceId: 'guard', to: documentTextLength(guard.content) }
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [bodyTarget, guardTarget] }] })
    const bodyHandle = await host.tools.issueTarget(runId, initial.documentId, bodyTarget)
    // Captured canonical tool input is replayed unchanged. No ModelProvider is created or called.
    expect(await host.tools.execute(runId, 'captured-live-body', { name: captured.call.name, input: { ...captured.call.input, target: bodyHandle } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const guardHandle = await host.tools.issueTarget(runId, initial.documentId, guardTarget)
    expect(await host.tools.execute(runId, 'ordinary-html-guard', { name: 'text.replace', input: { target: guardHandle, format: 'html',
      content: `规范输入：<code>${literalCode}</code>；\\(\\frac{1}{2}\\)；${ordinary}` } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const current = await host.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    const body = current.model.project.instances.body
    const inlines = textComponentDataSchema.parse(body.data).content.inlines
    expect(inlines.find(value => value.type === 'math')).toEqual(original.content.inlines[2])
    expect(inlines).toContainEqual(original.content.inlines[0])
    expect(inlines.some(value => value.type === 'text' && value.text.includes('3') && value.text.includes('9'))).toBe(true)
    const guarded = textComponentDataSchema.parse(current.model.project.instances.guard.data).content.inlines
    expect(guarded.filter(value => value.type === 'math')).toEqual([guard.content.inlines[3]])
    expect(guarded).toContainEqual({ type: 'text', text: literalCode, code: true })
    expect(guarded.some(value => value.type === 'text' && value.text.includes(ordinary))).toBe(true)
    expect(body.frame).toEqual(bodyFrame)
    expect(body.style).toEqual(project.instances.body.style)
    expect(current.model.project.instances.untouched).toEqual(project.instances.untouched)
    expect(current.model.project.surfaces).toEqual(project.surfaces)
    const filename = path.join(directory, 'saved.h5lesson')
    await host.internalAPI.save(initial.documentId, filename)
    const reopened = await new DocumentHostService(path.join(directory, 'cold-documents')).internalAPI.open(filename)
    expect(reopened.model).toEqual(current.model)
  } finally { await host.tools.stop(runId); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})

it('roundtrips the actual initial model message as rich content without escaping LaTeX or changing its formula identity', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'followup-t01-model-rich-'))
  const host = new DocumentHostService(path.join(directory, 'documents'))
  try {
    const project = createBlankCourseProjectV10('原文表示')
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    const original = createTextComponentData({ inlines: [
      { type: 'text', text: '保留', style: { italic: true }, link: { href: './前文.html' } },
      { type: 'text', text: '旧', style: { bold: true }, link: { href: 'https://example.org/old' } },
      createFormulaComponentData('original-equation', '\\frac{1}{2}+x^2').formula,
      { type: 'text', text: '尾段', link: { href: 'tel:+8612345678' } },
    ] })
    const frame = { width: 330, height: 100, transform: [1, 0, 0, 1, 41, 63] as [number, number, number, number, number, number] }
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', original).value, frame }
    project.surfaces[0].childIds = ['text']
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'roundtrip.h5lesson')
    const target = { kind: 'course-instance' as const, surfaceId: project.surfaces[0].id, instanceId: 'text', dataPath: ['content'], from: 2, to: 4 }
    const editable = readEditableTargetContent(initial.model, target)
    expect(editable.format).toBe('html')
    const contentOutput = prepareExecutionContentOutput(initial, target)
    expect(contentOutput).toBeTruthy()
    let requests = 0, returnedBody: string | undefined
    // Controlled provider consumes only the actual product message and advertised tools.
    // No JSON.parse, unescaping, known fixture body, target handle or format is supplied to it.
    const provider: ModelProvider = { async *stream(request): AsyncGenerator<ModelEvent> {
      requests++
      if (requests > 1) {
        yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'fixture-final', actualModel: 'fixture',
          finishReason: 'stop', toolCalls: [], nativeResponse: {}, assistant: { role: 'assistant', content: '已处理所选正文。' } }; return
      }
      const prefix = '当前默认语义目标 target='
      const message = request.messages.find(value => value.role === 'system' && typeof value.content === 'string' && value.content.startsWith(prefix))
      if (!message || typeof message.content !== 'string') throw new Error('Actual default-content data message required')
      const editableMarker = '当前可编辑文字表示（数据）：'
      const marker = message.content.includes(editableMarker) ? editableMarker : '的内容与属性（数据）：'
      const data = message.content.slice(message.content.indexOf(marker) + marker.length)
      returnedBody = data.startsWith('\n') ? data.slice(1) : data
      const write = request.tools?.find(value => value.name === 'text.replace')
      const finish = request.tools?.find(value => value.name === 'task.finish')
      expect(write).toBeTruthy(); expect(finish).toBeUndefined()
      const calls = [{ id: 'roundtrip-body', name: write!.name, argumentsText: JSON.stringify({ content: returnedBody }) }]
      yield { type: 'response.completed', requestId: request.requestId, sequence: 1, responseId: 'controlled-roundtrip', actualModel: 'controlled',
        finishReason: 'tool_calls', toolCalls: calls, nativeResponse: {}, assistant: { role: 'assistant', content: '',
          tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } })) } }
    } }
    const selection: ModelSelection = { model: 'controlled', connection: { id: 'controlled', revision: 1, provider: 'controlled', protocol: 'openai-chat',
      baseURL: 'http://127.0.0.1:1/v1', accountId: 'controlled', auth: { kind: 'api-key', credentialRef: 'unused' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, edits: new EditSessionService(host.registry, host.tools),
      runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
    const started = await engine.start({ conversationId: 'rich-original', taskId: 'roundtrip', instruction: '把当前所选正文原样保留，包括链接、样式和公式，然后结束。', selection,
      documents: [{ documentId: initial.documentId, writable: [target], selection: [target] }], contentOutput: contentOutput! })
    const ended = await engine.wait(started.runId)
    expect(ended.status, JSON.stringify({ failure: ended.failure, tools: ended.tools })).toBe('completed')
    expect(returnedBody).toBe(editable.text)
    expect(requests).toBe(2)
    expect(ended.tools.map(value => value.call.name)).toEqual(['text.replace'])
    const current = await host.internalAPI.read(initial.documentId)
    if (current.model.kind !== 'course-v10') throw new Error('V10 required')
    const instance = current.model.project.instances.text
    const inlines = textComponentDataSchema.parse(instance.data).content.inlines
    expect(inlines.find(value => value.type === 'math')).toEqual(original.content.inlines[2])
    expect(inlines[0]).toEqual(original.content.inlines[0])
    expect(inlines.at(-1)).toEqual(original.content.inlines.at(-1))
    expect(inlines).toContainEqual(original.content.inlines[1])
    expect(instance.frame).toEqual(frame)
  } finally { await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }) }
})
