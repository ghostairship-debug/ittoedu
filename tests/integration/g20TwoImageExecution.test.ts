// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createElement } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { AttachmentComposer } from '../../src/renderer/workbench/attachments/AttachmentComposer'
import type { InputAttachmentReference } from '../../src/shared/workbench/attachments'
import type { AttachmentsDesktopAPI } from '../../src/shared/workbench/attachmentsDesktop'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  cleanup()
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture root')
    await fs.rm(root, { recursive: true, force: true })
  }
})
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

it('S08-T02 sends two distinct image cards as decoded image bytes while read status stays unknown', async () => {
  const requests: { path: string; raw: string }[] = [], errors: string[] = []
  const server = createServer((request, response) => { void (async () => {
    if (request.url === '/v1/models') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'fixture-vision' }] })); return }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') throw new Error(`Unexpected local route ${request.method} ${request.url}`)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ path: request.url, raw: Buffer.concat(chunks).toString() })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'two-image-fixture', model: 'fixture-vision', choices: [{ index: 0, delta: { role: 'assistant', content: '两张图像已收到' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  })().catch(error => { errors.push(String(error)); response.destroy() }) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-two-image-')); roots.push(root)
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => Buffer.from(bytes).toString(),
  } })
  const conversationConnection = await settings.saveConnection({ apiKey: 'local-only', connection: { provider: 'local-fixture', protocol: 'openai-chat', baseURL: endpoint, accountId: 'conversation', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } })
  const visionConnection = await settings.saveConnection({ apiKey: 'local-only', connection: { provider: 'local-fixture', protocol: 'openai-chat', baseURL: endpoint, accountId: 'vision', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: conversationConnection.connection.id, model: 'fixture-chat' }, vision: { connectionId: visionConnection.connection.id, model: 'fixture-vision' }, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory: root, documents, settings, authorizeWorkspaceRoot: async value => ({ resolvedPath: value }) })
  const workspace = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: workspace.workspace.workspaceId }) as ConversationRecord
  const identity = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId }

  const firstBytes = await sharp({ create: { width: 4, height: 5, channels: 4, background: '#e42336' } }).png().toBuffer()
  const secondBytes = await sharp({ create: { width: 7, height: 3, channels: 4, background: '#2362db' } }).png().toBuffer()
  const first = await service.attachments.receiveBytes({ name: '红色截图.png', bytes: firstBytes, source: { kind: 'paste' } })
  const second = await service.attachments.receiveBytes({ name: '蓝色参考.png', bytes: secondBytes, source: { kind: 'drop' } })
  const attachments: InputAttachmentReference[] = [first, second].map(snapshot => ({ attachmentId: snapshot.id, representationId: 'original-image', role: 'reference' }))
  const attachmentAPI: AttachmentsDesktopAPI = {
    select: async () => [], clipboardFiles: async () => [], workspaceFiles: async () => [], receiveGranted: async () => { throw new Error('Unexpected file intake') },
    release: async () => undefined, receive: async () => { throw new Error('Unexpected byte intake') },
    snapshot: id => service.attachments.readSnapshot(id), readRepresentation: (id, representationId) => service.attachments.readRepresentation(id, representationId),
    extract: async () => { throw new Error('Unexpected extraction') }, cancel: async () => undefined,
  }
  const cards = render(createElement(AttachmentComposer, { api: attachmentAPI, value: attachments, onChange: () => undefined }))
  await waitFor(() => expect(screen.getAllByText(/尚未发送/)).toHaveLength(2))
  expect(screen.getByText('红色截图.png')).toBeVisible()
  expect(screen.getByText('蓝色参考.png')).toBeVisible()
  expect(screen.queryByText(/已读取/)).toBeNull()

  const draft = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '', documents: [], attachments }) as ConversationRecord
  expect(draft.inputAttachments).toEqual(attachments)
  const sent = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision, text: '', documents: [], attachments }) as { run: ExecutionRunRecord; conversation: ConversationRecord }
  const run = await service.engine.wait(sent.run.runId)
  expect(run.status).toBe('completed')
  expect(errors).toEqual([])
  expect(requests).toHaveLength(1)
  expect(requests[0]!.path).toBe('/v1/chat/completions')

  const body = JSON.parse(requests[0]!.raw) as { model: string; messages: { role: string; content: unknown }[] }
  expect(body.model).toBe('fixture-vision')
  const user = body.messages.at(-1)
  expect(user?.role).toBe('user')
  const content = user?.content as { type: string; image_url?: { url: string } }[]
  expect(content).toHaveLength(2)
  for (const [index, part] of content.entries()) {
    expect(part.type).toBe('image_url')
    const match = part.image_url?.url.match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/)
    expect(match).toBeTruthy()
    const actual = Buffer.from(match![1]!, 'base64'), expected = [firstBytes, secondBytes][index]!
    expect(actual).toEqual(expected)
    const decoded = await sharp(actual, { failOn: 'warning' }).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info.width).toBe([4, 7][index])
    expect(decoded.info.height).toBe([5, 3][index])
  }
  expect(JSON.stringify(user)).not.toContain('红色截图.png')
  expect(JSON.stringify(user)).not.toContain('蓝色参考.png')
  expect(JSON.stringify(user)).not.toContain('pathHint')

  expect(run.initialPayload).toMatchObject({ payloadDigest: digest(requests[0]!.raw), selectionSource: { role: 'vision' }, userText: null,
    totals: { imageBytes: firstBytes.length + secondBytes.length, representationBytes: firstBytes.length + secondBytes.length },
    delivery: { status: 'sent' }, readStatus: 'unknown' })
  expect(run.initialPayload?.explicitAttachments).toMatchObject([
    { attachmentId: first.id, representationId: 'original-image', name: first.name, originalDigest: digest(firstBytes), representationDigest: digest(firstBytes), contentIndex: 0, provenance: { originalDigest: digest(firstBytes), complete: true } },
    { attachmentId: second.id, representationId: 'original-image', name: second.name, originalDigest: digest(secondBytes), representationDigest: digest(secondBytes), contentIndex: 1, provenance: { originalDigest: digest(secondBytes), complete: true } },
  ])
  expect(run.tools).toEqual([])
  expect(sent.conversation.messages[0]).toMatchObject({ role: 'user', text: '', attachmentIds: [first.id, second.id] })
  expect(sent.conversation.inputAttachments).toEqual([])
  cards.rerender(createElement(AttachmentComposer, { api: attachmentAPI, value: [], onChange: () => undefined }))
  await waitFor(() => expect(screen.queryByText(/尚未发送/)).toBeNull())
  expect(screen.queryByText(/已读取/)).toBeNull()
})
