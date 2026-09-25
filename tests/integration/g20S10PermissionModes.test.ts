// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionEngine } from '../../src/main/workbench/execution/ExecutionEngine'
import { ExecutionRunStore } from '../../src/main/workbench/execution/ExecutionRunStore'
import { ExecutionEventStore } from '../../src/main/workbench/execution/ExecutionEventStore'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ExecutionStart } from '../../src/shared/workbench/execution'
import type { ExecutionEvent } from '../../src/shared/workbench/executionEvents'
import type { ExecutionPermissionMode } from '../../src/shared/workbench/executionPermission'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'
import type { ModelEvent, ModelProvider, ModelRequest, ModelSelection } from '../../src/shared/workbench/modelProvider'

// S10-T07 / S04-T06 (Owner 2026-09-24): four permission levels frozen per task and enforced by Main;
// the selected content travels with the task so a local edit needs no first read.
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })
const selection: ModelSelection = { model: 'fixture-model', connection: { id: 'fixture', revision: 1, provider: 'fixture', protocol: 'openai-chat',
  baseURL: 'http://127.0.0.1:1/v1', accountId: 'fixture-account', auth: { kind: 'api-key', credentialRef: 'fixture-secret-ref' },
  billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } }
function complete(request: ModelRequest, calls: { id: string; name: string; argumentsText: string }[] = [], content = '已结束'): Extract<ModelEvent, { type: 'response.completed' }> {
  return { requestId: request.requestId, sequence: 1, type: 'response.completed', responseId: `r-${request.requestId}`, actualModel: 'fixture',
    nativeResponse: {}, finishReason: calls.length ? 'tool_calls' : 'stop', toolCalls: calls,
    assistant: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: call.argumentsText } })) } : {}) } }
}
type Frozen = { documentId: string; target: string; writable: { kind: string; target: string }[]; selection: { kind: string; target: string; writableTarget?: string; content?: { text: string; total: number; truncated: boolean; nextCursor?: string } }[] }[]
const frozenOf = (request: ModelRequest) => JSON.parse(String(request.messages[1]!.content).split('：')[1]) as Frozen
const lastTool = (request: ModelRequest) => { const message = [...request.messages].reverse().find(item => item.role === 'tool'); return message ? JSON.parse(String(message.content)) : undefined }

async function fixture(provider: ModelProvider) {
  const root = await mkdtemp(path.join(tmpdir(), 'g20-permission-'))
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside')
  await mkdir(workspace); await mkdir(outside)
  await writeFile(path.join(workspace, 'inside.md'), '内部 OLD 文本'); await writeFile(path.join(outside, 'outside.md'), '外部 OLD 文本')
  const host = new DocumentHostService(path.join(root, 'journals'))
  const inside = await host.open(path.join(workspace, 'inside.md')), external = await host.open(path.join(outside, 'outside.md'))
  const engine = new ExecutionEngine({ registry: host.registry, gateway: host.tools, provider,
    runs: new ExecutionRunStore(path.join(root, 'runs')), events: new ExecutionEventStore({ directory: path.join(root, 'events') }) })
  const events: ExecutionEvent[] = []
  let notify = () => {}
  engine.subscribe(event => { events.push(event); notify() })
  const nextApproval = async () => {
    for (;;) {
      const open = events.filter(event => event.type === 'tool' && event.data.status === 'approval' && !(event as { seen?: boolean }).seen)
      if (open.length) { (open[0] as { seen?: boolean }).seen = true; return open[0]! }
      await new Promise<void>(resolve => { notify = resolve })
    }
  }
  const start = (permission: ExecutionPermissionMode, documents: ExecutionStart['documents']) => engine.start({ conversationId: 'c', taskId: randomUUID(),
    instruction: '修改', selection, documents, permission, workspaceRoot: workspace })
  const source = (id: string) => { const model = host.registry.get(id).read().model; return model.kind === 'markdown' ? model.source : '' }
  return { host, engine, events, nextApproval, start, inside, external, source }
}
const range = { kind: 'markdown-range' as const, from: 3, to: 6 }
/** A model that replaces the writable range once per listed content (following refreshed handles), then ends. */
function editor(contents: string[], seen: unknown[] = []): ModelProvider {
  let turn = 0, target: string | undefined
  return { async *stream(request) {
    if (turn > 0) {
      const last = lastTool(request); seen.push(last)
      if (last?.kind === 'document-operation' && typeof last.affected?.[0] === 'string') target = last.affected[0]
    }
    target ??= frozenOf(request)[0]!.writable[0]!.target
    const content = contents[turn++]
    if (content === undefined) { yield complete(request); return }
    yield complete(request, [{ id: `edit-${turn}`, name: 'text.replace', argumentsText: JSON.stringify({ target, content }) }])
  } }
}

