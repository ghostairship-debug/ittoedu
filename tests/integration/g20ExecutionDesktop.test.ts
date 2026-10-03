// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ExternalMcpService } from '../../src/main/workbench/external/ExternalMcpService'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    // Timing marks are persisted asynchronously after the run-end projection.
    // Windows can report ENOTEMPTY while their final rename is still in flight.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { await fs.rm(root, { recursive: true, force: true }); break }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY' || attempt === 4) throw error
        await new Promise<void>(resolve => setTimeout(resolve, 20))
      }
    }
  }
})

function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]) },
    decryptString(value) { const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') },
  }
}
async function fixture(fetch?: typeof globalThis.fetch) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-execution-desktop-')); roots.push(root)
  const workspace = path.join(root, 'workspace'), filename = path.join(workspace, 'draft.md')
  await fs.mkdir(workspace); await fs.writeFile(filename, 'before provider\n')
  const documents = new DocumentHostService(path.join(root, 'journals'))
  const document = await documents.open(filename)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: encryption() })
  const authorizeWorkspaceRoot = vi.fn(async (input: string) => ({ resolvedPath: await fs.realpath(input) }))
  const service = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings, authorizeWorkspaceRoot, fetch })
  return { root, workspace, filename, documents, document, settings, authorizeWorkspaceRoot, service }
}
function reference(document: DocumentSnapshot, writable: Array<{ kind: 'document' } | { kind: 'markdown-range'; from: number; to: number }> = [{ kind: 'document' }]) {
  return { documentId: document.documentId, epoch: document.epoch, revision: document.revision, writable }
}
async function waitForRun(service: ExecutionDesktopService, runId: string): Promise<ExecutionRunRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await service.operate({ type: 'run', runId }) as ExecutionRunRecord | null
    if (run && ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(run.status)) return run
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('run did not settle')
}
async function waitForCompletedConversation(service: ExecutionDesktopService, workspaceId: string, conversationId: string, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const conversation = await service.operate({ type: 'conversation', workspaceId, conversationId }) as { revision: number; messages: Array<{ role: string; runId?: string; text: string }> }
    const events = await service.operate({ type: 'events', conversationId, limit: 100 }) as { events: Array<{ type: string }> }
    if (conversation.messages.some(message => message.role === 'assistant' && message.runId === runId)
      && events.events.some(event => event.type === 'run.end')) return { conversation, events }
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('conversation completion was not projected')
}
function sse(res: import('node:http').ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.end('data: [DONE]\n\n')
}
async function configureConversation(settings: ExecutionSettingsStore, baseURL: string) {
  const saved = await settings.saveConnection({ apiKey: 'fixture-secret', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL, accountId: 'fixture-account', authKind: 'api-key', billing: { kind: 'unknown' },
    capabilities: { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ expectedRevision: 0, roles: {
    conversation: { connectionId: saved.connection.id, model: 'fixture-model' }, vision: null, imageGenerate: null, imageEdit: null,
  } })
}

describe('G20 execution desktop integration', () => {
  it('uses the chosen conversation model for image input when vision is unconfigured and capability is unknown', async () => {
    const requests: Array<{ url: string; model: string; content: unknown }> = []
    const server = createHttpServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { model: string; messages: Array<{ content: unknown }> }
      requests.push({ url: request.url ?? '', model: payload.model, content: payload.messages.at(-1)?.content })
      sse(response, [{ id: 'image-answer', object: 'chat.completion.chunk', model: payload.model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '看到了图片' }, finish_reason: 'stop' }] }])
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address')
    const { workspace, settings, service } = await fixture(fetch)
    await configureConversation(settings, `http://127.0.0.1:${address.port}/v1`)
    const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
    const picture = await service.attachments.receiveBytes({ name: 'picture.png',
      bytes: await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer(),
      source: { kind: 'paste' } })
    const sent = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId,
      conversationId: conversation.conversationId, submissionId: '43333333-3333-4333-8333-444444444444',
      expectedRevision: conversation.revision, text: '这张图是什么？', documents: [],
      attachments: [{ attachmentId: picture.id, representationId: 'original-image', role: 'reference' }] }) as { run: ExecutionRunRecord }
    expect(sent).toMatchObject({ run: { runId: expect.any(String) } })
    const run = await waitForRun(service, sent.run.runId)
    expect(run.status).toBe('completed')
    await waitForCompletedConversation(service, space.workspace.workspaceId, conversation.conversationId, sent.run.runId)
    expect(run.initialPayload?.selectionSource).toMatchObject({ role: 'conversation' })
    expect(run.input.selection.connection.capabilities.vision).toBe('unknown')
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ url: '/v1/chat/completions', model: 'fixture-model' })
    expect(JSON.stringify(requests[0]?.content)).toContain('data:image/png;base64,')

    const selected = (await settings.read()).profile.roles
    const original = await settings.read()
    const connection = original.connections.find(item => item.connection.id === selected.conversation?.connectionId)?.connection
    if (!connection) throw new Error('Missing connection')
    await settings.saveConnection({ id: connection.id, expectedRevision: connection.revision, apiKey: 'fixture-secret',
      connection: { provider: connection.provider, protocol: connection.protocol, baseURL: connection.baseURL,
        accountId: connection.accountId, authKind: 'api-key', billing: connection.billing,
        capabilities: { ...connection.capabilities, vision: 'unsupported' } } })
    const next = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
    await expect(service.operate({ type: 'send', workspaceId: space.workspace.workspaceId,
      conversationId: next.conversationId, submissionId: '43333333-3333-4333-8333-555555555555',
      expectedRevision: next.revision, text: '这张图是什么？', documents: [],
      attachments: [{ attachmentId: picture.id, representationId: 'original-image', role: 'reference' }] }))
      .rejects.toThrow('已确认不支持图片输入')
    expect(requests).toHaveLength(1)
  })
  it('uses a file conversation home as the default formal document reference while preserving the frozen permission', async () => {
    const server = createHttpServer(async (_request, response) => {
      for await (const _chunk of _request) { /* consume the deterministic local request */ }
      sse(response, [
        { id: 'home-answer', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '已看到文件' }, finish_reason: null }] },
        { id: 'home-answer', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      ])
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address')
    const { workspace, filename, document, documents, settings, service } = await fixture(fetch)
    await configureConversation(settings, `http://127.0.0.1:${address.port}/v1`)
    const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
    const created = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId,
      home: { kind: 'file', path: path.basename(filename) } }) as { conversationId: string; revision: number; home: { path: string } }
    expect(created.home.path).toBe('draft.md')
    const other = path.join(workspace, 'other.md')
    await fs.writeFile(other, 'other file\n')
    await documents.internalAPI.open(other) // Focus elsewhere cannot replace the conversation home.
    const sent = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId,
      conversationId: created.conversationId, submissionId: '43333333-3333-4333-8333-333333333333',
      expectedRevision: created.revision, text: '这份文件说了什么？', documents: [], permission: 'read-only' }) as { run: ExecutionRunRecord; submission: { documents: Array<{ documentId: string; writable: unknown[] }> } }
    const run = await waitForRun(service, sent.run.runId)
    expect(run.input.documents).toEqual([{ documentId: document.documentId, writable: [] }])
    await waitForCompletedConversation(service, space.workspace.workspaceId, created.conversationId, sent.run.runId)
    expect(run.input.conversationHome).toMatchObject({ kind: 'file', path: 'draft.md' })
    expect(run.input.workspaceRoot).toBe(await fs.realpath(workspace))
    expect(run.input.conversationHomeRoot).toBe(await fs.realpath(workspace))
    expect(sent.submission.documents).toMatchObject([{ documentId: document.documentId, writable: [] }])
    await expect(service.operate({ type: 'set-conversation-home', workspaceId: space.workspace.workspaceId,
      conversationId: created.conversationId, home: { kind: 'file', path: 'other.md' } })).rejects.toThrow()
  })

  it('keeps authorized workspace identity and conversation drafts orthogonal, including a revision-zero document ref and missing-role send failure', async () => {
    const { workspace, document, authorizeWorkspaceRoot, service } = await fixture()
    const first = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string }; conversations: unknown[] }
    const second = await service.operate({ type: 'workspace', root: workspace }) as typeof first
    expect(first.workspace.workspaceId).toBe(second.workspace.workspaceId)
    expect(second.conversations).toEqual([])
    expect(authorizeWorkspaceRoot).toHaveBeenCalledTimes(2)
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: first.workspace.workspaceId, title: '独立会话' }) as { conversationId: string; revision: number }
    expect(document.revision).toBe(0)
    const drafted = await service.operate({ type: 'draft', workspaceId: first.workspace.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: conversation.revision, text: '保留的输入', documents: [reference(document)] }) as { revision: number; inputDraft: string; frozenContextRefs: Array<{ revision: number }> }
    expect(drafted).toMatchObject({ inputDraft: '保留的输入', frozenContextRefs: [{ revision: 0 }] })
    await expect(service.operate({ type: 'draft', workspaceId: first.workspace.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: conversation.revision, text: '过期输入', documents: [reference(document)] })).rejects.toThrow('本条消息的草稿已在另一处更新')
    await expect(service.operate({ type: 'send', workspaceId: first.workspace.workspaceId, conversationId: conversation.conversationId,
      submissionId: '41111111-1111-4111-8111-111111111111', expectedRevision: drafted.revision, text: '不能发送', documents: [reference(document)] })).rejects.toThrow('尚未配置可用的对话与规划模型')
    expect(await service.operate({ type: 'conversation', workspaceId: first.workspace.workspaceId, conversationId: conversation.conversationId }))
      .toMatchObject({ inputDraft: '保留的输入', frozenContextRefs: [{ documentId: document.documentId, revision: 0 }] })
  })

  it('rejects a closed frozen document with a specific error and preserves its unsent draft', async () => {
    const { workspace, documents, document, service } = await fixture()
    const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
    const frozen = reference(document)
    const drafted = await service.operate({ type: 'draft', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: conversation.revision, text: '关闭文件后保留的草稿', documents: [frozen] }) as { revision: number }
    await documents.registry.close(document.documentId)
    await expect(service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
      submissionId: '42222222-2222-4222-8222-222222222222', expectedRevision: drafted.revision,
      text: '关闭文件后保留的草稿', documents: [frozen] })).rejects.toThrow('目标文档已关闭或重新打开')
    expect(await service.submissions.list()).toHaveLength(0)
    expect(await service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }))
      .toMatchObject({ inputDraft: '关闭文件后保留的草稿', frozenContextRefs: [{ documentId: document.documentId }] })
  })

  it('runs a real HTTP provider tool continuation into an unsaved Markdown session and deletes only its conversation', async () => {
    let requests = 0, firstTarget = '', firstToolWireName = ''
    let firstToolReceipt: unknown
    const server = createHttpServer(async (request, response) => {
      expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions'); expect(request.headers.authorization).toBe('Bearer fixture-secret')
      let body = ''
      for await (const chunk of request) body += chunk
      const payload = JSON.parse(body) as { messages: Array<{ role: string; content?: string; tool_call_id?: string }>; tools: Array<{ function: { name: string; description: string } }> }
      requests += 1
      if (requests === 1) {
        const fixed = payload.messages.find(message => message.role === 'system' && message.content?.startsWith('本次固定文档与权限'))!.content!
        const references = JSON.parse(fixed.slice(fixed.indexOf('：') + 1)) as Array<{ writable: Array<{ target: string }> }>
        firstTarget = references[0]!.writable[0]!.target
        firstToolWireName = payload.tools.find(tool => tool.function.description.startsWith('只替换已授权 Markdown 范围'))!.function.name
        sse(response, [
          { id: 'fixture-response-1', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'fixture-call-1', type: 'function', function: { name: firstToolWireName, arguments: JSON.stringify({ target: firstTarget, content: 'after provider\n' }) } }] }, finish_reason: null }] },
          { id: 'fixture-response-1', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ])
      } else {
        const toolMessage = payload.messages.find(message => message.role === 'tool' && message.tool_call_id === 'fixture-call-1')
        expect(toolMessage).toBeDefined()
        firstToolReceipt = JSON.parse(toolMessage!.content!)
        sse(response, [
          { id: 'fixture-response-2', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '修改已完成' }, finish_reason: null }] },
          { id: 'fixture-response-2', object: 'chat.completion.chunk', model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ])
      }
    })
    servers.push(server)
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address')
    const { root, workspace, filename, documents, document, settings, service } = await fixture(fetch)
    await configureConversation(settings, `http://127.0.0.1:${address.port}/v1`)
    const opened = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
    const conversation = await service.operate({ type: 'create-conversation', workspaceId: opened.workspace.workspaceId }) as { conversationId: string; revision: number }
    const input = await service.operate({ type: 'draft', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: conversation.revision, text: '请替换全文', documents: [reference(document)] }) as { revision: number }
    const sent = await service.operate({ type: 'send', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId,
      submissionId: '42222222-2222-4222-8222-222222222222', expectedRevision: input.revision, text: '请替换全文', documents: [reference(document, [{ kind: 'markdown-range', from: 0, to: 'before provider\n'.length }])] }) as { run: ExecutionRunRecord; conversation: { revision: number; inputDraft: string; runIndex: { builtinRunIds: string[] } } }
    expect(sent.conversation).toMatchObject({ inputDraft: '', runIndex: { builtinRunIds: [sent.run.runId] } })
    const run = await waitForRun(service, sent.run.runId)
    expect(run.status).toBe('completed'); expect(requests).toBe(2); expect(firstTarget).toMatch(/^t/); expect(firstToolWireName).toBe('text_replace')
    expect(firstToolReceipt).toMatchObject({ kind: 'document-operation', result: { status: 'applied', revision: 1 } })
    expect((await fs.readdir(root, { recursive: true })).filter(entry => path.basename(entry) === 'candidate.json')).toEqual([])
    expect(await documents.internalAPI.read(document.documentId)).toMatchObject({ dirty: true, revision: 1, model: { source: 'after provider\n' } })
    expect(await fs.readFile(filename, 'utf8')).toBe('before provider\n')
    const completed = await waitForCompletedConversation(service, opened.workspace.workspaceId, conversation.conversationId, sent.run.runId)
    expect(completed.conversation.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: '修改已完成', runId: sent.run.runId })]))
    expect(completed.events.events.map(event => event.type)).toEqual(expect.arrayContaining(['document.commit', 'run.end']))
    // S07-T05: reopening history is a read-only projection, even when it contains a
    // successful tool call and a committed document edit.
    const beforeReplay = await documents.internalAPI.read(document.documentId)
    const beforeTimeline = await service.operate({ type: 'timeline', conversationId: conversation.conversationId })
    const forbiddenFetch = vi.fn(async () => { throw new Error('历史回放不应请求模型') })
    const execute = vi.spyOn(documents.tools, 'execute')
    const reopened = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings,
      authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: forbiddenFetch })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await reopened.operate({ type: 'conversation', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId }))
        .toEqual(completed.conversation)
      expect(await reopened.operate({ type: 'timeline', conversationId: conversation.conversationId })).toEqual(beforeTimeline)
      expect((await reopened.operate({ type: 'events', conversationId: conversation.conversationId, limit: 100 }) as { events: unknown[] }).events)
        .toEqual(completed.events.events)
    }
    expect(await documents.internalAPI.read(document.documentId)).toEqual(beforeReplay)
    expect(execute).not.toHaveBeenCalled()
    expect(forbiddenFetch).not.toHaveBeenCalled()
    expect(requests).toBe(2)
    const nextDraft = await service.operate({ type: 'draft', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId,
      expectedRevision: completed.conversation.revision, text: '下一条未发送输入', documents: [] }) as { revision: number; inputDraft: string }
    expect(nextDraft.inputDraft).toBe('下一条未发送输入')
    const stop = vi.spyOn(service.engine, 'stop')
    await service.operate({ type: 'delete-conversation', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId, expectedRevision: nextDraft.revision })
    expect(stop).toHaveBeenCalledWith(sent.run.runId)
    expect(await service.operate({ type: 'conversation', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId })).toBeNull()
    expect(await documents.internalAPI.read(document.documentId)).toMatchObject({ model: { source: 'after provider\n' } })
    expect(await fs.readFile(filename, 'utf8')).toBe('before provider\n')
    const afterDelete = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents, settings,
      authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: forbiddenFetch })
    expect(await afterDelete.operate({ type: 'conversation', workspaceId: opened.workspace.workspaceId, conversationId: conversation.conversationId })).toBeNull()
    expect(await afterDelete.submissions.read(sent.run.input.taskId)).toMatchObject({ state: 'accepted', runId: sent.run.runId, failure: { code: 'conversation-deleted' } })
    expect((await afterDelete.engine.read(sent.run.runId))?.status).toBe('completed')
    expect(await afterDelete.writableTasksForDocument(document.documentId)).toEqual({ runIds: [], submissionIds: [] })
    expect(forbiddenFetch).not.toHaveBeenCalled()
    expect(await documents.internalAPI.read(document.documentId)).toMatchObject({ dirty: true, model: { source: 'after provider\n' } })
  })
})


