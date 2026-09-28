// @vitest-environment node
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { VisualAnalysisService } from '../../src/main/workbench/execution/VisualAnalysisService'
import { OpenAIChatProvider, modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function selection(baseURL: string, model: string, vision: 'supported' | 'unsupported'): ModelSelection {
  return { model, connection: { id: model, revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL,
    accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'fixture' }, billing: { kind: 'metered' },
    capabilities: { tools: 'supported', stream: 'supported', reasoning: 'supported', vision } } }
}
function sse(id: string, model: string, delta: object, finish: string, usage?: object) {
  return `data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    + (usage ? `data: ${JSON.stringify({ id, model, choices: [], usage })}\n\n` : '') + 'data: [DONE]\n\n'
}

it('journals a separate visual request and its usage before returning analysis to the conversation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-visual-wiring-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
  const host = new DocumentHostService(path.join(root, 'documents'))
  const model = new CourseV9Driver().load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson')))
  const created = await host.internalAPI.create(model, 'course.h5lesson')
  const before = await host.internalAPI.read(created.documentId)
  host.tools.configureHostServices({ observations: {
    observe: async input => ({ source: 'isolated-published', identity: { documentId: input.documentId, epoch: input.epoch,
      revision: input.revision, locationId: input.locationId }, coverage: { width: 1, height: 1 }, structure: [], diagnostics: [],
      image: { resourceId: 'fixture-png', mimeType: 'image/png', width: 1, height: 1, byteLength: png.byteLength } }),
    readResource: async () => ({ mimeType: 'image/png', bytes: png }),
  } })
  const requests: any[] = []
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const part of request) raw += part.toString()
    const body = JSON.parse(raw); requests.push(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (requests.length === 1) {
      const refs = JSON.parse(String(body.messages[1].content).split('：')[1])
      response.end(sse('first', 'conversation', { tool_calls: [{ index: 0, id: 'observe', type: 'function',
        function: { name: modelToolWireName('view.observe'), arguments: JSON.stringify({ target: refs[0].target }) } }] }, 'tool_calls'))
    } else if (body.model === 'frozen-vision') {
      expect(body.tools).toBeUndefined()
      expect(body.messages[1].content[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
      response.end(sse('visual', 'frozen-vision', { content: '画面包含一页课程内容。' }, 'stop',
        { prompt_tokens: 24, completion_tokens: 8, total_tokens: 32 }))
    } else response.end(sse('last', 'conversation', { content: '已依据截图分析。' }, 'stop'))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())) })
  const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const provider = new OpenAIChatProvider({ credentialResolver: async () => 'fixture' })
  const visual = new VisualAnalysisService({ frozenSelection: async () => selection(baseURL, 'frozen-vision', 'supported'),
    provider, observation: { readResource: input => host.tools.readObservationResource(input.runId, input.resourceId) } })
  const events = new ExecutionEventStore({ directory: path.join(root, 'events') })
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events, provider, visualAnalysis: visual })
  const start = await engine.start({ conversationId: 'conversation', taskId: 'visual', instruction: '看当前页',
    selection: selection(baseURL, 'conversation', 'unsupported'), visionSelection: selection(baseURL, 'frozen-vision', 'supported'),
    documents: [{ documentId: created.documentId, writable: [] }] })
  const result = await engine.wait(start.runId)
  expect(result.status, JSON.stringify(result.failure)).toBe('completed')
  expect(requests.map(item => item.model)).toEqual(['conversation', 'frozen-vision', 'conversation'])
  expect(result.requests.map(item => [item.kind, item.state])).toEqual([
    [undefined, 'completed'], ['visual-analysis', 'completed'], [undefined, 'completed'],
  ])
  expect(requests[2].messages.at(-1).content).toContain('画面包含一页课程内容')
  const timeline = await events.snapshot('conversation')
  expect(timeline.items.some(item => item.type === 'usage' && item.data.usage?.inputTokens === 24)).toBe(true)
  const after = await host.internalAPI.read(created.documentId)
  expect([after.revision, after.undoDepth, after.dirty]).toEqual([before.revision, before.undoDepth, before.dirty])
})
