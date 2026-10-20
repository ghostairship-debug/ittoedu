// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { executionSettingsRequestSchema } from '../../src/shared/workbench/executionSettingsDesktop'
import type { ExecutionConnectionConfiguration, ExecutionProfile } from '../../src/shared/workbench/executionSettings'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const relative = path.relative(os.tmpdir(), path.resolve(directory))
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
const roles: ExecutionProfile['roles'] = { conversation: null, vision: null, imageGenerate: null, imageEdit: null }
const connection: ExecutionConnectionConfiguration = { provider: 'speech-fixture', protocol: 'openai-chat',
  baseURL: 'https://speech.invalid/v1', accountId: 'fixture-account', authKind: 'api-key', billing: { kind: 'metered' },
  capabilities: { tools: 'unknown', stream: 'unknown', reasoning: 'unknown', vision: 'unknown' } }
const speech = (connectionId: string) => ({ connectionId, model: 'provider-speech-v1', voice: 'provider-voice-37', format: 'mp3' as const })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-speech-settings-')); directories.push(directory)
  const encryption = { isEncryptionAvailable: vi.fn(() => true), encryptString: vi.fn(() => Buffer.from('unused-fixture')),
    decryptString: vi.fn(() => { throw new Error('settings-only operation must not decrypt credentials') }) }
  const options = { directory, encryption }
  return { directory, encryption, options, store: new ExecutionSettingsStore(options) }
}

it('stores speech only after explicit selection, preserves it through old saves, and cold reads the same configuration', async () => {
  const f = await fixture()
  expect((await f.store.read()).profile.speech).toBeUndefined()
  const api = await f.store.saveConnection({ connection })
  const text = await f.store.saveConnection({ connection: { ...connection, accountId: 'text-account' } })
  const selectedRoles = { ...roles, conversation: { connectionId: text.connection.id, model: 'text-fixture' } }
  await f.store.saveProfile({ roles: selectedRoles, nativeConcurrencyLimit: 6 })
  expect((await f.store.read()).profile.speech).toBeUndefined()
  // Metadata configuration needs neither a credential read nor unlocked storage.
  f.encryption.isEncryptionAvailable.mockReturnValue(false)
  const selectedSpeech = { ...speech(api.connection.id), supportsInstructions: true, supportsSpeed: true }
  const saved = await f.store.saveProfile({ expectedRevision: 1, roles: selectedRoles, speech: selectedSpeech })
  expect(saved.speech).toEqual(selectedSpeech)
  const oldSave = await f.store.saveProfile({ expectedRevision: 2, roles: selectedRoles, nativeConcurrencyLimit: 8 })
  expect(oldSave).toMatchObject({ speech: selectedSpeech, nativeConcurrencyLimit: 8, roles: selectedRoles })
  expect((await new ExecutionSettingsStore(f.options).read()).profile).toEqual(oldSave)
  expect(f.encryption.decryptString).not.toHaveBeenCalled()
  const disabled = await f.store.saveProfile({ expectedRevision: 3, roles: selectedRoles, speech: null })
  expect(disabled).toMatchObject({ speech: null, nativeConcurrencyLimit: 8, roles: selectedRoles, search: oldSave.search })
  expect((await new ExecutionSettingsStore(f.options).read()).profile.speech).toBeNull()
})

it('validates the speech schema and eligible connection without turning a model role into speech authority', async () => {
  const f = await fixture(), api = await f.store.saveConnection({ connection })
  const request = { type: 'save-profile', input: { roles, speech: speech(api.connection.id) } }
  const parsed = executionSettingsRequestSchema.parse(request)
  expect(parsed.type === 'save-profile' && (parsed.input.speech?.supportsInstructions ?? false)).toBe(false)
  expect(parsed.type === 'save-profile' && (parsed.input.speech?.supportsSpeed ?? false)).toBe(false)
  for (const patch of [{ voice: '' }, { voice: 'x'.repeat(201) }, { model: 'x'.repeat(513) },
    { format: 'ogg' }, { model: '' }, { connectionId: '' }, { apiKey: 'forbidden' }, { supportsInstructions: 'yes' }, { supportsSpeed: 'yes' }])
    expect(executionSettingsRequestSchema.safeParse({ ...request, input: { ...request.input, speech: { ...request.input.speech, ...patch } } }).success).toBe(false)
  const anthropic = await f.store.saveConnection({ connection: { ...connection, protocol: 'anthropic-messages' } })
  const oauth = await f.store.saveConnection({ connection: { ...connection, provider: 'openai', protocol: 'chatgpt-responses',
    baseURL: 'https://chatgpt.com/backend-api/codex', authKind: 'oauth', billing: { kind: 'subscription' } } })
  for (const invalid of [anthropic, oauth]) await expect(f.store.saveProfile({ roles, speech: speech(invalid.connection.id) }))
    .rejects.toMatchObject({ code: 'unsupported-speech-connection' })
  await expect(f.store.saveProfile({ roles, speech: speech('missing') })).rejects.toMatchObject({ code: 'unknown-connection' })
  await f.store.revokeConnection(api.connection.id)
  await expect(f.store.saveProfile({ roles, speech: speech(api.connection.id) })).rejects.toMatchObject({ code: 'revoked-connection' })
  expect((await f.store.read()).profile).toMatchObject({ revision: 0, roles })
  expect((await f.store.read()).profile.speech).toBeUndefined()
})
