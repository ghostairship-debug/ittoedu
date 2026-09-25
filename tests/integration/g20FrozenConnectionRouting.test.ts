// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = [], servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('fixture outside temp')
    await fs.rm(root, { recursive: true, force: true })
  }
})

function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return { isEncryptionAvailable: () => true,
    encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]) },
    decryptString(value) { const bytes = Buffer.from(value), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8') },
  }
}
function sse(response: ServerResponse, model: string, chunks: unknown[]) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}
function finished(response: ServerResponse, id: string, model: string, text: string) {
  sse(response, model, [
    { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ])
}
async function waitForRun(service: ExecutionDesktopService, runId: string): Promise<ExecutionRunRecord> {
  for (let attempt = 0; attempt < 150; attempt++) {
    const run = await service.operate({ type: 'run', runId }) as ExecutionRunRecord | null
    if (run && ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(run.status)) return run
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('fixture run did not settle')
}
async function waitForAssistant(service: ExecutionDesktopService, workspaceId: string, conversationId: string, runId: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const conversation = await service.operate({ type: 'conversation', workspaceId, conversationId }) as
      { revision: number; messages: Array<{ role: string; runId?: string }> }
    if (conversation.messages.some(message => message.role === 'assistant' && message.runId === runId)) return conversation
    await new Promise<void>(resolve => setTimeout(resolve, 10))
  }
  throw new Error('fixture assistant was not projected')
}

it('freezes the active Token Plan route through tool continuation while a later reopened turn uses explicit metered settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-frozen-routing-')); roots.push(root)
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const firstFile = path.join(workspace, 'first.md'), secondFile = path.join(workspace, 'second.md')
  const firstText = 'first before\n'
  await fs.writeFile(firstFile, firstText); await fs.writeFile(secondFile, 'second before\n')
  const documents = new DocumentHostService(path.join(root, 'journals'))
  const firstDocument = await documents.open(firstFile)
  const settingsOptions = { directory: path.join(root, 'settings'), encryption: encryption() }
  const settings = new ExecutionSettingsStore(settingsOptions)

  type Wire = { path: string; auth: string | undefined; model: string; documentIds: string[] }
  const received: Wire[] = []
  let firstEntered!: () => void, releaseFirst!: () => void
  const entered = new Promise<void>(resolve => { firstEntered = resolve })
  const gate = new Promise<void>(resolve => { releaseFirst = resolve })
  const server = createServer((request, response) => { void (async () => {
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw) as { model: string; messages: Array<{ role: string; content?: string; tool_call_id?: string }>; tools: Array<{ function: { name: string; description: string } }> }
    const fixed = body.messages.find(message => message.role === 'system' && message.content?.startsWith('本次固定文档与权限'))?.content
    const documentIds = fixed ? (JSON.parse(fixed.slice(fixed.indexOf('：') + 1)) as Array<{ documentId: string }>).map(value => value.documentId) : []
    received.push({ path: request.url ?? '', auth: request.headers.authorization, model: body.model, documentIds })
    if (received.length === 1) firstEntered()
    if (request.url === '/token/v1/chat/completions' && received.length === 1) {
      await gate
      const references = JSON.parse(fixed!.slice(fixed!.indexOf('：') + 1)) as Array<{ writable: Array<{ target: string }> }>
      const name = body.tools.find(tool => tool.function.description.includes('原位替换'))?.function.name
      if (!name) throw new Error('text replace tool unavailable')
      sse(response, 'token-actual', [
        { id: 'token-response-1', object: 'chat.completion.chunk', model: 'token-actual', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'token-tool-1', type: 'function', function: { name, arguments: JSON.stringify({ target: references[0]!.writable[0]!.target, content: 'first changed\n' }) } }] }, finish_reason: null }] },
        { id: 'token-response-1', object: 'chat.completion.chunk', model: 'token-actual', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ])
    } else if (request.url === '/token/v1/chat/completions') {
      expect(body.messages.some(message => message.role === 'tool' && message.tool_call_id === 'token-tool-1')).toBe(true)
      finished(response, 'token-response-2', 'token-actual', '首轮已完成')
    } else if (request.url === '/metered/v1/chat/completions') {
      finished(response, 'metered-response-1', 'metered-actual', '第二轮已完成')
    } else { response.writeHead(404); response.end('unexpected local route') }
  })().catch(error => { response.destroy(error) }) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const localFetch: typeof fetch = (url, init) => {
    if (new URL(String(url)).origin !== origin) throw new Error('non-fixture network forbidden')
    return fetch(url, init)
  }
  const capabilities = { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } as const
  const tokenConfig = { provider: 'fixture-token', protocol: 'openai-chat' as const, baseURL: `${origin}/token/v1`,
    accountId: 'token-account', authKind: 'api-key' as const, billing: { kind: 'token-plan' as const }, capabilities }
  const meteredConfig = { provider: 'fixture-metered', protocol: 'openai-chat' as const, baseURL: `${origin}/metered/v1`,
    accountId: 'metered-account', authKind: 'api-key' as const, billing: { kind: 'metered' as const }, capabilities }
  const token = await settings.saveConnection({ connection: tokenConfig, apiKey: 'token-secret-v1' })
  const metered = await settings.saveConnection({ connection: meteredConfig, apiKey: 'metered-secret' })
  const oauth = await settings.saveConnection({ connection: { provider: 'openai', protocol: 'chatgpt-responses',
    baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'pending-login', authKind: 'oauth',
    billing: { kind: 'subscription' }, capabilities } })
  expect(oauth.hasCredential).toBe(false)
  const roles = (connectionId: string, model: string) => ({ conversation: { connectionId, model }, vision: null, imageGenerate: null, imageEdit: null })
  await settings.saveProfile({ expectedRevision: 0, roles: roles(token.connection.id, 'token-model') })
  const directory = path.join(root, 'execution')
  const service = new ExecutionDesktopService({ directory, documents, settings,
    authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: localFetch })
  const opened = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const workspaceId = opened.workspace.workspaceId
  const conversation = await service.operate({ type: 'create-conversation', workspaceId }) as { conversationId: string; revision: number }
  const conversationId = conversation.conversationId
  const first = await service.operate({ type: 'send', workspaceId, conversationId,
    submissionId: 'b1111111-1111-4111-8111-111111111111', expectedRevision: conversation.revision,
    text: '修改第一份文件', documents: [{ documentId: firstDocument.documentId, epoch: firstDocument.epoch,
      revision: firstDocument.revision, writable: [{ kind: 'markdown-range', from: 0, to: firstText.length }] }] }) as
    { submission: { model: { model: string; provider: string; accountId: string; billing: string } }; run: ExecutionRunRecord }
  try {
    await entered
    expect(first.submission.model).toEqual({ model: 'token-model', provider: 'fixture-token', accountId: 'token-account', billing: 'token-plan' })
    await settings.saveConnection({ id: token.connection.id, expectedRevision: token.connection.revision,
      connection: { ...tokenConfig, baseURL: `${origin}/token-updated/v1` }, apiKey: 'token-secret-v2' })
    await settings.saveProfile({ expectedRevision: 1, roles: roles(metered.connection.id, 'metered-model') })
    const secondDocument = await documents.open(secondFile)
    expect(secondDocument.documentId).not.toBe(firstDocument.documentId)
    expect(await service.operate({ type: 'conversation', workspaceId, conversationId })).toMatchObject({ conversationId })
  } finally { releaseFirst() }
  const firstRun = await waitForRun(service, first.run.runId)
  expect(firstRun.status).toBe('completed')
  expect(firstRun.input.selection).toMatchObject({ model: 'token-model', profileRevision: 1,
    connection: { id: token.connection.id, revision: 1, baseURL: tokenConfig.baseURL, accountId: 'token-account',
      auth: { kind: 'api-key' }, billing: { kind: 'token-plan' } } })
  expect(firstRun.requests.map(value => value.actualModel)).toEqual(['token-actual', 'token-actual'])
  expect(await documents.internalAPI.read(firstDocument.documentId)).toMatchObject({ model: { source: 'first changed\n' } })
  expect(received.slice(0, 2)).toEqual([
    { path: '/token/v1/chat/completions', auth: 'Bearer token-secret-v1', model: 'token-model', documentIds: [firstDocument.documentId] },
    { path: '/token/v1/chat/completions', auth: 'Bearer token-secret-v1', model: 'token-model', documentIds: [firstDocument.documentId] },
  ])

  const completedConversation = await waitForAssistant(service, workspaceId, conversationId, first.run.runId)
  const reopenedSettings = new ExecutionSettingsStore(settingsOptions)
  const reopened = new ExecutionDesktopService({ directory, documents, settings: reopenedSettings,
    authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: localFetch })
  expect(await reopened.operate({ type: 'conversation', workspaceId, conversationId })).toEqual(completedConversation)
  expect(received).toHaveLength(2)
  const secondDocument = await documents.open(secondFile)
  const next = await reopened.operate({ type: 'send', workspaceId, conversationId,
    submissionId: 'b2222222-2222-4222-8222-222222222222', expectedRevision: completedConversation.revision,
    text: '检查第二份文件', documents: [{ documentId: secondDocument.documentId, epoch: secondDocument.epoch,
      revision: secondDocument.revision, writable: [{ kind: 'document' }] }] }) as
    { submission: { model: { model: string; provider: string; accountId: string; billing: string } }; run: ExecutionRunRecord }
  const nextRun = await waitForRun(reopened, next.run.runId)
  expect(nextRun.status).toBe('completed')
  expect(next.submission.model).toEqual({ model: 'metered-model', provider: 'fixture-metered', accountId: 'metered-account', billing: 'metered' })
  expect(nextRun.input.selection).toMatchObject({ model: 'metered-model', profileRevision: 2,
    connection: { id: metered.connection.id, revision: 1, accountId: 'metered-account', auth: { kind: 'api-key' }, billing: { kind: 'metered' } } })
  expect(nextRun.requests.map(value => value.actualModel)).toEqual(['metered-actual'])
  expect(received[2]).toEqual({ path: '/metered/v1/chat/completions', auth: 'Bearer metered-secret',
    model: 'metered-model', documentIds: [secondDocument.documentId] })
  expect(received).toHaveLength(3)

  await waitForAssistant(reopened, workspaceId, conversationId, next.run.runId)
  await reopenedSettings.saveProfile({ expectedRevision: 2, roles: roles(oauth.connection.id, 'oauth-model') })
  const latest = await reopened.operate({ type: 'conversation', workspaceId, conversationId }) as { revision: number }
  await expect(reopened.operate({ type: 'send', workspaceId, conversationId,
    submissionId: 'b3333333-3333-4333-8333-333333333333', expectedRevision: latest.revision,
    text: '未登录的可选 OAuth 不应回退到 API', documents: [] })).rejects.toThrow('连接尚未接通')
  expect(received).toHaveLength(3)
})
