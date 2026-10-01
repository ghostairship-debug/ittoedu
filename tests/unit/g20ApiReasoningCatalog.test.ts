// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { DiscoveredModels } from '../../src/shared/workbench/executionSettingsDesktop'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ExecutionSettingsDesktopService } from '../../src/main/workbench/providers/executionSettingsService'

it('maps API declared reasoning levels without inventing options or replacing selected parameters', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'g20-api-reasoning-'))
  try {
    const key = randomBytes(32)
    const store = new ExecutionSettingsStore({ directory, encryption: {
      isEncryptionAvailable: () => true,
      encryptString(value) {
        const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
        const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), bytes])
      },
      decryptString(value) {
        const bytes = Buffer.from(value), cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
        cipher.setAuthTag(bytes.subarray(12, 28))
        return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')
      },
    } })
    let catalogRequests = 0
    const service = new ExecutionSettingsDesktopService(store, async (url, init) => {
      expect(String(url)).toBe('https://catalog.invalid/v1/models')
      expect(init?.method ?? 'GET').toBe('GET')
      catalogRequests++
      return Response.json({ data: [
        { id: 'declared-model', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } },
        { id: 'undeclared-model', display_name: 'No declared effort' },
      ] })
    })
    const saved = await store.saveConnection({ connection: { provider: 'fixture', protocol: 'openai-chat',
      baseURL: 'https://catalog.invalid/v1', accountId: 'fixture', authKind: 'api-key', billing: { kind: 'unknown' },
      capabilities: { tools: 'unknown', stream: 'unknown', vision: 'unknown', reasoning: 'unknown' } }, apiKey: 'fixture-private-key' })
    const parameters = { reasoning_effort: 'low', thinking: { type: 'enabled' }, temperature: 0.25 }
    const profile = await store.saveProfile({ expectedRevision: 0, roles: {
      conversation: { connectionId: saved.connection.id, model: 'declared-model', parameters },
      vision: null, imageGenerate: null, imageEdit: null,
    } })

    const result = await service.operate({ type: 'discover-models', id: saved.connection.id, revision: saved.connection.revision }) as DiscoveredModels

    expect(result.models).toEqual([
      { id: 'declared-model', reasoningEfforts: [{ effort: 'low' }, { effort: 'high' }, { effort: 'max' }], defaultReasoningEffort: 'high' },
      { id: 'undeclared-model', displayName: 'No declared effort' },
    ])
    expect(result).toMatchObject({ source: 'live', capabilitiesVerified: false })
    expect((await store.read()).profile).toEqual(profile)
    expect((await store.snapshot('conversation')).parameters).toEqual(parameters)
    expect(catalogRequests).toBe(1)
  } finally {
    const relative = path.relative(os.tmpdir(), path.resolve(directory))
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture outside temp')
    await rm(directory, { recursive: true, force: true })
  }
})
