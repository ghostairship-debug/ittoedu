// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { modelToolResult } from '../../src/core/tools/modelToolResult'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'
import type { ToolResult } from '../../src/shared/workbench/tools'
import type { ContentApplyResult } from '../../src/core/contentApply/planning/types'
import { residentMcpFixture, type ResidentToolReply } from '../helpers/residentMcpFixture'

const callTool = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  await client.callTool({ name, arguments: args }) as unknown as ResidentToolReply

const selection: ModelSelection = { model: 'local-receipt-fixture', connection: {
  id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId: 'fixture', auth: { kind: 'api-key', credentialRef: 'unused-local-fixture' }, billing: { kind: 'unknown' },
  capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unsupported' },
} }
function complete(request: ModelRequest, name?: string, input?: unknown): Extract<ModelEvent, { type: 'response.completed' }> {
  const calls = name ? [{ id: request.requestId, name, argumentsText: JSON.stringify(input) }] : []
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: 'local-response',
    actualModel: selection.model, nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content: '', ...(calls.length ? { tool_calls: calls.map(call => ({
      id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText },
    })) } : {}) } }
}

it('projects canonical receipts through public MCP and built-in messages while retaining raw transactions and authored reads', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'creation-model-receipt-'))
  let mcp: Awaited<ReturnType<typeof residentMcpFixture>> | undefined
  try {
    const workspaceRoot = path.join(directory, 'workspace')
    await mkdir(workspaceRoot)
    const host = new DocumentHostService(path.join(directory, 'documents'))
    const document = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Receipt'),
      resources: { assets: {}, components: {} } }, 'receipt.h5lesson')
    const originalExecute = host.tools.execute.bind(host.tools), originals: ToolResult[] = []
    const execute = vi.spyOn(host.tools, 'execute').mockImplementation(async (...args) => {
      const result = await originalExecute(...args)
      if (args[2].name === 'project.apply') originals.push(result)
      return result
    })
    mcp = await residentMcpFixture({ host, directory, workspaceRoot })
    mcp.ui.state = { workspaceId: 'space', activeDocumentId: document.documentId }
    const client = await mcp.connect('receipt-projection')
    await callTool(client, 'workbench.state')
    await callTool(client, 'tools.load', { families: ['content'] })
    const read = await callTool(client, 'project.read', { path: 'theme.css' })
    expect(read.isError, JSON.stringify(read.structuredContent.result)).toBe(false)
    const externalCss = '.lesson { color: blue; }'
    const reply = await callTool(client, 'project.apply', { path: 'theme.css', content: externalCss })
    expect(reply.isError, JSON.stringify(reply.structuredContent.result)).toBe(false)
    const externalRaw = originals[0]!
    expect(externalRaw).toMatchObject({ kind: 'read', data: { commit: 'committed', receipt: { status: 'applied' } } })
    const expectedExternal = modelToolResult('project.apply', externalRaw)
    expect(reply.structuredContent.result).toEqual(expectedExternal)
    expect(JSON.parse(reply.content[0]!.text!)).toEqual(expectedExternal)

    let turns = 0
    const requests: ModelRequest[] = []
    const builtinCss = '.lesson { color: green; }'
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      yield ++turns === 1 ? complete(request, 'tools.load', { families: ['content'] })
        : turns === 2 ? complete(request, 'project.read', { path: 'theme.css' })
          : turns === 3 ? complete(request, 'project.apply', { path: 'theme.css', content: builtinCss }) : complete(request)
    } }
    const runs = new ExecutionRunStore(path.join(directory, 'runs'))
    const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs,
      events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
    const started = await engine.start({ conversationId: 'receipt-projection', taskId: 'receipt-projection',
      instruction: 'Apply the theme', selection, workspaceRoot, permission: 'workspace',
      documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
    const finished = await engine.wait(started.runId)
    expect(finished.status).toBe('completed')
    const tool = finished.tools.find(item => item.call.name === 'project.apply')!
    const builtinRaw = originals[1]!
    expect(tool.result).toEqual(builtinRaw)
    expect((await runs.read(started.runId))!.tools.find(item => item.call.name === 'project.apply')!.result).toEqual(builtinRaw)
    const message = requests.at(-1)!.messages.find(item => item.role === 'tool' && item.tool_call_id === tool.providerCallId)!
    expect(JSON.parse(String(message.content))).toEqual(modelToolResult('project.apply', builtinRaw))

    for (const [raw, css] of [[externalRaw, externalCss], [builtinRaw, builtinCss]] as const) {
      if (raw.kind !== 'read') throw new Error('Expected canonical apply envelope')
      const data = raw.data as any, unchanged = structuredClone(raw)
      const projected = modelToolResult('project.apply', raw) as typeof raw
      const receipt = (projected.data as any).receipt
      expect(data.receipt.appliedChanges.changes.some((change: any) => 'value' in change)).toBe(true)
      expect(receipt.appliedChanges).toEqual({ affectedTargets: data.receipt.appliedChanges.affectedTargets,
        changes: data.receipt.appliedChanges.changes.map(({ value: _value, ...change }: any) => change) })
      expect(receipt).toMatchObject({ documentId: document.documentId, operationId: data.receipt.operationId,
        beforeRevision: data.receipt.beforeRevision, revision: data.receipt.revision, persistence: 'recoverable', status: 'applied' })
      expect(projected.data).toMatchObject({ input: { intent: 'canonical', edits: [{ type: 'project.theme.set', fields: ['theme'] }] },
        insertedIds: data.insertedIds, diagnostics: data.diagnostics })
      expect(JSON.stringify(projected.data)).not.toContain(css)
      expect(JSON.stringify(data.input)).toContain(css)
      const direct: ToolResult = { kind: 'document-operation', result: data.receipt, affected: ['stable-handle'] }
      expect(modelToolResult('object.update', direct)).toEqual({ ...direct, result: receipt })
      expect(raw).toEqual(unchanged)
      expect(modelToolResult('project.read', raw)).toBe(raw)
    }
    const authored: ToolResult = { kind: 'read', data: { text: '作者原文'.repeat(12_000),
      receipt: { appliedChanges: { changes: [{ value: 'authored value' }] } }, appliedChanges: 'authored field' } }
    expect(modelToolResult('file.read', authored)).toBe(authored)
    expect(modelToolResult('project.apply', authored)).toBe(authored)
    expect(await host.internalAPI.read(document.documentId)).toMatchObject({ revision: 2, undoDepth: 2,
      model: { project: { theme: { css: builtinCss } } } })
    expect(execute.mock.calls.filter(args => args[2].name === 'project.apply')).toHaveLength(2)
  } finally {
    vi.restoreAllMocks()
    await mcp?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

it.each(['committed', 'not_committed', 'unchanged', 'unknown'] as const)(
  'projects %s HTML/original bytes through both message exits without changing raw run results', async commit => {
    const directory = await mkdtemp(path.join(tmpdir(), 'creation-apply-input-'))
    let mcp: Awaited<ReturnType<typeof residentMcpFixture>> | undefined
    try {
      const workspaceRoot = path.join(directory, 'workspace')
      await mkdir(workspaceRoot)
      const host = new DocumentHostService(path.join(directory, 'documents'))
      const document = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10('Input'),
        resources: { assets: {}, components: {} } }, 'input-projection.h5lesson')
      const source = '<html><body>原件正文不能随回执回传</body></html>'
      const data: ContentApplyResult = { commit, usability: commit === 'not_committed' ? 'unusable' : commit === 'unknown' ? 'unverified' : 'usable',
        delivery: 'not_requested', insertedIds: [], diagnostics: [{ code: 'fixture-diagnostic', level: 'warning', message: '下一步读取目标', repairable: true }],
        input: { intent: 'content', target: { kind: 'instance', instanceId: 'fixture-target' },
          source: { kind: 'html', html: source, original: { filename: 'experiment.html', mimeType: 'text/html', bytes: new TextEncoder().encode(source) } } },
        ...(commit === 'committed' ? { receipt: { status: 'applied', documentId: document.documentId, operationId: 'fixture-operation',
          beforeRevision: 0, revision: 1, persistence: 'recoverable', appliedChanges: { affectedTargets: ['fixture-target'],
            changes: [{ path: ['instances', 'fixture-target', 'data'], exists: true, value: source }] } } } : {}) }
      const raw: ToolResult = { kind: 'read', data: { ...data, path: 'pages/02-实验.html' } }
      const before = structuredClone(raw)
      const originalExecute = host.tools.execute.bind(host.tools)
      vi.spyOn(host.tools, 'execute').mockImplementation(async (...args) =>
        args[2].name === 'project.apply' ? raw : originalExecute(...args))
      // The host result is a fixture; the two public message carriers and raw run persistence are real.
      mcp = await residentMcpFixture({ host, directory, workspaceRoot })
      mcp.ui.state = { workspaceId: 'space', activeDocumentId: document.documentId }
      const client = await mcp.connect(`input-${commit}`)
      await callTool(client, 'workbench.state')
      await callTool(client, 'tools.load', { families: ['content'] })
      const reply = await callTool(client, 'project.apply', { path: 'theme.css', content: '.fixture {}' })
      const expected = modelToolResult('project.apply', raw)
      expect(reply.structuredContent.result).toEqual(expected)
      expect(JSON.parse(reply.content[0]!.text!)).toEqual(expected)

      let turns = 0
      const provider: ModelProvider = { async *stream(request) {
        yield ++turns === 1 ? complete(request, 'tools.load', { families: ['content'] })
          : turns === 2 ? complete(request, 'project.apply', { path: 'theme.css', content: '.fixture {}' }) : complete(request)
      } }
      const runs = new ExecutionRunStore(path.join(directory, 'runs'))
      const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider, runs,
        events: new ExecutionEventStore({ directory: path.join(directory, 'events') }) })
      const started = await engine.start({ conversationId: `input-${commit}`, taskId: `input-${commit}`,
        instruction: 'Apply the content', selection, workspaceRoot, permission: 'workspace',
        documents: [{ documentId: document.documentId, writable: [{ kind: 'document' }] }] })
      const finished = await engine.wait(started.runId)
      const tool = finished.tools.find(item => item.call.name === 'project.apply')!
      const message = finished.messages.find(item => item.role === 'tool' && item.tool_call_id === tool.providerCallId)!
      expect(JSON.parse(String(message.content))).toEqual(expected)
      // wait() reads the existing JSON checkpoint: compare every raw value in that carrier, including all byte indices.
      expect(tool.result).toEqual(JSON.parse(JSON.stringify(raw)))
      expect((await runs.read(started.runId))!.tools.find(item => item.call.name === 'project.apply')!.result).toEqual(JSON.parse(JSON.stringify(raw)))
      expect(JSON.stringify(expected)).not.toContain(source)
      expect((expected as any).data.input.source.original).toEqual({ filename: 'experiment.html', mimeType: 'text/html' })
      expect((expected as any).data).toMatchObject({ commit: data.commit, usability: data.usability, diagnostics: data.diagnostics, path: 'pages/02-实验.html' })
      expect(raw).toEqual(before)
      expect((raw as any).data.input.source.original.bytes).toEqual(new TextEncoder().encode(source))
    } finally {
      vi.restoreAllMocks()
      await mcp?.close()
      await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
    }
  })