it('M25 retries a failed initialization on the next explicit operation; document close queries never initialize history', async () => {
  const { service, workspace, document } = await fixture()
  const recover = vi.spyOn(service.engine, 'recover')
  expect(await service.writableTasksForDocument(document.documentId)).toEqual({ runIds: [], submissionIds: [] })
  expect(recover).not.toHaveBeenCalled()
  vi.spyOn(service.runs, 'list').mockRejectedValueOnce(new Error('temporary read failure'))
  await expect(service.operate({ type: 'workspace', root: workspace })).rejects.toThrow()
  const result = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { rootPath: string } }
  expect(result.workspace.rootPath).toBe(await fs.realpath(workspace))
  expect(recover).toHaveBeenCalledTimes(1)
})

it('M25 retires an orphan active submission without resurrecting its conversation or replaying its unknown request', async () => {
  const forbiddenFetch = vi.fn(async () => { throw new Error('No model call during recovery') })
  const { root, workspace, filename, documents, document, settings, service } = await fixture(forbiddenFetch)
  await configureConversation(settings, 'http://127.0.0.1:1/v1')
  const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const now = Date.now(), taskId = 'orphan-active-submission', runId = 'orphan-active-run', conversationId = 'deleted-conversation'
  const input = { conversationId, taskId, instruction: '保留未知请求', selection: await settings.snapshot('conversation'),
    documents: [{ documentId: document.documentId, writable: [{ kind: 'document' as const }] }] }
  await service.runs.save({ schemaVersion: 1, runId, version: 1, input,
    status: 'running', createdAt: now, updatedAt: now, messages: [], initialMessageCount: 0,
    requests: [{ requestId: 'dispatched-before-interruption', state: 'sending' }], tools: [] })
  await service.submissions.create({ schemaVersion: 1, submissionId: taskId, workspaceId: space.workspace.workspaceId, conversationId,
    state: 'accepted', mode: 'queue', text: input.instruction, documents: [reference(document)], attachments: [], attachmentIds: [],
    model: { provider: 'fixture', model: 'fixture-model', accountId: 'fixture-account', billing: 'unknown' },
    createdAt: now, updatedAt: now, digest: 'fixture-orphan-active', start: input, runId })
  const afterCrash = new ExecutionDesktopService({ directory: path.join(root, 'desktop'), documents: new DocumentHostService(path.join(root, 'journals')),
    settings, authorizeWorkspaceRoot: async selected => ({ resolvedPath: selected }), fetch: forbiddenFetch })
  await afterCrash.operate({ type: 'workspace', root: workspace })
  expect(await afterCrash.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId })).toBeNull()
  expect(await afterCrash.engine.read(runId)).toMatchObject({ status: 'interrupted',
    requests: [{ state: 'failed', failure: { outcome: 'unknown', code: 'interrupted-request' } }] })
  expect(await afterCrash.submissions.read(taskId)).toMatchObject({ state: 'accepted', runId, failure: { code: 'conversation-deleted' } })
  expect(await afterCrash.writableTasksForDocument(document.documentId)).toEqual({ runIds: [], submissionIds: [] })
  expect(forbiddenFetch).not.toHaveBeenCalled()
  expect(await fs.readFile(filename, 'utf8')).toBe('before provider\n')
  expect((await documents.internalAPI.read(document.documentId)).dirty).toBe(false)
})

