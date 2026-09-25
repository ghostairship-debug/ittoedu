// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionConnectionConfiguration, ExecutionProfile } from '../../src/shared/workbench/executionSettings'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const relative = path.relative(os.tmpdir(), path.resolve(directory))
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
function encryption() {
  const key = randomBytes(32)
  const state = { available: true, failEncrypt: false, failDecrypt: false }
  const port: CredentialEncryptionPort = {
    isEncryptionAvailable: () => state.available,
    encryptString(text) {
      if (state.failEncrypt) throw new Error(`fixture encryption error echoes ${text}`)
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(input) {
      if (state.failDecrypt) throw new Error('fixture decrypt private failure')
      const bytes = Buffer.from(input), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
  return { port, state }
}
const config = (accountId = 'account-one'): ExecutionConnectionConfiguration => ({ provider: 'fixture-provider', protocol: 'openai-chat',
  baseURL: 'https://fixture.invalid/v1', accountId, authKind: 'api-key', billing: { kind: 'token-plan' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' } })
async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-settings-')); directories.push(directory)
  const cipher = encryption()
  const options = { directory, encryption: cipher.port, now: () => new Date('2026-09-23T01:02:03Z') }
  return { directory, cipher, options, store: new ExecutionSettingsStore(options) }
}
function roles(connectionId: string): ExecutionProfile['roles'] {
  return { conversation: { connectionId, model: 'text-model', parameters: { reasoning_effort: 'high' } },
    vision: { connectionId, model: 'vision-model' }, imageGenerate: null, imageEdit: null }
}

it('persists encrypted revision credentials and independent roles with immutable request snapshots and no product defaults', async () => {
  const { directory, options, store } = await setup()
  expect(await store.read()).toMatchObject({ connections: [], profile: { revision: 0,
    roles: { conversation: null, vision: null, imageGenerate: null, imageEdit: null } } })
  const saved = await store.saveConnection({ connection: config(), apiKey: 'fixture-secret-first-never-plaintext' })
  expect(saved).toMatchObject({ hasCredential: true, revoked: false, connection: { revision: 1, auth: { kind: 'api-key' }, billing: { kind: 'token-plan' } } })
  const profile = await store.saveProfile({ expectedRevision: 0, roles: roles(saved.connection.id) })
  expect(profile).toMatchObject({ revision: 1, updatedAt: '2026-09-23T01:02:03.000Z' })
  const frozen = await store.snapshot('conversation')
  expect(Object.isFrozen(frozen)).toBe(true)
  expect(Object.isFrozen(frozen.connection.auth)).toBe(true)
  expect(frozen).toMatchObject({ profileRevision: 1, model: 'text-model', connection: { revision: 1 } })
  await store.saveConnection({ id: saved.connection.id, expectedRevision: 1,
    connection: { ...config(), imageProtocol: 'openai-images', baseURL: 'https://another-fixture.invalid/v1' }, apiKey: 'fixture-secret-second-never-plaintext' })
  await store.saveProfile({ expectedRevision: 1, roles: { ...roles(saved.connection.id), conversation: { connectionId: saved.connection.id, model: 'next-model' },
    imageGenerate: { connectionId: saved.connection.id, model: 'image-model' }, imageEdit: { connectionId: saved.connection.id, model: 'edit-model' } } })
  const reopened = new ExecutionSettingsStore(options)
  const next = await reopened.snapshot('conversation')
  expect(next).toMatchObject({ profileRevision: 2, model: 'next-model', connection: { revision: 2, baseURL: 'https://another-fixture.invalid/v1' } })
  expect(await reopened.resolveCredential(frozen.connection)).toBe('fixture-secret-first-never-plaintext')
  expect(await reopened.resolveCredential(next.connection)).toBe('fixture-secret-second-never-plaintext')
  expect((await reopened.snapshot('vision')).model).toBe('vision-model')
  expect((await reopened.snapshot('imageGenerate')).model).toBe('image-model')
  expect((await reopened.snapshot('imageEdit')).model).toBe('edit-model')
  expect(frozen.model).toBe('text-model')
  const publicJSON = JSON.stringify(await reopened.read())
  const disk = await fs.readFile(path.join(directory, 'execution-settings-v1.json'), 'utf8')
  for (const secret of ['fixture-secret-first-never-plaintext', 'fixture-secret-second-never-plaintext']) {
    expect(disk).not.toContain(secret); expect(publicJSON).not.toContain(secret)
  }
  expect(publicJSON).not.toContain('encrypted')
  expect(publicJSON).not.toContain('apiKey')
  expect(await fs.readdir(directory)).toEqual(['execution-settings-v1.json'])
})

it('requires an explicit Images opt-in, rejects unsafe API roots, and preserves a formerly selected TeamoRouter image role', async () => {
  const { directory, options, store } = await setup()
  const text = await store.saveConnection({ connection: { ...config(), provider: 'teamorouter',
    baseURL: 'https://api.teamorouter.com/v1' }, apiKey: 'fixture-secret' })
  await expect(store.saveProfile({ expectedRevision: 0, roles: { ...roles(text.connection.id),
    imageGenerate: { connectionId: text.connection.id, model: 'gpt-image-2' } } })).rejects.toMatchObject({ code: 'unsupported-image-connection' })
  await expect(store.saveConnection({ connection: { ...config(), imageProtocol: 'openai-images',
    baseURL: 'http://untrusted.invalid/v1' }, apiKey: 'other-secret' })).rejects.toMatchObject({ code: 'invalid-connection' })
  expect((await store.read()).connections[0]!.connection.imageProtocol).toBeNull()

  const filename = path.join(directory, 'execution-settings-v1.json')
  const old = JSON.parse(await fs.readFile(filename, 'utf8'))
  delete old.revisions[0].connection.imageProtocol
  old.profile.roles.imageGenerate = { connectionId: text.connection.id, model: 'gpt-image-2', parameters: {} }
  old.profile.revision = 1
  await fs.writeFile(filename, JSON.stringify(old))
  const reopened = new ExecutionSettingsStore(options)
  expect((await reopened.snapshot('imageGenerate')).connection.imageProtocol).toBe('openai-images')
  expect(await reopened.resolveCredential((await reopened.snapshot('imageGenerate')).connection)).toBe('fixture-secret')

  old.profile.roles.imageGenerate = null
  await fs.writeFile(filename, JSON.stringify(old))
  expect((await reopened.read()).connections[0]!.connection.imageProtocol).toBeNull()
})

it('applies persisted capability facts only to the exact connection revision, model and parameters', async () => {
  const { options, store } = await setup()
  const saved = await store.saveConnection({ connection: config(), apiKey: 'fixture-secret' })
  await store.saveProfile({ expectedRevision: 0, roles: roles(saved.connection.id) })
  const selected = await store.snapshot('vision')
  expect(selected.connection.capabilities.vision).toBe('unknown')
  await store.recordCapabilityProbe(selected, { observedAt: 100, checks: ['vision'], requestCount: 1,
    outcomes: [{ capability: 'vision', status: 'supported', code: 'probe-vision-observed', message: 'fixture observed', actualModel: 'vision-actual' }],
    facts: { vision: { status: 'supported', observedAt: 100, source: 'probe', actualModel: 'vision-actual' } } })
  const reopened = new ExecutionSettingsStore(options)
  expect((await reopened.snapshot('vision')).connection.capabilities.vision).toBe('supported')
  await reopened.saveProfile({ expectedRevision: 1, roles: { ...roles(saved.connection.id), vision: {
    connectionId: saved.connection.id, model: 'vision-model', parameters: { detail: 'high' },
  } } })
  expect((await reopened.snapshot('vision')).connection.capabilities.vision).toBe('unknown')
  await reopened.saveConnection({ id: saved.connection.id, expectedRevision: 1, connection: config(), apiKey: 'fixture-secret-next' })
  expect((await reopened.snapshot('conversation')).connection.capabilities.tools).toBe('unknown')
  expect((await reopened.read()).capabilityRecords).toHaveLength(1)
})

it('isolates account changes, serializes competing updates and revokes all old revisions without reviving them on login', async () => {
  const { store, options } = await setup()
  const first = await store.saveConnection({ connection: config(), apiKey: 'fixture-original' })
  await store.saveProfile({ roles: roles(first.connection.id) })
  const original = await store.snapshot('conversation')
  const [updated, stale] = await Promise.allSettled([
    store.saveConnection({ id: first.connection.id, expectedRevision: 1, connection: config('account-two') }),
    new ExecutionSettingsStore(options).saveConnection({ id: first.connection.id, expectedRevision: 1, connection: config('account-three'), apiKey: 'fixture-not-admitted' }),
  ])
  expect(updated.status).toBe('fulfilled')
  if (updated.status !== 'fulfilled') throw new Error('update failed')
  expect(updated.value).toMatchObject({ hasCredential: false, connection: { revision: 2, accountId: 'account-two' } })
  expect(stale).toMatchObject({ status: 'rejected', reason: { code: 'stale-connection' } })
  await expect(store.snapshot('conversation')).rejects.toMatchObject({ code: 'credential-unavailable' })
  expect(await store.resolveCredential(original.connection)).toBe('fixture-original')
  await expect(store.resolveCredential({ ...original.connection, baseURL: 'https://wrong.invalid/v1' })).rejects.toMatchObject({ code: 'stale-credential-reference' })
  const second = await store.saveConnection({ id: first.connection.id, expectedRevision: 2, connection: config('account-two'), apiKey: 'fixture-second' })
  const snapshot = await store.snapshot('conversation')
  const revoking = store.revokeConnection(first.connection.id)
  const queuedResolve = store.resolveCredential(snapshot.connection)
  await revoking
  await expect(queuedResolve).rejects.toMatchObject({ code: 'credential-revoked' })
  await expect(new ExecutionSettingsStore(options).resolveCredential(original.connection)).rejects.toMatchObject({ code: 'credential-revoked' })
  const loggedIn = await store.saveConnection({ id: first.connection.id, expectedRevision: second.connection.revision,
    connection: config('account-two'), apiKey: 'fixture-new-login' })
  expect(loggedIn.connection.revision).toBe(4)
  expect(await store.resolveCredential(loggedIn.connection)).toBe('fixture-new-login')
  await expect(store.resolveCredential(snapshot.connection)).rejects.toMatchObject({ code: 'credential-revoked' })
  const oauth = await store.saveConnection({ connection: { ...config(), authKind: 'oauth', billing: { kind: 'subscription' } } })
  expect(oauth.hasCredential).toBe(false)
  await expect(store.saveConnection({ connection: { ...config(), authKind: 'oauth' }, apiKey: 'fixture-no-oauth' })).rejects.toMatchObject({ code: 'oauth-not-connected' })
})

it('preserves prior settings when secure storage/encryption/disk writes fail, while revocation remains possible', async () => {
  const { directory, cipher, store, options } = await setup()
  const first = await store.saveConnection({ connection: config(), apiKey: 'fixture-existing' })
  await store.saveProfile({ roles: roles(first.connection.id) })
  const filename = path.join(directory, 'execution-settings-v1.json')
  const before = await fs.readFile(filename, 'utf8')
  cipher.state.available = false
  expect((await store.read()).secureStorageAvailable).toBe(false)
  await expect(store.saveConnection({ id: first.connection.id, connection: config(), apiKey: 'fixture-not-stored' })).rejects.toMatchObject({ code: 'secure-storage-unavailable' })
  await expect(store.resolveCredential(first.connection)).rejects.toMatchObject({ code: 'secure-storage-unavailable' })
  await expect(store.saveProfile({ roles: roles(first.connection.id) })).rejects.toMatchObject({ code: 'secure-storage-unavailable' })
  expect(await fs.readFile(filename, 'utf8')).toBe(before)
  cipher.state.available = true; cipher.state.failEncrypt = true
  await expect(store.saveConnection({ id: first.connection.id, connection: config(), apiKey: 'fixture-not-echoed' })).rejects.toThrow('凭据加密失败')
  expect(await fs.readFile(filename, 'utf8')).toBe(before)
  cipher.state.failEncrypt = false; cipher.state.failDecrypt = true
  await expect(store.resolveCredential(first.connection)).rejects.toMatchObject({ code: 'credential-decryption-failed' })
  cipher.state.failDecrypt = false
  const obstructed = path.join(directory, 'blocked-parent')
  await fs.writeFile(obstructed, 'ordinary file')
  await expect(new ExecutionSettingsStore({ ...options, directory: obstructed }).saveConnection({ connection: config(), apiKey: 'fixture-private' })).rejects.toMatchObject({ code: 'settings-write-failed' })
  expect(await fs.readFile(filename, 'utf8')).toBe(before)
  cipher.state.available = false
  await store.revokeConnection(first.connection.id)
  expect((await new ExecutionSettingsStore(options).read()).connections[0]).toMatchObject({ revoked: true, hasCredential: false })
  expect(await fs.readdir(directory)).toEqual(expect.arrayContaining(['execution-settings-v1.json', 'blocked-parent']))
  expect((await fs.readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(false)
})
