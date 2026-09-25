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
      expectedRevision: conversation.revision, text: '过期输入', documents: [reference(document)] })).rejects.toThrow('会话已被较新的草稿或操作更新')
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
    expect(run.status).toBe('completed'); expect(requests).toBe(2); expect(firstTarget).toMatch(/^t/); expect(firstToolWireName).toMatch(/^tool_/)
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
  })
})