it('M25 stops the live writer of a dynamically attached document and blocks attachment across its closing barrier', async () => {
  const pendingFetch = vi.fn((_request: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  const { service, workspace, documents, document, settings } = await fixture(pendingFetch)
  await configureConversation(settings, 'http://127.0.0.1:1/v1')
  const space = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const sent = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    submissionId: '43333333-3333-4333-8333-666666666666', expectedRevision: conversation.revision, text: '等待测试', documents: [] }) as { run: ExecutionRunRecord }
  await vi.waitFor(() => expect(pendingFetch).toHaveBeenCalledTimes(1))
  await documents.tools.withWriteTaskBarrier([document.documentId], async () => {
    await expect(documents.tools.attachRunDocument(sent.run.runId, document.documentId, true)).rejects.toThrow('正在关闭')
  })
  await documents.tools.attachRunDocument(sent.run.runId, document.documentId, true)
  expect(await service.writableTasksForDocument(document.documentId)).toEqual({ runIds: [sent.run.runId], submissionIds: [] })
  expect(await service.stopTasksForDocument(document.documentId)).toEqual({ runIds: [sent.run.runId], submissionIds: [] })
  expect(await service.engine.read(sent.run.runId)).toMatchObject({ status: 'stopped' })
  await expect(documents.tools.issueTarget(sent.run.runId, document.documentId, { kind: 'document' })).rejects.toThrow('已停止')
})


