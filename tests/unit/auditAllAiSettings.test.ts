// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ModelCapabilityProbe } from '../../src/main/workbench/providers/ModelCapabilityProbe'
import { modelCapabilityIdentity, modelCapabilityRecord, modelCapabilitySelection } from '../../src/shared/workbench/modelCapabilities'
import { bodyStreamingIdentity } from '../../src/shared/workbench/bodyStreaming'
import { withModelReasoning } from '../../src/shared/workbench/modelReasoning'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) { if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid fixture root'); await fs.rm(root, { recursive: true, force: true }) } })
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audit-ai-settings-')); roots.push(directory)
  const store = new ExecutionSettingsStore({ directory, encryption: { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => Buffer.from(bytes).toString() } })
  const configuration = { provider: 'teamorouter', protocol: 'openai-chat' as const, baseURL: 'https://api.teamorouter.com/v1', accountId: 'friendly label', authKind: 'api-key' as const, billing: { kind: 'metered' as const }, capabilities: { tools: 'unknown' as const, vision: 'unknown' as const, stream: 'unknown' as const, reasoning: 'unknown' as const } }
  const entry = await store.saveConnection({ connection: configuration, apiKey: 'fixture-key' })
  await store.saveProfile({ expectedRevision: 0, roles: { conversation: { connectionId: entry.connection.id, model: 'gpt-6-luna' }, vision: null, compression: null, imageGenerate: null, imageEdit: null } })
  return { store, entry, configuration }
}
it('CA-057 clears all managed formats for default/new format while keeping unrelated advanced parameters', () => {
  const params = { temperature: 0.5, thinking: { type: 'disabled' }, enable_thinking: false, reasoning_effort: 'high' }
  const resolved = { format: 'reasoning-object', choices: [{ effort: 'high' }], status: 'known' } as any
  expect(withModelReasoning(params, undefined, resolved)).toEqual({ temperature: 0.5 })
  expect(withModelReasoning(params, 'high', resolved)).toEqual({ temperature: 0.5, reasoning: { effort: 'high' } })
})
it('CA-059 includes effective wire protocol in both existing evidence identities', async () => {
  const { store } = await fixture(), selection = await store.snapshot('conversation')
  const a = { ...selection, model: 'private', capabilityModel: 'gpt-6-luna', apiProtocol: undefined }, b = { ...a, capabilityModel: 'claude-fixture' }
  expect(modelCapabilityIdentity(a)).not.toEqual(modelCapabilityIdentity(b)); expect(bodyStreamingIdentity(a)).not.toEqual(bodyStreamingIdentity(b))
  const record = { ...modelCapabilityIdentity(a), facts: { tools: { status: 'supported', source: 'probe', observedAt: 1 } }, lastProbe: {} } as any
  expect(modelCapabilityRecord([record], b)).toBeUndefined()
  expect(modelCapabilitySelection(record, selection.connection)).toEqual({ model: 'private', parameters: {}, capabilityModel: 'gpt-6-luna' })
  expect(modelCapabilitySelection(record, { ...selection.connection, protocol: 'anthropic-messages' })).toBeUndefined()
})
it('CA-174 reuses unchanged request evidence and cached catalog across a billing-label change', async () => {
  const { store, entry, configuration } = await fixture(), frozen = await store.snapshot('conversation')
  await store.recordCapabilityProbe(frozen, { observedAt: 1, checks: ['tools'], requestCount: 1, outcomes: [{ capability: 'tools', status: 'supported', code: 'fixture', message: 'fixture' }], facts: { tools: { status: 'supported', source: 'probe', observedAt: 1 } } })
  await store.recordModelCatalog({ connectionId: entry.connection.id, connectionRevision: entry.connection.revision, models: [{ id: frozen.model }], checkedAt: '2026-10-11T00:00:00.000Z', source: 'live', capabilitiesVerified: false })
  const updated = await store.saveConnection({ id: entry.connection.id, expectedRevision: entry.connection.revision, connection: { ...configuration, billing: { kind: 'prepaid' } } })
  const current = await store.snapshot('conversation')
  expect(current.connection.capabilities.tools).toBe('supported'); expect(updated.hasCredential).toBe(true)
  expect(await store.cachedModelCatalog(updated.connection.id, updated.connection.revision)).toBeTruthy()
})
it('CA-223 preserves an API key when an equivalent automatic route becomes explicit and a display account is renamed', async () => {
  const { store, entry, configuration } = await fixture()
  const updated = await store.saveConnection({ id: entry.connection.id, expectedRevision: entry.connection.revision, connection: { ...configuration, protocol: 'openai-responses', accountId: 'renamed label' } })
  expect(updated.hasCredential).toBe(true); expect(await store.resolveCredential((await store.snapshot('conversation')).connection)).toBe('fixture-key')
})
it('CA-190 reports zero requests for explicit provider not-sent facts and retains the outcome', async () => {
  const { store } = await fixture(), selection = await store.snapshot('conversation')
  const probe = new ModelCapabilityProbe({ provider: { async *stream() { yield { type: 'response.failed', failure: { outcome: 'not-sent', kind: 'configuration', code: 'reserved-parameter', message: 'request not sent' } } as any } } })
  const result = await probe.probe(selection, ['tools'])
  expect(result).toMatchObject({ requestCount: 0, outcomes: [{ outcome: 'not-sent' }] })
  expect((await store.recordCapabilityProbe(selection, result)).lastProbe.requestCount).toBe(0)
})
