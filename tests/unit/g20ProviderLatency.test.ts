// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { OpenAIChatProvider } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { ChatGPTResponsesProvider, CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { serverSentEvents } from '../../src/main/workbench/providers/serverSentEvents'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

function request(oauth = false): ModelRequest {
  return { requestId: 'local-diagnostic-test', selection: { model: 'fixture', connection: {
    id: 'fixture', revision: 1, provider: 'fixture', accountId: 'fixture',
    protocol: oauth ? 'chatgpt-responses' : 'openai-chat',
    baseURL: oauth ? CHATGPT_RESPONSES_BASE_URL : 'http://127.0.0.1:1/v1',
    auth: { kind: oauth ? 'oauth' : 'api-key', credentialRef: 'fixture' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  } }, messages: [{ role: 'user', content: 'Local fixture only' }] }
}
const sse = (value: unknown) => new Response(`data: ${JSON.stringify(value)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
const failures = [
  { name: 'Chat transport', kind: 'transport', code: 'transport', input: request(),
    create: (diagnose: () => void | Promise<void>) => new OpenAIChatProvider({
      credentialResolver: async () => 'fixture', fetch: async () => { throw new TypeError('local transport failure') }, onTransportDiagnostic: diagnose,
    }) },
  { name: 'Chat tool protocol', kind: 'protocol', code: 'unsupported-tool-type', input: request(),
    create: (diagnose: () => void | Promise<void>) => new OpenAIChatProvider({
      credentialResolver: async () => 'fixture', fetch: async () => sse({ id: 'fixture', model: 'fixture',
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, type: 'custom' }] }, finish_reason: null }] }), onProtocolShape: diagnose,
    }) },
  { name: 'Responses protocol', kind: 'protocol', code: 'chatgpt-protocol-mismatch', input: request(true),
    create: (diagnose: () => void | Promise<void>) => new ChatGPTResponsesProvider({
      credentialResolver: async () => ({ accessToken: 'fixture', accountId: 'fixture' }),
      fetch: async () => sse({ type: 'response.output_text.delta', delta: 'missing response identity' }), onProtocolError: diagnose,
    }) },
] as const
async function collect(provider: ModelProvider, input: ModelRequest): Promise<ModelEvent[]> {
  const events: ModelEvent[] = []
  for await (const event of provider.stream(input)) events.push(event)
  return events
}

it.each(failures)('$name returns the terminal failure while its diagnostic is still blocked', async test => {
  let reject!: (error: Error) => void
  const pending = new Promise<void>((_, fail) => { reject = fail })
  const diagnose = vi.fn(() => pending)
  let finished = false
  const result = collect(test.create(diagnose), test.input).then(events => { finished = true; return events })
  try {
    // A pending diagnostic must not become part of completing the provider stream.
    await nextTurn()
    expect(finished).toBe(true)
    const events = await result
    expect(diagnose).toHaveBeenCalledOnce()
    expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: test.kind, code: test.code, outcome: 'unknown' } })
    expect(events.some(event => event.type === 'response.completed')).toBe(false)
  } finally {
    // A late diagnostic rejection is observed independently, never an unhandled rejection.
    reject(new Error('local diagnostic write failed'))
    await pending.catch(() => undefined)
    await result
  }
})

it.each(failures)('$name preserves the provider failure when its diagnostic throws synchronously', async test => {
  const diagnose = vi.fn(() => { throw new Error('local diagnostic callback failed') })
  const events = await collect(test.create(diagnose), test.input)
  expect(diagnose).toHaveBeenCalledOnce()
  expect(events.at(-1)).toMatchObject({ type: 'response.failed', failure: { kind: test.kind, code: test.code } })
})

function fragmented(parts: Uint8Array[]) {
  let index = 0
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (index < parts.length) controller.enqueue(parts[index++]); else controller.close()
  } })
}
async function readFrames(parts: Uint8Array[], maxBytes = 1024) {
  const values: string[] = [], stream = fragmented(parts)
  for await (const value of serverSentEvents(stream, maxBytes)) values.push(value)
  expect(stream.locked).toBe(false)
  return values
}

it('preserves SSE UTF-8, BOM, split CRLF, bare CR and incomplete EOF framing across byte boundaries', async () => {
  const packet = Buffer.from('\uFEFF: ping\r\ndata: 甲😀\r\ndata: second\r\n\rdata: tail\n\ndata: unfinished\n')
  const expected = ['甲😀\nsecond', 'tail']
  expect(await readFrames([...packet].map(byte => Uint8Array.of(byte)))).toEqual(expected)
  for (let split = 1; split < packet.length; split++)
    expect(await readFrames([packet.subarray(0, split), packet.subarray(split)])).toEqual(expected)
  expect(await readFrames([Buffer.from('data: final\r'), Buffer.from('\r')])).toEqual(['final'])
})

it('retains fragmented SSE byte limits, rejects invalid UTF-8 and releases a cancelled reader', async () => {
  await expect(readFrames([Buffer.from('data: 123456789012\ndata: 123456789012\n\n')], 20)).rejects.toThrow('response-too-large')
  await expect(readFrames([Buffer.from('data: '), Buffer.from('x'.repeat(20))], 20)).rejects.toThrow('response-too-large')
  await expect(readFrames([Uint8Array.of(0xc3)])).rejects.toThrow()
  // A trailing CR remains part of the unfinished-buffer bound until its next byte/EOF.
  await expect(readFrames([Buffer.from('data: é\r'), Buffer.from('\n\n')], 8)).rejects.toThrow('response-too-large')
  expect(await readFrames([Buffer.from('data: é\r\n\n')], 8)).toEqual(['é'])
  const cancel = vi.fn(), stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(Buffer.from('data: first\n\n')) }, cancel,
  })
  const iterator = serverSentEvents(stream, 1024)
  expect(await iterator.next()).toMatchObject({ value: 'first', done: false })
  await iterator.return(undefined)
  expect(cancel).toHaveBeenCalledOnce()
  expect(stream.locked).toBe(false)
})

it('advertises readable aliases and maps returned calls back to the original catalog names in both protocols', async () => {
  const originalNames = ['file.create', 'html.import', 'text.replace']
  const aliases = ['file_create', 'html_import', 'text_replace']
  for (const oauth of [false, true]) {
    const input = request(oauth)
    input.tools = originalNames.map(name => ({ name, description: `Run ${name}`, inputSchema: { type: 'object' } }))
    const transport: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      expect(body.tools.map((tool: { name?: string; function?: { name: string } }) => oauth ? tool.name : tool.function?.name)).toEqual(aliases)
      const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
      const payload = oauth
        ? frame({ type: 'response.created', response: { id: 'alias-response' } })
          + frame({ type: 'response.completed', response: { id: 'alias-response', status: 'completed', output: aliases.map((name, index) => ({
            type: 'function_call', call_id: `call-${index}`, name, arguments: '{}', status: 'completed',
          })) } })
        : frame({ id: 'alias-response', model: 'fixture', choices: [{ index: 0, finish_reason: 'tool_calls', delta: {
          role: 'assistant', tool_calls: aliases.map((name, index) => ({ index, id: `call-${index}`, type: 'function', function: { name, arguments: '{}' } })),
        } }] }) + 'data: [DONE]\n\n'
      return new Response(payload, { headers: { 'content-type': 'text/event-stream' } })
    }
    const provider = oauth
      ? new ChatGPTResponsesProvider({ credentialResolver: async () => ({ accessToken: 'fixture', accountId: 'fixture' }), fetch: transport })
      : new OpenAIChatProvider({ credentialResolver: async () => 'fixture', fetch: transport })
    const completed = (await collect(provider, input)).at(-1)
    expect(completed?.type).toBe('response.completed')
    if (completed?.type !== 'response.completed') throw new Error('Alias roundtrip did not complete')
    expect(completed.toolCalls.map(call => call.name)).toEqual(originalNames)
    expect(completed.assistant.tool_calls?.map(call => call.function.name)).toEqual(aliases)
    expect(input.tools.map(tool => tool.name)).toEqual(originalNames)
  }
})
