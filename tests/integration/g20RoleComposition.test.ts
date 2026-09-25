// @vitest-environment node
import { randomUUID, createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { CHATGPT_RESPONSES_BASE_URL } from '../../src/main/workbench/providers/ChatGPTResponsesProvider'
import { frozenImageRoles } from '../../src/main/workbench/images/frozenImageRoles'
import { ChatGPTImageProvider } from '../../src/main/workbench/images/ChatGPTImageProvider'
import { ImageGenerationService } from '../../src/main/workbench/images/ImageGenerationService'
import type { ExecutionConnectionConfiguration } from '../../src/shared/workbench/executionSettings'
import type { ConversationRecord } from '../../src/shared/workbench/conversations'
import type { ExecutionSendResult } from '../../src/shared/workbench/executionDesktop'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve())
  })))
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

const cipher = {
  isEncryptionAvailable: async () => true,
  encryptString: async (value: string) => Buffer.from(value),
  decryptString: async (bytes: Uint8Array) => Buffer.from(bytes).toString(),
}
const caps = (vision: 'supported' | 'unsupported' | 'unknown'): ExecutionConnectionConfiguration['capabilities'] =>
  ({ tools: 'supported', vision, stream: 'supported', reasoning: 'unknown' })
const api = (baseURL: string, role: 'text' | 'vision'): ExecutionConnectionConfiguration => ({
  provider: `fixture-${role}`, protocol: 'openai-chat', baseURL: `${baseURL}/${role}/v1`, accountId: `${role}-account`,
  authKind: 'api-key', billing: { kind: role === 'text' ? 'token-plan' : 'metered' },
  capabilities: caps(role === 'vision' ? 'supported' : 'unsupported'),
})
const image = (accountId: string): ExecutionConnectionConfiguration => ({
  provider: 'openai', protocol: 'chatgpt-responses', baseURL: CHATGPT_RESPONSES_BASE_URL, accountId,
  authKind: 'oauth', billing: { kind: 'subscription' }, capabilities: caps('unknown'),
})

async function connectOAuth(store: ExecutionSettingsStore, accountId: string) {
  const saved = await store.saveConnection({ connection: image(accountId) })
  const target = await store.reserveOAuthLogin(saved.connection.id, saved.connection.revision)
  expect(await store.compareAndSetOAuthCredential(target.credentialRef, 0, {
    connectionId: target.connectionId, revision: target.revision, accountId,
    accessToken: `${accountId}-token`, refreshToken: `${accountId}-refresh`, expiresAt: Date.now() + 3600_000,
  })).toBe(true)
  return saved.connection.id
}

