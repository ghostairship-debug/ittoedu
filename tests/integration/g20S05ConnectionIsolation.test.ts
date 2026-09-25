// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { ExecutionDesktopService } from '../../src/main/workbench/execution/ExecutionDesktopService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionRunRecord } from '../../src/shared/workbench/execution'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe S05 fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})

function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return { isEncryptionAvailable: () => true,
    encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]) },
    decryptString(value) { const bytes = Buffer.from(value), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8') },
  }
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-s05-connection-isolation-'))
  roots.push(root)
  const received: { path: string; authorization: string | undefined; model: string }[] = []
  const server = createServer((request, response) => { void (async () => {
    let body = ''; for await (const chunk of request) body += chunk
    const parsed = JSON.parse(body) as { model: string }
    received.push({ path: request.url ?? '', authorization: request.headers.authorization, model: parsed.model })
    const id = `fixture-response-${received.length}`
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-actual',
      choices: [{ index: 0, delta: { role: 'assistant', content: `完成 ${received.length}` }, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: 'fixture-actual',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
    response.end('data: [DONE]\n\n')
  })().catch(error => response.destroy(error)) })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const localFetch: typeof fetch = (url, init) => {
    if (new URL(String(url)).origin !== origin) throw new Error('Fixture forbids nonlocal model requests')
    return fetch(url, init)
  }
  const workspace = path.join(root, 'workspace')
  await fs.mkdir(workspace)
  const documents = new DocumentHostService(path.join(root, 'documents'))
  const settings = new ExecutionSettingsStore({ directory: path.join(root, 'settings'), encryption: encryption() })
  const service = new ExecutionDesktopService({ directory: path.join(root, 'execution'), documents, settings,
    authorizeWorkspaceRoot: async input => ({ resolvedPath: await fs.realpath(input) }), fetch: localFetch })
  const opened = await service.operate({ type: 'workspace', root: workspace }) as { workspace: { workspaceId: string } }
  const workspaceId = opened.workspace.workspaceId
  const conversation = await service.operate({ type: 'create-conversation', workspaceId }) as { conversationId: string }
  const conversationId = conversation.conversationId
  const capabilities = { tools: 'supported', vision: 'unknown', stream: 'supported', reasoning: 'unknown' } as const
  const config = { provider: 'fixture-provider', protocol: 'openai-chat' as const, baseURL: `${origin}/primary/v1`,
    accountId: 'account-A', authKind: 'api-key' as const, billing: { kind: 'metered' as const }, capabilities }
  const first = await settings.saveConnection({ connection: config, apiKey: 'fixture-key-A' })
  await settings.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: first.connection.id, model: 'fixture-model' },
    vision: null, imageGenerate: null, imageEdit: null } })
  const sendTurn = async (text: string): Promise<ExecutionRunRecord> => {
    const current = await service.operate({ type: 'conversation', workspaceId, conversationId }) as { revision: number }
    const sent = await service.operate({ type: 'send', workspaceId, conversationId, submissionId: randomUUID(),
      expectedRevision: current.revision, text, documents: [] }) as { run: ExecutionRunRecord }
    for (let attempt = 0; attempt < 150; attempt++) {
      const run = await service.operate({ type: 'run', runId: sent.run.runId }) as ExecutionRunRecord | null
      const latest = await service.operate({ type: 'conversation', workspaceId, conversationId }) as { messages: Array<{ role: string; runId?: string }> }
      if (run?.status === 'completed' && latest.messages.some(message => message.role === 'assistant' && message.runId === run.runId)) return run
      if (run && ['failed', 'partial', 'stopped', 'interrupted'].includes(run.status)) throw new Error(`Fixture run ended: ${run.status}`)
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Fixture run did not finish')
  }
  return { root, origin, settings, service, workspaceId, conversationId, config, first, received, sendTurn }
}

