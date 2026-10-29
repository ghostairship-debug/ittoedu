// @vitest-environment node
import { createServer, type Server } from 'node:http'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionSettingsDesktopService } from '../../src/main/workbench/providers/executionSettingsService'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { ChatGPTOAuthError } from '../../src/main/workbench/providers/ChatGPTOAuthClient'
import type { ExecutionConnectionView, ExecutionSettingsView } from '../../src/shared/workbench/executionSettings'
import type { DiscoveredModels } from '../../src/shared/workbench/executionSettingsDesktop'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  for (const directory of directories.splice(0)) {
    const relative = path.relative(os.tmpdir(), path.resolve(directory))
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function setup(modelKnowledge?: ConstructorParameters<typeof ExecutionSettingsStore>[0]['modelKnowledge']) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-settings-service-')); directories.push(directory)
  const key = randomBytes(32)
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]) },
    decryptString(value: Uint8Array) { const data = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
      cipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8') },
  }
  const store = new ExecutionSettingsStore({ directory, encryption, ...(modelKnowledge ? { modelKnowledge } : {}) })
  return { directory, encryption, store, service: new ExecutionSettingsDesktopService(store) }
}
const configuration = (baseURL: string) => ({ provider: 'fixture', protocol: 'openai-chat', baseURL, accountId: 'test-account', authKind: 'api-key', billing: { kind: 'unknown' } } as const)

it.each([
  { kind: 'rejected', code: 'oauth-http-401', detail: 'HTTP 401', recovery: '重新登录' },
  { kind: 'unavailable', code: 'oauth-http-503', detail: 'HTTP 503', recovery: '稍后重试' },
  { kind: 'network', code: 'oauth-request-failed', detail: '更新请求未完成', recovery: '检查网络' },
  { kind: 'unknown', code: 'oauth-operation-failed', detail: '登录操作未完成', recovery: '重试' },
] as const)('reports $kind OAuth refresh failures through the real credential owner without changing settings or leaking tokens', async scenario => {
  const { store, directory } = await setup()
  const saved = await store.saveConnection({ connection: { provider: 'openai', protocol: 'chatgpt-responses',
    baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'pending-login', authKind: 'oauth', billing: { kind: 'subscription' },
    capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } } })
  const target = await store.reserveOAuthLogin(saved.connection.id, saved.connection.revision)
  const accessToken = 'fixture-private-oauth-access', refreshToken = 'fixture-private-oauth-refresh', now = 1_000_000
  expect(await store.compareAndSetOAuthCredential(target.credentialRef, 0, { connectionId: target.connectionId,
    revision: target.revision, accountId: 'fixture-account', accessToken, refreshToken, expiresAt: now - 1 })).toBe(true)
  const connected = (await store.read()).connections[0]!
  const profile = (await store.read()).profile
  await store.saveProfile({ expectedRevision: profile.revision, roles: { ...profile.roles,
    conversation: { connectionId: connected.connection.id, model: 'preserve-user-model' } } })
  const before = await store.read(), file = path.join(directory, 'execution-settings-v1.json')
  const storedBefore = await fs.readFile(file, 'utf8')
  let refreshRequests = 0
  const openExternal = vi.fn(async () => { throw new Error('This settings read must not open a login browser') })
  const oauth = new OAuthDesktopService({ store, now: () => now, openExternal, fetch: async (url, init) => {
    refreshRequests++
    expect(String(url)).toBe('https://auth.openai.com/oauth/token')
    const fields = new URLSearchParams(String(init?.body))
    expect(fields.get('grant_type')).toBe('refresh_token')
    expect(fields.get('refresh_token')).toBe(refreshToken)
    if (scenario.kind === 'network') throw new Error(`transport detail ${accessToken} ${refreshToken}`)
    if (scenario.kind === 'unknown') {
      const error = new ChatGPTOAuthError(`untrusted-${accessToken}-${refreshToken}`)
      error.message = `untrusted response ${accessToken} ${refreshToken}`
      throw error
    }
    return new Response(`response body ${accessToken} ${refreshToken}`, { status: scenario.kind === 'rejected' ? 401 : 503 })
  } })
  const catalog = vi.fn(async () => Response.json({ models: [{ slug: 'must-not-select-this-model' }] }))
  const service = new ExecutionSettingsDesktopService(store, catalog, oauth)
  const failure = await service.operate({ type: 'discover-models', id: connected.connection.id, revision: connected.connection.revision })
    .then(() => { throw new Error('Expected refresh failure before catalog discovery') }, error => error)
  expect(failure).toMatchObject({ code: scenario.code, message: expect.stringContaining(scenario.detail), suggestion: expect.stringContaining(scenario.recovery) })
  expect(String(failure)).not.toContain('系统安全存储')
  expect(refreshRequests).toBe(1)
  expect(catalog).not.toHaveBeenCalled()
  expect(openExternal).not.toHaveBeenCalled()

  // A completed login's optional directory read uses the same safe diagnostic;
  // a refresh failure must not apply model defaults or discard the login status.
  vi.spyOn(oauth, 'status').mockReturnValue({ loginId: 'connected-fixture', status: 'connected', connection: connected })
  const status = await service.operate({ type: 'oauth-login-status', loginId: 'connected-fixture' })
  expect(status).toMatchObject({ status: 'connected', modelDirectoryError: expect.stringContaining(scenario.detail) })
  expect((status as { modelDirectoryError: string }).modelDirectoryError).toContain(scenario.recovery)
  expect(refreshRequests).toBe(2)
  expect(catalog).not.toHaveBeenCalled()
  const after = await store.read(), storedAfter = await fs.readFile(file, 'utf8')
  expect(after).toEqual(before)
  expect(storedAfter).toBe(storedBefore)
  for (const exposed of [String(failure), JSON.stringify(failure), JSON.stringify(status), JSON.stringify(after), storedAfter]) {
    expect(exposed).not.toContain(accessToken)
    expect(exposed).not.toContain(refreshToken)
  }
})