it('persists text, vision, generation and edit roles, routes original bytes, and freezes image roles without supplier fallback', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-role-composition-')); directories.push(directory)
  const original = await sharp({ create: { width: 5, height: 4, channels: 4, background: '#177aa9' } }).png().toBuffer()
  const generated = await sharp({ create: { width: 6, height: 4, channels: 4, background: '#c47a22' } }).png().toBuffer()
  const wire: Array<{ url: string; authorization: string; account: string; body: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      wire.push({ url: request.url ?? '', authorization: String(request.headers.authorization ?? ''),
        account: String(request.headers['chatgpt-account-id'] ?? ''), body })
      if (request.url?.endsWith('/chat/completions')) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        response.end(`data: ${JSON.stringify({ id: 'fixture', model: String(body.model), choices: [{ index: 0,
          delta: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
      } else if (request.url?.startsWith('/backend-api/codex/images/')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ created: 1, model: 'fixture-image-actual', data: [{ b64_json: generated.toString('base64') }] }))
      } else { response.writeHead(404); response.end() }
    } catch { response.writeHead(500); response.end() }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local server')
  const baseURL = `http://127.0.0.1:${address.port}`

  const settingsDirectory = path.join(directory, 'settings')
  const settings = new ExecutionSettingsStore({ directory: settingsDirectory, encryption: cipher })
  const text = await settings.saveConnection({ connection: api(baseURL, 'text'), apiKey: 'text-token' })
  const vision = await settings.saveConnection({ connection: api(baseURL, 'vision'), apiKey: 'vision-token' })
  const imageGenerateId = await connectOAuth(settings, 'generate-account')
  const imageEditId = await connectOAuth(settings, 'edit-account')
  const profile = await settings.saveProfile({ roles: {
    conversation: { connectionId: text.connection.id, model: 'text-model' },
    vision: { connectionId: vision.connection.id, model: 'vision-model' },
    imageGenerate: { connectionId: imageGenerateId, model: 'generate-model' },
    imageEdit: { connectionId: imageEditId, model: 'edit-model' },
  } })
  const reopened = new ExecutionSettingsStore({ directory: settingsDirectory, encryption: cipher })
  expect((await reopened.read()).profile).toEqual(profile)

  const documents = new DocumentHostService(path.join(directory, 'documents'))
  const desktop = new ExecutionDesktopService({ directory: path.join(directory, 'execution'), documents, settings: reopened,
    authorizeWorkspaceRoot: async root => ({ resolvedPath: root }) })
  const space = await desktop.operate({ type: 'workspace', root: null }) as { workspace: { workspaceId: string } }
  const conversation = async () => desktop.operate({ type: 'create-conversation', workspaceId: space.workspace.workspaceId }) as Promise<ConversationRecord>
  const textConversation = await conversation()
  const textSend = await desktop.operate({ type: 'send', submissionId: randomUUID(), workspaceId: textConversation.workspaceId, conversationId: textConversation.conversationId,
    expectedRevision: textConversation.revision, text: '只问文字', documents: [], attachments: [] }) as ExecutionSendResult
  if (!textSend.run) throw new Error('Text submission did not start')
  expect((await desktop.engine.wait(textSend.run.runId)).status).toBe('completed')
  const screenshot = await desktop.attachments.receiveBytes({ name: 'screenshot.png', bytes: original, source: { kind: 'paste' } })
  const visionConversation = await conversation()
  const visionSend = await desktop.operate({ type: 'send', submissionId: randomUUID(), workspaceId: visionConversation.workspaceId, conversationId: visionConversation.conversationId,
    expectedRevision: visionConversation.revision, text: '看这张截图', documents: [],
    attachments: [{ attachmentId: screenshot.id, representationId: 'original-image', role: 'reference' }] }) as ExecutionSendResult
  if (!visionSend.run) throw new Error('Vision submission did not start')
  const visionRun = await desktop.engine.wait(visionSend.run.runId)
  expect(visionRun.status).toBe('completed')
  expect(visionRun.initialPayload?.selectionSource?.role).toBe('vision')
  expect(wire.slice(0, 2).map(entry => [entry.url, entry.authorization, entry.body.model])).toEqual([
    ['/text/v1/chat/completions', 'Bearer text-token', 'text-model'],
    ['/vision/v1/chat/completions', 'Bearer vision-token', 'vision-model'],
  ])
  const visionBody = wire[1]!.body
  expect(JSON.stringify(visionBody)).toContain(`data:image/png;base64,${original.toString('base64')}`)
  expect(JSON.stringify(visionBody)).not.toContain('screenshot.png')

  const roles = frozenImageRoles(role => reopened.snapshot(role))
  await roles.beginRun('frozen-run')
  await reopened.saveProfile({ expectedRevision: profile.revision, roles: {
    ...profile.roles, imageGenerate: { connectionId: imageEditId, model: 'next-generate-model' }, imageEdit: null,
  } })
  const transport: typeof fetch = (input, init) => {
    const endpoint = new URL(String(input))
    if (endpoint.origin !== 'https://chatgpt.com') throw new Error('Unexpected remote image origin')
    return fetch(`${baseURL}${endpoint.pathname}`, init)
  }
  const provider = new ChatGPTImageProvider({ fetch: transport, credentialResolver: async connection => {
    const entry = await reopened.readOAuthCredential(connection.auth.credentialRef)
    if (!entry.credential) throw new Error('Missing frozen credential')
    return { accessToken: entry.credential.accessToken, accountId: entry.credential.accountId }
  } })
  const images = new ImageGenerationService({ directory: path.join(directory, 'images'), provider,
    resolveReference: async (_runId, _documentId, referenceId) => {
      if (referenceId !== 'authorized-original') throw new Error('Unexpected reference')
      return { bytes: original, mimeType: 'image/png', filename: 'original.png' }
    } })
  const generation = await images.run({ jobId: randomUUID(), runId: 'frozen-run', documentId: 'document-1', operation: 'generate',
    prompt: '画一张图', selection: roles.selection('frozen-run', 'generate') })
  const editing = await images.run({ jobId: randomUUID(), runId: 'frozen-run', documentId: 'document-1', operation: 'edit',
    prompt: '调整颜色', selection: roles.selection('frozen-run', 'edit'), referenceIds: ['authorized-original'] })
  expect([generation.status, editing.status]).toEqual(['ready', 'ready'])
  expect(generation.provenance).toMatchObject({ accountId: 'generate-account', requestedImageModel: 'generate-model',
    billing: { kind: 'subscription' }, actualImageModels: ['fixture-image-actual'], references: [] })
  expect(editing.provenance).toMatchObject({ accountId: 'edit-account', requestedImageModel: 'edit-model',
    references: [{ referenceId: 'authorized-original', digest: createHash('sha256').update(original).digest('hex'), byteLength: original.byteLength }] })
  expect(wire.slice(2).map(entry => [entry.url, entry.authorization, entry.account, entry.body.model])).toEqual([
    ['/backend-api/codex/images/generations', 'Bearer generate-account-token', 'generate-account', 'generate-model'],
    ['/backend-api/codex/images/edits', 'Bearer edit-account-token', 'edit-account', 'edit-model'],
  ])
  expect(wire[3]!.body.images).toEqual([{ image_url: `data:image/png;base64,${original.toString('base64')}` }])
  expect(wire[2]!.body).not.toHaveProperty('images')
  expect(Buffer.from((await images.readResource(editing.resources[0]!.resourceId)).bytes)).toEqual(generated)

  await roles.beginRun('next-run')
  expect(roles.selection('next-run', 'generate')).toMatchObject({ connection: { accountId: 'edit-account' }, imageModel: 'next-generate-model' })
  expect(() => roles.selection('next-run', 'edit')).toThrow('开始时图片连接')
  expect(wire).toHaveLength(4)
})
