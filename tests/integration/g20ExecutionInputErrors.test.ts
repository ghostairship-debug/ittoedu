// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { DesktopOperationError, normalizeDesktopError } from '../../src/main/errors'
import { diagnosticLog } from '../../src/main/diagnosticLog'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-input-errors-')); roots.push(root)
  const filename = path.join(root, 'notes.md'); await fs.writeFile(filename, '原正文')
  const documents = new DocumentHostService(path.join(root, 'documents')), original = await documents.open(filename)
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: { isEncryptionAvailable: () => true,
    encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString() } })
  const saved = await settings.saveConnection({ apiKey: 'fixture-key', connection: { provider: 'fixture', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1', accountId: 'fixture', authKind: 'api-key',
    billing: { kind: 'unknown' }, capabilities: { tools: 'supported', vision: 'unsupported', stream: 'supported', reasoning: 'unknown' } } })
  await settings.saveProfile({ roles: { conversation: { connectionId: saved.connection.id, model: 'text' }, vision: { connectionId: saved.connection.id, model: 'vision' }, imageGenerate: null, imageEdit: null } })
  const request = vi.fn<typeof fetch>(async () => { throw new Error('Model must never be requested') })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'), documents, settings, fetch: request, authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
  const space = await service.operate({ type: 'workspace', root }) as { workspace: { workspaceId: string } }
  const conversation = await service.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as ConversationRecord
  const imageBytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const attachment = await service.attachments.receiveBytes({ name: 'paste.png', bytes: imageBytes, source: { kind: 'paste' } })
  const attachments = [{ attachmentId: attachment.id, representationId: attachment.representations[0].id }]
  const references = [{ documentId: original.documentId, epoch: original.epoch, revision: original.revision,
    writable: [{ kind: 'markdown-range' as const, from: 0, to: 3 }] }]
  const input = { workspaceId: conversation.workspaceId, conversationId: conversation.conversationId, text: '请修改选中内容', documents: references, attachments }
  const draft = await service.operate({ type: 'draft', ...input, expectedRevision: conversation.revision }) as ConversationRecord
  const send = { type: 'send', ...input, expectedRevision: draft.revision, submissionId: randomUUID() }
  const assertPreserved = async () => {
    expect(request).not.toHaveBeenCalled()
    expect(await service.submissions.list()).toEqual([]); expect(await service.runs.list()).toEqual([])
    expect(await service.conversations.readConversation({ workspaceId: draft.workspaceId, conversationId: draft.conversationId })).toEqual(draft)
    expect((await service.attachments.readRepresentation(attachment.id, attachments[0].representationId)).bytes).toEqual(new Uint8Array(imageBytes))
  }
  return { service, settings, documents, original, filename, draft, send, assertPreserved }
}
const fallback = { code: 'unexpected', title: '操作未完成', message: '服务暂不可用', suggestion: '请查看诊断记录' }
async function rejection(operation: Promise<unknown>) { try { await operation; throw new Error('Expected rejection') } catch (error) { return error } }

it('returns a specific vision blocker and next step through desktop normalization without consuming the draft or attachment', async () => {
  const f = await fixture(), diagnostic = vi.spyOn(diagnosticLog, 'append').mockResolvedValue(undefined)
  const error = await rejection(f.service.operate(f.send))
  expect(error).toBeInstanceOf(DesktopOperationError)
  expect(normalizeDesktopError(error, fallback)).toMatchObject({ code: 'execution-vision-unsupported', title: '消息尚未发送', message: expect.stringContaining('已确认不支持图片输入'), suggestion: expect.stringContaining('输入框选择') })
  await f.assertPreserved(); expect(await fs.readFile(f.filename, 'utf8')).toBe('原正文'); expect(diagnostic).toHaveBeenCalled()
})

it('explains a stale local selection while retaining committed edits, and never exposes an unexpected exception as user-facing detail', async () => {
  const f = await fixture()
  const edit = await f.documents.registry.get(f.original.documentId).execute({ documentId: f.original.documentId, epoch: f.original.epoch, baseRevision: f.original.revision, operationId: 'human-edit', actor: 'human',
    mutation: { type: 'command', command: { type: 'markdown.replace', source: '教师已修改的正文' } } })
  expect(edit.status).toBe('applied')
  const committed = f.documents.registry.get(f.original.documentId).read()
  const diagnostic = vi.spyOn(diagnosticLog, 'append').mockResolvedValue(undefined)
  const error = await rejection(f.service.operate(f.send))
  expect(normalizeDesktopError(error, fallback)).toMatchObject({ code: 'execution-document-range-changed', message: expect.stringContaining('局部内容'), suggestion: expect.stringContaining('重新选择') })
  await f.assertPreserved(); expect(f.documents.registry.get(f.original.documentId).read()).toEqual(committed)
  const secret = 'private-token C:\\private\\provider.json stack-secret'
  vi.spyOn(f.service.attachments, 'readRepresentation').mockRejectedValueOnce(new Error(secret))
  const unknown = await rejection(f.service.operate({ ...f.send, submissionId: randomUUID() }))
  expect(normalizeDesktopError(unknown, fallback)).toEqual(fallback)
  expect(JSON.stringify(normalizeDesktopError(unknown, fallback))).not.toContain(secret)
  expect(diagnostic).toHaveBeenCalled(); await f.assertPreserved()
})

it('keeps the IPC error envelope when diagnostics fail and stderr is unavailable', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => { throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' }) })
  vi.spyOn(diagnosticLog, 'append').mockRejectedValue(new Error('diagnostic disk unavailable'))
  expect(normalizeDesktopError(new DesktopOperationError('fixture', '操作失败', '请重试', '检查设置'), fallback)).toMatchObject({ code: 'fixture' })
  expect(normalizeDesktopError(new Error('unexpected'), fallback)).toEqual(fallback)
  vi.spyOn(diagnosticLog, 'append').mockImplementation(() => { throw new Error('diagnostic initialization unavailable') })
  expect(normalizeDesktopError(new Error('unexpected'), fallback)).toEqual(fallback)
})
