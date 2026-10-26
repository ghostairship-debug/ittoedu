// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { executionFinalReply } from '../../src/main/workbench/execution/executionOutcome'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture path')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { resolve, promise } }
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function completed(request: ModelRequest, content: string, edit = true): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = edit ? [{ id: 'replace', name: 'text.replace', argumentsText: JSON.stringify({ content }) }] : []
  return { type: 'response.completed', requestId: request.requestId, sequence: 10, responseId: 'fixture', actualModel: 'fixture',
    finishReason: edit ? 'tool_calls' : 'stop', toolCalls: calls, assistant: { role: 'assistant', content: edit ? null : content,
      ...(edit ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText } })) } : {}) }, nativeResponse: {} }
}
async function fixture(provider: ModelProvider, source = '前文 OLD 后文') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-bound-content-')); roots.push(root)
  const driver = new MarkdownDriver(), journal = createDocumentJournal({ directory: path.join(root, 'documents') })
  const registry = new DocumentRegistry({ drivers: [driver], persistence: journal, createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const edits = new EditSessionService(registry, gateway), runs = new ExecutionRunStore(path.join(root, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const engine = new ExecutionEngine({ registry, gateway, edits, runs, events, provider })
  const session = await registry.create(driver.load(new TextEncoder().encode(source)), 'draft.md')
  const target = { kind: 'markdown-range' as const, from: 0, to: source.length }
  const input: ExecutionStart = { conversationId: 'conversation', taskId: randomUUID(), instruction: '改写选中的正文', selection,
    documents: [{ documentId: session.documentId, writable: [target], selection: [target] }],
    contentOutput: { kind: 'content', documentId: session.documentId, target } }
  return { registry, gateway, edits, runs, engine, session, input, driver, journal }
}

describe('U01 explicit bound content output', () => {
  it('recognizes read aliases through real Gateway identity without accepting other writable targets or renewed leases', async () => {
    const h = await fixture({ async *stream() { throw new Error('Gateway-only fixture cannot send a model request') } })
    const target = { kind: 'markdown-range' as const, from: 3, to: 6 }
    const other = await h.registry.create(h.session.read().model, 'other.md')
    const documents = [...h.input.documents, { documentId: other.documentId, writable: [{ kind: 'document' as const }] }]
    const runId = 'read-alias-identity'
    await h.gateway.beginRun({ runId, actor: 'agent', documents })
    const original = await h.gateway.issueTarget(runId, h.session.documentId, target)
    const observed = await h.gateway.execute(runId, 'read-current', { name: 'read', input: { target: original } })
    expect(observed).toMatchObject({ kind: 'read', data: { text: 'OLD', truncated: false } })
    const alias = (observed as { data: { target: string } }).data.target
    expect(alias).not.toBe(original)
    expect(h.gateway.sameEditTarget(runId, original, alias)).toBe(true)
    const neighbor = await h.gateway.issueTarget(runId, h.session.documentId, { kind: 'markdown-range', from: 0, to: 2 })
    const broader = await h.gateway.issueTarget(runId, h.session.documentId, h.input.contentOutput!.target)
    const foreign = await h.gateway.issueTarget(runId, other.documentId, target)
    const readOnly = await h.gateway.issueTarget(runId, h.session.documentId, target, { readOnly: true })
    // These are real writable alternatives, so inequality must come from exact identity, not a missing grant.
    for (const handle of [neighbor, broader, foreign]) await expect(h.gateway.resolveEditTarget(runId, handle)).resolves.toHaveProperty('target')
    const anotherRun = 'read-alias-another-run'
    await h.gateway.beginRun({ runId: anotherRun, actor: 'agent', documents })
    const wrongRun = await h.gateway.issueTarget(anotherRun, h.session.documentId, target)
    for (const handle of [neighbor, broader, foreign, readOnly, wrongRun, 'unissued-handle'])
      expect(h.gateway.sameEditTarget(runId, original, handle)).toBe(false)
    await h.gateway.stopRunDocument(runId, h.session.documentId)
    await h.gateway.attachRunDocument(runId, h.session.documentId, true)
    const renewed = await h.gateway.issueTarget(runId, h.session.documentId, target)
    expect(h.gateway.sameEditTarget(runId, original, renewed)).toBe(false)
    const renewedAlias = await h.gateway.issueTarget(runId, h.session.documentId, target)
    expect(h.gateway.sameEditTarget(runId, renewed, renewedAlias)).toBe(true)
    await h.gateway.stop(runId)
    expect(h.gateway.sameEditTarget(runId, renewed, renewedAlias)).toBe(false)
    await h.gateway.stop(anotherRun)
    expect(h.session.read()).toMatchObject({ model: { source: '前文 OLD 后文' }, undoDepth: 0 })
  })

  it('does not revive an old process handle after real durable Session recovery creates a new epoch', async () => {
    const h = await fixture({ async *stream() { throw new Error('Gateway-only fixture cannot send a model request') } })
    const runId = 'read-alias-recovery', documentId = h.session.documentId, target = h.input.contentOutput!.target
    await h.gateway.beginRun({ runId, actor: 'agent', documents: h.input.documents })
    const original = await h.gateway.issueTarget(runId, documentId, target), before = h.session.read()
    const state = await h.journal.recover(documentId)
    expect(state).not.toBeNull()
    // Recreate process-owned owners from the actual journal; no private handle/epoch mutation.
    const registry = new DocumentRegistry({ drivers: [h.driver], persistence: h.journal, createId: randomUUID, bindingKey: binding => binding.path })
    const restored = await registry.restore(state!)
    expect(restored.read().epoch).not.toBe(before.epoch)
    const gateway = new DocumentToolGateway(registry, [h.driver], randomUUID)
    await gateway.beginRun({ runId, actor: 'agent', documents: h.input.documents })
    const current = await gateway.issueTarget(runId, documentId, target)
    expect(gateway.sameEditTarget(runId, original, current)).toBe(false)
    await expect(gateway.issueTarget(runId, documentId, target, { observed: before })).rejects.toMatchObject({ code: 'stale-epoch' })
    expect(restored.read()).toMatchObject({ model: { source: '前文 OLD 后文' }, undoDepth: 0 })
    await gateway.stop(runId)
  })

  it('keeps a fresh read alias from overwriting a subsequent overlapping human edit', async () => {
    const h = await fixture({ async *stream() { throw new Error('Gateway-only fixture cannot send a model request') } })
    const runId = 'read-alias-human-conflict'
    await h.gateway.beginRun({ runId, actor: 'agent', documents: h.input.documents })
    const original = await h.gateway.issueTarget(runId, h.session.documentId, h.input.contentOutput!.target)
    const observed = await h.gateway.execute(runId, 'read-current', { name: 'read', input: { target: original } })
    expect(observed.kind).toBe('read')
    const alias = (observed as { data: { target: string } }).data.target
    expect(h.gateway.sameEditTarget(runId, original, alias)).toBe(true)
    const before = h.session.read()
    await h.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: randomUUID(), actor: 'human',
      baseRevision: before.revision, mutation: { type: 'command', command: { type: 'markdown.replace', source: '人的新正文' } } })
    expect(h.gateway.sameEditTarget(runId, original, alias)).toBe(false)
    expect(await h.gateway.execute(runId, 'stale-replace', { name: 'text.replace', input: { target: alias, content: '旧稿覆盖' } }))
      .toMatchObject({ kind: 'error', code: 'target-conflict' })
    expect(h.session.read()).toMatchObject({ model: { source: '人的新正文' }, undoDepth: 1 })
    await h.gateway.stop(runId)
  })

  it.each(['target-first', 'content-first', 'final-only'] as const)('edits the frozen field using a real read receipt alias (%s), preserving its neighbors and one History entry', async mode => {
    let h!: Awaited<ReturnType<typeof fixture>>, requests = 0, original = '', alias = ''
    const callResponse = (request: ModelRequest, call: { id: string; name: string; argumentsText: string }): Extract<ModelEvent, { type: 'response.completed' }> => ({
      ...completed(request, '', false), finishReason: 'tool_calls', toolCalls: [call], assistant: { role: 'assistant', content: null,
        tool_calls: [{ id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } }] },
    })
    const provider: ModelProvider = { async *stream(request) {
      if (++requests === 1) {
        const prefix = '当前默认语义目标 target='
        const context = request.messages.find(message => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith(prefix))?.content
        expect(typeof context).toBe('string')
        original = JSON.parse((context as string).slice(prefix.length).split(' 的内容与属性（数据）：\n')[0]!) as string
        yield callResponse(request, { id: 'read-current', name: 'read', argumentsText: JSON.stringify({ target: original }) })
      } else if (requests === 2) {
        const receipt = request.messages.filter(message => message.role === 'tool').at(-1)?.content
        expect(typeof receipt).toBe('string')
        const observed = JSON.parse(receipt as string) as { kind: string; data: { target: string; text: string; truncated: boolean } }
        expect(observed).toMatchObject({ kind: 'read', data: { text: 'OLD', truncated: false } })
        alias = observed.data.target
        expect(alias).not.toBe(original)
        const argumentsText = JSON.stringify(mode === 'content-first' ? { content: 'AI 精确补充', target: alias } : { target: alias, content: 'AI 精确补充' })
        if (mode !== 'final-only') {
          const boundary = mode === 'content-first' ? argumentsText.indexOf('","target"') : argumentsText.length - 2
          yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'replace', name: 'text.replace', argumentsDelta: argumentsText.slice(0, boundary) }
          expect(h.edits.list(h.session.documentId)[0]?.value).toBe('AI 精确补充')
          expect(h.session.read()).toMatchObject({ model: { source: '前文 OLD 后文' }, undoDepth: 0 })
          if (mode === 'content-first') {
            // The draft already began with the frozen default; only this tail reveals the read alias.
            yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, argumentsDelta: argumentsText.slice(boundary) }
            expect(h.edits.list(h.session.documentId)).toHaveLength(1)
            expect(h.edits.list(h.session.documentId)[0]?.value).toBe('AI 精确补充')
          }
        }
        yield callResponse(request, { id: 'replace', name: 'text.replace', argumentsText })
      } else {
        expect(requests).toBe(3)
        yield completed(request, '已保留邻文并修改所选字段。', false)
      }
    } }
    h = await fixture(provider)
    const begins = vi.spyOn(h.edits, 'begin')
    const target = { kind: 'markdown-range' as const, from: 3, to: 6 }
    const start = await h.engine.start({ ...h.input, documents: [{ documentId: h.session.documentId, writable: [target], selection: [target] }],
      contentOutput: { ...h.input.contentOutput!, target } })
    const result = await h.engine.wait(start.runId)
    expect(result.status, JSON.stringify(result)).toBe('completed')
    expect(result.tools).toHaveLength(2)
    expect(result.tools[1]).toMatchObject({ call: { name: 'text.replace', input: { target: alias, content: 'AI 精确补充' } },
      result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(h.session.read()).toMatchObject({ model: { source: '前文 AI 精确补充 后文' }, undoDepth: 1 })
    expect(h.edits.list(h.session.documentId)).toEqual([])
    if (mode !== 'final-only') {
      expect(begins).toHaveBeenCalledTimes(1)
      expect(begins.mock.calls[0]![0].targetHandle).toBe(mode === 'content-first' ? original : alias)
    }
    expect(requests).toBe(3)
  })

  it('rolls back an unauthorized initial default target and permits a clean retry with the exact grant', async () => {
    const h = await fixture({ async *stream() { throw new Error('Gateway-only fixture cannot send a model request') } })
    let begins = 0, stops = 0
    h.gateway.configureHostServices({ beginRun: async () => { begins++ }, stopRun: async () => { stops++ } })
    const runId = 'initial-target-rollback'
    const grant = { runId, actor: 'agent' as const, documents: [{ documentId: h.session.documentId,
      writable: [{ kind: 'markdown-range' as const, from: 3, to: 6 }] }], contentOutput: h.input.contentOutput }
    await expect(h.gateway.beginRun(grant)).rejects.toMatchObject({ code: 'not-authorized' })
    expect(h.gateway.runtimeCounts(runId)).toMatchObject({ activeRuns: 0, handles: 0, host: { runs: 0 } })
    expect({ begins, stops }).toEqual({ begins: 1, stops: 1 })
    const before = h.session.read()
    await h.gateway.beginRun({ ...grant, documents: h.input.documents })
    expect(await h.gateway.execute(runId, 'default-replace', { name: 'text.replace', input: { content: '只走正式写入' } }))
      .toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(h.session.read()).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1, model: { source: '只走正式写入' } })
    await h.gateway.stop(runId)
    await expect(h.gateway.issueTarget(runId, h.session.documentId, { kind: 'document' })).rejects.toMatchObject({ code: 'run-stopped' })
  })
  it('publishes no authority while preparing the default target and respects a closing generation before publish', async () => {
    const h = await fixture({ async *stream() { throw new Error('Gateway-only fixture cannot send a model request') } })
    const entered = deferred(), release = deferred(), drain = h.session.drain.bind(h.session)
    let calls = 0
    vi.spyOn(h.session, 'drain').mockImplementation(async () => {
      const snapshot = await drain()
      if (++calls === 2) { entered.resolve(); await release.promise }
      return snapshot
    })
    const runId = 'initial-target-closing', before = h.session.read()
    const pending = h.gateway.beginRun({ runId, actor: 'agent', documents: h.input.documents, contentOutput: h.input.contentOutput })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'document-write-tasks-blocked' })
    await entered.promise
    await expect(h.gateway.issueTarget(runId, h.session.documentId, { kind: 'document' })).rejects.toMatchObject({ code: 'unknown-run' })
    await h.gateway.withWriteTaskBarrier([h.session.documentId], async () => { release.resolve(); await rejected })
    expect(h.gateway.runtimeCounts(runId)).toMatchObject({ activeRuns: 0, handles: 0, host: { runs: 0 } })
    expect(h.session.read()).toEqual(before)
  })
  it('receives complete text at its default tool target, applies once through canonical history, and does not apply ordinary chat or replay a settled continuation', async () => {
    const source = '完整正文'.repeat(1500) + '尾部不可截断', requests: ModelRequest[] = []
    let h!: Awaited<ReturnType<typeof fixture>>
    const provider: ModelProvider = { async *stream(request) {
      requests.push(request)
      if (requests.length === 1) {
        expect(request.tools?.some(tool => tool.name === 'text.replace')).toBe(true)
        expect(JSON.stringify(request.messages)).toContain('尾部不可截断')
        expect(JSON.stringify(request.messages)).toContain('text.replace')
        yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'replace', name: 'text.replace', argumentsDelta: '{"content":"改写' }
        expect(h.edits.list(h.session.documentId)[0]?.value).toBe('改写')
        expect(h.session.read()).toMatchObject({ model: { source }, undoDepth: 0 })
        yield completed(request, '改写后的完整正文')
      } else {
        expect(request.tools?.length).toBeGreaterThan(0)
        yield completed(request, '这只是对所选正文的解释。', false)
      }
    } }
    h = await fixture(provider, source)
    const start = await h.engine.start(h.input), result = await h.engine.wait(start.runId)
    expect(result.status, JSON.stringify(result)).toBe('completed')
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0]).toMatchObject({ call: { name: 'text.replace' }, result: { kind: 'document-operation', result: { status: 'applied' } } })
    expect(result.messages.some(message => message.role === 'tool')).toBe(true)
    expect(h.session.read()).toMatchObject({ model: { source: '改写后的完整正文' }, undoDepth: 1 })
    expect(h.edits.list(h.session.documentId)).toEqual([])
    expect((await h.runs.read(start.runId))?.input.contentOutput).toEqual(h.input.contentOutput)
    const target = { kind: 'markdown-range' as const, from: 0, to: '改写后的完整正文'.length }
    const current = { ...h.input, taskId: randomUUID(), documents: [{ documentId: h.session.documentId, writable: [target], selection: [target] }],
      contentOutput: { ...h.input.contentOutput!, target } }
    const resumed = await h.engine.start(current, { runId: start.runId, facts: '', sameTask: true })
    const restored = await h.engine.wait(resumed.runId)
    expect(restored.status).toBe('completed')
    expect(executionFinalReply(restored)).toBeNull()
    expect(requests).toHaveLength(2)
    const newAsk = await h.engine.start({ ...current, taskId: randomUUID() }, { runId: start.runId, facts: '', sameTask: false })
    expect((await h.engine.wait(newAsk.runId)).status).toBe('completed')
    expect(requests).toHaveLength(3)
    expect(h.session.read().undoDepth).toBe(1)
    const { contentOutput: _output, ...ordinary } = current
    const chat = await h.engine.start({ ...ordinary, taskId: randomUUID(), instruction: '解释这段话，不修改',
      selection: { ...selection, connection: { ...selection.connection, capabilities: { ...selection.connection.capabilities, tools: 'supported' } } } })
    expect((await h.engine.wait(chat.runId)).tools).toHaveLength(0)
    expect(h.session.read().undoDepth).toBe(1)
    const beforeReadonly = h.session.read()
    const beforeReadonlySequence = beforeReadonly.sequence
    if (typeof beforeReadonlySequence !== 'number') throw new Error('Current Session snapshot omitted its journal sequence')
    const beforeReadonlyJournal = await h.journal.recover(h.session.documentId)
    expect(beforeReadonlyJournal).not.toBeNull()
    const readonly = await h.engine.start({ ...current, taskId: randomUUID(), permission: 'read-only' })
    expect((await h.engine.wait(readonly.runId)).tools).toHaveLength(0)
    expect(readonly.input.contentOutput).toBeUndefined()
    // Retiring the task records its document lease, without changing content, revision or History.
    expect(h.session.read()).toEqual({ ...beforeReadonly, sequence: beforeReadonlySequence + 1 })
    const afterReadonlyJournal = await h.journal.recover(h.session.documentId)
    expect(afterReadonlyJournal).not.toBeNull()
    expect(afterReadonlyJournal!.stoppedRuns).toHaveLength(beforeReadonlyJournal!.stoppedRuns.length + 1)
    expect(afterReadonlyJournal!.stoppedRuns.slice(0, -1)).toEqual(beforeReadonlyJournal!.stoppedRuns)
    expect(beforeReadonlyJournal!.stoppedRuns).not.toContain(afterReadonlyJournal!.stoppedRuns.at(-1))
    await expect(h.engine.start({ ...current, selection: { ...selection, connection: { ...selection.connection, capabilities: { ...selection.connection.capabilities, tools: 'unsupported' } } } })).rejects.toThrow('不支持文档工具')
  })

  it('does not commit late generated text after stopping or after an overlapping human edit', async () => {
    for (const mode of ['stop', 'conflict'] as const) {
      const streamed = deferred(), release = deferred()
      let requests = 0
      const h = await fixture({ async *stream(request, options) {
        if (++requests > 1) {
          yield { type: 'response.failed', requestId: request.requestId, sequence: 1, failure: { outcome: 'rejected', kind: 'configuration', code: 'fixture-conflict-stop', message: 'Conflicting output was rejected; fixture does not retry generation' } }
          return
        }
        options?.signal?.addEventListener('abort', release.resolve, { once: true })
        yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'replace', name: 'text.replace', argumentsDelta: '{"content":"尚未完成' }
        streamed.resolve(); await release.promise
        yield completed(request, '不得覆盖人的内容')
      } })
      const started = await h.engine.start(h.input)
      await streamed.promise
      if (mode === 'stop') await h.engine.stop(started.runId)
      else {
        const before = h.session.read()
        await h.session.execute({ documentId: before.documentId, epoch: before.epoch, operationId: randomUUID(), actor: 'human',
          baseRevision: before.revision, mutation: { type: 'command', command: { type: 'markdown.replace', source: '人的新正文' } } })
        release.resolve()
      }
      const ended = await h.engine.wait(started.runId)
      expect(ended.status).toBe(mode === 'stop' ? 'stopped' : 'failed')
      expect(h.session.read()).toMatchObject({ model: { source: mode === 'stop' ? '前文 OLD 后文' : '人的新正文' }, undoDepth: mode === 'stop' ? 0 : 1 })
      expect(h.edits.list(h.session.documentId)).toEqual([])
      expect(ended.tools.some(tool => tool.result?.kind === 'document-operation' && tool.result.result.status === 'applied')).toBe(false)
    }
  })

  it('freezes direct output through the desktop queue and rejects a changed output mode under the same submission identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-content-queue-')); roots.push(root)
    const documents = new DocumentHostService(path.join(root, 'documents'))
    const filename = path.join(root, 'draft.md'); await fs.writeFile(filename, '待改写正文')
    const document = await documents.open(filename)
    const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
      isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString(),
    } })
    const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
      accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
    await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture' }, vision: null, imageGenerate: null, imageEdit: null } })
    const entered = deferred(), release = deferred(); let requests = 0
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      const at = ++requests
      if (at === 1) { entered.resolve(); await release.promise }
      const payload = JSON.parse(String(init?.body)) as { tools: Array<{ function: { name: string; description: string } }> }
      const name = (prefix: string) => { const tool = payload.tools.find(tool => tool.function.description.startsWith(prefix)); if (!tool) throw new Error('Missing '+prefix); return tool.function.name }
      const delta = at !== 2 ? { role: 'assistant', content: '普通回答' } : { role: 'assistant', tool_calls: [
        { index: 0, id: 'replace', type: 'function', function: { name: name('替换已授权文字字段'), arguments: JSON.stringify({ content: '队列改写正文' }) } },
      ] }
      return new Response(`data: ${JSON.stringify({ id: `reply-${at}`, model: 'fixture', choices: [{ index: 0,
        delta, finish_reason: at !== 2 ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }
    const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings, fetch, authorizeWorkspaceRoot: async wanted => ({ resolvedPath: wanted }) })
    const space = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
    let conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
    const common = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
    const first = await service.operate({ type: 'send', ...common, submissionId: randomUUID(), expectedRevision: conversation.revision, text: '普通问题', documents: [] }) as ExecutionSendResult
    await entered.promise
    conversation = await service.operate({ type: 'conversation', ...common }) as ConversationRecord
    const target = { kind: 'markdown-range' as const, from: 0, to: 5 }
    const output = { kind: 'content' as const, documentId: document.documentId, target }
    const input = { type: 'send' as const, ...common, submissionId: randomUUID(), expectedRevision: conversation.revision, text: '改写正文',
      documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, selection: [target], writable: [target] }], contentOutput: output }
    const queued = await service.operate(input) as ExecutionSendResult
    expect(queued.submission).toMatchObject({ state: 'queued', contentOutput: output })
    expect((await service.submissions.read(input.submissionId))?.start.contentOutput).toEqual(output)
    await expect(service.operate({ ...input, contentOutput: undefined })).rejects.toThrow('同一提交编号')
    release.resolve(); await service.engine.wait(first.run!.runId)
    let second = await service.submissions.read(input.submissionId)
    for (let attempt = 0; !second?.runId && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10)); second = await service.submissions.read(input.submissionId)
    }
    expect(second?.runId).toBeTruthy()
    const result = await service.engine.wait(second!.runId!)
    expect(result.status, JSON.stringify(result)).toBe('completed')
    expect(documents.registry.get(document.documentId).read().model).toMatchObject({ source: '队列改写正文' })
    expect(result.messages.some(message => message.role === 'tool')).toBe(true)
  })
})
