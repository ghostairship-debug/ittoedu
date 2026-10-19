import { describe, expect, it, vi } from 'vitest'
import { VisualAnalysisService } from '../../src/main/workbench/execution/VisualAnalysisService'
import type { ModelChatMessage, ModelEvent, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ObservationResult } from '../../src/shared/workbench/toolPorts'

const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const observation: ObservationResult = { source: 'isolated-published',
  identity: { documentId: 'd', epoch: 'e', revision: 4, locationId: 'page-2' },
  coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
  image: { resourceId: 'image', mimeType: 'image/png', width: 1, height: 1, byteLength: bytes.byteLength } }
const selection = { model: 'vision-model', connection: { id: 'vision-connection', billing: { kind: 'metered' },
  capabilities: { vision: 'supported' } } } as ModelSelection

describe('frozen visual fallback', () => {
  it('returns explicit gap without sending when no vision role was frozen', async () => {
    const stream = vi.fn()
    const service = new VisualAnalysisService({ frozenSelection: () => null,
      provider: { stream }, observation: { readResource: vi.fn() } })
    expect(await service.analyze({ runId: 'run', observation, question: 'What?' })).toMatchObject({ status: 'vision-unavailable' })
    expect(stream).not.toHaveBeenCalled()
  })

  it('sends one no-tool request with real bytes through the frozen selection', async () => {
    const facts: string[] = []
    const stream = vi.fn(async function* (_request: unknown): AsyncIterable<ModelEvent> {
      yield { requestId: 'r', sequence: 1, type: 'response.completed', responseId: 'response', actualModel: 'actual-vision',
        assistant: { role: 'assistant', content: '画面有两个图形。' }, toolCalls: [], finishReason: 'stop', nativeResponse: {},
        usage: { inputTokens: 24, outputTokens: 8, raw: {} } }
    })
    const service = new VisualAnalysisService({ frozenSelection: () => selection,
      provider: { stream }, observation: { readResource: async () => ({ mimeType: 'image/png', bytes }) } })
    expect(await service.analyze({ runId: 'run', observation, question: '图中有什么？',
      onRequestEvent: async event => { facts.push(event.type); if (event.type === 'completed') expect(event.usage?.inputTokens).toBe(24) },
    })).toEqual({ status: 'analyzed',
      conclusion: '画面有两个图形。', actualModel: 'actual-vision',
      selection: { model: 'vision-model', connection: 'vision-connection', billing: 'metered' } })
    expect(stream).toHaveBeenCalledOnce()
    expect(facts).toEqual(['sending', 'completed'])
    expect(stream.mock.calls[0]![0]).toMatchObject({ selection, tools: [], messages: [
      { role: 'system' }, { role: 'user', content: [{ type: 'text' }, { type: 'image_url' }] }, { role: 'user' },
    ] })
  })

  it('does not replay the same unknown request and allows a distinct observation purpose or capture', async () => {
    const facts: string[] = []
    const stream = vi.fn(async function* (): AsyncIterable<ModelEvent> {
      yield { requestId: 'r', sequence: 1, type: 'response.failed', failure: {
        outcome: 'unknown', kind: 'transport', code: 'connection-lost', message: 'lost' } }
    })
    const service = new VisualAnalysisService({ frozenSelection: () => selection,
      provider: { stream }, observation: { readResource: async () => ({ mimeType: 'image/png', bytes }) } })
    expect(await service.analyze({ runId: 'run', observation, question: 'What?',
      onRequestEvent: async event => { facts.push(event.type) },
    })).toMatchObject({ status: 'vision-unavailable', outcome: 'unknown' })
    expect(await service.analyze({ runId: 'run', observation, question: 'What?' }))
      .toMatchObject({ status: 'vision-unavailable', outcome: 'unknown' })
    expect(stream).toHaveBeenCalledOnce()
    await service.analyze({ runId: 'run', observation, question: 'Is the title clipped?' })
    expect(await service.analyze({ runId: 'run', observation: { ...observation,
      image: { ...observation.image, resourceId: 'new-capture-of-same-page' } }, question: 'What?' }))
      .toMatchObject({ status: 'vision-unavailable', outcome: 'unknown' })
    expect(stream).toHaveBeenCalledTimes(3)
    expect(facts).toEqual(['sending', 'failed'])
  })

  it('analyzes a tool-returned image message once per source through the frozen selection', async () => {
    const stream = vi.fn(async function* (_request: unknown): AsyncIterable<ModelEvent> {
      yield { requestId: 'r', sequence: 1, type: 'response.completed', responseId: 'response', actualModel: 'actual-vision',
        assistant: { role: 'assistant', content: '红色方块。' }, toolCalls: [], finishReason: 'stop', nativeResponse: {} }
    })
    const service = new VisualAnalysisService({ frozenSelection: () => selection,
      provider: { stream }, observation: { readResource: vi.fn() } })
    const source: ModelChatMessage = { role: 'user', content: [{ type: 'text', text: '已取回材料原图' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` } }] }
    const input = { runId: 'run', sourceId: 'run:run:4', source, question: '图里是什么？' }
    expect(await service.analyzeImage(input)).toMatchObject({ status: 'analyzed', conclusion: '红色方块。', selection: { model: 'vision-model' } })
    expect(await service.analyzeImage(input)).toMatchObject({ status: 'analyzed' })
    expect(stream).toHaveBeenCalledOnce()
    expect(stream.mock.calls[0]![0]).toMatchObject({ selection, tools: [], messages: [
      { role: 'system' }, { role: 'user', content: source.content }, { role: 'user', content: '问题：图里是什么？' },
    ] })
  })

  it('refuses only an explicitly unsupported frozen image capability', async () => {
    const stream = vi.fn()
    const service = new VisualAnalysisService({ frozenSelection: () => ({ ...selection, connection: {
      ...selection.connection, capabilities: { ...selection.connection.capabilities, vision: 'unsupported' },
    } }), provider: { stream }, observation: { readResource: vi.fn() } })
    expect(await service.analyze({ runId: 'run', observation, question: 'What?' })).toMatchObject({
      status: 'vision-unavailable', reason: expect.stringContaining('不支持图片'),
    })
    expect(stream).not.toHaveBeenCalled()
  })

  it('uses the frozen unknown image capability once, without a probe or model switch', async () => {
    const stream = vi.fn(async function* (_request: ModelRequest): AsyncIterable<ModelEvent> {
      yield { requestId: 'r', sequence: 1, type: 'response.completed', responseId: 'response',
        assistant: { role: 'assistant', content: '看到了真实截图。' }, toolCalls: [], finishReason: 'stop', nativeResponse: {} }
    })
    const unknown = { ...selection, connection: { ...selection.connection,
      capabilities: { ...selection.connection.capabilities, vision: 'unknown' as const } } }
    const service = new VisualAnalysisService({ frozenSelection: () => unknown, provider: { stream },
      observation: { readResource: async () => ({ mimeType: 'image/png', bytes }) } })
    const input = { runId: 'run', observation, question: '当前画面是什么？' }
    expect(await service.analyze(input)).toMatchObject({ status: 'analyzed', conclusion: '看到了真实截图。' })
    expect(await service.analyze(input)).toMatchObject({ status: 'analyzed' })
    expect(stream).toHaveBeenCalledOnce()
    expect(stream.mock.calls[0]![0]).toMatchObject({ selection: unknown, tools: [] })
  })
})


it('keys image analysis by full question and actual bytes, preserving reported usage before an unknown ending', async () => {
  const events: unknown[] = []
  const usage = { inputTokens: 41, outputTokens: 7, totalTokens: 48, cachedInputTokens: 22, reasoningTokens: 4, raw: { vendor_counter: 9 } }
  const stream = vi.fn(async function* (): AsyncIterable<ModelEvent> {
    yield { requestId: 'r', sequence: 1, type: 'usage.reported', usage }
    yield { requestId: 'r', sequence: 2, type: 'response.failed', failure: { outcome: 'unknown', kind: 'transport', code: 'lost', message: 'lost' } }
  })
  const service = new VisualAnalysisService({ frozenSelection: () => selection, provider: { stream }, observation: { readResource: vi.fn() } })
  const source: ModelChatMessage = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }
  const input = { runId: 'run', sourceId: 'same', source, question: 'x'.repeat(2100) + ' A', onRequestEvent: async (event: unknown) => { events.push(event) } }
  await Promise.all([service.analyzeImage(input), service.analyzeImage(input)])
  expect(stream).toHaveBeenCalledOnce()
  expect(events).toEqual([expect.objectContaining({ type: 'sending' }), expect.objectContaining({ type: 'usage', usage }), expect.objectContaining({ type: 'failed', failure: { outcome: 'unknown', kind: 'transport', code: 'lost', message: 'lost' } })])
  await service.analyzeImage({ ...input, question: 'x'.repeat(2100) + ' B' })
  await service.analyzeImage({ ...input, source: { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,BBBB' } }] } })
  expect(stream).toHaveBeenCalledTimes(3)
})
