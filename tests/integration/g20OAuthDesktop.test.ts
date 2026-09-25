// @vitest-environment node
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { OAuthDesktopService } from '../../src/main/workbench/providers/OAuthDesktopService'
import { ExecutionSettingsDesktopService } from '../../src/main/workbench/providers/executionSettingsService'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'

const directories: string[] = [], servers: Server[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }))); await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))) })
function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return { isEncryptionAvailable: () => true, encryptString: plaintext => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
    return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]) },
  decryptString: ciphertext => { const bytes = Buffer.from(ciphertext), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8') } }
}
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-oauth-')); directories.push(directory)
  const port = encryption(), store = new ExecutionSettingsStore({ directory, encryption: port })
  const saved = await store.saveConnection({ connection: { provider: 'openai', protocol: 'chatgpt-responses', baseURL: 'https://chatgpt.com/backend-api/codex', accountId: 'pending-login', authKind: 'oauth', billing: { kind: 'subscription' },
    capabilities: { tools: 'unknown', stream: 'unknown', reasoning: 'unknown', vision: 'unknown' } } })
  return { directory, port, store, saved }
}
const token = (account = 'current-account') => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.fixture-signature`
async function tokenServer(handler?: (fields: URLSearchParams, response: ServerResponse) => Promise<void> | void): Promise<typeof fetch> {
  const server = createServer((req, res) => { void (async () => {
    expect(req.url).toBe('/oauth/token'); const parts: Buffer[] = []; for await (const value of req) parts.push(Buffer.from(value))
    const fields = new URLSearchParams(Buffer.concat(parts).toString('utf8'))
    if (handler) { await handler(fields, res); return }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ access_token: token(), refresh_token: 'private-refresh', expires_in: 120 }))
  })().catch(() => res.destroy()) }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error()
  return (url, init) => fetch(`http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`, init)
}
function callback(authorizationURL: string, state?: string) { const auth = new URL(authorizationURL), url = new URL(auth.searchParams.get('redirect_uri')!)
  url.search = new URLSearchParams({ state: state ?? auth.searchParams.get('state')!, code: 'new-owner-code' }).toString(); return url.toString() }

it('real loopback login atomically saves current account and encrypted tokens, reopens, refreshes and revokes frozen revisions', async () => {
  const { directory, port, store, saved } = await setup(); let authorizationURL = '', now = 1_000_000, refreshes = 0
  const transport = await tokenServer((fields, res) => { if (fields.get('grant_type') === 'refresh_token') { refreshes++; expect(fields.get('refresh_token')).toBe('private-refresh') }
    res.end(JSON.stringify({ access_token: token(), refresh_token: 'private-refresh', expires_in: 120 })) })
  const oauth = new OAuthDesktopService({ store, openExternal: async url => { authorizationURL = url }, callbackPort: 0, callbackHost: '127.0.0.1', fetch: transport, now: () => now })
  const service = new ExecutionSettingsDesktopService(store, transport, oauth)
  const started = await service.operate({ type: 'oauth-login-start', id: saved.connection.id, revision: saved.connection.revision }) as { loginId: string }
  expect((await store.read()).connections[0]).toMatchObject({ hasCredential: false, connection: { revision: 1, accountId: 'pending-login' } })
  expect((await fetch(callback(authorizationURL, 'wrong-state'))).status).toBe(400)
  expect(oauth.status(started.loginId).status).toBe('pending')
  const result = await fetch(callback(authorizationURL)); expect(result.status).toBe(200)
  const status = oauth.status(started.loginId); expect(status.status).toBe('connected'); if (status.status !== 'connected') throw new Error()
  expect(status.connection).toMatchObject({ hasCredential: true, connection: { revision: 2, accountId: 'current-account', capabilities: { tools: 'unknown', vision: 'unknown' } } })
  const bytes = await fs.readFile(path.join(directory, 'execution-settings-v1.json'), 'utf8')
  expect(bytes).not.toContain('private-refresh'); expect(bytes).not.toContain(token())
  const reopened = new ExecutionSettingsStore({ directory, encryption: port })
  expect((await reopened.read()).connections[0]).toEqual(status.connection)
  expect(await oauth.resolveCredential(status.connection.connection)).toEqual({ accountId: 'current-account', accessToken: token() })
  let catalogRequests = 0
  const catalog = new ExecutionSettingsDesktopService(store, async (url, init) => {
    catalogRequests++
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/models?client_version=1.0.0')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token()}`, 'chatgpt-account-id': 'current-account' })
    return Response.json({ models: [{ slug: 'gpt-6-sol', display_name: 'GPT 6 Sol', description: '日常工作',
      supported_reasoning_efforts: [{ reasoning_effort: 'none' }, { reasoning_effort: 'minimal' },
        { reasoning_effort: 'low', description: '更快' }, { reasoning_effort: 'medium' },
        { reasoning_effort: 'high', description: '更深' }, { reasoning_effort: 'xhigh' },
        { reasoning_effort: 'max' }, { reasoning_effort: 'imaginary' }], default_reasoning_effort: 'low' },
    { slug: 'gpt-6-luna', supported_reasoning_efforts: [] }, { slug: 'gpt-6-sol' }] })
  }, oauth, '1.0.0')
  const liveCatalog = await catalog.operate({ type: 'discover-models', id: saved.connection.id, revision: 2 })
  expect(liveCatalog).toMatchObject({
    models: [{ id: 'gpt-6-luna', reasoningEfforts: [] }, { id: 'gpt-6-sol', displayName: 'GPT 6 Sol', description: '日常工作',
      reasoningEfforts: [{ effort: 'none' }, { effort: 'minimal' }, { effort: 'low', description: '更快' },
        { effort: 'medium' }, { effort: 'high', description: '更深' }, { effort: 'xhigh' }, { effort: 'max' }],
      defaultReasoningEffort: 'low' }], capabilitiesVerified: false, source: 'live',
  })
  expect((await reopened.cachedModelCatalog(saved.connection.id, 2))?.models[1]?.reasoningEfforts)
    .toEqual((liveCatalog as { models: { reasoningEfforts?: unknown }[] }).models[1]?.reasoningEfforts)
  expect(catalogRequests).toBe(1)
  expect((await store.read()).connections[0]?.connection.capabilities.tools).toBe('unknown')
  now += 70_000; await Promise.all([oauth.resolveCredential(status.connection.connection), oauth.resolveCredential(status.connection.connection)])
  expect(refreshes).toBe(1)
  await service.operate({ type: 'revoke-connection', id: saved.connection.id })
  await expect(oauth.resolveCredential(status.connection.connection)).rejects.toMatchObject({ code: 'credential-revoked' })
  await expect(catalog.operate({ type: 'discover-models', id: saved.connection.id, revision: 2 })).rejects.toMatchObject({ code: 'credential-revoked' })
  expect(catalogRequests).toBe(1)
  expect((await reopened.read()).connections[0]).toMatchObject({ revoked: true, hasCredential: false })
})

