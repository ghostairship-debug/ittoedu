// @vitest-environment node
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CourseV9Driver } from '../../src/core/drivers/CourseV9Driver'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { OpenAIChatProvider, modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import type { ModelSelection } from '../../src/shared/workbench/modelProvider'

const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'))
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function selection(baseURL: string): ModelSelection {
  return { model: 'local-vision', connection: { id: 'fixture', revision: 1, provider: 'fixture',
    protocol: 'openai-chat', baseURL, accountId: 'fixture-account',
    auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' }, billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'supported' } } }
}
function sseCall(name: string, args: unknown) {
  return `data: ${JSON.stringify({ id: 'observe-first', model: 'local-vision', choices: [{ index: 0, delta: {
    tool_calls: [{ index: 0, id: 'observe-call', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`
}
function sseStop() {
  return `data: ${JSON.stringify({ id: 'observe-second', model: 'local-vision', choices: [
    { index: 0, delta: { content: '已观察' }, finish_reason: 'stop' },
  ] })}\n\ndata: [DONE]\n\n`
}

describe('M24 view.observe shared Gateway and model transport', () => {
  it('returns a real run-scoped PNG and appends it only after the complete tool round', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'g20-view-wiring-'))
    cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }))
    const host = new DocumentHostService(path.join(root, 'documents'))
    const model = new CourseV9Driver().load(new Uint8Array(readFileSync('tests/fixtures/course-project-v9/slide-native.h5lesson')))
    const created = await host.internalAPI.create(model, 'course.h5lesson')
    const before = await host.internalAPI.read(created.documentId)
    let captures = 0
    host.tools.configureHostServices({ observations: {
      observe: async input => {
        captures++
        return { source: 'isolated-published', identity: { documentId: input.documentId, epoch: input.epoch,
          revision: input.revision, locationId: input.locationId }, coverage: { width: 1, height: 1 },
          structure: ['fixture'], diagnostics: [], image: { resourceId: 'png-1', mimeType: 'image/png',
            width: 1, height: 1, byteLength: png.byteLength } }
      },
      readResource: async ({ runId, resourceId }) => {
        expect(runId).toBeTruthy()
        expect(resourceId).toBe('png-1')
        return { mimeType: 'image/png', bytes: png }
      },
    } })
    const requests: any[] = []
    const server = createServer(async (request, response) => {
      let raw = ''; for await (const bytes of request) raw += bytes.toString()
      const body = JSON.parse(raw); requests.push(body)
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      if (requests.length === 1) {
        const refs = JSON.parse(String(body.messages[1].content).split('：')[1])
        expect(body.tools.some((item: any) => item.function.name === modelToolWireName('view.observe'))).toBe(true)
        response.end(sseCall(modelToolWireName('view.observe'), { target: refs[0].target }))
      } else response.end(sseStop())
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())) })
    const baseURL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools,
      runs: new ExecutionRunStore(path.join(root, 'runs')),
      events: new ExecutionEventStore({ directory: path.join(root, 'events') }),
      provider: new OpenAIChatProvider({ credentialResolver: async () => 'fixture-key' }) })
    const start = await engine.start({ conversationId: 'conversation', taskId: 'observe', instruction: '看当前页',
      selection: selection(baseURL), documents: [{ documentId: created.documentId, writable: [] }] })
    const result = await engine.wait(start.runId)
    expect(result.status, JSON.stringify(result.failure)).toBe('completed')
    expect(captures).toBe(1)
    expect(requests).toHaveLength(2)
    const second = requests[1].messages
    expect(second.slice(-3).map((item: any) => item.role)).toEqual(['assistant', 'tool', 'user'])
    expect(second.at(-1).content[0].text).toContain('locationId=')
    expect(second.at(-1).content[1].image_url.url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`)
    const after = await host.internalAPI.read(created.documentId)
    expect(after.revision).toBe(before.revision)
    expect(after.undoDepth).toBe(before.undoDepth)
    expect(after.dirty).toBe(before.dirty)
  })
})