it.each(['pdf', 'pptx', 'png'])('starts a material-home conversation without opening %s as editable text', async extension => {
  const requests: unknown[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    return new Response(`data: ${JSON.stringify({ id: 'material-home', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '材料目录可用' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const f = await fixture(fetcher)
  await configureConversation(f.settings, 'http://127.0.0.1:1/v1')
  const bytes = extension === 'png' ? await sharp({ create: { width: 2, height: 2, channels: 4, background: '#168844' } }).png().toBuffer()
    : extension === 'pdf' ? Buffer.from('%PDF-1.7 source registration fixture, not a parsing test')
      : Buffer.from([80, 75, 3, 4, 1, 2, 3, 4])
  const file = path.join(f.workspace, `source.${extension}`)
  await fs.writeFile(file, bytes)
  const space = await f.service.operate({ type: 'workspace', root: f.workspace }) as { workspace: { workspaceId: string } }
  const current = await f.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId,
    home: { kind: 'file', path: path.basename(file) } }) as { conversationId: string; revision: number }
  const identity = { workspaceId: space.workspace.workspaceId, conversationId: current.conversationId }
  expect(await f.service.operate({ type: 'prepare-documents', ...identity, documents: [] })).toEqual([])
  const sent = await f.service.operate({ type: 'send', ...identity, submissionId: crypto.randomUUID(), expectedRevision: current.revision,
    text: '先列出材料目录', documents: [], permission: 'read-only' }) as { run: ExecutionRunRecord }
  const run = await f.service.engine.wait(sent.run.runId)
  expect(run.status).toBe('completed')
  expect(run.input.documents).toEqual([])
  expect(run.initialPayload?.explicitAttachments).toHaveLength(1)
  expect(run.initialPayload?.explicitAttachments[0]?.delivery).toBe('source')
  expect(run.initialPayload?.totals.imageBytes).toBe(0)
  expect(JSON.stringify(requests)).toContain('index-only')
  expect(JSON.stringify(requests)).not.toContain(bytes.toString('base64'))
  const ref = run.initialPayload!.explicitAttachments[0]!
  const read = await f.service.attachments.readRepresentation(ref.attachmentId, ref.representationId)
  expect(Buffer.from(read.bytes)).toEqual(bytes)
  expect(f.documents.registry.list()).toHaveLength(1) // Only the existing draft.md session.
  await waitForCompletedConversation(f.service, identity.workspaceId, identity.conversationId, run.runId)
})


it.each(['resume-queue', 'run-queued', 'restart-resume'] as const)('reclaims an external handoff with %s through the existing stop barrier and queued identity', async action => {
  const model = vi.fn(async () => new Response(`data: ${JSON.stringify({ id: 'reclaim', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '已继续任务' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
  const f = await fixture(model)
  await configureConversation(f.settings, 'http://127.0.0.1:1/v1')
  const space = await f.service.operate({ type: 'workspace', root: f.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await f.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const identity = { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
  const external = new ExternalMcpService({ conversations: f.service.conversations, engine: f.service.engine,
    registry: f.documents.registry, gateway: f.documents.tools, attachments: f.service.attachments,
    appendEvent: input => f.service.appendExternalEvent(input) })
  f.service.setExternalRevoker(input => external.revokeConversation(input))
  try {
    await f.service.pauseQueueForExternal(identity.conversationId)
    const grant = await external.grant({ ...identity, expectedRevision: conversation.revision, instruction: '外部任务', documents: [reference(f.document)] })
    const submissionId = crypto.randomUUID()
    const queued = await f.service.operate({ type: 'send', ...identity, submissionId, expectedRevision: grant.conversation.revision,
      text: '需要接回的原要求', documents: [] }) as { submission: { state: string }; conversation: { revision: number } }
    expect(queued.submission.state).toBe('queued')
    expect(model).not.toHaveBeenCalled()
    let service = f.service
    let release!: () => void
    let reached!: () => void
    const barrierReached = new Promise<void>(resolve => { reached = resolve })
    if (action === 'restart-resume') {
      await external.close()
      service = new ExecutionDesktopService({ directory: path.join(f.root, 'desktop'), documents: f.documents, settings: f.settings,
        authorizeWorkspaceRoot: f.authorizeWorkspaceRoot, fetch: model })
    } else {
      const stop = f.documents.tools.stop.bind(f.documents.tools)
      vi.spyOn(f.documents.tools, 'stop').mockImplementationOnce(async runId => {
        reached()
        await new Promise<void>(resolve => { release = resolve })
        return stop(runId)
      })
    }
    const reclaim = service.operate({ type: action === 'run-queued' ? 'run-queued' : 'resume-queue', ...identity,
      ...(action === 'run-queued' ? { submissionId } : {}) })
    if (action !== 'restart-resume') {
      await barrierReached
      expect(model).not.toHaveBeenCalled()
      release()
    }
    await reclaim
    const stored = await service.submissions.read(submissionId)
    expect(stored?.state).toBe('accepted')
    expect((await service.engine.wait(stored!.runId!)).status).toBe('completed')
    expect(model).toHaveBeenCalledTimes(1)
    expect(await service.submissions.pausedReason(identity.conversationId)).toBeUndefined()
    expect((await external.list(identity))[0]?.status).not.toBe('active')
    const retained = await service.conversations.readConversation(identity)
    expect(retained?.messages.find(message => message.role === 'user')?.text).toBe('需要接回的原要求')
  } finally { await external.close() }
})

it('runs an accepted queued item with the original identity without replacing a newer composer draft', async () => {
  const f = await fixture(async () => new Response(`data: ${JSON.stringify({ id: 'queued', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '队列完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
  await configureConversation(f.settings, 'http://127.0.0.1:1/v1')
  const space = await f.service.operate({ type: 'workspace', root: f.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await f.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const identity = { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
  await f.service.operate({ type: 'pause-queue', ...identity })
  const id = crypto.randomUUID()
  const accepted = await f.service.operate({ type: 'send', ...identity, submissionId: id, expectedRevision: conversation.revision,
    text: '排队的要求', documents: [] }) as { conversation: { revision: number }; submission: { state: string } }
  expect(accepted.submission.state).toBe('queued')
  const draft = await f.service.operate({ type: 'draft', ...identity, expectedRevision: accepted.conversation.revision,
    text: '下一条未发送的人工要求', documents: [], attachments: [] }) as { revision: number }
  expect(draft.revision).toBeGreaterThan(accepted.conversation.revision)
  const started = await f.service.operate({ type: 'run-queued', ...identity, submissionId: id }) as { run: ExecutionRunRecord; submission: { submissionId: string } }
  expect(started.submission.submissionId).toBe(id)
  await f.service.engine.wait(started.run.runId)
  const repeated = await f.service.operate({ type: 'run-queued', ...identity, submissionId: id }) as { run: ExecutionRunRecord }
  expect(repeated.run.runId).toBe(started.run.runId)
  expect(await f.service.operate({ type: 'conversation', ...identity })).toMatchObject({ inputDraft: '下一条未发送的人工要求' })
  expect((await f.service.runs.list()).filter(run => run.input.taskId === id)).toHaveLength(1)
  await waitForCompletedConversation(f.service, identity.workspaceId, identity.conversationId, started.run.runId)
})


it('stops current work after durably pausing its queue, and starts nothing until explicit resume', async () => {
  let requests = 0, entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const f = await fixture(async (_url, options) => {
    requests++
    if (requests === 1) { entered(); await new Promise<never>((_resolve, reject) => {
      const cancel = () => reject(options?.signal?.reason ?? new Error('stopped'))
      options?.signal?.addEventListener('abort', cancel, { once: true }); if (options?.signal?.aborted) cancel()
    }) }
    return new Response(`data: ${JSON.stringify({ id: 'after-pause', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'finished after user resume' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  await configureConversation(f.settings, 'http://127.0.0.1:1/v1')
  const space = await f.service.operate({ type: 'workspace', root: f.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await f.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const identity = { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
  const first = await f.service.operate({ type: 'send', ...identity, submissionId: crypto.randomUUID(), expectedRevision: conversation.revision,
    text: 'hold current', documents: [] }) as { run: ExecutionRunRecord; conversation: { revision: number } }
  await started
  const second = await f.service.operate({ type: 'send', ...identity, submissionId: crypto.randomUUID(), expectedRevision: first.conversation.revision,
    text: 'queued next', documents: [] }) as { submission: { submissionId: string; state: string } }
  expect(second.submission.state).toBe('queued')
  await f.service.operate({ type: 'pause-queue', ...identity, reason: 'user' })
  await f.service.operate({ type: 'stop', runId: first.run.runId })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(requests).toBe(1)
  expect(await f.service.operate({ type: 'submission', ...identity, submissionId: second.submission.submissionId }))
    .toMatchObject({ state: 'queued', queuePausedReason: 'user' })
  await f.service.operate({ type: 'resume-queue', ...identity })
  await expect.poll(() => requests).toBe(2)
  const after = await f.service.operate({ type: 'submission', ...identity, submissionId: second.submission.submissionId }) as { runId: string }
  await f.service.engine.wait(after.runId)
  await waitForCompletedConversation(f.service, identity.workspaceId, identity.conversationId, after.runId)
})

it('answers a conversation read made on seeing run.end with the record Main writes after the task ends', async () => {
  const f = await fixture(async () => new Response(`data: ${JSON.stringify({ id: 'reply', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: '任务回复' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
  await configureConversation(f.settings, 'http://127.0.0.1:1/v1')
  const space = await f.service.operate({ type: 'workspace', root: f.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await f.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const identity = { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
  // A view reads the record as soon as it sees the end, before Main has written the reply.
  let read: Promise<unknown> | undefined
  f.service.setSinks(event => { if (event.type === 'run.end') read ??= f.service.operate({ type: 'conversation', ...identity }) })
  const sent = await f.service.operate({ type: 'send', ...identity, submissionId: crypto.randomUUID(), expectedRevision: conversation.revision,
    text: '请回复', documents: [] }) as { run: ExecutionRunRecord }
  await f.service.engine.wait(sent.run.runId)
  await expect.poll(() => read).toBeDefined()
  expect(await read).toMatchObject({ messages: [{ role: 'user', text: '请回复' }, { role: 'assistant', runId: sent.run.runId, text: '任务回复' }] })
  await waitForCompletedConversation(f.service, identity.workspaceId, identity.conversationId, sent.run.runId)
})
