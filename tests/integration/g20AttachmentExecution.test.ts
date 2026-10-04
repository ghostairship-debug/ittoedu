// @vitest-environment node
import { promises as fs } from 'node:fs'
import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { readMaterial } from '../../src/main/workbench/execution/MaterialReadTools'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { AttachmentsDesktopService } from '../../src/main/workbench/attachments/attachmentsDesktopService'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'
import type { AttachmentSnapshot } from '../../src/shared/workbench/attachments'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const directory of directories.splice(0)) { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture'); await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }) }
})
function windowFor(id: number): BrowserWindow {
  return { webContents: Object.assign(new EventEmitter(), { id, isDestroyed: () => false }) } as unknown as BrowserWindow
}
async function fixture(baseURL: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-attachment-execution-')); directories.push(directory)
  const documents = new DocumentHostService(path.join(directory, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(directory, 'settings'), encryption: {
    isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => Buffer.from(bytes).toString(),
  } })
  const conversationConnection = await settings.saveConnection({ apiKey: 'local-fixture', connection: { provider: 'local-test', protocol: 'openai-chat', baseURL, accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'unsupported', reasoning: 'unknown' } } })
  const visionConnection = await settings.saveConnection({ apiKey: 'local-fixture', connection: { provider: 'local-test', protocol: 'openai-chat', baseURL, accountId: 'fixture-vision', authKind: 'api-key', billing: { kind: 'unknown' }, capabilities: { tools: 'supported', stream: 'supported', vision: 'supported', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: conversationConnection.connection.id, model: 'conversation' }, vision: { connectionId: visionConnection.connection.id, model: 'configured-vision' }, imageGenerate: null, imageEdit: null } })
  const service = new ExecutionDesktopService({ directory, documents, settings, authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
  const space = await service.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
  return { directory, service, conversation, identity: { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId } }
}
async function backend() {
  const bodies: string[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk); bodies.push(Buffer.concat(chunks).toString())
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ id: 'fixture-response', model: 'configured-vision', choices: [{ index: 0, delta: { role: 'assistant', content: '附件已收到' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
  }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { bodies, baseURL: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }
}

describe('attachment draft to canonical execution payload', () => {
  it('sends image-only real HTTP bytes through the configured vision role and records the complete runtime/tools manifest', async () => {
    const wire = await backend(), { service, conversation, identity } = await fixture(wire.baseURL)
    const bytes = await sharp({ create: { width: 4, height: 5, channels: 4, background: '#1978aa' } }).png().toBuffer()
    const snapshot = await service.attachments.receiveBytes({ name: 'same.png', bytes, source: { kind: 'paste' } })
    const attachments = [{ attachmentId: snapshot.id, representationId: 'original-image', role: 'reference' }]
    const draft = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '', documents: [], attachments }) as ConversationRecord
    const sent = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision, text: '', documents: [], attachments }) as { run: ExecutionRunRecord; conversation: ConversationRecord }
    const run = await service.engine.wait(sent.run.runId), body = JSON.parse(wire.bodies[0])
    expect(run.status).toBe('completed'); expect(wire.bodies).toHaveLength(1)
    expect(body.model).toBe('configured-vision'); expect(body.tools.length).toBeGreaterThan(0)
    expect(body.messages[0].role).toBe('system'); expect(body.messages[1].content).toContain('本次固定文档与权限')
    expect(body.messages[2]).toEqual({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }] })
    expect(run.initialPayload).toMatchObject({ payloadDigest: createHash('sha256').update(wire.bodies[0]).digest('hex'), totals: { serializedBytes: Buffer.byteLength(wire.bodies[0]) }, selectionSource: { role: 'vision' }, delivery: { status: 'sent' }, readStatus: 'unknown', userText: null })
    expect(run.initialPayload!.automaticContext).toHaveLength(2)
    expect(run.requests[0].payload).toMatchObject({ phase: 'initial', digest: run.initialPayload!.payloadDigest })
    expect(sent.conversation.inputAttachments).toEqual([])
    expect(sent.conversation.messages[0].attachmentIds).toEqual([snapshot.id])
    expect(Buffer.from((await service.attachments.readRepresentation(snapshot.id, 'original-image')).bytes)).toEqual(bytes)
    let completed = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    for (let attempt = 0; attempt < 100 && !completed.messages.some(message => message.role === 'assistant'); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5))
      completed = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    }
    const followup = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: completed.revision, text: '继续说明图中颜色', documents: [], attachments: [] }) as { run: ExecutionRunRecord }
    const followed = await service.engine.wait(followup.run.runId), nextBody = JSON.parse(wire.bodies[1])
    expect(nextBody.model).toBe('conversation')
    expect(nextBody.messages.some((message: { content: unknown }) => JSON.stringify(message.content).includes(bytes.toString('base64')))).toBe(false)
    expect(followed.initialPayload!.explicitAttachments).toEqual([])
    expect(followed.initialPayload!.automaticContext.some(item => item.provenance.kind === 'history' && item.provenance.id.includes(sent.run.runId))).toBe(true)
  })

  it('sends an actual large inline payload in full and accepts an unextracted original as a source index', async () => {
    const wire = await backend(), { service, conversation, identity } = await fixture(wire.baseURL)
    const text = '文'.repeat(3_000_000)
    const snapshot = await service.attachments.receiveBytes({ name: 'long.txt', bytes: Buffer.from(text), source: { kind: 'drop' } })
    const attachments = [{ attachmentId: snapshot.id, representationId: 'original-text' }]
    const draft = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '不要丢弃', documents: [], attachments }) as ConversationRecord
    // No artificial send budget: an unknown model window receives the whole inline text.
    const large = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision, text: draft.inputDraft, documents: [], attachments }) as { run: ExecutionRunRecord; submission: { state: string } }
    expect(large.submission.state).toBe('accepted')
    const delivered = await service.engine.wait(large.run.runId)
    expect(delivered.status).toBe('completed')
    expect(delivered.initialPayload?.totals.representationBytes).toBe(Buffer.byteLength(text))
    expect(wire.bodies).toHaveLength(1)
    expect(wire.bodies[0]!.includes(text)).toBe(true)
    let settled = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    for (let attempt = 0; attempt < 100 && !settled.messages.some(message => message.role === 'assistant' && message.runId === large.run.runId); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5))
      settled = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    }
    const file = await service.attachments.receiveBytes({ name: 'original.pdf', bytes: Buffer.from('%PDF-1.7'), source: { kind: 'file' } })
    const pending = [{ attachmentId: file.id, representationId: 'original-file' }]
    const revised = await service.operate({ type: 'draft', ...identity, expectedRevision: settled.revision, text: '', documents: [], attachments: pending }) as ConversationRecord
    expect(wire.bodies).toHaveLength(1)
    const unextracted = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: revised.revision, text: '', documents: [], attachments: pending }) as { run: ExecutionRunRecord; submission: { state: string } }
    expect(unextracted.submission.state).toBe('accepted')
    const completed = await service.engine.wait(unextracted.run.runId)
    expect(completed.initialPayload?.explicitAttachments[0]).toMatchObject({ attachmentId: file.id, delivery: 'source' })
    expect(wire.bodies).toHaveLength(2)
    expect(wire.bodies[1]).toContain('index-only')
    expect(wire.bodies[1]).not.toContain('%PDF-1.7')
  })

  it('unifies paste/drop byte intake and preview, rejects raw path authority and removes only draft references', async () => {
    const { directory, service, conversation, identity } = await fixture('http://127.0.0.1:1/v1')
    const desktop = new AttachmentsDesktopService(path.join(directory, 'attachments')), window = windowFor(41)
    const text = Buffer.from('# 同一份正文')
    const pasted = await desktop.operate({ type: 'receive', name: 'same.md', bytes: text, source: 'paste', mediaType: 'text/markdown' }, window) as AttachmentSnapshot
    const dropped = await desktop.operate({ type: 'receive', name: 'same.md', bytes: Buffer.from('# 不同正文'), source: 'drop' }, window) as AttachmentSnapshot
    expect(pasted.digest).not.toBe(dropped.digest)
    const preview = await desktop.operate({ type: 'representation', attachmentId: pasted.id, representationId: 'original-text' }, window) as { bytes: Uint8Array }
    expect(Buffer.from(preview.bytes)).toEqual(text)
    await expect(desktop.operate({ type: 'receive', name: 'same.md', bytes: text, source: 'drop', path: 'C:\\private.txt' }, window)).rejects.toThrow()
    const drafted = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '', documents: [], attachments: [{ attachmentId: pasted.id, representationId: 'original-text' }] }) as ConversationRecord
    const removed = await service.operate({ type: 'draft', ...identity, expectedRevision: drafted.revision, text: '', documents: [], attachments: [] }) as ConversationRecord
    expect(removed.inputAttachments).toEqual([])
    expect(await service.attachments.readSnapshot(pasted.id)).toEqual(pasted)
    await expect(service.operate({ type: 'draft', ...identity, expectedRevision: drafted.revision, text: '', documents: [], attachments: [] })).rejects.toThrow('本条消息的草稿已在另一处更新')
  })
})


