// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PayloadCompiler } from '../../src/core/execution/PayloadCompiler'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { EditSessionService } from '../../src/main/workbench/execution/EditSessionService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { serializeModelPayload } from '../../src/main/workbench/providers/ModelProviderRouter'
import { VisualAnalysisService } from '../../src/main/workbench/execution/VisualAnalysisService'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) })
const selection: ModelSelection = { model: 'fixture', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
function complete(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = []): ModelEvent {
  return { type: 'response.completed', requestId: request.requestId, sequence: 2, responseId: request.requestId, actualModel: 'fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: calls.length ? '正在修改' : '完成', ...(calls.length ? { tool_calls: calls.map(call => ({
      id: call.id, type: 'function', function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
async function fixture(provider: ModelProvider, visualAnalysis?: VisualAnalysisService, withCompiler = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'ni01-final-')); roots.push(root)
  const driver = new MarkdownDriver(), registry = new DocumentRegistry({ drivers: [driver],
    persistence: createDocumentJournal({ directory: path.join(root, 'documents') }), createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const compiler = new PayloadCompiler({ attachments: { readRepresentation: async () => { throw new Error('no attachment') } }, serializePayload: serializeModelPayload })
  const edits = new EditSessionService(registry, gateway)
  const engine = new ExecutionEngine({ registry, gateway, provider, edits, ...(withCompiler ? { initialCompiler: compiler } : {}),
    ...(visualAnalysis ? { visualAnalysis } : {}),
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  const session = await registry.create(driver.load(new TextEncoder().encode('OLD tail')), 'draft.md')
  const snapshot = await session.drain()
  const input: ExecutionStart = { conversationId: 'c', taskId: 't', instruction: '改原选区', selection,
    documents: [{ documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
      writable: [{ kind: 'markdown-range', from: 4, to: 8 }], selection: [{ kind: 'markdown-range', from: 4, to: 8 }] }] }
  return { engine, session, input, compiler, edits }
}

it.each([true, false])('NI01 final production payload reaches provider and its manifest describes sent messages (bound=%s)', async bound => {
  const requests: ModelRequest[] = []
  const provider: ModelProvider = { async *stream(request) {
    requests.push(structuredClone(request))
    yield { type: 'response.started', requestId: request.requestId, sequence: 1, responseId: request.requestId, actualModel: 'fixture' }
    yield complete(request)
  } }
  const h = await fixture(provider)
  if (!bound) h.input.documents = []
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect(requests).toHaveLength(1)
  const request = requests[0]!, manifest = final.initialPayload!
  expect(request.messages.some(message => String(message.content).includes('currentDocuments'))).toBe(bound)
  const serialized = serializeModelPayload({ selection: request.selection, messages: request.messages, tools: request.tools ?? [] })
  expect(manifest.payloadDigest).toBe(digest(serialized))
  expect(manifest.totals.serializedBytes).toBe(Buffer.byteLength(serialized))
  expect(manifest.delivery).toMatchObject({ status: 'sent', requestId: request.requestId })
  expect(manifest.automaticContext.map(entry => entry.messageIndex)).toEqual(request.messages.flatMap((_message, index) => index === manifest.userMessageIndex ? [] : [index]))
  for (const entry of manifest.automaticContext) {
    expect(entry.digest).toBe(digest(JSON.stringify(request.messages[entry.messageIndex])))
    expect(entry.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(request.messages[entry.messageIndex])))
  }
  expect(manifest.tools).toEqual(request.tools?.map(tool => ({ name: tool.name, digest: digest(JSON.stringify(tool)) })))
})

it.each([{ sameSource: true, finish: true }, { sameSource: false, finish: true },
  { sameSource: true, finish: false }, { sameSource: false, finish: false }])(
  'NI02 auxiliary vision settles only the same stored source (same=$sameSource, finish=$finish)', async ({ sameSource, finish }) => {
    let visualCalls = 0, turns = 0, sourceId = '', secondSourceId = ''
    const visionSelection = { ...selection, model: 'vision-fixture' }
    const visual = new VisualAnalysisService({ frozenSelection: () => visionSelection,
      observation: { readResource: async () => { throw new Error('no observation resource needed') } },
      provider: { async *stream(request) {
        if (++visualCalls === 1) { yield { type: 'response.failed', requestId: request.requestId, sequence: 1,
          failure: { outcome: 'rejected', kind: 'protocol', code: 'first-vision-rejected', message: 'first attempt rejected' } }; return }
        yield { ...complete(request), assistant: { role: 'assistant', content: '原图分析成功' } } as ModelEvent
      } } })
    const provider: ModelProvider = { async *stream(request) {
      if (++turns <= 2) {
        yield complete(request, [{ id: `reread-original-${turns}`, name: 'context.read', argumentsText: JSON.stringify({ sourceId: turns === 1 ? sourceId : secondSourceId, imageIndexes: [0] }) }]); return
      }
      if (turns === 3) {
        const references = JSON.parse(String(request.messages[1]!.content).split('：')[1]!)
        yield complete(request, [{ id: 'applied-text', name: 'text.replace', argumentsText: JSON.stringify({
          target: references[0].writable[0].target, content: 'DONE' }) }, ...(finish ? [{ id: 'finish', name: 'task.finish', argumentsText: '{}' }] : [])]); return
      }
      yield complete(request)
    } }
    const h = await fixture(provider, visual, false)
    h.input.selection = { ...selection, connection: { ...selection.connection, capabilities: { ...selection.connection.capabilities, vision: 'unsupported' } } }
    h.input.visionSelection = visionSelection
    // Two separate stored sources intentionally use the same bytes: equal pixels do not prove source identity.
    const source = (name: string) => ({ role: 'user' as const, content: [{ type: 'text', text: name },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1kAAAAASUVORK5CYII=' } }] })
    h.input.context = [source('图一原来源'), ...(sameSource ? [] : [source('图二异来源')])]
    const started = await h.engine.start(h.input, undefined, async prepared => {
      sourceId = `run:${prepared.runId}:2`; secondSourceId = `run:${prepared.runId}:${sameSource ? 2 : 3}`
    })
    const final = await h.engine.wait(started.runId)
    expect(final.status, JSON.stringify({ visualCalls, visual: final.visualAnalyses, failure: final.failure,
      tools: final.tools.map(tool => ({ name: tool.call.name, result: tool.result })) })).toBe(sameSource ? 'completed' : 'partial')
    expect(final.visualAnalyses?.[0]).toMatchObject({ status: 'vision-unavailable' })
    expect(final.visualAnalyses?.at(-1), JSON.stringify(final.visualAnalyses)).toMatchObject({ status: 'analyzed' })
    const first = final.visualAnalyses![0]!, last = final.visualAnalyses!.at(-1)!
    expect(last.source === first.source).toBe(sameSource)
    expect(final.requests.find(request => request.kind === 'visual-analysis' && request.state === 'failed')?.failure?.code).toBe('first-vision-rejected')
    expect((await h.session.drain()).model).toMatchObject({ source: 'OLD DONE' })
    expect(final.tools.filter(tool => tool.call.name === 'text.replace')).toHaveLength(1)
  })

it('NI01 accepted selection follows a formal insertion before dispatch and preserves the unselected prefix', async () => {
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns > 1) { yield complete(request); return }
    const references = JSON.parse(String(request.messages[1]!.content).split('：')[1]!)
    expect(references[0].selection[0].content.text).toBe('tail')
    yield complete(request, [{ id: 'replace', name: 'text.replace', argumentsText: JSON.stringify({ target: references[0].writable[0].target, content: 'DONE' }) }])
  } }
  const h = await fixture(provider)
  const snapshot = await h.session.drain()
  await h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: '123 ' } } })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId)
  expect(final.status).toBe('completed')
  expect((await h.session.drain()).model).toMatchObject({ source: '123 OLD DONE' })
})

