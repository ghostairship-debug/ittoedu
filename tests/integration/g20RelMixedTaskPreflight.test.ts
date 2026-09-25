// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { AgentFileService } from '../../src/main/workbench/execution/AgentFileService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { ModelEvent, ModelProvider, ModelRequest } from '../../src/shared/workbench/modelProvider'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
})

function complete(request: ModelRequest, turn: number, name?: string, input?: object): Extract<ModelEvent, { type: 'response.completed' }> {
  const toolCalls = name ? [{ id: `rel-mixed-${turn}`, name, argumentsText: JSON.stringify(input) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `rel-mixed-response-${turn}`,
    actualModel: 'local-fixture', nativeResponse: {}, finishReason: toolCalls.length ? 'tool_calls' : 'stop', toolCalls,
    assistant: { role: 'assistant', content: toolCalls.length ? '' : '已新建课件，并确认后续工具可用',
      ...(toolCalls.length ? { tool_calls: toolCalls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}

it('REL-T11 zero-cost preflight creates a V9 file from a document-free run and exposes its tool families', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-rel-mixed-preflight-')); roots.push(root)
  const workspace = path.join(root, 'workspace'); await mkdir(workspace)
  const host = new DocumentHostService(path.join(root, 'journal'))
  const filePath = path.join(workspace, '材料创作课件.h5lesson')
  let turn = 0, finalTools: string[] = [], loadedFamilies: string[] = []
  const provider: ModelProvider = { async *stream(request) {
    turn++
    const tools = request.tools?.map(tool => tool.name) ?? []
    if (turn === 1) {
      expect(tools).toContain('file.create')
      expect(tools).not.toContain('tools.load')
      yield complete(request, turn, 'file.create', { name: path.basename(filePath), kind: 'course-v9' }); return
    }
    const latest = [...request.messages].reverse().find(message => message.role === 'tool')
    if (turn === 2) {
      const result = JSON.parse(String(latest?.content))
      expect(result).toMatchObject({ kind: 'read', data: { writable: true, operation: { status: 'success' } } })
      expect(result.data.target).toEqual(expect.any(String))
      expect(tools).toContain('tools.load')
      yield complete(request, turn, 'tools.load', { families: ['navigation', 'interaction', 'media'] }); return
    }
    loadedFamilies = JSON.parse(String(latest?.content)).data.loaded
    finalTools = tools
    yield complete(request, turn)
  } }
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, files: new AgentFileService(host),
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  const started = await engine.start({ conversationId: 'rel-mixed', taskId: 'preflight', instruction: '根据材料新建多页课件',
    documents: [], workspaceRoot: workspace, selection: { model: 'local-fixture', connection: { id: 'local-fixture', revision: 1,
      provider: 'local-fixture', protocol: 'openai-chat', baseURL: 'http://127.0.0.1:9/v1', accountId: 'local-fixture',
      auth: { kind: 'api-key', credentialRef: 'local-fixture' }, billing: { kind: 'unknown' },
      capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } } })
  const result = await engine.wait(started.runId)
  expect(result.status, JSON.stringify({ failure: result.failure, tools: result.tools.map(tool => ({ name: tool.call.name, result: tool.result })) })).toBe('completed')
  expect(result.tools.map(tool => tool.call.name)).toEqual(['file.create', 'tools.load'])
  expect(turn).toBe(3)
  expect(loadedFamilies).toEqual(['navigation', 'interaction', 'media'])
  expect(finalTools).toEqual(expect.arrayContaining(['slide.create', 'interaction.compose', 'media.insert']))
  expect(finalTools).not.toContain('image.generate') // No image provider is configured in this local fixture.
  const archive = openCourseProjectArchive(new Uint8Array(await readFile(filePath)))
  expect(archive.project.surfaces.length).toBeGreaterThan(0)
  expect(host.registry.list().some(snapshot => snapshot.model.kind === 'course-v9' && snapshot.binding.kind === 'file'
    && snapshot.binding.path === filePath)).toBe(true)
})