it('sends a large material as an index without fetching the blob, then reads the requested range with provenance', async () => {
  const wire = await backend(), f = await fixture(wire.baseURL)
  const text = '大材料正文\n'.repeat(500_000) + '末尾结论'
  const snapshot = await f.service.attachments.receiveBytes({ name: 'large-source.txt', bytes: Buffer.from(text), source: { kind: 'file' } })
  const readSpy = vi.spyOn(f.service.attachments, 'readRepresentation')
  const attachments = [{ attachmentId: snapshot.id, representationId: snapshot.representations[0]!.id, delivery: 'source' as const }]
  const sent = await f.service.operate({ type: 'send', ...f.identity, submissionId: randomUUID(), expectedRevision: f.conversation.revision,
    text: '请按需读取末尾结论', documents: [], attachments }) as { run: ExecutionRunRecord }
  const run = await f.service.engine.wait(sent.run.runId)
  expect(run.status).toBe('completed')
  expect(readSpy).not.toHaveBeenCalled()
  expect(Buffer.byteLength(wire.bodies[0]!)).toBeLessThan(128 * 1024)
  expect(run.initialPayload?.totals).toMatchObject({ originalBytes: Buffer.byteLength(text), representationBytes: 0, imageBytes: 0 })
  const result = await readMaterial(f.service.attachments, new Set([snapshot.id]), { attachmentId: snapshot.id,
    representationId: snapshot.representations[0]!.id, offset: text.length - 4, maxChars: 100 })
  expect(result.data).toMatchObject({ text: '末尾结论', originalDigest: snapshot.digest, wholeSourceRead: false })
  readSpy.mockRestore()
})