it('S05-T02 reuses one product connection selection for three turns and switches account credentials for later requests', async () => {
  const { root, settings, first, config, received, sendTurn, service, workspaceId, conversationId } = await fixture()
  const runs = []
  for (const index of [1, 2, 3]) runs.push(await sendTurn(`同账户第 ${index} 轮`))
  expect(runs.map(run => run.input.selection.connection.id)).toEqual(Array(3).fill(first.connection.id))
  expect(runs.map(run => run.input.selection.connection.revision)).toEqual([1, 1, 1])
  expect(new Set(runs.map(run => run.input.selection.connection.auth.credentialRef)).size).toBe(1)
  expect(runs.map(run => run.input.selectionSource?.profileRevision)).toEqual([1, 1, 1])
  expect(received).toEqual(Array(3).fill(null).map(() => ({ path: '/primary/v1/chat/completions', authorization: 'Bearer fixture-key-A', model: 'fixture-model' })))

  const retained = await settings.saveConnection({ id: first.connection.id, expectedRevision: 1, connection: config })
  expect(retained.hasCredential).toBe(true)
  const retainedRun = await sendTurn('同账户同地址更新配置后继续使用')
  expect(retainedRun.input.selection.connection).toMatchObject({ id: first.connection.id, revision: 2,
    auth: { credentialRef: retained.connection.auth.credentialRef } })
  expect(received[3]).toEqual({ path: '/primary/v1/chat/completions', authorization: 'Bearer fixture-key-A', model: 'fixture-model' })

  const blankAccountB = await settings.saveConnection({ id: first.connection.id, expectedRevision: 2,
    connection: { ...config, accountId: 'account-B' } })
  expect(blankAccountB.hasCredential).toBe(false)
  const current = await service.operate({ type: 'conversation', workspaceId, conversationId }) as { revision: number }
  await expect(service.operate({ type: 'send', workspaceId, conversationId, submissionId: randomUUID(),
    expectedRevision: current.revision, text: '账户已变但尚无新密钥', documents: [] })).rejects.toThrow()
  expect(received).toHaveLength(4)
  const accountB = await settings.saveConnection({ id: first.connection.id, expectedRevision: 3,
    connection: { ...config, accountId: 'account-B' }, apiKey: 'fixture-key-B' })
  expect(accountB.connection.revision).toBe(4)
  expect(accountB.connection.auth.credentialRef).not.toBe(first.connection.auth.credentialRef)
  const next = await sendTurn('切换账户后的新请求')
  expect(next.input.selection.connection).toMatchObject({ id: first.connection.id, revision: 4, accountId: 'account-B',
    auth: { kind: 'api-key', credentialRef: accountB.connection.auth.credentialRef } })
  expect(received[4]).toEqual({ path: '/primary/v1/chat/completions', authorization: 'Bearer fixture-key-B', model: 'fixture-model' })
  expect(received).toHaveLength(5)

  for (const directory of ['runs', 'submissions']) {
    for (const name of await fs.readdir(path.join(root, 'execution', directory))) {
      if (!name.endsWith('.json')) continue
      const persisted = await fs.readFile(path.join(root, 'execution', directory, name), 'utf8')
      expect(persisted).not.toContain('fixture-key-A')
      expect(persisted).not.toContain('fixture-key-B')
    }
  }
  const storedSettings = await fs.readFile(path.join(root, 'settings', 'execution-settings-v1.json'), 'utf8')
  expect(storedSettings).not.toContain('fixture-key-A')
  expect(storedSettings).not.toContain('fixture-key-B')
})

it('S05-T02 does not send an old account key to a changed endpoint when no new key was supplied', async () => {
  const { settings, first, config, received, service, workspaceId, conversationId, origin, sendTurn } = await fixture()
  await sendTurn('切换前的请求')
  const changed = await settings.saveConnection({ id: first.connection.id, expectedRevision: 1,
    connection: { ...config, baseURL: `${origin}/changed/v1` } })
  const before = received.length
  const current = await service.operate({ type: 'conversation', workspaceId, conversationId }) as { revision: number }
  const attempted = await service.operate({ type: 'send', workspaceId, conversationId, submissionId: randomUUID(),
    expectedRevision: current.revision, text: '切换 endpoint 后的请求', documents: [] }).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }))
  if (attempted.ok) {
    const runId = (attempted.value as { run: ExecutionRunRecord }).run.runId
    for (let attempt = 0; attempt < 150; attempt++) {
      const run = await service.operate({ type: 'run', runId }) as ExecutionRunRecord | null
      if (run && ['completed', 'partial', 'failed', 'stopped', 'interrupted'].includes(run.status)) break
      await new Promise<void>(resolve => setTimeout(resolve, 10))
    }
  }
  expect(received.slice(before)).toEqual([])
  expect(changed.hasCredential).toBe(false)
  expect(attempted.ok).toBe(false)
  const replacement = await settings.saveConnection({ id: first.connection.id, expectedRevision: changed.connection.revision,
    connection: { ...config, baseURL: `${origin}/changed/v1` }, apiKey: 'fixture-key-new-endpoint' })
  expect(replacement.hasCredential).toBe(true)
  const newEndpointRun = await sendTurn('明确配置新 endpoint 密钥后请求')
  expect(newEndpointRun.input.selection.connection).toMatchObject({ revision: replacement.connection.revision,
    baseURL: `${origin}/changed/v1`, auth: { credentialRef: replacement.connection.auth.credentialRef } })
  expect(received.slice(before)).toEqual([{ path: '/changed/v1/chat/completions',
    authorization: 'Bearer fixture-key-new-endpoint', model: 'fixture-model' }])
  const changedProtocol = await settings.saveConnection({ id: first.connection.id, expectedRevision: replacement.connection.revision,
    connection: { ...config, baseURL: `${origin}/changed/v1`, protocol: 'chatgpt-responses' } })
  expect(changedProtocol.hasCredential).toBe(false)
})
