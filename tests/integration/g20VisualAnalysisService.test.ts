import { describe, expect, it, vi } from 'vitest'
import { VisualAnalysisService } from '../../src/main/workbench/execution/VisualAnalysisService'
import type { ModelEvent, ModelSelection } from '../../src/shared/workbench/modelProvider'
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

  it('does not call again after unknown or failed response', async () => {
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
    expect(await service.analyze({ runId: 'run', observation: { ...observation,
      image: { ...observation.image, resourceId: 'new-capture-of-same-page' } }, question: 'What?' }))
      .toMatchObject({ status: 'vision-unavailable', outcome: 'unknown' })
    expect(stream).toHaveBeenCalledOnce()
    expect(facts).toEqual(['sending', 'failed'])
  })

  it('refuses a frozen connection whose image capability is unknown', async () => {
    const stream = vi.fn()
    const service = new VisualAnalysisService({ frozenSelection: () => ({ ...selection, connection: {
      ...selection.connection, capabilities: { ...selection.connection.capabilities, vision: 'unknown' },
    } }), provider: { stream }, observation: { readResource: vi.fn() } })
    expect(await service.analyze({ runId: 'run', observation, question: 'What?' })).toMatchObject({
      status: 'vision-unavailable', reason: expect.stringContaining('尚未验证'),
    })
    expect(stream).not.toHaveBeenCalled()
  })
})