describe('S10-T07 permission levels', () => {
  it('ask level: every modification waits for approval; allow commits, deny changes nothing, allow-all stops asking', async () => {
    const seen: unknown[] = []
    const h = await fixture(editor(['第一次', '第二次', '第三次', '第四次'], seen))
    const run = await h.start('ask', [{ documentId: h.inside.documentId, writable: [range] }])
    const first = await h.nextApproval()
    expect(first.data.approval).toMatchObject({ summary: '修改正文', reason: 'ask', documents: ['inside.md'] })
    expect(first.data.approval?.preview).toContain('原文：OLD')
    expect(first.data.approval?.preview).toContain('改为：第一次')
    expect(h.source(h.inside.documentId)).toBe('内部 OLD 文本') // pending, never executed
    expect(h.events.some(event => event.type === 'run.state' && event.data.status === 'waiting' && event.data.label === '等待你批准修改')).toBe(true)
    await expect(h.engine.decide({ runId: run.runId, callId: 'wrong', decision: 'allow' })).rejects.toThrow('已经处理')
    await h.engine.decide({ runId: run.runId, callId: first.itemId, decision: 'allow' })
    const second = await h.nextApproval()
    expect(h.source(h.inside.documentId)).toBe('内部 第一次 文本')
    await h.engine.decide({ runId: run.runId, callId: second.itemId, decision: 'deny' })
    const third = await h.nextApproval()
    expect(h.source(h.inside.documentId)).toBe('内部 第一次 文本')
    await h.engine.decide({ runId: run.runId, callId: third.itemId, decision: 'allow-all' })
    const final = await h.engine.wait(run.runId)
    expect(h.source(h.inside.documentId)).toBe('内部 第四次 文本') // the fourth edit ran without another approval
    expect(h.events.filter(event => event.data.status === 'approval')).toHaveLength(3)
    expect(seen[1]).toMatchObject({ kind: 'error', code: 'user-denied' })
    expect(final.status).toBe('completed') // a declined change is the user's decision, not a partial failure
    expect(h.events.filter(event => event.data.decision).map(event => event.data.decision)).toEqual(['allow', 'deny', 'allow-all'])
    await expect(h.engine.decide({ runId: run.runId, callId: third.itemId, decision: 'allow' })).rejects.toThrow('已停止或已结束')
  })

  it('stopping while a modification waits for approval never executes it', async () => {
    const h = await fixture(editor(['不该写入']))
    const run = await h.start('ask', [{ documentId: h.inside.documentId, writable: [range] }])
    const pending = await h.nextApproval()
    const stopped = await h.engine.stop(run.runId)
    expect(stopped).toMatchObject({ status: 'stopped', tools: [{ callId: pending.itemId, result: { kind: 'error', code: 'run-stopped' } }] })
    expect(h.source(h.inside.documentId)).toBe('内部 OLD 文本')
  })

  it('workspace level asks only for documents outside the workspace; full access never asks', async () => {
    const inside = await fixture(editor(['内部直接改']))
    await inside.engine.wait((await inside.start('workspace', [{ documentId: inside.inside.documentId, writable: [range] }])).runId)
    expect(inside.source(inside.inside.documentId)).toBe('内部 内部直接改 文本')
    expect(inside.events.some(event => event.data.status === 'approval')).toBe(false)

    const outside = await fixture(editor(['外部先问']))
    const run = await outside.start('workspace', [{ documentId: outside.external.documentId, writable: [range] }])
    const asked = await outside.nextApproval()
    expect(asked.data.approval).toMatchObject({ reason: 'outside-workspace', documents: ['outside.md'] })
    await outside.engine.decide({ runId: run.runId, callId: asked.itemId, decision: 'allow' })
    await outside.engine.wait(run.runId)
    expect(outside.source(outside.external.documentId)).toBe('外部 外部先问 文本')

    const full = await fixture(editor(['完全访问直接改']))
    await full.engine.wait((await full.start('full', [{ documentId: full.external.documentId, writable: [range] }])).runId)
    expect(full.source(full.external.documentId)).toBe('外部 完全访问直接改 文本')
    expect(full.events.some(event => event.data.status === 'approval')).toBe(false)
  })
})

