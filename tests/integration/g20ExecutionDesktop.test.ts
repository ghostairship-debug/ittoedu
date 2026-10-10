// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { plainDocumentText } from '../../src/shared/document/content'
import { readEditableTargetContent } from '../../src/core/tools/ToolTargets'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { ElementChangeView } from '../../src/shared/workbench/executionDesktop'
import type { ToolTarget } from '../../src/shared/workbench/tools'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import { continueDocumentTargets } from '../../src/main/workbench/execution/continuationTargets'

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

function finalReplyResponse(model: string, text = '修改已完成'): Response {
  return new Response(`data: ${JSON.stringify({ id: 'natural-reply', model, choices: [{ index: 0,
    delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } })
}

it('NI01 startNext retains accepted selection baseline through a preceding queued insertion', async () => {
  let releaseFirst!: () => void, firstArrived!: () => void
  const blocked = new Promise<void>(resolve => { releaseFirst = resolve })
  const arrived = new Promise<void>(resolve => { firstArrived = resolve })
  let calls = 0, queuedPreview: string | undefined
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const refs = JSON.parse(String(payload.messages[1].content).split('：')[1]!)
    const turn = ++calls
    if (turn === 1) { firstArrived(); await blocked }
    const firstTask = turn === 1
    if (turn === 3) {
      sse(response, [{ id: 'queue-read', model: payload.model, choices: [{ index: 0, delta: { role: 'assistant',
        tool_calls: [{ index: 0, id: 'read-original', type: 'function', function: { name: 'read',
          arguments: JSON.stringify({ target: refs[0].selection[0].target }) } }] }, finish_reason: 'tool_calls' }] }])
      return
    }
    const queueTask = turn === 4
    const write = firstTask || queueTask
    if (write) {
      if (queueTask) {
        const read = JSON.parse(payload.messages.findLast((message: { role: string }) => message.role === 'tool').content)
        queuedPreview = read.data.text
      }
      sse(response, [{ id: `queue-${turn}`, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant',
        tool_calls: [{ index: 0, id: `write-${turn}`, type: 'function', function: { name: 'text_replace',
          arguments: JSON.stringify({ target: refs[0].writable[0].target, content: firstTask ? '123 before' : 'DONE' }) } }] }, finish_reason: 'tool_calls' }] }])
    } else sse(response, [{ id: `done-${turn}`, model: payload.model, choices: [{ index: 0,
      delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] }])
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address')
  const h = await fixture(fetch)
  await configureConversation(h.settings, `http://127.0.0.1:${address.port}/v1`)
  const space = await h.service.operate({ type: 'workspace', root: h.workspace }) as { workspace: { workspaceId: string } }
  const current = await h.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const first = await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: current.conversationId,
    expectedRevision: current.revision, submissionId: '43333333-3333-4333-8333-111111111111', text: '插入前缀',
    documents: [reference(h.document, [{ kind: 'markdown-range', from: 0, to: 6 }])] }) as { run: ExecutionRunRecord }
  await arrived
  const latest = await h.service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: current.conversationId }) as { revision: number }
  const original = { kind: 'markdown-range' as const, from: 7, to: 15 }
  await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: current.conversationId,
    expectedRevision: latest.revision, submissionId: '43333333-3333-4333-8333-222222222222', text: '只替换原选区',
    documents: [{ ...reference(h.document, [original]), selection: [original] }], mode: 'queue' }) as { submission: { start: ExecutionRunRecord['input'] } }
  const queued = await h.service.submissions.read('43333333-3333-4333-8333-222222222222')
  expect(queued!.start.documents[0]).toMatchObject({ epoch: h.document.epoch, revision: h.document.revision })
  releaseFirst()
  expect((await waitForRun(h.service, first.run.runId)).status).toBe('completed')
  let next: { runId?: string; state: string } | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    next = await h.service.submissions.read('43333333-3333-4333-8333-222222222222') ?? undefined
    if (next?.runId || next?.state === 'failed') break
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  expect(next?.state).toBe('accepted')
  expect((await waitForRun(h.service, next!.runId!)).status).toBe('completed')
  expect(queuedPreview).toBe('provider')
  expect((await h.documents.internalAPI.read(h.document.documentId)).model).toMatchObject({ source: '123 before DONE\n' })
})
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
  it('keeps a file conversation home as organization without implicitly referencing its file', async () => {
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
    await documents.internalAPI.open(other) // The user has not explicitly referenced either file.
    const sent = await service.operate({ type: 'send', workspaceId: space.workspace.workspaceId,
      conversationId: created.conversationId, submissionId: '43333333-3333-4333-8333-333333333333',
      expectedRevision: created.revision, text: '这份文件说了什么？', documents: [], permission: 'read-only' }) as { run: ExecutionRunRecord; submission: { documents: Array<{ documentId: string; writable: unknown[] }> } }
    const run = await waitForRun(service, sent.run.runId)
    expect(run.input.documents).toEqual([])
    await waitForCompletedConversation(service, space.workspace.workspaceId, created.conversationId, sent.run.runId)
    expect(run.input.conversationHome).toMatchObject({ kind: 'file', path: 'draft.md' })
    expect(run.input.workspaceRoot).toBe(await fs.realpath(workspace))
    expect(run.input.conversationHomeRoot).toBe(await fs.realpath(workspace))
    expect(sent.submission.documents).toEqual([])
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
        firstToolWireName = payload.tools.find(tool => tool.function.name === 'text_replace')!.function.name
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

it('queries a clean document without waiting for unrelated background recovery', async () => {
  const { service, workspace, document } = await fixture()
  let finishRecovery!: () => void
  const pendingRecovery = new Promise<void>(resolve => { finishRecovery = resolve })
  const recover = vi.spyOn(service.engine, 'recover').mockImplementation(async () => { await pendingRecovery; return [] })
  try {
    await service.operate({ type: 'workspace', root: workspace })
    expect(recover).toHaveBeenCalledTimes(1)
    expect(await service.writableTasksForDocument(document.documentId)).toEqual({ runIds: [], submissionIds: [] })
  } finally {
    finishRecovery()
    await service.shutdown()
  }
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


it.each(['pdf', 'pptx', 'png'])('keeps a material-home conversation from implicitly reading or opening %s', async extension => {
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
  expect(run.initialPayload?.explicitAttachments).toHaveLength(0)
  expect(run.initialPayload?.totals.imageBytes).toBe(0)
  expect(JSON.stringify(requests)).not.toContain(path.basename(file))
  expect(JSON.stringify(requests)).not.toContain(bytes.toString('base64'))
  expect(f.documents.registry.list()).toHaveLength(1) // Only the existing draft.md session.
  await waitForCompletedConversation(f.service, identity.workspaceId, identity.conversationId, run.runId)
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


it('NI01 sends captured aggregate ranges after a human insertion, returns a current card receipt, follows it and undoes once', async () => {
  let calls = 0
  const transport: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body))
    if (payload.messages.some((message: { role: string }) => message.role === 'tool')) return finalReplyResponse(payload.model)
    const content = ++calls === 1 ? '新甲\n新乙' : '更甲\n更乙'
    expect(payload.messages.some((message: { content: unknown }) => String(message.content).includes(calls === 1 ? '甲\n乙' : '新甲\n新乙'))).toBe(true)
    const raw = JSON.stringify({ content }), split = raw.length - 2
    const chunks = [
      { id: `aggregate-${calls}`, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', content: '修改已完成', tool_calls: [{ index: 0, id: `replace-${calls}`, type: 'function', function: { name: 'text_replace', arguments: raw.slice(0, split) } }] }, finish_reason: null }] },
      { id: `aggregate-${calls}`, model: payload.model, choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, function: { arguments: raw.slice(split) } },
      ] }, finish_reason: 'tool_calls' }] },
    ]
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const h = await fixture(transport); await configureConversation(h.settings, 'http://127.0.0.1:1/v1')
  const session = h.documents.registry.get(h.document.documentId), initial = session.read()
  await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: '- 甲\n- 乙' } } })
  const captured = session.read(), target: Extract<ToolTarget, { kind: 'text-selection' }> = { kind: 'text-selection', fragments: [
    { target: { kind: 'markdown-range', from: 2, to: 3 } }, { target: { kind: 'markdown-range', from: 6, to: 7 }, separatorBefore: '\n' },
  ] }
  // The caller keeps the original receipt. Main follows these committed disjoint edits.
  await session.execute({ documentId: captured.documentId, epoch: captured.epoch, baseRevision: captured.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 0, text: 'OWNER\n' } } })
  let snapshot = session.read()
  await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 10, to: 11, text: '+' } } })
  const before = session.read()
  const space = await h.service.operate({ type: 'workspace', root: h.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await h.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId, element: { kind: 'element', documentId: captured.documentId, label: '选中正文' } }) as { conversationId: string; revision: number }
  const firstId = '57777777-7777-4777-8777-111111111111'
  const first = await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    expectedRevision: conversation.revision, submissionId: firstId, text: '改选中的两段', documents: [{ documentId: captured.documentId, epoch: captured.epoch,
      revision: captured.revision, writable: [target], selection: [target] }], contentOutput: { kind: 'content', documentId: captured.documentId, target } }) as { run: ExecutionRunRecord }
  expect((await waitForRun(h.service, first.run.runId)).status).toBe('completed')
  await waitForCompletedConversation(h.service, space.workspace.workspaceId, conversation.conversationId, first.run.runId)
  expect(session.read()).toMatchObject({ revision: before.revision + 1, undoDepth: before.undoDepth + 1, model: { source: 'OWNER\n- 新甲\n+ 新乙' } })
  const receipt = await h.service.operate({ type: 'element-change', submissionId: firstId }) as ElementChangeView
  expect(receipt).toMatchObject({ state: 'applied', epoch: session.read().epoch, revision: session.read().revision, content: '新甲\n新乙', target: { kind: 'text-selection' } })
  const current = await h.service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }) as { revision: number }
  const secondId = '57777777-7777-4777-8777-222222222222'
  const second = await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    expectedRevision: current.revision, submissionId: secondId, text: '继续改这两段', documents: [{ documentId: captured.documentId, epoch: receipt.epoch!,
      revision: receipt.revision!, writable: [receipt.target!], selection: [receipt.target!] }], contentOutput: { kind: 'content', documentId: captured.documentId, target: receipt.target! } }) as { run: ExecutionRunRecord }
  expect((await waitForRun(h.service, second.run.runId)).status).toBe('completed')
  await waitForCompletedConversation(h.service, space.workspace.workspaceId, conversation.conversationId, second.run.runId)
  expect(session.read().model).toMatchObject({ source: 'OWNER\n- 更甲\n+ 更乙' })
  snapshot = session.read()
  expect(await h.service.operate({ type: 'element-revert', submissionId: secondId, direction: 'undo' })).toMatchObject({ status: 'applied', change: { content: '新甲\n新乙' } })
  expect(session.read()).toMatchObject({ revision: snapshot.revision + 1, undoDepth: snapshot.undoDepth + 1, model: { source: 'OWNER\n- 新甲\n+ 新乙' } })
  expect(calls).toBe(2)
  await h.service.shutdown()
})


