// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL, serializeChatGPTResponsesRequest } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { MarkdownDriver } from '../../src/core/drivers/MarkdownDriver'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import type { ModelEvent, ModelProvider, ModelProviderTiming, ModelRequest } from '../../src/shared/workbench/modelProvider'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
})
const frame = (value: unknown) => 'data: ' + JSON.stringify(value) + '\n\n'
const input = (): ModelRequest => ({
  requestId: 'timing-fixture', messages: [{ role: 'user', content: 'fixture only' }],
  selection: { model: 'fixture-model', connection: {
    id: 'fixture', revision: 1, provider: 'openai', protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL,
    accountId: 'fixture', auth: { kind: 'oauth', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', reasoning: 'supported', vision: 'unknown' },
  } },
})
const final = {
  type: 'response.completed', response: { id: 'response', status: 'completed', output: [
    { type: 'function_call', call_id: 'call', name: 'inspect', arguments: '{}', status: 'completed' },
  ] },
}

it.each([false, true])('distinguishes transport reads, empty tool names, reasoning and content without changing the wire (prepared=%s)', async prepared => {
  let clock = 100, sent = ''
  const snapshots: ModelProviderTiming[] = []
  const request = input()
  const provider = new ChatGPTResponsesProvider({
    now: () => clock,
    credentialResolver: async () => { clock = 130; return { accessToken: 'private-fixture-token', accountId: 'fixture' } },
    fetch: async (_url, init) => {
      sent = String(init?.body); clock = 200
      return new Response(
        frame({ type: 'response.created', response: { id: 'response' } })
        + frame({ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'call', name: 'inspect' } })
        + frame({ type: 'response.reasoning_summary_text.delta', delta: 'reasoning' })
        + frame({ type: 'response.function_call_arguments.delta', output_index: 0, delta: '{}' })
        + frame(final),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  const options = { onTiming: (timing: Readonly<ModelProviderTiming>) => { snapshots.push({ ...timing }) } }
  const events: ModelEvent[] = []
  const stream = prepared ? provider.prepare(request).stream(request.requestId, options) : provider.stream(request, options)
  for await (const event of stream) {
    events.push(event)
    // Deliberate consumer pauses: later parsing of an already read chunk is not network arrival.
    if (event.type === 'response.activity') clock = 280
    else if (event.type === 'response.started') clock = 350
    else if (event.type === 'tool.delta' && !event.argumentsDelta) clock = 420
    else if (event.type === 'reasoning.delta') clock = 900
  }
  expect(events.at(-1)).toMatchObject({ type: 'response.completed', toolCalls: [{ name: 'inspect', argumentsText: '{}' }] })
  expect(snapshots.at(-1)).toEqual({
    startedAt: 100, credentialReadyAt: 130, fetchStartedAt: 130, headersReceivedAt: 200,
    firstBodyReadAt: 200, firstNormalizedEventAt: 200, firstSseFrameAt: 280,
    firstToolNameAt: 350, firstReasoningAt: 420, firstContentAt: 900, terminalEventAt: 900,
  })
  expect(snapshots[0]).toEqual({ startedAt: 100 })
  expect(sent).toBe(serializeChatGPTResponsesRequest(request))
  expect(JSON.stringify(snapshots)).not.toContain('private-fixture-token')
  expect(JSON.stringify(events)).not.toContain('firstBodyReadAt')
})

it('leaves unreached phases absent on an unsent credential failure and isolates a throwing diagnostic observer', async () => {
  const fetch = vi.fn(async () => { throw new Error('must not send') })
  let latest: Readonly<ModelProviderTiming> | undefined
  const provider = new ChatGPTResponsesProvider({
    now: () => 50, fetch, credentialResolver: async () => { throw new Error('private credential failure') },
  })
  const events: ModelEvent[] = []
  for await (const event of provider.stream(input(), { onTiming: timing => { latest = timing; throw new Error('diagnostic unavailable') } })) events.push(event)
  expect(fetch).not.toHaveBeenCalled()
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { outcome: 'not-sent', code: 'credential-unavailable' } })
  expect(latest).toEqual({ startedAt: 50, firstNormalizedEventAt: 50, terminalEventAt: 50 })
  expect(JSON.stringify(events)).not.toContain('private credential failure')
})

it('persists provider observations and consumer persistence time separately from request waiting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-phase-timing-')); directories.push(directory)
  const driver = new MarkdownDriver()
  const registry = new DocumentRegistry({ drivers: [driver], persistence: createDocumentJournal({ directory: path.join(directory, 'documents') }),
    createId: randomUUID, bindingKey: binding => binding.path })
  const gateway = new DocumentToolGateway(registry, [driver], randomUUID)
  const runs = new ExecutionRunStore(path.join(directory, 'runs'))
  const events = new ExecutionEventStore({ directory: path.join(directory, 'events') })
  let clock = 100
  const append = events.append.bind(events)
  vi.spyOn(events, 'append').mockImplementation(async event => {
    if (event.type === 'run.state' && event.data.phase === 'generating') clock += 55
    return append(event)
  })
  const provider: ModelProvider = { async *stream(request, options) {
    clock = 400
    options?.onTiming?.({ startedAt: 300, credentialReadyAt: 330, fetchStartedAt: 340, headersReceivedAt: 380,
      firstBodyReadAt: 390, firstSseFrameAt: 400, firstNormalizedEventAt: 400 })
    yield { requestId: request.requestId, sequence: 1, type: 'response.started', responseId: 'response', actualModel: 'fixture-model' }
    clock = 700
    options?.onTiming?.({ startedAt: 300, credentialReadyAt: 330, fetchStartedAt: 340, headersReceivedAt: 380,
      firstBodyReadAt: 390, firstSseFrameAt: 400, firstNormalizedEventAt: 400, firstContentAt: 700, terminalEventAt: 700 })
    yield { requestId: request.requestId, sequence: 2, type: 'response.completed', responseId: 'response', actualModel: 'fixture-model',
      assistant: { role: 'assistant', content: '完成' }, toolCalls: [], finishReason: 'stop', nativeResponse: {} }
  } }
  const engine = new ExecutionEngine({ registry, gateway, runs, events, provider, now: () => clock })
  const started = await engine.start({ conversationId: 'timing', taskId: 'consume', instruction: '问好', documents: [], selection: input().selection })
  const finished = await engine.wait(started.runId)
  expect(finished.status).toBe('completed')
  expect(finished.requests).toHaveLength(1)
  const request = finished.requests[0]!
  expect(request.firstEventWaitMs).toBe(300)
  expect(request.firstContentWaitMs).toBe(600)
  expect(request.timing).toMatchObject({
    preparationStartedAt: 100, preparationFinishedAt: 100, adapterEnteredAt: 100,
    provider: { headersReceivedAt: 380, firstContentAt: 700 },
    consumption: { events: 2, totalMs: 55, maxMs: 55 },
  })
  expect((await runs.read(started.runId))?.requests[0]?.timing).toEqual(request.timing)
})
