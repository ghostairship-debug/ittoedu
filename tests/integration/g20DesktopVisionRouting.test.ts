// @vitest-environment node
import { attachmentHostToolServices } from '../helpers/attachmentHostToolServices'
import { modelToolWireName } from '../../src/main/workbench/providers/OpenAIChatProvider'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture outside temp directory')
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 })
  }
})

async function projected(service: ExecutionDesktopService, identity: { workspaceId: string; conversationId: string }, runId: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const conversation = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    if (conversation.messages.some(message => message.role === 'assistant' && message.runId === runId)) return conversation
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Assistant message was not projected')
}

it('routes only current image bytes to vision while keeping the historical image source and frozen vision selection', async () => {
  type Wire = { model: string; path: string; authorization: string | undefined;
    messages: Array<{ role: string; content?: unknown; tool_calls?: Array<{ id: string }>;
    tool_call_id?: string }>; tools: Array<{ function: { name: string; description: string } }> }
  const requests: Wire[] = []
  let toolCommand: { name: 'context.read' | 'material.read'; args: object; dispatched: boolean } | null = null
  const server = createServer((request, response) => { void (async () => {
    if (request.method !== 'POST' || !['/chat/v1/chat/completions', '/vision/v1/chat/completions'].includes(request.url ?? '')) throw new Error('Unexpected route')
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw) as Wire
    requests.push({ ...body, path: request.url!, authorization: request.headers.authorization })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (toolCommand && !toolCommand.dispatched) {
      const tool = body.tools.find(item => item.function.name === modelToolWireName(toolCommand!.name))
      if (!tool) throw new Error(`${toolCommand.name} was absent from the real Provider request`)
      const callId = `reread-${toolCommand.name.replace('.', '-')}`
      toolCommand.dispatched = true
      response.end(`data: ${JSON.stringify({ id: callId, model: body.model, choices: [{ index: 0,
        delta: { role: 'assistant', tool_calls: [{ index: 0, id: callId, type: 'function',
          function: { name: tool.function.name, arguments: JSON.stringify(toolCommand.args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`)
      return
    }
    response.end(`data: ${JSON.stringify({ id: 'vision-route-fixture', model: body.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: '收到' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => response.destroy(error)) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-desktop-vision-')); roots.push(root)
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => Buffer.from(bytes).toString(),
  } })
  const connection = (accountId: string, vision: 'supported' | 'unsupported') => ({ provider: 'local-fixture', protocol: 'openai-chat' as const,
    baseURL: `${endpoint}/${accountId}/v1`, accountId, authKind: 'api-key' as const, billing: { kind: 'unknown' as const },
    capabilities: { tools: 'supported' as const, stream: 'supported' as const, vision, reasoning: 'unknown' as const } })
  const chat = await settings.saveConnection({ apiKey: 'chat-only', connection: connection('chat', 'unsupported') })
  const vision = await settings.saveConnection({ apiKey: 'vision-only', connection: connection('vision', 'supported') })
  await settings.saveProfile({ roles: { conversation: { connectionId: chat.connection.id, model: 'fixture-chat' },
    vision: { connectionId: vision.connection.id, model: 'fixture-vision' }, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: root, documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
  documents.tools.configureHostServices(attachmentHostToolServices(service.attachments, documents))
  const workspace = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: workspace.workspace.workspaceId }) as ConversationRecord
  const identity = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }
  const red = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ed2444' } }).png().toBuffer()
  const blue = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#2244ed' } }).png().toBuffer()
  const first = await service.attachments.receiveBytes({ name: 'first.png', bytes: red, source: { kind: 'paste' } })
  const second = await service.attachments.receiveBytes({ name: 'second.png', bytes: blue, source: { kind: 'paste' } })
  const sent = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: conversation.revision,
    text: '比较两张图', documents: [], attachments: [first, second].map(snapshot => ({ attachmentId: snapshot.id,
      representationId: 'original-image', role: 'reference' as const })) }) as { run: ExecutionRunRecord }
  const imageRun = await service.engine.wait(sent.run.runId)
  expect(imageRun.status).toBe('completed')
  expect(imageRun.input.selectionSource?.role).toBe('vision')
  expect(requests[0]?.model).toBe('fixture-vision')
  expect(requests[0]).toMatchObject({ path: '/vision/v1/chat/completions', authorization: 'Bearer vision-only' })
  expect(JSON.stringify(requests[0]?.messages)).toContain('data:image/png;base64,')

  const withHistory = await projected(service, identity, imageRun.runId)
  const followup = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: withHistory.revision,
    text: '请继续讨论上轮结论', documents: [], attachments: [] }) as { run: ExecutionRunRecord }
  const textRun = await service.engine.wait(followup.run.runId)
  expect(textRun.status).toBe('completed')
  expect(textRun.input.selection).toMatchObject({ model: 'fixture-chat' })
  expect(textRun.input.selectionSource?.role).toBe('conversation')
  expect(textRun.input.visionSelection).toMatchObject({ model: 'fixture-vision',
    connection: { id: vision.connection.id, capabilities: { vision: 'supported' } } })
  expect(textRun.input.selectionSource?.reason).toBe('使用接受提交时配置的会话角色')
  expect(textRun.initialPayload?.totals.imageBytes).toBe(0)
  expect(textRun.initialPayload?.automaticContext.some(item => item.provenance.kind === 'history'
    && item.provenance.id.startsWith(`run:${imageRun.runId}:`))).toBe(true)
  expect(requests[1]?.model).toBe('fixture-chat')
  expect(requests[1]).toMatchObject({ path: '/chat/v1/chat/completions', authorization: 'Bearer chat-only' })
  expect(JSON.stringify(requests[1]?.messages)).toContain(`run:${imageRun.runId}:`)
  expect(JSON.stringify(requests[1]?.messages)).not.toContain('data:image/')

  let priorRunId = textRun.runId
  for (const [name, args] of [
    ['context.read', { sourceId: `run:${imageRun.runId}:${imageRun.initialPayload!.explicitAttachments[0]!.messageIndex}`, imageIndexes: [0] }],
    ['material.read', { attachmentId: first.id, representationId: 'original-image' }],
  ] as const) {
    const settled = await projected(service, identity, priorRunId)
    const requestStart = requests.length
    toolCommand = { name, args, dispatched: false }
    const reread = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: settled.revision,
      text: name === 'context.read' ? '按索引重读第一张原图' : '按材料来源重读第一张原图', documents: [], attachments: [] }) as { run: ExecutionRunRecord }
    const rereadRun = await service.engine.wait(reread.run.runId)
    expect(rereadRun.status).toBe('completed')
    expect(rereadRun.tools.map(tool => tool.call.name)).toEqual([name])
    expect(rereadRun.tools[0]?.result).toMatchObject({ kind: 'read' })
    // The conversation stays on the text model; only the independent visual analysis receives the image bytes.
    expect(requests).toHaveLength(requestStart + 3)
    expect(requests[requestStart]?.model).toBe('fixture-chat')
    const imageRequest = requests[requestStart + 1]!
    expect(imageRequest.model).toBe('fixture-vision')
    expect(imageRequest).toMatchObject({ path: '/vision/v1/chat/completions', authorization: 'Bearer vision-only' })
    expect(JSON.stringify(imageRequest.messages)).toContain(`data:image/png;base64,${red.toString('base64')}`)
    expect(imageRequest.tools ?? []).toEqual([])
    const continued = requests[requestStart + 2]!
    expect(continued).toMatchObject({ model: 'fixture-chat', path: '/chat/v1/chat/completions', authorization: 'Bearer chat-only' })
    const callId = `reread-${name.replace('.', '-')}`
    expect(continued.messages.some(message => message.role === 'assistant'
      && message.tool_calls?.some(call => call.id === callId))).toBe(true)
    expect(continued.messages.some(message => message.role === 'tool' && message.tool_call_id === callId)).toBe(true)
    expect(JSON.stringify(continued.messages)).toContain('独立视觉分析')
    expect(JSON.stringify(continued.messages)).not.toContain('data:image/')
    expect(rereadRun.requests.map(request => request.kind ?? 'model')).toEqual(['model', 'visual-analysis', 'model'])
    expect(rereadRun.input.selection).toMatchObject({ model: 'fixture-chat' })
    expect(rereadRun.input.selectionSource?.role).toBe('conversation')
    expect(rereadRun.input.visionSelection).toMatchObject({ model: 'fixture-vision' })
    expect(rereadRun.initialPayload?.totals.imageBytes).toBe(0)
    priorRunId = rereadRun.runId
    toolCommand = null
  }

  const reopened = new ExecutionDesktopService({ directory: root, documents, settings,
    authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
  const restored = await reopened.engine.read(textRun.runId)
  expect(restored?.input.selection.model).toBe('fixture-chat')
  expect(restored?.input.visionSelection?.model).toBe('fixture-vision')

  // Historical image availability alone cannot block a new text task when the
  // optional visual role is later removed. The earlier run keeps its snapshot.
  await settings.saveProfile({ expectedRevision: 1, roles: {
    conversation: { connectionId: chat.connection.id, model: 'fixture-chat' },
    vision: null, imageGenerate: null, imageEdit: null,
  } })
  const latest = await projected(reopened, identity, priorRunId)
  const withoutVision = await reopened.operate({ type: 'send', ...identity, submissionId: randomUUID(),
    expectedRevision: latest.revision, text: '只用文字概括已确认结论', documents: [], attachments: [] }) as { run: ExecutionRunRecord }
  const plain = await reopened.engine.wait(withoutVision.run.runId)
  expect(plain.status).toBe('completed')
  expect(plain.input.selection.model).toBe('fixture-chat')
  expect(plain.input.visionSelection).toBeUndefined()
  expect(plain.initialPayload?.totals.imageBytes).toBe(0)
  expect(requests.at(-1)?.model).toBe('fixture-chat')
  expect(requests.at(-1)).toMatchObject({ path: '/chat/v1/chat/completions', authorization: 'Bearer chat-only' })
  expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain('data:image/')
})