it('admits only strict settings operations, exposes no credential read and never accepts a UI capability success claim', async () => {
  const { service } = await setup()
  const saved = await service.operate({ type: 'save-connection', input: { connection: configuration('https://fixture.invalid/v1'), apiKey: 'fixture-private-key' } }) as ExecutionConnectionView
  expect(saved).toMatchObject({ hasCredential: true, connection: { capabilities: { tools: 'unknown', vision: 'unknown' }, billing: { kind: 'unknown' } } })
  for (const invalid of [
    { type: 'read', apiKey: 'should-never-be-echoed' }, { type: 'resolve-credential', id: saved.connection.id },
    { type: 'save-connection', input: { connection: { ...configuration('https://fixture.invalid/v1'), capabilities: { tools: 'supported' } } } },
  ]) await expect(service.operate(invalid)).rejects.toMatchObject({ code: 'invalid-settings-request' })
  const view = await service.operate({ type: 'read' }) as ExecutionSettingsView
  expect(JSON.stringify(view)).not.toContain('fixture-private-key')
  expect(JSON.stringify(view)).not.toContain('encrypted')
  await service.operate({ type: 'save-profile', input: { expectedRevision: 0, roles: {
    conversation: { connectionId: saved.connection.id, model: 'fixture-text' }, vision: null, imageGenerate: null, imageEdit: null,
  } } })
  await service.operate({ type: 'revoke-connection', id: saved.connection.id })
  expect((await service.operate({ type: 'read' }) as ExecutionSettingsView).connections[0]).toMatchObject({ revoked: true, hasCredential: false })
})