it.each([
  { source: '**甲**\n\n**乙**', replacement: '甲乙', first: '**甲乙**' },
  { source: '> 甲[](https://example.org)', replacement: '', first: '> [](https://example.org)' },
  { source: '**甲**[](https://example.org)\n\n**乙**', replacement: '甲乙', first: '**甲**[](https://example.org)**乙**' },
])('F02 keeps committed aggregate ACK through cross-run card Undo and cold Session continuation: $source', async ({ source, replacement, first }) => {
  let calls = 0
  const transport: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body))
    if (payload.messages.some((message: { role: string }) => message.role === 'tool')) return finalReplyResponse(payload.model)
    const content = ++calls === 1 ? replacement : '续'
    const chunk = { id: `f02-${calls}`, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', content: '已修改', tool_calls: [
      { index: 0, id: `replace-${calls}`, type: 'function', function: { name: 'text_replace', arguments: JSON.stringify({ content }) } },
    ] }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  const h = await fixture(transport); await configureConversation(h.settings, 'http://127.0.0.1:1/v1')
  let session = h.documents.registry.get(h.document.documentId)
  const initial = session.read(), original = `OWNER\n${source}\n\nUNSELECTED`
  await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: original } } })
  const captured = session.read(), target: Extract<ToolTarget, { kind: 'text-selection' }> = { kind: 'text-selection', fragments: ['甲', '乙'].filter(text => source.includes(text)).map((text, index) => ({
    target: { kind: 'markdown-range', from: original.indexOf(text), to: original.indexOf(text) + 1 }, ...(index ? { separatorBefore: '\n\n' } : {}),
  })) }
  const space = await h.service.operate({ type: 'workspace', root: h.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await h.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId,
    element: { kind: 'element', documentId: captured.documentId, label: '聚合正文' } }) as { conversationId: string; revision: number }
  const send = async (submissionId: string, revision: number, reference = { documentId: captured.documentId, epoch: captured.epoch, revision: captured.revision, writable: [target], selection: [target] }) => h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId,
    conversationId: conversation.conversationId, expectedRevision: revision, submissionId, text: '修改原选区',
    documents: [reference], contentOutput: { kind: 'content', documentId: captured.documentId, target: reference.selection[0] } }) as Promise<{ run: ExecutionRunRecord }>
  const firstId = crypto.randomUUID(), sent = await send(firstId, conversation.revision)
  expect((await waitForRun(h.service, sent.run.runId)).status).toBe('completed')
  await waitForCompletedConversation(h.service, space.workspace.workspaceId, conversation.conversationId, sent.run.runId)
  expect(session.read().model).toMatchObject({ source: `OWNER\n${first}\n\nUNSELECTED` })
  const firstReceipt = await h.service.operate({ type: 'element-change', submissionId: firstId }) as ElementChangeView
  expect(firstReceipt).toMatchObject({ state: 'applied', content: replacement })
  // A restored host owns its journal. Recover a copy so it cannot replace the
  // live host's epoch while that host continues the separate card/Undo journey.
  const coldJournals = path.join(h.root, 'cold-journals')
  await fs.cp(path.join(h.root, 'journals'), coldJournals, { recursive: true })
  const cold = new DocumentHostService(coldJournals)
  await cold.internalAPI.restore(captured.documentId)
  const recovered = cold.registry.get(captured.documentId)
  expect(recovered.committedChangesSince(captured.revision).at(-1)?.textChanges?.aggregateMappings).toHaveLength(1)
  const stale = { documentId: captured.documentId, epoch: captured.epoch, revision: captured.revision, writable: [target], selection: [target] }
  await expect(continueDocumentTargets(recovered, stale, new Set([sent.run.runId]))).rejects.toThrow('原文档会话已改变')
  // Restoration creates a new epoch. Authorize that Session explicitly while retaining
  // the original logical selection and the verified same-task committed run.
  const frozen = { ...stale, epoch: recovered.read().epoch }
  const mapped = await continueDocumentTargets(recovered, frozen, new Set([sent.run.runId]))
  expect(readEditableTargetContent(recovered.read().model, mapped.selection![0]).text).toBe(replacement)
  await expect(continueDocumentTargets(recovered, frozen, new Set())).rejects.toThrow('原选区')
  const current = await h.service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }) as { revision: number }
  const secondId = crypto.randomUUID(), second = await send(secondId, current.revision, { documentId: captured.documentId,
    epoch: firstReceipt.epoch!, revision: firstReceipt.revision!, writable: [firstReceipt.target! as typeof target], selection: [firstReceipt.target! as typeof target] })
  expect((await waitForRun(h.service, second.run.runId)).status).toBe('completed')
  await waitForCompletedConversation(h.service, space.workspace.workspaceId, conversation.conversationId, second.run.runId)
  const receipt = await h.service.operate({ type: 'element-change', submissionId: secondId }) as ElementChangeView
  expect(receipt).toMatchObject({ state: 'applied', content: '续' })
  expect(receipt.unavailable).toBeUndefined()
  expect(session.read().model).toMatchObject({ source: expect.stringContaining('UNSELECTED') })
  expect(await h.service.operate({ type: 'element-revert', submissionId: secondId, direction: 'undo' })).toMatchObject({ status: 'applied', change: { content: replacement } })
  expect(session.read().model).toMatchObject({ source: `OWNER\n${first}\n\nUNSELECTED` })
  expect(calls).toBe(2)
  await h.service.shutdown()
})

