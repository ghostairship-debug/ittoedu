// @vitest-environment node
import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DocumentRegistry } from '../../src/core/documents/DocumentRegistry'
import { DocumentToolGateway } from '../../src/core/tools/DocumentToolGateway'
import type { AgentFileService } from '../../src/core/tools/AgentFileTools'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

const selection: ModelSelection = { model: 'local-projection-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-local-fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' },
} }
type Call = { id: string; name: string; argumentsText: string }
function complete(request: ModelRequest, calls: Call[]): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'local-response',
    actualModel: 'local-projection-fixture', nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: calls.length ? '' : '检查结束', ...(calls.length ? {
      tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const,
        function: { name: call.name, arguments: call.argumentsText } })),
    } : {}) } }
}

it('persists saved status only for a file owner receipt confirming a saved create write', async () => {
  const output = path.resolve('output/g20/m06/file-save-projection-20261001')
  await mkdir(output, { recursive: true })
  const directory = await mkdtemp(path.join(output, 'fixture-'))
  const workspaceRoot = path.join(directory, 'workspace')
  await mkdir(workspaceRoot)
  const filename = path.join(workspaceRoot, 'draft.html')
  const readContent = '<p>created</p> https://example.org/lesson'
  const registry = new DocumentRegistry({ drivers: [], createId: randomUUID, bindingKey: binding => binding.path,
    persistence: { append: async () => {}, save: async () => { throw new Error('No document save is needed for projection') } } })
  const gateway = new DocumentToolGateway(registry, [], randomUUID)
  const ownerCalls: string[] = []
  // These are owner receipts, not physical file writes: this test isolates the
  // Engine's projection into the real durable event store.
  const files: AgentFileService = {
    preflightCreate: async () => ({ directory: workspaceRoot, outside: false }),
    preflightMutation: async () => ({ paths: [filename], outside: false }),
    execute: async (_context, name, raw) => {
      const input = raw as { mode?: string }
      ownerCalls.push(name === 'file.write' ? `${name}:${input.mode}` : name)
      if (name === 'file.read') return { data: { path: filename, text: readContent, offset: 0, total: readContent.length,
        version: 'fixture-v1', dirty: false, truncated: false } }
      if (name === 'file.write' && input.mode === 'create') return { data: { path: filename,
        operation: { status: 'success' }, saved: true, afterVersion: 'fixture-v1' } }
      if (name === 'file.write' && input.mode === 'replace') return { data: { path: filename,
        status: 'applied', saved: false, dirty: true, beforeVersion: 'fixture-v1', afterVersion: 'fixture-v2' } }
      throw new Error(`Unexpected file call: ${name}`)
    },
  }
  let turns = 0
  const provider: ModelProvider = { async *stream(request) {
    yield complete(request, ++turns === 1 ? [
      { id: 'created-write', name: 'file.write', argumentsText: JSON.stringify({ mode: 'create', path: 'draft.html', content: '<p>created</p>' }) },
      { id: 'read-file', name: 'file.read', argumentsText: JSON.stringify({ path: 'draft.html' }) },
      { id: 'unsaved-write', name: 'file.write', argumentsText: JSON.stringify({ mode: 'replace', path: 'draft.html', content: '<p>edited</p>', expectedVersion: 'fixture-v1' }) },
    ] : [])
  } }
  const eventDirectory = path.join(directory, 'events')
  const engine = new ExecutionEngine({ registry, gateway, provider, files,
    runs: new ExecutionRunStore(path.join(directory, 'runs')), events: new ExecutionEventStore({ directory: eventDirectory }) })
  const started = await engine.start({ conversationId: 'save-projection', taskId: 'owner-receipts',
    instruction: '检查保存事实投影', selection, documents: [], permission: 'workspace', workspaceRoot })
  const finished = await engine.wait(started.runId)
  expect(ownerCalls).toEqual(['file.write:create', 'file.read', 'file.write:replace'])
  expect(finished.tools).toHaveLength(3)
  expect(finished.tools.every(tool => tool.state === 'returned' && tool.result?.kind === 'read')).toBe(true)
  // Reopen the store to prove the save fact survived durable serialization.
  const durable = new ExecutionEventStore({ directory: eventDirectory })
  const page = await durable.readPage({ conversationId: 'save-projection', limit: 200 })
  const projection = await durable.snapshot('save-projection')
  const facts = finished.tools.map(tool => {
    const finalEvent = page.events.filter(event => event.type === 'tool' && event.itemId === tool.callId).at(-1)
    const item = projection.items.find(item => item.type === 'tool' && item.itemId === tool.callId)
    expect(finalEvent).toBeDefined()
    expect(item).toBeDefined()
    const expected = tool.providerCallId === 'created-write' ? 'saved' : undefined
    expect(finalEvent!.data.saveStatus).toBe(expected)
    expect(item!.data.saveStatus).toBe(expected)
    if (expected === 'saved') expect(item!.data.documentName).toBe('draft.html')
    if (tool.call.name === 'file.read') {
      expect(item!.data.output).toContain('https://example.org/lesson')
      expect(item!.data.output).not.toContain(workspaceRoot.replace(/\\/g, '\\\\'))
    }
    return { providerCallId: tool.providerCallId, toolName: tool.call.name,
      durableSaveStatus: finalEvent!.data.saveStatus ?? null, projectedSaveStatus: item!.data.saveStatus ?? null }
  })
  await writeFile(path.join(output, 'projection-evidence.json'), JSON.stringify({ runId: finished.runId,
    localProviderOnly: true, networkRequests: 0, ownerReceiptsOnly: true, reopenedEventStore: true, facts }, null, 2) + '\n')
})
