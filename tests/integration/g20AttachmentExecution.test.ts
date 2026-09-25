// @vitest-environment node
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
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
  for (const directory of directories.splice(0)) { if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture'); await fs.rm(directory, { recursive: true, force: true }) }
})
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
    let body = ''; for await (const chunk of request) body += chunk.toString(); bodies.push(body)
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
    expect(nextBody.model).toBe('configured-vision')
    expect(nextBody.messages.some((message: { content: unknown }) => JSON.stringify(message.content).includes(bytes.toString('base64')))).toBe(true)
    expect(followed.initialPayload!.explicitAttachments).toEqual([])
    expect(followed.initialPayload!.automaticContext.some(item => item.provenance.kind === 'history' && item.provenance.id === sent.conversation.messages[0].messageId)).toBe(true)
  })

  it('retains exact draft references on final payload overflow and on unextracted-file rejection without any request', async () => {
    const wire = await backend(), { service, conversation, identity } = await fixture(wire.baseURL)
    const snapshot = await service.attachments.receiveBytes({ name: 'long.txt', bytes: Buffer.from('文'.repeat(360_000)), source: { kind: 'drop' } })
    const attachments = [{ attachmentId: snapshot.id, representationId: 'original-text' }]
    const draft = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '不要丢弃', documents: [], attachments }) as ConversationRecord
    const overflow = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: draft.revision, text: draft.inputDraft, documents: [], attachments }) as { submission: { state: string; failure?: { message: string } } }
    expect(overflow.submission.state).toBe('failed')
    expect(overflow.submission.failure?.message).toContain('超过发送预算')
    const retained = await service.operate({ type: 'conversation', ...identity }) as ConversationRecord
    expect(retained).toMatchObject({ inputDraft: draft.inputDraft, inputAttachments: draft.inputAttachments })
    const file = await service.attachments.receiveBytes({ name: 'original.pdf', bytes: Buffer.from('%PDF-1.7'), source: { kind: 'file' } })
    const pending = [{ attachmentId: file.id, representationId: 'original-file' }]
    const revised = await service.operate({ type: 'draft', ...identity, expectedRevision: retained.revision, text: '', documents: [], attachments: pending }) as ConversationRecord
    const unextracted = await service.operate({ type: 'send', ...identity, submissionId: randomUUID(), expectedRevision: revised.revision, text: '', documents: [], attachments: pending }) as { submission: { state: string; failure?: { message: string } } }
    expect(unextracted.submission.state).toBe('failed')
    expect(unextracted.submission.failure?.message).toContain('尚未提取')
    expect(await service.operate({ type: 'conversation', ...identity })).toMatchObject({ inputDraft: revised.inputDraft, inputAttachments: revised.inputAttachments })
    expect(wire.bodies).toEqual([])
  })

  it('unifies paste/drop byte intake and preview, rejects raw path authority and removes only draft references', async () => {
    const { directory, service, conversation, identity } = await fixture('http://127.0.0.1:1/v1')
    const desktop = new AttachmentsDesktopService(path.join(directory, 'attachments'))
    const text = Buffer.from('# 同一份正文')
    const pasted = await desktop.operate({ type: 'receive', name: 'same.md', bytes: text, source: 'paste', mediaType: 'text/markdown' }, undefined as never) as AttachmentSnapshot
    const dropped = await desktop.operate({ type: 'receive', name: 'same.md', bytes: Buffer.from('# 不同正文'), source: 'drop' }, undefined as never) as AttachmentSnapshot
    expect(pasted.digest).not.toBe(dropped.digest)
    const preview = await desktop.operate({ type: 'representation', attachmentId: pasted.id, representationId: 'original-text' }, undefined as never) as { bytes: Uint8Array }
    expect(Buffer.from(preview.bytes)).toEqual(text)
    await expect(desktop.operate({ type: 'receive', name: 'same.md', bytes: text, source: 'drop', path: 'C:\\private.txt' }, undefined as never)).rejects.toThrow()
    const drafted = await service.operate({ type: 'draft', ...identity, expectedRevision: conversation.revision, text: '', documents: [], attachments: [{ attachmentId: pasted.id, representationId: 'original-text' }] }) as ConversationRecord
    const removed = await service.operate({ type: 'draft', ...identity, expectedRevision: drafted.revision, text: '', documents: [], attachments: [] }) as ConversationRecord
    expect(removed.inputAttachments).toEqual([])
    expect(await service.attachments.readSnapshot(pasted.id)).toEqual(pasted)
    await expect(service.operate({ type: 'draft', ...identity, expectedRevision: drafted.revision, text: '', documents: [], attachments: [] })).rejects.toThrow('较新的草稿')
  })
})