it('NI01 completes a real Flow card aggregate, follows its current receipt and undoes both fields without changing human geometry', async () => {
  let calls = 0, expectedInput = ''
  const transport: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body))
    if (payload.messages.some((message: { role: string }) => message.role === 'tool')) return finalReplyResponse(payload.model)
    const content = ++calls === 1 ? '<b>新甲</b><br><i>新乙</i>' : '<b>更甲</b><br><i>更乙</i>'
    expect(payload.messages.some((message: { content: unknown }) => String(message.content).includes(expectedInput))).toBe(true)
    const chunk = { id: `flow-${calls}`, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', content: '修改已完成', tool_calls: [
      { index: 0, id: `replace-${calls}`, type: 'function', function: { name: 'text_replace', arguments: JSON.stringify({ content, format: 'html' }) } },
    ] }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }
  const h = await fixture(transport); await configureConversation(h.settings, 'http://127.0.0.1:1/v1')
  const project = createBlankCourseProjectV10('Flow card'), surfaceId = project.surfaces[0].id
  project.surfaces[0].kind = 'flow'
  project.definitions['guoling.text'] = { id: 'guoling.text', role: 'mixed', title: '正文', implementation: { kind: 'builtin', key: 'guoling.text' } }
  for (const [id, text] of [['a', '前甲后'], ['b', '前乙后'], ['c', '未选正文']]) {
    project.instances[id] = { id, definitionId: 'guoling.text', data: JSON.parse(JSON.stringify(createTextComponentData(text))), frame: { width: 400, height: 80, transform: [1, 0, 0, 1, 20, 40] } }
    project.surfaces[0].childIds.push(id)
  }
  const document = await h.documents.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow.h5lesson')
  const session = h.documents.registry.get(document.documentId), initial = session.read()
  await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(project, [{ type: 'frame.set', instanceId: 'a', frame: { ...project.instances.a.frame!, width: 401 } }]) } })
  const captured = session.read(), target: Extract<ToolTarget, { kind: 'text-selection' }> = { kind: 'text-selection', fragments: ['a', 'b'].map((instanceId, index) => ({
    target: { kind: 'course-instance', surfaceId, instanceId, dataPath: ['content'], from: 1, to: 2 }, ...(index ? { separatorBefore: '\n' } : {}),
  })) }
  if (captured.model.kind !== 'course-v10') throw new Error('Expected V10')
  expectedInput = readEditableTargetContent(captured.model, target).text
  await session.execute({ documentId: captured.documentId, epoch: captured.epoch, baseRevision: captured.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: captureComponentOperation(captured.model.project, [
      { type: 'frame.set', instanceId: 'a', frame: { ...captured.model.project.instances.a.frame!, width: 999 } },
      { type: 'instance.insert', container: { kind: 'surface', surfaceId }, index: 0, rootIds: ['prefix'], instances: [{ id: 'prefix', definitionId: 'guoling.text', data: JSON.parse(JSON.stringify(createTextComponentData('人工前插'))) }] },
    ]) } })
  const before = session.read()
  const space = await h.service.operate({ type: 'workspace', root: h.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await h.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId,
    element: { kind: 'element', documentId: document.documentId, label: 'Flow选中正文' } }) as { conversationId: string; revision: number }
  const firstId = '58888888-8888-4888-8888-111111111111'
  const first = await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    expectedRevision: conversation.revision, submissionId: firstId, text: '改选中的两段', documents: [{ documentId: captured.documentId, epoch: captured.epoch,
      revision: captured.revision, writable: [target], selection: [target] }], contentOutput: { kind: 'content', documentId: captured.documentId, target } }) as { run: ExecutionRunRecord }
  expect((await waitForRun(h.service, first.run.runId)).status).toBe('completed')
  await waitForCompletedConversation(h.service, space.workspace.workspaceId, conversation.conversationId, first.run.runId)
  expect(session.read().undoDepth).toBe(before.undoDepth + 1)
  const receipt = await h.service.operate({ type: 'element-change', submissionId: firstId }) as ElementChangeView
  expect(receipt).toMatchObject({ state: 'applied', epoch: session.read().epoch, revision: session.read().revision, target: { kind: 'text-selection', fragments: [
    { target: { instanceId: 'a', from: 1, to: 3 } }, { target: { instanceId: 'b', from: 1, to: 3 } },
  ] } })
  expect(receipt.content).toContain('新甲'); expect(receipt.content).toContain('新乙'); expectedInput = receipt.content!
  const current = await h.service.operate({ type: 'conversation', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }) as { revision: number }
  const secondId = '58888888-8888-4888-8888-222222222222'
  const second = await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    expectedRevision: current.revision, submissionId: secondId, text: '继续改这两段', documents: [{ documentId: captured.documentId, epoch: receipt.epoch!,
      revision: receipt.revision!, writable: [receipt.target!], selection: [receipt.target!] }], contentOutput: { kind: 'content', documentId: captured.documentId, target: receipt.target! } }) as { run: ExecutionRunRecord }
  expect((await waitForRun(h.service, second.run.runId)).status).toBe('completed')
  await waitForCompletedConversation(h.service, space.workspace.workspaceId, conversation.conversationId, second.run.runId)
  const written = session.read(); if (written.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(plainDocumentText(textComponentDataSchema.parse(written.model.project.instances.a.data).content)).toBe('前更甲后')
  expect(plainDocumentText(textComponentDataSchema.parse(written.model.project.instances.b.data).content)).toBe('前更乙后')
  expect(await h.service.operate({ type: 'element-revert', submissionId: secondId, direction: 'undo' })).toMatchObject({ status: 'applied', change: { state: 'undone' } })
  const after = session.read(); if (after.model.kind !== 'course-v10') throw new Error('Expected V10')
  expect(after.undoDepth).toBe(written.undoDepth + 1)
  expect(plainDocumentText(textComponentDataSchema.parse(after.model.project.instances.a.data).content)).toBe('前新甲后')
  expect(plainDocumentText(textComponentDataSchema.parse(after.model.project.instances.b.data).content)).toBe('前新乙后')
  expect(after.model.project.instances.a.frame?.width).toBe(999)
  expect(after.model.project.instances.c.data).toEqual(project.instances.c.data)
  expect(after.model.project.surfaces[0].childIds[0]).toBe('prefix')
  expect(calls).toBe(2)
  await h.service.shutdown()
})