it('reads models only on explicit action with current stored credentials, retaining unknown capabilities and sanitized failures', async () => {
  const { service, store } = await setup()
  let requests = 0, generationRequests = 0
  const server = createServer((req, res) => {
    requests++
    if (req.method !== 'GET' || req.url !== '/v1/models') generationRequests++
    expect(req.headers.authorization).toBe('Bearer fixture-private-key')
    if (requests === 1) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })) }
    else { res.writeHead(401); res.end('Authorization Bearer fixture-private-key') }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address')
  const saved = await service.operate({ type: 'save-connection', input: { connection: configuration(`http://127.0.0.1:${address.port}/v1`), apiKey: 'fixture-private-key' } }) as ExecutionConnectionView
  await service.operate({ type: 'read' })
  expect(requests).toBe(0)
  expect(await service.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 })).toMatchObject({ models: [{ id: 'a' }, { id: 'b' }], capabilitiesVerified: false })
  expect((await store.read()).connections[0]!.connection.capabilities.tools).toBe('unknown')
  const failure = await service.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 }).catch(error => error as Error)
  expect(String(failure)).toContain('HTTP 401')
  expect(JSON.stringify(failure)).not.toContain('fixture-private-key')
  await service.operate({ type: 'revoke-connection', id: saved.connection.id })
  await expect(service.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 })).rejects.toMatchObject({ code: 'credential-revoked' })
  expect(requests).toBe(2); expect(generationRequests).toBe(0)
})

it('persists model labels for the same connection revision and selects cached directory only on transport failure', async () => {
  const { directory, encryption, service } = await setup()
  let requests = 0, offline = false
  const server = createServer((req, res) => {
    requests++
    if (offline) { req.socket.destroy(); return }
    expect(req.url).toBe('/v1/models')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ data: [{ id: 'fixture-model', name: '好用的模型', description: '对话与规划',
      supported_reasoning_efforts: [{ reasoning_effort: 'high' }] }] }))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address')
  const saved = await service.operate({ type: 'save-connection', input: { connection: configuration(`http://127.0.0.1:${address.port}/v1`),
    apiKey: 'fixture-private-key' } }) as ExecutionConnectionView
  const live = await service.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 })
  expect(live).toMatchObject({ source: 'live', models: [{ id: 'fixture-model', displayName: '好用的模型', description: '对话与规划' }] })
  expect((live as { models: { reasoningEfforts?: unknown }[] }).models[0]!.reasoningEfforts).toEqual([{ effort: 'high' }])
  const bytes = await fs.readFile(path.join(directory, 'execution-settings-v1.json'), 'utf8')
  expect(bytes).toContain('fixture-model'); expect(bytes).not.toContain('fixture-private-key')
  offline = true
  const reopened = new ExecutionSettingsDesktopService(new ExecutionSettingsStore({ directory, encryption }))
  const cached = await reopened.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 })
  expect(cached).toMatchObject({ source: 'cache', checkedAt: (live as { checkedAt: string }).checkedAt, models: [{ id: 'fixture-model' }] })
  expect(requests).toBe(2)
  await service.operate({ type: 'revoke-connection', id: saved.connection.id })
  await expect(reopened.operate({ type: 'discover-models', id: saved.connection.id, revision: 1 })).rejects.toMatchObject({ code: 'credential-revoked' })
})