it('port collision and cancelled or configuration-stale login preserve saved metadata and cannot create credentials', async () => {
  const { store, saved } = await setup(); let url = '', opened = 0
  const transport = await tokenServer(), oauth = new OAuthDesktopService({ store, openExternal: async value => { url = value; opened++ }, callbackPort: 0, callbackHost: '127.0.0.1', fetch: transport })
  const started = await oauth.start(saved.connection.id, 1)
  const callbackPort = Number(new URL(new URL(url).searchParams.get('redirect_uri')!).port)
  const collision = new OAuthDesktopService({ store, openExternal: async () => { opened++ }, callbackHost: '127.0.0.1', callbackPort, fetch: transport })
  await expect(collision.start(saved.connection.id, 1)).rejects.toMatchObject({ code: 'oauth-callback-port-in-use' }); expect(opened).toBe(1)
  await oauth.cancel(started.loginId); expect(oauth.status(started.loginId).status).toBe('cancelled')
  expect((await store.read()).connections[0]).toEqual(saved)
  const next = await oauth.start(saved.connection.id, 1)
  const { id: _id, revision: _revision, auth, ...configuration } = saved.connection
  await store.saveConnection({ id: saved.connection.id, expectedRevision: 1, connection: { ...configuration, authKind: auth.kind, billing: { kind: 'unknown' } } })
  expect((await fetch(callback(url))).status).toBe(400)
  expect(oauth.status(next.loginId).status).toBe('failed')
  expect((await store.read()).connections[0]).toMatchObject({ hasCredential: false, connection: { revision: 2, accountId: 'pending-login' } })
})

it('secure storage unavailable never opens login and failed refresh cannot revive a logged-out account', async () => {
  const { store, saved, port } = await setup(); let opened = 0, url = '', now = 1_000_000, hold = false, entered!: () => void, release!: () => void
  const transport = await tokenServer(async (_fields, res) => { if (hold) { entered(); await new Promise<void>(resolve => { release = resolve }) }
    res.end(JSON.stringify({ access_token: token(), refresh_token: 'private-refresh', expires_in: 120 })) })
  const oauth = new OAuthDesktopService({ store, openExternal: async value => { opened++; url = value }, callbackPort: 0, callbackHost: '127.0.0.1', fetch: transport, now: () => now })
  port.isEncryptionAvailable = () => false
  await expect(oauth.start(saved.connection.id, 1)).rejects.toMatchObject({ code: 'secure-storage-unavailable' }); expect(opened).toBe(0)
  port.isEncryptionAvailable = () => true
  const start = await oauth.start(saved.connection.id, 1); await fetch(callback(url)); const status = oauth.status(start.loginId); if (status.status !== 'connected') throw new Error()
  now += 70_000; hold = true; const reached = new Promise<void>(resolve => { entered = resolve }), refreshing = oauth.resolveCredential(status.connection.connection)
  await reached; await oauth.revokeConnection(saved.connection.id); release()
  await expect(refreshing).rejects.toMatchObject({ code: 'credential-changed-during-refresh' })
  expect((await store.read()).connections[0]?.hasCredential).toBe(false)
})