it('refreshes pinned current content and merges multiple composer refs to the same document only for the frozen run', async () => {
  const requests: Array<{ messages: Array<{ content: unknown }> }> = []
  const h = await fixture(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); requests.push(payload)
    return finalReplyResponse(payload.model, '已读取当前固定引用。')
  })
  await configureConversation(h.settings, 'http://127.0.0.1:1/v1')
  const session = h.documents.registry.get(h.document.documentId), captured = session.read()
  const first = { ...reference(captured, [{ kind: 'markdown-range' as const, from: 0, to: 6 }]),
    selection: [{ kind: 'markdown-range' as const, from: 0, to: 6 }], referenceId: 'pinned-first', pinned: true, displayLabel: '固定正文' }
  await session.execute({ documentId: captured.documentId, epoch: captured.epoch, baseRevision: captured.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.splice', from: 0, to: 6, text: 'OWNER FIRST' } } })
  const current = session.read()
  const second = { ...reference(current, []), referenceId: 'same-doc-read', pinned: true, displayLabel: '同文档参考' }
  const space = await h.service.operate({ type: 'workspace', root: h.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await h.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const identity = { workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId }
  const prepared = await h.service.operate({ type: 'prepare-documents', ...identity, documents: [first, second] }) as Array<typeof first>
  expect(prepared[0]).toMatchObject({ referenceId: first.referenceId, pinned: true, epoch: current.epoch, revision: current.revision })
  expect(readEditableTargetContent(current.model, prepared[0].selection[0]).text).toBe('OWNER FIRST')
  // Sending the original pinned identity must still use today's content; updating only the renderer is insufficient.
  const sent = await h.service.operate({ type: 'send', ...identity, submissionId: crypto.randomUUID(), expectedRevision: conversation.revision,
    text: '阅读固定正文', documents: [first, second] }) as { run: ExecutionRunRecord }
  const final = await h.service.engine.wait(sent.run.runId)
  expect(final.input.documents).toHaveLength(1)
  expect(final.input.documents[0]).toMatchObject({ revision: current.revision, writable: prepared[0].writable })
  expect(JSON.stringify(requests)).toContain('OWNER FIRST')
  await waitForCompletedConversation(h.service, identity.workspaceId, identity.conversationId, final.runId)
  const projected = await h.service.operate({ type: 'conversation', ...identity }) as ConversationRecord
  expect(projected.frozenContextRefs).toEqual(expect.arrayContaining([
    expect.objectContaining({ contextRefId: 'pinned-first', referenceId: 'pinned-first', pinned: true, displayLabel: '固定正文' }),
    expect.objectContaining({ contextRefId: 'same-doc-read', referenceId: 'same-doc-read', pinned: true }),
  ]))
  expect(session.read().revision).toBe(current.revision)
})

it('passes an outside bound HTML exact-file grant through the real Engine file reader without granting a sibling', async () => {
  let requests = 0, outside = '', sibling = ''
  const h = await fixture(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); requests++
    if (requests > 2) return finalReplyResponse(payload.model, '已读当前 HTML；相邻文件没有授权。')
    const chunk = { id: `bound-${requests}`, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [
      { index: 0, id: `read-${requests}`, type: 'function', function: { name: 'file_read', arguments: JSON.stringify({ path: requests === 1 ? outside : sibling }) } },
    ] }, finish_reason: 'tool_calls' }] }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  })
  await configureConversation(h.settings, 'http://127.0.0.1:1/v1')
  const outsideRoot = path.join(h.root, 'outside'); await fs.mkdir(outsideRoot)
  outside = path.join(outsideRoot, 'bound.html'); sibling = path.join(outsideRoot, 'secret.txt')
  await fs.writeFile(outside, '<p>disk HTML</p>'); await fs.writeFile(sibling, 'Sibling is not granted')
  const opened = await h.documents.open(outside), session = h.documents.registry.get(opened.documentId)
  await session.execute({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision, operationId: crypto.randomUUID(), actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: '<p>unsaved human HTML</p>' } } })
  const current = session.read()
  const space = await h.service.operate({ type: 'workspace', root: h.workspace }) as { workspace: { workspaceId: string } }
  const conversation = await h.service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as { conversationId: string; revision: number }
  const sent = await h.service.operate({ type: 'send', workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
    submissionId: crypto.randomUUID(), expectedRevision: conversation.revision, text: '读取明确引用的HTML', permission: 'read-only',
    documents: [reference(current, [])] }) as { run: ExecutionRunRecord }
  const final = await h.service.engine.wait(sent.run.runId)
  const reads = final.tools.filter(tool => tool.call.name === 'file.read')
  expect(reads[0].result?.kind).toBe('read')
  expect(JSON.stringify(reads[0].result)).toContain('unsaved human HTML')
  expect(reads[1].result).toMatchObject({ kind: 'error', code: 'file-tool-failed' })
  expect(JSON.stringify(reads[1].result)).not.toContain('Sibling is not granted')
  expect(final.input.boundReadPaths).toEqual([await fs.realpath(outside)])
  expect(requests).toBe(3)
  expect(session.read().revision).toBe(current.revision)
  expect(await fs.readFile(outside, 'utf8')).toBe('<p>disk HTML</p>')
})