it('NI01 a real edit inside the accepted selection is refused before provider dispatch', async () => {
  let calls = 0
  const h = await fixture({ async *stream(request) { calls++; yield complete(request) } })
  const snapshot = await h.session.drain()
  await h.session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
    operationId: randomUUID(), actor: 'human', mutation: { type: 'command', command: { type: 'markdown.splice', from: 4, to: 8, text: 'changed' } } })
  await expect(h.engine.start(h.input)).rejects.toThrow('原选区已被其他操作改动')
  expect(calls).toBe(0)
  expect((await h.session.drain()).model).toMatchObject({ source: 'OLD changed' })
})


it.each([true, false])('NI01 sends aggregate content-only output through the canonical writer (streamed=%s)', async streamed => {
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    if (++turns > 1) { yield complete(request); return }
    const raw = JSON.stringify({ content: '新甲\n新乙' }), split = raw.length - 2
    if (streamed) {
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 1, index: 0, id: 'aggregate-content', name: 'text.replace', argumentsDelta: raw.slice(0, split) }
      yield { type: 'tool.delta', requestId: request.requestId, sequence: 2, index: 0, id: 'aggregate-content', name: 'text.replace', argumentsDelta: raw.slice(split) }
    }
    yield complete(request, [{ id: 'aggregate-content', name: 'text.replace', argumentsText: raw }])
  } }
  const h = await fixture(provider), original = h.session.read()
  await h.session.execute({ documentId: original.documentId, epoch: original.epoch, baseRevision: original.revision, operationId: randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: '- 甲\n- 乙' } } })
  const before = h.session.read(), target = { kind: 'text-selection' as const, fragments: [
    { target: { kind: 'markdown-range' as const, from: 2, to: 3 } }, { target: { kind: 'markdown-range' as const, from: 6, to: 7 }, separatorBefore: '\n' },
  ] }
  h.input.documents = [{ documentId: before.documentId, epoch: before.epoch, revision: before.revision, writable: [target], selection: [target] }]
  h.input.contentOutput = { kind: 'replace-text', documentId: before.documentId, target }
  const previews: string[] = []
  const unsubscribe = h.edits.subscribe(event => { if (event.type === 'edit.changed') {
    previews.push(event.snapshot.value)
    expect(h.session.read().model).toMatchObject({ source: '- 甲\n- 乙' })
  } })
  const started = await h.engine.start(h.input), final = await h.engine.wait(started.runId); unsubscribe()
  expect(final.status, JSON.stringify(final.tools)).toBe('completed')
  if (streamed) expect(previews).toContain('新甲\n新乙')
  else expect(previews).toEqual([])
  expect(final.tools.filter(tool => tool.call.name === 'text.replace')).toHaveLength(1)
  expect(h.session.read()).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1, model: { source: '- 新甲\n- 新乙' } })
  expect(h.edits.list(before.documentId)).toEqual([])
})
