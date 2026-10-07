// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
const { JSDOM } = require('jsdom') as { JSDOM: new (source: string) => { window: { document: Document; close(): void } } }
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
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionDocumentReference, ExecutionSendResult, ElementChangeView } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
const engines: ExecutionEngine[] = []
const desktops: ExecutionDesktopService[] = []
afterEach(async () => {
  for (const desktop of desktops.splice(0)) await desktop.shutdown()
  for (const engine of engines.splice(0)) await engine.shutdown()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    // The existing event owner may finish its last rename after engine shutdown on Windows.
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await fs.rm(root, { recursive: true, force: true }); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt === 4) throw error
        await new Promise<void>(resolve => setTimeout(resolve, 20))
      }
    }
  }
})

it('maps the frozen source field at Main send, follows its first drag, and resumes only the same field', async () => {
  const source = '<!doctype html><html><body><p id="b">B</p><p id="a">A &amp; B</p></body></html>'
  const address: HtmlAuthorFieldTarget = { kind: 'html-author-field', authorKey: 'static-a', field: 'text',
    record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 0 },
      { tag: 'p', index: 1, attributes: { id: 'a' } }], textIndex: 0, baseline: 'A & B' }, overrides: {} },
    source: { from: source.indexOf('A &amp; B'), to: source.indexOf('A &amp; B') + 'A &amp; B'.length } }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-author-ai-main-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), filename = path.join(workspace, 'selected.html')
  await fs.mkdir(workspace); await fs.writeFile(filename, source)
  const documents = new DocumentHostService(path.join(root, 'journals')), snapshot = await documents.open(filename)
  const session = documents.registry.get(snapshot.documentId), key = randomBytes(32)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true,
    encryptString(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]) },
    decryptString(value) { const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') },
  } })
  const saved = await settings.saveConnection({ apiKey: 'fixture-only', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', authKind: 'api-key',
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'supported' } } })
  await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: saved.connection.id, model: 'fixture' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const ready = deferred(), release = deferred(), literal = 'AI <img src=x> & 😀'
  const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings,
    authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      expect(payload.messages.find(message => typeof message.content === 'string'
        && message.content.startsWith('当前默认文字目标的完整内容（数据）：'))?.content)
        .toBe('当前默认文字目标的完整内容（数据）：\nA & B')
      ready.resolve(); await release.promise
      const chunk = { id: 'fixture', model: 'fixture', choices: [{ index: 0, finish_reason: 'tool_calls', delta: { role: 'assistant', tool_calls: [
        { index: 0, id: 'replace', type: 'function', function: { name: 'text_replace', arguments: JSON.stringify({ content: literal }) } },
        { index: 1, id: 'finish', type: 'function', function: { name: 'task_finish', arguments: '{}' } },
      ] } }] }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    } })
  desktops.push(service)
  const { workspace: space } = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspaceId,
    element: { kind: 'element', documentId: snapshot.documentId, label: 'A' } }) as ConversationRecord
  const frozen: ExecutionDocumentReference = { documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
    writable: [address], selection: [address] }
  const sourceNow = () => { const model = session.read().model; if (model.kind !== 'text') throw new Error('text required'); return model.source }
  const human = async (sourceValue: string) => { const current = await session.drain(); expect(await session.execute({
    documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: sourceValue } } })).toMatchObject({ status: 'applied' }) }
  await human(sourceNow().replace('>B<', '>教师的更长 B 正文<'))
  const submissionId = randomUUID()
  const sent = await service.operate({ type: 'send', workspaceId: space.workspaceId, conversationId: conversation.conversationId,
    submissionId, expectedRevision: conversation.revision, text: '只改 A 正文', documents: [frozen],
    contentOutput: { kind: 'replace-text', documentId: snapshot.documentId, target: address } }) as ExecutionSendResult
  if (!sent.run) throw new Error('fixture run required')
  await ready.promise
  const anchored = { ...address.record, binding: { ...address.record.binding, path: [{ tag: 'body', index: 0 },
    { tag: 'p', index: 1, attributes: { id: 'a', 'data-cw-author-key': 'static-a' } }] }, overrides: { geometry: { translateX: 42 } } }
  await human(patchHtmlAuthoringRecords(sourceNow().replace('<p id="a">', '<p id="a" data-cw-author-key="static-a">'), { 'static-a': anchored }))
  release.resolve()
  const result = await service.engine.wait(sent.run.runId)
  expect(result.status, JSON.stringify({ failure: result.failure, tools: result.tools })).toBe('completed')
  await expect.poll(async () => (await service.operate({ type: 'element-change', submissionId }) as ElementChangeView).state).not.toBe('pending')
  const view = await service.operate({ type: 'element-change', submissionId }) as ElementChangeView
  expect(view).toMatchObject({ state: 'applied', content: literal, target: { kind: 'html-author-field', authorKey: 'static-a' } })
  expect(readHtmlAuthoringRecords(sourceNow())['static-a']).toMatchObject({ binding: { baseline: literal }, overrides: { geometry: { translateX: 42 } } })
  expect(readHtmlAuthoringRecords(sourceNow())['static-a'].overrides).not.toHaveProperty('text')
  const ownRuns = new Set([sent.run.runId]), continued = await continueDocumentTargets(session, frozen, ownRuns)
  expect(continued.writable).toHaveLength(1)
  expect(readHtmlAuthorField(session.read().model, continued.writable[0] as HtmlAuthorFieldTarget).value).toBe(literal)
  expect((await continueDocumentTargets(session, { ...frozen, writable: [] }, ownRuns)).writable).toEqual([])
  expect(await service.operate({ type: 'element-revert', submissionId, direction: 'undo' })).toMatchObject({ status: 'applied' })
  const restored = await service.operate({ type: 'element-change', submissionId }) as ElementChangeView
  expect(restored.content).toBe('A & B')
  expect(readHtmlAuthoringRecords(sourceNow())['static-a'].overrides.geometry).toEqual({ translateX: 42 })
  expect(sourceNow()).toContain('<p id="b">教师的更长 B 正文</p>')
  const dom = new JSDOM(sourceNow()); expect(dom.window.document.querySelectorAll('img')).toHaveLength(0); dom.window.close()
  await expect(continueDocumentTargets(session, continued, new Set())).rejects.toThrow('原 HTML 正文字段已被其他操作改动')
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
async function fixture(source: string, provider: ModelProvider, address: HtmlAuthorFieldTarget = target) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-author-ai-')); roots.push(root)
  const driver = new TextDriver(), registry = new DocumentRegistry({ drivers: [driver], createId: randomUUID,
    bindingKey: binding => binding.path, persistence: { append: async () => {}, save: async () => { throw new Error('No file save in this fixture') } } })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'selected.html')
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const engine = new ExecutionEngine({ registry, gateway, provider,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  engines.push(engine)
  const input = (taskId: string, captured: HtmlAuthorFieldTarget = address) => ({ conversationId: 'card', taskId, instruction: '只改写当前选中的文字', selection,
    documents: [{ documentId: session.documentId, writable: [captured], selection: [captured] }],
    contentOutput: { kind: 'replace-text' as const, documentId: session.documentId, target: captured } })
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

it('follows the encoded extent of an exact static HTML field while preserving longer preceding teacher text', async () => {
  const original = 'A &amp; B', source = `<!doctype html><html><body><p id="b">STATIC-B</p><p id="a">${original}</p></body></html>`
  const address: HtmlAuthorFieldTarget = { kind: 'html-author-field', authorKey: 'static-a', field: 'text',
    record: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 0 },
      { tag: 'p', index: 1, attributes: { id: 'a' } }], textIndex: 0, baseline: 'A & B' }, overrides: {} },
    source: { from: source.indexOf(original), to: source.indexOf(original) + original.length } }
  const ready = deferred(), release = deferred(), literal = 'show <img src=x> & "fun" 😀'
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns === 1) {
      expect(request.messages.find(message => typeof message.content === 'string'
        && message.content.startsWith('当前默认文字目标的完整内容（数据）：'))?.content)
        .toBe('当前默认文字目标的完整内容（数据）：\nA & B')
      ready.resolve(); await release.promise
    }
    yield completed(request, turns === 1 ? literal : '第二轮 <literal> & 😀')
  } }
  const f = await fixture(source, provider, address)
  const first = new ElementChangeTracker('card', f.session.documentId, address, f.session, f.session.read())
  const started = await f.engine.start(f.input('static-first')); first.bindRun(started.runId)
  await ready.promise
  await f.human(f.sourceNow().replace('STATIC-B', '教师的更长 B 正文'))
  release.resolve()
  expect((await f.engine.wait(started.runId)).status).toBe('completed'); first.finish()
  expect(first.view('first')).toMatchObject({ content: literal, target: { kind: 'html-author-field', authorKey: 'static-a' } })
  const dom = new JSDOM(f.sourceNow())
  expect(dom.window.document.getElementById('a')?.textContent).toBe(literal)
  expect(dom.window.document.querySelectorAll('img')).toHaveLength(0)
  expect(dom.window.document.getElementById('b')?.textContent).toBe('教师的更长 B 正文'); dom.window.close()
  expect(readHtmlAuthoringRecords(f.sourceNow())).toEqual({})

  const current = first.view('first').target as HtmlAuthorFieldTarget
  const next = new ElementChangeTracker('card', f.session.documentId, current, f.session, f.session.read())
  const second = await f.engine.start(f.input('static-second', current)); next.bindRun(second.runId)
  expect((await f.engine.wait(second.runId)).status).toBe('completed'); next.finish()
  expect(next.view('second')).toMatchObject({ content: '第二轮 <literal> & 😀' })
  expect((await next.revert('second', 'undo')).status).toBe('applied')
  expect(readHtmlAuthorField(f.session.read().model, first.view('first').target as HtmlAuthorFieldTarget).value).toBe(literal)
  expect((await first.revert('first', 'undo')).status).toBe('applied')
  expect(readHtmlAuthorField(f.session.read().model, first.view('first').target as HtmlAuthorFieldTarget).value).toBe('A & B')
  expect(f.sourceNow()).toContain('<p id="b">教师的更长 B 正文</p>')
  first.dispose(); next.dispose()
})
