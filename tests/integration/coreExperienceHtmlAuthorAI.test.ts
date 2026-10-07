// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { TextDriver } from '../../src/core/drivers/TextDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { readHtmlAuthorField, type HtmlAuthorFieldTarget } from '../../src/core/tools/ToolTargets'
import { patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../src/shared/html/htmlAuthoringRecords'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ElementChangeTracker } from '../../src/main/workbench/execution/ElementChangeTracker'

const roots: string[] = []
const engines: ExecutionEngine[] = []
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.shutdown()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const selection: ModelSelection = { model: 'controlled-fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture',
  protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'supported' } } }
const baseSource = '<!doctype html><html><body><div id="app"></div><p id="b">STATIC-B</p><script>document.getElementById("app").innerHTML="<p>A base</p>";</script></body></html>'
const record: ComponentAuthorRecord = { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 0 },
  { tag: 'div', index: 0, attributes: { id: 'app' } }, { tag: 'p', index: 0 }], textIndex: 0, baseline: 'A base' }, overrides: {} }
const target: HtmlAuthorFieldTarget = { kind: 'html-author-field', authorKey: 'a', field: 'text', record }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }
function completed(request: ModelRequest, content: string): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = [{ id: 'replace', name: 'text.replace', argumentsText: JSON.stringify({ content }) },
    { id: 'finish', name: 'task.finish', argumentsText: '{}' }]
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'fixture-response',
    actualModel: 'controlled-fixture', nativeResponse: {}, finishReason: 'tool_calls', toolCalls: calls,
    assistant: { role: 'assistant', content: null, tool_calls: calls.map(call => ({ id: call.id, type: 'function',
      function: { name: call.name, arguments: call.argumentsText } })) } }
}
async function fixture(source: string, provider: ModelProvider) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-author-ai-')); roots.push(root)
  const driver = new TextDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { append: async () => {}, save: async () => { throw new Error('No file save in this fixture') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'selected.html')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const engine = new ExecutionEngine({ registry, gateway, provider,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  engines.push(engine)
  const input = (taskId: string) => ({ conversationId: 'card', taskId, instruction: '只改写当前选中的文字', selection,
    documents: [{ documentId: session.documentId, writable: [target], selection: [target] }],
    contentOutput: { kind: 'replace-text' as const, documentId: session.documentId, target } })
  const sourceNow = () => {
    const model = session.read().model
    if (model.kind !== 'text') throw new Error('HTML text fixture required')
    return model.source
  }
  const human = async (sourceValue: string) => {
    const snapshot = await session.drain()
    expect(await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source: sourceValue } } }))
      .toMatchObject({ status: 'applied' })
  }
  return { driver, session, gateway, engine, input, sourceNow, human }
}

it('reads the effective HTML author value, preserves concurrent geometry and static B, then follows and reverses only the same field', async () => {
  const ready = deferred(), release = deferred(), finalText = 'AI <正文> & "引号" 😀'
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns === 1) {
      const current = request.messages.find(message => typeof message.content === 'string'
        && message.content.startsWith('当前默认文字目标的完整内容（数据）：'))
      expect(current?.content).toBe('当前默认文字目标的完整内容（数据）：\n教师已改 A')
      ready.resolve(); await release.promise
    }
    yield completed(request, turns === 1 ? finalText : '下一轮 AI 正文')
  } }
  const initial = patchHtmlAuthoringRecords(baseSource, { a: { ...record, overrides: { text: '教师已改 A', geometry: { translateX: 5 } } } })
  const f = await fixture(initial, provider), first = new ElementChangeTracker('card', f.session.documentId, target, f.session, f.session.read())
  const started = await f.engine.start(f.input('first')); first.bindRun(started.runId)
  await ready.promise
  const records = readHtmlAuthoringRecords(f.sourceNow())
  records.a.overrides.geometry = { translateX: 73, translateY: 11 }
  await f.human(patchHtmlAuthoringRecords(f.sourceNow().replace('STATIC-B', '教师的 B 正文'), records))
  release.resolve()
  const result = await f.engine.wait(started.runId); first.finish()
  expect(result.status).toBe('completed')
  expect(readHtmlAuthoringRecords(f.sourceNow()).a.overrides).toEqual({ text: finalText, geometry: { translateX: 73, translateY: 11 } })
  expect(f.sourceNow()).toContain('<p id="b">教师的 B 正文</p>')
  expect(f.session.read().undoDepth).toBe(2)
  expect(first.view('first')).toMatchObject({ state: 'applied', target, content: finalText })
  expect(first.view('first').target).not.toHaveProperty('from')

  const next = new ElementChangeTracker('card', f.session.documentId, target, f.session, f.session.read())
  const second = await f.engine.start(f.input('second')); next.bindRun(second.runId)
  expect((await f.engine.wait(second.runId)).status).toBe('completed'); next.finish()
  expect(next.view('second')).toMatchObject({ content: '下一轮 AI 正文', target })
  expect((await next.revert('second', 'undo')).status).toBe('applied')
  expect(readHtmlAuthorField(f.session.read().model, target).value).toBe(finalText)
  expect((await first.revert('first', 'undo')).status).toBe('applied')
  expect(readHtmlAuthorField(f.session.read().model, target).value).toBe('教师已改 A')
  expect((await first.revert('first', 'redo')).status).toBe('applied')
  expect(readHtmlAuthorField(f.session.read().model, target).value).toBe(finalText)
  expect(readHtmlAuthoringRecords(f.sourceNow()).a.overrides.geometry).toEqual({ translateX: 73, translateY: 11 })
  expect(f.sourceNow()).toContain('<p id="b">教师的 B 正文</p>')
  const reopened = f.driver.load(f.driver.serialize(f.session.read().model))
  expect(readHtmlAuthorField(reopened, target).value).toBe(finalText)
  first.dispose(); next.dispose()
})

it('keeps the generated draft and reports a same-field conflict instead of overwriting a newer teacher value', async () => {
  const ready = deferred(), release = deferred(), proposed = '应当保留的 AI 稿'
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns === 1) { ready.resolve(); await release.promise; yield completed(request, proposed) }
    else yield { ...completed(request, proposed), finishReason: 'stop', toolCalls: [],
      assistant: { role: 'assistant', content: '所选正文已改动，生成稿保留，未覆盖教师的新值。' } }
  } }
  const f = await fixture(baseSource, provider), tracker = new ElementChangeTracker('card', f.session.documentId, target, f.session, f.session.read())
  const started = await f.engine.start(f.input('conflict')); tracker.bindRun(started.runId)
  await ready.promise
  await f.human(patchHtmlAuthoringRecords(f.sourceNow(), { a: { ...record, overrides: { text: '教师的新正文', geometry: { width: 240 } } } }))
  release.resolve()
  const result = await f.engine.wait(started.runId); tracker.finish()
  expect(result.status).toBe('partial')
  expect(result.tools.find(tool => tool.call.name === 'text.replace')?.result).toMatchObject({ kind: 'error', code: 'target-conflict' })
  expect(result.tools.find(tool => tool.call.name === 'text.replace')?.call.input).toMatchObject({ content: proposed })
  expect(readHtmlAuthoringRecords(f.sourceNow()).a.overrides).toEqual({ text: '教师的新正文', geometry: { width: 240 } })
  expect(f.session.read().undoDepth).toBe(1)
  expect(tracker.view('conflict')).toMatchObject({ state: 'none', target, content: '教师的新正文' })
  tracker.dispose()
})