it('keeps echoed credentials and customer text out of probe results, settings reads and persisted facts', async () => {
  const { directory, service } = await setup()
  const credential = 'fixture-private-key', customerText = '客户私有正文-不要进入诊断'
  let requests = 0
  const server = createServer((request, response) => {
    let source = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { source += chunk })
    request.on('end', () => {
      requests++
      const body = JSON.parse(source) as { messages: { content: string }[]; tools?: { function: { name: string } }[] }
      expect(request.headers.authorization).toBe(`Bearer ${credential}`)
      const tool = Boolean(body.tools)
      const token = tool ? String(body.messages[0]!.content).match(/token：([^\s]+)/)?.[1] : undefined
      const delta = tool
        ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: {
          name: body.tools![0]!.function.name, arguments: JSON.stringify({ token }),
        } }] }
        : { role: 'assistant', content: `${customerText} ${credential}` }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(`data: ${JSON.stringify({ id: `response-${requests}`,
        model: tool ? requests === 2 ? credential : customerText : 'fixture-actual-model-v2',
        choices: [{ index: 0, delta, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`)
      response.end('data: [DONE]\n\n')
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address')
  const saved = await service.operate({ type: 'save-connection', input: {
    connection: configuration(`http://127.0.0.1:${address.port}/v1`), apiKey: credential,
  } }) as ExecutionConnectionView
  await service.operate({ type: 'save-profile', input: { expectedRevision: 0, roles: {
    conversation: { connectionId: saved.connection.id, model: 'fixture-text' },
    vision: { connectionId: saved.connection.id, model: 'fixture-vision' }, imageGenerate: null, imageEdit: null,
  } } })

  const vision = await service.operate({ type: 'probe-capabilities', role: 'vision', expectedProfileRevision: 1, checks: ['vision'] })
  expect(vision).toMatchObject({ lastProbe: { outcomes: [{ code: 'probe-answer-mismatch', status: 'unknown',
    actualModel: 'fixture-actual-model-v2' }] } })
  const tools = await service.operate({ type: 'probe-capabilities', role: 'conversation', expectedProfileRevision: 1, checks: ['tools'] })
  expect(tools).toMatchObject({ facts: { tools: { status: 'supported' } }, lastProbe: { outcomes: [{ code: 'probe-tool-observed', status: 'supported' }] } })
  const toolRecord = tools as { facts: { tools?: { actualModel?: string } }; lastProbe: { outcomes: { actualModel?: string }[] } }
  expect(toolRecord.facts.tools?.actualModel).toBeUndefined()
  expect(toolRecord.lastProbe.outcomes[0]?.actualModel).toBeUndefined()
  const customerModel = await service.operate({ type: 'probe-capabilities', role: 'conversation', expectedProfileRevision: 1, checks: ['tools'] })
  const customerRecord = customerModel as { facts: { tools?: { actualModel?: string } }; lastProbe: { outcomes: { actualModel?: string }[] } }
  expect(customerRecord.facts.tools?.actualModel).toBeUndefined()
  expect(customerRecord.lastProbe.outcomes[0]?.actualModel).toBeUndefined()
  expect(requests).toBe(3)

  const publicView = await service.operate({ type: 'read' }) as ExecutionSettingsView
  const persisted = await fs.readFile(path.join(directory, 'execution-settings-v1.json'), 'utf8')
  for (const output of [JSON.stringify(vision), JSON.stringify(tools), JSON.stringify(customerModel), JSON.stringify(publicView), persisted]) {
    expect(output).not.toContain(credential)
    expect(output).not.toContain(customerText)
  }
  expect(JSON.stringify(publicView)).toContain('fixture-actual-model-v2')
})


it('reads the actual model directory above the old byte and entry quotas', async () => {
  const { store, directory, encryption } = await setup({ knownModels: async () => [], find: async () => undefined, enrich: async (_connection, models) => models })
  const saved = await store.saveConnection({ connection: { ...configuration('https://fixture.invalid/v1'), capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } }, apiKey: 'fixture-private-key' })
  const entries = Array.from({ length: 5000 }, (_, index) => ({ id: `catalog-model-${index}`, name: '目录名称'.repeat(60) }))
  const payload = JSON.stringify({ data: entries })
  expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024)
  const service = new ExecutionSettingsDesktopService(store, async () => new Response(payload))
  const result = await service.operate({ type: 'discover-models', id: saved.connection.id, revision: saved.connection.revision }) as DiscoveredModels
  expect(result.models).toHaveLength(5000)
  expect(result.models.some(model => model.id === 'catalog-model-4999')).toBe(true)
  const cached = await new ExecutionSettingsStore({ directory, encryption }).cachedModelCatalog(saved.connection.id, saved.connection.revision)
  expect(cached?.models).toHaveLength(5000)
})