describe('S04-T06 selected content travels with the task', () => {
  it('sends the selection snapshot and its writable handle in the first request, so one edit completes in two requests', async () => {
    const requests: ModelRequest[] = []
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length > 1) { yield complete(request); return }
      const chosen = frozenOf(request)[0]!.selection[0]!
      yield complete(request, [{ id: 'direct', name: 'text.replace', argumentsText: JSON.stringify({ target: chosen.writableTarget, content: 'NEW' }) }])
    } }
    const h = await fixture(provider)
    const run = await h.engine.wait((await h.start('workspace', [{ documentId: h.inside.documentId, writable: [{ kind: 'document' }, range], selection: [range] }])).runId)
    const [frozen] = frozenOf(requests[0]!)
    expect(frozen!.selection[0]).toMatchObject({ kind: 'markdown-range', content: { text: 'OLD', total: 3, truncated: false } })
    expect(frozen!.selection[0]!.writableTarget).toBe(frozen!.writable[1]!.target)
    expect(frozen!.selection[0]!.target).not.toBe(frozen!.selection[0]!.writableTarget) // the selection handle itself stays read-only
    expect(String(requests[0]!.messages[0]!.content)).toContain('不必先读取')
    expect(run).toMatchObject({ status: 'completed', requests: [{}, {}], tools: [{ call: { name: 'text.replace' }, result: { kind: 'document-operation', result: { status: 'applied' } } }] })
    expect(h.source(h.inside.documentId)).toBe('内部 NEW 文本')
  })

  it('a write based on the snapshot is refused once the selection changed after sending', async () => {
    let hold!: () => void
    const gate = new Promise<void>(resolve => { hold = resolve })
    const seen: unknown[] = []
    let turn = 0
    const provider: ModelProvider = { async *stream(request) {
      if (turn++ > 0) { seen.push(lastTool(request)); yield complete(request); return }
      await gate // the teacher edits the selected words before the model answers
      yield complete(request, [{ id: 'stale', name: 'text.replace', argumentsText: JSON.stringify({ target: frozenOf(request)[0]!.selection[0]!.writableTarget, content: 'NEW' }) }])
    } }
    const h = await fixture(provider)
    const started = await h.start('workspace', [{ documentId: h.inside.documentId, writable: [{ kind: 'document' }, range], selection: [range] }])
    const before = await h.host.internalAPI.read(h.inside.documentId)
    await h.host.internalAPI.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: randomUUID(), actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: '内部 EDITED 文本' } } })
    hold()
    await h.engine.wait(started.runId)
    expect(seen[0]).toMatchObject({ kind: 'error' }) // the snapshot-based write is refused, never applied over the teacher's edit
    expect(h.source(h.inside.documentId)).toBe('内部 EDITED 文本')
  })

  it('an oversized selection sends a capped snapshot and the rest stays readable page by page', async () => {
    const requests: ModelRequest[] = []
    const provider: ModelProvider = { async *stream(request) {
      requests.push(structuredClone(request))
      if (requests.length > 1) { yield complete(request); return }
      const chosen = frozenOf(request)[0]!.selection[0]!
      yield complete(request, [{ id: 'rest', name: 'read', argumentsText: JSON.stringify({ target: chosen.target, cursor: chosen.content!.nextCursor, limit: 40 }) }])
    } }
    const h = await fixture(provider)
    const long = '长'.repeat(6000)
    const before = await h.host.internalAPI.read(h.inside.documentId)
    await h.host.internalAPI.dispatch({ documentId: before.documentId, epoch: before.epoch, baseRevision: before.revision, operationId: randomUUID(), actor: 'human',
      mutation: { type: 'command', command: { type: 'markdown.replace', source: `头${long}尾` } } })
    const whole = { kind: 'markdown-range' as const, from: 1, to: 1 + long.length }
    const run = await h.engine.wait((await h.start('workspace', [{ documentId: h.inside.documentId, writable: [{ kind: 'document' }], selection: [whole] }])).runId)
    const snapshot = frozenOf(requests[0]!)[0]!.selection[0]!.content!
    expect(snapshot).toMatchObject({ total: 6000, truncated: true, nextCursor: expect.any(String) })
    expect(snapshot.text).toBe('长'.repeat(4000))
    // The preview's cursor continues exactly where the snapshot ended.
    expect(lastTool(requests[1]!)).toMatchObject({ kind: 'read', data: { text: '长'.repeat(2000), offset: 4000, total: 6000, truncated: false } })
    expect(run.status).toBe('completed')
  })
})

describe('S10-T07 read-only is enforced by Main', () => {
  it('strips writable scopes whatever the renderer sent, so no modification tool is offered', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'g20-readonly-'))
    cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
    const bodies: { tools?: { function: { name: string } }[] }[] = []
    const fetch = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(`data: ${JSON.stringify({ id: 'r', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '只读回答' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof globalThis.fetch
    const documents = new DocumentHostService(path.join(root, 'documents'))
    const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
      isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => Buffer.from(value).toString() } })
    const connection = await settings.saveConnection({ apiKey: 'fixture', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
      accountId: 'account', authKind: 'api-key', billing: { kind: 'metered' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unknown', reasoning: 'unknown' } } })
    await settings.saveProfile({ roles: { conversation: { connectionId: connection.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null } })
    const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings, fetch, authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
    const space = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
    await writeFile(path.join(root, 'note.md'), '正文')
    const document = await documents.open(path.join(root, 'note.md'))
    const sent = await service.operate({ type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId, submissionId: randomUUID(),
      expectedRevision: conversation.revision, text: '看看', attachments: [], mode: 'queue', permission: 'read-only',
      documents: [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable: [range] }] }) as ExecutionSendResult
    const run = await service.engine.wait(sent.run!.runId)
    expect(sent.submission).toMatchObject({ permission: 'read-only', documents: [{ writable: [] }] })
    expect(run.input).toMatchObject({ permission: 'read-only', documents: [{ writable: [] }] })
    const names = bodies[0]!.tools!.map(tool => tool.function.name)
    expect(names).toEqual(expect.arrayContaining(['read', 'ask_user']))
    expect(names).not.toContain('batch')
    const wireName = (name: string) => `tool_${createHash('sha256').update(name).digest('hex').slice(0, 48)}`
    expect(names).not.toContain(wireName('text.replace'))
    expect(names).not.toContain(wireName('file.create'))
  })
})
