// @vitest-environment jsdom
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { cleanup } from '@testing-library/react'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  cleanup()
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const frame = (value: object) => `data: ${JSON.stringify(value)}\n\n`
function sse(response: import('node:http').ServerResponse, id: string, delta: object, finishReason: 'tool_calls' | 'stop') {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.end(frame({ id, model: 'fixture-vision', choices: [{ index: 0, delta, finish_reason: null }] })
    + frame({ id, model: 'fixture-vision', choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }) + 'data: [DONE]\n\n')
}

it('budgets the actual initial HTTP body with runtime context and PNG base64, then records read and repair receipts on dynamic requests', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-payload-stage-')); roots.push(root)
  const source = '# 初稿\nOBSERVE_ONLY_MARKER\n', repaired = '# 已修复\n'
  const filename = path.join(root, 'lesson.md'); await fs.writeFile(filename, source)
  const wire: Array<{ raw: string; body: Record<string, any> }> = []
  const server = createServer(async (request, response) => {
    try {
      if (request.url !== '/v1/chat/completions' || request.headers.authorization !== 'Bearer fixture-key') throw new Error('Wrong route')
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8'), body = JSON.parse(raw) as Record<string, any>
      wire.push({ raw, body })
      if (wire.length === 1) {
        const fixed = body.messages.find((message: { role: string; content: string }) => message.role === 'system' && message.content?.startsWith('本次固定文档与权限')).content as string
        const references = JSON.parse(fixed.slice(fixed.indexOf('：') + 1)) as Array<{ target: string; writable: Array<{ target: string }> }>
        const readName = body.tools.find((tool: { function: { description: string } }) => tool.function.description.includes('分页读取目标文字')).function.name as string
        sse(response, 'read-response', { role: 'assistant', tool_calls: [{ index: 0, id: 'read-call', type: 'function',
          function: { name: readName, arguments: JSON.stringify({ target: references[0]!.target }) } }] }, 'tool_calls')
      } else if (wire.length === 2) {
        const replaceName = body.tools.find((tool: { function: { description: string } }) =>
          tool.function.description.startsWith('只替换已授权 Markdown 范围')).function.name as string
        const fixed = body.messages.find((message: { role: string; content: string }) => message.role === 'system' && message.content?.startsWith('本次固定文档与权限')).content as string
        const references = JSON.parse(fixed.slice(fixed.indexOf('：') + 1)) as Array<{ writable: Array<{ target: string }> }>
        sse(response, 'repair-response', { role: 'assistant', tool_calls: [{ index: 0, id: 'repair-call', type: 'function',
          function: { name: replaceName, arguments: JSON.stringify({ target: references[0]!.writable[0]!.target, content: repaired }) } }] }, 'tool_calls')
      } else sse(response, 'final-response', { role: 'assistant', content: '已根据观察修复' }, 'stop')
    } catch { response.writeHead(500); response.end() }
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local server')
  const documents = new DocumentHostService(path.join(root, 'documents')), document = await documents.open(filename)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: async () => true, encryptString: async value => Buffer.from(value), decryptString: async bytes => Buffer.from(bytes).toString(),
  } })
  const connected = await settings.saveConnection({ apiKey: 'fixture-key', connection: {
    provider: 'fixture', protocol: 'openai-chat', baseURL: `http://127.0.0.1:${address.port}/v1`, accountId: 'fixture',
    authKind: 'api-key', billing: { kind: 'token-plan' }, capabilities: { tools: 'supported', vision: 'supported', stream: 'supported', reasoning: 'unknown' },
  } })
  await settings.saveProfile({ roles: { conversation: { connectionId: connected.connection.id, model: 'fixture-vision' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'), documents, settings,
    authorizeWorkspaceRoot: async selected => ({ resolvedPath: selected }) })
  const space = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
  const createConversation = async () => service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as Promise<ConversationRecord>
  const attachment = await sharp({ create: { width: 5, height: 4, channels: 4, background: '#1878a9' } }).png().toBuffer()
  const snapshot = await service.attachments.receiveBytes({ name: 'source.png', bytes: attachment, source: { kind: 'paste' } })
  const reference = [{ attachmentId: snapshot.id, representationId: 'original-image', role: 'reference' as const }]
  const documentsForRun = [{ documentId: document.documentId, epoch: document.epoch, revision: document.revision,
    writable: [{ kind: 'markdown-range' as const, from: 0, to: source.length }] }]
  const conversation = await createConversation()
  const drafted = await service.operate({ type: 'draft', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
    expectedRevision: conversation.revision, text: '先观察再修复', documents: documentsForRun, attachments: reference }) as ConversationRecord
  const sent = await service.operate({ type: 'send', workspaceId: conversation.workspaceId, conversationId: conversation.conversationId,
    submissionId: randomUUID(), expectedRevision: drafted.revision, text: drafted.inputDraft, documents: documentsForRun, attachments: reference }) as ExecutionSendResult
  if (!sent.run) throw new Error('Submission did not start')
  const run = await service.engine.wait(sent.run.runId)
  expect(run.status).toBe('completed')
  expect(wire).toHaveLength(3)
  const initial = run.initialPayload!
  expect(initial).toMatchObject({ scope: 'initial-payload', laterDynamicReads: 'separately-recorded',
    provider: { model: 'fixture-vision', billingKind: 'token-plan' }, delivery: { status: 'sent' }, readStatus: 'unknown',
    totals: { serializedBytes: Buffer.byteLength(wire[0]!.raw), imageBytes: attachment.length,
      base64Characters: attachment.toString('base64').length } })
  expect(initial.payloadDigest).toBe(createHash('sha256').update(wire[0]!.raw).digest('hex'))
  expect(initial.automaticContext).toHaveLength(2)
  expect(initial.automaticContext.map(item => item.provenance.kind)).toEqual(['runtime', 'runtime'])
  expect(initial.explicitAttachments).toMatchObject([{ attachmentId: snapshot.id, representationId: 'original-image' }])
  expect(JSON.stringify(wire[0]!.body)).toContain(`data:image/png;base64,${attachment.toString('base64')}`)
  expect(wire[0]!.raw).toContain('本次固定文档与权限')
  expect(wire[0]!.raw).not.toContain('OBSERVE_ONLY_MARKER')
  expect(run.requests.map(request => request.payload?.phase)).toEqual(['initial', 'dynamic', 'dynamic'])
  for (const [index, request] of run.requests.entries()) {
    if (!request.payload) throw new Error('Missing recorded request payload')
    expect(request.payload.serializedBytes).toBe(Buffer.byteLength(wire[index]!.raw))
    expect(request.payload.digest).toBe(createHash('sha256').update(wire[index]!.raw).digest('hex'))
  }
  expect(run.tools.map(tool => tool.result?.kind)).toEqual(['read', 'document-operation'])
  expect(wire[1]!.raw).toContain('OBSERVE_ONLY_MARKER')
  expect(wire[2]!.body.messages.some((message: { role: string; content: string }) =>
    message.role === 'tool' && JSON.parse(message.content).kind === 'document-operation')).toBe(true)
  expect((await documents.internalAPI.read(document.documentId)).model).toMatchObject({ source: repaired })

  const largePixels = randomBytes(600 * 600 * 3)
  const large = await sharp(largePixels, { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer()
  expect(large.toString('base64').length).toBeGreaterThan(1024 * 1024)
  const largeSnapshot = await service.attachments.receiveBytes({ name: 'large.png', bytes: large, source: { kind: 'paste' } })
  const largeRef = [{ attachmentId: largeSnapshot.id, representationId: 'original-image', role: 'reference' as const }]
  const overflowConversation = await createConversation()
  const overflowDraft = await service.operate({ type: 'draft', workspaceId: overflowConversation.workspaceId, conversationId: overflowConversation.conversationId,
    expectedRevision: overflowConversation.revision, text: '超限仍保留', documents: [], attachments: largeRef }) as ConversationRecord
  const overflow = await service.operate({ type: 'send', workspaceId: overflowConversation.workspaceId, conversationId: overflowConversation.conversationId,
    submissionId: randomUUID(), expectedRevision: overflowDraft.revision, text: overflowDraft.inputDraft, documents: [], attachments: largeRef }) as ExecutionSendResult
  expect(overflow.submission).toMatchObject({ state: 'failed', failure: { message: expect.stringContaining('超过发送预算') } })
  expect(await service.operate({ type: 'conversation', workspaceId: overflowConversation.workspaceId, conversationId: overflowConversation.conversationId }))
    .toMatchObject({ inputDraft: overflowDraft.inputDraft, inputAttachments: largeRef })
  expect(wire).toHaveLength(3)
})
